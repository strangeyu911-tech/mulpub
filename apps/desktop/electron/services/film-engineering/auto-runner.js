// @ts-check
'use strict'
/**
 * auto-runner — 自动模式的批执行器与单镜重生成（openspec change: film-auto-mode，design D21/D31/D15）
 *
 * 与 production-runner 的差异（这才是自动模式存在的意义）：
 *   - **提示词真源不同**：production-runner 从 film-kit 服务取原文（`service.getShot`），
 *     自动模式从 **project.json** 取（片段编辑后的提示词必须生效），仍逐字符直送 provider；
 *   - **批次落点不同**：runId 由 `runIdFor(taskId, batchIndex) = 'auto/<taskId>/b<N>'` 派生，
 *     产物落 `<mediaRoot>/auto/<taskId>/b<N>/shot_NNN.mp4`；**轮次 ≥2 时带轮次号**
 *     （`auto/<taskId>/r<runSeq>/b<N>/`）—— 同一 taskId 重新 plan 时旧轮次产物不得被采纳；
 *   - **单镜重生成**：批次目录内**原子覆盖**（临时目录生成 → ffprobe 校验 → rename），
 *     与 shot-downloader 的「探测通过才入库」同纪律（D15）。
 *
 * 逐镜失败不抛出：统一经 `onShotProgress(i, 'failed', reason)` 上报可辨识原因（与既有合同一致）。
 */

const fs = require('fs')
const path = require('path')
const { generateShotVideo, resolveFilmVideoProvider, getFilmRunDir, getFilmMediaRoot } = require('./video-gen')
const { probeClip } = require('./film-render')
const { PRODUCTION_BATCH_CONCURRENCY } = require('./production-runner')
const { PRODUCTION_BATCH_SIZE } = require('./production-driver')
const { readSaturation } = require('../adapters/_base/provider-saturation')
const { resolveShotSeconds } = require('./shot-effective-seconds')

/**
 * 视频 provider 的**有效并发**（PRD §3.2.5.3 缺陷①，2026-10-25 实测落地）
 *
 * ## 为什么是 1，而且**恒定**（不是「饱和了才降」）
 *
 * M0 取证实测：视频 provider **近似互斥受理** ——
 * 「成功提交之间的时间重叠率 **0/6**（近窗口）」、
 * 「近 20 分钟 19 次 `generateVideo` 调用中，**11 次超时全部与其它请求时间重叠，0 次独自在途**」。
 * ⇒ 批内并发 2 时，第二个请求**只是在 provider 队列里排队**，
 *   而客户端等待上限是 120s ⇒ **第二个请求必然超时**。
 * ⇒ 所以「饱和」不是偶发事件，而是**并发 2 时的必然结果** ⇒
 *   「等饱和了再降并发」来不及：因是第一对并发请求就会制造幽灵请求。
 * ⇒ 视频出片一律**单发**。
 *
 * ⚠ 与 `PRODUCTION_BATCH_CONCURRENCY`（=2，全量出片用）的关系：
 *   本常量**只约束自动模式**的视频批次，不动生产 runner 的并发口径。
 */
const AUTO_VIDEO_EFFECTIVE_CONCURRENCY = 1

/**
 * 单批内**最多等待** provider 排空多久（毫秒）。
 *
 * ⚠ 与「预计排空时间」的关系：预计值可能很大（实测 102 条滞留 ≈ 45 分钟），
 *   但**单批不能无限挂起** ⇒ 运行期等待封顶 5 分钟；
 *   真实预计恢复时间照常显示给用户（面板文案用 `estimatedRecoveryMinutes`）。
 * ⚠ 等待后**重新判定**：若已恢复 ⇒ 继续派发；若仍饱和 ⇒ 本镜不提交（可单独重生成）。
 */
const MAX_IN_RUN_DRAIN_WAIT_MS = 5 * 60 * 1000

