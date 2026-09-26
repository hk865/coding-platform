# R4.1 持久控制与 R2e.2 Git读取：在途独立审阅

2026-09-26。最近完整隔离基线仍为 [R5a/R4.2 的102文件/1,007项](next-r5a-r4-tool-group-2026-09-26.md)。本报告记录其后增量：R4.1持久受理、Git固定commit读取/比较、R3e注册检查、Query pending受理及R6初始Host/UI实现已独审导入；R3e.3正式完成及Workflow已有Plan推进实现已导入，Query execution与R6 Session/mailbox实现已独审导入。当前main含骨架占位，未重新完整隔离，不宣称完整控制产品可用。

## R4.1 中审与冻结

九文件骨架经生产接线与测试语义独立审核。两轮独立检查均为7文件、19个明确unsupported目标红、30个邻接通过，types通过；日志为 [初审](evidence/next-b2-2026-09-26/control-intent-middle-tests.log)、[返修后](evidence/next-b2-2026-09-26/control-intent-middle-final-tests.log)。该阶段19条后段尚未到达，不计当时PASS；后续实现验收见下段。

- 改正真实提交后回执可读却硬断unavailable的错误测试；同一case覆盖可恢复与恢复读取暂时失败两个真实窗口，原请求重放不新提交。
- fresh authorize/begin无副作用检查移至拒绝后；局部CAS loser明确revision_conflict；queued请求不释放占用、自然完成按原正式结果释放。
- 三处fresh helper接线及receipt优先已核：authorize/begin/sharedadmitEnteredRun，后者供model issue/consume。entered/result/history未加控制门禁。
- Run可选controlState纯形状helper经逐行审阅作为原reader兼容接线保留；没有运行中Role更换产品场景，不加热路径角色重读。该中审阶段新ControlIntent codec/schema仍为骨架，后续实现已交付。

[九文件导入与冻结](evidence/next-b2-2026-09-26/control-intent-skeleton-import.json)前核原主线hash未变、scope外无修改。主审另将现platform公开keys断言加controls一行，[证据](evidence/next-b2-2026-09-26/control-platform-surface-test-update.json)。第二阶段只开放control-service、control-record-codecs、execution-entry-service三生产文件，测试/接口/组合根只读。

三生产实现现已[独审导入](evidence/next-b2-2026-09-26/control-intent-implementation-import.json)，[7文件50项](evidence/next-b2-2026-09-26/control-intent-final-tests.log)通过。独审补出的同identity双miss真实竞争、实际提交失联与eventAt读取失败已修复；最后catch修复后[2文件20项](evidence/next-b2-2026-09-26/control-intent-replay-final-tests.log)及[types](evidence/next-b2-2026-09-26/control-intent-replay-final-types.log)通过。回执无法确认时返回unavailable未知，不冒充未提交；queued持久受理及四个fresh门槛已有，物理pause/cancel、清理ack和resume均未交付。

## Git 中审与有限返修

初审12文件107项为7红/100通过，types通过，[日志](evidence/next-b2-2026-09-26/git-read-middle-tests.log)。发现capture pair+prefix被忽略、helper缺now/maxQueryResults，及部分真实Git夹具的后段断言不成立；按 [返修任务](../tasks/R2e-2-git-read-compare-middle-repair.md)收敛。

生产复审确认：输入先于deferred access拒绝、Git分支本地ctx/workspace匹配、原时钟和limits正确传递，该阶段六文件仍不实现Git I/O，实现阶段只开放git-read.ts一文件。ports/access/workspace-read原hash不变。

测试已经修正实际dirty/deleted状态、BOM原字节、实际SHA-1/SHA-256格式、双commit授权过滤、docs与docs-old前缀、symlink域、真实filter/diff哨兵、linked worktree/父目录根以及B2三轮模型消费和正式ended。第二次返修仅修同一取消helper：在operation实际settle时记录关闭状态，异常先终止真实child再排空，防止测试掩盖提前返回或挂死。两测试最终冻结后[八文件骨架已导入](evidence/next-b2-2026-09-26/git-read-skeleton-import.json)。

