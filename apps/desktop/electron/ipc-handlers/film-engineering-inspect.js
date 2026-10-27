// @ts-check
'use strict'
/**
 * film-engineering-inspect — 影视工程「资产体检」IPC 通道（**只读**）
 *
 * 通道：`film-engineering:inspect-kit` → 读用户选定目录，产出「导入后会得到什么」的报告。
 *
 * 与 `film-engineering:import-kit` 的关系（change `kit-asset-health-report` 决策 D3）：
 *   - 本通道**只读**：不建锁、不写审计、不写任何文件；
 *   - 它是导入的**前置预览**：前端先 inspect → 展示报告 → 用户确认 → 才调 importKit。
 *
 * 关键合同（与写路径同口径，除审计外）：
 *   - **入参为空** ⇒ 路径**只能**来自 handler 内部的原生对话框（renderer 无法指定被读目录）；
 *   - **sender 授权断言（硬）**：只允许主框架 + 协议白名单 + hash 路由前缀 `/film-engineering`；
 *   - **UNC / 非目录**在 handler 层就拒；
 *   - 取消 ⇒ `{ code: 0, data: { cancelled: true, reason: 'CANCELLED' } }`（取消**不算失败**）。
 *
 * ⚠ 本文件**不写审计**：审计契约（`SCHEMA.md` §11.5）写明「审计 = 每次**替换**的痕迹」。
 *   把只读体检也写进去会稀释「每次替换都有痕」这个读数的含义。
 */

const fs = require('fs')

const EC = require('../core/error-codes').ERROR
const { withSenderCheck } = require('./helpers')
const { inspectKit, INSPECT_REASON } = require('../services/film-engineering/kit-inspect')
const { authorizeSender } = require('./film-engineering-import')

/** reason → 粗粒度错误码（细粒度在 errorCode 里，渲染端据此本地化） */
const CODE_BY_REASON = Object.freeze({
  NOT_A_DIRECTORY: EC.VALIDATION_ERROR,
  VALIDATION_ERROR: EC.VALIDATION_ERROR,
})

/**
 * 取「当前资产」的计数，供体检报告算 delta（P2）。
 *
 * ⚠ **拿不准就返回 null**，绝不猜：
 *   - `ShotLibrary.listAllShots` 有 `MAX_PAGE_LIMIT(200)` 兜底与 `FULL_LOAD_LIMIT(500)` 硬上限；
 *   - 命中 500 ⇒ 可能被截断 ⇒ 若拿它当"当前分镜数"，delta 会凭空变成负数（假差异比没有更坏）。
 * 只要任一维拿不到**准确**值，整格降级为 null ⇒ 报告 `compare: null`。
 * @param {object|null} service
 * @returns {{scenes:number, shots:number, templates:number}|null}
 */
function currentCountsOf (service) {
  if (!service || typeof service.listTemplateShots !== 'function') return null
  try {
    const scenes = typeof service.listScenes === 'function' ? service.listScenes() : null
    const shots = service.listTemplateShots(500)
    const ctx = typeof service.getKitContext === 'function' ? service.getKitContext() : null
    if (!Array.isArray(scenes) || !Array.isArray(shots)) return null
    if (shots.length >= 500) return null
    const tasks = ctx && ctx.promptLibrary && ctx.promptLibrary.tasks
      ? Object.keys(ctx.promptLibrary.tasks).length
      : null
    if (!Number.isInteger(tasks)) return null
    return { scenes: scenes.length, shots: shots.length, templates: tasks }
  } catch (_e) {
    return null
  }
}

/**
 * 注册体检通道。
 * @param {import('electron').IpcMain} ipcMain
 * @param {object} deps
 */
