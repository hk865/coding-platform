# SC rework 1 回报（2026-10-21 晚）

基线 `sc-r1-base`（`efa2303`）。26 行全部完成，无 BLOCKED。提交 `9a504c0 SC rework 1`：16 个文件，`408 insertions(+), 229 deletions(-)`。`.scale.test.ts` 未改、未跑；`git diff --stat sc-r1-base HEAD -- 'tests/**/*.scale.test.ts'` 为空。

## 1. 逐行

### A 组（P1-01、P1-06、L-01、L-02、P2-01～P2-04）

| 行 | 状态 | 文件（行） | 改了什么 |
|---|---|---|---|
| P1-01 | done | `src/core/work-graph/views/decision-read-model.ts:837`、`src/core/work-graph/views/goal-conflicts.ts:121-130` | 队列主 Goal 列表调用补第三参数 `deps.lookupPageLimit`，经 `listWorkspaceGoals` 传到 `lookupAll`；冲突组装器自己的 Goal 读仍按同一宽度。 |
| P1-06 | done | `src/core/work-graph/views/goal-conflicts.ts:65,124`（常量原 `:86-87`） | 删除无运行引用的 `GOAL_LOOKUP_PAGE_LIMIT`；两处注释改为“省略时沿用 `lookupAll` 的默认 200”。 |
| L-01 | done | `src/core/work-graph/views/goal-conflicts.ts:84` | 恢复 `sc-base` 原文 “a source lookup window that keeps changing…”。 |
| L-02 | done | `src/core/work-graph/views/decision-read-model.ts:876,912,930,1341,1604-1608,1630-1635` | 四处把 `deps.lookupPageLimit` 原样下传（不再 `?? SOURCE_PAGE_LIMIT`）；两个私有 helper 改 `pageLimit?: number`，缺省时条件展开交给 `lookupAll` 的 `options?.pageLimit ?? LOOKUP_PAGE_LIMIT`。`sourcePageLimit` 三处（`:958,1027,1379`）未动。 |
| P2-01 | done | `decision-read-model.ts:837`；`tests/work-graph/S2A-queue-bounds.test.ts:119`、`tests/work-graph/S5R2-queue-history.test.ts:128` | 与 P1-01 同一处生产修复；两个日常注释改为主列表实际 2、2、1。 |
| P2-02 | done | `tests/work-graph/S2A-queue-request-candidates.test.ts:5-9,19-21,32,72-89` | 日常例改为 5 个候选、`lookupPageLimit: 4`：A 层 6 条 4/2，B′ 8 条 4/4，活候选 `S2AQ09-4` 第 5 项、两层都在末页；名称、注释同步。规模例原文未动。 |
| P2-03 | done | `tests/work-graph/S5R2-queue-history.test.ts:189-199` | 注释补齐完整 9 张队列（2/2/2/2/1，末页 `send-3`）和 7 条消息索引（2/2/2/1，末页 `send-3`）；未删任何夹具卡片，只读断言未动。 |
| P2-04 | done | `tests/work-graph/S2A-queue-bounds.test.ts:60-66,104-111`、`tests/app/S2A-decision-routes.test.ts:120-125` | 补写逐页实际字节序并点名末页：QA-04 消息层 `waiting-2`；QA-05 内外层 `send-0`；QA-14 内外层 `send-3`。造数与断言未动。 |

### B 组（P1-03、P1-04、P5-03）

| 行 | 状态 | 文件（行） | 改了什么 |
|---|---|---|---|
| P1-03 | done | `tests/helpers/B2-401-world.ts:230-242` | 删除包装器的 `lookupPageLimit` 参数和 `Math.min` 截断；恢复 `base.lookup(request)` 原样转发，计数器记录 `request.limit`。 |
| P1-04 | done | `tests/helpers/B2-401-world.ts:279-284` | 删除 helper 对 `taskRequestPageLimit` 的 `?? 200` 补值；只在调用者显式提供时条件展开。规模文件无参调用不再收到 200，由 owner 自己的默认决定。 |
| P5-03 | done | `tests/runtime/B2-401-world.test.ts:7-12,50-55,63` | 日常调用只留 `taskRequestPageLimit: 2`，删除 `lookupPageLimit: SMALL_PAGE` 及“包装也缩页”的说明；请求路径由 D 传到 A。 |

