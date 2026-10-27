/**
 * check-gitignore-scripts.test.js —— `.gitignore` scripts 域判据的回归锁。
 *
 * 本文件是 `scripts/check-gitignore-scripts.js` 的锁，也是那道闸**自己的锁**：
 * 判据必须能证伪 —— 把 `scripts/*.js` 通配加回去，它必须转红。否则它只是装饰。
 *
 * 关键：可证伪用例在**一次性临时仓库**里做（真的把通配写进 .gitignore 再问 git），
 * 不碰本仓的 .gitignore，也不需要 stub —— ignore 规则的语义只能由 git 自己回答。
 */
'use strict'

const test = require('node:test')
const assert = require('node:assert')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const { execFileSync } = require('node:child_process')

const checker = require('./check-gitignore-scripts.js')

const REPO_ROOT = path.resolve(__dirname, '..')

// ---------------------------------------------------------------------------
// 夹具：一次性迷你仓库
// ---------------------------------------------------------------------------

function makeRepo(gitignoreContent) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'gi-scripts-'))
  const run = (args) => execFileSync('git', args, { cwd: dir, encoding: 'utf8' })
  run(['init', '--quiet', '-b', 'main'])
  run(['config', 'user.email', 'test@example.com'])
  run(['config', 'user.name', 'test'])
  fs.mkdirSync(path.join(dir, 'scripts', 'lib'), { recursive: true })
  fs.writeFileSync(path.join(dir, 'scripts', 'existing.js'), '// tracked\n', 'utf8')
  fs.writeFileSync(path.join(dir, '.gitignore'), gitignoreContent, 'utf8')
  run(['add', '-A'])
  run(['commit', '--quiet', '-m', 'base'])
  return { dir, run }
}

function cleanup(dir) {
  try { fs.rmSync(dir, { recursive: true, force: true }) } catch { /* Windows 偶发占用，忽略 */ }
}

function codesOf(repo) {
  return checker.check(repo).violations.map((v) => v.code)
}

// ---------------------------------------------------------------------------
// 1. 可证伪：把通配加回去，判据必须红
// ---------------------------------------------------------------------------

test('可证伪 · 加回 scripts/*.js 通配 ⇒ 必须报 SCRIPTS_JS_IGNORED', () => {
  const { dir } = makeRepo('scripts/*.js\n!scripts/existing.js\n')
  try {
    const codes = codesOf(dir)
    assert.ok(
      codes.includes('SCRIPTS_JS_IGNORED'),
      '把 scripts/*.js 加回去后判据仍报绿 ⇒ 这道闸是装饰（必须能证伪）。实际: ' + JSON.stringify(codes),
    )
  } finally { cleanup(dir) }
})

test('可证伪 · 子目录被整目录规则吞掉 ⇒ 必须报 SCRIPTS_LIB_JS_IGNORED', () => {
  // `scripts/**/*.js` 会连 scripts/lib/ 一起吞，但放行顶层 —— 用来单独触发 G2
  const { dir } = makeRepo('scripts/**/*.js\n!scripts/*.js\n!scripts/lib/*.test.js\n')
  try {
    const codes = codesOf(dir)
    assert.ok(
      codes.includes('SCRIPTS_LIB_JS_IGNORED'),
      '子目录被吞后判据未点名 G2。实际: ' + JSON.stringify(codes),
    )
  } finally { cleanup(dir) }
})

test('可证伪 · 定向忽略 tmp-* 被删掉 ⇒ 必须报 TMP_ESCAPE_MISSING', () => {
  const { dir } = makeRepo('# 没有 tmp-* 规则\n')
  try {
    const codes = codesOf(dir)
    assert.ok(
      codes.includes('TMP_ESCAPE_MISSING'),
      'tmp-* 定向忽略消失后判据未点名 ⇒ 一次性脚本会直接进 git status 而无人察觉。实际: ' + JSON.stringify(codes),
    )
  } finally { cleanup(dir) }
})

// ---------------------------------------------------------------------------
// 2. 文本面（G4）—— 行为巧合通过但规则文本已坏，只有文本断言能抓
// ---------------------------------------------------------------------------

