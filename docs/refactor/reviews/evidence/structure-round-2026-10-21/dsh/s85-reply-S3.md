# S85 S3（D3a）回复 — 提交 `6b8c80f`

## 0. 问题、偏差与开始前的疑问

1. **运行书的 scratch 路径在本会话不可写。** `$S85_SCRATCH=/home/han001/dsh-work/s85-scratch/S3` 在 workspace-write 沙箱外，创建即被拒（没有 approval 通道）。全部探针、副本与报告改用仓库外的 `/tmp/s85-scratch/S3`；仓库内没有留下任何探针文件。书 §5.0 的“仓库外”要求满足，只是根目录不同。
2. 没有其它看不懂而阻塞的点；没有跳过任何 S3 步骤。
3. 书要求“pack owner 先发布完整 key 表”，实际顺序是各 consumer 先按命名空间自定义 key（没有互相冲突），owner 原样合并；最终 key 表由 `resources/prompts/platform/strings.json` 与生成模块冻结，下面第 4 节列出。若 S4 要改这些名字，必须只改文本不改 key。
4. 运行书说 S3 约 2,150–2,950 行；本提交是 **2,971**（多 21 行），主要来自 596 行的生成模块与 40 个资源文件。见第 8 节。

## 1. 摘要（不到 300 字）

D3a 完成：建立了提示词包的冻结格式、三构造渲染器、十张槽位表、平台包 v1（7 个 S3 模板、344 条字符串、31 个工具文件）和构建期生成脚本；31 个工具说明与参数说明、简报/K3、初始化 guide、咨询、用户答复、书记提醒、角色短句、架构提醒、注记标题和 context-extensions 三条文字都改为从包读取，旧常量与旧导出全部留在原路径。字节证明：渲染器 1,968 次调用重放 0 差异，308 个边界输入 0 差异；工具在两个捕获点各 0 差异且 31 个工具齐全；guide 8,347 字节一致。typecheck、架构检查、build 全绿；书列的 165 个测试文件加 `tests/architecture` 共 169 个文件，1,611 项通过、33 项失败全部是缺 bwrap 的环境失败（31 项在原始 base 副本同样失败，2 项报 `ENOENT /usr/bin/bwrap`），2 项跳过。改动 2,540 加 / 431 删，净 2,109。

## 2. 逐步骤表

| 步骤 | 状态 | 说明 |
|---|---|---|
| 包格式、类型、renderer、十张槽位表 | 完成 | `prompt-pack.ts`、`render-template.ts`、`slot-tables.ts` |
| 构建脚本、静态生成模块 | 完成 | `scripts/build-platform-prompts.mjs`；`platform-pack.generated.ts` 仅由脚本生成 |
| runtime-assets、包闭包检查、build 前检查 | 完成 | 40 个包文件各一条原始字节 SHA-256；`inspectSourceTree` 只加闭包检查；CLI 加“生成物等于现在生成”的检查；`build` 前加 `--check` |
| 行 5、9、22、23、27、29、45、46 的文字 | 完成 | role-profiles、query-preparation（仅 guide）、consultation、execution-inputs、architecture-reminders、note.ts、host.ts（仅书记）、context-extensions（仅三条） |
| 行 10–21（简报与 K3） | 完成 | `continuation-brief`、`unknown-call-review`、`unknown-call-proposal` 三个模板 + 294 条字符串；预算、裁剪、排序、循环仍在代码 |
| 行 30–44（31 个工具） | 完成 | 16 + 15 两个 subagent；共享白板 pin 说明进 `strings.json` |
| 旧导出、旧常量、旧路径 | 完成 | 所有旧名字/签名/返回形状保留；`INITIAL_COORDINATION_RESPONSE_GUIDE` 等仍从原模块导出 |
| 字节证明 | 完成 | 见第 5 节；最终提交的 result copy 上重跑 |
| 检查与测试 | 完成 | 见第 6 节 |
| S4 范围：三个主输入模板、context-assembler、note-read-model | 未做（按书不属 S3） | 十张槽位表已含三个主输入模板；它们的资源文件与 S4 的文字留给第二晚 |

## 3. 新模块接口表（S4 按此编码）

