'use strict'
/**
 * 清点判据的回归锁（change: ci-judge-surface-coverage，tasks 3.x）。
 * 注入式：closure / tracked / waiversRaw 都可替，所以每条违规都能在没有真仓的情况下复现
 * ——但**至少一条**必须跑真实仓，否则「夹具自洽而生产不同形」这一族会原样复发。
 */
const test = require('node:test')
const assert = require('node:assert')
const fs = require('node:fs')
const path = require('path')

const gate = require('./check-judge-surface-coverage.js')
const JC = require('./lib/judge-closure.js')
const PR = require('./check-pr-exec-record.js')

const REPO = path.resolve(__dirname, '..')
/**
 * 合成闭包必须**满足规模下界**：夹具若不满足，每个用例都会先撞上「解析退化」那两条红，
 * 于是它测的就不是豁免/空转，而是自己的夹具形状（AGENTS：夹具该更像真实形态，别改断言）。
 */
function goodClosure () {
  const files = ['scripts/check-a.js']
  while (files.length < JC.MIN_FILES) files.push('scripts/lib/b' + files.length + '.js')
  return {
    entries: JC.MIN_ENTRIES,
    files,
    libFiles: Math.max(JC.MIN_LIB_FILES, files.filter((f) => f.startsWith('scripts/lib/')).length),
    dynamicRequireLike: 0,
    unresolved: [],
    selfFault: null,
  }
}
const goodTracked = () => PR.HIGH_RISK_SURFACES.map((s) => (s.prefix.indexOf('/') >= 0 ? s.prefix + 'x.js' : 'x' + s.prefix + 'y.js'))

test('真实仓必须 PASS，且读数行自带全部分母（空集也必须出行）', () => {
  const r = gate.scan({ repo: REPO })
  assert.strictEqual(r.rc, 0, `实得 rc=${r.rc}：${r.lines.join(' | ')}`)
  assert.match(r.lines[0], /^JUDGE-SURFACE-SCAN /)
  for (const k of ['entries=', 'files=', 'lib=', 'dynamic=', 'unresolved=', 'waived=', 'derived-only=', 'dead-prefix=', 'verdict=']) {
    assert.ok(r.lines[0].includes(k), `读数行缺字段 ${k}：${r.lines[0]}`)
  }
  assert.ok(r.counts.entries >= JC.MIN_ENTRIES, r.lines[0])
  assert.ok(r.counts.derivedOnly >= 1,
    `派生面独有（不在任何前缀上）必须 > 0，否则本片的存在理由就没了：${r.lines[0]}`)
})

test('规模退化（下界不达标）必须红，且不得与"零违规"同形 —— M5', () => {
  const c = goodClosure()
  c.entries = 3
  const r = gate.scan({ repo: REPO, closure: c, tracked: goodTracked(), waiversRaw: null })
  assert.strictEqual(r.rc, 1)
  assert.ok(r.violations.some((v) => /入口数 3 < 下界/.test(v)), JSON.stringify(r.violations))
  const c2 = goodClosure()
  c2.files = []
  c2.libFiles = 0
  const r2 = gate.scan({ repo: REPO, closure: c2, tracked: goodTracked(), waiversRaw: null })
  assert.ok(r2.violations.some((v) => /闭包文件数 0 < 下界/.test(v)), JSON.stringify(r2.violations))
})

test('闭包取不到读数 ⇒ rc=2（判据自身故障档），不得混进 rc=1「发现违规」', () => {
  const c = goodClosure()
  c.selfFault = 'scripts/ 目录读不到：ENOENT'
  const r = gate.scan({ repo: REPO, closure: c, tracked: goodTracked(), waiversRaw: null })
  assert.strictEqual(r.rc, 2, `实得 rc=${r.rc} verdict=${r.verdict}：${r.lines.join(' | ')}`)
  assert.strictEqual(r.verdict, 'SELF-FAULT')
  assert.deepStrictEqual(r.violations, [], '故障时不得顺手造违规（两档动作对象不同：一个修工具，一个修代码）')
})

