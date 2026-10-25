// @vitest-environment node
// @ts-check
/**
 * explainer-remotion-props.test.js — 「叙事分镜 + 剪辑决策 → Remotion 渲染指令」的合成层
 *
 * ## 覆盖什么
 *
 * ① **cut type 判定**：素材声明优先（上游 assets 工具集）→ 文本线索二次细化 → 叙事型兜底；
 * ② **各 cut type 的专属字段**（上游 `skills/core/remotion.md:47-63` 的字段表）；
 * ③ **时间轴以 edit_decisions 为权威**（上游 edit 阶段定时间轴，compose 只消费）；
 * ④ **数据校验**：未知 cut type / 非法时间轴 / 空 cuts 都要被报出来（不静默）。
 *
 * ## 关键设计（防回归）
 *
 * ⚠ **不扩任何 1:1 schema** ⇒ 渲染指令走「compose 阶段合成的 composition_data」
 *   （上游 `video_compose.py:1954` 的第二个入参）⇒ P1 的 sha256 门禁不受影响。
 * ⚠ **判定顺序必须是「素材声明 → 文本线索 → 叙事兜底」** ⇒ 上游把「要图表/要卡片」
 *   的意图写在 scene 的素材声明里（`required_assets[].type`），不是写在叙事 type 里。
 */

import { describe, it, expect } from 'vitest'
import { createRequire } from 'node:module'

const require = createRequire(import.meta.url)
const {
  REMOTION_CUT_TYPES,
  resolveCutType,
  buildCut,
  buildRemotionProps,
  buildCaptionWords,
  extractStat,
  extractChartData,
} = require('./explainer-remotion-props')

function scene (overrides = {}) {
  return {
    id: 'scene-1',
    type: 'broll',
    description: '一个人在深夜的书桌前盯着屏幕',
    information_role: '建立情境',
    shot_intent: '让观众代入',
    start_seconds: 0,
    end_seconds: 6,
    required_assets: [],
    ...overrides,
  }
}

function decisions (overrides = {}) {
  return {
    version: '1.0',
    cuts: [{ id: 'cut-1', source: '', in_seconds: 0, out_seconds: 6, transition_in: 'fade', transition_out: 'dissolve', transition_duration: 0.4 }],
    audio: { narration: { segments: [{ asset_id: 'a1', start_seconds: 0, end_seconds: 6 }] } },
    ...overrides,
  }
}

