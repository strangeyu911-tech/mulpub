#!/usr/bin/env node
// @ts-check
'use strict'

/**
 * `scripts/merge-coverage-shards.js` 的行为锁（含**变异反证**）。
 *
 * 锁的性质（不是「跑绿」）：
 *  ① 合并是**并集**：同一文件被两片**互补**覆盖 ⇒ 合并后 = 100%（不是 50%）；
 *  ② 阈值判定按 **vitest 原生语义**：`threshold >= 0` ⇒ 最低百分比（红条件 `pct < threshold`），
 *     `threshold < 0` ⇒ 最大未覆盖数（红条件 `uncovered > -threshold`）；
 *  ③ **失明 ≠ 通过**：读不到产物 / 形状不认识 / 合并结果为空 / 缺阈值项 ⇒ 退出码 **2**，绝不返回 0；
 *  ④ 阈值只有一个真源（`apps/desktop/vitest.config.js`），本脚本不硬编码。
 *
 * 跑法：node --test scripts/merge-coverage-shards.test.js
 */

const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const { spawnSync } = require('node:child_process')

const SCRIPT = path.join(__dirname, 'merge-coverage-shards.js')
const CONFIG = path.join(__dirname, '..', 'apps', 'desktop', 'vitest.config.js')
const REPO_ROOT = path.join(__dirname, '..')

/**
 * 造一份 istanbul 格式的覆盖率产物。
 *
 * ⚠ 形状要点（istanbul 的约定，写错一个键名就「不像覆盖率」）：
 *   s  = 语句计数表    statementMap = 语句位置表（每项直接带 start/end）
 *   f  = 函数计数表    fnMap        = 函数位置表（每项带 **loc**，不是 decl！）
 *   b  = 分支计数表    branchMap    = 分支位置表（每项带 loc + locations）
 * ⚠ `fnMap` 的键名是 `loc`：`istanbul-lib-coverage` 的 `keyFromLocProp = x => keyFromLoc(x.loc)`
 *   ⇒ 写成 `decl` 会在**合并同文件**时抛 `Cannot destructure property 'start' of 'undefined'`。
 * ⚠ 循环变量刻意叫 `file` 而不是 `f`：`f` 是 istanbul 的**函数计数表**键，
 *   用 `f` 当循环变量会让 `f:` 那个简写属性变成**文件路径字符串**（形状看着对、内容全错）。
 *
 * @param {Record<string, {hits: number[], fn?: number[]}>} spec 每个文件 → 语句命中数 / 函数命中数
 */
function makeCoverage (spec) {
  const out = {}
  for (const [file, cfg] of Object.entries(spec)) {
    const s = {}
    const sm = {}
    cfg.hits.forEach((h, i) => {
      s['s' + i] = h
      sm['s' + i] = { start: { line: i + 1, column: 0 }, end: { line: i + 1, column: 10 } }
    })
    const fn = {}
    const fm = {}
    const fnHits = cfg.fn || cfg.hits.map((h) => (h > 0 ? 1 : 0))
    fnHits.forEach((h, i) => {
      fn['f' + i] = h
      fm['f' + i] = { name: 'f' + i, loc: { start: { line: i + 1, column: 0 }, end: { line: i + 1, column: 5 } } }
    })
    out[file] = {
      path: file,
      statementMap: sm,
      fnMap: fm,
      branchMap: {},
      s: s,
      f: fn,
      b: {},
    }
  }
  return out
}

function writeTmp (name, content) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'covmerge-'))
  const p = path.join(dir, name)
  fs.writeFileSync(p, typeof content === 'string' ? content : JSON.stringify(content))
  return p
}

/**
 * 阈值真源夹具：形状与 `apps/desktop/vitest.config.js` 相同（`test.coverage.thresholds`），
 * 但**不 require vitest/vite** ⇒ 任何环境都能跑这个行为锁。
 */
function writeFixtureConfig (thresholds) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'covmerge-cfg-'))
  const p = path.join(dir, 'vitest.config.js')
  fs.writeFileSync(p, 'module.exports = { test: { coverage: { thresholds: ' +
    JSON.stringify(thresholds) + ' } } }\n')
  return p
}

