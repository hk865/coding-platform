# T 轮盘点：生产区 P2b（`src/` 中除 `src/core/work-graph/` 之外）

范围：`src/app/`、`src/business/`、`src/composition/`、`src/contracts/`、`src/core/agent-runtime/`、`src/core/record-store/`、`src/core/workspace/`、`src/ui/`，以及 `tests/architecture/production-reach-allowlist.json` 中这些目录的条目（`pre-batch` 62、`wire-format` 46、`kept-for` 21）。依据：决定 79-1／79-4（发布前不兼容旧数据，代码只读当前格式；*kept-for* 核对使用方是否还在计划里）、85-4（N0 归 T）、根 `AGENTS.md` 第 3/4/9 条。只读，未改仓库文件，未跑测试/构建。

一句话结论：本区真正可删的旧数据/旧格式集中在 5 条链——V1 authorization、legacy Kernel locator、artifact body 的 legacy origin、4B 时代 FTS 表与 round-1 全量索引迁移、UI localStorage v1 迁移；另有 4 条旧接口路径（attention 直读回退、query source 事件扫描回退、`legacy_live`/`project_index`、N0 goal input）和 8 处“缺字段＝旧记录”的兜底。`legacy_template`、`desiredStateRevision ?? 1`、host-settings 缺省、`kind:'legacy'` 通知位置等经核是**当前**格式，不删。

## 1. 发现表

