# R4：持久控制、安全点确认与原 Run 恢复

状态：2026-09-27，R4.1持久受理、R4.2工具组安全点、R4.3a本地控制投递/真实观察及R4.3b取消后的历史消费均已实现并导入；取消后同Session第二正式Task已验证。§1及各阶段派发段保留当时前态，不作为当前缺口清单。fresh resume/冷恢复、预算与完整Host控制仍按后续批次推进；本任务不代表完整生命周期完成。每批继续沿 Astra 契约→DSH骨架/测试→中审冻结→实现→独立验收，原工程只读，Kernel变更仍走受管补丁。

目标闭环：持久 control intent → 新动作屏障核控制并 CAS → 真实 Kernel pause/cancel → 原历史证据确认 → 保留原 Session/Run/Turn 恢复。发送信号不等于停止，暂停不等于释放，unknown 不等于可重试。完整 pause/cancel/resume 产品路径必须逐批接完，不能交付一个长期统一 unsupported 的门面冒充完成。

## 1. 当前复用与真正缺口

读取入口：docs/AGENTS.md、IMPLEMENTED-CAPABILITIES.md、modules/core/work-graph.md §6.3、modules/core/agent-runtime.md、PARALLEL-COLLABORATION.md。能力索引已更新 B2/M2/Runtime 当前接线；本批仍沿下列真实源码核对控制缺口，历史状态描述不替代当前实现。

- `contracts/dispatch.ts` 的 RunSnapshot@1 已有可选 controlState：intentRef + desiredState（running/paused/cancelled/steered）。RunStatus 仍为 starting/running/ended；暂停不需要把 Run 结束，也不新建执行真相表。
- next `contracts/control-intent.ts` **只有 ControlIntentRef**，尚无 snapshot、writer、ack、codec、注册和公开 consumer。旧工程 `src/contracts/control-intent.ts`、`src/control/control-engine/control-intent.ts` 可只读复用“intent 与 Run.controlState 同事务”“旧 ack 不覆盖新 intent”“取消归约区分 terminal_without_cancel”等语义，不搬 Ledger engine。旧 `execution/worker-runtime/lifecycle-control-adapter.ts` 明确是 FakeLifecycleControlAdapter，不是生产停止证据。
- `tasks/execution-entry-service.ts` 已有身份/代次、fresh begin、原回执、WG12 history compile、mergeGuards；model-call 两个 fresh 方法共享 admitEnteredRun。当前**没有 Run.controlState fresh 控制门禁**，authorize 的 Goal desiredState 检查不能代替 Run pause/cancel。
- M2/B2 材料准入由独立批次完成，控制批次复用合入后的共享 admission/guards，不回退材料授权。Session occupancy generation 与 entry generation 不混同；暂停保留原 TaskAttempt、Claim、Session occupancy、WorkspaceLease。
- `execution-driver.ts` 仅在 fresh begin committed 且 replayed=false 后进入 Kernel，已 begun/entered 的 startRun 只 observe；awaited before_model 已生产真实 entered 来源。`observed-model-run.ts` 已透传 controlHooks、executionIdentity、sessionContext。
- `execution-observation.ts` 定向读取 position window，复用 Kernel reducer/invariants/transcript validator；真实 terminal 且工具已结算才 recordRunResult。paused 当前只推进非终态 locator，**没有 pause ack**。没有 locator 或非 entered auth 直接返回，**entering 崩溃窗口缺完整对账生产者**。
- session-operations 的 cursor owner、KernelStoreRegistry 的 Host 映射和 WG locator继续复用。平台不复制 reducer、历史或全 Session 扫描。
- driver 尚无独立于 RPC caller signal 的受控执行 handle、持久 control consumer、旧驱动者停止证明和 fresh resume admission。ModelBudget.entries 在内存，driver persist 回调为空；重建 meter 会失去旧请求预留。

## 2. Kernel 已核实能力与限制

公共 `resumeCodingAgent(input)` 默认选择 **latest Turn**，没有公开 target 参数，不得直接恢复平台指定旧 Run。现成精确路径是公共 `runCodingAgent` 的固定 executionIdentity 分支：找到原 turn.started，`assertSameExecutionContent` 后内部调用 `resumeCodingAgentInternal(input,{runId,turnId})`，不追加第二个 turn.started。平台复用这一公共分支，不导入 Kernel 私有函数；仍须先取得独立 fresh resume 许可，不能让 startRun 回执重放自行变为恢复授权。

`app/composition/control-hooks.js` 支持 before_model continue/pause、before_tool continue/pause/block。after_tool、modify/fail 控制路径明确不支持。pause 必须由 required Session sink 持久化 run.paused 后返回；进行中的模型/工具不能靠 Hook 立即暂停。AbortSignal 走取消，不可 ack 为 pause。

RuntimeRunner.resume 保留原 RunState usage/elapsedMs；RecoveryCoordinator 沿原 Turn/checkpoint/events恢复。中断 model.request 记录 process_interrupted 后可继续；已有 tool.started 而结果未知会记录 tool.outcome_unknown 并得到 side_effect_result_unknown，不自动重跑工具。RunnerBusyError 只保护一个 runner 实例；SQLite append CAS 不是跨进程外部副作用互斥锁。

Kernel RecoveryCoordinator 当前内部读取全 Session 再选目标 Turn。平台不复制该扫描，也不宣称该 Kernel 路径已只读目标区间；性能优化另立受管补丁批次。

审计时 next/vendor/coding-agent/dist/app/composition 三文件 SHA-256：

- composition-root.js：1613ca294c5376dcb881ce927cb4033607a1e1ee20e72343334fa9dd2d2a3a53
- resume-composition.js：4d83b79362b3663bd1ccadf13e8d0819af9ca99e42865c38ce83361550988aef
- control-hooks.js：f4b3450871e2b9c8a1ee5ced6e4d63d11b7fb3200a483d4d68b95d703e290a1a

### 2.1 before_tool 分组屏障缺口

runtime-runner.js 约 435 行先对整个 pending 批次跑完 before_tool，约 483 行后才计算 groups 并执行；组间没有再次 before_tool/#checkStop。第一组悬停时到达 pause，后续组可能已经通过旧检查，仍会启动。因此仅平台 Hook 读取 intent 不足以保证阻止下一未开始组。

必须单独做真实红测与受管窄补丁：把控制检查放在实际组启动前，保留 required tool.started → execute 顺序和原组并发语义。不要重复调用全部 Hook 造成 block/审计重复；由中审冻结迁移既有时点还是增加内部检查。组内一项要求 pause 时未开始的同组工具应一起保留，已 settled 工具不能重跑。平台不得重写 Kernel 工具调度。

RecordStore CAS 与 Kernel/tool/provider 不是同一事务：控制先提交、动作尚未获得 fresh admission 时必须阻断；动作已一次性获准进入外部窗口后，后来控制属于在途停止/对账，不能声称副作用从未开始。信号用于催停，完成结论仍靠原历史。

### 2.2 完整 config、固定 limits 与绝对 deadline

RecoveryCoordinator.#assertCompatibleEnvironment 先要求完整 config 相等（含 limits、工具 schema digest、baseConfigDigest、model），随后才核有效约束。后者虽允许收紧，当前公开恢复路径**不因此普遍接受 config 变化**；减少工具或调整 limit 也可能先 conflict。

平台 kernelRunLimits 每次把 TaskBudget 绝对 deadline 换算成剩余 duration，暂停后重算会改变 limits/config；与累计 elapsed 混算还可能重复扣时。恢复须从可信 turn.started 取原实际 Kernel limits/config/contextBasis，沿原身份使用原有效值，让 Kernel继续累计计数/elapsed。平台在 fresh resume、每个模型请求和实际工具边界独立核绝对 deadline；固定 Kernel limits 不允许绕过这个时限。

当前 Host/Role/material 仍须重核。Host 新配置不能合法匹配原约束时明确 conflict/需配置处置，不能换新 Run 假装 resume。需要支持安全收紧配置时单独评审 Kernel 比较规则，不偷偷绕过。原 provider wrapper 继续应用 systemInstruction、model permit、input/context digest；不以恢复时最新历史替代原输入。

## 3. 最小契约方向

扩充既有 ControlIntentRef 的窄 next 数据契约，不复制旧整套接口。ControlIntentSnapshot@1 至少保存完整 runRef、kind(pause/cancel/resume)、desiredState、queued/applied/rejected/outcome_unknown、bounded reason、提交时间、resumeFromIntentRef及原执行身份绑定的确认。ack只存来源定位/结论，不存整段transcript。Run.controlState仍指当前intent；如需observedControl/恢复绑定，使用RunSnapshot@1内可辨认的versioned字段，保留旧缺字段读取，不擅自改外层schema。

建议沿 GraphWrite/WriteResult/ReadResult 冻结窄 WorkGraph port：

