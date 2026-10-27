#!/usr/bin/env node
// @ts-check
/**
 * e2e-run-remotion.js — P5a 的端到端验收运行器（沙箱版）
 *
 * 一次性拉起：Xvfb → 本地 Provider 桩 → 桌面端（vite + electron + CDP）→ 跑 animated-explainer-cdp.js
 *
 * ⚠ 为什么不用仓库自带的脚本：仓库的 `tests/e2e/animated-explainer-cdp.js` 假设「应用已经跑起来了」，
 *   沙箱里要自己把 Xvfb / provider 桩 / dev.js 拼起来。
 * ⚠ 端口：worktree 的 dev 端口由 `resolveDevPorts(repoRoot)` 按路径派生 ⇒ 这里先问它，不猜。
 */

'use strict'

const path = require('path')
const fs = require('fs')
const os = require('os')
const { spawn, execFile, execFileSync } = require('child_process')
const { promisify } = require('util')

const execFileAsync = promisify(execFile)
// __dirname = <repo>/apps/desktop/tests/e2e
const DESKTOP_DIR = path.resolve(__dirname, '..', '..')
const REPO_ROOT = path.resolve(__dirname, '..', '..', '..', '..')
const { resolveDevPorts } = require(path.join(DESKTOP_DIR, 'scripts/dev-ports.js'))
const ports = resolveDevPorts(REPO_ROOT)

const DISPLAY = process.env.E2E_DISPLAY || ':99'
const LLM_PORT = Number(process.env.E2E_LLM_PORT || 8787)
const IMAGE_PORT = Number(process.env.E2E_IMAGE_PORT || 7860)
const OUT_DIR = process.env.E2E_OUT_DIR || path.join(os.tmpdir(), 'explainer-out-p5a')
const PROFILE_DIR = process.env.E2E_PROFILE_DIR || path.join(os.tmpdir(), 'mp-profile-p5a')
const RESOLUTION = process.env.E2E_RESOLUTION || '1280x720'

function log (...args) { console.log('[e2e-remotion]', ...args) }
function sleep (ms) { return new Promise(r => setTimeout(r, ms)) }

async function waitForHttp (url, timeoutMs = 60000) {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    try {
      const res = await fetch(url)
      if (res.status < 500) return true
    } catch (_) { /* retry */ }
    await sleep(1000)
  }
  return false
}

async function waitForCdp (port, timeoutMs = 180000) {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    try {
      const res = await fetch('http://127.0.0.1:' + port + '/json/version')
      if (res.ok) return true
    } catch (_) { /* retry */ }
    await sleep(1500)
  }
  return false
}

/**
 * 造一份「项目根替身」，只把 `config/identity-public.json` 的身份开关关掉。
 *
 * ⚠ **为什么不能直接改仓库里的 config 文件**：它是**版本控制内的文件**，
 *   改了不还原就会被提交进 PR（而且 `identityAuthEnabled` 是安全相关开关）。
 * ⚠ **为什么不能用环境变量**：`identity-runtime-config.js` 的 `CONFIG_ENV_OVERRIDE_KEYS`
 *   **刻意排除了 `IDENTITY_AUTH_ENABLED`** ⇒ 配置文件优先于 env ⇒ env 改不动。
 * ⚠ **用 `MULTI_PUBLISH_ROOT` 换根**：`path-utils.js` 的 `getProjectRoot()` 认这个 env
 *   ⇒ `getConfigPath()` 就会去替身根里找 config ⇒ 仓库文件一个字节都不动。
 */
