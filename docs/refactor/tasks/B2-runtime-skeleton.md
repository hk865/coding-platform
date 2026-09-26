# B2 Runtime：正式装配、fresh 执行与原历史观察（骨架阶段）

日期：2026-09-26。状态：主 Agent 已核共享Prepared/Entry/ModelRequest契约，派发第一阶段骨架与测试；共享WG实现仍待各自中审。T=/home/hyh001/projects/coding-platform/coding-platform/next；W 为其上两级。阶段一只交可编译骨架和行为测试，停止等待主审；不得直接实现。

## 阅读与复用

先读 W/docs/AGENTS.md、PRODUCT.md、refactor/HANDOFF.md、IMPLEMENTED-CAPABILITIES.md（WG4/5/9/11/12/13、RT1–8）、ARCHITECTURE.md、modules/core/agent-runtime.md §7.1、work-graph.md §6.3、DSH-WORKFLOW.md。用户原话 DLG-037 和 2026-09-23-PARALLEL-AND-PRODUCT.md 是防漂移依据。

真实源码：T/src/core/agent-runtime/{runtime,ports,observed-model-run,model-budget,source-capture-access,source-tool-ports,session-operations,kernel-store-locator,observation-recovery,graph-execution-history}.ts；WorkGraph tasks 的 claim/read/history/plan 服务、configuration 角色解析和 materials 原授权规则；T/src/composition/create-platform.ts；B1-kernel-assembly、R4c-session-continuity、R4c-graph-history、R3c-R4b-platform 测试。Kernel 只通过冻结 public-api 使用，源码只读核对持久 Turn/Run 与 awaited before_model；不新建引擎、Context 总管、RuntimeEntry 库或 transcript。

## 主 Agent 选定的接口与信任边界

- 用正式 `RuntimeExecutionPort` 替代 N0 的 never 请求；保留已接 Session/history/capabilities。`prepareExecution(ctx,{runRef,requestId})` 从 WG11 的真实 Claim 读取本次所有身份；返回 `ReadResult<PreparedTaskExecution>`。返回值只包含固定 Run/Claim、envelope.bundleRef 和 inputBinding 等可核对引用，不携带可被调用者更改后授予权限的 root/client/hooks。
- `startRun(ctx,{prepared,consumerId,requestId})` 返回 `ReadResult<TaskExecutionRecord>`；返回的是当前正式状态，未知/暂停仍保留真实占用，不把此结果解释为 Task 完成。同请求重放只做原身份观察，不再次模型或工具调用。
- `observeRun(ctx,{runRef})` 是明确只观察/对账入口，不启动模型；沿原定位增量读取并向 WG 提交。此入口是 begin 响应丢失/平台写入失败后的真实消费者，不制造“没看到所以安全重试”。
- Runtime 工厂依赖既有 WG read/entry/model-call/role/plan/session 端口、MaterialPort/RawArtifactStore、KernelStoreRegistry、WorkspaceHostBindings；新增内部文件只按 prepare、driver、model-call 适配和观察职责划分。主 Agent 负责组合根。
- `TargetPlatformOptions.runtime` 是可选的受信 Host 启动绑定。其 `resolveConfiguration` 按完整 RunRef、RoleConfigurationRef 和解析后的 Role 结果返回精确 `configurationRevision`、BoundModel、RuntimeBudget、tools/writeScope、skills、静态 systemInstruction、deniedPrefixes/processSandboxOptions、必要的材料当前 basis。配置缺失明确 unsupported；客户端/路径/函数不得来自模型 JSON 或回传 Prepared。Host 返回 declared tools 是实际 grant，必须再和 Role、Run/Task/Plan 许可求交；不能因 kind=host 自行补权限。
- 受信 root 复用 workspace.resolveRoot；Kernel DB 只从 registry 正式映射取得。开始时重新取得 Host 配置并核 version、Role pin 与实际权限；不信任 Prepared 内任意副本。新增 Hook 由 driver 独占装配；外部 Hook 不能替代 entry 屏障。
- Run 已持久 tokenBudget/deadline 是显式累计约束，不能因 RuntimeBudget 缺 totalTokens 字段而丢失。RT3 可新增窄 `taskBudget?: TaskBudgetV1`（由正式 driver 必传）：在原 Kernel limits 上叠加 maxTotalTokens 和距绝对 deadline 的剩余时长，保留普通组件未传时原语义；不得任意平分 input/output 预算。必要读入 snapshot 和过期拒绝在同一原 helper 内实现。对应 observed-model-run.ts/run-limits.ts 纳入本 lane，增加一个真实预算边界反例，不复制计量器。

