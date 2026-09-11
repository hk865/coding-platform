# Event Sink Port

`EventSinkPort` 定义 AgentEvent 的只读消费接口，并用 `delivery` 区分两类语义：

- `required`：发布失败会阻止事件提交和 State 推进。
- `best_effort`：失败只形成诊断，不改变运行结果。

Sink 不能返回控制决策、修改 `RunState` 或递归触发事件。`EventDeliveryCoordinator`
负责排序与失败处置，具体持久化和可观测实现位于外层。
