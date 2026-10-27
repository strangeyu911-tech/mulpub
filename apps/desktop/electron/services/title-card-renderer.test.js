// @ts-check
/**
 * title-card-renderer 单测（node --test 风格，vitest 收集）
 *
 * 锁的核心契约是**标题安全区**：合成引擎默认动效 zoom-in 会把画面放大到 1.25 倍
 * 居中裁切，左右各裁 10% ⇒ 文字距边不足就会被**无声地切掉**
 * （实测：占位图的「好消息是」在成片里变成「消息是」，成片不报错、不降级、只是少字）。
 * 这个缺陷在流水线上没有任何断言能看见，所以在这里用纯函数层面钉死。
 */
'use strict'

const fs = require('fs')
const os = require('os')
const path = require('path')

const {
  renderTitleCard,
  computeCardLayout,
  wrapText,
  normalizeOptions,
  escapeDrawtextText,
  THEMES,
  SAFE_MARGIN_RATIO,
} = require('./title-card-renderer')

// 当场实测（插入本块之后）：本文件裸 it( 共 26 处，全部属非渲染组；棘轮只能缩小
const BARE_IT_MSG = '裸 it( 计数从 26 涨到 '
const BARE_IT_CAP = 26
const { findFfmpeg } = require('./media-tool-paths')

/** zoom-in 1.25 居中裁切吃掉的单侧比例 —— 安全区必须大于它 */
const ZOOM_IN_CROP_RATIO = 0.1

describe('title-card-renderer 中文折行', () => {
  it('按估算宽度折行且不丢字', () => {
    const text = '你有没有过这样的时刻：明知道截止日期就在明天，手上这件事却怎么也推不动？'
    const lines = wrapText(text, 12)
    expect(lines.length).toBeGreaterThan(1)
    expect(lines.join('')).toBe(text)
  })

  it('空串与纯空白返回空数组（不得产出含空串的数组）', () => {
    expect(wrapText('', 10)).toEqual([])
    expect(wrapText('   ', 10)).toEqual([])
    expect(wrapText(null, 10)).toEqual([])
  })

  it('半角字符比全角占更少宽度（英文不会被过早折断）', () => {
    const cjk = wrapText('一二三四五', 5)
    const ascii = wrapText('abcdefghij', 5)
    expect(cjk.length).toBe(1)
    expect(ascii.length).toBeGreaterThan(cjk.length)
  })

  it('宽度预算非法时回落到默认值而不是抛错', () => {
    expect(wrapText('测试文本', 0).length).toBeGreaterThan(0)
    expect(wrapText('测试文本', -5).length).toBeGreaterThan(0)
    expect(wrapText('测试文本', Number.NaN).length).toBeGreaterThan(0)
  })
})

describe('title-card-renderer drawtext 文本转义', () => {
  it('转义 ffmpeg 滤镜语法的定界符与 expansion 字符', () => {
    // 单引号在 ffmpeg 单引号语境里必须写成「闭合-转义-重开」（见实现处注释）：
    // 旧写法 \' 会提前闭合引号 ⇒ 后半段被当 filter 参数 ⇒ 渲染失败或**静默产出空白图**。
    expect(escapeDrawtextText("it's")).toBe("it'\\''s")
    expect(escapeDrawtextText('a:b')).toBe('a\\:b')
    expect(escapeDrawtextText('a,b')).toBe('a\\,b')
    expect(escapeDrawtextText('100%')).toBe('100\\%')
    expect(escapeDrawtextText('{x}')).toBe('\\{x\\}')
    // 逐字期望（与迁移前的 asset-generator 实现逐字一致）：
    // 输入字符 `C:\\path` ⇒ 先把两个反斜杠各自转义成两个（→4 个），再把 `:` 转义 ⇒ `C\:\\\\path`
    expect(escapeDrawtextText('C:\\\\path')).toBe('C\\:\\\\\\\\path')
  })

  it('换行折成空格（drawtext 的 text= 里换行不可靠，逐行渲染由调用方负责）', () => {
    expect(escapeDrawtextText('a\nb')).toBe('a b')
    expect(escapeDrawtextText('a\r\nb')).toBe('a b')
  })

  it('空值不炸', () => {
    expect(escapeDrawtextText('')).toBe('')
    expect(escapeDrawtextText(null)).toBe('')
    expect(escapeDrawtextText(undefined)).toBe('')
  })

  it('asset-generator 转发的是同一个函数（公共 API 不破）', () => {
    const { escapeDrawtextText: viaAssetGenerator } = require('./asset-generator')
    expect(viaAssetGenerator).toBe(escapeDrawtextText)
  })
})

