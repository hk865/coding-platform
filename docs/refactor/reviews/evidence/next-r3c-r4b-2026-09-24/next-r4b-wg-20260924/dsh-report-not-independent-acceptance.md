返修完成。先按指定顺序核对了真源（`docs/PRODUCT.md` 的 Session/工作关联语义、`ARCHITECTURE.md`/`module-dag.md` 五模块八边、`modules/core/{work-graph,record-store,agent-runtime}` 相关章节、`DSH-WORKFLOW.md §3`），再读实际接口/骨架/测试与任务约束。只写本批 2 个生产文件；`sessions/contracts.ts`（15:31:16）与 `plan-record-codecs.ts`（15:31:16）由 root 刷新，我未改；未把只读依赖当作可写能力。

## 第三轮三点落实

**1. role_spec lookup 路径**
- `session-by-workspace-spec-role` 末段 `role.pin.ref.digest` → **`role.pin.digest`**（digest 在 pin 上）。`directoryCandidatePlan` 的取值本就是 `role.pin.digest`，现在路径/取值对齐；boundaries 的「按 pin digest 找 role_spec」真筛选反例通过。

**2. 合并原 codec scope 约束（正式 records 与事件内嵌同验证）**
- `checkSessionOperationBody` 增加冻结等式：`ref.projectId == action.workspace.projectId == action.plannedSessionRef.projectId`。
- `checkWorkLinkRef` 增加：`target.ref.projectId == link ref.projectId`。
- 这些检查位于 codec body 层，`CoreOperation@1` 记录、`SessionCreationAdmitted` 内嵌 operation、`SessionWorkLink@1` 记录都走同一实现，不依赖某条写路径先校验；boundaries 的 3 条跨项目反例（operation ref、plannedSessionRef、link target）全部 `invalid`。

**3. `kernelStore` pin 接口**
- `SessionCreationInput.kernelStore:{adapterId,storeKey}`（root 已加）。`admit` 首次受理校验非空，持久写入 `operation.action.kernelStore`。
- **路由不参与业务指纹**：指纹只含 actor/project/workspace/role/recommendedRefs/initialLinks；换 default route 的重放命中原 identity/指纹，返回 `replayed:true` 与原 pin（directory test 1 已验）。
- 正式 codec `checkKernelStore` 校验 pin 形状（非仅类型断言），并纳入 `ACTION_KEYS`。
- `recordSessionCreated` 校验 `registration.adapterId === storedOperation.action.kernelStore.adapterId`，不等返回 `invalid`（directory test 2 的 `wrong-adapter` 已验）。

## 实测（真源/双后端）

| 检查 | 结果 |
|---|---|
| `check.py next-types` | exit 0 |
| `check.py next-architecture` | 五模块 5/8 允许边，OK，exit 0 |
| `check.py next-session-directory` | **24 passed / 24**（`R4b-session-directory` 14、`R4b-session-boundaries` 10），memory + sqlite 真实后端 |
| `check.py next-tests`（全量参考） | 298 passed / 20 failed / 46 files |

本 lane 覆盖并通过的关键用例：admit 固定 pin 与换路由重放原 pin、并发唯一 claim、目录 cursor 过滤/作用域绑定、Task link 真实 acceptedPlan 成员校验且 `since===commit cursor`、不存在 Task 拒绝、module/work `unsupported` 不写假关联、role_spec 按 `pin.digest` 精确索引、跨项目 operation/link schema 拒绝、1001 候选有界扫描不丢、601 links 不静默截断、workspace/actor 隔离。

## 未决（不在本 lane scope，未宣称主验收通过）

全量 20 红全部属其他 lane：
- Runtime lane `session-operations.ts` 仍 skeleton → `R4b-session-operations`(10)、`R4b-session-recovery`(5)、`R4b-session-input-boundaries`(2)、`R4b-session-skeleton`(1) 红。
- R3c 计划受理 `R3c-plan-adoption`(2) 红（Plan codec 已由 root 落地，但该批受理链路未完成）。

我未改任何测试/Store/composition/共享 contracts，未新增文件；两个 lanes 之外无回归（record-store 套件全绿，`R3c-plan-entry/task-graph` 已随 Plan provider 转绿）。