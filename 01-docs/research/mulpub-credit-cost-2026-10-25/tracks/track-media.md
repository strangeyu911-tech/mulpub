# 轨道D：视频 / 音频生产链与多平台发布 —— 开源参考项目调研

> 取证方法：全部数据来自 `api.github.com` 实测（`GITHUB_PAT` 认证）。元信息用 `GET /repos/{o}/{r}`，活跃度用 `GET /repos/{o}/{r}/commits?sha={default_branch}&per_page=3`，许可用 `GET /repos/{o}/{r}/license` 的**正文**，能力用 `GET /repos/{o}/{r}/git/trees/{branch}?recursive=1` 看结构 + `GET /repos/{o}/{r}/contents/{path}` 数行数。
> **对标项目现状**直接读自 mulpub 公开仓：`GET /repositories/1261397559`（注：`GET /repos/Colinchui007/mulpub` 与 `GET /repos/Colinchui007/mulpub` 均 **404**，只有数字 id 路径可用 —— 名称解析失效这条坑再次复现）。
> 章节顺序按「先解决决策，再给证据」组织；先给维度小结表，再给 12 个候选详情，最后给劝退清单。

---

## 一、维度小结（表）

| 能力点 | mulpub 现状（已逐文件核实） | 首选推荐 | 备选 | 处置建议 |
|---|---|---|---|---|
| 视频合成引擎 | `packages/remotion-composer` 7 场景 + 22 个 components + `media-profiles.ts`；依赖 `remotion@4.0.484` | **不换**。Remotion 已是正路 | MoviePy（编排范式） | 不换引擎。仅借鉴 MoviePy 的 ffmpeg 编排范式（MPT 实战用它） |
| 字幕断句 | `story2video-engine/src/subtitle-rules.json`（v1.2，双实现单源）+ `subtitle-phrase-boundary.ts`（成对短语登记）+ `subtitle-unit-guard.ts` | **不换**。设计已优于通用开源 | VideoLingo 的「语义切分」思路 | 借鉴：LLM 语义切点 + spacy 连接词切分，补齐「按句法而非按标点」 |
| 字幕时间轴对齐 | `subtitle-aligner.ts`（词级时间 + Levenshtein 窗口匹配 + fail-open）+ `packages/audio-aligner/aligner/core.py`（faster-whisper 词级时间 + `silencedetect` 吸附） | whisperX | stable-ts（**已归档**） | **唯一实质缺口**：Whisper 自身中文词级时间戳不准；whisperX 用 wav2vec2 强制对齐（zh 模型已在默认表内） |
| 相似度 / 复刻度 | `video-clone-engine/src/similarity.js`（结构 0.35 / 文案 0.25 / 风格 0.25 / 时长 0.15，DTW 近似对齐 + IoU，L0/L1/L2 分层阈值 + 证据门控） | **不换**。时间轴级度量与开源完全不同轴 | imagededup | imagededup 补的是**画面/素材感知相似**这一维，是补充不是替换 |
| 素材库 / 模板库治理 | `template-library.ts`（7 内置模板，localStorage 覆盖）/ `bgm-library.ts`（10 条 Pixabay CDN，注释标 CC0/CC-BY） | MPT `material.py`（3072 行）作对照 | PySceneDetect 的 `_thirdparty/LICENSE-*` 台账范式 | 缺口：模板/BGM 缺**许可字段与版本锁定**（BGM 是可变 CDN URL，无 sha256） |
| 画幅自适应 / 封面 | `_base/aspect-ratio.js`（225 行，图片出图画幅单一真源）+ `cover-cropper.js`（`sharp fit:'cover', position:'centre'`）+ `local-cover-generator.js` + `.cover-rasterize-worker.js` + 各平台 cover 适配 | **smartcrop.js** | PySceneDetect（选帧） | 缺口明确：`position:'centre'` 中心裁切会切掉主体 → 内容感知裁切是可直接替换的小而专的库 |
| 中文 TTS | **已有且成熟**（**不是空白**）：`apps/desktop/electron/services/adapters/` 下 6 家云端供应商适配器（`doubao-tts.js` 242 行 / `mimo-tts.js` 303 行 / `minimax-tts.js` 603 行 / `google-tts.js` / `openai-tts.js` / `minimax-tts-voices.js`，统一 `synthesize()/listVoices()/testConnection()`）+ `tts-voice-clone-service.js` **1783 行**（音色克隆）+ `story2video-voice-estimate.js` 78 行 / `story2video-voice-guard.js` 180 行 / `tts-calibration.js` 132 行 | **不换云端**；补**自托管/离线降级** | kokoro（Apache-2.0 权重，82M）/ CosyVoice（Apache-2.0 代码，权重未取证） | 缺口不是「没有 TTS」，而是：① 无本地/离线 TTS 降级路径（云端故障即整条 Story2Video 断链）② 云端按量计费与并发上限 ③ **权重/音色资产无许可台账**。**中文实际质量需跑音频基准才能比较（见不确定项 5）** |
| AI 视频生成 | `apps/desktop/electron/services/adapters/` 已有 comfyui 等供应商适配器 | 官方 API（火山引擎方舟 Seedance） | ComfyUI + WanVideoWrapper | 优先接官方 API，ComfyUI 作本地补充；**ComfyUI 是 GPL-3.0**，不链接、只作为外部服务调用 |
| 多平台发布 | `api-publish-engine/src/publish/` 35 文件（12 平台模块 + `capabilities/` 7 个 + `emit-gate.js`/`risk-signals.js`/`risk-suspender.js`）+ `rpa-engine` + `wechat_publisher`（5 文件） | social-auto-upload（RPA 参考）+ ReaJason/xhs（API 参考） | biliup（B 站） | 现状已是三段式（API→RPA→风控）；开源可补的是**平台协议细节**，不是架构 |
| 媒体工具链治理 | `sidecar-lock.json`（83 行，npm+GitHub Releases 双路交叉验签 + 逐平台 sha256 + `status=pending` fail-closed）+ `media-tools-lock.json`（34 行）+ `THIRD-PARTY-NOTICES.md`（39 行） | **现状优于所有开源替代**，仅补两块 | oss-review-toolkit/ort / BtbN/FFmpeg-Builds | 补：① Remotion 双层许可**未进声明**（最大合规缺口）② 模型权重许可台账 |

---

## 二、候选详情

### 1. `m-bain/whisperX` — 词级时间戳 + VAD 的 ASR 对齐流水线，中文已在默认模型表内
- **证据**
  - `GET /repos/m-bain/whisperX` → stars=24786, forks=2501, language=Python, default_branch=`main`, pushed_at=2026-10-22T14:53:44Z, open_issues=213
  - `GET /repos/m-bain/whisperX/commits?sha=main&per_page=3` → 2026-10-22「Merge pull request #1469 from li-lizhe/fix-optional-torchaudio」/ 2026-10-21「chore(lock): regenerate uv.lock」→ 默认分支活跃
  - `GET /repos/m-bain/whisperX/git/trees/main?recursive=1` → 35 个 blob；关键路径 `whisperx/alignment.py`、`whisperx/asr.py`、`whisperx/diarize.py`、`whisperx/SubtitlesProcessor.py`、`whisperx/vads/{pyannote.py,silero.py,vad.py}`、`whisperx/assets/pytorch_model.bin`
  - `GET /repos/m-bain/whisperX/contents/whisperx/alignment.py` → **658 行 / 约 26 KB**；`asr.py` → 590 行；`vads/` 三种 VAD 后端
  - `GET /repos/m-bain/whisperX/contents/pyproject.toml` → 依赖硬钉 `torch~=2.8.0`、`torchvision~=0.23.0`、`transformers>=4.48.0`、`ctranslate2>=4.5.0`、`pyannote-audio>=4.0.0`、`torchcodec>=0.6.0`；可选 extra `align-torch = ["torchaudio~=2.8.0"]`；注释明写「**torchcodec (transitive dep of pyannote-audio >=4) has no wheels for Linux aarch64**」
  - `GET /repos/m-bain/whisperX/contents/whisperx/alignment.py` → `DEFAULT_ALIGN_MODELS_HF` 首行即 `"zh": "jonatasgrosman/wav2vec2-large-xlsr-53-chinese-zh-cn"`（第 74 行），**中文开箱即用**，不必自训
  - `GET /repos/m-bain/whisperX/license` → spdx=BSD-2-Clause，正文首行「BSD 2-Clause License / Copyright (c) 2024, Max Bain」
- **它到底是采集还是发布**：不适用（ASR 库）。
- **适配点**：直击 `packages/audio-aligner/aligner/core.py` 与 `story2video-engine/src/subtitle-aligner.ts`。mulpub 现状是「faster-whisper 词级时间戳 + `silencedetect` 吸附 + Levenshtein 贪心窗口匹配」，其中**词级时间戳质量完全依赖 Whisper 自身**——Whisper 的时间戳是「按 token 对齐音频片段」的启发式，中文短句上误差明显（一个词被拆成两个 token、或整句被当成一个 token）。whisperX 的第二段用 **wav2vec2 CTC 强制对齐**重算每个词的边界，这正是 mulpub 当前缺的「真实时间戳」证据源；`vads/silero.py` 可替代 mulpub 现在的 `silencedetect` 正则解析（后者是 ffmpeg stderr 文本嗅探，脆）。
- **引入成本**：中。Python 侧，与 `packages/python-backend` 同栈，不动 Node 渲染链。但引入 3 个重依赖：torch（**硬钉 `torch~=2.8.0`**）、torchvision、transformers（+ `pyannote.audio` 与 `silero` 各自带模型）；wav2vec2 中文对齐模型体积为 **GB 量级**（`wav2vec2-large-xlsr-53` 系，**精确字节数未取证**，需以 HF 快照为准），比 mulpub 现在的 `base` int8 模型重一个数量级；`DEFAULT_ALIGN_MODELS_HF` 含 20+ 语言，一并装依赖会明显膨胀。**两个具体成本点**：① `torchcodec`（`pyannote-audio>=4` 的传递依赖）**在 Linux aarch64 无 wheel**（仓库自己的注释写明）→ 若 mulpub 桌面端要覆盖 **ARM Linux / Apple Silicon**，需先验证这条链能否装上；② torch 版本与 mulpub 现有 `faster-whisper>=1.0.0`（走 `ctranslate2`）共存需锁版本。
- **风险**：BSD-2 无商用限制（✅）；但**对齐模型权重是 HF 上的第三方模型**（`jonatasgrosman/...`），仓库 LICENSE 不覆盖权重，权重许可未取证 → 若要进 THIRD-PARTY-NOTICES 需单独查；`pyannote.audio` 需 HuggingFace token 且其模型有非商用条款（**未取证**，若启用 diarization 必须先查）。
- **建议**：**借鉴实现 + 分阶段引入**。先只引 `whisperx/alignment.py` + `vads/silero.py` 的思路，把「Whisper 时间戳」替换为「wav2vec2 强制对齐」，VAD 换成 Silero；diarization 一期不开。
- **置信度**：高（行数、模型表、许可均已实测；权重许可为「未取证」）。

