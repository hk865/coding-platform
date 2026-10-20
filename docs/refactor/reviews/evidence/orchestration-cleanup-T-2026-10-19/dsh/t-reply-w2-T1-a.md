# T1 wave 2 回复（lead，2026-10-20）

提交：`5ec8f5e`（本段另有两个检查点提交 `43532e3`、`4c160fa`，均在同一分支）。基线 `w2-base` = `d4c4cea`。

## 1. 逐项结果

| 编号 | 结果 | 改了哪些文件 | 覆盖 | 备注 |
|---|---|---|---|---|
| T1-001 | done | `tests/helpers/S2C-X-scale-fixture.ts` | 无外部消费者；删 :501 导出 | 同时删 `GoalRef`/`StoreResult`/`RecordOrderedLookupPort`/`RecordCountPort`/`RunSupport` 导入，保留 `RecordLookupPort`/`SessionRef` |
| T1-003 | done | `tests/work-graph/A2-control-service.test.ts`、`tests/helpers/task-claim-fixture.ts`、`tests/helpers/S2B-runtime-steps-fixture.ts` | D-9：paused/cancelled 两独立 fixture，拒绝文字与公开读不变 | 真实 `setGoalControl`；entered 分支由真实 Runtime A3 门控；`createSession` 改走 `createSessionOperations` |
| T1-004 | done | `tests/app/A2-continuation-projection.test.ts`、`tests/scenarios/A7-control.test.ts`、`tests/work-graph/A2-control-service.test.ts` | RD-8 的未消费等待 cancel `intent.status === 'queued'` | 先保存真实 cancel 结果并加手算注释，再删原例 |
| T1-005 | done | `tests/scenarios/A7-control.test.ts`、`tests/work-graph/A2-control-service.test.ts` | RUN-14 的 `run.controlState` 断言迁入 A7 真实等待例 | 删 `yieldedRun`、RUN-14、RD-8 两例 |
| T1-007 | done | `tests/work-graph/A2-gate-chain-facts.test.ts` | 只为篡改（AGENTS 第 4 条）；当前门链流程保留 | 删异 subject/ref 轮次例 |
| T1-008 | done | `tests/work-graph/B2-11-script-expansion.test.ts` | `does not go a third level`；带源 :171 的 sha256 | 合并；目标只读一次文件断言保留 |
| T1-009 | done | `tests/work-graph/B2-11-script-expansion.test.ts` | 2,048 字节截断 + `truncated===true`；键用全文 | 用 levels 的更强写法替换 |
| T1-010 | done | `tests/work-graph/B2-11-script-expansion.test.ts`；删 `B2-11-expansion-levels.test.ts` | 五组输入（含 maxFiles=1）全部迁入，断言齐全后删文件 | 读失败两组：真实移走 package.json + 纯注入读失败 |
| T1-011 | done | `tests/work-graph/B2-11-script-expansion.test.ts` | 四目录/四展开/`truncated` 由 `B2-17-disposition-reads.test.ts:34-49` 覆盖 | 删 script-expansion 的四文件上限例；B2-17 未改 |
| T1-012 | done | 新 `tests/helpers/B2-12-recognition-fixture.ts`、`B2-12-recognition.test.ts`、`B2-12-recognition-pure.test.ts` | 两文件逐字相同的构造器 | 纯依赖；pure 文件不 import 测试文件 |
| T1-013 | done | `tests/work-graph/B2-execution-result.test.ts`、`tests/helpers/S2B-runtime-steps-fixture.ts` | 原子结束、链接保留、发现、Task phase 断言保留 | 真实 prepare/start 门控、`linkSessionWork` 返回值、Runtime 真实结束；重放用实际提交请求 |
| T1-014 | done | `tests/work-graph/C1-session-mailbox.test.ts` | 只为篡改；结束后回执重放/新请求 forbidden 见同文件 :336-353 | 删整条释放 Lease 后篡改例 |
| T1-015 | done | `tests/work-graph/C1-session-mailbox.test.ts` | 只为篡改；结束 Run 被拒见 :128-136 | 删 Lease 接续篡改例及 :461-463 |
| T1-019 | done | `tests/work-graph/K3-15-disposition-effects.test.ts` | 参数化 skip_as_done 例（:149-206）已更严 | 删重复卡例 |
| T1-020 | done | `tests/work-graph/K3-16-proposal-round-fixture.test.ts`、`K3-16-second-unfinished-proposal.test.ts` | 首轮断言迁入目标；目标断言更全 | 见 §5：目标路径的提案轮号是 `2` 不是源里的 `1`，按实际断言并加注释 |
| T1-024 | done | `tests/work-graph/R3b-material-applicability.test.ts` | 材料归属/使用范围四条断言保留 | 两个 Workspace/两个 Goal、公开治理/Plan、真实 Session+claim、`submitQueryJob`；正文经 `materials.storeArtifact` |
| T1-025 | partial | `R3d-fixture.ts`、`R3a-goal-replay-boundaries.test.ts`、`R3c-plan-entry.test.ts`、`R3c-plan-adoption.test.ts`、`R3c-task-relations.test.ts` | 五文件 scope/治理/Session 公开化；Project r1、Workspace 经真实 Session+`setLinePins` 升 r2 | R3a :96-99 原始事件 ID/payload 断言无公开等价入口，按刷新保留；见 §2 |
| T1-026 | done | `tests/work-graph/R3e-completion.test.ts`、`tests/composition/R3e-completion-platform.test.ts` | 目标覆盖源全部断言 + 重开重放 | `adoptUnrelatedFutureEdit` 在 `closeBackend` 前；planRef 传 openRequest/completeTask/queryTaskGraph；`completeGoal` 只传 goalRef、结果断言 planRef；本机 bwrap 缺，目标 1 例环境失败 |
| T1-028 | done | `tests/work-graph/R3g-role-spec.test.ts` | 只为篡改；正常持久重放、坏请求、缺失 pin、水位断言保留 | 用正常 schemas；删两处手写 corrupt pointer 和 replay-actor 例 |
| T1-029 | done | `tests/work-graph/R4b-session-boundaries.test.ts` | 1001/601 边界断言保留 | 公开 scope/架构；1000 个公开陪衬 Session + 真实目标；601 公开 `initialLinks` |
| T1-030 | done | `tests/work-graph/R4b-session-boundaries.test.ts` | role_spec Session 过滤断言 | 两种 role 经真实 Runtime `createSession`，按完成回执身份断言 |
| T1-031 | done | `tests/work-graph/R4b-session-directory.test.ts` | initial link cursor 与不存在 Task 拒绝保留 | 公开 bootstrap/治理/Plan；Session 经真实 Runtime |
| T1-032 | done | `tests/work-graph/R4c-execution-history-index.test.ts` | 只为篡改；正常重放/重开/真实存储失败回滚保留 | 删两例及 `mutateRecord`/`seqOfCommitCursor` |
| T1-033 | done | `tests/work-graph/S1-codecs-indexes.test.ts` | SV01 旧格式；其余形状另测 | 删 SV01 及 `OLD_*`/`oldMessageEncoding` 等 |
| T1-034 | done | `tests/work-graph/S1-codecs-indexes.test.ts` | SV03 重复；内存半由 SV02、SQLite 重开由 record-store 覆盖 | 删 SV03 及专用 helper/import |
| T1-036 | **BLOCKED** | 无（改动已回退） | 生产缺 dispatch 记录应抛 unavailable；R7 删除 | 见 §2：白名单外 `S2B-r2-r5-not-entered.test.ts:52-74` 手造旧形状后必失败 |
| T1-037 | done | `tests/work-graph/S2C-lines-attention.test.ts`、`S2C-lines-tiers.test.ts` | 2C-03 (3) 目标例 | 迁入 `own==='standby'` 后删 2C-12 (9) |
| T1-038 | done | `tests/work-graph/S2C-lines-failure.test.ts` | RD-8：真实 wait/reply/A3 接续 claim；waiting_reply 与 pause/cancel busy 保留 | 删 B4 坏 schema、T5x、旧伪造读 |
| T1-039 | done | `tests/work-graph/S2C-lines-scale.test.ts`、`S2C-X-scale-fixture.ts` | 测量目的已完成（slice-2C-SPEC §0.2） | 删测量例及专用计数仪器 |
| T1-040 | done | `S2C-node-detail-anomalies.test.ts`、`S2C-D-node-support.ts`、`S2C-L-runs-support.ts` | 真实暂停/接管/归档/接续；101 锚点；成功页与游标原样委托，仅第二页注入失败 | runId 用真实 claim 身份 |
| T1-041 | done | `tests/work-graph/S2C-node-detail-executions.test.ts` | notes not_available 由 `S4C-node-notes.test.ts` RW-11 覆盖 | 只删 notes 断言与标题字样，执行断言保留 |
| T1-042 | done | `S4A-note-history.test.ts`、`S4A-note-write.test.ts` | N-08 目标已有 pointer/storedState/version 断言 | 删 history 重复 describe |
| T1-043 | done | `S4A-note-history.test.ts`、`S4A-note-write.test.ts` | N-10 目标断言全；测试名带 N-06 | 删 history 重复 describe |
| T1-044 | done | `S4B-memory-anchor-not-found.test.ts`、`S4B-memory-not-found.test.ts` | 目标 M-16 保留 not_found/anchor_not_found | 模块 id 改 A2，并入 candidates；删 MF9 module lookup 例 |
| T1-045 | done | `tests/work-graph/S4B-memory-version-lists.test.ts` | M-10 三版本用例保留 | 删旧 reason `it.skip` |
| T1-046 | done | `S4B-memory-version-lists.test.ts`、`S8A-catalog-version-time.test.ts` | 目标 S8A 断言更全 | 迁 `reasonLabel`，测试名带 M-10；删源 |
| T1-047 | done | `tests/work-graph/S4B-note-symbol-recheck.test.ts` | M-15 在 `S4B-note-anchor-status.test.ts` 保留 | 删重复 MF4 |
| T1-048 | done | `S4B-note-freshness.test.ts`、`S4B-note-budget-check.test.ts` | M-14 保留 readNote/checkNotes；迁入 listByAnchor 页断言 | 测试名带 M-05/M-14；删源 |
| T1-049 | done | `S4C-note-protection.test.ts`、`S4C2-D-rows.test.ts` | D-16 参数化 goal/file 两锚 | 两组执行全部断言后删源 |
| T1-050 | done | `S4C-note-protection.test.ts`、`S4C-resolution-order.test.ts` | RW-8 保留原顺序封锁；迁入 accepted-review/pending-reject 及状态不变 | 删源段 |
| T1-051 | done | `tests/work-graph/S4C-project-understanding.test.ts` | PU-02 断言更多 | 迁 DS-07 的 find 半，名字带 DS-07；删 DS-07 |
| T1-052 | done | `tests/work-graph/S4C2-D-rows.test.ts` | D-17 supersede 覆盖 | 只删 D-06 尾段，保留 pending 三选项 |
| T1-053 | done | `tests/work-graph/S4C2-U3.test.ts`、`tests/helpers/S4A-note-scope-fixture.ts` | 原 invalid 断言保留；:111-178 ordinary disposition→incomplete 不动 | 两卡 A/B、B 真实回执申请 A；A 公开读前后不变；Session 走真实 Runtime |
| T1-054 | done | `tests/work-graph/S4C2-goal-triggers.test.ts` | 3a 真实完成链、3c 连续真实采用、3d 真实 requeue/archive 且保留互斥/claimed；删 3b/e/h | 3a 本机 bwrap 缺，1 例环境失败；生产过滤未改 |
| T1-055 | done | `tests/work-graph/S4C2-project-set-shared.test.ts` | work 用例断言同 | query 输入并入 work 用例（`includeInputs` 两值）；删重复 |
| T1-056 | done | `tests/work-graph/S5R2-queue-history.test.ts` | R2A07（201 Goals）是超集 | 删 R2A08 |
| T1-057 | done | `tests/work-graph/S8A-L8-reminders-pure.test.ts` | public 文件四行/省略/，不确定/还没有观测均覆盖 | 只删指定四例；`catalog=null` 与 T25 起保留 |
| T1-058 | done | `tests/work-graph/S8A-file-layer.test.ts` | 原文件层业务断言全部保留 | scope 改公开 bootstrap/register；删自造 ScopeSeeded |
| T1-059 | done | `tests/work-graph/S8A-path-ownership-dedupe.test.ts` | RW-13 覆盖四语义 | 删 S8A-06b，留 06a |
| T1-060 | done | `tests/work-graph/SP-memory-history-confirm.test.ts` | 行为不可达；SP-13 四版本保留 | 删空 `it.skip` |
| T1-062 | done | `tests/work-graph/W1-future-plan.test.ts` | 原 scenario 1/2、4、6、7 业务断言保留；scenario 9 只留真实 changed-run 拒绝 | 真实 Runtime/检查/完成链；零写入用 A3 commit 计数 + 公开读；本机 scenario 1/2 因 bwrap 1 例环境失败。见 §5：required kind `test`→`static` |
| T1-063 | done | `tests/work-graph/W1-future-plan.test.ts` | 只为篡改；其余断言保留 | 删来源 Plan 义务改写循环 |
| T1-064 | done | `tests/work-graph/W1-future-plan.test.ts` | 只为篡改；codec 校验保留 | 删 scenario 8 后半损坏源例 |
| T1-065 | done | `tests/work-graph/W1-future-plan.test.ts` | 只为篡改；按刷新不再声称 runs-first/lease-before-reduction 覆盖 | 删 corrupt lease helper 与两例，去 `over` 参数 |
| T1-066 | done | `W2-agent-whiteboard.test.ts`、`W2-whiteboard-fixture.ts` | 原四组断言保留；真实 propose 候选 | 共享前置改真实 prepare/start + Runtime 结束；T1 只改四处 |
| T1-068 | partial | `tests/work-graph/goal-independent.test.ts` | Goal 重放/冲突/越权/后端独立断言保留；存在与 revision 改 `queryGoal` | :77-78 原始 `GoalCreated` type/id 断言无公开等价入口，原样保留；见 §2 |
| T1-069 | done | `tests/work-graph/material-readers.test.ts` | 完整 ref 区分、not_found、副本隔离保留 | 两个 Project/四个 Goal/三个 Plan/真实 Session+claim/两次 `submitQueryJob`；期望按请求与固定时钟手算 |
| T2-003 | done | `tests/helpers/S2C-K-scenario-support.ts` | 无消费者 | 删 `LinePageRead`/`sessionRefOf`/`lineWrite` 及 `graphWrite` 导入 |
| T2-021 | done | `tests/runtime/K3-12-review-round-tools.test.ts`、`K3-review-preparation.test.ts` | K3-L13-5 补 envelope tools/writeScope 与 manifest.input，名字带 K3-12；后半段保留 | 删首段及其专用 helper/mock |
| T2-045 | done | 删 `tests/scenarios/K3-19-missing-read-no-round.test.ts` | `K3-19-review-unavailable.test.ts:125-181` + app 能力测试 | 无其他 importer |
| T2-049 | done | `S2C-K-unknown-outcome.test.ts`、`S2C-K-retired.test.ts` | 目标 2C-21 (2) 覆盖 2C-22 (2)/(4) 全部断言 | 目标名带三个规格号；2C-22 (1)/(3) 保留 |
| T2-050 | done | `S2C-K-scenario-support.ts`、两个 S2C-K 场景文件 | 抽共享 crash 流程，接收调用方故障回调 | `damageKernel` 按 A7 留在两份测试文件，未迁入 helper |
| T2-051 | done | `tests/scenarios/S3-query-graph.test.ts` | SC02 业务断言保留；真实 tA RunRef 用于 history 参数 | 删 SQL Run 种子；ArtifactRef 手算；独立 tA 回复、真实 `storeArtifact`；见 §5 的 Kernel runId 说明 |
| T2-052 | done | 新 `tests/scenarios/support/S3-host.ts`、`S3-query-graph.test.ts`、`S3-context-and-inputs.test.ts` | SC01/SC02 保留；S3Host 有 close，两调用方 finally 关闭 | 不迁 `seedCompletedRun`/`runASnapshot`，无 SQL seed |
| T2-059 | done | `tests/state/S2C-line-status.test.ts` | 旧 null conclusion 只为旧数据；2C-22 场景覆盖当前三种结论 | 删 2C-01 该例 |
| T3-090 | done | `tests/helpers/S2C-D-node-support.ts` | 无消费者 | 删 `incompleteAnomalies`；`SessionAnomalyPort` 保留 |
| T3-095 | done | `tests/helpers/W2-whiteboard-fixture.ts` | 无外部消费者 | 删 `W2AgentApplyRequest`，去掉三个内部类型 export |
| T3-096 | done | `W2-whiteboard-fixture.ts`、`A2-disposition-change.test.ts`、`W2-agent-whiteboard.test.ts` | 五处调用均改真实 propose，断言不变 | 四处由 T1-066 先完成；第五处后删 `seedAgentCandidate` 接口/实现/导出 |
| T3-106 | partial | `tests/work-graph/A2-disposition-change.test.ts` | 可达行改真实 claim/prepare/start/stop/check/completeTask；拒绝行按 A6 保留 | 两行 keep：guard 2、guard 9 见 §2；guard 5 本机 bwrap 缺，1 例环境失败 |

