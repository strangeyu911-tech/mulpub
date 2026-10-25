/**
 * 采集抽取脚本 —— Vitest 单元测试（假 DOM 真跑脚本文本）
 *
 * 为什么要有这一层（2026-10-25，PR-1 第 2 刀）：
 *   抽取脚本原先内联在 `data-sync.js` 里 ⇒ 单测**跑不到**脚本本体
 *   ⇒ 「假 0」的两个入口（① 元素缺失 ② 值不可解析）没有任何机械锁。
 *   本文件把脚本抽到 `collector-scripts.js` 后，用**假 DOM**把脚本文本真跑一遍，
 *   于是「把 fail-loud 改回 `|| '0'`」这个变异**必然翻红**（见文末变异验证记录）。
 *
 * ⚠️ 夹具的诚实边界：仓内 `01-docs/evidence/rpa-dom-2026-09-23/` 只有**发布页**的
 *   DOM dump（`d5-douyin.json` 的 url = `creator-micro/content/post/video`），
 *   **不覆盖创作者数据面板** ⇒ 本文件的夹具是**合成**的（按选择器形状构造），
 *   不是实机 DOM。⇒ 它锁的是「脚本的判定逻辑」，**不是**「选择器仍然有效」。
 *   选择器标定需真机登录态，是独立后续步骤。
 */
const vm = require('vm')
const { COLLECTOR_SCRIPTS, COLLECTOR_SPECS, buildExtractionScript } = require('../collector-scripts')
const { evaluateCollectorObservation } = require('../collector-contract')

/**
 * 构造最小假 DOM。
 * @param {Record<string, object>} tree - 选择器 → 节点
 * @param {object} node - { text?: string, children?: Record<string, object|object[]> }
 */
function createFakeDocument (tree) {
  function build (node) {
    return {
      textContent: node.text === undefined ? '' : node.text,
      querySelector: (sel) => {
        const child = node.children && node.children[sel]
        if (!child) return null
        return build(Array.isArray(child) ? child[0] : child)
      },
      querySelectorAll: (sel) => {
        const child = node.children && node.children[sel]
        if (!child) return []
        return (Array.isArray(child) ? child : [child]).map(build)
      },
    }
  }
  return {
    querySelector: (sel) => {
      const node = tree[sel]
      return node ? build(node) : null
    },
    querySelectorAll: (sel) => {
      const node = tree[sel]
      if (!node) return []
      const list = node.children && node.children[sel]
      return (Array.isArray(list) ? list : list ? [list] : []).map(build)
    },
    body: build({ children: tree }),
  }
}

/** 在假 DOM 里真跑抽取脚本 */
function runScript (platform, tree) {
  const script = COLLECTOR_SCRIPTS[platform].script
  return vm.runInNewContext(script, { document: createFakeDocument(tree) })
}

/** 各平台「一切正常」的合成 DOM */
function healthyDom (platform) {
  const spec = COLLECTOR_SPECS[platform]
  const container = spec.container
  const children = {}
  for (const field of Object.keys(spec.fields)) {
    const def = spec.fields[field]
    if (def.all) {
      const items = []
      const idx = def.index || 0
      for (let i = 0; i <= idx; i++) items.push({ text: i === idx ? '1.2万' : '0' })
      children[def.all] = items
    } else {
      children[def.selector] = { text: '1.2万' }
    }
  }
  return container ? { [container]: { children } } : children
}

/**
 * 取「子节点映射」。
 * 有容器守卫的平台：容器节点的 children；无容器守卫的平台：根节点就是那张映射。
 */
function childrenOf (dom, spec) {
  return spec.container ? dom[spec.container].children : dom
}

const PLATFORMS = Object.keys(COLLECTOR_SPECS)

describe('采集脚本 / 成功路径', () => {
  test.each(PLATFORMS)('%s：容器与字段齐全 ⇒ ok + data（数值已解析）', (platform) => {
    const raw = runScript(platform, healthyDom(platform))
    expect(raw.ok).toBe(true)
    expect(raw.data.platform).toBe(platform)
    expect(raw.data.followers).toBe(12000)
  })

  test.each(PLATFORMS)('%s：脚本产物能被契约层判为成功', (platform) => {
    const raw = runScript(platform, healthyDom(platform))
    const judged = evaluateCollectorObservation(raw)
    expect(judged.ok).toBe(true)
    expect(judged.data.followers).toBe(12000)
  })

  test.each(PLATFORMS)('%s：0 是合法值（不是缺失）', (platform) => {
    const spec = COLLECTOR_SPECS[platform]
    const dom = healthyDom(platform)
    const first = Object.keys(spec.fields)[0]
    const def = spec.fields[first]
    const children = childrenOf(dom, spec)
    if (def.all) children[def.all][def.index || 0] = { text: '0' }
    else children[def.selector] = { text: '0' }
    const raw = runScript(platform, dom)
    expect(raw.ok).toBe(true)
    expect(raw.data[first]).toBe(0)
  })
})

