# 下一阶段 Agent 数据流

```yaml
status: proposed
baseline_commit: a91cde6
updated: 2026-08-27
```

## 一条消息怎样安全地变成答案

```mermaid
sequenceDiagram
  autonumber
  actor User as 用户/调用方
  participant Driver as AgentDriver
  participant Inbox as Durable Inbox
  participant Log as Session Log
  participant Runner as RuntimeRunner
  participant Model as Model Provider
  participant Tool as Tool + Policy + Sandbox
  participant Projector as Projections

  User->>Driver: send(message, idempotencyKey)
  Driver->>Inbox: 追加输入
  Inbox->>Log: 提交 inbox.accepted
  Log-->>Driver: revision 已确认
  Driver->>Runner: 启动或继续一个 Run
  Runner->>Log: 提交 run/turn/model-request 事实
  Log-->>Runner: commit 成功
  Runner->>Model: 发送由日志投影出的 Context
  Model-->>Runner: 文本块或 ToolCall
  Runner->>Log: 先提交模型结果事实
  alt 需要工具
    Runner->>Tool: 权限检查、审批、沙箱执行
    Tool-->>Runner: ToolResult
    Runner->>Log: 提交工具结果事实
    Log-->>Runner: commit 成功
    Runner->>Model: 下一步 Context
  else 已有最终答案
    Runner->>Log: 提交 run.completed
  end
  Log->>Projector: 重放已提交事实
  Projector-->>User: UI/Trace/最终答案
  Driver->>Inbox: 确认该输入已处理
```

## 为什么一定要“先记账，再生效”

如果先改内存状态、后写磁盘，写盘失败时会出现两个世界：进程认为工具已执行，恢复后却认为没有执行，可能重复修改文件。当前 required
sink 已经避免了这个问题；下一阶段 Inbox 和扩展事实也必须遵守同一规则。

## 重启恢复

1. 读取 Session Header，校验 schema、lineage 和 `profileDigest`；
2. 按 position 验证校验和并重放 KernelEvent；
3. 重建 RunState、Inbox 状态和 Context Projection；
4. 对“已开始但结果未知”的外部操作做 reconciliation，不能猜成功；
5. 只有恢复到稳定边界后，Driver 才领取下一条输入。

## 压缩不是删除

上下文过长时，Compactor 追加一条 `context.summary.created`
事实，写明来源 position 区间、摘要器版本和摘要内容。模型投影可以选择摘要，审计和恢复仍能读取原始记录。需要回到过去时创建 fork，不改写原 Session。

## 多 Agent 数据流

父 Agent 创建子 Agent 时：

1. Supervisor 检查深度、预算和权限；
2. 为子 Agent 创建独立 Session、Inbox 和 Profile；
3. 父 Session 记录 delegation 请求和 childSessionId；
4. 子 Agent 独立运行；
5. 子结果作为一条已校验输入回到父 Session；
6. 父取消时，Supervisor 向下传播取消，但保留各自日志。

这里不共享可变 `RunState`，所以一个子 Agent 崩溃不会把兄弟 Agent 的状态一起破坏。
