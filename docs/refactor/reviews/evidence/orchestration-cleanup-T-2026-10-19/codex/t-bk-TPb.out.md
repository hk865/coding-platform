改完再施工

已按只读要求核对，未修改文件、运行测试或构建、执行 Git 写操作或访问网络。本机没有 `rg`，调用方检索使用了递归 `Select-String`。

以下问题不重新裁定清理方向；只指出施工指令与代码、规则表、保留断言或白名单之间的冲突。

**1. 需要修改的条目**

表中“规则表”指 `docs/refactor/reviews/evidence/codex-review-protocol-2026-10-18/test-rule-sheet-v1.md`。

| 编号 | 问题 | 证据（file:line） | 改法 |
|---|---|---|---|
| TP-089 | 合并目标新增“额外 seed 记录”参数，会把直接提交手写事实保留为共享接口，与 TP-088 的公开初始化及 A1、F3 冲突。 | `.lead-ref/books/t-items-TP.md:592`；`tests/helpers/S2A-notices-workspace2-fixture.ts:107`；规则表 `:24`、`:64` | 改为：“先完成 TP-086、TP-088，再合并。共享工厂仅接收 scope、ctx、任务 ID、计划 ID、可选任务 ID 和公开领取配置；删除额外 seed 记录参数。W2 的 Workspace 和策略由公开 owner 建立。” |
| TP-091 | 指定的 `runAndEnd + writeActivity` 仍写手造运行结果和活动事实；R9 的 `countedCounter` 也返回手造事实。与 TP-072 联动采用进入前取消，又不能保留 R9 的 `counted` 断言。另与 TP-156 对日历计数断言的处理不同。 | `tests/helpers/S2B-activity-fixture.ts:515`、`:543`；`tests/app/S2B-r2-backfill-done-cursor.test.ts:67`、`:95`、`:101`、`:108`、`:113`；`.lead-ref/books/t-items-TP.md:473`、`:606`、`:1062` | 改为：“R9 转换部分 BLOCKED。冻结替代流程前不得删除 helper：替代流程须以真实 Runtime/Kernel 历史建立 103 个任务的运行记录，以允许的依赖故障形成两个待回填对象，并用真实 `countRunActivity` 保留全部 counted、游标和 done 断言；不得使用 `writeActivity`、`countedCounter` 或进入前取消替代 counted 对象。2B-26 的剩余断言统一按 TP-156 重算并保留。” |
| TP-094 | 所谓公开转换明确要求调用 `recordRunResult(yielded, continuation)`，正是 F3 禁止的 Runtime 事实写入。引用的 K3 范例实际使用脚本模型和 `startRun`。 | `.lead-ref/books/t-items-TP.md:627`；规则表 `:64`；`tests/work-graph/K3-47-continuation-gate.test.ts:142`、`:154` | 改为：“脚本模型调用真实 `send_session_message`，由 Runtime `startRun` 产生 yielded；另一真实运行正式回复；随后 `claimTask` 携带真实 responseRef 的 consumedWait 续接，再由 Runtime 执行。禁止直接调用 `recordRunResult` 构造 yielded。” |
| TP-096 | 拟抽取的 enter/end 本身手改 manifest、prepared 和运行事实；原样搬入新 helper 不符合规则表。新 helper 没有确定路径，也不在白名单；“S1 可一并收”另开了可选范围。 | `tests/helpers/S2B-task-timeline-fixture.ts:448`、`:469`、`:476`、`:494`、`:538`；`tests/helpers/S2B-track-fixture.ts:373`、`:445`；`.lead-ref/books/t-items-TP.md:641`、`:642` | 改为：“新增 `tests/helpers/S2B-runtime-steps-fixture.ts`，只接收公开输入；共享真实 Runtime prepare/start、脚本闸门和结束流程，以及公开策略安装。续接简报由真实 prepare 生成，不修改 manifest/prepared，不手写进入或结束事实。仅接入 timeline、track 两份 fixture；删除 S1 可选合并范围。” |
| TP-099 | “点名的例外”未列入规则表；A7 当前为空。此外条目把检查点写成 Project/Workspace@3，而代码中的 Project 是 @1。 | `.lead-ref/books/t-items-TP.md:662`；`tests/helpers/S5-decision-fixture.ts:541`、`:542`、`:574`；规则表 `:14`、`:52` | 改为：“Project 检查点为 @1，Workspace 为 @3，采用前 Goal 为 @6。治理初始化按公开步骤转换；其余手写检查点部分标记 BLOCKED，不以本条充当 A7 例外。lead 须先冻结符合 v1 的逐步初始化及版本断言映射，之后四份副本一起施工。” |
| TP-101 | 引用的 duties“适配器”实际是返回手造事实的桩；动作里的 `workContext(f.runRA)` 也不符合现有 helper 签名。 | `tests/helpers/S5-user-message-support.ts:35`、`:53`；`src/core/work-graph/configuration/message-duties-adapter.ts:47`；`src/composition/create-platform.ts:818` | 改为：“使用 `workContext(f, f.runRA)`；duties 接 `createMessageDutiesFactsAdapter`，绑定同一世界的真实 roles、sessions，并使用生产相同的 legacyDuty 匹配。不得复制 `realOwners` 中返回固定 duties 的桩。” |
| TP-102 | 明确提供了保留转出口与修改外部消费者两种实现，且消费者属于 T1。 | `.lead-ref/books/t-items-TP.md:683`；`tests/work-graph/S5R2-queue-history.test.ts:7`、`:208` | 删除括号中的替代方案，固定保留 `S5_MESSAGE_BY_WORKSPACE_STATUS` 转出口；只删除已列明的其余转出口和三个局部声明的 `export`。 |
| TP-103 | 必须改调共用工厂的两个消费者均不在 TP 白名单；这里需要改调用参数和初始化选择，不能只视为删除无用 import。 | `tests/work-graph/S5-goal-settings.test.ts:53`、`:89`；`tests/business/S5R2-settings-replay.test.ts:10`、`:28` | 将两个消费者加入白名单；明确迁移 `pausedB` 和原工厂选项，并保留暂停版本检查点及 catalog 前提。 |
| TP-105 | 两个直接消费者不在白名单；与 TP-103 共用的 replay 文件必须一次统一迁移。 | `tests/business/S5R2-settings-replay.test.ts:13`、`:28`；`tests/work-graph/S2B-r2-conflict-catalog.test.ts:32`、`:40` | 将两个消费者加入白名单；与 TP-103 同批迁移 replay 文件，completion 分支固定传 `requirementKind: 'static'`，保留 C 组 driver。 |
| TP-106 | 真正调用被删工厂的 agent-application 文件不在白名单；条目列出的 driver-safe-point 只使用保留的 driver，不是该工厂的调用方。 | `tests/runtime/S5R2-agent-application.test.ts:24`、`:68`；`tests/app/S5R2-driver-safe-point.test.ts:9`、`:12`、`:28` | 将 `tests/runtime/S5R2-agent-application.test.ts` 加入白名单，迁移其工厂调用并保留 `duties: ['adviser']` 和进入前工具授权；删除“driver-safe-point 是工厂消费者”的表述。 |
| TP-108 | “seedRun 只有一个调用方”不实；同时，“没有公开步骤所以保留手写”与施工簿的 BLOCKED 规则相反。 | `tests/helpers/task-claim-fixture.ts:408`；`tests/runtime/R4c-graph-history.test.ts:147`；`tests/work-graph/R4c-execution-history-index.test.ts:268`、`:915`、`:917`；`tests/work-graph/R4c-execution-read.test.ts:235`、`:423`；`tests/work-graph/R4c-task-claim-concurrency.test.ts:63`、`:64`；`tests/work-graph/R4c-task-claim-boundaries.test.ts:98`；`tests/work-graph/R4c-task-claim.test.ts:272`；`.lead-ref/books/t-book.md:52` | 改为：“初始化部分并入 TP-107。seedRun 部分 BLOCKED；上述全部调用点逐条列入处置表，其中 TP-151 覆盖两条领取测试。其余调用不得因无公开路径而自动保留为例外，也不得删除 helper 或改变调用方行为。” |
| TP-109 | “交 P 区处理”没有落成明确动作；删除 R 来源状态机分支还会留下 service 中的事件构造和 Runtime 的 W-04 分类。service 文件不在白名单。 | `.lead-ref/books/t-items-TP.md:733`；`src/core/work-graph/state/run-machine.ts:1911`、`:1976`；`src/core/work-graph/tasks/run-reconcile-service.ts:1033`、`:1050`；`src/core/agent-runtime/run-reconcile.ts:533`；`src/app/startup-reconcile.ts:410` | 将生产清理直接并入本条：删除未进入运行的 R 来源控制结算分支及对应状态矩阵；同步调整 service、Runtime 分类和启动报告，只保留当前 W-16/W-19 路径。将 `run-reconcile-service.ts` 加入白名单。不得只删测试后等待未编号的“P 区”。 |
| TP-110 | 只替换 execution/role 读取仍会留下 `assemblerDouble` 返回手造 binding，转换没有进入真实准备链。 | `tests/runtime/K3-35-workspace-baseline-prepare.test.ts:119`、`:123`、`:165`、`:185` | 将 `assemblerDouble` 一并纳入删除范围；通过真实 claim、真实 execution/role reader 和真实 context assembler 调 Runtime prepare，在注册的真实脏工作区上保留 baseline capacity 断言。 |
| TP-115 | 动作直接指定 B2 `enter()` 三步，规则表恰好将该 helper 列为 F3 反例。`startRun` 可以用闸门保持运行中，不能以“会结束”为由改回手写 entered。 | `.lead-ref/books/t-items-TP.md:774`；规则表 `:64`、`:66`；`src/core/agent-runtime/source-capture-access.ts:435`、`:439` | 改为：“claim → 真实 prepare → 启动 `startRun` 并在真实模型依赖的 A3 闸门处挂起；在 running/entered 时执行读取断言，finally 放闸并等待结束。不得直接调用 `recordExecutionEntered`。” |
| TP-117 | workFixture 的消费者不止条目列出的三条。另两条依赖 `state.set` 修改运行、授权、ReviewWork；换成真实 reader 后不能原样运行。 | `tests/runtime/source-binding-migration.test.ts:139`、`:147`、`:164`、`:177`、`:178`、`:186` | 将这两条加入本项的调用方处置范围；本项标记 BLOCKED，直到 lead 冻结它们的逐断言迁移：真实结束检查、真实 Reviewer 前提，以及不可通过公开步骤发生的原地改写分别处理。不得保留第二套 Map 权威或静默删除这些断言。 |
| TP-118 | Query 转换未设置闸门，完成后的 QueryRun/Job 不满足源码读取条件；同一 helper 的第二条测试仍依赖改历史和改当前 execution。 | `src/core/agent-runtime/source-capture-access.ts:599`、`:611`；`tests/runtime/source-binding-migration.test.ts:232`、`:234`、`:238` | 改为：“真实 submit/claim/prepare 后启动 Query，在 A3 闸门处保持 QueryRun 和 Job 均 running；计数包装真实 `readQuerySubmission`。第二条测试一并列为 BLOCKED，先冻结冲突提交段及 execution 原地改写段的处置；不得保留假历史或 `state.set`。” |
| TP-121 | 目标 helper 只有一路跑到结束的接口，无法通过现有 `advanceToEnd()` 观察 start 前占用；新增停点需要修改 T3 所有的 helper。 | `tests/helpers/WP1-scenario-fixture.ts:114`、`:119`、`:172`、`:297`；`tests/scenarios/WP1-wiring.test.ts:49`、`:50` | 明确给 `openPausedInterruptedScenario` 增加“领取完成、start 前”的公开步骤停点，并让后续驱动继续汇总同一条 trace；将 helper 统一交 TP 修改，保留新旧两处中间断言及最终完成断言。 |
| TP-122 | 整文件删除与 TP-007 的保留指令冲突；其中 pending、无 executionState 的 QueryRun 也是当前提交形状，不能作为旧格式一并判掉。 | `.lead-ref/books/t-items-TP.md:47`、`:823`、`:825`、`:1105`；`tests/scenarios/S2C-K-legacy-provenance.test.ts:482`、`:486`、`:498`、`:500`；`src/core/work-graph/state/query-run-recovery.ts:482` | 改为：“删除旧来历及维护回填场景；保留 2C-26 的 indexed executions 场景并改造为当前 Session、真实 Work claim 和公开 submit 后尚未领取的 Query。继续断言 pending Query 不出现在 Session 执行列表。统一修改 TP-007、TP-063 的整删/保留描述，并补齐同链条生产文件及 S1-provenance 的归属。” |
| TP-124 | 明确要求保留 authorize/begin/entered/recordRunResult 手写 owner 调用，只替换 prepare，仍不符合 F3。 | `.lead-ref/books/t-items-TP.md:837`；`tests/scenarios/support/S5-decisions.ts:571`、`:591`；规则表 `:64` | 改为：“agentRequeue 转换 BLOCKED。必须先冻结脚本模型经真实 Runtime 执行并调用 requeue 工具的完整路径；不得只替换 prepare 后保留手写进入和结束事实。” |
| TP-130 | 动作点名修改 Query 准入，但对应生产文件不在白名单。 | `.lead-ref/books/t-items-TP.md:879`；`src/core/work-graph/queries/query-execution.ts:1072`、`:1079` | 将 `src/core/work-graph/queries/query-execution.ts` 加入白名单，与 TP-009、TP-054、TP-164 同批完成 Work/Query 两端必填约束。 |
| TP-132 | 明确保留 schema 1 draft 测试，与 TP-050“入口只收 schema 2”直接冲突；删除类型还需处理白名单外的转出口。 | `.lead-ref/books/t-items-TP.md:323`、`:894`；`tests/state/plan-machine.test.ts:498`；`src/core/work-graph/model/plan-contracts.ts:33` | 删除“保留 schema 1 draft”指令，将该测试明确归入 TP-050 的 v1 退役范围；保留当前 schema 2 状态矩阵。把 model/plan-contracts 的 `LegacyPlanProposal` 转出口清理列入动作和白名单。 |
| TP-135 | 动作删除测试中的两个 guard 字段，却没有完整规定对应类型及调用方同步删除；生产 Session 生命周期、Query 领取及另外两组测试都会受影响。 | `src/core/work-graph/state/session-availability.ts:120`、`:126`；`src/core/work-graph/sessions/session-lifecycle.ts:969`、`:1162`、`:1318`；`src/core/work-graph/queries/query-execution.ts:227`、`:933`；`tests/state/S1-dispatch.test.ts:71`；`tests/state/S1-session-archive.test.ts:194`、`:212` | 明确同步删除 `provenanceBasisValid`、`legacyProvenance` 的类型成员及全部构造/读取，纳入 Session lifecycle、Query claim 和纯状态夹具；与 TP-007/063/122、T1-035、T2-057 统一文件归属后一起落地。 |
| TP-137 | 两套“要么”会产生不同代码；只删末尾旧根断言会留下依赖无 chain 的整张矩阵。另一套若照删 1101–1107，又会丢掉空集合、当前链排序等有效断言。 | `.lead-ref/books/t-items-TP.md:928`；`tests/state/verification-machine.test.ts:131`、`:1101`、`:1102`、`:1104`、`:1153` | 固定采用当前 chain 基础夹具：给 OPEN_PENDING 补 root chain，所有派生夹具同步；旧 null→null 槽期望改为当前持有者期望。保留空集合、链排序、当前根和非旧 PASS 的分类断言；只删除明确列出的旧格式分支及对应数据项，不整段删除混合测试。 |
| TP-138 | TP-045 要删 `legacyRound` helper，本条要改它并继续用于“缺 incompleteCause”的当前形状；两条不能独立执行。 | `.lead-ref/books/t-items-TP.md:289`、`:935`；`tests/work-graph/A2-step1-codecs.test.ts:360`、`:381`、`:397` | 将 helper 改名为当前根且缺可选 check cause 的构造器，补 rootChain；删除旧无 chain 往返测试，保留 395–414 的当前形状测试。同步将 TP-045 的“删除 helper”改为引用本条改造。 |
| TP-139 | 源测试同时覆盖 memory/SQLite，并重放 pause 和 resume；目标只跑 SQLite，动作只要求重放 pause。会丢掉后端和 resume replay 断言。 | `tests/work-graph/A2-step1-codecs.test.ts:592`、`:610`、`:615`；`tests/work-graph/A2-goal-control.test.ts:50`、`:62`、`:114`、`:120` | 目标增加 memory/SQLite 公共流程参数化；保留 SQLite reopen 段；保存两个操作者各自的请求，分别重放 pause、resume，断言原 snapshot、requester 和 receipt，再删除源测试。 |
| TP-141 | 指定删除的 284–287 包含后续仍使用的 `gateIndexRef`；同时与 TP-046 整删 284–296 冲突。 | `tests/work-graph/A2-verification-chain.test.ts:285`、`:293`；`.lead-ref/books/t-items-TP.md:296`、`:956` | 固定删除旧注释及 286–287 的 @0 写入，保留 `gateIndexRef`；gate 从无索引开始，保留最终追加结果断言；同步把 TP-046 改为引用本条范围。 |
| TP-142 | 五条关闭测试中有一条还要求重新打开 Task 后请求仍持久关闭。动作只规定 cancelled；现有 helper 对同一 Task 再调用时复用 requestId，不能直接追加 active 调用。helper 属于 T3。 | `tests/work-graph/B2-09-crr-owner.test.ts:448`、`:453`、`:455`；`tests/helpers/K3-review-card-fixture.ts:353`、`:379`、`:385` | 将关闭和重新打开都改为真实 Plan disposition 变更；helper 的 propose/apply requestId 加入新 planRevision，允许同一 Task 连续 cancelled→active。保留重新打开后请求仍 closed@2 的断言；helper 统一交 TP 修改。 |
| TP-143 | “基于当前 Run 继续 commit”与“纯 codec”是两种实现；继续使用存储提交也不能形成 A5 纯 codec 测试。 | `.lead-ref/books/t-items-TP.md:970`；`tests/work-graph/B2-execution-entry.test.ts:214`、`:218`；`src/core/work-graph/materials/record-readers.ts:209`、`:366`；规则表 `:41` | 固定移入 `tests/state/execution-entry-codecs-pure.test.ts`：通过 `materialRecordSchemas()` 取得 Run schema 的纯 validate，输入其余字段合法、仅 entering 的 kernel 为 null 的当前 Run，断言原拒绝原因；不创建 fixture、backend 或提交记录。源文件删除整个混合旧测试。 |
| TP-144 | `B2-model-request.test.ts:26–50` 不是完整测试范围，51–54 仍属于被删测试。 | `tests/work-graph/B2-model-request.test.ts:27`、`:50`、`:54` | 删除范围改为 `B2-execution-entry.test.ts:86–115` 和 `B2-model-request.test.ts:27–54` 两个完整测试。 |
| TP-145 | “涉及测试”列了两条，但动作只指向 execution-entry 的一条；model-request 中的第二条会留下。 | `.lead-ref/books/t-items-TP.md:987`；`tests/work-graph/B2-execution-entry.test.ts:59`；`tests/work-graph/B2-model-request.test.ts:12` | 动作明确删除 `B2-execution-entry.test.ts:59–70` 和 `B2-model-request.test.ts:12–25`。 |
| TP-146 | 所给 begin/end 步骤仍是 Runtime 内部写入；“如果造不出就改合同测试”没有目标、合同接缝或断言映射，施工者会自行选择不同测试。 | `.lead-ref/books/t-items-TP.md:991`；`tests/work-graph/B2-execution-entry.test.ts:236`、`:243`；`src/core/work-graph/tasks/execution-entry-service.ts:743`；规则表 `:64` | 改为 BLOCKED，删除合同测试兜底语句。lead 先冻结允许规则内的真实 Kernel 身份冲突触发点及“槽冲突、零部分提交”的断言映射；冻结前保留源测试，不手写槽或 begin 事实。 |
| TP-147 | running 和竞态结束都指定调用 entered/result owner，违反 F3；换成 B2 fixture 并不消除问题。 | `.lead-ref/books/t-items-TP.md:998`；`tests/work-graph/R3c-plan-adoption.test.ts:190`、`:237`；规则表 `:64`、`:66` | 改为真实 Runtime prepare/start；running 场景在模型依赖闸门处挂起；竞态场景在原 lookup 闸门中放行并等待真实 Run 结束，停在 Workflow 的 TaskReduction 之前。保留 query/adoption、eligibility 和 ready 断言。 |
| TP-148 | 动作有两套结束/归档路线；手调 entered/result、recordSessionHealth 不符合规则表。只换成进入前取消也不会产生原断言要求的 unavailable 健康事实。 | `.lead-ref/books/t-items-TP.md:1005`；`tests/work-graph/R4c-execution-read.test.ts:198`、`:218`、`:220`；规则表 `:64` | 改为 BLOCKED：先冻结真实 Host 探测产生 unavailable、公开结束/重排/重新领取及归档的完整步骤；保留旧 Session archived/unavailable/无占用和新 Lease holder 的语义断言，不手写健康事实，不保留二选一路线。 |
| TP-151 | 两种转换路线未定；其中 entered/result 路线违反 F3。真实前置写入后，原来的零提交和一次 lookup 断言还需要明确重新开始计数。 | `.lead-ref/books/t-items-TP.md:1026`；`tests/work-graph/R4c-task-claim.test.ts:276`；`tests/work-graph/R4c-task-claim-boundaries.test.ts:106`、`:107` | 固定采用公开 claim→进入前 `submitControl(cancel)`；第二条再公开 propose/apply 新 Plan。全部前置完成后清零委托计数，再发被拒领取，保留零提交、一次 lookup 和 busy 断言；标题改为已结束 Run 与已释放 Lease。 |
| TP-157 | `checksUnplaced` 断言存在“删除”和“改为 0”两种读法，并与 TP-090 的删除范围重叠。 | `.lead-ref/books/t-items-TP.md:599`、`:1068`；`tests/work-graph/S2B-activity-calendar.test.ts:260` | 固定保留 `checksUnplaced: 0` 断言，只删除旧轮次设置及旧值断言；同步改 TP-090 的范围，避免后续重复删除。 |
| TP-163 | 明确保留手写轮次/Session，或改业务期望，既违反规则表，也把行为取舍留给施工者；running 的主体不能公开开验证轮。 | `.lead-ref/books/t-items-TP.md:1110`；`tests/work-graph/S3-graph-context.test.ts:497`、`:881`、`:899`；`src/core/work-graph/evidence/evidence-service.ts:1070`；`src/core/work-graph/state/verification-machine.ts:1209` | 改为 BLOCKED。lead 先冻结可由公开步骤建立的 GR 共享世界及 GR06/GR07 逐断言映射；删除“继续手写或改期望”的选择，禁止施工者自行改图事实。 |
| TP-164 | 与 TP-130 相同，必改的 Query 准入文件未授权。 | `src/core/work-graph/queries/query-execution.ts:1072`、`:1079`；`.lead-ref/books/t-items-TP.md:1117` | 将 Query 准入文件加入白名单；明确本条是 TP-009/054/130 同一批必填约束的测试部分，不单独删除 AD05。 |
| TP-165 | 上游 Run 及 AD06 仍以手写 Runtime/Host owner 调用造状态；AD08 只写“setLinePins”，没有建立真实 @7 的准备前提，现测试的 @7 也是 prepare 参数。 | `.lead-ref/books/t-items-TP.md:1124`；`tests/work-graph/S3-prepared-context-admission.test.ts:274`、`:518`、`:547`、`:553`；规则表 `:64` | 上游 Run 改真实 Runtime 执行；AD06 标记 BLOCKED，先冻结 begin 后、Kernel 未进入时的真实故障与 Host reconcile 路径。AD08 用真实 Session 的公开 pins 变更把 Workspace 推进至 @7，真实 prepare 后再变更一次至 @8；不得把 @7 手填进 binding。 |
| TP-166 | 删除 old 通知后集合只剩一个元素，但要求原样保留的 209 行仍访问 `items[1]`。 | `tests/work-graph/S5-notices.test.ts:206`、`:209`；`.lead-ref/books/t-items-TP.md:1131` | 明确把 209 行的两处 `items[1]` 都改成 `items[0]`，继续断言唯一 fresh 通知的 commit cursor 和 itemKey；保留 corrupt-origin 拒绝段。 |
| TP-167 | 把“策略变更不重写历史通知”设为可选，会允许删除唯一覆盖该当前行为的断言；NR01/NR07 没有改变策略。 | `tests/work-graph/S5-notices.test.ts:131`、`:258`、`:279`、`:283`；`.lead-ref/books/t-items-TP.md:1138` | 改为强制迁移：当前自动后继轮记录 cap=3，通过公开配置步骤把当前策略上限改为 7，再断言已存在通知及其 cap 仍为 3；随后删除旧 unknown-cap 场景。 |

