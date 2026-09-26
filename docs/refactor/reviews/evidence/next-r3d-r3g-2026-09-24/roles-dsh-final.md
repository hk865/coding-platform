完成本轮返修。以下是**实际结果与局限**（不自行验收）。

## 针对主审意见的修改
只改了 scope 内两个生产文件：`role-memory-service.ts`、`role-record-codecs.ts`。测试/contracts/接口/其他模块/Kernel/配置未动。

1. **declaredPermissions 必填且先校验**
   - `resolveRoleBinding` 在任何 Store 读取之前，先校验完整请求：`RoleBindingRefV1` 全字段（`schemaVersion=1`、`bindingId`/`templateId`/`policyRevision` 非空串、`templateRevision` 为字符串、`bindingVersion` 为正整数），以及 `declaredPermissions` 必须是 `{tools: string[], writeScope: string[]}` 且每个元素为非空字符串。
   - 缺失 `declaredPermissions`、`tools:'read'`、`writeScope:'workspace'`、`writeScope:[17]` 等坏形状一律 `rejected invalid`，**不再默认空集合**；无 matrix 的项目同样先校验（corrupt 用例新增的 4 个 malformed 请求在 absent 判定之前就拒绝）。
   - `policyRevision` 仅做形状校验，不参与授权判定。
2. **readRoleSpec 同步快照 input+options**：`cloneJson(input)` 与 `cloneJson(options)` 在同一同步段完成，`atLeastCursor` 之后使用快照值；测试调用后把 `readOptions.atLeastCursor` 改成 +1000 的未来游标，仍返回 `ready`（用的是原游标）。
3. **replay 身份校验**：`replayInstall`/`replayActivate` 在 scope/ref/idempotency 之外新增 `event.actor` 与 `command.identity.actor` 的深比较（含 agent runRef）；不比较重试可变的 `commandId`/`correlationId`。事件 actor 被第三方改写时返回 `rejected`，且不写账本（水位不变）。为此 codec 的 fact 增加并回填 `actor`。
4. **顺序调整**
   - `activateRoleSpec`：在验证 ctx/命令形状/scope 并算出 fingerprint 后，先 `lookupCommit` 恢复原回执，再去读当前 spec/active；replay 不再依赖当前状态。
   - `installRoleSpec`：`deps.now()`/`deps.eventId()`、snapshot/event 只在 `lookupCommit` 确认非 replay 后生成；仍无 Project 门槛。
   - 保持 Project@expectedRevision + spec + active CAS 在**同一个 PreparedCommit**，未新增层。

## 固定检查结果（tests 只读，未放宽断言）
- `next-roles`：**17 passed / 17**（memory+sqlite），连续多次运行稳定。验证的是最终刷新版测试 `tests/work-graph/R3g-role-spec.test.ts`（540 行，md5 `f669fdc24caf74c2c198fba92fdeaaa1`，运行前后哈希一致）。
- `next-types`：exit 0。
- `next-architecture`：`next source boundaries: OK`，observed edges 5/8 未变。

说明：首轮读取的测试为 482 行，本轮实现期间测试被刷新到 498 行、再到 540 行（新增 replay-actor 用例）。上面的 count/hash 是结束前按 540 行版本重跑的结果；若主审再次刷新，需要按新哈希重跑。

## 局限
1. 水位重试耗尽时仍返回 `rejected/unavailable` 而非 `not_ready`：冻结测试 else 分支只接受 `rejected`，且 race 用例第 2 次即稳定，未触发。
2. `install`/`activate` 的 Host/项目/actor 不一致只能映射到 receipt 联合中仅有的 `invalid`（receipt 无 `forbidden` 码）；读路径保留 `forbidden`。
3. `readRoleSpec` digest 不符映射 `invalid`、不可解码映射 `unavailable`（`CoreError` 无 digest 专用码）。
4. 未接线 composition/消费者，未迁治理安装、memory、运行驱动；未跑全量 321+ 隔离套件与组合根。