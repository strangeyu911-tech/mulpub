'use strict'

const fs = require('fs')
const os = require('os')
const path = require('path')

/**
 * 应用模型 provider 配置的只读读取器（sql.js）。
 * 只读取 id/category/enabled/config 与 key 长度，不解密、不输出 API Key。
 */
function defaultProviderDbPath (platform = process.platform, env = process.env) {
  if (platform === 'win32') {
    return path.join(env.APPDATA || '', '@multi-publish', 'desktop', 'multi-publish.db')
  }
  if (platform === 'darwin') {
    return path.join(os.homedir(), 'Library', 'Application Support', '@multi-publish', 'desktop', 'multi-publish.db')
  }
  return path.join(os.homedir(), '.config', '@multi-publish', 'desktop', 'multi-publish.db')
}

function parseCapabilities (category, configText) {
  const capabilities = new Set()
  if (typeof category === 'string' && category.trim()) capabilities.add(category.trim())
  try {
    const config = JSON.parse(configText || '{}')
    if (Array.isArray(config.capabilities)) {
      for (const item of config.capabilities) {
        if (typeof item === 'string' && item.trim()) capabilities.add(item.trim())
      }
    }
    if (config.capability_models && typeof config.capability_models === 'object') {
      for (const key of Object.keys(config.capability_models)) capabilities.add(key)
    }
  } catch (_) { /* 配置损坏时只保留 category */ }
  return [...capabilities]
}

function readProviderRows (dbPath) {
  if (!fs.existsSync(dbPath)) {
    throw new Error('MODEL_PROVIDER_DB_NOT_FOUND: ' + dbPath)
  }
  const initSqlJs = require('sql.js')
  const distDir = path.dirname(require.resolve('sql.js'))
  const data = fs.readFileSync(dbPath)
  return initSqlJs({ locateFile: (file) => path.join(distDir, file) }).then((SQL) => {
    const db = new SQL.Database(data)
    const result = db.exec(
      'SELECT id, category, enabled, is_default, length(api_key) AS keylen, length(api_key_enc) AS enclen, config FROM model_providers ORDER BY category, id'
    )
    if (!result || result.length === 0) return []
    const { columns, values } = result[0]
    return values.map((row) => {
      const item = {}
      columns.forEach((column, index) => { item[column] = row[index] })
      return item
    })
  })
}

async function readProviderInventory (options = {}) {
  const dbPath = options.dbPath || defaultProviderDbPath(options.platform, options.env)
  const rows = await readProviderRows(dbPath)
  const providers = rows.map((row) => {
    const hasKey = Number(row.keylen) > 0 || Number(row.enclen) > 0
    return {
      id: row.id,
      categories: parseCapabilities(row.category, row.config),
      enabled: Number(row.enabled) === 1,
      isDefault: Number(row.is_default) === 1,
      hasKey,
    }
  })
  return {
    dbPath,
    providers,
    usable: providers.filter((provider) => provider.enabled && provider.hasKey),
  }
}

function capabilitiesFromInventory (inventory) {
  const capabilities = new Set()
  for (const provider of inventory && inventory.usable ? inventory.usable : []) {
    for (const capability of provider.categories) capabilities.add(capability)
  }
  return capabilities
}

module.exports = {
  capabilitiesFromInventory,
  defaultProviderDbPath,
  parseCapabilities,
  readProviderInventory,
}
