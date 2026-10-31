# 第 7 片规格：派工、干预、等待、换手

**后注（7D1 任务书冻结，lead 2026-10-27）：** 7D1 的任务书已冻结（Codex 两次完整审查、一次快速核对，lead 逐条裁定）。和正文冲突时以本后注为准；产品范围不变。下面的行号和 7D1 的书一样，按加这条后注之前的版本（754 行）。
- **新错误带的字段（`:565`）：** 新错误照旧用现有的 code、只加 reason；另外 `revision_conflict/scope_owned` 多带一个 `scopeOwned` 字段，写明占着这个范围的是哪条线，卡片靠它说出这条线。
- **7D1 之前建的线（L31 `:257`、`:259`，L34 `:287`）：** 按决定 79 不做旧记录兼容，这三处的旧线读法作废：不读出 `openedBy: 'legacy'`、`creator: unknown` 或系统名，也不按项目把现有 Session 扫一遍去补持有。没有持有记录的线算 0 个持有；算进持有、却读不到角色事实的，持有读回 `unavailable`，不编一个旧事实。
- **`create_member` 的范围（L17 `:189`）：** 只有执行者、只有任务（7C 已这样冻结）。“目标”从 `create_member` 的范围里撤掉，以后也没有哪一片补：执行者加目标在 L23 里没有含义，模块范围的执行者就是维护者（8B-2），项目范围走角色线。7D1 让目标成为合法的联系目标，不是建成员的范围。
- **非任务的依据（L25 `:215–221`）：** 目标臂只核 Goal 存在、在同一个项目、它的 revision，不要求目标 `active`，也不读计划；项目臂只比 `projectId`，不守 revision；模块臂沿用目录读出的模块事实和它带的守卫。
- **参谋指定维护者的工具（seam L-07 改）：** `assign_module_maintainer` 工具、卡片来源 `module_maintainer_assignment`、凭证的生成和核对、提示词条目和接线，都和唯一的写者 `assignModuleMaintainer` 一起放进 8B-2 的第一段；7D1 只冻结两种可信调用分支的类型。
- **跨工作区转发（7B 冻结的“同工作区，直到 7D1”）：** 7D1 放开到同一个项目的别的工作区；跨项目仍拒绝。读和回复的一般入口不放宽。
**后注（7B-1 落地，lead 2026-10-30）：** 7B-1 已落地（`bef7513b`）：等待从消息读，三种接续和领取，接受和它的消费认领，到期 owner，Runtime 输入顺序，六个送达模板，Workflow 的续作选择，Host 的到期心跳。落地后按 `:96`、`:626` 两行读：意图 `notify` 的“请知悉”永不开模型轮；R4-17 修的是 Host 收件箱分派把它当成人的干预、以及用 `return` 结束整次扫描（`src/app/host.ts:1746`）：现在跳过、留在队列，后面的提问和发件箱照常。秘书的到期轮、消费遍及所有 Session 和提交唤醒在 7B-2；转发、空闲线和已做完的线的干预、咨询在 7B-3。

**后注（7B-2 落地，lead 2026-10-31）：** 7B-2 已落在 `8e55756c`（本地，10-31）：Host 空闲时按可消费 Session 的分批视图消费（按 Session 键续读、按 profile 匹配模型，`notify` 不开轮）；目标等待登记表在 `wakeLoop.start` 时从每个 Session 的等待和已放行未处理的动作用只读重建，`resumeOnStartup` 关时只登记、不排空；有待处理重启中断的 Goal 不登记、不叫醒（判据读 Goal 显示），重建失败下次排空重跑；秘书的回复和到期各开一轮（`reply`/`expiry`），同一处理点的几条并成一轮，`entered` 时按轮的 manifest Session 消费，交接后的接手者也能答，到期唤醒请求轮队列；`notify` 跟下一个真实轮进上下文，只带 notify 的供给不收人的消息（R-19）；`project_source` 的 `compare` 加 `duplicates: true`，两份捕获、两个提交、一个提交对当前工作树三种比较都适用，平台包的说明句重新生成。7B-3 第一波（F 的转发和等待处置、咨询创建读、Q 的两个 Query 配方）已并进同一条线；N、P、V、CS、G 和 7B-3 L 还没并入。

**后注（7B-3 落地，lead 2026-10-31）：** 7B-3 已落在 `aedb093d`（本地，10-31）：这次的六组 N、P、CS、V、G、L 都已合入；N 的断开通知来源和 Host 系统 notify 构造器、P 的复制转发（目的地没了读“待你指定收件线”，`FORWARD_DESTINATION_GONE`）、CS 的问已退役线（咨询 Query 读结构化历史窗口，准备好的那一轮冻结正文）、V 的干预规划（含已完成 Goal 的接续 Goal）、G 的 L46 阻塞（每次推进重建，不存）和 L 的两条人用路由（`messages/forward`、`waits/dispose`）、Host 钩子，以及 `platform.messageForwarding`、`disconnect` 的发布。落地树 `7b3-land`（`8fae469`）上全量 1,061 个文件全过、12,808 项过、3 项跳过、852.13 秒（6 个并行；build、typecheck、check:architecture、kernel-patch 检查都是 0）；规模批 13 个文件 40 项全过、850.27 秒（4 个并行）。

**后注（决定 89，lead 2026-10-24）：** 决定 89（并行成员防重复）的五段 skill 正文和落地顺序在 [HANDOFF 决定 89](../../../HANDOFF.md)；其中和能力 B 有关的一段留给 7B，施工时按下面写进 7B 的任务书：
- **加什么。** `project_source` 的 `compare` 加一个选项，列出重复候选：只给候选，判断留给 agent（和 PRODUCT 写定的做法一致，`PRODUCT.md:198`：冲突检查放在数据结构的工具里，由编排的 agent 决定）。
- **候选池。** 只取同一次比较之后的那份材料、只在授权范围之内；“新加的”按比较前的那份材料判。不再扫描活动工作区，避免混进比较之后才发生的新变化。
- **列什么。** 新增或修改的 TS/JS 文件里新加的顶层定义，候选池里别处有同名定义的；新加的较长字符串字面量（长度门槛施工前定），别处也出现的。两种都列出两处位置。
- **不列什么。** 比较前就已存在的重复；变化提醒（7C 的 L21）不加“新定义”一类内容。
- **报告。** 扫描覆盖了多少、没覆盖多少，和输出截断是两件事，分开报。
- **实现。** 复用已有的捕获、符号和文本读取，不另建持久索引。
- **谁用。** 执行者做完前自查，审阅者审查，参谋看完成说明时。
- **为什么。** 在同一个工作目录里，“提交对工作区”的比较会把同伴还没提交的改动一起算进去，所以同伴之间正在写的重复也看得到。
- **怎么验证。** 确定性测试，期望值手算：两份同名定义和同样的字面量被列出；比较前就有的旧重复不列；只改了一个文件时，没改的文件也作为“别处”参与比对；授权范围外的材料不进候选；超过上限时，截断和覆盖分开报。行为核对进 MVP 真实模型重跑的 E05（[MVP 行为](../../../MVP-BEHAVIOR.md)）。

