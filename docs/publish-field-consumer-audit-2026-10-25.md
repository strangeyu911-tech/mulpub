# 发布页平台差异化字段：消费面对账审计与实施方案（2026-10-25）

> 状态：**审计已完成、方案未开工**。本文是给"接手这件事的人"看的单一来源，不依赖任何会话记忆。
> 本文只描述事实与判据缺口，**不代表任何一项已修**。

## 0. 为什么需要这份文档

`packages/shared-utils/src/publish-capabilities.json` 的 `comment` 字段把 `implemented` 定义为
「本仓代码当前真实消费该字段」。实测：这句话**没有任何门禁在看**，于是"面板让你填、链侧根本不送"
成了可以长期存在的状态。发布能力注册表 PRD 里 §2.3 记的是「哪些能力没暴露 UI」，
它看不见的是另一半——**暴露了 UI 却没接线的字段**。两者是不同缺口。

## 1. 可复现口径（三条命令，别引用本文的数字）

```bash
# ① 注册表覆盖面：overrideFields 总数 / implemented / platform-capable / uiExposed
node -e "const j=require('./packages/shared-utils/src/publish-capabilities.json');\
const o=Object.values(j.overrideFields).flat();\
console.log('override='+o.length,'implemented='+o.filter(f=>f.status==='implemented').length,\
'capable='+o.filter(f=>f.status==='platform-capable').length,\
'uiExposed='+o.filter(f=>f.uiExposed).length)"

# ② 面板实际渲染集合（过滤器在 publish-capabilities.js 的 uiOnly 分支：uiExposed && implemented）
#    平台清单取注册表的键，不要写死——publish-capabilities.js 并不导出 PLATFORM_NAMES。
node -e "const c=require('./packages/shared-utils/src/publish-capabilities.js');\
const j=require('./packages/shared-utils/src/publish-capabilities.json');let n=0;\
for(const p of Object.keys(j.overrideFields)){const f=c.getPlatformOverrideFields(p,{uiOnly:true});\
if(f.length){n+=f.length;console.log(p+': '+f.map(x=>x.key).join(','))}}console.log('TOTAL='+n)"

# ③ 某一个字段到底有没有被消费（以 category 为例）：判据必须是"赋值进请求体/传给 DOM"
git grep -n "category" -- packages/api-publish-engine/src | grep -av "\.test\."
git grep -n "category\|categoryName" -- apps/desktop/electron/services/rpa-view-platforms.js
```

## 2. 现状：三层数字

| 层 | 数量 | 依据 |
|---|---|---|
| 注册表 `overrideFields` 条目 | 68 | 命令 ① |
| 其中 `status:"implemented"` | 33 | 命令 ① |
| 面板实际渲染（`uiExposed && implemented`） | 27 | 命令 ② |
| 27 条里两条轨都真送出（CONSUMED） | **5** | 下表 |
| 27 条里链侧零读取（DROPPED） | **9** | 下表 |
| 只在一条轨生效 / 被常量覆盖（PARTIAL / OVERWRITTEN） | **13** | 下表 |
| 只有 1 个选项的下拉（假控件） | 1 | `zhihu.commentPermission` |

**证据标注**：下表 `★` = 本文作者亲自跑过命令并读到该行；无星 = 由只读探子按同一口径报告、
文件行号已给出但本文作者未逐条重跑。**引用未星行条前请重跑第 1 节的命令。**

