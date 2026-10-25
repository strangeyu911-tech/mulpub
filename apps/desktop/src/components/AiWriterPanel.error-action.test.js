import { describe, it, expect, vi, beforeEach } from 'vitest'
import { mount } from '@vue/test-utils'
import fs from 'node:fs'
import path from 'node:path'
import { nextTick } from 'vue'

// 阶段 1.10 的第二半（1.10b）：错误卡片要能一键直达，而不是让用户照文案自己找路。
// 审计点名的是 `userErrors.LLM_KEY_MISSING` 里的「请参考使用说明」。实测：
//   · 该错误**已经**带稳定 errorCode 走到渲染层（formatUserError 返回 {errorCode, message, matched}），
//     但 AiWriterPanel 只取 `.message`，errorCode 被丢弃 ⇒ 缺的是动作位，不是新文案。
//   · 面板里**已有**一条到达模型设置的路径：配置横幅的 `goToProviders()` → router.push('/model-providers')。
//     所以本项复用它，**不新写第二份通道**（评审教训：两份口径必然漂移）。
const HERE = path.dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1'))

const publisherApi = vi.hoisted(() => ({
  aiRewrite: vi.fn(),
  aiListRewriteStrategies: vi.fn(async () => ({ code: 0, data: { strategies: [] } })),
  aiGetRecommendedStrategies: vi.fn(async () => ({ code: 0, data: { strategies: [] } })),
  aiIsConfigured: vi.fn(async () => ({ code: 0, data: true })),
  modelProviderIsConfigured: vi.fn(async () => ({ code: 0, data: true })),
  aiGenerateTitles: vi.fn(),
  aiEnhanceContent: vi.fn(),
  aiGenerateSummary: vi.fn(),
  applyKnowledgeFeedback: vi.fn(),
}))
vi.mock('@/api/publisher', () => publisherApi)

vi.mock('@/composables/useLoginGate', () => ({
  useLoginGate: () => ({
    ensureLogin: vi.fn(async () => true),
    requireLogin: vi.fn(async (fn) => fn()),
    openSignIn: vi.fn(async () => true),
  }),
}))

const push = vi.hoisted(() => vi.fn())
vi.mock('vue-router', () => ({
  useRouter: () => ({ push, replace: vi.fn(), currentRoute: { value: { path: '/' } } }),
}))

import i18n from '@/i18n'
import AiWriterPanel from '@/components/AiWriterPanel.vue'

async function openRewriteTabAndFail (errPayload) {
  publisherApi.aiRewrite.mockRejectedValue(errPayload)
  const wrapper = mount(AiWriterPanel, { props: { content: '原始正文', selectedText: '' }, global: { plugins: [i18n] } })
  await nextTick()
  await new Promise((r) => setTimeout(r, 40)) // 等 onMounted 的 checkConfig 落地
  const tab = wrapper.findAll('.mode-tab').find((t) => t.text().includes('AI 改写'))
  expect(tab, '找不到「AI 改写」模式页签 ⇒ 夹具前提失效，不得静默通过').toBeTruthy()
  await tab.trigger('click')
  const area = wrapper.find('textarea')
  expect(area.exists(), '改写模式里没有输入 textarea ⇒ 夹具与模板已脱节').toBe(true)
  await area.setValue('需要被改写的中文段落，长度要过非空校验。')
  const submit = wrapper.findAll('button').find((b) => b.text().includes('开始改写'))
  expect(submit, '找不到「开始改写」按钮').toBeTruthy()
  expect(submit.attributes('disabled'), '输入已非空，提交按钮不应仍被禁用').toBeUndefined()
  await submit.trigger('click')
  await new Promise((r) => setTimeout(r, 40))
  await nextTick()
  return wrapper
}

afterEach(() => vi.clearAllMocks())
beforeEach(() => { push.mockReset() })