经过见证据（已归档：`D:\1.project\Software\agent-next-archive\docs\refactor\reviews\decision89-dedup-2026-10-24\`）。

**后注（决定 86-2，lead 2026-10-21）：** 旧浏览器工作台 `src/ui` 已删（代码在标签 `old-ui-last`）。§7“共用的登记文件”里的“界面路由表”（旧 `src/ui/api/routes.ts` 的 `ROUTE_LABELS`）随它删了，新路由后缀不用再在那里登记；组合根、路由、HTTP 类型、Workflow 的契约和端口照旧按合入顺序改。

**后注（决定 83-4，lead 2026-10-21）：** 下面那条后注说的“提示词和上下文”一节已冻结：[slice-6-7-PROMPTS-SPEC](slice-6-7-PROMPTS-SPEC.md)。提示词和上下文以那一节为准，本片别的行为不变。和本片有关的：
- **7A、7B：** 消息送达时写成 user 消息的几段话各一个模板：`action-request-delivery`、`inquiry-delivery`、`notify-delivery`、`wait-reply-delivery`、`wait-expiry-delivery`、`intervention-delivery`；7B 的 L11 另有 `intervention-planning`。
- **7C：** L18 执行者和参谋换手不写 `sessionBasis`，不带前任的对话历史；前任按 `handoff-write-understanding-<职责>` 写当前理解，接任者拿 `handoff-brief-<职责>` 简报（执行者在任务这一层，参谋在阶段或区域这一层，参谋的简报带最近 3 次 Query 回答），加记忆指针和全套工具（P7）。结构审查 B4（拆接续简报）在 7C 之前，范围见那一节 P7。
- 这些模板都用那一节的模板包和渲染器，可以按模型改。

**后注（决定 83，lead 2026-10-18 晚）：** 本片冻结后要补一节“提示词和上下文”：秘书、派活、等待、转交、干预的提示词做成可配置的模板，按提供方和型号选版本，不写死在代码里；超长时保住当前任务和角色说明；思考带不带回按模型定；记下每次实际发出的整套提示词。见 [HANDOFF 决定 83](../../../HANDOFF.md)。这一节在 K3、C1、T 之后由 lead 起草，冻结后再开 6A；在那之前不要按本稿施工提示词部分。

**后注（4A 合入，lead 2026-10-16）：** 7D1 多一项：接线包 1 冻结的职责解析器在 RoleSpec 读不到时回 `unknown`（不报失败），所以这样的书记会从第 4 片的书记范围里掉出去（第 4 片规格 §9）。7D1 建角色线的共享基础时定：解析器读失败要不要报 `unavailable`，让范围计算整体回 `unavailable`（4A 已经把“解析被拒或抛错”当成 `unavailable`）。另：4A 的注记作者按 Session 认，换手的后继不是作者；真的换手由第 7 片接。正文原样保留。

**后注（决定 72 的复用盘点，lead 2026-10-16 夜）：** Codex 把第 6、7、8 片和 K3、4C 剩下的部分放在一起找共用机制，两个 Claude 子 agent 逐条核过引用和代码，lead 裁定。和正文冲突时以本后注为准；产品范围不变。和本片有关的（第 6 片规格开头有同名后注）：
- **换手（L18、H-01）：** 共用原语在 6B，身份就是本片的 `handoff` SessionOperation，建接任者是它的子操作。阶段顺序统一为：等旧写者停 → 建或选接任者 → 转负责 → 归档（L18 已写明工具在旧线的执行里调、换手排在这次执行结束以后）。H-01 的 t1（建新 Session）和 t2（等旧执行结束）对调，两个崩溃点的要求不变。
- **建成员和角色线（L17、L26、L27、L42）：** 调 6A 的共用建线入口；本片 §1 和 L31 的保留名额填进它的名额那一步。同时运行的准入仍在 7D2。
- **L38：** “每种职责的项目范围由一条线负责”只说参谋和书记。秘书的项目范围是过滤，不占位（L23，决定 60-3），可以有几条项目范围的秘书。闲置的钟和第 6 片 L15 相同：从最后一次活动算起满一天。**（决定 91 取消闲置归档，见 L38 的旁注。）**
- **`planReanchor`（L25）：** 留在 7D1；7D1、7D2 以前没有挂在目标或项目上的负责链接可挪。
- **落实证明（L1、§6 的 7A）：** K3 第 4 组或 4C-2（先做的那个）把 `decision-application.ts` 的证明解码改成按事件种类登记的表；7A 的消息落实在表上加一行、复用共同的回执核对，不另写一个“照 decision-application”的校验器。
- **等待和唤醒（L7、L8、L10、L12）：** 用 6A 的共用唤醒循环；7B 加“输入真被接受才消费等待”的派生等待和到期输入；7D2 的参谋队列（L33）只注册自己的排空。
- **请知悉（L21、L43）：** 通知和卡的“目标或项目”主体底座在 6B；7D1 加跨工作区身份。L43 的按主体和时间窗汇总是 4C-2 共用汇总投影的一种策略，不存汇总记录。
- **提醒和收件人（L21、L35）：** 用 4C-2 的提醒投递外壳；第 4 片书记收件人的兜底只在一个解析器里，7D 换成正式负责范围。7C 改 `host.ts` 的注意力时改用这个外壳。
- **Workflow 的任务门（L46）：** K3 第 3 组建“放行 / 跳过（带阻塞来源）/ 做核对一步”的门结果；7B 在同一结果上加正式依赖和唤醒，并改 `automationConfirmation` 的整个目标提前返回。
- **结构提议批次（L41 第 6 段、§1）：** 由第 8 片 8C 唯一定义（成员、pin、ops、去向、摘要）；本片的这些文字是引用。
- **路径归属（L23、L28）：** 4C-1 合入后文件归模块只有一个纯函数；有效区域读它，不另写最长前缀。
- **§0.4 的 2B 一条已改正：** “太长”按模型输入量判定（L29），不用 2B 的执行改过的文件。

> **2026-10-15 晚：按决定 60、61、62 和 7D 第二稿改了 7D 接口、规则、状态行、测试入口和验收、文件；冻结前 lead 逐行审；又按 7D 勘误 E1–E11 和决定 63 改；又按审查二（19 条）的 lead 裁定改；lead 逐行审过这一稿，补的地方标“审查二 lead 补”；Codex 最后一次快速核对的必改由 lead 改完（标“审查二快速核对第 n 条”）；经你同意又加了一次只看改动的额外核对，它的必改由 lead 改完（标“审查二额外核对 Dn”）。**已冻结（2026-10-15 晚，你确认了测试入口）。**
> **状态（2026-10-15 凌晨）：内容定稿，等你定 §0.1 后冻结。** Codex 两次完整审查加一次快速核对都用完了（决定 56 的上限），最后一次结论“改完后冻结”，那几处已照改（标“最后核对第 n 条”）。冻结前 lead 还要通读全稿一遍。下面原来的状态说明保留作记录。

> **状态：lead 第一稿，2026-10-15 夜；第一轮审查（Codex）后按 lead 裁定 1–18 改稿；第二轮审查后按 lead 裁定 1–9 改稿（另顺带 1 条）。** 按决定 58，和第 2 片的施工并行起草。
> - 冻结前还要：你定 §0.1 的几件事；Codex 审（最多两次完整审查加一次快速核对，决定 56）；lead 在第 4、6 片、2B、2C 合入后的基线上重核 §0.2 和 §6。
> - 代码事实：Codex 只读事实清单（`D:/cc-lead-notes/codex2/s7facts.out.md`，HEAD 5c7a3258），lead 核过 F1、F4、F6。
> - 依据：HANDOFF 决定 35（Q18–Q22）、37、38、42、49（答复页第 14–22 项）、56；DESIGN §1.3、§1.6、§1.9、§2.4–§2.11、§4.4、§4.6、§5.3 工具表、§8.2 第 7 行（L1250）；MODEL O23、O24、O27、O44、O54，R08、R18、R34–R42、R56、R57。
> - 标注：第一轮审查 1–17 条是必须改、18–19 条是顺带改。改动的行在行尾标（第一轮审查第 n 条），n 是审查条号。第二轮审查 1–9 条是必须改；改动的行在行尾标（第二轮审查第 n 条），顺带那条标（第二轮审查顺带改）。

## 0. 冻结说明（lead）

### 0.1 要你定的

**1. 拆成五小片（7A、7B、7C、7D1、7D2）（建议拆）。** 第 7 片是最大的一片。（审查二第 18 条）
- **7A 消息和派工：** 消息的新字段和处置（被拒、到期、转发、转交、撤回、待放行）、派工的三版核对和派工序号、所有有权者派工、「每步确认」下的待放行和放行卡。
- **7B 送达和等待：** 消息在安全点送达、用户输入优先、等待保留、到期、迟到的回复、断开、重启后接着、提交唤醒、空闲线和已做完的线的干预、秘书的“请回答”回复或到期开下一轮、问一问已退役的线、复制目标时干预的撤回和转发。
- **7C 挑人、建成员、换手和工具：** 按含义挑执行者、优先并行不重叠的任务、建成员、换手工具和批准卡（共用的 Runtime 换手动作在 6B）、返工和重新检查的工具、参谋和书记的确认和回复工具、注意力发给参谋、自动返工通知秘书和参谋、`apply_future_plan` 去留。（第二轮审查第 8 条）
- **7D1 共享基础（在 8C 之前）：** `WorkLinkTarget` 加 `goal`、`project` 的整套；`planReanchor`/`reanchorSessionResponsibility` 和 transfer 的扩展；`role-scope:` 占位；项目主体的卡源和请知悉的基础（`DecisionSubjectV1`、`notifyProject`）；`SessionRoleFactsV1`；`RoleLineAllocationV1` 和保留准入。（审查二第 18 条）
- **7D2 角色线编排（在 8D 之后）：** 开局线、你开线、位置、拆分、运行准入、上限卡、队列、规则、冷启动、L46 以外的 7D 规则；L46 仍属 7B。（审查二第 18 条）

顺序 7A → 7B → 7C → 7D1 → 8A → 8B → 8C → 8D → 7D2 → 6C。7A 要第 4 片（当前理解的指针）和第 6 片（秘书回合的发信方、请求归属）；7B 要 7A、第 6 片的 6B；7C 要 7A、7B、第 4 片（换手前写当前理解）和第 6 片的 6B（共用的 Runtime 换手动作）；7D1 要 7A（消息）、7C（建成员、换手工具）、6B（共用换手动作）；7D2 要 7D1、7A（消息）、7B（L46 等待只挡一支）、7C（建成员、换手工具）、6B（共用换手动作）、8A（文件级观测、代码量、根路径）、8B（containment、区域）、8C（修订带负责去向、结构修订提议通路）、8D（多语言观测的引用关系）。（第二轮审查第 8 条；审查二第 18 条）
- (a) **拆成 7A、7B、7C、7D1、7D2（建议）。**（审查二第 18 条）
- (b) 不拆。

**用户 2026-10-15 晚定：(a) 拆。**

**2. 测试入口（§5.1 的 TE1–TE8）。**（决定 60-1、60-3、60-4、60-7、60-8、60-10；61-4；62-1、62-2、62-3、62-4、62-5、62-6）

**3. `apply_future_plan` 去留**（第 7 行列的待定项）。今天它是一个已实现、但普通授权里没给出去的工具：agent 直接采用未来计划。
- (a) **删掉（建议）。** agent 只经 `plans/propose` 提议，采用照自治级别由平台或你做（「方案确认后自动」下范围内的细化自动采用，DESIGN §1.3）。少一条绕过自治的路。
- (b) 留着，只给参谋。

**用户 2026-10-15 晚定：(a) 删掉。**

**4. “请回答”的默认期限。** 设计没给数（AMB-24）。建议发信时不写期限就是 24 小时；可以按消息改，可配置。没实测。期限从放行开始算，不放行不计时（第一轮审查第 3 条）。
- (a) **24 小时（建议）。**
- (b) 你给一个数，或默认不设期限（只有写了期限的才会到期）。

**用户 2026-10-15 晚没有异议，按 (a) 24 小时。**

决定 60、61、62 已定（2026-10-15），7D 是新加的小片、审查二第 18 条又拆成 7D1、7D2；TE8 和其他测试入口一起等你确认。

**告知（lead 的技术取舍，不用你定，你可以改）：**
1. **没有等待表**（决定 49）：等待从消息和让出的执行读出来（L7）。今天“在等”只看最近一次领取，干预跑了一次就会把旧的等待盖住（F4），本片改成从消息读；2C 的线状态输入 T7 也一起改成按 L7 读（`docs/refactor/design/orchestration-2026-10/slices/slice-2C-SPEC.md:1054`；第一轮审查第 16 条）。
2. **派工序号每个目标一个**（附录 C 新记录第 3 种）。创建 `awaiting` 不加；只在让动作可派的那次提交里加一次（直接发是发信那次，每步确认是放行那次）；消息上的 `pins` 是那次核对的值（加之前）；同一 `commandId` 回原回执、指纹不同报 `idempotency_conflict`；计数不存在时守卫「必须不存在」，首次派工写 `sequence: 1`（0 表示还没有）。（O23、O54；第一轮审查第 2 条）
3. **优先并行不重叠**只做软排序，不做按语义的准入或全局锁（决定 49）。要派第二个任务、而它声明的模块和正在跑的任务重叠时，先让这个目标的参谋（没有就秘书）在那个模块上记一条接口约定注记，第二个任务等注记或“放行”才派；只核版本（L16；第一轮审查第 12、18 条）。
4. **提交唤醒**只在内存里登记，不另建调度库；登记键是 `(projectId, goalId, recordKinds)`，登记时读游标。观察（F6）只给项目和聚合种类，不给目标身份；匹配到 `(projectId, 聚合种类)` 时，取这个项目里登记过的目标（有界），逐个重核它们的等待事实，仍等的才唤醒，立刻做一次有界排空（不等心跳），排空的余下立刻排成下一次、不等新的提交，心跳只查到期；离开等待就移除，启动时把重建出的就绪工作立刻入队（R56；第一轮审查第 8 条；第二轮审查第 6 条；最后核对第 4 条）。
5. **被动通知**：意图 `notify` 的“请知悉”永不开模型轮，留到下一次自然轮在上下文里读（第一轮审查第 15 条）。

### 0.2 代码事实（5c7a3258；lead 核过的标 ✓）

| # | 事实 | 出处 |
| --- | --- | --- |
| F1 ✓ | 消息有收件、发信执行、发信 Session、回复处理方、工作区和状态、用户和目标几个索引；状态只有旧的 `pending/read/responded`；意图是 `notify`、`inquiry`、`action_request`、`decision_request`；`ackMessage` 是“读过了”，不是“落实/拒绝” | `src/core/work-graph/sessions/message-record-codecs.ts:95`、`:126`；`src/core/work-graph/model/communication-contracts.ts:98`；`src/contracts/core/session-message.ts:35`；`src/core/work-graph/state/message-machine.ts:584`、`:1029`（第一轮审查第 1、18 条） |
| F2 | 普通发信从可信身份带出 Host 或执行的身份；回执重放、记录守卫已有；自治策略已有秘书的动作和询问；`message_release` 是声明过的决定来源，读取报 `unsupported` | `src/core/work-graph/communication/mailbox-service.ts:1977`、`:1825`；`src/core/work-graph/state/decision-policy.ts:31`；`src/core/work-graph/communication/decision-source-facts.ts:621`（第一轮审查第 18 条） |
| F3 | 执行的输入按消息和回复的身份去重，只在 Kernel 提交 `run.input_accepted` 以后才算消费；今天先给保存的回复，再给普通邮件；询问不进普通输入；Host 空闲时只扫配置的消费者 | `src/core/agent-runtime/execution-inputs.ts:103`、`:218`；`src/app/host.ts:1028`（第一轮审查第 18 条） |
| F4 ✓ | `readSessionFacts` 只按最近一次 Work 领取算“在等”；再开一次执行会把前面的等待盖住 | `src/core/work-graph/tasks/session-facts.ts:222-270`（第一轮审查第 18 条） |
| F5 | 让出的回复轮询、只按回复接续、归档时取消或转交回复处理方、按路由和未送达读回复已有；`ConsumedWaitV1` 只有 `wait_reply` 这一支要真实的回复产物（第二轮审查第 1 条） | `src/app/collaboration-driver.ts:694`；`src/core/work-graph/state/message-machine.ts:832`；`src/contracts/dispatch.ts:273`；`src/core/work-graph/communication/mailbox-service.ts:2988`、`:3124`、`:3211`（第一轮审查第 18 条） |
| F6 ✓ | 成功、非重放的提交会带游标和聚合种类、项目发出（只给项目和种类，不给目标身份）；Host 接了变化流和目标控制的扇出观察 | `src/composition/commit-observer.ts:68`；`src/app/host.ts:437`（第一轮审查第 18 条；第二轮审查第 6 条） |
| F7 | 挑执行者：先负责目标，再提示，再第一个职责匹配可复用的 Session；排除在等、副本、归档中；目录扫描最多 8 页、每页 50 | `src/business/workflow/workflow.ts:694`、`:715`、`:790`（第一轮审查第 18 条） |
| F8 | Runtime 有两段式建 Session 和 `sessions/create` | `src/core/agent-runtime/session-operations.ts:526`、`:559-695`（第一轮审查第 18 条） |
| F9 | 负责关系转移在写者停下、版本守卫下关旧开新；接续交接和归档恢复已有 | `src/core/work-graph/state/session-responsibility.ts:33`；`src/core/work-graph/sessions/session-responsibility-service.ts:359`；`src/business/workflow/workflow.ts:1595`；`src/business/workflow/session-archive.ts:723`（第一轮审查第 18 条） |
| F10 | 委托的重新入队、重新检查服务已有；系统和 agent 的重新入队共用计数；自治拒绝已强制；邮箱的确认、回复适配器已有，普通 Host 授权没给；`apply_future_plan` 适配器还在，普通授权没给 | `src/core/work-graph/tasks/requeue-service.ts:573`、`:931`；`src/core/work-graph/evidence/evidence-service.ts:790`、`:1932`；`src/core/agent-runtime/communication-tools.ts:296`；`src/app/host.ts:244`；`src/core/agent-runtime/whiteboard-tools.ts:234`、`:437`（第一轮审查第 18 条） |
| F11 | 注意力增量发给配置的一个 Session；自动返工的通知从重新入队、检查读出来，明确不唤醒 agent | `src/app/host.ts:1083-1144`；`src/core/work-graph/views/automatic-rework-notices.ts:19-22`、`:69`（第一轮审查第 18 条） |
| F12 | 咨询建一个固定的只读副本，答完归档副本；新咨询拒绝已归档的来源，完整历史边界读不到时停下 | `src/business/workflow/consultation.ts:104`、`:375-400`、`:503`（第一轮审查第 18 条） |

### 0.3 lead 定的技术选择

**7A**

- **L1 消息的新字段（O24）。**【lead 定，待审】`SessionMessage` 加（旧的 `pending/read/responded` 保留，和下面这些互相独立）：
  - `taskRef`、`requestRoot`（秘书发的，第 6 片的请求）、`followupOf`（同一问题的追问链）；
  - `deadline`（“请回答”有，缺省按 §0.1 第 4 条；从放行起算，第一轮审查第 3 条）；
  - `release: 'released' | 'approved' | 'awaiting' | 'denied'`；`delivery: 'queued' | 'delivered' | 'undelivered'`；`deliveryEvidence: 'accepted' | 'legacy_unknown' | null`（第一轮审查第 1 条；第二轮审查第 3 条）；
  - `expiredAt`、`withdrawnAt`、`waitCancelledAt`、`transferredTo`、`originalRef`、`appliedAt`、`rejectedAt`（第一轮审查第 6 条）；
  - `approvedAt`（只认人：你批准的时间；批准和放行是两条状态行，放行由 Workflow 在目标 `active` 时做，第二轮审查第 3 条）；
  - `pins: { planRevision: number; pointerRevision: number | 'none'; dispatchSequence: number } | null`（“请动手”才有；值是那次提交核对的值，第一轮审查第 2 条）。
  - **意图沿用今天的名字，不造新名**（`src/contracts/core/session-message.ts:35`）：`action_request` 是“请动手”、`inquiry` 是“请回答”、`notify` 是“请知悉”、`decision_request` 是要你决定；本片用前三档（第一轮审查第 1 条）。
  - **送达从接受事实推**（`acceptedInputs`）：有接受 → `delivered`、`deliveryEvidence: 'accepted'`；没有接受且 `status: 'pending'` → `queued`；没有接受且 `read`/`responded` → `delivered`、`deliveryEvidence: 'legacy_unknown'`；其余为空。新消息在送达提交里写 `delivered`（第一轮审查第 1 条）。
  - **落实和拒绝的写者**（R35、R36）。拒绝：实际收件人回复 `reject: true` 和理由 → 写 `rejectedAt`。落实：实际做事的当事方写，带一个 `application` 证明：`{ receipt: { identityKey; fingerprint; cursor }; effect: { kind: 'claim_created' | 'proposal_created' | 'requeue' | 'recheck' | 'member_created'; ref } }`。一个像 `decision-application.ts` 那样的校验器核对效果那次提交真的带这条消息（回执身份 + 指纹 + 游标，事件的 acknowledgement 指回这条消息），不认调用方自报的版本；重试走同一条路由、按 `commandId` 重放。先到的一个赢，后到的那个是冲突（`revision_conflict`）。这两个和放行、已读、回复、任务完成分开记（第一轮审查第 7 条；第二轮审查第 5 条）。
- **L2 派工的三版核对和序号（O23、O54、R18）。**【lead 定，待审】（第一轮审查第 2 条）
  - 新记录 `DispatchCounter`（每个目标一条）：`sequence` 表示上一次成功派工的序号；不存在就是还没有（按 0 算，但不能写成 0）。
  - 创建 `awaiting` 的动作消息不加序号；加序号只发生在让动作可派的那一次提交里：直接发就是发信那次，「每步确认」就是放行那次（Workflow 在目标 `active` 时做，第二轮审查第 3 条）。
  - 一次提交里：三个版本用守卫核对，写消息，序号加 1；消息上的 `pins` 是这次核对的值（加之前）。计数不存在时守卫是「必须不存在」（`expectedRevision: null`），首次派工建它、`sequence` 写 1；指针不存在时守卫也是「必须不存在」，`pointerRevision: 'none'`。
  - 对不上 → `revision_conflict`，什么都不写，回执带现在的三个值和当前序号；发信方重读再发。放行那次核对是拿消息上的 pins 和放行时重读的三个当前值比；不拿这次放行要加的 1 去比（第二轮审查第 3 条）。
  - 每次发信带 `commandId`：同一个 `commandId` 先回原回执，不管后来发生了什么；同一个 `commandId` 指纹不同 → `idempotency_conflict`，不重复发、不改序号。
  - “请回答”不核这三个，不加序号。
- **L3 谁能派工、「每步确认」下的待放行（决定 37、49；R18）。**【lead 定，待审】
  - 能发“请动手”：秘书（经它的一轮，发信方“秘书回合”，带秘书 Session 和请求；第 6 片）、参谋、书记、有委托的执行者。只读副本、独立审阅者不能发。
  - 「方案确认后自动」：直接 `released`。「每步确认」：秘书和 agent 的“请动手”**和“请回答”**都写成 `release: 'awaiting'`，并出一张“要决定”的卡（`message_release`，解掉 F2 的 `unsupported`）；三个版本只对“请动手”核，“请回答”不核（第一轮审查第 3 条）。
  - **批准**（只认人）：你批准写 `approvedAt`、`release: 'approved'`，不核三个版本、不加序号；你不批准 → `denied`，不发。
  - **放行**只在目标 `active` 时做，触发者是 Workflow（系统 actor）。“请动手”：放行时重读计划、当前理解、派工序号三个当前值，和消息上的 `pins` 核；对得上 → `release: 'released'`、pins 记这三个当前值、序号加 1；对不上 → 卡标“过期”、不发、不加序号，退回发信方重出。“请回答”：放行不核、不加序号。目标暂停时批了也不放行；恢复时 Workflow 只对有 `approvedAt` 的消息重做这些核对再放行，已经 `released` 的消息不重复放行、不再加序号，积压的 `awaiting` 不动（第一轮审查第 2、3 条；第二轮审查第 3 条；最后核对第 2 条）。
  - “请回答”的期限从放行开始算，不放行不计时（第一轮审查第 3 条）。
  - 自治级别从「每步确认」改成「方案确认后自动」：已经 `awaiting` 的积压不自动放行，仍要你放；已经 `approved` 的等恢复后由 Workflow 放行（第一轮审查第 3 条；第二轮审查第 3 条）。

**7B**

- **L4 安全点送达（R40）。**【lead 定，待审】一条消息送达要全满足：`released`、`delivery: 'queued'`、目标 `active`、这个任务上没有挡着的决定、结果已核对（不是“结果未知”），并且 Kernel 真的接受了这个输入（`run.input_accepted`，F3）。不满足的保持排队，读的时候带原因（暂停、取消、待决定、结果未知）；恢复以后只有 `approved` 的消息按 L3 由 Workflow 重核版本并放行，已经 `released` 的消息只重做 L4 的可提供性核对，不重复放行、不再加序号；“请回答”放行不核版本。送达、回复、落实分开记。“可提供”（eligibility）和“真的接受”（`input_accepted`）是两步：提供不算送达，接受才算（第一轮审查第 4 条；第二轮审查第 3 条；最后核对第 2 条）。
- **L5 输入的先后。**【lead 定，待审】（第一轮审查第 4 条）一个 Session 在安全点拿输入的先后：
  1. 你的消息（用户输入优先，决定 49）；
  2. 它让出的等待的回复或到期（接续；同一处理点回复赢过到期）；
  3. agent 的消息，按发出的提交顺序。
  - 你在它让出等待时插话：先处理你的话，**等待默认保留**（不当作原问题的回复），通知实际的委托方、等上游的那一方和相关秘书、参谋（R39）。同一个 Session 不并开两个改东西的执行。这一轮里其他 agent 的动作消息仍排队（第一轮审查第 4 条）。
- **L6 消费遍及所有活跃 Session。**【lead 定，待审】Host 空闲时的消费从“配置的消费者”（F3）改成：所有可用、没占用、有可送达输入的 Session（按 L5 的先后、Session 键的顺序），每轮最多 `CONSUME_BATCH = 8` 个，余下下一轮。意图是 `notify` 的“请知悉”不在这里开模型轮（L21；第一轮审查第 15 条）。
- **L7 等待从消息读（O27；§0.1 告知 1）。**【lead 定，待审】一个等待 = 一条 `waitAfterSend` 的“请回答”加上发它的那次让出的执行。状态：没回、没到期、没撤回、没被消费就是 `open`；回了 `answered`；到期 `expired`；被接续消费 `consumed`；撤回或取消 `withdrawn`。“在等”从这里读，不从最近一次领取读，所以干预执行不会盖住旧的等待（解 F4）。2C 的线状态输入 T7 也改成从这里读，不再按最近一次工作执行的 continuation（`docs/refactor/design/orchestration-2026-10/slices/slice-2C-SPEC.md:1054`；第一轮审查第 16 条）。秘书的等待按请求（第 6 片 L3），不占查询 Session。
  - **接续绑定**（第一轮审查第 5 条；第二轮审查第 1 条）。被让出的执行由下一位继续时带一个判别式绑定 `RunContinuationV1 = { kind: 'wait_reply' | 'expiry' | 'intervention'; task; sessionRef; messageRef }`。今天的 `'wait_reply'` 沿用为回复这一种，不改名（已存的数据不用迁移，lead 2026-10-15）；新加 `expiry`、`intervention` 两种。`wait_reply` 消费原回复；`expiry` 消费稳定输入 id `expiry:<message key>`；`intervention` 让你或有权 agent 的干预执行在等待还开着时在同一任务上开跑，原等待仍绑在让出的那次执行上。认领绑定的判别式：`wait_reply` 要 `{ kind: 'wait_reply'; originalRun: RunRef; messageRef; responseRef: ArtifactRef }`，`expiry` 要 `{ kind: 'expiry'; originalRun: RunRef; messageRef; expiryInputId: string }`，`intervention` 只要 `{ kind: 'intervention'; messageRef }`。只有 `wait_reply` 需要真实的回复产物；`intervention` 不消费，保留等待现有的未消费状态（可能已是 `answered`）。（最后核对第 1 条）
  - **消费仲裁**（第一轮审查第 5 条；第二轮审查第 2 条）。每个等待用唯一认领 `wait-consumed:<message key>` 仲裁（`UniqueClaimChange`），谁先提交谁消费；同一处理点回复赢过到期；重复的 no-op。回复的认领在 Kernel 接受这条回复输入（`run.input_accepted`）的那次提交拿，只记下回复（`answered`）不拿认领；到期的认领只在 Kernel 接受 `expiry:<message key>` 的那次提交拿，记下到期本身不拿认领。没有真实接受（`input_accepted`）不算消费（`incomplete`）。重启按已提交的认领重放；到期输入按 `expiry:<message key>` 重放。（最后核对第 1 条）
- **L8 到期和迟到（R34、R35、R36）。**【lead 定，待审】
  - Host 的心跳查期限（已有的轮询，只用于到期；提交唤醒走 L10）。到期分两步（第二轮审查第 2 条）。**记下到期**：在处理点过了期限、还没回、这个等待还没被处理 → 记 `expiredAt`，并记下稳定输入 id `expiry:<message key>`（durable，未消费），这时**不拿** `wait-consumed` 认领；给等它的执行一个 `expiry` 接续输入（Work：原任务原 Session；秘书：当前请求归属的秘书，排一个 `expiry` 轮，第 6 片）。**接受才算消费**：只有 Kernel 提交 `run.input_accepted`、接受的就是这个 `expiry:<message key>` 的那次提交，才拿下 `wait-consumed:<message key>` 认领、把等待记成 `consumed`；Runtime 的确认要认识到期输入 id（今天 `confirmMailboxInputs` 只认消息和回复身份；第一轮审查第 5 条；第二轮审查第 2 条）。
  - 处理点上回复已经到了，就按回复处理，不记到期（回复赢过到期，消费同一个 `wait-consumed:<message key>` 认领；第一轮审查第 5 条）。
  - 已经按到期处理过以后才到的回复，作为普通输入送达，不再当接续。
  - 同一问题的追问链第二次**真的**到期，才提示第二次；重复扫描不加次数。
  - 发信方已退役：只记事实、通知，不唤醒；占用未知时不释放。
  - 一个等待最多被一个回复或一个到期消费；重复的 no-op；没有真实接受（`inputAccepted`）不算消费（`incomplete`）；消费过的到期输入按 `expiry:<message key>` 重放（第二轮审查第 2 条）。
- **L9 转交、撤回、取消、断开（R37、R38；决定 49 答复页第 18 项）。**【lead 定，待审】（第一轮审查第 6 条）
  - 转发目的地：同项目、`active`、没退役、职责允许接收。目标暂停 → 允许转发，送达等恢复；目标取消 → `invalid`、`goal_cancelled`。
  - **转发**（forward）是一条新消息、给新收件线：只用于未送达（收件线已退役或归档）的消息，以及 L13 复制目标时勾过的那些（原收件方还活着也转，是例外）。只认人。新消息 `originalRef` 指旧的，旧的 `transferredTo` 指新的；原等待不被消费；同一目标重复转不再发（竞争转发用唯一认领 `forwarded:<message key>` 仲裁）。对转发出去的消息的回复，满足原来的等待。
  - **转交**（transfer）只改一条已送达问题的回复处理方（`replyHandler`，已有的转移），不造新消息；问题和期限不变，原等待不被消费。未送达的消息不走转交。
  - 取消一个等待（归档时、或你操作）写 `waitCancelledAt`，写明是取消，不冒充到期。取消与撤回不同：撤回（`withdrawnAt`）只用于送达以前的消息，送达以后不能撤。（转发和转交的守卫、效果分开，第二轮审查第 4 条。）
  - 拒绝码：`invalid`、`forbidden`、`not_found`、`revision_conflict`、`busy`（已经被接受）。
  - 断开：一方退役或归档，双方**和你**都收到一条“请知悉”：谁、什么时候、活由谁接（接任者，或“没人接，等你定”）。
  - 回复处理方不变，另加 L35。（决定 60-6）
- **L10 提交唤醒（R56；§0.1 告知 4）。**【lead 定，待审】（第一轮审查第 8 条；第二轮审查第 6 条）Workflow 在一个目标进入等待时在内存里登记 `{ projectId, goalId, recordKinds }`，并读下登记时的游标；如果登记以后已经有匹配的提交，立刻唤醒一次。提交观察（F6）只给项目和聚合种类；收到一条非重放提交时按 `(projectId, 种类)` 匹配，然后取这个项目里登记过的目标（有界），逐个重核等待事实，仍等的、目标是 `active` 的才唤醒；同一目标合并。匹配的提交到了立刻做一次有界排空，不等心跳；心跳轮询只留给到期（L8）。每个有界排空按稳定顺序最多唤醒 `WAKE_LIMIT = 16` 个目标；余下的立刻排成下一次有界排空、紧接着做，不等新的匹配提交，也不等心跳。唤醒只调 Workflow 推进一步，不调模型，不带内容。离开等待时移除登记。Host 启动时从已答复、已到期的等待和已放行没处理的动作重建登记，并把重建出的就绪工作立刻入队（不是等下一条提交）。（最后核对第 4 条）
  - **每个等待原因的记录种类**（用 `ledger.ts` 里真实提交的聚合名；第二轮审查第 6 条）：
    - 等消息回复 / 迟到的回复 → `SessionMessage`
    - 等正式检查定案 → `VerificationRound`
    - 等证据核对 → `Evidence`、`TaskEvidenceIndex`
    - 等计划采用 → `PlanRevision`、`PlanProposal`
    - 等任务可领取（干预后）→ `PlanRevision`（任务在计划里）、`TaskLease`（领取）、`DispatchOutboxEntry`
    - 等被让出的执行结束 / 接续 → `Run`、`TaskLease`
    - 等目标恢复（暂停后放行）→ `Goal`
    - 等 Session 可用（换手、归档、退役）→ `Session`
    - 等接口约定注记（L16）→ 第 4 片的注记头（`WorkContextBinding`；注记记录第 4 片落地时在 `ledger.ts` 定名）
- **L11 空闲线、已做完的线的干预（R39）。**【lead 定，待审】
  - 线上有没做完的任务 → 接着做那个任务（排进它的下一次领取）；消息带 `taskRef` 就按它选，没有就按这条线最新的活跃任务（第一轮审查第 9 条）。
  - 没有任务、目标 `active` → 在这条线上开一个只读 Query，调用种类 `intervention_planning`；它只读，回答里带给 `plans/propose` 的完整草稿（定义、范围、角色、验收）。平台把这个草稿提交给 `plans/propose`；这条 Query 记下 `sourceMessageRef`（是哪条干预消息起的头）。提议照常校验和采用。消息 → Query → 提议 → 采用 → 领取连成一条、都按 `commandId` 幂等（第一轮审查第 9 条；第二轮审查第 7 条）。「方案确认后自动」下自动采用，「每步确认」下出卡；这条线领取它。
  - 目标已完成 → 先走第 6 片的目标卡确认一个新目标，再建任务；旧的完成事实不改（第一轮审查第 9 条）。
  - 原 Session 已归档或退役 → 不在它上面开改东西的执行，按 L9 的断开处理。
  - 干预能开跑靠 L7 的 `intervention` 绑定，原等待不被消费（第一轮审查第 5 条）。
- **L12 秘书的“请回答”回复或到期，开下一轮（第 6 片接）。**【lead 定，待审】回复或到期送到这个请求**当前**归属的秘书（换手以后是接任者），排一个 `reply` 或 `expiry` 轮（第 6 片 L1）；同一处理点上同一请求的几条合成一轮（第 6 片的 `absorbedInto`），每轮保留一个 `relatedMessageRef`（第一轮审查第 10 条）。不造对话任务。
- **L13 复制目标时干预的撤回和转发（R42；第 6 片 L12 记下了勾选）。**【lead 定，待审】新目标确认时撤回没勾的（`withdrawnAt`）；新目标首个方案采用以后，把勾的**转发**：走 L9 的转发（新消息引用旧消息，旧消息标 `transferredTo`），原收件方还活着也转（例外）；原线已归档或退役的，要你指定新收件线；重复不再发（唯一认领 `forwarded:<message key>`；第一轮审查第 6 条；第二轮审查第 4 条）。
- **L14 问一问已退役的线（DESIGN §1.6）。**【lead 定，待审】（第一轮审查第 11 条）咨询可以对已归档、已退役的线建只读副本（今天拒绝，F12）；它的 Kernel 历史读不到或坏了，就用一个派生模式 `platform_facts`：把模式连同采集到的平台事实引用记在这次咨询的 `SessionOperation` 上，重放身份就是这个 operation，免责声明由模式产生。Kernel 历史真的是空的，是模式 `kernel` 加零条记录，不是这个模式。原线不恢复。

**7C**

- **L15 挑执行者（R08）。**【lead 定，待审】（第一轮审查第 12 条）先按范围、职责和执行绑定的授权过滤，再排序。排除：已归档、不可用、占用、副本、Work 在等。排序：负责这个任务（显式转来的负责链接优先，保留）→ 负责它的模块 → 同目标做过 → 职责匹配 → 最近活动 → Session 键。关联从 `SessionWorkLink` 的按任务/按模块索引（`SESSION_LINKS_BY_TASK_LOOKUP`、`SESSION_LINKS_BY_MODULE_LOOKUP`）和按页读的执行历史来；读不全就在决定记录里写明“不全”。依赖只做软排序，没有“前置完成”守卫。没有合适的成员：只发“建议建一个”（给参谋或你），不自动建。这句只限挑人这条路。（决定 60-3）
- **L16 优先并行不重叠（决定 49；§0.1 告知 3）。**【lead 定，待审】（第一轮审查第 12 条）Workflow 选下一批任务时，声明的模块和正在跑的任务不重叠的先派。要派第二个任务、而它声明的模块和正在跑的任务重叠时，先让这个目标的参谋（没有参谋就给秘书）在那个模块上记一条接口约定注记（第 4 片）；第二个任务等一条在第一个任务开始以后写的注记存在，或你/参谋标“放行”，才派。只核版本，不做语义判断、不加全局锁。有区域参谋时先经邮箱问区域参谋，再由目标参谋记约定，问过不等于放行（放行仍按注记或“放行”）。（决定 60-5、60-6）
- **L17 建成员（DESIGN §5.3）。**【lead 定，待审】（第一轮审查第 13 条）工具 `create_member`：给参谋和有委托的执行者；固定工人、秘书、书记、独立审阅者没有。委托写在执行绑定的授权里（`TaskEnvelopeV1.permissions.createMember: boolean`）。
  - 参数：职责、范围（目标、任务或模块）、理由。先复用：有空闲、职责和范围都**完全匹配**的线就返回它，不建新的。
  - 「每步确认」下先出一张卡（决定来源 `member_creation`，选项 approve/reject），你批准才建；「方案确认后自动」下直接建，进“请知悉”。批准落实按 `commandId` 重放。
  - 建法用 Runtime 的两段式建 Session（F8），初始负责关系照已有的写法。委托只对这一次执行有效，不能转给别人。
  - 秘书也能建（见 L42）：秘书的查询调用种类注册 `create_member`，只为已采用计划里的任务建，`creator` 是秘书，挂靠按 L35，被挂的参谋收请知悉；所有建成员都写 `SessionRoleFactsV1`（`creator`、`openedBy: 'member_create'`，秘书建为 `'secretary_create'`），并过 L31 的准入。（决定 60-8、60-10）
- **L18 换手工具和批准卡（R57；DESIGN §4.4）。**【lead 定，待审】（第一轮审查第 14 条；第二轮审查第 8 条）共用的 Runtime 换手动作（只有阶段推进，不带工具、不出批准卡）在第 6 片的 6B，是 7B、7C 的前提；第 6 片的秘书换手就用它，只加请求 routing 一步。7C 在它上面加执行者（自己的线）、参谋（别人的线）用的工具 `hand_off`，以及要你批准的卡。它的意图记成一个 `kind: 'handoff'` 的 `SessionOperation`：源、`assignments: { target: SessionRef; tasks: TaskTriple[] }[]`、批准 pin、各阶段标记。
  - 要这次执行里写过当前理解（第 4 片：这次执行写的、挂在相关目标或阶段上的当前理解版本）；没写 → `incomplete`。理解证明是一条注记版本，它的来源运行就是交出的那次运行。
  - 长期线（秘书除外，它在第 6 片自动换手）和「每步确认」下的短期线要你批准；短期线在「方案确认后自动」下自动，进“请知悉”（决定 49）。
  - 步骤：建新 Session（两段式，建完才往下）→ 旧写者停下（工具在旧线的执行里调，换手排在这次执行结束以后做）→ 负责关系转移（关旧开新，原子）→ 旧线全部交出、没有等待就归档；只交出一部分就保留。中途重启按已存的 `handoff` operation 接着做。
  - 可以只交出选中的任务（拆），按 `assignments` 一条一个目标；交给已有的线时，那条线的来历不改，用新的负责关系表示“接手”，并保留它原来的 origin（合）。
  - 接任者的 continuation brief 列出交出的任务和理解指针。
  - 换手的接任者按 L31 在前任的名额下登记（受换手围栏保护），最后交接那次提交把持有从前任移给接任者；负责关系含 goal/project 范围（`assignments` 只管任务，范围走 L25）；`creator` 跟完整换手（L34）。（决定 60-7、62-2）
- **L19 返工和重新检查的工具（F10）。**【lead 定，待审】（第一轮审查第 13 条）工具 `request_rework`、`request_recheck`：给执行者、参谋；包已有的服务；「每步确认」下出一张卡（决定来源 `rework_request`，选项 approve/reject）而不是回 `forbidden`；批准落实按 `commandId` 重放；和自动返工共用上限；你批准过的返工算 agent 发起的（进同一个上限）。每次都通知（决定 42）。
- **L20 参谋、书记、秘书的确认和回复工具。**【lead 定，待审】（第一轮审查第 10 条）把已有的邮箱确认、回复适配器（F10）授权给参谋、书记。第 7 片为秘书的查询调用种类注册发信、确认、回复、撤回（`send_session_message`、`ack_session_message`、`respond_session_message`、新的 `withdraw_session_message`），只对秘书这一档解除 `FORBIDDEN_QUERY_TOOL_NAMES`（`src/core/agent-runtime/query-preparation.ts:141`）；可信发信方是 QueryRun principal，并且必须是这个请求的当前归属者。秘书查询的工具白名单加 `create_member`（只对秘书这一档解除限制，见 L42）。（决定 60-10）
- **L21 注意力和返工通知（决定 42；DESIGN §1.3、§2.4）。**【lead 定，待审】（第一轮审查第 15 条）注意力增量发给这个目标的当前参谋（按 L35 找），阈值可配置。每次自动返工给这个目标当前归属的秘书发一条通知（意图 `notify`，被动、不开新的一轮）；同一来源（requeue 或轮次 ref）去重；第二次返工另告诉参谋（没有参谋就进“要决定”，建议建一个）；自动重新检查也含在通知里。
- **L22 `apply_future_plan`。**删掉（§0.1 第 3 条，用户 2026-10-15 晚定）：工具、适配器（`whiteboard-tools.ts` 里的这一项）和它的测试删掉；agent 只经 `plans/propose` 提议，采用照自治级别由平台或你做。
- **L23 负责范围怎么存（60-5）。**【lead 定】范围 = relation `responsible` 的 `SessionWorkLink`，目标 `project`、`goal` 或 `module`。
  用途由 Session 的固定职责（接线包 1 L5）加目标种类读出：参谋 + goal = 目标参谋；参谋 + module = 区域参谋；书记 + goal/module = 目标/区域书记；
  执行者 + module = 模块维护者（8B）；任何职责 + project = 项目范围。不加用途字段。
  **区域的意思**：一条线负责模块 A 的 containment 子树（8B）是基础；有效负责范围 = 这个 containment 子树减去其中由同一职责的别的线负责的更深区域。所以几条线可以嵌套负责，
  单锚点的事（一个文件、一件技术的事、只有一个锚点的注记）归包含它的有效负责范围；多锚点注记按第 4 片 L5：对它和 `replaces`/`contradicts` 涉及的全部锚点求最深共同负责范围（按 containment 子树判包含），管理、现行计数、待审计数和提醒都用这个结果，每条注记只算给一个负责人（审查二快速核对第 1 条）。containment 不知道时，区域只算 A 自己（不推断子孙）。（审查二第 6 条）
  **待命** = 没有任何 responsible 链接；Session `lifecycle` 仍是 `active`。2C 的 T9 加原因 `unassigned`（只是 T9 的一个原因，不改 standby 的
  意思）；T8 的“已做完”排除也扩到负责 goal、project、module 的线（长期责任还在就不是做完）。
- **L24 一个范围一个负责人（60-5）。**【lead 定】参谋、书记的每个范围占一个唯一占位：`role-scope:` + canonicalJson(`{ projectId, duty, target }`)，
  owner 是负责链接的键；和开、挪、关链接在同一次提交里取得（null→owner）、移交（old→new）、释放（owner→null）。秘书的范围不占位。
  模块维护者用 8B 的 `module-maintainer:`。同一模块同一职责只能一个；嵌套（上级区域和下级区域各有一条）可以，开线和改范围时提示。
  冲突回 `revision_conflict/scope_owned`，带现在的负责线。
- **L25 换挂靠（60-7）。**【lead 定】`planReanchor` 是 `src/core/work-graph/state/` 下的纯迁移：输入是已读的快照和版本、授权事实、
  本次提交拟建的 Goal 或目录；返回完整的提交贡献（guards、records、claims、events、commit cursor 绑定）。调用的 owner 把它并进自己的一次
  `PreparedCommit`，同一记录、同一占位只留最后一个变化；新目标、新模块按这次拟提交的状态验证。单独用时是动作
  `reanchorSessionResponsibility({ session, close, open, reason })`，`reason` ∈ `human_scope_change | goal_continued | architecture_revision |
  split | reuse | standby | queue_assign | project_scope_moved`。`transferSessionResponsibility` 保留“同目标、换 Session”的意思，但要扩：
  非任务的 basis（goal、project、module 不再回 `work_responsibility_unresolved`，`plan-readers.ts:1922`、`session-responsibility-service.ts:515`）
  和占位移交（今天 `claims: []`，`:286`）。
- **L26 开局三条线（60-1）。** 项目的第一个工作区登记完成后，平台建一个 `role_line` 操作（action `start_lines`），三步各自一个创建子操作和进度：
  秘书、参谋、书记，范围都是整个项目，闲着，叫到才跑。每步：取名额预留 → 建 Session（Runtime 现有两阶段）→ 登记并写 `SessionRoleFactsV1`、
  项目范围链接、名额由预留转持有（同一次提交）。Host 启动时只接着做没完成的步骤，不另建；Kernel 已建、登记失败的，按 Runtime 现有恢复接着登记。
  `openedBy: 'start_lines'`、`creator: platform`。决定 35 · Q22 由此替换。
- **L27 你开角色线、改范围（60-2）。** `role-lines/open` 的 `duty` 只收秘书、参谋、书记（执行者走 `create_member`），否则 `invalid/role_line_duty`。
  走 L31 的准入：到上限回 `capacity/at_cap`，带当前持有、预留和上限；界面同一处给“调高上限并开线”（先 `role-limits/set`，再开）。
  改范围用 L25，直接生效；新范围已有同职责负责人回 `revision_conflict/scope_owned`。秘书也能带范围：第 6 片 L4 挑秘书时只挑范围包含这个请求有效目标的秘书（范围是过滤，审查二第 7 条；审查二 lead 补）。
- **L28 位置怎么算（60-3，平台规则，不调模型）。**
  - 目标参谋：每个进行中的目标一个位置；秘书初筛里 `size: 'small'` 的目标可以几个合用一个参谋，一个参谋最多负责 `MAX_GOALS_PER_ADVISER` 个
    进行中的目标（你指的除外）；没有初筛或 `size` 是 `unknown`/不是 small 的，一个目标一个位置。进行中 = 没取消、没完成、没暂停。
  - 区域位置：从根模块往下，一个模块的负担 = 它的区域（L23）里的代码量（8A 的 `nonBlankLines`，所有语言都数，按最长前缀归到模块）；
    ≤ `REGION_SLOT_LINE_BUDGET` 就是一个区域，超过就按子模块往下分，模块自己直接拥有的文件留在它这一层。观测缺失、失败、不全或归属有歧义，
    或 containment 不知道：负担是 `unknown`，不算区域位置、不递归拆；读出来写明 unknown，不说成“一个区域够了”。引用关系（8A 的 `languages` 覆盖）只影响“未探索”和比较，不影响区域位置。
    区域参谋是可选的（60-5 原文）：
    平台只在冷启动（L41）和重构时按区域位置开，或者你开；平时不因为区域里有任务就开。
  - 书记位置：一个范围里的现行注记数（第 4 片 `currentEligible`，按注记身份去重，归属按第 4 片 L5 的负责范围，每条注记只算给一个负责人（审查二快速核对第 1 条））超过 `SCRIBE_SLOT_NOTE_LIMIT`，
    就按子模块或按目标切出更小的范围；切不了不切，只在线卡上显示负担。500 是分担的数，不改第 4 片的软额度（每目标 200 等）。（审查二第 6 条）
  - 活跃：一个位置只在它的范围里有进行中的任务、有送到它的要处理的消息（不含请知悉）、或有待审的注记时才开线。
- **L29 太长、太慢就拆（60-3）。** 一条参谋或书记线：
  - 太长：最近一次模型请求的输入量（2B 的逐请求用量；`unknown` 或被省略的不算）到了第 6 片 L10 的阈值；
  - 太慢：发给它、要处理的消息（不含 `notify`）里，已放行排队或已送达、还没被它的模型轮接受的条数 `> ROLE_LINE_SLOW_MESSAGE_LIMIT`，并且连续超过阈值达到
    `ROLE_LINE_SLOW_WINDOW_MS`；从持久的消息事件重建最近一次越过阈值的起点，数量回到 `ROLE_LINE_SLOW_MESSAGE_LIMIT` 或以下就重置，重启结果一样。由维护心跳从持久的消息事实算，不存计时。
  任一成立：范围能切（区域有负担已知的子区域、负责几个目标、书记范围按 L28 能切）→ `role_line` 操作（action `role_line_split`）：算出切法、开一条新线、
  用 L25 把切出的范围挪过去（旧线保留其余，L23 的“减去更深区域”让两条线不重叠）；切不了：太长 → 照常换手（6B），太慢 → 只在线卡上显示负担、**不换手**
  （决定 60-7：换手只在太长时用）；只有“太长”且拆不了才换手。拆分从不新建正式模块。（审查二第 4 条）
  动作 `role_line_split`，按 L36 判出不出卡。操作的阶段：`planned → admitted → created → linked → done`，恢复从没完成的阶段接着做。
- **L30 角色线提议加人（60-4）。** 工具 `propose_role_split { move: RoleScopeV1[], reason }`，给参谋、书记（秘书没有）。平台核：`move` 是它现有范围
  里面的严格子范围（它区域里的子区域、它负责的部分目标），切完两边都不空、负担已知。之后同 L29（actorClass agent）。
- **L31 两个上限（决定 62-2）。**
  - **保留上限**：`RoleLineAllocationV1` 记每种职责的持有（没归档的线，含待命；退役了还没归档的也算）和预留（正在建的）。准入：持有 + 预留 < `open` 上限；
    提交同时守上限版本和分配版本。建线开始时取预留（预留属于这次操作），登记那次提交里预留转持有。调用失败或取消不等于创建操作终结：仍可恢复登记的子操作
    保留预留；释放必须与持久终结该操作、禁止后续登记同次提交。登记重放核实原预留或合法换手名额。episode 与准入统一使用持有＋预留；预留转持有不关闭 episode。
    归档在正式归档提交里释放持有；重新启用重新准入。调低上限不撤销已有的，但降到新上限以下之前不再加。同职责完整换手：接任者在前任的名额下登记（受换手围栏保护），
    最后交接那次提交把持有从前任移给接任者；部分交出多出一条线，要另外准入；换职责（L40）按目标职责准入。所有建线入口都走这一步：开局线、你开、
    平台加、提议拆分、秘书建执行者、参谋建成员、换手。（审查二第 1 条）
    **旧线的持有【lead 定】**：7D1 合入时已有的线没有 `RoleLineAllocationV1`。某个（项目、职责）第一次准入时，在那次提交里按“必须不存在”建出这条记录：`holders` = 这个项目里这种职责、没归档的全部 Session（含待命、退役未归档；`since` 记建记录的游标），`reservations` 为空；读口没有记录时按同样的规则读出、不写。持有超过上限照“调低上限”办：不撤销，降到上限以下之前不再加。（审查二 lead 补）
  - **同时运行上限**：持租约的 Host 里设一个所有模型入口共用的准入器，按 (项目, 职责) 串行地查和预留，再异步开始。计数组只有四个（决定 62-2）：秘书、参谋、书记、执行者。
    映射：独立审阅者（`reviewer`）算执行者组；只读副本、咨询（问一问）算它复制的那条线的职责组；7D1 之前建的旧线（读作 `openedBy: 'legacy'`）按它的固定职责算；没有映射的调用一律拒绝启动
    （`invalid/no_running_group`），不绕过上限。准入器接在真实的共同启动路径上：Run 和 Query 都已有持久身份（准备之后、交给 Kernel 之前），在这一步过准入。
    包括 Workflow 派工、消息消费、秘书的一轮、咨询（`consultation.ts:226`）、公开的 `executions/start`、`queries/start`（`core-routes.ts:529`、`:569`）。
    计数 = 已准入、还没结束的模型轮（从准入到 Run/Query 结束或放弃）；结果未知的照算，结果核清前不当空位、不重跑。被挡：Run/Query 保持“已准备、未开始”，
    读出原因 `running_cap`；公开 start 路由回 `{ status: 'waiting', reason: 'running_cap', ref }`；可以取消；Host 启动时扫“已准备、未开始、因 `running_cap` 等”的，
    按 L5 的先后排空；已进入或结果未知的重放只观察，不再准入、不重启。不出卡，`role-lines/read` 也读得到原因 `running_cap`。（审查二第 2 条）
  - `projects/role-limits/set` 只认人，带 `expectedRevision`；每次写审计事件 `ProjectRoleLimitsChanged { from, to, actor }`。
- **L32 到了保留上限（60-8，62-2）。** 平台自动加线时被保留上限拒：没有开着的 episode 就开一个 `RoleCapacityEpisodeV1`，出一张卡（主体 `project`，来源
  `role_capacity { duty, capValue, episode }`），选项四个：调高上限（落实 = 上限改了）/ 合并范围（你选线和范围，落实 = 一次 L25 换挂靠）/ 归档闲着的线
  （你选线，落实 = 归档）/ 先排队（落实 = 不动，等着的照排）。episode 开着时再被拒，直接回 `capacity/at_cap`，不出新卡；持有 + 预留降到上限以下或上限变了，
  episode 关掉（预留转持有不关 episode），以后再到上限才开新 episode、出新卡。项目卡的来源和答复唯一身份按“项目 + 来源”，不因从哪个工作区进来而重复；这个项目的
  每个工作区的队列都显示同一张卡，答复、历史、分页计数共享，已读水位按工作区各记。答复、落实、历史、分页计数都按这个来源身份（2A L6/L8 的完整分页）。（审查二第 1 条；审查二第 9 条）
  防重试：上限事实（“参谋 8/8”）写进提醒段（第 3 片的提醒行格式，Work 和秘书的查询都带；预算紧时可能被省略，所以提交时总是重核，不靠提醒）。
- **L33 新目标排队（决定 62-1）。** 所有“把目标分给参谋”的提交（自动分派、你 `assign`、出队分派）都守 `GoalAdviserQueueV1` 的 revision、目标状态、
  参谋的状态，串行进行；同时写负责链接和占位，从队里移除。
  1. 目标确认（或继续）后要一个目标参谋：候选 = 可用、没在换手、没归档、没退役的参谋线；按 L28 能再接这个目标的（负责的进行中目标还没到 3 个，
     且这个目标和它现有的目标都是 small，或它现在一个目标都没有）；按负担（负责的进行中目标数 → 负责的没终结任务数 → 最近活动早的）挑最轻的。
  2. 没有候选：开一条新参谋线（`role_line_add`，按 L36）；保留上限满了开不了 → 进队，目标栏显示“排队等参谋 · 第 n 位”。
  3. 排位：秘书初筛有 `suggestedPosition` 就按建议排到那里，没有就排到最后（时间先后）；你能 `reorder`、提到队首、`assign` 给某个参谋（可以超过 3 个）。
     建议排位照旧生效，不是只展示。依据：用户 10-15 原话“初筛再进行分配……可以初步形成队列。如果还不行就按照时序形成队列，不过用户需要可以查看并指定排序”，
     以及 17:2x lead 向用户说明“有初筛就按初筛的建议排，没有就按时间先后”后用户批准决定 62。（审查二第 3 条）
  4. 排空：目标完成、取消、暂停，上限调高，范围挪走，参谋线归档，Host 启动——任一发生，平台按 `QUEUE_DRAIN_BATCH` 一批批分，直到没有候选或确实没容量。
     队首要出卡（涉及「每步确认」的目标）时：这一项保留在队里、记下动作身份和唤醒依据，接着处理不依赖它的后面各项；全部受阻或确实没容量才停。
     待批项不预占参谋的目标额度；批准落实时按队列 revision 重核候选和容量。取消的目标出队；已分过的重放不再分。暂停的目标不计入 3 个，继续时留在原参谋（可以超过 3 个）。（审查二第 3 条）
  5. 排队的目标照常能和秘书谈、能起草候选；只停下要参谋做的事（62-5）。
  秘书满额时（第 6 片 L4 要新开秘书但到保留上限）：请求留着、标“未分配，秘书已满”；正式读法是 `assignedSession: null`、等待、原因 `secretary_open_cap`，不取 `secretary-intake`。用 QueryJob 索引 `s6-query-unassigned`（稳定顺序：提交时间、请求键）读未分配队列，排空触发（秘书的一轮结束（变空闲）、秘书空出名额、上限调高、Host 启动）时重新分派；取得归属那次同时取 `request-tail` 和 `secretary-intake`。（审查二第 7 条）
- **L34 “建它的人”（60-6）。** 每条线建的时候在 `SessionRoleFactsV1.creator` 记下。只跟正式的完整换手走（7C L18 换手操作完成、`handoff` 结果），
  不从界面文案反推；部分交出不改。建它的线归档（不是完整换手）→ 联系失效，只留历史；那条线重新启用 → 联系恢复。复用已有执行者不改 `creator`，
  只记这次派工的来源。7D 之前建的线读作 `openedBy: 'legacy'`、`creator: unknown`，名字用系统名。
- **L35 找谁拿主意（60-6、60-10）。**【lead 定】按事情分两类：
  - 一般要拿主意的事（执行者、审阅者的上报）：这个任务所属目标的目标参谋 → （没有）creator（有效的 Session）→ 你；
  - 技术约定类的事（接口、这块的约定）：任务所属模块的最窄有效负责范围参谋（按 L23 减去同职责更深的负责区域）→ 目标参谋 → creator → 你；跨几个区域的由目标参谋分别去问。（审查二第 6 条）
  creator 和收件线不是同一条时另收一份请知悉，按来源操作和最终收件线去重。回复消息仍回发信方（L9）；干活结果仍写在任务图上。
  第 7 片 L21 的“没有当前参谋就发给配置的那个”改按这条找。
- **L36 出不出卡：三层（决定 62-3、62-4）。** 动作入口（今天查 `decisionActionPolicy` 的地方）判；policy 仍是纯函数，由可信 owner 给全输入：动作、actorClass、
  受影响的目标及各自的自治档和设置版本、受影响的范围及目录 pin、当前时间、规则集版本和匹配到的规则、条数事实、同一动作已有的待答卡身份、调用方的委托授权及其版本（按 principal 读，见 L37 末段；审查二 lead 补；审查二快速核对第 3 条）。
  写入那次提交守住参与判断的这些版本和计数（规则集版本、委托授权版本和所用计数；没匹配到规则也守规则集版本和委托授权版本）。（审查二第 5 条）
  1. 永远找你（规则放不开）：`confirm_goal`、`adopt_first_plan`、`remember_user_preference`（user_only）；`structural_patch`、`change_goal`、`exceed_budget`、
     `escalate`、`long_handoff`、`change_duty`（两档都出卡）；采用初始架构、完成标准，把话记成你的偏好或长期决定，调上限，都只有人的路由，没有 agent 动作。
  2. 同一动作已有待答卡：按那张卡办，新规则不放行它（决定 42）。
  3. 有一条生效的规则覆盖（L37）→ `automatic_notice`。
  4. 没有规则 → 出厂默认：已有动作照今天的表；`role_line_add`、`role_line_split`、`role_line_reuse`、`goal_queue_assign`：涉及的目标里有「每步确认」的 → 出卡
     （主体：只涉及一个目标时是那个目标，否则 `project`；来源 `role_line_change`）；没涉及目标、或都是「方案确认后自动」→ `automatic_notice`。
     `create_member`、`short_change_duty`：「每步确认」出卡，「方案确认后自动」`automatic_notice`。
  5. 越界当场返回 `{ status: 'needs_decision', cardKey }`，不挂起；只停这个动作和依赖它的（L46）。没人答就不做，没有超时放行。
  规则只决定“出卡还是直接做”，而且只在调用方自己的委托授权里匹配：调用方没有这个动作的委托，规则不让它做。“委托授权”就是现有执行绑定里的授权
  （Work 是 `TaskEnvelopeV1.permissions`，含 7C L17 的 `createMember`；Query 是 `PreparedQueryManifestV1.permissions`，见 L37 末段）；子线建出来时它的授权不超过建它的线（7C L17 已核）。工具权限、负责范围、动作授权三样分开核。（审查二第 5 条）
- **L37 规则（决定 62-3、62-4）。** 只能由人建，通常是答完一张卡后卡上给“以后这类都这样”，界面按这张卡的动作和涉及范围预填，你改完确认才存。
  校验：`actions` 只能是 `RuleActionV1`，否则 `invalid/rule_action_fixed`；`scope`、`actions` 不能为空；`limits.open` 每种职责不能超过项目的保留上限，
  否则 `invalid/rule_limit_over_cap`。匹配：动作在 `actions` 里；动作涉及的每个对象都在 `scope` 里（目标相等；模块按 L23 落在区域里；project 覆盖全部）；
  没过期（入口和提交都按当前时间核）；`active`；`limits.open` 是“这条规则允许自动加到的保留条数”，按 `RoleLineAllocationV1` 的持有加预留核。
  重试、返工的已有上限照旧管，规则不放宽它们。撤销、改有效期只认人，不追溯已经做了的事；任何建、撤、改都把 `AutonomyRuleSetV1.revision` 加一。
  匹配只在调用方自己的委托授权里进行。**委托事实由可信 owner 按 principal 读**：Work 读已接受的 `TaskEnvelopeV1.permissions`（`tools`、`writeScope`、7C L17 的 `createMember`）和 `policyRevision`；Query（秘书、`role_exploration`）读已接受的 `PreparedQueryManifestV1.permissions.tools` 和 `roleBinding.policyRevision`（`prepared-execution.ts:101`），秘书的 `create_member` 只来自它的调用种类注册进 `tools`（L42），只表示它能发起创建、不另设 `createMember`；**秘书建的执行者不从秘书继承授权**：它的执行授权照普通执行者的绑定（Host 配置和角色，`execution-preparation.ts:222`），`createMember` 固定为 false，秘书 Query 的空 `writeScope` 不作它的上限（审查二额外核对 D1）；提交时重核同一执行绑定，已接受的授权不原地改（审查二快速核对第 3 条）。调用方是 agent 时，动作对应的工具要在它的 `tools` 里（Work 的 `create_member` 还要 `createMember: true`），不在就 `forbidden`，规则不让它做；Work 建的子线的 `tools`、`writeScope`、`createMember` 不超过建它的线（7C L17 已核）；项目规则不能扩大委托。调用方是平台规则时没有委托这一层。（审查二第 5 条；审查二 lead 补：今天的授权只有 `policyRevision`、`tools`、`writeScope`，没有额度和有效期字段）
- **L38 闲置归档和最少一条（60-3、60-7、60-8；用户 10-15 确认）。** 参谋、书记线闲满 `ROLE_LINE_IDLE_ARCHIVE_MS` 就归档。闲 = 同时满足：没有占用；没有已放行
  或已送达、还没接受的要处理的输入；没有没完的换手围栏；范围里没有进行中的任务、没有待审的注记；它发出的“请回答”没有还开着的；这些事实都读全了
  （读不全不算闲）；从最后一次活动（模型轮结束、收到要处理的消息、你对它的操作、建线）算起满一天，请知悉不算活动。**（决定 91 修改：参谋、书记线不按空闲时间归档，只在职责结束、太长换手、退役、你手动、保留上限需要名额时归档（满了先收这个角色里最久没活动的空闲线）；7D2 的书按决定 91 重写 L38。）**
  **每个项目秘书、参谋、书记各至少留一条**：这种职责最后一条没归档的线不因闲置归档（和第 6 片 L15 一致）。项目范围：每种职责的项目范围由一条线负责；
  这条线被你归档或退役时，平台用 L25（`project_scope_moved`）挪给同职责里负担最轻的另一条线；没有别的线就等下一条线开出来时给它。
  归档在正式归档提交里释放范围链接、占位和名额。这改了第 1 片 §2.8、IT09 和接线包 1 L16 的“长期线不自动归档”（旧规格加后注）。
- **L39 范围没了（60-7 的表）。** 目标完成、取消且没复制：平台用 L25 关掉这个目标的链接，线上没有别的范围就待命。取消后复制成新目标（决定 39）：
  6B 的复制确认那次提交里用 `planReanchor` 把目标参谋、目标书记挪到新目标（`goal_continued`），新目标记“接续自”，进请知悉；原线已复用或归档的，
  新目标按 L33 另找。暂停的目标保留负责关系。删模块、换模块身份、拆、合：修订带去向（8C）。待命的线复用到新范围（`role_line_reuse`，按 L36）：
  挑闲着、不太长、以前管过的模块和新范围有交集的，再按最近活动；没归档、已持有名额的待命线复用不新增预留、不要求总数低于上限，已归档的线先走重新启用的准入。
  平台从不猜哪个新模块接替旧模块。（审查二第 1 条）
- **L40 换职责（60-10 说明）。** 运行中不换职责；要转就是“换职责的换手”：新开一个 Session、用新职责、标“接手自 …”、带上旧线的当前理解和注记，
  旧线交出后归档；走 6B 的共用换手动作，新线按目标职责准入（L31）。长期还是短期按源 Session 的固定职责和正式维护关系定（秘书、参谋、书记、
  负责模块的执行者是长期），不由调工具的人自报：长期是 `change_duty`（两档都出卡）；短期是 `short_change_duty`（「每步确认」出卡，「方案确认后自动」
  直接做、进请知悉）。规则批准不给新的 Runtime 角色或工具。今天的表把短期也算进 `change_duty`，这里改开。
- **L41 冷启动（61-1、61-2、61-4）。** 一个 `role_line` 操作（action `cold_start`），阶段持久，每段写明谁执行、输入、触发和恢复：
  1. `candidates`：秘书一轮用初始化格式（第 6 片 L5/L8）出初始架构、完成标准、检查的候选和第一个方案；还没有目标的回答先存成候选，目标确认后再
     绑到那个目标，才进入计划采用（`plan-service.ts:1147` 今天拒绝没有 `job.goalId` 的初始化来源，要改）。
  2. `adopted`：你采用初始架构（可以是最小根模块 `.`，8A/8B）和完成标准。
  3. `route`：秘书判断走哪条——自己出地图（小项目），还是分头探索；8A 的总代码量只作参考给它看；判断不了就在主对话问你。
  4. `coarse_split`（分头时）：平台给开局参谋发一条系统“请动手”（带操作 ref），它只看顶层目录、入口和现有文档，用 8C 的
     `propose_architecture_revision` 提一次粗分，这个提议立即冻成只有它一个成员的批次、出卡给你（审查二快速核对第 5 条）。
  5. `regions`：批了以后，按 L28 的区域位置给每个顶层模块开区域参谋（`openedBy: 'cold_start'`，走 L31 准入；超了上限的区域记在操作的待开列表里，
     名额空出来时排空），给每个发系统“请动手”。
  6. `proposals`：各区域参谋探索、写注记、提这块的修订；基于同一个目录 pin，展示合并批准前冻结一个批次（批次身份、完整成员、`baseCatalogPin`、合并后的 ops、
     `responsibilityMoves`、摘要），按稳定顺序把完整修订和负责关系试套、全部通过才能合，冲突的不覆盖、各自成批；`structural_proposal { batchRef }` 卡指向这个
     冻结批次，批准绑定它、一次提交落实全部；晚到的提议另成批次，内容或 pin 变了不复用旧批准；pin 过时的回 `source_stale` 要重提。**批次什么时候冻结【lead 定】**：这个操作在 `proposals` 阶段开出的探索 Query 全部结束（回答、失败或取消）时，平台把此前保存的 `pending` 提议冻成批次、出卡；冻结前提的提议回执是 `{ status: 'pending_batch', proposalRef }`、没有 `cardKey`，冻结以后经第 8 片的 `architecture/proposals/read` 读到批次和卡身份（审查二快速核对第 5 条）；之后才到的提议各自立即冻成只有它一个成员的批次。全部处理完，操作 `done`。（审查二第 12 条；冻结时机是审查二 lead 补）
  重启从持久阶段接着做；每段的系统消息、开线都按操作身份去重。
- **L42 秘书建执行者（60-10，接 7C L17）。** 秘书的查询调用种类注册 `create_member`（可信发信方是 QueryRun principal，必须是这个请求的当前归属秘书），
  只为已采用计划里的任务建或复用执行者。建之前和落实派工时都要解析出有效的负责参谋（L35：目标参谋，或任务所属模块的区域参谋）；没有就回
  `invalid/no_responsible_adviser`，读的时候这个任务显示“等参谋”，不拿 creator 或你代替。`creator` 是这个秘书，`openedBy: 'secretary_create'`；
  被挂的参谋收一份请知悉（按操作去重），可以改派、收回或换人；走执行者的保留上限（L31）；动作 `create_member`，按 L36 判。秘书不能建角色线。
- **L43 请知悉的汇总（62-3）。**【lead 定】按 L36 直接做的人手调整，每一件先由可信的系统写者持久写成一条请知悉（主体是目标或 `project`，按操作身份去重），
  读的时候把同一主体、同一 `NOTICE_SUMMARY_WINDOW_MS` 窗口里的几条合成一行显示，列出做了什么、按哪条规则或出厂默认、怎么撤回。
  不存汇总记录、不用内存定时器；已读水位照第 5 片和接线包 2 的规则。不挂目标的请知悉由新的可信写者 `notifyProject` 写，不经 `sendUserMessage`。
- **L44 线的读出（接 2C）。** `role-lines/read` 和 2C 的线读取加：名字（L34 的优先级）、范围（L23）、creator、待命原因 `unassigned`、名额状态、`running_cap`；
  目标的负责人投影加目标参谋（今天只投影秘书）。2C 返工不做这些，7D2 做。（审查二第 18 条）
- **L45 不做的（决定 62-7）。** 每天花费额度；审查模型；按命令内容判风险（命令在 Kernel 隔离里，断网）。
- **L46 等待只挡一支（决定 62-5；属 7B）。** 给待决动作按种类记：稳定身份、直接挡住的对象、“依赖它”的正式来源、谁存、怎么解除。目标级的选择跳过这些动作，接着选不受它挡的工作；显式指定任务的
  handle 不改派别的任务。候选全被挡住才回目标 `waiting`，并保留每个动作的唤醒依据。答复落实、对象失效、Host 重启都能恢复选择。只有正式事实算依赖：例如自动返工待确认 → 挡住这个任务 A；
  任务 C 有指向 A 产出的精确输入（第 3 片的精确输入）→ C 也等；计划 DAG 的软排序边不算，“依赖”不把软排序整体变成硬前置。改 `workflow.ts:1263/1359`、`collaboration-driver.ts:844`。（审查二第 10 条）
  逐类的依赖合同（审查二快速核对第 4 条）：

  | 待决动作 | 稳定身份 | 直接挡住 | “依赖它”的正式来源 | 从哪里重建 | 怎么解除 |
  | --- | --- | --- | --- | --- | --- |
  | 自动返工、自动重新检查待确认 | `goal_cause` 的来源键（`decisionSourceKey`，`workflow.ts:1267`） | 那个任务 | 有指向它产出的精确输入的任务（第 3 片） | Workflow 从任务、Run 和卡的事实重建，不另存 | 答复落实、拒绝，或来源失效（任务取消、被替代） |
  | 消息待放行（「每步确认」，7A） | `messageRef` | 这条消息（不送达） | 没有：收件线照常做别的 | 邮箱记录 | 放行、不批准或撤回 |
  | 建成员（`create_member` 出卡，7C L17、L42） | 建成员操作的 `operationRef` | 要派给新成员的那个任务 | 有指向它产出的精确输入的任务 | 操作记录 | 落实、拒绝或来源失效 |
  | 换手（`hand_off`、`long_handoff` 出卡，7C） | 换手操作的 `operationRef` | 被交出的任务 | 同上 | 操作记录 | 同上 |
  | 角色线调整（`role_line_change`） | `role_line` 操作的 `operationRef` | 这次调整本身（不挡任务） | 没有 | 操作记录 | 同上 |
  | 队列分派（`goal_queue_assign` 出卡，L33） | `goalRef` + `operationRef` + 队列 revision | 那个目标的参谋分派（目标留在队里） | 没有：队里后面的照常分 | 队列和操作记录 | 同上；批准落实时按队列 revision 重核 |

  批准了还没落实不算解除；落实、拒绝或来源失效以后重新选择。表外的卡（修补、结构修订提议、注记卡、上限卡）不挡任务选择。

### 0.4 和别的片的接缝

- **第 4 片：** 当前理解指针（L2 的三版之一）、换手前写理解（L18）、接口约定写成注记（L16）。
- **第 5 片：** 自治策略、决定队列、放行卡（L3）、落实。
- **第 6 片：** 秘书回合的发信方、请求归属、`reply`/`expiry` 轮（L12）、复制目标的勾选（L13）、`absorbedInto` 合批（L12）、秘书换手（用 6B 的共用 Runtime 换手动作加请求 routing；L18 的工具和批准卡是本片 7C 加的）、6B 的已完成目标确认和复制（L11、L13）。（第一轮审查第 10、14 条；第二轮审查第 8 条）
- **2B：** “太长”按模型输入量判定（L29），不用 2B 的执行改过的文件（决定 72 后注改正）；本片也不用 2B 做声明模块的重叠判断（第一轮审查第 16 条）。
- **2C：** 线的读取、消息状态的投影（2C 只投影今天的状态，本片的新字段合入后 2C 的读取要补一次）；2C 的线状态输入 T7 改成按 L7 读等待（`docs/refactor/design/orchestration-2026-10/slices/slice-2C-SPEC.md:1054`；第一轮审查第 16 条）。
- **7B 的前提：** 7B 要第 6 片的 6B（已完成目标确认、复制、秘书换手），不是只有 6A（第一轮审查第 16 条）。
- **7C 的前提：** 7C 要第 6 片的 6B（共用的 Runtime 换手动作），不是只有 6A（第二轮审查第 8 条）。
- **7D1 要先有：** 7A（消息）、7B（L46 等待只挡一支）、7C（建成员、换手工具）、6B（共用换手动作）；排在 8C 之前。（审查二第 18 条）
- **7D2 要先有：** 7D1（共享基础）、7A（消息）、7B（L46 等待只挡一支）、7C（建成员、换手工具）、6B（共用换手动作）、8A（文件级观测、代码量、根路径）、8B（containment、区域）、8C（修订带负责去向、结构修订提议通路）、8D（多语言观测的引用关系）。（决定 60-3、60-5、60-7、61-4；审查二第 18 条）
- **依赖 7D2 才完整的接线：** 4C（书记范围和提醒）、6A（秘书挑选看范围和满额）、6B（目标卡排队和复制目标挪责任）、7C（秘书建执行者），都列为 7D2 的改动文件和验收；前面的小片按“只有开局三条线、范围都是整个项目”先做，行为不变。（决定 60-3、60-7、60-8、60-10、62-1；审查二第 18 条）

## 1. 范围

- **7A：** L1–L3；路由 `messages/release`（只认人：批准 / 不批准）、`messages/withdraw`、`messages/apply`（落实的写者）；放行没有公开路由，由 Workflow 在目标 `active` 时做；`message_release` 决定来源。（第一轮审查第 7 条；第二轮审查第 3 条）
- **7B：** L4–L14、L46；路由 `messages/forward`（只认人：转发未送达或复制目标勾过的消息）、`waits/dispose`（只认人：取消等待，或转交改回复处理方）。（第二轮审查第 4 条）
- **7C：** L15–L22；工具 `create_member`、`hand_off`、`request_rework`、`request_recheck`；参谋、书记的确认和回复授权；秘书的查询调用种类的发信/确认/回复/撤回注册。共用的 Runtime 换手动作（阶段推进）在 6B，不在本片；7C 只加 `hand_off` 工具和批准卡。（第一轮审查第 10、13、14 条；第二轮审查第 8 条）
- **7D1 共享基础（7D1 可验）：** L23–L25，加上 L31 的保留上限和 `RoleLineAllocationV1`、L34 的 `SessionRoleFactsV1`、L43 的项目主体请知悉基础；接口 `WorkLinkTarget { goal, project }`、`RoleScopeV1`、`planReanchor`/`reanchorSessionResponsibility`/`transferSessionResponsibility` 的扩展、`role-scope:` 占位、`DecisionSubjectV1`、`SessionRoleFactsV1`、`CreatorRefV1`、`RoleLineAllocationV1`；路由 `projects/role-limits`（读）、`projects/role-limits/set { expectedRevision, running?, open? }`（`running` 先只存，运行准入在 7D2；审查二 lead 补：保留准入在 7D1，要能调上限才验得了）；读口 `role-lines/allocation`；项目主体的卡源和请知悉基础（`DecisionSubjectV1`、`notifyProject`）。排在 8C 之前。（审查二第 18 条）
- **7D2 角色线编排（7D2 联动补验）：** L26–L45（L46 仍属 7B）；路由 `role-lines/open { duty: RoleLineOpenDutyV1, scope: RoleScopeV1[], name? }`、`role-lines/change-scope { session, scope: RoleScopeV1[] }`、`goals/adviser-queue`（读）、`goals/adviser-queue/reorder { expectedRevision, order }`、`goals/adviser-queue/assign { goalRef, adviser }`、`autonomy-rules`（读）、`autonomy-rules/create`、`autonomy-rules/revoke`、`autonomy-rules/update { expiresAt }`；读口 `role-lines/read`、`role-lines/operations`；工具 `propose_role_split`、秘书查询的 `create_member`、8C 的 `propose_architecture_revision`、查询调用类 `role_exploration`；新动作 `role_line_add`、`role_line_split`、`role_line_reuse`、`goal_queue_assign`、`create_member`、`short_change_duty`；新卡源（主体 `project`）`role_capacity`、`role_line_change`、8C 的 `structural_proposal { batchRef }`。排在 8D 之后。（决定 60-1、60-2、60-3、60-4、60-5、60-6、60-7、60-8、60-10；61-4；62-1、62-2、62-3、62-4、62-5、62-6、62-7；审查二第 18 条）

**不在本片：** 压缩（K2）；秘书太长换手（第 6 片）；界面（E3：消息状态、待放行、干预入口）；真实冲突场景和审阅者（第 9 片）。

## 2. 接口（第一稿，冻结时细调）

```ts
// SessionMessage 加（src/core/work-graph/model/communication-contracts.ts）
taskRef: TaskTriple | null; requestRoot: QueryJobRef | null; followupOf: SessionMessageRef | null;
deadline: string | null; release: 'released' | 'approved' | 'awaiting' | 'denied'; delivery: 'queued' | 'delivered' | 'undelivered';   // （第二轮审查第 3 条）
deliveryEvidence: 'accepted' | 'legacy_unknown' | null;                    // （第一轮审查第 1 条）
expiredAt: string | null; withdrawnAt: string | null; waitCancelledAt: string | null;   // （第一轮审查第 6 条）
transferredTo: SessionMessageRef | null; originalRef: SessionMessageRef | null;
appliedAt: string | null; rejectedAt: string | null; approvedAt: string | null;         // （第一轮审查第 3、7 条；第二轮审查第 3 条）
application: ApplicationProofV1 | null;                               // 落实时保存的证明（最后核对第 3 条）
pins: { planRevision: number; pointerRevision: number | 'none'; dispatchSequence: number } | null;  // （第一轮审查第 2 条）

