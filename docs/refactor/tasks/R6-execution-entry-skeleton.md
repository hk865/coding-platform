# R6 执行入口：可信启动配置与 Query/Workflow 消费者骨架

状态：2026-09-27，12路径骨架及后续六生产实现均已冻结/独审并[精确导入](../reviews/evidence/next-b2-2026-09-26/r6-execution-entry-implementation-import.json)。最终22项、Node/UI types、物理构建与scope通过；[真实CUA最终验收](../reviews/evidence/next-b2-2026-09-26/r6-execution-entry-browser-final.json)一键Query→Plan→两Work→checks→正式Goal COMPLETED，完整回答默认收起可展开，原TaskGraph.completion直接显示。下文是原骨架派发前态与范围，不能把旧unsupported首红当当前状态；完整MVP/UI/生命周期及下一批图历史消费者未据此关闭。

执行本批第一阶段并在交付后 STOP。W=`/home/hyh001/projects/coding-platform`，T=`W/coding-platform/next`；先读 `docs/AGENTS.md`、当前 `docs/refactor/HANDOFF.md`、`IMPLEMENTED-CAPABILITIES.md` 相关 R6/Query/Initial Plan/Workflow 条目、`DSH-WORKFLOW.md` 与 `DSH-EXECUTION-HARNESS.md`，再沿本任务所列现有 source/provider/consumer 实际调用链施工。原工程、Kernel、其它源码/测试、check.py 只读；只允许机器 scope 的 12 路径原地写入，不用同级临时 rename，不安装依赖、不读真实凭据、不提交 Git。新配置绑定的受控测试沿既有 ProviderRegistry/SecretSource 接缝；不得用原型 monkey-patch 或跳过真实 JSON→factory→Host 链。

## 1. 开工前置与本批结果

**以下为派发前置，不是当前已全部完成的声明：** R6 Session/mailbox、Query execution、Workflow advanceWork、初始 Plan from-answer/handleGoalInput **实现**须独审导入；R3e.3 正式完成在同一 main。当前这四项均已独审导入，初始Plan两条正常链及原Plan共10项已通过。R6 UI布局及浏览器窄修（原始历史完整字段、输入焦点、树折叠）现已独审导入，R4.3a骨架composition接线也已冻结导入，两个共享窗口均已释放；不等待R4.3a无交集算法实现或最终浏览器复验。主审重新读取最终公开类型及共享文件 hash，从 fresh main 准备，不复制旧 lane 的 app/UI/composition。类型存在或骨架已绿不代表此前置成立。

本批让已配置的真实 Host 从用户目标发起一轮调查/规划并显示原回答；请求执行时把该答复交原 Plan/Workflow，顺序消费下一步直到 completed 或真实 waiting。首条规划可无 Plan/policy/baseline，采用时依原治理要求；缺配置/治理/Role 或结果 unknown 显示原缺口，不创建空治理、不刷新预算、不每步强制确认。Session/mailbox 原页面、原项目/图/文件能力保持。后台冷恢复、更多 Query 轮次、控制 pause/resume、任意材料浏览、Git/语言工具不纳入本批。

## 2. 可信配置形状与装配

新增 `app/runtime-configuration.ts` 只处理 Host 数据到已有端口的转换。下列类型是本批拟声明，现领域形状直接 import；不重述 RuntimeBudget/RoleBinding/ResolvedRuntimeConfiguration：

