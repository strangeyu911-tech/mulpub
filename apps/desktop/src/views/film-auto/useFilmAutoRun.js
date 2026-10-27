// @ts-check
/**
 * useFilmAutoRun — 「自动」模式的运行态：进度同步、停止、断点续跑、收口合成、片段编辑。
 * 从 FilmAutoPanel.vue 抽出，仅搬迁不改语义。
 *
 * 三条纪律原样保留：
 *   ① 只读状态同步「事件优先 + 轮询兜底」，并以 runId/taskId 守卫防止陈旧响应覆盖新状态；
 *   ② 停止是**批间生效**（服务端把未开始的批留 pending，已完成的镜不重做），界面据此展示「正在停止」；
 *   ③ 收口合成走既有 pipeline 通道（`pipelineStartOrchestrated('film-engineering', { initialContext: { renderManifest } })`），
 *      与全量出片收口同一条引擎路径——自动模式不新造合成器。
 *
 * 依赖经 ctx 注入（feApi/t/props + 面板持有的 phase/project/plan/… 状态），保证与面板是同一份状态。
 */
import { ref, computed, onMounted, onBeforeUnmount } from 'vue'
import { resolveProgressCounters, resolveProgressMessageKeys } from './auto-progress-counters'
import { ElMessage } from 'element-plus'
import {
  pipelineStartOrchestrated, pipelineGetRunContext, onPipelineUpdate,
  story2videoShowInFolder, story2videoSaveAs,
} from '@/api/publisher'
import { toFileUrl } from './file-url'

