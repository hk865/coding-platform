# src/core/work-graph/materials：材料的存取、适用性与规范记录读取（L2）

## 负责什么，不负责什么

- 负责：材料的写入与打开（`MaterialPort`）、材料适用性判定（Host provenance 与 Run 自身材料规则）、材料读取所需的 Run/QueryRun 规范记录解码与 schema 注册。
- 不负责：材料业务语义本身在 `src/core/work-graph/model/material-contracts.ts`；物理 body 存取在 `src/core/record-store/body-ports.ts`；状态机、配额或工作流准入不在本层。
- 允许依赖 `model`、`persistence` 和 `RecordStore` 端口；不得 import `sessions`、`queries`、`tasks`、`architecture`、`notes`、`views`、`agent-runtime`、`app/`、`business/`、`composition/`（`docs/refactor/module-target.json`）。
- 状态写入只经 `state/`；本层不写状态记录，只写注入的 raw body store。

## 文件

`material-service.ts` — 唯一的 `MaterialPort`：`storeArtifact`/`openArtifact`，隔离调用方输入、校验 ctx/principal/scope/origin、大小与来源。
`applicability.ts` — 材料适用性：Host 读的 provenance 规则与 Run 只读自己材料、不能 current 的规则；provenance→owner。
`record-ports.ts` — 材料规范事实读取端口 `MaterialAuthorityReads` 及其快照/结果类型。
`record-readers.ts` — `RunSnapshot@1`/`QueryRunSnapshot@1` 的校验与注册（含 execution state 必填的 `requestProfile`），以及基于注入 RecordStore 的 `MaterialAuthorityReads` 实现。
`run-snapshot-decoder.ts` — 唯一的 schema-checked `RunSnapshot` 解码器。

## 可以复用的能力

| 名字 | 位置 | 做什么 | 什么时候用 |
| --- | --- | --- | --- |
| `createMaterialService` | `src/core/work-graph/materials/material-service.ts:116` | 唯一 `MaterialPort`：存材料、开材料；Host current 读无可信 pin 时 `source_stale` | composition 装配材料端口；不要另写存取 |
| `createMaterialApplicability` | `src/core/work-graph/materials/applicability.ts:23` | 材料适用性判定：Host 需 `historical_explanation`，Run 只能读自己的且不能 current | 打开材料前的准入；别处不要另写适用性规则 |
| `materialOwnerFromOrigin` | `src/core/work-graph/materials/applicability.ts:93` | 从 raw origin 取记录下来的 Run/QueryRun owner，或 null | 判断材料归属 |
| `createMaterialRecordReaders` | `src/core/work-graph/materials/record-readers.ts:440` | 用注入的 `readMany` 实现 `MaterialAuthorityReads.load`；miss 与失败分开 | composition 提供材料权威读 |
| `materialRecordSchemas` | `src/core/work-graph/materials/record-readers.ts:400` | Goal schema 加 Run/QueryRun 的完整记录 schema 集 | 注册后端 schema；不要另加一套 |
| `validateQueryRunSnapshot` | `src/core/work-graph/materials/record-readers.ts:310` | 唯一的 `QueryRunSnapshot@1` 校验；queries 复用它 | 解码/校验 QueryRun 记录 |
| `executionRequestProfileProblem` | `src/core/work-graph/materials/record-readers.ts:285` | 执行状态必填的 `requestProfile`：null 或完整 profile（profileId、runtimeBudget、budget、consumerId） | QueryRun 记录与执行事件共用的唯一校验 |
| `QUERY_RUN_RECORD_SCHEMA` | `src/core/work-graph/materials/record-readers.ts:381` | `QueryRunSnapshot@1` 的唯一 schema 注册 owner | 注册 QueryRun schema |
| `MaterialAuthorityReads` / `MaterialCanonicalRef` | `src/core/work-graph/materials/record-ports.ts:12`、`src/core/work-graph/materials/record-ports.ts:6` | 材料规范事实读取端口与规范 ref 类型 | 别的层实现/注入材料权威读时 |
| `decodeRun` | `src/core/work-graph/materials/run-snapshot-decoder.ts:24` | 唯一的 schema-checked `RunSnapshot` 解码；Session/邮箱/Task 读共用 | 需要解码 Run 快照时；不要另写宽松解析 |

## 内部用

`MaterialCanonicalSnapshot`、`MaterialSnapshotResult`、`MaterialApplicability`、`MaterialOwner`、`MaterialServiceDependencies`、`Decoded` 等类型，以及 `record-readers.ts` 内的 Run 校验器；只在本层或契约内使用。

## 不要做

- 不在别处另写材料适用性或 owner 判断；用 `createMaterialApplicability` 与 `materialOwnerFromOrigin`。
- 不另写 Run/QueryRun 解码或 schema 注册；`decodeRun` 与 `QUERY_RUN_RECORD_SCHEMA` 是唯一 owner。
- 不把 Host 的 current 读降级成 historical；没有可信 source pin 就是 `source_stale`。
- 不建第二个 store、SQLite/Map 或旧仓库扫描；只通过注入的 raw body store 与 `GoalRecordTransactionPort.readMany` 读。
