# P1-07 集成者初始化 Prompt（Parallel Readers + single Writer）

> 本文件仿照 P1-06 开场 prompt 结构撰写，供将要承担 P1-07 集成者角色的 Agent 使用。
> 基线：P1-05 已验收（DAG 硬依赖满足）；P1-06 已验收且已在产品根（本票可消费其产物，但
> P1-07 的硬依赖仅为 P1-05——T07 不等待 T06 完成，DAG：T05→T07）。

---

你是 Agent Platform 的开发集成者，负责组织多个实现 Agent 并行编码，并亲自完成集成验收。
你没有此前对话，请以本地文档为依据。

### 目录与授权

文档根：`/mnt/d/1.project/software/agent_learn/agent_dev/agent_platform`；
产品代码根：`/home/han001/projects/agents/agent_platform`；
执行内核：`/home/han001/projects/agents/coding-agent`。

先核实路径与已有文件；**P1-06 结束基线 = 产品根 commit `f3a6a71`**（typecheck 0、
76 files/641 tests PASS、P1-06 双套件 25/25×2、集成 1/1、重启证据 1/1、
当时文档校验 12/12、6 项 Acceptance 全满足；本地 main 未推送 GitHub origin main——
按先例推送需用户授权）。

> 注：`dev_docs/verification/p1-06-implementation-evidence.md`（未提交）顶部仍记
> “local main = a9070e5”；以产品根当前 HEAD `f3a6a71` 为准，并在证据文档同步该行
>（交回文档维护时处理）。

**P1-07 与 P1-08 并行窗口已打开**（DAG：05 验收后 07、08 可以并行）；本票严格限定
“双 Reader 并行 + Evidence join + 唯一 Writer”，**不做** P1-08 只读控制台、P1-15 跨包冲突
语义路由/人类决定闭环（G3 等待 07+15，15 消费本票产物但不属本票）、P1-12 CodeGraph、P1-13/14。
本票以 active Attempt + verification path + 唯一 Writer lease 为限，**不触碰 Goal reducer**
（P1-05 已验收，不允许任何改写）。

### 第一阶段：先准备共享基础

先读取：
① [AGENTS.md](../../AGENTS.md)（P0-06 复核核对 + 完成边界）；
② [tickets/07-parallel-readers-single-writer.md](../planning/proposed/P1-foundation/tickets/07-parallel-readers-single-writer.md)
   ——**本票 Acceptance 共 8 项**：原 7 项 + 2026-09-06 扩展新增第 8 项（运行隔离，见验收段）；
   **2 个 interfaces_to_freeze**：DispatchEngine.WorkspaceLeasePort、
   WorkerRuntime.WorkspaceCapabilityPort；
   **5 个 contracts_to_create**：WorkspaceReadLease、WorkspaceWriteLease、
   ConflictScope、IntegrationTaskResult、PatchArtifact；
   **5 组 verification**：real-run-overlap-measurement / read-only-capability-enforcement /
   competing-writer-lease-test / evidence-conflict-test / goal-gate-full-check；
③ [DAG.md](../planning/proposed/P1-foundation/DAG.md)（07 边：T05→T07→T12，T07→T15，
   T07→G3；interfaces_to_freeze 规则——本票首次冻结两个最小 Interface，wire schema 以首个消费者为准）；
④ [PRODUCT.md](../../PRODUCT.md)（MVP 必证明：并发与写入安全独立验证；
   **非目标：多 Writer 同时修改同一 checkout**——同一 checkout 同时最多一个 Writer，但 Readers 可并行）；
⑤ [ARCHITECTURE.md](../../ARCHITECTURE.md)（全局不变量 #7：MVP 中同一目标 checkout 同时最多一个 Writer；
   ReadModel/ContextCompiler 同为 Data Plane；“并行、只读和写入权限是执行机制，不能代替角色定义”）；
⑥ [interfaces/runtime-collaboration.md](../interfaces/runtime-collaboration.md)
   （WorkspaceReader 只读语义、评审语义 Run 走正式 dispatch、报告/结论分离、
   outbox-before-side-effect、重复/迟到/冲突不改变未接受状态）；
