/**
 * 富文本正文的输入硬拦（审计 4.7 ③）
 *
 * 三层覆盖，缺一层就会留下"看着像修好"的缝：
 * ① 纯函数行为（精确断言：结构安全、闭合补齐、幂等）；
 * ② **同口径**：裁完必须真的能让 `validatePlatformContent` 放行——这条是判据本体，
 *    因为发布校验数的是原始字符串码点（HTML 模式下含标签），不是纯文本；
 * ③ 接线：真实穿过 ArticleEditor 的 `richContent` setter（把 `@vueup/vue-quill` 换成
 *    会主动回写的假件；script-setup 里 import 的组件不受 `global.components` 覆盖，
 *    只有 mock 模块本身才接得住）。
 */
import { describe, it, expect, vi } from "vitest";
import { mount } from "@vue/test-utils";
import { contentCodePointLength, truncateContentToLimit } from "./article-editor-hard-stop";
import { getPlatformContentLimit, validatePlatformContent } from "@/features/publish/publish-contract";

const P = (s) => `<p>${s}</p>`;
const OVER = `${P("一二三四五六七八九十")}${P("十一十二十三十四十五十六")}`;   // 39 个码点

vi.mock("@vueup/vue-quill", () => ({
  QuillEditor: {
    name: "QuillEditor",
    props: ["content", "contentType", "options", "style"],
    emits: ["update:content"],
    template: "<div class=\"quill-stub\"></div>",
    mounted() { this.$emit("update:content", OVER) },
  },
}));

