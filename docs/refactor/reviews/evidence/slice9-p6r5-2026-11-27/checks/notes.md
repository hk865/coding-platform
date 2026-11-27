# G6 notes 2026-11-27（运行号 g6-2026-11-27-a48b8779）

## 逐场景判据

### E05：fail

- C 行：C-182, C-183, C-185, C-71, C-73, C-191, C-208, C-217, C-218；自治档 `after_plan_confirmation`；provider `deepseek` / `deepseek-v4.1-flash`。
- 用量：输入 5383149（含缓存命中），输出 32391，缓存命中 4749056，Query 请求 72。

| 判据 | C 行 | 结果 | 说明 |
|---|---|---|---|
| overlap | C-182, C-183, C-217 | uncovered (entry-missing) | 没有同模块门拦住后领的任务，缺“实际可领取的时段”（开工前 claimableNow：t-users null，t-orders null）：有并行机会却串行无法定案 |
| gate | C-185 | pass | 门：module entities，等待 t-orders，在跑 t-users/833eec6d-c276-47f4-8de0-2582a0285b80；人放行成功 0 道，被拒 0 道 |
| paths | C-185, C-217 | pass | files/compare 给出：.workbench/notes/636712b7a2be7f529844cf2c5eca2f9d/2b7e336e-8f28-48f0-a5f1-05046b05bd54.md, .workbench/notes/636712b7a2be7f529844cf2c5eca2f9d/898cc4cd-2e5a-4b83-9095-8d0105715882.md, .workbench/notes/636712b7a2be7f529844cf2c5eca2f9d/bf643808-733b-4ed9-a9b3-c17b410c4e96.md, .workbench/notes/636712b7a2be7f529844cf2c5eca2f9d/da594797-fc0e-4a71-9624-ccb13920e495.md, src/legacy/contact-check.js, src/legacy/is-email.js, src/legacy/path-join.js, src/orders.js, src/rules.js, src/users.js, test/orders.test.js, test/users.test.js |
| kept | C-185 | pass | t-users satisfied，t-orders satisfied |
| single-occupancy | C-71 | pass | 2 个 Run，没有同 Session 时间重叠 |
| convention | C-208 | pass | rules.js 定义 isEmail：true；users/orders 都从 rules 引用 |
| duplicates | C-208 | fail | 成功的 project_source（duplicates:true）结果 0 个，候选 0 条，没有一条的两处路径正好是 src/legacy/contact-check.js ↔ src/legacy/path-join.js |
| reviewer | C-208, C-218 | pass | 轮 {"aggregateType":"VerificationRound","projectId":"b4041cfd9b11f2a73fe5dd2e0d7f1dde","workspaceId":"636712b7a2be7f529844cf2c5eca2f9d","goalId":"g6-e05-mwyc3xfv-28","taskId":"t-users","runId":"833eec6d-c276-47f4-8de0-2582a0285b80","roundId":"367c8e20-92b3-47c7-9c78-05169cbae092"} 的正式审阅 Evidence f055bdcb-edc1-4383-ac14-575fd0c79a0a：PASS；审阅要求状态 pass |
| name-different | C-208 | pass | 正式审阅答复说 contact-check.js / looksLikeMailAddress 是同一条规则：「- `src/legacy/contact-check.js` 的 `looksLikeMailAddress`（`/^[^@\s]+@[^@\s]+\.[^@\s]+$/`）：这是长得像、字符类写法不同但判定等价的一份（我实测 10 个样本 `a@b.co`、`ada@example`、`a@@b.co`、`a @b.co`、`.@.`、`x@y.z`、`""`、`ü@ö.ü`、`a.b@c.d`、`a@b.c@d.e` 两份判定完全一致）」 「- `git cat-file -e 6e8c608:src/legacy/contact-check.js` 报「exists on disk, but not in '6e8c608'」」 |
| name-same | C-208 | pass | 正式审阅答复说 is-email.js 不是同一条规则：「- 名字相同但规则不同的 `src/legacy/is-email.js`（只判 `typeof string && length<=254`）：按任务书「名字相同但规则不同的不算」，不作为重复定义」 |
| temporary | C-208 | uncovered (not-run) | 工作记录里没有计划外的临时件（写入 5 处），收回这一格没有对象 |
| line-choice | C-73, C-191 | uncovered (not-run) | 运行中读到的派工依据 0 个，没有一个选中了线（rank 都是 none 或没读到）；候选线清单本来不另存（MVP-BEHAVIOR.md:350） |

- 人采用了候选 plan-proposal-8d0012e4ea6a739dd2b58d24ed6282b0（版本 1）。
- driver-start t-users: ready running
- driver-start t-orders: ready running
- driver-start goal: ready running
- planted src/legacy/contact-check.js: ready
- planted src/legacy/path-join.js: ready
- planted src/legacy/is-email.js: ready
- E05 Goal ended COMPLETED
- E05 证据：检查轮读口完整；工作记录写入 5 处；待答/待落实卡 无；返工记录 t-users:0, t-orders:0, gate:0

### E06：fail

- C 行：C-75, C-135, C-106, C-194, C-149, C-151, C-68, C-181, C-209, C-219, C-223；自治档 `after_plan_confirmation`；provider `deepseek` / `deepseek-v4.1-flash`。
- 用量：输入 894609（含缓存命中），输出 9134，缓存命中 768256，Query 请求 4。

| 判据 | C 行 | 结果 | 说明 |
|---|---|---|---|
| handoff | C-219 | pass | 前任 session-bf5790022e9ca30f68019cb57eecde7af40cf71b3d455910b4478151ba4f8cb5 → 接任 session-e66971a26c7e4900f3b41a32098995e14d277204c948caba05f3e7fab89121db（批准的交接卡 0 张） |
| successor-input | C-75, C-209, C-219 | fail | 接任者 turn 输入（0 轮）含目标词 254/isEmail：false；含 hand_off 理由原文「用户明确要求把本线手上的工作交给另一位成员接手：这条线已经做了很久（含一次 Host 重启中断后的接续），换一个新上下文继续。现状：t-limit 的实现与测试已落地并通过 node --test（10 pass/0 fail，退出码 0）；src/rules.js 仍只有一个 export function isEmail、一条正则、254 字面量只出现一处；test/users.test.js 与 test/orders.test.js 各含 254/255/256 边界用例；src/legacy/ 未被修改也未被引用。接手方需复核这三个文件、确认 git status --short（M src/orders.js、src/users.js、src/rules.js，?? src/legacy/、?? test/）符合阶段范围，并完成阶段 gate 汇报。详见目标锚点理解注记 8e44d960-521e-4cd6-bece-0c8500f6abff 与 shared-rules 的重复实现 pitfall 注记。」：false |
| successor-frontier | C-75 | uncovered (entry-missing) | 前任的义务/前沿没有一份可逐字比对的公开原文（hand_off 只给 reason 和 understanding 注记引用），不判通过 |
| no-restatement | C-209 | pass | 驱动在换手批准之后没有再给这条线发任何消息（http.jsonl 可核） |
| excluded-path | C-209 | fail | 接任者 turn 输入提到 src/legacy：false；成功写过它的 Run：无 |
| same-task-new-run | C-135 | fail | Task t-limit：2 个 Run；接续说明 无 |
| history-continuity | C-106, C-194 | fail | 前任最后的最终答复开头「交接请求已提交，回执为 accepted（“接手会在批准后按阶段进行”）。交接已」在接任者 turn 输入里：false |
| restart-running | C-149 | pass | 重启前 Run 54fdb655-2abf-4524-a94a-361245b4621d → crashed；继续的 Run 39c1eab7-0267-4074-a1e6-81798671d44d 在 session-bf5790022e9ca30f68019cb57eecde7af40cf71b3d455910b4478151ba4f8cb5（原 session-bf5790022e9ca30f68019cb57eecde7af40cf71b3d455910b4478151ba4f8cb5） |
| restart-paused | C-151 | fail | the platform did not do it: stalled: no change for 32 min, nothing in flight (last seen: goal phase RUNNING, cause none; driver unread, wait reason none) |
| archive | C-219 | uncovered (not-run) | 目标没有完成（没等到），前任线上可能还有未完成任务，不归档 |
| hand-or-drop | C-223 | uncovered (not-run) | 目标没有完成，没有归档 |
| wake | C-68, C-181 | fail | 交接（批准的卡 0 张）之后接任线上有 Run：后继真的启动 |

- goal-confirm:goal.confirmDraft:529fc155ed3b8ed8c3d14683f875fb39e60ca2c2a7f9b16389d59bd91dfd3f77: the person selected idea 1 of 3 (A 最小改动：rules 加 254 + 两个超长测试)
- driver-start goal-confirm:goal.confirmDraft:529fc155ed3b8ed8c3d14683f875fb39e60ca2c2a7f9b16389d59bd91dfd3f77: rejected busy
- restart (Work Run running): SIGINT, exit 0 after 4642 ms
- resumeOnStartup = ask
- after restart: NEEDS_DECISION/GOAL-30 causes [{"code":"interrupted_pending_resume","source":"host_restart","interruption":{"ref":{"aggregateType":"GoalInterruption","projectId":"b4041cfd9b11f2a73fe5dd2e0d7f1dde","goalId":"goal-confirm:goal.confirmDraft:529fc155ed3b8ed8c3d14683f875fb39e60ca2c2a7f9b16389d59bd91dfd3f77"},"revision":1},"close":"clean","detectedAt":"2026-11-27T02:08:34.852Z","taskIds":["t-limit","g-stage","g-goal"],"runRefs":[{"aggregateType":"Run","projectId":"b4041cfd9b11f2a73fe5dd2e0d7f1dde","goalId":"goal-confirm:goal.confirmDraft:529fc155ed3b8ed8c3d14683f875fb39e60ca2c2a7f9b16389d59bd91dfd3f77","runId":"54fdb655-2abf-4524-a94a-361245b4621d"}]},{"code":"auto_rework_pending","taskId":"t-limit","operation":"requeue","failureClass":"interrupted"}]
- 换手请求发给 session-bf5790022e9ca30f68019cb57eecde7af40cf71b3d455910b4478151ba4f8cb5（在跑 Run 39c1eab7-0267-4074-a1e6-81798671d44d）：messages/send: committed (sendStatus sent)
- pause: committed 
- restart (Goal paused): SIGINT, exit 0 after 37 ms
- resumeOnStartup = ask
- restart-paused: later read fail: 重启后 PAUSED/GOAL-20；恢复 committed；最后 没等到完成（原因见 fail 的那条）；已知缺口 STATUS.md:89：暂停的目标跨过重启后被恢复，目标循环不会自己重新起来（P2 之前就有）；驱动不替人再按推进（P6 裁定 Q13）
- goal-confirm:goal.confirmDraft:529fc155ed3b8ed8c3d14683f875fb39e60ca2c2a7f9b16389d59bd91dfd3f77 (RUNNING): pause because E06 ended: committed

### E08：fail

- C 行：C-47, C-62, C-63, C-133a, C-126, C-46, C-52, C-116, C-118, C-210；自治档 `every_step`；provider `deepseek` / `deepseek-v4.1-flash`。
- 用量：输入 5609193（含缓存命中），输出 51559，缓存命中 4912640，Query 请求 46。

| 判据 | C 行 | 结果 | 说明 |
|---|---|---|---|
| autonomy-born | C-133a | pass | 草稿自治 every_step；Goal 生在版本 1，采用后读到 every_step |
| confirm-only-latest | C-47 | pass | 同一草稿换 commandId 再确认：rejected revision_conflict |
| person-adopts | C-46, C-52 | pass | 人确认之前 goals/list 里没有这个 Goal（0 个旧 Goal）；首方案由人 initialization/adopt |
| first-adoption | C-63, C-62 | pass | 采用回执 plan initial-plan-04310a5def6c51c49f7a9b5f0621f13b；Goal 指针 {"aggregateType":"PlanRevision","projectId":"0c17c6714550f694f32d8698a365fe00","planId":"initial-plan-04310a5def6c51c49f7a9b5f0621f13b"} |
| hold-before-adopt | C-210 | uncovered (not-run) | sub 在提交改需求前 0.084 s 被领（提交时至少已有 1 个 Run） |
| versions | C-210 | pass | plans/versions 2 版；改目标的候选由人 plans/apply（committed，采用 {"aggregateType":"PlanRevision","projectId":"0c17c6714550f694f32d8698a365fe00","planId":"initial-plan-4214af3cde609d0519452a964a705f58"}） |
| switch | C-210 | pass | div t3；sub cancelled；mul active；记录 cancelled；接替 无；版本 initial-plan-4214af3cde609d0519452a964a705f58；采用者 human |
| old-evidence | C-210 | fail | div Run 2145023d-0ba9-4682-aa15-ea2b8246844a；检查轮计划 initial-plan-4214af3cde609d0519452a964a705f58；采用 initial-plan-4214af3cde609d0519452a964a705f58；o1/r1:fail；o1/r2:pass；o4/r7:fail；o4/r8:pass |
| required-cancel | C-210 | uncovered (not-run) | stopped before this check: stalled: no change for 32 min, nothing in flight (last seen: goal phase RUNNING, cause none; driver waiting_for_reply, wait reason automation_confirmation_required:system_requeue; plan_candidate_waiting: no_review_line) |
| autonomy-later | C-126 | uncovered (not-run) | 草稿本来就是 every_step，这次没有中途改档 |
| control-pins | C-116, C-118 | pass | 只钉 Goal 的暂停：rejected invalid |

