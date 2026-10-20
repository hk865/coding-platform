本次仅静态读取，未写文件，未运行测试或构建。112 行均已列出；其中 **2 行待定，不建议据此删除**。本批全部属于 C 组，A 专列统一不适用（`lists/list-C1.tsv:2` 至 `lists/list-C1.tsv:113`）。

路径列相对于 `D:/cxt/t-docs/tree/src/core/work-graph/`；证据中的源码文件名均指 after-T 快照。测试路径相对于 `D:/cxt/t-docs/tree/`。

表内故障缝缩写如下；涉及扩展故障开关的内容均为建议：

- **R**：包装真实 backend 的 `readMany/lookup`，在指定读取返回失败；已有模式见 `tests/helpers/S4A-note-fault-fixture.ts:78`、`:87`。抛异常模式见 `tests/business/K3-44-crr-recovery.test.ts:89`。
- **C**：复用真实 `commit` 包装缝，增加提交失败、提交后丢响应或并发屏障；已有屏障见 `tests/work-graph/S5-goal-settings.test.ts:491`。
- **K**：真实 claim／prepare／start 后，通过 Host reconcile 和 Kernel 故障缝推进；见 `tests/helpers/K3-35-continuation-fixture.ts:274`、`tests/helpers/S2B-be2-reconcile-support.ts:202`。
- **B**：包装 Artifact body port 的 `put/read`；已有缝见 `tests/data/R3b-material-admission-boundaries.test.ts:34`、`:56`。
- **M**：脚本模型返回错误正文或抛错；已有缝见 `tests/helpers/B2-runtime-fixture.ts:71`。

**逐行裁定**

