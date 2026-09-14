# CM-1C-001 Gate C 独立差异复验

结论：PASS。C01–C04 在本票限定范围通过，C-ACCEPT-01 在 snap02 独立复验关闭，无未解决阻断缺陷。不是整批协作记忆交付通过；snap01 的 FAIL 原样保留。

## 输入与结束核对

正式输入 implementation/CM1C-001-snap-02/handoff.md、source-snapshot.json、source-files、19份documents及repair-files/delivery-files。源码1289文件 SHA256 `cf2c775c1cebdc296a4deefc42d495f2102c2eaea14a2464c7e605d39febcc95`。产品 HEAD `ce043a650ecfabd72c55f02695204d58dd9c8b64`，文档 HEAD `18a337ced649f3539c58c48258bcc6dbc16993f8`。

独立 verify-snapshot.py 开始/结束均重算实际文件集合、逐文件摘要、交验source-files及19份文档摘要；snapshot-before.json、snapshot-after.json同SHA，errors=[]。本次统筹者全程保持源码冻结，明确等待验收结束核对。verify-delta.py独立计算与repair-files.json一致：4生产文件、3既有测试、1新增helper，无其他修复增量。

独立 verify-build.py 检查 dist 与 vendor/coding-agent/dist 实际文件集合及666文件摘要，全部与build-artifacts.json一致，构建fold SHA256 `887630e349fd31007919731856537c9f45c2f164001e2efb6ff22f2a39e88144`，绑定上述源码。build-and-logs.json留存最终日志摘要。

## C01–C04

| 条款 | 结论 | 实际验收范围 |
|---|---|---|
| C01 | PASS | 真实HTTP Goal/规划/三个实际Run首次分配，协调工具形成Finding/Brief/Proposal/Candidate/Review。新构建workbench显示原始Record.id冲突、Run/Plan/baseline、方案/提案摘要、选项与全部Work影响；模型producer为明确协议替身，不声称自主发现。 |
| C02 | PASS | accept/reject/defer正式回执；modify新proposal后pending、旧选择拒绝、幂等及正文绑定。Control与两个Ledger最终事务重算完整目标集；来源过期/篡改/漏项/并发新增拒绝。既有baseline/MigrationGate仍守卫，接受不激活基线。C-ACCEPT-01权限回归已关闭。 |
| C03 | PASS | 决定与完整intent原子、逐Work投递/真实Wait/intent完成原子。固定精确Delivery经当前材料与许可到实际provider证据或明确失败；落账/投递/bind前后中断关闭重开、三drive竞争无重复有效启动。新受影响集复验普通后继与C Host/Service。 |
| C04 | PASS | snap02完整dist Node/workbench四按钮与同账本/Runtime/重启一致；偏好维护不改Review事实或只读文件权限；explore/review不再获得协调写入口，普通只读document-advisor仍可协调。真实模型样例单列且不扩大效果主张。 |

具体原始链路审查和未变基线反例见 snap01/gate-c-01/source-review.md、coverage.md、baseline.log。其旧C02/C04 FAIL仅由本次精确修复及复验关闭，不重写旧报告。

## C-ACCEPT-01 关闭依据

Dispatch由布尔开关改为Host注入精确prepared普通Run predicate，project/workspace/goal/task/run全部匹配且mode未设。特殊explore/review不做首次分配；已有参与历史也不能绕过Leased屏障，Leased对特殊模式不请求协调grant。CodingAgentRuntime在任何模型/工具调用前拒绝特殊模式携带coordination。普通文件只读没有特殊mode，因此合法普通协调能力保留；已受理后继仍不重复建立首次身份。

独立 run-independent.sh：5文件30用例PASS，105.49秒，targeted.exit-code=0。实际执行原explorations失败用例、explore和Reviewer直接注入grant（零模型/工具调用）、已有参与explore的Leased屏障、普通协调能力与真实C服务四分支。已有参与explore夹具只隔离屏障并跳过普通Work材料入口；完整探索材料链由同组真实explorations测试覆盖，未声称前者单独端到端。

## 验证组合与证据复用

snap02集中受影响集：11文件78用例PASS，132.01秒，0失败0跳过。覆盖explorations、exploration-runtime、Reviewer启动拒绝、independent-review、real-runtime普通writer、semantic-query、coordination-capability、host-tool-chain后继、C Host/Service/Core。types/UI types/Module boundaries/build/docs六项退出0，文档13/13。

新构建浏览器四分支4/4 PASS，86.56秒，browser-results.txt browser=0；八张截图与日志在snap02/browser-service及logs。独立审阅实际浏览器测试接线并目视accept-recorded.png，精确提案版本与两Work调用采用证据、独立Work通知可见；浏览器模型为确定性协议替身。

按用户与统筹约定，仅复用snap01全量的未变化范围：327文件中324通过、1失败、2跳过；2194例中2188通过、1失败、5跳过。唯一失败C-ACCEPT-01已在snap02真实路径独立复验闭合。snap01另外独立5文件74例（核心/Host/服务与baseline来源）证明未变事务和激活路径。修复未改变Control/Ledger/claim/lease/材料事实和原权限规则，仅首次分配适用性与Runtime屏障；受影响正反路径均已覆盖，因此不机械重跑完整全量。不能称“snap02全量零失败”，也不能将两次测试数量相加冒充新的整批全量。

真实DeepSeek文字样例复用snap01/real-model.json，独立解析留在snap01/gate-c-01/model-witness.json：两后继回应2210/1956字符，均引用本次Review ID及proposalDigest。其运行是已有真实参与的普通mode后继，本次屏障不改变该分支，且snap02后继/普通协调复验通过；因此可复用本次有限采用结果，不新增付费调用或效果主张。原始报告仍为协议替身，空隔离源目录不证明真实项目质量；输出中的角色/Work历史材料不足诚实保留。

## 范围与交回

决定固定全部既存Work，上界64、不截断，新Work不追溯加入；modify只改说明且不降级已定影响，来源过期必须重报。决定不是Evidence PASS、权限升级或baseline激活；规范、迁移及当前执行许可仍须独立成立。正文/提案等前置记录可能先于最终Review提交，不能当作授权。

本票故障恢复为注入后关闭/重开与并发drive，不声称本票进行了OS强杀实验。自主冲突发现质量、任意真实项目方案质量、图像、自由协商与长期效益未验证。M01–M05与I01–I04仍需后续票和整批集成，历史A/B/M06及本PASS不替代它们。

验收者 gate_a_independent 未实施修复、未修改产品/测试源码或上游文档、未构建dist、未提交或推送。结束源码及构建核对已完成，统筹者现在可结束snap02冻结并按已授权计划继续。后续变更不自动继承此精确快照结论。