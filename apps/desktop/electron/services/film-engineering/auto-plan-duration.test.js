// @ts-check
'use strict'
/**
 * auto-plan 的单镜时长契约测试（从 auto-plan.test.js 拆出，见债务预算 FILES_OVER_500）
 * 覆盖：F2/F34 增量字段 / W9 聚合可见性 / 无引号动作文案退档位 / 缺省档位与能力同源
 */
const { planAutoShots } = require('./auto-plan')
const { DEFAULT_TIERS: DEFAULT_DURATION_TIERS } = require('./shot-duration')

// ===== v7 批次一 F2 + F34：单镜时长与来源优先级（纯增量，不动既有 seconds 语义）=====

describe('planAutoShots: durationMs 增量字段（F2 + F34）', () => {
  const withScript = (script, extra = {}) => planAutoShots({
    script,
    characterRefs: [],
    sceneRefs: [],
    aspect: '16x9',
    seconds: 5,
    targetDurationSec: 20,
    templateShots: [{ prompt: 'T1' }],
    ...extra,
  })

  it('每镜都带 durationMs / durationSec / durationSource', () => {
    const r = withScript('第一场\n他推开门走了进来。')
    expect(r.ok).toBe(true)
    for (const s of r.shots) {
      expect(Number.isFinite(s.durationMs)).toBe(true)
      expect(s.durationMs).toBeGreaterThan(0)
      expect(s.durationSec).toBe(s.durationMs / 1000)
      expect(['formula', 'tier', 'tts', 'user']).toContain(s.durationSource)
    }
  })

  it('既有 seconds 语义不变（下游消费方不受影响）', () => {
    const r = withScript('第一场\n他推开门走了进来。')
    expect(r.ok).toBe(true)
    for (const s of r.shots) expect(s.seconds).toBe(5)
  })

  it('plannedDurationSec 仍是档位基线（不因增量字段而改变）', () => {
    const r = withScript('第一场\n他推开门走了进来。')
    expect(r.ok).toBe(true)
    expect(r.plannedDurationSec).toBe(r.shots.length * 5)
  })

  it('estimatedDurationSec 是逐镜 durationMs 之和（允许 0.1s 取整）', () => {
    const r = withScript('第一场\n短句。\n\n第二场\n这是一句明显更长的台词，字数多了不少。')
    expect(r.ok).toBe(true)
    const sum = r.shots.reduce((a, s) => a + s.durationMs, 0) / 1000
    expect(Math.abs(r.estimatedDurationSec - sum)).toBeLessThan(0.15)
  })

  it('长文案镜与短文案镜的推算时长不同（说明时长真的按台词算了）', () => {
    // N=2（10s / 5s）才能保证两个 beat 各占一镜、不被均分稀释
    const r = planAutoShots({
      script: '第一场\n他说：「' + '这是一句特别长的台词'.repeat(8) + '」\n\n第二场\n她说：「短。」',
      characterRefs: [],
      sceneRefs: [],
      aspect: '16x9',
      // ⚠️ 2026-10-24（M0′）：单镜秒数取 10 而非 5 —— 80 字需 10.0s，
      // 在 5 秒档下**真念不完** ⇒ 新契约（M0′.2 fail-closed）会拦下这个用例；
      // 本用例的原意是「长/短文案的推算时长不同」，与容量判定无关 ⇒ 改用装得下的档位。
      seconds: 10,
      targetDurationSec: 20,
      templateShots: [{ prompt: 'T1' }],
    })
    expect(r.ok).toBe(true)
    expect(r.shots.length).toBe(2)
    const durations = new Set(r.shots.map((s) => s.durationMs))
    expect(durations.size).toBeGreaterThan(1)
    // 长台词那镜必须比短句那镜长
    expect(Math.max(...r.shots.map((s) => s.durationMs))).toBeGreaterThan(Math.min(...r.shots.map((s) => s.durationMs)))
  })

  it('durationSourceCount 汇总与逐镜来源一致', () => {
    const r = withScript('第一场\n他推开门。\n\n第二场\n她抬起头。')
    expect(r.ok).toBe(true)
    const counted = r.shots.filter((s) => s.durationSource === 'formula').length
    expect(r.durationSourceCount.formula).toBe(counted)
  })

  it('estimates.estimatedDurationSec 与顶层字段一致', () => {
    const r = withScript('第一场\n他推开门。')
    expect(r.ok).toBe(true)
    expect(r.estimates.estimatedDurationSec).toBe(r.estimatedDurationSec)
  })
})

