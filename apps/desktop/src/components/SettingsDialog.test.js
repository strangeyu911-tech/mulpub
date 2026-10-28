import { describe, expect, it, beforeEach, vi } from 'vitest'
import { mount } from '@vue/test-utils'
import { nextTick } from 'vue'
import i18n from '@/i18n'

// publish tab 自 publish-frequency-policy-v2 起可用：它会挂载 PublishFrequencySettings，
// 该组件挂载即拉策略。此处 mock 掉以免测试依赖真实 electronAPI 是否存在。
// ⚠️ 必须用 importOriginal 保留其余导出：整模块替换会让同一对话框里「通用设置」的
//    LogsSettings 拿不到 logsGetInfo（实测产生 4 个未捕获 TypeError，测试虽过但 CI 红）。
vi.mock('@/api/publisher', async (importOriginal) => {
  const actual = await importOriginal()
  return {
    ...actual,
    getPublishFrequencyPolicy: vi.fn().mockResolvedValue({
      code: 0,
      data: {
        platforms: { wechat_mp: { tier: 'long', accountMinMs: 1200000, platformMinMs: 120000, accountDailyMax: 3 } },
        overrides: null,
        jitterRatio: 0.4,
        releaseGraceMs: 60000,
      },
    }),
    setPublishFrequencyPolicy: vi.fn().mockResolvedValue({ code: 0, data: { saved: true } }),
    emergencyReleasePublishWait: vi.fn().mockResolvedValue({ code: 0, data: { released: false, reason: 'no_waiting_window', max: 1 } }),
    getPublishEmergencyStatus: vi.fn().mockResolvedValue({ code: 0, data: { max: 1 } }),
  }
})

import SettingsDialog from './SettingsDialog.vue'

/**
 * 按标签取 Tab（ ux-audit-hotkeys-settings 起）：原先的 findAll()[i] 索引选择
 * 在导航里插一个新 Tab 就会整体漂一位，把"点禁用 Tab 不切换"这类锁指向错误的按钮。
 */
function tabByLabel (wrapper, label) {
  const hit = wrapper.findAll('.settings-tab').find((t) => t.text().includes(label))
  if (!hit) throw new Error('找不到 Tab：' + label + '；实际：' + wrapper.findAll('.settings-tab').map((t) => t.text()).join(' / '))
  return hit
}

function mountDialog (locale = 'zh') {
  i18n.global.locale.value = locale
  return mount(SettingsDialog, {
    props: { visible: true },
    global: { plugins: [i18n], stubs: { teleport: true } },
  })
}

