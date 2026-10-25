// @ts-check
/**
 * explainer-remotion-text — 从**讲稿文本**里抽取渲染指令需要的结构化字段
 *
 * ## 为什么单独一个模块
 *
 * 「从文本里抽数字指标 / 对比两栏 / 图表数据点 / 画面上要显示的那句话」这四件事
 * **互相独立**、且被合成层多处调用 ⇒ 单放一个模块（**抽模块，不抬基线**）。
 *
 * ## 口径（与上游 `skills/core/remotion.md:47-63` 的字段表对齐）
 *
 * - `stat_card.stat` ⇒ 文本里的「数字 + 单位」（如 `+38%`、`45 万`）
 * - `comparison.leftLabel/rightLabel` ⇒ 「A vs B / A 对比 B」的两栏
 * - 图表类 cut 的 `chartData` ⇒ `label: value` 形式的数据点（**最多 6 个**）
 * - `cut.text` ⇒ **画面上要显示的字**（不是给生图用的画面描述）
 *
 * ⚠ 抽不出就**返回空/null**，由合成层降级为文字卡 ⇒ **不给半截图表**。
 */

'use strict'

const { asText } = require('./explainer-artifacts')

/** 从一段文本里抽「数字指标」（stat_card 的 stat 字段） */
function extractStat (text) {
  const source = asText(text)
  if (!source) return null
  const m = source.match(/([0-9][0-9,.]*)\s*(%|万|亿|倍|人|天|年|月|个|次|元)?/)
  if (!m) return null
  const value = m[1]
  const unit = m[2] || ''
  return { value, unit, label: source.slice(0, 40) }
}

/** 从一段文本里抽「对比卡的左右两栏」 */
function extractComparison (text) {
  const source = asText(text)
  const m = source.match(/([^，。；,\n]{1,18})\s*(?:vs|VS|对比|相比)\s*([^，。；,\n]{1,18})/)
  if (!m) return null
  return {
    leftLabel: m[1].trim(),
    rightLabel: m[2].trim(),
    leftValue: '',
    rightValue: '',
  }
}

/** 从一段文本里抽「图表数据点」（label + value） */
function extractChartData (text) {
  const source = asText(text)
  const points = []
  const re = /([^\s，。；,、:：]{1,12})\s*[:：]?\s*([0-9][0-9,.]*)\s*(%|万|亿|倍|人|天|年)?/g
  let m
  while ((m = re.exec(source)) !== null) {
    if (points.length >= 6) break
    points.push({ label: m[1], value: Number(String(m[2]).replace(/,/g, '')) })
  }
  return points
}

/**
 * 选「画面上要显示的那句话」。
 * 优先级：旁白首句（讲稿要点，最贴近「观众此刻看到的字」）→ 画面描述 → information_role。
 * ⚠ 旁白整段可能很长 ⇒ 取首句并截断到 28 字（可读的标题长度）。
 */
function pickDisplayText (narration, informationRole, description) {
  const spoken = asText(narration)
  if (spoken) {
    const firstSentence = spoken.split(/[。！？!?\n]/).map(s => s.trim()).filter(Boolean)[0] || spoken
    return firstSentence.length > 28 ? firstSentence.slice(0, 27) + '…' : firstSentence
  }
  return asText(description) || asText(informationRole)
}

module.exports = {
  extractStat,
  extractComparison,
  extractChartData,
  pickDisplayText,
}
