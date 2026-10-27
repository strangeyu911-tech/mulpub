// @ts-check
'use strict'
/**
 * kit-inspect 契约测试（资产体检报告 · 只读）
 *
 * 覆盖：
 *   ① 合法包 ⇒ ok + importable + counts 逐项正确
 *   ② 缺必填 ⇒ **ok 仍为 true**（体检跑通）但 importable=false + requiredMissing 结构化点名
 *      —— 「读不到目录」与「资产不合格」是两件事，合成一个字段会让用户走错动作
 *   ③ 目录不存在 ⇒ ok=false + NOT_A_DIRECTORY（**不是** importable=false）
 *   ④ 白名单外顶层条目 ⇒ ignoredTopLevel 点名，且**不影响** importable
 *   ⑤ 参考条目无 URL / 分镜带成片 ⇒ 对应告警计数正确
 *   ⑥ 缺 v7 增强 ⇒ importable=false，但**统计仍出得来**（宽松读兜住）→ 用户能看到自己包里有什么
 *   ⑦ ⛔ **只读铁律**：体检全程不得调用任何写接口，源目录逐字节不变
 */

const fs = require('fs')
const os = require('os')
const path = require('path')

const { inspectKit, INSPECT_REASON, WARN_CODE } = require('./kit-inspect')

const UUID = '3caa2f3a-52b5-4293-9237-0c8f76c7158a'
const UUID2 = '7f1c9e2a-4b6d-4f81-9a3c-2d5e8b0c1a44'

function tmpDir () {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'kit-inspect-'))
}

/** 合法 kit（与 kit-loader.test.js 的夹具同形状；一份不写就会被严格模式拒的夹具没有价值） */
function makeKit (overrides) {
  const o = overrides || {}
  // ⚠ palette 的 `paletteLine` 必须**包含全部主色 hex**（kit-loader 的既有校验），
  //   否则整包在宽松/严格两种读法下都是硬错误 —— 那样夹具就不代表「合法包」。
  const hexes = ['#0E1A24', '#1F4E5F']
  const paletteLine = 'Palette: ' + hexes.join(' / ')
  const kit = {
    manifest: {
      schemaVersion: 1,
      filmMeta: {
        title: 'Film Project Case',
        durationSec: 120,
        logline: 'Street kids gain powers.',
        characters: [{ name: 'ROKO', descriptor: 'Determined street kid' }],
      },
      scenes: [
        { id: 'cold-open', name: '1. COLD OPEN', count: 12, parentId: null, level: 0 },
        { id: 'scene-25', name: 'Scene 25', count: 40, parentId: null, level: 0 },
      ],
    },
    shots: [
      {
        shotId: '11111111-1111-4111-8111-111111111111',
        sceneId: 'scene-25',
        prompt: 'EXT. CITY STREET - NIGHT\n[CHARACTER: ROKO] runs.',
        model: 'seedance_2_0',
        refTokens: [UUID],
        resultUrl: 'https://cdn.example.com/raw/abc.mp4',
      },
    ],
    references: {
      [UUID]: { kind: 'character', name: 'ROKO', imageUrls: ['https://cdn.example.com/roko.png'] },
    },
    doctrine: {
      blocks: [{ key: 'geo_spatial_layout', label: 'GEO SPATIAL LAYOUT', zh: '地理空间布局', en: 'Geo' }],
      rules: [{ key: 'batch', title: 'Batch', zh: '批量', en: 'Batch' }],
      glossary: [{ term: 'seedance', zh: '种子舞', en: 'Seedance' }],
    },
    shotGrammar: {
      schemaVersion: 1,
      shotSizes: [{ key: 'wide', zh: '远景', en: 'Wide', abbr: 'WS', chain: 'wide' }],
      cameraMoves: [{ key: 'static', zh: '固定', en: 'Static', risk: 'low' }],
      cameraAngles: [{ key: 'eye_level', zh: '平视', en: 'Eye level', emotion: 'neutral' }],
      lightingSetups: [{ key: 'natural', zh: '自然光', en: 'Natural' }],
      vfxPresets: [{ key: 'none', zh: '无特效', en: 'None', risk: 'low' }],
      emotionTiers: [{ key: 'normal', zh: '常规', en: 'Normal', zhCharsPerSecond: 8 }],
      durationTiers: { supportedSec: [5, 8, 10, 12], maxSec: 12 },
    },
    compliance: {
      schemaVersion: 1,
      categories: [{ key: 'content', zh: '内容合规', en: 'Content' }],
      items: [{
        id: 'CC-01', category: 'content', severity: 'blocker',
        zhQuestion: '禁止内容？', enQuestion: 'Forbidden?',
        zhPass: '不包含', enPass: 'None', zhFix: '改写', enFix: 'Rewrite',
      }],
    },
    palette: {
      schemaVersion: 1,
      limits: { maxPrimary: 4, maxExtended: 2 },
      primary: hexes.map((hex, i) => ({ key: 'p' + i, hex, zhName: '主色' + i, enName: 'Primary ' + i })),
      extended: [],
      paletteLine: { zh: paletteLine, en: paletteLine },
      emotionColorMap: [],
    },
    prompts: {
      'adapt_script/zh/system.md': 'system',
      'adapt_script/zh/user.md': 'user',
      'adapt_script/en/system.md': 'system',
      'adapt_script/en/user.md': 'user',
    },
  }
  return Object.assign(kit, o)
}

