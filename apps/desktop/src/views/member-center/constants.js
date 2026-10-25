/**
 * 会员中心渲染层常量。
 *
 * ⚠️ 这里的值**不是**第二真源，而是服务端契约的镜像：
 * - PLAN_RANK_MAX 对应 plan-matrix.js 的 PLAN_RANK（free:0/standard:1/pro:2），
 *   服务端已通过 entitlement.limits.plan_rank 下发到渲染层。
 * - 本常量只用于「渲染层拿不到 rank 时的比较基准」；**判定永远以
 *   entitlement.limits.plan_rank 的实际值为准**，不读本地写死的档位名。
 *
 * 为什么不在渲染层硬编码档位名单：plan-matrix 的 PLAN_RANK 独立于
 * BASE_MATRIX 且不可被 overrides 覆盖（服务端铁律），渲染层复制一份
 * 档位序就会有两处真相。这里只放「最高档 rank」一个标量用于比较。
 */

/** 服务端 PLAN_RANK 最大值（pro）。standard=1 < 2 → 显示升级 CTA。 */
export const PLAN_RANK_MAX = 2

/**
 * 兑换码本地前置校验字符类。
 *
 * ⚠️ 必须与服务端 `subscription-service.js` 的 REDEEM_CODE_ALPHABET
 * **逐字符同型**（排除易混淆字符 I/L/O/0/1）。服务端是 CJS 模块、
 * 渲染层无法直接 require，故在此镜像；`labels.test.js` 之外的
 * 契约一致性由 subscription-service 的测试守护服务端侧，
 * 渲染层侧由本文件的注释 + 兑换测试锁定形状。
 *
 * 若服务端修改字母表，**必须同步改这里**（grep REDEEM_CODE_ALPHABET）。
 */
export const REDEEM_CODE_ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789'

/** 4-4-4 形如 ABCD-EFGH-JKMN（总长 14，含 2 个连字符）。 */
export const REDEEM_CODE_PATTERN = new RegExp(
  '^[' + REDEEM_CODE_ALPHABET + ']{4}' +
  '-[' + REDEEM_CODE_ALPHABET + ']{4}' +
  '-[' + REDEEM_CODE_ALPHABET + ']{4}$',
)

export const REDEEM_CODE_MAX_LENGTH = 14

/** 本地格式校验的 i18n key（失败时不发请求）。 */
export const REDEEM_ERR_FORMAT_LOCAL = 'memberCenter.redeemErrFormatLocal'

/** 码的**字符**位数（4-4-4 ⇒ 12 个字符；显示上另有 2 个连字符 ⇒ 共 14 位）。 */
export const REDEEM_CODE_DIGITS = 12

/**
 * 输入归一化：**自动大写 + 自动分隔**（4-4-4）。
 *
 * 为什么要有（PRD P0-1）：
 *  - **大写**：服务端核销前会 `trim().toUpperCase()`，客户端不转的话用户看到的是
 *    自己输入的大小写、库里查的是大写 ⇒ 出错时极难自查。
 *  - **分隔**：激活码天然是 4-4-4 三段，人从聊天记录里抄时常漏一个连字符 ⇒
 *    边输边补连字符比让用户被服务端打回「格式不正确」友好。
 *
 * ⚠️ **不替换字母表之外的字符**：`I` / `L` / `O` / `0` / `1` 是**易混淆字符**，
 * 服务端字母表里没有 ⇒ 保留原样交给本地校验去拒（并给出「不包含 I、L、O 与 0、1」的
 * 可读原因），**不在这里悄悄改成别的字符**（那会让用户以为自己输对了）。
 *
 * ⚠️ 去掉的是**所有非字母数字**字符（空格 / 连字符 / 全角空格等分隔类字符都在内）
 * ⇒ 粘贴带横线、带空格的码也能吃下。
 *
 * @param {string} raw 输入框原文
 * @returns {string} 归一化后的码（大写、每 4 位一个连字符、最多 12 位）
 */
export function normalizeRedeemInput (raw) {
  const compact = String(raw == null ? '' : raw)
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, '')
    .slice(0, REDEEM_CODE_DIGITS)
  const groups = []
  for (let i = 0; i < compact.length; i += 4) groups.push(compact.slice(i, i + 4))
  return groups.join('-')
}
