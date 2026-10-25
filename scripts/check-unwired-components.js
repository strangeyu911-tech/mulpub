'use strict'

// 阶段 5.3「未接线组件门禁」：把「写好了但没有任何东西把它接到用户面前」变成机器判据。
//
// 动因不是抽象洁癖，而是审计 1.1 的实测：71 条体验问题里有 **11 条属同一形状**（涉及 13 个未接线对象）
// —— `useTheme()` 零调用方，而全仓 72-77 处 `[data-theme=dark]` 暗色分支与「深色低对比 61→0」的整改
// 成果在用户侧**永远不可达**；`AnnouncementBanner`/`StaggeredList`/`UiField.forId` 同型。
// 这正是本仓 AGENTS 记的「装饰性链路」在 UI 层的复发。
//
// 三条设计约束（都是本仓踩过的坑）：
//  1. **扫描域取 git，不取磁盘**（复用 `scripts/lib/git-domain.js`）。按磁盘遍历会把别的会话留在
//     共享根里的 `.adversarial/…` 当成仓库内容 ⇒ 门禁天天红等于没有（#3876/#3900 同一条路）。
//  2. **判"已接线"取宽松、判"未接线"取保守**：只要组件名在任何非测试源文件里以四种形态之一出现
//     （`Name.vue`、`<Name`、`<kebab-name`、`'Name'` 注册）就算已接线。宁可漏登记一笔债，
//     也不给无关 PR 造假红 —— 假红会把 required check 钉住整条合并队列。
//  3. **空域一律抛错**：「零个组件」与「没有欠账」必须可区分（与 check-unwired-tests 同一条判据）。
//
// 本地同口径：node scripts/check-unwired-components.js
// 接线位置：.github/workflows/quality-gate.yml 的 Gate 2b（shell: bash，fail-fast）

const fs = require('node:fs')
const path = require('node:path')
const { gitDomain } = require('./lib/git-domain')

const REPO = path.resolve(__dirname, '..')
const BASELINE_FILE = path.join(__dirname, 'unwired-components-baseline.json')

const COMPONENT_DIR = 'apps/desktop/src/components/'
const CONSUMER_PREFIXES = ['apps/desktop/src/', 'apps/desktop/electron/', 'apps/desktop/packages/']
const TEST_RE = /(\.test\.|\.spec\.|__tests__\/|\.visual\.|\.contract\.|tests\/)/

function isSource(p) {
  return /\.(vue|js|cjs|mjs|ts)$/.test(p) && !TEST_RE.test(p)
}

/** 组件候选：components 目录下的 .vue（不含测试快照/示例） */
function componentCandidates(domain) {
  return [...domain].filter((p) => p.startsWith(COMPONENT_DIR) && /\.vue$/.test(p) && !TEST_RE.test(p)).sort()
}

/** kebab 形态：UiButton → ui-button；供模板里 <ui-button> 这类写法也算已接线 */
function kebab(name) {
  return name.replace(/([a-z0-9])([A-Z])/g, '$1-$2').toLowerCase()
}

/**
 * 一个组件是否被「除自己以外」的源文件引用。
 * 四种形态都算（见文件头第 2 条），因为它要回答的是「有没有可能被用」，不是「确定被用」。
 */
function isWired(name, consumers, selfPath) {
  const kb = kebab(name)
  const pats = [
    new RegExp('[\'"`/]' + name + '\\.vue$|[\'"`/]' + name + '\\.vue[\'"`]', 'm'),
    new RegExp('<' + name + '[\\s/>]'),
    new RegExp('<' + kb + '[\\s/>]'),
    new RegExp('[\'"`]' + name + '[\'"`]'),
  ]
  for (const [rel, text] of consumers) {
    if (rel === selfPath) continue
    if (pats.some((re) => re.test(text))) return true
  }
  return false
}

