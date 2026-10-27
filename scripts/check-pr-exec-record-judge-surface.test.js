// Regression tests for the **derived** high-risk surface in scripts/check-pr-exec-record.js
// (change: ci-judge-surface-coverage，2026-10-26，tasks 2.1–2.4)
//
// Why this file exists (measured before being relied on，见 design D0/D1):
//   `HIGH_RISK_SURFACES` 是按路径前缀的清单，而判据的实质内容大量住在 `scripts/lib/` 下。
//   实测 47 个判据入口沿字面量相对 require 可达 67 个仓内脚本，其中 **19 个不在任何前缀上**，
//   含 `scripts/lib/main-red.js`（什么时候不许往 main 上合）、`scripts/classify-docs-only.js`
//   （决定哪些重型门根本没跑）、`scripts/lib/ccg-external-review-honor.js`（高危阻断该不该扣）。
//   ⇒ 只改这些文件的 PR 会被读成「与守门无关」。这不是设想：清单里 `scripts/lib/ccg-review-`
//   那条的 `why` 原文就写着上一轮同一个坑（跨家族轴 X2-9）被这样补了一格。
//
// 本文件锁的是四件事，每件对应 design D9 的一条变异：
//   M1 派生面真的把闭包成员拉进高危域（否则本片等于没做）
//   M2 闭包算不出 ⇒ 按「未证实」出声，**不得**读成"不在高危面"
//   M8 一次判定只走一次图（注入缓存对象，不得每个文件重算）
//   M3/M4 豁免只减不增、形状坏即未证实（本文件测运行时侧形状；清点侧见 check-judge-surface-coverage.test.js）
//
//   node --test scripts/check-pr-exec-record-judge-surface.test.js

const { test } = require('node:test')
const assert = require('node:assert')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const { execFileSync } = require('node:child_process')

const mod = require('./check-pr-exec-record.js')

const st = (list) => list.map(([status, file]) => ({ status, file }))
const REPO_ROOT = path.join(__dirname, '..')

/** 真实仓的派生面上下文（只算一次，多条用例共用 —— 它本身要走 67 个文件的图） */
function realCtx () {
  return mod.makeJudgeSurfaceContext(REPO_ROOT)
}

function mkTmp (prefix) {
  return fs.mkdtempSync(path.join(os.tmpdir(), prefix))
}

/**
 * 真实仓里必须存在的 `scripts/` 目录形态：判据跑在仓根，`scripts/` 一定在。
 * 夹具若不 seed，量的就是「这个临时目录不是一个仓」，与生产不同形。
 * @param {string} repo 临时仓根
 * @param {string} [depReq] 写进入口里的那条相对 require（如 `./lib/seed-dep.js`），省略则入口无依赖
 */
function seedJudgeScripts (repo, depReq) {
  fs.mkdirSync(path.join(repo, 'scripts', 'lib'), { recursive: true })
  const req = typeof depReq === 'string' && depReq.length > 0
    ? `require('${depReq}')\n`
    : ''
  fs.writeFileSync(path.join(repo, 'scripts', 'check-seed.js'), req, 'utf8')
  fs.writeFileSync(path.join(repo, 'scripts', 'lib', 'seed-dep.js'), 'module.exports = {}\n', 'utf8')
  return repo
}

const ART = '.ccg/reviews/' + 'c'.repeat(64) + '.json'
const DERIVED_MEMBER = 'scripts/lib/main-red.js' // 实测不在任何前缀上、但在闭包内（design D0 三件最要命漏网文件之一）
/** 一篇「以 closureNote 收口」的产物：非高危面放过、高危面拦 —— 本组用例的正反两面共用它 */
const NOTE_ONLY = {
  mode: 'dual',
  deepReview: {
    required: true,
    status: 'cleared',
    performedBy: 'self-play',
    findings: null,
    closureNote: '第 3 轮评审 i1 判为假阳性：该分支已由用例钉住，本轮驳回并登记',
  },
}

// ── M1：派生面必须真的把闭包成员拉进高危域 ────────────────────────────────────

test('派生面：闭包成员即使不在任何前缀上，也必须被认成高危面（本片的立项证据不得只写在文档里）', () => {
  const ctx = realCtx()
  assert.strictEqual(ctx.selfFault, null, `真实仓的闭包必须算得出来，实际 ${ctx.selfFault}`)
  assert.ok(ctx.entries >= mod.JUDGE_MIN_ENTRIES, `入口数不得小于下界，实际 ${ctx.entries}`)
  for (const f of [DERIVED_MEMBER, 'scripts/lib/ccg-external-review-honor.js', 'scripts/classify-docs-only.js']) {
    assert.strictEqual(mod.highRiskPrefixOf(f, ctx), mod.JUDGE_CLOSURE_PREFIX,
      `${f} 是判据闭包成员 ⇒ 必须命中派生面；读成 null 就是本片要消灭的那一格`)
  }
})

