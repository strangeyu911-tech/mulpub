// @ts-check
/**
 * workflow-plan.js — 批量发布节奏、护栏与去重键（纯函数）
 *
 * 为什么不是简单 sleep：用户要的是「同账号相邻两条间隔 35-40 分钟随机」，
 * 而现有 PublishIntervalGuard 只做「最小间隔 + 单边抖动」，它拦的是违规，
 * 不是排期。这里把「第 N 条应该落在几点」做成可注入随机源的纯函数，
 * 才能在测试里固定时钟验证边界（跨账号并行、生成超时顺延、额度截断）。
 *
 * 关键语义：
 * - **按平台+账号独立排队**：bilibili:a1 的第 2 条不会占用 douyin:a2 的间隔；
 * - **计划时间永不落在过去**：视频生成可能跑 20 分钟，排期按当前时刻重新兜底；
 * - **截断必须可解释**：allowed < itemCount 时返回 reason，由运行详情展示"为什么少跑了"。
 */

const { fingerprintContent } = require('./workflow-schema')
const { nextAllowedSlot } = require('./workflow-schedule-rules')

const MIN_MINUTES = 5
const MAX_MINUTES = 1440

function assertCadence (minMinutes, maxMinutes) {
  if (!Number.isInteger(minMinutes) || !Number.isInteger(maxMinutes)) {
    throw new TypeError('发布间隔必须是整数分钟')
  }
  if (minMinutes < MIN_MINUTES || maxMinutes > MAX_MINUTES) {
    throw new RangeError('发布间隔必须在 ' + MIN_MINUTES + '-' + MAX_MINUTES + ' 分钟之间')
  }
  if (minMinutes > maxMinutes) {
    throw new RangeError('发布间隔下限不能大于上限')
  }
}

function resolveTargetKey (target) {
  const platform = target && typeof target.platform === 'string' ? target.platform : ''
  const accountId = target && typeof target.accountId === 'string' && target.accountId ? target.accountId : 'default'
  return platform + ':' + accountId
}

/**
 * 创建一个按 target 独立推进的排期器。
 * @param {{ startAtMs?: number, minMinutes: number, maxMinutes: number, random?: () => number }} opts
 */
function createPacer (opts = {}) {
  const minMinutes = Number(opts.minMinutes)
  const maxMinutes = Number(opts.maxMinutes)
  assertCadence(minMinutes, maxMinutes)
  const startAtMs = Number.isFinite(opts.startAtMs) ? opts.startAtMs : Date.now()
  const random = typeof opts.random === 'function' ? opts.random : Math.random
  const scheduleRules = opts.scheduleRules || null
  /** @type {Map<string, number>} */
  const lastByTarget = new Map()

  function randomGapMinutes () {
    const span = maxMinutes - minMinutes + 1
    const raw = Math.floor(random() * span)
    const offset = Math.max(0, Math.min(span - 1, raw))
    return minMinutes + offset
  }

  function allowedSlot (raw) {
    const at = nextAllowedSlot(raw, scheduleRules)
    if (at == null) throw new RangeError('排期规则在 14 天内找不到可用时段')
    return at
  }

  return {
    /**
     * 取某目标的下一个排期时刻。
     * @param {string} targetKey
     * @param {number} [nowMs]
     * @returns {{ atMs: number, gapMinutes: number }}
     */
    next (targetKey, nowMs) {
      const now = Number.isFinite(nowMs) ? nowMs : Date.now()
      const key = String(targetKey || '')
      const last = lastByTarget.get(key)
      if (last == null) {
        const raw = Math.max(startAtMs, now)
        const at = allowedSlot(raw)
        lastByTarget.set(key, at)
        return { atMs: at, gapMinutes: 0 }
      }
      const gapMinutes = randomGapMinutes()
      const raw = Math.max(last + gapMinutes * 60 * 1000, now)
      const at = allowedSlot(raw)
      lastByTarget.set(key, at)
      return { atMs: at, gapMinutes }
    },
    /** 只读快照，供运行详情/测试 */
    snapshot () {
      return Object.fromEntries(lastByTarget.entries())
    },
  }
}

