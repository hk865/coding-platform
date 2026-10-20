# T W1 rework 1 reply (W1R1) — paused handoff

> 本回合在 typecheck 绿之后被 runner 暂停（handoff:context）。三个 worker（fixtures、runtime/R4c、graph/context）在暂停时被停止，未回报。下表的 `半成品` 是它们留在工作树里的未验证改动；`未施工` 是尚未开始。

## 1. 逐行

| 编号 | 结果 | 改了哪些文件 | 备注 |
|---|---|---|---|
| W1-01 | done | `src/app/startup-reconcile.ts`、`src/app/goal-fan-out-driver.ts`、`src/business/workflow/workflow.ts`、`src/composition/create-platform.ts`、`src/core/agent-runtime/{context-assembler,continuation-brief-assembly,execution-driver,execution-observation,run-reconcile,runtime}.ts`、`src/contracts/run-activity.ts` | 删除 `startingEntryOf` 的 `legacy` 返回/文档/上报分支；TP-060 列出的 16 处 V1 收窄改为只看授权是否存在；`run-reconcile` 无授权路径的 `V1/none` 行文本保留（行为不变）。`rg` 未找到 legacy 分类的测试，故没有测试可删。 |
| W1-02 | done | `src/core/work-graph/model/session-contracts.ts`、`sessions/session-record-codecs.ts`、`sessions/session-directory.ts`、`state/session-availability.ts`；测试 `tests/work-graph/S1-codecs-indexes.test.ts`、`tests/state/session-availability.test.ts` | `SessionOperationRecord.action.provenance` 必填非空，codec 拒绝缺失/null；`createSessionRecord` 直接复制，内部 fallback 删除；公开 admission 省略输入的默认仍在。写 operation 的 writer 只有 `session-directory.ts:771`（accepted）与其 `:969` 展开（completed）。 |
| W1-03 | done | `src/core/work-graph/state/run-machine.ts` | 删除 RUN-09..11 `R` 来源说明，改成 RUN-16 同 commit 结算的说法（`:20`、`:412`、`:930`、`:1931`、`:2202`）。 |
| W1-04 | done | `src/core/workspace/typescript-source-query.ts` | 删除 `ProjectSourceIndex` 注释，保留 frozen snapshot 句。 |
| W1-05 | done | `tests/data/typescript-source-query.test.ts` | 新增 real files 的 repeat/add/rename/edit 四组增量断言；未恢复旧 index 类。 |
| W1-06 | done | `tests/app/project-source-tool.test.ts` | 名称 + 四个注册值（`read_only`、`workspace_read`、60000、65536）移入现有 frozen 用例。 |
| W1-07 | done | `tests/scenarios/S3-context-and-inputs.test.ts` | 记录 tA 结束后的请求数，取 tB 首个请求的当前 turn 最后一条 user 消息查 `## Goal`。 |
| W1-08 | done | `tests/work-graph/R3c-plan-adoption.test.ts` | 恢复 delegating lookup gate：读到旧页后真实 claim/prepare/start implement，再返回旧页；恢复 gate 触发与 graph 断言。 |
| W1-09 | done | `tests/work-graph/S3-prepared-context-admission.test.ts` | AD03 移入 `describe('rejects: …')`；拒绝输入改成 tA 的真实 prepared（`secondPin`），保留 `idempotency_conflict` 与零 commit。 |
| W1-10 | BLOCKED | — | WF01 无公开原因：Goal 创建后没有任何公开路由/owner 改 objective/workspaceId（`src/contracts/graph-context.ts:181-190`、`src/core/work-graph/tasks/task-service.ts:177`、`src/app/core-routes.ts:377,440,473-474`；settings/control/reorder 都保留内容字段，`goal-settings-machine.ts:233-235`、`goal-control.ts:186-210`）。WF02 的公开原因存在（prepare 后公开采纳新 Plan revision），但按 R-5 整行保留原形态，见 §9.2。`WP1-start-refusal` 2 passed。 |
| W1-11 | done | `tests/app/A2-continuation-projection.test.ts` | 四处改成 `workflow/advance` 单次调用；启动链仍用 `driveWorkflow`。 |
| W1-12 | done | `tests/composition/platform.test.ts` | 未知 kind 移入 `describe('rejects: …')`，公开 `queryGoal` 前后对比，保留 `unsupported` 与双后端。 |
| W1-13 | done | `tests/helpers/C1-mailbox-fixture.ts`、`tests/helpers/S2B-runtime-steps-fixture.ts` | 真实 prepare/start，model 请求停在 A3 gate；删除手造 running/entered seed 与其 `consumerId` 改动。共享 helper 加 `host` grant 与 `withMailbox`，让 C1 用自己的 Host 配置/tools。C1 50、C2 7、A2 4、C1-comm 12、K3-39 16 全过；最终 8 文件 77 passed。 |
| W1-14 | done | `tests/helpers/S1-session-facts-fixture.ts` | 删除 `createLegacySession`；保留 `plannedSession`（其他测试仍用）。 |
| W1-15 | BLOCKED | `tests/helpers/S2B-track-fixture.ts`（已回退 `w1-merged`，只留 W1-37 注释） | 真实 end 会写 terminal RunActivity（`src/core/work-graph/tasks/execution-entry-service.ts:1921-1931`），L8 backfill 不替换 current-rule counted 记录（`src/core/work-graph/tasks/run-activity-service.ts:159-163`），保留的手算 activity 值无法在真实 finish 后成立。尝试时 20 failed（S2B-30 2、S2B-34 16、S2B-r2-27 2）；回退后 10 文件 82 passed；`w1-merged` 基线 4/4 过。 |
| W1-16 | done | `tests/work-graph/S2B-32-task-timeline-fold.test.ts`；恢复 `tests/work-graph/S2B-r2-s-preentry-control.test.ts` | 恢复 r2 公开流程用例与五段断言；删除 fold 中重复用例与死导入。 |
| W1-17 | done | `tests/helpers/S5-decision-fixture.ts`、`S5-queue-support.ts`、`S2A-planning-fixture.ts`、`tests/business/K3-46-review-advance-failures.test.ts`、`K3-UR7-crr-failed-set.test.ts`、`tests/runtime/S5-user-message-tools.test.ts` | 删除 fixture-only `builder→decisionDuty` 映射；发送 Session/Plan assignment/Run binding 用生产的 `platform-adviser/s3.1` 正式模板，生产 match 未动。修好 RA 变 adviser 后 3+2 个 importer 的 role binding 不匹配，以及 mailbox grant 只接受单一 Host 模板的问题。S5/S2A 各集合全绿。 |
| W1-18 | done | `tests/helpers/S5-queue-support.ts` | 期望值改成 `:288` 手写的 `policyRef`。 |
| W1-19 | done | `tests/helpers/task-claim-fixture.ts` | Query manifest 改从真实 materials owner 读取。**R-6**：`usage:'current'` 对 Host ctx 固定返回 `source_stale`（`src/core/work-graph/materials/applicability.ts:39`），改用 `historical_explanation`；仍是真实公开读取。 |
| W1-20 | done | `tests/runtime/source-binding-migration.test.ts` | 同一真实 submission 用例在 memory/SQLite 双后端跑；捕获平台唯一的真实 backend，A3 gate、initiator 与 read-count 断言不变。8 passed。 |
| W1-21 | BLOCKED | — | 保留 wave-1 单段形态。要得到 `[TASK_ID, TASK_ID]` 需要两个 segment 各有一条同 Task 的 Work claim，第二条 claim 前必须把第一条 Run 真实结束/requeue；本文件没有 Runtime 启动/结束链，公开 `sessions/create` 只能造 continuation 关系。 |
| W1-22 | done | `tests/runtime/K3-34-tool-name-constants.test.ts` | 期望总数改为手算字面量 15（3 builtin + edit + check + 10 exploration，已扣 `project_index`）。 |
| W1-23 | done | `tests/scenarios/K-W-workflow-close.test.ts` | 删除 KA-07（已并入 `WP1-wiring.test.ts`）。 |
| W1-24 | done | `tests/state/run-machine.test.ts` | 恢复 `[EV.begin, CLAIMED]` 用例及原 code/detail。 |
| W1-25 | BLOCKED | — | 保留 raw `runA` seed。真实 upstream Run 需要完整 Runtime（Session→claim→prepare→start→scripted end），本文件的 owners 不含这条链；AD 的 kernel session 也没有映射。 |
| W1-26 | BLOCKED（AD06/AD08） | `tests/work-graph/S3-prepared-context-admission.test.ts` | AD08 已恢复 base 手造 preparation 路径（`basePrepare`），保留 `revision_conflict` 断言；AD06 仍是手造 revoked + base 拒绝 binding（wave-1 形态）。真实 unentered failure→Host reconcile 需要 Runtime/reconcile 组合，本文件没有；按 R-5 标 BLOCKED。 |
| W1-27 | done | `tests/work-graph/R4b-session-directory.test.ts` | baseline/catalog 改由公开 `adoptInitialArchitecture` 写入；`not_found` 与 no-Session 断言保留。 |
| W1-28 | done | `tests/work-graph/S5-request-candidates.test.ts` | RC09 去掉 `recordAt`/`storeSnapshot`，改用 proposal read + request-candidate read。 |
| W1-29 | done | `tests/state/S1-dispatch.test.ts` | 目标名加 UT28。 |
| W1-30 | done | `A2-continuation-projection`、`A2-requeue-route`、`A2-reverify-route` | 删除死导入。 |
| W1-31 | done | `AG2-consultation.test.ts`、`R6-host.test.ts` | 删除死导入。 |
| W1-32 | done | `S2B-r2-backfill-{identity,revision-race,real-kernel}.test.ts` | 删除死导入与错位 token 注释。 |
| W1-33 | done | `tests/data/R3b-body-boundaries.test.ts`、`R3b-materials-contract.test.ts` | 删除残留设施与空清理。 |
| W1-34 | done | `tests/app/S2C-line-routes.test.ts` | 14→13 Session，three→two archived head。 |
| W1-35 | done | `tests/helpers/S1-workflow-archive-fixture.ts`、`C1-mailbox-fixture.ts`（B2/S2A 段 1 已做） | 删除死导入与局部变量；S1/WP1 83 passed（另有 1 个 bwrap 环境失败）。 |
| W1-36 | done | `S2B-track-fixture.ts`、`S5-decision-fixture.ts`、`S5-queue-support.ts`、`S2C-L-runs-support.ts`、`S2C-X-scale-fixture.ts` | 删除死导入。S2B-track 回退后原导入重新被使用，故该文件只留 W1-37 注释；S2C 两个 helper 的 10 个 importer 128 passed。 |
| W1-37 | done | `S2B-track-fixture.ts` 头注释、`S5-decision-fixture.ts` 注释 | 只改措辞，顺序未动。 |
| W1-38 | done | `WP2-duties-fixture.ts`、`WP2-notices-fixture.ts` | 删除死导入。 |
| W1-39 | done | `tests/record-store/SP-text-scan.test.ts` | 删除 `mkdtemp/tmpdir/join`，保留 `rm`。 |
| W1-40 | done | `task-claim-fixture.ts:190`、`R4c-source-authority-guards.test.ts:279` | 注释与标题改为真实公开 bootstrap/running。 |
| W1-41 | done（就现有可删项） | `S3-prepared-context-admission.test.ts` | 删除 `QUERY_*`、`RoleSpecResolutionV1`、`digest` 相关的死导入；因 AD06/AD08 BLOCKED，base 手造 helper 仍保留并有用。 |
| W1-42 | done | `A1-architecture-catalog`、`S2B-activity-calendar`、`S2B-activity-calendar-tasks`、`command-normalization` | 五个测试名收窄到保留内容。 |
| W1-43 | done | `tests/work-graph/S3-prepared-context-admission.test.ts` | 裸 baseline/catalog 改为公开 `adoptInitialArchitecture`；12 个 prepare 失败已解决（AD01/02/04 当时通过）。 |
| W1-44 | done | `tests/helpers/S1-archive-service-fixture.ts` | 删除手造 brief、第二次 append、re-put body 与修补的 `inputBinding`；保留 `pendingAnomalies` 断言。S1-requeue 18 + archive-owner 16 + wait-disposal 14 = 48 passed。 |
| B-02 | done | `tests/work-graph/A2-gate-chain-facts.test.ts`、`R3e-reverify.test.ts` | 两个 slot-less legacy root 行按 R-4 删除，cover 是 `A2-step1-codecs.test.ts:387,416,426`；`:304` 按 R-2 加 `finalizedAt: B2_AT` 后仍到 foreign-subject 检查。4 + 19 passed，cover 29 passed。 |
| B-03 | done | `tests/runtime/source-binding-migration.test.ts` | 删除 “changed current execution” 行（R-3：accepted request 只被 spread/status 结算，无公开步骤原地重写，`query-run-recovery.ts:557-568,638-641`）。8 passed。 |
| B-04 | done（一项 BLOCKED） | `tests/runtime/source-binding-migration.test.ts` | ended-Run 子例改成真实 Runtime；revoked authorization / changed read-grant / changed Reviewer digest 三个原地改写的子例按 R-3 删除；accepted ReviewWork + running 的 base 仍 BLOCKED/R-5：真实 authority 没有 ReviewWork provider（`src/core/work-graph/source-authority-reader.ts:156-159`）。8 passed。 |
| B-08 | done（(a) 一项 BLOCKED） | `tests/runtime/R4c-graph-history.test.ts`、`tests/work-graph/R4c-execution-read.test.ts`、`R4c-execution-history-index.test.ts`、`R4c-task-claim-concurrency.test.ts` | (a) 第一 Run 真实 cancel 后在同一 Session 公开 claim 第二 Task；但再 prepare/start 会写入 Runtime 自己的 kernel identity，与这些 graph-history 行要求的测试 kernel interval 冲突（`execution-driver.ts:618-621,993-1008`；`run-machine.ts:1250-1257`），故 prepare/start 标 BLOCKED。(b) 无 Attempt/outbox 行按 R-4 删除（`claim-service.ts:1272`）。(c) scale 改成公开 claim 独立 Goal/Task。(d) 两 Run 抢同一 kernel 身份的 race 删除（`execution-driver.ts:620`），occupied-slot 改成 A6。(e) 旧 Run cancel 后公开 propose/apply 新 Plan，再 requeue/claim。132 passed。 |
| B-09 | done | `tests/work-graph/R4c-execution-read.test.ts` | 用真实 end→requeue→claim→Host probe（`sessions/session-health.ts:121`）→archive 替换原地 Session/Lease 改写。37 passed（含在本文件总数内）。 |
| B-10 | done | `tests/helpers/graph-session-fixture.ts`、`tests/work-graph/A1-session-lifecycle.test.ts` | `seedAcceptedTask` 改公开 adopt→createGoal→proposePlan→readPlanProposal→applyPlanChange；archive 链改为公开 claim（无 responsible link）→busy→真实 cancel unentered Run→open link→archive 拒绝→close link→archive。lifecycle 24、independent 10、其他 importer 52 passed。 |
| B-11 | done | `tests/work-graph/A1-independent-review.test.ts` | 按 R-4 删除“Plan 物理移除 Task 后显式关闭旧 relation”行，cover 是 `tests/state/plan-machine.test.ts:670`（`plan-validation.ts:338` 拒绝物理移除）；catalog race 半段保持 wave-1。4 passed。 |
| B-12 | partial（IN14/Run seeds BLOCKED） | `tests/work-graph/S3-context-inputs.test.ts` | IN04 按 R-4 删除（`claim-service.ts:920` 拒绝跨 Workspace Goal 的 Run）；Plan 部分已是公开步骤；三个手写 RunSnapshot seed 与 IN14 保留/R-5：真实 work_run send/reply 需要 running+entered 且有 envelope 的 Run（`mailbox-service.ts:750,1329,1361,1369-1382`），本 fixture 的手写 Run 没有 claim/outbox/entered binding。32 passed。 |
| B-13 | partial（IN11 BLOCKED） | `tests/work-graph/S3-context-inputs.test.ts` | IN12 按 R-4 删除（FAIL successor 不可达：`verification-machine.ts:512,631`）；IN11 保留/R-5：真实 open 经 execution reader 要求 claim-linked outbox/Session（`evidence-service.ts:1070`、`run-state-service.ts:526,538`），本 fixture 的手写 Run 没有。32 passed。 |
| B-01/B-05/B-06/B-07/B-14/B-15 | 无改动 | — | 按 §6 是裁定/由其他行覆盖。 |

