# R3a Sol 骨架与独立契约测试交接

> 完成状态（2026-09-24）：骨架与测试已被 dsh 接入生产并通过[独立验收](../reviews/R3a-R4a-sol-dsh-acceptance.md)。下文 RED 与“未接入”描述交付时基线；最终写范围含 legacy-adapter.ts，共 4 文件。

日期：2026-09-23。此文件记录已落盘的最小骨架与独立验收边界，供 dsh 完成 R3a 返修。根任务与规则仍以 [R3a 原契约](R3a-goal-record-store.md) §5–8 和 [返修任务](R3a-R4a-acceptance-fixes.md) §3 为准。未改已有生产主路径、Kernel 或两份冻结独立测试。

## 已落盘

1. `C/src/core/record-store/guarded-revision.ts`：导出 `decodeGuardedRevision(registry, refKey, storedJson): DecodeResult<number|null>`。它复用已有 `decodeRefKey`、`decodeRecordBody`、`applyRecordSchema`，机械核验完整规范 key、注册 schema、正文 ref 与 revision，再返回 revision；`null` 仅表示确实没有行。未知 guard 聚合类型返回 `invalid`，由 Store 的事务边界映射为 `corrupt`。这不同于现有 `readMany` 对未知类型返回 `unsupported`，不得顺带改写读语义。helper 纯计算，不创建 Store、不读数据库、不决定 Goal 领域规则。
2. `C/tests/data/R3a-contract-invariants.test.ts`：真实 Memory/SQLite 两后端对照。它在 Goal 服务完成 scope read 之后、最终 commit 之前，分别注入同版本坏 ref、未知 aggregateType schema 和正常 revision 变化；前两者预期拒绝 `unavailable`（底层 `corrupt`），正常变化预期 `revision_conflict`，且均不创建 Goal。另测普通 JSON 命令在首个异步 lookup 前已被隔离。RAT-03 用例复制真实旧 writer 库到临时目录，从旧 idempotency receipt 的精确 cursor 定位原 GoalCreated，核对新 `GoalTaskPort.createGoal` 返回原 Goal@1、原 cursor、零新事件；再用新 WG 提交下一 Goal，关闭重开后重放两者。历史证据库只读，未添加 trigger 或写入。

## dsh 需填的精确位置

- `C/src/core/record-store/in-memory-record-store.ts` 的 `currentRevisionOf`：在同步原子写段内，把实际 Map 中该 key 的 snapshot 编为 JSON，并交给 `decodeGuardedRevision(registry, refKey, json)`；真正不存在传 `null`。现有 `guardConflicts` 的 `invalid → corrupt` 路径可沿用。不要只读 `snapshot.revision`，不要对每次提交复制完整历史。
- `C/src/core/record-store/sqlite-record-store.ts` 的 `currentRevisionOf`：在 `BEGIN IMMEDIATE` 后原有查询里把 `snapshot_json` 原文交给同 helper；真正无 row 传 `null`，非文本 row 仍 `corrupt`。保留幂等命中先于 guards、CAS 冲突 current 为事务内版本。不要提前在事务外校验代替最后 guard。
- `C/src/core/work-graph/tasks/task-service.ts` 的 `cloneInput`/`admitGoalCreation`/`createGoalFromHost`：克隆失败不能退回调用者原引用。可以提取并独立拥有已定义字段，或在任何副作用前以 `invalid` 明确拒绝。`command`、身份、fingerprint、scope、payload、caller pins 与 host request 在第一次 await 后都应源于同一调用时快照。保留正常 JSON 和现有指纹规范；不要用 JSON stringify 静默丢字段。需要时可在本文件放一个窄的错误分支或局部 clone helper，无需新的通用层。
- dsh 可增自己必要的回归，但不得改 `C/tests/data/R3a-goal-record-store.test.ts`、`C/tests/data/R3a-goal-input-isolation.test.ts`、本独立契约测试来取得通过。

## 基线与来源

`C/tests/data/R3a-contract-invariants.test.ts` 以 Node 24、Vitest 单 worker 运行：**8 项中 4 GREEN、4 RED**。四项 RED 正是 Memory/SQLite 同版本坏 ref / 坏 schema 在最终 guard 被错误放行；正常 revision 冲突、调用前正常 JSON 隔离、真实旧库新接口重放均 GREEN。`tsc --noEmit -p tsconfig.json` 通过。此次没有 build 或全量测试。

RAT-03 来源：`C/evidence/rat-03/platform-dispatch/recovery-exactly-once-trial-1/gui-data/projects/local-0e240f792710932932cd/ledger.sqlite`，原文件 SHA-256 `07eba45f2721722f7446c4a9efd5178701bfdd8e30b8546b740c913167748f94`。它包含旧 GoalCreated / identity receipt 和已推进到 revision 2 的 Goal；测试以 receipt cursor 定位原事件，不扫描并任选另一个 Goal。测试结束再次核对原库字节 hash。

冻结测试 SHA-256：`R3a-goal-record-store.test.ts` 为 `27c3ad1c99f8ddd5b2626cab1b9affbfb328f4b28c94a50f88e04779b3a70197`；`R3a-goal-input-isolation.test.ts` 为 `23c7ea830d86780c97379a6bd4055e3fc924fce477556f845a24336b9b150e01`。返修完成后重新核对两值。

## 2026-09-24 测试范围补充

按 dsh 隔离实现回归反馈，校正 `C/tests/core/record-store/{in-memory,sqlite}-record-store.test.ts` 两处旧自检：原夹具 `revisionZeroGoalRecord` 生成 Goal@0，但同夹具的 `TEST_RECORD_SCHEMAS` 明确规定 Goal revision 必须 ≥1。R3a §7 又要求最终 guard 校验 schema；因此把 Goal@0 当作合法“真实 0”是测试前提错误。现有两测试保留“缺失行的 current=null，不能当 0”断言，另明确要求 Goal@0 为 `corrupt`，并以合法 ProjectSnapshot@1 revision 0 + `expectedRevision:0` 成功提交证明真实 0。没有放宽 schema 或弱化 null/0 对比。

另在 `R3a-contract-invariants.test.ts` 增加直接经真实 `createLegacyGoalCommitAdapter`/Memory backend 的不可克隆 raw batch 隔离反例。额外函数字段令 `structuredClone` 失败，lookup 异步暂停后调用者同时改事件、快照和 Goal pin 的目标 ID 与 objective；允许按调用时原目标和正文提交，或在任何写入前 `invalid_commit` 拒绝，不能写入后来篡改的目标或正文。这个新增反例精确指向 `C/src/core/work-graph/persistence/legacy-adapter.ts` 的 `ownBatch` fallback 原引用；dsh 需在自己的隔离 lane 修改该文件，修法应保持原 raw fingerprint / 旧 replay 语义，不扩大通用框架。

主树未接 dsh 生产改动时，Node 24 `tsc --noEmit -p tsconfig.json` GREEN；三份定向测试共 51 项，44 GREEN、7 RED。七项 RED 分别为原最终 guard 四项、新 raw batch 隔离一项、两份 `tests/core` 的 Goal@0 corrupt 断言。旧两个 core RED 是本次校正后预期暴露的同一最终 guard 缺陷，不代表合法 Project@0 失败；在 guard 修复接入后，两测试将继续执行 Project@0 成功断言。未 build、未跑全量。
