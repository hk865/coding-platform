# CM-1A-001 实施交接（第 1 工作段快照 CM1A-001-snap-01）

- ticket_id：CM-1A-001
- ticket_path：`D:/1.project/Software/agent_learn/agent_dev/agent_platform/dev_docs/planning/active/collaboration-memory/CM-1A-001.md`
- role：integration-implementer（同时担任本批实施统筹）
- workspace_root：`D:/1.project/Software/agent_platform`
- snapshot_id：`CM1A-001-snap-01`
- **交付状态：实施中（不是"交付待验收"）**。本工作段只完成契约与账本层。
- 本票/本批**均未完成**，A01–A12 **没有任何一项**可以标记为通过。

---

## 1. 做了什么

本工作段把 CM-1A-001 需要的**协作通信协议与账本权威**落地：AgentInstance / WorkParticipation /
DirectedRequest / Subscription / Delivery / WaitCondition / CommunicationIntent / CommunicationAdmission
以及两个可重建的登记投影（CoordinationRegistry、WorkMailbox），加上它们的 20 个事件与 14 个 ledger commit 形状。

### 1.1 生产者 → 消费者调用路径（本工作段已建立的部分）

```text
调用方（未来：Host 协作工具 Adapter / HumanCollaboration）
  → Control handler（**尚未实现**）
      → 确定性 fold 构造（records/coordination.ts，**已实现**）
          → StateLedger.commit(CommunicationLedgerCommit)（**已实现并接线**）
              → 两个适配器共用同一份 validateCommunicationCommit（**已实现**）
                  → events / snapshots / idempotency / CAS 一次原子写（复用既有 machinery）
```

**当前真实状态：这条链的上半段（调用方与 Control handler）不存在**，因此新契约目前**没有生产调用者**。
已实现并在测试中覆盖的是下半段：契约形状 + 校验器 + 两个适配器分派。

### 1.2 Control / Ledger 权威

- `Control` 是唯一 canonical 写入口（未来 handler 只经 `ledger.commit`）；
- `StateLedger` 只做幂等 / CAS / 原子写；本工作段**没有**新增第二写入路径；
- 幂等身份 = `commandIdentityKey`（本工作段把 `agentPrincipal` 折叠进该 key，防止跨 Agent 假幂等）；
- ledger 幂等判定**先于** CAS（沿用既有 `commitGeneric` 顺序，未改动）。

### 1.3 旧入口复用／替代

**没有替代任何旧入口。** 本工作段只在既有 `LedgerCommit` 分派点上**新增** commit kind，
既有 kind 的语义、守卫与测试完全不变（302 文件 / 1997 用例全通过为证）。

### 1.4 仍未实现的范围（见第 5 节与 `verification.md` §6）

Control handler、Dispatch 路由 handler、Context 侧 Delivery 材料接入、任何协作通信的运行时测试、
A01–A12 全部证据、`pnpm build` / kernel 构建 / UI / 真实模型样例。

---

## 2. 改了什么

### 2.1 本工作段新增（4 个文件，全部为新增）

| 文件 | 行数 | 内容 |
| --- | --- | --- |
| `src/contracts/coordination.ts` | ~1327 | 10 个聚合 ref、值类型、11 条命令、4 个回执、20 个事件、14 个 commit 形状、指纹函数、确定性 id 派生、纯 helper |
| `src/contracts/coordination-events.ts` | ~354 | 20 个事件的构造纯函数（无时钟、无随机源） |
| `src/control/control-engine/records/coordination.ts` | ~954 | Control 持有的确定性 fold / commit 构造（26 个导出） |
| `src/control/control-engine/policies/coordination-rules.ts` | ~247 | 纯决策：分页订阅选择、wait 条件求值、接续资格、intent 领取状态机、退避 |

### 2.2 本工作段修改（10 个文件）