### C 组（P1-02、P3-01～P3-05）

| 行 | 状态 | 文件（行） | 改了什么 |
|---|---|---|---|
| P1-02 | done | `tests/helpers/S2A-notices-overbound-fixture.ts:115-153` | 默认/`creation` 分支恢复基线“发一条、立即回一条”的逐条循环；只有显式 `replyOrder:'message-key'` 分支先收集、按 SessionMessage refKey 排序、再回复。规模调用不传 `replyOrder`，回到基线顺序。 |
| P3-01 | done | `tests/work-graph/WP2-undelivered-notices.test.ts:520-523,540-546` | 只在小版本交换角色：目录末页的 D 发信并经 `health('missing', D)` 退役，S 进入并回复；用现有 `enter/send/yieldWait/respond/health` 参数，全部原断言保留（另加一条退役 health 形状断言）。 |
| P3-02 | done | `tests/work-graph/WP2-undelivered-notices.test.ts:524-532,547-556` | 小版本 `replyLine` 按消息键升序提交回复，`messages`/`replies` 按同序返回，断言形状不变；4 条和 5 条世界的内外层页序重算并写入注释。 |
| P3-03 | done | `tests/helpers/S2A-notices-overbound-fixture.ts:78-83,166-171`、`tests/work-graph/S2A-notices-overbound.test.ts:22-28,38,53-64` | 夹具新增可选 `memberNoticeRequestIds`（缺省仍每次 `f.newId()`，顺序不变）；日常例传 5 个字面 request id，使最后提交的 N4 的 messageId 最大、位于 A 层末页；A 层四页与成员来源层三页的完整顺序写入注释。 |
| P3-04 | done | `tests/work-graph/S2A-notices-attempt.test.ts:21-31` | 补明 ordered 层按 `since` 提交位置升序、来源层同序；两层均为 `[rework-000,rework-001]/[rework-002]`，总数 3 依赖末页 `rework-002`。 |
| P3-05 | done | `tests/work-graph/S2A-notices-overbound.test.ts:34` | 名称改为“5 new Sessions in an 8-Session directory, page 2 … 5 undelivered replies and 5 member notices”，保留回复/通知/页宽尺寸。 |

### D 组（P1-05、P5-01、P5-02、P5-04、P5-05）

| 行 | 状态 | 文件（行） | 改了什么 |
|---|---|---|---|
| P1-05 | done | `tests/helpers/S2C-X-scale-fixture.ts:255-299` | `addResponsibleModules` 改用公共 `createProjectBootstrapServices(...).projects.readWorkspaceRegistration` 取 Project/Workspace 修订号，公共 `createArchitectureCatalogService(...).readArchitectureRevision({selection:{kind:'current'}})` 取基线与目录，再用返回值调 `reviseArchitectureCatalog`；删除 `readCurrentCatalogWindow`、`canonicalRefKey`、`decodeProjectSnapshot` 直读。`xResponsibleModules=0` 仍提前返回、不建 owner。 |
| P5-01 | done | `tests/helpers/S2C-X-scale-fixture.ts`、`tests/work-graph/S2C-lines-scale.test.ts:48-49,60-61,88-92,125-140` | `archivedPairs:1`、`archivedCopies:1`，归档秒数 `[5,0,1,2,3,4,6]`；S=6、F=2、A=1、C=6−(2−1)=5；7 条候选按页宽 2 的头数 `[0,2,2,1]`，末页仍有决定项；手算注释同步。 |
| P5-02 | done | `tests/work-graph/S2C-lines-scale.test.ts:57,145-160,174-185` | 日常 `listPageLimit:1`；三个已接手任务分别读 `[原 Run]/[picker]`，picker 在第二页；R 重算 `1+8×3=25`，W `4+3×4+2=18`，预算 10 的 partial 也重算。 |
| P5-04 | done | `tests/work-graph/S2C-lines-scale.test.ts:98-102` | X 链接注释改为 `[module1,module2]/[task]`，明确 `task` 是第二页唯一记录。 |
| P5-05 | done | `tests/work-graph/S2C-lines-scale.test.ts:78-84,138-140` | 例 (1) 改为 active Session 16 条、8 页，副本索引在内存建立（专用读 0 次）；专用副本索引 `3 @ width 2 => [2,1]` 移到例 (2) 的归档列表组装路径；补齐 active Session 手写页序。 |

