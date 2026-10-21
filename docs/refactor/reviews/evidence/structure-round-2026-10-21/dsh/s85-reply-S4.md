# S85 S4（D3b）回复 — 提交 `39fee06`

## 0. 问题、偏差与开始前的疑问

没有阻塞施工的疑问。开始前读到的两处小偏差，均已按任务书处理：

- 盘点 §1 的部分行号是旧基线的；`## Question` 实际在基线 `context-assembler.ts:1996`（盘点任务书 §3 写 `:349`），`## Context omissions` 在 `:349`（写 `:343`）。只影响定位，不影响内容。
- 三个主输入槽位表 S3 已经写好，本运行只需核对、没有改动 `slot-tables.ts`。
- 运行书要求 scratch 放在本副本 `.dsh-scratch/S4`；已照做，未进入提交。

## 1. 摘要（不到 300 字）

D3b 完成：`context-assembler.ts` 从 2,037 行压到 39 行，只剩转出口、`createContextAssembler`、一次 clock 读取和 `readAttentionGraph` 的检查与委派；组装逻辑按盘点 §3 拆成 11 个 `context-*` 模块。三个主输入模板（`work-input`、`query-planning-input`、`query-copy-input`）和 95 条 `context.*`/`note.warning.*` 字符串进入平台包 v1，`note-read-model.ts` 的 row 28 也改为读包。旧出口 25/25 仍从旧路径可用，测试与 allowlist 未改。字节证明：渲染器/事实格式化 2,156 次调用重放 0 差异、边界 140 例 0 差异；整个组装器结果 0 差异（132 次 task、8 次 query、1 次 attention），写入的 manifest 与摘要 105/105、4/4 原始字节相等；依赖调用的名称、参数、顺序 254/254 相同。仅依赖返回值里 6 个由 Kernel 实时工作区 inode/mtime/size 派生的字段无法确定化，base 两次运行也在这同样 6 个字段上不同，列为“未 byte-proven”。`typecheck`、`check:architecture`、`build`、24 个指定测试文件 + `tests/architecture` 全过。规模 4,495（新增 2,468 / 删除 2,027），净 441。

## 2. 逐步骤表

| 步骤 | 状态 | 说明 |
|---|---|---|
| pack owner：key 表、3 模板、95 字符串、`pack.json`、生成模块、资源哈希 | 完成 | 先把 `.dsh-scratch/S4/keys-P.md`（95 行精确值 + 基线位置）发给消费者，再写资源；`node scripts/build-platform-prompts.mjs --check` OK |
| `context-types.ts` / `context-support.ts` / `context-review-input.ts` | 完成 | 逐函数与基线文本 diff 相同；只加了 INTERFACES 要求的 `export` |
| `context-workspace-facts.ts` / `context-history-facts.ts` | 完成 | 读取顺序、取消分支、`.call` 接收者不变 |
| `context-review-recipe.ts` / `context-continuation-recipe.ts` | 完成 | `readBasis.call(deps.executions,…)`、`reviews: []` 立即返回保留 |
| `context-fact-text.ts` | 完成 | 23 个函数/块搬迁；72 个包 key 逐一核对值 |
| `context-rendering.ts` | 完成 | 一次 `renderTemplate` + 槽位区间回推 section；7 条适配规则在代码层 |
| `context-work-recipe.ts` / `context-query-recipe.ts` | 完成 | Work 读序、Query planning/copy 条件、clock 时机不变 |
| `context-assembler.ts` 收薄 + 转出口 | 完成 | 基线 25 个导出名 25/25 仍可 import |
| `note-read-model.ts` row 28 | 完成 | 只改 `generalWarningLabel` 的 5 个字符串来源，3 文件 71/71 测试 |
| 字节证明（渲染器/事实、整个组装器、写入、依赖） | 完成 | 见 §5；6 个环境字段列为未 byte-proven |
| 检查与提交 | 完成 | `39fee06`；工作树干净 |

## 3. 新模块接口表

路径均在 `src/core/agent-runtime/`；“来源”是基线 `context-assembler.ts` 的行；“使用者”是本轮生产调用者。

