/**
 * PlatformDataGrid.test.js — 「各平台数据」区块（2026-10-25 数据真实性 + 样式统一）
 *
 * 三条主线：
 * ① **不显示假数字**：取不到真值的指标渲染成「—」，**不是 0**
 *    （事故：旧实现的 `item.views ?? '-'` 对 0 无效 ⇒ 恒 0 的占位记录被渲染成
 *    「0阅读」，看上去像刚采到的真数据）；
 * ② **口径写在卡面上**：副标题必须说清作品数与回采时间，不能再显示那个
 *    来自占位记录的「更新于 <syncedAt>」；
 * ③ **指标行有结构**：四个指标是四列等宽的「标签在上 / 数值在下」，
 *    不是一堆裸文本（旧实现的 .card-stats/.stat-item/.stat-num/.stat-lbl
 *    **全仓没有任何定义** ⇒ 实际渲染成无样式的逐行堆叠）。
 */
import { describe, it, expect, vi } from 'vitest'
import { mount } from '@vue/test-utils'
import { nextTick } from 'vue'
import { createPinia } from 'pinia'
import i18n from '@/i18n'
import zhDashboard from '@/locales/dashboard/zh'
import enDashboard from '@/locales/dashboard/en'
import {
  FANS_REASON_SELECTOR,
  FANS_REASON_NOT_READY,
  FANS_REASON_UNKNOWN,
  FANS_REASON_LOCALE_KEYS,
} from './dashboard-panels-model'

vi.mock('@/stores/platforms', () => ({
  usePlatformStore: () => ({
    load: vi.fn(),
    getLabel: (k) => ({ douyin: '抖音', zhihu: '知乎' }[k] || k),
    getIcon: () => '📱',
  }),
}))

import PlatformDataGrid from './PlatformDataGrid.vue'

function mountGrid (model) {
  return mount(PlatformDataGrid, {
    props: { model },
    global: { plugins: [createPinia(), i18n] },
  })
}

describe('PlatformDataGrid 各平台数据', () => {
  it('有数据时按平台渲染卡片，并给出作品数与回采时间', async () => {
    const w = mountGrid({
      rows: [{
        platform: 'douyin',
        articles: 12,
        views: 100,
        likes: 20,
        comments: 5,
        fans: null,
        contents: 3,
        lastCapturedAt: '2026-10-20T09:00:00.000Z',
      }],
    })
    await nextTick()
    expect(w.find('[data-testid="platform-card-douyin"]').exists()).toBe(true)
    const meta = w.find('[data-testid="platform-meta"]').text()
    expect(meta).toContain('12')
    // 回采时间必须出现（而不是旧的占位记录时间戳）
    expect(meta).toMatch(/回采/)
  })

  it('取不到真值的指标显示「—」，不显示 0', async () => {
    const w = mountGrid({
      rows: [{
        platform: 'zhihu',
        articles: 4,
        views: null,
        likes: null,
        comments: null,
        fans: null,
        contents: null,
        lastCapturedAt: null,
      }],
    })
    await nextTick()
    expect(w.find('[data-testid="platform-zhihu-views"]').text()).toBe('—')
    expect(w.find('[data-testid="platform-zhihu-likes"]').text()).toBe('—')
    expect(w.find('[data-testid="platform-zhihu-comments"]').text()).toBe('—')
    expect(w.find('[data-testid="platform-zhihu-fans"]').text()).toBe('—')
    expect(w.text()).not.toContain('0阅读')
  })

  it('真实的 0 必须照常显示 0（不能一律显示「—」）', async () => {
    const w = mountGrid({
      rows: [{
        platform: 'douyin',
        articles: 0,
        views: 0,
        likes: 0,
        comments: 0,
        fans: 0,
        contents: 0,
        lastCapturedAt: '2026-10-20T09:00:00.000Z',
      }],
    })
    await nextTick()
    expect(w.find('[data-testid="platform-douyin-views"]').text()).toBe('0')
    expect(w.find('[data-testid="platform-douyin-fans"]').text()).toBe('0')
  })

  it('没有平台时渲染空态而不是空卡片', async () => {
    const w = mountGrid({ rows: [] })
    await nextTick()
    expect(w.find('[data-testid="platform-card-douyin"]').exists()).toBe(false)
    // EmptyState 的根节点类（比按组件名找更稳：script setup 的组件名靠推断）
    expect(w.find('.mp-empty-state').exists()).toBe(true)
  })

  it('指标区是四列结构（标签在上 / 数值在下），不是裸文本堆叠', async () => {
    const w = mountGrid({
      rows: [{
        platform: 'douyin',
        articles: 1,
        views: 1,
        likes: 1,
        comments: 1,
        fans: 1,
        contents: 1,
        lastCapturedAt: '2026-10-20T09:00:00.000Z',
      }],
    })
    await nextTick()
    expect(w.findAll('.dash-platform-metric')).toHaveLength(4)
    expect(w.findAll('.dash-platform-metric-label')).toHaveLength(4)
    expect(w.findAll('.dash-platform-metric-value')).toHaveLength(4)
  })

  it('模板里的可见文案全部走 locale（不得残留中文字面量）', () => {
    const src = require('fs').readFileSync(require('path').join(__dirname, 'PlatformDataGrid.vue'), 'utf8')
    const template = src.slice(0, src.indexOf('<script'))
    const visible = template.replace(/<!--[\s\S]*?-->/g, '')
    expect(visible.match(/[一-龥]/g) || [], '模板内残留中文字面量').toEqual([])
  })
})

