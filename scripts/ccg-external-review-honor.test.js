'use strict'
/**
 * scripts/lib/ccg-external-review-honor.js 的判据表（change: qm6-external-review-honor）。
 *
 * 这个模块决定「一条 high_risk_requires_external 阻断是否已被真外部后端的交付 + 公开可核出处满足」，
 * 而它的**结论直接决定高危面能不能收口** ⇒ 本文件的每一格负例都必须指向一个具体失败形态，
 * 不得用"少写一格也没人知道"的空白交账。红因清单由模块自己导出（HONOR_REJECTIONS），
 * 末尾有一条召回锁：每个成员都必须被上面的某条用例命中（否则那条分支永远点不到火）。
 *
 * 跑法（本仓无 vitest 收集 scripts/，必须显式点名）：node --test scripts/ccg-external-review-honor.test.js
 */
const test = require('node:test')
const assert = require('node:assert')

const H = require('./lib/ccg-external-review-honor')

const CRITIC = 'claude'
const URL_A = 'https://github.com/o/r/pull/4308#issuecomment-1000'
const URL_B = 'https://github.com/o/r/pull/4308#issuecomment-2000'

/** 一条「i5 被真外部复核满足」的最小合规件。 */
function item (over) {
  return Object.assign({
    id: 'i5',
    severity: 'Warning',
    verdict: 'dismissed',
    rationale: '本轮 claude 复核第 3 条：该不变量已由 credential-store 的 A 侧断言守住，见评论正文第二节。',
    highRiskDomains: ['crypto'],
    externalReview: {
      performedBy: CRITIC,
      evidenceRef: URL_A,
      reviewedAt: '2026-10-25T09:00:00.000Z'
    }
  }, over || {})
}

function dr (over) {
  return Object.assign({
    status: 'self_play_blocked',
    performedBy: 'self-play',
    confidenceWeight: 0.6,
    blocking: [{ id: 'i5', severity: 'Warning', reason: 'high_risk_requires_external', domains: ['crypto'] }],
    findings: [item()]
  }, over || {})
}

function rec (over) {
  return Object.assign({ mode: 'dual', reviewBackends: { critic: CRITIC, proposer: 'opencode' } }, over || {})
}

function rej (over) {
  return H.honorRejection(Object.assign({
    deepReview: dr(), record: rec(), expectedCritic: CRITIC, boundEvidence: URL_A
  }, over || {}))
}

// ─────────────────────────── 正例 ───────────────────────────

test('合规形态：单条高危项 + 三格齐备 + URL 绑定 ⇒ 可派生闭环', () => {
  assert.strictEqual(rej(), null, '合规输入必须返回 null，实际：' + JSON.stringify(rej()))
})

test('两条共享同一条公开评论、但逐条处置不同 ⇒ 仍合规（现实形态，不得判红）', () => {
  const d = dr({
    blocking: [
      { id: 'i5', severity: 'Warning', reason: 'high_risk_requires_external', domains: ['crypto'] },
      { id: 'i6', severity: 'Warning', reason: 'high_risk_requires_external', domains: ['auth'] }
    ],
    findings: [
      item(),
      item({ id: 'i6', rationale: '本轮 claude 复核第 4 条：登录态串行锁的键取自 accountId，与 i5 无关，见评论正文第三节。' })
    ]
  })
  assert.strictEqual(rej({ deepReview: d }), null)
})

test('正例必须真的有正例的形状：摘掉 externalReview 后同一份输入即红（防空转夹具）', () => {
  const d = dr({ findings: [item({ externalReview: undefined })] })
  assert.notStrictEqual(rej({ deepReview: d }), null)
})

// ─────────────────────────── 资格面 ───────────────────────────

for (const st of ['pending', 'self_play_pending', 'error', 'skipped_by_mode', 'cleared', 'needs_revision', 'self_play_resolved']) {
  test(`status=${st} 一律不进派生（资格面取 status，不取 blocking 形状）`, () => {
    const r = rej({ deepReview: dr({ status: st }) })
    assert.strictEqual(r && r.reason, 'honor-status-ineligible')
    assert.ok(/self_play_blocked/.test(r.detail), '红文案必须说清只认那一个状态词，实际：' + r.detail)
  })
}

