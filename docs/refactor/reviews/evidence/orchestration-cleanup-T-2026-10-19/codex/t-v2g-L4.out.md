本次按当前文件重新检查，没有沿用旧清单的行号。**以下仍不能作为“完整枚举”冻结**：已经覆盖全部文件，但 A1 中若干大型文件及组外 fuzz 链尚未完成逐调用的参数契约、签发字段来源核对。下面只计已经能明确裁定的条目，未核完的文件单独列出，避免把“未列出”误报成“无实例”。

计数按表中条目；同一来源、同一判定的调用点合并列出。`v2 允许`只表示所列输入或转发方式允许，不表示整个测试通过规则审查。依据是 `.lead-ref/books/test-rule-sheet-v2.md:24`、`.lead-ref/books/test-rule-sheet-v2.md:30`、`.lead-ref/books/test-rule-sheet-v2.md:32`。

A1 公共输入。

| 位置 | owner、值及来源 | 平台签发字段与后续 | 判定 |
|---|---|---|---|
| `tests/app/S0-attention-edge-label.test.ts:166`、`:174` | `plans.proposePlan/applyPlanChange`；完整手写 PlanDraft，定义于同文件`:138` | proposal 引用及修订直接取`:166`的返回值；公开 propose→apply | **v2 允许**，A1 草稿条款 |
| `tests/app/R6-host.test.ts:324`、`:329` | `plans.proposePlan/applyPlanChange`；手写 `planDraft()` | proposal 引用及修订来自同文件`:326`；继续公开读取`:333` | **v2 允许**，A1 草稿条款 |
| `tests/app/R6-host.test.ts:303`、`:308` | `completionPolicies.installCompletionPolicy/activateCompletionPolicy`；手写策略内容 | digest 来自安装返回值，同文件`:306`，没有自行计算替代 | **v2 允许**，A1 签发字段条款 |
| `tests/app/S0-attention-edge-label.test.ts:102`、`:111` | 同上；手写策略内容 | `installed.value.contentDigest`原样使用，同文件`:112` | **v2 允许**，A1 签发字段条款 |
| `tests/app/S4C-note-routes.test.ts:65`、`:68`、`:126`、`:136`、`:159`、`:191` | `notes.writeNote`；手写 NoteDraft，输入包装见同文件`:37` | `expectedPointerRevision:null`；随后公开列出注记，如`:71`、`:147`、`:196`；夹具仍有 F3，见下表 | **v2 允许**，A1 外部输入条款 |
| `tests/app/S4C2-scribe-reminders.test.ts:62`、`:79`、`:81`、`:84`、`:87`、`:100`、`:102`、`:210`、`:256`、`:528`、`:574`、`:643`、`:753`、`:866` | `notes.writeNote`；`general/understanding`手写注记，定义于同文件`:47`、`:53`；经 `tests/helpers/S4A-note-fixture.ts:275`提供的夹具接口 | 没有伪造 token、cursor 或 prepared；后续并非全公开，Kernel 写入另列 F3 | **v2 允许**，A1 外部输入条款 |
| `tests/app/S4C-record-note-host.test.ts:141`、`:204` | `record_note`平台工具；脚本模型提供手写工具参数 | 由真实工作链执行，随后通过 notes/list 检查，同文件`:175`、`:231` | **v2 允许**，A1 工具输入条款 |
| `tests/app/S2A-decision-routes.test.ts:56` | `decisionMessages.sendUserMessage`；经 `sendUserDecision`组装文本及选项 | helper 为 `tests/helpers/S2A-queue-fixture.ts:67`；选项来自已有消息的公开业务对象，同文件`:70`；基础夹具有 F3 | **v2 允许**，A1 外部消息输入 |
| `tests/app/S2A-decision-routes.test.ts:79`、`:97`、`:115` | `decisions.queryDecisionQueue`；手写筛选与分页参数 | 后页 cursor 来自实际前页，同文件`:89`、`:107`；基础夹具有 F3 | **v2 允许**，A1 签发字段条款 |
| `tests/app/S2B-backfill-workflow.test.ts:187`、`:197` | `workflow.backfillActivityRange`；手写时间范围 | 第二次 cursor 使用第一次返回值；基础夹具和 legacy Run 写入另列 F3 | **v2 允许**，A1 签发字段条款 |
| `tests/app/S2B-r2-backfill-done-cursor.test.ts:164`、`:197`、`:204` | 回填 owner；手写范围，第一次 cursor 为 null | 实际运行通过 `tests/app/S2B-r2-backfill-done-cursor.test.ts:141`调用 `tests/helpers/S2B-runtime-steps-fixture.ts`；后页使用真实回填返回值 | **v2 允许**，A1；旧版直接 seed Run 的判断不能沿用 |
| `tests/app/RL-34-wiring-resource-caps.test.ts:196`、`:222` | `runtime.startRun`；手写 consumerId/requestId 包装 | prepared 分别来自同文件`:193`、`:218`的真实 `prepareExecution`；基础治理 seed 另列 F3 | **v2 允许**，A1 签发字段条款 |
| `tests/state/invariants.test.ts:388` | `runtime.startRun` | prepared 来自同文件`:386`；后续读取内部 invariant world，并非全公开；基础 matrix 另列 F3 | **v2 允许**，输入字段来源符合 A1 |
| `tests/app/S5-decision-routes.test.ts:227` | `decisions.queryDecisionQueue`；手写 workspace、sections、categories、limit | 真实 read owner 返回 displayToken 和 notice.position，同文件`:231`；不是测试自行签发 | **v2 允许**，A1 |
| `tests/app/S1-session-routes.test.ts:166` | 11 个 Session、Archive、Responsibility 等路由 owner；`bodyFor`给出空 `{}`，同文件`:110` | 方法被 recorder 替换并接受空参数，同文件`:157`、`:170`；不满足各真实分支的完整契约 | **F1**，v2`:30`—`:31` |
| `tests/app/S5-decision-routes.test.ts:137` | `plans.proposePlan`；手写 `draft:{}`，同文件`:135` | recorder 接受后继续断言，同文件`:132`、`:138`；没有通过真实 Plan 参数契约 | **F1**，v2`:30`—`:31` |
| `tests/app/change-emitters.test.ts:210`、`:249` | `collaboration.start`；部分 `prepared:{claim:{runRef}}`，且保留 `select_work`再塞入 operation，同文件`:60` | `advanceWork`替身忽略真实请求契约，同文件`:89`；prepared 不是公开 prepare 的返回值 | **F1**，v2`:30`—`:37` |
| `tests/app/S2B-be2-late-evidence-activity.test.ts:181` | `runReconcile.resolveUnknownRun`；交入 `review/kernelTurnOpen/inputsConfirmed` | 值由内部 `readReviewDraftAtEntry`产生，同文件`:178`，再装入写入参数`:182`；并非公开 resolve 路由的外部输入形状，见 `src/app/core-routes.ts:342` | **F1**，v2`:36`—`:37` |
| `tests/state/invariants-fuzz.test.ts:81` → `tests/scenarios/support/fuzz.ts:1553` | `runtime.startRun`；重新组装 prepared | 原料虽然来自公开 execution read，仍把 claim/envelope/inputBinding 拼成新的 prepared，helper`:1546`、`:1554`；之后继续运行 | **F1**，v2`:32`—`:37` |
| `tests/state/invariants-fuzz.test.ts:81` → `tests/scenarios/support/fuzz.ts:1641` | `claims.requeueTask`；手工 `goal_resume` trigger | 从内部 world 的 Goal/ControlIntent 推出 epochs，helper`:1597`；`right`分支要求 committed，helper`:1674` | **F1**，v2`:32`—`:37` |

