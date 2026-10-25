// @ts-check
/**
 * useConfigProfiles.test.js — 「配置档案」域 composable（CreateView 拆分第一刀）
 *
 * 两部分：
 *   Part A：composable 单元测试（仿壳 + 响应式 state）——覆盖定案 §5 的 4 道校验 + 1 道并发守卫
 *           + 桥接两条兼容契约（整体赋值 / 原地变异返回同引用）+ legacy 快照枚举归一化；
 *   Part B：**壳接线证明**——mount 真实 CreateView，验「壳侧同名代理 → composable 实例 → deps」
 *           这条链真的通（新增叶子模块单测全绿 ≠ 已接线，见既有教训）。
 *
 * 独立成文件而不是并入 CreateView.test.js：CI 债务熔断限制单测试文件膨胀（容差 200 行）。
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { mount, config } from '@vue/test-utils'
import { nextTick, reactive } from 'vue'
import { readFileSync } from 'node:fs'
import { createRouter, createWebHistory } from 'vue-router'
import { setActivePinia, createPinia } from 'pinia'

vi.mock('@/composables/useLoginGate', () => ({
  useLoginGate: () => ({
    ensureLogin: vi.fn(async () => true),
    requireLogin: vi.fn(async (fn) => fn()),
    openSignIn: vi.fn(async () => true),
  }),
}))

vi.mock('@/api/publisher', () => ({
  renderStart: vi.fn(),
  renderStartAiVideo: vi.fn(),
  renderCancel: vi.fn(),
  renderGetStatus: vi.fn().mockResolvedValue({ code: 0, data: { ready: true } }),
  renderInstallDeps: vi.fn().mockResolvedValue({ code: 0, data: { success: true } }),
  onRenderProgress: vi.fn().mockReturnValue(vi.fn()),
  onRenderComplete: vi.fn().mockReturnValue(vi.fn()),
  onRenderError: vi.fn().mockReturnValue(vi.fn()),
  onRenderInstallProgress: vi.fn().mockReturnValue(vi.fn()),
  onPipelineUpdate: vi.fn().mockReturnValue(vi.fn()),
  modelProviderGetDefault: vi.fn().mockResolvedValue({ code: 0, data: { id: 'openai' } }),
  aiGenerate: vi.fn().mockResolvedValue({ code: 0, data: { content: 'AI生成的正文' } }),
  pipelineList: vi.fn().mockResolvedValue({ code: 0, data: [] }),
  pipelineStart: vi.fn(),
  pipelinePause: vi.fn(),
  pipelinePauseRun: vi.fn(),
  pipelineResume: vi.fn(),
  pipelineCancel: vi.fn(),
  pipelineStatus: vi.fn(),
  pipelineAdvance: vi.fn(),
  pipelineHistory: vi.fn().mockResolvedValue({ code: 0, data: [] }),
  pipelineStartOrchestrated: vi.fn(),
  pipelineResumeOrchestration: vi.fn(),
  pipelineAdvanceToNextCheckpoint: vi.fn(),
  pipelineGetRunContext: vi.fn(),
  pipelineConfirmSceneAssets: vi.fn(),
  pipelineDeleteRun: vi.fn(),
  draftList: vi.fn().mockResolvedValue({ code: 0, data: [] }),
  story2videoCreateShareUrl: vi.fn(async () => ({ code: 0, data: { url: 'media://x' } })),
  storeGetSetting: vi.fn(),
  storeSetSetting: vi.fn().mockResolvedValue({ code: 0, data: true }),
  story2videoImportMedia: vi.fn(),
  story2videoTranscribe: vi.fn(),
  story2videoListProjects: vi.fn().mockResolvedValue({ code: 0, data: [] }),
  story2videoGetThumbnail: vi.fn().mockResolvedValue({ code: 0, data: { status: 'missing', url: null } }),
  story2videoSaveAs: vi.fn().mockResolvedValue({ code: 0, data: { path: '/saved/video.mp4', cancelled: true } }),
  story2videoDeleteProject: vi.fn(),
  story2videoBgmLibraryList: vi.fn().mockResolvedValue({ code: 0, data: [] }),
  story2videoBgmLibraryAdd: vi.fn(),
  story2videoBgmLibraryRename: vi.fn(),
  story2videoBgmLibraryDelete: vi.fn(),
  story2videoBgmLibraryStatus: vi.fn().mockResolvedValue({ code: -1, message: 'electronAPI not available' }),
  story2videoConfigProfileList: vi.fn().mockResolvedValue({ code: 0, data: [] }),
  story2videoConfigProfileCreate: vi.fn().mockResolvedValue({ code: -1, message: 'electronAPI not available' }),
  story2videoConfigProfileRename: vi.fn().mockResolvedValue({ code: -1, message: 'electronAPI not available' }),
  story2videoConfigProfileDelete: vi.fn().mockResolvedValue({ code: -1, message: 'electronAPI not available' }),
  story2videoBatchCreate: vi.fn().mockResolvedValue({ code: 0, data: { batchId: 'batch_test_1', items: [] } }),
  story2videoBatchStatus: vi.fn().mockResolvedValue({ code: 0, data: [] }),
  story2videoBatchCancel: vi.fn().mockResolvedValue({ code: 0, data: [] }),
  story2videoPickBatchFiles: vi.fn().mockResolvedValue({ code: 0, data: [] }),
}))

vi.mock('@/api/tts-voice-catalog', () => ({
  getTtsVoiceCatalog: vi.fn().mockResolvedValue({ code: 0, data: { providerId: '', model: '', selectedVoiceId: null, voices: [] } }),
  getTtsVoiceCapability: vi.fn().mockResolvedValue({ code: 0, data: { type: 'user_clone', clone: { enabled: true } } }),
  selectTtsVoice: vi.fn().mockResolvedValue({ code: 0, data: { providerId: '', model: '', selectedVoiceId: null } }),
  clearTtsVoicePreference: vi.fn().mockResolvedValue({ code: 0, data: { providerId: '', model: '', selectedVoiceId: null } }),
}))

vi.mock('@/api/tts-voice-clone', () => ({
  addTtsVoiceClone: vi.fn().mockResolvedValue({ code: -1, message: 'TTS_VOICE_CLONE_API_UNAVAILABLE' }),
  chooseTtsVoiceCloneSamples: vi.fn().mockResolvedValue({ code: -1, message: 'TTS_VOICE_CLONE_API_UNAVAILABLE' }),
  deleteTtsVoiceClone: vi.fn().mockResolvedValue({ code: -1, message: 'TTS_VOICE_CLONE_API_UNAVAILABLE' }),
  getTtsVoiceCloneRequirements: vi.fn().mockResolvedValue({ code: -1, message: 'TTS_VOICE_CLONE_API_UNAVAILABLE' }),
  listTtsVoiceClones: vi.fn().mockResolvedValue({ code: -1, message: 'TTS_VOICE_CLONE_API_UNAVAILABLE' }),
  renameTtsVoiceClone: vi.fn().mockResolvedValue({ code: -1, message: 'TTS_VOICE_CLONE_API_UNAVAILABLE' }),
}))

import UiButton from '@/components/UiButton.vue'
import UiSelect from '@/components/UiSelect.vue'
import CreateView from './CreateView.vue'
import CreateViewHistory from './CreateViewHistory.vue'
import { settingsDialogRevision } from '@/stores/settings-dialog'
import { PipelineSelector, StageProgress } from './video-creation'
import { resetBgmLibraryForTest } from './video-creation/composables/useBgmLibrary'
import { resetTtsVoicesForTest } from './video-creation/composables/useTtsVoices'
import { resetBatchCreateForTest } from './video-creation/composables/useBatchCreate'
import i18n from '@/i18n'
import { useConfigProfiles } from './video-creation/composables/useConfigProfiles'
import {
  story2videoConfigProfileList,
  story2videoConfigProfileCreate,
  story2videoConfigProfileRename,
  story2videoConfigProfileDelete,
} from '@/api/publisher'

config.global.stubs = { ...(config.global.stubs || {}), teleport: true }

/** 仿壳：state 用 reactive ⇒ 与真实 Vue 组件的响应式语义一致（原地变异可被观察）。 */
function makeHost (overrides = {}) {
  const state = reactive({
    s2vConfigProfiles: [],
    s2vConfigProfilesLoading: false,
    s2vConfigProfileError: '',
    s2vConfigProfileDialogOpen: false,
    s2vConfigProfileNameDraft: '',
    s2vConfigProfileOverwriteNeeded: false,
    s2vConfigProfileListOpen: false,
    s2vConfigProfileRenamingId: '',
    s2vConfigProfileRenameDraft: '',
    s2vConfigProfileApplyDialogOpen: false,
    s2vConfigProfileApplyTarget: null,
    s2vConfigProfileApplyPipelineId: '',
    s2vConfigProfileDeleteDialogOpen: false,
    s2vConfigProfileDeleteTarget: null,
    s2vConfigProfileListRequestId: 0,
    s2vActiveConfigProfile: '',
    selectedPipeline: { name: 'story2video-compose' },
    s2vConfig: { title: 'x' },
    s2vOutputConfig: { resolution: '720x1280', fps: 30, format: 'mp4' },
    s2vOpenSections: { basic: true, appearance: false },
    inputMode: 'text',
    selectedStyle: 'style-a',
    llmConfig: { model: 'gpt' },
    budgetConfig: { mode: 'warn' },
    checkpointPolicy: 'guided',
    storyboardMode: 'auto',
    outputConfig: { resolution: '720x1280', fps: 30, format: 'mp4' },
    maxOutputResolution: '1080p',
  })
  const host = {
    state,
    get: (key) => state[key],
    set: (key, value) => { state[key] = value },
    getDefaults: () => ({
      s2vConfig: { title: 'x' },
      s2vOutputConfig: { resolution: '720x1280', fps: 30, format: 'mp4' },
      selectedStyle: 'style-a',
      llmConfig: { model: 'gpt' },
      budgetConfig: { mode: 'warn' },
      checkpointPolicy: 'guided',
      storyboardMode: 'auto',
      outputConfig: { resolution: '720x1280', fps: 30, format: 'mp4' },
    }),
    toast: vi.fn(),
    pipelineName: (name) => `流水线:${name}`,
    isOrchestratedPipeline: (name) => name === 'story2video-compose',
    cloneForIpc: (value) => JSON.parse(JSON.stringify(value)),
    applySnapshotObject: vi.fn(async () => true),
    messages: {
      nameRequired: () => '请输入配置名称',
      duplicateName: () => '已存在同名配置，再次点击保存将覆盖它',
      saveFailed: () => '配置保存失败，请稍后重试',
      saveFailedRaw: () => '配置保存失败',
      saved: () => '配置已保存',
      wrongPipeline: () => '该配置属于其他流水线，无法在当前流水线应用',
      applied: () => '已应用配置',
      renamed: () => '配置已重命名',
      renameFailedRaw: () => '重命名失败',
      deleted: () => '配置已删除',
      deleteFailedRaw: () => '删除失败',
      listLoadFailed: () => '配置列表加载失败',
    },
    ...overrides,
  }
  host.api = useConfigProfiles(host)
  return host
}

