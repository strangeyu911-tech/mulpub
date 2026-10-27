---
record: film-auto-audio-capability
task: 影视工程「视频出片音轨能力表」（M0.4）—— 三态（implicit/explicit/unknown）能力条目 + 域结构锁
date: 2026-10-27
---

## 本次执行记录：M0.4 音轨能力表（三态）——`film-auto-audio-capability`（2026-10-27）

| 门禁 | 状态 | Fresh 证据 |
|------|------|-----------|
| 变更类型与隔离 | ✅ | 运行时代码（新增 1 个纯函数模块 + 1 个测试文件）+ 文档｜worktree `/workspace/mp-worktrees/mp-film-auto-audio-capability`（**NFS，非 C 盘**）＋裸分支 `film-auto-audio-capability`；基线 = `origin/main` @ `41f3ec861f4a`（A33 合并后）｜纯增量：0 新增 IPC、0 新增后端字段、**0 修改既有生产代码** |
| 第一性原因（QM-5 ①） | ✅ | M0 取证 F-1 成立（51/51 产物带 `aac` 音轨）⇒ 「音轨交给视频模型」的产品前提成立 ⇒ 但**落地能力表时实测推翻了 PRD 的两处预设**：① 预设「provider → 音轨开关参数名」，**实测没有任何 provider 有音轨开关参数**（唯一带音轨参数的是 `heygen` 的 `voice`，语义是**数字人 TTS**）⇒ 表项必须是**能力条目**而非参数名映射；② 预设「二态（支持/不支持）」**会把「未实测」读成「不支持」** ⇒ 必须三态 |
| 逃逸分析（QM-5 ②） | ✅ | 「能力表」此前**只存在于 PRD 的预留描述**（3 处提到 `VIDEO_AUDIO_PARAM_BY_PROVIDER`），**从未落地** ⇒ 所以「预设与实测不符」一直没被发现。⚠ 若照预设实现，会产出「**只列 1 个测过的 + 14 个漏列 + 0 个 unknown**」的表 ⇒ ⇒ **「漏列」与「未实测」在读数上同形**（前者是缺陷、后者是事实）⇒ 逃逸口 = **域不是靠真源钉住的**。⇒ 同族：域的权威判据应是 `supports('generateVideo')`（运行时属性），**不是**注册表注释里的数字（实测：注释写「(14)」，实际 16 条目、其中 `hifly` 是数字人不支持该方法 ⇒ 真值 **15**） |
| 修复 + 回归保护（QM-5 ④） | ✅ | 新增 `apps/desktop/electron/services/film-engineering/video-audio-inputs.js`：`VIDEO_AUDIO_CAPABILITY_BY_PROVIDER`（15 个 provider 全覆盖）+ `resolveVideoAudioCapability()`（**返回结构化对象**，不返回布尔）+ `isVideoModelProducedAudio()`（未实测 ⇒ **`null`** 而非 `false`）+ `listVideoAudioCapabilityProviders()` / `listVerifiedVideoAudioProviders()`；`video-audio-inputs.test.js` **16/16 绿**；**7 组变异全部被抓住**（V1 heygen explicit→unknown / V2 `audioParam=null`→`'audios'` / V3 seedance unknown→explicit / V4 unknown→`'none'`（不支持语义）/ V5 未实测 `null`→`false` / V6 删掉 `seedance`（域漏列）/ V7 混入 `suno`（TTS 越域）⇒ 全部 rc=1）；还原后基线 rc=0 且与 NFS 真源**逐字节一致** |
| 防止再次发生（QM-5 ⑤） | ✅ | ① **域结构锁**：测试内**实测** `supports('generateVideo')` 的 provider 集合（逐个实例化适配器 + 比 `BaseAdapter.prototype.generateVideo`）⇒ 与表集合**双向相等**（漏列/多列都红）⇒ **域不再靠人工名单**；② **域边界锁**：TTS/音乐/STT 适配器不得进表，且「有 TTS 能力」的 `minimax-multimodal`（`generateVideo` 转发给 `minimax.js`，载荷无音轨字段）**仍判 `unknown`**；③ **三态锁**：`heygen`=explicit(`voice`/`tts`)、`agnes-multimodal`=implicit、其余 13 个=unknown（`audioParam=null`/`audioSource=null`/`verified=false`），且表里**恰好 1 条 explicit**；④ **「未实测 ≠ 不支持」锁**：未列入/非字符串入参 ⇒ `unknown`；未实测条目**共享同一冻结对象引用**（可机械判）；⑤ **`params.audios` 锁**：它是 reference 参考音频（输入素材）⇒ `audioParam` 必须是 `null` |
| 行尾与 diff 对账 | ✅ | 本次为**纯新增 + 文档定点改写** ⇒ 删除行数 = **0**（无既有内容被改写）⇒ 两口径 numstat 一致；`git show HEAD:<f> | cmp -s - <f>` 逐文件核对通过；**U+FFFD = 0**（逐文件 `grep -c $'\xef\xbf\xbd'`） |
| 接线棘轮 | ✅ | 新增 `video-audio-inputs.test.js` 落在 `apps/desktop/vitest.config.js` 的 `include` 通配 `electron/services/**/*.test.{js,ts}` 内 ⇒ **被 CI 的 vitest 覆盖**（本地实跑 16/16 绿 ⇒ 该文件确实被收集执行；⚠ CI 日志侧的「真跑」需在 PR 上线后回读确认）｜⚠ 本片**未改 workflow** |
| QM-1 打包 / QM-4 视觉 | N/A | 本片**未触运行面**（0 修改既有生产代码、0 改 UI、0 改 locale、0 改提示词）⇒ 不涉及打包与视觉 |
| QM-6 CCG 双模型外部评审 | ⚠️ 未执行（如实记录） | 本沙箱**无 `codeagent-wrapper`**、无 `~/.claude/.ccg/config.toml` ⇒ 无法执行双模型外部评审。**不以内部自审冒充通过**。替代证据：① **7 组变异反证**（全被抓住）；② **域结构锁**（表集合与运行时属性双向相等）；③ 本地 16/16 绿 |
| 远程同步 | 由门禁推导 | 本行**不需要事后改写**：合并后门禁按主干历史推导归属（`scripts/lib/merge-ledger.js`，只认 squash 尾注 `(#NNNN)`）｜合并后的 merge SHA / CI 终态 / 逐 blob 读数写在 **PR 评论**里，不回填本文件 |

