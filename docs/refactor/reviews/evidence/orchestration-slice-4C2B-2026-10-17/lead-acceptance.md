# 4C-2 B 段：lead 的验收（2026-10-17）

**结论：** 合入（2026-10-17，f4171d51）。Codex 五次审查和一次测量核对里成立的问题都改了；没有照做的几处写明了原因。返工 4 之后的合并树跑全量：538 个测试文件全过，8,235 项过、5 项跳过，类型检查、模块边界检查、构建都通过；2C-26 已修。没有调用真实模型。

## 全量

合并树跑过两次全量（WSL，有 bwrap 和 systemd 用户会话，5 个并行）。返工 3 之后：535 个测试文件全过，8,211 项过、5 项跳过（`checks/merge-full-suite-summary-rework3.txt`）。返工 4 之后（合入的就是这棵树）：538 个测试文件全过，8,235 项过、5 项跳过，约 37 分钟，测试的内存峰值 4.72 GB（`checks/merge-full-suite-summary.txt`）。2C-26（`S2C-K-legacy-provenance` 依赖墙上时钟）已修：每个用例开头把 `Date` 固定到 `HOST_NOW`，结束时恢复；三个用例都过。补丁的 sha256 在 `checks/merge-patch.sha256`。

## 范围

**U3 — 证明解码表。** `decodeProofEvent` 按事件类型查表：`GoalSettingsChanged`、`PlanRevisionAccepted`、`NoteDispositionChanged`；`ArchitectureCatalogAdopted`、`ProjectCompletionPolicyActivated` 仍是回答 `unsupported` 的行；不认识的类型仍是 `incomplete`。`NoteDispositionChanged` 多 `proof` 和 `actor`（不是卡落实的处置两者都是 null），`acknowledgementRef` 等于 `proof.acknowledgementRef`，`changes` 按被改的头记 `NoteHead@v → @v+1`。伪造的证明指向另一条答复 → `invalid`；普通处置 → `incomplete`，有注记自己的公开行。

**U6 — 落实派发。** 第 ② 步按 `input.source.kind` 查注入的适配器表；今天的冲突代码原样进 `goal_conflict` 适配器，它是 `createDecisionActions` 里的默认登记；`note_review` 适配器先读保存的答复正文，读失败回 `rejected` `unavailable`，成功才调 `applyNoteDecision`，owner 的 pin 移动 `revision_conflict` 映射成 `source_stale`；没有适配器的 kind 回 `answered`。`action` 的类型是 `WriteResult<{goals: GoalSnapshot[]}> | NoteDispositionResult | CoreRejection | null`，HTTP 响应按别名跟随。重试还是同一个 `decisions/answer` 请求：答复重放，owner 按 `commandId` 重放原回执。

**U7 — 通用卡源。** `createCollectionCardSource<T>(spec, readGoal?)` 负责一次装配、按 attempt 缓存、按数字偏移分页、按键读和关闭判断；`DecisionCardSourcePort` 的 `needsGoal` 必填、`readByKey` 可选，`sourceNeedsGoal` 删掉；注记源只是一份登记。K3 第 4 组加第二个来源时是登记，不改协调者和队列。

**注记卡。** 有卡的是目标里 `pending_review`、`userReasonsOf` 非空的头；关卡顺序是取消 → `goal_cancelled`，已答复 → 照第 5 片，`userReasonsOf` 空或被盖过 → `source_resolved`，其余 `waiting_answer`；`goalId` 为 null 永不出卡。卡身份是头 pin，理解再加现行指针 pin；对象是注记和实际目标的聚合 pin；选项按原因给三选或两选，全部 `effect:'apply'`，拒绝也要落实并记回执。落实和书记共用一个 `finishDisposition`；卡模式用答复的用户当权限、卡的 pins 当守卫、实际目标集（`replaces` 减 `coexistWith` 加 `contradicts`），最后一个事件带证明，`commandId` 重放回执。卡的目标要和注记的 `goalId` 对上，不一致 `readSource` 回 `invalid`、`readByKey` 回 null。

**“请知悉”（U9）。** 写版本时定 `noticeClass`（`user_affected` > `structural` > `scribe_result`）；`NoteVersion` 按 `['ref.projectId','noticeClass']`、`since` 排的顺序查找，每个类从已看位置读；`views/note-review-notices.ts` 直接读记录；纯分组函数把 `user_affected`/`structural` 各一行、`scribe_result` 按目标折一行；折叠成员逐个 push；`seenThrough` 算这次读取已经翻过的页加这一页显示的成员。