### E 组（P4-01～P4-04）

| 行 | 状态 | 文件（行） | 改了什么 |
|---|---|---|---|
| P4-01 | done | `tests/work-graph/S2A-queue-derived-cards.test.ts:17-24,53,55,63` | 两处期望键改为末项 `S2A-PQ-00004` 的规格格式字面量 `LAST_PLANNING_KEY`；删除 `decisionSourceKey` 与只服务于它的 `answerRefs`/`QueryJobAnswerRef`。请求构造与规模例未动。 |
| P4-02 | done | `tests/work-graph/WP2-context-extensions.test.ts:585-611` | 四个种子行键改为规格格式字面 canonical JSON（message、Q1 candidate、Q2 candidate、A/B goal_conflict）；只代入公共创建步骤返回的 `messageId`/`queryJobId`；删除这些期望值对 `decisionSourceKey` 的调用及因此不再使用的 import。 |
| P4-03 | done | `tests/work-graph/WP2-context-extensions.test.ts:441-505,537-566` | 两个小例旁补齐 B′ 5 条 2/2/1、外层队列 6 张 2/2/2、A 消息层 6 条 2/2/2 与 7 条 2/2/2/1 的完整顺序和末页记录；规模与断言未动。 |
| P4-04 | done | `tests/work-graph/WP2-context-extensions.test.ts:9-15` | 文件头改为“日常文件验证缩小后的分页（页宽 2、4 个候选、新增 4/5 条请求），100/5,000/5,001 原边界留在相邻 `.scale.test.ts`”。 |

## 2. 每个改动的小例：各层顺序、分页、决定项页、首屏检查

顺序均为 store 的 index key 的 UTF-8 字节序（`lookup-index.ts:568-573`）；除注明外均用文件的既有夹具。

### A 组

- **QA-04（S2A-queue-bounds，注释行）** 消息层 `s2a-user-messages` 7 条、宽 2：`[answered-0, fixture answered] [waiting-0, fixture decision] [answered-1, waiting-1] [waiting-2]` = 2/2/2/1；决定项 `waiting-2` 第 4 页。首屏检查：该行没有“首屏也过”的断言声明；分页由 `$M=.dsh-scratch/A-1` 的临时计数确认（`s2a-user-messages limit 2 pages 4 items 7`）。
- **QA-05（同上，注释行）** 外层 5 张卡、`page.limit 2`：`[send-2, send-3] [send-1, send-4] [send-0]` = 2/2/1，决定项 `send-0` 第 3 页；内层 7 条、宽 2：`[fixture answered, send-2] [send-3, send-1] [fixture decision, send-4] [send-0]` = 2/2/2/1，决定项 `send-0` 第 4 页。首屏检查同上（A-1 计数）。
- **QA-06（同上，P1-01/P2-01）** Goal 列表 5 条、宽 2：`[A, B] [C, S5R2-capacity-000] [S5R2-capacity-001]` = 2/2/1；末页 `S5R2-capacity-001`；本行声明“决定项末页规则不适用”。首屏检查：`$M=.dsh-scratch/A-3` 只删掉 `decision-read-model.ts:837` 的新第三参数后，主 Goal 列表变为 `limit 200 pages 1 items 5`（4 次调用），冲突组装器仍 `limit 2 pages 3 items 5`；该例只断言“不拒绝”，所以仍过——这正是 P1-01/P2-01 的缺口，分页用计数验证。修复后 A-1 计数为 `a2-goal-by-workspace limit 2 pages 3 items 5`。
- **QA-09(ii)（`S2A-queue-request-candidates`，P2-02）** 5 个候选、宽 4。A 层请求索引 6 条：`[S2AQ09-0..3] [S2AQ09-4, U1(0798…)]` = 4/2；B′ 层 Goal-B 提案索引 8 条：`[S2AQ09-0..3] [S2AQ09-4, U1(0798…), U2(a9aa…), PB1(fd93…)]` = 4/4；活候选 `S2AQ09-4` 两层都第 5 项、都在末页。首屏检查：`$M=.dsh-scratch/A-4` 令 `lookupAll` 首页后 `break`，QA-09(ii) 两个后端都失败于 `expect(direct).toMatchObject({… state:'waiting_answer', candidateStatus:'candidate' })`（第 79 行，收到 `closed`/`null`）；`$M=.dsh-scratch/A-5` 令 `readLookupKeys` 只读首页，失败于 `expect(queued).toHaveLength(1)`（第 90 行，得到 0）。
- **R2A07/08（`S5R2-queue-history`，注释行）** Goal 列表 5 条、宽 2，同 QA-06：`[A, B] [C, capacity-000] [capacity-001]` = 2/2/1，末页 `capacity-001`；决定项末页规则不适用。首屏检查同 QA-06（A-3 计数，行只断言“不拒绝/只读”）。
- **R2A09（同上，P2-03 注释行）** Goal-B waiting 队列 9 张、`page.limit 2`：`[candidate Q1, candidate Q2] [B change_pending, A/B goal_conflict] [send-0, send-1] [send-2, send-4] [send-3]` = 2/2/2/2/1，末页 `send-3` 第 5 页；消息索引 7 条、宽 2：`[send-0, fixture answered] [send-1, send-2] [fixture decision, send-4] [send-3]` = 2/2/2/1，末页 `send-3` 第 4 页。首屏检查：该行是注释修正、无首屏声明；A-1 计数打印出 5 页且末项 `send-3`。
- **QA-14(a)（`tests/app/S2A-decision-routes`，P2-04 注释行）** 外层 5 张 Goal-C 卡、`page.limit 2`：`[send-4, send-0] [send-1, send-2] [send-3]` = 2/2/1，末页 `send-3` 第 3 页；内层 7 条、宽 2：`[send-4, fixture answered] [send-0, send-1] [send-2, fixture decision] [send-3]` = 2/2/2/1，末页 `send-3` 第 4 页。首屏检查：注释修正、无首屏声明；A-1 计数打印出 3 页且末项 `send-3`。

