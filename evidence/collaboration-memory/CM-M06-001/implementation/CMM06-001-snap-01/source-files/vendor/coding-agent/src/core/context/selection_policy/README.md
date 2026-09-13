# Context Selection Policy

`context-selection-policy.ts` 在模型上下文窗口内选择 transcript、fragment、Skill 与 Memory。
`CharacterTokenEstimator` 提供确定性近似估算，`selectContext()` 返回选择结果和预算统计。

选择策略优先保护系统提示、当前用户消息和完整的 ToolCall/ToolResult 组，再按类型、优先级与稳定 ID 裁剪可选上下文。Hook 修改
`ModelRequest` 后，Runtime 会再次复核预算。

本模块只做可重复的资源分配，不生成摘要、不授予权限，也不依赖具体模型厂商。
