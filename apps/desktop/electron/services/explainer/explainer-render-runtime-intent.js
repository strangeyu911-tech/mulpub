// @ts-check
/**
 * explainer-render-runtime-intent —— AI 讲解视频的**渲染引擎意图**判定（单一真源）
 *
 * ## 为什么单独一个模块
 *
 * ① `explainer-review-stages.js` 原本 478 行、离 500 行上限只差 22 行 ⇒
 *    P3 的「G1 门显式选择必须生效」这段逻辑放进去会**把它推过 500 行**
 *    （`check-max-lines` 口径 `lines >= limit` ⇒ 直接红主干）⇒ 抽出来。
 * ② 这段判据必须**可单测**（纯函数、无 IO）⇒ 放在 compose 执行器里就只会被
 *    「源码正则锁」覆盖，而源码正则锁是**弱锁**（注释里的同形文本就能满足它）。
 *
 * ## 语义（P3 人工审批门 × P5a Remotion 表现层的对齐点）
 *
 * - **P5a** 的既有行为：compose **Remotion 优先**（程序化动画），失败才回落 ffmpeg 轮播。
 * - **P3** 的 G1 门：让用户在 Remotion 与 ffmpeg 之间**显式选择**（未选则**拒绝批准** ⇒ 禁止静默默认），
 *   选择写回 `proposal.production_plan.render_runtime`，并在
 *   `proposal.metadata.render_runtime_source` 标记 `'user_confirmed'`。
 * - ⚠ **两者不冲突**：P5a 的「优先」是**缺省**行为；P3 的显式选择**覆盖**它。
 *   ⇒ 用户在 G1 门里选了 ffmpeg ⇒ **不试 Remotion**（试了就等于把用户的选择作废）。
 *
 * ## ⚠ 为什么必须看 `render_runtime_source`（而不是只看 runtime 的值）
 *
 * `explainer-artifacts.js` 的归一化会把**缺省或 LLM 自己给的** runtime 补成 `'remotion'`。
 * 若只看值：
 * - LLM 恰好返回 `'ffmpeg'` ⇒ 也会走 ffmpeg 独占路径 ⇒ **静默改掉 P5a 的既有行为**（回归）。
 * ⇒ 判据必须是「**用户确认过**」**且**「值是 ffmpeg」两条**同时**成立。
 *
 * @typedef {'remotion' | 'ffmpeg'} RenderRuntimeIntent
 */

/**
 * 判定这次 compose 该走哪条渲染路径。
 * @param {object} proposal - proposal artifact（`production_plan.render_runtime` + `metadata.render_runtime_source`）
 * @returns {RenderRuntimeIntent} 'ffmpeg' = 用户显式选了 ffmpeg（跳过 Remotion）；'remotion' = 走 Remotion 优先
 */
function resolveRenderRuntimeIntent (proposal) {
  const artifact = proposal && typeof proposal === 'object' ? proposal : {}
  const productionPlan = artifact.production_plan && typeof artifact.production_plan === 'object'
    ? artifact.production_plan
    : {}
  const metadata = artifact.metadata && typeof artifact.metadata === 'object' ? artifact.metadata : {}
  // ⚠ **逐字比较，不做 trim**：
  //   `render_runtime_source` 由本仓单一真源（`buildApprovalContextPatch`）逐字写入 'user_confirmed'；
  //   `render_runtime` 由门写入的是枚举值 'remotion' / 'ffmpeg'。
  //   ⇒ 带空白的值**不是**枚举成员 ⇒ 判据不成立 ⇒ fail-safe 到既有行为（Remotion 优先）。
  //   ⚠ **规范化是写入层的责任，不是消费层的宽容** —— 在消费端 trim 会让
  //   「值为 ' ffmpeg '」这种非枚举值静默生效，等于给判据开了一个后门。
  const runtime = typeof productionPlan.render_runtime === 'string' ? productionPlan.render_runtime : ''
  const source = typeof metadata.render_runtime_source === 'string' ? metadata.render_runtime_source : ''
  // ⚠ 两条**同时**成立才算「用户显式选了 ffmpeg」（见文件头「为什么必须看 source」）
  if (source === 'user_confirmed' && runtime === 'ffmpeg') return 'ffmpeg'
  return 'remotion'
}

module.exports = { resolveRenderRuntimeIntent }
