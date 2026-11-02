# dsh-purge 1.1.75 完整合并方案（原 1.2.0；1.1.77 起适配 0.2.1-rc.5）

基线：`master` @ b102dbe（1.1.74，86 条补丁，lib/ 34 个 js）
状态：**A–F 六批已全部落地**，在分支 `feat/community-merge` 上，补丁表 87 条。本文档保留原始方案，并就地标注落地时的实测修正。

---

## 0. 三个前提结论（已查实）

**① 你说的「.31」= kingcharleslzy-ai 分支的 1.6.31，不是 DSH 版本。**
扫了 59 个 dsh-purge 系仓库的 package.json，无任何版本号含 `.31`。DSH 官方 nightly 当时最新是 `0.2.1-rc.2`（2026-10-17）。（**已过时**：2026-10-29 nightly.yml 已返回 `0.2.1-rc.5`，见 release-notes 1.1.77。）1.6.31 是该 fork `AGENTS.md` 第 24 节「默认预设诊断（1.6.31 / #38）」，它现在已到 **1.6.43**。

**② 不能整包替换。** 本地 1.1.74 比上游镜像（mmparko 1.1.71）新，且已有 10 条 fork 没有的补丁（#18/#19/#85–#92）。整包换会丢这些。

**③ 三个来源，其余只做参考：**

| 来源 | 版本 | lib/ 净增 | 拿什么 |
|---|---|---|---|
| kingcharleslzy-ai/dsh-purge | 1.6.43 | +8232 / −4315 | 更新通道拆分、补丁表新条目、tail 注入、审计/调优模块 |
| JeffKeeping/dsh-purge-plus | 1.4.2 | +2399 / −3396 | **设置页 UI**、审批门 + 审计流水、revision 防并发 |
| wenjianxiong/dsh-purge-wjx | 1.1.77 | +5517 / −6298 | `/auth` 授权持久化（可选） |

排除：dongliuwuzhong-arch（删掉整个 lib/redteam/ 19000 行）、wenjianxiong 的 core 六模块拆分、所有把包名改成 `dsh-purge-community` 的改动。

---

## 1. 批次总览

| 批次 | 内容 | 改动面 | 风险 | 依赖 |
|---|---|---|---|---|
| **A** | 设置页 UI（你点名的） | client.js 单文件 +约 380 行 | 低 | — |
| **B** | 审批门 + 审计流水 | 2 新模块 + hooks-deny + index.js 7 处 | 中低 | A |
| **C** | 零风险修复 | 5 个现有模块 + 8 个新模块 | 极低 | — |
| **D** | 更新通道 | update.js 传输层 + update-policy | 中 | — |
| **E** | 补丁表 | core.js 引擎 + 1 条新补丁 | 中 | — |
| **F** | 注入位置（tail） | index.js + identity.js + core.js #40 | 中高 | E |

建议顺序：**A → C → B → D → E → F**（A 独立可验收，C 顺手做掉，F 单独一轮）

---

## 2. 批次 A — 设置页 UI

新增一个真正挂在宿主设置里的页面。**浮窗照旧保留。**

### 改动清单（client.js 唯一改动文件）

| 位置 | 改动 |
|---|---|
| :8756 `apply(ctx)` | 加 `purgeHost = ctx`；`ctx.slots.inject("settings.section", ...)` 注册 id `dsh-purge`、order 450、`label: () => t("page.nav")` |
| 新增 `SettingsPage` | `div.dshp-root.dshp-page`，四段页签（破甲 / 规则 / 技能 / 演练台），复用现有 PurgifySection / RulesSection / SkillsSection，演练台用新 DrillSection 包 `__dshPurgeDrill.Panel` |
| 新增 `PAGE_SEGMENTS` | `[{armor},{rules},{skills},{drill}]` |
| 新增 `installSettingsNavIcon` | 宿主 `settings.section` 契约**没有 icon 字段**，只能用 mask-image 给导航行补「开口锁」图标；MutationObserver + rAF 去抖，按 label 精确匹配 `[role="dialog"] nav button` |
| 新增 `openSettingsSection` | 先找已渲染的导航行直接点；找不到走 `ctx.get("shortcuts").invoke("settings.open", { modal: null })`（**必须显式传 modal:null**，否则被 resolve 判 blocked），再退到点 `button[aria-haspopup="dialog"]`；50ms × 12 重试 |
| :8518 PurgeDock 头 | 「全面浏览」与「收起」之间插「设置页」按钮 → `openSettingsSection()` |
| `PURGE_CSS` | 整段换 Jeff 版。**本地 100 个类 Jeff 全都有（0 缺失）**，Jeff 多 12 类：`dshp-page` / `dshp-page-head` / `dshp-page-lead` / `dshp-page-text` / `dshp-segbar` / `dshp-seg` / `dshp-gate` / `dshp-audit` / `dshp-panel-lead` / `dshp-rulename` / `dshp-caret` / `dshp-skel-rows` |
| `REWIND_CSS` | **原样保留**。回退按钮还在用（Jeff 1.4.2 把回退整个删了，我们不跟） |
| 词典 | +26 键（`page.*` / `page.seg.*` / `drill.*` / `dock.openSettings` / `purge.lead` / `override.lead`）；Jeff 的 `purge.lead` 写「82 个锚点」，本地要改成 **86** |

