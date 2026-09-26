# R6：Task 本次执行 → 原 Session / 原历史消费者骨架

2026-09-27 当前状态：六路径骨架已由根代理中审冻结并[精确导入](../reviews/evidence/next-b2-2026-09-26/r6-graph-history-consumer-skeleton-import.json)，后续两UI实现及辅助历史重复渲染窄修已[精确导入](../reviews/evidence/next-b2-2026-09-26/r6-graph-history-consumer-implementation-import.json)；[固定22项、Node/UI types和构建](../reviews/evidence/next-b2-2026-09-26/r6-graph-history-browser-repair-review.json)与[最终真实浏览器复验](../reviews/evidence/next-b2-2026-09-26/r6-graph-history-browser-final.json)通过，模型调用0。各Run原窗口、完整Session原历史、页签保留和独立分页已交付；全部attempt枚举未据此交付。本批不在124文件/1102项完整隔离副本内。按用户最新要求冻结保存，不派发Work-control/A1/R3g。下文保留本批已执行的契约与范围。

W=`/home/hyh001/projects/coding-platform`，T=`W/coding-platform/next`。读 docs/AGENTS.md、当前 HANDOFF/IMPLEMENTED-CAPABILITIES 的 R6/历史条目、DSH-WORKFLOW.md、DSH-EXECUTION-HARNESS.md，以及本任务列出的实际接口。正文路径相对 T。写范围只限[六路径 scope](R6-graph-history-consumer-skeleton-scope.json)：4 个原生产消费者 + 2 个原 R6 测试；没有新生产文件。Kernel、原 owner、composition/Host/server、资源/manifest、styles/index、其它测试均只读。

## 1. 本批唯一结果与事实归属

用户从实际 Task 节点详情打开**当前图投影已知的正式执行**，由该 Run 的正式 claim 定位 Session，读取该次执行的原始窗口，也可切到同 Session 的完整保存历史。默认摘要/折叠，主动展开完整保存原文，包括保存记录中的 reasoningContent/reasoning、工具原参/原结果、未知事件及原位置；只能展示原 source 数据，不生成解释冒充原文。archive Session 保持只读，不为读取重新激活。

当前真实生产链决定入口：Workflow 新建 Session 才写 initialLinks；复用 Session 的第二个 Task 直接 claim，claim 写 Run/Attempt/outbox/Session 等，不补 WorkLink。因此 `sessions.findSessions(target)` 不是所有任务执行的索引，不能用它代替 claim Session；本批不新增 WorkLink writer。

| 正式事实 | 已存在 owner | 当前消费者缺口 |
| --- | --- | --- |
| TaskRow.execution / currentAttempt | plans.queryTaskGraph，已有 tasks/query | Task详情目前只有原字段，没有执行导航 |
| TaskExecutionRecord 的 run/attempt/outbox/plan/session/lease/readThrough | `ExecutionReadPort.readExecution`，composition 的 executions.readExecution 已真实发布 | 缺精确 HTTP 读口与 UI 消费 |
| Run 的原 Session/Kernel/Turn 有界历史 | `RuntimeExecutionPort.readTaskExecutionHistory`，composition 已真实发布 | 缺精确 HTTP 读口和 Run 页签/分页 |
| SessionCard 与原 Session 历史 | sessions.readSession、runtime.readSessionHistory，已有 sessions/read、sessions/history | 复用现有读口；辅助历史页缺自身下一页，不能绑定 activeSession 的 cursor |
| 当前明确节点工作关联 | sessions.findSessions，已有 sessions/find | 原列表/详情可复用；目标分页须保留完整 target 与原过滤，不能借全 workspace 的下一页 |

正式读取即事实，不由 UI 重新授权、重算完成、调用 observeRun/reconcile、记录历史或触发模型。mutable session/lease 可能已经是后续执行的状态；原 claim Session 取 `outbox.claim.sessionRef`，不能拿 occupancy 或 lastExecutionRef 当本次归属。

