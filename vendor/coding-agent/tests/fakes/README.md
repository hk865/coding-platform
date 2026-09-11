# Fakes

Fakes 是实现 Core Port 的可脚本化测试替身：

- `FakeModelClient`：按请求返回预设流并记录调用。
- `FakeToolExecutor`：返回预设结果并记录 ToolCall。
- `EventCollector`：收集 required/best-effort 事件。
- `ControllableGate`：让测试在确定位置暂停、释放或取消。

`test-fakes.ts`
提供统一导出。Fake 不复制 Provider、Dispatcher、Policy、Sandbox 或 Storage 的内部实现，也不使用真实网络、sleep 或用户 workspace。
