# G6 notes 2026-11-17（运行号 g6-2026-11-17-1f29fa08）

## 逐场景判据

### E05：fail

- C 行：C-182, C-183, C-185, C-71, C-73, C-191, C-208, C-217, C-218；自治档 `after_plan_confirmation`；provider `deepseek` / `deepseek-v4.1-flash`。
- 用量：输入 10795621（含缓存命中），输出 83154，缓存命中 9814912，Query 请求 91。

| 判据 | C 行 | 结果 | 说明 |
|---|---|---|---|
| overlap | C-182, C-183, C-217 | fail | t-users 1 个 Run、t-orders 2 个 Run，没有一对在不同 Session 上时间重叠 |
| gate | C-185 | pass | 门：module core，等待 t-orders，在跑 t-users/b0a602b9-3c65-482b-851d-18e1bebdbd77；放行 人（rejected） |
| paths | C-185, C-217 | pass | files/compare 给出：.workbench/notes/fb64de9dbeaa6a9616e9f647e8ab3335/1a438a31-46c4-48b4-90b9-3db14ffcef0b.md, .workbench/notes/fb64de9dbeaa6a9616e9f647e8ab3335/89052163-f7bc-4d39-b038-6816a738a1d2.md, .workbench/notes/fb64de9dbeaa6a9616e9f647e8ab3335/c5385e68-1e6e-46a2-b8ab-f56211a7a86e.md, .workbench/notes/fb64de9dbeaa6a9616e9f647e8ab3335/fbf478f9-2108-46c2-adaa-2c4d7d5e4a17.md, src/orders.js, src/rules.js, src/users.js, test/orders.test.js, test/users.test.js |
| kept | C-185 | pass | t-users satisfied，t-orders satisfied |
| single-occupancy | C-71 | pass | 3 个 Run，没有同 Session 时间重叠 |
| convention | C-208 | pass | rules.js 定义 isEmail：true；users/orders 都从 rules 引用 |
| duplicates | C-208 | fail | 成功的 project_source（duplicates:true）结果 0 个，候选 0 条，没有一条的两处位置之一是 src/legacy/contact-check.js |
| reviewer | C-208, C-218 | uncovered (entry-missing) | 接不上：轮 {"aggregateType":"VerificationRound","projectId":"36810528aa39d10db66a2a07c1ad97e3","workspaceId":"fb64de9dbeaa6a9616e9f647e8ab3335","goalId":"g6-e05-mwkd7734-25","taskId":"t-users","runId":"b0a602b9-3c65-482b-851d-18e1bebdbd77","roundId":"d03e6465-7121-431a-b6fb-4451317edde3"} 没有可读的正式审阅 Evidence（审阅要求状态 pass） |
| name-different | C-208 | uncovered (entry-missing) | 接不上：轮 {"aggregateType":"VerificationRound","projectId":"36810528aa39d10db66a2a07c1ad97e3","workspaceId":"fb64de9dbeaa6a9616e9f647e8ab3335","goalId":"g6-e05-mwkd7734-25","taskId":"t-users","runId":"b0a602b9-3c65-482b-851d-18e1bebdbd77","roundId":"d03e6465-7121-431a-b6fb-4451317edde3"} 没有可读的正式审阅 Evidence（审阅要求状态 pass） |
| name-same | C-208 | uncovered (entry-missing) | 接不上：轮 {"aggregateType":"VerificationRound","projectId":"36810528aa39d10db66a2a07c1ad97e3","workspaceId":"fb64de9dbeaa6a9616e9f647e8ab3335","goalId":"g6-e05-mwkd7734-25","taskId":"t-users","runId":"b0a602b9-3c65-482b-851d-18e1bebdbd77","roundId":"d03e6465-7121-431a-b6fb-4451317edde3"} 没有可读的正式审阅 Evidence（审阅要求状态 pass） |
| temporary | C-208 | fail | 计划外的未跟踪文件：.workbench/notes/fb64de9dbeaa6a9616e9f647e8ab3335/1a438a31-46c4-48b4-90b9-3db14ffcef0b.md, .workbench/notes/fb64de9dbeaa6a9616e9f647e8ab3335/89052163-f7bc-4d39-b038-6816a738a1d2.md, .workbench/notes/fb64de9dbeaa6a9616e9f647e8ab3335/c5385e68-1e6e-46a2-b8ab-f56211a7a86e.md, .workbench/notes/fb64de9dbeaa6a9616e9f647e8ab3335/fbf478f9-2108-46c2-adaa-2c4d7d5e4a17.md |
| line-choice | C-73, C-191 | uncovered (entry-missing) | 公开读口不给派工时的候选线和六键排序依据（lines/list 只给结果），驱动看不到排除和排序本身 |

- driver-start t-users: ready running
- driver-start t-orders: ready running
- driver-start goal: ready running
- planted src/legacy/contact-check.js: ready
- planted src/legacy/is-email.js: ready
- E05 Goal ended COMPLETED

### E06：fail

- C 行：C-75, C-135, C-106, C-194, C-149, C-151, C-68, C-181, C-209, C-219, C-223；自治档 `after_plan_confirmation`；provider `deepseek` / `deepseek-v4.1-flash`。
- 用量：输入 260790（含缓存命中），输出 2369，缓存命中 227456，Query 请求 5。

| 判据 | C 行 | 结果 | 说明 |
|---|---|---|---|
| handoff | C-219 | fail | the platform did not do it: initialization/adopt: rejected invalid the initial-planning answer is not valid JSON |
| successor-input | C-75, C-209, C-219 | uncovered (not-run) | stopped before this check: initialization/adopt: rejected invalid the initial-planning answer is not valid JSON |
| successor-frontier | C-75 | uncovered (not-run) | stopped before this check: initialization/adopt: rejected invalid the initial-planning answer is not valid JSON |
| no-restatement | C-209 | uncovered (not-run) | stopped before this check: initialization/adopt: rejected invalid the initial-planning answer is not valid JSON |
| excluded-path | C-209 | uncovered (not-run) | stopped before this check: initialization/adopt: rejected invalid the initial-planning answer is not valid JSON |
| same-task-new-run | C-135 | uncovered (not-run) | stopped before this check: initialization/adopt: rejected invalid the initial-planning answer is not valid JSON |
| history-continuity | C-106, C-194 | uncovered (not-run) | stopped before this check: initialization/adopt: rejected invalid the initial-planning answer is not valid JSON |
| restart-running | C-149 | uncovered (not-run) | stopped before this check: initialization/adopt: rejected invalid the initial-planning answer is not valid JSON |
| restart-paused | C-151 | uncovered (not-run) | stopped before this check: initialization/adopt: rejected invalid the initial-planning answer is not valid JSON |
| archive | C-219 | uncovered (not-run) | stopped before this check: initialization/adopt: rejected invalid the initial-planning answer is not valid JSON |
| hand-or-drop | C-223 | uncovered (not-run) | stopped before this check: initialization/adopt: rejected invalid the initial-planning answer is not valid JSON |
| wake | C-68, C-181 | uncovered (not-run) | stopped before this check: initialization/adopt: rejected invalid the initial-planning answer is not valid JSON |

- stopped: not-run: initialization/adopt: rejected invalid the initial-planning answer is not valid JSON
- goal-confirm:goal.confirmDraft:c9c452a3c0adee5c37a204a2990c3d2f2ed0338717269a4147ca533589238967 (PLANNING): pause because E06 ended: committed

### E08：fail

- C 行：C-47, C-62, C-63, C-133a, C-126, C-46, C-52, C-116, C-118, C-210；自治档 `every_step`；provider `deepseek` / `deepseek-v4.1-flash`。
- 用量：输入 2880454（含缓存命中），输出 37780，缓存命中 2634368，Query 请求 29。

| 判据 | C 行 | 结果 | 说明 |
|---|---|---|---|
| autonomy-born | C-133a | pass | 草稿自治 every_step；Goal 生在版本 1，采用后读到 every_step |
| confirm-only-latest | C-47 | pass | 同一草稿换 commandId 再确认：rejected revision_conflict |
| person-adopts | C-46, C-52 | pass | 人确认之前 goals/list 里没有这个 Goal（0 个旧 Goal）；首方案由人 initialization/adopt |
| first-adoption | C-63, C-62 | pass | 采用回执 plan initial-plan-0d443e4e3cfb136e9bd05fcfd86837af；Goal 指针 {"aggregateType":"PlanRevision","projectId":"f2dd029c96081f0b0c9c1415754fa000","planId":"initial-plan-0d443e4e3cfb136e9bd05fcfd86837af"} |
| versions | C-210 | fail | the platform did not do it: the platform stopped: no_new_basis on task-div |
| switch | C-210 | uncovered (not-run) | stopped before this check: the platform stopped: no_new_basis on task-div |
| old-evidence | C-210 | uncovered (not-run) | stopped before this check: the platform stopped: no_new_basis on task-div |
| required-cancel | C-210 | uncovered (not-run) | stopped before this check: the platform stopped: no_new_basis on task-div |
| autonomy-later | C-126 | uncovered (not-run) | 草稿本来就是 every_step，这次没有中途改档 |
| control-pins | C-116, C-118 | pass | 只钉 Goal 的暂停：rejected invalid |