| 文件 | 改动 | 为什么必须改 |
| --- | --- | --- |
| `src/contracts/command-event.ts` | `ActorRef` 增加 `{kind:"agent"; id; runRef}`；`CommandIdentity.agentPrincipal?`；`commandIdentityKey` 折叠 principal | A01 要求 Agent 归因，不能再用假 human 身份；折叠后才不会跨 Agent 假幂等 |
| `src/contracts/validation/identity.ts` | `validateActor` 接受 `agent` 并要求精确 `runRef` | 结构面与类型面一致 |
| `src/contracts/events.ts` | `DomainEventV1` + `KNOWN_EVENT_TYPES` 增加 20 个事件 | 未登记事件会被 `isKnownEventType` 判为未知 |
| `src/contracts/ledger.ts` | `AggregateRef` / `AggregateSnapshot` / `LedgerCommit` 三个联合登记 | 新聚合/提交种类的唯一登记点 |
| `src/contracts/validation/event.ts` | `isActivationEvent` 登记协作通信的"聚合推进"事件 | 否则 `aggregateRevision >= 2` 会得到自相矛盾的诊断 |
| `src/data/state-ledger/ledger-validation.ts` | `validateCommunicationCommit`、`validateCommunicationSuccessorClaimCommit` | 两个适配器共用的唯一校验规则 |
| `src/data/state-ledger/sqlite-ledger.ts` | commit switch 增加 14 个 case + import | 分派点 |
| `src/data/state-ledger/in-memory-ledger.ts` | 同上 | **注意：`tsconfig` 未开 `noImplicitReturns`，漏改其中一个适配器不会报编译错**——两个必须成对核对 |
| `src/data/read-model-index/read-model-index.ts` | `isHandledEventType` 登记 20 个事件 | 未登记时任何一条通信事件落账会让**整页** `ProjectionStallError` |
| `src/data/read-model-index/sqlite-read-model-index.ts` | 同上 | 同一白名单的 SQLite 版 |
| `tests/contracts/module-ownership.test.ts` | `MODULE_FILE_INVENTORY["ControlEngine"]` 增加两个新文件 | 逐文件硬编码清单，不登记该用例必失败 |

### 2.3 用户原有改动的保留／重叠

- 用户原有的 26 个已跟踪改动 + 5 个未跟踪文件**全部保留**，本工作段**没有修改其中任何一个**。
- **重叠说明**：`tests/contracts/module-ownership.test.ts` 同时出现在"用户原有改动（仅末尾换行差异）"与
  "本工作段改动（追加 2 条 inventory）"中——本工作段在该文件上只做了**追加**，没有触碰原有的换行差异。
- 另一类**归属未证实**的 25 个工作树改动见 `verification.md` §4.3，本工作段一律保留、未回退。

### 2.4 基线 → 交付差异

本工作段的差异是**在上述三类工作树状态之上追加的 14 个文件**（4 新增 + 10 修改）。
**不要把 `git diff HEAD` 当作本票成果**：它同时包含用户原有改动与第 4.3 节的未证实改动。
逐文件识别方法见 `verification.md` §4；本工作段每个被改文件的 mtime 都晚于准备基线采集时刻。

---

## 3. 依赖什么

| 项 | 值 |
| --- | --- |
| 产品仓 HEAD | `0eb02717d16412298c786166a75ca1a9d3e05ac7`（`main`，**本工作段未移动 HEAD**） |
| 文档仓 HEAD | `e99484fb2bd3296a32d8442e74b47d8ed569b3d5` |
| 采用基线 | `baseline/preparation-baseline.json`（`captured_at` 2026-09-12T15:00:46.376Z） |
| Node / pnpm | v24.18.0 / 11.21.0（WSL2 Linux 6.18） |
| 内核 dist | `vendor/coding-agent/dist/app/cli/main.js` 存在（官方 runner 的前置） |
| bubblewrap | `.local/toolchains/bwrap/usr/bin/bwrap` 0.9.0；**`scripts/test-wsl.sh` 会自己找它并做 probe** |
| Linux runner | `.local/linux-test-tools/node_modules/vitest/vitest.mjs` 存在 |
| 上游文档摘要 | `baseline/upstream-documents.json` |