| 平台 | 字段 | 定性 | 证据 |
|---|---|---|---|
| 全部 15 | 路由事实 | 13/15 平台 `rpa_vm`，仅 bilibili/baijiahao 为 `api` | ★`publisher-router.js` 的 `ROUTE_TABLE` |
| 全部 | 回落默认 | 未配置时默认 `api-then-dom` ⇒ **API 一失败静默回落 DOM** | ★`publish/core/publish-mode.js` 的 `normalizeMode` |
| 通用 DOM 轨 | 读取集 | 只有 `title/content/tags/images/video_path/cover_path/draft/aiGenerated`，**不含任何差异化字段** | ★对 `rpa-view-platforms.js` 通用段 `grep -o "article\.[A-Za-z_]*"` |
| zhihu / weibo / toutiao / douyin | `category` | **DROPPED**（面板可见，两轨零读取） | ★上述命令 ③ 对这四平台 0 命中 |
| zhihu | `commentPermission` | **假控件**：注册表只给 1 个 option，用户产不出第二个值 ⇒ 不是"丢值"，是"声称可配置而无可配置项" | ★注册表该条 `options` 长度 = 1；★`publisher-router.js` 无条件写 `'anyone'` |
| bilibili | `copyright` | **OVERWRITTEN**：面板默认 2（转载），API 轨恒发 1（自制） | ★`bilibili-video.js` 的 `copyright: 1,` |
| bilibili | `draft` / 视频号 `draft` | **OVERWRITTEN**：适配器硬编码 `{ draft: false }`，把引擎"私密优先"分支掐死，注册表 note 描述的语义不成立 | ★`adapters/bilibili.js`、`adapters/shipinhao.js` |
| bilibili | `category`（DOM 分支） | PARTIAL：DOM 读 `article.categoryName`，**全仓零生产者** ⇒ 该分支恒不触发 | ★`grep -rn categoryName` 仅命中该块自身 |
| bilibili | `collectionId` | DROPPED（链与适配器零读取；`season_id` 那处是**读**合集列表） | 探子报告，未星 |
| tiktok | `privacyLevel` | DROPPED：**键名错配**——router 写 `privacyLevel`，适配器读 `privacy` ⇒ 恒 `"PUBLIC"` | ★`adapters/tiktok.js` `privacy_level: taskData.privacy \|\| "PUBLIC"` 对 `publisher-router.js` 的 `resolved.privacyLevel` |
| youtube | `privacy` | PARTIAL + 回落 **OVERWRITTEN**：DOM 轨硬点 PUBLIC ⇒ 用户选 private/unlisted 回落即变公开 | 探子报告，未星（**语义后果最重的一条，优先复核**） |
| youtube | `playlistId` | DROPPED：塞进 `part=snippet,status` 的 videos 资源；正确落点是 `playlistItems.insert`，全仓 0 命中 | ★`adapters/youtube.js` 该段（注释自认"由调用方处理"，调用方不存在） |
| baijiahao | `original` | DROPPED：**类型错配**——守卫 `Array.isArray(taskData.original)`，生产者给 `Boolean` ⇒ 分支永不可达 | ★`baijiahao-article.js` 对 `publisher-router.js` 的 `resolved.original = Boolean(...)` |
| baijiahao | `locationName` / `collectionIdText` | DROPPED：写成 `article.location` / `article.collection` 后发布体无人消费（同名 `collection` 命中是草稿箱列表过滤参数，不算） | 后半条为探子报告 |
| douyin | `draft` | PARTIAL：DOM 靠点"草稿"按钮；API 轨读 `opts.draft`，而调用方传的 opts 里没有该键 | 探子报告，未星 |
| douyin | `visibilityType` / 快手 `visibilityType` / 微博 `visible` | PARTIAL：API 轨有、DOM 轨零 ⇒ 回落即丢（用户以为发了私密） | ★DOM 侧依据为上面"通用 DOM 轨读取集"；★`weibo.js`/`kuaishou-video.js` 的 API 侧读取见源码 |
| douyin | `goods` / `taskId`；小红书 `goods` | 注册表标 **`implemented` 但实为 DROPPED**：`goodsInfoList`、`hot_sentence`/`flashMobInfo`、`shopping_cart` 在全仓的非测试命中只有注释或 0 | ★`grep -rn goodsInfoList` 唯一命中是 router 注释行 |
| wechat_mp | `digest`/`massSend`/`freePublish`/`openComment` | CONSUMED（两轨都有） | 探子报告，未星 |

> 顺带记一次归因教训：本文作者曾在未跑命令的情况下断言"`merge-when-green.ps1` 里没有闸门调用、
> 接线锁被一句错误文案骗过"，随后被一次真 `grep -n` 否证。**没有附当场命令的"发现"不算发现。**

## 3. 三条根因（都是机制缺口，不是单个 bug）

1. **`implemented` 无对账**：注册表自证语义，没有任何判据核对"这个字段真有消费点"。
   于是「透传白名单里有」被读成「实现了」——`publish/task-data.js` 的 `PASSTHROUGH_KEYS` 含
   `category`，而四个平台的 builder 零读取。
2. **双轨且默认回落**：`api-then-dom` 是默认，而 DOM 轨的读取集远小于 API 轨 ⇒
   PARTIAL 不是"某条轨没做"这种无害状态，而是**"失败时换语义"**。
3. **面板数据驱动但不过滤语义**：`uiOnly` 只看 `uiExposed && implemented`，两者都由注册表自己声明，
   于是注册表说谎时面板如实渲染一个不起作用的控件。**门禁链上没有任何一环能看见这件事。**