/**
 * 自动模式批次 runId（批次落点：<mediaRoot>/auto/<taskId>/…/b<N>）。
 *
 * **轮次号进目录**（2026-10-23）：同一 taskId 用 overwrite 重新 plan 时，`createProject`
 * 会递增 `runSeq` 并把旧的 project.json / ledger.json 归档到 `archive/<runSeq>/`，
 * 但**产物目录原本不变**（`archiveTaskRun` 只搬那两个文件，不碰产物）。
 * 于是新轮次的 `b.runId` 与上一轮完全相同 ⇒ `resolveResumePlan` 的磁盘复核看到
 * 上一轮的 `shot_NNN.mp4` 还在 ⇒ **整批跳过、零 provider 调用**，
 * 而清单声称的是新分镜 ⇒ **完全静默的假成功**（已实跑复现）。
 *
 * `runSeq >= 2` 时目录带上轮次号 ⇒ 新旧轮次物理隔离。
 * `runSeq === 1` 沿用历史布局 ⇒ **存量项目零影响**（不换目录、不丢已生成产物）。
 *
 * 注意：这里带的是**轮次**，不是分镜集指纹。自动模式的 `project.shots` 是**活状态**
 * （`updateShot` 可改提示词/参考图/时长），若按分镜集派生目录，用户改一个字就会
 * 整批产物作废——那才是真正的破坏。轮次只在新 plan 时变，编辑不动它。
 */
function autoRunIdFor (taskId, batchIndex, runSeq) {
  const seq = Number.isInteger(runSeq) && runSeq > 0 ? runSeq : 1
  const base = seq > 1
    ? 'auto/' + String(taskId) + '/r' + seq
    : 'auto/' + String(taskId)
  return base + '/b' + String(batchIndex)
}

/** 全局镜序号 → 所属批与批内序号（文件名 shot_NNN 用的是**批内**序号） */
function locateShot (shotIndex, batchSize = PRODUCTION_BATCH_SIZE) {
  const size = Number.isInteger(batchSize) && batchSize > 0 ? batchSize : PRODUCTION_BATCH_SIZE
  const g = Number.isInteger(shotIndex) && shotIndex >= 0 ? shotIndex : 0
  return { batchIndex: Math.floor(g / size), inBatchIndex: g % size }
}

function shotFileName (index) {
  return 'shot_' + String(index).padStart(3, '0') + '.mp4'
}

/** 项目文件 → provider 参考输入映射（Map<shotId, paths[]>） */
function buildRefMap (project) {
  const map = new Map()
  const shots = project && Array.isArray(project.shots) ? project.shots : []
  for (const s of shots) {
    const paths = Array.isArray(s.refPaths) ? s.refPaths.filter((p) => typeof p === 'string' && p.trim()) : []
    if (paths.length > 0) map.set(String(s.shotId), paths)
  }
  return map
}

/**
 * 批后以**磁盘为真**同步项目文件的逐镜状态（不信自报）。
 * 文件存在 → done + outputPath；缺失 → failed（保留已记录的原因）。
 */
function syncProjectFromDisk ({ project, batch, runDirOf = getFilmRunDir }) {
  if (!project || !Array.isArray(project.shots) || !batch) return project
  const runDir = runDirOf(batch.runId)
  const byId = new Map(project.shots.map((s) => [String(s.shotId), s]))
  ;(batch.shotIds || []).forEach((shotId, i) => {
    const shot = byId.get(String(shotId))
    if (!shot) return
    const file = path.join(runDir, shotFileName(i))
    if (fs.existsSync(file)) {
      shot.status = 'done'
      shot.outputPath = file
      shot.error = null
    } else {
      shot.status = 'failed'
      shot.error = shot.error || '磁盘缺少该镜产物'
    }
  })
  return project
}