describe('采集脚本 / 假 0 的两个入口都必须抛（而不是折成 0）', () => {
  test.each(PLATFORMS)('%s：目标元素缺失 ⇒ missing + 字段名（绝不产出数值）', (platform) => {
    const spec = COLLECTOR_SPECS[platform]
    const dom = healthyDom(platform)
    // 把 followers 那个元素删掉
    const def = spec.fields.followers
    const children = childrenOf(dom, spec)
    if (def.all) children[def.all].splice(def.index || 0, 1)
    else delete children[def.selector]
    const raw = runScript(platform, dom)
    expect(raw.ok).toBe(false)
    expect(raw.reason).toBe('missing')
    expect(raw.field).toBe('followers')
    expect(raw.data).toBeUndefined()
    // 契约层必须判为失败（不是「收下这组数」）
    expect(evaluateCollectorObservation(raw).ok).toBe(false)
  })

  test.each(PLATFORMS)('%s：元素在但值不可解析 ⇒ invalid + 字段名（绝不产出 0）', (platform) => {
    const spec = COLLECTOR_SPECS[platform]
    const dom = healthyDom(platform)
    const def = spec.fields.followers
    const children = childrenOf(dom, spec)
    if (def.all) children[def.all][def.index || 0] = { text: '--' }
    else children[def.selector] = { text: '--' }
    const raw = runScript(platform, dom)
    expect(raw.ok).toBe(false)
    expect(raw.reason).toBe('invalid')
    expect(raw.field).toBe('followers')
    expect(raw.data).toBeUndefined()
    expect(evaluateCollectorObservation(raw).ok).toBe(false)
  })

  test.each(PLATFORMS)('%s：容器缺失 ⇒ not-ready（可重试，不是终态错误）', (platform) => {
    const spec = COLLECTOR_SPECS[platform]
    if (!spec.container) {
      // 无容器守卫的平台（视频号/公众号）：根节点退化为 document.body ⇒ 不会 not-ready，
      // 而是立刻 missing（选择器可能过期）。这是既有事实，不是缺陷。
      const raw = runScript(platform, {})
      expect(raw.ok).toBe(false)
      expect(raw.reason).toBe('missing')
      return
    }
    const raw = runScript(platform, {})
    expect(raw.ok).toBe(false)
    expect(raw.reason).toBe('not-ready')
    expect(evaluateCollectorObservation(raw).retryable).toBe(true)
  })
})

describe('采集脚本 / 计数解析（万/亿/千、日期、负数、小数）', () => {
  function parseViaScript (text) {
    const spec = { platform: 'probe', container: '.c', fields: { followers: { selector: '.f' } } }
    const script = buildExtractionScript(spec)
    const doc = createFakeDocument({ '.c': { children: { '.f': { text } } } })
    return vm.runInNewContext(script, { document: doc })
  }

  test('"1.2万" ⇒ 12000（旧写法会解析成 12，差 1000 倍）', () => {
    expect(parseViaScript('1.2万').data.followers).toBe(12000)
  })

  test('"1.2w" / "1.2W" ⇒ 12000', () => {
    expect(parseViaScript('1.2w').data.followers).toBe(12000)
    expect(parseViaScript('1.2W').data.followers).toBe(12000)
  })

  test('"1.5亿" ⇒ 150000000', () => {
    expect(parseViaScript('1.5亿').data.followers).toBe(150000000)
  })

  test('"3.2k" ⇒ 3200', () => {
    expect(parseViaScript('3.2k').data.followers).toBe(3200)
  })

  test('"12,345" ⇒ 12345（千分位）', () => {
    expect(parseViaScript('12,345').data.followers).toBe(12345)
  })

  test('"粉丝 1.2万" ⇒ 12000（前面有标签文字不算失败）', () => {
    expect(parseViaScript('粉丝 1.2万').data.followers).toBe(12000)
  })

  test('⛔ "2024-01-01" ⇒ invalid（文本里有多个数 ⇒ 拒绝，绝不把日期当粉丝数）', () => {
    expect(parseViaScript('2024-01-01').ok).toBe(false)
    expect(parseViaScript('2024-01-01').reason).toBe('invalid')
  })

  test('⛔ "-5" ⇒ invalid（负数不是合法计数）', () => {
    expect(parseViaScript('-5').ok).toBe(false)
    expect(parseViaScript('-5').reason).toBe('invalid')
  })

  test('⛔ "12.5" ⇒ invalid（粉丝数必须是整数；1.2万 这类带单位的除外）', () => {
    expect(parseViaScript('12.5').ok).toBe(false)
    expect(parseViaScript('12.5').reason).toBe('invalid')
  })

  test('⛔ "" / "--" / "暂无" ⇒ invalid（空与占位都不是 0）', () => {
    for (const text of ['', '   ', '--', '暂无数据', 'null']) {
      expect(parseViaScript(text).ok, text).toBe(false)
      expect(parseViaScript(text).reason, text).toBe('invalid')
    }
  })
})

describe('采集脚本 / 结构纪律', () => {
  test('⛔ 脚本源码里不得出现 `|| \'0\'` 这类把缺失折成 0 的兜底', () => {
    for (const platform of PLATFORMS) {
      expect(COLLECTOR_SCRIPTS[platform].script, platform).not.toContain("|| '0'")
      expect(COLLECTOR_SCRIPTS[platform].script, platform).not.toContain('|| "0"')
    }
  })

  test('每个平台都带 url（采集必须知道去哪个创作者后台）', () => {
    for (const platform of PLATFORMS) {
      expect(COLLECTOR_SCRIPTS[platform].url, platform).toMatch(/^https:\/\//)
    }
  })

  test('脚本是可直接执行的表达式（不是语句序列）', () => {
    for (const platform of PLATFORMS) {
      const script = COLLECTOR_SCRIPTS[platform].script
      expect(script.trim().startsWith('(function'), platform).toBe(true)
      expect(script.trim().endsWith('})()'), platform).toBe(true)
    }
  })
})
