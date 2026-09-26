R3a 返修已完成实现与自检，报告已写入 `/tmp/dsh-output/implementation.md`。

## 实现（仅授权的 3 个文件）

**A1 事务内记录守卫** — 两个 backend 的 `currentRevisionOf` 接入冻结的 `decodeGuardedRevision`：
- Memory：真正不存在才传 `null`；存在时把 Map 中该 key 的 snapshot 编成 JSON 交给 helper（`in-memory-record-store.ts:187`）。
- SQLite：`BEGIN IMMEDIATE` 后原有查询，`snapshot_json` 原文交 helper；无 row 传 `null`，非文本 row 仍 corrupt（`sqlite-record-store.ts:313`）。
- 幂等命中仍先于 guards；`null`/revision 0 语义、`revision_conflict.current` 为事务内值、`readMany` 的 `unsupported` 读语义均未动；未复制领域算法。

**A2 输入隔离** — 删除 `cloneInput` 的「克隆失败返回原引用」，改为 `ownInput`：失败时在首个 lookup/read/写之前以 `invalid` 明确拒绝（`task-service.ts:91–101`）；`admitGoalCreation`、`createGoalFromHost`、`expectedIdentityOf` 三处统一走它，正常 JSON 命令指纹/幂等规范不变。

**A3 旧库** — 无生产修改；冻结契约测试里真实 RAT-03 旧库重放仍通过，原库 SHA-256 复核不变。

## 检查结果（Node24、单 worker、无共享 cache）

| 检查 | 结果 |
| --- | --- |
| `r3a` | **23/23 通过**（基线 16/23；4 个坏 ref/schema + 输入隔离 + 两个独立 stored-identity guard 全绿） |
| `platform-types` | **exit 0** |
| `platform-architecture` | **exit 0**，`issues: []` |
| `r3a-regression` | **105/108**，3 项失败（详见下） |

冻结测试哈希复核一致（`27c3ad1c…`、`23c7ea83…`）；lane 快照逐文件哈希显示**只有 3 个授权文件变化**。

## 仍需主 Agent 决策的 3 项（未自行扩大范围）

1. `tests/core/record-store/{sqlite,in-memory}-record-store.test.ts`：用 `mechanics.upsertSnapshot` 种了 **Goal@0** 行再断言 expectedRevision 0 可提交；A1 按注册 schema 核验后该行正确返回 `corrupt`、零写入，与 R3a §8.8 一致。这两个是本批新增的未跟踪测试文件，写范围不含测试，需测试侧改用 schema 合法的 revision-0 记录（或改预期为 corrupt）。这是 `r3a-regression` 仍红的实质原因。
2. `tests/integration/historical-host-compatibility.test.ts`：写 `evidence/...` 报 `EROFS`，本 lane 的 evidence 是只读挂载，属环境限制，与改动无关。
3. `src/core/work-graph/persistence/legacy-adapter.ts:106–112` 的 `ownBatch` 仍有同类「克隆失败返回原引用」fallback（在 `await lookupCommit` 之后才编译），不在 3 文件写范围内，未改，已报告准确路径。

未 build、未跑付费模型、未改/跳过任何测试；以上均为自检，独立验收由主 Agent 负责。