### 保留不删（Jeff 删了但我们不跟）

- 浮窗 `SettingsRoot`（dock 的「清洗」页签 :8501 仍在用它，是 fallback）
- `PurgeLauncher`（:8577）/ `HeroNewSessionMount`（:8607）/ `TabRowPurgeMount`（:8670）/ `RewindButton`
- `ContinueSafe`（注释状态照旧）

### 为什么低风险

- `settings.section` 本机已有 6 个官方包在用（general / models / plugins / account / agent-presets / runner），契约稳定
- `shortcuts` 服务存在，`invoke` 签名已核对
- `PurgifySection()` 无参数，传 `{embedded:true,t}` 不影响
- 纯新增注册，不触碰任何现有注册

---

## 3. 批次 B — 审批门 + 审计流水

设置页的「审批与审计」段要真正工作，必须连带这些。

### 新增两个零依赖模块

- `lib/revision.js`（69 行，**零 import**）：进程内 rev 计数，`checkRev(expected)` 防两个窗口同时点「应用」。不落盘，重启归零是正确语义。
- `lib/tool-gate.js`（194 行，**零 import**）：挂 `tools/pre-execute` + `tools/post-execute`，管 `purge_apply/purge_revert/purge_uninstall` 三个工具。**默认 audit 档 = 只记流水、全部放行**，行为与现在完全一致；只有手动切 enforce 才要求 `allowed-once`。

### 必须同时修的真 bug

`lib/hooks-deny.js` 的 `saveHookDenySettings` 现在**重建整个 JSON**。一旦 `hooks-deny.json` 里还有 `approvalMode`，切一下 hooks 旁路就把审批档抹掉。改成 `{ ...existing, hooksDenyBypass }` 合并写。另加 `loadPurgeSetting` / `savePurgeSetting` 两个通用读写。

### index.js 接线（7 处）

1. `DEFAULTS` 加 `approvalMode: "audit"`（:45–63 块）
2. apply 内读磁盘持久化覆盖 DEFAULTS（:1504 附近）
3. 工具块加第 4 个工具 `purge_audit`（:1672 前）；purge_apply / purge_revert 末尾 `bumpRev`
4. 工具块之后、`installWebServer` 之前（:1673）挂 `installToolGate`，`ctx.effect` 挂 disposer
5. status 路由加 `rev` / `last_action` / `approval_mode` 三键（:1756 起的 sendJson）
6. 新增两条路由：`/dsh-purge/approval-mode`（GET 读 / POST 存）、`/dsh-purge/audit?limit=`（GET 读尾部，默认 40，上限 200）
7. apply / revert 路由加 `checkRev(body?.rev)`，失败回 409 `{ok:false, stale:true, rev, last}`

另需两个小工具函数：`auditFilePath(dshHome)`、`readAuditTail(dshHome, limit)`（statSync + 单次最多读 4MiB 尾部 + 倒序取最后 N 条）。

### 风险

中低。默认 audit 档**零行为变化**；enforce 档只有你自己切了才生效，且失败方向统一是拒绝（缺 agent / 缺 approval 服务 / 抛错 / signal abort → 不派发）。

---

## 4. 批次 C — 零风险修复

### 现有模块（5 个）

- `lib/extract-asar.js`：① `process.noDeprecation = true` 包 try/catch（`--no-deprecation` 生效时它是只读属性，ESM 严格模式赋值直接 `TypeError`，Node 22 即可复现）；② 补 `hostFs.closeSync`（缺它会让 Windows 原子改名 EPERM，备份占位符泄漏）
- `lib/zip-extract.js`：重复路径检测、目录条目处理、`zlib.inflateRawSync` 加 `maxOutputLength`（解压炸弹上限 200MB）
- `lib/web.js`：`restartArgv` 认 `--profile`（否则重启会把 profile 参数吃掉，落到默认 profile）
- `lib/net-scope.js`：补 `ownServerNote()` 占位导出
- `lib/reapply.js` 三条：① `sameRev` 只对 git sha 允许短前缀（`apply:<version>` 必须整串相等）；② `hostCleanEnoughToKeep` 把 `unmatched` 也算脏（strictFiles 锚点失配同样表示没打上）；③ `ensureInstalledRevSeed` 不再单方面把 `apply:<旧版本>` 抬成当前版本

