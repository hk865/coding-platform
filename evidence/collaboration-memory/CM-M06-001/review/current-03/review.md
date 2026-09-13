# CM-M06-001 current-03 有界只读增量审查

2026-09-13；role=readonly-design-review；上游 Gate A snap-04 与 current-01/current-02。源码未冻结，实施者仍在集中工作。本轮未修改产品、测试或文档，未运行测试/全量，只读取现有实现与日志。未发现这批增量的新可复现源码阻断缺陷；不代表 M06 验收 PASS。

## 未来 startCursor

ledger-validation.materializeRouteIntentPlans 对 subscription-create 的非空 startCursor 拒绝 seq >= firstSeq。firstSeq 是待写第一个事件位置，因此只接受已经存在的历史位置；正好当前 tail（firstSeq-1）有效，未来含本次创建位置拒绝。

内存 commitOwned 在材料化→校验/CAS→追加间无 await；SQLite commitDispatch 在 BEGIN IMMEDIATE 内，以 nextEventSeq 计算。校验不依赖 Control 的过期读取，拒绝发生在任何本批持久写入之前，位置正确。

null 仍在检查之后由 materializeSubscriptionStart 固定当前 horizon，兼容“从现在起”；合法旧 startCursor 未改变含义。显式未来 cursor 现在拒绝是有意收紧。幂等重放旧已成功订阅的历史 cursor 仍小于新 firstSeq，不会被新增判断拒绝。

现有新增反例是内存 Host c9999999999 拒绝，不能称为 SQLite 边界测试。建议冻结前若补证，仅加 current-tail 接受、next-seq 拒绝、null/重复命令兼容的边界；共享函数+事务位置已静态核对，无证据表明当前有漏洞。

## 新测试与题面对应

| 增量 | 实际证明 | 不应扩张的结论 |
|---|---|---|
| alternative-report-hosts | 三个不同 Work/Run 经真实 Host subscribe/request/mailbox/respond/wait；B 先响应，协调后继实际 ModelRequest 包含 B 随机正文、不含 A；A 晚回仍投递，重启后后继不重跑，EvidenceAdmitted=0 | SourceApplicability 为可信稳定 fixture；不是真实文件源变化负例，也不是外部供应商联网验收 |
| SQLite 双 PID drive | 两个 execFile 子进程共用 SQLite，ready/go 屏障、不同 PID、父 lease 到期，最终一个 CommunicationAdmissionRecorded | 证明真实多消费者竞争及 lease/CAS 组合至多一次；不能声称两个已经验读的 admission 批次都抵达最终 CAS 的强制碰撞 |
| report-first | memory any 在报告已路由为 Delivery 后才 register，array index 1 先到获选 | 此新增排列不是 SQLite report-first 覆盖 |
| cancel/非法 mode/closure | unknown mode 与 request_closed 注册被拒，注册事件数不增加；取消后 no admission | cancel 测试用 not-arrived Delivery，无可读报告竞争 |
| all/any deadline | 已过 deadline 且报告未到，timed_out，无新 TaskClaim/admission | 无可读报告与到期的临界准入竞争 |
| CommunicationView unknown | schemaVersion !=1、未知 eventType 显式 not_ready；已知终态使用统一 helper | 未知全局事件令当前视图不完整属于明确 fail-closed，不可声称可忽略新 schema；fixture 不等于浏览器使用证据 |

三 Work 源码题面真实性充分，不是原单 Work 自发请求的换名版本。晚 A 已成功回应并由 mailbox 的作者 Run/目标 Work 断言可核对；最后 cancelRequested 可选链断言本身较弱，但晚 A 完成的实际行为补足“不默认取消”的主张。

## M06-A 至 E 的剩余关键证据边界