// 意图沿用今天（src/contracts/core/session-message.ts:35）：action_request | inquiry | notify | decision_request。
// 本片用前三档，对应“请动手”“请回答”“请知悉”，不造新名。（第一轮审查第 1 条）

// 新记录 DispatchCounter（每个目标一条）；sequence 不存在表示还没有（按 0 算，不写 0）。（第一轮审查第 2 条）
type DispatchCounterSnapshot = { ref: DispatchCounterRef; goalId: string; sequence: number;
  lastMessageRef: SessionMessageRef | null };

// 发信（已有的 sendMessage 扩展）
sendMessage(ctx, input: { commandId: string; …; intent: 'action_request' | 'inquiry' | 'notify';
  expected?: { planRevision: number; pointerRevision: number | 'none'; dispatchSequence: number } }):
  Promise<SendResult>;   // 'sent' | 'awaiting_release'
                          // | rejected { code: 'revision_conflict' | 'idempotency_conflict' | …, current: {…} }

// 批准、放行、撤回、转发、转交、处置等待、落实
releaseMessage(ctx, { commandId, messageRef, allow: boolean });   // 只认人：allow 写 approvedAt、release='approved'；不放行写 'denied'（第二轮审查第 3 条）
withdrawMessage(ctx, { commandId, messageRef });
// 落实的证明（第二轮审查第 5 条）；拒绝走 respondMessage({ reject: true, reason })
type ApplicationProofV1 = { receipt: { identityKey: string; fingerprint: string; cursor: CommitCursor };
  effect: { kind: 'claim_created' | 'proposal_created' | 'requeue' | 'recheck' | 'member_created'; ref: AggregateRef } };
