三处主审返修已全部落地，新冻结测试通过。

## 1. `currentBasisValid` 不再可缺省（`r3b-host-boundaries` 1失败1通过 → 2/2）

`src/data/context-compiler/history-materials-context.ts`：
- 新增内部 `HostGrantAuthority = MaterialAccessResolver & { currentBasisValid(grant): Promise<boolean> }`，`HostMaterialPath.grantAuthority` 收窄为该类型（公共 `MaterialAccessResolver` 的可选语义未动）。
- 构造 Host 路径时显式取 `deps.grantAuthority.currentBasisValid`；缺失即 `throw Error('...requires grantAuthority.currentBasisValid...')`，不会把能力缺失静默成“跳过校验”。
- `read` 删除 `basisValid &&`，改为读取正文前后各一次无条件 `await currentBasisValid(canonical)`：失效返回 `result=rejected/stale`，且只读一次正文（测试断言 `openArtifact` 1 次、`currentBasisValid` 2 次）。
- 结果：`r3b-host-boundaries` **2/2 pass**。

## 2. `InMemoryHarness.materials` 精简（无本批消费者，撤销发布）

`src/harness/in-memory-harness.ts`：
- 删除 `MaterialPort` import、接口 `materials` 字段、return 里的 `materials`。
- Vault 恢复为 `const vault = options.vault ?? new ArtifactVault(new Map(), { authority: ledger, grants: createMaterialAccessResolver(ledger, readModel, options.sourceApplicability), now: d.clock })`：仅在无自定义 vault 时惰性创建，默认 Vault 仍注入同一 `ledger`/resolver/clock；自定义旧 `ArtifactPort` 原样使用，不强发新能力。
- `PersistentPlatform.materials` 保留（本批 GUI 真实消费者），并改为 `readonly materials: MaterialPort`（`src/composition/persistent-platform.ts:256`）。

## 3. `SqliteArtifactVault.close` 去重

`src/data/artifact-vault/sqlite-artifact-vault.ts`：删除 `closed` 字段与判断，`close()` 只 `await this.raw.close()`；关闭与幂等状态唯一归 raw store。公开 `close(): Promise<void>` 签名不变。

## 4. 实际检查结果（check.py，Node24 单 worker）

| 检查 | 结果 |
|---|---|
| r3b | 10/10 pass |
| r3b-raw-boundaries | 4/4 pass |
| r3b-admission-boundaries | 6/6 pass |
| r3b-await-boundaries | 2/2 pass |
| r3b-host-boundaries（新） | 2/2 pass |
| r3b-host | 1/1 pass |
| r3b-gui | 1/1 pass |
| r3b-body-first（新） | 2/2 pass |
| r3b-query（新） | 10/10 pass |
| platform-types | exit 0 |
| platform-architecture | exit 0；`issues: []` |
| r3b-regression | **10 文件通过 / 1 失败；67 测试通过 / 1 失败**（唯一失败为跨进程夹具环境缺件，见下） |
| 额外回归（reviewer/work-run/completed-work/work-context/material-revocation/exploration/handoff + 两个 historical 兼容） | 9 文件 65/65 pass |

## 5. 架构迁移债（已登记，未改图/未改文档）

`platform-architecture` 输出已包含且我原样保留：
- `dependencyStatus.fullDependencyDagVerified: false`；
- 两条 `transitionalInjectedDependencies`：`WorkGraph -> StateLedger`（canonical snapshot load，exitBatch `R3c reader migration`）、`WorkGraph -> ReadModelIndex`（materialAccessCandidates，exitBatch `R3c index migration`）；
- `issues: []`。未删除、未伪造整图无环；源码图/文档由主 Agent 同步。

## 6. 剩余问题

- **跨进程夹具仍无法在本工作区执行（环境缺件，非代码问题）**：`tests/vault/sqlite-artifact-concurrency.test.ts` 与 `tests/restart/material-source-applicability.test.ts` spawn 的子进程经 `tests/coordination/process-loader.mjs` / `material-source-process.mjs` 导入 `coding-platform/.local/linux-test-tools/node_modules/typescript/lib/typescript.js`，该目录不存在，`ERR_MODULE_NOT_FOUND` 在触达被测代码前即失败。按“不得安装依赖、不得改夹具”，未创建/软链该依赖。因此 `r3b-regression` 退出码 1；去掉该文件后 10 文件 67 测试全绿。进程内 SQLite 旧行/reopen/损坏覆盖已由 `persistent-vault`、`R3b raw body contract` 通过；真机跨进程首写请在有离线工具的环境复核。
- 我这一轮的写集仍是批准 7 文件；未改测试、ports、core、config 或模块依赖表。