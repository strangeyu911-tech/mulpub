// @vitest-environment node
// @ts-check
/**
 * explainer-stage-type-isolation.test.js — explainer 的专属 stage type 与其它流水线的隔离锁
 *
 * ## 为什么单独一个文件
 *
 * ① **语义**：这是「explainer 的 compose/publish 用专属 type」这条契约的**专属锁**，
 *   放在 `pipeline-engine.test.js` 里会挤占那个文件的行数额度（testLimit=1500，
 *   它本来就 1486 行）⇒ 单独成文件更清晰。
 *   ⚠ 但它**不与 pipeline-engine.test.js 重复**：那边只断言 explainer 自己的 type，
 *   这边断言「**其它流水线不受影响**」⇒ 两者合起来才是完整的隔离证明。
 *
 * ② **只放纯断言**（读 stageDefs，不跑 ffmpeg / 不起进程）⇒ 单文件耗时 < 100ms
 *   ⇒ 不会成为 CI 分片里的慢用例。
 *
 * ## 这条锁在防什么
 *
 * 内置 `compose` / `publish`（`stage-executor.js` 的 `STAGE_TYPES.COMPOSE` / `PUBLISH`）
 * 是 story2video 等多条流水线**共用**的。
 * 本片让 explainer 的这两个阶段产出上游 artifact（`render_report` + `final_review` /
 * `publish_log`）⇒ 改内置执行器的输出形态会**破坏那些流水线** ⇒ explainer 改用
 * `explainer_compose` / `explainer_publish` 两个独立 key（`execute` 是「自定义 executor 优先」，
 * key 不重叠 ⇒ 零侵入）。
 *
 * ⚠ 「零侵入」不能只是口头承诺 ⇒ 本文件用机械断言把它锁住：
 * **任何其它流水线的 compose/publish 都不许被改成 explainer 的专属 type**。
 */

import { describe, it, expect } from 'vitest'
import { createRequire } from 'node:module'

const require = createRequire(import.meta.url)
const { PipelineEngine } = require('../services/pipeline-engine')

function makeEngine () {
  return new PipelineEngine({
    log: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), notify: vi.fn() },
  })
}

describe('explainer 专属 stage type 的隔离锁', () => {
  it('explainer 的 compose/publish 用专属 type', () => {
    const engine = makeEngine()
    const pl = engine.getPipeline('animated-explainer')
    const defs = Object.fromEntries(pl.stageDefs.map(stage => [stage.name, stage]))
    expect(defs.compose.type).toBe('explainer_compose')
    expect(defs.publish.type).toBe('explainer_publish')
  })

  it('★ 其它流水线不得被改成 explainer 专属 type', () => {
    const engine = makeEngine()
    const checked = []
    for (const entry of engine.listPipelines()) {
      const pipeline = entry && entry.name ? entry.name : entry
      const pl = engine.getPipeline(pipeline)
      if (!pl || !Array.isArray(pl.stageDefs)) continue
      if (pipeline === 'animated-explainer') continue
      const defs = Object.fromEntries(pl.stageDefs.map(s => [s.name, s]))
      if (defs.compose) {
        expect(defs.compose.type, pipeline + ' 的 compose 不得被改成 explainer 专属 type')
          .not.toBe('explainer_compose')
        checked.push(pipeline + '.compose')
      }
      if (defs.publish) {
        expect(defs.publish.type, pipeline + ' 的 publish 不得被改成 explainer 专属 type')
          .not.toBe('explainer_publish')
        checked.push(pipeline + '.publish')
      }
    }
    // ⚠ 反向锁本身也要有牙齿：至少锁住一条已知**共用内置**的流水线
    expect(checked.length).toBeGreaterThan(0)
    const shared = engine.getPipeline('story2video-compose')
    if (shared && Array.isArray(shared.stageDefs)) {
      const sharedDefs = Object.fromEntries(shared.stageDefs.map(s => [s.name, s]))
      if (sharedDefs.compose) expect(sharedDefs.compose.type).toBe('compose')
      if (sharedDefs.publish) expect(sharedDefs.publish.type).toBe('publish')
    }
  })
})
