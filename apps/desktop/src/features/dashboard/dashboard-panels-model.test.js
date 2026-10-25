/**
 * 看板新增区块的数据转换纯函数锁（dash-full-entitlement）。
 *
 * 这些函数存在的理由：三个新区块的取数都要做「IPC 信封 → 视图模型」的转换，
 * 而这类转换最容易把三种状态混为一谈：
 *   「没有数据」/「取数失败」/「不认识我（未登录）」
 * 前两种在界面上都是空，但含义相反：渲染成同一个空态，用户会把
 * 「功能坏了」读成「我还没发过东西」。所以转换层必须把三态显式分开，
 * 且每态都有对应的单测断言。
 */
import { describe, it, expect } from 'vitest'
import {
  toAccountHealthModel,
  toQueueStatusModel,
  toPatternBoardModel,
  toKpiModel,
  toPlatformDataModel,
  AUTH_GATE,
} from './dashboard-panels-model'

describe('toAccountHealthModel（账号健康度）', () => {
  it('统计三态计数', () => {
    const res = {
      code: 0,
      data: [
        { accountId: 'a1', status: 'ok' },
        { accountId: 'a2', status: 'ok' },
        { accountId: 'a3', status: 'failed' },
        { accountId: 'a4', status: 'unknown' },
      ],
    }
    const m = toAccountHealthModel(res)
    expect(m.state).toBe('ready')
    expect(m.ok).toBe(2)
    expect(m.bad).toBe(1)
    expect(m.unknown).toBe(1)
    expect(m.badAccounts).toEqual(['a3'])
  })

  it('空数组是合法空态，不是错误', () => {
    const m = toAccountHealthModel({ code: 0, data: [] })
    expect(m.state).toBe('empty')
    expect(m.ok).toBe(0)
  })

  it('错误信封 → error，不渲染成 0（否则用户读成"全都没问题"）', () => {
    const m = toAccountHealthModel({ code: -1, message: 'boom' })
    expect(m.state).toBe('error')
  })

  it('未登录门禁 → auth，不渲染成 0', () => {
    const m = toAccountHealthModel({ code: -3, errorCode: 'AUTH_REQUIRED' })
    expect(m.state).toBe(AUTH_GATE)
  })

  it('data 缺失/非数组时降级 empty，不崩', () => {
    expect(toAccountHealthModel({ code: 0 }).state).toBe('empty')
    expect(toAccountHealthModel({ code: 0, data: 'oops' }).state).toBe('empty')
    expect(toAccountHealthModel(null).state).toBe('empty')
  })

  it('异常账号最多保留 5 个，多余计入 overflow', () => {
    const data = Array.from({ length: 8 }, (_, i) => ({ accountId: `a${i}`, status: 'failed' }))
    const m = toAccountHealthModel({ code: 0, data })
    expect(m.bad).toBe(8)
    expect(m.badAccounts).toHaveLength(5)
    expect(m.badOverflow).toBe(3)
  })
})

describe('toQueueStatusModel（发布队列）', () => {
  it('统计运行中/排队中/最近失败', () => {
    const status = { code: 0, data: { running: 2, pending: 3 } }
    const history = {
      code: 0,
      data: [
        { id: 1, status: 'failed' },
        { id: 2, status: 'success' },
        { id: 3, status: 'failed' },
      ],
    }
    const m = toQueueStatusModel(status, history)
    expect(m.state).toBe('ready')
    expect(m.running).toBe(2)
    expect(m.pending).toBe(3)
    expect(m.failed).toBe(2)
  })

  it('队列为空是合法空态', () => {
    const m = toQueueStatusModel({ code: 0, data: { running: 0, pending: 0 } }, { code: 0, data: [] })
    expect(m.state).toBe('empty')
  })

  it('有任务在跑就不算空态（哪怕历史为空）', () => {
    const m = toQueueStatusModel({ code: 0, data: { running: 1, pending: 0 } }, { code: 0, data: [] })
    expect(m.state).toBe('ready')
  })

  it('status 失败但 history 成功 → 仍 error（不允许半套数据）', () => {
    const m = toQueueStatusModel({ code: -1 }, { code: 0, data: [] })
    expect(m.state).toBe('error')
  })

  it('未登录门禁优先于其它态', () => {
    const m = toQueueStatusModel({ code: -3, errorCode: 'AUTH_REQUIRED' }, { code: 0, data: [] })
    expect(m.state).toBe(AUTH_GATE)
  })

  it('history data 非数组时按 0 计，不崩', () => {
    const m = toQueueStatusModel({ code: 0, data: { running: 0, pending: 0 } }, { code: 0, data: null })
    expect(m.state).toBe('empty')
    expect(m.failed).toBe(0)
  })
})