/** 跑合并脚本，返回 { code, stdout, stderr }。 */
function run (args, env) {
  const r = spawnSync(process.execPath, [SCRIPT, ...args], {
    encoding: 'utf8',
    env: env ? { ...process.env, ...env } : process.env,
  })
  return { code: r.status, stdout: String(r.stdout || ''), stderr: String(r.stderr || '') }
}

/**
 * 跑**变异体**（把脚本源码改成某个变体后写到临时目录跑）。
 * ⚠ 变异体放在 /tmp ⇒ `require('istanbul-lib-coverage')` 解析不到仓内 node_modules
 *   ⇒ 必须显式给 `NODE_PATH`（否则变异体会走「失明」分支，读数与真实路径不可比）。
 */
function runMutant (mutatedSrc, args) {
  const p = writeTmp('mutant.js', mutatedSrc)
  const r = spawnSync(process.execPath, [p, ...args], {
    encoding: 'utf8',
    env: { ...process.env, NODE_PATH: path.join(REPO_ROOT, 'node_modules') },
  })
  return { code: r.status, stdout: String(r.stdout || ''), stderr: String(r.stderr || '') }
}

/** 剥掉块注释与行注释（用于「脚本不得硬编码阈值」这类检查，避免被说明文字触发）。 */
function stripComments (src) {
  return src
    .replace(/\/\*[\s\S]*?\*\//g, ' ')
    .replace(/^\s*\/\/.*$/gm, ' ')
}

/** 从真源配置里**读出**四个阈值（不 require 它 ⇒ 不依赖 vite/vitest）。 */
function readRealThresholds () {
  const src = fs.readFileSync(CONFIG, 'utf8')
  const out = {}
  for (const k of ['statements', 'branches', 'functions', 'lines']) {
    const m = src.match(new RegExp(k + '\\s*:\\s*(-?\\d+)'))
    assert.ok(m, '真源必须含 ' + k + ' 阈值')
    out[k] = Number(m[1])
  }
  return out
}

test('① 合并是并集：同一文件被两片互补覆盖 ⇒ 100%（不是 50%）；不相交两文件 ⇒ files=2', () => {
  // 同一文件 x.js：片 A 命中 s0，片 B 命中 s1 ⇒ 合并后两条语句都被命中 ⇒ 100%。
  // ⚠ 若合并取「最后一片」而不是并集，这里会读成 50% ⇒ 这条断言正是锁住「并集」性质。
  const a = writeTmp('a.json', makeCoverage({ 'x.js': { hits: [1, 0] } }))
  const b = writeTmp('b.json', makeCoverage({ 'x.js': { hits: [0, 1] } }))
  const r = run([a, b, '--thresholds=' + JSON.stringify({ statements: 100, branches: 0, functions: 100, lines: 100 })])
  assert.equal(r.code, 0, '合并后应达标：\n' + r.stdout + r.stderr)
  assert.match(r.stdout, /files=1/, '同一文件只应算一个文件')
  assert.match(r.stdout, /statements=100%/, '互补分片合并必须是并集（100%）而不是被稀释')
  assert.match(r.stdout, /verdict=PASS/)

  // 不相交的两个文件（各自全覆盖）⇒ files=2
  const a2 = writeTmp('a2.json', makeCoverage({ 'x.js': { hits: [1] } }))
  const c = writeTmp('c.json', makeCoverage({ 'y.js': { hits: [1] } }))
  const r2 = run([a2, c, '--thresholds=' + JSON.stringify({ statements: 100, branches: 0, functions: 100, lines: 100 })])
  assert.equal(r2.code, 0, '\n' + r2.stdout + r2.stderr)
  assert.match(r2.stdout, /files=2/)
  assert.match(r2.stdout, /statements=100%/)
})

test('② 阈值未达 ⇒ rc=1 且错误文案与 vitest 原生同形', () => {
  const a = writeTmp('a.json', makeCoverage({ 'x.js': { hits: [0, 0] } }))
  const r = run([a, '--thresholds=' + JSON.stringify({ statements: 90, branches: 0, functions: 90, lines: 90 })])
  assert.equal(r.code, 1, '低于阈值必须红：\n' + r.stdout + r.stderr)
  assert.match(r.stderr, /ERROR: Coverage for statements \(\d+(\.\d+)?%\) does not meet global threshold \(90%\)/)
  assert.match(r.stdout, /verdict=FAIL/)
})

test('③ 负阈值 = 最大未覆盖数：未覆盖数超限才红', () => {
  // 2 条语句全未覆盖 ⇒ uncovered=2；**1 个**函数未覆盖 ⇒ uncovered=1
  // ⚠ 必须显式给 fn：[0] —— 默认是「每条语句一个函数」⇒ 函数数会变成 2 ⇒ 未覆盖数翻倍。
  const a = writeTmp('a.json', makeCoverage({ 'x.js': { hits: [0, 0], fn: [0] } }))
  // 允许 2 条语句未覆盖、1 个函数未覆盖 ⇒ 不红
  assert.equal(run([a, '--thresholds=' + JSON.stringify({ statements: -2, branches: 0, functions: -1, lines: -2 })]).code, 0)
  // 只允许 1 条 ⇒ 红
  const r = run([a, '--thresholds=' + JSON.stringify({ statements: -1, branches: 0, functions: -1, lines: -1 })])
  assert.equal(r.code, 1, '未覆盖数超限必须红')
  assert.match(r.stderr, /ERROR: Uncovered statements \(2\) exceed threshold \(1\)/)
})

test('④ 失明 ≠ 通过：四种失明形态都必须 rc=2', () => {
  // ④a 读不到任何分片产物
  assert.equal(run(['--thresholds=' + JSON.stringify({ statements: 1 }), '/tmp/definitely-not-here.json']).code, 2)
  // ④b 产物形状不认识（istanbul 对这种输入**不抛错**，而是当成「零语句的文件」⇒ pct=100 ⇒ 假绿）
  const bad = writeTmp('bad.json', '{"not":"istanbul"}')
  const rb = run([bad, '--thresholds=' + JSON.stringify({ statements: 1, branches: 1, functions: 1, lines: 1 })])
  assert.equal(rb.code, 2, '形状不认识必须失明（不能读成 100% 通过）：\n' + rb.stdout + rb.stderr)
  assert.match(rb.stderr, /FAIL-BLIND/)
  // ④c 阈值项缺失
  const a = writeTmp('a.json', makeCoverage({ 'x.js': { hits: [1] } }))
  assert.equal(run([a, '--thresholds=' + JSON.stringify({ statements: 1 })]).code, 2, '缺 branches/functions/lines 必须失明')
  // ④d 空产物（没有任何文件条目）⇒ 摘要 pct 会是 "Unknown" ⇒ 比较恒不成立 ⇒ 假绿
  const empty = writeTmp('empty.json', {})
  assert.equal(run([empty, '--thresholds=' + JSON.stringify({ statements: 1, branches: 1, functions: 1, lines: 1 })]).code, 2,
    '空产物必须失明（不能读成 Unknown/100% 通过）')
})

test('⑤ 阈值只有一个真源：脚本读 apps/desktop/vitest.config.js，且不硬编码四个阈值', () => {
  const src = fs.readFileSync(SCRIPT, 'utf8')
  assert.ok(fs.existsSync(CONFIG), '阈值真源必须存在：apps/desktop/vitest.config.js')
  // ⚠ 必须**剥掉注释**再查数字：否则脚本里「40–47 分钟」这类说明文字会把它自己触发（假红）。
  const code = stripComments(src)
  const real = readRealThresholds()
  for (const [k, v] of Object.entries(real)) {
    assert.doesNotMatch(code, new RegExp('\\b' + v + '\\b'),
      '脚本不得硬编码 ' + k + ' 阈值 ' + v + '（真源是 vitest.config.js）')
    assert.doesNotMatch(code, new RegExp('\\b' + k + '\\s*:\\s*-?\\d'),
      '脚本不得出现阈值字面量 ' + k + ': <数字>')
  }
  // 真源里必须真的有那四项
  const cfgSrc = fs.readFileSync(CONFIG, 'utf8')
  for (const k of ['statements', 'branches', 'functions', 'lines']) {
    assert.match(cfgSrc, new RegExp(k + '\\s*:'), '真源必须含 ' + k)
  }
  // 默认路径必须指向真实真源（不是某个夹具）
  assert.match(src, /apps['"],\s*['"]desktop['"],\s*['"]vitest\.config\.js['"]/, '默认阈值真源必须是 apps/desktop/vitest.config.js')
})

test('⑤-2 阈值真源可换：--config 指向夹具 ⇒ 脚本按夹具的阈值判', () => {
  // 覆盖 50%（两条语句命中一条）
  const a = writeTmp('a.json', makeCoverage({ 'x.js': { hits: [1, 0] } }))
  const loose = writeFixtureConfig({ statements: 40, branches: 0, functions: 40, lines: 40 })
  const strict = writeFixtureConfig({ statements: 100, branches: 0, functions: 100, lines: 100 })
  const r1 = run([a, '--config', loose])
  assert.equal(r1.code, 0, '按夹具阈值（40）应达标（覆盖率 50%）：\n' + r1.stdout + r1.stderr)
  assert.match(r1.stdout, /thresholds=\{statements:40/)
  const r2 = run([a, '--config', strict])
  assert.equal(r2.code, 1, '阈值抬到 100 必须红 ⇒ 证明 --config 真的换了判定依据')
  assert.match(r2.stderr, /does not meet global threshold \(100%\)/)
})

test('⑥ ⭐ 变异反证：判据必须真的有牙', () => {
  const src = fs.readFileSync(SCRIPT, 'utf8')
  const thr = JSON.stringify({ statements: 100, branches: 0, functions: 100, lines: 100 })

  // ── 变异 A：把「合并」这一步去掉（只读第一片）⇒ files 应从 2 变 1 ──
  const a = writeTmp('a.json', makeCoverage({ 'x.js': { hits: [1] } }))
  const b = writeTmp('b.json', makeCoverage({ 'y.js': { hits: [1] } }))
  const control = run([a, b, '--thresholds=' + thr])
  assert.equal(control.code, 0, '对照组（未变异）必须绿，否则后面的翻转不可比：\n' + control.stdout + control.stderr)
  assert.match(control.stdout, /files=2/, '对照组必须读到 2 个文件')

  const mutA = src.replace(
    'for (let i = 1; i < files.length; i++) {',
    'for (let i = 1; i < 1; i++) {'
  )
  assert.notEqual(mutA, src, '变异必须真的改到字节')
  const mrA = runMutant(mutA, [a, b, '--thresholds=' + thr])
  assert.doesNotMatch(mrA.stdout, /files=2/, '去掉合并后 files 不得还是 2（否则读数没变 ⇒ 锁瞎了）')
  assert.match(mrA.stdout, /files=1/, '去掉合并后必须只剩 1 个文件')

  // ── 变异 B：把「失明」的退出码从 2 改成 0 ⇒ ④ 的失明用例必须立刻红 ──
  const mutB = src.replace('process.exit(2)', 'process.exit(0)')
  assert.notEqual(mutB, src, '变异必须真的改到字节')
  const bad = writeTmp('bad.json', '{"not":"istanbul"}')
  const thrAll = JSON.stringify({ statements: 1, branches: 1, functions: 1, lines: 1 })
  const controlB = run([bad, '--thresholds=' + thrAll])
  assert.equal(controlB.code, 2, '对照组（未变异）必须失明 rc=2')
  const mrB = runMutant(mutB, [bad, '--thresholds=' + thrAll])
  assert.equal(mrB.code, 0, '变异后「失明」必须被变成 rc=0（这正是 ④ 要抓住的假绿）')
})
