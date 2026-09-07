# 项目位置与建项入口

## 已确认的位置

用户于 2026-09-05 指定 Agent Platform 在 Ubuntu-24.04 WSL 中建立。本文是本机项目位置的唯一配置说明，路径不属于产品行为或架构不变量。

| 用途 | 路径 |
| --- | --- |
| Agent Platform 产品代码根目录 | `/home/han001/projects/agents/agent_platform` |
| Windows 访问同一目录 | `\\wsl.localhost\Ubuntu-24.04\home\han001\projects\agents\agent_platform` |
| 当前规范与规划文档根目录 | `/mnt/d/1.project/software/agent_learn/agent_dev/agent_platform` |
| 独立执行内核 coding-agent | `/home/han001/projects/agents/coding-agent` |

2026-09-05 检查时，产品代码目录存在且为空，尚未初始化项目或 Git 仓库。这是检查时快照，建项前须重新检查实际内容。

## 建项与派发

1. 在产品代码根目录创建项目；在当前文档根目录读取规范与 Ticket。两者是不同位置。
2. 派发实现任务时，`workspace_root` 使用产品代码根目录；`ticket_path` 使用当前 Ticket 的绝对路径。解析 Ticket 内相对引用时，以 Ticket 所在目录为基准。
3. 建项时在代码根目录创建简短 AGENTS 入口，指向当前文档根目录的 AGENTS 和本任务 Ticket；先读取已有入口，若存在则合并维护。正文规范继续保存在当前文档根目录。
4. coding-agent 作为独立执行内核，通过契约接入；本机位置不等于必须采用绝对路径依赖，依赖方式在对应实现任务中决定。
5. 若以后迁移规范，统一更新入口和引用，明确新的权威位置，避免两处正文同时维护。

本次仅确认位置并更新文档，不初始化代码、不搬迁规范，也不改变 P0/P1 的批准状态。产品运行时管理的用户 Workspace 与这里构建产品的开发目录属于不同概念。
