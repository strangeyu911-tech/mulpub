import { describe, it, expect, vi } from 'vitest'
import { mount } from '@vue/test-utils'
import { createRouter, createMemoryHistory, createWebHashHistory } from 'vue-router'
import NotFound from './NotFound.vue'

// 阶段 1.9 兜底页的**行为**合同（不是"源码里出现过某个字符串"）。
//
// 四件必须成立的事，各对应一个真实的用户动作：
//  ① 页面上要能看见"我刚才想去哪儿"；
//  ② 必须有一个**真的能到**的出口（回首页），而且键盘可达；
//  ③ 「返回上一页」只在真能返回、且**回去值得去**时出现（评审 i1：back 指向另一个 404 时不得渲染）；
//  ④ 提示文案不得复述别处持有的事实（评审 i4：键位真源在 `electron/services/hotkeys.js`，
//     本批初稿写"Ctrl+Alt+1 到 6"，与真源逐字不符 —— 是今天就假，不是将来才假）。
//
// 夹具口径（当场踩了三次，写在这里而不是靠记忆）：
//  - 组件用 composition API，必须挂**真 router**：只 mock $router/$route 时 useRouter() 返回 undefined，
//    setup 期就抛。
//  - 只有 `history.state` 用替身：memory history 的 state 每次导航换一个对象，jsdom 会话历史在整个
//    file 内共享且只增（实测"无上一条历史"那一档拿到 {back:"/publish",position:2,replaced:true}），
//    两种宿主都造不出干净的"首帧无历史"。
//  - "宿主到底填不填 state.back"由最后那条**宿主接线合同**用真 hash history 单独测（评审 i2），
//    与"组件是否跟随该字段"分开，不混成一件事。
function buildRoutes () {
  return [
    { path: '/', name: 'Home', component: { template: '<div/>' } },
    { path: '/publish', name: 'Publish', component: { template: '<div/>' } },
    { path: '/:pathMatch(.*)*', name: 'NotFound', component: NotFound },
  ]
}

async function mountAt (fullPath, { back = null } = {}) {
  const router = createRouter({ history: createMemoryHistory(), routes: buildRoutes() })
  await router.replace(fullPath)
  await router.isReady()
  const state = { back, current: fullPath, position: back ? 1 : 0 }
  Object.defineProperty(router.options.history, 'state', { get: () => state, configurable: true })
  const w = mount(NotFound, { global: { plugins: [router], mocks: { $t: (k) => 'L:' + k } } })
  // 夹具前提自己断言：不成立时后面所有断言都在测一个不存在的前提
  expect(router.options.history.state, 'state 替身没挂上').toBe(state)
  expect(router.options.history.state.back, '夹具给出的 back 必须就是组件读到的那个').toBe(back)
  return { w, router, state }
}

