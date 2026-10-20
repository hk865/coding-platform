# T W1 rework 2 回复（W1R2）

基线 `w1r1` = `ed26c44`；本回合提交 `1c31c27`（`T W1 rework 2`），只改 `tests/`。下表的 `done` 都以本回合在最终树上跑过的测试为准。

## 1. 逐行

| 编号 | 结果 | 改了哪些文件 | 备注 |
|---|---|---|---|
| W2-01 | done | `tests/runtime/source-binding-migration.test.ts` | 用 `createTaskClaimFixture` + `createS2BRuntimeSteps` 真实 prepare/start；A3 门持住 model，access 在 running 时打开并读到内容，真实 finish 后同一 access 再读得到 `forbidden`；memory/SQLite 双后端。查的是每请求的检查，不是第一次授权的缓存（`source-capture-access.ts:169`、`:324`）。 |
| W2-02 | done | `tests/composition/platform.test.ts` | 公开 `createProject`+`registerWorkspace`+`createGoal`+`proposePlan`/`readPlanProposal` 造出 Goal 和 candidate Plan；`adopt_initial_plan` 请求补全 `{meta,input}`，只改 `kind`；`queryGoal` 与 `readPlanProposal` 前后相等；保留 `unsupported` 与双后端。 |
| W2-03 | done | `tests/helpers/S2B-track-fixture.ts` | 只删八个未使用 import 名：`JsonValue`、`continuationBriefDigest`、`renderContinuationBriefZh`、`assembleAnomalySection`、`assembleContinuationBrief`、`PreparedQueryManifestV1`、`PreparedTaskManifestV1`、`QUERY_MANIFEST_CONTENT_TYPE`。 |
| W2-04 | done | `tests/helpers/S2B-track-fixture.ts` | 只改注释：真实 prepare 已接；entered/end 仍手写，因为 W1-15 仍 BLOCKED。 |
| W2-05 | done | `tests/helpers/S5-decision-fixture.ts` | 只改注释：默认公开 adopt 空 module catalog；`modules` 公开 adopt M/N。 |
| W2-06 | done | `tests/runtime/source-binding-migration.test.ts` | 标题改为 `limits a bound Reviewer to candidate source`；未恢复已删的 digest 子例。 |
| W2-07 | done | `tests/work-graph/R4c-execution-history-index.test.ts` | occupied-slot 行改为真实 claim/prepare/start/finish 的第一 Run，locator 来自 `readExecution`；第二 Task 在同一 Session 公开 claim；只有被拒请求带第一 Run 的真实 identity；`readExecution` 前后整体相等；保留 `busy` 与零变化。 |
| W2-08 | partial（probe 一步 BLOCKED） | `tests/work-graph/R4c-execution-read.test.ts` | 手写 `enter`/`end` 换成 S2B 真实 start + `crashed` 失败 end；保留公开 requeue、新 Session claim、archive 与 Session/Lease 断言。Host probe→`unavailable` 一步保留 wave-1 `retire()` 形态：见 §2。 |
| W2-09 | done | `tests/work-graph/S3-prepared-context-admission.test.ts` | AD03 的拒绝前后都用公开 `readExecution` 读 tB 与真实 tA Run 并整体比较；保留 `idempotency_conflict` 与零 commit。 |
| W2-10 | done | `tests/work-graph/S3-prepared-context-admission.test.ts` | AD06 移入 `describe('rejects: …')`；在 Workspace@7 真实 prepare/authorize/begin；A2 让 Kernel store 只在 begin 后的 boundary read 不可读（随后恢复），Run 停在 `starting`/`entering`；Host `reconcileRun` W-05 证明 not-entered 并 revoke；一个 changed binding 被拒 `invalid`；保留 fixed binding/envelope/authorization/revision 与零 commit；`:481` 注释已修。 |
| W2-11 | BLOCKED（按 R-5 回退） | `tests/work-graph/S5-request-candidates.test.ts` | 找不到能证明 request slot 没有 claim 的公开读：`src/core/work-graph/tasks/plan-readers.ts:598` 跳过 `requestRef=null`，`src/core/work-graph/model/decision-contracts.ts:247-256` 的 `readRequestCandidate` 只给 head/status。已恢复 base 的 `storeSnapshot`/claim 断言并注明 BLOCKED。 |
| W2-12 | done | `tests/work-graph/S5-request-candidates.test.ts` | 在 `readPlanProposal` 前恢复 `storeSnapshot()` 与 `allocationCounts` 快照，读后 `toEqual`；它数 `newId`/`now`/`bodyPut`，不是 F7 store read。 |
| W2-13 | done | `tests/work-graph/S2B-r2-s-preentry-control.test.ts` | 删掉两行关于 fold 文件保留旧用例的旧注释。 |
| W2-14 | 无测试改动（回复项） | — | B-11 的删除维持（R-4）；`tests/state/plan-machine.test.ts:670-672` 直接给 `unsupported`，没有直接跑 `src/core/work-graph/tasks/plan-validation.ts:337-338` 的物理移除检查；由 lead 加入 L-2。 |
| W2-15 | done | `tests/work-graph/S3-prepared-context-admission.test.ts` | 删掉 raw `runA` 与 Workspace@5 raw seed；Workspace 公开 register @1，再六次公开 `setLinePins` 到 @7；两个 Session 走公开 `sessions/create`；upstream tA 是真实 claim + prepare + `start` + `finish(completed)`，old-A 的 origin 用这个真实 Run。 |
| W2-16 | done | `tests/scenarios/S2C-K-legacy-provenance.test.ts` | P 公开建、真实 claim、公开 cancel unentered Run、公开 requeue；C 用公开 `sessions/create` 的 continuation provenance（from P）建，再带 `requeueRef` 真实 claim。恢复 indexed、every item is execution、`[TASK_ID, TASK_ID]` 三项；保留公开未 claim Query，旧 backfill 步骤仍删。 |
| W2-17 | partial | `tests/runtime/R4c-graph-history.test.ts` | direct/evidence/mutation 三处都改成真实第二 Run（R-7 prepare/start；frozen upper 处用 A3 门持住）；identity 与 positions 取自 `readExecution`。evidence 的 wave-1 later-Turn zero-match 子例按 R-4 删除：见 §2。 |
| W2-18 | done | `tests/work-graph/S3-context-inputs.test.ts` | 三个 raw `RunSnapshot` seed 删除；改为真实 claim（tA→runA、tB→runB）+ R-7 start/finish。IN14 用真实 mailbox 在 entered runA 上 send、runB 上 reply；message id 用手推字面量（`session-message-66ca4e…`，文件 `:151`）断言，状态改走真实 mailbox read。`runA2` 因同一 Task 的第二次 first-claim 被 `run-machine.ts:646` 拒而删除；IN05 改用真实 runB 作不同 owner，`forbidden` 断言未变。 |
| W2-19 | done | `tests/work-graph/S3-context-inputs.test.ts` | IN11 改为真实 `openVerification`→`beginCheck`→`recordCheckResult`→`finalizeChecks`；head revision 4（open@1、begin@2、record@3、finalize@4）在注释里手算；`reportRef` 用真实 record 步返回的 Artifact，旧的 `newRef` 期望按裁定去掉。 |
| W2-20 | done | `tests/app/S2B-r2-backfill-done-cursor.test.ts`、`tests/helpers/S2B-activity-fixture.ts` | fixture 加 `workTaskIds`（默认仍是 12）并公开 `claimWork`；103 个真实 Run 走 R-7 prepare/start，模型门内同 Runtime `observeRun`，finish 时只让终结的全历史 activity re-read 失败一次（`kernelStores` A2 wrapper），得 `unknown(history_read_failed)` 且 Run 仍结束；中间 101 个真实回填后再造两端候选；被测回填用真实 `countRunActivity`、`readRecordCap:3`、`batchRuns:1`。原分页/ counted 断言全保留并加强。实测 ~5.3s，未提 60s 超时。`seedLegacyActivity` 删除（无其他用户）。 |
| W2-21 | done | `tests/helpers/S5-decision-fixture.ts`、`tests/app/S5-decision-routes.test.ts` | Project@1 公开 `createProject`；Workspace@1 公开 `registerWorkspace`，再加/移一个真实 Session 由 `setLinePins` 到 @3（只写 lineSettings）；三个 Goal 公开 create（@1），公开 reorder A/B/C 得 A@1、B@2、C@2，再公开 setGoalSettings 5/4/4 次到 pre-adoption @6（`pausedB` B 少一次到 @5，propose/apply@6，现有 pause@7）。计数理由写在循环上方。公开 seed 链用独立 id 计数器，主 `newId`/`eventId` 序列与旧 seed 相同。R-4：`S5-decision-routes.test.ts:246` 只去掉 `decisionSettings` 部分，保留 `revision:3`，拒绝与 unchanged 断言未动。 |
| W2-22 | 无改动（keep BLOCKED） | — | 真实 start 在模型调用前拒 `requeue_task`（`src/core/agent-runtime/execution-driver.ts:239-243`）；生产无 Agent requeue owner 的 Runtime 工具入口（GAP-46/L-3）。 |
| W2-23 | done | `tests/work-graph/B2-execution-entry.test.ts` | 改成 A6：A 真实 prepare/start/finish 后真实占 Kernel slot；B 在同一 Session 公开 claim；A3 门停在 B 真实 `beginRuntimeEntry` 前，保存 B 的真实 permit 和最新 pin；唯一被拒输入是 B 的 permit + A 的真实 identity（`readExecution` 返回）；保留 `rejected`/`busy` 与 B 的 `readExecution` 前后相等；放门后 B 真实 begin 进入并结束。 |
| W2-24 | done | `tests/work-graph/S3-graph-context.test.ts` | GR world 改为公开链：createProject/registerWorkspace（w/w2）、governance、公开 adopt M1/M2/M3、createGoal g/g2、propose/apply p1/p2g、公开 `sessions/create` A/B/Q（requestIds `gr-session-88/92/44`，手推 id 且均不含 `b`）、真实 claim A/B、R-7 起停两个 Run、真实 `openVerification`；Query 保留 submit/claim。Plan 加 Goal-level `finish` gate（在 stage s 外，持 oB），保留 tA/tB、oB/vB、依赖边和 instruction。GR10 用基于 p1 的 propose/apply 切 p2。GR06/GR07 断言真实 Session/run/round refs，GR17 用 SB 完整真实 id；GR01/02/10/19 与 M2 排除未动。 |
| W2-25 | done | `tests/runtime/R4c-graph-history.test.ts` | 改为 A6：claim + 真实 start/finish，公开读第一页取非空 cursor；唯一被拒输入是该 cursor 只改外层 `u` 为真实 end+1；断言收紧为 `source_stale`（不再允许 `source_stale|invalid`），并有公开读证明 execution 未变。 |