function registerInspectHandlers (ipcMain, deps) {
  const o = deps || {}
  const log = o.log || { info () {}, warn () {}, error () {} }
  const dialog = o.dialog
  const inspectFn = o._testInspectKit || inspectKit
  const service = o.filmEngineeringService || null

  ipcMain.handle('film-engineering:inspect-kit', withSenderCheck(async (event) => {
    // ── ① sender 授权断言（硬；与写路径同一实现，不复制判据）──────────
    const auth = authorizeSender(event)
    if (!auth.ok) {
      log.warn('[film-engineering:inspect-kit] 未授权来源:', auth.message)
      return { code: EC.AUTH_ERROR, errorCode: 'UNAUTHORIZED_SENDER', message: auth.message }
    }

    // ── ② 原生对话框（**入参为空** ⇒ 路径只能由用户选）────────────────
    const dialogApi = dialog || (() => {
      try { return require('electron').dialog } catch (_e) { return null }
    })()
    if (!dialogApi || typeof dialogApi.showOpenDialog !== 'function') {
      return { code: EC.REQUEST_ERROR, errorCode: 'DIALOG_UNAVAILABLE', message: '目录选择对话框不可用' }
    }
    let picked
    try {
      picked = await dialogApi.showOpenDialog({
        title: '选择影视工程资产目录',
        properties: ['openDirectory'],
      })
    } catch (e) {
      return { code: EC.REQUEST_ERROR, errorCode: 'DIALOG_FAILED', message: String(e && e.message) }
    }
    if (!picked || picked.canceled === true || !picked.filePaths || picked.filePaths.length === 0) {
      return { code: 0, data: { cancelled: true, reason: 'CANCELLED' } }
    }

    // ── ③ handler 层也拒：UNC / 非目录（与写路径同口径）───────────────
    const kitDir = picked.filePaths[0]
    if (!kitDir || String(kitDir).startsWith('\\\\')) {
      return { code: EC.VALIDATION_ERROR, errorCode: 'NOT_A_DIRECTORY', message: '不支持网络路径（UNC）' }
    }
    try {
      if (!fs.statSync(kitDir).isDirectory()) {
        return { code: EC.VALIDATION_ERROR, errorCode: 'NOT_A_DIRECTORY', message: '所选路径不是目录' }
      }
    } catch (_e) {
      return { code: EC.VALIDATION_ERROR, errorCode: 'NOT_A_DIRECTORY', message: '所选路径不可读' }
    }

    // ── ④ 只读体检 ────────────────────────────────────────────────
    // ⚠ currentCounts 由**主进程**取（渲染端不得传）：它决定"换上去会少什么"这段的读数，
    //   让 renderer 提供等于让它伪造对比结果。
    const res = await inspectFn({ kitDir, currentCounts: currentCountsOf(service) })
    if (!res || !res.ok) {
      const reason = (res && res.reason) || INSPECT_REASON.VALIDATION_ERROR
      return {
        code: CODE_BY_REASON[reason] || EC.VALIDATION_ERROR,
        errorCode: reason,
        message: (res && res.message) || '资产体检失败',
      }
    }
    // ⚠ `sourceDir` 回传是为了让用户在报告里确认「我选的是这个目录」；
    //   它**只用于显示**，不参与任何后续写路径的路径决策（写路径仍由 importKit 自己重新选）。
    return { code: 0, data: Object.assign({ sourceDir: kitDir }, res.data) }
  }))
}

// ⚠ 导出形态**必须与同族一致**（`film-engineering.js` / `film-engineering-import.js` 都是
//   「模块本身可调用 + 附带具名导出」）：`ipc-handlers/index.js` 是
//   `require('./film-engineering-inspect')(ipcMain, deps)` ⇒ 只导出对象会让整条 IPC 注册面
//   在装配时抛 `TypeError: require(...) is not a function`（PR-3b 踩过，17 条装配锁全红）。
module.exports = registerInspectHandlers
module.exports.registerInspectHandlers = registerInspectHandlers
module.exports.CODE_BY_REASON = CODE_BY_REASON
module.exports.currentCountsOf = currentCountsOf
