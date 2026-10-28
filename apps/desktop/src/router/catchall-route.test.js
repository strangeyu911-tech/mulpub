import { describe, it, expect } from 'vitest'
import router from './index'
import { ROUTE_REGISTRY } from '@/config/route-registry'

// 阶段 1.9「未知路由兜底页」的路由侧合同（UX 审计 2026-10-17）。
//
// 现状：router/index.js 没有 catch-all，未登记路径落到 vue-router 的「无匹配 ⇒ 什么都不渲染」，
// 用户看到的是一段**空白的应用外壳**（侧边栏在、内容区空），既没有提示也没有出口；
// 而运营中心深链、快捷键手输、旧标签页残留 URL 都会造出这类路径。
//
// 三条不可破的判据：
//  ① 未知路径必须解析到命名路由 NotFound（不是"随便渲染点什么"）；
//  ② 兜底**不得吞掉既有路由** —— 由上一条"逐条真实路由解析结果不得变"守。**位置不是防线**：
//     vue-router 4 按 rank（静态 > 参数 > 通配）排序后匹配，变异实测把通配挪到首位时 /publish
//     仍解析到 Publish，所以下面那条位置锁只是可读性/可维护性约定，不当保险丝用；
//  ③ NotFound 必须按本仓既有约定登记进 ROUTE_REGISTRY（internal + entryFrom），
//     否则它就是一个"能渲染但不在册"的暗页 —— 本仓把这类状态记作「装饰性链路」的同型。
describe('未知路由必须落到命名兜底页 NotFound（阶段 1.9）', () => {
  it('未登记路径解析到 NotFound，而不是无匹配', () => {
    for (const p of ['/nope', '/accounts/unknown-tab', '/board', '/settings/advanced/nested']) {
      const r = router.resolve(p)
      expect(r.name, p + ' 应命中兜底路由').toBe('NotFound')
      expect(r.matched.length, p + ' 必须有被匹配到的组件，不得空matched').toBeGreaterThan(0)
    }
  })

  it('兜底不得吞掉既有路由（含带 param 的具体路径与 redirect）', () => {
    // 逐条来自 router/index.js 的真实声明；任何一条被通配吃掉即红
    const 期望 = [
      ['/publish', 'Publish'],
      ['/publish/history', 'PublishHistory'],
      ['/accounts', 'Accounts'],
      ['/board/p-1', 'ProductionBoard'],
      ['/board/p-1/contact-sheet', 'ContactSheetView'],
      ['/replay/p-1', 'ReplayTimeline'],
      ['/create/history', 'CreateHistory'],
    ]
    for (const [path, name] of 期望) {
      if (name === 'CreateHistory') {
        // redirect 路由 resolve 后 name 为空、但必须落在被重定向的目标上，不得落进 NotFound
        const r = router.resolve(path)
        expect(r.path + r.search + (r.hash || ''), path + ' 不得被兜底接管').not.toContain('NotFound')
        expect(r.matched.map((m) => m.name).filter(Boolean), path + ' 不应命中 NotFound')
          .not.toContain('NotFound')
        continue
      }
      expect(router.resolve(path).name, path).toBe(name)
    }
  })

  it('NotFound 必须登记进 route-registry（internal + entryFrom 指向在册路径）', () => {
    const entry = ROUTE_REGISTRY.find((e) => e.name === 'NotFound')
    expect(entry, 'route-registry 里必须有 NotFound 这一条（暗页也要在册）').toBeTruthy()
    expect(entry.internal, '兜底页不得出现在侧边栏菜单里').toBe(true)
    expect(entry.navEntry, '兜底页不是导航入口').toBeNull()
    expect(entry.view, 'view 必须等于真实视图文件名（CI 规则 4）').toBe('NotFound.vue')
    expect(entry.path, 'path 必须与 router 声明逐字一致（CI 规则 1）').toBe('/:pathMatch(.*)*')
    expect(
      ROUTE_REGISTRY.some((e) => e.path === entry.entryFrom),
      'entryFrom 必须指向表内已登记的 path，防登记死链（CI 规则 5）',
    ).toBe(true)
  })

  it('反向锁：通配路由必须排在路由表末尾（位置约定；不是"吞掉风险"的防线，见文件头）', () => {
    const idx = router.options.routes.findIndex((r) => r.path === '/:pathMatch(.*)*')
    expect(idx, '路由表里必须存在 catch-all').toBeGreaterThan(0)
    expect(idx, 'catch-all 必须是最后一条声明').toBe(router.options.routes.length - 1)
  })
})
