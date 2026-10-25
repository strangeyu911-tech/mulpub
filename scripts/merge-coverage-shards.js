#!/usr/bin/env node
// @ts-check
'use strict'

/**
 * 合并 desktop shards 各产出的 istanbul 覆盖率产物，判全局阈值。
 *
 * ── 为什么需要它（动因） ──
 * `QG Coverage`（branch protection 的 required context）此前**自己跑一遍全量桌面测试**
 * （`vitest run --coverage --maxWorkers=1 --no-file-parallelism`）⇒ 单趟 40–47 分钟。
 * 而 `desktop-shards` 已经把同一套桌面套件**分两片跑在两个 runner 上**（合计约 20–25 分钟）。
 * ⇒ 同一套覆盖率被**跑了两遍**：一遍分片（不产覆盖率）、一遍全量（产覆盖率）。
 *
 * ── 本脚本做的事 ──
 * ① 把 N 份 `coverage-final.json`（istanbul 格式）合并成一张全局 coverage map；
 * ② 按 **vitest 原生阈值语义**判定（阈值真源 = `apps/desktop/vitest.config.js`，本脚本不硬编码）。
 *
 * ── 判定语义逐字对齐 vitest（`vitest/dist/chunks/coverage.*.js` 的 `checkThresholds`） ──
 *   threshold >= 0 ⇒ 最低百分比，**红的条件是 `pct < threshold`**；
 *   threshold <  0 ⇒ 最大未覆盖数，**红的条件是 `uncovered > -threshold`**；
 *   错误文案：`ERROR: Coverage for <key> (<pct>%) does not meet global threshold (<threshold>%)`。
 * ⚠ v3 的 `istanbul-lib-coverage` **没有** `checkCoverage` 方法（合并是实例方法 `createCoverageMap(a).merge(b)`），
 *   所以阈值必须由本脚本自己判。
 *
 * ── 退出码（与仓内其它判据同口径） ──
 *   0 = 达标；1 = 阈值未达；**2 = 失明**（读不到阈值 / 读不到任何分片产物 / 形状不对 / 合并失败）
 *   ⇒ 「没测成」绝不能读成「通过」。
 *
 * ── ⚠ 三处「假绿」必须显式堵住（2026-10-25 实测） ──
 *   ① `createCoverageMap({任意键:'任意值'})` **不抛错**，而是把那个键当成一个「零语句的文件」
 *      ⇒ 覆盖率读数变成 total=0 / **pct=100** ⇒ 阈值判定全绿。
 *      ⇒ 所以合并前必须**逐份校验 istanbul 形状**（`statementMap`/`fnMap`/`branchMap` + `s`/`f`/`b`）。
 *   ② 空的 coverage map ⇒ `getCoverageSummary()` 的 `pct` 是字符串 `"Unknown"`
 *      ⇒ `"Unknown" < 55` 在 JS 里是 **false** ⇒ 判定全绿。
 *      ⇒ 所以合并后必须**至少有一个文件**，且四项的 `pct` 必须是**有限数字**。
 *   ③ 「读不到分片产物」若被当成「0 个文件」⇒ 同上 ⇒ 必须单独走失明通道。
 *
 * 用法：
 *   node scripts/merge-coverage-shards.js <coverage-final.json> [<coverage-final.json> ...]
 *   node scripts/merge-coverage-shards.js --dir <目录>        # 递归找 coverage-final.json
 *   node scripts/merge-coverage-shards.js --thresholds='{"lines":55,...}' <文件...>   # 离线/单测覆盖
 *   node scripts/merge-coverage-shards.js --config <vitest.config.js> <文件...>       # 换阈值真源（单测用夹具）
 */

const fs = require('node:fs')
const path = require('node:path')

const REPO_ROOT = path.resolve(__dirname, '..')
const DEFAULT_CONFIG = path.join(REPO_ROOT, 'apps', 'desktop', 'vitest.config.js')
const THRESHOLD_KEYS = ['statements', 'branches', 'functions', 'lines']
/** istanbul 覆盖率对象的必备键（少一个就不是覆盖率产物）。 */
const ISTANBUL_MAP_KEYS = ['statementMap', 'fnMap', 'branchMap']
const ISTANBUL_COUNT_KEYS = ['s', 'f', 'b']

