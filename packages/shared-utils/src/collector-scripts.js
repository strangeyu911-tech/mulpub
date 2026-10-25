/**
 * 采集抽取脚本（页面内执行）—— 单一真源
 *
 * 为什么独立成文件（2026-10-25，PR-1 第 2 刀）：
 *   抽取脚本原先内联在 `data-sync.js` 的 5 个 `_sync_*` 方法里 ⇒ **无法被单测直接执行**
 *   ⇒ 「假 0」的两个入口（① 元素缺失 ② 值不可解析）没有任何机械锁，
 *   而验收要求「变异验证：把 fail-loud 改回 `|| '0'` ⇒ 锁必须红」——
 *   脚本不落到可 import 的模块里，这条验收根本无法构造。
 *   本文件把脚本抽出来 ⇒ 单测能用假 DOM **真跑脚本文本**，变异验证才有牙齿。
 *
 * 契约（与 `collector-contract.js` 同源，两处必须一致）：
 *   成功      → { ok: true,  data: { platform, <字段>: <非负整数>, ... } }
 *   未就绪    → { ok: false, reason: 'not-ready' }                （容器还没出现 ⇒ 继续等）
 *   字段缺失  → { ok: false, reason: 'missing', field: '<名>' }   （容器在但字段缺 ⇒ 选择器可能过期）
 *   值非法    → { ok: false, reason: 'invalid', field: '<名>' }   （元素在但数值不可解析）
 *
 * ⛔ 绝不出现 `parseInt(x || '0')` 这类兜底：把「缺失」折成 0 ⇒ 界面显示假 0。
 * ⛔ 也绝不接受「文本里有多个数」：像 "2024-01-01" 这种日期被当成 2024 粉丝 ⇒ 静默错值。
 *
 * ⚠️ 选择器的证据边界（2026-10-25 实测）：
 *   仓内 `01-docs/evidence/rpa-dom-2026-09-23/` 只有**发布页**的 DOM dump
 *   （`d5-douyin.json` 的 url 是 `creator-micro/content/post/video`），
 *   **不覆盖创作者数据面板** ⇒ 本文件的 5 组选择器目前**没有实机 DOM 证据**。
 *   ⇒ 选择器标定是独立后续步骤（需真机登录态）；在此之前采集必然落到
 *   `missing`（选择器过期）⇒ 界面显示「—」+ 原因，**绝不显示假 0**。
 */

/**
 * 页面内计数解析器（源码字符串，注入页面执行）。
 *
 * 为什么要自己解析而不用 `parseInt(text.replace(/[^0-9]/g,''))`：
 *   旧写法把 "1.2万" 解析成 **12**（真实值 12000，差 1000 倍），
 *   把 "2024-01-01" 解析成 **2024**（把日期当成粉丝数）。
 *   ⇒ 这两条都是「看起来是数字的错值」，比缺字段更难发现。
 *
 * 规则（每条都有单测，见 `__tests__/collector-scripts.test.js`）：
 *   1. 空 / 非字符串 ⇒ 解析失败（不是 0）；
 *   2. 文本里**只能有一个数**（余下部分不得再出现数字）⇒ 日期/复合文本一律失败；
 *   3. 支持中文单位：`万`/`w`/`W` = 1e4、`亿` = 1e8、`k`/`K` = 1e3；
 *   4. 结果必须是**非负整数**（含浮点误差容差：1.2 × 1e4 = 12000.000000000002）。
 */
const COUNT_PARSER_SOURCE = `
function __mpParseCount(rawText) {
  if (rawText === null || rawText === undefined) return null;
  var raw = String(rawText).replace(/\\s+/g, ' ').trim();
  if (!raw) return null;
  var m = raw.match(/(-?\\d[\\d,]*(?:\\.\\d+)?)\\s*([亿万wWkK])?/);
  if (!m) return null;
  var rest = raw.slice(0, m.index) + raw.slice(m.index + m[0].length);
  if (/[0-9]/.test(rest)) return null;
  var n = Number(String(m[1]).replace(/,/g, ''));
  if (!isFinite(n)) return null;
  var unit = m[2];
  if (unit === '万' || unit === 'w' || unit === 'W') n = n * 10000;
  else if (unit === '亿') n = n * 100000000;
  else if (unit === 'k' || unit === 'K') n = n * 1000;
  var rounded = Math.round(n);
  if (Math.abs(n - rounded) > 1e-6) return null;
  if (rounded < 0) return null;
  return rounded;
}
`

