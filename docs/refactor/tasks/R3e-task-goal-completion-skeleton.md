# R3e.3 Task / Goal 正式完成：首批骨架与最终行为测试

状态：2026-09-26，派工准备已冻结，主审已创建五个必要占位并登记 next-completion，主审现从 Query 骨架与已验收 R3e.1 producer 合入后的 main prepare/派发。本文件不是实施完成声明。唯一写范围为 [13 路径 scope](R3e-task-goal-completion-skeleton-scope.json)：11 生产、2 测试；接口、依赖、DTO、局部 CAS 与正常链以 [R3e 主任务 §9](R3e-completion-skeleton.md#9-r3e3-首批派工冻结机械证据到正式-taskgoal-完成) 为准，§7/§7.1 保留正式完成及历史语义。不得借旧 §8 的 R3e.1 scope 扩大写权限。

## 准备条件与工作顺序

1. **必须等 root 导入 Query 骨架后，从当时 fresh main prepare。** 再核共享 `create-platform.ts`、任务查询与 contracts 的新快照及哈希，保留 Query 已有接线，不恢复较早 composition 副本。root 负责必要占位、检查 selector 注册与 lane 创建；本准备文档不执行这些操作。
2. R3e.1 五生产文件实现可与本批文档/骨架准备并行，其源码、接口、fixture、测试均只读。派工时先查看主审指定的真实实现快照，不复制其服务/fold/schema。本批最终正常前态须消费已验收导入的真实检查 producer；R3e.1 五生产文件（含 gateSubject 分支）已验收导入 main；直接消费真实 producer，禁止 seed PASS 或 catch unsupported 替代。
3. 保留用户两阶段流程：Astra 接口冻结→DSH 骨架/最终行为测试→STOP中审→另行授权实现→独审/整合隔离。阶段一不得提前实现完成受理、证据判断、事务或 codec。

先读 docs/AGENTS.md、当前 HANDOFF、IMPLEMENTED-CAPABILITIES 相关能力、CODE-QUALITY-GUIDELINES §2.1、DSH-EXECUTION-HARNESS，以及主任务 §7/§9。按 scope 原地写，不安装依赖，不改 docs、tools/check、Kernel、R3e.1 五文件或共享 helper；无授权文件遇真实类型缺口报告具体符号，不自行扩写。

## 阶段一产物与复用边界

- 按主任务 §9.2 声明同一 `GoalTaskPort.completeTask/completeGoal`、完整 WriteResult、依赖及审计 DTO；原 `createGoalService` 发布新增方法。新增完成入口明确返回 unsupported，createGoal 保持原行为；生产同一个 backend.records，不造第二服务/数据库或通用 manager。
- 保持原 TaskReductionSnapshot@1、所有必需字段和唯一 PLAN_STATE_RECORD_SCHEMAS 注册；completion 可选审计字段用于兼容旧记录，本批未来 writer 必填。GoalPhase 只声明首批正式 COMPLETED 最小快照，不迁入旧完整十态控制器。
- completion-policy 只给 §9.3 的完整纯函数签名与显式 stub；最终实现消费唯一 R3e evidence fold，不复制 applicability/reviewer/source 判定。新 encoders 显式抛 unsupported，decoders 返回明确未实现的 invalid，`COMPLETION_RECORD_SCHEMAS` 在骨架为空集合；不能伪造 decoded 或提前实现正式 validator。旧记录 reader/schema 仍可正常使用。
- 原 canonical reader 的新增 maps 来自本轮已解析 Run/Reduction；可完成不涉及新判断的返回结构接缝，不新增读取、归约或业务过滤。不要用空 map 冒充已读事实。GoalPhase 点读只发布 §9.3 签名和明确 stub；阶段一 queryTaskGraph 保留既有执行路径，新增可选 completion 尚不产出，不因未注册 GoalPhase schema 破坏普通查询。最终点读/投影接线留第二阶段。
- 新公开方法沿原 goals 的 trackedCall/close 路径装配；不发命令、不启动模型或后台 Promise。权限字段仍来自可信 CoreCallContext，模型输入不携带授权。required reviewer 未接时未来实现必须 incomplete；未要求 reviewer 的正常机械路径不新增前提。

**避免运行时循环：** `plan-readers.ts → completion-record-codecs.ts` 只调用独立的 GoalPhase decoder。后者只运行时依赖 fingerprint/纯结构 helper；Run、TaskReduction、GoalPhase、RecordStore 和结果 DTO 均用 `import type`。不得从 codecs 运行时反向 import plan-readers、completion、task-service 或 completion-policy；TaskReduction 编码不反向调用原 reader validator，原 schema owner 继续独立校验可选审计。`completion-policy` 对 CanonicalTaskFacts/CanonicalTaskState 仅 type-only 导入。这在既定文件内可完成，不为解环另建架构层或第二 codec/schema。

## 两组最终行为测试与 MVP 门槛

测试仅两个 scope 文件，复用现 R3e/B2 fixture 的真实公开初始化、Plan、claim、ended Run 与 additionalSchemas 能力；如需场景定制，写在这两文件内并调用既有 writer。不得 rawseed Evidence/PASS/TaskReduction、伪造 gate Run、改共享 fixture 或增加测试矩阵。

- `tests/work-graph/R3e-completion.test.ts`：主任务 §9.5 第一组。正式 begin/record/finalize 后 completeTask(work)，Goal gate 使用自身 subject 的独立 round/evidence，再 completeTask(gate)、completeGoal、queryTaskGraph。保留原请求/完整回执；沿公开 Plan 路径核 optional 未来意图仍显示，required plan_only/缺验收与 required reviewer 缺 producer 为 incomplete。没有为该政策要求 reviewer 时不阻塞正常完成。
- `tests/composition/R3e-completion-platform.test.ts`：主任务 §9.5 第二组。真实 SQLite、正式平台、真实 ProcessSandbox 注册检查→finalize→work 完成→`gateSubject:'goal'` 独立检查/证据→gate 完成→Goal 完成→图读取；gate 引用同 Goal 已 ended 的普通 producer，不 claim gate。复用真实正文/持久 Evidence，关闭重开读完成并重放原回执。未要求的 reviewer、Workflow 自动推进、Query/Host 全部产品能力不据此宣称完成。

**本批 MVP gate：**骨架职责/契约/复用不带偏；实现后上述正常公开端到端路径真实可跑；真实权限、正式事实和副作用边界正确。Stage1 测试断言最终行为，不能把合法请求 expected unsupported 写成永久通过；首个 completion unsupported 之后未到达的步骤如实标待实现。环境真实 sandbox 不可用时报告阻塞，不 fallback/skip 后称通过。必要前态及类型成立、目标首红诚实即可 STOP 中审，不为更漂亮覆盖追加返修轮次。

## 检查、交付与停止

建议主审登记 `next-completion`，精确入口仅上述两个测试文件；该 selector 已由主审登记，DSH 不自行改检查器。已存在 `next-evidence` 与 `next-plan` 可按本次实际变更影响选必要邻接，不能机械扩全仓/所有 fixture 矩阵。类型与模块边界检查沿现 `next-types`、`next-architecture`。root 登记后的真实可用命令再写入派发消息，本文件不声称已执行。

交付十三文件精确 hash、类型结果、实际运行的必要邻接、每组首红位置与未达后段，然后立即 STOP。主审仅解决架构带偏、正常链阻塞或真实边界错误，不因测试数量/排列组合增加轮次。通过中审再单独开放实现文件，测试转只读；完整隔离在整合后由主审组织。R3e.2 reviewer/witness、正式重开与高级恢复、Workflow/Host 完整消费者仍保留后续范围。