describe('NotFound 兜底页（阶段 1.9）', () => {
  it('显示被拒绝的路径原文，供用户核对与反馈', async () => {
    const { w } = await mountAt('/keywords/dashboard?tab=x')
    expect(w.get('[data-testid="not-found-path"]').text()).toContain('/keywords/dashboard?tab=x')
  })

  it('路径原样回显，不截断（用户要核对的就是这几个字符，截了反而没法用）', async () => {
    const long = '/' + '啊'.repeat(200) + '🎉'
    const { w } = await mountAt(long)
    const shown = w.get('[data-testid="not-found-path"]').text()
    expect(shown).toBe(long)
    expect(shown).not.toMatch(/[\uD800-\uDBFF](?![\uDC00-\uDFFF])/)
  })

  it('主出口「回首页」调用的是 replace 而不是 push（不给兜底页堆历史）', async () => {
    const { w, router } = await mountAt('/nope')
    const replace = vi.spyOn(router, 'replace').mockImplementation(() => Promise.resolve({}))
    const push = vi.spyOn(router, 'push').mockImplementation(() => Promise.resolve({}))
    await w.get('[data-testid="not-found-home"]').trigger('click')
    expect(replace).toHaveBeenCalledWith('/')
    expect(push).not.toHaveBeenCalled()
  })

  it('无上一条历史时不渲染「返回上一页」（深链直达不得留死按钮）', async () => {
    const { w } = await mountAt('/nope')
    expect(w.find('[data-testid="not-found-back"]').exists()).toBe(false)
    expect(w.find('[data-testid="not-found-home"]').exists(), '主出口必须仍在').toBe(true)
  })

  it('上一页是在册路由时才渲染返回，并真的走 go(-1)', async () => {
    const { w, router } = await mountAt('/nope', { back: '/publish' })
    const btn = w.find('[data-testid="not-found-back"]')
    expect(btn.exists(), 'back=/publish 解析到在册路由 ⇒ 应给出返回出口').toBe(true)
    const go = vi.spyOn(router, 'go').mockImplementation(() => {})
    await btn.trigger('click')
    expect(go).toHaveBeenCalledWith(-1)
  })

  it('上一页本身也是未登记路径 ⇒ 不渲染返回按钮（评审 i1：404→404 回路）', async () => {
    const { w } = await mountAt('/other-nope', { back: '/nope' })
    expect(w.find('[data-testid="not-found-back"]').exists(),
      'go(-1) 只会落到另一个 404，那不是出口').toBe(false)
    expect(w.find('[data-testid="not-found-home"]').exists(), '主出口必须仍在').toBe(true)
  })

  it('翻转正控：按钮跟随 state.back，且导航发生后必须重算（不是挂载时算一次就冻住）', async () => {
    const { w, router, state } = await mountAt('/nope')
    expect(w.find('[data-testid="not-found-back"]').exists()).toBe(false)
    state.back = '/publish'
    await router.replace('/another-unknown')   // 真导航：route.fullPath 变 ⇒ computed 失效重算
    await w.vm.$nextTick()
    expect(w.find('[data-testid="not-found-back"]').exists(),
      '导航后 back 有值且上一页在册 ⇒ 按钮必须出现（未挂导航依赖时这条会红）').toBe(true)
    state.back = null
    await router.replace('/yet-another')
    await w.vm.$nextTick()
    expect(w.find('[data-testid="not-found-back"]').exists(),
      '回到无历史状态后按钮必须消失，不得留下第二次死按钮').toBe(false)
  })

  it('可访问性骨架：h1 是唯一标题、文案走 i18n、出口是原生可聚焦控件', async () => {
    const { w } = await mountAt('/nope', { back: '/publish' })
    expect(w.findAll('h1')).toHaveLength(1)
    expect(w.text()).toContain('L:notFound.title')
    expect(w.text()).toContain('L:notFound.actionHome')
    const home = w.get('[data-testid="not-found-home"]')
    expect(home.element.tagName).toBe('BUTTON')
    expect(home.attributes('type')).toBe('button')
  })

  it('页面不自建第二个 live region（整页就是这一次的呈现，重复播报会打架）', async () => {
    const { w } = await mountAt('/nope')
    expect(w.find('[aria-live]').exists()).toBe(false)
    expect(w.find('[role="status"]').exists()).toBe(false)
    expect(w.find('[role="alert"]').exists()).toBe(false)
  })

  it('宿主接线合同（评审 i2）：真 hash history 在两次导航后必须真的填 state.back', async () => {
    // 其余用例用替身隔离"组件是否跟随字段"；这一条反过来锁**宿主是否真的写这个字段**。
    // 缺它，"有历史时给返回出口"这一正向条款会在宿主行为变化时静默失效而全部用例照绿。
    const router = createRouter({ history: createWebHashHistory(), routes: buildRoutes() })
    await router.replace('/host-hop-a')
    await router.push('/host-hop-b')
    const state = router.options.history.state
    expect(typeof state, '宿主必须暴露 state 对象').toBe('object')
    expect(state.back, '第二次导航后 back 必须指回第一条（形状 {back,current,forward,position}）')
      .toBe('/host-hop-a')
    expect(state.current).toBe('/host-hop-b')
  })

  it('模板内不得出现中文字面量：文案一律走 locale（CI Gate 7 的 cjk 扫描同域）', async () => {
    const { default: src } = await import('./NotFound.vue?raw')
    const tpl = src.slice(0, src.indexOf('<script'))
    const zh = tpl.match(/[\u4e00-\u9fff]/g)
    expect(zh || [], '模板里出现了中文字面量/中文注释（应改为 $t 键或移到 script 块）：'
      + (zh || []).join('')).toEqual([])
  })

  it('提示文案不得复述键位（评审 i4）：键位真源在 electron/services/hotkeys.js', async () => {
    // 本批初稿写"Ctrl+Alt+1 到 6"，真源是 CmdOrCtrl+Alt+P/D/C/A/K/V/H/N —— 今天就对不上。
    // 与其把键位抄进文案（抄一份就必然漂），不如禁止这里出现键位。
    const { default: zhSrc } = await import('../locales/not-found/zh.js?raw')
    const { default: enSrc } = await import('../locales/not-found/en.js?raw')
    const KEY_PAT = /Ctrl\+Alt|CmdOrCtrl|⌘|⌥|Alt\+/
    for (const [name, srcText] of [['zh', zhSrc], ['en', enSrc]]) {
      const hits = String(srcText).match(new RegExp(KEY_PAT.source, 'g'))
      expect(hits || [], name + ' 文案里出现了键位字面量（应改为不含键位的说法或读真源）').toEqual([])
    }
  })
})
