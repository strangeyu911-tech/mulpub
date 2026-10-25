// 流水线「配置档案」域 composable（CreateView 拆分第一刀，ConfigProfile 域）。
//
// 形态约束（仓内定案 FRONTEND-FILE-SPLIT-PLAN-2026-10 §2.3 / §3.2）：
// - **实例级**：`useConfigProfiles(deps)` 每次调用返回独立对象，deps 由闭包捕获；
//   不使用仓内既有三批 composable 的模块级单例形态（那会把「组件卸载」与「状态生命周期」解耦），
//   也不引入 `window.__*` 全局兜底（属遗留形态，新代码不得引入）。
// - **状态留壳**：18 个配置档案状态键全部留在 CreateView 的 `data()`（`data.size` 不变），
//   本文件只经 `deps.get` / `deps.set` 读写**同一个响应式对象**（禁止 spread 副本）。
//   由此天然满足定案 §2.3 的两条桥接契约：
//   ① 整体赋值 `vm.s2vConfigProfiles = [...]` 经 set 整体替换；
//   ② 原地变异 `vm.s2vConfigProfiles.push(x)` 经 get 拿到的正是响应式代理本身（非副本）。
// - **零中文字面量**：所有面向用户文案由 `deps.messages.*` 惰性提供（壳侧持有 zh/en 三元组），
//   本文件只引用 locale key，避免渲染端硬编码中文基线出现新增命中。
//
// 搬移纪律：行为逐字保持（含判定顺序、提示时长、并发守卫的 3 处 requestId 判定）。

import {
  story2videoConfigProfileList,
  story2videoConfigProfileCreate,
  story2videoConfigProfileRename,
  story2videoConfigProfileDelete,
} from '@/api/publisher'
import { normalizeResolution } from '@/story2video/output-resolution'
import {
  STYLES,
  pickS2VConfigProfileFields,
  pickS2VOutputProfileFields,
} from '../create-view-module-utils'

/** 壳 `data()` 中由本域独占的状态键（其余为流水线共享状态，跨域不动）。 */
const PROFILE_KEYS = {
  list: 's2vConfigProfiles',
  loading: 's2vConfigProfilesLoading',
  error: 's2vConfigProfileError',
  saveDialogOpen: 's2vConfigProfileDialogOpen',
  nameDraft: 's2vConfigProfileNameDraft',
  overwriteNeeded: 's2vConfigProfileOverwriteNeeded',
  listOpen: 's2vConfigProfileListOpen',
  renamingId: 's2vConfigProfileRenamingId',
  renameDraft: 's2vConfigProfileRenameDraft',
  applyDialogOpen: 's2vConfigProfileApplyDialogOpen',
  applyTarget: 's2vConfigProfileApplyTarget',
  applyPipelineId: 's2vConfigProfileApplyPipelineId',
  deleteDialogOpen: 's2vConfigProfileDeleteDialogOpen',
  deleteTarget: 's2vConfigProfileDeleteTarget',
  requestId: 's2vConfigProfileListRequestId',
}

/** 整对象快照恢复时允许的枚举白名单（与既有实现逐字一致）。 */
const LEGACY_INPUT_MODES = ['text', 'images', 'audio', 'video']
const CHECKPOINT_POLICIES = ['guided', 'manual_all', 'auto_noncreative']
const STORYBOARD_MODES = ['auto', 'creative', 'fidelity', 'hybrid']
const BUDGET_MODES = ['observe', 'warn', 'cap']
const OUTPUT_FPS = [24, 30, 60]
const OUTPUT_FORMATS = ['mp4', 'webm']

