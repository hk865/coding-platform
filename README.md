# Coding Platform

独立的五模块 Agent 工作台，仓库根就是施工工程。

**当前状态（2026-10-13）：** 可靠性批次已完成；编排第 0、1、3、5 片和接线包 1 已合入，接线包 2 正在准备。到 `6c63f069` 为止已推到远端新分支 `feat/orchestration-slices`，远端 `next-main` 不动。最后一次全量检查为 279 个测试文件、5,974 项通过，`verify:isolated` 通过；这些批次之后还没有用真实模型重跑，整个 MVP 没有完成。后续状态以 [STATUS](docs/refactor/STATUS.md) 为准。

## 入口

- 当前状态、缺口和下一步：[STATUS](docs/refactor/STATUS.md)；用户决定 1–65：[HANDOFF 顶部](docs/refactor/HANDOFF.md)。
- 编排、记忆和生命周期：[设计目录](docs/refactor/design/orchestration-2026-10/README.md)、[分片规格与任务书](docs/refactor/design/orchestration-2026-10/slices/README.md)。
- 界面基线：[冻结原型](docs/ui-reference/workbench-2026-10/README.md)和 [UI-WORKBENCH §0](docs/UI-WORKBENCH.md#ui-decisions-2026-10)；新增界面随 E3 交付。
- 产品与源码入口：[PRODUCT](docs/PRODUCT.md)、[MVP 行为](docs/MVP-BEHAVIOR.md)、[能力索引](docs/refactor/IMPLEMENTED-CAPABILITIES.md)、[架构](docs/refactor/ARCHITECTURE.md)。
- 仓库工作规则：[AGENTS](AGENTS.md)；文档导航：[docs/README](docs/README.md)。

## 安装与验证

使用 Node.js 24（`>=24.15.0 <25`）、npm、Git；语言分析使用 Python 3。仓库包含冻结 Kernel 产物、受管补丁源码、技能资源及 Python 分析器资源包。运行依赖从两个锁文件安装，不依赖旧工程的 node_modules。

```sh
npm ci --ignore-scripts
npm ci --prefix vendor/coding-agent --omit=dev --ignore-scripts
node --run build
node --run verify:isolated
```

也可单独运行 `node --run typecheck`、`node --run check:architecture` 和 `node --run test`。`verify:isolated` 在临时物理副本检查 Kernel 补丁再生、边界、类型、构建、测试及真实 Host 启停。依赖目录不提交。

### 持续集成（CI）

[`.github/workflows/ci.yml`](.github/workflows/ci.yml) 在推送到 `next-main`、`main`、`feat/**` 以及 pull request 时运行；同一分支有新提交会取消旧运行。它只在 `ubuntu-24.04` 上跑，因为 Kernel 进程沙箱依赖 bubblewrap 和非特权用户命名空间。步骤依次是：

1. 用 Node 24.x，npm 缓存同时覆盖根目录与 `vendor/coding-agent` 两个锁文件；
2. `apt-get install bubblewrap python3 git libclang1-18`（Python 源码分析器硬编码 `/usr/bin/python3`；C/C++ 分析器使用 `/usr/lib/llvm-18/lib/libclang.so.1`，测试固定 18.1.3），并执行 `sysctl kernel.apparmor_restrict_unprivileged_userns=0`（否则 24.04 的 AppArmor 会拒绝 bwrap）；
3. 把 `node` 复制到 `/usr/bin/node`：正式检查命令（如 `node -e …`）在沙箱里执行，沙箱只挂载 `/usr`、`/bin`、`/lib`、`/lib64`，`PATH=/usr/bin:/bin`；
4. 配置临时 git 身份，两个 `npm ci --ignore-scripts`；
5. `node --run typecheck` → `check:architecture` → `build` → `test`。

CI 不配置任何密钥，测试只用 fake 或回放的 provider，不调用真实模型，也不依赖 `DEEPSEEK_API_KEY`。CI 要在分支推送后才会在 GitHub 上运行。

本地复现（WSL2 Ubuntu 24.04 或其他 Linux）：

```sh
sudo apt-get install -y bubblewrap python3 git libclang1-18
sudo sysctl -w kernel.apparmor_restrict_unprivileged_userns=0   # 仅当 bwrap 报 user namespace 被拒
sudo install -m 0755 "$(command -v node)" /usr/bin/node         # 若 node 不在 /usr/bin（如 nvm 安装）
npm ci --ignore-scripts
npm ci --prefix vendor/coding-agent --omit=dev --ignore-scripts
node --run typecheck && node --run check:architecture && node --run build && node --run test
```

没有 root 权限时，可以把 bubblewrap 解包到用户目录，并用 `CODING_AGENT_BWRAP_PATH=/abs/path/to/bwrap` 指定。缺少 `/usr/bin/node` 时，依赖沙箱内检查的 3 项集成测试会失败（检查 FAIL）。基线和失败归类见 [cc-baseline-2026-10-02](docs/refactor/reviews/evidence/cc-baseline-2026-10-02/README.md)。仓库最好放在 WSL 自己的文件系统里（例如 `~/agent-next-main`），比 `/mnt/d/...` 快得多。

构建后，使用本机自行保存的配置启动：

```sh
node dist/app/main.js /absolute/path/to/workbench-config.json
```

配置契约见 [src/app/main.ts](src/app/main.ts) 的 `WorkbenchCliConfig`，执行配置见 [runtime-configuration.ts](src/app/runtime-configuration.ts)。启动服务本身不发模型请求；需要真实模型时另在本机配置 provider/secret。不要将凭据、实际数据库或私有工作区内容提交进仓库。

### 按需装配 Agent 行为

受信 `runtimeConfiguration.bindings[].grant.skills` 可以选择平台行为包，例如：

```json
{ "bundle": "platform", "behaviors": ["secretary", "scribe"] }
```

可选 `secretary`（用户交流、可视化/文档/提示词、项目掌控）、`adviser`（技术调查、实践取舍、架构决策辅助）、`scribe`（事实核查、历史设计文档和流程支持）、`reviewer`（按任务审查）。共同 `platform-work` 指令随平台包装入；`behaviors: []` 只装共同指令。上例是一名 Agent 的指令组合，不创建两名 Agent，也不自动授予文件、图或邮箱工具；工具仍由原 Role/Host grant 指定。普通协调先由相关成员直接沟通，需要时按范围委托局部参谋。

已有 `{ "resourceRoot": "/absolute/skills", "enabledIds": [] }` 配置继续有效，显式空列表不启用任何 Skill。平台包使用本仓库 `resources/skills`，不自动合并 vendor 目录；需要自定义资源仍用原显式形状。Work/Query 共用装配，Query 的实际工具限制和未接消费者不会因加载指令而消失。统一 UI 可逐个查看成员，不新建按职责分开的工作台。

冷启动、职责、生命周期和压缩的安排见[编排设计书](docs/refactor/design/orchestration-2026-10/DESIGN.md)。已实现范围见 [STATUS](docs/refactor/STATUS.md)，配置成功不等于完整编排已交付。

### 启动后怎样开始工作

当前实际 CLI 仍是上面的 `node dist/app/main.js /absolute/path/to/workbench-config.json`；端口取配置或 Host 实际分配值，以启动输出的地址为准，不沿用历史截图端口。配置文件是本机明确指定的文件，没有默认搜索或自动生成的全局配置。

| 本机配置项 | 用途 |
| --- | --- |
| `sqliteDirectory`、`actor`、`workspaces` | 原平台存储、固定操作者与明确目录/scope映射；配置目录映射不等于已完成正式项目登记 |
| `kernelStores.entries` | 既有 Kernel Session 存储映射；重启保持原路径，不能通过换空库掩盖未知执行 |
| `runtime.bindings`、`runtime.queryProfiles` | 模型/职责/工具授权与可选调查配置；密钥只按 `secretEnvironmentVariable` 从本机环境读取 |
| `checks`、`workflow` | 既有检查命令与工作推进配置；缺少配置时说明不支持，不能伪造检查通过 |

首次接项目：打开统一工作台，选择已配置工作区，经现有初始化入口登记项目/Goal；按目标发起有界调查，保存真实回答和计划候选后，在授权内采用并执行。探索可以先于完整架构图；没有依据的模块或任务关系保留未知。冻结原型是 E3 的界面基线，后端与界面的交付范围见 STATUS。

工作推进由 Host 持有。启动核对、Goal 级控制、自动返工和重新检查已有后端；旧界面尚未接上这些新增能力。已有界面的单 Run 控制与后端的 Goal 控制分别看待，入口和限制见 [STATUS](docs/refactor/STATUS.md)“缺口”和 [E3 界面待办](docs/refactor/design/orchestration-2026-10/E3-UI-ITEMS.md)。

再次打开应用：使用原配置、平台库和 Kernel 库读取状态与历史；普通读取不启动模型。运行结果未知时按正式核对流程处理；收到停止请求不等于执行已停止。

## 路径与历史

原 `W/coding-platform/next/` 对应本仓库根；原 `W/docs/` 对应 `docs/`。证据、原话与历史任务书保留当时路径、哈希和状态，不批量改写成当前事实。根 [AGENTS.md](AGENTS.md) 对旧路径说明优先。旧工程、临时数据库与 DSH lane 留在原机器，未复制或退役；[原施工工具快照](docs/refactor/archive/2026-09-27-workspace-tooling/README.md)只作继续时适配依据。

## 历史

2026-09-27 至 09-29 的提取、协作、工作台与真实模型限定验收，以及当时的临时进程和提交状态，见 [HANDOFF 历史记录](docs/refactor/HANDOFF.md)；它们不代表当前状态。
