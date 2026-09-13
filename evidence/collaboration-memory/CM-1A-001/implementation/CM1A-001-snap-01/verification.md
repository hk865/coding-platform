# CM-1A-001 实施验证记录

- 快照 id：`CM1A-001-snap-01`
- 状态：**实施中**（第 1–2 工作段已完成契约/账本层与 Control 受理面）。Dispatch 路由、Context 接材、
  D06 的账本侧调用证据、A03–A06 的运行证据**尚未完成**，因此**本票尚未可交验**，A01–A12 一律未标记通过。
- 证据目录：`evidence/collaboration-memory/CM-1A-001/implementation/CM1A-001-snap-01/`

## 1. 采用的基线与源码快照

| 项 | 值 |
| --- | --- |
| 产品 HEAD | `0eb02717d16412298c786166a75ca1a9d3e05ac7`（`main`，**未移动**） |
| 文档 HEAD | `e99484fb2bd3296a32d8442e74b47d8ed569b3d5` |
| 采用的准备基线 | `baseline/preparation-baseline.json`（`captured_at` 2026-09-12T15:00:46.376Z） |
| Node / pnpm | v24.18.0 / 11.21.0（WSL2 Linux） |
| 用户原有未提交改动 | 全部保留，未回退、未覆盖；本工作段没有触碰其中的文件 |

工作树状态分三类（见第 4 节）：用户原有改动 / 本工作段改动 / **归属未证实的第三类**。

## 2. 本工作段实际新增与修改的文件

### 新增（4）

| 文件 | 作用 |
| --- | --- |
| `src/contracts/coordination.ts` | 协作通信契约：10 个聚合 ref、值类型、11 条命令、20 个事件、14 个 commit 形状、指纹与纯 helper |
| `src/contracts/coordination-events.ts` | 事件构造纯函数（无时钟、无随机源） |
| `src/control/control-engine/records/coordination.ts` | Control 持有的确定性 fold / commit 构造 |
| `src/control/control-engine/policies/coordination-rules.ts` | 纯决策：分页订阅选择、wait 条件求值、接续资格、intent 领取状态机、退避 |

### 修改（10）

| 文件 | 改动 |
| --- | --- |
| `src/contracts/command-event.ts` | `ActorRef` 增加 `kind:"agent"`；`CommandIdentity.agentPrincipal?`；`commandIdentityKey` 把 principal 折叠进身份键 |
| `src/contracts/validation/identity.ts` | `validateActor` 接受 `agent` 并要求精确 `runRef` |
| `src/contracts/events.ts` | `DomainEventV1` + `KNOWN_EVENT_TYPES` 增加 20 个协作事件 |
| `src/contracts/ledger.ts` | `AggregateRef` / `AggregateSnapshot` / `LedgerCommit` 三个联合登记新聚合与 commit 族 |
| `src/contracts/validation/event.ts` | `isActivationEvent` 登记协作通信的"聚合推进"事件（否则 `aggregateRevision` 诊断自相矛盾） |
| `src/data/state-ledger/ledger-validation.ts` | `validateCommunicationCommit` + `validateCommunicationSuccessorClaimCommit`（两个适配器共用） |
| `src/data/state-ledger/sqlite-ledger.ts` | commit switch 增加 14 个 case + import |
| `src/data/state-ledger/in-memory-ledger.ts` | 同上（与 SQLite 共用同一份校验器） |
| `src/data/read-model-index/read-model-index.ts` | `isHandledEventType` 登记 20 个协作事件（否则一条通信事件落账即整页 `ProjectionStallError`） |
| `src/data/read-model-index/sqlite-read-model-index.ts` | 同上 |
| `tests/contracts/module-ownership.test.ts` | `MODULE_FILE_INVENTORY["ControlEngine"]` 登记两个新文件 |

## 3. 已运行的验证（原始日志见 `logs/`）