`tests/app/S5-decision-routes.test.ts:255`是拒绝用例：使用真实 token，但把真实 position 放入错误类别，输入见同文件`:253`。不能把它列成“测试伪造 token 后被接受”；其断言是否完整符合 A6 是另一个问题，依据 `.lead-ref/books/test-rule-sheet-v1.md:45`。

Record-store 自身测试。

| 范围 | 结论 |
|---|---|
| `.lead-ref/groups/L4-files.txt:1`、`:77`、`:122` | L4 是 `tests/app`、`tests/state`，没有 `tests/record-store/`文件；本节没有实例。例外边界见 `.lead-ref/books/test-rule-sheet-v2.md:38`。 |

F3：存储层以上的直接写入及实际调用链。

以下共享写入点在表内简称如下，所有简称都对应具体代码：

- **T**：`tests/helpers/task-claim-fixture.ts:367`直接创建 Kernel Session，`:370`登记 Session；默认构造调用位于`:376`、`:377`。
- **M**：`tests/helpers/B2-runtime-fixture.ts:204`通过 `commitRaw`写入手写 `CoordinationPolicyRevision`、`ProjectCoordinationPolicyActive`；入口转调位于 `tests/helpers/S2B-runtime-store-fixture.ts:75`。
- **A**：`tests/helpers/S2B-activity-fixture.ts:469`、`:498`、`:534`分别写 entered、terminal、RunActivity；`:543`开启活动记录。
- **S**：`tests/helpers/S5-decision-fixture.ts:604`直接创建 Kernel Session，`:851`写 entered；默认构造在`:893`调用 entered。
- **N**：`tests/helpers/S4A-note-fixture.ts:239`直接创建 Kernel Session，`:242`登记；`claimRun`在`:270`转调这条路径。