**行。** D-01 用真的矛盾卡（取代和并存都改 `contradicts`，旧版本保留矛盾）；D-02 是 `source_stale`；D-04、D-16 不出卡；D-05 覆盖卡的部分；D-06、D-08、D-12、D-13、D-17 有公开行；D-09 无目标不出卡；D-11 的卡关闭 `goal_cancelled`。NE6 的服务行在 memory 和 SQLite 上各跑一遍；S4C2-N1/N2/N3、U7、U3 都有测试。

**2C-26。** `S2C-K-legacy-provenance` 每个用例把 `Date` 固定到 `HOST_NOW`，`afterEach` 恢复；三个用例都过，把时钟在“重排”和“建 C”之间往回拨 1.7 秒的探针也过，不改产品代码。

## Codex 和返工

| 次 | 结论 | 处理 |
| --- | --- | --- |
| 实现审查 | 9 条：8 条必须改 + 1 条测试期望（F06），每条带修改思路 | 1 个 Claude 子 agent 只读核实：9 条都成立，第 5 条的建议只部分成立；另找出 3 处漏的（M1、M2、M3）；lead 裁定写进 `books/s4c2b-rework.md` 第 2 节，返工 1 |
| 复审 | 11 项：9 项是（第 11 项是，只是时钟探针没复跑）、2 项部分（第 6 项缓存、第 8 项测试）；3 条必须改 | 返工 2 |
| 快速核对 | 3 项都部分：目录跨目标、注记自己的空证明行、字面键和标签 | 返工 3 |
| 快速核对 | 3 项都改了，没有新的生产问题，“可以合入” | 不返工，进全量 |
| 测量核对 | 第 1–3 项成立、必须改；第 4 项（“找”第一页超 100 毫秒）按 §11.7 写明原因，不扩改 4B | 返工 4（测量修法） |
| 测量快速核对 | 3 项都落实，4 条 UNSPECIFIED 可接受，“可以合入” | 不返工，进全量 |

B 段一共返工四轮：返工 1 按实现审查和核实，返工 2 按复审，返工 3 按快速核对，返工 4 是 3 处测量修法加读次数测试。测量修法另有 4 个 Claude 子 agent 各核实一份（`books/verify-measure-fixes.md`），Fix 和 Tests 部分作为返工清单；Item 4 的判断写进下面的“测量”。最后一轮测量快速核对说“可以合入”。

## 逐条审查项

1. **答复正文读失败当成“没写条件”（第 1 条）：** 适配器先读保存的答复正文；读失败回 `rejected` `unavailable`，不调处置，卡停在“已答、待落实”；重试仍用同一份答复，条件不丢，也不会因指纹变化报幂等冲突。
2. **`source_stale` 的错误码和指针移动（第 2 条）：** `readSource` 把请求的 pin 集和新卡整体比较（头挪了、指针挪了、新出现指针都算），回 `CoreRejection` 的 `code: 'source_stale'`；适配器把 owner 的 pin 移动 `revision_conflict` 映射成同一个码。两处锁定的测试改成 `source_stale`，新增指针用例和 D-02。
3. **两套处置核心、拒绝卡没有指针守卫（第 3 条）：** 在 `transitionNote` 处拆出 `finishDisposition`，书记的 `dispose` 和卡的 `applyNoteDecision` 共用；书记那一侧的行为不变（目标集只取被矛盾的，指针只在收下时读）；卡拒绝也加只读指针守卫。M2：只有卡落实自己的事件带 `actor` 和 `proof`，被取代目标的事件两者都是 null。
4. **证明的 before/after 不是同一个头（第 4 条）：** 每条改成同一个 `NoteHead` 的 `@v → @v+1`，主体和每个被取代目标各一条，不列 `CurrentPointer`；`AGGREGATE_REF_RULES` 里加过的 `NoteVersion` 行删掉。
5. **U7 没有可登记的通用适配器（第 5 条）：** 抽出 `createCollectionCardSource`，注记变成一份 spec 登记；U7 的测试改用真卡和计数包装。U6 的建议也做：`goal_conflict` 进 `createDecisionActions` 的默认登记表，只查一次，没有适配器的 kind 回 `answered`。
6. **卡源超出读取上界、二次方计算（第 6 条）：** 改用 `userReasonFacts`，把共用读者已读的计划窗口传进去；目录放进这次 attempt 的缓存；每个头只取自己的目标，删掉 `targetFactsOf`；`note-scribe-todos` 同样的 O(头×目标) 也改掉。读次数测试从真实队列进，memory 和 SQLite：两个目标 6 次批读，计划每目标 1 次，目录 1 次。
7. **通知折叠的无界实参展开（第 7 条）：** 两处 `list.push(...members)` 改成逐个 push，不设数量上限。
8. **验收行被事实注入或较窄的测试替代（第 8 条）：** 一个不用 `vi.spyOn` 的夹具跑 memory 和 SQLite，注记号确定；N1–N3、D 行用真实写入、书记处置和答复造数据，从 `queryDecisionQueue`、`readDecisionCard`、`resolveDecision` 和注记路由断言；D-01 用真的矛盾卡；删掉手写 `NoteVersion` 和手填 `noticeClass` 的旧测试。
9. **F06 的期望值（第 9 条）：** 2 是对的（`note_review` 缺源提示 0 + `message_release` 1 + 目标理解该更新 1）；`WP2-wiring.test.ts` 改成 2 并写清手算，三处 `toContain` → `not.toContain` 也对。