## 2. BLOCKED 与 partial 证据

**T1-036（BLOCKED，改动已回退，工作树保持绿）**
- 动作要求：`src/core/work-graph/views/activity-read-helpers.ts` 缺 dispatch 记录时抛 `unavailable`（带 dispatch ref key），并删 `tests/work-graph/S2B-r2-keyed-cap.test.ts` 的 R7。
- 白名单外阻断：`tests/work-graph/S2B-r2-r5-not-entered.test.ts:52-74` 用 `tests/helpers/S2B-r2-track-support.ts:48-82` 手造一条删除 `executionHistory`、没有 dispatch claim 的旧形状 Run；新分支使该例报 `track read failed: {status:'rejected',code:'unavailable',reason:'dispatch claim ... is missing'}`（:69）。
- 需要的文件改动：删除该例，或把它改为断言 `unavailable`（该旧形状当前写者已不再产生，属于 79-1 的旧格式）。该文件不在 T1 白名单，也没有其他 T 条目认领，故按任务书 §2/§3 标 BLOCKED，并回退生产改动与 R7 删除，使最终提交可绿。
- 重新落地顺序：先处理该例，再重做 `activity-read-helpers.ts:176-183` 的 `record === undefined` 分支与 R7 删除。

**T1-025（partial）**
- `tests/work-graph/R3a-goal-replay-boundaries.test.ts:96-99`：仍用 `backend.records.eventAt` 直接断言 `GoalCreated` 的 eventId/payload。`plans.queryGoal` 无事件输出（`src/core/work-graph/model/plan-contracts.ts:44`），无等价公开读；按刷新原样保留，未删未改。其余五文件 scope/治理/Plan/Session 已公开化。
- 另：`R3c-plan-adoption.test.ts` 为保留原断言的 architecture revision 2，在公开 `adoptInitialArchitecture` 后加了公开 `reviseArchitectureCatalog` 一步（动作三步骤之外，特此报告）。

