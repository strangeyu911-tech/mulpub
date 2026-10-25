import { describe, it, expect } from 'vitest'
import { existsSync, readFileSync } from 'node:fs'
import path from 'node:path'

import {
  CSV_HEADER,
  TEMPLATE_ROW,
  buildConfirmSummary,
  buildCsv,
  buildCsvFromResult,
  csvCell,
  copyTextWithFallback,
  expiresAtMustBeFuture,
  expiresAtToIso,
  isPastDate,
  runIssueFlow,
} from './redemption-code-utils'

/**
 * 运营中心「兑换码签发」的纯逻辑契约。
 *
 * 覆盖：CSV 转义与导出内容、有效期归一化（UTC）与「只能选未来」、
 * 签发前二次确认的摘要文案（**空字段不得出现在摘要里**）。
 */
describe('ops/兑换码签发纯逻辑', () => {
  it('csvCell：含逗号 / 引号 / 换行必须转义（否则整张表串列）', () => {
    expect(csvCell('普通')).toBe('普通')
    expect(csvCell(null)).toBe('')
    expect(csvCell(undefined)).toBe('')
    expect(csvCell('渠道A, 渠道B')).toBe('"渠道A, 渠道B"')
    expect(csvCell('说"你好"')).toBe('"说""你好"""')
    expect(csvCell('第一行\n第二行')).toBe('"第一行\n第二行"')
  })

  it('buildCsv：表头 + 每个码一行，且列来源是**签发结果**而不是当前表单', () => {
    const csv = buildCsv({
      codes: ['ABCD-EFGH-JKMN', 'WXYZ-2345-6789'],
      issuedTo: '渠道A',
      batch: 'B-1',
      plan: 'pro',
      planLabels: { standard: '标准版', pro: '专业版' },
      durationDays: 30,
      expiresAt: '2027-01-01T00:00:00.000Z',
    })
    const lines = csv.split('\r\n')
    expect(lines[0]).toBe(CSV_HEADER.join(','))
    expect(lines).toHaveLength(3)
    expect(lines[1]).toBe('ABCD-EFGH-JKMN,渠道A,B-1,专业版,30,2027-01-01T00:00:00.000Z')
    expect(lines[2]).toContain('WXYZ-2345-6789')
  })

  it('buildCsv：没有码时只有表头（不得产出「undefined」行）', () => {
    expect(buildCsv({ codes: [] })).toBe(CSV_HEADER.join(','))
    expect(buildCsv({})).toBe(CSV_HEADER.join(','))
  })

  it('TEMPLATE_ROW：与表头一致（运营拿去当模板行）', () => {
    expect(TEMPLATE_ROW).toBe(CSV_HEADER.join(','))
    expect(TEMPLATE_ROW).toContain('兑换码')
    expect(TEMPLATE_ROW).toContain('发放对象')
  })

  it('expiresAtToIso：统一转 UTC ISO；空值 / 非法值 ⇒ undefined（不是空串）', () => {
    const d = new Date('2027-01-01T00:00:00.000Z')
    expect(expiresAtToIso(d)).toBe('2027-01-01T00:00:00.000Z')
    expect(expiresAtToIso(null)).toBeUndefined()
    expect(expiresAtToIso(undefined)).toBeUndefined()
    expect(expiresAtToIso('')).toBeUndefined()
    expect(expiresAtToIso('not-a-date')).toBeUndefined()
  })

  it('isPastDate：今天之前不可选；今天可选', () => {
    const yesterday = new Date()
    yesterday.setDate(yesterday.getDate() - 1)
    expect(isPastDate(yesterday)).toBe(true)
    const today = new Date()
    expect(isPastDate(today)).toBe(false)
    expect(isPastDate(null)).toBe(false)
  })

  it('expiresAtMustBeFuture：过期时间必须晚于当前时刻（空值不拦）', () => {
    expect(expiresAtMustBeFuture(undefined)).toBe(false)
    expect(expiresAtMustBeFuture('')).toBe(false)
    expect(expiresAtMustBeFuture(new Date(Date.now() - 60000).toISOString())).toBe(true)
    expect(expiresAtMustBeFuture(new Date(Date.now() + 3600000).toISOString())).toBe(false)
  })

  it('buildConfirmSummary：必带三项；空字段不出现（不给「发放对象：（空）」这种噪音行）', () => {
    const lines = buildConfirmSummary({
      plan: 'pro',
      planLabels: { standard: '标准版', pro: '专业版' },
      durationDays: 90,
      count: 10,
      issuedTo: '',
      batch: '',
      expiresAt: '',
    })
    expect(lines).toEqual(['套餐：专业版', '会员时长：90 天', '数量：10 个'])
    expect(lines.join('\n')).not.toContain('发放对象')
    expect(lines.join('\n')).not.toContain('批次号')

    const full = buildConfirmSummary({
      plan: 'standard',
      planLabels: { standard: '标准版', pro: '专业版' },
      durationDays: 30,
      count: 5,
      issuedTo: '渠道A',
      batch: 'B-9',
      expiresAt: '2027-01-01T00:00:00.000Z',
      expiresAtText: '2027/1/1 08:00:00',
    })
    expect(full).toContain('套餐：标准版')
    expect(full).toContain('发放对象：渠道A')
    expect(full).toContain('批次号：B-9')
    expect(full).toContain('兑换码过期：2027/1/1 08:00:00')
  })
})