test('pending 恰好没有 blocking 字段这件事不得当判据（主干现读 898 条的形状巧合）', () => {
  // 构造：pending + 一条完全合规的 hrre 复核。只看 blocking 形状的实现会在这里放行。
  const r = rej({ deepReview: dr({ status: 'pending' }) })
  assert.strictEqual(r && r.reason, 'honor-status-ineligible')
})

// ─────────────────────────── blocking 形状 ───────────────────────────

for (const [name, blocking] of [['缺席', undefined], ['null', null], ['非数组', 'x'], ['空数组', []]]) {
  test(`blocking=${name} ⇒ fail-closed（不得把"没有阻断项"读成"全部被复核满足"）`, () => {
    const r = rej({ deepReview: dr({ blocking }) })
    assert.strictEqual(r && r.reason, 'honor-blocking-absent')
  })
}

test('混合 reason（一条 hrre + 一条 self_play_upheld）⇒ 整条不派生，红文案点名是哪一条', () => {
  const d = dr({
    blocking: [
      { id: 'i5', severity: 'Warning', reason: 'high_risk_requires_external', domains: ['crypto'] },
      { id: 'i3', severity: 'Warning', reason: 'self_play_upheld' }
    ],
    findings: [item(), item({ id: 'i3', rationale: '指控成立，需要改实现。' })]
  })
  const r = rej({ deepReview: d })
  assert.strictEqual(r && r.reason, 'honor-unhonorable-reason')
  assert.ok(r.detail.includes('i3'), '必须点名那条 upheld 的 id，实际：' + r.detail)
})

test('全部是 self_play_upheld（主干 self_play_blocked 的主体形态）⇒ 不派生', () => {
  const d = dr({
    blocking: [{ id: 'i5', severity: 'Warning', reason: 'self_play_upheld' }],
    findings: [item()]
  })
  assert.strictEqual(rej({ deepReview: d }).reason, 'honor-unhonorable-reason')
})

test('reason 写成大小写变体或带空白 ⇒ 不认（逐字判，不做模糊匹配）', () => {
  const d = dr({ blocking: [{ id: 'i5', severity: 'Warning', reason: 'HIGH_RISK_REQUIRES_EXTERNAL' }] })
  assert.strictEqual(rej({ deepReview: d }).reason, 'honor-unhonorable-reason')
})

// ─────────────────────────── id 配对 ───────────────────────────

test('blocking 里的 id 在 findings 查无对应项 ⇒ honor-item-absent（不得读成"那条不重要"）', () => {
  const d = dr({ findings: [item({ id: 'zzz' })] })
  assert.strictEqual(rej({ deepReview: d }).reason, 'honor-item-absent')
})

test('findings 里有两条同 id ⇒ honor-item-ambiguous（"被复核过"这句话没有主语）', () => {
  const d = dr({ findings: [item(), item()] })
  assert.strictEqual(rej({ deepReview: d }).reason, 'honor-item-ambiguous')
})

test('findings 不是数组 ⇒ 一格都配不上，按 item-absent 出声（不得静默当成零阻断）', () => {
  for (const f of [undefined, null, 'x', {}]) {
    assert.strictEqual(rej({ deepReview: dr({ findings: f }) }).reason, 'honor-item-absent',
      'findings=' + JSON.stringify(f))
  }
})

// ─────────────────────────── externalReview 三格 ───────────────────────────

test('externalReview 整块缺席 ⇒ honor-review-absent（引擎现在的模板不再产出它，这是常态而非异常）', () => {
  const d = dr({ findings: [item({ externalReview: undefined })] })
  assert.strictEqual(rej({ deepReview: d }).reason, 'honor-review-absent')
})