| 命令 | 结果 | 日志 |
| --- | --- | --- |
| `npx tsc --noEmit`（= `pnpm typecheck`） | **退出码 0，零诊断** | `logs/typecheck.log` |
| `node scripts/check-module-boundaries.mjs`（= `pnpm check:architecture`） | **退出码 0，`issues: []`** | `logs/boundaries.log` |
| `bash scripts/test-wsl.sh tests/ledger tests/sqlite-ledger tests/read-model tests/sqlite-read-model tests/contracts tests/contract-suite` | **54 文件 / 329 用例全部通过** | `logs/ledger-readmodel-contracts.log` |
| `bash scripts/test-wsl.sh`（官方 runner 全量，第 1 工作段） | **302 文件 / 1997 用例全部通过** | `logs/full-tests.log` |
| `bash scripts/test-wsl.sh`（官方 runner 全量，**第 2 工作段后**） | **304 文件 / 2028 用例全部通过，0 失败** | `logs/full-tests-after-control.log` |
| `bash scripts/test-wsl.sh tests/coordination tests/contracts/module-ownership.test.ts` | **3 文件 / 40 用例全部通过** | `logs/coordination-tests.log` |
| `pnpm kernel:build` + `pnpm build` + `pnpm ui:typecheck` | 退出码 0（完整跑完 kernel/平台/UI 构建；需把 npm 所在目录加入 PATH） | `logs/kernel-build.log`、`logs/platform-build.log`、`logs/ui-typecheck.log` |
| `node dev_docs/verification/validate-docs.mjs`（文档根） | 退出码 0，13/13 通过 | `logs/docs-validation.log` |

> **测试入口纪律（本工作段学到的实证）**：`npx vitest run` 直接运行**不是**本仓的合法测试入口。
> 它缺少 `scripts/test-wsl.sh` 注入的 `CODING_AGENT_BWRAP_PATH` 与 sandbox preflight，
> 会让依赖命令检查的用例（`tests/verification/*`、`tests/control/reviewer-*`、`tests/restart/*` 等）
> 大面积失败：`npx vitest run` 得到 `29 failed | 273 passed (302)` 文件 / `130 failed | 1867 passed (1997)` 用例，
> 而**同一文件在同一工作树**用 `bash scripts/test-wsl.sh <同一路径>` 运行时
> **`tests/verification/verification-rounds.test.ts` 19/19 全部通过**（原始日志 `logs/verification-rounds-wsl.log`）。
> 因此该批次失败是**环境／入口问题**，不是本工作段的代码问题；本票的一切测试结论都以官方 runner 为准。
> BASELINE.md 已明确记录这一前置（"脚本会写隔离 runner 配置并执行 sandbox probe"）。

## 4. 工作树三类归属（诚实登记）

### 4.1 用户原有改动（准备基线内，26 已跟踪 + 5 未跟踪）

`IMPLEMENTATION-HANDOFF.md`、`src/app/governance.ts`、`src/contracts/commands/governance.ts`、
`src/contracts/completed-work-context.ts`、`src/contracts/context-continuity.ts`、
`src/contracts/execution-feedback.ts`、`src/contracts/initial-planning.ts`、`src/contracts/role-spec.ts`、
`src/contracts/validation/context.ts`、`src/contracts/validation/role.ts`、
`src/control/control-engine/records/role-spec.ts`、`src/control/control-engine/role-spec.ts`、
`src/control/control-engine/work-record.ts`、`src/control/dispatch-engine/planned-task-dispatch.ts`、
`src/control/dispatch-engine/role-spec-read.ts`、
`src/data/context-compiler/completed-work-context-compiler.ts`、
`src/data/context-compiler/query-context-compiler.ts`、`src/data/context-compiler/work-run-materials.ts`、
`src/data/read-model-index/governance-view.ts`、`src/execution/worker-runtime/coding-agent-runtime.ts`、
`src/execution/worker-runtime/observed-model-run.ts`、`src/ui/src/features/governance.tsx`、
`tests/app/initial-planning.test.ts`、`tests/app/role-spec-governance.test.ts`、
`tests/context/completed-work-regression.test.ts`、`tests/control/work-record.test.ts`、
`src/ui/tests/agent-templates.spec.ts`（未跟踪）。

**处置：全部保留，未修改、未回退。**

### 4.2 本工作段改动

见第 2 节（14 个文件）。

### 4.3 归属未证实的第三类（25 个文件）——**需要用户或后续验收者裁决**