```ts
type WorkbenchModelConfiguration = {
  revision: string;
  provider: ProviderId;
  model: string;
  baseUrl?: string;
  options?: Readonly<Record<string, JsonValue>>;
  secretEnvironmentVariable?: string;
};
type WorkbenchRuntimeBinding = {
  id: string;
  label: string;
  scope: WorkspaceScope;
  role: RoleConfigurationRef;
  configurationRevision: string;
  model: WorkbenchModelConfiguration;
  grant: Omit<ResolvedRuntimeConfiguration, 'configurationRevision' | 'model'>;
};
type WorkbenchQueryProfile = {
  id: string;
  label: string;
  scope: WorkspaceScope;
  runtimeBindingId: string;
  sessionRole: RoleConfigurationRef;
  roleBinding: RoleBindingRefV1;
  runtimeBudget: RuntimeBudget;
  budget: QueryJobIntentV1['budget'];
  consumerId: string;
};
type WorkbenchRuntimeConfiguration = {
  schemaVersion: 1;
  bindings: WorkbenchRuntimeBinding[];
  queryProfiles: WorkbenchQueryProfile[];
};
```

`WorkbenchCliConfig` 窄增 `runtime?:WorkbenchRuntimeConfiguration`、`checks?:TargetPlatformOptions['checks']`、`workflow?:TargetPlatformOptions['workflow']`。parseWorkbenchCliConfig 仍是纯 JSON 结构/路径转换：把 CLI runtime 交 `LocalWorkbenchHostOptions.runtimeConfiguration?`，checks/workflow 沿现类型；不在 parser 读取 env、开 provider 或产生领域写入。LocalWorkbenchHostOptions 同时允许原类型的程序化 `runtime?:TargetPlatformOptions['runtime']`，与 runtimeConfiguration 二选一；checks/workflow 直接复用组合根类型。函数依赖不做 JSON 克隆，纯数据在首 await 前隔离。

同 scope/完整 RoleConfigurationRef 只匹配一个 binding；配置重复或 profile 指向缺失/不匹配的 binding 明确配置错误，不猜首条。Work resolveConfiguration 与 Query resolveQueryConfiguration 共用此选择及模型绑定，只消费各自输入已确认的 scope/role/roleResolution。真实 RuntimeConfigurationInput 的 Work 分支保留 resolved/absent/inadmissible；QueryRuntimeConfigurationInput 已排除 inadmissible，由原 Query owner 准入，不在 Host 重造 Role 当前性校验。legacy_template 必须有显式匹配的 hostTemplate；role_spec 用正式 pin。grant 的 tools/writeScope/skills/budget/deniedPrefixes/processSandboxOptions/materialBasis 都来自明确可信配置，不据任务文字补权限或角色。Query 原 readonly ceiling 与预算交集由原 owner 执行。maxRounds 首批固定为已支持的 1，不把 maxRequests 当轮数。

模型只用冻结 Kernel public-api 的 `createBuiltinProviderRegistry()`，`get(provider)` 取得 secretEnvironmentVariable/defaultBaseUrl，`create(provider,{apiKey,model,baseUrl,options})` 产生现 ModelClientPort，再包为原 BoundModel。变量名取显式配置，未写时取已选 provider 的定义；只在该 binding 首次实际解析时读取该一个变量并在本 Host 内复用 client，不扫描其他变量/凭据文件或调用旧 app/model-settings。不配置 runtime 时其余页面可用；指定 profile 缺密钥时模型入口返回明确未配置，不能让启动后的普通读全部失效。不存在热改 Role/轮换配置的新生命周期，配置改变沿重新启动 Host。

可给纯适配工厂窄的程序化 `registry:Pick<ProviderRegistry,'get'|'create'>` 与 `secretSource:SecretSource` 依赖，默认取既有 public registry 和只读指定 env 名的函数；用于原受控 provider 的正常装配验收，不写新的 provider/ModelRegistry/网络协议。它们仅 Host 内部可见，不是 CLI/HTTP 字段。`SecretSource` 是原 `get(name:string):string|undefined` 接口，非 async 函数。`BoundModel` 复用 `core/agent-runtime/source-tool-ports.ts`，configuration 包含 revision/provider/model/baseUrl；registry.create 返回其 client，不返回第二套 model configuration。所有失败只报字段/profile/缺配置语义，不回显 apiKey、完整 env、provider 原始响应或 options；secret 不进摘要/record/body/log/bootstrap。模型 baseUrl 默认只可取选定定义，model 与授权预算不猜。RuntimeBudget 校验复用现 validateRuntimeBudget，null 累计上限保持 null，不另加隐含限制。

