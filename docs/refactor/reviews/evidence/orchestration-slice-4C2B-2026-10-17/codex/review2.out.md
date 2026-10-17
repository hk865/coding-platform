只读快速核对完成；未修改文件，未运行测试或构建。以下“是”表示静态核对符合，不代表复跑通过。路径缩写：W＝`src/core/work-graph`，T＝`tests/work-graph`，H＝`tests/helpers`。

| 返工项 | 结论与证据 |
|---|---|
| 1 | 是。正文读取失败返回 unavailable，不调用处置。`src/composition/create-platform.ts:1420` |
| 2 | 是。比较请求与新卡的完整 pin 集；owner 的 revision_conflict 映射为 source_stale。`W/communication/decision-source-facts.ts:688`；`src/composition/create-platform.ts:1441` |
| 3 | 是。共用 finishDisposition，补只读指针守卫；书记仍只在 accept 读指针、resolution 只取矛盾目标；目标事件 actor/proof 均空。`W/notes/note-service.ts:687、813、1547、1564、1570、636` |
| 4 | 是。changes 两端均为同一 NoteHead；已删除 NoteVersion 登记。`W/notes/note-service.ts:781`；`W/persistence/decision-record-codecs.ts:238` |
| 5 | 是。U7 已有通用集合适配器和注记登记；U6 冲突应用进入默认登记表、统一查找。`W/views/decision-read-model.ts:239、302`；`src/business/workflow/decision-actions.ts:412` |
| 6 | 部分。共享事实函数、每头只取自己的目标、每目标一次关系批读已做；计划及目录缓存仍不满足上限，见下。`W/notes/note-service.ts:855`；`W/notes/note-decision-source.ts:154、168`；`W/notes/note-scribe-todos.ts:149` |
| 7 | 是。两处实参展开均改循环。`W/views/notice-grouping.ts:58、101` |
| 8 | 部分。N1–N3 和 D 行主体已走真实写入、公开读取及双后端；旧测试与期望值仍有违规，见下。`T/S4C2-N1.test.ts:33、40、60`；`T/S4C2-N2.test.ts:36、41`；`T/S4C2-N3.test.ts:46、53`；`T/S4C2-D-rows.test.ts:19、36` |
| 9 | 是。开放卡核对所属目标，不匹配分别 invalid/null。`W/communication/decision-source-facts.ts:680`；`W/views/decision-read-model.ts:327` |
| 10 | 是。改为 2，并写明手算。`tests/composition/WP2-wiring.test.ts:538` |
| 11 | 是。每例固定 Date，finally 恢复。`tests/scenarios/S2C-K-legacy-provenance.test.ts:424、433`。倒退时钟探针仅有作者报告，本次未独立复跑（`.lead-ref/s4c2b-rework1-final.md:21`）。 |

必须改：第6项的缓存没有贯通。卡源先读计划窗口，再调用事实读取器；后者另建 NoteCall，阶段目标再次读同一窗口（`W/notes/note-decision-source.ts:142、156`；`W/notes/note-service.ts:908、990`）。模块目标逐头进入锚点解析，每次重新读目录（同文件`:858、1004`；`W/notes/note-anchors.ts:671`；`W/architecture/catalog-service.ts:815`）。最小反例：一张卡关联同目标的阶段注记，窗口读两次；关联两条模块注记，目录读两次。后果是违反§11.7、§12.7，模块读取成本随关系目标数增长。修改思路：事实计算复用已读窗口，任务、模块和接口共用本次调用的计划/目录缓存，保持每目标一次关系批读。

计数测试没有证明这一点：它重新组装源，直接调用该源，数据全是文件锚点（`T/S4C2-read-counts.test.ts:394、402、440`），上述反例不会触发。应从真实队列进入，在实际注入端口外计数，并覆盖阶段和模块目标。

必须改：保留的旧测试不能以“内部单元”豁免。U7 的转发计数包装本身可保留（`T/S4C2-U7.test.ts:70`）；但当前夹具用 spy 捕获内部对象、重装源且仅 memory（`H/S4C2-note-decision-fixture.ts:51、57、65、76`），仍未满足返工书第8项，应迁到统一双后端夹具。

旧内部文件直接传入未真实保存的 ANSWER，随后读取存储事件、再伪造答复验证成功（`T/S4C2-note-decision-source.test.ts:24、210、217、244`）。U3 正向假卡的身份是 NoteHead，实际 pins 却是 Goal@7（`T/S4C2-U3.test.ts:122、130`）。最小反例就是这些现有数据：真实 owner 根本没有产生相应答复或卡，测试仍能成功，无法验证接线。修改思路：删除已被公开行替代的旧断言；正向、关闭及过期场景改走真实 owner。明确授权的伪造证明故障行保留（同文件`:90`），不能据此保留其他事实注入。

必须改：期望值还没有全部独立手算。D-01 的卡键期望经 helper 调用生产 `decisionSourceKey`；旧单元用生产 `renderNoteHeader` 算标签（`tests/scenarios/S4C2-U6-note-card-e2e.test.ts:58`；`H/S4C2-note-card-fixture.ts:126`；`T/S4C2-note-decision-source.test.ts:182`）。最小反例：生产键编码或标题格式改错，实际值与期望一起变化，断言仍过。修改思路：使用确定注记号，把关键键和标题写成字面量；已删除的旧单元无需再补。

两个 UNSPECIFIED：可选 `readGoal` 作为窄依赖可以接受，不妨碍 K3 登记；当前注记登记明确传入了它（`W/views/decision-read-model.ts:239、330`），但读取复用仍须按上述修正。D-09 用真实项目理解合理：写入规则明确将其 goalId 固定为 null，测试也确认待审、无卡且列表可见（`W/notes/note-service.ts:1038`；`T/S4C2-D-rows.test.ts:144、148、151、157`）。本次未见其他 U3/U6/U7 接入阻断项；U3 解码仍为登记表（`W/communication/decision-application.ts:67`）。

先改完列出的几处