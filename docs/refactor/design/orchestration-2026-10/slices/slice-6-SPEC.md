# 第 6 片规格：主对话上的秘书（服务端）

**后注（6A-1 合入，lead 2026-10-24）：** 6A-1 合入 lead 分支（`f32a9eeb`，10-24）。正文原样保留；施工中定下的读法按 HANDOFF 决定 88 和 6A 任务书 §3 读，会影响本规格读法的几处：
- **索引：** 不建 `s6-query-queued-by-session`；`s6-query-unassigned` 是 `s6-query-open-by-workspace` 的 `pending` 分区上的具名读取（每条再用请求事实复核），不是一张索引；新增 `s6-query-open-by-workspace`、`s6-query-ran-by-session-goal`。§0.3 L2 的 `s6-query-by-request` 照建；6A-3 的主对话分页用 `s6-request-roots-by-goal`。
- **索引槽：** 槽位由编解码从快照推出，解码时再核，不由状态构造器写（L6）；6A 任务书 §3.2 的“槽位由状态构造器写”按此读。
- **请求事实：** `waitReason` 加 `owner_archived`；`assignment` 只有 `owned` 是 `assigned`；归属取最后一个承载归属的轮（6A 的 `routing` 轮都承载归属）。已归档秘书的接任者是来历为 `handoff`、仍在的 Session（FP-01）；没有则 `owner_archived`，排空按新请求重挑。
- **秘书配置：** `forSession` 取这个工作区的第一个 `sessionRole` 等于该 Session 职责的查询配置，不做职责判断（L1）；“是不是秘书”由职责解析器在一次准入检查里判（L7）。新线的角色取 `forNewLine`（第一个职责是秘书的配置）；没有 → `submit` 回 `unavailable`、原因 `no_secretary_binding`、不建线。
- **计划：** `RequestPlanV1` 加 `capacityBlocked`；一个纯函数 `requestAssignmentRow` 判“跟随归属 / 等待 / 挑 / @ 收件人”（L2）。计划说“不挑”而事实要挑 → `revision_conflict`（原因 the request changed since the plan），Workflow 在挑秘书的重试里重新计划；被名额挡住的挑让轮等待。
- **冲突：** 新挑时 intake 或 Session 版本冲突 → `revision_conflict`（Workflow 换人重挑）；`@` 收件人遇到同样的冲突 → `busy`；请求尾或事实冲突重读重试到 `SECRETARY_TAIL_RETRIES`，再不行 `busy`（L3）。对显式收件人，复核时发现不可接收，回那次拒绝（`unavailable` 带原因；重试也不会成功）；`busy` 只给“变了但仍可接收”的显式收件人（10-24 的 P2-01）。
- **读失败：** `unassigned` 和排空里的读失败（事实、挑人、配置、线）一律 `unavailable`，不当 `blocked`；只有 `no_secretary_binding`、`line_pending`、被名额挡住的挑、`assigned` 落盘的冲突算 `blocked`（L4）。
- **结束：** 放下或 `end_unbound` 结束所有没进入 Kernel 的轮（含已领取、已准备），同一次提交释放那个 Run 仍占的占用；`QueryExecutionRecorded` 事件带写下的 Run，只有 pending 结束是 null（L9）。
- **最老排队轮：** `oldestPendingRound` 在 `request-rounds-read.ts`；`RequestRoundsFactsV1` 加 `lastOwner`（L10、L11）。
- **排空和 `ask`：** `drainUnassigned` 是 Workflow 注入端口上的方法，`maxRequests` 必需（L12）；6A-1 不在端口上开公开的 `ask`，6A-3 和公开输入一起加（L13）。
- **选思路：** `selectIdea.index` 从 0 起；P-01 的“第二个 … index: 2”读作 index 1。
- **放下（用户 10-23，选项 (a)）：** 放下结束这个请求所有没进入 Kernel 的轮（排队、已领取、已准备）；已进入的跑完并保留回答；QRR-01/02 在放下覆盖的轮上把它关掉；之后的新轮是一次新挑，只处理新的话。S6-Q-02 的“排着的轮不动”只对转交成立。
- **启动扫描和 intake（R-09）：** 不做启动时的 intake 扫描，也没有 held-intake 索引；“启动扫描释放已终态轮的认领”读作不变量：没有终态轮还持有 intake。
- **两处行为变化：** 排空挑中的秘书在复核前被归档，回 `blocked`（下次排空重挑），不是 `unavailable`；配置或线的读取不是 `ready` 时一律 `unavailable`（intake 和服务里等配置的那处都是）。

