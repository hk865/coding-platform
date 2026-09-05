# IMPLEMENTATION-HANDOFF — Agent Platform 产品代码根

```yaml
ticket_id: P1-00
status: in_progress (共享基线就绪，三路并行编码已开始)
updated: 2026-09-05
integration_owner: integrator (本会话)
```

## 当前票据与共享契约基线

- Ticket：`/mnt/d/1.project/software/agent_learn/agent_dev/agent_platform/dev_docs/planning/proposed/P1-foundation/tickets/00-contract-pack.md`（P1-00）
- 规范与接口权威：文档根 `dev_docs/interfaces/**` 与 `dev_docs/modules/**`（见各文件头）
- 共享契约基线（integrator 已冻结，版本 v1 + P1-00 扩展）：
  - `src/contracts/command-event.ts` — Command/Event 切片类型、fingerprint（JCS+SHA-256）、objective 规范化（NFC + unicode trim）、identity 相等（(projectId, actor.kind, actor.id, idempotencyKey)）
  - `src/contracts/ledger.ts` — Ref/Snapshot/LedgerCommit(kind union: goal-create | bootstrap)/Receipt(含 not_empty)/EventQuery/EventPage/StateLedger；CommitCursor 为递增序列的 opaque token，仅 ReadModelIndex 可用 compareCommitCursor
  - `src/contracts/bootstrap.ts` — WorkspaceBootstrapCommand/Fixture/Manifest/Receipt、BootstrapCommandIdentity（bootstrap 不绑定单一 project）、bootstrap 事件 v1、BootstrapManifest aggregate
  - `src/contracts/goal-view.ts` — GoalView/GoalViewResult/ProjectionReceipt + ReadModelIndex 接口 + ProjectionStallError
  - `src/contracts/modules.ts` — ControlEngine（submit + bootstrap 扩展）、HumanCollaboration
  - `src/contracts/validation.ts` — 确定性运行时校验（unknown schema version 拒绝）
  - `src/contracts/fixtures/**` — 共享 fixture：WORKSPACE_BOOTSTRAP_FIXTURE_V1（两个 Project 复用同一本地 workspaceId）+ MULTI_SCOPE_CREATE_GOAL_FIXTURE_V1（同 goalId/幂等键，跨 Scope 隔离）+ 确定性 builder（fold 契约数学：ControlEngine 必须产出与 builder 一致的内容）
  - `src/contracts/testing/**` — 一致测试替身（ScriptedStateLedger/ControlEngine/ReadModelIndex、deterministic deps）
  - `tests/contract-suite/**` — StateLedger 与 GoalView 共享契约套件（每个 Adapter 都必须通过）

### bootstrap 语义（已冻结，避免各模块自行解释）

1. bootstrap 只允许“空库首次初始化”：ledger 无任何 Event/snapshot/idempotency 记录；
2. 同 identity+fingerprint 重放（含跨调用的同用例重试）→ committed, replayed=true，不追加任何写入；
3. 同 identity 异 fingerprint（如不同 entries/digest）→ idempotency_conflict；
4. 非空库上的不同 identity 的 bootstrap → not_empty（确定性拒绝，零写入）；
5. 全新空库 + 相同 fixture 的 bootstrap 结果（manifest/digest/revisions）确定一致；
6. Manifest 经 BootstrapManifest aggregate snapshot 持久化（ref.manifestId = sourceDigest），可 load 重建。

## 派发接口（固定入口）

| Lane | 职责 | 固定入口（baseline 锁定） | 写范围 |
| --- | --- | --- | --- |
| A | StateLedger InMemory 实现 | `src/ledger/in-memory-ledger.ts` 导出 `InMemoryLedger`+`createInMemoryLedger` | `src/ledger/**`, `tests/ledger/**` |
| B | ControlEngine（bootstrap+CreateGoal fold） | `src/control/control-engine.ts` 导出 `ControlEngineImpl`+`createControlEngine` | `src/control/**`, `tests/control/**` |
| C | ReadModelIndex + HumanCollaboration | `src/read-model/read-model-index.ts` (`ReadModelIndexImpl`)；`src/interaction/human-collaboration.ts` (`HumanCollaborationImpl`) | `src/read-model/**`, `src/interaction/**`, `tests/read-model/**`, `tests/interaction/**` |

Integrator 专用：package/lockfile/tsconfig/vitest、contracts、fixtures、suites、testing、harness、tests/integration、IMPLEMENTATION-HANDOFF、文档根同步。Lane C 依赖 A/B 之 Interface 与测试替身，不允许等待 A/B 完成。

## 已执行命令及结果

（基线阶段）

- 环境核实：node v24.18.0 (tooling)、pnpm 11.21.0、git 2.43.0、registry 可达（vitest 4.1.10 / typescript 6.0.3 与执行内核一致）
- 待补：pnpm install、基线 typecheck/test（contracts 单元应绿；integration 因 lanes 未实现为红——按计划）

## 验收证据

- 尚无。只有共享基线后三路汇合、集成路径全绿后才记录证据。红测试不代表验收，不承诺通过。

## 未解问题 / 设计理由

- CommitCursor 具象为 `c<10位序列>`：仅 ledger 适配器与 ReadModelIndex 可经 compareCommitCursor 比较；其他调用者按 opaque 处理（文档接口要求）。
- LedgerCommit / DomainEvent 为版本化 union（goal-create | bootstrap）：对文档中 CreateGoal-only 类型的显式扩展，已在接口文档中记录并同步。
- ControlEngine 接口新增 `bootstrap` 方法（版本化扩展）；submit 形状不变。
- “空库”检查在 ledger.commit 内部原子完成（bootstrap kind 的固有语义），不在 Control 做 check-then-commit。

## 下一步

- 三路并行编码（A/B/C）→ 汇合合并 → 替换测试替身 → 完整 tracer bullet → 按 P1-00 Acceptance 逐项验收存证 → 全量检查 → 更新本文件与票据 → 停止（不开始 P1-01）。
