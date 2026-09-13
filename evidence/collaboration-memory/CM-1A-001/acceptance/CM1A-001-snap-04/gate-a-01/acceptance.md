# CM-1A-001 独立验收：PASS（仅1A，尚非整批）

Gate A 在 CM1A-001-snap-04 的 A01–A12 工程范围成立。未发现需回交修复的确定产品缺陷。统筹者可据此记录本票Gate并推进后续正式Ticket；本报告不自行更新开发票/产品Task/Goal完成状态。

验收对象：产品HEAD 0eb02717d16412298c786166a75ca1a9d3e05ac7；文档HEAD e99484fb2bd3296a32d8442e74b47d8ed569b3d5。1241源码文件指纹 f930c3efb08d9d665117ddbc974f406a09e7d98efc2f24563ef3a78f709e4a81，开始/结束逐文件差异为空；实施交付39份上游文档摘要一致。新后续草案/整批清单不改变被验输入。

独立WSL运行13文件111例全部通过，Vitest rc=0，含跨进程SQLite竞争/崩溃恢复/unknown对账；另增强真实Host→后继→实际ModelRequest→公共trace的新nonce witness，2/2通过。当前构建644文件hash与交付相同。按用户集中全量要求，复用同冻结快照315文件2113例全通过及类型/边界/构建/文档/内核日志，未机械重跑全量。

最初定向脚本末行CRLF使外层bash在测试全部成功之后返回1；targeted.log已明确记录Vitest EXIT_CODE=0，脚本已规范为LF，细节保留wrapper-diagnostic.txt。这是验收包装错误，不掩盖测试失败。

可实际释放：

- 同一Project/Workspace的Work责任地址、当前participation/principal、正式请求/回应/订阅与Delivery引用/正文授权。
- 当前持久claim/generation/route-page/CAS、all-wait及同Work唯一successor Attempt/Run/outbox；取消desired-state-first、unknown隔离/可信journal对账及有界并发机制。
- Delivery精确输入绑定、逐请求permit/attempt证据与可重建观察面，可作为M06通信可见性、any真实消费者及M01–M05逐入口迁移的基础。M06可以先正式化并实施，无需等待1B/1C；any胜出/剩余通信/恢复等新增语义必须在新票单独验收，不能沿用all的PASS。

尚未放行：远端broker/Worker、无限吞吐或长期公平性保证、Query/Reviewer/Handoff完整逐调用许可迁移、小记忆/完整人的决定前端、整批集成。真实远端模型效果、provider ack、长期记忆/效率收益均未验证；确定性provider只替换模型边界，真实内核与平台链路已运行。

证据：coverage.md逐项矩阵；source-review.md职责审阅；verification.md命令/环境/复用；defects.md限制；targeted.log与witness.log原始运行；source-snapshot.json/source-diff-after.json、upstream-diff.json、archive-check.json、build-check.json/full-reuse.json。

验收结束，解除本验收的源码只读冻结要求并回交/root；后续源码改动必须绑定新快照，原PASS仅按影响复用。独立输出限定本gate-a-01目录，未改源码/上游文档，未commit/push。不宣称整批完成。