describe('toPatternBoardModel（题材表现榜，full 专属）', () => {
  it('按分数降序取 Top N', () => {
    const res = {
      code: 0,
      data: {
        items: [
          { value: '悬念开头', engagement_score: 30 },
          { value: '数字列表', engagement_score: 90 },
          { value: '故事引入', engagement_score: 60 },
        ],
      },
    }
    const m = toPatternBoardModel(res, 2)
    expect(m.state).toBe('ready')
    expect(m.rows.map(r => r.value)).toEqual(['数字列表', '故事引入'])
  })

  it('items 为空 → empty（归因断链是已知合法空态）', () => {
    expect(toPatternBoardModel({ code: 0, data: { items: [] } }).state).toBe('empty')
  })

  it('错误信封 → error', () => {
    expect(toPatternBoardModel({ code: -1, message: 'boom' }).state).toBe('error')
  })

  it('未登录门禁 → auth', () => {
    expect(toPatternBoardModel({ code: -3, errorCode: 'AUTH_REQUIRED' }).state).toBe(AUTH_GATE)
  })

  it('分数缺失按 0 处理且不崩', () => {
    const m = toPatternBoardModel({ code: 0, data: { items: [{ value: 'x' }] } })
    expect(m.state).toBe('ready')
    expect(m.rows[0].score).toBe(0)
  })

  it('value 缺失显示占位而非留白', () => {
    const m = toPatternBoardModel({ code: 0, data: { items: [{ engagement_score: 5 }] } })
    expect(m.rows[0].value).toBeTruthy()
  })
})

/**
 * 各平台数据 + KPI 行的口径锁（2026-10-25 数据真实性修复）。
 *
 * 事故形态（本次修复的起因）：
 *   ① `sync:cached` 那条链路在主进程恒返回 0 占位值，被盖上 `syncedAt: now`，
 *      界面上显示成「0阅读 · 更新于 10:51」——**假数据**；
 *   ② KPI 行的「已发布内容」取自同一条链路 ⇒ 与下方「发布统计·累计发布」
 *      **自相矛盾**（0 vs 真实总数）；
 *   ③ 「没有数据」与「真的是 0」被混同（`item.views ?? '-'` 对 0 无效）。
 *
 * ⇒ 转换层必须保证：**取不到就是 null（界面显示「—」）**，绝不回落成 0。
 */
