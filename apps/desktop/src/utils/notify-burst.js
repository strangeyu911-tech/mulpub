// 阶段 4.6「连发限频」：同一时间窗内可见 toast 条数的上限判据（单一实现，调用方只准用它）。
//
// 为什么需要它（审计 4.6 收窄后的可达那一半）：批量操作的失败面会**逐条**弹 toast（如批量发布 N 个账号
// 每个都失败），N 条同质通知叠在一起对用户不是信息而是遮挡；而 2026-10-19 的实测更正已经禁止
// 再叠第二个 live region，所以正解不是"加个容器"，是**限频**。
//
// 另一半「按类型分礼貌级」为什么不在这里做：实测 ElMessage 根节点 role 恒为 "alert"
// （node_modules/element-plus/es/components/message/src/message.vue_vue_type_script_setup_true_lang.mjs:113），
// 而 message.d.ts 未暴露任何 role/aria 选项 ⇒ 宿主 API 上做不到。改宿主渲染 DOM 或加第二个 live region
// 都被明文禁止，所以这一半属**宿主限制**，不是本批遗漏，已在执行记录与 PRD 里带证据写出。
//
// 三条口径（都是本仓踩过的）：
//  1. **不读 process.env**：渲染端读任意 env 会被 Vite 注成空对象桩（产物取证 var x={}），
//     把可调档位写成 env 旋钮等于造一条恒不生效的死开关。档位由调用方显式传参（测试用），
//     生产用下面两个常量。
//  2. **非法档位回落默认并出声**（对齐 publish-frequency-policy / task-queue 的 env 纪律的等价要求）：
//     limit=0 会变成"全部抑制"、windowMs=-1 会变成"永不抑制"，两者都读起来像"配好了"。
//  3. **每个 guard 实例自持状态**：不得用模块级全局计数——那会让"另一个页面/另一轮测试"的余温
//     决定本条是否显示，属于跨实例状态串味。

/** 一个时间窗内最多允许几条可见 toast */
export const BURST_LIMIT = 6
/** 时间窗长度（ms）：取 ElMessage 默认 duration(3000) 同量级，保证"窗口滑过"与"上一条已消失"大致同步 */
export const BURST_WINDOW_MS = 3000

function positiveInt (value, fallback, label, onInvalid) {
  if (value === undefined) return fallback
  if (!Number.isInteger(value) || value <= 0) {
    onInvalid(label + ' invalid, falling back to default: ' + label + '=' + JSON.stringify(value))
    return fallback
  }
  return value
}

/**
 * @param {() => number} now 时钟注入点（生产传 Date.now；测试用假时钟）
 * @returns {(messageOrOpts?: string | {windowMs?: number, limit?: number}) => {allow: boolean, inWindow: number, suppressedCount: number}}
 */
export function createBurstGuard (now) {
  const clock = typeof now === 'function' ? now : () => Date.now()
  /** @type {number[]} 窗口内**已放行**的时刻，单调递增（回拨时刻按"未过期"处理，见下） */
  const stamps = []
  let suppressedCount = 0

  return function decide (input) {
    const opts = typeof input === 'string' || input == null ? {} : input
    const onInvalid = (msg) => console.warn('[notify-burst] ' + msg)
    const windowMs = positiveInt(opts.windowMs, BURST_WINDOW_MS, 'windowMs', onInvalid)
    const limit = positiveInt(opts.limit, BURST_LIMIT, 'limit', onInvalid)

    const t = clock()
    // 只从队首弹出"确实已过期"的：t - stamps[0] >= windowMs。
    // 时钟回拨时该差值为负 ⇒ 一条都不弹 ⇒ 不会把整窗清空后绕过限频（行为锁第 5 条）。
    while (stamps.length > 0 && t - stamps[0] >= windowMs) stamps.shift()

    if (stamps.length >= limit) {
      suppressedCount++
      return { allow: false, inWindow: stamps.length, suppressedCount }
    }
    stamps.push(t)
    return { allow: true, inWindow: stamps.length, suppressedCount }
  }
}
