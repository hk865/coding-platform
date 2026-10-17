你在一个只读副本里（当前目录）。不要改文件、不要跑测试或构建、不要联网。用中文回答，800 字以内。

这是第 4 片 4C-2 B 段合入时的文档草稿（DSH 起草，lead 还要逐行审）。代码是合入树（`src/`、`tests/`）。B 段的全部材料在 `./.dsh-ref/`：说明书 `books/`、DSH 回复 `dsh/`、Codex 审查 `codex/`、实测 `checks/`；起草任务书是 `.dsh-ref/s4c2b-docs.md`。

草稿改了这些文件：
- `docs/refactor/design/orchestration-2026-10/slices/slice-4-SPEC.md`：开头的“后注（4C-2 B 段验收…）”、§11.7 改的两行（“找”一页、Goal 卡的项目部分）、新加的 §14；
- `docs/refactor/reviews/evidence/orchestration-slice-4C2B-2026-10-17/README.md`、`lead-acceptance.md`（新）；
- `docs/refactor/STATUS.md`（4C-2 B 段那条、最后一次检查、已知限制、下一步）；
- `docs/refactor/IMPLEMENTED-CAPABILITIES.md`（开头一段和 WG57）；
- `docs/refactor/design/orchestration-2026-10/slices/README.md`、`AGENTS.md` 的状态行。

请只核对**事实**，不评文风：
1. §14 每一条和它引的出处（“答复第 n 条”= `books/s4c2b-impl.md` 第 7 节；“实现审查第 n 条”= `codex/review.out.md`；“返工 n 第 m 项”= 对应的 `books/s4c2b-rework*.md`；“测量核实 Item n”= `books/verify-measure-fixes.md`）是否相符；规则写得是否和合入树的代码一致（函数名、字段名、选项、错误码、顺序）。
2. 数字：各轮审查的必须改条数、读取次数（627 = 610 + 15 + 2、202/215、43 → 36、“找”一页 215 = 46 + 169 及 105/44/20 的拆分、456/0/0/0/0 → 7 次）、行数（+1,946/−357、各轮、A、B 合计 +3,890/−472、“Codex 估的整个 4C-2 1,750–2,550 行”的出处）。
3. 下面几处材料自相矛盾，请按代码和材料判哪个对：(a) F06 是 2 还是 3，`message_release` 是否还出现在某个清单里（§14 第 4 条说“不再在任何清单里出现”，第 8 条说 F06 = 缺源提示 0 + `message_release` 1 + 目标理解该更新 1）；(b) 4C-2 的 A 段是否改过 `note-read-model.ts`、`note-views.ts`；(c) §13 第 2 条最后的“读到的触发交给核对”说的是什么，§14 第 6 条对它的读法对不对；(d) 心跳 627 的拆分里目录是 1 次还是 2 次。
4. STATUS 和 lead-acceptance 里的已知限制：4C-2 A 段原来的限制“书记待办在筛掉已取消、没有计划的目标之前就读了它们的待审桶，被筛掉的目标读失败时整次也是 `unavailable`”在合入树里是否还成立（草稿把它删了）；“8C 的启动重放”“C1 的三个手写来源迁移”出自哪里、是否属实。
5. WG57 和证据 README 里列的源文件、测试文件路径在合入树里是否都存在。

输出：逐条列**错的或没有出处的**（文件和行号、草稿怎么写、应该怎么写、依据），最后一行写“事实核对完”。对的不用列。
