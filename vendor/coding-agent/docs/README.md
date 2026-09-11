# Engineering Documents

`docs/` 保存与当前仓库版本绑定的工程事实，并按信息类型分区：

- `architecture/`：模块边界、静态依赖、目录和演进提案。
- `interfaces/`：Core Port、状态/事件和 App/Adapter 契约。
- `data-flow/`：运行、工具、持久化与恢复的时序。
- `adr/`：已接受决策及其取舍。
- `testing/`：验证矩阵、环境门禁和证据。
- `development/`：构建、发布、评审结论与后续实施计划。

判断当前行为时，以可执行代码和测试为最高优先级，再使用这里的 current 文档。产品路线图和参考项目学习资料不应替代本仓库的实现说明。
