// @vitest-environment jsdom
/**
 * FilmShotDetailDrawer 组件契约（change `film-view-split-debt`）
 *
 * 锁三件事：
 *   ① **挂载即渲染**：`open=true` + 有 shot ⇒ 四个复制按钮（`fe-detail-copy`）在位 + 参考 token 可见；
 *   ② **只读 + 动作回父**：复制与复制 token 都走 `emit`（子组件不直接碰 clipboard / IPC）；
 *      `copy-token` 回传的就是模板上**已经明文展示**的那串 token；
 *   ③ `shot=null` ⇒ 不渲染空壳。
 */
import { describe, it, expect } from 'vitest'
import { mount, flushPromises } from '@vue/test-utils'
import i18n from '@/i18n'
import FilmShotDetailDrawer from './FilmShotDetailDrawer.vue'

const SHOT = {
  shotId: 'shot-0123456789',
  model: 'vg-model-x',
  width: 1920,
  height: 1080,
  prompt: 'INT. STUDIO - DAY\n\n[CHARACTER: ROKO]\nACTION TIMING: slow push',
  resolvedRefs: [
    { token: '@ROKO', entry: { name: 'ROKO', kind: 'character', imageUrls: ['https://example.com/a.png'] } },
  ],
}

function mountDrawer (props) {
  return mount(FilmShotDetailDrawer, {
    props: Object.assign({ open: true, shot: SHOT, loading: false, preview: (t2, max) => String(t2).slice(0, max) }, props || {}),
    global: {
      plugins: [i18n],
      compilerOptions: { isCustomElement: (tag) => tag.startsWith('el-') },
      stubs: { Teleport: { template: '<div><slot /></div>' }, Transition: { template: '<div><slot /></div>' } },
    },
  })
}

describe('FilmShotDetailDrawer：渲染', () => {
  it('open=true 且有 shot ⇒ 复制按钮 + 参考 token + 尺寸在位', async () => {
    const w = mountDrawer()
    await flushPromises()
    expect(w.find('[data-testid="fe-detail-copy"]').exists()).toBe(true)
    expect(w.text()).toContain('@ROKO')
    expect(w.text()).toContain('1920×1080')
  })

  it('shot=null ⇒ 不渲染内容（不印空壳）', async () => {
    const w = mountDrawer({ shot: null })
    await flushPromises()
    expect(w.find('[data-testid="fe-detail-copy"]').exists()).toBe(false)
  })
})

describe('FilmShotDetailDrawer：动作回父（只读边界）', () => {
  it('点「复制全文」⇒ emit copy(full)', async () => {
    const w = mountDrawer()
    await flushPromises()
    await w.find('[data-testid="fe-detail-copy"]').trigger('click')
    expect(w.emitted('copy')).toBeTruthy()
    expect(w.emitted('copy')[0]).toEqual(['full'])
  })

  it('点「复制 token」⇒ emit copy-token(模板里已明文展示的那串)', async () => {
    const w = mountDrawer()
    await flushPromises()
    const btn = w.find('[data-testid="fe-detail-copy-token"]')
    expect(btn.exists()).toBe(true)
    await btn.trigger('click')
    expect(w.emitted('copy-token')[0]).toEqual(['@ROKO'])
  })
})
