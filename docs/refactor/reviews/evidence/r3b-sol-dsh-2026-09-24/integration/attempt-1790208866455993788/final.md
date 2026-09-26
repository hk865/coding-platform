真实装配已完成，7 个文件全部落地并通过主要检查（跨进程夹具因环境缺件无法运行，见未解决项）。

## 1. 七文件改动

| 文件 | 装配内容 |
|---|---|
| `src/data/artifact-vault/artifact-vault.ts` | 保留 `ArtifactVault`/`createArtifactVault`/旧 `ArtifactPort.put/open`，构造时用同一 `deps` 同时 `createMaterialService`（新只读 `materials`）和 `createLegacyArtifactPort`（`legacy`），`put/open` 纯委托。`byKey` 用 `rowsFromStore` 逐次读写转 JSON/`StoredRecord`，不复制整个 Map；首写只走 `ArtifactBodyRows.putIfAbsent`（底层无 `putIfAbsent` 时才 get/set）。`StoredRecord` 增可选 `origin`。`ArtifactVaultOptions` 增 `authority`/`now`，默认 `NO_GRANTS`（无候选）与 `NO_AUTHORITY`（旧 fixture 仍 owner-only）。 |
| `src/data/artifact-vault/sqlite-artifact-vault.ts` | 只调用 `createSqliteRawArtifactStore`，把 raw store 作为父构造第三参传入，`close` 委托；不再有 `DatabaseSync`/PRAGMA/schema/prepare/JSON/权限。 |
| `src/data/artifact-vault/material-access-policy.ts` | 仅 `export { createMaterialAccessResolver } from core/work-graph/materials/applicability.js`。 |
| `src/data/context-compiler/history-materials-context.ts` | 三个新参数全有则启用 Host 新路径（缺一即构造抛错，不全时保持旧入口）。`available` 仍先 `run()` 核 canonical owner/full ref/workspace，再用 `readHostContext(scope)` + `materials.openArtifact` 读正文，并核对 `opened.value.ownerRunRef === item.owner`。`read` 保留精确 scope、grant存在、history用途、revision=1、未撤销；`grantAuthority.grantsFor` 找 exact canonical grant，`currentBasisValid` 前后各核一次，失效返回 `result=rejected/stale`（不读正文/不二次读正文/不重读 snapshot），撤销/缺失沿旧抛错；正文后额外核对实际 owner 与 `grant.history.owner`；Core `ReadResult` 映射回旧 `ArtifactOpenResult` 并保留 reason；始终 `historical_explanation`。 |
| `src/composition/persistent-platform.ts` | `PersistentPlatform` 增 `readonly materials: MaterialPort`；Vault 构造用现有 `ledger` 作 `authority`、既有 resolver、`d.clock`；返回 `materials: built.vault.materials`；`vault` 仍是 `ArtifactPort`。 |
| `src/harness/in-memory-harness.ts` | `InMemoryHarness` 增 `materials`；默认 Vault 注入同一 `ledger`/resolver/clock 并返回其 `materials`；`options.vault` 自定义旧 `ArtifactPort` 仍兼容（`vault` 用它）。 |
| `src/app/service.ts` | 已知 scope 验证后构造固定 `actor={kind:'human',id:'local-gui'}` 的 Host；`readHostContext` 先 `scopeOf` 校验目标，再返回**项目范围** Host（ctx 与 materialReader 均省略 workspaceId）；注入 `h.materials`、`readHostContext`、`grantAuthority=createMaterialAccessResolver(h.ledger,h.readModel,sourceApplicability)`；JSON 的 `principal/reader/actor` 不参与。另把 `createGuiService.action` 改为 `async`，使未知 scope 以 rejection 返回（冻结测试要求 `.rejects`，原为同步 throw）。 |

## 2. 真实测试结果（check.py，Node24 单 worker，只读）

