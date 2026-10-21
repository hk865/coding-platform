# 规模测试拆分回复（2026-10-21，sc-base = 20afbfa）

两个提交：`105ba68 SC1 page widths and the scale batch`、`efa2303 SC2 scale tests split`。
`git diff --shortstat sc-base HEAD` = 45 files changed, 2370 insertions(+), 409 deletions(-)。

## 1. SC1：机制与页宽接缝

### 1.1 机制文件

- `vitest.config.ts`：`exclude` 增加 `'tests/**/*.scale.test.ts'`，其余不动。
- `vitest.scale.config.ts`（新，10 行）：与日常配置相同的 environment/include 语义，`include: ['tests/**/*.scale.test.ts']`，默认 exclude，`testTimeout: 30_000`。
- `package.json`：新增 `"test:scale": "vitest run --config vitest.scale.config.ts --maxWorkers=1"`，`test` 原样保留；两个 lock 文件未动。
- `tsconfig.json`：`include` 增加 `vitest.scale.config.ts`。
- CI、`scripts/verify-isolated.mjs`、`scripts/check-boundaries.mjs` 未改。

### 1.2 接缝（参数默认值 = 原常量；生产组合根不传，保持默认）

- **A**：`src/core/work-graph/persistence/lookup-all.ts`，`lookupAll(records, index, values, options?: { pageLimit?: number })`，默认 200（`LOOKUP_PAGE_LIMIT`）。测试装配路径：`tests/helpers/S5-application-support.ts` 的 `owners(f, records, bodies, widths)`（`widths.decision.lookupPageLimit`）→ `createDecisionReadModel` 的两个 `lookupAll` 调用与 `createGoalConflictAssembler.lookupPageLimit`（Goal 列表，`views/goal-conflicts.ts`）；`tests/helpers/S2A-queue-fixture.ts` 的 `readGoalQueue/readWorkspaceQueue(..., widths)` 转发给 `owners`；CRR 经 `taskRequestPageLimit`（见 D）。
- **B**：`views/decision-read-model.ts` 的 `DecisionReadModelDependencies.sourcePageLimit`、`lookupPageLimit`，均默认 200。注入路径：`owners(..., { decision: { sourcePageLimit, lookupPageLimit } })`。
- **B′**：`tasks/plan-readers.ts` 的 `enumerateGoalCandidates`、`enumerateClosedGoalCandidates` 第三参数 `options?: { lookupPageLimit?: number }`；`readLookupKeys` 第四参数 `limit` 默认 200。`decision-read-model.ts` 顶部两个窄化别名 `enumerateCandidates`、`enumerateClosedCandidates` 增加第三参数，并在 live 与 closed 两个调用点传 B 的 `lookupPageLimit`。Run lookup（接缝 H）未动。
- **C**：`tasks/planning-question-reader.ts` 的 `PlanningQuestionReaderDependencies.lookupPageLimit`，默认 200。注入路径：`owners(..., { planningQuestion: { lookupPageLimit } })`。
- **D**：`tasks/command-rerun-request-service.ts` 的 `CommandRerunRequestServiceDependencies.taskRequestPageLimit`，默认 200；同时到钩子/列表读的 `onePage(..., taskRequestPageLimit, ...)` 和请求工具 `readTaskRequests` → `lookupAll(..., { pageLimit })`。公开 `page.limit` 1..200 校验仍用 `MAX_PAGE_LIMIT`。注入路径：`tests/helpers/B2-401-world.ts` 的 `openB401World({ taskRequestPageLimit })`。
- **E**：`views/automatic-rework-notices.ts` 的 `AutomaticReworkNoticeSourceDependencies.orderedPageLimit`，默认 200；沿 `readAutomaticReworkPage` 传入 `readOrderedToEnd`（requeue 与 reverify 两条）。注入路径：`tests/helpers/S2A-notices-support.ts` 的 `automaticRework(f, countOrdered, orderedPageLimit)`。
- **F**：`views/context-extensions.ts` 的 `ContextExtensionsDependencies.decisionPageLimit`，默认 100；只用于 decision-queue 分页 `page.limit`，同文件 anomaly 的 100/25 预算未动。注入路径：`tests/work-graph/WP2-context-extensions.test.ts` 本地的 `createContextExtensionsReader({ ..., decisionPageLimit })`。
- **G**：`views/undelivered-reply-notices.ts` 的 `UndeliveredReplyNoticeSourceDependencies.readPageLimit`，默认 100；同时用于 Session 目录和 `readUndeliveredReplies` 两层（没有拆成两个宽度，因为小例不需要区分两层）。注入路径：`tests/helpers/S2A-notices-overbound-fixture.ts` 的 `buildOverboundNoticesWorld({ readPageLimit })` 与 WP2 测试里的 `smallFactory`。
- **I**：`views/work-line-reader.ts` 的 `WorkLineReaderDeps.lookupPageLimit`（默认 200）、`listPageLimit`（默认 100）。注入路径：`tests/helpers/S2C-X-scale-fixture.ts` 的 `realDeps`，`fixture.reader` 与 `readerWith` 都走它。