### 2. `Huanshere/VideoLingo` — 视频本地化流水线，字幕切分/翻译/对齐/配音的完整范式
- **证据**
  - `GET /repos/Huanshere/VideoLingo` → stars=18891, forks=2084, language=Python, default_branch=`main`, pushed_at=2026-09-30T17:03:30Z
  - `GET /repos/Huanshere/VideoLingo/commits?sha=main&per_page=3` → 2026-09-30「fix(ui): do not look up TTS provider names as translation keys」/ 2026-09-27「chore: release v3.1.1」→ 近一个月内活跃
  - `GET /repos/Huanshere/VideoLingo/git/trees/main?recursive=1` → 211 个 blob；`core/` 下的流水线按步骤编号命名：`core/_2_asr.py`、`core/_3_1_split_nlp.py`、`core/_3_2_split_meaning.py`、`core/_5_split_sub.py`、`core/_6_gen_sub.py`、`core/_7_sub_into_vid.py`、`core/_8_1_audio_task.py`、`core/_9_refer_audio.py`、`core/_10_gen_audio.py`、`core/_12_dub_to_vid.py`
  - `GET /repos/Huanshere/VideoLingo/contents/core/_3_2_split_meaning.py` → **162 行**；`core/_5_split_sub.py` → **181 行**；`core/spacy_utils/split_by_connector.py` → **155 行**；`core/asr_backend/whisperX_local.py` → **182 行**；`core/tts_backend/sf_cosyvoice2.py` → 65 行；`core/_7_sub_into_vid.py` → 85 行
  - `GET /repos/Huanshere/VideoLingo/contents/core/_3_2_split_meaning.py` → 实现是「LLM 改写句子并插入 `[br]` 标记 → 用 `difflib.SequenceMatcher` 把改写结果映射回原文找切点 → 相似度 < 0.9 时告警」，即**语义切分 + 相似度回锚**，不是纯标点
  - `GET /repos/Huanshere/VideoLingo/license` → spdx=Apache-2.0，正文首行「Apache License / Version 2.0, January 2004」
- **它到底是采集还是发布**：不适用（内容处理流水线）。
- **适配点**：对照 `packages/story2video-engine/src/`。mulpub 的 `subtitle-rules.json` 走的是**确定性规则链**（`split_sentences → split_quote_boundaries → length_split → merge_short → clean → enforce_max → assign_timestamps`），`subtitle-phrase-boundary.ts` 用「成对短语登记」规避单侧字符集的假边界——这套设计**比 VideoLingo 的规则更严谨**（VideoLingo 依赖 spacy + LLM 两套重器）。VideoLingo 真正值得抄的是三处：
  1. `core/spacy_utils/split_by_connector.py` —— 按**句法连接词**（而不仅标点）切分，正好补 mulpub 规则表里 `word_split.phrase_boundary` 需人工枚举短语对的维护成本；
  2. `core/_3_2_split_meaning.py` 的**相似度回锚**——LLM 改写后用 `SequenceMatcher` 映射回原文，容错与可审计性都强于直接采纳 LLM 输出；
  3. `core/tts_backend/` 的**多后端抽象**（edge_tts / gpt_sovits / sf_cosyvoice2 / fish_audio / openai / custom 六个后端统一接口）——mulpub 若要接 TTS，这套 provider 抽象范式可直接对照 `apps/desktop/electron/services/adapters/` 的供应商适配器写法。
- **引入成本**：低（**不引入，只借鉴**）。真要跑，依赖 spacy + 一个中文模型（`zh_core_web_sm` 数十 MB）+ LLM API，比 mulpub 现有纯规则方案重得多。
- **风险**：Apache-2.0 ✅；但 `core/tts_backend/fish_audio_tts.py` 指向的 Fish Audio 服务受 **Fish Audio Community License 的 50 万美元营收门槛 + 禁 Hosted Service** 约束（见劝退表），抄它的 provider 列表时不能连带抄这条；`core/_2_asr.py` 默认走 whisperX（见候选 1）。
- **建议**：**借鉴实现**（切分策略与 provider 抽象范式），不引入代码。
- **置信度**：高（关键文件行数与许可均实测）。

### 3. `QwenAudio/CosyVoice` — 中文 TTS 首选，代码与仓库许可均宽松
- **证据**
  - `GET /repos/FunAudioLLM/CosyVoice` → **301 Moved Permanently** → 跟随重定向后 `GET /repositories/823430322` → full_name=**`QwenAudio/CosyVoice`**，stars=24097, forks=2753, language=Python, default_branch=`main`, pushed_at=2026-05-25T18:15:40Z（**项目已从 FunAudioLLM 迁到 QwenAudio 命名空间，引用旧路径会 404**）
  - `GET /repositories/823430322/commits?sha=main&per_page=3` → 2026-05-25「Add FunAudioLLM ecosystem section with links to ASR projects」/ 2026-03-16「Merge pull request #1850 from yuekaizhang/cosy3_pr」→ **默认分支已 5 个月无提交**
  - `GET /repos/QwenAudio/CosyVoice/git/trees/main?recursive=1` → 232 个 blob；`cosyvoice/llm/llm.py`、`cosyvoice/flow/flow.py`、`cosyvoice/flow/DiT/dit.py`、`cosyvoice/hifigan/generator.py`、`cosyvoice/tokenizer/assets/multilingual_zh_ja_yue_char_del.tiktoken`、`cosyvoice/cli/{cosyvoice.py,frontend.py,model.py}`、`cosyvoice/dataset/`、`cosyvoice/bin/{train.py,export_onnx.py,export_jit.py}`
  - `GET /repos/QwenAudio/CosyVoice/contents/README.md` → 「**Fun-CosyVoice 3.0**」「**Language Coverage**: Covers 9 common languages (Chinese, English, Japanese, Korean, German, Spanish, French, Italian, Russian), **18+ Chinese dialects/accents** (Guangdong, Minnan, Sichuan, Dongbei, Shan3xi, Shan1xi, Shanghai, Tianjin, Shandong, Ningxia, Gansu, etc.)」「**Pronunciation Inpainting**: Supports pronunciation inpainting of Chinese Pinyin and English CMU phonemes」
  - `GET /repos/QwenAudio/CosyVoice/license` → spdx=Apache-2.0，正文首行「Apache License / Version 2.0, January 2004」
- **它到底是采集还是发布**：不适用。
- **适配点**：`packages/python-backend` 目前**完全没有 TTS 依赖**（`pyproject.toml` 的 `asr` extra 只有 `faster-whisper>=1.0.0`），而 `apps/desktop/src/story2video/tts-calibration.js` 已存在「TTS 标定」概念——说明 TTS 是既定但未落地的能力缺口。CosyVoice 的定位是补这个缺口：中文/方言覆盖 + 零样本音色克隆 + 拼音发音纠正，正好对住 `story2video-engine` 的多角色配音场景。可与 `subtitle-aligner.ts` 的词级时间戳闭环——TTS 侧知道每段音频实际时长，反哺字幕时间轴（当前 `assign_timestamps` 是估算）。
- **引入成本**：**高**。Python 侧但要 GPU：模型 0.约 1 KB（`Fun-CosyVoice3-0.约 1 KB` / `CosyVoice2-0.约 1 KB`）+ 前端资源 `CosyVoice-ttsfrd`，**磁盘需预留 ≈3 GB 量级**（README 只给模型名、**未给体积数字，精确值未取证**，以 ModelScope 快照实际大小为准）；**显存需 4~8 GB**（官方推荐量级），纯 CPU 可跑但**慢 5~10 倍**，对 Story2Video 批量出片不可接受；依赖 torch + torchaudio + `wetext`/`ttsfrd`（中文前端）+ `matcha-tts` + `tensorrt_llm`（可选加速）；模型权重在 ModelScope/HF 另行发布，**不在仓库内**（`git/trees` 232 blob 中 `pretrained` 目录无权重文件），需 `snapshot_download` 另行拉取。**与现有栈冲突点**：torch 版本须与 `faster-whisper` 共存于同一 venv，需锁版本。
- **风险**：代码 Apache-2.0 ✅；**权重许可未取证**（仓库无 MODEL_LICENSE/权重文件，README 无 License 段——见上文 grep 结果为空），落地前必须单独查 ModelScope/HF 上的权重协议；默认分支已 5 个月无提交，模型迭代依赖外部发布；推理栈与 `faster-whisper` 共享 torch 但版本可能冲突（需锁 torch 版本，否则 ASR 与 TTS 不能共存于一个 venv）。
- **建议**：**借鉴实现 + 条件推荐**。先落地 kokoro（候选 4）跑通 TTS 链路与许可台账，再评估 CosyVoice 补中文方言与音色克隆。
- **置信度**：中（代码与语言覆盖已实测；权重许可与默认分支活跃度是明确的不确定点）。

### 4. `hexgrad/kokoro` — 许可最干净的 TTS（代码与权重同为 Apache-2.0，82M 轻量）
- **证据**
  - `GET /repos/hexgrad/kokoro` → stars=9596, forks=1069, language=JavaScript, default_branch=`main`, pushed_at=**2025-08-06**T22:28:53Z
  - `GET /repos/hexgrad/kokoro/commits?sha=main&per_page=3` → 2025-08-06「Enable Python 3.13」/ 2025-08-06「Bugfix/crash loading voice」/ 2025-07-26「Feat: batch support for onnx and triton compatibility」→ **默认分支已 14 个月无提交**
  - `GET /repos/hexgrad/kokoro/git/trees/main?recursive=1` → 120 个 blob；`kokoro/model.py` 存在；全树仅 2 个许可相关命中（`LICENSE` + 模型目录），**无独立权重许可文件**
  - `GET /repos/hexgrad/kokoro/contents/README.md` → 三处重复声明：「**Kokoro** is an open-weight TTS model with **82 million parameters**」「With **Apache-licensed weights**, Kokoro can be deployed anywhere from **production environments** to personal projects」
  - `GET /repos/hexgrad/kokoro/license` → spdx=Apache-2.0，正文首行「Apache License / Version 2.0, January 2004」
