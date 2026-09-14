# 协议结构校验

调用方直接导入对应协议入口。这里校验输入结构并返回问题；Control 的权限、计划、Evidence 资格和正式状态政策仍在 ControlEngine，StateLedger 的原子提交校验仍在 StateLedger。没有汇总 barrel。

| 入口 | 负责的形状 |
| --- | --- |
| [common.ts](common.ts) | 公共 ValidationIssue/问题文本，以及校验器内部共用的结构原语 |
| [identity.ts](identity.ts) | actor、命令身份 |
| [goal.ts](goal.ts)、[bootstrap.ts](bootstrap.ts)、[event.ts](event.ts) | 建 Goal、启动条目、持久事件与查询 |
| [governance.ts](governance.ts)、[role.ts](role.ts) | 治理内容/pin/安装激活、角色规格/矩阵 |
| [plan.ts](plan.ts) | 计划草稿、任务图与 ApplyPlanRevision |
| [dispatch.ts](dispatch.ts) | 派发、运行事实、TaskEnvelope、运行事件与 Task Context 请求 |
| [evidence.ts](evidence.ts) | Evidence 来源/覆盖/提交与归约请求 |
| [context.ts](context.ts)、[material-access.ts](material-access.ts) | 工作接续、执行记录和精确材料授权 |
| [handoff.ts](handoff.ts) | 换手材料、替换、控制与快照查询 |
| [workspace.ts](workspace.ts)、[integration.ts](integration.ts) | 工作区读写租约、集成结果与补丁 |
| [architecture.ts](architecture.ts) | 检查意图、Finding、Brief 与候选基线 |

同一字段的原校验函数保持唯一实现。少量跨协议原语需要源码导出以复用，这些不是新增业务端口；不要把它们当作准入或授权政策。字符串数组等校验看似相近，但返回形状、错误路径和允许值不同，不能仅为去重而统一。原有 fixture 内容校验仍供真实消费者使用，本轮没有改变样例加载路径。

持久字段、拒绝码及错误消息保持兼容，包括个别含历史编号的既有运行期字符串。历史施工标题和迁移前原文保存在 [本轮证据](../../../evidence/2026-09-11-source-cleanup/contracts-followup/verification.md)。
