# 从核心结构到实际源码的重构实施方案

**2026-09-29 文件资源管理器修复：** 普通目录浏览改用既有 Kernel 路径枚举，不再依赖完整文本 capture；二进制/大文件不阻断文件名展示。每次本地显示100项、可输入子目录、明确加载/错误/部分结果。13项、类型、构建、边界及真实ROS目录只读浏览/文件打开通过；未写项目文件、未调用模型。当前44797终端Host PID379878；未提交推送。[本批证据](reviews/evidence/ui-directory-inventory-2026-09-29/README.md)。

**2026-09-29 正常 UI 冷启动与双图纠偏：** 隔离新项目已从主对话目标、只读调查、候选审阅和明确采用，进入两个同 Session Work；唯一预期源码变更、三轮正式检查 PASS、GoalPhase COMPLETED。双图恢复稀疏节点/真实连线、下方独立滚动详情、按需展开及固定，未来节点保留。检查恢复不重开模型、不把已 finalized 非 PASS 当成无结果。按工作区保存显示选择及两标签页切换/刷新恢复已通过浏览器复验；取消/失败后新 Attempt 等缺口仍保留，不能宣告整个 MVP。产品模型 10 次，曾有 2 次沙箱工具失败；正常终端 Host 保留沙箱后检查通过，用户级服务已停止。 [本批证据与边界](reviews/evidence/goal-cold-start-2026-09-29/README.md)。

