// @vitest-environment node
// @ts-check
/**
 * explainer-render-runtime-intent.test.js —— 渲染引擎意图判定（G1 门的显式选择 vs P5a 的 Remotion 优先）
 *
 * ## 覆盖什么
 *
 * ① **用户显式选了 ffmpeg** ⇒ 意图 = 'ffmpeg'（compose **不试** Remotion ⇒ G1 门的选择真正生效）。
 * ② **用户显式选了 remotion / 没选 / 门没走** ⇒ 意图 = 'remotion'（**P5a 的既有行为不变** ⇒ 零回归）。
 * ③ ⭐ **LLM 自己给的 'ffmpeg'（`render_runtime_source !== 'user_confirmed'`）⇒ 意图 = 'remotion'**
 *    —— 这条是**零回归的关键**：归一化会把缺省/LLM 给的 runtime 补成 'remotion'，
 *    若不看 source，就会把「LLM 恰好选了 ffmpeg」也当成「用户选了 ffmpeg」
 *    ⇒ 静默改掉 P5a「Remotion 优先」的既有行为。
 * ④ 畸形输入（null / 非对象 / 缺字段 / 带空白）⇒ 意图 = 'remotion'（**fail-safe 到既有行为**）。
 */

import { describe, it, expect } from 'vitest'
import { createRequire } from 'node:module'
import { fileURLToPath } from 'node:url'
import path from 'node:path'

const require = createRequire(import.meta.url)
// ⚠ ESM 下 `__dirname` 未定义 ⇒ 必须自己造（否则接线锁那一条会炸在读文件那一步）
const __dirname = path.dirname(fileURLToPath(import.meta.url))
const { resolveRenderRuntimeIntent } = require('./explainer-render-runtime-intent')

/** 造一个 proposal artifact */
function proposal (runtime, source) {
  const p = { production_plan: {}, metadata: {} }
  if (runtime !== undefined) p.production_plan.render_runtime = runtime
  if (source !== undefined) p.metadata.render_runtime_source = source
  return p
}

describe('resolveRenderRuntimeIntent —— 渲染引擎意图判定', () => {
  it('用户显式确认了 ffmpeg ⇒ 意图是 ffmpeg（G1 门的选择真正生效）', () => {
    expect(resolveRenderRuntimeIntent(proposal('ffmpeg', 'user_confirmed'))).toBe('ffmpeg')
  })

  it('用户显式确认了 remotion ⇒ 意图是 remotion（P5a 既有行为）', () => {
    expect(resolveRenderRuntimeIntent(proposal('remotion', 'user_confirmed'))).toBe('remotion')
  })

  it('⭐ LLM 自己给的 ffmpeg（source 不是 user_confirmed）⇒ 仍是 remotion（不得静默改掉 P5a 行为）', () => {
    expect(resolveRenderRuntimeIntent(proposal('ffmpeg', 'llm'))).toBe('remotion')
    expect(resolveRenderRuntimeIntent(proposal('ffmpeg', 'default'))).toBe('remotion')
    expect(resolveRenderRuntimeIntent(proposal('ffmpeg'))).toBe('remotion')
  })

  it('缺省 runtime（归一化补成的 remotion）⇒ 意图是 remotion', () => {
    expect(resolveRenderRuntimeIntent(proposal('remotion', 'default'))).toBe('remotion')
    expect(resolveRenderRuntimeIntent(proposal(undefined, undefined))).toBe('remotion')
  })

  it('畸形输入 ⇒ fail-safe 到 remotion（既有行为），不得抛错', () => {
    for (const bad of [null, undefined, 0, '', 'x', [], true]) {
      expect(resolveRenderRuntimeIntent(bad), String(bad)).toBe('remotion')
    }
    expect(resolveRenderRuntimeIntent({ production_plan: null, metadata: null })).toBe('remotion')
    expect(resolveRenderRuntimeIntent({ production_plan: 'x', metadata: 'x' })).toBe('remotion')
  })

  it('source 必须**逐字**是 user_confirmed（大小写/空白/前缀都算不成立）', () => {
    expect(resolveRenderRuntimeIntent(proposal('ffmpeg', ' user_confirmed '))).toBe('remotion')
    expect(resolveRenderRuntimeIntent(proposal('ffmpeg', 'USER_CONFIRMED'))).toBe('remotion')
    expect(resolveRenderRuntimeIntent(proposal('ffmpeg', 'user_confirmed_v2'))).toBe('remotion')
  })

  it('runtime 也必须**逐字**是枚举成员（带空白 ⇒ 不是枚举值 ⇒ 不成立）', () => {
    // ⚠ 规范化是**写入层**的责任；消费端宽容（trim）等于给判据开后门
    expect(resolveRenderRuntimeIntent(proposal(' ffmpeg ', 'user_confirmed'))).toBe('remotion')
    expect(resolveRenderRuntimeIntent(proposal('FFMPEG', 'user_confirmed'))).toBe('remotion')
    expect(resolveRenderRuntimeIntent(proposal('ffmpeg\n', 'user_confirmed'))).toBe('remotion')
  })

  it('⭐ 接线锁：compose 执行器必须**真的调用**这个判据（否则叶子模块全绿但功能没接线）', async () => {
    const fs = require('node:fs')
    const path = require('node:path')
    const src = fs.readFileSync(path.join(__dirname, 'explainer-review-stages.js'), 'utf8')
    // ⚠ **只扫代码行**（剥掉注释）⇒ 否则「注释里提到这个函数名」也能满足断言（弱锁）
    const codeLines = src.split('\n').filter(line => {
      const t = line.trim()
      return t && !t.startsWith('//') && !t.startsWith('*') && !t.startsWith('/*')
    }).join('\n')
    // ① 真的 require 了
    expect(codeLines).toMatch(/require\(['"]\.\/explainer-render-runtime-intent['"]\)/)
    // ② 真的调用了（调用点形态，不是字符串提及）
    expect(codeLines).toMatch(/resolveRenderRuntimeIntent\s*\(/)
    // ③ ⭐ 判据必须**恰好一份且形态精确**（`userPickedFfmpeg = renderIntent === 'ffmpeg'`）：
    //   · 形态精确 ⇒ 改名后的第二份判据会覆盖它 ⇒ 锁红
    //   · 恰好一份 ⇒ 重复声明（曾真实发生过的语法错误）当场红
    const decls = codeLines.match(/const\s+userPickedFfmpeg\s*=[^\n]*/g) || []
    expect(decls.length).toBe(1)
    expect(decls[0]).toMatch(/=\s*renderIntent\s*===\s*'ffmpeg'\s*$/)
    // ④ ⭐ `render_runtime_requested` 必须**取自渲染意图**（不得硬编码）：
    //   该字面组合不会出现在注释里 ⇒ 这条不是弱锁；硬编码 'remotion' 会让
    //   「用户显式选 ffmpeg」在产物里被记成 'remotion' ⇒ 消费者无法区分「显式选择」与「回落」。
    expect(codeLines).toMatch(/render_runtime_requested:\s*renderIntent\b/)
  })
})
