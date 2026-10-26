'use strict'

/**
 * toutiao-publish-hooks.js — 头条发布前的 DOM 预处理（从 rpa-view-platforms.js 下沉）
 *
 * 为什么独立（2026-10-26）：rpa-view-platforms.js 受 1499 行点名目标约束。
 */

const path = require('path')
const fs = require('fs')
const os = require('os')

/**
 * 竞品做法（2026-10-25 逆向）：视频文件命名成 `<title>.<ext>` 再上传，
 * 页面用文件名自动填标题（React 自己的 onChange ⇒ 状态一定正确）。
 * 原地改写 article.video_path。
 */
function prepareVideoFile (article, log) {
  if (!article || !article.video_path || !article.title) return article && article.video_path
  try {
    const safe = String(article.title).replace(/[\\/:*?"<>|]/g, '_').slice(0, 60)
    const ext = path.extname(article.video_path) || '.mp4'
    const dst = path.join(os.tmpdir(), safe + ext)
    if (!fs.existsSync(dst)) fs.copyFileSync(article.video_path, dst)
    article.video_path = dst
    if (log) log.info('RpaView', '[toutiao] video renamed for auto title: ' + safe + ext)
  } catch (e) { if (log) log.warn('RpaView', '[toutiao] rename failed: ' + String((e && e.message) || '').slice(0, 50)) }
  return article.video_path
}

module.exports = { prepareVideoFile }
