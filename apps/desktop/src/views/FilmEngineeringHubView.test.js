// @ts-check
// @vitest-environment jsdom
/**
 * FilmEngineeringHubView 契约测试（openspec change: film-auto-mode）
 *
 * 锁定（spec「影视工程三标签导航契约」，design D1/D2/D24）：
 *   - 默认标签 auto；点击标签 → activeTab + router.replace(?tab=)
 *   - 懒挂载：未访问过的标签不挂载其内部组件；访问后切回不销毁（不丢状态）
 *   - 两个既有视图以 embedded=true 内嵌；其 open-classic 事件切到工程案例标签
 *   - 键盘 ←/→/Home/End 切换；路由 query 变化驱动标签
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { mount, flushPromises } from '@vue/test-utils'
import { nextTick } from 'vue'

// 与既有视图测试同约定：t() 回显 key（文案内容由 locale 成对门禁单独保证）
vi.mock('vue-i18n', () => ({ useI18n: () => ({ t: (k) => k }) }))

vi.mock('vue-router', async () => {
  const { reactive } = await import('vue')
  const routeState = reactive({ query: {} })
  const replace = vi.fn()
  globalThis.__hubRoute = { routeState, replace }
  return {
    useRoute: () => routeState,
    useRouter: () => ({ replace }),
  }
})

import FilmEngineeringHubView from './FilmEngineeringHubView.vue'

const route = () => globalThis.__hubRoute.routeState
const replace = () => globalThis.__hubRoute.replace

function mountHub () {
  return mount(FilmEngineeringHubView, {
    global: {
      stubs: {
        FilmAutoPanel: true,
        FilmCanvasView: true,
        FilmEngineeringView: true,
        // 资产区按「带 testid 的替身」挂：结构锁要能定位它（见下方「资产区位置」用例）
        FilmAssetManager: { template: '<div data-testid="fe-asset-manager" />' },
        ElCollapse: true,
        ElCollapseItem: true,
        ElInput: true,
        ElSelect: true,
        ElOption: true,
        ElButton: true,
      },
    },
  })
}

const tabEl = (w, id) => w.find(`[data-testid="fh-tab-${id}"]`)
const panelEl = (w, id) => w.find(`[data-testid="fh-panel-${id}"]`)
const canvasStub = (w) => w.findComponent({ name: 'FilmCanvasView' })
const classicStub = (w) => w.findComponent({ name: 'FilmEngineeringView' })
const autoStub = (w) => w.findComponent({ name: 'FilmAutoPanel' })

beforeEach(() => {
  route().query = {}
  replace().mockClear()
})

describe('FilmEngineeringHubView 三标签导航', () => {
  it('默认激活「自动」并且只挂载自动面板（懒挂载）', async () => {
    const w = mountHub()
    await flushPromises()
    expect(tabEl(w, 'auto').attributes('aria-selected')).toBe('true')
    expect(tabEl(w, 'canvas').attributes('aria-selected')).toBe('false')
    expect(autoStub(w).exists()).toBe(true)
    expect(canvasStub(w).exists()).toBe(false)
    expect(classicStub(w).exists()).toBe(false)
    w.unmount()
  })

  it('点击「画布」切换标签并 replace URL query（不新增历史记录）', async () => {
    const w = mountHub()
    await tabEl(w, 'canvas').trigger('click')
    await flushPromises()
    expect(tabEl(w, 'canvas').attributes('aria-selected')).toBe('true')
    expect(canvasStub(w).exists()).toBe(true)
    expect(replace()).toHaveBeenCalledWith({ path: '/film-engineering', query: { tab: 'canvas' } })
    w.unmount()
  })

  it('切换回已访问标签不销毁组件（状态不丢）', async () => {
    const w = mountHub()
    await tabEl(w, 'canvas').trigger('click')
    await flushPromises()
    const first = canvasStub(w).vm
    await tabEl(w, 'auto').trigger('click')
    await flushPromises()
    expect(canvasStub(w).exists()).toBe(true)
    expect(canvasStub(w).vm).toBe(first)
    w.unmount()
  })

  it('两个既有视图以 embedded=true 内嵌', async () => {
    const w = mountHub()
    await tabEl(w, 'canvas').trigger('click')
    await tabEl(w, 'classic').trigger('click')
    await flushPromises()
    expect(canvasStub(w).props('embedded')).toBe(true)
    expect(classicStub(w).props('embedded')).toBe(true)
    w.unmount()
  })

  it('画布的 open-classic 事件切到「工程案例」标签', async () => {
    const w = mountHub()
    await tabEl(w, 'canvas').trigger('click')
    await flushPromises()
    canvasStub(w).vm.$emit('open-classic')
    await flushPromises()
    expect(tabEl(w, 'classic').attributes('aria-selected')).toBe('true')
    expect(classicStub(w).exists()).toBe(true)
    w.unmount()
  })

  it('键盘 →/←/Home/End 切换标签', async () => {
    const w = mountHub()
    await tabEl(w, 'auto').trigger('keydown', { key: 'ArrowRight' })
    await flushPromises()
    expect(tabEl(w, 'canvas').attributes('aria-selected')).toBe('true')
    await tabEl(w, 'canvas').trigger('keydown', { key: 'End' })
    await flushPromises()
    expect(tabEl(w, 'classic').attributes('aria-selected')).toBe('true')
    await tabEl(w, 'classic').trigger('keydown', { key: 'Home' })
    await flushPromises()
    expect(tabEl(w, 'auto').attributes('aria-selected')).toBe('true')
    await tabEl(w, 'auto').trigger('keydown', { key: 'ArrowLeft' })
    await flushPromises()
    expect(tabEl(w, 'classic').attributes('aria-selected')).toBe('true')
    w.unmount()
  })

  it('URL query 变化驱动标签（深链/浏览器前进后退）', async () => {
    const w = mountHub()
    route().query = { tab: 'classic' }
    await nextTick()
    await flushPromises()
    expect(tabEl(w, 'classic').attributes('aria-selected')).toBe('true')
    expect(classicStub(w).exists()).toBe(true)
    w.unmount()
  })

  it('非法 tab 值回退默认 auto', async () => {
    route().query = { tab: 'nope' }
    const w = mountHub()
    await flushPromises()
    expect(tabEl(w, 'auto').attributes('aria-selected')).toBe('true')
    w.unmount()
  })

  it('标签具备 ARIA tab 结构（tablist / tab / tabpanel 关联）', async () => {
    const w = mountHub()
    await flushPromises()
    expect(w.find('[role="tablist"]').exists()).toBe(true)
    expect(tabEl(w, 'auto').attributes('role')).toBe('tab')
    expect(tabEl(w, 'auto').attributes('aria-controls')).toBe('fh-panel-auto')
    expect(panelEl(w, 'auto').attributes('role')).toBe('tabpanel')
    expect(panelEl(w, 'auto').attributes('aria-labelledby')).toBe('fh-tab-auto')
    w.unmount()
  })
})

// ── change: kit-asset-health-report ──────────────────────────────────────
// 资产区（导入入口）的位置锁：资产被三个标签**共用**，所以它必须在页级（页头），
// 而**不能**塞进任何一个 tabpanel。PR-3b 曾把它挂在 classic「项目案例」页面顶部 ——
// 那是「看案例」的只读区，而导入改的是「自动」标签赖以规划的模板库。
describe('FilmEngineeringHubView · 资产区位置（kit-asset-health-report）', () => {
  it('页头有资产区', async () => {
    const w = mountHub()
    await flushPromises()
    expect(w.find('.fh-header [data-testid="fe-asset-manager"]').exists()).toBe(true)
  })

  it('资产区**不在**任何 tabpanel 内（否则又会只在某一个标签里出现）', async () => {
    const w = mountHub()
    await flushPromises()
    for (const id of ['auto', 'canvas', 'classic']) {
      expect(
        w.find('[data-testid="fh-panel-' + id + '"] [data-testid="fe-asset-manager"]').exists(),
        id + ' 面板内不得出现资产区',
      ).toBe(false)
    }
  })

  it('切到任一标签，资产区都仍然只有一个（页级常驻）', async () => {
    const w = mountHub()
    await flushPromises()
    for (const id of ['canvas', 'classic', 'auto']) {
      await tabEl(w, id).trigger('click')
      await nextTick()
      expect(w.findAll('[data-testid="fe-asset-manager"]').length).toBe(1)
    }
  })
})