- first plan initial-plan-04310a5def6c51c49f7a9b5f0621f13b: sub = t1，mul = t2
- 提交前最近一次轮询：mul 0 个 Run（-），sub 1 个 Run；sub 的 dispatch.claimableNow null
- E08 改需求的轮：?:request/ideas 3
- the person selected idea 1 of 3 on the change: 方案 A：sub 整体换成 div，mul 照旧（推荐，与你原话一致）
- while the change candidate was written the person answered action_release card {"kind":"action_release","requestRef":{"aggregateType":"ActionRequest","goalId":"goal-confirm:goal.confirmDraft:594532a0fae03c91ad1c5fedf51acbccb25906d292f9421176d75ed2bb29e2d9","projectId":"0c17c6714550f694f32d8698a365fe00","requestId":"action_request.stop:1b1327072eebc182812126de566ade8fd52f1e68c0dc6ccdb1094af991601abd","taskId":"t1"},"revision":1}
- while the change candidate was written the person answered member_creation card {"kind":"member_creation","operationRef":{"aggregateType":"CoreOperation","operationId":"member-eca7bb73855bdd5a78e0fb1927c33fbef678c0f31a4123ba564157926c1e477e","projectId":"0c17c6714550f694f32d8698a365fe00"}}
- E08 采用 initial-plan-4214af3cde609d0519452a964a705f58：任务 t1:cancelled, t2:active, g1:superseded, g0:superseded, t3:active, g1b:active, g0b:active；处置记录 3 条
- requeue card t3 (after Run de006d20-810d-4772-9a5c-0626fd7fa1bf): committed
- requeue card t2 (after Run 66d866a5-5889-4d70-a7b3-8d43e448163d): committed
- requeue card t3 (after Run f9cd00b5-4bba-4726-a8a9-f52fbfd81f7c): committed
- requeue card t2 (after Run 217f3f7c-59e7-4146-ba63-d55367f70dd2): committed refused {"ref":{"aggregateType":"TaskReworkRefusal","projectId":"0c17c6714550f694f32d8698a365fe00","goalId":"goal-confirm:goal.confirmDraft:594532a0fae03c91ad1c5fedf51acbccb25906d292f9421176d75ed2bb29e2d9","taskId":"t2","operation":"requeue","subjectId":"217f3f7c-59e7-4146-ba63-d55367f70dd2"},"revision":1,"schemaVersion":1,"task":{"projectId":"0c17c6714550f694f32d8698a365fe00","goalId":"goal-confirm:goal.confirmDraft:594532a0fae03c91ad1c5fedf51acbccb25906d292f9421176d75ed2bb29e2d9","taskId":"t2"},"afterRunRef":{"aggregateType":"Run","projectId":"0c17c6714550f694f32d8698a365fe00","goalId":"goal-confirm:goal.confirmDraft:594532a0fae03c91ad1c5fedf51acbccb25906d292f9421176d75ed2bb29e2d9","runId":"217f3f7c-59e7-4146-ba63-d55367f70dd2"},"subjectRoundRef":{"aggregateType":"VerificationRound","projectId":"0c17c6714550f694f32d8698a365fe00","workspaceId":"d8a31a2e7a2bf86901350bc71a726cc8","goalId":"goal-confirm:goal.confirmDraft:594532a0fae03c91ad1c5fedf51acbccb25906d292f9421176d75ed2bb29e2d9","taskId":"t2","runId":"217f3f7c-59e7-4146-ba63-d55367f70dd2","roundId":"b6d17f35-63a7-4bf7-a740-d472c7745cf9"},"failureClass":"check_failed","code":"no_new_basis","reason":"no new basis: same failure, source, plan as TaskRequeue 66d866a5-5889-4d70-a7b3-8d43e448163d; supply new input or change the method","basisDigest":"0f2917d158e99e2c7cc8b66bf47f87f3e3ef34e617486eae425d6ce8f539b7cc","source":{"workspaceRevision":1,"sourceDigest":"017bae83640e8979a9fcf428c3fd9089c96b614e51fcbdadb912bbc5c33608be"},"matchedRequeueRef":{"aggregateType":"TaskRequeue","projectId":"0c17c6714550f694f32d8698a365fe00","goalId":"goal-confirm:goal.confirmDraft:594532a0fae03c91ad1c5fedf51acbccb25906d292f9421176d75ed2bb29e2d9","taskId":"t2","afterRunId":"66d866a5-5889-4d70-a7b3-8d43e448163d"},"requestedBy":{"kind":"human","id":"g6-person"},"refusedAt":"2026-11-27T02:49:18.534Z","goalEndedRunsAtRefusal":5,"configurationRevision":null}
- requeue card t3 (after Run 2145023d-0ba9-4682-aa15-ea2b8246844a): committed refused {"ref":{"aggregateType":"TaskReworkRefusal","projectId":"0c17c6714550f694f32d8698a365fe00","goalId":"goal-confirm:goal.confirmDraft:594532a0fae03c91ad1c5fedf51acbccb25906d292f9421176d75ed2bb29e2d9","taskId":"t3","operation":"requeue","subjectId":"2145023d-0ba9-4682-aa15-ea2b8246844a"},"revision":1,"schemaVersion":1,"task":{"projectId":"0c17c6714550f694f32d8698a365fe00","goalId":"goal-confirm:goal.confirmDraft:594532a0fae03c91ad1c5fedf51acbccb25906d292f9421176d75ed2bb29e2d9","taskId":"t3"},"afterRunRef":{"aggregateType":"Run","projectId":"0c17c6714550f694f32d8698a365fe00","goalId":"goal-confirm:goal.confirmDraft:594532a0fae03c91ad1c5fedf51acbccb25906d292f9421176d75ed2bb29e2d9","runId":"2145023d-0ba9-4682-aa15-ea2b8246844a"},"subjectRoundRef":{"aggregateType":"VerificationRound","projectId":"0c17c6714550f694f32d8698a365fe00","workspaceId":"d8a31a2e7a2bf86901350bc71a726cc8","goalId":"goal-confirm:goal.confirmDraft:594532a0fae03c91ad1c5fedf51acbccb25906d292f9421176d75ed2bb29e2d9","taskId":"t3","runId":"2145023d-0ba9-4682-aa15-ea2b8246844a","roundId":"7385b407-53f4-4889-826d-ae696706b676"},"failureClass":"check_failed","code":"no_new_basis","reason":"no new basis: same failure, source, plan as TaskRequeue f9cd00b5-4bba-4726-a8a9-f52fbfd81f7c; supply new input or change the method","basisDigest":"71da5fb4990ab3af9d33c98ac66fae733f4fb6d06a7ef24e4248585537a96c7b","source":{"workspaceRevision":1,"sourceDigest":"017bae83640e8979a9fcf428c3fd9089c96b614e51fcbdadb912bbc5c33608be"},"matchedRequeueRef":{"aggregateType":"TaskRequeue","projectId":"0c17c6714550f694f32d8698a365fe00","goalId":"goal-confirm:goal.confirmDraft:594532a0fae03c91ad1c5fedf51acbccb25906d292f9421176d75ed2bb29e2d9","taskId":"t3","afterRunId":"f9cd00b5-4bba-4726-a8a9-f52fbfd81f7c"},"requestedBy":{"kind":"human","id":"g6-person"},"refusedAt":"2026-11-27T02:50:15.230Z","goalEndedRunsAtRefusal":6,"configurationRevision":null}
- stopped: not-run: stalled: no change for 32 min, nothing in flight (last seen: goal phase RUNNING, cause none; driver waiting_for_reply, wait reason automation_confirmation_required:system_requeue; plan_candidate_waiting: no_review_line)
- goal-confirm:goal.confirmDraft:594532a0fae03c91ad1c5fedf51acbccb25906d292f9421176d75ed2bb29e2d9 (RUNNING): pause because E08 ended: committed

### E09：uncovered

- C 行：C-185, C-89, C-65, C-98, C-93, C-95, C-99, C-55, C-62, C-211, C-212, C-218；自治档 `after_plan_confirmation`；provider `deepseek` / `deepseek-v4.1-flash`。
- 用量：输入 2762006（含缓存命中），输出 26557，缓存命中 2481152，Query 请求 17。

| 判据 | C 行 | 结果 | 说明 |
|---|---|---|---|
| executor-reports | C-185, C-211 | pass | 执行者上报 session-message-72698f8b43ed4127157fed2e454f9d1f7bd0c105704c46b37125d91dbfd38287（要回复的 send_session_message）：发件线 session-4cff9889ab87bdda8deb4d51aca73139d8eac3eb8ee45947f333e34e6d19eae4（work_run）→ 收件线 session-007f22c1f4c68f02266183ceafbfe8ddb0064adacd8485a20d93db452a2a7ab5（参谋），needsReply true，answeredBy line；还没有答复；参数 {"needsReply":true,"recipient":{"projectId":"2daa3a4267a2ef2cb6a6cee56821a80c","sessionId":"session-007f22c1f4c68f02266183ceafbfe8ddb0064adacd8485a20d93db452a2a7ab5"},"taskRef":{"goalId":"goal-confirm:goal.confirmDraft:f5e95bdd61b8a217ac01ce04113038ec0b759c806ef85dfc0dbb83a23934849c","projectId":"2daa3a4267a2ef2cb6a6cee56821a80c","taskId":"task-a-parse-date"},"text":"A（task-a-parse-date）执行完毕，接口冲突按任务书上报，请转人决定：parseDate 到底返回 Date 还是 {y,m,d}。\n\n【已完成、证据】\n- src/api.js 导出 `export function parseDate(text)`：`new Date(text)` 有效则返回该 Date 实例；`Number.isNaN(getTime())` 抛 RangeError；非字符串抛 TypeError。日期文本原样交给 Date，无自定义格式规则（\"2024-03-05\" 按 UTC 解析）。\n- 新建 test/api.test.js，3 条用例：DateTime 实例与 UTC 年月日、非法文本→RangeError、非字符串→TypeError。\n- 仓库根 `node --test`：6 test / 6 pass / 0 fail，exit=0（含 B 的 test/report.test.js）。`node --check` 两个源文件均通过。\n- 我只改了 src/api.js 并新建 test/api.test.js；src/report.js 未由我改动（git status 显示它也变了，是 B 的线改的）。\n- 已在 api 模块锚点记 pitfall「parseDate 返回值约定」（noteId d2728410-118c-42a7-b57e-a04bf018bab2）。\n\n【冲突对象】\n- 函数：src/api.js 的 `parseDate(text)`，返回约定 = Date 实例（A 任务书与 api 模块接口描述均如此）。\n- 要求方：task-b-month-of 的指派说明写明“你需要 parseDate 返回 {y,m,d}”，用户层 = src/report.js 的 `monthOf`。\n- 同一锚点上你已有 open_question「接口约定」记了这条（noteId 7e352df2-26d1-42d6-b7e9-812537404657，当前因两文件改动为 stale）；我这份是现行实现的事实补充，未重复结论，等你以 decision 收掉它。\n\n【影响】\n- 若定为 Date（现状）：monthOf 用 `parseDate(t).getUTCMonth()+1` 即可，B 实际已这样写并通过测试，无功能损失；风险是日期格式口径取决于 JS Date 实现，未做严格格式校验。\n- 若定为 {y,m,d}：monthOf 可直读字段；但代价是我这份 parseDate 与 api 模块接口描述都要改，且现有 test/api.test.js 的 Date 断言、test/report.test.js 约 2 处 `parseDate(text).getUTCMonth()` 要同步改，B 的 report.test.js 会立刻红。\n- 建议（不代替决定）：保持 parseDate 返回 Date，另加导出派生函数（如 `dateParts(text)` 返回 {y,m,d}）给需要字段的调用方。我没有实现它，等明确放行。\n\n【当前事实】此刻工作区里没有任何 {y,m,d} 实现，B 的 monthOf 已按 Date 返回工作，全绿。是否需要我为选定方案再动手，或把取舍写成 decision 覆盖那条 open_question，请指示；这对后续 Run 不阻塞（本任务自身验收已达成）。","wake":true} |
| adviser-explains | C-211 | pass | 收到上报 session-message-72698f8b43ed4127157fed2e454f9d1f7bd0c105704c46b37125d91dbfd38287 的参谋轮 1 个；最终答复或 ask_person/notify_person 正文同时点到 api.js 和 report.js 的：kturn-23f414d4051fa19f97ef8e1d2519201164f1ae94fd9a72fa2f6ef3e61351eee8 |
| person-decides | C-211, C-62 | pass | 2026-11-27T03:26:49.024Z 人答卡 {"kind":"message","messageRef":{"aggregateType":"SessionMessage","messageId":"session-message-264543c7320d4982e098843d02b1ffc51062b4b563e7935c3eedc72e0a8bbdeb","projectId":"2daa3a4267a2ef2cb6a6cee56821a80c","workspaceId":"b81dc08e9c24c08607099524e1f45ff7"}}（来源消息 session-message-264543c7320d4982e098843d02b1ffc51062b4b563e7935c3eedc72e0a8bbdeb，答复 committed）；钉住 Goal 版本 2，另有对象 1 个：[{"ref":{"aggregateType":"Goal","projectId":"2daa3a4267a2ef2cb6a6cee56821a80c","goalId":"goal-confirm:goal.confirmDraft:f5e95bdd61b8a217ac01ce04113038ec0b759c806ef85dfc0dbb83a23934849c"},"revision":2},{"ref":{"aggregateType":"PlanRevision","projectId":"2daa3a4267a2ef2cb6a6cee56821a80c","planId":"initial-plan-1ed76b0856cc53d6fafb74b5370525b1"},"revision":1}] |
| new-version | C-211, C-55 | uncovered (not-run) | 当前计划 initial-plan-1ed76b0856cc53d6fafb74b5370525b1 的取消/接替记录（0 条）里没有一条来自卡 {"kind":"message","messageRef":{"aggregateType":"SessionMessage","messageId":"session-message-264543c7320d4982e098843d02b1ffc51062b4b563e7935c3eedc72e0a8bbdeb","projectId":"2daa3a4267a2ef2cb6a6cee56821a80c","workspaceId":"b81dc08e9c24c08607099524e1f45ff7"}} 答复轮的候选（plans/proposal 的 sourceMessageRef = session-message-264543c7320d4982e098843d02b1ffc51062b4b563e7935c3eedc72e0a8bbdeb、sourcePart = decision_answer）：这次决定没有产生替换任务的新版本 |
| report-after-dispatch | C-185, C-211 | uncovered (not-run) | 同目标没有 agent 派活落实（任务卡 dispatch.request 没有 applied 的），这一支没走到 |
| diagnosis-reverify | C-211 | uncovered (not-run) | 2 个检查轮里没有一轮的重验以消息为依据（reverify.newInputRefs 没有 session_message），这一支没走到（可选） |
| formal-change | C-212 | pass | architecture/revise committed  ；目录版本 2 |
| drift | C-212, C-89 | pass | compare-formal 5 条 finding；带路径的：package.json, README.md, src/report.js, test/api.test.js, test/report.test.js |
| observation-after-adopt | C-65 | pass | 采用后观测 {"aggregateType":"ObservedArchitecture","projectId":"2daa3a4267a2ef2cb6a6cee56821a80c","workspaceId":"b81dc08e9c24c08607099524e1f45ff7","captureId":"67455b07-6125-4a1a-b98f-4670d6557015"} |
| observation-after-pass | C-98 | pass | 观测：采用后 {"aggregateType":"ObservedArchitecture","projectId":"2daa3a4267a2ef2cb6a6cee56821a80c","workspaceId":"b81dc08e9c24c08607099524e1f45ff7","captureId":"67455b07-6125-4a1a-b98f-4670d6557015"} → 现在 {"aggregateType":"ObservedArchitecture","projectId":"2daa3a4267a2ef2cb6a6cee56821a80c","workspaceId":"b81dc08e9c24c08607099524e1f45ff7","captureId":"45b419e9-bd77-45ca-adbf-871ba4ac2cbc"} |
| rounds | C-93, C-95, C-218 | pass | satisfied 任务的最新轮：task-a-parse-date PASS/gaps 0, task-b-month-of PASS/gaps 0 |
| uncovered-round | C-99 | uncovered (not-run) | 这次没有出现缺覆盖（INCONCLUSIVE）的检查轮 |