| 检查 | 结果 |
|---|---|
| r3b | 10/10 pass |
| r3b-raw-boundaries | 4/4 pass |
| r3b-admission-boundaries | 6/6 pass |
| r3b-await-boundaries | 2/2 pass |
| r3b-host | 1/1 pass |
| r3b-gui | 1/1 pass（真实 `createPersistentPlatform`→关闭→`createGuiService(dir)`→`/api/real/history/read`） |
| platform-types | exit 0 |
| platform-architecture | exit 0，`issues: []`（`ArtifactVault -> WorkGraph/RecordStore`、`ContextCompiler -> WorkGraph` 均已声明，无未声明边） |
| r3b-regression | **10 文件通过 / 1 失败**；**67 测试通过 / 1 失败**。唯一失败是跨进程夹具，见下 |
| 额外（主 Agent 新增）`tests/data/R3b-body-first.test.ts` | 2/2 pass |
| 额外 `historical-{ledger,host}-compatibility` | 3/3 pass |
| 额外 vault/context 回归（reviewer-context、work-run-materials、material-revocation、work-context、completed-work、exploration、handoff 等） | 7 文件 63/64 pass，唯一失败同为跨进程环境缺件 |

## 3. 删除的旧规则

- `artifact-vault.ts` 删除：正文摘要/尺寸复核与旧 put 预读、`ownerRunRef` 推导、`authorizeByGrant` 全套（reader 匹配、basis 相等、issuer=owner/Control、history cross-workspace、stale→`stale` 映射）及 `grantIssuerOwnsMaterial`。
- `sqlite-artifact-vault.ts` 删除：`DatabaseSync` 打开、PRAGMA、`CREATE TABLE artifacts`、prepared statements、row JSON 编解码、`close` 本体与摘要/权限逻辑。
- `material-access-policy.ts` 删除：整整一份 72 行 `createMaterialAccessResolver` 副本（canonical 重查/撤权/goal+workspace 绑定/crossWorkspace 人类授权/`currentBasisValid`），改为纯重导出。
- `service.ts` 旧 `new HistoryMaterialsContext({ledger, vault})` 装配替换为 Host 注入装配。
- 未改 `runtime-context.ts`，未伪造 `work_run` roleBinding，未发布 raw body store。

## 4. 未解决项

1. **跨进程首写夹具在本工作区无法执行（环境缺件，非代码问题）。** `tests/vault/sqlite-artifact-concurrency.test.ts` 和 `tests/restart/material-source-applicability.test.ts` 会 spawn 子进程，子进程经 `tests/coordination/process-loader.mjs` / `material-source-process.mjs` 导入 `coding-platform/.local/linux-test-tools/node_modules/typescript/lib/typescript.js`，但该目录不存在，报 `ERR_MODULE_NOT_FOUND`，在触达任何被测代码前即失败。按任务“不得安装依赖、不得改夹具”，我未创建/软链该依赖。因此 `r3b-regression` 整体退出码为 1；去掉这一个文件后 10 文件 67 测试全绿。真机跨进程首写与旧库兼容请在有该离线工具的环境复核；进程内 SQLite 重开/旧行/损坏覆盖已由 `persistent-vault`、`R3b raw body contract`（legacy 行 + reopen）通过。
2. `HistoryMaterialsContext.read` 新路径对 Core `unavailable/unsupported/cancelled` 的旧 wire 映射：由于 `ArtifactOpenResult` 的 `unavailable` 无 `reason` 字段，为满足“保留拒绝理由”映射为 `rejected/invalid` + `issues:[reason]`（其余 `forbidden`/`source_stale`/`invalid` 原样映射）。此路径当前无冻结测试覆盖，若主 Agent 期望 `unavailable` 形状可调整。
3. 模块依赖表由主 Agent 更新（`module-map.mjs` 于本轮被并发改动，我未触碰）；`platform-architecture` 使用该表已通过，未发现额外未声明边。