**2. 白名单补充与文件归属**

下表列的是上述修正需要编辑、当前未在 TP 白名单中的文件。已有其他组所有的文件，应由 lead 先统一划归 TP，并取消另一组对同一文件的并行施工，再冻结施工簿。

| 文件 | 对应条目 | 其他组白名单 |
|---|---|---|
| `tests/helpers/S2B-runtime-steps-fixture.ts` | TP-096 | 无；新增文件 |
| `tests/work-graph/S5-goal-settings.test.ts` | TP-103 | 无 |
| `tests/business/S5R2-settings-replay.test.ts` | TP-103、105 | 无 |
| `tests/work-graph/S2B-r2-conflict-catalog.test.ts` | TP-105 | 无 |
| `tests/runtime/S5R2-agent-application.test.ts` | TP-106 | 无 |
| `src/core/work-graph/tasks/run-reconcile-service.ts` | TP-109 | 无 |
| `tests/helpers/WP1-scenario-fixture.ts` | TP-121 | T3，`.lead-ref/books/t-files-T3.txt:81` |
| `src/contracts/core/session.ts` | TP-122、135 | 无 |
| `src/core/work-graph/model/session-contracts.ts` | TP-122、135 | 无 |
| `src/core/work-graph/model/session-facts-contracts.ts` | TP-122、135 | 无 |
| `src/core/work-graph/queries/contracts.ts` | TP-122、135 | 无 |
| `src/core/work-graph/sessions/lifecycle-record-codecs.ts` | TP-122、135 | 无 |
| `tests/work-graph/S1-provenance.test.ts` | TP-122、135 | T1，`.lead-ref/books/t-files-T1.txt:35` |
| `src/core/work-graph/queries/query-execution.ts` | TP-130、135、164 | 无 |
| `src/core/work-graph/model/plan-contracts.ts` | TP-132、168 | 无 |
| `src/core/work-graph/sessions/session-lifecycle.ts` | TP-135 | 无 |
| `tests/state/S1-session-archive.test.ts` | TP-135 | T2，`.lead-ref/books/t-files-T2.txt:53` |
| `tests/helpers/K3-review-card-fixture.ts` | TP-142 | T3，`.lead-ref/books/t-files-T3.txt:67` |
| `tests/state/execution-entry-codecs-pure.test.ts` | TP-143 | 无；新增文件 |

