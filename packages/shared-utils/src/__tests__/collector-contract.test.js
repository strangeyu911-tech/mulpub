/**
 * 采集契约层 —— Vitest 单元测试
 *
 * 为什么单独成层（2026-10-25）：
 *   采集通道要跑在**主进程**（DataSyncService 注册在 container.setup.js:349），
 *   而旧的 `_rpaFetchStats()` 走 `window.electronAPI` / `ipcRenderer`
 *   —— 两者只存在于渲染进程 ⇒ 主进程必然落空 ⇒ 落到「返回一组 0」的兜底。
 *   PR #4435 把那个兜底改成抛错（fail-loud），治住了「假 0」，
 *   但真正的缺口是**采集通道从未存在**（rpaFetchData / rpa:fetchData 全仓只在注释里）。
 *
 *   本层是**纯函数**：不碰 Electron、不碰 DOM、不碰网络。
 *   ⇒ 契约判据能在沙箱里真跑 + 能做变异验证（这是 Electron 执行体那层做不到的）。
 *
 * 契约（采集脚本在页面里跑，返回给主进程）：
 *   成功      → { ok: true,  data: { <字段>: <数值>, ... } }
 *   未就绪    → { ok: false, reason: 'not-ready' }            （页面还没渲染出容器 ⇒ 继续等）
 *   字段缺失  → { ok: false, reason: 'missing', field: '<名>' }（容器在但字段缺 ⇒ 选择器可能过期）
 *   其余形状  → 不合契约 ⇒ invalid（**不得**当成「没数据」静默放过）
 *
 * ⛔ 旧脚本返回的是**裸对象**（`{ views, followers }`）且字段用 `parseInt(x || '0')` 兜底
 *    ⇒ 契约层必须把它判为 invalid，而不是「收下这组数」。
 */
const {
  COLLECT_ERRORS,
  evaluateCollectorObservation,
  classifyCollectorTimeout,
  isCollectDue,
  assertCollectorPlatform,
} = require('../collector-contract')

describe('采集契约 / 单次观测的判读', () => {
  test('成功形态：ok + data 全部数值合法 ⇒ 通过', () => {
    const r = evaluateCollectorObservation({ ok: true, data: { views: 120, followers: 3400 } })
    expect(r.ok).toBe(true)
    expect(r.data).toEqual({ views: 120, followers: 3400 })
  })

  test('真的是 0 也要算成功（0 是合法值，不是缺失）', () => {
    const r = evaluateCollectorObservation({ ok: true, data: { views: 0, followers: 0 } })
    expect(r.ok).toBe(true)
    expect(r.data.followers).toBe(0)
  })

  test('not-ready ⇒ 可重试的未就绪（不是错误结论）', () => {
    const r = evaluateCollectorObservation({ ok: false, reason: 'not-ready' })
    expect(r.ok).toBe(false)
    expect(r.reason).toBe('not-ready')
    expect(r.retryable).toBe(true)
  })

  test('missing ⇒ 字段缺失（点名字段）', () => {
    const r = evaluateCollectorObservation({ ok: false, reason: 'missing', field: 'followers' })
    expect(r.ok).toBe(false)
    expect(r.reason).toBe('missing')
    expect(r.field).toBe('followers')
  })

  test('脚本自报 invalid ⇒ 同样点名字段（界面要知道是哪个指标坏了）', () => {
    const r = evaluateCollectorObservation({ ok: false, reason: 'invalid', field: 'followers' })
    expect(r.ok).toBe(false)
    expect(r.reason).toBe('invalid')
    expect(r.field).toBe('followers')
  })

  test('⛔ 自报 invalid 但没给字段 ⇒ 仍是 invalid（不猜字段名）', () => {
    const r = evaluateCollectorObservation({ ok: false, reason: 'invalid' })
    expect(r.ok).toBe(false)
    expect(r.reason).toBe('invalid')
    expect(r.field).toBeUndefined()
  })

  test('⛔ 旧式裸对象（无 ok 字段）⇒ invalid（不得收下这组数）', () => {
    const r = evaluateCollectorObservation({ views: 100, followers: 200 })
    expect(r.ok).toBe(false)
    expect(r.reason).toBe('invalid')
  })

  test('⛔ 裸 null ⇒ invalid（不是「未就绪」——形状本身不合契约）', () => {
    const r = evaluateCollectorObservation(null)
    expect(r.ok).toBe(false)
    expect(r.reason).toBe('invalid')
  })

  test('⛔ undefined ⇒ invalid', () => {
    const r = evaluateCollectorObservation(undefined)
    expect(r.ok).toBe(false)
    expect(r.reason).toBe('invalid')
  })

  test('⛔ data 里出现非数值（字符串）⇒ invalid 且点名字段', () => {
    const r = evaluateCollectorObservation({ ok: true, data: { views: '120', followers: 3400 } })
    expect(r.ok).toBe(false)
    expect(r.reason).toBe('invalid')
    expect(r.field).toBe('views')
  })

  test('⛔ data 里出现负数 ⇒ invalid', () => {
    const r = evaluateCollectorObservation({ ok: true, data: { followers: -1 } })
    expect(r.ok).toBe(false)
    expect(r.reason).toBe('invalid')
    expect(r.field).toBe('followers')
  })

  test('⛔ data 里出现 NaN / Infinity ⇒ invalid', () => {
    expect(evaluateCollectorObservation({ ok: true, data: { followers: NaN } }).ok).toBe(false)
    expect(evaluateCollectorObservation({ ok: true, data: { followers: Infinity } }).ok).toBe(false)
  })

  test('⛔ data 为空对象 ⇒ invalid（没有任何可展示的数）', () => {
    const r = evaluateCollectorObservation({ ok: true, data: {} })
    expect(r.ok).toBe(false)
    expect(r.reason).toBe('invalid')
  })
})