/** 参考降级警告并入项目文件（去重，不重复堆叠） */
function mergeWarnings (project, warnings) {
  if (!project || !Array.isArray(warnings) || warnings.length === 0) return project
  if (!Array.isArray(project.warnings)) project.warnings = []
  const seen = new Set(project.warnings.map((w) => JSON.stringify(w)))
  for (const w of warnings) {
    const key = JSON.stringify(w)
    if (seen.has(key)) continue
    project.warnings.push(w)
    seen.add(key)
  }
  return project
}

/**
 * 执行单批（提示词取自 project.json；逐镜并发 2，与全量出片同口径）
 * @returns {Promise<{refWarnings: Array<object>}>}
 */
async function runAutoBatch (opts) {
  const o = opts || {}
  const { batch, project, aiGenerator, log } = o
  const deps = o.deps || {}
  const onShotProgress = typeof o.onShotProgress === 'function' ? o.onShotProgress : () => {}
  const onDispatched = typeof o.onDispatched === 'function' ? o.onDispatched : null
  const persist = typeof o.persist === 'function' ? o.persist : null
  const runDirOf = deps._testRunDir || getFilmRunDir
  if (!batch || !project) throw new Error('auto-runner: 需要 batch 与 project')

  const providerCfg = resolveFilmVideoProvider(aiGenerator)
  if (!providerCfg) {
    throw new Error('VIDEO_MODEL_NOT_CONFIGURED: 自动模式出片需要视频模型，请在模型设置中配置并设为默认视频 Provider 后重试')
  }
  const runDir = runDirOf(batch.runId)
  try { fs.mkdirSync(runDir, { recursive: true }) } catch { /* 目录已存在 */ }

  const gen = deps._testGenerateShotVideo || generateShotVideo
  const refMap = buildRefMap(project)
  const refWarnings = []
  const byId = new Map((project.shots || []).map((s) => [String(s.shotId), s]))
  const queue = (batch.shotIds || []).map((shotId, i) => ({ shotId: String(shotId), i }))
  const providerId = providerCfg.providerId
  const onProviderStatus = typeof o.onProviderStatus === 'function' ? o.onProviderStatus : () => {}
  const sleepFn = deps._testSleep || ((ms) => new Promise((resolve) => setTimeout(resolve, ms)))
  // 单批内**只等一次**排空：等完仍饱和 ⇒ 余下各镜直接判「未提交」，
  // 而不是每镜再等 5 分钟（12 镜 × 5 分钟 = 1 小时挂起，用户看不到任何进展）。
  let saturationWaited = false

  const report = (i, status, reason, errorCode) => {
    const shot = byId.get(String((batch.shotIds || [])[i]))
    if (shot) {
      shot.status = status === 'done' ? 'done' : 'failed'
      shot.error = status === 'done' ? null : (reason ? String(reason).slice(0, 500) : shot.error)
      // ⚠ 机器可读原因码：前端据此出**成对提示文字**（zh/en），
      //    而不是把后端中文字串直接渲染（那会让英文用户看到中文）。
      if (status === 'done') shot.errorCode = null
      else if (errorCode) shot.errorCode = errorCode
    }
    onShotProgress(i, status, reason)
  }

  /**
   * 熔断闸：provider 饱和时**停止派发**，按「预计排空时间」等待。
   * @returns {boolean} true = 可以派发；false = 本镜不提交（provider 仍饱和）
   */
  const gateOnProvider = async () => {
    const sat = readSaturation(providerId)
    if (!sat.saturated) {
      onProviderStatus({ state: 'normal', pending: 0, estimatedRecoveryMinutes: 0 })
      return true
    }
    // ⭐ 等待时长必须**至少覆盖「过期阈值」**：
    //   熔断期间不派发 ⇒ 观测窗口不会新增记录 ⇒ 唯一的「恢复信号」是
    //   **时间流逝让滞留请求过期**（服务端会自己把它们做完）。
    //   ⇒ 若只等 `estimatedDrainMs`（可能只有 15s）而滞留还没过期 ⇒ 等完必然「仍饱和」
    //   ⇒ 等待纯空转、剩余镜头全灭（2026-10-25 独立复核抓到的阻断缺陷）。
    const waitMs = Math.min(
      MAX_IN_RUN_DRAIN_WAIT_MS,
      Math.max(0, sat.estimatedDrainMs, Number(sat.expiryMs) || 0)
    )
    if (!saturationWaited) {
      saturationWaited = true
      onProviderStatus({
        state: 'tripped',
        pending: sat.pendingEstimate,
        estimatedRecoveryMinutes: sat.estimatedRecoveryMinutes,
        waitMs,
      })
      if (waitMs > 0) await sleepFn(waitMs)
    }
    const after = readSaturation(providerId)
    if (after.saturated) {
      onProviderStatus({
        state: 'saturated',
        pending: after.pendingEstimate,
        estimatedRecoveryMinutes: after.estimatedRecoveryMinutes,
        waitMs: 0,
      })
      return false
    }
    onProviderStatus({ state: 'normal', pending: 0, estimatedRecoveryMinutes: 0 })
    return true
  }

  const worker = async () => {
    while (queue.length > 0) {
      const job = queue.shift()
      if (!job) return
      const shot = byId.get(job.shotId)
      if (!shot || typeof shot.prompt !== 'string' || !shot.prompt.trim()) {
        if (log && typeof log.warn === 'function') log.warn('FilmAuto', 'shot ' + job.i + ' (' + job.shotId + ') failed: 提示词为空')
        report(job.i, 'failed', '未取到分镜提示词（项目文件中为空或分镜不存在）')
        continue
      }
      // ★ 熔断闸：饱和 ⇒ 停止派发（等待 / 判未提交），**不重投同一请求**
      if (!(await gateOnProvider())) {
        report(job.i, 'failed', '服务商繁忙，本镜未提交（恢复后可单独重生成）', 'AUTO_PROVIDER_BUSY')
        continue
      }
      // D30：派发前计数（观测计数器；崩溃窗口差值由 auto-status 如实暴露）
      if (onDispatched) { try { onDispatched(shot) } catch { /* 计数失败不影响出片 */ } }
      const r = await gen({
        shot,
        index: job.i,
        runDir,
        aspect: project.aspect,
        // ★ M0′.3：出片**消费逐镜镜长**（吸附到可选档位），而不是用户选的整档
        //   ⇒ 台词短的镜不会被撑长；回落链见 shot-effective-seconds.js（存量行为不变）。
        seconds: resolveShotSeconds(shot, project.seconds),
        providerCfg,
        refMap,
        mediaRoot: project.mediaRoot,
        refWarnings,
        sleep: deps._testSleep,
        download: deps._testDownload,
        log,
      })
      if (r && r.success) report(job.i, 'done')
      else report(job.i, 'failed', (r && r.error) ? r.error : '视频生成失败（未知原因）')
    }
  }

  // ★ 视频 provider 有效并发 = 1（串行受理 ⇒ 并发只会让第二个请求在队列里等超时）
  const concurrency = Math.min(
    AUTO_VIDEO_EFFECTIVE_CONCURRENCY,
    PRODUCTION_BATCH_CONCURRENCY,
    (batch.shotIds || []).length
  )
  await Promise.all(Array.from({ length: concurrency }, worker))
  // 批后以磁盘为真同步 + 参考警告合并 + 持久化（崩溃窗口由台账/磁盘双核兜底）
  syncProjectFromDisk({ project, batch, runDirOf })
  mergeWarnings(project, refWarnings)
  if (persist) { try { persist(project) } catch { /* 持久化失败不改变批执行结果 */ } }
  return { refWarnings }
}

