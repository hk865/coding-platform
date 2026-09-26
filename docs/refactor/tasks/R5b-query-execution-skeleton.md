# R5b.2 Query 单轮真实回答：骨架与最终消费者测试

> 用户现要求新建 DSH 会话接手。旧会话因传输中断未交付；已确认并修复沙箱遮住系统 DNS 文件的问题。沿当前 lane 已落盘源码继续，不重新 prepare、不覆盖已有成果。先核当前文件与本任务必要接口，然后直接完成剩余施工，不重做全仓调查；仍严格保持本任务阶段、写范围、冻结测试和 STOP 边界。旧 Session 与 attempts 继续保留。

状态：2026-09-26，主审已冻结 §10 协议及 17 生产＋2 测试 scope；6 个新文件占位及 next-query-execution selector 已就绪。Workflow 骨架已串行导入共享 composition，现授权从最新 main 创建阶段一 lane 并执行，完成后 STOP 中审。唯一协议真源为 [R5b 主任务 §10](R5b-query-planning-skeleton.md#10-r5b2-下一批精确候选query-session--kernel--正式回答) 与 [scope JSON](R5b-query-execution-skeleton-scope.json)。

## 第一阶段只做什么

只发布主任务具体 DTO、QueryExecutionPort 与真实依赖装配、QueryJob claim/answer 入口、同 Runtime prepareQuery/startQuery/observeQuery、唯一 QueryRun schema 的兼容扩展和 Query Answer/操作事件 schema。新算法入口显式 unsupported；未注入 Query Host/deps 时只有 Query 新方法 unsupported，现 pending submit/read、Work Runtime/Source、Session、材料、R3e/R4 等入口保持原行为。纯 codec/schema 可以完成可编译编码接缝，不能先做 claim/占用/entry/model admit/terminal 推进或来源批准来让新测试提前变绿。

组合根创建同 records 的一个 QueryExecutionPort，注入 QueryJob service 与 Runtime；该内部 writer 不发布为 platform 公共 terminal 接口。原 QueryRunSnapshot@1 注册仍归 materials/record-readers，queries 只复用其窄导出；不得另注册 QueryRun、另开 SQLite、使用旧 Journal/Query manager、发明第二模型 loop 或把 QueryRun cast 成 Work Run。原 Query submission locator 的精确 reader 只接声明/stub，已实现 Work source 读取不退回 stub；真正新来源读取算法留实现阶段。

首 await 前隔离输入及真实 ctx/signal。claim 一次绑定 Session 稳定 Role pin，并复用原 Role facts 与局部 guards；fresh begin/model admit 核实际 Host、匹配 occupancy/generation 与固定输入，不增加 Role 热切换或每次重新批准整张 Goal/Plan/治理图。prepared/entered/usage/unknown/settled 均为同 QueryRun 的状态，不新增 Task、TaskAttempt、Lease、Plan、CompletionPolicy 或占位 baseline。

新四生产文件分别只承担 Query 领域 writer、有限输入准备、唯一 runObservedModel 薄驱动、原历史观察。既有 ModelCallAccess、ModelBudget、SessionHistoryCursorOwner、Kernel reducer/完整交换检查和源码工具 owner 全部只读复用；不能复制其实现或顺便改 Kernel/build。骨架导出对应工厂/接口，函数返回明确 unsupported，不构造假成功值。

## 两条真实最终验收链（只用两文件，不加矩阵）

1. `tests/work-graph/R5b-query-execution.test.ts`：同一个真实 records/body/Session backend，经公开 bootstrap 建 Project/Workspace/Goal（无 Plan/Policy/baseline），submit initial_coordination，正式 createSession，再 claim→prepare→start→正式 readQueryJob/readQueryAnswer。核 pending 原回执仍为原 pending pair、claim 使用原 Session occupancy、输入含真实 Goal/原 actor、最后 Answer/Job/Run 与匹配 generation 释放同一事务；原提交/entry 重放不再执行。观察事实必须来自本次真实 Kernel，不能直接调用内部 terminal writer 注入成功 JSON；若采用现公共 fixture，只复用其真实 backend/Host/provider 组件，不能偷偷借用其已执行 Work Run 或 seed Query 状态。
2. `tests/runtime/R5b-query-session-loop.test.ts`：真实 SQLite+原 Kernel+受控 ScriptedProvider，公开无 Plan 链进入后模型实际调用 `project_source`，至少正常 capture/query 或精确 read 一次再回答；验证后续 provider 真看到工具正文、正式 answer 正文/bodyRef/真实 source witness、原 Session 本轮历史、多个 provider request 仍同一个 QueryRun/Turn 和累计 meter。重复 start/observe 和关重开后的读回不新增 Turn/provider。Host 只读 grant 与 Skill 取真实可信配置，正常流程中的权限断言检查没有 shell/edit/通信/白板写工具即可，不新增权限交叉矩阵。

可将相邻步骤归在各文件的一条完整链中；只补链路必需断言，不新增异常、Role 切换、直接持久记录篡改或 Store 通用矩阵。prepare manifest 使用自己 QueryRun owner，答案使用原 Query initiator 的 query_run ctx 与实际 Material execution origin，不给 Host 冒充 execution origin。工具/source 结果必须取真实形状，版本不将 immutable Plan row.revision 当 planRevision。资源 finally 门闩有界并确保清理；骨架入口第一次 unsupported 后未执行的后半段要明确报告为未到达，不声称通过。

## 精确 scope 与原有消费者

17 生产路径完全沿主任务 §10.6；新增生产仅 `work-graph/queries/query-execution.ts`、`agent-runtime/query-preparation.ts`、`agent-runtime/query-execution.ts`、`agent-runtime/query-observation.ts` 四个。新增测试两个，**共 6 个待创建文件、13 个既有文件**。共享 fixture、Work driver/observer/model-call-access、ModelBudget、observed-model-run、Session owner、Kernel/dist、材料 grant writer、所有其余测试与 scripts 均只读。接口如果不能在该 scope 表达，报精确符号/调用阻断给主审，不静默扩大文件。

17 文件范围足以容纳已核接缝：QueryExecutionPort 的 current read 与 preparation facts；精确 Role/Host 配置投影；原 meter persist 与 ModelCallAccess.beforeCall；raw body owner 校验；原 Session 历史 owner 的分页；SourceSnapshotReads 可选 exact submission 方法及 Query 工厂窄兼容类型；createTargetPlatform 同实例 trackedCall/close。不会创建外部材料 grant、Query 冷恢复、多轮、高级控制、answer→Plan candidate/采用或 Workflow 调度；这些原产品后续仍保留，不以本批正常回答替代。

## 检查、交付与 STOP

主审准备时可在 scope 外的 harness 登记固定 selector `next-query-execution`，仅映射上述两个测试；DSH 不改 check.py。准备前若尚未登记，用仓库既有 Vitest 运行这两路径，语义完全相同。阶段一只运行目标、`next-types` 及原 `next-query-job` 最小邻接；不重复全矩阵、Kernel 重建或 E2E 外的新增用例。目标应在新明确 unsupported 处红，types 与旧 pending 入口应绿。

交付 19 文件实际 hash、scope outside 清单、上述检查结果及每条链的首红/未达步骤，随后 **STOP 等主审中审**。不得自行进入阶段二；主审冻结后另派同 lane 的实现任务，最终由真实正常 Query 回答链验收。