⑦ [interfaces/context-lifecycle.md](../interfaces/context-lifecycle.md)
   （工作责任跨 Run；原 Run 旧 lease、迟到反馈和过期版本不能推进接续状态——
   本票 Reader 并行与 Writer 接续的语义来源之一）；
⑧ [interfaces/completion-policy.md](../interfaces/completion-policy.md)
   （§5 Evidence 冲突不能由后到结果覆盖，需继续验证或进入 Decision；§6 TaskSatisfied 公式；
   §10 权限边界：Worker 不可直接写状态）；
⑨ 产品代码根基线（`src/control/{dispatch-engine,claim,start-run,run-facts}.ts`、
   `src/runtime/fake-runtime-adapter.ts`、`src/context/context-compiler.ts`、
   `src/contracts/{dispatch,task-envelope,evidence,reduction,verification,review-context,
   handoff,handoff-context,handoff-control,goal-phase}.ts`、
   `src/control/{evidence-intake,task-reducer,goal-reducer,handoff,replacement-claim,
   handoff-drive}.ts`、双适配器 read-model、harness 双接线、p1-03/04/05/06 harness 与契约套件、
   restart 探针模式——**P1-03 冻结的 TaskLease/Attempt/Run 生命周期与 per-run sequence、
   P1-04 Evidence 不可变+applicability+EffectiveEvidenceSet、P1-05 reduceGoalPhase 纯函数+
   GoalPhaseUpdated、P1-06 HandoffPacket/ReplacementAttempt/evaluateReplacementEligibility
   全部为最大参照**）。

**并行说明（条件式）**：如与 P1-08 并行（另一 session），本票以隔离 worktree 为准，
禁止在 main 工作树直接工作（P1-05×P1-06 冲突事故教训见
`dev_docs/logs/conflict-reports/2026-09-06-p105-p106-merge.md`；共享面以“先到者优先、
后到者在新基线上 rebase”方式合并）。若未并行，则按常规单线实施。

然后直接实施。**必须裁决的技术决策（写入 HANDOFF “P1-07 契约与存储语义”）**：

1. **WorkspaceReadLease 有界形状**：可共享、可重叠、可重入；scope = ConflictScope
   （project+workspace+目标路径/模块）；来源 Run/Binding；到期/释放；只读能力由
   WorkspaceCapabilityPort 显式声明（unsupported 即拒绝）；Reader 输出只允许作为
   Evidence、Artifact、Handoff——任何写接口/工具路径在 reader context 中被拒绝
   （read-only-capability-enforcement）。
2. **WorkspaceWriteLease 独占**：同一 ConflictScope 同时至多一个有效 Writer lease
   （以 ledger 聚合 CAS 保证唯一；显式 acquire/release；重试/Force-release 属 P1-10 边界——
   本票只做独占获取与释放，不做取消/抢占）；MVP 层面同一 checkout(=workspace) 至多一个
   Writer（不变量 #7）；**competing-writer-lease-test = 两 Writer 并发 acquire 至多一个成功，
   失败零写入、可读回**。
3. **ConflictScope**：细粒度可组合、全键（project/workspace/scope-kind/id/revision）；
   作用域相交即冲突，不做语义推断；Writer lease 的 scope ⊆ 绑定声明（越权拒绝）；普通读不升级成写。
4. **IntegrationTaskResult**：join 已接受 Reader 输出（Evidence/Artifact/Handoff ref 链 +
   各方来源 Run/revision），**Conflict 不能被后到结果覆盖**——冲突显式保留并要求解释（explain）
   或升级（escalate——本票只记录“需要升级”标记，不做 P1-15 语义路由）；IntegrationTask 本身是
   正式 dispatch Run；join 不改变 Evidence applicability/reduction 语义（那仍归 P1-04/05 公式），
   只提供 join 事实与冲突面。
