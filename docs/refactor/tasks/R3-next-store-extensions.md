# R3c/R4b RecordStore 最小事务扩展

状态：Sol 协议/独立测试、DSH 实现和主审集成已完成，见[本轮报告](../reviews/next-r3c-r4b-2026-09-24.md)。范围仅为 R3c/R4b 共用的唯一槽、ledger horizon 和记录提交游标绑定。`indexGuards`、`indexChanges` 继续是空 tuple。Session 目录和 links 继续用现有注册 JSON lookup 随快照自动维护；本批不实现大索引框架。

## 已冻结协议

- `PreparedCommit.claims: readonly UniqueClaimChange[]`，每项 `{claimKey, expectedOwner, nextOwner}`，owner 是 `string|null`；唯一槽必须在同一物理事务内精确 CAS。冲突返回 `unique_conflict` 和事务中观察到的 `{claimKey, owner}[]`。
- `ledgerHorizon?: CommitCursor|null`：缺省表示不检查；显式 null 要求事件账本仍为空。失配返回 `revision_conflict`、`current: []`，reason 明确说 ledger horizon，不伪造记录版本。它为尚未有同步分区索引的负读保正确性，允许保守冲突。
- `commitCursorBindings?: readonly {refKey,field:'since'|'until'}[]`：目标仅为本提交写入的记录、schema 明示允许的顶层字段，原值必须是 null；每 ref/field 至多一次，每目标必须有 `RecordGuard`。禁止任意 JSON path、未注册字段及无事件绑定。
- `EncodedRecordSchema.commitCursorFields?: readonly ('since'|'until')[]` 是注册白名单。注册时验证、复制并冻结，拒绝重复和非法字段。提交外校验机械 envelope、白名单与 null 占位；被绑定的记录在取得本提交末事件真实 cursor 并填充后才调用完整 schema 校验（正式 since schema 可以拒绝 null）。没有绑定的记录保持原有完整预校验。最终失败使事件、快照、claim 和幂等记录一起回滚。

固定顺序：预检和输入克隆；单一写事务内先查幂等身份，再核对记录 guards、claims 和 horizon；故障注入点；写事件并得真实尾 cursor；绑定和最终 schema 校验；写快照与 claim；记录原幂等回执；提交。同身份同指纹重放原 cursor，不再次绑定；不同指纹仍拒绝。SQLite 继续共用现有 connection 与 `BEGIN IMMEDIATE`，Memory 继续原状态对象和定向 undo。不得在 Store 中调用领域回调、猜下个 cursor 或提交后补写。

`next/src/core/record-store/commit-extensions.ts` 当前只有抛 unsupported 的函数型接口，供 DSH 填充或调整；它不是已实现能力。实现还需修改 `record-codec.ts`（输入规划、注册白名单、绑定最终校验）、Memory/SQLite backend、SQLite migration（unique slot 持久表）。上述文件未由 Sol 修改。旧 Goal 提交和现有测试必须保持通过。

## 独立验收

`next/tests/record-store/transaction-extensions.test.ts` 直接运行真实 Memory 和 SQLite backend。覆盖空账本 horizon 的失配、owner 精确观察和 CAS 竞态、真实尾 cursor 绑定和重放、最终 schema 失败回滚、无绑定普通写入、输入不变、无效绑定、SQLite 关闭再打开后的持久 claim/绑定值。初次 RED：11 例，7 例因 backend 尚拒绝扩展字段而失败，4 例现有安全行为通过。当前 `next` 全局 typecheck 的错误来自并行编写中的 Session/Plan/Material 类型，扩展文件本身无类型错误。

## 主审冻结补充（2026-09-24）
沿用现有 identity_claims 表和原子事务即可，不新造一套同义持久槽。共享 AggregateRef 已包含 Session、SessionWorkLink、CoreOperation；Store仍通过注册schema接纳通用ref，不 import WorkGraph。预检过程可以验证格式，但幂等同指纹回放必须先于 stale guards/horizon/claim 检查。schema/lookup维护仅处理受本次提交影响的记录，不累计扫描全部数据。保留已有所有测试；不得为旧测试绕过新约束。
