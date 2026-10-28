import { describe, it, expect, beforeEach } from 'vitest'
import { mount } from '@vue/test-utils'
import { createI18n } from 'vue-i18n'
import * as fs from 'node:fs'
import * as path from 'node:path'
import UiErrorState from './UiErrorState.vue'

/**
 * 审计 3.7：错误态三态统一的第一步 —— 共享错误态组件的行为合同。
 *
 * 为什么要它：`views/**` 里"取数失败"今天有 20 个文件、35 处各自画一块错误容器，
 * 其中只有 9 处带重试；`role="alert"` 有的写、有的不写；图标一处用 emoji（⚠️）。
 * 后果不是"不好看"：读屏用户在不写 role 的那些站点**听不到失败**，只能看到空态或 0 值
 * （审计 line 371 记的 Home 型静默失败即同一根因的极端形态）。
 *
 * 本文件锁的是"组件对外承诺的语义"，不是样式。
 */

// 读源文件一律按本仓既有测试的口径：cwd = apps/desktop。前提不成立时必须当场响亮失败，
// 不能让"读不到文件"被读成"判据通过"（fs 判据的空集恒真同型）。
const readSrc = (rel) => {
  const abs = path.resolve(process.cwd(), 'src', rel)
  if (!fs.existsSync(abs)) throw new Error('测试前提不成立：读不到 ' + abs + '（cwd=' + process.cwd() + '）')
  return fs.readFileSync(abs, 'utf8').replace(/\r\n/g, '\n')
}

const zhText = readSrc('locales/zh.js')

describe('UiErrorState 行为合同', () => {
  let i18n
  beforeEach(() => {
    i18n = createI18n({ legacy: false, locale: 'zh', messages: { zh: {} } })
  })
  const mk = (props = {}, slots = {}) => mount(UiErrorState, {
    props,
    slots,
    global: { plugins: [i18n] }
  })

  it('失败必须被播报：根节点 role="alert"，且不得再叠一个 aria-live（双重朗读比现状更差）', () => {
    const w = mk({ title: '列表加载失败' })
    const root = w.find('[data-testid="ui-error-state"]')
    expect(root.exists(), '根节点必须带稳定的 data-testid 供消费方与测试锚定').toBe(true)
    expect(root.attributes('role')).toBe('alert')
    // role="alert" 已隐含 aria-live="assertive"；再显式写一遍会让同一段文案被朗读两次
    expect(root.attributes('aria-live'), '不得叠加显式 aria-live').toBeUndefined()
  })

  it('标题必需渲染；提示缺省时不产出空段落节点', () => {
    const only = mk({ title: '取数失败' })
    expect(only.find('.ui-error-state__title').text()).toBe('取数失败')
    expect(only.find('.ui-error-state__hint').exists()).toBe(false)

    const withHint = mk({ title: '取数失败', hint: '本地服务可能未就绪' })
    expect(withHint.find('.ui-error-state__hint').text()).toBe('本地服务可能未就绪')
  })

  it('重试按钮只在给了文案时出现；必须是真 button（键盘可达由构造保证）且点击恰好发一次 retry', async () => {
    const noRetry = mk({ title: '取数失败' })
    expect(noRetry.find('button').exists(), '无 retryText 时不得凭空长出一个空按钮').toBe(false)

    const w = mk({ title: '取数失败', retryText: '重试' })
    const btn = w.find('button')
    expect(btn.exists()).toBe(true)
    expect(btn.attributes('type'), '视图里常有筛选表单，缺省 type 的按钮会被当提交键').toBe('button')
    await btn.trigger('click')
    expect(w.emitted('retry')).toHaveLength(1)
  })

  it('图标走 Element Plus 线性图标且对读屏隐藏；模板内禁止 emoji 当图标（审计 audit-44）', () => {
    const w = mk({ title: '取数失败' })
    expect(w.find('.ui-error-state__icon').attributes('aria-hidden')).toBe('true')
    expect(w.find('.ui-error-state__icon').text(), 'emoji 会被读屏逐字念出，图标容器不得有文本').toBe('')
  })

  it('动作区插槽可用，供消费方放次级出口（如"查看帮助"）', () => {
    const w = mk({ title: '取数失败' }, { actions: '<a href="#help">帮助</a>' })
    expect(w.find('.ui-error-state__actions').exists()).toBe(true)
    expect(w.find('.ui-error-state__actions').text()).toContain('帮助')
  })

  it('消费方的 data-testid 通过属性透传落在根节点（迁移时必须保留原有 testid，否则远处用例静默失锚）', () => {
    const w = mount(UiErrorState, {
      props: { title: 'x', testId: 'pi-error' },
      global: { plugins: [i18n] }
    })
    expect(w.find('[data-testid="pi-error"]').exists()).toBe(true)
    expect(w.find('[data-testid="pi-error"]').attributes('role')).toBe('alert')
  })
})

describe('UiErrorState 源文件合同', () => {
  const src = readSrc('components/UiErrorState.vue')
  const template = src.slice(src.indexOf('<template>'), src.indexOf('</template>'))
  const style = src.slice(src.indexOf('<style'))

  // 反失明前提：三个区块必须真的被读到，否则下面每一条都会对着空串"通过"
  it('测试自身前提：template 与 style 区块都被读到（空串会让所有源码判据恒真）', () => {
    expect(src).toMatch(/^<template>/)
    expect(template.length, 'template 区块为空 ⇒ 坐标错了，不是"没有违规"').toBeGreaterThan(200)
    expect(style.length, 'style 区块为空 ⇒ 坐标错了，不是"没有违规"').toBeGreaterThan(200)
  })

  it('模板内不得有中文字面量：文案一律来自 props/locale（CI Gate 7 --cjk 的同一判据，这里前置到单测）', () => {
    expect(/[\u4e00-\u9fff]/.test(template), '模板里出现了中文字面量：' + (template.match(/[\u4e00-\u9fff]+/g) || []).join(','))
      .toBe(false)
  })

  it('模板内不得有 emoji（audit-44 的退化形态：把 emoji 当图标）', () => {
    const emoji = template.match(/[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}\u{FE0F}]/gu)
    expect(emoji, '模板含 emoji 字符：' + JSON.stringify(emoji)).toBeNull()
  })

  it('焦点环必须显式声明 :focus-visible（本仓 s2v-btn 先例；只靠 transition:all 会把 outline 淡入吃掉）', () => {
    // style 区块在外层已读并做过非空前提断言
    expect(style).toMatch(/:focus-visible/)
    expect(style).toMatch(/outline\s*:/)
  })

  it('错误态配色必须用令牌，不得新增裸 hex（审计 4.2 的存量面只可缩小）', () => {
    // style 区块在外层已读并做过非空前提断言
    const hexes = style.match(/#[0-9a-fA-F]{3,8}\b/g) || []
    expect(hexes, '新增裸 hex：' + hexes.join(','))
      .toEqual([])
  })

  it('组件必须落在 locales 的 errorStates 命名空间下取值（zh/en 成对，由 zh.js 的导入接线证明）', () => {
    expect(zhText).toMatch(/from '\.\/error-states\/zh'/)
    expect(zhText).toMatch(/errorStates:\s*\{\s*\.\.\.errorStatesZh\s*\}/)
  })
})
