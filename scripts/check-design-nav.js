#!/usr/bin/env node
/**
 * check-design-nav.js —— 桌面端设计稿「导航契约」体检（规格书 §12）。
 *
 * 为什么这把锁住在 scripts/ 而不是 01-docs/ 里：它的**输入**是 01-docs/**（docs-only 白名单内），
 * 而住在会被 docs-only 短路的 job（static-gates）里，等于「纯文档 PR 一次都不跑」——
 * 同 #3114 的实测事故形态。所以它必须接线进 quality-gate.yml 的 `changes` job
 * （那个 job 没有 job 级 if，无条件执行）。
 *
 * 它守的契约（全部来自 01-docs/ui-reference/design-2026-10/UI-DESIGN-FINAL-2026-10-24.md §12）：
 *   D1 无死链       每条导航链接的锚点必须是一个真实屏 id
 *   D2 文字唯一     全部导航链接的文字两两不同 —— **不得剥掉「· 空态」这类状态后缀**再比
 *   D3 一一覆盖     每个屏恰好在导航里出现一次（漏加 / 重复挂都判红）
 *   D4 文字=caption 导航文字必须**逐字等于**目标屏 caption 的「编号 + 屏名」
 *   D5 同页同号     同一编号组内，各屏屏名的基名（`·` 之前的部分）必须相同
 *                   （⇒ 同一页面的多个状态屏共用编号）
 *   D6 组内互异     同一编号组内，各屏屏名必须互不相同
 *
 * ⚠️ 两条踩过坑的口径，改动前先读：
 *   ① 比唯一性时**不能**剥状态后缀。剥掉后「20 自动化任务」与「20 自动化任务 · 空态」
 *      会被误判成重复 —— 外部评审 i8 当初就栽在「核查脚本误报 ⇒ 以为产品没缺陷」上。
 *   ② 核查对象必须是**仓内产物** `01-docs/ui-reference/design-2026-10/index.html`，
 *      不是设计源工作副本。i8 当初核的是设计源、结论核错了对象。
 *
 * 退出码：0 = 契约全过；1 = 有违约（逐条列出）；2 = 判据自身故障（文件缺失 / 结构变了）。
 * 「门禁瞎了」必须与「没有问题」区分开，否则这把锁等于装饰。
 */
'use strict'

const fs = require('node:fs')
const path = require('node:path')

/** 仓内产物路径（相对仓库根）。用 posix 拼，保证跨平台一致。 */
const REL_PRODUCT = '01-docs/ui-reference/design-2026-10/index.html'

/** 导航容器与屏容器的 class（产品结构变了 ⇒ 判据自身故障，不是「没有违规」）。 */
const NAV_CLASS = 'deck-nav'
const SCREEN_RE = /<section class="screen" id="([^"]+)">([\s\S]*?)<\/section>/g
const CAPTION_RE = /<div class="caption">([\s\S]*?)<\/div>/
const NAV_LINK_RE = /<a\s+href="#([^"]+)"[^>]*>([^<]+)<\/a>/g

/** 状态后缀的分隔符（§12：主态可省略，其余必带「· 状态」）。 */
const SUFFIX_SEP = '·'

/**
 * 解析屏：id + caption 的三段（编号 / 屏名 / 副标题）。
 * @returns {{id:string,num:string,name:string,title:string}[]}
 */
function parseScreens(html) {
  const out = []
  const re = new RegExp(SCREEN_RE.source, 'g')
  let m
  while ((m = re.exec(html)) !== null) {
    const id = m[1]
    const body = m[2]
    const cap = (body.match(CAPTION_RE) || [])[1] || ''
    const num = ((cap.match(/<b>([^<]*)<\/b>/) || [])[1] || '').trim()
    const name = ((cap.match(/<span>([^<]*)<\/span>/) || [])[1] || '').trim()
    out.push({ id, num, name, title: (num + ' ' + name).trim() })
  }
  return out
}

/**
 * 解析导航：只取导航容器内、指向本页锚点的链接。
 * 容器找不到 ⇒ 返回 null（判据自身故障）；容器在但一个链接都没有 ⇒ 返回空数组
 * （结构变了，同样按判据自身故障处理，见 check()）。
 * @returns {{href:string,text:string}[]|null}
 */
function parseNav(html) {
  const at = html.indexOf(NAV_CLASS)
  if (at < 0) return null
  const open = html.lastIndexOf('<', at)
  const end = html.indexOf('</nav>', at)
  if (end < 0) return null
  const seg = html.slice(open, end)
  const out = []
  const re = new RegExp(NAV_LINK_RE.source, 'g')
  let m
  while ((m = re.exec(seg)) !== null) out.push({ href: m[1], text: m[2].trim() })
  return out
}

/**
 * 跑全部契约。
 * @param {string} html 产物全文
 * @returns {{violations: {code:string,detail:string}[], stats: object}}
 */
