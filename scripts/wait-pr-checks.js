/**
 * PR 事件投递等待器（workaround，非门禁）
 *
 * 背景（2026-10-14 实测，22 个 PR 的统计）：
 *   GitHub Actions 的 `pull_request` 事件投递会延迟甚至丢失，与队列积压、commit 数、
 *   创建方式均无关。22 个样本里 7 个（32%）延迟，从 +167s 到 +7264s（2 小时）不等；
 *   其余 14 个为 5-8 秒正常。
 *   实测排除了三类归因：
 *     - 队列积压：延迟时段内全仓库零 in_progress / 零 queued；
 *     - webhook / App：仓库唯一 webhook 只订阅 push 且 last_response=200，无 App 安装；
 *     - 配置缺失：8 个 workflow 全有 pull_request 触发，concurrency group 互不干扰。
 *   附带规律：`head_ref_force_pushed` 的投递远比 `opened` 可靠（实测 5 秒内触发）。
 *
 * 因此「gh pr checks 报 no checks」≠ 未触发，≠ 门禁故障 —— 它只说明事件还没投递到。
 * 本脚本把"一次性查询"换成"轮询到有产物或超时"，让合并判据 2
 * （gh pr checks <n> 零 pending、零 fail）建立在真实证据上。
 *
 * 用法：
 *   node scripts/wait-pr-checks.js <pr> [--timeout-min 90] [--interval-sec 60]
 *
 * 退出码：
 *   0 = 已见到 checks 产物（零 pending / 零 fail）
 *   1 = 见到产物但存在 pending 或 fail
 *   2 = 超时仍无任何 checks 产物（此时才考虑 workflow_dispatch 手动触发）
 *
 * 注意：本脚本只做"等"，不做判定替代 —— 真正的合并判据仍以 gh pr checks 的输出为准。
 */
const { execFileSync } = require('child_process');

/**
 * 同步睡眠 ms 毫秒（不依赖外部命令）。
 *
 * 原先用 `execSync('powershell -NoProfile -Command "Start-Sleep …"')`，两个问题
 * （外部评审 i5 指出）：① 只在 Windows 有 powershell，Linux/macOS 上直接失败；
 * ② 每次睡眠都起一整个 PowerShell 进程，代价远大于睡眠本身。
 * `Atomics.wait` 是纯 JS 的同步阻塞，跨平台、零子进程。
 */
function sleepSync(ms) {
  if (ms <= 0) return;
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
}

/**
 * 跑 gh，**参数数组**形式（外部评审 i4：原先是 `execSync('gh ' + args)` 字符串拼接，
 * 凡拼接就迟早遇上需要引号/含空格的参数，而 shell 会把它们解释掉；execFile 不经 shell）。
 *
 * 返回 `{ ok, stdout, stderr, status }` —— **不吞退出码**（外部评审 i8：原先 ghQuiet 把
 * 失败一律吞成空输出，于是「gh 本身跑不成」和「事件还没投递」被压成同一格，都是"无产物"，
 * 结果是 gh 未登录 / PR 号不存在这类**真故障**会被当成"再等等就好"，一路空转到超时）。
 */
function gh(args) {
  try {
    const stdout = execFileSync('gh', args, {
      maxBuffer: 1e8, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'],
    });
    return { ok: true, stdout, stderr: '', status: 0 };
  } catch (e) {
    return {
      ok: false,
      stdout: e && e.stdout ? e.stdout : '',
      stderr: e && e.stderr ? e.stderr : '',
      status: e && typeof e.status === 'number' ? e.status : -1,
    };
  }
}

/**
 * 「gh 说没有任何 checks」的正常形态：`gh pr checks` 在无产物时以非 0 退出并在 stderr
 * 说明"no checks reported"。这是**事件还没投递到**，应当继续等，不是故障。
 */
function saysNoChecks(res) {
  return /no checks reported/i.test(res.stderr || '') || /no checks reported/i.test(res.stdout || '');
}

const pr = process.argv[2];
if (!pr || !/^\d+$/.test(pr)) {
  console.error('用法: node scripts/wait-pr-checks.js <pr号> [--timeout-min 90] [--interval-sec 60]');
  process.exit(2);
}