describe('title-card-renderer 入参校验', () => {
  it('画幅有下限（再小排版无意义）', () => {
    const opts = normalizeOptions({ width: 10, height: 10 })
    expect(opts.width).toBeGreaterThanOrEqual(320)
    expect(opts.height).toBeGreaterThanOrEqual(240)
  })

  it('未知主题回落到默认主题而不是抛错', () => {
    expect(normalizeOptions({ theme: '不存在的孤儿主题' }).theme).toBe('cinematic')
    expect(normalizeOptions({ theme: 'anime' }).theme).toBe('anime')
  })

  it('safeMarginRatio 被夹在 [0, 0.4]', () => {
    expect(normalizeOptions({ safeMarginRatio: 5 }).safeMarginRatio).toBe(0.4)
    expect(normalizeOptions({ safeMarginRatio: -1 }).safeMarginRatio).toBe(0)
    expect(normalizeOptions({}).safeMarginRatio).toBe(SAFE_MARGIN_RATIO)
  })

  it('progress 被夹在 [0, 1]；未给时为 null（不画进度条）', () => {
    expect(normalizeOptions({ progress: 3 }).progress).toBe(1)
    expect(normalizeOptions({ progress: -1 }).progress).toBe(0)
    expect(normalizeOptions({}).progress).toBeNull()
  })

  it('缺 outputPath 或标题与副标题都为空时抛错', async () => {
    await expect(renderTitleCard({ title: 'x' })).rejects.toThrow(/outputPath/)
    await expect(renderTitleCard({ outputPath: '/tmp/x.png', title: '  ', subtitle: '' }))
      .rejects.toThrow(/至少要有一个非空/)
  })
})

describe('title-card-renderer 标题安全区（核心契约）', () => {
  it('默认边距必须大于 zoom-in 的裁切量', () => {
    expect(SAFE_MARGIN_RATIO).toBeGreaterThan(ZOOM_IN_CROP_RATIO)
  })

  it('所有文字的 x 坐标都落在安全区内', () => {
    const layout = computeCardLayout({
      title: '你有没有过这样的时刻：明知道截止日期就在明天',
      subtitle: '一段比较长的副标题，用来验证折行与边距',
      label: 'AI 讲解视频',
      counter: '场景 2 / 8',
      width: 1280,
      height: 720,
    })
    expect(layout.margin).toBeGreaterThanOrEqual(1280 * ZOOM_IN_CROP_RATIO)
    // drawtext 的 x 必须是字面量 margin 或含 margin 的表达式
    const textFilters = layout.filters.filter(f => f.startsWith('drawtext='))
    expect(textFilters.length).toBeGreaterThan(0)
    for (const filter of textFilters) {
      const x = /:x=([^:]*)/.exec(filter)
      expect(x).not.toBeNull()
      const value = x[1]
      if (value.startsWith('(')) {
        // 右下角计数：右边距同样是 margin
        expect(value).toContain(String(layout.margin))
      } else {
        expect(Number(value)).toBeGreaterThanOrEqual(layout.margin)
      }
    }
  })

  it('内容宽度不超过画幅减去两侧安全区', () => {
    const layout = computeCardLayout({ title: '标题', subtitle: '副标题', width: 1920, height: 1080 })
    expect(layout.contentWidth).toBeLessThanOrEqual(1920 - layout.margin * 2)
  })

  it('显式把边距调小是允许的（调用方有权覆盖），但不得为负', () => {
    const layout = computeCardLayout({ title: '标题', width: 1280, safeMarginRatio: 0 })
    expect(layout.margin).toBe(0)
  })

  it('标题超过行数上限时被截断（不无限撑高画面）', () => {
    const layout = computeCardLayout({ title: '很长很长的标题'.repeat(20), width: 1280, titleMaxLines: 2 })
    expect(layout.titleLines.length).toBeLessThanOrEqual(2)
  })
})

