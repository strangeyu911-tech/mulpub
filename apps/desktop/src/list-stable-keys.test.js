/**
 * 列表稳定键合同（UX 审计 4.8 `:key` 半边 · 第二批）
 *
 * 两类锁，各证一件事，不可互相替代：
 *  A) 行为锁：index 作 `:key` 时 Vue 按**位置**复用 DOM 节点 —— 删掉首项后，第二项会落进
 *     第一项原来的节点。节点上承载的非模型态（焦点、hover 直改 style、子组件内部态、
 *     TransitionGroup 位移动画）因此跟错了项。断言取的是「同一个 DOM 节点对象」这一事实。
 *  B) 结构合同：逐个点名本次收口的站点，在其**开标签属性段内**解析 `:key` 表达式，
 *     判据是「表达式必须引用 v-for 的项绑定；下标绑定只允许出现在 `||` 兜底位」。
 *     刻意不做全仓扫描（那会把静态骨架屏等中性写法一起判红），
 *     也不得改成 `src.includes(':key="i"')` 那种字符串判据 —— 注释里出现同名串就会误报。
 */
import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, resolve } from 'node:path'
import { mount } from '@vue/test-utils'
import BoardStageIndicator from './components/BoardStageIndicator.vue'

const SRC = resolve(dirname(fileURLToPath(import.meta.url)), '.')

// —— B) 结构合同：本次收口的站点 ——
const SITES = [
  { file: 'components/AnnouncementBanner.vue', marker: 'in visibleAnnouncements', item: 'a' },
  { file: 'components/BoardStageIndicator.vue', marker: 'in stages', item: 'stage' },
  { file: 'components/SceneCard.vue', marker: 'in displayedTakes', item: 'take' },
  { file: 'views/AutoPipelineView.vue', marker: 'in config.urls', item: 'u' },
  { file: 'views/AutoPipelineView.vue', marker: 'in currentRun.stages', item: 'stage' },
  { file: 'views/Calendar.vue', marker: 'in calendarDays', item: 'day' },
  { file: 'views/PromptEvalView.vue', marker: 'in selectedImages', item: 'img' },
  { file: 'features/collection/BatchCollectPanel.vue', marker: 'in zhihuFavItems', item: 'it' },
  { file: 'views/FilmEngineeringView.vue', marker: 'in b.shots', item: 'sh' },
]

/**
 * 取包含 marker 的那个开标签。
 * 前向找 `>` 必须跳过引号内的 `>`（本仓有 `@mouseover="e => …"` 这类属性值），
 * 否则会在属性值里截断、使该站点静默漏扫 —— 见 AGENTS.md「扫开始标签禁止朴素正则」。
 */
function openingTagOf (src, marker) {
  const at = src.indexOf(marker)
  if (at < 0) return null
  const lt = src.lastIndexOf('<', at)
  if (lt < 0) return null
  let inQuote = null
  for (let i = lt; i < src.length; i++) {
    const ch = src[i]
    if (inQuote) {
      if (ch === inQuote) inQuote = null
      continue
    }
    if (ch === '"' || ch === "'") { inQuote = ch; continue }
    if (ch === '>') return src.slice(lt, i + 1)
  }
  return null
}

/** 从属性段取 :key 表达式（:key / v-bind:key，单双引号都认） */
function keyExprOf (tag) {
  const m = /(?:^|[\s:])key\s*=\s*"([^"]*)"|key\s*=\s*'([^']*)'/.exec(tag)
  return m ? (m[1] ?? m[2]) : null
}

/** v-for 里的下标绑定名（`v-for="(stage, i) in stages"` → `i`） */
function indexBindingOf (tag) {
  const m = /v-for="\s*\(\s*\w+\s*,\s*(\w+)\s*\)\s*in\b/.exec(tag)
  return m ? m[1] : null
}

/** 标识符独立成词（不认 `si` 里的 `i`、不认 `idx2` 里的 `idx`） */
function hasToken (expr, token) {
  return new RegExp(`(^|[^A-Za-z0-9_$])${token}($|[^A-Za-z0-9_$])`).test(expr)
}

describe('列表稳定键合同（审计 4.8）', () => {
  describe('B) 结构合同：收口站点的 :key 必须引用项而非下标', () => {
    it('扫描域非空（判据退化时不得静默通过）', () => {
      expect(SITES.length).toBeGreaterThan(0)
    })

    for (const site of SITES) {
      it(`${site.file} 的 \`${site.marker}\` 循环键引用项 ${site.item}`, () => {
        const src = readFileSync(resolve(SRC, site.file), 'utf8').replace(/\r\n/g, '\n')
        const tag = openingTagOf(src, site.marker)
        // 自证探针通路：取不到开标签就是扫描器坏了，不得读成「合规」
        expect(tag, `未在 ${site.file} 定位到含 "${site.marker}" 的开标签`).not.toBeNull()
        expect(tag).toContain('v-for')
        const expr = keyExprOf(tag)
        expect(expr, `${site.file} 的该开标签没有 :key`).not.toBeNull()

        expect(hasToken(expr, site.item), `${site.file} 的 :key="${expr}" 未引用项绑定 ${site.item}`)
          .toBe(true)

        const idx = indexBindingOf(tag)
        if (idx && idx !== site.item) {
          const fallbackOnly = new RegExp(`\\|\\|\\s*${idx}\\s*$`).test(expr)
          expect(
            hasToken(expr, idx) && !fallbackOnly,
            `${site.file} 的 :key="${expr}" 把下标 ${idx} 用作主键（只允许 \`… || ${idx}\` 兜底）`,
          ).toBe(false)
        }
      })
    }
  })

  describe('A) 行为锁：节点身份跟随项身份，不跟随位置', () => {
    const stageNodes = (wrapper) => wrapper.findAll('.stage-node')

    it('删除列表首项后，渲染第二项的仍是同一个 DOM 节点', async () => {
      const wrapper = mount(BoardStageIndicator, {
        props: { stages: [{ name: 'zz-alpha' }, { name: 'zz-beta' }, { name: 'zz-gamma' }], currentIndex: 0 },
      })
      const els = stageNodes(wrapper)
      // 夹具自证：三档都在，且第二档确实渲染了 zz-beta（`friendlyName` 会映射已知阶段名，故夹具刻意用未映射名）
      expect(els.length).toBe(3)
      expect(els[1].text()).toContain('zz-beta')

      els[1].element.__identity = 'beta-node'
      await wrapper.setProps({ stages: [{ name: 'zz-beta' }, { name: 'zz-gamma' }] })

      const after = stageNodes(wrapper)
      expect(after.length).toBe(2)
      expect(after[0].text()).toContain('zz-beta')
      // index 作 key 时 Vue 按位置复用：after[0] 是「原来 zz-alpha 那一档的节点」，标记不在它身上
      expect(after[0].element.__identity).toBe('beta-node')
    })

    it('列表重排时，节点跟随项移动而不是原地换内容', async () => {
      const wrapper = mount(BoardStageIndicator, {
        props: { stages: [{ name: 'zz-a' }, { name: 'zz-b' }], currentIndex: 1 },
      })
      const before = stageNodes(wrapper)
      expect(before.length).toBe(2)
      before[1].element.__identity = 'b-node'

      await wrapper.setProps({ stages: [{ name: 'zz-b' }, { name: 'zz-a' }] })

      const after = stageNodes(wrapper)
      expect(after[0].text()).toContain('zz-b')
      expect(after[0].element.__identity).toBe('b-node')
    })
  })
})
