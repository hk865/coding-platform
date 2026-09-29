# 目标创建与主对话启动（2026-09-29）

状态：**本批限定验收通过**。首次目标对话、缺模型提示、原 Query 准备恢复及真实只读调查已验证；不表示完整 MVP 完成。以下失败保留为历史轮次，不作为当前运行状态。

## 用户可达的三个问题

1. 首次发送只调用 Goal 创建，成功后未接 Query/Session 执行。界面显示目标已创建，但没有模型对话。
2. 新目录尚未选择模型，Host 已在 bootstrap 发布 local-workbench 可执行 profile；实际 runtime 没有该 scope 的模型 binding，UI 因此误判可运行。
3. Query 已 claim、尚未 prepare 时失败，会占用原 Session；UI 缺少沿原 QueryRun 恢复的入口，重新发送不能替代原执行的恢复。

普通 Query 不以完成策略或初始架构为前提；初始计划采用的正式治理要求仍是另一边界，本批不绕过它。

## 已完成的 Host 修复

独立 dirty-tree lane：`host-profile-availability-20260929`。DSH Session：`session-7726a6ac-4920-4dda-a37b-9fe25bb0bc9e`。

- Stage1：`attempt-1790620942665430434`，随后 `attempt-1790621213301425716` 将测试原位保存；均 STOP、exit 0。保留现有两个测试案例，只补真实 open 响应与 GET bootstrap 的 profile 可用性断言。主审在候选中实际验证 2 项失败、8 项通过，失败准确指向无模型 scope 提前发布 profile。
- 主审冻结后 Stage2：`attempt-1790621365715961613`，STOP、exit 0。`addWorkspaceState` 不再提前发布 profile；成功安装 runtime 配置后，bootstrap 精确同步其 `queryProfiles`，协作 driver 只追加新 profile。保留启动时全部角色/profile、既有运行 handle 与执行配置快照；不修改权限、owner 或 DTO。
- Stage2 报告 Node 类型、UI 类型与设置测试 10/10 通过。测试通过记录来自 DSH 同内容临时覆盖层，并核对源文件哈希；导入后根仓库设置测试 10 项通过。
- 最终 scope audit 仅 `src/app/host.ts`、`tests/app/host-settings.test.ts`，无越界或允许路径基线冲突。两文件已由主审导入根仓库。

## UI 接线与受控浏览器验收

根仓库集成 4 文件 29 项检查通过，类型、构建与边界检查通过。UI 使用已有 Goal/Query/Session owner：首次发送冻结 scope、问题、引用及原收件意图；缺 profile 在创建 Session 前停止；显式“继续准备调查”仅沿已确认 claimed/prepared 的原 QueryRun 继续。

隔离受控 Host `32777` 的实际浏览器结果：

- 经设置创建 `fixture-project` 并选择模型；首次发送创建 Goal 后直接得到正式 Answer，provider 累计 1 次。
- `fixture-no-model` 首次发送只创建 Goal，没有 Session 或模型调用；设置模型后调用仍为 1 次。显式开始已有 Goal 后获得 Answer，累计 2 次。
- 经正式 HTTP 构造一条 claimed 前态后，浏览器点击“继续准备调查”，沿原 QueryRun prepare/start 并得到 Answer，累计 3 次。最终为 2 Goal、3 Session、3 Job、3 Run，全部 answered；其中 1 Session 是验收构造前态，不能称全部由 UI 首次创建。

主审随后补原草稿条件清理、Session 详情与成员目录刷新，以及刷新时根据正式终态显示无 Answer 的原因。最新 bundle 浏览器首次发送 `fixture-final-ui` 后，导航立即出现待命成员、标题为待命、输入框为空且正式 Answer 可见。受控最终累计 4 calls、3 Goal、4 Session、4 Job、4 Run，其中 1 Session 为 HTTP 构造的 claimed 前态。设置保存不自动调用模型。

## 历史轮次：原 Query 恢复未成功

主审在配置模型后，使用临时官方 HTTP 恢复脚本沿原 QueryRun 执行 `prepare → start → observe`，没有重新 submit、claim 或创建 Session。对象为 Goal `goal-mullar1o-1`、QueryRun `qrun-flow-mullfole-3`，保留原工作区与 Session。脚本 exit 0 但 `answerReady=false`，不能据退出码宣称恢复成功。

这次实际产生 **4 次 DeepSeek 模型请求**，均有已保存的 usage 与 assistant 完成事件；成功读取目录、README 与 docs。有一次模型以 `read '.'` 读取目录，收到 `permission_denied` 后改用后续读取。该结果仅描述本次工具参数错误，不表示所有权限拒绝均可忽略。没有写入用户工程。

最终 Kernel 在 position 32 保存 `run.limit_exceeded`：`limit=tool_calls`、`allowed=8`、`observed=9`。最新 checkpoint 为 `limit_exceeded`、无活跃模型请求，toolBatch 中有 **4 个未开始执行、已 abandoned 的调用**。这不是 provider 请求失败，也不是模型仍在执行。

随后独立调用一次正式 `queries/observe`，结果仍为 `ready / entered / answer=null`；原 Session 仍被占用。只读定位发现 Query observer 的 `turnIsComplete` 仅接受 completed/failed/cancelled，后续又拒绝 abandoned，无法将这次已终止且未产生工具副作用的事实结算。此例 `Session.historyCursor=null`，completedBoundary 从 0 开始，已排除“越过自己的 turn.started”作为本次原因。

## 历史轮次：终止结算与累计预算阻断

原 cap=8 Query 已经由正式 `queries/observe` 结算为 closed/timeout，原 Session 占用已释放；不再沿用上面的历史 entered 状态描述当前状态。诊断证据为 `/tmp/goal-start-repair-20260929/original-observed.json`。

随后一轮真实调查未成功：Kernel 记录 3 次模型开始，实际到达 provider 2 次，5 次工具调用全部成功；固定 Query 累计输入预算 200000 在第三次模型调用前阻断。因此不能宣称本次真实调查或模型链路已验收通过。证据为 `/tmp/goal-start-repair-20260929/real-final.json`。此失败保留为历史证据；后续修复与成功结果见下节。

## 最终真实调查与限定交付

预算 nullable 候选 18 文件已导入：Query 的 null 累计预算表示不限，deadline 完整传入 Kernel；Work 预算不变；已存在的 terminal 事实先于当前 profile 比较。当前真实 scope 显式设置 1,000,000 context tokens，依据 [DeepSeek 官方模型说明](https://api-docs.deepseek.com/quick_start/pricing/)；其他模型默认仍为 128K，这不是自动容量发现。

[最终安全证据](final-real-query.json) 显示：通过正常 Session 发送进入 consultation，复用原 Goal 与原 Session，新调查 2 次 provider 调用、4 次工具全部成功、0 次模型或工具失败，正式状态 answered/settled，Answer 存在，Session occupancy 为空。此结果不是把旧 timeout Query 改写成成功。旧失败与结算分别保留在 [real-final.json](real-final.json) 和 [original-observed.json](original-observed.json)。

主审实际浏览器继续加载历史从 50 到 72 条，确认中文 scan-planner 调查结论的 Markdown 标题、段落、列表和代码正常显示，原始记录入口保留，Session 待命且输入框为空。仍使用分页，不宣称逐 token 流式。

当前正常工作台 `http://127.0.0.1:44797/workbench/`、PID 243350 保持运行。受控 UI、DSH 施工与真实模型调用分别计数；未提交、未推送，未写入用户项目。本批限定验收通过，不宣告用户目标或整个 MVP 完成。