- submitControl(ctx, GraphWrite<{runRef,kind,reason,resumeFromIntentRef?}>)：expected Run pin，原requestId；同一事务写intent和Run.controlState/revision。调用者不能提供ack、observed status、Kernel身份或权限。回执先恢复。
- readControl(ctx,intentRef)：作用域读取，无副作用，不要求当前Claim/lease/Role仍可执行。
- recordControlObservation(ctx, GraphWrite<{intentRef,runRef,entryIdentity,kernelSource,historyCursor,observation}>)：可信Runtime原历史来源；expected intent/Run pins。pause/resume核原run.paused/run.resumed，cancel核已结算run.cancelled，不用平台eventSeq代Kernel position。
- beginRuntimeResume / recordExecutionResumed：独立窄操作，或中审冻结等价entry扩展；不使旧begin的authorized→entering分支接受任意entered Run。只有fresh committed且replayed=false可实际恢复。

entryIdentity复用consumerId/entryGeneration/sessionGeneration与固定Kernel binding。resume可在原Run递增entry generation/revision并换技术driver；Session occupancy generation、TaskAttempt、Kernel runId/turnId、history startPosition不变。改变代次以前必须证实旧driver停止、工具排空且结果可知；CAS数字本身不能阻断旧外部进程。

旧ack只归原intent/entry，不覆盖新desiredState或释放新占用。可保留历史证据并将旧intent标superseded/拒绝应用；原幂等回执仍可读。

## 4. 操作边界

- submit pause/cancel核Host、目标scope/正式Run、expected，不要求材料仍current或Role仍可用，避免撤权后反而不能停止。
- fresh authorize/begin/model issue/model consume/resume核当前controlState；paused/cancelled阻止新动作，并与实际Run/intent/Role/material/Session局部guards同事务提交。旧model permit消费仍重核。
- 真正工具启动核该动作当前控制/权限/owner，不只核模型边界；共享副作用核实际资源范围，不建workspace全局锁。需要一次性工具admission时复用Run代次与command receipt/event，不建tool engine，DTO在R4.2中审冻结。
- ack/history核原Run/Session/Kernel身份、来源位置、完整证据和intent，不重核开始新工作所需的全链。后来Role/material/Plan变化不应令已发生停止事实不可记录。
- 普通Run、ControlIntent、Session、历史read维持原读scope，不加入当前ownership/lease/material/activePlan全链。历史可读不是执行许可。
- 原receipt replay先恢复，不重做fresh gate、不重复模型/工具/abort/resume。

## 5. 实际状态与 ownership

pause提交只代表期望。原调用可在途完成，下一实际安全点停止新调用；run.paused已持久化、无running/unknown工具、driver本次调用已返回且资源清理结束后才确认paused。保留Session与实际资源占用，不写ended、不推进完成historyCursor、不变idle。

cancel提交后向同身份active driver发取消。Runtime持有独立AbortController，caller signal可联动；控制命令使用自己的signal。内部登记表只保存handle/controller/done，不成为第二正式状态。无handle不代表旧进程消失。仅原已结算cancelled terminal且完整tool exchange可归约取消并按同代次释放；ignore signal、drain超时、outcome_unknown、历史缺口保持unknown/pending且不释放。自然完成不能被后来cancel改写为“成功取消”。

resume点名原已确认pause intent，沿原Run/Session/Turn和不可变输入。必须有可信Host证明旧driver停止或不再拥有执行能力，再fresh提交恢复许可。local map空、心跳超时、Kernel无记录、数据库可打开都不是证明。跨进程恢复确缺Host ownership接缝：优先实际进程生命周期能力，必要使用按Run/Session身份的Host owner guard，不能演变为全workspace writer锁。模型不能提供proof。证明缺失时本次pending/unknown；后续必须补冷恢复，不能永久省略后仍标recoverRun=true。

entering崩溃沿固定binding核原turn.started/run.started/paused/terminal；有证据补entered/history/控制事实，无记录仍不证明未执行。只有安全fencing及Host/Kernel共同证明未开始，才可正式未进入处理，否则unknown。不得创建新Run/Turn掩盖窗口。

## 6. 预算连续性

Kernel累计计数复用原RunState/reducer。平台ModelBudget还承担请求前保守输入/输出预留，仅完成usage不足以覆盖崩溃未知请求。先复用ModelRequestPermit的requestId/attemptId及原model.request_started/usage事实，核出确缺的预留数值；需要新字段时追加到既有模型请求证据/Run versioned budget binding，与一次性消费同事务，不新建预算库。

恢复按request identity去重，核Kernel usage；未回报预留继续占额度，不能因中断自动归还。meter从可信事实初始化，不重建空entries/emptyPersist。Host容量与Run预算仍取交集，绝对deadline跨暂停重启流逝。

## 7. 串行实施批与真实测试

下列是待冻结的owner/文件候选，不是一次写授权；主审预建新文件，每批测试在骨架阶段写、实施阶段只读。Runtime/M2/C1在途改动先合入再刷新。

### R4.1 持久intent与四fresh屏障

候选生产：contracts/control-intent.ts；core/work-graph/tasks/control-contracts.ts、control-service.ts；persistence/control-record-codecs.ts；tasks/execution-entry-service.ts、model-call-service.ts。必要Run codec沿真实导入链确定后列单文件，不用glob。复用controlState、GraphWrite/CAS，不碰Runtime。先durable/fence，再允许信号投递。

测试：同request原回执；控制在最后fresh读后提交使四屏障CAS失败；issued model permit在cancel后不能consume；撤材料/Role仍可cancel；旧receipt与普通历史不因新控制误拒。新writer骨架显式unsupported，交付后停止中审。

### R4.2 Kernel实际工具组安全点

R4.1验收后单独冻结受管补丁：next管理的runtime-runner源补丁、既有build-kernel-patch.mjs确定性重建声明；禁止改原Kernel源或手改dist。由sourcemap sourcesContent提取，沿SQLite/history-export既有补丁流程。新增公开声明如必要必须最小且旧导出不回退。

真实Kernel测试：一次模型给两个顺序工具组；第一组悬停时pause，释放后第二组零调用且原日志run.paused；原Turn resume后第二组一次、第一组不重跑。cancel/unknown测试用实际runner/sink；保留parallel group及工具配对。若现有公开API有更窄合法方式能满足同一反例，先展示真实测试证据再取消补丁，不能仅凭before_tool名称跳过。

### R4.3 Runtime pause/cancel与原历史ack

候选生产：agent-runtime/execution-contracts.ts、ports.ts、runtime.ts、execution-driver.ts、execution-observation.ts；新增窄execution-control.ts只组装Hook/active handle/投递，不建第二状态机；R4.1 control-service/codecs追加冻结ack。

handle在外部调用前登记，finally排空后移除；close跟踪整次活动。durable在投递前，caller取消不阻断内部证据收尾。pause不释放，cancel terminal沿原result释放。

测试：真实before_model暂停零provider；工具中pause保持queued直到安全点；abort已送但工具仍悬停不ack；ignore abort后unknown不释放；自然completed与cancel竞态不假cancelled；旧pause ack不覆盖新cancel；重开原历史补ack无新provider，读历史不依赖当前材料授权。

### R4.4 预算与可信旧owner证明

先冻结缺字段再施工，避免与R4.3并改driver。候选：execution-contracts.ts的Host ownership seam；model-budget.ts的可信初始化；现有model-call contracts/service/codecs必要预留证据；execution-control内部handle生命周期。独立helper仅在主审确认无法内聚后预建。Host进程证明若需OS adapter明确另列，不以map空替代。

测试：两个driver竞相resume仅一fresh获准；旧driver在途副作用不得takeover；真实usage和未回报预留跨实例保留；耗尽token/model次数零新增调用；暂停期间过绝对deadline零provider；完整config/原limits保持；历史缺约束仍可读但不能继续。

### R4.5 原身份恢复、entering对账与平台消费

R4.1–4完成后冻结：WG entry contracts/service/control ack；Runtime driver/observation、observed-model-run、execution-contracts/ports/runtime；composition/create-platform.ts。必要execution-resumption.ts只负责沿原身份调用，不复制Kernel恢复器。共享codecs先冻结，再分lane。

公开控制返回durable intent及真实观察状态，request receipt不是完成ack。门面组合submit与投递，内部raw ports、新public调用纳入close；不丢弃未跟踪后台Promise。无模型Host时原Session/history仍可用。

精确executionIdentity公共分支恢复原input/contextBasis/limits/映射；fresh beginRuntimeResume后才调用，run.resumed原事实确认后放行新model/tool。startRun的receipt replay仍不能偷偷恢复。

真实SQLite/Kernel测试：pause→旧driver退出→平台重开→resume原Session/Run/Turn，turn.started不增；已完成模型/工具不重跑；后续Turn存在时不误选latest；恢复响应丢失重试不二次执行；entering响应丢失沿原Turn补entered；无历史且不能证明停止保持unknown；late旧owner不释放新generation；仅已结算terminal推进完成historyCursor。

R4.5通过才在真实支持Host范围声明safePointPause/cancel/recoverRun。continueHistory/nativeCompact/scopedWorkspaceWrites各自独立验收，不能一并打开。

## 8. 产品范围与限度