## 2. BLOCKED 证据

- **W1-21**：`tests/scenarios/S2C-K-legacy-provenance.test.ts:108-111` 目前只有 1 个 indexed execution；要变成 `[TASK_ID, TASK_ID]` 必须在同一 Task 上先后有两条 Work claim。`src/core/work-graph/tasks/claim-service.ts` 的 claim 要求 Task 可派发，第一条 Run 未结束前第二条会被拒绝；本文件没有 Runtime 的 start/end。旧 backfill 步骤已删，不能用它造 predecessor。
- **W1-25**：`tests/work-graph/S3-prepared-context-admission.test.ts:375-383` 仍是 `commitRaw` 的 ended `runA`。真实 upstream 需要 `createExecutionRuntime` 的 claims/entry/model/host 组合；本 fixture 只建了 entry + preparation owners，没有 kernel session 映射，也没有 scripted model。
- **W1-26 AD06**：`tests/work-graph/S3-prepared-context-admission.test.ts:626-630` 仍是 `commitRaw` 写 revoked。真实路径是 `beginRuntimeEntry` → `reconcileRunAtStartup` 的 `not_entered`（`src/core/agent-runtime/run-reconcile.ts:320`），需要 Runtime/classifier 组合（同上）。AD08 按裁定恢复 base 手造路径，仍标 BLOCKED。

