// @ts-check
/**
 * schedule-quota — 定时任务数量上限的纯函数判据（P1-3）。
 *
 * 真源是服务端 `entitlement.limits.max_scheduled_tasks`：
 *   free = 0（不可建）/ standard = 100 / pro = -1（不限）。
 *
 * 三条纪律：
 * 1. 缺失/非法上限 → null（放行），不把快照字段漂移变成「定时按钮坏了」。
 * 2. 0 是合法上限（第 1 个就拒），不能写成 falsy 判断。
 * 3. 计数只算「待执行」：pending / submitted / dispatching；executed / failed / cancelled 不算。
 *    批量排期批次 status='scheduled' 也计入同一个池。
 */

const ACTIVE_STATUSES = new Set(['pending', 'submitted', 'dispatching'])

function readMaxScheduledTasks (entitlement) {
  const limits = entitlement && entitlement.limits
  const raw = limits ? limits.max_scheduled_tasks : null
  if (raw === null || raw === undefined || raw === '') return null
  const value = typeof raw === 'number' ? raw : Number(raw)
  return Number.isFinite(value) ? value : null
}

function isActiveScheduledTask (task) {
  if (!task || typeof task !== 'object') return false
  const status = task.status
  return !status || ACTIVE_STATUSES.has(status)
}

function countActiveScheduledTasks (tasks, batches = []) {
  const taskCount = Array.isArray(tasks) ? tasks.filter(isActiveScheduledTask).length : 0
  const batchCount = Array.isArray(batches)
    ? batches.filter(batch => batch && batch.status === 'scheduled').length
    : 0
  return taskCount + batchCount
}

/**
 * @param {object|null|undefined} entitlement
 * @param {Array} tasks scheduler.list 结果
 * @param {Array} [batches] store.listBatchJobs 结果
 * @returns {{limit:number|null,current:number,atLimit:boolean}}
 */
function scheduleLimitState (entitlement, tasks, batches = []) {
  const limit = readMaxScheduledTasks(entitlement)
  const current = countActiveScheduledTasks(tasks, batches)
  const unlimited = limit === null || limit < 0
  return { limit: unlimited ? null : limit, current, atLimit: !unlimited && current >= limit }
}

module.exports = {
  ACTIVE_STATUSES,
  readMaxScheduledTasks,
  isActiveScheduledTask,
  countActiveScheduledTasks,
  scheduleLimitState,
}
