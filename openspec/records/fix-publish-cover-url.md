---
record: fix-publish-cover-url
task: 修图文平台「有封面无配图」必败 + 微博缺 publish_url 秒失败
date: 2026-10-28
---

## 本次执行记录：图文平台「有封面无配图」必败 + 微博缺 publish_url 秒失败（fix-publish-cover-url，2026-10-28）

> 分支 `fix-publish-cover-url`，隔离 worktree `D:\Data\projects\mp-worktrees\mp-cover-url`。
> 作者起点 `6fcc1cb2`，2026-10-28 在 worktree 内 `git rebase origin/main`（落点 `88640e1c0`），
> 3 个提交无冲突；共享根 `D:\Data\projects\mulpub` 全程只读（未落文件、未 checkout）。

| 门禁 | 状态 | Fresh 证据 |
|------|------|-----------|
| 变更类型与隔离 | PASS | 运行时代码：`apps/desktop/electron/services/rpa-view-platforms.js`、`apps/desktop/src/composables/usePublishFlow.js`、`config/platforms.yaml`、`packages/api-publish-engine/src/platform-entries.js` + 成对 locale（`publish-page/{zh,en}.js` 各 +3 行）；隔离 worktree + 裸分支，共享根未落盘 |
| 第一性原因（QM-5 ①） | PASS | 三条独立根因：① `usePublishFlow` 自动封面分支在「已有封面、无配图」时是**空操作**，而封面通道（`cover_path`/`cover_file`）与配图通道（`image_files`/`images`）不是一回事 ⇒ 小红书图文页在图片上传完成前不渲染标题框与正文编辑器 ⇒ 标题/正文候选**全部超时** ⇒ draft-only 门禁 fail-closed；② `config/platforms.yaml` 的 weibo 段**整段没有 `publish_url`**，而微博没有专用发布方法，只能走 `_publish_generic`（读该字段）⇒ 打开浏览器后 0ms `return {success:false, error:'weibo no publish_url'}`，外层重试把确定性失败当瞬时故障复跑；③ `platform-entries.js` 的 `imagePublishUrls.weibo` 指向**视频**频道 `weibo.com/upload/channel`，该页没有 `PLATFORM_PUBLISH_SELECTORS.weibo` 登记的三条正文候选 ⇒ 必然「content editor not found」 |
| 逃逸分析（QM-5 ②） | PASS | ① 该自动封面分支自 2026-10-12 起**没有任何断言**（`usePublishFlow.test.js` 的 `@/api/publisher` mock 未提供 `generateAiCover`），本次才把「已有封面」的断言从「不生成」改成「不生成 + 复用为配图」；② `config/platforms.yaml` 缺字段**不会被任何测试发现**——`verify-platform-onboarding` 的快照只记块行数与 `has_api`，缺 `publish_url` 的块照样「通过」；③ `imagePublishUrls` 的 weibo 取值**无真机判据**，指向视频频道与首页在单测里无法区分 |
| 修复 + 回归保护（QM-5 ④） | PASS | 修复：① 有本地封面 ⇒ **复用**进配图通道（`normalizePublishFile(cover_path)` 同时写 `image_files`/`images`，新增文案 `coverReusedAsImage`）；仅远程 `cover_url` 或完全无封面才真正生成（远程 URL 不能喂 file input）；② 缺 `publish_url` 时先走双入口映射兜底、仍无才 fail-closed——兜底口径**收敛到 `platform-entries.resolvePublishUrl(platform, kind, configUrl)` 单点实现**（作者原版把分支写在 `rpa-view-platforms.js` 内，该文件是被点名还账的零增长文件，实测 1511 行 > 目标 1499 ⇒ `债务熔断门禁` TARGET_GREW；按还债路径「拆到独立模块」把分支搬进 `packages/api-publish-engine` 的单一真源，**未上调任何 targets**）；③ 微博图文入口改 `https://weibo.com/`（视频入口仍留 `videoPublishUrls.weibo`）。回归锁：`usePublishFlow.autocover.test.js` 10 例（含复用/远程 URL 两格）、`verify-platform-onboarding.test.js` weibo 块行数快照 14→23（`has_api` 仍 false） |
| 防止再次发生（QM-5 ⑤） | PASS | 把「封面通道 ≠ 配图通道」写进代码注释与 locale 键注释；`verify-platform-onboarding.test.js` 的表头「本表记录现状，配置有意变更时同步更新」被本次显式引用，weibo 块行数快照不再靠人肉目测；`resolvePublishUrl` 把「config 优先、映射兜底、两者皆无才空」变成可单测的单点函数（`node -e` 四格探针见下行） |
| 测试 | PASS | `apps/desktop` vitest 5 文件 **179 passed**（`usePublishFlow.autocover` 10 / `usePublishFlow` 82 / `usePublishFlow.m1-reentry` 3 / `rpa-view-platforms` 79 / `rpa-view-platforms-zhihu-publish` 5）；`node --test scripts/verify-platform-onboarding.test.js` **21/21 pass**；`packages/api-publish-engine/test/platform-entries.test.js` **4/4 passed**；`resolvePublishUrl` 探针：`weibo/image/' '`→`https://weibo.com/`、`weibo/image/'https://x/'`→`https://x/`（config 优先）、`youtube/image/' '`→`''`（fail-closed）、`weibo/video/' '`→`https://weibo.com/upload/channel`（按 kind 分流）；locale `--symmetry` PASS（pairs=62 drift=0）、`--keys` PASS（2598 key）、`--pair-base origin/main` PASS |
| 行尾与 diff 对账 | PASS | `git diff --numstat` 与 `--ignore-cr-at-eol --numstat` **逐行相等**（10 文件：59/0、6/3、9/4、24/15、3/0、3/0、9/0、54/0、14/2、7/2；删除行全部由本次改写承担，无 CRLF 混入） |
| 债务熔断（max-lines） | PASS | `MP_BASE_REF=origin/main node .github/scripts/check-max-lines.js` rc=0；`rpa-view-platforms.js` **1498 行 ≤ 点名目标 1499**（抽取前实测 1511 > 1499 ⇒ TARGET_GREW red；`max-lines-baseline.json` 的 targets **未改动**） |
| 接线棘轮 | PASS | 本 PR **未新增** `*.test.js`（8 个文件里只有 2 个既有测试被改）；`scripts/verify-platform-onboarding.test.js` 被 `quality-gate.yml:392` 显式点名；`usePublishFlow.autocover.test.js` 由 `apps/desktop` 的 vitest 收集（Electron CI「Unit tests (Vitest)」） |
| QM-1 打包 / QM-4 视觉 | QM-1 由 CI 实证 / QM-4 N/A | 触及 `apps/desktop/electron/` ⇒ QM-1 适用：本 PR 的 `Build & Release` job 在 `package-relevant=true` 时执行 `electron-builder --win --x64 -p never` 并跑 `check-asar-test-files.js`（app.asar + resources 两通道），以该 job 的 run 读数为准（见本 PR checks）。QM-4 不适用：无视图/样式改动 |
| QM-6 CCG 双模型外部评审 | 未执行（tier 缺席，如实登记） | 本机无 `codeagent-wrapper` / 外部评审后端，`sh scripts/deep-review.sh` 未跑；变更面为发布链服务层（renderer composable + electron service + config + 入口映射），**不含** `scripts/check-*` 判据本体、`.github/workflows/**`、`CI_IGNORED_PATHS`、闭环状态白名单。按 AGENTS.md:1140 两条出口均未走 ⇒ 不以自审冒充通过，`deepReview.tier` 保持缺席 |
| 远程同步 | 由门禁推导 | 本行不需要事后改写：合并后由 `scripts/lib/merge-ledger.js` 按主干历史（squash 尾注 `(#4074)`）推导。合并前写 `PASS` 会被判「预写不存在的证据」 |

