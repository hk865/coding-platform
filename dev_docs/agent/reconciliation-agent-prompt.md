# 对账审查 Agent 任务书：P1-00..P1-06 实现 × 当前开发文档

ticket_id: DOC-RECON-1（对账审查任务；不是 Development Ticket，不改任何 Ticket 状态）
role: reviewer（只读对账；除本任务书指定的唯一报告文件外，零写入）
workspace_root: /mnt/d/1.project/software/agent_learn/agent_dev/agent_platform（文档根）
product_code_root: /home/han001/projects/agents/agent_platform（产品代码根；当前 main = 404ab28，P1-07 已合并）
upstream_artifact_refs:
  - 09-06 架构变更的权威边界：dev_docs/verification/2026-09-06-context-orchestration-sync.md
  - 各票语义与验收：dev_docs/planning/proposed/P1-foundation/tickets/0{0..7}-*.md
  - 实施语义：产品根 IMPLEMENTATION-HANDOFF.md + dev_docs/verification/p1-05/06/07-implementation-evidence.md
write_scope:
  - dev_docs/verification/reconciliation-2026-09-06-p1-00-06-vs-docs.md（唯一可写文件；对账报告）
read_only:
  - 产品代码全部、dev_docs 其余全部、human/、archive/、既有 verification 证据

## 背景（已检知，需复核而非盲信）

2026-09-06 之前的架构变更（用户修订 + Context 生命周期/编排交互审阅）经授权同步了
PRODUCT/ARCHITECTURE/CONTEXT/interfaces/modules/DAG/Tickets，并明确：P1-00/01/02/05 冻结契约不变、
产品代码与旧 Evidence 不变、P1-03/06 保留原验收记录"只追加扩展归属"、G2 增加 16、G3 经 15 消费 17。
在此之后 P1-07 实施完成。现在要对账：**既有实现（P1-00..P1-06）与当前文档是否存在
（a）确定性语义冲突、（b）根因在旧实现的缺陷、（c）文档过期残留、（d）官方声明未落实的登记欠账**。

## 目标

产出唯一报告文件。报告回答三类问题：
1. 哪些是**真冲突/真缺陷**（实现违背文档确定性语义，或实现本身不可能满足文档承诺）；
2. 哪些是**文档层问题**（过期残留、登记欠账、表述级偏差）；
3. 每个问题给出**修复权衡与归属**（改文档 / 改代码 / 仅登记 / 推迟后续票；归属哪个原票 agent 或新建），
   并标注严重度（高=阻塞下游验收/真相源冲突；中=语义不精确；低=表述）。

## 必须逐条复核的已知线索（每条给出判定：确认/部分确认/证伪 + 一手证据引用 + 处理建议）

1. **依赖满足死锁（疑似高）**：P1-03 `evaluateTaskEligibility`（src/contracts/dispatch.ts）以
   plan 快照的 `task.phase === "satisfied"` 判定 depends_on 满足；PlanRevisionSnapshot 不可变 →
   带 depends_on 的 work task 永不可 claim。P1-07 已加 `src/control/dispatch-facts.ts::loadLivePlan`
   （readiness/claim 以 TaskReduction phase 覆盖派生）作为缓解。核对：该死锁与 ARCHITECTURE 不变量
   #8（只有显式 Runtime dependency 才阻塞调度）、PRODUCT 132（依赖"未满足"才确定性拒绝）是否真冲突；
   列出根因修复选项（a) 把 live-phase 判定收编为 P1-03 标准 facts 语义并登记；b) 版本化升级
   DispatchReadinessFacts；c) 其他），给出推荐与理由。
2. **startRun 幂等键复用（疑似已修复）**：P1-03 `DispatchEngine.drive` 曾用默认
   `idempotencyKey="p1-03-start"`（跨 run 共享 → 同 goal 第二次 start 必 idempotency_conflict）。
   已改为 run-scoped。核对代码并判定状态：已修复（仅需文档登记）/ 仍有残留路径。
3. **taskRevision 校验类型（疑似 P1-07 自身 bug，已修复）**：`validateRecordIntegrationResultCommand` /
   `validateRecordPatchCommand` 曾用 stringField 校验 number 字段；已改整数校验。
   同时核实 **P1-06 无同类问题**（`validateHandoffPacket` 用 safePositiveIntField，validation.ts:1788）。
4. **release 校验 expectedRevision（疑似已修复）**：release 命令的冻结语义是 1，校验器曾要求 0；已改。
5. **P1-07 bootstrap fixture（疑似已修复）**：P107 场景曾用未 bootstrap 的 proj-p107；已改用
   bootstrap 已建的 proj-alpha/ws-shared。核对各处（含重启/证据/套件）已无 ws-p107 残留。
6. **A5b 过期时钟（疑似已修复）**：固定时钟 2026-09-05T12:00Z 下曾用更晚的 expiresAt；已改早于时钟。
7. **G2 定义过期残留（疑似文档残留）**：DAG（09-06）定义 G2 = P1-05 + P1-06 + **P1-16**，但 ticket 06
   Implementation record yaml、p1-06-implementation-evidence.md（第 5/68 行）、产品根 HANDOFF P1-06 段
   仍写"G2 等待 05+06（已具备）"。核对全部出现处，列出需改句。
