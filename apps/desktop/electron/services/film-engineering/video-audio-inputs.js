/**
 * providerId → 视频出片的「音轨产出方式」能力表（**三态**，不是二态）。
 *
 * 为什么要三态（这是本模块存在的理由，不是设计洁癖）：
 *   - `implicit` 音轨由**视频模型自己**产出，**没有显式开关**（对白/声音交给模型）；
 *   - `explicit` 有**显式**音轨参数（例：数字人服务商要传音色 + 脚本文本）；
 *   - `unknown` **未实测** ⇒ 既不承诺也不否认。
 * ⛔ `unknown` 与「不支持」**必须可区分** ⇒ 探测函数**不能只返回布尔**（否则两者同形），
 *   而「列入即承诺行为」⇒ 列入必须有实测证据。
 *
 * 域（务必先读）：**本表是「视频适配器的音轨产出方式」**，不是「仓里有没有 TTS」。
 * ⇒ 仓内的 `doubao-tts` / `elevenlabs` / `mimo-tts` / `minimax-tts` / `google-tts` /
 *   `openai-tts` / `suno` / `musicgen` / `pixabay-music` / `freesound` / `local-whisper` …
 *   **全部不属于本表**（那是独立的语音/音乐能力，不是「视频出片时的音轨从哪来」）。
 * ⇒ `minimax-multimodal` 命中了 `synthesize` / `listVoices`，但那是它的 **TTS 能力**；
 *   它的 `generateVideo` 转发给 `minimax.js`（载荷无任何音轨字段）⇒ 仍判 `unknown`。
 *
 * 逐 provider 的实测结论（2026-10-27，读适配器源码 + M0 取证）：
 *   - `heygen`           `explicit` —— `generateVideo` 是**数字人视频**，`params.voice`（音色）与
 *                         `params.script`（脚本文本）**都是必填**，音轨由数字人 TTS 驱动。
 *                         ⚠ `audioSource: 'tts'` ⇒ **不满足**「音轨交给视频模型」的前提
 *                         （本仓前提见 PRD §3.2.5.x）⇒ 规划期若选它，音轨来源要另行说明。
 *   - `agnes-multimodal` `implicit` —— M0-F1 实测 **51/51** 产物带 `aac` 音轨
 *                         （LC / 32000Hz / stereo）⇒ 模型随视频产出音轨，**无需显式参数**。
 *                         ⛔ `params.audios`（≤3）是 **reference 模式的参考音频 URL 列表**（输入素材），
 *                           **不是**生成对白的开关 ⇒ 不得填进 `audioParam`。
 *   - 其余 13 个        `unknown` —— 逐个 grep `audio|voice|dialogue|sound|speech|music` 无命中
 *                         （`minimax` / `minimax-multimodal` 的 `generateVideo` 载荷为
 *                         `model/prompt/duration/resolution/first_frame_image/prompt_optimizer`，
 *                         无音轨字段）⇒ **未实测** ⇒ ⛔ 不得写成「不支持」。
 *
 * 域的权威判据（`supports('generateVideo') === true`，见 `adapters/_base/base.js`）：
 *   `KNOWN_METHODS` 含该方法 **且** 实例的 `generateVideo` **不等于** `BaseAdapter.prototype.generateVideo`
 *   ⇒ 只「提及」不算，只「继承基类默认实现」也不算。
 *   ⚠ 注册表 `model-provider-manager.js` 里「视频生成 (14)」那段注释的**数字也不准**（实为 16 条目，
 *     其中 `hifly` 是数字人类、不支持 `generateVideo`）⇒ **以本表为准，不要以注释为准**。
 */

/** 音轨产出方式的三态 */
const AUDIO_MODE = Object.freeze({
  /** 视频模型自己产出音轨（无显式开关） */
  IMPLICIT: 'implicit',
  /** 有显式音轨参数 */
  EXPLICIT: 'explicit',
  /** 未实测 —— 既不承诺也不否认 */
  UNKNOWN: 'unknown',
})

/**
 * 音轨的**来源类别**（`mode` 之外的第二个维度）：
 *   - `model` 音轨来自视频模型本身（满足「音轨交给视频模型」前提）；
 *   - `tts`   音轨由独立 TTS / 数字人驱动（**不满足**该前提）；
 *   - `null`  未实测 ⇒ 未知。
 */
const AUDIO_SOURCE = Object.freeze({
  MODEL: 'model',
  TTS: 'tts',
})

/**
 * 未实测条目的**共享常量**。
 * ⚠ 必须是**同一个对象引用**（`Object.freeze` 的共享实例）⇒
 *   这样「表里哪些是未实测」可以用**引用相等**判（而不是比字段值）。
 * ⚠ 共享同一对象 ⇒ 外部误改一个条目会污染全部 ⇒ 故 `Object.freeze`。
 * ⚠ **必须定义在映射表之前**（`const` 的 TDZ）⇒ 否则模块加载即抛 `ReferenceError`。
 */
const UNKNOWN_AUDIO_CAPABILITY = Object.freeze({
  mode: AUDIO_MODE.UNKNOWN,
  audioParam: null,
  audioSource: null,
  verified: false,
  evidence: '未实测：读适配器源码未见音轨参数（逐个 grep audio|voice|dialogue|sound|speech|music），但产物未验证 ⇒ 既不承诺也不否认',
})