## 有界 Prepared

共享正文定义由 B2 WG 骨架 lane 写入 `src/contracts/core/prepared-execution.ts`，Runtime 只消费并报告缺口。使用独立 contentType 与 schemaVersion 的有界 JSON manifest，继续用现有 Artifact/body，不把新 JSON 塞进旧 ContextBundle。Run.envelope.bundleRef 是唯一 manifest 引用；inputBinding.inputDigest 是真正送给 Kernel 的新 input 字符串摘要，manifestDigest 是完整清单摘要。

装配分开稳定 Role/Skill、当前 Goal/Plan/Task 和明确选中材料、Session 原历史边界。保留正式角色 requiredMaterials/requiredOutputs 与本 Task 义务；无法得到的必需材料返回 incomplete/unsupported，不填假文本。Plan/Task 正式规范可满足 contract 类必读；外部 code/evidence/history/decision 需要具体可核对来源。只读取本 Task 的具体输入，不预检未来所有任务；不复制 Session transcript、不全量扫描任务图或事件。正文超过已有 Artifact 256KiB 上限明确 capacity，不截断后称完整。

Role 使用原 resolveRoleBinding/readRoleSpec，不新增 resolver。resolved 精确核 Session.role pin；absent 保留原语义，只能使用 Host 显式提供且与 Session legacy_template 完全匹配的稳定配置；inadmissible 拒绝。不同 Role 不得悄悄重配当前 Session。

Claim 后已有 starting Run 可作为真实 work_run principal，使用原 `readTaskInput(current)` 和材料规则；这不需要把 Run 提前写 running。当前组合根材料 source applicability/grant 生产者缺口要如实拒绝和记录，不能改为 historical_explanation 或测试 seed 后声称生产链闭合。本批正例至少覆盖正式 Plan/Task 规范装配与外部输入拒绝，完整材料生产路径仍按实际补齐进度记录。

## 固定执行顺序

1. 精确 WG11 + 原 Role/当前材料/Host grant 核验；保存 bounded manifest 并让 WG authorizeRuntimeEntry 从可信 body 重读核对。Input/Run/Session/Role 不一致零模型。
2. 固定 Kernel runId/turnId；WG beginRuntimeEntry committed 且 replayed=false 才允许本次 runObservedModel。授权代次与 Session occupancy generation 分开。固定身份存在于 Run 新版绑定；不另建表。
3. 复用 runObservedModel 的 controlHooks.before_model。Kernel 已持久 Turn/Run 后，读取原位置真实来源，经 WG 共用 history compiler 一次提交 entered+locator+Attempt started；成功才 continue。onConfiguration/best_effort publish 都不能作入账屏障。
4. 正式 driver 必须使用 ModelCallAccess.bind/beforeCall；最终请求摘要和预算计量仍在 RT3 原调用点执行。WG durable permit 签发和消费，仅 fresh consumption 才调用 provider；重放或 response loss 不重试 provider。
5. 来源工具使用 B1 first_use 和 WG13 原 source factory，保持 entered/running 守卫。read 未授予或未真正使用时不打开；finally 复用现有清理。
6. Kernel 调用返回或抛错后都读取真实原历史，按绑定位置有界增量观察。模型“完成”文本、返回值、observer 回调不作为终态证据。pause、缺页、未知副作用保留占用。终态及完整 Turn 边界一起交 WG 原子归约；只释放相同 owner/generation。结果结束不归档 Session、不完成 Task/Goal。
7. 原 historyCursor 需要由既有 Session history owner 解释/构造；必要时在 session-operations.ts 提取内部 cursor helper，不能由 driver 拼 opaque 字符串、扫描全历史或复写 Kernel reducer。新连续 Turn 使用真实完成边界，unfinished 绝不新开替代；恢复/compact 仍 unsupported 直至独立接线。

## 骨架与行为测试

拟写：core/agent-runtime/{ports,runtime,execution-contracts,execution-preparation,execution-driver,execution-observation,model-call-access}.ts；必要的 session-operations.ts 内部 cursor 接缝单列审核。组合根 `create-platform.ts` 和共享 WG/dispatch 由主 Agent 持有，不在 Runtime lane 写。

新增 `tests/runtime/B2-runtime-execution.test.ts` 和 `tests/composition/B2-runtime-platform.test.ts`。复用已有 fixture 和本地 scripted Model，不联网；集中独有接点，不复制 Kernel/Store 全矩阵。真实 SQLite/Kernel 组合根测试由集成负责人补接共享入口后运行；骨架先正常编译，缺能力因显式 unsupported 失败。

