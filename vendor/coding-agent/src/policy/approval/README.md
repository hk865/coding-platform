# Approval

`ApprovalCoordinator` 只处理 Permission 的 `ask` 结果。它从规范化工具、参数、路径、cwd、workspace
identity/revision 和 Sandbox profile 计算操作指纹，再通过 `ApprovalRequester` 获取 `allow_once` 或
`deny`。

请求继承 AbortSignal 并有超时；响应必须与原指纹一致。Dispatcher 在审批前后都复核 workspace
revision，防止等待期间操作目标漂移。

终端和 Web 分别实现 Requester；`StaticApprovalRequester`
用于测试与受控 Benchmark。审批不能覆盖 Permission 的 `deny` 或缺失的 Sandbox capability。
