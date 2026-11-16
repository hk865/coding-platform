# G6 notes 2026-11-15（运行号 g6-2026-11-15-cdea2e8f）

## 逐场景判据

### E05：fail

- C 行：C-182, C-183, C-185, C-71, C-73, C-191, C-208, C-217, C-218；自治档 `after_plan_confirmation`；provider `deepseek` / `deepseek-v4.1-flash`。
- 用量：输入 3654582（含缓存命中），输出 40428，缓存命中 3307136，Query 请求 33。

| 判据 | C 行 | 结果 | 说明 |
|---|---|---|---|
| overlap | C-182, C-183, C-217 | fail | the platform did not do it: timed out after 150 min waiting for g6-e05-mwi0acxj-27 to reach COMPLETED/FAILED/CANCELLED/ACCEPTED_PARTIAL |
| gate | C-185 | uncovered (not-run) | stopped before this check: timed out after 150 min waiting for g6-e05-mwi0acxj-27 to reach COMPLETED/FAILED/CANCELLED/ACCEPTED_PARTIAL |
| paths | C-185, C-217 | uncovered (not-run) | stopped before this check: timed out after 150 min waiting for g6-e05-mwi0acxj-27 to reach COMPLETED/FAILED/CANCELLED/ACCEPTED_PARTIAL |
| kept | C-185 | uncovered (not-run) | stopped before this check: timed out after 150 min waiting for g6-e05-mwi0acxj-27 to reach COMPLETED/FAILED/CANCELLED/ACCEPTED_PARTIAL |
| single-occupancy | C-71 | uncovered (not-run) | stopped before this check: timed out after 150 min waiting for g6-e05-mwi0acxj-27 to reach COMPLETED/FAILED/CANCELLED/ACCEPTED_PARTIAL |
| convention | C-208 | uncovered (not-run) | stopped before this check: timed out after 150 min waiting for g6-e05-mwi0acxj-27 to reach COMPLETED/FAILED/CANCELLED/ACCEPTED_PARTIAL |
| duplicates | C-208 | uncovered (not-run) | stopped before this check: timed out after 150 min waiting for g6-e05-mwi0acxj-27 to reach COMPLETED/FAILED/CANCELLED/ACCEPTED_PARTIAL |
| reviewer | C-208, C-218 | uncovered (not-run) | stopped before this check: timed out after 150 min waiting for g6-e05-mwi0acxj-27 to reach COMPLETED/FAILED/CANCELLED/ACCEPTED_PARTIAL |
| name-different | C-208 | uncovered (not-run) | stopped before this check: timed out after 150 min waiting for g6-e05-mwi0acxj-27 to reach COMPLETED/FAILED/CANCELLED/ACCEPTED_PARTIAL |
| name-same | C-208 | uncovered (not-run) | stopped before this check: timed out after 150 min waiting for g6-e05-mwi0acxj-27 to reach COMPLETED/FAILED/CANCELLED/ACCEPTED_PARTIAL |
| temporary | C-208 | uncovered (not-run) | stopped before this check: timed out after 150 min waiting for g6-e05-mwi0acxj-27 to reach COMPLETED/FAILED/CANCELLED/ACCEPTED_PARTIAL |
| line-choice | C-73, C-191 | uncovered (not-run) | stopped before this check: timed out after 150 min waiting for g6-e05-mwi0acxj-27 to reach COMPLETED/FAILED/CANCELLED/ACCEPTED_PARTIAL |

- driver-start t-users: ready running
- driver-start t-orders: ready running
- stopped: not-run: timed out after 150 min waiting for g6-e05-mwi0acxj-27 to reach COMPLETED/FAILED/CANCELLED/ACCEPTED_PARTIAL
- g6-e05-mwi0acxj-27 (NEEDS_DECISION): pause because E05 ended: committed

### E06：uncovered

- C 行：C-75, C-135, C-106, C-194, C-149, C-151, C-68, C-181, C-209, C-219, C-223；自治档 `after_plan_confirmation`；provider `-` / `-`。
- 用量：输入 0（含缓存命中），输出 0，缓存命中 0，Query 请求 0。

| 判据 | C 行 | 结果 | 说明 |
|---|---|---|---|
| handoff | C-219 | uncovered (not-run) | stopped before this check: E05 left no project/work line to continue |
| successor-input | C-75, C-209, C-219 | uncovered (not-run) | stopped before this check: E05 left no project/work line to continue |
| successor-frontier | C-75 | uncovered (not-run) | stopped before this check: E05 left no project/work line to continue |
| no-restatement | C-209 | uncovered (not-run) | stopped before this check: E05 left no project/work line to continue |
| excluded-path | C-209 | uncovered (not-run) | stopped before this check: E05 left no project/work line to continue |
| same-task-new-run | C-135 | uncovered (not-run) | stopped before this check: E05 left no project/work line to continue |
| history-continuity | C-106, C-194 | uncovered (not-run) | stopped before this check: E05 left no project/work line to continue |
| restart-running | C-149 | uncovered (not-run) | stopped before this check: E05 left no project/work line to continue |
| restart-paused | C-151 | uncovered (not-run) | stopped before this check: E05 left no project/work line to continue |
| archive | C-219 | uncovered (not-run) | stopped before this check: E05 left no project/work line to continue |
| hand-or-drop | C-223 | uncovered (not-run) | stopped before this check: E05 left no project/work line to continue |
| wake | C-68, C-181 | uncovered (not-run) | stopped before this check: E05 left no project/work line to continue |

- stopped: not-run: E05 left no project/work line to continue

### E08：fail

- C 行：C-47, C-62, C-63, C-133a, C-126, C-46, C-52, C-116, C-118, C-210；自治档 `every_step`；provider `deepseek` / `deepseek-v4.1-flash`。
- 用量：输入 1149257（含缓存命中），输出 19353，缓存命中 962944，Query 请求 21。

| 判据 | C 行 | 结果 | 说明 |
|---|---|---|---|
| autonomy-born | C-133a | pass | 草稿自治 every_step；Goal 生在版本 1，采用后读到 every_step |
| confirm-only-latest | C-47 | pass | 同一草稿换 commandId 再确认：rejected revision_conflict |
| person-adopts | C-46, C-52 | pass | 人确认之前 goals/list 里没有这个 Goal（0 个旧 Goal）；首方案由人 initialization/adopt |
| first-adoption | C-63, C-62 | pass | 采用回执 plan initial-plan-3b8cea783463011d425df1f4d22d3649；Goal 指针 {"aggregateType":"PlanRevision","projectId":"4cc8550be53c79e4a49c3adb92332e35","planId":"initial-plan-3b8cea783463011d425df1f4d22d3649"} |
| versions | C-210 | fail | the platform did not do it: plans/apply of the change: invalid the future plan is not admissible: obligations[ob-accept]: source obligation ob-accept changed its title, strength or verification requirements; tasks[gate]: source gate task gate changed its definition or acceptance relationships |
| switch | C-210 | uncovered (not-run) | stopped before this check: plans/apply of the change: invalid the future plan is not admissible: obligations[ob-accept]: source obligation ob-accept changed its title, strength or verification requirements; tasks[gate]: source gate task gate changed its definition or acceptance relationships |
| old-evidence | C-210 | uncovered (not-run) | stopped before this check: plans/apply of the change: invalid the future plan is not admissible: obligations[ob-accept]: source obligation ob-accept changed its title, strength or verification requirements; tasks[gate]: source gate task gate changed its definition or acceptance relationships |
| required-cancel | C-210 | uncovered (not-run) | stopped before this check: plans/apply of the change: invalid the future plan is not admissible: obligations[ob-accept]: source obligation ob-accept changed its title, strength or verification requirements; tasks[gate]: source gate task gate changed its definition or acceptance relationships |
| autonomy-later | C-126 | uncovered (not-run) | 草稿本来就是 every_step，这次没有中途改档 |
| control-pins | C-116, C-118 | pass | 只钉 Goal 的暂停：rejected invalid |

- the person selected idea 1 of 3 on the change: 取消 sub，改为 div（含 RangeError）+ mul，其余不变
- stopped: not-run: plans/apply of the change: invalid the future plan is not admissible: obligations[ob-accept]: source obligation ob-accept changed its title, strength or verification requirements; tasks[gate]: source gate task gate changed its definition or acceptance relationships
- goal-confirm:goal.confirmDraft:74275f331caf56a0193835b0c97ef4217e7a7f6136ddeb1a14975359229ede14 (CHANGE_PENDING): pause because E08 ended: committed

### E09：fail

- C 行：C-185, C-89, C-65, C-98, C-93, C-95, C-99, C-55, C-62, C-211, C-212, C-218；自治档 `after_plan_confirmation`；provider `deepseek` / `deepseek-v4.1-flash`。
- 用量：输入 8481308（含缓存命中），输出 45766，缓存命中 8023040，Query 请求 27。

| 判据 | C 行 | 结果 | 说明 |
|---|---|---|---|
| executor-reports | C-185, C-211 | fail | 执行者没有成功发出提到 parseDate 的 send_session_message |
| adviser-explains | C-211 | uncovered (not-run) | 没有执行者的上报，后面这几环没有发生 |
| person-decides | C-211, C-62 | uncovered (not-run) | 没有执行者的上报，后面这几环没有发生 |
| new-version | C-211, C-55 | uncovered (not-run) | 没有执行者的上报，后面这几环没有发生 |
| formal-change | C-212 | pass | architecture/revise committed  ；目录版本 2 |
| drift | C-212, C-89 | pass | compare-formal 5 条 finding；带路径的：package.json, README.md, src/report.js, test/api.test.js, test/report.test.js |
| observation-after-adopt | C-65 | pass | 采用后观测 {"aggregateType":"ObservedArchitecture","projectId":"c18bf5d907986bc783c66184cd3ca5c0","workspaceId":"4168ea74a7d2e0c51fbed65d1d45d60d","captureId":"71f1ff0b-5dfe-4ff6-abbc-a786791d32f1"} |
| observation-after-pass | C-98 | pass | 观测：采用后 {"aggregateType":"ObservedArchitecture","projectId":"c18bf5d907986bc783c66184cd3ca5c0","workspaceId":"4168ea74a7d2e0c51fbed65d1d45d60d","captureId":"71f1ff0b-5dfe-4ff6-abbc-a786791d32f1"} → 现在 {"aggregateType":"ObservedArchitecture","projectId":"c18bf5d907986bc783c66184cd3ca5c0","workspaceId":"4168ea74a7d2e0c51fbed65d1d45d60d","captureId":"c8c1c2a5-7ba1-4695-aabd-fd107fa11079"} |
| rounds | C-93, C-95, C-218 | pass | satisfied 任务的最新轮：t-a-parsedate PASS/gaps 0, t-b-monthof PASS/gaps 0, t-test PASS/gaps 0 |
| uncovered-round | C-99 | uncovered (not-run) | 这次没有出现缺覆盖（INCONCLUSIVE）的检查轮 |