### C 组

- **WP2 M07 4 条回复（`WP2-undelivered-notices`，P3-01/P3-02）** 目录 3 个 Session、宽 2：`[S a63653f9, idle c9bd91d8] [D e703d7ad]` = 3/2 = 2 页，决定性的来源 D 在第 2 页；回复内层/外层 4 条、宽 2：`[M3, M2] [M0, M1]` = 2 页，决定项 `M1` 第 2 页。首屏检查：`$M=.dsh-scratch/C-1` 令目录读首页后 `break`，M07 失败于 `expect(all).toHaveLength(4)`（得到 0，D 在第 2 页被丢掉）；`$M=.dsh-scratch/C-2` 令内层回复读首页后 `break`，M07 失败于同一断言（得到 2，只有 M3、M2）。
- **WP2 M07 5 条回复（同上）** 目录同 2 页；回复内层/外层 5 条、宽 2：`[M3, M2] [M4, M0] [M1]` = 3 页，决定项 `M1` 第 3 页。首屏检查同 C-1/C-2（C-1 对 M10 也有预期副作用，3 failed/21 passed）。
- **QA-10(ii) overbound（`S2A-notices-overbound`，P3-03/P3-05）** 目录 8 个 Session（基础 2 + 新增 5 + responder 1）、宽 2：4 页，末页 `created-00001`；A 层 `s2a-user-messages` 7 条、宽 2：`[N3, base answered] [base pending, N2] [N0, N1] [N4]` = 2/2/2/1，`N4`（最后一个提交，request id `qa10-member-tail-8`）在第 4 页；成员来源层 5 条、宽 2：`[N0, N1] [N2, N3] [N4]` = 2/2/1，`N4` 第 3 页；回复内层/外层 5 条、宽 2：2/2/1，尾项在末页；外层队列 10 项、`limit 2`：5 页，末项 `N4`。首屏检查：`$M=.dsh-scratch/C-3` 令 `lookup-all` 对 `s2a-user-messages` 首页后停，overbound 两个后端都失败于 `expect(first.counts.notices.member_notice).toBe(5)`（得到 1，N4 在第 4 页被丢掉）。
- **L11（`S2A-notices-attempt`，P3-04 注释行）** ordered 层 `[rework-000, rework-001] [rework-002]` = 2 页；source 层同序同 2 页；总数 3 依赖末页 `rework-002`；一次装配 2 次 ordered 读（按 source 页重建会是 4）。首屏检查：注释修正、无首屏声明。