describe('useConfigProfiles（配置档案域 composable）', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    story2videoConfigProfileList.mockResolvedValue({ code: 0, data: [] })
    story2videoConfigProfileCreate.mockResolvedValue({ code: 0, data: { id: 'p1', pipelineId: 'story2video-compose', name: 'n', updatedAt: 1 } })
    story2videoConfigProfileRename.mockResolvedValue({ code: 0, data: { id: 'p1', name: 'n2', updatedAt: 2 } })
    story2videoConfigProfileDelete.mockResolvedValue({ code: 0, data: true })
  })

  it('名称为空 ⇒ 提示且不发请求', async () => {
    const host = makeHost()
    host.state.s2vConfigProfileNameDraft = '   '
    await host.api.saveS2VConfigProfile()
    expect(story2videoConfigProfileCreate).not.toHaveBeenCalled()
    expect(host.toast).toHaveBeenCalledWith('请输入配置名称', 2200)
  })

  it('未选流水线 ⇒ 静默返回（不发请求、不提示）', async () => {
    const host = makeHost()
    host.state.selectedPipeline = null
    host.state.s2vConfigProfileNameDraft = 'n'
    await host.api.saveS2VConfigProfile()
    expect(story2videoConfigProfileCreate).not.toHaveBeenCalled()
    expect(host.toast).not.toHaveBeenCalled()
  })

  it('重名 ⇒ 第一次只提示并置 overwriteNeeded，第二次才真正覆盖', async () => {
    const host = makeHost()
    host.state.s2vConfigProfiles = [{ id: 'p0', pipelineId: 'story2video-compose', name: 'dup', updatedAt: 1 }]
    host.state.s2vConfigProfileNameDraft = 'dup'
    await host.api.saveS2VConfigProfile()
    expect(story2videoConfigProfileCreate).not.toHaveBeenCalled()
    expect(host.state.s2vConfigProfileOverwriteNeeded).toBe(true)
    expect(host.toast).toHaveBeenCalledWith('已存在同名配置，再次点击保存将覆盖它', 2200)

    await host.api.saveS2VConfigProfile()
    expect(story2videoConfigProfileCreate).toHaveBeenCalledTimes(1)
    expect(story2videoConfigProfileCreate.mock.calls[0][0].overwrite).toBe(true)
  })

  it('服务端判定同名（code=-2）⇒ 同样走二次确认，不当成普通失败', async () => {
    const host = makeHost()
    host.state.s2vConfigProfileNameDraft = 'n'
    story2videoConfigProfileCreate.mockResolvedValue({ code: -2, message: '已存在同名配置' })
    await host.api.saveS2VConfigProfile()
    expect(host.state.s2vConfigProfileOverwriteNeeded).toBe(true)
    expect(host.toast).toHaveBeenCalledWith('已存在同名配置，再次点击保存将覆盖它', 2200)
  })

  it('服务端其它错误 ⇒ 提示保存失败，不置 overwriteNeeded', async () => {
    const host = makeHost()
    host.state.s2vConfigProfileNameDraft = 'n'
    story2videoConfigProfileCreate.mockResolvedValue({ code: -1, message: 'boom' })
    await host.api.saveS2VConfigProfile()
    expect(host.state.s2vConfigProfileOverwriteNeeded).toBe(false)
    expect(host.toast).toHaveBeenCalledWith('配置保存失败，请稍后重试', 2600)
  })

  it('保存成功 ⇒ 列表含新项、关闭弹窗、提示已保存', async () => {
    const host = makeHost()
    host.state.s2vConfigProfileNameDraft = 'n'
    host.state.s2vConfigProfileDialogOpen = true
    await host.api.saveS2VConfigProfile()
    expect(host.state.s2vConfigProfiles.map(p => p.id)).toEqual(['p1'])
    expect(host.state.s2vConfigProfileDialogOpen).toBe(false)
    expect(host.toast).toHaveBeenCalledWith('配置已保存')
  })

  it('并发守卫：过期请求的结果被丢弃（列表不变、loading 不被误清）', async () => {
    const host = makeHost()
    let resolveList
    story2videoConfigProfileList.mockImplementation(() => new Promise((resolve) => { resolveList = resolve }))
    const pending = host.api.loadS2VConfigProfiles()
    // 请求在途期间 requestId 被推进（模拟更晚的一次请求）
    host.state.s2vConfigProfileListRequestId = host.state.s2vConfigProfileListRequestId + 1
    resolveList({ code: 0, data: [{ id: 'stale', updatedAt: 1 }] })
    await pending
    expect(host.state.s2vConfigProfiles).toEqual([])
  })

  it('列表按 updatedAt 倒序', async () => {
    const host = makeHost()
    story2videoConfigProfileList.mockResolvedValue({ code: 0, data: [
      { id: 'old', updatedAt: 1 },
      { id: 'new', updatedAt: 9 },
    ] })
    await host.api.loadS2VConfigProfiles()
    expect(host.state.s2vConfigProfiles.map(p => p.id)).toEqual(['new', 'old'])
  })

  it('加载失败 ⇒ 保留旧列表 + 记录错误 + 提示；quiet 模式不提示', async () => {
    const host = makeHost()
    host.state.s2vConfigProfiles = [{ id: 'keep', updatedAt: 1 }]
    story2videoConfigProfileList.mockRejectedValue(new Error('net down'))
    await host.api.loadS2VConfigProfiles()
    expect(host.state.s2vConfigProfiles.map(p => p.id)).toEqual(['keep'])
    expect(host.state.s2vConfigProfileError).toBe('net down')
    expect(host.toast).toHaveBeenCalledWith('net down', 2200)

    host.toast.mockClear()
    await host.api.loadS2VConfigProfiles({ quiet: true })
    expect(host.toast).not.toHaveBeenCalled()
  })

  it('套用：跨流水线 ⇒ 拒绝并提示，不套用', async () => {
    const host = makeHost()
    await host.api.requestApplyS2VConfigProfile({ id: 'x', pipelineId: 'other-pipeline', snapshot: {} })
    expect(host.toast).toHaveBeenCalledWith('该配置属于其他流水线，无法在当前流水线应用', 2600)
    expect(host.state.s2vConfigProfileApplyDialogOpen).toBe(false)
  })

  it('套用：表单未脏 ⇒ 直接套用（不弹二次确认）', async () => {
    const host = makeHost()
    await host.api.requestApplyS2VConfigProfile({ id: 'x', pipelineId: 'story2video-compose', name: 'p', snapshot: { kind: 'orchestrated' } })
    expect(host.state.s2vConfigProfileApplyDialogOpen).toBe(false)
    expect(host.applySnapshotObject).toHaveBeenCalledTimes(1)
    expect(host.state.s2vActiveConfigProfile).toBe('p')
  })

  it('套用：表单已脏 ⇒ 先开确认弹窗，确认后才套用', async () => {
    const host = makeHost()
    host.state.s2vConfig = { title: 'user edited' }
    await host.api.requestApplyS2VConfigProfile({ id: 'x', pipelineId: 'story2video-compose', name: 'p', snapshot: { kind: 'orchestrated' } })
    expect(host.state.s2vConfigProfileApplyDialogOpen).toBe(true)
    expect(host.applySnapshotObject).not.toHaveBeenCalled()

    await host.api.confirmApplyS2VConfigProfile()
    expect(host.applySnapshotObject).toHaveBeenCalledTimes(1)
    expect(host.state.s2vActiveConfigProfile).toBe('p')
  })

  it('legacy 快照套用 ⇒ 枚举归一化 + 整对象深拷贝', async () => {
    const host = makeHost()
    const applied = await host.api.applyS2VConfigProfileSnapshot({
      snapshot: {
        kind: 'legacy',
        legacy: {
          inputMode: 'bogus-mode',
          checkpointPolicy: 'bogus-policy',
          storyboardMode: 'bogus-mode',
          selectedStyle: 'style-a',
          llmConfig: { model: 'other' },
          budgetConfig: { mode: 'bogus-mode' },
          outputConfig: { fps: 999, format: 'avi', resolution: '9999x9999' },
        },
      },
    })
    expect(applied).toBe(true)
    expect(host.state.inputMode).toBe('text')
    expect(host.state.checkpointPolicy).toBe('guided')
    expect(host.state.storyboardMode).toBe('auto')
    expect(host.state.llmConfig).toEqual({ model: 'other' })
    expect(host.state.budgetConfig.mode).toBe('warn')
    expect(host.state.outputConfig.fps).toBe(30)
    expect(host.state.outputConfig.format).toBe('mp4')
    expect(host.state.outputConfig.resolution).toBe('1920x1080')
  })

  it('orchestrated 快照 ⇒ 交给壳的整对象恢复通道', async () => {
    const host = makeHost()
    const applied = await host.api.applyS2VConfigProfileSnapshot({ snapshot: { kind: 'orchestrated', s2vConfig: { a: 1 } } })
    expect(applied).toBe(true)
    expect(host.applySnapshotObject).toHaveBeenCalledWith({ kind: 'orchestrated', s2vConfig: { a: 1 } })
  })

  it('重命名成功 ⇒ 列表就地替换 + 提示；失败 ⇒ 只提示', async () => {
    const host = makeHost()
    host.state.s2vConfigProfiles = [{ id: 'p1', name: 'old', updatedAt: 1 }]
    host.state.s2vConfigProfileRenamingId = 'p1'
    host.state.s2vConfigProfileRenameDraft = 'new'
    await host.api.saveS2VConfigProfileRename()
    expect(host.state.s2vConfigProfiles[0].name).toBe('n2')
    expect(host.toast).toHaveBeenCalledWith('配置已重命名')

    // 上一轮成功后 renamingId 已被清空（既有行为）⇒ 失败分支需重新进入重命名态
    story2videoConfigProfileRename.mockResolvedValue({ code: -1, message: 'rename boom' })
    host.state.s2vConfigProfileRenamingId = 'p1'
    host.state.s2vConfigProfileRenameDraft = 'new'
    host.toast.mockClear()
    await host.api.saveS2VConfigProfileRename()
    expect(host.toast).toHaveBeenCalledWith('rename boom', 2600)
  })

  it('删除成功 ⇒ 从列表移除 + 提示', async () => {
    const host = makeHost()
    host.state.s2vConfigProfiles = [{ id: 'p1', updatedAt: 1 }]
    host.state.s2vConfigProfileDeleteTarget = { id: 'p1' }
    await host.api.confirmS2VConfigProfileDelete()
    expect(host.state.s2vConfigProfiles).toEqual([])
    expect(host.toast).toHaveBeenCalledWith('配置已删除')
  })

  it('桥接契约：原地变异返回同一引用（不是 spread 副本），整体赋值整体替换', async () => {
    const host = makeHost()
    const list = host.get('s2vConfigProfiles')
    list.push({ id: 'inplace', updatedAt: 1 })
    // 壳侧读到的就是被改过的那个数组（非副本）
    expect(host.state.s2vConfigProfiles.map(p => p.id)).toEqual(['inplace'])

    host.set('s2vConfigProfiles', [{ id: 'replaced', updatedAt: 2 }])
    expect(host.state.s2vConfigProfiles.map(p => p.id)).toEqual(['replaced'])
    // 同一引用（不是副本）：壳侧 get 与 state 必须指向同一个对象
    expect(host.get('s2vConfigProfiles')).toBe(host.state.s2vConfigProfiles)
  })

  it('格式化时间：非法值返回空串', () => {
    const host = makeHost()
    expect(host.api.formatS2VConfigProfileTime('not-a-number')).toBe('')
    expect(host.api.formatS2VConfigProfileTime(undefined)).toBe('')
    expect(host.api.formatS2VConfigProfileTime(1700000000000)).not.toBe('')
  })
})

