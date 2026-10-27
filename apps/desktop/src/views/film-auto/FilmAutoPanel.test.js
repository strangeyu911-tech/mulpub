// @vitest-environment jsdom
/**
 * FilmAutoPanel 契约测试（openspec change: film-auto-mode）
 *
 * 锁定的是「面板不许偷跑」这条主线（design D3/D5/D25/D31）：
 *   - 未勾选确认 → **绝不调用** auto-start（成本门槛在 UI 侧的第一道闸）；
 *   - auto-start 的负载只能是 { planId, taskId, confirmed, overwrite }——渲染端不得伪造分镜/参考图；
 *   - 服务端回 needsReconfirm → 回到确认卡并复位勾选（不许自动重试）；
 *   - 收口合成必须复用既有 `pipelineStartOrchestrated('film-engineering', { initialContext: { renderManifest } })`；
 *   - 片段编辑/重生成分别走 auto-update-shot / auto-regenerate-shot，且重生成显式带 confirmed。
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { mount, flushPromises } from '@vue/test-utils'

vi.mock('vue-i18n', () => ({
  // ⚠ 译文**存在**时必须与 key **可区分**：面板的 `shotErrorText` 用
  //   `translated !== key` 判断「有没有译文」（没有 ⇒ 回落后端原文）。
  //   若 mock 对缺失的 key 也返回 key（vue-i18n 的真实行为），则
  //   「有译文」与「无译文」在测试里长得一模一样 ⇒ 这条分支永远测不到。
  // ⇒ 给 shotError 命名空间一个可区分的译文标记。
  useI18n: () => ({
    t: (k, p) => (p
      ? k + ':' + JSON.stringify(p)
      : (String(k).startsWith('filmEngineering.auto.shotError.') ? '译文<' + k + '>' : k)),
  }),
}))

vi.mock('element-plus', () => ({
  ElMessage: { error: vi.fn(), success: vi.fn(), warning: vi.fn() },
}))

const pipelineStartOrchestrated = vi.fn(async () => ({ code: 0, data: { success: true, runId: 'run-compose-1' } }))
const onPipelineUpdate = vi.fn(() => () => {})
const pipelineGetRunContext = vi.fn(async () => ({ code: 0, data: { runId: 'run-compose-1', status: 'running', context: {} } }))
const story2videoShowInFolder = vi.fn(async () => ({ code: 0 }))
const story2videoSaveAs = vi.fn(async () => ({ code: 0 }))
vi.mock('@/api/publisher', () => ({
  pipelineStartOrchestrated: (...args) => pipelineStartOrchestrated(...args),
  pipelineGetRunContext: (...args) => pipelineGetRunContext(...args),
  onPipelineUpdate: (...args) => onPipelineUpdate(...args),
  story2videoShowInFolder: (...args) => story2videoShowInFolder(...args),
  story2videoSaveAs: (...args) => story2videoSaveAs(...args),
}))

import FilmAutoPanel from './FilmAutoPanel.vue'

const PLAN_DATA = {
  planId: 'plan-abc',
  taskId: 'auto-1',
  aspect: '16x9',
  seconds: 5,
  targetDurationSec: 60,
  plannedDurationSec: 60,
  shotCount: 12,
  batchCount: 2,
  shotsWithReferences: 3,
  characterMap: { ROKO: '小强' },
  warnings: [{ code: 'W2', message: '将自动分批' }],
  estimates: { batchCount: 2, diskEstimateBytes: 1, wallclockEstimateSeconds: 3600 },
  provider: { id: 'minimax', model: '' },
  shots: [
    { index: 0, shotId: 'auto-000', title: '第1场', seconds: 5, refPaths: ['/tmp/a.png'], promptLength: 120, promptPreview: 'INT. X' },
    { index: 1, shotId: 'auto-001', title: '第2场', seconds: 5, refPaths: [], promptLength: 90, promptPreview: 'INT. Y' },
  ],
}

function makeApi (overrides = {}) {
  return {
    autoPlan: vi.fn(async () => ({ code: 0, data: JSON.parse(JSON.stringify(PLAN_DATA)) })),
    autoStart: vi.fn(async () => ({ code: 0, data: { started: true, taskId: 'auto-1', ok: true, doneCount: 12, totalCount: 12, renderManifest: [{ shotId: 'auto-000' }], manifestError: null } })),
    autoStatus: vi.fn(async () => ({ code: 0, data: { exists: true, taskId: 'auto-1', running: false, doneCount: 12, totalCount: 12, shots: [{ index: 0, shotId: 'auto-000', prompt: 'P0', seconds: 5, status: 'done', outputPath: 'C:\\x\\shot_000.mp4', error: null }], manifestError: null } })),
    autoUpdateShot: vi.fn(async () => ({ code: 0, data: { ok: true, shot: { index: 0, prompt: 'NEW' }, editedAt: 'T' } })),
    autoRegenerateShot: vi.fn(async () => ({ code: 0, data: { ok: true, path: 'C:\\x\\shot_000.mp4' } })),
    autoCompose: vi.fn(async () => ({ code: 0, data: { ok: true, renderManifest: [{ shotId: 'auto-000', path: 'C:\\x\\shot_000.mp4' }] } })),
    uploadReference: vi.fn(async () => ({ code: 0, data: { path: '/tmp/film-engineering/references/ref-1.png' } })),
    onAutoUpdate: vi.fn(() => () => {}),
    ...overrides,
  }
}

function mountPanel (api, props = {}) {
  return mount(FilmAutoPanel, {
    props: { api, pollIntervalMs: 100000, ...props },
    global: {
      stubs: {
        StageProgress: true,
        FilmAutoSegmentEditor: true,
        ElSteps: true,
        ElStep: true,
        ElInput: true,
        ElButton: true,
        ElSelect: true,
        ElOption: true,
        ElCollapse: true,
        ElCollapseItem: true,
      },
    },
  })
}

beforeEach(() => {
  pipelineStartOrchestrated.mockClear()
  onPipelineUpdate.mockClear()
})

describe('FilmAutoPanel · 输入与规划', () => {
  it('空剧本不可规划；超长剧本禁用并提示', async () => {
    const api = makeApi()
    const w = mountPanel(api)
    expect(w.vm.canPlan).toBe(false)
    w.vm.form.script = 'x'.repeat(10001)
    await flushPromises()
    expect(w.vm.scriptTooLong).toBe(true)
    expect(w.vm.canPlan).toBe(false)
    await w.vm.runPlan()
    expect(api.autoPlan).not.toHaveBeenCalled()
    w.unmount()
  })

  it('规划成功进入预览态并展示清单（分镜数/批次/Provider/警告/角色映射）', async () => {
    const api = makeApi()
    const w = mountPanel(api)
    w.vm.form.script = '第1场\n小强推开门。'
    await w.vm.runPlan()
    await flushPromises()
    expect(api.autoPlan).toHaveBeenCalledTimes(1)
    const payload = api.autoPlan.mock.calls[0][0]
    expect(payload).toMatchObject({ aspect: '16x9', seconds: 5, targetDurationSec: 60 })
    expect(payload).not.toHaveProperty('templateShots')
    expect(w.vm.phase).toBe('preview')
    expect(w.find('[data-testid="fa-preview"]').exists()).toBe(true)
    expect(w.find('[data-testid="fa-kv-shots"]').text()).toBe('12')
    expect(w.find('[data-testid="fa-warning-W2"]').exists()).toBe(true)
    expect(w.find('[data-testid="fa-charmap"]').text()).toContain('ROKO')
    expect(w.find('[data-testid="fa-shot-preview"]').findAll('li')).toHaveLength(2)
    w.unmount()
  })

  it('规划阶段零 provider 调用：只调 autoPlan', async () => {
    const api = makeApi()
    const w = mountPanel(api)
    w.vm.form.script = '第1场\n剧情'
    await w.vm.runPlan()
    await flushPromises()
    expect(api.autoStart).not.toHaveBeenCalled()
    expect(api.autoCompose).not.toHaveBeenCalled()
    expect(api.autoRegenerateShot).not.toHaveBeenCalled()
    w.unmount()
  })
})

describe('FilmAutoPanel · 确认门槛（不许偷跑）', () => {
  it('未勾选确认 → 不调用 auto-start', async () => {
    const api = makeApi()
    const w = mountPanel(api)
    w.vm.form.script = '第1场\n剧情'
    await w.vm.runPlan()
    await w.vm.startRun()
    await flushPromises()
    expect(api.autoStart).not.toHaveBeenCalled()
    expect(w.vm.phase).toBe('preview')
    w.unmount()
  })

  it('勾选后 auto-start 负载只含归属与确认（不含分镜/参考图）', async () => {
    const api = makeApi()
    const w = mountPanel(api)
    w.vm.form.script = '第1场\n剧情'
    await w.vm.runPlan()
    w.vm.confirmed = true
    await w.vm.startRun()
    await flushPromises()
    expect(api.autoStart).toHaveBeenCalledTimes(1)
    const payload = api.autoStart.mock.calls[0][0]
    expect(Object.keys(payload).sort()).toEqual(['confirmed', 'overwrite', 'planId', 'taskId'])
    expect(payload).toEqual({ planId: 'plan-abc', taskId: 'auto-1', confirmed: true, overwrite: false })
    expect(w.vm.phase).toBe('done')
    w.unmount()
  })

  it('服务端回 needsReconfirm → 回确认卡并复位勾选（不自动重试）', async () => {
    const api = makeApi({ autoStart: vi.fn(async () => ({ code: 0, data: { started: false, needsReconfirm: true, payloadHash: 'h' } })) })
    const w = mountPanel(api)
    w.vm.form.script = '第1场\n剧情'
    await w.vm.runPlan()
    w.vm.confirmed = true
    await w.vm.startRun()
    await flushPromises()
    expect(w.vm.phase).toBe('preview')
    expect(w.vm.confirmed).toBe(false)
    expect(api.autoStart).toHaveBeenCalledTimes(1)
    w.unmount()
  })

  it('IPC 失败 → 回显错误且不进入运行态', async () => {
    const api = makeApi({ autoStart: vi.fn(async () => ({ code: -2, errorCode: 'AUTO_TASK_BUSY', message: '已有任务在运行' })) })
    const w = mountPanel(api)
    w.vm.form.script = '第1场\n剧情'
    await w.vm.runPlan()
    w.vm.confirmed = true
    await w.vm.startRun()
    await flushPromises()
    expect(w.vm.phase).toBe('preview')
    expect(w.vm.errorText).toContain('已有任务在运行')
    w.unmount()
  })
})

describe('FilmAutoPanel · 进度与收口', () => {
  it('运行态复用 StageProgress（前缀 film-auto）并用事件推进进度', async () => {
    const api = makeApi({
      autoStart: vi.fn(async () => ({ code: 0, data: { started: true, doneCount: 0, totalCount: 12, renderManifest: null } })),
      // 运行中：服务端如实报 running=true 与部分完成数（否则会被正确判为已完成——这正是磁盘为真的语义）
      autoStatus: vi.fn(async () => ({ code: 0, data: { exists: true, taskId: 'auto-1', running: true, doneCount: 0, totalCount: 12, shots: [], manifestError: null } })),
    })
    const w = mountPanel(api)
    w.vm.form.script = '第1场\n剧情'
    await w.vm.runPlan()
    w.vm.confirmed = true
    await w.vm.startRun()
    await flushPromises()
    expect(w.vm.phase).toBe('running')
    const sp = w.findComponent({ name: 'StageProgress' })
    expect(sp.exists()).toBe(true)
    expect(sp.props('testidPrefix')).toBe('film-auto')
    w.vm.applyAutoEvent({ type: 'production:shot-progress', doneCount: 5, totalCount: 12, batchIndex: 0 })
    await flushPromises()
    expect(w.vm.progress.doneCount).toBe(5)
    expect(w.vm.percent).toBe(42)
    expect(sp.props('progressPercent')).toBe(42)
    w.unmount()
  })

  /**
   * A33（PRD §六）：进度提示必须区分「执行中」与「已收口」。
   *
   * ⭐ 核心语义（这条是本用例的**主要**断言）：
   *   **执行中不得声称「已完成 N / M」** ——
   *   执行期的 N 只能来自**磁盘口径**（已落盘的片数），
   *   而「磁盘有片 ≠ 该镜成功」（可能是残留，也可能该镜最终判失败）
   *   ⇒ 说「已完成」是在骗用户 ⇒ 改说「产物正在落盘，进度以磁盘为准」。
   *   收口后才可以说「已完成 N / M」（那时 N 来自台账，每镜都有结论）。
   *
   * ⚠ 判据的来源只有一处：后端 `auto-status` 的 `running`（= runningAutoTasks.has(taskId)）
   *   ⇒ 用例**必须走真实链路**（autoStatus → refreshStatus → 面板渲染），
   *   **不许**在下游手工塞字段（那会绕开真正的判据）。
   */
  it('A33：执行中显示「产物正在落盘」而非「已完成 N/M」；收口后回到「已完成 N/M」', async () => {
    // ① 执行中：后端报 running=true
    const runningApi = makeApi({
      autoStart: vi.fn(async () => ({ code: 0, data: { started: true, doneCount: 0, totalCount: 12, renderManifest: null } })),
      autoStatus: vi.fn(async () => ({ code: 0, data: { exists: true, taskId: 'auto-1', running: true, doneCount: 0, totalCount: 12, shots: [], manifestError: null } })),
    })
    const w = mountPanel(runningApi)
    w.vm.form.script = '第1场\n剧情'
    await w.vm.runPlan()
    w.vm.confirmed = true
    await w.vm.startRun()
    await flushPromises()
    const sp = w.findComponent({ name: 'StageProgress' })
    expect(sp.exists()).toBe(true)
    // ⭐ 执行中 ⇒ 提示落在「正在落盘」，且**不含**「已完成」口径
    expect(sp.props('summary')).toContain('filmEngineering.auto.landingProgress')
    expect(sp.props('summary')).not.toContain('filmEngineering.auto.runSummary')
    // 阶段清单里的 messageKey 同样走 landing（两处必须同一口径，否则面板自相矛盾）
    const genStage = sp.props('stages')[1]
    expect(genStage.progress.messageKey).toContain('filmEngineering.auto.landingProgress')
    expect(genStage.progress.messageKey).not.toContain('filmEngineering.auto.stageShotProgress')
    w.unmount()

    // ② 已收口：后端报 running=false（默认 makeApi 夹具即是）
    const doneApi = makeApi()
    const w2 = mountPanel(doneApi)
    w2.vm.form.script = '第1场\n剧情'
    await w2.vm.runPlan()
    w2.vm.confirmed = true
    await w2.vm.startRun()
    await flushPromises()
    const sp2 = w2.findComponent({ name: 'StageProgress' })
    expect(sp2.exists()).toBe(true)
    expect(sp2.props('summary')).toContain('filmEngineering.auto.runSummary')
    expect(sp2.props('summary')).not.toContain('filmEngineering.auto.landingProgress')
    expect(sp2.props('stages')[1].progress.messageKey).toContain('filmEngineering.auto.stageShotProgress')
    w2.unmount()
  })

  /**
   * ⭐ 复核 B1 的回归保护：「关页面 → 重开续跑」这条产品明文承诺的路径。
   *
   * ⚠ 此前只测了**启动路径**（`startRun` → `await refreshStatus()`），
   *   而 `restoreLastTask`（重开路径）是 `data.running` 的**第二个消费者**，
   *   此前**只设 phase、没写 batchRunning** ⇒ 面板在该路径上仍说「已完成 N / M」
   *   ⇒ A33 要消灭的那句谎在**产品明文承诺的路径**上原样复现。
   * ⇒ 本条走**重开路径**（`onMounted` → `restoreLastTask`）⇒ 必须真链路，不许手工塞字段。
   */
  it('A33 补强：重开续跑路径（restoreLastTask）也必须说「产物正在落盘」', async () => {
    const api = makeApi({
      // 重开时后端报 running=true、台账 0、磁盘已落盘 3（磁盘口径在涨 ⇒ 「已完成 3/12」会是在说谎）
      autoStatus: vi.fn(async () => ({ code: 0, data: { exists: true, taskId: 'auto-1', running: true, doneCount: 0, doneCountOnDisk: 3, totalCount: 12, shots: [], manifestError: null } })),
    })
    // 让 restoreLastTask 拿到 taskId（它优先用传入值，否则读上次任务）
    const w = mountPanel(api)
    await flushPromises()
    // 直接触发重开路径（面板暴露了 restoreLastTask）
    const ok = await w.vm.restoreLastTask('auto-1')
    await flushPromises()
    expect(ok).toBe(true)
    expect(w.vm.phase).toBe('running')
    const sp = w.findComponent({ name: 'StageProgress' })
    expect(sp.exists()).toBe(true)
    expect(sp.props('summary')).toContain('filmEngineering.auto.landingProgress')
    expect(sp.props('summary')).not.toContain('filmEngineering.auto.runSummary')
    w.unmount()
  })

  it('收口合成复用既有 pipeline 通道并透传 manifest', async () => {
    const api = makeApi()
    const w = mountPanel(api)
    w.vm.form.script = '第1场\n剧情'
    await w.vm.runPlan()
    w.vm.confirmed = true
    await w.vm.startRun()
    await flushPromises()
    expect(w.vm.phase).toBe('done')
    await w.vm.compose()
    await flushPromises()
    expect(api.autoCompose).toHaveBeenCalledWith({ taskId: 'auto-1' })
    expect(pipelineStartOrchestrated).toHaveBeenCalledTimes(1)
    const [name, payload] = pipelineStartOrchestrated.mock.calls[0]
    expect(name).toBe('film-engineering')
    expect(payload.autoAdvance).toBe(true)
    expect(payload.initialContext.renderManifest).toHaveLength(1)
    expect(onPipelineUpdate).toHaveBeenCalledTimes(1)
    w.unmount()
  })

  it('收口清单为空 → 报错且不启动合成', async () => {
    const api = makeApi({ autoCompose: vi.fn(async () => ({ code: 0, data: { ok: false, renderManifest: [] } })) })
    const w = mountPanel(api)
    w.vm.form.script = '第1场\n剧情'
    await w.vm.runPlan()
    w.vm.confirmed = true
    await w.vm.startRun()
    await flushPromises()
    await w.vm.compose()
    await flushPromises()
    expect(pipelineStartOrchestrated).not.toHaveBeenCalled()
    expect(w.vm.errorText).toBeTruthy()
    w.unmount()
  })
})