本闭环先覆盖正式TaskClaim Run。QueryRun沿QueryJob正式close/cancel，协议closed不证明Kernel停止，必须适配自己的身份与最终观察，不强转Run。Steer需要durable payload、安全点delivery、ack及实际上下文消费；现有Hook不支持任意输入替换，应另立窄Kernel/Runtime批次，不能假applied。native compact及维护占用不随本批完成。

限制须具体出现在capabilities/rejection/用户状态：只能安全点pause；无法证明旧owner退出时不可cold takeover；unknown不自动重试；旧历史缺约束不继续；完整config比较约束配置变化恢复。它们不是把全部控制永久留unsupported的理由。

当前只交付本设计，未执行生产实现。主审下一步冻结R4.1 DTO/codec/红测，并把R4.2分组时点反例列入受管Kernel批次；每批验收后继续直到产品闭环完成。

## 9. R4.1 第一阶段施工契约：durable intent 与四个 fresh 屏障

本节为 2026-09-26 当前 main 源码核对后的待主审冻结稿，收窄 §7 的 R4.1 候选范围。第一阶段只生产 pause/cancel 的 **queued 意图**及 fresh fence，公开返回“已持久受理”，不返回 paused/stopped/cancelled 执行完成结论。不同时派发 R4.2–R4.5；resume、steer、ack、信号投递、Kernel Hook、工具组安全点、owner 证明和预算恢复均无本批实现授权。

### 9.1 复用与共享屏障

当前 RunSnapshot.controlState 已含 intentRef + desiredState，外层仍为 RunSnapshot@1。四个 fresh 操作的现有事务都包含 exact Run revision guard：authorizeRuntimeEntry、beginRuntimeEntry 自己组装；authorizeModelRequest、recordModelRequestAttempt 经 admitEnteredRun 和 claimChainGuards 组装。B2 的 admitExternalMaterials 与全部 Role/material/Claim/Session guards 原样保留。

Control writer 每次在一个 commit 中同时新增 intent、递增同一 Run revision 并更新 controlState，已有 Run CAS 即覆盖“读到无控制，控制随后提交，动作再提交”的窗口。因此不新增 ExecutionEntryDependencies.controls、全局 horizon、控制租约、缓存或第二执行状态表。本批 intent 不可独立修改；四屏障不为已阻断动作重复加载整个 intent。Run 上 canonical desiredState 是 fence，intent 是持久命令/回执来源，不能通过修改 intent 单独放行。

在 execution-entry-service.ts 内新增纯共享 `freshRunControlProblem(run): CoreRejection | null`，只接三个调用点：

1. authorizeRuntimeEntry 原回执 lookup miss 后，readAdmissionFacts 成功后；
2. beginRuntimeEntry 原回执 lookup miss 后，readAdmissionFacts 成功后；
3. admitEnteredRun 事实读取成功后，两种模型 fresh 写自然共用。

不得将 gate 放进通用 readAdmissionFacts：entered/result 也用它。无 controlState 保持原准入；paused/cancelled 返回 busy，reason 点名当前 intent/desiredState，不能称执行已停止。已有合法形状的 running/steered 保持普通可读，但本批没有其解封证明，fresh 返回 unsupported，不把任意 running 指针当 resume 许可。损坏字段由 Run codec 拒绝，不猜成 absence。model-call-service.ts 保留原 shared helper 消费，不加第二分支或依赖。

### 9.2 最小 DTO 与公开 Host port

沿用 contracts/control-intent.ts 的完整 ControlIntentRef，RunRef 和 ActorRef 复用原定义。新增：

```ts
type ControlIntentKindV1 = 'pause' | 'cancel';
type ControlIntentSnapshotV1 = {
  schemaVersion: 1;
  ref: ControlIntentRef;
  revision: 1;
  runRef: RunRef;
  kind: ControlIntentKindV1;
  desiredState: 'paused' | 'cancelled';
  status: 'queued';
  reason: string | null;
  requestedAt: string;
  requestedBy: Extract<ActorRef, { kind: 'human' | 'system' }>;
};
type SubmitControlInput = {
  runRef: RunRef;
  kind: ControlIntentKindV1;
  reason: string | null;
};
type SubmittedControl = {
  intent: ControlIntentSnapshotV1;
  runRevision: number;
};
interface RunControlPort {
  submitControl(ctx: CoreCallContext,
    request: GraphWrite<SubmitControlInput>): Promise<WriteResult<SubmittedControl>>;
  readControl(ctx: CoreCallContext,
    ref: ControlIntentRef): Promise<ReadResult<ControlIntentSnapshotV1>>;
}
```

GraphWrite 保持真实 `{input,meta}`；meta.requestId/expected 复用 CommandMeta。expected 恰好一个完整目标 Run pin，不要求 caller 提交 intent/Session pin、Kernel identity、权限或 stopped 证明。reason 为 null 或非空、最多 2,048 UTF-8 bytes 字符串，不裁切。caller 不得填写 ref/revision/status/desiredState/requestedAt/requestedBy；未知 kind、多余输入字段 invalid。不要宣告尚无实现的 resume 方法。

factory 为 `createRunControlService({records,authority,now,eventId}):RunControlPort`。records 复用 GoalRecordTransactionPort；authority 复用 MaterialAuthorityReads 的精确 Run load，组合根传同一 reads.authority。这是内部 raw 依赖，不是对模型授材料权。仅沿完整 RunRef 读取并经原 Run codec 解码，不走 WG11 当前 lease/Session/active Plan/Role/材料链，不新建 Run reader/decoder。

两个方法仅接可信 Host ctx，复用既有 ctx/actor/workspace 校验、同步快照和真实 signal 惯例；Host discriminant 本身不把模型输入变成授权。submit 核完整 RunRef/ctx.projectId、持久 Run.workspaceSnapshot.workspaceId/ctx.workspaceId。read 只验可信 Host 及 ref 的 project/workspace 作用域，精确读取 intent；不加载 Run/Role/Session/材料。历史 intent 不因 Run ended 或新 intent 覆盖而消失。

### 9.3 写集合、身份与回执

身份槽采用独立前缀 r4-control-submit: 加 canonical projectId/workspaceId、Host actor kind/id、requestId；完整 runRef、kind、reason、唯一 expected Run pin 入 fingerprint。kind 不放进 identity 槽，避免同 requestId 改 pause 为 cancel 获得第二次写。intentId 从稳定身份 SHA-256 派生，不用重试时随机 ID；新 intent exact ref guard 为 null。

顺序：隔离 ctx/input → shape/scope/expected 校验 → identity/fingerprint → lookupCommit 恢复原回执 → 仅 miss 才读当前 Run、核 expected/status、构造提交。完全相同原请求带旧 expected 仍先回原 receipt；不能替用户刷新 expected 后声称是原请求。commit 确认丢失只在同 identity+fingerprint lookup 真正 found 且恢复原 event 后返回 committed；找不到或读失败则 unavailable/提交结果未知，不宣称未提交。提交后 caller 取消不抹去 committed。

fresh submit 支持 starting/running 的正式 Task Run；ended 为 busy、缺 Run 为 not_found、expected 不符 revision_conflict。同 desiredState 已为 paused/cancelled 的新 request 返回 busy，不增无意义 intent。cancel 可带当前 Run pin 取代 queued pause，pause 不能削弱 cancelled fence；历史 running/steered 指针允许请求 cancel，不据此授继续执行权。不提供清除 controlState 的 writer。原 pause intent 保留 queued 历史事实，仅说明曾受理；当前目标由 Run.controlState 指向。ack/supersession 在 R4.3 冻结。

一个 PreparedCommit 精确包含：

- guards：原 Run revision + intent exact ref/null；身份唯一槽复用 Store，无额外全局 guard。
- records：保留完整 Run 其它字段，仅 revision+1 和 controlState={intentRef,desiredState}；新增 ControlIntentSnapshot@1。
- events：一个 ControlIntentSubmitted@1，含 identityKey/fingerprint/真实 actor/occurredAt/原 SubmittedControl 返回值。
- claims/indexChanges/indexGuards 为空；不改 TaskAttempt、outbox、Lease、Session、Kernel/history、authorization phase 或预算材料。

同 Run 以同 pin 提交 pause/cancel 只能一方新成功；另方 CAS 冲突后由 Host 明确新 request/新 pin 再提交。不同 Run 无关。Store 返回 replayed 也从 immutable event 精确恢复原值，不从当前 Run/latest controlState 拼回执。

### 9.4 Codec、兼容及历史边界

新 persistence/control-record-codecs.ts 唯一拥有 ControlIntentSnapshot@1、ControlIntentSubmitted@1、encode/decode、CONTROL_RECORD_SCHEMAS 和纯 runControlStateProblem。snapshot 核 ref/runRef project 对齐、revision=1、kind/desiredState 配对、status=queued、reason/时间/actor；event 复用同一值校验并核身份/ref。无新 lookup，按 intentRef 直读、eventAt 精确回放，不扫日志。

materials/record-readers.ts:validateRunSnapshot 复用该纯 helper，验证可选 controlState 完整 ref、四种已有 desiredState 以及 intentRef.projectId/workspaceId 与 Run 对齐。无字段旧 Run 继续可读，合法 running/steered 不被 codec 当损坏；不改 dispatch 外层或现有嵌套 shape，不注册第二个 Run schema。纯 codec 不 import reader/service，避免循环；新 writer 沿 RunSnapshot@1 原编码约定，不复制完整 Run validator。