### 1.3 接缝 I 的字面量台账

改动（sc-base 行 → 当前行，旧值 → 新名，均为读到末尾的循环）：

- 702→713，`200`→`lookupPageLimit`：open responsible links。
- 1300→1312，`200`→`lookupPageLimit`：active copies。
- 1419→1433，`200`→`lookupPageLimit`：continuation successors。
- 1572→1588，`200`→`lookupPageLimit`：active Session 列表。
- 1915→1935，`100`→`listPageLimit`：anomaly-by-session anchors。
- 1982→2004，`100`→`listPageLimit`：RUN_BY_TASK pickup-Run。
- 2049→2072，`100`→`listPageLimit`：undelivered replies 计数扫描。
- 2095→2119，`100`→`listPageLimit`：work-line 内 decision queue 循环。
- 2402→2429，`100`→`listPageLimit`：verification-round-by-task。
- 2751→2780，`100`→`listPageLimit`：line undelivered 扫描。

保留（理由）：

- 804→815 `limit: 100`：anomaly 扫描带 25 页预算，不是读到末尾的宽度。
- 434→444、1095→1107、1120→1132、1232→1243、1365→1377、2615→2643、2623→2651、2635→2663、2639→2667 的 `limit: 1`：单个 head 读。
- 986→997 `limit: 21`：closed-task history 的固定窗口。
- 1639→1656 的 `limit` 变量：archive 列表的公开 `page.limit`，archive 不是接缝。
- 2514→2541 `VERIFICATION_ROUND_CHAIN_LOOKUP_LIMIT`：有语义的链读常量。
- 所有 `direction: 'desc'` 的 head 读：单读。
- 未发现额外的 `limit: 200` / `limit: 100` 循环字面量。

补充：初始 SC1 漏了 inventory A 行点名的 Goal 列表（`goal-conflicts.ts:123`）；复核时发现，已在 SC1 提交内补上 `GoalConflictAssemblerDependencies.lookupPageLimit`、`listWorkspaceGoals` 第三参数和 `owners` 的转发，并 amend 进同一个 SC1 提交。

## 2. SC2：逐文件

### 2.1 `tests/work-graph/S2A-notices-overbound.test.ts`

- 移入：QA-10(ii)（5,001 目录 Session / 5,001 回复 / 5,001 成员通知）整例逐字进 `.scale.test.ts`，原常量、后端循环、`S2A_SCALE_TIMEOUT_MS` 不动，无宽度注入。
- 小版本：5/5/5，所有内/外层宽度 2。
  - 目录层（G，宽 2）：整个工作区目录 = 基础夹具 2 个 Session + 新建 5 个 + responder = 8 条；手写顺序 `[created-00004, created-00002]`、`[base session-second, responder]`、`[base session-s, created-00003]`、`[created-00000, created-00001]`，8/2 = 4 页，唯一 unavailable 的 `created-00001` 在最后一页。
  - 回复层（G，宽 2）：5 条按 message refKey 顺序，5/2 = 3 页（2,2,1），尾回复最后。
  - 成员通知层（B，宽 2）：5/2 = 3 页；undelivered source 层（B，宽 2）：5/2 = 3 页；外层队列（limit 2）：10/2 = 5 页。