## 2. 两条原样透传的 plain 路由

沿原 CoreRouteSuffix、CoreRouteBindings、CORE_ROUTE_SPECS、createPlatformCoreRouteBindings 和显式 switch；共享同一个现 Host/platform/context。

| 后缀 | owner | body |
| --- | --- | --- |
| executions/read | `platform.executions.readExecution(ctx,input)` | `{scope,input:RunRef}` |
| executions/history | `platform.runtime.readTaskExecutionHistory(ctx,input)` | `{scope,input:{runRef,afterCursor:null|string,limit:number}}` |

请求与响应直接由方法派生：`PlainBody<ExecutionReadPort['readExecution']>` / `RouteResponse<…>`，以及 RuntimeExecutionPort 的 readTaskExecutionHistory。第一条仅暴露现方法第二参数，不在本批加第三参数 options；RunRef 含 aggregateType/projectId/goalId/runId。第二条不要与原 readExecutionHistory 的 KernelExecutionIdentity 请求混用。

core-http-types.ts 引入/必要 re-export 既有 ExecutionReadPort、原 RunRef/TaskExecutionRecord/ExecutionHistoryPage 类型，避免与 Runtime startRun 的同名返回重复声明。CoreRoutePlatform 增 `executions:Pick<ExecutionReadPort,'readExecution'>`，runtime 的现 Pick 增 readTaskExecutionHistory。DTO 不复制领域结构，不引入通用 method 路由。readExecution 不开新 Store；readTaskExecutionHistory 继续沿原 graph reader → 原执行历史 reader → Session reader。

plain HTTP 返回完整原 ReadResult，不把 rejected/not_ready/not_found 变成空成功。缺 locator 的 unsupported 表示尚未索引，不等于从未执行。readThrough/basis/recordId/source.position/nextCursor 原样保留。

## 3. 最小 UI 契约

### 3.1 Task 已知执行的入口与页签

Task 详情共享 renderer 的输入仍是真实 TaskRow。可声明一个窄纯显示函数 `renderTaskExecutionEntry(row:TaskRow):string`：有 execution 时给“查看本次执行/原历史”入口并携带完整 RunRef；无 execution 时如实显示当前图没有可打开的执行引用，未来 Task 不伪造时间或 Session。Phase1 此新增渲染接缝可明确 unsupported，Phase2 才形成最终入口。

沿现 WorkbenchTab 联合体添加一个最窄 `execution_history` 成员，携完整 RunRef，以及可选的原 TaskTriple 用于返回；不要从标题/tabId/当前选择解析对象。Session history 成员继续携完整 SessionRef。页签去重以 scope + 完整对象身份为准；Task 详情原 tabId 仅 taskId 的跨 Goal 合并须在本次触及导航时改成完整身份。

打开动作在 await 前捕获原 scope、conversation/layout、Task/Run/Session 和目标页签。先读 executions/read，只有 ready 才使用原 `outbox.claim.sessionRef` 展示/打开原 Session；read失败如实展示，不能用当前活跃 Session 兜底。读取本次原历史使用 executions/history 的同一 RunRef；读取完整 Session 使用原 sessions/read + sessions/history。两者明确标为“本次执行原历史”和“完整会话原历史”，不叫“所有 Task 历史”。

### 3.2 原 cursor、已保存原文与结果归属