## 3. R-6（发现表事实与代码不符）

- **W1-19**：`usage:'current'` 对 Host principal 一律 `source_stale`（`src/core/work-graph/materials/applicability.ts:38-40`），不是能读的用法；改用 `historical_explanation`。验收断言未变，仍经真实 materials owner。
- **W1-01**：表说“删它的测试”，但 `rg` 全 `tests` 未找到 `startingEntryOf`/legacy 分类/`row:'V1'` 的断言，故没有测试可删（见 §1）。

## 4. 删除项

- `tests/helpers/S1-session-facts-fixture.ts` `createLegacySession`：W1-14；旧 operation 已无 caller（`rg createLegacySession` 只剩定义），cover 是当前 `sessions/create` 默认 provenance（`tests/scenarios/S2C-K-legacy-provenance.test.ts:46-50`）。
- `tests/work-graph/S1-codecs-indexes.test.ts` 的 `OLD_OPERATION_JSON`/`oldOperationEncoding` 与 SV01 旧 operation 半段：W1-02/TP-062；cover 是 `tests/work-graph/S1-provenance.test.ts` 当前 provenance 行。
- `tests/scenarios/K-W-workflow-close.test.ts` KA-07：W1-23；已并入 `tests/business/WP1-wiring.test.ts:49,68`。
- `S2B-32-task-timeline-fold.test.ts` fold order (a)：W1-16；cover 是恢复的 `tests/work-graph/S2B-r2-s-preentry-control.test.ts`。
- 五个测试名收窄：W1-42。