### 3.1 实际 Gate

**Gate A 未成立。** 依据：A01–A12 无任何运行证据；Control/Dispatch/Context 三段未实现。
本工作段只产生"静态一致性"证据（类型、模块 DAG）

### 3.2 技术裁决（D01–D05）

见 `decision-log.md`。关键三条的落地状态：

| ID | 裁决 | 落地状态 |
| --- | --- | --- |
| D01 | Task outbox 原地演进，不建第二 Task authority | 契约面已按此：新增 14 个 kind 中只有 `communication-successor-claim` 携带 `outboxIntents`，且该校验器要求"恰好 1 条且与 outbox 快照逐字节相同" |
| D02 | wait 接续资格 = 条件满足 ∧ 前驱已公开结束（同事务 admission） | 纯规则（`evaluateSuccessorEligibility`）与 successor commit 构造已实现；**运行时未验证** |
| D03 | ActorRef 增加 agent kind + exact agentPrincipal | 已实现并登记；`validateCommandIdentity` 仍**不**校验 `agentPrincipal` 结构（见未解决问题 T6） |
| D04 | 两类 intent 复用同一机械 claim/settle；四个可达终态 | 状态机与 commit 构造已实现；**运行时未验证** |
| D05 | 不新增第二生产入口 | 未改动任何既有入口；共存清单已登记在 decision-log |

### 3.3 正式 Interface 同步位置

**本工作段没有改任何正式 Interface 文档。** 未同步项已在第 5 节列为待办（T8）。

---

## 4. 怎样重跑

```bash
cd /mnt/d/1.project/Software/agent_platform

# 1) 类型（期望退出码 0、零诊断）
npx tsc --noEmit

# 2) 模块边界与归属（期望退出码 0、issues 为空）
node scripts/check-module-boundaries.mjs

# 3) 本工作段直接相关的测试（期望 54 文件 / 329 用例通过）
bash scripts/test-wsl.sh tests/ledger tests/sqlite-ledger tests/read-model \
  tests/sqlite-read-model tests/contracts tests/contract-suite

# 4) 全量回归（期望 302 文件 / 1997 用例通过）
bash scripts/test-wsl.sh
```

> **必须用 `bash scripts/test-wsl.sh`，不要用 `npx vitest run`。**
> 官方 runner 会写隔离 runner 配置、注入 `CODING_AGENT_BWRAP_PATH` 并执行 sandbox preflight。
> 绕过它会让依赖命令检查的用例（`tests/verification/*`、`tests/control/reviewer-*`、`tests/restart/*` 等）
> 假失败：`npx vitest run` 得到 `29 failed | 273 passed (302)` / `130 failed | 1867 passed (1997)`，
> 而**同一文件在同一工作树**用官方 runner 运行时 19/19 全通过。

未运行（**不是本工作段的通过项**）：`pnpm kernel:build`、`pnpm build`、`pnpm ui:build`、
`pnpm ui:typecheck`、`pnpm ui:test`、任何真实模型样例、任何浏览器验证。

原始日志：`logs/typecheck.log`、`logs/boundaries.log`、`logs/ledger-readmodel-contracts.log`、
`logs/full-tests.log`、`logs/verification-rounds-wsl.log`。

---

## 5. 证明到哪里

### 5.1 A01–A12 逐项结果

**A01–A11：未验证（无任何运行时证据）。A12：部分。**

| 项 | 结果 |
| --- | --- |
| A01–A11 | **未验证**。契约/fold/规则已写，但 Control handler、Dispatch 路由、Context 接入、真实消费者都不存在，因此这些标准的每一条都无法运行 |
| A12（静态部分） | `tsc` 0 诊断、`check:architecture` 0 issue、全量回归 302/1997 通过 —— **已通过** |
| A12（其余部分） | 构建未跑、Interface 文档未同步、独立审阅未做 —— **未通过** |

