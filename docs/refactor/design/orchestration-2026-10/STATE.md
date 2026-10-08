# 现状：编排、记忆、生命周期（设计第一轮）

- 代码基线：分支 `feat/reliability-and-structure`，HEAD `42604b3`。
- 做法：只读代码和文档。没有构建、没有跑测试、没有调用模型。
- 下面“读代码发现的问题”都没有运行验证过。
- 方括号里是出处。代码写“文件:行号”，路径从仓库根算起。

先说几个词：
- **Session**：一个 agent 的会话记录，原历史留在里面，可以接着说。
- **Run**：一次执行。Run 结束不等于任务完成。
- **工作线**：一个 Session，加上接续它的 Session（决定 25）。
- **只读副本**：「问一问」时从原 Session 派生出来的副本，只回答，不动手。
- **Workflow**：按规则推进工作的部分，自己不循环，由 Host 调用。
- **WorkGraph**：平台记录事实的核心，所有状态变化都经过它。
- **Host**：常驻进程，跑所有循环和接口。
- **退役**：Session 被中断后不能再执行，原历史仍可读（决定 8）。
- **让出执行**：agent 停下这次执行，等回复；Session 空出来，回复到了再接着做。

---

## 1. 编排（谁决定下一步做什么、谁来做）

**已有：**
- 目标没暂停、没取消、有已采用的计划时才派工 [src/business/workflow/workflow.ts:997-1003]。
- 任务顺序：必需的先做，再按计划顺序；不看依赖 [workflow.ts:333-336]。
- 跳过已取消、已替代、已延后的任务，也不派只做计划的未来意图（5.10）[workflow.ts:341-343, :1036]。
- 失败后自动返工、自动重新检查（5.8、5.9），上限是 Host 设置，默认 3 次，全局一个值 [workflow.ts:952-987; src/contracts/task-requeue.ts:99-109; src/app/host.ts:589]。
- 挑 Session：找第一个空闲、同角色的；没有就新建，并挂上“负责该任务” [workflow.ts:644-681, :1127-1133]。
- 中断后在新 Session 接续，新 Session 带入原 Session 已完成的历史（决定 7）[workflow.ts:905-912]。
- 等回复的工作，回复到了在原 Session 接着做 [workflow.ts:1106-1120]。
- 推进工作的驱动只在内存里。同一个目标里，被明确选中的任务各有自己的推进句柄，互不等待 [src/app/collaboration-driver.ts:11-13]。等回复时每 0.5 秒看一次那条已存的消息，不调模型 [collaboration-driver.ts:147, :505-543]。
- 目标的暂停、继续、取消会传到它的每个 Run（5.5）[src/app/goal-fan-out-driver.ts]。
- 启动核对：Host 重启后重新推动待返工的任务和没真正开始的 Run；**等回复的不在内** [src/app/startup-reconcile.ts:326-338]。
- 目标的“需要你决定”原因码已经有了，例如返工到上限、Goal 门需要修复 [src/core/work-graph/state/goal-machine.ts:832-855]。
- 机械注意力（心跳、改动行数、图的变化）只能用启动配置文件打开，通知发给一个固定的 Session [host.ts:1018-1091, :1068; src/app/main.ts:174-175]。
- 返工和重新检查的服务已经接受 agent 调用，只差给 agent 的工具 [src/core/work-graph/tasks/requeue-service.ts:15-17; evidence/evidence-service.ts:1652-1656]。
- 规划器一次只返回一个计划或一组问题 [src/core/agent-runtime/query-preparation.ts:47-49]。
- 存储上，同一个基础上可以有多个候选计划；但“等你采用”的读取只返回其中一个（编号最小的）[tasks/plan-readers.ts:511-523]。“未采用”这个状态没人写 [state/plan-machine.ts:8-11]。
- 主对话由浏览器一步步驱动，只装了执行者的行为说明，查询里没有任何平台工具 [src/ui/views/execution/query-flow.ts:60-195; host.ts:517; src/core/agent-runtime/query-execution.ts:460]。