8. **PRODUCT 145 行过期残留**："A→B 接续及写入隔离仍需验证"——A→B 已由 P1-06 验收、写入隔离/并行已由
   P1-07 验收（时间线竞态：PRODUCT 更新于 P1-06 验收 commit 之前）。核对并给出建议改句（含 G3 仍需
   P1-15(+17) 的准确表述）。
9. **"只追加扩展归属"未落实（疑似登记欠账）**：`interfaces/{command-event,state-ledger,goal-view}.md` 与
   `modules/{control/control-engine,data/read-model-index,data/state-ledger,control/dispatch-engine,
   execution/worker-runtime}.md` 的 extension records 只到 P1-00/02/04/05（部分只到 P1-02），
   P1-03 / P1-06 / P1-07 缺失。逐文件列出：缺失记录标题、建议内容要点（事件/commitKind/方法清单 +
   契约文件路径指针，不复制 wire schema）、建议插入锚点。
10. **ARCHITECTURE Module Registry 161 行疑似表述偏差**："DispatchEngine `drive/accept；snapshot(query)
    公开快照`"——公开快照实现归属 P1-06 的 WorkerRuntime 控制面（HandoffControlPort.snapshot，
    noHiddenContextRead）；核对并给出改法或"待 P1-08 消费时再定"的权衡。
11. **workspace-reader.md 与 P1-07 关系（疑似无冲突，需注记）**：候选 `read(query) → sourced/unsupported/
    stale/rejected`、首个消费者 P1-12、`extension draft`；P1-07 的 reader 面是
    WorkspaceReadLease + WorkspaceCapabilityPort。判断是否需要一行交叉注记。

## 广度核对（不能只复核线索，需独立发现）

- **文档面**：AGENTS.md 启动/完成边界；ARCHITECTURE 全局不变量 #1–#14 逐条 vs 实现；
   Plane/Module Registry/ModuleDependencyDAG vs 实现归属；PRODUCT MVP 必须证明/非目标/成功标准；
   completion-policy §5/§6/§10；runtime-collaboration（outbox-before-side-effect、报告/结论分离、
   重复/迟到/冲突不改变未接受状态、评审语义 Run 走正式 dispatch）；context-lifecycle（旧 lease/迟到反馈/
   过期版本、FakeRuntime 能力诚实性声明、不支持恢复→不可用或授权新 Run 接续）；
   human-design-status（P1-06 公开快照/noHiddenContextRead）；DAG 09-06 增量与各票 blocked_by/gates 表述。
- **实现面**：对每个"疑似冲突"用一手证据判定——读契约源文件（src/contracts/**）与对应控制入口
   （src/control/**），必要时用只读命令验证：`pnpm typecheck`、`pnpm vitest run <针对性路径>`
   （如 tests/control/dispatch-drive.test.ts、tests/control/dispatch-readiness.test.ts、
   tests/control/workspace-lease.test.ts、tests/contract-suite/dispatch.contract.suite.ts 等，
   以说明"该行为有测试背书"为准；不要跑全量破坏性验证）。
- **登记面**：抽查 P1-05/06 票与新 DAG 的一致性（ticket 03/04/06 已有 09-06 归属段 ✓ 也请复核一遍）。

## 输出：报告文件结构（dev_docs/verification/reconciliation-2026-09-06-p1-00-06-vs-docs.md）

```yaml
status: draft-awaiting-decision
date: 2026-09-06
scope: P1-00..P1-06 实现 × 当前开发文档对账（含 P1-07 暴露的根因线索）
reviewer: <agent id / 会话名>
product_code_ref: 404ab28
doc_ref: doc 仓库最新提交 fec674e（对账时复述实际 HEAD）
```

1. **摘要**：结论一段 + 计数（确定性冲突 N / 文档残留 N / 登记欠账 N / 证伪线索 N）；
2. **逐项冲突矩阵**（每条）：编号、标题、类型（a-d）、严重度、一手证据（文件+行/命令+输出）、
   文档条款引用、当前状态（已修/待确认/残留）、修复选项与权衡（1-3 个，标注推荐）、归属建议；
3. **已验证无冲突清单**（简述判定依据，如 ARCHITECTURE #1-#14 逐条一行）；
4. **证伪/修正清单**（我们给的线索若与证据不符——明确指出并给反证）；
5. **未覆盖面与风险**（如：未逐行盲读全部模块文档、未跑全量套件、未验证非功能面）。
最终在对话返回同一报告的核心结论（勿粘贴全文，给摘要+文件路径）。

## 纪律

- 只读产品代码与 dev_docs（报告文件除外）；不改任何 .ts/.md/.json/yaml 既有文件；不 push；不改 Ticket 状态；
- 不派发其他 agent；不跑 `pnpm install`/写操作命令；git 只允许 status/log/diff/show/grep 类只读命令；
- 结论以一手证据为准：每条判 定必须给出"读了什么、跑了什么"；无法确认的写"未确认（原因）"而非猜测；
- 时间与范围：优先复核"已知线索 + 不变量/契约高置信面"；对模糊面（低价值长尾）宁可在"未覆盖面"声明；
- 需要时参照既有证据文档风格（p1-05/06/07-implementation-evidence.md）与文档 ownership
  （dev_docs/document-ownership.md），但**只读**。