| 编号 | 类别 | 位置（path:line；symbol/test） | 证据 | 建议 | 被谁覆盖 or 测试 | 估计行数 | 规格行 | 把握 |
|---|---|---|---|---|---|---|---|---|
| P2b-01 | old-data | `src/contracts/dispatch.ts:112-117,223`；读侧 `src/app/startup-reconcile.ts:199-211,336-340`、`src/app/goal-fan-out-driver.ts:363-366`、`src/composition/create-platform.ts:2145-2146`、`src/contracts/run-activity.ts:95-106`、`src/business/workflow/workflow.ts:1128-1133`、`src/core/agent-runtime/execution-observation.ts:530`、`execution-driver.ts:614,1038-1039,1056,1303`、`runtime.ts:329`、`run-reconcile.ts:102,264,699`、`continuation-brief-assembly.ts:592`、`context-assembler.ts:1471` | `ExecutionAuthorizationV1` 无 `schemaVersion`，是 V2 之前的授权形状。当前唯一写入方 `core/work-graph/state/run-machine.ts:863-868,959-962` 只写 `schemaVersion: 2`，`reconciledEndRecord`（`:902`）、revoke（`:971`）都在 V2 上展开；`rg "executionAuthorization: {"` 在 `src/` 只命中这些 V2 构造。codec 头注释自称 “retained … compatibility shape … readable for history”（`core/work-graph/persistence/execution-entry-codecs.ts:7,14`）。V1 只可能来自旧账本，产品从未真实运行。 | `delete`：删 `ExecutionAuthorizationV1`，槽收窄为 `ExecutionAuthorizationV2`；删 `'schemaVersion' in auth` 分支（`undefined`＝未授权仍保留）；删 startup-reconcile 的 `'legacy'`/`'V1'` 报表行与 `run-reconcile.ts:264` 的 `'V1/none'`。跨 P2a（run-machine/codec）。 | 测试钉住：`tests/state/run-machine.test.ts:444,1012`、`tests/work-graph/S2B-r2-r5-not-entered.test.ts:36`、`tests/work-graph/S2B-r2-never-entered.test.ts:23`、`tests/work-graph/B2-execution-entry.test.ts:205`；均为 V1 专用，删 V1 后一并改/删。V2 路径由 `tests/scenarios/K3-29-startup-reconcile-2b.test.ts` 覆盖。 | 60 | 是（run-machine V1 行） | 高 |
| P2b-02 | old-data | `src/core/agent-runtime/kernel-store-locator.ts:14-21,25-31,59,66-72,90-91,106-110,117-136`；`src/app/main.ts:153-159`；`src/core/agent-runtime/session-operations.ts:788-795,814-816,913-916,1023-1028,1045-1067`；`runtime.ts:354-357,429-432`；`query-execution.ts:312-313`；类型入口 `src/composition/create-platform.ts:243` | 只读 legacy Kernel locator，服务“前一个 Host/适配器已经写过的 Kernel 库”。全仓 `rg legacyEntries` 只命中本文件、`main.ts:153-159` 和测试；`rg '"legacyEntries"' --glob '*.json'` 无命中，**没有任何 src 代码或仓库内配置产生它**。生产 `kernelStores` 只有 `entries`，创建 Session 只走 `forWorkspace`。 | `delete`：删 `LegacyKernelStoreEntry`/`legacy()`/`withLegacyReader`/`legacyEntries` 解析与全部 `'expectedSessionId' in location` 分支；同步删 `tests/helpers/K-legacy-reader-support.ts`（160 行）。 | `tests/scenarios/K-W-workflow-close.test.ts:487,524`（KA-12）、`tests/composition/K-R-close-open-turn.test.ts:142`（KA-12）、`tests/runtime/R4b-session-skeleton.test.ts:56`、`tests/app/K-R-runtime-capabilities.test.ts:100` 的说明串；helper 整文件。`K-W:524` 的“完全没有 locator”分支保留。 | 120 | 是（KA-12/KE4） | 高 |
| P2b-03 | old-data | `src/core/record-store/body-codec.ts:147-219`（`normalizeOrigin`/`decodeOrigin` 的 legacy 分支）；`src/core/record-store/body-ports.ts:9,15`；消费者 `src/core/work-graph/materials/applicability.ts:96-97` | 唯一写入口 `encodeArtifactBodyRow`（`body-codec.ts:222-250`）在 `:239` 走 `normalizeOrigin`、`:247` **总是**写 `origin`；`normalizeOrigin:196` 拒绝写 `kind:'legacy'`。唯一行写入方 `body-store.ts:30` → `sqlite-body-store.ts:29`。当前代码写不出“没有 `origin` 的 artifacts 行”；只有迁移前旧适配器写的行才靠 `ownerRunRef` 猜回 legacy。 | `delete`：删 `decodeOrigin` 的 `value === undefined` 分支、`MaterialOrigin` 的 `{kind:'legacy'}`、`normalizeOrigin:196` 的 legacy 拒绝与 `applicability.ts:96-97`。 | `tests/data/R3b-materials-contract.test.ts:63,88,151`；`tests/work-graph/S3-context-inputs.test.ts:556` 手写 `origin:{kind:'legacy'}` 夹具。当前写路径由 `R3b-body-boundaries.test.ts` 覆盖。 | 20 | 否 | 高 |
| P2b-04 | old-data | `src/core/record-store/sqlite-text-scan.ts:13-15,54-60,135-160` | 只匹配 4B 时代的 `next_fts_meta` 与 `CREATE VIRTUAL TABLE next_fts_%`。当前 writer 只建 `next_text_meta`（`:43`）和 `next_text_*`（`:72-74,206-212`）；`rg next_fts` 在 `src/` 只命中这段注释与 SQL。删掉后旧表只是惰性残留，不影响当前读取（本文件自己写 “inert”）。 | `delete`：删 `LEGACY_TABLES_SQL` 与开库 DROP 块。 | `tests/record-store/SP-text-scan.test.ts:400-432` 用 `tests/helpers/SP-storage-migration-fixture.ts:15` 造旧 FTS 表；断言经公开端口比较结果，删 DROP 后仍应通过，但夹具/SP-12 要同步改。 | 33 | 是（SP-12） | 高 |
| P2b-05 | old-data | `src/core/record-store/sqlite-lookup-indexes.ts:87-88,99-113,123-131` | 当前 `lookupIndexBody`（`:54-83`）生成的索引**永远带** `WHERE <aggregateType>`；`predicate === null` 的“旧全量索引”只来自已不在树中的 round-1 `createLookupIndexes`（`rg` 只剩注释）。create-if-missing 对全新库必要，drop 只在旧库需要。 | `delete`：只删 `predicate === null` 的旧 full-index drop 与 `TYPE_PREDICATE`；保留 create-if-missing、stale-index drop 与事务。 | `tests/record-store/SP-lookup-index-migration.test.ts:107,154,188,223`（SP-40..SP-43）首页注明是 characterization，索引存在与否不改变答案；需同步改。 | 20 | 否（R2-1(C') 文字需改） | 高 |
| P2b-06 | old-data | `src/ui/state/display-preference.ts:14-16,106-111,119-124,131-137`；`src/ui/main.ts:64` | 只有这里**读** `workbench.display-preference.v1`；全仓没有 `set(DISPLAY_PREFERENCE_V1_KEY, …)`。真正写入的是 `save()`（`:143`）和 `writeGlobal()`（`:149`）的 v2 scope/global key。v1 记录只能来自已发布 UI，产品从未真实运行。 | `delete`：删 v1 常量、`readLegacy` 与两处迁移分支；删 `ui/main.ts:64` 的导出。保留 v2 按 scope/global 存取。 | `tests/app/MVP-ui-entry.test.ts:241`（`:262-273` 是迁移断言；`:241-261` 的按 scope 隔离断言保留）。 | 23 | 否 | 高 |
| P2b-07 | legacy | `src/app/attention-observer.ts:588-599,651-715`（`:668-715` 的 else 直读分支）；`src/app/host.ts:1444-1447` | 生产**总是**注入 `readAttentionGraph`：`host.ts:1445-1447` 在 `platform.runtime.readAttentionGraph !== undefined` 时传，而 `create-platform.ts:1509-1510` 无条件转发、`core/agent-runtime/runtime.ts:737` 无条件定义。`tests/app/S3-attention-context.test.ts:302-303,464-466` 明确断言 `plans`/`architecture` 直读 never run；只有 S0 三个用例和 `S3-query-graph.test.ts:459` 走 else。 | `delete`：删 else 分支、`plans`/`architecture` 两个依赖项与 host 对应参数；S0 三个用例改为伪造 `readAttentionGraph`（行为不删，只换注入）。 | `tests/app/S0-attention-edge-label.test.ts:68,76,87`；当前路径由 `S3-attention-context.test.ts:302,464` 覆盖。 | 60 | 否 | 高 |
| P2b-08 | old-data | `src/core/agent-runtime/source-capture-access.ts:260-267,675-727` | deps 的 `events` 是 `Partial<…>` 兼容项；生产注入的 `createSourceAuthorityReader`（`create-platform.ts:1039`）只返回 `load` + `readQuerySubmission`，该文件 `:21-23` 明确写 “This port has no `events` member”。当前 QueryJob 快照都带 `submission`：`query-job-service.ts:498,731`。真实路径恒走 `:646-679`，事件扫描只能由测试的 events-only fake 触发。 | `delete`：删 `:675-727` 的事件页扫描与 deps 的 `events`，保留 `:646-679` 的精确 locator。 | `tests/runtime/source-binding-migration.test.ts:221,232` 用 events-only fake；删后改造成 locator fake。 | 70 | 否 | 高 |
| P2b-09 | legacy | `src/core/agent-runtime/observed-model-run.ts:79-88,204,282-285,304,323-328`；`src/core/agent-runtime/exploration-tools.ts:67-79,113-125,176-177`；`src/core/workspace/project-source-index.ts:1-103`（`ProjectSourceIndex`） | 唯一生产调用 `createExplorationTools` 是 `observed-model-run.ts:323`；`frozen` 只在 `projectSource.mode==='frozen'` 时为真（`:204`）。`hasFileRead`（`builtinTools.includes('read')`）为真时，`execution-driver.ts:1127,1135,1243` 与 `query-execution.ts:320,328,542` **一定**构造 `sourceFactory` 并以 `mode:'frozen'` 传入；没有 read 时 `needsExploration=false`，根本不建 exploration 组。因此 `legacy_live` 与 `project_index` 在生产不可达；工具描述自称 “live compatibility path”（`:177`）。 | `delete`：删 `legacy_live` 模式、`ProjectSourceIndex` 构造与 `project_index` 工具定义、整文件 `project-source-index.ts`；`project-source-snapshot.ts`/`typescript-source-query.ts` 仍被其它路径使用，保留。 | `tests/data/project-source-index.test.ts` 整文件（176 行、7 个 it）；`tests/app/project-source-tool.test.ts:268`（显式 `legacy_live` 与隐式默认）；`tests/runtime/source-tool-lifecycle.test.ts:231,252,308`。工具名表 `tests/state/unknown-call-kinds.test.ts` 在 P2a。 | 125 | 否 | 高 |
| P2b-10 | n0 | `src/business/workflow/contracts.ts:61-69`（`N0GoalInput`）、`index.ts:3-6`（导出）、`ports.ts:221-226`（`handleGoalInput(input: N0GoalInput \| InitialPlanningGoalInput)`）、`workflow.ts:812-820`（只接受 `planning_answer`/`adopt_initial_plan`，其余 `unsupported`） | 读的是 N0 骨架 `{meta, goal, requestBodyRef, text, action:{kind:'request_work'}}`；生产业务只走两条 initial-planning 输入，N0 注释自称 “source boundary skeleton; no business action is implemented”。真实规划桥 `workflow.ts:821-870` 必须保留。决定 85-4 已把 N0 目标输入归 T。 | `delete`：删类型、导出、port 联合收窄为 `InitialPlanningGoalInput`、删 unsupported 分支。 | `tests/composition/platform.test.ts:79-85` 是唯一传 N0 形状的测试（断言 `rejected/unsupported`），删该段。 | 16 | 否（决定 85-4） | 高 |
| P2b-11 | old-data | `src/contracts/plan.ts:221-227,263-272`（`PlanRevisionDraft`/`PlanRevisionSnapshot` 的 V1 分支）；写入 `src/core/work-graph/tasks/plan-commit-compiler.ts:154-162`；解码 `plan-record-codecs.ts:521-582`；消费 `plan-service.ts:770,977`、`plan-validation.ts:307,310`、`src/core/agent-runtime/context-assembler.ts:757-790` | 当前唯一 writer 只在 `draft.schemaVersion === 1` 时写 V1，而生产没有任何代码构造 V1 draft：初始规划只产出 v2（`initial-plan.ts:105-110`），白板工具要求模型用 `schemaVersion: 2`（`whiteboard-tools.ts:222`），UI 提交的 plan 来自这些 v2 响应。只有测试手造 V1 draft（`plan-machine.test.ts:498`）。 | `delete`：删两个 V1 联合分支（只留 `schemaVersion: 2`）；删 compiler 的 V1 返回、codec 的 V1 分支、上述 `=== 2` 判断。跨 P2a。 | `tests/state/plan-machine.test.ts:498`“accepts a schema 1 draft”；V2 路径由 `initial-plan`/`W1` 测试覆盖。 | 32 | 否 | 高 |
| P2b-12 | old-data | `src/contracts/core/prepared-execution.ts:200-205`（`contextAssembly?`，“absent means `legacy_unversioned`”）；读侧 `src/core/work-graph/tasks/execution-entry-service.ts:1040-1060` | 读的是第 3 片之前的 prepare manifest。生产装配器始终存在：`create-platform.ts:1172-1180,1231` 同时装 `graphContext` 和 `taskInputs`；装配器总返回 `binding`（`context-assembler.ts:123,1932,2011`）；prepare 一旦装配成功就写 `contextAssembly`（`execution-preparation.ts:498,533`）。 | `delete`：`contextAssembly` 改必填；删 `execution-entry-service.ts` 的 undefined/legacy 分支与 AD05 测试。 | `tests/work-graph/S3-prepared-context-admission.test.ts:499`（AD05 “old manifest … is not migrated”）。 | 18 | 否 | 高 |
| P2b-13 | old-data | `src/contracts/verification.ts:238-239`（`RoundSnapshot.chain?`，“absent = legacy chain root”）；读侧 `src/core/work-graph/state/verification-machine.ts:101,507,530,590,645,652,716,1394`、`task-failure.ts:1180` | 读的是 A.2 步之前的轮次。当前每个轮次都写 chain：根轮 `verification-machine.ts:920` 写 `chain: rootRoundChain()`，后继轮在 `:646-652` 构造完整 `RoundChainV1`；没有当前 writer 省略它。 | `change: chain 改必填；删 `?? 1`/`?? []`/`=== undefined` 旧根兜底，测试夹具补字段`。 | `tests/state/verification-machine.test.ts:131`（“open@1 without chain … legacy slot-less root”）、`tests/state/invariants.ts:1949`。 | 14 | 否 | 中 |
| P2b-14 | old-data | `src/contracts/query-job.ts:147-177`（`QueryJobIntentV1.execution?`，“Absence retains the legacy query contract”） | 读的是没有角色执行绑定的旧 Query intent。今天两个写入方都写 `execution`：`src/ui/views/execution/query-flow.ts:96-103`、`src/business/workflow/consultation.ts:440-459`。读侧一串 `intent.execution?.`：`consultation.ts:141,209,506`、`query-execution.ts:117,899,1212`、`mailbox-service.ts:609`、`plan-service.ts:1142`、`planning-question-reader.ts:168`、`session-provenance-facts.ts:234`；校验只在 present 时检查（`query-job-service.ts:280`、`query-record-codecs.ts:238`）。 | `change: execution 改必填；删“缺省＝旧契约”的 `?.` 兜底与 when-present 校验；夹具补字段`。 | 无专门钉旧形状的测试；fixtures 多处不带，需同步补。 | 16 | 否 | 中 |
| P2b-15 | legacy | `src/business/workflow/contracts.ts:234-238,268-272`（`failedReviewRefs?`）；`workflow.ts:725` | 注释自称 “B1 rework 4 legacy UCR-only carry … kept for compatibility”，但本仓库 driver 已不读它：`workflow.ts:690-716` 只解析 `failedCardRefs`，结果侧 `readyValue`（`:511-520`）只产出 `failedCardRefs`。 | `delete`：删两个类型字段与 `:725` internal 键校验里的 `failedReviewRefs`；保留公开输入拒绝。 | `tests/business/K3-UR7-crr-failed-set.test.ts:388,444-445`（“projection is no longer produced”）、`tests/business/K3-46-review-advance-failures.test.ts:629-677`（公开输入被拒）。 | 6 | 是（K3-UR7/K3-46） | 高 |
| P2b-16 | legacy | `src/business/workflow/decision-actions.ts:386-416`（`captured === null` 时的 current-fact 兼容读）；`capturedAnswerSource:197-205` | 注释原文 “Compatibility path for an answer response without the slice-5 captured source shape”。正常路径（`:364-384`）已用 captured source 决定；回答由 owner 写入该 source（`contracts/core/session-message.ts:68` 的 `DecisionApplicationReceiptV1` 一带）。 | `delete`：`captured === null` 直接返回 `invalid`/`application_not_recorded`，删 `:386-416`；`decisionSources` 若只剩此处使用一并删。 | 未找到专钉该分支的测试；现有 decision 测试都走真实 answer 写入，删除前需再扫一遍手造 `response.decision` 的 fixture。 | 25 | 否 | 中 |
| P2b-17 | legacy | `src/contracts/ledger.ts:72-86`（`desiredStateRevision?`/`desiredStateRequestedBy?`，“absent on records written before A.2”）；写入 `src/core/work-graph/state/goal-machine.ts:82-104`；读侧 `src/app/goal-fan-out-driver.ts:193,354-355,411,475`、`src/app/startup-reconcile.ts:441`、`goal-machine.ts:196,199` | 看起来像旧记录，但**当前 writer 仍故意写旧形状**：`newGoalSnapshot` 注释写 “the pre-A.2 shape”“The two D-9 fields are absent”，只有 `nextGoalDesiredState`（`:116-131`）才写。产品没跑过，不必继续为“旧账本字节兼容”写 pre-A.2 形状。 | `change: newGoalSnapshot 显式写 `desiredStateRevision: 1, desiredStateRequestedBy: null`；两字段改必填；删全部 `?? 1`/`?? null`（含 goal-fan-out/startup-reconcile）`。注意这是**改新记录的字节**，不是删旧格式；若 lead 不愿改，则本条按 keep。 | `tests/state/goal-machine.test.ts:176,179` 断言“newGoalSnapshot … no D-9 fields”，需同步改。 | 12 | 否 | 中 |
| P2b-18 | old-data | `src/contracts/plan.ts:88-89,268-269`（v2 快照的 `taskStateBasis?`，“absent means every Task points at this Plan (the legacy/self rule)”）；读侧 `src/core/work-graph/tasks/plan-task-basis.ts:106-110` | 读的是 W1 只声明类型、尚未生成时的 v2 快照。当前每次采纳都写 basis：`plan-commit-compiler.ts:412`；`plan-task-basis.ts:106-110` 是唯一 self 兜底，`tests/state/invariants.ts:2116` 已要求后来的 v2 计划必须带 basis。 | `change: v2 快照里 taskStateBasis 改必填；删 self 兜底与相关测试分支`。 | `tests/state/invariants.ts:2116`、`tests/state/invariants.test.ts:1527-1544`。 | 7 | 否 | 高 |
| P2b-19 | legacy | `src/contracts/core/session.ts:20-43,52-55`（provenance 旧记录一次回填）；`src/business/workflow/session-maintenance.ts:366-390,612`；`ports.ts:137-141`；装配 `src/composition/create-platform.ts:804-819,845-848,1834-1837` | 读的是第 1 片之前没有 provenance 的 Session，靠 `SessionProvenanceBackfilled` 回填。这条旧数据路径是**活的**：生产装了回填读器；而且今天仍有生产路径写“无 provenance”的记录——`workflow.ts:1883` 普通 claim 的 `createSessionStep` 不带 provenance，`session-directory.ts:728-732` 对未提供者按 `new` 默认但仍省略字段。 | `user-decides`：建议先把 `create_session` 改成**总是**显式写 provenance（`workflow.ts:1883`、`session-directory.ts:732`），再按 79-1 删回填读器、`LegacyProvenanceBasisV1`、`legacyProvenance` 端口与 `write_session_provenance` 分支；否则删回填会改当前行为。跨 P2a（`session-provenance-facts.ts`、`session-availability.ts:501,615,1006`）。 | `tests/state/S1-session-archive.test.ts:192`、`tests/scenarios/S2C-K-legacy-provenance.test.ts:415`、`tests/work-graph/S1-provenance.test.ts`；删除时按行为已不存在处理。 | 30 | 否 | 低 |
| P2b-20 | old-data | `src/ui/views/graphs/architecture.ts:28-31,102`；`src/ui/views/graphs/node-link.ts:138-150`；`src/ui/views/setup/panels.ts:92` | 渲染“该 baseline 早于 catalog／早于目录”。`ArchitectureRevision.catalog === null` 只在 catalog row 缺失时出现（`core/work-graph/architecture/catalog-service.ts:417-421`）；当前唯一写入方 `adoptInitialArchitecture` 在同一 commit 原子写 baseline+catalog+active（`:525-552`）。旧 baseline 夹具 `tests/helpers/graph-session-fixture.ts:123-127,403` 注释就写 “used to prove the historical `catalog: null` read path”。 | `delete`：删 UI 的 null 渲染分支；前提是 core 把 `catalog` 收成非空并删 `readCatalogBesideBaseline` 的 null 返回（P2a）。`planning.ts:61 hasCatalog` 会改模型可见提示词，单独定。 | `tests/work-graph/A1-architecture-catalog.test.ts:169`（“reads a historical baseline as catalog:null”）、`tests/work-graph/A1-independent-review.test.ts:64`。UI 无直接测试。 | 10 | 否 | 中 |
| P2b-21 | legacy | `src/core/agent-runtime/run-limits.ts:16,31-32,41-48`（`taskBudget` 缺省 “legacy mapping”）；调用 `observed-model-run.ts:24` | 两个生产调用点都传 `taskBudget`：`execution-driver.ts:1220`（`record.run.budget`，`RunSnapshot.budget` 在 `contracts/dispatch.ts:249` 是必填）、`query-execution.ts:525`。`undefined` 只为旧调用/测试保留；`deadline === null` 才是当前合法形状。 | `change: taskBudget 改必填，删 undefined 分支（保留 deadline===null）`。 | 没有专门测试；省略只出现在旧字面量。 | 4 | 否 | 中 |
| P2b-22 | old-data | `src/core/record-store/migrations.ts:70-140,147-155`；`sqlite-record-store.ts:132,157-170` | 开库只做 4 表物理检查（缺表/主键/affinity/额外 NOT NULL 列），**没有库级版本标记**；四张表的 DDL 从旧适配器到今天没改过，所以旧 build 的库物理上通过检查，版本只在每条记录的 `schemaVersion` 上逐条判（`record-codec.ts:320-330,668-670`）；旧库不会在开库时被拦住，而是第一条读到时报 damaged/unregistered。`rg checkRecordStoreSchema` 在 `tests/` 无命中，失败路径无测试。 | `user-decides`：见第 3 节三案；我倾向方案 B（加 `next_schema_meta` 后删逐列 diff），但不决定。 | 无测试；`tests/architecture/*` 不涉及。 | 0（方案 B 约 15-20） | 否 | 高（事实）/中（取舍） |
| P2b-23 | allowlist-pre-batch | `src/app/core-http-types.ts:298-580` 的 60 个别名；`src/app/main.ts:19-29,31-51` 的 `WorkbenchCliWorkspace`/`WorkbenchCliConfig`；`tests/architecture/production-reach-allowlist.json` 对应 62 条 | 逐个 `rg` 全仓：除声明处无人引用；路由表直接绑 port 方法（`core-routes.ts:160-260,1097-1177`），不经过这些别名；解析函数 `parseWorkbenchCliConfig(raw: unknown)` 也不用那两个 CLI 类型。它们是旧路由批次留下的纯类型名，没有读者也没有旧格式。 | `user-decides`，建议 `delete`：删 62 个类型并从 allowlist 删 62 条（production-reach 要求 gone 的条目移除）。plain words：这些只是旧路由批次起的 DTO 类型名，路由表和 UI 都不引用，等于没有读者的类型别名。 | 无测试引用（60 个名字在 `tests/` 无命中）。 | 91 | 否 | 高 |
| P2b-24 | allowlist-wire-format | `src/app/core-http-types.ts:393-496` 的 46 个别名；`tests/architecture/production-reach-allowlist.json` 46 条 | 46 个别名对应的 23 条路由都在当前 `core-routes.ts` 路由表且被 `src/ui` 调用，所以**路由本身是当前 wire format**；但别名自身在 `src/` 零引用（`rg` 每个名字只命中声明）。其中 2 个有测试读者：`NotesListResponse`/`NotesWriteResponse`（`tests/app/S4C-record-note-host.test.ts:26,177,233`、`tests/app/S4C-note-routes.test.ts:17,46-48`）。其余 44 个连测试都不引用，allowlist 写的 “its reader is the HTTP route boundary” 与实际不符（路由表不经过别名）。 | `user-decides`：建议删 44 个无读者别名与对应 44 条 entries；保留 `NotesListResponse`/`NotesWriteResponse`（测试用它标注当前 HTTP body）。若决定“类型即文档”全留，则把 44 条的 note 改成“type-only documentation, no reader”，不要继续写“reader is route boundary”。 | 44 个无引用；2 个由 S4C 两个测试引用。 | 44 | 否 | 中（与 part1 的 keep 意见不同） |
| P2b-25 | allowlist-kept-for | `tests/architecture/production-reach-allowlist.json` 的 21 条：`contracts/role-spec.ts` 10 + `contracts/validation/role.ts` 3 + `contracts/role-material-channels.ts` 5 + `contracts/human-role-collaboration.ts` 1（`CoordinationPolicyPin`）+ `contracts/architecture-inspection.ts` 1（`FileGraphPageV1`）+ `core/workspace/role-source-reader.ts` 1 | 21 条的 note 都写 “kept for slice 3”（`FileGraphPageV1` 写 slice 8）。第 3 片已合入且 kept-for 一个也没用到（`slices/README.md:152`）；真正仍有效的理由是决定 6 “角色规格保留、暂不接线，留给按含义挑成员”（`HANDOFF.md:783`）与 7C（`slice-7-SPEC.md:37,166`），`FileGraphPageV1` 等的是架构页/E3（`E3-UI-ITEMS.md:328`、`slice-8-SPEC.md:173,330`）。install/activate RoleSpec 确实**不在生产路径**（无 route/tool 调用，只有 `tests/composition/R3d-R3g-platform.test.ts:122` 从 platform 端口直接调），所以不能按“已接线”删清单。 | `keep` + `change note`：代码保留；19 条 slice-3 note 改成“等决定 6 的按含义挑成员（7C，未排期）”，`FileGraphPageV1` 改成“等架构页/E3（D61-1）”。不要删清单条目（分析器仍判 unreached，删了 reach 测试会红）。 | `tests/data/workspace-path-boundary.test.ts:67,75,97`（source-index reader）；`tests/composition/R3d-R3g-platform.test.ts:71-130`（role spec 端口）；其余无生产调用方。 | 0 | 否 | 高 |

## 2. JSON

```json
[
  {
    "id": "P2b-01",
    "category": "old-data",
    "file": "src/contracts/dispatch.ts",
    "lines": "112-117, 223; app/startup-reconcile.ts:199-211,336-340; goal-fan-out-driver.ts:363-366; create-platform.ts:2145-2146; run-activity.ts:95-106; workflow.ts:1128-1133; agent-runtime readers: execution-observation.ts:530, execution-driver.ts:614,1038-1039,1056,1303, runtime.ts:329, run-reconcile.ts:102,264,699, continuation-brief-assembly.ts:592, context-assembler.ts:1471",
    "tests": ["tests/state/run-machine.test.ts:444,1012", "tests/work-graph/S2B-r2-r5-not-entered.test.ts:36", "tests/work-graph/S2B-r2-never-entered.test.ts:23", "tests/work-graph/B2-execution-entry.test.ts:205"],
    "evidence": "ExecutionAuthorizationV1 has no schemaVersion. The only constructors in src are run-machine.ts:863-868,902,959-962,971 and all write schemaVersion:2; rg \"executionAuthorization: {\" in src only hits those V2 spreads. execution-entry-codecs.ts:7,14 calls V1 a retained compatibility shape readable for history. Only a pre-V2 ledger can carry V1; the product never ran.",
    "action": "delete",
    "covered_by": "行为已不存在：所有当前 authorization writer 写 V2；V2 reconcile 路径由 tests/scenarios/K3-29-startup-reconcile-2b.test.ts 覆盖",
    "est_lines": 60,
    "spec_row": true,
    "confidence": "高"
  },
  {
    "id": "P2b-02",
    "category": "old-data",
    "file": "src/core/agent-runtime/kernel-store-locator.ts",
    "lines": "14-21,25-31,59,66-72,90-91,106-110,117-136; src/app/main.ts:153-159; session-operations.ts:788-795,814-816,913-916,1023-1028,1045-1067; runtime.ts:354-357,429-432; query-execution.ts:312-313; create-platform.ts:243",
    "tests": ["tests/scenarios/K-W-workflow-close.test.ts:487,524", "tests/composition/K-R-close-open-turn.test.ts:142", "tests/runtime/R4b-session-skeleton.test.ts:56", "tests/helpers/K-legacy-reader-support.ts"],
    "evidence": "rg legacyEntries in the whole repo only hits kernel-store-locator.ts, main.ts:153-159 and tests; rg '\"legacyEntries\"' over json files has no hit. No src code or repo config produces it. It registers the predecessor adapter's Kernel store read-only; current sessions are created through forWorkspace (current entries).",
    "action": "delete",
    "covered_by": "行为已不存在：没有生产 writer 登记 legacy 条目；K-W:524 的 no-locator 分支保留",
    "est_lines": 120,
    "spec_row": true,
    "confidence": "高"
  },
  {
    "id": "P2b-03",
    "category": "old-data",
    "file": "src/core/record-store/body-codec.ts",
    "lines": "147-219; body-ports.ts:9,15; work-graph/materials/applicability.ts:96-97",
    "tests": ["tests/data/R3b-materials-contract.test.ts:63,88,151", "tests/work-graph/S3-context-inputs.test.ts:556"],
    "evidence": "encodeArtifactBodyRow (body-codec.ts:222-250) goes through normalizeOrigin at :239 and always writes origin at :247; normalizeOrigin:196 refuses kind legacy. The only row writer is body-store.ts:30 -> sqlite-body-store.ts:29. Current code cannot write an artifacts row without origin; only pre-migration rows are decoded through ownerRunRef.",
    "action": "delete",
    "covered_by": "行为已不存在：没有当前 writer 写无 origin 的行；当前写路径由 tests/data/R3b-body-boundaries.test.ts 覆盖",
    "est_lines": 20,
    "spec_row": false,
    "confidence": "高"
  },
  {
    "id": "P2b-04",
    "category": "old-data",
    "file": "src/core/record-store/sqlite-text-scan.ts",
    "lines": "13-15,54-60,135-160",
    "tests": ["tests/record-store/SP-text-scan.test.ts:400-432", "tests/helpers/SP-storage-migration-fixture.ts:15"],
    "evidence": "LEGACY_TABLES_SQL only matches next_fts_meta and CREATE VIRTUAL TABLE next_fts_%; current code creates only next_text_meta (:43) and next_text_* (:72-74,206-212); rg next_fts in src only hits this comment/SQL. Old tables left inert.",
    "action": "delete",
    "covered_by": "行为已不存在：没有当前 writer 产生 FTS 遗留表；SP-12 的公开端口断言可保留",
    "est_lines": 33,
    "spec_row": true,
    "confidence": "高"
  },
  {
    "id": "P2b-05",
    "category": "old-data",
    "file": "src/core/record-store/sqlite-lookup-indexes.ts",
    "lines": "87-88,99-113,123-131",
    "tests": ["tests/record-store/SP-lookup-index-migration.test.ts:107,154,188,223"],
    "evidence": "lookupIndexBody (:54-83) always emits a WHERE predicate; predicate===null can only be a round-1 full index whose creator is no longer in the tree (rg createLookupIndexes only finds the comment). create-if-missing is needed for new files; the drop path only serves old files.",
    "action": "delete",
    "covered_by": "行为已不存在：没有当前 writer 生成无谓词的 full index；SP-40..SP-43 是 characterization",
    "est_lines": 20,
    "spec_row": false,
    "confidence": "高"
  },
  {
    "id": "P2b-06",
    "category": "old-data",
    "file": "src/ui/state/display-preference.ts",
    "lines": "14-16,106-111,119-124,131-137; src/ui/main.ts:64",
    "tests": ["tests/app/MVP-ui-entry.test.ts:241,262-273"],
    "evidence": "The v1 key is only read by readLegacy; no code calls set() with it. Current writes go to the v2 scope key (save :143) and v2 global key (writeGlobal :149). A v1 record can only come from a released UI, which never existed.",
    "action": "delete",
    "covered_by": "行为已不存在：v1 key 无 writer；v2 路径由同一测试 :241-261 覆盖",
    "est_lines": 23,
    "spec_row": false,
    "confidence": "高"
  },
  {
    "id": "P2b-07",
    "category": "legacy",
    "file": "src/app/attention-observer.ts",
    "lines": "588-599,651-715; src/app/host.ts:1444-1447",
    "tests": ["tests/app/S0-attention-edge-label.test.ts:68,76,87", "tests/app/S3-attention-context.test.ts:302,464"],
    "evidence": "Production always injects readAttentionGraph: host.ts:1445-1447 passes it when present, create-platform.ts:1509-1510 forwards runtime.port.readAttentionGraph unconditionally, runtime.ts:737 defines it. S3:302-303,464-466 assert the direct plans/architecture reads never run; only S0 fakes exercise the else branch.",
    "action": "delete",
    "covered_by": "当前 readAttentionGraph 路径由 tests/app/S3-attention-context.test.ts:302,464 覆盖；S0 三个用例改伪造 readAttentionGraph",
    "est_lines": 60,
    "spec_row": false,
    "confidence": "高"
  },
  {
    "id": "P2b-08",
    "category": "old-data",
    "file": "src/core/agent-runtime/source-capture-access.ts",
    "lines": "260-267,675-727",
    "tests": ["tests/runtime/source-binding-migration.test.ts:221,232"],
    "evidence": "Production reader createSourceAuthorityReader (create-platform.ts:1039) returns only load + readQuerySubmission; core/work-graph/source-authority-reader.ts:21-23 says the port has no events member. Current QueryJob snapshots carry submission (query-job-service.ts:498,731), so the exact locator at :646-679 is always used.",
    "action": "delete",
    "covered_by": "行为已不存在：生产注入的 reader 没有 events，当前 Job 都带 submission",
    "est_lines": 70,
    "spec_row": false,
    "confidence": "高"
  },
  {
    "id": "P2b-09",
    "category": "legacy",
    "file": "src/core/agent-runtime/observed-model-run.ts",
    "lines": "79-88,204,282-285,304,323-328; exploration-tools.ts:67-79,113-125,176-177; src/core/workspace/project-source-index.ts:1-103",
    "tests": ["tests/data/project-source-index.test.ts", "tests/app/project-source-tool.test.ts:268", "tests/runtime/source-tool-lifecycle.test.ts:231,252,308"],
    "evidence": "createExplorationTools is called only at observed-model-run.ts:323; frozen is set only for projectSource.mode==='frozen' (:204). When hasFileRead is true, execution-driver.ts:1127,1135,1243 and query-execution.ts:320,328,542 always build sourceFactory and pass mode:'frozen'; with no read, needsExploration=false and no exploration group is built. legacy_live and project_index are therefore unreachable in production.",
    "action": "delete",
    "covered_by": "行为已不存在：生产恒为 frozen 模式；工具描述自称 live compatibility path",
    "est_lines": 125,
    "spec_row": false,
    "confidence": "高"
  },
  {
    "id": "P2b-10",
    "category": "n0",
    "file": "src/business/workflow/contracts.ts",
    "lines": "61-69; index.ts:3-6; ports.ts:221-226; workflow.ts:812-820",
    "tests": ["tests/composition/platform.test.ts:79-85"],
    "evidence": "N0GoalInput is the N0 skeleton {meta, goal, requestBodyRef, text, action:{kind:'request_work'}}. handleGoalInput accepts the union then rejects anything other than planning_answer/adopt_initial_plan with 'N0 Workflow goal input is a source boundary skeleton; no business action is implemented'; the real planning bridge stays at workflow.ts:821-870. Decision 85-4 assigns N0 Workflow goal input to T.",
    "action": "delete",
    "covered_by": "tests/composition/platform.test.ts:79-85 (delete the N0 assertion); real planning bridge covered by R5b tests",
    "est_lines": 16,
    "spec_row": false,
    "confidence": "高"
  },
  {
    "id": "P2b-11",
    "category": "old-data",
    "file": "src/contracts/plan.ts",
    "lines": "221-227,263-272; work-graph/tasks/plan-commit-compiler.ts:154-162; plan-record-codecs.ts:521-582; plan-service.ts:770,977; plan-validation.ts:307,310; agent-runtime/context-assembler.ts:757-790",
    "tests": ["tests/state/plan-machine.test.ts:498"],
    "evidence": "The only writer, plan-commit-compiler.ts:154-162, returns V1 only when draft.schemaVersion===1; no src code builds a V1 draft (initial-plan.ts:105-110 writes v2, whiteboard-tools.ts:222 instructs schemaVersion 2, UI submits those v2 responses). plan-record-codecs accepts V1; only tests hand-build V1 drafts.",
    "action": "delete",
    "covered_by": "行为已不存在：生产不构造 V1 draft；V2 由 initial-plan/W1 测试覆盖",
    "est_lines": 32,
    "spec_row": false,
    "confidence": "高"
  },
  {
    "id": "P2b-12",
    "category": "old-data",
    "file": "src/contracts/core/prepared-execution.ts",
    "lines": "200-205; work-graph/tasks/execution-entry-service.ts:1040-1060",
    "tests": ["tests/work-graph/S3-prepared-context-admission.test.ts:499"],
    "evidence": "contextAssembly absent means legacy_unversioned pre-slice-3. Production always installs graphContext+taskInputs (create-platform.ts:1172-1180,1231); the assembler always returns a binding (context-assembler.ts:123,1932,2011); prepare writes it on every successful assembly (execution-preparation.ts:498,533).",
    "action": "delete",
    "covered_by": "tests/work-graph/S3-prepared-context-admission.test.ts:499 (AD05, delete/change)",
    "est_lines": 18,
    "spec_row": false,
    "confidence": "高"
  },
  {
    "id": "P2b-13",
    "category": "old-data",
    "file": "src/contracts/verification.ts",
    "lines": "238-239; work-graph/state/verification-machine.ts:101,507,530,590,645,652,716,920,1394; task-failure.ts:1180",
    "tests": ["tests/state/verification-machine.test.ts:131", "tests/state/invariants.ts:1949"],
    "evidence": "RoundSnapshot.chain absent means legacy slot-less root. Current writers always write it: verification-machine.ts:920 rootRoundChain() at open, :646-652 full successor chain. Readers use chain?. fallbacks; tests pin the old root.",
    "action": "change: chain required; delete legacy-root fallbacks",
    "covered_by": null,
    "est_lines": 14,
    "spec_row": false,
    "confidence": "中"
  },
  {
    "id": "P2b-14",
    "category": "old-data",
    "file": "src/contracts/query-job.ts",
    "lines": "147-177",
    "tests": [],
    "evidence": "QueryJobIntentV1.execution is optional and the comment says absence retains the legacy query contract. Both current writers include it: ui/views/execution/query-flow.ts:96-103 and business/workflow/consultation.ts:440-459. Readers fall back with intent.execution?. at consultation.ts:141,209,506, query-execution.ts:117,899,1212, mailbox-service.ts:609, plan-service.ts:1142, planning-question-reader.ts:168, session-provenance-facts.ts:234; validation only checks when present (query-job-service.ts:280, query-record-codecs.ts:238).",
    "action": "change: execution required; drop optional fallbacks",
    "covered_by": null,
    "est_lines": 16,
    "spec_row": false,
    "confidence": "中"
  },
  {
    "id": "P2b-15",
    "category": "legacy",
    "file": "src/business/workflow/contracts.ts",
    "lines": "234-238,268-272; workflow.ts:725",
    "tests": ["tests/business/K3-UR7-crr-failed-set.test.ts:388,444-445", "tests/business/K3-46-review-advance-failures.test.ts:629-677"],
    "evidence": "failedReviewRefs is called a legacy UCR-only carry kept for the installed driver, but workflow.ts:690-716 parses only failedCardRefs and readyValue (:511-520) produces only failedCardRefs. Tests assert the projection is no longer produced and the public field is refused.",
    "action": "delete",
    "covered_by": "行为已不存在：结果侧不再产出；tests/business/K3-UR7-crr-failed-set.test.ts:444 明说",
    "est_lines": 6,
    "spec_row": true,
    "confidence": "高"
  },
  {
    "id": "P2b-16",
    "category": "legacy",
    "file": "src/business/workflow/decision-actions.ts",
    "lines": "386-416; capturedAnswerSource:197-205",
    "tests": [],
    "evidence": "Compatibility path for an answer response without the slice-5 captured source shape. The normal path (:364-384) already uses captured pins; answers are written by the owner with that source (contracts/core/session-message.ts:68 DecisionApplicationReceiptV1 shape).",
    "action": "delete",
    "covered_by": null,
    "est_lines": 25,
    "spec_row": false,
    "confidence": "中"
  },
  {
    "id": "P2b-17",
    "category": "legacy",
    "file": "src/contracts/ledger.ts",
    "lines": "72-86; work-graph/state/goal-machine.ts:82-104,116-131,196,199; app/goal-fan-out-driver.ts:193,354-355,411,475; app/startup-reconcile.ts:441",
    "tests": ["tests/state/goal-machine.test.ts:176,179"],
    "evidence": "The pre-A.2 absence is still written by current code: newGoalSnapshot deliberately omits desiredStateRevision/desiredStateRequestedBy ('the pre-A.2 shape', 'The two D-9 fields are absent'); only nextGoalDesiredState writes them. Readers use ??1/??null. Product never ran, so writing the old byte shape is no longer needed.",
    "action": "change: newGoalSnapshot writes both fields; make them required; delete ??1/??null",
    "covered_by": null,
    "est_lines": 12,
    "spec_row": false,
    "confidence": "中"
  },
  {
    "id": "P2b-18",
    "category": "old-data",
    "file": "src/contracts/plan.ts",
    "lines": "88-89,268-269; work-graph/tasks/plan-task-basis.ts:106-110",
    "tests": ["tests/state/invariants.ts:2116", "tests/state/invariants.test.ts:1527-1544"],
    "evidence": "taskStateBasis absent implements the legacy/self rule for v2 snapshots written before W1 generation. Every current adoption writes basis (plan-commit-compiler.ts:412); plan-task-basis.ts:106-110 is the only self fallback; invariants.ts:2116 requires later v2 plans to carry it.",
    "action": "change: taskStateBasis required on v2 snapshots; delete self fallback",
    "covered_by": null,
    "est_lines": 7,
    "spec_row": false,
    "confidence": "高"
  },
  {
    "id": "P2b-19",
    "category": "legacy",
    "file": "src/contracts/core/session.ts",
    "lines": "20-43,52-55; business/workflow/session-maintenance.ts:366-390,612; ports.ts:137-141; composition/create-platform.ts:804-819,845-848,1834-1837",
    "tests": ["tests/state/S1-session-archive.test.ts:192", "tests/scenarios/S2C-K-legacy-provenance.test.ts:415", "tests/work-graph/S1-provenance.test.ts"],
    "evidence": "One-time legacy provenance backfill for sessions without provenance. The path is live (composition installs the reader), and a current production path still omits provenance: workflow.ts:1883 plain claim createSessionStep, session-directory.ts:728-732 default-new but field-absent. Deleting the backfill without writing provenance everywhere changes current behaviour.",
    "action": "user-decides: first always write provenance, then delete backfill",
    "covered_by": null,
    "est_lines": 30,
    "spec_row": false,
    "confidence": "低"
  },
  {
    "id": "P2b-20",
    "category": "old-data",
    "file": "src/ui/views/graphs/architecture.ts",
    "lines": "28-31,102; node-link.ts:138-150; setup/panels.ts:92",
    "tests": ["tests/work-graph/A1-architecture-catalog.test.ts:169", "tests/work-graph/A1-independent-review.test.ts:64"],
    "evidence": "The UI renders 'baseline earlier than catalog' when revision.catalog===null. readCatalogBesideBaseline returns null only when the catalog row is absent (catalog-service.ts:417-421); adoptInitialArchitecture writes baseline+catalog+active atomically in one commit (:525-552). Only a pre-catalog baseline or deleted row produces null; the old shape is seeded by tests/helpers/graph-session-fixture.ts:123-127,403.",
    "action": "delete",
    "covered_by": "UI 无直接测试；core 旧读数由 tests/work-graph/A1-architecture-catalog.test.ts:169 覆盖",
    "est_lines": 10,
    "spec_row": false,
    "confidence": "中"
  },
  {
    "id": "P2b-21",
    "category": "legacy",
    "file": "src/core/agent-runtime/run-limits.ts",
    "lines": "16,31-32,41-48; observed-model-run.ts:24",
    "tests": [],
    "evidence": "The comment says a missing taskBudget keeps the exact legacy mapping. Both production callers pass it: execution-driver.ts:1220 (record.run.budget; RunSnapshot.budget is required at contracts/dispatch.ts:249) and query-execution.ts:525. undefined only serves old calls/tests; deadline===null is the current legal shape.",
    "action": "change: taskBudget required; delete undefined branch",
    "covered_by": null,
    "est_lines": 4,
    "spec_row": false,
    "confidence": "中"
  },
  {
    "id": "P2b-22",
    "category": "old-data",
    "file": "src/core/record-store/migrations.ts",
    "lines": "70-140,147-155; sqlite-record-store.ts:132,157-170",
    "tests": [],
    "evidence": "Open only checks the 4-table physical schema (columns, PK, affinity, extra NOT NULL); there is no database-level version marker. The DDL has never changed, so an old build's ledger passes the physical check and version errors surface only per record at record-codec.ts:320-330,668-670. rg checkRecordStoreSchema has no test. See section 3 for the 79-1 options.",
    "action": "user-decides",
    "covered_by": null,
    "est_lines": 0,
    "spec_row": false,
    "confidence": "高"
  },
  {
    "id": "P2b-23",
    "category": "allowlist-pre-batch",
    "file": "src/app/core-http-types.ts",
    "lines": "298-580 (60 aliases); src/app/main.ts:19-51 (2 types); production-reach-allowlist.json 62 entries",
    "tests": [],
    "evidence": "Each of the 62 names was rg'd over src/ and tests/: only the declaration matches. The route table binds port methods directly (core-routes.ts:160-260,1097-1177), and parseWorkbenchCliConfig(raw: unknown) never uses the two CLI types. These are pure leftover aliases with no reader and no old format. Plain Chinese: 这些只是旧路由批次起的 DTO 类型名，路由表和 UI 都不引用，等于没有读者的类型别名。",
    "action": "user-decides",
    "covered_by": "无测试引用；路由表/UI 不经过这些别名，删除不改行为",
    "est_lines": 91,
    "spec_row": false,
    "confidence": "高"
  },
  {
    "id": "P2b-24",
    "category": "allowlist-wire-format",
    "file": "src/app/core-http-types.ts",
    "lines": "393-496 (46 aliases); production-reach-allowlist.json 46 entries",
    "tests": ["tests/app/S4C-record-note-host.test.ts:26,177,233", "tests/app/S4C-note-routes.test.ts:17,46-48"],
    "evidence": "All 23 routes exist in the current core-routes.ts table and are called by src/ui, so the routes are current wire format. The aliases themselves have zero src references; rg each name hits only the declaration. 2 aliases have test readers (NotesListResponse, NotesWriteResponse). The other 44 are unreferenced, so the allowlist note 'its reader is the HTTP route boundary' is false for them (the table does not use the aliases).",
    "action": "user-decides: delete 44, keep NotesListResponse/NotesWriteResponse",
    "covered_by": "无 src 读者；2 个由 S4C 两个测试引用；路由本身由 core-routes.ts + src/ui 覆盖",
    "est_lines": 44,
    "spec_row": false,
    "confidence": "中"
  },
  {
    "id": "P2b-25",
    "category": "allowlist-kept-for",
    "file": "tests/architecture/production-reach-allowlist.json",
    "lines": "21 entries: role-spec.ts 10, validation/role.ts 3, role-material-channels.ts 5, human-role-collaboration.ts 1, architecture-inspection.ts 1, core/workspace/role-source-reader.ts 1",
    "tests": ["tests/data/workspace-path-boundary.test.ts:67,75,97", "tests/composition/R3d-R3g-platform.test.ts:71-130"],
    "evidence": "All 21 notes say 'kept for slice 3' (FileGraphPageV1 says slice 8). Slice 3 is merged and used none of the kept-for entries (slices/README.md:152). The still-valid reason is decision 6 ('角色规格保留、暂不接线，留给按含义挑成员', HANDOFF.md:783) and slice 7C (slice-7-SPEC.md:37,166); FileGraphPageV1 waits for the architecture page/E3 (E3-UI-ITEMS.md:328, slice-8-SPEC.md:173,330). install/activate RoleSpec is not production-reached: no route/tool calls it; only tests/composition/R3d-R3g-platform.test.ts:122 calls it through the platform port, so the entries must stay until production-reach walks port object bodies.",
    "action": "keep",
    "covered_by": "代码保留；note 改为决定 6/7C 与 E3；清单条目不能删（分析器仍判 unreached）",
    "est_lines": 0,
    "spec_row": false,
    "confidence": "高"
  }
]
```

## 3. record-store 开库版本提示（决定 79-1 的开放问题，只给选项）

先确认事实：`src/core/record-store/` 没有任何库级版本标记（`rg user_version|schema_version` 无命中）。`ledger.sqlite` 的 open 顺序是 `new DatabaseSync(path)`（`sqlite-record-store.ts:132`）→ `PRAGMA busy_timeout`（`:157`）→ `initRecordStoreSchema`（`:158`）→ `migrateLookupIndexes`（`:162`）→ `createSqliteTextScan`（`:166`）。`initRecordStoreSchema`（`migrations.ts:147-155`）只做 `CREATE TABLE IF NOT EXISTS` 四张表（`:17-21`）加逐列比对（`:70-140`）；四张表的 DDL 从旧适配器到今天没改过，所以**旧 build 写的库物理上通过检查、照常打开**，版本错误要到第一条记录读取时才出现（`record-codec.ts:320-330,668-670`；`sqlite-record-store.ts:547-550`）。另一个库 `artifacts.sqlite`（`create-platform.ts:685`，表在 `sqlite-body-store.ts:72-83`）同样没有版本标记。

三个选项（**不决定**）：

- **方案 A：`PRAGMA user_version`**。插入点 `migrations.ts:147` 的 `initRecordStoreSchema` 开头：先在 `db.exec(CORE_TABLE_DDL)` **之前**用同文件 `tableExists`（`:90-95`）记下 `events` 是否已存在；已存在且 `PRAGMA user_version` 不是当前值 → 抛一句“此数据库由旧版本建立，请删除后重建”；DDL 成功后写 `PRAGMA user_version = N`。成本约 10 行 + 2 条测试。风险：`user_version` 是文件级的，`migrations.ts:7-8` 说同一文件还可能有 `memory_*` 等别的表，若它们也用会互相覆盖；落地前必须核实。
- **方案 B：专用标记表**。在 `migrations.ts:147-155` 建 `next_schema_meta(key TEXT PRIMARY KEY, value TEXT)`，读写 `schema_version`；**写标记放在 `sqlite-record-store.ts:169` 之后**（`migrateLookupIndexes` 和 `createSqliteTextScan` 都成功之后），否则半初始化库会被误标成当前版本；读/判旧库仍在 `initRecordStoreSchema` 开头、DDL 之前判 `events` 是否已存在。成本约 15-20 行 + 3 条测试；库里已有 `next_text_meta` 这种自建表，不引入新概念。附带收益：标记落地后可删 `P2b-04`/`P2b-05` 的就地迁移和 `P2b-22` 的逐列 diff。风险：多一张表；标记行被删时旧库会被当新库（逐列 diff 可兜底）。
- **方案 C：库旁小文件**（如 `ledger.schema`）。插入点在 `create-platform.ts:678` 打开 backend 之前，或 `sqlite-record-store.ts:132` 之前；open 成功后写标记。成本约 15 行，不碰 SQLite schema。风险：标记与库可能不同步（复制/删除其一就误判）；`artifacts.sqlite` 要第二份。

共同点：区分“新库/旧库”必须在 `db.exec(CORE_TABLE_DDL)` **之前**判断 `events` 是否已存在（`migrations.ts` 已有 `tableExists`）。抛错形状照 `migrations.ts:151-153` 即可，上层 `sqlite-record-store.ts:170-177` 会关连接并原样抛出，Host 启动失败，一条消息就能到用户。

我的建议（不代替 lead 决定）：若希望“开库时一句话”，选 **B**；若不想新增表，选 **C** 但只用于 `ledger.sqlite` 并在文档写明；若接受现状（每条记录各自报 damaged），则保留 `checkRecordStoreSchema`、只把 `:151-153` 的错误文案改成“数据库由旧版本或不兼容程序建立，请重建”。按 79-1，**不做迁移**；加标记只是为了提示，不是为了兼容。

## 4. 类别小计

| 类别 | 条数 | 估计行数 |
|---|---:|---:|
| `old-data` | 14 | 443 |
| `legacy` | 7 | 262 |
| `n0` | 1 | 16 |
| `allowlist-pre-batch` | 1 | 91 |
| `allowlist-wire-format` | 1 | 44 |
| `allowlist-kept-for` | 1 | 0 |
| **合计** | **25** | **856** |

## 5. 覆盖说明与没定的事

**按关键词全量命中并逐条核过 writer 的文件**：`src/app/startup-reconcile.ts`、`main.ts`、`goal-fan-out-driver.ts`、`attention-observer.ts`、`host.ts`（`legacy`/`older`/route 段）、`host-settings.ts`；`src/composition/create-platform.ts`（`legacy`/`V1` 段）；`src/contracts/dispatch.ts`、`plan.ts`、`ledger.ts`、`verification.ts`、`query-job.ts`、`core/session.ts`、`core/prepared-execution.ts`、`run-activity.ts`、`goal-decisions.ts`；`src/business/workflow/contracts.ts`、`ports.ts`、`workflow.ts`（N0/V1/失败卡段）、`session-maintenance.ts`、`decision-actions.ts`；`src/core/record-store/migrations.ts`、`sqlite-lookup-indexes.ts`、`sqlite-text-scan.ts`、`body-codec.ts`、`body-ports.ts`、`sqlite-body-store.ts`、`record-codec.ts`（`:80-360,620-700`）；`src/core/agent-runtime/kernel-store-locator.ts`、`session-operations.ts`（legacy 段）、`source-capture-access.ts`、`observed-model-run.ts`、`exploration-tools.ts`、`run-reconcile.ts`、`context-assembler.ts`（plan/attention 段）、`run-limits.ts`；`src/ui/state/display-preference.ts`、`views/graphs/architecture.ts`、`node-link.ts`、`setup/panels.ts`、`views/execution/planning.ts`、`views/history/timeline.ts`；`tests/architecture/production-reach-allowlist.json` 全部 129 条非 work-graph 条目。

**只skim、没逐行通读**：`src/app/host.ts`（1637 行）、`collaboration-driver.ts`（1117）、`host-settings.ts`（909）、`workbench-tools.ts`、`server.ts`、`core-routes.ts`（1180）；`src/core/agent-runtime` 其余约 30 个文件；`src/core/workspace` 的 `capture.ts`、`git-read.ts`、`python-source-index.ts`、`cpp-source-index.ts`、`typescript-source-query.ts`、`project-source-snapshot.ts`；`src/core/record-store` 的 `in-memory-record-store.ts`、`commit-extensions.ts`、`lookup-index.ts`、`text-scan.ts`、`guarded-revision.ts`；`src/ui` 约 100 个文件中的纯渲染文件。以上按关键词扫读 + 导出符号扫读，未见额外旧格式读法。

**已核对、不按旧代码删**（避免误删）：`legacy_template`（`app/runtime-configuration.ts:221,240,282-311,432-436`、`composition/create-platform.ts:550-555,810-818`）是本地工作台当前 Role；`desiredStateRevision ?? 1`（`app/goal-fan-out-driver.ts:193,354-355,411,475`、`startup-reconcile.ts:441`）是当前 `newGoalSnapshot` 故意写的形状（见 P2b-17 的两种处理）；`host-settings.ts:291-297,424-426,455-460,511-513` 的 `automation?`/`resourceCaps?` 当前新文件也缺省；`contracts/goal-decisions.ts:51` 的 `kind:'legacy'` 通知位置现在仍由 `decision-read-model.ts:1566`、`automatic-rework-notices.ts:527` 在 `since:null` 时产出，不能按旧数据删；`app/host.ts:1568-1571` 的 “older route table” 只是注释，路由已声明（`core-routes.ts:228,876-878,1157`）；`ui/views/execution/planning.ts:154`、`views/history/timeline.ts:250` 的 `schemaVersion!==2` 是对当前提示词/契约的边界校验（`query-preparation.ts:50`、`initial-planning.ts:56-57`）；`record-codec.ts:757,812` 的 “legacy idempotency row” 是当前唯一物理格式，不是旧版本。

**c1-transfer**：本区 0 条。C1 转来的 `track-read-model` 旧游标、`TaskClaimOutbox` 重复形状、`TaskDispatchStateV1` 别名都在 `src/core/work-graph/`（P2a）；N0 的 Workflow 目标输入已按 85-4 列为 P2b-10。**n0** 只有 P2b-10。

**没定**：① `P2b-14` 的 `QueryJobIntentV1.execution` 缺省是否还要给“无角色的纯查询”留 wire 形状（需 lead 核产品）；② `P2b-16` 没找到专钉兼容分支的测试，删除前要在 `tests/business/` 再扫手造 `response.decision` 的 fixture；③ `P2b-19` 跨 P2a，回填读器本体在 `core/work-graph/tasks/session-provenance-facts.ts`、`state/session-availability.ts:501,615,1006`，按约定未动；④ `P2b-22` 的三案只给选项，未决定；⑤ `P2b-17` 是“改新记录字节”而非删旧格式，若 lead 不愿改则按 keep；⑥ `P2b-24` 与 part1 的 keep 意见不同，我按“别名在 `src/` 零引用”判 44 条可删、2 条保留，交 lead 定。未跑任何测试/构建，以上“删了仍通过”的判断来自测试文件自身说明，没有实跑验证。