function prepareRootOverride () {
  const overrideRoot = path.join(os.tmpdir(), 'mp-root-override')
  fs.rmSync(overrideRoot, { recursive: true, force: true })
  fs.mkdirSync(path.join(overrideRoot, 'config'), { recursive: true })
  // 大目录用软链（不复制）
  for (const dir of ['packages', 'apps', 'scripts', 'node_modules', '01-docs', 'openspec', 'resources']) {
    const src = path.join(REPO_ROOT, dir)
    if (!fs.existsSync(src)) continue
    try { fs.symlinkSync(src, path.join(overrideRoot, dir), 'junction') } catch (_) { /* ignore */ }
  }
  // config：逐个文件复制；identity-public.json 改两个开关
  const configDir = path.join(REPO_ROOT, 'config')
  if (fs.existsSync(configDir)) {
    for (const name of fs.readdirSync(configDir)) {
      const src = path.join(configDir, name)
      let st
      try { st = fs.statSync(src) } catch (_) { continue }
      if (!st.isFile()) continue
      const dst = path.join(overrideRoot, 'config', name)
      if (name === 'identity-public.json') {
        const json = JSON.parse(fs.readFileSync(src, 'utf8'))
        json.identityAuthEnabled = false
        json.identityAuthRequired = false
        fs.writeFileSync(dst, JSON.stringify(json, null, 2) + '\n', 'utf8')
      } else {
        fs.copyFileSync(src, dst)
      }
    }
  }
  return overrideRoot
}