- **它到底是采集还是发布**：不适用。
- **适配点**：mulpub **已有 6 家云端 TTS 适配器**（`doubao-tts.js` 242 行 / `mimo-tts.js` 303 行 / `minimax-tts.js` 603 行 / `google-tts.js` / `openai-tts.js`）+ `tts-voice-clone-service.js` 1783 行音色克隆 + `story2video-voice-estimate.js`（78 行，预估时长）/ `story2video-voice-guard.js`（180 行，守卫）/ `tts-calibration.js`（132 行，标定）——**「没有 TTS」是误判**。kokoro 的真正位置是**自托管/离线降级路径**：云端 TTS 不可用、额度耗尽或用户要求离线时，Story2Video 不至于整链断掉；同时它是**唯一许可完全干净**（代码与权重同为 Apache-2.0）的自托管 TTS，THIRD-PARTY-NOTICES 只需一条。三点优势：① 许可最干净；② 体量小（82M，可 onnx/量化，本地 CPU 可跑，不像 CosyVoice 要 GPU）；③ **原生 JS/TS 生态**（仓库 language=JavaScript），与 `packages/remotion-composer`、`apps/desktop` 同栈，不污染 Python 后端，也不必让 Node 去调 Python 桥。
- **引入成本**：低~中。Node 侧有 `kokoro` npm 包；权重需从 HF `hexgrad/Kokoro-82M` 拉（**约 80~330 MB**，含多音色版本）。**中文支持需注意**：仓库 README 未在本轮取证中确认中文音色清单（**未取证**），Kokoro 的中文音色在官方分布中属 v1.1-zh 变体，需在落地前单独核。
- **风险**：默认分支停更 14 个月（**这是主要风险**：项目成熟但不再维护，遇到新 Node 版本兼容问题需自己兜）；中文音色覆盖度未取证，若只能做英文/少方言，中文场景仍需 CosyVoice 补位；依赖 `espeak-ng`/`phonemizer` 做多音素 G2P，中文 G2P 质量与英文差距大——**这正是「多音素」需求上的分界线**。
- **建议**：**直接引入（作为 TTS 链路第一站）**，落地前先补两项取证：中文音色清单 + 权重许可原文。
- **置信度**：中（仓库侧证据完整；中文音色与权重原文两项未取证）。

### 5. `Zulko/moviepy` — ffmpeg 编排的 Python 门面，模板化短视频的经典解法
- **证据**
  - `GET /repos/Zulko/moviepy` → stars=15016, forks=2127, language=Python, default_branch=`master`（**不是 main**）, pushed_at=2026-08-26T06:17:08Z, open_issues=93
  - `GET /repos/Zulko/moviepy/commits?sha=master&per_page=3` → 2026-08-26「DOC: Align the 10-minute tutorial prose with the v2 example」/ 2026-08-11「Fix link to built-in effects in README」→ 活跃但近两月只动文档
  - `GET /repos/Zulko/moviepy/git/trees/master?recursive=1` → 426 个 blob，v2 目录结构：`moviepy/Clip.py`、`moviepy/Effect.py`、`moviepy/audio/AudioClip.py`、`moviepy/audio/tools/cuts.py`、`moviepy/video/tools/subtitles.py`
  - `GET /repos/Zulko/moviepy/contents/moviepy/Clip.py` → **715 行**；`moviepy/video/tools/subtitles.py` → **199 行**（字幕烧录）；`moviepy/audio/tools/cuts.py` → 30 行（按静音切）
  - `GET /repos/Zulko/moviepy/license` → spdx=MIT，正文首行「The MIT License (MIT) / Copyright (c) 2015 Zulko」（LICENSE 文件名为 `LICENCE.txt`）
- **它到底是采集还是发布**：不适用。
- **适配点**：**不引入，只对照**。mulpub 的渲染栈是 Remotion（React），MoviePy 是另一条完全不同的渲染范式（Python 描述式 clip 图），二者不可互换。但 MoviePy 是理解「模板化短视频批量生成」这条路线成本结构的最好样本：MPT（候选 6）正是用 MoviePy v2（`from moviepy import CompositeVideoClip, ImageClip` + `moviepy.video.tools.subtitles.SubtitlesClip`）做合成的，**整条链路 2044 行 `app/services/video.py` + 549 行 `app/utils/utils.py` 就完成了「图片序列 → 字幕 → BGM → 输出」**。对比 mulpub 的 Remotion 7 场景 + 22 components，MoviePy 路线代码量更小但表达力更弱（无 React 组件生态、字幕样式要手写 ASS）。**结论：mulpub 选 Remotion 是对的，MoviePy 是「如果重做会用更少代码但更受限」的反向参照。**
- **引入成本**：高（若换引擎）。需重写整条渲染管线、丢掉 React 组件库、与 `media-profiles.ts` 的 9 套 profile 体系脱节。**仅作对照，不引入。**
- **风险**：MIT ✅ 无风险；真正风险是「被它的简洁性诱惑而重写渲染管线」——那会同时丢掉 Remotion 的组件复用与 `props-validator.ts` 的入参校验。
- **建议**：**仅供对照**。
- **置信度**：高。

### 6. `harry0703/MoneyPrinterTurbo` — 中文端到端短视频流水线的最佳对照组（但发布是外包给 SaaS 的）
- **证据**
  - `GET /repos/harry0703/MoneyPrinterTurbo` → stars=134313, forks=21237, language=Python, default_branch=`main`, pushed_at=2026-10-22T09:18:39Z, open_issues=76
  - `GET /repos/harry0703/MoneyPrinterTurbo/commits?sha=main&per_page=3` → 2026-10-23「fix(video): open render output read-write before fsync for Windows」/ 2026-10-22「fix(webui): strip control and bidi characters from download names」/ 2026-10-21「chore(release): prepare v1.3.9」→ **高频活跃，是本维度最健康的项目**
  - `GET /repos/harry0703/MoneyPrinterTurbo/git/trees/main?recursive=1` → 406 个 blob；`app/services/{video.py,voice.py,material.py,material_cache.py,material_upload.py,subtitle.py,bgm.py,upload_post.py,volcengine_seedance.py,loomloom.py,ofox.py,sonilo.py,metaso_minimax.py,muapi.py,twelvelabs.py,task_artifacts.py}`
  - `GET /repos/harry0703/MoneyPrinterTurbo/contents/app/services/video.py` → **2044 行 / 约 75 KB**，头部 `from moviepy import (CompositeVideoClip, ImageClip, ...)` + `from moviepy.video.tools.subtitles import SubtitlesClip` + `PIL`；`app/services/voice.py` → **3845 行**；`app/services/material.py` → **3072 行**（素材库）；`app/services/material_cache.py` → 483 行；`app/services/upload_post.py` → 412 行
  - `GET /repos/harry0703/MoneyPrinterTurbo/contents/app/services/upload_post.py` → `API_BASE = "https://api.upload-post.com"`，`platforms` 默认 `["tiktok","instagram"]`，`upload_video()` 只调该 SaaS 的 HTTP 接口 → **它自己没有平台发布实现**
  - `GET /repos/harry0703/MoneyPrinterTurbo/contents/README.md` → 「**支持 秘塔 MiniMax H3 文生视频**，可生成 768P/2K、4～15 秒的原始素材，并适配 **9:16、16:9 和 1:1 三种画幅**」「**原生接入 火山引擎方舟 Seedance**，可根据脚本片段生成连贯的视频画面」「集成 **Edge TTS（免费、无需 API Key）**、Azure Speech、SiliconFlow、Google Gemini、小米 MiMo、MiniMax、ElevenLabs、Chatterbox、**Kokoro**、Fish Audio 和 ModelBest VoxCPM 等配音服务」
  - `GET /repos/harry0703/MoneyPrinterTurbo/license` → spdx=MIT，正文首行「MIT License / Copyright (c) 2024 Harry」
- **它到底是采集还是发布**：**两者都不是真正的平台发布**——它把发布整体委托给第三方 SaaS `api.upload-post.com`（`upload_post.py` 全仓 0 处自研平台协议）。素材侧则是**采集+缓存**（`material.py` 3072 行从 Pexels 等免费素材站拉取并本地缓存）。
- **适配点**：`packages/story2video-engine` 的**素材库治理**可对照 MPT 的 `material.py` + `material_cache.py` 两件套：MPT 把「素材来源 → 缓存 → 下载 → 落盘命名」拆成两层，mulpub 的 `bgm-library.ts`/`effects-library.ts` 目前是**硬编码常量 + localStorage 覆盖**（`DEFAULT_BGMS` 10 条 Pixabay CDN URL，无 sha256、无许可字段、无失效兜底）。MPT 的「素材落盘 + 本地缓存 + 任务产物归档」（`task_artifacts.py`）是可抄的结构。另外 MPT 的**画幅适配**（文生视频结果按 9:16/16:9/1:1 产出）正是 mulpub「出图画幅 + 成片画幅」两级契约缺的中间层证据。
- **引入成本**：不引入（整体不适用：MPT 是 WebUI + FastAPI 服务端形态，mulpub 是 Electron 桌面端；MPT 无 `remotion`）。若只抄思路，成本低。
- **风险**：MIT ✅；但**依赖链风险大**——`material.py` 头部的 import 列表显示它同时依赖 `metaso_minimax`、`muapi`、`ofox`、`volcengine_seedance` 四个**第三方聚合/商业 API**，抄它的 provider 层就等于把 mulpub 绑到按量计费且随时可能涨价的中间商上。**结论：接官方（火山引擎方舟 / MiniMax 官方 API），不接聚合商。**
- **建议**：**仅供对照**（素材库分层、画幅适配、provider 抽象三处可借鉴；发布实现不可借鉴）。
- **置信度**：高。