test('派生面：只改一个闭包成员的 PR，必须让 closureNote 出口失效（旧行为是"非高危面够用"）', () => {
  const repo = mkTmp('js-derived-')
  seedJudgeScripts(repo)
  const full = path.join(repo, ART)
  fs.mkdirSync(path.dirname(full), { recursive: true })
  fs.writeFileSync(full, JSON.stringify(NOTE_ONLY), 'utf8')
  try {
    const ctx = realCtx()
    const without = mod.evaluateDeepReviewDebt(st([['A', ART], ['M', DERIVED_MEMBER]]), repo, () => null)
    const withDerived = mod.evaluateDeepReviewDebt(st([['A', ART], ['M', DERIVED_MEMBER]]), repo, () => null, undefined, ctx)
    const hitNote = (r) => (r.reasons || []).some((x) => /收口不成立/.test(x))
    assert.ok(!hitNote(without), '不注入真实仓闭包时（临时仓只有 seed 入口），该变更集不在任何面上 ⇒ closureNote 够用（旧语义，必须仍是这样）')
    assert.ok(hitNote(withDerived),
      `注入派生面后必须判收口不成立 —— 这条红就是"改判据本体要有外部复核"的落点`)
    const block = withDerived.reasons.find((x) => /收口不成立/.test(x)) || ''
    assert.ok(block.includes(mod.JUDGE_CLOSURE_PREFIX),
      `红文案必须点名是"派生面"把变更集拉进来的（可归因纪律），实际 ${JSON.stringify(block.slice(0, 240))}`)
    assert.ok(block.includes(DERIVED_MEMBER), `红文案必须点名是哪个文件，实际 ${JSON.stringify(block.slice(0, 240))}`)
  } finally { fs.rmSync(repo, { recursive: true, force: true }) }
})

test('派生面不得吞掉前缀语义：前缀命中时返回的还是那条前缀（点名归属不能被合并成一格）', () => {
  const ctx = realCtx()
  assert.strictEqual(mod.highRiskPrefixOf('scripts/check-pr-exec-record.js', ctx), 'scripts/check-',
    '判据本体自指那条前缀必须仍然按前缀归因，不得被派生面盖成"scripts/lib/(判据闭包派生)"')
  assert.strictEqual(mod.highRiskPrefixOf('01-docs/PRD.md', ctx), null,
    '非成员、非前缀的文件不得因为"仓里有个闭包"就被拉进高危面')
})

// ── M2：算不出闭包 ⇒ 未证实，不得读成"不在高危面" ─────────────────────────────

test('闭包算不出 ⇒ 必须自己出一条「高危面派生未取证」，且不得与「期望后端取不到」合并成一句', () => {
  const repo = mkTmp('js-selffault-')
  seedJudgeScripts(repo)
  const full = path.join(repo, ART)
  fs.mkdirSync(path.dirname(full), { recursive: true })
  fs.writeFileSync(full, JSON.stringify(NOTE_ONLY), 'utf8')
  const broken = { prefix: mod.JUDGE_CLOSURE_PREFIX, members: new Set(), waived: [], entries: 0, files: [], selfFault: 'scripts/ 目录读不到：模拟' }
  try {
    const r = mod.evaluateDeepReviewDebt(st([['A', ART], ['M', DERIVED_MEMBER]]), repo, () => null, undefined, broken)
    const mine = (r.reasons || []).filter((x) => /高危面派生未取证/.test(x))
    assert.strictEqual(mine.length, 1, `必须恰好一条，实际 ${(r.reasons || []).length} 条：${JSON.stringify(r.reasons)}`)
    assert.match(mine[0], /不得读成「不在高危面」/, `红文案要写出误读方向，实际 ${mine[0]}`)
    assert.ok(!(r.reasons || []).some((x) => /期望后端/.test(x)),
      '「判据自身未取证」一族的两条成因必须分行：把「闭包算不出」塞进「期望后端取不到」的文案里，'
      + '排障的人会被支使去查一份没坏的清单（本仓 fail-closed 兜底文案不得合并成因）')
  } finally { fs.rmSync(repo, { recursive: true, force: true }) }
})

