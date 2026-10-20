发现 1 项。以下为只读静态审查；未运行测试、构建或联网。`OK` 表示在提供的差异、裁定和现有代码中未发现问题；缺失的 `w2-base` 无法独立做逐字比对。

| 编号 | 类别 | 位置 | 行 | 问题 | 唯一改法 |
|---|---|---|---|---|---|
| P1-01 | 会出错 | `tests/work-graph/S4C2-goal-triggers.test.ts:546` | W2b-09 | 真实归档时间仍取自待测结果，再放回期望值（`:554`）。具体漏测：本例归档尚未进入 Runtime 的 Run（`:471`、`:486`）；若取消归档分支错误返回 `1900-01-01T00:00:00.000Z`，两两不同和整体相等仍通过。恢复的旧例只构造 `afterOutcome: 'completed'`（`:630`），不能覆盖该错误。§6 的“缺少公开入口”理由不成立（`.lead-ref/t-w2b-findings.md:174`）。 | 在已有真实 backend 上创建 `createRunStateReader({ records })`，将已返回的 `continuationRunRef` 原样传给 `readContinuationBasis!`；断言 `ready`、`requeue.ref` 等于 `archiveRef`，用返回的 `requeue.requestedAt` 断言归档时间。移除因此不再成立的 BLOCKED 注释及手造记录兜底例，并更新该子项状态。 |

P1-01 的入口证据：`ExecutionReadPort` 明确公开 `readContinuationBasis`（`src/core/work-graph/model/execution-read-contracts.ts:107`），返回类型包含完整 `requeue`（同文件 `:66`）；实现读取 Run 自带的 `requeueRef`，最终返回该记录（`src/core/work-graph/tasks/run-state-service.ts:717`、`:898`）。本测试已有真实续跑领取和返回的 RunRef（`tests/work-graph/S4C2-goal-triggers.test.ts:511`），也已捕获同一 backend（`:367`）。现有归档夹具已经使用这条公开读取路径（`tests/helpers/S1-archive-service-fixture.ts:180`）；规则 A1 允许公开 owner，不限于顶层平台门面（`.lead-ref/books/test-rule-sheet-v1.md:21`）。

重点核对结果：

- **W2b-10，守卫 2：仍能辨别缺失守卫。** `unknownOutcome` 通过真实运行、移走 Kernel、真实 probe 和 `reconcileRunAtStartup` 建立状态（`tests/work-graph/A2-disposition-change.test.ts:363`）。测试同时确认未知结果、租约未释放，并精确断言原因（`:584`、`:602`）。去掉守卫 2 后，后续守卫的原因不同，因此不会蒙混通过（`src/core/work-graph/state/plan-machine.ts:661`、`:667`、`:681`）。
- **W2b-10，守卫 9：竞态是真实取消。** 提交包装器内公开读取 revision，再调用真实 `submitControl(cancel)`，随后委托原提交（`tests/work-graph/A2-disposition-change.test.ts:694`）。保留了冲突、确实发生竞态、Plan 不变及重读后精确拒绝的断言（`:708`、`:710`、`:713`、`:715`）；去掉守卫 9 的拒绝会破坏最后这个断言（`src/core/work-graph/state/plan-machine.ts:768`）。
- **W2b-08：两个转换例没有继续手写 Runtime/Host 观察事实。** 暂停通过真实控制提交、递送和运行收尾（`tests/helpers/S2B-runtime-steps-fixture.ts:460`）；重启通过新服务实例、真实 probe 和启动协调（`:487`）。`openRuntimeLine` 使用真实 Session 创建和归档服务（`tests/helpers/S2C-D-node-support.ts:609`、`:618`）。101 个锚点来自 101 次真实归档，只有第二页读取被注入失败（`tests/work-graph/S2C-node-detail-anomalies.test.ts:174`、`:190`）。超时及测量注释符合本行例外（`:204`）。
- **共享 helper：新增行为有明确调用者。** 新 Runtime 路径由 `S2C-node-detail-anomalies.test.ts:96`、`:165` 使用；`decisionMessages` 可选项属于 W2b-21，调用者是 `tests/helpers/S5-decision-fixture.ts:970`，未提供时不增加该配置（`tests/helpers/S2B-runtime-steps-fixture.ts:349`）。`S2C-L-runs-support` 已移除本轮前增加的选项，恢复单参数入口和原 preparation 路径（`tests/helpers/S2C-L-runs-support.ts:93`、`:121`）；W2b-01 明确要求的默认 requestId 恢复位于 `tests/helpers/task-claim-fixture.ts:369`。
- **W2b-57：六处现有调用均已核对。** 活动视图分别处理缺活动记录、开放 Run、轮次所属 Session（`src/core/work-graph/views/activity-read-model.ts:401`、`:431`、`:669`）；轨道视图分别处理结束 Run、开放 Run、轮次所属 Session（`src/core/work-graph/views/track-read-model.ts:509`、`:565`、`:601`）。正常 claim 将 Run 与 dispatch 放进同一个提交（`src/core/work-graph/tasks/claim-service.ts:1271`），未找到当前正常流程制造“两者均无”的 Run。缺 dispatch 明确抛出带 ref key 的 `unavailable`，符合裁定（`src/core/work-graph/views/activity-read-helpers.ts:187`）。