另外，TP-108 的两个未纳入处置的调用文件是 `tests/work-graph/R4c-execution-history-index.test.ts` 和 `tests/work-graph/R4c-task-claim-concurrency.test.ts`；前者归 T1，后者未归组。前者有三处调用，后者有两处，不能当作无消费者 helper 处理。其位置分别是 `tests/work-graph/R4c-execution-history-index.test.ts:268`、`:915`、`:917`，以及 `tests/work-graph/R4c-task-claim-concurrency.test.ts:63`、`:64`。本轮先将它们列入 BLOCKED 处置表，不自动扩大修改范围。

生产调用链的核对结果如下；这里区分了“在白名单外但无需改代码”与“必须补范围”。

| 生产改动 | 调用方及下游读取 | 白名单及动作覆盖结论 |
|---|---|---|
| TP-090 的旧日历轮次读取 | 旧索引读取在 `src/core/work-graph/views/activity-read-model.ts:481`；公开 reader 装配在 `src/composition/create-platform.ts:1109`；路由绑定/调用在 `src/app/core-routes.ts:868`、`:1153`，HTTP 类型在 `src/app/core-http-types.ts:426`。 | 后两个文件归 TQ。保留公开 DTO、`checksUnplaced` 字段和当前读取行为时无需修改；内部旧读取与其测试已由 TP-090/157 覆盖。 |
| TP-093/155 的时间线旧轮次分支 | 当前工厂在 `src/core/work-graph/views/task-state-timeline.ts:549`；装配在 `src/composition/create-platform.ts:1114`；路由在 `src/app/core-routes.ts:874`、`:1156`；HTTP 类型在 `src/app/core-http-types.ts:432`。 | 路由、HTTP 类型在 TP 外，但接口不变，无需修改。不要把当前运行尚无开始时间的分支混入旧轮次删除。旧轮次处理位置是 `src/core/work-graph/views/task-state-timeline.ts:396`。 |
| TP-097/154 的旧轮次计数 | `scanRoundsUnplaced` 调用在 `src/core/work-graph/views/track-read-model.ts:1025`，分段列表在 `:149`；两个索引定义/注册在 `src/core/work-graph/persistence/evidence-record-codecs.ts:746`、`:748`、`:757`、`:768`。公开装配在 `src/composition/create-platform.ts:1112`，路由在 `src/app/core-routes.ts:872`、`:1155`。 | 内部调用、分段及索引须与 TP-065 同批清理，文件均在 TP。外部路由归 TQ，公开接口不变，不需编辑。 |
| TP-109 的 R 来源结算 | 状态机调用在 `src/core/work-graph/state/run-machine.ts:1911`；实际事件构造在 `src/core/work-graph/tasks/run-reconcile-service.ts:1050`；Runtime owner 调用在 `src/core/agent-runtime/run-reconcile.ts:542`；装配在 `src/composition/create-platform.ts:2082`；启动报告在 `src/app/startup-reconcile.ts:410`。 | service 文件缺白名单，原条目没有闭合调用链；其余文件已在 TP。见上表修正。 |
| TP-119 的 legacy_live | 生产 `createExplorationTools` 调用在 `src/core/agent-runtime/observed-model-run.ts:323`；生产 `runObservedModel` 调用在 `src/core/agent-runtime/execution-driver.ts:1217` 和 `src/core/agent-runtime/query-execution.ts:509`。ProjectSourceIndex 的类型使用见 `src/core/workspace/cpp-source-index.ts:4`、`src/core/workspace/python-source-index.ts:5`。 | 与 TP-026 合批后覆盖类删除、类型迁移和工具名表。Query driver 在 TP 外，但现有 frozen 调用无需改变。直接测试调用中只有旧模式协议测试要随 TP-026 删除；位置是 `tests/app/project-source-tool.test.ts:268`。其余省略 source 模式、只用一般源码工具的调用不必强制补 frozen access，例如 `tests/app/exploration-tools.test.ts:21`、`tests/data/cpp-source-index.test.ts:122`。 |
| TP-122/135 的来历回填 | composition 接线在 `src/composition/create-platform.ts:806`、`:822`、`:1280`；Work claim 在 `src/core/work-graph/tasks/claim-service.ts:731`、`:762`、`:775`；Query claim 在 `src/core/work-graph/queries/query-execution.ts:933`；维护调用在 `src/business/workflow/session-maintenance.ts:378`、`:612`；directory 写入在 `src/core/work-graph/sessions/session-directory.ts:1738`、`:1750`、`:1773`。类型和事件消费者在 `src/core/work-graph/model/session-contracts.ts:62`、`src/core/work-graph/model/session-facts-contracts.ts:100`、`src/core/work-graph/queries/contracts.ts:233`、`src/core/work-graph/sessions/lifecycle-record-codecs.ts:587`、`:647`。 | 原白名单不足，所需补充已逐文件列出。不能只删除 state 分支或测试。 |
| TP-130/164/171 的 contextAssembly、Goal digest | `contextAssemblyProblem` 的生产调用在 `src/core/work-graph/tasks/execution-entry-service.ts:1057`、`src/core/work-graph/queries/query-execution.ts:1072`；`contextGoalContentProblem` 的生产调用在 `src/core/work-graph/tasks/execution-entry-service.ts:1087`。真实准备写入在 `src/core/agent-runtime/execution-preparation.ts:533`、`src/core/agent-runtime/query-preparation.ts:359`。 | Work 端和准备端已在 TP；Query 准入必须补白名单。Goal digest 检查没有额外生产调用方。 |
| TP-132/168 的 LegacyPlanProposal | 转出口在 `src/core/work-graph/model/plan-contracts.ts:33`；解码使用在 `src/core/work-graph/tasks/plan-readers.ts:453`、`src/core/work-graph/notes/note-version-lists.ts:83`；note reader 的候选过滤在 `:87`。 | 转出口必须删，缺白名单。plan-readers、note-version-lists 在 TP 外，但继续读取当前 candidate 的接口不变，无需随本项改动。 |
| TP-133/143/158/159 的 V1 授权 | Run codec 调用验证器在 `src/core/work-graph/materials/record-readers.ts:209`；V2 predicate 的外部使用在 `src/core/work-graph/tasks/control-service.ts:228`、`:350`，`src/core/work-graph/tasks/plan-write-admission.ts:287`，`src/core/work-graph/tasks/reconcile-intents.ts:138`，`src/core/work-graph/tasks/run-reconcile-service.ts:596`。 | 这些文件在 TP 外。保留验证器/predicate 的签名和当前 V2、无授权合法状态时无需改动；不能删除整个验证器。TP-133 已明确保留 D7 无绑定 ended 与 Claimed 拒绝断言，见 `.lead-ref/books/t-items-TP.md:901`。 |
| TP-136/137 的轮次判定 | `isFinalizedNonPass` 的外部调用在 `src/core/work-graph/state/task-failure.ts:326`、`:972`，`src/core/work-graph/state/task-machine.ts:619`、`:1188`，`src/core/work-graph/tasks/plan-readers.ts:1886`，`src/core/work-graph/tasks/requeue-service.ts:1038`。`roundOrdinalOf` 的外部调用在 `src/core/work-graph/state/task-failure.ts:1180`、`src/core/work-graph/tasks/context-input-service.ts:525`。`heldSlotClaim` 仅在所属文件的 `:1385`、`:1522` 调用。 | task-failure、plan-readers 在 TP 外，task-machine 归 T2；这些调用不需要改签名。删除仅针对旧格式的分支时当前数据语义不变，不需要越组修改这些调用。 |
| TP-153/166/167 的通知位置及 cap | `noticePositionOf` 调用在 `src/core/work-graph/views/automatic-rework-notices.ts:242`、`:304`；`decodeCapOf` 调用在 `:414`；`reworkSummary` 调用在 `:244`、`:300`，unknown-cap 文案在 `:532`；工厂接线在 `src/composition/create-platform.ts:973`。 | 调用链均在 TP；TP-167 的文案删除要落到 `:532`，不能仅按其引用的 `:423–434` 清理。 |
| TP-170 的 since 容忍 | `preservedNoticeOrigin` 的两个调用在 `src/core/work-graph/communication/mailbox-service.ts:301`、`:2973`；后一条是 archive wait disposal，重编码使用在 `:2987`。 | 无白名单外调用。只收紧缺 since 的容忍，保留原 since 复制、读取失败和损坏来源拒绝；不能删除整个 helper，否则会破坏当前消息更新和归档等待处置。 |