describe('title-card-renderer 实际渲染', () => {
  const ffmpeg = findFfmpeg()

  // ffmpeg 不可用时（本机没装 / CI 用 --ignore-scripts 装依赖）跳过渲染断言，
  // 但上面的纯函数契约仍然全部执行。
  // ⚠ **真 ffmpeg 渲染比纯函数断言慢得多**（要起子进程 + 编码一帧 PNG）。
  //   vitest 的通用 testTimeout 是 10s ⇒ 在 Windows CI runner 上首帧渲染经常顶不住
  //   （实测 2026-10-24：Desktop Shards 2/2 因「Test timed out in 10000ms」红，
  //   而同一批用例在本地与其它 shard 上都通过 ⇒ 属**时限偏紧**，不是用例失败）。
  //   ⚠ 这类「**不稳定耗时进通用时限**」的形态与「测试键里不能含不稳定量」同源：
  //   一旦文件因新增测试被重新分片到更慢的 shard，就会「新增即红」且**判定不确定**。
  //   ⇒ 渲染类用例**单独给 60s 时限**（只放宽时限，**不改断言语义、不改 skip 守卫**）。
  const FFMPEG_RENDER_TIMEOUT_MS = 60000
  // 包装 it：本组用例**统一**取 60s 时限（只放宽时限，不改断言语义、不改 skip 守卫）
  const itWithFfmpeg = ffmpeg
    ? (name, fn) => it(name, fn, FFMPEG_RENDER_TIMEOUT_MS)
    : it.skip

  itWithFfmpeg('产出一张 PNG 且尺寸与请求一致', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'title-card-'))
    const out = path.join(dir, 'card.png')
    try {
      const card = await renderTitleCard({
        title: '拖延症不是懒：拖延背后的情绪调节机制',
        subtitle: '深夜卧室，蓝白色屏幕光映在年轻人的脸上',
        label: 'AI 讲解视频',
        counter: '场景 1 / 8',
        progress: 0.125,
        width: 640,
        height: 360,
        outputPath: out,
      })
      expect(card.path).toBe(out)
      expect(card.width).toBe(640)
      expect(card.height).toBe(360)
      expect(fs.existsSync(out)).toBe(true)
      const buffer = fs.readFileSync(out)
      // PNG 魔数
      expect(buffer.slice(1, 4).toString('ascii')).toBe('PNG')
      // 豆腐块（字体解析失败）会退化成极小的 PNG（实测 5495 → 765 字节），
      // 这里用下限挡住「渲染了但字全是方块」的静默失败。
      expect(buffer.length).toBeGreaterThan(3000)
    } finally {
      fs.rmSync(dir, { recursive: true, force: true })
    }
  }, FFMPEG_RENDER_TIMEOUT_MS)

  itWithFfmpeg('含 ffmpeg 滤镜特殊字符的文案不得让渲染炸掉', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'title-card-'))
    const out = path.join(dir, 'card.png')
    try {
      await renderTitleCard({
        title: '100% 的努力：path\\to\\file,with,commas',
        subtitle: "quote ' and {brace} and %percent",
        width: 640,
        height: 360,
        outputPath: out,
      })
      expect(fs.existsSync(out)).toBe(true)
      expect(fs.statSync(out).size).toBeGreaterThan(3000)
    } finally {
      fs.rmSync(dir, { recursive: true, force: true })
    }
  }, FFMPEG_RENDER_TIMEOUT_MS)

  itWithFfmpeg('带单引号的文案必须真渲染出内容（防「rc=0 但产出空白图」的静默失败）', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'title-card-'))
    const out = path.join(dir, 'card.png')
    try {
      await renderTitleCard({
        title: "it's a trap: {brace} and 100%",
        subtitle: "quote ' here",
        width: 640,
        height: 360,
        outputPath: out,
      })
      const size = fs.statSync(out).size
      // 旧转义在这类文案上产出 630 字节的空白图（rc=0、不报错）；
      // 正常有文字的卡片在同尺寸下是数千字节 ⇒ 体积下限即「有没有画出字」的代理判据。
      expect(size).toBeGreaterThan(2000)
    } finally {
      fs.rmSync(dir, { recursive: true, force: true })
    }

  }, FFMPEG_RENDER_TIMEOUT_MS)

  // ⛔ 这条**刻意不放在 itWithFfmpeg 守卫里**。
  //
  // 为什么要一条环境无关的锁（2026-10-24 主干红实测）：
  //   `itWithFfmpeg = ffmpeg ? it : it.skip` 意味着「环境里没有 ffmpeg ⇒ 整组渲染断言
  //   全部跳过」⇒ CI 绿，但那些断言**从未执行过**。#4359 合并时就是这么绿的
  //   （ffmpeg-ffprobe-static 的 postinstall 当时没把二进制下下来 ⇒ 找不到 ffmpeg ⇒ skip），
  //   后来缓存命中、二进制到位 ⇒ 用例真跑 ⇒ 暴露出一个一直存在的挂死缺陷。
  //   ⇒ 「绿色的渲染断言」不能证明渲染路径是通的；必须有一条**不依赖 ffmpeg 存在**的锁。
  //
  // 这条怎么做到环境无关：用 **node 自己冒充 ffmpeg**（node 拿到 -nostdin 会立刻报错退出），
  // 于是「ffmpeg 调用必须禁用 stdin」+「失败必须带出 argv 与 stderr」这两条契约
  // 在**任何**机器上都能被断言到。
  it('ffmpeg 调用必须禁用 stdin，且失败信息带得出 argv 与 stderr（防挂死后无从诊断）', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'title-card-argv-'))
    const out = path.join(dir, 'card.png')
    try {
      let message = ''
      try {
        await renderTitleCard({
          title: '任意标题',
          subtitle: '任意副标题',
          width: 640,
          height: 360,
          outputPath: out,
          // 注入 node 自身：它不认 -nostdin，会立刻失败 ⇒ 我们拿到的是「失败现场」而不是渲染产物
          ffmpegPath: process.execPath,
        })
      } catch (e) {
        message = String((e && e.message) || e)
      }
      expect(message).toContain('-nostdin')
      expect(message).toContain('| argv:')
      expect(message).toContain('| stderr:')
    } finally {
      fs.rmSync(dir, { recursive: true, force: true })
    }
  })


  it('主题表覆盖既有 imageStyle 取值域（流水线 style 传进来不能落空）', () => {
    for (const key of ['cinematic', 'realistic', 'cartoon', 'anime', 'cyberpunk', 'watercolor', 'minimalist']) {
      expect(THEMES[key]).toBeTruthy()
    }
  })
})
describe('describeRenderFailure：挂起与滤镜报错必须分档（2026-10-27 从 CI 回读定位）', () => {
  // vitest 以 ESM 跑，模块里没有 require ⇒ 必须 await import
  const load = async () => (await import('./title-card-renderer.js')).describeRenderFailure ?? (await import('./title-card-renderer.js')).default?.describeRenderFailure
  const src = async () => (await import('node:fs')).readFileSync(new URL('./title-card-renderer.js', import.meta.url ?? 'file:///' + process.cwd()), 'utf8')

  it('挂起档：killed=true 时明写「挂起」并带 signal；stderr 缺席要显式打 <空>', async () => {
    const d = await load()
    expect(typeof d, 'describeRenderFailure 未导出（锁测不到东西）').toBe('function')
    const msg = d({ message: 'Command failed: ffmpeg', killed: true, signal: 'SIGKILL', stderr: '' }, ['-nostdin', '-y', 'card.png'])
    expect(msg).toContain('挂起')
    expect(msg).toContain('SIGKILL')
    expect(msg).toContain('stderr: <空>')
    expect(msg).toContain('argv: -nostdin -y card.png')
    expect(msg.includes('ffmpeg 渲染失败:')).toBe(false)
  })

  it('滤镜档：killed 不为真时不得出现「挂起」（把两档合写一句等于没分档）', async () => {
    const d = await load()
    const msg = d({ message: 'Command failed: ffmpeg', killed: false, stderr: '[AVFilterGraph] Invalid argument' }, ['-y'])
    expect(msg).toContain('renderTitleCard: ffmpeg 渲染失败:')
    expect(msg.includes('挂起')).toBe(false)
    expect(msg).toContain('stderr: [AVFilterGraph] Invalid argument')
  })

  it('反失明档：stderr 缺席一律打 <空>，不得整段省略（省略等于把「没话说」读成「没问题」）', async () => {
    const d = await load()
    for (const err of [{ message: 'x' }, { message: 'x', stderr: '   ' }, { message: 'x', stderr: undefined }]) {
      expect(d(err, [])).toContain('stderr: <空>')
    }
  })

  it('接线：抛出必须走该分档函数；内联拼接的老写法回来就红', async () => {
    const text = await src()
    expect(text.includes('throw new Error(describeRenderFailure(lastError, lastArgv, fontconfigFailureProbe()))')).toBe(true)
    expect(text.includes("throw new Error('renderTitleCard: ffmpeg 渲染失败")).toBe(false)
  })
})