### B 组

- **B2-401 world（`tests/runtime/B2-401-world`，P5-03）** 5 条 CRR 记录 `b2-401-request-001..005`，Task 索引按 canonical refKey 字节序。Hook 层（D=2）：`[001,002] [003,004] [005]`，limits 2/2/2、records 2/2/1，决定性的唯一 allow `005` 第 3 页；request 工具层（D 经 A）：同序同分页，`005`（已 used）第 3 页。首屏检查：`$M=.dsh-scratch/B-1` 把 `command-rerun-request-service.ts:467` 的 D 改成 200，B2-16/F-032 失败于 `expect(taskPages).toHaveLength(3)`（得到 1 页）；`$M=.dsh-scratch/B-2` 把 `:582` 改成 200，B2-18 失败于同一断言；`$M=.dsh-scratch/B-3` 在 `:582` 变异之上恢复旧 `Math.min(…,2)` 包装，3/3 全过，复现 P5-03 所说的“旧包装遮住漏传 D”。

### D 组

- **2C-25 (1)（`S2C-lines-scale`，P5-05/P5-04）** active Session 16 条、宽 2：8 页，按 sessionId 字节前缀 `[055198e9,06bb2ace] [22f49bd3,29866ef0] [2e83e7df,356f34bb] [42da6590,6d6c211d] [6edbaa7c,7f91feec] [83b8fd3e,89dc9107] [8ab793a2,a63653f9] [c9bd91d8,d8f2952d]`；该枚举无单一决定项。副本索引由这 16 条在内存建立，本例专用读 0 次。X 负责链接 3 条、宽 2：`[module1, module2] [task]`，决定性 `task` 第 2 页。归档公式 S=6（4 plain + pair predecessor + pair successor；readonly copy 不计）、F=2、A=1，C=6−(2−1)=5。首屏检查：`$M=.dsh-scratch/D-2` 删除 copy 过滤和 predecessor 扣减后 4 failed/4，例 (1) 的 `lines.counts.archived` 得到 6 而非 5；P5-04/P5-05 用 `$M=.dsh-scratch/D-1` 的临时计数确认。
- **2C-25 (2)（同上，P5-01）** 7 条归档候选、`page.limit 2`，按 archivedAt 降序为 `[copy(6), predecessor(5)] [plain4(4), plain3(3)] [plain2(2), plain1(1)] [successor(0)]`；过滤后每页头数 `[0,2,2,1]`，决定性的最后一个 head（pair successor）第 4 页；收集到的 head 顺序 `[4,3,2,1,0]`；每次归档页组装专用副本索引 3 条、宽 2 为 `[2,1]`。首屏检查：D-2 的变异下例 (2) 失败于 `expect(collected).toHaveLength(5)`（得到 7）。
- **2C-25 (3)（同上，P5-02）** R 消息层 8 条、宽 1：`[1]…[8]`，回复的 7、8 在第 7、8 页，决定项 8 在末页；预算 `1+8×3=25`。W 锚点层 4 条、宽 1：`[1]…[4]`，refKey 末项第 4 页。已接手 Run 层三个任务各 `[原 Run]/[picker]`，决定性的 picker 在每任务第 2 页；预算 `4+3×4+2=18`。首屏检查：`$M=.dsh-scratch/D-3` 令 `readEnteredAnchors` 首页后停，2 failed/6；例 (4) 失败于 `expect(w.status.attention).toBeNull()`（收到 `unknown`/`anomaly_pending`）；**例 (3) 仍过**，见 §5。
- **2C-25 (4)（同上）** 预算 10：R `1+3×3=10`，第 4–8 页被拒，回复 7、8 都在被拒页 → `partial atLeast 0`；W 4 个锚点页 + 第一已接手任务 2+2 + 第二任务首页 2 = 10，第二任务的第 2 页（picker）被拒 → partial。首屏检查：D-3 下例 (4) 失败（同上），证明 picker 页被读到才得到 `attention=null`。

### E 组