for (const cell of ['performedBy', 'evidenceRef', 'reviewedAt']) {
  test(`externalReview 缺 ${cell} ⇒ 点名缺哪一格（不得用默认值补齐）`, () => {
    const er = { performedBy: CRITIC, evidenceRef: URL_A, reviewedAt: '2026-10-25T09:00:00.000Z' }
    delete er[cell]
    const d = dr({ findings: [item({ externalReview: er })] })
    const r = rej({ deepReview: d })
    assert.strictEqual(r.reason, 'honor-review-incomplete')
    assert.ok(r.detail.includes(cell), 'detail 必须点名 ' + cell + '，实际：' + r.detail)
  })
}

test('performedBy 命中自证形态 ⇒ honor-self-refuting（reviewBackends 写真后端名也算，两格分别成立合起来是空话）', () => {
  for (const by of ['self-play', 'self_play', 'SELF PLAY', 'agent', '内部模拟', 'claude self-play']) {
    const d = dr({ findings: [item({ externalReview: { performedBy: by, evidenceRef: URL_A, reviewedAt: '2026-10-25T09:00:00.000Z' } })] })
    assert.strictEqual(rej({ deepReview: d }).reason, 'honor-self-refuting', 'performedBy=' + by)
  }
})

test('performedBy 不等于期望后端 ⇒ honor-backend-unmatched', () => {
  const d = dr({ findings: [item({ externalReview: { performedBy: 'codex', evidenceRef: URL_A, reviewedAt: '2026-10-25T09:00:00.000Z' } })] })
  assert.strictEqual(rej({ deepReview: d, expectedCritic: CRITIC }).reason, 'honor-backend-unmatched')
})

test('期望后端为空/非字符串 ⇒ 一律不认（缺期望值时"永远不认"必须是拒，不能是放行）', () => {
  for (const bad of ['', '   ', null, undefined, 42]) {
    assert.strictEqual(rej({ expectedCritic: bad }).reason, 'honor-backend-unmatched', 'expectedCritic=' + JSON.stringify(bad))
  }
})

test('evidenceRef 形状不合法 ⇒ honor-evidence-form（自由文本、仓内路径、群消息都不算公开可核）', () => {
  for (const bad of ['PR 里说过', 'docs/adr/0002.md', 'https://example.com/o/r/pull/1#issuecomment-2',
    'https://github.com/o/r/pull/1', '/pull/1#issuecomment-2']) {
    const d = dr({ findings: [item({ externalReview: { performedBy: CRITIC, evidenceRef: bad, reviewedAt: '2026-10-25T09:00:00.000Z' } })] })
    assert.strictEqual(rej({ deepReview: d }).reason, 'honor-evidence-form', 'evidenceRef=' + bad)
  }
})

test('evidenceRef 形状合法但不等于本次绑定值 ⇒ honor-evidence-unbound（一条真实存在、讲别的事的评论不算本条复核）', () => {
  const r = rej({ boundEvidence: URL_B })
  assert.strictEqual(r.reason, 'honor-evidence-unbound')
  assert.ok(r.detail.includes('boundEvidence') || r.detail.includes(URL_B), 'detail 要给出两侧值，实际：' + r.detail)
})

test('boundEvidence 本身不合法 ⇒ 不得靠"两侧同为垃圾但逐字相等"过派生', () => {
  const d = dr({ findings: [item({ externalReview: { performedBy: CRITIC, evidenceRef: '垃圾', reviewedAt: '2026-10-25T09:00:00.000Z' } })] })
  const r = rej({ deepReview: d, boundEvidence: '垃圾' })
  assert.strictEqual(r.reason, 'honor-evidence-form')
})

test('reviewedAt 不可解析 ⇒ honor-reviewed-at-unparsable（空白属"缺一格"，不属"解析不出"）', () => {
  for (const bad of ['昨天', '2026-13-45T99:99:99Z', 'not-a-date']) {
    const d = dr({ findings: [item({ externalReview: { performedBy: CRITIC, evidenceRef: URL_A, reviewedAt: bad } })] })
    assert.strictEqual(rej({ deepReview: d }).reason, 'honor-reviewed-at-unparsable', 'reviewedAt=' + JSON.stringify(bad))
  }
})

