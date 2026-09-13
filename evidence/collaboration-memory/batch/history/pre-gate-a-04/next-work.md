# 后续工作段入口（给下一个实施工作段 / 接手者）

本文件是**工作段之间的接续点**，不是新的产品状态机。权威顺序永远是产品源码 > 正式规范 > 本目录。

## 当前停点（第 1 工作段末）

- 已完成：CM-1A-001 的**契约层 + 账本层**（4 新增 + 11 修改；见 `CM-1A-001/implementation/CM1A-001-snap-01/handoff.md` §2）。
- 未完成：Control handler、Dispatch 路由、Context 接入、协作测试、A01–A12 全部证据。
- 证据快照：`CM1A-001/implementation/CM1A-001-snap-01/`（handoff / decision-log / verification / source-snapshot / logs）。

## 已验证的静态事实（可继续依赖）

| 事实 | 命令 | 结果 |
| --- | --- | --- |
| 类型一致 | `npx tsc --noEmit` | 退出码 0，零诊断 |
| 模块边界与归属 | `node scripts/check-module-boundaries.mjs` | 退出码 0，`issues: []` |
| 全量回归 | `bash scripts/test-wsl.sh` | 302 文件 / 1997 用例全部通过 |
| 本段相关面 | `bash scripts/test-wsl.sh tests/ledger tests/sqlite-ledger tests/read-model tests/sqlite-read-model tests/contracts tests/contract-suite` | 54 文件 / 329 用例全部通过 |

**测试入口必须是 `bash scripts/test-wsl.sh`**（注入 bwrap 路径 + sandbox preflight）。
用 `npx vitest run` 会产生 130 个与本票无关的假失败。

## 下一步（按依赖顺序）

1. **协作通信 Control handler** —— 新增 `src/control/control-engine/coordination.ts`，把
   `records/coordination.ts`（14 个 fold）与 `policies/coordination-rules.ts`（纯决策）接到
   `ControlEngineImpl` 与 `interface ControlEngine`。守卫顺序与拒绝码见 `CM-1A-001.md` §4。
   新文件必须登记进 `tests/contracts/module-ownership.test.ts` 的 `MODULE_FILE_INVENTORY["ControlEngine"]`。
2. **Dispatch 路由 handler** —— 挂在唯一 `DispatchEngine.drive(trigger)` 内，**不新增第二生产入口**（decision-log D05）。
   页提交必须是一个 generation-guarded CAS（Deliveries + checkpoint + wait transition + next intent + settle）。
3. **Context 接入** —— 让目标 Delivery 的精确版本经 `RuntimeContextMaterials.rules` 进入真实模型输入（A06）。
4. **协作测试** —— `tests/coordination/*.test.ts`，必须用真实 `InMemoryLedger` + 真实 `ControlEngineImpl`；
   不许绕过 Control 直写账本。至少覆盖 A01–A05、A07、A09 的可运行子集。
5. **A06 的 provider 证据层次（已裁决，见 decision-log D06）**：真实 ModelRequest 摘要目前只落本地 journal
   （`MeterEntry.inputDigest`），账本可见的 runtime 证据只有 5 种起始/终态事件，`RunFactV1` 是封闭的两支。
   裁决：**新增 `RunFactV1` 变体** `model_request_evidence`（`requestId / requestDigest / contextInputDigest /
   deliveryRefs / observedAt`），复用 `RunFactCommand` + `RunFactLedgerCommitV1` 的 CAS 与去重，**不新增写通道**、
   **不污染 `RuntimeEventType`**（它被 `isTerminalRuntimeEvent`、`goal-phase` 策略与 `goal-reducer` 共同消费）。
   `provider_call_authorized` 必须由 Control 侧一次性许可给出；`acknowledged` 只在 provider 回执可得时表述
   （今日唯一信号是 `MeterEntry.status='reported'`），否则诚实停在 `attempted`。
6. **目标 Delivery 版本进输入**：`TaskEnvelopeV1` 目前无 Delivery 字段、`SourceRefV1.kind` 是封闭四值。
   后继 Run 的 Delivery 绑定必须先成为 canonical 输入绑定，再经 `RuntimeContextMaterials.rules` 进入 `input`
   与 `manifest.selected`（正文进 input、摘要进 manifest，由 `manifest.inputDigest` 合并）。

## 新增聚合 / commit 种类时**必须**逐处登记的清单（第 1 工作段的实证）

1. `src/contracts/<family>.ts`：ref / snapshot / event / commit 形状，并入族联合。
2. `src/contracts/events.ts`：`DomainEventV1` + `KNOWN_EVENT_TYPES`。
3. `src/contracts/ledger.ts`：`AggregateRef` + `AggregateSnapshot` + `LedgerCommit`。
4. `src/contracts/validation/event.ts`：`isActivationEvent`（若该事件是既有聚合的**推进**，即 revision >= 2）。
5. `src/data/state-ledger/ledger-validation.ts`：新增 `validateXxxCommit`；通信族事件还要加进 `COMMUNICATION_EVENT_TYPES`。
6. **两个适配器成对改**：`in-memory-ledger.ts` 与 `sqlite-ledger.ts` 的 `switch (batch.commitKind)`。
   ⚠️ `tsconfig` **没有开 `noImplicitReturns`**，漏改一个适配器**不会**报编译错。
7. `src/data/read-model-index/read-model-index.ts` 与 `sqlite-read-model-index.ts` 的 `isHandledEventType`：
   漏登记会让**整页** `ProjectionStallError`。
8. **新增源文件时**：Module 目录内要同步 `tests/contracts/module-ownership.test.ts` 的 `MODULE_FILE_INVENTORY`；
   绝不能放 `src/data/` 或 `src/control/` 顶层（会变成 Unmapped）；`src/contracts/` 可以放，但**不得**从那里 import 实现路径（连 `import type` 也不行）。

## 快照可复算（第 5 步的一项，已提前完成）

`scripts/source-snapshot.mjs` 是本仓**统一**的源码快照脚本（第 5 步要求的"统一脚本"）：

```bash
node scripts/source-snapshot.mjs                          # 打印 JSON
node scripts/source-snapshot.mjs --out <snapshot.json>    # 写入快照
node scripts/source-snapshot.mjs --diff <old.json>        # 与旧快照逐文件比较
```

它实现 BASELINE.md 第 5 节的算法，并**额外输出逐文件哈希**，使独立验收可以核对任意单个文件而不只信一个总指纹；
`--diff` 给出新增/删除/变化三类清单。已实测：同一状态重复运行指纹一致，`--diff` 自比为全空。

## 待用户裁决

工作树中有 25 个文件的改动**既不在准备基线内、也不属于本次工作段**（mtime 早于基线采集时刻，但基线
`status`/`tracked_changes` 未记录它们，而 HEAD 未移动）。清单与影响见
`CM-1A-001/implementation/CM1A-001-snap-01/verification.md` §4.3。本工作段一律保留、未回退。
