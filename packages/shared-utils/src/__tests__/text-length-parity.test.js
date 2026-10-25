import { describe, it, expect } from 'vitest'
import cjs from '../text-length'
import esm, { codePointLength as esmLen, truncate as esmTruncate, truncateWithin as esmWithin } from '../text-length.browser'

// CJS ↔ ESM 孪生的行为对账（先例：article-body-format-parity / safe-http-url parity）。
// 判据形态是**行为向量表**而不是"两份源码字符串比较"：字符串比较会把"注释不同"判成漂移、
// 又把"逻辑同形但常量抄错"放过；行为向量同时打两遍并逐条要求相等，才是"同一份合同"的证据。
// 另记一条接缝事实：apps/desktop 的单测域**不含**这条 alias，所以渲染端测试里解析到的是 CJS，
// 只有生产构建解析到 ESM 孪生 —— 因此这份 parity 锁是两侧唯一的交集，删掉它就没人比较两份实现。
const VECTORS = [
  [''],
  ['abc'],
  ['🎉'],
  ['🇯🇵🇨🇳 两面旗'],
  ['a'.repeat(19) + '🎉尾巴'],
  ['抖音好物分享 🎉🎉🎉 爆款来了'],
  ['éx'],
  [null],
  [undefined],
  [12345],
]

const TRUNC_CASES = [
  [20, '...'], [3, '…'], [0, ''], [90, '...'], [1, '…'], [NaN, '…'], [-3, '…'], [2.9, ''],
]

describe('text-length CJS/ESM 孪生行为等价', () => {
  it('计数逐向量相等', () => {
    for (const [v] of VECTORS) {
      expect(esmLen(v), 'vector ' + JSON.stringify(v)).toBe(cjs.codePointLength(v))
    }
  })

  it('截断逐向量 × 逐档位相等（含省略号形态）', () => {
    for (const [v] of VECTORS) {
      for (const [max, ell] of TRUNC_CASES) {
        expect(esmTruncate(v, max, ell), `truncate ${JSON.stringify(v)} ${max} ${JSON.stringify(ell)}`)
          .toBe(cjs.truncate(v, max, ell))
        expect(esmWithin(v, max, ell), `within ${JSON.stringify(v)} ${max} ${JSON.stringify(ell)}`)
          .toBe(cjs.truncateWithin(v, max, ell))
      }
    }
  })

  it('默认省略号两侧同值（漏传第三参时的行为也必须一致）', () => {
    const long = 'x'.repeat(10)
    expect(esmTruncate(long, 3)).toBe(cjs.truncate(long, 3))
    expect(esmWithin(long, 3)).toBe(cjs.truncateWithin(long, 3))
  })

  it('两份实现都必须真的被加载（导出面非空 ⇒ 解析退化时当场红，而不是恒等空集）', () => {
    expect(Object.keys(cjs).length).toBeGreaterThanOrEqual(5)
    expect(typeof esm).toBe('object')
    expect(Object.keys(esm).sort()).toEqual(Object.keys(cjs).sort())
  })
})
