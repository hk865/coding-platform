全程只读，未写文件、未运行测试。以下基于提供的 diff 和 `base/` 对照；副本没有 Git 元数据，无法独立验证 tag 哈希。

| 分类 | 位置 | 发现 | 修法 |
|---|---|---|---|
| **会出错** | [line-settings-service.ts:62](D:/cxt/c1-g2-review/src/core/work-graph/configuration/line-settings-service.ts:62)；[旧版:89](D:/cxt/c1-g2-review/.lead-ref/base/src/core/work-graph/configuration/line-settings-service.ts:89) | 校验后新增第二次 `expected[0]` 读取。具体反例：有效调用上下文、当前 Workspace revision=1、`add/remove=[]`、无原回执；`expected` 是长度为 1 的数组，其索引 getter 首次返回该 Workspace 的 revision=1 pin，此后返回 revision=2 pin。**旧版捕获首次 pin，正常提交；新版捕获第二个 pin，返回 `revision_conflict`，文本为 `the Workspace revision changed since it was read`。** 公开 TypeScript 端口没有限制必须使用普通 JSON 数组；这是访问器输入下的差异。 | 共享校验返回首次捕获的 pin；decision 服务包装为 `null`，line 服务包装为 `{ pin }`，不要重新取数组元素。 |
| **不整洁** | [session-directory.ts:13](D:/cxt/c1-g2-review/src/core/work-graph/sessions/session-directory.ts:13)、[同文件:939](D:/cxt/c1-g2-review/src/core/work-graph/sessions/session-directory.ts:939) | 删除历史限定后，仍声称 Module 没有 canonical provider、必须 `unsupported`；实际 [session-targets.ts:138](D:/cxt/c1-g2-review/src/core/work-graph/sessions/session-targets.ts:138) 已通过当前采用的架构目录验证 Module。这是规则 5 要删除的过期说明。 | 两处均改为 Task 验证当前 Plan、Module 验证当前目录、WorkContext 仍不支持，保留“不伪造关联”的理由。 |
| **不整洁** | [session-links.ts:20](D:/cxt/c1-g2-review/src/core/work-graph/sessions/session-links.ts:20)、[decision-source-facts.ts:212](D:/cxt/c1-g2-review/src/core/work-graph/communication/decision-source-facts.ts:212)、[session-lifecycle.ts:784](D:/cxt/c1-g2-review/src/core/work-graph/sessions/session-lifecycle.ts:784) | SE-4 未清完施工标签，还新增了 `G1's map`、`never a G1 shared map`。directory:114、lifecycle:96、responsibility:68 同样新增 G1 标签；`Lead decision L-a`、session-health:14 的 lead 日期仍在。违反规则 5。 | 删除组别、施工日期和返工标签，保留 claim slot、独立错误映射、取消事实等规则与理由。 |
| **不整洁** | [c1-g2-final.md:21](D:/cxt/c1-g2-review/.lead-ref/c1-g2-final.md:21)、[同文件:27](D:/cxt/c1-g2-review/.lead-ref/c1-g2-final.md:27) | 接口表缺完整参数类型、返回类型及类型定义；Workspace 六函数仅写 `see brief / per source`，不满足 book §5。`identityKeyOf` 返回说明也不准确：实际是 **prefix + SHA**。 | 按每个导出补完整签名、返回协议、原实现位置及消费者，并纠正身份键说明。 |
| **建议** | [role-memory-service.ts:145](D:/cxt/c1-g2-review/src/core/work-graph/configuration/role-memory-service.ts:145)、[message-record-codecs.ts:244](D:/cxt/c1-g2-review/src/core/work-graph/sessions/message-record-codecs.ts:244) 等 | 复算确为 **+1,267/−1,802，共 3,069 行，净 −535**。其中 14 文件有 **490 对纯名称替换行，计 980 行**。例如 `@@ -153,35 +142,35` 的 `reject` 政名、`@@ -261,20 +241,20` 的 primitive 政名，均不需要改调用点。另 [directory:338](D:/cxt/c1-g2-review/src/core/work-graph/sessions/session-directory.ts:338) 的状态机长注释只有措辞和换行变化，也可撤回。 | 用 `rejectedWithCurrent as reject`、`isRecord as isObject` 等导入别名保留旧调用名，撤销纯改名 hunk。预计降至约 **2,089 行**，仍高于目标；不能用净减少解释全部审查负担。 |

其余重点核对结果：

