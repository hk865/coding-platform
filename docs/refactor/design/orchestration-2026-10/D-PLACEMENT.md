# 任务 D 重算用：新东西放在 WorkGraph 的哪一层

**先说清楚：最终的拆分方案，要等简化阶段删掉走不到的代码之后再重算（决定 34）。** 本文件只给重算用的输入：新东西要的位置、10-02 方案里哪些还成立、哪些要改、HEAD 上还有哪些环、重算时要查什么。它本身不是拆分方案。

- 基线：HEAD `42604b3`。只读代码和文档，没有构建、没有跑检查器。
- 数字来自本轮结构调查（`understand/structure.md` §2.4）。它用一个 grep 脚本数 import，先在 10-02 的代码上验证过，和当时的证据一致（34 条目录边、55 个环）。逐条引用数是粗数。
- 标记：【已定·决定 N】、【已定·文档】、【之前的建议】、【本草案提议】，含义同 STRUCTURE-DRAFT.md。
- 术语：
  - **子模块** = WorkGraph 里的一个目录（或单个根文件），任务 D 给它们定上下层，上层可以依赖下层，反过来不行。
  - **环** = 几个目录互相依赖。**C1–C55** 是 10-02 证据给 55 个环的编号，例如 C55 是 sessions → tasks → sessions。
  - **汇点** = 只被别人依赖、自己不依赖 WorkGraph 里任何目录的那一层。
  - **M1–M17** = 10-02 拆分方案里编了号的 17 次文件搬移；**X1、X2** = 额外的文件拆分（X2 是本稿新提的）。编号和内容见 TARGET-DAG §4、§5。
  - **L0–L7** = 层号，数字越大越上层。**L5.5** 表示插在 L5 和 L6 之间的新层，不改原来的编号。

---

## 1. HEAD 上的情况

| 项 | 10-02（`a22ad30`） | HEAD | 出处 |
| --- | --- | --- | --- |
| WorkGraph 文件 / 行数 | 81 / 37,322 | 103 / 59,270 | `wc -l` |
| 其中 `state/` | 0 | 13 个文件，13,837 行 | 任务 A 新建 |
| 目录之间的依赖边 | 34 | 41 | `work/wg-graph-HEAD.txt` |
| 目录级基本环 | 55 | 76 | 同上 |
| 互相依赖的一大团 | 9 个目录 | 同样 9 个目录（除 `state` 和根文件外全部） | 同上 |

- **新增的 7 条目录边都顺着 10-02 方案的方向**：tasks、evidence、queries、sessions、communication 依赖 `state`；evidence 依赖 persistence；evidence 依赖 communication（只是类型，M10、M11 之后两者都在 `model/` 里）。
- `state/` 不依赖 WorkGraph 的任何目录，是个汇点，和 10-02 方案的假设一致。
- **WorkGraph 没有公开入口文件。** 外面直接引用它的内部文件：33 个文件里 209 处。组合层 67 处，Host 62 处，AgentRuntime 52 处，Workflow 28 处。

## 2. 新东西要的分层

【本草案提议】，在 TARGET-DAG §1 上扩展，和 STRUCTURE-DRAFT §6.2 一致：

```
L7    views（新）        读模型：悬停卡数据、节点详情、工作线、状态词、决定队列、足迹、冲突提示的输入、按时间读任务状态、活动日历、消息状态
L6    evidence  communication
L5.5  notes（新）        注记、当前理解指针、失效判断
L5    tasks  source-authority-reader
L4    queries
L3    sessions  source-authority-ports
L2    configuration  materials  architecture
L1    persistence
L0    model  state（纯）
```

和本轮第一份结构调查的区别：**没有 `decisions` 子模块。** “请你决定”走消息，不另建记录（STRUCTURE-DRAFT §0 第 5 条，理由见 `drafts/COMPARE.md` D1）。如果 lead 以后改成单独的决定记录，就按调查原方案放在 L1.5，只依赖 `model`、`persistence`，只存引用。

### 2.1 放置规则

