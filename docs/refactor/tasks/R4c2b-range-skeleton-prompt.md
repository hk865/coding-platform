W=/home/hyh001/projects/coding-platform；T=W/coding-platform/next。DSH第一阶段仅测试，完成停止等Astra中间审核。既有SqliteStores.read本身就是生产骨架，本阶段不可改实现。不要提交/安装/访问模型网络/凭据；单文件挂载原地写，不rename。

阅读 docs/refactor/intent/ORIGINAL-DIALOGUE.md:975-985、PRODUCT.md §3、ARCHITECTURE.md §2、IMPLEMENTED-CAPABILITIES.md RT1/RT7、modules/core/agent-runtime.md §7。用户要图保存定位后读取局部历史，核心利用已有结构避免重复扫描。本批不造新数据库/图/缓存/Manager；复用session_records PRIMARY KEY(session_id,position)。阅读next/vendor/coding-agent/patches/README.md、patches/storage/adapters/sqlite/sqlite-stores.ts、dist公共api、next/src/core/agent-runtime/session-operations.ts与tests/runtime/R4c-execution-history.test.ts、R4c-session-continuity.test.ts。原Kernel/src只读。

冻结契约：SqliteStores.read(sessionId, afterPosition, limit, options) 返回 ReadSessionPage & {lastPosition:number}；lastPosition是同读取快照中的原Session最后真实position，不是revision，不是返回页尾，不是记录COUNT。原签名各字段含义保持，默认read仍排除afterPosition。主审已将额外metadata从原allRecords真实末条导出，性能仍故意未改，新增测试必须复现物理全扫描。实现阶段才改在同一只读快照读取header、主键末位置、指定范围，避免BEGIN IMMEDIATE、#allRecords、COUNT。afterPosition可以大于尾部返回空；MAX_SAFE_INTEGER limit不能+1溢出。读取区间连续性、schema/checksum、DB key与payload position/session一致仍检查。返回页及nextPosition从真实snapshot推导，取消/未知Session原语义保持。区间外损坏不再要求每次读取发现；append/replay仍保留其现有完整校验，本批只优化read。

只写 tests/runtime/R4c-kernel-history-range.test.ts。真实SqliteStores+DatabaseSync，复用公共schema和append定义，不能伪造被测服务返回。可用真实两Turn/model scripted fixture，或生成合法原Session drafts；禁止让测试依赖真实网络。测试检查长Session后部小页不扫描前面正文、无COUNT/全量record_json查询（可观测SQL/取回行数或页外损坏仍能局部读，避免纯时钟阈值）；返回metadata是全Session末位置、非batch revision；分页/末页/空页/large limit；页内损坏/字段错配/范围中间缺口拒绝，页外损坏不阻止局部读取；不同Session隔离/重启/取消。SQL spy请只统计read调用期间，fixture append可能自身全量读取，不把其行为当read回归。提供一项显示真正主键范围查询的验证，不仅断言输出条数。

本批范围暂不改platform Session reader，根Agent随后冻结它的区间接线/行为测试。允许当前next-types因其他尚在骨架阶段文件缺出口失败，记录真实原因；该Lane测试须能加载并因缺性能而红，不能skip/todo，不为通过改标准。

运行 python3 tools/dsh-refactor/check.py next-history-range。返回复用分析、用例数、红测原因，停止等待Astra；不要擅自实现。
