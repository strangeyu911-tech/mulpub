import { describe, it, expect, vi, beforeEach } from "vitest";

/**
 * toutiao-page-publish.test.js — 回归锁（2026-10-26，QM-5 Bug 反哺 ④）
 *
 * ## 锁住的是什么
 *
 * 2026-10-25 的真机事故：头条 `PublishVideo` 长期返回
 * `403 {"code":403,"msg":"invalid csrf token"}`，根因是
 * **x-csrf-token 取错了 cookie**：
 *
 *   ❌ passport_csrf_token（32 字符）→ 永远 403
 *   ✅ xigua_csrf_token  （24 字符）→ HTTP 200（真 Chromium 三组对照实验）
 *
 * 该文件此前**没有任何测试**（`*page-publish*test*` = 0 个），
 * 所以「取错 cookie 名」这种一行字的错误可以一路逃到真机、逃了 6 轮验证。
 *
 * ## 三个断言（缺一不可）
 *
 * 1. **先读 token**：第一次 executeJavaScript 必须去读 `xigua_csrf_token`；
 * 2. **再用 token**：第二次 executeJavaScript 生成的脚本必须把它塞进
 *    `x.setRequestHeader("x-csrf-token", <token>)`；
 * 3. **不得回退到错的 cookie**：脚本里不能出现 `passport_csrf_token` 作为取值来源。
 *
 * 这里不联网、不启真实页面：webContents 是假的，只验证**请求是怎么构造的**。
 * 「构造对不对」和「服务端认不认」是两件事，前者必须有自动化锁。
 */

vi.mock("electron", () => ({
  BrowserWindow: vi.fn(function () {
    return {
      loadURL: async () => {},
      webContents: {},
      isDestroyed: () => false,
      destroy: () => {},
    };
  }),
  session: {
    fromPartition: vi.fn(() => ({ cookies: { get: vi.fn(async () => []) } })),
  },
}));

const { publishViaPage } = require("./toutiao-page-publish");

/**
 * 造一个假的 webContents：
 * - 第 1 次 executeJavaScript → 返回「页面里的 cookie 值」（模拟读 token）
 * - 第 2 次 executeJavaScript → 返回「XHR 结果」（模拟发请求）
 */
function makeWc(token, status = 200, body = '{"Code":0}') {
  const calls = [];
  const wc = {
    executeJavaScript: vi.fn(async (code) => {
      calls.push(code);
      if (calls.length === 1) return token;
      return JSON.stringify({ status, body });
    }),
    session: { cookies: { get: vi.fn(async () => []) } },
  };
  return { wc, calls };
}

describe("toutiao-page-publish / csrf 令牌回归锁", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("先读 xigua_csrf_token，再把它写进 x-csrf-token 请求头", async () => {
    const token = "o_ch1xm-TOKEN24CHARSxx";
    const { wc, calls } = makeWc(token);

    const out = await publishViaPage("acc-1", "/xigua/api/upload/PublishVideo", '{"A":1}', {
      webContents: wc,
    });

    expect(out).toEqual({ status: 200, body: '{"Code":0}' });
    expect(calls).toHaveLength(2);

    // ① 第一步必须去读 xigua_csrf_token（不是 passport_csrf_token）
    expect(calls[0]).toContain("xigua_csrf_token");
    expect(calls[0]).not.toContain("passport_csrf_token");

    // ② 第二步必须带上这个 token 作为 x-csrf-token
    expect(calls[1]).toContain('x.setRequestHeader("x-csrf-token", ' + JSON.stringify(token) + ")");
  });

  it("token 为空时仍然发出请求（只带 secsdk 头），不抛异常", async () => {
    const { wc, calls } = makeWc("");

    const out = await publishViaPage("acc-1", "/xigua/api/upload/PublishVideo", '{"A":1}', {
      webContents: wc,
    });

    expect(out).toEqual({ status: 200, body: '{"Code":0}' });
    expect(calls).toHaveLength(2);
    // 空 token 也要有这一行（服务端会判 missing，但客户端行为必须可预测）
    expect(calls[1]).toContain("x-csrf-token");
  });

  it("非 200 时原样返回状态，不把失败伪装成成功", async () => {
    const { wc } = makeWc("tok", 403, '{"code":403,"msg":"invalid csrf token"}');

    const out = await publishViaPage("acc-1", "/xigua/api/upload/PublishVideo", '{"A":1}', {
      webContents: wc,
    });

    expect(out.status).toBe(403);
    expect(out.body).toContain("invalid csrf token");
  });

  it("缺少必需参数时返回 null（早退，不建窗口、不发请求）", async () => {
    const { wc, calls } = makeWc("tok");
    expect(await publishViaPage("", "/xigua/api/upload/PublishVideo", "{}", { webContents: wc })).toBeNull();
    expect(await publishViaPage("acc-1", "", "{}", { webContents: wc })).toBeNull();
    expect(calls).toHaveLength(0);
  });
});