## 5. FORMAT seeds（R-2）

- `tests/state/session-availability.test.ts:1005-1007`：`createSessionRecord` 输入补 `provenance: { schemaVersion: 1, kind: 'new' }`（当前 writer 写这个值），断言未改。

## 6. 行外文件

- `tests/state/session-availability.test.ts`：W1-02 使 `createSessionRecord.provenance` 必填，测试输入补当前 writer 值。
- `tests/work-graph/S1-codecs-indexes.test.ts`：W1-02/TP-062 的旧 operation 断言随 codec 拒绝缺失 provenance 删除。

## 7. 检查

- `flock ./.typecheck.lock npm run typecheck`：**通过**（暂停前最后一次，整个树绿）。
- `npm run check:architecture`：在 production 段之后跑过一次，绿；之后的测试文件改动不影响边界检查，但暂停前没有重跑。
- 测试：production 段跑过 8 个直接文件 473 passed；AD 文件在 W1-43/09/19/26/41 后跑过 14 passed。暂停后按 handoff 要求**没有再跑测试**；worker 的半成品与最终树未跑测试，不能算验收。
- 未提交、未跑 ledger、未跑 shortstat（没有 commit；半成品未验收）。工作树里保留了所有改动与 `.typecheck.lock`。

## 8. HANDOFF

