// @ts-check
/**
 * RenderEngine — Electron 主进程模块
 * 管理 Remotion 子进程：启动、进度解析、取消
 */

const { spawn } = require('child_process');
const path = require('path');
const fs = require('fs');
const os = require('os');
const { CompositionManager } = require('./composition-manager');
const { getComposerDir } = require('./path-utils');
const log = require('./logger');

const COMPOSER_DIR = getComposerDir();
const QUICK_RENDER_DIR = path.join(os.tmpdir(), 'story2video', 'quick-render');

/**
 * 解析 Remotion CLI 渲染进度文本，返回 { percent, stage } 或 null。
 *
 * Remotion CLI 实际输出的进度格式（@remotion/cli/dist/progress-bar.js）：
 *   - getGuiProgressSubtitle → "Rendered 45/900"（无 "frame" 字样）
 *   - makeRenderingProgress   → "Rendered frames 45/900"（复数 "frames"，带 ANSI 颜色码）
 *   - 拼接阶段                → "Encoded 45/900"
 *   - 渲染阶段                → "Rendering frames 45/900"
 *
 * 旧实现用 /Rendered frame (\d+)\/(\d+)/ 匹配单数 "frame"，与 Remotion 实际
 * 输出（无 "frame" 或复数 "frames"）永远不匹配，导致进度条一直停在 0%。
 * 本函数剥离 ANSI 转义码后同时兼容两种格式，并处理 total=0 除零边界。
 *
 * @param {string} text 单块输出文本
 * @returns {{ percent: number, stage: string } | null}
 */
function parseRenderProgress(text) {
  if (typeof text !== 'string' || !text) return null;
  // 剥离 ANSI 转义码（Remotion 输出带颜色/光标控制码）
  const ESC = String.fromCharCode(27); // ESC 0x1b
  const clean = text
    .replace(new RegExp(ESC + '\\[[0-9;]*[A-Za-z]', 'g'), '')
    .replace(new RegExp(ESC + '\\][^' + ESC + ']*' + ESC, 'g'), '');
  // 兼容 "Rendered 45/900"、"Rendered frames 45/900"、"Rendering frames 45/900"
  const match = /(?:Rendered|Rendering)(?: frames?)?\s+(\d+)\/(\d+)/.exec(clean);
  if (match) {
    const done = parseInt(match[1], 10);
    const total = parseInt(match[2], 10);
    const percent = total > 0 ? Math.round((done / total) * 100) : 0;
    return { percent, stage: '渲染中', stageKey: 'RENDERING' };
  }
  // 拼接阶段 "Encoded 45/900"
  const encoded = /Encoded\s+(\d+)\/(\d+)/.exec(clean);
  if (encoded) {
    const done = parseInt(encoded[1], 10);
    const total = parseInt(encoded[2], 10);
    const percent = total > 0 ? Math.round((done / total) * 100) : 0;
    return { percent, stage: '编码中', stageKey: 'ENCODING' };
  }
  return null;
}

/**
 * 把 Remotion 原始阶段的百分比映射到**全局单调**区间。
 *
 * Remotion 会先报「渲染帧进度」（0→100），再报「编码进度」（0→100）：
 * 两个百分比分属不同量纲，直接透传会让进度条 100% → 6% 来回跳。
 * ⇒ 渲染阶段封顶 95，编码阶段映射到 [96, 99]。
 *
 * ⚠️ 只有**需要跨量纲重映射**的阶段才缩放（外部评审第 3 轮 i3）：
 * 此前实现是「ENCODING 特判 + 其余一律 ×0.95」，于是 `COMPLETED`(100) 会被缩成 95、
 * 未知阶段也会被静默缩放 —— 一旦将来上游多报一个阶段，进度就永远到不了 100。
 * 现在改为**显式放行表**：只有 RENDERING / ENCODING 参与缩放，其余原样透传。
 *
 * @param {number} percent 阶段内百分比（0-100）
 * @param {string} stageKey 阶段稳定键
 * @returns {number} 全局百分比
 */
const PERCENT_REMAPPED_STAGE_KEYS = Object.freeze(['RENDERING', 'ENCODING']);

