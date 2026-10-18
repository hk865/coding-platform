只读核对了提供的 diff、基线快照和当前源码；未写文件、未运行测试。**未发现行为差异；有 6 项规则或交接问题。** 以下 `P/` 指 `src/core/work-graph/persistence/`；基线行号指 `.lead-ref/base/` 中同路径文件。

| 类别 | file:line | 发现 | 一个修法 |
|---|---|---|---|
| 不整洁 | [P/execution-history-codecs.ts:14](D:/cxt/c1-g1-review/src/core/work-graph/persistence/execution-history-codecs.ts:14)，基线 :17–25 | 删除整个 shape-rules 段时，也删掉了“与所属 Run 的 project 一致性由调用方检查”的职责边界。这不是逐字段复述；违反规则 5。 | 在 `isRunExecutionHistoryV1` 的说明中恢复调用方负责 project 一致性的规则；字段清单可以压缩。 |
| 不整洁 | [P/event-validation.ts:20](D:/cxt/c1-g1-review/src/core/work-graph/persistence/event-validation.ts:20)，基线 decision codec :146–149 | 迁移内外事件一致性检查时，保留了“不能信任正文”，却删掉原因：**decoder 会把正文直接作为事件值返回**。违反规则 5 的保留 “why”。 | 将这句原因连同 §2.8/§8.2 定位迁入公共助手注释。 |
| 不整洁 | [evidence-service.ts:766](D:/cxt/c1-g1-review/src/core/work-graph/evidence/evidence-service.ts:766)、[:798](D:/cxt/c1-g1-review/src/core/work-graph/evidence/evidence-service.ts:798)；[common.ts:1](D:/cxt/c1-g1-review/src/contracts/validation/common.ts:1)、[:82](D:/cxt/c1-g1-review/src/contracts/validation/common.ts:82)；[fingerprint.ts:1](D:/cxt/c1-g1-review/src/contracts/fingerprint.ts:1) | 施工叙述未清完：`part-1 admission`、`Stage 1 declares the seam only`、迁移/N0 叙述仍在。尤其 scoped resolver 已在 evidence-service :1027 实际调用，“只声明”已过时。 | 删阶段、迁移叙述，改述当前默认行为；保留有用的来源定位及权限规则。 |
| 不整洁 | [c1-g1-final.md:17](D:/cxt/c1-g1-review/.lead-ref/c1-g1-final.md:17)、[:20](D:/cxt/c1-g1-review/.lead-ref/c1-g1-final.md:20)、[:27](D:/cxt/c1-g1-review/.lead-ref/c1-g1-final.md:27) | 冻结接口表不完整。多项只有名字，没有参数类型、泛型约束和准确返回类型；`utf8Bytes/codePoints` 的 `number` 返回未列出；四种 rejection 的来源写成 “new”，没有原实现定位；六种失败助手也被合并成笼统的 “code / pins / CoreRejection”。不满足 book §5 的逐接口交接要求。 | 按每个导出补齐完整 TS 签名、具体返回形状、原实现 `file:line`，明确三种 `current` 规则。 |
| 不整洁 | [c1-g1-final.md:18](D:/cxt/c1-g1-review/.lead-ref/c1-g1-final.md:18)、[:19](D:/cxt/c1-g1-review/.lead-ref/c1-g1-final.md:19)、[:25](D:/cxt/c1-g1-review/.lead-ref/c1-g1-final.md:25)、[:54](D:/cxt/c1-g1-review/.lead-ref/c1-g1-final.md:54) | 消费者交接有错漏：`parseTaggedObject` 误列 G3 note，实际 [note-record-codecs.ts:130](D:/cxt/c1-g1-review/src/core/work-graph/persistence/note-record-codecs.ts:130) 使用 nullable `parseObject`；`canonicalOf` 漏 G4；事件外壳漏 G3；`rejectedWithNonEmptyCurrent` 漏 G3 的 query 消费者。 | 按 delta §四的文件归属重新列消费者文件及符号；note 接 `parseObject`，不要接带字符串错误协议的解析器。 |
| 不整洁 | [c1-g1-final.md:9](D:/cxt/c1-g1-review/.lead-ref/c1-g1-final.md:9)；约束 [c1-run-g1.md:3](D:/cxt/c1-g1-review/.lead-ref/c1-run-g1.md:3) | 实际确为 **+678/−896＝1,574 行**，却全部完成且未拆分。任务书要求明显超过 1,200 时完成 G1a 后停止、交给 lead 安排 G1b；“白名单覆盖这些文件”不能替代这个停止条件。 | 按 book §4 分开 G1a/G1b 的交接和验收范围，明确记录此次未遵守停止条件。 |

其余重点核对结果：

