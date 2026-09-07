# Agent B 模板：Ticket 实现 Agent（worker）

> B 由 A 按本模板填充派发；**B 可再下发一级子 Agent（模块 worker）**——派发时 A 写明允许的模块子任务清单，
> B 不得超范围派发、不得派发 ticket 级 agent。B 从实际读文件开始，不等待派发者；以本地文档与产品代码为依据。
> 每处 `<…>` 为派发消息里已填好的实际值（本文件是模板，不是派发消息）。

```yaml
ticket_id: <P1-NN>
ticket_path: <dev_docs/planning/proposed/P1-foundation/tickets/NN-....md>
role: worker (lane <X>)
workspace_root: <隔离 worktree 路径，如 …/agent_platform-p1-08-a>
shared_baseline: <产品根 commit 哈希 + 验证数字（typecheck/测试数/套件数）>
subagent_power: 最多一级（模块级子 worker；清单：<…>）
```

## 任务与边界（从 Ticket 读取，不复制需求）

- **Ticket**：`<ticket_path>`（status、blocked_by、input/output artifacts、Acceptance、verification）；
- **读取链**：`AGENTS.md`（完成边界 + 读法规则）→ **人类审阅层**（按 A 派发要求：P0-06 复核稿
  `dev_docs/design/human-framework-role-review.md` 对本票影响；产品意图/范围争议查 `dev_docs/product/用户需求原文.md`
  ——AGENTS 规则：只在复核产品意图或范围争议时读；对话历史 `dev_docs/product/README.md` 只作来源）→
  `DAG.md`（本票边与并行窗口）→ `PRODUCT.md` / `ARCHITECTURE.md`（边界/不变量）→ 相关 `interfaces/*`
  → 产品代码基线（**上游票冻结形状为最大参照，零修改**）；
- **共享基线**：A 已冻结的契约/接口/共享 fixture/套件/骨架（**冻结签名不得改动**；
  本票新增契约以本文件/套件为准）。

## 精确 write_scope（只允许此处列出的文件）

- `<文件1>`（…区域：如 LANE-X 区域，替换 stub 实现）
- `<文件2>`（…）
- 新建：`<测试文件1>`、`<测试文件2>`

**禁止**：修改 P1-00…`<上一票>` 冻结形状；修改冻结签名/契约；修改 `isHandledEventType`/KNOWN（除非本票
新增事件——以 A 派发说明为准）；修改共享 fixture/harness/套件定义文件；修改其他 lane 的区域/stub
（保持原样，包括抛错 stub）；修改 Ticket 状态；新增依赖（package/lock 归 A）；在派发消息外自行决定范围。

## 实现要求（面向本票验收）

- 事件/统计口径：只从既有/本票新增的提交事件聚合；**不新增隐式事实、不推断完成**；
  全作用域键（`canonicalJson(完整 ref)`）隔离本地 id；freshness 沿用 opaque cursor
  （`not_ready ≠ not_found`；未覆盖 → `not_ready`；覆盖且无行 → `not_found`；无 cursor 无行 → `not_ready`）；
- 与既有 handler 的幂等/重建语义一致（同一事件重放结果 JSON 相同；SQLite 行 upsert 重建等价）；
- 只读面：查询路径只依赖 ReadModel 接口；不触碰 control/runtime 写入面、不启动模型、不刷新 lease、
  不写 canonical state（本票若是只读展示类）；
- 有界：遵守契约上限常量；display 内容按来源标注（formal/report 分列、源 revision/cursor）。

## 验证（允许命令）

`pnpm typecheck`、`pnpm vitest run <自身测试路径>`；（可选）`pnpm vitest run` 受影响目录做回归；
**不要跑全量套件**当其他 lane 尚未落地（`isP1NNReady()` 为 false 时相关套件 auto-skip 属预期）。
不修改其他测试文件；测试必须真实通过，不得用假实现/跳过/修改探针冒充。

## 预期交接（报告给 A）

- 完成项（逐文件/逐能力）；测试命令与**实测结果**（通过数、类型错误数）；
- 未解决项/风险（含与契约、套件期望、其他 lane 的潜在不一致）；
- 缺口建议（需要 A 在共享面裁决/修复的点——**不要自己改**；给出最小修改建议与受影响消费者）；
- 产物 refs（commit、worktree 分支）；工作区已 commit 且干净。