### done

生产 W1-01..04；W1-05..09、11、12、14、16、19、22..24、27..29、30..34、38..42；W1-43 的核心（公开 adoptInitialArchitecture）；W1-26 AD08 的 base 路径；W1-41 的死导入。最终 typecheck 绿。

### half done（文件在工作树里，未跑测试、未验证）

- `tests/helpers/C1-mailbox-fixture.ts`（W1-13）
- `tests/helpers/S2B-track-fixture.ts`、`S2B-runtime-steps-fixture.ts`（W1-15/36/37）
- `tests/helpers/S5-decision-fixture.ts`、`S5-queue-support.ts`（W1-17/18/36/37）
- `tests/helpers/S1-archive-service-fixture.ts`（W1-44/35）
- `tests/helpers/S1-workflow-archive-fixture.ts`（W1-35）
- 这些改动只保证 typecheck；语义与测试都没有验证。下一位应先跑各自测试，再决定保留或重做。

### not started

W1-10、W1-20、W1-21（BLOCKED 理由见上，wave-1 形态保留）、W1-25/AD06（BLOCKED，wave-1 形态保留）；B-02、B-03、B-04、B-08、B-09、B-10、B-11、B-12、B-13 全部未施工（runtime/R4c 与 graph/context 的 worker 被停止，且我把 C 的三个半成品文件回退到了 `w1-merged` 以恢复 typecheck）。

### traps / names the next session must know

- `secondClaim`（AD fixture）现在在 claim 检查后立即取出，供 `secondPrepared` 与 `secondPin` 用；不要在闭包里再读 `secondClaimed.value`（TS 不跨闭包收窄）。
- `basePrepare` 是 AD06/AD08 专用的 t-base 手造路径；W1-26 的 AD06 一旦改成真实路径，它只应保留给 AD08。
- `W1-19` 的 materials read 用 `historical_explanation`；用 `current` 会被 `applicability.ts:39` 拒绝。
- `run-reconcile.ts:265` 的 `V1/none` 行文本刻意保留以保持无授权路径行为；如果要清文案，先确认没有测试/报告消费者。
- `W1-21` 若要做完，需要先有“同一 Task 的两条真实 claim、第一条 Run 已结束”的公开链；现有 `openHostScenario` 没有这条链。
- 三个 worker 都没有回报；不要把半成品当 done。

### 下一步最短路径

1. 先跑 worker 半成品对应的测试（C1、WP1、S1-requeue、S2B-track、S5），绿则保留，红则重做或回退。
2. 再做 B-02..B-13（graph/context 与 runtime/R4c），其中 B-03/B-04/B-08/B-09 已被回退到 base。
3. 最后跑全量、commit、ledger（`d1-ledger.py . w1-merged HEAD` 与 `. t-base HEAD`）、shortstat，并把本文件的“半成品/未施工”改成真实结果。

## 9. 第二段

> 第二段从第一段停下的工作树继续；第一段文字保留。本段没有改 production，只改测试/夹具，并补了第一段漏掉的三处测试设置。最终 commit `ed26c44`（`T W1 rework 1`）。四个子 agent 分别做夹具、runtime/R4c、graph/context、W1-10；各自只跑自己的测试文件，不跑 typecheck。

### 9.1 逐行（本段实际动过的行）

