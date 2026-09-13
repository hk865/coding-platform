# CM-M06-001 有界只读审查（非冻结验收）

输入：正式CM-M06-001、implementation/continuation-01/decision-log.md、adopted-source-snapshot（snap-04）。当前源码仍在实施中；本审查不是Gate、不能提前给M06 PASS。只写本目录，未改产品/文档、未跑全量。所读关键文件摘要见source-hashes.json。

## M06-R01 / P2 / 确认：预算耗尽前驱被显示成仍未结束

映射M06-E；位置src/data/read-model-index/communication-view.ts第34行。手写RunEventRecorded终态集合含不存在的run_failed，却漏了正式run_budget_exhausted。contracts/dispatch.ts的isTerminalRuntimeEvent和runtimeEventTerminalOutcome已将后者定义为终态。

准备：同Work已有active any wait、请求有response，前驱公开记录run_budget_exhausted。运行：

`wsl /home/han001/projects/agents/coding-agent/.tooling/node-v24.18.0-linux-x64/bin/node /mnt/d/1.project/Software/agent_platform/evidence/collaboration-memory/CM-M06-001/review/current-01/repro-view.mjs`

实际repro-view.log：canonicalTerminal=true；actualReason=waiting_for_predecessor。预期不能再提示等待已结束前驱；应根据正式报告/投递与admission资格显示正确原因。只要投影重建，错误仍复现。建议复用正式终态helper并补budget_exhausted的投影用例。Owner=/root。

同例还显示alternativeReport=pending而视图matched=1：当前matched定义实际上是回应数，UI也称“已有回应”，故不把这个计数本身定为bug；但any等待原因不能直接把raw response当合格Delivery。建议拆开回应/已投递合格候选，或让reason明确表示仍等待Delivery，覆盖回应已落账但路由尚未提交的中间状态。

## M06-R02 / 需求与设计差距，需补证或收口，不是已证实越权执行

映射M06-A/B/C：正式票要求首个合格报告，且无权/无效材料不充数。decision-log M-D03把正文存在性、当前来源和精确grant检查全部推迟到successor admission之后。

源码链：contracts/alternative-report.ts只判断DeliveryRecorded、目标Work、subscription/DirectedRequestResponded、canonical response/bodyRef相等；不检查正文可读或来源资格。control-engine/coordination.ts在选中后直接buildSuccessorCommit，Wait进入satisfied；实际材料读取/来源检查在之后Dispatch→DeliveryMaterialCompiler→Runtime之前发生。若首个引用最终无法读取，provider确实会被阻断，但该Wait已经有唯一后继，晚到另一有效报告不会重新竞争它。

必要反例：两个候选报告，首个canonical Delivery对应正文缺失或明确不再适用，第二个可用；前驱结束后运行真实drive。要求明确断言“第一份不充当合格获胜者、第二份能按本票承诺接续”或保存一个由正式需求允许的明确失败/重新等待流程。不能仅断言第一份导致provider零调用就视为any合格选择已验证。

本轮未执行此完整故障链，故不报告已证实越权读取/调用，也不自行替统筹决定新产品语义。需在M06冻结验收前补齐本票需求与实际行为的一致性；不应靠改写交接描述静默缩小M06-A。

## 其余审查结论与必要定向补验

- 首选按Ledger DeliveryRecorded游标而非条件数组/时间；正式两个Adapter按有序事件读，any admission事务重算chosen并核验selectedReport、真实satisfiedIndexes与exact deliveryRefs。这能挡住调用方伪造“全部满足”，不会把未到报告预造为selected。
- any禁止request_closed；缺省all兼容；保留迟到报告且不自动取消另一Work，边界合理。当前测试已覆盖memory/SQLite和真实Host链，但不因此覆盖所有race。
- 建议冻结前补：无权/错误归属报告在首位、响应已提交但Delivery尚未到、两个响应到达/路由先后不同、deadline/cancel与最后到达/前驱终态竞态；后继固定材料不可因晚到报告重选。
- CommunicationViewIndex仅事件读取，可从头重建，序号/页游标不完整fail-closed，atLeastCursor落后not_ready；workspace backlog/timeline在UI明确标为工作区，goal仅过滤wait。这不是跨Goal授权泄漏，现有产品为单用户。
- 视图没有使用Control作第二个调度者。来源cursor是持久日志读取位置，不是provider ack或实际材料currentness；UI当前不声称模型已经采用selected材料。

不以未实施的1B/1C/M01–M05/I阻断本票；本报告交/root集中修复/补验，未修改源码。
