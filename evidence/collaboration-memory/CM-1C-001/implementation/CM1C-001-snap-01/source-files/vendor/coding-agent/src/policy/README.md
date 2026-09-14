# Policy

Policy 层对工具操作产生确定性安全决策，但不执行副作用，也不替代 OS Sandbox。

- `permissions/`：规范化资源并输出 `allow` / `deny` / `ask`。
- `approval/`：把 `ask` 绑定到操作指纹和 workspace revision，再请求人工确认。
- `guardrails/`：内容级防护的预留边界。

`ToolDispatcher` 是 Policy 的调用方。模型文本、Skill 或 Tool 自报元数据都不能绕过这里的硬拒绝规则。
