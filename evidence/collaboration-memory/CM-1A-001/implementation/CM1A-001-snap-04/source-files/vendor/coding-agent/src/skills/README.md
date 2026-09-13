# Skills

Skills 把随应用分发的只读 instruction/reference 转成 `SkillContext`，再经 `SkillProviderPort`
提供给 Composition。Skill 内容不会自动执行，也不能授予 Permission。

```text
resources/skills → FileSkillLoader → SkillRegistry.freeze
                                      → select(ids) → ContextBuilder
```

Loader 拥有文件安全和 schema，Registry 拥有索引与选择，ContextSelectionPolicy 决定预算。RuntimeRunner 不感知资源格式。