- 接缝：A、B、G。
- fixture 参数：`buildOverboundNoticesWorld` 增加 `readPageLimit`（默认 100）和 `replyOrder`（默认 `'creation'`，保持原提交顺序）；`noticesHarness` 增加 `{ sourcePageLimit, lookupPageLimit }`。
- 用时：1,380.9 s → 0.325 s（2 个测试；整文件）。

### 2.2 `tests/work-graph/S2A-queue-derived-cards.test.ts`

- 移入：QA-07、QA-09(i)，共用一个 5,001 QueryJob 的 `beforeAll`；原尺寸、后端、超时不动。
- 小版本：5 个 planning job，queue `page.limit` 2，decision source/lookup 2，planning lookup 2。
  - planning 枚举 5/2 = 3 页（2,2,1）；queue 5/2 = 3 页（2,2,1）；direct card 的 source 读也按 2 分页 3 页。
  - QA-07：`waitingAnswer` = 5，全部 `planning_question`，最后一张 `S2A-PQ-00004` 直读成功。
  - QA-09(i)：字面量 `S2A-PQ-00004` / `S2A-PQ-answer-00004`（最后一页），断言完整 card 形状。
- 接缝：B、C。
- fixture 参数：无新增（`buildPlanningQuestions(f, count)` 原本就有 count）。
- 用时：1,100.8 s → 0.320 s（4 个测试）。

### 2.3 `tests/work-graph/S2C-lines-scale.test.ts`

- 移入：2C-25 (1)–(4) 四例整文件逐字进 `.scale.test.ts`（连 imports/beforeAll/常量/超时），仍用 `buildScaleFixture(kind)`，无宽度注入。
- 小世界：12 个 active head（1 starting + 1 pair successor + 6 named + 2 base + 2 filler；working 1、standby 11）、1 个 active predecessor、3 个 active copy、5 个 archived head、X 3 条 responsible link（1 task + 2 module）、R 8 条消息（最后 2 条已回复）、W 4 个 anchor（3 picker + 1 pending）、Z 3 个 Run；`lookupPageLimit` / `listPageLimit` = 2，archive 公开 `page.limit` = 2。
- 手算：
  - (1) 归档公式 S=5、F=1、A=1 → 5−(1−1)=5；active 16 条 → 8 页；copies 3 → 2 页；X responsible 3 → 2 页（[task+module], [module]）。
  - (2) archived 5 条按受控时钟 00:00:00–04 降序，`page.limit` 2 → 页序 [4,3]、[2,1]、[0]，共 3 页；期望顺序为手写，不从 store 回读 `archivedAt`。
  - (3) 默认预算 100：R = 1 空 anchor 页 + 4×(source + continuation probe + message page) = 13；W = 2 anchor 页 + 3×(lookup + 2-Run read) + (lookup + 1-Run read) = 13，均未耗尽；R exact 2、W exact 1。
  - (4) 预算 10：R 1+3+3+3=10，第 4 页被拒，两条回复都在第 4 页 → partial（atLeast 0）；W 2+3+3+3+2=13>10 → written_anchors partial、attention null、unknown 0；Z 的共享 T* 读不受该预算 → 不变。
- 接缝：I。
- fixture 参数（`ScaleFixtureOptions`，默认均为今天的值）：`activeHeads` 1100、`startingHeads` 100、`activePairs` 50、`activeCopies` 100、`archivedHeads` 2750、`archivedPairs` 500、`archivedCopies` 500、`xParticipates` 2099、`xResponsibleModules` 0、`workTasks` 100、`rMessages` 2500、`wAnchors` 30、`zRuns` 2999、`lookupPageLimit` 200、`listPageLimit` 100，以及 `archiveClock`（缺省 = 真实时钟）。
- 用时：961.2 s → 0.699 s（8 个测试）。

