实现完成。以下是本 lane 的变更、实测结果与已知限制。**声明：这是本地 DSH 实现与自测结果，未经主 Agent 独立验收。**

## 变更（仅改 writable 5 文件中的 4 个；`migrations.ts` 未动）

**`commit-extensions.ts`** — 填充原 unsupported 桩：
- `validateUniqueClaims`：非空 claimKey、owner 为 `string|null`（非空）、拒绝重复槽。
- `findClaimConflicts`：用事务内读到的 owner 做精确 CAS 比较。
- `ledgerHorizonMatches`：显式比较（null=空账本）。
- `bindCommitCursor`：目标必须是本提交记录、白名单字段、原值严格 `null`、每 ref/field 一次；返回绑好真实 cursor 的新记录。
- 新增导出 `RejectedInsideTransaction`（事务内回滚哨兵）、`COMMIT_CURSOR_FIELDS`。原函数签名全部保持不变。

**`record-codec.ts`**：
- 注册期校验、复制并冻结 `commitCursorFields`（拒绝非数组/非法/重复字段）。
- `planPreparedCommit` 接纳 `claims/ledgerHorizon/commitCursorBindings`；提交外只做机械 envelope、白名单、null 占位校验；**被绑定记录跳过完整 schema 预校验**，留到取得真实 cursor 后再跑；未绑定记录保持原完整预校验。`indexGuards/indexChanges` 仍是 empty-only。
- 新增 `uniqueConflictFailure`、`bindPreparedRecords`（事务内绑定 + 最终完整 schema 校验）；`PlannedCommit` 扩展三个字段。

**`in-memory-record-store.ts`** — 单一 state 增加 `claims: Map`；顺序 identity→guards→claims→horizon→`beforeWrite`→写事件(真实尾 cursor)→绑定+最终 schema→快照+claim→原幂等回执；失败原地 undo 事件/快照/claim/幂等/lookup。

**`sqlite-record-store.ts`** — 复用现有 `identity_claims`（`INSERT … ON CONFLICT` / `DELETE`），未新增同义表；同一 `BEGIN IMMEDIATE` 顺序；绑定失败抛哨兵 → `ROLLBACK` → 对外返回失败回执；owner 列损坏记为 `corrupt`。

输入仍在第一个 `await` 前 `structuredClone`。无领域回调、无嵌套事务、不扫描旧日志、不猜测 cursor、无提交后补写。

## 实测

| 检查 | 结果 |
|---|---|
| `next-store-extensions` | **16/16 通过**（实现前 14 失败/2 通过） |
| `next-store` | **33/33 通过**（5 files） |
| `next-architecture` | **OK**（边界 5/8 允许边，无违规） |
| `next-types` | 仍有 1 个既有错误，位于另一 lane 的 `tests/runtime/R4b-session-acceptance.test.ts:33`（`lookups` 可选属性 + `exactOptionalPropertyTypes`）；**src 与本次改动文件 0 错误** |
| 全量 `next-tests` | 270/284 通过；14 个失败全部在并行 skeleton lane（`R3c-plan-entry/adoption/task-graph`、`R4b-session-acceptance`），改动前后失败集合完全一致 |

额外自检（编译到临时目录、未写入仓库测试）：注册一个“`since:null` 即拒绝”的正式 schema，带绑定记录能成功写并持久化真实 cursor，同一记录无绑定时在提交外被 `invalid` 拒绝 —— 验证了“正式 schema 可拒绝 null、绑定后完整校验”的语义。

## 需回报主 Agent 的接口新增
- `commit-extensions.ts` 新增导出 `RejectedInsideTransaction`、`COMMIT_CURSOR_FIELDS`；四个冻结函数签名未变。
- `record-codec.ts` 新增导出 `uniqueConflictFailure`、`bindPreparedRecords`；`PlannedCommit` 增加 `claims`、`ledgerHorizon`、`commitCursorBindings`。
- **未改动** `ports.ts`、tests、contracts、配置、依赖、旧 `src/tests`、Kernel、文档；未新增文件。

## 已知限制
- `migrations.ts` 有意未改：现有 `identity_claims(claim_key PK, owner_key NOT NULL)` 足够，`CORE_TABLE_DDL`/兼容检查已覆盖。
- `indexGuards/indexChanges` 仍仅接受空 tuple，属本批明确范围外。
- `next-types` 无法变绿是因另一 lane 的冻结测试文件；该文件不在我的写权限内，我未触碰。
- 我尝试把说明写到 `/tmp/dsh-output`，但本沙箱 `/tmp` 按命令隔离、不跨命令持久，故说明只在本报告内。