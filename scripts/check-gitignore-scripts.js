#!/usr/bin/env node
/**
 * check-gitignore-scripts.js —— `.gitignore` 不得把 `scripts/` 下的 .js 整体吞掉。
 *
 * 为什么需要这把锁（外部评审 i1，2026-10-27）：
 *   本仓曾有一条 `scripts/*.js` 通配，把 `scripts/` 下**所有** .js 默认忽略，再靠每个入库脚本
 *   补一条 `!scripts/<name>.js` 反选放行。它的失败形态不是报错，而是**新写的判据本体静默不入仓**：
 *   本机在盘 → `node --test` 跑得通 → `git status` 里它根本不存在 → 直到 CI 以 MODULE_NOT_FOUND
 *   红在**别人的**文件上，读起来像「判据坏了」而不是「判据没被跟踪」。实测复发 7 次
 *   （#3011 / Gate 2c3 / precommit-spawn-budget / same-type-risk-locks / 掩码覆盖 /
 *     引导按钮名 / 未接线组件）。
 *   那条通配已在 change `gitignore-scripts-root` 里删除，并把默认值翻转为「scripts/ 下 .js 默认可入库」。
 *   **但没有任何东西阻止后人把它加回来** —— 本判据就是那道闸。
 *
 * 三条断言（全部是对**假想的新脚本名**做探测，不需要真存在文件）：
 *   G1 `scripts/<新名字>.js` 不得被忽略 —— 这是旧通配的直接复发形态
 *   G2 `scripts/lib/<新名字>.js` 不得被忽略 —— 子目录同样不能被整目录规则吞掉
 *   G3 `scripts/tmp-<x>.js` **必须**被忽略 —— 定向忽略这条豁免还在（否则一次性脚本会污染 status）
 *
 * 另附一条现场清点（不做判定、只出声）：`scripts/` 下**既未跟踪又被忽略**的 .js 会逐条点名 ——
 * 它正是「文件在盘、git 里没有」的那一类，是本判据要防的现场。
 *
 * 实现口径：不解析 .gitignore 文本（那只能测"规则长什么样"，测不到"实际生效结果"），
 * 而是直接问 git —— `git check-ignore`。这跟本仓 check-ignore 之外的所有"看文本"判据不同，
 * 是刻意的：ignore 规则有先后、有 negation、有目录继承，文本匹配的近似必然出错。
 *
 * 退出码：0 = 三条断言全过；1 = 有违反；2 = 判据自身故障（不在 git 仓库内 / git 不可用）。
 */
'use strict'

const path = require('node:path')
const fs = require('node:fs')
const { execFileSync } = require('node:child_process')

/** 探测用的假想文件名（必须不可能真实存在，否则会把真实文件的状态读成规则判定）。 */
const PROBE_NEW = 'scripts/__probe_new_check_9f3a.js'
const PROBE_LIB = 'scripts/lib/__probe_new_helper_9f3a.js'
const PROBE_TMP = 'scripts/tmp-__probe_9f3a.js'

/**
 * 问 git：这个路径被忽略吗？
 * @returns {boolean}
 */
function isIgnored(repo, rel) {
  try {
    execFileSync('git', ['check-ignore', '-q', '--no-index', rel], { cwd: repo, stdio: 'pipe' })
    return true // exit 0 ⇒ 被忽略
  } catch (e) {
    if (e.status === 1) return false // exit 1 ⇒ 未被忽略
    throw new Error('git check-ignore 异常退出（status=' + e.status + '）—— 判据读不到结论，不得当成"没被忽略"')
  }
}

/** 当前仓库根；失败即判据自身故障。 */
function repoRoot() {
  try {
    return execFileSync('git', ['rev-parse', '--show-toplevel'], { encoding: 'utf8' }).trim()
  } catch {
    return null
  }
}

/**
 * G4（文本面，与上面三条**行为**探测互补）：
 *   `.gitignore` 的非注释规则行里不得出现 `scripts/` 整目录的 .js 通配，且必须存在 `tmp-*` 定向忽略。
 *
 * 为什么行为探测不够（外部评审 i3 指出）：行为探测只问「现在生效结果对不对」。
 * 如果有人加了 `scripts/*.js` 又紧跟一条能覆盖所有新名字的 negation，
 * **行为**可能仍然「对」，但规则文本已经坏了 —— 下一次有人加个别的后缀就漏。
 * 所以文本面必须单独断言一次。注释行不算（说明文字里当然会提到那条通配的历史）。
 */
function checkText(repo) {
  const violations = []
  const file = path.join(repo, '.gitignore')
  let raw
  try {
    raw = fs.readFileSync(file, 'utf8')
  } catch (e) {
    violations.push({ code: 'GITIGNORE_UNREADABLE', detail: '.gitignore 读不到：' + e.message })
    return { violations, readings: {} }
  }
  const ruleLines = raw
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter((l) => l !== '' && !l.startsWith('#'))

  // G4a：不得有 scripts 整目录 .js 通配（`scripts/*.js` 或 `scripts/**/*.js`）
  const badWild = ruleLines.filter((l) => /^scripts\/\*+(\*\/)?\*?\.js$/.test(l) || /^scripts\/\*\*\/\*\.js$/.test(l))
  if (badWild.length) {
    violations.push({
      code: 'SCRIPTS_JS_WILDCARD_PRESENT',
      detail:
        `.gitignore 的规则里仍有 scripts 整目录 .js 通配：${JSON.stringify(badWild)} —— ` +
        '即使当前行为「看起来对」（例如被别的 negation 覆盖），它也会在下一次新增脚本时重新咬人。',
    })
  }

  // G4b：必须有 tmp-* 定向忽略
  if (!ruleLines.includes('scripts/tmp-*.js')) {
    violations.push({
      code: 'TMP_ESCAPE_RULE_MISSING',
      detail: '.gitignore 缺少 `scripts/tmp-*.js` 这条定向忽略 —— 一次性脚本将无处安放。',
    })
  }

  return { violations, readings: { G4_ruleLines: ruleLines.length, G4_badWildcard: badWild.length } }
}

