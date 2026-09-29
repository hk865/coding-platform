# MVP UI 接线：工程验收证据（2026-09-28）

> 后续用户验收纠正：本批未还原已确认原型的信息架构与交互，不能作为“原型 UI 已交付”的证据。以下实际消费者、模型执行与已操作项目仍按原范围保留；设计一致性正在[原型纠偏批](../ui-prototype-correction-2026-09-28/README.md)重新核验。

本目录记录已导入主工作树的 MVP UI 接线工程验证。**本批限定浏览器与真实模型链已通过：沿原 Goal/数据库续接后，正式 `complete_goal`，三个 Task 均 satisfied。此结论不宣告整个 MVP 完成。**

## 工程范围与导入

范围见 [施工任务](../../../tasks/MVP-ui-connection-2026-09-28.md) 与 [精确 scope](../../../tasks/MVP-ui-connection-scope.json)。Host 文件保存/命令执行直接适配 Kernel；执行记录分页、Project 读取复用正式 owner。UI 的四个文件经独立范围审查后导入，[导入记录](ui-import.json)记载 `outsideScope: []`、`originalWorkspaceChanged: []` 及各文件哈希。后续必要 UI 修改须以主审最终记录为准。

第一阶段保留真实 unsupported 红灯及审查记录：[阶段审查](stage1-review.md)、[预期失败](stage1-expected-red.log)。这些没有被第二阶段成功结果覆盖。

## 后端与构建验证

使用本仓库 Node 24.21.0 及现有 npm 锁定依赖。主审在导入并完成独立返修后执行：

| 检查 | 实际结果 | 证据 |
| --- | --- | --- |
| 三项新接缝测试与现有 R6 Host / workbench 回归 | 5 个文件、33 项通过，10.12 s | [backend-tests.log](backend-tests.log) |
| 主程序及 UI TypeScript | `npm run typecheck` 通过 | [typecheck.log](typecheck.log) |
| Kernel 受管源码与生成物一致性 | `build-kernel-patch.mjs --check` 通过 | [kernel-check.json](kernel-check.json) |
| 生产构建 | `npm run build` 通过，生成 `dist/app/public/workbench` | [build.log](build.log) |

测试覆盖文件保存的授权默认拒绝、旧 revision 冲突不覆盖、实际保存 revision、空文件合法保存；命令真实输出、重放/冲突及停止后的实际取消；正式执行分页和已有 Host 消费接线。此处不将这些测试扩写为尚未完成的浏览器交互证据。

## Stage gate 修复后的工程复验

合法 stage gate 曾被 Workflow 按 Goal gate 处理；已导入 [5 文件最小修复](gate-import.json)。相关 [4 文件 / 20 项检查](gate-final-tests.log)已完成，但承载测试及后续检查的合并执行 `70780` 随后以 143 中断，因此该命令不证明类型与构建成功。旧日志保留为 `pre-gate-typecheck.log` / `pre-gate-build.log`，不作为最新源码的构建证据。

主审随后**独立重跑**类型（exec `67850`）与构建（exec `31034`），均确认 exit 0；并核对 dist 已包含新的 `gateTask.scope.kind` 判断。[最新元数据](latest-checks.json)、[类型日志](final-typecheck.log)、[构建日志](final-build.log)。另有 UI 必要复验 [2 文件 / 16 项通过](ui-tests.log)。这些是不同轮次的有界检查，不将 33、20、16 相加宣称独立覆盖数量。

重建后以新 Host PID `2247899` 继续使用 `run-FUGeXf` 原数据库，UI 的继续操作已从旧拒绝进入 running。随后同库续接已正式完成 Goal；第一次重启实际上未加载新 build，第二次重建后重启才加载修复。该差异按[轮次记录](live-attempts.json)保留，不把第一次重启记成有效修复。类型/构建的独立 exit0 和 dist 检查以主审工具结果及 latest-checks 元数据为准，不单凭临时日志存在推断新鲜度。

## 独立返修与实际并发确认

后端候选曾用一次 macrotask defer 绕过立即停止的测试时序。独立复核移除该变通，修复 Kernel 真正的 abort 监听窗口：准备阶段 await 后、spawn 前重新检查；监听安装后补查已发生的 abort。已经启动的进程仍通过真实 child close 形成终态，没有伪造 cancelled。

