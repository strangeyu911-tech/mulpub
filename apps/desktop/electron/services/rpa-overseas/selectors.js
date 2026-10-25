// @ts-check
'use strict'
/**
 * rpa-overseas/selectors.js — 海外专属发布链的**增量**选择器
 *
 * ## 为什么是「增量」而不是完整表
 *
 * `packages/rpa-engine/src/platform-selectors.js` 是**全仓选择器的单一真源**，
 * 其中**已经**有 youtube / tiktok / twitter / instagram / facebook 的通用字段
 * （file_input / title_input / desc_textarea / publish_btn …）。
 * ⇒ 本文件只放**那张表里没有的、平台特定步骤的键**，
 *   由 `getOverseasSelectors()` 与真源表**合并**后使用。
 *   这样既不重复造轮子（两份 file_input 必然漂移），
 *   也不用去改真源表（在飞 PR #4168 正在改它 ⇒ 必然产生合并冲突面）。
 *
 * ## 本仓既有惯例（本次实测确认，作为设计依据）
 *
 * 真源表覆盖 17 个平台，而有专属 `_publish_*` 实现的只有 6 个
 * （douyin / kuaishou / wechat_mp / xiaohongshu / zhihu）⇒
 * **「选择器先备着、专属实现按平台渐进落地」是本仓既有惯例**，
 * 本文件沿用它，不自造新规矩。
 *
 * ## 来源标注（重要：不要把「参考实现」当成「本仓真机取证」）
 *
 * - `[真机]` = Mulpub 本仓真机日志/取证确认过；
 * - `[参考]` = 来自开源实现（见 `01-docs/海外平台*调研*.md`），**未在本仓真机验证**；
 * - `[推测]` = 依据平台公开 DOM 结构推断，**最弱**。
 *
 * ⚠️ 未标注真机取证的选择器在真机上很可能命中失败 —— 但这类失败是**可诊断的**
 * （选择器找不到 ⇒ 明确报错），不是静默假成功。
 * 「成功」必须由 `rpa-overseas/shared.js` 的回读核验给出，不靠选择器命中与否。
 */

/** @typedef {Record<string, string[]>} SelectorSet */

// 真源表（packages/rpa-engine）零 require ⇒ 与本文件之间**无循环依赖**，
// 顶层 require 即可（顶层能更早暴露「真源表改名/搬家」这类问题）。
const { PLATFORM_PUBLISH_SELECTORS } = require('@multi-publish/rpa-engine/src/platform-selectors')

/**
 * 海外专属链的**增量**选择器（与真源表合并后使用）。
 * @type {Record<string, SelectorSet>}
 */
