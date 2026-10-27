// @ts-check
'use strict'
/**
 * kit-import-swap — 第二遍拷贝（哈希对账）、目录级换入、回滚与**精确清单清理**
 *
 * 归属：PR-3b（F-J 资产导入写路径）· 方案 `pr3b-import-design.md` §二 / §三 S3/S4/S6/S19
 *
 * 关键不变量（逐条来自方案）：
 *   - **两条对账**（S6）：① 副本 SHA-256 == 第一遍记录的源 SHA-256；
 *                         ② 拷贝完成后**再次 `stat` 源文件**，`(dev,ino,size,mtime)` 与第一遍记录一致
 *                         ⇒ 挡住「原地改内容（同尺寸）」与「拷贝过程中被改」两类 TOCTOU；
 *     ⚠ **不比副本的 inode**（副本 inode 必然不同于源，比了会恒假、把所有导入全拒）。
 *   - **目录级换入**（同卷 rename 原子）：旧 kit → `film-kit.bak-<ts>` → staging → `film-kit` → 删 `.bak`；
 *     `<ts>` = **毫秒精度 ISO 时间戳 + 4 位随机后缀** ⇒ 每次尝试的名字唯一 ⇒ 绝不撞名、无 `EEXIST`。
 *   - **回滚**（S4）：④ 失败 ⇒ `.bak` 改回 `film-kit`；**回滚也失败 ⇒ `.bak` 保留不删** + 报错带恢复路径。
 *   - ⛔ **禁止递归删除目录**（本仓 **R0 铁律**：目录删除一律拒绝、`safe-delete.js` 不接目录）：
 *     清理 = **按精确清单逐个 `unlink`**（清单 = 第一遍枚举结果，不动态重扫）⇒ 再**按深度从深到浅
 *     逐个 `rmdir` 空目录**（含 `prompts/tasks/<task>/<lang>` 这类嵌套空目录）⇒ 根目录最后删。
 *   - `ERROR_ACCESS_DENIED` 分级重试（S19）：A 类（文件 copyFile）套指数退避；
 *     B 类（目录 rename）只做**一次立即重试**（NTFS 占用常不可重试）；审计追加不重试。
 */

const nodeFs = require('fs')
const nodePath = require('path')
const nodeCrypto = require('crypto')

const { manifestFromFileList, collectTreeManifest, removeTreeByManifest } = require('./kit-tree-clean')

/** 重试常量（§三 S19；数值只在代码里存在一次） */
const RETRY_MAX = 3
const RETRY_MS = 500

/** 失败原因（闭集见方案 §五） */
const REASON = Object.freeze({
  VALIDATION_ERROR: 'VALIDATION_ERROR',
  SWAP_FAILED: 'SWAP_FAILED',
  ROLLBACK_FAILED: 'ROLLBACK_FAILED',
  PARENT_NOT_WRITABLE: 'PARENT_NOT_WRITABLE',
})

/** 目标 kit 目录名 */
const KIT_DIR_NAME = 'film-kit'
/** staging 前缀 */
const STAGING_PREFIX = 'film-kit.staging-'
/** 备份前缀 */
const BAK_PREFIX = 'film-kit.bak-'

/** 毫秒精度 ISO 时间戳 + 4 位随机后缀（保证每次尝试唯一） */
function makeStamp (now, rand) {
  const iso = new Date(now == null ? Date.now() : now).toISOString().replace(/[:.]/g, '-')
  const suffix = rand || Math.random().toString(36).slice(2, 6)
  return iso + '-' + suffix
}

/** staging 目录名 */
function stagingName (stamp) {
  return STAGING_PREFIX + stamp
}

/** 备份目录名 */
function bakName (stamp) {
  return BAK_PREFIX + stamp
}

/** 让出事件循环（心跳不得被拷贝饿死 —— S18） */
function yieldToLoop () {
  return new Promise((resolve) => setImmediate(resolve))
}

/** 是否是「访问被占用」类错误（可重试） */
function isAccessDenied (e) {
  const code = e && e.code
  return code === 'EPERM' || code === 'EACCES' || code === 'EBUSY'
}

/**
 * A 类重试（文件拷贝）：指数退避 `RETRY_MS * 2^(n-1)`。
 * @param {() => Promise<any>} fn
 */
async function retryCopy (fn) {
  let lastErr = null
  for (let attempt = 0; attempt < RETRY_MAX; attempt++) {
    try {
      return await fn()
    } catch (e) {
      lastErr = e
      if (!isAccessDenied(e)) break
      if (attempt < RETRY_MAX - 1) {
        await new Promise((r) => setTimeout(r, RETRY_MS * Math.pow(2, attempt)))
      }
    }
  }
  throw lastErr
}

/**
 * B 类重试（目录 rename）：**只做一次立即重试**（NTFS 占用常不可重试 ⇒ 不套退避循环）。
 * @param {() => Promise<any>} fn
 */
async function retryRenameOnce (fn) {
  try {
    return await fn()
  } catch (e) {
    if (!isAccessDenied(e)) throw e
    return fn()
  }
}