/**
 * 本轮**已落盘**的逐镜产物数（**磁盘为真**）。
 *
 * ## 为什么需要它（2026-10-25 实测）
 *
 * 逐镜状态是在**批次收口**时才回写台账的（`runAutoBatch` 的 `persist` 在批末）⇒
 * 批次执行期间 `project.shots[].status` **恒为 pending** ⇒
 * 面板的「已完成 N / M」在出片过程中**一直显示 0**（实测 12 镜时全程 0/12）⇒ 用户以为没在干活。
 *
 * ## 三条口径纪律（**别改错**）
 *
 * 1. ⚠️ **磁盘有片 ≠ 该镜成功** ⇒ 本函数**只能用于显示**，
 *    **绝不可**用于「是否收口」的判定（收口必须用台账口径：每镜都有 done/failed 结论）。
 * 2. ⚠️ **只数本轮目录**：`autoRunIdFor(taskId, batchIndex, runSeq)` 带轮次号
 *    （runSeq ≥ 2 ⇒ `auto/<taskId>/r<N>/b<M>`）⇒ 上一轮的残留片**不被算成**本轮已完成。
 * 3. ⚠️ **同批目录复用**：重跑同一批时目录沿用（既有语义）⇒ 残留片仍会被计入
 *    ⇒ 与既有 `syncProjectFromDisk`（同样以磁盘为真）**同源**⇒ 口径一致，不新增第二种真相。
 *
 * @param {object} project 项目文件内容（需 taskId / runSeq / shots）
 * @param {{_testRunDir?:Function, batchSize?:number}} [opts]
 * @returns {number} 已落盘的逐镜产物数
 */
