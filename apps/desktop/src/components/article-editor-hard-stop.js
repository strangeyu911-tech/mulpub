/**
 * 富文本正文的输入硬拦（审计 4.7 ③）
 *
 * 口径**必须与发布校验同源**，这是本文件存在的全部理由：
 * `publish-contract.js` 的 `validatePlatformContent()` 用的是 `Array.from(String(content)).length`，
 * 而富文本模式下 `content` 就是 Quill 回写的 **HTML 字符串**（`content-type="html"`）；
 * `truncateByChars()` 同样按原始字符串码点裁。所以编辑器里任何"按纯文本长度"的拦截都
 * **拦不到真正让发布失败的那条线**——标签自身就在预算里，用户按纯文本没超、发布仍被拒。
 * 我最初写的正是这种"看着像修好"的纯文本口径，核过校验实现后整体作废（原因写进执行记录）。
 *
 * 三条不可破：
 * 1. **同口径**：按原始字符串 Unicode 码点计数（与 `validatePlatformContent` 逐字同一表达式），
 *    禁止另写第二份阈值或换成纯文本口径。
 * 2. **不得切坏 HTML**：切点不能落在标签内部（`<p cl|ass=`）或实体内部（`&am|p;`）；
 *    切完后**必须补齐未闭合标签**，产出的仍是合法结构。
 * 3. **禁止切形态**：不得因为超限把正文退回纯文本 / Markdown（2026-10-15 百家号"正文塌成
 *    一段"是同族错法）。这里只删尾部内容，块结构原样保留。
 */

/** 与 validatePlatformContent 同一计数表达式（码点，不是 UTF-16 单元） */
export function contentCodePointLength(content) {
  return Array.from(String(content ?? '')).length
}

/**
 * 切点是否落在结构安全处：
 * - 不在标签内（已开的 `<` 尚未被 `>` 闭合 ⇒ 不安全）
 * - 不在实体内（尾部有 `&…`  yet 没有 `;` ⇒ 会把 `&amp;` 劈成 `&am`，渲染出乱码）
 */
function isSafeCut(text) {
  if ((text.match(/</g) || []).length > (text.match(/>/g) || []).length) return false
  if (/&[#\w-]*$/.test(text) && !/&[#\w-]+;/.test(text.slice(-8) + ';')) {
    const tail = text.slice(-12)
    const lastAmp = tail.lastIndexOf('&')
    if (lastAmp >= 0 && !tail.slice(lastAmp).includes(';')) return false
  }
  return true
}

/** 补齐未闭合标签：按出现顺序入栈，倒序补闭合；void 元素不入栈 */
function closeUnbalanced(text) {
  const VOID = new Set(['br', 'img', 'hr', 'input', 'meta', 'link'])
  const stack = []
  for (const m of text.matchAll(/<(\/?)([a-zA-Z][\w-]*)([^>]*)>/g)) {
    const closing = m[1] === '/'
    const name = m[2].toLowerCase()
    const selfClosing = /\/\s*$/.test(m[3])
    if (VOID.has(name) || selfClosing) continue
    if (closing) {
      const at = stack.lastIndexOf(name)
      if (at >= 0) stack.splice(at)
    } else stack.push(name)
  }
  let out = text
  const seen = new Set()
  while (stack.length) {
    const name = stack.pop()
    if (seen.has(name)) continue   // 同名嵌套已被前面的闭包处理，避免重复补
    seen.add(name)
    out += `</${name}>`
  }
  return out
}

/**
 * 把正文（HTML 或纯文本都适用）裁到 maxChars 个码点以内：
 * 只删尾部，逐步回退到**最近的安全切点**，并补齐闭合标签。
 * 已在限内时原样返回（不做无谓重写）。
 */
export function truncateContentToLimit(content, maxChars) {
  const src = String(content ?? '')
  const chars = Array.from(src)
  const limit = Number.isFinite(maxChars) && maxChars > 0 ? Math.floor(maxChars) : 0
  if (chars.length <= limit) return src
  let cut = Math.min(limit, chars.length)
  while (cut > 0) {
    const candidate = chars.slice(0, cut).join('')
    if (!isSafeCut(candidate)) { cut -= 1; continue }
    const closed = closeUnbalanced(candidate)
    // 补齐闭合标签本身也占预算：不把它算进去，裁完仍会超限（实测 100004 > 100000）。
    // 判据必须作用在**最终产物**上，而不是作用在切片上。
    if (contentCodePointLength(closed) <= limit) return closed
    cut -= 1
  }
  return ''
}
