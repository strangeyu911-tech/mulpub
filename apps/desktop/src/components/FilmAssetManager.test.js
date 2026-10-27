// @ts-check
import { describe, it, expect, beforeEach, vi } from 'vitest'
import { mount, flushPromises } from '@vue/test-utils'
import FilmAssetManager from './FilmAssetManager.vue'
import i18n from '@/i18n'

/**
 * FilmAssetManager 契约测试（change: kit-asset-health-report）
 *
 * 覆盖：
 *   - 入口在 Hub 页级（组件自身可独立挂载，不依赖任何 tab）；
 *   - **先体检、后确认**：点入口只调 inspectKit；确认后才调 importKit；
 *   - `importable=false` ⇒ 确认按钮**禁用** + 缺项逐条列出（不许「先点了再报错」）；
 *   - `counts=null` ⇒ 明确说「未能读取」，**不得**渲染一排 0（把"没测"印成 0）；
 *   - 取消目录（主进程回 cancelled）⇒ 不弹报告、不算失败；
 *   - 导入中不可中断；成功但有残留 / 审计不完整 ⇒ 各自告警。
 */

const bridge = {
  inspect: { code: 0, data: null },
  import: { code: 0, data: { ok: true, fileCount: 9 } },
  inspectCalls: 0,
  importCalls: 0,
  pending: null,
}

const GOOD_REPORT = {
  sourceDir: 'D:/my-kit',
  importable: true,
  blockingReason: null,
  blockingMessage: null,
  counts: {
    scenes: 162, shots: 153, shotsWithResult: 0,
    references: 332, referencesResolvable: 330,
    templateTasks: 4, templateFiles: 8, fileCount: 9, totalBytes: 2987163,
  },
  langs: ['en', 'zh'],
  requiredMissing: [],
  ignoredTopLevel: [],
  warnings: [],
  assetWarningTexts: [],
}

vi.mock('@/api/electron-bridge', () => ({
  getApi: () => ({
    filmEngineering: {
      inspectKit: async () => { bridge.inspectCalls += 1; return bridge.inspect },
      importKit: async () => {
        bridge.importCalls += 1
        if (typeof bridge.pending === 'function') return bridge.pending()
        return bridge.import
      },
    },
  }),
}))

const notifyMock = { warn: vi.fn(), success: vi.fn(), error: vi.fn(), info: vi.fn() }
vi.mock('@/composables/useNotify', () => ({
  useNotify: () => ({
    notify: notifyMock.warn,
    notifyWarning: notifyMock.warn,
    notifySuccess: notifyMock.success,
    notifyError: notifyMock.error,
    notifyInfo: notifyMock.info,
  }),
}))

function mountManager (onImported) {
  return mount(FilmAssetManager, {
    props: onImported ? { onImported } : {},
    global: {
      plugins: [i18n],
      compilerOptions: { isCustomElement: (tag) => tag.startsWith('el-') },
      stubs: {
        Teleport: { template: '<div><slot /></div>' },
        Transition: { template: '<div><slot /></div>' },
      },
    },
  })
}

/** 点入口并等体检返回 */
async function openReport (wrapper) {
  await wrapper.find('[data-testid="fe-asset-manager-btn"]').trigger('click')
  await flushPromises()
}

beforeEach(() => {
  vi.clearAllMocks()
  bridge.inspectCalls = 0
  bridge.importCalls = 0
  bridge.pending = null
  bridge.inspect = { code: 0, data: GOOD_REPORT }
  bridge.import = { code: 0, data: { ok: true, fileCount: 9 } }
})