### 2.4 `tests/work-graph/S2A-queue-bounds.test.ts`

- 移入：QA-04、QA-05、QA-06 三例整文件逐字。
- 小版本：宽度 2。
  - QA-04：5 条成员消息 + 3 waiting + 2 answered；成员消息不进用户索引，用户索引为夹具自带 2 条 + 新建 5 条 = 7 条 → 2,2,2,1 共 4 页；分类仍 3/2，card key 集合不变。
  - QA-05：5 张等待卡，外层 `page.limit` 2 → ceil(5/2)=3 页（2,2,1），第 5 张在最后一页；用户消息扫描 7 条 → 4 页。
  - QA-06：夹具 3 个 Goal + 新增 2 个 = 5 个，Goal 列表宽度 2 → 3 页（2,2,1）；“决定性项最后”不适用，保留 B 的 cause card、计数和“新增 Goal 不产生卡”的断言。
- 接缝：A、B。
- fixture/helper：`populateGoals` 的 count 由 `200 | 201` 放宽为 `number`；`readQueue` 增加可选 `OwnerReadWidths` 并转发 `owners`。
- 用时：582.5 s → 0.608 s（6 个测试）。

### 2.5 `tests/runtime/B2-401-world.test.ts`

- 移入：B2-16、F-032、B2-18 三例整文件逐字进 `.scale.test.ts`；R=401、默认宽度、原断言和 1,200,000 ms 超时不动。
- 小版本：共享小世界 R=5，`taskRequestPageLimit` 2、请求路径 lookup 宽度 2 → ceil(5/2)=3 页；任务页 `limit` 为 [2,2,2]，记录数为 [2,2,1]，唯一 allow（第 5 条）在最后一页且是该页唯一记录。B2-16：3 次任务页读、1 次 closure 读；F-032：第 5 条命令被允许，随后经公开读回 `used`；B2-18：第 6 条请求仍读 3 页，不读别的 CRR 索引/点读，只写 1 条 CRR。
- 接缝：D（+ 请求路径上的 A）。
- fixture 参数：`openB401World({ runs = 401, taskRequestPageLimit = 200, lookupPageLimit = 200 })`；`lookupPageLimit` 是计数 `lookup` 包装的一页上限（默认 200 = 原字面量）。
- 用时：499.0 s → 0.778 s（3 个测试）。

### 2.6 `tests/app/S2A-decision-routes.test.ts`

- 移入：QA-14(a) 逐字进 `.scale.test.ts`（原 5,001 `beforeAll`、常量、超时）。QA-14(b) 不复制进 scale；日常文件里改成小世界版本。
- 小版本：5 张卡，route `page.limit` 2、owner 宽度 2 → ceil(5/2)=3 个路由页（2,2,1）；用户消息扫描为夹具 2 + 新建 5 = 7 条 → 4 页。成功与失败绑定用同一组宽度（`owners(f, f.records, f.bodies, widths)` 与 `owners(f, failingReadRecords(f.records), f.bodies, widths)`）。
- 接缝：A、B。
- fixture 参数：无新增。
- 用时：337.0 s → 0.307 s（4 个测试）。

### 2.7 `tests/work-graph/unknown-call-review-list.test.ts`

- 移入：只移 205 条记录那个 `it.each`（memory + sqlite，`limit: 200`，600,000 ms）逐字进 `.scale.test.ts`。
- 小版本：5 条真实 blocked Run 记录，`page: { limit: 2 }` → 2,2,1 共 3 页；第三次读的 `nextCursor === null`（原例在第二页后断言结束，这里对应第三页结束）。两个后端。
- 接缝：已有公开 `page.limit`，无新生产参数。
- fixture 参数：无。
- 用时：226.0 s → 3.083 s（11 个测试）。