5. **PatchArtifact**：Writer 产出（patch/commit、changed paths、检查结果、application 前后
   Workspace revision）；正文 body-first 入 ArtifactVault，Control 登记引用；
   **post-write workspace snapshot**：patch 登记原子携带 workspace revision 推进
   （注：本票拟定义该推进机制，须以 integrator 现场核对既有代码为准；若已有先例则改述为沿用——
   canonical 单调推进、CAS）。
6. **两个最小 Interface**：
   - DispatchEngine.WorkspaceLeasePort（最小形状：至少 acquire/release，写方向带
     ConflictScope——命名与语义由你冻结）；
   - WorkerRuntime.WorkspaceCapabilityPort（capabilities 显式声明 workspaceRead/
     workspaceWrite 能力与 scope 上限；无能力 → unsupported，绝不静默降级）；
   - FakeRuntimeAdapter 扩展或新增替身（只读 runs 与 writer runs 分别可配置）。
7. **事件/视图**：新 v1 事件（WorkspaceReadLeaseGranted / WorkspaceWriteLeaseGranted /
   WorkspaceWriteLeaseReleased / IntegrationJoined(带冲突标记) / PatchRecorded——以你冻结为准）
   加入 DomainEvent + KNOWN（**与 isHandledEventType 新增同 commit 原子落地**）；ReadModel 投影：
   writer lease 状态视图、integration 冲突视图（只展示不判定）、patch 后 workspace revision 视图。
8. **重启等价**：lease/integration/patch 全经 SQLite 单事务；重启后 lease/patch/冲突视图/
   workspace revision 逐字段一致（isP107Ready() 探针自动启用）；ArtifactVault 正文持久化
   不在本票（同 P1-03/04/06 只存引用）。

**边界**：不做 P1-15 语义路由与人决定闭环（只保留“需要升级”标记）；不做 P1-12/13/14；
不修改 P1-03/04/05/06 冻结形状（零改动，只版本化追加）；Goal reducer 不动；无 Findings；
无 retry/抢占（P1-10）。

建立/扩展代码结构（实现可未完成，导出签名冻结）：
- `src/contracts/workspace-lease.ts`（Read/WriteLease + ConflictScope + 事件/命令/回执 +
  纯函数 evaluateLeaseAdmissibility／scopeOverlap）；
- `src/contracts/integration.ts`（IntegrationTaskResult）；
- `src/contracts/patch.ts`（PatchArtifact）；
- WorkspaceCapabilityPort（`ports.ts` 版本化扩展或独立文件）；
- fixtures（two-independent-reader-tasks 计划 fixture：两个无 depends_on 的 work reader task +
  一个显式 depends_on 两 reader 输出的 writer task + goal gate；governance pins 沿用既有 fixture）；
- validation 扩展；ledger commitKinds（workspace-lease-acquire/release、integration-record、
  patch-record——以你裁决为准）；ledger-validation 纯校验器；
- Control 入口骨架（`src/control/workspace-lease.ts`、`integration-join.ts`、`patch-record.ts`，
  stub→lane 填充）；harness 双接线；`defineWorkspaceContractSuite`（参数化，双 Adapter 必过；
  覆盖 8 项 Acceptance + 5 组 verification）；restart 骨架（isP107Ready()）；集成接线
  （InMemory/SQLite 同套件 + 真实 SQLite 全路径 + seal→reopen 逐字段一致）。

### 第二阶段：派发并行编码（建议三路，写入范围互不重叠）

- **A：Workspace lease + capability（Control/Process 面）**：Read/WriteLease acquire/release
  实现（独占 CAS、scope 越权拒绝、幂等、零写入映射）+ FakeRuntime 的 WorkspaceCapabilityPort
  替身/适配器（能力声明；reader run 无写能力）+ read-only-capability-enforcement +
  competing-writer-lease-test。只消费已冻结事实，不做集成 Join。
- **B：双 Reader 并行 + IntegrationTask（Dispatch/Process 面）**：两个无硬依赖 reader Task
  的**真实重叠**并行运行（各自独立 Attempt/Context/预算/来源；real-run-overlap-measurement：
  断言两 Run 时间区间重叠且互不阻塞，同 Stage 不产生隐式先后）+ IntegrationTaskResult join
  （ref 链、来源保留、**冲突保留不覆盖**、explain/escalate 标记；正式 dispatch）+
  evidence-conflict-test + goal-gate 前置。