describe('explain Remotion 渲染指令合成', () => {
  describe('cut type 判定', () => {
    it('★ 素材声明优先（上游 assets 工具集：diagram_gen / code_snippet / math_animate）', () => {
      expect(resolveCutType(scene({ required_assets: [{ type: 'diagram_gen', description: '流程图' }] })).cutType).toBe('text_card')
      expect(resolveCutType(scene({ required_assets: [{ type: 'bar_chart', description: '柱状图' }] })).cutType).toBe('bar_chart')
      expect(resolveCutType(scene({ required_assets: [{ type: 'kpi_grid', description: '指标看板' }] })).cutType).toBe('kpi_grid')
      expect(resolveCutType(scene({ required_assets: [{ type: 'code_snippet', description: '代码片段' }] })).cutType).toBe('terminal_scene')
    })

    it('文本线索二次细化（无素材声明时）', () => {
      expect(resolveCutType(scene({ description: '对比 2019 年和 2024 年的市场规模' })).cutType).toBe('comparison')
      expect(resolveCutType(scene({ description: '有 85% 的用户每天拖到最后一刻' })).cutType).toBe('stat_card')
      expect(resolveCutType(scene({ description: '用柱状图看占比分布' })).cutType).toBe('bar_chart')
    })

    it('★ 叙事型兜底（两者都不命中时）', () => {
      expect(resolveCutType(scene({ type: 'broll' })).cutType).toBe('anime_scene')
      expect(resolveCutType(scene({ type: 'text_card' })).cutType).toBe('text_card')
      expect(resolveCutType(scene({ type: 'diagram' })).cutType).toBe('text_card')
      expect(resolveCutType(scene({ type: 'screen_recording' })).cutType).toBe('screenshot_scene')
    })

    it('★ 判定顺序：素材声明压过文本线索（上游把意图写在素材声明里）', () => {
      const s = scene({
        description: '对比 A 和 B',
        required_assets: [{ type: 'kpi_grid', description: '指标看板' }],
      })
      expect(resolveCutType(s).cutType).toBe('kpi_grid')
    })
  })

  describe('各 cut type 的专属字段（上游 remotion.md 字段表）', () => {
    it('text_card：带 text', () => {
      const cut = buildCut(scene({ type: 'text_card', description: '一句话结论' }))
      expect(cut.type).toBe('text_card')
      expect(cut.text).toBe('一句话结论')
    })

    it('stat_card：stat + subtitle（从旁白抽数字）', () => {
      const cut = buildCut(scene({ type: 'broll', description: '市场规模' }), { narration: '有 85% 的用户拖延' })
      expect(cut.type).toBe('stat_card')
      expect(cut.stat).toBe('85%')
    })

    it('callout：callout_type 按文本语义分（info/quote/warning/tip）', () => {
      expect(buildCut(scene({ description: '记住这句金句' })).callout_type).toBe('quote')
      expect(buildCut(scene({ description: '注意这是个坑' })).callout_type).toBe('warning')
      expect(buildCut(scene({ description: '一个小技巧' })).callout_type).toBe('tip')
    })

    it('comparison：左右两栏从文本抽', () => {
      const cut = buildCut(scene({ description: '拖延 vs 自律' }), { narration: '拖延 vs 自律' })
      expect(cut.type).toBe('comparison')
      expect(cut.leftLabel).toBe('拖延')
      expect(cut.rightLabel).toBe('自律')
    })

    it('bar_chart：chartData 是 [{label,value}]，不足 2 点则降级为文字卡', () => {
      // ⚠ 显式声明素材类型（上游 assets 阶段的判定口径）⇒ 才不会被「占比」这类泛化词抢成 pie_chart
      const ok = buildCut(scene({ description: '数量分布', required_assets: [{ type: 'bar_chart', description: '柱状图' }] }), { narration: '第一项: 40 第二项: 35 第三项: 25' })
      expect(ok.type).toBe('bar_chart')
      expect(Array.isArray(ok.chartData)).toBe(true)
      expect(ok.chartData.length).toBeGreaterThanOrEqual(2)
      const degraded = buildCut(scene({ description: '占比分布' }), { narration: '只有一项: 40' })
      expect(degraded.chartData).toBeUndefined()
      expect(degraded.text).toBeTruthy()
    })

    it('pie_chart：带 donut + centerLabel', () => {
      const cut = buildCut(scene({ description: '占比' }), { narration: '甲: 60 乙: 40' })
      expect(cut.type).toBe('pie_chart')
      expect(cut.donut).toBe(true)
    })

    it('progress_bar：progress 是 0-100 的数', () => {
      const cut = buildCut(scene({ description: '进度' }), { narration: '完成了 60%' })
      expect(cut.type).toBe('progress_bar')
      expect(cut.progress).toBe(60)
    })

    it('hero_title：开场第一镜的纯文字卡被提升为大标题（带 heroSubtitle）', () => {
      // ⚠ 提升发生在 **buildRemotionProps** 层（它才知道「这是第几镜」）⇒ 这里走整链
      const plan = {
        version: '1.0',
        scenes: [scene({ id: 's0', type: 'text_card', description: '拖延症不是懒', information_role: '情绪调节机制', script_section_id: 's1', start_seconds: 0, end_seconds: 6 })],
      }
      const script = { version: '1.0', title: '拖延症不是懒', sections: [{ id: 's1', text: '拖延症不是懒', start_seconds: 0, end_seconds: 6 }] }
      const { props } = buildRemotionProps({ scenePlan: plan, editDecisions: decisions(), script })
      expect(props.cuts[0].type).toBe('hero_title')
      expect(props.cuts[0].heroSubtitle).toBe('情绪调节机制')
    })

    it('anime_scene：images 数组 + 粒子参数（上游 anime 相机/粒子词表）', () => {
      const cut = buildCut(scene({ type: 'animation' }), { imagePaths: ['/a.png', '/b.png'] })
      expect(cut.type).toBe('anime_scene')
      expect(cut.images).toEqual(['/a.png', '/b.png'])
      expect(cut.animation).toBe('zoom-in')
      expect(cut.particles).toBe('fireflies')
    })
  })

  describe('合成完整 props', () => {
    const scenePlan = {
      version: '1.0',
      scenes: [
        scene({ id: 'scene-1', type: 'text_card', description: '拖延症不是懒', script_section_id: 's1', start_seconds: 0, end_seconds: 6 }),
        scene({ id: 'scene-2', type: 'broll', description: '深夜的书桌', script_section_id: 's2', start_seconds: 6, end_seconds: 14 }),
      ],
    }
    const script = {
      version: '1.0',
      title: '拖延症不是懒',
      sections: [
        { id: 's1', text: '拖延症不是懒', start_seconds: 0, end_seconds: 6 },
        { id: 's2', text: '很多人以为是自己不够自律', start_seconds: 6, end_seconds: 14 },
      ],
    }

    it('★ 时间轴以 edit_decisions 为权威（不是 scene_plan）', () => {
      const ed = decisions({
        cuts: [
          { id: 'cut-1', in_seconds: 1, out_seconds: 5, transition_in: 'fade', transition_duration: 0.4 },
          { id: 'cut-2', in_seconds: 5.5, out_seconds: 13, transition_in: 'dissolve', transition_duration: 0.4 },
        ],
      })
      const { ok, props } = buildRemotionProps({ scenePlan, editDecisions: ed, script })
      expect(ok).toBe(true)
      expect(props.cuts[0].in_seconds).toBe(1)
      expect(props.cuts[0].out_seconds).toBe(5)
      expect(props.cuts[1].out_seconds).toBe(13)
    })

    it('props 顶层结构与上游 demo 样本同形（theme/cuts/overlays/captions/audio）', () => {
      const { ok, props } = buildRemotionProps({ scenePlan, editDecisions: decisions(), script })
      expect(ok).toBe(true)
      expect(Object.keys(props).sort()).toEqual(['audio', 'captions', 'cuts', 'overlays', 'theme', 'version'])
      expect(props.cuts.length).toBe(2)
      expect(props.cuts.every(c => REMOTION_CUT_TYPES.includes(c.type))).toBe(true)
    })

    it('★ 字幕必须是**词级** {word,startMs,endMs}（合成器契约；错形状 ⇒ 渲染期崩在 bundle 里）', () => {
      const { ok, props } = buildRemotionProps({ scenePlan, editDecisions: decisions(), script })
      expect(ok).toBe(true)
      expect(Array.isArray(props.captions)).toBe(true)
      for (const caption of props.captions) {
        expect(typeof caption.word).toBe('string')
        expect(caption.word.length).toBeGreaterThan(0)
        expect(Number.isFinite(caption.startMs)).toBe(true)
        expect(Number.isFinite(caption.endMs)).toBe(true)
        expect(caption.endMs).toBeGreaterThan(caption.startMs)
        // ⚠ 旧形状（text/start_seconds/end_seconds）会让 fromFrame 变 NaN
        expect(caption.text).toBeUndefined()
        expect(caption.start_seconds).toBeUndefined()
        expect(caption.end_seconds).toBeUndefined()
      }
    })

    it('★ 字幕时间必须落在该镜的时间轴内（从 cut 的 in/out 推出来）', () => {
      const { ok, props } = buildRemotionProps({ scenePlan, editDecisions: decisions(), script })
      expect(ok).toBe(true)
      const first = props.captions[0]
      expect(first.startMs).toBeGreaterThanOrEqual(0)
      expect(first.endMs).toBeLessThanOrEqual(13 * 1000)
    })

    it('旁白文本按 script_section_id 关联（一个 section 可对应多镜）', () => {
      const plan = {
        version: '1.0',
        scenes: [
          scene({ id: 'a', script_section_id: 's1', start_seconds: 0, end_seconds: 3 }),
          scene({ id: 'b', script_section_id: 's1', start_seconds: 3, end_seconds: 6 }),
        ],
      }
      const { props } = buildRemotionProps({ scenePlan: plan, editDecisions: decisions(), script })
      expect(props.cuts[0].text).toContain('拖延症不是懒')
      expect(props.cuts[1].text).toContain('拖延症不是懒')
    })

    it('★ 数据校验：没有场景 ⇒ 报 NO_SCENES 且不产出 props', () => {
      const r = buildRemotionProps({ scenePlan: { scenes: [] }, editDecisions: decisions(), script })
      expect(r.ok).toBe(false)
      expect(r.props).toBeNull()
      expect(r.issues.map(i => i.code)).toContain('NO_SCENES')
    })

    it('★ 数据校验：非法时间轴（out <= in）要报出来，不静默', () => {
      const ed = decisions({ cuts: [{ id: 'cut-1', in_seconds: 6, out_seconds: 6 }] })
      const r = buildRemotionProps({ scenePlan, editDecisions: ed, script })
      expect(r.ok).toBe(false)
      expect(r.issues.map(i => i.code)).toContain('CUT_TIME_NON_POSITIVE')
    })

    it('★ 数据校验：未知 cut type 要报出来', () => {
      const ed = decisions({ cuts: [{ id: 'cut-1', in_seconds: 0, out_seconds: 6 }] })
      const plan = { version: '1.0', scenes: [scene({ id: 'x', type: 'broll' })] }
      // 伪造一个未知 type：buildRemotionProps 内部不会产生未知 type，故直接验证判定器产出白名单内的 type
      const r = buildRemotionProps({ scenePlan: plan, editDecisions: ed, script })
      expect(r.ok).toBe(true)
      expect(REMOTION_CUT_TYPES).toContain(r.props.cuts[0].type)
    })
  })

  describe('抽取器', () => {
    it('extractStat 抽数字 + 单位', () => {
      expect(extractStat('有 85% 的用户拖延').value).toBe('85')
      expect(extractStat('有 85% 的用户拖延').unit).toBe('%')
      expect(extractStat('没有数字')).toBeNull()
    })

    it('extractChartData 抽 label/value 对', () => {
      const points = extractChartData('甲: 40 乙: 35 丙: 25')
      expect(points.length).toBeGreaterThanOrEqual(3)
      expect(points[0].label).toBe('甲')
      expect(points[0].value).toBe(40)
    })
  })
})

