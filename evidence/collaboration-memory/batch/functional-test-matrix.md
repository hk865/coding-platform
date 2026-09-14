# 功能测试矩阵与场景设计

2026-09-14。当前用户委托：先形成各功能的测试文档，再开展测试；I01–I04 留给新对话。本文件为测试设计与静态覆盖盘点，不是运行报告。与 [缺口台账](functional-test-gaps.md)、[I 执行方案](functional-test-execution.md)共同承接[指导](document-driven-functional-testing-guidance.md)。批次接纳状态仍由 [coverage](coverage.md)维护。

## 输入与判据

本次复算当前源码与 S snap-07 一致：1368 条目，SHA256 `094eb49537e667c46921074f3b15c4077dcef1c60a4bd13371857723b0b09954`，HEAD `ce043a650ecfabd72c55f02695204d58dd9c8b64`。这证明盘点输入身份，不证明功能无回归。

需求正文是 [PRODUCT](../../../../agent_learn/agent_dev/agent_platform/PRODUCT.md)的状态真实性、连续执行、角色协作、证据驱动完成、Human Collaboration、架构治理、MVP 必须证明与成功标准；分责取 [ARCHITECTURE](../../../../agent_learn/agent_dev/agent_platform/ARCHITECTURE.md)的 Module Registry、ModuleDependencyDAG、全局不变量。本批取 [PLAN](../../../../agent_learn/agent_dev/agent_platform/dev_docs/planning/active/collaboration-memory/PLAN.md) §7、§9、§10/10.1；[原始架构对话](2026-09-14-post-c-architecture-conversation.md)决定结构审查要求。

本表按用户行为归组，跨多个模块是正常现象。逐功能执行前加载对应 [Module](../../../../agent_learn/agent_dev/agent_platform/dev_docs/modules/control/control-engine.md)及直接 Interface；不能只按当前实现反推预期。下列源码契约链接帮助找到实际公开形状，不替代规范。已有测试分为“断言已抽查”和“定位候选”，两者本次运行状态一律为**未执行**；未全面逐断言审计的分支不得写已覆盖。

## 功能目录与责任

