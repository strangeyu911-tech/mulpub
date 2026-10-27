'use strict'

const os = require('os')
const path = require('path')

/**
 * 只允许把 JSON 报告写到当前工作目录或系统临时目录，避免 CLI 参数造成任意写。
 * @param {string} input
 * @returns {string} 绝对路径
 */
function resolveReportPath (input) {
  const target = path.resolve(process.cwd(), input)
  const allowedRoots = [process.cwd(), os.tmpdir()]
  const allowed = allowedRoots.some((root) => {
    const resolved = path.resolve(root)
    return target === resolved || target.startsWith(resolved + path.sep)
  })
  if (!allowed) {
    throw new Error('--json 只能写入当前工作目录或临时目录: ' + target)
  }
  return target
}

module.exports = { resolveReportPath }