describe('AiWriterPanel 错误卡的动作位（阶段 1.10b）', () => {
  it('LLM_KEY_MISSING 的错误旁边出现「前往模型设置」动作按钮', async () => {
    const wrapper = await openRewriteTabAndFail({ errorCode: 'LLM_KEY_MISSING', message: 'internal detail' })
    expect(wrapper.find('[role="alert"]').exists(), '错误文本必须仍是 alert 语义').toBe(true)
    const action = wrapper.find('[data-testid="panel-error-action"]')
    expect(action.exists(), '错误卡片必须给出直达动作，而不是让用户照文案自己找路').toBe(true)
    expect(action.element.tagName, '动作必须是原生 button（键盘可达不靠额外镜像）').toBe('BUTTON')
  })

  it('点动作按钮复用既有 goToProviders 通道（router.push 到 /model-providers），不开新窗口', async () => {
    const wrapper = await openRewriteTabAndFail({ errorCode: 'LLM_KEY_MISSING' })
    await wrapper.find('[data-testid="panel-error-action"]').trigger('click')
    await nextTick()
    expect(push).toHaveBeenCalledWith('/model-providers')
    const src = fs.readFileSync(path.join(HERE, 'AiWriterPanel.vue'), 'utf8')
    // 只约束本项新增的那一块（评审 i3）：整份文件级 not.toMatch 会把该组件其它功能未来合法的写法
    // 判成本 PR 的锅；而「src 里不得有第二份协议判据 / window.open 未登记」这件事仓内已有全域合同在守
    // ——apps/desktop/src/href-scheme-contract.test.js 扫全仓，不在这里重复一份会漂移的口径。
    const block = /data-testid="panel-error-action"[\s\S]{0,220}?<\/button>/.exec(src)
    expect(block, '取不到动作块 ⇒ 判据失明，不得读成通过').toBeTruthy()
    expect(block[0], '动作块内不得出现 window.open 或自带协议判据').not.toMatch(/window\.open/)
    expect(block[0], '动作块内不得出现 https 字面量').not.toMatch(/https?:\/\//)
    expect(block[0], '动作块必须显式绑既有 goToProviders，不另开同义函数').toMatch(/@click="goToProviders"/)
    expect(src, '不得新增第二份 https 正则').not.toMatch(/\/\^https?:/)
  })

  it('API_KEY_NOT_CONFIGURED 同样给动作；无直达意义的错误码一律不给', async () => {
    const ok = await openRewriteTabAndFail({ errorCode: 'API_KEY_NOT_CONFIGURED' })
    expect(ok.find('[data-testid="panel-error-action"]').exists(), '缺 API Key 应能一键去设置').toBe(true)

    for (const code of ['TIMEOUT', 'NETWORK_ERROR', 'QUOTA_EXCEEDED', 'IO_ERROR', 'STORAGE_UNAVAILABLE']) {
      const w = await openRewriteTabAndFail({ errorCode: code })
      expect(w.find('[role="alert"]').exists(), code + ' 仍须显示错误文本').toBe(true)
      expect(w.find('[data-testid="panel-error-action"]').exists(), code + ' 不该挂着「前往模型设置」').toBe(false)
    }
  })

  it('panelError 的既有字符串契约不被破坏（三处既有断言仍按字符串读）', async () => {
    const wrapper = await openRewriteTabAndFail({ errorCode: 'LLM_KEY_MISSING' })
    const alert = wrapper.find('[role="alert"]')
    expect(typeof alert.text(), '错误区仍是文本节点').toBe('string')
    expect(alert.text().length, '错误文案不得为空').toBeGreaterThan(4)
  })

  it('错误清除时动作一并清除：成功改写后不得残留死按钮', async () => {
    const wrapper = await openRewriteTabAndFail({ errorCode: 'LLM_KEY_MISSING' })
    expect(wrapper.find('[data-testid="panel-error-action"]').exists()).toBe(true)
    publisherApi.aiRewrite.mockResolvedValue({ code: 0, data: { success: true, result: '改写后的正文内容' } })
    const submit = wrapper.findAll('button').find((b) => b.text().includes('开始改写'))
    await submit.trigger('click')
    await new Promise((r) => setTimeout(r, 40))
    await nextTick()
    expect(wrapper.find('[role="alert"]').exists(), '成功后错误区应已清除').toBe(false)
    expect(wrapper.find('[data-testid="panel-error-action"]').exists(), '错误已消失，动作按钮不得残留').toBe(false)
  })

  // 评审 i1：PRD 承诺「无码/未知码 → 不给动作，不得猜」，但原来六个用例全用带码载荷，
  // 且 res.data.error / res.message 两个非 catch 分支手写字段、绕过 helper ⇒ 该路径既没测也没收口。
  it('同一实例内从带码错误换成 message-only 错误：文本换掉、动作必须消失', async () => {
    publisherApi.aiRewrite.mockRejectedValue({ errorCode: 'LLM_KEY_MISSING' })
    const wrapper = await openRewriteTabAndFail({ errorCode: 'LLM_KEY_MISSING' })
    expect(wrapper.find('[data-testid="panel-error-action"]').exists(), '前置：这一轮该有动作').toBe(true)
    publisherApi.aiRewrite.mockRejectedValue(new Error('boom: 某个不带码的底层异常'))
    const submit = wrapper.findAll('button').find((b) => b.text().includes('开始改写'))
    await submit.trigger('click')
    await new Promise((r) => setTimeout(r, 40))
    await nextTick()
    expect(wrapper.find('[role="alert"]').exists(), '无码错误仍要出文本').toBe(true)
    expect(wrapper.find('[data-testid="panel-error-action"]').exists(), '无码错误不得挂着上一轮的动作').toBe(false)
  })

  it('res.data.error 与 res.message 两个非 catch 分支都必须走同一个清码出口', async () => {
    publisherApi.aiRewrite.mockRejectedValue({ errorCode: 'LLM_KEY_MISSING' })
    const wrapper = await openRewriteTabAndFail({ errorCode: 'LLM_KEY_MISSING' })
    expect(wrapper.find('[data-testid="panel-error-action"]').exists(), '前置：这一轮该有动作').toBe(true)
    const submit = wrapper.findAll('button').find((b) => b.text().includes('开始改写'))

    // 分支 A：`AiWriterPanel.vue:427` —— code===0 && data.error（引擎回了信封内错误）
    publisherApi.aiRewrite.mockResolvedValue({ code: 0, data: { error: '引擎回了纯文本错误' } })
    await submit.trigger('click')
    await new Promise((r) => setTimeout(r, 40))
    await nextTick()
    expect(wrapper.find('[role="alert"]').text(), 'res.data.error 应原样成为错误文本').toContain('引擎回了纯文本错误')
    expect(wrapper.find('[data-testid="panel-error-action"]').exists(), '分支 A 必须清码').toBe(false)

    // 分支 B：`AiWriterPanel.vue:430` 的 else —— code≠0，只有 message
    publisherApi.aiRewrite.mockResolvedValue({ code: -1, message: '底层返回的说明文本' })
    await submit.trigger('click')
    await new Promise((r) => setTimeout(r, 40))
    await nextTick()
    expect(wrapper.find('[role="alert"]').text(), 'res.message 应成为错误文本').toContain('底层返回的说明文本')
    expect(wrapper.find('[data-testid="panel-error-action"]').exists(), '分支 B 必须清码').toBe(false)
  })

  // 评审 i4：码表指向的 locale 键原先零机械保障；vue-i18n 缺键会把 key 原文渲染给用户。
  it('码表指向的 locale 键必须 zh/en 都在（缺键会静默渲染成 rewritePage.xxx 字面量）', () => {
    const vue = fs.readFileSync(path.join(HERE, 'AiWriterPanel.vue'), 'utf8')
    const keys = [...vue.matchAll(/["']rewritePage\.(\w+)["']/g)].map((m) => m[1])
    expect(keys.length, '码表至少要有一个 locale 键，否则本条什么都没测').toBeGreaterThan(0)
    for (const [lang, file] of [['zh', 'zh.js'], ['en', 'en.js']]) {
      const src = fs.readFileSync(path.join(HERE, '..', 'locales', 'rewrite-page', file), 'utf8')
      const missing = keys.filter((k) => !new RegExp('\\b' + k + ':').test(src))
      expect(missing, lang + ' 侧缺键: ' + missing.join(',')).toEqual([])
    }
  })

  it('动作按钮的可见文案必须走 locales（不得新增硬编码中文字面量）', () => {
    const src = fs.readFileSync(path.join(HERE, 'AiWriterPanel.vue'), 'utf8')
    const seg = /data-testid="panel-error-action"[\s\S]{0,200}?<\/button>/.exec(src)
    expect(seg, '模板里找不到动作按钮 ⇒ 本条测不到东西').toBeTruthy()
    expect(seg[0], '按钮文案必须是 i18n 调用，不能是字面量').toMatch(/\{\{\s*t\(/)
    expect(src, '动作必须复用既有 goToProviders，不另开第二条通道').toMatch(/data-testid="panel-error-action"[\s\S]{0,200}?goToProviders/)
  })
})
