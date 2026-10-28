'use strict'
// 阶段 1.9「未知路由兜底页」的变异反证驱动
// 本地同口径：node scripts/route-catchall-mutate.cjs
//
// 两条被本轮真实踩过的坑，写进实现而不是靠记忆：
//  ① **同一文件只允许一份 original 快照**。上一版为 K2 开了第二份快照（extraFile 指向同一个
//     router/index.js），那份快照存的已经是"被第一刀改坏"的内容，finally 回写时把 catch-all 行
//     永久抹掉了 —— 表现是"逐刀 md5 还原=true"却留下变异态，因为两次回写各自与自己那份快照相符。
//     正解：一刀内多次替换都走同一份快照的 steps 数组。
//  ② 归因只取失败行（× / ✖ / FAIL），且开局自检探针必须能区分 ✓ 与 ×；自检不过一律 rc=2 不报数。
const fs = require('node:fs')
const path = require('node:path')
const crypto = require('node:crypto')
const { spawnSync } = require('node:child_process')

const REPO = path.resolve(__dirname, '..')
const DESKTOP = path.join(REPO, 'apps', 'desktop')
const md5 = (b) => crypto.createHash('md5').update(b).digest('hex')

const ROUTER = 'apps/desktop/src/router/index.js'
const VIEW = 'apps/desktop/src/views/NotFound.vue'
const CATCH_LINE = "  { path: '/:pathMatch(.*)*', name: 'NotFound', component: () => import('@/views/NotFound.vue') },"
const HOME_ROUTE = "  { path: '/', name: 'Home'"

const KNIVES = [
  {
    id: 'K1', what: '删掉 catch-all（回到"未登记路径渲染空白外壳"）',
    file: ROUTER, red: ['未登记路径解析到 NotFound'],
    steps: [{ from: CATCH_LINE, to: '' }],
  },
  {
    id: 'K2', what: '把 catch-all 挪到路由表首位（位置约定退化）',
    // 实测读数（本轮）：通配挪到首位后，只有位置锁红，"逐条解析"那条**不红** ——
    // vue-router 4 按 rank 而非声明顺序匹配。所以期望就是一条，不得虚报成两条防线。
    file: ROUTER, red: ['反向锁'],
    steps: [
      { from: CATCH_LINE, to: '' },
      { from: HOME_ROUTE, to: CATCH_LINE + '\n' + HOME_ROUTE },
    ],
  },
  {
    id: 'K3', what: '把 canGoBack 写死成 true（深链直达会出现死按钮）',
    file: VIEW, red: ['无上一条历史时不渲染'],
    steps: [{ from: '  const back = router.options?.history?.state?.back', to: "  const back = router.options?.history?.state?.back || '/publish'" }],
  },
  {
    id: 'K4', what: '摘掉 computed 的导航依赖（history.state 不响应式 ⇒ 首帧读数被冻住）',
    file: VIEW, red: ['翻转正控'],
    // 锚点**不焊行尾**（记录「自我更正」第 3 条：CRLF 检出下 `+ '\n'` 会报"锚点命中 0 次"，
    // 把整条证据链伪装成"代码已变"）。这里只取语句本身，替换后留下的空行由 JS 语法容忍。
    steps: [{ from: '  void route.fullPath', to: '  // 依赖已摘除（K4）' }],
  },
  {
    id: 'K5', what: '把文案改成硬编码中文（绕过 locale，zh/en 成对合同失效）',
    file: VIEW, red: ['模板内不得出现中文字面量'],
    steps: [{ from: "{{ $t('notFound.title') }}", to: '页面不存在' }],
  },
  {
    id: 'K6', what: '把回首页改成 push（兜底页开始往历史里堆）',
    file: VIEW, red: ['主出口「回首页」'],
    steps: [{ from: '  router.replace(\'/\')', to: '  router.push(\'/\')' }],
  },
  {
    // 评审 i1 的判据专属刀：只摘掉"上一页是不是 404"这一层，保留 Boolean(back) 那层。
    // 若与 K3 合并成一条，就证不出回路判据本身有牙（K3 红的是"无历史"那一档）。
    id: 'K7', what: '摘掉 404→404 回路判据（返回按钮会落到另一个 404）',
    file: VIEW, red: ['上一页本身也是未登记路径'],
    steps: [{ from: "  return prevName !== 'NotFound'", to: '  return true' }],
  },
  {
    // 评审 i4 的判据专属刀：把键位抄回文案，锁必须当场红（真源是 electron/services/hotkeys.js）
    id: 'K8', what: '把键位字面量抄回提示文案（与 hotkeys.js 真源脱钩）',
    file: 'apps/desktop/src/locales/not-found/zh.js', red: ['提示文案不得复述键位'],
    steps: [{ from: '也可以用左侧菜单直接进入账号、发布、创作等页面；', to: '快捷键 Ctrl+Alt+1 到 6 可切换；' }],
  },
]

