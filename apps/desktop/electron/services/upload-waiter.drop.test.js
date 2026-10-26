// 2026-10-23 回归锁：CDP 参数名写错会报 Invalid parameters，且错误指向下游命令，极易误判。
// 只锁结构，防止再次把 selector 简写成 useSel。
const fs = require('fs')
const path = require('path')

// 2026-10-26：CDP 拖放三方法已下沉到 upload-waiter-cdp-mixin.js（行数门禁 limit=500），
// 锁的对象不变，只跟随实现位置。
const SRC = path.join(__dirname, 'upload-waiter-cdp-mixin.js')

describe('upload-waiter CDP drop regression', () => {
  // 2026-10-26：实现被拆成 upload-waiter.js（主）+ upload-waiter-cdp-mixin.js（CDP 三方法），
// 锁的语义是「这三个性质必须存在于上传模块族里」，故两文件合并后扫描。
const SRC_MIXIN = path.join(__dirname, 'upload-waiter-cdp-mixin.js')
const src = fs.readFileSync(SRC, 'utf8') + '\n' + fs.readFileSync(SRC_MIXIN, 'utf8')

  it('DOM.querySelector 必须使用 selector 键名', () => {
    expect(src).toContain("DOM.querySelector', { nodeId: doc.root.nodeId, selector: useSel }")
    expect(src).not.toContain('nodeId: doc.root.nodeId, useSel }')
  })

  it('拖放必须使用 Input.dispatchDragEvent 且 dragData 含 files', () => {
    expect(src).toContain('Input.dispatchDragEvent')
    expect(src).toContain('files: [_abs]')
  })

  it('坐标必须有 isFinite 兜底，避免 NaN 触发 Invalid parameters', () => {
    expect(src).toContain('isFinite(rect.x)')
    expect(src).toContain('isFinite(rect.y)')
  })
})