recordExecutionEntered、recordRunResult、WG12 history writer、ordinary read 不新增控制 fresh gate。控制在 begin 后到达，领域 API 可重新读取当前 Run pin，按原身份来源记录 entered/terminal，下一 fresh model issue/consume 被挡；不能篡改原回执。当前 Runtime driver 使用 begin 返回的旧 pin，entered CAS 冲突后 observer 尚不会补 entered，自动对账须在 R4.3/R4.5 接通。现有 recordExecutionEntered 仍核 Host/Role，因此撤权后的 entered 对账也尚未闭合；本批不虚报已修好，不新增此门槛。recordRunResult 已不核新动作授权，终态事实继续保留。控制不改 authorization revision，caller 不猜新 permit。

线性化含义：控制先 commit，动作旧 Run guard 必须失败且目标写不存在。model issue/consume 不递增 Run，但 issue 仅生成 permit，issue 后控制仍须阻止 fresh consume；只有 fresh consume 成功才开放本次 provider 进入窗口。控制随后提交不能倒推该副作用未开始；R4.2/R4.3 才负责实际安全点和投递。R4.1 不声称能撤销已 consume 的 provider 进入权。

### 9.5 精确 scope 和两阶段纪律

相对 coding-platform/next，生产范围恰为七文件：

1. 现有 src/contracts/control-intent.ts：新增 DTO，保留原 ref。
2. 新 src/core/work-graph/tasks/control-contracts.ts：port/dependencies。
3. 新 src/core/work-graph/tasks/control-service.ts：submit/read/回执恢复。
4. 新 src/core/work-graph/persistence/control-record-codecs.ts：唯一 codecs/schemas。
5. 现有 src/core/work-graph/materials/record-readers.ts：仅 Run controlState 纯校验接缝。
6. 现有 src/core/work-graph/tasks/execution-entry-service.ts：纯 fresh gate 与三个调用点。
7. 现有 src/composition/create-platform.ts：注册新 records/events 一次；构造 raw service，公开 platform.controls:RunControlPort；submit/read 均纳入 trackedCall/close 排空，无 runtime Host 配置仍可用。

测试范围仅新 tests/work-graph/R4-control-intent.test.ts、新 tests/composition/R4-control-platform.test.ts。直接复用 createB2ExecutionFixture(kind,additionalSchemas) 注册 CONTROL_RECORD_SCHEMAS，现有能力已足够，不改 shared fixture、不另建大 fixture。

dispatch.ts、model-call contracts/service/codecs、ExecutionEntryDependencies、Runtime/Kernel/vendor 及其它文件只读。额外需求先报精确原因由主审调整，不擅扩 scope。不编造运行中换 Role 或直接篡改持久记录的产品场景。

骨架阶段新 writer/read 明确 unsupported；codec 导出签名/schema 名完整但不提前实现 reducer/validator，注册集合按既有骨架惯例为空占位。组合根可声明并 tracked 包装 unsupported port，不开后台工作。fresh helper 预置调用点时，有 controlState 明确 unsupported、无 controlState 保持旧路径；不要提前实现 pause/cancel 门禁。原 Run reader 保持旧无字段记录可读，不借骨架宣称 codec 绿。

2026-09-26 中审裁定：本批 `runControlStateProblem` 已实现的窄形状检查作为 Run reader 兼容接线审核保留（无字段、完整 ref、四态、局部 scope）。它不受上述“snapshot/event validator 待实现”占位约束；不把合法旧 running/steered 普通读取改成 unsupported，也不增加公开生命周期不存在的业务校验。ControlIntentSnapshot/event 的 codec、writer 及 fresh pause/cancel 判据仍须第二阶段实现。

骨架交付停止中审：真实 fixture 的首红必须来自 unsupported，不能缺 schema/错 claim/伪 Kernel 引用。writer 未实现时后半段竞争断言尚未运行，应准确报告。中审冻结测试后再派实现，实施测试只读。R4.1 与 §10 的 R4.2 无强制先后依赖，可按各自 scope 独立派发；本批不施工 R4.2 或 R4.3–R4.5，旧 §7/§9 开头的串行措辞以此处和各批派发说明为准。

### 9.6 少量真实 writer 红测

以下六组只覆盖新增语义；四屏障小表驱动，不复制 Memory/SQLite 全矩阵。

1. **持久回执**：真实 claim → submit pause，核 intent+Run 同提交、其它执行/占用字段不变；SQLite 重开 read/replay 得原 intent/runRevision/cursor。正式 cancel 取代 pause 后原 pause 完全相同请求仍回原值；同 key 改 kind/reason/expected 为 idempotency_conflict；新 pause 不削弱 cancel。
2. **控制先存在**：分别正式停在 claimed、authorized、entered、issued，真实 writer 提交 pause/cancel，再用当前 Run pin调用对应 authorize/begin/model issue/model consume，均 busy，目标授权/permit不变。前态全部正式 authorize→begin→entered，不 seed Run/auth。已 issued permit 在 cancel 后不能 fresh consume。
3. **最后读后、提交前**：各屏障真实 records.commit 外薄包装中，提交原 batch 前调用使用原 backend 的 control writer，避免递归拦截。控制 committed 后原 batch 必须 revision_conflict；核 auth phase/permit/consumedByAttemptId 未改变、intent queued。不能只断 helper 次数或手改 Run。
4. **已发生与原回执**：保存各 entry/model 原请求结果，控制后精确 replay 仍成功且无第二事件；begin 后真实控制提交，已发生 entered/正式 terminal 仍可按原来源、当前 pin 写入；释放只由已结算 result 决定，不由 intent 决定。固定一条自然 completed 已发生→cancel queued→原 completed 入账的顺序，结果仍为 completed，不能改写 cancelled。复用 B2 合法历史证据，不制造假的停止事实；此组证明领域事实写，不冒称当前 driver 已自动重试 entered。
5. **操作边界与原子性**：可信 Host execution 配置撤权后仍可 cancel（不换 Session Role、不写坏记录）；非 Host/跨 scope/坏输入拒绝。同 Run 同 pin两控制竞争仅一成功，无孤立 intent；另一 Run 不受影响。commit ack 丢失仅实际 lookup/eventAt 找到才恢复；找不到 unavailable，不报未提交。read/replay 不重新要求执行 provider 授权。
6. **真实组合根**：无 Runtime Host 仍可对真实正式 Run submit/read；同 SQLite 重开 replay、schema 不重复。控制调用读/提交窗口悬停时 close 等它排空再关库，关闭后新调用拒绝。该组不启动模型，不声称 pause/cancel 信号已接通。

本批最终只能声明“持久 pause/cancel 请求及四个新执行屏障已接通”。safePointPause/cancel/recoverRun capability 不据此改 true；实际停止与恢复证据属于后续 Kernel/原历史批次。


## 10. R4.2 精确候选契约：Kernel 工具组 awaited barrier

本节为 2026-09-26 第二轮只读源码核对后的**待主审冻结**范围，承接 §7 的 R4.2。主审已确认本节只依赖当前Kernel公开行为，不依赖R4.1新DTO或持久控制writer；可与R5a初始化骨架并行，写范围不重叠。骨架中审后才允许领域实现。此批只补 Kernel 工具组安全点，不接持久控制 consumer、平台 ack/resume/owner 或工具授权 writer，不把任何平台 capability 改 true。

### 10.1 源码依据与最小改动选择

已读原副本 `coding-platform/vendor/coding-agent/AGENTS.md`、`INTEGRATION.md`，并遵守 next `vendor/coding-agent/README.md`、`patches/README.md` 的受管流程；原副本和其构建产物继续只读，不能把历史“kernel:build”作为 next 的构建入口。

以下行号指 next 冻结 `.js.map` 的 `sourcesContent[0]` 原 TypeScript，不是生成 JS 行号：

- `core/runtime/loop/runtime-runner.ts:468–637`：唯一 `#execute` 模型循环；`beforeModel` 在 527 行真实 await，仍在 `model.request_started`/provider 之前。B2 `src/core/agent-runtime/execution-driver.ts` 的 `b2-runtime-entered` 正依赖该 awaited Hook，以原 Turn 历史正式记录 entered。该调用、顺序和权限均不得迁移或复用来伪造组完成。
- 同源 661–711：整个 pending batch 先执行所有 `beforeTool`。720 行才 `ToolBatchPolicy.plan(effectiveCalls)`，722 行开始逐组；727 行 required `tool.started` 成功后，731 行才执行工具。因此上一组在途时到达的 pause 不能被已完成的预扫描看见。
- 同源 745–871：真实等待组内全部 settled；取消后才启用 bounded drain；先持久化 outcome_unknown/工具结果，再处理取消和执行器异常。`afterTool` 在每个结果结算中间，不能保证同组其它结果已结算，且它的 pause 明确 `after_tool_pause_unsupported`。
- `tools/registry/tool-registry.ts` 的 `RegistryToolBatchPolicy`：整个批次均 independentReadOnly 时组为一个 parallel_read_only，否则逐项 serial。继续复用这一个策略，不能另造平台工具队列或把并发组强制串行。
- `#commit` 388–423 经原 `EventDeliveryCoordinator` awaited required sink；`run.paused` reducer/invariant 已允许“无 active model、无 running tool、pendingToolCallId 为 pending 或 null”的稳定边界，无须新事件/schema/RunStatus。

