# 独立源码审阅路径

绑定 snap-04/f930c3ef。以 preparation-to-delivery-diff.json 的整票94文件（41新增/53修改）区分用户既有改动，未把整个 HEAD diff 都算成本票。本报告列实质阅读路径与确认的权威，不宣称测试证明所有状态空间。

| 边界 | 实际源码与审阅结论 |
| --- | --- |
| Host身份/受理 | contracts/coordination-tools.ts、dispatch-engine/coordination-{capability,tool-access}.ts、worker-runtime/coordination-tools.ts；宿主绑定 exact principal，active/current/link 三条件，工具写前再核资格，Vault body-first，Control回执才accepted。Agent工具不会提供human身份。 |
| 参与/等待/后继 | contracts/coordination.ts、control-engine/coordination.ts、records/coordination.ts、policies/coordination-rules.ts；Work保留等待，参与换手后按当前绑定交集准入；admission固定 Work/权限/Delivery/前驱，intentClaim和等待版本共同CAS；同Task新Attempt，唯一outbox。 |
| SQLite原子性 | state-ledger/ledger-validation.ts、sqlite-ledger.ts 与 in-memory-ledger.ts 配对提交入口；BEGIN IMMEDIATE 下读取/物化源游标与scope、CAS、receipt、页/Delivery/checkpoint/wait/next intent；参与身份唯一槽。新增校验是形状+事务重算，与Control可读业务拒绝职责不同。 |
| 持久推进 | dispatch-engine/{dispatch-engine,coordination-drive}.ts；ordinary单drive，replacement在Context前排除；execution_entered只接受exact consumer/generation；unknown不重领；固定scope/horizon、有限扫描、退避/隔离、持久进展排序。默认并发2，写lease排斥。 |
| 输入与许可 | dispatch-engine/{coordination-admission-read,coordination-admission-deliveries,successor-run-preparation,model-call-access,leased-worker-runtime}.ts；runtime-input-authorization.ts；control-engine/run-facts.ts、policies/runtime-call-admission.ts；worker-runtime/{coding-agent-runtime,observed-model-run}.ts。RuntimeInputBound固定正文输入/manifest/grant/Delivery，每次最终request的预算处理后摘要签发permit，attempt在实际provider前CAS消费，撤权和取消守卫复查。 |
| unknown/取消 | contracts/{execution-authorization,run-reconciliation,communication-reconciliation,run-lifecycle-fold}.ts；control-engine/{run-reconciliation,communication-reconciliation,control-intent}.ts；dispatch-engine/runtime-dispatch.ts。仅未entered授权可撤销回同Attempt；entered无证据quarantine；可信journal terminal按exact Run/sequence/digest正式对账，不接调用方自称证明。 |
| 组合/共存 | app/service.ts、harness/persistent-harness.ts、planned/operator dispatch；正式组合注入Runtime观察、successor准备与工具grant。Query/review/replacement保持旧消费者，未被ordinary重复领取；Rework仍产Plan。复用当前全量中对应入口回归。 |
| 内核 | vendor/coding-agent/INTEGRATION.md、public组合和permission-policy适配；hostAuthorizedTools只接受真实注册的非只读扩展，未获得协调能力不注入。当前644文件构建hash全匹配，独立Host witness走实际内核。 |

对应正式契约阅读：runtime-collaboration §CM-1A-001、context-lifecycle §后继输入固定与逐请求复核、state-ledger §continuation-04、module-boundaries；migration-inventory记录的旧入口边界与源码一致。新可选字段不为旧数据补造授权，缺失admission绑定拒绝准备，未知不假装成功。历史早期extension段仍保留当时状态，当前口径在continuation-04与module-status。

未发现需要源代码修复的确定缺陷。无远端模型效果、provider ack、无限吞吐、公平性SLA或整批产品通过结论。