**3. 必须同批或按顺序落地**

- TP-086、088 的公开初始化先完成，再做 TP-089；不能在合并时重新引入 seed 接口。对应动作见 `.lead-ref/books/t-items-TP.md:571`、`:585`、`:592`。
- TP-080 的 B2 Runtime 前提修正与 TP-092 合并一起落地，再让 S2B fixture 依赖共用构造。需要保留额外 schemas、活动 records 引用及 reopen 后 reader 重绑，见 `.lead-ref/books/t-items-TP.md:529`、`:614`。
- TP-091、094、095、096、097 与 TP-072、090、093、154–160 作为同一组 S2B 变更处理。重复项只落一次；TP-095/160 保留公开 pre-entry 控制流程，源测试与目标的五段期望分别见 `tests/work-graph/S2B-32-task-timeline-fold.test.ts:236`、`tests/work-graph/S2B-r2-s-preentry-control.test.ts:42`。
- TP-099–106 先冻结共用工厂的检查点、catalog、pausedB、requirementKind、duties 和进入前工具选项，再迁移消费者，最后删除副本。工厂参数和消费者见 `tests/helpers/S5-goal-settings-support.ts:169`、`tests/helpers/S5R2-c-support.ts:206`、`tests/helpers/S5R2-d-support.ts:236`。
- TP-107、108 的初始化改造只做一次；seedRun 的处置与 TP-151 及其他实际调用方分别核销，不能连带删掉尚未迁移的调用。
- TP-007、063、098、122、126、135、152、161、162 与 T1-035、T2-057 同批处理来历删除。TP-161 的“先留 helper”只能表示中间顺序，最终在 TP-162 删除最后旧 Session 用例后移除 helper；其两个调用位置是 `tests/helpers/S2C-L-line-support.ts:711`、`tests/work-graph/S2C-lines-page.test.ts:397`。
- TP-009、054、128、130、164、171 同批处理 contextAssembly 必填和旧 Goal digest 容忍；相关手写 manifest 的替换必须先于收紧准入。
- TP-011、048、133、143、158、159 同批删除授权 V1；TP-143 的当前 malformed V2 拒绝断言先迁移，不能随旧授权整段消失。
- TP-049、050、132、168 同批处理旧 proposal 与旧 Plan draft；先解决 schema 1 保留冲突。
- TP-025、045、046、136–141 同批处理 chain、PASS gaps 和 @0 索引；先修正基础夹具和混合测试，再删除兼容读取。
- TP-026 与 TP-119 同批；先补 frozen 模式释放失败和幂等断言，再删 legacy 生命周期测试。
- TP-085/153、090/157、093/155、097/154、098/161/162、095/160 都是重叠施工范围，计划中应各指定一个实际落地项，其余项记录同一提交，不重复删改。