逐行结果：

- W2b-01: OK（`tests/helpers/task-claim-fixture.ts:369`）
- W2b-02: OK（`tests/work-graph/R4b-session-boundaries.test.ts:126`）
- W2b-03: OK（`tests/work-graph/R4b-session-boundaries.test.ts:227`）
- W2b-04: OK（`tests/work-graph/A2-control-service.test.ts:305`、`:347`）
- W2b-05: OK（`tests/work-graph/K3-16-proposal-round-fixture.test.ts:121`；`tests/work-graph/K3-16-second-unfinished-proposal.test.ts:107`）
- W2b-06: OK（`tests/work-graph/goal-independent.test.ts:63`）
- W2b-07: OK（`.lead-ref/parts/P1.diff:546`、`:563`）
- W2b-08: OK（`tests/work-graph/S2C-node-detail-anomalies.test.ts:91`、`:161`）
- W2b-09: P1-01
- W2b-10: OK（`tests/work-graph/A2-disposition-change.test.ts:584`、`:686`）
- W2b-11: OK（`tests/work-graph/S2C-lines-tiers.test.ts:155`；`tests/scenarios/A7-control.test.ts:451`；`tests/work-graph/S5R2-queue-history.test.ts:127`）
- W2b-12: OK（`tests/work-graph/S4C2-project-set-shared.test.ts:31`、`:164`）
- W2b-13: OK（`tests/work-graph/S4C2-D-rows.test.ts:114`）
- W2b-14: OK（`tests/work-graph/S4C2-D-rows.test.ts:37`、`:281`）
- W2b-15: OK（`tests/work-graph/R4b-session-directory.test.ts:275`、`:305`）
- W2b-16: OK（`tests/work-graph/S4C2-U3.test.ts:29`；`tests/work-graph/R4b-session-directory.test.ts:269`）
- W2b-17: OK（`tests/work-graph/W1-future-plan.test.ts:315`、`:490`、`:546`）
- W2b-18: OK（`tests/record-store/lookup.test.ts:104`、`:123`、`:203`）
- W2b-57: OK（`src/core/work-graph/views/activity-read-helpers.ts:187`；删除见 `.lead-ref/parts/P1.diff:1529`、`:1557`）

R-20 子项：

| 行 | 子项 | 分类成立？ | 公开步骤是否可达？ |
|---|---|---|---|
| W2b-09 | 归档 requeue 的 `requestedAt` | **不成立。** 完整 requeue 属于公开读取结果（`src/core/work-graph/model/execution-read-contracts.ts:66`、`:107`）。 | **可达。** 已有真实 archive → continuation claim（`tests/work-graph/S4C2-goal-triggers.test.ts:486`、`:511`），接 `readContinuationBasis` 即可（`src/core/work-graph/tasks/run-state-service.ts:898`）。 |
| W2b-17 | C 的完整 Reduction 前后不变 | **缺少公开读取入口成立。** `TaskRow` 不含完整 Reduction（`src/core/work-graph/model/plan-contracts.ts:89`）；Goal 完成投影只保留 Reduction 引用和 revision（`src/contracts/goal-phase.ts:28`）。 | C 的完成状态可通过 `completeTask` 到达，但完整当前记录的前后公开读取**不可达**。重复完成的幂等返回是原回执，不能代替当前快照读取（`src/core/work-graph/tasks/completion.ts:310`）。字节比较及 helper 已恢复（`tests/work-graph/W1-future-plan.test.ts:315`、`:490`、`:546`）。 |

```json
[
  {
    "id": "P1-01",
    "class": "会出错",
    "file": "tests/work-graph/S4C2-goal-triggers.test.ts",
    "line": 546,
    "row": "W2b-09",
    "problem": "归档时间期望取自待测结果，再用于整体相等断言（:554）。本例归档尚未进入 Runtime 的 Run（:471、:486）；若取消归档分支错误返回 1900-01-01T00:00:00.000Z，两两不同和整体相等仍通过。恢复的旧例只构造 afterOutcome: completed（:630），不能兜底。缺少公开入口的理由不成立：ExecutionReadPort.readContinuationBasis 公开返回完整 requeue（src/core/work-graph/model/execution-read-contracts.ts:66、:107；src/core/work-graph/tasks/run-state-service.ts:898）。",
    "fix": "在已有真实 backend 上创建 createRunStateReader({ records })，把已返回的 continuationRunRef 原样传给 readContinuationBasis；断言 ready 和 requeue.ref 等于 archiveRef，用返回的 requeue.requestedAt 断言归档时间。移除不再成立的 BLOCKED 注释和手造记录兜底例，更新该子项状态。"
  }
]
```

会出错 1，违规 0，不整洁 0，建议 0