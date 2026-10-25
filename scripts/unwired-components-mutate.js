'use strict'

// 阶段 5.3「未接线组件门禁」的反证驱动：逐刀把判据改成「本仓规则明文禁止的那个形态」，
// 必须当场变红，且红在指名的那条锁上。没红的那刀等于宣布这把锁是装饰性的。
//
// 四条纪律（都是本仓踩过的）：
//   1. 每刀取**被禁形态本身**，不取"看起来更严"的等价写法（等价变异证不出锁在测它声称的变量）。
//   2. 电池被打断会把源文件留在变异态 ⇒ 一律 try/finally 还原，并在还原后做逐字节核对。
//   3. 锚点一律**单行**：本仓工作副本存在 w/crlf 与 w/lf 混存，含 \n 的锚会因行尾而点不中，
//      表现为"锚点缺失"被读成"判据没被改到"（见 AGENTS 行尾条目）。
//   4. 变异期间不得有外部评审在读同一棵树（本驱动只在本 worktree 内串行跑）。
//
// 本地跑：node scripts/unwired-components-mutate.js

const fs = require('node:fs')
const path = require('node:path')
const crypto = require('node:crypto')
const { execFileSync } = require('node:child_process')

const REPO = path.resolve(__dirname, '..')
const GATE = path.join(__dirname, 'check-unwired-components.js')
const TEST = path.join(__dirname, 'check-unwired-components.test.js')
const BASE = path.join(__dirname, 'unwired-components-baseline.json')
const WF = path.join(REPO, '.github', 'workflows', 'quality-gate.yml')

const md5 = (buf) => crypto.createHash('md5').update(buf).digest('hex')

const run = (args) => {
  try {
    const out = execFileSync(process.execPath, args, { cwd: REPO, encoding: 'utf8', maxBuffer: 1 << 28 })
    return { rc: 0, out }
  } catch (e) {
    return { rc: typeof e.status === 'number' ? e.status : 99, out: String(e.stdout || '') + String(e.stderr || '') }
  }
}

// expect: { runRc, readout, testRc, redName }  —— runRc/testRc 指"必须非零"，readout/redName 指"必须点名到那一格"
const KNIVES = [
  {
    id: 'M1',
    what: 'isWired 退回恒 true（对所有输入返回同一份数据的假探针）',
    file: GATE,
    from: 'function isWired(name, consumers, selfPath) {',
    to: 'function isWired(name, consumers, selfPath) { if (true) return true;',
    expect: { runRc: true, readout: 'STALE_BASELINE' },
  },
  {
    id: 'M2',
    what: '摘掉自我引用跳过（组件 import 自己即算已接线）',
    file: GATE,
    from: '    if (rel === selfPath) continue',
    to: '    // if (rel === selfPath) continue',
    expect: { testRc: true, redName: '自我引用不得算成已接线' },
  },
  {
    id: 'M3',
    what: '空域守卫条件改成恒假（守卫文案还在、行为已消失 = 装饰性门禁的第四种落点）',
    file: GATE,
    from: '  if (candidates === 0) {',
    to: '  if (false && candidates === 0) {',
    expect: { testRc: true, redName: 'assertDomainHealthy' },
  },
  {
    id: 'M4',
    what: '把一条登记改指到**已接线**的组件（为容忍自己新增而登记）',
    file: BASE,
    from: '"path": "apps/desktop/src/components/AnnouncementBanner.vue"',
    to: '"path": "apps/desktop/src/components/UiButton.vue"',
    expect: { runRc: true, readout: 'STALE_BASELINE' },
  },
  {
    id: 'M5',
    what: '把 Gate 2b15 的判据本体从 workflow 里摘掉（注册≠注入≠生效）',
    file: WF,
    from: '          node scripts/check-unwired-components.js',
    to: '          :',
    expect: { testRc: true, redName: '接线锁' },
  },
  {
    id: 'M6',
    what: 'unregistered 恒空（未登记欠账不再阻断 = 打地鼠清单永远填不满的那一格）',
    file: GATE,
    from: '  const unregistered = unwired.filter((p) => !allowed.has(p))',
    to: '  const unregistered = []',
    expect: { testRc: true, redName: 'judge 把未接线拆成' },
  },
  {
    id: 'M7',
    what: '消费者前缀指到一个不存在的目录（扫描域塌成空集却照报结论）',
    file: GATE,
    from: "const CONSUMER_PREFIXES = ['apps/desktop/src/', 'apps/desktop/electron/', 'apps/desktop/packages/']",
    to: "const CONSUMER_PREFIXES = ['apps/desktop/no-such-face/']",
    expect: { testRc: true, redName: '消费者域规模下界' },
  },
]