## 4. 缺口的三档性质

- **A 档｜接线断（不需要新取证，纯修码）**：上表 DROPPED/PARTIAL/OVERWRITTEN 全部 + 键名/类型错配。
- **B 档｜已注册未实现（35 条 `platform-capable`）**：抖音 7、快手 9、视频号 6、百家号 5、B站 4、
  知乎 2、微博 2。字段名与取值形态已有竞品 bundle 取证（注册表 `note` 逐条记着出处，2026-10-08 提取证），
  多数属于"把值写进请求体/DOM 操作"。
- **C 档｜注册表根本没有的**：X / Instagram / Facebook 的 `overrideFields` 是**空数组**；
  抖音「选品弹窗怎么搜商品、支持哪些商品来源」「共同创作的合作者搜索」这类**交互链路**未取证。
  C 档必须先做真机取证再进注册表，不得凭印象加字段。

## 5. 实施方案（按"先让说谎变红，再修，最后扩面"排）

| 刀 | 内容 | 验收 | 风险/闸门 |
|---|---|---|---|
| **0-1** | 新建 `scripts/check-publish-field-consumers.js`：按第 1 节命令 ①②③ 的口径机械化——逐字段要求在**该平台的实际路由**上找到消费点；`PASSTHROUGH_KEYS` 命中不算；找不到即红。存量 22 条以**只可缩小**基线登记（同 `doc-abs-paths-baseline.json` 惯例），接 `quality-gate.yml` 的 fail-fast 步骤 | 首跑必须点名列出本文这 22 条（**列不出来说明扫描面退化**）；每条欠账带"缺哪条轨"；变异反证：把消费点查找改成恒真必须红 | 判据本体（`scripts/check-*`）⇒ 高危面，**交人工** |
| **1** | A 档里最坏的 8 处：4 个常量覆盖（`copyright:1`、两处 `{draft:false}`、`'anyone'`）+ 3 个错配（tiktok 键名、baijiahao `original` 类型、youtube playlistId 落点）+ 抖音 DOM 轨可见性 | 每处一个行为用例：喂非默认值断言请求体/DOM 真取值；配"把常量改回去必红"的变异 | 常规面，≤200 源码行 |
| **0-2** | 回落语义守卫：用户显式设过、而 DOM 轨不实现的字段 ⇒ **拒绝回落并点名**（复用 `publish/category-resolver.js` 的 fail-closed 形态），而不是静默换语义 | 行为锁：`visibility=private` + 注入 API 失败 ⇒ 不发出发布请求且报错点名该字段 | **改发布行为**，需先定取向（见第 6 节）+ 真机验证 |
| **2** | 注册表诚实化：本文列出的 7 条"`implemented` 但零消费/被常量掐死"，要么被刀 1 接上，要么状态降为 `platform-capable` 并把控件隐藏/标灰 | 由 0-1 门禁从红转绿的过程即验收；不得靠删基线消红 | 常规面 |
| **3** | 抖音 C 档取证（选品/合作/配乐/允许下载/同步头条）→ 落 `docs/PRD-DOUYIN-PUBLISH-FIELDS-*.md` → 按 A/B 档实现 | 每个字段一次真机发布验证；选择器与字段名进文档留证 | **需你在真机点一遍**；触发平台风控需低频；账号授权见第 6 节 |
| **4** | X / Instagram / Facebook 从零建差异化面 | 同 0-1 门禁 | 海外链路另议 |

**与另一会话的交集**：`#4406`（已并入主干）改掉了 12 处指向不存在脚本的坏字符串并把 `QG Coverage`
抬到 72，但**没有为这类"坏指针"留存在性判据**，也**没碰 0-vs-null 的采集器口径**。两者互补，不重复。

## 6. 未决问题（接手者请先向用户要答案，别自行定）

1. **0-2 的取向**：用户设了 DOM 轨不实现的字段时，是「拒绝发布并点名」还是「照发但显式告警」？
   本审计默认倾向前者（私密变公开是不可逆的对外可见后果），但这是产品裁决。
2. **真机取证的授权**：抖音/YouTube 的 C 档要用真账号点发布页；B 站历史取证发布授权已消耗，
   任何"真投稿"型验证都必须重新取得确认。
3. **是否要一次性覆盖 B 档全部 35 条**，还是按平台逐刀（建议后者，便于回滚与真机验证预算）。