- the person selected idea 1 of 2 on the change: 保持两个独立任务：div 与 mul 并行
- requeue card task-mul (after Run 67301ad6-b83d-4f52-a7ac-828eb385a62a): committed
- node review task-sub (calc.js, test/sub.test.js): committed
- node review task-mul (calc.js, test/mul.test.js): committed
- requeue card task-div (after Run da3677fd-7f9c-4a57-b73c-8f4f26717adc): committed
- requeue card task-div (after Run 43dceb02-8bc9-4edc-a222-f24ebed696ff): committed refused {"ref":{"aggregateType":"TaskReworkRefusal","projectId":"f2dd029c96081f0b0c9c1415754fa000","goalId":"goal-confirm:goal.confirmDraft:9db612f73c294de30cd32aa4cae30c1ba716c94be31d440e8382a1ede0f022d5","taskId":"task-div","operation":"requeue","subjectId":"43dceb02-8bc9-4edc-a222-f24ebed696ff"},"revision":1,"schemaVersion":1,"task":{"projectId":"f2dd029c96081f0b0c9c1415754fa000","goalId":"goal-confirm:goal.confirmDraft:9db612f73c294de30cd32aa4cae30c1ba716c94be31d440e8382a1ede0f022d5","taskId":"task-div"},"afterRunRef":{"aggregateType":"Run","projectId":"f2dd029c96081f0b0c9c1415754fa000","goalId":"goal-confirm:goal.confirmDraft:9db612f73c294de30cd32aa4cae30c1ba716c94be31d440e8382a1ede0f022d5","runId":"43dceb02-8bc9-4edc-a222-f24ebed696ff"},"subjectRoundRef":{"aggregateType":"VerificationRound","projectId":"f2dd029c96081f0b0c9c1415754fa000","workspaceId":"e3d4593fdf19a0661dda3867909fe362","goalId":"goal-confirm:goal.confirmDraft:9db612f73c294de30cd32aa4cae30c1ba716c94be31d440e8382a1ede0f022d5","taskId":"task-div","runId":"43dceb02-8bc9-4edc-a222-f24ebed696ff","roundId":"b22d0417-d5ba-4ed3-a4d1-d794b7e2f81b"},"failureClass":"check_failed","code":"no_new_basis","reason":"no new basis: same failure, source, plan as TaskRequeue da3677fd-7f9c-4a57-b73c-8f4f26717adc; supply new input or change the method","basisDigest":"4901cf052e1d115abf07f09d0560e06981634f02896c4136d9675272354e66e4","source":{"workspaceRevision":1,"sourceDigest":"89318771fd5df648553420415ce058aee0770c726d6b34685ae544356f0d2f07"},"matchedRequeueRef":{"aggregateType":"TaskRequeue","projectId":"f2dd029c96081f0b0c9c1415754fa000","goalId":"goal-confirm:goal.confirmDraft:9db612f73c294de30cd32aa4cae30c1ba716c94be31d440e8382a1ede0f022d5","taskId":"task-div","afterRunId":"da3677fd-7f9c-4a57-b73c-8f4f26717adc"},"requestedBy":{"kind":"human","id":"g6-person"},"refusedAt":"2026-11-17T07:44:26.822Z","goalEndedRunsAtRefusal":5,"configurationRevision":null}
- stopped: not-run: the platform stopped: no_new_basis on task-div
- goal-confirm:goal.confirmDraft:9db612f73c294de30cd32aa4cae30c1ba716c94be31d440e8382a1ede0f022d5 (NEEDS_DECISION): pause because E08 ended: committed

### E09：fail

- C 行：C-185, C-89, C-65, C-98, C-93, C-95, C-99, C-55, C-62, C-211, C-212, C-218；自治档 `after_plan_confirmation`；provider `deepseek` / `deepseek-v4.1-flash`。
- 用量：输入 12695126（含缓存命中），输出 88414，缓存命中 11725568，Query 请求 83。

| 判据 | C 行 | 结果 | 说明 |
|---|---|---|---|
| executor-reports | C-185, C-211 | fail | the platform did not do it: the platform stopped: auto_rework_cap_reached on t-b |
| adviser-explains | C-211 | uncovered (not-run) | stopped before this check: the platform stopped: auto_rework_cap_reached on t-b |
| person-decides | C-211, C-62 | uncovered (not-run) | stopped before this check: the platform stopped: auto_rework_cap_reached on t-b |
| new-version | C-211, C-55 | uncovered (not-run) | stopped before this check: the platform stopped: auto_rework_cap_reached on t-b |
| formal-change | C-212 | uncovered (not-run) | stopped before this check: the platform stopped: auto_rework_cap_reached on t-b |
| drift | C-212, C-89 | uncovered (not-run) | stopped before this check: the platform stopped: auto_rework_cap_reached on t-b |
| observation-after-adopt | C-65 | pass | 采用后观测 {"aggregateType":"ObservedArchitecture","projectId":"dde1b2be52da2a7f62359df7114d3a21","workspaceId":"b8f4b6500e8aa383c0770da9290853a9","captureId":"729533c4-3688-444f-89d5-c6fadd1cbf7e"} |
| observation-after-pass | C-98 | uncovered (not-run) | stopped before this check: the platform stopped: auto_rework_cap_reached on t-b |
| rounds | C-93, C-95, C-218 | uncovered (not-run) | stopped before this check: the platform stopped: auto_rework_cap_reached on t-b |
| uncovered-round | C-99 | uncovered (not-run) | stopped before this check: the platform stopped: auto_rework_cap_reached on t-b |

- stopped: not-run: the platform stopped: auto_rework_cap_reached on t-b
- goal-confirm:goal.confirmDraft:b1cd6165e00f9b683681be4356a5bc87999ba9c16681834536be6035637e8f81 (NEEDS_DECISION): pause because E09 ended: committed

### E12：uncovered

- C 行：C-36, C-42, C-157, C-88, C-89, C-104, C-145, C-146, C-158, C-147, C-155, C-207, C-114, C-215, C-220；自治档 `after_plan_confirmation`；provider `deepseek` / `deepseek-v4.1-flash`。
- 用量：输入 988478（含缓存命中），输出 14374，缓存命中 814336，Query 请求 20。

| 判据 | C 行 | 结果 | 说明 |
|---|---|---|---|
| reads-quiet | C-36 | uncovered (not-run) | stopped before this check: request 629d45d6-57cc-4fec-b796-0a6e3616098b of intervention-planning-23c325a175db926424cc1c5e82f4b7e689c858bfe69cc277892d8a4b7bb9cc36 has usage unknown and its Query has not ended yet; new work waits for its terminal fact; it did not end within 30 min |
| graph-cards | C-88, C-89 | uncovered (not-run) | stopped before this check: request 629d45d6-57cc-4fec-b796-0a6e3616098b of intervention-planning-23c325a175db926424cc1c5e82f4b7e689c858bfe69cc277892d8a4b7bb9cc36 has usage unknown and its Query has not ended yet; new work waits for its terminal fact; it did not end within 30 min |
| raw-history | C-42, C-157 | uncovered (not-run) | stopped before this check: request 629d45d6-57cc-4fec-b796-0a6e3616098b of intervention-planning-23c325a175db926424cc1c5e82f4b7e689c858bfe69cc277892d8a4b7bb9cc36 has usage unknown and its Query has not ended yet; new work waits for its terminal fact; it did not end within 30 min |
| completion-chain | C-104 | uncovered (not-run) | stopped before this check: request 629d45d6-57cc-4fec-b796-0a6e3616098b of intervention-planning-23c325a175db926424cc1c5e82f4b7e689c858bfe69cc277892d8a4b7bb9cc36 has usage unknown and its Query has not ended yet; new work waits for its terminal fact; it did not end within 30 min |
| restart-state | C-145, C-215 | uncovered (not-run) | stopped before this check: request 629d45d6-57cc-4fec-b796-0a6e3616098b of intervention-planning-23c325a175db926424cc1c5e82f4b7e689c858bfe69cc277892d8a4b7bb9cc36 has usage unknown and its Query has not ended yet; new work waits for its terminal fact; it did not end within 30 min |
| reconcile | C-146 | uncovered (not-run) | stopped before this check: request 629d45d6-57cc-4fec-b796-0a6e3616098b of intervention-planning-23c325a175db926424cc1c5e82f4b7e689c858bfe69cc277892d8a4b7bb9cc36 has usage unknown and its Query has not ended yet; new work waits for its terminal fact; it did not end within 30 min |
| redrive-sets | C-155 | uncovered (not-run) | stopped before this check: request 629d45d6-57cc-4fec-b796-0a6e3616098b of intervention-planning-23c325a175db926424cc1c5e82f4b7e689c858bfe69cc277892d8a4b7bb9cc36 has usage unknown and its Query has not ended yet; new work waits for its terminal fact; it did not end within 30 min |
| new-goal | C-114, C-158 | uncovered (not-run) | stopped before this check: request 629d45d6-57cc-4fec-b796-0a6e3616098b of intervention-planning-23c325a175db926424cc1c5e82f4b7e689c858bfe69cc277892d8a4b7bb9cc36 has usage unknown and its Query has not ended yet; new work waits for its terminal fact; it did not end within 30 min |
| history-reuse | C-220 | uncovered (not-run) | stopped before this check: request 629d45d6-57cc-4fec-b796-0a6e3616098b of intervention-planning-23c325a175db926424cc1c5e82f4b7e689c858bfe69cc277892d8a4b7bb9cc36 has usage unknown and its Query has not ended yet; new work waits for its terminal fact; it did not end within 30 min |
| stale-premise | C-220 | uncovered (not-run) | stopped before this check: request 629d45d6-57cc-4fec-b796-0a6e3616098b of intervention-planning-23c325a175db926424cc1c5e82f4b7e689c858bfe69cc277892d8a4b7bb9cc36 has usage unknown and its Query has not ended yet; new work waits for its terminal fact; it did not end within 30 min |
| replay | C-147 | uncovered (not-run) | stopped before this check: request 629d45d6-57cc-4fec-b796-0a6e3616098b of intervention-planning-23c325a175db926424cc1c5e82f4b7e689c858bfe69cc277892d8a4b7bb9cc36 has usage unknown and its Query has not ended yet; new work waits for its terminal fact; it did not end within 30 min |
| wait-registry | C-207 | uncovered (not-run) | stopped before this check: request 629d45d6-57cc-4fec-b796-0a6e3616098b of intervention-planning-23c325a175db926424cc1c5e82f4b7e689c858bfe69cc277892d8a4b7bb9cc36 has usage unknown and its Query has not ended yet; new work waits for its terminal fact; it did not end within 30 min |

