# 无对话记忆的 Agent 接手说明

**最新独立仓库验收：124 文件 / 1,102 项通过（exit0）。** 本次包含最终 graph/history UI 和独立目录构建脚本；Kernel 补丁再生、边界、Node/UI 类型、构建、编译入口和受 token 保护的 Host smoke 均通过。[独立验收记录](reviews/evidence/standalone-2026-09-27/verification.json)。完整 MVP 行为审计仍未执行；下方较早报告保留其当时范围。

> 独立仓库说明（2026-09-27）：本仓库根即原 `coding-platform/next`，文档位于 `docs/`；当前继续入口见根 `CONTINUE.md` 与 `AGENTS.md`。旧证据、任务书中的绝对路径和 scope 只描述当时工作区，不能直接执行。用户已要求冻结保存，尚未宣告整个 MVP 完成。

**当前状态（2026-09-27）：按用户要求冻结施工并保存 next 与文档，准备独立 main 提交和继续入口；不启动新批次。** A1 仅 prepare、未 run，已停止；Work-control 保持已预审草稿，R3g 未派发。R6 graph/history 已[精确导入](reviews/evidence/next-b2-2026-09-26/r6-graph-history-consumer-implementation-import.json)，固定22项、Node/UI types及构建通过，[最终只读浏览器复验](reviews/evidence/next-b2-2026-09-26/r6-graph-history-browser-final.json)通过；不宣告完整MVP完成。恢复施工须先按本页继续入口核对既定产品范围与现有证据。

更新：2026-09-27。默认施工本独立仓库根，原工程保留只读。已确认产品范围仍是当前五模块、真实消费者及Host/UI；本轮最新指令优先，先冻结保存，后续收到继续指令再施工。

**提取前完整隔离基线：124 文件 / 1,102 项通过（exit0）。** 该副本包含R4.3b与R6执行入口最终导入，以及[W2一行机械调用次数断言删除](reviews/evidence/next-b2-2026-09-26/r4-r6-w2-fixture-amendment.json)；Node/UI types、构建、7/8边界、7源/28产物逐字再生、编译composition与真实token保护Host smoke均通过。见[结果](reviews/evidence/next-b2-2026-09-26/r4-r6-isolated-result.json)、[通过日志](reviews/evidence/next-b2-2026-09-26/r4-r6-isolated-recheck.log)及保留的[首次失败日志](reviews/evidence/next-b2-2026-09-26/r4-r6-isolated-final.log)。快照不含其后的graph/history骨架与实现，不能据此证明当前全部源码整体通过；本轮未重做旧8,827文件全hash比较，不沿用旧快照结论。