/** 默认哈希实现（SHA-256） */
function defaultHashFile (fsImpl, absPath) {
  return new Promise((resolve, reject) => {
    const h = nodeCrypto.createHash('sha256')
    const stream = fsImpl.createReadStream(absPath)
    stream.on('error', reject)
    stream.on('data', (chunk) => h.update(chunk))
    stream.on('end', () => resolve(h.digest('hex')))
  })
}

/**
 * 第二遍：拷到 staging + 两条对账。
 * @param {object} opts
 * @param {Array} opts.files - 第一遍产出的候选（relPath/absPath）
 * @param {object} opts.firstPassStats - 第一遍记录
 * @param {string} opts.stagingDir
 * @returns {Promise<{ok:boolean, reason?:string, message?:string, copied?:string[]}>}
 */
async function copyToStaging (opts) {
  const o = opts || {}
  const fsImpl = o.fs || nodeFs
  const hashFile = o.hashFile || defaultHashFile
  const firstPassStats = o.firstPassStats || {}
  const copied = []

  try {
    await fsImpl.promises.mkdir(o.stagingDir, { recursive: true })
  } catch (e) {
    return { ok: false, reason: REASON.PARENT_NOT_WRITABLE, message: '建 staging 失败: ' + String(e && e.message) }
  }

  for (const f of o.files || []) {
    await yieldToLoop()
    const rel = f.relPath
    const dst = nodePath.join(o.stagingDir, rel)
    try {
      await fsImpl.promises.mkdir(nodePath.dirname(dst), { recursive: true })
    } catch (_e) {
      return { ok: false, reason: REASON.PARENT_NOT_WRITABLE, message: '建目录失败: ' + rel }
    }
    try {
      await retryCopy(() => fsImpl.promises.copyFile(f.absPath, dst))
    } catch (e) {
      return { ok: false, reason: REASON.VALIDATION_ERROR, message: '拷贝失败: ' + rel + ' · ' + String(e && e.message) }
    }
    // ① 副本哈希 == 源哈希
    let copyHash
    try {
      copyHash = await hashFile(fsImpl, dst)
    } catch (_e) {
      return { ok: false, reason: REASON.VALIDATION_ERROR, message: '副本哈希失败: ' + rel }
    }
    const src = firstPassStats[rel]
    if (!src) {
      return { ok: false, reason: REASON.VALIDATION_ERROR, message: '缺少第一遍记录: ' + rel }
    }
    if (copyHash !== src.sha256) {
      return { ok: false, reason: REASON.VALIDATION_ERROR, message: '副本哈希与源不一致: ' + rel }
    }
    // ② 拷贝完成后再次 stat 源文件：(dev,ino,size,mtime) 与第一遍一致
    let st
    try {
      st = await fsImpl.promises.stat(f.absPath)
    } catch (_e) {
      return { ok: false, reason: REASON.VALIDATION_ERROR, message: '源文件 stat 失败: ' + rel }
    }
    if (st.dev !== src.dev || st.ino !== src.ino || st.size !== src.size || st.mtimeMs !== src.mtimeMs) {
      return { ok: false, reason: REASON.VALIDATION_ERROR, message: '源文件在拷贝期间被改动: ' + rel }
    }
    copied.push(rel)
  }
  return { ok: true, copied }
}

/**
 * 精确清单清理（⛔ **不递归删除目录** —— 本仓 R0 铁律）。
 * @param {object} opts
 * @param {string} opts.stagingDir
 * @param {string[]} opts.fileList - 第一遍枚举结果（相对路径清单；不动态重扫）
 * @returns {{ok:boolean, removedFiles:number, removedDirs:number}}
 */
async function cleanupStaging (opts) {
  const o = opts || {}
  const fsImpl = o.fs || nodeFs
  const manifest = manifestFromFileList(o.fileList || [])
  const res = await removeTreeByManifest({ rootDir: o.stagingDir, manifest, fs: fsImpl })
  return { ok: res.ok, removedFiles: res.removedFiles, removedDirs: res.removedDirs, message: res.message }
}

/**
 * 目录级换入（④⑤⑥）：旧 kit → `.bak-<stamp>` → staging → `film-kit` → 删 `.bak`。
 * @returns {{ok:boolean, reason?:string, message?:string, bakPath?:string}}
 */
