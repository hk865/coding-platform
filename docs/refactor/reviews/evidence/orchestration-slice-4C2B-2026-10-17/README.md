# 4C-2 B 段的执行证据（2026-10-17）：注记卡和它的落实、证明事件和“请知悉”

**是什么。** [第 4 片规格](../../../design/orchestration-2026-10/slices/slice-4-SPEC.md)的 4C 第二轮（§11.9）分成两段，这是 B 段；A 段（装配、“该更新”和书记提醒）已合入。施工、审查、返工和实测中定下的读法见规格 §14。
- **注记卡和它的落实（L17、§11.6）：**
  - 有卡的是目标里 `pending_review`、`userReasonsOf` 非空的头；`goalId` 为 null 的永不出卡（D-09）。
  - 关卡的顺序：目标已取消 → `goal_cancelled`；已答复 → 照第 5 片的答复和落实状态；`userReasonsOf` 为空，或 `pendingUnderstandingOverridden(head, current)` → `source_resolved`；其余 `waiting_answer`。
  - 卡的身份是注记头的 pin，理解再加现行指针的 pin；对象是注记和每个实际目标的聚合 pin，标签用 `renderNoteHeader`。
  - 选项：有 `contradiction` 或 `user_note_replaced` → 取代、并存、拒绝；只有 `structural` → 收下、拒绝。所有选项 `effect: 'apply'`。
  - 落实和书记共用一个处置核心：卡模式用答复的用户当权限、卡的 pins 当守卫、目标取实际集合（`replaces` 减 `coexistWith`，加 `contradicts`），最后一个事件带证明。
- **证明事件（U3）：** `decodeProofEvent` 变成按事件类型查表，行是 `GoalSettingsChanged`、`PlanRevisionAccepted`、`NoteDispositionChanged`；`ArchitectureCatalogAdopted`、`ProjectCompletionPolicyActivated` 仍是回答 `unsupported` 的行；不认识的类型仍是 `incomplete`。`NoteDispositionChanged` 多 `proof` 和 `actor`，不是卡落实的处置两者都是 null。
- **落实派发（U6）：** `resolveDecision` 的第 ② 步按 `input.source.kind` 查注入的适配器；今天的冲突代码原样进 `goal_conflict` 适配器，它是默认登记；`note_review` 适配器调 `applyNoteDecision`；没有适配器的 kind 回 `answered`。
- **卡源适配器（U7）：** `createCollectionCardSource(spec, readGoal?)` 负责一次装配、按 attempt 缓存、分页、按键读和关闭判断；注记是其中一份登记。K3 第 4 组加第二份登记时不用改协调者和队列。
- **“请知悉”和分组（U9）：**
  - 写版本时定 `noticeClass`：`user_affected` > `structural` > `scribe_result`；旧版本没有这个字段就是 null，永远不是通知。
  - 读法是 `NoteVersion` 上一次按 `since` 排的顺序查找，路径 `['ref.projectId', 'noticeClass']`，每个类从保存的已看位置读。
  - 一个纯分组函数：`user_affected`、`structural` 各一行，`scribe_result` 按目标折成一行；折叠行带成员的身份和位置。
  - `seenThrough` 只越过这次读取已经翻过的页加这一页真正显示过的成员；折叠行算它的全部成员。
- 验收行 D-01、D-02、D-04（卡的部分：不出卡）、D-05（卡的部分）、D-06、D-08（一张卡）、D-09（无目标不出卡）、D-11（卡关闭 `goal_cancelled`）、D-12（卡关闭）、D-13、D-16（不出卡）、D-17；测试入口 S4C2-N1/N2/N3、U7、U3、NE6（服务行在 memory 和 SQLite 上各跑一遍）；另修 2C-26（测试把 `Date` 固定到 `HOST_NOW`）。

**结果。** 已合入（2026-10-17，f4171d51）。没有调用真实模型。

## 经过

用量只计 DSH 主会话，子 agent 的没有单独统计。行数是生产代码的增减（`src/`）。

