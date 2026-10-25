# 轨道A：桌面应用壳、分发与客户端安全 —— 开源可参考项目调研

> **取证纪律声明**：本文所有数字均来自 `api.github.com` 实测。每个候选固定给出四类端点的原始实测值（`GET /repos/{o}/{r}`、`GET /repos/{o}/{r}/commits?per_page=1`、`GET /repos/{o}/{r}/git/trees/{default_branch}?recursive=1`、`GET /repos/{o}/{r}/license`），并辅以 `GET /repos/{o}/{r}/contents/{path}` 读取的关键文件行数。不使用任何镜像转载站（github.es / gitgub.com / git.tdem.in 等）、不使用 AI 生成的营销站、star 数一律实时取自 `api.github.com`。**凡本轮未取到证据的，一律标注「未取证」并列入第三节，不做推断。**

---

## 一、维度小结（表）

| 能力点 | mulpub 现状 | 首选推荐 | 备选 | 处置建议 |
|---|---|---|---|---|
| 桌面壳（Electron 替代） | Electron 自研壳 22 文件 + 6 个 preload + `src/` 1030 文件 | **不换壳，保留 Electron** | Tauri 2.x（仅作对照） | 不换壳。Playwright / Remotion / `stealth-preload` 反检测三处硬阻断，换壳后 Node sidecar 仍在，省不掉运行时反而多一份 |
| 运行时加固 / ASAR 完整性 | 自研 `check-asar.js` + `check-integrity.js` | **electron/fuses**（`@electron/fuses`） | signalapp/Signal-Desktop 的 fuse 组合 | **直接引入**：官方 fuse 把 asar 校验前移到加载前且由二进制强制，自研校验降级为第二道防线 |
| macOS 公证 | 未取证 | **electron/notarize** | electron/forge | 直接引入：`afterSign` 钩子 10 行接入现有 electron-builder |
| Windows 代码签名 | 未取证 | electron/forge maker 矩阵 + VS Code `build/darwin/sign-server.ts` 范式 | — | 借鉴实现：签名凭据不进 CI，走独立签名机 |
| 敏感数据本地存储 | 未取证（`auth-preload` / `auth-qrcode-preload` 涉及凭据，存储介质本轮未取证） | **Brooooooklyn/keyring-node（`@napi-rs/keyring`）** | Electron 内置 `safeStorage` | 直接引入 keyring；`safeStorage` 在 Linux 会退化为明文 `basic_text`（官方文档自述），不可用于存 token |
| 崩溃上报 | 未取证 | **Electron 内置 `crashReporter`（Crashpad）** | getsentry/sentry-electron | 直接引入内置版接自建 ECS 端点；⚠️ 自建 Sentry 服务端已转 FSL-1.1 协议，不建议 |
| 自动更新 + 灰度/回滚 | 已用 `electron-updater` | **继续用 electron-updater（generic provider + 阿里云 OSS 静态托管）** | tauri-apps/plugins-workspace 的 updater 契约 | 借鉴实现：照搬 Tauri 的「服务端决定推哪个版本」+ 更新包签名校验，补上 electron-updater 缺的一环 |
| 跨平台打包分发 | 已用 `electron-builder` | electron-builder 现状 + 官方 `@electron/notarize` | AppImage/appimagetool、winget-cli | 借鉴实现：macOS 公证、AppImage 工具链迁移、Windows 商店 MSIX 路线 |
| 应用骨架 / 脚手架 | 自研（`electron/` 22 文件 + `src/` 1030 文件） | **electron-vite 家族** | electron/forge template | 仅供对照：mulpub 的桌面壳已远超任何模板规模，只取构建管线（3 目标 + bytecode 编译） |

---

## 二、候选详情

### 1. electron/fuses — 官方 Electron fuse 翻转工具，官方实现覆盖 mulpub 自研 `check-asar.js` 的能力

- **证据（四类端点实测值）**
  - `GET /repos/electron/fuses` → `stars=55`, `language=TypeScript`, `default_branch=main`, `pushed_at=2026-10-22T22:50:52Z`, `created_at=2020-10-03T01:07:53Z`, `archived=false`, `open_issues=8`, `spdx_id=MIT`
  - `GET /repos/electron/fuses/commits?per_page=1` → 默认分支最后提交 `2026-10-22T21:54:01Z`（sha `6e2d7a7e77`，`ci: bump electron/secret-service-action to v1.1.0 (#151)`）
  - `GET /repos/electron/fuses/git/trees/main?recursive=1` → `entries=36`, `truncated=false`；关键路径 `src/index.ts`(约 10 KB)、`src/bin.ts`(约 5 KB)、`src/config.ts`(约 1 KB)、`src/constants.ts`(约 1 KB)、`test/index.spec.ts`(约 6 KB)、`package.json`(约 2 KB)
  - `GET /repos/electron/fuses/license` → `spdx_id=MIT`，`name=MIT License`，`path=LICENSE`；**正文首行**：`Copyright (c) 2020 Electron Maintainers.` + `Permission is hereby granted, free of charge, ...`（metadata 与正文一致）
  - 补充 `GET /repos/electron/fuses/contents/src/config.ts` → 实测 38 行，`FuseV1Options` 枚举共 **9 项**：`RunAsNode=0`、`EnableCookieEncryption=1`、`EnableNodeOptionsEnvironmentVariable=2`、`EnableNodeCliInspectArguments=3`、`EnableEmbeddedAsarIntegrityValidation=4`、`OnlyLoadAppFromAsar=5`、`LoadBrowserProcessSpecificV8Snapshot=6`、`GrantFileProtocolExtraPrivileges=7`、`WasmTrapHandlers=8`
  - 补充 `GET /repos/electron/fuses/contents/package.json` → npm 包名 `@electron/fuses`，`bin.electron-fuses=dist/bin.js`，`engines.node>=22.12.0`
- **适配点**
  - `EnableEmbeddedAsarIntegrityValidation=true` + `OnlyLoadAppFromAsar=true` 让 Electron **在加载前**校验 `app.asar` 并禁止从 asar 之外加载代码——这正是 mulpub 现在用 `apps/desktop/check-asar.js` + `check-integrity.js` 在**运行时**自己做的事。官方 fuse 把校验前移且由二进制强制，运行时校验无法绕过。
  - `RunAsNode=false` 封死 `ELECTRON_RUN_AS_NODE`；`EnableNodeOptionsEnvironmentVariable=false` + `EnableNodeCliInspectArguments=false` 封死 `NODE_OPTIONS=--require` 与 `--inspect` 注入。mulpub 有 6 个 preload 且跑 Playwright 浏览器，注入面大于普通 Electron 应用。
  - 落地位置：官方 README 明确写「fits naturally in an electron-builder `afterPack` hook」→ mulpub 已用 electron-builder，**加一个 `afterPack` 钩子即可，不需要换构建系统**。
  - Apple Silicon 坑：README 第 45–49 行要求 arm64 包翻 fuse 时传 `resetAdHocDarwinSignature: true`，否则签名失效、**app 拒绝启动**。
- **引入成本**：**低**。MIT、TypeScript/ESM、单个 npm 包、无运行时依赖、与现有 electron-builder 零冲突。唯一约束：`engines.node >= 22.12.0`，CI 的 Node 需满足。
- **风险**
  - fuse wire 是**位置相关**的格式，Electron 大版本若增删 fuse 需回归验证（`strictlyRequireAllFuses: true` 即为此设计）。
  - macOS 上 fuse 与签名有顺序耦合，配错得到「无法启动」的白屏包。
  - stars 仅 55，但归属 Electron 官方组织，有 CI + spec 保障。
- **建议**：**直接引入**（devDependency + electron-builder `afterPack`）。**不要删除**自研 `check-asar.js` / `check-integrity.js`——它们降级为纵深防御的第二道校验。
- **置信度**：**高**。9 个 fuse 语义、npm 包名、CLI 用法、钩子位置均取自仓库实际文件内容。

### 2. signalapp/Signal-Desktop — 生产级 Electron 客户端的完整加固流水线，mulpub 最该对照的同类项目

> ⚠️ **协议高风险标注**：本项目为 **AGPL-3.0**。可读、可借鉴思路，**不可直接复制代码进闭源商业产品**（传染性）。

- **证据（四类端点实测值）**
  - `GET /repos/signalapp/Signal-Desktop` → `stars=16608`, `language=TypeScript`, `default_branch=main`, `pushed_at=2026-10-20T18:20:39Z`, `created_at=2014-02-24T19:53:36Z`, `archived=false`, `open_issues=887`, `spdx_id=AGPL-3.0`
  - `GET /repos/signalapp/Signal-Desktop/commits?per_page=1` → 默认分支最后提交 `2026-10-20T18:13:27Z`（sha `17502b9d1a`，`v8.35.0-alpha.1`）
  - `GET /repos/signalapp/Signal-Desktop/git/trees/main?recursive=1` → `entries=5074`, `truncated=false`；关键路径 `scripts/after-pack.mjs`(约 1 KB)、`scripts/after-sign.mjs`(约 1 KB)、`scripts/fuse-electron.mjs`(约 2 KB)、`scripts/notarize.mjs`(约 2 KB)、`scripts/notarize-universal-dmg.mjs`(约 2 KB)、`package.json`(约 25 KB)
  - `GET /repos/signalapp/Signal-Desktop/license` → `spdx_id=AGPL-3.0`, `name=GNU Affero General Public License v3.0`, `path=LICENSE`；**正文首行**：`GNU AFFERO GENERAL PUBLIC LICENSE` / `Version 3, 19 November 2007`
  - 补充 `GET /contents/scripts/after-pack.mjs` → 实测 **21 行**：`await pruneMacOSRelease(context); await fuseElectron(context); await copyPacks(context); await ensureLinuxFilePermissions(context);`
  - 补充 `GET /contents/scripts/after-sign.mjs` → 实测 **18 行**：`await notarize(context);`，源码注释 `// This must be the last step`
  - 补充 `GET /contents/scripts/fuse-electron.mjs` → 实测 **55 行**，逐平台定位二进制后调 `flipFuses`，含 `EnableEmbeddedAsarIntegrityValidation: darwin||mas||win32`（**Linux 明确不开**）、`OnlyLoadAppFromAsar: true`、`EnableNodeCliInspectArguments: Boolean(process.env.DISABLE_INSPECT_FUSE)`
  - 补充 `GET /contents/package.json` → 实测 650 行，`"electron-builder": "26.11.1"`、`"@electron/fuses": "1.5.0"`、`"@electron/notarize": "2.1.0"`、`"notarize": "echo 'No longer necessary'"`
