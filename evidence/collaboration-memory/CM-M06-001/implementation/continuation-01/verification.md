# M06 实施中的证据索引

状态：实施中，未冻结，未作全票通过声明。Gate A 已在 CM1A-001-snap-04/gate-a-01 独立通过；本增量不能沿用该快照的全量结果。

| 范围 | 已取得证据 | 后续核对 |
| --- | --- | --- |
| M06-A 首个合格报告 | qualification-03：缺正文、撤销精确授权且存在宽授权、伪造满足成员/跳过前缀；three-hosts-02：三个真实 Work 经 Host 请求/回应 | 必要 Verification 仍未满足的真实 Goal reducer 断言补验中 |
| M06-B 时序与竞争 | qualification-process-06：两个独立 PID 竞争同一 SQLite，租约仲裁后唯一 admission；晚到报告保留 | 新增事件先到、any timeout/cancel、验读后取消与最终提交竞争，集中定向执行中 |
| M06-C 实际输入及恢复 | host-qualification-03 三条 Host 链，three-hosts-02 实际 successor ModelRequest 含 B 独立 nonce、不含迟到 A，重建 Runtime/宿主不重复 | 模型使用确定性客户端，不能推导真实模型质量 |
| M06-D 历史重放 | coordination-02 中 route-continuity 15 例通过，含超过512事件的分页到固定 horizon、Host未来cursor拒绝 | 本日志其余用例尚须等进程完整退出确认 |
| M06-E 主界面 | browser-02 实际 HTTP/SQLite/UI 等待、取消、刷新与项目隔离；view-01 九例投影，coordination-02 中扩展11例通过 | 浏览器不是所有异常状态的逐项截图证据；独立验收按确切覆盖判断 |

## 新增决定与失败记录

- M-D11：显式历史起点不能位于当前已提交事件之后。两个 Ledger 共用的 materializeRouteIntentPlans 在真实 append 位置、SQLite 事务内拒绝未来 cursor；null 仍固定为本次 SubscriptionCreated 位置。历史上错误接受的 future subscription 不自动改写，可经公开取消后重新订阅。
- M-D12：通信投影遇到未知 schema/eventType 或序号缺口返回 not_ready，不以不认识的事件得出完整视图。
- history-01 是测试误用不存在的内存 harness 方法；改为真实 coordinationRuntimeGrant。history-02 暴露未来 cursor 被接受；history-03 是修复遗漏导入；history-04 是测试填充量不足512。均保留，后续用300次真实请求跨过边界。
- qualification-process-04/05 的两个 child 使用父进程未到期 lease 的旧时钟，因此没有 admission；06 使用明确租约到期后的时钟，8例通过。该证据是独立驱动/领取竞争，不声称两个已验读批次同时抵达最终 CAS。
- three-hosts-01 因同 pendingAt 下任务排序先执行被 latch 阻塞的 A，主动中断；02 将真实 claim 时间按 C/B/A 推进并增加 latch 超时，真实链通过。
- types-09 报新增 materializer 对 unknown snapshot 的直接属性访问；补窄类型说明，后续类型结果以新日志为准。

## 集中收尾

补充结果：remaining-01.log 两文件33例通过，包含两个Ledger验读后取消竞态和真实Goal归约仍保留required义务；deadline-race-01.log 两个Ledger验读后deadline结算竞态通过，旧admission CAS均不能覆盖timed_out。types-10.log、boundaries-08.json、ui-types-08.log结果均0（之后仅添加deadline竞态测试，尚须最终检查）。

文档检查曾直接在Windows Node运行，因现有绝对WSL链接被当作Windows相对路径，报84个链接问题/12项通过；按仓库实际WSL环境执行check-docs.sh后documents-01.log为13/13。没有为适配该误用改写历史绝对链接。

先完成计划中的实现、定向反例、独立有界审查、接口文档和逐文件清单，再冻结源码并跑一次集中全量。冻结前不会按每次小修重复全量。所有历史失败原样保留，不拼接成同一版本通过声明。