- stopped: not-run: request 629d45d6-57cc-4fec-b796-0a6e3616098b of intervention-planning-23c325a175db926424cc1c5e82f4b7e689c858bfe69cc277892d8a4b7bb9cc36 has usage unknown and its Query has not ended yet; new work waits for its terminal fact; it did not end within 30 min
- E12 ended: request 629d45d6-57cc-4fec-b796-0a6e3616098b of intervention-planning-23c325a175db926424cc1c5e82f4b7e689c858bfe69cc277892d8a4b7bb9cc36 has usage unknown and its Query has not ended yet; new work waits for its terminal fact; it did not end within 30 min

### iteration：uncovered

- C 行：C-108, C-109, C-110, C-111, C-112, C-105, C-107, C-113, C-194, C-213, C-226；自治档 `after_plan_confirmation`；provider `-` / `-`。
- 用量：输入 -（含缓存命中），输出 -，缓存命中 -，Query 请求 -。

| 判据 | C 行 | 结果 | 说明 |
|---|---|---|---|
| ideas | C-108 | uncovered (not-run) | stopped before this check: request 629d45d6-57cc-4fec-b796-0a6e3616098b of intervention-planning-23c325a175db926424cc1c5e82f4b7e689c858bfe69cc277892d8a4b7bb9cc36 has usage unknown and its Query has not ended yet; new work waits for its terminal fact; it did not end within 30 min |
| select | C-109 | uncovered (not-run) | stopped before this check: request 629d45d6-57cc-4fec-b796-0a6e3616098b of intervention-planning-23c325a175db926424cc1c5e82f4b7e689c858bfe69cc277892d8a4b7bb9cc36 has usage unknown and its Query has not ended yet; new work waits for its terminal fact; it did not end within 30 min |
| candidate | C-110 | uncovered (not-run) | stopped before this check: request 629d45d6-57cc-4fec-b796-0a6e3616098b of intervention-planning-23c325a175db926424cc1c5e82f4b7e689c858bfe69cc277892d8a4b7bb9cc36 has usage unknown and its Query has not ended yet; new work waits for its terminal fact; it did not end within 30 min |
| what-changed | C-213, C-110 | uncovered (not-run) | stopped before this check: request 629d45d6-57cc-4fec-b796-0a6e3616098b of intervention-planning-23c325a175db926424cc1c5e82f4b7e689c858bfe69cc277892d8a4b7bb9cc36 has usage unknown and its Query has not ended yet; new work waits for its terminal fact; it did not end within 30 min |
| per-request | C-111 | uncovered (not-run) | stopped before this check: request 629d45d6-57cc-4fec-b796-0a6e3616098b of intervention-planning-23c325a175db926424cc1c5e82f4b7e689c858bfe69cc277892d8a4b7bb9cc36 has usage unknown and its Query has not ended yet; new work waits for its terminal fact; it did not end within 30 min |
| why | C-112, C-226 | uncovered (not-run) | stopped before this check: request 629d45d6-57cc-4fec-b796-0a6e3616098b of intervention-planning-23c325a175db926424cc1c5e82f4b7e689c858bfe69cc277892d8a4b7bb9cc36 has usage unknown and its Query has not ended yet; new work waits for its terminal fact; it did not end within 30 min |
| continues | C-105 | uncovered (not-run) | stopped before this check: request 629d45d6-57cc-4fec-b796-0a6e3616098b of intervention-planning-23c325a175db926424cc1c5e82f4b7e689c858bfe69cc277892d8a4b7bb9cc36 has usage unknown and its Query has not ended yet; new work waits for its terminal fact; it did not end within 30 min |
| request-goal | C-107 | uncovered (not-run) | stopped before this check: request 629d45d6-57cc-4fec-b796-0a6e3616098b of intervention-planning-23c325a175db926424cc1c5e82f4b7e689c858bfe69cc277892d8a4b7bb9cc36 has usage unknown and its Query has not ended yet; new work waits for its terminal fact; it did not end within 30 min |
| cards-ask | C-113 | uncovered (not-run) | stopped before this check: request 629d45d6-57cc-4fec-b796-0a6e3616098b of intervention-planning-23c325a175db926424cc1c5e82f4b7e689c858bfe69cc277892d8a4b7bb9cc36 has usage unknown and its Query has not ended yet; new work waits for its terminal fact; it did not end within 30 min |
| multi-round | C-194 | uncovered (not-run) | stopped before this check: request 629d45d6-57cc-4fec-b796-0a6e3616098b of intervention-planning-23c325a175db926424cc1c5e82f4b7e689c858bfe69cc277892d8a4b7bb9cc36 has usage unknown and its Query has not ended yet; new work waits for its terminal fact; it did not end within 30 min |

- stopped: not-run: request 629d45d6-57cc-4fec-b796-0a6e3616098b of intervention-planning-23c325a175db926424cc1c5e82f4b7e689c858bfe69cc277892d8a4b7bb9cc36 has usage unknown and its Query has not ended yet; new work waits for its terminal fact; it did not end within 30 min

### intervention：uncovered

- C 行：C-199, C-200, C-201, C-202, C-203, C-114, C-189, C-192, C-197, C-198；自治档 `after_plan_confirmation`；provider `-` / `-`。
- 用量：输入 -（含缓存命中），输出 -，缓存命中 -，Query 请求 -。

| 判据 | C 行 | 结果 | 说明 |
|---|---|---|---|
| ask-copy | C-198 | uncovered (not-run) | stopped before this check: request 629d45d6-57cc-4fec-b796-0a6e3616098b of intervention-planning-23c325a175db926424cc1c5e82f4b7e689c858bfe69cc277892d8a4b7bb9cc36 has usage unknown and its Query has not ended yet; new work waits for its terminal fact; it did not end within 30 min |
| delivery-states | C-189, C-192 | uncovered (not-run) | stopped before this check: request 629d45d6-57cc-4fec-b796-0a6e3616098b of intervention-planning-23c325a175db926424cc1c5e82f4b7e689c858bfe69cc277892d8a4b7bb9cc36 has usage unknown and its Query has not ended yet; new work waits for its terminal fact; it did not end within 30 min |
| continue-no-planning | C-199 | uncovered (not-run) | stopped before this check: request 629d45d6-57cc-4fec-b796-0a6e3616098b of intervention-planning-23c325a175db926424cc1c5e82f4b7e689c858bfe69cc277892d8a4b7bb9cc36 has usage unknown and its Query has not ended yet; new work waits for its terminal fact; it did not end within 30 min |
| planning-when-idle | C-199, C-200 | uncovered (not-run) | stopped before this check: request 629d45d6-57cc-4fec-b796-0a6e3616098b of intervention-planning-23c325a175db926424cc1c5e82f4b7e689c858bfe69cc277892d8a4b7bb9cc36 has usage unknown and its Query has not ended yet; new work waits for its terminal fact; it did not end within 30 min |
| four-endings | C-201, C-202, C-203 | uncovered (not-run) | stopped before this check: request 629d45d6-57cc-4fec-b796-0a6e3616098b of intervention-planning-23c325a175db926424cc1c5e82f4b7e689c858bfe69cc277892d8a4b7bb9cc36 has usage unknown and its Query has not ended yet; new work waits for its terminal fact; it did not end within 30 min |
| completed-goal | C-114 | uncovered (not-run) | stopped before this check: request 629d45d6-57cc-4fec-b796-0a6e3616098b of intervention-planning-23c325a175db926424cc1c5e82f4b7e689c858bfe69cc277892d8a4b7bb9cc36 has usage unknown and its Query has not ended yet; new work waits for its terminal fact; it did not end within 30 min |
| paused-queues | C-197 | uncovered (not-run) | stopped before this check: request 629d45d6-57cc-4fec-b796-0a6e3616098b of intervention-planning-23c325a175db926424cc1c5e82f4b7e689c858bfe69cc277892d8a4b7bb9cc36 has usage unknown and its Query has not ended yet; new work waits for its terminal fact; it did not end within 30 min |

- stopped: not-run: request 629d45d6-57cc-4fec-b796-0a6e3616098b of intervention-planning-23c325a175db926424cc1c5e82f4b7e689c858bfe69cc277892d8a4b7bb9cc36 has usage unknown and its Query has not ended yet; new work waits for its terminal fact; it did not end within 30 min

### waiting：uncovered

- C 行：C-170, C-171, C-187, C-188, C-190, C-172, C-184, C-189, C-192, C-195, C-196, C-207, C-224, C-225；自治档 `after_plan_confirmation`；provider `-` / `-`。
- 用量：输入 -（含缓存命中），输出 -，缓存命中 -，Query 请求 -。

