import { describe, it, expect } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { toFileUrl } from './file-url'
import { PROMPT_BLOCK_HEADINGS, checkPromptBlocks } from './auto-prompt-blocks'
import { resolveProgressCounters, resolveProgressMessageKeys } from './auto-progress-counters'

describe('toFileUrl（本地成品可播放 URL）', () => {
  it('Windows 盘符路径补足三斜杠并统一分隔符', () => {
    expect(toFileUrl('C:\\x\\shot_000.mp4')).toBe('file:///C:/x/shot_000.mp4')
    expect(toFileUrl('D:/Data/a b.mp4')).toBe('file:///D:/Data/a b.mp4')
  })

  it('POSIX 绝对路径两斜杠，UNC 路径保持两斜杠', () => {
    expect(toFileUrl('/tmp/film-engineering/final.mp4')).toBe('file:///tmp/film-engineering/final.mp4')
    expect(toFileUrl('//server/share/a.mp4')).toBe('file://server/share/a.mp4')
  })

  it('空/非字符串 → 空串（调用方据此不渲染 video 元素）', () => {
    expect(toFileUrl('')).toBe('')
    expect(toFileUrl('   ')).toBe('')
    expect(toFileUrl(null)).toBe('')
    expect(toFileUrl(undefined)).toBe('')
    expect(toFileUrl(123)).toBe('')
  })
})

describe('checkPromptBlocks（块结构非阻断提示）', () => {
  // 2026-10-19：块标题由 5 项补齐为 7 项（补 SCENE CONTEXT 与 STYLE，与后端 BLOCK_HEADINGS
  // 及随包方法论同源）。夹具随之补齐，否则「完整提示词」会被判缺块。
  const FULL = [
    'EXT. STREET - NIGHT',
    '[CHARACTER: ROKO] street kid',
    '',
    'SCENE CONTEXT',
    'EXACT 3 CHARACTERS',
    '',
    'GEO SPATIAL LAYOUT',
    'Alley left',
    '',
    'ACTION TIMING',
    '0-2s walk',
    '',
    'AUDIO',
    'rain',
    '',
    'CHARACTER ACTING',
    'tense',
    '',
    'STYLE',
    'Photoreal. NON-IP.',
    '',
    'POSITIVE CONSTRAINTS',
    '8K',
  ].join('\n')

  it('完整提示词 → missing 为空、ok=true、检出角色行', () => {
    const r = checkPromptBlocks(FULL)
    expect(r.ok).toBe(true)
    expect(r.missing).toEqual([])
    expect(r.present).toEqual([...PROMPT_BLOCK_HEADINGS])
    expect(r.hasCharacterLine).toBe(true)
  })

  it('缺块如实列出（顺序稳定），非阻断（只报不改）', () => {
    const r = checkPromptBlocks('EXT. X\n[CHARACTER: ROKO] walks.\n\nACTION TIMING\n0-2s')
    expect(r.ok).toBe(false)
    expect(r.missing).toEqual(['SCENE CONTEXT', 'GEO SPATIAL LAYOUT', 'AUDIO', 'CHARACTER ACTING', 'STYLE', 'POSITIVE CONSTRAINTS'])
    expect(r.hasCharacterLine).toBe(true)
  })

  it('块标题带括号后缀或结尾冒号时仍算成块（与后端 BLOCK_HEADING_RE 同形态）', () => {
    const r = checkPromptBlocks('GEO SPATIAL LAYOUT (locked across every CO shot):\nAlley left\nACTION TIMING:\n0-2s')
    expect(r.present).toContain('GEO SPATIAL LAYOUT')
    expect(r.present).toContain('ACTION TIMING')
  })

  it('正文里偶然出现块名不算成块（必须独占一行）', () => {
    const r = checkPromptBlocks('He talks about the AUDIO and GEO SPATIAL LAYOUT in one breath.\nGEO SPATIAL LAYOUT\nx')
    expect(r.present).toContain('GEO SPATIAL LAYOUT')
    expect(r.missing).toContain('AUDIO')
  })

  it('空提示词 → 全部缺块且无角色行（调用方该情形另有必填校验）', () => {
    const r = checkPromptBlocks('')
    expect(r.missing).toEqual([...PROMPT_BLOCK_HEADINGS])
    expect(r.hasCharacterLine).toBe(false)
    expect(checkPromptBlocks(null).ok).toBe(false)
  })
})