| 路径 | 导出（签名/形状） | 来源 | 使用者 |
|---|---|---|---|
| `context-types.ts` | `ContextClock`、`ArchitectureReminderReadPort`、`ContextAssemblerDependencies`、`AssembledContextV1`、`ContextAssembler`、`OptionalSectionName`、`OptionalRow`，形状与基线相同 | `:102–167`、`:594` | 全部 `context-*`、`context-assembler.ts` |
| `context-support.ts` | `utf8Bytes`、`byKey`、`messageOf`、`isRecord`、`rejected`、`mapRead`、`requirementIdOf`、`emptyNotes`、`indexRowText`、`canonical`、`sortedSources` | `:169–224` | 全部 `context-*` |
| `context-review-input.ts` | `ReviewCommandFactV1`、`REVIEW_COMMAND_MAX_BYTES = 4096`、`buildUnknownCallReviewInputV1(input)`、`trimUnknownCallReviewInput(review)` | `:140`、`:402`、`:428–526` | review recipe；`execution-preparation.ts` 经旧路径转出口 |
| `context-fact-text.ts` | `effectiveDuty`、`rolePayload`、`goalPayload`、`taskPayload`、`queryFocusLines`、`queryPlanSummary`、`notImplementedExtensions`、`noteSourcesOf`、`declarationsForTask`、`missingInputReminder`、`optionalRowsFromExtensions`、`annotations`、`topLevelModuleCards`（签名同基线） | `:201–207`、`:596–933` | work/query recipe |
| `context-rendering.ts` | `CONTEXT_FORMAT_VERSION`、`CONTEXT_SECTION_HEADERS`、`CONTEXT_SECTION_ORDER`、`WORK_CONTEXT_PRELUDE`、`QUERY_CONTEXT_PRELUDE`、`ATTENTION_HEADER`、`ATTENTION_MAX_BYTES`、`renderContext(input)`、`renderQueryContext({templateId,prelude,required,optional,residentBudgetBytes})`、`renderAttentionChanges(input)` | `:79–100`、`:266–394`、`:532–588` | work/query recipe、`host.ts`（经旧路径） |
| `context-workspace-facts.ts` | `BriefWorkspaceFactsOutcome`、`briefWorkspaceFactsFor(deps,now,record,signal)`、`readReviewCaptureChanges(deps,review)`、`unknownCallReviewFilesFor(deps,record,previous,review,signal)` | `:967–1124` | review/continuation recipe；`execution-preparation.ts` 经旧路径 |
| `context-history-facts.ts` | `SessionBasisOutcome`、`sessionBasisForContext`、`reviewSessionBasis`、`readKernelCommandFacts`、`archiveOriginSkipsHistorySeed`、`runEnteredKernel` | `:1025–1345`、`:1452–1470` | review/continuation recipe；composition 经旧路径 |
| `context-review-recipe.ts` | `assembleReviewForContext(deps,ctx,record,{reviewRef,phase,round})` | `:1384–1450` | work recipe |
| `context-continuation-recipe.ts` | `readTaskBlockedCommands(deps,ctx,input)`、`assembleBriefForContext(deps,now,ctx,record,taskReviews?)` | `:1484–1667` | work recipe；旧路径转出口 |
| `context-work-recipe.ts` | `assembleWorkContext(deps,clock,ctx,input)`，`input` 与基线内部 `assembleTask` 字段相同（含可选 `taskReviews`） | `:1672–1950` | `createContextAssembler` |
| `context-query-recipe.ts` | `assembleQueryContext(deps,ctx,input)`，`input` 与基线 `assembleQuery` 相同 | `:1952–2024` | `createContextAssembler` |