| 判据 | C 行 | 结果 | 说明 |
|---|---|---|---|
| wait-open | C-188, C-225 | uncovered (not-run) | stopped before this check: request 629d45d6-57cc-4fec-b796-0a6e3616098b of intervention-planning-23c325a175db926424cc1c5e82f4b7e689c858bfe69cc277892d8a4b7bb9cc36 has usage unknown and its Query has not ended yet; new work waits for its terminal fact; it did not end within 30 min |
| restart-kept | C-170, C-207 | uncovered (not-run) | stopped before this check: request 629d45d6-57cc-4fec-b796-0a6e3616098b of intervention-planning-23c325a175db926424cc1c5e82f4b7e689c858bfe69cc277892d8a4b7bb9cc36 has usage unknown and its Query has not ended yet; new work waits for its terminal fact; it did not end within 30 min |
| expiry-once | C-171, C-190 | uncovered (not-run) | stopped before this check: request 629d45d6-57cc-4fec-b796-0a6e3616098b of intervention-planning-23c325a175db926424cc1c5e82f4b7e689c858bfe69cc277892d8a4b7bb9cc36 has usage unknown and its Query has not ended yet; new work waits for its terminal fact; it did not end within 30 min |
| second-expiry | C-171, C-190, C-224 | uncovered (not-run) | stopped before this check: request 629d45d6-57cc-4fec-b796-0a6e3616098b of intervention-planning-23c325a175db926424cc1c5e82f4b7e689c858bfe69cc277892d8a4b7bb9cc36 has usage unknown and its Query has not ended yet; new work waits for its terminal fact; it did not end within 30 min |
| consumes | C-187 | uncovered (not-run) | stopped before this check: request 629d45d6-57cc-4fec-b796-0a6e3616098b of intervention-planning-23c325a175db926424cc1c5e82f4b7e689c858bfe69cc277892d8a4b7bb9cc36 has usage unknown and its Query has not ended yet; new work waits for its terminal fact; it did not end within 30 min |
| late-reply | C-224, C-189 | uncovered (not-run) | stopped before this check: request 629d45d6-57cc-4fec-b796-0a6e3616098b of intervention-planning-23c325a175db926424cc1c5e82f4b7e689c858bfe69cc277892d8a4b7bb9cc36 has usage unknown and its Query has not ended yet; new work waits for its terminal fact; it did not end within 30 min |
| transfer | C-224 | uncovered (not-run) | stopped before this check: request 629d45d6-57cc-4fec-b796-0a6e3616098b of intervention-planning-23c325a175db926424cc1c5e82f4b7e689c858bfe69cc277892d8a4b7bb9cc36 has usage unknown and its Query has not ended yet; new work waits for its terminal fact; it did not end within 30 min |
| disconnect | C-195, C-196 | uncovered (not-run) | stopped before this check: request 629d45d6-57cc-4fec-b796-0a6e3616098b of intervention-planning-23c325a175db926424cc1c5e82f4b7e689c858bfe69cc277892d8a4b7bb9cc36 has usage unknown and its Query has not ended yet; new work waits for its terminal fact; it did not end within 30 min |
| supply-order | C-172, C-192, C-184 | uncovered (not-run) | stopped before this check: request 629d45d6-57cc-4fec-b796-0a6e3616098b of intervention-planning-23c325a175db926424cc1c5e82f4b7e689c858bfe69cc277892d8a4b7bb9cc36 has usage unknown and its Query has not ended yet; new work waits for its terminal fact; it did not end within 30 min |

- stopped: not-run: request 629d45d6-57cc-4fec-b796-0a6e3616098b of intervention-planning-23c325a175db926424cc1c5e82f4b7e689c858bfe69cc277892d8a4b7bb9cc36 has usage unknown and its Query has not ended yet; new work waits for its terminal fact; it did not end within 30 min

## 撞墙表

