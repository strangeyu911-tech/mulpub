'use strict'

/**
 * 变异反证驱动 —— required-checks-ledger（slice K）。
 *
 * 这把尺回答一个问题：**每条锁真的有牙吗**。
 * 做法：把实现改成"有缺陷的版本"，看它能不能被某条锁指名抓住。
 *
 * 四条纪律（每条都对应一种"看起来在跑、其实什么都没证明"的形态）：
 *  ① **指名**：红必须落到具体那条锁上（TAP 的 `not ok` 名字 + 失败消息），
 *     不是"整片红"。整片红（LOADFAIL）单独一档 —— 它证明的是"文件被我改坏了"，
 *     不是"锁有牙"；语法坏掉（PROBLEM）又是一档。三档不得混。
 *  ② **不重叠**：两条变异的红集不得同时相同。分两层判：集合层面（红名集 + 消息集
 *     都相同）与**成对层面**（出现过同一条 (红名, 消息)）—— 集合不同不代表成对可分辨。
 *     命中任一层都必须显式声明 `overlaps` 并写理由，否则"红集互异"这条机械判据就废了。
 *  ② **逐条对账**：`expect` 台账记的是**实测**红集的名字与消息。少红、多红、
 *     消息对不上，一律算失守（"这条锁到底证明了哪条变异"必须逐条说得清）。
 *  ③ **可复算**：每条变异跑完必须把文件**逐字节**还原（md5 对账），且还原后两把套件必须重新变绿；
 *     还原读不到绿 = 判据自己坏了，后面所有读数一律作废（退出码 2）。
 *  ④ **不失明**：探针自身的失败必须出声。取不到读数（套件跑不起来、计数解析不出来）
 *     一律按"未证实"处理，不得读成"这条变异没被抓住" —— 把工具的失明读成结论。
 *
 * 退出码：0 全绿 / 1 发现失守 / 2 判据自身故障（还原失败、基线不绿、混合行尾）。
 */

const fs = require('node:fs')
const path = require('node:path')
const crypto = require('node:crypto')
const { spawnSync } = require('node:child_process')

const ROOT = path.join(__dirname, '..')

const SUITES = [
  { file: 'scripts/lib/required-checks.test.js', minTests: 24 },
  { file: 'scripts/check-required-checks.test.js', minTests: 18 },
]

/**
 * 变异表。`expect` 里的 `{name, msg}` 是**实测**出来的红集：先跑一遍量出每条变异
 * 实际点着哪几把锁，再把读数回填成台账。
 *
 * 判定是**逐条**对账：名字必须逐字命中一条红，`msg` 必须是那条红的消息子串，
 * 且**没有多余的红**。少红、多红、消息对不上都算失守（verdict ≠ NAMED ⇒ 该行红）。
 * 只对名字不够 —— 三条变异可以点着同一把锁（M-E / M-M / M-N 都红 lib#14，
 * M-P / M-P2 都红 cli#4），消息子串才是把它们分开的第二维。
 *
 * 消息子串一律取消息的**稳定头部**：丢掉随仓内 workflow 集合漂移的计数
 * （`派生规模退化：25/28`、`derived=4`）。反过来，凡是刻意指向仓内具体产物的
 * 片段（如 `electron-ci.yml`）必须留在里面 —— 产出者集合一变就要当场红。
 *
 * 每条 `from`/`to` 都用 String.raw：正则锚点里的 `\s` 在普通模板串里会被吃掉。
 */
