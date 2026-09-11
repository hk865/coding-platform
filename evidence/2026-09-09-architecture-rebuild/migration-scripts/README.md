# 已执行的一次性迁移脚本

这些脚本在本批架构重建中由主 Agent 创建并已执行，原位置为产品 scripts/。现保留为迁移证据，不能重新运行：旧路径、导出与字符串匹配前置条件已经消失，部分脚本不是幂等的。

长期模块边界检查仍在 scripts/module-map.mjs 和 scripts/check-module-boundaries.mjs。本次只归档以上七个本批脚本，没有移动或删除旧 Ticket、规范、验收历史和用户既有脚本。