function countShotsOnDisk (project, opts) {
  const o = opts || {}
  const shots = Array.isArray(project && project.shots) ? project.shots : []
  if (shots.length === 0) return 0
  const runDirOf = o._testRunDir || getFilmRunDir
  const batchSize = Number.isInteger(o.batchSize) && o.batchSize > 0 ? o.batchSize : PRODUCTION_BATCH_SIZE
  const runSeq = Number.isInteger(project && project.runSeq) && project.runSeq > 0 ? project.runSeq : 1
  const taskId = String((project && project.taskId) || '')
  if (!taskId) return 0
  let n = 0
  for (let i = 0; i < shots.length; i++) {
    const loc = locateShot(i, batchSize)
    const runId = autoRunIdFor(taskId, loc.batchIndex, runSeq)
    const file = path.join(runDirOf(runId), shotFileName(loc.inBatchIndex))
    try { if (fs.existsSync(file)) n++ } catch { /* 读不到就不计（不谎报进度） */ }
  }
  return n
}

/**
 * 单镜重生成（原子覆盖，D15）
 * 流程：临时目录生成 → ffprobe 校验 → rename 覆盖正式 shot_NNN.mp4
 * @returns {Promise<{ok: boolean, path?: string, errorCode?: string, message?: string}>}
 */