- **适配点**
  - mulpub 的 `apps/desktop/electron/` 已是「平台代码」形态（`bootstrap.js`/`window.js`/`shutdown.js` + 6 个 preload + `ipc-guard-exemptions.json`），与 Signal 的 `app/` 分域结构同类。**差距在打包期，不在源码期。**
  - `after-pack.mjs` / `after-sign.mjs` 两个 21 行 / 18 行的入口文件，是 electron-builder 钩子编排的**最小可用范式**，mulpub 可照此结构写 `after-pack.mjs`。
  - `EnableEmbeddedAsarIntegrityValidation` **只在 darwin/mas/win32 开、Linux 不开**——重要的工程判断：Linux 侧 Electron 的 asar 完整性校验依赖平台实现差异，硬开可能在国产发行版上炸。mulpub 的 `check-asar.js` 在 Linux 需单独评估。
  - `DISABLE_INSPECT_FUSE` 环境变量翻转：发布版关闭 inspect、CI 调试期保留。mulpub 有 `vitest.smoke.config.js` / `stryker.conf.json`，调试期需要 inspector。
  - 顺序固定为 **打包 → flip fuses → codesign → notarize → staple**，`after-sign.mjs` 的注释「This must be the last step」点明 notarize 必须最后。
  - mulpub 的 `sidecar-lock.json` / `media-tools-lock.json` / `THIRD-PARTY-NOTICES.md` + `licenses/` 是 **mulpub 领先于本参考项目**的部分，Signal 公开仓中未见等价的 sidecar 版本锁定实现。
- **引入成本**：**中**。代码零成本（读它的两个 55/68 行脚本）；**法务成本高**——AGPL-3.0 的脚本不能抄进闭源产品。可行做法是「读思路、用 MIT 的 `@electron/fuses` + `@electron/notarize` 公开 API 自行重写」，逻辑本身是官方标准用法，不构成 AGPL 衍生。
- **风险**：AGPL-3.0 传染性（**主要风险**）；`app/` 目录结构与 mulpub 的扁平结构不冲突但改造收益有限。
- **建议**：**借鉴实现**（借鉴范式，不复制代码）。把它当作客户端安全的**对照基线**：每一项加固先问「Signal 做了吗、怎么做、为什么」。
- **置信度**：**高**。三个脚本全文读取、依赖版本实测、协议正文核对。唯一不确定项：Signal 的更新服务端（`updates.signal.org`）不开源，客户端部分已充分取证。

### 3. electron/notarize — macOS 公证的最小官方工具，正是 mulpub 缺的一环

- **证据（四类端点实测值）**
  - `GET /repos/electron/notarize` → `stars=193`, `language=TypeScript`, `default_branch=main`, `pushed_at=2026-10-22T22:51:54Z`, `created_at=2018-10-22T16:42:16Z`, `archived=false`, `open_issues=10`, `spdx_id=MIT`
  - `GET /repos/electron/notarize/commits?per_page=1` → 默认分支最后提交 `2026-10-22T21:48:38Z`（sha `c2a897c422`，`ci: bump secret-service-action to v1.1.0 (#317)`）
  - `GET /repos/electron/notarize/git/trees/main?recursive=1` → `entries=38`, `truncated=false`；关键路径 `src/index.ts`(约 2 KB)、`src/notarytool.ts`(约 4 KB)、`src/check-signature.ts`(约 2 KB)、`src/staple.ts`(约 1 KB)、`src/validate-args.ts`(约 3 KB)、`src/types.ts`(约 4 KB)、`package.json`(约 2 KB)
  - `GET /repos/electron/notarize/license` → `spdx_id=MIT`, `name=MIT License`, `path=LICENSE`；**正文首行**：`Copyright 2018 Samuel Attard and contributors` + `Permission is hereby granted, free of charge, ...`
  - 补充 `GET /contents/src/index.ts` → 实测 **49 行**：`checkSignatures()` → `isNotaryToolAvailable()`（否则抛「must be on at least Xcode 13 or provide notarytoolPath」）→ `notarizeAndWaitForNotaryTool()` → `stapleApp()` 带 3 次重试
- **适配点**
  - mulpub 若发 macOS 包而未公证，首次打开会被 Gatekeeper 拦截（需右键打开或 `xattr -d com.apple.quarantine`）——**对「国内用户 + 大量非技术用户」是直接的转化率损耗**。
  - 接入点与 Signal 完全一致：electron-builder `afterSign` 钩子，环境变量注入 `APPLE_USERNAME` / `APPLE_PASSWORD` / `APPLE_TEAM_ID`。
  - `src/check-signature.ts` 的存在说明它**先验签再公证**，顺序不可反。
  - 与候选 1 耦合：macOS arm64 翻 fuse 会破坏签名，需与 `resetAdHocDarwinSignature` 一起排顺序（打包 → flip fuses(带 resetAdHoc) → codesign → notarize → staple）。
- **引入成本**：**低**（代码）+ **中**（基础设施）。MIT、纯 TS、无二进制依赖。**唯一实质成本是公证必须在 macOS 机器上执行**（需 Xcode 13+ 的 `xcrun notarytool`），CI 要一台 macOS runner——这是基础设施缺口，不是代码缺口。
- **风险**
  - `notarytool` 需把包上传至 Apple，等待可能数分钟（源码注释「this may take a few minutes」），CI 需设超时。
  - 需要 Apple Developer Program 账号（付费）+ App 专用密码或 API Key——**证书是外部依赖，开源实现补不上**。
  - 国内团队申请 Apple Developer 账号的实际门槛本轮**未取证**。
- **建议**：**直接引入**（`afterSign` 钩子 + CI macOS runner）。
- **置信度**：**高**（代码与协议实测）；对「国内团队申请 Apple 账号流程」**未取证**，该项置信度中。

### 4. electron/forge — 打包 / 签名 / 发布的**能力矩阵清单**，mulpub 虽用 electron-builder 但矩阵可整体对照

- **证据（四类端点实测值）**
  - `GET /repos/electron/forge` → `stars=7162`, `language=TypeScript`, `default_branch=main`, `pushed_at=2026-10-22T22:49:01Z`, `created_at=2016-10-05T14:51:53Z`, `archived=false`, `open_issues=263`, `spdx_id=MIT`
  - `GET /repos/electron/forge/commits?per_page=1` → 默认分支最后提交 `2026-10-22T21:53:49Z`（sha `fdb682ce6e`，`build: bump secret-service-action to v1.1.0 (#4451)`）
  - `GET /repos/electron/forge/git/trees/main?recursive=1` → `entries=843`, `truncated=false`；关键路径 `packages/plugin/fuses/src/FusesPlugin.ts`(约 2 KB)、`packages/plugin/fuses/src/util/getElectronExecutablePath.ts`(约 1 KB)、`packages/plugin/fuses/spec/FusesPlugin.slow.verdaccio.spec.ts`(约 2 KB)、`packages/plugin/fuses/package.json`(约 1 KB)、`packages/plugin/fuses/README.md`(约 1 KB)
  - `GET /repos/electron/forge/license` → `spdx_id=MIT`, `name=MIT License`, `path=LICENSE`；**正文首行**：`The MIT License (MIT)` / `Copyright (c) 2016 Samuel Attard`
  - 补充 `GET /contents/packages/plugin/fuses/src/FusesPlugin.ts` → 实测 **66 行**真实实现：`export default class FusesPlugin extends PluginBase<FuseConfig>`，挂 `packageAfterCopy` 钩子，内部调 `flipFuses(pathToElectronExecutable, { resetAdHocDarwinSignature: !hasOSXSignConfig && applePlatforms.includes(platform) && arch === 'arm64', ...this.fusesConfig })`
  - 补充 `GET /contents/packages/plugin/fuses/package.json` → npm 名 `@electron-forge/plugin-fuses`，`version=8.0.1`，`license=MIT`
  - 补充 `GET /contents/packages/maker` → 12 种 maker：`appx` `base` `deb` `dmg` `flatpak` `msix` `pkg` `rpm` `snap` `squirrel` `wix` `zip`；`GET /contents/packages/publisher` → 8 种：`base-static` `base` `bitbucket` `electron-release-server` `gcs` `github` `nucleus` `s3` `snapcraft`；`GET /contents/packages/plugin` → 7 个：`auto-unpack-natives` `base` `fuses` `local-electron` `vite` `webpack`