| 编号 | 结果 | 改了哪些文件 | 备注 |
|---|---|---|---|
| W1-10 | BLOCKED | — | 见 9.2。WF02 的原因其实存在，但 WF01 没有公开原因，整行按 R-5 保留 R-2 形态；`WP1-start-refusal` 2 passed。 |
| W1-13 | done | `tests/helpers/C1-mailbox-fixture.ts`、`S2B-runtime-steps-fixture.ts` | 真实 prepare/start + A3 持住 model；删 seed 与 `consumerId` 改动。共享 helper 加 `host` grant/`withMailbox`。 |
| W1-15 | BLOCKED | `S2B-track-fixture.ts`（回退 `w1-merged`，只留 W1-37 注释） | 见 9.2。 |
| W1-17 | done | `S5-decision-fixture.ts`、`S5-queue-support.ts`、`S2A-planning-fixture.ts`、`K3-46…`、`K3-UR7…`、`S5-user-message-tools.test.ts` | 删 fixture 映射；用 `platform-adviser/s3.1`；修 5 个 importer 的 role binding / mailbox grant。 |
| W1-18 | done | `S5-queue-support.ts` | 手写 `policyRef`。 |
| W1-20 | done | `tests/runtime/source-binding-migration.test.ts` | memory+SQLite，真实共享 backend，同一 A3 gate/断言。 |
| W1-35 | done | `S1-workflow-archive-fixture.ts`、C1（B2/S2A 段 1 已做） | S1/WP1 83 passed（1 bwrap）。 |
| W1-36 | done | S2B-track、S5-decision、S5-queue、`S2C-L-runs-support.ts`、`S2C-X-scale-fixture.ts` | S2C 10 个 importer 128 passed。 |
| W1-37 | done | S2B-track / S5-decision 注释 | 措辞 only。 |
| W1-44 | done | `S1-archive-service-fixture.ts` | S1 三个文件 48 passed。 |
| B-02 | done | `A2-gate-chain-facts.test.ts`、`R3e-reverify.test.ts` | 两行 R-4 删除；`:304` R-2 加 `finalizedAt`。 |
| B-03 | done | `source-binding-migration.test.ts` | R-3 删除。 |
| B-04 | done（一项 BLOCKED） | `source-binding-migration.test.ts` | ended-Run 真 Runtime；三个 R-3 删除；ReviewWork base 见 9.2。 |
| B-08 | done（(a) 一项 BLOCKED） | `R4c-graph-history`、`R4c-execution-read`、`R4c-execution-history-index`、`R4c-task-claim-concurrency` | (b)(c)(d)(e) 按 R-4/R-1 完成；(a) 见 9.2。 |
| B-09 | done | `R4c-execution-read.test.ts` | end→requeue→claim→probe→archive。 |
| B-10 | done | `graph-session-fixture.ts`、`A1-session-lifecycle.test.ts` | 公开 adopt/createGoal/propose/read/apply；真实 archive 链。 |
| B-11 | done | `A1-independent-review.test.ts` | R-4 删除；cover 是 plan-machine:670。 |
| B-12 | partial（IN14/Run seeds BLOCKED） | `S3-context-inputs.test.ts` | IN04 R-4 删除；Plan 已公开；其余见 9.2。 |
| B-13 | partial（IN11 BLOCKED） | `S3-context-inputs.test.ts` | IN12 R-4 删除；IN11 见 9.2。 |

### 9.2 BLOCKED 证据

- **W1-10 WF01**：Goal 内容摘要是 `src/contracts/graph-context.ts:181-190`（goalId/objective/workspaceId）；`objective` 只由 `goal_created` 写（`src/core/work-graph/tasks/task-service.ts:177`、`:419-431`）。Goal 写路由只有 `src/app/core-routes.ts:377,440,473-474`；`goals/control`、`goals/settings/set`、`goals/reorder` 都只改 revision/settings/order，保留 objective 与 workspaceId（`goal-control.ts:186-210`、`goal-settings-machine.ts:233-235`）。现有 `context_goal_changed` 用例靠手写 digest（`tests/helpers/WP1-entry-fixture.ts:265-281`），不是公开链。WF02 有公开原因（prepare 后公开 propose/review/apply 新 Plan，binding 的 Plan pin 使 startRun 返回 `revision_conflict`，`graph-context-reader.ts:1014-1016`、`execution-entry-service.ts:1118-1140`），但行是 WF01/WF02 一件，按 R-5 不单独改。
- **W1-15**：真实 finish 在 `src/core/work-graph/tasks/execution-entry-service.ts:1921-1931` 写 terminal RunActivity；L8 backfill 对 current-rule counted 记录返回 `unchanged`（`src/core/work-graph/tasks/run-activity-service.ts:159-163`），因此 S2B-30/S2B-34 保留的手算 activity 值无法在真实 finish 后成立。尝试时 20 failed（S2B-30 2、S2B-34 16、S2B-r2-27 2）；回退后 10 文件 82 passed，`w1-merged` 基线 4/4 过。
- **B-04 ReviewWork base**：真实 `createSourceAuthorityReader` 对 `ReviewWork` 返回 `unsupported`（`src/core/work-graph/source-authority-reader.ts:156-159`），所以 accepted ReviewWork + running Run 的 prior state 既不能公开造，也不能在真实路径读回；保留 wave-1/R-2 形态。
- **B-08(a) prepare/start**：这些 graph-history 行把第二 Run 绑到测试自己的 kernel identity/positions（`tests/runtime/R4c-graph-history.test.ts:390,428,546,734`）。真实 `startRun` 用 RunRef 派生的 kernel id 写 entered history（`execution-driver.ts:618-621,993-1008`；`run-machine.ts:875-878`），已有 locator 的 identity/start 不能被另一个值替换（`run-machine.ts:1250-1257`）。先 start 后 bind 与 Runtime locator 冲突，先 bind 后 start 与 entered 写冲突，故无法同时满足；第一 Run 的 cancel + 第二 Task 的公开 claim 已保留，prepare/start 标 BLOCKED。
- **B-12 IN14 / 3 个 Run seeds**：真实 `work_run` send/reply 需要 running+entered 且有 envelope 的 Run（`src/core/work-graph/communication/mailbox-service.ts:750,1329,1361,1369-1382`）；本 fixture 的三个手写 `RunSnapshot` 没有 claim/outbox/entered binding。IN14 的 message id 由 owner 从 request id 派生，本 fixture 没有这条真实链，保留手写 Message。
- **B-13 IN11**：真实 `openVerification` 经 execution reader 读 subject Run（`src/core/work-graph/evidence/evidence-service.ts:1070`），要求 claim-linked outbox/Session（`src/core/work-graph/tasks/run-state-service.ts:526,538`）；本 fixture 的手写 Run 没有。公开 claim 只到 `starting`，completed end 需要 Runtime，wave-1 round seed 保留。
- 第一段的 W1-21、W1-25、W1-26 AD06 仍按第一段裁定保留 BLOCKED；W1-26 AD08 仍是 base 路径。