- E09 Goal ended COMPLETED
- E09 链：上报 session-message-72698f8b43ed4127157fed2e454f9d1f7bd0c105704c46b37125d91dbfd38287（send_session_message）参数 {"needsReply":true,"recipient":{"projectId":"2daa3a4267a2ef2cb6a6cee56821a80c","sessionId":"session-007f22c1f4c68f02266183ceafbfe8ddb0064adacd8485a20d93db452a2a7ab5"},"taskRef":{"goalId":"goal-confirm:goal.confirmDraft:f5e95bdd61b8a217ac01ce04113038ec0b759c806ef85dfc0dbb83a23934849c","projectId":"2daa3a4267a2ef2cb6a6cee56821a80c","taskId":"task-a-parse-date"},"text":"A（task-a-parse-date）执行完毕，接口冲突按任务书上报，请转人决定：parseDate 到底返回 Date 还是 {y,m,d}。\n\n【已完成、证据】\n- src/api.js 导出 `export function parseDate(text)`：`new Date(text)` 有效则返回该 Date 实例；`Number.isNaN(getTime())` 抛 RangeError；非字符串抛 TypeError。日期文本原样交给 Date，无自定义格式规则（\"2024-03-05\" 按 UTC 解析）。\n- 新建 test/api.test.js，3 条用例：DateTime 实例与 UTC 年月日、非法文本→RangeError、非字符串→TypeError。\n- 仓库根 `node --test`：6 test / 6 pass / 0 fail，exit=0（含 B 的 test/report.test.js）。`node --check` 两个源文件均通过。\n- 我只改了 src/api.js 并新建 test/api.test.js；src/report.js 未由我改动（git status 显示它也变了，是 B 的线改的）。\n- 已在 api 模块锚点记 pitfall「parseDate 返回值约定」（noteId d2728410-118c-42a7-b57e-a04bf018bab2）。\n\n【冲突对象】\n- 函数：src/api.js 的 `parseDate(text)`，返回约定 = Date 实例（A 任务书与 api 模块接口描述均如此）。\n- 要求方：task-b-month-of 的指派说明写明“你需要 parseDate 返回 {y,m,d}”，用户层 = src/report.js 的 `monthOf`。\n- 同一锚点上你已有 open_question「接口约定」记了这条（noteId 7e352df2-26d1-42d6-b7e9-812537404657，当前因两文件改动为 stale）；我这份是现行实现的事实补充，未重复结论，等你以 decision 收掉它。\n\n【影响】\n- 若定为 Date（现状）：monthOf 用 `parseDate(t).getUTCMonth()+1` 即可，B 实际已这样写并通过测试，无功能损失；风险是日期格式口径取决于 JS Date 实现，未做严格格式校验。\n- 若定为 {y,m,d}：monthOf 可直读字段；但代价是我这份 parseDate 与 api 模块接口描述都要改，且现有 test/api.test.js 的 Date 断言、test/report.test.js 约 2 处 `parseDate(text).getUTCMonth()` 要同步改，B 的 report.test.js 会立刻红。\n- 建议（不代替决定）：保持 parseDate 返回 Date，另加导出派生函数（如 `dateParts(text)` 返回 {y,m,d}）给需要字段的调用方。我没有实现它，等明确放行。\n\n【当前事实】此刻工作区里没有任何 {y,m,d} 实现，B 的 monthOf 已按 Date 返回工作，全绿。是否需要我为选定方案再动手，或把取舍写成 decision 覆盖那条 open_question，请指示；这对后续 Run 不阻塞（本任务自身验收已达成）。","wake":true}；接受 queued；叫醒轮 krun-932d094400122eda888e51fd37b7f351c1376ac50a48c4b57feb848379691c89/kturn-23f414d4051fa19f97ef8e1d2519201164f1ae94fd9a72fa2f6ef3e61351eee8；Query 无；Goal 完成观测于 2026-11-27T03:26:49.024Z
- 8E contact 层：uncovered (8E optional)（只记在这里，不进 uncovered[]；9-start-rulings.frozen.md:966-967）

### E12：fail

- C 行：C-36, C-42, C-157, C-88, C-89, C-104, C-145, C-146, C-158, C-147, C-155, C-207, C-114, C-215, C-220；自治档 `after_plan_confirmation`；provider `deepseek` / `deepseek-v4.1-flash`。
- 用量：输入 1787707（含缓存命中），输出 20859，缓存命中 1516416，Query 请求 27。

| 判据 | C 行 | 结果 | 说明 |
|---|---|---|---|
| reads-quiet | C-36 | pass | QueryRun 3→3，输入 469196→469196，changesHead h0000001002→h0000001002 |
| graph-cards | C-88, C-89 | pass | goal children 4，find 5，path 卡 有 |
| raw-history | C-42, C-157 | pass | 线的原历史 70 条，Run 历史 69 条 |
| completion-chain | C-104 | pass | 检查轮卡 3 张，有非空 evidenceRefs：true |
| restart-state | C-145, C-215 | pass | 重启后旧 Goal COMPLETED，计划 initial-plan-ecec2d8c77ed09b55a4ebf642235f45c，Run 1/1 |
| reconcile | C-146 | pass | host/reconcile-report：lease owned |
| redrive-sets | C-155 | pass | 旧 Goal 的 causes：[] |
| new-goal | C-114, C-158 | pass | 新 Goal goal-confirm:goal.confirmDraft:96abebc8cf8f9c46c1fd3af09a88ef68bd02e85411a8a011e8d661558a486e96（采用 committed，起步时 3 个任务都没满足）→ COMPLETED；旧 Goal 仍 COMPLETED |
| history-reuse | C-220 | uncovered (not-run) | 新 Goal 的 Run 没有一个成功的工具结果引用旧 Goal 或旧 Run（这次新工作没有查询已完成工作） |
| stale-premise | C-220 | uncovered (entry-missing) | 适用范围和“过期前提不升级”是模型对已查到事实的取舍，公开读口没有逐项可判的字段，不判通过 |
| replay | C-147 | fail | 同一 flowId 两次 driver-start：rejected/rejected，state undefined/undefined |
| wait-registry | C-207 | uncovered (entry-missing) | 目标等待登记表只在 Host 内存里，没有公开读口；重启后只能看到它的效果（等待的线被叫醒），看不到登记表本身 |

- restart: SIGINT, exit 0 after 261 ms
- goal-confirm:goal.confirmDraft:96abebc8cf8f9c46c1fd3af09a88ef68bd02e85411a8a011e8d661558a486e96: the person selected idea 1 of 3 (A 最小改动：在 greet.js 直接加 farewell(name)，与 greet 并列导出)

### iteration：fail

- C 行：C-108, C-109, C-110, C-111, C-112, C-105, C-107, C-113, C-194, C-213, C-226；自治档 `after_plan_confirmation`；provider `deepseek` / `deepseek-v4.1-flash`。
- 用量：输入 1051450（含缓存命中），输出 15226，缓存命中 853120，Query 请求 21。

| 判据 | C 行 | 结果 | 说明 |
|---|---|---|---|
| ideas | C-108 | pass | 3 个思路，目标卡草稿 0 |
| select | C-109 | pass | select-idea queued；下一轮输入提到所选：true |
| candidate | C-110 | pass | 候选 plan-proposal-dd41237e27814cbfe9fe1fa9b291403a（candidate） |
| what-changed | C-213, C-110 | fail | 第二轮回答说明改动：false；新候选 plan-proposal-1371b6a4d46ef9a6abfe9f959ab266fd，前一版 {"proposalRef":{"aggregateType":"PlanProposal","projectId":"459d9c873b155a6b51cc0fb04d7d0576","workspaceId":"f60724965bd1035b22351b5c5656bdf6","proposalId":"plan-proposal-dd41237e27814cbfe9fe1fa9b291403a"},"revision":2} |
| per-request | C-111 | pass | 采用第一请求的候选 committed；第二请求候选 plan-proposal-b520a93413d1a50ba8600d85c166dc4c 现在 stale |
| why | C-112, C-226 | pass | 追问后候选不变：true；回答 1644 字 |
| continues | C-105 | pass | 同一请求 3 轮，秘书 Session session-e0ebe3ea196debd29fe9574a548a793c4e049c401354fd7b1027f57194b72991 |
| request-goal | C-107 | pass | 请求记的目标 goal-confirm:goal.confirmDraft:bccef7c86505f05c08245daa4c9ab222e60c97d69253ec7fbf6a9ca9034175d0 |
| cards-ask | C-113 | pass | 秘书线的 turn 输入带 ## Cards：true |
| multi-round | C-194 | pass | 后续轮的回答接上前面改过的内容（process.argv） |

- goal-confirm:goal.confirmDraft:bccef7c86505f05c08245daa4c9ab222e60c97d69253ec7fbf6a9ca9034175d0 (RUNNING): pause because iteration ended: committed

### intervention：fail

- C 行：C-199, C-200, C-201, C-202, C-203, C-114, C-189, C-192, C-197, C-198；自治档 `after_plan_confirmation`；provider `deepseek` / `deepseek-v4.1-flash`。
- 用量：输入 4242852（含缓存命中），输出 37055，缓存命中 3750016，Query 请求 44。