// 只从**失败行**取用例名：TAP 的 `not ok N - 名`、spec 的 `✖ 名`、vitest 的 `× 名` / `FAIL 文件 > 名`。
// 通过行（`ok N - 名` / `✔ 名`）一律不收 —— 收了归因就没有资格声称"红在哪条锁上"。
const FAIL_PREFIX = /^\s*(?:not ok \d+\s*-\s*|✖|×|✕|FAIL\b)/
function failedTestNames (out) {
  const names = []
  for (const raw of String(out).split(/\r?\n/)) {
    const line = raw.replace(/\u001b\[[0-9;]*m/g, '').trim()
    if (!FAIL_PREFIX.test(line)) continue
    const leaf = line
      .replace(/^\s*(?:not ok \d+\s*-\s*|✖|×|✕|FAIL\s+)\s*/, '')
      .split('>').pop()
      .replace(/\s+\d+(?:\.\d+)?ms\s*$/, '')
      .trim()
    if (leaf) names.push(leaf)
  }
  return names
}
function selfCheckAttribution () {
  const sample = ['ok 1 - 通过的项 1 ms', 'not ok 2 - 失败的项 2 ms', '  ✖ 另一种失败行 3 ms'].join('\n')
  const got = failedTestNames(sample)
  return got.some((n) => n.includes('失败的项')) && got.some((n) => n.includes('另一种失败行')) && !got.some((n) => n.includes('通过的项'))
}

function applyAndProbe(knife) {
  const original = fs.readFileSync(knife.file)
  const text = original.toString('utf8')
  if (!text.includes(knife.from)) throw new Error(`锚点缺失（${knife.id}）：${knife.from.slice(0, 70)}`)
  const mutated = text.split(knife.from).join(knife.to)
  if (mutated === text) throw new Error(`变异没改变任何字节（${knife.id}）`)
  fs.writeFileSync(knife.file, mutated, 'utf8')
  try {
    const parts = []
    let caught = true
    if (knife.expect.runRc) {
      const r = run([GATE])
      const named = knife.expect.readout ? r.out.includes(knife.expect.readout) : true
      caught = r.rc !== 0 && named
      parts.push(`run:rc=${r.rc}${named ? '+点名' : '+未点名'}`)
    }
    if (knife.expect.testRc) {
      const r = run(['--test', TEST])
      // 归因只能取**失败行**里的用例名（QM-6 外部评审在姊妹驱动上抓到的 Critical 同型）：
      // node:test 对通过的用例也打印 `ok N - 名字`，所以整串 includes 会让"跑绿了"和
      // "红在我分配给它的锁上"完全同形 —— 那等于 CAUGHT 这个数可以既精确又无用。
      const failed = failedTestNames(r.out)
      const named = knife.expect.redName ? failed.some((n) => n.includes(knife.expect.redName)) : true
      caught = caught && r.rc !== 0 && named
      parts.push(`test:rc=${r.rc}${named ? '+指名' : '+未指名'} 失败行=${failed.length}`)
    }
    return { caught, detail: parts.join(' ') }
  } finally {
    fs.writeFileSync(knife.file, original)
    if (md5(fs.readFileSync(knife.file)) !== md5(original)) {
      throw new Error(`还原后字节不一致（${knife.id}）—— 必须人工核对，不得继续下一刀`)
    }
  }
}

if (!selfCheckAttribution()) {
  console.error('[MUTATE] 归因解析器自证失败（分不清通过行与失败行）⇒ 本驱动没有资格报告 CAUGHT，整轮按自身故障退出')
  process.exit(2)
}
console.log('[MUTATE] 归因自证通过（只收 not ok / ✖ / × / FAIL 行，不收 ok / ✔ 行）')
const baselineRun = run([GATE])
console.log(`[MUTATE] 基线趟 rc=${baselineRun.rc} :: ${(baselineRun.out.split(/\r?\n/).find((l) => l.includes('UNWIRED-COMPONENTS')) || '(无读数行)').slice(0, 140)}`)
if (baselineRun.rc !== 0) {
  console.error('[MUTATE] 基线趟就红 ⇒ 先修判据再做反证（此时变异集无法归因）')
  process.exit(2)
}

let caught = 0
for (const k of KNIVES) {
  try {
    const r = applyAndProbe(k)
    console.log(`${r.caught ? 'CAUGHT     ' : 'NOT_CAUGHT '} ${k.id} ${k.what}${r.detail ? ' :: ' + r.detail : ''}`)
    if (r.caught) caught++
  } catch (e) {
    console.log(`ERROR      ${k.id} ${e.message}`)
  }
}
console.log(`[MUTATE] 汇总 CAUGHT=${caught}/${KNIVES.length} 还原核对=逐刀 md5 相等`)
process.exit(caught === KNIVES.length ? 0 : 1)
