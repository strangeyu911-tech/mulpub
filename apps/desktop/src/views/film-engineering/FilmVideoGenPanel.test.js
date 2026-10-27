// @vitest-environment jsdom
/**
 * FilmVideoGenPanel 组件契约（change `film-view-split-debt`）
 *
 * 锁三件事：
 *   ① **挂载即渲染**：`open=true` 且 idle 态 ⇒ 画幅下拉（`fe-video-aspect`）在位（拆了没挂 = 面板空白）；
 *   ② **数据流没反转**：点「开始」时交给 composable 的载荷来自**父传的** `selectedPayload()`；
 *   ③ **`dispose()` 真的被调用**：拆分时顺手修掉的现存泄漏（父视图以前只调 `pdDispose()`），
 *      用桩 composable 计数，卸载后必须为 1 —— 否则这条修复只是注释里的一句话。
 *
 * ⚠ 桩必须返回**真 ref**（`ref(...)`，不是 `{ value: … }` 手写字面量）：模板里的 `phase === 'idle'`
 *   在真 ref 下才会被自动解包成字符串；用假对象时 `phase` 是对象 ⇒ 永远不相等 ⇒ 整面板不渲染。
 *   `vi.mock` 工厂被提升到 import 之前，所以只能在工厂里 `await import('vue')`。
 */
import { describe, it, expect, beforeEach, vi } from 'vitest'
import { mount, flushPromises } from '@vue/test-utils'
import i18n from '@/i18n'

const gen = { disposeCalls: 0, startCalls: [] }

vi.mock('@/composables/useFilmVideoGen', async () => {
  const { ref } = await import('vue')
  return {
    FILM_MAX_VIDEO_BATCH: 8,
    useFilmVideoGen: () => ({
      phase: ref('idle'),
      chosen: ref({ aspect: '16x9', seconds: 5 }),
      busy: ref(false),
      progress: ref(0),
      costCheck: ref(null),
      shotResults: ref([]),
      finalPath: ref(''),
      errorCode: ref(''),
      errorText: ref(''),
      start: async (payload, opts) => { gen.startCalls.push([payload, opts]); return { ok: true } },
      confirmCost: async () => ({ ok: true }),
      cancelCost: async () => ({ ok: true }),
      retryShot: async () => ({ ok: true }),
      reset: () => {},
      dispose: () => { gen.disposeCalls += 1 },
    }),
  }
})
vi.mock('@/api/publisher', () => ({ story2videoShowInFolder: async () => {}, story2videoSaveAs: async () => {} }))

const FilmVideoGenPanel = (await import('./FilmVideoGenPanel.vue')).default

function mountPanel (props) {
  return mount(FilmVideoGenPanel, {
    props: Object.assign({
      open: true,
      selectedPayload: () => [{ shotId: 's1' }],
      selectedCount: 1,
      preview: (t) => t,
    }, props || {}),
    global: {
      plugins: [i18n],
      compilerOptions: { isCustomElement: (tag) => tag.startsWith('el-') },
      stubs: { Teleport: { template: '<div><slot /></div>' }, Transition: { template: '<div><slot /></div>' } },
    },
  })
}

beforeEach(() => { gen.disposeCalls = 0; gen.startCalls = [] })

describe('FilmVideoGenPanel：挂载与数据流', () => {
  it('open=true 且 idle ⇒ 渲染画幅 / 时长下拉与开始按钮', async () => {
    const w = mountPanel()
    await flushPromises()
    expect(w.find('[data-testid="fe-video-aspect"]').exists()).toBe(true)
    expect(w.find('[data-testid="fe-video-seconds"]').exists()).toBe(true)
    expect(w.find('[data-testid="fe-video-start"]').exists()).toBe(true)
  })

  it('点开始 ⇒ 把父的 selectedPayload() 与画幅/时长交给 composable', async () => {
    const w = mountPanel()
    await flushPromises()
    await w.find('[data-testid="fe-video-start"]').trigger('click')
    await flushPromises()
    expect(gen.startCalls.length).toBe(1)
    expect(gen.startCalls[0][0]).toEqual([{ shotId: 's1' }])
    expect(gen.startCalls[0][1]).toEqual({ aspect: '16x9', seconds: 5 })
  })
})

describe('FilmVideoGenPanel：清理钩子（拆分时修掉的泄漏）', () => {
  it('卸载 ⇒ 调一次 dispose()', async () => {
    const w = mountPanel()
    await flushPromises()
    expect(gen.disposeCalls).toBe(0)
    w.unmount()
    expect(gen.disposeCalls).toBe(1)
  })
})

describe('FilmVideoGenPanel：preview 必填（不是可选）', () => {
  /**
   * `preview` 刻意 `required: true`（方案 §接口面）：缺了要让 Vue 立刻 dev 警告、测试当场红。
   * 若给它一个「返回空串」的默认值，漏传就会被渲染成空提示词 —— 那是**静默降级**，
   * 比抛错难查得多。这条用例把「必填」从代码里的一行声明变成有判据盯着的事实。
   */
  it('不传 preview ⇒ Vue 报 Missing required prop 警告', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const w = mount(FilmVideoGenPanel, {
      props: { open: true, selectedPayload: () => [], selectedCount: 0 },
      global: {
        plugins: [i18n],
        compilerOptions: { isCustomElement: (tag) => tag.startsWith('el-') },
        stubs: { Teleport: { template: '<div><slot /></div>' }, Transition: { template: '<div><slot /></div>' } },
      },
    })
    await flushPromises()
    const msgs = warn.mock.calls.map((c) => String(c[0])).join('\n')
    expect(msgs).toContain('Missing required prop')
    expect(msgs).toContain('preview')
    warn.mockRestore()
    w.unmount()
  })
})
