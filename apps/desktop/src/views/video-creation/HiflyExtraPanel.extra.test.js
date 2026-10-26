import { describe, expect, it, vi } from 'vitest'
import { mount } from '@vue/test-utils'
import HiflyExtraPanel from './HiflyExtraPanel.vue'

/**
 * HiflyExtraPanel 补充测试（change: hifly-full-api-ui）。
 *
 * 与 `HiflyExtraPanel.test.js` 分开的理由：那份锁「7 个模式渲染 / 能力未就绪 /
 * 收费提示 / 删除入口 / 余额拦截 / 字段映射」这 6 条主干行为；这份补
 * 「模板加载、封面、翻译、图片、音频、失败路径」这些**分支**。
 *
 * 为什么要补：CI 的 `QG Coverage` 在新增 ~1000 行代码后红，本地对应检查全绿
 * —— 说明缺的不是「能跑」，是**分支没被走过**。这两态必须分开看。
 */

const t = (key) => key

function makeApi (overrides = {}) {
  return {
    credit: vi.fn(async () => ({ code: 0, data: { left: 500 } })),
    livelyTemplates: vi.fn(async () => ({
      code: 0,
      data: { templates: [{ template: 'tpl-1', title: '口播模板' }, { template: 'tpl-2', title: '对比模板' }] },
    })),
    coverStyles: vi.fn(async () => ({
      code: 0,
      data: { styles: [{ template: 'cs-1', title: '大字报' }] },
    })),
    createCover: vi.fn(async () => ({ code: 0, data: { coverUrl: 'https://cdn/c.jpg' } })),
    deleteWork: vi.fn(async () => ({ code: 0, data: null })),
    createByAudio: vi.fn(async () => ({ code: 0, data: { taskId: 't-a' } })),
    createByTemplate: vi.fn(async () => ({ code: 0, data: { taskId: 't-t' } })),
    translate: vi.fn(async () => ({ code: 0, data: { taskId: 't-tr' } })),
    createBySing: vi.fn(async () => ({ code: 0, data: { taskId: 't-s' } })),
    createByImage: vi.fn(async () => ({ code: 0, data: { taskId: 't-i' } })),
    audioTts: vi.fn(async () => ({ code: 0, data: { taskId: 't-au' } })),
    ...overrides,
  }
}

async function mountPanel (api = makeApi()) {
  const w = mount(HiflyExtraPanel, { props: { t, api } })
  await new Promise((r) => setTimeout(r, 0))
  await w.vm.$nextTick()
  return w
}

async function gotoMode (w, key) {
  await w.find(`[data-testid="hifly-extra-tab-${key}"]`).trigger('click')
  await new Promise((r) => setTimeout(r, 0))
  await w.vm.$nextTick()
}