- goal-confirm:goal.confirmDraft:64a72eb7f6f62cada0c11d6c15eed498340c0a4c094f503e38422a9587a4069a: the draft chose every_step; set to after_plan_confirmation after adoption (committed )
- E09 Goal ended COMPLETED
- 8E contact 层：uncovered (8E optional)（只记在这里，不进 uncovered[]；9-start-rulings.frozen.md:966-967）

### E12：fail

- C 行：C-36, C-42, C-157, C-88, C-89, C-104, C-145, C-146, C-158, C-147, C-155, C-207, C-114, C-215, C-220；自治档 `after_plan_confirmation`；provider `deepseek` / `deepseek-v4.1-flash`。
- 用量：输入 5015088（含缓存命中），输出 49160，缓存命中 4382336，Query 请求 52。

| 判据 | C 行 | 结果 | 说明 |
|---|---|---|---|
| reads-quiet | C-36 | pass | QueryRun 8→8，输入 3826368→3826368，changesHead h0000001509→h0000001509 |
| graph-cards | C-88, C-89 | pass | goal children 4，find 6，path 卡 有 |
| raw-history | C-42, C-157 | pass | 线的原历史 142 条，Run 历史 141 条 |
| completion-chain | C-104 | pass | 检查轮卡 4 张，有非空 evidenceRefs：true |
| restart-state | C-145, C-215 | pass | 重启后旧 Goal COMPLETED，计划 initial-plan-f75d382ac6717bdbdd12345bdbf23786，Run 2/2 |
| reconcile | C-146 | pass | host/reconcile-report：lease owned |
| redrive-sets | C-155 | pass | 旧 Goal 的 causes：[] |
| new-goal | C-114, C-158 | fail | the platform did not do it: plans/apply of goal-confirm:goal.confirmDraft:af5b89b33ba3501cb0bf93659bd27490f65b6b8f68e6328d717857846d86a7ac's request candidate: rejected incomplete the initial plan is not admissible: tasks: at least one active required GoalGate task (required+gate+active+scope=goal) is required: add one required active gate task with scope {kind:"goal"} and list it in a required obligation's taskIds |
| history-reuse | C-220 | uncovered (not-run) | stopped before this check: plans/apply of goal-confirm:goal.confirmDraft:af5b89b33ba3501cb0bf93659bd27490f65b6b8f68e6328d717857846d86a7ac's request candidate: rejected incomplete the initial plan is not admissible: tasks: at least one active required GoalGate task (required+gate+active+scope=goal) is required: add one required active gate task with scope {kind:"goal"} and list it in a required obligation's taskIds |
| stale-premise | C-220 | uncovered (not-run) | stopped before this check: plans/apply of goal-confirm:goal.confirmDraft:af5b89b33ba3501cb0bf93659bd27490f65b6b8f68e6328d717857846d86a7ac's request candidate: rejected incomplete the initial plan is not admissible: tasks: at least one active required GoalGate task (required+gate+active+scope=goal) is required: add one required active gate task with scope {kind:"goal"} and list it in a required obligation's taskIds |
| replay | C-147 | uncovered (not-run) | stopped before this check: plans/apply of goal-confirm:goal.confirmDraft:af5b89b33ba3501cb0bf93659bd27490f65b6b8f68e6328d717857846d86a7ac's request candidate: rejected incomplete the initial plan is not admissible: tasks: at least one active required GoalGate task (required+gate+active+scope=goal) is required: add one required active gate task with scope {kind:"goal"} and list it in a required obligation's taskIds |
| wait-registry | C-207 | uncovered (not-run) | stopped before this check: plans/apply of goal-confirm:goal.confirmDraft:af5b89b33ba3501cb0bf93659bd27490f65b6b8f68e6328d717857846d86a7ac's request candidate: rejected incomplete the initial plan is not admissible: tasks: at least one active required GoalGate task (required+gate+active+scope=goal) is required: add one required active gate task with scope {kind:"goal"} and list it in a required obligation's taskIds |

- restart: SIGINT, exit 0 after 168 ms
- goal-confirm:goal.confirmDraft:af5b89b33ba3501cb0bf93659bd27490f65b6b8f68e6328d717857846d86a7ac: the person selected idea 1 of 2 (与 greet 对称：farewell(name, punctuation = "!"))
- stopped: not-run: plans/apply of goal-confirm:goal.confirmDraft:af5b89b33ba3501cb0bf93659bd27490f65b6b8f68e6328d717857846d86a7ac's request candidate: rejected incomplete the initial plan is not admissible: tasks: at least one active required GoalGate task (required+gate+active+scope=goal) is required: add one required active gate task with scope {kind:"goal"} and list it in a required obligation's taskIds
- goal-confirm:goal.confirmDraft:af5b89b33ba3501cb0bf93659bd27490f65b6b8f68e6328d717857846d86a7ac (PLANNING): pause because E12 ended: committed

### iteration：fail

- C 行：C-108, C-109, C-110, C-111, C-112, C-105, C-107, C-113, C-194, C-213, C-226；自治档 `after_plan_confirmation`；provider `deepseek` / `deepseek-v4.1-flash`。
- 用量：输入 1640039（含缓存命中），输出 17606，缓存命中 1459328，Query 请求 32。

| 判据 | C 行 | 结果 | 说明 |
|---|---|---|---|
| ideas | C-108 | pass | 3 个思路，目标卡草稿 0 |
| select | C-109 | pass | select-idea queued；下一轮输入提到所选：true |
| candidate | C-110 | pass | 候选 plan-proposal-91331054f51cda435b4ca844c28393b8（candidate） |
| what-changed | C-213, C-110 | pass | 第二轮回答说明改动：true；新候选 plan-proposal-e380fcdf3f2cb083352d097b48dbd8ab，前一版 {"proposalRef":{"aggregateType":"PlanProposal","projectId":"56c284c4b72a41857fa1437a72bfa9be","workspaceId":"a4f33fb7dca26c581cddf76646ce2c33","proposalId":"plan-proposal-91331054f51cda435b4ca844c28393b8"},"revision":2} |
| per-request | C-111 | fail | the platform did not do it: timed out after 20 min waiting for the second request candidate |
| why | C-112, C-226 | fail | 追问后候选不变：false；回答 2946 字 |
| continues | C-105 | pass | 同一请求 3 轮，秘书 Session session-ec976ab1c6766dba321744d52e6d5a22d6264771ea73401734265765d0073250 |
| request-goal | C-107 | pass | 请求记的目标 goal-confirm:goal.confirmDraft:3ef45fa07a9dc50b7f044fedf015b9957181550a3f91660cf5a9a5b2a2a45964 |
| cards-ask | C-113 | pass | 秘书线的 turn 输入带 ## Cards：true |
| multi-round | C-194 | pass | 后续轮的回答接上前面改过的内容（process.argv） |

- goal-confirm:goal.confirmDraft:3ef45fa07a9dc50b7f044fedf015b9957181550a3f91660cf5a9a5b2a2a45964: the draft chose every_step; set to after_plan_confirmation after adoption (committed )
- stopped: not-run: timed out after 20 min waiting for the second request candidate

### intervention：fail

- C 行：C-199, C-200, C-201, C-202, C-203, C-114, C-189, C-192, C-197, C-198；自治档 `after_plan_confirmation`；provider `deepseek` / `deepseek-v4.1-flash`。
- 用量：输入 448294（含缓存命中），输出 5742，缓存命中 350976，Query 请求 8。

| 判据 | C 行 | 结果 | 说明 |
|---|---|---|---|
| ask-copy | C-198 | uncovered (not-run) | stopped before this check: timed out after 60 min waiting for goal-confirm:goal.confirmDraft:283de9aeec2801beadaf69f0630ee225db4d4ef583e7cde1335010fc230d7421 to reach COMPLETED/FAILED/CANCELLED/ACCEPTED_PARTIAL |
| delivery-states | C-189, C-192 | uncovered (not-run) | stopped before this check: timed out after 60 min waiting for goal-confirm:goal.confirmDraft:283de9aeec2801beadaf69f0630ee225db4d4ef583e7cde1335010fc230d7421 to reach COMPLETED/FAILED/CANCELLED/ACCEPTED_PARTIAL |
| continue-no-planning | C-199 | uncovered (not-run) | stopped before this check: timed out after 60 min waiting for goal-confirm:goal.confirmDraft:283de9aeec2801beadaf69f0630ee225db4d4ef583e7cde1335010fc230d7421 to reach COMPLETED/FAILED/CANCELLED/ACCEPTED_PARTIAL |
| planning-when-idle | C-199, C-200 | uncovered (not-run) | stopped before this check: timed out after 60 min waiting for goal-confirm:goal.confirmDraft:283de9aeec2801beadaf69f0630ee225db4d4ef583e7cde1335010fc230d7421 to reach COMPLETED/FAILED/CANCELLED/ACCEPTED_PARTIAL |
| four-endings | C-201, C-202, C-203 | uncovered (not-run) | stopped before this check: timed out after 60 min waiting for goal-confirm:goal.confirmDraft:283de9aeec2801beadaf69f0630ee225db4d4ef583e7cde1335010fc230d7421 to reach COMPLETED/FAILED/CANCELLED/ACCEPTED_PARTIAL |
| completed-goal | C-114 | fail | the platform did not do it: timed out after 60 min waiting for goal-confirm:goal.confirmDraft:283de9aeec2801beadaf69f0630ee225db4d4ef583e7cde1335010fc230d7421 to reach COMPLETED/FAILED/CANCELLED/ACCEPTED_PARTIAL |
| paused-queues | C-197 | uncovered (not-run) | stopped before this check: timed out after 60 min waiting for goal-confirm:goal.confirmDraft:283de9aeec2801beadaf69f0630ee225db4d4ef583e7cde1335010fc230d7421 to reach COMPLETED/FAILED/CANCELLED/ACCEPTED_PARTIAL |