**建议新增独立窄 `toolGroupBarrier`，不迁移或重复执行全部 Hook。** 原 Kernel Hook 还允许 modify，当前是在修改后按 effective calls 分组；直接把 `before_tool` 整体移入预先分好的组，会改变其 modify/分组及 block 语义。新增组屏障只控制继续/暂停，不修改 call/request/result，不对 `after_tool` 开放暂停，也不扩大 Host controlHooks 的 block/modify/fail 权限。既有 `before_tool.block` 仍产生真实 `hook_blocked` 工具错误交回模型。

### 10.2 最小公开签名和传递链

类型定义内聚在受管 `core/runtime/loop/runtime-runner.ts`，由既有受管 `public-api.ts` 纯 type re-export；不新建 manager/Hook 协议或状态表。建议冻结为：

```ts
export type ToolGroupBarrierInvocation = {
  readonly point: 'before_group' | 'after_group';
  readonly runId: string;
  readonly turnId: string;
  readonly lastEventSequence: number;
  readonly callIds: readonly string[];
};
export type ToolGroupBarrierDecision =
  | { readonly kind: 'continue' }
  | { readonly kind: 'pause' };
export type ToolGroupBarrier = (
  invocation: Readonly<ToolGroupBarrierInvocation>,
  options: Readonly<{ signal: AbortSignal }>,
) => Promise<ToolGroupBarrierDecision>;
```

`RuntimeRunnerDependencies`、`RunAppInput`、`ResumeAppInput` 各追加同一个可选 `readonly toolGroupBarrier?: ToolGroupBarrier`。缺省不调用任何新逻辑，原 CLI/Kernel 消费者行为保持。具体对象每次由 Runner 依据当前 state/group 构造，数组复制且不可影响原调度；不得把可变 RunState、call.arguments、执行器或 commit 函数交给 callback。字段均为观察定位，不能被平台当作已持久 pause ack。

传递必须完整：`runCodingAgent` 新建 Runner；它命中原 executionIdentity 后转 `resumeCodingAgentInternal` 的分支；公开 `resumeCodingAgent` 经恢复组合根构造 Runner。三个位置都透传同一 callback；不能只修新启动而在原 Turn 恢复时丢掉。`m5-public-api` 已重导出 RunAppInput/ResumeAppInput，签名自动可达，不另复制类型或扩大 latest-Turn 恢复接口。`kernelSessionApiVersion=2` 和现有导出不回退，平台能力另由完整 R4 验收决定。

### 10.3 精确 await 时点与结果

1. **组开始前**：已得到原策略的 effective group、但本组任何 `tool.started` 尚未提交时，先 `#checkStop`，再 await `toolGroupBarrier(before_group)`；返回后再次检查 signal/deadline，才沿原工具 limit → required tool.started → 原并发 execute 顺序继续。不得先启动组内任一工具，再判断其它成员是否需要 pause。
2. **组完成后**：等待本组所有执行器 settled、所有已知结果的 afterTool 与 required result sink 完成；原 cancel、unknown、executor failure 分支先处理。只有仍为可继续的非终态、无 running/unknown 工具，才 await `toolGroupBarrier(after_group)`。即使这是本批最后一组也必须调用；不能把它延迟为下轮 before_model。返回后再次检查 signal/deadline；continue 才能进入下一组或返回唯一 `#execute` 循环。
3. **暂停**：使用原 `run.paused`，`reason:'operator_requested'`、`requestedBy:'app'`；`pendingToolCallId` 取当前仍 pending 的首项，没有则 null。必须 await 原 `#commit` 成功后 Runner 才返回 paused；required sink 失败沿原失败处理，不假报 pause 成功。已完成组不会因 pause 被改成 pending 或重复执行。
4. **在途和取消**：pause 不 abort 正在工作的组；组内工作和 required sink 悬停时，只是请求等待，不能返回 paused。AbortSignal 仍只走原取消/drain/unknown 路径；取消或 unknown 的优先级高于 callback 的 pause，不能先写 paused 掩盖未知副作用。真实已 completed/failed/cancelled 的终态不调用此 barrier 改写结果。
5. **await 故障**：不得 fire-and-forget、吞错继续或把拒绝当 continue；callback throw/非法返回沿 Runner 的既有失败通道且无新工具启动，不伪造成 pause。此批不新增独立计时器/重试器；调用方沿既有 signal 完成可取消 I/O，callback 未返回时当前调用也不声称停止。真实工具取消排空超时仍只由原 toolDrainTimeoutMs 负责。
6. **授权含义**：这是宿主协作控制的稳定时点，不是跨 WG/Kernel 的原子事务。R4.3 接线时才由可信闭包核原 Run/current intent；外部副作用开始权与同身份 owner/CAS 仍按 §4 的后续冻结。不能因 callback 已 continue 就声称后来意图无法提交，也不能在本批偷偷加全 Workspace 锁、全链查询或一次性 tool permit 引擎。

### 10.4 精确受管 scope 与生成物

相对 `coding-platform/next`，DSH 候选生产源仅五文件：

1. **新** `vendor/coding-agent/patches/core/runtime/loop/runtime-runner.ts`：先从对应 dist map 精确提取，新增上述 DTO/dependency 和组前/组后窄调用接缝，保留唯一模型循环、原调度/结果配对/取消算法。
2. **新** `vendor/coding-agent/patches/app/composition/composition-root.ts`：可选输入、普通启动和固定 identity 恢复转发。
3. **新** `vendor/coding-agent/patches/app/composition/resume-composition.ts`：可选输入及恢复 Runner 转发。
4. **现有** `vendor/coding-agent/patches/public-api.ts`：仅公开三项新类型，不新增私有算法导出。
5. **现有** `scripts/build-kernel-patch.mjs`：`relativeSources` 明确追加前三项，沿同一个 TypeScript 6.0.3/Node24 确定性编译，不新增构建器。

当前精确提取的源 SHA-256：runner `e37887abf5409cc048e491997c022c305c6ae75d3266e074995c583e2741f077`；composition-root `698d49b40753d4e256dea9766bf47d3b1d99a3d82535d65c82a46ae896d07bd4`；resume-composition `677ac4aaca71e8782bfeb9d01f2fdfad4630c773914f47ff165f068a5cba0904`。派发时若基线不同须复核 map 差异，不能强行覆盖。

对应生成物为 dist 下这四个 stem 各 `.js`、`.js.map`、`.d.ts`、`.d.ts.map` 共 16 项：`core/runtime/loop/runtime-runner`、`app/composition/composition-root`、`app/composition/resume-composition`、`public-api`。仅由既有脚本 `--write` 生成，不手编声明、不单独编辑 dist/map。脚本扩展后全部六个受管源应重建检查 24 项；既有 SqliteStores/control-hooks 八项须保持不变。公共 type-only export 的 JS 如无变化应保持原字节，不为凑变更数量重写。

主审持有构建脚本名单冻结、生成物发布审核、check selector 注册以及 vendor 两份 README/本批来源证据更新。DSH 只在批准 scope 中生成候选产物，主审核对后导入；旧 `kernel-packaged-hashes.json` 是历史来源，不覆盖它。`HookExecutor`、`hook-protocol`、control-hooks、ToolDispatcher/Registry、reducer/schema、平台 Runtime/WorkGraph/composition 都不在本批写范围。

测试仅新增 `tests/kernel/R4-tool-group-barrier.test.ts`，不新建共享 fixture。测试只能从 `vendor/coding-agent/dist/public-api.js` 导入生产能力；复用 R4a 已验证的公共 SQLite/ProviderRegistry/RuntimeRunner/required sink 模式，在本文件提供少量可控 Promise 和脚本模型，不引用原 Kernel 私有测试或旧平台运行代码。

### 10.5 少量真实测试与两阶段停止条件

同一文件六组，不复制整个控制矩阵：