## 2. BLOCKED / partial 证据

- **W2-08（probe 一步）**：`tests/work-graph/R4c-execution-read.test.ts` 保留 `f.retire()`。真实 probe 只在 Kernel DB 文件不存在时给 `missing`（`src/core/agent-runtime/session-operations.ts:1029-1031`）；本 fixture 的 DB 是真实可读文件（`tests/helpers/task-claim-fixture.ts:367`），实验里真实 probe 返回 `ready`/`activeRunId:null`，health 是 `available`，而 health owner 只在 `missing/damaged` 时写 `unavailable`（`src/core/work-graph/sessions/session-health.ts:121`）；没有公开步骤删/坏这个 DB，故该步按 R-5/R-9 保留。其余步骤已真实化。
- **W2-11（整行）**：`src/core/work-graph/tasks/plan-readers.ts:598` 读候选时跳过 `requestRef=null`；`RequestCandidatePort`（`src/core/work-graph/model/decision-contracts.ts:247-256`）只有 head/status，没有 request-slot claim 的公开读。一个错误抢了 claim 的 proposal 仍能通过 head 检查，故按表回退 base 的 `storeSnapshot`/claim 断言并标 BLOCKED。
- **W2-17（later-Turn 子例）**：wave-1 的 later-Turn zero-match 子例按 R-4 删除。Run 活着时 Kernel 拒绝同一 Session 的第二 Turn（`vendor/coding-agent/patches/app/composition/composition-root.ts:287`）；Run 结束后固定 `endPosition` 无法覆盖后来的 Turn（`src/core/work-graph/state/run-machine.ts:1258`）。没有另造第三种路径。该文件其余三处均为真实第二 Run。

