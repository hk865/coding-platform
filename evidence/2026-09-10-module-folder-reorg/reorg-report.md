# 2026-09-10 模块目录重组（Module folder reorganisation）

**目标**：让人只看路径就能判断一个产品源文件属于哪个 Module，不再需要读 `scripts/module-map.mjs` 的映射逻辑。

**结论**：完成。12 个 Module 各自恰好拥有一个目录，`owner()` 完全由路径前缀决定。

## 1. 目标布局

| Module | 目录 | 文件数 |
| --- | --- | --- |
| ControlEngine | `src/control/control-engine/`（含 `policies/`、`records/`） | 65 |
| PlanCompiler | `src/control/plan-compiler/` | 4 |
| DispatchEngine | `src/control/dispatch-engine/` | 11 |
| VerificationEngine | `src/control/verification-engine/` | 20 |
| ArchitectureReconciler | `src/control/architecture-reconciler/` | 4 |
| HumanCollaboration | `src/interaction/human-collaboration/` | 4 |
| WorkerRuntime | `src/execution/worker-runtime/` | 15 |
| StateLedger | `src/data/state-ledger/` | 7 |
| ArtifactVault | `src/data/artifact-vault/` | 6 |
| ReadModelIndex | `src/data/read-model-index/` | 9 |
| ContextCompiler | `src/data/context-compiler/` | 24 |
| WorkspaceReader | `src/data/workspace-reader/` | 16 |

（计数含各目录的 `README` 文件。）

内存与 SQLite 适配器同属其 owning Module：`state-ledger/{in-memory-ledger,sqlite-ledger}.ts`、
`read-model-index/{read-model-index,sqlite-read-model-index}.ts`、
`artifact-vault/{artifact-vault,sqlite-artifact-vault}.ts`。

保持原位：`src/contracts/`、`src/harness/`、`src/app/`、`src/ui/`、`src/storage/`（契约、组合根与共享工具，不是 Module）。
未触碰生成物：`src/app/public/workbench/`、`src/ui/test-results/`。
旧的 `src/control/`、`src/context/`、`src/ledger/`、`src/read-model/`、`src/runtime/`、`src/sqlite-ledger/`、
`src/sqlite-read-model/`、`src/vault/`、`src/verification/`、`src/interaction/` 已全部清空删除。

## 2. 迁移规模与内容保全

- 移动文件 **181** 个；旧路径消失 **180** 个；新路径出现 **187** 个（181 次移动 + 6 个真正新增文件）。
- 移动后 **字节完全不变 8** 个；**173** 个文件内容被改写 —— 改写内容仅限相对 import 说明符、随路径失效的运行期路径引用、以及因目录加深而变化的 README 链接层级。
- 明细见 `content-preservation.json`；旧→新完整对照表见 `path-migration-map.json`。

新增文件（非移动）：`tests/contracts/module-ownership.test.ts`、`scripts/module-map.d.mts`，
以及 5 个此前缺失的 Module `README.md`（plan-compiler、dispatch-engine、architecture-reconciler、state-ledger、read-model-index）。

## 3. `scripts/module-map.mjs`：归属改为纯路径前缀

三个文件名 `Set`（`dispatch`、`planning`、`architecture`）与 `src/data` 的正则特例**已全部删除**。现在实现为：

```js
const moduleDirs = [
 ['src/control/control-engine/', 'ControlEngine'],
 ['src/control/plan-compiler/', 'PlanCompiler'],
 ['src/control/dispatch-engine/', 'DispatchEngine'],
 ['src/control/verification-engine/', 'VerificationEngine'],
 ['src/control/architecture-reconciler/', 'ArchitectureReconciler'],
 ['src/interaction/human-collaboration/', 'HumanCollaboration'],
 ['src/execution/worker-runtime/', 'WorkerRuntime'],
 ['src/data/state-ledger/', 'StateLedger'],
 ['src/data/artifact-vault/', 'ArtifactVault'],
 ['src/data/read-model-index/', 'ReadModelIndex'],
 ['src/data/context-compiler/', 'ContextCompiler'],
 ['src/data/workspace-reader/', 'WorkspaceReader'],
];
const surfaceDirs = [
 ['src/app/public/', 'UI'], ['src/contracts/fixtures/', 'Fixtures'], ['src/contracts/testing/', 'TestDoubles'],
 ['src/contracts/', 'Contracts'], ['src/app/', 'Host'], ['src/harness/', 'Host'],
 ['src/storage/', 'Storage'], ['src/ui/', 'UI'],
];
export function owner(file) {
 const path=file.replaceAll('\\','/');
 const hit=moduleDirs.find(([dir])=>path.startsWith(dir));
 if(hit)return hit[1];
 const surface=surfaceDirs.find(([dir])=>path.startsWith(dir));
 if(surface)return surface[1];
 return 'Unmapped';
}
```

导出名 `modules`、`allowedModuleDependencies`、`owner` 未变；`Fixtures`/`TestDoubles`/`Contracts`/`Host`/`Storage`/`UI` 分类保持有效。
`scripts/check-module-boundaries.mjs` 中硬编码的 4 个 fixture-consumer 路径已更新为新位置；
其 `coverage` 自述（`.ts/.tsx/.js` 解析边、`.py` 仅归属、排除依赖与构建产物）仍然准确 —— 实测 366 源文件（365 解析 + 1 仅归属）。

## 4. 回归测试

`tests/contracts/module-ownership.test.ts`（8 个用例）断言：

