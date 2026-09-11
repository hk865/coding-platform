# Coding Agent

这是一个以 TypeScript 实现的本机 Coding
Agent。它把模型流、工具调用、权限审批、工作区隔离、会话持久化和恢复组织成可替换的模块，并通过 CLI、本机 Web
UI 与 Benchmark Harness 提供三种运行入口。

## 架构总览

```text
CLI / Web UI / Benchmark
          │
          ▼
App Composition ── Provider Registry ── OpenAI / DeepSeek
          │
          ▼
RuntimeRunner ── Context / Hooks / Limits / Reducer
    │       │
    │       └── AgentEvent ── required SessionSink ── SQLite
    │                              ├── best-effort Checkpoint
    │                              └── Recovery
    ▼
ToolDispatcher ── Permission ── Approval ── Tool Handler
                                            ├── WorkspaceSandbox
                                            └── ProcessSandbox (bubblewrap)
```

核心依赖方向是“外层实现依赖 Core Port”，而不是 Core 知道具体 Provider、数据库或工具。`RuntimeRunner`
只通过 `ModelClientPort`、`ToolExecutorPort` 和 `EventSinkPort` 协作；`src/app/composition`
在进程启动时选择并注入具体实现。

## 主要模块

| 模块                        | 职责                                                             |
| --------------------------- | ---------------------------------------------------------------- |
| `src/core`                  | 厂商无关的状态机、事件、Context、Hook、资源限制和外部能力 Port   |
| `src/app`                   | CLI、Web UI、配置解析、依赖装配和进程生命周期                    |
| `src/model`                 | OpenAI Responses 与 DeepSeek Chat Completions 的流式协议适配     |
| `src/tools`                 | 工具定义、注册、批次规划和统一调度；内置 `read/check/edit/shell` |
| `src/policy`                | 路径权限判定和绑定操作指纹的人工审批                             |
| `src/sandbox`               | symlink-safe 工作区文件能力与 bubblewrap 进程隔离                |
| `src/storage`               | append-only Session、Checkpoint 的内存与 SQLite 实现             |
| `src/skills` / `src/memory` | 只读 Skill 注入与显式 Empty Memory 边界                          |
| `src/observability`         | required 提交后的结构化日志、trace 和 Web 投影                   |
| `benchmarks`                | 隔离任务工作区、隐藏 evaluator、可回放或真实模型基线             |

完整依赖图见 [`docs/architecture/module-map.md`](docs/architecture/module-map.md)，源码阅读顺序见
[`docs/architecture/source-module-guide.md`](docs/architecture/source-module-guide.md)。

## 一次运行如何流动

1. CLI 或 Web UI 把非敏感配置、workspace 和用户输入交给 Composition Root。
2. Composition 创建 Provider、ToolRegistry、Dispatcher、SQLite
   Store、Skill/Memory 和 Runtime，并冻结本次运行的配置快照。
3. Runtime 选择上下文、执行 `before_model` Hook，再消费 Provider 的流式事件。
4. 模型产生 ToolCall 时，Dispatcher 依次执行 schema 校验、权限判断、必要审批、能力检查和工具 handler；写文件和命令分别受两个 Sandbox 约束。
5. 每个 `AgentEvent` 先通过 required Session
   sink 提交，再进入 Reducer；稳定边界生成 Checkpoint，恢复时以 append-only
   Session 为事实源重放并对账未知工具结果。

## 运行入口

要求 Linux/WSL、Node.js 24 和 npm。安装、配置优先级及完整 CLI 参数见
[`docs/development/getting-started.md`](docs/development/getting-started.md)。

```bash
npm install
npm run build
node dist/app/cli/main.js run --cwd /path/to/workspace --input "修复测试"
```

本机 Web UI：

```bash
npm run web
```

服务只监听 `127.0.0.1:4173`。API
Key 只存在于当前请求与服务进程内，不写入配置、Session、日志或浏览器存储。`shell`
必须通过 bubblewrap 能力检查，缺失时拒绝执行。

## 验证

```bash
npm run check
npm run test:e2e:bwrap
npm run benchmark:baseline:replay
```

`npm run check` 依次检查格式、Lint、类型、构建、测试、静态依赖和 Benchmark 任务结构。强制 bubblewrap
E2E 与真实 Provider 基线属于环境门禁；Replay 只验证 Harness 和 evaluator，不代表模型能力成绩。测试分层与外部门禁见
[`docs/testing/README.md`](docs/testing/README.md)。

## 扩展规则

- 新 Provider 实现 `ModelClientPort` 并注册到静态 Provider Registry，不修改 Runtime。
- 新工具提供 `ToolDefinition`，只能通过 Dispatcher 进入权限、审批和 Sandbox 链。
- 新 Session/Checkpoint 后端实现对应 Core Port，并复用共享 contract tests。
- Skill 和 Memory 只提供 Context 数据，不能授予权限或成为 Session 事实源。
- `src/mcp`、Context Compactor、Project
  Memory、Metrics 和内容级 Guardrails 当前是明确的预留边界，不属于已运行的主链路。

架构决策见 [`docs/adr/README.md`](docs/adr/README.md)，当前接口见
[`docs/interfaces/README.md`](docs/interfaces/README.md)，数据流见
[`docs/data-flow/README.md`](docs/data-flow/README.md)。