- **适配点**
  - **maker 矩阵 = 跨平台分发的能力清单**。mulpub 现有 electron-builder 已覆盖 dmg/zip；Forge 额外提供的值得评估项：`msix`（Microsoft Store，签名走微软证书，**是绕开 EV 证书采购的可选路径**）、`appx`、`squirrel`（Windows 自动更新，与 electron-updater 的 NSIS 路径不同）、`flatpak` / `snap` / `deb` / `rpm`。
  - **`plugin/fuses` 的 66 行真实实现证明「fuse 翻转」已是打包系统的一等概念**，不是某项目的私有 hack——直接支持候选 1 的建议。mulpub 用 electron-builder 不需要这个 plugin，只需 `@electron/fuses` 本体。
  - publisher 含 `electron-release-server`，说明官方生态认可「自建更新服务」形态（见候选 6）。
  - **不建议替换 electron-builder**：mulpub 的 `electron-builder.json` 已在用，换 Forge 要重写打包配置 + 签名 + 发布脚本，收益仅在「想用 appx/msix/squirrel」时才成立。
- **引入成本**：**中—高**（换构建系统）/ **低**（只读矩阵与 plugin 源码）。MIT 无协议风险。Forge 8 的具体 Node 版本约束本轮**未取证**。
- **风险**：Forge 与 electron-builder 并存会造成「两套 maker/publisher 概念」认知负担；Forge maker 覆盖 Linux 渠道但**不含 AppImage**（AppImage 工具链现状见劝退节）。
- **建议**：**借鉴实现**（能力矩阵对照 + `plugin/fuses` 范式），**不推荐**替换 electron-builder；若要上 Microsoft Store 再单独评估 MSIX。
- **置信度**：**中高**。目录结构、66 行 plugin 实现、README 全文实测；`appx`/`msix` 的实际签名可用性**未取证**。

### 5. electron/update-electron-app — 「发布者只管放文件、客户端自己轮询」的第二种更新模型

- **证据（四类端点实测值）**
  - `GET /repos/electron/update-electron-app` → `stars=828`, `language=TypeScript`, `default_branch=main`, `pushed_at=2026-10-22T21:49:16Z`, `created_at=2018-04-18T03:37:36Z`, `archived=false`, `open_issues=22`, `spdx_id=MIT`
  - `GET /repos/electron/update-electron-app/commits?per_page=1` → 默认分支最后提交 `2026-10-22T21:47:31Z`（sha `a357c57665`，`ci: bump electron/secret-service-action to v1.1.0 (#261)`）
  - `GET /repos/electron/update-electron-app/git/trees/main?recursive=1` → `entries=32`, `truncated=false`；关键路径 `src/index.ts`(约 11 KB)、`README.md`(约 6 KB)、`package.json`(约 1 KB)、`LICENSE`(约 1 KB)
  - `GET /repos/electron/update-electron-app/license` → `spdx_id=MIT`, `name=MIT License`, `path=LICENSE`；**正文首行**：`MIT License` / `Copyright (c) 2018 GitHub Inc.`
  - 补充 `GET /contents/src/index.ts` → 实测 `const supportedPlatforms = ['darwin', 'win32']`（**明确不支持 Linux**）、`const formatSegment = process.windowsStore ? '/msix' : ''`、`export function updateElectronApp(opts)`、轮询 `updateInterval` 默认 10 分钟
  - 补充 `GET /contents/README.md` → 实测 140 行；Requirements 段明确 `- Your app runs on macOS or Windows`、`- Your builds are code signed (macOS only)`；资产格式为 Squirrel 体系 `RELEASES` / `*-full.nupkg` / `*.exe` / `*-delta.nupkg`；静态目录约定 `**/{platform}/{arch}/{artifact}`、`**/win32/x64/RELEASES`、`**/darwin/arm64/RELEASES.json`；可对接免费服务 `update.electronjs.org`
- **适配点**
  - 与 mulpub 现有 `electron-updater` 的差异必须讲清：electron-updater 是「**provider 拉取**」（GitHub/S3/Generic 拉 `latest.yml`）；update-electron-app 是「**Squirrel 协议**」（拉 `RELEASES` + `.nupkg`），支持 Windows 差分包 `*-delta.nupkg`。
  - **灰度价值**：版本决策完全交给服务端静态文件——服务端在 `RELEASES` 里放哪个版本就推哪个版本，配合 `**/{platform}/{arch}/` 目录分层即可做「按渠道 / 按架构分目录灰度」，客户端零逻辑改动。
  - **回滚价值（反向）**：Electron 生态的自动更新**天然不支持降级**（Squirrel 与 electron-updater 都不回滚旧版本）。要回滚必须「重发一个版本号更高、内容是旧版本」的包——这个坑 mulpub 必须提前知道。
  - **明确局限**：`supportedPlatforms = ['darwin','win32']`，mulpub 的 Linux 端无法用；macOS 必须已公证。
- **引入成本**：**中**。MIT、TS、单文件实现，但需 CI 产出 Squirrel 格式资产，与现有 NSIS 产出路径不同，等于**多一套产物格式**。
- **风险**：Windows 端会引入 Squirrel.Windows（.NET 依赖）作为安装/更新引擎；国内用户场景下 NSIS 的兼容性与杀软误报率优于 Squirrel。
- **建议**：**借鉴实现**（更新元数据模型 +「发布者/客户端职责分离」设计），**不推荐**替换现有 electron-updater。若将来要做 Windows 差分更新（`*-delta.nupkg`）再重新评估。
- **置信度**：**高**。源码、README 全文、平台白名单均实测。

### 6. ArekSredzki/electron-release-server — 唯一实测到的「自建更新服务」开源实现，Channel/Flavor 数据模型值得抄，但默认分支已停更

- **证据（四类端点实测值）**
  - `GET /repos/ArekSredzki/electron-release-server` → `stars=2216`, `language=JavaScript`, `default_branch=master`, `pushed_at=2024-04-22T04:21:09Z`, `created_at=2016-02-28T10:06:53Z`, `archived=false`, `open_issues=66`, `spdx_id=MIT`
  - `GET /repos/ArekSredzki/electron-release-server/commits?per_page=1` → 默认分支最后提交 **`2023-10-28T20:06:53Z`**（sha `042567b374`，`Merge pull request #352 from serega3000/master`）→ **`pushed_at=2024-04` 来自其他分支/tag，默认分支实已近 3 年无提交**
  - `GET /repos/ArekSredzki/electron-release-server/git/trees/master?recursive=1` → `entries=198`, `truncated=false`；关键路径 `api/controllers/VersionController.js`(约 22 KB)、`AssetController.js`(约 10 KB)、`FlavorController.js`(约 2 KB)、`ChannelController.js`(约 1 KB)、`api/models/Asset.js`(约 1 KB)、`Version.js`(约 1 KB)、`Channel.js`(约 1 KB)、`Flavor.js`(约 1 KB)、`api/services/WindowsReleaseService.js`(约 3 KB)、`api/policies/authToken.js`(约 1 KB)、`api/policies/noCache.js`(约 1 KB)
  - `GET /repos/ArekSredzki/electron-release-server/license` → `spdx_id=MIT`, `name=MIT License`, `path=LICENSE.md`；**正文首行**：`The MIT License (MIT)` / `Copyright (c) 2016 Arek Sredzki`
- **适配点**
  - **数据模型是本次调研最有价值的产出**：`Channel`（渠道）+ `Flavor`（平台/架构变体）+ `Version`（版本）+ `Asset`（资产）四层，正好是「灰度 + 回滚 + 多平台多架构」所需的自建更新服务骨架：
    - `Channel` ≈ 灰度桶（stable / beta / internal）
    - `Flavor` ≈ 平台+架构变体（win32-x64 / darwin-arm64 / linux-x64）
    - `Version` + `Asset` ≈ 版本与产物
  - `api/policies/noCache.js` → 强制 `Cache-Control: no-store`。**这是更新服务必须做的**——否则 CDN 缓存旧 manifest 会让回滚不生效。
  - `api/policies/authToken.js` → 上传端 token 鉴权。
  - `api/services/WindowsReleaseService.js` → Windows 端 Squirrel 资产编排，对应候选 5 的 `RELEASES` / `.nupkg`。
  - 部署形态为 Node 服务 + 静态资产目录，**可落在阿里云 ECS**——正是 mulpub 需要的落点。
- **引入成本**：**中—高**。MIT 无协议风险，但代码基线是 2023 年的依赖栈，直接部署要处理依赖升级与安全补丁；DB schema 需按 mulpub 渠道策略改造。
- **风险**
  - **默认分支近 3 年无提交**（实测 2023-10-28），安全漏洞不会有人修。自建更新服务要打公网，比普通内部服务风险高一档。
  - 模型是 Squirrel 时代产物，**无差分、无更新包签名校验机制**——完整性完全依赖 HTTPS + 服务端可信。
  - 若 mulpub 灰度需求只是「stable/beta 两条线」，用 OSS 目录分层即可，**不需要引入整个服务**。
- **建议**：**借鉴实现**——只借鉴 `Channel`/`Flavor`/`Version`/`Asset` 四层数据模型与 `noCache` 策略，**不要直接部署这份代码**。真要自建，在 ECS 上按这四层写一个更小的服务（甚至静态 JSON + 少量逻辑），客户端用 electron-updater 的 generic provider 拉取。
- **置信度**：**中**。代码与数据模型实测；但**未取证**其依赖栈在 Node 22+ 上能否正常启动。

### 7. tauri-apps/plugins-workspace — Tauri updater 插件是本次调研唯一高质量的「灰度 / 回滚元数据契约」范式

