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