- **事件校验一致。** [event-validation.ts:6](D:/cxt/c1-g1-review/src/core/work-graph/persistence/event-validation.ts:6) 保持外壳 `eventType → schemaVersion → eventId → occurredAt`；内外一致性保持 id/type/version/time；正文保持对象/额外键、identityKey、fingerprint、project、workspace、requestId、actor、payload 的顺序。错误文字未变；前三种检查仍返回 `string|null`，正文检查仍返回原 record 或错误字符串。[line-settings-codecs.ts:82](D:/cxt/c1-g1-review/src/core/work-graph/persistence/line-settings-codecs.ts:82) 仍先检查 null proof，再检查 Workspace。
- **公共原语一致。** [common.ts:21](D:/cxt/c1-g1-review/src/contracts/validation/common.ts:21) 保留安全整数、非负安全整数、正安全整数三种判断；UTF-8 字节与码点计数没有混用；非空串没有新增 trim；`hasOnlyKeys` 没有变成必填键检查。`parseObject` 对坏 JSON、数组、null、标量仍返回 null；`parseTaggedObject` 两句仍精确为 `${what} is not valid JSON`、`${what} JSON must be an object`。[canonicalOf:60](D:/cxt/c1-g1-review/src/contracts/fingerprint.ts:60) 失败仍返回 null；evidence 的 SHA 包装仍直接抛错。
- **近似校验器没有误接。** execution-entry 的宽松 RunRef/SessionRef、evidence 的宽松 TaskTriple 和带 minimum 的整数校验、decision 的两种 SessionMessageRef 错误、decision actor 与 rework actor 的不同错误协议均保留。两个 task shape 检查转出的是同体实现；原导出名称、参数和返回类型未发现破坏。
- **拒绝结果一致。** [rejections.ts:5](D:/cxt/c1-g1-review/src/contracts/core/rejections.ts:5) 四种形状分开；属性顺序保持 `status, code, reason[, current]` 或 `ok, code, reason`。evidence 保留传入的空数组，applicability 仍受窄 `MaterialAdmission` 返回类型约束。[verification-plan.ts:53](D:/cxt/c1-g1-review/src/core/work-graph/evidence/verification-plan.ts:53) 的 `{status,code,issues}` 保持独立。
- **失败映射一致。** [read-result-failures.ts:66](D:/cxt/c1-g1-review/src/core/work-graph/persistence/read-result-failures.ts:66) 的 Session 映射保留 owner 后缀与 damage 前缀；execution 映射保留 `busy`、Kernel 后缀及 unsupported→unavailable；K3 写映射不附后缀、不解析或附带 current；K3 读映射只保留 invalid/unsupported。pin 解码不新增 schema 检查、不排序、不去重。**`storeFailureToRejection` 源码被改写了，但行为未发现变化**：14 个允许码、默认 unavailable、reason、键顺序，以及仅数组 current 被保留（包括 `[]`）均一致。
- **范围与其他文件一致。** 27 个文件全部在白名单内；没有测试、allowlist 或 `state/` 文件改动。未改 `atLeastCursor`、C2 读取次数、被撤出的返回协议或 Runtime 文件。其余列出的 codec、reader、compiler、repository、lookup 改动未发现检查顺序、列表顺序、读取次数或存储字节变化。

九项未接线声明都有真实的后组消费者，没有找到“无计划消费者”的孤立项：

| 声明位置 | 可核实的后组消费者 |
|---|---|
| [rejections.ts:22](D:/cxt/c1-g1-review/src/contracts/core/rejections.ts:22) `rejectedWithNonEmptyCurrent` | G3 [query-execution.ts:83](D:/cxt/c1-g1-review/src/core/work-graph/queries/query-execution.ts:83)、query-job-service :91；G4 requeue-service :191 |
| [rejections.ts:33](D:/cxt/c1-g1-review/src/contracts/core/rejections.ts:33) `okFalse` | G3 [note-views.ts:82](D:/cxt/c1-g1-review/src/core/work-graph/views/note-views.ts:82) |
| [input-declaration-id.ts:5](D:/cxt/c1-g1-review/src/contracts/input-declaration-id.ts:5) `edgeDeclarationId` | G3 graph-context-reader :910；G4 execution-entry-service :1093、context-assembler :766 |
| [input-declaration-id.ts:14](D:/cxt/c1-g1-review/src/contracts/input-declaration-id.ts:14) `legacyDeclarationId` | G3 graph-context-reader :924；G4 context-input-service :373、execution-entry-service :1082、context-assembler :780 |
| [read-result-failures.ts:48](D:/cxt/c1-g1-review/src/core/work-graph/persistence/read-result-failures.ts:48) `pinsFromStoreCurrent` | G2 session-directory :133；G4 claim-service :141、execution-entry-service :158、execution-history-service :107 |
| [read-result-failures.ts:66](D:/cxt/c1-g1-review/src/core/work-graph/persistence/read-result-failures.ts:66) `sessionStoreFailureToRejection` | G2 session-directory :144、session-lifecycle :139、session-responsibility-service :83、mailbox-service :177 |
| [read-result-failures.ts:88](D:/cxt/c1-g1-review/src/core/work-graph/persistence/read-result-failures.ts:88) `executionStoreFailureToRejection` | G4 execution-entry-service :169、execution-history-service :118 |
| [read-result-failures.ts:110](D:/cxt/c1-g1-review/src/core/work-graph/persistence/read-result-failures.ts:110) `ownerWriteStoreFailureToRejection` | G5 command-rerun-request-service :101、unknown-call-review-service :334、receipt-replay :71 |
| [read-result-failures.ts:124](D:/cxt/c1-g1-review/src/core/work-graph/persistence/read-result-failures.ts:124) `ownerReadStoreFailureToRejection` | G5 command-rerun-request-service :112、unknown-call-review-service :330 |