- stopped: not-run: timed out after 60 min waiting for goal-confirm:goal.confirmDraft:283de9aeec2801beadaf69f0630ee225db4d4ef583e7cde1335010fc230d7421 to reach COMPLETED/FAILED/CANCELLED/ACCEPTED_PARTIAL
- goal-confirm:goal.confirmDraft:283de9aeec2801beadaf69f0630ee225db4d4ef583e7cde1335010fc230d7421 (RUNNING): pause because intervention ended: committed

### waiting：fail

- C 行：C-170, C-171, C-187, C-188, C-190, C-172, C-184, C-189, C-192, C-195, C-196, C-207, C-224, C-225；自治档 `after_plan_confirmation`；provider `deepseek` / `deepseek-v4.1-flash`。
- 用量：输入 3089476（含缓存命中），输出 30272，缓存命中 2683776，Query 请求 42。

| 判据 | C 行 | 结果 | 说明 |
|---|---|---|---|
| wait-open | C-188, C-225 | fail | the platform did not do it: plans/propose issues: [{"path":"obligations[o-tests].verificationRequirements","code":"empty_verification_requirements","message":"required obligation o-tests compiles fewer than 2 required VerificationRequirement(s)"}] |
| restart-kept | C-170, C-207 | uncovered (not-run) | stopped before this check: plans/propose issues: [{"path":"obligations[o-tests].verificationRequirements","code":"empty_verification_requirements","message":"required obligation o-tests compiles fewer than 2 required VerificationRequirement(s)"}] |
| expiry-once | C-171, C-190 | uncovered (not-run) | stopped before this check: plans/propose issues: [{"path":"obligations[o-tests].verificationRequirements","code":"empty_verification_requirements","message":"required obligation o-tests compiles fewer than 2 required VerificationRequirement(s)"}] |
| second-expiry | C-171, C-190, C-224 | uncovered (not-run) | stopped before this check: plans/propose issues: [{"path":"obligations[o-tests].verificationRequirements","code":"empty_verification_requirements","message":"required obligation o-tests compiles fewer than 2 required VerificationRequirement(s)"}] |
| consumes | C-187 | uncovered (not-run) | stopped before this check: plans/propose issues: [{"path":"obligations[o-tests].verificationRequirements","code":"empty_verification_requirements","message":"required obligation o-tests compiles fewer than 2 required VerificationRequirement(s)"}] |
| late-reply | C-224, C-189 | uncovered (not-run) | stopped before this check: plans/propose issues: [{"path":"obligations[o-tests].verificationRequirements","code":"empty_verification_requirements","message":"required obligation o-tests compiles fewer than 2 required VerificationRequirement(s)"}] |
| transfer | C-224 | uncovered (not-run) | stopped before this check: plans/propose issues: [{"path":"obligations[o-tests].verificationRequirements","code":"empty_verification_requirements","message":"required obligation o-tests compiles fewer than 2 required VerificationRequirement(s)"}] |
| disconnect | C-195, C-196 | uncovered (not-run) | stopped before this check: plans/propose issues: [{"path":"obligations[o-tests].verificationRequirements","code":"empty_verification_requirements","message":"required obligation o-tests compiles fewer than 2 required VerificationRequirement(s)"}] |
| supply-order | C-172, C-192, C-184 | uncovered (not-run) | stopped before this check: plans/propose issues: [{"path":"obligations[o-tests].verificationRequirements","code":"empty_verification_requirements","message":"required obligation o-tests compiles fewer than 2 required VerificationRequirement(s)"}] |

- stopped: not-run: plans/propose issues: [{"path":"obligations[o-tests].verificationRequirements","code":"empty_verification_requirements","message":"required obligation o-tests compiles fewer than 2 required VerificationRequirement(s)"}]
- g6-wait-mwicbapt-73 (PLANNING): pause because waiting ended: committed

## 撞墙表

