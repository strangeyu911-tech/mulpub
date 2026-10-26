/**
 * PublishDraftsPage.test.js — 草稿页骨架/显示项/事件契约
 *
 * 抽组件的原因见组件头注释：既统一视觉，又把 Publish.vue 从 1775 行门禁下救出来。
 * 本套件锁三件事：
 * ① 每条草稿的「标题 / 更新时间 / 平台数」都在，且空值有回退；
 * ② 三个动作 emit 的参数形状（open 传整条、delete 传 id、back 无参）；
 * ③ 加载态必须是骨架而不是空态（否则首帧会被误读成「没有草稿」）。
 */
import { describe, it, expect } from 'vitest'
import { mount } from '@vue/test-utils'
import i18n from '@/i18n'
import PublishDraftsPage from './PublishDraftsPage.vue'

const baseDraft = {
  id: 'd1',
  title: '一篇草稿',
  updatedAt: '2026-10-26T10:00:00+08:00',
  platforms: ['wechat', 'xiaohongshu'],
}

function mountPage (props = {}) {
  return mount(PublishDraftsPage, {
    props: { drafts: [], loading: false, ...props },
    global: { plugins: [i18n] },
  })
}

describe('PublishDraftsPage — 页面骨架', () => {
  it('渲染统一页头与面板', () => {
    const w = mountPage({ drafts: [baseDraft] })
    expect(w.find('.mp-page').exists()).toBe(true)
    expect(w.find('.mp-page-header').exists()).toBe(true)
    expect(w.find('.mp-page-title').text()).toBe('草稿箱')
    expect(w.find('.mp-panel').exists()).toBe(true)
    expect(w.find('[data-testid="publish-drafts-count"]').text()).toContain('1')
  })
})

describe('PublishDraftsPage — 显示项', () => {
  it('标题/时间/平台数按草稿渲染', () => {
    const w = mountPage({ drafts: [baseDraft] })
    const row = w.find('[data-testid="publish-drafts-list"] .mp-row')
    expect(row.text()).toContain('一篇草稿')
    expect(row.text()).toContain('2 个平台')
    expect(row.find('.mp-row-title').attributes('title')).toBe('一篇草稿')
  })

  it('标题为空显示「无标题」，时间不可解析显示「更新时间未知」', () => {
    const w = mountPage({ drafts: [{ id: 'd2', title: '', updatedAt: 'not-a-date' }] })
    const row = w.find('[data-testid="publish-drafts-list"] .mp-row')
    expect(row.text()).toContain('无标题')
    expect(row.text()).toContain('更新时间未知')
  })
})

describe('PublishDraftsPage — 状态', () => {
  it('加载中渲染骨架而不是空态', () => {
    const w = mountPage({ loading: true })
    expect(w.find('[data-testid="publish-drafts-loading"]').exists()).toBe(true)
    expect(w.find('[data-testid="publish-drafts-empty"]').exists()).toBe(false)
    expect(w.find('.mp-skeleton').exists()).toBe(true)
  })

  it('无草稿渲染完整空态（标题+说明+返回动作）', async () => {
    const w = mountPage()
    const empty = w.find('[data-testid="publish-drafts-empty"]')
    expect(empty.exists()).toBe(true)
    expect(empty.text()).toContain('暂无草稿')
    expect(empty.text()).toContain('保存草稿后')
    await empty.find('.mp-empty-state__action').trigger('click')
    expect(w.emitted('back')).toHaveLength(1)
  })
})

describe('PublishDraftsPage — 事件', () => {
  it('「去发布」emit open 且带整条草稿', async () => {
    const w = mountPage({ drafts: [baseDraft] })
    await w.find('[data-testid="publish-draft-d1"]').trigger('click')
    expect(w.emitted('open')[0][0]).toMatchObject({ id: 'd1', title: '一篇草稿' })
  })

  it('「删除」emit delete 且只带 id', async () => {
    const w = mountPage({ drafts: [baseDraft] })
    await w.find('[data-testid="delete-draft-d1"]').trigger('click')
    expect(w.emitted('delete')[0]).toEqual(['d1'])
  })

  it('「返回发布」emit back', async () => {
    const w = mountPage({ drafts: [baseDraft] })
    await w.find('[data-testid="publish-drafts-back"]').trigger('click')
    expect(w.emitted('back')).toHaveLength(1)
  })
})
