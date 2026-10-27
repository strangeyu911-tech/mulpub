// @vitest-environment jsdom
/**
 * WorkflowEditor 标签关联合同锁（UX 审计 4.3 · 第一片）
 *
 * 判据取 DOM 事实（label.control / control.labels / htmlFor），不写"源码里 for 与 id
 * 都出现过"——字符串判据对「for 指到组件根 div」这类规范级无效完全失明。
 * 期望文案一律从真实字典取（AGENTS.md：渲染端测试断言 i18n 键而不是 locale 字面量），
 * 并锁住"键必须解析出非空且不等于键名本身"，否则字典与模板同时漂时会假绿。
 *
 * 本片只做通道 A（一行一个控件）9 处。另 3 处标题（热门类别 / 同账号间隔 / 单次上限）
 * 所在行里有两个以上控件，`for` 只能指一个、指第一个会把组名降级成控件名，
 * 属选项组族（role=group + aria-labelledby），连同"无名控件"的存量对账一起放第二片。
 *
 * 环境依赖显式声明在首行：label.control / control.labels 是 jsdom 实现的关联语义，
 * 若全局配置换环境（happy-dom 等）这几条锁会一起漂移，不该由隐式默认决定。
 */
import { describe, it, expect } from 'vitest'
import { mount } from '@vue/test-utils'
import { createI18n } from 'vue-i18n'
import { createApp, defineComponent, h, useId, version as VUE_VERSION } from 'vue'
import { readFileSync } from 'fs'
import { resolve } from 'path'
import WorkflowEditor from './WorkflowEditor.vue'
import zhAutomation from '@/locales/automation/zh'

const SRC = readFileSync(resolve(__dirname, 'WorkflowEditor.vue'), 'utf8')
// 静态对账只扫模板区（剥掉 HTML 注释：注释里的同名串不是属性，会打红自己的锁）
const TEMPLATE = SRC.replace(/<!--[\s\S]*?-->/g, '')
// 通道 A 的 id 形状见 CHANNEL_A 之后：它必须由 CHANNEL_A 的键派生，
// 手写第二串名字与 CHANNEL_A 必然漂移（本文件第一版就漏过 categoriesLimit，把 3 个控件读成 2 个）

const ns = zhAutomation.default || zhAutomation
const i18n = createI18n({
  legacy: false,
  locale: 'zh',
  messages: { zh: { automation: ns.automation || ns } },
})
const tOf = (key) => String(i18n.global.t(key)).trim()

function baseModel () {
  return {
    source: { type: 'hotTopics', categories: ['ai'], limit: 10, sort: 'latest', followIds: ['f_1'], perCreatorLimit: 3 },
    rewrite: { mode: 'default', strategyId: '', length: 'keep' },
    content: { type: 'article', videoPipeline: '', podcastChannelId: '' },
    publish: { targets: [], mode: 'immediate', startAt: '' },
    cadence: { minMinutes: 35, maxMinutes: 40 },
    guardrails: { maxItemsPerRun: 5, dailyItemLimit: 20, retryPerItem: 1 },
    review: { requireApproval: false },
    dedupe: { enabled: true },
  }
}

const meta = {
  sources: [{ id: 'hotTopics', label: '热门' }, { id: 'creatorMonitor', label: '博主' }, { id: 'zhihuFavlist', label: '收藏夹' }],
  categories: ['ai', 'tech'],
  contentTypes: [{ id: 'article', label: '图文' }, { id: 'video', label: '视频' }, { id: 'podcast', label: '播客' }],
  videoPipelines: [{ id: 'p1', label: '管线一' }],
  limits: { maxHotTopicsLimit: 50, maxFolderLimit: 30, maxItemsPerRun: 20, maxDailyItems: 200, maxMinutes: 1440 },
}

function mountEditor (mutate) {
  const model = baseModel()
  if (mutate) mutate(model)
  return mount(WorkflowEditor, { props: { meta, accounts: [], modelValue: model, 'onUpdate:modelValue': () => {} }, global: { plugins: [i18n] } })
}