git-read.ts单文件实现候选的[12文件111项](evidence/next-b2-2026-09-26/git-read-implementation-tests.log)及[types](evidence/next-b2-2026-09-26/git-read-implementation-types.log)通过，但独审确认三项实际缺口：U+FEFF文件名被当正文BOM处理、blob读取非零退出分类、等待真实root handle返回期间取消后仍可能spawn。该候选随后完成有限返修：主树data测试在原历史case补BOM/普通同名路径身份，并新增1条真实handle已取得但尚未返回时取消的反例；blob分类按源码修复，不额外制造对象损坏/GC矩阵。最终短审通过，独立[12文件112项](evidence/next-b2-2026-09-26/git-read-repair-final-tests.log)及[types](evidence/next-b2-2026-09-26/git-read-repair-final-types.log)通过，真实child/root清理和B2三轮消费者/正常terminal均已验证。[一文件实现导入](evidence/next-b2-2026-09-26/git-read-implementation-import.json)最终hash为`0c43ef82c558dd9e2d6ae76cac7f2222068bf61d2e0add93c61dc3670c5ba909`；主审仅纠正same-inode alias注释。mixed普通文本比较已追加独审导入（r2e-mixed-comparison-implementation-import.json），15项/2文件及types通过；Git/capture、mixed binary、Git写版本、语言扩展及GUI历史预览继续；没有partial/promisor仓库夹具覆盖声明。

## 继续范围

R4.1持久请求不等于真实pause/cancel；R4.3a投递/观察/清理确认、R4.3b正常cancel abandoned历史投影、R4.4/5原身份恢复和预算继续。R4.3a已在初始Plan与R3d骨架释放composition后fresh派发（session-7ffe634d-e8f9-41a4-a209-8692ac461333）。

[R3e.1注册检查](../tasks/R3e-completion-implementation.md)：五生产文件完成受限返修并已[独审导入](evidence/next-b2-2026-09-26/r3e-evidence-implementation-import.json)，含Goal gate真实普通producer分支；固定[3文件/10项](evidence/next-b2-2026-09-26/r3e-final-tests.log)及[types](evidence/next-b2-2026-09-26/r3e-final-types.log)通过。原回执、局部读集、当前来源适用性、执行根与晚取消事实收尾已修复。注册检查/Evidence子链已接通，不代表Task/Goal完成或Reviewer已交付。

[R5b Query执行](../tasks/R5b-query-execution-implementation.md)：pending受理与十九文件骨架后，八生产范围（七改变）完成[独审导入](evidence/next-b2-2026-09-26/r5b-query-execution-implementation-import.json)。固定4文件/13项及types通过；公开无Plan Goal→Query→真实Session claim→有界prepare→原Kernel readonly源码工具/模型轮次→持久Answer/Job/Run→同generation释放、原回执及SQLite重开已经贯通。一次有界返修落实原expected/请求指纹与回执恢复、新动作当前占用、完整scope/初次Role、manifest有效预算及原输入来源pins；不增加运行中换Role防御。外部材料grant、多轮/高级恢复及Answer→初始Plan、真实Host消费者继续。

[R6.1a Host工作台](../tasks/R6-host-workbench-implementation.md)：六生产实现及最终三项UI修正已[独审导入](evidence/next-b2-2026-09-26/r6-host-workbench-implementation-import.json)，固定[2文件/15项](evidence/next-b2-2026-09-26/r6-final-host-tests.log)、Node/UI types与构建通过。修正前真实浏览器已走空库初始化→Plan→采用/观察结构与任务图、文件分页/捕获版本读取、第二scope无策略Goal与原请求replay；最终修正核实异步响应写原scope、文本失焦不全页重绘及技术详情折叠。最终版本同SQLite无review配置[HTTP重开](evidence/next-b2-2026-09-26/r6-reopen-http.json)可读Goal/TaskGraph；最终[真实浏览器复验](evidence/next-b2-2026-09-26/r6-final-browser.json)及[截图](evidence/next-b2-2026-09-26/r6-final-browser.png)已完成：现成Chromium Headless保留原sandbox、临时独立profile，经原生DevTools输入连接真实Host/SQLite；Goal ID输入后Tab保留下一框焦点，无review重开可读Goal/TaskGraph，capture响应延迟700ms时切B不受A响应污染，切回A已capture ready。 本轮main核心/Host集成[13文件47项串行通过](evidence/next-b2-2026-09-26/cohort-core-host-integration-tests-serial.log)，[types](evidence/next-b2-2026-09-26/cohort-core-host-integration-types.log)及[7/8允许边界](evidence/next-b2-2026-09-26/cohort-core-host-integration-architecture.log)通过；[首轮并发超时日志](evidence/next-b2-2026-09-26/cohort-core-host-integration-tests.log)保留。该专项不替代102文件/1,007项历史完整隔离；Session/mailbox后续交付见下。

