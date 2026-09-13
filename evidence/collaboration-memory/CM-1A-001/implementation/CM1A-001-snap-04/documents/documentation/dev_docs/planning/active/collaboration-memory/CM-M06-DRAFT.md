# CM-M06-DRAFT：any-wait 与首票未覆盖的通信边界（**草稿，未放票**）

状态：**draft / 未派发**。本文件由统筹者在第 1 工作段末按 PLAN §7 阶段 3 的 M06 与 §10.1 起草，
用于在 Gate A 成立后**立即**放票，不必等到那时才从头调查。**它不是 Ticket，未经独立验收不得计为完成。**

```yaml
ticket_id: CM-M06-DRAFT
status: draft
blocked_by: [CM-1A-001]
role: integration-implementer
workspace_root: D:/1.project/Software/agent_platform
documentation_root: D:/1.project/Software/agent_learn/agent_dev/agent_platform
```

## 1. 为什么必须是独立票，而不是塞进 CM-1A-001

CM-1A-001 §4 明文把范围收在 **all-wait + timeout/cancel**：「本票只做 all-wait 与 timeout/cancel；
any-wait 的首个实际消费者与剩余通信由 PLAN M06 后续实现，不以本票 PASS 代替 V04 全部覆盖。」
PLAN §10.1 的 V04 行同样写明：「1A A05/A07/A09 只覆 all/timeout/cancel；M06 负责 any 及剩余组合」。
因此 any-wait 不是 1A 的遗留缺陷，而是**已授权的后续范围**。

## 2. 范围与可观察交付

1. **any-wait**：真实协调消费者等待「两个可替代只读报告中的首个合格结果」。
   - 语义要求：任一条件满足即 `satisfied`，且**至多一次**后继 admission；
   - **不得**把「可选报告」扩成绕过必需验证：any 的成员只能是**同等级可替代**的可选材料，
     不能把 `required` 义务包进 any 里降低标准；
   - 迟到报告仍可查询，**不默认取消**其他 Work（PLAN §7 阶段 3 M06 原文）。
2. **首票未覆盖的有限重放**：Subscription 的 `startCursor` 覆盖历史位置时的有限重放，边界有上界、不越权
   （`SUBSCRIPTION_MAX_REPLAY_SPAN = 512` 已在契约里；本票要证明它真的被强制执行）。
3. **订阅 start / cancel / 顺序的剩余场景**：取消后不产生新 Delivery；已存在 Delivery 的可读性由
   **取消／撤权策略显式决定**，不由缓存决定（PLAN §5.2）。
4. **可观察性**：通信时间线、等待原因、积压与失败**来自持久状态与 freshness**，不是内存计数。

## 3. 前置依赖（放票时必须逐条核对真实证据）

| 依赖 | 需要 CM-1A-001 的什么证据 | 当前状态 |
| --- | --- | --- |
| any 的求值面 | `WaitConditionV1.mode` 目前只有 `"all"`；M06 需要契约扩展 `"any"` 与唯一键语义 | 未实现 |
| 至多一次 admission | A05 的 `(workRef, waitRef, satisfiedRevision)` 唯一键已在 `communication-successor-claim` 落地 | 契约已落地，**运行时未验证** |
| 取消后的 Delivery 可读性 | 需要 1A 的 cancel 路径（A07）成立 | 未实现 |
| 有限重放上界 | `SUBSCRIPTION_MAX_REPLAY_SPAN` 已有常量，需要 1A 的 route page 路径成立才能真正拒绝越界 | 未实现 |
| 时间线/等待原因来自持久状态 | 两个读模型目前对协作事件**只登记不投影**（`isHandledEventType` 白名单），因此 M06 必须**新增投影** | 未实现 |

**结论：本票在 Gate A 成立前不得开工。** 前置不成立时开工只会再产生一次「契约已写、消费者为零」的孤岛。

## 4. 写入责任（预计）

| 责任 | 位置 |
| --- | --- |
| 契约扩展（any 模式、重放上界错误码） | `src/contracts/coordination.ts` |
| 求值与接续资格 | `src/control/control-engine/policies/coordination-rules.ts` |
| 受理与 admission | `src/control/control-engine/coordination.ts` |
| 路由页与重放边界 | `src/control/dispatch-engine/`（挂在唯一 `drive(trigger)` 内，D05） |
| 时间线/等待原因投影 | `src/data/read-model-index/read-model-index.ts` 与 `sqlite-read-model-index.ts` |
| 测试 | `tests/coordination/`（用真实 `InMemoryLedger`/`SqliteStateLedger` + 真实 `ControlEngineImpl`） |

## 5. 验收映射（预计认领的子集）

| 编号 | 本票必须证明 |
| --- | --- |
| V01（通信部分） | 一份正文被两个授权订阅 Work 引用；第三个无权 Work 不可读；相同 digest 不串权限 |
| V02（补全） | 有限重放有边界且不越权；订阅 start/cancel/顺序工作；重复/乱序不产生重复有效 Delivery |
| V04（any 部分） | any 与 all、迟到事件、timeout/cancel、前驱结束并发都**至多一次**后继；迟到报告仍可查、无默认取消其他 Work |
| V12（通信部分） | 通信时间线、等待原因、积压与失败来自持久状态/freshness |

## 6. 已知风险（放票时保留）

- any-wait 的「首个合格结果」需要**合格判定**的定义；若定义不清，会把 any 变成「随便来一个就算」。
  放票前必须确定：合格 = 该报告本身通过了什么检查（例如 source pin 当前、digest 匹配、Work 属主正确）。
- 两个读模型对协作事件目前是「登记但不动」，M06 新增投影时必须**同时**改两个适配器
  （内存版与 SQLite 版），并注意 `ProjectionStallError` 会把整页停掉。
- 重放上界一旦在契约里收紧，既有测试里若有依赖无界重放的用例需要同步。

**状态：草稿。未生成正式 Ticket，未实施，未验证。**