### 2.8 `tests/work-graph/S2A-queue-request-candidates.test.ts`

- 移入：QA-09(ii) 整例逐字（5,001 候选）。
- 小版本：3 个候选（`S2AQ09-0..2`，最后一个 live），宽度 2。
  - direct card 经 A：请求索引含夹具 U1 + 3 个 = 4 条 → 2 页（2,2）。
  - queue 的候选枚举经 B′：Goal B 含 U1、U2 + 3 个 = 5 条 → 3 页（2,2,1）；live 的 `S2AQ09-2` 排在最后、在最后一页，direct 与 queue 结果相等。
- 接缝：A、B′。
- fixture/helper：`populateGoals` 放宽为 `number`；`readQueue(..., widths)` 可选转发。
- 用时：180.7 s → 0.231 s（2 个测试）。

### 2.9 `tests/work-graph/S5R2-queue-history.test.ts`

- 移入：R2A07/08（201 Goals）和 R2A09（5,001 卡）逐字进 `.scale.test.ts`；其余 17 例留在日常文件。
- 小版本：
  - R2A07/08：5 个 Goal，lookup 宽度 2 → 3 页（2,2,1）；保留 storeSnapshot/allocationCounts 只读断言和零模型断言。
  - R2A09：5 张卡，`page.limit` 2 + 宽度 2 → 3 页（2,2,1）；只跑 memory（原例 memory-only），保留零模型/读不写。
- 接缝：A、B。
- fixture/helper：`populateGoals` count 放宽；`readQueue` 可选 widths。
- 用时：131.7 s → 1.498 s（19 个测试）。

### 2.10 `tests/work-graph/WP2-undelivered-notices.test.ts`

- 移入：M07（5,000 与 5,001 回复）逐字进 `.scale.test.ts`，memory-only 保留；其余 23 例留在日常文件。
- 小版本：4 条和 5 条回复，所有内/外层宽度 2。
  - 内层回复 4/2 = 2 页（2,2）；5/2 = 3 页（2,2,1）。
  - 外层 source `limit: 2` 得到同样的 2 / 3 页；目录层 3 个 Session / 2 = 2 页（2,1）。
- 接缝：G。
- fixture 参数：无新增（`openWP2NoticesFixture(kind, factory)` 本来接收 source factory；测试里的 `smallFactory` 传 `readPageLimit: 2`）。
- 用时：111.4 s → 0.904 s（24 个测试）。

### 2.11 `tests/work-graph/S2A-notices-attempt.test.ts`

- 移入：L11（201 requeue）整例逐字。
- 小版本：3 个 requeue；ordered 宽度 2、source 宽度 2。
  - ordered 层 3/2 → 页 2,1，恰好 2 次 ordered 读（一次组装）；若按每个 source 页重建会变成 2×2=4 次。
  - source 层 3/2 = 2 页；外层 `limit 2` 只带 3 条中的前 2 条，count 仍为 3。
- 接缝：B、E。
- fixture/helper：`automaticRework` 增加 `orderedPageLimit`（默认 200）；`noticesHarness` 增加 A/B 宽度参数。
- 用时：91.1 s → 0.278 s（2 个测试）。

### 2.12 `tests/work-graph/WP2-context-extensions.test.ts`

- 移入：F07 tail（100 候选）的 `it.each` 与 F07 5,000/5,001 那例逐字进 `.scale.test.ts`，连同本地 `realDecisionQueue`、`openDecisionHarness`、`sendDecisionRequest`、`openDeferredDecisionHarness`、`anomalyDouble` 和 hooks 的逐字副本；其余 7 例留在日常文件。
- 小版本：
  - F07 tail：4 个候选 + 真实世界的 `change_pending` 与 `required_task_deferred` 两个 goal_cause = 6 张 waiting 卡；`decisionPageLimit` 2 → 页 2,2,2，Task 卡在最后一页。source/lookup 2；B′ 的 5 条 proposal 记录（4 候选 + U1）→ 2,2,1 共 3 页。保留三种 focus 读法与字面 row-key 顺序（9 行）。
  - F07 5,000/5,001：4 条真实请求 + 夹具 4 张 = 8 张 waiting → 4 个队列页（2 条/页）；8 + 4 条 hint = 12 行。再加 1 条 = 9 张 waiting → 5 页（2,2,2,2,1）；9 + 4 = 13 行。消息扫描经 A 宽度 2 跨页。