const MUTATIONS = [
  {
    id: 'M-A',
    what: '派生时不框 jobs: 区间（删掉区间守卫）',
    file: 'scripts/lib/required-checks.js',
    kind: 'replace',
    from: String.raw`      if (!inJobs) {
        if (/^jobs:\s*$/.test(ln)) { inJobs = true; hasJobs = true }
        continue
      }
`,
    to: '',
    expect: [
      { name: "派生退化（某个文件声明了 jobs: 却一条 job 没认出）要点名该文件，不得只给残缺集合", msg: "jobs 用四空格缩进的文件必须报退化" },
    ],
  },
  {
    id: 'M-B',
    what: '只认 name:、去掉 job id 兜底',
    file: 'scripts/lib/required-checks.js',
    kind: 'replace',
    from: String.raw`        if (!TRIGGER_NAMES.includes(currentJob)) push(producers, currentJob, { workflow: f, job: currentJob, explicitName: false })
`,
    to: '',
    expect: [
      { name: "派生：显式 name 与 job id 两条来源都要认出（只认 name 会漏 electron-tests / build）", msg: "Cannot read properties of undefined (reading 'workflow')" },
      { name: "真实仓的登记面必须与派生结果自洽（防\"登记漂了而只有临时夹具知道\"）", msg: "派生规模退化" },
    ],
  },
  {
    id: 'M-C',
    what: '差集只留"平台有而登记无"单向',
    file: 'scripts/lib/required-checks.js',
    kind: 'replace',
    from: String.raw`      for (const c of regNames) {
        if (!platNames.includes(c)) { violations.push('仓内登记而平台没有的 check：' + c + '（闸被摘了——这是这条唯一的机械出口）'); drift += 1 }
      }
`,
    to: '',
    expect: [
      { name: "双向差集：登记有而平台没有也要红（那是\"闸被摘了\"唯一的机械出口）", msg: "平台要求而仓内未登记的 check：其它" },
    ],
  },
  {
    id: 'M-D',
    what: '窗口域退回"只看 push 事件"',
    file: 'scripts/check-required-checks.js',
    kind: 'replace',
    from: String.raw`const EVENTS = new Set(['push', 'pull_request'])`,
    to: String.raw`const EVENTS = new Set(['push'])`,
    expect: [
      { name: "探测域含 pull_request：只在 PR 上跑的 workflow（本仓 doc-gate.yml 正是这样）必须算 produced", msg: "把域缩回\"只看 push\"就会给这种 workflow 造两条假违规" },
      { name: "窗口按 workflow 缓存：同名多产出者各取一次，绝不按 check 名重复取数（成本必须能被复算）", msg: "每条 run 取一次 jobs" },
    ],
  },
  {
    id: 'M-E',
    what: 'absent 与 no-run 合并成一档（absent 改判 no-run）',
    file: 'scripts/lib/required-checks.js',
    kind: 'replace',
    from: String.raw`      workflow, form: 'absent', runs: runs.length,`,
    to: String.raw`      workflow, form: 'no-run', runs: runs.length,`,
    expect: [
      { name: "窗口分类五档：fetched 没给＝失明；0 条且未扫到顶＝no-run；0 条且扫到顶＝失明；只有未定论读数＝失明；有 run 没这个名字＝absent", msg: "'no-run' !== 'absent'" },
      // 同一档被合并时，新锁的②格（混合窗口）也必然红 —— 它正是"缺席这一档还在不在"的第二处证人。
      { name: "窗口里的 run 没跑完时，\"这个名字不在作业清单里\"是未定论而不是缺席（2026-10-28 本机现取的假红）", msg: "已完成且不含该名字＝真缺席" },
    ],
  },
  {
    id: 'M-F',
    what: 'judge 把 selfFault（取不到读数）读成合规',
    file: 'scripts/lib/required-checks.js',
    kind: 'replace',
    from: String.raw`      if (p.form === 'selfFault') { unproven.push(p.detail || c); continue }`,
    to: String.raw`      if (p.form === 'selfFault') { continue }`,
    expect: [
      { name: "取不到读数 ⇒ rc=2（未证实档），不得与\"发现违规\"同档也不得读成合规", msg: "实得 rc=0 lines=REQUIRED-CHECKS-SCAN" },
      { name: "取数失败不得被兜成\"一条 run 都没扫到\"：窗口失明走 UNPROVEN，no-run 只在证明取到数之后才允许出现", msg: "form=selfFault" },
      { name: "gh 取数必须有硬超时，且「超时」与「gh 没装」不得共用一句文案", msg: "超时档必须被念出来" },
    ],
  },
  {
    id: 'M-F2',
    what: 'judgePresence 把 selfFault（取不到读数）读成 produced',
    file: 'scripts/lib/required-checks.js',
    kind: 'replace',
    from: String.raw`  const fault = cls.find((c) => c.form === 'selfFault')
  if (fault) return { form: 'selfFault', detail: fault.detail, runs: 0, windows: cls }`,
    to: String.raw`  const fault = cls.find((c) => c.form === 'selfFault')
  if (fault) return { form: 'produced', detail: fault.detail, runs: 0, windows: cls }`,
    expect: [
      { name: "窗口分类五档：fetched 没给＝失明；0 条且未扫到顶＝no-run；0 条且扫到顶＝失明；只有未定论读数＝失明；有 run 没这个名字＝absent", msg: "扫到上限仍没样本＝扫描面不够，不能判\"它不跑\"" },
      { name: "多产出者聚合：任一产出者跑出结论即 produced；一个 workflow 的 run 里没有该名字不得把另一个的真结论抹成 absent", msg: "任一产出者取不到数就整体未证实（produced 只答了半个问题）" },
      { name: "取数失败不得被兜成\"一条 run 都没扫到\"：窗口失明走 UNPROVEN，no-run 只在证明取到数之后才允许出现", msg: "form=produced" },
      { name: "gh 取数必须有硬超时，且「超时」与「gh 没装」不得共用一句文案", msg: "超时档必须被念出来" },
      // 新那条锁的①格走的也是 selfFault 档 —— M-F2 把这一整档抹成 produced，必然一起红。
      // 这是真耦合而不是台账没对齐：两条测的是同一个出口被谁吃掉。
      { name: "窗口里的 run 没跑完时，\"这个名字不在作业清单里\"是未定论而不是缺席（2026-10-28 本机现取的假红）", msg: "窗口全在飞时缺席无从判定" },
    ],
  },
  {
    id: 'M-G',
    what: 'MAX_DEBT 抬到 1 但不放欠账（上限与存量必须同次动）',
    file: 'scripts/lib/required-checks.js',
    kind: 'replace',
    from: String.raw`const MAX_DEBT = 0`,
    to: String.raw`const MAX_DEBT = 1`,
    expect: [
      { name: "欠账清单起始为空、上限为 0，且被否证的那条必须原样留档（不许静默改写）", msg: "抬上限＝人工放宽谁来守门" },
    ],
  },
  {
    id: 'M-H',
    what: '欠账项 reason 为空字符串时不再判违规',
    file: 'scripts/lib/required-checks.js',
    kind: 'replace',
    from: String.raw`    if (typeof v !== 'string' || !v.trim()) violations.push('欠账 ' + k + ' 的理由不成立（必须是非空字符串，写清重取命令与证据）')`,
    to: String.raw`    if (typeof v !== 'string' || v.trim() === undefined) violations.push('欠账 ' + k + ' 的理由不成立（必须是非空字符串，写清重取命令与证据）')`,
    expect: [
      { name: "欠账四条：空 reason / 超上限 / 陈旧键 / 文件缺席，各自指名红或按零欠账放行", msg: "抬上限是在放宽「谁来守门」）\"]" },
    ],
  },
  {
    id: 'M-I',
    what: '删掉 Gate 2b17 的接线（接线锁必须在 changes 作业的可执行正文里，注释不算）',
    file: '.github/workflows/quality-gate.yml',
    kind: 'delete-block',
    startContains: '# --- Gate 2b17',
    endContains: 'node scripts/check-required-checks.js --report --mode=advisory',
    expect: [
      { name: "接线锁：Gate 2b17 必须在 changes 作业的**可执行正文**里点名判据与两把回归锁", msg: "未接线（注释里提一句不算）：node scripts/check-required-checks.js" },
      // 删的是整步（delete-block 从段首注释到判据那一行），令牌接线同在那一步里 ⇒ 一起没。
      // 这一格不是"锁太多余"：两条锁各测一件事（命令在不在 vs 取不取得到数），摘掉任一段都该出声。
      { name: "接线锁的行为补半：Gate 2b17 那一步必须自带 GH_TOKEN，否则 CI 里 gh 一个字都取不到", msg: "找不到 Gate 2b17 那一步" },
    ],
  },
  {
    id: 'M-J',
    what: '空行结束 jobs: 区间（退回第一版实现）',
    file: 'scripts/lib/required-checks.js',
    kind: 'replace',
    from: String.raw`      if (ln.trim() === '') continue
`,
    to: '',
    expect: [
      { name: "顶格注释不得结束 jobs 区间（实测 doc-gate.yml:96 就有零缩进注释；两个 job 之间夹一行就会静默吃掉后面全部 job）", msg: "注释后的 job 丢了：a,A" },
      { name: "空行不得结束 jobs 区间（这一格与顶格注释分属两道守卫，必须各有指名自己的锁）", msg: "空行后的 job 丢了" },
      { name: "真实仓的登记面必须与派生结果自洽（防\"登记漂了而只有临时夹具知道\"）", msg: "派生规模退化" },
    ],
    overlaps: { with: "M-K", reason: "该夹具按真实文件形状写：空行紧挨着顶格注释（doc-gate.yml 实测 95 行空行、96 行零缩进注释），删掉任一条守卫都在同一位置截断 jobs 区间 ⇒「顶格注释不得结束区间」这把锁以同名同消息抓住两条变异。分档靠红集：M-J 另外指名「空行不得结束 jobs 区间」这条独立锁，M-K 不红它。" },
  },
  {
    id: 'M-K',
    what: '顶格注释结束 jobs: 区间',
    file: 'scripts/lib/required-checks.js',
    kind: 'replace',
    from: String.raw`      if (/^\s*#/.test(ln)) continue
`,
    to: '',
    expect: [
      { name: "顶格注释不得结束 jobs 区间（实测 doc-gate.yml:96 就有零缩进注释；两个 job 之间夹一行就会静默吃掉后面全部 job）", msg: "注释后的 job 丢了：a,A" },
    ],
    overlaps: { with: "M-J", reason: "与 M-J 同因：夹具的空行与顶格注释相邻，两条守卫任缺其一都在同一处截断 jobs 区间。" },
  },
  {
    id: 'M-L',
    what: '派生索引退回"名 → 唯一产出者"（覆盖式）',
    file: 'scripts/lib/required-checks.js',
    kind: 'replace',
    from: String.raw`function push (producers, ctx, entry) {
  const list = producers.get(ctx) || []
  if (!list.some((e) => e.workflow === entry.workflow && e.job === entry.job)) list.push(entry)
  producers.set(ctx, list)
}`,
    to: String.raw`function push (producers, ctx, entry) {
  producers.set(ctx, [entry])
}`,
    expect: [
      { name: "一个 check 名可以有多个产出者：派生必须留全部，否则第二个产出者的 run 整批看不见", msg: "\"workflow\":\"electron-ci.yml\",\"job\":\"changes\",\"explicitName\":true" },
      { name: "真实仓的登记面必须与派生结果自洽（防\"登记漂了而只有临时夹具知道\"）", msg: "派生对同名多产出者的读数变了" },
    ],
  },
  {
    id: 'M-M',
    what: 'fetched 缺省视作 true（把失明读成"没跑"）',
    file: 'scripts/lib/required-checks.js',
    kind: 'replace',
    from: String.raw`  if (fetched !== true || !Array.isArray(runs)) {`,
    to: String.raw`  if (!Array.isArray(runs)) {`,
    expect: [
      { name: "窗口分类五档：fetched 没给＝失明；0 条且未扫到顶＝no-run；0 条且扫到顶＝失明；只有未定论读数＝失明；有 run 没这个名字＝absent", msg: "没证明取到数就是失明，不是\"没跑\"" },
    ],
  },
  {
    id: 'M-M1',
    what: '取数失败兜成"一条 run 都没扫到"（不是取不到）',
    file: 'scripts/check-required-checks.js',
    kind: 'replace',
    from: String.raw`    w = { workflow, runs: null, fetched: false, scanned: 0, error: e.message }`,
    to: String.raw`    w = { workflow, runs: [], fetched: true, scanned: 0, error: e.message }`,
    expect: [
      { name: "取数失败不得被兜成\"一条 run 都没扫到\"：窗口失明走 UNPROVEN，no-run 只在证明取到数之后才允许出现", msg: "form=no-run" },
      { name: "gh 取数必须有硬超时，且「超时」与「gh 没装」不得共用一句文案", msg: "超时档必须被念出来" },
    ],
  },
  {
    id: 'M-N',
    what: '把 conclusion === null（in_progress/queued）当终态结论',
    file: 'scripts/lib/required-checks.js',
    kind: 'replace',
    from: String.raw`    if (c === null || c === '') { undetermined += 1; continue }`,
    to: String.raw`    if (c === null || c === '') { seen.push('null'); undetermined += 1; continue }`,
    expect: [
      { name: "窗口分类五档：fetched 没给＝失明；0 条且未扫到顶＝no-run；0 条且扫到顶＝失明；只有未定论读数＝失明；有 run 没这个名字＝absent", msg: "in_progress/queued 不是结论，不得当成\"产出过\"" },
    ],
  },
  {
    id: 'M-O',
    what: '平台并集为空时继续按差集判"十道闸都被摘"',
    file: 'scripts/lib/required-checks.js',
    kind: 'replace',
    from: String.raw`    if (platNames.length === 0 && regNames.length > 0) {
      unproven.push('平台并集为空而登记面有 ' + regNames.length + ' 条 ⇒ 按未证实处理（十闸同摘不是常见事故，令牌读不到才是）')
    } else {`,
    to: String.raw`    if (false) {
      unproven.push('平台并集为空而登记面有 ' + regNames.length + ' 条 ⇒ 按未证实处理（十闸同摘不是常见事故，令牌读不到才是）')
    } else {`,
    expect: [
      { name: "平台并集为空而登记面非空 ⇒ 按未证实，不得把\"取不到\"读成\"十道闸都被摘\"", msg: "仓内登记而平台没有的 check：A" },
    ],
  },
  {
    id: 'M-P',
    what: 'ghJson 退回 shell:true（数组会被重新拼成一条命令串）',
    file: 'scripts/check-required-checks.js',
    kind: 'replace',
    from: String.raw`  const r = run('gh', ['api', ...args], { encoding: 'utf8', shell: false, timeout: ms, maxBuffer: 64 * 1024 * 1024 })`,
    to: String.raw`  const r = run('gh', ['api', ...args], { encoding: 'utf8', shell: true, timeout: ms, maxBuffer: 64 * 1024 * 1024 })`,
    expect: [
      { name: "唯一的 spawn 出口：argv 数组、shell 必须为 false、外部输入只占一个参数元素", msg: "shell:true 会把数组重新拼成一条命令串＝注入面回来了" },
    ],
  },
  {
    id: 'M-P2',
    what: 'ghJson 把 endpoint 拼成一条串（shell 仍为 false）',
    file: 'scripts/check-required-checks.js',
    kind: 'replace',
    from: String.raw`  const r = run('gh', ['api', ...args], { encoding: 'utf8', shell: false, timeout: ms, maxBuffer: 64 * 1024 * 1024 })`,
    to: String.raw`  const r = run('gh', ['api ' + args.join(' ')], { encoding: 'utf8', shell: false, timeout: ms, maxBuffer: 64 * 1024 * 1024 })`,
    expect: [
      { name: "唯一的 spawn 出口：argv 数组、shell 必须为 false、外部输入只占一个参数元素", msg: "输入必须原样留在数组元素里，不拼串" },
    ],
  },
  {
    id: 'M-Q',
    what: '登记面读不到返回空集合而不抛错',
    file: 'scripts/lib/required-checks.js',
    kind: 'replace',
    from: String.raw`  if (r.missing === true) throw new Error('缺 ' + REGISTRY_REL + '：登记面缺席时无从对账，不得判"没有漂移"')`,
    to: String.raw`  if (r.missing === true) return { required: [] }`,
    expect: [
      { name: "登记面读不到必须抛错，不得返回空集合（\"零漂移\"与\"没登记面\"必须可区分）", msg: "Missing expected exception." },
      { name: "登记面缺席 ⇒ rc=2 SELF-FAULT，绝不读成\"零漂移\"（缺席与\"没有漂移\"必须可区分）", msg: "REQUIRED-CHECKS-SCAN required=0" },
      // 新锁的第一格按"登记面缺席"当仓内侧 SELF-FAULT 的探针；M-Q 把它变成不抛错 ⇒ 那一格一起没牙。
      { name: "advisory 档的 SELF-FAULT 也必须退出 0（首档 CI 实测：rc=2 把自己接线的作业掐红，并连带 skipped 掉之后全部 gate）", msg: "不阻断绝不等于不出声" },
    ],
  },
  {
    id: 'M-R',
    what: '403 与 404 合并（都当"该机制为空"）',
    file: 'scripts/lib/required-checks.js',
    kind: 'replace',
    from: String.raw`function isNotFound (e) { return /404|Not Found/i.test(msgOf(e)) }`,
    to: String.raw`function isNotFound (e) { return /404|Not Found|403|Resource not accessible/i.test(msgOf(e)) }`,
    expect: [
      { name: "平台侧两套机制取并集：列表接口 rules 恒空 ⇒ 必须按 id 逐个取详情；404 与 403 动作不同", msg: "平台并集为空（两套机制都没读到任何 required 上下文）" },
      { name: "平台清单 403（令牌没 administration 档）⇒ rc=2 未证实 + 出声指路，绝不读成\"平台没要求\"", msg: "The input did not match the regular expression /UNPROVEN 平台清单取不到/" },
    ],
  },

  {
    id: 'M-S',
    what: '仓库标识白名单退回"字符类含点即放行"（`..` 又能进 endpoint）',
    file: 'scripts/check-required-checks.js',
    kind: 'replace',
    from: String.raw`const SEG = '[A-Za-z0-9_-](?:[A-Za-z0-9._-]*[A-Za-z0-9_-])?'
const REPO_SHAPE = new RegExp('^' + SEG + '/' + SEG + '$')
`,
    to: String.raw`const REPO_SHAPE = /^[A-Za-z0-9._-]+\/[A-Za-z0-9._-]+$/
`,
    expect: [
      { name: "形态白名单还须挡住「点段」：`..` 逐字符都在字符类里，却能改指另一个 API 段", msg: "点段必须整串拒绝" },
    ],
  },
  {
    id: 'M-T',
    what: '不传 timeout（挂死的 gh 会吃掉整个作业预算）',
    file: 'scripts/check-required-checks.js',
    kind: 'replace',
    from: String.raw`shell: false, timeout: ms, maxBuffer: 64 * 1024 * 1024`,
    to: String.raw`shell: false, maxBuffer: 64 * 1024 * 1024`,
    expect: [
      { name: "gh 取数必须有硬超时，且「超时」与「gh 没装」不得共用一句文案", msg: "不传 timeout 就没有任何硬超时" },
    ],
  },
  {
    id: 'M-T2',
    what: '把「超时」并回「gh 不可用」一句（两支 status 都是 null、stderr 都是空，并句就丢了归因）',
    file: 'scripts/check-required-checks.js',
    kind: 'replace',
    from: String.raw`    if (r.error.code === 'ETIMEDOUT') throw new Error('gh 取数超时（>' + ms + ' ms，' + GH_TIMEOUT_ENV + ' 可覆盖）：' + args[0])
    throw new Error('gh 不可用（' + r.error.code + '）：没装或不在 PATH')
`,
    to: String.raw`    throw new Error('gh 不可用：' + r.error.code)
`,
    expect: [
      { name: "gh 取数必须有硬超时，且「超时」与「gh 没装」不得共用一句文案", msg: "gh 不可用：ETIMEDOUT" },
    ],
  },
  {
    id: 'M-U',
    what: 'readDebt 不再过滤 `_` 前缀（留档键被算进欠账条数 ⇒ 上限被自己的注释吃掉）',
    file: 'scripts/lib/required-checks.js',
    kind: 'replace',
    from: String.raw`  for (const [k, v] of Object.entries(r.data)) if (!k.startsWith('_')) out[k] = v
`,
    to: String.raw`  for (const [k, v] of Object.entries(r.data)) out[k] = v
`,
    expect: [
      { name: "欠账清单起始为空、上限为 0，且被否证的那条必须原样留档（不许静默改写）", msg: "欠账条数" },
    ],
  },

  {
    id: 'M-V',
    what: 'SELF-FAULT 出口无视 mode 恒返回 2（回到首档 CI 实测的那一格：令牌未接线 ⇒ 整步中止 ⇒ 后面 21 个 gate 全 skipped）',
    file: 'scripts/check-required-checks.js',
    kind: 'replace',
    from: String.raw`  if (opts && opts.mode === 'advisory') {
    out('MODE=advisory verdict=SELF_FAULT rc=2`,
    to: String.raw`  if (false && opts && opts.mode === 'advisory') {
    out('MODE=advisory verdict=SELF_FAULT rc=2`,
    expect: [
      { name: "advisory 档的 SELF-FAULT 也必须退出 0（首档 CI 实测：rc=2 把自己接线的作业掐红，并连带 skipped 掉之后全部 gate）", msg: "登记面缺席在 advisory 档不得阻断" },
      { name: '仓库标识的形态白名单作用在"解析后的值"上：默认档从 gh 取回的脏值同样被拒', msg: 'advisory 档即使拒了脏值也不得阻断' },
      { name: "形态白名单还须挡住「点段」：`..` 逐字符都在字符类里，却能改指另一个 API 段", msg: "advisory 档不得因" },
    ],
  },

  {
    // 这条改的是 workflow 正文，不是判据代码 —— 但它同样是"锁有没有牙"：
    // 接线只写在 YAML 里、没有任何判据看它，就等于"注释里提一句不算接线"那一族的 CI 版。
    // 锚点按 LF 写（读模型统一归一），且必须避开 String.raw —— `${{ }}` 在模板里会被当插值。
    id: 'M-W',
    what: 'Gate 2b17 那一步摘掉 GH_TOKEN（回到 CI 的失明态：gh rc=4，判据一个字都取不到）',
    file: '.github/workflows/quality-gate.yml',
    kind: 'replace',
    from: ['        env:', '          GH_TOKEN: ${{ github.token }}', '        run: |', '          node --test scripts/lib/required-checks.test.js'].join('\n') + '\n',
    to: ['        run: |', '          node --test scripts/lib/required-checks.test.js'].join('\n') + '\n',
    expect: [
      { name: '接线锁的行为补半：Gate 2b17 那一步必须自带 GH_TOKEN，否则 CI 里 gh 一个字都取不到', msg: '那一步没有 GH_TOKEN 时 gh 在 CI 里 rc=4' },
    ],
  },

  {
    id: 'M-X',
    what: '缺席证据不再要求 run 已完成（退回 2026-10-28 那条假红的实现：queued/in_progress 的部分作业清单被当成"这个 job 不存在"）',
    file: 'scripts/lib/required-checks.js',
    kind: 'replace',
    from: String.raw`    if (r && r.status === 'completed') completedWithout += 1
    else inFlight += 1
`,
    to: String.raw`    completedWithout += 1
`,
    expect: [
      { name: '窗口里的 run 没跑完时，"这个名字不在作业清单里"是未定论而不是缺席（2026-10-28 本机现取的假红）', msg: '窗口全在飞时缺席无从判定' },
    ],
  },

  {
    id: 'M-X2',
    what: '窗口不带 run 的 status（判据在 lib 里写对了也没用：采集层没把这一维送进来，真实路径恒走未定论）',
    file: 'scripts/check-required-checks.js',
    kind: 'replace',
    from: String.raw`      runs.push({ id: run.id, event: run.event, status: run.status, created: run.created_at, jobs: map })`,
    to: String.raw`      runs.push({ id: run.id, event: run.event, created: run.created_at, jobs: map })`,
    expect: [
      { name: "窗口必须把每条 run 的 status 一起带回来 —— lib 侧\"缺席只能由已完成的 run 给出\"这条判据全靠它喂", msg: '窗口里必须带 status' },
    ],
  },

  // ---- 控制项：证明这把尺自己的读数是真的 ----
  {
    id: 'S0-CONTROL-SYNTAX',
    what: '控制项：故意把实现改坏成语法错 ⇒ 必须判 PROBLEM（"我改坏了文件"），不得读成"锁没牙"',
    file: 'scripts/lib/required-checks.js',
    kind: 'replace',
    from: String.raw`const MAX_DEBT = 0`,
    to: String.raw`const MAX_DEBT = 0
this is not valid javascript !!!`,
    control: true,
    expectVerdict: 'PROBLEM',
  },
  {
    id: 'S0b-CONTROL-LOADFAIL',
    what: '控制项：故意让实现 require 时抛错（语法合法）⇒ 必须判 LOADFAIL（整片红），不得读成"锁没牙"',
    file: 'scripts/lib/required-checks.js',
    kind: 'replace',
    from: String.raw`const MAX_DEBT = 0`,
    to: String.raw`throw new Error('mutation-control')
const MAX_DEBT = 0`,
    control: true,
    expectVerdict: 'LOADFAIL',
  },
  {
    id: 'S1-CONTROL-NEGATIVE',
    what: '控制项：只改注释 ⇒ 必须一条红都不出（NORED），证明"红"来自行为而不是来自"文件被碰过"',
    file: 'scripts/lib/required-checks.js',
    kind: 'replace',
    from: String.raw`        // 零缩进的非空非注释行 = 顶层下一个键 ⇒ jobs 块结束。`,
    to: String.raw`        // 零缩进的非空非注释行 = 顶层下一个键 ⇒ jobs 区间结束。`,
    control: true,
    expectVerdict: 'NORED',
  },
]