describe('FilmAutoPanel · 片段编辑与参考图', () => {
  it('保存片段 → auto-update-shot 带 shotIndex 与 patch', async () => {
    const api = makeApi()
    const w = mountPanel(api)
    w.vm.form.script = '第1场\n剧情'
    await w.vm.runPlan()
    w.vm.confirmed = true
    await w.vm.startRun()
    await flushPromises()
    const r = await w.vm.saveShotEdit({ shotIndex: 0, patch: { prompt: 'NEW' } })
    expect(r.ok).toBe(true)
    expect(api.autoUpdateShot).toHaveBeenCalledWith({ taskId: 'auto-1', shotIndex: 0, patch: { prompt: 'NEW' } })
    w.unmount()
  })

  it('重生成片段 → auto-regenerate-shot 显式带 confirmed:true；needsReconfirm 透传', async () => {
    const api = makeApi()
    const w = mountPanel(api)
    w.vm.form.script = '第1场\n剧情'
    await w.vm.runPlan()
    w.vm.confirmed = true
    await w.vm.startRun()
    await flushPromises()
    const ok = await w.vm.regenerateShot(0)
    expect(ok.ok).toBe(true)
    expect(api.autoRegenerateShot).toHaveBeenCalledWith({ taskId: 'auto-1', shotIndex: 0, confirmed: true })

    api.autoRegenerateShot.mockResolvedValueOnce({ code: 0, data: { ok: false, needsReconfirm: true } })
    const need = await w.vm.regenerateShot(0)
    expect(need.ok).toBe(false)
    expect(need.needsReconfirm).toBe(true)
    w.unmount()
  })

  it('参考图上传走既有 upload-reference；超上限直接拒绝', async () => {
    const api = makeApi()
    const w = mountPanel(api)
    await w.vm.uploadRefFile('character', { name: '小强.png', dataUrl: 'data:image/png;base64,AAAA' })
    await flushPromises()
    expect(api.uploadReference).toHaveBeenCalledTimes(1)
    expect(w.vm.characterRefs).toHaveLength(1)
    expect(w.vm.characterRefs[0].name).toBe('小强')
    expect(w.vm.characterRefs[0].path).toContain('references')

    w.vm.characterRefs = Array.from({ length: 8 }, (_x, i) => ({ name: 'c' + i, path: '/p' + i }))
    await w.vm.uploadRefFile('character', { name: 'x.png', dataUrl: 'data:image/png;base64,AAAA' })
    await flushPromises()
    expect(api.uploadReference).toHaveBeenCalledTimes(1)
    expect(w.vm.errorText).toBeTruthy()
    w.unmount()
  })

  it('卸载时取消事件订阅（不留悬挂监听）', async () => {
    const unsubscribe = vi.fn()
    const api = makeApi({ onAutoUpdate: vi.fn(() => unsubscribe) })
    const w = mountPanel(api)
    expect(api.onAutoUpdate).toHaveBeenCalledTimes(1)
    w.unmount()
    expect(unsubscribe).toHaveBeenCalledTimes(1)
  })
})

