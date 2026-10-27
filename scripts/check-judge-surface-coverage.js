#!/usr/bin/env node
'use strict'

/**
 * 「谁来守门」的清点判据（change: ci-judge-surface-coverage，2026-10-26）。
 *
 * 它回答三个此前没有任何东西在问的问题：
 *  1. 判据闭包还是不是那个闭包？解析退化会让「零违规」与「什么都没扫到」逐字同形，
 *     所以入口数 / 闭包数 / lib 数各自带**下界**（下界唯一真源在 lib/judge-closure.js）。
 *  2. 豁免清单有没有被放宽？本片起始豁免为 0 条，抬上限属人工裁决；
 *     每条必须带非空 reason；键必须仍在闭包内（陈旧登记即红 —— 「闭包外的文件不得被豁免」
 *     与「陈旧登记要销」是同一个检查的两种说法，见 design D4）。
 *  3. `HIGH_RISK_SURFACES` 里有没有**空转条目**？那些条目的 `why` 写着「实测命中 N 个」，
 *     N 是登记当天的数；文件搬家或前缀手误之后它会继续躺在那里像证据，而门禁恒绿。
 *
 * 退出码三档，**不得混档**（把「门禁瞎了」读成「有问题」是本仓反复定性的假绿）：
 *   0 = 合规   1 = 发现违规   2 = 判据自身读不到东西
 */

const fs = require('fs')
const path = require('path')
const { execFileSync } = require('child_process')

const JC = require('./lib/judge-closure.js')
// 前缀匹配**必须**复用判据自己的实现。在这里另抄一份比较，两把尺子迟早漂移：
// 清点会报"命中 3 个"而收口矩阵报"没命中"，而没有任何东西会因此变红。
const PR = require('./check-pr-exec-record.js')

const WAIVERS_REL = 'scripts/judge-surface-waivers.json'

function readTracked (repo) {
  try {
    return execFileSync('git', ['-C', repo, 'ls-files'], { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 })
      .split(/\r?\n/).filter((s) => s !== '')
  } catch (e) {
    return { fault: 'git ls-files 取不到：' + String((e && e.message) || e).split('\n')[0] }
  }
}

/**
 * @param {{repo?:string, closure?:object, tracked?:string[], waiversRaw?:string|null}} [opts]
 *   后三个字段只为测试注入；缺省时全部现读。
 * @returns {{rc:number, lines:string[], verdict:string, counts:object}}
 */