经过见证据（已归档：`D:\1.project\Software\agent-next-archive\docs\refactor\reviews\slice6a1-2026-10-24\`）。

**后注（决定 86-2，lead 2026-10-21）：** 旧浏览器工作台 `src/ui` 已删（代码在标签 `old-ui-last`）。本规格里点名它的地方说的是删除之前的代码：
- F6 的浏览器查询流程（已在表里补注）。
- “人工采用入口”（§0 的初始化分支、§3 的 L8、§4 第 13 条、§5 的 R-14）指旧界面 `ui/views/execution/planning.ts:274` 的 `adoptInitialPlanSetup`。它不是一条路由，而是浏览器把一串后端路由串起来：`workspaces/registration`、`architecture/read`、`architecture/adopt-initial`、`completion-policies/read`、`completion-policies/install`、`completion-policies/activate`、`checks/approve`、`workflow/goal-input`。这些路由都还在，串它们的代码随旧界面删了。“采用仍是你的动作”不变；由谁来串（新界面，还是服务端一个组合动作），lead 在 6A 冻结前和决定 83 那一节一起定（决定 86-5：有能力，也要有入口）。
- §1“界面（E3）；旧界面的主对话照旧”：旧界面已没有；主对话的人用入口随 E3。

**后注（决定 83-4，lead 2026-10-21）：** 下面那条后注说的“提示词和上下文”一节已冻结：[slice-6-7-PROMPTS-SPEC](slice-6-7-PROMPTS-SPEC.md)。提示词和上下文以那一节为准，本片别的行为不变。和本片有关的：
- **秘书接它 Session 的完整历史（P6）。** L8 的“这个请求以前的轮次”只补跑在**别的** Session 上的执行轮（最多 10 轮，回答各截到 2 KiB），跑在本 Session 上的已在历史里，不重复；合批的同请求输入按原文全放。
- **6A：** `secretary-round`、`secretary-answer` 两个模板，用那一节的模板包和渲染器，放在守卫给秘书定的段里，不加新段。
- **6B：** L10 换手不写 `sessionBasis`，前任按 `handoff-write-understanding-secretary` 写当前理解，接任者拿 `handoff-brief-secretary` 简报加记忆指针和工具（P7）；R-14 的采用改由 Host 一个组合动作串，6B 开工前 lead 补一份、经 Codex 审后冻结（P11）。
- 秘书自己觉得不匹配就转给新秘书：不加（那一节 §0.1 第 5 条）。
- 6A 之前先做结构一轮（含 D3）和 PC-1、PC-2（那一节 §5）。

**后注（决定 83，lead 2026-10-18 晚）：** 本片冻结后要补一节“提示词和上下文”：秘书、派活、等待、转交、干预的提示词做成可配置的模板，按提供方和型号选版本，不写死在代码里；超长时保住当前任务和角色说明；思考带不带回按模型定；记下每次实际发出的整套提示词。见 [HANDOFF 决定 83](../../../HANDOFF.md)。这一节在 K3、C1、T 之后由 lead 起草，冻结后再开 6A；在那之前不要按本稿施工提示词部分。

**后注（决定 72 的复用盘点，lead 2026-10-16 夜）：** Codex 把第 6、7、8 片和 K3、4C 剩下的部分放在一起找共用机制，两个 Claude 子 agent 逐条核过引用和代码，lead 裁定。和正文冲突时以本后注为准；产品范围不变。和本片有关的：
- **请求的轮（L3–L5）：** 6A 建一个共用入口，下面复用已有的 Query 阶段驱动，支持“同一个 Job、旧的 Run 放弃、新开一次 Run”。7B 只给它回复和到期的输入；7D2 的探索 Query 复用下层驱动，不进请求模型。未分配队列用几个索引、什么形状，在 6A 的施工计划里定（还没定）。
- **建线（L4、L10）：** 6A 建一个共用的建线入口，包在 Runtime 两段式建 Session 外面：身份、固定职责、范围、建者、原因，加上占保留名额那一步。6B 的接任者、7C 的建成员、7D2 的角色线都调它；第 7 片 §1 的保留名额填进这一步。名额满了 6A 会不会卡住（6B 之前还没有换手和闲置归档），在 6A 的施工计划里定。
- **换手（L10）：** 6B 的共用换手原语一开始就用第 7 片 L18 的通用身份：一个 `kind: 'handoff'` 的 `SessionOperation`（源、`assignments`、各阶段标记），建接任 Session 是它的子操作；秘书换手 = 交给一条新线，再加请求 `routing` 一步。L10 的“换手身份 = 接任 Session 的创建操作”按此改读。各处阶段顺序统一为：查理解 → 围栏 → 等旧写者停 → 建或选接任者 → 转负责 → （秘书）`routing` → 归档 → 请知悉。
- **闲置归档（L15）：** 秘书、参谋、书记用同一个钟：从最后一次活动（模型轮结束、收到要处理的消息、你对它的操作、建线；请知悉不算）算起满一天，这就是决定 60-8 的“闲满一天”。L15 的“最后一个新请求满 1 天”按此读。每种职责留一条最近用过、可用的线。
- **没有目标时的初始化（L8、L11、§6、§7）：** 按绑定 `InitializationBindingV1` 做的提议、采用和计划读取（`plan-service.ts:1147`、`initial-plan.ts`）挪到写绑定的 6B 做，R-14 的提议和采用部分在 6B 验收；7D2 的冷启动和 6C 复用。§7 里“6C 收口”按此改读。6B 的说明书若发现前提不够，报给 lead 再定。
- **“请知悉”和卡的主体：** 6B 给项目范围的秘书换手发请知悉（L10 第 7 步）是第 4 片之后第一个要用“目标或项目”主体的地方。所以通知和卡的主体底座（goal | project，不含跨工作区的答复身份）在 6B 做，按第 4 片推迟的两种用法（§11.4、§11.6：书记改写你的项目理解时的请知悉、不挂目标的待审注记卡）和第 7 片的用法一次设计好；7D1 只加跨工作区的身份。
- **活动（L16）：** 日历和轨道里各有一份的活动分类函数，在清理第一轮（决定 70，VW-3）合并；6A 在合并后的上面做，不再合一次。
- **唤醒（L5）：** 6A 抽出最小的“提交唤醒 + 有界排空 + 启动重建”循环；7B 加派生等待和到期输入，7D2 注册自己的队列排空。各队列的排序规则仍各管各的。
- **记忆装配（L8）和主对话（L6）：** 4C-2 的记忆材料函数在类型上允许没有目标；没有目标的分支在 6A 实现和测试。主对话的请知悉折叠用 4C-2 的共用汇总投影，已读只推进真正展示过的条目。
- **§0.4 的 2B 一条已改正：** 秘书的查询也计数（L16），原写“不计数”作废。

> **2026-10-15 晚：按决定 60、61、62 和 7D 第二稿改了挑秘书的范围、初始化分支、初筛和排队、复制挪责任；冻结前 lead 逐行审；又按 7D 勘误 E1–E11 和决定 63 改；又按审查二（19 条）的 lead 裁定改；lead 逐行审过这一稿，补的地方标“审查二 lead 补”；Codex 最后一次快速核对的必改由 lead 改完（标“审查二快速核对第 n 条”）；经你同意又加了一次只看改动的额外核对，它的必改由 lead 改完（标“审查二额外核对 Dn”）。**已冻结（2026-10-15 晚，你确认了测试入口）。**
> **状态（2026-10-15 凌晨）：内容定稿，等你定 §0.1 后冻结。** Codex 两次完整审查加一次快速核对都用完了（决定 56 的上限），最后一次结论“改完后冻结”，那几处已照改（标“最后核对第 n 条”）。冻结前 lead 还要通读全稿一遍。下面原来的状态说明保留作记录。

> **状态：lead 第一稿 + 第一轮审查改稿，2026-10-15 夜。** 按决定 58，和第 2 片的施工并行起草。
> - Codex 第一轮审查 12 条已并入；改动行标 `（第一轮审查第 n 条）`。Codex 第二轮审查 9 条已并入（2026-10-15）；改动行标 `（第二轮审查第 n 条）`。冻结前还要：你定 §0.1 的几件事；lead 在 2B、2C、第 4 片合入后的基线上重核 §0.2 和 §6；**6C 冻结前 lead 另写替代与切换的状态表**（第一轮审查第 8 条）。
> - 代码事实：Codex 只读事实清单（`s6facts.out.md`，HEAD 5c7a3258），lead 核过 F1、F4、F6、F9、F14。
> - 依据：HANDOFF 决定 35（Q3、Q6、Q8、Q15、Q16、Q17）、37、39、42（第 3 条）、46、48、49、50、56；DESIGN §1.1（L70–130）、§1.4、§1.6、§2.3、§2.7、§2.11（L580–595）、§4.4、§4.5、§4.11、§5.2、§8.2 第 6 行（L1249）；MODEL O19、O20、O30、O51、O53，R19–R23、R28、R32、R33、R41；MVP 行为 E08；SCENARIOS S07、S56、S58–S60、S69、S70。

## 0. 冻结说明（lead）

### 0.1 要你定的

**1. 拆成三小片（建议拆）。** 第 6 片比第 4 片还大。照第 2 片（决定 50）的做法：
- **6A 请求和秘书的执行：** 请求的归属和“还在处理”、挑秘书、请求发送、秘书的一轮由 Host 驱动（带看、找、只读命令）、主对话的读取、两个索引。
- **6B 秘书的生命周期和目标卡：** 秘书太长换手（全部未完请求跟着转）、秘书线自动归档、秘书的“记”（第 4 片的工具注册给秘书）、目标卡起草和确认、取消的目标“重新入队”复制成新目标。
- **6C 方案和按答复改计划：** 2–3 个思路、选一个出完整计划、每轮显示改了什么、按请求出候选；按你的答复改目标或验收落成新的计划版本（E08）、定下以后删掉 `UserDecisionV1`；初始化采用的补记（决定 48 从第 5 片移来）。

顺序 6A → 6B，6C 在 7D2（8D 之后）之后（6B 先做；审查二第 18 条的新顺序 `4A → 4B → 4C → 6A → 6B → 7A → 7B → 7C → 7D1 → 8A → 8B → 8C → 8D → 7D2 → 6C`）。**“可单独开工的核心”和“完整验收”分开看**（第一轮审查第 11 条）：
- **6A 的核心在 2C 合入后即可建**（线名和“等回复”读法）；完整验收还要 6A 自己的两个索引和 Host 驱动跑通。
- **6B、6C 都建在 6A 冻结的契约上**（回答、思路、目标草稿）。6B 的核心要第 4 片（4A、4C）的注记和当前理解；完整验收要 6A 合入。
- **6C 的核心在 6A 契约后即可建**（影响清单要 2B 执行改过的文件）；**6C 的完整验收另要 6B（确认、复制）和第 4 片**，消息相关要第 7 片。
- (a) **拆成 6A、6B、6C（建议）。**
- (b) 不拆。

**用户 2026-10-15 晚定：(a) 拆。**

**2. 测试入口（§5.1 的 SE1–SE6）。**

**3. 秘书查询里的工具调用算不算“一步”（2B 规格 §0.1 留到这里问）。** 2B 的活动计数今天只数执行（Work）里的工具调用，秘书的一轮是查询，不数。
- (a) **不算（建议）。** 日历和横条数的是“干活”；秘书查资料、读文件的次数另看它的线。秘书的用量（输入量）照样记，换手要用。
- (b) 算。秘书线上的横条也画出步骤；2B 的计数口径要改一处（查询也走结束时的计数），2B 已经冻结，要另开一个小改动。

**用户 2026-10-15 晚定：(b) 算，而且都算**：秘书的每一轮、角色线的探索查询、问一问的只读副本都按同一口径记步骤（用户：“这个工作其实也反映人类的参与”）。做法见 L16。界面上问一问的副本显示成被问那条线的可展开分支（E3）。

**4. 秘书“太长”的阈值。** 按最近一次模型输入量（决定 49）。建议缺省 `SECRETARY_HANDOFF_INPUT_TOKENS = 400,000`，再取实际模型容量的 80% 较小的那个；可配置。500K 只是设计里的参考（DESIGN §1.1），没实测。
- (a) **400K 和容量 80% 取小（建议）。** 留出余量，避免在一轮中间撞上容量。
- (b) 你给一个数。

**用户 2026-10-15 晚定：500K，软预算。**到了不打断正在跑的一轮，这一轮结束以后换手；模型容量更小时仍取容量的 80%（不然会先撞上容量）。常量改成 `SECRETARY_HANDOFF_INPUT_TOKENS = 500_000`；第 7 片 L29 的参谋、书记“太长”复用同一个数。

**告知（lead 的技术取舍，不用你定，你可以改）：**
1. **不建请求表**（决定 49）。请求就是“根查询”和它后面的查询；归属、转交都写在已有的查询记录上（L1、L2）。
2. **两个请求同时进来交给两个秘书**（第 6 行的验收）：挑秘书时用一个唯一认领占住“这个秘书正在接一个新请求”，第二个请求的提交撞上认领就重挑（L4）。**这个 `secretary-intake` 认领只在把新请求分配给还不是它归属的秘书时取；追问到已建立的归属不取（第二轮审查第 2 条）。**
3. **秘书发“请动手”“请回答”、待放行、回复到了开下一轮、派工核对版本都在第 7 片**（DESIGN §2.11 的分工）。本片的秘书一轮只读、只写回答、思路、候选计划和（6B 以后）注记。
4. **取消的目标复制成新目标时，“没勾的干预撤回、勾的干预等首个方案采用后转交”要第 7 片的消息处置**（R42）。本片只记下你的勾选，第 7 片落实。
5. **还没有目标时的请求**：今天查询的准备要求有目标（F5）。本片加**查询调用类 `secretary`**（不是 `copy`），由它承担没有目标的准备（L8、第一轮审查第 5 条）。

### 0.2 代码事实（5c7a3258；lead 核过的标 ✓）

| # | 事实 | 出处 |
| --- | --- | --- |
| F1 ✓ | 查询的意图带可空的 `goalId`、问题、执行绑定和预算；执行状态带 Session、代际和每次模型请求的用量（`inputTokens`）。没有“根请求”“转交”“挑秘书”的字段 | `src/contracts/query-job.ts` `QueryJobIntentV1:132`、`QueryExecutionStateV1:373`、`QueryModelUsageV1:357` |
| F2 | 候选计划的请求读取今天是过渡的：`readCandidateRequestFacts` 回 `currentSecretary: null` | `work-graph/tasks/request-facts-reader.ts:84-111` |
| F3 | “工作区 + 目标”的查询索引已有（`S5_QUERY_JOB_BY_GOAL`）；按 Session 找查询执行的索引已有；按根请求找的没有 | `queries/query-record-codecs.ts:63`、`:767`、`:773` |
| F4 ✓ | 查询执行由 `createQueryExecutionDriver` 建可信的 `query_run` 上下文，注册图工具，`readOnly: true` 调模型；K 片 B 的只读命令已能注册给查询 | `agent-runtime/query-execution.ts:218-260`、`:361-369`、`:520-546` |
| F5 | 查询的准备读不到目标就拒绝（`goalId: null` 进不了准备）；普通查询组装只认 `copy`（初始协调是 `planning`/`copy`） | `work-graph/queries/query-execution.ts` `readPreparationFacts:375-381`、`expectedQueryCallKinds:124` |
| F6 ✓ | 浏览器里的查询流程今天由界面驱动（提交、领取、准备、开始、观察）；服务端驱动只有咨询（消息专用） | `src/ui/views/execution/query-flow.ts:114-167`；`business/workflow/consultation.ts:311-481`（2026-10-21 补注：浏览器查询流程已随旧界面删除。现在没有东西从浏览器驱动 Query。） |
| F7 | 初始规划已有严格的回答格式和从规划回答到采用的 Workflow；候选的请求关联、替换位、过期、读和放弃的路由已有；保存的回答没有“思路”和“选择” | `agent-runtime/query-preparation.ts:50`；`business/workflow/workflow.ts:584-643`；`tasks/plan-service.ts:2278`；`query-job.ts` `QueryJobAnswerV1:407` |
| F8 | 计划差异：`deriveFuturePlanDelta` 给结构上的比较 | `tasks/plan-validation.ts:328` |
| F9 ✓ | 建目标只有编号、工作区、目标说明；`GoalSnapshot` 没有“接续自” | `model/task-contracts.ts:35`；`src/contracts/ledger.ts` `GoalSnapshot:53-75` |
| F10 | 建 Session 支持换手来历；负责关系转移和组合归档已有；空闲完成的自动维护只挑执行者 | `agent-runtime/session-operations.ts:20-29`；`sessions/session-responsibility-service.ts:43`；`workflow/session-maintenance.ts:639-654` |
| F11 | 按答复授权的完整计划变更明确不支持；只改未来的修订拒绝非空 `decisionRefs` | `state/plan-machine.ts:1353`、`:1390-1404`；`tasks/plan-service.ts:1629-1641` |
| F12 | `UserDecisionV1` 一族还在：`goal-change.ts`、`execution-feedback.ts`、`ledger.ts`、查询反馈的校验、决定引用的解码；`UserDecisionBodyV1`（消息正文）是另一个东西，还在用 | `src/contracts/goal-change.ts:154`、`:185`；`execution-feedback.ts:17`；`goal-decisions.ts:92` |
| F13 | 初始化的来源读取已认出初始架构、策略已存在，但落实证明的解码拒绝这两类事件（`ArchitectureCatalogAdopted`、`ProjectCompletionPolicyActivated`）；答过的合成卡停在“已答复，待落实” | `communication/decision-source-facts.ts:444-452`；`communication/decision-application.ts:59-75`；`views/decision-read-model.ts:837-847` |
| F14 ✓ | 今天没有按目标的完成标准记录：项目级只有 `CompletionPolicyRevision` + `ProjectCompletionPolicyActive`（要求种类、每必需义务的最少要求数），`GoalSnapshot`/`GoalSettingsV1` 没有完成标准字段 | `src/contracts/governance.ts:31-74`；`goal-decisions.ts:27-33`；`ledger.ts:53-75` |
| F15 | 唯一认领的提交扩展今天支持换主和释放（`expectedOwner → nextOwner|null`）；按索引找 `queued` 查询的索引还没有 | `src/core/record-store/ports.ts:85`；`sqlite-record-store.ts:254`；`in-memory-record-store.ts:341` |

### 0.3 lead 定的技术选择

- **L1 请求就是根查询（不建请求表，决定 49）。**【lead 定，待审】查询记录（`QueryJob`）加几个字段（第一轮审查第 1 条；今天写的查询都是“没有根”的旧查询，读法见 L3）：
  - `requestRoot: QueryJobRef | null`：这一轮属于哪个请求，指向第一轮；第一轮指向自己；旧查询解码为 `null`。
  - `roundKind: 'request' | 'followup' | 'reply' | 'expiry' | 'explain' | 'routing'`（O19，加 `routing`）；旧查询解码为 `'request'`。
  - `requestGoalId: string | null`：请求发出时选中的目标（第一轮定，后面的轮照抄）；旧查询 `null`。
  - `assignedSession: SessionRef | null`：**入队时就写**，写挑中的或当时的当前归属；**秘书满额没分出去时写 `null`（未分配轮）**；`routing` 轮 `null`。（审查二第 7 条）
  - `routing: { from: SessionRef | null; to: SessionRef | null; reason: 'handoff' | 'manual' | 'archived' | 'dropped' | 'assigned' } | null`：路由轮用它表示显式转交；`assigned` 是未分配请求排空时平台写的取得归属轮（`from: null`，L4；审查二 lead 补）；只补 `goalAttribution` 的 `routing` 轮（L11）`routing: null`，这种轮**不算归属轮、不碰归属，普通转交不改有效目标**（第二轮审查第 1 条）。**`to: null` 表示放下，`reason: 'dropped'`**。
  - `relatedMessageRef`：`reply`、`expiry` 轮对应的消息（第 7 片用）。
  - `since: CommitCursor`：这一轮的创建游标，绑在它自己的创建提交里，写死不改。
  - `absorbedInto: QueryJobRef | null`：被合成进某个执行轮时指向它（L5）。
  - `selectedIdea: { round: QueryJobRef; index: number } | null`：**选择存在它派生的 `followup` 轮上**，不改回答（L7）。
  - `goalAttribution: string | null`：确认草稿那次提交给没有目标的请求补的有效目标（L11）；请求的有效目标取最新的非空 `goalAttribution`，否则取 `requestGoalId`（第二轮审查第 1 条）。
  - `relatedCardRefs: VersionedRef[]`：卡片上“问秘书”“重出”带的对象/版本引用（L6）。
  - **`routing` 轮的构造规则：** 创建时就是终态，`runRef: null`、`status: 'closed'`、`closeReason.code: 'not_entered'`；读投影为 `ended`。它不跑模型、不占 Session、不建 `QueryRun`。
- **L2 两个索引（附录 C 第 11 个“查询按所属请求”；第 10 个“按工作区 + 目标”已有，F3）。**【lead 定，待审】
  - `s6-query-by-request`：（项目、工作区、根查询键），读一个请求的全部轮次按 `since` 顺序（2A 的按顺序查找）；根查询键就是第一轮的 `QueryJobRef`（canonical key）。
  - `s6-query-queued-by-session`：（项目、工作区、`assignedSession` 键、状态）；Host 启动时扫它找 `queued` 轮（L5、第一轮审查第 4 条）。**另加 `s6-query-unassigned`（项目、工作区、`assignedSession` 为 `null`、状态），用 QueryJob 索引读未分配队列，按稳定顺序（提交时间、请求键）读；排空触发是秘书的一轮结束（变空闲）、秘书空出名额、上限调高、Host 启动**（审查二第 7 条）。
- **L3 归属和“还在处理”（R19，读的时候算，不存）。**【lead 定，待审】
  - **归属**：按 `since` 顺序读这个请求的轮次，只看普通轮和 `routing` 非空的 `routing` 轮，取最后一个；是 `routing` 轮就取 `routing.to`，否则取它的 `assignedSession`／Session；`to: null`（放下）＝没有归属。只补 `goalAttribution` 的 `routing` 轮（`routing: null`）不参与归属（第二轮审查第 1 条）。换手（L10）也写 `routing` 轮。旧轮完成得晚不改归属（按创建顺序，不按完成顺序）。
  - **有效目标**：取最新的非空 `goalAttribution`，否则取 `requestGoalId`；普通转交不改它（第二轮审查第 1 条）。
  - **接任锚**：归属的 Session 已归档时，按 Session 的换手来历（`接手自`）找接任者；没有接任者 → 按 L4 另挑。
  - **还在处理**：下面任一项为真：(1) 有 `queued`/`running` 的轮，或已排队的轮（`assignedSession` 非空且未 `ended`）；(2) 秘书为它发的“请回答”没回、没到期、没撤回（第 7 片以前恒为假）；(3) 它要发的消息在待放行（第 7 片以前恒为假）；(4) 它的候选计划在等你采用，含过期的。
  - **秘书在等**：归它的、还在处理的请求里，有它发出的未完“请回答”（DESIGN §1.1 L97）。
  - 旧查询（没有 `requestRoot`）各自算一个只有一轮的请求，归属是它自己的 Session（`assignedSession` 从执行状态回填）。
  - 读这些用一个共享的 `RequestFactsPort`（替换 F2 的过渡读取），给挑秘书、候选卡、主对话、归档和第 7 片用。
  - **归属守卫（第一轮审查第 2 条）**：每次给一个请求加轮（含 `routing`）的提交，都搬一个唯一认领 `request-tail:<根键>`：从这次读到的“请求最后一轮”的键，搬到新轮的键。提交扩展用 `expectedOwner` 带上读到的旧主；冲突 → 重读再试，**最多 3 次**，再不行回 `busy`。所以一个基于旧事实的追问轮不能抢回已经转走的归属。
- **L4 挑秘书（R20）。**【lead 定，待审】
  - 同一请求的后续轮：交给当前归属的秘书；忙也排队在它上面；它已归档又没有接任者 → 按新请求挑。**排队的轮保留入队时的 `assignedSession`；Host 在开始那一刻跑在“当前归属”上**（改归属只经 `routing` 轮，绝不改写旧轮，第一轮审查第 2 条）。**入口检查（第二轮审查第 3 条）**：开始那一刻在提交里原子核对被认领的 Session 仍是当前归属、且没有持有换手围栏；不满足 → 这次没进入的尝试走已有的“没进入就释放”放掉占用，`QueryRun` 身份留着记为已放弃，在**当前归属**上另起一次尝试。所以认领 A 之后转给 B、再开始的交错会放弃 A 上那次、在 B 上重开（R-13）。
  - 新请求：**秘书的范围是过滤**——只有负责范围包含这个请求有效目标的秘书是候选（目标范围就是它，或项目范围；7D1 的 `RoleScopeV1`/`responsible` 链接，7D1 L23）；你给某个目标单开的秘书只接这个目标的请求；有效目标是 null 的请求只有项目范围的秘书是候选。候选还要职责是秘书、没归档、可用。在候选里挑**空闲、不太长**的，按这个顺序：(1) 做过这个目标的在前（这个目标下有请求的轮跑在它上面过）；(2) 已知不太长的在没有用量记录的前面；(3) 最近活动晚的在前；(4) Session 键。项目范围秘书和目标范围秘书不分先后，一样按这四条排（审查二第 7 条）。“空闲”= 没有 `queued`/`running` 的轮、没有占用；“不太长”= 最近一次模型输入量小于阈值（§0.1 第 4 条）；**没有用量记录的不当作太长**（第一轮审查第 12 条）。**没有空闲、不太长的候选：有名额就新开一个项目范围的秘书；没名额（秘书的保留上限满了，7D1 L31）就未分配**——写 `assignedSession: null`，不排在忙的秘书后面、也不借范围不合的秘书（审查二第 7 条）。**开局秘书是项目开局三条线之一**（7D2 L26，范围是整个项目）；**你手工开的秘书**（7D2 L27）按它带的范围参与过滤。（审查二 lead 补：把 DSH 稿里的分档和同档排序合成上面四条）
  - **未分配请求怎么取得归属（审查二第 7 条；审查二 lead 补）**：未分配请求的追问也写 `assignedSession: null`，跟着请求一起等；@ 指定收件人照常直接交给它。排空触发：秘书的一轮结束（变空闲）、秘书的一轮结束（变空闲）、秘书空出名额、上限调高、Host 启动。排空按请求排：先按这个请求第一个未分配轮的 `since`，再按请求键（`s6-query-unassigned`）；对每个请求重跑上面的挑法，挑到 S（或有名额新开 S）就在**一次提交**里：写一个 `routing` 轮 `{ from: null, to: S, reason: 'assigned' }`（这就是取得归属，L3 按它读出归属 S）、把 `request-tail` 搬到这一轮、取 `secretary-intake:<S 键>`（主是这个请求最老的排队轮，那一轮开始时释放）。还挑不到就留着。同一请求只分派一次：`request-tail` 守着读到的最后一轮，重放或并发的第二次排空提交失败，重读后看到已有归属就不再分。
  - @ 指定收件人：直接交给它；它不可用时报原因（`unavailable`），由你选转交，不静默换人。
  - **认领协议（第一轮审查第 3 条）**：**只在把新请求分配给还不是它归属的秘书时**，写第一轮的那次提交**同时**：取得认领 `secretary-intake:<Session 键>`，主是这一轮的键；并守卫所选 Session 记录在挑的时候读到的版本。所以一个用更早“空闲”快照的挑秘书会在提交里失败 → 重挑（排除它，最多重挑 3 次，再不行就新开）。**追问到已建立的归属不取 `secretary-intake`，只用 L3 的 `request-tail` 守卫（第二轮审查第 2 条）**。释放：在它被取的那一轮开始 `QueryRun` 的那次提交里，或在“没有开始就结束”的那次提交里；Host 启动时，轮已经终态的认领一律释放（第二轮审查第 2 条）。
  - 归属不清（例如你在一个请求下说的话像新请求）：本片不猜；界面上你选“接着这个请求”还是“新请求”，请求里明确带。
- **L5 请求发送和秘书的一轮由 Host 驱动。**【lead 定，待审】
  - 路由 `requests/submit`（只认人）：带目标（可为 null）、正文、可选的“接着哪个请求”和 @ 收件人；写第一轮或后续轮（`queued`、写 `assignedSession` 和 `since`、仅新请求分配时取 L4 的 `secretary-intake` 认领、搬 L3 的 `request-tail` 归属守卫认领）。**提交结果分“已分配”和“未分配”：已分配的回执写明交给了谁；未分配的轮 `assignedSession: null`，回执和请求读取显示等待、原因 `secretary_open_cap`，不取 `secretary-intake`；取得归属时 `request-tail` 和 `secretary-intake` 在同一次提交里取**（审查二第 7 条）（第二轮审查第 2 条）。
  - Host 有一个秘书轮的驱动（照咨询的服务端驱动，F6）：用索引 `s6-query-queued-by-session` 找 `queued` 轮，**启动时扫它**；按提交顺序取每个秘书当前归属的排队轮，领取、准备、开始、观察；同一秘书一次只跑一轮；开始前做 L4 的入口检查（第二轮审查第 3 条）；结果未知不当成可以重跑（同 K 片的做法）。**未分配队列用 `s6-query-unassigned` 读，排空触发（秘书的一轮结束（变空闲）、秘书空出名额、上限调高、Host 启动）时按稳定顺序（提交时间、请求键）重新分派；取得归属的那次提交同时取 `request-tail` 和 `secretary-intake`**（审查二第 7 条）。**启动和排空扫到 `assignedSession: null` 的 `queued` 轮，先按 `requestRoot` 读当前归属（L3）：没有归属才分派；已有归属（分派已提交、还没领取就重启）就把这个请求最老的排队轮交给当前归属的驱动，不再写 `assigned` 轮。所以这类“已取得归属、还没领取”的请求也在扫描范围里**（审查二快速核对第 2 条）。
  - **合批（第一轮审查第 4 条）**：不跑多任务一次。Host 启动一个请求里最老的排队轮，跑在当前归属上；在这个轮的准备里，同一请求、`since` 不晚于准备读游标的其它排队轮，作为额外输入（按 `since` 顺序，原文不改）；在**开始提交**里，这些轮每个标 `absorbedInto: <执行轮>` 并落终态（读投影 `ended`）；回答挂在执行轮上，读的时候把被合成的轮显示在执行轮下面。
  - 领取、准备、开始、回答照已有的幂等查询转换；未知结果永不重跑。
  - 秘书一轮的工具：看、找（第 3 片；第 4 片合入后带记忆分支）、只读命令（K 片 B）、回答（L7）、写候选计划（6C）；“记”在 6B。发消息在第 7 片。
  - 职责：秘书一轮的 `callKind: 'secretary'`（不是 `copy`，第一轮审查第 5 条），按秘书职责准备；**项目还没有采用的正式架构、或没有生效的完成标准时，执行种类用 `initial_coordination`（L8，和普通 ideas 回答分开）**；可信身份照查询的做法由平台带（F4）。
- **L6 主对话的读取（O30）。**【lead 定，待审】路由 `main/read`：按目标、分页（按根查询的 `since` 倒序，一页 20 个请求）。每个请求：第一轮的原话、交给了谁（链接到线）、还在处理和原因、各轮的回答和思路（L7）、你的选择、候选计划的链接和状态、和这个请求有关的卡。**共享的卡（第一轮审查第 10 条）**：按请求和目标的来源引用，把决定队列里属于它们的项一并列出，和队列按同一项 id 去重（同一条只出现一次）；卡片上“问秘书”建一个 `followup` 轮，带卡的对象/版本引用（`relatedCardRefs`）；过期候选的“重出”同样建一个 `followup` 轮要求重出，带那个候选的引用。合起来的请知悉按目标折叠（自动返工的通知折成一条“n 条自动返工”，点开看）。还没有目标时的请求，在第一个目标建立后显示在它的开头。读不改已读位置（已读只经 `decisions/notices/seen`）。
  - **秘书名字**：项目里按秘书 Session 的创建顺序，叫“秘书 1”“秘书 2”……（2C 的线名照这个读，第一轮审查第 10 条）。你开秘书时起了名字的，用你起的名字（7D1 的 `SessionRoleFactsV1.name`）；没起名的照这个序号叫（决定 60-2；审查二第 18 条）。
- **L7 回答和思路（R22、R23）。**【lead 定，待审】
  - 秘书一轮的正式回答：正文，加 0 个或 2–3 个思路，**思路存在回答里**（`QueryJobAnswerV1.ideas: { title; detail }[]`，每个思路一行标题加不超过 600 个码点的说明）；1 个或 4 个以上退回。回答保持 `revision: 1`、不可改。
  - 你选一个思路（`requests/select-idea`，只认人）：**选择写在它派生的那一轮上**（新 `followup` 轮的 `selectedIdea: { round: 回答轮, index: n }`），并排这个同请求的 `followup` 轮，输入写明“你选了第 n 个”；秘书据此出完整计划（6C）。选择不直接采用任何东西，也不改回答。
  - 每轮修改的“改了什么”：同一请求前后两个候选的结构差异（`deriveFuturePlanDelta`，F8）加秘书在回答里写的说明（6C）。
- **L8 秘书的准备路径（含没有目标时）。**【lead 定，待审，第一轮审查第 5 条】
  - 新的查询调用类 `secretary`：可信上下文来自 `QueryRun` 主事（principal），职责 `secretary`；manifest 只对这一个类允许 `goalId: null`（别的查询类仍要有目标）。**新的查询调用类 `role_exploration`（区域参谋、开局参谋的探索）：`goalId` 可为空（同秘书），可信 principal 是 `QueryRun`，绑定 `role_line` 操作和那条系统“请动手”消息；注册工具：看、找、只读命令、范围受限的 `record_note`（按第 4 片 L2a 的范围准入）、`propose_architecture_revision`；普通 `copy` 的权限不变。`query-execution.ts:381` 对 `secretary` 和 `role_exploration` 放开“没有目标”**（审查二第 11 条）。
  - **初始化分支（61-1、61-3）**：项目还没有采用的正式架构，或没有生效的完成标准时，这一轮的执行种类用 `initial_coordination`（`callKind` 仍是秘书，不是 `copy`），按已有的初始协调回答格式准备、出回答（v2 协议的 `setup`：architecture / completionPolicy / checks），**和普通 ideas 回答分开**。还没有目标的回答先存成候选，目标确认后再绑到那个目标（7D2 L41 第 1 段）。**目标确认那次提交写一条不可变的绑定事实 `InitializationBindingV1 { answerRef, answerDigest, requestRef, draftIndex, goalRef, goalRevision }`；原 Job、回答、prepared manifest 都不改。没有目标的初始化分支在读取和规范化时用这个绑定：Goal 版本和 `planId` 从绑定来；提议和采用都重读并守同一个绑定**（审查二第 8 条）。**采用仍是你的动作**，走现有的人工采用入口（今天在 `ui/views/execution/planning.ts:274` 的 `adoptInitialPlanSetup` 调的路由）；采用事件的补记走 L14。最小根模块 `.` 允许（61-2；第 8 片 L10）。已有采用的架构和生效的完成标准时走普通 `secretary` 路径。
  - 输入：工作区概况；现有目标列表（每个一行）；这个请求以前的轮次（**最多 10 轮**，每个回答截到 **2 KiB**，截断加一行省略说明）；选中目标的当前理解和注记索引（第 4 片；4C 落地前回 `not_implemented`）；跨目标问题时，只带其它目标的当前理解（不带它们的任务/注记）。
  - 秘书写的注记（6B）按 agent 来源、带它自己的 Session。
  - 暂停的目标：秘书可以读、解释、起草；派工是第 7 片。
  - 第一句话起草目标卡（6B 的 L11）。
- **L9 秘书的“记”（6B，要第 4 片）。**【lead 定，待审】把第 4 片的 `record_note` 注册给秘书一轮，只开 `write`（只能写当前理解和六个一般注记种类（第 4 片的 `NOTE_GENERAL_KINDS`：第 4 片规格 2026-10-15 把 `'note'` 拆成六种，决定 59），来源是 agent，职责 secretary）和撤自己的注记；不能写修补，不能审。**区域参谋、开局参谋的探索 Query（`role_exploration`）也注册 `record_note`（写、撤自己的），按第 4 片 L2a 的范围准入；它还要 `propose_architecture_revision`**（审查二第 11 条）。
- **L10 秘书太长就换手（R32，第一轮审查第 6 条）。**【lead 定，待审】
  - **共享换手原语（第二轮审查第 9 条）**：Runtime 的换手动作（它的阶段：写理解、等旧写者停、建接任 Session、转责任、归档；**不带工具、不带审批卡**）属于 6B 的前置；第 7 片 7C 才给这个原语加 agent 工具和审批卡。L10 的秘书换手＝这个原语 **加上它的请求路由步骤**（下面第 5 步）。
  - **身份**：一次换手的身份＝接任 Session 的创建操作（换手来历）；发现接任者就按这个来历找。
  - **围栏**：理解覆盖先查、此时不取围栏；覆盖成立后在提交里取认领 `secretary-handoff:<旧 Session 键>`，再在围栏下重核覆盖；重核不过 → 放掉围栏、报 `incomplete`（第二轮审查第 5 条）。Host 不在持有这个认领的 Session 上开始任何轮。此后到该秘书的新提交仍然入队，由第 5 步的 `routing` 轮转走。
  - 什么时候：一轮结束后，这个秘书最近一次输入量达到阈值（§0.1 第 4 条）。不在一轮中间换。
  - 步骤（Workflow，一个组合动作，可以中断后接着做）：
    1. 先查理解覆盖（此时不取围栏）。缺 → 换手报 `incomplete`，不取围栏，在旧秘书上排一个普通轮请它写理解（第 4 片的“记”；DESIGN §3.5“换手前必须写”）（第二轮审查第 5 条）。
    2. 覆盖成立 → 取 `secretary-handoff:<旧键>` 围栏，在围栏下重核覆盖；重核不过 → 放掉围栏、报 `incomplete`（第二轮审查第 5 条）。
    3. 等它没有正在跑的轮。
    4. 新开一个秘书 Session，来历“接手自 <旧秘书>”；这一步的创建操作就是换手身份。
    5. 给旧秘书手上每个还在处理的请求写一个 `routing` 轮（`from` 旧、`to` 新、`reason: 'handoff'`）；排着的轮改按新归属处理；**逐个请求做，某请求在换手开始后已有旧→新的 `routing` 轮就算做过**（幂等）。
    6. 旧线归档（不等一天）。
    7. 进“请知悉”：原因、时间、接任者、旧线链接；**一次换手身份只发一条**（幂等）。
  - **理解覆盖**：每个“有未完请求、归属在旧秘书”的目标，都要有一份当前理解，且它的最后一版文本是旧秘书的 Session 在它最后一轮里写的（跨过阈值之后的那一轮）；缺了 → 换手 `incomplete`，此时不取围栏，在旧秘书上排一个普通轮请它写（第二轮审查第 5 条）。
  - **候选、等待、历史跟着请求的归属走**（读时派生），不另写转交记录。
  - **手动归档（6B，`secretaries/archive`，只认人）**：`manual`/`dropped` 的 `routing` 轮就是存下来的选择；路由对每个请求返回结果（交给谁 / 放下 / 失败原因）；部分失败不回滚已做的请求。
  - 新建以前失败不转、不归档；中途重启从第一个没完成的步骤接着做。
- **L11 目标卡起草和确认（第一轮审查第 7 条）。**【lead 定，待审】
  - **草稿身份**＝（回答轮引用，草稿序号 `index`）；一份回答可以带多张草稿（第二轮审查第 4 条）；每张带目标说明、完成标准、建议的自治级别、**初筛 `screening`**（7D2 的 `GoalScreeningV1`：涉及哪块、`size`（`small`/`medium`/`large`/`unknown`，给 7D2 L28 用）、和哪些目标冲突或依赖、急不急、建议排位 `suggestedPosition`；没有初筛就按时间先后，62-1；审查二第 18 条）。
  - **参谋满了先排队**：没有参谋能接这个目标、又因保留上限开不了新参谋时（7D2 L33），卡上写明“参谋已满，先排队”（62-1；7D2 L33；审查二第 18 条）。目标照样能建、不拦；确认以后进“等参谋”队列、目标栏显示“排队等参谋 · 第 n 位”。
  - 确认（`goals/confirm-draft`，只认人）带 `commandId`（重放返回原回执）和草稿所在的轮。草稿所在轮已经不是这个请求的最新回答 → `revision_conflict`。确认才建目标（用已有的建目标和设置），草稿那一轮记上建出来的目标。同时确认多张草稿各建各的（第二轮审查第 4 条）。
  - **完成标准写在哪**：读完代码，今天没有按目标的完成标准记录。项目级只有 `CompletionPolicyRevision` + `ProjectCompletionPolicyActive`（要求种类、每必需义务的最少要求数，F14）；`GoalSnapshot`/`GoalSettingsV1` 没有完成标准字段。**没有现成记录可放，所以按 lead 裁定写进卡文**：确认时把草稿的 `completion` 各行按顺序并进 `GoalSnapshot.objective` 的卡文，本片不新建记录。这一点在此说明。
  - **没有目标时的开头请求**（`requestGoalId: null`）：确认那次提交给这个请求写一个 `routing` 类轮，带 `goalAttribution: <新目标 id>`（这就是它的有效目标）；原来的轮保持 `requestGoalId: null`。**同一次提交里写一条不可变的 `InitializationBindingV1`：`answerRef`、`answerDigest`、`requestRef`、草稿序号 `draftIndex`、新目标 `goalRef` 和 `goalRevision`；读取和规范化从它取 Goal 版本和 `planId`，提议和采用都重读并守同一个绑定**（审查二第 8 条）。候选校验用**有效目标**（最新的非空 `goalAttribution`，否则 `requestGoalId`；普通转交不改它），不再要求根查询的 `goalId` 相等（第二轮审查第 1 条）。
- **L12 取消的目标“重新入队”（R41，决定 39）。**【lead 定，待审，第一轮审查第 7 条】
  - 只从 `cancelled` 的目标复制。草稿（`goals/copy-draft`）：带旧目标的卡、自治级别、原活跃顺序的位置、旧目标上排着的干预列表供你勾选。
  - 确认（`goals/copy-confirm`，只认人）：建新目标，`GoalSnapshot` 加 `continuedFrom: GoalRef | null`；复制卡和自治，放在旧目标原来的位置；“等前一个”和“已接受并行风险”要你重新确认，不复制；旧目标不动。新目标的当前理解链接旧目标的（第 4 片）。你的勾选记在新目标上（`copiedInterventions: SessionMessageRef[]`）。
  - **复制时挪负责关系（7D2 L39）**：同一次确认提交里用 7D1 的 `planReanchor` 把目标参谋、目标书记的负责关系挪到新目标（`reason: 'goal_continued'`），新目标记“接续自”；原线已复用或归档的，新目标按 7D2 L33 另找。暂停的目标保留负责关系。（审查二第 18 条）
  - **撤回时机**：没勾的干预**必须在确认时就撤回**（R41），不能等到第 7 片。6B 通过一个注入端口调第 7 片的撤回操作；7A 合入前这个端口不存在 → 复制确认只记下你的勾选（这是收下的“只选中”确认，**不是失败**）；端口已装但撤回失败 → 确认仍提交，撤回由 `goals/copy-confirm` 重放重试（第二轮审查第 8 条）。**6B 的“复制”验收行里“撤回没勾的干预”一项，等 7A 合入后才算完成**（明说）。
  - 勾的干预等首个方案采用后转交，由第 7 片落实（§0.1 告知 4）。取消草稿什么都不改。
  - 首个方案仍由你采用。
- **L13 按答复改计划（R28，E08；6C，第一轮审查第 8 条）。**【lead 定，待审】这是一台受权变更编译器：
  - **授权载荷。** 秘书的正式回答带授权载荷（`QueryJobAnswerV1.authorization`）：允许改哪些对象——目标说明、验收、范围——以及每一项的读时版本（`VersionedRef[]`）。只许这三类；空载荷退回 `invalid`。**你对改目标/验收卡的答复消息正文（`UserDecisionBodyV1`）带 `approvedPayload: { answerRef: QueryJobAnswerRef; payloadDigest }`；这就是那份不可改的、你批准的载荷的身份（第二轮审查第 6 条；最后核对第 1 条）。**
  - **提议核对。** `plans/propose` 带 `decisionRef`（指向**你的答复消息**）；改动必须落在载荷范围内，每个被改对象的版本＝载荷里的版本；提议按 `approvedPayload` 的 `answerRef` 和 `payloadDigest` 核对到同一份载荷；越界或版本不符 → `revision_conflict`（第二轮审查第 6 条）。
  - **采用核对。** 采用（`plans/apply`）时重读每个被改对象的版本，并按 `approvedPayload` 的 `answerRef` 和 `payloadDigest` 再核对同一份载荷，一致才继续；不一致 → `revision_conflict`（第二轮审查第 6 条）。
  - **受影响任务。** 逐项：`running` → 先用已有控制停下再切换（采用等它停，原因 `stopping_affected_work`）；`waiting` 或结果 `unknown` → 采用等它了结；`completed` → 它的满足和证据留作历史，建**替代任务**承担新义务；被替代任务的下游改接到替代任务；不受影响的照常继续。**不物理删任务**：物理删除不支持（`plan-validation.ts:324`）——要撤掉的义务走**取消**，保留 `taskId`、记 disposition（第二轮审查第 7 条）。
  - **写入。** 目标/验收的改动写在采用那次提交里；只重做受影响的部分；旧证据不能满足新的验收。不自动回退工作区。
  - 新的做法上线以后，删掉 `UserDecisionV1` 一族（F12 列的引用），保留消息正文 `UserDecisionBodyV1`。
  - **6C 冻结前 lead 另写替代与切换的状态表**（本条要求，写出来）。
- **L14 初始化采用的补记（决定 48；6C，第一轮审查第 9 条）。**【lead 定，待审】
  - **生产者改动。** 初始架构、完成标准被采用的事件（`ArchitectureCatalogAdopted`、`ProjectCompletionPolicyActivated`）在来自卡回答时带上 `acknowledgementRef`（那张回答消息）；`decision-application.ts` 照别的证明一样校它（F13）。
  - **历史数据。** 这次改动以前答过的卡：**读的时候**投影成 `source_resolved`，附“没有证明（旧数据）”；读不写任何东西。
  - **写侧修复。** Host 启动时做一个修复步骤，加已有的 `decisions/application` 重试；读只投影。
- **L15 秘书线自动归档（R33；6B，第一轮审查第 6 条）。**【lead 定，待审】没有还在处理的请求、没有占用、最后一个新请求满 1 天 → 归档；每个项目至少留一条最近用过、可用的秘书线——**按时序读每个项目里合格的秘书，保留轮次 `since` 最晚的那条**；已换手交出的不等一天（L10 第 6 步）（第二轮审查第 5 条）。归档时未答的“请回答”跟着请求走（第 7 片）。用已有的自动维护，加秘书这一类。**这和 7D2 L38 是同一条闲置归档规则（“闲”不含请知悉；每种职责保留最后一条）；7D2 把闲置归档扩到参谋、书记线。**（审查二第 18 条）
- **L16 查询也记活动（6A；用户 2026-10-15 晚定，§0.1 第 3 条）。**【lead 定】把 2B 的活动计数扩到查询。2B L1 的算法不变（一步 = 一个 `tool.started`，回答正文不算步；`tallyTurnActivity`，`run-activity-tally.ts:104`）。（审查二额外核对 D2）（审查二额外核对 D3）（审查二额外核对 D4）
  - **记哪些：** 进入过 Kernel 的查询都记：秘书的一轮、`intervention_planning` 的只读查询、问一问的只读副本（第 7 片 7B）、角色线的探索查询（第 7 片 7D2 的 `role_exploration`）。
  - **身份和内容：** `QueryActivity` 和 `QueryRunRef`（`query-job.ts:10`）一一对应，ref 是 `{ aggregateType: 'QueryActivity'; projectId; workspaceId; queryJobId; runId }`。内容是 2B 的 `RunActivityFactsV1` 加 `queryRunRef`、`sessionRef`（执行它的 Session）、`askedSessionRef`（问一问才有，否则 `null`）、`goalId`（可为 `null`）、`queryEndedAt`、`recordedAt`、`recordedBy: 'query_end' | 'backfill'`、`span`（同 2B）。
  - **什么时候写：** 正常结束经 `query-observation.ts:500` → `recordQueryObservation`，在终态的那次提交里写；Host 启动核对里已进入查询的收束（QRR-03、QRR-04、QRR-06）也在终结的那次提交里写。没进入就收束的（QRR-01、QRR-02）不写、不占格，读作 `not_entered`；结果未知（QRR-05）不是终结，不写、不当 0、不释放占用。
  - **记录起点：** `ActivityRecording` 加独立的 `querySince`，不改原来的 `since`：支持 `QueryActivity` 的 Host 拿到实例租约以后、处理任何查询以前确保写上（没有就写 `now`）。分类：有记录、`recordedBy: 'query_end'`，或 `queryEndedAt < querySince` → 正常；`recordedBy: 'backfill'` 且 `queryEndedAt ≥ querySince` → `recorded_late`、`error: true`；没有记录且 `queryEndedAt ≥ querySince` → `not_recorded`（错误）；没有记录且 `queryEndedAt < querySince` → `not_backfilled`（补好不算错）；工作区没有 `querySince` → `no_recording_epoch`，不从 Run 的 `since` 推。
  - **补算：** 2B L8 加查询那一支：新索引 `s6-query-run-by-workspace-ended`（按 `endedAt`）选候选，按键读它的 `QueryActivity`；用 `executionState.history` 的固定窗口读 Kernel；重试、替换、幂等、`retry_later` 照 2B L8；自动补算和人点的 `activity/backfill` 都包括查询；公开结果把 `RunRef` 和 `QueryRunRef` 分开写（`processed` 每项带 `kind: 'run' | 'query'`）。
  - **日历（2B L9 扩展）：** 范围从“目标”扩成 `scope: { kind: 'goal'; goalRef } | { kind: 'workspace' }`。目标范围照 2B L9，查询按 `goalId` 等于本目标的算入；工作区范围算这个工作区的全部执行和查询，含 `goalId: null` 的秘书一轮和探索（不造占位目标）。带 `sessionRefs` 时，查询按执行它的 Session 归线；问一问的副本按 `askedSessionRef` 归到被问的线，不按查询的目标过滤。每格的“步骤”含查询的步数，另给其中查询的步数；覆盖情况另加查询一栏（计入的、补记的、进行中的、没进入的、各种未知、没有记录的，按上面的分类），不塞进 `runs*`。
  - **每个查询的活动（新）：** `readQueryActivities`（1–200 个本工作区的 `QueryRunRef`，返回形状同 2B L10）和路由 `activity/queries`；节点详情和测试都用它，不读数据库。
  - **横条（2B L12 扩展）：** 查询横条加 `activity`（同 `TrackBarV1.activity`），保留 `sessionRef`、`askedSessionRef`、`via`。目标横条的选择照 2B L12；问一问的副本按 `askedSessionRef` 归线，不按查询的目标过滤（改 `track-read-model.ts:955`、`:1109`）。
  - **去重：** 一次读取按完整 `QueryRunRef` 去重；副本和被问的线同时在 `sessionRefs` 里，也只计一次。
  - **2B 规格加后注：** 替代 2B §0.1 告知 3 的“查询不计数”（用户 2026-10-15 晚定，是授权变更），列出 L7、L8、L9、L10、L12 的扩展；L1 的算法不变。

### 0.4 和别的片的接缝

- **2A（已合入）：** 按顺序查找（L2）。
- **2B（已合入）：** 秘书的查询也计数（L16；原写“不计数”已被 §0.1 第 3 条取代，决定 72 后注改正）；6C 的影响清单用 2B 的执行改过的文件。
- **2C（施工中）：** 线的认定、线名、“等回复”的读法，2C 规格把秘书的部分留给本片（2C L20）；6A 在 2C 合入后施工；“秘书 n”按 L6 的创建顺序读（第一轮审查第 10、11 条）。
- **第 4 片：** 秘书的“记”、当前理解（6B）；换手前必须写当前理解；6C 的完整验收要它。
- **第 5 片：** 决定队列、候选卡、答复和落实（L6、L13、L14）；共享卡按 L6 去重；答复上存 `approvedPayload` 的 `answerRef` 和 `payloadDigest`（第二轮审查第 6 条）。
- **第 7 片：** 秘书发消息、待放行、回复到了开下一轮、派工核对版本、消息处置（撤回、转交）、复制目标时干预的撤回和转交；6B 的撤回端口等它（L12）；**7C 给 6B 的共享换手原语加 agent 工具和审批卡**（第二轮审查第 9 条）。
- **第 7 片（7D1、7D2）：** 7D 已拆成 7D1、7D2（审查二第 18 条）：**7D1 共享基础**（在 8C 之前）含 `RoleScopeV1`/`SessionRoleFactsV1`/`RoleLineAllocationV1`、`planReanchor`/`reanchorSessionResponsibility` 和 transfer 扩展、`role-scope:` 占位、项目主体卡源；**7D2 角色线编排**（在 8D 之后）含开局三条线（L4 的开局秘书是其中之一）、你手工开秘书和范围（L4）、位置、拆分、运行准入、上限卡、队列、规则、冷启动；负责关系包含范围的挑秘书（L4）依赖 7D1 的 `RoleScopeV1`、`planReanchor` 挪负责关系（L12）是 7D1、闲置归档扩到参谋和书记（L15）是 7D2；目标初筛和排队（L11）接 7D2 L33。新顺序 `4A → 4B → 4C → 6A → 6B → 7A → 7B → 7C → 7D1 → 8A → 8B → 8C → 8D → 7D2 → 6C`。
- **K2：** 压缩做好以前，太长就换手（L10）。

## 1. 范围

### 1.1 交付（按 §0.1 第 1 条 (a)）

- **6A：** L1–L8、L16（查询也记活动，新路由 `activity/queries`）；路由 `requests/submit`、`requests/select-idea`、`requests/route`（转交/放下）、`requests/ask`（卡片问秘书/重出）、`main/read`、`requests/read`；Host 的秘书轮驱动与启动扫描；挑秘书**按范围过滤**（开局秘书和手工开的秘书）、未分配队列（`s6-query-unassigned`）和排空、`initial_coordination` 初始化分支。**核心在 2C 之后可建；完整验收要两个索引和驱动。**（第一轮审查第 10、11 条；审查二第 7 条）
- **6B：** L9–L12、L15；路由 `goals/confirm-draft`、`goals/copy-draft`、`goals/copy-confirm`、`secretaries/archive`、`secretaries/handoff`（手动换手）；目标草稿带 `screening` 和“参谋已满，先排队”；复制时用 `planReanchor` 挪负责关系；闲置归档和 7D2 L38 一致（审查二第 18 条）。撤回端口等 7A。**含 Runtime 换手原语的阶段（不带工具、不带审批卡），作为 6B 的前置；7C 才加 agent 工具和审批卡**（第二轮审查第 9 条）。
- **6C：** L7 的完整计划和“改了什么”、L13、L14；删 `UserDecisionV1`。**完整验收要 6B 和第 4 片。**答复带 `approvedPayload`，提议和采用核到同一份（第二轮审查第 6 条）；**无 Goal 初始化绑定 `InitializationBindingV1` 的提议、采用和计划读取（审查二第 8 条）**。

### 1.2 不在本片

- 秘书发消息、待放行、派工、回复和到期开下一轮（第 7 片）；消息的撤回、转交（第 7 片）；复制时的干预撤回由第 7 片提供端口。
- 压缩（K2）；主、子秘书，按目标强制拆分秘书（决定 49：不设）。
- 界面（E3）；旧界面的主对话照旧。
- 用真实模型试跑规划协议：要你授权，施工后另做（第 6 行的验收写了“真实模型试跑的记录”）。

## 2. 接口（新名字以此为准，冻结时可能细调）

```ts
// src/contracts/query-job.ts（改）
export type QueryRoundKind = 'request' | 'followup' | 'reply' | 'expiry' | 'explain' | 'routing';
// QueryJobV1 加（第一轮审查第 1、2、4、7 条）：
//   requestRoot: QueryJobRef | null;      // 旧查询解码为 null；第一轮指向自己
//   roundKind: QueryRoundKind;            // 旧查询解码为 'request'
//   requestGoalId: string | null;         // 请求发出时选中；旧查询 null
//   assignedSession: SessionRef | null;   // 入队时写：挑中的或当前归属；routing 轮 null
//   routing: { from: SessionRef | null; to: SessionRef | null;
//              reason: 'handoff' | 'manual' | 'archived' | 'dropped' | 'assigned' } | null;  // to=null 表示放下；assigned＝未分配请求排空时取得归属（审查二 lead 补）
//   relatedMessageRef: SessionMessageRef | null;
//   since: CommitCursor;                  // 这一轮的创建游标，绑在创建提交里
//   absorbedInto: QueryJobRef | null;     // 合成时指向执行轮（第一轮审查第 4 条）
//   selectedIdea: { round: QueryJobRef; index: number } | null;  // 选择存在派生的 followup 轮上
//   goalAttribution: string | null;       // 确认提交写的有效目标；有效目标取最新非空它，否则 requestGoalId（第二轮审查第 1 条）
//   relatedCardRefs: VersionedRef[];      // 卡片“问秘书”“重出”的对象/版本（第一轮审查第 10 条）
// QueryJobAnswerV1 加：ideas: { title: string; detail: string }[]（0 或 2–3；第一轮审查第 1 条）
//   authorization: { objects: VersionedRef[]; allow: ('goal_objective'|'acceptance'|'scope')[] } | null（6C）
//   goalCardDrafts: { objective: string; completion: string[]; autonomy: GoalAutonomyV1; screening: GoalScreeningV1 | null }[]（6B；身份＝回答轮＋index；第二轮审查第 4 条；screening 含 `size`（含 `unknown`），给 7D2 L28 用，见 62-1、7D2 的 GoalScreeningV1；审查二第 18 条）
//   初始化分支的 setup（architecture/completionPolicy/checks）存成候选，采用仍是人（61-1、61-3；execution.kind = initial_coordination）
//   回答仍 revision: 1、不可改；选择不改回答