function writeKit (dir, kit) {
  fs.mkdirSync(dir, { recursive: true })
  const files = {
    'film-manifest.json': kit.manifest,
    'shot-library.json': kit.shots,
    'reference-registry.json': kit.references,
    'prompt-doctrine.json': kit.doctrine,
    'shot-grammar.json': kit.shotGrammar,
    'compliance-checklist.json': kit.compliance,
    'palette.json': kit.palette,
  }
  for (const [name, value] of Object.entries(files)) {
    if (value === undefined) continue
    fs.writeFileSync(path.join(dir, name), JSON.stringify(value))
  }
  for (const [rel, content] of Object.entries(kit.prompts || {})) {
    const full = path.join(dir, 'prompts', 'tasks', rel)
    fs.mkdirSync(path.dirname(full), { recursive: true })
    fs.writeFileSync(full, content)
  }
  return dir
}

/** 递归快照（相对路径 → size:mtimeMs），用于「逐字节不变」断言 */
function snapshot (root) {
  const out = {}
  const walk = (dir, rel) => {
    for (const ent of fs.readdirSync(dir, { withFileTypes: true })) {
      const abs = path.join(dir, ent.name)
      const r = rel ? rel + '/' + ent.name : ent.name
      if (ent.isDirectory()) { out[r + '/'] = 'dir'; walk(abs, r); continue }
      const st = fs.statSync(abs)
      out[r] = st.size + ':' + st.mtimeMs
    }
  }
  walk(root, '')
  return out
}

/** 记录写调用的 fs 替身：只读判据的**机械锁**（不靠人读代码） */
function spyingFs () {
  const writes = []
  const wrap = (name) => (...args) => {
    writes.push(name + '(' + String(args[0]) + ')')
    // 不抛：让实现继续跑完，测试在末尾断言 writes 为空 —— 抛错会把「有写」伪装成「跑失败」
    return undefined
  }
  // ⚠ 不能 `Object.create(fs)` 后赋值 `promises`：`fs.promises` 是只读 getter ⇒ 抛 TypeError。
  //   用 Object.assign 把 getter 求值成数据属性，才可写。
  const stub = Object.assign({}, fs)
  for (const name of ['writeFileSync', 'writeSync', 'appendFileSync', 'mkdirSync', 'unlinkSync', 'rmSync', 'rmdirSync', 'renameSync', 'copyFileSync', 'openSync', 'createWriteStream', 'utimesSync']) {
    stub[name] = wrap(name)
  }
  const pm = Object.assign({}, fs.promises)
  for (const name of ['writeFile', 'appendFile', 'mkdir', 'unlink', 'rm', 'rmdir', 'rename', 'copyFile', 'utimes']) {
    pm[name] = wrap('promises.' + name)
  }
  // `open` 是读写通用：只有 flags 是写模式才算写入（读包必然调 open，把它一律当写会假红）
  pm.open = (target, flags, ...rest) => {
    if (typeof flags === 'string' && /[wa+]/.test(flags)) writes.push('promises.open(' + String(target) + ',' + flags + ')')
    return fs.promises.open(target, flags, ...rest)
  }
  stub.promises = pm
  return { fs: stub, writes }
}