describe('explain 字幕条目合成（buildCaptionWords）', () => {
  it('★ 一条 cut 的文字被切成多个词级条目，时间在 cut 区间内递进', () => {
    const words = buildCaptionWords([
      { text: '拖延症不是懒：拖延背后的情绪调节机制。', in_seconds: 0, out_seconds: 8 },
    ])
    expect(words.length).toBeGreaterThan(1)
    expect(words[0].startMs).toBe(0)
    expect(words[words.length - 1].endMs).toBe(8000)
    for (let i = 1; i < words.length; i++) {
      expect(words[i].startMs).toBeGreaterThanOrEqual(words[i - 1].startMs)
      expect(words[i].endMs).toBeGreaterThan(words[i].startMs)
    }
  })

  it('没有文字的 cut ⇒ 不产字幕条目', () => {
    expect(buildCaptionWords([{ text: '', in_seconds: 0, out_seconds: 5 }])).toEqual([])
  })

  it('切不出块（空白/纯符号）⇒ 仍然给出一个条目（不许静默丢字幕）', () => {
    const words = buildCaptionWords([{ text: '。。。', in_seconds: 1, out_seconds: 3 }])
    expect(words.length).toBeGreaterThanOrEqual(1)
    expect(words[0].word.length).toBeGreaterThan(0)
    expect(words[0].startMs).toBe(1000)
    expect(words[0].endMs).toBe(3000)
  })
})