// src/contracts/goal-decisions.ts（改）UserDecisionBodyV1（人类决定答复消息正文）加（最后核对第 1 条）：
//   approvedPayload: { answerRef: QueryJobAnswerRef; payloadDigest: string } | null（6C；答复绑定的那份不可改载荷；提议和采用据此核到秘书回答的 authorization）（最后核对第 1 条）

// src/contracts/query-job.ts（改；审查二第 8 条）：确认目标的不可变绑定事实，原 Job、回答、prepared manifest 都不改
export type InitializationBindingV1 = { answerRef: QueryJobAnswerRef; answerDigest: string; requestRef: QueryJobRef;
  draftIndex: number; goalRef: GoalRef; goalRevision: number };
// 无 Goal 初始化分支的读取和规范化从它取 Goal 版本和 planId；提议和采用都重读并守同一个绑定（审查二第 8 条）

// src/core/work-graph/model/request-contracts.ts（新）
export type RequestRoundStatus = 'queued' | 'running' | 'ended' | 'unknown';
// 读投影（第一轮审查第 1 条）：未领取 → queued；claimed/prepared/started → running；
// answered、failed、cancelled、routing/absorbed 的终态 → ended；结果未知 → unknown。
export type RequestViewV1 = { requestRoot: QueryJobRef; goalId: string | null; effectiveGoalId: string | null; // effectiveGoalId＝最新非空 goalAttribution，否则 requestGoalId（第二轮审查第 1 条）
  owner: SessionRef | null; processing: boolean; assignment: 'assigned' | 'unassigned'; waitReason: 'secretary_open_cap' | null; reasons: ('round' | 'reply' | 'release' | 'candidate')[];   // 未分配显示等待、原因 secretary_open_cap（审查二第 7 条）
  rounds: { ref: QueryJobRef; kind: QueryRoundKind; status: RequestRoundStatus;
            input: string; answer: string | null; ideas: { title: string; detail: string }[];
            selectedIdea: { round: QueryJobRef; index: number } | null;
            assignedSession: SessionRef | null; session: SessionRef | null; absorbedInto: QueryJobRef | null; // routing 轮和领取前为 null（第二轮审查第 4 条）
            since: CommitCursor }[];
  candidate: { proposalRef: PlanProposalRef; state: string; stale: boolean } | null;
  cards: { itemId: string; sourceRef: VersionedRef }[] };   // 与队列按 itemId 去重