| 判据 | C 行 | 结果 | 说明 |
|---|---|---|---|
| ask-copy | C-198 | pass | 问一问 queued → answered；原线 Run ended/completed，输入含这个问题的轮 无；问件 session-message-8afbb0ec4a0bee83ac295befb4069416de5e19eab49e2001a61a16f4c3335110 answeredBy copy，送进 无 |
| delivery-states | C-189, C-192 | pass | disposition 依次：offerable → delivered（发送回执 sent）；发信时在跑的 Run 36d1d65c-1210-4dec-ad4c-9d7931a9a942；送进 Run 36d1d65c-1210-4dec-ad4c-9d7931a9a942 |
| busy-original-words | C-189, C-199 | pass | 送进发信时在跑的 Run 36d1d65c-1210-4dec-ad4c-9d7931a9a942（接受于 2026-11-27T03:40:52.403Z）；这个 Run 输入含原话的轮：kturn-220727dca6f6d5ac368513c860f49e4c4a469895a5729df16e15868e0d9763c9 |
| continue-no-planning | C-199 | pass | 发送时线上当前任务 goal-confirm:goal.confirmDraft:6bd6aaa9e117ad051fa737a47579d9ccb26994c033332ffe122c50a9e08afed6/t-truncate active/running；这条消息的 intervention_planning Query：没有 |
| planning-when-idle | C-199, C-200 | fail | the platform did not do it: timed out after 20 min waiting for the ending of the idle-line message |
| claim-once | C-199 | fail | 2026-11-27T03:42:22.188Z 发给空闲线 session-3a33386b57b520749d68291404990191909e24ab6bbfdc2b9612afe27640cf9e（当前任务 goal-confirm:goal.confirmDraft:6bd6aaa9e117ad051fa737a47579d9ccb26994c033332ffe122c50a9e08afed6/t-capitalize active/verifying）；2026-11-27T03:43:23.267Z 读到 answered，送进 无；之后这条线上这个任务新开的 Run 无（因这条消息开的 0 个）；这条消息的规划 Query intervention-planning-7858429433427815690202554998f457d7f7c2fe0a11b0d6232d312c914c48cc |
| four-endings | C-201, C-202, C-203 | uncovered (entry-missing) | “反问”“非法”两种收尾没有公开入口能造出；这次看到的结局：无 |
| review-packet | C-199 | uncovered (not-run) | 被 Run 接受的直接干预 2 条；审阅线 无；这个目标的 execreview 包 0 个；逐条：session-message-3a58f1bc9b9164b78cff0b3c7f06be3f7f117db5cf8a722324d1525c926e8115（Run 36d1d65c-1210-4dec-ad4c-9d7931a9a942，任务 t-truncate）：没有对上这个任务和 Run 的审阅包；session-message-dbd9770325b48278fe3405380005e87c7509f5fdf657eba0b56b4c732e128631（Run e06f37eb-0c9f-4a07-8499-a3402cbd1dd8，任务 t-slugify）：没有对上这个任务和 Run 的审阅包（检查计划里没有审阅项时不出包） |
| completed-goal | C-114 | uncovered (not-run) | 干过已完成目标 goal-confirm:goal.confirmDraft:0b9ad35b3b10806e2b0f6dda5ef23f7878a6324b08a8ab6a985ece8a0552f679 的线（session-0f23dff2bba78fa9f88808802651671cf5c636df876d5b9f806172b439ca9a07）页面上显示的目标都不是它（被别的目标复用），发给它们的消息不会成为新目标请求 |
| paused-queues | C-197 | pass | 暂停 committed（目标当时 RUNNING）：暂停中 offerable；恢复 committed  后 delivered |

- goal-confirm:goal.confirmDraft:6bd6aaa9e117ad051fa737a47579d9ccb26994c033332ffe122c50a9e08afed6: the person selected idea 1 of 3 (A 串行三任务（推荐）：一个文件三个函数，按顺序做，每步都验证)
- driver-start goal-confirm:goal.confirmDraft:6bd6aaa9e117ad051fa737a47579d9ccb26994c033332ffe122c50a9e08afed6: rejected busy
- planning-when-idle: later read fail: 2026-11-27T03:42:30.249Z 发给 session-3a33386b57b520749d68291404990191909e24ab6bbfdc2b9612afe27640cf9e（目标 RUNNING，线上当前任务 goal-confirm:goal.confirmDraft:6bd6aaa9e117ad051fa737a47579d9ccb26994c033332ffe122c50a9e08afed6/t-capitalize active/satisfied）；Query -（开在 -）-；20 分钟里这条消息没有收尾
- 长目标结束 COMPLETED

### waiting：fail

- C 行：C-170, C-171, C-187, C-188, C-190, C-172, C-184, C-189, C-192, C-195, C-196, C-207, C-224, C-225；自治档 `after_plan_confirmation`；provider `deepseek` / `deepseek-v4.1-flash`。
- 用量：输入 955170（含缓存命中），输出 28034，缓存命中 676736，Query 请求 17。

| 判据 | C 行 | 结果 | 说明 |
|---|---|---|---|
| wait-open | C-188, C-225 | pass | 成员 session-aa14c9f23d2127b8554803a569c8a005612278a30ce987ce845f159a91360073 的 Work（Run 26514045-3380-4796-b02c-1d846953eb84）经工具发出等待 session-message-803406f956bdbcd0c64e51a6179590ff263fc033f752acbefa384b49f8487ce8：收信人 session-b5137a6c5454357563e9ffd727ebcd078ba57e631061ff2e1a2e14cb4231a878，期限 2026-11-27T04:07:48.829Z，waitAfterSend true；发信的 Run 26514045-3380-4796-b02c-1d846953eb84 ended/yielded，continuation wait_reply → session-message-803406f956bdbcd0c64e51a6179590ff263fc033f752acbefa384b49f8487ce8 |
| interject-keeps-wait | C-188, C-224 | pass | 插话 session-message-e3bdbd3bbfabe069259ce8016d09e1f7e50282536c5389ccc08cb9b8628ce118（sent）：接它的 Run 11570395-2d78-42bc-957b-533cad8d644f（consumedWait intervention，在 session-aa14c9f23d2127b8554803a569c8a005612278a30ce987ce845f159a91360073）；原等待 session-message-803406f956bdbcd0c64e51a6179590ff263fc033f752acbefa384b49f8487ce8 open，期限 2026-11-27T04:07:48.829Z（原 2026-11-27T04:07:48.829Z）；新中断通知 成员侧 1 条、秘书侧 1 条 |
| restart-kept | C-170, C-207 | uncovered (not-run) | 重启后同一等待：从sessions/facts 的 waits（expired）读到，期限 2026-11-27T04:07:48.829Z（原 2026-11-27T04:07:48.829Z），收信人 session-b5137a6c5454357563e9ffd727ebcd078ba57e631061ff2e1a2e14cb4231a878；消费它的接受 无；接续的 Run - consumedWait -，messageRef -，originalRun -（原 26514045-3380-4796-b02c-1d846953eb84），在 -（成员 session-aa14c9f23d2127b8554803a569c8a005612278a30ce987ce845f159a91360073）：关 Host 时未结束的 Run 11570395-2d78-42bc-957b-533cad8d644f(starting)；这一半没走到 |
| expiry-once | C-171, C-190 | fail | the platform did not do it: timed out after 20 min waiting for the expiry acceptance to consume the wait |
| second-expiry | C-171, C-190, C-224 | uncovered (env-unavailable) | t-wait 已做完（satisfied），又等了 10 分钟，链上 1 条等待还没了结；同一追问链实际到期 1 次（没有时钟缝，不伪造） |
| consumes | C-187 | uncovered (not-run) | 成员的等待（session-message-803406f956bdbcd0c64e51a6179590ff263fc033f752acbefa384b49f8487ce8, session-message-803406f956bdbcd0c64e51a6179590ff263fc033f752acbefa384b49f8487ce8）还没有一条被执行接受，消费无从判 |
| late-reply | C-224, C-189 | uncovered (env-unavailable) | t-wait 已做完（satisfied），又等了 10 分钟，链上 1 条等待还没了结；到期（2026-11-27T04:08:53.779Z）被消费之后没有回复（回复槽空，也没有接受的回复） |
| reply-first | C-187, C-224 | uncovered (not-run) | 成员 30 分钟里没有发第二个要等的问题（waitAfterSend、不在第一条等待链上），这一支没走到 |
| transfer | C-224 | uncovered (not-run) | 成员 30 分钟里没有发第二个要等的问题（waitAfterSend、不在第一条等待链上），这一支没走到，转交无从做起 |
| disconnect | C-195, C-196 | uncovered (not-run) | 归档前重读成员线：已没有开着的等待（都已回答或处理），断开无从造出 |
| supply-order | C-172, C-192, C-184 | uncovered (not-run) | 公开读口给出 2 项接受顺序（见 notes），但“接受顺序等于供给顺序”没有书面依据，不判 pass |

- P6 Q8 插话在第一个等待开着时发出；它让成员线多开了一个 Run（11570395-2d78-42bc-957b-533cad8d644f），之后的到期链在这之后发生
- 关 Host 时 t-wait 的 Run 在 starting（11570395-2d78-42bc-957b-533cad8d644f）：已领取、未进入，重启后同一次领取续驱（W-01..W-03），不是等待的接续
- close and restart: SIGINT, exit 0 after 269 ms
- restart: resumeOnStartup = ask
- expiry-once: later read fail: expiredAt 2026-11-27T04:08:53.779Z；记下时消费 false；之后由 无 消费
- waiting: 成员 30 分钟里没有发第二个要等的问题（waitAfterSend、不在第一条等待链上），这一支没走到；reply-first、transfer 记未覆盖（lead 11-25）
- 供给顺序旁证（run.input_accepted 的接受顺序，不作判据）：krun-10ceff515002044e7a496c58a4724df63c7e796a872a736314b6d27fdc42d633/kturn-2f02b0350abfe9b9e89ea8b72c791ed66423df9ac6da0127bffa8e918924ef60: SessionMessage/message session-message-e3bdbd3bbfabe069259ce8016d09e1f7e50282536c5389ccc08cb9b8628ce118 用户插话（消息 session-message-e3bdbd3bbfabe069259ce8016d09e1f7e50282536c5389ccc08cb9b8628ce118）： 插一句：先别改代码，继续等秘书回答你刚才的问题，拿到回答再 ｜ krun-10ceff515002044e7a496c58a4724df63c7e796a872a736314b6d27fdc42d633/kturn-2f02b0350abfe9b9e89ea8b72c791ed66423df9ac6da0127bffa8e918924ef60: SessionMessage/message session-message-c4984ca7ce7a77b5ef5aaa2391b58fe025bcbab3833858a721bc4b37613ab26b 消息 session-message-c4984ca7ce7a77b5ef5aaa2391b58fe025bcbab3833858a721bc4b37613ab26b，来自 平台，要回复：否，叫醒你：不会 中断通知 · Session se
- 等待链 session-message-803406f956bdbcd0c64e51a6179590ff263fc033f752acbefa384b49f8487ce8；结束方式 task-done

## 撞墙表

