import { describe, expect, it } from 'vitest'

const {
  normalizeCoverStyles,
  normalizeDeleteWork,
  normalizeTranslate,
  normalizeCreateBySing,
  normalizeCreateByImage,
  normalizeAudioTts,
} = require('./hifly-extra')

/**
 * 其余 6 个 normalize 的分支覆盖（change: hifly-full-api-ui）。
 *
 * 与 hifly-extra.normalize.test.js 分文件：那份覆盖「参数多、分支密」的四个
 * （cover / audio / template / livelyTemplates）；这份覆盖剩下 6 个「参数少、
 * 但同样每条 if 都是一次拒绝理由」的。
 *
 * 为什么这次才发现要补：`ipc-handlers/hifly-extra.js` 的 functions 覆盖率一度只有
 * 27.27%——因为 11 个 normalize 里只导出了 4 个，剩下 6 个函数**从来没有被任何
 * 测试调用过**。不是测了没盖到，是根本没入口。
 */

describe('normalizeCoverStyles', () => {
  it('空对象合法（分页全可选）', () => {
    expect(normalizeCoverStyles({})).toEqual({})
  })

  it('分页透传', () => {
    expect(normalizeCoverStyles({ page: 2, size: 30 })).toEqual({ page: 2, size: 30 })
  })

  it('未知字段 ⇒ null', () => {
    expect(normalizeCoverStyles({ hiflyId: 'x' })).toBe(null)
  })

  it.each(['page', 'size'])('%s 非正整数 ⇒ null', (k) => {
    expect(normalizeCoverStyles({ [k]: 0 })).toBe(null)
    expect(normalizeCoverStyles({ [k]: 1.5 })).toBe(null)
  })
})

describe('normalizeDeleteWork', () => {
  it('taskId 透传', () => {
    expect(normalizeDeleteWork({ taskId: 'task-1' })).toEqual({ taskId: 'task-1' })
  })

  it('taskId 前后空白被 trim', () => {
    expect(normalizeDeleteWork({ taskId: '  task-1  ' }).taskId).toBe('task-1')
  })

  it('缺 taskId ⇒ null', () => {
    expect(normalizeDeleteWork({})).toBe(null)
  })

  it('taskId 空白串 ⇒ null', () => {
    expect(normalizeDeleteWork({ taskId: '   ' })).toBe(null)
  })

  it('taskId 非字符串 ⇒ null', () => {
    expect(normalizeDeleteWork({ taskId: 123 })).toBe(null)
  })

  it('未知字段 ⇒ null', () => {
    expect(normalizeDeleteWork({ taskId: 't', foo: 1 })).toBe(null)
  })
})

describe('normalizeTranslate', () => {
  it('两个必填齐全 ⇒ 合法', () => {
    expect(normalizeTranslate({ videoFileId: 'vf', targetLanguageCode: 'en' }))
      .toEqual({ videoFileId: 'vf', targetLanguageCode: 'en' })
  })

  it('缺 videoFileId ⇒ null', () => {
    expect(normalizeTranslate({ targetLanguageCode: 'en' })).toBe(null)
  })

  it('缺 targetLanguageCode ⇒ null', () => {
    expect(normalizeTranslate({ videoFileId: 'vf' })).toBe(null)
  })

  it('targetLanguageCode 超 20 字符 ⇒ null', () => {
    expect(normalizeTranslate({ videoFileId: 'vf', targetLanguageCode: 'a'.repeat(21) })).toBe(null)
  })

  it('未知字段 ⇒ null', () => {
    expect(normalizeTranslate({ videoFileId: 'vf', targetLanguageCode: 'en', x: 1 })).toBe(null)
  })
})

describe('normalizeCreateBySing', () => {
  it('两个 file_id 齐全 ⇒ 合法', () => {
    expect(normalizeCreateBySing({ imageFileId: 'i', audioFileId: 'a' }))
      .toEqual({ imageFileId: 'i', audioFileId: 'a' })
  })

  it('缺 imageFileId ⇒ null', () => {
    expect(normalizeCreateBySing({ audioFileId: 'a' })).toBe(null)
  })

  it('缺 audioFileId ⇒ null', () => {
    expect(normalizeCreateBySing({ imageFileId: 'i' })).toBe(null)
  })

  it('未知字段 ⇒ null', () => {
    expect(normalizeCreateBySing({ imageFileId: 'i', audioFileId: 'a', t: 1 })).toBe(null)
  })
})

describe('normalizeCreateByImage', () => {
  const base = { imageFileId: 'i', voice: 'v', text: 'x' }

  it('三必填齐全 ⇒ 合法', () => {
    expect(normalizeCreateByImage(base)).toMatchObject(base)
  })

  it.each(['imageFileId', 'voice', 'text'])('缺 %s ⇒ null', (k) => {
    const copy = { ...base }
    delete copy[k]
    expect(normalizeCreateByImage(copy)).toBe(null)
  })

  it('text 超 10000 字 ⇒ null', () => {
    expect(normalizeCreateByImage({ ...base, text: 'a'.repeat(10001) })).toBe(null)
  })

  it('model 透传（枚举随 adapter 校验）', () => {
    expect(normalizeCreateByImage({ ...base, model: 6 })).toMatchObject({ model: 6 })
  })

  it('model 非整数 ⇒ null', () => {
    expect(normalizeCreateByImage({ ...base, model: 1.5 })).toBe(null)
  })

  it('未知字段 ⇒ null', () => {
    expect(normalizeCreateByImage({ ...base, foo: 1 })).toBe(null)
  })
})

describe('normalizeAudioTts', () => {
  it('voice + text ⇒ 合法', () => {
    expect(normalizeAudioTts({ voice: 'v', text: 'x' })).toEqual({ voice: 'v', text: 'x' })
  })

  it('缺 voice ⇒ null', () => {
    expect(normalizeAudioTts({ text: 'x' })).toBe(null)
  })

  it('缺 text ⇒ null', () => {
    expect(normalizeAudioTts({ voice: 'v' })).toBe(null)
  })

  it('text 超 10000 字 ⇒ null', () => {
    expect(normalizeAudioTts({ voice: 'v', text: 'a'.repeat(10001) })).toBe(null)
  })

  it('title 超 20 字 ⇒ null', () => {
    expect(normalizeAudioTts({ voice: 'v', text: 'x', title: 'a'.repeat(21) })).toBe(null)
  })

  it('aigcFlag 可接受 0', () => {
    expect(normalizeAudioTts({ voice: 'v', text: 'x', aigcFlag: 0 })).toMatchObject({ aigcFlag: 0 })
  })

  it('aigcFlag 非整数 ⇒ null', () => {
    expect(normalizeAudioTts({ voice: 'v', text: 'x', aigcFlag: 1.5 })).toBe(null)
  })

  it('未知字段 ⇒ null', () => {
    expect(normalizeAudioTts({ voice: 'v', text: 'x', bar: 1 })).toBe(null)
  })
})