function loadBaseline() {
  if (!fs.existsSync(BASELINE_FILE)) return { entries: [] }
  const parsed = JSON.parse(fs.readFileSync(BASELINE_FILE, 'utf8'))
  if (!parsed || !Array.isArray(parsed.entries)) throw new Error('基线 JSON 形状不对：期望 { entries: [{path, reason}] }')
  for (const e of parsed.entries) {
    if (!e || typeof e.path !== 'string' || typeof e.reason !== 'string' || !e.reason.trim()) {
      throw new Error('基线条目必须带非空 reason（登记即承认欠账，不许空手放行）：' + JSON.stringify(e))
    }
  }
  return parsed
}

/**
 * 域健康守卫：把「判据失明」与「没有欠账」分开。
 * 之所以是独立导出的纯函数而不是 main() 里的两行 if —— 结构锁只查字符串是否存在，
 * 对「守卫还在文案里、条件已被改成恒假」完全免疫（本仓反复出现的装饰性门禁同型）。
 * 由它自己的用例逐条行为断言（candidates=0 必须抛、consumers 过小必须抛、健康规模必须过）。
 */
function assertDomainHealthy(domainSize, candidates, consumers) {
  if (candidates === 0) {
    throw new Error('components 域为空（domain 共 ' + domainSize + ' 条）⇒ 判据失明，不得出结论')
  }
  if (consumers < 100) {
    throw new Error('消费者域只有 ' + consumers + ' 个文件，远低于本仓规模 ⇒ 拒绝出结论')
  }
}

function judge(candidates, consumers, baseline) {
  const allowed = new Map(baseline.entries.map((e) => [e.path, e.reason]))
  const unwired = candidates.filter((p) => !isWired(path.basename(p).replace(/\.vue$/, ''), consumers, p))
  const unregistered = unwired.filter((p) => !allowed.has(p))
  const stale = [...allowed.keys()].filter((p) => !unwired.includes(p))
  const emptyReason = allowed.size > 0 ? unregistered.length + stale.length > 0 : unwired.length > 0
  return { unwired, unregistered, stale, blocking: emptyReason }
}

function main() {
  const domain = gitDomain(REPO)
  const candidates = componentCandidates(domain)
  const consumers = new Map()
  for (const p of domain) {
    if (!CONSUMER_PREFIXES.some((pre) => p.startsWith(pre))) continue
    if (!isSource(p)) continue
    consumers.set(p, fs.readFileSync(path.join(REPO, p), 'utf8'))
  }
  assertDomainHealthy(domain.size, candidates.length, consumers.size)
  const baseline = loadBaseline()
  const r = judge(candidates, consumers, baseline)
  console.log(
    '[UNWIRED-COMPONENTS] domain=' + domain.size + ' components=' + candidates.length + ' consumers=' + consumers.size +
    ' 未接线=' + r.unwired.length + ' 未登记=' + r.unregistered.length + ' 陈旧登记=' + r.stale.length + ' 基线=' + baseline.entries.length,
  )
  for (const p of r.unregistered) console.log('  UNWIRED ' + p + '（既无引用也不在基线里 ⇒ 要么接线、要么带理由登记）')
  for (const p of r.stale) console.log('  STALE_BASELINE ' + p + '（已接线，必须同次从基线删除）')
  if (r.blocking) {
    console.error('FAIL：存在未登记的未接线组件或陈旧登记。基线只能缩小；为容忍自己新增而调大 = 把判据变成摆设。')
    return 1
  }
  console.log('PASS：components 域内每个 .vue 要么有引用，要么带理由登记（且登记项现在仍未接线）。')
  return 0
}

if (require.main === module) {
  try {
    process.exit(main())
  } catch (e) {
    console.error('[UNWIRED-COMPONENTS] 判据自身故障（按未证实处理，不得读成通过）：' + (e && e.message ? e.message : String(e)))
    process.exit(2)
  }
} else {
  module.exports = { componentCandidates, kebab, isWired, judge, isSource, assertDomainHealthy }
}