| L4 调用位置 | 实际写入及组外定义 | 到达范围、判定 |
|---|---|---|
| `tests/app/K3-15-review-routes.test.ts:74`、`:96`、`:128`、`:166` | T、S；`openK3ReviewCardWorld`调用 S5 夹具，见 `tests/helpers/K3-review-card-fixture.ts:149`；审查轮创建 Session 见 `tests/helpers/K3-proposal-round.ts:388` | 本文件；**F3** |
| `tests/app/RL-34-wiring-resource-caps.test.ts:89`、`:130`、`:205` | `tests/helpers/S2B-be1-platform-fixture.ts:208`手写治理 matrix；另有 T。局部 helper`:89`的调用者为本文件`:105`、`:182` | 本文件；**F3** |
| `tests/app/RL-34-wiring-resource-caps.test.ts:142` | R3e 夹具中的手写 entered/result，`tests/helpers/R3e-evidence-fixture.ts:252`、`:265`；另有 T | 本文件；**F3** |
| `tests/app/S2A-decision-routes.test.ts:52`、`:53` | T、S；`startRun`还通过 `tests/helpers/S2A-queue-fixture.ts:84`、`:86`创建 Session、写 entered | 本文件；**F3** |
| `tests/app/S2B-35-activity-routes.test.ts:125`、`:130`、`:132`、`:138` | T；`tests/helpers/S2B-track-fixture.ts:358`、`:392`、`:430`写 entered、terminal、活动事实；timeline 夹具转调 B2 见 `tests/helpers/S2B-task-timeline-fixture.ts:174` | 本文件；**F3** |
| `tests/app/S2B-41-decision54-backfill-bound.test.ts:144` | M、T | 本文件；**F3** |
| `tests/app/S2B-41-decision54-backfill-bound.test.ts:216`、`:226` | 直接 `closeOpenTurn`写 Kernel；随后用测试组装的 ready probe 记录 SessionHealth，参数见同文件`:227` | 本文件；**F3**；不是命名的 A7 `damageKernel` |
| `tests/app/S2B-backfill-host.test.ts:55`、`:66`、`:68`、`:69`、`:70`、`:71`、`:133`、`:135` | T、A；构造活动夹具的 B2 入口见 `tests/helpers/S2B-activity-fixture.ts:205` | 本文件；**F3** |
| `tests/app/S2B-backfill-workflow.test.ts:64`、`:107`、`:110`、`:111`、`:112`、`:113`、`:114`、`:172`、`:174`、`:175`、`:176`、`:222`、`:225`、`:226`、`:257`、`:279`、`:281`、`:283`、`:313`、`:314`、`:321`、`:323`、`:341`、`:344` | T、A；包含手写 entered、terminal、活动事实及记录起点 | 本文件；**F3** |
| `tests/app/S2B-backfill-workflow.test.ts:83` | `commitRaw`写手工 `RunSnapshot@1`，设为 ended/failed 且缺 executionHistory，内容见同文件`:75` | `commitLegacyRun`调用于同文件`:224`、`:343`；**F3** |
| `tests/app/S2B-be2-late-evidence-activity.test.ts:47` | M、T | 本文件；**F3** |
| `tests/app/S2B-be2-run09-activity.test.ts:38`、`:62` | M、T | 本文件；**F3** |
| `tests/app/S2B-be2-run18-activity.test.ts:35` | M、T | 本文件；**F3** |
| `tests/app/S2B-be2-run23-activity.test.ts:56` | M、T | 本文件；**F3** |
| `tests/app/S2B-be2-startup-reconcile-activity.test.ts:46`、`:81`、`:114`、`:149` | M、T | 本文件；**F3** |
| `tests/app/S2B-r2-backfill-done-cursor.test.ts:134`、`:136` | 默认 T；手动开启活动记录，定义见 A | 本文件；**F3**。本文件`:141`后的 Run 已走真实 runtimeSteps，不能继续报告旧的直接 Run seed |
| `tests/app/S2B-r2-backfill-identity.test.ts:56`、`:61`、`:63`、`:64` | T、A | 本文件；**F3** |
| `tests/app/S2B-r2-backfill-probe-first.test.ts:62` | M、T | 本文件；**F3** |
| `tests/app/S2B-r2-backfill-real-kernel.test.ts:77`、`:115` | `openKernelBackfillRuns`经 `tests/helpers/S2B-r2-backfill-kernel-support.ts:81`到达 M、T | 本文件；**F3** |
| `tests/app/S2B-r2-backfill-revision-race.test.ts:35`、`:49`、`:51`、`:52`、`:54`、`:62`、`:84`、`:86`、`:87`、`:88` | T、A；`:54`、`:62`、`:88`手工提供 RunActivityFacts | 本文件；**F3** |
| `tests/app/S2B-r2-r6-probe-verdicts.test.ts:36` | M、T | 本文件；**F3** |
| `tests/app/S2C-line-routes.test.ts:155`、`:156`、`:182`、`:203`、`:217`、`:231`、`:256`、`:276`、`:277` | T；手工 Session 登记见 `tests/helpers/S2C-L-line-support.ts:245`、`tests/helpers/S2C-P-pins-fixture.ts:109`；D1 还写 entered/terminal 等，调用见 `tests/helpers/S2C-L-line-support.ts:635`、`:645`、`:658`、`:675` | 本文件；**F3** |
| `tests/app/S4C-note-routes.test.ts:59`、`:93`、`:190` | N，经 `claimRun`到达 | 本文件；**F3** |
| `tests/app/S4C2-scribe-reminders.test.ts:77`、`:99`、`:203`、`:208`、`:249`、`:254`、`:524`、`:526`、`:722`、`:723`、`:797`、`:835`、`:861`、`:888`、`:903` | N，经 `createSession/claimRun`到达 | 本文件；**F3** |
| `tests/app/S4C2-scribe-reminders.test.ts:566` | 直接调用 Runtime 通常调用的 `messages.recordInputAccepted`；kernel 来自真实 inbox，同文件`:559`，但测试自己发出事实写入`:567` | 本文件；**F3**，依据 v1`:64`；不能误说 kernel 本身是伪造的 |
| `tests/app/S5-decision-routes.test.ts:168`、`:193` | T、S；`:193`直接 `recordRunResult`，手写 crashed event、position=4、terminal cursor，输入见同文件`:194` | 本文件；**F3** |
| `tests/app/S5R2-driver-safe-point.test.ts:28`、`:54` | T、S | 本文件；**F3** |
| `tests/app/S8A-architecture-routes.test.ts:63`、`:112` | `tests/work-graph/R3d-fixture.ts:85`直接提交手写 ProjectSnapshot、WorkspaceSnapshot 和 seed event，内容见同 helper`:79` | 本文件；**F3** |
| `tests/app/change-commit-observer.test.ts:119`、`:120`、`:121` | 直接把手写 partial Task/CoreOperation/坏 schema 批次交给 observed records port，内容见同文件`:114`；底层还返回手写 receipt，见`:95`、`:104` | 本文件；**F3**；上层 observer 测试不能使用 store 自测例外 |
| `tests/app/goal-fan-out-driver.test.ts:43` | T | 本文件；**F3** |
| `tests/app/orchestration-mechanism.test.ts:201` | C1 构造经 `tests/helpers/C1-mailbox-fixture.ts:92`到达 T | 本文件；**F3**。该调用不等于执行 C1 helper`:186`、`:199`的原始写入方法 |
| `tests/state/invariants-fuzz.test.ts:95`、`:97` | AgentFuzz 经 `tests/scenarios/support/fuzz.ts:2184`到 R3e/T；helper`:2337`、`:2466`直接写 entered、terminal、手写 position/cursor | 本文件；**F3** |
| `tests/state/invariants.test.ts:379` | `tests/helpers/C2-runtime-platform-fixture.ts:106`手写治理 matrix；另有 T | 本文件；**F3** |
| `tests/app/S8A-L8-capture-start.test.ts:101` | 收到的生产 `input`原样交给 `records.commit`；故障封装见同文件`:98`、`:102` | **v2 允许**，v1 A2/A3；不是手写记录 F3 |