1. **组前 await**：真实模型产出合法工具调用，组前 callback 悬停时没有本组 tool.started/执行器调用；返回 continue 后正常执行。before_model 的原 awaited Hook 悬停仍先于 provider，保留 B2 的事实屏障语义，不用该 Hook 代替组屏障。
2. **串行组间暂停和原 Turn 恢复**：公共 runCodingAgent + 真 SQLite + 两个非 independentReadOnly 工具形成两 serial 组。第一组悬停时设置宿主 pause 请求，释放并等结果落盘；第二组零 started/零执行，run.paused 落盘。以原 executionIdentity/input/config/limits 再调用公共入口，正式恢复后仅第二组执行一次、第一组不重跑，turn.started 计数不增。不要通过 raw seed 把 Run 改成 paused。
3. **并发组排空和最后一组屏障**：两 independentReadOnly 工具确实同时进入；一个先返回而另一仍悬停时 after_group 尚未调用、无 paused。两者真实结果及 required sink 完成后才到 after_group；该 callback 等待期间即使没有下一工具组，也无下一 provider/下一 before_model。释放 pause 后落盘暂停，明确区分组屏障与模型屏障。
4. **required pause sink**：真实 Runner 配 required sink，pause event 的 sink await 悬停期间 run Promise 未返回 paused；sink 拒绝时不返回成功 paused，不启动下一工具。沿原 delivery failure 处理，不另造暂停 ack。
5. **cancel/unknown**：在真实第一工具组中触发 AbortSignal，使用可控执行器分别返回已知 cancelled 和忽略 signal 至原 drain 超时；真实事件区分工具结算与 outcome_unknown，第二组零调用，不写 paused、不自动重跑未知工具。此测试证明 Kernel 保留未知事实，不证明平台已安全释放 Session。
6. **Hook/旧路径不退化**：`before_tool.block` 仍仅一次反馈为配对工具错误；无 callback 的正常串行/parallel 公共路径仍可运行，既有 modify 后调度能力不因新 barrier 被删。原 R4a 公共恢复及 B2 Runtime 测试作为相邻回归只读运行，不改其冻结测试。

骨架阶段先精确提取并确认原产物可逐字再生，再只加类型/可选透传/显式 unsupported 接缝；未提供 callback 保持旧行为，提供 callback 的新边界不得悄悄忽略而把工具执行成功。不得提前实现真实 pause/drain/新的控制规则。测试断言最终行为；首红应由显式新接缝而非错误工具注册/权限、缺 schema 或错误恢复输入造成，已被首红遮挡的恢复/并发后半段必须如实报告。交付停止中审，冻结后实现阶段测试只读。

实现独立验收包括新专项、next types、受管 `--check` 全 24 项逐字再生，以及既有 R4a 公共 Kernel、B2 history export/Runtime 邻接集合；确切 selector 由主审注册，不使用原 Kernel 全工程重建。R4.2 最终只可声明“Kernel 已有真实工具组 awaited 安全点并保留原身份恢复行为”，平台 safePointPause/cancel/recoverRun 仍须等 R4.3–R4.5 持久投递、ack、预算和旧 owner 证明实际闭环后开启。

### 10.6 骨架中审返修：加强实际时点与收尾断言

四受管源、type-only公开导出、run/resume三处透传和显式unsupported接缝已独审通过；源码映射与产物对应，构建名单不变。仍是Stage1，不实现pause，不改4源或生成物；本次只改 tests/kernel/R4-tool-group-barrier.test.ts。保留六组而不扩为全矩阵。

- group3必须在真实tool result的required publish内设置独立entered/release：工具均已返回但sink尚未settled时，after_group不可进入、不可paused；释放结果sink后才允许last-group callback。现RecordingSink立即完成不足以证明该边界。
- group2恢复callback不能仅恒continue。恢复原identity时，在第二组before_group短暂await，断该callback实际收到正确group/原runId/turnId、第二组尚无started/execute，释放后仅第二组执行。这样三处透传中的identity→resume丢失会实际失败，不另造Run或seed paused。
- group1/before_model/group3/pause sink等所有可控Promise用try/finally释放并等待tracked.outcome清理；assert失败也不能遗留执行或SQLite。骨架unsupported到达时，竞速观察正常完成并准确报目标红，别等永远不会到达的开关。
- group5断真实g5-a cancelled、g5-b outcome_unknown、g5-c没有started/执行，after_group零次；仍走原40ms drain，不伪造事件或内部状态。

主审独立目标为6红/61绿（包括旧公开Kernel/Runtime），next-types与24项再生通过。返修只补真正消费者时序，不把后半段遮挡说成验收。重跑原目标+相邻集合和types后STOP，等待主审冻结测试再实现。

## 11. R4.3 候选契约：持久控制投递、进入事实与原历史确认

本节是待主审冻结的有界候选，不授权实现、预建源文件或派发。以已验收 R4.1 的 queued producer 和 R4.2 的真实工具组屏障为前置；R4.2 回调异常必须在最新工具组 state 上落失败事实，不能从外层旧 state 生成重复 sequence。主审当前异常回归测试 hash 为 `973484cc25714dd53e9d0dd7fa6acee7dd1e42bfd3b2d1f1f27146089d324795`；实际派发仍以之后已审核导入的版本为准。本节不重做 C2/M2，不交付冷接管、resume、维护或预算恢复。

### 11.1 实际缺口与两个串行小批

R4.3a 先接本地活跃执行的 pause/cancel 投递、实际 entered 补记、原历史观察及清理成功后 ack。源码依据：

- `execution-driver.ts` 在 begin 后保存旧 Run revision，before_model 的 `recordExecutionEntered` 使用它；控制在此间提交会使旧 pin 冲突。`enteredFailure` 当前提前返回，observer 又在无 locator／非 entered 时返回，不能自行补上该事实。
- `execution-entry-service.ts:recordExecutionEntered` 在原 permit、Kernel、Session/Lease 校验后重新读取 manifest 并调用 `recheckHostRoleAdmission`；撤销当前授权会挡住已经发生的进入事实。`recordRunResult` 已采用“事实不重做 fresh 授权”的边界。
- `execution-observation.ts` 已按原 locator 分页、复用 Kernel reducer/invariants 和完整 transcript 校验；paused 只推进 locator，ended 提前返回，尚无控制 ack。只在这一归约 owner 加分支，不另写事件扫描器。
- `observed-model-run.ts` 已 finally 等待工具/source 关闭，但只有 completed 时传播 cleanup failure。paused/cancelled 的 Promise fulfilled 不足以证明清理成功。

R4.3b 必须随后完成“取消前未启动工具为 abandoned”的正常收尾与后继 Session 历史消费，见 §11.8。这是普通工具组取消的必达路径，不是长期范围外限制；R4.3a 单批不得声称所有 cancel 已闭合。R4.3b 单独冻结 Kernel/observer 小 scope，不偷偷扩大下面十三文件。

### 11.2 ControlIntentSnapshot@1 的兼容扩展

继续原 aggregate/schemaVersion=1、原 ref 和不可变请求字段，不新增控制状态表。将 §9 的 snapshot revision 从字面量 1 扩为正安全整数，并以 status 区分旧 queued 与新增观察；原提交 producer 仍只写 revision=1/status=queued，旧合法 queued 字节及原 Submitted 事件继续可读。

```ts
// contracts/control-intent.ts；仅依赖 contracts 中的既有纯类型。
type ControlEntryIdentityV1 = {
  consumerId: string;
  entryGeneration: number;
  sessionGeneration: number;
};
type ControlObservationV1 = {
  schemaVersion: 1;
  kind: 'paused' | 'cancelled' | 'terminal_without_cancel' | 'outcome_unknown';
  entry: ControlEntryIdentityV1;
  history: RunExecutionHistoryV1;
  source: RunExecutionHistoryV1['kernel'] & { position: number };
  kernelEventId: string;
  kernelEventSequence: number;
  observedAt: string;
};
type ControlIntentRequestV1 = {
  schemaVersion: 1;
  ref: ControlIntentRef;
  runRef: RunRef;
  kind: 'pause' | 'cancel';
  desiredState: 'paused' | 'cancelled';
  reason: string | null;
  requestedAt: string;
  requestedBy: Extract<ActorRef, { kind: 'human' | 'system' }>;
};
type ControlIntentSnapshotV1 = ControlIntentRequestV1 & (
  | { revision: 1; status: 'queued'; observation?: never }
  | {
      revision: number;
      status: 'applied' | 'superseded' | 'outcome_unknown';
      observation: ControlObservationV1;
    }
);
```

新增分支 revision 必须至少为 2；各次实际观察递增 revision，旧观察留在不可变事件中。kind=paused 只确认 pause 意图；cancelled 只确认实际投递过的 cancel 与真实 run.cancelled；terminal_without_cancel 表示自然 completed/failed/limit 先结束，不能称取消成功。该结论将意图标 superseded，不改 Run 原 outcome。旧 pause 已被新 cancel 取代时，允许把原 pause 的真实观察写为 superseded。outcome_unknown 不代表已停止或可释放，可被后续真实、更晚同身份观察推进；不能靠新请求清除未知。

未观察的旧 queued 保持可读；旧 Run 缺 controlState/executionHistory/V2 binding 仍按原 read 语义读取，不补写历史、不推断已进入或可停止。原 submit 重放返回其事件中原 queued snapshot/runRevision，不读取当前 applied snapshot 拼回执；Submitted event codec 保留“提交时必为 queued@1”的专门约束，不能随着 read codec 扩展而放宽。

### 11.3 唯一观察 producer 与公开投递接口

WorkGraph 不读取 Kernel 数据库。真实来源 producer 是现有 Runtime observer：由同一固定 Turn 的原 SessionRecord 归约获得 source position、原 Kernel eventId/sequence、history 与结论；entry 从该 Run 的正式 V2 authorization 和 claim generation 获取。字段不是模型或公开 deliver 参数。共享 `RunExecutionHistoryV1` 来自 contracts，不能让 contracts/control-intent.ts 反向 import WorkGraph/Runtime。