**审查漏掉的三处。** M1 已改：`readNoteDecision` 返回头里的 `goalId`，请求的目标和它不一致时 `readSource` 回 `invalid`、`readByKey` 回 null，不在别的目标里存答复、出卡。M2 并进第 3 条。M3 不改代码：`seenThrough` 按这次读取已经翻过的页加这一页来算，规格 §14 第 5 条已写明；N3 只有按这个读法才成立。

## 测量

**尺子。** §11.7 第 918 行（本稿 920 行）给“找”第一页定的尺子是**分段**的那一页；超了要解释，不是判不合格。

**2 万条注记的数据（负载 7–10，热的中位数）。** 这一页热的中位数整体约 126–200 毫秒。带分段的第一页（执行 Run，一个词，每页 20 条，另核 10 条项目规范）读存储 222 次、约 140–149 毫秒；主机不分段的同一个词 209 次、约 143–158 毫秒。把项目锚点集合改成和核对共用以后（输出逐字相同），分别降到 215 次和 202 次；在负载 1 左右交替各跑 30 次，分段约 120–130 毫秒、不分段约 115–120 毫秒，仍然超。不分段的页把项目部分整个去掉也要约 100 毫秒，所以超出的不在 4C 新加的读法上。

- **次数：** 分段那一页 215 次里，本节新加的读法 46 次，其余 169 次是 4A/4B 原有的核对推导，§11.7 算“没改的读法”：每项算 `conflicting` 要读它每个锚点的整组注记（21 个锚点 × 5 个槽 = 105 次），每个涉及的目标读 4 个状态桶只为数个数（11 个目标 44 次），第 5 类提示每个 Run 读 Run 和它的计划（10 个 Run 20 次）。这些是 L22 要求每项都有的字段，不是重复读。
- **共用以后：** 同一次调用里每组锚点、每个状态桶、每个计划窗口、每个 Run 都只读一次；决定 70 第二轮只能把写后提示的 20 次并成 2 次，省 3–5 毫秒。要降到 100 毫秒以下得改读法的形状（数配额不解码、只含现行注记的锚点索引、文件观察并行），要改 4A/4B 的读法和存储接口，不在 4C-2 做，4C 合入后补审注记部分时一起定（决定 70“定的”第 4 条说的那次补审）。
- **不是同一页：** 提速第一轮那个 41 毫秒的“找”不分段，20 项里 14 项是已取代的；§11.3 以后默认只给现行和待审的，现在 20 项都是现行的，核对的文件从 8 个变成 20 个。这个比较是推断，没在第一轮代码上重测。

**其他数字。** 心跳在 101 个目标上 2,254 次 → 627 次（预算 610 + 15 次阶段计划查找 + 2 次目录），约 0.85 秒 → 0.19 秒；Goal 卡的记忆材料 43 → 36 次；`lookup` 和 `stale` 在尺子内。次数在 `checks/measure-4c2-smoke.out.json`（改之前）和 `checks/measure-4c2-after.out.json`（返工 4 之后），脚本是 `checks/measure-4c2.mjs`。

**调查报告里两处不对（Codex 的文档事实核对指出，报告原样保留）：** `checks/measure-4c2-investigation.md` 说 4C-2 两段都没改 `note-read-model.ts`、`note-views.ts`，其实 A 段改过（+464、+177，见 `books/verify-measure-fixes.md`）；它把心跳里的目录算成 1 次，按底层读是一次目录窗口、两次读，所以 627 = 610 + 15 + 2。