- Run 窗口的 owner 已固定 start/upper 与 Kernel身份。UI 只沿返回 nextCursor 续页，limit 是扫描数，不是匹配条数；items 空而 nextCursor 非空仍可继续。刷新发新头部请求，不修改旧 cursor 含义。
- 结果和分页状态绑定 scope + RunRef/SessionRef/页签，不能只共享一份不带归属的 sessionHistory。可沿原 ScopeState 以精确 key 保存读结果；这是页面状态，不是第二个领域索引。
- 复用现 renderSessionHistoryTimeline / renderSessionHistory 的保存原文展示与文本转义。ExecutionHistoryPage 兼容 Page<SessionHistoryEntry>，无需重解析或复制匹配算法。保留原记录顺序；整 Session 的其它轮次不能归给当前 Task，不能把并行事件排序成虚构因果。
- 辅助 history/session_chat 页补自身 next 操作，cursor 取该页保存结果；中心原路径保持。关联列表可沿现 select/open/read 动作直接打开原 Session/历史；若补目标下一页，原请求必须保留完整 target、includeArchived、role（若有）及原 sourceCursor，不能调用当前非target buildSessionFindRequest(true)。
- 同对象刷新得到 rejected/not_ready/not_found 时保存并展示这一次原结果；不保留旧成功正文冒充新结果。迟到响应归原对象/页签。当前归档筛选改变时目标结果清为未读或按新筛选重查，不能改标签而复用旧列表。
- 原材料引用若没有正文仍显示未读取；本批不展开通用 Artifact 浏览，不把 ref 字符串冒充正文。普通 Session 的 Kernel history 已提供完整文本，直接消费。

不重做三栏、图排版、文件/草稿、消息、布局 CSS；不加卡片墙或常驻技术字段。Module/当前关联入口继续使用原 WorkLinkTarget。不同架构 revision 的完整详情来源保留属于已知邻接接缝，本批不扩包含树/依赖图展示算法；若不触及 Module 详情，不顺带改其版本处理。

## 4. Stage1 范围与 STOP

本批新增的是消费者，不是新领域算法：

1. 两 HTTP 类型、路由表、原 owner 绑定可直接真实透传，保持旧所有路由可用；不为了制造首红把已存在 owner 改成 unsupported，不重写任何 reader。
2. views/main 声明最小 execution_history 页签目标、结果状态和新入口接缝。新增显示/页面消费尚未实现处明确 unsupported；不得在骨架预先写完点击→请求→分页全部算法，或用假 ready/空历史蒙混。
3. 扩展原两测试中的既有正常链，不增加 it/backend/重启/并发矩阵。HTTP 两新透传读口可在同一真实已完成链上为绿；新增 UI 入口最终断言应在明确 unsupported 处首红，后继动作未达如实写明。
4. 提交六文件 hash、diff、固定检查和 scope 审计后 STOP。主审冻结接口/测试后，再按实际剩余消费者实现范围派 Stage2。预计算法只需 ui/main.ts、ui/views.ts；若路由需修仅限原四生产范围，不改 owner。

## 5. 原两测试的最小正常断言

### R6-host.test.ts：扩展现 execution entry 正常链

在原 JSON→Host/SQLite/Kernel→Query answer→初始 Plan→两个 work→checks/gate→Goal COMPLETED 的同一个 it 内，紧接已有 tasks/query 正式完成结果增加：

- 从返回的 TaskGraph 两个真实 work row 取得各自非空 execution RunRef。HTTP executions/read 返回 ready；核它的原 claim Task/Run 身份与所请求行一致，两个 work 的 claim Session 相同且 Run 不同。
- 以**第二个 work**的 RunRef 调 executions/history，使用较小原合法 limit 取得 nextCursor 并沿同请求对象继续，保存返回 recordId/source.position。核第二项真实脚本输出的原 assistant/event 记录出现在该执行窗，第一项的原输出记录不被混入；按原 recordId 与正式记录类型/字段判断，不用任意 JSON 全文 contains 排除输入上下文合法引用的旧内容。不要种 locator/terminal 或直接 append Kernel 记录。
- 同一个 claim Session 调已有 sessions/history，沿原 cursor 读取足够的原保存页，能找到两次 work 的实际记录，次序/标识来自原数据。证明完整 Session 与当前执行窗不同，不靠当前 Session WorkLink 推断。
- 只读前后受控 provider 调用数不变；不新建 Session/Run、不刷新预算、不再执行一次 Workflow。复用原 source/storage 分离和受控 provider。

只沿这个已通过的正常链补读取断言，不复制另一个 HTTP fixture；原重放/同库读取断言保留，不扩更多重启场景。不要用原 R4c 手工写 Kernel 事件的 fixture 替换本链真实执行。

