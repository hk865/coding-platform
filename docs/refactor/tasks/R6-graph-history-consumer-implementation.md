# R6：Task 本次执行到原 Session / 原历史消费者实现

2026-09-27 当前状态：第一阶段六路径已冻结导入；两UI实现及辅助历史重复渲染窄修已[精确导入](../reviews/evidence/next-b2-2026-09-26/r6-graph-history-consumer-implementation-import.json)；[固定22项、Node/UI types和构建](../reviews/evidence/next-b2-2026-09-26/r6-graph-history-browser-repair-review.json)与[最终真实浏览器复验](../reviews/evidence/next-b2-2026-09-26/r6-graph-history-browser-final.json)通过，模型调用0。各Run原窗口、完整Session原历史、页签保留和独立分页已交付；全部attempt枚举未据此交付。本批不在124文件/1102项完整隔离副本内。按用户最新要求冻结保存，不派发Work-control/A1/R3g。下文保留本批已执行的契约与范围。

依据与产品范围完全沿 [已批准骨架](R6-graph-history-consumer-skeleton.md) §1–6；本任务只实施其剩余页面消费者。范围仅 [两文件 scope](R6-graph-history-consumer-implementation-scope.json)：`src/ui/main.ts`、`src/ui/views.ts`。HTTP 两读路由、所有领域 owner、Host/composition、Kernel、样式/资源、测试均冻结只读。四生产骨架中的 HTTP 已真实透传，不再包装一层历史服务。

## 1. 已知 Run 的真实导航

沿真实 TaskRow.execution 实现 renderTaskExecutionEntry 的正式按钮。首个 await 前捕获原 scope、完整 Task/Run、发起的 conversation/layout 与 typed tab；Task 页签去重包含 project/goal/task，Run 页签包含 scope/完整 RunRef。不要从 tabId/标题反推身份，不用当前 activeSession 或 WorkLink 代替执行归属。

点击打开本次执行页后，调用 executions/read 得到原 TaskExecutionRecord，只有 ready 才消费原 outbox.claim.sessionRef；将原 Run/Task 与 Session 的关联用于精确打开 Session/完整历史。失败、未索引、未找到均保留原结果，不能静默选择其它 Session。读口没有新模型、observe、reconcile、授权或完成写入。

本次历史直接调用 executions/history 的 `{runRef,afterCursor,limit}`。默认摘要/折叠，完整原文沿既有 renderSessionHistoryTimeline/renderSessionHistory 及转义显示，主动展开时保留所有实际保存的字段、原事件顺序与 source 位置。不得把同 Session 的前一次工作输出归入本 Run。

## 2. 页面状态与原分页

执行事实、Run 历史和 Session 历史均保存完整对象身份；捕获请求所属的 scope/layout/tab，迟到结果写回原对象。可在原 ScopeState 用精确 key 的 map 保存有限用户打开页面的读取结果，不建立持久索引、通用资源缓存或第二历史库。沿原返回 nextCursor 续页，空 items 但非空 nextCursor 仍可继续；刷新回原头部，不自行拼造或修正 cursor。

Session 的 history/session_chat 辅助页补自己对象的读取/下一页，不能依赖当前中间栏 activeSession 的 cursor。现 buildSessionHistoryRequest / buildSessionHistoryRequestFor 的重复装配在本触点统一复用一个显式接收 scope/Session/原页的 builder；中心原路径保持。不要把全历史内容默认全量展开。

同对象新读取 rejected/not_ready/not_found 要展示本次原结果；不能让旧 ready 正文冒充新结果。每页只呈现请求所属 Session/Run 的数据；归档 Session 只读，不能为查看自动恢复或发送消息。

## 3. 原关联列表消费者

复用 sessions.findSessions 的完整 target、includeArchived 与原 cursor。目标下一页保持原过滤与目标，不能借工作区目录的 cursor/request。关联 Session 可直接打开原 Session/历史；归档筛选变化时旧目标结果标未读或按新筛选重新读，不能只换标签继续显示旧列表。已知执行通过 claim 导航与显式 WorkLink 关联是两类现有事实，页面不据任意一个补造另一个。

本批不扩 all-attempt 枚举、endedWorkLink writer/reader、Module 版本/包含树新展示、时间放大镜、控制恢复、文件保存或其它产品能力。保持前批 Query/Plan/Workflow 正常入口、完整回答默认收起及 TaskGraph.completion 显示。

## 4. 固定检查与停止点

使用既有 next-r6-host（原两文件/22项）、next-types、next-ui-types、next-build；不加新 it、重启/竞争矩阵或 DOM 框架。原单一真实 HTTP 正常链已验证第二 Run 窗口与同 Session 两次输出的区分及读取不调用模型；实现使原唯一入口首红变绿即可。最终 scope 审计只允许两生产改变，冻结测试逐字不变。

提交两文件 hash、diff、固定检查和 scope 审计后 STOP，不导入、不派下批。根代理独立审阅后，用保留的已完成真实 SQLite fixture `/tmp/coding-platform-r6-execution-review-NJz7aU` 只读重开做浏览器导航验收；不为每个 UI 读取再跑一次模型/Workflow。实际发现的问题只修原正常路径，不把完善测试当成后续施工目标。

## 首轮 STOP 后原消费者窄修（2026-09-27）

首轮 DSH 自检原 22／类型／构建通过，但独立源码中审发现同一 ScopeState 仍用单槽存多页历史，以及 await 后自动 selectSession 抢回用户选择，尚未满足本任务 §1–3。根代理批准同一会话仅两 UI 一轮纠正：结果与 cursor 按捕获原 layout/tab／完整对象保存；Run 页固定在发起 layout，claim 只提供显式导航；关联读取失败替换旧 ready，旧筛选在途结果不以新条件显示；默认技术字段放原 details。统一 Session history builder 保留，不增测试矩阵或其它范围。最终字节再做一次独立固定检查，仍不自行导入。

## 最终候选独审（2026-09-27）

同会话一轮窄修已 STOP，最终两生产独审通过：原 22 项、Node 类型、UI 类型及保留物理构建均 exit 0；scope 审计仅两 UI 改变、越界与主工作区改动均为空，原冻结测试逐字不变。原页面／对象结果与分页、显式 claim Session 导航、关联目标筛选和技术原文折叠均沿原消费者实现。证据见 [最终独审](../reviews/evidence/next-b2-2026-09-26/r6-graph-history-consumer-implementation-review.json)。候选尚待根代理用原已完成 SQLite 只读浏览器验收并精确导入，本审未运行模型、未触碰 fixture、未自行导入。

## 浏览器重复渲染窄修（2026-09-27）

根代理实际只读导航已通过 Task→两 Run→原 Session、完整历史 1–10／11 与独立页签保留，发现辅助 history 页同一批记录渲染两遍：`renderHistoryTab` 同时调用 timeline 与另一个完整列表。原会话仅删除后者与死 import，保留原 timeline 全字段展开；无新测试或算法变化。此前最终候选尚未导入，本次新最终字节须以追加修复证据为准。

浏览器窄修最终 STOP 后独审确认只有上述调用与死 import 删除，`views.ts` 未变；原 22 项、Node/UI 类型与新保留物理构建均通过，冻结测试及 scope 审计通过。最后字节、检查日志与新构建路径以 [浏览器修复独审](../reviews/evidence/next-b2-2026-09-26/r6-graph-history-browser-repair-review.json) 为准，前一轮 review 保留作历史证据。待根代理对重复显示做窄复验并导入。
