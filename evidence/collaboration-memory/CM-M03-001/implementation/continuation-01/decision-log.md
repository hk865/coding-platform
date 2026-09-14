# M03 实施决定

输入工作检查点 2393797933db2dc899e553a450d02a89a6e85509eebf6616ada5df5291eaac26，1298 文件；M01/M02 未独立验收，此为共享 seam 实施输入。

D01：Reviewer 与 Handoff 保留各自资格、材料和输出绑定。集中复用“提交启动、消费一次性执行许可”及 Runtime 事实消费机制，不把不同任务类型并入万能业务入口。生产 Handoff 当前没有 Host 消费者，旧实现还复制事实循环、缺少真实 RunSpec 准备；必须处理真实入口，不能只改文件名。

D02：既有 FakeHandoffControlRuntimeAdapter 是依赖人工 noteRun 的模拟控制面，不能仅改名冒充生产适配器；正式宿主不得依赖其“最近一个 Run”隐式选择。换手必须指定完整源 Run 身份，源运行终止与 ReplacementAttempt 资格仍由 Control/账本判定。

D03：新增版本化 selection.workKind=replacement；两种账本在 limit 前按 co-committed ReplacementAttempt 判断归属，ordinary 不再被 replacement 占住窗口，Handoff 不再把普通待办报告成错误。SQLite 仅做 exact ref_key 的索引存在检查，不解析额外聚合；最后补记该额外读取成本。

D04：正式 HandoffRequest 只接受 exact 已结束 source Run 和人的有界原因；从 canonical Run/Plan/Workspace 及持久 RunSpec 重建材料、沿用原权限与预算，Control 再裁决换手资格。packet 的 body-first JSON 保存不含其自身 bodyRef 的字段，避免自引用摘要；登记后的完整 packet 带 bodyRef。旧 packet 字节不改，已有 body helper 不作全局重定义。完成项不从运行结束推断，默认没有完成声明；链式换手保留 predecessorPacketRef。

D05：Host 通过 RuntimeDispatch 消费 Replacement outbox；模型调用沿用实际输入绑定/许可/attempted 证据面。Handoff 的事实消费删除复制实现，使用共同 consumer。只有真实终态已经进入 canonical 账本时 UI 才允许请求换手；Runtime 的 cancelled 观察先到不能代替此条件。