### 新增 8 个零依赖模块

`audit.js`（145 行）/ `tuning.js`（61，依赖 core+audit）/ `boost.js`（61，依赖 core+tuning）/ `preset-injection.js`（76，零 import）/ `anchors.js`（85）/ `stream-observation.js`（25，零 import）/ `command-registration.js`（21，零 import）/ `refusal-retry.js`（118）

**注意**：`tuning.js` / `boost.js` 会 `import { findDshHome } from "./core.js"`，本地 core.js 已有该导出，可直接接。

### 风险

极低。都是防御性修复，不改任何现有行为路径。

---

## 5. 批次 D — 更新通道

### D1 只换传输层

`lib/update.js` 里的 `requestBuffer` 换成 fork 的 `update-http.js` 那套：

- 7 域名白名单（github.com / codeload / api.github.com / raw.githubusercontent / objects.githubusercontent / release-assets.githubusercontent / cdn.jsdelivr.net）
- 环境代理 `PURGE_HTTPS_PROXY > https_proxy > HTTPS_PROXY > http_proxy > HTTP_PROXY`，加 Windows 静态系统代理（读注册表，不执行 PAC）
- 12s 超时 / 50MB 上限 / 重定向 5 次
- GitHub token 只发给 GitHub API 域名

**其余 22 个导出签名全部保持不变**，CLI 和面板不用改。

### D2 状态对齐（按实测改成了另一种做法）

原计划搬 fork 的 `update-policy.js`（231 行），**实测不适用**：本地 `update.js` 根本没有 `pendingVersion` / `restartRequired` / 「等待重启」这套状态，fork 要修的永久卡死在本地不存在同构缺陷。硬搬会凭空引入一套新状态机。

改成在 `lib/update.js` 内部补三个小导出：

- `readPackageVersion(dir)` + 模块级 `LOADED_VERSION`：进程启动时加载的那份代码的版本固定一次
- `installedVersion()`：磁盘上安装的版本
- `pendingRestart()` → `{ loaded, installed, pending }`

`checkUpdate` / `_applyUpdateImpl` 的版本比对改用 `installedVersion()`（更新把新文件写盘后进程里跑的仍是旧代码，用加载版本比会一直显示「有新版本」，用户就会反复点应用），响应里新增 `loadedVersion` / `installedVersion` / `restartRequired` 三键，`needRestart` 从硬编码 `false` 改成 `restart.pending`。面板的 `update.pendingRestart` 词典项（client.js:253 / :625）与 :2081/:2162 的渲染本来就在，这次终于有数据可喂。

导出从 22 个变 24 个（新增 `installedVersion` / `pendingRestart`），原有签名不变。

### 风险

中。D1 只影响网络路径（直连失败的机器会开始走系统代理，这是修复）；D2 会改变更新状态显示。

---

## 6. 批次 E — 补丁表

- 补丁引擎加 `chainedAfter`（fork 4 处用到，本地 0 处）—— 让「前一条没落地时不报漂移」的级联成为可能
- 只采纳 fork 的 `ASK_USER_WAIT_CAPPED`（尊重模型给的 timeout，`-1` 收成 300s），**重编号为 #93**

> 为什么必须重编号：本地 #87 = PREPARE_ASSEMBLE_USE_RETURNED、#88 = HUNG_PROMPT_REMOVED、#89 = SYSTEM_FIELD_EXTRACT；fork 的 #87/#88/#89 = HUNG_PROMPT_LF_NEEDLE / HUNG_PROMPT_STRICT_NEEDLE / ASK_USER_WAIT_CAPPED。语义完全不同，直接搬会让 `PATCH_DISPLAY_GROUPS` 和迁移链打架。

- 搬 `anchor-overrides.json` 覆盖机制（锚点漂移时不用改代码，写 JSON 就能改 pattern）
- `capability-protocol.js` 加 `REDTEAM_CHILD_PROTOCOL`（子代理专用的 4 步能力选择说明，属产品语义变化）

### 风险

中。#93 会改变反问等待时长（现在本地宿主上本来就没有「硬写 1 秒」的补丁，所以实际是新增一条防护，不是修 bug）。

---

## 7. 批次 F — 注入位置（最后做）

### 问题

现在 `GLOBAL_PROMPT_ORDER = -100000`。所谓「尾部注入」实际排在 persona 之前，长上下文里**最先被裁**。

### 修复

