'use strict'
/**
 * 判据闭包真源的回归锁（change: ci-judge-surface-coverage）。
 * 夹具一律在 os.tmpdir() 下自建（PID + 随机后缀），不碰仓库；每个用例自建独立目录，
 * 避免"模块级 Set/Map 跨用例状态"这一族既有坑。
 */
const test = require('node:test')
const assert = require('node:assert')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const lib = require('./judge-closure.js')

function mkRepo (files) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'judge-closure-' + process.pid + '-'))
  for (const [rel, body] of Object.entries(files)) {
    const abs = path.join(dir, rel)
    fs.mkdirSync(path.dirname(abs), { recursive: true })
    fs.writeFileSync(abs, body)
  }
  return dir
}
const cleanup = (dir) => { try { fs.rmSync(dir, { recursive: true, force: true }) } catch { /* 临时目录交给 OS */ } }

test('入口识别：check-/ccg-review-/deep-review 算入口，测试文件与普通脚本不算', () => {
  assert.strictEqual(lib.isJudgeEntryName('check-pr-exec-record.js'), true)
  assert.strictEqual(lib.isJudgeEntryName('ccg-review-writeback.js'), true)
  assert.strictEqual(lib.isJudgeEntryName('deep-review.sh'), true)
  // 这条是本探针第一版真实犯过的错：`check-x.test.js` 的 basename 命中 ^check- ⇒ 被当入口，
  // 于是入口数从 47 虚报成 90，并把测试夹具拖进分类域。
  assert.strictEqual(lib.isJudgeEntryName('check-pr-exec-record.test.js'), false, '测试文件不得算入口')
  assert.strictEqual(lib.isJudgeEntryName('aggregate-changelog.js'), false)
  assert.strictEqual(lib.isJudgeEntryName('lib/main-red.js'), false)
})

test('闭包跟相对 require 传递，跨目录（../）也要跟到', () => {
  const dir = mkRepo({
    'scripts/check-a.js': "require('./lib/m');\n",
    'scripts/lib/m.js': "require('../lib2/n');\nmodule.exports = {};\n",
    'scripts/lib2/n.js': 'module.exports = {};\n',
  })
  try {
    const r = lib.computeJudgeClosure(dir)
    assert.ok(r.files.includes('scripts/lib/m.js'), '一层相对 require')
    assert.ok(r.files.includes('scripts/lib2/n.js'), '跨目录 ../ 必须跟到 —— 漏掉它等于给判据留隐身衣')
    assert.ok(r.files.includes('scripts/check-a.js'), '入口自身也在域内')
  } finally { cleanup(dir) }
})

test('只被测试 require 的文件 MUST NOT 进闭包（否则夹具会被当成判据面）', () => {
  const dir = mkRepo({
    'scripts/check-a.js': "require('./lib/helper');\n",
    'scripts/lib/helper.js': 'module.exports = {};\n',
    'scripts/lib/only-test.js': 'module.exports = {};\n',
    'scripts/lib/helper.test.js': "require('./only-test');\n",
  })
  try {
    const r = lib.computeJudgeClosure(dir)
    assert.ok(r.files.includes('scripts/lib/helper.js'))
    assert.ok(!r.files.includes('scripts/lib/only-test.js'),
      'only-test.js 只被测试 require ⇒ 不得进域；它哪天被生产判据 require 才会自己进来')
  } finally { cleanup(dir) }
})

test('测试文件不作为闭包节点展开（被生产 require 的测试也不追进去）', () => {
  const dir = mkRepo({
    'scripts/check-a.js': "require('./weird.test.js');\n",
    'scripts/weird.test.js': "require('./lib/behind-test');\n",
    'scripts/lib/behind-test.js': 'module.exports = {};\n',
  })
  try {
    const r = lib.computeJudgeClosure(dir)
    assert.ok(!r.files.includes('scripts/weird.test.js'), '测试文件本身不进域')
    assert.ok(!r.files.includes('scripts/lib/behind-test.js'), '测试后面的 require 也不展开')
  } finally { cleanup(dir) }
})