/** 失明（读不到 / 形状不对）—— 绝不当成通过。 */
function blind (reason) {
  console.error('[COVERAGE-MERGE] FAIL-BLIND ' + reason)
  process.exit(2)
}

function isPlainObject (v) {
  return !!v && typeof v === 'object' && !Array.isArray(v)
}

/**
 * 校验一份产物是不是 istanbul 覆盖率对象。
 * ⚠ 必须校验：istanbul 对**形状不认识**的输入**不抛错**，而是当成「零语句的文件」⇒ 读数 100% ⇒ 假绿。
 */
function assertIstanbulShape (raw, source) {
  if (!isPlainObject(raw)) blind('产物不是一个对象（形状不认识）：' + source)
  const entries = Object.entries(raw)
  if (entries.length === 0) blind('产物里没有任何文件条目：' + source)
  for (const [file, cov] of entries) {
    if (!isPlainObject(cov)) blind('产物的文件条目不是对象：' + source + ' → ' + file)
    for (const k of ISTANBUL_MAP_KEYS) {
      if (!isPlainObject(cov[k])) blind('产物缺少 ' + k + '（不是 istanbul 覆盖率）：' + source + ' → ' + file)
    }
    for (const k of ISTANBUL_COUNT_KEYS) {
      if (!isPlainObject(cov[k])) blind('产物缺少 ' + k + '（不是 istanbul 覆盖率）：' + source + ' → ' + file)
    }
  }
}

/** 递归收集目录下的 coverage-final.json。 */
function collectFromDir (dir) {
  const out = []
  const walk = (d) => {
    let entries
    try {
      entries = fs.readdirSync(d, { withFileTypes: true })
    } catch (e) {
      blind('读不到目录：' + d + '（' + e.message + '）')
    }
    for (const ent of entries) {
      const full = path.join(d, ent.name)
      if (ent.isDirectory()) {
        if (ent.name === 'node_modules' || ent.name === '.git') continue
        walk(full)
      } else if (ent.name === 'coverage-final.json') {
        out.push(full)
      }
    }
  }
  walk(dir)
  return out
}

/**
 * 阈值真源：`apps/desktop/vitest.config.js` 的 `test.coverage.thresholds`。
 * ⚠ 刻意**不硬编码**四个阈值：vitest 判全局阈值时读的就是这份配置，
 *   合并脚本读另一份就等于引入第二口径 ⇒ 阈值一改就漂移。
 */
function readThresholdsFromConfig (configPath) {
  const target = configPath || DEFAULT_CONFIG
  if (!fs.existsSync(target)) blind('找不到覆盖率阈值真源：' + target)
  let cfg
  try {
    // eslint-disable-next-line
    cfg = require(target)
  } catch (e) {
    blind('读覆盖率阈值真源失败：' + target + '（' + e.message + '）')
  }
  const thresholds = cfg && cfg.test && cfg.test.coverage && cfg.test.coverage.thresholds
  if (!thresholds || typeof thresholds !== 'object') {
    blind('阈值真源里没有 test.coverage.thresholds：' + target)
  }
  return thresholds
}

function parseArgv (argv) {
  const files = []
  let dir = null
  let thresholds = null
  let config = null
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]
    if (a === '--config') { config = argv[++i]; continue }
    if (a.startsWith('--config=')) { config = a.slice('--config='.length); continue }
    if (a === '--dir') { dir = argv[++i]; continue }
    if (a.startsWith('--dir=')) { dir = a.slice('--dir='.length); continue }
    if (a.startsWith('--thresholds=')) {
      try {
        thresholds = JSON.parse(a.slice('--thresholds='.length))
      } catch (e) {
        blind('--thresholds 不是合法 JSON：' + e.message)
      }
      continue
    }
    if (a === '--thresholds') {
      try {
        thresholds = JSON.parse(argv[++i])
      } catch (e) {
        blind('--thresholds 不是合法 JSON：' + e.message)
      }
      continue
    }
    if (a === '--help' || a === '-h') {
      console.log(fs.readFileSync(__filename, 'utf8').split('*/')[0].replace(/^\/\*\*?/, ''))
      process.exit(0)
    }
    files.push(a)
  }
  return { files, dir, thresholds, config }
}