- **Session 边界与身份：** [trusted-context.ts:32](D:/cxt/c1-g2-review/src/core/work-graph/sessions/trusted-context.ts:32) 保留 scope → signal → principal → actor、各服务原文本及成功字段顺序；没有新增 null-context guard 或身份 clone。`ownRequest`、身份键、指纹的 expected 排序与 payload 展开顺序、eventId 均与各旧实现一致；directory 的任意值 clone 留在本地。
- **SE-5／SE-2：** [decision-source-facts.ts:224](D:/cxt/c1-g2-review/src/core/work-graph/communication/decision-source-facts.ts:224) 的模板只承载原文本差异，一次 `readMany`、missing／未说明遗漏、历史来源均保留；[mailbox-service.ts:1072](D:/cxt/c1-g2-review/src/core/work-graph/communication/mailbox-service.ts:1072) 四个入口的文本、检查顺序、1–100、数字水位比较、null／`MIN_CURSOR` 和读取次数一致。
- **SE-3／SE-7：** 除表中 pin 重读问题，[workspace-settings-reads.ts:112](D:/cxt/c1-g2-review/src/core/work-graph/configuration/workspace-settings-reads.ts:112) 保留原 `eventAt(receipt.cursor)`、各自 decoder、业务迁移与提交条件；[session-links.ts:29](D:/cxt/c1-g2-review/src/core/work-graph/sessions/session-links.ts:29) 保留索引、200／2000、observer 时点、预算及损坏文本，以及 directory 的 `value`／lifecycle 的 `links` 包装。
- **B 接线：** 四个适配器对正式 `StoreFailure` 输入未发现结果差异；owner 后缀、damage 前缀、`current` 省略规则保留。14 个 `canonicalOf`、2 个 nullable `parseObject`、primitive 和 rejection 接线一致，显式传入空数组仍保留 `current: []`，未发现误接严格／宽松检查。
- **注释／范围／可达性：** 未发现实际规则或 why 丢失；上述状态机长注释仅有措辞变化。提供的 23 文件 diff 均在白名单内，没有 G1 模块或测试改动。三个新模块均有生产调用。静态引用支持剩余六项名单：`okFalse`、`edgeDeclarationId`、`legacyDeclarationId`、`executionStoreFailureToRejection`、`ownerWriteStoreFailureToRejection`、`ownerReadStoreFailureToRejection`；消费组与交接表一致。

16 处编码实现全部 **OK**：旧版均取事件的四个字段，并对完整事件执行 `JSON.stringify(event)`；新版保持外层键顺序 `eventId → eventType → schemaVersion → occurredAt → json`。

| # | 编码器及位置 | 结果 |
|---|---|---|
| 1 | [session-record-codecs.ts:1001](D:/cxt/c1-g2-review/src/core/work-graph/sessions/session-record-codecs.ts:1001) — `encodeSessionCreationAdmittedEvent` | OK |
| 2 | [session-record-codecs.ts:1005](D:/cxt/c1-g2-review/src/core/work-graph/sessions/session-record-codecs.ts:1005) — `encodeSessionCreatedEvent` | OK |
| 3 | [lifecycle-record-codecs.ts:571](D:/cxt/c1-g2-review/src/core/work-graph/sessions/lifecycle-record-codecs.ts:571) — `encodeSessionWorkLinkChangedEvent` | OK |
| 4 | [lifecycle-record-codecs.ts:575](D:/cxt/c1-g2-review/src/core/work-graph/sessions/lifecycle-record-codecs.ts:575) — `encodeSessionLifecycleChangedEvent` | OK |
| 5 | [lifecycle-record-codecs.ts:579](D:/cxt/c1-g2-review/src/core/work-graph/sessions/lifecycle-record-codecs.ts:579) — `encodeSessionHealthObservedEvent` | OK |
| 6 | [lifecycle-record-codecs.ts:583](D:/cxt/c1-g2-review/src/core/work-graph/sessions/lifecycle-record-codecs.ts:583) — `encodeSessionArchiveChangedEvent` | OK |
| 7 | [lifecycle-record-codecs.ts:587](D:/cxt/c1-g2-review/src/core/work-graph/sessions/lifecycle-record-codecs.ts:587) — `encodeSessionProvenanceBackfilledEvent` | OK |
| 8 | [lifecycle-record-codecs.ts:591](D:/cxt/c1-g2-review/src/core/work-graph/sessions/lifecycle-record-codecs.ts:591) — `encodeSessionResponsibilityChangedEvent` | OK |
| 9 | [message-record-codecs.ts:1168](D:/cxt/c1-g2-review/src/core/work-graph/sessions/message-record-codecs.ts:1168) — `encodeMessageEvent` | OK |
| 10 | [message-record-codecs.ts:1194](D:/cxt/c1-g2-review/src/core/work-graph/sessions/message-record-codecs.ts:1194) — `encodeArchiveWaitDisposedEvent` | OK |
| 11 | [project-bootstrap-record-codecs.ts:368](D:/cxt/c1-g2-review/src/core/work-graph/configuration/project-bootstrap-record-codecs.ts:368) — `encodeProjectRegisteredEvent` | OK |
| 12 | [project-bootstrap-record-codecs.ts:371](D:/cxt/c1-g2-review/src/core/work-graph/configuration/project-bootstrap-record-codecs.ts:371) — `encodeProjectWorkspaceRegisteredEvent` | OK |
| 13 | [project-bootstrap-record-codecs.ts:374](D:/cxt/c1-g2-review/src/core/work-graph/configuration/project-bootstrap-record-codecs.ts:374) — `encodeProjectCompletionPolicyInstalledEvent` | OK |
| 14 | [project-bootstrap-record-codecs.ts:379](D:/cxt/c1-g2-review/src/core/work-graph/configuration/project-bootstrap-record-codecs.ts:379) — `encodeProjectCompletionPolicyActivatedEvent` | OK |
| 15 | [role-record-codecs.ts:437](D:/cxt/c1-g2-review/src/core/work-graph/configuration/role-record-codecs.ts:437) — `encodeRoleSpecInstalledEvent` | OK |
| 16 | [role-record-codecs.ts:440](D:/cxt/c1-g2-review/src/core/work-graph/configuration/role-record-codecs.ts:440) — `encodeRoleSpecActivatedEvent` | OK |

第 9 项的七个公开包装 `encodeSessionMessage{Sent,Read,Responded,ConsultationDerived,InputAccepted,DecisionAnswered,DecisionApplied}Event` 也全部保持原样。

会出错 1 项，不整洁 3 项。