test('环引用必须终止，且环内文件仍进域', () => {
  const dir = mkRepo({
    'scripts/check-a.js': "require('./lib/x');\n",
    'scripts/lib/x.js': "require('./y');\n",
    'scripts/lib/y.js': "require('./x');\n",
  })
  try {
    const r = lib.computeJudgeClosure(dir)
    assert.ok(r.files.includes('scripts/lib/x.js') && r.files.includes('scripts/lib/y.js'))
    assert.strictEqual(new Set(r.files).size, r.files.length, '不得重复计同一文件（重复会让规模读数虚高）')
  } finally { cleanup(dir) }
})

test('动态拼接的 require 进不了闭包，但 MUST 被计数出声（不承诺覆盖）', () => {
  const dir = mkRepo({
    'scripts/check-a.js': "const p = './lib/';\nrequire(p + 'dyn');\n",
    'scripts/lib/dyn.js': 'module.exports = {};\n',
  })
  try {
    const r = lib.computeJudgeClosure(dir)
    assert.ok(!r.files.includes('scripts/lib/dyn.js'), '实现上就是看不见 —— 这条边界必须如实而不是假装覆盖')
    assert.ok(r.dynamicRequireLike >= 1, '但必须计数出声：否则"看不见"会被读成"没有"')
  } finally { cleanup(dir) }
})

test('取不到目录时返回零读数并带 selfFault，MUST NOT 抛裸栈', () => {
  const r = lib.computeJudgeClosure(path.join(os.tmpdir(), 'definitely-not-here-' + process.pid + '-' + Date.now()))
  assert.strictEqual(r.entries, 0)
  assert.strictEqual(r.files.length, 0)
  assert.ok(typeof r.selfFault === 'string' && r.selfFault !== '',
    '零入口必须是**可区分的故障**，不能与"这个仓没有判据"同形')
})

test('真实仓的闭包规模 MUST 有下界（解析退化成空集时，本文件当场红）', () => {
  const repoRoot = path.resolve(__dirname, '..', '..')
  const r = lib.computeJudgeClosure(repoRoot)
  // 下界取自 lib 自己导出的常量（唯一一份）：这里再抄一遍数字，就是给"两处必漂移"留坑。
  assert.ok(r.entries >= lib.MIN_ENTRIES, `判据入口数远低于预期 ⇒ 入口识别漂了，实得 ${r.entries}（下界 ${lib.MIN_ENTRIES}）`)
  assert.ok(r.files.length >= lib.MIN_FILES, `闭包文件数远低于预期 ⇒ require 解析漂了，实得 ${r.files.length}（下界 ${lib.MIN_FILES}）`)
  assert.ok(r.libFiles >= lib.MIN_LIB_FILES, `lib 可达数远低于预期 ⇒ 跨目录跟进漂了，实得 ${r.libFiles}（下界 ${lib.MIN_LIB_FILES}）`)
  assert.strictEqual(r.selfFault, null, '真实仓上不得有 selfFault —— 有就是判据自身故障，不是"没有未分类文件"')
  assert.ok(r.files.every((f) => f.startsWith('scripts/')), '域必须限定在 scripts/ 内')
  assert.ok(r.files.every((f) => !/\.test\.[cm]?js$/.test(f)), '域内不得有测试文件')
  // 散文里的示例写法不得造出 unresolved（实测三条 unresolved 全部来自注释：`scripts\$REC`、
  // `scripts\lib\x`、`scripts\z.js`）。留着它们，「unresolved>0」这条读数就永远是噪声，
  // 于是下一次真的有一条相对 require 解析不到时，没人会从这行里看出来。
  assert.deepStrictEqual(r.unresolved, [], `未解析项必须为空（非空即"我漏看了一个文件"），实得 ${JSON.stringify(r.unresolved)}`)
})

