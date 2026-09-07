# 项目位置确认记录

日期：2026-09-05。依据：用户指定 Ubuntu-24.04 WSL 下的 Agent Platform 建项目录，并要求确认文档归属及所需修改。

- 新增 [项目位置说明](../agent/project-location.md)，集中记录代码、文档、内核位置及建项派发规则。
- 更新 README、人类入口、Agent 维护入口和 AGENTS 的条件路由。
- 只读检查确认目标目录存在且为空，coding-agent 目录独立存在。
- 本机路径不改变产品语义、架构分责、契约或 Ticket 验收，无需修改 PRODUCT、ARCHITECTURE、接口和 P1 DAG。
- 未创建产品代码或 Git 仓库，未迁移规范，未更改阶段批准状态。

验证：运行 `node dev_docs/verification/validate-docs.mjs`，核验新增链接及现有文档约束；结果见本次交接。