| 时间 | 场景 | 哪一步 | 看到的拒绝原文和理由 | 类别 | 预期 | 建议包 |
|---|---|---|---|---|---|---|
| 2026-11-27T01:56:40.388Z | A1 | core/completion-policies/read | not_found: project b5feaedb4fcf00cb3c714a21f7ba8482 has no active CompletionPolicy | 无理由 | expected | 待定 |
| 2026-11-27T01:57:47.114Z | B1 | core/completion-policies/read | not_found: project g6-wb has no active CompletionPolicy | 无理由 | expected | 待定 |
| 2026-11-27T01:58:44.556Z | B1 | tool project_source (call call_01_YJ3ikadiGxSsTZ12tP4q0935) | invalid_arguments: 工具参数不符合 schema：prefix: Too small: expected string to have >=1 characters; prefix: Use a normalized workspace-relative path | 无理由 | - | 待定 |
| 2026-11-27T01:58:49.504Z | B1 | tool project_source (call call_01_GtExk3zqGXRbY0QaWxVj6822) | invalid_arguments: 工具参数不符合 schema：capture: Invalid input: expected object, received undefined | 无理由 | - | 待定 |
| 2026-11-27T01:59:37.716Z | E05 | tool submit_initial_plan (call call_8cfbbecbfe2e4a22bff21c40) | invalid: the answer has problems; fix every one and call the tool again in this round | 无理由 | - | 待定 |
| 2026-11-27T02:00:39.685Z | E05 | tool list_files (call call_5f01b0c9a90f4972a3e66038) | execution_failed: ENOENT: no such file or directory, open '/proc/self/fd/26/test' | 无理由 | - | 待定 |
| 2026-11-27T02:00:42.889Z | E05 | tool look_graph (call call_f749ab4cedb54e61858fd6c8) | invalid_arguments: 工具参数不符合 schema：target.ref: Unrecognized key: "aggregateType"; target.planRef: Invalid input: expected object, received undefined 或 memory: Invalid input: expected object, received undefined; (根): Unrecognized keys: "mode", "target" | 无理由 | - | 待定 |
| 2026-11-27T02:00:43.856Z | E05 | tool look_graph (call call_f0417af3046744f8bc064b59) | invalid_arguments: 工具参数不符合 schema：(根): Unrecognized key: "planRef" | 无理由 | - | 待定 |
| 2026-11-27T02:00:58.389Z | E05 | tool edit (call call_cf8d8d2bbda54b518ec3f469) | invalid_arguments: 工具参数不符合 schema：(根): Unrecognized key: "expectedRevision" | 无理由 | - | 待定 |
| 2026-11-27T02:01:02.311Z | E05 | tool edit (call call_5cf07553a1af416f8203b217) | execution_failed: test/users.test.js 不存在 | 无理由 | - | 待定 |
| 2026-11-27T02:01:13.916Z | E05 | tool send_session_message (call call_6ac43d054b47443687bef250) | not_found: the requested record does not exist | 无理由 | - | 待定 |
| 2026-11-27T02:02:09.008Z | E05 | tool read_session_message_body (call call_09b64c67995941f3aff01c5e) | execution_failed: the requested mailbox record does not exist | 无理由 | - | 待定 |
| 2026-11-27T02:02:09.019Z | E05 | tool read_session_message_body (call call_60c8c3ea8abc48ce875afbad) | execution_failed: the requested mailbox record does not exist | 无理由 | - | 待定 |
| 2026-11-27T02:02:15.180Z | E05 | tool respond_session_message (call call_eae8235cb27548919554257d) | forbidden: only the Host may settle this source | 无理由 | - | 待定 |
| 2026-11-27T02:02:24.168Z | E05 | tool dispatch_task (call call_fce49c48733a4c898d69a24a) | invalid: the last Run of the Task ended without a pending rework; request a rework or recheck first | 无理由 | - | 待定 |
| 2026-11-27T02:03:09.288Z | E05 | tool read_execution_history (call call_b878f8b6bb07441e9e2af57a) | invalid: afterCursor is not a nextCursor this Run was given (it may have expired with a Host restart); read again with afterCursor null | 无理由 | - | 待定 |
| 2026-11-27T02:08:19.012Z | E06 | core/workflow/driver-start | busy: another collaboration advancement is already active for this Goal | 协调 | - | 待定 |
| 2026-11-27T02:08:55.146Z | E06 | tool record_note (call call_bec1dbee2e134db690e81756) | invalid_arguments: 工具参数不符合 schema：topic: Invalid input: expected string, received undefined; conclusion: Invalid input: expected string, received undefined | 无理由 | - | 待定 |
| 2026-11-27T02:42:10.270Z | E08 | tool submit_initial_plan (call call_69fe10b34314481ca3a1eb1f) | invalid_arguments: 工具参数不符合 schema：setup.architecture: Unrecognized key: "requirements" | 产品规则 | - | 待定 |
| 2026-11-27T02:42:24.143Z | E08 | tool submit_initial_plan (call call_604b5598ba9347c3810b2582) | invalid_arguments: 工具参数不符合 schema：planDraftIndex: Invalid input: expected number, received undefined | 无理由 | - | 待定 |
| 2026-11-27T02:42:36.961Z | E08 | tool submit_initial_plan (call call_5eead027e17142948efc1290) | invalid: the answer has problems; fix every one and call the tool again in this round | 无理由 | - | 待定 |
| 2026-11-27T02:42:58.157Z | E08 | core/goals/confirm-draft confirm-again-mwydmgvh-49 | revision_conflict: the draft already created a goal; one card never makes two goals | 协调 | expected | 待定 |
| 2026-11-27T02:42:58.165Z | E08 | core/goals/control goals-control-mwydmgvp-50 | invalid: meta.expected must pin the Goal and its GoalPhase (0 = none stored) | 产品规则 | expected | 待定 |
| 2026-11-27T02:43:06.371Z | E08 | tool read (call call_b4b6271958a74633a6a8406d) | permission_denied: 请求路径不在允许范围 | 无理由 | - | 待定 |
| 2026-11-27T02:44:46.203Z | E08 | tool edit (call call_9d24e35940e54240bec31962) | execution_failed: test/sub.test.js 不存在 | 无理由 | - | 待定 |
| 2026-11-27T02:44:46.424Z | E08 | tool respond_session_message (call call_c646a77471a04110a82c288d) | forbidden: 这条消息由这一轮的结论回复；要先说进度，另发一条不要回复的 | 无理由 | - | 待定 |
| 2026-11-27T02:44:52.914Z | E08 | tool submit_plan_round (call call_d12bcbb6eac64f2480a2bf7e) | invalid_arguments: 工具参数不符合 schema：plan: Unrecognized key: "schemaVersion" | 无理由 | - | 待定 |
| 2026-11-27T02:45:10.867Z | E08 | tool submit_plan_round (call call_99bfe23471744a37a40d340e) | invalid: the answer has problems; fix every one and call the tool again in this round | 无理由 | - | 待定 |
| 2026-11-27T02:45:24.375Z | E08 | tool submit_plan_round (call call_e43c154f7b6c42139c762288) | invalid: the answer has problems; fix every one and call the tool again in this round | 无理由 | - | 待定 |
| 2026-11-27T02:45:40.544Z | E08 | tool submit_plan_round (call call_0275c1f0df314b0e91a67e95) | invalid: the answer has problems; fix every one and call the tool again in this round | 无理由 | - | 待定 |
| 2026-11-27T02:45:55.342Z | E08 | tool submit_plan_round (call call_4df0a2ad680c461bbb70458e) | invalid: the answer has problems; fix every one and call the tool again in this round | 无理由 | - | 待定 |
| 2026-11-27T02:47:09.217Z | E08 | tool look_graph (call call_28d40d4436964e87a95fdae9) | invalid_arguments: 工具参数不符合 schema：target.ref: Unrecognized key: "aggregateType" | 无理由 | - | 待定 |
| 2026-11-27T02:47:44.268Z | E08 | tool find_graph (call call_19a64f988a7f4416a740d3a7) | capacity: the complete graph tool result exceeds 48 KiB; request a smaller page or drill down into one node | 协调 | - | 待定 |
| 2026-11-27T02:48:49.059Z | E08 | tool look_graph (call call_7b51b27f804a4a498e4f572d) | invalid_arguments: 工具参数不符合 schema：memory.anchor: Invalid input: expected object, received undefined | 无理由 | - | 待定 |
| 2026-11-27T02:49:29.742Z | E08 | tool ask_copy (call call_9e78c1a7e3d34c68b3dccfae) | not_found: the requested record does not exist | 无理由 | - | 待定 |
| 2026-11-27T02:49:41.548Z | E08 | tool record_note (call call_46483220c4614d439cc2c0d8) | invalid_arguments: 工具参数不符合 schema：(根): Unrecognized keys: "expectedVersion", "replace" | 无理由 | - | 待定 |
| 2026-11-27T02:50:02.989Z | E08 | tool find_graph (call call_5c83c6a0abca4f85abc1e38c) | capacity: the complete graph tool result exceeds 48 KiB; request a smaller page or drill down into one node | 协调 | - | 待定 |
| 2026-11-27T02:50:05.558Z | E08 | tool find_graph (call call_5d7bca724bc94596bda18e9a) | capacity: the complete graph tool result exceeds 48 KiB; request a smaller page or drill down into one node | 协调 | - | 待定 |
| 2026-11-27T03:22:41.003Z | E09 | tool run_readonly_command (call call_92046254b69b4775a8e84e73) | execution_failed: 命令退出码 2 | 无理由 | - | 待定 |
| 2026-11-27T03:22:59.831Z | E09 | tool submit_initial_plan (call call_fe77d6ff2f874048a6f86d9b) | invalid: the answer has problems; fix every one and call the tool again in this round | 无理由 | - | 待定 |
| 2026-11-27T03:23:14.566Z | E09 | tool submit_initial_plan (call call_b2be4759fe1b47b8aca17459) | invalid_arguments: 工具参数不符合 schema：summary: Invalid input: expected string, received undefined | 无理由 | - | 待定 |
| 2026-11-27T03:23:30.867Z | E09 | tool submit_initial_plan (call call_594244d8feff4be294c0e86c) | invalid_arguments: 工具参数不符合 schema：planDraftIndex: Invalid input: expected number, received undefined | 无理由 | - | 待定 |
| 2026-11-27T03:24:52.507Z | E09 | tool list_files (call call_25754ae1de214ce9afb83747) | invalid_arguments: 工具参数不符合 schema：prefix: Too small: expected string to have >=1 characters; prefix: Use a workspace-relative path | 无理由 | - | 待定 |
| 2026-11-27T03:25:13.656Z | E09 | tool edit (call call_e5c97b165e224cd48fa546b6) | invalid_arguments: 工具参数不符合 schema：(根): Unrecognized key: "expectedRevision" | 无理由 | - | 待定 |
| 2026-11-27T03:25:14.730Z | E09 | tool edit (call call_0b66082951984f25a6e88c25) | execution_failed: test/api.test.js 不存在 | 无理由 | - | 待定 |
| 2026-11-27T03:26:39.126Z | E09 | tool read_user_decision (call call_5afdcd836f0a4f47b8e82aa5) | forbidden: a query round reads only the answer of an ask_person card its own line sent | 无理由 | - | 待定 |
| 2026-11-27T03:27:37.330Z | E12 | tool submit_initial_plan (call call_c520ca9b0cc44ed0aec08cb4) | invalid: the answer has problems; fix every one and call the tool again in this round | 无理由 | - | 待定 |
| 2026-11-27T03:27:48.764Z | E12 | tool submit_initial_plan (call call_45f3585e7db5440f98304efd) | invalid_arguments: 工具参数不符合 schema：summary: Invalid input: expected string, received undefined | 无理由 | - | 待定 |
| 2026-11-27T03:28:50.144Z | E12 | tool edit (call call_7881eb1a576f46c59c1c08f0) | execution_failed: test/greet.test.js 不存在 | 无理由 | - | 待定 |
| 2026-11-27T03:28:52.580Z | E12 | tool list_files (call call_ce67f6f22b4647b0b62f8359) | execution_failed: ENOENT: no such file or directory, open '/proc/self/fd/63/test' | 无理由 | - | 待定 |
| 2026-11-27T03:28:59.040Z | E12 | tool edit (call call_881e012619d9424aa6e19e60) | invalid_arguments: 工具参数不符合 schema：(根): Unrecognized key: "expectedRevision" | 无理由 | - | 待定 |
| 2026-11-27T03:29:13.676Z | E12 | tool record_note (call call_1107e591994c420eb3c0d4a4) | invalid_arguments: 工具参数不符合 schema：op: Invalid discriminator value. Expected 'write' \| 'review' \| 'withdraw' | 无理由 | - | 待定 |
| 2026-11-27T03:31:51.167Z | E12 | tool submit_plan_round (call call_60b8e5d1bb864a76b3f1a66a) | invalid_arguments: 工具参数不符合 schema：plan: Unrecognized key: "checks" | 无理由 | - | 待定 |
| 2026-11-27T03:32:01.930Z | E12 | tool submit_plan_round (call call_6087ba48f3324ee5acbc4ed4) | invalid: the answer has problems; fix every one and call the tool again in this round | 无理由 | - | 待定 |
| 2026-11-27T03:32:17.567Z | E12 | tool submit_plan_round (call call_c68d5a95f7ce4eceb0adbaa3) | invalid: the answer has problems; fix every one and call the tool again in this round | 无理由 | - | 待定 |
| 2026-11-27T03:32:20.484Z | E12 | tool query_task_graph (call call_dcc73a8edbd446b894d0eb41) | execution_failed: the requested plan record does not exist | 无理由 | - | 待定 |
| 2026-11-27T03:32:44.354Z | E12 | core/workflow/driver-start | busy: another collaboration advancement is already active for this Goal | 协调 | - | 待定 |
| 2026-11-27T03:32:44.369Z | E12 | core/workflow/driver-start | busy: another collaboration advancement is already active for this Goal | 协调 | - | 待定 |
| 2026-11-27T03:33:45.886Z | iteration | tool submit_initial_plan (call call_79358b8b50144090929ddb6d) | invalid_arguments: 工具参数不符合 schema：plan.stages: Invalid input: expected array, received undefined; plan.tasks: Invalid input: expected array, received undefined; plan.obligations: Invalid input: expected array, received undefined; plan.taskHierarchy: Invalid input: expected object, received undefined; plan.executionDag: Invalid input: expected object, received undefined | 无理由 | - | 待定 |
| 2026-11-27T03:33:54.909Z | iteration | tool submit_initial_plan (call call_b0f5f0c5e85042d9898387a8) | invalid: the answer has problems; fix every one and call the tool again in this round | 无理由 | - | 待定 |
| 2026-11-27T03:36:53.345Z | iteration | core/goals/control goals-control-mwyfjt5t-87 | revision_conflict: the GoalPhase changed since the caller read it | 协调 | - | 待定 |
| 2026-11-27T03:37:23.670Z | intervention | tool submit_initial_plan (call call_efdaf70248ad4d978f6011fc) | invalid: the answer has problems; fix every one and call the tool again in this round | 无理由 | - | 待定 |
| 2026-11-27T03:38:05.074Z | intervention | tool list_files (call call_cdf2fa8af89f42ad8688d5f6) | invalid_arguments: 工具参数不符合 schema：prefix: Too small: expected string to have >=1 characters; prefix: Use a workspace-relative path | 无理由 | - | 待定 |
| 2026-11-27T03:38:19.436Z | intervention | tool dispatch_task (call call_63b302c063f54433b9a9f95f) | busy: the Task is in progress; its lease is still held by a running Run | 协调 | - | 待定 |
| 2026-11-27T03:38:27.637Z | intervention | tool edit (call call_ccd5fae8b80a4fc2917bca55) | execution_failed: test/lower.test.js 不存在 | 无理由 | - | 待定 |
| 2026-11-27T03:39:58.742Z | intervention | core/workflow/driver-start | busy: another collaboration advancement is already active for this Goal | 协调 | - | 待定 |
| 2026-11-27T03:41:09.901Z | intervention | tool look_graph (call call_c4d324abf058468f8bd3b835) | unsupported: the Run has no persisted execution-history locator (Run e06f37eb-0c9f-4a07-8499-a3402cbd1dd8) | 无理由 | - | 待定 |
| 2026-11-27T03:41:21.328Z | intervention | tool send_session_message (call call_c4234491e27346baa0c6243d) | invalid_arguments: 工具参数不符合 schema：(根): Unrecognized key: "noop" | 无理由 | - | 待定 |
| 2026-11-27T03:42:48.175Z | intervention | tool record_note (call call_00e0e5e600004c11a253590e) | invalid_arguments: 工具参数不符合 schema：(根): Unrecognized key: "expectedVersion" | 无理由 | - | 待定 |
| 2026-11-27T03:42:53.924Z | intervention | tool look_graph (call call_f39d4d52a73247eb82b3b913) | invalid_arguments: 工具参数不符合 schema：memory.anchor.planRevision: Invalid input: expected number, received undefined | 无理由 | - | 待定 |
| 2026-11-27T04:03:53.443Z | waiting | tool submit_initial_plan (call call_b960c59295d840d5a989c422) | invalid_arguments: 工具参数不符合 schema：plan: Unrecognized key: "summary" | 无理由 | - | 待定 |
| 2026-11-27T04:04:05.594Z | waiting | tool submit_initial_plan (call call_8d2feae86be7413fbb789c57) | invalid: the answer has problems; fix every one and call the tool again in this round | 无理由 | - | 待定 |
| 2026-11-27T04:04:16.536Z | waiting | tool submit_initial_plan (call call_9c9012955df64134a32a2b89) | invalid_arguments: 工具参数不符合 schema：planDraftIndex: Invalid input: expected number, received undefined | 无理由 | - | 待定 |
| 2026-11-27T05:09:59.519Z | C-216 | tool submit_initial_plan (call call_3eb9a7e1a1704456b7a072f9) | invalid_arguments: 工具参数不符合 schema：plan.stages: Invalid input: expected array, received undefined; plan.tasks: Invalid input: expected array, received undefined; plan.obligations: Invalid input: expected array, received undefined; plan.taskHierarchy: Invalid input: expected object, received undefined; plan.executionDag: Invalid input: expected object, received undefined; (根): Unrecognized keys: "planDraftIndex_long_note", "planDraftIndex_conflict_note", "planDraftIndex2" | 无理由 | - | 待定 |
| 2026-11-27T05:10:14.934Z | C-216 | tool submit_initial_plan (call call_da7255d018c84176b3262d4b) | invalid_arguments: 工具参数不符合 schema：plan.stages: Invalid input: expected array, received undefined; plan.tasks: Invalid input: expected array, received undefined; plan.obligations: Invalid input: expected array, received undefined; plan.taskHierarchy: Invalid input: expected object, received undefined; plan.executionDag: Invalid input: expected object, received undefined | 无理由 | - | 待定 |
| 2026-11-27T05:10:27.121Z | C-216 | tool submit_initial_plan (call call_1ac7a79400e64590a026b645) | invalid_arguments: 工具参数不符合 schema：plan.stages: Invalid input: expected array, received undefined; plan.tasks: Invalid input: expected array, received undefined; plan.obligations: Invalid input: expected array, received undefined; plan.taskHierarchy: Invalid input: expected object, received undefined; plan.executionDag: Invalid input: expected object, received undefined | 无理由 | - | 待定 |
| 2026-11-27T05:10:41.466Z | C-216 | tool submit_initial_plan (call call_3e2b9199fbb74e9aa5cd6dc0) | invalid: the answer has problems; fix every one and call the tool again in this round | 无理由 | - | 待定 |
| 2026-11-27T05:10:53.278Z | C-216 | tool submit_initial_plan (call call_0d3188e28d8f4d6e87b7b16a) | invalid_arguments: 工具参数不符合 schema：plan.stages: Invalid input: expected array, received undefined; plan.tasks: Invalid input: expected array, received undefined; plan.obligations: Invalid input: expected array, received undefined; plan.taskHierarchy: Invalid input: expected object, received undefined; plan.executionDag: Invalid input: expected object, received undefined | 无理由 | - | 待定 |
| 2026-11-27T05:11:08.517Z | C-216 | tool submit_initial_plan (call call_73c3d51aef234c2d863504d5) | invalid_arguments: 工具参数不符合 schema：plan.stages: Invalid input: expected array, received undefined; plan.tasks: Invalid input: expected array, received undefined; plan.obligations: Invalid input: expected array, received undefined; plan.taskHierarchy: Invalid input: expected object, received undefined; plan.executionDag: Invalid input: expected object, received undefined | 无理由 | - | 待定 |
| 2026-11-27T05:11:21.018Z | C-216 | tool submit_initial_plan (call call_cb371ba416f145bc9d38d9ce) | invalid_arguments: 工具参数不符合 schema：plan.stages: Invalid input: expected array, received undefined; plan.tasks: Invalid input: expected array, received undefined; plan.obligations: Invalid input: expected array, received undefined; plan.taskHierarchy: Invalid input: expected object, received undefined; plan.executionDag: Invalid input: expected object, received undefined | 无理由 | - | 待定 |
| 2026-11-27T05:11:40.587Z | C-216 | tool submit_initial_plan (call call_9fb859edfd9c4cd78cd8ec34) | invalid: the answer has problems; fix every one and call the tool again in this round | 无理由 | - | 待定 |
| 2026-11-27T05:12:42.392Z | C-216 | tool edit (call call_096f22848aaa4dcabbf74f3f) | invalid_arguments: 工具参数不符合 schema：expectedRevision: Invalid input: expected string, received undefined | 无理由 | - | 待定 |
| 2026-11-27T05:12:51.641Z | C-216 | tool record_note (call call_98ab79d2139c446eb6404d07) | invalid_arguments: 工具参数不符合 schema：anchor: Invalid input: expected object, received undefined; (根): Unrecognized key: "anonymousAnchor" | 无理由 | - | 待定 |
| 2026-11-27T05:13:12.367Z | C-221 | tool list_files (call call_8f83f5f29f164329be3f6683) | invalid_arguments: 工具参数不符合 schema：prefix: Too small: expected string to have >=1 characters; prefix: Use a workspace-relative path | 无理由 | - | 待定 |
| 2026-11-27T05:13:27.434Z | C-221 | tool submit_initial_plan (call call_e688dc6140ec4be98c36679c) | invalid_arguments: 工具参数不符合 schema：setup: Unrecognized key: "checks_note"; (根): Unrecognized key: "assignments" | 无理由 | - | 待定 |
| 2026-11-27T05:13:40.201Z | C-221 | tool submit_initial_plan (call call_da9b79fd1eff45d6985d510e) | invalid: the answer has problems; fix every one and call the tool again in this round | 无理由 | - | 待定 |
| 2026-11-27T05:14:25.870Z | C-221 | tool read (call call_61ae7243e66a4703bd798bf1) | permission_denied: 请求路径不在允许范围 | 无理由 | - | 待定 |
| 2026-11-27T05:14:28.431Z | C-221 | tool shell (call call_649f2e0b545145339cb3137c) | execution_failed: shell 退出码 2 | 无理由 | - | 待定 |
| 2026-11-27T05:14:35.408Z | C-221 | tool edit (call call_9886fc0384834d06a21b20a3) | execution_failed: test/fizzbuzz.test.js 不存在 | 无理由 | - | 待定 |
| 2026-11-27T05:15:10.505Z | C-222 | tool run_readonly_command (call call_0543c31e43434f8183ec91c9) | execution_failed: 命令退出码 1 | 无理由 | - | 待定 |
| 2026-11-27T05:15:23.083Z | C-222 | tool submit_initial_plan (call call_0de6e943fc924bf680471514) | invalid: the answer has problems; fix every one and call the tool again in this round | 无理由 | - | 待定 |
| 2026-11-27T05:15:32.202Z | C-222 | tool submit_initial_plan (call call_0e5cd9da3e5b4c6da7d23411) | invalid_arguments: 工具参数不符合 schema：summary: Invalid input: expected string, received undefined | 无理由 | - | 待定 |
| 2026-11-27T05:15:51.729Z | C-222 | tool read (call call_e7c3291896ab4d7c9852f41d) | permission_denied: 请求路径不在允许范围 | 无理由 | - | 待定 |
| 2026-11-27T05:17:20.776Z | C-222 | tool edit (call call_10dbf54b6b284d91acc189e2) | execution_failed: test/shapes.test.js 不存在 | 无理由 | - | 待定 |
| 2026-11-27T05:18:08.510Z | B06 | tool submit_initial_plan (call call_8d8ee135f01d4a3bb95c087d) | invalid_arguments: 工具参数不符合 schema：plan: Unrecognized key: "summary" | 无理由 | - | 待定 |
| 2026-11-27T05:18:18.708Z | B06 | tool submit_initial_plan (call call_4fd9b35970db4413ae57e35c) | invalid_arguments: 工具参数不符合 schema：planDraftIndex: Invalid input: expected number, received undefined | 无理由 | - | 待定 |
| 2026-11-27T05:18:25.208Z | B06 | tool submit_initial_plan (call call_7671300c948945859bf5c851) | invalid: the answer has problems; fix every one and call the tool again in this round | 无理由 | - | 待定 |
| 2026-11-27T05:19:25.716Z | B06 | tool record_note (call call_743fdc0614b54145b9f65f11) | invalid_arguments: 工具参数不符合 schema：op: Invalid discriminator value. Expected 'write' \| 'withdraw' | 无理由 | - | 待定 |
| 2026-11-27T05:21:01.940Z | B06 | tool look_graph (call call_260f862a9bce43c692e7211b) | invalid_arguments: 工具参数不符合 schema：planRef: Invalid input: expected object, received undefined | 无理由 | - | 待定 |
| 2026-11-27T05:21:04.648Z | B06 | tool look_graph (call call_c0a5c49138574cecba6e83ec) | not_found: the Plan declares no input c28e41be2644230964a0b0882f5b8f61e45fd3c7e869654dd277eb6abb8a16b2 for this consumer | 无理由 | - | 待定 |
| 2026-11-27T05:21:52.362Z | B06 | tool submit_initial_plan (call call_1d4ee1fe59a8495b90190f2d) | invalid: the answer has problems; fix every one and call the tool again in this round | 无理由 | - | 待定 |
| 2026-11-27T05:22:04.947Z | B06 | tool submit_initial_plan (call call_657c82ba5e184bf0b32e357e) | invalid_arguments: 工具参数不符合 schema：plan: Invalid input: expected object, received string | 无理由 | - | 待定 |
| 2026-11-27T05:22:47.511Z | B06 | tool run_readonly_command (call call_cc1972ee8c9046a78d5948ef) | execution_failed: 命令退出码 128 | 无理由 | - | 待定 |
| 2026-11-27T05:24:02.202Z | E08b | tool submit_initial_plan (call call_d4adca8f428a4d7993e56552) | invalid: the answer has problems; fix every one and call the tool again in this round | 无理由 | - | 待定 |
| 2026-11-27T05:24:39.509Z | E08b | tool run_readonly_command (call call_708135f76a1c4935a674fb02) | execution_failed: 命令退出码 2 | 无理由 | - | 待定 |
| 2026-11-27T05:24:56.848Z | E08b | tool edit (call call_cbba9af5187c40398169716f) | execution_failed: test/sub.test.js 不存在 | 无理由 | - | 待定 |
| 2026-11-27T05:25:04.039Z | E08b | tool record_note (call call_d250f6fbe66142fb9bb031d2) | invalid_arguments: 工具参数不符合 schema：topic: Invalid input: expected string, received undefined | 无理由 | - | 待定 |
| 2026-11-27T05:25:07.559Z | E08b | tool read (call call_cc0e034e661d4d21bdbba65d) | execution_failed: test/sub.test.js 不存在 | 无理由 | - | 待定 |
| 2026-11-27T05:25:11.646Z | E08b | tool edit (call call_b0eb776429bc4e66bc6610d7) | execution_failed: test/mul.test.js 不存在 | 无理由 | - | 待定 |
| 2026-11-27T05:25:18.848Z | E08b | tool submit_plan_round (call call_2ca9bc0d48fe42e8bd7ff63e) | invalid_arguments: 工具参数不符合 schema：answerKind: Invalid option: expected one of "plan"\|"questions"; plan: Unrecognized key: "checks" | 无理由 | - | 待定 |
| 2026-11-27T05:25:25.335Z | E08b | tool submit_plan_round (call call_9adbc4d59542475fbeade6b4) | invalid: the answer has problems; fix every one and call the tool again in this round | 无理由 | - | 待定 |
| 2026-11-27T05:25:34.840Z | E08b | tool submit_plan_round (call call_20a00b1928a84353bd84c402) | invalid: the answer has problems; fix every one and call the tool again in this round | 无理由 | - | 待定 |
| 2026-11-27T05:25:44.982Z | E08b | tool submit_plan_round (call call_942c0746cf8943268613299e) | invalid: the answer has problems; fix every one and call the tool again in this round | 无理由 | - | 待定 |
| 2026-11-27T05:25:46.676Z | E08b | tool record_note (call call_c2dacbbc53a54efe9d78dfda) | invalid_arguments: 工具参数不符合 schema：anchor: Invalid input: expected object, received undefined; (根): Unrecognized keys: "expectedVersion", "noteId" | 无理由 | - | 待定 |
| 2026-11-27T05:56:32.628Z | compaction | tool run_readonly_command (call call_25f55dc4ab6c42ee8cf42794) | execution_failed: 命令退出码 1 | 无理由 | - | 待定 |
| 2026-11-27T05:57:02.693Z | compaction | tool run_readonly_command (call call_1aaefa28b895419d9e8014f4) | execution_failed: 命令退出码 1 | 无理由 | - | 待定 |
| 2026-11-27T05:57:39.273Z | compaction | tool read (call call_b320602d3ac9474c9c2b687e) | invalid_arguments: 工具参数不符合 schema：(根): endLine 不能小于 startLine | 产品规则 | - | 待定 |
| 2026-11-27T05:57:48.442Z | compaction | tool run_readonly_command (call call_0d7799d845fc47aebce273c5) | execution_failed: 命令退出码 1 | 无理由 | - | 待定 |
| 2026-11-27T05:58:31.398Z | compaction | tool run_readonly_command (call call_80a38d2006bc4e58b8f61de3) | execution_failed: 命令退出码 2 | 无理由 | - | 待定 |