describe('CreateView 接线证明（配置档案域代理链真的通）', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    resetBgmLibraryForTest()
    resetTtsVoicesForTest()
    resetBatchCreateForTest()
    setActivePinia(createPinia())
  })

  async function mountCreateView () {
    const router = createRouter({
      history: createWebHistory(),
      routes: [
        { path: '/create', name: 'create', component: { template: '<div>create</div>' } },
        { path: '/create/result', name: 'result', component: { template: '<div>result</div>' } },
      ],
    })
    await router.push({ path: '/create' })
    await router.isReady()
    const w = mount(CreateView, {
      global: { plugins: [router, i18n], components: { UiButton, UiSelect, CreateViewHistory, PipelineSelector, StageProgress } },
    })
    await nextTick()
    return w
  }

  it('壳侧同名代理存在且转发到 composable（名称为空 ⇒ 壳的 toast 生效）', async () => {
    story2videoConfigProfileCreate.mockResolvedValue({ code: 0, data: { id: 'p1' } })
    const w = await mountCreateView()
    expect(typeof w.vm.saveS2VConfigProfile).toBe('function')
    expect(typeof w.vm.loadS2VConfigProfiles).toBe('function')
    expect(typeof w.vm.applyS2VConfigProfileSnapshot).toBe('function')
    expect(typeof w.vm.buildPipelineConfigSnapshot).toBe('function')

    w.vm.s2vConfigProfileNameDraft = '   '
    await w.vm.saveS2VConfigProfile()
    expect(w.vm.s2vOptionsToast).toContain('配置名称')
    expect(story2videoConfigProfileCreate).not.toHaveBeenCalled()
  })

  it('状态仍留在壳的 data()（配置档案键未被搬走）', async () => {
    const w = await mountCreateView()
    const keys = Object.keys(w.vm.$data)
    expect(keys).toContain('s2vConfigProfiles')
    expect(keys).toContain('s2vConfigProfileOverwriteNeeded')
    expect(keys).toContain('s2vConfigProfileListRequestId')
  })

  it('列表加载走代理 ⇒ 真的打到 API 层', async () => {
    story2videoConfigProfileList.mockResolvedValue({ code: 0, data: [{ id: 'p1', pipelineId: 'story2video-compose', name: 'n', updatedAt: 1 }] })
    const w = await mountCreateView()
    await w.vm.loadS2VConfigProfiles({ quiet: true })
    expect(story2videoConfigProfileList).toHaveBeenCalled()
    expect(w.vm.s2vConfigProfiles.map(p => p.id)).toEqual(['p1'])
  })
})

