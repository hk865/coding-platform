# 下一批主审任务：R3c 任务关系与候选资格纠偏

状态：本页限定批次已于2026-09-24通过[独立验收](../reviews/next-r3c-relations-2026-09-24.md)；保留任务与冻结判据用于追溯，不表示整个R3c已完成。交给负责设计、DSH 分阶段调度和验收的主 Agent；不要整份直接交 DSH 自由实现。

## 任务

在 `/home/hyh001/projects/coding-platform/coding-platform/next` 完成任务关系和候选资格的最小修正，为后续 R4c 正式受理/执行接线提供正确契约。沿用五模块/八条允许依赖，不重新拆项目，不重做 Prompt 5。

产品意图：任务图是协作白板、状态和历史/证据索引。模型结合规范、架构及实际事实决定分工与并行。预期依赖、结构影响不是启动禁令；明确采用的具体输入需求应在需要消费时核验，不等于等待提供方整个 Task 完成。权限、数据版本、幂等和同 Session 一致性仍保留。

本批闭合的最小路径：明确表达关系/输入需求 → 保存并读回适用版本 → 候选查询返回真实任务状态、关系提示和可核对的输入状态；把已能通过真实材料读取验证的输入接到现有读路径。未实现的需求种类明确无法核验，不能用默认值或测试替身伪装生产能力。不要借此提前实现完整 TaskClaim/QueryClaim/执行驱动。

## 阅读顺序：引用既有真源，不另造全局施工文档

令 W=`/home/hyh001/projects/coding-platform`，T=`W/coding-platform/next`，N=`W/docs/refactor`；以下相对路径据此展开。

1. `W/docs/AGENTS.md`、`W/coding-platform/AGENTS.md`、`N/HANDOFF.md`。
2. `W/docs/PRODUCT.md` §3、§5.2；`N/ARCHITECTURE.md` §3、§6.1；`N/intent/2026-09-23-PARALLEL-AND-PRODUCT.md` §4–5。需要原意时按相关段查 `N/intent/ORIGINAL-DIALOGUE.md`，不全量重装聊天。
3. `N/reviews/task-graph-orchestration-intent-2026-09-24.md`、`N/modules/core/work-graph.md` §4.0、§5、`N/PARALLEL-COLLABORATION.md` §1.2–1.3、§3。旧 scope/reservation 必填代码块已经标为撤回草案，不得照抄。
4. `T/src/contracts/plan.ts`、`T/src/contracts/dispatch.ts`，`T/src/core/work-graph/tasks/{plan-contracts,plan-service,plan-readers,plan-record-codecs,plan-validation,eligibility,task-index}.ts`；按需查看已有材料精确读取、授权、来源和正式记录引用。
5. `T/tests/work-graph/R3c-*.test.ts`，尤其 canonical-task-state / task-graph / plan-adoption；参考最新 `N/reviews/next-r4c-continuity-2026-09-24.md`。前序报告为54文件/376项通过，不等于本次改动已验收。
6. `N/DSH-WORKFLOW.md` §3、`N/DSH-EXECUTION-HARNESS.md`、`W/tools/dsh-refactor/{harness,check}.py`。

## 主审先冻结必要语义

先检查真实调用链和测试，修改既有模块/契约文档中的相关定义，然后安排骨架与实现（最新两阶段分工见 DSH-EXECUTION-HARNESS，骨架测试完成后必须先审核）：

- 分开白板提示关系、明确输入消费要求和实际执行状态；不要让一个 eligibility boolean 同时代表“可作为工作候选”“具体输入已可用”“获准执行”。复用已有 DTO/记录；仅为本批真实消费者补最小字段和操作，不建立新的图系统或万能依赖 DSL。
- 当前 executionDag.dependsOn 明确为 hard edge，但 requires 只有 kind/label；不得把 label、生产 Task 的 satisfied、文件名相同或 Agent 声称存在，当精确输入已验证。复用已有版本化引用和真实 provider，不新增第二套事实库。输入是否存在、当前是否获准读取、版本/适用条件是否满足分别说明。
- 普通图/候选查询只返回已有事实和缺口，不为证明未来安全调用模型、重捕全仓或扫描全部历史。输入核验只覆盖调用方本次明确请求的要求，或复用当前查询已取得且仍适用的事实；未请求/未执行的核验标为“未核验”（如局部字段 not_checked），与已核验的缺失、失败、未知区分。不得每次展示任务图就逐节点打开全部材料；不为此给通用 ReadResult 再造一套并行错误系统。缺失输入不自动拒绝整项工作的调查/独立部分；真正消费该输入时不能伪称可用。
- 保留 Plan/Run/TaskLease/TaskReduction 的 canonical 读取。缺 provider、schema、读取失败或混合水位不能退化成 pending/free。此次取消的是不当的前驱整体完成门槛，不是删除所有状态/授权检查。
- 已接受的旧 Plan 保持可读、不静默重写；旧 requires label 明确为无法精确核验的历史要求，不能自动升级为满足，也不能直接丢掉。若持久结构需变化，冻结最小版本演进及旧数据读取行为，测试其幂等与重启。
- 查询中的候选过滤和解释必须共用规则，清理 plan-service 内与 eligibility 重复的前驱整体完成过滤。返回解释应让 Agent 看懂依据和未知，不凭字符串解析推导权限。