### 9.3 R-6（发现表事实与代码不符）

本段没有新的 R-6。第一段的 W1-19（Host principal 的 `usage:'current'` 固定 `source_stale`）与 W1-01（没有 legacy 测试可删）继续成立。

### 9.4 删除项与项号映射

`w1-merged..HEAD` 账本有 19 个 REMOVED test/describe、73 个 REMOVED assertion、0 个删除文件；全部映射如下（rename 的旧名按新名归到同一项）：

- W1-02：`S1-codecs-indexes` SV01 旧 operation 半段（3 行 + 1 test）。
- W1-07：`S3-context-and-inputs` 的 `requests[0]` 两行。
- W1-11：`A2-continuation-projection` 四个 `driveWorkflow` 断言（4 行）。
- W1-12：`composition/platform` 旧 unknown-kind 断言（1 行）。
- W1-14：`S1-session-facts-fixture` 的 `createLegacySession` 断言（1 行）。
- W1-16：`S2B-32-task-timeline-fold` fold order (a)（1 test + 1 段断言）。
- W1-18：`S5-queue-support:300` 的 `installed.ref` 期望（1 行）。
- W1-22：`K3-34` 的 `BUILTIN + 12`（1 行）。
- W1-23：`K-W-workflow-close` KA-07（1 test + 12 行）。
- W1-28：`S5-request-candidates` 的 `recordAt`/`storeSnapshot`/allocation 断言（6 行）。
- W1-29：`S1-dispatch` UT27 目标名（rename，1 test）。
- W1-34：`S2C-line-routes` 14→13 Session 名（rename，1 test）。
- W1-40：`R4c-source-authority-guards:279` 标题（rename，1 test）。
- W1-42：`command-normalization`、`A1-architecture-catalog`、`S2B-activity-calendar`、`S2B-activity-calendar-tasks` 的五个旧名（5 test）。
- B-02：`A2-gate-chain-facts` 两行 R-4（1 test + 8 行）、`R3e-reverify` 一行 R-4（1 test + 5 行）。
- B-03：`source-binding-migration` changed-current-execution（1 test + 2 行）。
- B-04：`source-binding-migration` revoked/read-grant/Reviewer-digest（1 test + 3 行）。
- B-08：`R4c-execution-history-index` race + occupied-slot（2 test + 8 行）、`R4c-execution-read` unmapped Run（1 test + 1 行）、`R4c-task-claim-concurrency` planRef 改写（1 行）。
- B-09：`R4c-execution-read` lease 原地改写（6 行）。
- B-11：`A1-independent-review` physical removal（1 test + 8 行）。
- B-12：`S3-context-inputs` IN04（1 test + 2 行）。
- B-13：`S3-context-inputs` IN12（1 test + 4 行）。

未映射：0。`t-base..HEAD` 账本还包含整段 wave-1（`t-base→w1-merged`）的 702 行与 3 个删除文件；这 3 个文件是 wave-1 冻结前的删除（`project-source-index.test.ts` 是 W1-05 的旧文件；`S5-goal-settings-support.ts`、`SP-storage-migration-fixture.ts` 是 wave-1 删除），不属于本次返工的 92 行。t-base 账本里的 1 个 ADDED constant 与 1 个 LOOSENED 也都在 `w1-merged` 之前，见 `tests/app/S0-attention-edge-label.test.ts:216` 与 `tests/work-graph/S2C-lines-d1.test.ts:37`。

