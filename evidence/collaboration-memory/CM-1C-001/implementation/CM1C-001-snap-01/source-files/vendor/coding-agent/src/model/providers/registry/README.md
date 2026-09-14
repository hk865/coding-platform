# Model Provider Registry

`ProviderRegistry` 保存稳定 Provider
ID 到描述符/factory 的静态映射。描述符声明所需秘密、能力和 provider-specific 配置；`createBuiltinProviderRegistry()`
注册 `openai` 与 `deepseek`。

Composition 在启动期显式选择一个 Provider，拒绝未知/重复 ID、能力不匹配和秘密缺失，再由 factory 创建
`ModelClientPort`。Registry 不做自动路由、fallback、重试、模型评分或动态代码加载。

新增 Provider 的边界是“Adapter + descriptor +
fixture/contract + 内置注册”，不修改 Core 或 RuntimeRunner。
