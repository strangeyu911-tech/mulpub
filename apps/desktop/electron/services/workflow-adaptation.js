// @ts-check
/**
 * workflow-adaptation.js — 按平台/账号做发布前文本适配
 *
 * 只做确定性的文本变换：标题长度/后缀、正文截断、标签合并。
 * 封面/视频比例不在本模块伪实现：媒体变体裁剪需要发布器/流水线支持，
 * 当前只把配置校验好，避免生成与实际不一致的承诺。
 */

const ADAPTATION_LIMITS = Object.freeze({
  titleMaxLength: 200,
  bodyMaxLength: 100000,
  suffixMax: 40,
  tagsMax: 10,
  tagLengthMax: 30,
})

function isPlainObject (v) {
  return Boolean(v) && typeof v === 'object' && !Array.isArray(v)
}

function normalizeProfile (raw) {
  const p = isPlainObject(raw) ? raw : {}
  return {
    // 不做静默修复：非法值原样留下，交给 validateAdaptation 拒绝；
    // 合法值在通过校验后自然落在上限内。
    titleMaxLength: p.titleMaxLength === undefined ? 0 : p.titleMaxLength,
    bodyMaxLength: p.bodyMaxLength === undefined ? 0 : p.bodyMaxLength,
    titleSuffix: typeof p.titleSuffix === 'string' ? p.titleSuffix : '',
    tags: Array.isArray(p.tags)
      ? p.tags.filter((t) => typeof t === 'string' && t.trim()).map((t) => t.trim())
      : [],
  }
}

function normalizeAdaptation (raw) {
  const a = isPlainObject(raw) ? raw : {}
  const byPlatform = {}
  if (isPlainObject(a.byPlatform)) {
    for (const [platform, profile] of Object.entries(a.byPlatform)) {
      if (platform) byPlatform[platform] = normalizeProfile(profile)
    }
  }
  const byAccount = {}
  if (isPlainObject(a.byAccount)) {
    for (const [accountId, profile] of Object.entries(a.byAccount)) {
      if (accountId) byAccount[accountId] = normalizeProfile(profile)
    }
  }
  return {
    enabled: a.enabled === true,
    byPlatform,
    byAccount,
  }
}

function validateAdaptation (adaptation, platforms) {
  const errors = []
  if (!adaptation.enabled) return errors
  const allowed = new Set(platforms || [])
  const checkProfile = (profile, field) => {
    if (!Number.isInteger(profile.titleMaxLength) || (profile.titleMaxLength !== 0 && (profile.titleMaxLength < 1 || profile.titleMaxLength > ADAPTATION_LIMITS.titleMaxLength))) {
      errors.push({ field: field + '.titleMaxLength', reason: 'outOfRange', params: { min: 0, max: ADAPTATION_LIMITS.titleMaxLength } })
    }
    if (!Number.isInteger(profile.bodyMaxLength) || (profile.bodyMaxLength !== 0 && (profile.bodyMaxLength < 100 || profile.bodyMaxLength > ADAPTATION_LIMITS.bodyMaxLength))) {
      errors.push({ field: field + '.bodyMaxLength', reason: 'outOfRange', params: { min: 0, max: ADAPTATION_LIMITS.bodyMaxLength } })
    }
    if (profile.titleSuffix.length > ADAPTATION_LIMITS.suffixMax) {
      errors.push({ field: field + '.titleSuffix', reason: 'tooLong', params: { max: ADAPTATION_LIMITS.suffixMax } })
    }
    if (profile.tags.length > ADAPTATION_LIMITS.tagsMax) {
      errors.push({ field: field + '.tags', reason: 'tooMany', params: { max: ADAPTATION_LIMITS.tagsMax } })
    }
    if (profile.tags.some((t) => t.length > ADAPTATION_LIMITS.tagLengthMax)) {
      errors.push({ field: field + '.tags', reason: 'tooLong', params: { max: ADAPTATION_LIMITS.tagLengthMax } })
    }
  }
  for (const [platform, profile] of Object.entries(adaptation.byPlatform)) {
    if (!allowed.has(platform)) {
      errors.push({ field: 'content.adaptation.byPlatform.' + platform, reason: 'unsupported', params: { platform } })
      continue
    }
    checkProfile(profile, 'content.adaptation.byPlatform.' + platform)
  }
  for (const [accountId, profile] of Object.entries(adaptation.byAccount)) {
    checkProfile(profile, 'content.adaptation.byAccount.' + accountId)
  }
  if (Object.keys(adaptation.byPlatform).length === 0 && Object.keys(adaptation.byAccount).length === 0) {
    errors.push({ field: 'content.adaptation', reason: 'empty' })
  }
  return errors
}

function profileForTarget (adaptation, target) {
  if (!adaptation || adaptation.enabled !== true || !target) return null
  const byAccount = adaptation.byAccount && adaptation.byAccount[String(target.accountId || '')]
  if (byAccount) return byAccount
  return adaptation.byPlatform && adaptation.byPlatform[String(target.platform || '')] || null
}

function adaptArticle (article, target, adaptation) {
  const profile = profileForTarget(adaptation, target)
  if (!profile) return article
  const next = { ...article }
  let title = String(next.title || '')
  const suffix = profile.titleSuffix || ''
  if (profile.titleMaxLength > 0) {
    const clippedSuffix = suffix.slice(0, profile.titleMaxLength)
    const room = Math.max(0, profile.titleMaxLength - clippedSuffix.length)
    title = title.slice(0, room) + clippedSuffix
  } else if (suffix) {
    title += suffix
  }
  next.title = title
  if (profile.bodyMaxLength > 0 && String(next.content || '').length > profile.bodyMaxLength) {
    next.content = String(next.content).slice(0, Math.max(0, profile.bodyMaxLength - 1)) + '…'
  }
  if (profile.tags && profile.tags.length > 0) {
    const existing = Array.isArray(next.tags) ? next.tags : []
    next.tags = Array.from(new Set([...existing, ...profile.tags])).slice(0, ADAPTATION_LIMITS.tagsMax)
  }
  next.adaptation = {
    platform: target.platform,
    accountId: String(target.accountId || ''),
    titleMaxLength: profile.titleMaxLength,
    bodyMaxLength: profile.bodyMaxLength,
  }
  return next
}

module.exports = {
  ADAPTATION_LIMITS,
  normalizeProfile,
  normalizeAdaptation,
  validateAdaptation,
  profileForTarget,
  adaptArticle,
}
