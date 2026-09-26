# R6.1 本地 Host 与薄工作台：候选骨架任务

2026-09-26，首批 scope、14 个新文件占位与 3 个 selector 已准备，等待主审派发 DSH 骨架。本次 main 仅预建，未实现 Host/UI，不代表已派发、已启动或 R6 已完成。依据 [PRODUCT §8](../../PRODUCT.md)、[END-TO-END §7.1–7.2](../skeleton/END-TO-END.md#71-当前组合根能力与首批入口)及真实 `next/src/composition/create-platform.ts`；目标路径表中的尚未实现方法不能当现成依赖。

## 1. 已有能力与两批切分

两批均在 `coding-platform/next`，直接消费一个 `createTargetPlatform` 实例。Host 只解析输入、绑定上下文、调用窄 port 和传递结果；浏览器只保存选择、布局、原请求及带版本读结果，不另建业务状态库。

| 批次 | 实际入口与现成 port | 可验收结果 |
| --- | --- | --- |
| **R6.1a：启动、初始化与文件/双图查看** | `projects.createProject/registerWorkspace`；`completionPolicies.installCompletionPolicy/activateCompletionPolicy`；`goals.createGoal`；`architecture.adoptInitialArchitecture/readArchitectureRevision/captureSourceChanges/queryArchitecture`；`plans.proposePlan/applyPlanChange/queryGoal/queryTaskGraph/readPlanProposal`；`workspace.readWorkspace/captureSourceChanges/querySource` | 空 SQLite 正式初始化并采用明确提供的初始架构/Plan，工作台真实启动、显示文件、采用架构/观察结构与任务图。没有 Plan 时显示实际缺口，可仅保留目标；不造模型规划成功 |
| **R6.1b：关联导航与 Session/材料/历史/邮箱** | `sessions.findSessions/readSession/getSessionOperation`、已有 WorkLink/归档/重新启用；`runtime.createSession/readSessionHistory/readExecutionHistory/readTaskExecutionHistory/capabilities`；`materials.openArtifact`、`plans.readTaskInput`；`messages.readInbox/readMessage/readMessageBody/sendMessage/ackMessage/respondMessage` | 从图到文件、Session、已知材料及原历史；创建 Session 不启模型，Host 发信与原正文可重开读取。查看不自动 ack，正式回复/状态变化均走现有 writer |

R6.1b 在首批 HTTP/导航契约验收后冻结其文件增量，不一次开放全部 UI。材料先按已知 ref/current 或 historical_explanation 读取，不增加全库浏览；文件先用现有 capture 的分页 paths 与精确 read，不临时引入旧目录服务。Git 版本预览只在 R2e.2 实现验收后启用现有 git version，未交付时保留真实 unsupported。

## 2. 构建与展示复用的实际条件

next 当前只有 NodeNext TypeScript 构建，`tsconfig.json` 无 DOM/JSX；`check-boundaries.mjs` 仅批准 typescript/vitest/@types/node。旧 `C/src/ui` 已装 React/Mantine/XYFlow/Vite，但位于旧 UI 依赖树，当前隔离复制并不提供它们。不能把旧 node_modules 路径写成 next 的源码/构建依赖，也不能只通过旧 UI 构建就宣称独立入口可用。

首批候选使用已有 TypeScript、Node HTTP 与原生 DOM/SVG，不安装新包。浏览器代码独立 DOM 配置编译为 ES module，核心保持 Node 配置；静态 HTML/CSS 与编译 JS 一起输出到 next 的 `dist/app/public/workbench`，Host 只服务该实际产物。`build`/`typecheck` 和原隔离复制包含这一闭包，不能依赖旧 dist 或开发服务器。后续若迁入 React 组件，必须先由主审明确独立第三方依赖与构建闭包，本批不预做选型扩张。

可参考旧 `components/states.tsx`、`Resizer.tsx`、`state/layout.ts`、`features/files.tsx` 的布局/提示、`features/task-graph.tsx` 的纯布局及卡片展示；按当前 DTO 重接必要展示逻辑。不得导入旧 api/client/hooks、GuiState、业务 AppStore、app/service/server 或旧 Runtime/Workflow。旧 ArchitectureView 是 unavailable 占位；旧通信等待/投递时间线也不是 C1 邮箱。采用图与任务图可用简单 SVG/列表并排展示，不能只显示一个 baseline 标签就算双图。

## 3. R6.1a Host 与 HTTP 最小契约

`createLocalWorkbenchHost(options)` 候选输入只来自受信启动配置：`TargetPlatformOptions`（首批无 runtime）、固定 human/system actor、可选监听端口、允许展示的 workspace scope/名称及初始审阅资料。提供 `listen()` 的真实地址与幂等 `close()`；CLI 读取明确指定的本地配置，监听 loopback。根路径、数据库路径、Host 授权函数、Kernel Store 和 actor 均不从 HTTP body 接收；不默认把任意路径配置为可读全仓。配置登记的导航 scope 不是第二份领域状态，也不据此宣称 Project/Workspace 已创建。

CLI 的 JSON 配置与程序化 options 分开：仅含 SQLite directory、固定 actor、port 及 `workspaces:[{scope,name,root,workspaceRevision,readPrefixes}]`，可选原形 `kernelStores:{entries,legacyEntries?}`/初始化资料；`host.ts` 将这些受信描述转换为已有 `WorkspaceHostBindings.resolveRoot/authorize`，按路径分段匹配明确 readPrefixes，空数组无读授权，平台原 denied-prefix/sandbox 仍生效。没有将函数塞进 JSON 的配置协议。转换后的 authorize 必须实际提供既有 `subjectKey`、`permissionRevision` 和 `allowsRead`：subjectKey 稳定绑定固定 actor 与 scope，permissionRevision 由隔离后的该 scope/readPrefixes 授权描述确定性派生，不复用 workspaceRevision 或页面刷新计数。Kernel 条目复用现有 `{adapterId,storeKey,workspace,databasePath}`，不使用新 locator；缺条目时后续 Session 能力如实 unavailable/unsupported。workspaceRevision 沿已有 Host access 契约提供，不把 UI 刷新或外部配置变更计数混入领域版本。

本地 token 是本次 Host 实例的临时请求凭证，`host.ts` 用已有 Node crypto 每次实例创建生成一次 32-byte 随机 hex 值，同实例的重复 listen 不轮换，重开 Host 才失效；不放进 CLI JSON、领域记录或新的用户/会话数据库。复用旧 Host 的 `x-platform-token` 请求头约定，保留已有 Host/Origin 边界，不导入旧 server 实现。`server.ts` 在读取本批构建的 `index.html` 后，仅替换固定 token 占位，将其置于 `<meta name="platform-token" content="…">`，以 `Cache-Control: no-store` 返回；不把实际 token 写回静态产物。`GET /workbench/` 和固定静态资产允许未带 token 的页面启动，但仍先核监听地址对应的 Host 与存在时的同源 Origin，不开启跨源读取。UI 从本页 meta 读取 token，只在页面内存中保存，随后以该 header 请求 bootstrap 和全部 `/api/real/core/*` 路由；这些 API 包括 bootstrap 都必须核 token。CLI 只打印不含 token 的实际工作台地址，不使用查询串/fragment、localStorage 或日志传递 token。重启后旧页面收到明确 403 并提示刷新，不自动重发写操作或更换 requestId/expected。这只补齐同源 UI 的启动交付，不增加登录、cookie、账号或认证路由。

Host 用一个平台实例；所选 scope 必须属于其受信配置。`CoreCallContext` 由 Host 固定 actor 构造 host principal 与同 scope 的 host materialReader；HTTP 断开/超时产生真实 AbortSignal。不要把请求 body 合并进 ctx，不从浏览器接 Run/Role 身份来扮演 Agent。关闭先拒绝新请求，再排空原请求及平台 close；HTTP 取消等待不撤销已经 committed 的领域事实。

所有核心路由为固定 POST `/api/real/core/<下列后缀>`，沿已有本地 token、Host/Origin、JSON 与请求大小边界；不增加多用户账户系统。按端口真实第二参数区分：GraphWrite body 为 `{scope,request:{input,meta:{requestId,expected}}}`，其它为 `{scope,input}`。特别是 `source/capture` 虽为显式动作，实际接 `CaptureSourceRequest` 并返回 `WorkspaceResult<CaptureSummary>`，不套GraphWrite；`architecture/capture` 接GraphWrite并返回持久捕获ref，两者不可混用回执解释。具体 input/返回类型取对应现有 port 第二参数/返回值。不能强行统一不兼容的 OperationReceipt 或 Role command；本批仅发布下表真实方法。

| 路由后缀 | 唯一调用 |
| --- | --- |
| `projects/create`、`workspaces/register` | `projects.createProject`、`projects.registerWorkspace` |
| `completion-policies/install`、`completion-policies/activate` | 对应 completionPolicies writer |
| `goals/create`、`goals/read` | `goals.createGoal`、`plans.queryGoal` |
| `architecture/adopt-initial`、`architecture/read` | `architecture.adoptInitialArchitecture`、`architecture.readArchitectureRevision` |
| `architecture/capture`、`architecture/query` | `architecture.captureSourceChanges`、`architecture.queryArchitecture` |
| `plans/propose`、`plans/apply`、`plans/proposal`、`tasks/query` | `plans.proposePlan`、`applyPlanChange`、`readPlanProposal`、`queryTaskGraph` |
| `files/read`、`source/capture`、`source/query` | `workspace.readWorkspace`、`captureSourceChanges`、`querySource` |

`GET /workbench/` 与固定静态资源路径启动页面；一个固定 `GET /api/real/core/bootstrap` 仅返回允许选择的 scope/名称、受信Host提供的workspaceRevision及显式提供的初始化审阅资料，不返回 root、授权谓词或技术句柄，不扫描账本产生项目/Goal 全库列表。workspaceRevision供真实source capture请求与Host access核对，不能据此声称领域Project/Workspace登记已成功。首次初始化按原 R5a→Goal→初始 architecture→Plan 的正式方法逐项执行并展示回执；它不是跨方法原子事务，途中失败保留已成功事实，同身份重试。UI 按具体表单/审阅步骤生成对应输入；不把通用 JSON 方法执行器作为人的工作台。

政策、职责/路径目录和 Plan 草案来自明确输入或受信初始化资料，呈现后在已有授权范围采用；不自动捏造验收、baseline、Role matrix 或模型产物。允许创建目标后暂时没有采用图；初始意图节点沿已有 plan_only 语义。requestId 与 expected 来自用户正在提交的原请求/已读版本，丢响应时保留原值，不自动换新键/新 pin 重做。返回值保留 committed/replayed/cursor 与全部拒绝判别；普通 JSON 类型派生仍须核对实际序列化，不能传 Map/Set/AbortSignal。

接口解析使用明确 switch/分支和逐路由调用；禁止 `platform[group][method]`、通用动态 method 分发或 Host 直接读写 RecordStore。浏览器契约只能 type-only 引用 Host 的 HTTP DTO，不能把组合根/core 实现打进浏览器。写回执后仅刷新相关 scope/引用；普通查看不触发 capture、模型或全日志扫描，capture 是明确动作。隐藏面板不持续拉取，分页保留 cursor 与 scope/version。

## 4. 首批候选精确文件范围

路径相对 next；19 文件已登记于 R6-host-workbench-skeleton-scope.json，供主审派发；尚未创建 lane 或授予实现阶段写权。

| 类别 | 文件与职责 |
| --- | --- |
| Host，新增 6 文件 | `src/app/host.ts`（唯一平台装配/受信配置/close）；`src/app/server.ts`（HTTP/static/listen）；`src/app/main.ts`（CLI 启动）；`src/app/core-call-context.ts`（Host ctx）；`src/app/core-http-types.ts`（固定 JSON DTO）；`src/app/core-routes.ts`（逐路由解析/调用，无业务归约） |
| 浏览器，新增 4 文件 | `src/ui/main.ts`（表单、请求与引用导航）；`src/ui/views.ts`（状态/文件/双图纯展示）；`src/ui/index.html`；`src/ui/styles.css` |
| 构建/边界，7 文件 | 现有 `package.json`、`tsconfig.json`、`tsconfig.build.json`；新增 `tsconfig.ui.json`、`scripts/build-workbench.mjs`；现有 `scripts/check-boundaries.mjs`、`scripts/verify-isolated.mjs` |
| 测试，新增 2 文件 | `tests/app/R6-host.test.ts`（真实 HTTP→组合根/SQLite）；`tests/app/R6-workbench.test.ts`（构建/静态产物与 DTO 展示纯逻辑） |

两份Node配置都排除 `src/ui`；实际存在 `src/ui` 时边界检查要求并核对 `tsconfig.ui.json` 的extends/逃逸，原无UI架构测试夹具继续有效，不扩测试scope。浏览器构建配置必须实际emit，不继承noEmit后复制空产物。浏览器配置以 src 为 root、独立临时 outDir，检查 UI 及其 type-only DTO 依赖；构建脚本只将 UI 的运行 JS 与确定静态资产复制到上述公开目录，不发布类型检查涉及的 Host/core 产物，不写源码。边界脚本只补 Host/UI 的外层责任识别：Host 可调用 composition 与公开 port；UI 仅本地展示与 type-only HTTP DTO；核心不得反向依赖 Host/UI。原五模块八条边、旧树逃逸限制与第三方白名单保持，不为新增页面放宽整个检查器。隔离检查继续复制 next 实体文件，仅复用既有第三方包；新增实际 Host/静态产物 smoke，不靠旧 UI 目录。

派工前已逐项核对上述 19 个路径：新增 14 个（6 Host、4 UI、UI tsconfig、构建脚本、2 测试），既有 5 个（package.json、两份 Node tsconfig、两份检查脚本）。14 个新文件现仅为明确未实现占位，5 个既有产品文件未改；scope 使用 `coding-platform/next/` 加表中相对路径，不含外部 harness/check.py、依赖锁文件或生成 dist。

首批不修改 composition/core/contracts/Kernel 的业务接口或实现；不改旧工程、锁文件或增加依赖。若公开端口形状迫使新增领域能力，报告具体调用缺口，由主审拆后续批；不得在 Host 实现领域替身。

## 5. 少量真实验收与停止点

1. **空库贯通与重开：** 临时真实 workspace/SQLite，通过实际 HTTP 初始化 Project/Workspace/政策/Goal，采用明确测试资料的初始架构与 Plan；查询两图得到正式 refs/version/diagnostics。重启 Host 后原请求原回执可恢复。不得 raw seed Run、grant、消息或已采用计划。缺政策/缺采用架构通过真实公开失败显示，不能转成空成功图。
2. **真实文件和只读展示：** 同一 scope 显式 capture 后 paths 分页、精确文件读取与 adopted/observed 分开展示；Host 拒绝路径、缺来源和陈旧/无图结果保留原语义。页面打开与查询零模型，首批根本不注入 runtime 模型。真实浏览器点选/提交/刷新作为主审验收，HTTP 测试或 SVG 字符串断言不能替代它。
3. **产物及请求生命周期：** 隔离 build 后启动真实 Host，页面、编译 JS/CSS 路径可取且无旧源码依赖；沿真实 HTML meta 取得临时 token，再成功读取受保护 bootstrap；重开后旧 token 被拒且刷新页面可取得新值，不让测试直接读取私有 Host 字段代替这条启动链；一个真实读窗口悬停时 close 排空，关闭后拒新请求；输入不能伪造 ctx/actor/root，版本冲突不被改写为成功。不复制全套网络安全或 Store 矩阵。

R6.1b 再接已确认的 Session 创建→Host 发信→收件箱正文重开、图/Session→真实材料及 Kernel 原历史分页三条消费者链；复用正式 producer 和现成 fixtures，不用假历史证明下一轮执行。ack/respond、归档等遵循当前领域权限，Host 不代造 work_run。该批精确新增文件与测试另冻结。

两阶段：骨架先发布上述窄接口、真正可启动的 HTTP/static 骨架与目标测试；尚未接线的操作明确 unsupported，不渲染假图。STOP 中审后冻结测试再实现，最终才要求所有首批行为通过。主审持有 selectors/执行 scope；复用 next types/build/architecture/isolated 检查，新增首批目标 selector 不由施工方自行修改外部 harness。

准备阶段已注册 `next-r6-host`，只选择 `tests/app/R6-host.test.ts` 与 `tests/app/R6-workbench.test.ts`。骨架邻接复用 `next-bootstrap`、`next-catalog`、`next-plan`、`next-observed` 和 `tests/architecture/boundaries.test.ts`；实际文件/捕获路径用现有 workspace 目标。`next-types` 当前仅检查 Node tsconfig，不能单独证明 UI 类型通过；已注册 `next-ui-types` 执行 `tsc --noEmit -p tsconfig.ui.json`，施工时仍须让 package typecheck 串联两份检查；已注册 `next-build` 按现 check.py 的 Node 前缀约定传入 `['--run','build']`，实际 build 沿 package build 验证 Node 与 UI 产物。准备时原 package build 仍只构建 Node，占位 UI/build script 不代表构建已接通；最终 verify:isolated 及真实浏览器点选由主审收口。施工方不修改外部 selector。

R4 控制 requested/observed、R5b Query/自动规划、Workflow 推进、R3e 正式完成与维护恢复仍按各自真实交付状态接入。不得发布尚不存在的 searchHistory、assessParallelism、compact/regroup，也不能把 `getSessionOperation` 错挂 Runtime（实际 owner 为 sessions）。本任务不缩减完整 R6、语言工具、版本预览、关联编辑及旧消费者最终退役范围。

## 2026-09-26 派工前独立核对

首批固定路由方法名/owner与实际port一致，19文件候选闭包足够；已修正source capture与architecture capture不同request/result形状、bootstrap的Host workspaceRevision来源、UI配置与原边界夹具兼容。任务当前仍未派发；精确 scope/新文件占位/selector 已备，仅待主审 prepare/run。新测试仍是 export {} 占位，没有真实验收，构建脚本明确 throw 未实现；DSH 须完成本文第一阶段的可启动骨架及红测后 STOP，不跳过中审。

## 6. R6.1b 第一块候选：Session、消息与原历史的真实用户入口

2026-09-26，独立源码核对后的派工准备，**尚未派发**。R6.1a 浏览器验收及六实现已完成导入（`reviews/evidence/next-b2-2026-09-26/r6-host-workbench-implementation-import.json`）；首块从该 fresh main 准备，执行说明见 [R6 Session/mailbox 第一阶段任务](R6-session-mailbox-skeleton.md) 与 [六路径 scope](R6-session-mailbox-skeleton-scope.json)。本节不执行派工或提前创建占位。第一块选“从任务/工作区选择或创建会话 → Host 发信 → 查看收件箱正文 → 原历史与重开”，而非一次接完全部后台能力。该链已经有真实 producer，可以与 Query execution 骨架和 Workflow 实现并行，且无需改它们共同占用的 composition/runtime/core。

### 6.1 已有 owner 与第一块边界

`create-platform.ts` 已在没有 `options.runtime` 模型配置时独立装配 `createSessionOperations({sessions,kernelStores})`，`runtime.createSession/readSessionHistory/capabilities` 是真实服务；Session 创建不启动模型，也不需要先造 Task、采用 Plan 或永久 Agent 目录。现 `tests/composition/A1-graph-session-platform.test.ts` 已有真实 Kernel Session 创建、原始 session_created 历史、关闭重开及正式关联的消费者，可按原公开链复用。

Session 列表/详情/创建操作读来自 `platform.sessions.findSessions/readSession/getSessionOperation`；消息来自同一 `platform.messages`。关键权限必须沿实码：`mailbox-service.ts::ackMessage/respondMessage` 只接受正式 work_run，明确拒绝 Host。因此本块提供 **Host 发信及查看**，不提供“代收件 Agent 标已读/回复”的写入口；查看保持 pending，已有 response 可只读展开。消息不构成强制任务、不唤醒/抢占 Session。先使用创建时已有 initialLinks 与目录 target 过滤关联真实 Task；后续独立 link/archive/reactivate 按原生命周期 owner 接入，不在此批扩写。

本块无需修改 `host.ts`、CLI 或 server：现 Host 已传递受信 `kernelStores`、隔离复制并发布 `review`，server 依据 `CORE_ROUTE_SPECS` 分发；新增 named bindings 仍取同一个真实 platform。缺 Kernel Store 时 capability/创建真实报告不可用，目录与已持久消息读取仍可用，不要求先注入模型配置。

### 6.2 十条新增明确路由与 DTO

只扩现 `core-http-types.ts` 和 `core-routes.ts`，沿原 `SecondArgument` / `RouteResponse` 从下列公开 port 派生类型，不复制领域 DTO，不增加通用 method 执行器。UI 仍仅 type-only 引 HTTP DTO。原 17 路由与 HTTP 状态语义保持。

| 路由后缀 | 原 owner / 方法 | body 形状 |
| --- | --- | --- |
| `sessions/find` | SessionDirectoryPort.findSessions | `{scope,input}`，含 workspace/可选 target/includeArchived/page |
| `sessions/read` | SessionDirectoryPort.readSession | `{scope,input:SessionRef}` |
| `sessions/operation` | SessionDirectoryPort.getSessionOperation | `{scope,input:OperationRef}` |
| `runtime/capabilities` | RuntimeExecutionPort.capabilities | `{scope,input:WorkspaceScope}` |
| `sessions/create` | RuntimeExecutionPort.createSession | **plain** `{scope,input:CreateSessionRequest}`；其 input 自身含 meta，不是 GraphWrite |
| `sessions/history` | RuntimeExecutionPort.readSessionHistory | `{scope,input:SessionHistoryRequest}` |
| `messages/send` | SessionMailboxPort.sendMessage | 原 GraphWrite `{scope,request:{input,meta}}` |
| `messages/inbox` | SessionMailboxPort.readInbox | `{scope,input:{recipient,status?,page}}` |
| `messages/read` | SessionMailboxPort.readMessage | `{scope,input:SessionMessageRef}` |
| `messages/body` | SessionMailboxPort.readMessageBody | `{scope,input:{messageRef,part}}` |

`CoreRoutePlatform` 只增加以上方法的 Pick，`createPlatformCoreRouteBindings` 明确 named bind；不因有 runtime port 就开放 prepare/start/控制模型。`sessions/create` 保留原 OperationReceipt accepted/completed/rejected，plain 返回原 HTTP 200 结果体；messages/send 作为 GraphWrite 继续既有拒绝状态映射。不得为统一外观改旧 files/read 语义或把 accepted 改成 committed。所有调用仍由 server 构建固定 Host actor/可信 scope/请求 signal，浏览器不得提交 ctx、root、Kernel locator、work_run principal 或授权字段。

可在既有 `BootstrapReviewMaterial` 添加一个窄可选字段：

```ts
sessionRoles?: Array<{
  scope: CoreScope;
  label: string;
  role: RoleConfigurationRef;
}>;
```

仅作为受信启动资料内的显式可选引用与显示名，不建新 Role registry、不替代领域 Role 校验、不赋予模型工具权限。role_spec 使用已有完整 pin；已有部署若明确提供 legacy_template 则原样保留，不由页面生成虚假模板或默认 role_spec。UI 只列当前 scope 的条目；没有资料不阻塞列表/已有会话/消息/历史，只提示配置创建角色。现 Host/CLI 的 review 传递已足够，不为这一个字段重写配置层，也不向 bootstrap 暴露 databasePath/root。

### 6.3 用户路径及状态

- 工作区内打开“会话”，真实分页 findSessions，显示角色、活跃/归档、可用/忙碌等原字段。从任务卡“关联会话”用该真实 TaskTriple 作为 WorkLinkTarget 过滤；从已有会话详情可返回关联任务。SessionRef 没有 workspaceId，不得自行扩其类型；当前 scope 始终随 HTTP 发送并交原 owner 验证。
- “创建会话”选择受信角色；直接工作区创建用 recommendedRefs/initialLinks 空数组，任务入口创建可用真实当前 Task target 和用户选择的既有 relation。CreateSessionRequest 的 workspace、role、refs/links、meta 都在发送前固定；meta 按当前 owner 允许的形式构造，正常首次可用 expected:[]，不增加未被 owner 要求的 Task/政策/pin 前提。accepted 只展示“创建处理中”与原 operationRef，显式“刷新状态”调用 sessions/operation；completed 才选中真实返回 SessionRef。失联或恢复重试使用原请求，不另造 Session、不自动后台轮询或启动模型。
- 选中会话后显示收件箱，输入文字由固定 Host 发信。send 的 expected 按现 owner 必须为空；新动作新 requestId，原样重发保留旧 body。使用 send 返回的完整 messageRef 定向读正文；正文走 messages/body 的专用资格与 sourceRef，不改为任意 materials.openArtifact。显示真实发送者、时间、pending/read/responded 和可选原回复；浏览与刷新不 ack，不伪造回复或消息已完成。
- “历史”读取原 SessionHistoryRequest，初次 afterCursor/throughCursor 为 null，limit 有界；后页沿原 nextCursor 与 basis/through 约束，刷新是明确新头部读取。真实 Session 创建只保证 session_created，不生成假 turn/assistant 消息来填展示。原 Kernel JSON 可读出已知类型的摘要，未知类型保留折叠原文；ArtifactRef body 不当作已有正文或自动 current 权限。所有历史定位和原始内容保留，不把平台消息冒充 Kernel 对话记录。
- 重开 Host 后用真实目录重新选择会话，沿原消息 ref/收件箱与 Kernel 映射读取；不要求用户复制大段 JSON，不扫全账本恢复 UI。所有异步结果与 cursor 始终归发出请求的 scope + SessionRef；切换工作区/会话后不能串用，沿 R6.1a 返修后的原请求保存、文本输入不重绘及可展开技术详情模式。

### 6.4 精确首块 scope 与少量验收

生产只 **4 个现有文件**：

1. `coding-platform/next/src/app/core-http-types.ts`
2. `coding-platform/next/src/app/core-routes.ts`
3. `coding-platform/next/src/ui/main.ts`
4. `coding-platform/next/src/ui/views.ts`

测试只复用 **2 个现有文件**：`coding-platform/next/tests/app/R6-host.test.ts`、`coding-platform/next/tests/app/R6-workbench.test.ts`。当前两个文件已有真实 Host/static 构建与 HTTP helper；只在其内给 startHost 增加可选真实 kernelStores/角色资料与重开参数，默认行为不变，不复制 R4/B2 大夹具，不新建 helper 或测试体系。原 15 项不改业务断言；路由完整枚举随这十条真实新增路由作必要更新。Host/CLI/server、composition、contracts、runtime、Session/mailbox/Material/Workspace/Query/Workflow/control 生产者和全部其他测试只读。

只增加两组消费者检查，不补后台矩阵：

1. 原真实 HTTP/SQLite 测试中新增一个完整正常链：真实 Kernel store 配置和固定角色资料 → createSession completed → directory/read → 原创建请求 replay → Host send → inbox/body（正文相等，查看后仍 pending）→ 原 Kernel session_created 历史 → 关闭重开同库，目录/消息正文/原历史仍可读。全部由真实公开 writer 生产，不 seed Session/消息/历史；同一次链核实际完整 refs/cursor/OperationReceipt。分页消费真实返回 cursor；只有创建记录时 nextCursor:null 是正确结果，不为凑页数伪造模型执行。
2. 原 workbench 测试中新增一个纯展示消费者：使用上一种真实公开结果或明确派生 DTO，核会话摘要、正文/已存在回复和历史入口保留原身份；原技术原文折叠可取，缺能力/处理中不显示完成。只验证本次接线所需展示，不堆关键词断言或重造浏览器测试框架。

主审真实浏览器走创建/发信/刷新正文/原历史/重开与切换关联会话，才算这块用户路径验收。新增能力骨架先声明接口与最终行为测试，明确新路由 unsupported，旧功能保持；首红后的未达步骤如实报告，然后 STOP。主审冻结后再开放这四生产实现，测试转只读。不为小范围 UI 接线运行全领域矩阵；沿 `next-r6-host`、`next-types`、`next-ui-types`、`next-build`，必要时仅本次触及的结构边界检查。共享文件冲突仅在 app/UI，必须以 R6.1a 最终导入为基线；Query execution/Workflow lane 不写这六路径，故可并行。

### 6.5 保留后续实际消费者，不提前宣称交付

| 后续窄增量 | 真正复用 owner / 已知限制 |
| --- | --- |
| 已知材料与任务输入 | `materials.openArtifact({ref,usage})`、`plans.readTaskInput`；从 Task/Session/正文已知 ref 进入，区分 current 与 historical_explanation，不加全库浏览/伪授权。通用 read_material 模型工具的接线是另一个消费者，不能由 Host 可读推断已交付 |
| 执行历史定位 | `runtime.readExecutionHistory/readTaskExecutionHistory`；从真实 TaskGraph.execution / TaskTriple 到原 Kernel 范围，不拼造新 Session 或 turn，不用假历史证明下一轮可执行 |
| 会话关联与生命周期 | 同一 `sessions.linkSessionWork/archiveSession/reactivateSession`；精确原版本/回执，pending inbox 不阻塞归档，归档不唤醒执行。Host 不开放只能 work_run ack/respond 的动作 |
| Git 版本与比较 | `workspace.readWorkspace` 已支持完整 Git commitOID；`workspace.compareWorkspace` 有 capture/capture 与 git/git 联合。后续现文件面板补 Git version 与一条明确 compare 路由；保留真实 prefix/path 授权、binary/mode/path 身份。mixed、任意 shell、写 Git、语言 provider 不在此小块 |
| Query / 初始规划 | 当前 `queries.submitQueryJob/readQueryJob` 的 pending pair 可读；真正 Session/Kernel 执行待 R5b.2 owner 骨架/实现验收后按已冻结方法绑定，不把提交成功显示为回答或已采用 Plan |
| Workflow / 正式完成 | 等正在施工的真实 `business/workflow` facade 与 Task/Goal 完成 producer 合入，再公开具体动作/运行状态。不得把当前 N0 unsupported facade 展示成自动推进或改在 Host 编排核心 |
| 控制与恢复 | `controls.submitControl/readControl` 当前只持久受理意图；页面必须区分已请求与物理停止。R4.3 后真实 observed/ack 接通再显示对应完成，不能借本块创建/读 Session 冒充 resume、冷恢复或 compact |

### 6.5.1 后续 Host 执行配置的最小落位（仅核类型与来源，未派发）

当前真实 CLI 是 `src/app/main.ts` 的 WorkbenchCliConfig/parseWorkbenchCliConfig/loadWorkbenchCliConfig；`host.ts` 的 LocalWorkbenchHostOptions 向同一 createTargetPlatform 传递了 kernelStores，**尚未传 runtime/checks/workflow**。组合根已存在 `TargetPlatformOptions.runtime?:RuntimeHostBindings`、`checks?:TrustedCheckConfiguration`、`workflow?:WorkflowHostConfiguration` 三个接缝。Session 能创建、历史可读不表示本地工作台已能调用模型或自动推进；后续 Query/Workflow 路由必须和这三个可信配置一起落位。

最小生产落位限定在现 `main.ts`、`host.ts` 加必要的窄 `app/runtime-configuration.ts` 适配；具体 scope 等 Query/Workflow 实现导入及本次 Session/mailbox app/UI 变动确认后再冻结。程序化 Host options 直接复用 `TargetPlatformOptions` 的三个类型，第一 await 前隔离纯配置，函数/client 依赖保留原接缝；CLI 只接可序列化描述并在可信启动侧装配 resolver，不从 HTTP/body/模型 JSON 接受函数、client、root、密钥或工具授权。主组合根仍只创建一次，app 不另开 Runtime/Query/Workflow engine。

- 模型描述由显式受信启动文件提供 provider/model/baseUrl/options/configurationRevision 与环境变量**名称**，不存密钥正文。冻结 `next/vendor/coding-agent/dist/public-api` 经 m5-public-api 已导出 `createBuiltinProviderRegistry()` 与 `ProviderRegistry`；用其 `get(provider)` 取得真实 provider 定义、`secretEnvironmentVariable`/defaultBaseUrl，随后 `create(provider,{apiKey,model,baseUrl,options})` 生成原 ModelClientPort。环境变量名称可显式受信配置，省略时取该 provider 的 secretEnvironmentVariable；仅此启动适配读取指定变量，缺值给明确配置缺口，不打印环境值/完整配置/异常响应。默认 URL 只能取选定 provider 定义，模型与预算不猜。无需修改 Kernel 或自行实现网络 client。
- Runtime 继续消费现 `source-tool-ports.ts` 的 BoundModel（configuration 的 revision/provider/model/baseUrl、client、可选 inputCounter）；现模型注册表的准确代码名是 **ProviderRegistry**，不另外新建 ModelRegistry。不迁旧 app/model-settings 管理服务、不代理旧 app、不复制 runObservedModel 或 ModelBudget。配置 revision 是 Host 已给定的配置版本；密钥不进入 revision 摘要、prepared bundle、bootstrap、日志、结果或测试快照。
- 可信配置的 Role/Workspace binding 选定完整 RoleConfigurationRef，沿现 Role facts 保留 resolved/absent/inadmissible；只有显式 legacy_template 可用真实 hostTemplate。ResolvedRuntimeConfiguration 的 budget、tools/writeScope/shell grant、skills.resourceRoot/enabledIds、systemInstruction、deniedPrefixes、processSandboxOptions、materialBasis 逐项来自同一受信配置及现 owner，缺权限不补全根授权，不从任务文本拼 Role binding。Query 专用 resolver 的方法名/DTO 以 R5b 执行最终导入为准，复用同 provider/BoundModel；Query readOnly 与原预算交集仍由原 Runtime 执行。此处不设计 Role 热切换。
- checks 原样沿 TrustedCheckConfiguration 的真实 configurationRevision/workspace/executor/permissionRevision/sourceAccess/processAccess/deniedPrefixes/checks 装配；工作台不会把用户 HTTP 字符串变成注册 command。workflow 原样沿已合入 WorkflowHostConfiguration 的 consumerId 与 workspace/sessionRole/roleBinding/budget bindings；预算、deadline 和 Role pins 不由 UI 生成默认值。Kernel stores 沿既有真实 locator 配置，不能每次 Query 另开库。路径只在可信 CLI 侧按显式配置目录解析，沿原 owner 核适用性。

后续只需一条真实配置正常链：显式本地配置 → 一个 Host/platform → 正式 Query 回答 → 初始候选/采用 → Workflow 原正常执行与检查完成，连同原公开历史可读；先用受控 provider 或本地受控 endpoint 验证装配，不引入网络测试矩阵。本次只读取以上源码和声明核类型与配置来源，未访问用户配置文件、环境变量值或任何凭据。`review`/bootstrap 继续只含展示资料，不能承载 runtime/client/secret。缺模型配置时现项目/任务/会话/历史/消息读取继续可用，真实模型动作明确未配置。

### 6.6 下一批候选：可信执行配置与 Query/Workflow 用户入口

2026-09-26，仅完成有界设计，**尚未派发、未建源码占位**。详见 [R6 执行入口第一阶段任务](R6-execution-entry-skeleton.md) 与 [12 路径 scope 草稿](R6-execution-entry-skeleton-scope.json)。不是扩整个工作台：本批只接“工作区目标 → 只读调查/初始规划 → 原回答正文 → 原候选/采用 → Workflow 现正常执行/检查/正式完成”，连同相同身份的状态查看及原请求重发。材料任意浏览、更多生命周期、Git/语言、控制恢复、多轮 Query 和后台冷恢复均留原后续范围。

实际必要缺口已由源码核实：

1. CLI/Host 的 runtime/checks/workflow 可信配置尚未传给现组合根；按 §6.5.1 复用原 RuntimeHostBindings、ProviderRegistry/BoundModel、TrustedCheckConfiguration、WorkflowHostConfiguration，不复制模型循环。环境变量只由 Host 在实际绑定 provider 时按明确名称读取；UI/bootstrap 不含变量名、密钥、client、根路径或 provider options。
2. `RuntimeExecutionDependencies.sourcePolicyFor` 与 Work/Query source factory 已存在；Query 骨架批已由主审冻结 `TargetPlatformOptions.sourcePolicyFor?:RuntimeExecutionDependencies['sourcePolicyFor']` 及同 Runtime 透传。本批以该批最终导入为前置，直接消费这一选项，不再次扩 composition 的来源策略接口。Host 从已有 workspaces root/readPrefixes/permissionRevision 构造原 SourcePolicy，复用现 prefixMatches，不替换原 source authority/实际准入。
3. Query submit 必须 pin Project/Workspace/Goal，当前 projects 只有 create/register，queryGoal 只带 Goal。为重开工作台后取得实际版本，在原 ProjectRegistrationPort/service 窄加 `readWorkspaceRegistration(ctx, WorkspaceScope):Promise<ReadResult<{project:ProjectSnapshot;workspace:WorkspaceSnapshot}>>`，一次精确 readMany 两个既有 key，复用 persistence/record-codecs 的 Project/Workspace 解码和现 Store 结果边界。无新 schema/owner/扫描，不假设 revision=1；同组合根 tracked 发布，HTTP 只读转发。

共享写入依赖：R6 Session/mailbox 实现先导入，再以其最终 app/UI 为基线；Query execution、Workflow advanceWork 和初始 Plan §11 的实现均须先导入，保留最终 composition/公开类型/Skill。届时主审核对 fresh main 后再准备本批；不能覆盖在途 lane。本批不写 Task/Query/Workflow 实现，只复用其公共方法，唯一 Core 增量是原 Project owner 的注册读取。参谋 Skill/runtime-assets 保持只读，原初始 Plan 批次负责资源 SHA 集成。

草稿固定 10 生产＋2 既有测试文件，新增生产仅 app/runtime-configuration.ts。11 条明确新增路由见派工任务，均使用真实 owner 参数/回执；页面只顺序消费原 continuation，不造状态表、不调内部 terminal writer、不把 accepted/unknown 当已完成。用户选择“调查”停在答复，选择“规划并执行”才沿已授权 continuation 自动继续；不增加逐步审批，也不以每次 HTTP 返回就再问用户是否继续。

本节只冻结首块候选接线，不删除完整 R6.1b、自动规划、Workflow/Host 全用户路径、关联编辑、语言工具或高级恢复的后续范围。


### 6.7 下一批 UI：先接真实浏览与草稿，再接执行动作（未派发）

2026-09-26，按用户最新交互确认与 [UI-WORKBENCH](../../UI-WORKBENCH.md)、[MVP B07](../../MVP-BEHAVIOR.md#b07查询解释与统一导航) 补充顺序。原型只用于核对交互，不是生产交付。当前 `next/src/ui/main.ts/views.ts/styles.css` 已消费初始化、文件、双图、Session、邮箱与原历史，但仍为表单/列表，没有固定高度三栏、传统对话、多页辅助区或文件编辑器。本节只准备下一批，不改 §6.6 执行入口的前置，不启动实现或新增测试矩阵。

| 最小顺序 | 真实事实源与可做范围 | 尚待接通的部分 |
| --- | --- | --- |
| 1. 三栏与局部页面 | 在现 `src/ui/{main.ts,views.ts,styles.css,index.html}` 改布局：整体固定视口高，对话、辅助页、详情各自滚动，页签与输入保持可用；两分隔可调，辅助区可隐藏/放大/新建/切换/关闭多页。宽图保留内部大画布与横向滚动，不压缩文字。只保存 scope、对象/版本、滚动、展开、固定集合和草稿等显示状态 | 与 §6.6 同写 app/UI，按最终导入顺序更新 fresh main，不并行覆盖。隐藏/关页不终止真实执行；布局可先做，不等模型配置 |
| 2. 项目/Agent 与传统 Session | 项目导航沿 bootstrap 的允许 scope；Agent 沿 `sessions.findSessions/readSession` 的 SessionRecord、availability、WorkLink，保留工作中/待命未归档者，归档按需查询，角色默认收起。`runtime.readSessionHistory` 有界读取原记录，正文、工具和已有公开解释按原 position 展示，未知类型仍能查看原文；邮箱保持独立来源标识 | 当前 HTTP 已有这些读口，UI 尚未提供归档筛选。主对话的真正模型发送与继续动作依赖 §6.6；现 `messages/send` 仅是 Host 发信，不等于 Kernel 对话轮次。归档页只读，不开放发送 |
| 3. 两图结构与统一详情 | `plans.queryTaskGraph` 的 Plan taskHierarchy.parentOf、TaskRow、relations、execution 和 planning diagnostics 画 Task 结构；保留 plan_only/optional/缺验收未来节点。`architecture.readArchitectureRevision` 画正式模块/依赖，`queryArchitecture` 画带来源的观测关系，二者不混同。单击选中详情、hover 短预览、双击/右键固定完整显示，右键及详情均可新 tab；固定只影响显示 | R3d 已在原 AdoptedArchitecture 保存显式可选 containment.parentOf，并由现 architecture/read 返回；缺省是未声明、显式空数组是平铺，生产 UI 尚待消费该事实并分别展示包含树与 dependencies，不能从路径或依赖猜父子；活跃路径并集、兄弟及手动分支继续沿真实活动事实与纯显示偏好接线 |
| 4. 图到工作历史及连续时间图 | 详情按原 WorkLink target 查询 current/historical Session，含归档；从真实 RunRef 复用 `executions.readExecution` 与 `runtime.readTaskExecutionHistory`，取真实 Run/Attempt、时间和原 Kernel 区间。连续纵向放大镜、邻近区域连续展开与离散轨迹是同一事实的两种布局；真实重叠区间横向分列，Task 内原序保留，并行活动不画成单条因果链 | 精确执行/历史 port 已有，HTTP 尚未发布；只做 named 路由透传。TaskGraph 当前只有当前 Attempt/Run 引用，不能声称已列全历史；全历史尝试导航需原 owner 提供可枚举的正式引用。没有执行时间的未来节点单独保留，不伪造时间；缺时间/缺页明确显示，不扫全库补齐 |
| 5. 文件树、独立编辑页与引用草稿 | 现 `source/query` 的分页 paths 可按路径投影目录，保留 capture/coverage/nextCursor，不能冒充完整实时文件系统；`files/read` 的 path/content/version/digest 打开独立文件页。目录与文件页都能加入当前草稿：整文件带 path；选区带 path、片段、起止行；未保存文本标“草稿快照”。只加入当前 scope/对话 draft，不自动发送；历史文件/归档页保持只读 | 原 `WorkspaceToolsPort` 有 read/capture/query/compare，没有完整目录枚举或文件保存 port。本地草稿编辑可先做，真实保存待既有 Workspace owner 的授权写入口；不得在 Host 直接写盘。固定 Git 读口已存在，diff 复用 compareWorkspace＋两侧精确版本读取并补窄 HTTP 路由；不把 capture 过期或不可读当空文件 |
| 6. 接真正发送、规划与控制 | 按 §6.6 的 Query→原回答→初始 Plan→Workflow continuation 接入中心输入；两图与详情消费提交回执/原读取结果，不在浏览器归约完成或另建 Agent/Session 状态库 | 依赖 Query/初始 Plan/Workflow 与 Host runtime/checks/workflow 配置的真实导入。暂停/继续/取消依赖 R4 对应物理观察与恢复，终端也需真实 Host 会话能力；未接通时如实说明，不用原型按钮或邮箱回执替代 |

Task 折叠视图和原序视图引用相同事件身份，不搬动事件制造顺序；无 Task 的 Query 留在原会话。默认摘要来自已公开记录的解释/总结，不另行推导；依用户2026-09-26最新纠偏，主动展开原始历史可查看该Session实际保存的完整字段，包括已有reasoningContent/reasoning、工具原参和原结果，摘要不能使原文永久不可达。图详情的文件、diff、材料与历史链接携带既有完整 ref/版本；当前、历史、未授权、缺失与尚未读取分开表达。异步响应归原 scope/Session/页签，切页不串草稿、选区或来源；普通点选、展开、分页不启模型、不自动 capture 或 ack。

首块优先完成 1–3 中现成 DTO 足够的部分及 5 的只读/本地草稿，使生产界面先可用；4 的窄读取接线与 §6.6 按共享文件依赖接续。实际验收沿已有两份 R6 消费者测试与一条真实浏览器路径，检查导航、事件顺序、独立滚动、版本引用和引用只入草稿；不为每项显示偏好增加后端 owner 或新测试体系。下一块仅使用现有 HTTP/DTO，任务见 [UI 布局与已有事实骨架](R6-ui-layout-skeleton.md) 及 [5 路径 scope](R6-ui-layout-skeleton-scope.json)。须先导入当前 main.ts 浏览器修复，再按 fresh main 冻结；§6.6 执行入口仍按原依赖接续。本节及该任务均未派发、未预建源码占位。