**缺：**
- 按含义挑成员：今天普通界面所有 Session 都是同一个角色，“同角色”分不出谁 [src/app/runtime-configuration.ts:90-96]。
- agent 派工、建成员、换手的工具。
- 2–3 个方案和迭代；按目标设自治；目标顺序；目标冲突提示。
- 「需要你决定」队列和通用决定提交。旧的决定记录类型没有写入者 [src/contracts/goal-change.ts:153-196]。
- 直接干预让空闲成员动手。今天成员对话发到原 Session，只得到一次只读回答 [src/ui/views/conversation/member-mail.ts:83-84]。
- 等回复的时限和转交；停下的工作自己醒。
- 依赖软排序（决定 11）；真实冲突检测；注意力发给参谋。
- 独立审阅者：带审阅证据的一轮检查会被拒 [state/verification-machine.ts:1142-1145]。删掉材料授权以后，审阅者还要另想办法读被审工作的材料（STATUS“缺口”）。今天一次执行只能读自己的材料，读别人的要靠授权 [work-graph/materials/applicability.ts:88-128]。
- 消费时检查精确输入（决定 11，仍是 MVP 项）。今天的做法是：计划里写明“下游要哪个产物的哪一版”，执行准备时去读 [src/core/agent-runtime/execution-preparation.ts:413-433; tasks/plan-service.ts:1704-1763]。但规划时这一版还不存在，所以这条路本来就走不通；决定 6 又把这个字段从规划提示里去掉 [query-preparation.ts:58]。而且读的方式只有授权能满足，正在简化的删除清单上。依赖边上的“要什么”（产出约定、产物、检查结果等）还在 [src/contracts/plan.ts:171-180; query-preparation.ts:56]，但没有代码在消费时查它。

## 2. 记忆

**已有（都不是记忆本身）：**
- 名字带 memory 的代码只有一个用途枚举和角色规格服务 [src/contracts/memory.ts:3; work-graph/configuration/role-memory-service.ts:1-37]。
- 输入来源里“记忆”这一类有 6 处校验接受，但没有任何代码产生它 [src/contracts/dispatch.ts:58]。
- 任务行上已有失败、返工、处置变化的事实；处置变化是 5.10 新加的 [model/plan-contracts.ts:75-105]。
- 计划改动带原因 [model/plan-contracts.ts:31-38]；架构目录的每次修订都是不可变版本，但修订没有接口可用 [src/composition/create-platform.ts:676-683]。
- 接续说明：单个任务用，只放事实，有上限，不调模型 [src/contracts/continuation-brief.ts:65-168]。
- 可以按路径读文件摘要，用来判断代码变没变 [src/core/workspace/ports.ts:85-98]。
- “不可变版本 + 当前指针”的写法已有先例 [role-memory-service.ts:16-20]。

**缺：** 记忆核心一行代码也没有。
- 没有节点注记，没有目标和阶段上的“当前理解”。
- 没有大小上限，没有按代码版本失效。
- 没有“记”工具，没有书记的审查流程。
- agent 读不了原历史片段，只有界面能读 [src/app/core-routes.ts:257]。

## 3. 生命周期（Session 的建、用、接续、归档）

**已有：**
- 两阶段建 Session，回应丢了也不会多建一个 [src/core/agent-runtime/session-operations.ts:549; work-graph/sessions/session-directory.ts:689, :820]。
- 占用和释放；启动时检查 Session 健康（5.6）[sessions/session-health.ts:76; startup-reconcile.ts:166-200]。
- 中断后旧 Session 退役，原历史仍可读（决定 8）[state/session-availability.ts:313-331; session-operations.ts:760-765]。
- 归档、重新启用只有界面按钮 [core-routes.ts:233-235]。
- 打开或关闭“负责”关联只有一个原始接口，没人调用 [sessions/session-lifecycle.ts:547; core-routes.ts:235]。
- 只读副本和原 Session 的关系只记在消息上 [work-graph/model/communication-contracts.ts:139-144]。
- 接续 Session 和旧 Session 的关系只间接记在重新入队记录里，没有索引 [src/contracts/task-requeue.ts:134-144]。

**读代码发现的问题（没有运行验证）：**
- Workflow 建的 Session 都挂着“负责某任务”，任务做完也不解除，所以在工作台上归档会被拒 [state/session-availability.ts:621-634; workflow.ts:1131, :933]。
- 5.6 之后更严重：退役的 Session 也挂着，同一个任务显示两个负责的 Session。
- 只读副本以后可能被同角色的工作拿去用 [workflow.ts:401-408; consultation.ts:356-365]。
- 正在等回复的 Session 可能被派去做别的任务。
- 等回复的 Session 可能被一次中断的查询弄成退役，之后回复永远接不上。
- Session 记录分不出“等回复”，因为后来的查询会覆盖“最近一次执行” [state/session-availability.ts:289-303]。
- 归档不看等待。
- 退役的 Session 和只读副本一直算“活跃”，不会自己归档。启动核对时，退役的（不可用的）每次都要探测一遍；空闲可用的只读副本不探测，只被列出来 [startup-reconcile.ts:187-189]。真正的代价是扫描上限：启动时最多扫 100 页、每页 100 个 Session，超出的部分不探测、不核对 [startup-reconcile.ts:118-119, :183-185]。副本和退役的越积越多，越早碰到这个上限。