### 9.5 FORMAT seeds（R-2）

- `tests/work-graph/A2-gate-chain-facts.test.ts:273-277`：`foreign` finalized copy 补 `finalizedAt: B2_AT`（当前 VR-07 writer 写的值；公开 DTO 省略），断言未改。

### 9.6 行外文件

- `tests/composition/platform.test.ts`：W1-12 的 `describe('rejects: …')` 块漏了 `describe` 导入，补 import。
- `tests/work-graph/R4b-session-directory.test.ts`：W1-27 用公开 `adoptInitialArchitecture` 后，backend 还需注册 `PLAN_GOVERNANCE_RECORD_SCHEMAS.records` 与 `ARCHITECTURE_CATALOG_SCHEMAS.events`，否则 adopt 分别报 `unavailable` 与 `unregistered schema ArchitectureCatalogAdopted@1`；已补，14 passed。
- `tests/helpers/S2B-runtime-steps-fixture.ts`：W1-13 需要 `host` grant 与 `withMailbox`；默认 Host 路径保持原样（`options.host === undefined` 时仍用原 Runtime host），否则 timeline/fold 测试会在 prepare 阶段卡住。
- `tests/helpers/S2A-planning-fixture.ts`、`tests/business/K3-46-review-advance-failures.test.ts`、`tests/business/K3-UR7-crr-failed-set.test.ts`、`tests/runtime/S5-user-message-tools.test.ts`：W1-17 让 RA 使用 `platform-adviser` 后，这些 importer 的 builder role binding / cloned RB manifest 需要改用 RB 的 builder binding；断言未改。
- `tests/helpers/S5-queue-support.ts`：W1-17 后 mailbox Host grant 同时接受 `builder/1` 与 `platform-adviser/s3.1` 两个正式模板（仍校验 scope/configurationRevision/完整 permissions）。
- `tests/helpers/S2C-L-runs-support.ts`、`S2C-X-scale-fixture.ts`：W1-36 的死导入清理（13 + 7 个名字），其 10 个 importer 128 passed。
- `tests/work-graph/S2B-r2-s-preentry-control.test.ts`：W1-16 恢复的公开流程用例（第一段已在工作树里，本段保留并提交）。

### 9.7 检查

- `flock ./.typecheck.lock npm run typecheck`：**通过**（本段最后一次；之后没有 production 改动）。
- `npm run check:architecture`：**通过**（`next source boundaries: OK`，D3 hits 0）。
- 测试（`npx vitest run --maxWorkers=2`）：
  - 43 个 changed test files：除 3 个在 `w1-merged` 基线上同样失败的 app 测试外全过；这 3 个是 `A2-requeue-route`（`effectivePhase: verifying` vs `failed`）、`A2-reverify-route`、`R6-host`（`waiting` vs `completed`），在基线 worktree 复跑得到相同失败。
  - 150 个 changed-helper importer files：除基线同样失败的集合外全过；新增回归都在本段修掉（S5 role binding 9 个、S2A 4 个、R4b/platform/fold 3 个）。bwrap 环境失败：`orchestration-mechanism`（1）、`R3e-command-check-platform`（2）、`R3e-completion-platform`（1）、`A7-control` 的 5 个明确 `ENOENT /usr/bin/bwrap`；这些在 `w1-merged` 同样失败。
  - 116 个 changed-source importer files：除基线同样失败的 31 个（`R5b-initial-planning-workflow`、`A2-requeue-platform` 5、`A2-reverify-platform`、`A2-verification-chain-platform` 6、`R5c-workflow-platform` 3、`S8A-L8-pass-capture` 6、`state/invariants` suite、`A7-control-goal29` 2、`C8-human-stop-respected` 2、`S1-archive-restart`、`S2C-K-archive-tags-checks` 4）外全过；这 31 个在基线 worktree 同样失败。
  - `S2C` 两个 helper 的 10 个 importer：128 passed。
  - 最终 8 个修复文件合跑：77 passed。
- commit：`ed26c44 T W1 rework 1`（未提交 `.dsh-ref/` 与 `.typecheck.lock`）。
- ledger：
  - `python3 -I ./.dsh-ref/d1-ledger.py . w1-merged HEAD` → `.dsh-ref/ledger-W1R1-w1merged.txt`：19 REMOVED tests、73 REMOVED assertions、0 DELETED files；92 行全部按 9.4 映射，未映射 0。
  - `python3 -I ./.dsh-ref/d1-ledger.py . t-base HEAD` → `.dsh-ref/ledger-W1R1-tbase.txt`：702 行 + 3 个删除文件，含整段 wave-1；返工部分同上，wave-1 部分见 9.4。
- shortstat：`t-base..HEAD` 394 files changed, 5399 insertions(+), 13432 deletions(-)；`w1-merged..HEAD` 79 files changed, 1006 insertions(+), 963 deletions(-)。