[R3e.3正式Task/Goal完成](../tasks/R3e-task-goal-completion-implementation.md)：五生产实现已[独审导入](evidence/next-b2-2026-09-26/r3e-completion-implementation-import.json)，最终2文件/3项及types通过；一次纯policy修复保留optional已有真实Run/Lease的活动副作用阻塞，无执行的optional意图仍不阻塞。公开普通work与独立Goal gate检查→completeTask→completeGoal→TaskGraph→SQLite重开/原回执已接通；Reviewer生产、正式重开/supersession和完整Workflow仍未交付。

[R5c.1 Workflow](../tasks/R5-workflow-advancement-implementation.md)：原七文件骨架后，workflow.ts实现已[独审导入](evidence/next-b2-2026-09-26/r5c-workflow-implementation-import.json)，独立2文件/3项及types通过。真实已有Plan→两个普通work复用同Session的新Kernel Turn→实际checks→工作完成→独立Goal gate→正式Goal COMPLETED已接通，optional future仍保留；每次有限owner调用沿原完整请求/回执，无第二状态库。`handleGoalInput`仍unsupported，初始规划、复杂调度/Reviewer及Host消费者继续。

[R6.1b Session/mailbox](../tasks/R6-session-mailbox-implementation.md)：四生产实现已[独审导入](evidence/next-b2-2026-09-26/r6-session-mailbox-implementation-import.json)，原2文件/17项、Node/UI types及最终物理构建通过。实际浏览器从空库创建两个Session、Host发信/正文/原历史读取，并在无review配置的同SQLite/Kernel重开后保留；读取仍pending。发送后继捕获原scope/recipient、新草稿保留，以及[切Session正文归属](evidence/next-b2-2026-09-26/r6-session-selection-repair-import.json)已修正，最终[浏览器复验](evidence/next-b2-2026-09-26/r6-session-browser.json)通过。Query/Workflow/材料/控制与完整布局继续，不将本批当完整R6。

[后续Host执行入口草稿](../tasks/R6-execution-entry-skeleton.md)与scope已准备，尚未派发；须等Query执行、当前Session/mailbox以及[initial-plan](../tasks/R5b-initial-plan-skeleton.md)实现导入后，再接可信runtime/checks/workflow配置与正常消费者。R4.3a骨架已接续派发，先STOP中审再实现。

本轮只以骨架不带偏、正常公开路径、实际权限和副作用为必要gate；不因测试覆盖完备继续加矩阵或返修轮次。Evidence五文件与Query两文件实现已通过必要独审并导入；R6实现已独审导入，正式完成五生产实现已独审导入，Workflow已有Plan推进实现已导入；Query execution与R6 Session/mailbox实现已独审导入，初始Plan与UI布局接续，不能以局部通过冒充完整产品完成。

## 合入后的共同路径

主工程中 R4.1 与 Git 一并通过 17 文件 / 157 项及 types，见[日志](evidence/next-b2-2026-09-26/control-git-integrated-tests.log)与[结果](evidence/next-b2-2026-09-26/control-git-integrated-result.json)。该结果只覆盖受影响共同路径；R3e.1/Query受理已增量导入，R6初始实现与Workflow推进实现已导入，Query execution/R6 Session-mailbox实现已独审导入；R4.3a已在初始Plan与R3d骨架释放composition后fresh派发（session-7ffe634d-e8f9-41a4-a209-8692ac461333），预建占位仍在，最近完整物理隔离仍是 R5a/R4.2 的102文件/1,007项。
