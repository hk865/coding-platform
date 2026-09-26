# R6.1b-1 会话、消息与原历史：第一阶段骨架

> 用户现要求新建 DSH 会话接手。旧会话因传输中断未交付；已确认并修复沙箱遮住系统 DNS 文件的问题。沿当前 lane 已落盘源码继续，不重新 prepare、不覆盖已有成果。先核当前文件与本任务必要接口，然后直接完成剩余施工，不重做全仓调查；仍严格保持本任务阶段、写范围、冻结测试和 STOP 边界。旧 Session 与 attempts 继续保留。

2026-09-26。R6.1a 六实现已导入，证据为 `reviews/evidence/next-b2-2026-09-26/r6-host-workbench-implementation-import.json`。本任务从该最终 main 准备，仅新增已有服务的 Host/UI 消费者骨架与两个最终行为测试；详细设计真源为 [R6 主任务 §6](R6-host-workbench-skeleton.md#6-r61b-第一块候选session消息与原历史的真实用户入口)，不重新设计 Session、邮箱或历史。本文是可派发说明，主审负责实际 prepare/run。

先读 docs/AGENTS.md、当前 HANDOFF、CODE-QUALITY-GUIDELINES §2.1、DSH-EXECUTION-HARNESS 和主任务 §6。骨架不得带偏；正常用户链、真实身份及持久副作用边界是门槛，不增加覆盖矩阵或审阅轮次。第一阶段完成立即 STOP，中审后另行授权实现。

## 唯一六路径

[scope JSON](R6-session-mailbox-skeleton-scope.json) 中 **4 生产 + 2 现有测试**，均已存在：

- `coding-platform/next/src/app/core-http-types.ts`
- `coding-platform/next/src/app/core-routes.ts`
- `coding-platform/next/src/ui/main.ts`
- `coding-platform/next/src/ui/views.ts`
- `coding-platform/next/tests/app/R6-host.test.ts`
- `coding-platform/next/tests/app/R6-workbench.test.ts`

其余只读，尤其 host/CLI/server/token、index/styles、构建与检查配置、composition、contracts、Runtime/Session/mailbox/Material/Workspace/Query/Workflow/control、其他测试与 helper。不得安装依赖、新建产品文件或第二状态 owner。R6.1a 输入失焦修正、异步结果归原 scope、产品文案及折叠技术详情必须保持。Query/Workflow 并行 lane 不写这六路径；本批不得恢复共享 composition 的旧副本。

## 十条窄接口与阶段一接缝

在 `core-http-types.ts` 沿既有 `PlainBody/GraphWriteBody/RouteResponse` 派生请求/响应类型。下面名字与源码已核对：没有 `listSessions` 方法，正式目录方法是 **findSessions**；创建操作读取归 **sessions.getSessionOperation**，不是 Runtime。

| suffix | named binding | 真实类型/owner | kind |
| --- | --- | --- | --- |
| sessions/find | findSessions | SessionDirectoryPort['findSessions'] / sessions | plain |
| sessions/read | readSession | SessionDirectoryPort['readSession'] / sessions | plain |
| sessions/operation | getSessionOperation | SessionDirectoryPort['getSessionOperation'] / sessions | plain |
| runtime/capabilities | runtimeCapabilities | RuntimeExecutionPort['capabilities'] / runtime | plain |
| sessions/create | createSession | RuntimeExecutionPort['createSession'] / runtime | plain |
| sessions/history | readSessionHistory | RuntimeExecutionPort['readSessionHistory'] / runtime | plain |
| messages/send | sendMessage | SessionMailboxPort['sendMessage'] / messages | graph_write |
| messages/inbox | readInbox | SessionMailboxPort['readInbox'] / messages | plain |
| messages/read | readMessage | SessionMailboxPort['readMessage'] / messages | plain |
| messages/body | readMessageBody | SessionMailboxPort['readMessageBody'] / messages | plain |

`CoreRoutePlatform` 保留原字段，仅新增：

```ts
sessions: Pick<SessionDirectoryPort, 'findSessions' | 'readSession' | 'getSessionOperation'>;
runtime: Pick<RuntimeExecutionPort, 'capabilities' | 'createSession' | 'readSessionHistory'>;
messages: Pick<SessionMailboxPort, 'sendMessage' | 'readInbox' | 'readMessage' | 'readMessageBody'>;
```

`CoreRouteBindings` 对应十个方法使用表内 indexed method 类型；`CORE_ROUTE_SPECS` 与显式 switch 增加十个分支。第一阶段 `createPlatformCoreRouteBindings` 保留原 17 个真实绑定，**仅新十绑定明确返回 unsupported**，不提前接入真实服务或实现整个 UI 链。类型/dispatch 不得假定所有请求是 GraphWrite：

- findSessions 第二参数为 `{workspace,target?,role?,includeArchived,page:{limit,cursor?,atLeastCursor?}}`，返回 `ReadResult<SessionPage<SessionCard>>`。
- readInbox 第二参数为 `{recipient:SessionRef,status?,page:{limit,cursor?,atLeastCursor?}}`，返回含原 `items/nextCursor/sourceCursor` 的 ReadResult；不能重命名为 messages.list 或把 cursor 提到错误层。
- createSession 是 `{workspace,role,recommendedRefs,initialLinks,meta}` 的 **原第二参数**，所以 HTTP 为 `{scope,input:<该对象>}`，返回原 OperationReceipt。accepted/completed/rejected 原样传递，accepted 不是已创建；不套成 `{input,meta}` GraphWrite、不更改 server 协议。
- readSessionHistory 原 request 含 `sessionRef/afterCursor/throughCursor/limit/range?`，返回 `Page`（basis，不是目录 sourceCursor）。普通会话头部读取不自造 range；沿原 cursor 继续。
- sendMessage 原 GraphWrite 输入 `{recipient,text}`；meta.expected 必须按 owner 使用空数组。原 sender 从受信 ctx 产生，浏览器不提供 sender/actor/root/权限。

新 plain 路由保留现 HTTP 200 领域结果体，messages/send 按原 GraphWrite 拒绝映射。旧 files/read HTTP 200 rejected 与 GraphWrite conflict HTTP 409 不改。不要新建通用 JSON/method 路由。

可在既有 BootstrapReviewMaterial 追加主任务 §6.2 的可选 `sessionRoles: {scope,label,role:RoleConfigurationRef}[]`，只由受信 review 输入并沿原 Host 发布。它只是角色引用选择资料，不是新授权。没有条目仍能查看已有会话/消息/历史；配置缺 Kernel Store 则保留真实 capability 不可用。Host 已透传 kernelStores，CLI/host/server 无需改造。

UI 第一阶段只声明 typed 的新会话/收件箱/历史面板与事件接缝、新功能明确缺口；不提前实现正常链。views 可新增对应纯 renderer，参数沿上述实际 Response aliases，不依赖 DOM/network/领域服务。原界面正常运行，不能以整体 app unsupported 回退。技术原文可展开，默认界面用“会话、收件箱、历史、创建处理中、重新发送”等产品语言。

## 两条最终行为测试，原 15 项保留

每个现有测试文件 **只新增一个 it**；不删除、跳过、弱化原 15 项的业务断言，不铺全部权限、取消、并发或损坏矩阵。类型/路由完整枚举若确因十条新增路由需增量更新，只增新成员，不去掉原成员。

1. **R6-host.test.ts：一个真实正常链。** 原 startHost/helper 可在该文件内最小增加可选 kernelStores/review 资料及同路径重开参数，默认不变。真实临时 SQLite + 原 Kernel store 配置，经实际 HTML meta 取 token → sessions/create completed → sessions/find/read/operation → 原创建请求 replay → messages/send → inbox/read/body 正文一致且读取后仍 pending → sessions/history 得到真实 session_created → 关闭重开同库后目录、正文、原历史仍可读。使用真实返回 SessionRef/operationRef/messageRef/原 cursor 与原请求，不能 raw seed、伪造 history/消息或注入模型。创建不需要预先 Task/Plan，role 采用明确可信 fixture 配置的既有角色引用。只创建一条会话历史时 nextCursor:null 正确，不为更多页伪造 turn。
2. **R6-workbench.test.ts：一个展示消费者正常链。** 用实际公开形状的 typed DTO 连续展示会话摘要、消息正文、原历史与详情入口，保留实际身份/状态/游标；无回复不能造回复，处理中不能显示已完成。此处是纯展示数据输入，不声称模型执行或持久写已发生。不要堆措辞关键词矩阵或另建浏览器框架。真实交互最终由主审浏览器验收。

两条均断言最终成功行为。第一阶段 HTTP 链应在新入口的明确 unsupported 首红；之后的 Kernel/消息/重开步骤尚未到达，报告需说清，不 catch 后称已通过，不把合法请求 expected unsupported 固化成绿测。第二阶段真正接通后必须跑到这些后段。原 15 项继续通过；不把旧断言随意改成 accepts-any-result。

C1 Host 不允许 ack/respond，不能在本批暴露代 Agent 已读/回复；查看不唤醒、不启动模型。材料、执行范围历史、lifecycle、Git、Query/Workflow/control 后续消费者保留主任务 §6.5，不在此白名单扩开。

## 检查、交付、停止

沿现 `next-r6-host`（原 15 + 新 2 个 case）、`next-types`、`next-ui-types`、`next-build`，不改 selector、安装依赖或机械扩邻接矩阵。这次没有新核心边，只在必要时使用现 `next-architecture` 检查。

交付六路径 SHA-256、精确新路由/类型、原 15 项结果、两条新测试首红及未达后段、Node/UI types 和构建结果，立即 STOP。主审短审契约与正常前态后冻结测试，再仅开放四生产实现；不自行进入第二阶段，不自行导入 main。实际浏览器点选会话、发信、历史、切换 scope/Session 与重开由主审完成。
