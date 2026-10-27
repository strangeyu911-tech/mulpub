'use strict'

// 阶段 5.3「未接线组件门禁」的判据锁。node:test，接在 quality-gate.yml 的 Gate 2b（shell: bash）。
// 关键纪律（都是本仓踩过的）：
//   * 夹具必须让「已接线」与「未接线」**返回不同结果** —— 对所有输入返回同一份数据的夹具，
//     会让「按名字区分」这一整类缺陷对它结构性免疫。
//   * 「0 命中」必须先证明扫描域非空，否则是探针失明不是通过。
//   * 禁令类判据要配「合规形态必须绿」的对偶，否则它只是把删除当成通过。

const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')

const { componentCandidates, kebab, isWired, judge, isSource, assertDomainHealthy } = require('./check-unwired-components')

const consumers = () => new Map([
  ['apps/desktop/src/App.vue', '<template>\n  <UiButton label="ok" />\n</template>'],
  ['apps/desktop/src/main.js', "app.component('GlobalSpinner', GlobalSpinner)\nimport AnnouncementBanner from '@/components/AnnouncementBanner.vue'\n"],
  ['apps/desktop/src/views/Home.vue', '<!-- 只是注释里提到 CardGrid，不算引用 -->\n<template><div/></template>'],
  ['apps/desktop/src/plugins/ui-kit.js', "export default { install(app){ app.component('CardGrid', CardGrid) } }"],
])

test('componentCandidates 只收 components 下的 .vue，且排除测试/契约文件', () => {
  const domain = new Set([
    'apps/desktop/src/components/UiButton.vue',
    'apps/desktop/src/components/UiButton.test.js',
    'apps/desktop/src/components/nested/Deep.vue',
    'apps/desktop/src/views/Home.vue',
    'apps/desktop/src/components/styles.css',
  ])
  assert.deepEqual(componentCandidates(domain), [
    'apps/desktop/src/components/UiButton.vue',
    'apps/desktop/src/components/nested/Deep.vue',
  ])
})

test('components 域为空 ⇒ 候选为空数组（阻断由 main() 的空域守卫负责，见下一条）', () => {
  assert.deepEqual(componentCandidates(new Set(['README.md'])), [])
})

test('assertDomainHealthy：「域塌了」必须与「没有欠账」可区分，且健康规模必须放行', () => {
  // 行为锁而不是"源码里出现了这句话"的结构锁：本仓反复出现"守卫还在文案里、条件已被改成恒假"
  // 的装饰性门禁（M3 那刀就是把条件改成恒假，只有行为锁会红）。
  assert.throws(() => assertDomainHealthy(12670, 0, 1257), /components 域为空/, 'candidates=0 必须抛')
  assert.throws(() => assertDomainHealthy(12670, 87, 99), /拒绝出结论/, '消费者域过小必须抛')
  assert.throws(() => assertDomainHealthy(3, 1, 1), /拒绝出结论/, '小仓库同样不得出结论')
  assert.doesNotThrow(() => assertDomainHealthy(12670, 87, 1257), '合规形态必须绿（否则棘轮会把自己的修复路径焊死）')
})

test('判据在真仓上必须给读数（rc=0 且首行有 domain/components/consumers）', () => {
  const { execFileSync } = require('node:child_process')
  const out = execFileSync(process.execPath, [path.join(__dirname, 'check-unwired-components.js')], {
    cwd: path.resolve(__dirname, '..'), encoding: 'utf8',
  })
  assert.match(out, /\[UNWIRED-COMPONENTS\] domain=\d+ components=\d+ consumers=\d+/, '读数行缺失')
})

test('isWired 四种形态都认，且注释里出现不算 —— 但对"是否已接线"取宽松侧', () => {
  const c = consumers()
  assert.equal(isWired('UiButton', c, 'apps/desktop/src/components/UiButton.vue'), true, '<UiButton 标签形态')
  assert.equal(isWired('AnnouncementBanner', c, 'apps/desktop/src/components/AnnouncementBanner.vue'), true, "import … from '…/AnnouncementBanner.vue' 形态")
  assert.equal(isWired('GlobalSpinner', c, 'apps/desktop/src/components/GlobalSpinner.vue'), true, "app.component('GlobalSpinner') 注册形态")
  assert.equal(isWired('CardGrid', c, 'apps/desktop/src/components/CardGrid.vue'), true, 'kebab 或注册字符串形态')
  assert.equal(isWired('NeverUsed', c, 'apps/desktop/src/components/NeverUsed.vue'), false, '谁都没提到 ⇒ 未接线')
})