- **QA-07 / QA-09(i)（`S2A-queue-derived-cards`，P4-01）** 5 个 planning job；C 层查询任务/规划问题来源 5 条、宽 2：2/2/1，末项 `S2A-PQ-00004` 第 3 页。期望键改为字面 `LAST_PLANNING_KEY`。首屏检查：该行无首屏声明；字面键经测试通过验证。
- **F07 tail Task card（`WP2-context-extensions`，P4-02/P4-03）** B′ 5 条、宽 2：`[candidate-000 2ffd…, candidate-002 3299…] [initial 4199…, candidate-003 6751…] [candidate-001 91ac…]` = 2/2/1；已采纳初始提案解码后过滤，内层末页是第 4 个活候选 `candidate-001`。外层队列 6 张、`decisionPageLimit 2`：`[c000,c002] [c003,c001] [change_pending, required_task_deferred]` = 2/2/2，命名的 Task 卡第 6 张/末页。首屏检查：`$M=.dsh-scratch/E-1` 令 B′ 的 `readLookupKeys` 在 width 2 时首页后停，2 failed/8；两个后端都失败于 `WP2-context-extensions.test.ts:528` 的 `toEqual(allRowKeys)`（缺 c003、c001）。
- **F07 容量例（同上，P4-02/P4-03）** A 消息层 6 条、宽 2：`[Real decision 1 233b…, fixture answered 364e…] [Real decision 0 6341…, Real decision 2 798d…] [fixture decision 7f54…, Real decision 3 cd8c…]` = 2/2/2，末页 `Real decision 3`；加 overflow（23f3…）后 7 条：`[Real 1, overflow] [answered, Real 0] [Real 2, decision] [Real 3]` = 2/2/2/1，末页仍 `Real decision 3`；队列层 8 张 2/2/2/2、9 张 2/2/2/2/1；加 4 条 hint 后 12/13 行。首屏检查：`$M=.dsh-scratch/E-2` 令 `loadWorkspaceMessages` 的 A 层首页后停，1 failed/9，失败于 `WP2-context-extensions.test.ts:583` 的成员断言（缺一张已创建卡）；tail-card 两例仍过，说明只打中 A。

## 3. 组清单之外的文件

无。五个组都只改了 §2 表里列出的文件（A 6 个、B 2 个、C 4 个、D 2 个、E 2 个，共 16 个）。P3-03 的可选 request id 参数加在 `S2A-notices-overbound-fixture.ts` 自己身上，没有动 `S5-decision-fixture.ts`；P1-05 的公共读取在本文件内构造 owner，没有改别的 fixture。`.lead-ref/` 在本副本不存在，因此没有改 `sc-reply.md`；本回复就是更正后的计算。

## 4. 检查

