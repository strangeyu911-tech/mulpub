import { describe, expect, it } from 'vitest'

const {
  normalizeCreateCover,
  normalizeCreateByAudio,
  normalizeCreateByTemplate,
  normalizeLivelyTemplates,
} = require('./hifly-extra')

/**
 * IPC 层形状校验的分支覆盖（change: hifly-full-api-ui）。
 *
 * 为什么单测这四个函数：`ipc-handlers/hifly-extra.js` 380 行里，绝大部分是
 * 这四个 normalize 的**校验分支**。9 个通道级用例只能走到「主路径 + 一种错法」，
 * 覆盖率自然低。而它们恰恰是**唯一在参数进主进程深处之前拦住脏数据的地方**——
 * 每条 if 都是一次拒绝理由，漏一条就意味着一种脏输入能穿过去。
 *
 * 约定：返回 null = 拒绝（走 INVALID_ARGUMENTS），返回对象 = 接受并已归一。
 */

describe('normalizeLivelyTemplates', () => {
  it('空对象合法（全部可选）', () => {
    expect(normalizeLivelyTemplates({})).toEqual({})
  })

  it('四个筛选 + 分页全部透传', () => {
    expect(normalizeLivelyTemplates({ template: 't', tag: '口播', title: '标', page: 2, size: 50, type: 1 }))
      .toEqual({ template: 't', tag: '口播', title: '标', page: 2, size: 50, type: 1 })
  })

  // 未知字段必须拒：否则前端把字段名拼错时会被静默丢掉，用户看到的「筛选没生效」无从解释
  it('未知字段 ⇒ null', () => {
    expect(normalizeLivelyTemplates({ unexpected: 1 })).toBe(null)
  })

  // 每个字符串字段的「非字符串」分支
  it.each(['template', 'tag', 'title'])('%s 非字符串 ⇒ null', (key) => {
    expect(normalizeLivelyTemplates({ [key]: 123 })).toBe(null)
  })

  it.each(['page', 'size'])('%s 非正整数 ⇒ null', (key) => {
    expect(normalizeLivelyTemplates({ [key]: 0 })).toBe(null)
    expect(normalizeLivelyTemplates({ [key]: -1 })).toBe(null)
    expect(normalizeLivelyTemplates({ [key]: 1.5 })).toBe(null)
  })

  it('type 允许 0（竖屏是默认值，不是「未传」）', () => {
    expect(normalizeLivelyTemplates({ type: 0 })).toEqual({ type: 0 })
  })

  it('type 负数 ⇒ null', () => {
    expect(normalizeLivelyTemplates({ type: -1 })).toBe(null)
  })
})

describe('normalizeCreateCover', () => {
  it('template + content 合法', () => {
    expect(normalizeCreateCover({ template: 't', content: 'x' })).toEqual({ template: 't', content: 'x' })
  })

  it('缺 template ⇒ null', () => {
    expect(normalizeCreateCover({ content: 'x' })).toBe(null)
  })

  // 官方：content 与 slots 至少一项
  it('content 与 slots 都没有 ⇒ null', () => {
    expect(normalizeCreateCover({ template: 't' })).toBe(null)
  })

  it('slots 非数组 ⇒ null', () => {
    expect(normalizeCreateCover({ template: 't', slots: 'x' })).toBe(null)
  })

  // 元素必须带字符串 value（官方 slots 结构）
  it('slots 元素缺 value ⇒ null', () => {
    expect(normalizeCreateCover({ template: 't', slots: [{ name: 'a' }] })).toBe(null)
  })

  it('slots 元素是数组 ⇒ null', () => {
    expect(normalizeCreateCover({ template: 't', slots: [[]] })).toBe(null)
  })

  it('空 slots 数组 + 无 content ⇒ null', () => {
    expect(normalizeCreateCover({ template: 't', slots: [] })).toBe(null)
  })

  it('合法 slots 透传', () => {
    const slots = [{ name: 'title', label: '标题', value: '三件事' }]
    expect(normalizeCreateCover({ template: 't', slots })).toEqual({ template: 't', slots })
  })

  it('canvasPreset / outputFormat 透传（枚举校验留给 adapter）', () => {
    expect(normalizeCreateCover({ template: 't', content: 'x', canvasPreset: '3:4', outputFormat: 'png' }))
      .toMatchObject({ canvasPreset: '3:4', outputFormat: 'png' })
  })

  it('未知字段 ⇒ null', () => {
    expect(normalizeCreateCover({ template: 't', content: 'x', foo: 1 })).toBe(null)
  })
})