| 时间 | 场景 | 哪一步 | 看到的拒绝原文和理由 | 类别 | 预期 | 建议包 |
|---|---|---|---|---|---|---|
| 2026-11-15T15:25:40.568Z | A1 | core/completion-policies/read | not_found: project b9b0f8ee11f6cba8597eb8d672d70dfa has no active CompletionPolicy | 无理由 | expected | 待定 |
| 2026-11-15T15:30:47.722Z | B1 | core/completion-policies/read | not_found: project g6-wb has no active CompletionPolicy | 无理由 | expected | 待定 |
| 2026-11-15T15:37:33.504Z | E05 | tool submit_initial_plan (call call_177dc12f38084f9196772b8b) | invalid: the answer has problems; fix every one and call the tool again in this round | 无理由 | - | 待定 |
| 2026-11-15T15:37:53.222Z | E05 | tool submit_initial_plan (call call_06acd067060f44c7967b8262) | invalid_arguments: 工具参数不符合 schema：summary: Invalid input: expected string, received undefined; planDraftIndex: Invalid input: expected number, received undefined | 无理由 | - | 待定 |
| 2026-11-15T15:44:07.834Z | E05 | tool read (call chatcmpl-tool-a8b526961a547c57) | permission_denied: 请求路径不在允许范围 | 无理由 | - | 待定 |
| 2026-11-15T15:45:50.432Z | E05 | tool edit (call chatcmpl-tool-8bd34349de7e8484) | invalid_arguments: 工具参数不符合 schema：(根): Unrecognized key: "expectedRevision" | 安全 | - | 待定 |
| 2026-11-15T15:46:05.274Z | E05 | tool edit (call chatcmpl-tool-be417cfeb187eec3) | execution_failed: test/users.test.js 不存在 | 无理由 | - | 待定 |
| 2026-11-15T15:51:40.843Z | E05 | tool look_graph (call call_01_0fwxwxc19e48vf5lzf0uya5x) | invalid_arguments: 工具参数不符合 schema：(根): Invalid input | 无理由 | - | 待定 |
| 2026-11-15T15:51:50.819Z | E05 | tool read_execution_history (call call_00_vafcev3yot0dbdhft2c1rzu5) | capacity: the complete graph tool result exceeds 48 KiB; request a smaller page or drill down into one node | 协调 | - | 待定 |
| 2026-11-15T15:52:12.110Z | E05 | tool read_execution_history (call call_00_8frfrksnm56wisvwy6o15i84) | invalid: afterCursor is not a graph execution-history continuation cursor (Run 4450e2dc-f7b8-4351-9b98-9a12e3d58902) | 无理由 | - | 待定 |
| 2026-11-15T15:52:46.798Z | E05 | tool read_execution_history (call call_00_q0x80s32lyjy5ws78r9wucty) | source_stale: the persisted execution-history identity or start changed since the page was frozen (Run 4450e2dc-f7b8-4351-9b98-9a12e3d58902) | 协调 | - | 待定 |
| 2026-11-15T15:53:22.244Z | E05 | tool look_graph (call chatcmpl-tool-b15a368b02e33325) | invalid_arguments: 工具参数不符合 schema：(根): Invalid input | 无理由 | - | 待定 |
| 2026-11-15T15:53:30.375Z | E05 | tool propose_future_plan (call chatcmpl-tool-b7adbbc215728488) | execution_failed: the plan write did not return a result; its outcome is unconfirmed and it may already be committed. Do not report it as not committed and do not retry under a new callId; verify the original receipt with the same trusted request identity. | 无理由 | - | 待定 |
| 2026-11-15T15:53:46.861Z | E05 | tool look_graph (call chatcmpl-tool-8eeaa7e491523fb0) | invalid_arguments: 工具参数不符合 schema：(根): Invalid input | 无理由 | - | 待定 |
| 2026-11-15T15:53:46.879Z | E05 | tool find_graph (call chatcmpl-tool-a96f6958dff72e83) | invalid_arguments: 工具参数不符合 schema：memory.pathPrefix: Too small: expected string to have >=1 characters | 无理由 | - | 待定 |
| 2026-11-15T15:53:50.594Z | E05 | tool look_graph (call chatcmpl-tool-bf0fe3c3bb18e0ff) | invalid_arguments: 工具参数不符合 schema：(根): Invalid input | 无理由 | - | 待定 |
| 2026-11-15T15:54:01.040Z | E05 | tool record_note (call chatcmpl-tool-a109cb40236b5c30) | invalid_arguments: 工具参数不符合 schema：topic: Invalid input: expected string, received undefined; conclusion: Invalid input: expected string, received undefined | 无理由 | - | 待定 |
| 2026-11-15T15:59:58.038Z | E05 | tool read_execution_history (call call_00_p9pva95uqv2rn6w33tut7hbc) | invalid: afterCursor is not a continuation cursor for this Session and execution identity (Run f2fadf27-c812-45bf-a1cd-0b3ede125af6) | 无理由 | - | 待定 |
| 2026-11-15T16:00:41.541Z | E05 | tool propose_future_plan (call chatcmpl-tool-bec0ffd619e15fa3) | execution_failed: the plan write did not return a result; its outcome is unconfirmed and it may already be committed. Do not report it as not committed and do not retry under a new callId; verify the original receipt with the same trusted request identity. | 无理由 | - | 待定 |
| 2026-11-15T16:00:57.942Z | E05 | tool record_note (call chatcmpl-tool-91235e8883c7d46a) | invalid_arguments: 工具参数不符合 schema：(根): Unrecognized key: "expectedVersion" | 安全 | - | 待定 |
| 2026-11-15T16:01:08.864Z | E05 | tool find_graph (call chatcmpl-tool-a9d5b6a555f27754) | invalid_arguments: 工具参数不符合 schema：(根): Invalid input | 无理由 | - | 待定 |
| 2026-11-15T18:15:38.782Z | E08 | tool read (call call_e805e32961024013835136f0) | permission_denied: 请求路径不在允许范围 | 无理由 | - | 待定 |
| 2026-11-15T18:16:11.173Z | E08 | tool submit_initial_plan (call call_73587402d96a4b2886268a9d) | invalid_arguments: 工具参数不符合 schema：setup: Unrecognized key: "completionPolicy_note" | 安全 | - | 待定 |
| 2026-11-15T18:16:30.517Z | E08 | tool submit_initial_plan (call call_e8c08850484e4f33b235de43) | invalid: the answer has problems; fix every one and call the tool again in this round | 无理由 | - | 待定 |
| 2026-11-15T18:16:55.451Z | E08 | core/goals/confirm-draft confirm-again-mwi5pbiz-36 | revision_conflict: the draft already created a goal; one card never makes two goals | 协调 | expected | 待定 |
| 2026-11-15T18:16:55.462Z | E08 | core/goals/control goals-control-mwi5pbja-37 | invalid: meta.expected must pin the Goal and its GoalPhase (0 = none stored) | 产品规则 | expected | 待定 |
| 2026-11-15T18:22:31.110Z | E08 | tool look_graph (call call_c053e22bcb5c4f70977470c4) | not_found: anchor_not_found | 无理由 | - | 待定 |
| 2026-11-15T18:22:31.117Z | E08 | tool look_graph (call call_c7be78796474475c83a502c8) | not_found: anchor_not_found | 无理由 | - | 待定 |
| 2026-11-15T18:22:41.334Z | E08 | tool look_graph (call call_bd1923b039e74100901a1280) | invalid_arguments: 工具参数不符合 schema：(根): Invalid input | 无理由 | - | 待定 |
| 2026-11-15T18:22:52.602Z | E08 | tool edit (call call_3f776774f5b242e9a5bf8f0e) | invalid_arguments: 工具参数不符合 schema：(根): Unrecognized key: "expectedRevision" | 安全 | - | 待定 |
| 2026-11-15T18:22:58.286Z | E08 | tool edit (call call_855ef517b39d451b8d9ebb9f) | execution_failed: test/mul.test.js 不存在 | 无理由 | - | 待定 |
| 2026-11-15T18:23:14.477Z | E08 | tool submit_plan_round (call call_5feac8b49c1d4100888f72a4) | invalid_arguments: 工具参数不符合 schema：plan.tasks.0: Unrecognized key: "phase"; plan.tasks.1: Unrecognized key: "phase"; plan.tasks.2: Unrecognized key: "phase" | 安全 | - | 待定 |
| 2026-11-15T18:23:26.091Z | E08 | core/plans/apply plans-apply-mwi5xoy3-41 | invalid: the future plan is not admissible: obligations[ob-accept]: source obligation ob-accept changed its title, strength or verification requirements; tasks[gate]: source gate task gate changed its definition or acceptance relationships | 产品规则 | - | 待定 |
| 2026-11-15T18:24:04.644Z | E09 | tool run_readonly_command (call call_5164dee2f0d64a119f6d00c3) | execution_failed: 命令退出码 2 | 无理由 | - | 待定 |
| 2026-11-15T18:24:50.863Z | E09 | tool submit_initial_plan (call call_6f5d1969dabc48698030c765) | invalid_arguments: 工具参数不符合 schema：plan.executionDag.dependsOn.3.requires.kind: Invalid option: expected one of "output-contract"\|"artifact"\|"decision"\|"environment-revision"\|"gate-result" | 产品规则 | - | 待定 |
| 2026-11-15T18:25:16.006Z | E09 | tool submit_initial_plan (call call_3185d6b321c347df9dbf8043) | invalid: the answer has problems; fix every one and call the tool again in this round | 无理由 | - | 待定 |
| 2026-11-15T18:30:10.676Z | E09 | tool look_graph (call call_79cd8eaa69594517acf0d7d2) | execution_failed: the note memory read port is not bound for this Run | 无理由 | - | 待定 |
| 2026-11-15T18:30:10.686Z | E09 | tool look_graph (call call_7d8e790d39c64239ac7f9510) | execution_failed: the note memory read port is not bound for this Run | 无理由 | - | 待定 |
| 2026-11-15T18:30:14.054Z | E09 | tool read (call call_45932ff5a2d447cf9111db0e) | permission_denied: 请求路径不在允许范围 | 无理由 | - | 待定 |
| 2026-11-15T18:32:00.159Z | E09 | tool edit (call call_2764e3349ddb4fc1a08e4815) | invalid_arguments: 工具参数不符合 schema：expectedRevision: Invalid input: expected string, received undefined | 无理由 | - | 待定 |
| 2026-11-15T18:32:50.117Z | E09 | tool find_graph (call call_ff25f99e5f4c4e36b5e7bcda) | invalid_arguments: 工具参数不符合 schema：(根): Invalid input | 无理由 | - | 待定 |
| 2026-11-15T18:34:58.313Z | E09 | tool shell (call call_68f51660bc5f48bfbb218754) | execution_failed: shell 退出码 2 | 无理由 | - | 待定 |
| 2026-11-15T18:35:52.930Z | E09 | tool edit (call call_17bb49e2a82b449cb09555ae) | invalid_arguments: 工具参数不符合 schema：(根): Unrecognized key: "expectedRevision" | 安全 | - | 待定 |
| 2026-11-15T18:35:54.223Z | E09 | tool look_graph (call call_3929d5de39754b5fa9423805) | invalid_arguments: 工具参数不符合 schema：(根): Invalid input | 无理由 | - | 待定 |
| 2026-11-15T18:35:57.470Z | E09 | tool look_graph (call call_79f27f149f7f4e24b4a672cc) | invalid_arguments: 工具参数不符合 schema：(根): Invalid input | 无理由 | - | 待定 |
| 2026-11-15T18:36:00.740Z | E09 | tool look_graph (call call_8323870e4edd4271aa8769a0) | capacity: the complete graph tool result exceeds 48 KiB; request a smaller page or drill down into one node | 协调 | - | 待定 |
| 2026-11-15T18:36:01.151Z | E09 | tool edit (call call_22db0647b8284abd8a3e03ad) | execution_failed: test/api.test.js 不存在 | 无理由 | - | 待定 |
| 2026-11-15T18:39:08.959Z | E12 | tool read (call call_bd8ecfd5249b4f8aa5c92a1e) | permission_denied: 请求路径不在允许范围 | 无理由 | - | 待定 |
| 2026-11-15T18:39:08.965Z | E12 | tool look_graph (call call_95bd207dd94a4758a23df8e0) | execution_failed: the graph look could not be read | 无理由 | - | 待定 |
| 2026-11-15T18:39:43.831Z | E12 | tool submit_initial_plan (call call_7aea16775a004cad9d9b7a16) | invalid: the answer has problems; fix every one and call the tool again in this round | 无理由 | - | 待定 |
| 2026-11-15T18:45:44.910Z | E12 | tool read (call call_8652ebd69a794a2e91355e08) | permission_denied: 请求路径不在允许范围 | 无理由 | - | 待定 |
| 2026-11-15T18:46:09.355Z | E12 | tool edit (call call_7b058b9ccd58457a85ff0a63) | execution_failed: test/greet.test.js 不存在 | 无理由 | - | 待定 |
| 2026-11-15T18:46:31.378Z | E12 | tool send_session_message (call call_a774970c54bf4ea18ebf4749) | invalid: a goal-bearing action_request requires the expected basis | 产品规则 | - | 待定 |
| 2026-11-15T18:46:42.813Z | E12 | tool send_session_message (call call_68aa677ea41c44b8adee2b12) | revision_conflict: the dispatch basis moved since it was read | 协调 | - | 待定 |
| 2026-11-15T18:47:09.750Z | E12 | tool request_rework (call call_2429d39dedce4297b8efabb3) | revision_conflict: the requeue names a Run that is not the Task selected Run | 协调 | - | 待定 |
| 2026-11-15T18:53:17.430Z | E12 | tool read_execution_history (call call_03c21db1a89e40f5af806b0d) | capacity: the complete graph tool result exceeds 48 KiB; request a smaller page or drill down into one node | 协调 | - | 待定 |
| 2026-11-15T18:54:03.999Z | E12 | tool read_execution_history (call call_b4eb0d4c369b4f8abd91d6d3) | source_stale: the persisted execution-history identity or start changed since the page was frozen (Run 3991e6bd-07a0-453c-8643-7e7d1ea025f3) | 协调 | - | 待定 |
| 2026-11-15T18:54:04.023Z | E12 | tool look_graph (call call_3d8fc256db3c468f86dfb64e) | invalid_arguments: 工具参数不符合 schema：(根): Invalid input | 无理由 | - | 待定 |
| 2026-11-15T18:54:08.427Z | E12 | tool look_graph (call call_48bd14b031d14d4ca3d27e26) | invalid_arguments: 工具参数不符合 schema：(根): Invalid input | 无理由 | - | 待定 |
| 2026-11-15T18:54:49.813Z | E12 | tool read_execution_history (call call_625603925bed49aeab1b6358) | invalid: afterCursor is not a graph execution-history continuation cursor (Run 3991e6bd-07a0-453c-8643-7e7d1ea025f3) | 无理由 | - | 待定 |
| 2026-11-15T18:54:49.842Z | E12 | tool look_graph (call call_79b03b0b01b14246a341d77d) | invalid_arguments: 工具参数不符合 schema：(根): Invalid input | 无理由 | - | 待定 |
| 2026-11-15T18:55:21.834Z | E12 | tool read_execution_history (call call_e3db7f6c9412452aa28f38d6) | invalid: afterCursor is not a graph execution-history continuation cursor (Run 3991e6bd-07a0-453c-8643-7e7d1ea025f3) | 无理由 | - | 待定 |
| 2026-11-15T18:55:21.861Z | E12 | tool look_graph (call call_5649ba7890bb40fab58fc65e) | invalid_arguments: 工具参数不符合 schema：(根): Invalid input | 无理由 | - | 待定 |
| 2026-11-15T18:55:52.663Z | E12 | tool read_execution_history (call call_ea1dd20a300d41c689b5b5cb) | invalid: afterCursor is not a graph execution-history continuation cursor (Run 3991e6bd-07a0-453c-8643-7e7d1ea025f3) | 无理由 | - | 待定 |
| 2026-11-15T18:55:55.994Z | E12 | tool read_execution_history (call call_df58d293ced04ce8a87a02b3) | capacity: the complete graph tool result exceeds 48 KiB; request a smaller page or drill down into one node | 协调 | - | 待定 |
| 2026-11-15T18:55:56.022Z | E12 | tool look_graph (call call_718ab8a5b70e45d496a77b7c) | invalid: lookGraph: path must be a safe workspace-relative or prefixed project path | 产品规则 | - | 待定 |
| 2026-11-15T18:56:00.388Z | E12 | tool look_graph (call call_17438de3b3bc457d9d20d8a1) | invalid_arguments: 工具参数不符合 schema：(根): Invalid input | 无理由 | - | 待定 |
| 2026-11-15T18:56:30.717Z | E12 | tool read_execution_history (call call_70a41f09ce0d449e89ede65d) | invalid: afterCursor is not a graph execution-history continuation cursor (Run 3991e6bd-07a0-453c-8643-7e7d1ea025f3) | 无理由 | - | 待定 |
| 2026-11-15T19:04:39.192Z | E12 | tool read_execution_history (call call_0c4ea389dac14e0ca8c7726b) | invalid: afterCursor is not a valid cursor for this Session mapping (Run 9dc9a03d-ea58-4735-bf33-ba9fee876c1b) | 无理由 | - | 待定 |
| 2026-11-15T19:04:39.224Z | E12 | tool look_graph (call call_54677152a46f438094f0367e) | execution_failed: the note memory read port is not bound for this Run | 无理由 | - | 待定 |
| 2026-11-15T19:10:20.866Z | E12 | tool read_execution_history (call call_7fef5a1b82c943858345452b) | invalid: afterCursor is not a graph execution-history continuation cursor (Run 3991e6bd-07a0-453c-8643-7e7d1ea025f3) | 无理由 | - | 待定 |
| 2026-11-15T19:11:03.800Z | E12 | tool read_execution_history (call call_8cf14fed31fb4c8486a25953) | invalid: afterCursor is not a graph execution-history continuation cursor (Run 3991e6bd-07a0-453c-8643-7e7d1ea025f3) | 无理由 | - | 待定 |
| 2026-11-15T19:19:05.039Z | E12 | tool submit_plan_round (call call_6c20c89731364595b99bc4dc) | invalid_arguments: 工具参数不符合 schema：plan.tasks.0: Unrecognized key: "phase"; plan.tasks.1: Unrecognized key: "phase"; plan.tasks.2: Unrecognized key: "phase"; plan.tasks.3: Unrecognized key: "phase" | 安全 | - | 待定 |
| 2026-11-15T19:19:18.076Z | E12 | core/plans/apply plans-apply-mwi7xjcs-54 | incomplete: the initial plan is not admissible: tasks: at least one active required GoalGate task (required+gate+active+scope=goal) is required: add one required active gate task with scope {kind:"goal"} and list it in a required obligation's taskIds | 产品规则 | - | 待定 |
| 2026-11-15T19:20:04.523Z | iteration | tool submit_initial_plan (call call_8ce7f2823dd04226b4589a00) | invalid: the answer has problems; fix every one and call the tool again in this round | 无理由 | - | 待定 |
| 2026-11-15T19:22:16.805Z | iteration | tool look_graph (call call_ef5b2e01945446e1bbad3cd5) | invalid_arguments: 工具参数不符合 schema：(根): Invalid input | 无理由 | - | 待定 |
| 2026-11-15T19:22:22.268Z | iteration | tool look_graph (call call_c70826855a344f3fa7480416) | invalid_arguments: 工具参数不符合 schema：(根): Invalid input | 无理由 | - | 待定 |
| 2026-11-15T19:27:00.612Z | iteration | tool look_graph (call call_e8e74e59a081424687fb1bfe) | forbidden: the Module node is outside the requested project | 无理由 | - | 待定 |
| 2026-11-15T19:28:06.941Z | iteration | tool submit_plan_round (call call_bfde118a630642978a5105bf) | invalid_arguments: 工具参数不符合 schema：summary: Invalid input: expected string, received undefined; plan: Unrecognized key: "summary" | 安全 | - | 待定 |
| 2026-11-15T19:29:01.296Z | iteration | tool look_graph (call call_3fa3d83d576542c38ff0fa75) | invalid_arguments: 工具参数不符合 schema：(根): Invalid input | 无理由 | - | 待定 |
| 2026-11-15T19:29:24.160Z | iteration | tool run_readonly_command (call call_2b1886fa77c8401e98317fea) | execution_failed: 命令退出码 1 | 无理由 | - | 待定 |
| 2026-11-15T19:51:01.484Z | intervention | tool submit_initial_plan (call call_93b9323cdf5f43f69a08aca9) | invalid: the answer has problems; fix every one and call the tool again in this round | 无理由 | - | 待定 |
| 2026-11-15T19:57:19.418Z | intervention | tool read (call call_c0ed3ec1b33b44f2b5027b15) | permission_denied: 请求路径不在允许范围 | 无理由 | - | 待定 |
| 2026-11-15T19:57:22.111Z | intervention | tool read (call call_2d50957d72504a6f8a30fd37) | execution_failed: test 不存在 | 无理由 | - | 待定 |
| 2026-11-15T19:57:30.068Z | intervention | tool edit (call call_4ea5f48e7d7d449c8ec0f746) | execution_failed: test/lower.test.js 不存在 | 无理由 | - | 待定 |
| 2026-11-15T20:51:26.412Z | waiting | tool read (call call_09ccf9fb9a114be7b65e368d) | permission_denied: 请求路径不在允许范围 | 无理由 | - | 待定 |
| 2026-11-15T20:51:49.747Z | waiting | tool submit_initial_plan (call call_a26c36bfc46f4c43980b3f18) | invalid: the answer has problems; fix every one and call the tool again in this round | 无理由 | - | 待定 |
| 2026-11-15T21:02:14.980Z | waiting | tool run_readonly_command (call call_ffcf4e2e54e44af8a7398bfd) | execution_failed: 命令退出码 1 | 无理由 | - | 待定 |
| 2026-11-15T21:02:19.696Z | waiting | tool look_graph (call call_20a77f965f2646848ab53a24) | invalid_arguments: 工具参数不符合 schema：(根): Invalid input | 无理由 | - | 待定 |
| 2026-11-15T21:02:30.000Z | waiting | tool read_execution_history (call call_1285b8129cd64aafacfed14a) | capacity: the complete graph tool result exceeds 48 KiB; request a smaller page or drill down into one node | 协调 | - | 待定 |
| 2026-11-15T21:03:18.374Z | waiting | tool look_graph (call call_08ef81dc577747dba63d0588) | invalid_arguments: 工具参数不符合 schema：(根): Invalid input | 无理由 | - | 待定 |
| 2026-11-15T21:03:23.984Z | waiting | tool look_graph (call call_7a34384eb58d47f4b6be0787) | invalid_arguments: 工具参数不符合 schema：(根): Invalid input | 无理由 | - | 待定 |
| 2026-11-15T21:04:14.127Z | waiting | tool read_execution_history (call call_c53a265a9c5c4a0699be16ea) | invalid: afterCursor is not a continuation cursor for this Session and execution identity (Run 08036bea-e0ca-4326-a8bf-8f940634c6fb) | 无理由 | - | 待定 |
| 2026-11-15T21:04:40.236Z | waiting | tool read_execution_history (call call_90ad5fdea470472e902e7b19) | invalid: afterCursor is not a continuation cursor for this Session and execution identity (Run 08036bea-e0ca-4326-a8bf-8f940634c6fb) | 无理由 | - | 待定 |
| 2026-11-15T21:05:09.510Z | waiting | tool read_execution_history (call call_9cda98343bbe43a4817a385b) | invalid: afterCursor is not a continuation cursor for this Session and execution identity (Run 08036bea-e0ca-4326-a8bf-8f940634c6fb) | 无理由 | - | 待定 |
| 2026-11-15T21:22:14.467Z | C-216 | tool run_readonly_command (call call_deff31849c98456eb5f1af18) | execution_failed: 命令退出码 1 | 无理由 | - | 待定 |
| 2026-11-15T21:22:35.927Z | C-216 | tool submit_initial_plan (call call_49feef033d444c36b2b9a67c) | invalid: the answer has problems; fix every one and call the tool again in this round | 无理由 | - | 待定 |
| 2026-11-15T21:29:00.351Z | C-216 | tool look_graph (call call_e3bbfba874b241ec85e11178) | invalid_arguments: 工具参数不符合 schema：(根): Invalid input | 无理由 | - | 待定 |
| 2026-11-15T21:29:04.172Z | C-216 | tool look_graph (call call_10b24e24644e49dab78e9b8f) | invalid_arguments: 工具参数不符合 schema：(根): Invalid input | 无理由 | - | 待定 |
| 2026-11-15T21:29:08.115Z | C-216 | tool look_graph (call call_b21bd796e19d48c099378908) | forbidden: the Task node is outside the requested goal | 无理由 | - | 待定 |
| 2026-11-15T21:29:11.354Z | C-216 | tool look_graph (call call_db45b8a2d1ea49369452a042) | execution_failed: the graph look could not be read | 无理由 | - | 待定 |
| 2026-11-15T21:29:15.093Z | C-216 | tool look_graph (call call_47dd42f41cf84caaa8961058) | forbidden: the Run node is outside the requested goal | 无理由 | - | 待定 |
| 2026-11-15T21:29:26.789Z | C-216 | tool find_graph (call call_faa7b08c65a14011a17044ff) | invalid_arguments: 工具参数不符合 schema：(根): Invalid input | 无理由 | - | 待定 |
| 2026-11-15T21:29:26.797Z | C-216 | tool find_graph (call call_95ef38ae13e5489dacbc43d8) | invalid: stale needs a goalId or an anchor | 无理由 | - | 待定 |
| 2026-11-15T22:53:15.185Z | C-221 | tool read (call call_e8a1958ed5c440659fe1394d) | permission_denied: 请求路径不在允许范围 | 无理由 | - | 待定 |
| 2026-11-15T22:53:34.325Z | C-221 | tool submit_initial_plan (call call_4c4ac450bb60444884ece96b) | invalid: the answer has problems; fix every one and call the tool again in this round | 无理由 | - | 待定 |
| 2026-11-15T22:53:49.076Z | C-221 | tool submit_initial_plan (call call_35a49011c5f7471eb66c8c51) | invalid_arguments: 工具参数不符合 schema：planDraftIndex: Invalid input: expected number, received undefined | 无理由 | - | 待定 |
| 2026-11-15T22:59:30.343Z | C-221 | tool run_readonly_command (call call_82f6273799814271980f0918) | execution_failed: 命令退出码 2 | 无理由 | - | 待定 |
| 2026-11-15T22:59:41.971Z | C-221 | tool read (call call_e11817b9413945c9a95ed8fb) | permission_denied: 请求路径不在允许范围 | 无理由 | - | 待定 |
| 2026-11-15T23:00:01.970Z | C-221 | tool edit (call call_af48d2802aeb48c4a95b6ea9) | execution_failed: test/fizzbuzz.test.js 不存在 | 无理由 | - | 待定 |
| 2026-11-16T00:30:39.665Z | C-222 | tool read (call call_9f4c358fa7a6412b89dc111e) | permission_denied: 请求路径不在允许范围 | 无理由 | - | 待定 |
| 2026-11-16T00:30:56.088Z | C-222 | tool edit (call call_03d833bef53d4bbea57a7301) | invalid_arguments: 工具参数不符合 schema：(根): Unrecognized key: "expectedRevision" | 安全 | - | 待定 |
| 2026-11-16T00:31:01.191Z | C-222 | tool edit (call call_950769a271f64d2a9c622db9) | execution_failed: test/shapes.test.js 不存在 | 无理由 | - | 待定 |
| 2026-11-16T00:31:18.730Z | C-222 | tool look_graph (call call_4707357a63a94c8a82f46cbc) | invalid_arguments: 工具参数不符合 schema：(根): Invalid input | 无理由 | - | 待定 |
| 2026-11-16T00:31:21.837Z | C-222 | tool look_graph (call call_df9502672a0941519fd017df) | invalid_arguments: 工具参数不符合 schema：(根): Invalid input | 无理由 | - | 待定 |
| 2026-11-16T00:31:47.887Z | C-222 | tool read (call call_31f70994d1904c2cb750648e) | execution_failed: package.json 不存在 | 无理由 | - | 待定 |
| 2026-11-16T00:36:27.644Z | C-222 | tool look_graph (call call_2d8d1a727183402da884dfd4) | invalid_arguments: 工具参数不符合 schema：(根): Invalid input | 无理由 | - | 待定 |
| 2026-11-16T00:36:36.836Z | C-222 | tool look_graph (call call_3c8dd3d800e3463895f29489) | invalid_arguments: 工具参数不符合 schema：(根): Invalid input | 无理由 | - | 待定 |
| 2026-11-16T00:36:36.903Z | C-222 | tool read_execution_history (call call_b42145089ec349a6904fbe92) | capacity: the complete graph tool result exceeds 48 KiB; request a smaller page or drill down into one node | 协调 | - | 待定 |
| 2026-11-16T00:36:48.898Z | C-222 | tool read_execution_history (call call_855f190121f54bc3a3faf5d3) | capacity: the complete graph tool result exceeds 48 KiB; request a smaller page or drill down into one node | 协调 | - | 待定 |
| 2026-11-16T00:37:10.658Z | C-222 | tool read_execution_history (call call_6872ecd84622421aab08eb76) | invalid: afterCursor is not a graph execution-history continuation cursor (Run c237f729-e1f4-4473-b8a0-d9da8ed9730f) | 无理由 | - | 待定 |
| 2026-11-16T00:37:31.087Z | C-222 | tool read_execution_history (call call_e9a25554739e4127aef3fed0) | invalid: afterCursor is not a continuation cursor for this Session and execution identity (Run c237f729-e1f4-4473-b8a0-d9da8ed9730f) | 无理由 | - | 待定 |
| 2026-11-16T00:40:50.172Z | C-222 | tool read_execution_history (call call_6d4a46778ea345c5a8e0da28) | invalid: afterCursor is not a graph execution-history continuation cursor (Run c237f729-e1f4-4473-b8a0-d9da8ed9730f) | 无理由 | - | 待定 |
| 2026-11-16T00:42:27.606Z | C-222 | tool read_execution_history (call call_925b9f7319da4c729ebc7a43) | invalid: afterCursor is not a graph execution-history continuation cursor (Run c237f729-e1f4-4473-b8a0-d9da8ed9730f) | 无理由 | - | 待定 |
| 2026-11-16T00:43:41.265Z | C-222 | tool read_execution_history (call call_4af6c96bf2bd425bbb802744) | invalid: afterCursor is not a valid cursor for this Session mapping (Run c237f729-e1f4-4473-b8a0-d9da8ed9730f) | 无理由 | - | 待定 |
| 2026-11-16T00:44:07.357Z | C-222 | tool read_execution_history (call call_02dd4136822c40df97a9467b) | invalid: afterCursor is not a valid cursor for this Session mapping (Run c237f729-e1f4-4473-b8a0-d9da8ed9730f) | 无理由 | - | 待定 |
| 2026-11-16T00:44:31.592Z | C-222 | tool read_execution_history (call call_06c0c2548a894ab3b5e6e624) | invalid: afterCursor is not a valid cursor for this Session mapping (Run c237f729-e1f4-4473-b8a0-d9da8ed9730f) | 无理由 | - | 待定 |
| 2026-11-16T00:44:36.951Z | C-222 | tool read_execution_history (call call_f05a998351df4cab90a9b8e8) | invalid: afterCursor is not a graph execution-history continuation cursor (Run c237f729-e1f4-4473-b8a0-d9da8ed9730f) | 无理由 | - | 待定 |
| 2026-11-16T00:47:02.329Z | C-222 | tool read_execution_history (call call_a3506bd449974bdd85533a61) | capacity: the complete graph tool result exceeds 48 KiB; request a smaller page or drill down into one node | 协调 | - | 待定 |
| 2026-11-16T00:55:43.515Z | C-222 | tool read_execution_history (call call_3ab4e401a91949148ff70f63) | invalid: afterCursor is not a graph execution-history continuation cursor (Run 18a1de6a-4be6-4ccd-8d22-1f27084c6c1b) | 无理由 | - | 待定 |
| 2026-11-16T01:08:39.804Z | C-222 | tool read_execution_history (call call_a0903e686ba649f296021748) | invalid: afterCursor is not a valid cursor for this Session mapping (Run c237f729-e1f4-4473-b8a0-d9da8ed9730f) | 无理由 | - | 待定 |
| 2026-11-16T01:09:12.709Z | C-222 | tool read_execution_history (call call_ec5768d43f024127a3d53e43) | capacity: the complete graph tool result exceeds 48 KiB; request a smaller page or drill down into one node | 协调 | - | 待定 |
| 2026-11-16T01:10:58.971Z | C-222 | tool look_graph (call call_734d1fba5dbc4e14a7dbbb2b) | invalid_arguments: 工具参数不符合 schema：(根): Invalid input | 无理由 | - | 待定 |
| 2026-11-16T01:11:00.936Z | C-222 | tool look_graph (call call_0095e849e2fa46f39e46f7c9) | execution_failed: the note memory read port is not bound for this Run | 无理由 | - | 待定 |
| 2026-11-16T01:11:05.174Z | C-222 | tool find_graph (call call_e6f58af451c24302822ec097) | execution_failed: the note memory read port is not bound for this Run | 无理由 | - | 待定 |
| 2026-11-16T01:24:28.744Z | C-222 | tool read_execution_history (call call_59f2547d05424b4e9b8becb1) | capacity: the complete graph tool result exceeds 48 KiB; request a smaller page or drill down into one node | 协调 | - | 待定 |
| 2026-11-16T01:26:13.411Z | C-222 | tool read_execution_history (call call_c3d8febd74b5475d9bc482d9) | source_stale: the persisted execution-history identity or start changed since the page was frozen (Run 18a1de6a-4be6-4ccd-8d22-1f27084c6c1b) | 协调 | - | 待定 |
| 2026-11-16T01:26:37.579Z | C-222 | tool read_execution_history (call call_5daceaf15cbc4a7f969c7322) | invalid: afterCursor is not a valid cursor for this Session mapping (Run 18a1de6a-4be6-4ccd-8d22-1f27084c6c1b) | 无理由 | - | 待定 |
| 2026-11-16T01:26:42.653Z | C-222 | tool read_execution_history (call call_1cc8a7e05d924bbd9e5c7fe0) | capacity: the complete graph tool result exceeds 48 KiB; request a smaller page or drill down into one node | 协调 | - | 待定 |
| 2026-11-16T01:27:12.383Z | C-222 | tool read_execution_history (call call_c9703e87eaa2470892b87581) | invalid: afterCursor is not a valid cursor for this Session mapping (Run 18a1de6a-4be6-4ccd-8d22-1f27084c6c1b) | 无理由 | - | 待定 |
| 2026-11-16T01:27:46.437Z | B06 | tool read (call call_00_mx0nk3c3r108z4bprt5r9hvk) | permission_denied: 请求路径不在允许范围 | 无理由 | - | 待定 |
| 2026-11-16T01:28:01.133Z | B06 | tool submit_initial_plan (call call_00_719xlh3t1l76v0qbevcss0dr) | invalid: the answer has problems; fix every one and call the tool again in this round | 无理由 | - | 待定 |
| 2026-11-16T01:33:49.631Z | B06 | tool read (call call_00c7fd3ab5d54ba58af5a40b) | permission_denied: 请求路径不在允许范围 | 无理由 | - | 待定 |
| 2026-11-16T02:30:50.987Z | compaction | tool run_readonly_command (call call_f6c94cf9ef1f46ff9ec473be) | execution_failed: 命令退出码 1 | 无理由 | - | 待定 |

