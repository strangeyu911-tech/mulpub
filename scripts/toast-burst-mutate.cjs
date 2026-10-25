'use strict'
// 阶段 4.6 连发限频的反证驱动 v2。
// v1 的归因用 out.includes(红点名)，而 vitest 连通过用例名也回显（✓ 行）⇒ 归因零效力，
// 任何一刀只要 rc≠0 就会被记成"红在我分配给它的锁"，CAUGHT=7/7 可以既精确又无用。
// 该缺陷由 QM-6 外部评审 i1 判为 Critical（2026-10-25）。v2 只从失败行（× / FAIL）取名字，
// 且驱动开头自证解析器分得清 ✓ 与 ×；自证不过则整轮拒绝出结论（rc=2），不报任何 CAUGHT。
const fs = require('node:fs')
const path = require('node:path')
const crypto = require('node:crypto')
const { execFileSync } = require('node:child_process')

const REPO = path.resolve(__dirname, '..')
const DESKTOP = path.join(REPO, 'apps', 'desktop')
const BURST = path.join(DESKTOP, 'src', 'utils', 'notify-burst.js')
const USE = path.join(DESKTOP, 'src', 'composables', 'useNotify.js')
const VITEST = path.join(REPO, 'node_modules', 'vitest', 'vitest.mjs')
const SUITES = [
  'src/utils/notify-burst.test.js',
  'src/composables/useNotify.burst.test.js',
  'src/composables/useNotify.test.js',
]
const md5 = (b) => crypto.createHash('md5').update(b).digest('hex')

const runVitest = (files) => {
  try {
    return { rc: 0, out: execFileSync(process.execPath, [VITEST, 'run'].concat(files), { cwd: DESKTOP, encoding: 'utf8', maxBuffer: 1 << 28, stdio: ['ignore', 'pipe', 'pipe'] }) }
  } catch (e) { return { rc: typeof e.status === 'number' ? e.status : 99, out: String(e.stdout || '') + String(e.stderr || '') } }
}

const KNIVES = [
  { id: 'B1', file: USE, what: '限频分支改恒假', from: '    if (!burst.allow) {', to: '    if (false && !burst.allow) {', suite: [SUITES[1]], red: '窗口内前 limit 条真的展示' },
  { id: 'B2', file: USE, what: '抑制时跳过日志上报', from: '    if (!burst.allow) {', to: '    if (!burst.allow) { return text', suite: [SUITES[1]], red: '抑制不等于丢事件' },
  { id: 'B3', file: USE, what: '抑制不出声', from: "      console.warn('[notify] burst-limit", to: "      // console.warn('[notify] burst-limit", suite: [SUITES[1]], red: '抑制必须出声' },
  { id: 'B4', file: BURST, what: '被抑制也占额度', from: '    if (stamps.length >= limit) {', to: '    if (stamps.length >= limit) { stamps.push(t)', suite: [SUITES[0]], red: '抑制不占用额度' },
  { id: 'B5', file: BURST, what: '过期判据恒真（回拨清窗）', from: '    while (stamps.length > 0 && t - stamps[0] >= windowMs) stamps.shift()', to: '    while (stamps.length > 0 && t - stamps[0] > -1) stamps.shift()', suite: [SUITES[0]], red: '时钟回拨' },
  { id: 'B6', file: BURST, what: '非法档位不回落', from: '  if (!Number.isInteger(value) || value <= 0) {', to: '  if (false) {', suite: [SUITES[0]], red: '非法值回落默认' },
  { id: 'B7', file: BURST, what: '计数退回全局共享', from: '  const stamps = []', to: '  const stamps = (globalThis.__mpBurstShared = globalThis.__mpBurstShared || [])', suite: [SUITES[0]], red: '每个 guard 实例各自计数' },
]

