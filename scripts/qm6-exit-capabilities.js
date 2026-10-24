'use strict';
/**
 * 收口出口能力读数（change: qm6-exit-capability-probe）
 *
 * 为什么单独一个文件（而不是长在 ccg-convergence-probe.js 里）：
 * 2026-10-20 的实测事故 —— PR #4062（一个 s2v 错误码修复）携带评审前的旧副本，
 * 把 PR #4067 在 `ccg-convergence-probe.js` + 它的 `.test.js` + `ccg-convergence-exit/tasks.md`
 * 三个文件里的改动**整段撤销**（`git show --stat 8fdd617b2` 当场读数：探针 +1/−21、测试 −25、tasks −31）。
 * 之所以无人发现：那条"发现它"的断言与它守护的实现**同批被删**。
 * 本模块因此被一个第三份文件的契约锁守（`qm6-exit-capabilities.test.js`），
 * 并由 `quality-gate.yml` 的 changes 作业独立点名一次。
 *
 * 三格出口（2026-10-23 现场读数，逐条可重取）：
 *   ① externalReview —— vendor 能表达"外部复核三格齐备即解除阻断" ⇒ **true**（本机 vendor 补丁）
 *   ② upheld         —— 被判成立的条目有"已修且已验证"的出口吗     ⇒ **false**（push 前无守卫）
 *   ③ toolSignature  —— 写 tier=external 那道合取有第二条路吗      ⇒ **false**（只认 performedBy）
 * ③ 的可复现性是刻意设计：它的输入是**仓内**文件，所以 CI runner 上也量得到；
 * ①② 的输入在 vendor 里，只有装了技能包的机器量得到 —— 两种读数必须分开报，
 * 混成一个数就等于让"换台机器"悄悄把结论换掉。
 *
 * 三档返回值：true / false / 'unknown'。
 * ⛔ 'unknown'（读不出被声明物）**不得**折叠成 false ——
 * "vendor 把函数改名了"与"这条出口确实不存在"是两件事，把前者报成后者，
 * 下一次就会有人拿着这条读数去改设计文档（本仓把这类折叠定性为把工具的失明读成结论）。
 *
 * 零出站；只吃字符串，不碰 git、不碰网络、不 require vendor。
 */

const NOVEL = new Set(['unknown', 'true', 'false']);