另外，以下命中不能仅凭定义或导入算作 L4 已执行的直接写入：

- `tests/helpers/S5-decision-fixture.ts:544`的 `seedCommit`及`:1079`的 storeSnapshot probe，没有在本组发现对应调用；本组实际构造写入已经按 S、T 计入。
- `tests/helpers/C1-mailbox-fixture.ts:186`、`:199`是保留的原始写入方法；当前初始化改走`:141`、`:146`的真实运行链。
- `tests/helpers/S2C-L-runs-support.ts:420`的 answer body 写入不在 D1 路径中；D1 只调用 beginConsultationCopy，见 `tests/helpers/S2C-L-line-support.ts:670`。
- `tests/helpers/S2B-track-fixture.ts:613`的 query answer body 写入不在本组 `S2B-35`调用路径中；该文件实际调用的是 `tests/app/S2B-35-activity-routes.test.ts:130`、`:132`。

A7 命名 helper。

| 命名 helper | L4 结果及边界 |
|---|---|
| `buildNoteTools` | 本组及核到的调用链没有使用。允许范围仅为 adapter 测试，见 `.lead-ref/books/test-rule-sheet-v2.md:45`。本组的 note 夹具调用是 `tests/app/S4C-note-routes.test.ts:55`和 `tests/app/S4C2-scribe-reminders.test.ts:73`，不能套用该例外。 |
| `damageKernel` | 本组及核到的调用链没有使用。限定文件和用途见 `.lead-ref/books/test-rule-sheet-v2.md:50`。`tests/app/S2B-41-decision54-backfill-bound.test.ts:216`的 `closeOpenTurn`不属于此 helper。 |
| `process-sandbox-standin`的 `probe` | 本组及核到的调用链没有使用。`executeChecks:false`边界见 `.lead-ref/books/test-rule-sheet-v2.md:58`。`tests/app/RL-34-wiring-resource-caps.test.ts:29`调用的是另一个 `RL-kernel-sandbox-double`，不能据此记成 A7 范围内。 |

**无实例**：以下文件没有本题限定的公共 owner/tool 输入、直接记录写入或三个 A7 helper；这不表示它们通过 v1 的其他规则。

- `tests/app/A2-host-instance-lease.test.ts:15`
- `tests/app/A2-settings-automation.test.ts:20`
- `tests/app/A2-startup-redrive-select.test.ts:20`
- `tests/app/AG6-agent-assembly.test.ts:177`
- `tests/app/K3-19-review-capability-host.test.ts:112`（调用 `reviewCapability`；core 路由绑定的是 `capabilities`，见 `src/app/core-routes.ts:398`）
- `tests/app/R6-workbench.test.ts:24`
- `tests/app/RL-40-43-resource-cap-settings.test.ts:15`
- `tests/app/S3-attention-context.test.ts:307`
- `tests/app/change-feed.test.ts:8`
- `tests/app/change-stream.test.ts:13`
- `tests/app/goal-conversation-start.test.ts:24`
- `tests/app/session-rendering.test.ts:24`
- `tests/app/settings-ui.test.ts:25`
- `tests/app/ui-actions.test.ts:14`
- `tests/app/ui-change-refetch.test.ts:13`
- `tests/app/ui-live-wiring.test.ts:19`
- `tests/app/ui-live.test.ts:13`
- `tests/app/ui-refresh.test.ts:14`
- `tests/app/ui-sse.test.ts:9`
- `tests/app/ui-store.test.ts:17`
- `tests/state/K3-B3-crr-codec-rejects.test.ts:10`
- `tests/state/K3-B3-shared-rules-pure.test.ts:8`
- `tests/state/S1-anomaly.test.ts:25`
- `tests/state/S1-archive-rework.test.ts:15`
- `tests/state/S1-dispatch.test.ts:23`
- `tests/state/S1-message-routing.test.ts:16`
- `tests/state/S1-responsibility.test.ts:15`
- `tests/state/S1-session-archive.test.ts:20`
- `tests/state/S2C-line-status.test.ts:21`
- `tests/state/S5-decision-policy.test.ts:13`
- `tests/state/S5-goal-settings.test.ts:16`
- `tests/state/S5-message-decision.test.ts:12`
- `tests/state/S5-notice-settings.test.ts:15`
- `tests/state/S5-request-candidate.test.ts:18`
- `tests/state/S8A-L8-auto-capture-state.test.ts:21`
- `tests/state/WP1-goal-content.test.ts:13`
- `tests/state/WP2-positions.test.ts:19`
- `tests/state/attempt-machine.test.ts:25`
- `tests/state/command-normalization-pure.test.ts:11`
- `tests/state/command-normalization.test.ts:16`
- `tests/state/command-rerun-request-pure.test.ts:22`
- `tests/state/command-rerun-request-used-by.test.ts:17`
- `tests/state/command-rerun-request.test.ts:23`
- `tests/state/context-input.test.ts:14`
- `tests/state/control-intent-machine.test.ts:20`
- `tests/state/execution-entry-codecs-pure.test.ts:7`
- `tests/state/goal-machine.test.ts:22`
- `tests/state/invariants.ts:30`
- `tests/state/k3-failure-classification.test.ts:9`
- `tests/state/k3-review-claim.test.ts:11`
- `tests/state/k3-run-reconcile.test.ts:15`
- `tests/state/message-machine.test.ts:300`
- `tests/state/no-progress.test.ts:28`
- `tests/state/plan-machine.test.ts:19`
- `tests/state/query-run-recovery.test.ts:19`
- `tests/state/review-lease.test.ts:10`
- `tests/state/run-machine.test.ts:35`
- `tests/state/session-availability.test.ts:21`
- `tests/state/task-failure.test.ts:37`
- `tests/state/task-machine.test.ts:35`
- `tests/state/unknown-call-kinds.test.ts:15`
- `tests/state/unknown-call-review-streak.test.ts:10`
- `tests/state/unknown-call-review.test.ts:19`
- `tests/state/verification-machine.test.ts:30`