const FAIL_RE = /^\s*(?:\u00d7|\u2715|\u2716|FAIL\b)/
function failedTestNames (out) {
  const names = []
  for (const raw of out.split(/\r?\n/)) {
    const line = raw.replace(/\u001b\[[0-9;]*m/g, '').trim()
    if (!FAIL_RE.test(line)) continue
    const leaf = line.replace(/^\s*(?:\u00d7|\u2715|\u2716|FAIL)\s*/, '').split('>').pop().replace(/\s+\d+(?:\.\d+)?ms\s*$/, '').trim()
    if (leaf) names.push(leaf)
  }
  return names
}
function selfCheck () {
  const s = [' \u2713 a.test.js > \u901a\u8fc7\u9879  1ms', ' \u00d7 b.test.js > \u5931\u8d25\u9879  2ms', 'FAIL  c.test.js > \u660e\u7ec6\u9879'].join('\n')
  const g = failedTestNames(s)
  return g.includes('\u5931\u8d25\u9879') && g.includes('\u660e\u7ec6\u9879') && !g.includes('\u901a\u8fc7\u9879')
}

let restored = true
function applyAndProbe (k) {
  const original = fs.readFileSync(k.file)
  const text = original.toString('utf8')
  if (!text.includes(k.from)) throw new Error('\u951a\u70b9\u7f3a\u5931\uff08' + k.id + '\uff09')
  fs.writeFileSync(k.file, text.split(k.from).join(k.to), 'utf8')
  try {
    const r = runVitest(k.suite)
    const failed = failedTestNames(r.out)
    const named = failed.some((n) => n.includes(k.red))
    return { caught: r.rc !== 0 && named, detail: 'rc=' + r.rc + (named ? '+\u70b9\u540d' : '+\u672a\u70b9\u540d') + ' \u5931\u8d25\u884c=' + failed.length + (failed.length ? '\uff08' + failed.slice(0, 2).join('\u3001') + '\uff09' : '') }
  } finally {
    fs.writeFileSync(k.file, original)
    if (md5(fs.readFileSync(k.file)) !== md5(original)) { restored = false; throw new Error('\u8fd8\u539f\u4e0d\u4e00\u81f4\uff08' + k.id + '\uff09\uff0c\u505c\u6b62\u540e\u7eed\u5200') }
  }
}

if (!selfCheck()) { console.error('[MUTATE] \u5f52\u56e0\u89e3\u6790\u5668\u81ea\u8bc1\u5931\u8d25 \u21d2 \u6ca1\u6709\u8d44\u683c\u62a5\u544a CAUGHT'); process.exit(2) }
console.log('[MUTATE] \u5f52\u56e0\u81ea\u8bc1\u901a\u8fc7\uff08\u53ea\u4ece \u00d7/FAIL \u884c\u53d6\u540d\uff0c\u2713 \u884c\u4e0d\u7b97\uff09')
const base = runVitest(SUITES)
console.log('[MUTATE] \u57fa\u7ebf\u8d9b rc=' + base.rc + ' :: ' + ((base.out.match(/Tests\s+.*/) || ['(\u65e0\u6c47\u603b\u884c)'])[0]))
if (base.rc !== 0) { console.error('[MUTATE] \u57fa\u7ebf\u8d9b\u5c31\u7ea2 \u21d2 \u53d8\u5f0f\u96c6\u65e0\u6cd5\u5f52\u56e0'); process.exit(2) }

let caught = 0
for (const k of KNIVES) {
  try {
    const r = applyAndProbe(k)
    console.log((r.caught ? 'CAUGHT     ' : 'NOT_CAUGHT ') + k.id + ' ' + k.what + ' :: ' + r.detail)
    if (r.caught) caught++
  } catch (e) { console.log('ERROR      ' + k.id + ' ' + e.message) }
}
const after = runVitest(SUITES)
console.log('[MUTATE] \u8fd8\u539f\u540e\u590d\u8dd1 rc=' + after.rc + ' :: ' + ((after.out.match(/Tests\s+.*/) || ['(\u65e0\u6c47\u603b\u884c)'])[0]))
console.log('[MUTATE] \u6c47\u603b CAUGHT=' + caught + '/' + KNIVES.length + ' \u9010\u5200 md5 \u8fd8\u539f=' + (restored ? 'true' : 'FALSE') + ' \u6536\u5c3e\u8986\u76d6\u5957\u6570=' + SUITES.length)
process.exit(caught === KNIVES.length && restored && after.rc === 0 ? 0 : 1)
