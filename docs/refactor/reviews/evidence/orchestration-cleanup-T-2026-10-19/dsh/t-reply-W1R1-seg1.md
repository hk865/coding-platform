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
| W1-10 | 未施工 | — | worker 未开始该文件。 |
| W1-11 | done | `tests/app/A2-continuation-projection.test.ts` | 四处改成 `workflow/advance` 单次调用；启动链仍用 `driveWorkflow`。 |
| W1-12 | done | `tests/composition/platform.test.ts` | 未知 kind 移入 `describe('rejects: …')`，公开 `queryGoal` 前后对比，保留 `unsupported` 与双后端。 |
| W1-13 | 半成品 | `tests/helpers/C1-mailbox-fixture.ts` | worker 的部分改动，typecheck 通过；未跑测试、未验证 entered 转换是否完整。 |
| W1-14 | done | `tests/helpers/S1-session-facts-fixture.ts` | 删除 `createLegacySession`；保留 `plannedSession`（其他测试仍用）。 |
| W1-15 | 半成品 | `tests/helpers/S2B-track-fixture.ts`、`S2B-runtime-steps-fixture.ts` | worker 部分改动（track 146 行），补了 `ExecutionAuthorizationV2` 导入使 typecheck 绿；未跑测试。 |
| W1-16 | done | `tests/work-graph/S2B-32-task-timeline-fold.test.ts`；恢复 `tests/work-graph/S2B-r2-s-preentry-control.test.ts` | 恢复 r2 公开流程用例与五段断言；删除 fold 中重复用例与死导入。 |
| W1-17 | 半成品 | `tests/helpers/S5-decision-fixture.ts` | worker 部分改动；未验证 `legacyDuty` 映射是否处理完。 |
| W1-18 | 半成品 | `tests/helpers/S5-queue-support.ts` | worker 部分改动；未验证 `policyRef`。 |
| W1-19 | done | `tests/helpers/task-claim-fixture.ts` | Query manifest 改从真实 materials owner 读取。**R-6**：`usage:'current'` 对 Host ctx 固定返回 `source_stale`（`src/core/work-graph/materials/applicability.ts:39`），改用 `historical_explanation`；仍是真实公开读取。 |
| W1-20 | 未施工 | — | worker 的改动在暂停后因 typecheck 错误已回退到 `w1-merged`。 |
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
| W1-35 | 部分 | `S1-workflow-archive-fixture.ts`（worker，半成品）、`S1-archive-service-fixture.ts`（worker，半成品）、`C1-mailbox-fixture.ts`（半成品）、`B2-execution-fixture.ts`、`S2A-planning-fixture.ts` | B2/S2A 的死导入已删；S1/C1 部分未验证。 |
| W1-36 | 半成品 | `S2B-track-fixture.ts`、`S2B-runtime-steps-fixture.ts`、`S5-decision-fixture.ts`、`S5-queue-support.ts` | worker 部分改动，未跑测试。 |
| W1-37 | 半成品 | `S2B-track-fixture.ts`、`S5-decision-fixture.ts` | 同上。 |
| W1-38 | done | `WP2-duties-fixture.ts`、`WP2-notices-fixture.ts` | 删除死导入。 |
| W1-39 | done | `tests/record-store/SP-text-scan.test.ts` | 删除 `mkdtemp/tmpdir/join`，保留 `rm`。 |
| W1-40 | done | `task-claim-fixture.ts:190`、`R4c-source-authority-guards.test.ts:279` | 注释与标题改为真实公开 bootstrap/running。 |
| W1-41 | done（就现有可删项） | `S3-prepared-context-admission.test.ts` | 删除 `QUERY_*`、`RoleSpecResolutionV1`、`digest` 相关的死导入；因 AD06/AD08 BLOCKED，base 手造 helper 仍保留并有用。 |
| W1-42 | done | `A1-architecture-catalog`、`S2B-activity-calendar`、`S2B-activity-calendar-tasks`、`command-normalization` | 五个测试名收窄到保留内容。 |
| W1-43 | done | `tests/work-graph/S3-prepared-context-admission.test.ts` | 裸 baseline/catalog 改为公开 `adoptInitialArchitecture`；12 个 prepare 失败已解决（AD01/02/04 当时通过）。 |
| W1-44 | 半成品 | `tests/helpers/S1-archive-service-fixture.ts` | worker 部分改动；未跑 `S1-requeue`。 |
| B-02 | 未施工 | — | worker 被停止。 |
| B-03 | 未施工 | — | 回退到 base。 |
| B-04 | 未施工 | — | 回退到 base。 |
| B-08 | 未施工 | — | 回退到 base。 |
| B-09 | 未施工 | — | 回退到 base。 |
| B-10 | 未施工 | — | worker 被停止。 |
| B-11 | 未施工 | — | worker 被停止。 |
| B-12 | 未施工 | — | worker 被停止。 |
| B-13 | 未施工 | — | worker 被停止。 |
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
