import { describe, it, expect, vi, beforeEach } from 'vitest'
import { mount, flushPromises } from '@vue/test-utils'

// t 回 key：断言的是「用了哪个 locale 键」，不是某段中文（文案会变，键是契约）。
vi.mock('vue-i18n', () => ({ useI18n: () => ({ t: (key, params) => key }) }))

const invokeMock = vi.fn()
vi.mock('@/api/electron-bridge', () => ({
  invoke: (...args) => invokeMock(...args),
  getApi: () => ({ getVersion: async () => ({ code: 0, data: '9.9.9' }) }),
}))

const diagnosticMock = vi.fn()
vi.mock('@/api/identity', () => ({
  identityDiagnosticReport: (...args) => diagnosticMock(...args),
}))

const clipboardMock = vi.fn(async () => true)
vi.mock('@/utils/clipboard', () => ({ writeClipboard: (...args) => clipboardMock(...args) }))

async function mountHelp() {
  const { default: HelpSupport } = await import('./HelpSupport.vue')
  const wrapper = mount(HelpSupport)
  await flushPromises()
  return wrapper
}

async function fillValid(wrapper, { message = '这是一段足够长的反馈内容', category = 'payment' } = {}) {
  await wrapper.get('[data-testid="feedback-category"]').setValue(category)
  await wrapper.get('[data-testid="feedback-message"]').setValue(message)
}

describe('member-center/HelpSupport 反馈表单', () => {
  beforeEach(() => {
    invokeMock.mockReset()
    diagnosticMock.mockReset()
    clipboardMock.mockClear()
    diagnosticMock.mockResolvedValue({ code: 0, data: { text: 'DIAG-TEXT' } })
    invokeMock.mockResolvedValue({ code: 0, data: { id: 'f-1' } })
  })

  it('初始状态不可提交（未选分类、未填内容）', async () => {
    const wrapper = await mountHelp()
    expect(wrapper.get('[data-testid="feedback-submit"]').attributes('disabled')).toBeDefined()
  })

  it('内容不足 10 字不可提交，达到 10 字才放行', async () => {
    const wrapper = await mountHelp()
    await wrapper.get('[data-testid="feedback-category"]').setValue('payment')

    await wrapper.get('[data-testid="feedback-message"]').setValue('太短了')
    expect(wrapper.get('[data-testid="feedback-submit"]').attributes('disabled')).toBeDefined()
    expect(wrapper.find('[data-testid="feedback-message-error"]').exists()).toBe(true)

    await wrapper.get('[data-testid="feedback-message"]').setValue('这是一段足够长的反馈内容')
    expect(wrapper.get('[data-testid="feedback-submit"]').attributes('disabled')).toBeUndefined()
    expect(wrapper.find('[data-testid="feedback-message-error"]').exists()).toBe(false)
  })

  it('提交时上行 category / source / includeLogs，并把分类与正文拼进 message', async () => {
    const wrapper = await mountHelp()
    await fillValid(wrapper)
    await wrapper.get('[data-testid="feedback-submit"]').trigger('click')
    await flushPromises()

    expect(invokeMock).toHaveBeenCalledTimes(1)
    const [channel, payload] = invokeMock.mock.calls[0]
    expect(channel).toBe('feedback:submit')
    expect(payload.category).toBe('payment')
    expect(payload.source).toBe('member-center')
    expect(payload.includeLogs).toBe(false)
    expect(payload.message).toContain('memberCenter.feedbackCategoryPayment')
    expect(payload.message).toContain('这是一段足够长的反馈内容')
  })

  it('默认附带诊断信息，其文本进入 message', async () => {
    const wrapper = await mountHelp()
    await fillValid(wrapper)
    await wrapper.get('[data-testid="feedback-submit"]').trigger('click')
    await flushPromises()

    const [, payload] = invokeMock.mock.calls[0]
    expect(payload.message).toContain('DIAG-TEXT')
  })

  it('取消勾选「附带诊断信息」后 message 不含诊断文本', async () => {
    const wrapper = await mountHelp()
    await fillValid(wrapper)
    await wrapper.get('[data-testid="feedback-attach-diagnostics"]').setValue(false)
    await wrapper.get('[data-testid="feedback-submit"]').trigger('click')
    await flushPromises()

    const [, payload] = invokeMock.mock.calls[0]
    expect(payload.message).not.toContain('DIAG-TEXT')
  })

  it('勾选「附日志」后 includeLogs 为 true', async () => {
    const wrapper = await mountHelp()
    await fillValid(wrapper)
    await wrapper.get('[data-testid="feedback-attach-logs"]').setValue(true)
    await wrapper.get('[data-testid="feedback-submit"]').trigger('click')
    await flushPromises()

    const [, payload] = invokeMock.mock.calls[0]
    expect(payload.includeLogs).toBe(true)
  })

  it('提交成功显示成功态，并清空正文', async () => {
    const wrapper = await mountHelp()
    await fillValid(wrapper)
    await wrapper.get('[data-testid="feedback-submit"]').trigger('click')
    await flushPromises()

    expect(wrapper.find('[data-testid="feedback-result-success"]').exists()).toBe(true)
    expect(wrapper.get('[data-testid="feedback-message"]').element.value).toBe('')
  })

  it('提交失败显示失败态（不静默）', async () => {
    invokeMock.mockResolvedValue({ code: -1, message: '未配置运营后台同步（地址/Key）' })
    const wrapper = await mountHelp()
    await fillValid(wrapper)
    await wrapper.get('[data-testid="feedback-submit"]').trigger('click')
    await flushPromises()

    expect(wrapper.find('[data-testid="feedback-result-error"]').exists()).toBe(true)
  })

  it('复制诊断信息走剪贴板并给出已复制反馈', async () => {
    const wrapper = await mountHelp()
    await wrapper.get('[data-testid="feedback-copy-diagnostics"]').trigger('click')
    await flushPromises()

    expect(diagnosticMock).toHaveBeenCalled()
    expect(clipboardMock).toHaveBeenCalledWith('DIAG-TEXT')
    expect(wrapper.get('[data-testid="feedback-copy-diagnostics"]').text()).toBe('memberCenter.feedbackCopied')
  })

  it('版本号展示在主进程返回值上', async () => {
    const wrapper = await mountHelp()
    expect(wrapper.get('[data-testid="member-center-version"]').text()).toBe('9.9.9')
  })
})