必须验证：真实初始 Role pin/Skill/Task 规范送入请求、调用方篡改 Prepared 与合法 Host grant 撤权后新动作拒绝；不构造运行中 Role 换绑或直接改写持久 Role pin 的反例；同 Run 两驱动只有一方 fresh begin；awaited entered 写失败零 provider/源码打开；最终 request 改变不可复用 permit、同请求重放零第二调用；真实持久终态→Run/Attempt/outbox/Lease/Session归约→图上 idle 仍可发现且 Task 未完成；缺终态/暂停/错误保持占用；重开数据库 observe 不重跑；第二个 Task 继续同 Session 正确使用原历史；close 排空在途执行而不先关闭 body/store。

报告需求→已有符号→最小接缝→测试和红测原因。第一阶段结束后停止，等待主 Agent 中审。第二阶段测试只读，接口缺口报告主审，禁止删约束换绿灯。

## 进入骨架前的源码核对补充（2026-09-26）

- 真实写范围：现有 runObservedModel 及 Kernel 沙箱没有允许路径前缀写入机制，permissions.writeScope 不能仅存下来就宣称生效。本 B2 driver 仅接受只读（无write/shell且writeScope=[]）或 Host 已明确授予整个工作区写权限的 `writeScope=['.']`；更窄写范围明确 unsupported，保留后续范围写接线。read与平台通信工具分别过滤，coordinationTools不能变成任意shell权限。capabilities.scopedWorkspaceWrites 保持 false。这里核真实授予，不要求预测未来修改文件，也不加入全项目单writer锁。
- 真实累计预算：Kernel maxTotalTokens 是用量返回后守卫，不足以防首请求预留越过Task预算。在现有 ModelBudget 增加可选的正式 TaskBudgetV1 参数（保持原组件调用兼容），用既有累计 entries、实际最终请求计量、输出预留在provider之前核 tokenBudget/deadline；不建立第二计量器或平分input/output。RT3仍把同一任务总量传Kernel作后续约束。scope增加 model-budget.ts；测试证明首请求超预留时provider=0，以及未知用量不重新腾出预算。
- historyCursor 带principal：外部RT1分页规则不放宽，不能剥离cursor后直接跨caller使用。driver采用固定平台system actor，Session owner提供内部完成边界解释接缝，先核正式Session映射及持久边界，再取得位置；实际start依旧受WG许可。普通用户传入cursor不能成为该边界。
- 完整Turn在内存复用Kernel公开 createInitialRunState/reduceRunState/validateRunStateInvariants，从已知Turn起点按页还原，核真实terminal、无activeModelRequest/未决tool batch及事件连续性；复用本批受管 public-api 补丁公开的现有 assertTranscriptExchangeIntegrity 核工具交换，不能私有import或复制配对算法；即使结果已入transcript也须拒绝 outcome_unknown，terminal当前toolBatch中 abandoned/unknown 不能当作完成。正常活跃driver继续上次位置读取；冷启动observe只重建该已定位Turn的必要状态，不从Session头或其他Run发现定位。此次冷重建成本须实测如实报告，不称所有历史读取常数时间。

- 增量读接缝：Session owner 内部提供 position-window helper，通过公共 store.read 获取真实tail并冻结本轮upper；不能沿旧公开afterCursor的固定upper假装追尾。读取本Turn原页先核每个position连续和身份，再归约，不能先用RT7过滤而隐藏混入。begin已受理但locator缺失时，只可从正式Session最后完成边界后读取并核固定runId/turnId；没有可靠起点保持unknown，不扫Session头猜测。
- 性能范围：平台观察不全Session扫描；Kernel原session_history组合入口仍会readAllSessionRecords，此既有事实必须保留，不宣称整条连续执行无全扫。
- 所有实际工具入口：read、探索、source工具均要经过同一受信Host读策略，Host撤权在before_tool等真实边界重核。Host配置若提供无法映射到当前工具/沙箱的读限制，明确unsupported，不能只在source_excerpt实现后放开builtin read/shell。deadline还须在WG模型准入真实边界重核，以覆盖awaited hook/入账等待跨过截止时间。

## 派发时精确施工规则