const OVERSEAS_STEP_SELECTORS = {
  // ============================================================
  // YouTube —— 专属链是「多步向导」，比通用链多出这几个步骤
  // 来源：dreammis/social-auto-upload uploader/youtube_uploader/main.py（[参考]）
  //        + fawazahmed0/youtube-uploader src/upload.ts（[参考]，选择器最全）
  // ============================================================
  youtube: {
    // 标题/简介在 Studio 里是 **contenteditable**（div#textbox），不是 input/textarea。
    // 真源表的 youtube.title_input 是 ['#title-textarea', '[class*="title"] input', '#title-text']
    // —— 命中的是外层容器，填进去不会进编辑器 ⇒ 这里用更精确的版本**覆盖**它。
    title_input: [
      '#title-textarea #textbox',
      '#title-textarea',
      'ytcp-text-input #textbox',
    ],
    desc_textarea: [
      '#description-textarea #textbox',
      '#description-textarea',
      'ytcp-text-input#description-textarea #textbox',
    ],
    // 「受众：非儿童向」是必填项（不选则发布被拦）。
    // [参考] social-auto-upload 明确点了 VIDEO_MADE_FOR_KIDS_NOT_MFK。
    audience_not_for_kids: [
      'tp-yt-paper-radio-button[name="VIDEO_MADE_FOR_KIDS_NOT_MFK"]',
      'tp-yt-paper-radio-button:has-text("不是面向儿童")',
      'tp-yt-paper-radio-button:has-text("not made for kids")',
    ],
    // 标签在「显示更多」折叠区里，必须先点开。
    tags_toggle: ['#toggle-button', 'ytcp-button#toggle-button'],
    tags_input: [
      '#tags-container #text-input',
      'ytcp-form-input-container#tags-container input',
      'ytcp-form-input-container#tags-container #textbox',
    ],
    cover_input: [
      '#file-loader input[type="file"]',
      'ytcp-thumbnail-uploader input[type="file"]',
    ],
    // 上传进度文案（判据：出现这些词才算传完）。
    // [参考] social-auto-upload 用同一组词做「上传完成」判定。
    upload_progress: [
      '.progress-label',
      'span.progress-label',
      'ytcp-video-upload-progress',
    ],
    // 发布后回读：作品链接（=「发出去了」的正向证据）。
    published_link: [
      'a[href*="youtu.be"]',
      'a[href*="watch?v="]',
    ],
    // 可见性 radio：**按平台可见性枚举分组的候选**。
    // ⚠️ 不要用「在 visibility_btn 里按 name="X" 子串匹配」来挑 ——
    //   那是靠字面量形状的**隐式约定**，换个拼法就失效（且无法被测试区分）。
    //   ⇒ 显式映射：实现只查 `sel.visibility_radio[可见性]`，选择器来源单一且可测。
    visibility_radio: {
      PUBLIC: ['tp-yt-paper-radio-button[name="PUBLIC"]', '#public-radio-button'],
      UNLISTED: ['tp-yt-paper-radio-button[name="UNLISTED"]'],
      PRIVATE: ['tp-yt-paper-radio-button[name="PRIVATE"]'],
    },
  },

  // ============================================================
  // TikTok —— 专属链是「TikTok Studio 单页 + 上传区可能是 iframe」
  // 来源：dreammis/social-auto-upload uploader/tk_uploader/main_chrome.py（[参考]）
  //        + tk_config.py（[参考]，定位器真源）
  // ⚠️ **全部未在本仓真机验证**（与 youtube 段同级的诚实边界）。
  // ============================================================
  tiktok: {
    // 上传区有**两种形态**（参考实现用 `choose_base_locator` 二选一）：
    //   ① iframe 形态：整个上传界面在一个 iframe 里
    //   ② div 形态：直接渲染在主文档
    // ⇒ 实现必须两套都支持（否则改版即必败）。
    upload_frame: [
      'iframe[data-tt="Upload_index_iframe"]',
    ],
    upload_container: [
      'div.upload-container',
    ],
    // 文件输入：真源表是裸 `input[type="file"]`。
    // ⚠️ 参考实现**不直接找 input**，而是点「Select video」按钮后等 file chooser
    //    ⇒ 说明 TikTok 的 input 可能是「点按钮才动态创建」的。
    //    ⇒ 这里保留「优先带 video accept 的」作为第一候选，但**不覆盖**真源表的裸选择器
    //    （找不到就 fail，不猜）。
    file_input: [
      'input[type="file"][accept*="video"]',
      'input[type="file"]',
    ],
    // 描述编辑器：参考实现用 `div.public-DraftEditor-content`（**Draft.js**）。
    // ⚠️ Draft.js / ProseMirror 类编辑器**不接受 innerHTML 直写**
    //    （helpers.js:218 附近有 2026-09-29 知乎写页的同型实测记录：
    //    框架状态为空、发布空文；唯一可信通道是 CDP Input.insertText）
    // ⇒ 候选顺序 = 「精确的 DraftEditor 容器」优先，通用 contenteditable 兜底。
    caption_editor: [
      'div.public-DraftEditor-content',
      'div[data-testid="captionTextArea"]',
      '[contenteditable="true"]',
    ],
    // 「Post」按钮（上传完成的判据 + 发布动作都用它）。
    // 参考实现取 `div.button-group button` 的**第 0 个**，并读它的 `disabled` 属性。
    post_btn: [
      'div.button-group > button',
      'button:has-text("Post")',
    ],
    // 登录过期标记：页面结构特征（参考实现遍历所有 select，class 匹配
    // `tiktok-.*-SelectFormContainer.*`）⇒ 出现即 cookie 过期。
    // ⚠️ 这里的候选**比参考实现宽**（只按 class 子串匹配，不锚 `tiktok-` 前缀与 `-` 分隔），
    //    因为 CSS 选择器无法直接表达那条正则；实现侧会**在 JS 里用完整正则复核**，
    //    避免把无关 select 误判成过期。
    login_expired_select: [
      'select[class*="SelectFormContainer"]',
    ],
    // 上传出错（参考实现在轮询里发现这个按钮 ⇒ 上传失败需要重试）。
    upload_error_btn: [
      'button[aria-label="Select file"]',
    ],
    // 发布后回读：作品列表里第一行的作品链接（href 里含 `video/<数字ID>`）。
    published_video_link: [
      'div[data-tt="components_PostTable_Container"] div[data-tt="components_PostInfoCell_Container"] a',
      'a[href*="/video/"]',
    ],
  },

  // twitter / instagram / facebook 的**步骤**选择器（登录态判据 / 主体分流等）
  // 随各自的专属链**同批落地** —— 通用字段已在真源表里，
  // 步骤字段没有对应实现时先不登记，避免「定义了不消费」。
}

/**
 * 取某平台专属链要用的选择器（真源表的通用字段 + 本表的增量字段）。
 * @param {string} platform
 * @returns {SelectorSet}
 */
function getOverseasSelectors (platform) {
  const base = PLATFORM_PUBLISH_SELECTORS[platform] || {}
  const extra = OVERSEAS_STEP_SELECTORS[platform] || {}
  return Object.assign({}, base, extra)
}

module.exports = { OVERSEAS_STEP_SELECTORS, getOverseasSelectors }
