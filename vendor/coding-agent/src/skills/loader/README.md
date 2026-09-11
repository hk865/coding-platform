# Skill Loader

`FileSkillLoader` 从一个显式只读资源根加载一级 Skill 子目录。它解析 `skill.json`
与正文，校验 schemaVersion、ID、kind、priority、普通文件、大小和 containment，并生成带内容摘要的
`SkillContext`。

Loader 的输出按稳定 ID 排序，重复 ID、越界路径、符号链接和非法编码会失败。它不负责选择 Skill、不执行正文，也不扫描任意 workspace 或网络位置。