| row | path:line_after | kind | class | 理由及证据 | 建议 |
|---|---|---|---|---|---|
| C1-001 | configuration/project-bootstrap-service.ts:96 | function | F | Store 故障及提交结果不明会调用此函数，并非只有坏记录；`project-bootstrap-service.ts:116`、`:387`。 | `createProject` 时用 R 返回 unavailable；保留函数，补故障用例。 |
| C1-002 | configuration/project-bootstrap-service.ts:99 | function | F | 提交抛错后，回执查询再次失败会格式化异常；`project-bootstrap-service.ts:388`。 | `createProject`→C 丢响应→回执查询抛错；补 `tests/work-graph/R5a-project-bootstrap.test.ts:116`。 |
| C1-003 | configuration/project-bootstrap-service.ts:1048 | function | G | 已接公开 `completion-policies/read` 路由；`src/app/core-routes.ts:1056`。 | createProject→installCompletionPolicy→activateCompletionPolicy→readCurrentCompletionPolicy；补 `tests/work-graph/R5a-project-bootstrap.test.ts:231`。 |
| C1-004 | configuration/project-bootstrap-service.ts:1142 | function | G | 这是上一行公开 owner 的转发入口；`project-bootstrap-service.ts:1142`、`src/composition/create-platform.ts:1309`。 | 用 C1-003 的公开读取同时覆盖；测试归属同上。 |
| C1-005 | materials/material-service.ts:300 | function | F | body `put` 返回失败时进入错误映射；`material-service.ts:71`、`:79`。 | 合法 `storeArtifact`→B 的 put 返回 unavailable；补 `tests/data/R3b-material-admission-boundaries.test.ts:34`。 |
| C1-006 | materials/material-service.ts:313 | function | F | body put/read 抛异常会进入；`material-service.ts:76`、`:88`。 | 合法 storeArtifact/readArtifact→B 抛 IO 异常；测试归属同上。 |
| C1-007 | persistence/decision-record-codecs.ts:203 | function | 待定 | 通用 pin 校验确有调用，但尚未证实当前 owner 会生成 **SessionWorkLink pin**；`decision-record-codecs.ts:192`、`message-record-codecs.ts:384`。消息入口还要求建立 Workspace 归属，不能仅凭 ref 类型认定可达；`mailbox-service.ts:1637`。 | 暂不删。需穷尽 decision source/proof 的 pin 写入者，找到真实 SessionWorkLink pin 链，或证明所有写入者排除此类型。 |
| C1-008 | persistence/decision-record-codecs.ts:213 | function | 待定 | 依赖 C1-007 被实际调用且 target 已通过前置形状检查；`decision-record-codecs.ts:212`。 | 与 C1-007 同一待定项；找到合法 pin 链即可覆盖此回调，不应先造坏库。 |
| C1-009 | persistence/execution-entry-codecs.ts:140 | function | D2 | 当前准备者只写空 `materialAccessRefs`，循环没有元素；`src/core/agent-runtime/execution-preparation.ts:532`、`:595`；调用点 `execution-entry-codecs.ts:175`。 | 删元素校验函数及对应遍历；字段若仍属当前契约，保留其数组形状约束。 |
| C1-010 | persistence/execution-entry-codecs.ts:148 | function | D2 | 同一准备者只写空 `deliveryRefs`；`src/core/agent-runtime/execution-preparation.ts:532`、`:595`；调用点 `execution-entry-codecs.ts:180`。 | 删元素校验函数及遍历，不以旧记录补测试。 |
| C1-011 | persistence/plan-record-codecs.ts:546 | function | G | 当前 Plan 接受非空 hierarchy，且有成员与环校验；`plan-validation.ts:129`、`:150`。 | proposePlan 提交两个真实 Task 的父子边→applyPlanChange→读 Plan；补 `tests/work-graph/R3c-plan-adoption.test.ts:180` 所在文件。 |
| C1-012 | persistence/read-result-failures.ts:124 | function | F | owner 读取返回 StoreFailure 时调用；`owner-record-read.ts:34`。 | 公开生成 CRR→readRequest，R 在该记录读取返回 unavailable；保留映射。 |
| C1-013 | state/attempt-machine.ts:323 | function | F | Entering 状态经 unknown reconcile，且 Kernel 已有 Turn，走 ATT-34；`attempt-machine.ts:903`、`:909`。 | claim→prepare→start；C 使 entered 写未落账、Kernel 已启动→K 接管未决调用；核对 outbox 转 entered。 |
| C1-014 | state/context-input.ts:335 | function | G | 至少两个 Artifact selections 时排序比较器执行；`context-input.ts:330`、`:337`。 | 公开存两个 Artifact→采用含两个 inputRequirements 的 Plan→prepare；扩展 `tests/work-graph/S3-context-inputs.test.ts:961`。 |
| C1-015 | state/goal-settings-machine.ts:75 | function | G | 多个 risk 或多个交集模块/文件会比较文本；`goal-settings-machine.ts:105`、`:283`、`:286`。 | 建两个有至少两个共同模块的 Goal→查询冲突；补 `tests/work-graph/S5-goal-settings.test.ts:356` 所在文件。 |
| C1-016 | state/goal-settings-machine.ts:104 | function | G | 两条以上 parallelRisks 的 basis 比较会排序；`goal-settings-machine.ts:261`。 | 连续接受同一 Goal 与另外两个 Goal 的并行风险→保存决定→暂停/恢复→应用决定；补 `tests/work-graph/S5-goal-settings.test.ts:650`。 |
| C1-017 | state/goal-settings-machine.ts:223 | function | G | 已有 risk 时再接受风险会执行 filter；`goal-settings-machine.ts:218`、`:224`。 | 先接受 A/B 风险，再接受 B/C 风险或更新 A/B 风险；补 `tests/work-graph/S5-goal-settings.test.ts:356`。 |
| C1-018 | state/goal-settings-machine.ts:283 | function | G | 两个以上公共模块使交集排序回调执行；`goal-settings-machine.ts:280`。 | 两个 Goal 的公开 Plan 均关联两个相同模块→读冲突；补 `tests/work-graph/S5-goal-settings.test.ts:356` 所在文件。 |
| C1-019 | state/line-status.ts:223 | function | F | 自动 requeue 后尚 pending/ready，仍展示原 run/check 失败计数；`line-status.ts:199`、`:201`。 | M 使 Run 失败→系统 automaticRequeue→下一次 claim 前读工作线；扩展 `tests/scenarios/A11-no-progress.test.ts:1`。 |
| C1-020 | state/no-progress.ts:348 | function | D2 | 仅在相同 checkId 的排序比较中调用；`no-progress.ts:343`。生产验证计划按 checkId 的 Map 去重；`verification-plan.ts:76`、`:98`。 | 删 keyFact 及同 id 的二级比较，排序只比较 checkId。 |
| C1-021 | state/plan-machine.ts:877 | function | D2 | 最终 transition 使用完整事实；服务为 request 分支填充 requestCandidate；`plan-service.ts:1376`、`:2437`、`:3314`。缺事实兜底针对破坏内部调用契约；`plan-machine.ts:876`。 | 删最终 transition 的 incompleteFacts 兜底并收紧相应上下文类型；保留分阶段 guard 的 UNREAD 机制。 |
| C1-022 | state/ref-equality.ts:7 | function | D2 | 当前调用比较 Session/Run/anchor refs 或无数组的 wait identity；`session-anomaly.ts:64`、`session-availability.ts:127`、`:500`。 | 删数组递归分支，收窄 helper 的输入用途；不补任意 JSON 数组测试。 |
| C1-023 | state/run-machine.ts:2132 | function | F | 接管暂停停止时，要结算排队 steer；`run-machine.ts:2131`、`:2139`。 | start→submitControl(steer)→pause/cancel→Host 崩溃接管；用 K 保留真实 Kernel 接受记录，核对 steers 的结算。 |
| C1-024 | tasks/claim-service.ts:142 | function | F | claim 的 Goal/Plan 等读取失败会调用；`claim-service.ts:917`、`:971`。 | 建 Goal/Plan/Session→claimTask；R 在 Goal/Plan 读取返回失败。 |
| C1-025 | tasks/claim-service.ts:147 | function | F | Role facts 的非 ready 结果会调用；`claim-service.ts:1162`、`:1166`。 | 合法 claimTask；R 定点使 Role policy/spec 读取失败，不能改 Role 记录。 |
| C1-026 | tasks/claim-service.ts:684 | function | G | 首次 claim 可传与当前 matrix pin 不符的 binding，resolver 返回 inadmissible；`role-memory-service.ts:707`、`:709`。不需要运行中热切换。 | 安装当前 Role/matrix→建 Plan/Session→claimTask 使用不匹配 revision；补 `tests/work-graph/R4c-task-claim-boundaries.test.ts:118`。 |
| C1-027 | tasks/command-rerun-request-service.ts:178 | function | D2 | 正式装配总传 now；`src/composition/create-platform.ts:784`、`:798`。 | 删默认时钟回调，将依赖改为必填。 |
| C1-028 | tasks/command-rerun-request-service.ts:180 | function | D2 | 正式装配总传 randomUUID；`src/composition/create-platform.ts:798`。 | 删默认序号 id 回调及 eventSeq，依赖必填。 |
| C1-029 | tasks/command-rerun-request-service.ts:187 | function | F | readOwnerRecord 捕获真实读取异常后调用；`owner-record-read.ts:30`、`:32`。 | 公开 requestRerun→readRequest；R 对 CRR 的 readMany 抛错。 |
| C1-030 | tasks/command-rerun-request-service.ts:188 | function | U | 只在已存 CRR 解码失败后调用，普通 IO 失败走另一出口；`owner-record-read.ts:34`、`:38`。 | 保留未测：保持坏记录与不存在的区别；不恢复篡改测试（`AGENTS.md:33`）。 |
| C1-031 | tasks/command-rerun-request-service.ts:1184 | function | F | 已接 Runtime 工具提交恢复分派；`src/composition/create-platform.ts:1935`、`:1937`。 | 真 Run 调 request_command_rerun→C 在提交后丢响应→K 恢复，确认由原 receipt 判断工具是否提交。 |
| C1-032 | tasks/completion.ts:96 | function | G | 公开 completeTask 的对象、ref、expected 错误可触发；`completion.ts:241`、`:273`。 | 合法 Goal 上调用 completeTask，缺少必要 expected pin；补 `tests/work-graph/R3e-completion.test.ts:36` 所在文件。 |
| C1-033 | tasks/completion.ts:97 | function | G | 跨 project/workspace 请求直接拒绝；`completion.ts:288`、`:290`。 | 以 workspace A 的 context 完成 B 的任务；测试归属同上。 |
| C1-034 | tasks/completion.ts:98 | function | G | 精确读取请求指向的不存在记录返回 not_found；`completion.ts:223`。 | 真实 Task/Run 后，completeTask 指向不存在的 round；补 `tests/work-graph/R3e-completion.test.ts:36` 所在文件。 |
| C1-035 | tasks/completion.ts:99 | function | G | 请求的 taskId 不属于当前有效 Plan 时返回 incomplete；`completion.ts:334`、`:336`。 | 采用 Plan→用正确 Goal/Plan pins、未知 taskId 调 completeTask；测试归属同上。 |
| C1-036 | tasks/completion.ts:100 | function | F | 精确读抛异常会触发；`completion.ts:218`、`:219`。 | 真实完成链→completeTask；R 在所需 round 读取抛 IO 异常。 |
| C1-037 | tasks/completion.ts:101 | function | F | 调用前或提交前取消可触发；`completion.ts:315`、`:472`。 | 合法 completeTask 携带已取消 signal，或 R 屏障期间 abort；补 `tests/work-graph/R3e-completion.test.ts:36` 所在文件。 |
| C1-038 | tasks/completion.ts:102 | function | F | 读取及回执查询异常文本路径；`completion.ts:181`、`:219`。 | 使用 C1-036 的 R 故障同时覆盖。 |
| C1-039 | tasks/completion.ts:104 | function | G | 不存在的 Goal 由 readGoal 拒绝，再映射；`completion.ts:317`、`:318`。 | completeTask 请求不存在的 Goal，保持输入与 pins 形状合法；补 `tests/work-graph/R3e-completion.test.ts:36` 所在文件。 |
| C1-040 | tasks/completion.ts:199 | function | F | completeTask/Goal 的 commit 抛错后进入恢复；`completion.ts:482`、`:617`。 | 真实验证完成链→completeTask；C 分别模拟提交前失败、提交成功后丢响应，核对恢复结果。 |
| C1-041 | tasks/context-input-service.ts:334 | function | G | claim Plan 与后来 active Plan 不同，但 Task 定义沿用时，会遍历旧 Plan tasks；`context-input-service.ts:325`、`:330`。 | claim A→公开采用仅改 B 的未来 Plan→A readTaskInputs 指定新 active Plan；扩展 `tests/work-graph/W1-future-plan.test.ts:480`。 |
| C1-042 | tasks/context-input-service.ts:569 | function | G | gate-result 输入的上游可以是 work Task，需要定位其 canonical Run；`context-input-service.ts:555`、`:562`。 | 完成上游 work Run 并开验证轮→下游读 gate-result 输入；扩展 `tests/work-graph/S3-context-inputs.test.ts:990`。 |
| C1-043 | tasks/control-service.ts:112 | function | G | 公开读取不存在的 ControlIntent 可触发；`control-service.ts:434`、`:444`。 | readControl 指向同 scope 的未知 intentId；补 `tests/work-graph/A2-control-service.test.ts:68`。 |
| C1-044 | tasks/control-service.ts:486 | function | G | recordControlObservation 的同请求重放直接调用；`control-service.ts:843`。 | submitControl→取得真实 Kernel observation→两次提交同一 observation 请求；扩展 `tests/work-graph/A2-control-service.test.ts:386`。 |
| C1-045 | tasks/evidence-coverage.ts:50 | function | U | fallback 要求 Evidence 指定的来源 Plan 不含其 Task；`evidence-coverage.ts:163`。正常验证计划先拒绝这种关联；`verification-plan.ts:68`。 | 保留未测：现有 OUT_OF_SCOPE 路径避免把缺定义算 PASS；不造不一致 Evidence/Plan 记录。 |
| C1-046 | tasks/execution-entry-service.ts:136 | function | G | 请求未知 Run 的 admission read 返回 not_found；`execution-entry-service.ts:264`。 | 同 scope 调入口 owner，使用形状正确但不存在的 RunRef；补 `tests/work-graph/B2-execution-entry.test.ts:13`。 |
| C1-047 | tasks/execution-entry-service.ts:372 | function | D2 | 正式 Host configuration 的 materialBasis 固定 null，外层立即返回；`src/app/host.ts:297`、`execution-entry-service.ts:380`。 | 删 planRefProblem 及不可达的非空 materialBasis 校验链；同步收窄当前装配契约。 |
| C1-048 | tasks/execution-entry-service.ts:391 | function | D2 | 准备 manifest 的唯一正常赋值为空 materialAccessRefs；`src/core/agent-runtime/execution-preparation.ts:532`。 | 删元素校验函数及 `execution-entry-service.ts:461` 的遍历。 |
| C1-049 | tasks/execution-entry-service.ts:399 | function | D2 | 正常 manifest deliveryRefs 为空；`src/core/agent-runtime/execution-preparation.ts:532`。 | 删元素校验函数及 `execution-entry-service.ts:470` 的遍历。 |
| C1-050 | tasks/execution-entry-service.ts:521 | function | D2 | prepare 已拒绝 inadmissible Role，并裁剪 tools、校验 writeScope；`src/core/agent-runtime/execution-preparation.ts:359`、`:391`、`:398`。运行中 Role 热切换不属生命周期；`AGENTS.md:33`。 | 删该重复 inadmissible 分支及 map 回调；保留真正 Host grant 撤销路径。 |
| C1-051 | tasks/execution-entry-service.ts:817 | function | F | 重启 reconcile 的 terminal observation 可带非空 acceptedSteers；`src/core/agent-runtime/run-reconcile.ts:402`。 | start→提交并接受 steer→终止前 Host 崩溃→K reconcile terminal；核对接受过的 steer。 |
| C1-052 | tasks/execution-entry-service.ts:1751 | function | G | entered 的同请求 lookup 命中直接重放；`execution-entry-service.ts:1701`。 | 真 start 得到 entered 请求→原请求原样重发；扩展 `tests/work-graph/B2-execution-entry.test.ts:113`。 |
| C1-053 | tasks/execution-entry-service.ts:2089 | function | F | entry 的新 Goal/Plan 读取失败会调用；`execution-entry-service.ts:1425`、`:1460`。 | claim→prepare→authorizeRuntimeEntry；R 定点失败该阶段的 Goal/Plan 读取，避免更早读点先拒绝。 |
| C1-054 | tasks/execution-history-service.ts:83 | function | D2 | 唯一调用检查 not_ready，但 readExecution 未传 watermark options；`execution-history-service.ts:323`。无 atLeast 时恒满足；`run-state-service.ts:169`、`:425`。 | 删 helper 和此 not_ready 分支；此调用点用更窄返回类型。 |
| C1-055 | tasks/goal-control.ts:53 | function | F | 回执读取异常、提交结果未知会调用；`goal-control.ts:120`、`:223`。 | 建 Goal→setGoalControl；C 失败并令回执查询抛错，核对 unavailable。 |
| C1-056 | tasks/goal-control.ts:54 | function | F | 同一真实提交/回执异常链格式化文本；`goal-control.ts:120`、`:223`。 | 与 C1-055 共用故障用例；补 `tests/work-graph/A2-goal-control.test.ts:99`。 |
| C1-057 | tasks/goal-decision-reader.ts:89 | function | F | readGoalDecisionCauses 的 Goal 读失败即调用；`goal-decision-reader.ts:127`、`:129`、`:428`。 | 建 Goal→readGoalDecisionCauses；R 返回失败。 |
| C1-058 | tasks/goal-decision-reader.ts:92 | function | F | versioned object 或 task graph 读抛错会调用；`goal-decision-reader.ts:143`、`:215`。 | 建有 Plan 的 Goal→读决定原因；R 在相关对象读取抛错。 |
| C1-059 | tasks/goal-decision-reader.ts:368 | function | F | 暂停 Goal 的失败 gate 分支查询 covered Task phase；`goal-decision-reader.ts:364`、`state/decision-policy.ts:172`。 | 真检查失败→暂停 Goal，保留未完成的 required 修复 Task→读决定原因；故障命令模式见 `tests/work-graph/S3-context-inputs.test.ts:615`。 |
| C1-060 | tasks/goal-executed-files-reader.ts:48 | function | U | 该 helper 的调用全是已存 Goal/Run/Activity 解码失败；普通 StoreFailure 另行映射；`goal-executed-files-reader.ts:92`、`:100`、`:121`、`:140`、`:159`。 | 保留未测：明确报告损坏记录，避免误报空执行文件；不恢复改库测试。 |
| C1-061 | tasks/goal-settings-service.ts:83 | function | F | workspace Goal 枚举与读取失败可触发；`goal-settings-service.ts:251`、`:273`。 | 建多个 Goal→reorderGoals；R 使枚举失败。 |
| C1-062 | tasks/goal-settings-service.ts:85 | function | F | 同一枚举/读取及提交异常链使用；`goal-settings-service.ts:251`、`:328`。 | reorderGoals→R 抛错，或 C 丢响应；补 `tests/work-graph/S5-goal-settings.test.ts:491` 所在文件。 |
| C1-063 | tasks/goal-settings-service.ts:678 | function | G | conflict_order 应用允许控制变化后的具名 basis rebase；`goal-settings-service.ts:667`、`:681`。 | 保存 conflict_order 回答及 pins→暂停/恢复一个 Goal、内容不变→应用回答；扩展 `tests/work-graph/S5-goal-settings.test.ts:650` 的 rebase 系列。 |
| C1-064 | tasks/goal-settings-service.ts:828 | function | G | 同 Plan pair 已接受风险后，新身份重复应用会查已有 risk；`goal-settings-service.ts:823`、`:827`。 | 回答并应用 conflict_parallel→新 requestId 再应用同一有效回答；扩展 `tests/work-graph/S5-goal-settings.test.ts:356`。 |
| C1-065 | tasks/goal-settings-service.ts:829 | function | G | 找到已有 risk 后比较两侧 Plan pointer；`goal-settings-service.ts:831`。 | 与 C1-064 同一链，验证 receipt-only no-op 与 Plan pointer 保持不变。 |
| C1-066 | tasks/initial-plan.ts:41 | function | F | 当前模型也可能输出非 JSON、错误 schema 或不完整计划；`initial-plan.ts:57`、`:77`。不等于读旧数据库。 | 真实 initial-planning Query→M 返回坏 JSON→消费 Answer；补 `tests/work-graph/R5b-initial-plan.test.ts:189`。 |
| C1-067 | tasks/model-request-codecs.ts:73 | function | D2 | permit 复制 inputBinding.deliveryRefs，而当前准备者写空数组；`model-call-service.ts:148`、`src/core/agent-runtime/execution-preparation.ts:595`。 | 删 delivery 元素 helper 及遍历，保留当前 permit 外层校验。 |
| C1-068 | tasks/plan-service.ts:287 | function | F | Query Answer、Job/Run、body 读取可抛错；`plan-service.ts:1092`、`:1120`、`:1168`。 | 真 initial-planning Query 产 Answer→adoptInitialPlan；R 在 Answer/Job 读取抛错。 |
| C1-069 | tasks/plan-service.ts:712 | function | F | 同一读取返回 StoreFailure，或重放 eventAt 失败，进入映射；`plan-service.ts:672`、`:1093`。 | 重发已提交 proposePlan，令 R 扩展到 eventAt 返回 unavailable；保留映射。 |
| C1-070 | tasks/plan-service.ts:1034 | function | G | ready items 超过 page.limit 才编码下一页；`plan-service.ts:2061`、`:2063`。 | 采用至少两个可领取 work Task→queryReadyTasks(limit=1)；补 `tests/work-graph/R3c-plan-adoption.test.ts:180`。 |
| C1-071 | tasks/plan-service.ts:1037 | function | G | 使用返回的 cursor 续页便调用；`plan-service.ts:2021`。 | 续读 C1-070 返回的真实 cursor；同文件补测。 |
| C1-072 | tasks/plan-service.ts:1053 | function | G | 续页检查 role filter 一致性；`plan-service.ts:2027`。 | 首页携带 roleIds→以同 filter 续页，再以不同 filter 续页；补上述分页用例。 |
| C1-073 | tasks/plan-service.ts:1054 | function | G | 非空 roleIds 的续页比较执行 every 回调；`plan-service.ts:1054`、`:2027`。 | C1-072 的 roleIds 至少含一个真实角色；同文件补测。 |
| C1-074 | tasks/plan-service.ts:2050 | function | G | role filter 非空时遍历 assignments；`plan-service.ts:2049`。 | Plan 含不同角色的 work Task→queryReadyTasks 指定一个角色；补 `tests/work-graph/R3c-plan-adoption.test.ts:180`。 |
| C1-075 | tasks/plan-task-basis.ts:92 | function | G | 两个以上 inputRequirements 的定义比较需要排序；`plan-task-basis.ts:91`。这些是当前公开 Plan 字段；`plan-validation.ts:157`。 | 采用含两项输入的 Task→仅改另一 Task 的未来 Plan→apply；扩展 `tests/work-graph/W1-future-plan.test.ts:480`。 |
| C1-076 | tasks/plan-validation.ts:129 | function | G | 非空 hierarchy 的成员检查，公开 draft 可提供；`plan-validation.ts:129`。 | proposePlan 提交真实父子 Task 边，另加 dangling 输入拒绝例；补 `tests/work-graph/R3c-plan-adoption.test.ts:180` 所在文件。 |
| C1-077 | tasks/plan-validation.ts:150 | function | G | 非空 hierarchy 建图检查环；`plan-validation.ts:150`。 | 公开提交两 Task 成环的 draft，核对 hierarchy_cycle；测试归属同上。 |
| C1-078 | tasks/plan-validation.ts:296 | function | G | W1 draft 可显式携带 origin，随后与 source origin 比较；`plan-validation.ts:471`、`:473`。 | 公开初始规划采用有 origin 的 Plan→propose/apply 携带同 origin 的未来 draft；补 `tests/work-graph/W1-future-plan.test.ts:648`。 |
| C1-079 | tasks/plan-validation.ts:378 | function | G | 至少两项 dispositionChanges/carrierRemovals 会排序；`plan-validation.ts:373`、`:384`。 | 采用两个可撤销 optional future Task→一次变更两者 disposition→apply；补 `tests/work-graph/A2-disposition-change.test.ts:497`。 |
| C1-080 | tasks/plan-write-admission.ts:98 | function | F | 已 entered Run 的 Session 可经真实健康探测变 unavailable，命中 busy；`plan-write-admission.ts:308`、`sessions/session-health.ts:121`。 | entered Run→K 注入 Kernel probe 故障并观察健康→同 Run 新提案；核对 busy，不做 Role 热切换。 |
| C1-081 | tasks/plan-write-admission.ts:101 | function | D2 | Run/Attempt/outbox/Session 错配先被 readExecution 拒绝；`run-state-service.ts:230`、`:237`、`:242`、`:262`；这里重复核对见 `plan-write-admission.ts:195`、`:293`。 | 删重复关联及已解码 inputBinding 的 unavailable 兜底；使此 helper 随无调用删除。 |
| C1-082 | tasks/plan-write-admission.ts:104 | function | D2 | 两次 readExecution 均不带 atLeastCursor；`plan-write-admission.ts:191`、`:264`。无 watermark 请求不会 not_ready；`run-state-service.ts:169`。 | 删 incomplete helper 与 `mapReadFailure` 的 not_ready 分支，收窄此依赖返回类型。 |
| C1-083 | tasks/reconcile-intents.ts:82 | function | F | 读取 Run 指向的 intents 时，真实读取失败可触发；`reconcile-intents.ts:101`、`:102`。 | start→submitControl→Host reconcile；R 在 intents batch 返回失败。 |
| C1-084 | tasks/reconcile-reads.ts:47 | function | F | 候选扫描支持取消及 lookup 失败；`reconcile-reads.ts:59`、`:61`。 | 真实待 reconcile Run→扫描；预先 abort 或 R lookup 失败。 |
| C1-085 | tasks/request-facts-reader.ts:23 | function | F | QueryJob 读取抛错进入 messageOf；`request-facts-reader.ts:85`、`:87`。 | 真 submitQuery→proposePlan 携带 requestRef；R 在该 Job 的 readMany 抛错。 |
| C1-086 | tasks/request-facts-reader.ts:26 | function | D2 | 正常上游已限制 requestRef 的 project/workspace；`plan-service.ts:1477`、`:1483`、`:2319`。 | 删内部重复 forbidden 分支/helper；保留公开入口的 scope 拒绝。 |
| C1-087 | tasks/request-facts-reader.ts:29 | function | G | requestRef 形状和 scope 合法，不保证 Job 存在；`plan-service.ts:1330`、`request-facts-reader.ts:91`。 | 建 Goal→proposePlan 指定同 scope 不存在的 QueryJobRef；补 `tests/scenarios/S5-two-request-decisions.test.ts:1`。 |
| C1-088 | tasks/request-facts-reader.ts:32 | function | F | Job readMany 的异常或 StoreFailure 可触发；`request-facts-reader.ts:87`、`:89`。 | C1-085 的公开链，R 分别返回 unavailable、抛错。 |
| C1-089 | tasks/requeue-service.ts:196 | function | F | Workspace root 解析或 source capture 抛错会触发；`requeue-service.ts:669`、`:673`。 | 真结束 Run→requeueTask；在已有 resolveRoot/captureDigest 缝注入 IO 错误，见 `tests/work-graph/A2-requeue-service.test.ts:104`、`:109`。 |
| C1-090 | tasks/run-activity-service.ts:88 | function | G | 公开 activity 输入格式错误可触发；`run-activity-service.ts:334`、`:428`。 | ensureActivityRecording 缺 requestId，或 recordRunActivity 传错误 facts；补 `tests/work-graph/S2B-run-activity-read.test.ts:34` 所在文件。 |
| C1-091 | tasks/run-activity-service.ts:89 | function | F | Run/Activity 的 readMany 抛错会触发；`run-activity-service.ts:259`、`:271`。 | 真结束 Run→recordRunActivity；R 在 Run 读取抛错。 |
| C1-092 | tasks/run-activity-service.ts:90 | function | G | 正常公开调用的 scope 不匹配可触发；`run-activity-service.ts:435`。 | context A 调 ensureActivityRecording(workspace B)；补 `tests/work-graph/S2B-run-activity-read.test.ts:34` 所在文件。 |
| C1-093 | tasks/run-activity-service.ts:311 | function | G | recordRunActivity 的同身份重发会命中 receipt；`run-activity-service.ts:369`。 | 真结束 Run→recordRunActivity→原请求原样重发；测试归属同上。 |
| C1-094 | tasks/run-activity-service.ts:405 | function | F | 顺序重发被 existing 分支截获，但并发可在首次读后命中 peer receipt；`run-activity-service.ts:439`、`:445`、`:450`。 | 两个同身份 ensureActivityRecording；用 R/C 屏障让两者先读到不存在，再让一个提交、另一个 lookup/commit 重放。 |
| C1-095 | tasks/run-reconcile-service.ts:115 | function | G | Host owner 公开请求的 Run project/workspace 不匹配可触发；`run-reconcile-service.ts:790`、`:821`。 | 真实 Run A→用 scope B 调 reconcile owner；补 `tests/work-graph/K3-26-unknown-call-review-storage.test.ts:643`。 |
| C1-096 | tasks/run-reconcile-service.ts:119 | function | F | Session facts 或 continuation chain 的读取失败会触发；`run-reconcile-service.ts:421`、`:464`。 | 真 Run/续作链→K reconcile；R 在 Session facts 或链上 Run 读取返回失败。 |
| C1-097 | tasks/session-anomaly-service.ts:99 | function | F | anchor 索引 lookup 的真实 unavailable 会调用；`session-anomaly-service.ts:233`、`:237`。 | 建 Goal→listSessionAnomalies；R 对对应 anchor 索引返回 unavailable。 |
| C1-098 | tasks/session-anomaly-service.ts:100 | function | G | listSessionAnomalies 的页参数校验直接可达；`session-anomaly-service.ts:620`、`:623`。 | 合法 scope/Goal 下传 page.limit=0；补 `tests/work-graph/S1-anomaly-owner.test.ts:330`。 |
| C1-099 | tasks/session-anomaly-service.ts:101 | function | G | 合法数据也可超过有限扫描页数；上限与终止分支见 `session-anomaly-service.ts:83`、`:230`、`:244`。 | 经公开 Run→archive/anomaly 链累计超过 25 页 anchor，再读列表；归入 `tests/work-graph/S1-anomaly-owner.test.ts:330` 的容量边界。 |
| C1-100 | tasks/session-anomaly-service.ts:102 | function | G | list/read owner 请求未知 Goal 时会转发 readGoal 拒绝；`session-anomaly-service.ts:638`、`:690`。 | listSessionAnomalies 指定同 scope 不存在的 Goal；补 `tests/work-graph/S1-anomaly-owner.test.ts:330`。 |
| C1-101 | tasks/session-anomaly-service.ts:361 | function | D1 | 该适配对象仅交给 canonical facts reader，生产路径不调用 lookupCommit；`session-anomaly-service.ts:501`、`:699`，reader 位于 `plan-readers.ts:1610`。 | 删转发回调，并把 reader 依赖收窄到实际读取端口。 |
| C1-102 | tasks/session-anomaly-service.ts:362 | function | D1 | 同一只读适配路径没有 commit 调用；`session-anomaly-service.ts:501`、`:699`。 | 删 commit 转发；与 C1-101 一起收窄接口。 |
| C1-103 | tasks/session-anomaly-service.ts:363 | function | D1 | 同一只读适配路径没有 eventAt 调用；`session-anomaly-service.ts:501`、`:699`。 | 删 eventAt 转发；不为接口填充回调造测试。 |
| C1-104 | tasks/session-facts.ts:61 | function | F | Session/index/canonical 读取异常或失败会调用；`session-facts.ts:120`、`:137`、`:180`。 | 公开建 Session→调用 Session facts owner；R 在对应 readMany/lookup 返回失败。 |
| C1-105 | tasks/task-review-reader.ts:28 | function | F | 下层 listReviews 返回非 ready 时进入映射；`task-review-reader.ts:56`、`:64`。 | 真 blocked Run→resolveUnknownRun→requestRerun 的 Task reviews 读取；R 对 review 索引返回失败。 |
| C1-106 | tasks/task-service.ts:92 | function | G | createGoal 只先检查 objective 为字符串；空白字符串仍到结构验证并产生 issues；`task-service.ts:315`、`:170`，`src/contracts/validation/goal.ts:45`。 | createGoal 的 objective 传纯空白；补 `tests/work-graph/goal-independent.test.ts:61`。 |
| C1-107 | tasks/task-service.ts:93 | function | G | 上一行非空 issues 数组执行 map；`task-service.ts:171`、`:93`。 | 与 C1-106 同例，断言包含 objective 校验原因。 |
| C1-108 | tasks/unknown-call-review-service.ts:418 | function | D2 | 正式可写实例传 now；`src/composition/create-platform.ts:777`。未传的 reconcile 实例仅用于读取；`run-reconcile-service.ts:473`、`:486`。 | 删默认时钟；写依赖必填，或分离只读构造依赖。 |
| C1-109 | tasks/unknown-call-review-service.ts:420 | function | D2 | 可写实例传 eventId；无参数实例只读；证据同 C1-108。 | 删默认 eventSeq/id 回调及计数器。 |
| C1-110 | tasks/unknown-call-review-service.ts:425 | function | F | readOwnerRecord 捕获 Store 读取异常后调用；`owner-record-read.ts:32`。 | 真 unknown Run→resolveUnknownRun 生成 review→读取/操作该 review；R 对 review readMany 抛错。 |
| C1-111 | tasks/unknown-call-review-service.ts:426 | function | U | 仅已存 review 解码失败会调用；`owner-record-read.ts:37`、`:38`。 | 保留未测：继续区分损坏记录与不存在；不恢复篡改测试。 |
| C1-112 | tasks/unknown-call-review-service.ts:1321 | function | D2 | 非只读工具串行，真实未决 process 至多一个；`vendor/coding-agent/dist/tools/registry/tool-registry.js:142`、`tests/work-graph/K3-06-mixed-kinds-owner.test.ts:6`。proposal 按 callId 替换且已排序；`state/unknown-call-review.ts:337`。 | 删此重复 sort，直接 map 已有 proposals；不补多 process 存储夹具。 |

