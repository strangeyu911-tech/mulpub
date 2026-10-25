// @ts-check
/**
 * explainer-remotion-media — 把 props 里的**本地媒体**拷进 Remotion 的 public 目录，并把引用改成**相对文件名**
 *
 * ## 为什么必须有这一层（本轮 E2E 真实复跑才暴露的第六个缺陷）
 *
 * ⚠ **Remotion 的图片/视频组件不接受绝对路径，也不接受 `file://`**：
 *   `resolveAsset()`（`packages/remotion-composer/src/Explainer.tsx:16`）虽然会把绝对路径转成
 *   `file:///…`，但 Remotion 的 `<Img>` / `<OffthreadVideo>` 组件**只认 public 目录里的相对名**
 *   ⇒ 传绝对路径 ⇒ 渲染期抛
 *   `TypeError: staticFile() does not support absolute paths - got "/tmp/…/img_0000.png"`
 *   ⇒ 主进程只看到「退出码 1 + 一段 React 栈」。
 *
 * ⚠ **上游早就有这个机制**：`tools/video/video_compose.py` 的 `_stage_remotion_media()`
 *   （上游原文注释：「OffthreadVideo's compositor rejects `file://` sources.
 *   Rewriting staged files to relative `staticFile()` paths works for video and
 *   image components on every platform.」）⇒ 本模块是它的等价物。
 *
 * ## 做法（与上游一致）
 *
 * ① 把本地媒体**复制**到本次渲染专属的 public 目录（文件名带内容摘要前缀，避免同名不同内容互相覆盖）；
 * ② 把 props 里对应字段改成**纯文件名**（相对路径 ⇒ `staticFile(name)` 能解析）；
 * ③ 渲染时用 `--public-dir=<该目录>` 告诉 Remotion CLI 去哪儿找。
 *
 * ⚠ **只处理本地文件**：`http(s)://` / `data:` 原样保留（远程与内联资源不需要 staging）。
 * ⚠ **不认识的字段不动**：媒体键清单与上游一致（`source` / `src` / `backgroundSrc` /
 *   `backgroundImage` / `backgroundVideo` / `images`）⇒ 不扩大范围，避免误改数据字段。
 */

'use strict'

const fs = require('fs')
const path = require('path')
const crypto = require('crypto')

/** 会被当作「媒体引用」的字段名（与上游 `_stage_remotion_media` 的 `media_keys` 一致） */
const MEDIA_KEYS = new Set([
  'source', 'src', 'backgroundSrc', 'backgroundImage', 'backgroundVideo', 'images',
])

/** 远程 / 内联资源不 staging */
const PASSTHROUGH_PREFIXES = ['http://', 'https://', 'data:']

function isPassthrough (value) {
  return PASSTHROUGH_PREFIXES.some(prefix => value.startsWith(prefix))
}

/**
 * 把 `file:` URI 还原成文件系统路径（**与上游 `_file_uri_to_raw_path` 同语义**）。
 *
 * ⚠ 上游用 `urlsplit` 解析，**POSIX 的前导斜杠必须保留**：
 *   `file:///tmp/a.png` ⇒ `/tmp/a.png`（不是 `tmp/a.png`）
 *   ⇒ 用「简单正则剥前缀」会把斜杠吃掉 ⇒ 路径解析不到 ⇒ 素材被静默跳过。
 * ⚠ Windows 三种写法都要覆盖：`file:///C:/x` / `file://C:/x` / `file://C:\x`。
 *
 * @param {string} value
 * @returns {string}
 */
function fileUriToRawPath (value) {
  const matched = /^file:\/\/(.*)$/i.exec(String(value || ''))
  if (!matched) return String(value || '')
  const rest = matched[1]
  let netloc = ''
  let pathPart = rest
  const slash = rest.indexOf('/')
  if (slash !== -1) {
    netloc = rest.slice(0, slash)
    pathPart = rest.slice(slash)
  }
  let raw
  if (/^[A-Za-z]:/.test(netloc)) {
    // Windows 盘符被当成 authority（`file://C:/x`）
    raw = netloc + pathPart
  } else if (netloc && netloc.toLowerCase() !== 'localhost') {
    raw = '//' + netloc + pathPart
  } else {
    raw = pathPart
  }
  // 标准 Windows file URI：file:///C:/... ⇒ 去掉 URI 的那个前导斜杠
  if (raw.length >= 3 && raw[0] === '/' && raw[2] === ':') raw = raw.slice(1)
  try { return decodeURIComponent(raw) } catch (_) { return raw }
}