/**
 * 「列来源 = 签发结果」这条规则的结构性锁。
 *
 * ⚠️ 为什么不只测 `buildCsv`：`buildCsv` 的参数形状是自由的 ⇒ 谁都可以把**表单值**
 * 传进来（这正是本仓想防的错：结果弹窗打开时表单可能已改过 ⇒ 导出一张
 * 「看起来对、其实不是这批码」的表）。⇒ 规则必须钉在一个**只接受结果**的入口上。
 */
describe('ops/CSV 列来源只能是签发结果', () => {
  it('buildCsvFromResult：列值全部取自结果对象', () => {
    const csv = buildCsvFromResult(
      { issuedTo: '渠道A', batch: 'B-1', plan: 'pro', durationDays: 30, expiresAt: '2027-01-01T00:00:00.000Z' },
      { codes: ['ABCD-EFGH-JKMN'], planLabels: { standard: '标准版', pro: '专业版' } }
    )
    const lines = csv.split('\r\n')
    expect(lines[0]).toBe(CSV_HEADER.join(','))
    expect(lines[1]).toBe('ABCD-EFGH-JKMN,渠道A,B-1,专业版,30,2027-01-01T00:00:00.000Z')
  })

  it('buildCsvFromResult：结果里没有的字段 ⇒ 空列（不回落成表单值）', () => {
    const csv = buildCsvFromResult({ batch: 'B-2' }, { codes: ['ABCD-EFGH-JKMN'] })
    const lines = csv.split('\r\n')
    expect(lines[1]).toBe('ABCD-EFGH-JKMN,,B-2,,,')
  })

  it('buildCsvFromResult：结果里**没有**该列时就是空列（哪怕结果里混进了表单字段）', () => {
    // ⚠️ 这一条是**变异测试补出来的**：原先的用例只测了「结果里有值 ⇒ 用结果的值」，
    // 于是「没有值时回落到表单值」这种改法**测不出来**（注入后仍全绿）。
    // ⇒ 判据补成：**缺列就是空列**，绝不从结果对象的其它字段里「猜」一个出来。
    const csv = buildCsvFromResult(
      { formIssuedTo: '表单里的渠道', formBatch: 'FORM-9', issuedTo: '', batch: '' },
      { codes: ['ABCD-EFGH-JKMN'] }
    )
    const lines = csv.split('\r\n')
    // 6 列 ⇒ 5 个逗号
    expect(lines[1]).toBe('ABCD-EFGH-JKMN,,,,,')
    expect(csv).not.toContain('表单里的渠道')
    expect(csv).not.toContain('FORM-9')
  })

  it('buildCsvFromResult：结果为 undefined ⇒ 不抛、产出只有表头', () => {
    const csv = buildCsvFromResult(undefined, { codes: [] })
    expect(csv).toBe(CSV_HEADER.join(','))
  })
})