describe('toPlatformDataModel（各平台数据）', () => {
  it('作品数取发布记录口径，互动取回采口径', () => {
    const m = toPlatformDataModel({
      stats: { perPlatform: { douyin: { total: 12 } } },
      perf: {
        byPlatform: [{ platform: 'douyin', contents: 3, views: 100, likes: 20, comments: 5, favorites: 1, shares: 2, interactions: 28 }],
        health: { lastCapturedAt: '2026-10-20T09:00:00.000Z' },
      },
    })
    expect(m.rows).toHaveLength(1)
    const row = m.rows[0]
    expect(row.articles).toBe(12)
    expect(row.views).toBe(100)
    expect(row.likes).toBe(20)
    expect(row.comments).toBe(5)
    expect(row.contents).toBe(3)
    expect(row.lastCapturedAt).toBe('2026-10-20T09:00:00.000Z')
  })

  it('取不到的指标是 null（界面显示「—」），不是 0', () => {
    const m = toPlatformDataModel({
      stats: { perPlatform: { zhihu: { total: 4 } } },
      perf: { byPlatform: [], health: {} },
    })
    const row = m.rows[0]
    expect(row.views).toBeNull()
    expect(row.likes).toBeNull()
    expect(row.comments).toBeNull()
    expect(row.fans).toBeNull()
    expect(row.articles).toBe(4)
  })

  it('遗留占位记录（_note）不可信：不得进入任何指标', () => {
    const m = toPlatformDataModel({
      stats: { perPlatform: {} },
      perf: { byPlatform: [], health: {} },
      syncRows: [
        { platform: 'douyin', articles: 0, views: 0, comments: 0, likes: 0, followers: 0, _note: 'RPA 不可用' },
      ],
    })
    expect(m.rows).toHaveLength(0)
    expect(m.syncFailed).toBe(1)
  })

  it('带 error 的同步记录不可信', () => {
    const m = toPlatformDataModel({
      stats: { perPlatform: {} },
      perf: { byPlatform: [], health: {} },
      syncRows: [{ platform: 'douyin', error: '平台数据采集通道未接入', syncedAt: '2026-10-20T09:00:00.000Z' }],
    })
    expect(m.rows).toHaveLength(0)
    expect(m.syncFailed).toBe(1)
  })

  it('可信的同步记录只贡献账号级指标（粉丝），不污染作品级口径', () => {
    const m = toPlatformDataModel({
      stats: { perPlatform: { douyin: { total: 2 } } },
      perf: { byPlatform: [{ platform: 'douyin', contents: 1, views: 10, likes: 1, comments: 1, interactions: 2 }], health: {} },
      syncRows: [{ platform: 'douyin', views: 999, comments: 888, likes: 777, followers: 321 }],
    })
    const row = m.rows[0]
    expect(row.fans).toBe(321)
    // 作品级指标仍来自回采，不被账号级记录覆盖
    expect(row.views).toBe(10)
    expect(row.comments).toBe(1)
    expect(row.likes).toBe(1)
  })

  it('只回采到部分平台时，未回采的平台仍出现（显示作品数 + 「—」）', () => {
    const m = toPlatformDataModel({
      stats: { perPlatform: { douyin: { total: 2 }, bilibili: { total: 7 } } },
      perf: { byPlatform: [{ platform: 'douyin', contents: 1, views: 10 }], health: {} },
    })
    const platforms = m.rows.map(r => r.platform)
    expect(platforms).toContain('douyin')
    expect(platforms).toContain('bilibili')
    const bili = m.rows.find(r => r.platform === 'bilibili')
    expect(bili.articles).toBe(7)
    expect(bili.views).toBeNull()
  })
})

describe('toKpiModel（KPI 行）', () => {
  it('已发布内容取发布记录总数（与「发布统计·累计发布」同源，不再自相矛盾）', () => {
    const kpi = toKpiModel({ stats: { total: 42 }, perf: null, syncRows: [] })
    expect(kpi.published).toBe(42)
  })

  it('作品阅读/评论取回采总量；取不到时是 null 而不是 0', () => {
    const withData = toKpiModel({
      stats: { total: 1 },
      perf: { totals: { views: 123, comments: 7 } },
      syncRows: [],
    })
    expect(withData.reads).toBe(123)
    expect(withData.comments).toBe(7)

    const without = toKpiModel({ stats: { total: 1 }, perf: null, syncRows: [] })
    expect(without.reads).toBeNull()
    expect(without.comments).toBeNull()
  })

  it('账号粉丝只由可信同步记录汇总；一条都没有时是 null', () => {
    expect(toKpiModel({ stats: null, perf: null, syncRows: [] }).fans).toBeNull()
    expect(toKpiModel({
      stats: null,
      perf: null,
      syncRows: [{ platform: 'douyin', followers: 100 }, { platform: 'bilibili', followers: 50 }],
    }).fans).toBe(150)
    // 不可信记录不参与汇总
    expect(toKpiModel({
      stats: null,
      perf: null,
      syncRows: [{ platform: 'douyin', followers: 100, _note: 'RPA 不可用' }],
    }).fans).toBeNull()
  })
})
