只读核对了 33 个文件的 diff、base 和当前源码，未写文件、未运行测试。**未发现行为差异；有 2 项不整洁、1 项建议。**

下列源码路径均相对 `src/core/work-graph/`。

| 类别 | 位置 | 发现 | 一项修复 |
|---|---|---|---|
| 不整洁 | [architecture/architecture-service.ts:938](D:/cxt/c1-g3-review/src/core/work-graph/architecture/architecture-service.ts:938)、`:1251`；[notes/note-service.ts:362](D:/cxt/c1-g3-review/src/core/work-graph/notes/note-service.ts:362)；[views/track-read-model.ts:224](D:/cxt/c1-g3-review/src/core/work-graph/views/track-read-model.ts:224) | 规则 5 清理未完：仍有 `Rework 3 ruling 2`、`group GD`、`before round 3`。未发现规则或 why 正文误删，状态机文件未改；变更文件没有残留或新增 `G1`／`G4` 标签。 | 只删施工标签；保留取消判定时机、校验分工、旧游标缺少 `ca` 时按 null 处理的说明。 |
| 不整洁 | [.lead-ref/c1-g3-final.md:11](D:/cxt/c1-g3-review/.lead-ref/c1-g3-final.md:11)、[:89](D:/cxt/c1-g3-review/.lead-ref/c1-g3-final.md:89) | 接口表把 `CapacityError` 写成仅 activity 使用，但 [timeline:567](D:/cxt/c1-g3-review/src/core/work-graph/views/task-state-timeline.ts:567)、[track:1197](D:/cxt/c1-g3-review/src/core/work-graph/views/track-read-model.ts:1197) 也捕获它。两个查询服务实际变更 **443＋218＝661 行**，不是报告中的 1,007 行。 | 按源码修正消费者表和体量归因。 |
| 建议 | [queries/query-job-service.ts:194](D:/cxt/c1-g3-review/src/core/work-graph/queries/query-job-service.ts:194)；[query-execution.ts:367](D:/cxt/c1-g3-review/src/core/work-graph/queries/query-execution.ts:367)、`:435` | 两个服务有 **626 行**仅替换调用名称，没有增加合并收益。最大单块分别为 **68、30、24 行新增＋删除**。未发现纯空白排版 hunk，或搬移后没有合并用途的独立代码块。 | 用 `rejectedWithNonEmptyCurrent as reject/rejected`、`nonEmpty as isNonEmptyString` 等导入别名保留调用点。 |

总量 **+1,157／−1,652＝2,809，净减 495** 核对正确。明显超过目标，但任务书允许完成已开项；仅凭最终 diff，不能断言违反了中途停止规则。

逐项行为核对结果如下：

| 项目 | 结论与证据 |
|---|---|
| VW-1／XX-8、VW-3 | **OK。** [activity-read-helpers.ts:64](D:/cxt/c1-g3-review/src/core/work-graph/views/activity-read-helpers.ts:64) 保持请求字段顺序、分页参数、每条返回记录扣预算、失败页原样抛出；`:117` keyed miss 仍扣一次。惰性停止保持，三入口读取顺序及水位重试未变。activity 在 [activity-read-model.ts:645](D:/cxt/c1-g3-review/src/core/work-graph/views/activity-read-model.ts:645) 按 `sessionId` 排 owners；track 在 [track-read-model.ts:617](D:/cxt/c1-g3-review/src/core/work-graph/views/track-read-model.ts:617) 按 canonical key 排序，workspace 检查仍在 `:599`、`:1123`。 |
| VW-5 | **OK。** [decision-read-model.ts:1618](D:/cxt/c1-g3-review/src/core/work-graph/views/decision-read-model.ts:1618) 显式 `proposalRef` 分支仅改注释；`:1667` live 优先，随后原样构造 superseded，`:1675` 按原序 `filter` 后调用 helper，`:1679` 保留 fallback。 |
| VW-7 | **OK。** [node-detail-reader.ts:90](D:/cxt/c1-g3-review/src/core/work-graph/views/node-detail-reader.ts:90)、[work-line-reader.ts:188](D:/cxt/c1-g3-review/src/core/work-graph/views/work-line-reader.ts:188) 保留原来 14 个代码及默认 `unavailable`；node 的缺 reason、not_found、未就绪文字和外层键顺序均未变。 |
| N1／B 原语 | **OK。** `isRecord`、`nonEmpty`、`isPos`、`hasOnlyKeys`、`isSha256Hex`、codec `invalid` 均与被替换副本等价；正整数仍要求 safe integer。尤其 [note-read-model.ts:117](D:/cxt/c1-g3-review/src/core/work-graph/notes/note-read-model.ts:117) 的“键数必须相等”版本仍独立保留。 |
| N2／B JSON、SessionRef | **OK。** [note-record-codecs.ts:14](D:/cxt/c1-g3-review/src/core/work-graph/persistence/note-record-codecs.ts:14) 接 `canonicalOf` 和 **nullable** `parseObject`，捕获范围及 null 返回相同；`:28` 接严格 `sessionRefProblem`，检查顺序、额外键拒绝及带 label 的错误文字相同。query 的 tagged parser 替换也保持原两种错误文字。 |
| N4／B 拒绝结果 | **OK。** [query-execution.ts:24](D:/cxt/c1-g3-review/src/core/work-graph/queries/query-execution.ts:24)、[query-job-service.ts:31](D:/cxt/c1-g3-review/src/core/work-graph/queries/query-job-service.ts:31)：空 `current` 仍省略，非空仍保留；[note-views.ts:226](D:/cxt/c1-g3-review/src/core/work-graph/views/note-views.ts:226) 的 `okFalse` 保持 `ok → code → reason`。业务包装 [note-service.ts:481](D:/cxt/c1-g3-review/src/core/work-graph/notes/note-service.ts:481) 保留。 |
| N5 | **OK。** [note-related-scope.ts:88](D:/cxt/c1-g3-review/src/core/work-graph/notes/note-related-scope.ts:88) 槽位仍按 0→4、只丢 null；如 `[a,null,b,a,""]` 仍得 `[a,b,a,""]`。`:83` 路径仍为 exact 或 `${base}/`，不会接纳 `file:src/a-b/x`。 |
| N6 | **OK。** [note-anchors.ts:281](D:/cxt/c1-g3-review/src/core/work-graph/notes/note-anchors.ts:281) 保持一基 UTF-16 行列、结束列排除、按 `\n` 分拆重连；没有 CRLF 归一化或越界 fallback，旧 hit 包装保留。 |
| N7 | **OK。** [graph-index.ts:48](D:/cxt/c1-g3-review/src/core/work-graph/architecture/graph-index.ts:48) 仍是 `JSON.stringify → UTF-8 → base64url`；调用方对象键顺序未变，两种 decoder 及错误文字保持独立。 |
| N9 | **OK。** [automatic-rework-notices.ts:91](D:/cxt/c1-g3-review/src/core/work-graph/views/automatic-rework-notices.ts:91) 保持 `lookupOrdered.call(records, …)`、asc、200、bound/after 省略规则、原失败对象及 next 到底；没有接入预算。 |
| N10 | **OK。** [store-failures.ts:9](D:/cxt/c1-g3-review/src/core/work-graph/notes/store-failures.ts:9)、`:18` 只保留 `revision_conflict`／`invalid`／`not_found`，其他均为 `unavailable`；reason 和两种结果键顺序不变。旧 [note-read-model.ts:64](D:/cxt/c1-g3-review/src/core/work-graph/notes/note-read-model.ts:64) 转出保留。 |
| B 编号接线 | **OK。** [graph-context-reader.ts:901](D:/cxt/c1-g3-review/src/core/work-graph/views/graph-context-reader.ts:901) 仍先 edge 后 legacy；schemaVersion／inputRequirements 门槛、过滤条件及对象构造均保持。 |

