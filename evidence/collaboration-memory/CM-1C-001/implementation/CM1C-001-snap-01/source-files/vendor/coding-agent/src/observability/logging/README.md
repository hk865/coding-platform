# Logging

`StructuredEventLogger` 把 `AgentEvent`
写为单行结构化诊断记录。它递归处理循环引用，对敏感键进行脱敏，并限制字符串长度，避免把密钥或大块用户内容直接扩散到日志。

Logger 是 best-effort
Sink；日志后端失败不得改变 Agent 状态。若新增字段，应先明确是否属于可审计元数据，正文、工具输出和 Authorization 默认不记录。
