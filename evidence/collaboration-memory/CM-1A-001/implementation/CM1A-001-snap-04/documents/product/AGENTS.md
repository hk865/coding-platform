# Agent Platform 产品代码根

产品根：`/mnt/d/1.project/Software/agent_platform`。权威规范、当前模块状态与开发记录位于文档根 `/mnt/d/1.project/software/agent_learn/agent_dev/agent_platform`。

- 以用户当前委托或分配的 Development Ticket 开始；实现子 Agent 的范围与验收来自明确 Ticket。详见 [工作入口](/mnt/d/1.project/software/agent_learn/agent_dev/agent_platform/AGENTS.md)。
- 判断哪些已实现、哪些待修时，先核对 [当前模块状态](/mnt/d/1.project/software/agent_learn/agent_dev/agent_platform/human/module-status.md) 的相关条目；[交接](IMPLEMENTATION-HANDOFF.md) 只保留当前事实，旧记录已归档。
- 设计职责与 Interface 见 [架构](/mnt/d/1.project/software/agent_learn/agent_dev/agent_platform/ARCHITECTURE.md) 及对应 Module/Interface；测试通过只证明所覆盖范围。
- 修改内置执行内核时，先读 [vendor/coding-agent/AGENTS.md](vendor/coding-agent/AGENTS.md)；核对来源与本地适配读 [INTEGRATION.md](vendor/coding-agent/INTEGRATION.md)。

保留与当前工作无关的未提交改动。构建/测试入口以 package.json 和已配置工具链为准。当前用户未配置累计 Token、调用数和时长预算，不自行增加。
