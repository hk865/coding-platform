继续同一 R3d Session，原四个文件可写范围不变；本轮只需要修 architecture-record-codecs.ts，不改接口、tests、WorkspaceTools 或 shared contracts。

主审已导入上轮 30 项专项 PASS 的实现，在最终审查中确认一个真实缺口：TypeScript resolveJsonModule 会把 JSON 放进 program/indexedSources；但 frozen files.kind 按文件扩展名将它标记 configuration。因此仅凭 kind==='source' 拒绝节点成员会误拒合法 JSON-only mapping。不得把所有 JSON/配置一概当 indexed source，也不得额外重新捕获或扫描文件。

Sol 已在只读依赖补齐准确证据：ArchitectureSourceSnapshotV1.indexedSources 为可选 path/digest 数组（兼容此前通用接口），WorkspaceTools mapArchitectureSource 始终从已存在的 material.sources 拷贝实际 indexedSources，无新增 I/O。本批持久 observed 正文要求这份证据存在；原 observed 正文还未发布给产品，无需捏造缺证据 fallback。

codec 要求：
- indexedSources 必须存在，形状由 architectureSourceIssues 验证；每个条目都是 frozen files 中同路径同摘要的成员（用 Map 核对，不按扩展名猜测）。
- 节点只能由其明确 mapping 匹配的 indexedSources 支持，不能匹配任意非索引配置；代表路径规则仍与现有 mapArchitectureSource 一致。
- 依照 mapArchitectureSource 生成方式，用该 mapping 的实际 indexed {path,digest} 成员序列核对 node.contentDigest。保留成员顺序，不先重新排序改变来源摘要。
- 保留之前完整 scope/version/config/body/ref/权限核验及取消清理。实际 JSON 文件被撤权仍拒绝。原始配置文件不能凭 kind 或路径升级为已索引源码。

先阅读刷新后的两文件及真实 JSON 正例、indexed manifest 篡改反例，再实现。运行 next-observed、next-types、next-architecture；测试只读。最后如实报告修改和结果，仍由主审独立验收。不得改 graph 算法或新增另一套持久字段/存储层。