export interface RequestFactsPort {     // 替换 request-facts-reader 的过渡读取
  readRequest(ctx: CoreCallContext, input: { requestRoot: QueryJobRef }): Promise<ReadResult<RequestViewV1>>;
  ownerOf(ctx: CoreCallContext, input: { requestRoot: QueryJobRef }): Promise<ReadResult<SessionRef | null>>;
  effectiveGoalOf(ctx: CoreCallContext, input: { requestRoot: QueryJobRef }): Promise<ReadResult<string | null>>;
}
export interface RequestSubmitPort {
  submitRequest(ctx: CoreCallContext, input: { commandId: string; goalId: string | null; text: string;
    continues: QueryJobRef | null; recipient: SessionRef | null }):
    Promise<{ status: 'queued'; requestRoot: QueryJobRef; round: QueryJobRef; assignment: 'assigned'; secretary: SessionRef; created: boolean; waitReason: null }   // 已分配（审查二第 7 条）
          | { status: 'queued'; requestRoot: QueryJobRef; round: QueryJobRef; assignment: 'unassigned'; secretary: null; created: false; waitReason: 'secretary_open_cap' }   // 秘书满额，等待排空（审查二第 7 条）
          | { status: 'rejected'; code: 'invalid' | 'forbidden' | 'unavailable' | 'busy'; reason: string }>;
  route(ctx: CoreCallContext, input: { commandId: string; round: QueryJobRef; to: SessionRef | null;
    reason: 'handoff' | 'manual' | 'archived' | 'dropped' }):
    Promise<{ status: 'routed'; routingRound: QueryJobRef } // 终态路由回执，不是 queued（第二轮审查第 4 条）
          | { status: 'rejected'; code: 'invalid'|'forbidden'|'busy'; reason: string }>;
  selectIdea(ctx: CoreCallContext, input: { commandId: string; round: QueryJobRef; index: number }):
    Promise<{ status: 'queued'; followupRound: QueryJobRef } | { status: 'rejected'; code: 'invalid'|'forbidden'|'busy'|'revision_conflict'; reason: string }>; // 拒绝码含 busy/forbidden（第二轮审查第 4 条）
  ask(ctx: CoreCallContext, input: { commandId: string; round: QueryJobRef; cardRefs: VersionedRef[]; regenerate: boolean }): Promise<…>;
}
// 常量（第一轮审查第 1、3、4 条）
export const SECRETARY_HANDOFF_INPUT_TOKENS = 500_000;   // 和模型容量的 80% 取小；软预算：一轮结束后才换手（用户 2026-10-15 晚定）
export const SECRETARY_IDLE_ARCHIVE_MS = 24 * 3600 * 1000;
export const SECRETARY_PICK_RETRIES = 3;                 // 挑秘书并发重试上限
export const SECRETARY_TAIL_RETRIES = 3;                 // request-tail 归属重试上限
export const IDEA_DETAIL_MAX_CODEPOINTS = 600;
export const SECRETARY_HISTORY_ROUNDS = 10;              // 准备里最多几轮历史
export const SECRETARY_HISTORY_ANSWER_BYTES = 2 * 1024;  // 每个历史回答截断
export const QUERY_QUEUED_BY_SESSION_INDEX = 's6-query-queued-by-session';
export const QUERY_BY_REQUEST_INDEX = 's6-query-by-request';
export const QUERY_UNASSIGNED_INDEX = 's6-query-unassigned';   // 未分配队列：assignedSession 为 null，按提交时间、请求键读（审查二第 7 条）

