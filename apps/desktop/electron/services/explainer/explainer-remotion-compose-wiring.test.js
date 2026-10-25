// @vitest-environment node
// @ts-check
/**
 * explainer-remotion-compose-wiring.test.js — P5a 的 **compose → Remotion 接线**回归锁
 *
 * ## 为什么要有这个文件（本轮读代码时抓到的两个真缺陷）
 *
 * ⚠ **缺陷一：场景来源形态读错 ⇒ Remotion 路径永远走不通**
 *   本仓 scenes 阶段的产物落在 `context[stage.name]` = **`context.scenes`**，
 *   而上游的名字是 `context.scene_plan` ⇒ 直接读 `context.scene_plan` **恒为 undefined**
 *   ⇒ 分镜拿不到 ⇒ props 合成必然 `NO_SCENES` ⇒ 每次都回落 ffmpeg 图片轮播。
 *   （**P2b 已经在 legacy 适配那条路上踩过同一个坑**，P5a 又踩了一次 ⇒ 必须有锁。）
 *
 * ⚠ **缺陷二：「CLI 报失败但 mp4 有效」的恢复路径是死代码**
 *   `RenderEngine.render()` **从不 reject**，CLI 非零退出时 resolve `{success:false}`
 *   且**不带 outputPath**；`getStatus()` 又**永远不含 outputPath**
 *   ⇒ 恢复路径不可能实现 ⇒ Remotion 其实出了片，流水线仍静默回落。
 *   （该缺陷的锁在 `explainer-remotion-render.test.js`。）
 *
 * ## 本文件锁住什么
 *
 * ① P5a 的 props 合成**认「context.scenes 是 scene_plan 对象」**这一真实形态；
 * ② 也认「context.scene_plan 是对象」这一上游形态；
 * ③ 场景缺失 ⇒ **fail-closed**（报 NO_SCENES），不许悄悄出一个空 props；
 * ④ 成片仍走**上游第二个入参**（compose 阶段合成 composition_data）⇒ 不动任何 1:1 schema。
 */

import { describe, it, expect } from 'vitest'
import { createRequire } from 'node:module'

const require = createRequire(import.meta.url)
const { buildExplainerRemotionProps } = require('./explainer-review-stages')

const planObject = {
  version: '1.0',
  scenes: [
    {
      id: 'scene-1',
      type: 'text_card',
      description: '开场大标题',
      information_role: '引入主题',
      start_seconds: 0,
      end_seconds: 6,
      script_section_id: 's1',
      required_assets: [],
    },
    {
      id: 'scene-2',
      type: 'diagram',
      description: '一张增长柱状图，展示季度增速',
      information_role: '给出数据',
      start_seconds: 6,
      end_seconds: 14,
      script_section_id: 's2',
      required_assets: [{ type: 'chart', description: '季度增速柱状图' }],
    },
  ],
}

const script = {
  sections: [
    { id: 's1', text: '今天我们讲清楚拖延症这件事。', start_seconds: 0, end_seconds: 6 },
    { id: 's2', text: '先看数据：季度增速达到 38%。', start_seconds: 6, end_seconds: 14 },
  ],
}

const editing = {
  version: '1.0',
  cuts: [
    { id: 'cut-1', in_seconds: 0, out_seconds: 6, source: 'scene-1', layer: 'base' },
    { id: 'cut-2', in_seconds: 6, out_seconds: 14, source: 'scene-2', layer: 'base' },
  ],
}

describe('P5a compose → Remotion 接线', () => {
  it('★ 认「context.scenes 是 scene_plan 对象」这一形态（本仓阶段名叫 scenes ⇒ 产物落在这里）', () => {
    const built = buildExplainerRemotionProps({
      scenes: planObject,
      editing,
      script,
      assets: { version: '1.0', assets: [] },
    })
    expect(built.ok).toBe(true)
    expect(built.props.cuts).toHaveLength(2)
    expect(built.props.cuts[0].id).toBe('scene-1')
  })

  it('认「context.scene_plan 是对象」这一形态（按上游阶段名对齐的键）', () => {
    const built = buildExplainerRemotionProps({
      scene_plan: planObject,
      editing,
      script,
      assets: { version: '1.0', assets: [] },
    })
    expect(built.ok).toBe(true)
    expect(built.props.cuts).toHaveLength(2)
  })

  it('★ 场景缺失 ⇒ fail-closed（报 NO_SCENES，不许悄悄出一个空 props）', () => {
    const built = buildExplainerRemotionProps({
      editing,
      script,
      assets: { version: '1.0', assets: [] },
    })
    expect(built.ok).toBe(false)
    expect(built.props).toBeNull()
    expect(built.issues.map(i => i.code)).toContain('NO_SCENES')
  })

  it('合成出来的 props 满足 Remotion 的最小结构契约（cuts 数组 + 每镜有 id 与时间轴）', () => {
    const built = buildExplainerRemotionProps({
      scenes: planObject,
      editing,
      script,
      assets: { version: '1.0', assets: [] },
    })
    expect(Array.isArray(built.props.cuts)).toBe(true)
    for (const cut of built.props.cuts) {
      expect(typeof cut.id).toBe('string')
      expect(Number.isFinite(cut.in_seconds)).toBe(true)
      expect(Number.isFinite(cut.out_seconds)).toBe(true)
      expect(cut.out_seconds).toBeGreaterThan(cut.in_seconds)
      expect(typeof cut.type).toBe('string')
    }
  })

  it('第一镜是纯文字卡且没有图片素材 ⇒ 升级为开场大标题（对齐上游 demo 第 0 镜是 hero_title）', () => {
    const built = buildExplainerRemotionProps({
      scenes: planObject,
      editing,
      script,
      assets: { version: '1.0', assets: [] },
    })
    expect(built.props.cuts[0].type).toBe('hero_title')
  })

  it('声明了图表素材的第二镜 ⇒ 判成图表类 cut（素材声明优先于文本线索）', () => {
    const built = buildExplainerRemotionProps({
      scenes: planObject,
      editing,
      script,
      assets: { version: '1.0', assets: [] },
    })
    expect(['bar_chart', 'line_chart', 'pie_chart', 'kpi_grid']).toContain(built.props.cuts[1].type)
  })
})