每次拒绝一行：HTTP 拒绝（预期的也记，标 expected）和公开原历史里的每次工具拒绝（按调用身份去重），原文不截断。类别只认依据：busy/revision_conflict/idempotency_conflict/source_stale/capacity 记协调；理由点到不可逆、外部或秘密的记安全；理由点到规则的记产品规则；其余记“无理由”。

## A/B、压缩、附加格、B06

### A1：pass

- reserved（C-214）：pass。reservedOutput 131072（requestId 61895469-ac5e-434e-b473-b11840d5f05d）
- usage（C-214）：pass。usageStatus reported，输入 32615，输出 94，缓存命中 384
- accepted（C-214）：pass。请求被接受（用量已报）
- not-truncated（C-214）：pass。输出 94 < 预留 131072；close detail none
- driver-start: ready running
- 请求事实：[{"requestId":"61895469-ac5e-434e-b473-b11840d5f05d","reservedOutput":131072,"usageStatus":"reported","inputTokens":32615,"outputTokens":94,"cachedInputTokens":384},{"requestId":"4567e294-9673-454a-a5c6-c14fe1226b93","reservedOutput":131072,"usageStatus":"reserved","inputTokens":null,"outputTokens":null,"cachedInputTokens":null}]；Query running；close null；profile 累计输出上限 null = 不设上限
- queries/cancel after the first request: ready stopping
- request 4567e294-9673-454a-a5c6-c14fe1226b93: cut by the driver's cancel; usage not reported, at most one request (Query closed, close cancelled)