async function swapIn (opts) {
  const o = opts || {}
  const fsImpl = o.fs || nodeFs
  const userDataDir = o.userDataDir
  const stagingDir = o.stagingDir
  const kitDir = nodePath.join(userDataDir, KIT_DIR_NAME)
  const bakDir = nodePath.join(userDataDir, bakName(o.stamp))
  let bakCreated = false

  // ④ 旧 kit → .bak（存在才搬）
  let hasOld
  try {
    hasOld = fsImpl.existsSync(kitDir)
  } catch (_e) {
    hasOld = false
  }
  if (hasOld) {
    try {
      await retryRenameOnce(() => fsImpl.promises.rename(kitDir, bakDir))
      bakCreated = true
    } catch (e) {
      return { ok: false, reason: REASON.SWAP_FAILED, message: '旧 kit 改名失败: ' + String(e && e.message) }
    }
  }

  // ⑤ staging → film-kit
  try {
    await retryRenameOnce(() => fsImpl.promises.rename(stagingDir, kitDir))
  } catch (e) {
    // 回滚：.bak 改回 film-kit
    if (bakCreated) {
      try {
        await retryRenameOnce(() => fsImpl.promises.rename(bakDir, kitDir))
        return { ok: false, reason: REASON.SWAP_FAILED, message: '换入失败且已回滚: ' + String(e && e.message) }
      } catch (_e2) {
        return {
          ok: false,
          reason: REASON.ROLLBACK_FAILED,
          message: '换入失败且回滚失败，旧资产在: ' + bakDir,
          bakPath: bakDir,
        }
      }
    }
    return { ok: false, reason: REASON.SWAP_FAILED, message: '换入失败: ' + String(e && e.message) }
  }

  // ⑥ 保留旧备份作为「上一版」（change: kit-import-rollback-and-template-health）
  //
  // ⚠ 这里**不再删** `.bak`：导入是整体替换，删掉备份就等于「选错包也没救了」。
  //   旧备份保留到**下一次导入成功之后**才清理 ⇒ 任何时刻最多 1 份历史备份，
  //   而本次失败时旧备份仍在（清理发生在成功路径，不在 ⓪a）。
  //
  // ⚠ 语义分层，**不复用 `BAK_LEFT`**：`BAK_LEFT` 是「本次换入/清理出错的异常残留」，
  //   而本字段是「正常态的历史备份」。混用会让「残留」从异常变成常态 ⇒ 恢复指引常驻、
  //   噪音化，真出事时用户已经习惯性忽略它。
  if (bakCreated) {
    // 清理**更早**的备份（精确清单 + 自底向上 rmdir：⛔ 不递归删目录，R0）
    const stale = await removeOlderBaks({ fs: fsImpl, userDataDir, keep: bakDir })
    return {
      ok: true,
      previousBackup: { path: bakDir, stamp: o.stamp },
      staleRemoved: stale.removed,
      staleWarning: stale.warning,
    }
  }
  return { ok: true }
}

/**
 * 清理**更早**的 `.bak-*`，只保留本次那份（`keep`）。
 *
 * 为什么在成功之后才清：若在 ⓪a 就删旧备份，本次导入随后失败时用户的唯一退路已被抹掉
 * ——「可回滚」会在最需要它的时刻被取消。
 * ⛔ 每一份都走「精确清单 + 自底向上 rmdir」（R0：不递归删目录）。
 * @returns {Promise<{removed:number, warning:string|null}>}
 */
async function removeOlderBaks (opts) {
  const o = opts || {}
  const fsImpl = o.fs || nodeFs
  const userDataDir = o.userDataDir
  const keep = o.keep
  let ents
  try {
    ents = await fsImpl.promises.readdir(userDataDir, { withFileTypes: true })
  } catch (_e) {
    return { removed: 0, warning: '列目录失败，未清理更早备份' }
  }
  const stale = ents
    .filter((e) => e && typeof e.isDirectory === 'function' && e.isDirectory() && typeof e.name === 'string' && e.name.startsWith(BAK_PREFIX))
    .map((e) => nodePath.join(userDataDir, e.name))
    .filter((p) => p !== keep)
  let removed = 0
  const failed = []
  for (const dir of stale) {
    const manifest = await collectTreeManifest(dir, fsImpl)
    if (!manifest.ok) { failed.push(nodePath.basename(dir)); continue }
    const r = await removeTreeByManifest({ rootDir: dir, manifest, fs: fsImpl })
    if (!r.ok) failed.push(nodePath.basename(dir))
    else removed += 1
  }
  return { removed, warning: failed.length ? '未能清理更早备份: ' + failed.join(', ') : null }
}

/**
 * 回滚：把 `.bak` 改回 `film-kit`（仅在 `film-kit` 不存在时）。
 * @returns {{ok:boolean, reason?:string, message?:string}}
 */
async function rollbackToBak (opts) {
  const o = opts || {}
  const fsImpl = o.fs || nodeFs
  const kitDir = nodePath.join(o.userDataDir, KIT_DIR_NAME)
  const bakDir = o.bakPath
  try {
    if (fsImpl.existsSync(kitDir)) {
      return { ok: false, reason: REASON.ROLLBACK_FAILED, message: '目标已存在，不回滚' }
    }
    await retryRenameOnce(() => fsImpl.promises.rename(bakDir, kitDir))
    return { ok: true }
  } catch (_e) {
    return { ok: false, reason: REASON.ROLLBACK_FAILED, message: '回滚失败，旧资产在: ' + bakDir }
  }
}

module.exports = {
  RETRY_MAX,
  RETRY_MS,
  REASON,
  KIT_DIR_NAME,
  STAGING_PREFIX,
  BAK_PREFIX,
  makeStamp,
  stagingName,
  bakName,
  copyToStaging,
  cleanupStaging,
  swapIn,
  rollbackToBak,
  removeOlderBaks,
}