**修法。** (1) 书记待办改用 `userReasonFacts`，把共用读者已读的窗口和 `readThrough` 传进去；关系目标只为要计数的待审桶读；删掉 `check` 依赖、`targetAnchorKeys`、`understandingTriggers`。(2) 原因事实这条路加 `goalPlanWindow` 钩子，任务目标用本次计划窗口；窗口 `not_found` 时读一次 Goal，分清目标不存在和计划悬空；写路径不变。(3) `selectProjectHeader` 收下并共享 `anchorSets`，项目集合一次读；§11.7 第 910、912 行（本稿 912、914 行）的措辞改成“项目锚点集合一次”（5 个槽，和核对、有联系的集合共用）；RW-12(i) 25→20、RW-12(ii) 37→32。

**裁定。** A：`symbol_missing` 是文件原因；非文件原因是 `task_ended`、`module_removed`、`interface_removed`、`stage_not_in_current_plan`；`file_deleted` 和 `symbol_missing` 是文件原因。B：原因事实这条路上，目标在同一个项目的另一个工作区按那个目标的计划窗口算，不 `forbidden`；另一个项目仍 `forbidden`；写路径不变。

## 没有照做的意见 / 接受的 UNSPECIFIED

- **所有注记选项都是 `effect: 'apply'`：** 接受。拒绝也要落实状态并记正式回执（NE6 的服务行读得到）。
- **`createCollectionCardSource(spec, readGoal?)` 的可选第二参数：** 接受。投影需要 `GoalSnapshot`，这个窄依赖不妨碍 K3 登记。
- **D-09 的合法无目标种子只有项目理解：** 接受。写入规则把项目理解的 `goalId` 固定为 null，测试确认它待审、无卡、列表可见。
- **U7 只有测试改写、没有生产 RED：** 接受。迁移后计数包装仍非空转（漏了包装是 0，分页直读是 2）。
- **删掉的 `S4C2-note-decision-source.test.ts` 每个案例都有公开行覆盖：** 接受。覆盖在 D 行、U6 端到端、证明和过期测试里。
- **公开修订拒绝删模块：** 接受，没有为测试加删除路径；用公开修订删接口 `A/I1`，它和模块缺失进同一个候选分支。
- **队列 T1 的目标读仍是 2 次：** 接受。计划窗口 1 次，另一次是决定视图本来就有的 `readGoalForBasis`；删掉的目标项正好是 4 次 Goal + 2 次 PlanRevision。
- **另一个项目的目标“仍 forbidden”没法公开断言：** 接受。目标锚点只带 `goalId`，读取限定在调用项目（缺失即 `not_found`），项目检查留在代码里。
- **悬空计划的回退不测：** 接受。只有篡改数据库才造得出，按规格 §13 第 4 条不补测试，回退代码保留。

## 已知限制

- **“找”第一页还超 100 毫秒：** 见上；超的是 4A/4B 每项都要算的推导，读法形状的改动在 4C 合入后补审注记部分时一起定。
- **A 段留下的待审桶读：** 书记待办在筛掉已取消、没有计划的目标之前就读了它们的待审桶，被筛掉的目标读失败时整次也是 `unavailable`；B 段只改了关系目标的读，这一条照旧。
- **K3 第 4 组还没接：** 本段只留出 U3 的行、U6 的适配器和 U7 的卡源登记位；K3 第 4 组在自己的 B1 里加第二份登记，不改协调者和队列。
- **队列 T1 的目标读 2 次：** 一次是计划窗口，一次是原有的 `readGoalForBasis`；后者不在本段范围。
- **另一个项目仍 forbidden，但没法公开断言：** 项目检查保留。
- **悬空计划的回退没测：** 只有篡改才到得了。
- **这台机器的墙上时钟还会跳：** WSL 的墙上时钟大约每 31 秒回跳 1.5–1.9 秒；2C-26 已改成每个用例固定 `Date`，别的用墙上时钟比先后的测试仍可能偶发失败。lead 没改系统设置。把时钟在“重排”和“建 C”之间往回拨 1.7 秒的探针只有施工方的报告，Codex 没有独立复跑；三个用例本身都过。
- **没有调用真实模型：** 整个 MVP 也还没用真实模型重跑。