旧路径 `context-assembler.ts` 继续导出基线全部 25 个名字：`AttentionGraphReadRequestV1`、`ArchitectureReminderReadPort`、`AssembledContextV1`、`ContextAssembler`、`ContextAssemblerDependencies`、`CONTEXT_FORMAT_VERSION`、`CONTEXT_SECTION_HEADERS`、`CONTEXT_SECTION_ORDER`、`WORK_CONTEXT_PRELUDE`、`QUERY_CONTEXT_PRELUDE`、`ATTENTION_HEADER`、`ATTENTION_MAX_BYTES`、`renderContext`、`renderAttentionChanges`、`REVIEW_COMMAND_MAX_BYTES`、`ReviewCommandFactV1`、`buildUnknownCallReviewInputV1`、`trimUnknownCallReviewInput`、`BriefWorkspaceFactsOutcome`、`briefWorkspaceFactsFor`、`readKernelCommandFacts`、`archiveOriginSkipsHistorySeed`、`runEnteredKernel`、`readTaskBlockedCommands`、`createContextAssembler`。`renderQueryContext` 是新增内部入口，旧路径原本没有，故不转出口。

## 4. pack 新增 key 表

模板（`pack.json`，version 1，`extends: null`，无末尾 LF）：

| 模板 id | 必填槽位 | 可选槽位 | 文件 |
|---|---|---|---|
| `work-input` | `role`（完整 `## Runtime context` + 正文） | `prelude`、`goal`、`task`、`footprint`、`notes`、`reminders`、`inputs`、`continuation`、`unknown_call_review`（各带自己的前导 `\n\n`） | `templates/work-input.txt`（121 B） |
| `query-planning-input` | `role` | `prelude`、`goal`、`task`、`footprint` | `templates/query-planning-input.txt`（50 B） |
| `query-copy-input` | `role` | `prelude`、`goal`、`task` | `templates/query-copy-input.txt`（37 B） |

字符串 95 条（逐条精确值、基线文件:行见 `.dsh-scratch/S4/keys-P.md`）：

| 命名空间 | 条数 | 基线位置 |
|---|---:|---|
| `context.prelude.*` | 2 | `context-assembler.ts:98,100` |
| `context.section.*` | 7 | `:83–89` |
| `context.questionHeading` | 1 | `:1996` |
| `context.omissions.*` | 4 | `:298,343–349,570–572` |
| `context.none` / `context.notImplemented` | 1 / 1 | `:632–633,731,915` / `:722,736` |
| `context.role.*` | 16 | `:623–660` |
| `context.goal.*` | 5 | `:734–744` |
| `context.task.*` | 18 | `:787–829` |
| `context.query.*` | 4 | `:904–918` |
| `context.understanding.*` | 17 | `:676–731` |
| `context.work.*` | 5 | `:1712–1726,1746–1747,884` |
| `context.missingInput.*` | 9 | `:831–846` |
| `note.warning.*` | 5 | `note-read-model.ts:1846–1851` |

保留原区别：`(none)`、`（无）`、`(未声明)`、`(not_implemented)`、`未定义`、`null` 各自独立；`……`/`…`、`、`/`, `/`; `、`（noteId vN）` 全宽括号、两空格续行、尾随空格均未动。生成模块 `platform-pack.generated.ts` 只由脚本生成；`runtime-assets.json` 为 3 个新模板各加一条原始字节 SHA-256，并更新 `pack.json`/`strings.json` 的哈希。

## 5. 字节证明（书 §5.1 “Byte proof, S4”；均在 `39fee06` 的 result 副本上）

### 5.1 渲染器与事实格式化（record & replay + 边界矩阵）

Base 副本 `.dsh-scratch/S4/base-e1`（`s85-n2-base`），result 副本 `.dsh-scratch/S4/result-e-render`（`39fee06`）。同一 probe 形状；base 录 2,156 条，base-run1 参数逐条重放到 result，按 `(testPath,testName,probe,index)` 匹配；UTF-8 字节比较，对象按 own keys 顺序、数组逐元素、`undefined` 标记。