【之前的建议】（`understand/structure.md` §4.1）。
- R1：agent 工具不调用 Workflow。只写事实，或调用 AgentRuntime 自己的动作（例如建 Session、换手）；后续由 Host 叫 Workflow 处理。
- R2：WorkGraph 不读 Kernel 的历史和进程事实。要用的（例如 Run 改过哪些文件、每小时的步骤和编辑次数）由 AgentRuntime 在 Run 结束时取出，再交给 WorkGraph 存。
- R3：既要图上事实、又要当前文件、还带取舍的读取（冲突提示）放 Workflow；只读已存事实、不带取舍的放 `views`。
- R4：把很多结构拼在一起的读取（卡片、状态词、工作线、时间竖条、决定队列）只放在最上层 `views`。
- R5：某个子模块要在自己的提交里写一种记录，这种记录的 owner 就必须在它下面。例：检查通过的那次提交在 `evidence` 里，要同时让语义修补生效，所以 `notes` 在 `evidence` 下面。

### 2.2 小件放哪

【本草案提议】
| 新东西 | 子模块 | 为什么不放别处 |
| --- | --- | --- |
| Session 的来历、负责关系转移 | sessions | 都是 Session 自己的事实；来历由 sessions 在建 Session 时自己写 |
| 按 Session 找 Run 的索引；Run 改过的文件、每小时计数 | tasks | Run 的写入方在 tasks。“等回复”“最近一次工作执行”从这个索引读出来，不在 sessions 上另存一份（STRUCTURE-DRAFT §3.2） |
| 消息新字段、“请你决定”、到期、处置、落实；按“工作区 + 状态”的索引（决定队列和消息消费共用） | communication | 都是消息自己的事实。落实在改动提交之后另写一次，因为 tasks 不能写 communication |
| 目标的自治级别、顺序、“等前一个” | 编解码在 persistence，写入在 tasks（目标控制） | 和现有目标期望状态同一处 |
| “未采用”的写入者；精确输入的消费时检查 | tasks | 候选计划和 Run 入口都在 tasks。读上游产物走 `tasks → materials`（已允许），materials 不读计划 |
| 状态词的计算；注记状态机；“这次换手要不要你决定” | state | 纯函数，只用 `src/contracts` 里的类型；工具和 Workflow 共用 |
| 注记、当前理解指针、失效判断 | notes | 新子模块 |
| 注记的“需复查”“作废”“该更新了” | notes，读的时候算 | notes 在 tasks 上面，可以读任务状态；tasks 取消任务时不用写注记，所以不需要 `tasks → notes` |
| 审阅者和精确输入读产物 | materials | 保留 Host 读取、“读自己的材料”两条路；加一种由 tasks 核对过计划的受信任读取。删授权时别删前两条（§9） |
| 所有拼起来的读取 | views | 规则 R4 |
| 换手动作：建或选接任者、转负责关系 | AgentRuntime，调用 sessions | 工具、界面、Workflow 共用这一份，不写两遍；符合 AG6（动作归 Runtime） |
| 归档前处置、换手之后的事（归档旧的、给接任者派工） | Workflow（不在 WorkGraph） | 放 sessions 要读任务状态，会形成 `sessions → tasks` 的环（C55） |

## 3. 要加的子模块和边

在 TARGET-DAG §8 的基础上【本草案提议】：

| 新边 | 为什么 | 为什么不成环 |
| --- | --- | --- |
| tasks → architecture | 检查任务的“所属模块”是否真的存在；计划足迹 | M12 把 `architecture → tasks` 去掉后，architecture 只依赖 model、persistence |
| notes → model、state、persistence、architecture、sessions、tasks | 用现有的读取核对锚点；注记状态机在 state | L0–L5 里没有谁依赖 notes |
| evidence → notes | 检查通过的那次提交里，语义修补随架构修订一起生效【已定·决定 21“一起生效”】 | notes 不依赖 evidence 和 communication |
| views → 下面所有子模块 | 拼起来读 | 没有子模块依赖 views |
| 可选：model → state | 只在第 6 节的“修法 B”时需要 | state 是纯的，不依赖 model |

`notes → state` 是这次比较时补上的：本轮“复用优先”草稿的边表里漏了它（`drafts/COMPARE.md` 末尾）。