test('自我引用不得算成已接线（否则组件自己 import 自己就永远绿）', () => {
  const selfOnly = new Map([['apps/desktop/src/components/OnlySelf.vue', "import self from './OnlySelf.vue'"]])
  assert.equal(isWired('OnlySelf', selfOnly, 'apps/desktop/src/components/OnlySelf.vue'), false)
})

test('kebab 形态按大小写边界切，且对已有连字符的名字稳定', () => {
  assert.equal(kebab('UiButton'), 'ui-button')
  assert.equal(kebab('AIBadge'), 'aibadge') // 连续大写不切（本仓无此命名，行为如实记录）
  assert.equal(kebab('PipelineBrowser'), 'pipeline-browser')
})

test('judge 把未接线拆成「已登记」与「未登记」，并把陈旧登记单独点名', () => {
  const candidates = ['apps/desktop/src/components/NeverUsed.vue', 'apps/desktop/src/components/StaggeredList.vue']
  const base = { entries: [{ path: 'apps/desktop/src/components/StaggeredList.vue', reason: '审计 1.1 存量：待裁决接线或删除' }] }
  const r = judge(candidates, consumers(), base)
  assert.deepEqual(r.unwired, candidates)
  assert.deepEqual(r.unregistered, ['apps/desktop/src/components/NeverUsed.vue'], '已登记的不得再报未登记')
  assert.deepEqual(r.stale, [], '登记项确实未接线时不该报陈旧')
  assert.equal(r.blocking, true, '存在未登记项即阻断')

  const wiredNow = judge(
    ['apps/desktop/src/components/StaggeredList.vue'],
    new Map([['apps/desktop/src/views/Home.vue', '<template>\n    <StaggeredList :items="rows" />\n  </template>']]),
    base,
  )
  assert.deepEqual(wiredNow.stale, ['apps/desktop/src/components/StaggeredList.vue'], '接线了却不销账 ⇒ 陈旧登记')
  assert.deepEqual(wiredNow.unwired, [], '夹具必须真的把该组件接上，否则 stale 判据测的是探针不是行为')
  assert.equal(wiredNow.blocking, true, '陈旧登记同样阻断（销账与改动必须同一次发生）')

  const clean = judge([], consumers(), base)
  assert.equal(clean.unwired.length, 0)
})

test('基线形状：条目必须带非空 reason（空手登记不算放行）', () => {
  const file = path.join(__dirname, 'unwired-components-baseline.json')
  const json = JSON.parse(fs.readFileSync(file, 'utf8'))
  assert.ok(Array.isArray(json.entries), 'entries 必须是数组')
  for (const e of json.entries) {
    assert.equal(typeof e.path, 'string', '每条必须有 path')
    assert.ok(typeof e.reason === 'string' && e.reason.trim().length > 8, '每条必须有实质 reason: ' + e.path)
  }
  assert.ok(json.entries.length <= 12, '基线规模上界（只能缩小；新增必须同次说明为什么不能直接接线）')
})