**分类计数**

以下计数对应上表全部 112 个 id；清单范围为 `lists/list-C1.tsv:2` 至 `lists/list-C1.tsv:113`。

| 类别 | 数量 |
|---|---:|
| D1 走不到 | 3 |
| D2 不会发生 | 19 |
| U 只有篡改才会发生 | 4 |
| F 外部故障 | 41 |
| G 公开步骤能到、没测 | 43 |
| N 不适用 | 0 |
| 待定 | 2 |
| **合计** | **112** |

**针对 T 的发现**

按本题限定的“**A 组可达行为因错误删除理由失去唯一测试**”口径，本批 **无可报告项**：112 行全部是 C 组，均属于前后未覆盖函数，不能据此认定 T 删除了最后一个测试（`lists/list-C1.tsv:2` 至 `lists/list-C1.tsv:113`；`ref/compare-summary.txt:10`）。

**与 L-2 的交集**

按**具体守卫位置**核对，直接交集为空；不能把同文件的其他回调算作该守卫（`ref/t-end-list.md:22`—`:25`）。

| L-2 点名项 | 本批交集 |
|---|---|
| provenNotEnteredKernel、plan-readers filter | 无；本批没有对应文件位置，清单见 `lists/list-C1.tsv:2` 至 `:113`。 |
| T1-062 的孤立 Lease/Reduction、未采用新增 Task 痕迹守卫 | 无；这些删除子项见 `D:/cxt/t-docs/evidence/books/t-items-T1-w2.md:452`，本批 plan-validation 回调位于 `plan-validation.ts:378`，不是这些读取守卫。 |
| physical-removal check | 无；守卫是 `plan-validation.ts:338`，本批该文件的函数行是 129、150、296、378（`lists/list-C1.tsv:77`—`:80`）。 |
| B-03 的 accepted request 原地改写复查 | 无；删除理由及归属见 `D:/cxt/t-docs/evidence/books/t-w1-findings.md:135`。 |
| T1-061 的多 process 子项守卫 | 无直接守卫交集；该子项删除见 `D:/cxt/t-docs/evidence/books/t-items-T2-w2.md:75`。**C1-112 为相关的 D2 排序回调**，使用同一单 process 不变量，但它不是原 settlement 守卫（`unknown-call-review-service.ts:1321`）。 |