describe("truncateContentToLimit：按发布校验的同一口径裁尾", () => {
  it("限内原样返回（逐字节相同，不做无谓重写）", () => {
    const html = `${P("短")}${P("也短")}`;
    expect(truncateContentToLimit(html, 500)).toBe(html);
  });

  it("切点不得落在标签内部；闭合标签成对补齐；**最终产物**（含补上的闭合标签）不得超限", () => {
    const html = `${P("abcdefghijklmnopqrstuvwxyz")}${P("SECOND")}`;
    const limit = html.length - 12;
    const out = truncateContentToLimit(html, limit);
    expect(/<[a-zA-Z][^>]*$/.test(out), `切在标签内部，产物残缺：…${out.slice(-24)}`).toBe(false);
    expect((out.match(/<p>/g) || []).length).toBe((out.match(/<\/p>/g) || []).length);
    expect(contentCodePointLength(out), `补齐闭合后超限：${contentCodePointLength(out)} > ${limit}`).toBeLessThanOrEqual(limit);
  });

  it("切点不得落在实体内部（把 &amp; 劈成 &am 会渲染出乱码）", () => {
    const html = P("ab&amp;cdef&lt;ghijklmnopqrstuvwxyz");
    for (const limit of [html.length - 1, html.length - 2, html.length - 3, html.length - 6, 20]) {
      const out = truncateContentToLimit(html, limit);
      expect(out, `limit=${limit} 尾部有劈开的实体：…${out.slice(-14)}`).not.toMatch(/&(a|am|amp|l|lt|g|gt|q|qu|quo|quot|#|&#|&#3)$/i);
      expect(out).not.toMatch(/&$/);
      expect(contentCodePointLength(out)).toBeLessThanOrEqual(limit);
    }
  });

  it("代理对不得被切成半个字符", () => {
    const html = P("😀😀😀😀😀");
    const out = truncateContentToLimit(html, 8);
    expect(out.includes("\ufffd"), `产出半个代理对：${out}`).toBe(false);
  });

  it("同口径（判据本体）：裁完之后必须真的能让发布校验放行", () => {
    const platform = "baijiahao";
    const limit = getPlatformContentLimit(platform).contentMax;
    expect(limit, "该平台没有正文上限，这条用例失去意义").toBeGreaterThan(0);
    const body = "甲".repeat(limit + 5);
    const before = validatePlatformContent({ platforms: [platform], article: { title: "t", content: body } });
    expect(before.valid, "前置条件不成立：超量内容本该被发布校验拒绝").toBe(false);
    const trimmed = truncateContentToLimit(body, limit);
    expect(contentCodePointLength(trimmed), "裁尾没有达到上限").toBe(limit);
    const after = validatePlatformContent({ platforms: [platform], article: { title: "t", content: trimmed } });
    expect(after.valid, `裁完仍被拒：${after.reason || after.error || ""}`).toBe(true);
  });

  it("HTML 形态同样成立：标签自身占预算这一事实不得被绕过", () => {
    const platform = "baijiahao";
    const limit = getPlatformContentLimit(platform).contentMax;
    const html = P("甲".repeat(limit));                     // 正文刚好占满，外加 <p></p> 的开销
    const out = truncateContentToLimit(html, limit);
    expect(contentCodePointLength(out)).toBeLessThanOrEqual(limit);
    expect((out.match(/<p>/g) || []).length).toBe((out.match(/<\/p>/g) || []).length);
  });
});

describe("接线：超限内容必须穿过 ArticleEditor 的富文本回写口", () => {
  it("假件正控：先证明 mock 生效且真的 emit 过（否则下一条的「零回写」会被读成接线失败）", async () => {
    const mod = await import("@vueup/vue-quill");
    const w = mount(mod.QuillEditor, { props: { content: "" } });
    expect(w.emitted()["update:content"], "假件没有 emit update:content ⇒ 夹具失效，不是被测方失效").toBeTruthy();
    expect(w.emitted()["update:content"][0][0]).toBe(OVER);
  });

  it("富文本回写超限 HTML ⇒ 组件对外 emit 的正文已被裁到上限且仍是段落形态", async () => {
    const { default: i18n } = await import("@/i18n");
    const ArticleEditor = (await import("./ArticleEditor.vue")).default;
    const w = mount(ArticleEditor, { props: { modelValue: "", maxChars: 20 }, global: { plugins: [i18n] } });
    const emitted = w.emitted()["update:modelValue"] || [];
    expect(emitted.length, "没有任何回写 ⇒ 硬拦不在富文本回写口上").toBeGreaterThan(0);
    const last = emitted[emitted.length - 1][0];
    expect(contentCodePointLength(last), `超限内容原样透传，长度=${contentCodePointLength(last)}`).toBeLessThanOrEqual(20);
    expect(last.startsWith("<p>"), `回写被切成别的形态（禁止为省事退回纯文本）：${String(last).slice(0, 30)}`).toBe(true);
    expect((last.match(/<p>/g) || []).length, "段落结构被吞").toBeGreaterThan(0);
    expect((last.match(/<p>/g) || []).length).toBe((last.match(/<\/p>/g) || []).length);
  });

  it("结构锁：Markdown 侧仍走 maxlength；QuillEditor 标签上不得出现 maxlength（对 contenteditable 无效，写了是假装修好）", async () => {
    const fs = await import("node:fs");
    const path = await import("node:path");
    // vitest 的 SSR 模块里 `import.meta.url` 不保证是 file: 协议，`new URL(x, import.meta.url)`
    // 会在 URL 构造时就抛 `TypeError: The URL must be of scheme file`（本机实测两次红在这一步，
    // 与判据本身无关——三条判据当场用 node 直接求值全部成立）。
    // 取 cwd 相对路径 + **正控**：读到的一定是目标 SFC（含 QuillEditor 与 textarea 两个标记），
    // 否则"路径读错"会伪装成"判据通过/失败"。
    const file = path.resolve(process.cwd(), "src/components/ArticleEditor.vue");
    expect(fs.existsSync(file), `取不到被测 SFC：${file}`).toBe(true);
    const src = fs.readFileSync(file, "utf8");
    expect(src.includes("<QuillEditor"), "读到的不是 ArticleEditor 本体（正控失败）").toBe(true);
    expect(/<textarea[\s\S]*?:maxlength="maxChars"/.test(src), "Markdown 侧的 maxlength 丢了").toBe(true);
    // 判据必须只在 QuillEditor 那一个标签内匹配：上一版写成 `<QuillEditor[\s\S]*?maxlength`，
    // 会一路吃过后面的 textarea 标签命中它的 maxlength ⇒ 一条恒红的假判据（当场被自己抓到）。
    expect(/<QuillEditor\b[^>]*\bmaxlength/i.test(src), "给 contenteditable 写 maxlength 是无效写法").toBe(false);
    expect(src.includes("truncateContentToLimit(val, props.maxChars)"), "富文本回写口没接硬拦").toBe(true);
  });
});
