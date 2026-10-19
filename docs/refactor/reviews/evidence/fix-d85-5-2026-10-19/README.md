# 决定 85-5 的两处小修（2026-10-19）

**是什么。** 决定 85-5 记下的两个缺陷，作为一条小修一起做：

- **`atLeastCursor`：** `src/core/work-graph/tasks/goal-decision-reader.ts` 的 `readGoalDecisionCauses` 收了这个参数却从不用，所以永远不会回“还没读到”（`not_ready`）。第 5 片规格 §4.2 要求所有来源都收到同一个 `atLeastCursor`。
- **游标位数：** `src/contracts/ledger.ts` 的 `makeCommitCursor` 在序号到 100 亿时会生成 11 位游标，而同文件的 `seqOfCommitCursor` 只认 10 位。正常使用碰不到。

**测试入口（用户 10-19 定）：** 直接测读取器的接口和游标函数。决定队列本来就在最后用整个工作区的水位统一检查 `atLeastCursor`（`views/decision-read-model.ts:1091`），而目前只有决定队列会传这个参数，所以从队列测，修之前也能通过，测不出这个缺陷。

**lead 定的规则**（任务书 `books/fix85-book.md`）：

- **不传 `atLeastCursor` 时：** 读取次数、顺序和结果都不变。
- **传了时：** 用读 Goal 那一次带回的账本位置（`readThrough`）和它比较，比较用现有的 `atLeastCursorResult`，不多读存储。
- **检查的位置：** 放在项目、Goal、工作区三道检查之后，所以原有的拒绝仍然先回。只用读 Goal 这一次就够，是因为这个方法后面的读取都发生在它之后。
- **`makeCommitCursor`：** 序号超过 9,999,999,999 时报错，错误文字和序号小于 1 时一样（`invalid cursor sequence: <n>`），其余不变。

**结果。** 已合入（`c54d00e0`）。

- **规模：** 4 个文件，+103/−9。生产代码两个文件：`ledger.ts` +5/−4，`goal-decision-reader.ts` +14/−5。新增两个测试文件。
- **全量：** 773 个测试文件全过，10,089 项过、5 项跳过（`checks/full-suite.txt`）。
- 没有调用真实模型。

## 经过

| 步 | 谁 | 文件 | 结果 |
| --- | --- | --- | --- |
| 施工 | DSH（12:10–12:13，先写失败测试再改） | 任务书 `books/fix85-book.md` → 回复 `dsh/fix85-final.md`；改动 `checks/fix85-r1.diff` | 201 秒、2,380,653 token，上下文峰值 66,532（`checks/dsh-run.json`）。D85-5a 第一条修之前回 `ready`，D85-5b 第一条修之前不报错，都先失败；局部 148 项、类型检查、模块边界检查通过 |
| lead 的修 1 | lead | `checks/fix85-leadfix.diff` | `ledger.ts` 注释里的一处语法错 |
| 审查 | Codex（只读） | `codex/fix85-review.prompt.md` → `.out.md` | 1 会出错、0 不整洁：新测试的期望位置 LAST 取自 `storeSnapshot()`，实际是读了一次账本水位，任务书要求取自提交回执或手算序号。其余逐项核对通过，包括“读 Goal 是第一次读取”的推理，以及两个首例在原代码上会失败、原因也对 |
| 全量 | lead（WSL、bubblewrap、5 个并行） | `checks/full-suite.txt` | 跑在修 1 之后：773 个文件全过，2,520 秒，峰值 5.28 GB；构建、类型检查、模块边界检查都过 |
| lead 的修 2 | lead | `checks/fix85-leadfix2.diff` | 照 C1 的先例，小的“会出错”由 lead 直接改，不开 DSH 返工。改成调一次 `fixture.seedCommit([])`，用它回执里的 `cursor` 当 LAST；夹具没改。改后单独跑这个文件 4 项全过，类型检查过 |
| 快速核对 | Codex（只读） | `codex/fix85-recheck.prompt.md` → `.out.md` | 0 会出错 |
| 合入 | lead | `checks/fix85-final.diff`（sha256 见 `checks/merge-patch.sha256`） | 补丁应用到工作区；四个文件和副本 `fix85-lead2` 逐字节相同 |

DSH 返工 0 次（决定 81）。Codex 共 2 次：审查 1 次，快速核对 1 次。

**副本的一处疏漏。** lead 建副本时只复制了根目录的 `node_modules`，漏了 `vendor/coding-agent/node_modules`（zod、openai）。DSH 从它自己的运行环境复制了这两个包来跑局部测试，版本未必和仓库一致。全量之前，lead 换回了 C1 副本里那份正确的。以后建副本时，两处依赖都要复制。