describe('FilmAutoPanel · 停止 / 续跑入口 / 覆盖 / 预估（对照手册核对的修复）', () => {
  async function mountRunning (api) {
    const w = mountPanel(api)
    w.vm.form.script = '第1场\n剧情'
    await w.vm.runPlan()
    w.vm.confirmed = true
    await w.vm.startRun()
    await flushPromises()
    return w
  }

  it('停止按钮：running 态调用 auto-stop 并给出「已请求停止」反馈', async () => {
    const api = makeApi({
      autoStart: vi.fn(async () => ({ code: 0, data: { started: true, doneCount: 0, totalCount: 12, renderManifest: null } })),
      autoStatus: vi.fn(async () => ({ code: 0, data: { exists: true, taskId: 'auto-1', running: true, doneCount: 0, totalCount: 12, shots: [], manifestError: null } })),
      autoStop: vi.fn(async () => ({ code: 0, data: { ok: true, stopping: true, running: true } })),
    })
    const w = await mountRunning(api)
    expect(w.vm.phase).toBe('running')
    expect(w.find('[data-testid="fa-stop"]').exists()).toBe(true)
    const r = await w.vm.stopRun()
    expect(r).toEqual({ ok: true, stopping: true })
    expect(api.autoStop).toHaveBeenCalledWith({ taskId: 'auto-1' })
    await flushPromises()
    expect(w.vm.stopping).toBe(true)
    expect(w.find('[data-testid="fa-stopping-hint"]').exists()).toBe(true)
    w.unmount()
  })

  it('停止后回到确认卡且勾选保持（载荷未变，可直接「继续」续跑）', async () => {
    const api = makeApi({
      autoStart: vi.fn(async () => ({ code: 0, data: { started: true, stopped: true, doneCount: 4, totalCount: 12, renderManifest: null } })),
      autoStatus: vi.fn(async () => ({ code: 0, data: { exists: true, taskId: 'auto-1', running: false, doneCount: 4, totalCount: 12, shots: [], manifestError: null } })),
    })
    const w = await mountRunning(api)
    expect(w.vm.phase).toBe('preview')
    expect(w.vm.confirmed).toBe(true)
    expect(w.vm.stopping).toBe(false)
    w.unmount()
  })

  it('重新打开面板：恢复上次任务（同名任务即续跑），并写入任务 ID 供下次恢复', async () => {
    const api = makeApi({
      api: undefined,
      autoStatus: vi.fn(async () => ({
        code: 0,
        data: {
          exists: true, taskId: 'auto-1', planId: 'plan-abc', aspect: '16x9', seconds: 5,
          targetDurationSec: 60, plannedDurationSec: 60, providerId: 'minimax',
          running: false, doneCount: 3, totalCount: 12, manifestError: null,
          shots: [{ index: 0, shotId: 'auto-000', prompt: 'P0', seconds: 5, status: 'done', outputPath: 'x', error: null }],
        },
      })),
    })
    // 模拟上次任务的记忆
    const storage = new Map()
    globalThis.localStorage = {
      getItem: (k) => (storage.has(k) ? storage.get(k) : null),
      setItem: (k, v) => storage.set(k, String(v)),
    }
    storage.set('film-auto:last-task-id', 'auto-1')
    const w = mountPanel(api)
    await flushPromises()
    expect(api.autoStatus).toHaveBeenCalledWith({ taskId: 'auto-1' })
    expect(w.vm.restored).toBe(true)
    expect(w.vm.plan.taskId).toBe('auto-1')
    expect(w.vm.phase).toBe('preview') // 3/12 未收敛 → 回确认卡，可继续
    // 真正开始时记住任务 ID
    w.vm.confirmed = true
    await w.vm.startRun()
    expect(storage.get('film-auto:last-task-id')).toBe('auto-1')
    delete globalThis.localStorage
    w.unmount()
  })

  it('同名任务冲突 → 勾选覆盖后 auto-start 带 overwrite:true', async () => {
    const api = makeApi({
      autoStart: vi.fn(async () => ({ code: -2, errorCode: 'AUTO_TASK_EXISTS', message: '同名任务已存在' })),
    })
    const w = mountPanel(api)
    w.vm.form.script = '第1场\n剧情'
    await w.vm.runPlan()
    w.vm.confirmed = true
    await w.vm.startRun()
    await flushPromises()
    expect(w.vm.errorCode).toBe('AUTO_TASK_EXISTS')
    expect(w.find('[data-testid="fa-overwrite-box"]').exists()).toBe(true)

    api.autoStart.mockResolvedValueOnce({ code: 0, data: { started: true, doneCount: 12, totalCount: 12, renderManifest: [{ shotId: 'x' }] } })
    w.vm.overwriteExisting = true
    await w.vm.startRun()
    await flushPromises()
    expect(api.autoStart).toHaveBeenLastCalledWith(expect.objectContaining({ overwrite: true }))
    w.unmount()
  })

  it('确认卡展示磁盘与墙钟预估（服务端已返回，此前未渲染）', async () => {
    const api = makeApi()
    const w = mountPanel(api)
    w.vm.form.script = '第1场\n剧情'
    await w.vm.runPlan()
    await flushPromises()
    // 夹具：estimates.diskEstimateBytes=1、wallclockEstimateSeconds=3600
    expect(w.find('[data-testid="fa-kv-disk"]').exists()).toBe(true)
    expect(w.find('[data-testid="fa-kv-wallclock"]').text()).toContain('h')
    expect(w.vm.wallclockText).toBe('1.0 h')
    w.unmount()
  })
})

