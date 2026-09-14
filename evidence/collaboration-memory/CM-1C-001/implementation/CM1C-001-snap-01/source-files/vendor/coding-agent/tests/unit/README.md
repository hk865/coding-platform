# Unit Tests

Unit tests 聚焦单个模块的纯逻辑与局部不变量，包括 Context
Builder/Selection、模型流归并、配置/CLI 解析、结构化日志、Web Event
Projection/RunManager 以及 helper/fake 自身行为。

该层使用手动时钟、确定性 ID 和脚本化 Fake，不访问真实网络、生产数据库或用户 workspace。跨模块提交、恢复和 Sandbox 语义放在 integration/e2e。