applyMessage(ctx, { commandId, messageRef, application: ApplicationProofV1 });   // （第一轮审查第 7 条）
forwardMessage(ctx, { commandId, messageRef, to: SessionRef });   // 转发：未送达的消息，或复制目标时勾过的（第二轮审查第 4 条）
disposeWait(ctx, { commandId, messageRef, mode: 'cancel' | 'transfer', to?: SessionRef });   // transfer 只改已送达问题的回复处理方（第二轮审查第 4 条）

// 接续绑定（src/contracts/dispatch.ts 的 RunContinuationV1 改成判别式；kind 沿用 'wait_reply'）。（第一轮审查第 5 条；第二轮审查第 1 条）
type RunContinuationV1 =
  | { kind: 'wait_reply'; task: TaskTriple; sessionRef: SessionRef; messageRef: SessionMessageRef }
  | { kind: 'expiry'; task: TaskTriple; sessionRef: SessionRef; messageRef: SessionMessageRef }
  | { kind: 'intervention'; task: TaskTriple; sessionRef: SessionRef; messageRef: SessionMessageRef };

// 认领绑定（src/contracts/dispatch.ts 的 ConsumedWaitV1 改成判别式）：只有 wait_reply 要回复产物。（第二轮审查第 1 条）
type ConsumedWaitV1 =
  | { kind: 'wait_reply'; originalRun: RunRef; messageRef: SessionMessageRef; responseRef: ArtifactRef }
  | { kind: 'expiry'; originalRun: RunRef; messageRef: SessionMessageRef; expiryInputId: string }
  | { kind: 'intervention'; messageRef: SessionMessageRef };   // 不消费，保留现有的未消费状态（可能已是 answered）（最后核对第 1 条）