**2026-09-28 AG2a 已导入：** [到达 MVP 的路线](AGENT-BEHAVIOR-PLAN.md#8-到达-mvp-的路线与证据导航)逐项对应既有 B/E 行为，纳入异步对齐及三类进入流程。本批完成显式咨询接收/Answer 回复：保留原 Query/Session/消息事实，新增精确 HTTP 与同一消息详情入口；不要求 Query 写工具或常驻角色链。[两阶段实现与证据](reviews/evidence/agent-behavior-2026-09-28/ag2/README.md)。下一段是原发信 Agent 感知回复、恢复并重新决策，再沿 AG3 明确执行选择；完整 MVP 原门槛不变。

**2026-09-28 AG6 已导入：** 用户六条职责批注已落实为五份可组合指令资源及 Host 显式 bundle 装配，沿原 Runtime/Kernel 执行，不另建工厂或固定角色链。一个通用工作台按成员查看各 Agent，不变成三个独立入口；冷启动成员策略与后续演进决策归编排，配置本身不启动四个 Agent。[任务](tasks/AG6-behavior-assembly-2026-09-28.md)与[证据](reviews/evidence/agent-behavior-2026-09-28/ag6/README.md)记录两阶段实现、19 项/类型/构建及提示词修正后 8 项复验。真实模型装配调用通过，但语义抽查仍有明确问题；不扩大局部评测来宣称角色可靠，也不将 AG2–AG5 或 MVP 余项记为完成。

**2026-09-27 最新施工顺序：** 按用户要求转为 [Agent 职责与行为计划](AGENT-BEHAVIOR-PLAN.md)，先从真实消费者发现平台缺口及冗余。AG1 当前关联发现与咨询请求已两阶段独审导入（6文件42项及类型/边界通过）；AG2–AG5 对应回复/委托、复用或创建后执行、并行冲突、结束交接恢复。本页旧批次状态保留历史范围，不能因有任务书就继续平台扩建，也不能把既定必需行为自动移出 MVP。

**最新独立仓库验收：124 文件 / 1,102 项通过（exit0）。** 本次包含最终 graph/history UI 和独立目录构建脚本；Kernel 补丁再生、边界、Node/UI 类型、构建、编译入口和受 token 保护的 Host smoke 均通过。[独立验收记录](reviews/evidence/standalone-2026-09-27/verification.json)。本轮[有界 completion audit](reviews/completion-audit-2026-09-27.md)已完成：仍有真实实现阻塞与验收缺证；下方较早报告保留其当时范围。

> 独立仓库说明（2026-09-27）：本仓库根即原 `coding-platform/next`，文档位于 `docs/`；当前继续入口见根 `CONTINUE.md` 与 `AGENTS.md`。旧证据、任务书中的绝对路径和 scope 只描述当时工作区，不能直接执行。用户已从独立 main 恢复并完成有界审计；本轮真实模型接入的非语义错误修复已验收并停止，尚未宣告整个 MVP 完成。

**当前状态（2026-09-27）：本轮真实模型接入验收已通过，按用户要求停止施工。** [有界审计](reviews/completion-audit-2026-09-27.md)之后，[R5b 输出契约](tasks/R5b-live-model-response-contract.md)已完成两阶段 DSH、中审及两文件导入；独立相关 4 文件 / 4 项、类型与构建通过。[最终真实 DeepSeek 验收](reviews/evidence/standalone-2026-09-27/e01-live-deepseek/result.json)完成 12 次模型调用、12 次工具完成，模型/工具错误均为 0；两个 Work 复用同一 Session 实际改文件，三次检查 PASS，正式 Goal COMPLETED。真实浏览器展开完成回执并读取 Query 原历史后，模型调用数仍为 12。本限定路径没有再出现“非语义”错误；不继续其它模块，也不据此撤销既定 MVP 余项或宣告整个 MVP 完成。

[受控 coding 路径](reviews/evidence/standalone-2026-09-27/e01-controlled-coding/result.json)已补证：原生产入口完成两次真实文件编辑、三次实际行为检查及正式 Goal COMPLETED。该证据使用受控 provider，初始化经正式 HTTP owner 完成，不代表真实模型、完整 UI bootstrap 或完整 MVP。

独立根 runner 已实际运行 [Work-control Stage1](tasks/R6-work-control-consumer-skeleton.md)，骨架中审未发现必须返修项；候选仍只在独立 lane，未导入、未进入 Stage2，因本轮范围收窄保持 STOP。其余返工、控制/恢复、并行、换手、变更/治理和完整项目隔离缺口按原审计保留；A1 旧 lane 不导入，R3g 不自动派发。

> 2026-09-27 **提取前隔离历史：124 文件 / 1,102 项通过（exit0）。** 该副本包含R4.3b与R6执行入口最终导入，以及[W2一行机械调用次数断言删除](reviews/evidence/next-b2-2026-09-26/r4-r6-w2-fixture-amendment.json)；Node/UI types、构建、7/8边界、7源/28产物逐字再生、编译composition与真实token保护Host smoke均通过。见[结果](reviews/evidence/next-b2-2026-09-26/r4-r6-isolated-result.json)、[通过日志](reviews/evidence/next-b2-2026-09-26/r4-r6-isolated-recheck.log)及保留的[首次失败日志](reviews/evidence/next-b2-2026-09-26/r4-r6-isolated-final.log)。快照不含其后的graph/history骨架与实现，不能据此证明当前全部源码整体通过；本轮未重做旧8,827文件全hash比较，不沿用旧快照结论。

> **前序隔离基线：** B2/C1/M1/M2/W2组件及前序组合子集为94文件/948项；类型、构建、边界、12项Kernel再生及编译入口通过，旧8,827文件零变化。见[原结果](reviews/evidence/next-b2-2026-09-26/b2-c1-w2-isolated-result.json)。角色热换反例和专用注入已删除，不恢复不存在的生命周期。


| 当前批次 / R编号 | 已有能力与真实生产者 | 本批消费者 / 验收目标 | 尚待闭合 |
| --- | --- | --- | --- |
| B2 / R4c、R3运行状态 | 正式Claim、Role、WG11/12、B1、原Kernel持久日志 | prepare/start/observe、模型准入、终态归约与释放；C2真实材料facts消费 | Task/Query执行、R4.3a本地控制和R4.3b取消后继已接通；恢复、维护与完整连续生命周期继续 |
| C1 / R3f、R4工具 | Session目录、正式邮箱/MaterialPort/注册索引 | 定址send/inbox/body/ack/respond；C2同Kernel真实工具往返与同请求并发回执 | 领域、公开组合根及 Runtime 工具已接；AG2a 已接显式处理/Answer 回复，自动唤醒、强 wait 和原发送方续接仍缺 |
| W2及后续 / R3c、R3g、R5 | W1未来编辑、RoleSpec、B1 Skill装配、W2委托与显式意图 | 真实Agent query/propose/apply；无完整验收/分配节点入图、首次分配、显式激活、延期与局部CAS | 原语、正式完成与限定规划/推进/Host入口已接；完整授权变更、复杂调度及其余Host/UI继续 |
| R2、R3d/e、R4d/e/p、R5/R6 | 既有Workspace/图/Store原语 | Git及语言消费者、架构演进、证据完成、控制恢复、并行结果、bootstrap/Host/UI与最终切换 | 完整范围继续保留；知识库/Memory非当前门禁，不因B2/C1局部交付关闭 |

设计：2026-09-23；产品路径与源码核对：2026-09-25。依据用户“确定数据结构与行为→编排状态机→实现模块与重构方案，开始工作/实现”及本次双图/生命周期纠偏。目标由[核心数据与操作](CORE-DATA-OPERATIONS.md)、[状态机](ORCHESTRATION-STATE-MACHINES.md)、[架构](ARCHITECTURE.md)和[模块 DAG](module-dag.md)共同确定；不是继续沿旧 13 模块方案增加包装。

> **2026-09-24 独立工程基线：** `coding-platform/next` 已真实建立，后续 R2–R6 默认在该独立工程实施；原 `coding-platform/src` 只读，用于行为对照和实现参考。五个目标目录均已存在：Workspace、Goal、material、body 与 Store 实现已迁入；AgentRuntime 已补迁模型工具循环与来源绑定组件；Workflow / AgentRuntime 的正式平台入口仍为 N0 unsupported，完整目标契约尚未全部转为运行实现，UI 未迁。R3c reader/index 子项已通过独立验收（250 项目标测试，见迁移报告），不将整个 R3c 记为 PASS。 最新结果见[独立目标工程迁移与验收](reviews/next-completed-migration-2026-09-24.md)，运行入口为 [next/package.json](../../package.json)。旧消费者仍使用旧产品，待新 Workflow/UI 切换后退役；本轮不要求将新实现接回旧系统。

> **2026-09-25 历史验收基线：** [B1 装配接缝与 W1 未来任务白板](reviews/next-b1-w1-2026-09-25.md)已通过真实物理隔离验收：78 个测试文件／726 项 PASS，typecheck、build、模块边界、Kernel 补丁再现与编译入口验证均通过；旧工程 8,827 个受保护文件零变化。B1 交付受信 Skill/Hook 配置及惰性来源组件，W1 交付 Host future-only 计划修订与跨版状态/历史读取。正式 Role 装配、Runtime prepare/start、观察归约与释放、Agent 白板工具和 Workflow 自动推进仍未接通，不关闭完整 B、R3c/R4 或 R5/R6。

> **前序验收基线（保留历史）：** [A1](reviews/next-a1-graph-session-2026-09-25.md)为75文件／719项PASS，交付正式 catalog 初始化、Module/Task 关联维护、目标发现、归档/重新启用及重启历史保持；R4c.2b/.2c 的[图定位历史与Source组件验收](reviews/next-r4c-history-and-source-2026-09-25.md)为68文件／620项PASS，复用原 Run 区间、Kernel 主键范围读与 Material reader。前序及本次726项都只证明各自已验收范围，不以测试总数替代下述 A/B/C/D 产品路径和 AT 场景。

W2/C2与[R5a初始化](tasks/R5a-project-bootstrap-skeleton.md)、R4.2 Kernel安全点已完成隔离验收。[R4.1持久控制](tasks/R4-control-intent-implementation.md)三生产实现已[独审导入](reviews/evidence/next-b2-2026-09-26/control-intent-implementation-import.json)：7文件50项通过，最终回执catch修复后2文件20项及types通过；queued受理与fresh屏障已有，后续R4.3a已接本地物理停止/ack；fresh resume仍缺。[Git固定版本](tasks/R2e-2-git-read-compare-dispatch.md)八文件骨架及一文件实现已导入，三项独审缺口返修通过，独立12文件112项/types通过，见[导入](reviews/evidence/next-b2-2026-09-26/git-read-implementation-import.json)；真实child/root清理与B2三轮工具消费通过，普通文本mixed比较已接，binary/Git-capture及Git写版本继续。[R3e.1注册检查](tasks/R3e-completion-implementation.md)：五生产文件完成受限返修并已[独审导入](reviews/evidence/next-b2-2026-09-26/r3e-evidence-implementation-import.json)，含Goal gate真实普通producer分支；固定[3文件/10项](reviews/evidence/next-b2-2026-09-26/r3e-final-tests.log)及[types](reviews/evidence/next-b2-2026-09-26/r3e-final-types.log)通过。原回执、局部读集、当前来源适用性、执行根与晚取消事实收尾已修复。注册检查/Evidence子链已接通，不代表Task/Goal完成或Reviewer已交付。

[R5b Query执行](tasks/R5b-query-execution-implementation.md)：pending受理与十九文件骨架后，八生产范围（七改变）完成[独审导入](reviews/evidence/next-b2-2026-09-26/r5b-query-execution-implementation-import.json)。固定4文件/13项及types通过；公开无Plan Goal→Query→真实Session claim→有界prepare→原Kernel readonly源码工具/模型轮次→持久Answer/Job/Run→同generation释放、原回执及SQLite重开已经贯通。一次有界返修落实原expected/请求指纹与回执恢复、新动作当前占用、完整scope/初次Role、manifest有效预算及原输入来源pins；不增加运行中换Role防御。Answer→初始Plan已由后续消费者批次贯通；外部材料grant、多轮/高级恢复继续；本轮限定Host执行消费者已由R6接通。

[R6.1a Host工作台](tasks/R6-host-workbench-implementation.md)：六生产实现及最终三项UI修正已[独审导入](reviews/evidence/next-b2-2026-09-26/r6-host-workbench-implementation-import.json)，固定[2文件/15项](reviews/evidence/next-b2-2026-09-26/r6-final-host-tests.log)、Node/UI types与构建通过。修正前真实浏览器已走空库初始化→Plan→采用/观察结构与任务图、文件分页/捕获版本读取、第二scope无策略Goal与原请求replay；最终修正核实异步响应写原scope、文本失焦不全页重绘及技术详情折叠。最终版本同SQLite无review配置[HTTP重开](reviews/evidence/next-b2-2026-09-26/r6-reopen-http.json)可读Goal/TaskGraph；最终[真实浏览器复验](reviews/evidence/next-b2-2026-09-26/r6-final-browser.json)及[截图](reviews/evidence/next-b2-2026-09-26/r6-final-browser.png)已完成：现成Chromium Headless保留原sandbox、临时独立profile，经原生DevTools输入连接真实Host/SQLite；Goal ID输入后Tab保留下一框焦点，无review重开可读Goal/TaskGraph，capture响应延迟700ms时切B不受A响应污染，切回A已capture ready。 本轮main核心/Host集成[13文件47项串行通过](reviews/evidence/next-b2-2026-09-26/cohort-core-host-integration-tests-serial.log)，[types](reviews/evidence/next-b2-2026-09-26/cohort-core-host-integration-types.log)及[7/8允许边界](reviews/evidence/next-b2-2026-09-26/cohort-core-host-integration-architecture.log)通过；[首轮并发超时日志](reviews/evidence/next-b2-2026-09-26/cohort-core-host-integration-tests.log)保留。该专项是当时的局部结果；最近完整隔离范围见顶部124文件/1,102项快照；Session/mailbox后续交付见下。

[R3e.3正式Task/Goal完成](tasks/R3e-task-goal-completion-implementation.md)：五生产实现已[独审导入](reviews/evidence/next-b2-2026-09-26/r3e-completion-implementation-import.json)，最终2文件/3项及types通过；一次纯policy修复保留optional已有真实Run/Lease的活动副作用阻塞，无执行的optional意图仍不阻塞。公开普通work与独立Goal gate检查→completeTask→completeGoal→TaskGraph→SQLite重开/原回执已接通；Reviewer生产、正式重开/supersession和完整Workflow仍未交付。

[R5c.1 Workflow](tasks/R5-workflow-advancement-implementation.md)：原七文件骨架后，workflow.ts实现已[独审导入](reviews/evidence/next-b2-2026-09-26/r5c-workflow-implementation-import.json)，独立2文件/3项及types通过。真实已有Plan→两个普通work复用同Session的新Kernel Turn→实际checks→工作完成→独立Goal gate→正式Goal COMPLETED已接通，optional future仍保留；每次有限owner调用沿原完整请求/回执，无第二状态库。后续initial-plan批次已实现`handleGoalInput`与初始采用；复杂调度/Reviewer及其余Host消费者继续；限定一键执行链见R6。

[R6.1b Session/mailbox](tasks/R6-session-mailbox-implementation.md)：四生产实现已[独审导入](reviews/evidence/next-b2-2026-09-26/r6-session-mailbox-implementation-import.json)，原2文件/17项、Node/UI types及最终物理构建通过。实际浏览器从空库创建两个Session、Host发信/正文/原历史读取，并在无review配置的同SQLite/Kernel重开后保留；读取仍pending。发送后继捕获原scope/recipient、新草稿保留，以及[切Session正文归属](reviews/evidence/next-b2-2026-09-26/r6-session-selection-repair-import.json)已修正，最终[浏览器复验](reviews/evidence/next-b2-2026-09-26/r6-session-browser.json)通过。Query/Workflow执行与布局已由后续批次接通；材料/完整控制与其余UI范围继续，不将本批当完整R6。

- [R5b初始Plan消费者](tasks/R5b-initial-plan-implementation.md)：12路径骨架后四算法已[独审导入](reviews/evidence/next-b2-2026-09-26/r5b-initial-plan-implementation-import.json)，固定6文件/10项、types及architecture/import通过。真实Query Answer→候选→采用→原Workflow→正式Goal COMPLETED贯通，optional未来意图保留；原请求完整指纹/回执优先及共同提交局部guards已收敛。原同case仅将source与SQLite/Kernel存储目录分开，避免检查读取自己的数据库写入；没有扩大测试矩阵。Host限定执行入口已由R6接通，见下方当前批次。
- [R6 UI布局与已有事实](tasks/R6-ui-layout-implementation.md)：四生产实现已[独审导入](reviews/evidence/next-b2-2026-09-26/r6-ui-layout-implementation-import.json)，19项、Node/UI types与物理构建通过。三栏/页签、目录与文件页分离、对话与文件草稿及按需展开完整原始历史已接已有真实事实。三文件[浏览器窄修](reviews/evidence/next-b2-2026-09-26/r6-ui-browser-repair-import.json)已导入；[最终真实浏览器](reviews/evidence/next-b2-2026-09-26/r6-layout-final-browser.json)确认同层分列、单击详情/双击及右键固定、拖宽/放大恢复、文件草稿/选区引用与完整原文展开；1440×960外页稳定。完整图关联及最终视觉整理后续接续。原新增历史测试已按用户纠偏撤销永久字段过滤；不加测试矩阵，不宣称完整R6完成。

- [R3d目录修订与明确包含](tasks/R3d-architecture-evolution-implementation.md)：五路径骨架后catalog-service单文件实现已[独审导入](reviews/evidence/next-b2-2026-09-26/r3d-architecture-evolution-implementation-import.json)，固定2文件/33项及types通过；局部同请求竞争恢复收敛。真实初始目录→新增Module/显式包含→新current/旧history→Session关联新Module→SQLite重开/原回执贯通。包含与依赖独立，旧无包含关系仍为unknown，不反推树；完整decision/gate治理及UI包含消费者继续。

R4.3a 八生产控制投递/观察已[独审导入](reviews/evidence/next-b2-2026-09-26/r4-control-runtime-implementation-import.json)，R4.3b 六生产取消历史消费者也已[精确导入](reviews/evidence/next-b2-2026-09-26/r4-terminal-history-implementation-import.json)：固定15项、types与28产物再生通过。共享 `projectTerminalTranscript` 仅在副本省略没有结果的 abandoned 声明及过滤后全空消息壳，原历史、已有推理和实际结果保留；真实取消释放后，同 Session 第二个正式 Task 经 claim→prepare→start 消费前缀已通过。未知结果仍不释放，fresh resume/冷恢复及完整控制 UI 仍属后续范围。

R6 调查/规划执行入口六生产实现已[最终导入](reviews/evidence/next-b2-2026-09-26/r6-execution-entry-implementation-import.json)，固定22项、Node/UI types与物理构建通过；[最终真实 CUA 浏览器验收](reviews/evidence/next-b2-2026-09-26/r6-execution-entry-browser-final.json)一键贯通 Query→Answer→初始 Plan 采用→两个 Work→实际 checks/独立 Goal gate→正式 Goal COMPLETED。完整回答默认收起且可主动展开，任务图直接显示原 `TaskGraph.completion`，optional 无验收未来节点继续保留。该链使用原受控4回复及真实 Host/Runtime/Kernel/SQLite，不代表外部真实模型网络、完整 MVP/UI 或全生命周期已验收。

[Task本次执行到原Session/历史](tasks/R6-graph-history-consumer-implementation.md)的两UI实现及辅助历史重复渲染窄修已[精确导入](reviews/evidence/next-b2-2026-09-26/r6-graph-history-consumer-implementation-import.json)，[固定22项、Node/UI types与构建通过](reviews/evidence/next-b2-2026-09-26/r6-graph-history-browser-repair-review.json)。[初轮真实CUA](reviews/evidence/next-b2-2026-09-26/r6-graph-history-browser-initial.json)已核Task→两个不同Run→同一claim Session、各原窗口2–6/7–11、完整Session顺序1–10→11、Run页切回保留、原文默认折叠可展开及中心/辅助分页独立；[最终只读复验](reviews/evidence/next-b2-2026-09-26/r6-graph-history-browser-final.json)确认辅助页仅呈现一次10条原记录，可展开position5实际正文，模型调用0。该消费者只导航当前TaskRow已知Run，不代表全部attempt枚举；本批未纳入提取前124文件/1102项副本，但已纳入顶部 standalone 独立提交验收。架构包含UI、文件保存、diff/终端、完整控制/恢复、Reviewer/返工、治理及最终消费者切换继续保留；恢复后的实际阻塞与下一批以顶部审计和 HANDOFF 为准。

**冻结前安排（当前暂停，不启动新批次）：**依用户本轮[架构设计结论讨论](chatgpt-conversation://6ab761c4-e76c-83ec-af19-0076bd30aa4c)纠偏，优先证据→正式完成→Workflow，并推进Query与Host真实入口的完整E2E；R4.3a八生产实现已独审导入；Query受理、R6初始工作台、R3e.3正式完成及Workflow已有Plan推进实现已导入；Query execution与R6 Session/mailbox实现已独审导入，初始Plan消费者已导入，UI布局已完成当前范围浏览器复验。R4.3a普通控制与R4.3b取消后继历史消费均已导入；R6一键执行链已完成限定浏览器验收，图历史消费者已导入并按用户要求冻结；R4.4/5高级恢复继续。骨架/测试STOP中审→实现/独审两阶段不变；中审看骨架是否带偏，实现看正常公开路径是否可跑、真实权限和副作用边界是否正确。只修有实际影响的缺陷，禁止仅为覆盖更漂亮新增返修轮次；邻接限定实际受影响必要集合，完成必要验证后推进产品链。unknown执行、原回执和已发生历史事实不因收敛测试而放松，整合后仍做既定隔离验收。详见[质量 §2.1](CODE-QUALITY-GUIDELINES.md#21-校验须与操作后果匹配2026-09-26)。

## 0. 双图、Agent 与生命周期的完整施工范围

2026-09-26用户补充已在W2/R3c实现：显式plan_only节点无需完整验收、分配或依赖即可正式入图，包括optional或deferred节点；首次分配不等于激活，request_execution仍需合法分配和真实claim。TaskGraph从已读事实提供缺项与required未完成解释，不计算完成。公开采用/重开/延期/首次分配/显式激活及与claim局部竞争已独审；R5c已有Plan推进已接通；初始规划与R6人用一键执行入口已接通；复杂调度与其余消费者继续。见[意图依据](intent/INTENT-AND-DECISIONS.md#2026-09-26-补充未来意图节点与校验边界)。

本节采用用户指定的[双图与生命周期对齐稿](../AGENT-GRAPH-LIFECYCLE-ALIGNMENT-2026-09-25.md)，并重新核对[14 段用户原话](../agent-platform-user-replies-numbered.md)、[原始对话](intent/ORIGINAL-DIALOGUE.md)第 975–985 行、当前 PRODUCT 和 next 源码。对齐稿依据旧 13 模块资料写成且声明未检查 next；其中产品要求有效，具体工程建议须映射到当前五模块，不能直接把推测写成源码缺陷。

**当前承载选择不变：**工作由 `SessionRecord`、`SessionWorkLink`、Role 配置与 Run 承载。用户原话 01/12/14 不要求新增一个永久 Agent 主体。图上的“Agent”首先是可定位的工作 Session 与角色/状态卡片，不因此新增 AgentDirectory、第二份成员表或历史库。`working/standby/paused` 是产品状态含义；实现分别解释真实 occupancy、Run/控制结果、health 与 lifecycle，不能另造一套需双写的状态枚举。

### 0.1 职责、既有能力与缺口

**施工前历史：** A1 开始前，创建时 Module/WorkContext 被明确拒绝，且没有后续图绑定/解除关联、归档/重新启用写入口。**A1 验收后：** Module/Task 创建关联及后续维护、正式 catalog 初始化、目标发现、归档/重新启用已由真实组合根贯通；WorkContext 仍无正式生产者，不伪造为受支持。下表列验收后现状与剩余责任，不能继续拿施工前缺口当当前实现。

| Owner | 已有真实入口与事实 | 本轮必须连接或补齐 | 不应承担 |
| --- | --- | --- | --- |
| WorkGraph | Session目录/图关联/RoleSpec、TaskClaim、WG11/12、正式执行事实、C1邮箱、W1/W2未来修订/显式意图/委托 | 证据/检查/完成、完整授权Plan变更、后续架构演进、强wait和业务协调；WorkContext仍无正式producer | 直接调用模型；凭图变化决定语义策略；另存Kernel全历史 |
| AgentRuntime | 原Session/历史/Store映射、共享Kernel循环；B2 prepare/start/entered/observe及释放，C2真实通信/白板/材料与Skill装配 | Query及本地持久pause/cancel已接；fresh resume/recovery、维护/交接与并行结果处理继续 | 另写图/任务正式状态；复制角色规则、原历史或全局规划 |
| Workflow | `createWorkflow.advanceWork` 已接已有Plan的正常执行/检查/正式完成；`handleGoalInput`已接初始规划采用 | 角色 Skill/Prompt 与图工具接成查询、咨询、选择/拆分/派发、等待/交接、解释/升级流程；公开实际可用能力 | 把所有关系变锁；复制图；每个机械状态变化都调用模型 |
| WorkspaceTools | 来源捕获、冻结读/查询、部分比较/语言工具；作为 observed graph 的实际来源 | 为涉及的图更新/结果核对复用已有工具；Git固定commit读取/比较及git↔working_tree普通文本比较已接通，mixed binary/Git-capture、语言覆盖及写入能力按 R2 余项独立收口 | Agent/Session 身份与生命周期事实权威 |
| RecordStore | Memory/SQLite、条件事务、幂等、唯一声明、正文及注册索引 | 在原设施上登记新增关联/状态所需最小记录和索引；证明局部查询及原子变化，不新增第二事务 owner | 选人、语义上的并行判断或恢复策略 |

源码核查入口：[`sessions/contracts.ts`](../../src/core/work-graph/sessions/contracts.ts)、[`lifecycle-contracts.ts`](../../src/core/work-graph/sessions/lifecycle-contracts.ts)、[`session-directory.ts`](../../src/core/work-graph/sessions/session-directory.ts)、[`SessionRecord`](../../src/contracts/core/session.ts)、[`create-platform.ts`](../../src/composition/create-platform.ts)。A1 证据见[验收报告](reviews/next-a1-graph-session-2026-09-25.md)；后续批次继续在[能力索引](IMPLEMENTED-CAPABILITIES.md)更新实际接线，不能由上表剩余目标反推已完成。

### 0.2 生命周期操作与调用责任

下表冻结责任与复用位置，**不是声明每行已有可调用 API**。动作不必各建类、服务或表；按已有结构扩展窄操作即可。

| 操作 | 决定或触发 | 正式状态/关联 owner | 实际动作与消费者 | 当前缺口／工作包 |
| --- | --- | --- | --- | --- |
| 创建/打开 | 人或 Workflow 选择独立工作上下文 | WorkGraph 创建 operation、Session 映射 | Runtime 调现有 Kernel Store；图查询/Host 消费卡片 | A1 验证无 catalog 也可先建真实 Session，catalog 后可显式挂靠或创建时挂靠；Workflow 选择 B/C |
| 角色/模块/任务绑定、换关联 | 人或被授权角色提出职责 | WorkGraph SessionWorkLink 与 Role 引用 | 图发现、prepare、咨询/交接读取同一关联 | A1 Module/Task 关联维护、当前/历史查询已通过；角色实际装配和业务换手消费仍属 B/C/D |
| 开始工作/占用 | 被授权业务入口，复用已有 claim | WorkGraph Task/Run/Session 原子事实 | Runtime 读 WG11，装配并进 Kernel | B2已正式接通Claim→entered；busy仍不等于已经进入模型，Query另批 |
| 结束工作/待命 | Runtime 的真实终态观察 | WorkGraph 按相同 owner/generation 归约与释放 | 图卡片据当前 occupancy/健康状态显示；保留模块关联 | B2已接真实终态观察/匹配释放；Run终态不直接推出Task完成，恢复未知另批 |
| 暂停/取消/继续 | 人、被授权角色或明确规则 | WorkGraph 控制意图与已观察结果 | Runtime→Kernel，Host/图显示请求和实际结果 | R4.3a已接本地live Work投递/真实观察，R4.3b已接取消后新Turn；fresh resume和完整Host控制仍缺，不把请求当生效 |
| 崩溃恢复/重试 | Runtime 核对 Kernel，Workflow 决定业务后续 | WorkGraph 保留 unknown 与恢复关联 | 复用 Kernel 原执行恢复，读取已有定位 | D；结果未知不盲目重跑模型，不凭 ID 声称 exactly-once |
| 咨询/等待/回复 | 先读持久事实；需要解释才由角色选择目标 | WorkGraph 通信记录与必要等待关系 | Runtime 送入适合 Session；Workflow 消费回复 | C；working 时不抢占同 Session，归档不自动唤醒 |
| 交接/职责拆分 | 人或角色按图判断相关性 | WorkGraph 保留新旧关联、义务与引用 | Workflow 选择后由 Runtime 装配；继承引用按需读 | A1 已提供关联维护；C/D 接完整动作，不复制整份历史 |
| 压缩/重组 | 容量、目标变化或已确认材料失效 | WorkGraph 操作/来源与关联 | Runtime 优先调用 Kernel 支持的维护；角色决定新职责 | D；native compact 当前 unsupported；不在每轮默认重组 |
| 归档/重新启用 | 显式的人/角色操作，已有授权不重复问人 | WorkGraph lifecycle 与原子版本条件 | 默认发现排除 archived；精确/历史查询保留记录 | A1 已通过真实 SQLite/Kernel 与重启验收；忙碌/未知执行不能靠归档解除占用，重新启用不启动模型；业务角色/UI 消费后续接通 |
| 记忆维护/知识接入 | 后续方向，非本批硬交付 | 保留 WorkGraph 配置/材料接入位置 | 未配置明确不可用；不阻塞角色与生命周期 | RoleSpec 已有不等于 Memory 已实现；本轮不新建知识库或记忆系统 |

### 0.3 A/B/C/D 产品路径与 R 系列对应

**本轮收敛（“下一批执行计划”后续）：** A/B/C/D 保留作用户路径索引，实际施工只有三组复用工作：Agent/Session 生命周期；固定分组的角色/Context、工具与 Skill；可编辑未来计划及自动推进白板。咨询、交接与协调是这些能力的组合，不增加三个子系统。知识库和有限 Memory 均不作为本批硬交付。白板修订与生命周期独立部分可并行，不必等整个 D 才允许编辑未来任务。

Context分为稳定配置（职责/Skill/工具说明）、本次绑定（Task/Module/输入引用）和连续内容（原Session历史）。B1/W1提供原接缝，B2/C2已消费正式Role、Task输入、材料和工具授权进入原Kernel，W2已接Agent白板与未来意图；Workflow已有Plan推进已消费这些能力；初始规划和受信Host有限续传已接；复杂调度及其余消费者继续，不重造原语。

| 工作包 | 实施与复用 | 对应原 R 系列 | 可并行部分与交付边界 |
| --- | --- | --- | --- |
| **A：双图关联与生命周期操作** | 复用 SessionRecord/WorkLink、目录索引和 Role；A1 已交付正式 catalog 初始化、Module/Task 关联维护、归档/重新启用及当前/历史发现 | R3d 正式结构关联、R4b Session 目录/维护基础、R3g Role 引用、R6 薄查看入口 | **A1 已验收**：创建→挂靠→可查→显式归档保历史及重启真实贯通。同模块多个 Session 合法；不把 observed graph 冒充 catalog。完整架构变更/decision/gate、执行/咨询与薄人用入口仍未全部完成，不关闭 A/R3d/R4b |
| **B：真实执行与能力装配** | B1 已验收 Skill/Hook/惰性来源接缝；继续以 WG11/12/13、TaskInput、Role、RT1/3/4/7/8 接正式 prepare/entry、增量观察与状态 | R4c 执行、Query 后续，R3g 角色配置，R2 来源工具消费者 | B1 组件不关闭 B；共同契约先冻结，独立实现按文件并行，不复制 reader/授权规则/模型循环。执行结束/释放与 D 的完成判定责任分开；记忆接入留后续 |
| **C：通信与角色编排** | 定向消息、等待/回复、按图咨询；秘书/参谋/书记/协调职责的 Skill 与工具接真实 Workflow | **R3f 通信**、R5 业务编排、R3g 角色配置 | 消息协议与角色资产可在 B 实现时准备；实际咨询须消费真实执行能力。同模块多个 Session 合法，不预置唯一专家或常驻总管 |
| **D：控制、连续性与产品完成** | W1 Host 未来计划修订已验收；余项为暂停/取消/恢复、压缩/重组、交接、完整授权变更、证据/完成、并行结果核对与人用入口 | R4d 控制、R4e 维护、R4p 并行、R3c 计划修订、R3d 正式采用、**R3e 证据/检查/完成**、R5/R6 | W1 不关闭 D/R3c，也不实现 Agent 自动推进；控制/完成协议在 A/B 阶段就有位置，独立 Evidence、正式结构、薄 UI 可并行建设。R3g 记忆和知识库留后续，不作为本批完成前置 |

编号仍用于追踪旧计划和验收证据，A/B/C/D 是产品路径组织，二者不建立一对一串行闸门。R1/R2 已迁组件不重做，R2 尾项按实际消费者关闭；R3/R4 的部分完成不缩减 R5/R6 或双图产品义务。

**后续B/R4扩展入口：**原[AgentRuntime §7.1](modules/core/agent-runtime.md#71-b-下一批的接线冻结与验证要求2026-09-25)与[WorkGraph §6.3](modules/core/work-graph.md#63-多驱动者的实际进入边界)中的Task运行接线已由B2/C2消费；Query/控制/恢复继续按新批次冻结，不重新派发已完成prepare/start。固定身份、真实历史与同代次释放约束保持。

**B的复用约束：**原observed-model-run与Kernel继续是唯一模型循环；C2已透传可信Skills/systemInstruction，显式空不回落，平台工具按实际manifest过滤，文件授权保持独立。新增Query/控制消费者复用现有Role/材料/来源原语，不建立SkillManager或第二引擎。

**C 的具体复用约束：**旧 Mailbox/协调链依赖 WorkContextBinding、WorkParticipation、AgentInstance，next 没有对应生产写入者；[`mailbox-view.ts`](../../coding-platform/src/control/control-engine/coordination/mailbox-view.ts)还用最多 200×1,000 条事件的扫描收集邮箱引用。当前 C 采用已有 SessionRef 定向寻址、WorkGraph 持久消息/回复与 RecordStore 注册索引查询；Task/Run/模块为可选上下文引用，不伪造 `workId = sessionId`，不恢复永久 Agent 主体来迁就旧接口。旧代码只提取适用的纯归约/校验，不接回旧服务或照搬全事件扫描。定向持久消息与送入 Kernel 分开，消息受理不冒充已执行/已答复。

每批顺序保持：**Astra 架构/接口 → DSH 骨架与测试 → Astra 中间审阅冻结 → DSH 实现 → Astra 独立审阅 → 物理隔离测试**。中间审阅确认正式写入者、实际消费者、已存在能力的复用，以及拒绝/缺能力路径；骨架/测试不合格不得开始实现。共享契约、schema、组合根和跨模块验收由集成负责人维护。DSH 只读现有文档/源码路径，窄写当批 scope，不新增另一套施工包。

### 0.4 跨模块验收状态

这些 AT 编号来自对齐稿，与早先状态机 A1–A12 **不是同一套编号**。**AT-06 的空闲 Session 归档子场景已通过；包含实际执行后 Task/Run 证据的完整场景仍待 B 补验。B1/W1 只增补 AT-01/11/13 的组件或 Host 子场景，三项继续 partial。** 前序620/719项及本次726项不能自动覆盖未接通消费者，新批只更新它实际证明的范围。

| 目标 | 状态 | 已有可复用证据 | 仍需贯通与对应工作包 |
| --- | --- | --- | --- |
| AT-01 角色创建与挂靠 | partial | RoleSpec；A1 真实 Session 创建与 Module/Task 关联；B1 受信 Skill 配置进入真实请求 | 正式 Role pin→Skill/工具/图引用装配及执行消费者，B |
| AT-02 真实执行自动回写 | partial | WG12 可写、RT8 可读原区间 | Kernel entry/观察自动调用 writer，B |
| AT-03 结束转待命仍可见 | partial | A1 模块下可发现闲置 Session，归档/重新启用联动 | 真实终态→释放→模块下仍可查；不宣布任务完成，B/D |
| AT-04 沿模块咨询待命者 | partial | AG1 发现/发送、AG2a 显式处理→原 Session→正式 Answer 回复 | 原发信 Agent 感知答复并恢复决策；完整自动协作仍待接，B/C |
| AT-05 咨询工作中目标 | 未全路径验收 | 同 Session 占用已有 | 持久查询不打断；消息异步/独立调查实际路径，B/C |
| AT-06 显式归档保留历史 | **partial；A1 子场景通过** | 真实 SQLite/Kernel：空闲 Session 归档退出活跃发现，模块关联、身份和已有 Session 历史保留，重启后可读且不自动启用；显式重新启用及原请求重放也已核对，见[A1报告](reviews/next-a1-graph-session-2026-09-25.md) | B 接真实执行后，补验旧 Task/Run 及其执行证据仍可沿图查询；不据 A1 关闭完整 AT-06、控制/释放、业务角色/UI 或整个生命周期 |
| AT-07 控制与交接 | 未全路径验收 | Kernel 公共能力和保留约束测试 | 平台真实控制/恢复、义务与来源交接，D |
| AT-08 连续与独立工作 | partial | RT3 连续历史组件、Task/Session Claim；A1 同模块多 Session 合法 | 两图选择依据→实际续用或独立 Session 并行，B/C |
| AT-09 压缩与重组 | 未全路径验收 | capability 明示 unsupported | 真实支持才调用；图引用局部交接与历史保留，D |
| AT-10 编排与解释 | 未全路径验收 | A1 正式图/Session 查询与 Role 原语 | Skill+真实工具调查/咨询/派发/解释，C；不把 JSON 合法当角色效果 |
| AT-11 重试与中断 | partial | Store/Claim/历史 writer 幂等；A1 重启重放；W1 同身份并发回执复查及后续修订/重启后原回执保留 | 真实执行未知窗口、消息/控制重复受理，B/C/D |
| AT-12 有限记忆与知识边界 | 后续范围，非本批门禁 | RoleSpec 已版本化；不证明 Memory 已有 | 保留接入位置与来源原则；用户本轮明确记忆/知识库不作为生命周期、角色装配或白板交付的前置 |
| AT-13 图变化与并行 | partial | observed 图、影响/比较、Task 关系；A1 关联维护；W1 运行事实保留时编辑未来任务、局部领取竞争、跨版历史读取 | Agent 白板工具与自动推进、实际源码变更核对和成果保留；提示边不变全局锁，C/D |
| AT-14 性能与人用可见性 | partial | Kernel 原区间读取有界；A1 真实组合根目标查询与状态读取 | 整条查询/装配/咨询的读取与调用量；真实 Host/CLI/UI 状态与控制入口，B–D/R6 |

首个跨包目标是“创建并挂靠模块 → 执行 → 待命可查 → 另一 Session 沿图咨询并取来源 → 归档后只退出活跃发现”。A 的局部验收不能标整条目标 PASS，B 的一次模型返回也不能代替其余路径。每批至少提供可运行组合根调用示例或薄入口，供人核对实际接口，而非只展示测试种子。

## 1. 当前交付与实施边界

| 工作 | 状态 | 可核查结果 |
| --- | --- | --- |
| 核心数据结构与操作 | 已完成设计 | D1–D8 的身份、专用结构、操作、约束、失败、增量更新与实现归属 |
| 编排状态机 | 已完成设计 | Goal/Plan、Task、Session/Run、检查、消息的组合状态与 A1–A12 验收场景 |
| 模块划分、依赖、旧代码去向 | 已完成设计 | 5 个目标模块、8 条允许依赖；M01–M13 逐项移交和删除条件 |
| 无对话记忆交接及文件级骨架 | 系统方向已设计，实际接缝按批冻结 | [HANDOFF](HANDOFF.md)、用户原话/草图、五模块内部文件/主要Port、共同契约、算法/事务/恢复、Host/UI接线；不能把全部蓝图当成已编译接口，本节 0 列完整生命周期和产品路径缺口 |
| 原工程架构读取去重 | 历史已实现并验证 | 同次完整架构读取只分析一次，保留来源验证；R2a 后位于 WorkspaceTools 目录 |
| 原工程冻结捕获与真实架构读取 | 历史 R2b/R2c 已验收 | 一份冻结来源复用查询/图映射、真实主体与根重核、有界registry/游标/资源清理；模型新协议R2d.1已验收，Work/explore/Reviewer与Query生产装配R2d.2/3均已验收；R2e.1文本读取/比较已通过[独立验收](reviews/R2e-1-sol-dsh-acceptance.md)，R2e后续能力尚未完成 |
| next 源码与目标调用者 | 迁入子集已验收，完整平台未完成 | 五目录存在，Workspace/Goal/material/body/Store 已迁入；R3c reader/index 子项已验收；正式B2 Runtime/C2工具消费者已接，Workflow已有Plan的advanceWork推进已实现，handleGoalInput已接初始规划采用，R6初始Host/UI已独审导入；旧产品接线验收见[R3b历史记录](reviews/R3b-sol-dsh-acceptance.md) |
| A1 正式图与 Session 生命周期子路径 | 已独立验收 | 正式 catalog 初始化、Module/Task 关联维护、按目标发现、归档/重新启用与重启历史保持；75文件/719项及构建/边界/编译入口通过，[报告](reviews/next-a1-graph-session-2026-09-25.md)。不宣布 A/R3d/R4b 全部完成 |
| B1 装配组件与 W1 Host 未来计划修订 | 已独立验收 | 78文件/726项、typecheck/build/边界/Kernel补丁再现/编译入口通过，旧8,827文件零变化；见[本批报告](reviews/next-b1-w1-2026-09-25.md)。不宣布正式 Runtime/Role 或 Agent 自动推进完成 |
| R4a Kernel 公共扩展 | 历史已实现并通过返修验收 | 精确身份重放与暂停恢复约束见[R4a 历史验收](reviews/R3a-R4a-sol-dsh-acceptance.md)；当时未接的平台 Session 子集现已在 next 交付，当前执行/控制与范围并行余项见 §0 |
| 正式 Session 目录、真实连续执行与 UI 联动 | 目录/历史/Task领取/精确执行读及 A1 图关联、归档已接通；执行与UI未闭环 | 当前能力见[能力索引](IMPLEMENTED-CAPABILITIES.md)，真实Kernel驱动、结果归约/释放、咨询及人用入口继续按 B/C/D 接线 |

原工程上一批代码改动与验证见[实施证据](reviews/core-design-implementation-evidence.md)；本次详细设计的检查见[骨架交接核对](reviews/skeleton-handoff-review.md)。旧架构、旧 DAG 和旧模块全文已[按原内容归档](archive/2026-09-23-before-core-design/README.md)，历史评审保留其对应版本。详细设计后原工程曾按 dsh 批次实施，[原验收记录](reviews/implementation-batches.md)保留历史；next 当前施工以[执行计划](refactor-plan.md)及[新工程报告](reviews/next-completed-migration-2026-09-24.md)为准。旧文档仓保持兼容来源；R3a/R4a在[2026-09-23首轮验收](reviews/R3a-R4a-independent-acceptance.md)失败后，已完成Sol骨架/测试与dsh返修，并通过[2026-09-24独立验收](reviews/R3a-R4a-sol-dsh-acceptance.md)。R3/R4仅部分完成，平台连续Session与范围并行仍待接线。

## 2. 重构的单位与顺序

每批在 next 中以一条真实调用路径为单位：核对旧行为→提取必要实现和契约→接目标消费者→独立验证→移除 next 内临时旧依赖。旧产品保持可运行的参考状态，切换新 Workflow/UI 后才退役旧目录；不能把整套旧业务模块包在 next 门面下面，也不要求每个新切片重新接回旧 Host。

职责归属以[迁移表 M01–M13](modules/ownership-map.md)为准；其中旧入口只作对照，目标实现路径均在 next。下表保留原工程历史通过结果作为参考，next 结果单独见最新报告；其余描述为新工程能力与接线阶段，编号不代表所有内部实现必须串行。公开契约及边界用例先经P0编译冻结，独立内部实现按[并行开发图](PARALLEL-COLLABORATION.md)推进；共享文件明确集成者，不重新悬置已确定的业务边界。

| 批次 | 具体改动与复用位置 | 真实入口／旧路径退出 | 验收与状态 |
| --- | --- | --- | --- |
| R0 设计收敛 | 明确八类结构、原子操作、状态和五个模块；旧页改迁移导航 | Prompt 2/3/4 的旧方案停止作为当前目标；源码事实仍单独记录 | 文档与目标 DAG 检查；已完成 |
| R0b 详细骨架与交接 | 归档原始对话/草图、逐项映射用户意图；五模块关键文件、完整主要Port、共同身份、事务/算法/恢复、Host/UI贯通 | [骨架总览](skeleton/README.md)及模块页成为后续施工依据；不再仅凭模块名称临场补设计 | 链接、类型/调用关系、旧代码归属、5/8 DAG和原稿完整性检查；设计完成。“代码未迁移”是 R0b 当时状态，next 当前已交付范围见 §0 与能力索引 |
| R1 架构材料读取 | `workspace-reader/project-source-index.ts` 提取一次 `inspect`；完整架构读取不反复调用展示分页 | `ProjectArchitectureSourceReader → captureArchitectureSource → architectureMaterials` 已切换；公开 `query` 继续消费共同实现 | 401 条导入的捕获 6→2、关系提取 3→1；并发来源、失效、失败、取消与容量测试；已完成 |
| R2 工作区能力归并 | 将 WorkspaceReader 的文件/Git/来源/AST/路径实现迁入 WorkspaceTools；复用现有 Language Service；共享路径校验从真实消费者逐处迁移 | next 源码捕获、只读探索和运行工具使用共同实现；旧导出继续服务原产品，最终切换后删除旧目录 | 路径拒绝规则、解析覆盖、unresolved 与快照验证不变；实际所有权和 import 检查同步更新；R2a/R2b/R2c已验收；R2d.1模型协议已验收，R2d.2 Work/explore/Reviewer已验收，Query R2d.3已验收；R2e.1文本读取/比较已通过[独立验收](reviews/R2e-1-sol-dsh-acceptance.md)，R2e.2 Git固定commit读取/比较及git↔working_tree普通文本比较已独审合入；mixed binary/Git-capture、写版本、语言及GUI Host等其余收口待实施 |
| R3 工作结构与持久化分离 | 将 Ledger/Vault 的物理存储迁 RecordStore，领域判据迁 WorkGraph；Control/Index/Reconciler 的同义规则合并到任务、架构、证据等内部组件 | 查询和受理共享领域规则；提交仍做同事务版本核对；完成普通 host 查询/材料访问，不虚构 Run；旧 Context 普通读消费者切换 | **原工程历史部分完成**：R3a Goal子集与旧库重放通过[独立验收](reviews/R3a-R4a-sol-dsh-acceptance.md)；R3b 正文与材料规则及 History Host / 真实 Run 接线通过[历史验收](reviews/R3b-sol-dsh-acceptance.md)，当时 legacy reader 两条临时注入待收口。**next 当前子集**见能力索引，W1 已交付 Host 未来计划修订与跨版状态/历史读取；完整授权变更、Agent 工具与其他领域仍未关闭 |
| R4 Session 与执行闭环 | 先实现[Runtime骨架](modules/core/agent-runtime.md)规定的最小Kernel公开扩展：历史Context、稳定run/turn身份与控制hook；目标稳定workspace存储，旧per-Run locator保留。WorkGraph新增Session/关联和执行/维护同槽占用；Runtime复用现有outbox和恢复 | 查询候选→选择→创建/打开→领取→真正继承历史的新轮执行→结果归约；普通Run/QueryRun都受占用约束；禁止平台再做一套历史Context选择 | **next 已完成子集**：Session 创建/目录/原历史、Task Claim 与 Session 原子占用、执行事实与图定位历史、A1 关联/发现/显式归档重新启用，以及 B1 Skill/Hook/惰性来源组件；见 §0 和[最新验收](reviews/next-b1-w1-2026-09-25.md)。正式执行/观察归约与释放、Query、控制恢复、重组和范围并行整合仍待后续子批。创建不启动模型、unknown 不重复执行，native compact 保持 unsupported |
| R5 业务编排迁移 | HumanCollaboration/PlanCompiler 的产品流程和 Session 选择进 Workflow；检查/返工策略与正式证据汇合分离；普通/Reviewer/Handoff 共用执行驱动 | 所有真实规划、执行、检查和换手入口迁移；Context 的需求选择/材料读取/Kernel 格式分别归三处，删除旧总门面 | A3/A5/A6/A10/A11；已有Plan的两work同Session→checks→独立gate→Goal完成已由R5c.1接通；handleGoalInput/初始规划已接，复杂协调与其余Host消费者继续；R6限定一键执行链已接通。人工授权按已有范围继承，只在真正新增取舍时提出具体问题 |
| R6 UI 与最后退役 | 工作台连接架构/任务/Session/消息及历史定位；展示控制请求与实际状态、来源/版本/缺口；清除剩余兼容导出 | 图可定位文件、历史结果和关联 Session；普通事实读不触发模型；旧消费者清零；最终 source map 收敛目标 | R6初始工作台、Session/mailbox、三栏布局及调查/规划一键执行均已独审导入，限定链经真实CUA到正式Goal COMPLETED；Task→当前Run/原Session/历史消费者已最终导入并完成真实浏览器验收，A12完整图/控制UI及最终切换仍待实施，保持目标/现状模块图、代码与跳转对照 |

R2–R5 每批只修改 next 中有关接口、实现和装配，核对 `next/scripts/check-boundaries.mjs`、独立构建/测试和真实注入来源；不再更新旧产品 map 来驱动新工程施工。`module-target.json` 表示目标 5/8，已有五目录也不等于所有契约已实现。旧业务消费者和删除时点在最终切换清单中登记，不以仍运行的旧产品阻塞新核心独立实现。

## 3. 必须在接口与存储层落实的变化

| 变化 | 具体实施决策 | 兼容方式 |
| --- | --- | --- |
| 普通材料读取无需 Run | 按核心文档 §2.2 引入由 Host 注入的 `MaterialReader` 与 `PlatformMaterialOrigin`，区分 human/system 操作与真实 run；领域范围和来源核对在 WorkGraph，正文 I/O 在 RecordStore | next 直接使用目标材料 Port，不引入旧 ArtifactPort 业务代理；不造假 Run、不接受模型自报身份；旧读者随产品切换退出 |
| Session 身份独立于 Run | 新增正式平台 SessionRef、Kernel adapter/store ID 映射和可恢复操作记录；TaskRef 仅为现有 TaskTriple 别名；Run/TaskAttempt 引用不重编码 | 旧 Run 无法核对映射时显示未映射；不按 Run ID 猜测历史 Session；可确认的实际记录才回填 |
| 连续Context与稳定Kernel存储 | Kernel新增可选session_history方式，在内部拼装已完成turn历史、核算预算和保存恢复依据；新轮稳定run/turn身份，adapterId定位真实存储实例 | 旧调用默认current_turn，旧checkpoint/per-Run数据库仍可读；扩展和真实接线完成前capability不得宣称已支持连续执行 |
| 同工作区范围并行 | 用户已明确必须支持；已有图/路径工具提供低成本结构提示和实际结果检查，Agent决定/修正分工；只在具体工具操作落实适用权限、版本或共享副作用约束 | 不设全工作区单writer、不要求每次领取完整未来范围或通用ResourceReservation；不同Session并行，同Session占用仍原子。未知执行不得仅因到期腾出；实际冲突局部协调并保留独立成果 |
| 同Session占用 | ExecutionRef为RunRef/QueryRunRef联合；SessionOccupancy统一execution和maintenance，原子占用与相同owner/generation释放 | QueryRun不伪造Task；此前currentClaim/lastRunRef仅为未实施草案，不制造不存在的旧Session表迁移 |
| 冻结捕获与长期材料 | Workspace返回SourceCaptureRef和冻结内容；WorkGraph保存后建立PersistedSourceCaptureRef | 不让Workspace依赖RecordStore；进程重启使临时handle失效，历史Artifact仍可读；当前性单独verify |
| 创建与领取分开 | 创建意图受理→Kernel 创建→登记映射；已有 Session 才可原子领取并启动；创建本身没有模型执行 | 复用已有领取/启动幂等身份，不在 continue 中再领取一次；未用 Session 可保持闲置 |
| 图与任务原子操作 | 各结构使用专用索引，领域操作统一维护必须同时变化的关联；投影异步刷新公开水位 | next 按需复用原 SQLite 编码与事件格式；需要新字段时显式版本化、迁移和回滚，不通过旧 Ledger 实现代理操作 |
| 原始 Session 历史 | WorkGraph 只返回平台关系与来源；AgentRuntime 提供 Kernel Store 原历史只读访问 | 不要求 Run 或 LLM，不复制全部原日志；能力不支持时明确返回，不能用摘要冒充原记录 |
| 运行控制与恢复 | 正式期望由 WorkGraph 保存，AgentRuntime 执行并回报实际观察；暂停/恢复/压缩使用真实 adapter 能力 | 保留迟到响应防护和 unknown；禁止把新 Session 接续宣称原 Session 恢复 |
| 上下文操作拆分 | Workflow 决定材料需求；WorkGraph 精确引用/关系查询和有界整理；AgentRuntime 适配 Kernel 输入、读取原会话历史 | 以原 ContextCompiler 六类消费者作行为清单，在 next 按职责实现；普通事实读不进入模型准备链；旧实现待最终产品切换后删除 |

以上是必要的接口演进，不由“CRUD”四个字隐去业务约束。主要接口已在[共同契约](skeleton/CONTRACTS.md)和五篇模块页给出；它们是目标详细设计，公开面仍须经过P0编译闭合，本轮并行审阅的协议补充见[PARALLEL-COLLABORATION](PARALLEL-COLLABORATION.md)；实现时将文档类型转为源码契约并接真实调用者，不重新悬置这些决定，不得用宽泛`object`或万能命令省掉关键输入/结果。

## 4. 性能与代码精简的实施依据

| 路径 | 原工程已核实的成本 / 未实现项 | 目标处理／核查方式 |
| --- | --- | --- |
| 同次完整架构读取 | 展示分页曾重复捕获、摘要与关系遍历；TS Language Service 已复用未变脚本 | R1 已移除分页造成的重复工作；保留初始捕获与最终验证。不是声称解析器每页重建或端到端提速三倍 |
| 公开项目索引分次分页 | 当前每次请求仍核验来源 | 后续使用有身份/版本/授权范围和有效期的 capture/cursor；只在能检测失效与限制保留成本时复用，不以永久缓存掩盖变化 |
| 任务资格查询与领取 | 原工程 `task-eligibility.ts` 曾有任务/依赖数组重复查找；next 已有关系查询与正式 Claim | 复用邻接/精确状态/关联索引；只有实际消费的明确产物条件在需要该输入时检查，不恢复“前驱整项完成”的统一门槛。Task/Session正式占用和版本核对保持原子，不以预期影响做全图证明 |
| 新 Run 输入准备 | 当前 `runtime-context.ts` 按已绑定且显式选择/截断的材料重新组装；不是每轮读取全部历史 | 相同 Session 连续工作增量输入；复用有效来源，变更时更新；对照实际正文读取与输入字节/token |
| 平台运行记录 | 平台 `RuntimeRecord` 累计 JSON 重写，与 Kernel 原日志不同 | 先拆最小运行状态、增量平台事件和必要摘要，保留旧记录读取；按相同事件序列对比写入字节与查询复杂度 |
| 候选 Session 查询 | 完整选择器尚未实现；不能说已有代码每次扫描全部 transcript | 用任务/模块关联与可用性索引选候选，必要时再取有界历史，避免未来引入此重复路径 |

必要重读与无效重复按目的区分：同次分页不该重复分析；执行前来源/权限变化核对有正确时点。去重通过可复用的捕获和来源版本实现，不依赖删除核对来获得数字。

代码验收直接对照：真实主路径调用跳转、同义规则副本、已删除旧实现、生产代码净行数、关键函数承担职责及 UI 操作结果。R1 生产代码净增加 4 行，收益是重复工作减少；不能把它写成全仓代码已精简。独立迁移期间须区分 next 的源码量与保留的旧参考产品；next 若只增加旧业务代理不算干净迁移，整体精简须等最终切换和退役证据。端到端延迟、模型金额等仅在确实测量时报告。

## 5. 完成条件

1. D1–D8 的必要结构和操作由真实实现承载；未实现的长期知识能力仍明确标为扩展方向。
2. 状态机 A1–A12 由相关测试和真实装配覆盖，普通读取、消息、连续工作不付完整规划/审核链成本。
3. 新 Workflow/UI 完成切换，旧模块 M01–M13 的产品消费者全部退出后删除旧目录；next 不调用旧业务实现，不保留两套正式状态写者、无期限兼容门面或重复 Kernel 日志。
4. 实际源码归属、允许依赖、目标 DAG 一致；类型、相关行为和边界检查通过。
5. UI 体现架构与任务的当前/历史、Session 工作关联和真实控制状态；读写来源与缺口可解释。
6. 代码可读性、旧实现删除量与核心路径工作量有前后证据；未测量收益不写为已达成。
7. 本文 AT-01–14 逐项有真实消费者和相应范围的验收依据：双图上的工作者、角色装配、生命周期、通信与组织行为必须共同交付。组件通过、一次 Run 结束、只有薄查看工具均不能代替完整用户路径；未实现知识库保持明确边界。

设计已完成和首个实现已通过验证，均不替代上述整体完成条件。后续实现使用本方案和新文档链，旧 Prompt 的固定模块清单、逐层包装与全量准备前提不再沿用。
