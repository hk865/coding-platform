# 下次明确恢复时使用的 prompt

**原型 UI 纠偏更新（2026-09-28）：已按原会话完成本批返修及实际浏览器核对。** 前批误将原型降格为风格参考，重组了项目导航、持续对话、辅助页和图交互；该交付口径已撤回。现恢复项目树、统一输入、项目共享辅助页、独立对话草稿、节点下方详情、双击固定/右键新页及 Task 图内连续纵向焦点。复用正式后端数据，未复制原型示例或新建业务机制；无时间 gate/未来节点仍在图上。四个前端文件及一处既有 UI 测试断言更新，类型、构建、2 文件 16 项检查通过。浏览器核对范围与限制见[纠偏记录](docs/refactor/reviews/evidence/ui-prototype-correction-2026-09-28/README.md)；本批未触发模型执行，不宣告整个 MVP 或任意规模 UI 验收完成。工作台仍为 http://127.0.0.1:44797/workbench/ ，用户级服务继续运行；未提交、未推送。

请接手 `/home/hyh001/projects/coding-platform/coding-platform-next` 当前工作树，保留未提交改动。先读 `AGENTS.md`、`docs/refactor/HANDOFF.md` 顶部及 [MVP UI 验收证据](docs/refactor/reviews/evidence/mvp-ui-2026-09-28/README.md)，按需核对实现和既定 MVP 缺口，不全量重读历史、不重新启动 completion audit。

**此前 UI 后端接线验收（2026-09-28，保留原范围）：** 工作台使用真实 owner/Kernel 接口，已确认原型是界面与交互验收基线，示例数据不复制。FUGeXf 隔离 retry 工程沿原 Goal 与数据库，在 stage scope 修复后由界面点击“采用并执行”，最终正式 `complete_goal / COMPLETED`；Work、stage 与 Goal 三项 satisfied，三轮正式检查均 exit 0 / PASS，详见 [live-final](docs/refactor/reviews/evidence/mvp-ui-2026-09-28/live-final.json)。

最终验收轮 14 次模型调用（本批较早失败轮次另计，见证据），provider/transport 错误为 0；有 1 次模型猜错另一项目收件人的语义工具错误，后续已修正，不能写成零工具错误。普通读取、重开及继续 gate 未增加模型调用；此前失败保留。浏览器已核对文件保存与 CAS 冲突、命令隐藏保留/运行/取消、Git↔working tree 行级 diff、未保存选区进入真实请求并返回 marker、成员原 Session 咨询答复、双图节点/固定/新页、Task→Run→原历史，以及固定高度/调宽。[本批验收与失败记录](docs/refactor/reviews/evidence/mvp-ui-2026-09-28/README.md)。