// 到期输入稳定 id：'expiry:' + <message key>；消费认领：'wait-consumed:' + <message key>；竞争转发认领：'forwarded:' + <message key>

// 换手意图（src/core/work-graph/model/session-contracts.ts 的 SessionOperationRecord.action 加一档）。（第一轮审查第 14 条；第二轮审查第 8 条）
// { kind: 'handoff'; from: SessionRef; assignments: { target: SessionRef; tasks: TaskTriple[] }[];
//   approvalPin: VersionPin | null; stages: { name: string; at: string }[] }
// 咨询派生模式记在咨询的 SessionOperation 上：mode: 'kernel' | 'platform_facts'；platform_facts 带采集到的事实引用。（第一轮审查第 11 条）

// 执行绑定授权（src/contracts/task-envelope.ts 的 TaskEnvelopeV1.permissions 加）。（第一轮审查第 13 条）
createMember: boolean;

// 决定来源加（src/contracts/goal-decisions.ts）：'member_creation' | 'rework_request'，选项 approve/reject。（第一轮审查第 13 条）

// 干预规划只读 Query：ContextCallKindV1 加 'intervention_planning'；Query 记 sourceMessageRef。
// 平台把回答里的完整草稿交 plans/propose（requestRef 指这条 Query）；PlanProposalV1 加 sourceMessageRef: SessionMessageRef | null。（第一轮审查第 9 条；第二轮审查第 7 条）

// 角色线探索 Query：ContextCallKindV1 加 'role_exploration'（区域参谋、开局参谋的探索）。`goalId` 可以为空（同秘书）；
// 可信 principal 是 QueryRun；绑定 `role_line` 操作和那条系统“请动手”消息；注册工具：看、找、只读命令、范围受限的
// `record_note`（按 S4 L2a 的范围准入）、`propose_architecture_revision`；普通 copy 的权限不变。
// `query-execution.ts:381` 对这个调用类放开“没有目标”。（审查二第 11 条）

// 常量（没实测，可配置）
export const DEFAULT_INQUIRY_DEADLINE_MS = 24 * 3600 * 1000;   // §0.1 第 4 条；从放行起算
export const CONSUME_BATCH = 8;
export const WAKE_LIMIT = 16;
```

### 7D 接口（7D1 共享基础 + 7D2 角色线编排；审查二第 18 条）

```ts
// src/contracts/core/identity.ts（决定 60-5；project 一种【lead 定】：开局线和项目范围用同一套负责关系）
export type WorkLinkTarget =
  | { kind: 'task'; ref: TaskRef }
  | { kind: 'work'; ref: WorkContextRef }
  | { kind: 'module'; ref: ModuleRef }
  | { kind: 'goal'; ref: GoalRef }
  | { kind: 'project'; ref: ProjectScope };

export type RoleScopeV1 =
  | { kind: 'project' }
  | { kind: 'goal'; goalRef: GoalRef }
  | { kind: 'region'; moduleRef: ModuleRef };   // L23：子树减去同职责更深的负责区域
export type RoleLineDutyV1 = 'secretary' | 'adviser' | 'scribe' | 'executor';   // 上限按这四种
export type RoleLineOpenDutyV1 = 'secretary' | 'adviser' | 'scribe';            // role-lines/open 只收这三种

export type SessionRoleFactsV1 = {             // 每条线一份，在登记平台 Session 的那次提交里写
  sessionRef: SessionRef; revision: number;
  name: string | null;                         // 显示名优先级：这里 → 2C 的临时名 → 系统名“<职责> <序号>”
  creator: CreatorRefV1;
  openedBy: 'start_lines' | 'human' | 'platform_rule' | 'agent_proposal' | 'secretary_create' | 'member_create'
          | 'handoff' | 'cold_start' | 'legacy';                   // legacy：7D 之前建的线，读的时候给
  originOperation: OperationRef | null;
};
export type CreatorRefV1 =
  | { kind: 'session'; ref: SessionRef } | { kind: 'human'; actor: ActorRef } | { kind: 'platform' } | { kind: 'unknown' };

export type ProjectRoleLimitsV1 = {
  projectRef: ProjectScope; revision: number;
  running: Record<RoleLineDutyV1, number>;     // 初值 secretary 4, adviser 4, scribe 2, executor 8
  open: Record<RoleLineDutyV1, number>;        // 初值 secretary 8, adviser 8, scribe 4, executor 16
};
export type RoleLineAllocationV1 = {           // 每个项目、每种职责一份；有正式读口 role-lines/allocation
  projectRef: ProjectScope; duty: RoleLineDutyV1; revision: number;
  holders: { sessionRef: SessionRef; since: CommitCursor }[];
  reservations: { operationRef: OperationRef; reservedAt: CommitCursor }[];
};
// 运行准入的计数组就是 RoleLineDutyV1 四种（秘书、参谋、书记、执行者）；映射：`reviewer` → 执行者组；
// 只读副本、咨询（问一问）→ 它复制的那条线的职责组；7D1 之前建的旧线（`openedBy: 'legacy'`）→ 它的固定职责；
// 没有映射的调用 → `invalid/no_running_group`，不绕过上限。
// 准入器接在真实共同 Runtime 启动路径（Run/Query 准备之后、交给 Kernel 之前）；被挡时 Run/Query 保持“已准备、未开始”，
// 公开 start 路由回 `{ status: 'waiting', reason: 'running_cap', ref }`。（审查二第 2 条）

// 角色线的操作：用已有的 SessionOperation，加 kind 'role_line'
export type RoleLineOperationV1 = {
  kind: 'role_line';
  action: 'start_lines' | 'open' | 'role_line_split' | 'role_line_reuse' | 'goal_queue_assign' | 'cold_start' | 'create_member';
  phase: string;                               // 每种 action 的阶段在 L26、L29、L33、L41、L42 里列
  steps: { key: string; duty: RoleLineDutyV1 | null; sessionOperationRef: OperationRef | null;
           state: 'pending' | 'reserved' | 'created' | 'registered' | 'linked' | 'done' | 'failed' }[];
  result: { status: 'done' | 'failed' | 'waiting'; reason: string | null } | null;
};

export type GoalAdviserQueueV1 = {             // 项目级；所有“目标分给参谋”的提交都守它的 revision（L33）
  projectRef: ProjectScope; revision: number;
  entries: { goalRef: GoalRef; enqueuedAt: CommitCursor; screening: GoalScreeningV1 | null }[];   // 数组顺序就是排位
};
export type GoalScreeningV1 = {
  modules: ModuleRef[]; size: 'small' | 'medium' | 'large' | 'unknown'; conflictsWith: GoalRef[]; dependsOn: GoalRef[];
  urgency: 'high' | 'normal' | 'low'; suggestedPosition: number | null; note: string;   // note ≤ 512 字节
};

export type RuleActionV1 = 'refine_future' | 'minor_semantic_patch' | 'system_requeue' | 'agent_requeue' | 'auto_reverify'
  | 'secretary_action' | 'secretary_inquiry' | 'short_handoff' | 'role_line_add' | 'role_line_split' | 'role_line_reuse'
  | 'goal_queue_assign' | 'create_member' | 'short_change_duty';
export type AutonomyRuleV1 = {
  ref: { projectId: string; ruleId: string; aggregateType: 'AutonomyRule' }; revision: number;
  actions: RuleActionV1[]; scope: RoleScopeV1[];                  // 都不能为空
  limits: { open?: Partial<Record<RoleLineDutyV1, number>> } | null;
  expiresAt: string | null; approvedBy: ActorRef; approvedFrom: { cardKey: string; answerMessageRef: SessionMessageRef } | null;   // 从哪张卡的哪条答复提议来的（第 5 片 DecisionCardV1.cardKey、answerMessageRef）
  state: 'active' | 'revoked';
};
export type AutonomyRuleSetV1 = { projectRef: ProjectScope; revision: number };   // 任何规则建、撤、改都加一；“没有匹配”也守它

