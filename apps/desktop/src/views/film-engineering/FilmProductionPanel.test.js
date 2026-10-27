// @vitest-environment jsdom
/**
 * FilmProductionPanel 组件契约（change `film-view-split-debt`）
 *
 * 锁四件事：
 *   ① **挂载不崩**：`open=false` + idle ⇒ 组件存在、计划态内容不渲染（拆了没挂 = 入口点了没反应）；
 *   ② **打开即 plan**：父把 `open` 置 true 后调 `onOpened()` ⇒ 用**父传的** selectedIds 触发 plan
 *      （这行为原来写在父视图 `openProductionPanel()` 里，搬家后不许丢）；
 *   ③ **锚点逐字还在**：源码里 `(sh, si)` 与 `b.shots` 两段必须保留 —— `list-stable-keys.test.js`
 *      以它们拼成的表达式作机械锚点（这里加一条本文件级哨兵，防「改着改着顺手重命名」）；
 *   ④ **`dispose()` 被调用**：清理钩子随组件走。
 */
import { describe, it, expect, beforeEach, vi } from 'vitest'
import { mount, flushPromises } from '@vue/test-utils'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import path from 'node:path'
import i18n from '@/i18n'

const pd = { planCalls: [], disposeCalls: 0 }

vi.mock('@/composables/useFilmProduction', async () => {
  const { ref } = await import('vue')
  return {
    useFilmProduction: () => ({
      phase: ref('idle'),
      busy: ref(false),
      plan: ref({ batchCount: 0, batchSize: 0, shotCount: 0, diskEstimateBytes: 0, wallclockEstimateSeconds: 0, mediaRoot: '' }),
      chosen: ref({ aspect: '16x9', seconds: 5 }),
      batches: ref([]),
      progress: ref({ doneCount: 0, totalCount: 0 }),
      renderManifest: ref([]),
      manifestError: ref(''),
      confirmedShotCount: ref(0),
      remainingBatchCount: ref(0),
      recycled: ref(null),
      finalPath: ref(''),
      errorCode: ref(''),
      errorText: ref(''),
      planProduction: async (ids) => { pd.planCalls.push(ids) },
      begin: () => ({ ok: true }),
      confirmBatch: async () => ({ ok: true }),
      resume: async () => ({ ok: true }),
      retryShotInBatch: async () => ({ ok: true }),
      recycleAll: async () => ({ ok: true }),
      composeFinal: async () => ({ ok: true }),
      reset: () => {},
      dispose: () => { pd.disposeCalls += 1 },
    }),
  }
})
vi.mock('@/api/publisher', () => ({ story2videoShowInFolder: async () => {}, story2videoSaveAs: async () => {} }))

const FilmProductionPanel = (await import('./FilmProductionPanel.vue')).default

function mountPanel (props) {
  return mount(FilmProductionPanel, {
    props: Object.assign({
      open: false,
      selectedIds: ['s1', 's2'],
      selectedCount: 2,
      preview: (t) => t,
    }, props || {}),
    global: {
      plugins: [i18n],
      compilerOptions: { isCustomElement: (tag) => tag.startsWith('el-') },
      stubs: { Teleport: { template: '<div><slot /></div>' }, Transition: { template: '<div><slot /></div>' } },
    },
  })
}

beforeEach(() => { pd.planCalls = []; pd.disposeCalls = 0 })

describe('FilmProductionPanel：挂载与打开即 plan', () => {
  it('open=false ⇒ 组件可挂载且不渲染计划态内容', async () => {
    const w = mountPanel()
    await flushPromises()
    expect(w.exists()).toBe(true)
    expect(w.find('[data-testid="fe-production-taskid"]').exists()).toBe(false)
  })

  it('onOpened() ⇒ 用父传的 selectedIds 触发 plan', async () => {
    const w = mountPanel()
    await flushPromises()
    w.vm.onOpened()
    await flushPromises()
    expect(pd.planCalls.length).toBe(1)
    expect(pd.planCalls[0]).toEqual(['s1', 's2'])
  })
})

describe('FilmProductionPanel：源码锚点与清理', () => {
  it('保留 `(sh, si)` 与 `b.shots` 两段（list-stable-keys 的机械锚点）', () => {
    const src = readFileSync(path.dirname(fileURLToPath(import.meta.url)) + '/FilmProductionPanel.vue', 'utf8')
    expect(src).toContain('(sh, si)')
    expect(src).toContain('in b.shots')
    expect(src).toContain(':key="sh.shotId || si"')
  })

  it('卸载 ⇒ 调一次 dispose()', async () => {
    const w = mountPanel()
    await flushPromises()
    w.unmount()
    expect(pd.disposeCalls).toBe(1)
  })
})
