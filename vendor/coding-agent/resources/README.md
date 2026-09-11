# Resources

`resources/`
保存随应用分发、但不编译为 TypeScript 的只读资源。资源必须由外层 Loader 转成已校验的内部值，Core 不读取本目录，也不把资源内容视为权限。

## 子目录

- `skills/`：当前生产使用的版本化 Skill manifest 与正文，由 `FileSkillLoader` 读取。
- `mcp/`：未来 MCP 配置和 fixture 的预留边界，当前不参与构建或运行。

资源层只能提供数据：不能直接执行工具、修改 `RunState`、注入秘密或绕过
`PermissionPolicy`。新增资源格式时，应同时定义 schema、版本、大小限制、路径边界和打包测试。