**存在公共入口，但尚未完成逐调用枚举**，不能放入“无实例”：

- `tests/app/A2-automation-verdict.test.ts:55`
- `tests/app/A2-continuation-projection.test.ts:49`
- `tests/app/A2-requeue-route.test.ts:65`
- `tests/app/A2-reverify-route.test.ts:71`
- `tests/app/A2-runtime-capabilities.test.ts:87`
- `tests/app/AG2-consultation.test.ts:284`
- `tests/app/AG2b-collaboration.test.ts:269`
- `tests/app/K-R-runtime-capabilities.test.ts:64`
- `tests/app/MVP-ui-entry.test.ts:130`
- `tests/app/MVP-workbench-tools.test.ts:88`、`:91`、`:112`（后两处 revision 来自直接 `WorkspaceSandbox.read`，来源见同文件`:87`、`:111`；尚未定案其是否符合 v2 的“真实公共步骤”边界）
- `tests/app/RL-33-workbench-resource-caps.test.ts:58`
- `tests/app/RL-44-host-restart-resource-caps.test.ts:107`
- `tests/app/S3-graph-routes.test.ts:134`、`:225`
- `tests/app/S8A-L8-auto-capture-gate.test.ts:235`
- `tests/app/S8A-L8-auto-capture-host.test.ts:45`
- `tests/app/S8A-L8-host-close-restart.test.ts:38`
- `tests/app/S8A-L8-host-restart.test.ts:87`
- `tests/app/S8A-L8-http-watermark.test.ts:71`
- `tests/app/exploration-tools.test.ts:31`
- `tests/app/host-settings.test.ts:326`
- `tests/app/project-source-tool.test.ts:164`
- `tests/app/reviewer-source-tools.test.ts:44`
- `tests/app/support/S8A-L8-host.ts:181`

前面已有裁定行的文件也不代表 A1 已列尽。例如 `tests/app/R6-host.test.ts:482`的消息输入、`tests/app/S4C2-scribe-reminders.test.ts:685`的消息输入，以及 `tests/state/invariants-fuzz.test.ts:81`、`:97`进入的完整组外公共调用集合，尚未逐条展开。另有测试配置的 HTTP token 需统一裁定，位置包括 `tests/app/S2B-35-activity-routes.test.ts:52`、`tests/app/S3-graph-routes.test.ts:33`、`tests/app/S8A-architecture-routes.test.ts:29`；本次没有把这些未定案项计入 F1。