受信资源路径按显式配置文件目录解析：workspace root、Kernel databasePath、skills.resourceRoot 与配置中明确的沙箱可读路径；检查 command/cwd 按原 TrustedCheckConfiguration 意义处理，不把命令改造成脚本管理系统。kernelStores 继续由单一 createTargetPlatform 内的 createKernelStoreRegistry 装配，Host 不再次调用创建第二组库。workflow.consumerId/完整 sessionRole/roleBinding/TaskBudget 及 checks.executor/正式版本/检查数组原样送同组合根；缺配置不默认全工作区写入或 shell。

### 来源策略与原注册读取

Query 批次已由主审冻结 `TargetPlatformOptions.sourcePolicyFor?:RuntimeExecutionDependencies['sourcePolicyFor']` 及对同一 Runtime dependencies 的原样透传；本批须消费该最终导入选项，不重复扩接口、不改 Work/Query source factory。Host 用已有 workspace root/readPrefixes 和 permissionRevision，复用现 prefixMatches 生成原 SourcePolicy。它只是受信来源范围，正式 Run/Query 身份与当前资格仍由 source authority/原 owner 检查；不拿 Host authorize 的 host principal 冒充 query_run，也不注入恒真 allowsRead。

在原 ProjectRegistrationPort 增 `readWorkspaceRegistration(ctx,scope:WorkspaceScope):Promise<ReadResult<{project:ProjectSnapshot;workspace:WorkspaceSnapshot}>>`。原 project-bootstrap-service 首 await 前固定 ctx/scope，沿当前 human/system Host scope 边界，一次 readMany 精确 Project/Workspace key，复用 `persistence/record-codecs.ts` 的 decodeProjectSnapshot/decodeWorkspaceSnapshot 和现 Store failure/missing 语义，校对实际 ref 后返回。只读不加 CAS/事件/schema，不读取其他图或整库；组合根在原 projects 上 trackedCall 发布。UI 用返回的实际 revision 构造 Query submit pins；不假设永远 revision=1、不从可信 mount.workspaceRevision 冒充领域记录版本。

## 3. 11 条明确路由与可展示配置

沿现 CoreRouteBindings/CORE_ROUTE_SPECS/显式 switch，每条只调用一次命名 owner。HTTP DTO 由 SecondArgument/RouteResponse 派生，不定义影子 terminal、通用 method 路由或内部 writer。现 `RuntimeExecutionPort.prepareQuery/startQuery/observeQuery` 的可选仅兼容旧 Work port literal；真实 createTargetPlatform 均发布方法。新路由使用这些成员的 `NonNullable` 派生 DTO，并在实际 CoreRoutePlatform 接入中要求这三个方法可调用（例如 `Required<Pick<…>>`），不能把已存在的公共 Query 消费者降成可选缺失。server 的固定 actor/token/Origin/scope/signal 保持，不在本 scope 改 server。

| 后缀 | 唯一 owner | body |
| --- | --- | --- |
| `workspaces/registration` | projects.readWorkspaceRegistration | plain `{scope,input:WorkspaceScope}` |
| `queries/submit` | queries.submitQueryJob | GraphWrite `{scope,request}` |
| `queries/read` | queries.readQueryJob | plain `{scope,input:QueryJobRef}` |
| `queries/claim` | queries.claimQuery | GraphWrite `{scope,request}` |
| `queries/prepare` | runtime.prepareQuery | plain `{scope,input}` |
| `queries/start` | runtime.startQuery | plain `{scope,input}` |
| `queries/observe` | runtime.observeQuery | plain `{scope,input}` |
| `queries/answer` | queries.readQueryAnswer | plain `{scope,input:QueryJobAnswerRef}` |
| `materials/open` | materials.openArtifact | plain `{scope,input:{ref,usage}}` |
| `workflow/goal-input` | workflow.handleGoalInput | plain `{scope,input}` |
| `workflow/advance` | workflow.advanceWork | plain `{scope,input}` |