const SUITE = ['src/router/catchall-route.test.js', 'src/views/NotFound.test.js']

function run () {
  const r = spawnSync('pnpm.CMD', ['exec', 'vitest', 'run'].concat(SUITE), {
    cwd: DESKTOP, encoding: 'utf8', shell: true, windowsHide: true,
  })
  return { rc: r.status, out: (r.stdout || '') + (r.stderr || '') }
}

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
  const s = [' ✓ a > 通过的用例  12ms', ' × a > 失败的用例  3ms', ' FAIL  b > 另一个失败'].join('\n')
  const got = failedTestNames(s)
  return got.includes('失败的用例') && got.includes('另一个失败') && !got.includes('通过的用例')
}

function applyAndProbe (k) {
  const abs = path.join(REPO, k.file)
  const original = fs.readFileSync(abs)          // ← 本刀唯一的一份快照
  let text = original.toString('utf8')
  for (const s of k.steps) {
    const n = text.split(s.from).length - 1
    if (n !== 1) {
      fs.writeFileSync(abs, original)
      throw new Error(k.id + ' 锚点命中 ' + n + ' 次，期望 1：' + s.from.slice(0, 44))
    }
    text = text.split(s.from).join(s.to)
  }
  fs.writeFileSync(abs, text, 'utf8')
  try {
    const r = run()
    const names = failedTestNames(r.out)
    const missing = k.red.filter((w) => !names.some((n) => n.includes(w)))
    const named = missing.length === 0
    return {
      caught: r.rc !== 0 && named,
      detail: 'rc=' + r.rc + (named
        ? '+点名' + k.red.length + '条'
        : '+未点名：缺[' + missing.join(',') + ']，红在别处：' + names.join('|')),
    }
  } finally {
    fs.writeFileSync(abs, original)
    if (md5(fs.readFileSync(abs)) !== md5(original)) throw new Error('还原后字节不一致（' + k.id + '）—— 停止后续刀')
  }
}

if (!selfCheckAttribution()) { console.error('[MUTATE] 归因探针自检不过 ⇒ 拒绝汇报 CAUGHT'); process.exit(2) }
const base = run()
console.log('[MUTATE] 基线趟 rc=' + base.rc + ' 失败行=' + (failedTestNames(base.out).length || 0))
if (base.rc !== 0) { console.error('[MUTATE] 基线就红 ⇒ 无法归因，先修再反证'); process.exit(2) }

let caught = 0
for (const k of KNIVES) {
  try {
    const r = applyAndProbe(k)
    console.log((r.caught ? 'CAUGHT     ' : 'NOT_CAUGHT ') + k.id + ' ' + k.what + ' :: ' + r.detail)
    if (r.caught) caught++
  } catch (e) { console.log('ERROR      ' + k.id + ' ' + e.message) }
}
const after = run()
console.log('[MUTATE] 还原后复跑 rc=' + after.rc + ' 失败行=' + (failedTestNames(after.out).length || 0))
console.log('[MUTATE] 汇总 CAUGHT=' + caught + '/' + KNIVES.length + '（逐刀同一份快照、md5 还原校验）')
process.exit(caught === KNIVES.length && after.rc === 0 ? 0 : 1)