**T1-068（partial）**
- `tests/work-graph/goal-independent.test.ts:77-78`：仍直接断言 `GoalCreated` 的 `eventType`/`eventId`，无等价公开输出；按刷新原样保留。scope 种子已改公开 `createProject`/`registerWorkspace`，Goal 存在与 revision 已改 `plans.queryGoal`。

**T3-106（partial）**
- guard 2 unknown outcome：`tests/work-graph/A2-disposition-change.test.ts:591-596`（seed :593-594，helper :354/:366）。`outcome_unknown` 只能由 Kernel store 损坏产生，属 tamper-only；A7 的 `damageKernel` 仅限两份 S2C-K 场景文件。
- guard 9 ended-run stop race：`tests/work-graph/A2-disposition-change.test.ts:677-701`（seed :682-683，humanStop :689）。公开 `submitControl` 拒绝已结束 Run（`src/core/work-graph/state/control-intent-machine.ts:477-480`），只能在读后手写 stop 指针，属 tamper-only/unreachable。
- 其余可达行已转换；`TASK-19` guard 5 只在本机因缺 bwrap 红（见 §4）。

## 3. 白名单外文件与 FORMAT

- 唯一白名单外改动：`tests/helpers/S2B-runtime-steps-fixture.ts`（任务书 §2 指定的共享真实 Runtime 例外）。新增可选 `observeResult?: (request: GraphWrite<TaskResultObservation>, result: WriteResult<RunSnapshot>) => void`，只在传入时包一层 `recordRunResult`；缺省路径与原来完全一致。供 T1-013 取 Runtime 实际提交的原请求。
- 无 `FORMAT` 适配。
- 最终提交没有 `src/` 改动（T1-036 已回退）。
- 未改 `docs/`、`package.json`、lock、`vendor/`、allowlist。