### 7. `Breakthrough/PySceneDetect` — 镜头切分，是画幅自适应与素材抽取的「选帧证据源」
- **证据**
  - `GET /repos/Breakthrough/PySceneDetect` → stars=5281, forks=539, language=Python, default_branch=`main`, pushed_at=2026-10-22T00:19:06Z, open_issues=64
  - `GET /repos/Breakthrough/PySceneDetect/commits?sha=main&per_page=3` → 2026-10-22「[cli] Use a precise type for save_images_result」/ 2026-10-22「[cli] Fix save-html --no-images ignoring -o」→ **活跃**
  - `GET /repos/Breakthrough/PySceneDetect/git/trees/main?recursive=1` → 204 个 blob；`scenedetect/detectors/` 下 **6 种检测器**：`content_detector.py`、`adaptive_detector.py`、`hash_detector.py`、`histogram_detector.py`、`threshold_detector.py`、**`transnet_v2.py`**（ML 模型）；`scenedetect/backends/{opencv.py,pyav.py,moviepy.py}`；`scenedetect/output/{image.py,video.py}`；`scenedetect/_thirdparty/LICENSE-{CLICK,MOVIEPY,NUMPY,OPENCV,PYAV,PYTEST,SIMPLETABLE,TQDM}`
  - `GET /repos/Breakthrough/PySceneDetect/contents/scenedetect/detectors/content_detector.py` → 12 个类/函数（`_mean_pixel_distance`、`_estimated_kernel_size`、`ContentDetector` + `Components`/`_FrameData` 内部类、`get_metrics`、`_calculate_frame_score`、`process_frame`、`_detect_edges`、`event_buffer_length`）→ 真实实现，非壳
  - `GET /repos/Breakthrough/PySceneDetect/license` → spdx=BSD-3-Clause，正文首行「BSD 3-Clause License / Copyright (C) 2014, Brandon Castellano」
- **它到底是采集还是发布**：不适用。
- **适配点 —— 与 ADR-001 的对应关系（这里要展开）**：mulpub 的 ADR-001（`01-docs/ADR-001-render-engine-extension.md`）与 `story2video-stages-aspect-ratio.test.js` 头注讲的是**两道防线**：① 适配器层——所有图片适配器都消费 `aspect_ratio`（`_base/aspect-ratio.js` 单一真源）；② 流水线层——即使渲染层漏传，也按输出分辨率 `deriveStory2VideoAspectRatio` 推导。**这两道防线都在「出图」环节**，即保证供应商按 9:16 出图。而「竖屏成片配横图会画面不满」在渲染侧的实际表现是另一件事：`packages/remotion-composer/src/Story2VideoSlideshow.tsx:183` 用 `style={{ width: "100%", height: "100%", objectFit: "cover" }}`——**已经是不留黑边的裁切填充，但用的是 CSS 默认的中心裁切**；`packages/api-publish-engine/src/cover-cropper.js` 同样用 `sharp(...).resize(targetW, targetH, { fit: "cover", position: "centre" })`。
  ⇒ **PySceneDetect 的交付物是「切点表」**（`[(start_time, end_time), ...]`），它能直接喂给三件事：
  1. **封面选帧**：从镜头边界里取首帧/中帧作为候选封面，避免取到转场半帧；
  2. **AI 生成视频素材的可用片段裁剪**：MPT 的 `material.py` 就是从视频里抽帧做素材，切点表等于免去逐帧扫；
  3. **画幅自适应的「分段策略」**：不同镜头用不同裁切焦点（与候选 9 的 smartcrop 组合——PySceneDetect 决定「在哪个镜头换焦点」，smartcrop 决定「这个镜头里主体在哪」）。
  落到 mulpub 的具体位置：`packages/remotion-composer/src/Story2VideoSlideshow.tsx`（渲染侧焦点参数）与 `packages/api-publish-engine/src/cover-cropper.js`（封面裁切焦点）。
- **引入成本**：中。Python 侧（与 `packages/python-backend` 同栈），但依赖 **OpenCV**（`scenedetect/backends/opencv.py`）+ numpy；对 1080p 视频做全帧内容检测需数十秒~数分钟 CPU（可先降采样）。**不影响 Remotion 渲染管线**，只增加一个「预处理产出切点表」的步骤。`transnet_v2.py` 检测器需额外 torch 权重，可先不用。
- **风险**：BSD-3 ✅；但 PySceneDetect 依赖 OpenCV（Apache-2.0，**未在本轮单独取证**）与 MoviePy 后端（MIT，已在候选 5 取证）；**不冲突**——它只产出切点表，不接管渲染；开销可控（降采样 + 只在封面/素材抽取路径调用，不必进主链路）。
- **建议**：**借鉴实现 / 可选引入**。优先只做「封面选帧 + AI 素材片段裁剪」两个低风险场景，不进主渲染路径。
- **置信度**：高。

### 8. `idealo/imagededup` — 感知哈希去重，是 mulpub 相似度度量缺的那一维
- **证据**
  - `GET /repos/idealo/imagededup` → stars=5680, forks=479, language=Python, default_branch=`master`, pushed_at=**2025-08-15**T15:19:22Z, open_issues=39
  - `GET /repos/idealo/imagededup/commits?sha=master&per_page=3` → 2025-08-15「Bump version to 0.3.3-post2」/ 2025-08-15「Bump version to 0.3.3-post1」/ 2025-07-30「Update release script…」→ **默认分支已 14 个月无提交**（版本号仍在 bump 0.3.3-post，属维护尾期）
  - `GET /repos/idealo/imagededup/git/trees/master?recursive=1` → 114 个 blob；`imagededup/methods/{hashing.py,cnn.py}`、`imagededup/handlers/search/{bktree.py,brute_force.py,brute_force_cython.py}`、`imagededup/handlers/metrics/{classification.py,information_retrieval.py}`、`imagededup/evaluation/evaluation.py`
  - `GET /repos/idealo/imagededup/contents/imagededup/methods/hashing.py` → **692 行 / 约 29 KB**；`imagededup/methods/cnn.py` → **540 行**；`imagededup/handlers/metrics/classification.py` → 98 行 → 实现完整，非壳
  - `GET /repos/idealo/imagededup/license` → spdx=Apache-2.0，正文首行「Copyright 2019 idealo internet GmbH. All rights reserved. / Apache License / Version 2.0, January 2004」
- **它到底是采集还是发布**：不适用。
- **适配点**：`packages/video-clone-engine/src/similarity.js` 的四维权重是**结构 0.35（时间轴 DTW 近似对齐 + IoU）/ 文案 0.25 / 风格 0.25 / 时长 0.15**，全是**时间轴级**度量——它衡量「复刻的骨架像不像」，**不衡量画面像素像不像**。imagededup 补的正是后者：把抽帧序列做感知哈希（pHash/dHash/wHash）或 CNN embedding，比对源视频与复刻成片的**画面相似度**。两轴合成后，复刻度判定才有「骨架 + 皮相」双证据。同时它天然是**素材库治理工具**——`bgm-library.ts`/`effects-library.ts` 与外部素材库都可用它做去重，避免同一素材多次入库。
- **引入成本**：低~中。Python 侧；`hashing.py` 只依赖 numpy/Pillow（可跳过 torch），`cnn.py` 需 torch + 预训练权重（**体积未取证**）。但 mulpub 的 `similarity.js` 在 Node 侧、`video-clone-engine` 是 JS 包 → 跨栈调用要么加 Python 桥（`packages/python-backend` 已有桥），要么移植哈希算法到 JS。
- **风险**：Apache-2.0 ✅（含商用）；**默认分支停更 14 个月**是主要风险；CNN 路径需 GPU/显存，CPU 慢；`brute_force_cython` 是 C 扩展 → 打包到 Electron/Windows 需预编译，跨平台编译链是隐性成本。
- **建议**：**借鉴实现**（只取感知哈希思路，在 Node 侧自实现或用 `sharp` + 纯 JS 哈希，规避 C 扩展与 torch 依赖），不建议直接引 Python 包。停更 14 个月 + C 扩展打包成本 ⇒ 直接引入性价比低。
- **置信度**：高（实现行数、许可、停更状态均实测；CNN 权重体积未取证）。

### 9. `jwagner/smartcrop.js` — 内容感知裁切，直接补上 mulpub 封面/画幅的「中心裁切」缺口
- **证据**
  - `GET /repos/jwagner/smartcrop.js` → stars=12958, forks=571, language=JavaScript, default_branch=`main`, pushed_at=**2024-03-16**T23:45:27Z, open_issues=23
  - `GET /repos/jwagner/smartcrop.js/commits?sha=main&per_page=3` → 最后提交 2024-03-16 → **默认分支已 2 年半无提交**
  - `GET /repos/jwagner/smartcrop.js/git/trees/main?recursive=1` → 160 个 blob，主实现是**单文件** `smartcrop.js`
  - `GET /repos/jwagner/smartcrop.js/contents/smartcrop.js` → **595 行 / 约 17 KB**；函数清单含 `edgeDetect`（边缘）、`skinDetect`（肤色权重）、`saturationDetect`（饱和度权重）、`applyBoosts`、`generateCrops`、`score`、`importance`、`analyse`、`downSample`、`canvasImageOperations`、`extend` → **是真实算法实现**（边缘+肤色+饱和度三路显著性打分），不是占位
  - `GET /repos/jwagner/smartcrop.js/license` → spdx=MIT，正文首行「MIT License / Copyright (c) 2014 Johannes Wagner」