describe('FilmAssetManager：入口与「先看再导」', () => {
  it('入口渲染在页级（组件可独立挂载，不依赖 tab）', async () => {
    const wrapper = mountManager()
    await flushPromises()
    expect(wrapper.find('[data-testid="fe-asset-manager"]').exists()).toBe(true)
    expect(wrapper.find('[data-testid="fe-asset-manager-btn"]').exists()).toBe(true)
  })

  it('点入口只调 inspectKit，**不**调 importKit', async () => {
    const wrapper = mountManager()
    await openReport(wrapper)
    expect(bridge.inspectCalls).toBe(1)
    expect(bridge.importCalls).toBe(0)
    expect(wrapper.find('[data-testid="fe-asset-report"]').exists()).toBe(true)
  })

  it('报告逐项渲染（场景/分镜/模板/参考素材/语种）', async () => {
    const wrapper = mountManager()
    await openReport(wrapper)
    const text = wrapper.find('[data-testid="fe-asset-report-counts"]').text()
    expect(text).toContain('162')
    expect(text).toContain('153')
    expect(text).toContain('4')
    expect(text).toContain('330')
    expect(text).toContain('332')
    expect(text).toContain('en')
  })

  it('确认后才调 importKit，且成功后回调刷新', async () => {
    const onImported = vi.fn()
    const wrapper = mountManager(onImported)
    await openReport(wrapper)
    await wrapper.find('[data-testid="fe-asset-report-confirm"]').trigger('click')
    await flushPromises()
    expect(bridge.importCalls).toBe(1)
    expect(onImported).toHaveBeenCalledTimes(1)
  })

  it('取消目录（主进程回 cancelled）⇒ 不弹报告、不算失败', async () => {
    bridge.inspect = { code: 0, data: { cancelled: true, reason: 'CANCELLED' } }
    const wrapper = mountManager()
    await openReport(wrapper)
    expect(wrapper.find('[data-testid="fe-asset-report"]').exists()).toBe(false)
    expect(notifyMock.warn).not.toHaveBeenCalled()
    expect(bridge.importCalls).toBe(0)
  })

  it('取消报告 ⇒ 不触发导入', async () => {
    const wrapper = mountManager()
    await openReport(wrapper)
    await wrapper.find('[data-testid="fe-asset-report-cancel"]').trigger('click')
    await flushPromises()
    expect(bridge.importCalls).toBe(0)
  })
})

describe('FilmAssetManager：不可导入时不许「点了再报错」', () => {
  it('importable=false ⇒ 确认按钮禁用 + 缺项逐条列出', async () => {
    bridge.inspect = {
      code: 0,
      data: Object.assign({}, GOOD_REPORT, {
        importable: false,
        blockingReason: 'VALIDATION_ERROR',
        blockingMessage: 'source: 缺少 palette.json',
        requiredMissing: ['palette.json', 'prompts/tasks/'],
      }),
    }
    const wrapper = mountManager()
    await openReport(wrapper)
    const btn = wrapper.find('[data-testid="fe-asset-report-confirm"]')
    expect(btn.attributes('disabled')).toBeDefined()
    const blocking = wrapper.find('[data-testid="fe-asset-report-blocking"]').text()
    expect(blocking).toContain('palette.json')
    expect(blocking).toContain('prompts/tasks/')
    // 即使强行点，也不得触发导入
    await btn.trigger('click')
    await flushPromises()
    expect(bridge.importCalls).toBe(0)
  })

  it('counts=null ⇒ 显示「未能读取」，不渲染一排 0', async () => {
    bridge.inspect = {
      code: 0,
      data: Object.assign({}, GOOD_REPORT, { importable: false, counts: null }),
    }
    const wrapper = mountManager()
    await openReport(wrapper)
    expect(wrapper.find('[data-testid="fe-asset-report-counts"]').exists()).toBe(false)
    const hint = wrapper.find('[data-testid="fe-asset-report-nocounts"]').text()
    expect(hint.length).toBeGreaterThan(0)
    expect(wrapper.text()).not.toContain('场景 0 个')
  })

  it('白名单外条目与告警都要显示给用户', async () => {
    bridge.inspect = {
      code: 0,
      data: Object.assign({}, GOOD_REPORT, {
        ignoredTopLevel: ['images'],
        warnings: [{ code: 'IGNORED_TOP_LEVEL', count: 1 }, { code: 'SHOTS_WITH_RESULT', count: 2 }],
      }),
    }
    const wrapper = mountManager()
    await openReport(wrapper)
    expect(wrapper.find('[data-testid="fe-asset-report-ignored"]').text()).toContain('images')
    const warnsEl = wrapper.find('[data-testid="fe-asset-report-warns"]')
    expect(warnsEl.exists()).toBe(true)
    // 告警文案由 i18n 生成（code → 文案 + count 插值）：断言条数渲染出来，而不是断言硬编码中文
    expect(warnsEl.findAll('li').length).toBe(2)
    expect(warnsEl.text()).toContain('2')
  })
})