## 3. R-6（发现表事实与代码不符）

本回合没有 `未施工（R-6 事实不符）` 的行。表内自带的两个 R-6 改正已落实：W2-20 的候选是 `unknown(history_read_failed)` 而非“没有活动记录”；W2-24 的 runB 不必保持 running、两任务 Plan 必须加 Goal gate。没有提出新的 R-6。

## 4. 删除项

| 文件 | 测试/内容 | 裁定 | 理由或 cover |
|---|---|---|---|
| `tests/helpers/S2B-activity-fixture.ts` | `seedLegacyActivity`（及类型/返回） | W2-20 | 真实 end 必在同一 commit 带 activity fact（`src/core/agent-runtime/execution-observation.ts:775`、`src/core/work-graph/tasks/execution-entry-service.ts:1916-1942`），没有活动记录的旧 Run 不再是合法回填入参；R9 已改用真实 unknown，其他文件不再使用。`writeActivity`/`countedFacts` 保留（14/18 个其他测试仍用）。 |
| `tests/work-graph/R4c-graph-history.test.ts` | wave-1 later-Turn zero-match 子例（旧 `it` `preserves the original evidence and advances on zero matches…` 的后半） | W2-17 / R-4 | `vendor/coding-agent/patches/app/composition/composition-root.ts:287`、`src/core/work-graph/state/run-machine.ts:1258`；前半的 byte-for-byte evidence 断言保留并改用真实第二 Run。 |
| `tests/work-graph/R4c-graph-history.test.ts` | 旧 `it('rejects a terminal end that falls below the frozen upper bound as stale')` | W2-25 | 改写为 A6 `describe('rejects: a graph-history cursor whose outer upper is above the real end')`，断言语义更严（只 `source_stale`）。 |
| `tests/app/S5-decision-routes.test.ts:246` | `decisionSettings: {schemaVersion:1,noticeSeen:{}}` 前置条件（只这一段） | W2-21 / R-4 | `src/core/work-graph/state/notice-settings-machine.ts:56-62` 没有“已持久化但 noticeSeen 为空”的公开写入口；`revision:3`、拒绝和 unchanged 断言保留。 |
| `tests/helpers/S2B-track-fixture.ts` | 八个 import 名 | W2-03 | 只删死 import；无断言变化。 |
| `tests/work-graph/S2B-r2-s-preentry-control.test.ts:9` | 两行旧 fold 注释 | W2-13 | 注释描述的旧用例已被 rework 1 删除。 |

