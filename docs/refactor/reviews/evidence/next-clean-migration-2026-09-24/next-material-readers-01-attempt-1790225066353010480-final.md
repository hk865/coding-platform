## 完成报告：N0 / R3c 材料事实与候选读取

### 交付物（唯一写入文件，原位写入）
`coding-platform/next/src/core/work-graph/materials/record-readers.ts`（594 行；仅此文件 mtime 变化，`next/` 全部未跟踪，无其它改动）。

**`materialRecordSchemas()`**
- `records` = `GOAL_RECORD_SCHEMAS.records`（Project/Workspace/Goal）+ `RunSnapshot@1`、`QueryRunSnapshot@1`、`MaterialAccessGrantSnapshot@1` 三个纯编码校验器；`events` 原样复用 Goal 注册。
- 校验只做持久行编码/完整身份/revision/schemaVersion 与材料使用必需字段；返回时直接 `JSON.parse(record.json)`，不归一化历史内容。
  - Run：完整 `RunRef`、`task` 与 ref 一致、`attemptId`、同项目 `planRef`、`roleBinding`、`budget`、`workspaceSnapshot`(workspaceId+revision)、status/outcome/exitCode/lastEventSeq/envelope/startedAt/endedAt。
  - QueryRun：完整 `QueryRunRef` + `run.queryJobRef` 三字段一致 + `run.runId===ref.runId` + 状态/时间/outcome。
  - MaterialGrant：完整 ref、`grantId`/`scope` 与 ref 一致、materials 1..64 个合法 ArtifactRef（复用 `body-codec.isArtifactRef`）、reader/issuedBy（Run/QueryRun/Control）、basis（复用 `validMaterialSourcePin`）、history（含 crossWorkspace）、可选 revocation。字节完整但业务跨 scope 的 grant 不会被这里拒绝，授权仍由 `applicability.ts` 判定。
- `lookups` 注册两条精确 reader 索引（dotted JSON key，不含 SQL）：
  - `material-access-grant-by-run-reader`: `grant.reader.{aggregateType,projectId,goalId,runId}`
  - `material-access-grant-by-query-run-reader`: `grant.reader.{aggregateType,projectId,workspaceId,queryJobId,runId}`

**`createMaterialRecordReaders(records)`**（仅注入 `backend.records`，无 Ledger/ReadModel/动态 import）
- `authority.load`：`canonicalJson(ref)` → `readMany`；只接受 `refKey` 精确匹配且再次通过注册校验的行；缺失 `not_found`，损坏/不支持/异常 → `unavailable`；每次返回独立 `JSON.parse` 对象。
- `index.materialAccessCandidates`：按 reader 完整身份调用注册 `lookup`，`limit=200` keyset 逐页到 `next===null`（不截断、不跨调用缓存）；对每行复用 `sameArtifactOwnerRunRef` + `sameArtifactRef` 复核；返回当前 canonical 行（含撤权/修订），授权判定留给共同判据；非前进/重复游标 fail-closed `unavailable`。

### 命令实测结果
| 检查 | 结果 |
|---|---|
| `check.py next-material-readers` | **2 passed / 8**：两条 memory+sqlite 的 `canonical material records ... isolated` 通过（真实 `readMany` 路径，含返回对象隔离）。**6 条失败全部因 Store 缺 `lookup`**：`createInMemoryRecordBackend`/`createSqliteRecordBackend` 返回的 `records` 无 `lookup`，`lookup-index.ts` 仍为 `export {}`；我的实现如实返回 `unavailable`（reason: `RecordStore lookup capability is not available`），未写假 provider、未绕断言。 |
| `check.py next-types` | 3 个错误，**全部与本文件无关且为快照既有环境缺口**：`src/core/workspace/access.ts`、`tests/data/workspace-capture-access.test.ts` 找不到 `vendor/coding-agent/dist/public-api.js`。`record-readers.ts` 零错误。 |
| `check.py next-architecture` | 唯一 issue 是同一缺失的冻结内核 dist（`vendor/coding-agent/dist/public-api.js: frozen Kernel dependency is missing`）；观测边 `WorkGraph -> RecordStore` 属允许边，无越界边。 |

### 额外本地自检（仅 /tmp 临时文件，未入库）
用一个忠实的临时 lookup provider 与注册结构断言，验证了：Run/QueryRun 完整身份+精确材料筛选、超过 200 行的 keyset 分页取到 `grant-204`、返回最新 canonical（revision 2 撤权行）、非前进游标 fail-closed、以及注册恰为 6 个 record schema + 2 个 lookup 路径正确 —— 全部通过。这不是交付代码，也不进入仓库。

### 未闭合项
1. **真实集成验证待 Store provider**：`materialAccessCandidates` 的全部候选/分页/真实读取测试要等主 Agent 验收 Store 后把三个提供者文件放入快照才能转绿。
2. **快照环境缺口（非本任务）**：`next/vendor/coding-agent/dist/` 缺失，导致 `next-types`/`next-architecture` 无法独立全绿；与本文件无关。

未改接口/测试/package/类型定义，未安装依赖，未 stage/commit/push。