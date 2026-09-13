# CM-1A-001 独立覆盖矩阵

快照 CM1A-001-snap-04，源码 f930c3efb08d9d665117ddbc974f406a09e7d98efc2f24563ef3a78f709e4a81。独立定向：13文件111测试全通过，Vitest退出0；另独立nonce witness 2/2通过。原始日志 targeted.log、witness.log，运行边界见verification.md。

| ID | 结论 | 独立运行/审阅证据与可放行范围 |
| --- | --- | --- |
| A01 | PASS | control/control.sqlite、participation-uniqueness、handoff-successor、coordination-capability：exact principal与RoleBinding拒绝、active slot独立SQLite竞争、换参与者等待仍归Work、后继归因保持；两类Work真实Host链重跑。 |
| A02 | PASS | control、host-tool-chain、material-isolation、coordination-capability：正式请求/回应/订阅、body-first/replay/异载荷拒绝；三个真实Work中两个获准reader读取相同正文，第三拒绝，重复digest及重开不串权；未授权工具零写。 |
| A03 | PASS | route-drive/route-continuity：固定source position/scope/horizon，pageSize=1三订阅、burst、多topic历史到live、并发新订阅及末订阅取消、伪造target/body/hasMore零写；before_page/after_page独立进程退出后恰好三份有效Delivery；事务源码核对。 |
| A04 | PASS | process-recovery的独立PID/barrier/SQLite/outbox竞争：只有一次实际provider计数；旧execution generation late begin拒绝，route-drive旧process late settle不覆盖generation2；SQLite参与唯一性另覆盖。 |
| A05 | PASS | route-drive、handoff-successor、host-tool-chain：事件先/后注册、前驱active不启动、事件与前驱结束顺序、重复drive/receipt loss、timeout/cancel；同事务Wait satisfied+admission+Attempt/Run/lease/outbox，固定同Work，stale/missing intentClaim拒绝。只放行all。 |
| A06 | PASS | delivery-into-input、model-request-evidence-bypass、host-tool-chain：实际产品Context/Runtime/当前内核，Delivery版本/manifest/input/request摘要对照，逐请求独立permit及消费，伪造/重复/撤权/来源失效阻断；新增隔离host-witness从实际user输入提取新nonce，公共trace显示同nonce，两种Work均通过。无远端ack/真实模型质量结论。 |
| A07 | PASS | route-continuity取消先落desired，丢derived取消后恢复；process-recovery pending取消重启零调用与执行中取消late终态；model-request请求间取消阻断第二调用；当前全量复用real-runtime/runtime-dispatch完成竞争。unknown不伪造cancelled，旧generation不能覆盖新结果。 |
| A08 | PASS | provider_effect写独立持久计数后进程直接退出，重启不增加计数并quarantine；未entered授权被CAS撤销后同Attempt退避；可信journal late completed/cancelled正式对账，重复恢复不重放。人工隔离不是业务成功。 |
| A09 | PASS | process-recovery实际子进程退出before_start/after_bind/after_authorize/after_attempt/provider_effect/after_terminal、未wake、start授权后未begin；route before/after page；重开SQLite/Runtime journal，permit后不明保留unknown/quarantine。不是断电/SIGKILL完整矩阵。 |
| A10 | PASS | runtime-concurrency实际两个只读Runtime/provider时间重叠，两个写只有一个provider；route-continuity有限budget公平轮换、availableAt退避、unknown隔离；route-drive失败上限quarantine、backlog诊断。仅本地有限样例，不含长期SLA。 |
| A11 | PASS | 源码审阅ordinary唯一outbox/drive，replacement在Context前排除，review不归ordinary；migration-inventory与当前全量的planned/operator、P1-07、Query/Reviewer/Handoff/Rework回归对应；机械重试保持Attempt。完整迁移仍在M票。 |
| A12 | PASS | 前后源码hash与正式上游摘要匹配，完整1241 source-files校验；644当前构建文件及构建日志hash匹配。复用同冻结版本全量315/2113、类型0诊断、边界issues空、文档13/13、内核14通过；独立111+2不重复算入实施全量。源码职责/失败/兼容路径见source-review。 |

N/A（仅本票）：any及剩余通信→M06；完整入口迁移→M01–M05；小记忆/单用户跨项目/下一相关回话/维护UI→1B；四类人的决定与全部受影响Work回流/完整前端→1C；最终跨入口、旧数据、浏览器与真实模型分层验收→I01–I04。知识库/自动Skill/第二领域等按PLAN延期。N/A没有删除后续近期要求，也不是整批通过。