| 时间 | 场景 | 哪一步 | 看到的拒绝原文和理由 | 类别 | 预期 | 建议包 |
|---|---|---|---|---|---|---|
| 2026-11-17T07:13:59.249Z | A1 | core/completion-policies/read | not_found: project 800c2728c01d8381c32f2e73c3ed8ebc has no active CompletionPolicy | 无理由 | expected | 待定 |
| 2026-11-17T07:15:01.494Z | A1 | tool run_readonly_command (call call_00_9kuoRxPwzoyxmWvVMxXm3448) | execution_failed: 命令退出码 2 | 无理由 | - | 待定 |
| 2026-11-17T07:15:01.572Z | A1 | tool look_graph (call call_02_LQlXQVTrZ8ZQU6wtVFxd9758) | execution_failed: the note memory read port is not bound for this Run | 无理由 | - | 待定 |
| 2026-11-17T07:15:15.980Z | B1 | core/completion-policies/read | not_found: project g6-wb has no active CompletionPolicy | 无理由 | expected | 待定 |
| 2026-11-17T07:16:18.331Z | B1 | tool record_note (call call_00_l6LiV0epP3a8Ns29z5Kv4535) | invalid_arguments: 工具参数不符合 schema：kind: Invalid option: expected one of "convention"\|"pitfall"\|"tradeoff"\|"open_question"\|"preference"\|"decision" | 无理由 | - | 待定 |
| 2026-11-17T07:16:41.484Z | E05 | tool read (call call_00_kI9NzEQONwtO3SX22guE6426) | permission_denied: 请求路径不在允许范围 | 无理由 | - | 待定 |
| 2026-11-17T07:16:50.850Z | E05 | tool run_readonly_command (call call_00_9cW2xwfO4fnXjDYT0PUw4153) | execution_failed: 命令退出码 1 | 无理由 | - | 待定 |
| 2026-11-17T07:17:03.103Z | E05 | tool submit_initial_plan (call call_00_iKugsN7bMaZ4BDgw6JcO5726) | invalid: the answer has problems; fix every one and call the tool again in this round | 无理由 | - | 待定 |
| 2026-11-17T07:17:58.601Z | E05 | tool look_graph (call call_02_yee3jr3byo1djb4uqpyjdlco) | forbidden: the Task node is outside the requested goal | 无理由 | - | 待定 |
| 2026-11-17T07:18:34.642Z | E05 | tool look_graph (call call_01_qzZARN7FZNDxhX2nY1EI7215) | invalid_arguments: 工具参数不符合 schema：(根): Invalid input | 无理由 | - | 待定 |
| 2026-11-17T07:18:37.365Z | E05 | tool look_graph (call call_00_W5BInCSGu7IMwercduAl7755) | invalid_arguments: 工具参数不符合 schema：(根): Invalid input | 无理由 | - | 待定 |
| 2026-11-17T07:18:37.439Z | E05 | tool read_execution_history (call call_01_MgXcmbPRhwOkWYNqSAOB0990) | capacity: the complete graph tool result exceeds 48 KiB; request a smaller page or drill down into one node | 协调 | - | 待定 |
| 2026-11-17T07:18:40.392Z | E05 | tool look_graph (call call_01_giQAxJsCMDJ3wwh7PZyI1074) | invalid_arguments: 工具参数不符合 schema：(根): Invalid input | 无理由 | - | 待定 |
| 2026-11-17T07:19:04.654Z | E05 | tool read_execution_history (call call_00_1mSB8NaZCxXsQu1bScMi2217) | invalid: afterCursor is not a continuation cursor for this frozen history range (Run d3638798-1fb1-4fe5-9885-34bbf097da28) | 无理由 | - | 待定 |
| 2026-11-17T07:19:24.682Z | E05 | tool read_execution_history (call call_00_XGLff4ETQFj7Iy9UaDDh1281) | invalid: afterCursor is not a continuation cursor for this frozen history range (Run d3638798-1fb1-4fe5-9885-34bbf097da28) | 无理由 | - | 待定 |
| 2026-11-17T07:20:04.362Z | E05 | tool look_graph (call call_01_PYtczCyxD3eEIgmDdUcS5771) | invalid_arguments: 工具参数不符合 schema：(根): Invalid input | 无理由 | - | 待定 |
| 2026-11-17T07:22:22.565Z | E05 | tool list_files (call call_03_7pnvtebpu9da7frucy3gjhln) | execution_failed: ENOENT: no such file or directory, open '/proc/self/fd/45/test' | 无理由 | - | 待定 |
| 2026-11-17T07:22:31.775Z | E05 | tool look_graph (call call_02_jhoxqiorsw998wvilycsn2j6) | invalid_arguments: 工具参数不符合 schema：(根): Invalid input | 无理由 | - | 待定 |
| 2026-11-17T07:22:31.783Z | E05 | tool find_graph (call call_03_xqcyhng9h7h9wjwbupfdkq0c) | invalid_arguments: 工具参数不符合 schema：(根): Invalid input | 无理由 | - | 待定 |
| 2026-11-17T07:22:36.698Z | E05 | tool look_graph (call call_00_fxgzd806b6d955g753l9zjzp) | invalid_arguments: 工具参数不符合 schema：(根): Invalid input | 无理由 | - | 待定 |
| 2026-11-17T07:22:36.708Z | E05 | tool find_graph (call call_01_sp8degr5f5qc32g0m41w07cl) | invalid_arguments: 工具参数不符合 schema：(根): Invalid input | 无理由 | - | 待定 |
| 2026-11-17T07:22:46.791Z | E05 | tool write (call call_00_ma1phxr3bpt0k2grlk89t0ww) | unknown_tool: 工具不可用 | 无理由 | - | 待定 |
| 2026-11-17T07:22:54.791Z | E05 | tool edit (call call_01_czbyzf9vp6bewdl01vm8bbmp) | execution_failed: test/users.test.js 不存在 | 无理由 | - | 待定 |
| 2026-11-17T07:23:12.390Z | E05 | tool look_graph (call call_70ed5e48cc024fbba5eb1a2c) | execution_failed: the note memory read port is not bound for this Run | 无理由 | - | 待定 |
| 2026-11-17T07:23:12.396Z | E05 | tool find_graph (call call_47ea22545ae24cb3be179a72) | execution_failed: the note memory read port is not bound for this Run | 无理由 | - | 待定 |
| 2026-11-17T07:24:08.123Z | E05 | tool look_graph (call call_01_mxoalg3re8cuj0jzdg6wz8kl) | invalid_arguments: 工具参数不符合 schema：(根): Invalid input | 无理由 | - | 待定 |
| 2026-11-17T07:24:08.341Z | E05 | tool read_execution_history (call call_02_zc01t3jzhncr3tw5q9wfciks) | capacity: the complete graph tool result exceeds 48 KiB; request a smaller page or drill down into one node | 协调 | - | 待定 |
| 2026-11-17T07:24:10.604Z | E05 | tool look_graph (call call_90e43429277249d28d825681) | execution_failed: the note memory read port is not bound for this Run | 无理由 | - | 待定 |
| 2026-11-17T07:24:19.253Z | E05 | tool look_graph (call call_01_mlvht5nqx72m8zzb3xv6fx08) | invalid_arguments: 工具参数不符合 schema：(根): Invalid input | 无理由 | - | 待定 |
| 2026-11-17T07:24:27.988Z | E05 | tool read_execution_history (call call_01_tbc3f0yqkwy00wq3lgf9rtyu) | capacity: the complete graph tool result exceeds 48 KiB; request a smaller page or drill down into one node | 协调 | - | 待定 |
| 2026-11-17T07:25:50.490Z | E05 | tool read_execution_history (call call_00_ernl6omyg5cdo72ykd4qvuz7) | invalid: afterCursor is not a continuation cursor for this Session and execution identity (Run b0a602b9-3c65-482b-851d-18e1bebdbd77) | 无理由 | - | 待定 |
| 2026-11-17T07:26:50.834Z | E05 | tool read_execution_history (call call_00_jcg99r5kbjxb8w0cudlhrjds) | capacity: the complete graph tool result exceeds 48 KiB; request a smaller page or drill down into one node | 协调 | - | 待定 |
| 2026-11-17T07:27:54.408Z | E05 | tool read_execution_history (call call_00_d9tvf1bwkclq8zqofkxdu4lp) | invalid: afterCursor is not a continuation cursor for this Session and execution identity (Run b0a602b9-3c65-482b-851d-18e1bebdbd77) | 无理由 | - | 待定 |
| 2026-11-17T07:29:01.585Z | E05 | tool read_execution_history (call call_00_nk20qdydcnk3x5rb78a42p5u) | invalid: afterCursor is not a continuation cursor for this Session and execution identity (Run b0a602b9-3c65-482b-851d-18e1bebdbd77) | 无理由 | - | 待定 |
| 2026-11-17T07:29:22.859Z | E05 | tool read_execution_history (call call_00_30tcyvequ6k8hv7txc133bca) | invalid: afterCursor is not a continuation cursor for this Session and execution identity (Run b0a602b9-3c65-482b-851d-18e1bebdbd77) | 无理由 | - | 待定 |
| 2026-11-17T07:29:36.008Z | E05 | tool read_execution_history (call call_00_q1gokrmowkzfb7k1p1dam5u9) | invalid: afterCursor is not a continuation cursor for this Session and execution identity (Run b0a602b9-3c65-482b-851d-18e1bebdbd77) | 无理由 | - | 待定 |
| 2026-11-17T07:32:34.914Z | E05 | core/goals/overlap-release | invalid: the overlap gate is already satisfied | 无理由 | - | 待定 |
| 2026-11-17T07:32:40.085Z | E05 | tool record_note (call call_00_79x10qbtjysidkw3y8lj5vn7) | invalid_arguments: 工具参数不符合 schema：(根): Unrecognized key: "kind" | 安全 | - | 待定 |
| 2026-11-17T07:32:55.025Z | E05 | tool run_readonly_command (call call_00_d5vv4hndzzds1lmoz6fi5ckg) | execution_failed: 命令退出码 2 | 无理由 | - | 待定 |
| 2026-11-17T07:33:18.678Z | E05 | tool read_execution_history (call call_01_aact7y2g2bsadix7jpx3aayt) | invalid: afterCursor is not a graph execution-history continuation cursor (Run b0a602b9-3c65-482b-851d-18e1bebdbd77) | 无理由 | - | 待定 |
| 2026-11-17T07:33:36.429Z | E05 | tool read_execution_history (call call_00_n8wuxpr6tenq61gtpt2zjb8c) | invalid: afterCursor is not a continuation cursor for this Session and execution identity (Run b0a602b9-3c65-482b-851d-18e1bebdbd77) | 无理由 | - | 待定 |
| 2026-11-17T07:36:19.935Z | E05 | tool read_execution_history (call call_00_g1j234e4q3znuu3ja2065wh2) | invalid: afterCursor is not a continuation cursor for this Session and execution identity (Run b0a602b9-3c65-482b-851d-18e1bebdbd77) | 无理由 | - | 待定 |
| 2026-11-17T07:36:50.794Z | E06 | tool look_graph (call call_00_YfxDmNexvkdrnq01hQXh9142) | invalid: this request has no goal | 无理由 | - | 待定 |
| 2026-11-17T07:36:50.802Z | E06 | tool look_graph (call call_01_nafOEDQSOUXBh1cArBej3389) | invalid: this request has no goal | 无理由 | - | 待定 |
| 2026-11-17T07:37:14.375Z | E06 | core/initialization/adopt adopt-mwkdqdtz-35 | invalid: the initial-planning answer is not valid JSON | 无理由 | - | 待定 |
| 2026-11-17T07:37:21.084Z | E08 | tool find_graph (call call_a28c189e8a3242f2871d67d3) | invalid_arguments: 工具参数不符合 schema：(根): Invalid input | 无理由 | - | 待定 |
| 2026-11-17T07:37:49.184Z | E08 | tool submit_initial_plan (call call_80c71f66ea0e4260afaef5a5) | invalid: the answer has problems; fix every one and call the tool again in this round | 无理由 | - | 待定 |
| 2026-11-17T07:38:03.697Z | E08 | tool submit_initial_plan (call call_9e1a94e1ce194b018bc3b85c) | invalid_arguments: 工具参数不符合 schema：summary: Invalid input: expected string, received undefined | 无理由 | - | 待定 |
| 2026-11-17T07:38:19.967Z | E08 | tool submit_initial_plan (call call_97a33b144d244a04b4673273) | invalid_arguments: 工具参数不符合 schema：planDraftIndex: Invalid input: expected number, received undefined | 无理由 | - | 待定 |
| 2026-11-17T07:38:42.897Z | E08 | core/goals/confirm-draft confirm-again-mwkdsa4x-40 | revision_conflict: the draft already created a goal; one card never makes two goals | 协调 | expected | 待定 |
| 2026-11-17T07:38:42.908Z | E08 | core/goals/control goals-control-mwkdsa58-41 | invalid: meta.expected must pin the Goal and its GoalPhase (0 = none stored) | 产品规则 | expected | 待定 |
| 2026-11-17T07:39:56.821Z | E08 | tool edit (call call_53c148a643724fc9a6ac2c7a) | execution_failed: test/mul.test.js 不存在 | 无理由 | - | 待定 |
| 2026-11-17T07:39:57.416Z | E08 | tool look_graph (call call_c94cb26807ad43638c99e399) | invalid_arguments: 工具参数不符合 schema：(根): Invalid input | 无理由 | - | 待定 |
| 2026-11-17T07:40:25.977Z | E08 | tool submit_plan_round (call call_00_Kk80oX4inbNfrPTr5Qv26839) | invalid_arguments: 工具参数不符合 schema：plan.tasks.0: Unrecognized key: "phase"; plan.tasks.1: Unrecognized key: "phase"; plan.tasks.2: Unrecognized key: "phase"; plan.tasks.3: Unrecognized key: "phase"; plan.tasks.4: Unrecognized key: "phase" | 安全 | - | 待定 |
| 2026-11-17T07:40:38.236Z | E08 | tool submit_plan_round (call call_00_UayLAVlwUxcAb3BQ2tnI3900) | invalid: the answer has problems; fix every one and call the tool again in this round | 无理由 | - | 待定 |
| 2026-11-17T07:40:43.812Z | E08 | tool record_note (call call_192fa0c1a50d4249841e2862) | invalid_arguments: 工具参数不符合 schema：(根): Unrecognized key: "expectedVersion" | 安全 | - | 待定 |
| 2026-11-17T07:41:04.230Z | E08 | tool submit_plan_round (call call_00_lBWQws3yd7qNk4ZrvhUJ9523) | invalid: the answer has problems; fix every one and call the tool again in this round | 无理由 | - | 待定 |
| 2026-11-17T07:41:18.703Z | E08 | tool submit_plan_round (call call_00_hhP1RCd9b0LuRGohPxCA5790) | invalid: the answer has problems; fix every one and call the tool again in this round | 无理由 | - | 待定 |
| 2026-11-17T07:41:32.547Z | E08 | tool submit_plan_round (call call_00_4SdNHhLCIunRNk9ZWXsL7575) | invalid: the answer has problems; fix every one and call the tool again in this round | 无理由 | - | 待定 |
| 2026-11-17T07:41:47.539Z | E08 | tool submit_plan_round (call call_00_9sOBJe6ULAoQ4sai1N9i8446) | invalid: the answer has problems; fix every one and call the tool again in this round | 无理由 | - | 待定 |
| 2026-11-17T07:42:14.267Z | E08 | tool look_graph (call call_3c31ccf9c5784a4198d882c8) | invalid_arguments: 工具参数不符合 schema：(根): Invalid input | 无理由 | - | 待定 |
| 2026-11-17T07:42:17.676Z | E08 | tool look_graph (call call_f7b0d4a89d764c71bf02fd56) | invalid_arguments: 工具参数不符合 schema：(根): Invalid input | 无理由 | - | 待定 |
| 2026-11-17T07:42:25.142Z | E08 | tool look_graph (call call_b0a8a1c5881b46638f13ce3b) | invalid_arguments: 工具参数不符合 schema：(根): Invalid input | 无理由 | - | 待定 |
| 2026-11-17T07:44:46.018Z | E09 | tool look_graph (call chatcmpl-tool-954cb7bc424b4877) | invalid_arguments: 工具参数不符合 schema：(根): Invalid input | 无理由 | - | 待定 |
| 2026-11-17T07:45:07.759Z | E09 | tool submit_initial_plan (call chatcmpl-tool-8dca8dd5832a1adb) | invalid: the answer has problems; fix every one and call the tool again in this round | 无理由 | - | 待定 |
| 2026-11-17T07:45:23.880Z | E09 | tool submit_initial_plan (call chatcmpl-tool-acd6cff90040edb5) | invalid_arguments: 工具参数不符合 schema：planDraftIndex: Invalid input: expected number, received undefined | 无理由 | - | 待定 |
| 2026-11-17T07:45:38.398Z | E09 | tool submit_initial_plan (call chatcmpl-tool-9c4069deeb0ce790) | invalid: the answer has problems; fix every one and call the tool again in this round | 无理由 | - | 待定 |
| 2026-11-17T07:47:15.862Z | E09 | tool look_graph (call call_799e0653433b4f4692ec669e) | invalid_arguments: 工具参数不符合 schema：(根): Invalid input | 无理由 | - | 待定 |
| 2026-11-17T07:47:24.592Z | E09 | tool shell (call call_7019591d09434ed68b6851d4) | execution_failed: shell 退出码 2 | 无理由 | - | 待定 |
| 2026-11-17T07:47:37.317Z | E09 | tool read (call call_d946b4e4d4894ebd953194e6) | execution_failed: .workbench 不是普通文件 | 无理由 | - | 待定 |
| 2026-11-17T07:48:17.074Z | E09 | tool shell (call call_7ba183fd2a7a42c09307ec9b) | execution_failed: shell 退出码 2 | 无理由 | - | 待定 |
| 2026-11-17T07:48:19.931Z | E09 | tool look_graph (call call_a299d0e501a74afea1aa13ba) | invalid_arguments: 工具参数不符合 schema：(根): Invalid input | 无理由 | - | 待定 |
| 2026-11-17T07:48:21.837Z | E09 | tool look_graph (call call_67c13c3ba49741d78557af57) | invalid_arguments: 工具参数不符合 schema：(根): Invalid input | 无理由 | - | 待定 |
| 2026-11-17T07:48:26.919Z | E09 | tool look_graph (call call_88d4d4b9fe9c4a8e93b8d20a) | invalid_arguments: 工具参数不符合 schema：(根): Invalid input | 无理由 | - | 待定 |
| 2026-11-17T07:48:26.926Z | E09 | tool look_graph (call call_6a12b4f08ff243cd890ecffc) | invalid_arguments: 工具参数不符合 schema：(根): Invalid input | 无理由 | - | 待定 |
| 2026-11-17T07:48:35.313Z | E09 | tool look_graph (call call_214a123064ba44a0a857f5eb) | invalid_arguments: 工具参数不符合 schema：(根): Invalid input | 无理由 | - | 待定 |
| 2026-11-17T07:48:39.396Z | E09 | tool look_graph (call call_228523416f0c427aa74c8e55) | invalid_arguments: 工具参数不符合 schema：(根): Invalid input | 无理由 | - | 待定 |
| 2026-11-17T07:48:41.718Z | E09 | tool send_session_message (call call_b976ab58d33c428780df6393) | invalid: a goal-bearing action_request requires the expected basis | 产品规则 | - | 待定 |
| 2026-11-17T07:49:05.197Z | E09 | tool read_execution_history (call call_4aeaa1b77a1540c3a450a318) | capacity: the complete graph tool result exceeds 48 KiB; request a smaller page or drill down into one node | 协调 | - | 待定 |
| 2026-11-17T07:49:07.505Z | E09 | tool read_execution_history (call call_487bb59ca2ad415db04a29bc) | capacity: the complete graph tool result exceeds 48 KiB; request a smaller page or drill down into one node | 协调 | - | 待定 |
| 2026-11-17T07:49:19.721Z | E09 | tool find_graph (call call_9f52ab297f2447c787ac1898) | execution_failed: the note memory read port is not bound for this Run | 无理由 | - | 待定 |
| 2026-11-17T07:49:31.191Z | E09 | tool read_execution_history (call call_ca228053cd964173a1bc7960) | invalid: afterCursor is not a graph execution-history continuation cursor (Run 49846b01-b74f-4a74-8129-1f09588fd719) | 无理由 | - | 待定 |
| 2026-11-17T07:50:13.129Z | E09 | tool read_execution_history (call call_d1227ea4ecad4294a1df6629) | source_stale: the persisted execution-history identity or start changed since the page was frozen (Run 49846b01-b74f-4a74-8129-1f09588fd719) | 协调 | - | 待定 |
| 2026-11-17T07:50:48.535Z | E09 | tool read_execution_history (call call_68e13f349a4140e3901cbc1a) | source_stale: the persisted execution-history identity or start changed since the page was frozen (Run 49846b01-b74f-4a74-8129-1f09588fd719) | 协调 | - | 待定 |
| 2026-11-17T07:52:44.656Z | E09 | tool read_execution_history (call call_90daff8be7c7458ba07f0ce9) | source_stale: the persisted execution-history identity or start changed since the page was frozen (Run 07b909d7-7cfb-4b4e-b288-ee77ae135a31) | 协调 | - | 待定 |
| 2026-11-17T07:54:35.381Z | E09 | tool read_execution_history (call call_3e2c6c33fbab45e9b0f6eb8b) | source_stale: the persisted execution-history identity or start changed since the page was frozen (Run e85d740a-2d03-4a81-879b-7aac837a9402) | 协调 | - | 待定 |
| 2026-11-17T07:55:19.796Z | E09 | tool look_graph (call call_9655f397b05f4b68a6a36c5e) | invalid_arguments: 工具参数不符合 schema：(根): Invalid input | 无理由 | - | 待定 |
| 2026-11-17T07:55:27.300Z | E09 | tool look_graph (call call_b94f1a211c70465594419184) | invalid_arguments: 工具参数不符合 schema：(根): Invalid input | 无理由 | - | 待定 |
| 2026-11-17T07:55:41.965Z | E09 | tool look_graph (call call_6ce1682851c34e6e95dc6e2a) | invalid_arguments: 工具参数不符合 schema：(根): Invalid input | 无理由 | - | 待定 |
| 2026-11-17T07:56:47.868Z | E09 | tool look_graph (call call_3e49aa8060f147e293f30d09) | invalid_arguments: 工具参数不符合 schema：(根): Invalid input | 无理由 | - | 待定 |
| 2026-11-17T08:00:28.578Z | E09 | tool send_session_message (call call_e516f870766c47c5afeb600c) | invalid: a goal-bearing action_request requires the expected basis | 产品规则 | - | 待定 |
| 2026-11-17T08:03:02.002Z | E09 | tool find_graph (call call_a8a8d5761bb24448962a4838) | invalid_arguments: 工具参数不符合 schema：(根): Invalid input | 无理由 | - | 待定 |
| 2026-11-17T08:03:02.012Z | E09 | tool find_graph (call call_64ca95b73405428b9aae89e8) | execution_failed: the note memory read port is not bound for this Run | 无理由 | - | 待定 |
| 2026-11-17T08:04:25.336Z | E09 | tool look_graph (call call_44133add540a408bb10ef7d9) | execution_failed: the note memory read port is not bound for this Run | 无理由 | - | 待定 |
| 2026-11-17T08:07:51.127Z | E12 | tool run_readonly_command (call call_00_crduxi2hqg3zzadjk3h42g3y) | execution_failed: 命令退出码 2 | 无理由 | - | 待定 |
| 2026-11-17T08:08:16.396Z | E12 | tool submit_initial_plan (call call_00_1jvsd1pv3zln0a5x3p7w7q8k) | invalid: the answer has problems; fix every one and call the tool again in this round | 无理由 | - | 待定 |
| 2026-11-17T08:08:25.337Z | E12 | tool submit_initial_plan (call call_00_9q9z2rggeuq2p63098w3f7p2) | invalid_arguments: 工具参数不符合 schema：planDraftIndex: Invalid input: expected number, received undefined | 无理由 | - | 待定 |
| 2026-11-17T08:08:41.014Z | E12 | tool submit_secretary_answer (call call_00_yjl09vont81aofynwiflw8j5) | invalid_arguments: 工具参数不符合 schema：ideas: Invalid input: expected array, received undefined | 无理由 | - | 待定 |
| 2026-11-17T08:09:02.495Z | E12 | tool read (call call_00_PzyLU0xtIPl22A6505rn7746) | permission_denied: 请求路径不在允许范围 | 无理由 | - | 待定 |
| 2026-11-17T08:09:15.793Z | E12 | tool edit (call call_01_4WtzIZDQqDsJzV1EYQTu1531) | execution_failed: test/greet.test.js 不存在 | 无理由 | - | 待定 |
| 2026-11-17T08:09:20.234Z | E12 | tool edit (call call_00_a4GWJIBTAhduCAZEd6U34520) | invalid_arguments: 工具参数不符合 schema：(根): Unrecognized key: "expectedRevision" | 安全 | - | 待定 |
| 2026-11-17T08:09:48.315Z | E12 | tool read_execution_history (call call_01ea31eacddd4f549998603e) | capacity: the complete graph tool result exceeds 48 KiB; request a smaller page or drill down into one node | 协调 | - | 待定 |
| 2026-11-17T08:09:52.490Z | E12 | tool look_graph (call call_3769e4d9a66849c58f668a8a) | invalid_arguments: 工具参数不符合 schema：(根): Invalid input | 无理由 | - | 待定 |
| 2026-11-17T08:11:00.958Z | E12 | tool read_execution_history (call call_abadd86966c549babc79e251) | source_stale: the persisted execution-history identity or start changed since the page was frozen (Run 328f79a3-8b78-4574-8801-abe0ab76ccb9) | 协调 | - | 待定 |
| 2026-11-17T08:11:01.001Z | E12 | tool look_graph (call call_622bbea58b8b4539b45fdc09) | invalid_arguments: 工具参数不符合 schema：(根): Invalid input | 无理由 | - | 待定 |
| 2026-11-17T08:11:05.436Z | E12 | tool read_execution_history (call call_f37a3952c6be43359a1c0c11) | capacity: the complete graph tool result exceeds 48 KiB; request a smaller page or drill down into one node | 协调 | - | 待定 |
| 2026-11-17T08:11:05.477Z | E12 | tool look_graph (call call_1e3910ea33004f5d8057ffa5) | invalid_arguments: 工具参数不符合 schema：(根): Invalid input | 无理由 | - | 待定 |
| 2026-11-17T08:17:54.723Z | E12 | tool read_execution_history (call call_d4a2da2a74aa439bb96ac329) | source_stale: the persisted execution-history identity or start changed since the page was frozen (Run 328f79a3-8b78-4574-8801-abe0ab76ccb9) | 协调 | - | 待定 |
| 2026-11-17T08:18:00.152Z | E12 | tool find_graph (call call_254210d6d075413bb56a5ab0) | execution_failed: the note memory read port is not bound for this Run | 无理由 | - | 待定 |