**冻结前施工落点：** R6调查/规划执行入口与R4.3a/R4.3b已导入，Task→当前Run/原Session/历史消费者已完成最终复验及精确导入；不启动新的Work-control、A1或R3g施工。新增代码统计保留为后续定位依据。[统计已完成](reviews/evidence/next-b2-2026-09-26/new-code-inventory-20260926.md)：按完整哈希恢复的B1/W1基线，src TS由30,464行增至60,612行，净+30,148，WorkGraph占净增长60%。这是2026-09-26 15:23 UTC快照，未含当时未导入R4/R6候选，不据行数直接裁定冗余；接线优先，后续按具体增长项确定审查，详见[本轮要求](intent/2026-09-24-DSH-HARNESS.md#先接通用户路径并行统计新增代码2026-09-26)。

**当前增量与在途批次：**

- [R4.1持久控制](tasks/R4-control-intent-implementation.md)：三生产文件已[独审导入](reviews/evidence/next-b2-2026-09-26/control-intent-implementation-import.json)。独立7文件50项通过；最终catch修复及eventAt回执读取失败用例为2文件20项、types通过。同identity真实并发与提交失联恢复已修复。公开controls接受/读取queued pause/cancel，四个fresh准入屏障消费Run控制事实；不代表物理pause/cancel、ack或resume。
- [R2e.2 Git固定版本](tasks/R2e-2-git-read-compare-dispatch.md)：八文件骨架已[导入](reviews/evidence/next-b2-2026-09-26/git-read-skeleton-import.json)。git-read.ts单文件实现三项返修短审通过，独立12文件112项及types通过，已[导入](reviews/evidence/next-b2-2026-09-26/git-read-implementation-import.json)。真实child/root handle取消清理、U+FEFF路径身份与B2三轮工具消费/正式终态均通过；支持固定commit读取/比较，mixed普通文本比较已追加独审导入（r2e-mixed-comparison-implementation-import.json）：15项/2文件及types通过，单次有界工作树观察，实际B2双向工具链结束释放；binary/Git-capture、Git写版本和语言扩展仍待完成。
- [R3e.1注册检查](tasks/R3e-completion-implementation.md)：五生产文件完成受限返修并已[独审导入](reviews/evidence/next-b2-2026-09-26/r3e-evidence-implementation-import.json)，含Goal gate真实普通producer分支；固定[3文件/10项](reviews/evidence/next-b2-2026-09-26/r3e-final-tests.log)及[types](reviews/evidence/next-b2-2026-09-26/r3e-final-types.log)通过。原回执、局部读集、当前来源适用性、执行根与晚取消事实收尾已修复。注册检查/Evidence子链已接通，不代表Task/Goal完成或Reviewer已交付。
- [R5b Query执行](tasks/R5b-query-execution-implementation.md)：pending受理与十九文件骨架后，八生产范围（七改变）完成[独审导入](reviews/evidence/next-b2-2026-09-26/r5b-query-execution-implementation-import.json)。固定4文件/13项及types通过；公开无Plan Goal→Query→真实Session claim→有界prepare→原Kernel readonly源码工具/模型轮次→持久Answer/Job/Run→同generation释放、原回执及SQLite重开已经贯通。一次有界返修落实原expected/请求指纹与回执恢复、新动作当前占用、完整scope/初次Role、manifest有效预算及原输入来源pins；不增加运行中换Role防御。Answer→初始Plan已由后续消费者批次贯通；外部材料grant、多轮/高级恢复继续；本轮限定Host执行消费者已由R6接通。
- [R6.1a Host工作台](tasks/R6-host-workbench-implementation.md)：六生产实现及最终三项UI修正已[独审导入](reviews/evidence/next-b2-2026-09-26/r6-host-workbench-implementation-import.json)，固定[2文件/15项](reviews/evidence/next-b2-2026-09-26/r6-final-host-tests.log)、Node/UI types与构建通过。修正前真实浏览器已走空库初始化→Plan→采用/观察结构与任务图、文件分页/捕获版本读取、第二scope无策略Goal与原请求replay；最终修正核实异步响应写原scope、文本失焦不全页重绘及技术详情折叠。最终版本同SQLite无review配置[HTTP重开](reviews/evidence/next-b2-2026-09-26/r6-reopen-http.json)可读Goal/TaskGraph；最终[真实浏览器复验](reviews/evidence/next-b2-2026-09-26/r6-final-browser.json)及[截图](reviews/evidence/next-b2-2026-09-26/r6-final-browser.png)已完成：现成Chromium Headless保留原sandbox、临时独立profile，经原生DevTools输入连接真实Host/SQLite；Goal ID输入后Tab保留下一框焦点，无review重开可读Goal/TaskGraph，capture响应延迟700ms时切B不受A响应污染，切回A已capture ready。 本轮main核心/Host集成[13文件47项串行通过](reviews/evidence/next-b2-2026-09-26/cohort-core-host-integration-tests-serial.log)，[types](reviews/evidence/next-b2-2026-09-26/cohort-core-host-integration-types.log)及[7/8允许边界](reviews/evidence/next-b2-2026-09-26/cohort-core-host-integration-architecture.log)通过；[首轮并发超时日志](reviews/evidence/next-b2-2026-09-26/cohort-core-host-integration-tests.log)保留。该专项是当时的局部结果；最近完整隔离范围见顶部124文件/1,102项快照；Session/mailbox后续交付见下。
- [R3e.3正式Task/Goal完成](tasks/R3e-task-goal-completion-implementation.md)：五生产实现已[独审导入](reviews/evidence/next-b2-2026-09-26/r3e-completion-implementation-import.json)，最终2文件/3项及types通过；一次纯policy修复保留optional已有真实Run/Lease的活动副作用阻塞，无执行的optional意图仍不阻塞。公开普通work与独立Goal gate检查→completeTask→completeGoal→TaskGraph→SQLite重开/原回执已接通；Reviewer生产、正式重开/supersession和完整Workflow仍未交付。
- [R5c.1 Workflow](tasks/R5-workflow-advancement-implementation.md)：原七文件骨架后，workflow.ts实现已[独审导入](reviews/evidence/next-b2-2026-09-26/r5c-workflow-implementation-import.json)，独立2文件/3项及types通过。真实已有Plan→两个普通work复用同Session的新Kernel Turn→实际checks→工作完成→独立Goal gate→正式Goal COMPLETED已接通，optional future仍保留；每次有限owner调用沿原完整请求/回执，无第二状态库。后续initial-plan批次已实现`handleGoalInput`与初始采用；复杂调度/Reviewer及其余Host消费者继续；限定一键执行链见R6。

- [R6.1b Session/mailbox](tasks/R6-session-mailbox-implementation.md)：四生产实现已[独审导入](reviews/evidence/next-b2-2026-09-26/r6-session-mailbox-implementation-import.json)，原2文件/17项、Node/UI types及最终物理构建通过。实际浏览器从空库创建两个Session、Host发信/正文/原历史读取，并在无review配置的同SQLite/Kernel重开后保留；读取仍pending。发送后继捕获原scope/recipient、新草稿保留，以及[切Session正文归属](reviews/evidence/next-b2-2026-09-26/r6-session-selection-repair-import.json)已修正，最终[浏览器复验](reviews/evidence/next-b2-2026-09-26/r6-session-browser.json)通过。Query/Workflow执行与布局已由后续批次接通；材料/完整控制与其余UI范围继续，不将本批当完整R6。

- [R5b初始Plan消费者](tasks/R5b-initial-plan-implementation.md)：12路径骨架后四算法已[独审导入](reviews/evidence/next-b2-2026-09-26/r5b-initial-plan-implementation-import.json)，固定6文件/10项、types及architecture/import通过。真实Query Answer→候选→采用→原Workflow→正式Goal COMPLETED贯通，optional未来意图保留；原请求完整指纹/回执优先及共同提交局部guards已收敛。原同case仅将source与SQLite/Kernel存储目录分开，避免检查读取自己的数据库写入；没有扩大测试矩阵。Host限定执行入口已由R6接通，见下方当前批次。
- [R6 UI布局与已有事实](tasks/R6-ui-layout-implementation.md)：四生产实现已[独审导入](reviews/evidence/next-b2-2026-09-26/r6-ui-layout-implementation-import.json)，19项、Node/UI types与物理构建通过。三栏/页签、目录与文件页分离、对话与文件草稿及按需展开完整原始历史已接已有真实事实。三文件[浏览器窄修](reviews/evidence/next-b2-2026-09-26/r6-ui-browser-repair-import.json)已导入；[最终真实浏览器](reviews/evidence/next-b2-2026-09-26/r6-layout-final-browser.json)确认同层分列、单击详情/双击及右键固定、拖宽/放大恢复、文件草稿/选区引用与完整原文展开；1440×960外页稳定。完整图关联及最终视觉整理后续接续。原新增历史测试已按用户纠偏撤销永久字段过滤；不加测试矩阵，不宣称完整R6完成。

- [R3d目录修订与明确包含](tasks/R3d-architecture-evolution-implementation.md)：五路径骨架后catalog-service单文件实现已[独审导入](reviews/evidence/next-b2-2026-09-26/r3d-architecture-evolution-implementation-import.json)，固定2文件/33项及types通过；局部同请求竞争恢复收敛。真实初始目录→新增Module/显式包含→新current/旧history→Session关联新Module→SQLite重开/原回执贯通。包含与依赖独立，旧无包含关系仍为unknown，不反推树；完整decision/gate治理及UI包含消费者继续。

R4.3a 八生产控制投递/观察已[独审导入](reviews/evidence/next-b2-2026-09-26/r4-control-runtime-implementation-import.json)，R4.3b 六生产取消历史消费者也已[精确导入](reviews/evidence/next-b2-2026-09-26/r4-terminal-history-implementation-import.json)：固定15项、types与28产物再生通过。共享 `projectTerminalTranscript` 仅在副本省略没有结果的 abandoned 声明及过滤后全空消息壳，原历史、已有推理和实际结果保留；真实取消释放后，同 Session 第二个正式 Task 经 claim→prepare→start 消费前缀已通过。未知结果仍不释放，fresh resume/冷恢复及完整控制 UI 仍属后续范围。

R6 调查/规划执行入口六生产实现已[最终导入](reviews/evidence/next-b2-2026-09-26/r6-execution-entry-implementation-import.json)，固定22项、Node/UI types与物理构建通过；[最终真实 CUA 浏览器验收](reviews/evidence/next-b2-2026-09-26/r6-execution-entry-browser-final.json)一键贯通 Query→Answer→初始 Plan 采用→两个 Work→实际 checks/独立 Goal gate→正式 Goal COMPLETED。完整回答默认收起且可主动展开，任务图直接显示原 `TaskGraph.completion`，optional 无验收未来节点继续保留。该链使用原受控4回复及真实 Host/Runtime/Kernel/SQLite，不代表外部真实模型网络、完整 MVP/UI 或全生命周期已验收。

[Task本次执行到原Session/历史](tasks/R6-graph-history-consumer-implementation.md)的两UI实现及辅助历史重复渲染窄修已[精确导入](reviews/evidence/next-b2-2026-09-26/r6-graph-history-consumer-implementation-import.json)，[固定22项、Node/UI types与构建通过](reviews/evidence/next-b2-2026-09-26/r6-graph-history-browser-repair-review.json)。[初轮真实CUA](reviews/evidence/next-b2-2026-09-26/r6-graph-history-browser-initial.json)已核Task→两个不同Run→同一claim Session、各原窗口2–6/7–11、完整Session顺序1–10→11、Run页切回保留、原文默认折叠可展开及中心/辅助分页独立；[最终只读复验](reviews/evidence/next-b2-2026-09-26/r6-graph-history-browser-final.json)确认辅助页仅呈现一次10条原记录，可展开position5实际正文，模型调用0。该消费者只导航当前TaskRow已知Run，不代表全部attempt枚举；本批未纳入上述124文件/1102项完整隔离副本。架构包含UI、文件保存、diff/终端、完整控制/恢复、Reviewer/返工、治理及最终消费者切换继续保留；当前冻结，不启动后续批次。

用户2026-09-26新提供的UI原型已[实际操作核对](reviews/evidence/next-b2-2026-09-26/ui-prototype-next-review.json)：两侧拖宽、节点固定/新页、文件树与编辑页分离、选区路径/行号/草稿快照、切页保留及归档只读均有演示证据。已同步[UI规范](../UI-WORKBENCH.md)，相应UI布局与执行展示已按上述批次导入并通过浏览器验收，继续复用既有真实HTTP事实。架构包含关系、各Task全部attempt/Turn枚举、文件保存、diff/终端与完整执行控制仍按原owner后续接通；当前TaskRun原窗口和完整Session历史已由上述消费者交付。

此前 DNS 恢复时三批仅更换 DSH 会话，不重建 lane、不清空源码，旧会话与恢复前 scope 文件 hash 保留在[网络恢复记录](reviews/evidence/next-b2-2026-09-26/dsh-network-recovery-20260926.json)。已确认此前 fetch `EAI_AGAIN` 来自沙箱 tmpfs `/run` 遮住 `/etc/resolv.conf` 指向的 `/run/systemd/resolve/stub-resolv.conf`：外层 HEAD 可达，沙箱内目标文件缺失。harness 现仅将该实际 resolver 文件只读挂入原隔离 `/run`，沙箱 DNS 已验证成功；这是施工环境恢复，不是三批功能验收完成。

本批证据汇总见[既有审阅](reviews/next-r4-control-git-read-2026-09-26.md)。最近完整隔离为顶部124文件/1,102项的R4.3b/R6执行入口快照，不含后续graph/history骨架与实现，不能据此声称当前全部main源码整体通过。R5a/R4.2实现已STOP并合入，不重做相同能力。R4.3a投递/ack/entered事实已独审导入，R4.3b正常取消历史消费也已导入；R4.4/5恢复/预算、Reviewer/返工、正式治理及其余语言/Host/UI消费者继续；已导入的检查/完成、目录演进和Query子链不重做。

**当前优先级与验收纠偏：**采用[架构设计结论讨论](chatgpt-conversation://6ab761c4-e76c-83ec-af19-0076bd30aa4c)及本轮用户要求的归纳：骨架不带偏、正常公开路径可跑、真实权限和副作用边界正确；禁止仅为更漂亮的覆盖新增返修轮次，邻接只跑实际受影响必要集合，完整E2E优先。保留原两阶段流程与unknown历史事实边界。调度优先证据→正式完成→Workflow，以及Query/Host真实入口；R4.3a八生产实现已独审导入，R4.3b取消历史消费与R6一键执行链已导入；Query受理、R6初始工作台、R3e.3正式完成及Workflow已有Plan推进实现已导入；Query execution与R6 Session/mailbox实现已独审导入，初始Plan消费者已导入，UI布局已完成当前范围浏览器复验，普通控制与高级恢复继续保留。见[质量 §2.1](CODE-QUALITY-GUIDELINES.md#21-校验须与操作后果匹配2026-09-26)。

**最新用户纠正：** 当前没有运行中更换 Session Role 的合法操作。已删除针对内部角色篡改的新增测试、相邻无正常生产者的角色注入及 W2 专用状态改写辅助；没有为其添加生产补丁。后续校验须说明真实公开输入或合法生命周期触发，保留实际材料撤权、所有权及局部 CAS 边界。依据见[意图](intent/INTENT-AND-DECISIONS.md)和[质量规范 §2.1](CODE-QUALITY-GUIDELINES.md#21-校验须与操作后果匹配2026-09-26)。

后续仍包括 Reviewer/返工、R4 控制恢复/维护、正式治理、复杂 Workflow 和 R6 Host/UI、消费者切换与旧目录退出。空存储已有R5a Project/Workspace与CompletionPolicy正式writer；无Plan Query受理、真实Kernel执行及持久answer已接通，answer到初始规划采用与正式Goal完成已贯通，R6受信配置下的人用执行入口已接通；其余初始化缺口不能用测试种子冒充 bootstrap。[R5a任务书](tasks/R5a-project-bootstrap-skeleton.md)已完成实现和完整隔离验收。架构初次采用与 RoleSpec 安装/激活已有，应直接复用；CoordinationPolicy matrix 的正式 writer 仍缺。Memory/知识库非当前硬交付。

后续只读报告见证已形成[窄消费者草稿](tasks/R3e-readonly-report-skeleton.md)，尚未派发：直接读原执行历史与已有来源 witness，在同一 Evidence owner 做机械判定和入账，不模拟命令进程。独立 Reviewer 仍需正式 ReviewWork/结果与材料授权生产者，不能据此一并关闭。排在 R6 execution 与 R3g 的组合窗口之后。

施工顺序：Astra 架构/接口 → DSH 4.1F 骨架/测试 → Astra 中审冻结 → DSH 实现 → 独立审阅/隔离验收 → 更新既有文档并继续。窄写范围与当前快照哈希核对见[执行规范](DSH-EXECUTION-HARNESS.md)。五模块/八条允许依赖、双图白板定位、多 Agent 并行与事实/授权分界沿既定意图，不重新发明另一套引擎或状态库。

历史完整基线保留于[B1/W1（78文件/726项）](reviews/next-b1-w1-2026-09-25.md)、[A1（75文件/719项）](reviews/next-a1-graph-session-2026-09-25.md)与[目标工程迁移](reviews/next-completed-migration-2026-09-24.md)。它们解释当时版本，当前能力先查[能力索引](IMPLEMENTED-CAPABILITIES.md)与真实源码，不把旧 unsupported 描述覆盖新合入结果。

## 1. 用户要什么

用户认为项目应以数据结构和算法为核心：当前/历史Session与当前/历史文件提供数据；架构图、任务图和Agent工作关联组织检索与编排；原子工具维护结构并查询、比较、生成和更改；业务组合工具决定如何推进。工具结果反向维护图与状态，本来就是用户方案的一部分。

重构目的：消除重复扫描、重复材料准备、重复状态和绕行；保持连续工作与真实状态，改善可读性、代码量和UI。不是为模块数更少而合并，也不是把所有业务交给一个主Agent。独立图/数据组件可以有自己的正式结构，不天然变成第二权威；同一正式事实的修改路径需要一致。

具体工作由Session承载，Role/Skill是可复用配置。同一Session不能被执行和维护同时修改，不同Session可并行。状态类型可循环，执行事件向前追加；明确采用的产物消费前置DAG、目标模块DAG、源码观测图和通信图分别表达；预期依赖不是自动启动门槛。

架构图还必须能找到正在工作或待命未归档的 Session/角色，便于咨询与继续相关工作；任务图保留承担过工作的 Session/Run 与来源。归档只退出当前活跃发现，不删除模块、任务或历史。现有 SessionRecord/SessionWorkLink 是首选承载，用户未要求新增永久 Agent 主体。working/standby 的展示来自当前占用及真实执行/健康事实，不能因为有 active/busy 字段就声称模型已经启动，也不能把 Task 完成与 Session 归档绑定。

用户已经授权工程细化，不需要再次询问是否采用这些基本方向。遇到真实的新产品范围或无法由既定要求决定的取舍，才提出具体方案；普通文件划分、接口命名、必要索引和文档同步由实现者承担。

## 2. 原话与决定在哪里

| 要核对什么 | 直接入口 | 怎么使用 |
| --- | --- | --- |
| 各模块现在已有何种原子能力、应该复用哪里 | [IMPLEMENTED-CAPABILITIES](IMPLEMENTED-CAPABILITIES.md) | 先读状态和相关条目，再读链接的接口、实现、消费者及测试；设计稿/组件存在不等于正式执行已接通 |
| 当前要求与已定工程选择 | [INTENT-AND-DECISIONS](intent/INTENT-AND-DECISIONS.md) | 用户意图U01–U16、工程决定E01–E15分开，直接阅读即可 |
| 本轮原始对话、批注与草图 | [ORIGINAL-DIALOGUE](intent/ORIGINAL-DIALOGUE.md)；[原始JSON](intent/original-dialogue.json) | 需要追溯时读对应DLG；助手旧回答可能被后续推翻 |
| 更早的角色/Session/Kernel明确回复 | [用户本次指定的14段原话](../agent-platform-user-replies-numbered.md)；[原归档](../history/before-2026-09-22/agent-platform-user-replies-numbered.md) | 尤其01/03/09/11/12/14：Session承载工作、生命周期必须落地、按双图复用和有限知识边界；原话保留不改 |
| 本轮完整产品路径纠偏 | [双图/生命周期对齐稿](../AGENT-GRAPH-LIFECYCLE-ALIGNMENT-2026-09-25.md)、[实施方案 §0](IMPLEMENTATION-PLAN.md#0-双图agent-与生命周期的完整施工范围) | 对齐稿正文保留外部讨论时旧资料/未独立查 next 的证据边界，头部已补本地 A1 实施结果；当前源码与 AT 以能力索引和实施方案逐项状态为准：AT-06 仅 A1 子场景验收，各项仍 partial/未全路径验收 |
| 产品行为 | [当前 PRODUCT](../PRODUCT.md)、[产品意图审阅](reviews/product-intent-review.md)、[当前意图与决定](intent/INTENT-AND-DECISIONS.md) | 项目状态、两图、人机、连续执行、成本和MVP结果；历史承诺不因移档撤销，已被后续决定替换的描述不重新执行 |
| 新总体架构 | [ARCHITECTURE](ARCHITECTURE.md) | 5模块/8边是本轮推导方案，非既有源码事实 |
| 静态数据结构与状态机图 | [CORE-STRUCTURES-AND-ORCHESTRATION](CORE-STRUCTURES-AND-ORCHESTRATION.md) | 按记录、索引、集合、占用及原子读写理解实现，再沿状态转移理解编排 |
| 详细关键文件与接口 | [骨架总览](skeleton/README.md)与对应模块页 | 每次实现一个模块/路径，直接读相关页，不要求先读完全部历史 |

每次设计、实现和审阅，须共同核对当前 PRODUCT、架构、相关模块和 ORIGINAL-DIALOGUE 中对应用户发言，并结合[并行 / 产品补充原话](intent/2026-09-23-PARALLEL-AND-PRODUCT.md)与[施工分工及最新时序要求](intent/2026-09-24-DSH-HARNESS.md)。不是要求全量加载历史，而是防止某一工程选择悄悄替代用户目标。并行接口、工程缺口与开发依赖见 [PARALLEL-COLLABORATION](PARALLEL-COLLABORATION.md)。

源码事实以当前代码和真实运行核对；目标设计以本轮用户指令及新设计链为准。旧文档仓与归档用于兼容/追溯，不能无视新授权强迫回到旧目标。若新设计与已有产品承诺冲突，记录具体冲突并修正文档或实现，不静默选择有利版本。

## 3. 文档分层与最小阅读包

| 层级 | 内容 | 阅读时机 |
| --- | --- | --- |
| L0 意图 | 本文件＋intent/意图页 | 所有接手者先读 |
| L1 系统骨架 | skeleton/README、总体架构与模块DAG | 理解方向和允许依赖 |
| L2 共同协议 | skeleton/CONTRACTS、CORE-DATA-OPERATIONS、状态机 | 实现跨模块接口和领域变更时按相关章节读取 |
| L3 模块实现骨架 | 五篇模块页 | 具体文件、方法、算法、存储和迁移的直接施工依据 |
| L4 贯通与实施 | skeleton/END-TO-END、IMPLEMENTATION-PLAN | 接Host/UI、统一执行、兼容退役及验证 |
| 历史资料 | 原话JSON/Markdown、archive、历史reviews | 查缘由/差异时使用，不作为默认全量上下文 |

只做Workspace捕获时，读本页、WorkspaceTools模块页、CONTRACTS来源/上下文章节及相关现有源码即可；不必加载所有任务状态机。做Session连续执行时，必须同时读Runtime模块页、WorkGraph的Session/Run小节、共同占用类型和贯通流程；不能只凭“调用createSession”这一行施工。

## 4. 当前完成状态

| 项目 | 现状 |
| --- | --- |
| 业务、数据、状态、目标模块方向 | 已落盘；本轮进一步补文件与接口骨架 |
| Prompt 5 源码调查 | 已产出 [source-analysis.md](../history/before-2026-09-22/refactor/source-analysis.md)，是 2026-09-20 的源码事实基线；Prompt 6 直接使用，并结合后续 R1 证据。仅对影响本批决策的变化/缺口定点核对，不重做 Prompt 5 |
| 独立目标工程 | `C/next` 独立构建，五目录存在；已合入子集见顶部102文件/1,007项基线。B2正式Task Run执行、Session/历史、图/材料/角色等已具备；Workflow已有Plan的advanceWork推进已实现，handleGoalInput已接初始规划采用；R6薄Host/UI实现已独审导入。 |
| 最近完成 / 后续 | B2/C1/M1/M2/W2当前子集已隔离验收。W2未来意图与C2消费者已合入；R5a/R4.2已合入，R4.1持久受理已合入；Git固定commit读取/比较已独审合入，R3e五文件与Query两文件实现已独审导入；R6初始六文件实现、R3e.3完成与Workflow推进实现已导入；Query execution八生产及R6 Session/mailbox四生产实现已独审导入，初始Plan与UI布局实现已导入。完整R4及Query/Workflow的Host/UI执行入口继续。 |
| 新工程最近完整验收 | 102文件/1,007项隔离通过，类型/构建/边界/24项Kernel产物再现/编译入口通过，旧8,827文件零变化；见顶部证据。78/726、75/719与68/620仅为历史基线。 |
| 双图上 Agent/Session 的现状与余项 | **施工前历史：**无 Module 创建关联及后续 link/archive/reactivate。**A1 后：**正式 catalog 初始化、Module/Task 创建及后续关联维护、当前/历史查询、显式归档/重新启用已经贯通；真实 SQLite/Kernel 身份与历史重启保留。WorkContext、完整架构变更、实际执行/咨询/角色/UI 消费仍未完成，不关闭 A/R3d/R4b |
| 角色、通信与组织行为 | RoleSpec安装/启用/解析、正式Role/Host执行装配、C1公共邮箱、W2委托/工具与三职责Skill组件已有。正式Runtime通信/白板消费者已由C2接通；CoordinationPolicy matrix解析已有，正式writer仍待后续；已有Plan的Workflow推进与Query→初始Plan消费者已接，咨询/唤醒与完整人用执行路径继续。Memory/知识库非本轮门禁。 |
| 原工程已落实源码优化 | `ProjectSourceIndex.architectureMaterials`完整读取一次分析，保留最终来源核验 |
| 原工程上项验证 | 相关3文件22测试、typecheck和现有check:architecture通过；[证据](reviews/core-design-implementation-evidence.md) |
| 原工程 dsh 历史实施与独立验收 | R2a 已通过：56 文件/441 测试、类型、边界及构建/源码脚本；见[逐批证据](reviews/implementation-batches.md)。R2b冻结查询/服务复用已验收，9文件/56测试；R2c真实访问/冻结捕获/架构接线已验收，16文件/110测试。R2d.1错误优先级补测已修复；R2d.2独立最终6文件/50项及相关11文件/74项、类型/边界/构建通过。普通/探索/Reviewer已接冻结工具，Query R2d.3最终3文件17项、相关固定版本25项及另54项通过，类型/边界/构建通过；取消缓存缺口已修复。R2e.1文本读取/比较已通过[独立验收](reviews/R2e-1-sol-dsh-acceptance.md)，18项契约/工具与56项相关回归通过。R3a/R4a 首轮验收失败后，已完成 Sol 骨架 / 测试与 dsh 返修并独立验收；见[最终报告](reviews/R3a-R4a-sol-dsh-acceptance.md) |
| Session及完整执行/UI | 创建/目录/原历史、A1关联与显式归档/重新启用、正式B2 prepare/start/observe及同owner终态释放已有；Query执行/控制恢复/其他维护与完整自动推进仍待实施；R6初始工作台已接通，完整UI继续。 |
| Kernel公开扩展历史证据 | 受管 vendor 扩展及旧 Run 重放、暂停恢复约束修复已验收；平台连续 Session 与范围并行尚未交付 |
| 原生compact | 当前无实现；保持unsupported，不承诺已有 |

以下为原工程 R1–R2 历史结果，不自动证明 next 的装配已完成：401条导入的旧逻辑需要6次完整捕获、3次关系提取，新实现为2次捕获、1次提取。生产代码净+4行；这是工作量减少证据，不是端到端三倍提速或全仓代码已减少。上述6→2是R1的内部架构读取证据。R2c/R2d.1现已分别验证核心捕获及模型工具三页复用；普通/探索/Reviewer正式装配已通过R2d.2，Query也已通过R2d.3真实HTTP/Runtime/Kernel接线；显式legacy兼容保留，R2e尚未全部实现。

## 5. 仓库位置、已有改动与运行方式

```text
W = /home/hyh001/projects/coding-platform
C = W/coding-platform                 # 代码Git仓；原src只读参考
T = C/next                            # 后续默认实现、构建和测试根
N = W/docs/refactor                   # 本轮当前目标设计
D = W/my-coding-platform-docs/agent_platform  # 旧文档仓，只读兼容来源
K = C/vendor/coding-agent             # Kernel来源工程；变更另列明确范围
T/vendor/coding-agent                 # 新工程冻结Kernel公共构建
```

从C读 `AGENTS.md`，其中路径翻译规则适用。其“不自行补设计”禁止无任务扩张；本轮用户明确委托详细设计，已具备授权。修改Kernel前另读 `K/AGENTS.md` 和 `K/INTEGRATION.md`。本轮不为修旧路径批量改写D。

C有用户未提交改动，后续开工先看 `git status --short`。当前包括AGENTS、集成场景测试/工作目录辅助文件、既有重构日志，以及上批ProjectSourceIndex源码/测试改动；不要reset/覆盖，也不要未经核对把这些文件全部算作自己的改动。

现有本地 Node：`W/.toolchain/node-v24.21.0-linux-x64/bin/node`；pnpm 入口在 `W/.toolchain/bin`。新运行入口为 [next/package.json](../../package.json)。在 T 执行本批相关检查，PATH 前置已有 Node24；不因系统默认 Node22 重装依赖或改锁文件。

```bash
cd /home/hyh001/projects/coding-platform/coding-platform/next
node --run check:architecture
node --run typecheck
node --run test
node --run build
node --run verify:isolated
```

新工程边界由 `T/scripts/check-boundaries.mjs` 和独立构建/测试核对；目标仍为 `N/module-target.json` 的 5 模块 / 8 边。`C/scripts/module-map.mjs` 仅描述旧产品，不再作为 next 的默认施工图。静态 import 通过不能证明注入来源已独立，真实装配仍须验收。

## 6. 实施顺序与前置关系

所有工作仍在 T；先前迁入的 R1/R2、Store、Session/Claim、图查询/历史及 Role 不重做。R 系列保留实现与验收编号，当前交付按完整用户路径安排，详细跨表在[实施方案 §0](IMPLEMENTATION-PLAN.md#0-双图agent-与生命周期的完整施工范围)。

| 工作包 | 下一步交付 | R 系列与主要消费者 |
| --- | --- | --- |
| A 双图关联与生命周期操作 | A1 catalog 初始化、Module/Task 关联维护、发现、归档/重新启用和重启已验收；剩余完整正式架构变更及执行/咨询/人用消费者继续推进 | R3d/R3g/R4b；图查询、Runtime prepare、咨询、薄人用入口；不关闭整个 A/R3d/R4b |
| B 真实执行与装配 | B1 组件已验收；下一批复用它接正式 Role/工具/图引用装配、fresh 进入、增量观察、正式归约及同代次占用释放；结束后仍可沿图咨询 | R4c、Query及R2消费者；图状态/历史、后续控制与完成归约 |
| C 通信与角色编排 | 以SessionRef定向寻址的持久消息/索引，咨询/等待/回复，角色职责使用真实图工具；不抢占工作中Session，不引回旧AgentInstance/WorkParticipation链 | **R3f通信**、R5、R3g；按模块找人→咨询→带来源回复 |
| D 控制、连续性与产品完成 | W1 Host 未来计划调整已验收；继续完整授权变更、pause/cancel/resume/recovery、交接/压缩重组、正式结构演进、证据完成、并行结果核对、薄Host/UI | R4d/e/p、R3c/d、**R3e证据/检查/完成**、R3g、R5/R6；W1 不等于 Agent 自动推进或最终产品切换 |

A1、B1、W1 已通过的图关联、生命周期、装配和白板原语直接复用；下一批 B 的具体接缝仍先骨架/测试主审，文件不冲突的实现随后并行。C 消息/Skill及白板工具可并行准备，D 控制/完成责任继续保留。Memory/知识库不是本批门禁，生命周期不能后置。观察到完成要由 WorkGraph 正式归约，Run 结束不等于 Task/Goal 完成；组件或 Host 编辑通过不能关闭整条产品验收。

B 的原 Role 复用来源与下一步接线见 [Runtime §7.1](modules/core/agent-runtime.md#71-b-下一批的接线冻结与验证要求2026-09-25)，正式进入约束见 [WorkGraph §6.3](modules/core/work-graph.md#63-多驱动者的实际进入边界)。RT3 已支持受信 skills/controlHooks 及 first_use；coding-safety 只是未传配置时的缺省，显式空配置不回落。正式 Role 解析、可信 Prepared、WG 进入确认和观察归约/释放仍需消费者，不能另建 RuntimeEntry 数据库或装配总管。C 不搬旧邮箱全事件扫描，也不伪造 workId/sessionId 对应；按实施方案 §0.3 复用已确认的纯规则。

不建立全局串行的 A→B→C→D 施工闸门，也不把 Task 预期依赖当产品启动闸门；明确消费所需的具体产物在需要处核对。R4p复用已有图/Workspace工具做提示与结果核对，不重启通用资源预占方案。共享契约/schema/组合根由集成负责人维护；图见[并行开发设计](PARALLEL-COLLABORATION.md)。每批应交付可运行组合根调用或薄入口；总测试PASS不替代真实用户操作。

原工程[并行任务](tasks/DSH-PARALLEL-IMPLEMENTATION.md)和后续返修已完成；Goal 守卫 / 输入隔离、Kernel 重放 / 暂停恢复通过[独立验收](reviews/R3a-R4a-sol-dsh-acceptance.md)。接手者使用 [DSH 分阶段施工与两次主审](DSH-EXECUTION-HARNESS.md) 流程准备后续批次，不重复修复已关闭缺陷。平台连续 Session / 范围并行仍需后续明确接线和独立验收。

每批在 next 中形成可验证的真实路径：从旧行为与实现提取必要部分，迁接口/实现/测试并接目标装配；不要求重新接回旧系统。旧业务消费者继续使用旧产品，直到新 Workflow / UI 切换；旧目录在最终切换后删除。next 内不保留旧业务代理或无消费者副本，必要旧数据 reader 须有明确职责。具体能力去向见各模块迁移表和[实施方案](IMPLEMENTATION-PLAN.md)。

## 7. 无需重新讨论的边界

- 普通查询、精确文件读取、历史读取不要求LLM、Run或baseline。
- 图是数据与索引基础；不同专用结构可以分别持久化，业务不手工同步各张表。
- 图上的 Agent 关联必须可写、可维护、可发现；运行/待命未归档者可作为咨询候选，归档后仍保留历史。关联是职责/熟悉度线索，不是锁或执行授权。
- 业务决定做什么；核心负责合法性、版本、幂等、原子更新和有界查询。
- 生命周期策略归 Workflow/角色工具；正式状态与关联归 WorkGraph；物理执行/控制归 AgentRuntime/Kernel。没有独立 AgentLifecycle 顶层模块不意味着这些职责可以消失，也不需要新增中间总管。
- Kernel拥有模型循环、原始Session日志和恢复机制；平台保存自己的映射、运行技术记录与工作状态。
- 创建Session不启动模型，先有映射再领取；领取与已领取继续入口互斥，不能重复占用。
- 模型执行返回/进程退出与Task完成分开；缺失、失败、过期检查不能被其他PASS遮盖。
- 维护操作与Run/QueryRun占同一个Session独占槽；未知副作用先核对，不盲目启动第二执行者。
- 长期知识/专家积累保留接口；有限记忆按既定范围补实现与消费者，不凭 RoleSpec、接口或历史代码声明 next 已有完整 Memory/知识库。

## 8. 交接时必须报告什么

报告 next 本批用户可观察行为、真实调用链、修改/复用/删除的路径、目标消费者接线、旧产品切换状态、相关测试结果和仍未接通的能力。将成果归入 A/B/C/D 与对应 R 编号，并逐项说明涉及的 AT-01–14 是已有组件、接通子路径还是整条验收通过。代码行数与性能分别说明；模型费用/端到端延迟未测就不要承诺。若新增兼容入口，写清真实消费者与删除条件。

下个Agent应能仅凭本文件、相关模块页和必要契约找到实施入口；不需要重新猜用户想法，也不需要重新设计五模块边界。任何实际偏离记录在同一批设计/迁移表中，避免源码与文档再分叉。

R4.3a八生产实现与四正常流程已独审导入；R4.3b[骨架](tasks/R4-terminal-history-skeleton.md)已冻结导入，现从fresh main实施[六生产算法](tasks/R4-terminal-history-implementation.md)。

## 冻结保存后的继续入口

以下提示供用户恢复任务时直接使用；本次保存期间不执行其中施工步骤。

> 请从已保存的独立main继续coding-platform。先读本页、docs/MVP-BEHAVIOR.md、IMPLEMENTED-CAPABILITIES.md、IMPLEMENTATION-PLAN.md及对应已有evidence，对已确认产品范围做一次completion audit：逐项区分已导入并有真实消费者证据、仅骨架/候选、尚缺生产者或消费者。保留124文件/1102项隔离副本的准确边界，不把后续局部验收说成新main全绿。按真实公开路径列出仍阻断既定交付的具体缺口，再优先补必要接线；不要新增需求、非阻塞测试、覆盖矩阵、顺手重构或第二owner，也不能自动删减已确认范围。Work-control仅为草稿、A1仅prepare未run且已停止、R3g未派发；不要凭旧会话状态重启它们，先核现源码和最终导入回执。已有授权范围内继续采用骨架→中审冻结→实现→必要独审的工作法，不重做已交付能力；如有真实阻塞如实记录其来源和未完成范围，不宣告完整MVP已完成。