function check(html) {
  const violations = []
  const screens = parseScreens(html)
  const links = parseNav(html)

  const broken = (detail) => ({ violations: [{ code: 'JUDGE_BROKEN', detail }], stats: {} })

  if (!links) return broken('产物里找不到可解析的导航容器（class="deck-nav" / </nav>）')
  if (!links.length) return broken('导航容器解析出来一个链接都没有 —— 产品结构变了，判据读不懂')
  if (!screens.length) return broken('产物里一个 .screen 都没解析出来')

  const byId = new Map(screens.map((s) => [s.id, s]))

  // —— D1 无死链 + D4 文字=caption ——
  for (const l of links) {
    const s = byId.get(l.href)
    if (!s) {
      violations.push({ code: 'DEAD_LINK', detail: `导航「${l.text}」指向 #${l.href}，但没有这个屏` })
      continue
    }
    if (l.text !== s.title) {
      violations.push({
        code: 'TEXT_CAPTION_MISMATCH',
        detail: `导航「${l.text}」≠ 屏 #${l.href} 的 caption 标题「${s.title}」（§12：链接文字 = 屏 caption 标题，逐字相等）`,
      })
    }
  }

  // —— D2 文字唯一（不剥状态后缀）——
  const byText = new Map()
  for (const l of links) byText.set(l.text, (byText.get(l.text) || 0) + 1)
  for (const [text, n] of byText) {
    if (n > 1) {
      violations.push({ code: 'DUPLICATE_TEXT', detail: `导航文字「${text}」出现 ${n} 次（§12：47 个链接的文字两两不同）` })
    }
  }

  // —— D3 一一覆盖：每个屏恰好在导航里出现一次 ——
  const navCount = new Map()
  for (const l of links) navCount.set(l.href, (navCount.get(l.href) || 0) + 1)
  for (const s of screens) {
    const n = navCount.get(s.id) || 0
    if (n === 0) {
      violations.push({ code: 'SCREEN_NOT_IN_NAV', detail: `屏 #${s.id}（${s.title}）没出现在导航里` })
    } else if (n > 1) {
      violations.push({ code: 'SCREEN_IN_NAV_TWICE', detail: `屏 #${s.id}（${s.title}）在导航里出现了 ${n} 次` })
    }
  }

  // —— D5 同页同号 / D6 组内互异 ——
  const byNo = new Map()
  for (const s of screens) {
    if (!byNo.has(s.num)) byNo.set(s.num, [])
    byNo.get(s.num).push(s)
  }
  for (const [no, group] of byNo) {
    if (group.length < 2) continue
    const bases = group.map((s) => s.name.split(SUFFIX_SEP)[0].trim())
    if (new Set(bases).size !== 1) {
      violations.push({
        code: 'GROUP_BASE_NAME_MISMATCH',
        detail: `编号 ${no} 的各屏基名不一致：${group.map((s) => s.name).join(' / ')}（同一页面的多个状态屏必须共用编号）`,
      })
    }
    const names = group.map((s) => s.name)
    if (new Set(names).size !== names.length) {
      violations.push({
        code: 'GROUP_DUPLICATE_NAME',
        detail: `编号 ${no} 的组内屏名重复：${names.join(' / ')}（组内必须互不相同，否则导航分不清）`,
      })
    }
  }

  return {
    violations,
    stats: {
      links: links.length,
      screens: screens.length,
      uniqueTexts: byText.size,
      groups: [...byNo.entries()].filter(([, g]) => g.length > 1).length,
    },
  }
}

/** 脚本住在 <repo>/scripts/ 下 ⇒ 上一级就是仓库根（不依赖 git，避免判据自身故障）。 */
function resolveRepoRoot() {
  return path.resolve(__dirname, '..')
}

function main(argv) {
  const root = resolveRepoRoot()
  const target = argv[2] ? path.resolve(argv[2]) : path.join(root, REL_PRODUCT)
  if (!fs.existsSync(target)) {
    console.error('[check-design-nav] 判据自身故障：找不到仓内产物 ' + target)
    console.error('[check-design-nav] （应在仓库内运行，或用参数指定 html 路径）')
    return 2
  }
  const html = fs.readFileSync(target, 'utf8')
  const { violations, stats } = check(html)

  const rel = path.relative(root, target) || target
  console.log('[check-design-nav] 产物    :', rel.split(path.sep).join('/'))
  console.log('[check-design-nav] 链接数  :', stats.links)
  console.log('[check-design-nav] 屏数    :', stats.screens)
  console.log('[check-design-nav] 唯一文字:', stats.uniqueTexts)
  console.log('[check-design-nav] 同编号组:', stats.groups, '（同一页面的多状态屏，有意设计）')

  if (!violations.length) {
    console.log('[check-design-nav] PASS（§12 导航契约全过：无死链 / 文字唯一 / 一一覆盖 / 文字=caption / 同页同号 / 组内互异）')
    return 0
  }
  console.error('[check-design-nav] FAIL（违反 §12 导航契约）')
  for (const v of violations) console.error(`  ✗ [${v.code}] ${v.detail}`)
  return 1
}

if (require.main === module) {
  process.exit(main(process.argv))
}

module.exports = { REL_PRODUCT, check, parseScreens, parseNav, main }
