# R4a Sol 骨架与独立契约交接

> 完成状态（2026-09-24）：骨架已由 dsh 实现并通过[独立验收](../reviews/R3a-R4a-sol-dsh-acceptance.md)。下文保留初始 RED 基线；后续新增 resolveRecoveryWorkspaceOptions 机械骨架与 7 项环境对照。最终 3 个内部函数已接线，17 项独立契约通过，不再是占位实现。

日期：2026-09-23。状态：**骨架未接入生产；独立测试 RED，待 dsh 实现与主 Agent 验收。**

## 已落盘的接口与事实

新增 `coding-platform/vendor/coding-agent/src/app/composition/recovery-contract-types.ts`，冻结内部 `RecoveryTarget`、`EffectiveRecoveryConstraints`、`RecoveryConstraintEvidence` 类型；`recovery-contract.ts` 仅重导出类型并提供两个明确抛错的占位函数：

- `selectRecoveryTurn(records, target)`：`target=null` 对应旧 CLI 的最新 Turn；稳定 `runId/turnId` 对应精确目标，返回目标 Turn 的独占事件范围。必须用现有 Session 记录和 reducer，不按最新 Turn 代替目标。
- `requireEffectiveRecoveryConstraints(evidence)`：只接受 `recorded` 与 `supplied` 两份有效约束，在任何继续执行、恢复对账写入之前核对原预算、WorkspaceSandbox/ProcessSandbox 选项和宿主非只读工具授权。`recorded=null` 的执行恢复必须抛 `StoreError('conflict', ...)`；terminal 重放和只读旧日志由调用路径单独处理。没有 `legacyDefaultProven` 等布尔捷径。

这两个函数当前显式 `throw`，未被组合根导入。dsh 只填 `recovery-contract.ts` 的函数实现；`recovery-contract-types.ts` 由主 Agent 冻结为只读。不得把未完成函数接到生产默认路径。不要造 `PolicyResolver`、外置权限表或扩大 `public-api`。

现有缺口可定位到：`composition-root.ts` 旧身份分支调用 `resumeCodingAgent` 时丢失目标；`resume-composition.ts` 与 `RecoveryCoordinator.recover` 均选最后一个 `turn.started`；`RecoveryCoordinator` 的环境检查只覆盖 `willContinue`，paused 被跳过。`RunConfigSnapshot` 仅有 `baseConfigDigest`、预算与几个版本摘要，没有原 `workspaceOptions` / `processSandboxOptions` / `hostAuthorizedTools` 的可重建值。单靠摘要不能重建沙箱。

## dsh 实现位置与兼容规则

1. `runCodingAgent` 的旧身份命中分支传递内部目标。`resumeCodingAgent` 保持公开签名，新增私有入口或内部可选参数；无目标仍为最新 Turn。**主 Agent 审定的单一选择算法位置**是现有 `recovery-coordinator.ts` 的 Core 命名导出纯函数（目标类型在 Core 用结构形状表示，不反向导入 app 类型）；`RecoveryCoordinator.recover` 与 app 的 `recovery-contract.ts/selectRecoveryTurn` 薄委托共用它。`resume-composition.ts` 也沿这个结果取目标 `turn.started/contextBasis`。选中范围止于下一条 `turn.started`，不能读入后续 Turn 的事件、checkpoint 或返回值。terminal 重放零模型调用、零新记录。
2. 新执行在现有 `turn.started.payload` 和 checkpoint 正文中保存可重建的原**有效**限制，包含限额、具体 denied prefixes、进程沙箱选项、宿主授权名单。字段作为可选兼容扩展，更新现有 strict schema / checkpoint draft 与 codec；checksum 对旧记录按旧原正文校验，新记录按新增字段的真实正文校验。不要把 secret/API key 写入记录。未知版本明确拒绝。
3. 恢复先从原记录和 checkpoint 核对约束，再装配 workspace、policy、runner；paused 也必须经过核对。等值原约束可继续；试图提高预算或放松权限必须拒绝，或者恢复原约束继续。`RunState.usage` 的已用计数和旧 deadline 不能清零。checkpoint 只能加速，不是取代 `turn.started` 的证据。新增记录写入前须解析默认值，按 `recovery-contract-types.ts` 中必填的有效约束字段保存，而非仅保存调用者可选覆盖。
   主 Agent 另审定 Sol 在 `WorkspaceSandbox` 增加 `maxFileBytes` getter、`ProcessSandbox` 增加 `effectiveOptions` getter：从实际构造对象读取生效上限、已规范化并过滤的保护路径、只读路径与执行路径，不在组合根复制默认常量。两个 getter 文件由 Sol 交付后冻结，dsh 不修改。