- `TAIL_PROMPT_ORDER = 10150`（WEB_SURFACE 10100 之后、persona-suffix 10200 之前）
- `BOOST_PROMPT_ORDER = 9500`（可用 `PURGE_BOOST_ORDER` 覆盖）
- `tuning.injectPosition` 支持 `head` / `tail` / `both`，纯 tail 时额外注册一个空文本占位段

### 冲突点（结论已修正）

~~本地 #40 靠「注入排最前」保证不被 complete 预设吃掉，要支持 tail 必须同时给 #40 加开关或改判据。~~

**实测结论：#40 不用动。** 宿主 `dsh-system-prompt` 里 `renderPrompt(assembly)`（`:117`）只是按 `assembly.sections` 数组顺序 `map` 后 `join`，waterfall 之后**不再按 order 重排**；而 `rewritePromptAssembly` 跑在 `system-prompt/assemble` waterfall 上、也就是 #40 之后。所以 `ensureTailInject` 把 `dshpg-tail` 追加到数组末尾，就是最终渲染顺序的末尾。`comparePromptSections`（`:101`）只作用于 assemble 组装阶段。

### 实际搬的 helper

只搬 `escapeDshInterpolation`（`{{name}}` 白名单外的插值转义）。**没搬** `peelChatmlEnvelope` / `adaptInjectForMinimalPreset`：活宿主 `prompt-inject.md`（215 行）实测 `{{` 命中 0 次、`STRICT REQUIREMENT` / `apply_patch` / `multi_tool_use` 命中 0 次、也没有闭合 `</project_instructions>`；fork 的 `normalizeChatmlLayout` 会自动补闭合标签，照搬会改变现有渲染。

### 落地细节

- `lib/identity.js`：新增 `TAIL_PROMPT_SECTION = "dshpg-tail"`（段名故意不带 `dsh-purge` 前缀，否则宿主 #40 的 `startsWith("dsh-purge")` 过滤会把它提回最前）、`escapeDshInterpolation`、`normalizeInjectPosition`、`ensureTailInject`；`rewritePromptAssembly` 按 `opts.injectPosition` 走 head/tail/both，遍历时跳过 `dshpg-tail`。
- `lib/index.js`：`TAIL_PROMPT_ORDER = 10150`、`BOOST_PROMPT_ORDER = 9500`（`PURGE_BOOST_ORDER` 可覆盖）；`registerPromptSections` 按 `readTuning().injectPosition` 注册，纯 tail 时额外注册一个空文本 `dsh-purge` 占位（#40 与若干补丁按段名找它）；`rewriteLiveAssembly` 透传 `injectPosition` / `tailOrder`。
- `bin/dsh-purge.js`：`--inject head|tail|both` 与 `--boost on|off` 两个开关，`--status` 多打「注入位置」「强化段」两行。

### 风险

中。默认仍是 head，与现状完全一致；只有显式 `--inject tail` 才换位置，且 tail 段在 rewrite 阶段生成，不依赖宿主 order 排序。

---

## 8. 明确不采纳

| 项 | 原因 |
|---|---|
| 包名 / 仓库名 / 命令名改成 `dsh-purge-community` / `YuJunZhiXue` / `purge-community` | 会指向停更的上游 |
| 删 `hide-console.js` 的 Electron / 打包桌面 skip | 会让 Windows 桌面重启直接打不开 |
| `continue-retry.js` 默认开启 | 行为反转 |
| `steering.js` 的 #90（把 #85/#86 反向还原） | 与本地已落地的插话补丁冲突 |
| 删 `redteam/tools.js` 的 asar 兜底 | 桌面版依赖它找宿主 |
| 拆 core.js 成模块 / 拆 update 成 8 文件 / 搬 market / packages / 58 个测试 | 与本机结构不符 |
| Jeff 1.4.2 删会话内 4 入口 | 你在用 |
| fork 的 `lib/redteam/ui.js` 仓库名兜底改 YuJunZhiXue | 本地保持 dawanglaohu |

---

## 9. 验收方式（每批做完必跑）

```
node bin/dsh-purge.js --status
```

必须满足：
- 补丁计数仍是 **86/86**（批次 E 后变 87）
- 没有新增 failed / failed_items
- 重启宿主后：浮窗能开、设置页能进、回退按钮还在、演练台能授权

批次 A 额外验收：设置页四段页签都能切、导航图标出现、深色/浅色主题都正常。
批次 B 额外验收：切一次 hooks 旁路后重读 `hooks-deny.json`，`approvalMode` 仍在。

---

## 10. 动手前先清场

工作区有 5 个调查期落盘的未跟踪垃圾，合并前删掉：

`lib_core.js` / `lib_desktop.js` / `lib_identity.js` / `lib_index.js` / `lib_update.js`

---

## 11. 需要拍板

见对话中的确认清单。