describe('kit-inspect: 合法包', () => {
  it('ok + importable，且 counts 逐项正确', async () => {
    const dir = writeKit(tmpDir(), makeKit())
    const res = await inspectKit({ kitDir: dir })
    expect(res.ok).toBe(true)
    expect(res.data.importable).toBe(true)
    expect(res.data.blockingReason).toBe(null)
    const c = res.data.counts
    expect(c.scenes).toBe(2)
    expect(c.shots).toBe(1)
    expect(c.shotsWithResult).toBe(1)
    expect(c.references).toBe(1)
    expect(c.referencesResolvable).toBe(1)
    expect(c.templateTasks).toBe(1)
    expect(c.templateFiles).toBe(4) // adapt_script × {zh,en} × {system,user}
    expect(res.data.langs.sort()).toEqual(['en', 'zh'])
    expect(res.data.requiredMissing).toEqual([])
    expect(res.data.ignoredTopLevel).toEqual([])
  })

  it('分镜带成片链接 ⇒ SHOTS_WITH_RESULT 告警（信息性，不阻断）', async () => {
    const dir = writeKit(tmpDir(), makeKit())
    const res = await inspectKit({ kitDir: dir })
    const codes = res.data.warnings.map((w) => w.code)
    expect(codes).toContain(WARN_CODE.SHOTS_WITH_RESULT)
    expect(res.data.importable).toBe(true)
  })
})

describe('kit-inspect: 不合格但体检跑通（ok 与 importable 必须分开）', () => {
  it('缺必填文件 ⇒ ok:true + importable:false + requiredMissing 点名', async () => {
    const kit = makeKit({ palette: undefined })
    const dir = writeKit(tmpDir(), kit)
    const res = await inspectKit({ kitDir: dir })
    expect(res.ok).toBe(true)
    expect(res.data.importable).toBe(false)
    expect(res.data.blockingReason).toBe(INSPECT_REASON.VALIDATION_ERROR)
    expect(res.data.requiredMissing).toContain('palette.json')
    // 统计仍要出得来：用户必须看到自己包里有什么
    expect(res.data.counts).not.toBe(null)
    expect(res.data.counts.scenes).toBe(2)
  })

  it('缺 v7 增强（shot-grammar）⇒ importable:false，但 counts 与 MISSING_V7_ASSET 都在', async () => {
    const kit = makeKit({ shotGrammar: undefined })
    const dir = writeKit(tmpDir(), kit)
    const res = await inspectKit({ kitDir: dir })
    expect(res.ok).toBe(true)
    expect(res.data.importable).toBe(false)
    expect(res.data.requiredMissing).toContain('shot-grammar.json')
    expect(res.data.counts.shots).toBe(1)
    expect(res.data.warnings.map((w) => w.code)).toContain(WARN_CODE.MISSING_V7_ASSET)
  })

  it('目录不存在 ⇒ ok:false + NOT_A_DIRECTORY（不得读成「资产不合格」）', async () => {
    const res = await inspectKit({ kitDir: path.join(tmpDir(), 'nope') })
    expect(res.ok).toBe(false)
    expect(res.reason).toBe(INSPECT_REASON.NOT_A_DIRECTORY)
    expect(res.data).toBeUndefined()
  })

  it('路径是文件不是目录 ⇒ ok:false + NOT_A_DIRECTORY', async () => {
    const dir = tmpDir()
    const file = path.join(dir, 'a.txt')
    fs.writeFileSync(file, 'x')
    const res = await inspectKit({ kitDir: file })
    expect(res.ok).toBe(false)
    expect(res.reason).toBe(INSPECT_REASON.NOT_A_DIRECTORY)
  })
})

