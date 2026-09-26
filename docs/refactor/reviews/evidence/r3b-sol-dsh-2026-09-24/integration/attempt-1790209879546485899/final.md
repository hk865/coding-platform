本轮返修完成：Host 历史授权在打开正文前复用了 WorkGraph 共享判据，冻结反例 3 项由失败转为通过。

## 实际修改（仅 `history-materials-context.ts`）

- 新增值导入 `grantIssuerOwnsMaterial`（`core/work-graph/materials/applicability.js`，Sol 仅导出既有函数、函数体未动）。
- `read` 的 Host 路径在 `grantsFor` 找到 exact canonical grant 之后、打开正文之前，插入共享判据：
  ```ts
  if (!grantIssuerOwnsMaterial(canonical, historyOwner)) return forbiddenRead(grant);
  ```
  `historyOwner = grant.history.owner`。这样非法 history grant（Control 跨 goal、issuer 为 Run、`history.usage !== 'historical_explanation'`）直接返回 `result=rejected/forbidden`，且不触发 `openArtifact`。
- 保留读取后实际首 owner 必须等于 `historyOwner`（`sameArtifactOwnerRunRef(opened.value.ownerRunRef ?? null, historyOwner)`），以及正文前后两次 `currentBasisValid`（撤权/版本变化仍回 `stale`）；未复制任何权限条件、未造假 Run。
- 未改 core、types、tests；上一轮的 `currentBasisValid` 必填收窄、`InMemoryHarness` 不发布 materials、`SqliteArtifactVault` 去重 close 均保留。

## 检查结果（check.py，Node24 单 worker）

| 检查 | 结果 |
|---|---|
| r3b-host-boundaries | **5/5 pass**（原 2 项 + 3 反例） |
| r3b-host | 1/1 pass |
| r3b-gui | 1/1 pass |
| r3b-body-first | 2/2 pass |
| r3b-query | 10/10 pass |
| r3b-regression | **11 文件 / 68 测试全部通过**（含跨进程 `sqlite-artifact-concurrency`，本 Session 已见 `.local/linux-test-tools/node_modules` 挂载） |
| platform-types | exit 0 |
| platform-architecture | exit 0，`issues: []` |
| r3b | 10/10 pass |
| r3b-raw-boundaries | 4/4 pass |
| r3b-admission-boundaries | 6/6 pass |
| r3b-await-boundaries | 2/2 pass |
| 额外回归（reviewer/work-run、material-source-applicability 跨进程、material-revocation、两个 historical 兼容） | 6 文件 / 43 测试全部通过 |

## 架构

`platform-architecture` 现登记 `ContextCompiler -> WorkGraph: 1`（本轮新增共享判据值导入），位于已声明的 `ContextCompiler: [... 'WorkGraph']` 边内，`issues: []`。`dependencyStatus` 仍为 `fullDependencyDagVerified: false`，两条 `transitionalInjectedDependencies`（`WorkGraph -> StateLedger` / `WorkGraph -> ReadModelIndex`，exitBatch 均为 R3c）原样保留，未删改、未伪造整图无环。

剩余问题：无（上轮唯一的环境缺件已随主 Agent 的只读依赖挂载修复，跨进程首写测试现已实跑通过）。