GraphWrite 继续现 committed/rejected HTTP 映射；plain 包括 Workflow 内嵌 WriteResult/OperationReceipt 仍 HTTP 200 返回原协议，不能 flatten 成成功或丢 current/expected/replayed。答复正文只拿正式 Answer 给出的 ArtifactRef 调 materials/open(historical_explanation)，通过原材料资格/digest 读取，bodyRef 本身不等于正文；不改 raw body API 或要求 current grant。QueryRun reader/未开放 M1 Query grant 的边界不因 Host 可读而改变。

### 最终公共返回层级（按已导入类型消费）

`submitQueryJob` 的 committed.value 为 QueryJobRecord，含 `job:QueryJobSnapshot`、`run:QueryRunSnapshot`；`claimQuery` 的 committed.value 为 QueryExecutionRecord，额外含真实 SessionRecord 与 nullable Answer snapshot。`prepareQuery` ready.value 为 PreparedQueryExecution；`startQuery/observeQuery` ready.value 同为 QueryExecutionRecord，不是 OperationReceipt。是否 settled 看 `value.run.run.executionState?.phase`，正式 job status 看 `value.job.job.status`；回答 ref 取 `value.answer?.ref`。`readQueryAnswer` ready.value 为 QueryJobAnswerSnapshot，正文 ref 在 `value.answer.bodyRef`，按原 materials/open 读取展示。

原 `sessions/read` ready.value 是 SessionCard：角色、ref/revision 在 `value.record`，空闲状态在 `value.availability`。createSession completed.value 则直接为 SessionRecord；其 `ref` 是完整 Session aggregate ref，可用于 claim 的 expected pin；不要拿 Kernel sessionId 或 historyCursor 当 revision。`handleGoalInput` ready.value.next 区分 `{kind:'goal_input',input}` 与 `{kind:'work',input}`；后者及 `advanceWork` 返回的 WorkflowAdvanceInput 原样给 workflow/advance，不自行包装影子 operation 或重算 next。两种 Workflow 外层 rejected 与内嵌 receipt 均保留。

BootstrapResponse 只增安全显示投影 `execution:{queryProfiles:[{id,label,scope,sessionRole,roleBinding,runtimeBudget,budget,consumerId}],workflowScopes:WorkspaceScope[]}`（未配置为空数组）；来自冻结启动资料，不扫描 ledger、不含 runtime bindings/grant/model/baseUrl/options/env 名/secret/root/client。它帮助用户选择合法配置，不授领域许可。Session 页既有 review.sessionRoles 可复用，不能因选择 profile 在运行中重绑原 Session。readonlyQuery 能力不凭此投影声称已验证，仍以 owner 返回为准。

## 4. 有限页面推进与原请求保存

复用现 ScopeState、持久挂载表单及 scope 捕获机制。新面板以产品语言显示“调查”“规划并执行”、配置选择、原回答和当前阶段；原请求/身份/版本/回执保持折叠。用户不需填写 client/Role JSON/完整 expected。域权限继续由 Host/owner 决定，页面只构造公开 DTO。