每次拒绝一行：HTTP 拒绝（预期的也记，标 expected）和公开原历史里的每次工具拒绝（按调用身份去重），原文不截断。类别只认依据：busy/revision_conflict/idempotency_conflict/source_stale/capacity 记协调；理由点到不可逆、外部或秘密的记安全；理由点到规则的记产品规则；其余记“无理由”。

## A/B、压缩、附加格、B06

### A1：pass

- reserved（C-214）：pass。reservedOutput 131072（requestId 4ccd6062-7abb-4482-ae84-7090a486aa86）
- usage（C-214）：pass。usageStatus reported，输入 29005，输出 118，缓存命中 25216
- accepted（C-214）：pass。请求被接受（用量已报）
- not-truncated（C-214）：pass。输出 118 < 预留 131072；close detail none
- driver-start: ready running
- 请求事实：[{"requestId":"4ccd6062-7abb-4482-ae84-7090a486aa86","reservedOutput":131072,"usageStatus":"reported","inputTokens":29005,"outputTokens":118,"cachedInputTokens":25216},{"requestId":"0e907637-5a6d-45a4-9db8-3528c9a69d60","reservedOutput":131072,"usageStatus":"reported","inputTokens":30546,"outputTokens":195,"cachedInputTokens":29056},{"requestId":"1920f60c-9c55-4fc9-9933-0977335b164a","reservedOutput":131072,"usageStatus":"reported","inputTokens":31744,"outputTokens":279,"cachedInputTokens":30720},{"requestId":"e85bda59-f3bf-45e9-a3ab-e77702f09bf7","reservedOutput":131072,"usageStatus":"reported","inputTokens":33521,"outputTokens":182,"cachedInputTokens":32000},{"requestId":"e1f4dc77-15c4-4dcd-b0d0-16ccb34bb1f6","reservedOutput":131072,"usageStatus":"reserved","inputTokens":null,"outputTokens":null,"cachedInputTokens":null}]；Query running；close null；profile 累计输出上限 null = 不设上限
- queries/cancel after the first request: ready stopping
- request e1f4dc77-15c4-4dcd-b0d0-16ccb34bb1f6: cut by the driver's cancel; usage not reported, at most one request (Query closed, close cancelled)

