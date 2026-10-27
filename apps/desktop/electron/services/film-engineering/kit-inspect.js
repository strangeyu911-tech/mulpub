// @ts-check
'use strict'
/**
 * kit-inspect — 资产**体检报告**（只读，一个字节都不写）
 *
 * 归属：change `kit-asset-health-report` · 方案 `proposal.md` §2 / §数据契约
 *
 * 为什么需要它：导入是**整体替换**的破坏性写路径，而既有校验只回答「合格 / 不合格」。
 * 用户导入前看不到「我会得到什么」（几个场景 / 几个分镜 / 几个任务模板 / 参考图能解析多少 /
 * 哪些会被忽略）⇒ 只能「导了才知道」。本模块把已有校验器的结果**聚合成人话报告**。
 *
 * ⛔ **只读铁律**（由 `kit-inspect.test.js` 的机械锁盯着，不靠人读代码）：
 *   全程不建锁、不写审计、不写任何文件；不 import 任何写路径模块。
 *
 * **两遍读**（决策 D4）：只跑严格模式的话，资产不合格时用户只能拿到一句「不符合要求」，
 *   看不到自己包里**其实有什么** —— 而那恰恰是最该告诉他/她的。故：
 *     ① 宽松读（`requireAssets:false`）⇒ 拿统计 + `assetWarnings`
 *     ② 严格读（`requireAssets:true`） ⇒ 判「能否导入」
 *
 * **`ok` 与 `importable` 必须分开**（决策 D5）：
 *   `ok` = 体检本身跑通（目录读得到）；`importable` = 资产合格。
 *   合成一个字段会让「目录读不到」被读成「资产不合格」，两种成因对应完全不同的用户动作。
 */

const nodeFs = require('fs')
const nodePath = require('path')

const { scanKit, ROOT_REQUIRED, ROOT_OPTIONAL, BASE_PROMPT_PATH } = require('./kit-import-scan')
const { loadFilmKit } = require('./kit-loader')
const { analyzeTemplatePrompt } = require('./script-adapt')

/** 体检本身失败的原因（**不是**「资产不合格」） */
const INSPECT_REASON = Object.freeze({
  NOT_A_DIRECTORY: 'NOT_A_DIRECTORY',
  VALIDATION_ERROR: 'VALIDATION_ERROR',
})

/**
 * 告警 code 闭集（**只聚合既有来源，不新增判据** —— 内容级判据属另一批）。
 * 顺序即 `SCHEMA.md` 十二、告警表的顺序。
 */
const WARN_CODE = Object.freeze({
  MISSING_V7_ASSET: 'MISSING_V7_ASSET',
  EMPTY_TASK_LIBRARY: 'EMPTY_TASK_LIBRARY',
  UNRESOLVED_REFERENCE: 'UNRESOLVED_REFERENCE',
  IGNORED_TOP_LEVEL: 'IGNORED_TOP_LEVEL',
  SHOTS_WITH_RESULT: 'SHOTS_WITH_RESULT',
  /** 有 N 个模板分镜缺 `[CHARACTER: …]` 行 ⇒ 规划时角色锚点会丢 */
  TEMPLATE_NO_CHARACTER_LINE: 'TEMPLATE_NO_CHARACTER_LINE',
  /** 有 N 个模板分镜没有任何**被识别**的块（GEO SPATIAL LAYOUT / ACTION TIMING …）⇒ 运动与空间约束会丢 */
  TEMPLATE_NO_BLOCKS: 'TEMPLATE_NO_BLOCKS',
})

/**
 * 本版本接受的资产 schemaVersion。
 * ⚠ 只用于**让失败可读**（报告里显示「你的包是 vN，本版本要求 v1」）；严格校验行为不变（仍拒）。
 */
const EXPECTED_ASSET_VERSION = 1

/** 白名单里允许出现在**顶层**的条目名（用于算「白名单外条目」） */
function allowedTopLevelNames () {
  const names = new Set(ROOT_REQUIRED.concat(ROOT_OPTIONAL))
  names.add(BASE_PROMPT_PATH.split('/')[0])
  return names
}