## 4. 检查

命令：
- `flock ./.typecheck.lock npm run typecheck`：通过（最后一次在 `5ec8f5e` 前）。
- `npm run check:architecture`：`next source boundaries: OK`。
- 测试：`timeout 900 npx vitest run --maxWorkers=2 <files>`，每批 ≤10 文件。
  - 改动过的测试文件（63 个，含本段未提交时的 20 个）分 7 批：**712 tests，693 passed，18 failed（全部为缺 bwrap 的环境失败），1 skipped**。
  - 改动 helper 的 importer（92 个文件，去掉已跑过的 24 个，剩 68 个）分 7 批：**715 tests，707 passed，8 failed（全部为缺 bwrap 的环境失败）**。
  - 环境失败（本机无 `/usr/bin/bwrap`，错误均为 `ENOENT: no such file or directory, access '/usr/bin/bwrap'` 或由它引起的 `expected 'verifying' to be 'satisfied'`）：
    - `tests/scenarios/A7-control.test.ts`：14 例
    - `tests/scenarios/S2C-K-archive-tags-checks.test.ts`：4 例（2C-05 (1)、(3)、(3')、(4)）
    - `tests/work-graph/S3-context-inputs.test.ts`：4 例（IN05、IN11，memory+sqlite）
    - `tests/composition/R3e-completion-platform.test.ts`：1 例
    - `tests/work-graph/A2-disposition-change.test.ts`：1 例（TASK-19 guard 5）
    - `tests/work-graph/S4C2-goal-triggers.test.ts`：1 例（S4C2-3a）
    - `tests/work-graph/W1-future-plan.test.ts`：1 例（scenario 1/2）
  - 说明：A7 的 RD-8 目标例在失败前已通过迁入的 `run.controlState` 断言（:532 已完成 vs waiting）。

Ledger：`python3 -I ./.dsh-ref/d1-ledger.py . w2-base HEAD > ./.dsh-ref/ledger-T1.txt`
- `REMOVED assertion: 263`、`REMOVED test or describe: 67`、`DELETED test files: 2`、`ADDED expected value from a constant: 3`。
- 3 个 added-constant 命中都是本文件内固定时钟字面量 `P1_AT`/`P2_AT`/`P3_AT`（`S4C2-goal-triggers.test.ts:77-79`），不是 `src` 常量或程序输出。
- 无 `LOOSENED` 行，无 `skip/todo/only` 新增，无 raised timeout；D3 `*-pure.test.ts` 命中 0。

映射（文件 → REMOVED 行数（assertion）/ REMOVED test 数 → 编号）：

| 文件 | 行数 | 编号 |
|---|---|---|
| `tests/scenarios/S2C-K-unknown-outcome.test.ts` | 24 / 2 | T2-049 |
| `tests/work-graph/S1-codecs-indexes.test.ts` | 22 / 2 | T1-033、T1-034 |
| `tests/work-graph/W1-future-plan.test.ts` | 18 / 2 | T1-062、T1-063、T1-064、T1-065 |
| `tests/work-graph/R3e-completion.test.ts` | 14 / 1 | T1-026 |
| `tests/work-graph/R3g-role-spec.test.ts` | 11 / 2 | T1-028 |
| `tests/work-graph/S4A-note-history.test.ts` | 10 / 4 | T1-042、T1-043 |
| `tests/work-graph/C1-session-mailbox.test.ts` | 10 / 2 | T1-014、T1-015 |
| `tests/work-graph/K3-16-proposal-round-fixture.test.ts` | 9 / 2 | T1-020 |
| `tests/work-graph/A2-control-service.test.ts` | 9 / 3 | T1-003、T1-004、T1-005 |
| `tests/work-graph/S4B-memory-version-lists.test.ts` | 8 / 1 | T1-045、T1-046 |
| `tests/work-graph/R4b-session-boundaries.test.ts` | 8 / 0 | T1-029、T1-030 |
| `tests/work-graph/S4C2-goal-triggers.test.ts` | 7 / 4 | T1-054 |
| `tests/work-graph/R4c-execution-history-index.test.ts` | 7 / 2 | T1-032 |
| `tests/work-graph/R4b-session-directory.test.ts` | 7 / 0 | T1-031 |
| `tests/work-graph/S8A-L8-reminders-pure.test.ts` | 6 / 4 | T1-057 |
| `tests/work-graph/S4C2-project-set-shared.test.ts` | 6 / 2 | T1-055 |
| `tests/work-graph/S4C-note-protection.test.ts` | 6 / 5 | T1-049、T1-050 |
| `tests/work-graph/S2C-lines-failure.test.ts` | 6 / 2 | T1-038 |
| `tests/work-graph/goal-independent.test.ts` | 5 / 0 | T1-068 |
| `tests/work-graph/B2-11-script-expansion.test.ts` | 5 / 3 | T1-008、T1-009、T1-010、T1-011 |
| `tests/work-graph/A2-disposition-change.test.ts` | 5 / 2 | T3-096、T3-106 |
| `tests/work-graph/S8A-path-ownership-dedupe.test.ts` | 4 / 1 | T1-059 |
| `tests/work-graph/S2C-node-detail-anomalies.test.ts` | 4 / 0 | T1-040 |
| `tests/runtime/K3-12-review-round-tools.test.ts` | 4 / 2 | T2-021 |
| `tests/work-graph/material-readers.test.ts` | 3 / 0 | T1-069 |
| `tests/work-graph/S4C2-U3.test.ts` | 3 / 0 | T1-053 |
| `tests/work-graph/S4C2-D-rows.test.ts` | 3 / 1 | T1-049、T1-052 |
| `tests/work-graph/S4B-note-symbol-recheck.test.ts` | 3 / 1 | T1-047 |
| `tests/work-graph/S4B-memory-anchor-not-found.test.ts` | 3 / 1 | T1-044 |
| `tests/work-graph/S2C-lines-attention.test.ts` | 3 / 1 | T1-037 |
| `tests/work-graph/R3b-material-applicability.test.ts` | 3 / 0 | T1-024 |
| `tests/work-graph/R3a-goal-replay-boundaries.test.ts` | 3 / 0 | T1-025 |
| `tests/work-graph/K3-15-disposition-effects.test.ts` | 3 / 1 | T1-019 |
| `tests/state/S2C-line-status.test.ts` | 3 / 1 | T2-059 |
| `tests/work-graph/S5R2-queue-history.test.ts` | 2 / 1 | T1-056 |
| `tests/work-graph/S4C-project-understanding.test.ts` | 2 / 2 | T1-051 |
| `tests/work-graph/B2-execution-result.test.ts` | 2 / 0 | T1-013 |
| `tests/work-graph/A2-gate-chain-facts.test.ts` | 2 / 1 | T1-007 |
| `tests/helpers/W2-whiteboard-fixture.ts` | 2 / 0 | T1-066、T3-095、T3-096 |
| `tests/work-graph/S4B-note-freshness.test.ts` | 1 / 2 | T1-048 |
| `tests/work-graph/S4B-note-budget-check.test.ts` | 0 / 1 | T1-048（改名并入 M-05） |
| `tests/work-graph/S2C-node-detail-executions.test.ts` | 1 / 1 | T1-041 |
| `tests/work-graph/S2C-lines-scale.test.ts` | 1 / 1 | T1-039 |
| `tests/work-graph/R3c-task-relations.test.ts` | 1 / 0 | T1-025 |
| `tests/work-graph/R3c-plan-entry.test.ts` | 1 / 0 | T1-025 |
| `tests/work-graph/R3c-plan-adoption.test.ts` | 1 / 0 | T1-025 |
| `tests/scenarios/S3-query-graph.test.ts` | 1 / 0 | T2-051 |
| `tests/composition/R3e-completion-platform.test.ts` | 1 / 0 | T1-026 |
| `tests/work-graph/S4A-note-write.test.ts` | 0 / 1 | T1-043（改名带 N-06） |
| `tests/work-graph/S8A-catalog-version-time.test.ts` | 0 / 1 | T1-046（改名带 M-10） |
| `tests/scenarios/S2C-K-retired.test.ts` | 0 / 1 | T2-049（改名带三个规格号） |
| `tests/runtime/K3-review-preparation.test.ts` | 0 / 1 | T2-021（改名带 K3-12） |

删除文件 2 个：`tests/scenarios/K3-19-missing-read-no-round.test.ts`（T2-045，1 tests/23 expects）、`tests/work-graph/B2-11-expansion-levels.test.ts`（T1-010，8 tests/31 expects）。无未映射的删除。

Shortstat：`git diff --shortstat w2-base HEAD` = **76 files changed, 3633 insertions(+), 4589 deletions(-)**。

## 5. 疑似任务书/条目问题

1. **T1-036 的白名单核对漏了一个 importer**：`tests/work-graph/S2B-r2-r5-not-entered.test.ts:52-74` 手造无 history、无 dispatch claim 的旧形状 Run。book-check 的调用链表只核了 `activity-read-model`/`track-read-model` 等，未列该测试；而它正是新 unavailable 分支的命中点。建议给该例一个删除/转换条目后再落地 T1-036。
2. **T1-020 的 `round:1` 在目标路径上不成立**：目标先记录 review round，再记录 proposal round，因此同一 stateEntry 的首个提案轮号是 `2`（`K3-16-second-unfinished-proposal.test.ts`）。合并后的断言用 `round: 2` 并加注释；轮号属性保留。若坚持源字面量 `1`，该合并无法成立。
3. **T1-062 的 required requirement kind**：源草稿用 `'test'`，但真实注册检查只有 static/dynamic；为走 `runRegisteredCheck` 把 requirement kind 与 policy `requirementKinds` 改为 `static`（公开输入），业务断言未动。请 lead 确认这是可接受的公开输入适配。
4. **T2-051 的 `toContain(RUN_A.runId)` 前提有误**：`look_graph history` 页携带的是 Kernel `executionIdentity.runId`（`krun-...`，`src/core/agent-runtime/execution-history-contracts.ts:23`），从不是平台 `RunRef.runId`。已改为 `toContain(<tA 的 Kernel runId>)`，该值来自 tA 的真实 `readExecution` 公开 locator；history 脚本参数仍用真实 `tA.runRef`。
5. **T1-025 的 Project/architecture revision 2**：公开 `adoptInitialArchitecture` 只写 r1；为保留原断言，后续调用公开 `reviseArchitectureCatalog` 写出同内容 r2（不在动作列的三步内），请确认。
6. **环境**：本机无 bwrap，上述 5 个直接改动文件 + 2 个 importer 的 26 例只能在 lead 的 bwrap 环境复核；这些例在失败前都已走过被转换的公开路径（A7 的 RD-8 断言、R3e 的 adopt/重开、W1 的 adopt、S4C2 的 plan/adopt 等）。
7. **T1-053 的共享前置仍有残余**：`tests/helpers/S4C2-note-card-fixture.ts:170-193` 的 `createAuxSession` 仍自行写 Kernel Session；该文件不在白名单且 T1-053 用例不经它，未改，供 lead 另立条目。

## 6. HANDOFF（给 18:00 后的新 Session）

- 本段已完成并提交：`5ec8f5e`；工作树干净（只剩未入库的 `.dsh-ref/`；`.typecheck.lock` 已删除）。
- 已完成条目：见 §1 中 `done` 的全部条目；`partial` 为 T1-025、T1-068、T3-106；`BLOCKED` 为 T1-036。
- 没有半改文件；所有改动已提交，typecheck 与 architecture 绿。
- 下一步优先级：
  1. 给 T1-036 增加/指定 `tests/work-graph/S2B-r2-r5-not-entered.test.ts:52-74` 的删除或转换条目；然后重做 `activity-read-helpers.ts:176-183` 的 `record === undefined` → `rejected('unavailable', 'dispatch claim <refKey> is missing')`，并删 `S2B-r2-keyed-cap.test.ts:61-77` 的 R7。
  2. 对 T1-025 的 `R3a:96-99`、T1-068 的 `goal-independent:77-78` 原始事件断言，lead 决定是保留、删除还是补公开事件读入口。
  3. T3-106 的 guard 2（`A2:591-596`）与 guard 9（`A2:677-701`）两行需要 lead 裁决定性；其余已真实化。
  4. 在带 bwrap 的环境重跑 §4 列出的 7 个环境失败文件；预期只剩真正的代码问题（当前无）。
  5. 核对 §5 的 2/3/4/5 四项适配是否接受；如不接受，按条目回退对应测试输入。
- 本段没有动 `src/`；若下一段落地 T1-036，`production-reach` allowlist 无需改动（函数签名和声明未变）。