每次拒绝一行：HTTP 拒绝（预期的也记，标 expected）和公开原历史里的每次工具拒绝（按调用身份去重），原文不截断。类别只认依据：busy/revision_conflict/idempotency_conflict/source_stale/capacity 记协调；理由点到不可逆、外部或秘密的记安全；理由点到规则的记产品规则；其余记“无理由”。

## A/B、压缩、附加格、B06

### A1：pass

- reserved（C-214）：pass。reservedOutput 131072（requestId b320e377-2f4c-4969-9e4c-4dc67efce558）
- usage（C-214）：pass。usageStatus reported，输入 29537，输出 140，缓存命中 25856
- accepted（C-214）：pass。请求被接受（用量已报）
- not-truncated（C-214）：pass。输出 140 < 预留 131072；close detail none
- driver-start: ready running
- 请求事实：[{"requestId":"b320e377-2f4c-4969-9e4c-4dc67efce558","reservedOutput":131072,"usageStatus":"reported","inputTokens":29537,"outputTokens":140,"cachedInputTokens":25856},{"requestId":"8e5a8013-1967-484d-9c85-6a276b0acdeb","reservedOutput":131072,"usageStatus":"reserved","inputTokens":null,"outputTokens":null,"cachedInputTokens":null}]；Query running；close null；profile 累计输出上限 null = 不设上限
- queries/cancel after the first request: ready stopping
- request 8e5a8013-1967-484d-9c85-6a276b0acdeb: cut by the driver's cancel; usage not reported, at most one request (Query closed, close cancelled)

