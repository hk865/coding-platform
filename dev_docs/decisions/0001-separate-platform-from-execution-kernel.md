---
status: accepted
---

# 将 Agent Platform 与执行内核分离

Agent Platform 是独立产品，拥有跨 Run 的 Goal、Task、Evidence、调度、验证、交接与人机协作；现有 `coding-agent` 保持为只负责一次 Run 内模型、工具、安全和 Context 循环的 Execution Kernel。两者通过窄 RuntimePort / Worker Protocol 连接，因为把长期平台状态继续塞进普通 M7 或单次 Runtime 会重新制造 transcript、Todo 与真实状态混杂的问题。