/**
 * providerId → 音轨能力条目。
 * 形如 `{ mode, audioParam, audioSource, verified, evidence }`：
 *   - `mode`       三态之一（`AUDIO_MODE`）；
 *   - `audioParam` 显式音轨参数的**字段名**（无则 `null`）；
 *   - `audioSource` 音轨来源（`AUDIO_SOURCE.MODEL` / `.TTS` / `null`）；
 *   - `verified`   是否有**实测**支撑（`false` ⇒ 只是读源码的推断）；
 *   - `evidence`   证据出处（可追溯到具体实测或源码位置）。
 */
const VIDEO_AUDIO_CAPABILITY_BY_PROVIDER = Object.freeze({
  // ─── explicit：有显式音轨参数 ───────────────────────────────
  heygen: Object.freeze({
    mode: AUDIO_MODE.EXPLICIT,
    audioParam: 'voice',
    audioSource: AUDIO_SOURCE.TTS,
    verified: true,
    evidence: 'adapters/heygen.js 的 generateVideo：params.character / params.voice / params.script 三者必填；音轨 = voice{type:text, input_text:script, voice_id:voice}（数字人 TTS）',
  }),

  // ─── implicit：模型随视频产出音轨 ───────────────────────────
  'agnes-multimodal': Object.freeze({
    mode: AUDIO_MODE.IMPLICIT,
    audioParam: null,
    audioSource: AUDIO_SOURCE.MODEL,
    verified: true,
    evidence: 'M0 取证 F-1：51/51 产物带 aac 音轨（LC / 32000Hz / stereo）；⛔ params.audios（≤3）是 reference 模式参考音频 URL（输入素材），不是生成对白的开关',
  }),

  // ─── unknown：未实测（逐个读源码：无音轨参数，但产物未验证）──
  hunyuan: UNKNOWN_AUDIO_CAPABILITY,
  cogvideo: UNKNOWN_AUDIO_CAPABILITY,
  'grok-video': UNKNOWN_AUDIO_CAPABILITY,
  kling: UNKNOWN_AUDIO_CAPABILITY,
  runway: UNKNOWN_AUDIO_CAPABILITY,
  veo: UNKNOWN_AUDIO_CAPABILITY,
  wan: UNKNOWN_AUDIO_CAPABILITY,
  minimax: UNKNOWN_AUDIO_CAPABILITY,
  'minimax-multimodal': UNKNOWN_AUDIO_CAPABILITY,
  ltx: UNKNOWN_AUDIO_CAPABILITY,
  seedance: UNKNOWN_AUDIO_CAPABILITY,
  higgsfield: UNKNOWN_AUDIO_CAPABILITY,
  'agnes-video': UNKNOWN_AUDIO_CAPABILITY,
})

/**
 * 查某 provider 的音轨能力。
 * ⛔ **返回结构化对象，不返回布尔** —— 「未实测」与「不支持」必须可区分。
 * ⛔ **未列入表中的 provider 一律返回 `unknown`**，**不是**「不支持」。
 * @param {unknown} providerId
 * @returns {typeof UNKNOWN_AUDIO_CAPABILITY}
 */
function resolveVideoAudioCapability (providerId) {
  if (typeof providerId === 'string' && Object.prototype.hasOwnProperty.call(VIDEO_AUDIO_CAPABILITY_BY_PROVIDER, providerId)) {
    return VIDEO_AUDIO_CAPABILITY_BY_PROVIDER[providerId]
  }
  return UNKNOWN_AUDIO_CAPABILITY
}

/**
 * 该 provider 的音轨是否**由视频模型自己产出**（满足「音轨交给视频模型」前提）。
 * ⚠ 未实测 ⇒ 返回 `null`（未知）⇒ **不是 `false`**（「未知」≠「不满足」）。
 * @param {unknown} providerId
 * @returns {boolean|null}
 */
function isVideoModelProducedAudio (providerId) {
  const cap = resolveVideoAudioCapability(providerId)
  if (cap.mode === AUDIO_MODE.UNKNOWN) return null
  return cap.audioSource === AUDIO_SOURCE.MODEL
}

/**
 * 列出表里**全部** provider id（按表序）。
 * ⚠ 刻意包含 `unknown` 的那些 ⇒ 「表覆盖了哪些 provider」是**可枚举**的，
 *   否则「漏列」与「未实测」会同形（前者是缺陷、后者是事实）。
 * @returns {string[]}
 */
function listVideoAudioCapabilityProviders () {
  return Object.keys(VIDEO_AUDIO_CAPABILITY_BY_PROVIDER)
}

/**
 * 只列出「**有实测支撑**」的条目（`verified === true`）⇒
 * 规划期若只信实测证据，用这个；⚠ **未实测的绝不能被当成「不支持」**。
 * @returns {string[]}
 */
function listVerifiedVideoAudioProviders () {
  return Object.keys(VIDEO_AUDIO_CAPABILITY_BY_PROVIDER)
    .filter((id) => VIDEO_AUDIO_CAPABILITY_BY_PROVIDER[id].verified === true)
}

module.exports = {
  AUDIO_MODE,
  AUDIO_SOURCE,
  VIDEO_AUDIO_CAPABILITY_BY_PROVIDER,
  UNKNOWN_AUDIO_CAPABILITY,
  resolveVideoAudioCapability,
  isVideoModelProducedAudio,
  listVideoAudioCapabilityProviders,
  listVerifiedVideoAudioProviders,
}