/** 参考条目是否有可解析的图片 URL（离线判形状，不联网） */
function hasResolvableUrl (entry) {
  if (!entry || typeof entry !== 'object') return false
  const urls = Array.isArray(entry.imageUrls) ? entry.imageUrls : []
  return urls.some((u) => typeof u === 'string' && /^https?:\/\//i.test(u.trim()))
}

/**
 * 资产体检。
 * @param {object} opts
 * @param {string} opts.kitDir - 用户选定的源目录（**只读**）
 * @param {object} [opts.fs]
 * @param {(o:object)=>{ok:boolean, kit?:object, error?:string}} [opts.loadFilmKit] - 注入便于测试
 * @returns {Promise<{ok:boolean, reason?:string, message?:string, data?:object}>}
 */
async function inspectKit (opts) {
  const o = opts || {}
  const fsImpl = o.fs || nodeFs
  const kitDir = o.kitDir
  const loadKit = typeof o.loadFilmKit === 'function' ? o.loadFilmKit : loadFilmKit

  // ── ⓪ 目录存在性（这一步失败 = 体检没跑成，**不是**资产不合格）──────────
  let st
  try {
    st = await fsImpl.promises.stat(kitDir)
  } catch (e) {
    return { ok: false, reason: INSPECT_REASON.NOT_A_DIRECTORY, message: '源目录不可读: ' + String(e && e.message) }
  }
  if (!st || typeof st.isDirectory !== 'function' || !st.isDirectory()) {
    return { ok: false, reason: INSPECT_REASON.NOT_A_DIRECTORY, message: '所选路径不是目录' }
  }

  // ── ① 形状/白名单/体积（写路径同一套判据的唯一真源；体检只跳哈希）──────
  let scan = null
  try {
    scan = await scanKit({ kitDir, fs: fsImpl, skipHash: true })
  } catch (_e) {
    // 扫描自身异常 ⇒ 保持 null ⇒ 下面按「不可导入 + 未量到」处理，不静默当合格
  }

  // ── ② 宽松读（统计 + 平台告警）③ 严格读（能否导入）──────────────────
  const safeLoad = (requireAssets) => {
    try {
      return loadKit({ kitDir, requireAssets })
    } catch (e) {
      return { ok: false, error: String(e && e.message) }
    }
  }
  const loose = safeLoad(false)
  const strict = safeLoad(true)

  const kit = loose && loose.ok && loose.kit ? loose.kit : null
  const counts = kit ? buildCounts(kit, scan) : null
  const langs = kit ? collectLangs(kit) : []
  /** 模板分镜的结构可用性（P1）：规划真正依赖的三处结构 */
  const templateStructure = kit ? buildTemplateStructure(kit) : null
  /** 资产版本（P3）：只让失败可读，不改变严格校验 */
  const assetVersion = kit && kit.manifest && Number.isInteger(kit.manifest.schemaVersion)
    ? kit.manifest.schemaVersion
    : await readManifestVersion(fsImpl, kitDir)
  const versionMismatch = assetVersion !== null && assetVersion !== EXPECTED_ASSET_VERSION
  /** 与当前资产对比（P2）：调用方没给齐 currentCounts ⇒ null（**不印 0**） */
  const compare = buildCompare(counts, o.currentCounts)

  // ── ④ 必填齐备（自己 stat 一遍：结构化点名，不解析错误文本）──────────
  const requiredMissing = await collectRequiredMissing(fsImpl, kitDir)

  // ── ⑤ 白名单外顶层条目（不会被拷入，但用户有权知道）──────────────────
  const ignoredTopLevel = await collectIgnoredTopLevel(fsImpl, kitDir)

  // ── ⑥ 告警聚合（只聚合既有来源）────────────────────────────────────
  const warnings = []
  const assetWarningTexts = kit && Array.isArray(kit.assetWarnings) ? kit.assetWarnings.slice() : []
  if (assetWarningTexts.length > 0) {
    warnings.push({ code: WARN_CODE.MISSING_V7_ASSET, count: assetWarningTexts.length })
  }
  if (assetWarningTexts.some((t) => typeof t === 'string' && t.includes('没有任务目录'))) {
    warnings.push({ code: WARN_CODE.EMPTY_TASK_LIBRARY, count: null })
  }
  if (counts && counts.references > counts.referencesResolvable) {
    warnings.push({ code: WARN_CODE.UNRESOLVED_REFERENCE, count: counts.references - counts.referencesResolvable })
  }
  if (ignoredTopLevel.length > 0) {
    warnings.push({ code: WARN_CODE.IGNORED_TOP_LEVEL, count: ignoredTopLevel.length })
  }
  if (counts && counts.shotsWithResult > 0) {
    warnings.push({ code: WARN_CODE.SHOTS_WITH_RESULT, count: counts.shotsWithResult })
  }
  if (templateStructure && templateStructure.total > 0) {
    const noCharacterLine = templateStructure.total - templateStructure.withCharacterLine
    if (noCharacterLine > 0) {
      warnings.push({ code: WARN_CODE.TEMPLATE_NO_CHARACTER_LINE, count: noCharacterLine })
    }
    const noBlocks = templateStructure.total - templateStructure.withBlocks
    if (noBlocks > 0) {
      warnings.push({ code: WARN_CODE.TEMPLATE_NO_BLOCKS, count: noBlocks })
    }
  }

  // ── ⑦ 能否导入 ─────────────────────────────────────────────────
  const importable = !!(scan && scan.ok && strict && strict.ok)
  let blockingReason = null
  let blockingMessage = null
  if (!importable) {
    // reason 取**闭集值**（渲染端据此本地化）；字段级校验的自由文本只进 message 供诊断。
    blockingReason = INSPECT_REASON.VALIDATION_ERROR
    if (scan && !scan.ok) {
      blockingMessage = String(scan.message || '资产形状不符合要求')
      // scan 自己更精确的 reason（如 EXT_NOT_ALLOWED / SIZE_EXCEEDED）仍交给调用方读 scan.reason
      if (scan.reason) blockingReason = String(scan.reason)
    } else if (strict && !strict.ok) {
      blockingMessage = String(strict.error || '资产内容不符合契约')
    } else {
      blockingMessage = '资产体检未能完成（扫描或校验异常）'
    }
  }

  return {
    ok: true,
    data: {
      importable,
      blockingReason,
      blockingMessage,
      counts,
      langs,
      templateStructure,
      assetVersion,
      expectedAssetVersion: EXPECTED_ASSET_VERSION,
      versionMismatch,
      compare,
      requiredMissing,
      ignoredTopLevel,
      warnings,
      assetWarningTexts,
    },
  }
}

/**
 * 读 `film-manifest.json` 的 schemaVersion（**只读一个小文件**）。
 *
 * 为什么不复用已加载的 kit：schemaVersion 不符时**整包加载就会失败**（`kit === null`），
 * 而「版本可读」恰恰在这种时候最需要 —— 用户必须看到「你的包是 v2、本版本要求 v1」，
 * 而不是一句「资产不符合契约」。版本读数**不得依赖整包能否加载**。
 * @returns {Promise<number|null>}
 */
async function readManifestVersion (fsImpl, kitDir) {
  try {
    const raw = await fsImpl.promises.readFile(nodePath.join(kitDir, 'film-manifest.json'), 'utf8')
    const o = JSON.parse(raw)
    return o && Number.isInteger(o.schemaVersion) ? o.schemaVersion : null
  } catch (_e) {
    return null
  }
}

/**
 * 模板分镜的**结构可用性**（P1）。
 *
 * auto 规划把 `shot.prompt` 当结构化模板复用：场景头做 head、`[CHARACTER: …]` 行做角色锚点、
 * 被识别的块做运动/空间约束。三者全缺的包**能导入、能规划、能出片**，但提示词里约束是空的
 * ⇒ 必须让用户在导入前看见代价（**告警，不阻断**：极简模板可能是刻意的）。
 * @param {object} kit
 */
function buildTemplateStructure (kit) {
  const shots = Array.isArray(kit.shots) ? kit.shots : []
  let withSceneHeading = 0
  let withCharacterLine = 0
  let withBlocks = 0
  for (const s of shots) {
    const a = analyzeTemplatePrompt(s && s.prompt)
    if (a.hasSceneHeading) withSceneHeading += 1
    if (a.hasCharacterLine) withCharacterLine += 1
    if (a.recognizedBlockCount > 0) withBlocks += 1
  }
  return { total: shots.length, withSceneHeading, withCharacterLine, withBlocks }
}

/**
 * 与「当前资产」对比（P2）。
 *
 * ⚠ 形状不全就地降级为 `null`：**拿半个对象算 delta 会凭空造出 0 与负数**，
 *   而界面会把它们当成真实差异显示给用户（构造性零的又一个入口）。
 * @param {object|null} counts 本次体检的统计
 * @param {{scenes:number, shots:number, templates:number}|null} current 当前资产计数
 */
function buildCompare (counts, current) {
  if (!counts) return null
  if (!current || typeof current !== 'object') return null
  const int = (v) => Number.isInteger(v) && v >= 0
  if (!int(current.scenes) || !int(current.shots) || !int(current.templates)) return null
  return {
    current: { scenes: current.scenes, shots: current.shots, templates: current.templates },
    delta: {
      scenes: (counts.scenes == null ? 0 : counts.scenes) - current.scenes,
      shots: (counts.shots == null ? 0 : counts.shots) - current.shots,
      templates: (counts.templateTasks == null ? 0 : counts.templateTasks) - current.templates,
    },
  }
}

/** 统计（`counts` 为 null 表示**没量到**，绝不印 0 —— 本仓禁用构造性零） */
function buildCounts (kit, scan) {
  const shots = Array.isArray(kit.shots) ? kit.shots : []
  const refs = kit.references && typeof kit.references === 'object' ? Object.keys(kit.references) : []
  const refValues = refs.map((k) => kit.references[k])
  const tasks = kit.promptLibrary && kit.promptLibrary.tasks && typeof kit.promptLibrary.tasks === 'object'
    ? kit.promptLibrary.tasks
    : {}
  let templateFiles = 0
  for (const task of Object.keys(tasks)) {
    const byLocale = tasks[task] || {}
    for (const loc of Object.keys(byLocale)) {
      const entry = byLocale[loc] || {}
      if (entry.system) templateFiles += 1
      if (entry.user) templateFiles += 1
    }
  }
  return {
    scenes: Array.isArray(kit.manifest && kit.manifest.scenes) ? kit.manifest.scenes.length : null,
    shots: shots.length,
    shotsWithResult: shots.filter((s) => s && typeof s.resultUrl === 'string' && s.resultUrl.trim()).length,
    references: refs.length,
    referencesResolvable: refValues.filter(hasResolvableUrl).length,
    templateTasks: Object.keys(tasks).length,
    templateFiles,
    fileCount: scan && scan.ok && Array.isArray(scan.files) ? scan.files.length : null,
    totalBytes: scan && scan.ok && typeof scan.totalBytes === 'number' ? scan.totalBytes : null,
  }
}

/** 任务库语种并集（去重 + 字典序） */
function collectLangs (kit) {
  const tasks = kit.promptLibrary && kit.promptLibrary.tasks ? kit.promptLibrary.tasks : {}
  const set = new Set()
  for (const task of Object.keys(tasks)) {
    for (const loc of Object.keys(tasks[task] || {})) set.add(loc)
  }
  return Array.from(set).sort()
}

/** 必填文件 / 目录缺失清单（结构化点名，供界面逐条显示） */
async function collectRequiredMissing (fsImpl, kitDir) {
  const missing = []
  for (const name of ROOT_REQUIRED) {
    try {
      const s = await fsImpl.promises.stat(nodePath.join(kitDir, name))
      if (!s || typeof s.isFile !== 'function' || !s.isFile()) missing.push(name)
    } catch (_e) {
      missing.push(name)
    }
  }
  try {
    const s = await fsImpl.promises.stat(nodePath.join(kitDir, ...BASE_PROMPT_PATH.split('/')))
    if (!s || typeof s.isDirectory !== 'function' || !s.isDirectory()) missing.push(BASE_PROMPT_PATH + '/')
  } catch (_e) {
    missing.push(BASE_PROMPT_PATH + '/')
  }
  return missing
}

/** 顶层白名单外条目（排序后返回名字，不含路径） */
async function collectIgnoredTopLevel (fsImpl, kitDir) {
  const allowed = allowedTopLevelNames()
  let ents
  try {
    ents = await fsImpl.promises.readdir(kitDir, { withFileTypes: true })
  } catch (_e) {
    return []
  }
  return ents
    .map((e) => String(e && e.name ? e.name : ''))
    .filter((name) => name && !allowed.has(name))
    .sort()
}

module.exports = {
  INSPECT_REASON,
  WARN_CODE,
  EXPECTED_ASSET_VERSION,
  inspectKit,
  readManifestVersion,
  buildTemplateStructure,
  buildCompare,
  // 导出给测试与契约断言用（不改变运行语义）
  allowedTopLevelNames,
  hasResolvableUrl,
}
