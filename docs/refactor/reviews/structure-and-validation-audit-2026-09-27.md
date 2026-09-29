# 结构图符合度、往返步骤与校验边界审查

2026-09-27；源码基线 `d0dc9d6cf4b914159a67578dd1de7265fa9bad9d`。主审与三个子 Agent 只读核对，未修改生产代码，未运行模型或扩大测试。本文记录证据和简化候选，不把候选自动当作批准的实现方案。

**当前状态补充：** 下方原审查包含清理前结论。角色解析复用与 AG1 导入后的鉴权现状见[末节复核](#角色行为表之后的鉴权复核)；同次 Role 重复解析已经修复，不能继续计为当前冗余。

## 文档时间及权威范围

用户指定原文件 `/home/hyh001/projects/coding-platform/docs/refactor/CORE-STRUCTURES-AND-ORCHESTRATION.md`：文件系统 birth 为 **2026-09-23 09:52:09 +08:00**，mtime 为 **2026-09-24 19:19:54 +08:00**。正文标注“更新：2026-09-23”，顶部含 9 月 24 日纠偏。文件系统时间不是不可伪造的原始创作记录，因此只能证明本机文件的时间信息。

独立仓库副本与原文件 SHA-256 均为 `22763c783620c556f15eb6195130ec7386ab75d80362ed210d53af431fb695c1`，内容完全一致。独立仓库最早记录为提取提交 `5bd93ab`，时间 **2026-09-27 01:09:44 +08:00**；这是入库时间，不是设计产生时间。父工作区不是 Git 仓库，本次不能由其 Git 历史证明更早写作过程。

该文档是静态设计，包含过时实现状态和明确撤销的草案，不能要求逐字照搬。特别是头部已经撤销每次领取必须证明全部未来范围、预占资源的要求。

## 当前代码是否严格遵守

结论：**部分遵守，未完整实现；而符合此稿也不自动证明设计简洁。**

| 项目 | 当前证据 | 结论 |
| --- | --- | --- |
| Task 图不以所有前驱完成作为执行门槛 | `src/core/work-graph/tasks/eligibility.ts:24-28`，`:53-75` | 符合 9/24 纠偏；未来节点与可执行候选分开 |
| claim 不预占全部未来文件范围 | `tasks/claim-service.ts:509-527,632-634`（位于 WorkGraph） | 提交任务占用、Attempt、Run、outbox、Session；TaskLease 不等于全工作区资源预占 |
| 终态事实与新动作授权分开 | `tasks/execution-entry-service.ts:1368-1419`；`tasks/completion.ts:319-339` | 终态入账不重施新动作材料/角色准入；Run 结束不等于 Task 完成 |
| 原历史由 Kernel 持有 | `src/core/agent-runtime/session-operations.ts:767-800` | 经正式映射定向读取，普通历史读取不启动模型 |
| 同 Task 失败返工，建立新 Attempt/Run | `tasks/claim-service.ts:543`；`src/business/workflow/workflow.ts:198` | **未实现**：现路径拒绝/跳过已有 Run 的 Task；文档 §4.6/§5 却描述返工闭环 |

文档 §5 自身包含 Workflow → WorkGraph → WorkspaceTools 捕获、核验、保存来源的路径。用户强调“Agent 调用原子工具，结果反向维护图”，因此不能仅凭符合此技术稿，就为所有平台主动读取和分析步骤辩护。应以用户确认的行为裁定，每个入口说明真实消费者和独立职责。

## 有证据的简化候选

### 1. 浏览器中继自动推进：优先级高

`src/ui/main.ts:1173-1204` 的 `drainContinuation` 在浏览器最多循环 64 步，每步 HTTP 调用，收到后端的 next 后继续发送。`src/business/workflow/workflow.ts:701-710` 每次只做一次选择或操作。

这不是每步都要求用户点击，但内部 claim/prepare/start/check/complete 被拆成客户端往返。可考虑由 Host/Workflow 有界推进，直到真正需要决策、等待、结果未知或完成再返回；内部原子提交与进度观察仍保留。不能仅移动循环就声称获得持久后台恢复能力。

### 2. 固定 Host 配置的反复当前性校验：强候选

`src/app/host.ts:132-138` 明确启动时固定配置，不支持热重配置；`:181-192` 的 authorize 基于固定配置返回权限版本。与此同时：

- `src/core/agent-runtime/observed-model-run.ts:215,220` 在模型流前后检查源码权限当前性。
- `execution-driver.ts:553-568` 对内置 read 再调用 Host authorize。
- `exploration-tools.ts:131,133` 等扩展工具也在执行前后检查。

在当前本地 Host 的正常生命周期里，权限版本没有热变化路径。应优先绑定一次可信读取能力，在工具内部保留路径/权限检查，审查删除重复重取版本。通用 Host 接口可能允许其他实现，需核对实际消费者，不为假想动态 Host 保留整套常驻检查，也不能误删合法的 Material Grant revoke 约束。

### 3. 每个模型请求的双阶段准入：候选，尚未证明可直接删除

`src/core/agent-runtime/model-call-access.ts:63-99` 连续调用 authorizeModelRequest 和 recordModelRequestAttempt；`src/core/work-graph/tasks/model-call-service.ts:123,223` 两次调用 admitEnteredRun，重复读取执行链与上下文、角色、材料，并分别提交。

可以审查是否合并成一次“核对当前执行权并登记本次调用”的原子操作。必须保留同请求重放不重复调用 provider 的语义；不能把重放回执当作再次执行授权。尚未完成所有外部消费者和故障恢复等价性的证明。

### 4. Run 的 authorize → begin：同类候选

`execution-driver.ts:374,388,397` 依次授权、重读 Run、begin；`execution-entry-service.ts:949,1088` 两阶段分别检查材料/上下文并提交。文档本身就规定该协议，所以问题可能来自设计稿而非代码偏离。

若“已授权但未开始”没有独立产品消费者，可合并前置受理。不能合并掉 Kernel 副作用前的持久身份与副作用后的真实 entered/terminal 观察：两者有实际恢复边界，不是纯转发。

## 如何判断 A → B → C 中 B 是否必要

“B 中断后把错误返回 A”不足以判断；几乎所有正常封装都可能这样传播错误。更准确的删除标准是：去掉 B 后，是否仍保留相同的决策、原子提交、副作用去重/恢复和资源生命周期？

若 B 没有上述独立职责，只包装参数、透传 C 的回复，或要求 A 收到 next 后原样再调，那么它适合内联或合并。若 B 是领域事实 owner、事务边界或 Kernel 适配边界，则可以简化调用次数，不应仅按回复流向删除职责。

Workflow 当前有任务/Session 选择、检查汇合与完成顺序判断，不是空转发层；Runtime 是 Kernel 执行与平台事实的桥接。它们是否需要那么多协议阶段，应单独证明，不由模块名字决定。

## 身份定位与工具内部校验

AgentID / SessionID / TaskID 用于定位工作责任，但同一组合可经历多次返工或恢复，无法单独区分 Run1/Run2。当前 TaskRef 还带 projectId/goalId，不能未经迁移就假定局部 taskId 全局唯一。Run/Attempt 与工具 callId 表达不同粒度；保留原历史 callId，不意味着平台应为每个 call 建立准入状态机。

建议的职责边界：

| 时机 | 必要职责 | 不应自然扩展成 |
| --- | --- | --- |
| 领取/开始/恢复执行 | 平台确定 Session/Task 归属、占用和本次执行身份 | 每个工具重读全部图与绑定 |
| 工具执行 | 工具/Kernel 内检查参数、路径、当前适用权限、文件版本及实际副作用 | 平台再复制一次相同工具校验 |
| 写平台正式事实的工具 | 对应 WorkGraph owner 检查本次状态变更与原子提交 | 通用 Runtime 理解所有领域不变量 |
| 工具结果/执行观察 | 按执行与事件引用回流，维护必要图关系与历史 | 仅凭 Agent 文本自述更改正式状态 |

本次未发现“每个工具都跑完整平台准入链”；实际更重的重复链在每个模型请求，工具侧另有读取 hook 和控制安全点。暂停/取消检查与路径校验目的不同，应按合法生命周期分别裁剪。

本报告是有界静态审查，未证明运行时耗时比例、完整故障恢复等价性或全部重复代码。没有因行数或中断返回路径而直接删除生产逻辑。

## 后续复核：是否应清理，以及内存/中断判断

用户继续提出平台过度细化、Agent 编排落后，以及读取校验是否都应在内存、突发中断是否无法安全保存的问题。三个子 Agent 继续只读核查，结论如下。

**需要收缩重复机制，但“因为没有编排信息”不是已证实的根因。** [9 月 23 日用户纠偏](../intent/2026-09-23-PARALLEL-AND-PRODUCT.md)已明确工具检查、Agent/编排 Agent 决策修正；[编排状态机](../ORCHESTRATION-STATE-MACHINES.md)也已划分策略、原子提交、Kernel 执行和结果回流。旧实现迁入是[当时允许的复用策略](../intent/2026-09-24-TARGET-PROJECT.md)，不自动证明复制合理或不合理。当前证据更支持“机制实现与 Agent 消费闭环失衡”，不能把责任归因于用户催促或没有提供信息。

### 更具体的重复证据

- 单次准入的 `execution-entry-service.ts:541` 已读 `resolveRoleBindingFacts`，随后组合根 `create-platform.ts:153` 的 `resolveRoleBinding` 又经 `role-memory-service.ts:798` 调用同一解析器。每模型的两阶段正常路径共四次角色解析。应优先审查共享一次解析结果及提交 guards，保留正式提交时的版本保护。
- 当前固定 Host 的 authorize 只是内存 Map、数组和 hash 操作，不是重复数据库读。取消对不可变权限版本的反复查询，主要首先是逻辑简化，尚无耗时数据证明它是瓶颈。
- SQLite 模式下，执行事实、角色配置、manifest 等读取确实访问持久存储；不能因为函数返回 Promise 或返回对象，就把它们称为纯内存校验。memory 模式则采用内存后端。
- 对已进入 Run 每次重新解析 active Role/Policy，还需核对与“运行中的绑定保持原 pin”的契约是否一致；不能拿不存在的 Role 热切换作为保留重复读取的理由。

### 落盘与异常中断

`create-platform.ts:282` 按配置选择内存或 `ledger.sqlite`。`sqlite-record-store.ts:263` 的写事务保存记录、事件、占用和幂等回执，统一提交。读事务的 BEGIN/COMMIT 不表示把每个布尔校验结果写入账本。

已提交的事实与 Kernel 已保存的历史，不依赖中断是否由用户发起才得以保留。`execution-observation.ts:449,481` 可沿原历史窗口重新归约已保存事实。但尚未提交的内存、外部动作已发生而结果未记录的窗口，不能因此变成确定成功或安全重试；该文件 `:249-251` 的部分待处理缓存仍是内存 Map。突然退出时也不能指望最后运行一次清理函数保存所有现场。

当前只有持久事实与有限观察重建，**没有完整自动崩溃恢复**；`create-platform.ts:533-538` 的恢复能力仍明确不支持。不能用“要支持任意恢复”论证无限协议，也不能因恢复未完成而删除已提交历史和防重复执行依据。数据库提交同样不构成对磁盘损坏或任意外部副作用的保证。

### 建议清理顺序

1. 合并同一次准入重复角色解析，绑定当前 Host 的固定 capability，工具保留自身路径/参数/沙箱约束。
2. 核对既有 Run 的角色 pin、只在真实可变化的授权边界复核；保持材料撤权、实际控制与正式提交的必要保护。
3. 逐一证明后再压缩模型许可、Run 入口的两阶段操作，以及浏览器中继推进；保留幂等和未知结果语义。
4. 清点迁入契约和包装的真实消费者；无消费者且不承担既定必需行为的部分才删除，不能删掉未完成的多 Agent 产品要求来制造完成。

应清理的是重复解析、无实际变化条件的重校验、无独立职责的中继和多余阶段；不应把整个 RecordStore、Run 身份、原历史或正式提交一概改成仅内存。清理后应回到既定的 Agent 消费链，不再扩大平台机制。本轮只更新审查结论，未执行生产删改或新测试。

## 角色行为表之后的鉴权复核

2026-09-27，对当前工作树（包含已导入的 Role 解析复用、AG1 接线）再次有界静态核查。主审与三个子 Agent 分查执行准入、工具/消息和材料访问。结论：**仍有鉴权冗余，也有阻碍既定 Agent 行为的过粗限制；不支持“所有校验均必要”，也不支持“每次工具都经过完整平台鉴权”。** 本节没有修改生产代码、运行新测试或测量耗时；下列行号指本次工作树。

| 对象 | 当前证据与实际影响 | 判断和收敛边界 |
| --- | --- | --- |
| 固定 Host 权限反复检查当前性 | [host.ts](../../../src/app/host.ts) `132–138` 固定启动配置、无热重配置，`181–192` 从该配置返回权限；[execution-driver.ts](../../../src/core/agent-runtime/execution-driver.ts) `619–624` 重取版本，[observed-model-run.ts](../../../src/core/agent-runtime/observed-model-run.ts) `215/220` 在模型流前后调用；内置 read 的 hook `573` 也重新取同一权限 | **当前本地 Host 下确认冗余。** 可绑定一次可信权限，保留每次实际路径检查和控制停止；不把固定 Host 权限与可撤销 Material Grant 混为一谈。这里主要是逻辑成本，未证明是耗时瓶颈 |
| Query 整组禁止白板/邮箱工具 | [query-preparation.ts](../../../src/core/agent-runtime/query-preparation.ts) `115–117` 同时禁用两组全部名字，连 `query_task_graph`、`read_session_message` 也包含；[mailbox-service.ts](../../../src/core/work-graph/communication/mailbox-service.ts) `181–182` 拒绝 Query 身份，`1348` 回复仅允许 Work Run | **针对既定咨询行为过粗。** 文件只读不推出不能读平台事实；原消息回复也不能仅靠通用文件写权限表达。AG2 应按具体读取/原消息回复动作与真实身份窄化接线，不一键放开所有 Query 写工具；这同时是权限表达和消费者缺口 |
| 已绑定 Run 仍重查当前 active Role/policy | [execution-entry-service.ts](../../../src/core/work-graph/tasks/execution-entry-service.ts) `791` 每次准入调用 `recheckHostRoleAdmission`；[role-memory-service.ts](../../../src/core/work-graph/configuration/role-memory-service.ts) `642–658` 读 active，`717–721/764–766` 要求旧绑定与当前矩阵/active pin 一致 | **过严候选，尚非完整行为复现。** 合法激活新配置可能使旧 Run 下一次模型调用被拒；这不需要篡改 Session。须区分“新版本供后续装配”与“显式撤销已有执行权”，不能用不存在的运行中热换角色解释所有重查，也不能未核授权语义就直接删校验 |
| 每次模型请求连续两次全量准入 | [model-call-access.ts](../../../src/core/agent-runtime/model-call-access.ts) `76/87` 连续签发、消费；[model-call-service.ts](../../../src/core/work-graph/tasks/model-call-service.ts) `123/223` 分别调用 `admitEnteredRun`，再次加载执行、manifest、Role/Host 与材料 | **协议收敛候选。** 当前两事务之间确实可能取消/撤权，所以不能只删除消费前检查。应比较合并一次原子受理是否保留防重复 provider、原回执和未知结果语义。另有 `model-call-access.ts:66` 为取 revision 读取完整执行记录的范围成本，它不是第三次鉴权 |
| 材料 issuer 的重复纯判断 | [applicability.ts](../../../src/core/work-graph/materials/applicability.ts) `100–104` 已按 issuer 过滤；后续仅取非空子集，`120–122` 又判断同一条件 | **确认局部重复，约 3 行。** 不能把这点小重复当作材料撤权保护整体多余 |

同次 Role 重复解析已由[组合根](../../../src/composition/create-platform.ts) `148–160` 复用传入 resolution 修复；正常模型请求两阶段现在各解析一次，旧报告“四次”的数字不适用于当前代码。这次仍重复的是跨阶段完整准入，并非原问题尚未修复。

还应区分三条读路径：

- **Kernel 普通 `read`：** 有 Host 路径 hook 和 Kernel 自身工具/沙箱约束，不经过整个 Material Grant/执行准入链。可以简化固定权限获取，实际路径边界仍需保留。
- **`project_source`：** [source-capture-access.ts](../../../src/core/agent-runtime/source-capture-access.ts) `170–204/422–454` 对源码捕获操作检查当前 Run/控制和 envelope。动态执行权与取消有实际变化；固定 Run/Attempt/Role 身份的重复比较可另行收窄。同一次 access 已复用所加载的 Run，不应误报为在此处重复读两次。
- **Artifact 材料读取：** 当前 grant 回读与来源 I/O 后复核可防合法 revoke，见 [applicability.ts](../../../src/core/work-graph/materials/applicability.ts) `175–181/210–228`，不能因为都是“授权检查”就合并掉实际竞态窗口。

新增 AG1 发现入口也没有把普通读扩成全链准入：[session-directory.ts](../../../src/core/work-graph/sessions/session-directory.ts) `1083–1152` 精确读取一个 Run 并核身份/Workspace，不重新核 Lease、Role 或整条执行链，也不要求 Run 仍在 running。目录作用域和分页身份属于读取 owner 的必要边界。未来计划写入的相邻 `readExecution`（[plan-write-admission.ts](../../../src/core/work-graph/tasks/plan-write-admission.ts) `187/264`）则仍是读取合并候选，正式写权限与提交版本保护不能一并删除。

结合[角色动作表](../AGENT-ROLE-ACTIONS.md)，收敛方向是：固定职责/绑定/权限在装配时明确；可取消的执行权、可撤销的 grant 与共享状态版本只在相应动作或提交边界复核；参数、路径、文件变化交工具本身处理。优先处理阻碍 AG2 的权限表达，并在相关接线中收窄固定配置重查，不重启无界局部校验施工。
