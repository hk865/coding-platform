# 前端工作台（React）

产品工作台前端。构建产物直接写入服务实际读取的 `dist/app/public/workbench/`（生成目录，已 gitignore），由 [`src/app/server.ts`](../app/server.ts) 在 `/` 与 `/workbench` 提供；改版前的界面保留在 `/legacy`。构建路径由 `vite.config.ts` 的 `outDir` 决定，`scripts/copy-ui.mjs` 只负责 `/legacy` 资源，不再复制工作台，因此不会出现“构建一次、服务上一版”的滞后。

## 入口与命令

```bash
pnpm ui:install     # 首次安装本目录依赖（独立 workspace，不动仓库根 node_modules）
pnpm ui:build       # Vite 生产构建，直接写入 dist/app/public/workbench/
pnpm ui:typecheck   # tsc --noEmit
pnpm ui:test        # 先 pnpm build，再启动独立服务跑 Playwright 浏览器验收（需 CHROME_PATH 或已安装浏览器）
```

仓库根的 `pnpm build` 会在后端构建后执行 `ui:build`，单次构建即为服务产物；单独执行 `pnpm ui:build` 同样更新服务目录。`pnpm verify:ui-build` 核对构建产物与 HTTP 服务的字节一致。本目录有自己的 `pnpm-workspace.yaml`，避免与仓库根的 Windows 安装互相覆盖。

## 结构

| 目录 | 内容 |
| --- | --- |
| `src/api/` | HTTP 客户端（错误分类、取消、超时）、响应类型、TanStack Query hooks、幂等标识 |
| `src/state/` | 展示层状态：作用域、布局与标签（版本化 scoped key）、草稿与文件引用 |
| `src/workbench/` | 视图注册表与外壳（标签栏、面板、底部工具区、分隔条） |
| `src/features/` | 各视图实现；视图之间只通过 store 与注册表通信，不互相操作 DOM |
| `src/components/` | 统一状态呈现（loading／empty／error／stale／unavailable）、分隔条 |
| `tests/` | `*.spec.ts` 浏览器验收、`unit/` 纯逻辑测试、夹具与真实模型宿主脚本 |

## 约定

- 业务状态只来自服务器；本目录只保存选中、展开、草稿、布局、终端会话等展示状态。
- 未接通能力显示 `UnavailableState`（原因＋缺失依赖），不用固定内容填充。
- 工作台页面 CSP 允许 `style-src 'unsafe-inline'`（Mantine 运行时注入样式）；`script-src` 仍为 `'self'`。
- 验收矩阵与证据见 [前端产品需求](../../../agent_learn/agent_dev/agent_platform/dev_docs/product/frontend-workbench.md) 与 [首期实施与验收](../../../agent_learn/agent_dev/agent_platform/dev_docs/verification/2026-09-08-ui-workbench-acceptance.md)。


## 交付缺陷修复

未决请求结果未知时，修改内容会被阻止，原 requestId 保留；可恢复原内容重试或查询服务器回执，确认后再提交新内容。损坏的响应正文和 HTTP 5xx 不视为明确拒绝，不清除未决标识。该策略沿用现有存储格式，不丢弃升级前的未决记录。

[独立修复 Agent Prompt](UI-REPAIR-PROMPT.md) 是委托原文。构建产物身份、累计预算、检查报告展示、请求幂等与恢复及验收补足已实施：`pnpm verify:ui-build` 核对构建与服务的字节一致；累计限额默认不设置；检查报告在普通展示区呈现命令、结论、退出码与输出；未决请求按作用域持久化并可用 `POST /api/receipts` 查询正式回执。验收结果见 [交付缺陷修复与验收](../../../agent_learn/agent_dev/agent_platform/dev_docs/verification/2026-09-09-ui-repair-acceptance.md)。未接通能力（架构图、Reviewer 返工、长期记忆、任务续跑、语义查询）未改变。
