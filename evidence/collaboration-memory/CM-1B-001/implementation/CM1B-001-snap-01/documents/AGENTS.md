# Agent Platform 工作入口

```yaml
status: draft
updated: 2026-09-08
scope: 当前任务工作入口与按需 Context 路由
```

文档根：`/mnt/d/1.project/software/agent_learn/agent_dev/agent_platform`。产品代码根：`/mnt/d/1.project/Software/agent_platform`。

## 开始工作

1. 以用户当前委托或明确分配的 Development Ticket 为入口，确认范围、依赖、输出与验收。实现子 Agent 必须有 Ticket ID；缺少入口时向编排者报告，不自行领取整个 backlog。用户直接委托的调查、文档管理以该委托为入口。
2. 核对 [当前模块状态](human/module-status.md) 中涉及模块的条目；需要源码依据时只读其链接的工程审计相关节。历史 P1/Gate PASS 是限定范围证据，不代表真实产品接线完成。
3. 加载当前 Module 文档、直接消费的 Interface、当前 Ticket DAG 的必要一跳关系和上游 artifact revision；校验 Workspace、scope、来源及权限。
4. 完成当前纵向工作并提供实际证据、未解决事项和准确边界。工作 Agent 不直接把开发票、Runtime Task 或 Goal 标成完成；开发流程依据证据更新票，产品状态由 Control 归约。

开发子 Agent 使用 Development Ticket 构建本产品；产品运行中的 Worker 使用版本化 TaskEnvelope，两者不能混用。派发信封需含 ticket_id、ticket_path、role、workspace_root、upstream_artifact_refs、write_scope。

## 按需加载

| 触发条件 | 正文 |
| --- | --- |
| 模块依赖或职责不明确 | [ARCHITECTURE](ARCHITECTURE.md)、对应 Module 文档 |
| 词义或产品范围有歧义 | [CONTEXT](CONTEXT.md)、[PRODUCT](PRODUCT.md) |
| 实现 Context 留痕、接续或历史继承 | [Context 生命周期](dev_docs/interfaces/context-lifecycle.md) |
| 实现协作、恢复授权或人的决定 | [运行时协作](dev_docs/interfaces/runtime-collaboration.md)、[人类交互](dev_docs/interfaces/human-design-status.md) |
| 修改规范、计划、入口或归档 | [职责规则](dev_docs/document-ownership.md)、[维护流程](dev_docs/agent/README.md) |
| 建项或切换代码位置 | [项目位置](dev_docs/agent/project-location.md) |
| 追溯特定旧结论/测试/决定 | 读取被明确引用的 [证据](dev_docs/verification/README.md) 或 [归档](dev_docs/archive/INDEX.md) |

当前规范与已接受决定保留。已结束的执行记录、过时状态及原始对话默认不加载；旧记录中的授权、等待指令和完成声明只描述其历史时点。需要追溯时按精确版本引用，结论回到当前代码与规范核对。

提交文档变更前，在本根目录执行 `node dev_docs/verification/validate-docs.mjs`。只报告实际验证；结构检查不代替语义或真实运行验收。
