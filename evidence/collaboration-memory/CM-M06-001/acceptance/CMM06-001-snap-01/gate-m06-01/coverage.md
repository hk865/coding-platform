# M06 验收覆盖矩阵

输入 CMM06-001-snap-01 / fb3be7f46cf471269427f1f1e2ece8651f8b185ac2408618fc56740309991d96。下列行为结论与最终回归条件合并后见 acceptance.md。

| 条目 | 独立源码依据与实际证据 | 行为结论 |
|---|---|---|
| M06-A 首个合格替代报告 | Host any→Dispatch exact-grant准备/Context验读→Host一次性观察→Control→两个Ledger同事务重算前缀。独立冻结三Work Host运行成功；真实source变化/ENOENT失败无winner，恢复首候选；current-02已验证撤销exact与宽grant组合。真实Goal reducer required guard仍不满足。 | PASS |
| M06-B 时序/竞争/保留 | route-drive snapshot含report-first/register-first/前驱active/any-all；两个独立PID共享SQLite barrier、lease到期后唯一admission。remaining-01取消竞态与deadline-race-01到期竞态覆盖验读后CAS前状态竞争；撤权/伪造满足/跳前缀被拒，晚报告保留。冻结全量覆盖这些当前测试。 | PASS |
| M06-C 精确输入/恢复 | 独立冻结三Work Host：生产Runtime、Context、SQLite，实际ModelRequest只含B nonce；A晚回仍在mailbox，重启无第二admission及无后继再次调用。另复用host-qualification-03 any→重启→真实输入链。 | PASS |
| M06-D 有限历史与订阅 | append事务未来cursor检查、null起点兼容；512每页prefix/fixed horizon、multi-topic交接/live排序、断点/旧代settle在route-continuity/route-drive中。源码位置在SQLite BEGIN IMMEDIATE内/内存同步区。长无匹配历史用例仅证明扫描不截断，不夸称512条匹配正文投递。 | PASS |
| M06-E 主界面持久通信 | 独立冻结view11例：终态/已回应vs已投递/未知schema/type/缺口隔离；真实服务调用CommunicationViewIndex，UI显示游标、等待、积压、失败、winner。browser-02真实HTTP+SQLite+浏览器等待/外部正式取消后刷新/项目隔离通过，按范围复用，不声称逐异常浏览器覆盖。 | PASS |

N/A：1B小记忆、1C人的决定、M01–M05其余入口迁移及I01–I04整批集成。真实商业模型效果、开放任务协作质量未验证；不作为本票确定性工程通过的附带承诺。外部source与SQLite非跨存储原子，后继provider前复核保留；64候选/200000历史/80timeline为显式边界。