| ID / 需求 | 用户行为及结果 | 责任、公开入口与真实调用者 | 权威事实和禁止结果 | 基础测试入口及阶段 |
| --- | --- | --- | --- | --- |
| F01 / PRODUCT 完成与状态 | 建目标、计划、执行、验证，查看完成依据 | HumanCollaboration → PlanCompiler/Control → Dispatch/WorkerRuntime；Verification 交 Evidence；app/UI 消费；[plan](../../../src/contracts/plan.ts)、[reduction](../../../src/contracts/reduction.ts) | 当前计划义务和正式 Evidence；Claim、空计划、旧 PASS 不能完成任务 | tests/contract-suite/evidence.contract.suite.ts、goal-phase.contract.suite.ts 为候选；I 前核基础守卫，I01 闭环 |
| F02 / V01、V02 | 授权两 Work 共享正文、订阅与取消，第三 Work 不得读取 | Control 的 sendDirectedRequest/createSubscription/cancelCommunication，Dispatch drive；Host 工具；[coordination](../../../src/contracts/coordination.ts) | Ledger 权限/订阅/Delivery + Vault 正文；digest 相同不授予权限 | tests/coordination/material-isolation.test.ts、route-continuity.test.ts；I 前模块测试，I02 组合 |
| F03 / V03、V04 | 等待材料后继续同一 Work，重启可接续 | registerWait、claim/settleCommunicationIntent；Dispatch → successor Run；[coordination](../../../src/contracts/coordination.ts) | Wait、generation、前驱终态、execution anchor；禁止重叠或重复实际启动 | tests/coordination/route-drive.test.ts、process-recovery.test.ts；I 前时序守卫，I02 故障 |
| F04 / V05 | 并行只读、串行冲突写、查看积压和取消 | DispatchEngine.drive、RuntimeDispatch、ControlIntent；app scheduling/UI；[dispatch](../../../src/contracts/dispatch.ts)、[backlog](../../../src/contracts/dispatch-backlog.ts) | Ledger/outbox/lease/取消事实；本地队列不是任务权威 | tests/coordination/runtime-concurrency.test.ts、tests/control/scoped-dispatch.test.ts、operator-cancellation.test.ts；I02 |
| F05 / V06、V16 | 查询、审阅、换手、返工各走正确入口 | QueryJob、Reviewer、Handoff、Rework 公开操作；Host 组合；[query](../../../src/contracts/query-job.ts)、[handoff](../../../src/contracts/handoff.ts) | 精确请求/角色/版本/正式失败；Query 不扩写权，换手不双启动 | tests/integration/query-result-recovery.test.ts、tests/app/handoff-recovery.test.ts；其他运行类型需补盘点；I02 |
| F06 / V08、V22 | 明确保存、纠正、删除偏好，失败可见 | HumanMemory.maintain → MemoryControlEngine；/api/real/memory/profile/maintain、project/maintain；[memory](../../../src/contracts/memory.ts) | profile/project scope + revision + 幂等回执；不部分保存、不复活删除内容、不把推测变事实 | tests/memory/maintenance.test.ts，断言已抽查；I 前基础集 |
| F07 / V11、V17 近期、V18 | 同 Task 下一接话/架构解释/进度按当前偏好变化 | app queries 的 responsePurpose → ContextCompiler → Runtime；[memory](../../../src/contracts/memory.ts) | 保存、selected、输入和回应分别留证；移除原话后仍生效，一次性例外不持久化 | tests/memory/query-input.test.ts；真实内核 + 标签响应替身；I01 实模型效果 |
| F08 / V21 | 切项目保留用户偏好，项目习惯隔离，显式复制版本 | profile/projectMemory、project/copy；UI/Host；[memory](../../../src/contracts/memory.ts) | 本地 profile、来源 revision、allowCopy；不得继承权限/完成状态 | tests/memory/host.test.ts、context.test.ts；I 前隔离，I01 两项目 |
| F09 / V19 | 记录有条件经验，下一协作采用，前提变化停用 | project/record-experience、import-note、Context selector；Control/Vault/WorkspaceReader | WorkNote 来源与治理/工作区版本；失效经验不可压过规范 | tests/memory/context.test.ts、maintenance.test.ts；I01 真实协作采用 |
| F10 / V13、V20 | 测试前冲突上报，人四种决定回流全部工作 | ArchitectureReviewEntry.report/decide → Control → Delivery/Wait → Runtime；UI；[architecture-review](../../../src/contracts/architecture-review.ts) | 精确提案/决定 revision 和完整影响集；拒绝/延后不推进，单 Work 失败可见 | tests/control/architecture-review.test.ts、tests/coordination/architecture-review-host.test.ts；I01 同场景，I02 故障 |
| F11 / V12、V14 | 界面读状态、来源、记忆、投递和决定回执 | HumanCollaboration/UI → ReadModel；[communication-view](../../../src/contracts/communication-view.ts)、[console-views](../../../src/contracts/console-views.ts) | freshness、游标及持久事实；“已发送”不是“已采用” | tests/coordination/communication-view.test.ts、architecture-review-browser.test.ts；I01/I03 浏览器 |
| F12 / V03、V09 近期、V10 近期 | 来源更新/撤权后拒绝旧输入，人工 Skill 不扩权 | WorkspaceReader、Vault、ContextCompiler、Runtime provider 边界；[material-access](../../../src/contracts/material-access.ts)、[runtime-context-materials](../../../src/contracts/runtime-context-materials.ts) | source pin/grant/RoleSpec 与实际请求版本；选材命中不等于调用授权 | tests/restart/material-source-applicability.test.ts、tests/coordination/model-request-evidence-bypass.test.ts；I02 |
| F13 / 原始讨论、V14、V16 | 重建视图、旧库重开、增长数据下查询 | ReadModel 公开 views/advance；Ledger SQLite；createProductPlatform 装配 | 契约预期 + Map/SQLite 对照；整页回滚，缺真实能力不能 Fake 成功 | tests/read-model/shared-detail-adapter-equivalence.test.ts、read-model-adapter-performance.test.ts；I 前预期，I02 旧库，I03 性能 |

## 场景卡：每张均须保留正例与反例

