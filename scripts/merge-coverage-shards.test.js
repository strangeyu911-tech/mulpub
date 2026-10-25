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

test('⑦ ⭐ 片数守卫：收到的分片数必须**恰好**等于期望数，否则走失明（rc=2）', () => {
  // 动因（独立复核抓出来的假绿）：分片挂一半时，`download-artifact` **不报错**
  // （它只下载 pattern 命中的那几个）⇒ 少的那片是**静默**的 ⇒
  // 若判定器不校验片数，就会拿**半份数据**当全局读数 ⇒ 而半份数据读数偏低，
  // 偏低**也可能**跨过阈值 ⇒ 判成「达标」＝ 假绿。
  const thr = JSON.stringify({ statements: 100, branches: 0, functions: 100, lines: 100 })
  // ⚠ 夹具要点：两片**各自 100% 覆盖** ⇒ 合并后 100%（达标）。
  //   ⇒ 这样「只收到 1 片」时那一片自己就是 100% ⇒ 若没有片数守卫，判定器会
  //     **判成达标**（rc=0）⇒ 假绿成立 ⇒ 守卫才是唯一拦住它的东西（变异反证会证明这点）。
  const a = writeTmp('a.json', makeCoverage({ 'x.js': { hits: [1] } }))
  const b = writeTmp('b.json', makeCoverage({ 'y.js': { hits: [1] } }))

  // 恰好 2 片 ⇒ 正常判定
  const ok = run([a, b, '--expect-shards=2', '--thresholds=' + thr])
  assert.equal(ok.code, 0, '片数恰好匹配时必须正常判定：\n' + ok.stdout + ok.stderr)
  assert.match(ok.stdout, /verdict=PASS/)

  // 只收到 1 片（期望 2）⇒ 失明 rc=2，**不得**判成达标
  const few = run([a, '--expect-shards=2', '--thresholds=' + thr])
  assert.equal(few.code, 2, '少一片必须失明 rc=2（半份数据不得判达标）：\n' + few.stdout + few.stderr)
  assert.match(few.stderr, /只收到 1\/2 片/, '失明原因必须说清缺了几片：\n' + few.stderr)
  assert.doesNotMatch(few.stdout, /verdict=PASS/, '少一片时绝不能出现 verdict=PASS')

  // 收到 3 片（期望 2）⇒ 陈旧产物混进来 ⇒ 失明
  const c = writeTmp('c.json', makeCoverage({ 'z.js': { hits: [1] } }))
  const many = run([a, b, c, '--expect-shards=2', '--thresholds=' + thr])
  assert.equal(many.code, 2, '多一片必须失明 rc=2（可能有陈旧产物混进来）：\n' + many.stdout + many.stderr)
  assert.match(many.stderr, /期望 2 片/, '失明原因必须说清期望几片：\n' + many.stderr)

  // 期望值本身非法 ⇒ 不知道该等几片 ⇒ 不判（失明），不得当成「没有期望 ⇒ 随便判」
  const bogus = run([a, b, '--expect-shards=abc', '--thresholds=' + thr])
  assert.equal(bogus.code, 2, '非法的期望片数必须失明：\n' + bogus.stdout + bogus.stderr)

  // 不传 --expect-shards ⇒ 不做片数检查（本地/离线用法保持原行为）
  const noExpect = run([a, '--thresholds=' + thr])
  assert.equal(noExpect.code, 0, '不传 --expect-shards 时不应做片数检查：\n' + noExpect.stdout + noExpect.stderr)
})

test('⑦-2 ⭐ 变异反证：片数守卫必须真的有牙（去掉它 ⇒ ⑦ 的少一片用例立刻变绿假象）', () => {
  const src = fs.readFileSync(SCRIPT, 'utf8')
  const thr = JSON.stringify({ statements: 100, branches: 0, functions: 100, lines: 100 })
  const a = writeTmp('a.json', makeCoverage({ 'x.js': { hits: [1] } }))
  const b = writeTmp('b.json', makeCoverage({ 'y.js': { hits: [1] } }))

  // 对照组（未变异）：少一片 ⇒ 失明 rc=2
  const control = run([a, '--expect-shards=2', '--thresholds=' + thr])
  assert.equal(control.code, 2, '对照组（未变异）必须失明 rc=2：\n' + control.stdout + control.stderr)

  // 变异：把「片数不足 ⇒ 失明」这条分支去掉（改成不判、继续往下走）
  const mut = src.replace(
    "      blind('只收到 ' + files.length + '/' + expected + ' 片覆盖率产物（分片可能失败）'",
    "      console.error('[COVERAGE-MERGE] MUTANT 只收到 ' + files.length + '/' + expected + ' 片覆盖率产物（分片可能失败）'"
  )
  assert.notEqual(mut, src, '变异必须真的改到字节')
  const mr = runMutant(mut, [a, '--expect-shards=2', '--thresholds=' + thr])
  assert.equal(mr.code, 0,
    '变异后少一片必须被放行成 rc=0（这正是 ⑦ 要抓住的假绿）：\n' + mr.stdout + mr.stderr)
  assert.match(mr.stdout, /verdict=PASS/, '变异后必须出现「假达标」读数（否则 ⑦ 的断言没牙齿）')
})
