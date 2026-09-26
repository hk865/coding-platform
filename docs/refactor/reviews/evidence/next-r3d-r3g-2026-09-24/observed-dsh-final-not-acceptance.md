## 本轮修复（同一 R3d Session，写范围仍为原 4 个生产文件）

本轮只改 `architecture-record-codecs.ts`、`architecture-service.ts`；`graph-index.ts`、`architecture-delta.ts` 未动。未改 tests/contracts/接口/配置/Kernel，未恢复全局 ledger horizon，未加抽象层。

### 1. 映射路径语义对齐 `mapArchitectureSource`

先读了 `next/src/core/workspace/architecture-source.ts` 与 `project-source-snapshot.ts` / `typescript-source-query.ts` 确认事实：`node.path = mapping.paths[0]`（可为目录或不存在的首路径），节点产生条件是“该 mapping 的任一路径匹配某个真实 indexed source”。据此改 codec：

- 删除“`node.path` 本身必须被 frozen 文件覆盖”的要求。
- 对每个 node：按 `kind:id`（structuralKey）找显式 mapping，核对 `nodeId/kind/name` 身份与代表路径 `node.path === mapping.paths[0]`。
- 要求“该 mapping 的任一路径”匹配至少一个真实 frozen **source** member（`file.kind === 'source'`，即非配置文件）。
- 配置路径仍须被 frozen 文件覆盖（`tsconfig.json` 属 configuration，仍在 `files` 中）。
- 保留损坏反例：删掉 Alpha 的唯一源文件后无 source member → `invalid`。
- 服务侧现行权限核验改为只针对**真实 frozen files + 实际配置输入**；不再把 `nodes[].path` / `mappings[].paths`（目录或缺失代表路径）当额外文件授权。`src/alpha.ts` 被撤权时它仍在 `files` 中，因此仍拒绝。
- graph-index 的多路径 file anchor 未改。

### 2. 释放清理使用 fresh non-aborted signal

`releaseCaptureQuietly` 现在用 `{ ...ctx, signal: new AbortController().signal }`：身份（principal/materialReader）与 workspace scope 完全不变，只有清理操作换用未 abort 的 signal；registry 仍重跑 Host 授权与 subject/domain 校验，不绕过身份/权限。正常捕获/提交继续使用请求原 signal，`finally` 清理与原始失败结果都保留。取消发生在 body 持久化期间时，临时捕获会被真实释放，不再累积并挤占 retained 容量。

### 实测结果（真实运行）

| 检查 | 结果 |
|---|---|
| `next-types` | exit 0 |
| `next-observed` | exit 0；**3 个测试文件、30 项全过**（`R3d-observed-architecture`、`R3d-observed-boundaries`（含新增 mapping/释放两项）、`R3d-record-integrity`） |
| `next-architecture` | exit 0；`next source boundaries: OK`（5/8 允许边） |

按指示未重跑含其他 lane 骨架的全套。无残留 `console/TODO/readPreviousObservation/ledgerHorizon`。

### 剩余限制

- “真实 source member”按 `file.kind === 'source'` 判定；若某 provider 把非 TS/JS 文件纳入 program source（例如启用 `resolveJsonModule` 的 json），codec 不会把它计为 source member，属保守拒绝。
- 正文仍受 `ARTIFACT_MAX_SIZE_BYTES`(256KB) 与 240KB 架构上限约束。
- 全局 unresolved 仅出现在 offset=0 页；邻域为 depth 有界的无向遍历（冻结 DTO 无 direction 字段）；compare cycles 取 after 图。
- capture 成功即释放临时捕获；重复 `releaseCapture` 走 tombstone 返回 `released:false`。

未自行宣布主审验收通过；以上为本轮实际改动与运行结果。