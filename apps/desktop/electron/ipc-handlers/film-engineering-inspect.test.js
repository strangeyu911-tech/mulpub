// @ts-check
'use strict'
/**
 * film-engineering-inspect IPC 契约测试（资产体检 · 只读）
 *
 * 覆盖：
 *   - sender 授权硬断言：外部网页 / 子框架 / 协议不对 / 路由不匹配 ⇒ 一律拒绝；
 *   - **入参为空**：renderer 传任何参数都不改变行为（路径只能来自原生对话框）；
 *   - 取消 ⇒ cancelled（**不算失败**）；
 *   - UNC / 非目录 ⇒ NOT_A_DIRECTORY；
 *   - 成功 ⇒ code 0 + 报告字段齐备；
 *   - ⛔ **不写审计**：体检不得在 userData 下留下 film-kit-import.log（只读铁律的 IPC 侧断言）。
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'
import nodeFs from 'node:fs'
import nodeOs from 'node:os'
import nodePath from 'node:path'

__enableElectronMock()

let registerInspectHandlers

beforeEach(async () => {
  vi.resetModules()
  const mod = await import('./film-engineering-inspect')
  registerInspectHandlers = mod.registerInspectHandlers
})

function createMockIpcMain () {
  const handlers = {}
  return {
    handle: vi.fn((channel, fn) => { handlers[channel] = fn }),
    _get: (channel) => handlers[channel],
  }
}

function trustedEvent (url) {
  return {
    senderFrame: { url: url || 'http://localhost:5174/#/film-engineering' },
    sender: { send: vi.fn() },
  }
}

function tmpDir (tag) {
  return nodeFs.mkdtempSync(nodePath.join(nodeOs.tmpdir(), 'kit-inspect-ipc-' + tag + '-'))
}

const SAMPLE_REPORT = {
  importable: true,
  blockingReason: null,
  blockingMessage: null,
  counts: {
    scenes: 2, shots: 1, shotsWithResult: 0,
    references: 1, referencesResolvable: 1,
    templateTasks: 1, templateFiles: 4, fileCount: 9, totalBytes: 1024,
  },
  langs: ['en', 'zh'],
  requiredMissing: [],
  ignoredTopLevel: [],
  warnings: [],
  assetWarningTexts: [],
}

function makeDeps (overrides) {
  return Object.assign({
    log: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
    dialog: { showOpenDialog: vi.fn(async () => ({ canceled: false, filePaths: [tmpDir('src')] })) },
    _testInspectKit: vi.fn(async () => ({ ok: true, data: SAMPLE_REPORT })),
  }, overrides || {})
}

describe('film-engineering:inspect-kit · sender 授权（硬）', () => {
  it('外部网页 ⇒ 来源门禁先拦（-3），且不弹对话框', async () => {
    const deps = makeDeps()
    const ipcMain = createMockIpcMain()
    registerInspectHandlers(ipcMain, deps)
    const r = await ipcMain._get('film-engineering:inspect-kit')(
      { senderFrame: { url: 'https://evil.example/#/film-engineering' } },
    )
    expect(r.code).toBe(-3)
    expect(deps.dialog.showOpenDialog).not.toHaveBeenCalled()
  })

  it('子框架 ⇒ UNAUTHORIZED_SENDER', async () => {
    const deps = makeDeps()
    const ipcMain = createMockIpcMain()
    registerInspectHandlers(ipcMain, deps)
    const r = await ipcMain._get('film-engineering:inspect-kit')({
      senderFrame: { url: 'http://localhost:5174/#/film-engineering', parent: {} },
    })
    expect(r.errorCode).toBe('UNAUTHORIZED_SENDER')
    expect(deps.dialog.showOpenDialog).not.toHaveBeenCalled()
  })

  it('路由不匹配 ⇒ UNAUTHORIZED_SENDER', async () => {
    const deps = makeDeps()
    const ipcMain = createMockIpcMain()
    registerInspectHandlers(ipcMain, deps)
    const r = await ipcMain._get('film-engineering:inspect-kit')(trustedEvent('http://localhost:5174/#/publish'))
    expect(r.errorCode).toBe('UNAUTHORIZED_SENDER')
  })
})

describe('film-engineering:inspect-kit · 早退信封', () => {
  it('取消 ⇒ code 0 + cancelled（不算失败）', async () => {
    const deps = makeDeps({ dialog: { showOpenDialog: vi.fn(async () => ({ canceled: true, filePaths: [] })) } })
    const ipcMain = createMockIpcMain()
    registerInspectHandlers(ipcMain, deps)
    const r = await ipcMain._get('film-engineering:inspect-kit')(trustedEvent())
    expect(r.code).toBe(0)
    expect(r.data.cancelled).toBe(true)
    expect(deps._testInspectKit).not.toHaveBeenCalled()
  })

  it('UNC 路径 ⇒ NOT_A_DIRECTORY', async () => {
    const deps = makeDeps({ dialog: { showOpenDialog: vi.fn(async () => ({ canceled: false, filePaths: ['\\\\server\\share\\kit'] })) } })
    const ipcMain = createMockIpcMain()
    registerInspectHandlers(ipcMain, deps)
    const r = await ipcMain._get('film-engineering:inspect-kit')(trustedEvent())
    expect(r.errorCode).toBe('NOT_A_DIRECTORY')
  })

  it('所选是文件 ⇒ NOT_A_DIRECTORY', async () => {
    const file = nodePath.join(tmpDir('f'), 'a.txt')
    nodeFs.writeFileSync(file, 'x')
    const deps = makeDeps({ dialog: { showOpenDialog: vi.fn(async () => ({ canceled: false, filePaths: [file] })) } })
    const ipcMain = createMockIpcMain()
    registerInspectHandlers(ipcMain, deps)
    const r = await ipcMain._get('film-engineering:inspect-kit')(trustedEvent())
    expect(r.errorCode).toBe('NOT_A_DIRECTORY')
  })

  it('对话框不可用 ⇒ DIALOG_UNAVAILABLE', async () => {
    const deps = makeDeps({ dialog: {} })
    const ipcMain = createMockIpcMain()
    registerInspectHandlers(ipcMain, deps)
    const r = await ipcMain._get('film-engineering:inspect-kit')(trustedEvent())
    expect(r.errorCode).toBe('DIALOG_UNAVAILABLE')
  })
})

describe('film-engineering:inspect-kit · 成功与入参为空', () => {
  it('成功 ⇒ code 0 + 报告字段齐备（含 sourceDir 供显示）', async () => {
    const deps = makeDeps()
    const ipcMain = createMockIpcMain()
    registerInspectHandlers(ipcMain, deps)
    const r = await ipcMain._get('film-engineering:inspect-kit')(trustedEvent())
    expect(r.code).toBe(0)
    expect(r.data.importable).toBe(true)
    expect(r.data.counts.shots).toBe(1)
    expect(r.data.langs).toEqual(['en', 'zh'])
    expect(typeof r.data.sourceDir).toBe('string')
  })

  it('renderer 传参不改变行为（路径只来自对话框）', async () => {
    const deps = makeDeps()
    const ipcMain = createMockIpcMain()
    registerInspectHandlers(ipcMain, deps)
    const evil = { kitDir: 'D:/evil/kit', userDataDir: 'D:/evil' }
    const r = await ipcMain._get('film-engineering:inspect-kit')(trustedEvent(), evil)
    expect(r.code).toBe(0)
    const arg = deps._testInspectKit.mock.calls[0][0]
    expect(arg.kitDir).not.toBe('D:/evil/kit')
    // 入参面 = 路径（来自原生对话框）+ 当前资产计数（来自主进程 service），**没有一项**来自 renderer
    expect(Object.keys(arg).sort()).toEqual(['currentCounts', 'kitDir'])
    // 该用例没注入 service ⇒ currentCounts 降级为 null（拿不准就不猜，报告里 compare 也会是 null）
    expect(arg.currentCounts).toBe(null)
  })

  it('体检失败（ok:false）⇒ 失败信封带 reason 闭集值 + 人话', async () => {
    const deps = makeDeps({
      _testInspectKit: vi.fn(async () => ({ ok: false, reason: 'NOT_A_DIRECTORY', message: '源目录不可读: boom' })),
    })
    const ipcMain = createMockIpcMain()
    registerInspectHandlers(ipcMain, deps)
    const r = await ipcMain._get('film-engineering:inspect-kit')(trustedEvent())
    expect(r.code).not.toBe(0)
    expect(r.errorCode).toBe('NOT_A_DIRECTORY')
    expect(r.message).toContain('boom')
  })
})

describe('⛔ film-engineering:inspect-kit · 不写审计（只读铁律 IPC 侧）', () => {
  it('体检成功后 userData 下不得出现 film-kit-import.log', async () => {
    const userDataDir = tmpDir('ud')
    const deps = makeDeps({
      filmEngineeringService: { userDataDir, invalidateKitCache: vi.fn(), setImportInProgress: vi.fn() },
    })
    const ipcMain = createMockIpcMain()
    registerInspectHandlers(ipcMain, deps)
    const r = await ipcMain._get('film-engineering:inspect-kit')(trustedEvent())
    expect(r.code).toBe(0)
    expect(nodeFs.existsSync(nodePath.join(userDataDir, 'film-kit-import.log'))).toBe(false)
    // 也不得建锁
    expect(nodeFs.existsSync(nodePath.join(userDataDir, '.import-lock'))).toBe(false)
  })
})