### R6-workbench.test.ts：扩展现原历史/Task 结构显示组

沿现 `projects real original history in order...` 的同一个 it、已有 typed TaskRow/history fixture：给 TaskRow 真实形状的完整 execution RunRef，调用新增 renderTaskExecutionEntry 并断言入口携完整 project/goal/run 身份；阶段一在 unsupported 显示处首红。无 execution 的既有未来节点仍保留、不伪造执行历史。以原 reducer 保存 typed execution_history / Session history 页签，不能从标题取身份；继续沿本组现有默认折叠完整原文/原序断言，不新增 raw 字段矩阵。

已有 UI 闭包、Session/mailbox、scope/draft 和原始历史断言不删不放宽。页面实际 fetch/切tab/第二 Task 导航由主审在最终真实浏览器中沿同一链验证，不引入 DOM 框架或其它自动化系统。

## 6. 固定检查与精确前置

派发前：R6 execution 六生产实现最终独审导入；复核最终 core-http-types/core-routes/main/views 与两测试，没有同写；从 fresh main 取 originalAllowedHashes，不复制旧 lane，不改旧 manifest 消除漂移。上述前置已于 2026-09-27 实际完成，根代理已授权本批 fresh prepare／新会话派发；不得复制旧 lane 或提前进入第二阶段。

沿既有 `next-r6-host`、`next-types`、`next-ui-types`、`next-build`、必要 `next-architecture`/import scope audit。Stage1 旧检查保持通过，新增 UI 接缝允许准确首红；不跑全平台或加测试矩阵，不追求局部完备度。Stage2 原固定集合通过后按 exact scope 导入，主审一次真实浏览器检查上述路径。

以下均保持明确余项，不以本批通过宣称交付：完整 Task 历次尝试枚举；明确关闭 WorkLink 后的定向发现（已有 A1 草案，尚未派）；Module 版本详情完整上下文、containment新展示与完整时间放大镜。includeArchived 只表示 Session 生命周期，不代替 includeEndedLinks；不能扫整个 workspace 或 Kernel 历史来补这些缺口。

施工约束：沿原 headless profile／approval，不读取真实凭据或改权限。内层写入使用正常 `workspace-write` 最窄档位与 Python/Node 原地写已批准现有文件，不用原子 rename、不请求 danger-full-access。原完成 SQLite fixture `/tmp/coding-platform-r6-execution-review-NJz7aU` 保留供后续浏览器只读重开，本批骨架不运行或改动该 fixture。已修 Query 流程、回答默认折叠与 TaskGraph.completion 显示保持。

## 骨架中审必要纠正（2026-09-27）

初次 STOP 自检为 21/22 通过、唯一入口 open 对 unsupported 首红，HTTP 两真实读取路由链已通过。独审发现额外测试把 ready 历史页渲染成“尚未实现”写为永久期望，故仅删除这一多余占位断言／fixture（保留原同组完整身份及最终入口首红），并补齐 WorkbenchTabKind 的 execution_history 成员；不增加测试组或实现算法。之后独立固定检查，待根代理冻结，不自行导入。

## 独立中审候选（2026-09-27）

[六文件最终证据](../reviews/evidence/next-b2-2026-09-26/r6-graph-history-consumer-skeleton-review.json) 包含实际 STOP hash／主工作区基线、逐文件增减、独立固定日志及 scope audit。两 HTTP reader 正常链绿；原 22 项中 21 通过，唯一红为原历史组最后 `data-execution-entry="open"` 对当前 unsupported。Node/UI types、build、architecture 通过。候选未导入、第二阶段未派发。

后续实现预期只 `ui/main.ts`／`ui/views.ts`；根主审要求在本触点将中心与辅助页的 Session history 请求统一复用一个按捕获原 Session／cursor 组装的 builder，收敛现 `buildSessionHistoryRequest` 与 For 版本重复，不扩模块或测试。