/**
 * 跑全部断言（G1–G3 行为面 + G4 文本面）。
 * @param {string} repo 仓库根
 * @returns {{violations:{code:string,detail:string}[], readings:object}}
 */
function check(repo) {
  const behaviour = checkBehaviour(repo)
  const text = checkText(repo)
  return {
    violations: [...behaviour.violations, ...text.violations],
    readings: { ...behaviour.readings, ...text.readings },
  }
}

/**
 * 三条**行为**断言（问 git，不看文本）。
 * @param {string} repo 仓库根
 * @returns {{violations:{code:string,detail:string}[], readings:object}}
 */
function checkBehaviour(repo) {
  const violations = []
  const readings = {}

  const g1 = isIgnored(repo, PROBE_NEW)
  const g2 = isIgnored(repo, PROBE_LIB)
  const g3 = isIgnored(repo, PROBE_TMP)
  readings.G1_newScriptIgnored = g1
  readings.G2_libScriptIgnored = g2
  readings.G3_tmpScriptIgnored = g3

  if (g1) {
    violations.push({
      code: 'SCRIPTS_JS_IGNORED',
      detail:
        `新脚本名 ${PROBE_NEW} 被 .gitignore 忽略了 —— scripts/*.js 之类的整目录规则又回来了。` +
        '这会让**每一个**新写的判据本体静默不入仓（本机在盘、git status 里没有、CI 报 Cannot find module）。' +
        '正解：删除整目录通配，只保留定向忽略（如 scripts/tmp-*.js）。见 change gitignore-scripts-root。',
    })
  }
  if (g2) {
    violations.push({
      code: 'SCRIPTS_LIB_JS_IGNORED',
      detail: `子目录里的新脚本 ${PROBE_LIB} 被忽略了 —— 忽略规则的作用域比预期大（目录继承）。`,
    })
  }
  if (!g3) {
    violations.push({
      code: 'TMP_ESCAPE_MISSING',
      detail:
        `定向忽略 ${PROBE_TMP} 没有生效 —— 一次性脚本的安放处没了。` +
        '没有这条，临时脚本会直接进 git status 甚至被误提交；' +
        '正解：保留 `scripts/tmp-*.js` 这一条。',
    })
  }

  return { violations, readings }
}

/** 现场清点：scripts/ 下既未跟踪又被忽略的 .js（只出声，不做判定）。 */
function listIgnoredUntrackedScripts(repo) {
  try {
    const out = execFileSync(
      'git',
      ['ls-files', '--others', '--ignored', '--exclude-standard', '--', 'scripts/*.js'],
      { cwd: repo, encoding: 'utf8' },
    )
    return out.split('\n').map((s) => s.trim()).filter(Boolean)
  } catch {
    return []
  }
}

function main() {
  const repo = repoRoot()
  if (!repo) {
    console.error('[check-gitignore-scripts] 判据自身故障：不在 git 仓库内（或 git 不可用）')
    return 2
  }
  let result
  try {
    result = check(repo)
  } catch (e) {
    console.error('[check-gitignore-scripts] 判据自身故障：' + (e && e.message ? e.message : e))
    return 2
  }

  const r = result.readings
  console.log('[check-gitignore-scripts] G1 新脚本被忽略     :', r.G1_newScriptIgnored, '（必须 false）')
  console.log('[check-gitignore-scripts] G2 子目录脚本被忽略 :', r.G2_libScriptIgnored, '（必须 false）')
  console.log('[check-gitignore-scripts] G3 tmp-* 被忽略     :', r.G3_tmpScriptIgnored, '（必须 true）')
  console.log('[check-gitignore-scripts] G4 规则行数 / 整目录通配:', r.G4_ruleLines, '/', r.G4_badWildcard, '（通配必须 0）')

  const onDisk = listIgnoredUntrackedScripts(repo)
  console.log('[check-gitignore-scripts] 现场清点（scripts/ 下未跟踪且被忽略的 .js）:', onDisk.length,
    onDisk.length ? '→ ' + onDisk.join(', ') : '（无）')

  if (!result.violations.length) {
    console.log('[check-gitignore-scripts] PASS（scripts/ 下的 .js 默认可入库；定向忽略 tmp-* 仍在）')
    return 0
  }
  console.error('[check-gitignore-scripts] FAIL')
  for (const v of result.violations) console.error(`  ✗ [${v.code}] ${v.detail}`)
  return 1
}

if (require.main === module) {
  process.exit(main())
}

module.exports = { check, isIgnored, listIgnoredUntrackedScripts, PROBE_NEW, PROBE_LIB, PROBE_TMP }
