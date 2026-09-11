# 本机 Web UI

Web
UI 是 CLI 的同级入口，复用同一 Composition、安全链和 SQLite，不是独立 Agent 实现。服务固定监听回环地址，页面与 API 由同一 Node
HTTP Server 提供。

## 组件

- `web-server.ts`：HTTP 路由、SSE 编码、审批/取消端点和回环服务创建。
- `web-run-manager.ts`：单活动任务状态机、订阅队列、审批等待和取消协调。
- `web-event-projection.ts`：把已提交的 `AgentEvent` 投影为时间线、模型/工具卡与指标。
- `web-page.ts`：无外部前端构建链的内嵌页面。
- `main.ts`：读取端口并启动/关闭服务。

事件先通过 required Session
sink 成功提交，再进入 Web 的 best-effort 投影；因此页面不会把未持久化事件显示成事实。API
Key 只保留在输入框、单次 loopback 请求和当前服务进程内。

当前 `WebRunManager`
只允许一个活动任务。审批提供“允许一次、任务内允许同名工具、拒绝”，但任务级授权仍受 Permission 硬拒绝、workspace
revision 与 Sandbox 约束。
