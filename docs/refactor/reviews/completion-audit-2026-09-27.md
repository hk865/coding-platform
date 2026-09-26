# 独立 main 的有界 MVP completion audit

基线：`5bd93abc8cabfefc1bd81e203bbe604b57d163d8`，2026-09-27。核对根 AGENTS/README、HANDOFF、MVP-BEHAVIOR、能力索引，定向核源码和已有证据；未全量重读历史、未为本审计新增测试。**基线审计结论：有真实 blocker，当时不能宣布首条 coding E2E 或完整产品 MVP 已完成。** 冻结是额度原因，不是验收裁决。本表是该提交在本轮补证前的审计快照，表内“缺证”不覆盖文末新增证据；后续实现落点仍以 HANDOFF/能力索引为准。

独立验收 [verification.json](evidence/standalone-2026-09-27/verification.json) 的 124 文件 / 1,102 项包含最终 graph/history，证明该提交工程检查通过。旧同数量快照不含最终 UI，不可互换。浏览器 [执行链](evidence/next-b2-2026-09-26/r6-execution-entry-browser-final.json)、[原历史](evidence/next-b2-2026-09-26/r6-graph-history-browser-final.json)、[Session/邮箱](evidence/next-b2-2026-09-26/r6-session-browser.json) 分别保留其真实范围。

## 已确认行为到生产入口

以下代码链接均是本仓库根路径；测试名称表示已有证据来源，本次没有重跑。B/E 编号对应 [MVP-BEHAVIOR](../../MVP-BEHAVIOR.md)，不另定义范围。

