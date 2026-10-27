/**
 * 视频创作流水线 E2E 冒烟清单（单一真源）。
 *
 * 约束：
 * - 每条带 stageDefs 的流水线必须且只能登记一次；
 * - driver 相对 apps/desktop；null 表示尚无 E2E 驱动；
 * - defaultParams 只用于推导模型能力（resolvePipelineModelRequirements），不代表真实执行参数；
 * - inputs 相对 E2E_INPUTS（默认 <tmp>/story2video/e2e-inputs）。
 */

function deepFreeze (value) {
  if (value && typeof value === 'object' && !Object.isFrozen(value)) {
    Object.getOwnPropertyNames(value).forEach((key) => deepFreeze(value[key]))
    Object.freeze(value)
  }
  return value
}

const PIPELINE_SMOKE_MANIFEST = deepFreeze([
  {
    pipeline: 'animated-explainer',
    driver: 'tests/e2e/animated-explainer-cdp.js',
    driverMode: 'single',
    defaultParams: { text: '春眠不觉晓，处处闻啼鸟。', inputMode: 'text' },
    inputs: [],
    requiredTools: ['ffmpeg', 'ffprobe'],
    expectedArtifact: 'video',
    timeoutSec: 1800,
    costTier: 'medium',
    notes: 'LLM 规划 + 图片素材 + FFmpeg 合成；需默认 LLM/图片 provider。',
  },
  {
    pipeline: 'talking-head',
    driver: 'builtin:local-executor',
    driverMode: 'builtin',
    defaultParams: { video: 'talkinghead-source.mp4' },
    inputs: [{ key: 'video', file: 'talkinghead-source.mp4', description: '出镜口播源视频' }],
    requiredTools: ['ffmpeg', 'ffprobe'],
    expectedArtifact: 'video',
    timeoutSec: 1200,
    costTier: 'low',
    notes: '纯本地转写/字幕/渲染；由 pipeline-smoke execute.js 真跑（无需 provider）。',
  },
  {
    pipeline: 'cinematic',
    driver: 'tests/e2e/pipeline-options-matrix.js',
    driverMode: 'shared',
    defaultParams: { video: 'cinematic-source.mp4', resolution: '720x1280' },
    inputs: [{ key: 'video', file: 'cinematic-source.mp4', description: '电影感调色源视频' }],
    requiredTools: ['ffmpeg', 'ffprobe'],
    expectedArtifact: 'video',
    timeoutSec: 900,
    costTier: 'medium',
    notes: '共享驱动一次覆盖多条流水线；单条参数化入口见后续增量。',
  },
  {
    pipeline: 'animation',
    driver: null,
    driverMode: 'missing',
    defaultParams: { text: '机器人城市行走' },
    inputs: [],
    requiredTools: ['ffmpeg', 'ffprobe'],
    expectedArtifact: 'video',
    timeoutSec: 1800,
    costTier: 'high',
    notes: 'LLM 概念/分镜 + 视频模型生成；尚无单条 E2E 驱动。',
  },
  {
    pipeline: 'avatar-spokesperson',
    driver: 'tests/e2e/video-model-pipelines.js',
    driverMode: 'shared',
    defaultParams: { text: '数字人主播欢迎光临' },
    inputs: [],
    requiredTools: ['ffmpeg', 'ffprobe'],
    expectedArtifact: 'video',
    timeoutSec: 1800,
    costTier: 'high',
    notes: '另需 avatarId/voiceId 与 HeyGen 或等价数字人 provider；见 pipeline-model-preflight 专项校验。',
  },
  {
    pipeline: 'character-animation',
    driver: 'tests/e2e/video-model-pipelines.js',
    driverMode: 'shared',
    defaultParams: { text: '机器人城市行走' },
    inputs: [],
    requiredTools: ['ffmpeg', 'ffprobe'],
    expectedArtifact: 'video',
    timeoutSec: 1800,
    costTier: 'high',
    notes: 'LLM 概念/分镜 + 视频模型生成；共享驱动。',
  },
  {
    pipeline: 'clip-factory',
    driver: 'tests/e2e/pipeline-options-matrix.js',
    driverMode: 'shared',
    defaultParams: { video: 'clipfactory-long.mp4', sceneThreshold: 0.3 },
    inputs: [{ key: 'video', file: 'clipfactory-long.mp4', description: '长视频切片源' }],
    requiredTools: ['ffmpeg', 'ffprobe'],
    expectedArtifact: 'video',
    timeoutSec: 900,
    costTier: 'low',
    notes: '纯本地切片/字幕/导出；共享驱动。',
  },
  {
    pipeline: 'documentary-montage',
    driver: null,
    driverMode: 'missing',
    defaultParams: { topic: '城市清晨' },
    inputs: [],
    requiredTools: ['ffmpeg', 'ffprobe'],
    expectedArtifact: 'video',
    timeoutSec: 1800,
    costTier: 'medium',
    notes: 'LLM 研究/素材 + 图片 + 旁白 + 合成；尚无单条 E2E 驱动。',
  },
  {
    pipeline: 'hybrid',
    driver: null,
    driverMode: 'missing',
    defaultParams: { text: '城市清晨的第一班地铁' },
    inputs: [],
    requiredTools: ['ffmpeg', 'ffprobe'],
    expectedArtifact: 'video',
    timeoutSec: 1800,
    costTier: 'high',
    notes: 'LLM 剧本 + 视频模型 + 合成；尚无单条 E2E 驱动。',
  },
  {
    pipeline: 'localization-dub',
    driver: 'tests/e2e/pipeline-options-matrix.js',
    driverMode: 'shared',
    defaultParams: { video: 'localization-source.mp4', text: '大家好。测试台词。', targetLanguage: 'en' },
    inputs: [{ key: 'video', file: 'localization-source.mp4', description: '待译制源视频' }],
    requiredTools: ['ffmpeg', 'ffprobe'],
    expectedArtifact: 'video',
    timeoutSec: 1200,
    costTier: 'medium',
    notes: 'LLM 翻译；显式 voiceProvider 时再要求 TTS；共享驱动。',
  },
  {
    pipeline: 'podcast-repurpose',
    driver: null,
    driverMode: 'missing',
    defaultParams: { transcript: '这是一段用于冒烟的播客转写文本。' },
    inputs: [{ key: 'audio', file: 'podcast-source.mp3', description: '播客音频源' }],
    requiredTools: ['ffmpeg', 'ffprobe'],
    expectedArtifact: 'video',
    timeoutSec: 1200,
    costTier: 'low',
    notes: '图片可视化 + 音频组装；无 transcript 时还要语音识别；尚无单条 E2E 驱动。',
  },
  {
    pipeline: 'framework-smoke',
    driver: 'builtin:framework-smoke',
    driverMode: 'builtin',
    defaultParams: {},
    inputs: [],
    requiredTools: ['ffmpeg', 'ffprobe'],
    expectedArtifact: 'video',
    timeoutSec: 120,
    costTier: 'low',
    notes: '应用内「框架冒烟」流水线：验证 ffmpeg/ffprobe + 生成 testsrc 视频。',
  },
  {
    pipeline: 'film-engineering',
    driver: 'tests/e2e/film-engineering-real.test.js',
    driverMode: 'single',
    defaultParams: {},
    inputs: [],
    requiredTools: ['ffmpeg', 'ffprobe'],
    expectedArtifact: 'video',
    timeoutSec: 1800,
    costTier: 'high',
    notes: '电影工程模板/分镜/视频/渲染；llmEnabled 默认关。',
  },
  {
    pipeline: 'story2video-compose',
    driver: 'tests/e2e/pipeline-options-matrix.js',
    driverMode: 'shared',
    defaultParams: {
      text: '春眠不觉晓，处处闻啼鸟。夜来风雨声，花落知多少。',
      imageStyle: 'cinematic',
      resolution: '720x1280',
      fps: 30,
      videoMode: 'fixed',
    },
    inputs: [],
    requiredTools: ['ffmpeg', 'ffprobe'],
    expectedArtifact: 'video',
    timeoutSec: 1800,
    costTier: 'high',
    notes: '图片恒必需；videoMode=fixed/ai-judged 时 +video，ai-judged 时 +llm；共享驱动。',
  },
])

const PIPELINE_SMOKE_EXCLUDED = deepFreeze([
  {
    pipeline: 'screen-demo',
    reason: 'NO_STAGE_DEFS_PLACEHOLDER',
    notes: 'PIPELINES 中注册但无 stageDefs，显式 available=false；不属于冒烟范围。',
  },
])

module.exports = { PIPELINE_SMOKE_MANIFEST, PIPELINE_SMOKE_EXCLUDED }