describe('FilmAutoPanel · 缺镜与成品回填（T4.4 / 5.5）', () => {
  async function mountDone (api) {
    const w = mountPanel(api)
    w.vm.form.script = '第1场\n剧情'
    await w.vm.runPlan()
    w.vm.confirmed = true
    await w.vm.startRun()
    await flushPromises()
    return w
  }

  it('部分失败也算收敛到完成态（否则片段编辑与收口入口不可达）', async () => {
    const api = makeApi({
      autoStart: vi.fn(async () => ({ code: 0, data: { started: true, doneCount: 1, totalCount: 2, renderManifest: null } })),
      autoStatus: vi.fn(async () => ({
        code: 0,
        data: {
          exists: true,
          taskId: 'auto-1',
          running: false,
          doneCount: 1,
          totalCount: 2,
          manifestError: '批次生成后磁盘缺 1 镜',
          shots: [
            { index: 0, shotId: 'auto-000', prompt: 'P0', seconds: 5, status: 'done', outputPath: 'C:\\x\\0.mp4', error: null },
            { index: 1, shotId: 'auto-001', prompt: 'P1', seconds: 5, status: 'failed', outputPath: null, error: '超时' },
          ],
        },
      })),
    })
    const w = await mountDone(api)
    expect(w.vm.phase).toBe('done')
    expect(w.vm.missingShots).toHaveLength(1)
    expect(w.vm.canCompose).toBe(false)
    const el = w.find('[data-testid="fa-missing-shots"]')
    expect(el.exists()).toBe(true)
    expect(el.text()).toContain('auto-001')
    w.unmount()
  })

  it('缺镜时收口合成被前置拦下（零 IPC 调用）', async () => {
    const api = makeApi({
      autoStatus: vi.fn(async () => ({
        code: 0,
        data: {
          exists: true, taskId: 'auto-1', running: false, doneCount: 1, totalCount: 2, manifestError: null,
          shots: [
            { index: 0, shotId: 'auto-000', prompt: 'P0', seconds: 5, status: 'done', outputPath: 'x', error: null },
            { index: 1, shotId: 'auto-001', prompt: 'P1', seconds: 5, status: 'failed', outputPath: null, error: 'boom' },
          ],
        },
      })),
    })
    const w = await mountDone(api)
    await w.vm.compose()
    await flushPromises()
    expect(api.autoCompose).not.toHaveBeenCalled()
    expect(pipelineStartOrchestrated).not.toHaveBeenCalled()
    expect(w.vm.errorText).toBeTruthy()
    w.unmount()
  })

  it('合成推送回填 finalPath → 预览 + 打开文件夹/另存为；陈旧 runId 事件被守卫忽略', async () => {
    const api = makeApi()
    const w = await mountDone(api)
    await w.vm.compose()
    await flushPromises()
    expect(w.vm.composePhase).toBe('running')

    w.vm.applyComposeSnapshot({ runId: 'stale-run', status: 'completed', context: { render: { finalPath: 'C:\\x\\WRONG.mp4' } } }, true)
    expect(w.vm.finalPath).toBe('')

    const finalPath = 'C:\\tmp\\film-engineering\\auto\\auto-1\\final.mp4'
    w.vm.applyComposeSnapshot({ runId: 'run-compose-1', status: 'completed', progress: 100, context: { render: { finalPath } } }, true)
    await flushPromises()
    expect(w.vm.composePhase).toBe('done')
    expect(w.vm.finalFileUrl).toBe('file:///C:/tmp/film-engineering/auto/auto-1/final.mp4')
    expect(w.find('[data-testid="fa-final-video"]').exists()).toBe(true)
    await w.vm.openFinalFolder()
    await w.vm.saveFinalAs()
    expect(story2videoShowInFolder).toHaveBeenCalledWith(finalPath)
    expect(story2videoSaveAs).toHaveBeenCalledWith(finalPath)
    w.unmount()
  })

  it('轮询兜底：pipelineGetRunContext 亦能取回成品路径（事件丢失可收敛）', async () => {
    const api = makeApi()
    const w = await mountDone(api)
    await w.vm.compose()
    await flushPromises()
    pipelineGetRunContext.mockResolvedValueOnce({
      code: 0,
      data: { runId: 'run-compose-1', status: 'completed', progress: 100, context: { render: { finalPath: '/tmp/final.mp4' } } },
    })
    await w.vm.pollComposeRun()
    await flushPromises()
    expect(w.vm.finalPath).toBe('/tmp/final.mp4')
    expect(w.vm.composePercent).toBe(100)
    expect(w.vm.composePhase).toBe('done')
    w.unmount()
  })

  it('合成失败 → 回显错误且不产生成品路径', async () => {
    const api = makeApi()
    const w = await mountDone(api)
    await w.vm.compose()
    await flushPromises()
    w.vm.applyComposeSnapshot({ runId: 'run-compose-1', status: 'failed', error: { message: 'ffmpeg 失败' } }, true)
    await flushPromises()
    expect(w.vm.composePhase).toBe('failed')
    expect(w.vm.composeError).toContain('ffmpeg 失败')
    expect(w.vm.finalFileUrl).toBe('')
    w.unmount()
  })
})