// ⚠ vitest 跑在 vite-node 下，import.meta.url 不是 file:// scheme ⇒ 用 cwd 相对路径。
// cwd = apps/desktop（本地与 CI 一致：pnpm --filter @multi-publish/desktop test）。
const createViewSource = readFileSync('src/views/CreateView.vue', 'utf8')
const composableSource = readFileSync('src/views/video-creation/composables/useConfigProfiles.js', 'utf8')

/** 壳侧代理：`    name(...args) { return this.configProfiles.name(...args) },` */
function proxyNames (source) {
  const out = []
  const re = /^\s{4}([A-Za-z_$][\w$]*)\(\.\.\.args\)\s*\{\s*return this\.configProfiles\.\1\(\.\.\.args\)\s*\},/gm
  let m
  while ((m = re.exec(source)) !== null) out.push(m[1])
  return out
}

/** composable 的 return 清单：最后一个 `return { ... }` 块里的顶层标识符。 */
function exportedNames (source) {
  const blocks = [...source.matchAll(/^\s{2}return \{([\s\S]*?)^\s{2}\}/gm)]
  if (!blocks.length) return []
  const body = blocks[blocks.length - 1][1]
  const out = []
  for (const line of body.split('\n')) {
    const m = line.match(/^\s{4}([A-Za-z_$][\w$]*),?\s*$/)
    if (m) out.push(m[1])
  }
  return out
}

describe('配置档案域：壳侧代理 ⇄ composable return 结构锁', () => {
  it('壳侧代理数量符合预期（防止误删代理）', () => {
    expect(proxyNames(createViewSource).length).toBe(19)
  })

  it('每个壳侧代理在 composable 的 return 清单里都有对应导出', () => {
    const exported = new Set(exportedNames(composableSource))
    const missing = proxyNames(createViewSource).filter(name => !exported.has(name))
    expect(missing).toEqual([])
  })

  it('composable 没有「导出了但壳侧没人用」的死导出', () => {
    const proxied = new Set(proxyNames(createViewSource))
    const dead = exportedNames(composableSource).filter(name => !proxied.has(name))
    expect(dead).toEqual([])
  })
})
