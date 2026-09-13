# 用户提供的真实测试项目

2026-09-13 用户提供以下路径，可用于效果验证。当前操作限于只读产品查询，测试 Ledger、Vault 和记忆使用隔离目录，不将测试授权扩展为修改这些项目。

| 用户路径 | 核对结果 | 用途 |
| --- | --- | --- |
| D:/1.project/Software/to_do_list_show | 存在 | 前端候选 |
| //wsl.localhost/Ubuntu-24.04/home/han001/projects/slam-ros2-livo2-gazebo-control | 存在 | SLAM/ROS 候选 |
| D:/1.project/Software/1.Robotic | 存在，包含多个研究/代码子目录 | 文档与代码混合候选，按子项目限定读取 |
| D:/1.project/Software/herdr-master | 实际源码根为 herdr-master/herdr-master，含 README.md、AGENTS.md | 第一组真实项目记忆响应测试；实际仓库自述为终端 Agent runtime，按源码事实解释 |
| D:/1.project/Software/agent_learn/agent_project_learn/Claude-Code-main | 存在，下一层仍为 Claude-Code-main | coding-agent 候选；用户输入中的反斜杠下划线按转义解释，字面 agent/_learn 路径不存在 |

这些候选未全部执行测试，不能由目录存在推导功能已验证。真实模型配置与单票验证证据见 CM-1B-001/implementation/continuation-01/。