**4. 施工簿和运行文件的问题**

1. **条目动作“最终”与规则表之间缺少明确优先级。**  
   施工簿要求动作最终，同时要求默认拒绝并在公开路径不可达时 BLOCKED；当前 TP-099 的例外、TP-108 的保留、TP-124 的内部写入保留与这些规则冲突。依据是 `.lead-ref/books/t-book.md:22`、`:48`、`:52`，规则表 `:52`、`:64`。  
   **固定改法：**写明“条目不得创设规则表例外；发生冲突即 BLOCKED，由 lead 在施工前修订条目，不交施工者解释”。

2. **白名单例外不能解决当前的行为迁移和跨组文件冲突。**  
   例外只允许为了编译删除被删符号的 import/usage；工厂迁移、中间停点和共享 helper 修改超出了这一范围。依据是 `.lead-ref/books/t-book.md:31`，实际需要改变的接口见 `tests/helpers/WP1-scenario-fixture.ts:119`、`tests/helpers/K3-review-card-fixture.ts:379`。  
   **固定改法：**把本答复的必改文件落实到白名单并统一所有者，不用编译例外代替授权范围。

3. **运行文件“白名单不重叠”的表述与其下一句不一致。**  
   同一行又说明 TP/TQ 都修改 production-reach JSON。依据是 `.lead-ref/books/t-run-TP.md:5`。  
   **固定改法：**改为“除明确列出的共享文件外不重叠”，列明 JSON 的逐条所有权，并将本轮新发现的共享 helper 冲突全部消除后再施工。