它们的 mtime 为 2026-09-08～09-11（**早于准备基线采集时刻**），但准备基线的
`status`/`tracked_changes` 里没有它们，而 HEAD 自基线采集以来**未移动**。这一组合无法用
「本工作段改动」解释，也不能直接算作准备基线内容。

| 分类 | 文件 |
| --- | --- |
| 测试夹具（16） | `tests/restart/p1-02..p1-17-restart-fixtures.ts`（每处约 6 行） |
| 验证测试（3） | `tests/verification/feedback-decision-recovery.test.ts`、`feedback-investigation-authority.test.ts`、`feedback-renewal.test.ts` |
| 其他测试（2） | `tests/app/semantic-collaboration-fixture.ts`、`tests/contracts/module-ownership.test.ts`（后者本工作段又追加了 2 条登记） |
| 源码（1） | `src/control/control-engine/policies/integration.ts` |
| 文档/供应商（3） | `src/ui/UI-REPAIR-PROMPT.md`、`vendor/coding-agent/INTEGRATION.md`、`vendor/coding-agent/src/app/composition/composition-root.ts` |

**处置：一律保留，未回退。** 依据 AGENTS.md「保留与当前工作无关的未提交改动」。

## 5. A01–A12 适用性矩阵（**没有任何一项可以标记通过**）

第 2 工作段后，A01/A02/A03/A04/A07 的**局部语义**已有真实 InMemory/SQLite 用例覆盖（见下），但票面要求的
**完整闭环**（真实消费者、真实分页端到端、真实前驱结束接续、真实 Context 输入）都还没有，因此逐项仍是"未验证"。

| ID | 票面要求的完整闭环 | 第 2 工作段已覆盖的局部 | 仍缺什么 |
| --- | --- | --- | --- |
| A01 | Work/Run/AgentInstance/RoleBinding 关系可重建；换手后等待仍归 Work | ✅ 参与 @1 同事务 link、换手后可建新参与且等待/请求/订阅仍归该 Work、mailboxView 关系重建、投递不越权 | 同一 AgentInstance「至多一个 active participation」**不成立**（无身份槽，已收口为文档边界）；无真实运行时归因证据 |
| A02 | 定向请求/订阅经正式入口；同正文多 Work 可读、无权不可读；重复 replay、同键异载荷拒绝 | ✅ 幂等 replay、`idempotency_conflict`、`stale_participation` 零写入、body-first respond 的 digest 精确匹配 | **权限隔离的读取面**（两个获准 Work 可读、第三者不可读、相同 digest 不串权限）未验证 |
| A03 | 固定 event position/horizon 的分页路由；页 settle 单事务 | 分页纯规则 `selectPageSubscriptions` + Control 的 settle 复核 | **路由执行面未实现**（Dispatch 侧），无真实分页端到端 |
| A04 | 两个独立消费者/SQLite 连接竞争同一 pending 只有一个有效启动 | ✅ 两个消费者竞争同一 intent 只有一个 `claimed`、另一个 `owned_elsewhere`（零写入）；过期 generation settle 被拒 | **跨 SQLite 连接/跨进程**的竞争未验证；无"只调用一次副作用端口"证据 |
| A05 | all-wait 两种时序 + 唯一后继 + 前驱不重叠 | ✅ all-wait 注册 @1 + 同事务 deadline intent（InMemory 与 SQLite 各证一次） | **条件满足 → 唯一后继 admission** 无运行时证据；前驱结束资格未验证 |
| A06 | 目标 Delivery 版本进入捕获的实际 ModelRequest | 无 | Context 侧完全未接入 |
| A07 | 取消 desired-state-first 覆盖四种竞争 | ✅ 请求先落 `cancelled`；重复取消零写入 | 执行中取消、完成竞争、旧 generation 不覆盖新结果未验证 |
| A08 | 外部动作已发生但回执未落账 → 重启不重做 | 契约有 `outcome_unknown` 语义与 reconcile 终态枚举 | 无注入证据 |
| A09 | 多断点强杀后可恢复 | ✅ SQLite `close()`+`reopen()` 后参与/等待/intent 可读且 intent 仍可领取（generation=1） | canonical commit 后 wake 前、路由页前后、claim/start/bind 之间等断点未验证 |
| A10 | 两个只读 Run 真实并行、写冲突受控、backlog 可诊断 | 无 | 未验证 |
| A11 | ordinary Task 唯一 outbox；旧入口共存清单与回归 | 共存清单已登记（decision-log D05） | ordinary/reviewer 未与协作 intent 同 drive 收口；无回归证据 |
| A12（静态部分） | — | ✅ `tsc` 0 诊断、`check:architecture` 0 issue、全量 304/2028 通过、`pnpm build` 与 `ui:typecheck` 通过、文档检查 13/13 | Interface 文档只同步了 state-ledger 的 commit kind；独立审阅未做 |