| 路径 | 导出 | 签名 / 形状 | 来源 | 使用者 |
|---|---|---|---|---|
| `src/contracts/prompts/prompt-pack.ts` | `PromptPackManifestV1` | `{ schemaVersion: 1; packId: string; extends: string | null; templates: Record<string,{file;version;mentionsTools:string[]}>; strings: string; tools: Record<string,string> }` | 冻结规格 §2 | renderer、生成模块、S4 |
| 同上 | `ToolTextV1` | `{ description: string; parameters: Readonly<Record<string,string>> }` | 书 §5.1 裁定 3 | 生成模块、工具文件消费者 |
| 同上 | `ResolvedPromptPackV1` | `{ manifest; templates: Readonly<Record<string,string>>; strings: Readonly<Record<string,string>>; tools: Readonly<Record<string,ToolTextV1>> }` | 同上 | renderer、S4 |
| 同上 | `TemplateSlotTableV1` | `Readonly<Record<string,{required:boolean}>>` | 同上 | `slot-tables.ts` |
| `src/contracts/prompts/slot-tables.ts` | `TEMPLATE_SLOTS` | `Readonly<Record<string,TemplateSlotTableV1>>`，十张表，见第 4 节 | inventory §2 | renderer、S4（三个主输入模板） |
| `src/contracts/prompts/render-template.ts` | `SlotRangeV1` | `{ startByte: number; endByte: number }`（UTF-8，end 不含） | 书 §5.1 裁定 3 | S4 的 section 元数据 |
| 同上 | `renderTemplate` | `(resolved: ResolvedPromptPackV1, templateId: string, slots: Readonly<Record<string,string|undefined>>, finalToolNames: readonly string[]) => { text: string; sectionRanges: Readonly<Record<string,SlotRangeV1>> }` | 规格 P1 + 书裁定 3 | 简报、K3、咨询、用户答复、书记；S4 |
| `src/contracts/prompts/platform-pack.generated.ts` | `PLATFORM_PROMPT_PACK_V1` | `{ manifest; templates; strings; tools } as const satisfies ResolvedPromptPackV1`（字面类型保留） | 构建脚本从 `resources/prompts/platform/` 生成 | 所有文字消费者、S4 |
| `scripts/build-platform-prompts.mjs` | `PROJECT_ROOT`、`PLATFORM_PACK_DIRECTORY`、`PLATFORM_PACK_GENERATED_PATH`、`readPlatformPack(projectDir)`、`renderPlatformPackModule(pack)`；CLI `--check` | 路径从 `import.meta.url` 解析；默认写生成物，`--check` 只比较 | 书 §5.1 裁定 1–2 | `check-boundaries.mjs` CLI、`npm run build` |

渲染器行为（冻结）：只认 `{{slot}}`、`{{#slot}}…{{/slot}}`、`{{#tool:name}}…{{/tool:name}}`；未知模板/未声明槽位/同槽位两次/必填空值抛普通 `Error`；可选空值不渲染并丢掉块；整行块标记连同自己的缩进与换行去掉；槽位值不解析；`sectionRanges` 每个非空渲染槽位一条，块槽位取内部文本的 UTF-8 区间。

## 4. key 表

### 4.1 模板（7 个 S3 文件 + 3 个 S4 表）

| 模板 id | 必填槽位 | 可选槽位 | 文件 | 版本 | mentionsTools |
|---|---|---|---|---|---|
| `initial-planning-answer` | — | — | `templates/initial-planning-answer.txt` | 1 | [] |
| `continuation-brief` | `marker` | `body`、`bodyOmission`、`anomalies`、`review`、`blocked`、`blockedOmission` | `templates/continuation-brief.txt` | 1 | [] |
| `unknown-call-review` | `workspaceLines`、`writtenLines` | `items` | `templates/unknown-call-review.txt` | 1 | [] |
| `unknown-call-proposal` | `workspaceLines`、`writtenLines` | `targets`、`personNote`、`annotations`、`platformTargets` | `templates/unknown-call-proposal.txt` | 1 | `propose_safer_method` |
| `consultation-received-input` | `messageId`、`sourceJson` | — | `templates/consultation-received-input.txt` | 1 | [] |
| `user-decision-response` | `bodyJson` | — | `templates/user-decision-response.txt` | 1 | [] |
| `scribe-reminder` | `marker`、`pendingCount`、`updateDueCount` | `anchors`（裸槽位；`锚点：` 无条件保留） | `templates/scribe-reminder.txt` | 1 | [] |
| `work-input`（S4） | `role` | `prelude`、`goal`、`task`、`footprint`、`notes`、`reminders`、`inputs`、`continuation`、`unknown_call_review` | 待 S4 | 1 | — |
| `query-planning-input`（S4） | `role` | `prelude`、`goal`、`task`、`footprint` | 待 S4 | 1 | — |
| `query-copy-input`（S4） | `role` | `prelude`、`goal`、`task` | 待 S4 | 1 | — |