**缺：** 工作线；换手；归档前处置责任；等待的时限和转交；状态词；只读副本何时结束；重新启用前检查能不能真的用。

## 4. agent 看到什么、能做什么

**已有：**
- 给模型拼文字的地方有 6 处，各管各的：执行准备、接续说明、查询、浏览器里的规划问题、咨询、注意力通知 [execution-preparation.ts:105-149; query-preparation.ts:227-263; src/ui/views/execution/planning.ts:33-77; consultation.ts:406-425; host.ts:1069-1071]。
- STATUS 说“AgentRuntime 有三条读图路径”，不准确：注意力那条在 Host。
- 执行时 agent 只看到任务标题和指令，看不到目标、验收义务、依赖、所属模块 [execution-preparation.ts:121]。
- 接续说明必须放在输入最后，平台会检查 [tasks/execution-entry-service.ts:1192-1196]。
- 平台工具共 12 个；普通界面的执行拿到 7 个；查询一个都没有 [host.ts:513-514; query-preparation.ts:146-148]。
- 查任务图的工具把整张图的原始数据一次返回，超过 64 KB 就截断 [whiteboard-tools.ts:265-273]。
- 注意力通知发整张图的快照，超过 16 KB 会被拒，然后每个周期重试，没有尽头 [host.ts:1076-1086]。
- 查询的“关注哪些任务”接口留着，从来没人填 [src/contracts/query-job.ts:138]。

**缺：** 统一的上下文装配；任务卡和足迹；“看 / 找 / 记”；读架构图的工具；读原历史片段的工具；记下 agent 当时看到了什么。

## 5. 新界面要的后端

**已有：** Session 的查找、读取、原历史 [core-routes.ts:227-232]；执行控制；目标控制和目标显示 [core-routes.ts:272-273]；重新入队；重新检查；执行历史 [core-routes.ts:257]；变化推送（SSE）在 `src/app/server.ts`。

**缺：**
- 工作线列表和单条工作线；状态词。
- 计数：存储层只能分页，不能计数 [src/core/record-store/lookup-ports.ts:11-26]。
- 按 Session 找它的 Run：没有索引 [tasks/plan-readers.ts:72-80]。
- 决定队列；方案比较；目标设置；目标冲突提示。
- 节点信息卡；任务“计划要改 / 实际改过”。
- 按时间读任务状态（时间竖条）。
- 活动日历：“天 × 小时”的格子，深浅表示步骤、编辑、检查的次数（UI-WORKBENCH §0 被替换的条目第 4 行）。检查次数在平台的检查记录里；步骤和编辑次数只在内核的历史里。内核的历史记录带时间 [vendor/coding-agent/dist/core/ports/session_store/session-store-port.d.ts:85, :177]，一次执行也有模型调用和工具调用的总数 [vendor/coding-agent/dist/core/runtime/state/run-state.d.ts:522-523]，但平台没有取出来存。
- 被取消或替代、从没运行过的任务，在任务图里读起来像“待执行”（STATUS“缺口”）。
- 注记的读、改、删。
- 消息状态：已排队 → 已送达 → 已生效 / 被拒绝。

## 6. 架构图

**已有：**
- 只有 4 个接口：采用初始架构、读、采集、查询 [core-routes.ts:216-219]。
- 修订、比较、影响分析只在平台内部，没有接口 [create-platform.ts:676-683]。
- 正式目录和观测结果的比较会被拒 [work-graph/architecture/architecture-service.ts:148-153]。
- 观测图只有模块和接口两种节点；上限 512 个节点、1,024 条边、240 KB [src/contracts/architecture-source.ts:47-62]。
- 目录本身支持包含关系，但冷启动给模型的格式里没有 [src/contracts/architecture-catalog.ts:26-44; query-preparation.ts:60]。
- 写模块负责人的服务有，生产代码没人调用 [sessions/session-targets.ts:154]。
- 任务的“所属模块”只是一个随便写的字符串，不检查 [persistence/plan-record-codecs.ts:282]。