// change: kit-import-rollback-and-template-health —— 报告三段（P1 模板结构 / P2 对比 / P3 版本）
describe('FilmAssetManager：报告三段补充信息', () => {
  it('模板结构逐项渲染（总数 / 场景头 / 角色行 / 可识别块）', async () => {
    bridge.inspect = {
      code: 0,
      data: Object.assign({}, GOOD_REPORT, {
        templateStructure: { total: 153, withSceneHeading: 150, withCharacterLine: 120, withBlocks: 90 },
      }),
    }
    const wrapper = mountManager()
    await openReport(wrapper)
    const text = wrapper.find('[data-testid="fe-asset-report-template"]').text()
    expect(text).toContain('153')
    expect(text).toContain('150')
    expect(text).toContain('120')
    expect(text).toContain('90')
  })

  it('模板结构为 null ⇒ 该段整块不渲染（不印 0 个模板）', async () => {
    bridge.inspect = {
      code: 0,
      data: Object.assign({}, GOOD_REPORT, { templateStructure: null }),
    }
    const wrapper = mountManager()
    await openReport(wrapper)
    expect(wrapper.find('[data-testid="fe-asset-report-template"]').exists()).toBe(false)
  })

  it('对比段：当前值与带符号 delta 都要出现', async () => {
    bridge.inspect = {
      code: 0,
      data: Object.assign({}, GOOD_REPORT, {
        compare: {
          current: { scenes: 100, shots: 80, templates: 3 },
          delta: { scenes: 62, shots: 73, templates: 1 },
        },
      }),
    }
    const wrapper = mountManager()
    await openReport(wrapper)
    const text = wrapper.find('[data-testid="fe-asset-report-compare"]').text()
    expect(text).toContain('100')
    expect(text).toContain('80')
    expect(text).toContain('+62')
    expect(text).toContain('+73')
  })

  it('对比为 null ⇒ 该段整块不渲染（拿不准就不编差异）', async () => {
    bridge.inspect = {
      code: 0,
      data: Object.assign({}, GOOD_REPORT, { compare: null }),
    }
    const wrapper = mountManager()
    await openReport(wrapper)
    expect(wrapper.find('[data-testid="fe-asset-report-compare"]').exists()).toBe(false)
  })

  it('版本不符 ⇒ 明确写出「你的包是 vN / 本版本要 vM」', async () => {
    bridge.inspect = {
      code: 0,
      data: Object.assign({}, GOOD_REPORT, {
        importable: false,
        assetVersion: 2,
        expectedAssetVersion: 1,
        versionMismatch: true,
      }),
    }
    const wrapper = mountManager()
    await openReport(wrapper)
    const text = wrapper.find('[data-testid="fe-asset-report-version"]').text()
    expect(text).toContain('2')
    expect(text).toContain('1')
  })

  it('版本一致 ⇒ 版本段不渲染（不制造无关信息）', async () => {
    bridge.inspect = {
      code: 0,
      data: Object.assign({}, GOOD_REPORT, {
        assetVersion: 1,
        expectedAssetVersion: 1,
        versionMismatch: false,
      }),
    }
    const wrapper = mountManager()
    await openReport(wrapper)
    expect(wrapper.find('[data-testid="fe-asset-report-version"]').exists()).toBe(false)
  })
})

