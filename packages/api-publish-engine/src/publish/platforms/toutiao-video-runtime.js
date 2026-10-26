'use strict'

/**
 * toutiao-video-runtime.js — 头条视频链的运行时小工具（从 toutiao-video.js 下沉）
 *
 * 为什么独立（2026-10-26）：toutiao-video.js 触发 500 行硬限；
 * 这 3 个方法只依赖 chain 的字段，纯拼装/取值，无网络副作用，故按本仓 mixin 范式下沉。
 */

const { buildApplyQuery } = require('../core/bytedance-vod')
const { pickCsrfToken, CSRF_HEADER } = require('./toutiao-video-publish')

/** 从 cookie 串取 key 的值（`; ` 分隔） */
function cookieValue (cookie, key) {
  const s = String(cookie || '')
  const m = s.match(new RegExp('(?:^|;\\s*)' + key.replace(/[.*+?^${}()|[\]\\]/g, '\\/** uid_tt 优先') + '=([^;]*)'))
  return m ? m[1].trim() : ''
}

/** uid_tt 优先，回落到构造时注入的 _uidFallback */
function resolveUid (chain) {
  return cookieValue(chain.cookie, 'uid_tt') || String(chain._uidFallback || '')
}

/** Step 2 的 query（EnOID=1 是头条独有，抖音不带） */
function applyQueryFor (chain, o) {
  const x = o || {}
  return buildApplyQuery({
    size: x.size,
    spaceName: x.spaceName,
    appId: chain.appId,
    uid: x.uid,
    innerOid: true,
    suffix: x.suffix,
  })
}

/** 统一请求头（Cookie/UA/Referer/Origin + 写接口的 x-csrf-token） */
function mpHeaders (chain, extra) {
  const h = {
    Cookie: chain.cookie,
    'User-Agent': chain.userAgent,
    Referer: chain.mpBase + '/profile_v4/xigua/upload-video',
    Origin: chain.mpBase,
  }
  const csrf = chain._csrf || pickCsrfToken(chain.cookie)
  if (csrf) h[CSRF_HEADER] = csrf
  return Object.assign(h, extra || {})
}

module.exports = { cookieValue, resolveUid, applyQueryFor, mpHeaders }