无删除测试文件；无删除或放宽其他断言。

## 5. `FORMAT` seeds（R-2）

无。没有仍在 BLOCKED 形态、需要按当前 codec 补字段的手写 seed。W2-11 回退的是 base 的 `storeSnapshot`/claim 读取，不是 FORMAT seed。

## 6. 行外文件与共享 helper 追加

- **`tests/helpers/S2B-runtime-steps-fixture.ts`（唯一行外文件，rule 4 由 lead 改）**：新增三个可选选项，默认路径不变：
  - `beforeBegin?: ({permit, kernel}) => Promise<void> | void`：A3 门，真实 start 在 `beginRuntimeEntry` 前 await；W2-10、W2-23 用。
  - `workspaceRevision?: number`：Host 向 Runtime 报的 Workspace revision，默认 1；W2-10、W2-24 用。
  - `kernelStores?: KernelStoreRegistry`：默认仍是 fixture 自己的单个 `r4c-claim-kernel` store；W2-20 用 A2 wrapper 只让一次全历史 activity re-read 失败。
- 其他被改的 helper 都是行内文件：`S2B-activity-fixture.ts`（W2-20：`workTaskIds`、`claimWork`、`viewOf`、删 `seedLegacyActivity`）、`S5-decision-fixture.ts`（W2-21/05：公开 seed 链、独立 id 计数器、`LINE_SETTINGS_RECORD_SCHEMAS`、`readGoalSettings`）、`S2B-track-fixture.ts`（W2-03/04：import 与注释）。
- 没有改 `src/`、`docs/`、`vendor/coding-agent/dist`、`package.json` 或任一 lock 文件。`.dsh-ref/` 未提交；`.typecheck.lock` 是会话开始前就存在的未跟踪文件。