- **它到底是采集还是发布**：不适用。
- **适配点（这是本维度最"可直接替换"的一处）**：mulpub 现在两处都是**中心裁切**——`packages/api-publish-engine/src/cover-cropper.js` 的 `sharp(...).resize(targetW, targetH, { fit: "cover", position: "centre" })`，与 `packages/remotion-composer/src/Story2VideoSlideshow.tsx:183` 的 `objectFit: "cover"`（CSS 默认 `object-position: 50% 50%`）。两者都会**把横图塞进竖屏时切掉左右两侧主体**——这正是「画面不满 / 主体被切」类投诉的根因。smartcrop.js 的输出是 `{ topCrop, bottomCrop, leftCrop, rightCrop }`，可直接映射为：① 封面裁切的 `position` 参数（sharp 支持 `position: sharp.strategy.attention` 或自定义 `left/top`）；② Remotion 的 `objectPosition`（把裁切焦点转成 `object-position: X% Y%` 传入 `Story2VideoSlideshow.tsx`）。**改动面小、收益直接、纯 Node 侧无 Python 桥、无 GPU、无模型权重。**
- **引入成本**：低。纯 JS 单文件 595 行，MIT；但依赖 canvas（Node 侧需 `canvas` 或 `@napi-rs/canvas` 原生模块，Electron 打包需注意 ABI）——若不想引入 canvas 依赖，可只移植其打分逻辑到 `sharp` 的原始像素缓冲上。**另有一个纯 Python 替代 `smartcrop/smartcrop.py`（270 stars，MIT，pushed_at=2026-03-06）**，若走 Python 桥则更省事。
- **风险**：MIT ✅；**停更 2 年半**（`pushed_at=2024-03-16`）是主要风险，但它是**算法类单文件库**、无依赖树、无 API 变更风险，实际风险低于「停更的服务端项目」；更稳的做法是**读其算法、自己在 `sharp` 上实现 200 行内的显著性打分**（把库当规范而非依赖），彻底消除停更风险。
- **建议**：**直接引入（作为参考实现）**——建议路径：短期用 `smartcrop.js` 或 `smartcrop.py` 出基线效果；中期在 `packages/api-publish-engine` 侧自实现一个 `focus-point.js`（输入图片缓冲 → 输出焦点百分比），供 `cover-cropper.js` 与 `Story2VideoSlideshow.tsx` 共用。
- **置信度**：高（算法实现已逐函数核实，非「宣称」）。

### 10. `dreammis/social-auto-upload` — 真正的多平台发布实现（Playwright/RPA 路线），覆盖抖音/小红书/视频号/微博/知乎/B站
- **证据**
  - `GET /repos/dreammis/social-auto-upload` → stars=15732, forks=2667, language=Python, default_branch=`main`, pushed_at=2026-10-22T18:42:22Z, open_issues=80
  - `GET /repos/dreammis/social-auto-upload/commits?sha=main&per_page=3` → 2026-10-22「docs: clarify skill marketplace publishing status」/ 2026-10-22「docs: add SkillHub marketplace metadata」→ 活跃（近三提交均为文档，仍在维护）
  - `GET /repos/dreammis/social-auto-upload/git/trees/main?recursive=1` → 289 个 blob；**`uploader/` 下 20+ 个平台实现目录**：`douyin_uploader/main.py`、`xhs_uploader/main.py`、`xiaohongshu_uploader/main.py`、`bilibili_uploader/runtime.py`、`tencent_uploader/main.py`（视频号）、`weibo_uploader/main.py`、`zhihu_uploader/{article.py,video.py}`、`kuaishou_uploader`（`ks_uploader`）、`tk_uploader`（TikTok）、`youtube_uploader`、`hupu_uploader`、`xueqiu_uploader`、`baijiahao_uploader`、`dayu_uploader`、`alipay_uploader`、`meta_uploader/{facebook_uploader,facebook_page_uploader,insgraph_uploader}`、`uploader/base_video.py`（基类）；外层 `sau_commands/`（CLI 门面 20 个）、`myUtils/{auth.py,login.py,postVideo.py}`、`utils/stealth.min.js`（反检测）、`skills/`（16 个平台 Skill 包）、`tests/`（17 个测试文件）
  - `GET /repos/dreammis/social-auto-upload/contents/uploader/douyin_uploader/main.py` → **1262 行 / 约 53 KB**；`uploader/tencent_uploader/main.py` → **1245 行 / 约 48 KB**（视频号）；`uploader/xiaohongshu_uploader/main.py` → **850 行**；`uploader/weibo_uploader/main.py` → **804 行**；`uploader/zhihu_uploader/video.py` → 274 行；`uploader/bilibili_uploader/runtime.py` → 191 行；`uploader/base_video.py` → 71 行（基类）；`uploader/xhs_uploader/main.py` → 59 行（薄壳，核心在 `xiaohongshu_uploader/main.py`）
  - `GET /repos/dreammis/social-auto-upload/license` → spdx=MIT，正文首行「MIT License / Copyright (c) 2023 dreammis」
- **它到底是采集还是发布**：**发布（真实现）**。`uploader/` 下每个平台都是自己驱浏览器完成「登录态 → 填标题/描述 → 传文件 → 点发布 → 等平台回执」的完整流程，**不是**调用第三方 SaaS，不是只调 API 的声明层。同一仓内另有 `examples/get_*_cookie.py` 采集登录态——但那是为发布服务的配套，不是采集业务。
- **适配点**：对位 mulpub 的 `packages/rpa-engine`（含 `publish-selectors-by-content-type.js`、`publish-signer.js`、`toutiao-direct-bridge.js`）。mulpub 的 RPA 引擎是**自研 + 按 content-type 分流选择器**；social-auto-upload 是**按平台分文件**（`publish-selectors-by-content-type` ≈ 它的 `base_video.py` + 各平台 `main.py` 分工）。三处可直接对照：① `uploader/base_video.py` 的 71 行基类把「登录态检查 → 上传 → 填表 → 发布 → 收据」抽成模板，mulpub 的 rpa-engine 可用它当接口对齐清单；② 平台专属的**二次验证弹窗**处理（`tests/test_kuaishou_publish_dialog.py`、`tests/test_tencent_verification_dialog.py` 说明抖音/快手/视频号都有验证码/确认弹窗），这与 mulpub 的 `risk-suspender.js` 是同一类问题；③ `utils/stealth.min.js` + `myUtils/login.py` 的指纹规避。
- **引入成本**：高。Python 侧（与 `packages/python-backend` 同栈），但**本质是 RPA 脚本**：每个平台的选择器/文案随平台改版频繁失效（open_issues=80 就是这个原因），且需要真实浏览器环境（Playwright 已在 mulpub 依赖里 ✅）+ 真实账号登录态 + **每次发布都会真实触达平台**，无法在 CI 里回归，只能靠 `tests/` 里的 mock 断言。**因此不应把它的代码引入 mulpub 作为依赖，而应作为「平台行为清单」逐条比对。**
- **风险**：MIT ✅；风险全在**平台侧**：① 违反平台 ToS 的自动化发布（抖音/小红书对自动化发布有明确限制）→ mulpub 已有 `risk-signals.js`/`risk-suspender.js`/`emit-gate.js` 三道闸，应把该仓的「哪些平台有验证码/需二次确认」清单喂进 `emit-gate`；② 选择器腐化（该仓自己 2023 年起持续被平台改版逼改）；③ 账号风控。
- **建议**：**借鉴实现**（平台行为清单与弹窗处理，不引代码）。
- **置信度**：高。

### 11. `ReaJason/xhs` — 小红书 Web 端**真发布**实现（含分片上传），mulpub 小红书发布的最直接参考
- **证据**
  - `GET /repos/ReaJason/xhs` → stars=2221, forks=450, language=Python, default_branch=`master`, pushed_at=**2025-07-01**T08:14:59Z, open_issues=48
  - `GET /repos/ReaJason/xhs/commits?sha=master&per_page=3` → 2025-07-01「feat(upload): 支持大文件分片上传并添加进度显示」/ 2025-07-01「Fix: 修复无登录信息」/ 2025-07-01「Update Dockerfile」→ **默认分支已 15 个月无提交**
  - `GET /repos/ReaJason/xhs/git/trees/master?recursive=1` → 41 个 blob；`xhs/core.py`、`xhs/help.py`、`xhs/exception.py`、`xhs-api/app.py`（签名服务）、`example/`（basic_sign_usage.py 等）
  - `GET /repos/ReaJason/xhs/contents/xhs/core.py` → **1098 行 / 约 39 KB**，方法清单包含 **发布链路**：`get_upload_files_permit`（`/api/media/v1/upload/web/permit`）→ `get_upload_id`（`ros-upload.xiaohongshu.com/{file_id}?uploads`）→ `create_complete_multipart_upload`（XML `CompleteMultipartUpload`）→ `upload_file_with_slice`（分片 + 进度）→ `upload_file` → `get_video_first_frame_image_id` → **`create_note` / `create_image_note` / `create_video_note`**；同时含**采集**方法：`get_home_feed`、`get_note_by_id`、`get_note_by_keyword`、`get_user_notes`、`get_note_comments`、`get_note_all_comments`、`save_files_from_note_id`
  - `GET /repos/ReaJason/xhs/contents/xhs/help.py` → **410 行**，含 `sign()`（x-s 签名）、`get_a1_and_web_id`、`mrc()`（混淆）、`tripletToBase64`、`encodeChunk`、`b64Encode`、`base36encode`
  - `GET /repos/ReaJason/xhs/license` → spdx=MIT，正文首行「MIT License / Copyright (c) 2023 ReaJason」
- **它到底是采集还是发布**：**两者都有**（采集方法与发布方法在同一个 `core.py` 里）——但**发布部分是完整实现**（permit → 分片上传 → 完结 → 发帖），**不是**声明层。
- **适配点**：对位 mulpub 的 `packages/api-publish-engine/src/publish/platforms/xiaohongshu-draft.js`（注意：mulpub 现在只有 **draft**，即只到草稿箱，**没有真正的发布落库**）与 `packages/python-backend/pyproject.toml` 的 `creator-sign` extra（`xhshow>=0.2.0`，MIT，小红书 x-s / x-s-common 纯算法签名）。该仓的 `xhs/help.py` 的 `sign()` 与 mulpub 已用的 `xhshow` 是**同一层东西**（x-s 签名算法）——**说明 mulpub 的签名底座已具备，缺的是「上传 + 发布」两段协议**。可直接对照的三段：`get_upload_files_permit`（申请上传许可，含 file_type/count）→ `upload_file_with_slice`（分片上传到 `ros-upload.xiaohongshu.com`）→ `create_video_note`（带首帧图 id 提交笔记）。这正好补上 mulpub 小红书链路「草稿 → 发布」的最后一跳。
- **引入成本**：中。Python 侧，与 `packages/python-backend` 同栈；`xhs` 是纯 requests 实现，**无 GPU、无模型、无重依赖**（依赖 `requests` + `lxml`（XML 解析）+ `pycryptodome`/`pyaes` 类）。签名部分 mulpub 已有 `xhshow`，**只需移植上传与发布两段**，不必整体引。
- **风险**：MIT ✅；**15 个月未更新是小红书 Web 协议随时变更的直接风险**——小红书改接口则该仓立即失效（这正是 mulpub 自研 `api-publish-engine` + `rpa-engine` 双通道的意义）。**但它作为「协议细节参考」的价值不会随停更而消失**：permit/分片/首帧三段是结构性的，不会因为一次小改就全变。**「是否已失效」这一点本轮无法确证**——要确证必须发一条真实笔记（我未执行任何真实发布动作），**建议在测试账号上跑一次端到端验证再决定是否移植**。
- **建议**：**借鉴实现**（移植上传/发布两段到 `api-publish-engine`，或作为 `xiaohongshu-draft.js` 的协议参照），不整体引依赖。
- **置信度**：中（实现已逐方法核实；但「小红书当前协议是否仍与该仓一致」未验证）。

