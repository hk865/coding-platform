# Configuration

`config/` 是可版本化配置样例的预留目录；当前生产 schema、默认值与合并逻辑实际位于
`src/app/composition/app-config.ts`，本目录没有运行时代码。

## 配置边界

`loadAppConfig()` 按以下顺序合并输入，后者覆盖前者：

```text
内置默认值 → JSON 配置文件 → CODING_AGENT_* 环境变量 → CLI overrides
```

`appConfigSchema` 使用 strict Zod
object 校验模型、运行预算、工具、工作区一致性、存储、Skill 和 Memory 配置。非法或未知字段在应用启动阶段失败，不进入 Runtime。

API Key 不属于 `AppConfig`。Composition 根据已选择 Provider 的描述符，从独立
`SecretSource`（默认是进程环境）读取对应密钥，因此密钥不会进入配置快照、仓库模板或 Session。Core 也不直接读取环境变量或配置文件。

如果以后向本目录加入样例，应只包含非敏感、可提交的 JSON，并以 `appConfigSchema`
为唯一结构依据；用户私有配置与运行生成状态不得放在这里。