### B1：pass

- reserved（C-214）：pass。reservedOutput 64000（requestId fa2aec8e-4cc1-48aa-bcdd-b1c1e3d0a303）
- usage（C-214）：pass。usageStatus reported，输入 16200，输出 102，缓存命中 12800
- accepted（C-214）：pass。请求被接受（用量已报）
- not-truncated（C-214）：pass。输出 102 < 预留 64000；close detail none
- fits（C-214）：pass。请求发出（reservedInput 以内），reservedOutput 64000
- driver-start: ready running
- 请求事实：[{"requestId":"fa2aec8e-4cc1-48aa-bcdd-b1c1e3d0a303","reservedOutput":64000,"usageStatus":"reported","inputTokens":16200,"outputTokens":102,"cachedInputTokens":12800},{"requestId":"480a5b7f-8037-4d5e-a673-39b433e25dbc","reservedOutput":63898,"usageStatus":"reserved","inputTokens":null,"outputTokens":null,"cachedInputTokens":null}]；Query running；close null；profile 累计输出上限 64000
- queries/cancel after the first request: ready stopping
- request 480a5b7f-8037-4d5e-a673-39b433e25dbc: cut by the driver's cancel; usage not reported, at most one request (Query closed, close cancelled)

### 压缩：pass

- compacted（K2-P2）：pass。context_compacted 3 条（kernhist1.eyJ2IjoxLCJwIjp7InByb2plY3RJZCI6ImFlODQ1MDI0Y2ZlYWU4YmFkNGQxNDE3NDllYmFhMzEwIiwic2Vzc2lvbklkIjoic2Vzc2lvbi0zYzcwOTA2NmI4MjFmZjEyNDVkMDY4MzY4MzQ5Y2Y4MWUyZWU4ZTNhNDEyNGY3N2EyZTA3ZDc5M2I2NzkzY2Y1In0sImEiOiJob3N0LXNldHRpbmdzLWtlcm5lbC03ZDZhYmJhNjMzMjRkY2U5MjkzOTVhMDA3YTY0MjkyYyIsImsiOiJzZXNzaW9uLTNjNzA5MDY2YjgyMWZmMTI0NWQwNjgzNjgzNDljZjgxZTJlZThlM2E0MTI0Zjc3YTJlMDdkNzkzYjY3OTNjZjUiLCJyIjoie1wiYWN0b3JcIjp7XCJpZFwiOlwiZzYtcGVyc29uXCIsXCJraW5kXCI6XCJodW1hblwifSxcImtpbmRcIjpcImhvc3RcIn0iLCJ1IjoxMDcsImwiOjEsImkiOjU4fQ:summary, kernhist1.eyJ2IjoxLCJwIjp7InByb2plY3RJZCI6ImFlODQ1MDI0Y2ZlYWU4YmFkNGQxNDE3NDllYmFhMzEwIiwic2Vzc2lvbklkIjoic2Vzc2lvbi0zYzcwOTA2NmI4MjFmZjEyNDVkMDY4MzY4MzQ5Y2Y4MWUyZWU4ZTNhNDEyNGY3N2EyZTA3ZDc5M2I2NzkzY2Y1In0sImEiOiJob3N0LXNldHRpbmdzLWtlcm5lbC03ZDZhYmJhNjMzMjRkY2U5MjkzOTVhMDA3YTY0MjkyYyIsImsiOiJzZXNzaW9uLTNjNzA5MDY2YjgyMWZmMTI0NWQwNjgzNjgzNDljZjgxZTJlZThlM2E0MTI0Zjc3YTJlMDdkNzkzYjY3OTNjZjUiLCJyIjoie1wiYWN0b3JcIjp7XCJpZFwiOlwiZzYtcGVyc29uXCIsXCJraW5kXCI6XCJodW1hblwifSxcImtpbmRcIjpcImhvc3RcIn0iLCJ1IjoxMDcsImwiOjEsImkiOjc5fQ:summary, kernhist1.eyJ2IjoxLCJwIjp7InByb2plY3RJZCI6ImFlODQ1MDI0Y2ZlYWU4YmFkNGQxNDE3NDllYmFhMzEwIiwic2Vzc2lvbklkIjoic2Vzc2lvbi0zYzcwOTA2NmI4MjFmZjEyNDVkMDY4MzY4MzQ5Y2Y4MWUyZWU4ZTNhNDEyNGY3N2EyZTA3ZDc5M2I2NzkzY2Y1In0sImEiOiJob3N0LXNldHRpbmdzLWtlcm5lbC03ZDZhYmJhNjMzMjRkY2U5MjkzOTVhMDA3YTY0MjkyYyIsImsiOiJzZXNzaW9uLTNjNzA5MDY2YjgyMWZmMTI0NWQwNjgzNjgzNDljZjgxZTJlZThlM2E0MTI0Zjc3YTJlMDdkNzkzYjY3OTNjZjUiLCJyIjoie1wiYWN0b3JcIjp7XCJpZFwiOlwiZzYtcGVyc29uXCIsXCJraW5kXCI6XCJodW1hblwifSxcImtpbmRcIjpcImhvc3RcIn0iLCJ1IjoxMDcsImwiOjEsImkiOjk2fQ:summary）
- six-sections（K2-P2）：pass。摘要（kernhist1.eyJ2IjoxLCJwIjp7InByb2plY3RJZCI6ImFlODQ1MDI0Y2ZlYWU4YmFkNGQxNDE3NDllYmFhMzEwIiwic2Vzc2lvbklkIjoic2Vzc2lvbi0zYzcwOTA2NmI4MjFmZjEyNDVkMDY4MzY4MzQ5Y2Y4MWUyZWU4ZTNhNDEyNGY3N2EyZTA3ZDc5M2I2NzkzY2Y1In0sImEiOiJob3N0LXNldHRpbmdzLWtlcm5lbC03ZDZhYmJhNjMzMjRkY2U5MjkzOTVhMDA3YTY0MjkyYyIsImsiOiJzZXNzaW9uLTNjNzA5MDY2YjgyMWZmMTI0NWQwNjgzNjgzNDljZjgxZTJlZThlM2E0MTI0Zjc3YTJlMDdkNzkzYjY3OTNjZjUiLCJyIjoie1wiYWN0b3JcIjp7XCJpZFwiOlwiZzYtcGVyc29uXCIsXCJraW5kXCI6XCJodW1hblwifSxcImtpbmRcIjpcImhvc3RcIn0iLCJ1IjoxMDcsImwiOjEsImkiOjU4fQ）2241 字；缺的段：无
- accepted（K2-P2）：pass。摘要后第一次请求 56510fd2-d77f-4cb1-a415-371050a2522d：usage reported（那一轮之后 closed，close invalid_answer，另记）
- cache-after（K2-P2）：pass。摘要后第一次请求 56510fd2-d77f-4cb1-a415-371050a2522d：输入 36131，缓存命中 27264（只量，不承诺）
- 秘书线 5 轮；压缩记录 compacted/summary, compacted/summary, compacted/summary；触发 0.02、目标 0.01