### 遗留（不假装已闭合）

- **微博未真发**：`publish_url` 改成首页 + 图文入口与视频入口分开，依据是 `PLATFORM_PUBLISH_SELECTORS.weibo` 的三条正文候选都指向首页发布框；本次**没有**真机发一条微博（对外动作未获授权），所以「发送成功」这一格仍未取证。
- **小红书等图文平台的整链验证**：复用封面为配图的修复由单测断言（`image_files`/`images` 同时落值），真机复跑（图片上传 → 标题框渲染 → draft-only 通过）不在本次范围内。
- 2026-10-12 那条「省一次生图调用」的初衷保留：有本地封面时仍然**不**额外生成，只复用。

## CHANGELOG 条目

# fix(publish): 图文平台「有封面无配图」不再必败，微博补回发布入口（fix-publish-cover-url）

- 只选了封面、没选配图时，封面图会被**同时复用为配图**，不再让小红书/快手/抖音/头条在图片上传前卡住（此前表现为标题框与正文编辑器全部超时、draft-only 门禁中止整批发布）。
- 远程封面 URL 无法作为本地文件上传，这种形态改为生成一张配图——此前它会让图文平台空着配图出发。
- 微博平台段补回 `publish_url`：此前该字段整段缺失，而微博只能走通用发布方法，于是每次发布在打开浏览器后 0ms 就失败，并被重试机制反复复跑。
- 微博图文入口从视频上传频道 `weibo.com/upload/channel` 改回首页 `https://weibo.com/`（视频入口不变），避免走「正文编辑器找不到」的死路。

## learnings

### lesson: 两个"看起来一样"的字段通道不能互相替代（cover 通道 ≠ image 通道）

**现场**：`usePublishFlow.js` 的自动封面分支，2026-10-12 为省一次生图调用把「已有封面」改成空操作；2026-10-20 真机日志显示小红书图文发布在 `app-run.log` 里标题与正文候选全部超时、draft-only 门禁 fail-closed 中止整批，而单测全绿。

**根因**：`cover_path`/`cover_file` 是给「封面必填」平台（公众号）的通道，`image_files`/`images` 是给「至少一张图」平台（小红书等）的通道。省掉一次生成等于**没写另一个通道**，而下游页面在图片上传完成前不渲染标题框——失败点离根因隔了两层，表现为选择器超时。

**可复用的 N 条**：

1. 「不重复做事」和「两个通道都填上」是两件事：能复用就复用（把 A 落进 B），不能复用才新建；优化掉的那一步如果承担着填充义务，优化本身就是缺陷。
2. 判断"某个配置字段缺失"必须有判据：缺 `publish_url` 这类字段在快照型测试里完全隐形（块行数快照只管行数），而它的后果是 0ms 确定性失败 + 重试放大 ⇒ 让确定性失败伪装成瞬时抖动。
3. 同名入口要带"用途"后缀区分：`weibo.com/upload/channel` 是视频频道、`weibo.com/` 是图文首页，两个键（`videoPublishUrls` / `imagePublishUrls`）指向同一平台时，取值依据必须写在注释里可核。