describe('kit-inspect: 白名单外条目与参考图', () => {
  it('顶层有 images/ 与散落文件 ⇒ ignoredTopLevel 点名，但不影响 importable', async () => {
    const dir = writeKit(tmpDir(), makeKit())
    fs.mkdirSync(path.join(dir, 'images'), { recursive: true })
    fs.writeFileSync(path.join(dir, 'images', 'a.webp'), 'x')
    fs.writeFileSync(path.join(dir, 'notes.txt'), 'x')
    const res = await inspectKit({ kitDir: dir })
    expect(res.data.importable).toBe(true)
    expect(res.data.ignoredTopLevel.sort()).toEqual(['images', 'notes.txt'])
    expect(res.data.warnings.map((w) => w.code)).toContain(WARN_CODE.IGNORED_TOP_LEVEL)
  })

  it('参考条目没有可解析 URL ⇒ UNRESOLVED_REFERENCE 计数', async () => {
    const kit = makeKit()
    kit.shots = kit.shots.map((s) => Object.assign({}, s, { refTokens: [] }))
    kit.references = Object.assign({}, kit.references, {
      [UUID2]: { kind: 'prop', name: 'skate', imageUrls: [] },
    })
    const dir = writeKit(tmpDir(), kit)
    const res = await inspectKit({ kitDir: dir })
    expect(res.data.counts.references).toBe(2)
    expect(res.data.counts.referencesResolvable).toBe(1)
    const w = res.data.warnings.find((x) => x.code === WARN_CODE.UNRESOLVED_REFERENCE)
    expect(w).toBeTruthy()
    expect(w.count).toBe(1)
  })
})

describe('⛔ kit-inspect: 只读铁律', () => {
  it('全程不调用任何写接口，源目录逐字节不变', async () => {
    const dir = writeKit(tmpDir(), makeKit())
    const before = snapshot(dir)
    const { fs: stub, writes } = spyingFs()
    const res = await inspectKit({ kitDir: dir, fs: stub })
    expect(res.ok).toBe(true)
    const after = snapshot(dir)
    expect(after).toEqual(before)
    // 只读判据落在产物上：任何写调用都要能让这条红，而不是靠人读实现
    expect(writes).toEqual([])
  })

  it('不合格包同样零写入（失败路径也不写）', async () => {
    const kit = makeKit({ palette: undefined })
    const dir = writeKit(tmpDir(), kit)
    const before = snapshot(dir)
    const { fs: stub, writes } = spyingFs()
    await inspectKit({ kitDir: dir, fs: stub })
    expect(snapshot(dir)).toEqual(before)
    expect(writes).toEqual([])
  })
})

describe('kit-inspect: 闭集导出（契约测试要逐值比对 SCHEMA.md）', () => {
  it('WARN_CODE 与 INSPECT_REASON 都是冻结的字符串闭集', () => {
    expect(Object.isFrozen(WARN_CODE)).toBe(true)
    expect(Object.isFrozen(INSPECT_REASON)).toBe(true)
    for (const v of Object.values(WARN_CODE)) expect(typeof v).toBe('string')
    for (const v of Object.values(INSPECT_REASON)) expect(typeof v).toBe('string')
    expect(Object.values(WARN_CODE).sort()).toEqual([
      'EMPTY_TASK_LIBRARY', 'IGNORED_TOP_LEVEL', 'MISSING_V7_ASSET',
      'SHOTS_WITH_RESULT', 'TEMPLATE_NO_BLOCKS', 'TEMPLATE_NO_CHARACTER_LINE', 'UNRESOLVED_REFERENCE',
    ])
    expect(Object.values(INSPECT_REASON).sort()).toEqual(['NOT_A_DIRECTORY', 'VALIDATION_ERROR'])
  })
})

// ── change: kit-import-rollback-and-template-health（P1 模板结构 / P2 对比 / P3 版本）──
function kitWith (opts) {
  const o = opts || {}
  const kit = makeKit()
  if (o.manifest) kit.manifest = Object.assign({}, kit.manifest, o.manifest)
  if (o.shots) kit.shots = o.shots
  return kit
}

