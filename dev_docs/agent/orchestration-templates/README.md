# 开发 Agent 编排模板（A / B / C）

本目录是开发流程的 **Agent 模板出处**：主 Agent（A）按 DevelopmentTicketDAG 派发实现 Agent（B），
冲突/缺口派发咨询 Agent（C）；全部模板由 A 加载并填充后派发。历史逐票 prompt（P1-02/P1-07 开场、
对账审查任务书）是这些模板的实例，保留在 `../` 与 `verification/`。

## 角色与权力矩阵

| 角色 | 文件 | 下发子 Agent | 写权限 | 主要产出 |
| --- | --- | --- | --- | --- |
| **A 全局任务派发者** | **不在本目录**——A 的 prompt 由编排者（用户/会话/流程）直接下发，不模板化 | 可派发 B（ticket 实现）与 C（探索/冲突解决） | 共享面：公共 schema/接口/共享 fixture、顶层入口/集成测试/交接、文档与状态记录；负责合并与验收 | 派发决策、共享基线 commit、lane 合并、验收证据、HANDOFF、证据文档 |
| **B 实现 Agent（ticket worker）** | [agent-b-worker.md](./agent-b-worker.md)（模板） | **最多一级**（模块级子 worker，需 A 在派发时写明） | 仅派发消息中列出的 `write_scope` 文件 | 实现 + 单元/契约测试 + 交接报告 |
| **C 咨询 Agent（探索/冲突解决）** | [agent-c-consultant.md](./agent-c-consultant.md)（模板） | **无**（只读/分析） | 通常仅指定报告文件（或零写入） | 有界问题分析 + 可执行修复方案（谁改哪些文件、建议选项、推荐与理由） |

## 派发者（A）视角：启动时知道哪里去看

- 模板目录：本目录（先读本 README；**A 是角色说明**——它负责"哪里去看"与派发；B/C 模板是派发时生成消息的规则）。
- 文档根：`/mnt/d/1.project/software/agent_learn/agent_dev/agent_platform`
  - 入口与完成边界：`AGENTS.md`（含 Context pointers 读法规则——人类审阅层的三条）；
  - **人类审阅层（先理解需求/功能，再进票据）**：P0-06 当前产品/架构复核 `dev_docs/design/human-framework-role-review.md`
  （实现/修订 P1 前必核）、相关 design 审阅 `dev_docs/design/`；产品意图/范围争议 `dev_docs/product/用户需求原文.md`；
  对话来源索引 `dev_docs/product/README.md`（+ `conversations/`，历史回答只作来源）；产品定义 `dev_docs/product/产品定义.md`；
  决策理由 `dev_docs/decisions/INDEX.md`；Gate 场景 `dev_docs/evaluation/mvp-scenario.md`；
  **09-06 授权边界** `dev_docs/verification/2026-09-06-context-orchestration-sync.md`；
  - 产品边界：`PRODUCT.md`；领域词义：`CONTEXT.md`；架构与不变量：`ARCHITECTURE.md`；
  - 开发图：`dev_docs/planning/proposed/P1-foundation/DAG.md`（ticket 边、并行窗口、Gate 定义）；
  - 票据：`dev_docs/planning/proposed/P1-foundation/tickets/`（status 由流程依证据更新，实施者不改）；
  - 接口/模块语义：`dev_docs/interfaces/`、`dev_docs/modules/`；
  - 验收证据：`dev_docs/verification/p1-*-implementation-evidence.md`；文档校验：`dev_docs/verification/validate-docs.mjs`。
- 产品代码根：`/home/han001/projects/agents/agent_platform`
  - 实施语义与冻结记录：`IMPLEMENTATION-HANDOFF.md`（每票「契约与存储语义」+「已冻结的代码入口」+「三路并行」+ integrator 裁决）。
- 执行内核：`/home/han001/projects/agents/coding-agent`（产品不重写其模型循环）。

## 派发与汇合规则（P1-05..P1-08 已验证的流程；A 为全局任务派发者）

1. **DAG 视角派发**：仅派发 `blocked_by` 全部已验收的 ticket；并行窗口按 DAG 明示（例如 05 后 07/08；
   08+16 后 09/10）；Gate 未到不派发下游（G4=09+11、G5=13+14、G3=07+15、G2=05+06+16）。
2. **共享基线优先**：A 先读票据/接口/产品基线，冻结契约与签名（首次消费者冻结 wire schema），
   建立共享基线 commit（含 fixtures/harness/suite/restart 骨架；既有测试零回归），再派发 lanes。
3. **lane 隔离**：每个 B 一个隔离 worktree（`git worktree add -b p1-NN-lane-X`，从共享基线派生）；
   `write_scope` 互不重叠（冲突先例：跨票共享面以"先到者优先、后到者 rebase"机械合并；
   同票双 lane 撞文件时以区域标记取双边，由 A 在合并时裁决）。
4. **冲突/缺口汇报**：B/C 不擅自改共享面与冻结签名；缺口以"具体建议 + 涉及文件 + 影响消费者"报给 A，
   A 统一修改基线并通知；跨票/跨 lane 冲突（接口冲突、依赖语义、测试期望不一致）→ A 派 C 诊断，
   采纳 C 方案后路由给对应 B 修复。
5. **验收路径**：每票纵向验收路径内汇合——typecheck、双适配器契约套件、真实 SQLite 集成、
   seal→reopen 重启等价、文档校验、旧票据零回归；探针（`isP1NNReady()`）驱动的 auto-skip 骨架，
   实现落地后自动启用，**不用假实现冒充通过**。
6. **证据与状态**：证据 `dev_docs/verification/p1-NN-implementation-evidence.md`（验收映射 + 裁决 +
   命令记录），票据尾 Implementation record（status 保持 `proposed`），产品根 HANDOFF 同步
   （yaml 状态、共享基线、lane 表、裁决注记）。**Ticket 状态由开发流程依据证据更新，实施者不改**。
7. **停止与推送**：本票验收后停止，不自动开始下一票（下一窗口由用户/流程触发）；GitHub 推送需用户授权；
   gate 等待关系在 HANDOFF/证据中注明（如 G4 等待 09+11）。
