/**
 * 出片进度的**两个口径**：台账口径 vs 磁盘口径（2026-10-25）。
 *
 * ## 为什么必须分成两个（实测）
 *
 * 逐镜状态是在**批次收口**时才回写台账的（`runAutoBatch` 的 `persist` 在批末）⇒
 * 批次执行期间台账里每镜仍是 `pending` ⇒
 * 面板「已完成 N / M」在出片过程中**一直显示 0**（实测 12 镜时全程 0/12）⇒ 用户以为没在干活。
 * ⇒ 磁盘口径（已落盘的 `shot_NNN.mp4` 数）能给出**真实进行中反馈**。
 *
 * ## ⛔ 但磁盘口径**绝不能**用于收口判定
 *
 * **磁盘有片 ≠ 该镜成功**（可能是上一轮残留、或该镜最终被判失败）⇒
 * 拿它做「是否收口」的判定，会在产物还在落盘时**提前收口**。
 * ⇒ 本文件**同时**吐出两个口径，且**把收口口径单独命名**（`closeDone`），
 * 让「用错口径」变成一次显眼的取值，而不是一个隐式约定。
 *
 * @param {{ledgerDone?:number, diskDone?:number}} [input]
 * @returns {{displayDone:number, closeDone:number, diskDone:number}}
 */
export function resolveProgressCounters (input) {
  const o = input || {}
  const ledger = Number(o.ledgerDone) || 0
  const disk = Number(o.diskDone) || 0
  return {
    /** 显示用：取两个口径的较大者 ⇒ 执行期显示真实落盘数，收口后与台账一致 */
    displayDone: Math.max(ledger, disk),
    /** 收口判定用：**只认台账口径**（每镜有 done/failed 结论才算） */
    closeDone: ledger,
    /** 磁盘口径原值（可单独展示为「已落盘 N」） */
    diskDone: disk,
  }
}

/**
 * 出片进度的**提示语义**：执行中（产物在落盘）vs 已收口（台账已定）。
 *
 * ## 为什么必须分成两种（实测）
 *
 * 逐镜状态是在**批次收口**时才回写台账 ⇒ **执行期间台账里每镜仍是 pending**
 * ⇒ 此时面板若说「已完成 N / M」，那个 N 只能来自**磁盘口径**（已落盘的片数）
 * ⇒ ⚠ **磁盘有片 ≠ 该镜成功**（可能是残留、也可能该镜最终被判失败）
 * ⇒ ⇒ **执行中说「已完成」是在说谎**（用户会以为这 N 镜已经成了）。
 * ⇒ ⇒ 执行中改说「产物正在落盘，进度以磁盘为准」（**只承诺正在落盘，不承诺成功**），
 * 收口后才说「已完成 N / M」（那时 N 来自台账，每镜都有结论）。
 *
 * ## 判据只用 `running`（**单一真源**）
 *
 * `running` 来自后端 `auto-status` 的 `runningAutoTasks.has(taskId)`
 * ⇒ 它精确等于「这个任务当前在主进程里跑着」⇒ **批次还在跑**。
 * ⚠ **不能用 `phase` 代替**：任务中断（失败/停止）时 `running=false` 但 `phase` 会停在 `'running'`
 * ⇒ 用 phase 会把「已经停了」说成「还在落盘」⇒ **那是在骗用户**。
 * ⚠ 事件负载（`production:*`）**不带 running** ⇒ 只有轮询能给权威值
 * ⇒ ⇒ 本函数**只吃轮询来的 `running`**，事件不参与判定（避免两处口径打架）。
 *
 * @param {{running?: boolean, done?: number, total?: number}} [input]
 * @returns {{landing: boolean, summaryKey: string, stageKey: string, params: {done: number, total: number}}}
 */
export function resolveProgressMessageKeys (input) {
  const o = input || {}
  // ⚠ 严判 `=== true`：只有后端明确报 true 才算「在跑」
  // ⇒ 字段缺失/undefined/null/字符串 'true' 一律按「不在跑」处理（**保守侧**：不谎称正在落盘）
  const landing = o.running === true
  const params = { done: Number(o.done) || 0, total: Number(o.total) || 0 }
  return {
    /** true = 执行中（产物在落盘）；false = 已收口（或尚未开始） */
    landing,
    // 两处 settled 文案沿用既有 key（形状不变）；执行中两处共用同一个 landing key
    summaryKey: landing ? 'filmEngineering.auto.landingProgress' : 'filmEngineering.auto.runSummary',
    stageKey: landing ? 'filmEngineering.auto.landingProgress' : 'filmEngineering.auto.stageShotProgress',
    params,
  }
}