| probe | 基线符号/行 → result 位置 | base 调用 | result 调用 | 差异 |
|---|---|---:|---:|---:|
| `renderContext` | `context-assembler.ts:266` → `context-rendering.ts:232` | 236 | 220 | 0 |
| `renderQueryContext`（原 Query 半边） | 基线共用 `renderContext` → `context-rendering.ts:252` | 0（16 次记在 `renderContext` 下） | 16 | 0 |
| `renderAttentionChanges` | `:535` → `:270` | 12 | 12 | 0 |
| `fact.effectiveDuty` | `:608` → `context-fact-text.ts:38` | 251 | 251 | 0 |
| `fact.rolePayload` | `:623` → `:53` | 248 | 248 | 0 |
| `fact.goalPayload` | `:734` → `:164` | 141 | 141 | 0 |
| `fact.taskPayload` | `:787` → `:217` | 222 | 222 | 0 |
| `fact.queryFocusLines` | `:904` → `:335` | 14 | 14 | 0 |
| `fact.queryPlanSummary` | `:914` → `:345` | 1 | 1 | 0 |
| `fact.notImplementedExtensions` | `:201` → `:366` | 109 | 109 | 0 |
| `fact.noteSourcesOf` | `:233` → `:382` | 228 | 228 | 0 |
| `fact.declarationsForTask` | `:757` → `:187` | 222 | 222 | 0 |
| `fact.missingInputReminder` | `:831` → `:261` | 7 | 7 | 0 |
| `fact.optionalRowsFromExtensions` | `:852` → `:283` | 232 | 232 | 0 |
| `fact.annotations` | `:890` → `:321` | 228 | 228 | 0 |
| `fact.topLevelModuleCards` | `:921` → `:352` | 2 | 2 | 0 |
| `note.generalWarningLabel` | `note-read-model.ts:1846` → `:1847` | 3 | 3 | 0 |
| **合计** | | **2,156** | **2,156** | **0** |

- 确定性：base run1/run2 各 2,156 条，1,843 条逐字节相同；313 条不同中 254 条只差 `args`（临时 skills 路径、随机 id）、59 条为这些参数产生的输出；未擦除。用 run1 参数重放 base 得 0/2,156，重放 result 得 0/2,156。
- 边界矩阵 140 例：空/非空 prelude，role 空正文，goal/task 的 null/空串/普通文本，四个可选段单独与组合，notes 逆序，预算 0/−1 与每个候选前缀 −1/==/+1，continuation/review 四种有无，`\r\n`、中文、emoji、组合字符、`{{slot}}`、反引号、尾随空格，五种 duty，resolved/legacy role，注记状态/锚点/0/1/3/4+ 行，提醒阈值，16 KiB attention 溢出，三种 warning。base 两次逐字节相同，base→result **0/140**。
- 零捕获：无。`queryPlanSummary` 在 28 个套件文件里 0 次，由副本内 driver `tests/probes/planning-query.test.ts` 调用真实公共 `assembleQuery`（initial_coordination + focusPlan）补足；`topLevelModuleCards` 的第二次同源。

脚本与日志：`.dsh-scratch/S4/probes/e-render/`（`apply-probe-base.mjs`、`apply-probe-result.mjs`、`replay.mjs`、`compare-*.mjs`、`probe-counts.mjs`、`base-run1/2.jsonl`、`result-run1/2.jsonl`、`replayed-*.jsonl`、`edge-*.jsonl`、`REPORT.md`、`COMMANDS.md`）。

### 5.2 整个组装器结果（base vs result）

Base `.dsh-scratch/S4/base-e2`，result `.dsh-scratch/S4/result-e-assembler`，同一 `apply-probes.mjs`；25 文件 / 217 项测试在三次运行（base1、base2、result）各全过；每次 613 条记录。

| probe | 包的位置 | base | result | 差异 |
|---|---|---|---|---|
| `assembler:task` | 返回对象；基线 `:1672` → `context-work-recipe.ts` | 132 | 132 | **0**（另有 11 条只是 replay 元数据里的副本根路径） |
| `assembler:query` | `:1952` → `context-query-recipe.ts` | 8 | 8 | **0**（1 条同上） |
| `assembler:attention` | `:2029` → `context-assembler.ts` | 1 | 1 | **0** |
| `deps + clock` | `createContextAssembler` 入口的 deps 代理 | 254 | 254 | 名称/顺序 254/254、参数 254/254 相同；23 条**返回值**见下 |
| `stored:task` / `:put` | `execution-preparation.ts:561,570` | 105 / 105 | 105 / 105 | **0**；105/105 原始 `body` 字节相等 |
| `stored:query` / `:put` | `query-preparation.ts:248,278,284` | 4 / 4 | 4 / 4 | **0** |

