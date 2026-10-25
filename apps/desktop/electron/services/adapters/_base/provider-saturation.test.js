// @ts-check
/**
 * provider-saturation.test.js — 视频 provider 的「超时分类 + 饱和度估计」守卫
 *
 * 覆盖同一治理主题下的两个纯函数模块：
 *   - `provider-timeout.js`    ：把「超时」拆成 **客户端等待超时** 与 **连接层失败**；
 *   - `provider-saturation.js` ：饱和检测 + 队列排空时间估计。
 *
 * ⚠️ 本文件里的错误对象**照抄沙箱 Node 实跑出来的真实形态**（2026-10-25 实测），
 * 不是「逻辑上应该长什么样」：
 *   - 客户端等待超时 ⇒ `DOMException`，`name='AbortError'`、`code=20`、**无 cause**；
 *   - 连接层失败 ⇒ `TypeError('fetch failed')`，真实错误在 **`cause.code`** 里。
 * ⇒ 换成「理想形态」的 fixture 会让这些锁失去意义（它们守的就是那个形态差异）。
 */

import { describe, it, expect, beforeEach } from 'vitest'

const {
  CLIENT_WAIT,
  CONNECT,
  isClientWaitAbort,
  isConnectFailure,
  isConnectTimeout,
  classifyProviderTimeout,
  timeoutKindOf,
  isRetryableTimeout,
} = require('./provider-timeout')
const {
  recordSubmitOutcome,
  readSaturation,
  resetProviderSaturation,
  resetAllProviderSaturation,
  CONSECUTIVE_THRESHOLD,
  DEFAULT_AVG_SERVICE_MS,
  WINDOW_SIZE,
  MIN_DRAIN_MS,
  MAX_DRAIN_MS,
} = require('./provider-saturation')
const { ProviderError, ERROR_CODES } = require('./provider-error')

/** ⭐ 真实形态：客户端等待超时（我们的 AbortController 放弃） */
function clientWaitAbortError () {
  const e = new Error('This operation was aborted')
  e.name = 'AbortError'
  e.code = 20
  return e
}

/** ⭐ 真实形态：连接层失败（undici 把真实错误放进 cause，e.message 只是 "fetch failed"） */
function connectFailureError (code, causeMessage) {
  const e = new TypeError('fetch failed')
  const cause = new Error(causeMessage || code)
  cause.code = code
  e.cause = cause
  return e
}