// key = 模板里 fid(…) 的后缀；i18nKey = 文案键；branch = 该字段所在的条件分支名
// （外部评审 i7：分支名必须显式写——匿名箭头函数赋给 at 属性时 V8 推断其 name 恒为 "at"，
//   九条报错会全部打成 "at"，等于没有分支信息）
const CHANNEL_A = [
  { key: 'sourceType', branch: 'default', i18nKey: 'automation.wfSourceType', tag: 'select' },
  { key: 'categoriesLimit', branch: 'hotTopics', i18nKey: 'automation.wfLimit', tag: 'input', at: (m) => { m.source.type = 'hotTopics' } },
  { key: 'followIds', branch: 'creatorMonitor', i18nKey: 'automation.wfFollowIds', at: (m) => { m.source.type = 'creatorMonitor' } },
  { key: 'perCreator', branch: 'creatorMonitor', i18nKey: 'automation.wfPerCreator', at: (m) => { m.source.type = 'creatorMonitor' } },
  { key: 'folders', branch: 'zhihuFavlist', i18nKey: 'automation.wfFolders', at: (m) => { m.source.type = 'zhihuFavlist' } },
  { key: 'foldersLimit', branch: 'zhihuFavlist', i18nKey: 'automation.wfLimit', at: (m) => { m.source.type = 'zhihuFavlist' } },
  { key: 'pipeline', branch: 'video', i18nKey: 'automation.wfPipeline', tag: 'select', at: (m) => { m.content.type = 'video' } },
  { key: 'channel', branch: 'podcast', i18nKey: 'automation.wfChannel', at: (m) => { m.content.type = 'podcast' } },
  { key: 'publishMode', branch: 'default', i18nKey: 'automation.wfPublishMode', tag: 'select' },
]

// ID_SHAPE 由 CHANNEL_A 的键派生（同一份清单，不留第二串名字）。
// i10 那条键集合对账再保证 CHANNEL_A 与模板侧的 fid(…) 调用点双向一致。
const ID_SHAPE = new RegExp(`-(${CHANNEL_A.map((f) => f.key).join('|')})$`)