describe('FilmAutoPanel · 方法论接入状态（F-I）', () => {
  const METHODOLOGY = {
    taskId: 'generate_shot_prompt',
    locale: 'zh',
    promptAssetHash: 'abcdef0123456789',
    totalVars: 7,
    hitVars: 5,
    deliverable: false,
    blockedVars: [{ name: 'style_prefix', reason: 'byDesign' }, { name: 'geo_block', reason: 'assetMissing' }],
    assetsIncomplete: false,
    frameConstraintPending: true,
  }

  async function previewWith (methodology) {
    const data = Object.assign({}, PLAN_DATA, { methodology })
    const api = makeApi({ autoPlan: vi.fn(async () => ({ code: 0, data: JSON.parse(JSON.stringify(data)) })) })
    const w = mountPanel(api)
    w.vm.form.script = '一场\n剧情'
    await w.vm.runPlan()
    await flushPromises()
    return w
  }

  it('预览态展示命中数、未接入变量、不可直送与尾帧待派生', async () => {
    const w = await previewWith(METHODOLOGY)
    expect(w.find('[data-testid="fa-methodology"]').exists()).toBe(true)
    expect(w.find('[data-testid="fa-methodology-hit"]').text()).toBe('5/7')
    expect(w.find('[data-testid="fa-methodology-blocked"]').text()).toContain('style_prefix')
    expect(w.find('[data-testid="fa-methodology-blocked"]').text()).toContain('geo_block')
    expect(w.find('[data-testid="fa-methodology-not-deliverable"]').exists()).toBe(true)
    expect(w.find('[data-testid="fa-methodology-frame-pending"]').exists()).toBe(true)
    w.unmount()
  })

  it('资产不完整时提示「资产不完整」', async () => {
    const w = await previewWith(Object.assign({}, METHODOLOGY, { assetsIncomplete: true }))
    expect(w.find('[data-testid="fa-methodology-assets-incomplete"]').exists()).toBe(true)
    w.unmount()
  })

  /**
   * PRD §9.b M-43：**stale 与 assetsIncomplete 不并列**。
   *
   * 为什么必须锁：两者说的**不是同一件事** ——
   *   · `assetsIncomplete` = **规划时**资产就不全（W10/W11）；
   *   · `stale` = 规划**之后**资产被换了（重开项目时重算哈希对不上）。
   * 并列显示 ⇒ 用户以为「现在既不全、又被换了」两件事同时成立 ⇒ 会去查错的方向。
   * 面板实现是 `assetsIncomplete && !stale` ⇒ 判据锁住这个互斥。
   */
  it('「资产已变」与「资产不完整」**不并列**（stale=true ⇒ 只显示「资产已变」）', async () => {
    const w = await previewWith(Object.assign({}, METHODOLOGY, { stale: true, assetsIncomplete: true }))
    expect(w.find('[data-testid="fa-methodology-stale"]').exists()).toBe(true)
    expect(w.find('[data-testid="fa-methodology-assets-incomplete"]').exists()).toBe(false)
    w.unmount()
  })

  it('没有方法论上下文时**不渲染**该分区（老 kit 兼容）', async () => {
    const w = await previewWith(undefined)
    expect(w.find('[data-testid="fa-methodology"]').exists()).toBe(false)
    w.unmount()
  })
})