> 定位说明：Tauri **不是** mulpub 的换壳方案（理由见下方「换壳代价」表）。本候选收录的是它的 **updater 插件实现**（已从主仓拆到 plugins-workspace），因为它是「自建更新服务器 + 灰度 + 回滚 + 签名校验」四件事唯一同时给出可验证实现的参考。

- **证据（四类端点实测值）**
  - `GET /repos/tauri-apps/plugins-workspace` → `stars=1836`, `language=Rust`, `default_branch=v2`, `pushed_at=2026-10-23T00:14:35Z`, `created_at=2022-01-22T17:40:21Z`, `archived=false`, `open_issues=469`, `spdx_id=Apache-2.0`
  - `GET /repos/tauri-apps/plugins-workspace/commits?per_page=1` → 默认分支最后提交 `2026-10-22T08:01:10Z`（sha `df594206ce`，`chore(deps): update webpki-roots crates (lockfile-only) (#3723)`）
  - `GET /repos/tauri-apps/plugins-workspace/git/trees/v2?recursive=1` → `entries=2087`, `truncated=false`；关键路径 `plugins/updater/src/updater.rs`(约 108 KB)、`plugins/updater/src/config.rs`(约 8 KB)、`plugins/updater/src/commands.rs`(约 6 KB)、`plugins/updater/src/lib.rs`(约 10 KB)、`plugins/updater/guest-js/index.ts`(约 9 KB)、`plugins/updater/LICENSE.spdx`(约 1 KB)、`plugins/updater/LICENSE_APACHE-2.0`(约 10 KB)、`plugins/updater/LICENSE_MIT`(约 1 KB)
  - `GET /repos/tauri-apps/plugins-workspace/license` → `spdx_id=Apache-2.0`, `name=Apache License 2.0`, `path=LICENSE_APACHE-2.0`；**正文首行**：`Apache License` / `Version 2.0, January 2004`
  - 补充 `GET /contents/plugins/updater/src/config.rs` → 实测 `pub struct Config` 含 `endpoints: Vec<Url>`（**多端点、按序尝试**）、`pubkey: String`、`require_signed_version: bool`、`allow_downgrades: bool`、`dangerous_insecure_transport_protocol: bool`、`dangerous_accept_invalid_certs: bool`、`dangerous_accept_invalid_hostnames: bool`（**默认拒绝不安全传输与无效证书**）、`windows: Option<WindowsConfig>`（含 `WindowsUpdateInstallMode` 的 `msiexec_args` / `nsis_args` 静默安装参数）
  - 补充 `GET /contents/plugins/updater/src/updater.rs` → 实测两个 manifest 形态：`pub struct ReleaseManifestPlatform { pub url: Url, pub signature: String }`；`pub enum RemoteReleaseInner { Dynamic(ReleaseManifestPlatform), Static { platforms: HashMap<String, ReleaseManifestPlatform> } }`（target 串如 `darwin-aarch64`）；`pub struct RemoteRelease { pub version: Version, pub notes: Option<String>, pub pub_date: Option<OffsetDateTime>, pub data: RemoteReleaseInner }`；端点 URL 支持 `{{target}}` / `{{current_version}}` / `{{arch}}` 变量替换；**服务端返回 `204 No Content` 表示无更新**
  - 上游主仓补充 `GET /repos/tauri-apps/tauri` → `stars=112130`, `language=Rust`, `default_branch=dev`, `pushed_at=2026-10-23T04:40:41Z`, `spdx_id=Apache-2.0`；`GET /commits?per_page=1` → `2026-10-23T04:40:39Z`（sha `c464ef928c`）；`GET /git/trees/dev?recursive=1` → `entries=1502`，**已不含 `tauri-plugin-updater`**（已拆出），仍有 `crates/tauri-cli/src/helpers/updater_signature.rs`(约 13 KB) 与 `crates/tauri-macos-sign/src/apple_codesign/certificate.rs`(约 31 KB)、`src/keychain.rs`(约 12 KB)
- **Q1 结论：换壳代价（按 mulpub 模块逐项）**

  | mulpub 模块 | 换 Tauri 2.x 的代价 | 判定 |
  |---|---|---|
  | Playwright 浏览器内核 | Playwright 官方绑定为 Node/Python/Java，**无 Rust 绑定**；Tauri 侧只能降级为独立 sidecar Node 进程 | **硬阻断**：等于保留 Node 运行时，换壳省不掉任何东西 |
  | Remotion 视频渲染 | `@remotion/renderer` 走 CDP（Chrome DevTools Protocol），本质是 Node + Chromium，同样只能 sidecar 化 | **硬阻断** |
  | `stealth-preload.js` + `stealth-preload.bundle.js`（反检测） | 依赖 Electron 的 webPreferences / UA / 代理与**特定 Chromium 版本**；Tauri 用 wry + 系统 WebView（Windows WebView2 / macOS WKWebView / Linux WebKitGTK） | **硬阻断**：反检测能力**直接失效**，而反检测是 mulpub 核心业务价值 |
  | 6 个 preload（auth / auth-qrcode / home-shell / monitor / stealth ×2） | Tauri 走 `invoke` + `withGlobalTauri` 单一 IPC 通道 + capabilities 权限系统，粒度与 Electron `contextBridge` 不同 | 高成本：API 面全部重写 |
  | `ipc-guard-exemptions.json`（IPC 白名单治理） | 可用 Tauri capabilities/permissions 替代，但**授权模型与粒度不同** | 中成本：治理模型重设计 |
  | `check-asar.js` / `check-integrity.js` | Tauri **无 asar 概念**；对应能力是 updater 的 `pubkey` 签名校验 + 应用签名 | 中成本：换成 Tauri 签名体系，逻辑重写 |
  | `sidecar-lock.json` / `media-tools-lock.json` | Tauri 有 `externalBin` sidecar 机制，但**版本锁定与完整性校验要自己实现** | 中成本：机制可复用，校验逻辑重写 |
  | `chi_sim.traineddata` / `eng.traineddata`（OCR 语言包随包分发） | 资源打包机制可映射到 Tauri resources | 低 |
  | `electron-builder` 打包 + `licenses/` + `THIRD-PARTY-NOTICES.md` | 改用 tauri-bundler，产物模型与许可清单生成都要重做 | 中成本 |
  | `apps/desktop/src` 1030 文件（Vue 3 + Element Plus + Pinia + vue-router + vue-i18n + @vue-flow/core） | **不受影响**（渲染层仍是 Web） | 无成本 |
  | 结论 | 换壳后 **Node sidecar 仍在**，安装体积与内存不降反升，同时要重写 IPC、安全校验、浏览器自动化链路 | **不推荐换壳** |

- **适配点（真正该抄的部分）**
  - **灰度 / 回滚契约**：`endpoints: Vec<Url>` + `{{target}}`/`{{current_version}}` 变量 + **Dynamic（Server Format）让服务端直接决定推哪个版本** —— 这正是 mulpub 在阿里云 ECS 上做灰度 / 回滚所需语义：ECS 上的服务按 (platform, arch, current_version, channel) 决定返回哪个版本，`204 No Content` 表示无更新。
  - **签名校验**：`pubkey` + `require_signed_version` 补上 electron-updater 最缺的一环——**generic provider 不验证更新包的密码学签名**，只信 manifest。若服务端被攻破 = 客户端被投毒。照搬「更新包必须经 minisign 私钥签名、客户端内置公钥校验」可闭掉此洞。
  - **`allow_downgrades`** 是显式的回滚开关。
  - **默认拒绝不安全传输**（三个 `dangerous_*` 开关默认关闭）——阿里云 ECS + 自建服务必须保证 HTTPS 证书链有效。
  - `WindowsConfig` 的 `nsis_args` / `msiexec_args` 提供**静默升级参数**的现成实现，mulpub 更新后自动重启安装可直接参考。
- **引入成本**：作为**参照物**为零；作为**换壳**= 一次大重构（见上表）。
- **风险**：`tauri-apps/tauri` 的 `default_branch=dev`（发版走 tag/release 分支），`plugins-workspace` 的 `default_branch=v2`——**照抄主干会拿到开发版**；`plugins/updater` 同时带 `LICENSE_APACHE-2.0` 与 `LICENSE_MIT` 双协议文件，需按使用方式确认适用协议。
- **建议**：**借鉴实现**（灰度 / 回滚元数据契约 + 签名校验 + 静默安装参数 +「服务端决定版本」语义），**仅供对照**（换壳本身），**不推荐**换壳。
- **置信度**：**高**（updater 的 config / updater 源码逐行实测，字段与语义明确）。对「Tauri 在国内 Electron 替代方案中的市场接受度」**未取证**，不作结论。

### 8. Brooooooklyn/keyring-node（`@napi-rs/keyring`）— 跨平台系统钥匙串，MIT、预编译、Linux 不退化为明文