describe('WorkflowEditor 标签关联（UX 4.3 通道 A）', () => {
  it('宿主契约：useId 存在、运行时 vue ≥ 3.5，且 app 声明范围也在 3.5 以上', () => {
    const [major, minor] = VUE_VERSION.split('.').map(Number)
    expect(major > 3 || (major === 3 && minor >= 5), `vue 运行时 ${VUE_VERSION} 低于 useId 所需 3.5`).toBe(true)
    expect(typeof useId, 'vue.useId 不是函数 ⇒ fid() 会在 setup 期抛').toBe('function')
    // 外部评审 i1：上面那半锁的是"测试 import 到的 vue"，不等于打包侧运行的 vue。
    // 这里补上声明档（有人把范围降到 <3.5 当场红）。构建产物 / alias 换包那一维本锁看不见，
    // 属产物级契约，不在本片做——写在这里而不是当成已覆盖。
    const declared = JSON.parse(readFileSync(resolve(__dirname, '../../../package.json'), 'utf8')).dependencies.vue
    const dm = String(declared).match(/(\d+)\.(\d+)/)
    expect(dm, `apps/desktop 声明的 vue 范围 "${declared}" 解析不出主次版本`).not.toBeNull()
    expect(+dm[1] > 3 || (+dm[1] === 3 && +dm[2] >= 5), `声明范围 ${declared} 低于 useId 所需的 3.5`).toBe(true)
  })

  it('夹具健康正控：真实字典解析出文案、整页确实渲染出控件', () => {
    const probes = ['automation.wfSourceType', 'automation.wfLimit', 'automation.wfPipeline']
    for (const k of probes) {
      expect(tOf(k), `键 ${k} 解析出空串`).not.toBe('')
      expect(tOf(k), `键 ${k} 没解析（返回键名本身 ⇒ 字典与模板同时漂）`).not.toBe(k)
    }
    const w = mountEditor()
    console.log(`[wf-editor-fixture] selects=${w.findAll('select').length} inputs=${w.findAll('input').length} labels=${w.findAll('label').length}`)
    expect(w.findAll('select').length, '一个 select 都没渲染 ⇒ 页面没起来').toBeGreaterThanOrEqual(2)
    expect(w.findAll('label').length, '一个 label 都没渲染 ⇒ 页面没起来').toBeGreaterThanOrEqual(6)
    w.unmount()
  })

  it('通道 A 逐字段：每个标题由 DOM 解析到该控件（按分支挂载）', () => {
    for (const f of CHANNEL_A) {
      const w = mountEditor(f.at)
      const want = tOf(f.i18nKey)
      const control = w.find(`[id$="-${f.key}"]`)
      expect(control.exists(), `分支 ${f.branch} 里找不到以 -${f.key} 结尾的控件`).toBe(true)
      if (f.tag) expect(control.element.tagName.toLowerCase(), `${f.branch}/${f.key} 的落点不是 ${f.tag}`).toBe(f.tag)
      const labels = [...(control.element.labels || [])]
      expect(labels.length, `「${want}」没有关联到该控件（读屏只念控件类型）`).toBe(1)
      expect((labels[0].textContent || '').trim(), `关联到的不是写着「${want}」的标题`).toBe(want)
      expect(labels[0].htmlFor, 'htmlFor 与控件 id 不一致').toBe(control.element.id)
      expect(labels[0].control, 'label.control 没指回控件 ⇒ 点标题不聚焦').toBe(control.element)
      w.unmount()
    }
  })

  it('键集合双向对账：模板里每个 fid(…) 都有测试条目，每个测试条目都在模板里', () => {
    // 外部评审 i10/i5：把"9 处接线全覆盖"从叙事变成约束。少了这一条，模板侧改名
    // （fid('sourceType2')）时本文件只会报"找不到控件"，错因指不到真正的漂移；
    // 反过来锁里多列一个不存在的 key、或漏列一个已接线的 key，都没有任何东西会问起。
    const inTemplate = new Set([...TEMPLATE.matchAll(/fid\('([^']+)'\)/g)].map((m) => m[1]))
    const inTest = new Set(CHANNEL_A.map((f) => f.key))
    console.log(`[wf-editor-keys] template=${inTemplate.size} test=${inTest.size}`)
    expect(inTemplate.size, '模板里一个 fid 调用点都没扫到 ⇒ 探针坏了（实现可能退回静态 id）').toBeGreaterThanOrEqual(9)
    const missing = [...inTemplate].filter((k) => !inTest.has(k))
    const stale = [...inTest].filter((k) => !inTemplate.has(k))
    expect(missing, `模板接了线但没有锁：${missing.join(' , ')}`).toEqual([])
    expect(stale, `锁里的 key 在模板里不存在（改名漂移会以"找不到控件"的错因出现）：${stale.join(' , ')}`).toEqual([])
  })

  it('实例级唯一：同一 app root 下两份组件，id 不重复且不跨实例指认', () => {
    const Host = defineComponent({
      render: () => h('div', null, [
        h(WorkflowEditor, { meta, accounts: [], modelValue: baseModel(), 'onUpdate:modelValue': () => {} }),
        h(WorkflowEditor, { meta, accounts: [], modelValue: baseModel(), 'onUpdate:modelValue': () => {} }),
      ]),
    })
    const el = document.createElement('div')
    document.body.appendChild(el)
    const app = createApp(Host)
    app.use(i18n)
    app.mount(el)
    const ids = [...el.querySelectorAll('[id]')].map((e) => e.id).filter((v) => ID_SHAPE.test(v))
    const dup = ids.filter((v, i) => ids.indexOf(v) !== i)
    expect(dup, `两份实例产生重复 id：${[...new Set(dup)].join(' , ')}`).toEqual([])
    expect(ids.length, '一个实例级 id 都没扫到 ⇒ 探针坏了（实现可能退回静态 id）').toBeGreaterThan(0)

    const sides = [...el.children[0].children]
    // 外部评审 i4：下面按"两份实例各渲染单根"划分左右。前提不成立时（模板改成 fragment 多根）
    // 跨实例泄漏扫描会静默出现盲区，所以先把前提本身锁住——结构一变即红，红文案指名原因。
    expect(sides.length, `父级下渲染出 ${sides.length} 个根，本锁假定两份实例各一根`).toBe(2)
    const first = sides[0]
    const leaked = [...first.querySelectorAll('label[for]')].filter((l) => !l.control || !first.contains(l.control))
    expect(leaked, `${leaked.length} 个标题跨实例指认`).toEqual([])

    // 外部评审 i2：期望数由"第一侧实际扫到的通道 A id"派生，不写死绝对常数 6。
    // 默认分支以后增删控件时，只要两份实例一致且非空，这条锁不该因为一个魔数而红。
    const firstSide = [...first.querySelectorAll('[id]')].map((e) => e.id).filter((v) => ID_SHAPE.test(v))
    expect(firstSide.length, '第一份实例里一个通道 A 的 id 都没扫到 ⇒ 探针坏了').toBeGreaterThanOrEqual(3)
    console.log(`[wf-editor-multi] firstSide=${firstSide.length} total=${ids.length}`)
    expect(ids.length, `两份实例合计应等于第一侧的 2 倍（实测第一侧 ${firstSide.length}）`).toBe(firstSide.length * 2)
    app.unmount()
    el.remove()
  })
})
