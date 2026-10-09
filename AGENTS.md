# 独立仓库工作入口

**2026-10-08 可靠性批次已做完，已推送为远端新分支；新界面原型已冻结：**

*批次状态。* 分支 `feat/reliability-and-structure` 上的可靠性批次（任务书任务 A–E）**已做完，全部提交**；2026-10-08 按用户决定 44 由 Codex 推到远端新分支 `feat/reliability-and-structure`（9b94fc55），远端 `next-main` 不动，本地主检出目录的 `next-main` 已快进到同一提交；**整个 MVP 没有完成**。做完的有：任务 A（规格，第 1–7 步，简化：先删走不到的代码，决定 31、34）；任务 B、C、E；决定 29（Goal 控制必须带 GoalPhase 版本号，e070284b）；任务 D（WorkGraph 拆分，纯搬移，决定 32、34、40：先做 X2、X1 两小步 d91208e3、58ea2fdc，再由本地 DSH 按两阶段搬了 18 个文件，和 lead 的参考搬移逐字节一致，0cd45508）；子模块规则写进 `module-target.json`（决定 40，002e7b28；state 改用 `pure: true`，820817c3）；2026-10-08 的收尾（独立审查和保留 / 删除 / 合并 / 挪位置清单，见[收尾审查证据](docs/refactor/reviews/evidence/batch-wrapup-2026-10-08/README.md)）。收尾后的全量测试 215 个测试文件、5234 项全部通过，`verify:isolated` 也通过；本批没有调用真实模型，之后也还没用真实模型重跑过。下一阶段是编排后端：按 [design/orchestration-2026-10](docs/refactor/design/orchestration-2026-10/README.md) 的设计书分片施工，先做第 0、1、3、5 片，实现都交给 DSH（决定 36、43）；然后是新界面（E3）。2026-10-09：第 0、1、3 片已做完并合入本分支（21a99915、327ec020、ccecc016、e48218a5；已由 Codex 推到远端新分支 `feat/orchestration-slices`，37207768，本地主检出目录已快进；全量 250 个测试文件、5626 项通过，没调用真实模型）；接线包 1（I-1、I-3、改目标说明的检查、普通接续的交接，决定 47）做完并合入（6180adfc，没有推送；全量 258 个测试文件、5,689 项通过，`verify:isolated` 通过，没调用真实模型）；第 5 片按决定 47 又做了一轮（四个区域交新的 DSH 会话），全量全过，但仍有 6 处用户看得到的问题、这些地方没有测试覆盖，没有合入，决定 48 再给一轮（先由 Codex 补测试）；之后是接线 I-2、I-4、I-5、I-6。证据在 `docs/refactor/reviews/evidence/orchestration-slice-<n>-2026-10-08/` 和 `orchestration-wiring-1-2026-10-09/`。当前状态、缺口和下一步见 [STATUS](docs/refactor/STATUS.md)。用户 2026-10-04 至 10-09 的 48 条决定见 [HANDOFF 顶部](docs/refactor/HANDOFF.md)两节：1–19 和 20–48。