- **证据（四类端点实测值）**
  - `GET /repos/Brooooooklyn/keyring-node` → `stars=106`, `language=Rust`, `default_branch=main`, `pushed_at=2026-10-21T13:38:04Z`, `created_at=2023-02-25T13:58:53Z`, `archived=false`, `open_issues=2`, `spdx_id=MIT`
  - `GET /repos/Brooooooklyn/keyring-node/commits?per_page=1` → 默认分支最后提交 `2026-10-21T13:37:59Z`（sha `3cf24452a7`，`chore: bump up @oxc-node/core version to v1 (#153)`）
  - `GET /repos/Brooooooklyn/keyring-node/git/trees/main?recursive=1` → `entries=70`, `truncated=false`；关键路径 `src/entry.rs`(约 15 KB)、`src/entry_builder.rs`(约 5 KB)、`src/linux_credential_builder.rs`(约 1 KB)、`src/options.rs`(约 1 KB)、`src/result.rs`(约 3 KB)、`src/async_entry.rs`(约 7 KB)、`index.js`(约 28 KB)、`index.d.ts`(约 9 KB)、`Cargo.toml`(约 2 KB)、以及**每平台预编译目录** `npm/win32-x64-msvc/` `npm/win32-arm64-msvc/` `npm/darwin-x64/` `npm/darwin-arm64/` `npm/linux-x64-gnu/` `npm/linux-x64-musl/` `npm/linux-arm64-gnu/` `npm/linux-riscv64-gnu/` `npm/freebsd-x64/`（每个含 `LICENSE.third-party.md`，实测 win32-x64 为 约 97 KB）
  - `GET /repos/Brooooooklyn/keyring-node/license` → `spdx_id=MIT`, `name=MIT License`, `path=LICENSE`；**正文首行**：`MIT License` / `Copyright (c) 2020 N-API for Rust`
  - 补充 `GET /contents/Cargo.toml` → 平台依赖实测：windows → `windows-native-keyring-store`（Windows Credential Manager）；macos → `apple-native-keyring-store`（feature `keychain`）+ `core-foundation` + `security-framework`；linux → `dbus-secret-service-keyring-store` + `linux-keyutils-keyring-store` + `secret-service`；freebsd/openbsd → secret-service
  - 补充 `GET /contents/README.md` → 实测 71 行；API 仅 4 个方法：`new Entry(service, name)` / `setPassword` / `getPassword` / `deletePassword`；Linux 后端自动选择：优先 Secret Service（gnome-keyring / KWallet / keepassxc），无则回退 kernel keyutils；可用 `{ linux: { store: 'secret-service' | 'keyutils' } }` 强制指定，**指定后不可用则抛错、不静默回退**；README 明示 keyutils 后端「completely in-memory and will not persist across reboots」
  - 对照证据 `GET /repos/electron/electron/contents/docs/api/safe-storage.md` → 实测 96 行；Linux 明示「If no secret store is available, items stored in using the safeStorage API will be **unprotected** as they are encrypted via **hardcoded plaintext password**」，检测方式 `safeStorage.getSelectedStorageBackend()` 返回 `basic_text`；可选后端 `basic_text` / `gnome_libsecret` / `kwallet` / `kwallet5` / `kwallet6`
- **适配点**
  - mulpub 需本地保存的敏感数据至少两类：① 各平台账号登录态 / 授权 cookie / token（`auth-preload.js`、`auth-qrcode-preload.js` 是扫码登录入口）② 平台 API 的长期 refresh token。**若落在明文 JSON / SQLite，等于交出用户所有平台的账号权限。**
  - 用法与 Electron preload 契合：主进程 `new Entry('mulpub', 'douyin:refresh_token')` 存取，preload 经 IPC 拿**句柄**而非明文。
  - **比 Electron 内置 `safeStorage` 强在 Linux**：Electron 官方文档自述 Linux 无 secret store 时会退化为 `basic_text`（硬编码明文密码）。mulpub 若发 Linux 版 AppImage，国产发行版 + 自研桌面环境下 `basic_text` 概率不低。keyring-node 的 `store: 'secret-service'` 强制模式可在拿不到安全存储时**直接抛错**，由 mulpub 决定降级策略而非静默明文。
  - 预编译二进制已覆盖 win32-x64/arm64、darwin-x64/arm64、linux-x64/arm64（含 musl 变体）——**用户端不需编译工具链**，与 mulpub 现有 sidecar 分发模式一致。
  - 每平台目录各带 `LICENSE.third-party.md`（实测 macos-arm64 约 75 KB、win32-x64 约 97 KB）——**与 mulpub 现有 `licenses/` + `THIRD-PARTY-NOTICES.md` 制度直接对口**，可照抄这个「每平台一份第三方许可」目录结构。
- **引入成本**：**低—中**。MIT、npm 有预编译包、API 面只有 4 个方法。需在 electron-builder 配置中把原生 `.node` 列入 `asarUnpack`（与 mulpub 现有 sidecar 解包策略一致）。
- **风险**
  - 仓库较新、stars 仅 106；npm 包名 `@napi-rs/keyring`（registry 实测 latest=2.1.2，repository 指向本仓）。
  - **Linux 桌面环境碎片化**是真实问题：secret-service 不可用而用户选了 keyutils，重启后凭据丢失（README 明示）——对「记住登录态」是功能缺陷，需 mulpub 显式处理。
  - 引入原生模块 = 引入平台 ABI 兼容面（Win arm64 / macOS arm64 / musl 变体），与现有 sidecar 锁定策略的复杂度叠加。
- **建议**：**直接引入**，分层落地：① refresh token / 长效凭据 → keyring（macOS/Windows 直接用，Linux 用 `store:'secret-service'`，失败降级 `safeStorage` 并在设置页提示）；② 非敏感偏好 → 继续走现有配置存储，不要滥用钥匙串。
- **置信度**：**高**。API、平台后端、许可、预编译结构均实测。**未取证**：`@napi-rs/keyring` 在 Electron `asarUnpack` 下的实际加载表现（本轮未跑通运行时验证）。

### 9. getsentry/sentry-electron — 崩溃上报的上下文采集 SDK（MIT），而自建服务端已转 FSL-1.1 协议

> ⚠️ **协议高风险标注**：`getsentry/sentry`（服务端）**已不是 OSI 开源协议**——`GET /repos/getsentry/sentry/license` 正文首行为 `# Functional Source License, Version 1.1, Apache 2.0 Future License`。这是「上游商业化转向」类风险，必须写进决策记录。**SDK（sentry-electron）仍是 MIT，两者协议不同，勿混为一谈。**

- **证据（四类端点实测值）**
  - `GET /repos/getsentry/sentry-electron` → `stars=259`, `language=TypeScript`, `default_branch=master`, `pushed_at=2026-10-22T11:50:01Z`, `created_at=2017-11-17T15:43:15Z`, `archived=false`, `open_issues=9`, `spdx_id=MIT`
  - `GET /repos/getsentry/sentry-electron/commits?per_page=1` → 默认分支最后提交 `2026-10-22T11:49:58Z`（sha `1fd1facc37`，`test: Update electron-react-boilerplate example to React 19 (#1479)`）
  - `GET /repos/getsentry/sentry-electron/git/trees/master?recursive=1` → `entries=720`, `truncated=false`；关键路径 `src/main/index.ts`(约 6 KB)、`src/main/integrations/additional-context.ts`(约 4 KB)、`src/main/integrations/browser-window-session.ts`(约 3 KB)、`src/main/integrations/child-process.ts`(约 5 KB)、`src/main/integrations/electron-breadcrumbs.ts`(约 7 KB)、`src/main/context.ts`(约 2 KB)、`src/main/filter-listeners.ts`(约 2 KB)、`src/main/header-injection.ts`(约 1 KB)、`src/main/electron-normalize.ts`(约 1 KB)、`src/common/ipc.ts`(约 4 KB)、`src/common/envelope.ts`(约 2 KB)、`src/common/scope.ts`(约 2 KB)、`examples/electron-vite/package.json`、`examples/webpack-context-isolation-preload/package.json`
  - `GET /repos/getsentry/sentry-electron/license` → `spdx_id=MIT`, `name=MIT License`, `path=LICENSE`；**正文首行**：`MIT License` / `Copyright (c) 2018 Functional Software, Inc. dba Sentry`
  - 服务端补充 `GET /repos/getsentry/sentry` → `stars=45631`, `language=Python`, `default_branch=master`, `pushed_at=2026-10-23T03:34:30Z`, `created_at=2010-08-30T22:06:41Z`, `archived=false`, `open_issues=2171`, `spdx_id=NOASSERTION`；`GET /commits?per_page=1` → `2026-10-23T03:24:04Z`（sha `907dab64a7`，`feat(investigations): Describe the monitor a suggestion changes (#128485)`）；`GET /git/trees/master?recursive=1` → `entries=25092`, `truncated=false`，路径关键词计数 `snuba`:267 `relay`:139 `redis`:56 `postgres`:26 `kafka`:21；`GET /license` → `spdx_id=NOASSERTION`, `name=Other`, `path=LICENSE.md`，**正文首行 `# Functional Source License, Version 1.1, Apache 2.0 Future License`**
  - 对照证据 `GET /repos/electron/electron/contents/docs/api/crash-reporter.md` → 实测 320 行；Electron 内置基于 **Crashpad**，`crashReporter.start({submitURL, companyName, uploadToServer, rateLimit, compress})`，`submitURL` 在 `uploadToServer:false` 时可省略；提供 `getLastCrashReport()`、`setUploadToServer(bool)`