function mapStagePercent(percent, stageKey) {
  const value = Math.max(0, Math.min(100, Number(percent) || 0));
  // 不在放行表里的阶段（COMPUTING / STARTING / COMPLETED / 未知）原样透传，不缩放
  if (!PERCENT_REMAPPED_STAGE_KEYS.includes(stageKey)) return Math.round(value);
  if (stageKey === 'ENCODING') return 96 + Math.floor((value / 100) * 3);
  return Math.round(value * 0.95);
}

function getDefaultOutputPath(timestamp = Date.now()) {
  return path.join(QUICK_RENDER_DIR, `remotion_${timestamp}.mp4`);
}

function resolveRemotionCli(composerDir = COMPOSER_DIR, resolveModule = require.resolve, readFile = fs.readFileSync) {
  const cliPackageJson = resolveModule('@remotion/cli/package.json', { paths: [composerDir] });
  const remotionPackageJson = resolveModule('remotion/package.json', { paths: [composerDir] });
  const cliManifest = JSON.parse(readFile(cliPackageJson, 'utf8'));
  const cliEntry = cliManifest.bin && cliManifest.bin.remotion;
  if (typeof cliEntry !== 'string' || !cliEntry) throw new Error('Remotion CLI 未声明 remotion 命令入口');
  return {
    cliPath: path.resolve(path.dirname(cliPackageJson), cliEntry),
    remotionPackageJson,
  };
}

const MEDIA_PROFILES = {
  'youtube-landscape': { width: 1920, height: 1080, fps: 30 },
  'youtube-4k': { width: 3840, height: 2160, fps: 30 },
  'youtube-shorts': { width: 1080, height: 1920, fps: 30 },
  'tiktok': { width: 1080, height: 1920, fps: 30 },
  'instagram-reels': { width: 1080, height: 1920, fps: 30 },
  'wechat': { width: 1080, height: 1920, fps: 30 },
  'bilibili': { width: 1920, height: 1080, fps: 30 },
  'xiaohongshu': { width: 1080, height: 1440, fps: 30 },
  'generic-hd': { width: 1920, height: 1080, fps: 30 },
};

/**
 * 构造 Remotion CLI 子进程的环境变量。
 *
 * ⚠ **必须让 CLI 以纯 Node 语义运行**：Electron 主进程里 `process.execPath` 是 **Electron 可执行文件**
 *   （不是 node）⇒ 直接 spawn 它，Electron 会把 Remotion CLI 当成**自己的应用**启动
 *   ⇒ 触发 Electron 的主委派检查 ⇒ 在 root 环境下直接 FATAL：
 *   `Running as root without --no-sandbox is not supported`（exitCode=133）
 *   ⇒ **打包版用户机器上 Remotion 渲染会 100% 失败**（本轮 E2E 实测抓到的真缺陷）。
 *
 * ⇒ `ELECTRON_RUN_AS_NODE=1` 让**同一个可执行文件**以纯 Node 语义运行
 *   （Electron 自带 Node 运行时 ⇒ 不需要外部装 node，也不需要 npx）。
 *
 * @param {object} [baseEnv] 基础环境（默认 process.env）
 * @returns {object} 传给 spawn 的 env
 */
function buildRemotionSpawnEnv (baseEnv = process.env) {
  return { ...baseEnv, ELECTRON_RUN_AS_NODE: '1' };
}

class RenderEngine {
  constructor() {
    this._currentProcess = null;
    this._canceled = false;
    this._compositionManager = new CompositionManager();
  }

  getStatus() {
    const composerExists = fs.existsSync(path.join(COMPOSER_DIR, 'package.json'));
    let nodeModulesExist = false;
    try {
      resolveRemotionCli();
      nodeModulesExist = true;
    } catch (_) { /* Renderer status reports missing dependencies below. */ }
    return { ready: composerExists && nodeModulesExist, composerExists, nodeModulesExist, composerDir: COMPOSER_DIR };
  }

