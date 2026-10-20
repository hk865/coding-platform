# T 轮 TP 组回复（v2，基线 t-base / eb21521，提交 efa65cd）

## 1. 逐项结果

| 编号 | 结果 | 改了哪些文件（主） | 覆盖/备注 |
|---|---|---|---|
| TP-001 | done | `src/business/workflow/contracts.ts`, `src/business/workflow/index.ts`, `src/business/workflow/ports.ts` 等 5 个 |  |
| TP-002 | done | 31 个 src/contracts/*.ts 第 1 行 |  |
| TP-003 | done | `src/core/work-graph/model/claim-contracts.ts`, `src/core/work-graph/persistence/execution-entry-codecs.ts`, `tests/state/attempt-machine.test.ts` |  |
| TP-004 | done | `src/business/workflow/contracts.ts` |  |
| TP-005 | done | `src/business/workflow/contracts.ts` | 由 TP-001 吸收 |
| TP-006 | done | `src/business/workflow/decision-actions.ts` |  |
| TP-007 | done | `src/business/workflow/session-maintenance.ts` |  |
| TP-008 | done | 31 个 src/contracts/*.ts 第 1 行 |  |
| TP-009 | done | `src/contracts/core/prepared-execution.ts` | 由 TP-054 吸收 |
| TP-010 | BLOCKED | `src/contracts/core/prepared-execution.ts` | 待 lead 冻结 selectedTaskInputs 删除范围与规格后注；未动 |
| TP-011 | done | `src/contracts/dispatch.ts` |  |
| TP-012 | done | `src/contracts/goal-decisions.ts` |  |
| TP-013 | done | `src/contracts/human-role-collaboration.ts` |  |
| TP-014 | done | `src/contracts/ledger.ts` | 由 TP-051 吸收 |
| TP-015 | done | `src/contracts/query-job.ts` |  |
| TP-016 | done | `src/contracts/role-spec.ts` |  |
| TP-017 | done | `src/contracts/role-spec.ts` |  |
| TP-018 | done | `src/contracts/role-spec.ts` |  |
| TP-019 | done | `src/contracts/role-spec.ts` |  |
| TP-020 | done | `src/contracts/role-spec.ts` |  |
| TP-021 | done | `src/contracts/role-spec.ts` |  |
| TP-022 | done | `src/contracts/role-spec.ts` |  |
| TP-023 | done | `src/contracts/role-spec.ts` |  |
| TP-024 | done | `src/contracts/role-spec.ts` |  |
| TP-025 | partial | `src/contracts/verification.ts` | 两个旧根子项 BLOCKED；A2-gate-chain-facts 2 条、R3e-reverify 1 条因 chain 必填保留红 |
| TP-026 | done | `src/core/agent-runtime/exploration-tools.ts` | 新增冻结模式 close 幂等/释放失败两条断言；analyzer 断言迁入 typescript-source-query |
| TP-027 | done | `src/core/agent-runtime/kernel-store-locator.ts` |  |
| TP-028 | done | `src/core/agent-runtime/run-limits.ts` |  |
| TP-029 | done | `src/core/agent-runtime/session-operations.ts` |  |
| TP-030 | partial | `src/core/agent-runtime/source-capture-access.ts` | changed current execution 子场景 BLOCKED；source-binding-migration 第二条红 |
| TP-031 | done | `src/core/work-graph/communication/mailbox-service.ts` |  |
| TP-032 | done | `src/core/work-graph/configuration/role-memory-service.ts` |  |
| TP-033 | done | `src/core/work-graph/configuration/role-memory-service.ts` |  |
| TP-034 | done | `src/core/work-graph/configuration/role-memory-service.ts` |  |
| TP-035 | done | `src/core/work-graph/configuration/role-memory-service.ts` |  |
| TP-036 | done | `src/core/work-graph/configuration/role-memory-service.ts` |  |
| TP-037 | done | `src/core/work-graph/configuration/role-memory-service.ts` |  |
| TP-038 | done | `src/core/work-graph/configuration/role-memory-service.ts` |  |
| TP-039 | done | `src/core/work-graph/configuration/role-memory-service.ts` |  |
| TP-040 | done | `src/core/work-graph/model/claim-contracts.ts` |  |
| TP-041 | done | `src/core/work-graph/model/claim-contracts.ts` | 由 TP-003/040 吸收 |
| TP-042 | done | `src/core/work-graph/model/configuration-contracts.ts` |  |
| TP-043 | done | `src/core/work-graph/model/configuration-contracts.ts` |  |
| TP-044 | done | `src/core/work-graph/model/configuration-contracts.ts` |  |
| TP-045 | done | `src/core/work-graph/persistence/evidence-record-codecs.ts` |  |
| TP-046 | done | `src/core/work-graph/persistence/evidence-record-codecs.ts` |  |
| TP-047 | done | `src/core/work-graph/persistence/evidence-record-codecs.ts` |  |
| TP-048 | done | `src/core/work-graph/persistence/execution-entry-codecs.ts` |  |
| TP-049 | done | `src/core/work-graph/persistence/plan-record-codecs.ts` |  |
| TP-050 | done | `src/core/work-graph/persistence/plan-record-codecs.ts` |  |
| TP-051 | done | `src/core/work-graph/persistence/record-codecs.ts` |  |
| TP-052 | done | `src/core/work-graph/queries/query-record-codecs.ts` |  |
| TP-053 | done | `src/core/work-graph/sessions/session-directory.ts` |  |
| TP-054 | partial | `src/core/work-graph/state/context-input.ts` | C1 real start 只到 entering、WP1-units Runtime double 两处 BLOCKED；其余真实 prepare 已落 |
| TP-055 | done | `src/core/work-graph/state/run-machine.ts` |  |
| TP-056 | done | `src/core/work-graph/state/unknown-call-kinds.ts` |  |
| TP-057 | done | `src/core/work-graph/state/unknown-call-review.ts` |  |
| TP-058 | done | `src/core/work-graph/state/unknown-call-review.ts` |  |
| TP-059 | done | `src/core/work-graph/tasks/claim-record-codecs.ts` |  |
| TP-060 | done | `src/core/work-graph/tasks/execution-entry-service.ts` |  |
| TP-061 | done | `src/core/work-graph/tasks/plan-service.ts` |  |
| TP-062 | done | `src/core/work-graph/tasks/session-provenance-facts.ts` |  |
| TP-063 | done | `src/core/work-graph/views/automatic-rework-notices.ts` |  |
| TP-064 | done | `src/core/work-graph/views/track-read-model.ts` |  |
| TP-065 | done | `src/core/work-graph/views/track-read-model.ts` |  |
| TP-066 | done | `src/core/work-graph/views/track-read-model.ts` |  |
| TP-067 | done | `src/core/work-graph/views/undelivered-reply-notices.ts` |  |
| TP-068 | done | `tests/app/A2-continuation-projection.test.ts` |  |
| TP-069 | done | `tests/app/A2-continuation-projection.test.ts, tests/app/A2-requeue-route.test.ts, tests/app/A2-reverify-route.test.ts` |  |
| TP-070 | done | `tests/app/AG2-consultation.test.ts, tests/app/R6-host.test.ts` |  |
| TP-071 | done | `tests/app/S2B-41…, S2B-be2-late-evidence-activity, S2B-be2-run23-activity, S2B-be2-startup-reconcile-activity, S2B-r2-backfill-probe-first, S2B-r2-r6-probe-verdicts, S2B-backfill-workflow, S2B-r2-backfill-done-cursor, S2B-r2-backfill-identity, S2B-r2-backfill-revision-race, S2B-r2-backfill-real-kernel` |  |
| TP-072 | BLOCKED | `tests/app/S2B-r2-backfill-done-cursor.test.ts` | R9 真实 Runtime/Kernel 历史未冻结；helper 与手写行保留 |
| TP-073 | done | `tests/app/S2C-line-routes.test.ts` |  |
| TP-074 | done | `tests/composition/K-R-close-open-turn.test.ts` | 由 TP-027 吸收删除 |
| TP-075 | done | `tests/composition/K-R-close-open-turn.test.ts` |  |
| TP-076 | done | `tests/composition/K-R-close-open-turn.test.ts` |  |
| TP-077 | done | `tests/helpers/A2-restart-fixture.ts` |  |
| TP-078 | done | `tests/helpers/AG2b-collaboration-fixture.ts` |  |
| TP-079 | done | `tests/helpers/B2-execution-fixture.ts` |  |
| TP-080 | done | `tests/helpers/B2-runtime-fixture.ts` |  |
| TP-081 | BLOCKED | `tests/helpers/C1-mailbox-fixture.ts` | 真实 start 只到 entering，A3 entered 闸门不可达；保留 entered seed |
| TP-082 | done | `tests/helpers/S1-runtime-scenario-fixture.ts` |  |
| TP-083 | done | `tests/helpers/S1-workflow-archive-fixture.ts` |  |
| TP-084 | done | `tests/helpers/S1-workflow-archive-fixture.ts` | 由 TP-083 吸收 |
| TP-085 | done | `tests/helpers/S2A-notices-support.ts` |  |
| TP-086 | done | `tests/helpers/S2A-notices-support.ts` |  |
| TP-087 | done | `tests/helpers/S2A-notices-support.ts` |  |
| TP-088 | done | `tests/helpers/S2A-notices-workspace2-fixture.ts` |  |
| TP-089 | done | `tests/helpers/S2A-notices-workspace2-fixture.ts` |  |
| TP-090 | done | `tests/helpers/S2B-activity-fixture.ts` |  |
| TP-091 | BLOCKED | `tests/helpers/S2B-activity-fixture.ts` | R9 转换未冻结；writeActivity/countedCounter 行保留 |
| TP-092 | done | `tests/helpers/S2B-runtime-store-fixture.ts` |  |
| TP-093 | done | `tests/helpers/S2B-task-timeline-fixture.ts` |  |
| TP-094 | done | `tests/helpers/S2B-task-timeline-fixture.ts` |  |
| TP-095 | done | `tests/helpers/S2B-task-timeline-fixture.ts` |  |
| TP-096 | done | `tests/helpers/S2B-task-timeline-fixture.ts` | 新增 tests/helpers/S2B-runtime-steps-fixture.ts |
| TP-097 | done | `tests/helpers/S2B-track-fixture.ts` |  |
| TP-098 | done | `tests/helpers/S2C-L-line-support.ts` |  |
| TP-099 | partial | `tests/helpers/S5-decision-fixture.ts` | 治理初始化已公开；S5-decision-fixture:560/599 手写检查点 BLOCKED |
| TP-100 | done | `tests/helpers/S5-decision-fixture.ts` |  |
| TP-101 | done | `tests/helpers/S5-decision-fixture.ts` | builder→adviser 的 legacyDuty 映射需 lead 确认（见 §5） |
| TP-102 | done | `tests/helpers/S5-decision-fixture.ts` |  |
| TP-103 | done | `tests/helpers/S5-goal-settings-support.ts` |  |
| TP-104 | done | `tests/helpers/S5-queue-support.ts` |  |
| TP-105 | done | `tests/helpers/S5R2-c-support.ts` |  |
| TP-106 | done | `tests/helpers/S5R2-d-support.ts` |  |
| TP-107 | done | `tests/helpers/task-claim-fixture.ts` |  |
| TP-108 | partial | `tests/helpers/task-claim-fixture.ts` | 初始化并入 107；seedRun 子项 BLOCKED，调用点已列 |
| TP-109 | done | `tests/runtime/A2-reconcile-runtime.test.ts` |  |
| TP-110 | done | `tests/runtime/K3-35-workspace-baseline-prepare.test.ts` |  |
| TP-111 | done | `tests/runtime/R4b-session-skeleton.test.ts` |  |
| TP-112 | done | `tests/runtime/R4c-graph-history.test.ts` |  |
| TP-113 | done | `tests/runtime/R4c-source-authority-guards.test.ts` |  |
| TP-114 | done | `tests/runtime/R4c-source-authority-guards.test.ts` |  |
| TP-115 | done | `tests/runtime/R4c-source-authority-guards.test.ts` |  |
| TP-116 | done | `tests/runtime/S1-archive-files-brief.test.ts` |  |
| TP-117 | BLOCKED | `tests/runtime/source-binding-migration.test.ts` | 两个 state.set 消费者逐断言迁移未冻结 |
| TP-118 | partial | `tests/runtime/source-binding-migration.test.ts` | 第一条真实 Query 闸门已转；第二条 BLOCKED |
| TP-119 | done | `tests/runtime/source-tool-lifecycle.test.ts` |  |
| TP-120 | done | `tests/scenarios/K-W-workflow-close.test.ts` |  |
| TP-121 | done | `tests/scenarios/K-W-workflow-close.test.ts` |  |
| TP-122 | done | `tests/scenarios/S2C-K-legacy-provenance.test.ts` |  |
| TP-123 | done | `tests/scenarios/S3-context-and-inputs.test.ts` |  |
| TP-124 | BLOCKED | `tests/scenarios/support/S5-decisions.ts` | agentRequeue 真实 Runtime 路径未冻结 |
| TP-125 | done | `tests/scenarios/support/S5-decisions.ts` |  |
| TP-126 | done | `tests/state/S1-dispatch.test.ts` |  |
| TP-127 | done | `tests/state/S1-dispatch.test.ts` |  |
| TP-128 | done | `tests/state/WP1-goal-content.test.ts` |  |
| TP-129 | done | `tests/state/attempt-machine.test.ts` |  |
| TP-130 | done | `tests/state/context-input.test.ts` |  |
| TP-131 | done | `tests/state/goal-machine.test.ts` |  |
| TP-132 | done | `tests/state/plan-machine.test.ts` | 由 TP-050 吸收 |
| TP-133 | done | `tests/state/run-machine.test.ts` |  |
| TP-134 | done | `tests/state/run-machine.test.ts` |  |
| TP-135 | done | `tests/state/session-availability.test.ts` |  |
| TP-136 | done | `tests/state/task-failure.test.ts` |  |
| TP-137 | done | `tests/state/verification-machine.test.ts` |  |
| TP-138 | done | `tests/work-graph/A2-step1-codecs.test.ts` |  |
| TP-139 | done | `tests/work-graph/A2-step1-codecs.test.ts` |  |
| TP-140 | done | `tests/work-graph/A2-verification-chain.test.ts` |  |
| TP-141 | done | `tests/work-graph/A2-verification-chain.test.ts` |  |
| TP-142 | done | `tests/work-graph/B2-09-crr-owner.test.ts` |  |
| TP-143 | done | `tests/work-graph/B2-execution-entry.test.ts` | 新增纯 codec 测试 tests/state/execution-entry-codecs-pure.test.ts |
| TP-144 | done | `tests/work-graph/B2-execution-entry.test.ts` |  |
| TP-145 | done | `tests/work-graph/B2-execution-entry.test.ts` |  |
| TP-146 | BLOCKED | `tests/work-graph/B2-execution-entry.test.ts` | 真实 Kernel 身份冲突触发点未冻结 |
| TP-147 | done | `tests/work-graph/R3c-plan-adoption.test.ts` |  |
| TP-148 | BLOCKED | `tests/work-graph/R4c-execution-read.test.ts` | Host unavailable 探测/归档链未冻结 |
| TP-149 | done | `tests/work-graph/R4c-execution-read.test.ts` |  |
| TP-150 | done | `tests/work-graph/R4c-source-authority-reader.test.ts` |  |
| TP-151 | done | `tests/work-graph/R4c-task-claim.test.ts` |  |
| TP-152 | done | `tests/work-graph/S1-dispatch-guards.test.ts` |  |
| TP-153 | done | `tests/work-graph/S2A-notices-rework.test.ts` |  |
| TP-154 | done | `tests/work-graph/S2B-30-track-bars.test.ts` |  |
| TP-155 | done | `tests/work-graph/S2B-33-task-timeline-pagination.test.ts` |  |
| TP-156 | done | `tests/work-graph/S2B-activity-calendar-tasks.test.ts` |  |
| TP-157 | done | `tests/work-graph/S2B-activity-calendar.test.ts` | 由 TP-090 吸收 |
| TP-158 | done | `tests/work-graph/S2B-r2-never-entered.test.ts` |  |
| TP-159 | done | `tests/work-graph/S2B-r2-r5-not-entered.test.ts` |  |
| TP-160 | done | `tests/work-graph/S2B-r2-s-preentry-control.test.ts` |  |
| TP-161 | done | `tests/work-graph/S2C-lines-d1.test.ts` | 2C-14 字面量按条目重算（standby 6→5、archived partial→exact 2、9→8） |
| TP-162 | done | `tests/work-graph/S2C-lines-page.test.ts` |  |
| TP-163 | BLOCKED | `tests/work-graph/S3-graph-context.test.ts` | 公开 GR 世界/GR06-07 映射未冻结 |
| TP-164 | done | `tests/work-graph/S3-prepared-context-admission.test.ts` |  |
| TP-165 | partial | `tests/work-graph/S3-prepared-context-admission.test.ts` | 上游 Run/AD08 公开步骤在；AD06 BLOCKED，AD08 因书误 BLOCKED |
| TP-166 | done | `tests/work-graph/S5-notices.test.ts` | NR05 两处 items[1]→items[0]（书面核对授权） |
| TP-167 | done | `tests/work-graph/S5-notices.test.ts` | NR08 强制迁入 NR01，cap 3→7 后历史通知仍为 3 |
| TP-168 | done | `tests/work-graph/S5-request-candidates.test.ts` |  |
| TP-169 | done | `tests/work-graph/S5-request-candidates.test.ts` |  |
| TP-170 | done | `tests/work-graph/S5-user-messages.test.ts` |  |
| TP-171 | done | `tests/work-graph/WP1-goal-content-entry.test.ts` |  |
| TP-172 | done | `tests/work-graph/WP2-undelivered-notices.test.ts` | 由 TP-067 吸收 |
| TP-173 | done | `tests/state/task-machine.test.ts` |  |

> 每条删除/合并的覆盖依据沿用条目表的 `覆盖/依据` 与 `涉及测试` 列；备注只写吸收关系、特例和未落部分。

## 2. BLOCKED 条目证据

- **TP-010**：未动。`src/contracts/core/prepared-execution.ts:189` 的 `selectedTaskInputs` 删除范围与规格后注未由 lead 冻结；按书核保持 BLOCKED，也未连带删 `TaskInputPageV1` 字段。
- **TP-025**（partial）：两个旧根子项（VD-1、VD-15、GAP-52、P10、P20）按书核保留。chain 改为必需后，这三条旧形状用例在存储层被拒：
  `tests/work-graph/A2-gate-chain-facts.test.ts:237`（P20 两个无 slot 旧根，`expected committed` 得 `rejected`）、
  `tests/work-graph/A2-gate-chain-facts.test.ts:304`（同一旧形状的另一 subject 用例）、
  `tests/work-graph/R3e-reverify.test.ts:477`（slot-less root reverify）。
  它们正是 lead 要逐项冻结的保留断言，未改写、未删除。
- **TP-030**（partial）：`changed current execution` 子场景依赖 `state.set` 改写事实，按书核未动；`tests/runtime/source-binding-migration.test.ts:399` 仍红（`query source capture: the exact submission reader is not available`）。
- **TP-054**（partial）：`contextAssembly` 必填、条件写入和 Work/Query 准入容忍已删，列明构造方改走真实 `prepareTaskForReal`/`prepareQueryForReal`。两处未能按规则表到达：`tests/helpers/C1-mailbox-fixture.ts:159` 的真实 Runtime start 在本夹具只到 `entering`、不产生模型调用，`entered` 闸门不可达；`tests/helpers/WP1-units-fixture.ts` 的 Runtime double 不能走真实 prepare。
- **TP-072**：BLOCKED（R9）。`tests/app/S2B-r2-backfill-done-cursor.test.ts:44-65,68-75,80-88` 的 `commitLegacyRun`/`countedCounter`/`seedLegacyActivity` 与 `tests/helpers/S2B-activity-fixture.ts:316,529,557` 的 `seedLegacyActivity`/`runAndEnd`/`writeActivity` 保留；书核要求先冻结真实 Runtime/Kernel 历史流程。
- **TP-081**：BLOCKED。`tests/helpers/C1-mailbox-fixture.ts:159` 真实 Runtime start 返回 `entering`、0 次模型调用，A3 entered 闸门不可达；保留原 entered seed，未改写成手写 entered 事实以外的新路径。
- **TP-091**：BLOCKED（R9）。`tests/helpers/S2B-activity-fixture.ts:316,529,557` 与 `tests/work-graph/S2B-activity-calendar-tasks.test.ts:154-168` 的旧 Run/手写活动行保留。
- **TP-099**（partial）：治理初始化已改公开 `createProjectBootstrapServices`（Project@1、Workspace@3、采用前 Goal@6）；剩余手写检查点 `tests/helpers/S5-decision-fixture.ts:560`（Project/Workspace seedCommit）与 `:599`（初始 Goal seedCommit）按书核 BLOCKED。
- **TP-108**（partial）：初始化并入 TP-107。`seedRun` 子项 BLOCKED，实际调用点：`tests/helpers/task-claim-fixture.ts:431`、`tests/runtime/R4c-graph-history.test.ts:146`、`tests/work-graph/R4c-execution-read.test.ts:212,369`、`tests/work-graph/R4c-execution-history-index.test.ts:268,915,917`、`tests/work-graph/R4c-task-claim-concurrency.test.ts:63,64`；helper 未删，调用未改。
- **TP-117**：BLOCKED。`tests/runtime/source-binding-migration.test.ts:139,147,164,177,178,186` 的两个 `workFixture` 消费者仍用 `state.set`，需 lead 先冻结逐断言迁移（真实结束、真实 Reviewer 前提、不可达原地改写）。
- **TP-118**（partial）：第一条已改真实 submit/claim/prepare + A3 闸门（Job/Run 均 running），真实 `readQuerySubmission` 计数为 1；第二条 `tests/runtime/source-binding-migration.test.ts:399` BLOCKED。
- **TP-124**：BLOCKED。`tests/scenarios/support/S5-decisions.ts` 的 agentRequeue 段未动；需先冻结脚本模型经真实 Runtime 调 requeue 工具的完整路径。
- **TP-146**：BLOCKED。`tests/work-graph/B2-execution-entry.test.ts` 的槽冲突/零部分提交用例保留，未手写槽或 begin 事实，也未加合同测试兜底。
- **TP-148**：BLOCKED。`tests/work-graph/R4c-execution-read.test.ts:195-221` 保留；真实 Host 探测 unavailable、公开结束/重排/领取/归档链未冻结。
- **TP-163**：BLOCKED。`tests/work-graph/S3-graph-context.test.ts:388-470,543-550,580-594,746-758` 保留；公开可达 GR 世界与 GR06/GR07 逐断言映射未冻结。
- **TP-165**（partial）：上游 Run/AD08 的公开 prepare 与 `setLinePins` @5→@7 已落；AD06 按书核 BLOCKED；AD08 的“@7 后公开移到 @8 应 revision_conflict”在当前生产不成立：`src/core/work-graph/views/graph-context-reader.ts:1014-1029` 的 binding 不含 Workspace source，而 `tasks/execution-entry-service.ts:1073-1078` 只比较 `binding.sources`，因此会提交成功。对应 AD06/AD08 四条测试（memory/sqlite 各 2）保留红。

## 3. 白名单外改动

只做了规则 1 的编译/当前格式例外，均在回复中列明：

- `tests/business/WP1-start-refusal.test.ts`（+2/−2）：`startRefusalWorkflow` 改 async 后补 `await`，否则 typecheck 不过。
- `tests/work-graph/S3-context-inputs.test.ts`：给 `RoundSnapshot` 字面量补当前 `chain`，给两个 finalized gate 轮补 `finalizedAt`（当前格式要求；书核 §2 未列该文件）。
- `tests/work-graph/W1-future-plan.test.ts`、`tests/work-graph/W2-future-intent.test.ts`、`tests/work-graph/W2-agent-whiteboard.test.ts`：V1 draft/proposal 类型退役后这些文件里的 v1 字面量/断言成为编译错误，只删对应 v1 片段，保留当前断言。

## 4. 检查

- **typecheck**（协调者独占，最终一次）：
  `flock ./.typecheck.lock npm run typecheck` -> 通过（tsc 两套配置均 0 错误，约 22s）。
  **环境偏差**：书要求的 `/home/han001/dsh-work/t-typecheck.lock` 在本沙箱不可创建（`Permission denied`，`touch` 同样被拒；无审批通道），改用工作区内 `./.typecheck.lock` 的同一 flock 串行化。除此之外仍遵守“协调者独占、子代理跑测试时不跑 typecheck”。
- **架构检查**：`npm run check:architecture` -> OK（`next source boundaries: OK`）。
- **测试**：最终扫全部 155 个改动的测试文件，13 批，`npx vitest run --maxWorkers=2`，一次一批。逐批汇总：
  - aa: `4 failed | 10 passed (14)` / `5 failed | 46 passed (51)`
  - ab: `1 failed | 11 passed (12)` / `1 failed | 75 passed (76)`
  - ac: `11 passed (11)` / `143 passed (143)`
  - ad: `12 passed (12)` / `106 passed (106)`
  - ae: `2 failed | 10 passed (12)` / `8 failed | 107 passed (115)`
  - af: 12 个文件；A7-control 23 条失败（全部停在 `run_check` 的 bwrap ENOENT）
  - ag: `1 failed | 12 passed (13)` / `3 failed | 385 passed (388)`
  - ah: `1 failed | 12 passed (13)` / `2 failed | 2341 passed (2343)`
  - ai: `1 failed | 10 passed (11)` / `8 failed | 79 passed (87)`
  - aj: `1 failed | 11 passed (12)` / `1 failed | 173 passed (174)`
  - ak: `10 passed (10)` / `103 passed (103)`
  - al: `1 failed | 11 passed (12)` / `4 failed | 224 passed (228)`
  - am: `11 passed (11)` / `179 passed (179)`
  合计 55 条失败，全部可归因，无计划外回归：
  - 47 条为容器缺 `/usr/bin/bwrap`（`ENOENT ... /usr/bin/bwrap`，`run_check` 停 `waiting`）或该环境既有失败：A7-control 23、A2-verification-chain 8、A11-no-progress 7、WP1-wiring 3、orchestration-mechanism 1、A2-requeue/A2-reverify/R6-host 3（书核基线同样红）、AG2b-collaboration 2（30s 超时，基线同文件亦红）。
  - 8 条为已冻结 BLOCKED：TP-025 3（A2-gate-chain-facts 2、R3e 1）、TP-030/118 1（source-binding-migration）、TP-165 4（AD06/AD08，memory/sqlite）。
- **D1 ledger**：`python3 -I ./.dsh-ref/d1-ledger.py . t-base HEAD > ./.dsh-ref/ledger-TP.txt`。
  结果：待核 533 行 + 3 个删除文件，其中 `REMOVED assertion 445`、`REMOVED test or describe 86`、`DELETED test files 3`、`LOOSENED 1`、`ADDED constant 1`、`MOVED 9`，`D3 hits: 0`。
  映射：按“文件 -> 条目”逐文件映射（头部 173 条 + 书核 §2 补白），**无未映射行**。
  - 唯一 LOOSENED：`tests/work-graph/S2C-lines-d1.test.ts:37` 的 `archived partial->exact 2`，由 TP-161 书面核对明确授权。
  - 唯一 ADDED constant：`tests/runtime/K3-34-tool-name-constants.test.ts:59` 的 `BUILTIN_TOOL_NAMES.size + 12`（原 +13），由 TP-026 删除 `project_index` 引起，属条目内的精确数字调整。
  - 3 个删除文件：`tests/data/project-source-index.test.ts`（TP-026，7 tests/40 expects，覆盖迁入 typescript-source-query）、`tests/helpers/S5-goal-settings-support.ts`（TP-103，0 tests，工厂并入共享夹具）、`tests/work-graph/S2B-r2-s-preentry-control.test.ts`（TP-160，1 test，并入 fold 目标）。
- **行数**：`git diff --shortstat t-base HEAD` -> `336 files changed, 4059 insertions(+), 11394 deletions(-)`。
- **提交**：`efa65cd T TP`（未包含 `.dsh-ref/` 与本地锁文件）。

## 5. 疑似书/条目问题

1. **TP-165 的 AD08 按今天代码做不到**：真实 prepare 产出的 binding 不含 Workspace source（`views/graph-context-reader.ts:1014-1029` 只出 Goal/Plan/baseline/Runs），而 `tasks/execution-entry-service.ts:1073-1078` 只比较 `binding.sources` 里的 Workspace revision；把 Workspace 从 @7 公开移到 @8 后 authorize 会提交，不是 `revision_conflict`。
2. **TP-025 的“两个旧根”BLOCKED 与 chain 必填互相拉扯**：保留的三条旧形状用例现在会在存储层被拒（见 §2）。需 lead 冻结这三条的当前输入/保留断言，或允许把它们改为当前根。
3. **TP-081/TP-054 的 C1 真实 start 只到 `entering`**：这个夹具下模型依赖没有被调用，A3 entered 闸门无法到达；书核把它写成可转换。
4. **TP-054 的 WP1-units Runtime double**：夹具的 Runtime 是 double，无法走真实 prepare；书核把它列为可统一迁移。
5. **白名单/书核 §2 漏了 5 个必改文件**：`tests/work-graph/S3-context-inputs.test.ts`（chain、finalizedAt）、`tests/business/WP1-start-refusal.test.ts`、`tests/work-graph/W1-future-plan.test.ts`、`W2-future-intent.test.ts`、`W2-agent-whiteboard.test.ts`（V1 退役的编译必需）。已按规则 1 例外处理并列在 §3。
6. **行号漂移**：TP-013 的类型在 72-75（条目写 73-76）；TP-017 在 153-155；TP-027 的 K-W 用例实际在 460-495（条目写 487-522，因前一条已删）；TP-108 的 `seedRun` 在 `task-claim-fixture.ts:431`（条目写 408）；TP-044 的测试清单在条目里本是空的，按动作补了 `S1-runtime-scenario-fixture`/`S2B-runtime-store-fixture` 两个现有消费者。
7. **TP-101 需要 lead 确认一个映射**：夹具的信任 `builder` 模板不在生产五个模板内；严格只用生产 `legacyDuty` 匹配会让 fixture 初始化消息不可发（executor 不能发 `decision_request`）。实现为“先生产匹配，再仅对该 fixture 模板映射到 adviser”，这是条目没有明说的地方。
8. **TP-035 的 note 前缀**：条目给 role-memory-service 的 `actorRefEquals` 也用“role specs are kept unwired…”这句；已照条目原文写入，读起来与声明本身不完全贴合，留 lead 校对。

另：`TP-035`/`TP-042`–`TP-044` 没有书面核对改正，按动作保留 `used only by tests` 清单（TP-044 补了两个现有 helper 路径）。