Host 命令启动在 sandbox 获取后的同步区重新检查关闭、取消及同 requestId，避免两个并发 start 各起进程；close 共用排空 Promise。文件保存回执移除未实际读取的 mode 猜值。

独立临时 probe 在真实 Kernel ProcessSandbox 中以 `Promise.all` 同时发送相同 scope/requestId：两调用返回相同 `workbench-command-1`，实际命令向文件追加的内容仅一行，退出码 0，两个 close 均完成排空。无 mock executor；临时工作区随后清除。[结构化结果](command-concurrency.json)。

## 代码规模口径

[code-size.json](code-size.json)按本批 scope 对原始基线逐物理行比较，UI 与后端均取已导入的当前主工作树，并分别注明基线和哈希；stage gate 五文件使用其单独修复前态，后续实际微调须刷新。

Kernel 两份恢复源码原有 **932 + 441 = 1,373 行**，属于恢复已有实现，不能当作新增平台业务。实际修补为 **新增 14 行、删除 1 行，净增 13 行**（空文件替换与进程取消窗口）。测试、构建脚本、生成物独立统计；缺少原始备份的既有生成物不冒算为整文件新增。

## 最终浏览器与真实模型限定验收

主审已实际观察以下结果，结构化终验以 [live-final.json](live-final.json) 为准。最终验收轮 `run-FUGeXf` 为 **14 次 provider 调用、1 次语义工具错误、0 provider 错误、0 transport 错误**；本批含先前失败轮次累计 **32 次**，不能把 14 次称为本批总调用数。不是“零工具错误”或所有轮次一次成功；[live-attempts.json](live-attempts.json)保留前序失败，尤其 `run-0MsWZx` 的 `provider_request_failed` 根因未知。

- 从空业务数据库经 UI 显式创建 Goal，completion policy 显式安装/激活；模型首次规划 JSON 不合约后在同 Session 纠正，候选停留等待用户采用。架构 JSON 经人工审阅后正式采用，未伪称模型自动采用。
- Work 仅修改 `src/retry.mjs`，原检查文件没有改；实际检查通过。README 的 probe 是人工 UI 保存操作，不归为模型产出。合法 stage gate 问题经修复后，在原 Goal/DB 续接，正式 Goal 完成、3 Tasks satisfied、三个检查轮次 exit0/PASS，scope 明确区分 stage 与 goal，gate 没有另起模型 Run。
- 文件 CAS 保存成功，旧 revision 保存冲突保留；未保存 `DRAFT_REF` 选区进入真实只读 Query 并被识别；成员原 Session 收到回复。
- 命令页显示实际输出，隐藏不停止；显式 stop 得到真实 SIGTERM。命令页没有交互 stdin/PTY。
- Git 与 working tree 对比得到两个文件的行级 diff；架构包含树与 dependency 视图区分，节点固定与新 tab 可用。
- Task → Run → 原 Session 历史读出 position 40–49 共 10 条，无重复渲染；主动展开实际原始记录。整体高度 720 px，拖动与内部内容未撑高页面。

最终浏览器 reload 已恢复同一 Goal，继续 gate 期间模型调用增量为 0。限定 scope 的 diff --check 为 exit0；临时原型服务及临时页已关闭，最终交付页保留。

最终工作台按主审安排保留在 `http://127.0.0.1:44797/workbench/`。这是本机存活 Host，不是已发布服务；当前没有关闭时间不表示验收尚未完成。

## 私有配置复现

[启动脚本](live/start.mjs)和[原数据库续接脚本](live/resume.mjs)不含凭据。必须设置 `MVP_UI_API_KEY_FILE` 指向本机私有凭据文件；缺失即拒绝启动。`MVP_UI_REPO` 默认为运行命令时的仓库目录，`MVP_UI_OUTPUT_DIR` 可指定临时输出目录；续接另须 `MVP_UI_RUN_DIR` 指向已有运行目录（含原 config、数据库及 evidence），`MVP_UI_PORT` 可覆盖默认端口。

脚本仅供显式重现；本次证据整理没有执行脚本、调用模型或写数据库。start 创建隔离 fixture，resume 不重建业务数据、没有自动 HTTP POST 或模型调用；浏览器显式动作才继续业务。脚本运行时保留的详细请求证据属于本机临时目录，本仓库工作树只保存去凭据的脚本与精简结果，尚未提交或推送。