/**
 * 创建配置档案域的实例。
 *
 * @param {object} deps 显式依赖（全部为函数，惰性求值 ⇒ 语言切换后文案仍跟随）
 * @param {(key: string) => any} deps.get 读壳状态（返回响应式代理本身）
 * @param {(key: string, value: any) => void} deps.set 写壳状态（整体替换）
 * @param {() => object} deps.getDefaults 返回 `data()` 的默认值对象（壳侧从 `$options.data` 取）
 * @param {(message: string, ms: number) => void} deps.toast 轻提示
 * @param {(key: string) => string} deps.pipelineName 流水线显示名
 * @param {(name: string) => boolean} deps.isOrchestratedPipeline 是否编排型流水线
 * @param {(value: any) => any} deps.cloneForIpc 深拷贝（供 IPC 传输）
 * @param {(snapshot: object) => Promise<boolean>} deps.applySnapshotObject 编排型快照整对象恢复
 * @param {Record<string, () => string>} deps.messages 面向用户的文案（惰性，壳侧持有 zh/en）
 * @returns {object} 本域的方法集合（供壳侧同名代理转发）
 */
export function useConfigProfiles(deps) {
  const { get, set, getDefaults, toast, pipelineName, isOrchestratedPipeline, cloneForIpc, applySnapshotObject, messages } = deps

  const getProfileDefaults = () => {
    const defaults = getDefaults() || {}
    return {
      s2vConfig: defaults.s2vConfig || {},
      s2vOutputConfig: defaults.s2vOutputConfig || {},
      legacy: {
        // 注：inputMode 的默认值是硬编码 'text'（不是 data 里的 inputMode 默认值）——既有行为，逐字保持。
        inputMode: 'text',
        selectedStyle: defaults.selectedStyle,
        llmConfig: defaults.llmConfig || {},
        budgetConfig: defaults.budgetConfig || {},
        checkpointPolicy: defaults.checkpointPolicy,
        storyboardMode: defaults.storyboardMode,
        outputConfig: defaults.outputConfig || {},
      },
    }
  }

  const buildPipelineConfigSnapshot = () => {
    const now = new Date().toISOString()
    if (isOrchestratedPipeline(get('selectedPipeline')?.name)) {
      return {
        schemaVersion: 1,
        capturedAt: now,
        kind: 'orchestrated',
        s2vConfig: pickS2VConfigProfileFields(get('s2vConfig')),
        s2vOutputConfig: pickS2VOutputProfileFields(get('s2vOutputConfig')),
        ui: { expandedGroups: Object.keys(get('s2vOpenSections') || {}).filter(key => get('s2vOpenSections')[key] === true) },
      }
    }
    return {
      schemaVersion: 1,
      capturedAt: now,
      kind: 'legacy',
      legacy: {
        inputMode: get('inputMode'),
        selectedStyle: get('selectedStyle'),
        llmConfig: cloneForIpc(get('llmConfig')),
        budgetConfig: cloneForIpc(get('budgetConfig')),
        checkpointPolicy: get('checkpointPolicy'),
        storyboardMode: get('storyboardMode'),
        outputConfig: cloneForIpc(get('outputConfig')),
      },
    }
  }

  const s2vConfigProfileFormDirty = () => {
    const defaults = getProfileDefaults()
    if (isOrchestratedPipeline(get('selectedPipeline')?.name)) {
      return JSON.stringify(get('s2vConfig')) !== JSON.stringify(defaults.s2vConfig) ||
        JSON.stringify(get('s2vOutputConfig')) !== JSON.stringify(defaults.s2vOutputConfig)
    }
    const legacy = defaults.legacy
    return get('inputMode') !== legacy.inputMode ||
      get('selectedStyle') !== legacy.selectedStyle ||
      JSON.stringify(get('llmConfig')) !== JSON.stringify(legacy.llmConfig) ||
      JSON.stringify(get('budgetConfig')) !== JSON.stringify(legacy.budgetConfig) ||
      get('checkpointPolicy') !== legacy.checkpointPolicy ||
      get('storyboardMode') !== legacy.storyboardMode ||
      JSON.stringify(get('outputConfig')) !== JSON.stringify(legacy.outputConfig)
  }

  const loadS2VConfigProfiles = async ({ quiet = false } = {}) => {
    const requestId = (get(PROFILE_KEYS.requestId) || 0) + 1
    set(PROFILE_KEYS.requestId, requestId)
    set(PROFILE_KEYS.loading, true)
    set(PROFILE_KEYS.error, '')
    try {
      const result = await story2videoConfigProfileList()
      if (requestId !== get(PROFILE_KEYS.requestId)) return
      const data = result && result.code === 0 ? result.data : null
      if (!Array.isArray(data)) throw new Error(result?.message || messages.listLoadFailed())
      set(PROFILE_KEYS.list, Array.isArray(data)
        ? data.slice().sort((a, b) => Number(b.updatedAt) - Number(a.updatedAt))
        : data)
    } catch (error) {
      if (requestId !== get(PROFILE_KEYS.requestId)) return
      set(PROFILE_KEYS.error, error?.message || messages.listLoadFailed())
      if (!quiet) toast(get(PROFILE_KEYS.error), 2200)
    } finally {
      if (requestId === get(PROFILE_KEYS.requestId)) set(PROFILE_KEYS.loading, false)
    }
  }

  const openS2VConfigProfileSave = async () => {
    set(PROFILE_KEYS.overwriteNeeded, false)
    set(PROFILE_KEYS.error, '')
    await loadS2VConfigProfiles({ quiet: true })
    const selected = get('selectedPipeline')
    set(PROFILE_KEYS.nameDraft, selected?.name ? pipelineName(selected.name) : '')
    set(PROFILE_KEYS.saveDialogOpen, true)
  }

  const closeS2VConfigProfileSave = () => {
    set(PROFILE_KEYS.saveDialogOpen, false)
    set(PROFILE_KEYS.requestId, (get(PROFILE_KEYS.requestId) || 0) + 1)
    set(PROFILE_KEYS.loading, false)
    set(PROFILE_KEYS.nameDraft, '')
    set(PROFILE_KEYS.overwriteNeeded, false)
  }

  const saveS2VConfigProfile = async () => {
    const name = String(get(PROFILE_KEYS.nameDraft) || '').trim()
    if (!name) {
      toast(messages.nameRequired(), 2200)
      return
    }
    const pipelineId = get('selectedPipeline')?.name
    if (!pipelineId) return
    if (!get(PROFILE_KEYS.overwriteNeeded)) {
      const duplicate = (get(PROFILE_KEYS.list) || []).find(p => p.pipelineId === pipelineId && p.name === name)
      if (duplicate) {
        set(PROFILE_KEYS.overwriteNeeded, true)
        toast(messages.duplicateName(), 2200)
        return
      }
    }
    const snapshot = buildPipelineConfigSnapshot()
    try {
      const result = await story2videoConfigProfileCreate({
        pipelineId,
        name,
        snapshot: JSON.parse(JSON.stringify(snapshot)),
        overwrite: get(PROFILE_KEYS.overwriteNeeded),
      })
      if (!result || result.code !== 0) {
        const duplicate = result?.code === -2 && /同名|已经存在|already exists|duplicate/i.test(String(result?.message || ''))
        if (duplicate) {
          set(PROFILE_KEYS.overwriteNeeded, true)
          toast(messages.duplicateName(), 2200)
          return
        }
        toast(messages.saveFailed(), 2600)
        return
      }
      set(PROFILE_KEYS.list, (get(PROFILE_KEYS.list) || []).filter(p => !(p.pipelineId === pipelineId && p.name === name)))
      get(PROFILE_KEYS.list).push(result.data)
      closeS2VConfigProfileSave()
      toast(messages.saved())
    } catch (error) {
      toast(error?.message || messages.saveFailedRaw(), 2600)
    }
  }

  const openS2VConfigProfileList = async () => {
    set(PROFILE_KEYS.error, '')
    set(PROFILE_KEYS.listOpen, true)
    await loadS2VConfigProfiles({ quiet: true })
  }

  const closeS2VConfigProfileList = () => {
    set(PROFILE_KEYS.listOpen, false)
    set(PROFILE_KEYS.requestId, (get(PROFILE_KEYS.requestId) || 0) + 1)
    set(PROFILE_KEYS.loading, false)
    set(PROFILE_KEYS.renamingId, '')
  }

  const s2vConfigProfileCanApply = (profile) => {
    return Boolean(profile && get('selectedPipeline')?.name && profile.pipelineId === get('selectedPipeline').name)
  }

  const requestApplyS2VConfigProfile = async (profile) => {
    if (!s2vConfigProfileCanApply(profile)) {
      toast(messages.wrongPipeline(), 2600)
      return
    }
    if (!s2vConfigProfileFormDirty()) {
      await confirmApplyS2VConfigProfile(profile)
      return
    }
    set(PROFILE_KEYS.applyTarget, cloneForIpc(profile))
    set(PROFILE_KEYS.applyPipelineId, get('selectedPipeline')?.name || '')
    set(PROFILE_KEYS.applyDialogOpen, true)
  }

  const cancelApplyS2VConfigProfile = () => {
    set(PROFILE_KEYS.applyDialogOpen, false)
    set(PROFILE_KEYS.applyTarget, null)
    set(PROFILE_KEYS.applyPipelineId, '')
  }

  const confirmApplyS2VConfigProfile = async (profile) => {
    const target = profile || get(PROFILE_KEYS.applyTarget)
    set(PROFILE_KEYS.applyDialogOpen, false)
    set(PROFILE_KEYS.applyTarget, null)
    const openedPipelineId = get(PROFILE_KEYS.applyPipelineId)
    set(PROFILE_KEYS.applyPipelineId, '')
    if (!target) return
    const currentPipelineId = get('selectedPipeline')?.name || ''
    if (target.pipelineId !== currentPipelineId || (openedPipelineId && openedPipelineId !== currentPipelineId)) {
      toast(messages.wrongPipeline(), 2600)
      return
    }
    const applied = await applyS2VConfigProfileSnapshot(target)
    if (applied) {
      set('s2vActiveConfigProfile', target.name || '')
      toast(messages.applied())
    }
  }

  const applyS2VConfigProfileSnapshot = async (profile) => {
    const snapshot = profile && profile.snapshot
    if (!snapshot || typeof snapshot !== 'object' || Array.isArray(snapshot)) return false
    if (snapshot.kind === 'legacy') {
      const s = snapshot.legacy || {}
      if (typeof s.inputMode === 'string' && LEGACY_INPUT_MODES.includes(s.inputMode)) set('inputMode', s.inputMode)
      if (CHECKPOINT_POLICIES.includes(s.checkpointPolicy)) set('checkpointPolicy', s.checkpointPolicy)
      if (STORYBOARD_MODES.includes(s.storyboardMode)) set('storyboardMode', s.storyboardMode)
      // 整对象快照语义：直接替换目标（逐项合并只适合原地合并，不适配整对象恢复）
      if (typeof s.selectedStyle === 'string' && STYLES.some(style => style.value === s.selectedStyle)) set('selectedStyle', s.selectedStyle)
      if (s.llmConfig && typeof s.llmConfig === 'object' && !Array.isArray(s.llmConfig)) set('llmConfig', JSON.parse(JSON.stringify(s.llmConfig)))
      if (s.budgetConfig && typeof s.budgetConfig === 'object' && !Array.isArray(s.budgetConfig)) set('budgetConfig', JSON.parse(JSON.stringify(s.budgetConfig)))
      if (s.outputConfig && typeof s.outputConfig === 'object' && !Array.isArray(s.outputConfig)) set('outputConfig', JSON.parse(JSON.stringify(s.outputConfig)))
      const budgetConfig = get('budgetConfig')
      if (!BUDGET_MODES.includes(budgetConfig.mode)) budgetConfig.mode = 'warn'
      const outputConfig = get('outputConfig')
      const fps = Number(outputConfig.fps)
      outputConfig.fps = OUTPUT_FPS.includes(fps) ? fps : 30
      if (!OUTPUT_FORMATS.includes(outputConfig.format)) outputConfig.format = 'mp4'
      outputConfig.resolution = normalizeResolution(outputConfig.resolution, get('maxOutputResolution'))
      return true
    }
    return applySnapshotObject(snapshot)
  }

  const startS2VConfigProfileRename = (profile) => {
    set(PROFILE_KEYS.renamingId, profile.id)
    set(PROFILE_KEYS.renameDraft, profile.name)
  }

  const cancelS2VConfigProfileRename = () => {
    set(PROFILE_KEYS.renamingId, '')
  }

  const saveS2VConfigProfileRename = async () => {
    const id = get(PROFILE_KEYS.renamingId)
    const name = String(get(PROFILE_KEYS.renameDraft) || '').trim()
    if (!id || !name) return
    try {
      const result = await story2videoConfigProfileRename(id, name)
      if (!result || result.code !== 0) { toast((result && result.message) || messages.renameFailedRaw(), 2600); return }
      const index = (get(PROFILE_KEYS.list) || []).findIndex(p => p.id === id)
      if (index >= 0) get(PROFILE_KEYS.list).splice(index, 1, result.data)
      set(PROFILE_KEYS.renamingId, '')
      toast(messages.renamed())
    } catch (error) { toast(error?.message || messages.renameFailedRaw(), 2600) }
  }

  const requestS2VConfigProfileDelete = (profile) => {
    set(PROFILE_KEYS.deleteTarget, profile)
    set(PROFILE_KEYS.deleteDialogOpen, true)
  }

  const closeS2VConfigProfileDelete = () => {
    set(PROFILE_KEYS.deleteDialogOpen, false)
    set(PROFILE_KEYS.deleteTarget, null)
  }

  const confirmS2VConfigProfileDelete = async () => {
    const target = get(PROFILE_KEYS.deleteTarget)
    set(PROFILE_KEYS.deleteDialogOpen, false)
    set(PROFILE_KEYS.deleteTarget, null)
    if (!target) return
    try {
      const result = await story2videoConfigProfileDelete(target.id)
      if (!result || result.code !== 0) { toast((result && result.message) || messages.deleteFailedRaw(), 2600); return }
      set(PROFILE_KEYS.list, (get(PROFILE_KEYS.list) || []).filter(p => p.id !== target.id))
      toast(messages.deleted())
    } catch (error) { toast(error?.message || messages.deleteFailedRaw(), 2600) }
  }

  const formatS2VConfigProfileTime = (ts) => {
    if (!Number.isFinite(Number(ts))) return ''
    try {
      return new Intl.DateTimeFormat('zh-CN', { month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' }).format(new Date(Number(ts)))
    } catch (_) { return '' }
  }

  return {
    // 注意：壳侧代理清单必须与本 return 清单**双向对齐**（见 CreateView.config-profile-composable.test.js 的结构锁）。
    buildPipelineConfigSnapshot,
    loadS2VConfigProfiles,
    openS2VConfigProfileSave,
    closeS2VConfigProfileSave,
    saveS2VConfigProfile,
    openS2VConfigProfileList,
    closeS2VConfigProfileList,
    s2vConfigProfileCanApply,
    requestApplyS2VConfigProfile,
    cancelApplyS2VConfigProfile,
    confirmApplyS2VConfigProfile,
    applyS2VConfigProfileSnapshot,
    startS2VConfigProfileRename,
    cancelS2VConfigProfileRename,
    saveS2VConfigProfileRename,
    requestS2VConfigProfileDelete,
    closeS2VConfigProfileDelete,
    confirmS2VConfigProfileDelete,
    formatS2VConfigProfileTime,
  }
}