// 决定卡的主体（第 5 片的卡源、source facts、答复、落实、读取都按它判别）
export type DecisionSubjectV1 = { kind: 'goal'; goalRef: GoalRef } | { kind: 'project'; projectRef: ProjectScope };
// 项目卡的来源和答复唯一身份按“项目 + 来源”，不因从哪个工作区进来而重复；这个项目的每个工作区的队列都显示同一张卡，
// 答复、历史、分页计数共享，已读水位按工作区各记。角色线（秘书、参谋、书记）的 Session 建在项目的主工作区（第一个登记的工作区）；
// 项目范围的负责关系不扩大 Runtime 的工作区权限；执行者照旧建在任务所在的工作区。跨工作区的候选读取按“同项目的所有工作区”，
// 执行绑定照旧按任务的工作区。（审查二第 9 条）
export type RoleCapacityEpisodeV1 = {
  projectRef: ProjectScope; duty: RoleLineDutyV1; episode: number; capValue: number;
  openedAt: CommitCursor; closedAt: CommitCursor | null; revision: number;
};
```

新动作（`DecisionActionV1` 加）：`role_line_add`、`role_line_split`、`role_line_reuse`、`goal_queue_assign`、`create_member`、
`short_change_duty`。新卡源（主体 `project`）：`role_capacity { duty, capValue, episode }`、`role_line_change { operationRef }`；
8C 的 `structural_proposal { batchRef }`（审查二第 12 条）——展示合并批准前冻结一个批次：批次身份、完整成员、`baseCatalogPin`、合并后的 ops、`responsibilityMoves`、摘要；
按稳定顺序把完整修订和负责关系试套，全部通过才能合；冲突的不覆盖、各自成批。批准绑定这个冻结批次，一次提交落实全部；晚到的提议另成批次；内容或 pin 变了不复用旧批准。
新路由（都只认人，直接生效）：`role-lines/open { duty: RoleLineOpenDutyV1, scope: RoleScopeV1[], name? }`、
`role-lines/change-scope { session, scope: RoleScopeV1[] }`、`projects/role-limits`（读）、`projects/role-limits/set { expectedRevision, running?, open? }`、
`goals/adviser-queue`（读）、`goals/adviser-queue/reorder { expectedRevision, order }`、`goals/adviser-queue/assign { goalRef, adviser }`、
`autonomy-rules`（读）、`autonomy-rules/create`、`autonomy-rules/revoke`、`autonomy-rules/update { expiresAt }`。
新读口（公开，测试也用）：`role-lines/read`（每条线的名字、职责、范围、creator 和它现在的状态、待命原因、名额状态、`running_cap` 等待原因）、
`role-lines/allocation`（每种职责的上限、持有、预留）、`role-lines/operations`（L26–L42 的操作和阶段）。
新工具：`propose_role_split`（参谋、书记）；秘书查询调用种类的 `create_member`（L42）；8C 的 `propose_architecture_revision`（参谋）。
新常量：`ROLE_LINE_DEFAULT_LIMITS`、`MAX_GOALS_PER_ADVISER = 3`、`REGION_SLOT_LINE_BUDGET = 15000`（非空行）、`SCRIBE_SLOT_NOTE_LIMIT = 500`、
`ROLE_LINE_IDLE_ARCHIVE_MS = 86_400_000`（**决定 91 取消**）、`ROLE_LINE_SLOW_MESSAGE_LIMIT = 10`（比较用 `>`）、`ROLE_LINE_SLOW_WINDOW_MS = 1_800_000`、
`NOTICE_SUMMARY_WINDOW_MS = 900_000`、`QUEUE_DRAIN_BATCH = 16`；输入量阈值复用第 6 片 L10 的 `min(500000, 模型容量 × 0.8)`（软预算，一轮结束后才拆或换手；用户 2026-10-15 晚定）。
新错误：`capacity/at_cap`、`revision_conflict/scope_owned`、`invalid/role_line_duty`、`invalid/rule_action_fixed`、`invalid/rule_limit_over_cap`、
`invalid/no_responsible_adviser`、`invalid/no_running_group`（审查二第 2 条）、`invalid/responsibility_destination_missing`（8C）。都用现有的 code（`results.ts:17`），只加 reason。

## 3. 状态行（冻结时 lead 补期望值；第一轮审查第 17 条填全）

| 行 | 迁移 | 守卫（guard） | 触发者（actor） | 效果（effect） | 拒绝码 | 崩溃边界（crash boundary） |
| --- | --- | --- | --- | --- | --- | --- |
| S7-MSG-01A | `awaiting → approved`（动作） | 只认人；不核版本 | 人（`releaseMessage`） | 写 `approvedAt`、`release: 'approved'`；不加序号 | `forbidden`、`not_found` | 提交前崩：仍 `awaiting`；提交后崩：回执重放 |
| S7-MSG-01B | `approved → released`（动作） | 目标 `active`；放行时重读计划、当前理解、派工序号三个当前值并核对（不拿这次要加的 1 比），对得上 | Workflow（系统；恢复时也走这条） | 写 `release: 'released'`、pins 记三个当前值、派工序号 +1 | `revision_conflict`、`invalid`、`not_found` | 提交前崩：仍 `approved`，可重放；提交后崩：回执重放，不重复加序号 |
| S7-MSG-02A | `awaiting → approved`（询问） | 只认人；不核版本 | 人（`releaseMessage`） | 写 `approvedAt`、`release: 'approved'`；不加序号 | `forbidden`、`not_found` | 同 S7-MSG-01A |
| S7-MSG-02B | `approved → released`（询问） | 目标 `active`；不核版本、不加序号 | Workflow（系统；恢复时也走这条） | 写 `release: 'released'` | `invalid`、`not_found` | 同 S7-MSG-01B |
| S7-MSG-02 | `awaiting → denied` | 人选择不批准 | 人 | 写 `release: 'denied'`；不发、不加序号 | `forbidden`、`not_found` | 同 S7-MSG-01A |
| S7-MSG-03 | `queued → delivered` | L4 全满足；Kernel 提交 `run.input_accepted` | 收件执行 / Host 确认 | 写 `delivery: 'delivered'`、`deliveryEvidence: 'accepted'` | `incomplete`（未接受） | 接受事实由 Kernel 提交；重启按 `acceptedInputs` 重读，不重复送达 |
| S7-MSG-04 | `queued → undelivered` | 收件线退役或归档 | Host | 写 `delivery: 'undelivered'`，读时给原因 | `not_found` | 只读投影可重算 |
| S7-MSG-05 | `open → expired`（记下到期） | 心跳过 `deadline`、没回、没撤回、这次等待还没被处理；**不**拿 `wait-consumed` 认领 | Host 心跳（系统） | 写 `expiredAt`；记下 durable 输入 id `expiry:<message key>`（未消费）；给等它的执行一个 `expiry` 接续 | 无（重复 no-op） | 记下到期是唯一提交；崩了按 `expiry:<message key>` 重放，不重复提示 |
| S7-MSG-05A | `answered → consumed`（回复） | Kernel 提交 `run.input_accepted`、接受的就是这条回复输入（按回复身份去重）；赢下 `wait-consumed` 认领 | Kernel 确认 / Host | 拿下 `wait-consumed:<message key>`，等待记 `consumed` | `incomplete`（没接受） | 只记下回复（`answered`）不拿认领；认领在这次提交里；重启按回复输入重放（最后核对第 1 条） |
| S7-MSG-05B | `expired（scheduled） → consumed` | Kernel 提交 `run.input_accepted`、输入 id 就是 `expiry:<message key>`；赢下 `wait-consumed` 认领 | Kernel 确认 / Host | 拿下 `wait-consumed:<message key>`，等待记 `consumed` | `incomplete`（没接受） | 认领在这次提交里；重启按输入 id 重放 |
| S7-MSG-06 | `open → withdrawn` | 还没送达；发信方或人 | 发信方 / 人 | 写 `withdrawnAt` | `forbidden`、`not_found` | 提交前崩：仍可撤 |
| S7-MSG-07 | `open → waitCancelledAt` | 归档或人操作取消等待 | Host / 人 | 写 `waitCancelledAt`，不冒充到期 | `forbidden`、`not_found` | 提交前崩：等待仍 `open` |
| S7-MSG-08 | 未送达/复制目标 → `transferredTo` | 未送达（收件线退役或归档），或 L13 复制目标勾过；目标合法；赢下 `forwarded` 认领 | 人（`forwardMessage`） | 新消息 `originalRef`、旧的 `transferredTo`；原等待不消费 | `invalid`、`goal_cancelled`、`busy`、`forbidden`、`not_found` | 认领唯一；重复转不重发 |
| S7-MSG-08B | `delivered → replyHandler`（转交） | 已送达的问题；归档处置或人；收件线合法 | 归档处置 / 人（`disposeWait` 的 `transfer`） | 只改 `replyHandler`（已有转移），问题和期限不变；原等待不消费 | `busy`（回复已被接受）、`invalid`、`forbidden`、`not_found` | 沿已有转移行；提交前崩：处理方不变 |
| S7-MSG-09 | 等待/动作 → `appliedAt` | 实际当事方；`application.effect` 那次提交带这条消息（校验器核对回执身份、指纹、游标和 acknowledgement）；先到者赢 | 实际做事的执行者（人可代） | 写 `appliedAt` 和 `application` | `revision_conflict`（后到）、`invalid`（换别的消息的回执）、`forbidden`、`not_found` | 按 `commandId` 重放；崩了重试同路由（最后核对第 3 条） |
| S7-MSG-10 | 等待/动作 → `rejectedAt` | 实际收件人回 `reject: true` 和理由；先到者赢 | 实际收件人 | 写 `rejectedAt`、理由 | `revision_conflict`（后到）、`forbidden`、`not_found` | 回复是单次提交，按 `commandId` 重放 |
| S7-DC-01 | 计数不存在 → `sequence: 1` | 守卫「必须不存在」 | 派工提交 | 建 `DispatchCounter`、写 1；消息 pins 记 0 | `revision_conflict` | 与消息、序号同一提交；崩则一起回滚 |
| S7-DC-02 | `sequence: n → n+1` | 版本守卫过；`expectedRevision` 对上 | 派工提交 | 写 n+1；消息 pins 记 n | `revision_conflict`、`idempotency_conflict` | 同上；同 `commandId` 回原回执 |
| S7-RL-01（7D2 联动补验；审查二第 18 条；决定 60-1、60-2、60-5） | 无 → `RoleLineOperationV1`（action `start_lines`/`open`/`role_line_split`/`role_line_reuse`/`goal_queue_assign`/`cold_start`/`create_member`）：`steps.state` `pending → reserved → created → registered → linked → done`；action `role_line_split` 的阶段 `planned → admitted → created → linked → done`，恢复从没完成的阶段接着做 | 建 Session 的同一次提交写 `SessionRoleFactsV1`（`openedBy`、`creator`、`originOperation`）和负责链接；`role-scope:` 占位（L24）；按 `RoleLineAllocationV1` 取预留（L31）；守上限版本和分配版本 | 平台（L26、L41）、人（L27）、平台规则（L29/L33）、agent 提议（L30）、秘书（L42） | 写范围链接、占占位；登记那次提交预留转持有；`phase` 记进度、`result.status` 记 `done`/`failed`/`waiting` | `capacity/at_cap`、`invalid/role_line_duty`、`revision_conflict/scope_owned` | 注册平台 Session 那次提交里预留转持有；崩了按 operation 身份从没完成的步骤接着做，不重复建、不重复写 |
| S7-RL-02（7D2 联动补验；审查二第 18 条；决定 60-7） | `scoped` → 待命（读时原因 `unassigned`） | 最后一个 `responsible` 链接被关（目标完成、取消且没复制）；`lifecycle` 仍 `active`，不加生命周期值 | 平台（L25 的 `reason: 'standby'`） | 关最后一个范围链接、释放 `role-scope:` 占位；2C 的 T9 读原因 `unassigned` | 无 | 关链接和释放占位同一提交 |
| S7-RL-03（7D2 联动补验；审查二第 18 条；决定 60-7） | 待命 → `scoped`（复用，`role_line_reuse`） | 新范围的占位空；按 L39 挑选（闲着、不太长、以前管过的模块有交集、最近活动）；未归档、已持有名额的待命线复用不新增预留、不要求总数低于上限，已归档线先走重新启用准入（L31） | 平台规则 / 人 | 用 L25 开新范围链接、占占位；`RoleLineOperationV1` action `role_line_reuse` | `revision_conflict/scope_owned` | 同一提交（审查二第 1 条） |
| S7-RL-04（7D2 联动补验；审查二第 18 条；决定 60-3、60-7、60-8；**决定 91 改写**） | `scoped`/待命 → archived（闲置归档） | 参谋、书记闲满 `ROLE_LINE_IDLE_ARCHIVE_MS = 86_400_000`（L38 的“闲”事实读全）；每种职责保留最后一条不归档 | Host / 平台 | 归档、释放 `role-scope:` 占位和持有；项目范围按 `project_scope_moved` 挪给同职责里负担最轻的线 | 无 | 释放同一提交；重启按事实重算 |
| S7-RL-05（7D1 可验；审查二第 18 条；决定 62-2） | `RoleLineAllocationV1`：取预留 | 开线开始时取预留（预留属于这次操作）；持有 + 预留 < `open` 上限；同一次提交守上限版本和分配版本 | 所有建线入口 | `reservations` 加一项（`operationRef`、`reservedAt`）；登记那次提交预留转 `holders`（`since` 记游标） | `capacity/at_cap` | 名额和建线同一提交；崩则一起回滚 |
| S7-RL-06（7D1 可验；审查二第 18 条；决定 62-2） | `RoleLineAllocationV1`：持有 → 释放或移交 | 归档在正式归档提交释放持有；重新启用重新准入；同职责完整换手时接任者在前任的名额下登记（受换手围栏保护），最后交接那次提交把持有从前任移给接任者；部分交出多出一条线要另外准入；换职责按目标职责准入 | Host / 平台 | `holders` 移除或 old→new；释放 `role-scope:` | 无 | 同一提交；不多算 |
| S7-RL-07（7D2 联动补验；审查二第 18 条；决定 62-1） | 无 → 队尾（`GoalAdviserQueueV1.entries`） | 目标确认要目标参谋；没有负责不到 `MAX_GOALS_PER_ADVISER = 3` 个、负担最轻的参谋，且到保留上限开不了线；守队列 revision | 平台规则 | 追加 entry（`enqueuedAt`、`screening`）；数组顺序就是排位；目标栏显示“排队等参谋 · 第 n 位” | `capacity/at_cap` | 同一提交；已分过的重放不再分 |
| S7-RL-08（7D2 联动补验；审查二第 18 条；决定 62-1、62-2） | 队内 → 分派（`goal_queue_assign`） | 有参谋空出来（目标完成、取消、暂停、上限调高、范围挪走、线归档、Host 启动），或人 `assign`（可以超过 3 个）；守队列 revision | 平台规则 / 人 | 从队列取（默认队首）分给某条参谋线，用 L25 开范围链接、占占位；从队里移除；按 L36 判出不出卡 | `revision_conflict/scope_owned` | 同一 `commandId` 重放；不重复分派 |
| S7-RL-09（7D2 联动补验；审查二第 18 条；决定 62-3、62-4） | 无 → 规则 `active` | 只认人；`actions` 只能是 `RuleActionV1`，否则 `invalid/rule_action_fixed`；`limits.open` 每种职责不超过项目的保留上限，否则 `invalid/rule_limit_over_cap`；`scope`、`actions` 非空；每次建、撤、改把 `AutonomyRuleSetV1.revision` 加一 | 人（`autonomy-rules/create`） | 写 `AutonomyRuleV1`、`state: 'active'`、`approvedBy`、`approvedFrom` | `invalid/rule_action_fixed`、`invalid/rule_limit_over_cap` | 单次提交，重放 |
| S7-RL-10（7D2 联动补验；审查二第 18 条；决定 62-3、62-4） | `active → revoked` | 只认人；任何建、撤、改把 `AutonomyRuleSetV1.revision` 加一 | 人（`autonomy-rules/revoke`） | 写 `state: 'revoked'`；不追溯已经做了的事 | `forbidden`、`not_found` | 单次提交，重放 |
| S7-RL-11（7D2 联动补验；审查二第 18 条；决定 60-8、62-2） | 无 → episode 开 → 关（`RoleCapacityEpisodeV1`） | 平台自动加线被保留上限拒且没有开着的 episode 就开一个；持有 + 预留降到上限以下或上限变了就关（预留转持有不关 episode） | 平台规则 | 开 episode（`capValue`、`openedAt`）、出 `role_capacity` 卡（主体 `project`）；关 episode（`closedAt`）；episode 开着时再被拒直接回 `capacity/at_cap`，不出新卡 | `capacity/at_cap` | episode 和卡按来源身份重放，不出第二张（审查二第 1 条） |
| S7-RL-12（7D2 联动补验；审查二第 18 条；决定 62-2） | 无 → 运行准入（运行上限） | 计数 = 已准入、还没结束的模型轮（从准入到 Run/Query 结束或放弃）；结果未知的照算，结果核清前不当空位、不重跑；按 (项目, 职责) 的四个计数组（秘书、参谋、书记、执行者）串行查和预留；没有映射的调用 → `invalid/no_running_group` | 持租约的 Host | 准入在真实共同启动路径（Run/Query 准备之后、交给 Kernel 之前）；被挡的 Run/Query 保持“已准备、未开始”、读出原因 `running_cap`，公开 start 路由回 `{ status: 'waiting', reason: 'running_cap', ref }`、可取消；一轮结束按 L5 排空 | 无（读原因 `running_cap`） | Host 重启后从持久的 Run/Query 状态重建计数；已进入或结果未知的重放只观察、不再准入、不重启（审查二第 2 条） |
| S7-RL-13（7D2 联动补验；审查二第 18 条；决定 61-1、61-2、61-4） | 无 → 角色线探索 Query（`role_exploration`） | 区域参谋、开局参谋的探索；`goalId` 可以为空（同秘书）；可信 principal 是 QueryRun；绑定 `role_line` 操作和那条系统“请动手”消息；注册工具看、找、只读命令、范围受限的 `record_note`（按 S4 L2a 的范围准入）、`propose_architecture_revision`；普通 copy 的权限不变 | 平台（L41 的 `coarse_split`/`regions`） | 开只读 Query；`query-execution.ts:381` 对这个调用类放开“没有目标” | `invalid/no_running_group`（没有映射）、`invalid` | 按 `role_line` 操作身份和系统消息去重（审查二第 11 条） |

- 角色线状态是读出来的，不加 `standby` 生命周期值；`unassigned` 是 2C T9 的读时原因（L23）。（决定 60-5、60-7）

- 等待：从消息读，不另存（无独立状态行；L7 的读法写进 STATE-MACHINES-SPEC 的说明）。
- 到期分两步：S7-MSG-05（记下到期、记下输入 id）和 S7-MSG-05B（Kernel 接受后才消费）分开；重放按到期输入 id。回复同理：只记下回复（`answered`）不拿认领，Kernel 接受回复输入后才消费（S7-MSG-05A）。（第二轮审查第 2 条；最后核对第 1 条）
- 批准与放行分两行、动作与询问分两行：S7-MSG-01A/01B、02A/02B（第二轮审查第 3 条）。
- 未送达的转发（S7-MSG-08）和已送达问题的回复处理方转交（S7-MSG-08B）是两条行（第二轮审查第 4 条）。
- 负责关系：换手沿已有的转移行。

## 4. 规则

1. 批准、放行、送达、回复、落实和拒绝分开记；放行只在目标 `active` 时做，到期分“记下”和“消费”两步；读不改任何状态（读不 ack）。（第一轮审查第 7 条；第二轮审查第 2、3 条）
2. 用户输入在安全点优先，其次才是回复/到期接续；等待默认保留，不冒充原问题的回复；处理你的输入时其他 agent 的动作仍排队。（第一轮审查第 4 条）
3. 派工只核版本，不做语义判断；重叠时先在模块上记接口约定注记，再派第二个，不加全局锁。（第一轮审查第 12 条）
4. 唤醒不调模型、不带内容、不另建调度库；观察只给项目和种类，匹配后取这个项目里登记的目标、重核事实，匹配提交到了立刻有界排空，排空的余下立刻排下一轮、不等新提交，心跳只查到期。（第一轮审查第 8 条；第二轮审查第 6 条；最后核对第 4 条）
5. 结果未知不释放占用、不自动重跑。
6. 意图 `notify` 的请知悉永不开模型轮；落实/拒绝先到者赢，后到是冲突。（第一轮审查第 7、15 条）
7. 落实的证明是 `application`（回执身份 + 指纹 + 游标 + effect）；校验器核对 effect 那次提交真的带这条消息，同 `commandId` 重放。（第二轮审查第 5 条）
8. 转发和转交分开：转发造新消息、只用于未送达或复制目标勾过的；转交只改已送达问题的回复处理方。（第二轮审查第 4 条）

## 5. 测试（TDD，测试由 DSH 一条一条写）

### 5.1 测试入口（**待你确认**）

| 入口 | 是什么 | 能抓到 | 抓不到 |
| --- | --- | --- | --- |
| TE1 | **邮箱端口（7A）。** 公开的 `SessionMailboxPort`，两个后端 | 新字段、三版核对和序号、重试回原回执、指纹冲突、待放行、批准、放行时重核、不放行、撤回、转发和转交分开、落实/拒绝的写者（`application` 证明）、到期的两步和并发 | Runtime 送达 |
| TE2 | **发信 → 决定答复 → 邮箱读取（7A）。** 公开的路由 | 放行卡过期、只认人、“请回答”也待放行、目标暂停时 `approvedAt`、恢复后由 Workflow 放行、自治改了以后不放行积压 | 工具注册 |
| TE3 | **Runtime 的输入（7B）。** prepare/start/observe，脚本模型和真实冻结 Kernel 事件 | 真实接受才算消费、到期输入 id 的确认、用户优先的先后、去重、等待保留、不冒充回复、`wait_reply`/`intervention` 绑定 | 真实模型 |
| TE4 | **Workflow 推进（7B、7C）。** `workflow/advance` 加公开的任务、Session 读取 | 干预的三种情况（含 `intervention_planning` Query）、挑执行者的过滤和排序、重叠的接口约定注记和等待、等待不被干预盖住 | Kernel 的接受 |
| TE5 | **主机重启和时钟（7B）。** 主机场景框架，注入时钟 | 已答未消费、到期两步、迟到的回复、追问链第二次到期、断开通知、重启重建唤醒、唤醒合并和上限、秘书的下一轮、`platform_facts` 咨询 | 生产负载 |
| TE6 | **换手工具和建成员（7C）。** `hand_off` 工具加公开的负责关系、历史读取（共用的 Runtime 动作在 6B） | 没写理解报未完成、要批准的等批准、建完才转、写者停下、部分交出、合并保留 origin、重启接着做、复用优先、委托只对这一次、批准重放 | 理解的质量 |
| TE7 | **咨询（7B）。** `workflow/consultation` 对已退役、历史读不到的线 | 只读副本、`platform_facts` 模式和采集事实、`kernel` 空历史、只按平台记录并写明、原线不恢复 | 回答质量 |
| TE8（7D1 可验 + 7D2 联动补验；决定 60-1、60-3、60-4、60-7、60-8、60-10；61-4；62-1、62-2、62-3、62-4、62-5、62-6） | **角色线（7D1 可验：共享基础；7D2 联动补验：角色线编排）。** 公开路由（`role-lines/*`、`projects/role-limits*`、`goals/adviser-queue*`、`autonomy-rules*`、决定和请知悉的读取）加能控制模型开始、结束的主机场景夹具（注入时钟；重启用同一个持久存储；断点设在正式端口边界）。不读内部占位或数据库。每条验收写明初始事实、动作、公开结果、重放结果。 | 开局三条线和重启补做；你开线（含 `invalid/role_line_duty`）和改范围；占位冲突；保留上限（并发降限、满额完整换手、部分换手、重新启用、退役未归档照算）；运行上限（两个入口同时开、`running_cap` 原因、结束后排空、结果未知不当空位）；到上限的卡和 episode；新目标排队、排空和重放；太长、太慢、提议拆分（含负担 unknown 不拆）；规则的建、匹配、过期、撤销竞态、旧卡不被新规则放行；出厂默认按目标档；当场返回不挂起；L46（A 等确认、独立的 B 照做、依赖这个动作的 C 等着，重启以后还是这样）；creator 的抄送和换手跟随；闲置归档、最少一条、项目范围挪走；复制目标挪责任；秘书建执行者没有参谋时等参谋；缺 8A/8B 事实；冷启动各阶段的恢复。8C 的验收用真实的目录、责任、批准提交，不用替身；可以用假模型出提议，但至少一条验收经过真实的提议、批准和修订提交。（审查二第 18 条） | 模型拆得好不好、初筛准不准。 |

### 5.2 验收行为（第一稿；冻结时逐条补全期望值）

- M-01（TE1）秘书和参谋读到同一组三版本，先后发“请动手”：先发的 `sent`、计数 0→1、消息 `pins.dispatchSequence = 0`；后发的 `revision_conflict`，回执带当前计数 1；重读再发成功、计数 1→2、消息 pins 记 1。（第一轮审查第 2 条）
- M-02（TE1）同一 `commandId` 重发：回原回执，计数和消息都不变，消息只有一条；同一 `commandId` 换指纹 → `idempotency_conflict`。（第一轮审查第 2 条）
- M-03（TE2）「每步确认」：秘书的“请动手”`awaiting`、**不加计数**、出放行卡；你批准 → `approvedAt`、**不加计数**；放行时计划版本已变 → 卡过期、不发、计数不变；重出再批准后放行 → `released`、计数 0→1、pins 记 0；你不批准 → `denied`。（第一轮审查第 2、3 条；第二轮审查第 3 条）
- M-04（TE2）目标暂停时你批准 → 记 `approvedAt`、不放行、不送达；恢复后 Workflow 重核三个当前值并放行、送达；这期间把自治改成「方案确认后自动」也不放行积压。（第一轮审查第 3 条；第二轮审查第 3 条）
- M-05（TE2）“请回答”不核三版、不加序号；「每步确认」下也 `awaiting`、也要你批准；目标 `active` 时 Workflow 放行；没写期限 → 期限从放行起 24 小时。（第一轮审查第 3 条；第二轮审查第 3 条）
- D-01（TE3）安全点：Session 让出等待中，你的话和一条回复同时就绪 → 先处理你的话，等待已是 `answered`、还没被消费；随后回复作为接续送达、只消费一次。（第一轮审查第 4 条；第二轮审查第 9 条）
- D-02（TE3）没有 `run.input_accepted` → 不算消费，下次重给；同一回复不给两次；可提供不算接受。（第一轮审查第 4 条）
- D-03（TE4）干预：线上有没做完的任务 → 接着做（`taskRef` 优先，没有取最新活跃任务）；没有任务的活跃目标 → 在这条线开只读 Query（调用种类 `intervention_planning`），回答里带完整草稿，Query 记 `sourceMessageRef`，平台把草稿交 `plans/propose`、照常校验和采用（自动档自动采用、每步确认出卡）；已完成目标 → 先确认新目标，旧完成事实不变。（第一轮审查第 9 条；第二轮审查第 7 条）
- D-04（TE4）等待不被盖住：Session 让出等待 A，你的干预用 `intervention` 绑定在它上面跑了一次执行（原等待仍绑让出的那次运行）→ “在等”仍读到 A；L7 的读法替换 2C T7 的按最近领取。（第一轮审查第 5、16 条）
- D-05（TE3）消费仲裁：回复和到期同时可消费同一个等待 → 赢下 `wait-consumed:<message key>` 认领的只有一个、回复赢；重复 no-op；重启按已提交认领重放；到期的认领只在 Kernel 接受 `expiry:<message key>` 的那次提交拿，仅是记下到期不消费。（第一轮审查第 5 条；第二轮审查第 2 条）
- W-01（TE5）已答未消费与到期两步：一条等待收到回复 → 状态 `answered`，在被接续消费以前重读仍是 `answered`（不是 `open`、不是 `consumed`）。注入时钟过期限、没回复的等待在处理点记 `expiredAt` 并记下 durable 输入 id `expiry:<message key>`（未消费），等它的执行收到 `expiry` 接续；只有 Kernel 接受该输入的那次提交才拿下 `wait-consumed` 认领、等待变 `consumed`；之后回复到了 → 普通输入。（第一轮审查第 5 条；第二轮审查第 2、9 条）
- W-02（TE5）处理点上回复和期限同时到：回复的提交游标在期限检查之前（先 t1 写回复、t2 查期限）→ 按回复处理，不记到期、不写 `expiredAt`、只消费一次。（第一轮审查第 5、17 条）
- W-03（TE5）追问链：第一次真到期（t1）、追问（t2）、第二次真到期（t3）→ 第二次提示；t3 后同一毫秒再扫 → 不加次数。（第一轮审查第 17 条）
- W-04（TE5）断开：收件线归档 → 双方和你各一条请知悉；未送达的你转发给另一条线（同项目、`active`、没退役、职责允许）→ 新消息 + 新旧互相引用、原等待不被消费；已送达的问题改回复处理方 → 只改 `replyHandler`、不造新消息、问题和期限不变；目标取消的转发 → `invalid`、`goal_cancelled`；取消等待写 `waitCancelledAt`，撤回写 `withdrawnAt`。（第一轮审查第 6 条；第二轮审查第 4 条）
- W-05（TE5）唤醒：20 个目标 G01–G20 同时进入等待、各自登记并读下当时游标，按稳定顺序（目标键）排成一个队列 G01–G20；一条匹配提交到了立刻做一次有界排空，这一轮按队列顺序最多唤醒 G01–G16（`WAKE_LIMIT = 16`）；排空结束时立刻为余下的 G17–G20 排下一次有界排空，不等新的匹配提交、不等心跳；下一轮唤醒 G17–G20。心跳只查到期（L8），不参与唤醒。重启以后从已答复、已到期的等待和已放行没处理的动作重建登记，并把重建出的就绪工作立刻入队（不等下一条提交）。（第一轮审查第 8、17 条；第二轮审查第 9 条；最后核对第 4 条）
- W-06（TE5）秘书的“请回答”被回复 → 当前归属的秘书排一个 `reply` 轮；同一处理点的几条合成一轮（`absorbedInto`），每轮一个 `relatedMessageRef`；秘书已换手 → 排在接任者上。（第一轮审查第 10 条）
- W-07（TE7）问一问已退役、历史读不到的线 → 咨询的 SessionOperation 记 `platform_facts` 和采集到的事实引用；回答写明免责；重放身份是那个 operation；Kernel 历史真为空是 `kernel` 加零条记录；原线仍是退役。（第一轮审查第 11 条）
- W-08（TE4）复制目标：确认时没勾的撤回（`withdrawnAt`）；首个方案采用以后勾的**转发**（走 L9 的 forward：`transferredTo` + `originalRef`，原收件方还活着也转）、重复不再发（`forwarded` 认领）。（第一轮审查第 6 条；第二轮审查第 4 条）
- S-01（TE4）挑执行者：先按范围、职责、授权过滤；负责任务的 A、负责模块的 B、同目标做过的 C → 选 A；A 占用 → B；显式转来的负责链接优先；关联/历史按页读、读不全在决定记录写明；都没有 → 只发“建议建一个”。（第一轮审查第 12 条）
- S-02（TE4）重叠：M 上有一个正在跑的任务，M 上还有一个排队任务，N 上有一个排队任务 → N 先开始（模块 N 不和正在跑的 M 重叠，可直接派）；派 M 上的排队任务前，参谋（没有就秘书）记一条 M 的接口约定注记；这条注记要写在正在跑的 M 任务开始以后，或你/参谋标“放行”，第二个 M 才派；只核版本、不加锁。（第一轮审查第 12、17 条；第二轮审查第 9 条）
- H-01（TE6）换手：没写当前理解 → `incomplete`；写了、短期线自动档 → 写一个 `kind: 'handoff'` 的 SessionOperation（源、`assignments`、批准 pin、阶段标记）→ 建新 Session（t1）→ 等旧执行结束（t2）→ 转负责关系（t3）→ 旧线归档（t4）、一条请知悉。崩溃点分两处：(a) 在 t3 以前（建了 Session、旧执行已结束）重启 → 按 operation 的 stage 从转负责关系接着做，旧的负责链接还开着（`sourceLink.until` 仍为 `null`）、新链接还没开（`destinationLink` 为空），不重复建 Session、不重复写阶段；(b) 在 t3 以后、t4 以前重启 → 转负责关系已提交（旧链接 `until` 已写、新链接已开、发过 `SessionResponsibilityChanged`），只差归档 → 接着做归档，不重复转、不重复发阶段。（第一轮审查第 14、17 条；第二轮审查第 9 条）
- H-02（TE6）只交出一个任务 → 旧线保留另一个任务；交给已有的线 → 它的来历（origin）不变、多一条负责关系；接任者的 continuation brief 列出交出的任务和理解指针。（第一轮审查第 14 条）
- H-03（TE6）建成员：有匹配的空闲线且职责、范围完全匹配 → 返回它；没有 → 每步确认出 `member_creation` 卡（approve/reject）、自动档直接建；固定工人调 `create_member` → 没有这个工具；委托不在执行绑定的 `createMember` 里 → `forbidden`；批准落实按 `commandId` 重放。（第一轮审查第 13 条）
- T-01（TE4）返工工具：每步确认下 agent 请求返工 → 出 `rework_request` 卡（approve/reject）；自动档 → 返工并通知；和自动返工共用上限；你批准的返工算 agent 发起、进同一个上限。（第一轮审查第 13 条）
- T-02（TE4）自动返工 → 目标当前归属的秘书收到一条被动通知、不开新轮；同一来源（requeue 或轮次 ref）去重；同一任务第二次 → 参谋也收到；自动重新检查也含在通知里。（第一轮审查第 15 条）
- A-01（TE1）落实和拒绝的写者：收件人做完动作写 `appliedAt` 和 `application`（回执身份 + 指纹 + 游标 + effect 的 kind/ref，五种 kind 各测一条）；校验器核对 effect 那次提交带这条消息；换别的消息的回执 → `invalid`；重试同 `commandId` 回原回执；先写了 `rejectedAt` 再写 `appliedAt` → `revision_conflict`。（第一轮审查第 7 条；第二轮审查第 5 条）
- R-01（回归）用户和回复同时就绪 → 先用户；等待保留；处理完用户后回复作为接续送达、只消费一次。（第一轮审查第 4、19 条）
- R-02（回归）已读/已回复但 `acceptedInputs` 没有对应记录的旧消息 → `delivered`、`deliveryEvidence: 'legacy_unknown'`；有接受记录的 → `delivered`、`deliveryEvidence: 'accepted'`；`pending` 又没接受的 → `queued`。（第一轮审查第 1、19 条）
- R-03（回归）一条你已批准（有 `approvedAt`）但目标暂停的消息，和另一条 `awaiting` 的积压消息：把自治从「每步确认」改成「方案确认后自动」、目标恢复 → Workflow 放行已批准那条，`awaiting` 那条仍要你放；两种结果都断言。（第一轮审查第 3、19 条；第二轮审查顺带改）
- R-04（回归）秘书收件箱只有 `notify` 的请知悉 → 空消费、不开模型轮；下一条真正的工作消息到了才处理，且上下文里已带那条请知悉。（第一轮审查第 15、19 条）
- RL-01（TE8，7D2 联动补验；审查二第 18 条）开局三条线和重启补做：项目第一个工作区登记完成 → 平台建一个 `role_line` 操作（action `start_lines`），三步（秘书、参谋、书记，范围整个项目）各自一个创建子操作和进度；每步取名额预留 → 建 Session（Runtime 两阶段）→ 登记并写 `SessionRoleFactsV1`（`openedBy: 'start_lines'`、`creator: platform`）、项目范围链接、预留转持有；幂等按操作身份；Host 启动只接着做没完成的步骤 → 三条线不重复建、不重复占位。（决定 60-1）
- RL-02（TE8，7D2 联动补验；审查二第 18 条）你开线和改范围：`role-lines/open { duty: RoleLineOpenDutyV1, scope: RoleScopeV1[], name? }` 只认人、直接生效；`duty` 不是秘书、参谋、书记 → `invalid/role_line_duty`；到保留上限 → `capacity/at_cap`，带当前持有、预留和上限，界面同一处给“调高上限并开线”；`role-lines/change-scope` 用 L25 关旧开新；新范围已有同职责负责人 → `revision_conflict/scope_owned`。（决定 60-2）
- RL-03（TE8，7D2 联动补验：要 `role-lines/open`；审查二第 18 条；审查二 lead 补）占位冲突：参谋 A 负责区域 M；再开一条负责 M 的参谋线 → `revision_conflict/scope_owned`，带现在的负责线；嵌套（上级区域和下级区域各有一条）可以，只在开线和改范围时提示。（决定 60-5）
- RL-04（TE8，7D2 联动补验；审查二第 18 条）手算例子：保留上限参谋 2、A、B 各负责 3 个进行中的 small 目标、都是「方案确认后自动」、没有别的可用参谋；确认 G7、G8（初筛都是 `small`）→ 两个目标都建成、队列 `[G7, G8]`、只有一张 `role_capacity` 卡（主体 `project`）；把上限调到 3 → 平台开参谋 C、按排空依次把 G7、G8 分给 C、队列空、A/B/C 负责 3/3/2 个目标；用固定的事件时间推进过一个汇总窗口 → 请知悉按主体分别汇总：主体 `project` 一行“开 C”，G7、G8 各一行分派（L43），固定事件时间让分组唯一；任一阶段重启、重放都不多出线、分派或请知悉。（决定 60-8、62-1、62-2；审查二第 19 条）
- RL-05（TE8，7D1 可验；审查二第 18 条）并发降限和最后一个预留：保留上限参谋 8、持有 7、预留 0（名额只剩 1）；一条建线先取走最后一个预留（持有 7 + 预留 1 = 8）；和一次把上限降到 2 交错提交，断言确切顺序和最后结果——降限先成 → 建线的预留守卫按新上限重判、回 `capacity/at_cap`、预留不取（最后持有 7、预留 0）；预留先成 → 降限照写不撤销已有的（最后持有 7、预留 1，登记后持有 8），之后再加线一律 `capacity/at_cap`；不会因为空着一个旧号就加上；两个 `projects/role-limits/set` 带同一个 `expectedRevision` → 一个成功、另一个 `revision_conflict`；每次写审计事件 `ProjectRoleLimitsChanged { from, to, actor }`。（决定 62-2；审查二第 19 条）
- RL-06（TE8，7D1 可验；审查二第 18 条）满额下完整换手：保留上限满、同职责完整换手 → 接任者在前任的名额下登记（受换手围栏保护），最后交接那次提交把持有从前任移给接任者；不出现两倍计数、不多占名额；中途重启按换手操作接着做。（决定 62-2）
- RL-07（TE8，7D1 可验；审查二第 18 条）满额下部分换手：只交出部分任务 → 多出一条线，要另外走 L31 准入；到上限 → `capacity/at_cap`，不借前任的名额。（决定 62-2）
- RL-08（TE8，7D2 联动补验；审查二第 18 条）重新启用：线归档（正式归档提交释放持有）后重新启用 → 重新准入（取预留、登记转持有）；名额满 → `capacity/at_cap`，不出卡、直接回。（决定 62-2）
- RL-09（TE8，7D1 可验；审查二第 18 条）退役未归档照算：一条线退役但还没归档 → 仍算在持有里，`role-lines/allocation` 读得到；调高上限前不加新线。（决定 62-2）
- RL-10（TE8，7D2 联动补验；审查二第 18 条）运行上限两个参谋入口竞争：运行上限参谋 4、已占 3；两个参谋启动入口（例如 Workflow 派工和公开 `queries/start`）同时到 → 共用一个按 (项目, 职责) 串行的准入器，恰好一个进（总数到 4）、另一个被挡（Run/Query 保持“已准备、未开始”、读出原因 `running_cap`、输入留队、不出卡，公开 start 路由回 `{ status: 'waiting', reason: 'running_cap', ref }`）；另测秘书组计数独立于参谋组（参谋满不挡秘书的一轮）；一轮结束 → 按 L5 的先后排空；结果未知的照算，结果核清前不当空位、不重跑；Host 重启后从持久的 Run/Query 状态重建计数，已进入或结果未知的重放只观察、不再准入、不重启。（决定 62-2；审查二第 2 条；审查二第 19 条）
- RL-11（TE8，7D2 联动补验；审查二第 18 条）episode 重开和总占用：到保留上限出 `role_capacity` 卡并开一个 `RoleCapacityEpisodeV1`；总占用（持有 + 预留）降到上限以下或上限变了 → episode 关；预留转持有不改变总占用、不关 episode（`open=8、holders=7、reservations=1` 时不反复关 episode、不重出卡）；以后再到上限 → 开新 episode、出新卡；episode 开着时再被拒 → 直接 `capacity/at_cap`，不出新卡；答复、落实、历史、分页计数按“项目 + 来源”这个来源身份、跨工作区共享（2A L6/L8）。（决定 60-8、62-2；审查二第 1 条；审查二第 9 条；审查二第 19 条）
- RL-12（TE8，7D2 联动补验；审查二第 18 条）队列排空、跳过待批和重放：目标完成、取消、暂停、上限调高、范围挪走、参谋线归档、Host 启动任一发生 → 平台按 `QUEUE_DRAIN_BATCH` 一批批分；排位按初筛 `suggestedPosition`（没有就按时间先后）；队首 G1 涉及「每步确认」要出卡、后面的 G2 是自动档 → G1 保留在队里、记下动作身份和唤醒依据，接着分派不依赖它的 G2，G1 不预占参谋的目标额度；你批准 G1 落实时按队列 revision 重核候选和容量；取消的目标出队、已分过的重放不再分；暂停的目标不计入 3 个、继续时留在原参谋（可以超过 3 个）。（决定 62-1；审查二第 3 条；审查二第 19 条）
- RL-13（TE8，7D2 联动补验；审查二第 18 条）太长、太慢拆分和提议拆分：一条参谋或书记线的最近一次模型请求输入量到第 6 片 L10 的阈值 `min(500000, 模型容量 × 0.8)`，或未处理消息数 `> ROLE_LINE_SLOW_MESSAGE_LIMIT = 10` 连续 `ROLE_LINE_SLOW_WINDOW_MS = 1_800_000`；从持久的消息事件重建最近一次越过阈值的起点，数量回到 10 或以下就重置、重启结果一样；一条消息已等 30 分钟但总数刚刚到 10 不算触发。范围能切 → `role_line` 操作（action `role_line_split`，阶段 `planned → admitted → created → linked → done`）、开新线、用 L25 挪切出的范围；太长切不了 → 换手（6B），太慢切不了 → 只在线卡显示负担、不换手（决定 60-7）；`propose_role_split` 给参谋、书记，平台核 `move` 是现有范围的严格子范围、切完两边都不空、负担已知。（决定 60-3、60-4；审查二第 4 条；审查二第 19 条）
- RL-14（TE8，7D2 联动补验；审查二第 18 条）负担 unknown 不拆：区域负担因观测缺失、失败、不全、归属有歧义或 containment 不知道而 `unknown` → 不算区域位置、不递归拆；`role-lines/read` 写明 unknown，不说成“一个区域够了”。（决定 60-3）
- RL-15（TE8，7D2 联动补验；审查二第 18 条）规则的建、匹配、过期、撤销竞态、旧卡不被新规则放行：`autonomy-rules/create` 写 `AutonomyRuleV1`、`state: 'active'`；动作在 `actions` 里、涉及对象都在 `scope` 里、没过期、`active`、`limits.open` 按 `RoleLineAllocationV1` 的持有加预留核 → 按 L36 直接做；过了 `expiresAt` 同一动作不再被规则覆盖；`autonomy-rules/revoke` 只认人、不追溯；同一动作已有待答卡时新规则不放行它（决定 42）；`actions` 带 `RuleActionV1` 之外的动作 → `invalid/rule_action_fixed`；`limits.open` 超项目保留上限 → `invalid/rule_limit_over_cap`；任何建、撤、改把 `AutonomyRuleSetV1.revision` 加一。另测委托授权（目标是「每步确认」）：项目规则 `actions: ['create_member']`、`scope` 是整个项目、生效中；执行者 E（Work，`createMember: false`，没有 `create_member` 工具）调它 → `forbidden`，规则不放行；参谋 Q（Work，`createMember: true`）→ 规则匹配、直接做（`automatic_notice`）；秘书 S（Query，`tools` 含 `create_member`）给已采用计划里的任务建执行者 → 规则匹配、`automatic_notice`；建出的执行者 E2 的授权是普通执行者的绑定（`tools`、`writeScope` 照 Host 配置和角色，`createMember: false`），不是只读（审查二额外核对 D1）；`role_exploration` 的 Query 没有这个工具 → `forbidden`；Q 建出的子线 `tools` 不多于 Q 的；规则在判定和提交之间被 `autonomy-rules/revoke` 公开撤销 → 提交 `revision_conflict`，重判后没有规则、按 L36 的出厂默认出卡（审查二快速核对第 3 条）。（审查二 lead 补）（决定 62-3、62-4、62-6；审查二第 5 条；审查二第 19 条）
- RL-16（TE8，7D2 联动补验；审查二第 18 条）出厂默认按目标档：不涉及目标的人手调整（加线、拆范围、复用待命线、分派队首目标）在两个上限内直接做、汇总进请知悉；涉及的目标里有「每步确认」的 → 出卡（主体：只涉及一个目标时是那个目标，否则 `project`；来源 `role_line_change`）；`create_member`、`short_change_duty`：「每步确认」出卡，「方案确认后自动」`automatic_notice`；永远找你的动作（`confirm_goal`、`adopt_first_plan`、`remember_user_preference`、`structural_patch`、`change_goal`、`exceed_budget`、`escalate`、`long_handoff`、`change_duty`）放不开。（决定 62-3、62-4）
- RL-17（TE8，7D2 联动补验；审查二第 18 条）当场返回不挂起：工具或路由越界 → 当场返回 `{ status: 'needs_decision', cardKey }`，不挂起；只停这个动作和依赖它的（L46）；没人答就不做，没有超时放行。（决定 62-3、62-5）
- RL-18（TE8；7B，L46）L46 A/B/C 和重启：A 的自动返工待确认挡住任务 A；任务 C 有指向 A 产出的精确输入（第 3 片的精确输入）→ C 也等；与 A 无关的 B 照做；只有正式事实算依赖，计划 DAG 的软排序边不阻塞；Goal 驱动跳过 A 选同目标下一个能做的任务，只停 A 和依赖它的；Host 重启以后还是这样；候选全被挡住才回目标 `waiting`。（决定 62-5；审查二第 10 条；审查二第 19 条）
- RL-19（TE8，`creator` 记下、跟完整换手、归档失效、重新启用恢复是 7D1 可验；按 L35 找负责线和抄送是 7D2 联动补验；审查二第 18 条；审查二 lead 补）creator 的抄送和换手跟随：执行者 E 由参谋 A 建（`creator: { kind: 'session', ref: A }`）；E 的要拿主意的事按 L35 找负责线；负责线和 A 不是同一条时，A 另收一份请知悉；A 完整换手 → `creator` 跟到接任者；A 归档（不是完整换手）→ 联系失效、只留历史；重新启用 → 联系恢复；复用已有执行者不改 `creator`，只记这次派工的来源。（决定 60-6、60-10）
- RL-20（TE8，7D2 联动补验；审查二第 18 条）闲置归档、最少一条、项目范围挪走：参谋、书记线闲满 `ROLE_LINE_IDLE_ARCHIVE_MS = 86_400_000` 就归档（L38 的“闲”事实读全；“请知悉”不算活动；读不全不算闲）；每个项目秘书、参谋、书记各至少留一条，最后一条没归档的线不因闲置归档；项目范围由一条线负责，这条线被归档或退役时平台用 L25（`project_scope_moved`）挪给同职责里负担最轻的另一条线，没有别的线就等下一条线开出来时给它；归档在正式归档提交里释放范围链接、占位和名额。（决定 60-3、60-7、60-8）**（决定 91 修改：闲置归档取消，见 L38 的旁注；范围挪走照旧。）**
- RL-21（TE8，7D2 联动补验；审查二第 18 条）秘书建执行者没有负责参谋：秘书的查询调用种类 `create_member` 建或复用执行者时解析不出有效的负责参谋（L35：目标参谋，或任务所属模块的区域参谋）→ `invalid/no_responsible_adviser`，读的时候这个任务显示“等参谋”，不拿 creator 或你代替；`creator` 是这个秘书、`openedBy: 'secretary_create'`；被挂的参谋收请知悉（按操作去重）；走执行者的保留上限。（决定 60-10）
- RL-22（TE8，7D2 联动补验；审查二第 18 条）复制目标挪责任：目标取消后复制成新目标 G2（决定 39）；6B 的复制确认那次提交里用 `planReanchor` 把目标参谋、目标书记挪到 G2（`reason: 'goal_continued'`），新目标记“接续自”，进请知悉；原线已复用或归档的，G2 按 L33 另找；暂停的目标保留负责关系。（决定 60-7）
- RL-23（TE8，7D2 联动补验；审查二第 18 条）冷启动各阶段恢复和探索身份：`role_line` 操作（action `cold_start`）阶段 `candidates → adopted → route → coarse_split → regions → proposals` 持久；重启从没完成的阶段接着做；每段的系统消息、开线都按操作身份去重（不多发、不多开）；`candidates` 里还没有目标的回答先存候选、目标确认后再绑；`coarse_split`/`regions` 的探索用查询调用类 `role_exploration`，`goalId` 可以为空、可信 principal 是 QueryRun、绑定 `role_line` 操作和那条系统“请动手”消息，注册看、找、只读命令、范围受限的 `record_note`、`propose_architecture_revision`（普通 copy 权限不变，`query-execution.ts:381` 放开没有目标）；`regions` 超上限的区域记在操作的待开列表里、名额空出来时排空；`proposals` 按冻结批次、基于同一个目录 pin 合卡，pin 过时回 `source_stale`；8C 可以假提议。（决定 61-1、61-2、61-4；审查二第 11 条；审查二第 19 条）
- RL-24（TE8，7D2 联动补验；审查二第 18 条）一条真实的 8C 提议→批准→修订：至少一条冷启动验收跑真实的 `propose_architecture_revision { baseCatalogPin, ops, responsibilityMoves, reason, operationRef? }`（参谋）→ 冻结一个批次（批次身份、完整成员、`baseCatalogPin`、合并后的 ops、`responsibilityMoves`、摘要）→ `structural_proposal { batchRef }` 卡（主体 `project`）→ 你批准绑定这个冻结批次、一次提交落实其完整效果 → 第 8 片 8C 的修订写入方（`architecture/revise` 的服务）按冻结的基线 pin 落实成修订提交；晚到的提议另成批次，内容或 pin 变了不复用旧批准，冲突的不覆盖、各自成批；其余冷启动用例可以用假提议；混用 PASS 和足迹门槛的修补照旧不变。具体的合卡 ops、兼容/冲突结果和最终修订次数见第 8 片 R-11。（审查二 lead 补）（8C；审查二第 12 条；审查二第 19 条）

### 5.3 要改断言的旧测试（冻结时 lead 列全）

- 读 `readSessionFacts` 在等的测试：按最近领取的断言改成按消息读（L7）；2C T7 的行状态输入也要改（`docs/refactor/design/orchestration-2026-10/slices/slice-2C-SPEC.md:1054`）。（第一轮审查第 16 条）
- Host 空闲消费只扫配置消费者的测试：改成遍及活跃 Session（L6）；加一条只有 `notify` 的收件箱不消费的断言。（第一轮审查第 15 条）
- 咨询拒绝已归档来源的测试：翻转（L14）；加 `platform_facts` 模式和空 Kernel 历史 `kernel` 的分支。（第一轮审查第 11 条）
- `apply_future_plan` 的测试：删掉（§0.1 第 3 条，用户 2026-10-15 晚定）。
- `message_release` 来源 `unsupported` 的测试：翻转（L3）；改成批准（写 `approvedAt`、`release: 'approved'`、不核版本）和放行（目标 `active` 时重核、动作加序号、询问不加）两段；加“请回答”也 `awaiting`、目标暂停时 `approvedAt`、恢复后 Workflow 放行。（第一轮审查第 3 条；第二轮审查第 3 条）
- 到期时先拿 `wait-consumed` 的旧测试：改成记下到期只写 `expiredAt` 和 `expiry:<message key>`、不拿认领；Kernel 接受该输入后才拿认领、记 `consumed`（L8）。（第二轮审查第 2 条）
- 转发/转交混用的旧测试：拆成未送达消息的转发（新消息 + `originalRef`/`transferredTo`）和已送达问题的转交（只改 `replyHandler`）两条（L9）。（第二轮审查第 4 条）
- 落实只比时间戳的旧测试：改成按 `application`（回执身份、指纹、游标、effect）校验、五种 kind 各一、`commandId` 重放（L1）。（第二轮审查第 5 条）
- 唤醒按目标身份匹配的旧测试：改成观察只给项目和种类、取项目里登记的目标重核事实；加目标恢复、Session 可用、接口约定注记三种触发（L10）。（第二轮审查第 6 条）
- 消息 `delivery` 的旧投影测试：按 `acceptedInputs` 重写（L1）。（第一轮审查第 1 条）
- 派工序号从 0 起的测试：改成不存在时写 1、pins 是加之前的值、同 `commandId` 指纹冲突（L2）。（第一轮审查第 2 条）
- 返工/重新检查回 `forbidden` 的测试：改成每步确认出卡、批准按 `commandId` 重放（L19）。（第一轮审查第 13 条）
- 挑执行者的排序测试：加范围/职责/授权过滤、显式转来的负责链接优先、按页读不全写明（L15）。（第一轮审查第 12 条）
- 重叠只提醒的测试：改成派第二个前的接口约定注记和等待/放行（L16）。（第一轮审查第 12 条）
- 意图名字的测试：旧的 `'action'/'answer'/'notice'` 断言改成 `action_request`/`inquiry`/`notify`（L1）。（第一轮审查第 1 条）
- `WorkLinkTarget` 的种类测试：旧的 `task | work | module` 断言加 `goal`、`project`；严格 union、索引、工具 schema、图邻接和 UI 的解码都跟着改（L23、§2 的 7D1 共享基础）。（决定 60-5；审查二第 18 条）
- 7D2 联动补验：`change_duty` 的自治断言：今天两档一律 `needs_decision`；拆成长期线（秘书、参谋、书记、模块维护线）仍 `change_duty`、两档都出卡，短期线（其余执行者）改成新动作 `short_change_duty`（「每步确认」出卡、「方案确认后自动」直接做、进请知悉）（L40）。（决定 60-10；审查二第 18 条）
- 7D2 联动补验：长期线不自动归档的测试（第 1 片 §2.8、IT09、接线包 1 L16）：改成参谋、书记闲满 `ROLE_LINE_IDLE_ARCHIVE_MS` 归档、每种职责保留最后一条（L38）；接线包 1 L16 只属于执行者/模块维护关系，不给区域参谋永不归档资格。（决定 60-3、60-7、60-8；审查二第 18 条）**（决定 91 修改：长期线不按空闲时间归档，原来“长期线不自动归档”的测试按决定 91 保留，不改。）**
- Goal 驱动碰到要确认的卡就停整个目标的旧测试（`workflow.ts:1263/1359`、`collaboration-driver.ts:844`）：改成跳过在等卡的那个任务、接着选同目标下一个能做的任务，只停这个任务和依赖它的（L46）。（决定 62-5）
- 根路径 `.` 的旧测试（8A）：最长前缀匹配里 `.` 要匹配所有相对路径、长度 0、优先级最低（`goal-conflicts.ts:470/492`、`graph-index.ts:96`、`architecture-record-codecs.ts:265`；源码映射的 `safeRelativePath` 只额外收 `.`）；“未细分” = 路径是 `.`、没有子模块的模块，读出来标，不加目录字段。（8A）
- 模块改名/换身份的旧测试（8C L5）：改显示名走 `set_module_name`、保留 `moduleId` 和负责关系、不触发删除限制、不算结构改动、不要去向、旧锚点不读“模块已删”；只有 `remove_module`/换身份才查删除限制、处置去向、旧锚点读作已删；换身份 = 删加，带 `responsibilityMoves`；被开着的负责关系引用时缺去向 → `invalid/responsibility_destination_missing`；被没终结任务引用的照旧不能删（`module_in_use`）。（8C；审查二第 14 条）

## 6. 文件（第一稿；第一轮审查第 18 条改成仓库路径）

- **7A：** `src/core/work-graph/model/communication-contracts.ts`、`src/core/work-graph/sessions/message-record-codecs.ts`、`src/core/work-graph/state/message-machine.ts`、`src/core/work-graph/communication/mailbox-service.ts`；新的派工序号编解码和服务；`src/contracts/core/session-message.ts`；`src/core/work-graph/communication/decision-application.ts`（落实/拒绝，第一轮审查第 7 条）；新的 `application` 校验器（照 `decision-application.ts`，第二轮审查第 5 条）；决定来源、读取、落实（第 4 片也改）；`src/contracts/ledger.ts`（2B、2C、第 4 片也改）。
- **7B：** `src/core/agent-runtime/execution-inputs.ts`（确认要认识到期输入 id `expiry:<message key>`，第二轮审查第 2 条）、`src/contracts/dispatch.ts`（`RunContinuationV1` 和 `ConsumedWaitV1` 判别式，第二轮审查第 1 条）、`src/core/work-graph/tasks/claim-service.ts`、`src/core/work-graph/tasks/session-facts.ts`、`src/core/work-graph/state/session-availability.ts`；`src/business/workflow/workflow.ts`、`consultation.ts`；`src/app/collaboration-driver.ts`、`startup-reconcile.ts`、`host.ts`；新的内存 `WakeSet`（`src/composition/commit-observer.ts` 接，按项目 + 种类匹配后重核登记目标，第一轮审查第 8 条；第二轮审查第 6 条）；第 6 片的请求服务；干预规划 Query 的调用种类 `intervention_planning`（第二轮审查第 7 条）；2C 的线读取（消息状态投影补一次，T7 的等待来源改成 L7）；L46：改 `workflow.ts:1263/1359`、`collaboration-driver.ts:844`。
- **7C：** 新的建成员、返工工具适配器；`hand_off` 工具和批准卡适配器（共用的 Runtime 换手动作在 6B，第二轮审查第 8 条）；`src/core/agent-runtime/session-operations.ts`、`execution-driver.ts`；`src/business/workflow/workflow.ts`、归档和维护；`src/app/host.ts` 的注意力；`src/core/agent-runtime/whiteboard-tools.ts`（`apply_future_plan`）；`src/core/agent-runtime/query-preparation.ts`（秘书那一档解除 `FORBIDDEN_QUERY_TOOL_NAMES`，第一轮审查第 10 条）。
- **7D2 的角色线探索 Query（`role_exploration`）：** `query-preparation.ts` 注册看、找、只读命令、范围受限的 `record_note`（按 S4 L2a 的范围准入）、`propose_architecture_revision`；`query-execution.ts:381` 对这个调用类放开“没有目标”；`query-execution.ts` 的可信 principal 用 QueryRun，绑定 `role_line` 操作和系统“请动手”消息（审查二 lead 补：不经 `consultation.ts`）。（审查二第 11 条；审查二第 18 条）
- **无 Goal 初始化绑定的文件（7D2 联动补验）：** `tasks/initial-plan.ts`（:126、:140、:150）、`tasks/plan-service.ts`（:1147、:1225、:1253）和相关契约（`src/contracts/query-job.ts` 的 `InitializationBindingV1`；和第 6 片 §6 同一份）；无 Goal 分支的读取和规范化从绑定取 Goal 版本和 `planId`，提议和采用重读并守同一个绑定。（审查二第 8 条）
- **共用的登记文件**（组合根、路由、HTTP 类型、界面路由表、Workflow 的契约和端口）：2B、2C、第 4、6 片都改，按合入顺序排，不并行。
- **7D1（新文件，7D1 可验）：** 角色线范围/职责/creator 事实（`SessionRoleFactsV1`、`RoleScopeV1`、`CreatorRefV1`）、项目角色上限（`ProjectRoleLimitsV1` + `ProjectRoleLimitsChanged` 审计事件）、保留名额（`RoleLineAllocationV1`）、`planReanchor`/`reanchorSessionResponsibility`/`transferSessionResponsibility` 的扩展、`role-scope:` 占位、项目主体的卡源和请知悉基础（`DecisionSubjectV1`、`notifyProject`）；路由 `projects/role-limits*`；读口 `role-lines/allocation`。（决定 60-5、62-2；审查二第 18 条；路由归 7D1 是审查二 lead 补）
- **7D2（新文件，7D2 联动补验）：** 新目标队列（`GoalAdviserQueueV1`、`GoalScreeningV1`）、规则（`AutonomyRuleV1`）；新路由 `role-lines/*`、`goals/adviser-queue*`、`autonomy-rules*`；工具 `propose_role_split`；秘书查询的 `create_member` 注册；运行准入（`projects/role-limits*` 在 7D1）。（决定 60-1、60-2、60-4、60-8、61-4、62-1、62-3、62-4；审查二第 18 条）
- **第 1 片代码（7D1）**：`WorkLinkTarget` 加 `goal`、`project` 的整套：`session-record-codecs.ts`（checkTarget、checkWorkLinkRef、按 goal/project 的索引）、`lifecycle-record-codecs.ts`、`session-directory.ts`（checkTargetScope、targetRelationPlan 不能落到 work 分支、findSessions）、`session-targets.ts`、`session-lifecycle.ts`、`session-responsibility-service.ts`（L25 的扩展）、`plan-readers.ts:1922`、归档处置（`contracts/core/session-archive.ts`、`business/workflow/session-archive.ts`、`state/session-availability.ts`：goal/project 范围按 L38/L39 释放，不进“任务归档选择”）、`session-maintenance.ts`（L38）、`session-operations.ts`（名额预留随创建子操作）、`session-discovery-tools.ts` 的 targetSchema、`decision-record-codecs.ts` 的 pin 字段、`graph-context-reader.ts`（Goal↔Session 邻接）、UI（`layout.ts`、`aux-layout.ts`、`task-structure.ts`、`detail.ts`、`interaction.ts`）。角色线（秘书、参谋、书记）的 Session 建在项目主工作区（第一个登记的工作区）；跨工作区的候选读取按同项目的所有工作区，执行绑定照旧按任务的工作区；项目范围的负责关系不扩大 Runtime 工作区权限。旧规格后注：第 1 片 L4、§2.8、S1-LINK-01/02、IT09。（审查二第 9 条；审查二第 18 条）
- **第 5 片代码（7D1）**：`goal-decisions.ts`（动作、卡源、`DecisionSubjectV1`、`decisionSourceKey`）、`decision-policy.ts`（L36 的输入）、`decision-contracts.ts:162`（source facts 按主体判别，项目卡不造 Goal）、`decision-service.ts:823/854`（项目卡的来源及答复唯一身份按“项目 + 来源”，不再因入口 `workspaceId` 产生副本）、`decision-source-facts.ts`、`decision-application.ts`（四个选项的落实证明）、相关状态迁移、`decision-read-model.ts:1048`（项目级卡源沿 2A L6/L8 完整分页；答复、历史、分页计数跨工作区共享，已读水位按工作区各记）、`NoticeItemV1` 和 `notifyProject`。旧规格后注：第 5 片 L1、S5-AU-03/04；2A L6、L8；接线包 2 L2、L5、L9。（审查二第 9 条；审查二第 18 条）
- **第 3 片代码（7D2 联动补验）**：装配器提醒段加上限事实（7D2）；查询加工具（6A、7C）；find 改大小写和最长前缀、注记装配格式（4C，决定 59）。旧规格后注：CTX-03、§4.1、§4.3。（审查二第 18 条）
- **Runtime 和路由（7D2）：** L31 的运行准入器接在真实共同启动路径：`collaboration-driver.ts`、`core-routes.ts:529/569`、Workflow 派工、消息消费、秘书的一轮、咨询（`consultation.ts:226`）、公开的 `executions/start`、`queries/start`；`workflow.ts`、`collaboration-driver.ts` 的 L46（7B）。（审查二第 2 条；审查二第 18 条）
- **文档（lead 写）：** STATE-MACHINES-SPEC 新行；DESIGN §2.11（三版核对的写法）、§9.3（期限、批量、唤醒上限）；MODEL O23、O24、O27、O44 的接口表示；E3-UI-ITEMS；STATUS、能力索引。

## 7. 施工

- **前提：** 7A 在第 4 片（4A）、第 6 片（6A）合入以后；7B 在 7A、6B 以后（6B 有已完成目标确认、复制、秘书换手；L46 属 7B）；7C 在 7A、7B、第 4 片、6B（共用的 Runtime 换手动作）合入以后；7D1 在 7A、7B、7C、6B 以后、8C 之前；7D2 在 7D1、8D 以后。6B 的共用 Runtime 换手动作（阶段推进，不带工具、不出卡）先于 7B、7C。2B 不是声明模块重叠的前提。（第一轮审查第 16 条；第二轮审查第 8 条；审查二第 18 条）
- 每小片一个副本、一个新的 DSH Session；先通读、报看不懂的地方；任务书带推荐分组、可以调整写明理由、子任务没回报完不结束回合。
- 夹具由 DSH 写，只经公开服务造；例外：M-01 的存储边界交错提交替身、TE5 的注入时钟和重启替身。
- **施工顺序：** 4A → 4B → 4C → 6A → 6B → 7A → 7B → 7C → 7D1 → 8A → 8B → 8C → 8D → 7D2 → 6C；8D 在 7D2 之前。（决定 60-1、61-4；决定 63；审查二第 18 条）
- **7D1 的前提：** 7A（消息）、7B（L46 等待只挡一支）、7C（建成员、换手工具）、6B（共用换手动作）都先有；排在 8C 之前。（审查二第 18 条）
- **7D2 的前提：** 7D1（共享基础）、8A（文件级观测、代码量、根路径）、8B（containment、区域）、8C（修订带负责去向、结构修订提议通路）、8D（多语言观测的引用关系）都先有；依赖 7D2 才完整的接线 4C（书记范围和提醒）、6A（秘书挑选看范围和满额）、6B（目标卡排队和复制目标挪责任）、7C（秘书建执行者）列为 7D2 的改动文件和验收，前面的小片按“只有开局三条线、范围都是整个项目”先做，行为不变。（决定 60-3、60-8、61-4、62-1；审查二第 18 条）

## 8. 不做的事

- 不建等待表、不建调度库。
- 不按语义拦派工，不加全局锁；重叠只走接口约定注记和版本核对。（第一轮审查第 12 条）
- 记忆、消息都不改任务完成状态；旧的完成事实不改。
- 不自动建成员（没有合适的只发建议）——这句只限挑人这条路；角色线按 L26、L27、L29、L30 由平台或你建，秘书建执行者按 L42。（决定 60-3、60-4、60-10）
- 不做每天花费额度；不审查模型；不按命令内容判风险（命令在 Kernel 隔离里，断网）。（决定 62-7）
- 不把 `notify` 的请知悉当成模型输入。（第一轮审查第 15 条）
- 不在 `platform_facts` 模式下恢复原线。（第一轮审查第 11 条）
- 不在“记下到期”那一步拿 `wait-consumed` 认领；只有 Kernel 接受 `expiry:<message key>` 才算消费。（第二轮审查第 2 条）
- 不把转发当转交：未送达（或复制目标勾过）才转发，转交只改已送达问题的回复处理方。（第二轮审查第 4 条）
- 不把共用的 Runtime 换手动作放进 7C；它在 6B，7C 只加工具和批准卡。（第二轮审查第 8 条）
