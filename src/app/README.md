# 应用与 UI 宿主

连接真实运行、项目状态、设置与浏览器展示。

## 源码入口

- [server.ts](server.ts)
- [service.ts](service.ts)
- [model-settings.ts](model-settings.ts)
- [file-references.ts](file-references.ts)
- [explorations.ts](explorations.ts)
- [verification-imports.ts](verification-imports.ts)
- [governance.ts](governance.ts)

## 边界与接线

初始协调入口由 `initial-planning.ts` 组合 PlanCompiler、Dispatch 与 Data 视图。探索前驱的选择/版本核对归 ContextCompiler，精确授权归 Dispatch，源码读取归 WorkspaceReader。探索审阅和 benchmark 的证据编排归 VerificationEngine。持久文件仅复用 `storage/atomic-file.ts` 的写入机制，运行/查询/验证各自保留生命周期与恢复语义。

真实运行由持久 RunSpec 及显式 RoleBinding 接线；样例执行绑定 `gui-fixture / fixture-only-v1`。QueryJob 以已登记 `execution` 描述选择真实 Adapter，旧无 execution 的查询仍是样例。Run/QueryRun ID 前缀不再决定执行 Adapter。旧无明确样例绑定的未启动 Run 不隐式升级为真实执行。

浏览器端有两个入口，由 `server.ts` 提供：

- `/`（默认）与 `/workbench`：React 工作台，源码在 `../../ui/`，构建产物在 `dist/app/public/workbench/`（生成目录，已 gitignore）。Vite 直接写入该目录（`src/ui/vite.config.ts`），`scripts/copy-ui.mjs` 只复制 `/legacy` 资源并清理旧工作台目录，所以单次 `pnpm build` 产出的就是服务读取的产物。
- `/legacy`：改版前的前端，源码在 `public/`，作为回退路径保留；待迁移视图完成一轮回退验证后再清理。

真实模式与样例模式必须区分：工作台把“执行开发任务”（真实内核）与“安装样例计划／查询（测试适配器）”分成不同控件与文案。布局保留摘要非 sticky、用量滚动且默认折叠、中栏最小 280 px 的修复。探索路径的前驱报告经授权从 Vault 读取并与 reportDigest 核对，不再使用应用层副本。

## 修改与验证入口

涉及职责或契约时读 [架构](../../../agent_learn/agent_dev/agent_platform/ARCHITECTURE.md)。 完成状态与实施顺序统一看 [module-status](../../../agent_learn/agent_dev/agent_platform/human/module-status.md)，本页不维护第二份状态表。

相关测试：[tests/app](../../tests/app)。构建与测试命令以 [package.json](../../package.json) 为准；WSL 前置与独立 runner 见 [产品 README](../../README.md)。测试结果须说明真实 Adapter、模型夹具或外部模型的边界。

## 前端工作台改版

设计与交互验收见 [前端产品需求](../../../agent_learn/agent_dev/agent_platform/dev_docs/product/frontend-workbench.md)；首期实施、UI-01～UI-12 结果与剩余缺口见 [首期实施与验收](../../../agent_learn/agent_dev/agent_platform/dev_docs/verification/2026-09-08-ui-workbench-acceptance.md)。

- 安装与构建：`pnpm ui:install` 一次；`pnpm build` 会构建内核、后端与工作台。单独执行 `pnpm ui:build` 只更新服务目录中的工作台资源。
- 构建/服务一致性：`pnpm verify:ui-build` 在干净输出目录和已有旧产物两种情况下真实构建并启动服务，核对页面引用的资源存在且字节一致，并确认 `/legacy` 仍可用。
- 类型检查：`pnpm ui:typecheck`；浏览器验收：`pnpm ui:test`（会先构建再启动独立服务，需要 Playwright 浏览器或 `CHROME_PATH`）。
- 工作台页面的 CSP 允许 `style-src 'unsafe-inline'`（Mantine 运行时注入样式）；`script-src` 仍为 `'self'`。

检查持久日志区分执行、报告落盘、结果登记和租约状态；check-evidence 精确登记原报告证据，reconcile-check 仅对账报告与租约，不重跑命令。这些恢复/登记入口及历史授权 UI 已通过有界浏览器验收（真实内核/SQLite，模型替身、检查点注入），独立进程故障验收仍待补齐。

治理入口 `/api/real/governance/view|install|activate`（`governance.ts`）把五个治理种类的安装与激活暴露给界面：install 永远 CAS@0（同一份 source 重放、不同内容返回 `revision_conflict` 且零写入、不覆盖），activate 用 CAS（调用方不给 `expectedRevision` 时用当前 Project revision），读侧回答“当前生效的是哪一份、谁在什么时候装的、内容是什么”。CoordinationPolicy 没有内置来源：自动化返工额度必须由人显式提交；没有生效策略时自动返工停在 `governance_unavailable`，平台不套用默认预算。第五个种类 RoleSpecRevision（RW-14）的**生效引用是逐角色的**（`ProjectRoleSpecActive` 按 roleId 一份），因此它的 `kindView.active` 恒为 null，逐角色事实在 `kindView.roleSpecs`；同一次 view 还给出 `roleMatrix`：当前生效的协调策略含不含角色矩阵、矩阵 pin 各自有没有可用的已激活规格（判据复用 ControlEngine 的 claim 角色守卫，见 `dev_docs/interfaces/module-boundaries.md`）。

历史材料 `/api/real/history/view|grant|read|revoke` 由本机会话认证的人类入口调用；当前目录只列持久检查报告，精确材料/目标 Run/原因和来源可见，旧请求复用，撤销不转移 owner。跨 Workspace 协议已支持人工精确授权；应用多 Workspace 注册与全部材料消费者仍待扩展。

计划变更的只读入口是 `/api/real/plan-changes/view`（`plan-changes.ts`）：它只转发既有的 `ReadModelIndex.planChangeView` 投影，一次取回提案／受理决定／Goal revision／任务处置行，供工作台「计划变更」视图回答「谁受理了什么、为什么」。受理方与变更原因都读 canonical 字段（`decision.actor`／`decision.authority`、`GoalRevisionRecorded.change.reason`），应用层与界面都不解析 id 形状；确无变更事实与投影尚未推进是两种不同的答案。

`/api/real/queries` 新增真实独立只读 QueryJob（模型按当前配置绑定），不领取 Coder 写租约；`/queries/runs` 返回公开输入、RoleBinding、工具事件与用量。旧 `/api/queries` 样例入口仍明确标为测试回答。源码/Goal/Workspace 改变时，查询展示保留历史标识。初始规划的 response contract/source origin 与 Control 守卫正在接线；默认开发入口尚未替换完成。