test('path.join 形态的 require 必须被解析（实测洞：gate-timeout-registry.js 只被这种写法引用）', () => {
  const dir = mkRepo({
    'scripts/check-a.js': "const registryLib = require(path.join(__dirname, 'lib', 'gate.js'));\n",
    'scripts/lib/gate.js': 'module.exports = {};\n',
  })
  try {
    const r = lib.computeJudgeClosure(dir)
    assert.ok(r.files.includes('scripts/lib/gate.js'),
      '字面量分段的 path.join 在静态上就是可定的；放过它＝把一条真实存在的判定依赖读成"没人引用"')
    assert.strictEqual(r.dynamicRequireLike, 0,
      '能被解析的就不该记在 dynamic 账上 —— 两类混记会让 dynamic 读数失去"这里可能有漏"的含义')
  } finally { cleanup(dir) }
})

test('豁免清单解析：非字符串或空串一律拒，且必须由同一份实现读（不得两处各抄）', () => {
  const good = { 'scripts/lib/x.js': '只产出读数，不改判定结论' }
  assert.deepStrictEqual(lib.validateWaivers(good), { ok: true, bad: [] })
  const bad = { 'scripts/lib/a.js': '', 'scripts/lib/b.js': true, 'scripts/lib/c.js': '  ', 'scripts/lib/d.js': 42 }
  const r = lib.validateWaivers(bad)
  assert.strictEqual(r.ok, false)
  assert.deepStrictEqual(r.bad.map((e) => e.key).sort(),
    ['scripts/lib/a.js', 'scripts/lib/b.js', 'scripts/lib/c.js', 'scripts/lib/d.js'],
    '四个坏值必须逐个点名 —— 只报"有非法项"会让人去猜是哪一个')
  assert.strictEqual(lib.validateWaivers(null).ok, false, '清单缺失/不可解析按故障，不按"没有豁免"')
})

test('注释里的示例写法不得进任何账（散文不是依赖图）', () => {
  const dir = mkRepo({
    'scripts/check-a.js': [
      '/**',
      ' * 只跟字面量：`require(\'./missing.js\')` 这种写法在注释里出现不算依赖。',
      ' */',
      "// require('./nope.js')",
      '#!/bin/sh',
      "require('./real.js')",
      '',
    ].join('\n'),
    'scripts/real.js': 'module.exports = {};\n',
  })
  try {
    const r = lib.computeJudgeClosure(dir)
    assert.deepStrictEqual(r.unresolved, [], `注释造出的未解析项必须被剥掉，实得 ${JSON.stringify(r.unresolved)}`)
    assert.strictEqual(r.dynamicRequireLike, 0, '注释里的 `require(prefix + name)` 不是动态依赖')
    assert.ok(r.files.includes('scripts/real.js'), '真实那一行仍必须被跟到（剥注释不得把信号一起剥掉）')
  } finally { cleanup(dir) }
})

test('行内注释里的 require MUST NOT 成为依赖边（QM-6 轮 1 i3，实测原状会造一条假 unresolved）', () => {
  const dir = mkRepo({
    'scripts/check-a.js': [
      "const x = 1 // require('./fake.js')",
      "const url = 'https://example.com/a//b'; require('./after.js')",
      "require('./real.js')",
      '',
    ].join('\n'),
    'scripts/real.js': 'module.exports = {};\n',
    'scripts/after.js': 'module.exports = {};\n',
  })
  try {
    const r = lib.computeJudgeClosure(dir)
    assert.deepStrictEqual(r.unresolved, [],
      `行注释里的示例写法不该产生未解析项，实得 ${JSON.stringify(r.unresolved)}`)
    assert.ok(r.files.includes('scripts/real.js') && r.files.includes('scripts/after.js'),
      '真实依赖必须照旧抓到（含"字符串里带 // 的同一行后面还有真 require"这一正控）')
    assert.ok(!r.files.includes('scripts/fake.js'), '被注释掉的文件不得因为"有人在行尾写了它"就进面')
  } finally { cleanup(dir) }
})