*界面基线。* 新原型在 [Design 画布](https://claude.ai/artifact/3e5ynF3rwtMQfvJuim9mL2)上，只有用户本人能打开。
- 用户 2026-10-05 批准了原型（画布第 9 版）。2026-10-06 按 HANDOFF 决定 25–30 改版，发布为画布第 14 版；2026-10-07 按决定 33 改了左栏工作线的点击，发布为画布第 16 版。用户确认后冻结（决定 35），画板文件和设计说明复制进 [docs/ui-reference/workbench-2026-10](docs/ui-reference/workbench-2026-10/README.md)。
- 界面以这些画板和 [UI-WORKBENCH §0](docs/UI-WORKBENCH.md#ui-decisions-2026-10) 为准。`docs/ui-reference/agent-workbench.html` 只管决定没有替换的部分。

已被替换或新增的点，分组与 UI-WORKBENCH §0 一致。

替换旧原型的条目：
- 悬停：短预览改为信息卡，只读已加载的数据；
- 双图：画成小方格加连线，方格里不放符号，状态用颜色和填充表示，还没开始的任务一律空心；
- 任务图：整页是 DAG + 大纲 + 轨道，主画面右栏是最多 3 层的方格树缩略；
- 架构图：分成聚焦视图和完整架构图页，按探索出的语义分组；
- 时间视图：纵向连续放大镜改为「轨道 + 活动日历」，一条轨道是一条工作线（一个 Session 加上接续它的 Session）。

旧原型没有、新增的条目（举例，完整列表见 §0“新增”）：
- 主对话：给 2–3 个方案，在对话中迭代后采用；
- 目标：每个目标一条线，有顺序和冲突提示，冲突只做建议；
- 成员：成员卡片，「问一问（只读派生）」和「直接干预」分开；
- 「需要你决定」队列。

*不要改回旧原型。* 后来的 agent 不得因为旧原型还是基线，就在这些被替换或新增的点上把界面“纠正”回旧原型。没被替换的点照旧保留，例如：多页签辅助区（文件、命令、Diff）、可拖动的分隔、把文件或选区引用进草稿、未来节点留在图上、原历史按需可读。

*一处过期边界。* 下文 2026-09-28 边界段里的“架构初始化仍需人工审阅 JSON”是当时的情况，现已过期，原句按历史保留。9-29 冷启动接线后，主对话的“采用并执行”可以一键采用模型给出的初始架构；设置页的“采用初始架构”（本机资料）和“高级：粘贴/导入已审阅的初始架构 JSON”仍保留，用于人工设置。

**2026-09-29 上传基线：** 本次按用户要求提交当前已验收的协作机制、工作台与目录浏览修复，源码目标为 `hk865/coding-platform` 的 `next-main`，文档同步到 `hk865/my-coding-platform-docs` 的 `next-main/docs`。下文“未提交/未推送”和临时进程信息保留其历史时点，不代表本次上传状态；当前缺口和验收边界继续有效，未宣告整个 MVP 完成。

**2026-09-29 文件资源管理器修复：** 普通目录浏览改用既有 Kernel 路径枚举，不再依赖完整文本 capture；二进制/大文件不阻断文件名展示。每次本地显示100项、可输入子目录、明确加载/错误/部分结果。13项、类型、构建、边界及真实ROS目录只读浏览/文件打开通过；未写项目文件、未调用模型。当前44797终端Host PID379878；未提交推送。[本批证据](docs/refactor/reviews/evidence/ui-directory-inventory-2026-09-29/README.md)。

**2026-09-29 正常 UI 冷启动与双图纠偏：** 隔离新项目已从主对话目标、只读调查、候选审阅和明确采用，进入两个同 Session Work；唯一预期源码变更、三轮正式检查 PASS、GoalPhase COMPLETED。双图恢复稀疏节点/真实连线、下方独立滚动详情、按需展开及固定，未来节点保留。检查恢复不重开模型、不把已 finalized 非 PASS 当成无结果。按工作区保存显示选择及两标签页切换/刷新恢复已通过浏览器复验；取消/失败后新 Attempt 等缺口仍保留，不能宣告整个 MVP。产品模型 10 次，曾有 2 次沙箱工具失败；正常终端 Host 保留沙箱后检查通过，用户级服务已停止。 [本批证据与边界](docs/refactor/reviews/evidence/goal-cold-start-2026-09-29/README.md)。

**原型 UI 纠偏更新（2026-09-28）：已按原会话完成本批返修及实际浏览器核对。** 前批误将原型降格为风格参考，重组了项目导航、持续对话、辅助页和图交互；该交付口径已撤回。现恢复项目树、统一输入、项目共享辅助页、独立对话草稿、节点下方详情、双击固定/右键新页及 Task 图内连续纵向焦点。复用正式后端数据，未复制原型示例或新建业务机制；无时间 gate/未来节点仍在图上。四个前端文件及一处既有 UI 测试断言更新，类型、构建、2 文件 16 项检查通过。浏览器核对范围与限制见[纠偏记录](docs/refactor/reviews/evidence/ui-prototype-correction-2026-09-28/README.md)；本批未触发模型执行，不宣告整个 MVP 或任意规模 UI 验收完成。工作台仍为 http://127.0.0.1:44797/workbench/ ，用户级服务继续运行；未提交、未推送。

**此前 UI 后端接线验收（2026-09-28，保留原范围）：** 工作台使用真实 owner/Kernel 接口，已确认原型是界面与交互验收基线，示例数据不复制。FUGeXf 隔离 retry 工程沿原 Goal 与数据库，在 stage scope 修复后由界面点击“采用并执行”，最终正式 `complete_goal / COMPLETED`；Work、stage 与 Goal 三项 satisfied，三轮正式检查均 exit 0 / PASS，详见 [live-final](docs/refactor/reviews/evidence/mvp-ui-2026-09-28/live-final.json)。

最终验收轮 14 次模型调用（本批较早失败轮次另计，见证据），provider/transport 错误为 0；有 1 次模型猜错另一项目收件人的语义工具错误，后续已修正，不能写成零工具错误。普通读取、重开及继续 gate 未增加模型调用；此前失败保留。浏览器已核对文件保存与 CAS 冲突、命令隐藏保留/运行/取消、Git↔working tree 行级 diff、未保存选区进入真实请求并返回 marker、成员原 Session 咨询答复、双图节点/固定/新页、Task→Run→原历史，以及固定高度/调宽。[本批验收与失败记录](docs/refactor/reviews/evidence/mvp-ui-2026-09-28/README.md)。

边界：命令页无 PTY/stdin；架构初始化仍需人工审阅 JSON；Host 内存句柄不代表任意崩溃自动恢复；本次使用隔离 retry 工程，未修改三个候选真实仓库。无默认四 Agent 或 AG 专用生产流程。DSH 已停止，未提交或推送。临时工作台 [查看当前界面](http://127.0.0.1:44797/workbench/)（PID 2247899）保留运行供查看，启动本身不调用模型；这是临时地址，不承诺长期可用。

继续先读 HANDOFF 顶部与本批 UI 证据；不要把较早共同机制零错误记录套用本批，也不要自动重跑已完成的限定验收。

## 此前共同机制结果（历史范围）

**2026-09-28 当前落点：共同机制已导入并通过本轮统一验收。** 100 个候选文件精确导入，后续必要修正后共 102 个代码/测试/资源/生成物路径。 DSH 已停止，主审与子代理已完成候选修正、独立复核和导入；不再等待候选导入。实现复用原 owner、Runtime 与 Kernel，包括隔离 A′、真实 yield 后同 Task/Session 新 Run 接续、Work 控制、同 Goal 独立 Task 推进、显式机械通知及生命周期入口。没有默认启动四个 Agent，也没有按 AG 场景划分的专用生产流程。

**本轮限定验收通过。** 相关 15 文件/134 项检查中 3 项旧 AG2 fixture 迁移后通过，导入后 driver 与目录参数修正的必要复验、类型和构建通过。最终浏览器启动的 DeepSeek 链为 14 次请求、两次真实让出/回复/原 Session 新 Run 接续、实际改文件、Work 与 Goal gate 两次正式检查 PASS，Goal COMPLETED；网络、provider、工具错误均为 0。刷新和原历史展开未新增模型请求，临时 Host 已关闭；此前失败保留并记录根因。详见[统一验收记录](docs/refactor/reviews/evidence/orchestration-2026-09-28/README.md)。通用决定提交、原生 compact、Query 公开控制及整个 MVP 未宣告完成。

用户已认可[共同协作主图](docs/refactor/ORCHESTRATION-STATE-MACHINES.md#shared-mechanism-review)。本轮以整套机制为实现单位，不恢复按单场景先冻结成功链再补生产流程的安排。继续任务先读 HANDOFF 顶部；旧验收只证明其当时范围。

## 历史授权与批次记录（不覆盖上述当前状态）

2026-09-28 当前授权：按《MVP进展与下一步》完成可持续的通信状态机、UI与隔离工程E2E。AG2b采用原Work Run内等待回复、Host并行消费咨询、工具结果回原A继续；不冒充已经支持ended/paused/crash后自动恢复。两阶段DSH及限定验收已完成，105项相关检查与真实13次调用/两轮通信/工程检查/浏览器通过；证据见 docs/refactor/reviews/evidence/agent-behavior-2026-09-28/ag2b/README.md。当前未提交基线保留，后续按HANDOFF与行为计划继续，不自动扩大本批。

2026-09-28 当前授权：用户提供“Agent装配状态总结”分享，要求形成到达 MVP 的文档并完成下一步。路线、异步感知/控制与冷启动统一维护在 `docs/refactor/AGENT-BEHAVIOR-PLAN.md` §6–8；AG2a 已导入显式处理已有咨询、原收件 Session 的正式 Query Answer 关联回复；AG2a当时原发信 Agent 续接仍缺，后续AG2b范围以上条为准。仍走两阶段 DSH，不扩 Query 写工具、不造调度框架；历史停工记录不阻止本次明确授权。完成状态以 HANDOFF 的本批证据为准，不宣告全部 MVP 完成。

2026-09-28 最新授权：按用户六条职责批注实施提示词与显式 Agent 装配（AG6），保留秘书的用户交流/项目掌控、参谋的技术取舍/监工、书记的事实/历史设计/流程支持。统一工作台只有一个通用交互面，可按成员查看 Session，不增加三个职责入口；不默认启动四个 Agent。冷启动具体成员策略与生命周期“何时为何”的选择归编排，生命周期/Runtime 保留实际动作和事实。规模自适应、1–2万行/500K参考及原生压缩先记未来方向。本批状态见 HANDOFF；不得因此把 AG2–AG5 或完整 MVP 视为完成。

2026-09-27 最新授权：用户要求先明确 Agent 职责、行为和生命周期计划，再执行。当前顺序见 `docs/refactor/AGENT-BEHAVIOR-PLAN.md`；先接真实 Agent 消费者，再凭行为证据裁剪冗余。此前清理候选不再自动派发。新生产施工仍按第5条两阶段 DSH，首批关联 Session 发现与咨询请求已两阶段导入，6文件42项和真实DeepSeek场景通过；不等于委托执行或完整多 Agent 闭环。

2026-09-27 后续：用户已授权有界冗余清理，采用 DSH 探索→主审审核→DSH两阶段执行。首批同次角色解析复用已导入，相关41项/类型/边界/构建通过；详见 HANDOFF 顶部。本次不自动恢复其它MVP施工或推送，旧验收轮停止状态保留其当时范围。

2026-09-27：本仓库是原 next 的独立提取，根目录就是唯一默认施工工程。用户已从独立 main 恢复，已完成有界 completion audit；最新限定的真实模型非语义错误验收已通过，并按用户要求停止，其它 MVP 阻塞保留；最新落点见 `docs/refactor/HANDOFF.md`。`CONTINUE.md` 是下次明确恢复时的提示，不因历史任务书存在就自动派发。

## 通用仓库约束

1. 必要上下文：`README.md` → `docs/refactor/HANDOFF.md` → `docs/MVP-BEHAVIOR.md` → `docs/refactor/IMPLEMENTED-CAPABILITIES.md`；按需查 `docs/PRODUCT.md`、架构、模块与 UI 文档。
2. 原 W/coding-platform/next 相当于本根；原 W/docs 相当于本根/docs。历史 C/src、C/tests 不是本仓库 src/tests；不得把本仓库源码当旧目录删除。历史绝对路径、scope、harness 命令都要先重新映射。当前文件优先于被复制文档里的旧目录说明。
3. 先完成一次有界 MVP completion audit，只依据已确认用户行为、当前代码和已有证据。无真实 blocker 则收口；有则列出并仅处理 blocker，不新增需求、不补非阻塞测试、不做顺手重构，也不得自动将既定必需项移出 MVP。不把原语、受控模型 E2E 或某一子链等同完整产品验收。
4. 五模块职责与已确认产品边界继续有效。Task Graph 保留无验收条件的未来意图；Run结束不等于Task/Goal完成；事实与当前动作授权分开；没有运行中 Role 热切换生命周期，不恢复篡改数据库才能触发的防御校验/测试。原历史默认折叠并能按需查看实际保存记录。
5. 需要新生产代码时仍遵循 Astra 确定接口→DSH 4.1F 骨架/测试后STOP→Astra中审冻结→DSH实现→独审/必要验收。历史runner位于原工作区，快照在docs/refactor/archive/2026-09-27-workspace-tooling；先适配新根/scope再调用，禁止复用旧lane的原始基线去覆盖本仓库。凭据/DSH状态不在仓库里。
6. 独立构建和检查用根 package.json；两个npm锁文件一起维护。vendor/coding-agent/dist 是冻结运行依赖，必须保留；补丁更新沿 scripts/build-kernel-patch.mjs 与既有证据，不手改生成物。不要引回父目录源码或依赖回退。
7. 测试只运行改动所需范围；通过后不要反复扩大局部测试。更新已有 HANDOFF/能力/实施计划和相关证据，保留历史报告原义，不另建重复事实体系。
8. 提交只涵盖本次任务相关文件；保留用户改动。没有授权不要推送远端、发布、删除旧工程或访问候选测试工作区写入。
9. 2026-10-02 起，状态迁移必须经过 `src/core/work-graph/state/`（状态写入限制检查强制）。