**写入时机：** 检查器要求声明的子模块路径必须存在（TARGET-DAG §8“写入时机”）。所以任务 D 只声明现有的 13 个子模块；`notes`、`views` 等第一个文件落地时再声明。重算时要把这两个位置和上面的边记下来，保证 D 选的顺序不会挡住它们。

## 4. 必须一直禁止的方向

前 3 条来自 TARGET-DAG §9 第 5 点【已定·文档，待 D 实施】；其余是本轮结构调查加的【之前的建议】：
- persistence 依赖任何领域子模块；
- sessions、queries 调用 tasks 的服务；
- tasks 调用 evidence、communication 的服务；
- sessions 依赖 tasks、queries、communication（否则状态词、归档处置会把环带回来）；
- tasks、sessions、queries 依赖 notes（所以修补的“作废”在 notes 里读时算，不由 tasks 写）；
- materials 依赖 tasks（M1 要断它；精确输入的计划核对放 tasks，不放 materials）；
- 任何子模块依赖 views；
- state 依赖 `src/contracts` 以外的任何东西（`module-target.json:7-9`）。

## 5. 10-02 方案里仍然成立的

TARGET-DAG（`docs/refactor/reviews/evidence/workgraph-split-2026-10-02/TARGET-DAG.md`）：
- 13 个子模块和它们的上下层（§1、§2）。新子模块只是插进去，不改原来的顺序。
- queries 在 tasks 下面（§3 第 1 条）：tasks 读已答复的查询来采用候选计划，这个方向在 HEAD 上仍是真的。
- `state/` 是根目录下单独的最底层（§3 第 2 条）。
- persistence 只依赖 model（§0）。
- M1–M17 这 17 次搬移和 X1 拆分仍然切得断原来的边。在 HEAD 上模拟，233 条跨子模块引用里只有 2 条被拒（第 6 节）。
- 运行时不注入端口（§5）。
- 不在旧路径留转发文件（§9 第 3 点）。
- 以后加依赖的禁令（§9 第 5 点）；`persistence → state` 要用户确认后才能加，这一条也仍然有效。

## 6. 必须改的

| # | 要改什么 | HEAD 上的证据 | 建议 |
| --- | --- | --- | --- |
| 1 | 22 个新文件没有归属，检查器会报“未归属” | `state/*` 13 个；`persistence/rework-codecs.ts`；`sessions/session-health.ts`；tasks 下 7 个（entry-plan-reader、goal-control、reconcile-intents、reconcile-reads、requeue-service、run-reconcile-contracts、run-reconcile-service） | 各归本目录：state → state，rework-codecs → persistence，session-health → sessions，7 个 → tasks。它们都没有向上的引用 |
| 2 | 被拒引用一：`tasks/plan-contracts.ts:19` 以类型方式引用 `state/goal-machine.ts`（目标显示、恢复接续、控制能力三个类型）。M6 之后变成 `model → state`，而 model 不许有依赖 | `work/target-sim-HEAD.txt` | 修法 A【之前的建议，本稿采用】：把这三个类型移到 `src/contracts`。它们是接口形状：`goals/display` 接口返回它们，Host 有 3 个文件直接引用 `state/goal-machine`。修法 B：允许 `model → state`，也无环 |
| 3 | 被拒引用二：`evidence/contracts.ts:42` 以类型方式引用 `tasks/plan-write-admission.ts`。M11 之后变成 `model → tasks` | 同上 | 在 M11 之前做一次拆分（X2）：把证据服务的依赖类型留在 `evidence/`，其余移进 `model/` |
| 4 | TARGET-DAG §8 写“state 需要时可以依赖 model” | `state/` 现在是纯目录，只能依赖 `src/contracts`（`module-target.json:7-9`；`scripts/check-boundaries.mjs:427-431`） | 删掉这句 |
| 5 | §7 大文件拆分的行号全部过期 | 计划服务 2,130 → 2,764 行；邮箱服务 2,069 → 2,262；执行入口 1,696 → 1,965；证据服务 1,118 → 1,898；计划读取 1,343 → 1,644；查询执行 1,494 → 1,639；Session 目录 1,571 → 1,606；领取服务新过 1,000 行（1,034）；另有 `state/run-machine.ts` 2,335、`state/verification-machine.ts` 1,747 | 删减和状态机瘦身之后重算 |
| 6 | import 改写量 | WorkGraph 外：原估 22 个文件 84 行，现约 26 个文件 106 处（app 36、agent-runtime 33、workflow 21、组合层 16）。测试没有数 | 删减后重数；测试一起数 |
| 7 | 新位置没有预留 | §2、§3 | 重算时记下 notes、views 的位置和边 |
| 8 | 有些旧边更密了 | tasks → communication 从 1 对文件变成 7 对；tasks → evidence 多了计划读取、核对读取、运行状态三处 | 同样的 M10、M14、M17 仍切得断；重算时确认 |