生产写范围：src/core/agent-runtime/{ports,runtime,execution-contracts,execution-preparation,execution-driver,execution-observation,model-call-access,session-operations,model-budget,run-limits,observed-model-run}.ts。新增测试 tests/runtime/B2-runtime-execution.test.ts、tests/composition/B2-runtime-platform.test.ts，可新增共用tests/helpers/B2-runtime-fixture.ts。只按同名scope已预建文件原地写；不要用write/edit的rename，不创建probe，不升级权限。

Stage1唯一允许改composition/create-platform.ts的内容是：import type RuntimeHostBindings from execution-contracts，在TargetPlatformOptions加入runtime?:RuntimeHostBindings。实际factory/注册/关闭接线不在你scope，主Agent第二阶段实现。Runtime工厂可接可选deps以保留旧无参调用为unsupported；端口新增类型/observeRun，但所有prepare/start/observe新算法仍明确unsupported。原Session/observed-model-run/ModelBudget行为保持；阶段一只声明所需可选参数或内部owner方法stub，不能提前完成工具/预算/归约实现。

RuntimeHostBindings和RuntimeExecutionDependencies放execution-contracts，按正文的原端口类型声明；使用ReadResult而非自建boolean policy。配置是受信Host提供的实际grant，不可把request原样回显。直接Runtime域测试注入已验证的真实WG/Plan/Role/Session/Material端口；共同fixture可在原TaskClaim fixture追加schema。组合根测试应准确调用createTargetPlatform的正式future API并真实Kernel/SQLite/local scripted model，以unsupported为第一阶段红点；不得把整个runtime fake成成功来证明接线。

permit.authorizationRevision是Run授权绑定自己的revision：authorize后begin，随后从真实begin/entered回执刷新permit；不把Run revision当绑定版本，不猜加一。原请求重放仍带原请求载荷/pin，优先读回执。模型调用dependencies已复用Entry的Role/Host/material authority；每次issue与consume都重核。

测试可能前置失败于WG当前unsupported，需要如实报告每项到达的最深正式边界，不能称Runtime已测到provider/terminal。主审将WG实现快照刷新后再次验证测试语义，并在第二阶段之前冻结；本阶段不改WG源或其测试。

完整历史公开validator的stage1 stub已生成，第二阶段会由主审刷新纯re-export真实产物。平台只import public-api，无私有import。遵守原sourceTools first_use和ModelBudget复用，不重写reducer/provider执行器。


## 主审中审冻结补充（2026-09-26）

RuntimeModelBinding复用原BoundModel；Host仅resolveConfiguration，不另建resolveWorkspace，root/revision与逐path授权统一来自既有WorkspaceHostBindings。Host config含精确hostTemplate版本摘要（resolved Role时null），不含可覆盖正式Run.budget的taskBudget。Raw bodies有put/read用于持久manifest，driver包含真正modelRequests/roles/materials/bodies/plans依赖；ModelCallAccess固定可信context+permit并读WG11，不从bind凭空获得身份。

SessionHistoryCursorOwner只解释canonical Session.historyCursor（固定平台actor，由owner内部生成binding），并提供readPositionWindow：afterPosition exclusive，throughPosition=null时冻结实际tail，输出entries的原cursor+through/next/hasMore。公共cursor保持原principal绑定和upper，不放宽为任意跨主体解码。新helper只用于内部Runtime，不是新历史库。

Builtin read也要在awaited before_tool核实际path的同一WorkspaceHost授权；exploration/source用已有allowedPath/assertCurrent并保持同一root/permission版本，不能只保护project_source。shell带任意读写能力，不能从allowsRead谓词推断全workspace授权：只有Host明确config.shellWorkspaceAccess='all_except_denied'、工具shell grant、writeScope=['.']同时存在才支持，Kernel实际deniedPrefixes必须应用到ProcessSandbox；缺这个声明明确unsupported。该声明是受信配置的一部分，其变化必须变更configurationRevision。窄writeScope仍unsupported且capability=false；绝不可降为全部workspace。

中审23项目标测试无fixture初始化错误，22红1绿；19执行类停Runtime unsupported，3预算类是明确mapping unsupported/首调用预留/unknown保留预算缺口。所有后续Kernel断言须第二阶段真跑到，不能把此红点当完整覆盖证明。run-limits原提前算法已经回退为显式unsupported，旧无TaskBudget调用保持行为。

主审增量接线补充：RuntimeExecutionDependencies复用原historyWriter:ExecutionHistoryWritePort（WG12）；driver/observation可在非终态新窗口持久单调locator，不重复调用entered或建第二writer。终态仍由recordRunResult一次提交历史与释放，不能先WG12后伪称全原子。