test('接线锁：本判据、它的测试与反证驱动都必须被 workflow 真跑（写进注释不算接线）', () => {
  const wf = fs.readFileSync(path.join(__dirname, '..', '.github', 'workflows', 'quality-gate.yml'), 'utf8')
  assert.match(wf, /node scripts\/check-unwired-components\.js/, '判据本体必须在 workflow 里被真跑')
  assert.match(wf, /node --test[^\n]*check-unwired-components\.test\.js/, '它的测试也必须被真跑')
  assert.match(wf, /node scripts\/unwired-components-mutate\.js/, '反证驱动也必须被真跑 —— 只手动跑的反证会随下一次改判据过期')
  // 三条都必须落在**同一个步骤**里：分散到两个步骤时，删掉其中一步就只剩"部分接线"，
  // 而逐条 substring 判据对此完全免疫（本仓「锚点必须指向可执行语句」的同型）。
  // 步骤块按"到下一个 - name: 之前"切，**不用 \n\n 当终止符** —— 本仓 workflow 工作副本存在
  // w/crlf，`/\n\n/` 对 \r\n\r\n 点不中，会把"块存在"演成"块消失"（本轮实测踩过一次）。
  const at = wf.indexOf('Gate 2b15 - Unwired components gate')
  assert.ok(at >= 0, '找不到 Gate 2b15 步骤名 ⇒ 该判据已从 CI 消失')
  const nextStep = wf.indexOf('- name:', at + 10)
  const block = wf.slice(at, nextStep === -1 ? wf.length : nextStep)
  for (const re of [/check-unwired-components\.js/, /check-unwired-components\.test\.js/, /unwired-components-mutate\.js/]) {
    assert.match(block, re, 'Gate 2b15 步骤块内缺少 ' + re)
  }
  assert.doesNotMatch(block, /^[^\n]*\bnode\b[^\n]*\|\s*(tail|head)\b/m, '步骤块内不得用 tail/head 吃 rc')
})

test('.gitignore 反锁：判据本体与反证驱动都必须能进 git（不被静默忽略）', () => {
  // 漏收的症状不是本地红，而是 CI 上 `Cannot find module` —— 本地文件在磁盘上存在，
  // 只是没进 git，checkout 出来的树上没有它（本仓同族实测：#3011 / #3724 / #3876）。
  //
  // ⚠ 2026-10-27（change: gitignore-scripts-root）：原件断言「.gitignore 里必须有
  // `!scripts/check-unwired-components.js` 与 `!scripts/unwired-components-mutate.js` 两条反选」。
  // 那条 `scripts/*.js` 通配已被根治删除（它让每个新判据本体默认不入仓，实测复发 7 次），
  // negation 机制不复存在 ⇒ 改断言**行为**：git check-ignore 必须说这两个文件不被忽略。
  const { execFileSync } = require('node:child_process')
  const root = path.join(__dirname, '..')
  for (const rel of ['scripts/check-unwired-components.js', 'scripts/unwired-components-mutate.js']) {
    let hit = ''
    try {
      hit = execFileSync('git', ['-C', root, 'check-ignore', '--no-index', '--', rel], { encoding: 'utf8' })
    } catch (e) {
      hit = String(e.stdout || '') // exit 1 = 不被忽略，正是期望
    }
    assert.equal(hit.trim(), '',
      rel + ' 被 .gitignore 忽略了 ⇒ 本地全绿、CI 上 Cannot find module（取证：git check-ignore -v ' + rel + '）')
  }
})

test('消费者域规模下界：本仓实测 components=87 上下、consumers≈1200+，退化即红', () => {
  // 这条锁的是"判据跑在真仓上仍然看得见东西"，不是锁某个具体读数（数字会随仓库增长变化）。
  const { execFileSync } = require('node:child_process')
  const out = execFileSync(process.execPath, [path.join(__dirname, 'check-unwired-components.js')], {
    cwd: path.resolve(__dirname, '..'), encoding: 'utf8',
  })
  const m = /\[UNWIRED-COMPONENTS\] domain=(\d+) components=(\d+) consumers=(\d+)/.exec(out)
  assert.ok(m, '读数行缺失：' + out.slice(0, 200))
  assert.ok(Number(m[1]) > 5000, 'domain 退化：' + m[1])
  assert.ok(Number(m[2]) > 50, 'components 退化：' + m[2])
  assert.ok(Number(m[3]) > 800, 'consumers 退化：' + m[3])
})

test('isSource 排除测试与快照，且不排除 .vue/.js 源文件', () => {
  assert.equal(isSource('apps/desktop/src/views/Home.vue'), true)
  assert.equal(isSource('apps/desktop/src/views/Home.test.js'), false)
  assert.equal(isSource('apps/desktop/src/__tests__/x.js'), false)
  assert.equal(isSource('apps/desktop/tests/visual-testing/views/all-views.visual.test.js'), false)
})