test('真实仓根之外没有 scripts/ 的目录：必须报 selfFault，不得报「闭包为空」后静默放行', () => {
  const bare = mkTmp('js-bare-')
  try {
    const ctx = mod.makeJudgeSurfaceContext(bare)
    assert.ok(typeof ctx.selfFault === 'string' && ctx.selfFault.length > 0,
      '一个不是仓的目录必须被认成"判据自身故障"，否则"零成员"读起来像"这个仓没有判据"')
    assert.strictEqual(ctx.members.size, 0, 'selfFault 时成员集必须为空（不得猜）')
    const line = mod.summarizeJudgeSurface(ctx).line
    assert.match(line, /selfFault=/, `读数行必须自带"我坏了"的字段，实际 ${line}`)
  } finally { fs.rmSync(bare, { recursive: true, force: true }) }
})

// ── M8：一次判定只走一次图 ────────────────────────────────────────────────────

test('上下文建好后删掉仓目录仍能答 ⇒ 证明匹配时不再重走图', () => {
  const repo = mkTmp('js-once-')
  seedJudgeScripts(repo, './lib/seed-dep.js')
  const ctx = mod.makeJudgeSurfaceContext(repo)
  assert.strictEqual(ctx.selfFault, null)
  assert.ok(ctx.members.has('scripts/lib/seed-dep.js'), '跨目录可达的依赖必须进成员集（M6：`../`、`./` 都要跟）')
  fs.rmSync(repo, { recursive: true, force: true })
  assert.strictEqual(mod.highRiskPrefixOf('scripts/lib/seed-dep.js', ctx), mod.JUDGE_CLOSURE_PREFIX,
    '目录已不存在仍能答 ⇒ 匹配只读注入的集合；若这里去重算闭包，它会变成 null（每个文件重走一次图）')
})

