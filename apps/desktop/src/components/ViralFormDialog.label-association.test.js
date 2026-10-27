/**
 * ViralFormDialog 的 label ↔ 控件关联 + 必填项可访问状态（审计 4.3 / 4.4 交叉）
 *
 * 同 AiWriterPanel 的分层：挂载层只当负控（渲染出来的 for 一律不得悬空），
 * 覆盖面上界放在**静态清单**（本弹窗主体在 `v-if` 的 visible 里，夹具不一定渲染得出来）。
 * 另加一条：带视觉 `*` 的必填项必须同时有 `aria-required`——只靠颜色星号，读屏用户
 * 不知道哪个字段必填（审计 4.3 明列「aria-required 补齐」）。
 */
import { describe, it, expect, vi } from "vitest";
import { mount } from "@vue/test-utils";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import i18n from "@/i18n";
import ViralFormDialog from "./ViralFormDialog.vue";

const SRC = readFileSync(resolve(dirname(fileURLToPath(import.meta.url)), "ViralFormDialog.vue"), "utf8").replace(/\r\n/g, "\n");

const PAIRS = [
  "vfd-title", "vfd-url", "vfd-content", "vfd-author", "vfd-platform", "vfd-industry",
  "vfd-tagstext", "vfd-cover-url", "vfd-published-at", "vfd-likes", "vfd-collections", "vfd-comments",
];
const LABELABLE = new Set(["INPUT", "SELECT", "TEXTAREA", "BUTTON", "METER", "OUTPUT", "PROGRESS"]);

function tagAt(text, from) {
  let q = null;
  for (let i = from; i < text.length; i++) {
    const c = text[i];
    if (q) { if (c === q) q = null; continue }
    if (c === '"' || c === "'") { q = c; continue }
    if (c === ">") return { tag: text.slice(from, i + 1), end: i };
  }
  return null;
}

describe("ViralFormDialog label↔控件关联（审计 4.3）", () => {
  it("挂载后任何渲染出的 label[for] 都必须解析到 labelable 控件（for 不悬空、.labels 反查命中）", async () => {
    const w = mount(ViralFormDialog, {
      props: { visible: true, title: "测试表单", mode: "create" },
      global: { plugins: [i18n], stubs: { Teleport: { template: "<div><slot /></div>" }, Transition: { template: "<div><slot /></div>" } } },
      attachTo: document.body,
    });
    for (const l of w.findAll("label")) {
      const id = l.element.htmlFor;
      if (!id) continue;
      const target = document.getElementById(id);
      expect(target, `label for="${id}" 指向不存在的元素`).not.toBeNull();
      expect(LABELABLE.has(target.tagName), `for="${id}" 指向 ${target.tagName}，不是 labelable 元素`).toBe(true);
      expect(Array.from(target.labels).some((x) => x === l.element), `控件 #${id} 的 .labels 反查不到该 label`).toBe(true);
    }
  });

  it("清单：12 对 for↔id 逐个存在，且文件里的 for 集合不多不少（新增孤岛或漏接线都会红）", () => {
    const pairs = [...SRC.matchAll(/<label\b[^>]*\bfor="([^"]+)"/g)].map((m) => m[1]).sort();
    expect(pairs, "label[for] 集合与本用例清单不一致").toEqual([...PAIRS].sort());
    for (const id of PAIRS) {
      expect(new RegExp(`<(input|textarea|select)\\b[^>]*\\bid="${id}"`).test(SRC), `缺少 id="${id}" 的控件`).toBe(true);
    }
  });

  it("必填项：视觉 * 的那一项必须同时有 aria-required（只靠颜色星号，读屏不知道哪个必填）", () => {
    const starLabels = [...SRC.matchAll(/<label\b[^>]*>(?:(?!<\/label>).)*\*\s*<\/span>[\s\S]{0,240}?\n\s*<(input|textarea|select)\b[^>]*>/g)]
      .map((m) => m[0]);
    expect(starLabels.length, "找不到带 * 的必填项标签 ⇒ 判据面是空的").toBeGreaterThanOrEqual(1);
    for (const block of starLabels) {
      expect(/aria-required="true"/.test(block), `带 * 的必填项缺 aria-required：${block.slice(0, 90)}`).toBe(true);
    }
  });

  it("零孤岛：本文件不再有无 for、不包裹控件的 label（并带扫描规模下界）", () => {
    const orphans = [];
    let scanned = 0;
    for (const m of SRC.matchAll(/<label\b/g)) {
      const t = tagAt(SRC, m.index);
      if (!t) continue;
      scanned++;
      if (/\bfor="/.test(t.tag)) continue;
      const close = SRC.indexOf("</label>", t.end);
      const inner = close > 0 ? SRC.slice(t.end + 1, close) : "";
      if (/<(input|select|textarea|button)\b/.test(inner)) continue;
      orphans.push(`行 ${SRC.slice(0, m.index).split("\n").length}: ${t.tag.replace(/\s+/g, " ").slice(0, 70)}`);
    }
    expect(scanned, "一个 <label> 都没扫到 ⇒ 扫描器坏了，不是已合规").toBeGreaterThanOrEqual(11);
    expect(orphans, "仍有孤岛 label：\n" + orphans.join("\n")).toEqual([]);
  });

  it("id 不与既有 data-testid 撞名，且全文件 id 唯一", () => {
    const ids = [...SRC.matchAll(/\bid="([^"]+)"/g)].map((m) => m[1]);
    expect(new Set(ids).size, "文件内 id 重复").toBe(ids.length);
    const testids = [...SRC.matchAll(/data-testid="([^"]+)"/g)].map((m) => m[1]);
    expect(ids.filter((i) => testids.includes(i)), "id 与 data-testid 撞名").toEqual([]);
    void vi;
  });
});
