# 收紧 Bearer token 验证

`src/auth.mjs` 使用子串匹配验证 Authorization header，导致额外前后缀也能通过。修复
`isAuthorized`：只接受完整且大小写敏感的 `Bearer <token>`，并安全处理缺失或非字符串 header。

运行 `node test.mjs` 可执行公开测试。不要修改测试文件。