let timeoutMin = 90;
let intervalSec = 60;
for (let i = 3; i < process.argv.length; i++) {
  const flag = process.argv[i];
  if (flag !== '--timeout-min' && flag !== '--interval-sec') {
    console.error(`未知参数: ${flag}`);
    process.exit(2);
  }
  const raw = process.argv[++i];
  const n = Number(raw);
  // ⚠ parseInt 会接受 '60abc'（→60）而 Number 更严格；两者都要排除 NaN / 非正数 / 非有限值。
  // 否则 timeoutMin=NaN ⇒ deadline=NaN ⇒ `Date.now() < NaN` 恒假 ⇒ 立刻报"超时"退出 2，
  // 把"参数写错了"伪装成"事件投递超时"（外部评审 i4 指出）。
  if (!Number.isFinite(n) || !Number.isInteger(n) || n <= 0) {
    console.error(`${flag} 需要正整数，收到 ${JSON.stringify(raw)}`);
    process.exit(2);
  }
  if (flag === '--timeout-min') timeoutMin = n;
  else intervalSec = n;
}

const deadline = Date.now() + timeoutMin * 60 * 1000;
let attempt = 0;

function poll() {
  attempt++;
  // 字段名以 gh 实际支持为准：gh pr checks --json 只有 bucket/completedAt/description/event/
  // link/name/startedAt/state/workflow，没有 conclusion（请求它会直接报错退出）。
  const res = gh(['pr', 'checks', String(pr), '--json', 'name,state,bucket,startedAt,completedAt']);
  const out = (res.stdout || '').trim();

  let checks = null;
  try { checks = JSON.parse(out); } catch { checks = null; }
  if (!Array.isArray(checks)) checks = null;

  const stamp = new Date().toISOString().replace('T', ' ').substring(0, 19);

  // ⚠ 三态必须分开（外部评审 i8）：
  //   ① 解析出数组（含空数组）      → 用它
  //   ② gh 明说"no checks reported" → 事件还没投递到，继续等（这是本脚本存在的原因）
  //   ③ 其它（gh 跑不成 / 输出不是 JSON）→ **判据故障，立刻退出**，不许读成"无产物"
  // 原实现在 ③ 上也返回 []，于是 gh 未登录、PR 号打错、网络断了都会被当成"再等等"，
  // 一路空转到超时才报"事件投递延迟"—— 把工具故障伪装成被观测对象的现象。
  if (checks === null) {
    if (saysNoChecks(res)) {
      console.log(`[${stamp}] #${attempt} 无 checks 产物（事件未投递或仍在投递中），${intervalSec}s 后重试…`);
      return false;
    }
    console.error(`[判据故障] gh 没能给出可解析的 checks 列表（exit=${res.status}）。`);
    console.error('  这不是「事件未投递」，是 gh 本身跑不成 —— 常见原因：未登录、PR 号不存在、网络不通、gh 版本过旧。');
    const hint = (res.stderr || res.stdout || '').trim();
    if (hint) console.error('  gh 说：' + hint.split('\n').slice(0, 3).join(' / '));
    process.exit(2);
  }

  if (checks.length === 0) {
    console.log(`[${stamp}] #${attempt} 无 checks 产物（事件未投递或仍在投递中），${intervalSec}s 后重试…`);
    return false;
  }

  // gh 的 state 取值：SUCCESS / FAILURE / PENDING / SKIPPED / CANCELLED / STARTUP_FAILURE 等
  const pending = checks.filter(c => c.state === 'PENDING' || c.state === 'QUEUED' || c.state === 'IN_PROGRESS');
  const failed = checks.filter(c => c.state === 'FAILURE' || c.state === 'STARTUP_FAILURE' || c.state === 'TIMED_OUT');
  console.log(`[${stamp}] #${attempt} 已见到 ${checks.length} 个 checks：pending=${pending.length} fail=${failed.length}`);
  checks.forEach(c => console.log(`    ${String(c.state).padEnd(10)} ${c.name}`));

  if (pending.length > 0) {
    console.log(`  → 仍有 ${pending.length} 个未完成，${intervalSec}s 后重试…`);
    return false;
  }
  if (failed.length > 0) {
    console.log('  → 存在失败项，合并判据不满足');
    process.exit(1);
  }
  console.log('  → 零 pending / 零 fail，合并判据 2 满足');
  return true;
}

console.log(`等待 PR #${pr} 的 checks 产物（超时 ${timeoutMin} 分钟，间隔 ${intervalSec} 秒）`);
console.log('依据：GitHub pull_request 事件投递可能延迟数分钟至 2 小时（实测 32% 发生率）');
console.log('');

while (Date.now() < deadline) {
  if (poll()) process.exit(0);
  if (Date.now() + intervalSec * 1000 >= deadline) break;
  sleepSync(intervalSec * 1000);
}

console.error(`超时（${timeoutMin} 分钟）仍无 checks 产物 —— 这才考虑 workflow_dispatch 手动触发`);
process.exit(2);