describe('FilmAssetManager：导入中与导入后', () => {
  it('导入中 ⇒ 入口禁用 + 不可中断模态出现', async () => {
    let release = null
    bridge.pending = () => new Promise((resolve) => { release = resolve })
    const wrapper = mountManager()
    await openReport(wrapper)
    await wrapper.find('[data-testid="fe-asset-report-confirm"]').trigger('click')
    await flushPromises()
    expect(wrapper.find('[data-testid="fe-asset-manager-btn"]').attributes('disabled')).toBeDefined()
    expect(wrapper.find('[data-testid="fe-kit-importing"]').exists()).toBe(true)
    if (release) release({ code: 0, data: { ok: true, fileCount: 1 } })
    await flushPromises()
    expect(wrapper.find('[data-testid="fe-asset-manager-btn"]').attributes('disabled')).toBeUndefined()
  })

  it('成功但有残留（锁未删）⇒ 弹残留告警 + 恢复指引', async () => {
    bridge.import = {
      code: 0,
      data: { ok: true, fileCount: 9, recoveryState: 'LOCK_LEFT', recoveryPath: 'D:/x/.import-lock' },
    }
    const wrapper = mountManager()
    await openReport(wrapper)
    await wrapper.find('[data-testid="fe-asset-report-confirm"]').trigger('click')
    await flushPromises()
    expect(notifyMock.success).toHaveBeenCalled()
    expect(notifyMock.warn).toHaveBeenCalled()
    expect(wrapper.find('[data-testid="fe-asset-manager-recovery"]').exists()).toBe(true)
  })

  // change: kit-import-rollback-and-template-health —— 上一版备份是**正常态**
  it('成功带上一版备份 ⇒ 用 info 提示路径，且**不**当成残留告警', async () => {
    bridge.import = {
      code: 0,
      data: { ok: true, fileCount: 9, previousBackup: { path: 'D:/x/.bak-2026-10-23T00-00-00-000Z-abcd', stamp: 's1' } },
    }
    const wrapper = mountManager()
    await openReport(wrapper)
    await wrapper.find('[data-testid="fe-asset-report-confirm"]').trigger('click')
    await flushPromises()
    const backup = wrapper.find('[data-testid="fe-asset-manager-backup"]')
    expect(backup.exists()).toBe(true)
    // ⚠ el-alert 在测试环境按自定义元素渲染：文案在 title **属性**上，不在 textContent 里
    expect(backup.attributes('title')).toContain('.bak-2026-10-23T00-00-00-000Z-abcd')
    // 正常态不许升级成残留：恢复指引与残留告警都不出现
    expect(wrapper.find('[data-testid="fe-asset-manager-recovery"]').exists()).toBe(false)
    expect(notifyMock.warn).not.toHaveBeenCalled()
  })

  it('清理更早备份失败（staleWarning）⇒ 必须可见，不得静默', async () => {
    bridge.import = {
      code: 0,
      data: { ok: true, fileCount: 9, staleWarning: '未能清理更早备份: .bak-old' },
    }
    const wrapper = mountManager()
    await openReport(wrapper)
    await wrapper.find('[data-testid="fe-asset-report-confirm"]').trigger('click')
    await flushPromises()
    const stale = wrapper.find('[data-testid="fe-asset-manager-stale"]')
    expect(stale.exists()).toBe(true)
    expect(stale.attributes('title')).toContain('.bak-old')
  })

  it('成功但审计结果行没落盘 ⇒ 弹审计告警（不得静默）', async () => {
    bridge.import = { code: 0, data: { ok: true, fileCount: 9, auditWritten: false } }
    const wrapper = mountManager()
    await openReport(wrapper)
    await wrapper.find('[data-testid="fe-asset-report-confirm"]').trigger('click')
    await flushPromises()
    const warned = notifyMock.warn.mock.calls.map((c) => String(c[0]))
    expect(warned.some((k) => k.indexOf('auditLost') >= 0)).toBe(true)
  })

  it('体检本身失败 ⇒ 弹提示且不弹报告（不把失败伪装成空报告）', async () => {
    bridge.inspect = { code: -2, errorCode: 'NOT_A_DIRECTORY', message: '源目录不可读' }
    const wrapper = mountManager()
    await openReport(wrapper)
    expect(notifyMock.warn).toHaveBeenCalled()
    expect(wrapper.find('[data-testid="fe-asset-report"]').exists()).toBe(false)
  })
})