describe('块标题单一真源对账（前端复刻 vs 后端 BLOCK_HEADINGS）', () => {
  it('前端清单与 shot-library.js 的 BLOCK_HEADINGS 逐项一致', () => {
    const backendFile = path.join(
      path.dirname(fileURLToPath(import.meta.url)),
      '..', '..', '..', 'electron', 'services', 'film-engineering', 'shot-library.js',
    )
    const source = fs.readFileSync(backendFile, 'utf8')
    const block = source.match(/const BLOCK_HEADINGS = \[([\s\S]*?)\]/)
    expect(block, 'shot-library.js 必须仍以 BLOCK_HEADINGS 数组声明块标题（否则本锁失明）').toBeTruthy()
    const backendHeadings = [...block[1].matchAll(/'([^']+)'/g)].map((m) => m[1])
    expect(backendHeadings.length).toBeGreaterThanOrEqual(3)
    expect([...PROMPT_BLOCK_HEADINGS]).toEqual(backendHeadings)
  })
})

describe('resolveProgressCounters（出片进度：台账口径 vs 磁盘口径）', () => {
  // 2026-10-25：逐镜状态在**批次收口**时才回写 ⇒ 执行期间台账恒为 pending
  // ⇒ 面板只能显示 0/M ⇒ 显示口径必须取「台账 ∪ 磁盘」。
  it('磁盘已落盘、台账仍 pending ⇒ 显示口径取磁盘', () => {
    const r = resolveProgressCounters({ ledgerDone: 0, diskDone: 3 })
    expect(r.displayDone).toBe(3)
    expect(r.diskDone).toBe(3)
  })

  it('★ 收口口径**只认台账**：磁盘有片 ≠ 该镜成功 ⇒ 不得用它提前收口', () => {
    const r = resolveProgressCounters({ ledgerDone: 0, diskDone: 3 })
    expect(r.closeDone).toBe(0)
    // 台账 3、磁盘 5（残留）⇒ 收口仍认 3
    const r2 = resolveProgressCounters({ ledgerDone: 3, diskDone: 5 })
    expect(r2.closeDone).toBe(3)
    expect(r2.displayDone).toBe(5)
  })

  it('收口后（台账 3、磁盘 3）⇒ 两个口径一致', () => {
    const r = resolveProgressCounters({ ledgerDone: 3, diskDone: 3 })
    expect(r.displayDone).toBe(3)
    expect(r.closeDone).toBe(3)
  })

  it('非法输入归 0（不报 NaN、不谎报进度）', () => {
    expect(resolveProgressCounters().displayDone).toBe(0)
    expect(resolveProgressCounters({}).closeDone).toBe(0)
    expect(resolveProgressCounters({ ledgerDone: null, diskDone: undefined }).displayDone).toBe(0)
    expect(resolveProgressCounters({ ledgerDone: 'x', diskDone: 'y' }).displayDone).toBe(0)
  })
})

// ===== A33：执行中 vs 已收口的提示语义（PRD §六 A33）=====
//
// ⭐ 为什么这条必须与 `resolveProgressCounters` 同居一文件、同一真源：
//   两个口径（displayDone / closeDone）答的是「数字是多少」；
//   本条答的是「这句话能不能说」——**执行中说「已完成」是在说谎**
//   （执行期的 N 来自磁盘口径，而「磁盘有片 ≠ 该镜成功」）。
//   ⇒ 两者必须由**同一个**模块产出，否则会出现「数字用磁盘、文案说完成」的口径分裂。