```ts
// tasks/control-contracts.ts：内部可信 Runtime 事实端口。
type RecordControlObservationInput = {
  intentRef: ControlIntentRef;
  runRef: RunRef;
  observation: ControlObservationV1;
};
interface ControlObservationPort {
  recordControlObservation(ctx: CoreCallContext,
    request: GraphWrite<RecordControlObservationInput>
  ): Promise<WriteResult<ControlIntentSnapshotV1>>;
}
// 同一 factory 返回交集；组合根 public controls 仍只包装原 submit/read。
// createRunControlService(...): RunControlPort & ControlObservationPort

// agent-runtime/execution-contracts.ts、ports.ts
type DeliverControlRequest = { intentRef: ControlIntentRef };
// RuntimeExecutionDependencies 增加同一 raw controls 依赖：
// controls?: RunControlPort & ControlObservationPort;
// RuntimeExecutionPort 增加：
// deliverControl(ctx: CoreCallContext, request: DeliverControlRequest)
//   : Promise<ReadResult<ControlIntentSnapshotV1>>;
```

该依赖对既有直接构造的Runtime保持可选，create-platform正式组合必须注入同一raw controls；无依赖的旧Runtime路径保持原行为，deliverControl明确unsupported，不能伪造已投递。新测试用`createAgentRuntime({...fixture.deps, controls})`装配，不改既有B2共享fixture。

deliverControl 仅接可信 Host scope，先精确 readControl，再按其完整 RunRef 查本地 handle；调用者不能传 runId 替换目标、Kernel 身份、权限、观察或 stopped boolean。公开调用不创建意图，流程为 `controls.submitControl → runtime.deliverControl → controls.readControl/observeRun`；提交本身的返回仍是持久受理，不是假 ack。重复 deliver 不重复创建 driver、Turn 或外部工作；没有匹配 handle 保留 queued，返回真实 intent，不把 local map 为空解释为停止。若已观察则返回正式记录，不再重复 abort。所有公开调用沿原 trackedCall/close。

recordControlObservation 是内部可信事实写者，不在 platform.controls 公开暴露。expected 恰好原 intent 与 Run 当前 pins；使用独立命令前缀、原 requestId/规范 fingerprint、receipt-first、同键恢复和单事务局部 CAS。精确读取 intent、Run 及其已记录 history，沿现有 authority/codec，核 intent.runRef、原 entry identity、Session 映射/Kernel 身份及 source 位于同 history 窗口，不核当前 Role/material/active Plan 的 fresh 权限链。已正式 settled 的 Run 可以补终态观察，不能强制它仍占 Session。Runtime 保留消费 intent 的关联；旧自然 pause 或 caller 自发取消不能被后来同名 intent 冒领为执行成功。

提交仅改该 intent snapshot 和写一个 `ControlIntentObserved@1` 原回执事件（identityKey/fingerprint/actor/occurredAt/原返回 snapshot），guard 同 intent/Run revisions；不递增 Run、不清除/覆盖 Run.controlState、不写 Session/Lease。当前 Run 指针已变时按原观察记 superseded；不能用旧 ack 解封新 cancel。解码复用同一个 control-record-codecs owner，新增状态/事件一次注册。观察成功后的重复请求先回原结果，不因后来 Run revision 或控制目标改变而失效。

### 11.4 entered 是已发生事实，控制不能把它抹去

不改变 ExecutionEntryPort 的公开 DTO。`recordExecutionEntered` 保留原 lookup/replay、permit claim、consumer/entryGeneration/authorizationRevision/inputDigest、sessionGeneration、Session/Lease ownership、固定 begin Kernel 身份和真实 history 区间校验，复用现有 `readAdmissionFacts`、ownership helpers、`compileExecutionHistoryBinding` 与 mergeGuards。去掉该方法中为 fresh 授权重读 manifest/Host/Role 的段落及对应 Role guards；authorize/begin/admitEnteredRun 的 fresh Host/Role/material/control 屏障不变。写 Run 时保留当前 controlState，不能通过补 entered 解封；它只证明已进入，下一模型 issue/consume 仍受 R4.1 阻断。

Driver 在读取真实 turn.started/run.started 后先尝试补 entered，再执行控制 before_model 决策。begin 后控制已提交导致明确 revision_conflict 时，精确重读当前 Run，确认仍是同一 entering binding，再使用新 pin 有界重试原实际来源；不猜 authorization revision、不改 consumer/generation。原请求若抛错/结果失联，先沿原 payload/pins 回查同请求，不能直接刷新 fingerprint 掩盖可能已提交的结果。明确拒绝后的新尝试固定真实 Kernel source 和首次事实时间，避免生成第二次实际进入；竞争仍失败则返回具体未确认，不无限重试。

控制或 caller 取消后，已发生事实使用内部收尾 signal。原 readTurnTail 与已读 completed boundary 继续定位本次固定 Turn；优先保留本次真实来源，后续历史读取复用 cursor owner。enteredFailure 不再跳过 finally 对账。当前进程已确定 Kernel 未被调用或没有读到进入记录时，不伪造 entered/terminal；保留 queued/entering 缺口，不能新建 Run 掩盖它。本批只补本次活跃驱动者已知的进入窗口，跨进程查无记录的 fencing 属 R4.4/5。

### 11.5 活跃 handle、屏障与清理成功

新 `execution-control.ts` 内聚本地 register/deliver/读取控制/收尾协调，不拥有持久状态或第二循环。handle 保存完整 RunRef、consumer/entry/session generation、固定 Kernel binding、独立 AbortController、原调用 done、实际消费的 intent 与清理结果；登记在外部 Kernel 调用前。begin 与登记之间的控制仍从持久 Run/current intent 重读，不能依赖只发生一次的内存通知。caller signal 可联动 controller；控制调用的 signal 不代替执行 signal，caller 取消不能取消事实收尾。

安全点当前 Run 读取复用已装配的 `deps.sourceAuthority().load(runRef)`（SourceSnapshotReads 的真实精确 Run reader）；只核该 Run 与 live handle 的 scope、V2 consumer/generation、固定 Kernel binding 和 controlState。有当前 intentRef 才用原 `controls.readControl` 读对应记录，不新增 readCurrentControl 服务，不为每组调用 WG11 全 Plan/Attempt/Lease 链或重新解析材料。身份不一致、missing/unavailable 保留实际缺口并停止放行，不能以本地旧 intent 或空结果当 continue；lookup 本身不授执行权限。正式 fresh 模型与领域工具原有权限/CAS仍各自承担，不因这里的控制读取删除。

before_model 保留最高优先级 entered 事实屏障；完成该事实与原 deadline 检查后，再从当前控制决定 continue/pause 或送 cancel。工具路径继续原 C2/M2，`observed-model-run.ts` 只增加可选 `toolGroupBarrier?: ToolGroupBarrier` 的同步捕获与向现有 runCodingAgent 透传；callback 在 R4.2 的 before_group/after_group 核当前同 owner 控制，不能重跑所有 Hook、模型预算或材料准入。持久控制先于实际安全点读取时阻止新组；安全点已放行后到达的控制按在途停止处理，不承诺跨 WG/Kernel 原子。

同一个 observed-model-run finally 增加内部同步通知：

```ts
type RuntimeResourceCloseResult =
  | { status: 'completed' }
  | { status: 'failed'; reason: string };
// ObservedModelRunOptions 内部可选字段：
// onResourcesClosed?: (result: RuntimeResourceCloseResult) => void;
```

字段在首 await 前捕获，仅由 Host 创建的 live handle 闭包消费，不传给模型/Kernel，不当公开 ack。原 closeOwnedResources 尝试并等待全部关闭后才通知，异常统一有界 message；不新建清理器、不改变无此通知调用者的原错误优先级。Kernel 调用结束、清理通知 completed、无在途工具/未知事实三者缺一不可确认 pause 成功。清理 failed 保留 queued 或真实 unknown 观察，不假 applied。未确认观察可在同一 live handle 的完成证据仍在时重试；去掉 controller 不能同时丢弃尚待提交的真实观察。close 排空实际调用和已启动事实收尾，不遗留后台 Promise；不因 close 自动启动任何恢复。

### 11.6 复用 observer：pause、cancel、自然完成分别判断

同一次原 history 分页、reducer 和 invariants 结果供 Run 事实与控制观察共享。paused 可合法包含第二组 pending 调用，故不能调用要求所有工具已有结果的 `turnIsComplete` 或完整 transcript 配对作为 pause 门槛；必须无 activeModelRequest、running/outcome_unknown，且真实 run.paused 与本次已消费 intent 的身份/事件窗口对应。其 history.endPosition 保持 null，仅沿 WG12 推进观察范围，不推进 Session 完成 cursor、不写 ended、不释放占用。

