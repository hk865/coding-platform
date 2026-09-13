# Project Memory Provider

这是项目级长期记忆的预留目录，当前没有实现，也不参与 Composition。

未来实现必须通过
`MemoryProviderPort`，按 workspace 隔离 recall/write，并记录来源、版本、更新和删除。Memory 中的文本始终按不可信数据处理，不能获得系统权限或绕过 PermissionPolicy。关闭该 Provider 不得影响 Session 重放和恢复正确性。
