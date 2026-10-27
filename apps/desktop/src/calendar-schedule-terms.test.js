'use strict'
/**
 * 「定时 / 排期」判归的一致性与取证锁（UX 审计 3.1 的遗留收口 —— 并更正那条登记本身）
 *
 * 上一批（`openspec/records/ux-audit-glossary-term-groups.md`，词典 §一）把
 * `scheduleDispatchFailed` 登记为混用，理由写的是"它的键与上下文都属批量排期那一族"。
 * **那个取证是错的**：该键的唯一消费者是 `App.vue` 里主进程调度器的逐任务事件
 * `onSchedulerDispatchFailed`（载荷只有 `{platform, reason}`，没有批次计数），
 * 按词典自己的判据（`定时` = 单条内容的发送时刻；`排期` = 一批任务在日历上占位）
 * 它该走「定时」侧，而不是「排期」侧。
 *
 * 所以真正的缺陷不是首词，而是**同一句里首尾分属两侧**：
 * 「**定时**发布未能发出… 请重新**排期**」——用户被告知"到点没发出去"，
 * 又被建议去做一个批次动作。本锁把这条按**位置**钉住（同一值内不得同时出现两侧的词），
 * 而不是建"全仓扫『定时』即红"的宽判据 —— 后者会误伤机制语义下的正确用法。
 */
const fs = require('node:fs')
const path = require('node:path')

const SRC = path.resolve(__dirname)
function repoFile (rel) {
  let dir = SRC
  for (let i = 0; i < 8; i++) {
    const p = path.join(dir, rel)
    if (fs.existsSync(p)) return p
    const up = path.dirname(dir)
    if (up === dir) break
    dir = up
  }
  throw new Error('自本文件上溯 8 级找不到 ' + rel + ' —— 判据无从测量，不得静默跳过')
}
const ZH = fs.readFileSync(repoFile('apps/desktop/src/locales/calendar-page/zh.js'), 'utf8')
const EN = fs.readFileSync(repoFile('apps/desktop/src/locales/calendar-page/en.js'), 'utf8')
const GLOSSARY = fs.readFileSync(repoFile('01-docs/i18n-glossary.md'), 'utf8')
const APP = fs.readFileSync(repoFile('apps/desktop/src/App.vue'), 'utf8')

const value = (src, key) => {
  const m = new RegExp("^\\s*" + key + ":\\s*'((?:[^'\\\\]|\\\\.)*)'", 'm').exec(src)
  return m ? m[1] : null
}
const KEY = 'scheduleDispatchFailed'

describe('「定时/排期」判归：混用点收口 + 取证更正', () => {
  it('取证前提：该键确实由调度器的**逐任务**事件消费（不是批量排期 UI）', () => {
    expect(APP).toContain('onSchedulerDispatchFailed')
    expect(APP).toMatch(/scheduleDispatchFailed/)
  })

  it('zh 文案不得在同一句里同时使用两侧的词（首尾分属「定时」与「排期」即红）', () => {
    const v = value(ZH, KEY)
    expect(v, `找不到键 ${KEY}`).not.toBeNull()
    const hasScheduleWord = /定时/.test(v)
    const hasBatchWord = /排期/.test(v)
    expect(hasScheduleWord && hasBatchWord,
      '同句混用未收口：' + v).toBe(false)
    // 且不能两侧都不写——"到点未能发出"这类无主语写法会让用户不知道该去哪补救
    expect(hasScheduleWord || hasBatchWord, '收口时把词删光了，等于没回答"这是什么对象"：' + v).toBe(true)
  })

  it('en 同一口径：不得同时出现 scheduled publish/task 与 "schedule it again"', () => {
    const v = value(EN, KEY)
    expect(v, `找不到键 ${KEY}`).not.toBeNull()
    const past = /scheduled (publish|task)/i.test(v)
    const again = /schedule it again/i.test(v)
    expect(past && again, 'en 侧同句混用未收口：' + v).toBe(false)
    expect(past || again).toBe(true)
  })

  it('占位符与"已标记失败"这条事实不得在改词时被吃掉（可补救性信息的载体）', () => {
    const zh = value(ZH, KEY), en = value(EN, KEY)
    for (const [side, v] of [['zh', zh], ['en', en]]) {
      expect(v, side).toContain('{platform}')
      expect(v, side).toContain('{reason}')
    }
    expect(zh).toMatch(/失败/)
  })

  it('词典必须把这条的取证改指**消费者**，并保留两个正例（防止下一个会话又把判据猜反）', () => {
    expect(GLOSSARY).toMatch(/onSchedulerDispatchFailed|App\.vue/)
    expect(GLOSSARY).toContain('cancelScheduleTitle')
    expect(GLOSSARY).toContain('scheduledBatchTitle')
  })
})