// ══════════════════════════════════════════════════════════════════════════
// provider 饱和（熔断）期间的**可观测**（PRD §3.2.5.3 ⑧⑨⑩）
//
// 独立复核发现：此前 provider 状态这条链路**没有任何前端测试**（变异打不红 = 无覆盖）。
// ══════════════════════════════════════════════════════════════════════════

describe('FilmAutoPanel · provider 饱和态可见', () => {
  it('⭐ 饱和 ⇒ 面板显示「服务商繁忙 + 排队数 + 预计恢复时间」；未提交镜头显示成对文案', async () => {
    const api = makeApi({
      autoStart: vi.fn(async () => ({ code: 0, data: { started: true, doneCount: 0, totalCount: 12, renderManifest: null } })),
      autoStatus: vi.fn(async () => ({ code: 0, data: {
        exists: true, taskId: 'auto-1', running: true, doneCount: 0, totalCount: 12,
        shots: [{
          index: 0, shotId: 'auto-000', prompt: 'P0', seconds: 5, status: 'failed',
          error: '服务商繁忙，本镜未提交（恢复后可单独重生成）',
          errorCode: 'AUTO_PROVIDER_BUSY',
        }],
        providerStatus: { state: 'saturated', pending: 3, estimatedRecoveryMinutes: 2 },
      } })),
    })
    const w = mountPanel(api)
    w.vm.form.script = '第1场\n剧情'
    await w.vm.runPlan()
    w.vm.confirmed = true
    await w.vm.startRun()
    await flushPromises()

    // ① 事件路径（运行期实时）
    w.vm.applyAutoEvent({ type: 'production:provider-status', state: 'saturated', pending: 3, estimatedRecoveryMinutes: 2 })
    await flushPromises()
    expect(w.vm.providerStatus.state).toBe('saturated')
    expect(w.vm.providerStatus.pending).toBe(3)
    expect(w.vm.providerStatus.estimatedRecoveryMinutes).toBe(2)

    // ② 提示行真的渲染出来了，且带排队数与预计恢复时间
    const hint = w.find('[data-testid="fa-provider-status"]')
    expect(hint.exists()).toBe(true)
    expect(hint.text()).toContain('filmEngineering.auto.providerStatus.saturated')
    expect(hint.text()).toContain('"pending":3')
    expect(hint.text()).toContain('"minutes":2')

    // ③ 轮询路径（重开项目时可见）：auto-status 的 providerStatus 也要进面板
    await w.vm.refreshStatus()
    await flushPromises()
    expect(w.vm.providerStatus.state).toBe('saturated')

    // ④ 未提交镜头的错误列走 **errorCode + 成对文案**，不是后端中文原文
    const cells = w.findAll('td').map((td) => td.text()).join('|')
    // ⚠ 走 errorCode 查**成对译文**（而不是把后端中文原文直接渲染）
    expect(cells).toContain('译文<filmEngineering.auto.shotError.AUTO_PROVIDER_BUSY>')
    expect(cells).not.toContain('服务商繁忙，本镜未提交')
    w.unmount()
  })

  it('未饱和 ⇒ 不显示「服务商繁忙」提示', async () => {
    const api = makeApi({
      autoStart: vi.fn(async () => ({ code: 0, data: { started: true, doneCount: 0, totalCount: 12, renderManifest: null } })),
      autoStatus: vi.fn(async () => ({ code: 0, data: {
        exists: true, taskId: 'auto-1', running: true, doneCount: 0, totalCount: 12, shots: [],
        providerStatus: { state: 'normal', pending: 0, estimatedRecoveryMinutes: 0 },
      } })),
    })
    const w = mountPanel(api)
    w.vm.form.script = '第1场\n剧情'
    await w.vm.runPlan()
    w.vm.confirmed = true
    await w.vm.startRun()
    await flushPromises()
    await w.vm.refreshStatus()
    await flushPromises()
    expect(w.find('[data-testid="fa-provider-status"]').exists()).toBe(false)
    w.unmount()
  })
})