/**
 * 把一组选择器规格编译成可在页面里直接执行的表达式。
 *
 * @param {{platform: string, container?: string|null, fields: Record<string, {selector?: string, all?: string, index?: number}>}} spec
 * @returns {string} 可交给 `webContents.executeJavaScript` 的表达式
 */
function buildExtractionScript (spec) {
  const container = spec.container || null
  const rootExpr = container
    ? 'document.querySelector(' + JSON.stringify(container) + ')'
    : 'document.body'
  const lines = []
  lines.push('(function () {')
  lines.push(COUNT_PARSER_SOURCE)
  lines.push('var __mpRoot = ' + rootExpr + ';')
  lines.push('if (!__mpRoot) return { ok: false, reason: "not-ready" };')
  lines.push('var __mpData = { platform: ' + JSON.stringify(spec.platform) + ' };')
  for (const field of Object.keys(spec.fields)) {
    const def = spec.fields[field]
    const el = def.all
      ? '(__mpRoot.querySelectorAll(' + JSON.stringify(def.all) + ')[' + String(def.index || 0) + '] || null)'
      : '__mpRoot.querySelector(' + JSON.stringify(def.selector) + ')'
    lines.push('var __mpEl_' + field + ' = ' + el + ';')
    lines.push('if (!__mpEl_' + field + ') return { ok: false, reason: "missing", field: ' + JSON.stringify(field) + ' };')
    lines.push('var __mpNum_' + field + ' = __mpParseCount(__mpEl_' + field + '.textContent);')
    lines.push('if (__mpNum_' + field + ' === null) return { ok: false, reason: "invalid", field: ' + JSON.stringify(field) + ' };')
    lines.push('__mpData[' + JSON.stringify(field) + '] = __mpNum_' + field + ';')
  }
  lines.push('return { ok: true, data: __mpData };')
  lines.push('})()')
  return lines.join('\n')
}

/**
 * 五个平台的采集规格（url + 选择器）。
 *
 * ⚠️ `container` 为 null ⇒ 根节点取 `document.body` ⇒ 该平台**不会**出现 `not-ready`
 *    （容器守卫缺失是既有事实：视频号/公众号的旧脚本直接 `document.querySelector`）。
 *    后果：这两个平台在页面没渲染出目标元素时**立刻**报 `missing`（选择器可能过期），
 *    而不是慢慢等到超时 —— 这是准确的结论，不是缺陷。
 */
const COLLECTOR_SPECS = {
  douyin: {
    platform: 'douyin',
    url: 'https://creator.douyin.com/',
    container: '.creator-data-panel',
    fields: {
      views: { selector: '[data-key=total_play]' },
      followers: { selector: '[data-key=fans]' },
    },
  },
  bilibili: {
    platform: 'bilibili',
    url: 'https://member.bilibili.com/platform/home',
    container: '.num-section',
    fields: {
      views: { all: '.num-item', index: 0 },
      followers: { all: '.num-item', index: 1 },
    },
  },
  xiaohongshu: {
    platform: 'xiaohongshu',
    url: 'https://creator.xiaohongshu.com/',
    container: '.creator-data',
    fields: {
      views: { selector: '[class*=read]' },
      followers: { selector: '[class*=fans]' },
    },
  },
  tencent_video: {
    platform: 'tencent_video',
    url: 'https://channels.weixin.qq.com/',
    container: null,
    fields: {
      views: { selector: '[data-role=totalViews]' },
      followers: { selector: '[data-role=fans]' },
    },
  },
  wechat_mp: {
    platform: 'wechat_mp',
    url: 'https://mp.weixin.qq.com/',
    container: null,
    fields: {
      articles: { selector: '#articleCount' },
      views: { selector: '#totalViews' },
      followers: { selector: '#totalFans' },
    },
  },
}

/** 编译后的抽取脚本（platform → { url, script }） */
const COLLECTOR_SCRIPTS = {}
for (const platform of Object.keys(COLLECTOR_SPECS)) {
  const spec = COLLECTOR_SPECS[platform]
  COLLECTOR_SCRIPTS[platform] = { url: spec.url, script: buildExtractionScript(spec) }
}

module.exports = {
  COLLECTOR_SPECS,
  COLLECTOR_SCRIPTS,
  COUNT_PARSER_SOURCE,
  buildExtractionScript,
}