### B1：pass

- reserved（C-214）：pass。reservedOutput 64000（requestId 56bd4285-5bad-4352-ba75-48315077ce45）
- usage（C-214）：pass。usageStatus reported，输入 12865，输出 130，缓存命中 10752
- accepted（C-214）：pass。请求被接受（用量已报）
- not-truncated（C-214）：pass。输出 130 < 预留 64000；close detail none
- fits（C-214）：pass。请求发出（reservedInput 以内），reservedOutput 64000
- driver-start: ready running
- 请求事实：[{"requestId":"56bd4285-5bad-4352-ba75-48315077ce45","reservedOutput":64000,"usageStatus":"reported","inputTokens":12865,"outputTokens":130,"cachedInputTokens":10752},{"requestId":"1635ab21-e9fc-4c7f-88cd-ea6637c163b2","reservedOutput":63870,"usageStatus":"reported","inputTokens":13903,"outputTokens":93,"cachedInputTokens":12928},{"requestId":"90cb02b8-28a4-4777-879f-784e8e63d2bf","reservedOutput":63777,"usageStatus":"reported","inputTokens":14370,"outputTokens":125,"cachedInputTokens":13952},{"requestId":"0f4f68f8-68d6-492f-8e82-e1d39391e163","reservedOutput":63652,"usageStatus":"reported","inputTokens":15004,"outputTokens":159,"cachedInputTokens":14464},{"requestId":"0c03a560-acd8-425d-b632-6da9e5043bf2","reservedOutput":63493,"usageStatus":"reported","inputTokens":15608,"outputTokens":124,"cachedInputTokens":15104},{"requestId":"5aa96f46-b821-476d-8d5f-d18934470ba2","reservedOutput":63369,"usageStatus":"reported","inputTokens":15859,"outputTokens":41,"cachedInputTokens":15616},{"requestId":"e8545db7-9438-46ce-915e-08f45f286564","reservedOutput":63328,"usageStatus":"reserved","inputTokens":null,"outputTokens":null,"cachedInputTokens":null}]；Query running；close null；profile 累计输出上限 64000
- queries/cancel after the first request: ready stopping
- request e8545db7-9438-46ce-915e-08f45f286564: cut by the driver's cancel; usage not reported, at most one request (Query closed, close cancelled)

### 压缩：pass

- compacted（K2-P2）：pass。context_compacted 3 条（kernhist1.eyJ2IjoxLCJwIjp7InByb2plY3RJZCI6IjA4ODVlMzhlNmM5NTA0YTQ4ZTBhYWFhMzZjM2UzOWY0Iiwic2Vzc2lvbklkIjoic2Vzc2lvbi1hNzk2MTc4NDAzYjc3OWUyZjU5NDA3YWI1YTkyY2MwOTFkODE3MDk1YjVkMjk4ZGQxZDIxZDRkZjA5YjkzZDExIn0sImEiOiJob3N0LXNldHRpbmdzLWtlcm5lbC1kZWU5ZWNjMmI5YzBjMWE4ZmFkNjA1MjI0OTdkMWVlYSIsImsiOiJzZXNzaW9uLWE3OTYxNzg0MDNiNzc5ZTJmNTk0MDdhYjVhOTJjYzA5MWQ4MTcwOTViNWQyOThkZDFkMjFkNGRmMDliOTNkMTEiLCJyIjoie1wiYWN0b3JcIjp7XCJpZFwiOlwiZzYtcGVyc29uXCIsXCJraW5kXCI6XCJodW1hblwifSxcImtpbmRcIjpcImhvc3RcIn0iLCJ1IjoxMTksImwiOjEsImkiOjUyfQ:summary, kernhist1.eyJ2IjoxLCJwIjp7InByb2plY3RJZCI6IjA4ODVlMzhlNmM5NTA0YTQ4ZTBhYWFhMzZjM2UzOWY0Iiwic2Vzc2lvbklkIjoic2Vzc2lvbi1hNzk2MTc4NDAzYjc3OWUyZjU5NDA3YWI1YTkyY2MwOTFkODE3MDk1YjVkMjk4ZGQxZDIxZDRkZjA5YjkzZDExIn0sImEiOiJob3N0LXNldHRpbmdzLWtlcm5lbC1kZWU5ZWNjMmI5YzBjMWE4ZmFkNjA1MjI0OTdkMWVlYSIsImsiOiJzZXNzaW9uLWE3OTYxNzg0MDNiNzc5ZTJmNTk0MDdhYjVhOTJjYzA5MWQ4MTcwOTViNWQyOThkZDFkMjFkNGRmMDliOTNkMTEiLCJyIjoie1wiYWN0b3JcIjp7XCJpZFwiOlwiZzYtcGVyc29uXCIsXCJraW5kXCI6XCJodW1hblwifSxcImtpbmRcIjpcImhvc3RcIn0iLCJ1IjoxMTksImwiOjEsImkiOjgwfQ:summary, kernhist1.eyJ2IjoxLCJwIjp7InByb2plY3RJZCI6IjA4ODVlMzhlNmM5NTA0YTQ4ZTBhYWFhMzZjM2UzOWY0Iiwic2Vzc2lvbklkIjoic2Vzc2lvbi1hNzk2MTc4NDAzYjc3OWUyZjU5NDA3YWI1YTkyY2MwOTFkODE3MDk1YjVkMjk4ZGQxZDIxZDRkZjA5YjkzZDExIn0sImEiOiJob3N0LXNldHRpbmdzLWtlcm5lbC1kZWU5ZWNjMmI5YzBjMWE4ZmFkNjA1MjI0OTdkMWVlYSIsImsiOiJzZXNzaW9uLWE3OTYxNzg0MDNiNzc5ZTJmNTk0MDdhYjVhOTJjYzA5MWQ4MTcwOTViNWQyOThkZDFkMjFkNGRmMDliOTNkMTEiLCJyIjoie1wiYWN0b3JcIjp7XCJpZFwiOlwiZzYtcGVyc29uXCIsXCJraW5kXCI6XCJodW1hblwifSxcImtpbmRcIjpcImhvc3RcIn0iLCJ1IjoxMTksImwiOjEsImkiOjk5fQ:summary）
- six-sections（K2-P2）：pass。摘要（kernhist1.eyJ2IjoxLCJwIjp7InByb2plY3RJZCI6IjA4ODVlMzhlNmM5NTA0YTQ4ZTBhYWFhMzZjM2UzOWY0Iiwic2Vzc2lvbklkIjoic2Vzc2lvbi1hNzk2MTc4NDAzYjc3OWUyZjU5NDA3YWI1YTkyY2MwOTFkODE3MDk1YjVkMjk4ZGQxZDIxZDRkZjA5YjkzZDExIn0sImEiOiJob3N0LXNldHRpbmdzLWtlcm5lbC1kZWU5ZWNjMmI5YzBjMWE4ZmFkNjA1MjI0OTdkMWVlYSIsImsiOiJzZXNzaW9uLWE3OTYxNzg0MDNiNzc5ZTJmNTk0MDdhYjVhOTJjYzA5MWQ4MTcwOTViNWQyOThkZDFkMjFkNGRmMDliOTNkMTEiLCJyIjoie1wiYWN0b3JcIjp7XCJpZFwiOlwiZzYtcGVyc29uXCIsXCJraW5kXCI6XCJodW1hblwifSxcImtpbmRcIjpcImhvc3RcIn0iLCJ1IjoxMTksImwiOjEsImkiOjUyfQ）2221 字；缺的段：无
- accepted（K2-P2）：pass。摘要后第一次请求 59f16d28-30b7-4c71-bdad-c63c57de1288：usage reported（那一轮之后 closed，close invalid_answer，另记）
- cache-after（K2-P2）：pass。摘要后第一次请求 59f16d28-30b7-4c71-bdad-c63c57de1288：输入 33831，缓存命中 0（只量，不承诺）
- 秘书线 5 轮；压缩记录 compacted/summary, compacted/summary, compacted/summary；触发 0.02、目标 0.01

### C-216：pass

- observed-start（C-216）：pass。采用前观察 2026-11-27T05:09:18.209Z（{"aggregateType":"ObservedArchitecture","projectId":"2174afe649a4d1043ae7a9a99ba00c7a","workspaceId":"4b54dbc0a9db230d8a4dc7f28b68cb14","captureId":"d212418d-c259-462a-8526-3e35a997eae1"}）；候选 3 个模块、路径 src/store.js, src/report.js, test/store.test.js；采用版 3 个路径：src/report.js, src/store.js, test/store.test.js；覆盖种子文件：src/store.js
- adopted-done（C-216）：pass。Goal COMPLETED
- cold start: round ab77d377-1c95-4d02-b186-0da60f106fb9 asked the person questions (needs_decision) instead of a plan; the person answered on the request

### C-221：uncovered

- first-plan（C-221）：pass。首案采用 initial-plan-309aec57749a9c067fe2f1417b441e81
- fail-rework（C-221）：uncovered (not-run)。没有同一 Task 上“检查轮 FAIL → 返工的新 Run → 检查轮 PASS”这条链（真实模型一次做对，不伪造失败）
- delivered（C-221）：pass。Goal COMPLETED

### C-222：pass

- created（C-222）：pass。secretaryCreated 的线：session-55d7642b9237907dd0c07c936a3b40f6919f23b1cc0830716b98e85afd68f823
- started（C-222）：pass。建出的线上 Run：b3f05a39-f192-4a04-ba40-f6af30802997/completed；Goal COMPLETED；null

### B06：pass

- W1a（B06-W1a）：pass。witness PASS/matched；Task satisfied；Goal PAUSED；报告 429 字
- W2（B06-W2）：pass。witness FAIL；Task running
- W3（B06-W3）：pass。witness FAIL；Task failed
- W5（B06-W5）：pass。非 Git：witness INCONCLUSIVE/matched；Task blocked
- W10（B06-W10）：pass。witness PASS，witness 要求由 platform:witness 覆盖：true；reviewer 要求 pass，覆盖它的检查 无（由独立审阅回答）；Task satisfied
- W12（B06-W12）：pass。四段：task 有 → round 有 → evidence 2 → material keys reportText,roundRef,subjectRunRef
- explore（B06-cond3）：pass。没写 witness 要求的 explore：计划被收下，轮 finalized，没有 platform:witness 检查
- cancel ceca1726-cd75-4274-87c1-3f1658fb95c1: submit committed, deliver ready  
- B06-W1b、W4、W6、W8、W11、W13 和条件 1 引 B06 G2 的绿测（f580d77e，决定 121-122），G6 不重跑；第 9 片审阅的通过不写成 B06 通过。

### E08b：fail

