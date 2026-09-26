## 本轮修改（仅 `architecture-record-codecs.ts`）

先读了刷新后的 `src/contracts/architecture-source.ts`（新增可选 `indexedSources` 及 `architectureSourceIssues` 校验）、`core/workspace/architecture-source.ts`（`mapArchitectureSource` 从 `material.sources` 原序拷贝 `indexedSources` 并用该过滤序列算 `contentDigest`）、以及 `R3d-record-integrity.test.ts` / `R3d-observed-boundaries.test.ts` 的 JSON 正例与 manifest 篡改反例。未改接口、tests、WorkspaceTools、graph 算法，未新增持久字段/存储层。

### codec 的新判据

- **`indexedSources` 必须存在**：缺失直接 `invalid`；形状交给 `readArchitectureSnapshot` 内的 `architectureSourceIssues`（含重复 path 拒绝）。
- **成员资格用 Map 核对**：`files` 建 `path -> digest`，每个 `indexedSources` 条目必须同路径同摘要；不按扩展名/kind 猜测，因此 `resolveJsonModule` 索引进来的 JSON 合法，而 `tsconfig.json` 不会因 `kind` 或路径被升级为索引源码。
- **节点只由明确 mapping 匹配的 `indexedSources` 支持**：按 `kind:id`（structuralKey）取 mapping，核对 `nodeId/kind/name` 身份与代表路径 `node.path === mapping.paths[0]`；成员取 `indexedSources` 中该 mapping 任一路径前缀匹配的条目，空则 `invalid`（任意非索引配置不能支持节点）。
- **`node.contentDigest` 复算**：`sha256Hex(canonicalJson(members))`，成员数组保持 manifest 原序、不重排；与 `mapArchitectureSource` 的 `sha256Hex(canonicalJson(material.sources.filter(inMapping)))` 一致。这样删除/篡改 JSON 成员或只改节点摘要都会被拒。
- 保留此前的 scope/revision/indexVersion/commitHash/configPath/body/ref 校验；`configPath` 仍须被 frozen 文件覆盖；`R3d-observed-architecture` 与 `R3d-observed-boundaries` 的权限、取消清理路径未动（在 `architecture-service.ts`，本轮未改）。

### 实测结果

| 检查 | 结果 |
|---|---|
| `next-observed` | exit 0；**3 个测试文件、33 项全过**（含新增 JSON-only mapping 正例与 indexed manifest 删除/篡改/节点摘要篡改反例） |
| `next-types` | exit 0 |
| `next-architecture` | exit 0；`next source boundaries: OK`（5/8 允许边） |

仅 `architecture-record-codecs.ts` 在本轮被写入（另三文件时间戳未变）；无 `console/TODO` 残留。

### 剩余限制

- `contentDigest` 按 manifest 原序精确复算，是刻意的“无 fallback”：不重排、不按扩展名补证；若未来 provider 改变 `material.sources` 顺序，正文需按新序列重新生成。
- JSON 成员需同时存在于 `files`（同摘要）与 `indexedSources` 才支持节点；这是 Sol 提供的准确证据前提，原 observed 正文尚未发布，故不造缺证据 fallback。
- 其余限制同前（256KB 正文上限、全局 unresolved 仅首屏、邻域无 direction 字段等）。

未自行宣布主审验收通过；结果仍由主审独立复现验收。