describe('provider-timeout — 超时的两类判据', () => {
  it('A1 客户端等待超时 ⇒ 分类为 client-wait，且不被误判成连接层失败', () => {
    const e = clientWaitAbortError()
    expect(isClientWaitAbort(e)).toBe(true)
    expect(isConnectFailure(e)).toBe(false)
    expect(classifyProviderTimeout(e)).toBe(CLIENT_WAIT)
  })

  it('A2 连接层失败（ENOTFOUND / ECONNREFUSED / ETIMEDOUT / UND_ERR_SOCKET）⇒ 分类为 connect', () => {
    for (const code of ['ENOTFOUND', 'ECONNREFUSED', 'ETIMEDOUT', 'UND_ERR_SOCKET', 'EAI_AGAIN']) {
      expect(classifyProviderTimeout(connectFailureError(code))).toBe(CONNECT)
    }
  })

  it('A3 ⭐ 连接层**超时**（ETIMEDOUT）才报超时语义，其余连接层错误不是超时', () => {
    expect(isConnectTimeout(connectFailureError('ETIMEDOUT'))).toBe(true)
    expect(isConnectTimeout(connectFailureError('ENOTFOUND'))).toBe(false)
    expect(isConnectTimeout(connectFailureError('UND_ERR_SOCKET'))).toBe(false)
  })

  it('A4 ⭐ 回归锁：判据必须穿透 cause —— e.message 只有 "fetch failed" 时不得判成「不是超时」', () => {
    // 若判据只看 e.message（现状的写法），这个错误会被读成「未知」⇒ 连接层超时的修复等于没做。
    const e = connectFailureError('ETIMEDOUT', 'connect ETIMEDOUT 10.0.0.1:443')
    expect(String(e.message)).toBe('fetch failed')
    expect(classifyProviderTimeout(e)).toBe(CONNECT)
  })

  it('A5 非超时类错误 ⇒ 分类为 null（不瞎猜）', () => {
    expect(classifyProviderTimeout(new Error('boom'))).toBe(null)
    expect(classifyProviderTimeout(new TypeError('fetch failed'))).toBe(null)
    expect(classifyProviderTimeout(null)).toBe(null)
  })

  it('A6 ProviderError 上的 timeoutKind 读取（context 形态 + 兼容直挂形态）', () => {
    const viaContext = new ProviderError(ERROR_CODES.TIMEOUT, 'x', { timeoutKind: CLIENT_WAIT })
    expect(timeoutKindOf(viaContext)).toBe(CLIENT_WAIT)
    const viaDirect = new ProviderError(ERROR_CODES.TIMEOUT, 'x')
    viaDirect.timeoutKind = CONNECT
    expect(timeoutKindOf(viaDirect)).toBe(CONNECT)
    expect(timeoutKindOf(new ProviderError(ERROR_CODES.RATE_LIMITED, 'x'))).toBe(null)
  })

  it('A7 ⭐ 核心判据：客户端等待超时**不可**立即重投；连接层/其它错误仍可重投', () => {
    const clientWait = new ProviderError(ERROR_CODES.TIMEOUT, 'aborted', { timeoutKind: CLIENT_WAIT })
    const connect = new ProviderError(ERROR_CODES.TIMEOUT, 'etimedout', { timeoutKind: CONNECT })
    const other = new ProviderError(ERROR_CODES.RATE_LIMITED, '429')
    expect(isRetryableTimeout(clientWait)).toBe(false)
    expect(isRetryableTimeout(connect)).toBe(true)
    // ⚠ 「分不清」不等于「拒绝重试」—— 否则正常的网络抖动会被砍掉重试能力。
    expect(isRetryableTimeout(other)).toBe(true)
  })
})