describe('resolveProgressMessageKeys（执行中「正在落盘」 vs 已收口「已完成 N/M」）', () => {
  it('running=true ⇒ 执行中：两处都用 landing 文案，**不说「已完成」**', () => {
    const r = resolveProgressMessageKeys({ running: true, done: 3, total: 12 })
    expect(r.landing).toBe(true)
    expect(r.summaryKey).toBe('filmEngineering.auto.landingProgress')
    expect(r.stageKey).toBe('filmEngineering.auto.landingProgress')
    // ⭐ 核心语义：执行中不得出现「已完成」口径的 key
    expect(r.summaryKey).not.toBe('filmEngineering.auto.runSummary')
    expect(r.stageKey).not.toBe('filmEngineering.auto.stageShotProgress')
  })

  it('running=false ⇒ 已收口：沿用既有 key（文案形状不变）', () => {
    const r = resolveProgressMessageKeys({ running: false, done: 12, total: 12 })
    expect(r.landing).toBe(false)
    expect(r.summaryKey).toBe('filmEngineering.auto.runSummary')
    expect(r.stageKey).toBe('filmEngineering.auto.stageShotProgress')
  })

  it('⚠ running 缺失 / 非布尔 ⇒ 保守判「不在跑」（不谎称正在落盘）', () => {
    // 后端字段缺失、undefined、null、字符串 'true'、数字 1 ⇒ 一律按「不在跑」处理
    for (const v of [undefined, null, 'true', 1, 0, false]) {
      const r = resolveProgressMessageKeys({ running: v, done: 3, total: 12 })
      expect(r.landing).toBe(false)
      expect(r.summaryKey).toBe('filmEngineering.auto.runSummary')
    }
    // 连 input 都没有 ⇒ 不得抛
    expect(resolveProgressMessageKeys().landing).toBe(false)
    expect(resolveProgressMessageKeys({}).summaryKey).toBe('filmEngineering.auto.runSummary')
  })

  it('params 恒带 done/total（landing 文案不含占位符 ⇒ 多传无害）', () => {
    const r = resolveProgressMessageKeys({ running: true, done: 5, total: 12 })
    expect(r.params).toEqual({ done: 5, total: 12 })
    const r2 = resolveProgressMessageKeys({ running: false, done: 'x', total: null })
    expect(r2.params).toEqual({ done: 0, total: 0 })   // 非法值归零，不把 NaN 传进 UI
  })
})

// ===== A33 补强：提示**文案本体**的机械锁（复核 S1）=====
//
// ⚠ 为什么必须加这一条：面板渲染出的文案是 `t(key, params)` 的结果，
//   而 `key` 在 `auto-progress-counters.js` 里是**裸字符串**⇒ 仓内的 locale 键扫描
//   （只扫 `t('...')` 调用点）**看不见它** ⇒ ⇒ **把 zh.js + en.js 里的 `landingProgress`
//   两条同时删掉，vitest 仍全绿、`--keys` 仍绿、`--symmetry` 仍绿** ⇒ 那就是「文案没了但没人发现」。
// ⇒ ⇒ 本条直接读 **locale 文件本体**，断言那条**中文句子**与**英文句子**逐字在位
// ⇒ ⇒ 删任一条 ⇒ 本条立刻红 ⇒ 文案不会在无人察觉的情况下消失。

describe('A33 提示文案本体（locale 文件级机械锁）', () => {
  const localeDir = path.join(
    path.dirname(fileURLToPath(import.meta.url)),
    '..', '..', 'locales', 'film-engineering',
  )
  const readLocale = (name) => fs.readFileSync(path.join(localeDir, name), 'utf8')

  it('zh/en 都必须有 landingProgress，且**中文句子**逐字一致（删掉任一条即红）', () => {
    const zh = readLocale('zh.js')
    const en = readLocale('en.js')
    // ⭐ 断言的是**文案本体**（不是 key 的存在性）⇒ 键在但值被清空/改写也会红
    expect(zh).toMatch(/"landingProgress":\s*"产物正在落盘，进度以磁盘为准"/)
    expect(en).toMatch(/"landingProgress":\s*"Artifacts are landing; progress is disk-based"/)
    // ⚠ 文案**不含 {done}/{total}** ⇒ 执行期不承诺具体数字（数字还在涨）
    expect(zh).not.toMatch(/"landingProgress":\s*"[^"]*\{done\}/)
    expect(en).not.toMatch(/"landingProgress":\s*"[^"]*\{done\}/)
  })
})