- 整个结果按完整返回联合记录，own keys 顺序、缺失/`undefined`/`null` 分开；未 byte-proven 的只有依赖返回值中 6 个叶子路径：`deps.outcome.value.entries[].body.text`（20 条）、其派生 `sourceDigest`（2）与 `requeue.basis.source.sourceDigest`/`.digest`/`allRequeues[].…`（各 1）。它们来自冻结 Kernel 对实时临时工作区 SQLite/文件 inode·mtime·size 的 revision/checksum。**base-run1 与 base-run2 也在同样 6 个路径上不同**（`fields-base12.txt` 与 `fields-baseresult.txt` 的 distinct leaf paths 都是 6），本拆分没有引入新差异；按书 §5.0 规则 3 列为未 byte-proven。deps 的必证日志（名称、参数、顺序）254/254 相同。
- 为确定化，只在两个副本内做了相同编辑（不属于 `39fee06`）：Kernel `composition-root.js:82` 的 `now` 固定字面量、`runtime-runner.js` 的 `SystemClock.now()` 固定时间、`workspace-sandbox.js` 的 `dev:ino` → `1:1`，加计数器 `randomUUID`、确定性 `mkdtemp`、固定 `GIT_*_DATE`。仓库里的 `vendor/coding-agent/dist` 未改。
- 写入：`bodies.put` 的原始 manifest 字符串与 preparation 计算的摘要逐条比较，任务 105/105、Query 4/4 原始字节相等。

### 5.3 读取点、clock 与失败

deps 代理按调用顺序记录（含 `now()`）：`readExecution` 12、`readContinuationBasis` 16、`bodies.read` 4、`readContextFacts` 35、`readAttentionFacts` 1、`readTaskInputPage` 4、`architectureReminders.read` 10、`readReview` 12、`resolveRoot` 14、`captureDigest` 12、`capture` 12、`byAdapterId` 48、`withStore` 48、`now` 26；两副本名称、参数、顺序 254/254 一致。失败/取消测试中失败前的调用也同样一致。

**无测试到达的读取点（单独证据，不用“零差异”代替）**：

| 读取点 | 基线行 | 旧代码 | 新代码 |
|---|---|---|---|
| `roles.resolveRoleBindingFacts` | 类型 `:113–120` | deps 携带 `roles`，组装器从不读该成员 | `context-types.ts:33–39`，同样从不读 |
| `materials.storeArtifact` | 同上 | 携带 `materials`，从不调用 | 同上，从不调用 |
| `materials.openArtifact` | 同上 | 携带 `materials`，从不调用 | 同上，从不调用 |
| `plans` | `:115` | 携带，从不读 | `context-types.ts:35`，从不读 |
| `sessions` | `:115` | 携带，从不读 | `context-types.ts:35`，从不读 |
| `commandRerunRequests.listRequests` | `:1508,1518` | `read = await requestsRead.listRequests(ctx,{…})` | `context-continuation-recipe.ts:64,75`，同表达式 |
| `workspaceSource.readBaselineBlob` | `:1111` | `classifyReviewBytes(await source.readBaselineBlob(root, …))` | `context-workspace-facts.ts:164`，同表达式 |
| `workspaceSource.readCurrentFile` | `:1112` | `classifyReviewBytes(await source.readCurrentFile(root, path))` | `context-workspace-facts.ts:165`，同表达式 |
| `kernelStores.forWorkspace` | 入口 `:1179,1238,1279,1358` | `createSessionHistoryCursorOwner({kernelStores: deps.kernelStores,…})`；owner 只用 `byAdapterId`/`withStore` | `context-history-facts.ts:80,139,180`、`context-continuation-recipe.ts:139`，同入口 |

脚本与日志：`.dsh-scratch/S4/probes/e-assembler/`（`apply-probes.mjs`、`run-capture.sh`、`compare.mjs`、`read-points.mjs`、`field-diff.mjs`、`base-run1/2.jsonl`、`result-run.jsonl`、`base-vs-base.txt`、`base-vs-result*.txt`、`fields-*.txt`、`REPORT.md`）。

