/**
 * ArticleEditor 的字数上限接线（UX 审计 4.7 ②③）
 *
 * 两件事分开锁：
 *  A) 行为锁：`maxChars` 是**调用方给的平台预算**，不是应用级默认值。
 *     非法档（null / 0 / NaN / 负数 / 非数字）一律回落 `APP_ARTICLE_CONTENT_MAX`——
 *     这条在被接线之前不存在：`minContentBudget()` 未选平台时返回 `null`，
 *     直接绑上去计数器会渲染成「12/null」，等于把一个静默的语义空洞暴露给用户。
 *  B) 结构合同：`Publish.vue` 的 `<ArticleEditor>` 开标签必须真的把平台预算绑上去
 *     （改前该标签只有 v-model，编辑器恒显示应用级通用上限，用户看到「还差得远」
 *     却被快手 480 字符的校验拦下）。判据在**开标签属性段内**取，不做全文件字符串包含。
 */
import { describe, it, expect } from 'vitest'
import { mount } from '@vue/test-utils'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, resolve } from 'node:path'
import ArticleEditor from './ArticleEditor.vue'
import { APP_ARTICLE_CONTENT_MAX } from '@/features/publish/publish-contract'
import i18n from '@/i18n'

const SRC = resolve(dirname(fileURLToPath(import.meta.url)), '..')

const mountEditor = (props = {}) => mount(ArticleEditor, {
  props: { modelValue: '第一段内容测试', ...props },
  global: { plugins: [i18n], stubs: { QuillEditor: true, Teleport: true, Transition: true } },
})

describe('ArticleEditor 字数上限接线（审计 4.7 ②③）', () => {
  describe('A) 行为锁：调用方给的上限生效，非法档回落默认值', () => {
    const counter = (w) => w.get('[data-testid="article-char-counter"]').text()

    it('显式传入的上限直接决定计数器分母', () => {
      expect(counter(mountEditor({ maxChars: 480 }))).toContain('/480')
    })

    it('它确实不是默认值（否则本批接线毫无意义）', () => {
      expect(counter(mountEditor({ maxChars: 480 }))).not.toContain(`/${APP_ARTICLE_CONTENT_MAX}`)
      expect(counter(mountEditor({}))).toContain(`/${APP_ARTICLE_CONTENT_MAX}`)
    })

    for (const bad of [null, undefined, 0, -5, Number.NaN, 'abc', '']) {
      it(`非法档 ${JSON.stringify(bad) ?? String(bad)} 回落 APP_ARTICLE_CONTENT_MAX，不得渲染成 /null 或 /NaN`, () => {
        const text = counter(mountEditor({ maxChars: bad }))
        expect(text).toContain(`/${APP_ARTICLE_CONTENT_MAX}`)
        expect(text).not.toMatch(/\/\s*(null|NaN|undefined|0)\b/)
      })
    }

    it('超限判据跟着生效上限走（红态由平台预算决定，不是写死的默认值）', () => {
      const over = '字'.repeat(12)
      const w = mountEditor({ modelValue: over, maxChars: 5 })
      expect(w.get('[data-testid="article-char-counter"]').classes()).toContain('article-char-counter--over')
      const ok = mountEditor({ modelValue: over, maxChars: 5000 })
      expect(ok.get('[data-testid="article-char-counter"]').classes()).not.toContain('article-char-counter--over')
    })

    it('Markdown 输入框的 maxlength 同步取生效上限（非法档不得写成 maxlength="null"）', async () => {
      // editorMode 是组件内部 ref，不是 prop ⇒ 必须点「Markdown」按钮切过去，
      // 传 prop 那种写法会让用例在没有 textarea 的地方静默等错东西。
      const w = mountEditor({ maxChars: 480 })
      await w.findAll('.mode-btn')[1].trigger('click')
      expect(w.find('textarea').exists(), '切到 Markdown 模式后应渲染 textarea').toBe(true)
      expect(w.get('textarea').attributes('maxlength')).toBe('480')

      const bad = mountEditor({ maxChars: null })
      await bad.findAll('.mode-btn')[1].trigger('click')
      expect(bad.get('textarea').attributes('maxlength')).toBe(String(APP_ARTICLE_CONTENT_MAX))
    })
  })

  describe('B) 结构合同：Publish.vue 必须把平台预算接进编辑器', () => {
    const src = readFileSync(resolve(SRC, 'views/Publish.vue'), 'utf8').replace(/\r\n/g, '\n')

    /** 取 `<ArticleEditor` 的开标签（前向找 > 时跳过引号内的 >） */
    function openingTag (text, marker) {
      const at = text.indexOf(marker)
      if (at < 0) return null
      let inQuote = null
      for (let i = at; i < text.length; i++) {
        const ch = text[i]
        if (inQuote) { if (ch === inQuote) inQuote = null; continue }
        if (ch === '"' || ch === "'") { inQuote = ch; continue }
        if (ch === '>') return text.slice(at, i + 1)
      }
      return null
    }

    it('判据取到了真实的开标签（取不到即探针坏了，不得读成合规）', () => {
      const tag = openingTag(src, '<ArticleEditor')
      expect(tag, '未在 Publish.vue 找到 <ArticleEditor').not.toBeNull()
      expect(tag.length).toBeGreaterThan(20)
      expect(tag).toContain('v-model')
    })

    it('绑定了 :max-chars，且取值来自单一真源 minContentBudget 并有兜底', () => {
      const tag = openingTag(src, '<ArticleEditor')
      expect(tag).toMatch(/:max-chars=/)
      const expr = /:max-chars="([^"]*)"/.exec(tag)[1]
      expect(expr).toContain('minContentBudget')
      expect(expr).toContain('article.title')
      expect(/APP_ARTICLE_CONTENT_MAX\s*\|\||\?\?\s*APP_ARTICLE_CONTENT_MAX/.test(expr), `兜底缺失：${expr}`).toBe(true)
    })

    it('minContentBudget 与 APP_ARTICLE_CONTENT_MAX 都从 publish-contract 导入（不许另写第二份上限表）', () => {
      const re = /import\s*\{([^}]*)\}\s*from\s*'@\/features\/publish\/publish-contract'/
      const m = re.exec(src)
      expect(m, '未定位到对 publish-contract 的具名导入').not.toBeNull()
      expect(m[1]).toContain('minContentBudget')
      expect(m[1]).toContain('APP_ARTICLE_CONTENT_MAX')
    })
  })
})
