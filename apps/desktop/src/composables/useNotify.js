// @ts-check
/**
 * useNotify.js — 通知 composable（统一通知通道，D1 决策）
 *
 * 职责（对应 01-docs/ARCH-notify-log-standard.md §3.3）：
 *   - 统一入口：notify / notifyError / notifySuccess / notifyWarning / notifyConfirm
 *   - 内部：notifyCore 解析文案 + 日志上报 → ElMessage/ElMessageBox 展示
 *   - 时长、档位与同源合并由 utils/toast-policy 唯一持有（调用点显式 duration 一律被夹住）
 *   - 未命中 messageKey 时：error 级用 fallback 兜底，其余静默（避免空白 toast）
 *
 * 依赖（薄封装）：
 *   - notifyCore：文案解析 + notify:log 上报
 *   - element-plus：ElMessage / ElMessageBox 展示
 */
import { ElMessage, ElMessageBox } from 'element-plus'
import { createBurstGuard } from '@/utils/notify-burst'
import i18n from '@/i18n'
import { notifyText, reportNotify } from '@/utils/notifyCore'
import { looksLikeI18nKey } from '@/utils/message-contract'
import { resolveToastDuration, resolveToastGrouping, resolveToastType, TOAST_TYPE_BY_LEVEL } from '@/utils/toast-policy'

/**
 * 统一通知入口。
 * @param {string} messageKey - 如 'story2video.quota_exceeded' / 'operation_failed'
 * @param {object} [options]
 * @param {object} [options.params] - 插值参数
 * @param {string} [options.module]
 * @param {'success'|'info'|'warning'|'warn'|'error'|'confirm'} [options.level]
 * @param {string} [options.fallback] - 未命中 key 时的兜底文案（error 级）
 * @returns {string} 展示的文案（未命中且无 fallback 返回 ''）
 */