test('跨行块注释内的示例写法 MUST NOT 成为依赖边（QM-6 轮 2 i4，实测原状会造假 unresolved）', () => {
  const dir = mkRepo({
    'scripts/check-a.js': [
      '/*',
      'const a = 1',
      "   require('./doc-example.js')",
      '*/',
      "const b = require('./after-block.js')",
      '',
    ].join('\n'),
    'scripts/after-block.js': 'module.exports = {};\n',
  })
  try {
    const r = lib.computeJudgeClosure(dir)
    assert.deepStrictEqual(r.unresolved, [],
      `块注释中间行不得产生未解析项，实得 ${JSON.stringify(r.unresolved)}`)
    assert.ok(r.files.includes('scripts/after-block.js'), '块注释**之后**的真依赖必须照旧抓到（剥块注释不得把信号一起吃掉）')
    assert.strictEqual(r.dynamicRequireLike, 0, '块注释里的 require(prefix + name) 不得抬动 dynamic 账')
  } finally { cleanup(dir) }
})

test('真实仓现场：gate-timeout-registry.js 必须进闭包（本片自己量出来的那个洞，堵上后要留证据）', () => {
  const r = lib.computeJudgeClosure(path.resolve(__dirname, '..', '..'))
  assert.ok(r.files.includes('scripts/lib/gate-timeout-registry.js'),
    `它唯一的入边是 require(path.join(__dirname, 'lib', ...))，实得 files 里有没有：${r.files.includes('scripts/lib/gate-timeout-registry.js')}；`
    + '这条不是修辞 —— 2026-10-26 现场量到它在闭包外，而它决定每条 gate 的超时预算')
  assert.ok(r.dynamicRequireLike >= 1,
    `真·变量参数的 require（require(f) / require(file)）必须还剩读数，实得 ${r.dynamicRequireLike}；`
    + '归零意味着计数器被"顺手"改成恒 0，那这条边界就又变成装饰了')
})

test('shell 文件里的 %/* 与 // MUST NOT 被当块注释（i4 修复自己引入的假阴性，由读数变化抓到）', () => {
  const dir = mkRepo({
    // deep-review.sh:41 的真实形态：`*/*) _self_dir="${_self_dir%/*}" ;;` —— 参数展开不是块注释
    'scripts/check-a.sh': [
      '#!/bin/sh',
      'case "$x" in',
      '  */*) _self_dir="${_self_dir%/*}" ;;',
      '  /*) echo 绝对路径 ;;',
      'esac',
      "node -e \"const m = require('./real.js')\"",
      '',
    ].join('\n'),
    'scripts/real.js': 'module.exports = {};\n',
  })
  try {
    const r = lib.computeJudgeClosure(dir)
    assert.ok(r.files.includes('scripts/real.js'),
      `被 shell 的 %/* 误当块注释后，这条真依赖会静默消失（files=${JSON.stringify(r.files)}）`)
    assert.deepStrictEqual(r.unresolved, [], `shell 行不得产生未解析项，实得 ${JSON.stringify(r.unresolved)}`)
  } finally { cleanup(dir) }
})

test('规则按语言分档：JS 才用 // 与 块注释，shell/ps1 只认整行 #', () => {
  const dir = mkRepo({
    'scripts/check-a.js': '/* 说明\nconst a = require("./x.js") // 尾注里的 require("./nope.js")\n*/\nrequire("./y.js")\n',
    'scripts/check-b.sh': '# 说明 require("./nope.js")\nnode -e "require(\'./z.js\')"\n',
    'scripts/x.js': 'module.exports = {}\n',
    'scripts/y.js': 'module.exports = {}\n',
    'scripts/z.js': 'module.exports = {}\n',
  })
  try {
    const r = lib.computeJudgeClosure(dir)
    assert.ok(r.files.includes('scripts/y.js'), 'JS 块注释**结束后**的真依赖必须抓到')
    assert.ok(!r.files.includes('scripts/x.js'), '块注释内的不算（i4 那一半不能因为分语言而退回）')
    assert.ok(!r.files.includes('scripts/nope.js'), 'JS 行尾注释里的不算')
    assert.ok(r.files.includes('scripts/z.js'), 'shell 里的真依赖必须抓到，且不受 JS 那套规则牵连')
    assert.deepStrictEqual(r.unresolved, [], `两种语言都不该产生未解析项，实得 ${JSON.stringify(r.unresolved)}`)
  } finally { cleanup(dir) }
})