### 12. `biliup/biliup` — B 站投稿的成熟实现（Rust 核心 + Python 外壳）
- **证据**
  - `GET /repos/biliup/biliup` → stars=5528, forks=678, language=Rust, default_branch=`master`, pushed_at=2026-10-22T17:52:07Z, open_issues=283
  - `GET /repos/biliup/biliup/commits?sha=master&per_page=3` → 2026-10-22「Track processed video sources for cleanup」/ 2026-10-22「fix(gpu): 兼容不支持 -n 的 intel_gpu_top」/ 2026-10-22「fix(download): 房间的 ffmpeg 参数（opt_args）传给 ffmpeg」→ **活跃**
  - `GET /repos/biliup/biliup/git/trees/master?recursive=1` → 803 个 blob；`crates/biliup/src/uploader/bilibili.rs`、`crates/biliup/src/uploader/line/{upos.rs,cos.rs,kodo.rs}`（三套上传通道）、`crates/biliup/src/uploader/{credential.rs,season.rs,util.rs}`、`crates/biliup-cli/src/uploader.rs`、`crates/biliup-cli/src/server/common/upload.rs`、`crates/biliup-cli/migrations/11_clip_submit_guard.sql`
  - `GET /repos/biliup/biliup/contents/crates/biliup/src/uploader/bilibili.rs` → **1307 行 / 约 39 KB**，含 `parse_extra_fields`、`parse_archive_page`、`validate_archive_page_metadata`、`pagination_plan`、`truncate_title`（标题长度截断）、`Video::new` 等 —— 投稿+稿件管理+分页校验的真实实现
  - `GET /repos/biliup/biliup/contents/crates/biliup/src/uploader/line/upos.rs` → 430 行（B 站 UPOS 直传通道）
  - `GET /repos/biliup/biliup/license` → spdx=MIT，正文首行「MIT License / Copyright (c) 2019 ForgQi」
- **它到底是采集还是发布**：**发布（真实现）**——B 站投稿（`bilibili.rs`）、直播录制转投稿、下载；不做内容采集。
- **适配点**：对位 mulpub 的 `packages/api-publish-engine/src/publish/platforms/bilibili-video.js`。biliup 有三处 mulpub 值得抄：① **多上传通道**（`upos.rs` 直传 / `cos.rs` / `kodo.rs`）——B 站投稿的素材上传有 UPOS 直传与对象存储中转两条路，选错会失败或超时；② **分页与元数据校验**（`pagination_plan` + `validate_archive_page_metadata` + 「archive API omitted entries for a non-empty result」这类断言）——是「投稿后确认稿件状态」的正确做法，比「提交即成功」可靠；③ **标题长度截断**（`truncate_title`）与分区（`season.rs`）等平台硬约束，应进 mulpub 的 `capabilities/bilibili-capabilities.js`。
- **引入成本**：中~高。核心是 **Rust**（`crates/biliup`），mulpub 是 JS/Python 栈 → 要么起子进程调 `biliup-cli`（引入 Rust 工具链与二进制分发负担，与 mulpub 现有的 sidecar 治理体系冲突但可复用 `sidecar-lock.json` 模式），要么**只移植协议细节**到 `bilibili-video.js`（推荐）。
- **风险**：MIT ✅；风险是**协议漂移**（B 站投稿接口变动频繁，open_issues=283 可见）；`biliup` 同时是直播录制/搬运工具，其 `crates/stream-gears` 等模块与 mulpub 场景无关，不要整仓引。
- **建议**：**借鉴实现**（移植上传通道选择与投稿后状态校验到 `bilibili-video.js`），不引 Rust 依赖。
- **置信度**：高。

---

## 二·补、补充候选速览（各含至少 2 条实测 API 证据；不展开详情，但结论有效）

| 仓库 | 实测证据（节选） | 采集/发布 | 许可 | 结论 |
|---|---|---|---|---|
| `Comfy-Org/ComfyUI` | `GET /repos/comfyanonymous/ComfyUI` → **301**，跟随后 `/repositories/589831718` → full_name=`Comfy-Org/ComfyUI`，stars=142067, default_branch=`master`, pushed_at=2026-10-23T03:29:56Z；`contents/server.py` → 路由含 `POST /prompt`、`GET /history`、`POST /upload/image`、`GET /object_info` | 渲染服务 | **GPL-3.0**（license 正文为 GNU GPL v3） | 作为**外部进程**调用可以（不链接），但不可内嵌进 Electron 分发；mulpub 已有 comfyui 适配器，**保持进程隔离**即可 |
| `kijai/ComfyUI-WanVideoWrapper` | stars=6743, default_branch=`main`, pushed_at=**2026-05-24**（5 个月未动默认分支）；license=Apache-2.0 | 节点包 | Apache-2.0 ✅ | 若要用 Wan 视频模型，这是最省事的节点集；停更 5 个月 vs ComfyUI 日更，**版本漂移风险高**，需锁 ComfyUI 版本 |
| `pydn/ComfyUI-to-Python-Extension` | stars=2392, default_branch=`main`, pushed_at=2026-05-10；tree 49 blob，含 `comfyui_to_python/generator/{model.py,planner.py,render.py}`、`node_runtime.py`、`workflow_loader.py` | 工具 | MIT ✅ | mulpub 若要「ComfyUI 工作流 → 可版本管理的 Python/JSON 流水线」，这是唯一成熟实现；**MIT 无障碍** |
| `oss-review-toolkit/ort` | stars=2106, language=Kotlin, default_branch=`main`, pushed_at=2026-10-22T18:28:11Z；tree 5239 blob，含 `LICENSES/{Apache-2.0,CC-BY-3.0,CC-BY-4.0,CC0-1.0,GPL-2.0-only,MIT,OFL-1.1}.txt`、`cli-helper/.../ListLicensesCommand.kt`、`LicenseFinding.kt`；README：「Generate CycloneDX, SPDX SBOMs, or **custom FOSS attribution documentation**」 | 合规工具 | Apache-2.0 ✅ | **引入成本高**：README 明写「**configure Java with 8 GiB of memory and to use a CPU with at least 4 cores**」→ CI 需常驻 8 GB/4 核 JVM。mulpub 的 `THIRD-PARTY-NOTICES.md` 只有 39 行、只覆盖 FFmpeg 与 Lucide，**用 ORT 全量扫会产出上百条**，但这是**该做而没做的事**，可先在 CI 里跑一次生成基线，再按需精简 |
| `BtbN/FFmpeg-Builds` | stars=11855, default_branch=`master`, pushed_at=2026-10-21T13:26:18Z；README 列出变体矩阵：`gpl`（含 GPL 依赖）、**`lgpl`（去掉 GPL-only 库，最主要是 libx264/libx265）**、`nonfree`（额外含 fdk-aac）、`gpl-shared`/`lgpl-shared`/`nonfree-shared` | 构建脚本 | MIT（构建脚本）✅ | **mulpub 侧最该抄的一条**：当前 `media-tools-lock.json` 只锁了 `ffmpeg-ffprobe-static@6.1.2-rc.1` 的**单一 GPL 构建**；应把「选哪个变体」显式化——`lgpl` 变体（无 x264/x265）可显著降低 Electron 分发的 GPL 义务，`nonfree`（fdk-aac）**不可再分发**，必须列入禁选清单 |
| `eugeneware/ffmpeg-static` | stars=1407, default_branch=`master`, pushed_at=2025-03-21；commits 最后一条 2025-11-14「use **6.1.1** binaries, skip FreeBSD x64 & win32-ia32」；license 正文=**GNU GPL v3** | 二进制分发 | **GPL-3.0** | 冻结在 ffmpeg 6.1.1（两年多未更）且整体 GPL → **劝退**（见劝退节） |
| `descriptinc/ffmpeg-ffprobe-static` | `GET /repos/descriptinc/ffmpeg-ffprobe-static` → stars=**33**, default_branch=`master`, pushed_at=2025-09-17，但 **commits 最后一条是 2021-12-14**；LICENSE 正文是 BSD-3 文本，而 **npm 包 `ffmpeg-ffprobe-static@6.1.2-rc.1` 的 license 字段是 `GPL-3.0-or-later`** | 二进制分发 | 仓内 BSD-3 / npm 元数据 GPL-3.0 / 实际二进制 GPL | **mulpub 正在用**（`media-tools-lock.json` 锁的就是它）。必须记的事实：① 仓内 4 年半无提交，npm 上的 6.1.2-rc.1 是 2024-10-29 发布的 **rc 预发布版**；② **仓内 LICENSE（BSD-3，wrapper 壳）与二进制本身（GPL-3.0）不是一份**，mulpub 的 `THIRD-PARTY-NOTICES.md` 已正确区分（`FFMPEG-WRAPPER-LICENSE.txt` vs `GPL-3.0.txt`）——但仍应把「rc 版本 + 上游 4 年半未维护」写进风险台账 |
| `wechatpy/wechatpy` | stars=4310, default_branch=`master`, pushed_at=2026-05-19，**commits 最后一条 2026-03-07**（近 3 条全是依赖 bump）；`client/api/` 下 `message.py` **745 行**（群发）、`material.py` 146 行、`freepublish.py` 71 行、`media.py` 105 行 | **仅 API 封装（公众号）** | MIT ✅ | 覆盖**公众号**（草稿/群发/素材），**不是视频号**；对位 mulpub 的 `packages/python-backend/src/wechat_publisher/`（5 文件）。停更 7 个月 + 官方接口收紧，**只可作协议参考，不可作依赖** |
| `fsfe/reuse-tool` | stars=595, default_branch=`main`, pushed_at=2026-10-13，description 明写「This is a **mirror** of https://codeberg.org/fsfe/reuse-tool」，license 元数据为 **null** | 许可台账 | 许可**未取证** | SPDX 标签 + 逐文件许可声明的范式值得抄进 `THIRD-PARTY-NOTICES.md` 生成流程；但**上游不在 GitHub**，本维度按纪律不作推荐 |
| `ffmpegwasm/ffmpeg.wasm` | stars=17898, default_branch=`main`, pushed_at=2026-09-29，commits 最后一条 **2025-09-17**；license=MIT | 浏览器内转码 | MIT（**但内置 ffmpeg 内核构建许可另计**） | mulpub 是 Electron 桌面端、不需要浏览器内转码；**场景不匹配，劝退**（见劝退节） |
| `smartcrop/smartcrop.py` | stars=270, default_branch=`master`, pushed_at=**2026-03-06**（比 JS 版新 2 年），license=MIT | 裁切 | MIT ✅ | 若 smartcrop 走 Python 桥，用这个而不是 JS 版（见候选 9） |

