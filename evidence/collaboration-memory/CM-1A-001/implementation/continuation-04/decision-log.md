# CM-1A-001 接续实施（2026-09-13）

唯一实现 owner：当前 Codex。输入 snap-03 已复算：1225 文件，2c3e61c237d5dd398d9a33370b916a08847354450992b08d6d734925e3f944db。用户授权继续按 Ticket/协议完成；旧证据保留，当前为实施中。

- 取消先前的 contextInputDigest 降级：Context 组装产物通过既有 runFact 固定到 Run 的 inputBinding；Control 只核对摘要/引用，不读取正文或重新选材。Runtime 对实际输入重算并核对。
- 每次 stream 调用独立签发并消费许可，消费在调用副作用之前；消费提交含 Run/输入绑定的事务版本检查。已消费许可不重新执行。
- Run 输入绑定是一次非终态事实，Run revision 推进；事件消费者必须读取当前版本并对 revision_conflict 重新核对，不依赖硬编码 revision=2。
- 去除 Dispatch 中 Run 级首调用许可/事后首条证据收集。真实 Runtime 通过宿主传入的窄端口完成调用许可；假 Runtime 不冒充真实调用证据。
- 已证明未调用的失败按现有 run_crashed/启动前失败链收口，不制造 outcome_unknown；外部动作结果未知仍保留 unknown，禁止盲重发。
- 持续路由按每个源事件独立登记 intent，不因订阅有旧事件在途就遗漏新事件。每个订阅只按已完成前沿顺序推进。
- 唯一 drive 内有界并发；每次 start 的 replay 不触发 Runtime。跨进程争用用真实 SQLite 与隔离数据验证。

不自行增加用户累计 token/调用/时长预算；并发上限属于机械调度配置。正式 Interface 与字段五问在实现稳定后同步。当前未标 Ticket/Gate 完成。