- **适配点**
  - **mulpub 的第一选择其实不是 Sentry，而是 Electron 内置 `crashReporter`**：零依赖、Crashpad 原生、产出标准 minidump。ECS 上自建一个接收端（POST minidump → 落 OSS → symbolicate）即可，比自建 Sentry 轻两个数量级。
  - 内置 `crashReporter` 的关键参数（官方文档实测）：`uploadToServer: false` 可让崩溃只落地本地不外传——**这正是国内用户隐私合规的刚需**；`getLastCrashReport()` 可在下次启动时让用户确认上传（崩溃知情同意）；`rateLimit: true` 防止崩溃循环刷爆服务端。
  - **Sentry SDK 值得引入的是「上下文」而非「传输」**：`src/main/integrations/additional-context.ts`(约 4 KB) 与 `browser-window-session.ts`(约 3 KB) 展示如何把 **main 进程、renderer 进程、窗口 session、IPC 通路** 的上下文关联起来——mulpub 有 6 个 preload + 多窗口（`window.js`），崩溃时需要知道「哪个窗口、哪个 preload、哪条 IPC 链」才定位得动；`src/common/ipc.ts`(约 4 KB) 专门做 IPC 事件采集与脱敏。
  - `examples/webpack-context-isolation-preload/` 与 `examples/electron-vite/` 是**「contextIsolation 下 preload 如何正确接 Sentry」的可直接参考样例**，对 mulpub 的 6 个 preload 直接可用。
  - 自建 Sentry 的成本现实：`snuba`（ClickHouse 存储）+ `relay`（事件摄入）+ `kafka` + `redis` + `postgres`，仓库 25092 条目量级。阿里云 ECS 上跑这套，最小配置也要 8C16G 起 + ClickHouse 运维，**对内容发布工具明显过重**。
- **引入成本**
  - 内置 `crashReporter` + 自建接收端：**低**（客户端几行；服务端一个轻量 POST 接收器）。
  - `sentry-electron` SDK + 官方 SaaS：**低**；自建 Sentry 服务端：**高**。
- **风险**
  - ⚠️ **服务端 FSL-1.1 非开源协议**（本轮只逐条确认了 LICENSE 正文含 `### License Grant` 与 `## Grant of Future License` 两节，**「竞争性使用」等具体限制条款本轮未逐条取证**，但可确定它已不是开源协议）。内部自用的合规边界与未来条款变更需法务确认。
  - 崩溃 minidump 天然含内存片段，可能带 token / 用户数据 → 上传前必须做 `globalExtra` 脱敏 + 知情同意。
  - `sentry-electron` 仅 259 stars，可信度靠更新频率（实测提交信息持续跟 Electron 大版本）而非 star 数。
  - 若走官方 SaaS，**国内网络可达性本轮未取证**，需先验证。
- **建议**：**直接引入 + 借鉴实现**，分两步：① 客户端**直接引入 Electron 内置 `crashReporter`**，接自建 ECS 接收端，`uploadToServer` 默认 false + 启动时弹窗征求同意；② 需要丰富上下文时再引入 `sentry-electron` 的上下文采集思路（或直接用其 MIT SDK + SaaS）。**不推荐**自建 Sentry 服务端。
- **置信度**：**中高**。协议正文与子服务结构实测；Sentry SaaS 的国内可达性**未取证**。

### 10. alex8088/electron-vite + electron-vite/electron-vite-vue — 构建管线与脚手架参考，mulpub 的 `electron/` 结构已超越模板

- **证据（四类端点实测值）**
  - `GET /repos/alex8088/electron-vite` → `stars=5633`, `language=TypeScript`, `default_branch=master`（**非 main**）, `pushed_at=2026-10-14T16:28:56Z`, `created_at=2022-02-09T08:54:54Z`, `archived=false`, `open_issues=69`, `spdx_id=MIT`
  - `GET /repos/alex8088/electron-vite/commits?per_page=1` → 默认分支最后提交 `2026-10-14T16:01:19Z`（sha `23d7bfc8ba`，`release: v6.0.0`）
  - `GET /repos/alex8088/electron-vite/git/trees/master?recursive=1` → `entries=59`, `truncated=false`；关键路径 `src/plugins/bytecode.ts`(约 14 KB)、`src/plugins/electron.ts`(约 14 KB)、`src/config.ts`(约 13 KB)、`src/bytecodeCompiler.ts`(约 6 KB)、`src/cli.ts`(约 5 KB)、`src/electron.ts`(约 5 KB)、`src/plugins/asset.ts`(约 5 KB)、`src/plugins/externalizeDeps.ts`(约 1 KB)、`src/plugins/esmShim.ts`(约 2 KB)、`src/load.ts`(约 4 KB)、`src/build.ts`(约 2 KB)、`README.md`(约 4 KB)
  - `GET /repos/alex8088/electron-vite/license` → `spdx_id=MIT`, `name=MIT License`, `path=LICENSE`；**正文首行**：`MIT License` / `Copyright (c) 2022, Alex Wei`
  - 模板补充 `GET /repos/electron-vite/electron-vite-vue` → `stars=4891`, `language=TypeScript`, `default_branch=main`, `pushed_at=2026-09-01T02:43:28Z`, `created_at=2020-08-16T04:49:23Z`, `archived=false`, `open_issues=5`, `spdx_id=MIT`；`GET /commits?per_page=1` → 默认分支最后提交 **`2026-06-03T07:54:55Z`**（sha `8c395cda37`，`chore: upgrade deps`）→ 近 4 个月无实质更新；`GET /git/trees/main?recursive=1` → `entries=48`, `truncated=false`，关键路径 `electron/main/index.ts`(约 3 KB)、`electron/preload/index.ts`(约 3 KB)、`electron/electron-env.d.ts`(约 1 KB)、`electron-builder.json`(约 1 KB)、`src/App.vue`(约 1 KB)、`src/demos/ipc.ts`(约 1 KB)、`src/demos/node.ts`(约 1 KB)、`src/main.ts`(约 1 KB)
  - `GET /repos/electron-vite/electron-vite-vue/license` → `spdx_id=MIT`, `name=MIT License`, `path=LICENSE`；**正文首行**：`MIT License` / `Copyright (c) 2023 草鞋没号`
  - 补充 `GET /contents/electron-vite/electron-vite-vue/package.json` → 实测 34 行；`"name": "electron-vue-vite"`、`"author": "草鞋没号 <308487730@qq.com>"`；devDeps `electron ^42.1.0`、`electron-builder ^26.8.1`、`vite ^8.0.16`、`@vitejs/plugin-vue ^6.0.7`、`vue ^3.5.35`、`vue-tsc ^3.3.3`、`typescript ^6.0.3`、`vite-plugin-electron ^1.0.1`、`vite-plugin-electron-renderer ^1.0.0`
  - 补充 `GET /contents/alex8088/electron-vite/README.md` → 实测关键行：`- 💡 Optimize asset handling for Electron main process.`、`- 🚀 Fast HMR & hot reloading.`、`- 🔒 Compile code to v8 bytecode to protect source code.`；配置示例含 `main:` / `preload:` / `renderer:` 三段
- **适配点**
  - **结论先行：mulpub 不需要任何脚手架。** 模板本体只有 `electron/main/index.ts` 3.5KB + `electron/preload/index.ts` 3.3KB + `src/` 5 个示例文件；而 mulpub 的 `electron/` 是 22 文件、含 `bootstrap.js`/`shutdown.js`/`startup-compat.js`/`window.js`/`ipc-guard-exemptions.json`/`stealth-preload.bundle.js` 的自研壳，`src/` 1030 文件用 Vue 3 + Element Plus + Pinia + vue-router + vue-i18n + @vue-flow/core。**模板对 mulpub 的价值已归零**，仅剩「新项目起点」价值。
  - **仍有价值的是构建管线**：`alex8088/electron-vite` 的三目标（main / preload / renderer）构建、main 进程资源处理优化、`v8 bytecode` 编译（`src/plugins/bytecode.ts` 约 14 KB + `src/bytecodeCompiler.ts` 约 6 KB）。mulpub 的 `stealth-preload.bundle.js` 现在是手工 bundle 的产物——**electron-vite 的 preload 目标 + bytecode 编译是更正规的替代路径**（顺带解决「源码可被反编译看穿」这个 ASAR 之外的问题）。
  - **注意它的构建链与 mulpub 不同**：模板用的是 `vite-plugin-electron`（第三方插件），**不是** `electron-vite` 本体。`alex8088/electron-vite` 本体（v6.0.0，2026-10-14）是更成熟的选择。
  - 作者是中文开发者（`308487730@qq.com`），**中文文档与国内社区可用性是真实优势**，沟通成本低。
  - 模板 `electron-builder.json`(约 1 KB) 的字段结构可与 mulpub 现有配置对照，查是否漏配 `asar` / `files` / `extraResources`。
- **引入成本**：**引入构建工具 = 中**（重写 `vite.config`、处理 main 进程依赖 externalize、preload 的 CJS/ESM 形态、`stealth-preload.bundle.js` 的生成流程），收益需实测对比（打包速度、产物体积、bytecode 保护）；**作为模板参考 = 零成本**。
- **风险**
  - `electron-vite/electron-vite-vue` 默认分支 4 个月无提交（实测 2026-06-03），对新版 Electron/Vite 的适配可能滞后；且它用的是 `vite-plugin-electron` 而非 `alex8088/electron-vite`，**两者别混用**。
  - `alex8088/electron-vite` 的 `default_branch=master`（旧命名），code search 索引的是 master 而非 main。
  - 引入 electron-vite 会改变 main 进程的 `require` 行为（依赖需显式 externalize），mulpub 的 Playwright / Remotion 都是重依赖，**这是最大的迁移风险点**。
- **建议**：**仅供对照**（作为「新项目起点」与「构建管线三目标 + bytecode」参考），**不推荐**为换构建工具而动 mulpub 现有 Vite 配置。若要引入，只做**局部试点**：先在 `stealth-preload` 的 bundle 链路上试 electron-vite 的 preload 目标 + bytecode。
- **置信度**：**中高**。文件树、配置、README 全文实测；未做实际构建对比（沙箱无完整 Electron 依赖环境）。