4. **“保留 X 原样”必须服从已冻结的精确调整清单。**  
   当前 TP-166 同时要求删第一项、保留第二项原下标；TP-141 同时删声明、保留引用。依据是 `.lead-ref/books/t-book.md:39`，`tests/work-graph/S5-notices.test.ts:209`，`tests/work-graph/A2-verification-chain.test.ts:285`、`:293`。  
   **固定改法：**上述条目直接写出允许改变的下标、声明和期望，不让施工者以“为了通过测试”自行推断。

5. **TP 白名单含非文件占位内容。**  
   前十行是裸名称，另有省略号路径。依据是 `.lead-ref/books/t-files-TP.txt:1`、`:10`、`:123`。  
   **固定改法：**删除占位内容，按最终逐项编辑清单填写真实完整路径，然后重新计算运行文件中的文件数；不要把裸名称解释为通配授权。

**5. 同一问题表的 JSON**

```json
[
  {
    "id": "TP-089",
    "problem": "额外 seed 记录参数保留了禁止的手写事实入口；见 t-items-TP.md:592、S2A-notices-workspace2-fixture.ts:107。",
    "fix": "先完成 TP-086/088；共享工厂只接公开输入，删除额外 seed 记录参数，W2 Workspace 和策略由公开 owner 建立。",
    "files_add": []
  },
  {
    "id": "TP-091",
    "problem": "runAndEnd/writeActivity 和 countedCounter 仍手造事实；进入前取消不能保留 counted 断言；见 S2B-activity-fixture.ts:543、S2B-r2-backfill-done-cursor.test.ts:67、101。",
    "fix": "R9 转换标记 BLOCKED，先冻结真实 Runtime/Kernel 历史、允许故障形成待回填对象及真实 countRunActivity 的完整流程；禁止 writeActivity、countedCounter 和进入前取消替代 counted 对象。日历剩余断言统一按 TP-156 保留。",
    "files_add": []
  },
  {
    "id": "TP-094",
    "problem": "直接 recordRunResult(yielded) 违反 F3；见 t-items-TP.md:627、test-rule-sheet-v1.md:64。",
    "fix": "用真实脚本工具发送等待消息，由 startRun 产生 yielded，再正式回复并携带真实 consumedWait 续接；不直接写运行结果。",
    "files_add": []
  },
  {
    "id": "TP-096",
    "problem": "拟合并 enter/end 修改 manifest/prepared 并手写运行事实，且新 helper 未定路径；见 S2B-task-timeline-fixture.ts:469、476、494。",
    "fix": "新建 S2B-runtime-steps-fixture.ts，共享真实 prepare/start、闸门、结束和公开策略安装；只接公开输入，只迁移 timeline/track，删除可选 S1 合并范围。",
    "files_add": ["tests/helpers/S2B-runtime-steps-fixture.ts"]
  },
  {
    "id": "TP-099",
    "problem": "规则表 A7 为空，条目却保留手写例外；Project 实际为 @1；见 S5-decision-fixture.ts:541、test-rule-sheet-v1.md:52。",
    "fix": "纠正为 Project@1、Workspace@3、采用前 Goal@6；治理公开转换，其余检查点标记 BLOCKED，待符合 v1 的逐步初始化及版本映射冻结后再施工。",
    "files_add": []
  },
  {
    "id": "TP-101",
    "problem": "引用的 duties 实现是固定事实桩，workContext 调用参数也不匹配；见 S5-user-message-support.ts:35、53。",
    "fix": "使用 workContext(f, f.runRA)，duties 接同一世界的 createMessageDutiesFactsAdapter、真实 roles/sessions 和生产相同的 legacyDuty 匹配。",
    "files_add": []
  },
  {
    "id": "TP-102",
    "problem": "转出口处理有两种实现并牵涉 T1 消费者；见 t-items-TP.md:683、S5R2-queue-history.test.ts:7。",
    "fix": "固定保留 S5_MESSAGE_BY_WORKSPACE_STATUS 转出口，删除修改外部消费者的替代方案。",
    "files_add": []
  },
  {
    "id": "TP-103",
    "problem": "两个工厂消费者不在 TP 白名单；见 S5-goal-settings.test.ts:89、S5R2-settings-replay.test.ts:28。",
    "fix": "纳入两个消费者，迁移 pausedB 和原工厂选项，保留暂停版本检查点及真实 catalog 前提。",
    "files_add": ["tests/work-graph/S5-goal-settings.test.ts", "tests/business/S5R2-settings-replay.test.ts"]
  },
  {
    "id": "TP-105",
    "problem": "两个直接消费者缺白名单；见 S5R2-settings-replay.test.ts:28、S2B-r2-conflict-catalog.test.ts:40。",
    "fix": "与 TP-103 同批迁移 replay 文件，completion 分支固定传 requirementKind: static，保留 C 组 driver。",
    "files_add": ["tests/business/S5R2-settings-replay.test.ts", "tests/work-graph/S2B-r2-conflict-catalog.test.ts"]
  },
  {
    "id": "TP-106",
    "problem": "实际工厂消费者缺白名单，driver-safe-point 不是该工厂调用方；见 S5R2-agent-application.test.ts:68、S5R2-driver-safe-point.test.ts:12。",
    "fix": "迁移 agent-application 工厂调用，保留 adviser duties 及进入前工具授权，纠正消费者清单。",
    "files_add": ["tests/runtime/S5R2-agent-application.test.ts"]
  },
  {
    "id": "TP-108",
    "problem": "seedRun 并非单一消费者，且不可达不构成保留例外；见 task-claim-fixture.ts:408、R4c-execution-history-index.test.ts:268、R4c-task-claim-concurrency.test.ts:63。",
    "fix": "初始化并入 TP-107；seedRun 部分标记 BLOCKED，列出全部实际调用点逐条冻结处置，TP-151 只核销其覆盖的两条。",
    "files_add": []
  },
  {
    "id": "TP-109",
    "problem": "未编号的生产交接漏掉 service 事件构造及白名单；见 run-reconcile-service.ts:1050、run-reconcile.ts:533。",
    "fix": "把 R 来源未进入控制结算、service 构造、状态矩阵、Runtime 分类及启动报告清理并入本项，只保留当前 W-16/W-19 路径。",
    "files_add": ["src/core/work-graph/tasks/run-reconcile-service.ts"]
  },
  {
    "id": "TP-110",
    "problem": "替换 execution/role 后仍使用返回手造 binding 的 assemblerDouble；见 K3-35-workspace-baseline-prepare.test.ts:119、185。",
    "fix": "一并删除 assemblerDouble，以真实 claim、reader、context assembler 和 Runtime prepare 在真实脏工作区验证 baseline capacity。",
    "files_add": []
  },
  {
    "id": "TP-115",
    "problem": "指定的 B2 enter 三步正是规则表 F3 反例；见 t-items-TP.md:774、test-rule-sheet-v1.md:66。",
    "fix": "真实 prepare/startRun 后在模型依赖闸门挂起，在 running/entered 状态断言，finally 放闸并等待结束。",
    "files_add": []
  },
  {
    "id": "TP-117",
    "problem": "遗漏两个依赖 state.set 的 workFixture 消费者；见 source-binding-migration.test.ts:139、147、164、177、186。",
    "fix": "补列两个消费者并标记 BLOCKED，先冻结真实结束、真实 Reviewer 前提及不可达原地改写的逐断言处置，不保留第二套假权威。",
    "files_add": []
  },
  {
    "id": "TP-118",
    "problem": "完成后的 Query 不满足 running 条件，另一个消费者仍改历史和 execution；见 source-capture-access.ts:599、611、source-binding-migration.test.ts:232、238。",
    "fix": "真实 Query 在 A3 闸门保持 running，计数包装 readQuerySubmission；第二条测试标记 BLOCKED，先冻结两段篡改场景处置。",
    "files_add": []
  },
  {
    "id": "TP-121",
    "problem": "现有 advanceToEnd 没有 start 前停点，所需 helper 属于 T3；见 WP1-scenario-fixture.ts:119、297。",
    "fix": "新增领取后 start 前停点并继续汇总同一 trace，保留中间及最终断言；helper 统一划归 TP。",
    "files_add": ["tests/helpers/WP1-scenario-fixture.ts"]
  },
  {
    "id": "TP-122",
    "problem": "整删与 TP-007 保留 indexed 场景冲突，pending 无 executionState Query 不是旧格式；见 t-items-TP.md:47、1105、S2C-K-legacy-provenance.test.ts:482。",
    "fix": "删除旧来历场景，保留 indexed 场景并用当前 Session、真实 Work claim、公开 submit 后未领取的 Query 重建；同步统一 TP-007/063 及 S1-provenance 的范围和文件所有权。",
    "files_add": ["src/contracts/core/session.ts", "src/core/work-graph/model/session-contracts.ts", "src/core/work-graph/model/session-facts-contracts.ts", "src/core/work-graph/queries/contracts.ts", "src/core/work-graph/sessions/lifecycle-record-codecs.ts", "tests/work-graph/S1-provenance.test.ts"]
  },
  {
    "id": "TP-124",
    "problem": "明确保留手写 entered/result owner 调用，违反 F3；见 t-items-TP.md:837。",
    "fix": "agentRequeue 转换标记 BLOCKED，先冻结真实 Runtime 脚本调用 requeue 工具的完整路径，不只替换 prepare。",
    "files_add": []
  },
  {
    "id": "TP-130",
    "problem": "必改的 Query 准入文件缺白名单；见 query-execution.ts:1072、1079。",
    "fix": "纳入 Query 准入文件，与 TP-009/054/164 同批收紧 contextAssembly。",
    "files_add": ["src/core/work-graph/queries/query-execution.ts"]
  },
  {
    "id": "TP-132",
    "problem": "保留 schema 1 draft 与 TP-050 冲突，LegacyPlanProposal 转出口缺范围；见 plan-machine.test.ts:498、model/plan-contracts.ts:33。",
    "fix": "把 schema 1 draft 测试明确归 TP-050 删除，保留 schema 2 矩阵；同步删除 LegacyPlanProposal 转出口。",
    "files_add": ["src/core/work-graph/model/plan-contracts.ts"]
  },
  {
    "id": "TP-135",
    "problem": "删除 guard 字段未覆盖类型及生产构造方、跨组测试；见 session-availability.ts:120、126、session-lifecycle.ts:969、query-execution.ts:933。",
    "fix": "同步删除 provenanceBasisValid、legacyProvenance 的类型和全部构造/读取，与来历清理链及 T1-035/T2-057 统一归属后落地。",
    "files_add": ["src/contracts/core/session.ts", "src/core/work-graph/model/session-contracts.ts", "src/core/work-graph/model/session-facts-contracts.ts", "src/core/work-graph/queries/contracts.ts", "src/core/work-graph/queries/query-execution.ts", "src/core/work-graph/sessions/lifecycle-record-codecs.ts", "src/core/work-graph/sessions/session-lifecycle.ts", "tests/state/S1-session-archive.test.ts", "tests/work-graph/S1-provenance.test.ts"]
  },
  {
    "id": "TP-137",
    "problem": "两套旧根处理互斥，整段删除会丢当前有效断言；见 verification-machine.test.ts:131、1101、1102、1104。",
    "fix": "固定补当前 root chain 并更新派生夹具及槽期望，保留空集合、链排序、当前根和当前分类断言，只删除旧数据项及旧格式断言。",
    "files_add": []
  },
  {
    "id": "TP-138",
    "problem": "与 TP-045 删除 legacyRound helper 的指令冲突；见 t-items-TP.md:289、935、A2-step1-codecs.test.ts:397。",
    "fix": "将 helper 改名并补 rootChain，保留缺可选 incompleteCause 的当前测试，同步改 TP-045 为引用本条。",
    "files_add": []
  },
  {
    "id": "TP-139",
    "problem": "目标只跑 SQLite，且漏掉 resume replay；见 A2-step1-codecs.test.ts:592、615、A2-goal-control.test.ts:62、120。",
    "fix": "公共流程覆盖 memory/SQLite，SQLite 保留 reopen；两个操作者分别 pause/resume，并分别重放两个请求，保留原 snapshot、requester、receipt。",
    "files_add": []
  },
  {
    "id": "TP-141",
    "problem": "删除范围包含仍被引用的 gateIndexRef，且与 TP-046 整删冲突；见 A2-verification-chain.test.ts:285、293。",
    "fix": "只删旧注释及 @0 写入，保留 gateIndexRef 和从无索引开始的 gate 追加断言；同步修正 TP-046。",
    "files_add": []
  },
  {
    "id": "TP-142",
    "problem": "漏掉重新打开 Task 的前提，重复调用 helper 会复用 requestId；见 B2-09-crr-owner.test.ts:453、K3-review-card-fixture.ts:379、385。",
    "fix": "公开执行 cancelled→active，helper requestId 加 planRevision，保留重新打开后请求仍 closed@2 的断言；helper 统一划归 TP。",
    "files_add": ["tests/helpers/K3-review-card-fixture.ts"]
  },
  {
    "id": "TP-143",
    "problem": "存储提交与纯 codec 两种实现未定；见 t-items-TP.md:970、B2-execution-entry.test.ts:218。",
    "fix": "固定迁到 execution-entry-codecs-pure.test.ts，通过 materialRecordSchemas 的 Run validate 验证唯一错误 entering/kernel:null，保留原拒绝原因，不建 backend。",
    "files_add": ["tests/state/execution-entry-codecs-pure.test.ts"]
  },
  {
    "id": "TP-144",
    "problem": "model-request 删除范围没有到测试末尾；见 B2-model-request.test.ts:50、54。",
    "fix": "删除两个完整测试：B2-execution-entry.test.ts:86-115、B2-model-request.test.ts:27-54。",
    "files_add": []
  },
  {
    "id": "TP-145",
    "problem": "动作漏列第二条 Session 丢失测试；见 B2-model-request.test.ts:12。",
    "fix": "明确删除 B2-execution-entry.test.ts:59-70 和 B2-model-request.test.ts:12-25。",
    "files_add": []
  },
  {
    "id": "TP-146",
    "problem": "仍指定内部事实写入，合同测试兜底没有目标和断言映射；见 t-items-TP.md:991。",
    "fix": "标记 BLOCKED，删除合同测试兜底；先冻结真实 Kernel 身份冲突触发点及零部分提交断言映射。",
    "files_add": []
  },
  {
    "id": "TP-147",
    "problem": "running 和竞态结束均由手写 entered/result 造出；见 t-items-TP.md:998。",
    "fix": "改真实 Runtime prepare/start，running 用模型闸门保持，竞态在 lookup 闸门中等待真实结束并停在 Workflow TaskReduction 前。",
    "files_add": []
  },
  {
    "id": "TP-148",
    "problem": "结束和归档路线未定，直接健康写入不合规则，取消也不能产生 unavailable；见 R4c-execution-read.test.ts:218、t-items-TP.md:1005。",
    "fix": "标记 BLOCKED，先冻结真实 Host 探测 unavailable、公开结束重排领取和归档的完整链，保留 Session/Lease 语义断言。",
    "files_add": []
  },
  {
    "id": "TP-151",
    "problem": "转换路线未定且含 F3 写入，前置写入后计数没有重新开始；见 R4c-task-claim.test.ts:276、R4c-task-claim-boundaries.test.ts:106。",
    "fix": "固定公开 claim 后进入前 cancel；第二条再公开换 Plan；前置完成后清零委托计数，保留被拒领取的零提交、一次 lookup 和 busy。",
    "files_add": []
  },
  {
    "id": "TP-157",
    "problem": "checksUnplaced 删除或改零存在两种读法，并与 TP-090 重叠；见 t-items-TP.md:1068。",
    "fix": "固定保留 checksUnplaced:0，删除旧轮次前提及旧值断言，同步修正 TP-090 范围。",
    "files_add": []
  },
  {
    "id": "TP-163",
    "problem": "要求继续手写或改变期望，且 running Run 不能公开开验证轮；见 t-items-TP.md:1110、evidence-service.ts:1070。",
    "fix": "标记 BLOCKED，先冻结公开可达的 GR 世界及 GR06/GR07 逐断言映射，删除手写或改期望的选择。",
    "files_add": []
  },
  {
    "id": "TP-164",
    "problem": "Query 准入文件缺白名单；见 src/core/work-graph/queries/query-execution.ts:1072、1079。",
    "fix": "纳入 Query 准入文件，本条与 TP-009/054/130 同批，不单独删除 AD05。",
    "files_add": ["src/core/work-graph/queries/query-execution.ts"]
  },
  {
    "id": "TP-165",
    "problem": "Run/AD06 仍手写 Runtime/Host 事实，AD08 未建立真实 @7；见 S3-prepared-context-admission.test.ts:518、547、553。",
    "fix": "上游 Run 用真实 Runtime；AD06 标记 BLOCKED，先冻结未进入故障及 Host reconcile；AD08 公开推进 Workspace 到 @7 后真实 prepare，再公开变更至 @8。",
    "files_add": []
  },
  {
    "id": "TP-166",
    "problem": "删旧通知后仍保留 items[1]；见 S5-notices.test.ts:206、209。",
    "fix": "把 209 行两处 items[1] 改为 items[0]，保留唯一 fresh 通知位置及 corrupt-origin 拒绝断言。",
    "files_add": []
  },
  {
    "id": "TP-167",
    "problem": "唯一的策略变化不改历史通知断言被设为可选；见 S5-notices.test.ts:279、283。",
    "fix": "强制迁移到当前 cap=3 的后继轮，公开把当前策略改为7，断言历史通知及 cap 仍为3，再删除旧 unknown-cap 场景。",
    "files_add": []
  }
]
```

**6. 核对范围**

完整核对了 **TP-087 至 TP-172，共 86 项**，包括指定行、符号、删除覆盖、合并目标、转换路径、关联调用、白名单和组内顺序。上表列出了需要修改的条目。

以下条目在本次限定检查中未另发现需要改单的问题，但仍受上文列出的共同前置和同批要求约束：

`TP-087、088、090、092、093、095、097、098、100、104、107、111、112、113、114、116、119、120、123、125、126、127、128、129、131、133、134、136、140、149、150、152、153、154、155、156、158、159、160、161、162、168、169、170、171、172`。

**TP-001 至 TP-086 只通读并用于交叉依赖核对，没有作独立完整审查，不据此判为干净。** 其他组只检查了本组牵连的白名单和相关条目，没有审查整组。