```json
[
  {"section":"A1","file":"tests/app/S0-attention-edge-label.test.ts","line":[166,174],"owner":"plans.proposePlan/applyPlanChange","value":"完整手写 PlanDraft；应用公开 proposal 返回值","verdict":"v2 允许","note":"草稿定义:138；公开 propose→apply"},
  {"section":"A1","file":"tests/app/R6-host.test.ts","line":[324,329],"owner":"plans.proposePlan/applyPlanChange","value":"手写 planDraft；proposal 引用和修订来自:326","verdict":"v2 允许","note":"后续公开读取:333"},
  {"section":"A1","file":"tests/app/R6-host.test.ts","line":[303,308],"owner":"completionPolicies","value":"手写策略内容；digest 来自安装结果:306","verdict":"v2 允许","note":"签发字段原样使用"},
  {"section":"A1","file":"tests/app/S0-attention-edge-label.test.ts","line":[102,111],"owner":"completionPolicies","value":"手写策略内容；安装返回的 digest","verdict":"v2 允许","note":"digest 使用位置:112"},
  {"section":"A1","file":"tests/app/S4C-note-routes.test.ts","line":[65,68,126,136,159,191],"owner":"notes.writeNote","value":"手写 NoteDraft；expectedPointerRevision=null","verdict":"v2 允许","note":"公开列表检查；夹具 Kernel 写入另列 F3"},
  {"section":"A1","file":"tests/app/S4C2-scribe-reminders.test.ts","line":[62,79,81,84,87,100,102,210,256,528,574,643,753,866],"owner":"notes.writeNote","value":"手写 general/understanding 注记","verdict":"v2 允许","note":"定义:47、53；helper tests/helpers/S4A-note-fixture.ts；后续非全公开"},
  {"section":"A1","file":"tests/app/S4C-record-note-host.test.ts","line":[141,204],"owner":"record_note","value":"脚本模型的手写工具参数","verdict":"v2 允许","note":"真实工作链；公开 notes/list 检查:175、231"},
  {"section":"A1","file":"tests/app/S2A-decision-routes.test.ts","line":[56],"owner":"decisionMessages.sendUserMessage","value":"文本、选项和对象","verdict":"v2 允许","note":"tests/helpers/S2A-queue-fixture.ts:67、70、73；基础夹具有 F3"},
  {"section":"A1","file":"tests/app/S2A-decision-routes.test.ts","line":[79,97,115],"owner":"decisions.queryDecisionQueue","value":"筛选、分页及真实前页 cursor","verdict":"v2 允许","note":"cursor 来源:89、107；基础夹具有 F3"},
  {"section":"A1","file":"tests/app/S2B-backfill-workflow.test.ts","line":[187,197],"owner":"workflow.backfillActivityRange","value":"手写范围；真实前页 nextCursor","verdict":"v2 允许","note":"后续非全公开，legacy Run 与夹具写入另列"},
  {"section":"A1","file":"tests/app/S2B-r2-backfill-done-cursor.test.ts","line":[164,197,204],"owner":"回填 owner","value":"范围、初始 null cursor、实际返回的后页 cursor","verdict":"v2 允许","note":"真实运行入口:141，tests/helpers/S2B-runtime-steps-fixture.ts"},
  {"section":"A1","file":"tests/app/RL-34-wiring-resource-caps.test.ts","line":[196,222],"owner":"runtime.startRun","value":"手写启动外壳；真实 prepared","verdict":"v2 允许","note":"prepare 来源:193、218；治理 seed 另列 F3"},
  {"section":"A1","file":"tests/state/invariants.test.ts","line":[388],"owner":"runtime.startRun","value":"真实 prepared 和手写启动标识","verdict":"v2 允许","note":"prepare 来源:386；后续内部 invariant 读取"},
  {"section":"A1","file":"tests/app/S5-decision-routes.test.ts","line":[227],"owner":"decisions.queryDecisionQueue","value":"手写 workspace、筛选、limit","verdict":"v2 允许","note":"真实 owner 返回 displayToken/position；:255 是类别不匹配拒绝"},
  {"section":"A1","file":"tests/app/S1-session-routes.test.ts","line":[166],"owner":"11 个 Session/Archive/Responsibility 路由 owner","value":"空 input={}","verdict":"F1","note":"bodyFor:110；recorder:157；违反 v2:30–31 完整契约"},
  {"section":"A1","file":"tests/app/S5-decision-routes.test.ts","line":[137],"owner":"plans.proposePlan","value":"draft:{}","verdict":"F1","note":"输入:135；recorder 接受；违反 v2:30–31"},
  {"section":"A1","file":"tests/app/change-emitters.test.ts","line":[210,249],"owner":"collaboration.start","value":"部分 prepared；select_work 混入 operation","verdict":"F1","note":"构造:60；替身:89；违反 v2:30–37"},
  {"section":"A1","file":"tests/app/S2B-be2-late-evidence-activity.test.ts","line":[181],"owner":"runReconcile.resolveUnknownRun","value":"内部派生 review/kernelTurnOpen/inputsConfirmed","verdict":"F1","note":"内部读取:178；输入:182；违反 v2:36–37"},
  {"section":"A1","file":"tests/state/invariants-fuzz.test.ts","line":[81],"owner":"runtime.startRun","value":"从 execution read 重拼 prepared","verdict":"F1","note":"tests/scenarios/support/fuzz.ts:1546、1553、1554；违反 v2:32–37"},
  {"section":"A1","file":"tests/state/invariants-fuzz.test.ts","line":[81],"owner":"claims.requeueTask","value":"从内部 world 重造 goal_resume trigger","verdict":"F1","note":"tests/scenarios/support/fuzz.ts:1597、1641、1674；right 分支接受"},
  {"section":"F3","file":"tests/app/K3-15-review-routes.test.ts","line":[74,96,128,166],"owner":"KernelStore/entry","value":"Kernel Session 和 entered","verdict":"F3","note":"tests/helpers/task-claim-fixture.ts:367；tests/helpers/S5-decision-fixture.ts:604、851；tests/helpers/K3-proposal-round.ts:388"},
  {"section":"F3","file":"tests/app/RL-34-wiring-resource-caps.test.ts","line":[89,130,205],"owner":"commitRaw/KernelStore","value":"治理 matrix、Kernel Session","verdict":"F3","note":"tests/helpers/S2B-be1-platform-fixture.ts:208；tests/helpers/task-claim-fixture.ts:367；局部 helper 调用于:105、182"},
  {"section":"F3","file":"tests/app/RL-34-wiring-resource-caps.test.ts","line":[142],"owner":"R3e/B2 entry","value":"Kernel Session、entered、Run result","verdict":"F3","note":"tests/helpers/R3e-evidence-fixture.ts:252、265；tests/helpers/task-claim-fixture.ts:367"},
  {"section":"F3","file":"tests/app/S2A-decision-routes.test.ts","line":[52,53],"owner":"S5 entry/KernelStore","value":"Kernel Session、entered","verdict":"F3","note":"tests/helpers/S5-decision-fixture.ts:604、851；tests/helpers/S2A-queue-fixture.ts:84、86"},
  {"section":"F3","file":"tests/app/S2B-35-activity-routes.test.ts","line":[125,130,132,138],"owner":"entry/activity/KernelStore","value":"Kernel Session、entered、terminal、RunActivityFacts","verdict":"F3","note":"tests/helpers/S2B-track-fixture.ts:358、392、430；tests/helpers/S2B-task-timeline-fixture.ts:174"},
  {"section":"F3","file":"tests/app/S2B-41-decision54-backfill-bound.test.ts","line":[144],"owner":"commitRaw/KernelStore","value":"治理 matrix、Kernel Session","verdict":"F3","note":"tests/helpers/S2B-runtime-store-fixture.ts:75→tests/helpers/B2-runtime-fixture.ts:204；tests/helpers/task-claim-fixture.ts:367"},
  {"section":"F3","file":"tests/app/S2B-41-decision54-backfill-bound.test.ts","line":[216,226],"owner":"KernelStore/sessionHealth","value":"关闭 Kernel turn、记录测试组装的 ready probe","verdict":"F3","note":"直接写入；不是 A7 damageKernel"},
  {"section":"F3","file":"tests/app/S2B-backfill-host.test.ts","line":[55,66,68,69,70,71,133,135],"owner":"S2BActivityFixture/KernelStore","value":"Kernel Session、entered、terminal","verdict":"F3","note":"tests/helpers/S2B-activity-fixture.ts:205、469、498；tests/helpers/task-claim-fixture.ts:367"},
  {"section":"F3","file":"tests/app/S2B-backfill-workflow.test.ts","line":[64,107,110,111,112,113,114,172,174,175,176,222,225,226,257,279,281,283,313,314,321,323,341,344],"owner":"S2BActivityFixture/KernelStore","value":"Kernel Session、entered、terminal、活动事实和记录起点","verdict":"F3","note":"tests/helpers/S2B-activity-fixture.ts:469、498、534、543；tests/helpers/task-claim-fixture.ts:367"},
  {"section":"F3","file":"tests/app/S2B-backfill-workflow.test.ts","line":[83],"owner":"commitRaw","value":"手写 ended/failed RunSnapshot@1，缺 executionHistory","verdict":"F3","note":"内容:75；调用者:224、343"},
  {"section":"F3","file":"tests/app/S2B-be2-late-evidence-activity.test.ts","line":[47],"owner":"commitRaw/KernelStore","value":"治理 matrix、Kernel Session","verdict":"F3","note":"tests/helpers/B2-runtime-fixture.ts:204；tests/helpers/task-claim-fixture.ts:367"},
  {"section":"F3","file":"tests/app/S2B-be2-run09-activity.test.ts","line":[38,62],"owner":"commitRaw/KernelStore","value":"治理 matrix、Kernel Session","verdict":"F3","note":"tests/helpers/B2-runtime-fixture.ts:204；tests/helpers/task-claim-fixture.ts:367"},
  {"section":"F3","file":"tests/app/S2B-be2-run18-activity.test.ts","line":[35],"owner":"commitRaw/KernelStore","value":"治理 matrix、Kernel Session","verdict":"F3","note":"tests/helpers/B2-runtime-fixture.ts:204；tests/helpers/task-claim-fixture.ts:367"},
  {"section":"F3","file":"tests/app/S2B-be2-run23-activity.test.ts","line":[56],"owner":"commitRaw/KernelStore","value":"治理 matrix、Kernel Session","verdict":"F3","note":"tests/helpers/B2-runtime-fixture.ts:204；tests/helpers/task-claim-fixture.ts:367"},
  {"section":"F3","file":"tests/app/S2B-be2-startup-reconcile-activity.test.ts","line":[46,81,114,149],"owner":"commitRaw/KernelStore","value":"治理 matrix、Kernel Session","verdict":"F3","note":"tests/helpers/B2-runtime-fixture.ts:204；tests/helpers/task-claim-fixture.ts:367"},
  {"section":"F3","file":"tests/app/S2B-r2-backfill-done-cursor.test.ts","line":[134,136],"owner":"KernelStore/activity","value":"默认 Kernel Session、手动开启活动记录","verdict":"F3","note":"tests/helpers/task-claim-fixture.ts:367；tests/helpers/S2B-activity-fixture.ts:543；Run 本身已改走真实 runtime"},
  {"section":"F3","file":"tests/app/S2B-r2-backfill-identity.test.ts","line":[56,61,63,64],"owner":"S2BActivityFixture/KernelStore","value":"Kernel Session、entered、terminal、记录起点","verdict":"F3","note":"tests/helpers/S2B-activity-fixture.ts:469、498、543；tests/helpers/task-claim-fixture.ts:367"},
  {"section":"F3","file":"tests/app/S2B-r2-backfill-probe-first.test.ts","line":[62],"owner":"commitRaw/KernelStore","value":"治理 matrix、Kernel Session","verdict":"F3","note":"tests/helpers/B2-runtime-fixture.ts:204；tests/helpers/task-claim-fixture.ts:367"},
  {"section":"F3","file":"tests/app/S2B-r2-backfill-real-kernel.test.ts","line":[77,115],"owner":"openKernelBackfillRuns/commitRaw","value":"治理 matrix、Kernel Session","verdict":"F3","note":"tests/helpers/S2B-r2-backfill-kernel-support.ts:81→tests/helpers/B2-runtime-fixture.ts:204；tests/helpers/task-claim-fixture.ts:367"},
  {"section":"F3","file":"tests/app/S2B-r2-backfill-revision-race.test.ts","line":[35,49,51,52,54,62,84,86,87,88],"owner":"S2BActivityFixture/KernelStore","value":"Kernel Session、entered、terminal、手写活动事实","verdict":"F3","note":"tests/helpers/S2B-activity-fixture.ts:469、498、534、543；tests/helpers/task-claim-fixture.ts:367"},
  {"section":"F3","file":"tests/app/S2B-r2-r6-probe-verdicts.test.ts","line":[36],"owner":"commitRaw/KernelStore","value":"治理 matrix、Kernel Session","verdict":"F3","note":"tests/helpers/B2-runtime-fixture.ts:204；tests/helpers/task-claim-fixture.ts:367"},
  {"section":"F3","file":"tests/app/S2C-line-routes.test.ts","line":[155,156,182,203,217,231,256,276,277],"owner":"Session/entry/control writers","value":"Kernel Session、Session 登记、entered/terminal/退休/控制观察","verdict":"F3","note":"tests/helpers/S2C-L-line-support.ts:245、635、645、658、675；tests/helpers/S2C-P-pins-fixture.ts:109；tests/helpers/task-claim-fixture.ts:367"},
  {"section":"F3","file":"tests/app/S4C-note-routes.test.ts","line":[59,93,190],"owner":"S4ANoteFixture.claimRun","value":"直接 Kernel Session 创建和登记","verdict":"F3","note":"tests/helpers/S4A-note-fixture.ts:270→239、242"},
  {"section":"F3","file":"tests/app/S4C2-scribe-reminders.test.ts","line":[77,99,203,208,249,254,524,526,722,723,797,835,861,888,903],"owner":"S4ANoteFixture.createSession/claimRun","value":"直接 Kernel Session 创建和登记","verdict":"F3","note":"tests/helpers/S4A-note-fixture.ts:239、242"},
  {"section":"F3","file":"tests/app/S4C2-scribe-reminders.test.ts","line":[566],"owner":"messages.recordInputAccepted","value":"测试重放 accepted 事实写入","verdict":"F3","note":"kernel 来自真实 inbox:559；Runtime writer 的调用不因值真实而变成公共步骤"},
  {"section":"F3","file":"tests/app/S5-decision-routes.test.ts","line":[168,193],"owner":"S5 fixture/recordRunResult","value":"Kernel Session、entered、手写 crashed event/position/cursor","verdict":"F3","note":"tests/helpers/S5-decision-fixture.ts:604、851；测试事件输入:194"},
  {"section":"F3","file":"tests/app/S5R2-driver-safe-point.test.ts","line":[28,54],"owner":"S5 fixture/KernelStore","value":"Kernel Session、默认 entered","verdict":"F3","note":"tests/helpers/S5-decision-fixture.ts:604、851；tests/helpers/task-claim-fixture.ts:367"},
  {"section":"F3","file":"tests/app/S8A-architecture-routes.test.ts","line":[63,112],"owner":"R3d fixture/records.commit","value":"手写 ProjectSnapshot、WorkspaceSnapshot、seed event","verdict":"F3","note":"tests/work-graph/R3d-fixture.ts:79、85"},
  {"section":"F3","file":"tests/app/change-commit-observer.test.ts","line":[119,120,121],"owner":"observed.records.commit","value":"手写 partial Task/CoreOperation/坏 schema 记录批次","verdict":"F3","note":"内容:114；手写底层 receipt:95、104；不是 store 自测"},
  {"section":"F3","file":"tests/app/goal-fan-out-driver.test.ts","line":[43],"owner":"createTaskClaimFixture/KernelStore","value":"直接 Kernel Session 创建和登记","verdict":"F3","note":"tests/helpers/task-claim-fixture.ts:367、370"},
  {"section":"F3","file":"tests/app/orchestration-mechanism.test.ts","line":[201],"owner":"createC1Harness/KernelStore","value":"默认 Kernel Session 创建和登记","verdict":"F3","note":"tests/helpers/C1-mailbox-fixture.ts:92；tests/helpers/task-claim-fixture.ts:367；未调用 C1 原始 commit 方法"},
  {"section":"F3","file":"tests/state/invariants-fuzz.test.ts","line":[95,97],"owner":"AgentFuzz/R3e/entry","value":"Kernel Session、手写 entered/terminal/position/cursor","verdict":"F3","note":"tests/scenarios/support/fuzz.ts:2184、2337、2466；tests/helpers/R3e-evidence-fixture.ts:252、265"},
  {"section":"F3","file":"tests/state/invariants.test.ts","line":[379],"owner":"createC2RuntimePlatform/commitRaw","value":"治理 matrix、Kernel Session","verdict":"F3","note":"tests/helpers/C2-runtime-platform-fixture.ts:106；tests/helpers/task-claim-fixture.ts:367"},
  {"section":"F3核对","file":"tests/app/S8A-L8-capture-start.test.ts","line":[101],"owner":"records.commit","value":"生产 input 原样转发","verdict":"v2 允许","note":"故障封装:98、102；A2/A3"}
]
```

v2 允许 15，F1 6，F3 33，A7 越界 0，文件 122/122；枚举不完整：A1 尚缺逐调用展开及部分签发字段边界裁定，不能据此冻结完整实例清单。