- 接缝：F、A、B′。
- fixture/helper 参数：`realDecisionQueue` 增加 widths；`openDecisionHarness` 增加 widths；`openDeferredDecisionHarness` 增加 `candidateCount`（默认 `F07_CANDIDATE_COUNT` = 100）和 widths，默认均为生产值。
- 用时：84.0 s → 0.602 s（10 个测试）。

## 3. 检查

- `flock ./.typecheck.lock npm run typecheck`：exit 0（`tsc --noEmit -p tsconfig.json`）。
- `npm run check:architecture`：exit 0，尾行 `next source boundaries: OK`。
- `npm run build`：exit 0（`tsc -p tsconfig.build.json`）。
- 日常 12 个文件：12/12 文件、95/95 测试通过；每文件用时（vitest summary）：overbound 325 ms、derived-cards 320 ms、lines 699 ms、queue-bounds 608 ms、B2-401 778 ms、decision-routes 307 ms、unknown-call 3,083 ms、request-candidates 231 ms、S5R2 1,498 ms、WP2-undelivered 904 ms、notices-attempt 278 ms、WP2-context 602 ms。
- 所有 SC1 触到的 owner 的现有测试：close-out 跑了传递闭包 441 个文件（排除 12 个 scale 文件）；385 个文件通过 / 56 个失败，3,618 个测试通过 / 156 个失败 / 29 个跳过。156 个失败全部是环境：本机没有 `/usr/bin/bwrap`，表现为 `ENOENT ... bwrap`、`run_check ... unsupported`，或由此引起的 waiting/verifying/stopped、`busy: ... round is open`、check-begin timeout 等下游断言。没有发现真实的拆分破坏；close-out 未改任何文件。失败文件按目录：app（A2-automation-verdict、A2-requeue-route、A2-reverify-route、AG2b-collaboration、R6-host、orchestration-mechanism）；business（R5b-initial-planning-workflow）；composition（A2-requeue-platform、A2-reverify-platform、A2-verification-chain-platform、R3e-command-check-platform、R3e-completion-platform、R5c-workflow-platform、S2B-be1s-shell、S8A-L8-pass-capture）；runtime（S5-user-message-tools）；scenarios（A1-rework-same-session、A10-check-recovery、A11-no-progress、A4-duplicate-receipts、A7-control、A7-control-goal29、A8-host-restart 及其 attestation/entry/lease/paused/rework、C3-*、C5-*、C6-unrelated-adoption、C7-*、C8-*、K3-07-real-host-kill、K3-29-disposition-recovery、K3-44-recovery-answers、S1-archive-restart、S2C-K-archive-tags-checks、S5-goal-conflict-rework、WP1-wiring、harness）；state（invariants、invariants-fuzz）；work-graph（A2-disposition-change、A2-verification-chain、S3-context-inputs、S4C2-goal-triggers、W1-future-plan）。这些请在有 bwrap 的环境复跑。
- `npx vitest list --config vitest.scale.config.ts | wc -l` = 38 个用例，12 个文件：`tests/app/S2A-decision-routes.scale.test.ts`、`tests/runtime/B2-401-world.scale.test.ts`、`tests/work-graph/{S2A-notices-attempt,S2A-notices-overbound,S2A-queue-bounds,S2A-queue-derived-cards,S2A-queue-request-candidates,S2C-lines-scale,S5R2-queue-history,WP2-context-extensions,WP2-undelivered-notices,unknown-call-review-list}.scale.test.ts`。
- `npx vitest list 2>/dev/null | grep -c '\.scale\.test\.ts'` = 0。
- `node ./.dsh-ref/scale-move-check.mjs sc-base HEAD > ./.dsh-ref/out/move-check.txt`：exit 0；最后一行 `pairs 12; cases at sc-base 67; cases not found 0; items to review 0; OK`。0 条 review 行：所有原 hook、describe 头、顶层语句和 import 都能在 daily 或 scale 文件中逐字找到（scale 文件保留了原常量/后端/默认值）。
- 未使用 `skip` / `todo` / `.only`；日常文件没有新增或抬高 timeout。唯一保留的原有大 timeout 是 `S2A-decision-routes` 的 `S2A_SCALE_TIMEOUT_MS`（与 sc-base 相同，小世界实际 <1 s）；保留它是为了让 QA-14(b) 的原用例文本继续逐字存在于日常文件，move check 才能找到。
- 事实规则：没有新增手写事实。新的 store 访问只有 S2C-X 夹具为公开 catalog revision 的 `expected` 读并解码 Project 记录（与既有 `workspaceSnapshot` 同类的夹具管道）；其余 `commit(`/`encode...Record`/scripted model 都是 sc-base 已有的例外。夹具默认值全部等于今天的值（B2-401 401/200/200；overbound 100/`'creation'`；S2A notices 200/200；S2C-X 13 个尺寸参数 + `archiveClock` + 200/100 两个宽度），没有默认值被改小。