### 5.2 证据层次

- **确定性流程**：无（本工作段没有实现任何可运行的业务流程）。
- **真实内核 / Adapter 接入**：无变更。全量回归通过只证明**既有**行为未退化。
- **真实模型**：未运行。

因此本工作段**不能**报告任何 Gate 结论、记忆效果、产品行为或"通信已可用"。

### 5.3 本工作段真正证明的三件事

1. 14 个新 commit kind 与 10 个新聚合**已进入两个账本适配器**，并且有共用校验器；
2. 新事件**已进入** `KNOWN_EVENT_TYPES`、两个读模型白名单与事件校验白名单，不会因为"未登记"而停摆；
3. 既有 1997 个用例在全量官方 runner 下**全部通过**，即新登记**没有破坏**任何既有行为。

---

## 6. 怎样接手

### 6.1 数据兼容 / 迁移 / 恢复

- **无数据迁移**：新增的是新的聚合 ref 与 commit kind；既有库的既有快照与事件不改写、不删除。
- **旧库兼容**：`ledgerIdentityKeyFor` 对 `bootstrap` 之外一律 `commitKind + ":" + identityKey`，
  新 kind 自动获得独立命名空间，不需要新增特判。
- **恢复注意事项**：`OutboxIntents` 的非空校验在 `communication-successor-claim` 上由
  `validateCommunicationSuccessorClaimCommit` 保证；重启后由既有 `pendingDispatchIntents` 扫描发现（未改动）。
- **没有引入任何后台循环或进程内队列。**

### 6.2 未解决问题与阻断范围

| ID | 问题 | 阻断什么 | 建议下一步 |
| --- | --- | --- | --- |
| T2 | 协作通信 Control handler 未实现 | A01–A05、A07–A11 全部 | 新增 `src/control/control-engine/coordination.ts`，挂到 `ControlEngineImpl` 与 `ControlEngine` |
| T3 | Dispatch 路由 handler 未实现 | 投递、等待满足、后继 Run | 挂在唯一 `DispatchEngine.drive(trigger)` 内，不新增入口（D05） |
| T4 | Context 侧零接入 | A06 | 按 `RuntimeContextMaterials.rules` 通道接入 Delivery 材料 |
| T5 | 本票零协作测试 | 全部 | 补 `tests/coordination/*.test.ts`（必须用官方 runner） |
| T6 | `validateCommandIdentity` 不校验 `agentPrincipal` 结构 | 结构错误以 `invalid_commit` 暴露，诊断不精确 | 在协作命令自己的校验里补，不改公共校验器 |
| T7 | 25 个工作树文件归属未证实 | 基线可比性与回归归因 | **请用户裁决** |
| T8 | Interface / Module 文档未同步 | V15 追溯 | 实现成立后再按实际事实同步（不提前写） |

### 6.3 重现步骤（若要复核本工作段结论）

1. `cd /mnt/d/1.project/Software/agent_platform`；
2. `git status --short | grep -v "^?? evidence/" | grep -v "^ M evidence/"` —— 与 `verification.md` §4 的三类清单核对；
3. 按第 4 节命令逐条重跑；
4. 若某条命令的退出码或数量与第 4 节期望不符，先核对是否用了官方 runner。

### 6.4 可释放与不可释放

- **可释放（独立于本票结论）**：无。
- **不可释放**：任何依赖"协作通信可用"的后续票（M06、1C 的 Delivery 回流、1B 的回应 Context 消费者、
  I01–I04）。PLAN §7.1 的箭头要求这些依赖 **A 段实际 seam 证据**，本工作段没有产生任何 seam 证据。
- **可以安全并行推进、不依赖本工作段结论的工作**：有界只读调查（入口迁移清单、provider 调用证据接法等）。
