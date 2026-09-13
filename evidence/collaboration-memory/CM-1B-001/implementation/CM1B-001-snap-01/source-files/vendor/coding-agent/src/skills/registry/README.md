# Skill Registry

`SkillRegistry` 实现 `SkillProviderPort`。它注册 Loader 产出的 `SkillContext`，拒绝重复 ID，并在
`freeze()` 后提供不可变选择。

`select()`
只接受显式 ID，响应 AbortSignal，校验未知项并按稳定顺序返回结果。Registry 不修改 Skill 内容、不按模型自由文本动态加载能力，也不参与 token 裁剪。
