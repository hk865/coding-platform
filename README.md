# Agent Platform

```yaml
status: draft
updated: 2026-09-06
scope: 产品入口、文档路由与 Agent Context 规则
execution_kernel: coding-agent (separate repository)
```

Agent Platform 是建立在 `coding-agent` 执行内核之上的独立产品。它保存长期 Goal、Task、Evidence
和 Agent 状态，负责规划、调度、验证、交接与人机协作；`coding-agent` 只负责一次 Run 内的模型、
工具、安全和 Context 循环。

## 按角色进入

- **人类管理与审阅**：[human/README](human/README.md)，日常关注产品、架构、MVP 验收和阶段范围。
- **Agent 执行与维护**：[Agent 维护入口](dev_docs/agent/README.md)，维护契约细节、Module、Ticket/DAG、验证证据和变更同步。
- **职责规则**：[文档职责与权威关系](dev_docs/document-ownership.md)，两个入口引用同一规范正文。

## 按主题查阅

建立项目或确认代码位置时，读取 [项目位置与建项入口](dev_docs/agent/project-location.md)。当前目录保存规范和规划，产品代码在独立 WSL 目录建立。

| 需求                      | 默认只读这些文档                                                      |
| ------------------------- | --------------------------------------------------------------------- |
| 理解产品                  | [PRODUCT](PRODUCT.md)                                                 |
| 理解术语                  | [CONTEXT](CONTEXT.md)                                                 |
| 理解 Plane、Module 和依赖 | [ARCHITECTURE](ARCHITECTURE.md)                                       |
| 查看入口与信息流图        | [工作入口与系统结构图](dev_docs/design/agent-entry-and-system-map.md) |
| 工作 Agent 开始执行       | [AGENTS](AGENTS.md) + 编排者分配的当前 Ticket                         |
| 追溯用户需求原文          | [用户需求原文](dev_docs/product/用户需求原文.md)，仅在范围争议时读取  |
| 处理当前规划工作          | [P0 DAG](dev_docs/planning/active/P0/DAG.md) + 当前 Ticket            |
| 查看候选实现顺序          | [P1 Foundation DAG](dev_docs/planning/proposed/P1-foundation/DAG.md)  |
| Context 持续、恢复与历史继承 | [Context 生命周期](dev_docs/interfaces/context-lifecycle.md) |
| 跨包协作与变更汇报 | [运行时协作](dev_docs/interfaces/runtime-collaboration.md)、[人类交互](dev_docs/interfaces/human-design-status.md) |
| 审阅 Task→Goal 完成规则   | [Completion Policy](dev_docs/interfaces/completion-policy.md)         |
| 查看历史推导              | [Archive Index](dev_docs/archive/INDEX.md)，仅按需加载                |

## 双入口

- 用户从本 `README.md` 进入产品、架构、状态与审阅视图；
- 构建本产品的开发子 Agent 从 [AGENTS.md](AGENTS.md) 进入，但真正的工作起点必须是开发编排者明确分配的当前 Development Ticket；
- 产品运行后的 Worker 将从版本化 `TaskEnvelope` 进入 `WorkerRuntime.start`；[P1-03](dev_docs/planning/proposed/P1-foundation/tickets/03-fake-run-visible.md) 已有最小派发与 Fake Run 证据，完整连续性及角色协作由后续票验证。

没有 Ticket ID 的实现子 Agent 不自行选择 backlog。用户直接委托的文档维护按 Agent 维护入口执行。原始需求和归档只在对应 Context pointer 触发时加载。

## 文档层级

```text
PRODUCT / CONTEXT / ARCHITECTURE     稳定、低分辨率地图
                ↓
Module / Interface                   局部机制与契约
                ↓
DAG / Ticket                         当前施工与验收
                ↓
Artifact / Evidence / Handoff        执行产物
```

同一事实只保存在一个层级。顶层地图指向细节，不复制 Module 字段、状态转换或 Ticket 清单。

## 当前目录

```text
agent_platform/
├── README.md                  人类入口与文档路由
├── AGENTS.md                  工作 Agent 入口与 Context 路由
├── PRODUCT.md                 产品承诺与 MVP 边界
├── CONTEXT.md                 唯一领域词典
├── ARCHITECTURE.md            Plane、Module registry 与长期依赖
├── human/                    人类管理与审阅入口
└── dev_docs/
    ├── document-ownership.md 文档职责与权威关系
    ├── agent/                Agent 执行与变更同步流程
    ├── modules/               只展开到达施工前沿的 Module
    ├── interfaces/            跨 Module 的版本化契约
    ├── planning/              ROADMAP、阶段 DAG 与叶子 Ticket
    ├── decisions/             已接受且需要保留理由的决策
    ├── evaluation/            端到端发布门禁
    ├── product/               用户表达、双方对话与推导索引；按需读取
    ├── design/                导航图与候选设计复核；不作为独立真相源
    ├── verification/          文档结构检查与 P0 Evidence
    └── archive/               不进入默认 Context 的历史快照
```

## Agent Context 规则

实现 Agent 默认只加载：

```text
当前 Development Ticket
+ 涉及的 Module 文档
+ 直接跨越的 Interface
+ Ticket DAG 的一跳前驱/后继
+ 上游输出与当前 revision
```

除非当前 Ticket 明确要求，不加载完整产品文档、整张历史计划、其他 Module 的 Implementation、
完整 transcript 或归档文档。需要更多信息时沿引用按需读取。

集成 Agent 额外读取当前纵向切片的验收流程、接口兼容信息、子任务 Artifact/Evidence 与回退方法。

## 三类 DAG

- `ModuleDependencyDAG`：长期源码与 Interface 依赖；
- `DevelopmentTicketDAG`：开发工作的 blocking edges；
- `RuntimeExecutionDAG`：产品运行后管理用户 Task 的真实前置关系。

三者用途、生命周期和所有者不同，不得合并。

## 当前状态

2026-09-06 Context 生命周期、执行记忆与编排交互方向已专项确认，正式文档、P1-16／17 及相关票已同步。P0 仍 in_review，P1 仍 proposed；已有 P1-00…06 逐票有限授权与实现记录，阶段状态不代表没有代码，也不自动授权下一票。新增行为的差距与验证归属见 [同步记录](dev_docs/verification/2026-09-06-context-orchestration-sync.md)。

旧版 v0.3 已原样保存在
[归档快照](dev_docs/archive/v0.3-2026-09-04/ARCHIVE-NOTE.md)，不进入默认 Agent Context。
