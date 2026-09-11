# Event Delivery

`EventDeliveryCoordinator` 是事件提交屏障。对每个候选 `AgentEvent`，它先按注册顺序发布所有 required
sink；任一失败都会抛出 `RequiredSinkError`，原事件不进入 Reducer。

required 提交成功后，事件才交给 best-effort sinks。后者的失败被记录为
`EventDeliveryDiagnostic`，不会改变已提交事实或运行终态。

这一顺序使 Session 持久化、Checkpoint 和 UI/日志观察具有明确的一致性边界。