## 6. 未解决问题与接手入口

| ID | 问题 | 影响 | 建议处置 |
| --- | --- | --- | --- |
| T1 | ~~全量回归 130 个失败未做决定性归因~~ **已归因** | — | 已用官方 runner 在同一工作树对同一失败文件重跑并全通过（见 3.1）；结论：入口/环境，非本票代码 |
| T2 | ~~Control handler 未实现~~ **已完成（第 2 工作段）** | — | `src/control/control-engine/coordination.ts` 已交付并挂载；12 handler + mailboxView |
| T3 | Dispatch 路由 handler 未实现 | 无投递、无等待满足、无后继 Run（A03–A05 的运行时部分） | 挂在唯一 `drive(trigger)` 内，**正在第 3 工作段实施** |
| T4 | Context 侧零接入 | A06 无法成立 | 经 `RuntimeContextMaterials.rules` 接入 Delivery 材料，**正在第 3 工作段实施** |
| T5 | ~~本票零单元测试~~ **已补（第 2 工作段）** | — | `tests/coordination/control.test.ts`（27 例）+ `control.sqlite.test.ts`（4 例） |
| T8 | `participation-start` 提交形状与账本白名单不一致（第 1 工作段留下的真实缺陷） | 会让参与关系**无法通过 Control 建立** | 已修为**专用校验器** `validateParticipationStartCommit`（不是只加白名单）；白名单登记只是附加 |
| T9 | D06 的账本侧 provider 调用证据未实现 | A06 只能在"捕获的请求 + manifest"层面证明，不能在账本层证明 | 下一个工作段按 D06 新增 `RunFactV1` 变体 `model_request_evidence` |
| T6 | `validateCommandIdentity` 未校验 `agentPrincipal` 结构 | 结构错误会以 `invalid_commit` 形式暴露 | 在协作命令自己的校验里补，不改公共 `validateCommandIdentity` |
| T7 | 第 4.3 节 25 个文件归属未证实 | 影响基线可比性与全量回归归因 | 请用户裁决 |

## 7. 重跑入口

```bash
cd /mnt/d/1.project/Software/agent_platform
npx tsc --noEmit                                  # 期望：0 诊断
node scripts/check-module-boundaries.mjs          # 期望：issues: []
# 测试必须走官方 runner（它会注入 bwrap 路径并做 sandbox preflight）：
bash scripts/test-wsl.sh tests/ledger tests/sqlite-ledger tests/read-model \
  tests/sqlite-read-model tests/contracts tests/contract-suite   # 期望：54 文件 / 329 用例通过
bash scripts/test-wsl.sh tests/coordination tests/contracts/module-ownership.test.ts
                                                  # 期望：3 文件 / 40 用例通过
bash scripts/test-wsl.sh                          # 全量（期望 304 文件 / 2028 用例通过）
# 不要用 npx vitest run 直接跑：缺 sandbox 配置会产生大量假失败（见 3 节）
```

未运行：`pnpm ui:test`、真实浏览器验收、真实模型样例、`A01–A12` 的任何完整闭环。
**这些不是当前工作段的通过项。**

> 2026-09-13 补充：构建与 UI 类型检查已单独补做并归档，见 [`build-verification.md`](build-verification.md)（含各命令原始退出码、产物事实、并发写入边界）。**A01–A12 仍未验证、Gate A 仍未成立；构建与全量回归通过只证明既有行为未退化。**