## 7. HEAD 上仍在的环

一个 9 目录的大团，76 个基本环。其中 8 个是两两互相依赖。下表写每个环靠哪次搬移断开（搬移编号见 TARGET-DAG §4）：

| 两两互相依赖 | 要断的方向 | 靠什么断 |
| --- | --- | --- |
| tasks ↔ communication | tasks → communication | M17（消息编码移到 sessions）+ M10（通信契约移到 model）；现在有 7 对文件，M10 也是必需的 |
| communication ↔ queries | queries → communication | M10 + M17 |
| tasks ↔ configuration | configuration → tasks；tasks → configuration | M1；M7（+ M2、M3） |
| tasks ↔ evidence | tasks → evidence | M14（证据编码移到 persistence）+ M16 |
| tasks ↔ materials | materials → tasks | M1。删减时去掉材料授权的写入部分，可能连这条边一起消失（这条边只来自 `materials/grant-contracts.ts`、`grant-service.ts`） |
| tasks ↔ persistence | persistence → tasks | M2、M3、M5、M15 |
| tasks ↔ queries | queries → tasks | M1 + M13 |
| tasks ↔ sessions | sessions → tasks | X1（`sessions/session-directory.ts:68` 引用的运行解码移到 materials） |

另外三条也要断：`architecture → tasks`（M12）、`evidence → materials`（M8 + M11）、`evidence → communication`（新出现，只是类型；M10、M11 之后成为 model 内部引用）。

模拟结果：17 次搬移 + X1 之后，只剩第 6 节的两条被拒引用；修掉它们、给 22 个文件归属之后，才可能回到“零违规”。这个结论要在删减后的代码上重新验证。

## 8. 重算必须检查的

1. 在删减后的代码上重新生成 import 图，确认环的个数和那一大团。
2. 每个 WorkGraph 文件都恰好属于一个子模块，包括 `state/*` 和另外 9 个新文件（第 6 节第 1 行；检查器对未归属的文件直接报错）。
3. 跨子模块引用零违规，**类型引用也算**；两条被拒引用已修。
4. `state/` 仍然只依赖 `src/contracts`。
5. 预留的 `notes`（L5.5）、`views`（L7）和第 3 节的边，都不会被 D 选的顺序挡住；特别是 M12 之后 architecture 不再依赖 tasks，这样 `tasks → architecture` 才能加。
6. 第 4 节的禁止方向都还成立。
7. 新东西写进 sessions 的字段只有“来历”，由 sessions 自己在建 Session 时写；“等回复”从 tasks 的索引读。都不需要 `sessions → tasks`。
8. 大文件拆分按新行数重算；先确认状态机瘦身是否在 D 之前做。
9. WorkGraph 外的 import 改写量和测试里的改写量一起数，给 DSH 的逐文件搬移表按这个量切分（决定 32：先测 DSH 的上限）。
10. 纯搬移的验收不变：测试数相同，测试只改 import，导出集合不变，边界检查通过（决定 32）。

## 9. 先删后拆，会改变拆分的几处