describe('HiflyExtraPanel — 分支覆盖（补充）', () => {
  // 切到「网感模板」会真的去拉模板列表。这条既验证调用，也验证渲染。
  it('切到网感模板 ⇒ 拉取列表并渲染模板按钮', async () => {
    const api = makeApi()
    const w = await mountPanel(api)
    await gotoMode(w, 'template')
    expect(api.livelyTemplates).toHaveBeenCalledWith({ page: 1, size: 20, type: 0 })
    expect(w.find('[data-testid="hifly-extra-template-tpl-1"]').exists()).toBe(true)
    expect(w.find('[data-testid="hifly-extra-template-tpl-2"]').exists()).toBe(true)
    w.unmount()
  })

  // 点模板要把 template id 写进 draft，否则提交时 template 为空、服务端必拒。
  it('点模板 ⇒ draft.template 被填成该模板 id', async () => {
    const w = await mountPanel()
    await gotoMode(w, 'template')
    await w.find('[data-testid="hifly-extra-template-tpl-2"]').trigger('click')
    expect(w.vm.draft.template).toBe('tpl-2')
    w.unmount()
  })

  it('模板列表为空 ⇒ 显示空态文案而不是空白', async () => {
    const api = makeApi({ livelyTemplates: vi.fn(async () => ({ code: 0, data: { templates: [] } })) })
    const w = await mountPanel(api)
    await gotoMode(w, 'template')
    expect(w.text()).toContain('hiflyExtraTemplateEmpty')
    w.unmount()
  })

  it('模板拉取失败 ⇒ 显示失败文案', async () => {
    const api = makeApi({ livelyTemplates: vi.fn(async () => ({ code: -1, message: 'boom' })) })
    const w = await mountPanel(api)
    await gotoMode(w, 'template')
    expect(w.text()).toContain('hiflyExtraTemplateLoadFailed')
    w.unmount()
  })

  // 封面模板是另一条列表通道（cover_styles），不能和 lively_templates 混用。
  it('切到创建封面 ⇒ 拉封面模板列表', async () => {
    const api = makeApi()
    const w = await mountPanel(api)
    await gotoMode(w, 'cover')
    expect(api.coverStyles).toHaveBeenCalledWith({ page: 1, size: 20 })
    expect(w.text()).toContain('大字报')
    w.unmount()
  })

  it('封面提交成功 ⇒ 结果区显示图片地址', async () => {
    const api = makeApi()
    const w = await mountPanel(api)
    await gotoMode(w, 'cover')
    w.vm.draft = { template: 'cs-1', content: '今天聊三件事' }
    await w.find('[data-testid="hifly-extra-submit"]').trigger('click')
    await new Promise((r) => setTimeout(r, 0))
    expect(api.createCover).toHaveBeenCalledWith({ template: 'cs-1', content: '今天聊三件事' })
    expect(w.vm.result.coverUrl).toBe('https://cdn/c.jpg')
    w.unmount()
  })

  // 翻译只有两个字段，且**不能删**。这条锁「提交走 translate 而不是 createByTemplate」。
  it('翻译模式提交走 translate 通道', async () => {
    const api = makeApi()
    const w = await mountPanel(api)
    await gotoMode(w, 'translate')
    w.vm.draft = { videoFileId: 'vf-1', targetLanguageCode: 'en' }
    await w.find('[data-testid="hifly-extra-submit"]').trigger('click')
    await new Promise((r) => setTimeout(r, 0))
    expect(api.translate).toHaveBeenCalledWith({ videoFileId: 'vf-1', targetLanguageCode: 'en' })
    expect(api.createByTemplate).not.toHaveBeenCalled()
    w.unmount()
  })

  // 图片驱动的 model 是数字：组件必须 Number() 转换，否则主进程 optionalInt 会拒。
  it('图片驱动把 model 转成数字再提交', async () => {
    const api = makeApi()
    const w = await mountPanel(api)
    await gotoMode(w, 'image')
    w.vm.draft = { imageFileId: 'i-1', voice: 'v-1', text: '你好', model: '6' }
    await w.find('[data-testid="hifly-extra-submit"]').trigger('click')
    await new Promise((r) => setTimeout(r, 0))
    expect(api.createByImage).toHaveBeenCalledWith({
      imageFileId: 'i-1', voice: 'v-1', text: '你好', model: 6,
    })
    w.unmount()
  })

  it('音频创作提交走 audioTts 通道', async () => {
    const api = makeApi()
    const w = await mountPanel(api)
    await gotoMode(w, 'audioTts')
    w.vm.draft = { voice: 'v-1', text: '旁白' }
    await w.find('[data-testid="hifly-extra-submit"]').trigger('click')
    await new Promise((r) => setTimeout(r, 0))
    expect(api.audioTts).toHaveBeenCalledWith({ voice: 'v-1', text: '旁白' })
    w.unmount()
  })

  // 服务端 message 是技术文案，不直出给用户；只给一句可读的失败提示。
  it('提交失败 ⇒ 显示通用失败文案，不直出服务端 message', async () => {
    const api = makeApi({ createByAudio: vi.fn(async () => ({ code: 11, message: 'token invalid' })) })
    const w = await mountPanel(api)
    w.vm.draft = { fileId: 'f', avatar: 'a' }
    await w.find('[data-testid="hifly-extra-submit"]').trigger('click')
    await new Promise((r) => setTimeout(r, 0))
    expect(w.text()).toContain('hiflyExtraFailed')
    expect(w.text()).not.toContain('token invalid')
    w.unmount()
  })

  it('删除作品成功 ⇒ 结果区清空', async () => {
    const api = makeApi()
    const w = await mountPanel(api)
    w.vm.draft = { fileId: 'f', avatar: 'a' }
    await w.find('[data-testid="hifly-extra-submit"]').trigger('click')
    await new Promise((r) => setTimeout(r, 0))
    await w.find('[data-testid="hifly-extra-delete"]').trigger('click')
    await new Promise((r) => setTimeout(r, 0))
    expect(api.deleteWork).toHaveBeenCalledWith({ taskId: 't-a' })
    expect(w.vm.result).toBe(null)
    w.unmount()
  })

  it('删除失败 ⇒ 显示删除失败文案（提示该类型可能不支持删除）', async () => {
    const api = makeApi({ deleteWork: vi.fn(async () => ({ code: 11, message: '不支持删除' })) })
    const w = await mountPanel(api)
    w.vm.draft = { fileId: 'f', avatar: 'a' }
    await w.find('[data-testid="hifly-extra-submit"]').trigger('click')
    await new Promise((r) => setTimeout(r, 0))
    await w.find('[data-testid="hifly-extra-delete"]').trigger('click')
    await new Promise((r) => setTimeout(r, 0))
    expect(w.text()).toContain('hiflyExtraDeleteFailed')
    w.unmount()
  })
})