## 实施工序与范围

1. 主审先给出精确接口/状态含义、实际事实来源、旧数据处置和文件清单；这是工程细化，不新增同义用户审批。确有无法由现有意图决定的产品取舍时才提出具体问题，同时继续独立部分。
2. DSH 4.1F 第一阶段按冻结接口建立骨架与行为测试并停止；Astra审核正例、反例及红测原因后冻结，才允许第二阶段实现。已交付Sol骨架/测试保留复用。测试要验证产品意图，不能沿旧错误门槛继续加固。
3. 主审再以既有 harness 启动实际本地 DSH，只准写本批冻结的生产文件，tests/公共接口/Kernel只读。既有文档给完整阅读上下文，scope给精确写范围。先完成共享契约，再按真实文件冲突划分可并行 lane；无独立写面时不强行拆 Agent。不把运行时并发策略与开发期写文件隔离混为一谈。
4. DSH 负责填骨架和删除被替代的重复判断；遇到测试/接口矛盾向主审给具体反例，不自行改测试或扩大范围。返修复用同一 DSH Session。
5. 主审独立审阅差异、校验 scope 和原目录保护，运行针对性测试、类型/边界与必要持久化集成，再做最终物理隔离验证并更新既有 HANDOFF/refactor-plan/验收记录。

候选写面限于 T 的 Plan/Task 契约、对应 codec/规则/服务及必要测试与装配；由主审列最终文件白名单，不能给整个 src 写权限。原 `coding-platform/src`、旧 tests、Kernel 源码和冻结 vendor 只读；不安装依赖，不 reset/restore/clean/stash，不自动 stage/commit/push。必要新增内部文件须有实际调用方，禁止保留新旧两套资格算法。

## 最低行为验收

### 2026-09-24 主审冻结补充

本批采用 WorkGraph 模块页 §4.1：Plan 内容版本 1/2 双读，新增白板关系与精确 artifact 需求；不再增加 check/consume 两个同义操作，仅提供 `readTaskInput(ctx,{goalRef,planRef,taskId,requirementId})`，经已接受计划选择要求后调用现有 current material reader。本批已经生成的Sol类型/测试复用；DSH第一阶段补齐骨架测试，Astra审核后统一冻结；真实组合根由主审注入 materials。普通图/候选不读材料；旧 label 明确无法精确核验。现有 Host current 材料读取限制原样报告，不扩大材料授权范围。当前可执行正例由真实持久 Run/Grant/来源事实验证，不宣称完整 R4c 驱动已经接通。

以下行为验收仍有效：

- A 仍 running，但 B 所需的确切版本材料已通过真实 reader 可用：不能仅因 A 未 satisfied 把 B 排除；不等于自动获得执行权限。
- A 已 satisfied，但指定输入缺失、版本不符或已撤回：不得报告该输入可用；无关调查仍可显示为候选。
- 只有预期依赖/结构相关/文件范围可能重合：保留提示，不机械阻塞，不调用模型追加证明。
- 图/候选查询显示 unknown；材料真正消费时拒绝不存在、无权或无法验证的输入，不能用“解除启动门槛”绕过实际读取边界。
- canonical Run/Lease/Reduction 缺失、错误或 stale 仍按现有完整性语义处理，不回到默认 pending/free。
- 旧 Plan 可读且不被静默改写；新关系/需求正确保存、读回、重放和重启，Memory/SQLite 行为一致。
- queryTaskGraph 与 queryReadyTasks 对同一事实、同一核验范围的关系/输入解释一致；未请求核验不读全部材料、不伪报缺失；代码不再保留第二处独立前驱整体完成过滤。
- 记录本批路径的 capture/模型调用次数；普通候选查询不得新增捕获或模型调用。无需为此新增监测平台或大型 benchmark。

实际检查使用已有 Node24/T的项目命令；若固定检查入口缺本批测试，由主审更新 check.py 后冻结，不让 DSH 任意改 runner。不要把测试用假 provider 通过写成生产事实链已接通。

## 这轮不扩张到的能力及随后方向

不实现完整 R4c 执行驱动、通用资源锁/ConflictGraph、跨 worktree 合并、changedSymbols 或新持久 ChangeSet 仓。R4p 随后独立推进共同基线与实际文件比较，复用现有 Workspace diff、observed compare/queryImpact：同文件双改只代表 overlap；CAS版本不符与文本合并冲突分别表达；没有观测到关系不等于无影响，跳过分析标明未分析。不要把这个后续批次设为所有 R4c 工作的前置。

最终报告说明：实现了哪些用户行为、哪些具体入口接通、删除了什么重复判断、实测结果、代码量变化与剩余 R3/R4 事项。只对真实交付闭环标完成；不把新 DTO 或测试通过当完整产品已交付。
