// @ts-check
/** workflow-run-utils.js — 运行记录的小型纯工具（id/时间/摘要） */

const crypto = require('crypto')

function newRunId () {
  return 'wf_' + Date.now().toString(36) + '_' + crypto.randomBytes(3).toString('hex')
}

function iso (ms) {
  return new Date(ms).toISOString()
}

function newSummary () {
  return { collected: 0, skipped: 0, scheduled: 0, published: 0, failed: 0, awaitingReview: 0, truncated: false, truncateReason: '' }
}

module.exports = { newRunId, iso, newSummary }