describe('provider-saturation — 饱和检测与排空估计', () => {
  const PID = 'test-provider'
  const NOW = 1_700_000_000_000

  beforeEach(() => {
    resetAllProviderSaturation()
  })

  function seed (entries, now = NOW) {
    resetProviderSaturation(PID)
    for (const e of entries) {
      recordSubmitOutcome(PID, e.kind, { now: e.at === undefined ? now : e.at, durationMs: e.durationMs })
    }
    return readSaturation(PID, now)
  }

  it('B0 空窗口 ⇒ 未饱和、无滞留、无排空估计', () => {
    const s = readSaturation(PID)
    expect(s.state).toBe('normal')
    expect(s.saturated).toBe(false)
    expect(s.pendingEstimate).toBe(0)
    expect(s.estimatedDrainMs).toBe(0)
    expect(s.estimatedRecoveryMinutes).toBe(0)
  })

  it('B1 连续 3 次客户端超时 ⇒ 判饱和（阈值判据）', () => {
    const s = seed([
      { kind: CLIENT_WAIT }, { kind: CLIENT_WAIT }, { kind: CLIENT_WAIT },
    ])
    expect(s.consecutiveClientTimeouts).toBe(CONSECUTIVE_THRESHOLD)
    expect(s.saturated).toBe(true)
    expect(s.state).toBe('saturated')
  })

  it('B2 ⭐ 样本不足时**不**用超时率判饱和（1 次超时 / 1 次成功 = 50% 不得误判）', () => {
    const s = seed([{ kind: CLIENT_WAIT }, { kind: 'ok' }])
    expect(s.windowSize).toBe(2)
    expect(s.timeoutRate).toBe(0.5)
    expect(s.saturated).toBe(false)
    expect(s.state).toBe('normal')
  })

  it('B3 超时率判据：交错形态（连续数不足但窗口超时率 ≥ 50%）⇒ 判饱和', () => {
    const s = seed([
      { kind: 'ok' }, { kind: CLIENT_WAIT },
      { kind: 'ok' }, { kind: CLIENT_WAIT },
      { kind: 'ok' }, { kind: CLIENT_WAIT },
    ])
    expect(s.consecutiveClientTimeouts).toBe(1)
    expect(s.windowSize).toBe(6)
    expect(s.timeoutRate).toBeGreaterThanOrEqual(0.5)
    expect(s.saturated).toBe(true)
  })

  it('B4 ⭐ 窗口过期：半小时前的客户端超时不该继续让今天的批次熔断', () => {
    const s = seed([
      { kind: CLIENT_WAIT, at: NOW - 2 * 60 * 60 * 1000 },
      { kind: CLIENT_WAIT, at: NOW - 2 * 60 * 60 * 1000 },
      { kind: CLIENT_WAIT, at: NOW - 2 * 60 * 60 * 1000 },
    ], NOW)
    expect(s.windowSize).toBe(0)
    expect(s.saturated).toBe(false)
  })

  it('B5 窗口条数上限：只保留最近 WINDOW_SIZE 条', () => {
    const entries = []
    for (let i = 0; i < 25; i++) entries.push({ kind: 'ok', at: NOW - (25 - i) * 1000 })
    entries.push({ kind: CLIENT_WAIT, at: NOW - 2000 })
    entries.push({ kind: CLIENT_WAIT, at: NOW - 1000 })
    entries.push({ kind: CLIENT_WAIT, at: NOW })
    const s = seed(entries, NOW)
    expect(s.windowSize).toBe(WINDOW_SIZE)
    expect(s.consecutiveClientTimeouts).toBe(3)
    expect(s.saturated).toBe(true)
  })

  it('B6 ⭐ 排空时间由「滞留数 × 平均服务时间」推导，不是固定常数', () => {
    const s = seed([
      { kind: CLIENT_WAIT }, { kind: CLIENT_WAIT }, { kind: CLIENT_WAIT },
      { kind: 'ok', durationMs: 26600 },
    ])
    expect(s.pendingEstimate).toBe(3)
    expect(s.avgServiceMs).toBe(26600)
    expect(s.estimatedDrainMs).toBe(3 * 26600)
    expect(s.estimatedRecoveryMinutes).toBe(Math.ceil((3 * 26600) / 60000))
    // ⚠ 排空估计必须**随滞留数变化**，否则就退化成固定退避了
    const s2 = seed([
      { kind: CLIENT_WAIT }, { kind: CLIENT_WAIT }, { kind: CLIENT_WAIT },
      { kind: CLIENT_WAIT }, { kind: CLIENT_WAIT }, { kind: CLIENT_WAIT },
      { kind: 'ok', durationMs: 26600 },
    ])
    expect(s2.estimatedDrainMs).toBe(2 * s.estimatedDrainMs)
  })

  it('B7 没有成功样本时用实测均值兜底（26.6s），不用中位数 725ms', () => {
    const s = seed([{ kind: CLIENT_WAIT }, { kind: CLIENT_WAIT }, { kind: CLIENT_WAIT }])
    expect(s.avgServiceMs).toBe(DEFAULT_AVG_SERVICE_MS)
    expect(DEFAULT_AVG_SERVICE_MS).toBe(26600)
    expect(s.estimatedDrainMs).toBe(3 * 26600)
  })

  it('B8 排空等待有上下限（太短形同虚设，太长无限挂起）', () => {
    const many = []
    for (let i = 0; i < WINDOW_SIZE; i++) many.push({ kind: CLIENT_WAIT, at: NOW })
    const s = seed(many, NOW)
    expect(s.pendingEstimate).toBe(WINDOW_SIZE)
    expect(s.estimatedDrainMs).toBe(WINDOW_SIZE * DEFAULT_AVG_SERVICE_MS)
    expect(s.estimatedDrainMs).toBeGreaterThanOrEqual(MIN_DRAIN_MS)
    // 单请求服务时间很大时必须被上限截断（实测最大 218.5s ⇒ 20 条就是 73 分钟）
    const entries = []
    for (let i = 0; i < WINDOW_SIZE; i++) entries.push({ kind: CLIENT_WAIT, at: NOW })
    entries.push({ kind: 'ok', at: NOW, durationMs: 218500 })
    const slow = seed(entries, NOW)
    expect(slow.avgServiceMs).toBe(218500)
    expect(slow.estimatedDrainMs).toBe(MAX_DRAIN_MS)
  })

  it('B9 重置后不再饱和（新一轮 / 测试隔离）', () => {
    seed([{ kind: CLIENT_WAIT }, { kind: CLIENT_WAIT }, { kind: CLIENT_WAIT }])
    resetProviderSaturation(PID)
    const s = readSaturation(PID)
    expect(s.saturated).toBe(false)
    expect(s.windowSize).toBe(0)
  })
})