test('可证伪 · 通配 + 精准 negation 让行为全过 ⇒ 文本断言必须抓到 SCRIPTS_JS_WILDCARD_PRESENT', () => {
  // scripts/*.js 仍在，但 `!scripts/__probe*` 恰好放行了两个探测名 ⇒ G1/G2 都是 false。
  // 三个行为断言全过，只有 G4 能发现「规则文本已经坏了」—— 这正是外部评审 i3 指出的盲区。
  const { dir } = makeRepo('scripts/*.js\n!scripts/__probe*\nscripts/tmp-*.js\n')
  try {
    const r = checker.check(dir)
    assert.strictEqual(r.readings.G1_newScriptIgnored, false, '本用例前提：行为面 G1 应为通过')
    assert.strictEqual(r.readings.G2_libScriptIgnored, false, '本用例前提：行为面 G2 应为通过')
    assert.strictEqual(r.readings.G3_tmpScriptIgnored, true, '本用例前提：行为面 G3 应为通过')
    const codes = r.violations.map((v) => v.code)
    assert.ok(
      codes.includes('SCRIPTS_JS_WILDCARD_PRESENT'),
      '行为全过但规则里有整目录通配，文本断言必须点名（否则下一人加个别的后缀就漏）。实际: ' + JSON.stringify(codes),
    )
  } finally { cleanup(dir) }
})

test('可证伪 · 缺 scripts/tmp-*.js 这条定向规则 ⇒ 文本断言报 TMP_ESCAPE_RULE_MISSING', () => {
  const { dir } = makeRepo('# 没有任何 tmp-* 规则\n')
  try {
    const codes = codesOf(dir)
    assert.ok(codes.includes('TMP_ESCAPE_RULE_MISSING'), '缺定向规则时文本断言未点名。实际: ' + JSON.stringify(codes))
  } finally { cleanup(dir) }
})

// ---------------------------------------------------------------------------
// 3. 正控：正确口径下必须全过（证明判据不是恒红）
// ---------------------------------------------------------------------------

test('正控 · 只保留 tmp-* 定向忽略 ⇒ 行为面 + 文本面全过', () => {
  const { dir } = makeRepo('scripts/tmp-*.js\n')
  try {
    const r = checker.check(dir)
    assert.deepStrictEqual(r.violations, [], '正确口径被判红: ' + JSON.stringify(r.violations))
    assert.strictEqual(r.readings.G1_newScriptIgnored, false)
    assert.strictEqual(r.readings.G2_libScriptIgnored, false)
    assert.strictEqual(r.readings.G3_tmpScriptIgnored, true)
    assert.strictEqual(r.readings.G4_badWildcard, 0, '正确口径下整目录通配数必须为 0')
  } finally { cleanup(dir) }
})

// ---------------------------------------------------------------------------
// 4. 真实仓库：当前主干口径必须过
// ---------------------------------------------------------------------------

test('真实仓库：本仓 .gitignore 必须让 scripts/ 下的 .js 默认可入库', () => {
  const r = checker.check(REPO_ROOT)
  assert.deepStrictEqual(
    r.violations,
    [],
    '本仓 .gitignore 违反 change gitignore-scripts-root 的口径: ' + JSON.stringify(r.violations, null, 2),
  )
  assert.strictEqual(r.readings.G1_newScriptIgnored, false, '新脚本被忽略了 —— 旧通配又回来了')
  assert.strictEqual(r.readings.G3_tmpScriptIgnored, true, 'tmp-* 定向忽略丢了')
})

test('真实仓库：scripts/ 下不得存在「未跟踪又被忽略」的 .js（否则那个文件等于隐形）', () => {
  const onDisk = checker.listIgnoredUntrackedScripts(REPO_ROOT)
  assert.deepStrictEqual(
    onDisk,
    [],
    '这些文件在磁盘上存在、git 里却没有，且被 .gitignore 挡住了（新写的判据/工具会因此永远不入仓）: ' +
      JSON.stringify(onDisk, null, 2),
  )
})

// ---------------------------------------------------------------------------
// 4. 判据自身故障必须与「没有问题」分开
// ---------------------------------------------------------------------------

test('判据自身故障：不在 git 仓库内 ⇒ isIgnored 必须抛错，不得静默返回 false', () => {
  const outside = fs.mkdtempSync(path.join(os.tmpdir(), 'gi-notrepo-'))
  try {
    assert.throws(
      () => checker.isIgnored(outside, 'scripts/x.js'),
      /git check-ignore 异常退出/,
      '在非 git 目录里 git 会以非 0/1 状态退出，判据必须抛错而不是把"读不到"当成"没被忽略"',
    )
  } finally { cleanup(outside) }
})

test('CLI 入口：真实仓库 ⇒ 退出码 0 且打印 PASS', () => {
  const out = execFileSync(process.execPath, [path.join(__dirname, 'check-gitignore-scripts.js')], {
    cwd: REPO_ROOT, encoding: 'utf8',
  })
  assert.match(out, /\[check-gitignore-scripts\] PASS/)
  assert.match(out, /G1 新脚本被忽略/)
})