- A：本轮三 Work 真链补足主干；current-02 已覆盖缺正文、撤销与重叠 grant、瞬时 source unavailable、单次观察生命周期。当前新验读路径在真实 source 内容改变、scope 越权情况下仍缺专门的最终准入反例；既有 material-isolation 可复用为 Vault 层权限证据，不能自动当作 any 准入全路径证据。
- B：当前覆盖报告先到、注册先到、前驱 active、any/all、无报告 timeout/cancel、真实 PID 竞争、晚到保留。冻结前最值得补一个“已有可读候选，观察后取消/到期”的 CAS 定向反例；这是证据缺口，静态 Wait version guard 未见明显遗漏，不凭缺用例判源码坏。
- C：三 Work 实际 provider 输入固定 B nonce 与另一个 Host any→SQLite reopen→实际输入链可相互补充；重启不重复执行有现证。不能延伸为真实外部模型推理正确或 report 即 Verification。
- D：future cursor 位置正确；多 topic 历史→live 和512 prefix测试存在。长历史新用例订阅 DirectedRequestResponded 而 filler 为 Sent，证明游标分页不截断，不证明512条匹配报告正文全部投递。已有路由/重启测试按对应范围复用；无须为本票机械重跑整批。
- E：本轮只核对 ReadModel 静态实现和11条投影fixture，真实 app/service 确实调用 CommunicationViewIndex。当前本 Agent 尚未读取主界面浏览器截图/交互与重建前后对比证据；实施者需在交付清单明确关联，不能仅凭 View tests 宣称真实UI验收完成。200页/每页1000事件、80条timeline仍是显式有界展示。

以上为最小值得收敛的证据，不要求扩展 M06 到 B/C/I 整批范围，不视作新增必做大工程。

## 读取的日志

- qualification-process-06.log：8 passed、19 skipped；旧时点定向结果，未覆盖之后新增report-first等排列。
- three-hosts-02.log：1 passed；three-hosts-01.log 只有 RUN，不当成功证据。
- coordination-02.log：读取时仍在输出（已经有route-drive 30 passed、view11、observation3等），未以部分输出宣称完整汇总PASS；types-09亦不由本 Agent声明结果。

reviewed-files.sha256 记录本轮收尾读取版本，非冻结树 hash。问题反馈只回交唯一实施 owner。

## 独立真实来源见证补充（后续有界委托）

执行 real-source-witness.mjs，rc=0，日志 real-source-witness.log。使用生产 WorkspaceSourceApplicability、AlternativeReportMaterialCompiler、ArtifactVault、createMaterialAccessResolver、qualifiedAlternativeReport；临时 Linux 目录实际文件读写，manifestDigest 由生产捕获器计算。ledger/index 为隔离内存 fixture，权限适配器只允许该目录内单个文件；没有篡改产品或测试源码。

1. Compiler 初次捕获之后、Vault current source 校验之前，把实际文件从 version one 写为 version two。两次真实 manifestDigest 不同；结果 unavailable / Report source changed during inspection，winner=null，只打开第一候选，没有把第二候选当胜出。
2. 为真实新 source basis 准备 exact grants 后重新验读，首个候选 conditionIndex=0 获胜，证明失败可通过新一轮观察恢复。
3. Vault 内部 source capture 读文件之前短暂 rename 原文件，readFile 原路径实际抛 ENOENT，再在 finally 恢复。生产 capture 将真实 I/O 失败映射 unavailable；Compiler 的后置 capture 已恢复成功，但整轮仍 unavailable，winner=null，没有误跳过第一候选。
4. 文件恢复后 fresh observe 选回 conditionIndex=0。

本见证覆盖生产来源捕获与验读组合，不声称完整 Host/SQLite admission 集成、OS权限撤销或磁盘永久故障覆盖；不声称外部文件与 Ledger 跨存储原子。临时目录在 finally 清理，fixture 无真实用户数据。

运行方式：WSL 产品根，Node v24.18.0：
`node --import ./tests/coordination/process-loader.mjs evidence/collaboration-memory/CM-M06-001/review/current-03/real-source-witness.mjs`

补读 remaining-01.log：2文件33例全通过。核对新增 cancellation hook 在生产待提交 communication-successor-claim 处先提交 CancelCommunication，再提交原 admission；两个Ledger分别检查cancelled、无admission、迟到后仍无admission，填补之前取消临界证据。三Work新增真实 reduceGoal 已 committed、非 COMPLETED 且 guard_required_obligation_unsatisfied，required义务未被any替代。新增 timeoutBefore 当前仍在实施/验证，未用 remaining-01 旧日志覆盖它。

本次新见证与已读增量未发现新增关键缺陷，仍非冻结验收 PASS。