- `flock ./.typecheck.lock npm run typecheck` → 0；`npm run check:architecture` → 0（`next source boundaries: OK`）；`npm run build` → 0。
- `npx tsc --noEmit -p tsconfig.json --noUnusedLocals 2>&1 | grep "TS6133\|TS6196\|TS6192\|TS6198"` → 3 行，全部在 SC2 新增的 `tests/app/S2A-decision-routes.scale.test.ts`（`S2A_ROUTE_READ_FAILURE_REASON`、`failingBindings`）和 `tests/work-graph/WP2-context-extensions.scale.test.ts`（`CoreCallContext`）。它们是 `sc-r1-base` 上已有的 SC2 拆分遗留，不在本次 16 个文件里；因为 R-SC-3 冻结 `.scale.test.ts`，没有修。这一条严格按“rework 或 SC 改过的文件”读是未达标（见 §5）。
- 日常 12 个文件：batch 1（10 文件）83/83，batch 2（2 文件）12/12，共 95 项全过。各文件时长（vitest 汇总）：overbound 326ms、derived-cards 286ms、S2C-lines-scale 641ms、queue-bounds 514ms、B2-401-world 750ms、decision-routes 268ms、unknown-call-review-list 2616ms、queue-request-candidates 246ms、S5R2-queue-history 1245ms、undelivered-notices 840ms、notices-attempt 281ms、context-extensions 546ms。
- `tests/architecture`：4 文件、53 项全过（26.52s）。
- 改过的 helper/生产文件的 importer：`grep -rln` 去重、排除 `.scale.test.ts` 后新增 18 个文件，batch 1 97/97、batch 2 96/96 全过。合计 34 个唯一文件、341 项通过、0 失败、0 跳过。
- 环境失败：无（没有 `ENOENT … bwrap` / “sandbox unavailable”）。
- `node ./.dsh-ref/scale-move-check.mjs sc-base HEAD > ./.dsh-ref/out/move-check-r1.txt` → exit 0，末行 `pairs 12; cases at sc-base 67; cases not found 0; items to review 0; OK`。
- `git diff --stat sc-r1-base HEAD -- 'tests/**/*.scale.test.ts'` → 空。
- `npx vitest list --config vitest.scale.config.ts | wc -l` → 38。
- 改动测试文件的 `.skip(`/`.only(`/`.todo(`/`.skipIf(`/`.runIf(`/`fails:` 扫描 → 0；非规模文件没有新增 per-test timeout。
- 变异检查的副本：任务书指定的 `/home/han001/dsh-work/sc-r1-mut/` 在本沙箱不可写（`mkdir` 被 workspace-write 拒绝，提升 `danger-full-access` 又没有审批通道），所以改用仓库内、`.dsh-scratch/<组>-<n>/` 的 `git ls-files`+硬链接副本（不参与收集，已加入 `.git/info/exclude`），每个检查新建一份。所有副本已随 `.dsh-scratch/` 一起删除。这是与任务书路径的唯一偏差。
- 提交：`9a504c0 SC rework 1`，按路径 stage 16 个文件，`git diff --cached --stat` 与 `git diff --shortstat sc-r1-base HEAD` 均为 `16 files changed, 408 insertions(+), 229 deletions(-)`；未 stage `.dsh-ref/`、`.dsh-scratch/`、`.typecheck.lock`。提交后 `git status --short` 为空。

## 5. 表里的疑似问题 / HANDOFF

1. **P5-02 的首屏声明只对例 (4) 成立。** 任务表说“readEnteredAnchors 即使只读首页，日常两例仍通过”；按行内指定改法（`listPageLimit:1`、重算 R/W 和预算）后，例 (4) 的 picker 页确实变成决定项、首屏变异会让它失败，但例 (3) 在同样变异下仍过：它唯一能观察 written-anchor 的公共字段是 `attentionCounts.unknown === 1`（`unknown`/`anomaly_pending`），任何正数 pending 都会给出同一个值，无法区分 1 个和 4 个未领取锚点。行内要求“保留断言”，所以没有加新断言或换 DTO；这里只报告，不改。若要例 (3) 也具备首屏失败能力，需要一个新的公共 pending 计数表面，超出本行。
2. **P3-02/P3-03 的页序与表中原句不同，但这是行内改法要求的重算。** P3-01 把“谁发信、谁退役”交换后，4/5 条世界的消息键顺序不再是表里的 `[4,3]/[2,1]`；P3-03 改用字面 request id 后，A 层顺序也不再是表里按 `f.newId()` 推出的 `[N0,基础已答]/[N4,N3]/…`。本回复 §2 给的是改后实际的 `[M3,M2]/[M0,M1]`、`[M3,M2]/[M4,M0]/[M1]` 和 `[N3,base answered]/[base pending,N2]/[N0,N1]/[N4]`；表里这两段应视为旧夹具/旧角色下的推导，不是最终顺序。
3. **P4-03 的“B′ 末页记录”措辞需要区分层。** B′ 是 PlanProposal 候选枚举，末页是第 4 个活候选 `candidate-001`（91ac…）；被断言的 Task 卡是外层队列的 `required_task_deferred` goal_cause，第 6 张/末页。任务表“B′ 5 条、2/2/1”本身没错，我给的 brief 里“B′ 末页是 Task 卡记录”不准确，已按实际写进注释。
4. **未使用局部变量检查的 3 行是 SC2 的遗留。** 见 §4：三行都在冻结的 `.scale.test.ts`，且 `sc-r1-base` 上已存在；本次 16 个文件没有一行。按 R-SC-3 不改；如果 lead 认为该项必须清零，需要另行授权改这两个规模文件的 import/常量（不涉及用例内容），本轮没有动。

HANDOFF：无。26 行全部完成；close-out 的测试、move check、规模文件 diff、38 项计数全绿，唯一未达标的是上面第 4 条那 3 行 SC2 遗留的 unused-local。