这里“未接线”指没有已连接生产入口的消费者：`pinsFromStoreCurrent` 和 `rejectedWithNonEmptyCurrent` 已被两个尚未接线的 G1 映射调用，不能称为“零 G1 引用”。`storeFailureCode` 已由现有 `storeFailureToRejection` 调用，正确地不在九项中。以上是静态引用核对，不是复跑 production-reach 的结果。

**18 个事件编码器**

全部保持同一个输入对象的 `JSON.stringify(event)`，没有先投影、删字段、改名或 canonical 化；因此键顺序、`undefined` 省略行为及 JSON 字节保持。外壳仍按 `eventId, eventType, schemaVersion, occurredAt, json` 构造，前四项均取原输入的同名属性，读取顺序也一致。

| 编码器 | 当前 file:line | 基线行 | 结论 |
|---|---|---:|---|
| `encodeControlIntentSubmittedEvent` | [control-record-codecs.ts:404](D:/cxt/c1-g1-review/src/core/work-graph/persistence/control-record-codecs.ts:404) | 440 | OK |
| `encodeControlIntentObservedEvent` | [control-record-codecs.ts:461](D:/cxt/c1-g1-review/src/core/work-graph/persistence/control-record-codecs.ts:461) | 498 | OK |
| `encodeGoalSettingsChangedEvent` | [decision-record-codecs.ts:60](D:/cxt/c1-g1-review/src/core/work-graph/persistence/decision-record-codecs.ts:60) | 53 | OK |
| `encodeWorkspaceNoticeSeenChangedEvent` | [decision-record-codecs.ts:78](D:/cxt/c1-g1-review/src/core/work-graph/persistence/decision-record-codecs.ts:78) | 77 | OK |
| `encodeVerificationRoundEvent` | [evidence-record-codecs.ts:478](D:/cxt/c1-g1-review/src/core/work-graph/persistence/evidence-record-codecs.ts:478) | 498 | OK |
| `encodeExecutionEntryAuthorizedEvent` | [execution-entry-codecs.ts:746](D:/cxt/c1-g1-review/src/core/work-graph/persistence/execution-entry-codecs.ts:746) | 772 | OK |
| `encodeExecutionEntryBegunEvent` | [execution-entry-codecs.ts:766](D:/cxt/c1-g1-review/src/core/work-graph/persistence/execution-entry-codecs.ts:766) | 793 | OK |
| `encodeExecutionEntryEnteredEvent` | [execution-entry-codecs.ts:796](D:/cxt/c1-g1-review/src/core/work-graph/persistence/execution-entry-codecs.ts:796) | 824 | OK |
| `encodeExecutionRunResultRecordedEvent` | [execution-entry-codecs.ts:810](D:/cxt/c1-g1-review/src/core/work-graph/persistence/execution-entry-codecs.ts:810) | 839 | OK |
| `encodeExecutionRunReconciledEvent` | [execution-entry-codecs.ts:828](D:/cxt/c1-g1-review/src/core/work-graph/persistence/execution-entry-codecs.ts:828) | 858 | OK |
| `encodeExecutionHistoryRecordedEvent` | [execution-history-codecs.ts:101](D:/cxt/c1-g1-review/src/core/work-graph/persistence/execution-history-codecs.ts:101) | 130 | OK |
| `encodeWorkspaceLinePinsChangedEvent` | [line-settings-codecs.ts:52](D:/cxt/c1-g1-review/src/core/work-graph/persistence/line-settings-codecs.ts:52) | 49 | OK |
| `encodePlanProposalRecordedEvent` | [plan-record-codecs.ts:1086](D:/cxt/c1-g1-review/src/core/work-graph/persistence/plan-record-codecs.ts:1086) | 1110 | OK |
| `encodePlanRevisionAcceptedEvent` | [plan-record-codecs.ts:1090](D:/cxt/c1-g1-review/src/core/work-graph/persistence/plan-record-codecs.ts:1090) | 1115 | OK |
| `encodeGoalCreatedEvent` | [record-codecs.ts:730](D:/cxt/c1-g1-review/src/core/work-graph/persistence/record-codecs.ts:730) | 754 | OK |
| `encodeGoalDesiredStateChangedEvent` | [record-codecs.ts:865](D:/cxt/c1-g1-review/src/core/work-graph/persistence/record-codecs.ts:865) | 895 | OK |
| `encodeRunActivityRecordedEvent` | [run-activity-codecs.ts:401](D:/cxt/c1-g1-review/src/core/work-graph/persistence/run-activity-codecs.ts:401) | 431 | OK |
| `encodeActivityRecordingStartedEvent` | [run-activity-codecs.ts:422](D:/cxt/c1-g1-review/src/core/work-graph/persistence/run-activity-codecs.ts:422) | 458 | OK |

会出错 0 项，不整洁 6 项。