## 7. 检查

- `flock ./.typecheck.lock npm run typecheck`：**通过**。中途因 S5 fixture / S3-context-inputs / S3-graph-context 的 6 个纯类型错误修过两轮（`createdProject.value` 收窄、`RoleBindingFactsPort`、`CompletionPolicyContentV1.schemaVersion` 字面量），只改类型/取法，未动断言；修后复跑全绿。
- `npm run check:architecture`：**通过**（`next source boundaries: OK`，D3 hits 0）。
- 改过的测试文件（14 个，分两批，`timeout 900`、`--maxWorkers=2`）：
  - 批 1（7 文件）：47 passed / 0 failed。
  - 批 2（7 文件）：229 passed / 0 failed。
- 改过 helper 的 importer（115 个测试文件，12 批，每批 ≤10、`timeout 900`、`--maxWorkers=2`）：
  - 00: 10 文件 34 passed；01: 10 文件 132 项，131 passed / 1 failed；02: 68 passed；03: 69 passed；04: 136 passed；05: 71 passed；06: 118 passed；07: 30 passed；08: 122 passed；09: 44 passed；10: 117 passed；11: 5 文件 96 passed。
  - 合计 1,037 项：1,036 passed / 1 failed。唯一失败是环境失败：`tests/app/orchestration-mechanism.test.ts` > `runs two explicitly selected same-Goal Tasks in independent Sessions with overlapping real provider calls`，错误 `ENOENT: no such file or directory, access '/usr/bin/bwrap'`。没有其他失败。
- ledger：`python3 -I ./.dsh-ref/d1-ledger.py . w1r1 HEAD > ./.dsh-ref/ledger-W1R2.txt`。45 REMOVED assertion、4 REMOVED test/describe、1 LOOSENED、0 DELETED files；53 行（含 3 条 ADDED constant）全部映射如下。

| 文件 | REMOVED/LOOSENED 行 | 编号 |
|---|---|---|
| `tests/app/S5-decision-routes.test.ts` | :246 `decisionSettings` 前置（REMOVED） | W2-21 |
| `tests/composition/platform.test.ts` | :111 旧 `queryGoal` 对比（REMOVED；改为 `goalBefore`+`proposalBefore` 双读） | W2-02 |
| `tests/runtime/R4c-graph-history.test.ts` | :193,:392,:400,:429,:448,:547,:577,:580,:584,:586,:587,:593,:595,:596,:597,:598,:735,:773（REMOVED）；:532 旧 `it` 名（REMOVED test） | W2-17 |
| `tests/runtime/R4c-graph-history.test.ts` | :617,:623,:635,:640,:641（REMOVED）；:601 旧 `it` 名（REMOVED test） | W2-25 |
| `tests/runtime/R4c-graph-history.test.ts` | LOOSENED :917 | W2-17（**误报**：严格 `toEqual([{kind:'run',ref:fixture.runs.b}])` 仍在 :916；脚本把同 hunk 的 `not.toContainEqual` 配到了旧的 `toEqual`） |
| `tests/runtime/source-binding-migration.test.ts` | :158,:160,:164,:179（REMOVED） | W2-01 |
| `tests/runtime/source-binding-migration.test.ts` | :195 旧标题（REMOVED test） | W2-06 |
| `tests/scenarios/S2C-K-legacy-provenance.test.ts` | :45,:103（REMOVED） | W2-16 |
| `tests/work-graph/B2-execution-entry.test.ts` | :175,:182,:184（REMOVED） | W2-23 |
| `tests/work-graph/R4c-execution-history-index.test.ts` | :650,:664,:667,:669（REMOVED） | W2-07 |
| `tests/work-graph/R4c-execution-read.test.ts` | :222（REMOVED） | W2-08 |
| `tests/work-graph/S3-context-inputs.test.ts` | :763（REMOVED） | W2-19 |
| `tests/work-graph/S3-graph-context.test.ts` | :865,:866,:1201,:1215（REMOVED）；:1134 旧 `it` 名（REMOVED test） | W2-24 |
| `tests/work-graph/S3-prepared-context-admission.test.ts` | :615（REMOVED） | W2-10 |