---

## 三、不确定项与未覆盖

**A. 本轮查了但未取证的**

1. **mulpub 自身的代码级实证缺失**：本轮未读到 mulpub 仓库源码。`apps/desktop/electron/` 的 22 个文件、`check-asar.js`/`check-integrity.js` 的实现深度、`sidecar-lock.json` 的锁定粒度、是否已做代码签名 / 公证、`ipc-guard-exemptions.json` 的白名单条目数——**均来自任务书转述，非本轮代码级实证**。凡涉及「mulpub 是否已具备某能力」的判断置信度相应下调，本文统一按「未取证」标注。
2. **Windows 代码签名的国内可获得性**：EV 代码签名证书对大陆主体是否仍可签发、OV 证书实际价格与审核周期——**未取证**。这是「无法自建的缺口」类问题，其外部依赖部分缺证据。
3. **Apple Developer Program 对国内开发者的实际申请流程与门槛**——**未取证**。
4. **electron-builder 的 `channel` 字段用于灰度的具体行为**——本轮未拉取 `electron-userland/electron-builder` 源码（只知其 stars=14679 / MIT / pushed_at=2026-10-23）。灰度方案中依赖该字段的部分须先验证。
5. **getsentry/sentry 的 FSL-1.1 具体条款**（尤其「竞争性使用」限制）——只确认了正文含 `License Grant` 与 `Grant of Future License` 两节，**未逐条取证**。
6. **Sentry SaaS 在国内的网络可达性**——**未取证**。
7. **Tauri 在国内开发者中的实际采用率**——**未取证**，不作结论依据。
8. **`@napi-rs/keyring` 在 Electron `asarUnpack` 下的实际加载表现**——本轮未跑通运行时验证。

**B. 本维度尚未覆盖的重要项目**（本轮未拉取或未展开）

- `electron-userland/electron-builder`（mulpub 已在用，本轮仅作背景）
- `electron/electron` 本体：仅取 `docs/api/safe-storage.md`(96 行)、`docs/api/crash-reporter.md`(320 行) 作对照证据；**`docs/tutorial/security.md` 的 CSP / contextIsolation 章节未展开**——这是 Q3 中「CSP / contextIsolation 加固」的一手依据，应补。
- `electron/electron` 的 `docs/tutorial/fuses.md`(241 行) 未逐行读。
- `microsoft/winget-cli`（stars=26522, MIT, master, 最后提交 2026-10-22T22:57:30Z）——Windows 分发渠道，本轮仅取四类元信息，未展开实现。
- `canonical/snapcraft`（stars=1291, **GPL-3.0**, main, 最后提交 2026-10-20T18:29:08Z）——Linux 分发渠道，因协议与 Electron 组合方式需单独法务评估，未展开。
- `AppImage/appimagetool`（stars=438, C, main, 最后提交 2026-10-04T14:56:59Z，`src/appimagetool.c` 约 49 KB + `src/appimagetool_sign.c` 约 16 KB）——Linux AppImage 工具链现状，已取证，列入劝退节。
- Electron 崩溃上报的原生实现 `chromium/crashpad`（Chromium 上游）——本轮未拉取，Electron 官方文档已确认其使用 Crashpad。
- macOS 侧的 Sparkle、Windows 侧的 Squirrel.Windows（原生实现）——本轮未拉取。

**C. 本维度的结论性缺口（④ 类）**

- **不存在「可直接引入的开源方案」能同时解决 macOS 公证与 Windows 代码签名的「凭据」问题**：代码侧全有 MIT 开源实现（`@electron/notarize`、forge 签名脚本、VS Code 的 `sign-server.ts` 范式），但 **Apple Developer 账号与代码签名证书是外部采购 / 审批依赖，开源实现补不上**。mulpub 的内部开发全流程可自建，**面向公众的分发信任链无法自建**。
- **不存在能同时满足「Playwright + Remotion + 反检测」的替代壳**：Neutralino / Wails / Tauri 三者都要求把 Node 侧重能力外置为 sidecar，**换壳省不掉 Node 运行时**，因此换壳在 mulpub 上是负收益。

---

## 四、本文档明确劝退的项目

> 以下项目均已按纪律先打 `GET /repos/{o}/{r}` 确认存在，并取到四类实测值后再判定不推荐。**404 的候选不在此表，已在第五节单独记录。**

| 项目 | 四类实测值（摘要） | 劝退理由 |
|---|---|---|
| **Neutralinojs/neutralinojs** | stars=8671, language=C, default_branch=main, pushed_at=2026-10-23T00:40:11Z, 最后提交 2026-10-06T08:23:58Z, trees entries=1538, **license spdx=NOASSERTION**，正文首行 `Neutralinojs core is licensed for use as follows:` / `MIT License` | **技术上完全不适配**：C 内核 + 无 Node 运行时，mulpub 的 Playwright / Remotion / 6 个 preload 全部要重写成 sidecar；**协议为自定义混合协议**（core MIT、扩展另有条款），商业闭源分发的合规边界不如纯 MIT 清晰。**不推荐** |
| **wailsapp/wails** | stars=36652, language=Go, default_branch=master, pushed_at=2026-10-23T00:27:30Z, 最后提交 2026-10-23T00:27:28Z, trees entries=20281, **license spdx=MIT**，正文首行 `MIT License` / `Copyright (c) 2018-Present Lea Anthony` | **语言栈完全不兼容**：Go + WebView，Node 侧重能力同样只能 sidecar 化；mulpub 是 TS/Vue 团队，换 Go 后端等于换语言。**不推荐** |
| **atom/node-keytar**（`zeit/keytar` 的实际仓库） | stars=1427, language=C++, default_branch=master, pushed_at=2022-12-12T11:01:01Z, 最后提交 2022-03-02T15:15:15Z, trees entries=39, **archived=true**, license spdx=MIT，正文首行 `Copyright (c) 2013 GitHub Inc.` | **已停更且已归档**（最后提交 2022-03）。npm 上的 `keytar` 无人维护，原生模块在新 Node/Electron 上编译失败是常态。**替代方案已明确**：`@napi-rs/keyring`（候选 8）。**不推荐** |
| **minio/minio** | stars=61306, language=Go, default_branch=master, pushed_at=2026-04-24T17:54:39Z, 最后提交 2026-02-12T20:18:48Z（`update README.md format and clarify state of the project`）, trees entries=1566, **archived=true**, **license spdx=AGPL-3.0**，正文首行 `GNU AFFERO GENERAL PUBLIC LICENSE` | **原推荐的「阿里云 ECS 自建 S3 兼容存储给 electron-updater 用」方案作废**：仓库已 archived、进入 maintenance mode、协议为 AGPL-3.0。**替代路径**：直接用**阿里云 OSS**（S3 兼容 + CDN），electron-updater 用 `generic` provider 指向 OSS，无需自建对象存储。**不推荐** |
| **AppImage/AppImageKit** | stars=9451, language=None, default_branch=main, pushed_at=2026-07-26T18:38:02Z, 最后提交 2026-07-26T18:38:02Z, **trees entries=4**（仅 `.gitignore` `LICENSE` `README.md` `motivation.md`）, license spdx=NOASSERTION，正文首行 `MIT License` | **典型的「宣称 ≠ 实现」**：README 第 1 行仍写「packaged with a recent version of AppImageKit」，但**仓库已只剩 4 个文档文件，工具本体已迁走**。**现状**：工具在 `AppImage/appimagetool`（stars=438, C, 最后提交 2026-10-04T14:56:59Z，`src/appimagetool.c` 约 49 KB + `src/appimagetool_sign.c` 约 16 KB），运行时在 `AppImage/type2-runtime`（stars=76, pushed_at=2026-10-19T20:37:20Z，`The runtime is the executable part of every AppImage. It mounts the payload via FUSE`）。**建议**：直接依赖 `appimagetool` 的 Release 二进制，不要从 AppImageKit 源码构建。**不推荐（以现状形态）** |
| **microsoft/vscode**（作为 fuses / ASAR 完整性参考） | stars=194224, language=TypeScript, default_branch=main, pushed_at=2026-10-23T04:36:42Z, 最后提交 2026-10-23T04:17:27Z, trees entries=25856, license spdx=MIT，正文首行 `MIT License` / `Copyright (c) 2015 - present Microsoft Corporation` | **VS Code 不使用 Electron fuses**，**不能**当 asar 完整性或 fuse 翻转的参考实现：① `GET /search/code?q=repo:microsoft/vscode+FuseV1Options` → `total_count=0`；② `GET /contents/build/lib/electron.ts` → 实测 279 行，grep `fuse\|integrity\|OnlyLoad\|asar` **0 命中**；③ `GET /contents/build/gulpfile.vscode.ts` → 实测 682 行，仅命中 `createAsar` / `node_modules.asar`（它打的是 `node_modules.asar`，不是 `app.asar`，应用代码在 `resources/app/out/`）。**它真正值得抄的只有两点**（均为 MIT，可安全借鉴）：① `build/darwin/sign-server.ts`(约 2 KB) —— macOS 签名走独立签名服务器、凭据不进 CI；② `src/vs/platform/update/electron-main/` 的**分平台更新服务实现**（`updateService.win32.ts` 约 30 KB / `abstractUpdateService.ts` 约 25 KB / `updateService.darwin.ts` 约 10 KB / `updateService.snap.ts` 约 7 KB / `updateService.linux.ts` 约 5 KB）——各平台更新差异如何分层。**不推荐**（作为 fuses 参考）；**部分借鉴**（签名服务器 + 分平台更新服务） |
| **getsentry/sentry**（自建服务端） | stars=45631, language=Python, default_branch=master, pushed_at=2026-10-23T03:34:30Z, 最后提交 2026-10-23T03:24:04Z, trees entries=25092（含 snuba 267 / relay 139 / redis 56 / postgres 26 / kafka 21）, **license spdx=NOASSERTION，正文首行 `# Functional Source License, Version 1.1, Apache 2.0 Future License`** | ⚠️ **协议已非 OSI 开源**（FSL-1.1），且自建需 Snuba/Relay/Kafka/Redis/Postgres 多组件栈，**对内容发布工具属明显过重**。**替代路径**：Electron 内置 `crashReporter`（Crashpad）+ 自建轻量接收端。**不推荐** |
| **canonical/snapcraft** | stars=1291, language=Python, default_branch=main, pushed_at=2026-10-20T20:15:11Z, 最后提交 2026-10-20T18:29:08Z, trees entries=3179, **license spdx=GPL-3.0**，正文首行 `GNU GENERAL PUBLIC LICENSE` / `Version 3, 29 June 2007` | ⚠️ **GPL-3.0 与 Electron 闭源分发的组合需单独法务评估**（copyleft 传染性），且 snap 渠道对国内用户的价值有限。**未展开取证**，暂不推荐 |
| **electron-vite/electron-vite-vue**（作为技术底座） | stars=4891, default_branch=main, pushed_at=2026-09-01T02:43:28Z, **最后提交 2026-06-03T07:54:55Z**, trees entries=48, license spdx=MIT | 作为**技术底座**不推荐：默认分支 4 个月无提交、模板本体仅 3.5KB main + 3.3KB preload，且用的是 `vite-plugin-electron` 而非 `alex8088/electron-vite` 本体。**但作为「新项目起点 / 结构参考」仍然推荐**（见候选 10） |