// 2026-10-27：预算类判据必须比"这一组用例**实际生效**的时限"，不是比 vitest 全局默认值。
// 上一轮我拿全局 testTimeout=10s 去比 attempts × 8s = 16s，量出一条根本不存在的"倒挂"
// （本组走 itWithFfmpeg，显式带 60s）。尺子错了，读数再准也是错结论 ⇒ 生效时限改为**读本文件源码里那行声明**。
describe('渲染用例的生效时限与总预算（判据比较对象已修正）', () => {
  it('总预算 attempts × RENDER_TIMEOUT_MS 必须小于本组用例的生效时限', async () => {
    const src = require('node:fs').readFileSync(__filename, 'utf8').replace(/\r\n/g, '\n')
    const decl = /const FFMPEG_RENDER_TIMEOUT_MS = (\d+)/.exec(src)
    expect(decl, '找不到本组渲染用例的生效时限声明 ⇒ 判据失去比较对象；不得回退到 vitest 全局 testTimeout（那正是上一次的错）').not.toBeNull()
    const caseTimeout = Number(decl[1])
    const m = await import('./title-card-renderer.js')
    expect(typeof m.RENDER_TIMEOUT_MS, 'RENDER_TIMEOUT_MS 未导出 ⇒ 这条锁没有读者').toBe('number')
    expect(typeof m.RENDER_ATTEMPTS, 'RENDER_ATTEMPTS 未导出 ⇒ 这条锁没有读者').toBe('number')
    const total = m.RENDER_ATTEMPTS * m.RENDER_TIMEOUT_MS
    expect(total, '内部总预算 ' + total + 'ms 不小于生效时限 ' + caseTimeout + 'ms ⇒ ffmpeg 还没被杀、vitest 先判超时，argv/killed/FONTCONFIG 现场会被吃掉').toBeLessThan(caseTimeout)
  })

  it('渲染类用例不得走裸 it()（裸 it 落回全局 10s，把刚分档好的现场吃掉）', () => {
    const src = require('node:fs').readFileSync(__filename, 'utf8').replace(/\r\n/g, '\n')
    const bareNow = (src.match(/^ {2}it\(/gm) || []).length
    const wrappedNow = (src.match(/itWithFfmpeg\(/g) || []).length
    expect(wrappedNow, 'itWithFfmpeg 计数为 0 ⇒ 本条判据无从成立（不得把「没扫到」读成「没违规」）').toBeGreaterThan(0)
    expect(bareNow, BARE_IT_MSG + bareNow).toBeLessThanOrEqual(BARE_IT_CAP)
  })
})