**缺：** 从工作结果修订架构；正式与观测的比较；文件级观测图；冷启动声明包含关系；模块负责人；给 agent 的读图工具。

## 7. 结构（任务 D 相关）

见 D-PLACEMENT.md。一句话：10-02 的拆分方案在 HEAD 上不再干净，要在删减之后重算。

---

## 8. 10-05 以来变了的说法

10-05 的设计核对读的是 `b67111d`，在 5.5–5.10 落地之前。下面是在 HEAD 上重新核对后变了的。

**原来说没有，现在有了：**
1. 自动返工、自动重新检查：已落地（5.8、5.9）[workflow.ts:952-987]。
2. 重启后重新推动：已落地（5.6）。但等回复的工作仍不重新推动 [startup-reconcile.ts:326-338]。
3. 启动时检查 Session 健康：已落地，原来说“到不了” [startup-reconcile.ts:166-200]。
4. 中断后的接续：原来是等待，现在新建一个接续 Session [workflow.ts:905-912]。
5. 接续 Session 带入旧历史：原来没人产生，现在有了 [execution-preparation.ts:190-199]。
6. 退役 Session 的原历史：原来担心读不到，现在可读（决定 8）[session-operations.ts:760-765]。
7. 能力上报的“恢复执行”：原来报“不支持”，现在报“只做启动核对”[create-platform.ts:214]。
8. 目标的“需要你决定”原因码：原来是计划，现在已实现 [goal-machine.ts:832-855]。
9. 任务行上“过去的事实”：除了失败，5.10 起还有处置变化 [model/plan-contracts.ts:75-105]。
10. agent 返工：服务已接受 agent 调用，只差工具（原来说整件事都缺）。

**原来说要问你，现在已定或已记下：**
11. 中断后在新 Session 接续：你已确认（决定 7）。
12. 下一阶段清单：已写进 HANDOFF 决定 13、34 和 STATUS。
13. 依赖做软排序：已定（决定 11），代码还没做。
14. 目标顺序、目标冲突：已定为界面决定（决定 15、17），代码还没做。
15. 记忆什么时候做：已由决定 23、34 回答。
16. 记忆工具：原来设想三个专用工具，已被“看 / 找 / 记”取代（决定 22）。
17. 成员记忆的问题：被决定 25（“成员”只是投影）收窄了。

**原来的说法不准或已过时：**
18. 10-02 的拆分方案“17 次搬移消掉全部 55 个环”：在 HEAD 上，目录环从 55 个变成 76 个；照原方案搬，还剩 2 处不允许的引用和 22 个没归属的文件。
19. 拆分要改的 import：原来算 22 个文件 84 行，现在 WorkGraph 外约 26 个文件 106 处。
20. 拆分方案里“状态目录可以依赖共享契约目录”：现在不行了，状态目录只能依赖 `src/contracts`。
21. 拆分方案的大文件行号：都过期了，例如计划服务从 2,130 行长到 2,764 行。
22. “AgentRuntime 有三条读图路径”：注意力那条在 Host；给模型拼文字的地方其实有 6 处。
23. “依赖条件变了不会被当成图的变化”：说重了。每次采用计划都换计划号，所以变化仍算 1 处；丢的是“具体哪条边变了”。而且 agent 读到的依赖条件是一串 `[object Object]`：程序把一个结构直接当文字拼了进去，内容丢了 [attention-observer.ts:504]。
24. 记忆调研建议把记忆放进 `configuration/`：会重新长出拆分要消掉的环，不能这样放。
25. “记忆”这类输入来源原来说 5 处校验接受：实际 6 处，仍然没有产生者。
26. “每个 Run 改过的路径只在接续说明里”：检查结果里也有。
27. “冷启动不能声明包含关系”：只是给模型的格式里缺，目录和界面都能传。
28. 能力文档里“记忆不作当前门禁”这句：决定 23 之后过期了 [docs/refactor/IMPLEMENTED-CAPABILITIES.md:172]。

**原来说的问题，现在仍然在：**
- Workflow 建的 Session 归档被拒（而且更严重，见 §3）。
- 只读副本可能被拿去干活。
- 注意力只能用启动配置打开；依赖条件拼成 `[object Object]` [attention-observer.ts:504]。
- 主对话只装执行者行为；规划器只给一个计划；重新启用不检查真实能力。