test('verdict=upheld 的高危项不得被解除（引擎把 upheld 的 reason 也写成 hrre，实测成立）', () => {
  const d = dr({ findings: [item({ verdict: 'upheld' })] })
  const r = rej({ deepReview: d })
  assert.strictEqual(r.reason, 'honor-upheld-assertion')
  assert.ok(/high_risk_requires_external|hrre/.test(r.detail), 'detail 必须说清为什么 upheld 不算，实际：' + r.detail)
})

// ─────────────────────────── 逐条处置 ───────────────────────────

test('该 finding 缺 verdict 或 rationale ⇒ honor-verdicts-incomplete（带前缀，与 ③ 的同名红因分开）', () => {
  for (const over of [{ verdict: undefined }, { verdict: 'maybe' }, { rationale: '' }, { rationale: '   ' }, { rationale: undefined }]) {
    const d = dr({ findings: [item(over)] })
    assert.strictEqual(rej({ deepReview: d }).reason, 'honor-verdicts-incomplete', JSON.stringify(over))
  }
})

test('红因命名不得与 adjudicationRejection 的重名：本模块的每个成员都必须带 honor- 前缀', () => {
  for (const r of H.HONOR_REJECTIONS) {
    assert.ok(r.startsWith('honor-'), '红因必须带前缀，实际：' + r)
  }
})

test('两条共享同一 URL 且 rationale 逐字相同 ⇒ honor-rationale-duplicated（轮 1 i1：复制粘贴不是两次处置）', () => {
  const shared = '同一句话被贴了两遍。'
  const d = dr({
    blocking: [
      { id: 'i5', severity: 'Warning', reason: 'high_risk_requires_external', domains: ['crypto'] },
      { id: 'i6', severity: 'Warning', reason: 'high_risk_requires_external', domains: ['auth'] }
    ],
    findings: [
      item({ rationale: shared }),
      item({ id: 'i6', rationale: shared })
    ]
  })
  const r = rej({ deepReview: d })
  assert.strictEqual(r.reason, 'honor-rationale-duplicated')
  assert.ok(r.detail.includes('i5') && r.detail.includes('i6'), '必须点名是哪两条，实际：' + r.detail)
})

test('rationale 只差首尾空白 ⇒ 仍算重复（比较前必须 trim，不得靠补一个空格绕开）', () => {
  const d = dr({
    blocking: [
      { id: 'i5', severity: 'Warning', reason: 'high_risk_requires_external', domains: ['crypto'] },
      { id: 'i6', severity: 'Warning', reason: 'high_risk_requires_external', domains: ['auth'] }
    ],
    findings: [item({ rationale: '同一段。' }), item({ id: 'i6', rationale: '  同一段。  ' })]
  })
  assert.strictEqual(rej({ deepReview: d }).reason, 'honor-rationale-duplicated')
})

test('两条各指一条不同的公开评论 ⇒ 即便 rationale 相同也不比（去重只在共享载体时才有意义）', () => {
  const d = dr({
    blocking: [
      { id: 'i5', severity: 'Warning', reason: 'high_risk_requires_external', domains: ['crypto'] },
      { id: 'i6', severity: 'Warning', reason: 'high_risk_requires_external', domains: ['auth'] }
    ],
    findings: [
      item({ rationale: '一句话。' }),
      item({ id: 'i6', rationale: '一句话。', externalReview: { performedBy: CRITIC, evidenceRef: URL_B, reviewedAt: '2026-10-25T09:00:00.000Z' } })
    ]
  })
  // 注意：本条里 boundEvidence 只有一个值，i6 的 ref 不等于它 ⇒ 红因必须是 unbound，不得被去重格抢走
  const r = rej({ deepReview: d })
  assert.strictEqual(r.reason, 'honor-evidence-unbound')
})

// ─────────────────────────── 召回锁 ───────────────────────────