// src/contracts/ledger.ts：GoalSnapshot 加 continuedFrom: GoalRef | null; copiedInterventions: SessionMessageRef[]（6B）
```

路由（`CORE_ROUTE_SPECS` 新增；都只认人，读的除外）：`requests/submit`、`requests/route`、`requests/select-idea`、`requests/ask`、`requests/read`、`main/read`（6A）；`goals/confirm-draft`、`goals/copy-draft`、`goals/copy-confirm`、`secretaries/archive`、`secretaries/handoff`（6B）。按答复改计划走已有的 `plans/propose`、`plans/apply`（6C）。

## 3. 状态行（第一轮审查第 1、4、6、7、8、9、10 条 + 第二轮审查第 1–9 条；guard / 效果 / 拒绝码）

| 行 | guard | 效果 | 拒绝码 |
| --- | --- | --- | --- |
| S6-Q-01 提交 `requests/submit` | 人操作者；工作区与（可空）目标合法；`commandId` 幂等（重放回原回执） | 挑秘书（L4：**范围是过滤**，只有负责范围包含这个请求有效目标的秘书是候选（开局秘书和手工开的秘书都算）；**仅新请求分配**取 `secretary-intake` 认领，追问不取、只搬 `request-tail`；守 Session 版本）（第二轮审查第 2 条；审查二第 7 条）；写第一轮或后续轮 `queued`，带 `requestRoot`、`roundKind`、`requestGoalId`、`assignedSession`、`since`；搬 `request-tail` 认领；**回执分“已分配”（写明交给谁）和“未分配”（`assignedSession: null`、等待、原因 `secretary_open_cap`、不取 `secretary-intake`）** | `invalid`（正文空/目标非法）、`forbidden`（非人）、`unavailable`（@ 的秘书不可用）、`busy`（认领重试 3 次仍冲突） |
| S6-Q-02 路由/转交/放下 `requests/route` | 人操作者；只从当前归属写；`request-tail` 认领主＝读到的最后一轮 | 写 `routing` 终态轮（`runRef: null`、`status:'closed'`、`closeReason.code:'not_entered'`）；`to` 非空＝转交、`to:null`＋`reason:'dropped'`＝放下；搬 `request-tail` 认领；排着的轮不动；**回执是终态 `routed`，不是 `queued`**（第二轮审查第 4 条）；被转走、尚未进入的尝试在 L4 入口检查里放弃并在新归属另起（第二轮审查第 3 条） | `invalid`、`forbidden`、`busy`（归属冲突重试 3 次） |
| S6-Q-03 选思路 `requests/select-idea` | 人操作者；轮存在且回答已有 2–3 个思路；`index` 在范围内；`commandId` 幂等 | 排一个 `followup` 轮，带 `selectedIdea: { round: 回答轮, index }`，输入写明选第 n 个；不改回答、不采用任何东西 | `invalid`（思路个数/index 越界）、`forbidden`、`busy`、`revision_conflict`（轮已被替换）（第二轮审查第 4 条） |
| S6-G-01 确认草稿 `goals/confirm-draft` | 人操作者；草稿轮仍是这个请求的最新回答；`commandId` 幂等（重放回原回执） | 建目标；草稿的 `screening` 一起存；完成标准写进卡文（F14）；该轮记上目标；`requestGoalId:null` 的开头请求补一个 `routing` 轮的 `goalAttribution`，归属不受它影响、有效目标取最新非空 `goalAttribution`（第二轮审查第 1 条）；参谋满了时按 62-1 进队列、卡上写“参谋已满，先排队”（7D2 L33；审查二第 18 条）；同时确认多张各建各的 | `invalid`、`forbidden`、`revision_conflict`（草稿轮已不是最新回答） |
| S6-G-02 复制 `goals/copy-confirm` | 人操作者；源目标 `desiredState:'cancelled'` | 建新目标、`continuedFrom`、复制卡/自治/顺序位置；“等前一个”“已接受并行风险”不复制；`copiedInterventions` 记勾选；**同一次提交里用 7D1 的 `planReanchor` 把目标参谋、目标书记的负责关系挪到新目标**（`reason:'goal_continued'`，7D2 L39）；**确认时经注入端口撤回没勾的干预**：端口未装（7A 前）→ 只记勾选的确认；端口已装但撤回失败 → 确认照常提交（committed），没撤的干预留待 `goals/copy-confirm` 重放重试（第二轮审查第 8 条；最后核对第 2 条；审查二第 18 条） | `invalid`（源不是 cancelled）、`forbidden` |
| S6-S-01 换手 `secretaries/handoff` | 人操作者（手动）或阈值触发（自动）；先用旧秘书的最后一轮写出全覆盖的当前理解 | **先查理解覆盖（不取围栏）**；覆盖成立 → 取 `secretary-handoff:<旧键>` 围栏并在围栏下重核；重核不过 → 放掉围栏、`incomplete`；建接任 Session；每个未完请求写 `handoff` 的 `routing` 轮（幂等）；旧线归档；一条请知悉（幂等）（第二轮审查第 5 条） | `incomplete`（理解覆盖缺，此时不取围栏、排一个普通轮请旧秘书写）、`busy`（旧线还在跑）、`revision_conflict` |
| S6-S-02 自动归档 `session-maintenance` | 没有还在处理的请求、没有占用、最后一个新请求满 1 天；项目里保留轮 `since` 最晚的合格秘书 | Session 归档，原因 `secretary_idle`；未答“请回答”跟请求走 | 拒绝保存在已有 Session 归档行；至少留一条时不动 |
| S6-P-01 按答复改计划 `plans/propose`+`plans/apply` | 答复消息正文带 `approvedPayload`；`plans/propose` 的 `decisionRef` 指向那条答复消息；改动落在回答授权载荷内；每个对象版本＝载荷版本；提议和采用从该答复消息取 `approvedPayload`，按它的 `answerRef`、`payloadDigest` 核到同一份载荷（最后核对第 1 条） | 提议版本；采用时重读版本一致才写目标/验收（第二轮审查第 6、8 条） | `revision_conflict`（越界/版本不符）、`invalid`（载荷空）、`forbidden` |
| S6-P-02 替代与切换 `plans/apply` | 受影响任务分类（running/waiting/unknown/completed） | running 先停（等它停，`stopping_affected_work`）；waiting/unknown 等；completed 建替代任务、满足与证据留历史；下游改接；不受影响照常；**不物理删任务，要撤的走取消、保留 `taskId` 记 disposition**（`plan-validation.ts:324`）（第二轮审查第 7 条） | `busy`（等待受影响工作时）、`revision_conflict` |

- 查询轮次的状态是今天 `QueryJob`/`QueryRun` 状态的投影（第一轮审查第 1 条）：未领取 → `queued`；claimed/prepared/started → `running`；answered / failed / cancelled / `routing` / `absorbed` 的终态 → `ended`；结果未知 → `unknown`。`routing` 轮写下就是终态，不跑模型（S6-Q-02）。
- 秘书线归档沿用 Session 的归档行（原因 `secretary_idle`、`secretary_handoff`，S6-S-01、S6-S-02）。
- 目标复制：新目标照建目标的行；旧目标不动（S6-G-02）。
- 初始化补记：读侧把历史答过的卡投影为 `source_resolved`（附“没有证明（旧数据）”）并只读；写侧由 Host 启动步骤加既有 `decisions/application` 重试（S6-P-01 同族，第一轮审查第 9 条）。
- 初始化分支：项目还没有采用的正式架构、或没有生效的完成标准时，秘书这一轮用执行种类 `initial_coordination`（L8），回答的 `setup` 存成候选、不自动采用（和普通 ideas 回答分开；没有目标的回答先存候选，目标确认后绑定并写不可变绑定事实 `InitializationBindingV1`，7D2 L41 第 1 段）；无 Goal 的读取和规范化从绑定取 Goal 版本和 `planId`，提议和采用都守同一个绑定（审查二第 8 条）；采用仍是你的动作，走现有的人工采用入口（`ui/views/execution/planning.ts:274` 的 `adoptInitialPlanSetup` 路由），补记走 L14。（61-1、61-3）

## 4. 规则

1. 主对话不是 Session，不产生工作线；读主对话不改任何东西。
2. 归属按创建顺序（最后一轮的 `since`）和显式转交，不按完成顺序；不静默换秘书。归属只看普通轮和 `routing` 非空的 `routing` 轮；只补 `goalAttribution` 的 `routing` 轮不碰归属。有效目标另算：最新非空 `goalAttribution`，否则 `requestGoalId`；普通转交不改它（第二轮审查第 1 条）。给请求加轮的提交都搬 `request-tail:<根键>` 认领（`expectedOwner`），冲突重读重试最多 3 次再 `busy`（第一轮审查第 2 条）。
3. 采用计划、改目标、记下你的话，只由你点（决定 37）。
4. 秘书不领取任务，一轮结束不让出 Work 执行。
5. 结果未知的秘书轮不自动重跑；被合成/路由的轮也不重跑（第一轮审查第 4 条）。
6. 排队的轮保留 `assignedSession`；Host 跑在开始那一刻的当前归属上。改归属只写 `routing` 轮，不改写旧轮（第一轮审查第 2 条）。开始前做 L4 的入口检查：被认领的 Session 仍是当前归属且没有换手围栏；不满足就放弃那次没进入的尝试、放掉占用、在当前位置另起一次（第二轮审查第 3 条）。
7. 认领：`secretary-intake:<Session 键>` 只在把新请求分配给还不是它归属的秘书时取得；追问到已建立的归属不取、只用 `request-tail`。认领在它被取的那一轮开始、或在“没有开始就结束”的提交释放；启动时释放已终态轮的认领。**未分配轮不取任何 `secretary-intake`；未分配队列按排空触发重新分派，取得归属时 `request-tail` 和 `secretary-intake` 在同一次提交里取**（第一轮审查第 3 条；第二轮审查第 2 条；审查二第 7 条）。
8. 受权变更只许改授权载荷里的目标说明、验收、范围，且逐对象核对版本；提议和采用从答复消息正文取 `approvedPayload`，按它的 `answerRef`、`payloadDigest` 核到秘书回答 `authorization` 的同一份载荷（最后核对第 1 条）；受影响工作先停/等了结再切；不物理删任务，要撤的走取消、保留 `taskId` 记 disposition（第一轮审查第 8 条；第二轮审查第 6、7 条）。
9. 初始化补记的读只投影 `source_resolved`，不写；写由 Host 启动步骤和 `decisions/application` 重试负责（第一轮审查第 9 条）。
10. 换手先查理解覆盖（不取围栏）；缺 → `incomplete`，不取围栏，在旧秘书上排一个普通轮请它写理解；覆盖成立才取围栏并在围栏下重核，重核不过 → 放掉围栏、`incomplete`（第二轮审查第 5 条）。
11. 换手用一个共享的 Runtime 换手原语（阶段：写理解、等旧写者停、建接任 Session、转责任、归档；不带工具、不带审批卡）；它属于 6B 的前置，7C 才加 agent 工具和审批卡。秘书换手＝这个原语 + 请求路由步骤（第二轮审查第 9 条）。
12. 挑秘书的范围是过滤：只有负责范围包含请求有效目标的秘书（`goal` 范围是它或 `project` 范围，7D1 的 `RoleScopeV1`，7D1 L23）是候选；你给某个目标单开的秘书只接这个目标的请求；候选里没有空闲、不太长的，有名额就新开（项目范围），没名额就未分配（`assignedSession: null`、等待、原因 `secretary_open_cap`）；开局秘书是项目开局三条线之一（范围整个项目），手工开的秘书也进候选（7D2 L26、L27）；未分配队列用 `s6-query-unassigned` 读，排空触发（秘书的一轮结束（变空闲）、秘书空出名额、上限调高、Host 启动）时按稳定顺序（提交时间、请求键）重新分派，取得归属那次同时取 `request-tail` 和 `secretary-intake`（7D2 L33 末段）。（审查二第 7 条）
13. 初始化分支：项目没有采用的正式架构、或没有生效的完成标准时，秘书这一轮用执行种类 `initial_coordination`，回答的 `setup` 存成候选（和普通 ideas 回答分开；没有目标的回答先存候选、目标确认后绑定并写 `InitializationBindingV1`，7D2 L41 第 1 段）；采用仍是你点，走现有的人工采用入口（`ui/views/execution/planning.ts:274` 的 `adoptInitialPlanSetup` 路由）（61-1、61-3）；最小根模块 `.` 允许（61-2）；无 Goal 的读取和规范化从绑定取 Goal 版本和 `planId`（审查二第 8 条）。
14. 目标草稿带 `screening`（含 `size`，含 `unknown`；62-1）；没有参谋能接、又因保留上限开不了新参谋时（7D2 L33），卡上写“参谋已满，先排队”，新目标不拦，进队列（7D2 L33；审查二第 18 条）。
15. 复制已取消的目标时，同一次提交里用 `planReanchor` 把目标参谋、目标书记挪到新目标（7D2 L39）；闲置归档和项目的保留最后一条照 7D2 L38。（审查二第 18 条）

## 5. 测试（TDD，测试由 DSH 一条一条写）

### 5.1 测试入口（**待你确认**）

| 入口 | 是什么 | 能抓到 | 抓不到 |
| --- | --- | --- | --- |
| SE1 | **请求的提交和读取（6A）。** 公开的 `RequestSubmitPort`、`RequestFactsPort`、`MainSurfaceReadPort`，两个后端；Session、目标经真实服务造 | **范围是过滤**（只有覆盖请求有效目标的秘书是候选；你单开给某个目标的秘书只接它的请求；项目范围秘书和目标范围秘书同档，按“同目标做过”、最近活动、Session 键排）、三档和顺序、**要新开但保留上限满时请求 `assignment:'unassigned'`、`assignedSession:null`、等待原因 `secretary_open_cap`、不取 `secretary-intake`；`s6-query-unassigned` 按（提交时间、请求键）读，排空触发后同一次提交取 `request-tail` 和 `secretary-intake`、重启后恰好分派一次（7D2 L33 末段；审查二第 7 条）**、并发两个请求交给两个秘书（含 stale 空闲快照重挑）、同请求追问排当前秘书、@ 指定、归属按创建顺序、**归属与有效目标分开派生、只补 `goalAttribution` 的轮不碰归属**（第二轮审查第 1 条）、`request-tail` 冲突重试、`routing` 轮与终态 `routed` 回执（第二轮审查第 4 条）、旧查询读法、还在处理四原因、状态投影四值、主对话分页与卡片去重 | Kernel 里的执行 |
| SE2 | **Host 驱动的秘书轮（6A）。** 主机场景框架：真实 Host、真实 Runtime、真实冻结 Kernel、脚本模型；注入时钟；重启 | 排队到跑完、同一秘书一次一轮、**入口检查与改道（claim-A → 转 B → 开始）**（第二轮审查第 3 条）、合批（哪些轮被 `absorbedInto`、回答挂哪轮、原文不改）、`s6-query-queued-by-session` 启动扫描、认领取得/释放（**仅新请求分配取**）（第二轮审查第 2 条）、结果未知不重跑、重启后接着、没有目标时的 `secretary` 准备、**初始化分支（没有采用的架构或没有生效的完成标准时执行种类是 `initial_coordination`，和普通 ideas 回答分开；没有目标的回答先存候选、目标确认后绑定）**、秘书工具、回答和思路格式、**查询结束记活动（L16：秘书一轮记在秘书线上，问一问的副本记在被问的线上）** | 真实模型的规划质量 |
| SE3 | **秘书的生命周期（6B）。** 同 SE2，加第 4 片注记服务 | **换手七步（先查覆盖、再取围栏、围栏下重核）**（第二轮审查第 5 条）、`secretary-handoff` 围栏（期间不开始新轮、新提交仍入队转走）、共享换手原语的阶段（第二轮审查第 9 条）、身份幂等、中途重启接着做、全部未完请求转走、理解覆盖不足报 `incomplete` 且不取围栏、自动归档条件和保留 `since` 最晚一条、每种职责至少留一条（和 7D2 L38 同一条规则）、手动归档的 per-request 结果（审查二第 18 条） | 交接内容的语义质量 |
| SE4 | **目标卡和复制（6B）。** 公开的路由，真实服务 | 草稿不建目标、草稿带 `screening`（含 `size`）、确认建目标、完成标准进卡文、**参谋满了卡上写“参谋已满，先排队”、新目标进队列**、同时确认两张、草稿轮不是最新回答报 `revision_conflict`、`commandId` 重放、复制只从已取消、位置和自治、要重新确认的设置、勾选记下、**同一次提交用 `planReanchor` 挪目标参谋/目标书记**（7D2 L39）、**7A 前端口缺失只记勾选，已装但撤回失败则确认提交、撤回重放重试**（第二轮审查第 8 条）、旧目标不动（审查二第 18 条） | 第 7 片的撤回和转交落实、队列排位的语义质量 |
| SE5 | **方案协议（6C）。** 同 SE2 | 思路个数、选择写在 followup 轮、按请求的候选、两个请求候选互不遮住、“改了什么”的精确结构差异、**不物理删任务、撤的走取消**（第二轮审查第 7 条） | 真实模型 |
| SE6 | **按答复改计划和补记（6C）。** 公开的决定答复、`plans/propose`、`plans/apply`、任务读取 | 授权载荷范围、**答复 `approvedPayload` 的 `answerRef`/`payloadDigest` 绑定**（第二轮审查第 6 条）、逐对象版本核对、采用重核、替代任务和证据边界、running 先停、waiting/unknown 等、下游改接、不相干照常、落实证明、初始化卡关成来源已解决、旧数据只读投影、补记重试 | 影响清单的自然语言判断 |

### 5.2 验收行为（期望值要精确对象、版本、批次、差异、回执）

- R-01（SE1）挑秘书：候选都可用（未归档、职责秘书）；A（目标 g1，负责范围含 g1，空闲，输入量 100,000 不太长，最近活动 10:00）、C（g1，范围含 g1，空闲，输入量 500,000 太长，09:30）、D（g1，范围含 g1，空闲，没有用量记录，09:00）、B（**范围是整个项目**，空闲，输入量 80,000 不太长，08:00）（A、D 处理过 g1 的请求，B 没处理过）→ 新请求 g1 给 A（做过 g1、已知不太长）；A 忙 → 给 D（做过 g1；没有用量记录按第 (2) 键排在已知不太长的后面，但第 (1) 键“做过这个目标”在先，所以排在没做过 g1 的 B 前面）；A、D 都忙 → 给 B（项目范围覆盖 g1）；都忙或太长 → 新开一个项目范围的秘书，回执 `assignment: 'assigned'`、`created: true`。**没有用量记录不算太长，只按 L4 的第 (2) 键排在已知不太长的后面**（第一轮审查第 12 条；第二轮审查第 7 条）。**同档排序完整按 L4 的四个键：开局秘书 S0（范围整个项目，没做过 g1，最近活动 11:00）和 A（范围只含 g1，做过 g1，10:00）都空闲不太长 → A 在前（第 (1) 键）；两个都做过 g1、都已知不太长时，晚活动的在前，再按 Session 键**（审查二快速核对第 2 条）（7D2 L26、L27；审查二第 7 条）。**反例：一个只管 g2 的秘书（范围只含 g2）从不接 g1 的请求——范围是过滤，不是排在后面**；g1 的请求由覆盖 g1 的 A 或项目范围的 S0 接。**未分配 → 重启 → 恰好分派一次（要 7D1 的保留上限，7D1 联动补验）**：秘书保留上限 2，只有 S0、B 两条（范围都是项目）且都在跑 → 新请求 g1 回 `assignment: 'unassigned'`、`secretary: null`、`created: false`、`waitReason: 'secretary_open_cap'`，`requests/read` 读出同样的等待；这个请求的追问也是未分配轮；Host 重启后从 `s6-query-unassigned` 读出它、仍等待；B 的一轮结束（空闲、不太长）→ 排空在一次提交里写 `routing` 轮 `{ from: null, to: B, reason: 'assigned' }`、搬 `request-tail`、取 `secretary-intake:B`，读出 `assignment: 'assigned'`、归属 B，两轮在 B 上按 L5 合批跑；同一排空重放、或两个排空并发 → 只有一个 `assigned` 轮，另一个提交因 `request-tail` 失败、重读后不再分；**`assigned` 轮提交后、B 还没领取就重启 → 启动扫描从 `s6-query-unassigned` 读到这两轮，按 `requestRoot` 读出归属已是 B，不再写 `assigned` 轮，把最老的一轮交给 B 的驱动，两条输入合批、只开一个执行轮**（审查二快速核对第 2 条）。另一例：S0、B 都忙时把上限从 2 调到 3 → 排空新开一个项目范围的秘书 C，请求归属 C。（审查二 lead 补）（7D2 L26、L27、L33 末段；审查二第 7 条；审查二第 19 条）
- R-02（SE1）并发：两个请求同时提交，都挑中空闲的 A（夹具在存储边界让两次提交交错）→ 一个给 A，另一个重挑给 B；各自的回执写明交给了谁。**另一夹具：A 在两次挑之间变忙（Session 版本变了），后来的挑用旧快照失败 → 重挑**（第一轮审查第 3 条）。
- R-03（SE1）追问：同一请求的第二句排在 A 上（A 正在跑）；第二句的创建提交搬 `request-tail`；A 换手后第三句给接任者，归属仍按新 `routing` 轮。归属冲突（旧主）→ 重读重试。
- R-04（SE1）@：指定不可用的秘书 → `unavailable`，原因写明；不换人。
- R-05（SE1）归属与有效目标分开派生，两个独立夹具（最后核对第 4 条）：
  - 夹具 a（转交后补目标）：轮 1 在 A、轮 2 转交到 B（`routing.to=B`）、轮 1 比轮 2 晚结束 → 归属仍是 B；随后只补 `goalAttribution` 的 `routing:null` 轮 3 → **归属保留 B，有效目标取该 `goalAttribution`**（最后核对第 4 条）。
  - 夹具 b（放下后补目标）：轮 1 在 A、轮 2 放下（`routing.to=null`、`reason:'dropped'`）→ 没有归属，按 L4 另挑；随后只补 `goalAttribution` 的 `routing:null` 轮 3 → **归属保留 null，有效目标取该 `goalAttribution`**（第二轮审查第 1 条；最后核对第 4 条）。
- R-06（SE1）还在处理：有排队轮 → `round`；只剩一个过期候选 → `candidate`；都没有 → 已处理完；再说一句 → 回到还在处理。状态投影：未领取→`queued`、claimed→`running`、answered→`ended`、结果未知→`unknown`。
- R-07（SE1）旧查询：没有 `requestRoot` 的旧查询读成一个只有一轮的请求，`roundKind:'request'`、`assignedSession` 从执行状态回填、`since` 从创建提交回填。
- R-08（SE2）驱动与合批：A 上排三轮（`since` c1<c2<c3），都是 A 的追问、**不取 `secretary-intake`**（第二轮审查第 2 条），执行最老一轮；准备读游标 **`c2 ≤ preparationCursor < c3`**（第二轮审查第 7 条）时，c2 作额外输入、原文不改；开始提交里 c2 标 `absorbedInto: <执行轮>`、读为 `ended`；回答挂执行轮；读时 c2 显示在执行轮下面。不跑多任务一次（第一轮审查第 4 条）。
- R-09（SE2）结果未知：一轮跑到一半重启、结果未知 → 不重跑，请求显示未知，等你处理；启动扫描释放已终态轮的 `secretary-intake` 认领。
- R-10（SE2）没有目标：第一句话（`goalId:null`）走 `callKind:'secretary'`，准备里有工作区概况、目标列表、没有目标卡，普通查询仍拒绝 null；回答带目标卡草稿（可多张，身份＝轮＋index）（第二轮审查第 4 条）。历史回答截到 2 KiB、最多 10 轮。
- R-11（SE2）回答格式：0 个思路、2 个、3 个收下；1 个、4 个退回 `invalid`；回答 `revision` 恒为 1。
- R-12（SE1）主对话：两个目标各三个请求，按目标读、分页、倒序；共享卡与队列按 itemId 去重（同一条只出现一次）；自动返工通知折成一条；没有目标时的请求显示在第一个目标开头；读以后已读位置不变。
- R-13（SE2）入口检查与改道：请求归属在 A，一轮在 A 上领取（`secretary-intake` 已取）但还没开始；此时 `requests/route` 转到 B。开始那一刻的提交发现 A 已不是当前归属 → 这次没进入的尝试按已有的“没进入就释放”放掉占用、`QueryRun` 身份记为已放弃，在 **B** 上另起一次（B 是当前归属，不取 `secretary-intake`）；回答挂在 B 上那次。claim-A → route-to-B → start 的次序（第二轮审查第 3 条）。
- R-14（SE2）初始化分支：项目没有采用的正式架构、或没有生效的完成标准时，秘书这一轮的执行种类是 `initial_coordination`、回答带 `setup`（architecture / completionPolicy / checks），**和普通 ideas 回答分开**；还没有目标的回答先存候选；目标确认那次提交写不可变绑定 `InitializationBindingV1 { answerRef, answerDigest, requestRef, draftIndex, goalRef, goalRevision }`（原 Job、回答、prepared manifest 都不改）；**走到公开的 `plans/propose`、`plans/apply` 和计划读取，确定 Goal、`planId`、版本都从绑定来，提议和采用都重读并守同一个绑定；绑定过期（版本变了、绑定找不到或草稿序号不符）报 `revision_conflict`/`source_stale`，重放的提议和采用回原结果、不重复建目标**（7D2 L41 第 1 段；审查二第 8 条；审查二第 19 条）；**采用仍是你的动作，走现有的 `ui/views/execution/planning.ts:274` 的 `adoptInitialPlanSetup` 路由**，采用事件的补记走 L14；最小根模块 `.` 允许（61-2；第 8 片 L10）。已有采用的架构和生效的完成标准时，同一请求走普通 `secretary` 路径（没有 `setup`）。（61-1、61-3）
- R-15（SE2）查询也记活动（L16）（审查二额外核对 D5）：经 `requests/submit` 给已初始化的目标 g1 发请求；秘书 S 这一轮由脚本模型在 2026-10-16T10:05:00Z、10:06:00Z、10:07:00Z 依次真实调用 `look_graph`、`find_graph`、`look_graph`，再输出回答（固定 Kernel 的 Date，照 2B 已有夹具的做法）。经 `activity/queries` 读这个 `QueryRunRef`：`counted`、步骤 3、编辑 0、`recordedBy: 'query_end'`；`activity/calendar`（目标 g1、`sessionRefs: [S]`、`hour`）10:00 那格步骤 3（其中查询 3），回答正文不另计；`activity/track` 里这一轮的查询横条 `activity.steps = 3`。再经已有的问一问入口问 S，副本在 10:20:00Z、10:21:00Z 调两次工具 → 副本那条的 `askedSessionRef = S`；日历 `sessionRefs: [S]` 当天合计 5 步，`sessionRefs: [S, 副本 Session]` 仍是 5（不重复）。Host 重启、再点一次补算以后仍是 5，补算的 `processed` 为空。在终态的提交边界让一次提交失败（存储边界替身，同 R-02 的例外）→ 终态和活动都没写；重试以后两者一起生效，重放不多写。
- R-16（SE2）查询的记录起点（L16）（审查二额外核对 D3）：工作区的 `querySince` 是 2026-10-16T09:00:00Z。一个 08:50 结束、没有记录的查询读作 `not_backfilled`，补算以后是正常（不标 `recorded_late`）；一个 09:30 结束、没有记录的读作 `not_recorded`、`error: true`，补算以后是 `recorded_late`、`error: true`；Run 的 `since` 不变。没有 `querySince` 的工作区读作 `no_recording_epoch`。（旧查询经存储边界替身造，同 R-02 的例外）
- R-17（SE2）没有目标的查询（L16）（审查二额外核对 D4）：还没有目标时发的请求（`requestGoalId: null`），秘书这一轮调 2 次工具 → 工作区范围的日历当天 +2，任何目标范围的日历都没有它；`activity/queries` 读到 `goalId: null`。角色线探索（`role_exploration`，`goalId: null`）同样只在工作区范围出现，这一段 7D2 联动补验。
- L-01（SE3）换手：A 输入量过阈值、手上两个请求（两个目标）、A 的最后一轮已写两份覆盖的理解 → **先查覆盖（不取围栏）、覆盖成立才取 `secretary-handoff:A` 并在围栏下重核**、走共享换手原语的阶段、新开 A2（接手自 A）、两个请求各一个 `routing` 轮（`reason:'handoff'`）、A 归档、一条请知悉；中途重启 → 从下一步接着；重复调用不重复建接任者、不重复通知（第二轮审查第 5、9 条）。
- L-02（SE3）覆盖不足 → `incomplete`，**不取围栏、不归档、请求不转**，在 A 上排一个普通轮请它写理解；下一轮写完覆盖后重跑换手。围栏一旦取得（覆盖成立后）Host 不在 A 上开始新轮，新提交仍入队并由 routing 转走；围栏下重核失败 → 放掉围栏、`incomplete`（第二轮审查第 5 条）。
- L-03（SE3）自动归档：空闲满一天、没有还在处理的请求 → 归档；项目里只剩它一条 → 不归档；有过期候选 → 不归档；两条合格时保留轮 `since` 最晚的那条；“请知悉”不算活动；每种职责至少留一条（这里只涉及秘书）（和 7D2 L38 同一条）。（第一轮审查第 6 条；审查二第 18 条）
- L-04（SE3）手动归档 A：两个请求，一个交给 B、一个放下；路由回每个请求的结果；放下的那个以后有人接着说 → 按挑秘书另挑。
- G-01（SE4）目标卡：草稿不建目标；草稿带 `screening`（含 `size`）；确认以后建目标、完成标准进卡文、草稿那一轮记上目标；同时确认两张建两个目标；草稿轮已不是最新回答 → `revision_conflict`；`commandId` 重放回原回执。**没有参谋能接、又因保留上限开不了新参谋时（7D2 L33），卡上写“参谋已满，先排队”，确认以后目标进队列、显示“排队等参谋 · 第 n 位”**（62-1；7D2 L33；审查二第 18 条）。
- G-02（SE4）复制：从进行中的目标复制 → `invalid`；从已取消的复制：位置、自治照旧，“等前一个”不复制、要重新确认；勾了两条干预记在新目标上；**同一次提交里用 `planReanchor` 把目标参谋、目标书记的负责关系挪到新目标**（`continuedFrom` 记“接续自”，7D2 L39）；**7A 前撤回端口未装 → 只记勾选的确认收下；端口已装但撤回失败 → 确认仍提交，撤回由 `goals/copy-confirm` 重放重试**（第二轮审查第 8 条）；取消草稿什么都不改；旧目标不动。（审查二第 18 条）
- P-01（SE5）思路和选择：回答带 3 个思路；你选第 2 个 → 排一个 `followup` 轮，`selectedIdea={round: 回答轮, index: 2}`、输入写明选择；回答不改；秘书出候选，候选属于这个请求。
- P-02（SE5）两个请求各出候选 → 候选卡各一张、互不遮住；同一请求的后一版候选替换前一版。手算夹具（目标 `g1`、工作区 `w1`）：第一版 `pp1`（版本 1）任务列表 `['t-parse','t-store']`，`t-parse` 写 `src/parse.ts`、验收 `parse.samples = 3`（版本 3）；`t-store` 写 `src/store.ts`、import `src/parse.ts`、验收 `store.replay = true`（版本 1）；依赖边 `[t-store → t-parse]`。第二版 `pp2`（版本 2）替换第一版：`t-parse` 保历史、标 `superseded`、`replacedByTaskId: 't-parse2'`，新任务 `t-parse2` 写 `src/parse2.ts`、验收 `parse.samples = 5`（版本 4）；任务列表 `['t-parse','t-parse2','t-store']`；`t-store` 改 import `src/parse2.ts`，依赖边 `[t-store → t-parse2]`；替换回执 `{ taskId: 't-parse2', replacedTaskId: 't-parse', 版本: 4 }`。**物理删任务不支持**，撤掉的走取消、保留 `taskId` 记 disposition（`plan-validation.ts:324`）（第二轮审查第 7 条；最后核对第 3 条）。
- P-03（SE6）按答复改验收：你的答复消息 `m-user-7`（正文 `UserDecisionBodyV1`）带 `approvedPayload = { answerRef: 'answer-9', payloadDigest: 'd1' }`；秘书回答 `answer-9` 的授权载荷只许 `acceptance`，对象是 `t-parse` 的验收、版本 3；`plans/propose` 的 `decisionRef = 'm-user-7'`；提议改范围 → `revision_conflict`；对象版本已从 3 变 4 → `revision_conflict`。一致时按同一手算夹具出计划第 4 版：前版任务列表 `['t-parse','t-store','t-docs']`，`t-parse` 写 `src/parse.ts`、验收 `parse.samples = 3`（版本 3，已完成，证据 `ev-1`），`t-store` 写 `src/store.ts`、import `src/parse.ts`、验收 `store.replay = true`（版本 1，running），`t-docs` 写 `docs/readme.md`、验收 `docs.links = 0`（版本 1，不相干），依赖边 `[t-store → t-parse]`；后版 `t-parse` 保留、标 `superseded`、`replacedByTaskId: 't-parse2'`，新增 `t-parse2` 写 `src/parse2.ts`、验收 `parse.samples = 5`（版本 4），`t-store` 改 import `src/parse2.ts`（依赖边 `[t-store → t-parse2]`），`t-docs` 不变；`t-store` running → 先停（`stopping_affected_work`）；采用回执 `{ planRevision: 4, 替代: { 't-parse': 't-parse2' }, 改接边: ['t-store → t-parse2'] }`；旧证据 `ev-1` 不满足新验收（第二轮审查第 6、7 条；最后核对第 3 条）。
- P-04（SE6）初始化补记：答过“缺完成标准”的卡、初始化采用事件带 `acknowledgementRef` → 卡关成“来源已解决”；改动前答过的卡读为 `source_resolved`＋“没有证明（旧数据）”，**读只投影关闭状态、不写**；补记中途断了，由 Host 启动步骤或 `decisions/application` 重试修复，不靠读卡（第二轮审查第 8 条）。

### 5.3 要改断言的旧测试（冻结时 lead 按合入后的基线核一遍）

- 查询的编解码和状态写入表（`tests/architecture/state-writes.test.ts`）：QueryJob 加字段、`since` 绑定、`routing` 轮构造。
- 候选计划请求读取的测试（第 5 片 `request-facts-reader` 的用户）：`currentSecretary` 从 null 变成真实的；有效目标不再是根 `goalId` 相等；lead 冻结时逐条列出前后断言。
- 未来修订拒绝非空 `decisionRefs` 的测试：6C 翻转。
- 删 `UserDecisionV1` 涉及的测试：6C 冻结时列全。
- 挑秘书的旧测试：来源只有“职责秘书、空闲、不太长”时不变；新增范围过滤、未分配和开局秘书/手工秘书的用例，lead 冻结时列前后断言（7D2 L26、L27；审查二第 18 条）。
- 目标草稿的旧断言：`goalCardDrafts` 加 `screening`；lead 冻结时列前后断言（62-1）。
- 复制确认的旧断言：复制不再只说“旧目标不动”，加 `planReanchor` 挪负责关系；lead 冻结时列前后断言（7D2 L39；审查二第 18 条）。

## 6. 文件（影响面；施工时以实际为准，超出要报）

- **6A：** `src/contracts/query-job.ts`；L16 的查询活动：`src/contracts/run-activity.ts`（`QueryActivity`、`ActivityRecording.querySince`）、`agent-runtime/run-activity-tally.ts`、`agent-runtime/query-observation.ts`（终态提交里写）、`agent-runtime/runtime.ts`（`countRunActivity` 旁加查询那一支）、`queries/query-execution.ts` 的 QRR-03/04/06 收束、`business/workflow/activity-backfill.ts`（查询候选和写入）、`views/activity-read-model.ts`（日历的范围和查询一栏）、`views/track-read-model.ts`（查询横条的 `activity`、问一问按 `askedSessionRef` 归线）、新索引 `s6-query-run-by-workspace-ended`、路由 `activity/queries`（审查二额外核对 D2）；`queries/query-record-codecs.ts`（字段、`s6-query-by-request`、`s6-query-queued-by-session`，2B、2C 也加查询索引，合入时手工合）；`state/query-run-recovery.ts`（没进入就释放、`QueryRun` 身份记已放弃）（第二轮审查第 3 条）；新 `model/request-contracts.ts`、`tasks/request-facts-reader.ts`（改成真实读取、`ownerOf`、`effectiveGoalOf`，**归属与有效目标分开派生**）（第二轮审查第 1 条）、新 `views/main-surface-read-model.ts`、新 `queries/request-service.ts`（含 `route`、`selectIdea`、`ask`；挑秘书按范围过滤（7D1 的负责关系 `RoleScopeV1`），**仅新请求分配取 `secretary-intake`**）（第二轮审查第 2 条）；`agent-runtime/query-preparation.ts`、`query-execution.ts`（`secretary` 调用类、没有目标的准备、**初始化分支执行种类 `initial_coordination`**、职责、**开始时的归属/围栏入口检查**）（第二轮审查第 3 条）；`src/app/host.ts`（秘书轮驱动、启动扫描、认领释放）；组合根、路由（审查二第 18 条）。
- **6B：** `workflow/session-maintenance.ts`、`session-archive.ts`（秘书这一类、保留 `since` 最晚，和 7D2 L38 一致）；新 `workflow/secretary-handoff.ts`（**先查覆盖、再取围栏、围栏下重核；走共享换手原语的阶段**）（第二轮审查第 5、9 条）；`model/task-contracts.ts`、`tasks/task-service.ts`、`src/contracts/ledger.ts`（`continuedFrom`、`copiedInterventions`）；目标草稿的 `screening`（62-1，7D2 的 `GoalScreeningV1`）、目标卡“参谋已满，先排队”的文字；复制确认里接 7D1 的 `planReanchor`（7D2 L39）；第 4 片的 `note-tool.ts` 注册给秘书；撤回端口的注入点（7A 前缺省不接；已装但失败时确认提交、重放重试）（第二轮审查第 8 条）；组合根、路由（审查二第 18 条）。
- **6C：** `agent-runtime/query-preparation.ts`（回答格式、授权载荷）、`workflow/workflow.ts`；`src/contracts/query-job.ts`（`authorization`）、`src/contracts/goal-decisions.ts`（`UserDecisionBodyV1.approvedPayload`）（第二轮审查第 6 条；最后核对第 1 条）；`state/plan-machine.ts`、`tasks/initial-plan.ts`（:126、:140、:150）、`tasks/plan-service.ts`（:1147、:1225、:1253）、`plan-validation.ts`、`persistence/plan-record-codecs.ts`（**无 Goal 的读取和规范化消费 `InitializationBindingV1`、取 Goal 版本和 `planId`，`src/contracts/query-job.ts` 加这个契约；审查二第 8 条**）；`communication/decision-application.ts`（认 `ArchitectureCatalogAdopted`、`ProjectCompletionPolicyActivated` 的 `acknowledgementRef`）、`decision-source-facts.ts`、`views/decision-read-model.ts`（只读投影历史卡）；删 `UserDecisionV1` 的那一组文件。
- **文档（lead 写）：** STATE-MACHINES-SPEC 新行（§3 的行全部列出）、替代与切换的状态表（6C 冻结前）；DESIGN §1.1（归属的存法）、§9.3（阈值）；MODEL O19、O20、O51 的接口表示；E3-UI-ITEMS（主对话、交给谁、思路、改了什么、复制目标、共享卡、“问秘书”“重出”、秘书名）；STATUS、能力索引。

## 7. 施工

- **前提（第一轮审查第 11 条）：**
  - 6A 的核心在 2C 合入以后；完整验收要 6A 的两个索引和 Host 驱动。
  - 6B 的核心在 6A 冻结的契约（回答、思路、目标草稿）和第 4 片（4A、4C）以后；完整验收要 6A 合入。
  - 6C 的核心在 6A 契约和 2B 以后；**完整验收另要 6B（确认、复制）和第 4 片**，消息相关要第 7 片；答复 `approvedPayload` 的绑定在 6C 成立（第二轮审查第 6 条）；**按审查二第 18 条的新顺序，6C 排在 7D2（8D 之后）之后，无 Goal 初始化的提议、采用和计划读取在 6C 收口**。
- **换手原语（第二轮审查第 9 条）：** 6B 先用共享换手原语的阶段（不带工具、不带审批卡）；7C 才给这个原语加 agent 工具和审批卡。
- **决定 60–62 的接缝：** 6A 的“挑秘书按范围过滤”依赖 7D1 的负责关系（`RoleScopeV1`；含保留上限满时的“未分配，秘书已满”和排空）；6A 的初始化分支（和普通 ideas 回答分开、没有目标的回答先存候选后绑定并写 `InitializationBindingV1`）和 6B 的目标卡 `screening`（含 `size`）、复制挪责任、`secretaries` 的闲置归档依赖 7D1 的 `planReanchor` 和 7D2 的 L33、L38、L41；前面小片按“只有开局三条线、范围都是整个项目”的行为先做，多秘书范围和队列在 7D2 跑通（7D2 §A）。（审查二第 7、8、18 条）
- 每小片一个副本、一个新的 DSH Session；施工前 DSH 先通读、报看不懂的地方；任务书带 lead 推荐的分组和“可以调整、写明理由”、“子任务没回报完之前不要结束回合”。
- 夹具由 DSH 写，只经公开服务造；例外只有 R-02 的存储边界交错提交替身，和 R-15、R-16 的存储边界替身（L16）。
- 真实模型试跑规划协议：施工后，要你授权（第 6 行的验收）。

## 8. 不做的事

- 不建请求表、不建转交记录（决定 49）。
- 秘书不改代码、计划、目标；采用和记下你的话只由你点。
- 不做主、子秘书；不按目标强制拆秘书。
- 不在本片发消息、派工（第 7 片）。
- 不按目标新建完成标准记录：没有现成记录，完成标准进卡文（第一轮审查第 7 条）。
- 不物理删任务：物理删除不支持，撤掉的义务走取消、保留 `taskId` 记 disposition（`plan-validation.ts:324`）（第二轮审查第 7 条）。
