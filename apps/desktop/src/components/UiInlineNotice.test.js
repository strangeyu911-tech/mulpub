import { describe, it, expect } from 'vitest'
import { mount } from '@vue/test-utils'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import UiInlineNotice from './UiInlineNotice.vue'

const here = dirname(fileURLToPath(import.meta.url))
const read = (rel) => readFileSync(join(here, rel), 'utf8')

const TEXT = '已释放 1.00 KB 缓存'

function mountNotice (props = {}) {
  return mount(UiInlineNotice, {
    props: { text: TEXT, testId: 'inline-notice', ...props },
  })
}

describe('UiInlineNotice（内联文字提示条，绿色参考样式）', () => {
  it('渲染文案、对勾图标与关闭钮', () => {
    const w = mountNotice()
    expect(w.text()).toContain(TEXT)
    expect(w.get('.ui-inline-notice-icon svg').exists()).toBe(true)
    expect(w.get('[data-testid="ui-inline-notice-close"]').exists()).toBe(true)
  })

  it('role=status + aria-live=polite 挂在常驻容器上（读屏可播报）', () => {
    const w = mountNotice()
    const root = w.get('.ui-inline-notice-slot')
    expect(root.attributes('role')).toBe('status')
    expect(root.attributes('aria-live')).toBe('polite')
  })

  it('关闭后 live region 仍在 DOM 中（v-if 不得挂在根节点上）', async () => {
    // OfflineIndicator QM-6 i2 同款教训：v-if 挂在带 aria-live 的节点上时，
    // 关闭会把整个 region 移出 DOM，此后再也不会被读屏播报。
    const w = mountNotice({ closeLabel: '关闭提示' })
    expect(w.find('.ui-inline-notice-slot').exists()).toBe(true)
    await w.get('[data-testid="ui-inline-notice-close"]').trigger('click')
    expect(w.find('.ui-inline-notice').exists()).toBe(false)
    expect(w.find('.ui-inline-notice-slot').exists()).toBe(true)
    expect(w.get('.ui-inline-notice-slot').attributes('role')).toBe('status')
  })

  it('播报槽不得用内容即盒子的显示方式（它会把元素移出可访问性树，live region 失效）', () => {
    // deep-review i1：曾用「内容即盒子」的 display 值做到空态不占位，
    // 但多数屏幕阅读器不把该值的元素放进可访问性树 ⇒ role/aria-live 失效。
    // ⚠ 判据必须只扫**声明**，不能扫注释 —— 注释里说明这个禁用原因就会自咬
    //   （本项目 tokens.css 已有同源教训：注释命中让契约锁失效）。
    const src = read('UiInlineNotice.vue')
    const style = src.slice(src.indexOf('<style'))
    const declarations = style.replace(/\/\*[\s\S]*?\*\//g, '')
    expect(declarations).not.toMatch(/display\s*:\s*contents/)
  })

  it('空态隐藏不得靠 :empty（Vue 的 v-if 会留注释占位节点，:empty 永不命中）', async () => {
    // deep-review i2，已用 childNodes 探针实证：v-if 为 false 时 Vue 在 slot 里
    // 留下 1 个 #comment 节点，而 :empty 要求零子节点 ⇒ 空盒一直占位。
    // 正确做法是由 visible 驱动 is-empty-slot 类。这里同时锁住「类存在」与「样式存在」。
    const w = mountNotice({ closeLabel: '关闭提示' })
    await w.get('[data-testid="ui-inline-notice-close"]').trigger('click')

    // ① 关闭后 slot 确实带上隐藏类
    expect(w.get('.ui-inline-notice-slot').classes()).toContain('is-empty-slot')
    // ② 未关闭时不带（不能一开始就隐藏）
    const w2 = mountNotice()
    expect(w2.get('.ui-inline-notice-slot').classes()).not.toContain('is-empty-slot')

    // ③ 样式里必须真的把该类隐藏掉，且不得改用 :empty
    const src = read('UiInlineNotice.vue')
    const style = src.slice(src.indexOf('<style'))
    const declarations = style.replace(/\/\*[\s\S]*?\*\//g, '')
    expect(declarations).toContain('.ui-inline-notice-slot.is-empty-slot')
    expect(declarations).not.toMatch(/:empty/)
  })

  it('关闭后 live region 内不残留旧文案（过期内容不会被重复播报）', async () => {
    // deep-review i4 指控「父级未绑 @close，外层常驻容器为空时可能触发无内容播报」。
    // 实测：visible 为假时内层提示条整体移出 DOM，slot 靠 :empty 隐藏 ⇒ 残留文本无从播报。
    // 本条锁住这个事实：任何把 text 移到 v-if 之外的改动都会让它变红。
    const w = mountNotice({ closeLabel: '关闭提示' })
    expect(w.get('.ui-inline-notice-slot').text()).toContain(TEXT)
    await w.get('[data-testid="ui-inline-notice-close"]').trigger('click')
    expect(w.get('.ui-inline-notice-slot').text()).toBe('')
  })

  it('data-testid 可经 testId 注入（落在提示条上），缺省时不渲染该属性', () => {
    expect(mountNotice().get('.ui-inline-notice').attributes('data-testid')).toBe('inline-notice')
    expect(mountNotice({ testId: '' }).get('.ui-inline-notice').attributes('data-testid')).toBeUndefined()
  })

  it('点击关闭：提示条消失、live region 保留，并上报 close 事件', async () => {
    const w = mountNotice({ closeLabel: '关闭提示' })
    await w.get('[data-testid="ui-inline-notice-close"]').trigger('click')
    expect(w.find('.ui-inline-notice').exists()).toBe(false)
    expect(w.find('.ui-inline-notice-slot').exists()).toBe(true)
    expect(w.emitted('close')).toHaveLength(1)
  })

  it('closable=false 时不渲染关闭钮', () => {
    expect(mountNotice({ closable: false }).find('[data-testid="ui-inline-notice-close"]').exists()).toBe(false)
  })

  it('关闭钮带 aria-label（有值才渲染，空串不渲染无名按钮）', () => {
    expect(mountNotice({ closeLabel: '关闭提示' }).get('[data-testid="ui-inline-notice-close"]').attributes('aria-label')).toBe('关闭提示')
    expect(mountNotice().find('[data-testid="ui-inline-notice-close"]').attributes('aria-label')).toBeUndefined()
  })

  it('对勾图标装饰性隐藏（aria-hidden=true），不重复播报', () => {
    expect(mountNotice().get('.ui-inline-notice-icon svg').attributes('aria-hidden')).toBe('true')
  })
})

describe('UiInlineNotice 样式契约（token 单一来源）', () => {
  it('颜色一律走 --color-inline-notice-* 语义槽，无 hex 字面量、无就地 rgba', () => {
    const src = read('UiInlineNotice.vue')
    const style = src.slice(src.indexOf('<style'))
    expect(style).not.toMatch(/#[0-9a-fA-F]{3,8}\b/)
    // deep-review i3：hover 曾就地写 rgba(4,181,75,.12)，等于第二套品牌绿派生色
    expect(style).not.toMatch(/\brgba?\s*\(/)
    expect(style).toContain('var(--color-inline-notice-bg)')
    expect(style).toContain('var(--color-inline-notice-border)')
    expect(style).toContain('var(--color-inline-notice-text)')
    expect(style).toContain('var(--color-inline-notice-ink)')
    expect(style).toContain('var(--color-inline-notice-hover)')
  })

  // 提示条 token 的宿主文件。2026-10-26 起从 tokens.css 拆到独立文件
  // （tokens.css 已被 check-max-lines 盯在 500 行线上，继续堆会触发 NEW_OVER_LIMIT）。
  // 判据仍按「亮暗两档成对 + 对比度 + 禁就地色值」三条锁，拆走不等于失守。
  const noticeTokens = () => read('../styles/inline-notice-tokens.css')
  const mainTokens = () => read('../styles/tokens.css')

  it('提示条 token 宿主文件同时定义亮色与暗色两档（spec：主题令牌必须自带暗色覆盖）', () => {
    const tokens = noticeTokens()
    const darkStart = tokens.indexOf('[data-theme=')
    expect(darkStart).toBeGreaterThan(-1)
    const dark = tokens.slice(darkStart)
    for (const slot of ['bg', 'border', 'text', 'ink', 'hover']) {
      expect(tokens).toContain(`--color-inline-notice-${slot}:`)
      expect(dark).toContain(`--color-inline-notice-${slot}:`)
    }
  })

  it('tokens.css 内不得再出现提示条槽位（已拆出，双持必然漂移）', () => {
    // 拆走的目的是给 tokens.css 瘦身；若两处都留一份，下次改色只会改一处。
    expect(mainTokens()).not.toMatch(/--color-inline-notice-/)
  })

  it('main.js 引入了提示条 token 文件（否则整组槽位不生效）', () => {
    expect(read('../main.js')).toContain("styles/inline-notice-tokens.css")
  })

  it('暗色档与亮色档不同值（不得把亮色值原样搬进暗色）', () => {
    const tokens = noticeTokens()
    const darkStart = tokens.indexOf('[data-theme=')
    const light = tokens.slice(0, darkStart)
    const dark = tokens.slice(darkStart)
    for (const slot of ['bg', 'border', 'text']) {
      const pick = (s) => s.match(new RegExp(`--color-inline-notice-${slot}:\\s*([^;]+);`))[1].trim()
      expect(pick(light)).not.toBe(pick(dark))
    }
  })

  it('文字档在底色上对比度 ≥ 4.5:1（WCAG AA 正文，亮暗两档都算）', () => {
    // 与 scripts/check-trial-banner-contrast.js 同一套 WCAG 相对亮度公式
    const srgbToLinear = (v) => { const c = v / 255; return c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4) }
    const lum = ([r, g, b]) => 0.2126 * srgbToLinear(r) + 0.7152 * srgbToLinear(g) + 0.0722 * srgbToLinear(b)
    const ratio = (a, b) => { const [hi, lo] = lum(a) >= lum(b) ? [lum(a), lum(b)] : [lum(b), lum(a)]; return (hi + 0.05) / (lo + 0.05) }
    const hex = (h) => [0, 2, 4].map((i) => parseInt(h.replace('#', '').slice(i, i + 2), 16))

    const tokens = noticeTokens()
    const darkStart = tokens.indexOf('[data-theme=')
    const light = tokens.slice(0, darkStart)
    const dark = tokens.slice(darkStart)
    const pick = (s, slot) => s.match(new RegExp(`--color-inline-notice-${slot}:\\s*([^;]+);`))[1].trim()

    const lightRatio = ratio(hex(pick(light, 'text')), hex(pick(light, 'bg')))
    const darkRatio = ratio(hex(pick(dark, 'text')), hex(pick(dark, 'bg')))
    expect(lightRatio).toBeGreaterThanOrEqual(4.5)
    expect(darkRatio).toBeGreaterThanOrEqual(4.5)
  })
})