test('HONOR_REJECTIONS 每个成员都必须被本文件某条用例命中（防"实现里有一条永远点不到火"）', () => {
  const hits = new Set()
  const probe = (over) => { const r = rej(over); if (r) hits.add(r.reason) }
  // 探子里的 externalReview 必须是**三格齐备**的完整件再改单格 ——
  // 少写一格会让所有"改某一格"的探针统统撞上 honor-review-incomplete，那三格分支反而没被命中
  // （本条第一版就踩了这个：三个成员靠这条锁自证"已覆盖"，实际一个都没触发）。
  const ok = { performedBy: CRITIC, evidenceRef: URL_A, reviewedAt: '2026-10-25T09:00:00.000Z' }
  const one = (over) => dr({ findings: [item({ externalReview: Object.assign({}, ok, over || {}) })] })
  probe()
  probe({ deepReview: dr({ status: 'pending' }) })
  probe({ deepReview: dr({ blocking: [] }) })
  probe({ deepReview: dr({ blocking: [{ id: 'i5', reason: 'self_play_upheld' }] }) })
  probe({ deepReview: dr({ findings: [] }) })
  probe({ deepReview: dr({ findings: [item(), item()] }) })
  probe({ deepReview: dr({ findings: [item({ externalReview: undefined })] }) })
  const missing = Object.assign({}, ok); delete missing.reviewedAt
  probe({ deepReview: dr({ findings: [item({ externalReview: missing })] }) })
  probe({ deepReview: one({ performedBy: 'self-play' }) })
  probe({ deepReview: one({ performedBy: 'codex' }) })
  probe({ expectedCritic: '' })
  probe({ deepReview: one({ evidenceRef: '自由文本' }) })
  probe({ boundEvidence: URL_B })
  probe({ deepReview: one({ reviewedAt: '昨天' }) })
  probe({ deepReview: dr({ findings: [item({ verdict: undefined })] }) })
  probe({ deepReview: dr({ findings: [item({ verdict: 'upheld' })] }) })
  const two = (ra) => dr({
    blocking: [
      { id: 'i5', reason: 'high_risk_requires_external' },
      { id: 'i6', reason: 'high_risk_requires_external' }
    ],
    findings: [
      item({ rationale: ra }),
      item({ id: 'i6', rationale: ra })
    ]
  })
  probe({ deepReview: two('同一段。') })
  const missed = H.HONOR_REJECTIONS.filter((r) => !hits.has(r))
  assert.deepStrictEqual(missed, [], '这些红因分支没有任何用例能触发：' + JSON.stringify(missed))
  assert.ok(H.HONOR_REJECTIONS.length >= 10, '红因清单规模异常（实得 ' + H.HONOR_REJECTIONS.length + '）—— 召回锁会空转')
})

test('红因清单与模块实现的形状一致（清单不得比实现少，也不得有实现产不出的成员）', () => {
  // 期望值逐字枚举：新增一格必须同时改实现、改用例、改这份清单，三处缺一即红。
  assert.deepStrictEqual([...H.HONOR_REJECTIONS].sort().join(','), [
    'honor-backend-unmatched', 'honor-blocking-absent', 'honor-evidence-form', 'honor-evidence-unbound',
    'honor-item-ambiguous', 'honor-item-absent', 'honor-rationale-duplicated', 'honor-review-absent',
    'honor-review-incomplete', 'honor-reviewed-at-unparsable', 'honor-self-refuting', 'honor-status-ineligible',
    'honor-unhonorable-reason', 'honor-upheld-assertion', 'honor-verdicts-incomplete',
  ].sort().join(','))
})