export function useFilmAutoRun (ctx) {
  const { feApi, t, props, phase, project, plan, busy, errorText, errorCode, form, editingShotIndex, fail, unwrap } = ctx || {}
const progress = ref({ doneCount: 0, totalCount: 0, batchIndex: null, lastType: '' })
// ⚠ **批次是否还在跑**（唯一权威来源 = 后端 `auto-status` 的 `running`）
//   · 为什么不用 `phase`：任务中断（失败/停止）时 `running=false` 但 `phase` 停在 'running'
//     ⇒ 用 phase 会把「已经停了」说成「还在落盘」⇒ 骗用户。
//   · 为什么不用事件：`production:*` 事件负载**不带 running** ⇒ 只有轮询能给权威值。
//   · 为什么不用 `progress.doneCount` 的两个口径比较：那只能区分「磁盘领先台账」，
//     分不出「第一镜还没落盘」与「已经停了」两种都等于 0 的情形。
const batchRunning = ref(false)

/**
 * 「批次是否还在跑」的**唯一写点**。
 * ⚠ 为什么要收成一处：`running` 有**两个**消费者（`refreshStatus` 轮询 / `restoreLastTask` 重开续跑），
 *   两处都读后端 `data.running` ⇒ 若各自写 `batchRunning`，漏一处就会出现
 *   「**同一时刻两套文案口径**」（启动路径说「正在落盘」、重开路径说「已完成 N/M」）。
 * ⇒ 收成一处 ⇒ 口径天然一致。
 * @param {unknown} running 后端 `auto-status` 的 `running` 字段（严判 `=== true`）
 */
function applyBatchRunning (running) {
  batchRunning.value = running === true
}
const composeRunId = ref('')
const composePercent = ref(0)
const composePhase = ref('')       // '' | 'running' | 'done' | 'failed'
const composeError = ref('')
const finalPath = ref('')
const finalUnavailable = ref('')
const stopping = ref(false)
const restored = ref(false)
/**
 * provider 运行态（PRD §3.2.5.3 缺陷③）。
 *
 * ⚠ 饱和（熔断）期间面板**不得**只显示「失败」或「0/N」⇒ 必须有一条
 *   「服务商繁忙 + 预计恢复时间」的可见状态（否则用户只看到卡住不动）。
 * ⚠ 数据源有两路，**事件优先、轮询兜底**（与进度同纪律）：
 *   - 事件：`production:provider-status`（运行期实时）
 *   - 轮询：`auto-status` 的 `providerStatus`（重开项目时可见）
 */
const providerStatus = ref(null)
/** 瞬时提示（「服务商已恢复」）—— 5 秒后自动消失，不留历史痕迹 */
const providerNotice = ref('')
let providerNoticeTimer = null
const LAST_TASK_KEY = 'film-auto:last-task-id'
let unsubscribeAuto = null
let unsubscribePipeline = null
let pollTimer = null
let composePollTimer = null
const percent = computed(() => {
  const total = Number(progress.value.totalCount) || 0
  if (total <= 0) return 0
  return Math.round((Number(progress.value.doneCount) || 0) / total * 100)
})
const stepIndex = computed(() => ({ input: 0, preview: 1, running: 2, done: 3 }[phase.value] || 0))

/** 进度提示语义（执行中「正在落盘」/ 已收口「已完成 N/M」）——派生自 batchRunning，单一真源 */
const progressMessageKeys = computed(() => resolveProgressMessageKeys({
  running: batchRunning.value,
  done: Number(progress.value.doneCount) || 0,
  total: Number(progress.value.totalCount) || 0,
}))

/** StageProgress 阶段清单：把 auto 的批次进度映射成阶段列表（复用既有渲染与状态语义） */
const stageList = computed(() => {
  const total = Number(progress.value.totalCount) || Number(plan.value?.shotCount) || 0
  const done = Number(progress.value.doneCount) || 0
  const running = phase.value === 'running'
  const finished = phase.value === 'done'
  const batchCount = Number(plan.value?.batchCount) || (plan.value?.estimates?.batchCount) || 1
  const planStage = { name: 'film_auto_plan', status: phase.value === 'preview' ? 'paused' : 'completed' }
  const genStage = {
    name: 'film_auto_generate',
    status: finished ? 'completed' : (running ? 'running' : 'pending'),
    progress: total > 0
      ? { percent: Math.round(done / total * 100), messageKey: progressMessageKeys.value.stageKey, messageParams: progressMessageKeys.value.params }
      : null,
  }
  const composeStage = {
    name: 'film_auto_render',
    status: composeRunId.value ? (composePercent.value >= 100 ? 'completed' : 'running') : (finished ? 'pending' : 'pending'),
    progress: composeRunId.value ? { percent: composePercent.value } : null,
  }
  void batchCount
  return [planStage, genStage, composeStage]
})

const shots = computed(() => (project.value && Array.isArray(project.value.shots) ? project.value.shots : []))
/** 未完成的镜：缺镜时先禁用收口合成并列出序号，而不是等用户点了才报错（成本/体验双考虑） */
const missingShots = computed(() => shots.value.filter((s) => s.status !== 'done'))
const canCompose = computed(() => phase.value === 'done' && missingShots.value.length === 0 && !busy.value)
const finalFileUrl = computed(() => toFileUrl(finalPath.value))
/** 预估磁盘占用（服务端已返回，此前未在确认卡上展示——用户应当在花钱前看到硬盘代价） */
const diskEstimateText = computed(() => {
  const bytes = Number(plan.value && plan.value.estimates && plan.value.estimates.diskEstimateBytes) || 0
  if (bytes <= 0) return ''
  const gib = bytes / (1024 * 1024 * 1024)
  return gib >= 1 ? gib.toFixed(1) + ' GB' : Math.max(1, Math.round(bytes / (1024 * 1024))) + ' MB'
})
/** 预估墙钟（按每镜 300s 的既有口径，与 IPC 的 production-plan 同源） */
const wallclockText = computed(() => {
  const sec = Number(plan.value && plan.value.estimates && plan.value.estimates.wallclockEstimateSeconds) || 0
  if (sec <= 0) return ''
  const hours = sec / 3600
  return hours >= 1 ? hours.toFixed(1) + ' h' : Math.max(1, Math.round(sec / 60)) + ' min'
})
// ── 只读状态同步（事件优先 + 轮询兜底）─────────────────────────────────

async function refreshStatus () {
  const api = feApi()
  if (!api || !plan.value) return
  try {
    const data = unwrap(await api.autoStatus({ taskId: plan.value.taskId }))
    if (!data || !data.exists) return
    project.value = data
    // ⚠️ 两个口径**同名不同义**，必须分开（2026-10-25）：
    //   - `data.doneCountOnDisk` = 磁盘上**已落盘**的镜数（批次执行期间就在涨）⇒ **只用于显示**；
    //   - `data.doneCount`       = 台账里**有结论**（done）的镜数（批次收口后才准）⇒ **收口判定必须用它**。
    // ⚠️ 磁盘有片 ≠ 该镜成功 ⇒ 若拿磁盘口径做收口判定，会在产物还在落盘时**提前收口**。
    //   两个口径由 resolveProgressCounters 一次产出（displayDone / closeDone 分名）⇒ 用错口径会显眼。
    const counters = resolveProgressCounters({
      ledgerDone: data.doneCount,
      diskDone: data.doneCountOnDisk,
    })
    progress.value = {
      doneCount: counters.displayDone,
      totalCount: Number(data.totalCount) || progress.value.totalCount,
      batchIndex: progress.value.batchIndex,
      lastType: progress.value.lastType,
    }
    // ⚠ 执行中 vs 已收口：判据只认后端报的 running（**单一真源**，见 auto-progress-counters.js）
    applyBatchRunning(data.running)
    // provider 运行态（轮询兜底：重开项目时也能看到「服务商繁忙」）
    if (data.providerStatus) applyProviderStatus(data.providerStatus)
    const total = Number(data.totalCount) || 0
    const done = counters.closeDone // ⚠️ 收口判定**只认台账口径**（磁盘有片 ≠ 该镜成功）
    const shotsNow = Array.isArray(data.shots) ? data.shots : []
    const failed = shotsNow.filter((s) => s.status === 'failed').length
    if (data.running) {
      phase.value = 'running'
      return
    }
    // 收口条件：**不再运行**且每一镜都有结论（完成或失败）。
    // 早期写法只认「全部完成」，导致部分失败的任务永远停在运行态、连片段编辑与收口入口都到不了——
    // 失败镜必须能被看见并单镜重生成，这才是「生成后可对某个片段修改调整」的完整闭环。
    if (total > 0 && (done + failed) >= total) {
      finalUnavailable.value = data.manifestError || ''
      phase.value = 'done'
      stopPolling()
    }
  } catch { /* 轮询失败不改状态（下一轮重试） */ }
}

/**
 * 应用 provider 运行态（事件 / 轮询两路共用一份口径）。
 * @param {{state?:string, pending?:number, estimatedRecoveryMinutes?:number}} next
 */
function applyProviderStatus (next) {
  if (!next || typeof next !== 'object') return
  const state = String(next.state || 'normal')
  const wasBusy = providerStatus.value && providerStatus.value.state && providerStatus.value.state !== 'normal'
  providerStatus.value = {
    state,
    pending: Number(next.pending) || 0,
    estimatedRecoveryMinutes: Number(next.estimatedRecoveryMinutes) || 0,
  }
  // 「恢复」提示只在**从繁忙回到正常**时给一次，且自动消失
  if (state === 'normal' && wasBusy) {
    providerNotice.value = 'filmEngineering.auto.providerStatus.recovered'
    if (providerNoticeTimer) clearTimeout(providerNoticeTimer)
    providerNoticeTimer = setTimeout(() => {
      providerNotice.value = ''
      providerNoticeTimer = null
    }, 5000)
  }
}

function applyAutoEvent (evt) {
  if (!evt || typeof evt !== 'object') return
  // ★ provider 运行态事件（PRD §3.2.5.3）：先于进度处理，避免被后面的通用分支吞掉
  if (evt.type === 'production:provider-status') {
    applyProviderStatus(evt)
    return
  }
  progress.value = {
    // ⚠️ 事件口径只带台账 doneCount（无磁盘口径）⇒ 与当前显示值取 max，**不让进度回退**
    // （收口事件可能报一个比磁盘口径小的数 ⇒ 直接赋值会让进度条倒退）。
    doneCount: Math.max(Number(evt.doneCount) || 0, Number(progress.value.doneCount) || 0),
    totalCount: Number(evt.totalCount) || progress.value.totalCount,
    batchIndex: evt.batchIndex === undefined ? progress.value.batchIndex : evt.batchIndex,
    lastType: String(evt.type || ''),
  }
  if (evt.type === 'production:complete') {
    stopPolling()
    void refreshStatus()
  }
}

function startPolling () {
  stopPolling()
  const interval = Number(props.pollIntervalMs) > 0 ? Number(props.pollIntervalMs) : 3000
  pollTimer = setInterval(() => { void refreshStatus() }, interval)
}

function stopPolling () {
  if (pollTimer) { clearInterval(pollTimer); pollTimer = null }
}

// ── 停止与「重新打开继续」──────────────────────────────────────────────

/** 记住/读取最近任务 ID：这是「重新打开可续跑」在界面上的落点（服务端续跑靠同名任务） */
function persistLastTask (taskId) {
  try {
    if (typeof localStorage !== 'undefined' && taskId) localStorage.setItem(LAST_TASK_KEY, String(taskId))
  } catch { /* 隐私模式/无 localStorage：不影响主流程 */ }
}

function readLastTask () {
  try {
    if (typeof localStorage === 'undefined') return ''
    return String(localStorage.getItem(LAST_TASK_KEY) || '')
  } catch { return '' }
}

/**
 * 请求停止（**批间生效**）：当前批跑完即止，未开始的批保持待跑 ⇒ 停下后天然可续跑。
 * 服务端只对正在运行的任务置标志；界面立刻回「已请求停止」，真实停点由后续状态同步确认。
 */
async function stopRun () {
  const api = feApi()
  if (!api || !plan.value) return { ok: false }
  try {
    const data = unwrap(await api.autoStop({ taskId: plan.value.taskId }))
    const stoppingNow = Boolean(data && data.stopping)
    stopping.value = stoppingNow
    if (stoppingNow) ElMessage.warning(t('filmEngineering.auto.stopRequested'))
    return { ok: true, stopping: stoppingNow }
  } catch (e) {
    fail((e && e.message) || String(e), e && e.errorCode)
    return { ok: false }
  }
}

/**
 * 恢复上次任务（「重新打开可续跑」）：同名任务在服务端就是续跑。
 * 关键：**不依赖计划**——计划在首次启动时已被消费（防重放），续跑的信息全部来自项目投影与磁盘复核。
 */
async function restoreLastTask (taskId) {
  const api = feApi()
  const id = String(taskId || readLastTask() || '')
  if (!api || !id) return false
  try {
    const data = unwrap(await api.autoStatus({ taskId: id }))
    if (!data || !data.exists) return false
    project.value = data
    plan.value = {
      planId: data.planId,
      taskId: data.taskId,
      aspect: data.aspect,
      seconds: data.seconds,
      targetDurationSec: data.targetDurationSec,
      plannedDurationSec: data.plannedDurationSec,
      shotCount: data.totalCount,
      batchCount: Math.max(1, Math.ceil((Number(data.totalCount) || 0) / 10)),
      provider: { id: data.providerId, model: '' },
      warnings: [],
      shots: [],
      estimates: null,
    }
    progress.value = {
      // 重开项目：同样按「台账 ∪ 磁盘」显示（磁盘上本轮已落盘的片也算已产出）
      doneCount: resolveProgressCounters({ ledgerDone: data.doneCount, diskDone: data.doneCountOnDisk }).displayDone,
      totalCount: Number(data.totalCount) || 0,
      batchIndex: null,
      lastType: '',
    }
    restored.value = true
    errorText.value = ''
    // ⚠ **复核 B1（真实缺陷）**：`restoreLastTask` 是 `data.running` 的**第二个消费者**
    //   （「关页面 → 重开续跑」这条产品明文承诺的路径）⇒ 此前**只设 phase、没写 batchRunning**
    //   ⇒ 面板在该路径上仍说「已完成 N / M」（执行期那句话仍在说谎）⇒ 现在接上**唯一写点**。
    applyBatchRunning(data.running)
    if (data.running) {
      phase.value = 'running'
      startPolling()
    } else {
      const failed = (data.shots || []).filter((s) => s.status === 'failed').length
      const total = Number(data.totalCount) || 0
      const done = Number(data.doneCount) || 0
      phase.value = total > 0 && (done + failed) >= total ? 'done' : 'preview'
    }
    return true
  } catch { return false }
}

// ── ④ 收口合成（与全量出片同一条引擎路径）──────────────────────────────

/** 合成 run 快照：推送路径带 runId 守卫（防陈旧事件覆盖新 run），轮询路径由调用方比对 */
function applyComposeSnapshot (snapshot, fromPush) {
  if (!snapshot || typeof snapshot !== 'object') return
  if (fromPush && snapshot.runId !== composeRunId.value) return
  const statusObj = snapshot.status && typeof snapshot.status === 'object' ? snapshot.status : null
  const runStatus = statusObj ? statusObj.status : snapshot.status
  const context = snapshot.context && typeof snapshot.context === 'object' ? snapshot.context : null
  if (context && context.render && typeof context.render === 'object' && context.render.finalPath) {
    finalPath.value = String(context.render.finalPath)
  }
  const p = Number(snapshot.progress)
  if (Number.isFinite(p)) composePercent.value = Math.max(0, Math.min(100, Math.round(p)))
  if (runStatus === 'completed') {
    composePhase.value = 'done'
    composePercent.value = 100
    stopComposePolling()
    return
  }
  if (runStatus === 'failed') {
    composePhase.value = 'failed'
    composeError.value = (snapshot.error && (snapshot.error.message || snapshot.error.error)) || t('filmEngineering.auto.composeFailed')
    stopComposePolling()
  }
}

async function compose () {
  const api = feApi()
  if (!api || !plan.value) return
  if (missingShots.value.length > 0) return fail(t('filmEngineering.auto.composeMissing', { shots: missingShots.value.length }))
  busy.value = true
  errorText.value = ''
  composeError.value = ''
  try {
    const data = unwrap(await api.autoCompose({ taskId: plan.value.taskId }))
    const manifest = data && data.renderManifest
    if (!Array.isArray(manifest) || manifest.length === 0) throw new Error(t('filmEngineering.auto.composeNoManifest'))
    const payload = JSON.parse(JSON.stringify({ autoAdvance: true, initialContext: { renderManifest: manifest } }))
    const res = await pipelineStartOrchestrated('film-engineering', payload)
    if (!res || res.code !== 0 || !res.data || !res.data.success || !res.data.runId) {
      throw new Error((res && (res.message || (res.data && res.data.error))) || t('filmEngineering.auto.composeFailed'))
    }
    composeRunId.value = res.data.runId
    composePercent.value = 0
    composePhase.value = 'running'
    if (typeof unsubscribePipeline === 'function') { try { unsubscribePipeline() } catch { /* 无害 */ } }
    unsubscribePipeline = onPipelineUpdate((snapshot) => applyComposeSnapshot(snapshot, true))
    startComposePolling()
  } catch (e) {
    fail((e && e.message) || String(e))
  } finally {
    busy.value = false
  }
}

/** 合成进度轮询兜底：读 run context 取 finalPath 与进度（事件丢失也能收敛） */
async function pollComposeRun () {
  if (!composeRunId.value) return
  try {
    const res = await pipelineGetRunContext(composeRunId.value)
    if (!res || res.code !== 0 || !res.data) return
    applyComposeSnapshot(res.data, false)
  } catch { /* 下一轮重试 */ }
}

function startComposePolling () {
  stopComposePolling()
  const interval = Number(props.pollIntervalMs) > 0 ? Number(props.pollIntervalMs) : 3000
  composePollTimer = setInterval(() => { void pollComposeRun() }, interval)
}

function stopComposePolling () {
  if (composePollTimer) { clearInterval(composePollTimer); composePollTimer = null }
  if (typeof unsubscribePipeline === 'function') { try { unsubscribePipeline() } catch { /* 无害 */ } unsubscribePipeline = null }
}

async function openFinalFolder () {
  if (!finalPath.value) return
  try { await story2videoShowInFolder(finalPath.value) } catch (e) { fail((e && e.message) || String(e)) }
}

async function saveFinalAs () {
  if (!finalPath.value) return
  try { await story2videoSaveAs(finalPath.value) } catch (e) { fail((e && e.message) || String(e)) }
}

// ── ⑤ 片段编辑 ────────────────────────────────────────────────────────

function openEditor (index) {
  editingShotIndex.value = index
}

async function saveShotEdit (payload) {
  const api = feApi()
  if (!api || !plan.value) return { ok: false }
  try {
    const data = unwrap(await api.autoUpdateShot({ taskId: plan.value.taskId, shotIndex: payload.shotIndex, patch: payload.patch }))
    await refreshStatus()
    return { ok: true, shot: data && data.shot }
  } catch (e) {
    fail((e && e.message) || String(e))
    return { ok: false, message: (e && e.message) || String(e) }
  }
}

async function regenerateShot (index) {
  const api = feApi()
  if (!api || !plan.value) return { ok: false }
  try {
    const data = unwrap(await api.autoRegenerateShot({ taskId: plan.value.taskId, shotIndex: index, confirmed: true }))
    if (data && data.needsReconfirm) return { ok: false, needsReconfirm: true }
    await refreshStatus()
    if (typeof data !== 'undefined') errorText.value = ''
    return { ok: true, path: data && data.path }
  } catch (e) {
    fail((e && e.message) || String(e))
    return { ok: false, message: (e && e.message) || String(e) }
  }
}

function resetAll () {
  phase.value = 'input'
  plan.value = null
  project.value = null
  confirmed.value = false
  composeRunId.value = ''
  composePercent.value = 0
  progress.value = { doneCount: 0, totalCount: 0, batchIndex: null, lastType: '' }
  providerStatus.value = null
  providerNotice.value = ''
  if (providerNoticeTimer) { clearTimeout(providerNoticeTimer); providerNoticeTimer = null }
  stopPolling()
}

onMounted(() => {
  const api = feApi()
  if (api && typeof api.onAutoUpdate === 'function') {
    unsubscribeAuto = api.onAutoUpdate(applyAutoEvent)
  }
  // 「重新打开可续跑」：优先恢复上次的任务（同名任务在服务端即续跑），失败则安静留在输入态
  void restoreLastTask()
})

onBeforeUnmount(() => {
  if (typeof unsubscribeAuto === 'function') unsubscribeAuto()
  if (typeof unsubscribePipeline === 'function') unsubscribePipeline()
  stopPolling()
  if (composePollTimer) { clearInterval(composePollTimer); composePollTimer = null }
  // 注入的 <input type="file"> 的回收跟着 fileInput 变量走，已移交 useFilmAutoRefs
})

  return {
    progress, composeRunId, composePercent, composePhase, composeError, finalPath, finalUnavailable,
    stopping, restored, providerStatus, providerNotice,
    percent, stepIndex, stageList, progressMessageKeys, shots, missingShots, canCompose, finalFileUrl, diskEstimateText, wallclockText,
    refreshStatus, applyAutoEvent, applyProviderStatus, startPolling, stopPolling, persistLastTask, readLastTask,
    stopRun, restoreLastTask, applyComposeSnapshot, compose, pollComposeRun, startComposePolling, stopComposePolling,
    openFinalFolder, saveFinalAs, openEditor, saveShotEdit, regenerateShot, resetAll,
  }
}