- **C：ReadModel 投影 + 重启证据 + Writer/patch 端到端**：lease/integration/patch 事件
  双适配器投影（重建等价、全键隔离、freshness、冲突视图只展示）+ 持久化重启路径（isP107Ready 探针）+
  契约证据（仿 p1-06 证据文件模式）+ 集成骨架（可暂红）+ goal-gate-full-check 端到端
  （writer 用已接受 reader 输出 → patch 登记 → 后置 workspace snapshot → Gate Evidence 全量检查）。
- **D（补充，任一路安排）**：运行隔离用例——协调者角色绑定撤销/换手后，独立 Worker 的合法 lease
  保持有效（对应新增第 8 项 Acceptance 的“运行隔离”部分，不涉及跨包语义路由；语义路由归 P1-15）。

### 每次派发必须明确 / 并行写入规则 / 集成与验收（与 P1-06 prompt 同结构）

消息包含：ticket_id=P1-07、ticket_path、职责、workspace_root、共享基线（`f3a6a71` + 引用清单）、
精确 write_scope、允许命令、预期交接格式；子 Agent 不派发、不改 Ticket 状态、不新增依赖；缺口建议
交你统一修改基线。你维护 package/lock/配置、公共 schema/接口/共享 fixture、顶层入口/集成测试/交接、
跨模块文档；隔离 worktree 优先（`agent_platform-p1-07-[abc]`，branch `p1-07-lane-[abc]`，
从本基线 commit 派生）。子 Agent 不得修改 P1-03/04/05/06 文件、不得改动冻结签名。

**验收（原 7 项 + 新增 1 项 = 8 项）**：
1. 两个 Reader 的 Run 时间实际重叠，且各自有独立 Attempt、Context、预算和来源；
2. 同 Stage 或不同 Stage 不产生隐式先后，只有显式 RuntimeExecutionDAG `depends_on` 阻塞；
3. Reader 不能修改目标 Workspace，其输出只作为 Evidence、Artifact 或 Handoff；
4. Evidence 冲突不被后到结果覆盖，IntegrationTask 必须解释或升级；
5. 同一 conflict scope 同时最多一个有效 Writer lease；
6. Writer 使用已接受 Reader 输出，返回 patch/commit、changed paths、检查结果与 Workspace revision；
7. GoalGateTask 全量检查通过后 Goal 才可完成，失败事实仍可追溯
   （本票验证 Gate Evidence 路径与 reducer 可用，**不重写 reducer**）；
8. （2026-09-06 新增）多个工作包的角色 Context 与权限隔离；同一协调者退出不撤销独立 Worker 的
   合法 lease；跨包冲突的语义路由由 P1-15 集成，本票验证运行隔离。

检验五组 verification（real-run-overlap-measurement / read-only-capability-enforcement /
competing-writer-lease-test / evidence-conflict-test / goal-gate-full-check）；typecheck、单元、
双契约套件（含既有套件零回归）、集成（真实 SQLite 全路径 + seal→reopen 逐字段一致）、
`validate-docs 13/13`。

验收后记录（status 保持 `proposed`；证据 `dev_docs/verification/p1-07-implementation-evidence.md`；
HANDOFF 更新并注明 **G3 等待 07+15**）。

### 停止

P1-07 完成后停止并向用户报告；不自动开始 P1-12/15/其他票（G3 需 07+15 双验收，由用户/流程触发
下一窗口）。若与 P1-08 并行，合并共享面时按 P1-06 先例机械合并并用 `git diff` 只读比对证明零改动。

---

*注：本 prompt 已把 P1-07 的核心语义方向（read lease 可共享/write lease 独占/evidence join 冲突保留/
patch 携带 workspace revision 推进/两个 Interface 最小形状）作为建议裁决点列出；实际 wire 字段、
事件名、commitKind 命名仍以承担后的 integrator 冻结为准（首个消费者冻结原则）。*
