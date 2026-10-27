// @ts-check
'use strict'
/**
 * 视频出片「音轨产出方式」能力表的能力锁。
 *
 * 锁的三类：
 *   ① **域锁**：表覆盖的 provider 集合必须**等于**实测 `supports('generateVideo') === true` 的集合
 *      （⇒ 漏列/多列都红；⇒ 「域」不靠人工名单钉住）；
 *   ② **三态锁**：`implicit` / `explicit` / `unknown` 三态各有各的字段形状，
 *      且「未实测」必须与「不支持」可区分（⇒ 探测函数返回结构化对象，不是布尔）；
 *   ③ **域边界锁**：仓内的 TTS / 音乐 / 语音识别适配器**不得**混进本表
 *      （本表的域是「视频适配器的音轨产出方式」，不是「仓里有没有 TTS」）。
 */
const fs = require('fs')
const path = require('path')

const { BaseAdapter } = require('../adapters/_base/base.js')
const {
  AUDIO_MODE,
  AUDIO_SOURCE,
  VIDEO_AUDIO_CAPABILITY_BY_PROVIDER,
  UNKNOWN_AUDIO_CAPABILITY,
  resolveVideoAudioCapability,
  isVideoModelProducedAudio,
  listVideoAudioCapabilityProviders,
  listVerifiedVideoAudioProviders,
} = require('./video-audio-inputs')

const SERVICES_DIR = path.resolve(__dirname, '..')
const MANAGER_PATH = path.join(SERVICES_DIR, 'model-provider-manager.js')

/** 实测：哪些 provider 真正支持 `generateVideo`（权威判据，不靠人工名单） */
function measureVideoProviders () {
  const src = fs.readFileSync(MANAGER_PATH, 'utf8')
  const re = /^\s*(?:'([^']+)'|([A-Za-z0-9_]+)):\s*require\('\.\/adapters\/([^']+)'\)\.([A-Za-z0-9_]+),/gm
  const ids = []
  let m
  while ((m = re.exec(src)) !== null) {
    const id = m[1] || m[2]
    let AdapterClass
    try {
      AdapterClass = require(path.join(SERVICES_DIR, 'adapters', m[3] + '.js'))[m[4]]
    } catch (e) {
      continue
    }
    if (typeof AdapterClass !== 'function') continue
    let instance
    try {
      instance = new AdapterClass({})
    } catch (e) {
      continue
    }
    const impl = instance.generateVideo
    const baseImpl = BaseAdapter.prototype.generateVideo
    if (typeof impl === 'function' && impl !== baseImpl) ids.push(id)
  }
  return ids.sort()
}