test('豁免四条逐个点名 —— M3/M4（空 reason、超上限、陈旧键、闭包外发牌）', () => {
  const c = goodClosure()
  const member = c.files[1] // 合成闭包里真实存在的成员，豁免它才算"在放宽面"
  const base = { repo: REPO, closure: c, tracked: goodTracked() }
  const emptyReason = gate.scan({ ...base, waiversRaw: JSON.stringify({ [member]: '  ' }) })
  assert.strictEqual(emptyReason.rc, 1)
  assert.ok(emptyReason.violations.some((v) => v.includes('的理由不成立') && v.includes(member)),
    `必须点名是哪一条豁免坏掉，实得 ${JSON.stringify(emptyReason.violations)}`)

  const ceiling = gate.scan({ ...base, waiversRaw: JSON.stringify({ [member]: '只放常量，无判定分支' }) })
  assert.ok(ceiling.violations.some((v) => /豁免条数 1 > 上限 0/.test(v)),
    '抬上限是在放宽「谁来守门」，必须当场红，不能被"写了理由"消解：' + JSON.stringify(ceiling.violations))

  const stale = gate.scan({ ...base, waiversRaw: JSON.stringify({ 'scripts/lib/never-was-here.js': '曾经不算判定' }) })
  assert.ok(stale.violations.some((v) => /不在判据闭包里/.test(v)), JSON.stringify(stale.violations))

  const brokenJson = gate.scan({ ...base, waiversRaw: '{ oops' })
  assert.strictEqual(brokenJson.rc, 1, '清单读不动是**违规**（有人把它写坏了），不是判据自身故障')
  assert.ok(brokenJson.violations.some((v) => /读不动/.test(v)), JSON.stringify(brokenJson.violations))

  const missing = gate.scan({ ...base, waiversRaw: null })
  assert.strictEqual(missing.rc, 0, `文件缺席＝零豁免（安全方向），不得反过来造一条红：${JSON.stringify(missing.violations)}`)
})

test('空转条目锁：命中 0 的前缀必须被点名，且计数走判据自己的匹配实现 —— M9/M10', () => {
  const r = gate.scan({
    repo: REPO,
    closure: goodClosure(),
    tracked: ['scripts/check-a.js', 'scripts/lib/main-red.js'],
    waiversRaw: null,
  })
  const dead = r.violations.filter((v) => /命中 0 个受管文件/.test(v))
  assert.ok(dead.length >= 1, JSON.stringify(r.violations))
  assert.ok(dead.some((v) => /credential-/.test(v)), '凭证那条在这个 tracked 域里必然空转，必须被指名')

  // `fingerprint` 那条自带 exts：用裸前缀比会把"讲到指纹的文档"也算命中（谎报覆盖面）。
  const fp = PR.HIGH_RISK_SURFACES.find((s) => s.prefix === 'fingerprint')
  assert.ok(fp && Array.isArray(fp.exts), '前置条件：fingerprint 条目必须仍自带 exts 限定')
  const docOnly = gate.scan({
    repo: REPO,
    closure: goodClosure(),
    tracked: ['01-docs/fingerprint-analysis.md', 'scripts/check-a.js'].concat(PR.HIGH_RISK_SURFACES
      .filter((s) => s.prefix !== 'fingerprint').map((s) => s.prefix + 'x.js')),
    waiversRaw: null,
  })
  assert.ok(docOnly.violations.some((v) => /^高危面条目 fingerprint 在当前实现下命中 0/.test(v)),
    '只给一份"讲到指纹的文档"不得算命中 ⇒ 证明计数确实复用了带 exts 的实现：' + JSON.stringify(docOnly.violations))
})

test('结构锁：清点判据不得自带第二份前缀匹配实现', () => {
  const src = fs.readFileSync(path.join(__dirname, 'check-judge-surface-coverage.js'), 'utf8')
  // 按**语义位置**切：解释性注释里提到被禁写法不该把锁打红（AGENTS 一天内实测打红三次的同族错法）。
  // 判据本体也刻意不再原样引用那些字面量，两条一起才是稳的。
  const code = PR.stripCommentsForScan(src)
  assert.ok(!/indexOf\(\s*s\.prefix\s*\)/.test(code) && !/startsWith\(\s*s\.prefix\s*\)/.test(code) && !/includes\(\s*s\.prefix\s*\)/.test(code),
    '在这里重写一遍前缀比较＝两把尺子；清点报「命中 3 个」而收口矩阵报「没命中」时没人能发现')
  assert.match(code, /highRiskPrefixOf\(/, '必须走 check-pr-exec-record 导出的唯一实现')
  // 允许"逐条问它命中几个"这种**计数**遍历（那是本判据的本职），不允许第二份**匹配**——
  // 上面三条拦的就是后者；X2-12 那条锁只约束判据文件内部，不约束这里，别混为一谈。
})

test('未解析项现在是真信号：注释噪声必须已被剥掉（否则这条读数恒红、等于恒绿）', () => {
  const r = gate.scan({ repo: REPO })
  assert.strictEqual(r.counts.unresolved, 0, `真实仓不得有 unresolved：${r.lines[0]}`)
  const c = goodClosure()
  c.unresolved = ['scripts\\$REC']
  const r2 = gate.scan({ repo: REPO, closure: c, tracked: goodTracked(), waiversRaw: null })
  assert.ok(r2.violations.some((v) => /相对 require 解析不到/.test(v)), JSON.stringify(r2.violations))
})

test('未知旗标不得被静默忽略（参数面也要 fail-loud）', () => {
  assert.throws(() => gate.parseArgs(['--verbose']), /未知旗标/)
  assert.deepStrictEqual(gate.parseArgs(['--report', '--repo=/tmp/x']), { repo: '/tmp/x', report: true })
})
