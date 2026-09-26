# Coding Platform

独立于旧产品的五模块 Agent 工作台。2026-09-27 从原 `coding-platform/next` 提取，源码和当前文档一起保存在本仓库的 `main` 分支。当前是**实现冻结版本**，尚未宣告整个 MVP 完成。独立目录验收已通过 124 个文件 / 1,102 项测试，以及类型、构建、Kernel 补丁再生和 Host smoke。

## 入口

- [继续任务的 prompt](CONTINUE.md)：下次先做一次有界 completion audit。
- [当前交接](docs/refactor/HANDOFF.md)、[实现能力](docs/refactor/IMPLEMENTED-CAPABILITIES.md)、[MVP 行为](docs/MVP-BEHAVIOR.md)。
- [产品](docs/PRODUCT.md)、[架构](docs/refactor/ARCHITECTURE.md)、[UI 方向](docs/UI-WORKBENCH.md)。
- [提取与独立验收](docs/refactor/reviews/evidence/standalone-2026-09-27/extraction.json)。

## 安装与验证

使用 Node.js 24（`>=24.15.0 <25`）、npm、Git；语言分析使用 Python 3。仓库包含冻结 Kernel 产物、7 份受管补丁源码、技能资源及 Python 分析器资源包。运行依赖从两个锁文件安装，不依赖旧工程的 node_modules。

```sh
npm ci --ignore-scripts
npm ci --prefix vendor/coding-agent --omit=dev --ignore-scripts
node --run build
node --run verify:isolated
```

也可单独运行 `node --run typecheck`、`node --run check:architecture` 和 `node --run test`。`verify:isolated` 在临时物理副本检查 Kernel 补丁再生、边界、类型、构建、测试及真实 Host 启停。依赖目录不提交。

构建后，使用本机自行保存的配置启动：

```sh
node dist/app/main.js /absolute/path/to/workbench-config.json
```

配置契约见 [src/app/main.ts](src/app/main.ts) 的 `WorkbenchCliConfig`，执行配置见 [runtime-configuration.ts](src/app/runtime-configuration.ts)。启动服务本身不发模型请求；需要真实模型时另在本机配置 provider/secret。不要将凭据、实际数据库或私有工作区内容提交进仓库。

## 本次保存范围

已接通的限定路径包括调查/初始规划→采用→两个 Work 复用 Session→检查→正式 Goal 完成，以及 Task→当前 Run→原 claim Session→执行窗口/完整原历史。辅助历史重复渲染已删除，完整原始记录按需展开保留。模型验证使用受控 provider，不代表外部真实模型已验收。

暂停/取消 UI、完整恢复、独立 Reviewer、部分协调/治理消费者、最终 UI 与旧产品切换仍需按已确认 MVP 范围审计。A1 新批仅准备了旧 lane，未启动；其候选没有混入本提交。当前停止新功能施工。

## 路径与历史

原 `W/coding-platform/next/` 对应本仓库根；原 `W/docs/` 对应 `docs/`。证据、原话与历史任务书保留当时路径、哈希和状态，不批量改写成当前事实。根 [AGENTS.md](AGENTS.md) 对旧路径说明优先。旧工程、临时数据库与 DSH lane 留在原机器，未复制或退役；[原施工工具快照](docs/refactor/archive/2026-09-27-workspace-tooling/README.md)只作继续时适配依据。