| 轮 | 说明书 | 报告 | 用时、DSH 主会话用量 | 要点 |
| --- | --- | --- | --- | --- |
| 通读 | `books/s4c2b-preread.md` | `dsh/preread-final.md` | 291 秒，770 万 token | 8 个问题、8 处和代码不一致、5 个测试风险；lead 的答复写进 `books/s4c2b-impl.md` 第 7 节（14 条） |
| 施工 | `books/s4c2b-impl.md` | `dsh/final-1.md` | 4,698 秒，3,192 万 token，上下文最高 302,657 | 协调者模式，最多同时 3 个子 agent；+1,462/−119；U3/U6/U7、卡、通知；15 个新测试文件，改 5 个 |
| 实现审查 | — | `codex/review.out.md` | Codex | 9 条：8 条必须改 + 1 条测试期望（F06），每条带修改思路 |
| 核实 | 1 个 Claude 子 agent（只读） | `books/verify-s4c2b.md` | — | 9 条都成立，第 5 条的建议只部分成立；另找出 Codex 漏的 3 处（M1 卡的目标、M2 目标事件的 actor、M3 `seenThrough` 算前面几页）；lead 的裁定写进 `books/s4c2b-rework.md` 第 2 节 |
| 返工 1 | `books/s4c2b-rework.md` | `dsh/rework-1-final.md` | 2,481 秒，801 万 token | 12 项，+502/−389 |
| 复审 | — | `codex/review2.out.md` | Codex | 11 项里 9 项是（第 11 项是，只是时钟探针没复跑）、2 项部分（第 6 项缓存、第 8 项测试）；3 条必须改 |
| 返工 2 | `books/s4c2b-rework-2.md` | `dsh/rework-2-final.md` | 1,464 秒，624 万 token | +93/−21 |
| 快速核对 | — | `codex/review3.out.md` | Codex | 3 项都部分：目录跨目标、注记自己的空证明行、字面键和标签 |
| 返工 3 | `books/s4c2b-rework-3.md` | `dsh/rework-3-final.md` | 733 秒，789 万 token | +56/−14 |
| 快速核对 | — | `codex/review4.out.md` | Codex | 3 项都改了，没有新的生产问题，“可以合入” |
| 合并全量（返工 3 之后） | — | `checks/merge-full-suite-summary-rework3.txt` | — | 535 个测试文件全过，8,211 项过、5 项跳过；2C-26 已修 |
| 实测 | `checks/measure-4c2.mjs` | `checks/measure-4c2-investigation.md` | 1 个 Claude 子 agent（只读） | 2 万条注记的数据：心跳 2,254 次、Goal 卡记忆材料 43 次、“找”第一页 209/222 次；三处读得远超 §11.7 的预算 |
| 测量核对 | — | `codex/measure-recheck.out.md` | Codex | 第 1–3 项成立、必须改；第 4 项（“找”第一页超 100 毫秒）按 §11.7 写明原因，不扩改 4B |
| 测量核实 | — | `books/verify-measure-fixes.md` | 4 个 Claude 子 agent（只读） | 每个修法一份核实，Fix 和 Tests 部分作为返工清单；Item 4 写进验收 |
| 返工 4 | `books/s4c2b-rework-4.md` | `dsh/rework-4-final.md` | 1,022 秒，434 万 token，上下文最高 151,293 | 3 处修法 + 读次数测试；+137/−118 |
| 快速核对 | — | `codex/review5.out.md` | Codex | 3 项都落实，4 条 UNSPECIFIED 可接受，“可以合入” |
| 合并全量（返工 4 之后，合入的树） | — | `checks/merge-full-suite-summary.txt` | — | 538 个测试文件全过，8,235 项过、5 项跳过；约 37 分钟，内存峰值 4.72 GB |
| 文档 | `books/s4c2b-docs.md` | `dsh/docs-final.md` | 约 11 分钟，1,820 万 token | 起草规格 §14、本目录两份、STATUS、能力索引和两处状态行；Codex 事实核对（`codex/docs-facts.out.md`）9 处，lead 逐行审后改 |

合计：生产代码 24 个文件，+1,946/−357（净增约 1,589 行）；测试 30 个文件，+4,132/−31。逐轮增删相加是 +2,250/−661；后面的返工删掉前面加的行，所以以对 lead 分支的最终 diff 为准。

## lead 的验收判断和已知限制

见 `lead-acceptance.md`。
