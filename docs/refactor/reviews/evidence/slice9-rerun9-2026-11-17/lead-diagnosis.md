# G6 第九次：lead 诊断（2026-11-17）

- **树：** `05bc04a5`，即落地 `38b7ffea` 加上驱动修正。
- **时间：** 17:18 开跑，20:52 由 lead 停掉。驱动收到 TERM，Host 跟着退出。
- **授权：** 同 121-124。这次总上限 2.5 亿。

## 只有 `checks/` 的原因

驱动是被 TERM 停的，没来得及写总报告（README、result.json）。留下的是三份逐条记录：
- `commands.txt`：命令；
- `http.jsonl`：HTTP 调用，重复的读合并成一行，带 `repeat` 和 `lastAt`；
- `model-calls.jsonl`：模型调用。

三份都过了密钥扫描，没有密钥值。

## 走到哪里

| 场景 | 结果（按事件库） | 用量（百万 token） |
|---|---|---|
| A1、B1 | 各自建目标、关闭 | 0.16、0.09 |
| E05 | 三个目标完成，检查轮全过 | 6.84 |
| E06 | 跑过 | 8.34 |
| E08 | t2 检查没过，场景按设计结束 | 2.14 |
| E09 | 目标完成 | 6.40 |
| E12 | 两个目标完成 | 1.01 |
| iteration | 目标完成 | 1.94 |
| intervention | 第一个目标完成；长目标在干预后卡住 | 14.56 |
| waiting、attached、B06、compaction | 没轮到 | — |

- 合计约 4,150 万 token。
- 这个窗口（11-14 22:00 至 11-17 22:00）累计约 1.85 亿。

## 卡住的地方

1. **现象。** UTC 11:44:38，驱动照界面的形状给一条做完的线发了“直接干预”：只带收件线，没有 `goalRef`、`taskRef`。从 11:45:41 起，`core/decisions/queue` 每次都回 `rejected/source_stale`，理由是 “the intervention source message does not prove this Query and Goal”。这样持续了 66 分钟、392 次，这个目标再没有模型调用。
2. **根因一。**
   - Host 按这条线最近的工作选了 Goal，开 intervention_planning（`src/business/workflow/intervention.ts:118-127`）。
   - 来源证明却要求 `message.goalRef` 非空，且等于这个 Goal（`src/core/work-graph/tasks/initial-plan-answer.ts:104`）。
3. **根因二。**
   - 规划问题来源把这个 `source_stale` 当读失败原样返回（`planning-question-reader.ts:266`）。
   - 决定队列于是整体拒绝（`decision-read-model.ts:1420`）。
   - 同一个读法还挡住了这个 Goal 的图上下文和目标循环，所以工作也停了。
4. **为什么停掉。** 这一步驱动的等待上限是 150 分钟（`int.mjs:170`），会拖过 22:00，窗口里也跑不了别的场景。

诊断全文在 lead 笔记 `impl/g6r9/int-diag.md`：Opus 只读诊断，lead 在代码上核过两处根因。修正包 IPF 的裁定在 `impl/g6r9/ipf-rulings.md`，见决定 121-144。