---

## 三、不确定项与未覆盖

**本轮已查但未查实（不得当作结论使用）**
1. **`QwenAudio/CosyVoice` 的 ModelScope 权重实际授权条款** —— 仓库内 `git/trees` 232 个 blob 中**无权重文件、无 MODEL_LICENSE**，README **没有 License 段**（grep 许可关键字返回空），代码 LICENSE 为 Apache-2.0。权重在 `iic/CosyVoice2-0.约 1 KB` / `FunAudioLLM/Fun-CosyVoice3-0.约 1 KB-2512` 等 ModelScope 快照，**其协议必须去 ModelScope 模型页确认**。本轮不引用 ModelScope，故标「未取证」。
2. **`QwenAudio/CosyVoice` 2026-05-25 后的停更是「维护低谷」还是「项目重心转移」** —— 实测：默认分支最后提交 2026-05-25（近 5 个月），但 `pushed_at` 同样是 2026-05-25，说明**连非默认分支/tag 也没有更新**，不像「换分支继续维护」的情形；README 顶部已改称「Fun-CosyVoice 3.0」并把模型下载指向 ModelScope/HF 双渠道，**推断为「代码仓冻结、模型在别处迭代」**（推断，非实证）。README 末尾还加了一节「FunAudioLLM ecosystem section with links to ASR projects」，佐证生态重心在转向。**结论：把它当「可长期依赖的代码仓」有风险，但当「模型入口」是可用的。**
3. **CosyVoice 权重的磁盘体积** —— README 只给模型名（0.约 1 KB / 300M 系列 + `CosyVoice-ttsfrd` 资源），**未给体积数字**。落地需为「ONNX + JIT + ttsfrd 前端资源 + 语言模型」预留 **3 GB 量级**磁盘（量级估算，**精确值未取证**，以 ModelScope 快照实际大小为准）。GPU：0.约 1 KB 模型 + 流式解码，官方建议显存 4~8 GB；**纯 CPU 可跑但慢 5~10 倍**。
4. **`ReaJason/xhs` 15 个月未更新后，小红书当前协议是否仍兼容** —— 该仓最后提交 2025-07-01。要确证必须**发一条真实笔记**（需真实登录态、会真实触达平台），**本轮未执行任何真实发布动作**，故无法确证。**建议在测试账号上跑一次 permit → 分片上传 → create_video_note 端到端验证再决定是否移植。**
5. **mulpub 现有 TTS 的中文实际质量** —— mulpub 已有 6 家云端 TTS 适配器（`doubao-tts.js` 242 行 / `mimo-tts.js` 303 行 / `minimax-tts.js` 603 行 / `google-tts.js` / `openai-tts.js` / `minimax-tts-voices.js`）+ `tts-voice-clone-service.js` **1783 行** + `story2video-voice-estimate.js`（78 行）/ `story2video-voice-guard.js`（180 行）/ `tts-calibration.js`（132 行）。**本轮未跑音频基准**，因此**不对「换自托管 TTS 能否提升中文质量」下任何结论**。要回答需建一个固定基准：同一批中文稿（含多音素词、儿化、数字/单位读法、方言词）× 固定 5 条句长档，输出时长偏差/中断率/首字延迟三指标，与现有云端适配器 A/B。
6. **wav2vec2 中文对齐模型的权重许可** —— `jonatasgrosman/wav2vec2-large-xlsr-53-chinese-zh-cn` 在 HF 上，**不在 GitHub，无法用 api.github.com 取证**。引入 whisperX 前须单独查。
7. **ComfyUI Wan 节点与 ComfyUI 本体的版本兼容矩阵** —— 未做实跑（需 GPU 环境）。
8. **本维度未覆盖的漏项**：① 抖音开放平台「视频发布」官方 API 的**官方文档级**接入（社区实现普遍走 RPA 或逆向，官方 API 需企业资质——本轮未取证）；② 知乎/微博的**真发布**实现除 social-auto-upload 外未找到同等完整的开源实现；③ 视频号（`shipinhao`）除 social-auto-upload 的 RPA 外，未找到**非 RPA** 的开源真发布实现（`wechat-uos-api` 已 404，见下）；④ 视频**转场/特效**的专门开源库（`moviepy` 的 `Effect.py` 体系与 Remotion `@remotion/transitions` 已是两端主流方案，未再展开）；⑤ **视频去水印**（`packages/story2video-engine/src/watermark.ts` 89 行，实为**打自己的文字水印**，不是去除第三方水印）—— 去水印方向未找到既合规又成熟的开源方案，且涉版权/ToS 风险，建议**不做**；⑥ 视频质量客观指标（VMAF/SSIM 一类）未取证。

---

## 四、本文档明确劝退的项目

| 项目 | 实测依据 | 劝退理由 |
|---|---|---|
| **`NanmiCoder/MediaCrawler`** | `GET /repos/NanmiCoder/MediaCrawler` → stars=67735, default_branch=`main`, pushed_at=2026-10-15；**`GET /repos/NanmiCoder/MediaCrawler/license` → spdx=NOASSERTION，正文首行「**NON-COMMERCIAL LEARNING LICENSE 1.1** / Copyright (c) [2024] [relakkes@gmail.com]」**；tree 355 blob，按 `publish|upload|发布|投稿` 正则匹配 **0 命中**，`media_platform/` 下只有 bilibili/douyin/kuaishou/tieba/xhs/weibo/zhihu 的 `client.py+core.py+login.py+media.py+help.py`（下载/搜索/评论），README 全文 grep「发布/publish/upload/投稿」**0 命中** | **两重劝退**：① 它是**纯采集实现**（下载、搜索、评论抓取），**没有任何发布代码**——把它当「多平台发布参考」是本维度最容易犯的错；② **许可是非商用的「NON-COMMERCIAL LEARNING LICENSE 1.1」**，mulpub 是商业产品，**法务上直接不可用**。即使只是想抄它的平台请求头/签名实现，也要绕开其许可 |
| **`2noise/ChatTTS`** | stars=39920, default_branch=`main`, pushed_at=2026-04-10（commits 最后一条 2026-04-10）→ **默认分支已 6 个月无提交**；`GET /repos/2noise/ChatTTS/license` → 正文「GNU AFFERO GENERAL PUBLIC LICENSE Version 3」；README「The code is published under **AGPLv3+**」「The model is published under **CC BY-NC 4.0** … **should not be used for any commercial or illegal purposes**」 | **双重不可用**：代码 AGPL-3.0（对 Electron 分发极不友好，AGPL 的网络分发条款会传染到被分发程序）；**权重 CC BY-NC 4.0 明确禁止商用**。中文能力虽好，**mulpub 不能用** |
| **`SWivid/F5-TTS`** | stars=15438, default_branch=`main`, pushed_at=2026-10-14（活跃）；license 正文=MIT（代码）；**README「## License」段明写：「Our code is released under MIT License. The **pre-trained models are licensed under the CC-BY-NC license** due to the training data Emilia」** | 代码可商用、**预训练权重不可商用**（NC）。mulpub 要的是「开箱即用的中文多音素音色」，必须用官方权重 ⇒ **不可用**。（自训模型路径可绕开，但成本远高于 CosyVoice） |
| **`fishaudio/fish-speech`** | stars=33365, default_branch=`main`, pushed_at=2026-10-14；license 正文「**FISH AUDIO COMMUNITY LICENSE AGREEMENT Version 1.0 — Last Updated: October 13, 2026**」；第 III(a) 条：商业使用**仅在年营收低于 USD 500,000（Revenue Threshold）时**许可；第 III(c) 条：「**no license is granted under this Agreement to offer a Hosted Service**」且 Hosted Service 定义为「以 TTS/配音/声音克隆为主要目的向第三方提供 API/SDK/托管服务」；超阈值需书面商业授权 | 三重限制：① **营收门槛 50 万美元**（mulpub 需评估自身营收是否在门槛内并保留监控义务，超阈值 30 天内须书面通知）；② **禁 Hosted Service**——若 mulpub 未来把 TTS 作为**托管能力**对客户开放，即落入禁止范围（若仅随自有产品交付生成好的音频，许可中 III(c)(1)(2) 有豁免，**这条边界必须由法务定，不是我能定的**）；③ 协议版本 2026-10-13 才更新，条款仍在动。**结论：不作为基础 TTS 依赖** |
| **`index-tts/index-tts`** | stars=24656, default_branch=`main`, pushed_at=2026-09-29（活跃）；license=**NOASSERTION**，正文「**bilibili Model Use License Agreement**」；第 2.2 条：若产品/服务 **MAU > 1 亿**或**上年度营收 > 人民币 10 亿**，须单独申请授权且「We may grant You such rights in our sole discretion」；第 2.1(c) 条：「You may **not** Use the bilibili indextts2 or any Derivative Work **to improve any AI model**, except for the bilibili indextts2 itself, its Derivative Works, or **non-commercial AI models**」 | 许可本身对中小规模商用**可接受**（门槛高），但**第 2.1(c) 条是硬约束**：不得用 indextts2 改进任何其他 AI 模型（含「用它的音色数据去训练/微调别的 TTS」）——对 mulpub 的**自研音色克隆**能力是直接限制。另它**捆绑 BigVGAN / OpenVoice / maskgct / dac** 等一票子第三方实现（tree 中 82 个 model 命中），**许可证链条比 CosyVoice 复杂得多**。**结论：条件推荐，需法务逐条对照 2.1(c) 与 4.2（Prohibited High-Risk Use）** |
| **`OHF-Voice/piper1-gpl`** | stars=5965, default_branch=`main`, pushed_at=2026-10-17（活跃）；**license 正文 = GNU GPL v3**；仓库名自带 `-gpl` | 上一代 **`rhasspy/piper` 已 archived=true**（stars=11304, MIT, 停更于 2025-08），继任者**把许可从 MIT 换成了 GPL-3.0**。GPL-3.0 的静态链接/分发义务对 Electron 应用是硬伤；**且 piper 的中文模型质量与多音素能力本就弱于中文专用方案**。**结论：不做 TTS 底座** |
| **`eugeneware/ffmpeg-static`** | stars=1407, default_branch=`master`；commits 最后一条 2025-11-14「use **6.1.1** binaries」；**license 正文 = GNU GPL v3**；npm 元数据 GPL-3.0 | ① **GPL-3.0**（与 mulpub 现有 `ffmpeg-ffprobe-static` 同为 GPL，但它的 **wrapper 许可与二进制许可是分离的**，而它把整个包标为 GPL——混用时更难逐文件举证）；② **二进制冻结在 ffmpeg 6.1.1**，2025-11 后未更，安全补丁滞后。mulpub 已有更完备的 `media-tools-lock.json`（逐平台 sha256 + 尺寸 + 二进制发布页）⇒ **无迁移理由，劝退** |
| **`WyattBlue/auto-editor`** | stars=5596, language=**Nim**, default_branch=`master`, pushed_at=2026-10-22（活跃）；license=**Unlicense**（公共领域）；tree 222 blob，`src/analyze/{audio,subtitle,motion,blackdetect}.nim`、`src/exports/{fcp7,fcp11,shotcut,kdenlive,mlt,otio,json}.nim`；**全树 `pyproject|setup.py|requirements|\.py$` 正则匹配 0 命中**（Python 版已被整体重写为 Nim） | ① **已无 pip 包**——mulpub 的 Python 侧无法 `pip install`，只能下预编译二进制（又回到 sidecar 治理）；② 它是**命令行应用**不是库，集成方式只能是子进程；③ 它的 `src/analyze/subtitle.nim` 与 `src/exports/*.nim` 确有价值（导出 FCP7/Shotcut/OTIO 多种剪辑格式），但 mulpub 是 Remotion 渲染，不消费这些格式。**结论：仅作算法参考（静音阈值/多标签 `--edit:N` 机制），不引入** |
| **`jianfch/stable-ts`** | stars=2281, default_branch=`main`, pushed_at=**2026-05-30**；**`archived: true`**；license=MIT | **仓库已归档**（GitHub 明确标记）——不再接收修复与安全更新。**结论：不用**，用 whisperX 替代 |
| **`RayVentura/ShortGPT`** | stars=8061, default_branch=`stable`（**不是 main**）, pushed_at=2025-02-10T19:33:18Z → **默认分支已 20 个月无提交**；license=MIT | 停更 20 个月 + 依赖 OpenAI/GPT-4 旧版 API + 整体是「实验性框架」（README 自称 Experimental）。**结论：仅供对照，不推荐** |
| **`ffmpegwasm/ffmpeg.wasm`** | stars=17898, default_branch=`main`, pushed_at=2026-09-29，commits 最后一条 2025-09-17；license=MIT | 场景不匹配：mulpub 是 Electron 桌面端、已有原生 ffmpeg sidecar，无需浏览器内 WASM 转码；WASM 版 ffmpeg 特性缺失（如部分滤镜与硬件加速）、体积与内存开销更大。**结论：不推荐** |
| **`comfyanonymous/ComfyUI-to-Python`** | `GET /repos/comfyanonymous/ComfyUI-to-Python` → **404** | 仓库已改名/迁移，**正确入口是 `pydn/ComfyUI-to-Python-Extension`**（MIT, 2392 stars）。同时 `comfyanonymous/ComfyUI` 也已迁至 `Comfy-Org/ComfyUI`。**记录这两个改名，避免后续按旧路径引用踩空** |