/**
 * 护栏裁决：单次上限 + 每日额度，取更紧的那个。
 * @param {{ itemCount: number, guardrails: { maxItemsPerRun: number, dailyItemLimit: number }, usedToday?: number }} input
 * @returns {{ ok: boolean, allowed: number, truncated: boolean, reason: string }}
 */
function checkGuardrails (input) {
  const itemCount = Math.max(0, Number(input && input.itemCount) || 0)
  const g = (input && input.guardrails) || {}
  const maxItemsPerRun = Math.max(1, Number(g.maxItemsPerRun) || 1)
  const dailyItemLimit = Math.max(1, Number(g.dailyItemLimit) || 1)
  const usedToday = Math.max(0, Number(input && input.usedToday) || 0)
  const dailyRemaining = Math.max(0, dailyItemLimit - usedToday)
  const allowed = Math.max(0, Math.min(itemCount, maxItemsPerRun, dailyRemaining))
  const truncated = allowed < itemCount
  if (itemCount === 0) return { ok: true, allowed: 0, truncated: false, reason: '' }
  if (allowed === 0) return { ok: false, allowed: 0, truncated: true, reason: 'dailyItemLimit' }
  let reason = ''
  if (truncated) {
    reason = dailyRemaining <= maxItemsPerRun ? 'dailyItemLimit' : 'maxItemsPerRun'
  }
  return { ok: true, allowed, truncated, reason }
}

function normalizeTitle (value) {
  return String(value == null ? '' : value).replace(/\s+/g, ' ').trim().toLowerCase()
}

/**
 * 去重双键：来源条目键（平台+内容 id / url / 标题）+ 内容指纹（标题+正文）。
 * @param {{ sourceType?: string, platform?: string, externalId?: string, url?: string, title?: string, content?: string }} item
 */
function buildDedupeKeys (item) {
  const sourceType = (item && item.sourceType) || 'unknown'
  const platform = (item && item.platform) || ''
  const externalId = item && item.externalId ? String(item.externalId) : ''
  const url = item && item.url ? String(item.url) : ''
  let sourceKey
  if (externalId) sourceKey = sourceType + ':' + (platform || 'unknown') + ':' + externalId
  else if (url) sourceKey = sourceType + ':url:' + url
  else sourceKey = sourceType + ':title:' + normalizeTitle(item && item.title)

  const fingerprint = fingerprintContent({
    title: item && item.title,
    content: (item && (item.content || item.summary || item.url)) || '',
  })
  return { sourceKey, fingerprint }
}

/**
 * 计划预览：给渲染层确认页「这套配置会排出什么节奏」。
 * @param {{ config: object, itemCount: number, now?: number, random?: () => number }} input
 */
function estimatePlan (input) {
  const config = (input && input.config) || {}
  const now = Number.isFinite(input && input.now) ? input.now : Date.now()
  const itemCount = Math.max(0, Number(input && input.itemCount) || 0)
  const targets = Array.isArray(config.publish && config.publish.targets) ? config.publish.targets : []
  const cadence = config.cadence || {}
  const startAtMs = config.publish && config.publish.mode === 'scheduled' && config.publish.startAt
    ? Date.parse(config.publish.startAt)
    : now
  const pacer = createPacer({
    startAtMs: Number.isFinite(startAtMs) ? startAtMs : now,
    minMinutes: Number(cadence.minMinutes) || 35,
    maxMinutes: Number(cadence.maxMinutes) || 40,
    random: input.random,
    scheduleRules: config.scheduleRules,
  })
  /** @type {Record<string, number[]>} */
  const slotsByTarget = {}
  for (const target of targets) {
    const key = resolveTargetKey(target)
    const slots = []
    for (let i = 0; i < itemCount; i++) slots.push(pacer.next(key, now).atMs)
    slotsByTarget[key] = slots
  }
  let first = Infinity
  let last = -Infinity
  for (const slots of Object.values(slotsByTarget)) {
    if (slots.length === 0) continue
    first = Math.min(first, slots[0])
    last = Math.max(last, slots[slots.length - 1])
  }
  return {
    slotsByTarget,
    totalMinutes: Number.isFinite(first) ? Math.round((last - first) / 60000) : 0,
  }
}

module.exports = {
  createPacer,
  resolveTargetKey,
  checkGuardrails,
  buildDedupeKeys,
  estimatePlan,
  MIN_MINUTES,
  MAX_MINUTES,
}