function main () {
  const { files: argFiles, dir, thresholds: thresholdOverride, config } = parseArgv(process.argv.slice(2))

  const files = dir ? collectFromDir(dir) : argFiles
  if (!files || files.length === 0) {
    blind('没有找到任何分片覆盖率产物（coverage-final.json）—— 无法判定')
  }
  for (const f of files) {
    if (!fs.existsSync(f)) blind('分片产物不存在：' + f)
  }

  const thresholds = thresholdOverride || readThresholdsFromConfig(config)
  for (const k of THRESHOLD_KEYS) {
    if (thresholds[k] === undefined) blind('阈值真源缺 ' + k + ' 这一项')
  }

  let createCoverageMap
  try {
    ({ createCoverageMap } = require('istanbul-lib-coverage'))
  } catch (e) {
    blind('读不到 istanbul-lib-coverage（它必须是本仓的直接依赖）：' + e.message)
  }

  let merged
  try {
    const first = JSON.parse(fs.readFileSync(files[0], 'utf8'))
    assertIstanbulShape(first, files[0])
    merged = createCoverageMap(first)
    for (let i = 1; i < files.length; i++) {
      const raw = JSON.parse(fs.readFileSync(files[i], 'utf8'))
      assertIstanbulShape(raw, files[i])
      const m = createCoverageMap(raw)
      merged.merge(m)
    }
  } catch (e) {
    blind('合并分片覆盖率失败（形状不对或产物损坏）：' + e.message)
  }

  // ⚠ 空合并结果 ⇒ 摘要的 pct 是字符串 "Unknown" ⇒ 比较恒不成立 ⇒ 假绿 ⇒ 必须失明。
  if (!merged || merged.files().length === 0) {
    blind('合并后没有任何文件条目 —— 覆盖率读数不可信')
  }

  let summary
  try {
    summary = merged.getCoverageSummary()
  } catch (e) {
    blind('读合并后的覆盖率摘要失败：' + e.message)
  }
  const data = summary && summary.data
  if (!data) blind('合并后的覆盖率摘要没有 data 字段（形状不认识）')

  // 逐项判定：语义与 vitest 的 checkThresholds 逐字对齐。
  const failures = []
  for (const key of THRESHOLD_KEYS) {
    const threshold = thresholds[key]
    if (threshold === undefined) continue
    const bucket = data[key]
    if (!bucket || typeof bucket.total !== 'number') blind('覆盖率摘要里没有 ' + key + ' 这一项')
    if (typeof bucket.pct !== 'number' || !Number.isFinite(bucket.pct)) {
      blind('覆盖率摘要里 ' + key + ' 的 pct 不是数字（读数不可信）：' + JSON.stringify(bucket.pct))
    }
    if (threshold >= 0) {
      const pct = bucket.pct
      if (pct < threshold) failures.push({ key, pct, threshold, kind: 'min' })
    } else {
      const uncovered = bucket.total - bucket.covered
      const allowed = -threshold
      if (uncovered > allowed) failures.push({ key, uncovered, allowed, kind: 'max' })
    }
  }

  const pctStr = THRESHOLD_KEYS.map((k) => k + '=' + (data[k] ? data[k].pct : '?') + '%').join(' ')
  const thrStr = THRESHOLD_KEYS.map((k) => k + ':' + thresholds[k]).join(',')
  const verdict = failures.length ? 'FAIL' : 'PASS'
  console.log('[COVERAGE-MERGE] shards=' + files.length +
    ' files=' + merged.files().length +
    ' ' + pctStr +
    ' thresholds={' + thrStr + '}' +
    ' verdict=' + verdict)

  if (failures.length) {
    for (const f of failures) {
      if (f.kind === 'min') {
        console.error('ERROR: Coverage for ' + f.key + ' (' + f.pct + '%) does not meet global threshold (' + f.threshold + '%)')
      } else {
        console.error('ERROR: Uncovered ' + f.key + ' (' + f.uncovered + ') exceed threshold (' + f.allowed + ')')
      }
    }
    process.exit(1)
  }
  process.exit(0)
}

main()