test('真源是纯的：不 require 任何本地模块、不读环境、不写文件（它会被 CI 每次 PR 的判据本体 require）', () => {
  const fs = require('node:fs')
  const path = require('node:path')
  const src = fs.readFileSync(path.join(__dirname, 'lib', 'ccg-external-review-honor.js'), 'utf8')
  assert.ok(!/require\(\s*['"]\./.test(src), '本模块不得 require 本地模块')
  assert.ok(!/require\(\s*['"](node:)?(fs|child_process|os|path)/.test(src), '本模块不得触到 I/O / 进程 / 环境')
  assert.ok(!/process\.env/.test(src), '本模块不得读环境变量')
  assert.deepStrictEqual(Object.keys(H).slice().sort(),
    ['DERIVABLE_CLOSURE_STATUS', 'EVIDENCE_URL_RE', 'HONORABLE_BLOCKING_REASON', 'HONOR_REJECTIONS', 'TIER_BUCKETS', 'honorRejection'].slice().sort(),
    '导出面必须逐字等于这六个键（清点式守卫：新增导出要有登记，删掉导出要让本条红）')
})

// ── 轮 2 采纳项的锁 ──────────────────────────────────────────────────────────

test('i4：三个子档名只有真源一份，两个消费方的代码里不得再打字面量', () => {
  const gate = require('./check-pr-exec-record.js')
  const strip = gate.stripCommentsForScan
  const fs = require('node:fs')
  const path = require('node:path')
  // 断言取**代码**不取注释：判据/水位的注释里会自然提到桶名，那是散文不是第二次实现。
  for (const f of ['check-pr-exec-record.js', 'qm6-tier-watermark.js']) {
    const code = strip(fs.readFileSync(path.join(__dirname, f), 'utf8'))
    for (const b of Object.values(H.TIER_BUCKETS)) {
      assert.ok(!code.includes(b), `${f} 的代码里打写了子档名 ${b} ⇒ 判据与派生工具会各自漂移，而求锁仍像成立`)
    }
    assert.match(code, /TIER_BUCKETS/, f + ' 必须引用共享常量')
  }
  assert.deepStrictEqual(Object.values(H.TIER_BUCKETS).sort(), [
    'external(直签)', 'external(自扮演+公开复核)', 'external(自扮演+公开复核+高危派生)',
  ].sort(), '子档名逐字枚举：改名要同次改判据、水位、两边测试与水位的读数文案')
  assert.strictEqual(Object.isFrozen(H.TIER_BUCKETS), true, '共享常量必须冻结，否则一处 mutate 就把另一处的读数改掉')
})

test('i2：把派生状态词加进闭环白名单会在**模块加载期**抛错，不只是测试红', () => {
  const fs = require('node:fs')
  const os = require('node:os')
  const path = require('node:path')
  const { spawnSync } = require('node:child_process')
  const src = fs.readFileSync(path.join(__dirname, 'lib', 'exec-record-statuses.js'), 'utf8')
  assert.ok(/self_play_blocked/.test(src), '完整性断言必须**在本模块里**，只在测试里断言等于没守（删掉那段就该红）')
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'statuses-guard-' + process.pid + '-'))
  try {
    fs.writeFileSync(path.join(dir, 'orig.js'), src)
    // 正控：原样加载必须成功（不写这一条，"反控炸了"可能只是因为文件路径/语法本身坏了）
    const ok = spawnSync(process.execPath, ['-e', 'require(' + JSON.stringify(path.join(dir, 'orig.js')) + ')'],
      { encoding: 'utf8' })
    assert.strictEqual(ok.status, 0, '原样模块加载必须成功：' + ok.stderr)
    // 反控：把派生词塞进白名单 ⇒ 加载当场炸，且文案指回正解
    const widened = src.replace("'self_play_resolved',", "'self_play_resolved', 'self_play_blocked',")
    assert.notStrictEqual(widened, src, '夹具没真的改到白名单（替换串失效 ⇒ 本条会假绿）')
    fs.writeFileSync(path.join(dir, 'widened.js'), widened)
    const bad = spawnSync(process.execPath, ['-e', 'require(' + JSON.stringify(path.join(dir, 'widened.js')) + ')'],
      { encoding: 'utf8' })
    assert.notStrictEqual(bad.status, 0, '加词后仍能加载 ⇒ 这条"结构防御"是装饰')
    assert.match(String(bad.stderr), /exec-record-statuses 自检失败/, '报错文案要能自证是哪条断言拦的：' + String(bad.stderr).slice(0, 200))
  } finally { fs.rmSync(dir, { recursive: true, force: true }) }
})