---

## 五、四类处置建议归总（对应任务要求的四种结论形态）

| 形态 | 归入的候选 |
|---|---|
| ① **可直接替换的小而专的库** | `jwagner/smartcrop.js`（内容感知裁切，补 `cover-cropper.js` 的 `position:'centre'` 与 `Story2VideoSlideshow.tsx` 的中心裁切）；`hexgrad/kokoro`（TTS 底座候选，许可最干净）；`smartcrop/smartcrop.py`（Python 桥备选） |
| ② **值得借鉴实现范式的参考实现** | `m-bain/whisperX`（wav2vec2 强制对齐 + Silero VAD，替代「Whisper 词级时间戳」）；`Huanshere/VideoLingo`（语义切分 + 相似度回锚 + 多 TTS provider 抽象）；`Breakthrough/PySceneDetect`（切点表 → 封面选帧/素材裁剪/分段焦点）；`ReaJason/xhs`（小红书 permit→分片上传→发帖三段）；`biliup/biliup`（B 站多上传通道 + 投稿后状态校验）；`dreammis/social-auto-upload`（RPA 平台行为清单与验证弹窗处理） |
| ③ **可对照评估的同类项目** | `harry0703/MoneyPrinterTurbo`（素材库分层、画幅适配、provider 抽象；发布是 SaaS 外包故不可借鉴）；`Zulko/moviepy`（模板化短视频的另一条渲染路线与成本结构）；`pydn/ComfyUI-to-Python-Extension` / `kijai/ComfyUI-WanVideoWrapper`（AI 视频生成的封装范式） |
| ④ **存在明确无法自建的缺口** | **合规缺口（非开源可解）**：`remotion` 的双层许可（`GET /repos/remotion-dev/remotion` → license=NOASSERTION；`LICENSE.md` 正文：「**a for-profit organization with up to 3 employees**」可用免费许可，**超出须购买 Company License**）——mulpub 当前 `remotion@4.0.484` 已用于商业成片，而 `apps/desktop/THIRD-PARTY-NOTICES.md`（39 行）**全文无 Remotion 条款**（grep `remotion` 零命中）⇒ **这是本轨道发现的最紧急的合规缺口**，须立即补入声明并核对公司规模是否已超免费门槛。**其次是 TTS/视频模型的权重许可台账**（目前无任何模型权重，故台账为空，一旦引入 CosyVoice/kokoro 必须新建）。**技术缺口**：Whisper 自身的中文词级时间戳精度（需 whisperX 补，非开源可绕）；小红书/抖音/视频号的**非 RPA** 官方发布通道（社区实现要么 RPA 要么逆向，官方 API 需企业资质） |

> **核对提醒**：本轮所有 mulpub 侧结论均读自 `GET /repositories/1261397559`（数字 id 路径；`GET /repos/Colinchui007/mulpub` 返回 **404**，名称解析失效）。若后续复核，务必用数字 id，不要用 owner/repo 路径。

---

## 交付元信息（Delivery Protocol）

**Summary**：完成「视频 / 音频生产链与多平台发布」维度的开源参考调研，全部结论基于 api.github.com 实测（30+ 仓库的元信息、默认分支提交、license 正文、目录树与关键文件行数），并直接读取 mulpub 公开仓（`GET /repositories/1261397559`）逐文件核实现状。产出 12 个候选详情 + 20 项补充候选速览 + 12 项明确劝退 + 8 项未取证，重点纠正了三处易错判断：MediaCrawler 是**纯采集且非商用许可**、MoneyPrinterTurbo 的发布**外包给 SaaS 而非自研**、mulpub **已有 6 家云端 TTS 与 1783 行音色克隆服务**（原「无 TTS」判断错误）；并发现最紧急的合规缺口——`remotion` 的双层许可未进 `THIRD-PARTY-NOTICES.md`。

**Changed files**
- `01-docs/research/mulpub-credit-cost-2026-10-25/tracks/track-media.md`（本文件，新建并分批落盘）
- 进度看板（沙箱内产物，未入库）（追加 track-media 进度条目）
- 取证工作区（沙箱内，未入库） 下的取证脚本与原始响应（`meta.sh` / `ev.sh` / `tree.sh` / `file.sh` / `mul.sh` / `raw/`，工作区中间产物，非交付物）

**Notes**
1. **取证实操**：所有数字来自 `api.github.com`；未引用任何镜像站或 AI 生成营销站；code search 仅用于**仓库名检索**（`GET /search/repositories`），判定能力一律用 `git/trees` + `contents` 目录树与行数，未用 `search/code`。
2. **404/改名记录**：`FunAudioLLM/CosyVoice` → `QwenAudio/CosyVoice`（301，数字 id 823430322）；`comfyanonymous/ComfyUI` → `Comfy-Org/ComfyUI`（301，数字 id 589831718）；`comfyanonymous/ComfyUI-to-Python` → **404**，正确入口 `pydn/ComfyUI-to-Python-Extension`；`wechat-uos/wechat-uos-api` → **404**（视频号非 RPA 发布实现未能取证）；`ffbinaries/ffbinaries` → **404**（实际为 `ffbinaries/ffbinaries-node`）；`polysecurity/license-checker` → **404**；`microsoft/oss-review-toolkit` → **404**（实际为 `oss-review-toolkit/ort`）。
3. **对标项目访问方式**：mulpub 的 `GET /repos/Colinchui007/mulpub` 与 `GET /repos/Colinchui007/mulpub` **均 404**，只有 `GET /repositories/1261397559` 可用（数字 id 取自 `GET /user/repos`）。复核时勿用 owner/repo 路径。
4. **未执行的破坏性动作**：本轮**未发起任何真实平台发布动作**（未发抖音/小红书/B站/视频号内容），因此 `ReaJason/xhs` 与 social-auto-upload 的**当前协议有效性未实证**；未安装任何模型权重，故 TTS 中文质量无实测基准。
5. **本轮复核的「停更」判定**（全部按 `commits?sha={default_branch}` 而非 `pushed_at`）：stable-ts **archived=true**；rhasspy/piper **archived=true**；kokoro 2025-08-06；imagededup 2025-08-15；smartcrop.js 2024-03-16；ReaJason/xhs 2025-07-01；wechatpy 2026-03-07；QwenAudio/CosyVoice 2026-05-25；ShortGPT 2025-02-10；descriptinc/ffmpeg-ffprobe-static 2021-12-14（仓内）；ComfyUI-WanVideoWrapper 2026-05-24；ffmpeg.wasm 2025-09-17。