### C-216：fail

- observed-start（C-216）：pass。采用的架构模块路径：src/report.js, src/store.js, test/store.test.js
- adopted-done（C-216）：fail。the platform did not do it: timed out after 90 min waiting for goal-confirm:goal.confirmDraft:c33039809d7355553144c050cb30cced6f1be46d23831476531bbcb62f3fc452 to reach COMPLETED/FAILED/CANCELLED/ACCEPTED_PARTIAL
- stopped: not-run: timed out after 90 min waiting for goal-confirm:goal.confirmDraft:c33039809d7355553144c050cb30cced6f1be46d23831476531bbcb62f3fc452 to reach COMPLETED/FAILED/CANCELLED/ACCEPTED_PARTIAL
- goal-confirm:goal.confirmDraft:c33039809d7355553144c050cb30cced6f1be46d23831476531bbcb62f3fc452 (NEEDS_DECISION): pause because C-216 ended: committed

### C-221：fail

- first-plan（C-221）：pass。首案采用 initial-plan-8bbd3d8633b0715e4f468a84b4c80180
- fail-rework（C-221）：fail。the platform did not do it: timed out after 90 min waiting for goal-confirm:goal.confirmDraft:afe093831c5ad78717e7be5a4c8ee9397a2353f6eb9ae7dc4faeee3a15dcbae4 to reach COMPLETED/FAILED/CANCELLED/ACCEPTED_PARTIAL
- delivered（C-221）：uncovered (not-run)。stopped before this check: timed out after 90 min waiting for goal-confirm:goal.confirmDraft:afe093831c5ad78717e7be5a4c8ee9397a2353f6eb9ae7dc4faeee3a15dcbae4 to reach COMPLETED/FAILED/CANCELLED/ACCEPTED_PARTIAL
- stopped: not-run: timed out after 90 min waiting for goal-confirm:goal.confirmDraft:afe093831c5ad78717e7be5a4c8ee9397a2353f6eb9ae7dc4faeee3a15dcbae4 to reach COMPLETED/FAILED/CANCELLED/ACCEPTED_PARTIAL
- goal-confirm:goal.confirmDraft:afe093831c5ad78717e7be5a4c8ee9397a2353f6eb9ae7dc4faeee3a15dcbae4 (RUNNING): pause because C-221 ended: committed

### C-222：pass

- created（C-222）：pass。secretaryCreated 的线：session-0c9e94fbbd3a3994f5060af0e9b1ba0586af1152bad6ba4eb8fc44eda23ee84e
- started（C-222）：pass。建出的线上 Run：18a1de6a-4be6-4ccd-8d22-1f27084c6c1b/completed, c237f729-e1f4-4473-b8a0-d9da8ed9730f/completed, e9bf335b-35ce-43d7-a254-981e37f98f23/completed；Goal COMPLETED；null

### B06：fail