1. 12 个 Module、12 个目录，且与 `module-map.mjs` 的 `modules` 一致；
2. `owner()` 只看路径 —— 同名文件因目录不同而归不同 Module（`control-engine.ts` / `dispatch-engine.ts` / `plan-compiler.ts` / `architecture-reconciler.ts`）；
3. 每个有 Module 归属的文件都位于其 Module 名对应的目录下；
4. 位于某 Module 目录内的文件 `owner()` 必须就是该 Module；
5. **每个 Module 目录的文件清单与记录清单逐一对齐** —— 这是真正能抓住"把 ControlEngine 文件丢进 dispatch-engine 目录"的断言（已实测：注入 `dispatch-engine/claim.ts` 后该用例失败，移除后通过）；
6. 没有 Module 目录嵌套在另一个 Module 目录内；
7. 没有产品源文件落到 `Unmapped`；
8. 旧的分裂目录（如 `src/data/workspace-reader/workspace-reader/`）不再存在。

## 5. 验证结果

| 命令 | 退出码 | 结果 |
| --- | --- | --- |
| `tsc --noEmit` | 0 | 无错误 |
| `node scripts/check-module-boundaries.mjs` | 0 | 366 源文件 / 367 inventory / **0 issues** / 0 Unmapped，owner 计数与 coverage 与迁移前完全一致 |
| `bash scripts/test-wsl.sh --maxWorkers=2` | 0 | **257 files / 1672 tests 全部通过** |
| `pnpm --dir src/ui exec tsc -p tsconfig.json --noEmit` | 0 | 无错误 |
| `pnpm build` | 0 | 内核 + tsc app + copy-ui + vite 全部成功 |
| `pnpm ui:test`（设 `CHROME_PATH`、`CODING_AGENT_BWRAP_PATH`） | 0 | **25/25 浏览器用例通过** |
| `node dev_docs/verification/validate-docs.mjs`（文档根） | 0 | **13/13** |
| `scripts/verify-source-index.mjs` / `verify-vault-crash.mjs` / `verify-ui-build.mjs` | 0 | 全部 passed |

### 与迁移前基线对照

| 项目 | 迁移前 | 迁移后 |
| --- | --- | --- |
| 测试 | 256 files / 1664 tests / exit 0 | 257 files / 1672 tests / exit 0（+新增回归测试 1 文件 8 用例） |
| 边界 | 366 / 367 / 0 issues | 完全一致 |
| 文档校验 | 13/13 | 13/13 |
| 浏览器 | 23/23 | 25/25（当前共 25 个 spec） |

## 6. 清单摘要（用于审计）

| | 文件数 | manifest digest |
| --- | --- | --- |
| before | 745 | `7637193c9bcac3289dff922f199d789c80708706fa2a7b38c30f37650175cfc6` |
| after | 752 | `01c88e55eac13171ff1cd0abe82a9ad55cf86a69ca0118c391495753efdfd4d9` |

`git status --porcelain` 条目：迁移前 433 → 迁移后 380。全程未执行任何 `git commit/push/reset/stash/clean`，
未运行 `evidence/2026-09-09-architecture-rebuild/migration-scripts/`，未触碰 `vendor/`。

## 7. 未做到 / 不确定的地方（如实记录）

**遇到的问题与修复**（皆为真实缺陷，非猜测）：

1. 首次 codemod 通过后，一个并行的第二次执行把已移动文件再次"迁移"，产生了三级嵌套（如
   `src/control/control-engine/control-engine/`）并破坏了部分说明符。已用"解析到根相对目标、再按最终位置重新生成"
   的可重算方式修复（重算幂等，文本替换不幂等）。
2. 被覆盖的 `path-migration-map.json` 最初记录的是这一中间错误状态；已按最终树形反推重建并逐条与
   before/after 清单核对（181 条全部一致）。
3. 运行期路径引用 `tsc` 抓不到，靠测试与构建暴露并修复：`src/app/workspace-tools.ts`、
   `src/execution/worker-runtime/observed-model-run.ts`、`src/data/workspace-reader/{cpp,python}-source-index.ts`、
   `scripts/copy-ui.mjs`、`scripts/verify-*.mjs`、`tests/app/reviewer-recovery-fixture.ts`。
4. `dist/` 是 gitignore 的构建产物，里面残留了中间失败态的旧目录，曾掩盖上述缺陷；已删除重建。

**不确定 / 已知遗留**：

- 有 526 处说明符是**按 basename**（而非目录路径）恢复的，因为中间那一次错误执行已经把它们改坏、无法通过重定基还原。
  其中 3 处存在同名歧义，全部按路径相似度正确判定（Module 文件 vs contract、workspace-reader vs app），
  且全部经 `tsc`、边界检查与全量测试验证。这是本次迁移中最需要人工复核的一点。
- `src/contracts/human-role-collaboration.ts` 有 2 处、`src/contracts/ledger.ts` 有 1 处**自引用 import**；
  这两个文件本次**字节未变**，属既有问题，未在本次范围内修改。
- `dev_docs/interfaces/runtime-collaboration.md` 引用 `src/app/explorations.ts`，`src/app/README.md` 引用
  `explorations.ts` 与 `verification-imports.ts` —— 这三个文件在迁移前的清单中即不存在，属既有断链，未修改。
- 任务过程中出现过一个本 Agent 未创建的 `scripts/module-map.d.ts`。已删除，其功能并入
  `scripts/module-map.d.mts`（NodeNext 实际解析为 `.mjs` 的声明文件；`.d.ts` 因 `tsconfig.json` 只 include `src`/`tests` 而不生效）。
- 本次**未移动** `src/contracts/*` 中按 Module 分组的契约（按任务规则留待主 Agent 单独决定）。