## 6. 运行的测试

命令：`timeout 900 npx vitest run --maxWorkers=2 <≤10 文件>`，一批一批跑。

| 批次 | 文件 | 结果 |
|---|---|---:|
| 1 | `s85-tests.txt` 第 1–10 个 | 10/10 文件，97/97 项通过 |
| 2 | 第 11–20 个 | 10/10 文件，63/63 项通过 |
| 3 | 第 21–24 个 + `tests/architecture`（4 文件） | 8/8 文件，107/107 项通过 |
| 合计 | 28 文件 | **267/267 项通过，0 失败，0 环境失败** |

其中直接覆盖本轮的：`S3-context-assembler`（15）、`S4C2-assembly`（14）、`K3-review-preparation`（10）、`S3-context-and-inputs`（1）、`S3-query-graph`（1）、`R5b-initial-plan`（2）、`S4C2-memory-material`、`S4C2-read-counts`、`S3-role-profiles`；`production-reach`、`state-writes`、`boundaries`、`record-store-literal-type` 全过。副本内另行重跑：e-render 28 文件 + driver = 288/288；e-assembler 25 文件 = 217/217。本机无 bubblewrap 的需求没有触发失败；没有 `ENOENT …/bwrap` 环境失败。

## 7. 检查步骤 4

- `git diff --name-only s85-n2-base HEAD | grep -vE -f ./.dsh-ref/s85-whitelist.txt`：空。
- `git diff --name-only s85-n2-base HEAD -- tests`：空（allowlist 也未动）。
- `git status --porcelain`：空。
- `flock .dsh-scratch/tsc.lock npm run typecheck`：通过。
- `npm run check:architecture`：`next source boundaries: OK`（含 pack 闭包与生成模块一致性）。
- `flock .dsh-scratch/tsc.lock npm run build`：`platform prompt pack: OK` + tsc，通过。

## 8. 变更行数

`git diff --numstat s85-n2-base HEAD`：**新增 2,468 + 删除 2,027 = 4,495，净 441**（书 3,750–4,550 之内）。

| 文件 | +/- |
|---|---:|
| `context-assembler.ts` | +23 / −2021 |
| 11 个新 `context-*` 模块 | +2,193（新文件） |
| `context-fact-text.ts` | 409 |
| `context-rendering.ts` | 323 |
| `context-work-recipe.ts` | 321 |
| `context-history-facts.ts` | 267 |
| `context-continuation-recipe.ts` | 220 |
| `context-workspace-facts.ts` | 170 |
| `context-review-input.ts` | 139 |
| `context-review-recipe.ts` | 118 |
| `context-query-recipe.ts` | 96 |
| `context-types.ts` | 78 |
| `context-support.ts` | 52 |
| `platform-pack.generated.ts`（脚本生成） | +113 |
| `strings.json` | +95 |
| `pack.json` | +15 |
| 3 个新模板 | 6（121/50/37 B） |
| `runtime-assets.json` | +14 / −2 |
| `note-read-model.ts` | +6 / −4 |

## 9. 对照书、盘点、运行书发现的疑点

1. 包 key 的基线行号：`## Question` 在 `:1996`，`## Context omissions` 在 `:349`；书 §5.1 的接口清单引用的是盘点行，不是本树精确行。已按实际文本取值。
2. 三个主输入槽位表 S3 已写好，S4 无改动；书 §5.1 “S4 只允许改三张表”在本树表现为“核对即可”。
3. `entries[].body.text` 与派生摘要取决于 Kernel 实时临时工作区 inode/mtime/size，连 base 两次运行都不同（6 个叶子路径）。这是环境不确定性，不是拆分回归；书 §5.0 规则 3 允许列为未 byte-proven，已列。
4. 运行书给的测试集是 24 个文件；我按书 §3 另加 `tests/architecture` 4 个，共 28 个。
5. `renderQueryContext` 是拆分产生的新内部入口，旧路径没有同名导出，因此没有从 `context-assembler.ts` 转出口；旧路径的 Query 行为仍走 `assembleQuery`。