- sub-running（C-210）：pass。提交改需求时 sub（t1）的 Run 60b46efd-e61a-4976-8783-fad110d93d0a 正在跑（开始于 2026-11-27T05:24:43.614Z）
- stop-delivered（C-210）：pass。任务卡 stop.steps：requested → hold_placed → sent → delivered → run_ended；请求 released（secretary 线 session-008d535213b960b9be1b96fad3da1558f780d501df869f827761c50b09d67a70，停 Run 60b46efd-e61a-4976-8783-fad110d93d0a）
- safe-point-end（C-210）：pass。叫停送到后 sub 的 Run 60b46efd-e61a-4976-8783-fad110d93d0a 结束（completed @ 2026-11-27T05:25:02.563Z），采用时没有 busy 硬停；任务卡 stop.steps：requested → hold_placed → sent → delivered → run_ended；请求 released（secretary 线 session-008d535213b960b9be1b96fad3da1558f780d501df869f827761c50b09d67a70，停 Run 60b46efd-e61a-4976-8783-fad110d93d0a）
- adopt-after-end（C-210）：fail。sub 的 Run 结束 2026-11-27T05:25:02.563Z；采用 initial-plan-d9a6f2654f29edcad131ed48c5a937e4 @ 2026-11-27T05:26:04.899Z（人 plans/apply，busy 0 次）；采用版本的 dispositionRecord 里没有 sub 的记录
- E08b 改需求的轮：?:request/ideas 2
- the person selected idea 1 of 2 on the change: 方案 A：同阶段用 div 任务替换 sub 任务，验收同步替换
- 采用前：叫停请求 action_request.stop:b7eace6627106730c81ee071a6ff48f7abbe2cbc654a8ab2b6c2f547b686e117 released；任务卡上的步骤 requested → hold_placed → sent → delivered → run_ended；sub 的 Run 已结束 2026-11-27T05:25:02.563Z（completed）
- E08b 采用 initial-plan-d9a6f2654f29edcad131ed48c5a937e4：任务 t1:active, t2:active, g-s1:active, g-goal:superseded, g-goal-2:active, t3:active；处置记录 1 条
- goal-confirm:goal.confirmDraft:e96f4ec44887ff45b8e7bf89a1b91379b81c0549c1d11987b0f28020664c7c19 (RUNNING): pause because E08b ended: committed
- E08b ended: after 30 min still Query 0, Work Run 1, Goals not paused none; cancelling what is left
- E08b ended: cancel c712fd70-8e81-41a0-a5f2-498677527a89: submit committed, deliver ready  

## 预算

- 上限：总量 400000000，每个场景/格 50000000（acceptance.config.json `tokenCaps`）。
- 口径：用量 = inputTokens + outputTokens（Kernel 的 inputTokens 已含缓存命中，cachedInputTokens 另记、不再相加）；每条按它所在项目的归属场景/格计，不按读到的时间。
- 合计：用量 31551379（输入 31211576，输出 339803；缓存命中 26859392）；Query 请求 402 次（含 Query 的压缩摘要请求，公开记录分不出）；结束的 Work Run 43 个，其中 0 个是公开证明的零（没进入 Kernel）；未知或不完整的用量不算零：已关闭 Query 里用量未知的请求按预留上限（输入预留 + 输出预留）计，只会多算；Work Run 的用量未知或不完整、或请求的预留读不到时，计量停下。
- 已知缺口：Work Run 的压缩摘要请求在另一个 Kernel Session 里跑，不在 `activity/runs` 里，计量少算了它们；驱动不读数据库补数（lead 裁定 11-14 #3）。400M/50M 上限远高于预期用量，这是记下的缺口，不是阻断。
- 最后一次完整读数时在途：Query 0，Work Run 0（Work Run 的用量要等 Run 结束才在 `activity/runs` 出现，所以超限后的停止点是第一次能看到超出的读数）。
- 实报输入（平台报了用量的部分，不含按预留上限计的和未计费 0）：31164771；估算部分 46805。
- 超预算退出：整轮 没有；按场景/格 没有。
- A1：用量 32709（输入 32615，输出 94，缓存命中 384；Query 请求 2（其中按未计费 0 计的 1：provider 拒收，或驱动自己取消截断的请求；按预留上限计的 0：Query 已关闭、用量未知），结束的 Run 0；实报输入 32615）
- B1：用量 88281（输入 87609，输出 672，缓存命中 82816；Query 请求 7（其中按未计费 0 计的 1：provider 拒收，或驱动自己取消截断的请求；按预留上限计的 0：Query 已关闭、用量未知），结束的 Run 0；实报输入 87609）
- E05：用量 5415540（输入 5383149，输出 32391，缓存命中 4749056；Query 请求 72（其中按未计费 0 计的 0：provider 拒收，或驱动自己取消截断的请求；按预留上限计的 0：Query 已关闭、用量未知），结束的 Run 3；实报输入 5383149）
- E06：用量 903743（输入 894609，输出 9134，缓存命中 768256；Query 请求 4（其中按未计费 0 计的 0：provider 拒收，或驱动自己取消截断的请求；按预留上限计的 0：Query 已关闭、用量未知），结束的 Run 2；实报输入 894609）
- E08：用量 5660752（输入 5609193，输出 51559，缓存命中 4912640；Query 请求 46（其中按未计费 0 计的 0：provider 拒收，或驱动自己取消截断的请求；按预留上限计的 0：Query 已关闭、用量未知），结束的 Run 6；实报输入 5609193）
- E09：用量 2788563（输入 2762006，输出 26557，缓存命中 2481152；Query 请求 17（其中按未计费 0 计的 0：provider 拒收，或驱动自己取消截断的请求；按预留上限计的 0：Query 已关闭、用量未知），结束的 Run 2；实报输入 2762006）
- E12：用量 1808566（输入 1787707，输出 20859，缓存命中 1516416；Query 请求 27（其中按未计费 0 计的 0：provider 拒收，或驱动自己取消截断的请求；按预留上限计的 0：Query 已关闭、用量未知），结束的 Run 2；实报输入 1787707）
- iteration：用量 1066676（输入 1051450，输出 15226，缓存命中 853120；Query 请求 21（其中按未计费 0 计的 0：provider 拒收，或驱动自己取消截断的请求；按预留上限计的 0：Query 已关闭、用量未知），结束的 Run 1；实报输入 1051450）
- intervention：用量 4279907（输入 4242852，输出 37055，缓存命中 3750016；Query 请求 44（其中按未计费 0 计的 0：provider 拒收，或驱动自己取消截断的请求；按预留上限计的 0：Query 已关闭、用量未知），结束的 Run 6；实报输入 4242852）
- waiting：用量 983204（输入 955170，输出 28034，缓存命中 676736；Query 请求 17（其中按未计费 0 计的 0：provider 拒收，或驱动自己取消截断的请求；按预留上限计的 1：Query 已关闭、用量未知），结束的 Run 3；实报输入 908365）
- C-216：用量 1410668（输入 1380760，输出 29908，缓存命中 1145856；Query 请求 22（其中按未计费 0 计的 0：provider 拒收，或驱动自己取消截断的请求；按预留上限计的 0：Query 已关闭、用量未知），结束的 Run 2；实报输入 1380760）
- C-221：用量 615383（输入 604759，输出 10624，缓存命中 488832；Query 请求 9（其中按未计费 0 计的 0：provider 拒收，或驱动自己取消截断的请求；按预留上限计的 0：Query 已关闭、用量未知），结束的 Run 1；实报输入 604759）
- C-222：用量 1021760（输入 1009024，输出 12736，缓存命中 811648；Query 请求 22（其中按未计费 0 计的 0：provider 拒收，或驱动自己取消截断的请求；按预留上限计的 0：Query 已关闭、用量未知），结束的 Run 1；实报输入 1009024）
- B06：用量 2381565（输入 2355407，输出 26158，缓存命中 2059904；Query 请求 40（其中按未计费 0 计的 1：provider 拒收，或驱动自己取消截断的请求；按预留上限计的 0：Query 已关闭、用量未知），结束的 Run 10；实报输入 2355407）
- E08b：用量 2318395（输入 2293993，输出 24402，缓存命中 1962368；Query 请求 31（其中按未计费 0 计的 0：provider 拒收，或驱动自己取消截断的请求；按预留上限计的 0：Query 已关闭、用量未知），结束的 Run 4；实报输入 2293993）
- compaction：用量 775667（输入 761273，输出 14394，缓存命中 600192；Query 请求 21（其中按未计费 0 计的 0：provider 拒收，或驱动自己取消截断的请求；按预留上限计的 0：Query 已关闭、用量未知），结束的 Run 0；实报输入 761273）
- P6 记账：模型调用 697 次（公开原历史里 `model.request_started` 的条数，含 Work Run；压缩摘要的请求在另一个 Kernel Session 里，数不到，照旧记作缺口）；叫醒轮（intervention-planning）30 个，其中只回“收到”的 3 个（成功的工具调用只有读类和答复，且答复的都不是要回复的信，没交候选、没发信、没出卡；裁定 Q11、lead 11-25 #31，只计数不判；回复对象读不到的照旧计数，见其它记录）。
- A1：模型调用 2，叫醒轮 1，只回收到 1
- B1：模型调用 7，叫醒轮 1，只回收到 1
- E05：模型调用 97，叫醒轮 6，只回收到 0
- E06：模型调用 14，叫醒轮 0，只回收到 0
- E08：模型调用 102，叫醒轮 4，只回收到 0
- E09：模型调用 61，叫醒轮 2，只回收到 0
- E12：模型调用 45，叫醒轮 1，只回收到 0
- iteration：模型调用 26，叫醒轮 1，只回收到 0
- intervention：模型调用 88，叫醒轮 4，只回收到 0
- waiting：模型调用 28，叫醒轮 2，只回收到 1
- C-216：模型调用 37，叫醒轮 1，只回收到 0
- C-221：模型调用 19，叫醒轮 1，只回收到 0
- C-222：模型调用 31，叫醒轮 1，只回收到 0
- B06：模型调用 68，叫醒轮 3，只回收到 0
- E08b：模型调用 54，叫醒轮 2，只回收到 0
- compaction：模型调用 18，叫醒轮 0，只回收到 0

## 延迟探针

- wa#0：{"startedAt":"2026-11-27T01:56:38.162Z","writtenAt":"2026-11-27T01:57:45.361Z","samples":3330,"p50Ms":21.3,"p95Ms":21.59,"p99Ms":39.68,"maxMs":327.16,"meanMs":21.8}；关闭 SIGINT, exit 0 after 46 ms
- wb#0：{"startedAt":"2026-11-27T01:57:45.412Z","writtenAt":"2026-11-27T01:59:04.067Z","samples":3770,"p50Ms":21.36,"p95Ms":21.68,"p99Ms":31.65,"maxMs":241.04,"meanMs":21.76}；关闭 SIGINT, exit 0 after 25 ms
- w-accept#0：{"startedAt":"2026-11-27T01:59:04.109Z","writtenAt":"2026-11-27T02:08:33.683Z","samples":27391,"p50Ms":21.23,"p95Ms":21.69,"p99Ms":55.93,"maxMs":805.83,"meanMs":22.15}；关闭 SIGINT, exit 0 after 4642 ms
- w-accept#1：{"startedAt":"2026-11-27T02:08:33.731Z","writtenAt":"2026-11-27T02:09:32.108Z","samples":2804,"p50Ms":21.27,"p95Ms":21.66,"p99Ms":61.87,"maxMs":313.52,"meanMs":22.03}；关闭 SIGINT, exit 0 after 37 ms
- w-accept#2：{"startedAt":"2026-11-27T02:09:32.158Z","writtenAt":"2026-11-27T03:29:31.049Z","samples":240545,"p50Ms":21.27,"p95Ms":21.66,"p99Ms":22.05,"maxMs":1258.29,"meanMs":21.3}；关闭 SIGINT, exit 0 after 261 ms
- w-accept#3：{"startedAt":"2026-11-27T03:29:31.124Z","writtenAt":"2026-11-27T04:06:13.125Z","samples":109092,"p50Ms":20.97,"p95Ms":21.73,"p99Ms":30.11,"maxMs":1134.56,"meanMs":21.58}；关闭 SIGINT, exit 0 after 269 ms
- w-accept#4：{"startedAt":"2026-11-27T04:08:50.830Z","writtenAt":"2026-11-27T05:56:21.945Z","samples":321272,"p50Ms":21.43,"p95Ms":21.91,"p99Ms":22.45,"maxMs":645.4,"meanMs":21.56}；关闭 SIGINT, exit 0 after 270 ms
- compaction#0：{"startedAt":"2026-11-27T05:56:22.015Z","writtenAt":"2026-11-27T05:59:31.461Z","samples":9455,"p50Ms":21,"p95Ms":21.92,"p99Ms":24.41,"maxMs":499.65,"meanMs":21.65}；关闭 SIGINT, exit 0 after 58 ms

## 其它记录

- 2026-11-27T01:57:45.263Z A1: g6-a1-mwybyxlk-4 (BLOCKED): pause because wa closes: committed
- 2026-11-27T01:57:45.288Z A1: A1: request 4567e294-9673-454a-a5c6-c14fe1226b93 counted as unbilled 0 (cut by the driver's cancel; usage not reported, at most one request)
- 2026-11-27T01:59:03.999Z B1: g6-b1-mwyc0d2h-15 (BLOCKED): pause because wb closes: committed
- 2026-11-27T01:59:04.018Z B1: B1: request e8545db7-9438-46ce-915e-08f45f286564 counted as unbilled 0 (cut by the driver's cancel; usage not reported, at most one request)
- 2026-11-27T04:08:55.305Z waiting: waiting: request edda0b41-4b80-4437-9892-18f0e755fb93 counted at its reservation 46805+16384 (usage unknown; Query closed cancelled; counted at the reservation (upper bound))
- 2026-11-27T05:20:07.103Z B06: B06: Run ceca1726-cd75-4274-87c1-3f1658fb95c1 counted with its reported part only, the rest 0 (cut by the driver's cancel; usage not reported, at most one request)
- 2026-11-27T05:59:31.483Z -: §6.2：Query 在“进入中”被中止由 qent 关成 not_entered（aborted_before_entry）；`queries/cancel` 在 entering 窗口仍回 not_running，本次不测、不判场景失败。