1. 读取已有 Goal 和 workspaces/registration。用户选择显式 query profile；已有选中 Session 若角色匹配且空闲则复用，忙碌显示实际等待，不另建绕开。未选择时沿已接 sessions/create 用该 profile 的完整 sessionRole 创建；initialLinks/recommendedRefs 可为空，创建 accepted 时停在处理中，completed 后才 claim。无 Plan、Policy、baseline 均不阻止这条只读 Query。
2. 一次用户动作生成 jobId/runId/correlationId/原 requestId，intent.intentId=jobId；Goal ID/问题/focus refs 为实际输入。execution.kind 取调查 semantic_query 或规划 initial_coordination，正式 roleBinding/runtimeBudget/budget 取所选配置；不设置虚假的 implementationAuthorization。submit expected 恰为实际 Project/Workspace/Goal 与新 Job@0/Run@0；claim expected 用该返回 Job/Run 与真实 Session 当前 revision。再调用 prepareQuery/startQuery，保留原 Prepared、consumerId 和该步骤 requestId。以上是有限 HTTP 消费顺序，Host 不再实现 Query entry/预算/Role 算法。
3. settled answer 才读取正式 answer/body 显示来源与 stale/gap。pending/running/unknown 保留原身份和“刷新执行状态”入口；明确 observe 只观察原 Query，不重发模型。普通调查停在回答；“规划并执行”把原 answerRef/reason/当前 expected 交 R5b.4 handleGoalInput(planning_answer)，消费返回的 adopt_initial_plan continuation，采用后再交原 advanceWork.select_work。已有采用 Plan 的目标可直接“继续执行”，走同 advanceWork。
4. 同一已授权动作在每次 ready 且有 next 时，await 一次对应公开路由，保存回执并更新显示，然后继续原 next；每步只发一个请求，不加审批弹窗、后台 timer、Promise 脱管或新持久状态。waiting/needs_decision/rejected/unknown/网络结果不确定立即停止自动发送，保留原完整 request 与可读原因；缺治理沿已有配置界面补齐，随后是明确新动作/新 pins，不能换 expected 却复用旧 key。
5. ScopeState 固定到发起 scope/Goal/flow/Session，切导航不把响应或 continuation 贴到新选择。请求发送前保存原 body；重试重发原 request，不换 job/run/Session、不重新生成预算。页面的“停止继续发送”只停止后续 HTTP，不能显示已取消 Runtime；物理 cancel/pause 仍待 R4 接线。页面关闭不会留隐藏后台循环。重开同库可读已知 Query/Goal/原历史，并可从既有正式 Plan 发起新的 select_work；丢失 Query locator 或未完成 continuation 的自动冷恢复不在本批，不扫描全库猜测、不以新 Query 重跑冒充恢复。

这不是整个 N0 request_work 解释/维护/反馈协议，也不自动装配 Reviewer 或升级未来意图。required future/reviewer 的真实 waiting 保留，optional plan_only 仍在图。UI 不自己判断完成，只有原 Workflow/GoalPhase 正式 completed 才显示完成。

## 5. 精确 scope 与正常链验收

10 个生产路径：`app/main.ts`、`app/host.ts`、新 `app/runtime-configuration.ts`、`app/core-http-types.ts`、`app/core-routes.ts`、`ui/main.ts`、`ui/views.ts`、`composition/create-platform.ts`（仅补 registration 读方法的 tracked 发布，来源策略直接消费前批）、`work-graph/configuration/project-bootstrap-contracts.ts`、`project-bootstrap-service.ts`。2 个既有测试：`tests/app/R6-host.test.ts`、`tests/app/R6-workbench.test.ts`。**合计 12 路径，新增仅 1 生产文件**。UI shell 已由 main 渲染，无需 index/CSS/build 改动。所有 Query/Plan/Workflow/Runtime 执行算法、原 record codecs、Kernel、资源 manifest、Skill、server 与其他测试只读。

第一阶段声明上述配置 factory/DTO/窄读口/路由绑定及 UI 接缝，新算法返回明确 unsupported，不提前做 env binding、registration read、Query 自动步骤或 continuation 来让新验收变绿。现 routes 不回退 unsupported，未提供 runtime 的 Host 与已合入 Session/mailbox 保持原行为。主审中审后第二阶段只开放必要生产实现，接口/测试冻结。

只补两组正常链，不加 provider/credential/生命周期矩阵：