export function useNotify () {
  // 阶段 4.6「连发限频」：guard 挂在**本次 useNotify() 调用**上（不是模块级全局）。
  // 理由两条，都不是"图省事"：
  //  ① 症状来源是**一个循环里逐条弹**（批量发布 N 个账号各失败一次、批量采集逐条报错），
  //     这些调用共用同一个 composable 实例 ⇒ 实例级就足以消灭叠屏。
  //  ② 模块级全局会把无关组件的通知预算互相吃掉（A 面板刚弹满 6 条，B 面板的失败提示就没了），
  //     那是一条"看起来在守、实际随机吞通知"的新缺陷，比叠屏更坏。
  // 代价如实写：两个组件在同一时刻各自爆发，仍可能叠出 2×limit 条 —— 全局可见条数不是本判据的域。
  const burstGuard = createBurstGuard()

  function notify (messageKey, options = {}) {
    const level = options.level || 'info'
    // 支持直接传文案（options.message 优先于 messageKey 解析），用于动态/运行时拼接文案
    const rawText = typeof options.message === 'string' && options.message
      ? options.message
      : notifyText(messageKey, options)
    // 防泄漏守卫：直接传文案若仍是 i18n 原始 key 形态，拦截并回退（i18n-user-facing-messages）
    const text = rawText && looksLikeI18nKey(rawText) ? '' : rawText
    if (!text) {
      // 未命中 key：error 级用 fallback 兜底，其余静默
      if (level === 'error' && options.fallback) {
        reportNotify(messageKey, { ...options, level: 'error', error: options.fallback })
        ElMessage.error({
          message: options.fallback,
          type: 'error',
          duration: resolveToastDuration('error', options.duration).ms,
          grouping: resolveToastGrouping(options.grouping),
        })
        return options.fallback
      }
      return ''
    }
    // 未知 level：改动前就是"什么都不弹"（主干 4.6 的准入判断），这里保持原样，且**不占限频窗口**。
    // （QM-6 外部评审 i4：先扣额度再判档位，会让 6 个静默调用把窗口烧满，随后真实错误 toast 被误抑制
    //   —— 那是比"未知档位要不要兜底展示"更坏的回归方向。）
    // 存在性判断不另列一份名单：直接问策略层的唯一词表 TOAST_TYPE_BY_LEVEL（两处各存一份必漂移）。
    if (!Object.prototype.hasOwnProperty.call(TOAST_TYPE_BY_LEVEL, level)) {
      reportNotify(messageKey, { ...options, level, error: text })
      return text
    }
    const burst = burstGuard()
    if (!burst.allow) {
      // 抑制的是"再叠一条遮挡界面的 toast"，不是"这件事没发生过"：
      // ① 日志照上报（notify:log 是排障真源，不得因为少弹一条就少记一笔）；
      // ② console.warn 出声并带累计抑制数 —— 静默丢弃是本条要修的同型缺陷，
      //    而"限频生效了"与"限频把通知全吞了"在用户侧完全同形，必须留可归因痕迹。
      // ③ 被抑制的那条不做策略解析：它不会真的展示，解析出的时长/分组无处可去。
      reportNotify(messageKey, { ...options, level, error: text })
      console.warn('[notify] burst-limit: window already showed ' + burst.inWindow + ' toasts, suppressed ' + burst.suppressedCount + ' this run (level=' + level + ')')
      return text
    }
    // 阶段 2.7（audit-60 更正后的真实缺口）：时长与同源合并由 toast-policy 唯一持有，
    // 调用点显式 duration 一律被策略夹住；`grouping` 默认开（审计现场的"刷屏"就是
    // 同一句话被堆成一片），只有调用点显式 `grouping: false` 才各算一次。
    //
    // 出口形态取 `ElMessage[type]({ message, duration, grouping })`：类型方法承载档位，选项承载策略。
    // 不写成 `ElMessage({ type, ... })` 是实测决定的——本仓 16 个消费者测试的 element-plus 夹具只提供
    // 命名方法（宿主确实提供命名方法），换成泛化形态会让它们全部报 "ElMessage is not a function"。
    // 宿主签名实测（`node_modules/element-plus/es/components/message/src/message.d.ts`）：
    //   `MessageTypedFn: (options?: MessageParamsWithType, appContext?) => MessageHandler`（d.ts:173）
    //   档位词表只住在 utils/toast-policy 的 TOAST_TYPE_BY_LEVEL（两处各存一份必漂移）；`MessageOptions` 含
    //   `type` / `duration`（"If set to 0, it will not turn off automatically"）/ `grouping`。
    const type = resolveToastType(level)
    const { ms, fellBack, reason } = resolveToastDuration(level, options.duration)
    if (fellBack) {
      // 不得静默：静默会让"我传的时长没生效"永远不被知道
      console.warn('[notify] duration rejected by policy, fallback applied: ' + reason + ' (key=' + String(messageKey || '') + ', requested=' + String(options.duration) + ')')
    }
    ElMessage[type]({ message: text, duration: ms, grouping: resolveToastGrouping(options.grouping) })
    // P1 可观测性：把用户实际看到的文案作为 error 字段上报（此前只报 messageKey，
    // 主进程日志无法得知用户看到了什么内容；error 字段经 notify:log 脱敏后落盘）
    reportNotify(messageKey, { ...options, level, error: text })
    return text
  }

  function notifyError (messageKey, options = {}) {
    return notify(messageKey, { ...options, level: 'error' })
  }

  function notifySuccess (messageKey, options = {}) {
    return notify(messageKey, { ...options, level: 'success' })
  }

  function notifyWarning (messageKey, options = {}) {
    return notify(messageKey, { ...options, level: 'warning' })
  }

  function notifyInfo (messageKey, options = {}) {
    return notify(messageKey, { ...options, level: 'info' })
  }

  /**
   * 确认弹窗（confirm 级）。
   * @param {string} messageKey
   * @param {object} [options]
   * @param {object} [options.params]
   * @param {string} [options.module]
   * @param {string} [options.title] - 弹窗标题（缺省用 messageKey 文案）
   * @param {string} [options.confirmButtonText]
   * @param {string} [options.cancelButtonText]
   * @param {'warning'|'error'|'info'} [options.type]
   * @returns {Promise<boolean>} 用户确认返回 true，取消返回 false
   */
  async function notifyConfirm (messageKey, options = {}) {
    // options.message 直接传文案（动态/运行时拼接），否则用 messageKey 解析
    const rawText = typeof options.message === 'string' && options.message
      ? options.message
      : notifyText(messageKey, options)
    // 防泄漏守卫：直接传文案若仍是 i18n 原始 key 形态，拦截（i18n-user-facing-messages）
    const text = rawText && looksLikeI18nKey(rawText) ? '' : rawText
    if (!text) return false
    // 标题/按钮同样拦截原始 key 泄漏
    const title = options.title && looksLikeI18nKey(options.title) ? '' : options.title
    const confirmButtonText = options.confirmButtonText && looksLikeI18nKey(options.confirmButtonText)
      ? i18n.global.t('common.confirm')
      : options.confirmButtonText
    const cancelButtonText = options.cancelButtonText && looksLikeI18nKey(options.cancelButtonText)
      ? i18n.global.t('common.cancel')
      : options.cancelButtonText
    reportNotify(messageKey, { ...options, level: 'confirm' })
    try {
      await ElMessageBox.confirm(text, title || '', {
        confirmButtonText: confirmButtonText || i18n.global.t('common.confirm'),
        cancelButtonText: cancelButtonText || i18n.global.t('common.cancel'),
        type: options.type || 'warning',
      })
      return true
    } catch (_) {
      return false
    }
  }

  return {
    notify,
    notifyError,
    notifySuccess,
    notifyWarning,
    notifyInfo,
    notifyConfirm,
  }
}
