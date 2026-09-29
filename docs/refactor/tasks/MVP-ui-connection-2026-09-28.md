# MVP 原型接线（2026-09-28）

用户要求接通已确认的 MVP 工作台，而不是把调试工作台称作最终 UI。本批直接复用共同协作机制及正式 owner；AG 场景仍是验收用例，不成为产品路由。现有未提交改动全部是本批基线的一部分。

## 界面与消费者

视觉/交互基线为 `/home/hyh001/.codex/visualizations/2026/09/26/01a0dc16-38ca-7a71-ba7d-fc23e0d3cbed/agent-workbench.html`（主审已浏览器操作）：安静的项目/成员导航、传统对话、底部输入框、按需打开的多页签辅助区。固定视口、内部滚动、可调宽、归档只读、原历史按需展开保持。示例数据不能进入生产；高级注册/计划表单收进设置，不常驻卡片墙。

- 主对话发送：首次正常输入经既有注册/Goal/Session/Query 链，后续沿真实关联复用 Session。用户不手填内部标识；没有可信模型配置则保留草稿并明确缺口。普通对话与显式调查规划/采用/执行分开，不能把答复自动采用为计划。新建目标由明确 UI 操作表达。
- 成员对话：读取原成员及匹配角色的只读 Query profile，`action_request + needsReply` 保存后沿 `consumeConsultation` 处理；忙碌来信沿原输入边界。保存、交付、回答、行动落实分别显示。默认普通成员对话不能误用隔离 inquiry。
- 文件/选区引用进入实际请求，带路径、行号、版本与草稿快照标记；加入不自动发送。请求提交冻结后，导航和后来输入不能污染请求或清空后来草稿。
- 文件编辑经 Kernel WorkspaceSandbox CAS 保存，失败保留草稿；旧版本只读。文件树、编辑页、diff 页分开。权限来自 Host 显式配置，不借用 Agent 权限。
- 终端是 Kernel ProcessSandbox 的真实命令执行页（明确无交互 stdin），独立句柄保留输出与停止状态，隐藏/切页不停止。没有 PTY 就不伪造 PTY；没有沙箱就明确不可用，不退回宿主 shell。
- Task 结构/轨迹使用真实 Run 起止时间及并行区间；连续纵向放大镜是显示变换。未来无时间任务独立呈现。架构包含树按正式 containment 与活跃成员路径并集展开，保留兄弟/用户分支；依赖 DAG 独立视图。节点详情、固定、原 Session/Run/历史入口保持。

## 最小接口与所有权

1. `ExecutionReadPort.listExecutions(ctx,{goalRef,taskId?,page:{afterCursor,limit}})`：限 1–100，返回既有 TaskExecutionRecord 分页及读水位。复用 `r3c-run-by-goal` / `r4c-run-by-task` 索引及 canonical reader；游标绑定 scope/query，不建历史 store、不全图扫描。不得泄漏其它 workspace，也不把损坏当空列表。
2. Host `workbench-tools.ts` 仅适配 Kernel：文件保存及命令 start/read/stop/close。`writePrefixes?: string[]`、`allowCommands?: boolean` 默认无写/执行权限，冻结配置。文件写同时满足可读与可写范围；终端是显式整个工作区命令授权，复用 Kernel 保护路径，不从 readPrefixes 推断。HTTP 沿现有 token/scope 路由。
3. 文件写传旧 digest/revision 与新正文，在 Kernel 内校验；新建 exclusive。空文件的合法替换仅在原 Kernel replace 内作最小修正，受管 TS 来自原 source map，生成物只能由 build-kernel-patch 产生。
4. diff 直接转发已有 `WorkspaceToolsPort.compareWorkspace`。首次注册若缺少单独 Project 读，向原 bootstrap owner 增加窄只读方法，读取真实 revision；不猜 revision 1、不根据错误文案区分缺失。
5. 新 HTTP 端口在 bindings/spec/dispatcher/types 显式列出；缺少可选依赖返回 unsupported。不增加动态 method dispatcher、聊天数据库、任务调度器或统一校验层。

## 实施和验收

精确写范围见同目录 `MVP-ui-connection-scope.json`。DSH 第一阶段只交接口、骨架和必要接缝测试并停止；主审冻结后第二阶段实现整套消费者。UI 外观等可逆变化不写镜像测试。新测试只覆盖真实风险：CAS/权限/空文件、实际命令运行取消、分页范围、正常冷启动及原成员/引用接线。已有测试只作接口迁移，不弱化断言。

主审独立复核代码/差异，相关检查通过后进行原型对照浏览器验收及隔离临时项目真实模型链。从正式用户入口注册/建立目标，不用预制 Goal/Session 冒充冷启动。不得修改三个候选真实项目、打印凭据、推送或发布。最终在已有 UI/HANDOFF/能力文档记真实结果，不宣称整个 MVP 已完成。


## 本批终验中发现的 stage gate 最小修复

真实 UI 链产生合法 stage gate 后，Workflow 曾把它当 Goal gate，导致已通过检查的工程不能推进。沿同一已确认范围进行两阶段 DSH 修复：先冻结既有 gate scope 的接口/必要反例，再实现并独立审查；导入仅涉及 Workflow、verification context、Evidence 契约/服务及原 R5c 测试，共五文件，不新增 gate owner 或另一套调度器。精确文件与哈希见 [gate-import](../reviews/evidence/mvp-ui-2026-09-28/gate-import.json)。

相关 4 文件/20 项测试通过；承载其后的合并命令退出143，不能据旧日志认定构建完成。主审随后单独执行类型与构建均 exit0，检查新 dist，再在原 Goal/数据库重启续接，最终正式 complete_goal、三个 Task satisfied。第一次修复意图重启实际仍是旧 build，第二次才加载新产物，保留两次重启事实。本批浏览器/模型限定结果及先前失败见 [本批证据](../reviews/evidence/mvp-ui-2026-09-28/README.md)，不宣告所有 MVP 能力完成。