### 遗留（不假装已闭合）

- ⏳ **规划期接入 = 本片未做**（下片）。⚠ 原因**不是**「来不及」，而是**接入点与语义都还没定**：
  ① 「告警」的对象在 `unknown` 面前**不成立**（**未实测不能告警成「不支持」**）；
  ② 唯一可告警的 `heygen`（`audioSource='tts'`）在自动模式里**本来就用不了**
  （`video-gen.js` 不传 `character`/`voice`/`script` ⇒ 会报 `INVALID_CONFIG`）⇒ 那是**另一个问题**
  （自动模式不接数字人 provider），**不该伪装成「音轨能力告警」**；
  ⇒ ⇒ 接入前必须先定「**未知 / 不满足前提 / 真不支持**」三者的**文案与落点**
  （沿用 A33 的纪律：文案口径与数字口径同源、文案本体要有**文件级**机械锁）。
- ⚠ **本片新增的是叶子模块，当前生产代码引用数 = 0** ⇒ ⚠ **「单测全绿」≠「已接线」**
  ⇒ ⇒ 明确登记为「**能力表（供后续接入）**」，**不冒充**「规划期已能告警」。
- ⚠ **13 个 provider 的音轨产物未实测**（只读了适配器源码）⇒ 表里是 `unknown` 而**不是**「不支持」
  ⇒ 若将来实测出「不产音轨」，应**新增一条 `mode` 之外的显式事实**（而不是把 `unknown` 悄悄改成「不支持」）。