// ---- 基础设施 ----

function md5 (buf) { return crypto.createHash('md5').update(buf).digest('hex') }

function countOccurrences (hay, needle) {
  if (!needle) return 0
  let n = 0
  let i = hay.indexOf(needle)
  while (i !== -1) { n++; i = hay.indexOf(needle, i + needle.length) }
  return n
}

/** 行尾分档：CRLF / LF / 混合。混合行尾一律按"判据自身故障"拒绝（不得静默统一回写）。 */
function detectEol (text) {
  const crlf = (text.match(/\r\n/g) || []).length
  const lfOnly = (text.match(/(?<!\r)\n/g) || []).length
  if (crlf > 0 && lfOnly > 0) return { mixed: true, crlf, lfOnly, eol: null }
  return { mixed: false, crlf, lfOnly, eol: crlf > 0 ? '\r\n' : '\n' }
}

function toEol (lfText, eol) {
  if (eol === '\n') return lfText
  return lfText.replace(/\n/g, '\r\n')
}

function readModel (rel) {
  const abs = path.join(ROOT, rel)
  const buf = fs.readFileSync(abs)
  const text = buf.toString('utf8')
  const e = detectEol(text)
  return {
    rel,
    abs,
    mixed: e.mixed,
    eol: e.eol,
    crlf: e.crlf,
    lfOnly: e.lfOnly,
    lf: text.replace(/\r\n/g, '\n'),
    md5: md5(buf),
  }
}