async function main () {
  fs.mkdirSync(OUT_DIR, { recursive: true })
  fs.mkdirSync(PROFILE_DIR, { recursive: true })

  // ---- 1) Xvfb ----
  // ⚠ **必须先清残留**：上一轮跑完时 Xvfb 可能变成僵尸（容器 PID 1 不回收），
  //   而 `/tmp/.X11-unix/X99` 的残留 socket 会让新的 Xvfb 起不来
  //   ⇒ 表现为 Electron 报「Missing X server or $DISPLAY」，**与代码无关**。
  // ⚠ 用 `pkill -x Xvfb`（精确匹配进程名），不要用 `pkill -f`（会匹配到自己的命令行）。
  try { execFileSync('pkill', ['-x', 'Xvfb']) } catch (_) { /* 没有残留就忽略 */ }
  await sleep(800)
  for (const stale of ['/tmp/.X11-unix/X' + DISPLAY.replace(':', ''), '/tmp/.X' + DISPLAY.replace(':', '') + '-lock']) {
    try { fs.rmSync(stale, { force: true }) } catch (_) { /* ignore */ }
  }
  log('Xvfb :', DISPLAY)
  const xvfb = spawn('Xvfb', [DISPLAY, '-screen', '0', '1280x1024x24', '-nolisten', 'tcp'], {
    stdio: ['ignore', 'ignore', 'pipe'], detached: true,
  })
  xvfb.stderr.on('data', d => log('[xvfb!] ' + String(d).trim()))
  // ⚠ 起没起来**要验**（socket 文件出现）⇒ 否则 Electron 会报「Missing X server」而根因被藏住
  const xvfbSock = '/tmp/.X11-unix/X' + DISPLAY.replace(':', '')
  let xvfbReady = false
  for (let i = 0; i < 30; i++) {
    if (fs.existsSync(xvfbSock)) { xvfbReady = true; break }
    await sleep(500)
  }
  if (!xvfbReady) throw new Error('Xvfb 未就绪（socket 未出现）：' + xvfbSock)

  // ---- 2) 本地 Provider 桩 ----
  const { LocalProviderHub } = require(path.join(DESKTOP_DIR, 'tests/e2e/lib/local-provider-hub.js'))
  const hub = new LocalProviderHub({
    copyPath: path.join(DESKTOP_DIR, 'tests/e2e/fixtures/explainer-copy.json'),
    llmPort: LLM_PORT,
    imagePort: IMAGE_PORT,
    log,
  })
  await hub.start()
  log('provider 桩就绪')

  // ---- 3) 桌面端（vite + electron） ----
  const rootOverride = prepareRootOverride()
  log('项目根替身（身份开关已关）：', rootOverride)
  const devEnv = {
    ...process.env,
    DISPLAY,
    MULTI_PUBLISH_ROOT: rootOverride,
    MP_E2E_SOFTWARE_GPU: '0',
    MP_ELECTRON_PASSWORD_STORE: 'basic',
    ELECTRON_USER_DATA_DIR: PROFILE_DIR,
    MP_ELECTRON_USER_DATA_DIR: PROFILE_DIR,
    // ⚠ **身份服务必须显式关掉**：`license-access-control.js` 的 `getAccessLevel`
    //   在「身份服务存在」时只认 `authenticated`/`offline_authenticated` 状态
    //   ⇒ 沙箱里没有登录态 ⇒ `model-provider:update` 被 -3 AUTH_REQUIRED 拦下
    //   ⇒ E2E 连 provider 桩都配不上。
    //   关掉身份服务后走「未打包 ⇒ admin」这条既有分支（`getAccessLevel` 的 dev 短路）。
    // ⚠ 两个都要给：`IDENTITY_AUTH_REQUIRED=true` + `IDENTITY_AUTH_ENABLED=false`
    //   会被 `identity-runtime-config.js` 判为非法配置。
    IDENTITY_AUTH_ENABLED: 'false',
    IDENTITY_AUTH_REQUIRED: 'false',
  }
  const dev = spawn(process.execPath, [path.join(DESKTOP_DIR, 'scripts/dev.js')], {
    cwd: DESKTOP_DIR,
    env: devEnv,
    stdio: ['ignore', 'pipe', 'pipe'],
  })
  dev.stdout.on('data', d => process.stdout.write('[dev] ' + d))
  dev.stderr.on('data', d => process.stderr.write('[dev!] ' + d))

  try {
    log('等待 vite :', ports.vite)
    const viteUp = await waitForHttp('http://127.0.0.1:' + ports.vite + '/')
    if (!viteUp) throw new Error('vite 未起来')
    log('等待 CDP :', ports.cdp)
    const cdpUp = await waitForCdp(ports.cdp)
    if (!cdpUp) throw new Error('CDP 未起来')

    // ---- 4) 跑 E2E ----
    const e2eArgs = [
      path.join(DESKTOP_DIR, 'tests/e2e/animated-explainer-cdp.js'),
      '--cdp-port=' + ports.cdp,
      '--vite-port=' + ports.vite,
      '--llm-base-url=http://127.0.0.1:' + LLM_PORT + '/v1',
      '--image-base-url=http://127.0.0.1:' + IMAGE_PORT,
      '--out-dir=' + OUT_DIR,
      '--runs=1',
      // ⚠ 审批门相关开关的透传（否则只能跑默认的 api 模式 + remotion）：
      //   E2E_MODE=ui             ⇒ 走真实 UI 按钮启动（**只有这条路渲染层才持有 run** ⇒ 弹窗 DOM 才会出现）
      //   E2E_APPROVAL_RUNTIME=ffmpeg ⇒ G1 选**非默认**的渲染引擎
      //     ⇒ 否则测不出「门批准后阶段重跑把用户选择冲回默认值」（默认 remotion ⇒ 冲掉后仍相同 ⇒ 断言恒真）
      '--mode=' + (process.env.E2E_MODE || 'api'),
      '--approval-runtime=' + (process.env.E2E_APPROVAL_RUNTIME || 'remotion'),
      '--resolution=' + RESOLUTION,
      '--timeout-ms=' + (Number(process.env.E2E_TIMEOUT_MS) || 5400000),
    ]
    log('E2E 开始 …')
    // ⚠ 用 spawn + 继承 stdio（不是 execFile 捕获）：捕获模式下进程崩了可能什么都拿不到，
    //   而 E2E 的失败原因恰恰在它的 stdout 里。
    const exitCode = await new Promise((resolve) => {
      const child = spawn(process.execPath, e2eArgs, {
        cwd: DESKTOP_DIR,
        env: devEnv,
        stdio: ['ignore', 'pipe', 'pipe'],
      })
      child.stdout.on('data', d => process.stdout.write('[e2e] ' + d))
      child.stderr.on('data', d => process.stderr.write('[e2e!] ' + d))
      child.on('close', code => resolve(code === null ? 1 : code))
      child.on('error', err => { log('E2E 启动失败：' + err.message); resolve(1) })
    })
    if (exitCode !== 0) throw new Error('E2E 退出码 ' + exitCode)
    log('E2E 结束')
  } finally {
    try { dev.kill('SIGTERM') } catch (_) { /* ignore */ }
    await sleep(3000)
    try { dev.kill('SIGKILL') } catch (_) { /* ignore */ }
    try { await hub.stop() } catch (_) { /* ignore */ }
    try { process.kill(-xvfb.pid, 'SIGKILL') } catch (_) { /* ignore */ }
    try { xvfb.kill('SIGKILL') } catch (_) { /* ignore */ }
  }
}

main().catch((error) => {
  console.error('[e2e-remotion] 失败：', error && error.stack ? error.stack : error)
  process.exit(1)
})