边界：命令页无 PTY/stdin；架构初始化仍需人工审阅 JSON；Host 内存句柄不代表任意崩溃自动恢复；本次使用隔离 retry 工程，未修改三个候选真实仓库。无默认四 Agent 或 AG 专用生产流程。DSH 已停止，未提交或推送。临时工作台 [查看当前界面](http://127.0.0.1:44797/workbench/)（PID 2247899）保留运行供查看，启动本身不调用模型；这是临时地址，不承诺长期可用。

正式消费者与隔离工程链验收保留；当前继续用户已授权的原型 UI 纠偏，先读上述任务及原型对照结论，不把前批后端链路成功当作界面已完成。通用决定提交、原生 compact、Query 公开控制等未因本次结果自动完成。没有新目标时说明剩余明确缺口，不自行扩展施工。

本地 main；源码远程 `hk865/coding-platform:next-main`，文档远程 `hk865/my-coding-platform-docs:next-main` 的 docs/。未经要求不提交/推送、不改旧 main、不修改三个候选工作区。使用本仓库 Node 24 与 npm 锁文件；凭据只从私有配置读取，不输出或提交。

<details>
<summary>此前共同机制继续提示（历史范围）</summary>

# 下次明确恢复时使用的 prompt

请接手 `/home/hyh001/projects/coding-platform/coding-platform-next` 的当前工作树，保留未提交改动。先读 `AGENTS.md`、`docs/refactor/HANDOFF.md` 顶部和共同机制[统一验收记录](docs/refactor/reviews/evidence/orchestration-2026-09-28/README.md)，按需读状态机 §0；不要全量重读历史或重新启动 completion audit。

**2026-09-28 当前落点：共同机制已导入并通过本轮统一验收。** 100 个候选文件精确导入，后续必要修正后共 102 个代码/测试/资源/生成物路径。 DSH 已停止，主审与子代理已完成候选修正、独立复核和导入；不再等待候选导入。实现复用原 owner、Runtime 与 Kernel，包括隔离 A′、真实 yield 后同 Task/Session 新 Run 接续、Work 控制、同 Goal 独立 Task 推进、显式机械通知及生命周期入口。没有默认启动四个 Agent，也没有按 AG 场景划分的专用生产流程。

**本轮限定验收通过。** 相关 15 文件/134 项检查中 3 项旧 AG2 fixture 迁移后通过，导入后 driver 与目录参数修正的必要复验、类型和构建通过。最终浏览器启动的 DeepSeek 链为 14 次请求、两次真实让出/回复/原 Session 新 Run 接续、实际改文件、Work 与 Goal gate 两次正式检查 PASS，Goal COMPLETED；网络、provider、工具错误均为 0。刷新和原历史展开未新增模型请求，临时 Host 已关闭；此前失败保留并记录根因。详见[统一验收记录](docs/refactor/reviews/evidence/orchestration-2026-09-28/README.md)。通用决定提交、原生 compact、Query 公开控制及整个 MVP 未宣告完成。

本轮 live/UI 已收口；后续按用户目标与现有明确 MVP 缺口推进，不重复当前验收或恢复场景专用施工。共同主图已经认可，不重复请求审批，不恢复 AG 专用生产流程或重新启动已停止的 DSH。角色按需装配，不默认四 Agent。Host 内存句柄不代表崩溃后自动恢复，持久关联可供显式续接。

本地分支 main；源码远程为 `hk865/coding-platform:next-main`，文档为 `hk865/my-coding-platform-docs:next-main` 的 docs/。未经新要求不提交/推送，不改旧 main，不写三个候选真实工作区。使用仓库 Node 24 和 npm 锁文件；凭据只从私有配置读取，不输出或提交。


</details>

<details>
<summary>历史继续提示（仅保留当时范围，不作为当前施工状态）</summary>

# 下次明确恢复时使用的 prompt

2026-09-28 最新：用户要求以完整共同状态机为实现单位，撤回按最小场景链逐批补能力的安排。当前[统一实现任务](docs/refactor/tasks/ORCHESTRATION-common-mechanism-2026-09-28.md)及精确scope从dirty tree准备独立DSH候选，尚未导入/验收。先读HANDOFF顶部确认实际执行落点，不再恢复单场景测试先行的计划；下面较早“两阶段/最小批次”措辞不覆盖此纠偏。原主图仍已认可。

2026-09-28 当前补充：保留当前未提交的 AG1、AG6、AG2a、AG2b 和文档基线，不回退到冻结提交。先读 `HANDOFF.md` 顶部、`AGENT-BEHAVIOR-PLAN.md` §8及 `reviews/evidence/agent-behavior-2026-09-28/ag2b/README.md`。AG2b 已接通存活 Host 内 A原Run→发现/咨询B→B原Session回答→A工具结果→重复咨询/继续编辑→正式检查与完成；相关105项、类型/边界/构建通过，真实13次模型请求、两轮回复、两个正式检查轮次PASS和浏览器启动/刷新/查看已验。此前网络/启动失败保留，不以成功轮次保证普遍语义可靠。

用户已认可 `docs/refactor/ORCHESTRATION-STATE-MACHINES.md` §0 的单张协作通信主图，无须重复请其审批。最新补充在§0.5–0.7：角色工作触发、参谋全局概览与定向调查、决定/双图/落实关联，以及共同Agent状态与转换表，均标明当前实现边界。只读问询从A上下文派生A′而A继续工作；承诺/中断/换方向进入原A；需要回复与立即等待分开；冲突须定位有权负责者并确认实际落实。AG2a原idle Session咨询不是A′，AG2b等待仍占原Run/Session，不能冒称已让出休眠。当前只完善文档；接下来沿原owner/Runtime/Kernel对账并冻结真实缺口的最小接口，再两阶段DSH施工。AG1–AG5是验收场景，不是五套生产流程；不继续打磨AG2b局部测试或扩大为全面重构。原Run ended/pause/崩溃恢复、返工/Reviewer、并行、治理和完整UI等既定必需项仍保留。新施工从当前工作树取基线；未经要求不提交/推送，不写三个候选工作区。下文较早停工记录仅保留其当时范围。

请接手独立仓库 `/home/hyh001/projects/coding-platform/coding-platform-next`，从当前提交继续。本地分支为 `main`，源码远程发布分支为 `hk865/coding-platform:next-main`；文档同步到 `hk865/my-coding-platform-docs:next-main` 的 `docs/`。不要误用两个远程的旧 main。

先读根 `AGENTS.md`、`README.md`、`docs/refactor/HANDOFF.md`、`docs/MVP-BEHAVIOR.md`、`docs/refactor/IMPLEMENTED-CAPABILITIES.md`；按需查 `docs/refactor/reviews/completion-audit-2026-09-27.md` 和 `docs/refactor/skeleton/END-TO-END.md`。有界 completion audit 已完成，不再全量重读历史或重新启动审计。

上轮用户明确要求“接入真实模型后消除非语义错误，验收后停止”，已按该范围完成并停工，**不是整个 MVP 完成**。真实 DeepSeek 验收见 `docs/refactor/reviews/evidence/standalone-2026-09-27/e01-live-deepseek/`：12 次真实模型调用，两个 Work 同 Session 真实改文件，3 次实际检查 PASS，正式 Goal COMPLETED，模型/工具错误为 0；历史读取不新增模型调用。只修初始规划输出 guide 的完整协议，未放宽 parser 或权限检查。初始失败和临时读取配置拒绝也保留，不能只看成功记录。完整示例 UI 仍是已确认设计目标，当前生产工作台不是其全部实现。

这次恢复请按我新给的具体目标推进；若没有给下一目标，先指出已有审计中最小真实阻塞供选择，不自动展开所有模块。不得新增需求、非阻塞测试或顺手重构，不因为有任务书就判阻塞，也不得把既定必需项自动移出 MVP。无验收条件的未来 Task 继续保留；不恢复不存在的 Role 热切换防御。

Work-control 新根 Stage1 已中审、仅存独立 lane，未导入、未 Stage2；若选它，先核当前基线与精确差异，不能盲导旧 lane。A1 旧 lane 未启动，R3g 草稿不等于完成。恢复/返工/并行/Reviewer/协调治理/完整 UI 与旧消费者切换依已有范围和审计判断。

生产变更保持两阶段 DSH：先接口及 Stage1 骨架/测试后 STOP，中审冻结，再实现和必要验收。已适配 runner 在 `tools/dsh-refactor/`；用本仓库 Node 24、npm 锁文件及依赖。相关检查通过就推进，不扩局部测试循环。凭据从本机私有配置读取，不输出或提交；临时数据库不提交。源码原 next 即本根，文档原 W/docs 即本根/docs，历史路径先映射。不要删除旧工程或修改三个候选真实测试工作区；推送沿用户明确指定目标，不强推或改旧 main。

</details>