describe('normalizeCreateByAudio', () => {
  it('fileId + avatar 合法', () => {
    expect(normalizeCreateByAudio({ fileId: 'f', avatar: 'a' })).toEqual({ fileId: 'f', avatar: 'a' })
  })

  it('audioUrl + videoFileId 合法（另一条驱动路径）', () => {
    expect(normalizeCreateByAudio({ audioUrl: 'https://x/a.mp3', videoFileId: 'vf' }))
      .toEqual({ audioUrl: 'https://x/a.mp3', videoFileId: 'vf' })
  })

  // 官方：audio_url 与 file_id 二选一
  it('audioUrl 与 fileId 都缺 ⇒ null', () => {
    expect(normalizeCreateByAudio({ avatar: 'a' })).toBe(null)
  })

  // 官方：avatar 与 video_file_id 至少一个
  it('avatar 与 videoFileId 都缺 ⇒ null', () => {
    expect(normalizeCreateByAudio({ fileId: 'f' })).toBe(null)
  })

  it('title 超 20 字 ⇒ null', () => {
    expect(normalizeCreateByAudio({ fileId: 'f', avatar: 'a', title: '一'.repeat(21) })).toBe(null)
  })

  it('aigcFlag 非整数 ⇒ null', () => {
    expect(normalizeCreateByAudio({ fileId: 'f', avatar: 'a', aigcFlag: 1.5 })).toBe(null)
  })

  it('aigcFlag 可接受 0（跟随个人中心设置）', () => {
    expect(normalizeCreateByAudio({ fileId: 'f', avatar: 'a', aigcFlag: 0 })).toMatchObject({ aigcFlag: 0 })
  })

  it('videoStartMsec 负数 ⇒ null', () => {
    expect(normalizeCreateByAudio({ fileId: 'f', avatar: 'a', videoStartMsec: -1 })).toBe(null)
  })

  it('未知字段 ⇒ null', () => {
    expect(normalizeCreateByAudio({ fileId: 'f', avatar: 'a', extra: 1 })).toBe(null)
  })
})

describe('normalizeCreateByTemplate', () => {
  const base = { voice: 'v', avatar: 'a', text: 'x', template: 't' }

  it('三要素齐全 ⇒ 合法', () => {
    expect(normalizeCreateByTemplate(base)).toMatchObject({ voice: 'v', avatar: 'a', text: 'x', template: 't' })
  })

  // 官方：video_file_id 可替代 voice 与 avatar
  it('只给 videoFileId + text + template ⇒ 合法', () => {
    expect(normalizeCreateByTemplate({ videoFileId: 'vf', text: 'x', template: 't' }))
      .toMatchObject({ videoFileId: 'vf' })
  })

  it('缺 template ⇒ null', () => {
    expect(normalizeCreateByTemplate({ voice: 'v', avatar: 'a', text: 'x' })).toBe(null)
  })

  it('缺 text ⇒ null', () => {
    expect(normalizeCreateByTemplate({ voice: 'v', avatar: 'a', template: 't' })).toBe(null)
  })

  // 联合约束：没有 videoFileId 时 voice 与 avatar 都必填
  it('缺 videoFileId 且缺 voice ⇒ null', () => {
    expect(normalizeCreateByTemplate({ avatar: 'a', text: 'x', template: 't' })).toBe(null)
  })

  it('缺 videoFileId 且缺 avatar ⇒ null', () => {
    expect(normalizeCreateByTemplate({ voice: 'v', text: 'x', template: 't' })).toBe(null)
  })

  it('text 超 10000 字 ⇒ null', () => {
    expect(normalizeCreateByTemplate({ ...base, text: '一'.repeat(10001) })).toBe(null)
  })

  // 三个可选 file_id 的透传与长度上限
  it.each(['bgmFileId', 'ambienceFileId', 'coverFileId'])('%s 透传', (key) => {
    expect(normalizeCreateByTemplate({ ...base, [key]: 'id' })).toMatchObject({ [key]: 'id' })
  })

  // 四个响度参数的数值归一（字符串也要能收）
  it.each(['normLufs', 'bgmNormLufs', 'audioAssetsNormLufs', 'ambienceNormLufs'])(
    '%s 接受数字与数字字符串', (key) => {
      expect(normalizeCreateByTemplate({ ...base, [key]: 12 })).toMatchObject({ [key]: 12 })
      expect(normalizeCreateByTemplate({ ...base, [key]: '12.5' })).toMatchObject({ [key]: 12.5 })
    },
  )

  it.each(['normLufs', 'bgmNormLufs'])('%s 非数值 ⇒ null', (key) => {
    expect(normalizeCreateByTemplate({ ...base, [key]: 'abc' })).toBe(null)
  })

  it('aigcFlag 透传', () => {
    expect(normalizeCreateByTemplate({ ...base, aigcFlag: 2 })).toMatchObject({ aigcFlag: 2 })
  })

  it('未知字段 ⇒ null', () => {
    expect(normalizeCreateByTemplate({ ...base, foo: 1 })).toBe(null)
  })

  // 空字符串的可选字段不应进入 payload（否则服务端收到空 id）
  it('可选字段传空串 ⇒ 不进 payload', () => {
    const r = normalizeCreateByTemplate({ ...base, title: '', bgmFileId: '' })
    expect(r.title).toBeUndefined()
    expect(r.bgmFileId).toBeUndefined()
  })
})