// ===== v7 对抗评审 i1：逐镜时长警告必须聚合进 plan.warnings =====

describe('planAutoShots: 时长警告可见（i1）', () => {
  it('逐镜时长警告聚合为 W9，不再只藏在 shots[].durationWarnings', () => {
    // 单镜塞进远超 10s 档位的台词量
    const r = planAutoShots({
      script: '第一场\n他说：「' + '这是一句特别长的台词'.repeat(10) + '。」',
      characterRefs: [],
      sceneRefs: [],
      aspect: '16x9',
      seconds: 5,
      targetDurationSec: 10,
      templateShots: [{ prompt: 'T1' }],
    })
    // ⚠️ 2026-10-24（M0′.2 复核修正）：超长台词现在走 **fail-closed**（规划中止），
    //   但 **W9 仍然在失败返回的 warnings 里**（W9 的计算早于容量判定）⇒
    //   原断言「plan 级聚合出 W9」依然成立，只是要改成对**失败返回**断言。
    expect(r.ok).toBe(false)
    expect(r.errorCode).toBe('AUTO_DIALOGUE_OVERFLOW')
    const w9 = r.warnings.find((w) => w.code === 'W9')
    expect(w9).toBeTruthy()
    expect(w9.message).toContain('#')
    // 逐镜明细也必须带出来（消费方唯一能看到「哪一镜念不完」的粒度）
    expect((r.shots[0].durationWarnings || []).length).toBeGreaterThan(0)
    expect(r.shots[0].durationWarnings.join('')).toMatch(/#|镜|需时|念不完/)
  })

  it('无时长警告时不产生 W9（防恒真告警）', () => {
    const r = planAutoShots({
      script: '第一场\n他说：「好。」',
      characterRefs: [],
      sceneRefs: [],
      aspect: '16x9',
      seconds: 5,
      targetDurationSec: 10,
      templateShots: [{ prompt: 'T1' }],
    })
    expect(r.ok).toBe(true)
    expect(r.warnings.map((w) => w.code)).not.toContain('W9')
  })

  it('逐镜带 durationRawSec，便于调用方展示吸附落差', () => {
    const r = planAutoShots({
      script: '第一场\n他说：「一二三四五六七八九十。」',
      characterRefs: [],
      sceneRefs: [],
      aspect: '16x9',
      seconds: 5,
      targetDurationSec: 10,
      templateShots: [{ prompt: 'T1' }],
    })
    expect(r.ok).toBe(true)
    for (const s of r.shots) {
      expect(s.durationRawSec === null || Number.isFinite(s.durationRawSec)).toBe(true)
    }
  })

  it('durationTiers 可注入（i3：kit 可成为运行时事实源）', () => {
    const r = planAutoShots({
      script: '第一场\n他推开门。',
      characterRefs: [],
      sceneRefs: [],
      aspect: '16x9',
      seconds: 5,
      targetDurationSec: 20,
      durationTiers: [5, 8, 10, 12],
      templateShots: [{ prompt: 'T1' }],
    })
    expect(r.ok).toBe(true)
    for (const s of r.shots) {
      expect([5, 8, 10, 12]).toContain(s.durationSec)
    }
  })
})

// ===== v7 对抗评审第二轮 =====

describe('planAutoShots: 无引号动作文案走档位兜底（i4）', () => {
  const run = (script) => planAutoShots({
    script,
    characterRefs: [],
    sceneRefs: [],
    aspect: '16x9',
    seconds: 5,
    targetDurationSec: 10,
    templateShots: [{ prompt: 'T1' }],
  })

  it('纯动作描述（无引号）不按字/秒折算，走 tier', () => {
    const r = run('第一场\n他缓慢地推开门走进屋子环顾四周然后停在窗前凝视着外面连绵不断的雨夜和远处的灯火')
    expect(r.ok).toBe(true)
    for (const s of r.shots) {
      expect(s.durationSource).toBe('tier')
      expect(s.durationSec).toBe(5)
    }
  })

  it('带引号才走 formula', () => {
    const r = run('第一场\n他缓慢地推开门走进屋子，低声说：「你终于来了。」')
    expect(r.ok).toBe(true)
    expect(r.shots[0].durationSource).toBe('formula')
  })

  it('无引号时给出可操作提示（告知如何标注台词）', () => {
    const r = run('第一场\n他推开门走进屋子环顾四周')
    expect(r.ok).toBe(true)
    const w = (r.shots[0].durationWarnings || []).join()
    expect(w).toContain('未检出引号台词')
    expect(w).toContain('「」')
  })

  it('无引号的长动作镜不再触发「必须拆解台词」（i4 的核心）', () => {
    const r = run('第一场\n' + '他缓慢地推开门走进屋子环顾四周然后停在窗前凝视'.repeat(6))
    expect(r.ok).toBe(true)
    const w9 = r.warnings.find((w) => w.code === 'W9')
    expect(w9).toBeUndefined()
  })
})

describe('planAutoShots: 默认档位与模型能力同源（i3 第二轮）', () => {
  it('能力表含 12s（输入白名单只有 5/8/10）—— 缺省档位来自 shot-duration DEFAULT_TIERS', () => {
    // ⚠️ 2026-10-24（M0′.2）拆成两条断言：
    //   ① 能力表确实含 12s（常量事实，与「吸附上限 12s」是同一份事实）；
    //   ② 但**自动模式出片用的是全局 o.seconds** ⇒ 用户选 5 秒时，
    //      「吸附到 12s」只是规划期的假象（今天也没真用上，出片仍按 5 秒走）
    //      ⇒ 新契约必须把它拦下，而不是产出一镜「念不完的 12 秒片」。
    expect(DEFAULT_DURATION_TIERS).toContain(12)
    const r = planAutoShots({
      script: '第一场\n他说：「' + '一二三四五六七八九十'.repeat(9) + '」',
      characterRefs: [],
      sceneRefs: [],
      aspect: '16x9',
      seconds: 5,
      targetDurationSec: 10,
      templateShots: [{ prompt: 'T1' }],
    })
    expect(r.ok).toBe(false)
    expect(r.errorCode).toBe('AUTO_DIALOGUE_OVERFLOW')
    // ⚠️ 「常量自证」不够（对常量断言常量恒真）⇒ 补一条**行为断言**：
    //   缺省档位表下，48 字（6.0s）落在 8 秒档 ⇒ `durationSec` 必须是 DEFAULT_TIERS 里的值。
    const r2 = planAutoShots({
      script: '第一场\n他说：「' + '一二三四五六七八九十'.repeat(5) + '」',
      characterRefs: [],
      sceneRefs: [],
      aspect: '16x9',
      seconds: 10,
      targetDurationSec: 10,
      templateShots: [{ prompt: 'T1' }],
    })
    expect(r2.ok).toBe(true)
    expect(DEFAULT_DURATION_TIERS).toContain(r2.shots[0].durationSec)
  })

  it('注入档位仍优先', () => {
    const r = planAutoShots({
      // ⚠️ 2026-10-24（M0′.2 复核修正）：80 字（10.0s）在**两张表**下都吸到 10 秒
      //   ⇒ 断言已无鉴别力（恒真）。改用**能区分**的取值：48 字（6.0s）——
      //   注入表 [5,10] ⇒ 吸到 10 秒；缺省表 [5,8,10,12] ⇒ 吸到 8 秒。
      //   （50 字 = 6.25s ≤ 10.3s ⇒ 在新契约下 ok=true，不撞容量判定；
      //     ⚠️ targetDurationSec 必须 ≥ 10（输入校验下限），故用 10 秒档而不是 8 秒档。）
      script: '第一场\n他说：「' + '一二三四五六七八九十'.repeat(5) + '」',
      characterRefs: [], sceneRefs: [], aspect: '16x9', seconds: 10, targetDurationSec: 10,
      durationTiers: [5, 10],
      templateShots: [{ prompt: 'T1' }],
    })
    expect(r.ok).toBe(true)
    expect(r.shots[0].durationSec).toBe(10)
    // 对照：同一段台词在**缺省**档位表下应吸到 8 秒 ⇒ 这才证明「注入优先」被观察到
    const rDefault = planAutoShots({
      script: '第一场\n他说：「' + '一二三四五六七八九十'.repeat(5) + '」',
      characterRefs: [], sceneRefs: [], aspect: '16x9', seconds: 10, targetDurationSec: 10,
      templateShots: [{ prompt: 'T1' }],
    })
    expect(rDefault.ok).toBe(true)
    expect(rDefault.shots[0].durationSec).toBe(8)
  })
})

// ===== M0′.3：effectiveSeconds —— 出片**消费**的逐镜镜长 =====

describe('planAutoShots: effectiveSeconds（M0′.3 出片消费的逐镜镜长）', () => {
  const SCRIPT_50_CHARS = '第一场\n他说：「' + '一二三四五六七八九十'.repeat(5) + '」'

  it('每镜都带 effectiveSeconds，且恒为**规划期档位表**之一（默认 [5,8,10,12]）', () => {
    const r = planAutoShots({
      script: SCRIPT_50_CHARS,
      characterRefs: [], sceneRefs: [], aspect: '16x9', seconds: 10, targetDurationSec: 10,
      templateShots: [{ prompt: 'T1' }],
    })
    expect(r.ok).toBe(true)
    for (const s of r.shots) {
      // ⚠ 规划期**档位表**（`shot-duration.js` 的 DEFAULT_TIERS）= [5, 8, 10, 12]
      //   ⇒ `effectiveSeconds` 恒为**档位表**之一（**可能含 12**）；
      //   而**用户可选**档位是 [5,8,10]（AUTO_SHOT_SECONDS）—— 仓内**既有的两套档位表**，本片不动。
      expect([5, 8, 10, 12]).toContain(s.effectiveSeconds)
      expect(Number.isFinite(s.effectiveSeconds)).toBe(true)
    }
  })

  it('⭐ 台词短的镜 ⇒ effectiveSeconds < 用户所选档位（这正是 M0′.3 的效果）', () => {
    // 用户选 **10 秒**档；本镜台词 50 字 ⇒ 推算 6.25s ⇒ 吸附到 **8 秒**档
    // ⇒ 出片必须按 8 秒走（而不是用户选的 10 秒）⇒ 否则后 4 秒是空场。
    const r = planAutoShots({
      script: SCRIPT_50_CHARS,
      characterRefs: [], sceneRefs: [], aspect: '16x9', seconds: 10, targetDurationSec: 10,
      templateShots: [{ prompt: 'T1' }],
    })
    expect(r.ok).toBe(true)
    expect(r.shots[0].seconds).toBe(10)          // 用户所选档位语义**不动**
    expect(r.shots[0].durationSec).toBe(8)        // 推算后吸附的档位
    expect(r.shots[0].effectiveSeconds).toBe(8)   // 出片消费的那个值
    expect(r.shots[0].effectiveSeconds).toBeLessThan(r.shots[0].seconds)
  })

  it('effectiveSeconds 恒 ≤ seconds（镜长只减不增 ⇒ 不会把成片撑长）', () => {
    for (const sec of [5, 8, 10]) {
      const r = planAutoShots({
        script: SCRIPT_50_CHARS,
        characterRefs: [], sceneRefs: [], aspect: '16x9', seconds: sec, targetDurationSec: Math.max(10, sec),
        templateShots: [{ prompt: 'T1' }],
      })
      if (!r.ok) continue
      for (const s of r.shots) {
        expect(s.effectiveSeconds).toBeLessThanOrEqual(s.seconds)
        expect([5, 8, 10]).toContain(s.effectiveSeconds)
      }
    }
  })
})

// ===== shot-effective-seconds：逐镜镜长的唯一决策点（M0′.3）=====
//
// ⚠ 追加到本文件而不是新建测试文件：**新增测试文件会改变 CI 的 vitest 分片分配**
//   （仓内先例：新增 `startup-promise.test.js` 触发分片重排 ⇒ 把一个「真 ffmpeg 渲染」的
//   用例挪进了更慢的 shard ⇒ 顶不住通用 10s 时限 ⇒ 假红）。

describe('shot-effective-seconds：逐镜镜长决策点', () => {
  const {
    resolveDurationTiers, resolveShotDurations, computeEffectiveSeconds, resolveShotSeconds,
  } = require('./shot-effective-seconds')

  it('resolveDurationTiers：可注入、升序、缺省回落到默认档位表', () => {
    expect(resolveDurationTiers([10, 5, 8])).toEqual([5, 8, 10])
    expect(resolveDurationTiers([8, 'x', 0, 5])).toEqual([5, 8])
    // ⚠ 默认档位表 = `shot-duration.js` 的 DEFAULT_TIERS = **[5, 8, 10, 12]**
    //   （规划期档位表**含 12**；而**用户可选**档位是 [5,8,10]（AUTO_SHOT_SECONDS）——
    //   这是仓内**既有的两套档位表**，本片不动，只如实记录。）
    expect(resolveDurationTiers(undefined)).toEqual([5, 8, 10, 12])
  })

  it('⭐ computeEffectiveSeconds：**与来源无关** —— 连续值也要吸附到可选档位', () => {
    // ⚠ 这是本模块存在的理由：`durationSec` 在 tts/user 分支是**连续值**（5.3），
    //   直接交给 pickFilmFrameCount 会落进「≤8 ⇒ 201 帧 ⇒ 8 秒」⇒ **镜长被放大**。
    const continuous = { ok: true, durationSec: 5.3, rawSec: 5.3, source: 'tts' }
    expect(computeEffectiveSeconds(continuous, [5, 8, 10], 10)).toBe(5)
    // 已经吸附过的档位值 ⇒ 幂等
    const snapped = { ok: true, durationSec: 8, rawSec: 6.25, source: 'formula' }
    expect(computeEffectiveSeconds(snapped, [5, 8, 10], 10)).toBe(8)
    // 没有 rawSec（tier 兜底）⇒ 用档位值本身
    const tierOnly = { ok: true, durationSec: 10, source: 'tier' }
    expect(computeEffectiveSeconds(tierOnly, [5, 8, 10], 10)).toBe(10)
    // 解析失败 ⇒ 兜底到用户所选档位
    expect(computeEffectiveSeconds({ ok: false }, [5, 8, 10], 8)).toBe(8)
  })

  it('resolveShotSeconds：回落链 = effectiveSeconds → shot.seconds → 兜底', () => {
    expect(resolveShotSeconds({ effectiveSeconds: 8, seconds: 10 }, 5)).toBe(8)
    expect(resolveShotSeconds({ seconds: 10 }, 5)).toBe(10)          // 存量镜
    expect(resolveShotSeconds({}, 5)).toBe(5)                        // 什么都没有
    expect(resolveShotSeconds({}, undefined)).toBe(5)                // 兜底
    expect(resolveShotSeconds(null, 8)).toBe(8)
  })

  it('resolveShotDurations：规划期一次算出「来源链结果 + 出片镜长」', () => {
    const r = resolveShotDurations(
      { text: '第一场\n他说：「' + '一二三四五六七八九十'.repeat(5) + '」', emotion: 'normal' },
      { tiers: [5, 8, 10], maxSec: 10, defaultSec: 10, capacitySec: 10 },
    )
    expect(r.duration.ok).toBe(true)
    expect(r.effectiveSeconds).toBe(8)          // 6.25s ⇒ 8 秒档
    expect([5, 8, 10]).toContain(r.effectiveSeconds)
  })
})

// ===== M0′.3 的**端到端**断言：规划期 → 落盘 → 出片（复核方抓出的真断点）=====
//
// ⚠ 这条用例是**独立复核逼出来的**：原先的 A46 只在 `project.shots` 上**手工塞**
//   `effectiveSeconds = 8` ⇒ 恰好绕开唯一丢字段的地方（`auto-project.js` 的落盘白名单）
//   ⇒ 125 个测试对真实链路**完全失明**。
// ⇒ 本条走**真链路**：planAutoShots → createProject（真落盘）→ runAutoBatch（真出片桩）
//   ⇒ 断言出片收到的 `seconds` 是 8（而不是用户选的 10）。
//
// ⚠ 为什么放这个文件而不是 auto-runner.test.js：
//   `auto-runner.test.js` 已 652 行（在 `check-max-lines` 的**挂账清单**里）
//   ⇒ 再加行会触「挂账文件增长」判红 ⇒ 追加到本文件（372 行，余量充足），
//   且本文件本来就是「单镜时长契约」主题，语义吻合。

describe('M0′.3 端到端：规划期 → 落盘 → 出片（真实链路）', () => {
  const fs = require('fs')
  const os = require('os')
  const path = require('path')
  const { createProject } = require('./auto-project')
  const { runAutoBatch, shotFileName } = require('./auto-runner')
  const { resetProviderSaturation } = require('../adapters/_base/provider-saturation')

  // ⚠ provider 饱和度观测窗口是**模块级**的 ⇒ 每例前重置（生产侧对应 `auto-start` 的重置）
  beforeEach(() => { resetProviderSaturation('minimax') })

  const SCRIPT_50_CHARS = '第一场\n他说：「' + '一二三四五六七八九十'.repeat(5) + '」'

  it('⭐ plan → createProject → runAutoBatch：出片收到逐镜镜长 8（不是用户选的 10）', async () => {
    // ① 规划期：用户选 10 秒档，台词 50 字 ⇒ 推算 6.25s ⇒ 吸附到 8 秒档
    const plan = planAutoShots({
      script: SCRIPT_50_CHARS,
      characterRefs: [], sceneRefs: [], aspect: '16x9',
      seconds: 10, targetDurationSec: 10,
      templateShots: [{ prompt: 'T1' }],
    })
    expect(plan.ok).toBe(true)
    expect(plan.shots[0].effectiveSeconds).toBe(8)
    expect(plan.shots[0].seconds).toBe(10)

    // ② 落盘：**真 createProject**（走落盘白名单）⇒ 字段必须活着
    const home = fs.mkdtempSync(path.join(os.tmpdir(), 'film-e2e-home-'))
    // ⚠ `createProject` 成功时**直接返回 project 对象**（没有 `ok` 字段）；
    //   失败才返回 `{ ok: false, errorCode, message }` ⇒ 这里用 `errorCode` 判失败。
    const created = createProject({ plan, taskId: 'auto-e2e-1', home, now: '2026-10-25T00:00:00.000Z' })
    expect(created.errorCode).toBeUndefined()
    expect(created.shots[0].effectiveSeconds).toBe(8)   // ⭐ 传输层没丢
    expect(created.shots[0].seconds).toBe(10)

    // ③ 出片：真 runAutoBatch（只桩掉「生成视频」这一步）⇒ 收到的 seconds 必须是 8
    const runRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'film-e2e-run-'))
    const seen = []
    const project = created
    const batch = { runId: 'auto/auto-e2e-1/b0', shotIds: project.shots.map((s) => s.shotId) }
    await runAutoBatch({
      batch, project,
      aiGenerator: { _modelProviderManager: { getDefault: (cap) => (cap === 'video' ? { id: 'minimax' } : null) } },
      log: null,
      deps: {
        _testGenerateShotVideo: async ({ shot, index, runDir, seconds }) => {
          seen.push({ index, seconds })
          const p = path.join(runDir, shotFileName(index))
          fs.writeFileSync(p, 'FAKE')
          return { index, shotId: shot.shotId, success: true, path: p }
        },
        _testRunDir: (runId) => path.join(runRoot, runId),
        _testSleep: async () => {},
      },
      onShotProgress: () => {},
    })
    expect(seen.length).toBeGreaterThan(0)
    expect(seen[0].seconds).toBe(8)   // ⭐ 端到端成立：出片按逐镜镜长走
  })

  it('⭐ 落盘白名单是**唯一传输层**：不透传 ⇒ 出片回落 10（这条锁住「别再漏」）', async () => {
    // ⚠ 复现复核方抓到的断点：`createProject` 的落盘白名单若不含 `effectiveSeconds`
    //   ⇒ 出片恒收到 10（= 用户选的整档）⇒ **M0′.3 变成 no-op**。
    //   ⇒ 这条断言把「传输层」钉进回归网：白名单一改，这里立刻红。
    const plan = planAutoShots({
      script: SCRIPT_50_CHARS,
      characterRefs: [], sceneRefs: [], aspect: '16x9',
      seconds: 10, targetDurationSec: 10,
      templateShots: [{ prompt: 'T1' }],
    })
    const home = fs.mkdtempSync(path.join(os.tmpdir(), 'film-e2e-home-'))
    const created = createProject({ plan, taskId: 'auto-e2e-2', home, now: '2026-10-25T00:00:00.000Z' })
    expect(created.errorCode).toBeUndefined()
    // ⭐ 判据落在**落盘后的产物**上（不是「白名单里有这个 key」这种形状断言）
    expect(created.shots.every((s) => s.effectiveSeconds === 8)).toBe(true)
  })
})