| 用例 ID | 初始化 → 操作 | 必须断言及故障/重复分支 | 观察层与执行归属 |
| --- | --- | --- | --- |
| F01-N/R | 一个有依赖和正式验收义务的 Goal → 从 UI 提交需求、执行、提交 Claim、验证 | 正例以当前有效 Evidence 完成；缺 Evidence、旧 revision、空计划、依赖未满足均不得变绿；保留旧 FAIL；核 Task/Goal 与视图依据 | 基础 Control 与 Ledger 分开拒绝；完整链 I01。模型自评不作 oracle |
| F02-N/R | 三个身份明确的 Work，正文一次保存，精确授权 A/B → 订阅、发送、相同命令重放、U 存相同正文、重开 SQLite | A/B 可读、U forbidden；重放不增 Delivery；不同 payload 同幂等键冲突；取消末订阅不阻塞剩余页；有限历史 horizon 与实时衔接无漏投 | Vault.open、Ledger events/cursor、mailbox；模块集成 → I02 新进程/Host |
| F03-N/R | 前驱 active，材料先到/后到与 all/any 参数化 → 注册 wait、结束前驱、重复 drive | 前驱 active 不起后继；满足且前驱终态后一个 anchor/Run/实际调用；timeout/cancel、过期 generation、两个消费者竞争分别拒绝或终止；外部动作后丢回执保留 unknown/对账 | Runtime 调用计数与外部动作日志不可仅数 Run 行；I02 |
| F04-N/R | 两 reader、两同 checkout writer、固定并发上限 → barrier 同时放行；注入无副作用失败与取消 | reader 开始/结束区间确实重叠；writer 区间不重叠；scope 在 limit 前筛选；退避/公平/backlog 可见；取消请求、确认、unknown 独立 | 单调时间 + Ledger lease/outbox + UI；I02；不靠 sleep 证明竞争 |
| F05-N/R | 精确 Query request/Review version/换手 Work/返工 FAIL → 相应生产入口；答案生成后回执丢失 | Query 恢复同 round 且调用一次；Reviewer 当前资格；换手消费当前材料且旧执行者无权；返工重复受理不重启，正式新 Evidence 才处置 FAIL | 分运行类型参数化，权限反例独立保留；I02 |
| F06-N/R | 无 Project/Task/Run 的本地 profile → remember、重复、correct、remove；两 SQLite 连接同 revision 更新 | 回执 revision/replayed；模糊匹配拒绝；容量/存储失败前后快照不变；竞争一胜一 revision_conflict；重开当前值保留；删除不能借改 metadata 复活 | HumanMemory 与 Ledger memory；本次已读对应断言但未重跑 |
| F07-N/R | 同一 Task 保存“全部简洁”→纠正“架构详细、进度简洁”→移除原话并重启→三个目的回应 | 三种实际输入 exact revision/目的筛选；当前一次详细例外不改 profile；下一回应不含例外；删除后不再提交旧偏好；分别判断输入与回答行为 | 现有替身请求证据可复用；同 Task 绑定、压缩及真实回答评分留 I01 |
| F08-N/R | 单 profile、项目 A/B → A 保存习惯 → B 查询 → 未允许复制/过期版本复制/明确允许当前版 → 项目重初始化 | 用户偏好两项目都可用；A 习惯默认不在 B；复制仅指定版本；来源撤销后 B/C 链失效；不复制 grant/完成状态；重初始化 profile 不丢 | Host/Context/Ledger；现有 host/context 为候选及部分已读；I01/I02 |
| F09-N/R | 有公开 WorkNote 和治理前提 → 保存局部经验 → 下一次进度/交接使用 → 改前提或正式规范 | 选材含来源/适用条件；真实反馈可指出采用方式；过期、来源删除、规范冲突不采用；不从字符串存在推断模型有效采用 | Context 与真实运行分层；I01，自动提炼延期 |
| F10-N/R | 两工作包对接口存在分歧，独立对照分支 → report → 接受/修改/拒绝/延后 | 测试失败前报告可见；四分支精确 revision；接受/修改的全影响集逐项送达/输入/失败；拒绝/延后无候选推进；重复点击、旧决定、一个 Work 失败及决定后强杀 | 真实 Host/UI，实际输入证据；I01 正常四分支，I02 强杀/组合 |
| F11-N/R | 持久事实已有，故意落后一个投影页 → 浏览器查阅、刷新、纠正/删除/决定、重启 | 可核游标/freshness；状态、内容、来源和失败与后台一致；服务拒绝不得显示成功；无法启动的能力显示 unavailable/unsupported | 浏览器 + HTTP + 持久记录，禁止只用 DOM fixture；I01/I03 |
| F12-N/R | 固定 source/grant/RoleSpec → selection、bind、provider submit 各边界更新/撤权 | 分别拒绝陈旧来源、权限和版本；记录 authorized/attempted 及实际请求摘要；Skill 正文不能放宽工具权限；旧 Run 不能借新 grant 越权 | 三边界各有故障点，先核 existing hooks，I02 |
| F13-N/R | 固定契约事件序列 → 两 adapter 投影 → SQLite 页中写失败/重开/重放 → 64/256/1024 规模 | 两者各自匹配独立预期，重放零增量；页失败业务行及 cursor 全回滚；时间/prepare/内存重复测量。旧库不能由当前 writer 临时制造后声称兼容 | I 前独立预期盘点；I02 旧库；I03 性能，不增加 Redis |