【之前的建议】，最终以删减结果为准：
- 删材料授权的写入部分【已定·决定 6】：`materials → tasks` 可能消失，M1 的一部分理由跟着变。（2026-10-07：已按决定 34 随简化删除：写入部分 G1，060e7696；只为授权存在的读取分支 G3，77b517a2。`materials → tasks` 这条边已经没有了：`core/work-graph/materials/` 下没有文件 import `../tasks`。）
  - **要留下的两条读取路**【本草案提议】：`materials/applicability.ts` 里的 Host 读取（第 40–86 行）和“Run 读自己的材料”（第 93–98 行）。独立审阅者读被审 Session 的原历史要靠前一条（STRUCTURE-DRAFT §1.7）。只删靠授权的分支（第 100–128 行）。（2026-10-07：照此保留，G3 77b517a2 只删了靠授权的分支；两条现在是 `applicability.ts` 的 `hostAdmission`（第 34 行起）和 `runAdmission`（第 82 行起），行号已变。审阅者读原历史改走 AgentRuntime 的原历史读取，不靠这里，见 DESIGN.md §2.9。）
  - **精确输入的读取要先定去留**：`tasks/plan-service.ts` 的 `readTaskInput`（第 1704–1763 行）以“当前”方式读产物，只有授权能满足，所以在“只有授权才能满足的读取分支”这张删除清单上。可它对应的“消费时检查精确输入”仍是 MVP 项（决定 11）。lead 在简化前定：删掉，第 3 片按 STRUCTURE-DRAFT §1.6 重做；还是留下，改接新的受信任读取。同一组的还有 `tasks/execution-entry-service.ts:640-664` 和 `agent-runtime/execution-preparation.ts:413-433`。（2026-10-07：lead 定了删掉（lead 决定 LA-11），已按决定 34 随简化 G2 删除，d596ed18：`readTaskInput`、执行准备里的读取、入口和模型调用前的外部材料准入一起删了。计划里的 `inputRequirements` 字段保留，带它的计划现在照常启动、不带这份输入。第 3 片按 DESIGN.md §2.8 重做“消费时检查”。）
- `apply_future_plan` 工具：本草案不授予 agent（STRUCTURE-DRAFT §4.3），它在生产上本来就没授予 [src/app/host.ts:509]。是删除候选，lead 定。在 AgentRuntime，不影响 WorkGraph。
- 没有写入者的引用类型：`HandoffPacketRef`（`src/contracts/handoff.ts:5-11`）、`ExecutionNoteRef` 和 `ContinuationRecordRef`（`src/contracts/context-continuity.ts:12-25`）。本草案的换手和注记都不用它们，可以删。它们在 `src/contracts`，不影响 WorkGraph 的环。（2026-10-07：已按决定 34 随简化 G6 删除，255442b9；`handoff.ts` 整个删掉，`context-continuity.ts` 只剩 `WorkContextRef`。）
- 旧的决定记录类型 `UserDecisionV1`（`src/contracts/goal-change.ts:153-196`）和计划状态机里引用它的拒绝分支：本草案用消息表示决定，用不到它。**lead 接受 COMPARE D1 之前先别删。**
- 一段永远不会执行的“已消费回复”分支（`src/core/agent-runtime/execution-preparation.ts:440-443`）。在 AgentRuntime，不影响 WorkGraph。（2026-10-07：已按决定 34 随简化 G2 删除，d596ed18。）
- 要保留的（本草案会用）：角色规格；架构目录修订、比较、影响分析的端口；审阅者契约；输入来源里的“记忆”类；查询的“关注哪些任务”；重新入队的历史来源；消息上的咨询派生。

## 10. 不属于任务 D 的

- Workflow 的 6 个设计文件是下一阶段的事，D 不碰 `workflow.ts`、`consultation.ts`。
- WorkGraph 的公开入口文件：建议在 D 之后做，让 D 保持纯搬移。设计好的公开入口不是 TARGET-DAG 禁止的“旧路径转发”。这是 lead 的取舍，不涉及产品行为，所以没放进问题清单。
- 新的编排规则放 Workflow，不继续加在 Host 驱动里。Host 现在有 2,369 行驱动，Workflow 2,108 行；检查器允许 Host 引用任何文件，规则放 Host 就脱离了边界检查。这也是 lead 的取舍，不问你。
