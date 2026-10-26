// @ts-check
'use strict'
/**
 * shot-effective-seconds.js —— 逐镜镜长的**唯一决策点**
 *
 * ## 为什么有这个模块（PRD-FILM-AUTO-LONGFORM §3.2.5.4，M0′.3）
 *
 * 规划期按每镜**台词**算出了逐镜时长（`durationMs` / `durationSec` / `durationRawSec`），
 * 但**出片一直用用户选的整档**（`shot.seconds`）⇒ 台词短的镜被撑成整档 ⇒ 后半段是空场。
 * ⇒ 本模块把「出片该用几秒」这件事收成**一个**决策点：
 * 规划期算一次，出片期读一次，**四处调用点同一口径**。
 *
 * ## ⭐ 一个必须说清的坑：`durationSec` **不能**直接当镜长
 *
 * `durationSec` 的**语义随来源变**：
 *
 * | `durationSource` | `durationSec` 是什么 | 能直接给 `pickFilmFrameCount` 吗 |
 * |---|---|---|
 * | `formula` / `tier` | **已吸附**的档位值（5/8/10） | ✅ 能 |
 * | `tts` / `user` | **连续值**（如 5.3） | ❌ **不能** |
 *
 * ⇒ 连续值交给 `pickFilmFrameCount` 会落进「≤8 ⇒ 201 帧 ⇒ **8 秒**」
 * ⇒ **镜长被放大**（比原状更糟）。
 * ⇒ **统一从 `rawSec` 吸附** ⇒ 与来源无关 ⇒ 结果恒为**可选档位之一**（5/8/10）
 * ⇒ 与 `pickFilmFrameCount` 的档位边界精确对齐（5→121 帧 / 8→201 帧 / 10→241 帧）。
 * ⚠ 吸附容差常量与 `snapToTier` **同源**（同一模块导出）⇒ 不另写字面量。
 *
 * ## 回落链（存量零影响）
 *
 * `effectiveSeconds → shot.seconds → 兜底` ⇒ 存量项目（没有 `effectiveSeconds`）
 * **出片行为逐字不变** ⇒ 本模块是**纯增量**。
 */

const { resolveShotDurationMs, snapToTier, DEFAULT_TIERS } = require('./shot-duration')

/**
 * 档位表解析（可注入；缺省用 `DEFAULT_TIERS`）。
 * @param {unknown} input
 * @returns {number[]} 升序去噪后的档位表
 */
function resolveDurationTiers (input) {
  return Array.isArray(input) && input.length > 0
    ? input.map(Number).filter((n) => Number.isFinite(n) && n > 0).sort((a, b) => a - b)
    : DEFAULT_TIERS.slice()
}

/**
 * 规划期：算一镜的时长来源链解析结果 + **出片要消费的镜长**。
 *
 * @param {{text?: string, emotion?: string}} beat 本镜文案与情绪档
 * @param {{tiers: number[], maxSec: number, defaultSec: number, capacitySec: number}} opts
 *   `capacitySec` = 容量基准 = **用户所选的单镜档位**（不是物理上限）
 * @returns {{duration: object, effectiveSeconds: number}}
 */
function resolveShotDurations (beat, opts) {
  const o = opts || {}
  const tiers = Array.isArray(o.tiers) && o.tiers.length > 0 ? o.tiers : DEFAULT_TIERS.slice()
  const maxSec = Number.isFinite(Number(o.maxSec)) ? Number(o.maxSec) : Math.max(...tiers)
  const defaultSec = Number.isFinite(Number(o.defaultSec)) ? Number(o.defaultSec) : tiers[0]
  const capacitySec = Number.isFinite(Number(o.capacitySec)) ? Number(o.capacitySec) : defaultSec

  const duration = resolveShotDurationMs(
    { text: beat && beat.text, emotion: beat && beat.emotion },
    {
      tiers,
      maxSec,
      defaultSec,
      capacitySec,
      // ⚠ 固定口径（不是调用方可选）：beat.text 常是纯动作描述 ⇒ 没有引号就不走 formula，
      //   否则会给动作配语速、让 120 字的无台词动作镜误触发「必须拆解台词」（v7 对抗评审第二轮 i4）。
      requireQuotedDialogue: true,
    },
  )

  return { duration, effectiveSeconds: computeEffectiveSeconds(duration, tiers, defaultSec) }
}

/**
 * 由来源链的解析结果算出「吸附到可选档位」的逐镜镜长。
 *
 * @param {object} duration `resolveShotDurationMs` 的返回值
 * @param {number[]} tiers 可选档位表
 * @param {number} fallbackSec 没有解析结果时的兜底（= 用户所选档位）
 * @returns {number} 可选档位之一
 */
function computeEffectiveSeconds (duration, tiers, fallbackSec) {
  const d = duration || {}
  const list = Array.isArray(tiers) && tiers.length > 0 ? tiers : DEFAULT_TIERS.slice()
  const fallback = Number.isFinite(Number(fallbackSec)) && Number(fallbackSec) > 0
    ? Number(fallbackSec)
    : list[0]
  const raw = d.ok && Number.isFinite(Number(d.rawSec)) ? Number(d.rawSec) : null
  // 没有原始推算值（tier 兜底分支）⇒ 档位值本身就是吸附结果
  if (raw === null) {
    const parsed = d.ok ? Number(d.durationSec) : NaN
    return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback
  }
  return snapToTier(raw, list).sec
}

/**
 * 出片期：取该镜**实际要用的镜长**（回落链的唯一真源）。
 *
 * 回落链：`effectiveSeconds → shot.seconds → 兜底`
 * ⇒ 存量项目（没有 `effectiveSeconds`）行为逐字不变。
 *
 * @param {{effectiveSeconds?: number, seconds?: number}} [shot]
 * @param {number} [fallbackSec] 兜底镜长（自动模式 = 全局秒数；生产路径 = stage 级秒数）
 * @returns {number}
 */
function resolveShotSeconds (shot, fallbackSec) {
  const s = shot || {}
  const candidates = [s.effectiveSeconds, s.seconds, fallbackSec, 5]
  for (const c of candidates) {
    const n = Number(c)
    if (Number.isFinite(n) && n > 0) return n
  }
  return 5
}

module.exports = {
  resolveDurationTiers,
  resolveShotDurations,
  computeEffectiveSeconds,
  resolveShotSeconds,
}
