# CM-1A-001 独立验收覆盖矩阵

输入声明：CM1A-001-snap-01 / `391d23a280689196da24efa0666d11912ad6cdac93891645d3abcbae157e85f2`。
独立实测：1211 文件 / `26529f1e926bc71220fdcaa128368ac5a168e96fc4f1e16b1104ef2ed5a44589`。
原声明快照的全部 A 项证据适用性为 **STALE**（指纹不匹配，原因未确定）。下表另列当前实测树的检查结论；FAIL 表示已找到实现或交付要求不满足，UNVERIFIED 表示尚未充分验证，均不表示 PASS。

| 项 | 当前树结论 | 独立核对方法、已证明边界与缺口 |
| --- | --- | --- |
| A01 | FAIL | 复核 participation/换手测试与源码；未实现 AgentInstance 单 active 槽；wait 接续仍读取原 participation，结束后被拒。归属仍在 Work 的测试不证明换手后能继续执行。见 Spec 报告。 |
| A02 | FAIL | 原 control/SQLite 测试覆盖 replay、异载荷、body-first 等局部行为；源码未接协调 Host 工具，正式产品入口链缺失。两获准 Work 与无权第三者的真实正文读取隔离未验证。 |
| A03 | FAIL | 原路由用例只覆盖单页；独立 builder/validator 反例证明带 nextIntent 的页被拒；持续事件 route intent 生产者缺失。未完成并发取消/新增、乱序与丢回执证明。 |
| A04 | UNVERIFIED | 原两消费者测试同一 harness；未独立实施跨 SQLite 连接及跨进程有效启动竞争。过期 generation 局部测试不能替代该项。 |
| A05 | FAIL | 原时序/timeout/admission 用例覆盖局部确定性流程；后继真实 Runtime 缺 RunSpec prepare，换手后 wait 接续拒绝。admission 唯一不等于可执行唯一后继。 |
| A06 | FAIL | 原用例捕获实际 ModelRequest/manifest，模型边界使用确定性替身；测试提前手工 prepare 后继掩盖生产缺口。provider_call_authorized/attempted 未实现；没有远端 ack 或语义 nonce/version witness 的独立证据。 |
| A07 | UNVERIFIED | 请求取消持久化局部测试可重跑；cancel_requested 真实生产者、leased/运行中/完成竞争没有完整证据，不能判 PASS。 |
| A08 | UNVERIFIED | 未执行外部动作后丢回执/强杀反例；done/no-effect retry/cancelled/quarantine 四条对账出口未完整证明。 |
| A09 | UNVERIFIED | 原 SQLite close/reopen 测试只覆盖 wait_admission 持久恢复；不是全票要求的强杀断点矩阵；authorization→call evidence 窗口也未实现。 |
| A10 | FAIL | 静态确认 backoffDelayMs 未接驱动、retry_scheduled 无生产转换（R3）；真实只读并行、写冲突、有界公平/backlog 的联合要求未验证。已有 backlog 字段不证明该项。 |
| A11 | UNVERIFIED | 查 D05 共存清单、唯一 drive 与全量回归；未迁移入口不竞争同一工作的专门证明不足。 |
| A12 | FAIL | 当前树独立构建/类型/边界/回归日志另见 commands.log；提交快照指纹不符、上游摘要两处不同、正式 Interface 未完整同步，且三处修复仍有缺陷。旧工作段构建日志不是最终冻结构建证据。 |

A01–A12 均适用，无 N/A。1B/1C、any-wait 与后续 M/I 的未实施不用于拒绝本票；本票自身必要行为不足已足以阻止 Gate A。

## R1–R8 归属复核

| 剩余项 | 本票归属与处理 |
| --- | --- |
| R1 | A06/A09 明确要求的提交许可及调用证据，属于本票。 |
| R2 | A03 正式订阅/事件分页的持续消费，属于本票。 |
| R3 | A10 退避、有限公平与 unknown 不盲重试，属于本票。 |
| R4 | A07 desired-state-first 的真实取消生产者，属于本票。 |
| R5 | A08/A09 明列故障注入，属于本票。 |
| R6 | A10 实际 Runtime 并行、写冲突、backlog，属于本票。 |
| R7 | A05 要求同 Work 后继，属于本票不变量；应以真实 Work 解析和持久接线证明，不能用未验证前提放行，也无须先改变产品要求。 |
| R8 | A12 要求直接修改的 Interface 职责、源码路径、失败与兼容说明，属于本票。 |

R1–R8 均不能据“后续工作段”措辞划出本票。修复后交新快照重验；不放 M/I 票。