/** ① 高危域条目：解除谓词被**定义** + 驱动把期望后端写进裁决模板。两格都要，缺任一不算在位。 */
function externalReviewCapable (driverSrc) {
  if (typeof driverSrc !== 'string' || driverSrc.trim() === '') return 'unknown';
  const hasPredicate = /^[ \t]*function[ \t]+externalReviewSatisfied[ \t]*\(/m.test(driverSrc);
  const declared = /externalReviewSatisfied/.test(driverSrc);
  if (!declared) return 'unknown'; // 被声明物不存在 ⇒ 读不出，而不是"没有出口"
  const hasExpected = /expectedExternalBackend[ \t]*:/.test(driverSrc);
  return hasPredicate && hasExpected;
}

/**
 * ② upheld 条目：`verdict === 'upheld'` 那条 push 之前有没有解除臂。
 * 取"整个函数体"再定位，不用固定行数窗口 —— 加一条注释就会把窗口判据骗过去（本仓实测同型）。
 */
function upheldExitCapable (driverSrc) {
  if (typeof driverSrc !== 'string' || driverSrc.trim() === '') return 'unknown';
  if (!/blockingFromAdjudication/.test(driverSrc)) return 'unknown';
  const start = driverSrc.search(/function[ \t]+blockingFromAdjudication[ \t]*\(/);
  if (start < 0) return 'unknown';
  const body = sliceFunctionBody(driverSrc.slice(start));
  if (body === null) return 'unknown';
  const at = body.search(/[ \t]*if[ \t]*\([ \t]*i\.verdict[ \t]*===?[ \t]*['"]upheld['"]/);
  if (at < 0) return 'unknown';
  // 只看那一条 if 自己的块（到它自己的闭合括号为止）：往后多读几行会把"下一条的 return"算成它的解除臂。
  const blk = sliceBlock(body.slice(at).replace(/^[ \t]*if[ \t]*\([^)]*\)/, ''));
  if (blk === null) return 'unknown';
  return /\breturn\b/.test(blk) && /Capable|Satisfied|resolvedEvidence|resolution\b|externalReview/.test(blk);
}

/**
 * ③ 工具署名：写回器在 `performedBy === expected` 之外是否还有第二条通往"写"的路径。
 * 形状判据：先确认这条合取**在**（读不出即 unknown），再看它的条件里有没有 `||` 分支。
 */
function toolSignatureCapable (writebackSrc) {
  if (typeof writebackSrc !== 'string' || writebackSrc.trim() === '') return 'unknown';
  if (!/performedBy/.test(writebackSrc) || !/expected/.test(writebackSrc)) return 'unknown';
  const m = /^[ \t]*if[ \t]*\(dr\.performedBy[ \t]*===?[ \t]*expected[^\)]*\)/m.exec(writebackSrc);
  if (!m) return 'unknown';
  const cond = m[0].replace(/^[ \t]*if[ \t]*\(/, '').replace(/\)$/, '');
  return /\|\|/.test(cond);
}

/**
 * 「这份驱动能不能被安全 require」—— 行为档的前提，必须先判它，再决定要不要执行。
 *
 * 动因是 2026-10-24 的现场：本机 vendor 驱动被另一个会话改写，末尾从
 * `if (require.main === module) process.exit(main())` 变成裸 `process.exit(main())`，
 * 于是本探针的那次 require **把别人的整条评审流水线跑了进来并 exit 掉本进程** ——
 * `--json` 档的 stdout 变成「判定记录按 diff 内容寻址命中…」，调用方 `JSON.parse` 当场炸，
 * 而报错读起来像"探针输出坏了"，不像"探针执行了不该执行的东西"。
 *
 * 四个成因不得合并（把「不该执行」与「执行了但拿不到函数」并成一句，
 * 下一个会话就会把静默跳过读成"两路一致"）：
 *   'ok'                  ⇒ 可以 require，且导出面在
 *   'no-exports'          ⇒ 可以 require 但没有导出面 ⇒ 行为档取不到函数，属**真失明**（要出声、要 rc=1）
 *   'executes-on-require' ⇒ 顶层无守卫地执行 main() ⇒ **禁止 require**（不代跑别人的流水线）
 *   'unparsable-driver'   ⇒ 结构判据认不出这份驱动的顶层形态（串/正则/花括号剥不动）⇒ 同样禁止 require，
 *                            但**要修的对象不同**：前者要改 vendor，后者要改探测器自己 ⇒ 两档不得合并成一句
 *   'unreadable'          ⇒ 传进来的不是可读源码
 * 判据取"require 时会不会真的执行 main()"，不取"文件里出现过几处 process.exit"——
 * 驱动在函数体内用 `process.exit(2)` 做缺依赖早退是合法的（两份现场样本都有那一处）。
 * ⛔ 第 7 轮评审 i3 实测否证了原先的窄黑名单：`process.exit(main.apply(null, …))`、
 *   `process.exit(main.call(…))`、`const c = main(); process.exit(c)`、裸 `main();` 四种**顶层真会执行**
 *   的写法全被读成 ok ⇒ 探针照样 require ⇒ 正好回到本刀要消灭的那次事故（读数现场见执行记录）。
 * 现在的判据是「先剥安全区，再在剩下的顶层区找 main 调用」：剥掉守卫整段（块或单语句到行末）、
 * 任何函数体、注释、字符串与正则字面量；剩下一处 main 调用即判 executes-on-require。
 * 剥不动的地方（花括号配不平、跨行未闭合的串/正则、带插值的模板串）一律返回 null ⇒ 走保守侧。
 * **误判只允许落在保守侧**：少一路读数会出声，误放行是替别人跑完整条流水线。
 * ⚠ `ok` 只保证"加载期不会替别人跑完整条评审流水线"，**不是**模块隔离：顶层直接写文件/发请求的驱动
 *   仍然会被执行。这条边界与 `require(vendor.engine)` 既有的一致（候选面只来自环境变量与用户技能目录，
 *   永不回落到仓库自身，见探针 `locateVendor` 与 P7），要收紧只能整体改成子进程隔离，属另一刀。
 */
/** 守卫头：块形态按花括号整段剥，单语句形态剥到行末（行末之后不猜）。 */
const GUARD_HEAD = /\bif\s*\(\s*require\.main\s*===\s*module\s*\)/g;
/** `function` 关键字：其后第一个配对花括号整段是函数体，require 时不会执行。 */
const FUNCTION_DECL = /\bfunction\b/g;
/** `main` 被调用的三种写法：直接调 / apply / call（bind 不执行，故不列）。 */
const MAIN_CALL = /\bmain\s*(?:\.(?:apply|call))?\s*\(/g;
/**
 * 「按设计的跳过」只有这两档。用**冻结数组**而不是 Set：
 * 现场实测 `Object.freeze(new Set())` 之后 `.add` 照旧生效（Set 改的是内部槽，不是属性），
 * 冻住的数组在严格模式下 `push` 直接抛 —— 挡得住"消费方顺手 add 一档好让自己不红"这一格。
 * 真正的牙仍然是 A21 的逐档断言 + 变异 n30（源级改写只有测试能抓，运行时冻结抓不到），
 * 两者不是替代关系，别因为有 freeze 就删断言。
 */
const BEHAVIORAL_SKIP_REASONS = Object.freeze(['unreadable', 'executes-on-require', 'unparsable-driver']);
function isBehavioralSkip (reason) { return BEHAVIORAL_SKIP_REASONS.indexOf(reason) >= 0; }

/**
 * 剥出「require 时会真正执行」的顶层代码区；剥不动返回 null（调用方按保守侧处理）。
 * 顺序有讲究：先剥守卫段（此时源码还是原样，花括号最可信），再剥注释与串（把串里的 `{` 变成空格，
 * 函数体配对才不会被内容骗），最后剥函数体。
 */
function nonGuardedTopLevelRegion (src) {
  let s = src.startsWith('#!') ? '//' + src.slice(2) : src; // shebang 不是代码，按行注释处理（长度不变）
  s = stripGuardRegions(s);
  if (s === null) return null;
  s = stripCommentsAndStrings(s);
  if (s === null) return null;
  s = stripFunctionBodies(s);
  if (s === null) return null;
  return s;
}

function stripGuardRegions (src) {
  let out = '';
  let cursor = 0;
  GUARD_HEAD.lastIndex = 0;
  let m;
  while ((m = GUARD_HEAD.exec(src)) !== null) {
    out += src.slice(cursor, m.index);
    let i = m.index + m[0].length;
    while (i < src.length && /[ \t]/.test(src[i])) i++;
    if (src[i] === '{') {
      const close = matchBraces(src, i);
      if (close < 0) return null;
      i = close;
    } else {
      while (i < src.length && src[i] !== '\n' && src[i] !== '\r') i++;
    }
    cursor = i;
    GUARD_HEAD.lastIndex = i;
  }
  return out + src.slice(cursor);
}

function stripFunctionBodies (src) {
  let out = '';
  let cursor = 0;
  FUNCTION_DECL.lastIndex = 0;
  let m;
  while ((m = FUNCTION_DECL.exec(src)) !== null) {
    const open = src.indexOf('{', m.index);
    if (open < 0) return null;
    const close = matchBraces(src, open);
    if (close < 0) return null;
    out += src.slice(cursor, open);
    cursor = close;
    FUNCTION_DECL.lastIndex = close;
  }
  return out + src.slice(cursor);
}

/**
 * 逐字符状态机：注释与「纯文本」写成空格（长度不变，后续花括号配对才不会被内容骗）。
 * 三种必须分清的斜杠/引号：
 *   ① `//` 与 `/*` 是注释；
 *   ② `'` 与 `"` 是串，整段剥；
 *   ③ 反引号是模板串，**正文剥、`${}` 插值段保留** —— 插值里是真会执行的代码。
 *      （这一条不是"更聪明"，是实测：真 vendor 全文到处是 `${}`，整段剥掉会让行为档
 *       在任何装了引擎的机器上永久只剩结构一路，而那正是本刀要修的反面。）
 *   ④ 裸 `/` 要分「正则 / 除号」：前一个有意义字符若是值的结尾（`)`、词字符、`]`、`}`）就是除号，
 *      否则按正则字面量吃掉到下一个未转义 `/`。判错方向两头都会错：把 `a / b` 当正则起点会一路吃到
 *      行尾、把真代码吞掉；漏判正则则 `/main();/` 这种假调用会被当真代码。
 * 任一形态剥不动（块注释不闭合、串/正则跨行不闭合、插值花括号配不平）⇒ 返回 -1，调用方走保守侧。
 */
function stripCommentsAndStrings (src) {
  const a = src.split('');
  if (walkRegion(a, 0, a.length) < 0) return null;
  return a.join('');
}

/** 在 [from,to) 区间内扫描；返回下一个待读下标，剥不动返回 -1。插值段用同一个函数递归。 */
function walkRegion (a, from, to) {
  let prev = '';
  let i = from;
  const blank = (x, y) => { for (let k = x; k < y && k < to; k++) if (a[k] !== '\n' && a[k] !== '\r') a[k] = ' '; };
  while (i < to) {
    const ch = a[i];
    if (ch === '/' && a[i + 1] === '/') {
      let j = a.indexOf('\n', i);
      if (j < 0 || j > to) j = to;
      blank(i, j);
      i = j;
      continue;
    }
    if (ch === '/' && a[i + 1] === '*') {
      // a 是**字符数组**，indexOf('*/') 永远找不到（两字符的串不是数组元素）—— 逐字符配对扫。
      let j = i + 2;
      while (j + 1 < to && !(a[j] === '*' && a[j + 1] === '/')) j++;
      if (j + 1 >= to) return -1;
      blank(i, j + 2);
      i = j + 2;
      continue;
    }
    if (ch === '"' || ch === "'") {
      const end = closeQuote(a, i, to);
      if (end < 0) return -1;
      blank(i, end);
      prev = ch;
      i = end;
      continue;
    }
    if (ch === '`') {
      const end = skipTemplate(a, i, to);
      if (end < 0) return -1;
      prev = '`';
      i = end;
      continue;
    }
    if (ch === '/' && !/[)\w\]}]/.test(prev)) {
      const end = closeRegex(a, i, to);
      if (end < 0) return -1;
      blank(i, end);
      prev = '/';
      i = end;
      continue;
    }
    if (!/\s/.test(ch)) prev = ch;
    i++;
  }
  return i;
}

/** 串：返回闭合引号**之后**的下标；区间内不闭合返回 -1。 */
function closeQuote (a, i, to) {
  const q = a[i];
  let j = i + 1;
  while (j < to && a[j] !== q) { if (a[j] === '\\') j++; j++; }
  return j < to ? j + 1 : -1;
}

/** 正则字面量（含尾部 flag 字母）：跨行不闭合返回 -1。 */
function closeRegex (a, i, to) {
  let j = i + 1;
  let inClass = false;
  while (j < to) {
    const c = a[j];
    if (c === '\n') return -1;
    if (c === '\\') { j += 2; continue; }
    if (c === '[') inClass = true;
    else if (c === ']') inClass = false;
    else if (c === '/' && !inClass) {
      j++;
      while (j < to && /[a-z]/.test(a[j])) j++;
      return j;
    }
    j++;
  }
  return -1;
}

/** 模板串：反引号之间正文空格，`${ ... }` 整段（含花括号）原样保留并递归扫一遍。 */
function skipTemplate (a, i, to) {
  a[i] = ' ';
  let j = i + 1;
  while (j < to && a[j] !== '`') {
    if (a[j] === '\\') { a[j] = ' '; if (j + 1 < to && a[j + 1] !== '\n' && a[j + 1] !== '\r') a[j + 1] = ' '; j += 2; continue; }
    if (a[j] === '$' && a[j + 1] === '{') {
      const close = matchBraces(a, j + 1);
      if (close < 0 || close > to) return -1;
      if (walkRegion(a, j + 2, close - 1) < 0) return -1;
      j = close;
      continue;
    }
    a[j] = a[j] === '\n' || a[j] === '\r' ? a[j] : ' ';
    j++;
  }
  if (j >= to) return -1;
  a[j] = ' ';
  return j + 1;
}

/** 从 openIdx 处的 `{` 起配对，返回闭合括号**之后**的下标；配不平返回 -1。 */
function matchBraces (s, openIdx) {
  let d = 0;
  for (let k = openIdx; k < s.length; k++) {
    if (s[k] === '{') d++;
    else if (s[k] === '}') { d--; if (d === 0) return k + 1; }
  }
  return -1;
}

/** 返回第一处 main **被调用**的下标；跳过函数声明自身的括号；找不到返回 -1。 */
function findMainCall (s) {
  MAIN_CALL.lastIndex = 0;
  let m;
  while ((m = MAIN_CALL.exec(s)) !== null) {
    const head = s.slice(Math.max(0, m.index - 24), m.index);
    if (/\bfunction\s+$/.test(head)) continue;
    return m.index;
  }
  return -1;
}

function driverLoadability (driverSrc) {
  if (typeof driverSrc !== 'string' || driverSrc.trim() === '') return { loadable: false, reason: 'unreadable' };
  const region = nonGuardedTopLevelRegion(driverSrc);
  if (region === null) return { loadable: false, reason: 'unparsable-driver' }; // 认不出形态 ⇒ 保守侧，但成因与「看见裸调用」不同
  if (findMainCall(region) >= 0) return { loadable: false, reason: 'executes-on-require' };
  if (!/\bmodule\.exports\b/.test(driverSrc)) return { loadable: true, reason: 'no-exports' };
  return { loadable: true, reason: 'ok' };
}

/**
 * ② 的行为交叉验证：直接**调** vendor 导出的 `blockingFromAdjudication`（本文件不执行它，由调用方注入）。
 * 两份合成裁决唯一差别是那条 upheld 有没有处置凭证：
 *   无凭证 ⇒ 必须计阻断（否则"随便填两格"就能收口）
 *   有凭证 ⇒ 计不计阻断，就是这条出口在不在 —— 答案不同才算在位。
 * 为什么不留给结构读法单独说话：那个函数长什么样不重要，**它答什么**才决定一条 PR 会不会被永久钉住。
 *
 * 凭证带**两份形状**（QM-6 第一轮评审 i2/i5 逼出来的修正）：
 *   `externalReview.{performedBy,evidenceRef,reviewedAt}` —— vendor **今天真的认**的那一份
 *     （高危域那条出口就读它，见 `externalReviewReceiptLive` 的正控）；
 *   `resolution.{resolvedBy,verifiedBy,verifiedAt}` —— 假想中"给 upheld 补一臂"会读的那一份。
 * 只写后者是本模块最初版的错：那份键名 vendor 从未读过，于是"带凭证仍阻断"这句话
 * 是在拿一份**没有任何分支会消费的形状**做测量 —— 读数为 false 是碰巧对，不是量出来的。
 * @param {Function|undefined|null} fn vendor 的 blockingFromAdjudication
 * @returns {boolean|'unavailable'} 'unavailable' = 拿不到函数（CI 上没有 vendor），不得读成 false
 */
const RECEIPT_EXTERNAL = {
  // 形状夹具，不是真凭证：EXTERNAL_EVIDENCE_RE 只判 URL 形状，vendor 自己也不联网核真伪。
  // 用本仓真 URL + 不存在的评论号，是为了让"这是合成的"在源码里一眼可见（编一个像真号的 id 才是隐患）。
  performedBy: 'claude',
  evidenceRef: 'https://github.com/Colinchiu007/mulpub/pull/0#issuecomment-0',
  reviewedAt: '2026-10-23T00:00:00.000Z',
};
const RECEIPT_RESOLUTION = {
  resolvedBy: 'deadbeefdeadbeefdeadbeefdeadbeefdeadbeef',
  verifiedBy: 'scripts/qm6-exit-capabilities.test.js',
  verifiedAt: '2026-10-23T00:00:00.000Z',
};

function mkAdj (itemOverrides) {
  return {
    items: [Object.assign({
      id: 'i1', severity: 'Warning', verdict: 'upheld', highRiskDomains: [], finding: 'f',
    }, itemOverrides || {})],
    requiresExternalReview: [], expectedExternalBackend: 'claude', confidenceWeight: 0.6,
  };
}

function asBlocking (fn, adj, label) {
  const out = fn(adj);
  if (!Array.isArray(out)) throw new Error('blockingFromAdjudication 在' + label + '那份返回值不是数组，行为档无从比较');
  return out;
}

/**
 * 正控：vendor 自己声明的那份凭证（`externalReview` 三格）在**高危域那条**上必须真的能解除阻断。
 * 这一格的意义全在"正控"两个字：它证明本模块写的那份形状**确实被某个分支消费**。
 * 没有它，"带凭证仍阻断"可能只是"我写的键没人读"，而这两种情况在 false 这个读数上完全同形。
 * @returns {boolean|'unavailable'}
 */
function externalReviewReceiptLive (fn) {
  if (typeof fn !== 'function') return 'unavailable';
  const out = asBlocking(fn, mkAdj({ highRiskDomains: ['crypto'], externalReview: RECEIPT_EXTERNAL }), '正控');
  return out.length === 0;
}

/**
 * @param {Function|undefined|null} fn vendor 的 blockingFromAdjudication
 * @param {{receiptLive?: boolean|'unavailable'}} [opts] 正控读数；为 false 时本函数**拒绝**给结论
 *   （凭证没被任何分支消费过时，"没有出口"这个读数什么也没测 —— 报 unavailable 比报 false 诚实）
 */
function upheldExitBehavioral (fn, opts) {
  if (typeof fn !== 'function') return 'unavailable';
  const bare = asBlocking(fn, mkAdj(null), '无凭证');
  const receipted = asBlocking(fn,
    mkAdj({ externalReview: RECEIPT_EXTERNAL, resolution: RECEIPT_RESOLUTION }), '带凭证');
  if (bare.length === 0) throw new Error('无凭证那份居然不阻断 ⇒ 这条出口没有"缺一格即拦"的防呆，不得判在位');
  if (opts && opts.receiptLive === false) return 'unavailable';
  return receipted.length === 0;
}

/**
 * ③ 的行为交叉验证：喂两个"两版实现答案必须不同"的写回器源码给同一个结构读法，
 * 只有一条真跑路径可选（applyWriteback 会写文件），故 ③ 以源码形状为准 + 由契约锁的夹具保证区分度。
 */
/** 顶层函数体的括号配对切片；配不平返回 null（调用方按"取不到数"处理，不得当成"没有出口"）。 */
function sliceFunctionBody (srcFromKeyword) {
  return sliceBlock(srcFromKeyword);
}

/** 从第一个 `{` 起做括号配对；输入不含 `{` 或配不平均返回 null。 */
function sliceBlock (src) {
  if (typeof src !== 'string' || src === '') return null;
  const open = src.indexOf('{');
  if (open < 0) return null;
  let depth = 0;
  for (let i = open; i < src.length; i++) {
    const c = src[i];
    if (c === '{') depth++;
    else if (c === '}') { depth--; if (depth === 0) return src.slice(open, i + 1); }
  }
  return null;
}

/**
 * 结构读法与行为真跑的交叉比较。放这里而不是放探针里，是为了让它**在 CI 上也可测**：
 * 探针里那段依赖 vendor 是否存在，而这个函数只吃两个值 —— 四种组合都能喂夹具。
 * @returns {{ok:boolean, note:string}} 不一致即不 ok（调用方据此 rc=1），'unavailable' 单独一档、不算不一致
 */
function crossCheckUpheld (structural, behavioral, skipReason) {
  // 跳过成因必须如实带出来：把 `executes-on-require` 报成 `no-vendor` 是合并成因，
  // 读的人会以为"这台机器没装引擎"，而实情是"装了但一 require 就会把别人的流水线跑进本进程"。
  if (behavioral === 'unavailable') return { ok: true, note: 'behavioral=skipped(' + (skipReason || 'no-vendor') + ')' };
  if (structural === 'unknown') return { ok: true, note: 'structural=unknown（不参与比较，也不得被比较结果改成结论）' };
  if (structural !== behavioral) {
    return { ok: false, note: `结构读法=${structural} 而真跑=${behavioral} ⇒ 两条路对同一条出口给出不同答案，读数不可信（结构谓词要重做）` };
  }
  return { ok: true, note: structural ? '两路一致：这条出口在位' : '两路一致：这条出口不在位' };
}

/** 三格一起读，返回**读数**而不是结论；结论由 `conclusionLine` 按读数生成。 */
function readCapabilities (sources, readers) {
  const s = sources || {};
  // 读法可注入：不是为"可测而加钩子"，而是因为这条聚合层唯一的价值就是"三档不变量"，
  // 而不变量只能在**坏返回值**上被证明（把下面这道检查改成恒过，本仓没有第二条路会发现）。
  const r = Object.assign({ externalReviewCapable, upheldExitCapable, toolSignatureCapable }, readers || {});
  const externalReview = r.externalReviewCapable(s.driverSrc);
  const upheld = r.upheldExitCapable(s.driverSrc);
  const toolSignature = r.toolSignatureCapable(s.writebackSrc);
  for (const [k, v] of Object.entries({ externalReview, upheld, toolSignature })) {
    if (!NOVEL.has(String(v))) throw new Error(`谓词 ${k} 返回了非三档值：${JSON.stringify(v)}（实现坏了，不是没有出口）`);
  }
  return {
    externalReview, upheld, toolSignature,
    unknown: [externalReview, upheld, toolSignature].filter((v) => v === 'unknown').length,
    readFrom: { driver: s.driverPath || null, writeback: s.writebackPath || null },
  };
}

/**
 * 结论行生成器：每一条分句都必须能追溯到一个布尔，否则它就是下一个"vendor 改了而这里恒绿"的漂移源。
 * 'unknown' 单独成一档措辞 —— 把"读不出"写成"没有出口"就是本次要防的那类假话。
 */
function conclusionLine (caps) {
  const c = caps || {};
  const phrase = (v, yes, no, unknown) => (v === 'unknown' ? unknown : (v === true ? yes : no));
  return [
    phrase(c.externalReview,
      '高危域条目：填齐外部复核三格后可解除（vendor 已能表达）',
      '高危域条目：self-play 内无出口',
      '高危域条目：读不出（vendor 缺席或被改名，不得当成无出口）'),
    phrase(c.upheld,
      '；upheld 条目：带处置凭证可解除',
      '；诚实标 upheld ⇒ 永久阻断（机制缺口，非本 PR 缺陷）',
      '；upheld 条目：读不出（不得当成无出口）'),
    phrase(c.toolSignature,
      '；工具署名：自扮演收口可署 tier',
      '；工具署名：自扮演收口永拿不到 tier=external（须人工补字段或全驳回）',
      '；工具署名：读不出（写回器形状变了）'),
  ].join('');
}

module.exports = {
  externalReviewCapable, upheldExitCapable, toolSignatureCapable,
  upheldExitBehavioral, externalReviewReceiptLive, crossCheckUpheld,
  readCapabilities, conclusionLine, sliceFunctionBody, sliceBlock,
  mkAdj, RECEIPT_EXTERNAL, RECEIPT_RESOLUTION,
  driverLoadability, BEHAVIORAL_SKIP_REASONS, isBehavioralSkip, nonGuardedTopLevelRegion,
};