async function regenerateOneShot (opts) {
  const o = opts || {}
  const { project, shotIndex, aiGenerator, log } = o
  const deps = o.deps || {}
  if (!project || !Array.isArray(project.shots)) {
    return { ok: false, errorCode: 'AUTO_SHOT_INVALID', message: '项目文件非法' }
  }
  const idx = Number(shotIndex)
  if (!Number.isInteger(idx) || idx < 0 || idx >= project.shots.length) {
    return { ok: false, errorCode: 'AUTO_SHOT_INVALID', message: 'shotIndex 越界' }
  }
  const shot = project.shots[idx]
  if (typeof shot.prompt !== 'string' || !shot.prompt.trim()) {
    return { ok: false, errorCode: 'AUTO_SHOT_INVALID', message: '提示词为空，无法重生成' }
  }
  const providerCfg = resolveFilmVideoProvider(aiGenerator)
  if (!providerCfg) {
    return {
      ok: false,
      errorCode: 'VIDEO_MODEL_NOT_CONFIGURED',
      message: '自动模式重生成需要视频模型，请在模型设置中配置并设为默认视频 Provider 后重试',
    }
  }
  const runDirOf = deps._testRunDir || getFilmRunDir
  const tmpRootOf = deps._testTmpRoot || getFilmMediaRoot
  const probeFn = deps._testProbeClip || probeClip
  const gen = deps._testGenerateShotVideo || generateShotVideo
  const { batchIndex, inBatchIndex } = locateShot(idx, o.batchSize)
  const runId = autoRunIdFor(project.taskId, batchIndex, project.runSeq)
  const runDir = runDirOf(runId)
  const stageDir = path.join(tmpRootOf(), 'auto', String(project.taskId), '.regen')
  const dest = path.join(runDir, shotFileName(inBatchIndex))

  try { fs.mkdirSync(runDir, { recursive: true }) } catch { /* 已存在 */ }
  try { fs.mkdirSync(stageDir, { recursive: true }) } catch { /* 已存在 */ }

  const r = await gen({
    shot,
    index: inBatchIndex,
    runDir: stageDir,
    aspect: project.aspect,
    // ★ M0′.3：同上（单镜重生成走同一条镜长口径）
    seconds: resolveShotSeconds(shot, project.seconds),
    providerCfg,
    refMap: buildRefMap(project),
    mediaRoot: project.mediaRoot,
    refWarnings: [],
    sleep: deps._testSleep,
    download: deps._testDownload,
    log,
  })
  if (!r || !r.success) {
    return { ok: false, errorCode: 'AUTO_REGENERATE_FAILED', message: (r && r.error) || '视频生成失败' }
  }
  const staged = path.join(stageDir, shotFileName(inBatchIndex))
  try {
    await probeFn(staged)
  } catch (e) {
    return { ok: false, errorCode: 'AUTO_REGENERATE_INVALID_CLIP', message: '生成的片段未通过校验：' + ((e && e.message) || String(e)) }
  }
  try {
    fs.renameSync(staged, dest)
  } catch (e) {
    return { ok: false, errorCode: 'AUTO_REGENERATE_FAILED', message: '覆盖正式产物失败：' + ((e && e.message) || String(e)) }
  }
  shot.status = 'done'
  shot.outputPath = dest
  shot.error = null
  return { ok: true, path: dest }
}

/** 全部镜是否磁盘齐备（收口合成前置；由 IPC 用注入 probe 复核） */
function collectMissingShots ({ project, probe, batchSize = PRODUCTION_BATCH_SIZE, runIdFor = autoRunIdFor }) {
  const missing = []
  const shots = project && Array.isArray(project.shots) ? project.shots : []
  const byBatch = new Map()
  shots.forEach((s, idx) => {
    const { batchIndex, inBatchIndex } = locateShot(idx, batchSize)
    if (!byBatch.has(batchIndex)) byBatch.set(batchIndex, { count: 0, items: [] })
    const entry = byBatch.get(batchIndex)
    entry.count += 1
    entry.items.push({ shotId: String(s.shotId), inBatchIndex })
  })
  for (const [batchIndex, entry] of byBatch.entries()) {
    const probeResult = probe(runIdFor(project.taskId, batchIndex, project.runSeq), entry.count) || { missing: [] }
    const miss = Array.isArray(probeResult.missing) ? probeResult.missing : []
    for (const mi of miss) {
      const item = entry.items.find((x) => x.inBatchIndex === mi)
      missing.push({ batchIndex, shotIndex: mi, shotId: item ? item.shotId : null })
    }
  }
  return missing
}

module.exports = {
  autoRunIdFor,
  locateShot,
  shotFileName,
  buildRefMap,
  syncProjectFromDisk,
  mergeWarnings,
  runAutoBatch,
  regenerateOneShot,
  collectMissingShots,
  countShotsOnDisk,
  AUTO_BATCH_CONCURRENCY: PRODUCTION_BATCH_CONCURRENCY,
}