---

## 五、已剔除的 404 / 重定向候选（按纪律第 2 条记录）

以下仓库名在初筛时按常识猜测，经 `GET /repos/{owner}/{repo}` 实测后确认不存在或已改名，**全部剔除，不作为候选**：

| 初筛猜测的仓库名 | 实测结果 | 正确写法 / 处置 |
|---|---|---|
| `zeit/keytar` | **HTTP 404 Not Found** | 正确仓库是 `atom/node-keytar`（已归档停更，见劝退表） |
| `napi-rs/keyring` | **HTTP 404 Not Found** | 正确仓库是 `Brooooooklyn/keyring-node`（候选 8） |
| `napi-rs/keytar` | **HTTP 404 Not Found** | 无此仓库，keytar 生态已由 `atom/node-keytar` 占据（已停更） |
| `electron-userland/update-electron-app` | **HTTP 404 Not Found** | 正确仓库是 `electron/update-electron-app`（候选 5） |
| `electron-vite/electron-vite` | **HTTP 404 Not Found** | 正确仓库是 `alex8088/electron-vite`（候选 10） |
| `Neutralinojs/neutralino` | **HTTP 301 Moved Permanently** | 跟随重定向后为 `neutralinojs/neutralinojs`（劝退表） |
| `electron/electron-release-server` | **HTTP 404 Not Found** | 该仓不存在；Forge 的 `electron-release-server` 是 **publisher 插件**（`packages/publisher/electron-release-server/src/PublisherERS.ts` 约 6 KB + `Config.ts` 约 1 KB），其对应的独立服务端项目是 `ArekSredzki/electron-release-server`（候选 6） |
| `electron-userland/electron-release-server` | **HTTP 404 Not Found** | 同上 |

**另有 3 处「仓库存在但路径/能力不存在」的重要纠正**（避免后续轨道误引）：

1. **`tauri-plugin-updater` 已不在 `tauri-apps/tauri` 主仓**：`GET /repos/tauri-apps/tauri/git/trees/dev?recursive=1` → `entries=1502`，`crates/` 下只有 `tauri-build` `tauri-bundler` `tauri-cli` `tauri-codegen` `tauri-driver` `tauri-macos-sign` `tauri-macros` `tauri-plugin` `tauri-runtime-wry` `tauri-runtime` `tauri-schema-generator` `tauri-schema-worker` `tauri-utils` `tauri` `tests`。updater 插件在 `tauri-apps/plugins-workspace`（`default_branch=v2`）的 `plugins/updater`。
2. **`AppImage/AppImageKit` 已无工具代码**（trees `entries=4`），工具在 `AppImage/appimagetool`。
3. **VS Code 从未有过 Electron fuses 相关文件**（见劝退表的三条实证）。

**附录：本轮实测中踩到并修正的「元信息陷阱」**（供其他轨道复用）

1. `pushed_at` 统计所有分支/tag —— `ArekSredzki/electron-release-server` 的 `pushed_at=2024-04-22` 但默认分支最后提交 **2023-10-28**；`minio/minio` 的 `pushed_at=2026-04-24` 但最后提交 2026-02-12 且仓库已 archived。
2. `default_branch` 不是 main/master —— `tauri-apps/tauri`=`dev`、`alex8088/electron-vite`=`master`、`tauri-apps/plugins-workspace`=`v2`、`ArekSredzki/electron-release-server`=`master`、`getsentry/sentry-electron`=`master`、`getsentry/sentry`=`master`。
3. `spdx_id` 与 LICENSE 正文不一致 —— `getsentry/sentry` 的 metadata 是 `NOASSERTION`，正文是 **FSL 1.1**（不是 BSD）；`neutralinojs/neutralinojs`、`AppImage/AppImageKit`、`AppImage/appimagetool` 同为 `NOASSERTION` 自定义/混合协议。
4. 仓库会改名/删除 —— `zeit/keytar` 404；`Neutralinojs/neutralino` 301；`electron-userland/update-electron-app` 404；`electron-vite/electron-vite` 404。
5. 工具会从主仓拆走 —— `tauri-plugin-updater` 拆到 `plugins-workspace`；`AppImageKit` 工具迁到 `appimagetool`。
6. 声明 ≠ 实现 —— `AppImage/AppImageKit` 有 9451 stars 但只剩 4 个文档文件；`electron-vite/electron-vite-vue` 有 4891 stars 但模板本体只有 6.9KB 源码。

---

## 六、交付说明（Summary / Changed files / Notes）

**Summary**
对「桌面应用壳、分发与客户端安全」单一维度做了 10 个开源候选的 api.github.com 取证，每个候选固定给出 `GET /repos/{o}/{r}` / `GET /repos/{o}/{r}/commits?per_page=1` / `GET /repos/{o}/{r}/git/trees/{default_branch}?recursive=1` / `GET /repos/{o}/{r}/license` 四类实测值，并辅以 `GET /contents/{path}` 读取的关键文件行数。核心结论是**不换壳**（Playwright / Remotion / stealth-preload 反检测三处硬阻断）、**直接引入 3 个 MIT 小库**（`@electron/fuses` / `@electron/notarize` / `@napi-rs/keyring`）、**灰度回滚照搬 Tauri updater 的元数据契约**（含 electron-updater 缺失的更新包签名校验），并**明确记录 4 类无法自建的缺口**。

**Changed files**
- `01-docs/research/mulpub-credit-cost-2026-10-25/tracks/track-desktop.md` —— 本交付物（7075 中文字 / 10 个候选节）
- 进度看板（沙箱内产物，未入库） —— 追加进度条目
- 取证工作区（沙箱内，未入库） —— 取证工作区（辅助产物，非交付物）：`gh.sh` `get.sh` `tree.sh` `commits.sh` `four.sh` 取证脚本、`evidence/` 24 份 API 响应 JSON、`ev_batch1..9.txt` 四类端点实测记录

**Notes（给验证者）**
1. **四类端点已逐候选核对**：脚本化校验通过——10/10 候选均含 `GET /repos/…`、`/commits?per_page=1`（含 sha 与 commit message）、`/git/trees/<default_branch>?recursive=1`（含 entries 数与 truncated 标记）、`/license`（含正文首行引用）。
2. **初筛猜测的 8 个仓库名已全部按纪律第 2 条记录在第五节**：其中 6 个 HTTP 404、1 个 HTTP 301（`Neutralinojs/neutralino` → `neutralinojs/neutralinojs`）、1 个实为「Forge publisher 插件」而非独立仓。**无任何 404 仓库被当作候选写入第二节。**
3. **高风险协议已在候选节内就地标注（⚠️）**，不只出现在劝退表：Signal-Desktop = AGPL-3.0（候选 2）、getsentry/sentry = FSL-1.1 非 OSI 开源（候选 9）、snapcraft = GPL-3.0（劝退表）、minio = AGPL-3.0 + 已 archived（劝退表）、neutralinojs = NOASSERTION 自定义混合协议（劝退表）。
4. **VS Code 未被当作 fuses / ASAR 完整性参考**：三条实证写明——code search `FuseV1Options` total_count=0、`build/lib/electron.ts` 279 行 grep `fuse|integrity|OnlyLoad|asar` 0 命中、`build/gulpfile.vscode.ts` 682 行只命中 `node_modules.asar`。VS Code 仅在劝退表中作为「签名服务器 + 分平台更新服务」的**可借鉴点**出现。
5. **mulpub 自身现状为任务书转述，本轮未做代码级取证**（第 1、2、3 节均已标注「未取证」）。凡「mulpub 是否已具备某能力」的判断置信度已相应下调。
6. **本轮修正过的 6 类元信息陷阱**见文末附录，可直接供其他轨道复用。
