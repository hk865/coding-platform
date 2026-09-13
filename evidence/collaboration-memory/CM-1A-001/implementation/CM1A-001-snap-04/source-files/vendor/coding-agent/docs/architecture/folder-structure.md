# M1–M6 实际目录结构

```yaml
status: current
updated: 2026-08-26
scope: 当前代码工作区的已实现目录、验证职责与明确延期边界
```

```text
coding-agent/
├── src/
│   ├── core/                         # 纯业务内核与 Ports
│   │   ├── context/                  # 类型、选择策略、确定性请求组装
│   │   ├── hooks/                    # 协议、Registry、Executor
│   │   ├── ports/                    # Model/Tool/Event/Store/Skill/Memory
│   │   └── runtime/                  # Loop、Reducer、Event、State、Limit、取消、恢复
│   ├── tools/                        # Registry、Dispatcher、read/edit/shell
│   ├── policy/                       # Permission 与 Approval
│   ├── sandbox/                      # fd 锚定 workspace 与 bubblewrap process
│   ├── storage/                      # InMemory/SQLite 与 required Session sink
│   ├── model/providers/              # OpenAI、DeepSeek 与静态 Registry
│   ├── app/                          # CLI、strict config、run/resume Composition
│   ├── skills/                       # 固定资源 Loader/Registry
│   ├── memory/providers/empty/       # 无隐藏状态的 Empty Memory
│   └── observability/                # logging、trace 与 event sink adapter
├── tests/
│   ├── unit|contract|integration/    # 每次提交的确定性门禁
│   ├── e2e/                          # 跨进程恢复、CLI child、真实 bwrap 条件门禁
│   ├── fakes/                        # 可脚本化模型、工具与事件收集器
│   └── helpers/                      # 临时 workspace、clock、ID、资源清理
├── benchmarks/
│   ├── tasks/                        # 4 个 internal-mvp canary
│   ├── harness/                      # preflight、baseline、真实 Agent runner
│   ├── schemas/                      # task/trial/summary strict schema
│   └── results/                      # 默认忽略的运行产物与格式说明
├── docs/                             # 当前架构、接口、数据流、测试与开发文档
├── .github/workflows/ci.yml          # deterministic、bwrap、replay 三层 CI
└── package.json                      # 工程、E2E 和 benchmark 命令
```

明确延期：`src/mcp/*`、`context/compactor`、`policy/guardrails`、`memory/providers/project_memory`
和 `observability/metrics`。它们是 MVP 后能力，不应被目录骨架误认为已实现。