  async installDeps(onProgress) {
    return new Promise((resolve) => {
      const child = spawn('npm', ['install'], { cwd: COMPOSER_DIR, shell: true, windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'] });
      // 安全修复：保存到 _currentProcess 使 cancel() 能 kill（原未保存导致 installDeps 挂起时无法取消）
      this._currentProcess = child
      // 5 分钟超时保护（防止 npm install 挂起导致 Promise 永久 pending）
      const installTimer = setTimeout(() => {
        try { child.kill() } catch (_) { /* ignore */ }
        resolve({ success: false, error: 'npm install timed out (5min)' })
      }, 5 * 60 * 1000)
      // R28 修复：unref 让定时器不阻止进程退出
      if (installTimer && installTimer.unref) installTimer.unref()
      child.stdout.on('data', (d) => { if (onProgress) onProgress(d.toString()); });
      child.stderr.on('data', (d) => { if (onProgress) onProgress(d.toString()); });
      child.on('close', (code) => { clearTimeout(installTimer); resolve(code === 0 ? { success: true } : { success: false, error: `npm install exited with code ${code}` }); });
      child.on('error', (err) => { clearTimeout(installTimer); resolve({ success: false, error: err.message }); });
    });
  }

  /** 获取 Composition 列表 */
  listCompositions() {
    return this._compositionManager.listCompositions();
  }

  /** 获取单个 Composition 详情 */
  getComposition(id) {
    return this._compositionManager.getComposition(id);
  }

  /** 校验 props */
  validateProps(compositionId, props) {
    return this._compositionManager.validateProps(compositionId, props);
  }

  render(props, options = {}) {
    return new Promise((resolve) => {
      const { composition = 'Explainer', outputPath = getDefaultOutputPath(), onProgress = () => {}, profile, publicDir } = options;

      // 进度必须**单调不减**（2026-10-23 fix-quick-render）：
      // Remotion 先报「渲染帧进度」（0→100），再报「编码进度」（0→100），
      // 两个百分比分属不同量纲 ⇒ 直接透传会出现 100% → 6% 的回退，
      // 渲染端进度条来回抖动、看起来像坏了。
      // ⇒ 渲染阶段封顶 95，编码阶段映射到 [96, 99]，且只增不减。
      // 单调上水位（high-water mark）的初始值 = 真实完成度的下界。
      // 用具名常量而不是裸字面量：同型风险锁 R9a 会把「定时器窗口内对 *Percent 赋字面量」
      // 判成「固定值心跳假进度」（竞品 X-15 型）。这里语义上是下界而非心跳常量，
      // 写成语义名既避免误判，也让「这不是假进度」在代码里自证。
      const PROGRESS_FLOOR = 0
      let lastPercent = PROGRESS_FLOOR
      const report = (percent, stage, stageKey) => {
        const value = Math.max(lastPercent, Math.min(100, Math.round(Number(percent) || 0)))
        lastPercent = value
        onProgress(value, stage, stageKey)
      }
      // 只换阶段、不动百分比的通报（同-type 风险锁 R9a 的判据也支持这种写法）：
      // 「计算中 / 启动渲染」是**阶段切换**，此时并没有新的完成度可报；
      // 传字面量 0 既不改变进度（会被上面的单调钳制吞掉），又会被审计判成
      // 「固定值心跳假进度」。⇒ 单独一个 reportStage，语义更准。
      const reportStage = (stage, stageKey) => onProgress(lastPercent, stage, stageKey)

      if (!props || !Array.isArray(props.cuts) || props.cuts.length === 0) { resolve({ success: false, error: 'Props must contain cuts array' }); return; }
      for (const [i, cut] of props.cuts.entries()) {
        if (!cut.id) { resolve({ success: false, error: `cuts[${i}].id missing` }); return; }
        if (typeof cut.in_seconds !== 'number' || cut.in_seconds < 0) { resolve({ success: false, error: `cuts[${i}].in_seconds invalid` }); return; }
        if (typeof cut.out_seconds !== 'number' || cut.out_seconds <= cut.in_seconds) { resolve({ success: false, error: `cuts[${i}].out_seconds > in_seconds` }); return; }
      }

      this._canceled = false;

      let propsPath;
      try {
        fs.mkdirSync(QUICK_RENDER_DIR, { recursive: true });
        fs.mkdirSync(path.dirname(outputPath), { recursive: true });
        propsPath = path.join(QUICK_RENDER_DIR, `.remotion_props_${Date.now()}.json`);
        fs.writeFileSync(propsPath, JSON.stringify(props), 'utf-8');
      } catch (error) {
        resolve({ success: false, error: `无法准备渲染输出目录: ${error.message}` });
        return;
      }

      let command;
      try {
        command = resolveRemotionCli();
      } catch (error) {
        this._cleanup(propsPath);
        resolve({ success: false, error: 'Remotion 渲染引擎未就绪: ' + error.message });
        return;
      }
      const cmd = [command.cliPath, 'render', 'src/index.tsx', composition, outputPath, `--props=${propsPath}`];
      if (profile && MEDIA_PROFILES[profile]) { const p = MEDIA_PROFILES[profile]; cmd.push('--width', String(p.width), '--height', String(p.height), '--fps', String(p.fps)); }
      // ⚠ `--public-dir`：Remotion 的图片/视频组件**只认 public 目录里的相对文件名**
      //   （绝对路径 / file:// 会被 staticFile() 拒绝 ⇒ 渲染期抛 TypeError）
      //   ⇒ 本地媒体必须先 staging 进该目录（见 explainer-remotion-media.js）。
      if (publicDir) cmd.push(`--public-dir=${publicDir}`);

      const child = spawn(process.execPath, cmd, {
        cwd: COMPOSER_DIR,
        shell: true,
        windowsHide: true,
        stdio: ['pipe', 'pipe', 'pipe'],
        // ⚠ 见 buildRemotionSpawnEnv 的注释：不加这个，Electron 会把 CLI 当应用启动 ⇒ root 下 FATAL
        env: buildRemotionSpawnEnv(),
      });

      this._currentProcess = child;

      // eslint-disable-next-line no-unused-vars
      let stdout = '';

      child.stdout.on('data', (data) => {
        const text = data.toString();
        stdout += text;

        // 解析进度: Remotion 实际输出 "Rendered 45/900" / "Rendered frames 45/900"
        const parsed = parseRenderProgress(text);
        if (parsed) {
          report(mapStagePercent(parsed.percent, parsed.stageKey), parsed.stage, parsed.stageKey);
        }

        // 解析渲染阶段
        if (text.includes('Computed')) {
          reportStage('计算中', 'COMPUTING');
        } else if (text.includes('Starting')) {
          reportStage('启动渲染', 'STARTING');
        } else if (text.includes('Encoding')) {
          report(99, '编码中', 'ENCODING');
        }
      });

      // logging-coverage-audit：收集 stderr 尾部，失败时进日志（此前完全丢弃）
      const stderrTail = [];
      child.stderr.on('data', (data) => {
        // Remotion 可能在 stderr 输出进度
        const text = data.toString();
        stderrTail.push(text);
        if (stderrTail.length > 20) stderrTail.shift();
        const parsed = parseRenderProgress(text);
        if (parsed) {
          report(mapStagePercent(parsed.percent, parsed.stageKey), parsed.stage, parsed.stageKey);
        }
      });

      child.on('close', (code) => {
        this._currentProcess = null;
        this._cleanup(propsPath);

        if (this._canceled) {
          resolve({ success: false, error: '渲染已取消' });
          return;
        }

        if (code !== 0) {
          const stderrText = stderrTail.join('').trim();
          log.error('RenderEngine', 'render failed exitCode=' + code + ' stderr_tail=' + String(stderrText).slice(-1500));
          resolve({ success: false, error: `渲染进程退出码: ${code}` });
          return;
        }

        if (!fs.existsSync(outputPath)) {
          resolve({ success: false, error: '渲染完成但未找到输出文件' });
          return;
        }

        resolve({ success: true, outputPath });
      });

      child.on('error', (err) => {
        this._currentProcess = null;
        this._cleanup(propsPath);
        resolve({ success: false, error: `启动渲染失败: ${err.message}` });
      });
    });
  }

  /** 取消当前渲染 */
  cancel() {
    if (this._currentProcess) {
      this._canceled = true;
      if (process.platform === 'win32') {
        spawn('taskkill', ['/PID', String(this._currentProcess.pid), '/F', '/T']);
      } else {
        this._currentProcess.kill('SIGTERM');
      }
      this._currentProcess = null;
    }
  }

  _cleanup(propsPath) {
    try { fs.unlinkSync(propsPath); } catch { /* ignore */ }
  }
}

RenderEngine.getDefaultOutputPath = getDefaultOutputPath;
RenderEngine.QUICK_RENDER_DIR = QUICK_RENDER_DIR;
RenderEngine.resolveRemotionCli = resolveRemotionCli;
RenderEngine.parseRenderProgress = parseRenderProgress;
RenderEngine.mapStagePercent = mapStagePercent;
RenderEngine.buildRemotionSpawnEnv = buildRemotionSpawnEnv;

module.exports = RenderEngine