- ⚠ `heygen` 的 `explicit` 是**源码级确定**（`voice`/`script` 必填）**但未做真机出片验证**
  ⇒ 与「产物有没有音轨」那种需实测的事**不同性质** ⇒ 本片如实区分两类确定性。
- ⚠ **范围外**：经典版 `FilmEngineeringView.vue`（全量出片面板）不涉及音轨表 ⇒ 本片不动。

## CHANGELOG 条目

# feat(film): 影视工程新增「视频出片音轨能力表」（三态）—— 未实测与不支持严格区分（M0.4）

- 新增 `film-engineering/video-audio-inputs.js`：按 **15 个**真正支持视频生成的 provider
  给出音轨产出方式（`implicit` 模型自带 / `explicit` 显式参数 / `unknown` 未实测），
  并记录每个 provider 的**音轨参数名**、**音轨来源**（模型自带 / 数字人 TTS）与**证据出处**。
- ⭐ **「未实测」不再与「不支持」混为一谈**：未实测的 provider 一律标记为「未知」而非「不支持」，
  避免规划期把「还没测过」误报成「这个服务商不出对白」。
- ⭐ 表格的**覆盖范围由运行时属性自动校验**（漏列或多列一个服务商都会让测试失败），
  不会再出现「新增了服务商却忘了登记」这类静默遗漏。
- ⚠ 能力表已可用，但**规划期的提示尚未接入**（会在下一片补齐文案与落点）；本次**不改变出片行为**。

## learnings

### lesson: capability-table-must-be-three-state-and-domain-locked

**一句话**：任何「能力表」，只要存在「**没测过**」这一档，就必须做成**三态**，
且**表的覆盖范围要由运行时属性自动校验**，不能靠人工名单。

**现场**：Mulpub 影视工程「音轨能力表」（M0.4）。PRD 预设是「provider → 音轨开关参数名」，
落盘前实测发现两处预设不成立：① **没有任何 provider 有音轨开关参数**（唯一带音轨参数的是数字人服务商
`heygen` 的 `voice`，语义是 **TTS 驱动**，不是「音轨开关」）；
② 「支持 / 不支持」二态会把**13 个未实测的 provider 读成「不支持」**。

**三条可复用判据**：

1. ⭐ **「未实测」与「不支持」必须可区分** ⇒ 探测函数**不能只返回布尔**
   ⇒ 返回结构化对象（`{ mode, audioParam, audioSource, verified, evidence }`），
   且「是否由视频模型自带」这类谓词对未知档返回 **`null`**（未知）而不是 `false`（不满足）。
2. ⭐ **表的域要用运行时属性钉住**（本例 = `adapter.supports('generateVideo') === true`），
   ⇒ 测试内**实测**该集合并与表**双向相等**（漏列、多列都红）。
   ⇒ ⚠ **别用注册表注释里的数字**：实测注释写「视频生成 (14)」，实际该区块 16 条目、
   其中一个是数字人类不支持该方法 ⇒ **真值 15**。
3. ⭐ **域的边界要显式写出来**：本表是「**视频适配器的音轨产出方式**」，
   ⛔ **不是**「仓里有没有 TTS」⇒ 仓内的 TTS / 音乐 / 语音识别适配器**全部不属于本表**。
   ⚠ 最容易踩的是「**有 TTS 能力**」的那个：它的 `generateVideo` 转发给另一个适配器（载荷无音轨字段）
   ⇒ **仍判未知**。

**附一条通用形态**：**「新增叶子模块 + 单测全绿」≠「已接线」** ⇒ 本片把「生产引用数 = 0」
**如实登记为遗留**，并写清「接入前必须先定什么」，而不是把「表做好了」说成「功能可用了」。