function scan (opts) {
  const o = opts || {}
  const repo = o.repo || process.cwd()
  const lines = []
  const violations = []
  const faults = []

  const closure = o.closure || JC.computeJudgeClosure(repo)
  if (closure.selfFault) faults.push('判据闭包取不到读数：' + closure.selfFault)

  const tracked = o.tracked !== undefined ? o.tracked : readTracked(repo)
  if (Array.isArray(tracked) === false) faults.push(String((tracked && tracked.fault) || 'tracked 清单形态不认识'))

  const counts = {
    entries: closure.entries || 0,
    files: (closure.files || []).length,
    lib: closure.libFiles || 0,
    dynamic: closure.dynamicRequireLike || 0,
    unresolved: (closure.unresolved || []).length,
    waived: 0,
    derivedOnly: 0,
    deadPrefix: 0,
    staleWaiver: 0,
    badWaiver: 0,
  }

  // ── 1. 规模下界（解析退化 = 覆盖面上最需要看见的失败）───────────────────
  if (!closure.selfFault) {
    if (counts.entries < JC.MIN_ENTRIES) violations.push(`判据入口数 ${counts.entries} < 下界 ${JC.MIN_ENTRIES} ⇒ 入口识别漂了（不是"这个仓判据少了"）`)
    if (counts.files < JC.MIN_FILES) violations.push(`闭包文件数 ${counts.files} < 下界 ${JC.MIN_FILES} ⇒ 相对 require 解析漂了`)
    if (counts.lib < JC.MIN_LIB_FILES) violations.push(`scripts/lib 可达数 ${counts.lib} < 下界 ${JC.MIN_LIB_FILES} ⇒ 跨目录跟进漂了`)
    if (counts.files > 0 && counts.entries === 0) violations.push('闭包非空但入口数为 0 ⇒ 两个读数互相打脸，必有一侧是假的')
  }

  // ── 2. 豁免清单 ────────────────────────────────────────────────────────
  // 注入语义：`undefined` = 没注入 ⇒ 现读磁盘；`null` = 显式注入"文件缺席"（安全方向，零豁免）。
  let waiversRaw = o.waiversRaw
  if (waiversRaw === undefined) {
    const p = path.join(repo, WAIVERS_REL)
    waiversRaw = fs.existsSync(p) ? fs.readFileSync(p, 'utf8') : null
  }
  let waivers = {}
  if (waiversRaw !== null) {
    try {
      waivers = JSON.parse(waiversRaw)
    } catch (e) {
      violations.push(`${WAIVERS_REL} 读不动：${String((e && e.message) || e).split('\n')[0]} —— 这是**违规**不是"没有豁免"`)
      waivers = {}
    }
    const v = JC.validateWaivers(waivers)
    if (!v.ok) {
      for (const b of v.bad) violations.push(`豁免 ${b.key} 的理由不成立：${b.why}`)
      counts.badWaiver = v.bad.length
    }
  }
  const waiverKeys = Object.keys(waivers || {})
  counts.waived = waiverKeys.length
  if (counts.waived > JC.MAX_WAIVERS) {
    violations.push(`豁免条数 ${counts.waived} > 上限 ${JC.MAX_WAIVERS} —— 抬上限是在**放宽「谁来守门」**，属人工裁决，不是顺手加一行`)
  }
  // 「键必须仍在闭包内」与「闭包外文件不得被豁免」是同一条检查的两种说法（design D4）。
  const memberSet = new Set(closure.files || [])
  for (const k of waiverKeys) {
    if (!memberSet.has(k)) {
      violations.push(`豁免 ${k} 指向的东西不在判据闭包里 —— 要么它已被移走（陈旧登记，必须同次销账），`
        + '要么它在给一个**不存在于守门面**的文件发免检牌')
      counts.staleWaiver += 1
    }
  }

  // ── 3. 空转条目锁（命中 0 的前缀守的是一个不存在的面）───────────────────
  const prefixCovered = new Set()
  if (Array.isArray(tracked)) {
    for (const s of PR.HIGH_RISK_SURFACES) {
      // 走判据自己的匹配实现（含 exts 限定）。裸子串在这里会把 `fingerprint` 那条的覆盖面谎报。
      const hits = tracked.filter((f) => PR.highRiskPrefixOf(f) === s.prefix)
      if (hits.length === 0) {
        violations.push(`高危面条目 ${s.prefix} 在当前实现下命中 0 个受管文件 ⇒ 装饰性条目（它的 why 里那句「实测命中 N」已经过期）`)
        counts.deadPrefix += 1
      } else {
        hits.forEach((f) => prefixCovered.add(f))
      }
      lines.push(`  条目 ${s.prefix} 命中=${hits.length}` + (hits.length > 0 ? ` 例=${hits.slice(0, 2).join(',')}` : ''))
    }
    counts.derivedOnly = (closure.files || []).filter((f) => PR.highRiskPrefixOf(f) === null).length
  } else {
    counts.derivedOnly = -1
  }

  // ── 4. 判据自身故障（与"发现违规"分档）─────────────────────────────────
  if (closure.unresolved && closure.unresolved.length > 0) {
    violations.push(`有 ${closure.unresolved.length} 条相对 require 解析不到：${closure.unresolved.slice(0, 6).join(' / ')}`
      + ' —— 注释里的示例写法已被剥掉，所以这一格现在**只**会是真漏（每条都要人看）')
  }

  const rc = faults.length > 0 ? 2 : (violations.length > 0 ? 1 : 0)
  const verdict = faults.length > 0 ? 'SELF-FAULT' : (violations.length > 0 ? 'VIOLATIONS' : 'PASS')
  const head = `JUDGE-SURFACE-SCAN entries=${counts.entries} files=${counts.files} lib=${counts.lib} `
    + `dynamic=${counts.dynamic} unresolved=${counts.unresolved} waived=${counts.waived} `
    + `derived-only=${counts.derivedOnly} dead-prefix=${counts.deadPrefix} bad-waiver=${counts.badWaiver} stale-waiver=${counts.staleWaiver} `
    + `exempt-ceiling=${JC.MAX_WAIVERS} verdict=${verdict}`
  const out = [head]
  if (faults.length > 0) out.push(...faults.map((f) => '  故障：' + f))
  if (violations.length > 0) out.push(...violations.map((v) => '  违规：' + v))
  if (o.report === true && Array.isArray(tracked)) {
    const only = (closure.files || []).filter((f) => PR.highRiskPrefixOf(f) === null)
    out.push(`  派生面独有（不在任何前缀上）= ${only.length}`)
    out.push(...only.map((f) => '    - ' + f))
  }
  return { rc, lines: out, verdict, counts, violations, faults }
}

function parseArgs (argv) {
  const out = { repo: process.cwd(), report: false }
  for (const a of argv) {
    if (a.startsWith('--repo=')) out.repo = a.slice(7)
    else if (a === '--report') out.report = true
    else if (a === '--json') out.json = true
    else throw new Error('未知旗标：' + a + '（可用：--repo=<dir> --report --json）')
  }
  return out
}

function main () {
  let args
  try { args = parseArgs(process.argv.slice(2)) } catch (e) {
    process.stderr.write(String((e && e.message) || e) + String.fromCharCode(10))
    return 2
  }
  const r = scan(args)
  process.stdout.write(r.lines.join(String.fromCharCode(10)) + String.fromCharCode(10))
  return r.rc
}

if (require.main === module) process.exitCode = main()

module.exports = { scan, parseArgs, WAIVERS_REL }
