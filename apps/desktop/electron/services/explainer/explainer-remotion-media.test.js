// @vitest-environment node
// @ts-check
/**
 * explainer-remotion-media.test.js — 本地媒体 staging（上游 `_stage_remotion_media` 的等价物）
 *
 * ## 覆盖什么
 *
 * ① 本地绝对路径 ⇒ 拷进 public 目录 + 改成**纯文件名**（相对路径 ⇒ `staticFile(name)` 能解析）；
 * ② `file://` 前缀要剥掉再解析；
 * ③ 远程/内联资源（http/https/data）**原样保留**；
 * ④ 数组字段（`images`）逐项 staging；
 * ⑤ 非媒体字段**不许被改**（避免误伤数据字段）；
 * ⑥ 文件不存在 ⇒ 如实登记 missing，**不静默**。
 *
 * ⚠ 为什么必须 staging：合成器的图片/视频组件只认 public 目录里的相对文件名
 *   ⇒ 传绝对路径 ⇒ 渲染期抛 `staticFile() does not support absolute paths`。
 */

import { describe, it, expect } from 'vitest'
import { createRequire } from 'node:module'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

const require = createRequire(import.meta.url)
const {
  MEDIA_KEYS,
  fileUriToRawPath,
  stageRemotionMedia,
} = require('./explainer-remotion-media')

function tmpDir () {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'explainer-media-test-'))
}

function writeFile (dir, name, content = 'x') {
  const p = path.join(dir, name)
  fs.writeFileSync(p, content, 'utf8')
  return p
}

describe('explain Remotion 媒体 staging', () => {
  it('★ 本地绝对路径 ⇒ 拷进 public 目录并改成纯文件名', () => {
    const src = tmpDir()
    const img = writeFile(src, 'img_0000.png', 'PNGDATA')
    const out = tmpDir()
    const result = stageRemotionMedia(
      { cuts: [{ id: 'c1', source: img, text: 'x' }] },
      { publicDir: path.join(out, 'public') }
    )
    expect(result.stagedCount).toBe(1)
    expect(result.props.cuts[0].source).not.toBe(img)
    expect(path.isAbsolute(result.props.cuts[0].source)).toBe(false)
    expect(fs.existsSync(path.join(result.publicDir, result.props.cuts[0].source))).toBe(true)
  })

  it('★ file:// 前缀要按上游 urlsplit 语义还原（POSIX 前导斜杠必须保留）', () => {
    expect(fileUriToRawPath('file:///tmp/a.png')).toBe('/tmp/a.png')
    // ⚠ 用「简单正则剥前缀」会吃掉前导斜杠 ⇒ 路径解析不到 ⇒ 素材被静默跳过
    expect(fileUriToRawPath('file://tmp/a.png')).toBe('//tmp/a.png')
    // Windows 三种写法
    expect(fileUriToRawPath('file:///C:/x/a.png')).toBe('C:/x/a.png')
    expect(fileUriToRawPath('file://C:/x/a.png')).toBe('C:/x/a.png')
  })

  it('★ 远程与内联资源原样保留（不需要 staging）', () => {
    const out = tmpDir()
    const result = stageRemotionMedia(
      {
        cuts: [{
          id: 'c1',
          source: 'https://example.com/a.png',
          backgroundImage: 'data:image/png;base64,AAA',
        }],
      },
      { publicDir: path.join(out, 'public') }
    )
    expect(result.props.cuts[0].source).toBe('https://example.com/a.png')
    expect(result.props.cuts[0].backgroundImage).toBe('data:image/png;base64,AAA')
    expect(result.stagedCount).toBe(0)
  })

  it('★ 数组字段（images）逐项 staging', () => {
    const src = tmpDir()
    const a = writeFile(src, 'a.png', 'A')
    const b = writeFile(src, 'b.png', 'B')
    const out = tmpDir()
    const result = stageRemotionMedia(
      { cuts: [{ id: 'c1', type: 'anime_scene', images: [a, b] }] },
      { publicDir: path.join(out, 'public') }
    )
    expect(result.stagedCount).toBe(2)
    expect(result.props.cuts[0].images).toHaveLength(2)
    for (const name of result.props.cuts[0].images) {
      expect(path.isAbsolute(name)).toBe(false)
      expect(fs.existsSync(path.join(result.publicDir, name))).toBe(true)
    }
  })

  it('★ 非媒体字段不许被改（避免误伤数据字段）', () => {
    const src = tmpDir()
    const img = writeFile(src, 'a.png', 'A')
    const out = tmpDir()
    const result = stageRemotionMedia(
      { cuts: [{ id: 'c1', source: img, text: '/abs/path/looks/like/media.png', reason: 'x' }] },
      { publicDir: path.join(out, 'public') }
    )
    expect(result.props.cuts[0].text).toBe('/abs/path/looks/like/media.png')
    expect(result.props.cuts[0].reason).toBe('x')
  })

  it('★ 文件不存在 ⇒ 登记 missing 且**原样保留**（不静默改写）', () => {
    const out = tmpDir()
    const missingPath = path.join(out, 'nope.png')
    const result = stageRemotionMedia(
      { cuts: [{ id: 'c1', source: missingPath }] },
      { publicDir: path.join(out, 'public') }
    )
    expect(result.stagedCount).toBe(0)
    expect(result.missing).toContain(missingPath)
    expect(result.props.cuts[0].source).toBe(missingPath)
  })

  it('★ 不修改入参（调用方手里的 props 不被就地改掉）', () => {
    const src = tmpDir()
    const img = writeFile(src, 'a.png', 'A')
    const out = tmpDir()
    const original = { cuts: [{ id: 'c1', source: img }] }
    stageRemotionMedia(original, { publicDir: path.join(out, 'public') })
    expect(original.cuts[0].source).toBe(img)
  })

  it('媒体键清单与上游一致（source/src/backgroundSrc/backgroundImage/backgroundVideo/images）', () => {
    expect([...MEDIA_KEYS].sort()).toEqual([
      'backgroundImage', 'backgroundSrc', 'backgroundVideo', 'images', 'source', 'src',
    ])
  })
})
