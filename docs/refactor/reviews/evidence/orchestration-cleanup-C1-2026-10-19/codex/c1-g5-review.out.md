静态审查未发现可证明的行为差异；发现 3 项清理问题。以提供的 diff/base 为依据，未写文件、未运行测试。下列源码路径均相对 `src/core/work-graph/`。

| 分类 | file:line | 发现 | 一项修复 |
|---|---|---|---|
| 不整洁 | `model/claim-contracts.ts:95` | ST 补充一只完成了 dispatch 别名；`TaskClaimOutbox` 仍重复声明 `state/attempt-machine.ts:65` 的六个字段，交接却报完成。两者结构、V1/V2 联合及可选性相同。 | 改为 `TaskClaimOutbox = DispatchOutboxRecord`，把 `dispatchState` 字段规则注释迁至唯一声明。 |
| 不整洁 | `state/attempt-machine.ts:52`；`model/communication-contracts.ts:252` | 规则 5 清理未完：前者仍称 decoder 只接受 legacy pending，但 `tasks/claim-record-codecs.ts:301` 已接受三种状态；后者残留施工标签 `(Stage 1 seam)`。 | 删除过期判断及施工标签，保留状态一致性和准入规则正文。 |
| 不整洁 | `tasks/unknown-call-review-service.ts:4` | 原注释的 **“Each write”** 限定丢失，新文把 `listReviews` 也描述为经过 receipt、状态机、M3、commit；实际 `:1408` 是读口。违反规则 5 的规则保留要求。 | 恢复“Each write follows the owner order”，读口另句说明。 |
| 建议 | `.lead-ref/c1-g5-final.md:15` | 接口表称 anomaly 有 4 个 `sameRef` 调用点，实际只有 `state/session-anomaly.ts:64`、`:65`；availability 的 3 处正确。 | 将 4 改为 2；两个新助手的签名、返回形状及来源说明其余准确。 |
| 建议 | `state/run-machine.ts:766` | 删除施工组号时连正式守卫编号 **G1** 一起删了；它对应 `slice-K3-SPEC.md:673`，规则正文仍在。 | 恢复为 `K3 RUN-25 guard G1 (U1)`。 |
| 建议 | `.lead-ref/c1-g5-final.md:54` | 两个 invariant 文件属于本批依赖测试，不能直接接受“基线失败”归因：`tests/state/invariants.ts:77`、`:89`、`:100` 直接使用修改过的 codecs/state；fuzz 经 `tests/state/invariants-fuzz.test.ts:47` 的 harness 执行相关实现。 | 保留为未归因失败，由 lead 对照同环境 base/candidate 的原始断言、堆栈和 seed；本次源码比较未找到导致失败的具体差异。 |

其余重点核对结果：

- **ST-1／N8：**旧导出名均保留，message/plan 字段、联合、可选性和 null 均相同；`TaskDispatchStateV1`、`TaskEntryPermit`、`PlanProposal` 别名等价（`model/claim-contracts.ts:92`、`execution-entry-contracts.ts:39`、`plan-contracts.ts:36`）。N8 参数七字段相同，仍为 decision → note（`model/decision-contracts.ts:201`）。新增 model → state 符合 `docs/refactor/module-target.json:29`；state 未新增禁止依赖或状态写入出口。
- **ST-4：**`state/line-status.ts:696` 保持 task → card → line unknown → anchors 的候选集合和顺序；rank/order/key 决胜及 `complete` 条件相同。`:749` 的详情仍使用真实 card source 或同一个 headSource，输出键序不变。
- **ST-9：**`state/line-status.ts:764` 已对 `holder ≠ null ∧ kind=run ∧ status=ended ∧ outcome=outcome_unknown` 返回。删除分支只是再加 `head.health=unavailable`，是前置条件的子集，故不可达；query/copy 顺序未变。
- **ST-6／ST-7：**`state/task-machine.ts:668` 的预算条件、拒绝位置和文本等价；`state/ref-equality.ts:2` 函数体与旧 anomaly 实现逐字相同，仅增加导出。K3 指定字段比较仍独立保留（`state/command-rerun-request.ts:249`、`:253`；`state/review-lease.ts:67`）。
- **N12／owner maps：**`tasks/owner-record-read.ts:29` 保持一次 `readMany`，顺序仍是读取异常 → 非 ready → 查匹配记录 → missing → decode。missing 仍为 `{ok:false,notFound:true}`；CRR/UCR 的 `the request/review could not be read: …`、`the stored request/review is not decodable: …` 原文保留（两 service 的 `:184`、`:422`）。写映射 unique→busy 无后缀、revision_conflict 无 current、unsupported/corrupt→unavailable；读映射仅保留 invalid/unsupported。receipt 的 `eventAt` 仍使用原写映射语义（`tasks/receipt-replay.ts:99`），未发现任何 store failure 分支结果改变。
- **SessionRef／B：**两份旧严格校验与 `persistence/rework-codecs.ts:154` 相同：对象 → 额外键 → projectId → sessionId，标签文本不变。`canonicalOf`、nullable `parseObject` 接线等价，decision source 外层及 kind 检查保留（`state/context-input.ts:318`；`tasks/decision-source-identity.ts:13`）。CRR/UCR 保留传入的空 `current`；其余 rejection 不新增该字段。不同下界的 `isSafeRevision`、保留的对象检查、execution-entry 宽松 refs 未被误并。
- **范围／注释：**37 文件均在白名单内；未改 G1、测试或 allowlist。长状态机规则注释及迁移字段的规则／why 保留，除表中问题外未发现规则正文丢失。`F-*`、`L*`、`4C-2 §2 item 4` 等规格引用应保留。计数为 +419/−775，净减 356。

8 个编码器均为 **OK**：包装签名保留，仍按 `eventId → eventType → schemaVersion → occurredAt → json` 构造外壳，正文均为原始 `JSON.stringify(event)`。

| 编码器 | file:line | 结果 |
|---|---|---|
| `encodeTaskClaimedEvent` | `tasks/claim-record-codecs.ts:331` | OK |
| `encodeTaskRequeuedEvent` | `tasks/claim-record-codecs.ts:741` | OK |
| `encodeTaskReworkRefusedEvent` | `tasks/claim-record-codecs.ts:763` | OK |
| `encodeCompletionEvent` | `tasks/completion-record-codecs.ts:212` | OK |
| `encodeModelRequestRecordedEvent` | `tasks/model-request-codecs.ts:171` | OK |
| `encodeSessionAnomalyRecordedEvent` | `tasks/session-anomaly-codecs.ts:297` | OK |
| `encodeCommandRerunRequestChangedEvent` | `tasks/command-rerun-request-codecs.ts:288` | OK |
| `encodeUnknownCallReviewChangedEvent` | `tasks/unknown-call-review-codecs.ts:602` | OK |

会出错 0，不整洁 3。