十张槽位表都已写进 `slot-tables.ts`；S4 只允许改 `work-input`/`query-planning-input`/`query-copy-input` 三张。

### 4.2 字符串（344 条，精确表在 `resources/prompts/platform/strings.json`，逐条 base 位置在 `/tmp/s85-scratch/S3/handoff/*/MANIFEST.json`）

| 命名空间 | 条数 | 内容 |
|---|---:|---|
| `brief.*` | 261 | 简报标题/标签/提示/省略/截断/接续/结束/被拦命令等 |
| `k3.*` | 33 | K3 review/proposal 的固定句、标签、两问、附言等 |
| `role.*` | 10 | 五个职责的 label/purpose |
| `architecture.*` | 13 | 四类提醒、四个时间阈值、不确定后缀、观测后缀、无观测、省略前后缀 |
| `note.kind.*` | 8 | 八种注记类型名 |
| `note.anchor.*` | 8 | 锚点前缀、symbol/deleted 后缀、项目名 |
| `contextExtension.*` | 8 | 待决定/未接入/中断锚点三条（含 `；source=`） |
| `scribe.marker` | 1 | 书记提醒 marker（提醒与恢复检查共用） |
| `toolSchema.whiteboardPin.*` | 2 | 共享白板 pin schema 的两条说明 |

### 4.3 工具（31 个；资源键 `tools/<name>.json`；参数说明路径见括号）

| 工具 | base 说明位置 | 参数说明 |
|---|---|---|
| `query_task_graph` | whiteboard-tools.ts:434 | {} |
| `query_ready_tasks` | whiteboard-tools.ts:435 | {} |
| `propose_future_plan` | whiteboard-tools.ts:436 | `basedOn` :220, `draft` :221, `reason` :229, `expected` :231 |
| `apply_future_plan` | whiteboard-tools.ts:437 | `proposalRef` :237, `expectedProposalRevision` :239, `expected` :241, `acknowledgementRef` :243 |
| `record_note` | note-tool.ts:187 | {} |
| `project_source` | project-source-tool.ts:237 | {} |
| `read_source` | exploration-tools.ts:167 | {} |
| `cpp_index` | exploration-tools.ts:174 | {} |
| `python_index` | exploration-tools.ts:175 | {} |
| `code_index` | exploration-tools.ts:177 | {} |
| `source_excerpt` | exploration-tools.ts:178 | {} |
| `list_files` | exploration-tools.ts:179 | `prefix` :179 |
| `search` | exploration-tools.ts:186 | `prefix` :186 |
| `symbols` | exploration-tools.ts:209 | {} |
| `run_readonly_command` | readonly-command-tool.ts:354 | `command` :59, `cwd` :60, `timeoutMs` :61–62 |
| `request_command_rerun` | command-rerun-tools.ts:206 | `command`/`reason`/`rewriteOf`/`rewriteOf.review`/`rewriteOf.alias` :203–209 |
| `send_session_message` | communication-tools.ts:391 | {} |
| `read_session_inbox` | :391 | {} |
| `read_session_message` | :391 | {} |
| `read_session_message_body` | :391 | {} |
| `ack_session_message` | :391 | {} |
| `respond_session_message` | :391 | {} |
| `send_user_message` | :486 | {} |
| `read_user_decision` | :486 | {} |
| `record_decision_application` | :486 | {} |
| `look_graph` | graph-tools.ts:327 | {} |
| `find_graph` | graph-tools.ts:328 | {} |
| `find_related_sessions` | session-discovery-tools.ts:138 | {} |
| `read_session_card` | session-discovery-tools.ts:139 | {} |
| `record_unknown_call_review` | unknown-call-review-tools.ts:212 | `item` :51, `verdict` :53, `evidence` :55, `crashSuspicion` :59 |
| `propose_safer_method` | unknown-call-review-tools.ts:298 | `item` :68, `command` :70, `cwd` :72, `rationale` :74 |

## 5. 字节证明（书 §5.0；最终提交 `6b8c80f` 的 result copy 上重跑）

### 5.1 渲染器 record & replay（E1）

Base 副本 `/tmp/s85-scratch/S3/base-e1`，result 副本 `/tmp/s85-scratch/S3/result-final`。同一套 wrapper 应用到两份副本；`base-run1.jsonl` 的每条调用重放到 result。