// ══════════════════════════════════════════════════════════════════════════
// 「滞留」与「速率」必须**分成两个量**（2026-10-25 独立复核抓到的阻断缺陷）
//
// 原设计把滞留数取自「近 20 条窗口」⇒ ① 排空估计被窗口封顶
// （「102 条滞留 ≈ 45 分钟」永远算不出来，最多 8.9 分钟）；
// ② 熔断等待期间没有新记录 ⇒ 窗口内容不变 ⇒ 等待后**永远**判成「仍饱和」
// ⇒ 等待纯空转、剩余镜头全灭、恢复提示永不出现。
// ══════════════════════════════════════════════════════════════════════════

describe('provider-saturation — 滞留（累积）与速率（窗口）分离', () => {
  const PID = 'test-provider-2'
  const NOW = 1_700_000_000_000

  beforeEach(() => {
    resetAllProviderSaturation()
  })

  it('B10 ⭐ 滞留过期 ⇒ 不再饱和（熔断等待后能真的恢复）', () => {
    for (let i = 0; i < 3; i++) recordSubmitOutcome(PID, 'client-wait', { now: NOW })
    // 刚发生时：饱和
    expect(readSaturation(PID, NOW).saturated).toBe(true)
    // ⭐ 过了过期阈值（2×实测均值 53.2s）后：滞留已过期 ⇒ 不再饱和
    const later = readSaturation(PID, NOW + 120000)
    expect(later.saturated).toBe(false)
    expect(later.pendingEstimate).toBe(0)
    expect(later.consecutiveClientTimeouts).toBe(0)
  })

  it('B11 ⭐ 滞留估计**不被窗口条数封顶**（102 条 ⇒ 45 分钟可算出来）', () => {
    for (let i = 0; i < 25; i++) recordSubmitOutcome(PID, 'client-wait', { now: NOW })
    const s = readSaturation(PID, NOW)
    expect(s.windowSize).toBe(WINDOW_SIZE)          // 速率视角仍是 20 条
    expect(s.pendingEstimate).toBe(25)              // ⭐ 累积视角不被封顶
    expect(s.estimatedDrainMs).toBe(25 * s.avgServiceMs)
  })

  it('B12 ⭐ 过期的客户端超时不再拉高近窗口超时率', () => {
    // 3 次超时发生在 2 分钟前（已过期）+ 3 次成功发生在现在
    for (let i = 0; i < 3; i++) recordSubmitOutcome(PID, 'client-wait', { now: NOW - 120000 })
    for (let i = 0; i < 3; i++) recordSubmitOutcome(PID, 'ok', { now: NOW, durationMs: 26600 })
    const s = readSaturation(PID, NOW)
    expect(s.saturated).toBe(false)
    expect(s.timeoutRate).toBe(0)
  })

  it('B13 ⭐ 未过期的超时仍按窗口判饱和（过期机制不能把真饱和也放过）', () => {
    for (let i = 0; i < 3; i++) recordSubmitOutcome(PID, 'client-wait', { now: NOW })
    const s = readSaturation(PID, NOW + 10000)   // 10s < 过期阈值 53.2s
    expect(s.saturated).toBe(true)
    expect(s.pendingEstimate).toBe(3)
  })
})