- ADDED constant（不是 src 常量，不影响 D1 结论）：`tests/app/S2B-r2-backfill-done-cursor.test.ts:157,:169` 的 `COUNTED_RUNS` 是测试内手写 101（W2-20）；`tests/work-graph/S3-context-inputs.test.ts:878` 的 `DECISION_MESSAGE_ID` 是手推字面量（W2-18）。
- `git diff --shortstat w1r1 HEAD`：**18 files changed, 1803 insertions(+), 1168 deletions(-)**。
- commit：`1c31c27 T W1 rework 2`（未提交 `.dsh-ref/` 与 `.typecheck.lock`）。

## 8. 表或本文件的可疑处

- 本任务多处要求用 `rg`，但本环境没有 `rg`（`command -v rg` 为空）；本次全部用 `grep -n`/`grep -rn` 代替。不影响结果，但会与任务书的命令字面不同。
- W2-08 的写法预设 Host probe 能真实给出 `missing`；实际真实 probe 只在 Kernel DB 文件不存在时给 `missing`，而本 fixture 的 DB 是真实文件，故该步不可达（见 §2）。建议 lead 确认是否接受这个 BLOCKED 一步。
- W2-17 的 evidence 子例里 later-Turn zero-match 部分被 R-4 删除；表只写了“direct/evidence/mutation 已用变量”，没有明确这一小段的去留，建议 lead 在下一轮看是否接受这个 R-4 判断。
- W2-21 的 107 个 importer 里，本回合实际跑了 115 个 helper importer 文件（含 S5 的 82 个），除 §7 的一处 bwrap 外全绿；如果 lead 的 107 计数含 helper 文件本身，数目口径可能不同。
- ledger 的 LOOSENED :917 是脚本的 hunk 配对误报，严格断言仍在（见 §7）。

## 9. HANDOFF

- **done**：W2-01..W2-25 全部按表处理（W2-14/W2-22 为无测试改动项）；commit `1c31c27`（18 个 `tests/` 文件，+1803/−1168）；ledger `./.dsh-ref/ledger-W1R2.txt`；shortstat 已跑；`flock ./.typecheck.lock npm run typecheck` 与 `npm run check:architecture` 在本回合最后一次均为绿。暂停后再次确认：`git status --short` 只有会话开始前就存在的 `?? .typecheck.lock`，`git diff --stat` 为空，`git show --stat HEAD` 确认提交只含 18 个 `tests/` 文件。
- **half done**：无。W2-08 的 Host probe 一步、W2-11 整行是表允许的 R-5 BLOCKED；W2-17 的 later-Turn 子例是 R-4 删除，不是半成品。
- **not started**：无。
- **next session must know**：
  - 共享 helper `tests/helpers/S2B-runtime-steps-fixture.ts` 现在有 `beforeBegin`、`workspaceRevision`、`kernelStores` 三个可选选项，默认路径不变；W2-10/20/23/24 依赖它们。
  - S5 fixture 的公开 seed 链用了独立计数器 `publicSeedSeq`/`seedEventId`/`seedNewId`；**不要**把 project/workspace/goal/settings 的公开调用接回主 `newId`/`eventId`，否则 `K3-48-2` 的 156,720 字节字面量会偏 2（本回合踩过，已修为 156,720 全绿）。
  - W2-08 的 probe 步与 W2-11 是 R-5 回退；W2-17 的 later-Turn 子例是 R-4 删除，证据见 §2。
  - 环境失败只有 `tests/app/orchestration-mechanism.test.ts` 的 `ENOENT /usr/bin/bwrap`；带 bwrap 的全量由 lead 跑。
  - 没有改 `src/`、`docs/`、`vendor/coding-agent/dist`、`package.json` 或 lock 文件；`.dsh-ref/` 未提交。