/**
 * 把一份本地媒体拷进 public 目录，返回它在 public 目录里的**相对文件名**。
 *
 * @param {string} rawPath 本地文件绝对路径
 * @param {string} publicDir public 目录
 * @param {Map<string, string>} staged 已暂存的映射（原路径 → 相对文件名）
 * @returns {string|null} 相对文件名；文件不存在时返回 null
 */
function stageOne (rawPath, publicDir, staged) {
  const absolute = path.resolve(rawPath)
  if (staged.has(absolute)) return staged.get(absolute)
  let stat
  try { stat = fs.statSync(absolute) } catch (_) { return null }
  if (!stat.isFile()) return null
  const digest = crypto.createHash('sha256').update(absolute).digest('hex').slice(0, 12)
  const name = digest + '-' + path.basename(absolute)
  try {
    fs.mkdirSync(publicDir, { recursive: true })
    fs.copyFileSync(absolute, path.join(publicDir, name))
  } catch (_) {
    return null
  }
  staged.set(absolute, name)
  return name
}

/**
 * 把 props 里的本地媒体引用改成 public 目录里的相对文件名。
 *
 * @param {object} props 原始 props（**不修改入参**，返回改过的新对象）
 * @param {object} options
 * @param {string} options.publicDir 本次渲染专属的 public 目录
 * @returns {{props: object, stagedCount: number, publicDir: string, missing: Array<string>}}
 */
function stageRemotionMedia (props, options = {}) {
  const publicDir = String(options.publicDir || '')
  const staged = new Map()
  const missing = []

  const visit = (node, parentKey) => {
    if (Array.isArray(node)) {
      return node.map(item => visit(item, parentKey))
    }
    if (node && typeof node === 'object') {
      const out = {}
      for (const key of Object.keys(node)) {
        out[key] = visit(node[key], key)
      }
      return out
    }
    if (typeof node !== 'string' || !node) return node
    if (!MEDIA_KEYS.has(parentKey || '')) return node
    if (isPassthrough(node)) return node
    const raw = fileUriToRawPath(node)
    const name = stageOne(raw, publicDir, staged)
    if (!name) {
      missing.push(node)
      return node
    }
    return name
  }

  const next = visit(props, null)
  return {
    props: next,
    stagedCount: staged.size,
    publicDir,
    missing,
  }
}

/**
 * 把合成器自带的 `public/` 内容**镜像**进本次渲染的 public 目录。
 *
 * ⚠ `--public-dir` 会**替换** Remotion 默认的 public 目录 ⇒ 合成器自己 public/ 里的东西
 *   （demo 素材、fixture 等）会 404 ⇒ 上游专门做了这件事（`_mirror_public_dir`，
 *   上游原文：「Symlink each top-level entry in (read-only; nothing is written
 *   back to *source_root*), falling back to a copy where symlinks aren't permitted」）。
 *
 * @param {string} sourceRoot 合成器自带的 public 目录
 * @param {string} stagingRoot 本次渲染的 public 目录
 * @returns {number} 镜像进去的条目数
 */
function mirrorPublicDir (sourceRoot, stagingRoot) {
  let entries
  try { entries = fs.readdirSync(sourceRoot) } catch (_) { return 0 }
  let count = 0
  for (const entry of entries) {
    const src = path.join(sourceRoot, entry)
    const dst = path.join(stagingRoot, entry)
    if (fs.existsSync(dst)) continue
    try {
      fs.symlinkSync(src, dst, 'junction')
      count += 1
    } catch (_) {
      try {
        fs.cpSync(src, dst, { recursive: true })
        count += 1
      } catch (_) { /* 镜像不了就算了：不影响本次渲染的素材 */ }
    }
  }
  return count
}

module.exports = {
  MEDIA_KEYS,
  isPassthrough,
  fileUriToRawPath,
  stageRemotionMedia,
  mirrorPublicDir,
}