describe('kit-inspect: 模板结构判据（P1）', () => {
  const NL = String.fromCharCode(10)
  const RICH = [
    'EXT. STREET - NIGHT',
    '[CHARACTER: ROKO] runs.',
    '',
    'GEO SPATIAL LAYOUT: center frame.',
  ].join(NL)
  const PLAIN = '一个男人在雨中奔跑。'

  it('结构完整的模板 ⇒ withCharacterLine / withBlocks 计数正确', async () => {
    const kit = kitWith({ shots: [Object.assign({}, makeKit().shots[0], { prompt: RICH })] })
    const dir = writeKit(tmpDir(), kit)
    const res = await inspectKit({ kitDir: dir })
    expect(res.data.templateStructure.total).toBe(1)
    expect(res.data.templateStructure.withCharacterLine).toBe(1)
    expect(res.data.templateStructure.withBlocks).toBe(1)
    expect(res.data.templateStructure.withSceneHeading).toBe(1)
    expect(res.data.warnings.map((w) => w.code)).not.toContain(WARN_CODE.TEMPLATE_NO_CHARACTER_LINE)
    expect(res.data.warnings.map((w) => w.code)).not.toContain(WARN_CODE.TEMPLATE_NO_BLOCKS)
  })

  it('纯散文模板 ⇒ 两个告警都在（不阻断，但必须让用户看见代价）', async () => {
    const kit = kitWith({ shots: [Object.assign({}, makeKit().shots[0], { prompt: PLAIN })] })
    const dir = writeKit(tmpDir(), kit)
    const res = await inspectKit({ kitDir: dir })
    expect(res.data.importable).toBe(true) // 不阻断
    expect(res.data.templateStructure.withCharacterLine).toBe(0)
    expect(res.data.templateStructure.withBlocks).toBe(0)
    const w1 = res.data.warnings.find((w) => w.code === WARN_CODE.TEMPLATE_NO_CHARACTER_LINE)
    const w2 = res.data.warnings.find((w) => w.code === WARN_CODE.TEMPLATE_NO_BLOCKS)
    expect(w1 && w1.count).toBe(1)
    expect(w2 && w2.count).toBe(1)
  })
})

describe('kit-inspect: 资产版本（P3）', () => {
  it('合法包 ⇒ assetVersion === 1、expectedAssetVersion === 1、versionMismatch false', async () => {
    const dir = writeKit(tmpDir(), makeKit())
    const res = await inspectKit({ kitDir: dir })
    expect(res.data.assetVersion).toBe(1)
    expect(res.data.expectedAssetVersion).toBe(1)
    expect(res.data.versionMismatch).toBe(false)
  })

  it('版本不符 ⇒ versionMismatch true 且不可导入（严格校验仍拒，但失败可读）', async () => {
    const kit = kitWith({ manifest: { schemaVersion: 2 } })
    const dir = writeKit(tmpDir(), kit)
    const res = await inspectKit({ kitDir: dir })
    expect(res.data.assetVersion).toBe(2)
    expect(res.data.versionMismatch).toBe(true)
    expect(res.data.importable).toBe(false)
  })
})

describe('kit-inspect: 与当前资产对比（P2）', () => {
  it('注入 currentCounts ⇒ 给出 delta（正负都算对）', async () => {
    const dir = writeKit(tmpDir(), makeKit()) // 场景 2 / 分镜 1 / 模板 1
    const res = await inspectKit({
      kitDir: dir,
      currentCounts: { scenes: 5, shots: 3, templates: 1 },
    })
    expect(res.data.compare.current).toEqual({ scenes: 5, shots: 3, templates: 1 })
    expect(res.data.compare.delta).toEqual({ scenes: -3, shots: -2, templates: 0 })
  })

  it('不注入（service 不可用）⇒ compare 为 null，**不印 0**', async () => {
    const dir = writeKit(tmpDir(), makeKit())
    const res = await inspectKit({ kitDir: dir })
    expect(res.data.compare).toBe(null)
  })

  it('注入形状不全 ⇒ 降级为 null（不拿半个对象算 delta）', async () => {
    const dir = writeKit(tmpDir(), makeKit())
    const res = await inspectKit({ kitDir: dir, currentCounts: { scenes: 5 } })
    expect(res.data.compare).toBe(null)
  })
})