describe('video-audio-inputs · 音轨产出方式能力表', () => {
  describe('① 域锁：表覆盖范围必须等于实测的视频 provider 集合', () => {
    it('表内 provider 集合 == 实测 supports("generateVideo") 的集合（双向、无漏无多）', () => {
      const measured = measureVideoProviders()
      const listed = listVideoAudioCapabilityProviders().slice().sort()
      expect(measured.length).toBeGreaterThan(0)
      expect(listed).toEqual(measured)
    })

    it('域是「视频适配器的音轨产出方式」⇒ TTS/音乐/语音识别适配器不得混进本表', () => {
      const listed = listVideoAudioCapabilityProviders()
      const mustNotAppear = [
        'openai-tts', 'doubao-tts', 'google-tts', 'mimo-tts', 'minimax-tts',
        'elevenlabs', 'piper', 'suno', 'musicgen', 'pixabay-music', 'freesound',
        'local-whisper', 'openai-whisper', 'whisper', 'google-stt', 'doubao-stt', 'baidu-stt',
      ]
      for (const id of mustNotAppear) {
        expect(listed).not.toContain(id)
      }
    })

    it('⚠ 注册表里「视频生成 (14)」那段注释的数字不可信 ⇒ 域以本表为准', () => {
      // 实测 15 个（注册表该段实为 16 条目，其中 hifly 是数字人类、不支持 generateVideo）
      // ⇒ 注释里的「(14)」若被当成真源，域就会漂 ⇒ 本锁把真源钉在 supports() 上。
      expect(measureVideoProviders().length).toBe(15)
      expect(listVideoAudioCapabilityProviders()).toContain('heygen')
    })
  })

  describe('② 三态锁：implicit / explicit / unknown 三态各有形状', () => {
    it('explicit：heygen（数字人视频，音轨由 voice + script 驱动）', () => {
      const cap = resolveVideoAudioCapability('heygen')
      expect(cap.mode).toBe(AUDIO_MODE.EXPLICIT)
      expect(cap.audioParam).toBe('voice')
      expect(cap.audioSource).toBe(AUDIO_SOURCE.TTS)
      expect(cap.verified).toBe(true)
      expect(typeof cap.evidence).toBe('string')
      expect(cap.evidence.length).toBeGreaterThan(0)
    })

    it('implicit：agnes-multimodal（M0-F1 实测 51/51 产物带 aac 音轨）', () => {
      const cap = resolveVideoAudioCapability('agnes-multimodal')
      expect(cap.mode).toBe(AUDIO_MODE.IMPLICIT)
      expect(cap.audioSource).toBe(AUDIO_SOURCE.MODEL)
      expect(cap.verified).toBe(true)
    })

    it('⛔ agnes-multimodal 的 params.audios 是 reference 参考音频（输入素材）⇒ 不得填进 audioParam', () => {
      // 填进去 ⇒ 等于宣称「传 3 段参考音频就能开对白」⇒ 那是假的（源码里没有这个开关）
      expect(resolveVideoAudioCapability('agnes-multimodal').audioParam).toBeNull()
    })

    it('unknown：其余 provider 一律「未实测」⇒ 既不承诺也不否认', () => {
      const listed = listVideoAudioCapabilityProviders()
      const unknownIds = listed.filter((id) => resolveVideoAudioCapability(id).mode === AUDIO_MODE.UNKNOWN)
      expect(unknownIds.length).toBe(listed.length - 2)
      for (const id of unknownIds) {
        const cap = resolveVideoAudioCapability(id)
        expect(cap.mode).toBe(AUDIO_MODE.UNKNOWN)
        expect(cap.audioParam).toBeNull()
        expect(cap.audioSource).toBeNull()
        expect(cap.verified).toBe(false)
      }
    })

    it('「有 TTS 能力」不等于「视频出片有音轨」⇒ minimax-multimodal 仍判 unknown', () => {
      // minimax-multimodal 有 synthesize/listVoices/cloneVoice（TTS）
      // 但它的 generateVideo 转发给 minimax.js（载荷无音轨字段）⇒ 不得进 explicit
      expect(resolveVideoAudioCapability('minimax-multimodal').mode).toBe(AUDIO_MODE.UNKNOWN)
    })

    it('表里恰好 1 条 explicit（heygen）—— 防止把「未实测」误写成「不支持」或反之', () => {
      const explicitIds = listVideoAudioCapabilityProviders()
        .filter((id) => resolveVideoAudioCapability(id).mode === AUDIO_MODE.EXPLICIT)
      expect(explicitIds).toEqual(['heygen'])
    })
  })

  describe('② 探测函数：返回结构化对象，「未实测」与「不支持」可区分', () => {
    it('未列入的 provider ⇒ unknown（不是「不支持」）', () => {
      for (const id of ['never-heard-of-provider', '', 'hifly', 'comfyui']) {
        const cap = resolveVideoAudioCapability(id)
        expect(cap.mode).toBe(AUDIO_MODE.UNKNOWN)
        expect(cap.verified).toBe(false)
      }
    })

    it('非字符串入参（null / 数字 / 对象）⇒ 同样返回 unknown，不抛异常', () => {
      for (const id of [null, undefined, 123, {}, [], true]) {
        expect(resolveVideoAudioCapability(id).mode).toBe(AUDIO_MODE.UNKNOWN)
      }
    })

    it('isVideoModelProducedAudio：未实测 ⇒ null（未知），不是 false（不满足）', () => {
      expect(isVideoModelProducedAudio('agnes-multimodal')).toBe(true)
      expect(isVideoModelProducedAudio('heygen')).toBe(false)
      expect(isVideoModelProducedAudio('never-heard-of-provider')).toBeNull()
      expect(isVideoModelProducedAudio('seedance')).toBeNull()
    })

    it('未实测条目共享同一对象引用 ⇒ 「哪些是未实测」可机械判', () => {
      expect(resolveVideoAudioCapability('seedance')).toBe(UNKNOWN_AUDIO_CAPABILITY)
      expect(resolveVideoAudioCapability('wan')).toBe(UNKNOWN_AUDIO_CAPABILITY)
      expect(resolveVideoAudioCapability('hunyuan')).toBe(UNKNOWN_AUDIO_CAPABILITY)
    })

    it('已实测条目与未实测条目**不是**同一引用（⇒ 共享常量没被误用）', () => {
      expect(resolveVideoAudioCapability('heygen')).not.toBe(UNKNOWN_AUDIO_CAPABILITY)
      expect(resolveVideoAudioCapability('agnes-multimodal')).not.toBe(UNKNOWN_AUDIO_CAPABILITY)
    })

    it('listVerifiedVideoAudioProviders 只列有实测支撑的（未实测绝不会被当成「已验证」）', () => {
      expect(listVerifiedVideoAudioProviders().slice().sort()).toEqual(['agnes-multimodal', 'heygen'])
    })

    it('表条目被 Object.freeze ⇒ 外部改不动（防误改污染全部 unknown 条目）', () => {
      expect(Object.isFrozen(VIDEO_AUDIO_CAPABILITY_BY_PROVIDER)).toBe(true)
      expect(Object.isFrozen(UNKNOWN_AUDIO_CAPABILITY)).toBe(true)
      expect(Object.isFrozen(VIDEO_AUDIO_CAPABILITY_BY_PROVIDER.heygen)).toBe(true)
    })
  })
})