observer调用recordRunResult之前必须读取同一execution-control内部live handle的Kernel退出/资源清理证明；该私有读取接缝随Runtime同一实例注入现有observer依赖，处于十三文件scope内，不增加公开DTO/持久表。公开observeRun也必须走此门槛，不能绕过driver尾部等待而在source.close悬停时提前释放。清理及已启动事实收尾归属原 start/deliver/observe 的 tracked promises，由同一内部 coordinator 协调；不为此新增公开 runtime.close API 或后台收尾任务。无本地证明的跨进程收尾留R4.4/5，不能把map缺席当已停止；旧无controls的直接Runtime构造保留既有路径。

cancel 的成功观察先沿原真实 terminal 判断与 recordRunResult，只有确定工具结算、完整配对及本地收尾完成才释放原代次占用。自然 completed/failed/limit 保留原 outcome，cancel intent 记 terminal_without_cancel/superseded。outcome_unknown 先保存已有 Kernel 原记录/locator 和对应未知观察，不写成功取消或释放。真实 drain 超时的 `tool.outcome_unknown` 也会被原 reducer 结算进 transcript，并可能使 toolBatch 清空；因此空批次不证明结果已知。同一 observer 必须同时拒绝 transcript 中正式 `tool_result.result.status === 'error'` 且 `error.code === 'outcome_unknown'` 的结果，不另建错误解释器或逐层重验证。observer 的 Run ended 早退必须允许补 control ack：从已持久 terminal locator 定位原结论，不重复 recordRunResult，不因后来材料撤权重跑授权链。

暂停事件的 reason/requestedBy 并不携带 control intentRef。因此 R4.3a 只由实际执行该 Hook/barrier 决策或发送该 abort 的 live handle 关联原意图，不能仅把最新 Run.controlState 与任意历史 pause 拼为 ack。重开数据库可以读取原事实；没有旧调用已退出/清理已完成及因果关联证明时不补成功 pause ack，R4.4/5 必须补实际 owner 证明。此限制不影响 live 正常暂停和取消闭环。

### 11.7 R4.3a 精确十三生产文件与最小测试

以下为候选写 scope，相对 `coding-platform/next`，主审冻结后才预建/派发：

1. `src/contracts/control-intent.ts`：§11.2 纯类型兼容扩展。
2. `src/core/work-graph/tasks/control-contracts.ts`：内部 observation port，同一 service 交集。
3. `src/core/work-graph/tasks/control-service.ts`：唯一观察写者、原回执和局部 CAS；原 submit/read 兼容。
4. `src/core/work-graph/persistence/control-record-codecs.ts`：扩 snapshot read 分支、新观察事件，原 queued submit 约束保留。
5. `src/core/work-graph/tasks/execution-entry-service.ts`：仅已发生 entered 的非 fresh 事实边界，不改三处 fresh gates。
6. `src/core/agent-runtime/execution-contracts.ts`：deliver DTO、raw controls 依赖。
7. `src/core/agent-runtime/ports.ts`：唯一 deliverControl 公开入口。
8. `src/core/agent-runtime/runtime.ts`：同一 control/observer/driver 实例装配与 close 排空。
9. `src/core/agent-runtime/execution-driver.ts`：live handle、已有进入窗口补记、before_model 控制与收尾。
10. `src/core/agent-runtime/execution-observation.ts`：同一真实历史的控制观察、ended 后补记。
11. `src/core/agent-runtime/observed-model-run.ts`：barrier 透传及实际资源 close 通知。
12. `src/core/agent-runtime/execution-control.ts`（新）：上述窄 live 协调，不另建 engine。
13. `src/composition/create-platform.ts`：同 raw controls 注入；公开只保留原 controls submit/read，新增 runtime.deliverControl trackedCall；schema 一次合并。

仅拟新增 `tests/runtime/R4-control-runtime.test.ts` 与 `tests/composition/R4-control-runtime-platform.test.ts`，复用真实 B2 fixture、R4.1 writer、SQLite Kernel 和脚本 provider；不改共享 fixture、不 seed entering/paused/control/terminal，不复刻 Store 矩阵。少量流程：

1. 在真实 begin 后、before_model entered 前提交 pause，并让可信 Host 配置随后拒绝 fresh 授权；原进入事实及 history 仍能补记，provider 为零，真实 paused 落盘且清理后才 ack，Session/Lease 仍占用。用同一流程证明旧 pin 失败后补记，不伪造 Run revision。
2. 两串行工具组，第一组实际运行时提交 pause；执行器、result required sink、close 任一仍悬停时都只有 queued；逐一释放后第二组零 started、paused ack 的 eventId/sequence/position 可由原 SQLite 读取核对。pending 第二组不被当作未知工具。
3. cancel 已送但真实单工具尚未结算时不 ack；协作 cancelled 的完整配对 terminal 才沿 recordRunResult 释放；忽略 signal 至原 drain 超时产生 outcome_unknown，明确核对真实 reducer 可已清空 toolBatch，但 transcript 仍含正式 outcome_unknown 结果，必须保留占用并拒绝作为后继历史恢复；该边界沿本条原单工具案例覆盖，不另扩矩阵。abandoned 多组取消由 R4.3b 必须续测，不以这个单工具正例替代。
4. 自然 terminal 与 cancel、原 pause ack 与新 cancel 两种可达竞争，保留真实结论及当前控制指针；recordRunResult 已成功但 ack 提交窗口暂时失败，再观察可补 ack，零新 provider/Turn。submit/read 的原回执与旧 queued 字节仍可读。
5. 一条完整公开 `platform.controls.submitControl → runtime.deliverControl → readControl/observeRun` 流程验证同实例装配、caller 取消后收尾和 close 排空；无匹配 live handle 保留 queued，不启动恢复。

阶段一新 deliver/observation 方法明确 unsupported，不提前实现本节领域归约；新增测试红须来自真实接缝并如实说明被遮挡后段。原无控制路径和 queued producer 保持绿。检查以主审注册的两个目标、next-types、R4.1、B2 Runtime/history、R4.2 邻接为限；不改 Kernel、不扩大材料/白板测试。

### 11.8 必须续接的 R4.3b：abandoned 与可消费的已结束历史

已核原 Kernel `run-state-reducer`：terminalState 只把 pending 改为 abandoned，把 running 改为 outcome_unknown；abandoned 因此可由真实 replay 证明“已声明但未启动”，不是缺失运行结果。当前 B2 observer.turnIsComplete 拒绝 abandoned，严格 `assertTranscriptExchangeIntegrity` 又要求每项声明有结果；即使只放宽 observer，Kernel `restoreSessionHistory` 仍会拒绝此结束 Turn，故不能仅改释放判断或伪造 ToolResult。

建议另行冻结一个受管纯投影接缝，内聚于现有 `core/ports/session_store/session-history.ts`：`projectTerminalTranscript(state: Readonly<RunState>): TranscriptEntry[]`。只接受真实 terminal、无 active request/pending/running/outcome_unknown 的已归约 state；未知判据同时覆盖 toolBatch 中的状态及 transcript 中正式 `tool_result.result.status === 'error'` / `error.code === 'outcome_unknown'` 结果，不能因原 reducer 已清空批次而放行历史恢复；对其中被 reducer 判为 abandoned、无 result 的调用，从**供后继模型消费的副本**中移除其 tool-call 声明，保留实际已结算结果与其匹配声明，再调用原严格 `assertTranscriptExchangeIntegrity`。不得更改原 SessionRecord、RunState、assistant 文本或伪造工具成功/失败结果；缺失结果但没有 abandoned 事实的调用仍拒绝。直接原历史读取继续可见取消前声明与 abandoned 状态，不能让投影冒充原记录。

唯一投影由 Kernel `restoreSessionHistory` 在每个实际已终止 Turn 上消费，合并后仍严格校验；平台 observer 复用同一公开纯函数判断该 terminal 的上下文可消费性，不复制过滤器。现有 `compileExecutionHistoryBinding` 只管精确 Kernel/Session/位置与 owner CAS，`recordRunResult` 已管原代次释放，无需改其完成 cursor wire 或引入第二种 historyCursor。只在投影、真实 terminal 和本地收尾均满足后沿原 result writer 提交 endPosition/完成 cursor，再 ack。

拟单独 scope：受管 session-history.ts 及四项产物、现有 public-api.ts 的 type/function 公共导出及四项产物、原 build-kernel-patch.mjs 名单扩展、`execution-observation.ts` 消费，共十二生产文件；提取源/hash与再生范围须在 R4.3a 后另行核准。不得现在修改冻结 Kernel或在十三文件任务中夹带。测试至少一条真实两组取消：第一组确定结算、第二组从未 started，释放后同 Session 的新合法 Turn 真正读取原历史前缀、provider 获得配对上下文，原取消记录未改；对照第一组已 started 且 outcome_unknown，仍拒绝释放/新 Turn。两者均来自真实运行与取消，不 raw seed。

这是 R4.3 控制交付必须完成的后续小批；如主审找到更窄且能同时通过 observer 与 Kernel 历史消费的原 public seam，可据实际反例替换投影候选。不得先把 abandoned 一律视为结果已知、删除严格配对检查，再把后继读取故障留给用户。冷 owner 接管、resume 原 limits、预算重建、维护与 QueryRun 控制仍分别归后续 R4.4/5 和 Query 路径。