## 已核断言与证据层级

以下是静态复读事实，命令和新运行日志尚无。定位可按精确用例名搜索；源码行号变化时以标题与断言为准。

| 文件 / 用例定位 | 已读断言 | 不能由此证明 |
| --- | --- | --- |
| tests/memory/maintenance.test.ts / `ambiguous correction and a failed batch never save partially` | ambiguous、capacity、unavailable 与失败前后 snapshot 相等 | 浏览器失败文案、真实模型行为 |
| 同文件 / `two SQLite connections preserve one profile and reject stale concurrent edits across reopen` | 一次 committed、一次 revision_conflict，重开 revision/entry 数 | 新 OS 进程 kill 或多机竞争 |
| tests/memory/context.test.ts / `refreshes applicable revisions and recursively invalidates copied sources without using stale cache` | 旧偏好不在 memoryInput、复制链 source_changed_or_retired/expired、inferred candidate 排除 | 自然语言自动维护能力或真实回应采用 |
| tests/memory/query-input.test.ts / `three response purposes adopt current persisted versions in real kernel requests and retain separate save/adoption facts` | HTTP→真实内核→捕获请求，重建 server 后 revision 2；一次例外不保存，删除后旧内容不再进入请求，无 edit/shell | provider 由标签条件返回固定答案；不是 DeepSeek 真实语义效果，也未据此核完同 Task/压缩覆盖 |
| tests/coordination/material-isolation.test.ts / `three real Works share one formally routed body...` | 实际 Control/SQLite/Vault；A/B ready、U forbidden，同 digest 重存和重开后仍隔离 | sourceApplicability 是替身，身份由测试显式建立；不是用户 E2E |
| tests/integration/query-result-recovery.test.ts / `lost query answer commit recovers the exact round without another runtime call` | recovered answered=1，repeat=0，calls=1，round/request 保留 | 全部运行类型的同样故障 |
| tests/read-model/shared-detail-adapter-equivalence.test.ts / `produces the same view...` 与 `rolls back the whole SQLite page...` | SQLite 与 memory 相等、重开一致、重复事件 appliedEventIds 空；trigger 故障后 proposal 行数为 0 | 正例 expected 来自 memory，不能证明两者没有共同错；需核其他 tests 的契约预期；cursor 断言仍待补核 |

## V01–V22 与核心义务不得遗漏

| PLAN | 场景/处置 | PLAN | 场景/处置 |
| --- | --- | --- | --- |
| V01 | F02 | V02 | F02 |
| V03 | F03/F04/F05/F12 | V04 | F03 |
| V05 | F04 | V06 | F05/F10 |
| V07 | 第二领域明确延期 | V08 | F06/F09；自动提炼延期 |
| V09 | F12 现有 source pin；知识库延期 | V10 | F12 人工 Skill 权限；自动 Skill 延期 |
| V11 | F07 | V12 | F11 |
| V13 | F01–F12 在 I01 同场景串联 | V14 | F13 与 I03 同快照全集 |
| V15 | 本矩阵 + 缺口台账，I04 完成核对 | V16 | F03–F05/F12/F13 + S 接口审查，I02/I04 |
| V17 | F07 三个消费者；第二领域延期 | V18 | F07 |
| V19 | F09；自动进化延期 | V20 | F10 |
| V21 | F08 | V22 | F06 + I04 上游版本/许可/失败证据 |

[核心义务映射](../../../../agent_learn/agent_dev/agent_platform/dev_docs/verification/2026-09-10-core-obligations-map.md)的原编号全部承接：#1→F01/F05；#2→F01/F05；#3→F02/F03/F10；#4→F03/F07/F12；#5→F06–F09/F12；#6→F03–F05；#7→F01/F05；#8→F10/F12；#9→F01/F12；#10→F12/F13 的 Git/来源身份；#11→F01/F07/F10/F11 与整体效果。原文的旧实现判断不自动作为当前缺陷；超出 PLAN 的完整内核会话恢复、通用 Git 产品出口、完整 MigrationGate/第二领域另行保留范围，不偷偷补建。

[A1–A8](../../../../agent_learn/agent_dev/agent_platform/dev_docs/verification/2026-09-08-framework-acceptance/acceptance-plan.md)对应 A1→F01/F05；A2→F02/F12；A3→F04/F05；A4→F01/F05；A5→F03/F05；A6→F10；A7→F07/F12；A8→F11。正常轮次与故障轮次分开；自然任务没有触发的机制记 not_exercised。实际 token 计量、隐藏答案隔离和同条件对照保留在执行方案，不能拿历史功能 PASS 替代。
