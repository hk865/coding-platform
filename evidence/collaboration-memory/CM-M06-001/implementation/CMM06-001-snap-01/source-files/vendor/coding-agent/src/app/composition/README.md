# Composition

本目录是进程级 Composition Root，负责把 Core Port 绑定到具体 Adapter。

## 文件职责

- `app-config.ts`：strict 配置 schema，以及默认值 → JSON → 环境变量 → CLI 的合并顺序。
- `composition-root.ts`：新 Session 的 Provider、Tool、Sandbox、Store、Skill、Memory 和 Runtime 装配。
- `resume-composition.ts`：读取 Session/Checkpoint、校验恢复环境并继续运行。

装配时先冻结 Tool/Skill Registry 和 `RunConfigSnapshot`，再创建 required
`SessionEventSink`、best-effort Checkpoint sink 与观察器。API Key 通过 `SecretSource`
进入所选 Provider factory，不属于配置或 Session。

本目录拥有数据库和 Sandbox 等资源的关闭顺序，但不复制 Context 选择、Reducer、权限策略或 Provider 协议逻辑。