// ─── 账号级粉丝三态（2026-10-25，PR-2 上屏）────────────────────────
// 三态纪律：拿到真值 → 数字；没采过 → 「—」+「尚未采集」；采失败 → 「—」+「暂时无法获取（原因）」。
// **任何一态都不给 0**，且失败时给的是**可读原因**（不是内部错误码）。
describe('PlatformDataGrid 账号级粉丝三态', () => {
  const row = (extra) => ({
    platform: 'douyin',
    articles: 3,
    views: 10,
    likes: 2,
    comments: 1,
    fans: null,
    contents: 2,
    lastCapturedAt: '2026-10-20T09:00:00.000Z',
    ...extra,
  })

  it('ready ⇒ 显示数字 + 副标题带「账号级」与「数据截至」', async () => {
    const w = mountGrid({
      rows: [row({ fans: 12000, fansState: 'ready', fansAsOf: '2026-10-25T10:00:00.000Z' })],
    })
    await nextTick()
    expect(w.find('[data-testid="platform-douyin-fans"]').text()).toBe('12,000')
    const meta = w.find('[data-testid="platform-meta"]').text()
    expect(meta).toContain('账号级')
    expect(meta).toContain('数据截至')
  })

  it('⛔ pending ⇒ 显示「—」+「尚未采集粉丝数据」（绝不显示 0）', async () => {
    const w = mountGrid({ rows: [row({ fansState: 'pending' })] })
    await nextTick()
    expect(w.find('[data-testid="platform-douyin-fans"]').text()).toBe('—')
    const meta = w.find('[data-testid="platform-meta"]').text()
    expect(meta).toContain('尚未采集粉丝数据')
    expect(w.text()).not.toContain('0粉丝')
  })

  it('⛔ error ⇒ 显示「—」+「粉丝数据暂时无法获取（可读原因）」，且不泄漏内部错误码', async () => {
    const w = mountGrid({ rows: [row({ fansState: 'error', fansReason: 'selector' })] })
    await nextTick()
    expect(w.find('[data-testid="platform-douyin-fans"]').text()).toBe('—')
    const meta = w.find('[data-testid="platform-meta"]').text()
    expect(meta).toContain('粉丝数据暂时无法获取')
    expect(meta).toContain('平台页面结构已变化')
    // 内部错误码不得出现在界面上
    expect(w.text()).not.toContain('COLLECT_FIELD_MISSING')
    expect(w.text()).not.toContain('selector')
  })

  it('⛔ 三个状态都带「账号级」口径标注（粉丝与三个作品级指标不是一回事）', async () => {
    for (const state of ['ready', 'pending', 'error']) {
      const w = mountGrid({ rows: [row({ fansState: state, fans: state === 'ready' ? 100 : null, fansReason: 'selector' })] })
      await nextTick()
      const meta = w.find('[data-testid="platform-meta"]').text()
      expect(meta, state).toContain('账号级')
    }
  })

  it('⛔ 机械锁：每个失败原因 token 都有 zh/en 文案，且每条文案都被映射（漏一条当场红）', () => {
    const tokens = [FANS_REASON_SELECTOR, FANS_REASON_NOT_READY, FANS_REASON_UNKNOWN]
    const mapped = new Set()
    for (const token of tokens) {
      const key = FANS_REASON_LOCALE_KEYS[token]
      expect(key, `token ${token} 没有映射`).toBeTruthy()
      const short = key.replace(/^dashboard\./, '')
      expect(zhDashboard[short], `zh 缺 ${short}`).toBeTruthy()
      expect(enDashboard[short], `en 缺 ${short}`).toBeTruthy()
      mapped.add(short)
    }
    // 反向：locale 里多余的 followersReason* 文案也要被映射（否则是永远用不到的死文案）
    for (const key of Object.keys(zhDashboard)) {
      if (key.startsWith('followersReason')) {
        expect(mapped.has(key), `locale 里的 ${key} 没有任何 token 指向它`).toBe(true)
      }
    }
  })
})