| 被包的东西（base 文件:行） | 捕获调用 | 差异 |
|---|---:|---:|
| `renderContinuationBriefZh`（continuation-brief.ts:382） | 30 | 0 |
| `approvedMethodLinesZh`（:864） | 300 | 0 |
| 私有 `blockedCommandsLinesZh`（:517） | 47 | 0 |
| `renderUnknownCallReviewZh`（prepared-execution.ts:97） | 277 | 0 |
| `platformRoleProfile`（role-profiles.ts:63） | 927 | 0 |
| `formatDecisionResponseInput`（execution-inputs.ts:58） | 3 | 0 |
| `architectureReminderRowEntries`（architecture-reminders.ts:188） | 47 | 0 |
| `renderNoteHeader`（note.ts:109） | 10 | 0 |
| consultation guidance 表达式（consultation.ts:447） | **0** | 0（仅边界输入覆盖，见下） |
| scribe reminder 表达式（host.ts:1434–1435） | 11 | 0 |
| context-extensions 待决定行（:124） | 75 | 0 |
| 未接入行（:134） | 85 | 0 |
| 异常锚点行（:179） | 156 | 0 |
| **合计** | **1,968** | **0** |

- 边界输入矩阵 308 例，base 两次与 base→result 均 0 差异、0 错误（枚举、四种接续、workspace 状态、anomalies/review/blocked 有无、16 KiB 附近、160 字节声明形式、17 条被拦命令、K3 expanded/truncated/unexpanded、cwd null/空/多行、personText 空/非空、乱序 targets、五种 duty、注记各状态/锚点、20+ 锚点、时间阈值、`\r\n`、中文、emoji、组合字符、`{{slot}}`、反引号、尾随空格）。
- base-vs-base：1,935/1,968 行逐字节相同；33 行不同全部可解释（25 行只是随机 id/观测时间不同而输出相同，8 行 `unknownCallReview.render` 输出含真实 Kernel `startedAt`），按 `(testPath,testName,probe,index)` 配对后用 run-1 参数重放，0 差异。
- **未由测试捕获的路径**：consultation guidance 的消费路径在测试里都走 inquiry/response 分支，捕获 0 次；只有 308 例边界输入证明（书 §5.0 规则 3 的“未由测试字节证明”项，原因如此）。其余 11 个 probe 都有真实测试调用。
- 脚本与日志：`/tmp/s85-scratch/S3/probes/e1/`（`apply-probe.mjs`、`replay.mjs`、`compare-edge.mjs`、`base-run1.jsonl`、`base-run2.jsonl`、`replayed-result-final.jsonl`、`edge-*.jsonl`、`REPORT.md`）。

### 5.2 guide 与工具的两点（E2）

Base `/tmp/s85-scratch/S3/base-e2`；result `/tmp/s85-scratch/S3/result-final`。

| probe | 捕获 | 差异 |
|---|---:|---:|
| `INITIAL_COORDINATION_RESPONSE_GUIDE`（query-preparation.ts:50–133） | 22 个测试文件，8,347 B，sha256 `0ce75dae…e8bd3d` | 0 |
| guide 追加后的最终 Query input（:309–311） | 51 次（45 次 initial 精确为 `问题\n\n`+guide，6 次 semantic 无 guide） | 0 |
| `additionalTools` 返回处的 definitions（observed-model-run.ts:317–337） | 97 次；31 个平台工具全部出现 | 0 |
| `enabledNames` / `hostAuthorizedTools`（:301–303、:316） | 100 次 | 0 |
| model client 收到的完整 `tools`（Kernel 转换并按名排序后，:258–266） | 130 次，33 个名字（31 平台 + 内置 `read`、`edit`） | 0 |

- 总计 22 个文件、400 条记录，22/22 原始字节相等，0 payload/runIndex 差异；`result.jsonl` 与 `base-run1.jsonl` 逐字节相同（sha256 `3d934394…227656f`）。
- 八种情形：测试覆盖 mailbox/graph/note/session-discovery/query_task_graph、none、Query 有 graph、Query 无 graph、fixed-source；driver 覆盖剩余 whiteboard 三个、三个 decision、review、proposal、rerun、`read_source`。`K3-14`/`K3-16-proposal-tool` 直接构造 definitions，不进 `additionalTools`，由 driver 补齐注册情形。`read_material` 是 material 工具，不在 31 个之内。
- 脚本与日志：`/tmp/s85-scratch/S3/probes/e2/`（`apply-probes.mjs`、`run-result.sh`、`driver.test.ts`、`compare.mjs`、`result/`、`result.jsonl`、`REPORT.md`）。

## 6. 测试与检查