4. 老 `schemaVersion=1` 无新字段的记录继续按旧正文读取、校验与 terminal 回放。现有 `baseConfigDigest` 无法证明调用者当时没有额外传入沙箱/授权选项；无新字段的旧记录在需要继续执行时一律拒绝，不凭外部布尔值或猜测放行。不得改写历史正文。

## 精确文件范围

Sol 已新增且 dsh 不应修改：

- `coding-platform/vendor/coding-agent/tests/review/R4a-recovery-contract.test.ts`；
- `coding-platform/vendor/coding-agent/tests/review/independent-r4a-session-recovery.test.ts`（既有冻结文件，hash 保持）；
- `coding-platform/vendor/coding-agent/src/app/composition/recovery-contract-types.ts`（类型冻结为只读）；
- `coding-platform/vendor/coding-agent/src/sandbox/workspace/workspace-sandbox.ts`（Sol 新增 `maxFileBytes` 只读 getter 后冻结）；
- `coding-platform/vendor/coding-agent/src/sandbox/process/process-sandbox.ts`（Sol 新增 `effectiveOptions` 只读 getter 后冻结）；
- 本文档。骨架 `src/app/composition/recovery-contract.ts` 交 dsh 填两个函数，不得修改独立类型。

允许 dsh 修改的生产文件，限于下列精确路径：

- `coding-platform/vendor/coding-agent/src/app/composition/recovery-contract.ts`
- `coding-platform/vendor/coding-agent/src/app/composition/composition-root.ts`
- `coding-platform/vendor/coding-agent/src/app/composition/resume-composition.ts`
- `coding-platform/vendor/coding-agent/src/core/runtime/recovery/recovery-coordinator.ts`
- `coding-platform/vendor/coding-agent/src/core/ports/session_store/session-store-port.ts`
- `coding-platform/vendor/coding-agent/src/core/ports/checkpoint_store/checkpoint-store-port.ts`
- `coding-platform/vendor/coding-agent/src/core/runtime/checkpointing/checkpointing-event-sink.ts`
- `coding-platform/vendor/coding-agent/INTEGRATION.md`

如 codec 的实际读写校验需要改 `src/storage/adapters/sqlite` 下某个具体文件，先给主 Agent 报准确路径、原因和兼容语义，再由主 Agent 审定扩大清单。dsh 可另增**自己的**必要回归测试，不改上述两份独立测试。平台代码、公共 API 导出和其他模块不在本范围。

## 骨架校验与当前基线

在 Kernel 目录使用 `source /home/hyh001/projects/coding-platform/.toolchain/env.sh` 后，运行：

```sh
node node_modules/typescript/bin/tsc --noEmit
node node_modules/vitest/vitest.mjs run tests/review/R4a-recovery-contract.test.ts
node node_modules/vitest/vitest.mjs run tests/review/independent-r4a-session-recovery.test.ts
```

Sol 当前实测：类型检查通过；新增契约 4 项中 **1 通过 / 3 失败**。RED 分别是中间已完成 Run 重放返回最新 Run、paused 后提高原预算被接受、paused 后省略 denied prefix 读到了真实存在的受限文件。第三项测试在 `private/note.txt` 写入合成哨兵，成功续跑必须有拒绝的工具结果且模型请求不得含哨兵；缺文件造成的 `ENOENT` 不再产生虚假绿。唯一通过项验证旧无 `contextBasis` 记录可读且不改写。冻结独立文件本轮未修改，之前基线为 3 通过 / 3 失败；dsh 修复后须重新运行并报告真实结果。

本轮未运行 build、完整 suite 或付费模型。所有测试模型均为本地替身，SQLite 为真实文件库。主 Agent 在生产修复后做最终集成检查。