### B1：pass

- reserved（C-214）：pass。reservedOutput 64000（requestId 07babd00-2fb7-46a1-9a20-ec5ed57f1f31）
- usage（C-214）：pass。usageStatus reported，输入 15612，输出 79，缓存命中 12160
- accepted（C-214）：pass。请求被接受（用量已报）
- not-truncated（C-214）：pass。输出 79 < 预留 64000；close detail none
- fits（C-214）：pass。请求发出（reservedInput 以内），reservedOutput 64000
- driver-start: ready running
- 请求事实：[{"requestId":"07babd00-2fb7-46a1-9a20-ec5ed57f1f31","reservedOutput":64000,"usageStatus":"reported","inputTokens":15612,"outputTokens":79,"cachedInputTokens":12160},{"requestId":"246cd384-333f-462e-9880-a615d127e11c","reservedOutput":63921,"usageStatus":"reported","inputTokens":16450,"outputTokens":166,"cachedInputTokens":15616},{"requestId":"3b324af6-e2c1-4be6-a54b-b30d611926c6","reservedOutput":63755,"usageStatus":"reported","inputTokens":17495,"outputTokens":439,"cachedInputTokens":16512},{"requestId":"8990fd21-5ac5-4084-8bc9-b53c61879b81","reservedOutput":63316,"usageStatus":"reported","inputTokens":18118,"outputTokens":361,"cachedInputTokens":17920},{"requestId":"8063e93c-f1cc-47d0-ad97-ab4820000842","reservedOutput":62955,"usageStatus":"reserved","inputTokens":null,"outputTokens":null,"cachedInputTokens":null}]；Query running；close null；profile 累计输出上限 64000
- queries/cancel after the first request: ready stopping
- request 8063e93c-f1cc-47d0-ad97-ab4820000842: cut by the driver's cancel; usage not reported, at most one request (Query closed, close cancelled)

### 压缩：uncovered

- compacted（K2-P2）：uncovered (not-run)。stopped before this check: request 629d45d6-57cc-4fec-b796-0a6e3616098b of intervention-planning-23c325a175db926424cc1c5e82f4b7e689c858bfe69cc277892d8a4b7bb9cc36 has usage unknown and its Query has not ended yet; new work waits for its terminal fact; it did not end within 30 min
- six-sections（K2-P2）：uncovered (not-run)。stopped before this check: request 629d45d6-57cc-4fec-b796-0a6e3616098b of intervention-planning-23c325a175db926424cc1c5e82f4b7e689c858bfe69cc277892d8a4b7bb9cc36 has usage unknown and its Query has not ended yet; new work waits for its terminal fact; it did not end within 30 min
- accepted（K2-P2）：uncovered (not-run)。stopped before this check: request 629d45d6-57cc-4fec-b796-0a6e3616098b of intervention-planning-23c325a175db926424cc1c5e82f4b7e689c858bfe69cc277892d8a4b7bb9cc36 has usage unknown and its Query has not ended yet; new work waits for its terminal fact; it did not end within 30 min
- cache-after（K2-P2）：uncovered (not-run)。stopped before this check: request 629d45d6-57cc-4fec-b796-0a6e3616098b of intervention-planning-23c325a175db926424cc1c5e82f4b7e689c858bfe69cc277892d8a4b7bb9cc36 has usage unknown and its Query has not ended yet; new work waits for its terminal fact; it did not end within 30 min
- stopped: not-run: request 629d45d6-57cc-4fec-b796-0a6e3616098b of intervention-planning-23c325a175db926424cc1c5e82f4b7e689c858bfe69cc277892d8a4b7bb9cc36 has usage unknown and its Query has not ended yet; new work waits for its terminal fact; it did not end within 30 min

### C-216：uncovered

- observed-start（C-216）：uncovered (not-run)。stopped before this check: request 629d45d6-57cc-4fec-b796-0a6e3616098b of intervention-planning-23c325a175db926424cc1c5e82f4b7e689c858bfe69cc277892d8a4b7bb9cc36 has usage unknown and its Query has not ended yet; new work waits for its terminal fact; it did not end within 30 min
- adopted-done（C-216）：uncovered (not-run)。stopped before this check: request 629d45d6-57cc-4fec-b796-0a6e3616098b of intervention-planning-23c325a175db926424cc1c5e82f4b7e689c858bfe69cc277892d8a4b7bb9cc36 has usage unknown and its Query has not ended yet; new work waits for its terminal fact; it did not end within 30 min
- stopped: not-run: request 629d45d6-57cc-4fec-b796-0a6e3616098b of intervention-planning-23c325a175db926424cc1c5e82f4b7e689c858bfe69cc277892d8a4b7bb9cc36 has usage unknown and its Query has not ended yet; new work waits for its terminal fact; it did not end within 30 min

### C-221：uncovered

- first-plan（C-221）：uncovered (not-run)。stopped before this check: request 629d45d6-57cc-4fec-b796-0a6e3616098b of intervention-planning-23c325a175db926424cc1c5e82f4b7e689c858bfe69cc277892d8a4b7bb9cc36 has usage unknown and its Query has not ended yet; new work waits for its terminal fact; it did not end within 30 min
- fail-rework（C-221）：uncovered (not-run)。stopped before this check: request 629d45d6-57cc-4fec-b796-0a6e3616098b of intervention-planning-23c325a175db926424cc1c5e82f4b7e689c858bfe69cc277892d8a4b7bb9cc36 has usage unknown and its Query has not ended yet; new work waits for its terminal fact; it did not end within 30 min
- delivered（C-221）：uncovered (not-run)。stopped before this check: request 629d45d6-57cc-4fec-b796-0a6e3616098b of intervention-planning-23c325a175db926424cc1c5e82f4b7e689c858bfe69cc277892d8a4b7bb9cc36 has usage unknown and its Query has not ended yet; new work waits for its terminal fact; it did not end within 30 min
- stopped: not-run: request 629d45d6-57cc-4fec-b796-0a6e3616098b of intervention-planning-23c325a175db926424cc1c5e82f4b7e689c858bfe69cc277892d8a4b7bb9cc36 has usage unknown and its Query has not ended yet; new work waits for its terminal fact; it did not end within 30 min

### C-222：uncovered

- created（C-222）：uncovered (not-run)。stopped before this check: request 629d45d6-57cc-4fec-b796-0a6e3616098b of intervention-planning-23c325a175db926424cc1c5e82f4b7e689c858bfe69cc277892d8a4b7bb9cc36 has usage unknown and its Query has not ended yet; new work waits for its terminal fact; it did not end within 30 min
- started（C-222）：uncovered (not-run)。stopped before this check: request 629d45d6-57cc-4fec-b796-0a6e3616098b of intervention-planning-23c325a175db926424cc1c5e82f4b7e689c858bfe69cc277892d8a4b7bb9cc36 has usage unknown and its Query has not ended yet; new work waits for its terminal fact; it did not end within 30 min
- stopped: not-run: request 629d45d6-57cc-4fec-b796-0a6e3616098b of intervention-planning-23c325a175db926424cc1c5e82f4b7e689c858bfe69cc277892d8a4b7bb9cc36 has usage unknown and its Query has not ended yet; new work waits for its terminal fact; it did not end within 30 min