| 行为 | 正式入口与当前实现 | 已有证据与明确缺口 |
| --- | --- | --- |
| B01 初始化 | [Host 路由](../../../src/app/core-routes.ts) 的 projects/create、workspaces/register、goals/create，正式 Project/Workspace/CompletionPolicy writer | R5a-project-bootstrap-platform 空 SQLite 初始化/重开成立；限定已配置真实目录。本子路径未发现新阻断。不能据草案 R3g 存在就再造初始化门槛。 |
| B02 调查/规划/采用 | queries/* → [Workflow.handleGoalInput](../../../src/business/workflow/workflow.ts) → 原 Plan owner | R5b initial-plan、R6 浏览器真实 Answer→候选→采用成立；模型受控，不是外部网络模型。 |
| B03 白板推进 | Workflow.select_work / advanceWork 消费原 TaskGraph，required future 等待而非完成 | 已有两 Work 顺序推进；反馈循环缺口落在 B05/B06，不额外扩一个泛化调度器。 |
| B04 执行与连续性 | [execution-driver](../../../src/core/agent-runtime/execution-driver.ts) prepare/start、completedBoundary→session_history→原 Kernel | R4c-session-continuity 与 R4-control-runtime 的后继 Task 实际模型输入包含旧工具声明/结果，连续性已证；真实 coding 成果缺证见 E01。 |
| B05 同工作区并行 | TaskClaim 已允许不同 Session 并发，无全 Workspace writer 锁 | R4c-task-claim 证明原语；UI scope 当前单 execution，await 全链。缺两个 Kernel 真重叠、共享冲突具体对象与独立成果保留的消费者/证据。 |
| B06 检查/返工/完成 | [check-execution](../../../src/core/agent-runtime/check-execution.ts)、原 Evidence、[completion](../../../src/core/work-graph/tasks/completion.ts) 与 Workflow | 命令检查和正式完成成立；FAIL 停 waiting 后没有同 Task 新 Attempt。claim-service 拒绝已有 Run，Workflow 跳过已有 Run。Reviewer/只读报告的生产消费尚不支持，仅在采用义务要求时是该路径门槛，不能强加到命令检查链，也不能自动撤销已确认支持范围。 |
| B07 查询/解释/导航 | tasks/query、architecture/read/query、executions/read/history、sessions/*、messages/*、files/read | 当前 Task Run→原 claim Session→原窗口→完整历史成立，普通读零模型调用；全部 attempts、已结束 WorkLink 发现、checks/evidence 钻取未通。文件引用发送遗漏见下。 |
| B08 控制 | controls.submitControl/readControl、runtime.deliverControl/observeRun | 本地 Work pause/cancel 有真实 R4.3a/b 证据；Host/UI 未暴露，capabilities 仍错误全 false；原 Run resume 没有正式端口。新 Turn 不是 resume。 |
| B09 变更/治理/换手 | Plan propose/apply，初始架构采用，catalog.reviseArchitectureCatalog，Session 生命周期 | 正式 Goal/验收变化及影响消费缺失；catalog 修订未接 Host/UI；漂移→解释/决定→正式版本→受影响上下文未闭合。换手缺持久义务/决定/未决项/成果引用的接任消费，不能以另建 Session 替代。 |
| B10 中断/重启 | 原请求回执、Session 映射重开、startRun 重放只 observe | Run 冷恢复实际缺失：entering 直接原样返回；新 coordinator 无本地 cleanProof，Kernel 已写终态也不能补账；预算保存在内存。Host 无持久待办恢复消费。安全保留未知占用是正确底线，不等于恢复已实现。 |

## E01–E12 验收落点

| 场景 | 审计判定 | 最小剩余工作 |
| --- | --- | --- |
| E01 首通 coding | **缺关键证据**；不能据此断言写工具未实现 | R6-host 当前 Work 两次只是文本，Role 只有 read，检查 echo。生产已支持授权 write→edit→Kernel；需真实改文件并执行针对修改的有效检查，保留产物和正式完成引用。 |
| E02 后续推进 | **限定顺序链已证** | 保留现有两 Work 同 Session 和 required future 等待证据，不重复施工。 |
| E03 FAIL 后返工 | **代码 blocker** | 原 Task 正式创建后继 Attempt/Run，Workflow 消费失败并执行修正；旧失败和旧 Run 保留，新检查才可完成。 |
| E04 重开/重放/只读 | **既有事实与重放已证** | 现有完成后重开、原回执、原历史零模型调用成立；与 E01 真实修改产物一起补最终首通验收，勿扩一般重试矩阵。 |
| E05 并行与真实冲突 | **消费者与证据未闭合** | 两 Session Kernel 执行重叠、实际共享冲突、独立成果保留；复用既有 claim/工具/消息，不增全局锁。 |
| E06 连续与换手 | **连续已证；换手 blocker** | 持久工作前沿交给接任者实际消费，旧执行安全退出；归档仍可发现/查历史。 |
| E07 暂停/继续/取消 | **代码 blocker** | 先薄接本地 pause/cancel 的 Host/UI 和真实状态，再补原 Run resume。控制请求不冒充停止，未知不交还冲突写入。 |
| E08 目标/验收变化 | **代码 blocker** | 正式目标/义务版本与授权、受影响后续切换/证据失效，无关工作继续。初始采用不替代变更。 |
| E09 架构冲突/漂移 | **消费者 blocker** | 复用目录修订/消息/角色能力，接解释、必要的人类决定和正式变化；不因 R3g 草稿存在就提前造治理层。 |
| E10 三个中断窗口 | **代码 blocker** | 原请求/原 Run 的启动前续办、未知核对、已发生结果补账；恢复预算和安全点，记录实际启动次数。 |
| E11 多项目隔离 | **验收缺证，未发现新代码缺陷** | 现有 workspace 切换/拒未配置范围不足以代替两合法 Project 及越界 material/execution 引用。一次真实隔离路径即可，不加权限矩阵。 |
| E12 双图成果/重开继续 | **部分已证，用户入口缺口** | 文件引用显式发送、正式检查证据钻取、架构 containment、结束关联与历史尝试发现；重开后相关工作与恢复/返工链合验。最终配色等不自动成为门禁。 |

[MVP-BEHAVIOR §5](../../MVP-BEHAVIOR.md) 仍要求本项目和一个外部维护项目的真实任务证据；当前材料不能报通过。三个用户候选工作区本次禁止修改；后续验收可先用临时受控工作区开发链路，但不能把临时例子冒充已验收指定维护项目。

## 直接依据与本轮施工边界

- E03：[claim-service](../../../src/core/work-graph/tasks/claim-service.ts) 的 existing Run 拒绝；[claim-contracts](../../../src/core/work-graph/tasks/claim-contracts.ts) 只有首次 claim/read；Workflow FAIL→waiting，跳过已有 Run。
- E07/E10：[runtime ports](../../../src/core/agent-runtime/ports.ts)、[control intent](../../../src/contracts/control-intent.ts) 无 resume；[execution-control](../../../src/core/agent-runtime/execution-control.ts) 本地 handle Map；[execution-observation](../../../src/core/agent-runtime/execution-observation.ts) entering 返回及 cleanProof 要求；[create-platform](../../../src/composition/create-platform.ts) 过期能力投影。
- 文件引用：[views](../../../src/ui/views.ts) add_reference 只加入 composerDraft.references；[main](../../../src/ui/main.ts) send-message 仅使用 text，未发 references。原浏览器只证明入草稿，不证明发出。
- 完成证据：[EvidencePort.readVerification](../../../src/core/work-graph/evidence/contracts.ts) 已有；TaskRow 未带 reduction/verification 引用，Host 无读取路由。应接精确已有事实，不重建 Evidence owner。
- 结束关联：[session-directory](../../../src/core/work-graph/sessions/session-directory.ts) findSessionsByTarget 仍只接 openLink；includeArchived 是独立生命周期筛选。A1 草稿正好对应此窄缺口，**不等于已实现，也不等于全部 attempt 枚举**。
- 架构包含：[catalog-contracts](../../../src/core/work-graph/architecture/catalog-contracts.ts) 已声明 containment；renderAdoptedGraph 只消费 dependencies。显示包含树与依赖 DAG 的区别属于既定语义，配色/装饰不属于本审计 blocker。

审计后首批曾选择 [R6 Work-control](../tasks/R6-work-control-consumer-skeleton.md)，独立根 runner 已实际完成 Stage1，骨架中审未发现必须返修项；候选未导入、未进入 Stage2。用户随后收窄本轮范围，因此本批保持 STOP，E07 的 Host/UI 缺口仍未关闭；不以候选或 DSH 自报检查替代产品验收。


## 审计后补证与本轮停止条件（2026-09-27）

[受控 coding 结果](evidence/standalone-2026-09-27/e01-controlled-coding/result.json)补上 E01 的真实文件编辑与有效检查子链：未改生产源码，通过实际浏览器调用原 Host/Runtime/Kernel/SQLite，两个 Work 完成两次编辑，三次注册行为检查通过，正式 Goal COMPLETED。证据同时保留检查报告、产物哈希、Run/完成记录与初始化回执；不能再将该子链描述为“只有文本和 echo 检查”。初始化经正式 HTTP owner 预先完成，因此这不是完整 UI bootstrap 验收；受控 provider 也不是外部真实模型，更不覆盖本项目和指定外部维护项目、E03/E05/E07/E10 或整个 MVP。

用户最新要求“直到接入模型之后没有‘非语义’的错误即可”，本轮只处理真实模型路径中已复现的配置、协议、工具接线及状态处理问题。[R5b 输出契约补全](../tasks/R5b-live-model-response-contract.md)已完成骨架→中审→实现，两文件正式导入；独立相关 4 文件 / 4 项、类型与构建通过。严格解析、生产权限 guard 与正式状态 owner 均未放宽。

真实模型验收保留三次运行的不同结论：[首次记录](evidence/standalone-2026-09-27/e01-live-deepseek/first-attempt/result.json)为三次模型调用，前两轮四条工具结果成功，但初始规划回答带导语并猜测子项结构而被拒绝，暴露 guide 子项协议缺口；[第二次记录](evidence/standalone-2026-09-27/e01-live-deepseek/restricted-read-run/result.json)经 16 次模型调用已正式完成，但 fixture 的 `readPrefixes: ["src"]` 对 `read(".")` 产生一次正常权限拒绝，不能写成零错误验收。第三次使用仅覆盖新建临时 toy 工作区的 `readPrefixes: ["."]`，并明确检查由 Host 执行，没有修改生产权限 guard。

[最终真实 DeepSeek 结果](evidence/standalone-2026-09-27/e01-live-deepseek/result.json)为 12 次模型调用、12 次工具完成、0 模型/工具错误；两个 Work 复用同一 Session 真实改文件，三次实际检查 PASS，正式 Goal COMPLETED。真实浏览器展开完成回执并读取 Query 原历史，调用数仍为 12。本限定路径已达到本轮停止条件，按用户确认停止，不再展开其它模块。它仍不替代完整 UI bootstrap、本项目及指定外部维护项目或整个 MVP 验收；上表其它既定 blocker 保留，不自动移到 post-MVP。模型的规划/代码语义质量与本轮接线错误分开判断。
