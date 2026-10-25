'use strict'
// 一次性反证驱动：把 #4424 防回退锁的五条退化路径逐条注入，要求「当场红 + 红在指名的那条用例」
// 本地同口径：node scripts/codepoint-length-mutate.cjs
const fs = require('node:fs')
const path = require('node:path')
const crypto = require('node:crypto')
const { spawnSync } = require('node:child_process')

const REPO = path.resolve(__dirname, '..')
const TEST = 'src/text-length-convergence.test.js'
const T = 'apps/desktop/src/text-length-convergence.test.js'
const md5 = (b) => crypto.createHash('md5').update(b).digest('hex')

function run (args) {
  const r = spawnSync('pnpm.CMD', ['exec', 'vitest', 'run', TEST], {
    cwd: path.join(REPO, 'apps', 'desktop'), encoding: 'utf8', shell: true, windowsHide: true,
  })
  return { rc: r.status, out: (r.stdout || '') + (r.stderr || '') }
}

// 归因只看失败行：node/vitest 会把**通过**的用例名也回显（✓ / ok），按整串 includes 判"指名"等于零效
const FAIL_LINE = /^\s*(?:×|✕|✖|FAIL\b)/
function failedTestNames (out) {
  const clean = out.replace(/\u001B\[[0-9;]*m/g, '')
  const names = []
  for (const line of clean.split(/\r?\n/)) {
    if (!FAIL_LINE.test(line)) continue
    const seg = line.split('>').pop().replace(/\s+\d+ms\s*$/, '').trim()
    if (seg && !/^(FAIL|×|✕|✖)/i.test(seg)) names.push(seg)
  }
  return names
}
function selfCheckAttribution () {
  const s = [' ✓ src/x.test.js > 通过的用例  12ms', ' × src/x.test.js > 失败的用例  3ms', ' FAIL  src/y.test.js > 另一个失败'].join('\n')
  const got = failedTestNames(s)
  return got.includes('失败的用例') && got.includes('另一个失败') && !got.includes('通过的用例')
}

const KNIVES = [
  {
    id: 'M1', what: '重新塞进一个死导入（评审 i1 的形态）',
    file: 'apps/desktop/src/views/video-creation/StageProgress.vue',
    from: "import { truncateWithin } from '@multi-publish/shared-utils/src/text-length'",
    to: "import { truncateWithin, codePointLength } from '@multi-publish/shared-utils/src/text-length'",
    red: '导入必须被真正调用',
  },
  {
    id: 'M2', what: '把撞车谓词改成恒不匹配（锁变成装饰）',
    file: T,
    from: "function collidedDecls (names, rest) {\n  return names.filter((n) => new RegExp('^\\\\s*(?:function|const|let|var|class)\\\\s+' + n + '\\\\b', 'm').test(rest))\n}",
    to: 'function collidedDecls () {\n  return []\n}',
    red: '撞车谓词必须认得本案历史文本',
  },
  {
    id: 'M6', what: '把死导入谓词改成恒空集（锁与探针同源，必须一起红）',
    file: T,
    from: "function deadImports (names, rest) {\n  // 只认「被当函数调用」—— 对象字面量的键 truncate: 与属性名不是使用（ResultView.vue 实测踩过）\n  return names.filter((n) => !new RegExp('\\\\b' + n + '\\\\s*\\\\(').test(rest))\n}",
    to: 'function deadImports () {\n  return []\n}',
    red: '撞车谓词必须认得本案历史文本',
  },
  {
    id: 'M3', what: '把一个已迁移站点退回按码元截断',
    file: 'apps/desktop/src/components/PublishProgressTaskRow.vue',
    from: "return truncate(text, 120, '…')",
    to: "return text.slice(0, 120) + '…'",
    red: '已迁移站点必须逐条仍然按码点',
  },
  {
    id: 'M4', what: '把形态判据改成永不命中（反失明正控必须抓到）',
    file: T,
    from: "'\\\\.(?:slice|substring)\\\\(\\\\s*0\\\\s*,",
    to: "'\\\\.neverMatchesThisX\\\\(\\\\s*0\\\\s*,",
    red: '反失明锚点',
  },
  {
    id: 'M5', what: '把站点台账清空（锁自己失去覆盖面）',
    file: T,
    from: 'for (const [rel, call, times] of MIGRATED_SITES) {',
    to: 'for (const [rel, call, times] of []) {',
    red: '已迁移站点必须逐条仍然按码点',
  },
]

function applyAndProbe (k) {
  const abs = path.join(REPO, k.file)
  const original = fs.readFileSync(abs)
  const text = original.toString('utf8')
  if (!text.includes(k.from)) throw new Error('锚点缺失（' + k.id + '）：' + k.from.slice(0, 60))
  fs.writeFileSync(abs, text.split(k.from).join(k.to), 'utf8')
  try {
    const r = run()
    const names = failedTestNames(r.out)
    const named = names.some((n) => n.includes(k.red))
    return { caught: r.rc !== 0 && named, detail: 'rc=' + r.rc + (named ? '+指名「' + k.red + '」' : '+未指名（红在别处：' + names.join('|') + '）') }
  } finally {
    fs.writeFileSync(abs, original)
    if (md5(fs.readFileSync(abs)) !== md5(original)) throw new Error('还原后字节不一致（' + k.id + '）—— 停止后续刀')
  }
}

if (!selfCheckAttribution()) {
  console.error('[MUTATE] 归因探针自检不通过（无法把 ✓ 与 × 区分开）⇒ 本轮不报 CAUGHT 计数')
  process.exit(2)
}
const base = run()
console.log('[MUTATE] 基线趟 rc=' + base.rc + ' 失败行=' + (failedTestNames(base.out).length || 0))
if (base.rc !== 0) { console.error('[MUTATE] 基线就红 ⇒ 变异无法归因，先修再反证'); process.exit(2) }

let caught = 0
for (const k of KNIVES) {
  try {
    const r = applyAndProbe(k)
    console.log((r.caught ? 'CAUGHT     ' : 'NOT_CAUGHT ') + k.id + ' ' + k.what + ' :: ' + r.detail)
    if (r.caught) caught++
  } catch (e) { console.log('ERROR      ' + k.id + ' ' + e.message); break }
}
const after = run()
console.log('[MUTATE] 还原后复跑 rc=' + after.rc)
console.log('[MUTATE] 汇总 CAUGHT=' + caught + '/' + KNIVES.length + ' 逐刀 md5 还原=true 复跑' + (after.rc === 0 ? '绿' : '红'))
process.exit(caught === KNIVES.length && after.rc === 0 ? 0 : 1)