/**
 * 视图层的**形状锁**（源码断言，不是行为测试）。
 *
 * ⚠️ 边界声明（2026-10-25 独立复评 F10 后订正）：
 * 上一版这里写的是「ops-center/frontend 没有组件测试设施（无 @vue/test-utils、无 jsdom 环境）」——
 * **那句话本身是错的**：`jsdom` 一直在 ops-center/frontend 的 devDependencies 里，
 * 而 `@vue/test-utils` 可由根 `node_modules` 向上解析（`vitest.config.js` 也明文写了
 * 「需要 DOM 的文件在顶部用 `// @vitest-environment jsdom` docblock 单独声明」）。
 *
 * ⇒ 但**本文件仍用形状锁**，原因是另一条：**要测的规则已从视图里抽成了可注入依赖的纯函数**
 * （`runIssueFlow` / `copyTextWithFallback`，见上面那组行为用例）⇒
 * 行为由**行为用例**覆盖；这一组只负责锁住**模板接线**（date-picker 真的绑了 `isPastDate`、
 * 签发按钮真的走 `confirmGenerate`、结果区真的有四个入口）。
 * ⇒ 形状锁**不能替代**行为测试，但两者**不重叠**：这里钉接线，上面钉行为。
 */
describe('ops/RedemptionCodes.vue 形状锁', () => {
  // ⚠️ **不能**用 `new URL('./RedemptionCodes.vue', import.meta.url)`：
  // vitest 4 处理源文件时 `import.meta.url` **不是 file:// 协议**
  // ⇒ `readFileSync` 直接抛「The URL must be of scheme file」
  // ⇒ **整份测试文件加载失败、0 个用例被执行**（2026-10-25 独立复评实测：
  // `npm test` 读数 16 passed / 1 failed（failed = 本文件加载失败），
  // 而失败的形态是「no tests」⇒ 本文件里的 18 个用例**一个都没跑**）。
  // ⇒ 改成按 cwd 解析，并给出两个候选位置（从包目录跑 / 从仓根跑）。
  const vueCandidates = [
    path.join(process.cwd(), 'src/views/RedemptionCodes.vue'),
    path.join(process.cwd(), 'ops-center/frontend/src/views/RedemptionCodes.vue'),
  ]
  const vuePath = vueCandidates.find((p) => existsSync(p))
  if (!vuePath) {
    throw new Error(`找不到 RedemptionCodes.vue（cwd=${process.cwd()}，候选：${vueCandidates.join(' / ')}）`)
  }
  const source = readFileSync(vuePath, 'utf8')

  it('有效期用 date-picker + 禁过去日期（不是手填 ISO 串）', () => {
    expect(source).toContain('el-date-picker')
    expect(source).toContain(':disabled-date="isPastDate"')
    expect(source).not.toMatch(/el-input[^>]*v-model="form\.expires_at"/)
  })

  it('签发按钮走二次确认（不是直接 generate），且确认流程走可测的编排函数', () => {
    expect(source).toContain('@click="confirmGenerate"')
    expect(source).not.toMatch(/<el-button[^>]*@click="generate"/)
    // ⚠️ 次序与中止条件在 `runIssueFlow` 里（由**行为**用例覆盖：
    // 过期时间不合法 ⇒ 不进确认框；运营点「再看看」⇒ 一个请求都不发）。
    expect(source).toContain('runIssueFlow')
    expect(source).toContain('submit: () => generate()')
  })

  it('结果区有四个复制/导出入口', () => {
    for (const fn of ['copyAllCodes', 'copyCsv', 'copyTemplateRow', 'exportCsvFile']) {
      expect(source).toContain(`@click="${fn}"`)
      expect(source).toContain(`function ${fn} (`)
    }
  })

  it('剪贴板降级规则**已抽到可测的纯函数**（视图只转发 + 出文案）', () => {
    // ⚠️ 规则本体在 `redemption-code-utils.js` 的 `copyTextWithFallback` 里，
    // 由**行为**用例覆盖（非安全上下文 ⇒ 走 execCommand 且真的复制成功）。
    // 这一条只锁**接线**：视图必须转发给那个函数，且失败不静默。
    expect(source).toContain('copyTextWithFallback')
    expect(source).toContain('复制失败，请手动选中文本复制')
    expect(source).toContain('没有可复制的内容')
    // 视图里**不得**再自己实现一份降级（两份口径必然漂移）
    expect(source).not.toContain("document.execCommand('copy')")
    expect(source).not.toContain('window.isSecureContext')
  })

  it('补足失败（REDEEM_BATCH_INCOMPLETE）⇒ 结果里带上本次请求的参数（CSV 不丢发放对象/套餐列）', () => {
    // 服务端的 detail 不含发放对象/套餐/时长/过期 ⇒ 只用它 ⇒ 导出的 CSV 少两列
    expect(source).toContain('REDEEM_BATCH_INCOMPLETE')
    expect(source).toMatch(/issuedTo:\s*form\.issuedTo/)
    expect(source).toMatch(/plan:\s*form\.plan/)
    expect(source).toMatch(/durationDays:\s*form\.durationDays/)
  })

  it('CSV 列来源走 buildCsvFromResult（不是把表单值塞进 buildCsv）', () => {
    expect(source).toContain('buildCsvFromResult')
    expect(source).not.toMatch(/buildCsv\(\{[\s\S]{0,400}form\./)
  })
})

/**
 * **行为**用例：签发流程与剪贴板降级（PRD §15.10 的 B8 / B9 / B11）。
 *
 * ⚠️ 为什么这三组不是形状锁（2026-10-25 独立复评 F10 实测）：
 * 原先 B8/B9/B11 只有「源码里包含某个字符串」的形状锁 ⇒ **证明不了**
 *   ① 过期时间不合法时**有没有**真的不进确认框；
 *   ② 运营点「再看看」后**有没有**真的一个请求都不发；
 *   ③ 非安全上下文下**有没有**真的复制成功。
 * 形状锁最典型的漏网形态：把 `@click="confirmGenerate"` 留在模板里、但让它直接调 submit
 * ⇒ 形状锁照样绿，而「取消后仍然发了请求」已经发生。
 *
 * ⇒ 规则与降级路径抽成**依赖注入**的纯函数（`runIssueFlow` / `copyTextWithFallback`），
 * 下面三组直接测**行为**。
 */
describe('ops/签发流程行为（B8 / B9）', () => {
  it('B9：运营点「再看看」（确认框被拒）⇒ **一个请求都不发**', async () => {
    let submitted = 0
    const outcome = await runIssueFlow({
      summary: ['套餐：标准版'],
      validate: () => null,
      confirm: async () => { throw new Error('cancel') },
      submit: async () => { submitted += 1; return { ok: true } },
    })
    expect(submitted).toBe(0)
    expect(outcome.ok).toBe(false)
    expect(outcome.stage).toBe('confirm')
    expect(outcome.cancelled).toBe(true)
  })

  it('B9：确认通过 ⇒ 恰好提交一次', async () => {
    let submitted = 0
    const outcome = await runIssueFlow({
      summary: ['套餐：标准版'],
      validate: () => null,
      confirm: async () => 'confirmed',
      submit: async () => { submitted += 1; return { generated: 3 } },
    })
    expect(submitted).toBe(1)
    expect(outcome.ok).toBe(true)
    expect(outcome.stage).toBe('submit')
    expect(outcome.result).toEqual({ generated: 3 })
  })

  it('B8：过期时间不合法 ⇒ **不进确认框、更不发请求**（错误文案带出来给视图就地提示）', async () => {
    let confirmed = 0
    let submitted = 0
    const outcome = await runIssueFlow({
      summary: ['套餐：标准版'],
      validate: () => '兑换码过期时间必须晚于当前时间',
      confirm: async () => { confirmed += 1 },
      submit: async () => { submitted += 1 },
    })
    expect(confirmed).toBe(0)
    expect(submitted).toBe(0)
    expect(outcome.ok).toBe(false)
    expect(outcome.stage).toBe('validate')
    expect(outcome.error).toBe('兑换码过期时间必须晚于当前时间')
  })
})

describe('ops/剪贴板降级行为（B11）', () => {
  it('安全上下文 ⇒ 走 navigator.clipboard', async () => {
    const written = []
    const res = await copyTextWithFallback('ABCD-EFGH-JKMN', {
      clipboard: { writeText: async (v) => { written.push(v) } },
      isSecureContext: true,
    })
    expect(res.ok).toBe(true)
    expect(res.via).toBe('clipboard')
    expect(written).toEqual(['ABCD-EFGH-JKMN'])
  })

  it('非安全上下文（局域网 http 部署）⇒ **降级到 execCommand 且真的复制成功**', async () => {
    const written = []
    let execCalled = false
    const doc = {
      createElement: () => ({
        value: '',
        style: {},
        setAttribute: () => {},
        select: () => {},
      }),
      body: { appendChild: () => {}, removeChild: () => {} },
    }
    const res = await copyTextWithFallback('ABCD-EFGH-JKMN', {
      clipboard: { writeText: async (v) => { written.push(v) } },
      isSecureContext: false,
      document: doc,
      execCommand: () => { execCalled = true; return true },
    })
    expect(res.ok).toBe(true)
    expect(res.via).toBe('execCommand')
    expect(execCalled).toBe(true)
    expect(written).toEqual([])   // 降级时**不得**同时走 clipboard
  })

  it('两条路都失败 ⇒ 明确失败（不静默）', async () => {
    const res = await copyTextWithFallback('ABCD-EFGH-JKMN', {
      clipboard: null,
      isSecureContext: false,
      document: {
        createElement: () => ({ value: '', style: {}, setAttribute: () => {}, select: () => {} }),
        body: { appendChild: () => {}, removeChild: () => {} },
      },
      execCommand: () => false,
    })
    expect(res.ok).toBe(false)
    expect(res.reason).toBe('exec-failed')
  })

  it('没有可复制内容 ⇒ empty（视图据此提示「没有可复制的内容」）', async () => {
    const res = await copyTextWithFallback('')
    expect(res.ok).toBe(false)
    expect(res.reason).toBe('empty')
  })
})

describe('ops/CSV 的「兑换码过期时间」列必须真的有值（F2）', () => {
  it('签发结果带 expiresAt ⇒ CSV 末列不得为空', () => {
    const csv = buildCsvFromResult(
      { batch: 'B-1', issuedTo: '渠道A', plan: 'pro', durationDays: 30, expiresAt: '2027-01-01T00:00:00.000Z' },
      { codes: ['ABCD-EFGH-JKMN'], planLabels: { standard: '标准版', pro: '专业版' } }
    )
    const rows = csv.split('\r\n')
    const last = rows[1].split(',')
    expect(last.length).toBe(CSV_HEADER.length)
    expect(last[last.length - 1]).toBe('2027-01-01T00:00:00.000Z')
  })

  it('签发结果**没有** expiresAt（长期有效）⇒ 末列为空，但列本身必须在', () => {
    const csv = buildCsvFromResult(
      { batch: 'B-1', issuedTo: '', plan: 'standard', durationDays: 30 },
      { codes: ['ABCD-EFGH-JKMN'], planLabels: { standard: '标准版' } }
    )
    const rows = csv.split('\r\n')
    expect(rows[0]).toBe(CSV_HEADER.join(','))
    expect(rows[1].split(',').length).toBe(CSV_HEADER.length)
  })
})