| 检查 | 结果 |
|---|---|
| `flock /tmp/s85-scratch/tsc.lock npm run typecheck` | 通过 |
| `npm run check:architecture` | 通过（`next source boundaries: OK`） |
| `flock /tmp/s85-scratch/tsc.lock npm run build` | 通过（`platform prompt pack: OK` + tsc） |
| 书列测试 A 半（83 文件，9 批，≤10/批，`--maxWorkers=2`） | 71 文件通过 / 12 失败；593 项通过 / 33 失败 / 0 跳过 |
| 书列测试 B 半（82 文件，9 批） | 82/82 文件；965 项通过 / 0 失败 / 2 跳过 |
| `tests/architecture`（4 文件） | 53 项通过 / 0 失败 |
| **合计** | 169 文件；**1,611 通过 / 33 失败（全部环境）/ 2 跳过** |

33 项失败全部是缺 bubblewrap：12 个文件；31 项在原始 base 副本上同样失败，2 项直接打印 `ENOENT: no such file or directory, access '/usr/bin/bwrap'`（`tests/runtime/S5-user-message-tools.test.ts` 的 TU07、`tests/app/orchestration-mechanism.test.ts` 的并行 Task 用例）。其余 31 项分布：A2-requeue-route 1、R6-host 1、A2-requeue-platform 5、A1-rework-same-session 1、A8-host-restart-entry 7、A8-host-restart-paused 7、C3-brief-idempotency 4、C3-not-entered-chain 1、C3-reply-other-session 3、C3-workspace-changed 1；都是 `waiting`/`verifying` 与期望的差异。没有改任何测试或 allowlist；`tests/architecture/*` 与 base 逐字节相同，`production-reach.test.ts` 4/4、`state-writes.test.ts` 19/19 通过。

局部早跑（同一代码）：brief/K3 28 文件 272 通过 + 4 环境失败；tools-1 27 文件 250 通过；tools-2 23 文件 225 通过 + 6 环境失败；rest 23 文件 343 通过 + 2 环境失败。

## 7. 检查步骤 4–5

- `git diff --name-only s85-base HEAD | grep -vE -f ./.dsh-ref/s85-whitelist.txt`：空。
- `git diff --name-only s85-base HEAD -- tests`：空。
- `git status --porcelain`：空。
- 规模：`git diff --numstat s85-base HEAD` = **2,540 added + 431 deleted = 2,971**，净 **2,109**；新文件 40 个资源 + 4 个 src 模块 + 1 个脚本，共 1,790 行。相对书 2,150–2,950 多 21 行（约 0.7%）。
- 主要文件：生成模块 596、`strings.json` 346、`continuation-brief.ts` +315/−177、renderer 210、构建脚本 179、`runtime-assets.json` +160、guide 模板 84、`pack.json` 78、`prepared-execution.ts` +61/−41；其余 23 个生产文件都小于 20 行改动。

## 8. 对照书/盘点/运行书发现的疑点

- **运行书 scratch 路径不可写**：见第 0 节。这是本会话环境与运行书唯一冲突。
- **书 §5.1 row 46 的 `；source=`**：第一版 consumer 只搬了 `待决定：`，漏了 `；source=`；已加 `contextExtension.sourceSeparator`，字节不变（已在提交里）。
- **`unknown-call-proposal` 的 `mentionsTools`**：模板正文里出现 `propose_safer_method`，所以是 `["propose_safer_method"]`；`record_unknown_call_review` 只出现在 `unknown-call-review` 的说明里但没有字面工具名，故为 `[]`。
- **`scribe-reminder` 用裸可选槽位**（不是块）：`锚点：` 无条件保留，和 base 一致；已用 0 与 20+ 锚点边界证明。
- **`read_material` 不是 31 个平台工具之一**（material 工具，由 `materialTools` 提供），书 §5.1 proof 3 的“31”没有把它算进去。
- **consultation guidance 没有测试捕获**：原因见 5.1；不是遗漏，是现有测试分支不经过它。
- **`unknownCallReview` 的 8 条 base-vs-base 差异**来自真实 Kernel 的 `startedAt`，不是本改动；已按书 §5.0 规则 3 用 run-1 参数重放，未删 id/hash。
- 书的大小区间 2,150–2,950 与“完整平台包 + 31 个工具文件”的实际量相比略紧；本提交 2,971，建议把区间上沿视为“约”。

## 9. HANDOFF

不适用：S3 在时限内完成并提交（`6b8c80f`）。S4 可直接使用第 3、4 节的接口与 key 表；三个主输入模板资源与 assembler 的文字是 S4 的范围。