function writeModel (model, lfText) {
  fs.writeFileSync(model.abs, Buffer.from(toEol(lfText, model.eol), 'utf8'))
}

/** YAML 单行标量的反转义：单引号形式解 `''`，双引号形式走 JSON。 */
function unquoteYaml (raw) {
  const s = String(raw).trim()
  if (s.length >= 2 && s[0] === "'" && s[s.length - 1] === "'") return s.slice(1, -1).replace(/''/g, "'")
  if (s.length >= 2 && s[0] === '"' && s[s.length - 1] === '"') {
    try { return JSON.parse(s) } catch (e) { return s.slice(1, -1) }
  }
  return s
}

/**
 * 解析 TAP：抓 `not ok N - <名字>`（0 缩进）与紧随其后的 YAML 诊断块里的 `error:` 消息。
 * 消息是**必须**抓的：两条变异可能落在同一条锁上，只有名字分不开。
 * `error:` 有两种形态 —— 单行内联标量（`'…'` 或 `"…"`）与多行块标量（`|-`，内容在 4 空格缩进）。
 */
function parseReds (tap) {
  const lines = String(tap || '').replace(/\r\n/g, '\n').split('\n')
  const reds = []
  for (let i = 0; i < lines.length; i++) {
    const m = /^not ok \d+ - (.+)$/.exec(lines[i])
    if (!m) continue
    const rec = { name: m[1], message: null }
    let j = i + 1
    while (j < lines.length && j <= i + 6 && lines[j] !== '  ---') {
      if (!/^#/.test(lines[j])) break
      j++
    }
    if (lines[j] === '  ---') {
      let k = j + 1
      while (k < lines.length && lines[k] !== '  ...') {
        const em = /^ {2}error:(?:[ ](.*))?$/.exec(lines[k])
        if (em) {
          const raw = em[1] === undefined ? '' : em[1]
          if (raw === '|-' || raw === '|' || raw === '>+' || raw === '|-' || raw === '>+') {
            const content = []
            let n = k + 1
            // 块标量的内容必须整段取走：Node 的断言消息里有一行空行把"标题"和"diff"隔开，
            // 只按"非空且缩进≥4"取会在空行处截断 ⇒ 消息只剩首行，区分力被削掉。
            // 空行属于块内容；终止条件是缩进回落到 2 的下一个键（或 `  ...`）。
            while (n < lines.length) {
              const ln = lines[n]
              if (ln.trim() === '') { content.push(''); n++; continue }
              if (/^ {4}/.test(ln)) { content.push(lines[n].replace(/^ {4}/, '')); n++; continue }
              break
            }
            while (content.length && content[content.length - 1] === '') content.pop()
            rec.message = content.join('\n')
            k = n
            continue
          }
          rec.message = unquoteYaml(raw)
          k++
          continue
        }
        k++
      }
      i = k
    }
    reds.push(rec)
  }
  return reds
}

function matchInt (text, re) {
  const m = re.exec(text)
  return m ? parseInt(m[1], 10) : null
}

function runSuite (suite) {
  const r = spawnSync(process.execPath, ['--test', suite.file], {
    cwd: ROOT, encoding: 'utf8', shell: false, maxBuffer: 64 * 1024 * 1024,
  })
  const stdout = r.stdout || ''
  const stderr = r.stderr || ''
  const collected = matchInt(stdout, /^# tests (\d+)$/m)
  const failed = matchInt(stdout, /^# fail (\d+)$/m)
  const reds = parseReds(stdout)
  const loadfail = reds.some((x) => /\.test\.js$/.test(x.name))
  return {
    file: suite.file,
    rc: r.status,
    collected,
    failed,
    reds,
    loadfail,
    stdout,
    stderr,
    minTests: suite.minTests,
    readable: collected !== null && failed !== null,
  }
}

function applyMutation (model, mut) {
  if (mut.kind === 'replace') {
    const count = countOccurrences(model.lf, mut.from)
    if (count !== 1) throw new Error('锚点命中 ' + count + ' 次（必须恰好 1 次）')
    // 函数式替换：新串里的 $& / $' 不被当模式展开
    return model.lf.replace(mut.from, () => mut.to)
  }
  if (mut.kind === 'delete-block') {
    const lines = model.lf.split('\n')
    const sHits = lines.filter((l) => l.includes(mut.startContains))
    if (sHits.length !== 1) throw new Error('startContains 命中 ' + sHits.length + ' 行（必须恰好 1 行）')
    const eHits = lines.filter((l) => l.includes(mut.endContains))
    if (eHits.length !== 1) throw new Error('endContains 命中 ' + eHits.length + ' 行（必须恰好 1 行）')
    const sIdx = lines.findIndex((l) => l.includes(mut.startContains))
    const eIdx = lines.findIndex((l, idx) => idx > sIdx && l.includes(mut.endContains))
    if (eIdx < 0) throw new Error('endContains 不在 startContains 之后')
    lines.splice(sIdx, eIdx - sIdx + 1)
    return lines.join('\n')
  }
  throw new Error('未知变异类型 ' + mut.kind)
}

function syntaxOk (model) {
  if (!/\.js$/.test(model.rel)) return { ok: true, detail: '' }
  const r = spawnSync(process.execPath, ['--check', model.abs], { encoding: 'utf8', shell: false })
  if (r.status === 0) return { ok: true, detail: '' }
  const first = String(r.stderr || '').split('\n').filter((l) => /Error/.test(l))[0] || ('rc=' + r.status)
  return { ok: false, detail: first.trim() }
}

function baselineOk (results) {
  for (const res of results) {
    if (!res.readable) return '套件 ' + res.file + ' 的 TAP 计数读不出来（探针失明，不得读成"没有红"）'
    if (res.rc !== 0) return '套件 ' + res.file + ' 基线不绿（rc=' + res.rc + '）'
    if (res.collected < res.minTests) return '套件 ' + res.file + ' 只收到 ' + res.collected + ' 条（下界 ' + res.minTests + '）'
    if (res.loadfail) return '套件 ' + res.file + ' 基线就是 LOADFAIL'
    if (res.reds.length) return '套件 ' + res.file + ' 基线就有红：' + res.reds.map((x) => x.name).join(' | ')
  }
  return null
}

function restoreAndVerify (model) {
  writeModel(model, model.lf)
  const now = md5(fs.readFileSync(model.abs))
  if (now !== model.md5) {
    throw new Error('还原后 md5 不符：期望 ' + model.md5 + ' 实得 ' + now + '（' + model.rel + '）')
  }
}

/**
 * 判定一条变异的红集是否与台账**逐条**对上。
 *
 * `expect` 是数组，每项 `{ name, msg }`：
 *  - `name` 必须逐字命中一条红（红的名字 = TAP 的 `not ok N - <名字>`）；
 *  - `msg` 可选，但给出时必须是那条红的**消息子串** —— 只对名字的话，
 *    "同一条锁抓住三条不同变异"（E/M/M/N 都红在 lib#14 上）会互相顶替，
 *    台账就分不出谁证明谁。
 * 名字集合与消息子串都通过、且**没有多余的红** ⇒ NAMED。
 */
function classify (mut, res) {
  if (res.problem) return 'PROBLEM'
  if (res.loadfail) return 'LOADFAIL'
  const names = res.reds.map((r) => r.name)
  const expect = mut.expect
  if (expect === null || expect === undefined) return names.length === 0 ? 'NORED' : 'UNMEASURED'
  if (expect.length === 0) return names.length === 0 ? 'NORED' : 'NAMED+EXTRA'
  const missing = []
  const extra = []
  for (const e of expect) {
    if (!names.includes(e.name)) missing.push(e.name)
  }
  for (const n of names) {
    if (!expect.some((e) => e.name === n)) extra.push(n)
  }
  const msgMiss = []
  for (const e of expect) {
    if (!e.msg) continue
    const idx = names.indexOf(e.name)
    if (idx < 0) continue
    const actual = res.reds[idx].message === null ? '' : res.reds[idx].message
    if (!actual.includes(e.msg)) msgMiss.push(e.name + ' ⇒ 消息不含「' + e.msg + '」')
  }
  if (missing.length === 0 && msgMiss.length === 0) return extra.length === 0 ? 'NAMED' : 'NAMED+EXTRA'
  if (names.length === 0) return 'MISSED'
  return 'PARTIAL'
}

function runAll (opts) {
  const only = opts.only ? new Set(String(opts.only).split(',')) : null
  const list = MUTATIONS.filter((m) => !only || only.has(m.id))
  if (list.length === 0) {
    console.log('MUTATIONS-SELECTED=0（--only 过滤后没有变异可跑）')
    return { rc: 2 }
  }

  const files = []
  for (const m of list) if (!files.includes(m.file)) files.push(m.file)
  const models = {}
  for (const rel of files) {
    const mdl = readModel(rel)
    if (mdl.mixed) {
      console.log('MIXED-EOL ' + rel + ' crlf=' + mdl.crlf + ' lfOnly=' + mdl.lfOnly + ' ⇒ 拒绝动这个文件（混合行尾不得静默统一回写）')
      return { rc: 2 }
    }
    models[rel] = mdl
    console.log('FILE ' + rel + ' eol=' + (mdl.eol === '\r\n' ? 'CRLF' : 'LF') + ' crlf=' + mdl.crlf + ' lfOnly=' + mdl.lfOnly + ' md5=' + mdl.md5)
  }

  const baseResults = SUITES.map((s) => runSuite(s))
  const baseBad = baselineOk(baseResults)
  if (baseBad) {
    console.log('BASELINE-FAIL ' + baseBad)
    return { rc: 2 }
  }
  console.log('BASELINE suites=' + SUITES.length + ' green=true')

  const rows = []
  for (const mut of list) {
    const model = models[mut.file]
    const row = { id: mut.id, what: mut.what, file: mut.file, verdict: null, ok: false, reds: [], messages: [], note: '' }

    if (md5(fs.readFileSync(model.abs)) !== model.md5) {
      row.verdict = 'PROBLEM'
      row.note = '变异前文件已被改动（md5 与基线不符）⇒ 本条读数作废'
      rows.push(row)
      console.log('[' + mut.id + '] verdict=PROBLEM ' + row.note)
      continue
    }

    let mutatedLf
    try {
      mutatedLf = applyMutation(model, mut)
    } catch (e) {
      row.verdict = 'PROBLEM'
      row.note = '锚点未命中：' + e.message
      rows.push(row)
      console.log('[' + mut.id + '] verdict=PROBLEM ' + row.note)
      continue
    }
    if (mutatedLf === model.lf) {
      row.verdict = 'NOOP'
      row.note = '变异没有改变文件内容'
      rows.push(row)
      console.log('[' + mut.id + '] verdict=NOOP ' + row.note)
      continue
    }

    let res = null
    try {
      writeModel(model, mutatedLf)
      const syn = syntaxOk(model)
      if (!syn.ok) {
        row.verdict = 'PROBLEM'
        row.note = '变异把文件改成了语法错：' + syn.detail + '（这是"我改坏了文件"，不是"锁没牙"）'
        // 控制项 S0 期望的正是这一格：语法错必须被语法检查**当场抓住**，
        // 而不是被读成 MISSED / NAMED。
        // 驱动自身的故障（md5 不符 / 锚点未命中 / NOOP）**不得**满足控制项 ——
        // 那三格都不是"语法检查抓到了"。
        row.ok = mut.control === true && mut.expectVerdict === 'PROBLEM'
        rows.push(row)
        console.log('[' + mut.id + '] verdict=PROBLEM ' + row.note)
        continue
      }
      const results = SUITES.map((s) => runSuite(s))
      const reds = []
      for (const r of results) {
        for (const x of r.reds) reds.push(Object.assign({ suite: r.file }, x))
      }
      const loadfail = results.some((r) => r.loadfail) ||
        results.some((r) => !r.readable) ||
        results.some((r) => r.collected < r.minTests)
      res = { reds, loadfail, problem: null }
    } finally {
      try {
        restoreAndVerify(model)
      } catch (e) {
        console.log('RESTORE-FAIL ' + e.message)
        return { rc: 2 }
      }
    }

    const after = SUITES.map((s) => runSuite(s))
    const afterBad = baselineOk(after)
    if (afterBad) {
      console.log('RESTORE-BASELINE-FAIL ' + mut.id + ' ⇒ ' + afterBad)
      return { rc: 2 }
    }

    row.reds = res.reds.map((x) => x.name)
    row.messages = res.reds.map((x) => (x.message === null ? '' : x.message))
    const raw = classify(mut, res)
    row.verdict = raw
    if (mut.control) {
      row.ok = raw === mut.expectVerdict
      if (!row.ok) {
        row.verdict = 'PROBLEM'
        row.note = '控制项不符：期望 ' + mut.expectVerdict + ' 实得 ' + raw
      }
    } else {
      // 非控制项：必须**逐条**对上台账 —— 少红、多红、消息对不上都算失守。
      row.ok = raw === 'NAMED'
      if (!row.ok && !row.note) row.note = '红集未与台账逐条对上（期望 NAMED）：' + raw
    }

    rows.push(row)
    console.log('[' + mut.id + '] verdict=' + row.verdict + ' file=' + mut.file + ' reds=' + row.reds.length + (row.note ? ' note=' + row.note : ''))
    for (let i = 0; i < row.reds.length; i++) {
      console.log('    red#' + (i + 1) + ' name=' + row.reds[i])
      console.log('    red#' + (i + 1) + ' msg=' + String(row.messages[i]).replace(/\s*\n\s*/g, ' ⏎ '))
    }
  }

  // ---- 红集互异性 ----
  // 两层判据：① **集合层面**（红名集与消息集都相同）⇒ 两条变异完全不可分辨；
  //   ② **成对层面**（出现过同一条 (红名, 消息)）⇒ 至少在那一红上不可分辨。
  // 集合层面不同**不代表**成对可分辨 —— M-J/M-K 就是集合不同、成对相同的典型：
  // 两条变异都在夹具的同一个位置截断 jobs 区间，同一条锁以同名同消息抓住它们，
  // 区分只能靠**红集**（M-J 额外红「真实仓的登记面必须与派生结果自洽」）。
  const byId = {}
  for (const r of rows) byId[r.id] = r
  let overlapIssues = 0
  for (let i = 0; i < rows.length; i++) {
    for (let j = i + 1; j < rows.length; j++) {
      const a = rows[i]
      const b = rows[j]
      if (a.verdict === 'PROBLEM' || b.verdict === 'PROBLEM') continue
      const sameNames = JSON.stringify(a.reds.slice().sort()) === JSON.stringify(b.reds.slice().sort())
      const sameMsgs = JSON.stringify(a.messages.slice().sort()) === JSON.stringify(b.messages.slice().sort())
      const declared = (MUTATIONS.find((m) => m.id === a.id) || {}).overlaps
      const other = (MUTATIONS.find((m) => m.id === b.id) || {}).overlaps
      const ok = (declared && declared.with === b.id && declared.reason) || (other && other.with === a.id && other.reason)
      if (sameNames && sameMsgs) {
        if (!ok) {
          overlapIssues++
          console.log('OVERLAP-UNDECLARED ' + a.id + ' × ' + b.id + ' （红名集与消息集完全相同 ⇒ 这两条变异不可分辨，必须显式声明 overlaps 并写理由）')
        } else {
          console.log('OVERLAP-DECLARED ' + a.id + ' × ' + b.id)
        }
        continue
      }
      const dupPairs = []
      for (let x = 0; x < a.reds.length; x++) {
        for (let y = 0; y < b.reds.length; y++) {
          if (a.reds[x] === b.reds[y] && a.messages[x] === b.messages[y]) dupPairs.push(a.reds[x])
        }
      }
      if (dupPairs.length) {
        if (!ok) {
          overlapIssues++
          console.log('OVERLAP-PAIR-UNDECLARED ' + a.id + ' × ' + b.id + ' （同一条红同名同消息：' + dupPairs.join(' | ') + ' ⇒ 至少在这一红上两条变异不可分辨，必须显式声明 overlaps 并写理由）')
        } else {
          console.log('OVERLAP-PAIR-DECLARED ' + a.id + ' × ' + b.id + ' pairs=' + dupPairs.length + ' reds=' + dupPairs.join(' | '))
        }
      }
    }
  }

  const controls = rows.filter((r) => (MUTATIONS.find((m) => m.id === r.id) || {}).control)
  const mutRows = rows.filter((r) => !controls.includes(r))
  // 汇总只统计**变异行**的判定分布。控制项的 LOADFAIL / NORED / PROBLEM 是
  // **设计好的读数**（它们要证明的是"驱动能把坏形态判成坏形态"），
  // 混进同一个直方图里，读者无法区分"这是控制项读到的"与"这里失守了"。
  const counts = {}
  for (const r of mutRows) counts[r.verdict] = (counts[r.verdict] || 0) + 1
  const failedRows = rows.filter((r) => !r.ok)
  const controlsOk = controls.every((r) => r.ok)

  const parts = Object.keys(counts).sort().map((k) => k + '=' + counts[k])
  const controlParts = controls.map((r) => r.id + '=' + r.verdict + (r.ok ? '' : '(FAIL)'))
  const result = failedRows.length === 0 && overlapIssues === 0 && controlsOk ? 'OK' : 'FAIL'
  console.log('SUMMARY TOTAL=' + rows.length + ' MUTATIONS=' + mutRows.length +
    ' CONTROLS=' + controls.length + ' ATTEMPTED=' + rows.length + ' ' + parts.join(' ') +
    ' CONTROL-READINGS=' + controlParts.join(' ') +
    ' OVERLAP-UNDECLARED=' + overlapIssues + ' RESULT=' + result)
  return { rc: result === 'OK' ? 0 : 1, rows, counts }
}

function main (argv) {
  const opts = { only: null, list: false }
  for (const a of argv) {
    if (a === '--list') { opts.list = true; continue }
    if (a.startsWith('--only=')) { opts.only = a.slice(7); continue }
    console.log('MUTATION-DRIVER 未知旗标：' + a + '（本判据只认 --list --only=）')
    return 2
  }
  if (opts.list) {
    for (const m of MUTATIONS) console.log(m.id + '\t' + m.file + '\t' + m.what + (m.control ? '\t[控制项]' : ''))
    return 0
  }
  const res = runAll(opts)
  return res.rc
}

if (require.main === module) process.exit(main(process.argv.slice(2)))
module.exports = { MUTATIONS, SUITES, runAll, parseReds, applyMutation, detectEol }
