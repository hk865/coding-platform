# Agent Platform 文档中心

```yaml
status: draft
updated: 2026-09-04
scope: Agent Platform 的产品、总体架构与阶段规划入口
execution_kernel: /home/han001/projects/agents/coding-agent/
```

## 1. 产品定位

`Agent Platform` 是建立在现有 `coding-agent` 之上的新产品层，不是继续向单 Agent
Runtime 横向添加功能的普通 M7。它以一个统一的人机协作控制台管理多个隔离的
Project/Workspace，以及其中可替换、可恢复的多个 Agent。

两者的边界是：

```text
Agent Platform
  负责 Goal、Task Graph、Task State、计划版本、调度、Agent 生命周期、
  验证、Handoff、Human Interaction Layer、查询与展示
                         │
                         │ RuntimePort / Worker Protocol
                         ▼
coding-agent
  负责一次 Run 内的模型循环、Context、Tool、Permission、Approval、
  Sandbox、Session、Checkpoint 与安全恢复
```

一句话概括：

> Platform 决定做什么、何时做、由谁做、是否真的完成，并持续对账期望架构与实际代码；`coding-agent` 负责一次任务具体怎样安全执行。

## 2. 为什么单独建产品

新系统拥有独立于单次 Run 的长期对象、生命周期、数据模型、控制 API 和用户界面，
其核心价值也不再是“模型能否调用工具”，而是：

> 用户能否通过一个长期入口理解并控制多个可替换的后台 Agent，而且真实进度不依赖模型自觉维护 Todo。

因此使用独立产品前缀 `P` 规划阶段，避免与 `coding-agent` 的 M0—M6/M7 混淆。
当前阶段是 `P0：产品定义与总体架构`。

## 3. 阅读顺序

1. [Domain Context](CONTEXT.md)：进入项目时使用的最小术语与不变量地图。
2. [产品定义](dev_docs/product/产品定义.md)：目标用户、核心问题、MVP、非目标和裁决记录。
3. [总体架构](dev_docs/design/总体架构.md)：计划图、数据面、控制面、编排、执行、展示与保障边界。
4. [任务图与完成判定](dev_docs/design/任务图与完成判定.md)：二维任务视图、证据流水线、Reviewer Context 与 Goal 归约。
5. [P0 产品定义与总体架构](dev_docs/planning/P0-产品定义与总体架构.md)：当前只做什么、如何验收以及后续候选顺序。

完成 P0 的用户裁决后，再新增：

```text
dev_docs/design/关键流程伪代码.md
dev_docs/planning/Agent-Platform-MVP路线图.md
```

现在不提前创建代码目录、数据库 schema、接口包或测试骨架。

## 4. 文档与事实优先级

1. 已验收的 Agent Platform 代码和测试；当前尚不存在。
2. 本目录中标记为 `current` 的产品、设计和决策文档。
3. `coding-agent` 的当前代码、测试和工程文档，仅用于说明执行内核已经具备的能力。
4. 标记为 `draft` 的方案和 P0 研究结论。
5. 对话记录、参考项目学习笔记和已被替代的 M7 旧计划。

文档状态含义：

- `draft`：待用户裁决，不能直接作为实现授权；
- `current`：已接受的产品或设计真相源；
- `superseded`：保留历史，但不得作为当前施工清单；
- `archived`：只用于追溯。

## 5. 研究来源

- [Agent 待办清单机制](chatgpt-conversation://6a9920ea-e74c-83ec-86c5-5c18441d40f1)
- [计划图、数据面、控制面、编排与展示讨论](chatgpt-conversation://6a97dcb1-7848-83ec-a858-12a37e194240)
- [产品语义裁决](chatgpt-conversation://6a9a3def-c508-83ec-a157-7b31fe82d840)
- [汇总 Task 状态判定 Goal](chatgpt-conversation://6a9a674c-8798-83ec-ad87-d121bb66bf8b)
- [OpenAI Harness Engineering](https://openai.com/index/harness-engineering/)
- `coding-agent` 当前实现、M6 之后的工程文档和原 M7 预研

对话只用于形成设计输入；接受后的仓库文档、schema、代码和测试才是可持续的真相源。