范围与交接：33 个文件均在白名单，`tasks/`、G1 冻结模块、`terminalProposalOf`、测试和 allowlist 未改；`goal-executed-files-reader.ts` 没有被并入。新增 helper 均有生产调用。继承待接表中，静态核对确实只剩 [read-result-failures.ts:66](D:/cxt/c1-g3-review/src/core/work-graph/persistence/read-result-failures.ts:66) 的 `sessionStoreFailureToRejection`（G2），以及 `:110`／`:124` 的两个 owner 映射（G5）没有生产引用。接口表除上述消费者错误外，所列 helper 的参数、返回协议与实现相符。

事件编码器逐个如下；全部保留原签名、完整 `JSON.stringify(event)`，外壳键顺序均为 `eventId → eventType → schemaVersion → occurredAt → json`：

| 位置 | 编码器 | 结论 |
|---|---|---|
| [note-record-codecs.ts:518](D:/cxt/c1-g3-review/src/core/work-graph/persistence/note-record-codecs.ts:518) | `encodeNoteWrittenEvent` | OK |
| [note-record-codecs.ts:593](D:/cxt/c1-g3-review/src/core/work-graph/persistence/note-record-codecs.ts:593) | `encodeNoteDispositionChangedEvent` | OK |
| [note-record-codecs.ts:637](D:/cxt/c1-g3-review/src/core/work-graph/persistence/note-record-codecs.ts:637) | `encodeCurrentPointerMovedEvent` | OK |
| [architecture-record-codecs.ts:763](D:/cxt/c1-g3-review/src/core/work-graph/architecture/architecture-record-codecs.ts:763) | `encodeArchitectureSourceObservedEvent` | OK |
| [architecture-record-codecs.ts:769](D:/cxt/c1-g3-review/src/core/work-graph/architecture/architecture-record-codecs.ts:769) | `encodeArchitectureAutoCaptureEvent` | OK |
| [catalog-record-codecs.ts:565](D:/cxt/c1-g3-review/src/core/work-graph/architecture/catalog-record-codecs.ts:565) | `encodeArchitectureCatalogAdoptedEvent` | OK |
| [catalog-record-codecs.ts:569](D:/cxt/c1-g3-review/src/core/work-graph/architecture/catalog-record-codecs.ts:569) | `encodeArchitectureCatalogRevisedEvent` | OK |
| [query-record-codecs.ts:518](D:/cxt/c1-g3-review/src/core/work-graph/queries/query-record-codecs.ts:518) | `encodeQueryJobSubmittedEvent` | OK |
| [query-record-codecs.ts:580](D:/cxt/c1-g3-review/src/core/work-graph/queries/query-record-codecs.ts:580) | `encodeQueryExecutionRecordedEvent` | OK |
| [query-record-codecs.ts:628](D:/cxt/c1-g3-review/src/core/work-graph/queries/query-record-codecs.ts:628) | `encodeQueryJobAnsweredEvent` | OK |

会出错 0 项，不整洁 2 项。