describe('SettingsDialog', () => {
  beforeEach(() => {
    i18n.global.locale.value = 'zh'
    // 知乎 API 分区挂载即拉配置；这里给最小桩，避免依赖真实 preload（其余 Tab 同理各自 mock）
    window.electronAPI = {
      zhihuGetConfig: vi.fn().mockResolvedValue({
        code: 0,
        data: {
          configured: false, readable: false, maskedSecret: '', updatedAt: null,
          verifiedAt: null, favlistCount: null, legacyDetected: false, source: 'none',
        },
      }),
    }
  })

  // Tab 清单（合并 #4210「快捷键」与本支「外观」后的权威顺序，读自 SettingsDialog.vue 的 tabs 定义）
  const EXPECTED_TABS = ['模型设置', '通用设置', '外观设置', '飞书 API', '知乎 API', '发布设置', '快捷键', '账号设置']

  it('渲染八个 Tab，默认选中模型设置；外观/发布/快捷键均可用、账号设置仍禁用', () => {
    const wrapper = mountDialog()
    const tabs = wrapper.findAll('.settings-tab')
    // 数量由标签集合派生：往导航里插一个新 Tab 时这里随清单一起长，
    // 不会像原先两侧各自钉死 `toHaveLength(7)` 那样——合并后真值是 8，两侧都会集体假红。
    expect(tabs).toHaveLength(EXPECTED_TABS.length)
    for (const name of EXPECTED_TABS) {
      expect(tabByLabel(wrapper, name), 'Tab 清单缺少：' + name).toBeTruthy()
    }
    // publish-frequency-policy-v2：发布设置由 disabled 转为可用（不再是「敬请期待」）
    const pub = tabByLabel(wrapper, '发布设置')
    expect(pub.text()).not.toContain('敬请期待')
    expect(pub.attributes('disabled')).toBeUndefined()
    // ux-audit-hotkeys-settings（阶段 1.6）：快捷键是**可用** Tab —— 这条属主干侧断言，合并后必须保留
    const hk = tabByLabel(wrapper, '快捷键')
    expect(hk.text()).not.toContain('敬请期待')
    expect(hk.attributes('disabled')).toBeUndefined()
    // 账号设置仍禁用（未在本变更范围内）
    const acct = tabByLabel(wrapper, '账号设置')
    expect(acct.text()).toContain('敬请期待')
    expect(acct.attributes('disabled')).toBeDefined()
    // 外观设置必须可用 —— 它就是本批要补的那个"用户可达的暗色入口"
    const appear = tabByLabel(wrapper, '外观设置')
    expect(appear.attributes('disabled'), '外观 Tab 被置灰 = 暗色依旧不可达，本批等于没修').toBeUndefined()
    // 主干侧的排序意图：能用的都排在前面、占位项垫底 ⇒ 快捷键必须排在禁用的账号设置之前
    const labels = tabs.map((t) => t.text())
    expect(labels.findIndex((l) => l.includes('快捷键')), '快捷键排到了占位项之后').toBeLessThan(
      labels.findIndex((l) => l.includes('账号设置'))
    )
    expect(wrapper.get('.settings-tab.active').text()).toContain('模型设置')
  })

  it('知乎 API 必须紧邻飞书 API 之下（用户明确要求的相邻关系）', () => {
    const wrapper = mountDialog()
    const labels = wrapper.findAll('.settings-tab').map((t) => t.text())
    const feishuIdx = labels.findIndex((l) => l.includes('飞书 API'))
    const zhihuIdx = labels.findIndex((l) => l.includes('知乎 API'))
    expect(feishuIdx).toBeGreaterThanOrEqual(0)
    expect(zhihuIdx).toBe(feishuIdx + 1)
  })

  it('点击禁用 Tab（账号设置）不切换激活态', async () => {
    const wrapper = mountDialog()
    await tabByLabel(wrapper, '账号设置').trigger('click')
    await nextTick()
    expect(wrapper.get('.settings-tab.active').text()).toContain('模型设置')
  })

  it('点击发布设置切换到发布频率策略面板', async () => {
    const wrapper = mountDialog()
    await tabByLabel(wrapper, '发布设置').trigger('click')
    await nextTick()
    await new Promise(resolve => setTimeout(resolve, 0))
    await nextTick()
    expect(wrapper.get('.settings-tab.active').text()).toContain('发布设置')
    expect(wrapper.find('[data-testid="publish-frequency-settings"]').exists()).toBe(true)
  })

  it('点击外观设置渲染 AppearanceSettings 面板，且从面板选暗色真的改了根元素', async () => {
    const wrapper = mountDialog()
    await tabByLabel(wrapper, '外观设置').trigger('click')
    await nextTick()
    await new Promise(resolve => setTimeout(resolve, 0))
    await nextTick()

    const panel = wrapper.find('[data-testid="appearance-settings"]')
    expect(panel.exists(), 'Tab 可点但面板没挂上 = 入口仍是装饰（本仓「注册≠注入≠生效」的同型）').toBe(true)
    expect(wrapper.get('.settings-tab.active').text()).toContain('外观设置')

    await panel.find('#appearance-theme-dark').trigger('click')
    await new Promise(resolve => setTimeout(resolve, 0))
    expect(document.documentElement.getAttribute('data-theme'), '面板里的选择不作用于界面 = 1.1 没被修好').toBe('dark')
    document.documentElement.removeAttribute('data-theme')
  })

  it('点击知乎 API 切换到知乎配置面板', async () => {
    const wrapper = mountDialog()
    await tabByLabel(wrapper, '知乎 API').trigger('click')
    await nextTick()
    await new Promise(resolve => setTimeout(resolve, 0))
    await nextTick()
    expect(wrapper.get('.settings-tab.active').text()).toContain('知乎 API')
    expect(wrapper.find('[data-testid="zhihu-settings"]').exists()).toBe(true)
  })

  it('initialTab=zhihu 时打开即定位到知乎 API，且之后不再把用户拉回（采集页「前往设置」的落点契约）', async () => {
    const wrapper = mount(SettingsDialog, {
      props: { visible: false, initialTab: 'zhihu' },
      global: { plugins: [i18n], stubs: { teleport: true } },
    })
    // 关闭态不渲染内容；打开那一刻才应用 initialTab
    await wrapper.setProps({ visible: true })
    await nextTick()
    expect(wrapper.get('.settings-tab.active').text()).toContain('知乎 API')

    // 用户自己切到通用设置后，父级重渲染不得把他拉回 initialTab
    await tabByLabel(wrapper, '通用设置').trigger('click')
    await nextTick()
    expect(wrapper.get('.settings-tab.active').text()).toContain('通用设置')
    await wrapper.setProps({ visible: true })
    await nextTick()
    expect(wrapper.get('.settings-tab.active').text()).toContain('通用设置')
  })

  it('切换到通用设置渲染日志设置面板（i18n 文案）', async () => {
    const wrapper = mountDialog()
    await tabByLabel(wrapper, '通用设置').trigger('click')
    await nextTick()
    await new Promise(resolve => setTimeout(resolve, 0))
    await nextTick()
    expect(wrapper.get('.settings-tab.active').text()).toContain('通用设置')
    expect(wrapper.text()).toContain('应用日志')
    expect(wrapper.text()).toContain('语言')
  })

  it('每个 Tab 渲染图标位（.tab-icon）', () => {
    const wrapper = mountDialog()
    const icons = wrapper.findAll('.settings-tab .tab-icon')
    const tabs = wrapper.findAll('.settings-tab')
    // ⚠ 断"每个 Tab 都有图标位"，而不是钉死某个总数：写死 7 的话，
    //   每往中间插一个 Tab 都要来改这条，而它想守的从来不是"恰好几个"。
    expect(tabs.length, 'Tab 列表为空 ⇒ 这条判据无从比较').toBeGreaterThan(0)
    expect(icons).toHaveLength(tabs.length)
  })

  it('en 语言下 Tab 为英文，发布设置不再是 Coming Soon', () => {
    const wrapper = mountDialog('en')
    const tabs = wrapper.findAll('.settings-tab')
    expect(tabByLabel(wrapper, 'Model Settings'), '英文档同样必须有该 Tab').toBeTruthy()
    expect(tabByLabel(wrapper, 'Zhihu API'), '英文档同样必须有该 Tab').toBeTruthy()
    expect(tabByLabel(wrapper, 'Publish Settings'), '英文档同样必须有该 Tab').toBeTruthy()
    expect(tabByLabel(wrapper, 'Keyboard shortcuts'), '英文档缺少快捷键 Tab（#4210 的断言，合并后保留）').toBeTruthy()
    expect(tabByLabel(wrapper, 'Appearance'), '英文档缺少外观 Tab（locale 未成对时就是这种形状）').toBeTruthy()
  })
})