1. 原 R6-host HTTP 测试增加一个完整正常链，真实临时启动 JSON → load/parse → 窄 runtime binding 工厂（受控 public ProviderRegistry/SecretSource 测试依赖；只接受测试指定变量名并返回测试假值）→ 同 Host/SQLite/Kernel → 公开 bootstrap Project/Workspace/Goal → registration 读取实际 pins → Query Session/claim/prepare/start → 真 Kernel 只读 source 工具和正式 answer/body → 原初始 Plan/必要治理 → handleGoalInput/advanceWork 正常检查及正式 Goal 完成。可在同 test 的受控 provider 脚本安排 Query 答复与 Work 输出，不种 Query/Evidence/terminal。沿已通过的 Initial Plan/R5c 正常链，工作区 source root 与 SQLite directory/Kernel databasePath 分开，平台持久化输出不得被当作本轮验证源码；这只是同一真实正常链夹具布局，不新增用例。核 bootstrap 与回执不含测试 secret，原 start 重放不新增 provider 调用；关闭重开相同库后 registration/Goal/已知 Query/body/Session history 仍可读。模型注册表真实公开 create 接缝与 client 类型复用，测试替身不成为产品默认。测试不读取真实 env/凭据、不联网真实模型，实际 ProcessSandbox 检查沿原 R3e 正常链。
2. 原 R6-workbench 测试增加一个本批展示/续传消费组：按以上真实回执形状保留答复正文/来源、waiting/next/正式 completed 的不同呈现及完整原请求；不堆关键词、计时或 DOM 框架。主审浏览器额外走一次“调查/规划并执行→答复→采用→下一步”，观察 scope 切换和原请求重发，沿现有浏览器方式，不建新测试体系。

执行 `next-r6-host`、`next-types`、`next-ui-types`、`next-build` 与必要 architecture/import 检查；新 registration 读口只在本正常链检验，不重跑所有 bootstrap/Query/Workflow 矩阵。types、旧路由及旧 Session/mailbox 应保持绿；新链首 unsupported 之后标未达，不声称真实 E2E 通过。提交 hash/outside-scope/检查与首红位置后 STOP，不自行扩大范围或开始实现。

## 6. 同会话一次中审窄纠正（2026-09-26）

主审批准仅修以下真实契约/正常链前态，不增 case 或异常矩阵，原 12 scope 与 originalAllowedHashes 保留：

- 原 R6-workbench 同一正常消费组不能要求 continuation 永久 unsupported；冻结最终 `next.route` 与原 `next.input` 原样交接，原 waiting/completed 停止语义。骨架函数仍 unsupported，故该处应首红。参数/结果用既有 `WorkflowAdvanceResult | InitialPlanningGoalInputResult` 及原 next input 类型，不让 unknown 迫使第二阶段再做一套运行时 DTO 校验；ui/main 的阶段一提示调用仅作必要类型适配，不实现自动步骤。
- 原 R6-host 同一正常链两个 Query `maxTokens:4096` 改为相同且充分的显式 `200000`。此 factory 不引入 ModelInputCounter 端口，既有 ModelBudget 保守计数为 inputBytes+4096，原4096绝不可能发送第一模型请求。Task/Runtime 既有预算算法保持，不增加用例。
- 原 HTTP fixture 的 `checks.permissionRevision` 须等于原 Host 的实际版本：沿现 `permissionRevision(actor, workspace)` 算法（固定 subject/scope、去重排序 readPrefixes、host-permission-v1 SHA256）给该正常配置正确值；不放宽 Runner/Evidence 检查，不增权限 owner 或 case。
- runtime-configuration 中重复 scope/Role 判定改为沿已有 `sameRoleConfiguration` 比较先前 binding；不能用 `JSON.stringify(binding.role)` 的合法属性顺序制造不同 key，随后 factory.find 默取首条。不新增 validator 或测试矩阵。

UI 配置常驻 rows 的 consumer/scope 内部字段仅登记为二阶段产品呈现收敛项，本次不另开 UI 打磨。更正后只执行原固定 `next-r6-host`、`next-types`、`next-ui-types`、`next-build`、`next-architecture`，报告两个正确首 unsupported 和后继未达；STOP，不实现、不导入。