### B06：uncovered

- W1a（B06-W1a）：uncovered (not-run)。stopped before this check: request 629d45d6-57cc-4fec-b796-0a6e3616098b of intervention-planning-23c325a175db926424cc1c5e82f4b7e689c858bfe69cc277892d8a4b7bb9cc36 has usage unknown and its Query has not ended yet; new work waits for its terminal fact; it did not end within 30 min
- W2（B06-W2）：uncovered (not-run)。stopped before this check: request 629d45d6-57cc-4fec-b796-0a6e3616098b of intervention-planning-23c325a175db926424cc1c5e82f4b7e689c858bfe69cc277892d8a4b7bb9cc36 has usage unknown and its Query has not ended yet; new work waits for its terminal fact; it did not end within 30 min
- W3（B06-W3）：uncovered (not-run)。stopped before this check: request 629d45d6-57cc-4fec-b796-0a6e3616098b of intervention-planning-23c325a175db926424cc1c5e82f4b7e689c858bfe69cc277892d8a4b7bb9cc36 has usage unknown and its Query has not ended yet; new work waits for its terminal fact; it did not end within 30 min
- W5（B06-W5）：uncovered (not-run)。stopped before this check: request 629d45d6-57cc-4fec-b796-0a6e3616098b of intervention-planning-23c325a175db926424cc1c5e82f4b7e689c858bfe69cc277892d8a4b7bb9cc36 has usage unknown and its Query has not ended yet; new work waits for its terminal fact; it did not end within 30 min
- W10（B06-W10）：uncovered (not-run)。stopped before this check: request 629d45d6-57cc-4fec-b796-0a6e3616098b of intervention-planning-23c325a175db926424cc1c5e82f4b7e689c858bfe69cc277892d8a4b7bb9cc36 has usage unknown and its Query has not ended yet; new work waits for its terminal fact; it did not end within 30 min
- W12（B06-W12）：uncovered (not-run)。stopped before this check: request 629d45d6-57cc-4fec-b796-0a6e3616098b of intervention-planning-23c325a175db926424cc1c5e82f4b7e689c858bfe69cc277892d8a4b7bb9cc36 has usage unknown and its Query has not ended yet; new work waits for its terminal fact; it did not end within 30 min
- explore（B06-cond3）：uncovered (not-run)。stopped before this check: request 629d45d6-57cc-4fec-b796-0a6e3616098b of intervention-planning-23c325a175db926424cc1c5e82f4b7e689c858bfe69cc277892d8a4b7bb9cc36 has usage unknown and its Query has not ended yet; new work waits for its terminal fact; it did not end within 30 min
- stopped: not-run: request 629d45d6-57cc-4fec-b796-0a6e3616098b of intervention-planning-23c325a175db926424cc1c5e82f4b7e689c858bfe69cc277892d8a4b7bb9cc36 has usage unknown and its Query has not ended yet; new work waits for its terminal fact; it did not end within 30 min

## 预算

- 上限：总量 280000000，每个场景/格 50000000（acceptance.config.json `tokenCaps`）。
- 口径：用量 = inputTokens + outputTokens（Kernel 的 inputTokens 已含缓存命中，cachedInputTokens 另记、不再相加）；每条按它所在项目的归属场景/格计，不按读到的时间。
- 合计：用量 28040870（输入 27812960，输出 227910；缓存命中 25395840）；Query 请求 238 次（含 Query 的压缩摘要请求，公开记录分不出）；结束的 Work Run 18 个，其中 0 个是公开证明的零（没进入 Kernel）；未知或不完整的用量不算零：已关闭 Query 里用量未知的请求按预留上限（输入预留 + 输出预留）计，只会多算；Work Run 的用量未知或不完整、或请求的预留读不到时，计量停下。
- 已知缺口：Work Run 的压缩摘要请求在另一个 Kernel Session 里跑，不在 `activity/runs` 里，计量少算了它们；驱动不读数据库补数（lead 裁定 11-14 #3）。400M/50M 上限远高于预期用量，这是记下的缺口，不是阻断。
- 最后一次完整读数时在途：Query 0，Work Run 0（Work Run 的用量要等 Run 结束才在 `activity/runs` 出现，所以超限后的停止点是第一次能看到超出的读数）。
- 计量不可用：request 629d45d6-57cc-4fec-b796-0a6e3616098b of intervention-planning-23c325a175db926424cc1c5e82f4b7e689c858bfe69cc277892d8a4b7bb9cc36 has usage unknown and its Query has not ended yet; new work waits for its terminal fact; it did not end within 30 min
- A1：用量 125590（输入 124816，输出 774，缓存命中 116992；Query 请求 5（其中按未计费 0 计的 1：provider 拒收，或驱动自己取消截断的请求；按预留上限计的 0：Query 已关闭、用量未知），结束的 Run 0）
- B1：用量 68720（输入 67675，输出 1045，缓存命中 62208；Query 请求 5（其中按未计费 0 计的 1：provider 拒收，或驱动自己取消截断的请求；按预留上限计的 0：Query 已关闭、用量未知），结束的 Run 0）
- E05：用量 10878775（输入 10795621，输出 83154，缓存命中 9814912；Query 请求 91（其中按未计费 0 计的 0：provider 拒收，或驱动自己取消截断的请求；按预留上限计的 0：Query 已关闭、用量未知），结束的 Run 4）
- E06：用量 263159（输入 260790，输出 2369，缓存命中 227456；Query 请求 5（其中按未计费 0 计的 0：provider 拒收，或驱动自己取消截断的请求；按预留上限计的 0：Query 已关闭、用量未知），结束的 Run 0）
- E08：用量 2918234（输入 2880454，输出 37780，缓存命中 2634368；Query 请求 29（其中按未计费 0 计的 0：provider 拒收，或驱动自己取消截断的请求；按预留上限计的 0：Query 已关闭、用量未知），结束的 Run 5）
- E09：用量 12783540（输入 12695126，输出 88414，缓存命中 11725568；Query 请求 83（其中按未计费 0 计的 0：provider 拒收，或驱动自己取消截断的请求；按预留上限计的 0：Query 已关闭、用量未知），结束的 Run 8）
- E12：用量 1002852（输入 988478，输出 14374，缓存命中 814336；Query 请求 20（其中按未计费 0 计的 0：provider 拒收，或驱动自己取消截断的请求；按预留上限计的 0：Query 已关闭、用量未知），结束的 Run 1）

## 延迟探针

- wa#0：{"startedAt":"2026-11-17T07:13:56.907Z","writtenAt":"2026-11-17T07:15:14.041Z","samples":3774,"p50Ms":21.58,"p95Ms":21.91,"p99Ms":36.04,"maxMs":358.09,"meanMs":21.93}；关闭 SIGINT, exit 0 after 42 ms
- wb#0：{"startedAt":"2026-11-17T07:15:14.134Z","writtenAt":"2026-11-17T07:16:32.959Z","samples":3776,"p50Ms":21.54,"p95Ms":21.91,"p99Ms":27.8,"maxMs":215.74,"meanMs":21.7}；关闭 SIGINT, exit 0 after 26 ms
- w-accept#0：{"startedAt":"2026-11-17T07:16:33.005Z","writtenAt":"2026-11-17T08:47:36.799Z","samples":270258,"p50Ms":20.48,"p95Ms":21.84,"p99Ms":23.05,"maxMs":2003.83,"meanMs":21.42}；关闭 SIGINT, exit 0 after -1780 ms

## 其它记录

- 2026-11-17T07:15:13.965Z A1: g6-a1-mwkcwhef-4 (BLOCKED): pause because wa closes: committed
- 2026-11-17T07:15:13.984Z A1: A1: request e1f4dc77-15c4-4dcd-b0d0-16ccb34bb1f6 counted as unbilled 0 (cut by the driver's cancel; usage not reported, at most one request)
- 2026-11-17T07:16:32.901Z B1: g6-b1-mwkcy4lm-15 (BLOCKED): pause because wb closes: committed
- 2026-11-17T07:16:32.921Z B1: B1: request 8063e93c-f1cc-47d0-ad97-ab4820000842 counted as unbilled 0 (cut by the driver's cancel; usage not reported, at most one request)
- 2026-11-17T08:17:20.503Z E12: request 629d45d6-57cc-4fec-b796-0a6e3616098b of intervention-planning-23c325a175db926424cc1c5e82f4b7e689c858bfe69cc277892d8a4b7bb9cc36 has usage unknown and its Query has not ended yet; new work waits for its terminal fact
- 2026-11-17T08:47:36.725Z E12: request 629d45d6-57cc-4fec-b796-0a6e3616098b of intervention-planning-23c325a175db926424cc1c5e82f4b7e689c858bfe69cc277892d8a4b7bb9cc36 has usage unknown and its Query has not ended yet; new work waits for its terminal fact; it did not end within 30 min
- 2026-11-17T08:47:37.389Z -: w-accept closes: request 629d45d6-57cc-4fec-b796-0a6e3616098b of intervention-planning-23c325a175db926424cc1c5e82f4b7e689c858bfe69cc277892d8a4b7bb9cc36 has usage unknown and its Query has not ended yet; new work waits for its terminal fact; it did not end within 30 min
- 2026-11-17T08:47:36.866Z -: the run stopped early: request 629d45d6-57cc-4fec-b796-0a6e3616098b of intervention-planning-23c325a175db926424cc1c5e82f4b7e689c858bfe69cc277892d8a4b7bb9cc36 has usage unknown and its Query has not ended yet; new work waits for its terminal fact; it did not end within 30 min
- 2026-11-17T08:47:36.866Z -: §6.2：Query 在“进入中”被中止由 qent 关成 not_entered（aborted_before_entry）；`queries/cancel` 在 entering 窗口仍回 not_running，本次不测、不判场景失败。