describe('采集契约 / 超时后的错误分类', () => {
  test('最后一次观测是 not-ready ⇒ COLLECT_NOT_READY', () => {
    const r = classifyCollectorTimeout([
      { ok: false, reason: 'not-ready' },
      { ok: false, reason: 'not-ready' },
    ])
    expect(r.code).toBe(COLLECT_ERRORS.NOT_READY)
  })

  test('最后一次观测是 missing ⇒ COLLECT_FIELD_MISSING（选择器可能过期）', () => {
    const r = classifyCollectorTimeout([
      { ok: false, reason: 'not-ready' },
      { ok: false, reason: 'missing', field: 'followers' },
    ])
    expect(r.code).toBe(COLLECT_ERRORS.FIELD_MISSING)
    expect(r.field).toBe('followers')
  })

  test('最后一次观测 invalid ⇒ COLLECT_VALUE_INVALID', () => {
    const r = classifyCollectorTimeout([
      { ok: false, reason: 'invalid', field: 'views' },
    ])
    expect(r.code).toBe(COLLECT_ERRORS.VALUE_INVALID)
  })

  test('一次都没观测到 ⇒ COLLECT_NOT_READY（不是 invalid）', () => {
    const r = classifyCollectorTimeout([])
    expect(r.code).toBe(COLLECT_ERRORS.NOT_READY)
  })

  test('观测到成功却仍然走到超时分类 ⇒ COLLECT_VALUE_INVALID（异常路径兜底）', () => {
    const r = classifyCollectorTimeout([{ ok: true, data: { followers: 1 } }])
    expect(r.code).toBe(COLLECT_ERRORS.VALUE_INVALID)
  })
})

describe('采集契约 / 平台归属', () => {
  test('返回的 platform 与请求平台不一致 ⇒ COLLECT_PLATFORM_MISMATCH', () => {
    const r = assertCollectorPlatform('douyin', { platform: 'bilibili', followers: 10 })
    expect(r.ok).toBe(false)
    expect(r.code).toBe(COLLECT_ERRORS.PLATFORM_MISMATCH)
  })

  test('平台一致 ⇒ 通过', () => {
    const r = assertCollectorPlatform('douyin', { platform: 'douyin', followers: 10 })
    expect(r.ok).toBe(true)
  })

  test('返回里没有 platform 字段 ⇒ 不判定为不一致（该字段可选）', () => {
    const r = assertCollectorPlatform('douyin', { followers: 10 })
    expect(r.ok).toBe(true)
  })
})

describe('采集契约 / 节流判定', () => {
  const MIN = 30 * 60 * 1000

  test('从未采集过 ⇒ 应当采集', () => {
    expect(isCollectDue(null, 1_000_000, MIN)).toBe(true)
  })

  test('距上次采集不足最小间隔 ⇒ 不采集（零请求）', () => {
    expect(isCollectDue(1_000_000, 1_000_000 + MIN - 1, MIN)).toBe(false)
  })

  test('刚好达到最小间隔 ⇒ 采集（边界含等号）', () => {
    expect(isCollectDue(1_000_000, 1_000_000 + MIN, MIN)).toBe(true)
  })

  test('超过最小间隔 ⇒ 采集', () => {
    expect(isCollectDue(1_000_000, 1_000_000 + MIN + 1, MIN)).toBe(true)
  })

  test('⛔ 时间戳非法（NaN / 非数）⇒ 视为「从未采集过」⇒ 采集（不静默跳过）', () => {
    expect(isCollectDue(NaN, 1_000_000, MIN)).toBe(true)
    expect(isCollectDue('abc', 1_000_000, MIN)).toBe(true)
  })

  test('⛔ 最小间隔为 0 ⇒ 恒可采集（关掉节流）〔**不变量断言**：任何合理实现都成立，故不参与变异验证〕', () => {
    // ⚠️ 这条**恒真**（`now-last >= 0` 在 now>=last 时同样成立）⇒ 它是**不变量**，
    //    不是有区分力的判据。真正的边界区分力在下面「刚好达到最小间隔」那条。
    expect(isCollectDue(1_000_000, 1_000_000, 0)).toBe(true)
  })

  test('⛔ 最小间隔为 0 且**时钟回拨**（now < last）⇒ 仍可采集', () => {
    expect(isCollectDue(1_000_000, 999_999, 0)).toBe(true)
  })

  test('⛔ 时钟回拨（now < last）⇒ 应当采集，不得永久卡在「未到间隔」', () => {
    // now < last 意味着时间戳异常（系统时间被改 / 记录写错）。
    // 若按 (now-last) >= interval 判 ⇒ 恒假 ⇒ 该平台**永远不再采集**（数据停在旧值）。
    expect(isCollectDue(1_000_000, 999_999, MIN)).toBe(true)
  })
})
