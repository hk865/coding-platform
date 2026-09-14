# 代码模块入口

12 个设计模块各自拥有一个目录，**目录名即 Module**：看一眼路径就知道文件属于哪个 Module，`scripts/module-map.mjs` 的 `owner()` 也只按路径前缀判定。应用、组合根和共享契约是支撑目录，不属于这 12 个 Module。

## 12 个 Module 目录

- [ControlEngine](control/control-engine/README.md)：`src/control/control-engine/`（含 `policies/`、`records/`）
- [PlanCompiler](control/plan-compiler/README.md)：`src/control/plan-compiler/`
- [DispatchEngine](control/dispatch-engine/README.md)：`src/control/dispatch-engine/`
- [VerificationEngine](control/verification-engine/README.md)：`src/control/verification-engine/`
- [ArchitectureReconciler](control/architecture-reconciler/README.md)：`src/control/architecture-reconciler/`
- [HumanCollaboration](interaction/human-collaboration/README.md)：`src/interaction/human-collaboration/`
- [WorkerRuntime](execution/worker-runtime/README.md)：`src/execution/worker-runtime/`
- [StateLedger](data/state-ledger/README.md)：`src/data/state-ledger/`（内存 `in-memory-ledger.ts` 与 SQLite `sqlite-ledger.ts` 同目录）
- [ArtifactVault](data/artifact-vault/README.md)：`src/data/artifact-vault/`
- [ReadModelIndex](data/read-model-index/README.md)：`src/data/read-model-index/`（内存投影与 SQLite 投影同目录）
- [ContextCompiler](data/context-compiler/README.md)：`src/data/context-compiler/`
- [WorkspaceReader](data/workspace-reader/README.md)：`src/data/workspace-reader/`

## 支撑目录（不属于 12 Module）

- [应用与 UI 宿主](app/README.md)
- [组合根与测试宿主](harness/README.md)
- [共享契约](contracts/README.md)
- [原子文件替换机制](storage/atomic-file.ts)：支撑目录，只共享写入机制，不新增 Module 或恢复状态机

归属断言见 `tests/contracts/module-ownership.test.ts`；边界检查见 `scripts/check-module-boundaries.mjs`。2026-09-10 模块目录重组的 before/after 清单与路径映射见 `evidence/2026-09-10-module-folder-reorg/`。

当前修改顺序与完成状态见 [module-status](../../agent_learn/agent_dev/agent_platform/human/module-status.md)。