test('结构锁：per-file 匹配函数体内不得出现闭包计算（第二份遍历＝性能地雷＋口径分裂）', () => {
  const src = fs.readFileSync(path.join(__dirname, 'check-pr-exec-record.js'), 'utf8')
  const start = src.indexOf('function highRiskPrefixOf')
  const end = src.indexOf('\n}', start)
  assert.ok(start >= 0 && end > start, '锚点定位失败 ⇒ 本锁测量域不可信')
  const body = src.slice(start, end)
  assert.ok(!/computeJudgeClosure|makeJudgeSurfaceContext/.test(body),
    'highRiskPrefixOf 只准读注入的集合；在这里算闭包＝每个文件走一次图')
  const debtStart = src.indexOf('function evaluateDeepReviewDebt')
  assert.ok(debtStart >= 0)
  const debtBody = src.slice(debtStart, src.indexOf('\n}', debtStart))
  const calls = (debtBody.match(/makeJudgeSurfaceContext\(/g) || []).length
  assert.ok(calls <= 1, `一次判定最多建一次上下文（实际 ${calls}）`)
})

// ── 兼容面：省略 ctx 必须逐字保持旧前缀语义（既有 154 条用例的契约） ────────────

test('省略第二个参数 ⇒ 逐字退回"只看前缀"（既有消费点不得被我这次改动悄悄变严）', () => {
  assert.strictEqual(mod.highRiskPrefixOf(DERIVED_MEMBER), null,
    '不注入上下文时，闭包成员不得自动进面 —— 这是给旧调用点保留的语义，不是后门：'
    + '生产入口（main）始终注入，且上一条用例已锁"注入后必须命中"')
  assert.strictEqual(mod.isHighRiskSurface(DERIVED_MEMBER), false)
  assert.strictEqual(mod.isHighRiskSurface(DERIVED_MEMBER, realCtx()), true)
})

// ── 豁免：只减不增，形状坏即未证实 ────────────────────────────────────────────

test('豁免清单里的成员不再算派生面，但前缀命中不受豁免影响（豁免是给派生档发的，不是给清单发的）', () => {
  const repo = mkTmp('js-waive-')
  seedJudgeScripts(repo, './lib/seed-dep.js')
  fs.writeFileSync(path.join(repo, mod.JUDGE_WAIVERS_REL), JSON.stringify({ 'scripts/lib/seed-dep.js': '只放常量，无判定分支' }), 'utf8')
  try {
    const ctx = mod.makeJudgeSurfaceContext(repo)
    assert.strictEqual(ctx.selfFault, null)
    assert.strictEqual(mod.highRiskPrefixOf('scripts/lib/seed-dep.js', ctx), null)
    assert.deepStrictEqual(ctx.waived, ['scripts/lib/seed-dep.js'], '豁免必须留痕（读数里看得见是谁被放掉的）')
    assert.ok(ctx.members.has('scripts/check-seed.js'), '未豁免的成员照旧进面')
  } finally { fs.rmSync(repo, { recursive: true, force: true }) }
})

test('豁免清单形状坏（JSON 解析不动 / 值不是字符串）⇒ 按未证实，不得读成"没有豁免"', () => {
  const repo = mkTmp('js-waivebad-')
  seedJudgeScripts(repo)
  fs.writeFileSync(path.join(repo, mod.JUDGE_WAIVERS_REL), '{ 这不是 JSON', 'utf8')
  try {
    const ctx = mod.makeJudgeSurfaceContext(repo)
    assert.ok(ctx.selfFault, `坏清单必须出声，实际 ${JSON.stringify(ctx.selfFault)}`)
    assert.strictEqual(ctx.members.size, 0, 'selfFault 时不得给出任何成员（包括"照旧全算成员"这种猜测）')
  } finally { fs.rmSync(repo, { recursive: true, force: true }) }

  const repo2 = mkTmp('js-waivebad2-')
  seedJudgeScripts(repo2, './lib/seed-dep.js')
  fs.writeFileSync(path.join(repo2, mod.JUDGE_WAIVERS_REL), JSON.stringify({ 'scripts/lib/seed-dep.js': true }), 'utf8')
  try {
    const ctx2 = mod.makeJudgeSurfaceContext(repo2)
    assert.ok(ctx2.selfFault, 'reason 写成布尔值 = 没有理由 ⇒ 按未证实（真豁免必须是非空字符串）')
  } finally { fs.rmSync(repo2, { recursive: true, force: true }) }
})

test('真实仓的豁免清单当前必须为空，且成员数必须与实测下界一致（本片起始 fail-closed）', () => {
  const ctx = realCtx()
  assert.strictEqual(ctx.selfFault, null, ctx.selfFault)
  assert.deepStrictEqual(ctx.waived, [], '本片起始豁免为 0 条；抬上限属人工裁决（design D4）')
  assert.ok(ctx.members.size >= mod.JUDGE_MIN_FILES - 5,
    `真实仓成员集规模必须看得见（实际 ${ctx.members.size}）—— 解析退化会让"零成员"与"全仓没有判据"同形`)
  const line = mod.summarizeJudgeSurface(ctx).line
  assert.match(line, /^JUDGE-SURFACE /, `读数行必须点名自己是谁，实际 ${line}`)
  for (const k of ['entries=', 'files=', 'members=', 'waived=', 'dynamic=', 'selfFault=']) {
    assert.ok(line.includes(k), `读数行缺字段 ${k}：${line}`)
  }
})

test('派生档的标记名不是路径（QM-6 轮 2 i2 的否证要可执行，不能只在处置表里说）', () => {
  // ① 标记本身在仓里必须不存在为真实文件 —— 它是**桶名**，不是路径。
  assert.ok(!fs.existsSync(path.join(REPO_ROOT, mod.JUDGE_CLOSURE_PREFIX)),
    `JUDGE_CLOSURE_PREFIX=${mod.JUDGE_CLOSURE_PREFIX} 若真存在为文件，它就该走前缀清单而不是派生档`)
  // ② 全仓清点：除判据本体与它自己的测试外，不得有第三个消费点（那才是"契约被改坏"的现场）。
  let hits
  try {
    hits = execFileSync('git', ['grep', '-n', '-E', '-e', 'highRiskPrefixOf|isHighRiskSurface|highRiskHits',
      '--', 'scripts', '.github', 'apps', 'packages'], { cwd: REPO_ROOT, encoding: 'utf8', maxBuffer: 32 * 1024 * 1024 })
      .split(/\r?\n/).filter(Boolean)
  } catch (e) { hits = [] } // git grep 无匹配按 rc=1 抛错；下面那条"命中数下界"就是防它被读成"仓里没有消费者"
  const owners = new Set(['scripts/check-pr-exec-record.js', 'scripts/check-pr-exec-record.test.js',
    'scripts/check-pr-exec-record-judge-surface.test.js', 'scripts/check-judge-surface-coverage.js',
    'scripts/check-judge-surface-coverage.test.js'])
  const foreign = hits.filter((h) => !owners.has(h.split(':')[0]))
  assert.deepStrictEqual(foreign, [],
    `出现第二个消费点时，"返回值是桶名不是路径"这条约定就没有清点兜底了：${JSON.stringify(foreign.slice(0, 4))}`)
  // ③ 现有消费者里不得有人对返回值做路径运算（指控要能被机器否证）。
  const pathy = hits.filter((h) => /(startsWith|path\.join|path\.resolve|split)\([^)]*prefix/i.test(h))
  assert.deepStrictEqual(pathy, [], `把高危面返回值当路径用的行必须为 0，实得 ${JSON.stringify(pathy.slice(0, 4))}`)
  assert.ok(hits.length >= 20, `清点面本身不得退化成空集（实得 ${hits.length} 行）`)
})