- W1a（B06-W1a）：fail。the platform did not do it: timed out after 60 min waiting for goal-confirm:goal.confirmDraft:ad1ffea8258ebdb3f0217608745fdeaecc4402d09f7f62b57a545bff5669d09b to reach COMPLETED/FAILED/CANCELLED/ACCEPTED_PARTIAL
- W2（B06-W2）：uncovered (not-run)。stopped before this check: timed out after 60 min waiting for goal-confirm:goal.confirmDraft:ad1ffea8258ebdb3f0217608745fdeaecc4402d09f7f62b57a545bff5669d09b to reach COMPLETED/FAILED/CANCELLED/ACCEPTED_PARTIAL
- W3（B06-W3）：uncovered (not-run)。stopped before this check: timed out after 60 min waiting for goal-confirm:goal.confirmDraft:ad1ffea8258ebdb3f0217608745fdeaecc4402d09f7f62b57a545bff5669d09b to reach COMPLETED/FAILED/CANCELLED/ACCEPTED_PARTIAL
- W5（B06-W5）：uncovered (not-run)。stopped before this check: timed out after 60 min waiting for goal-confirm:goal.confirmDraft:ad1ffea8258ebdb3f0217608745fdeaecc4402d09f7f62b57a545bff5669d09b to reach COMPLETED/FAILED/CANCELLED/ACCEPTED_PARTIAL
- W10（B06-W10）：uncovered (not-run)。stopped before this check: timed out after 60 min waiting for goal-confirm:goal.confirmDraft:ad1ffea8258ebdb3f0217608745fdeaecc4402d09f7f62b57a545bff5669d09b to reach COMPLETED/FAILED/CANCELLED/ACCEPTED_PARTIAL
- W12（B06-W12）：uncovered (not-run)。stopped before this check: timed out after 60 min waiting for goal-confirm:goal.confirmDraft:ad1ffea8258ebdb3f0217608745fdeaecc4402d09f7f62b57a545bff5669d09b to reach COMPLETED/FAILED/CANCELLED/ACCEPTED_PARTIAL
- explore（B06-cond3）：uncovered (not-run)。stopped before this check: timed out after 60 min waiting for goal-confirm:goal.confirmDraft:ad1ffea8258ebdb3f0217608745fdeaecc4402d09f7f62b57a545bff5669d09b to reach COMPLETED/FAILED/CANCELLED/ACCEPTED_PARTIAL
- stopped: not-run: timed out after 60 min waiting for goal-confirm:goal.confirmDraft:ad1ffea8258ebdb3f0217608745fdeaecc4402d09f7f62b57a545bff5669d09b to reach COMPLETED/FAILED/CANCELLED/ACCEPTED_PARTIAL
- goal-confirm:goal.confirmDraft:ad1ffea8258ebdb3f0217608745fdeaecc4402d09f7f62b57a545bff5669d09b (RUNNING): pause because B06 ended: committed

## 预算

- 上限：总量 400000000，每个场景/格 50000000（acceptance.config.json `tokenCaps`）。
- 口径：用量 = inputTokens + outputTokens（Kernel 的 inputTokens 已含缓存命中，cachedInputTokens 另记、不再相加）；每条按它所在项目的归属场景/格计，不按读到的时间。
- 合计：用量 48958990（输入 48570304，输出 388686；缓存命中 43789824）；Query 请求 382 次（含 Query 的压缩摘要请求，公开记录分不出）；结束的 Work Run 27 个，其中 0 个是公开证明的零（没进入 Kernel）；未知或不完整的用量不算零：已关闭 Query 里用量未知的请求按预留上限（输入预留 + 输出预留）计，只会多算；Work Run 的用量未知或不完整、或请求的预留读不到时，计量停下。
- 已知缺口：Work Run 的压缩摘要请求在另一个 Kernel Session 里跑，不在 `activity/runs` 里，计量少算了它们；驱动不读数据库补数（lead 裁定 11-14 #3）。400M/50M 上限远高于预期用量，这是记下的缺口，不是阻断。
- 最后一次完整读数时在途：Query 0，Work Run 0（Work Run 的用量要等 Run 结束才在 `activity/runs` 出现，所以超限后的停止点是第一次能看到超出的读数）。
- A1：用量 29677（输入 29537，输出 140，缓存命中 25856；Query 请求 2（其中按未计费 0 计的 1：provider 拒收，或驱动自己取消截断的请求；按预留上限计的 0：Query 已关闭、用量未知），结束的 Run 0）
- B1：用量 16302（输入 16200，输出 102，缓存命中 12800；Query 请求 2（其中按未计费 0 计的 1：provider 拒收，或驱动自己取消截断的请求；按预留上限计的 0：Query 已关闭、用量未知），结束的 Run 0）
- E05：用量 3695010（输入 3654582，输出 40428，缓存命中 3307136；Query 请求 33（其中按未计费 0 计的 0：provider 拒收，或驱动自己取消截断的请求；按预留上限计的 0：Query 已关闭、用量未知），结束的 Run 4）
- E06：用量 0（输入 0，输出 0，缓存命中 0；Query 请求 0（其中按未计费 0 计的 0：provider 拒收，或驱动自己取消截断的请求；按预留上限计的 0：Query 已关闭、用量未知），结束的 Run 0）
- E08：用量 1168610（输入 1149257，输出 19353，缓存命中 962944；Query 请求 21（其中按未计费 0 计的 0：provider 拒收，或驱动自己取消截断的请求；按预留上限计的 0：Query 已关闭、用量未知），结束的 Run 1）
- E09：用量 8527074（输入 8481308，输出 45766，缓存命中 8023040；Query 请求 27（其中按未计费 0 计的 0：provider 拒收，或驱动自己取消截断的请求；按预留上限计的 0：Query 已关闭、用量未知），结束的 Run 9）
- E12：用量 5064248（输入 5015088，输出 49160，缓存命中 4382336；Query 请求 52（其中按未计费 0 计的 0：provider 拒收，或驱动自己取消截断的请求；按预留上限计的 0：Query 已关闭、用量未知），结束的 Run 2）
- iteration：用量 1657645（输入 1640039，输出 17606，缓存命中 1459328；Query 请求 32（其中按未计费 0 计的 0：provider 拒收，或驱动自己取消截断的请求；按预留上限计的 0：Query 已关闭、用量未知），结束的 Run 1）
- intervention：用量 454036（输入 448294，输出 5742，缓存命中 350976；Query 请求 8（其中按未计费 0 计的 0：provider 拒收，或驱动自己取消截断的请求；按预留上限计的 0：Query 已关闭、用量未知），结束的 Run 1）
- waiting：用量 3119748（输入 3089476，输出 30272，缓存命中 2683776；Query 请求 42（其中按未计费 0 计的 0：provider 拒收，或驱动自己取消截断的请求；按预留上限计的 0：Query 已关闭、用量未知），结束的 Run 2）
- C-216：用量 1147356（输入 1134066，输出 13290，缓存命中 1012608；Query 请求 12（其中按未计费 0 计的 0：provider 拒收，或驱动自己取消截断的请求；按预留上限计的 0：Query 已关闭、用量未知），结束的 Run 2）
- C-221：用量 564113（输入 554628，输出 9485，缓存命中 447744；Query 请求 9（其中按未计费 0 计的 0：provider 拒收，或驱动自己取消截断的请求；按预留上限计的 0：Query 已关闭、用量未知），结束的 Run 1）
- C-222：用量 22315897（输入 22178778，输出 137119，缓存命中 20147072；Query 请求 112（其中按未计费 0 计的 0：provider 拒收，或驱动自己取消截断的请求；按预留上限计的 0：Query 已关闭、用量未知），结束的 Run 3）
- B06：用量 425152（输入 419610，输出 5542，缓存命中 320384；Query 请求 9（其中按未计费 0 计的 0：provider 拒收，或驱动自己取消截断的请求；按预留上限计的 0：Query 已关闭、用量未知），结束的 Run 1）
- compaction：用量 774122（输入 759441，输出 14681，缓存命中 653824；Query 请求 21（其中按未计费 0 计的 0：provider 拒收，或驱动自己取消截断的请求；按预留上限计的 0：Query 已关闭、用量未知），结束的 Run 0）

## 延迟探针

- wa#0：{"startedAt":"2026-11-15T15:25:38.638Z","writtenAt":"2026-11-15T15:30:46.113Z","samples":15178,"p50Ms":20.51,"p95Ms":20.71,"p99Ms":21.15,"maxMs":286.26,"meanMs":20.62}；关闭 SIGINT, exit 0 after 36 ms
- wb#0：{"startedAt":"2026-11-15T15:30:46.161Z","writtenAt":"2026-11-15T15:36:52.655Z","samples":18113,"p50Ms":20.53,"p95Ms":20.69,"p99Ms":20.86,"maxMs":240.12,"meanMs":20.58}；关闭 SIGINT, exit 0 after 25 ms
- w-accept#0：{"startedAt":"2026-11-15T15:36:52.717Z","writtenAt":"2026-11-15T19:16:19.701Z","samples":652618,"p50Ms":20.61,"p95Ms":20.89,"p99Ms":21.5,"maxMs":693.11,"meanMs":20.69}；关闭 SIGINT, exit 0 after 168 ms
- w-accept#1：{"startedAt":"2026-11-15T19:16:19.756Z","writtenAt":"2026-11-16T02:28:23.825Z","samples":1289415,"p50Ms":20.99,"p95Ms":21.48,"p99Ms":21.76,"maxMs":3554.67,"meanMs":21.07}；关闭 SIGINT, exit 0 after 317 ms
- compaction#0：{"startedAt":"2026-11-16T02:28:23.876Z","writtenAt":"2026-11-16T02:31:56.165Z","samples":10507,"p50Ms":21.23,"p95Ms":21.66,"p99Ms":22.45,"maxMs":374.6,"meanMs":21.48}；关闭 SIGINT, exit 0 after 44 ms

## 其它记录

- 2026-11-15T15:30:46.050Z A1: g6-a1-mwhzl3f6-4 (BLOCKED): pause because wa closes: committed
- 2026-11-15T15:30:46.067Z A1: A1: request 8e5a8013-1967-484d-9c85-6a276b0acdeb counted as unbilled 0 (cut by the driver's cancel; usage not reported, at most one request)
- 2026-11-15T15:36:52.608Z B1: g6-b1-mwhzrof2-15 (BLOCKED): pause because wb closes: committed
- 2026-11-15T15:36:52.622Z B1: B1: request 480a5b7f-8037-4d5e-a673-39b433e25dbc counted as unbilled 0 (cut by the driver's cancel; usage not reported, at most one request)
- 2026-11-16T02:31:56.177Z -: §6.2：Query 在“进入中”被中止由 qent 关成 not_entered（aborted_before_entry）；`queries/cancel` 在 entering 窗口仍回 not_running，本次不测、不判场景失败。
