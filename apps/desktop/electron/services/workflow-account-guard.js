// @ts-check
/**
 * workflow-account-guard.js — 运行前账号预检
 *
 * 账号是发布目标的最小单位；预检必须在采集/生成之前 fail-closed，
 * 避免用户先花掉模型额度，最后才在发布队列里看到「账号已过期」。
 */

let ACCOUNT_STATUS = { unusable: ['expired', 'inactive', 'disabled'] }
try {
  const loaded = require('../../shared/workflow-account-status.json')
  if (loaded && Array.isArray(loaded.unusable)) ACCOUNT_STATUS = loaded
} catch (_) {
  // 打包遗漏/文件损坏时退回内置集合，绝不让模块加载崩溃。
}

const UNUSABLE_ACCOUNT_STATUS = new Set(ACCOUNT_STATUS.unusable)

/**
 * @param {{ accountProvider?: () => Promise<Array<{id:string,platform:string,status?:string}>> }} deps
 */
function createAccountGuard (deps = {}) {
  const accountProvider = deps.accountProvider

  async function check (config) {
    if (typeof accountProvider !== 'function') return { ok: false, error: 'account-check-unavailable' }
    let accounts
    try {
      accounts = await accountProvider()
    } catch (_) {
      return { ok: false, error: 'account-check-failed' }
    }
    const list = Array.isArray(accounts) ? accounts : []
    const problems = []
    for (const target of (config && config.publish && config.publish.targets) || []) {
      const found = list.find((a) => a && a.platform === target.platform && String(a.id) === String(target.accountId))
      if (!found) {
        problems.push({ platform: target.platform, accountId: target.accountId, reason: 'missing' })
      } else if (UNUSABLE_ACCOUNT_STATUS.has(String(found.status || ''))) {
        problems.push({ platform: target.platform, accountId: target.accountId, reason: String(found.status) })
      }
    }
    return problems.length ? { ok: false, error: 'account-unavailable', accounts: problems } : { ok: true }
  }

  return { check }
}

module.exports = { createAccountGuard, ACCOUNT_STATUS, UNUSABLE_ACCOUNT_STATUS }
