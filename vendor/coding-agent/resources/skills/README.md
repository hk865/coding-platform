# Skill Resources

本目录是生产 Skill 的只读资源根。每个 Skill 使用一个子目录，包含：

```text
<skill-id>/
├── skill.json   # schemaVersion、id、kind、source、priority、contentFile
└── content.md   # 注入 Context 的正文
```

当前内置 `coding-safety`（instruction）和 `project-conventions`（reference）。 `FileSkillLoader`
校验普通文件、路径 containment、大小、manifest schema、重复 ID 和内容摘要，再把结果注册到
`SkillRegistry`；Composition 只选择配置中显式启用的 ID。

Skill 是模型上下文数据，不是代码或权限。正文中的指令不能跳过 ToolDispatcher、提升 Permission 或访问资源根之外的文件。