## 4. 书里可以修正的地方 / 备注

1. **QA-10 的“e.g. 5 sessions”不是整个目录的条数**：目录还包括基础夹具的 2 个 Session 和 responder，实际 8 条；宽度 2 时是 4 页而不是 3 页。小版本已按 8 条手写完整顺序，并把唯一 unavailable Session 放最后。
2. **QA-04/05/14 的“消息扫描 3 页”少算了夹具自带的 2 条用户消息**：7 条 / 2 = 4 页。小版本注释和断言按 4 页写。
3. **QA-09(ii) 的“B′ 2 页”只算了 3 个新候选**：Goal B 还有夹具的 U1、U2，实际 5 条 → 3 页；direct A 是 U1 + 3 = 4 条 → 2 页。小版本按这个算，live 的 `S2AQ09-2` 仍在最后。
4. **F07 tail 的“5 候选 + Task = 6 张 waiting 卡”漏了 Goal 级的 `change_pending` goal_cause**：5 候选会是 7 张/4 页。Group C 用了 4 个候选，保持 6 张/3 页、Task 卡在最后一页；三种 focus 读法都保留。
5. **2C-25 的 X responsible 链接**：生产只读 `responsible` 关系，合法的非 task 目标是 module；小世界为了跨两页，用公开 `reviseArchitectureCatalog` 增加了 2 个 module（`xResponsibleModules` 默认 0，没有手写事实）。W 的每个 task 的 entered-Run 读在宽度 2 下仍是 1 页；跨页的是 anchor 层本身。
6. **B2-18 的小世界 requestId**：第 6 条是 `b2-401-request-006`；fixture 内部 continuation claim id 仍是 `b2-401-claim-402`（未改，避免动原 helper 的冻结文本）。
7. **SC1 初始实现漏了 Goal 列表的 A 接缝**（`goal-conflicts.ts`，inventory A 行已点名）。复核时补上并 amend 进 SC1 提交 `105ba68`；不是书的问题，记录一下以免 lead 以为 A 只有 decision-read-model 和 CRR 两处。
8. **M07 是 memory-only**：小版本保持 memory-only（原例就没有 sqlite），没有为了“两个后端”硬加 sqlite。
9. **没有 HANDOFF**：SC1、SC2、close-out 都完成；除上面列出的 bwrap 环境失败外，没有停早或半完成项。`.dsh-scratch/` 已删除。
