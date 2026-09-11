# Guardrails

这是内容级输入/输出防护与风险分类的预留目录，当前没有实现。现有安全主链由 Tool
schema、Permission、Approval、WorkspaceSandbox 和 ProcessSandbox 构成。

未来 Guardrail 只能收紧行为，不能授予工具权限。接入点、规则版本、审计字段、隐私边界以及超时后的 fail-open/fail-closed 语义需要先定义，并映射到现有 Hook 或 AgentEvent 协议。
