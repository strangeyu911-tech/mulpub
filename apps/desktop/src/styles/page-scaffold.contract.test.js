/**
 * page-scaffold.contract.test.js — 页面骨架层的类名/加载顺序/无硬编码色契约
 *
 * 为什么用源码契约而不是只靠截图：
 * ① 五页的骨架类名一旦被某个页面 scoped 样式覆盖，截图只能看出「有点不一样」，
 *    说不出是哪条规则失效；这里把「必须存在的类」钉死在源码上。
 * ② page-scaffold / page-controls / page-skins 是全局层，任何硬编码颜色都会在暗色
 *    主题下变成「白底黑字残留」，而 token 检查在运行时不可见。
 */
import { describe, it, expect } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'

const ROOT = path.resolve(__dirname, '..')
const read = (rel) => fs.readFileSync(path.join(ROOT, rel), 'utf8')

const SCAFFOLD_FILES = [
  'styles/page-scaffold.css',
  'styles/page-controls.css',
  'styles/page-skins.css',
  'styles/page-skins-knowledge.css',
  'styles/page-skins-data.css',
]

const REQUIRED_SELECTORS = {
  'styles/page-scaffold.css': [
    '.mp-page',
    '.mp-page-inner',
    '.mp-page-header',
    '.mp-page-title',
    '.mp-page-subtitle',
    '.mp-page-actions',
    '.mp-panel',
    '.mp-panel-header',
    '.mp-panel-title',
    '.mp-list',
    '.mp-row',
    '.mp-row-title',
    '.mp-row-meta',
    '.mp-row-actions',
  ],
  'styles/page-controls.css': [
    '.mp-btn',
    '.mp-btn--primary',
    '.mp-btn--secondary',
    '.mp-btn--ghost',
    '.mp-btn--danger',
    '.mp-segmented',
    '.mp-search',
    '.mp-field',
    '.mp-form-grid',
    '.mp-chip',
    '.mp-notice',
    '.mp-table',
  ],
  'styles/page-skins.css': [
    '.creator-monitor',
    '.creator-avatar',
    '.copy-library-card',
    '.copy-library-grid',
  ],
  'styles/page-skins-knowledge.css': [
    '.kb-table',
    '.kb-toolbar',
    '.kb-pagination',
  ],
  'styles/page-skins-data.css': [
    '.podcast-section',
    '.podcast-hosting',
    '.podcast-endpoint-card',
  ],
}

const REQUIRED_VIEW_CLASSES = {
  'views/PublishDraftsPage.vue': ['mp-page', 'mp-page-inner', 'mp-page-header', 'mp-panel', 'mp-row'],
  'views/CopyLibraryView.vue': ['mp-page', 'mp-page-inner', 'mp-page-header', 'mp-segmented', 'mp-search'],
  'views/KnowledgeBasePage.vue': ['mp-page', 'mp-page-inner', 'mp-page-header', 'mp-segmented'],
  'views/PodcastChannelView.vue': ['mp-page', 'mp-page-inner', 'mp-page-header', 'mp-panel'],
  'features/collection/CreatorMonitor.vue': ['mp-stack', 'mp-panel', 'mp-row', 'mp-notice'],
}

describe('page scaffold — 文件与加载顺序', () => {
  it('四个样式文件都存在且非空', () => {
    for (const rel of SCAFFOLD_FILES) {
      const text = read(rel)
      expect(text.length, rel).toBeGreaterThan(500)
    }
  })

  it('main.js 在 premium-design-system.css 之后按序导入页面骨架层', () => {
    const main = read('main.js')
    const premium = main.indexOf("import './styles/premium-design-system.css'")
    const scaffold = main.indexOf("import './styles/page-scaffold.css'")
    const controls = main.indexOf("import './styles/page-controls.css'")
    const skins = main.indexOf("import './styles/page-skins.css'")
    const skinsKnowledge = main.indexOf("import './styles/page-skins-knowledge.css'")
    const skinsData = main.indexOf("import './styles/page-skins-data.css'")

    expect(premium).toBeGreaterThanOrEqual(0)
    expect(scaffold).toBeGreaterThan(premium)
    expect(controls).toBeGreaterThan(scaffold)
    expect(skins).toBeGreaterThan(controls)
    expect(skinsKnowledge).toBeGreaterThan(skins)
    expect(skinsData).toBeGreaterThan(skinsKnowledge)
  })
})

describe('page scaffold — 类名契约', () => {
  it('每个样式文件都定义其承诺的类名', () => {
    for (const [rel, selectors] of Object.entries(REQUIRED_SELECTORS)) {
      const text = read(rel)
      for (const selector of selectors) {
        expect(text, `${rel} 缺少 ${selector}`).toContain(selector)
      }
    }
  })

  it('五个目标页面都接入页面骨架类名', () => {
    for (const [rel, classes] of Object.entries(REQUIRED_VIEW_CLASSES)) {
      const text = read(rel)
      for (const cls of classes) {
        expect(text, `${rel} 缺少 ${cls}`).toContain(cls)
      }
    }
  })

  it('博主监控 tab 由 Collection.vue 包进内容容器（此前唯一无留白的 tab）', () => {
    const collection = read('views/Collection.vue')
    expect(collection).toContain('collection-creator-panel')
    expect(collection).toContain('class="cohere-content collection-creator-panel"')
  })

  it('EmptyState 白名单覆盖五个页面的空态图标', () => {
    const empty = read('components/EmptyState.vue')
    for (const icon of ['User', 'Collection', 'Headset', 'Document', 'VideoCamera', 'TrendCharts']) {
      expect(empty).toContain(icon)
    }
  })
})

describe('page scaffold — 无硬编码颜色与动效降级', () => {
  it('四个样式文件不含 #RRGGBB / #RGB 硬编码', () => {
    const hex = /#[0-9a-fA-F]{3,8}\b/
    for (const rel of SCAFFOLD_FILES) {
      expect(hex.test(read(rel)), `${rel} 出现硬编码颜色`).toBe(false)
    }
  })

  it('存在 prefers-reduced-motion 降级规则', () => {
    expect(read('styles/page-scaffold.css')).toContain('prefers-reduced-motion')
    expect(read('styles/page-controls.css')).toContain('prefers-reduced-motion')
    expect(read('styles/page-skins.css')).toContain('prefers-reduced-motion')
  })

  it('页面视图不再自带骨架级 scoped 样式（禁止覆盖页头/页脚节奏）', () => {
    for (const rel of ['views/PublishDraftsPage.vue', 'views/CopyLibraryView.vue', 'views/KnowledgeBasePage.vue', 'views/PodcastChannelView.vue']) {
      const text = read(rel)
      expect(text, `${rel} 不应再含 <style scoped>`).not.toContain('<style scoped>')
    }
  })
})
