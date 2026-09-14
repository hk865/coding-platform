# CM-1C-001 / snap02 差异复验交接

本快照替代 FAIL 的 snap01，限定关闭 C-ACCEPT-01。唯一生产 delta 为 Dispatch 首次分配 predicate、Host exact prepared ordinary Run 判断、Leased special-mode 不请求协调 grant、Runtime special-mode 拒绝注入；4 个测试文件（含新 helper）覆盖强塞 grant 与已有参与关系。完整变更对 Gate B 见 delivery-files.json，修复对 snap01 见 repair-files.json，逐文件原文见 source-files，权威文档固定于 documents。源码冻结后不再写入。

C01–C04 的实施设计、协议决策和场景见 ../continuation-01/decision-log.md、progress-2026-09-13.md 与 ../CM1C-001-snap-01/handoff.md。原 snap01 全量有 1 个真实权限缺陷，不重标 PASS；正式失败报告在 ../../acceptance/CM1C-001-snap-01/gate-c-01/acceptance.md。

## 验证组合及复用理由

按用户集中回归纪律与独立方已确认的影响判断，复用 snap01 全量未变化范围（327 文件，324 通过、1 失败、2 跳过；2194 例，2188 通过、1 失败、5 跳过），新冻结执行 logs/affected-regression.log 的 11 文件受影响集、核心/UI类型、边界、构建与文档检查。修复没有修改 claim/lease/Control/Ledger/材料或既有读写权限语义；因此不机械重跑全部。若受影响复验发现更广影响须再评估。不能声称 snap02 全量 0 失败。

强塞 grant 的 explore/review 用例断言模型和工具调用均为零；已有参与关系 explore 用例单独验证 Leased 屏障，它绕开普通 Work 材料编译入口，与真实 explorations 端到端回归一起引用。普通 writer、普通只读 document-advisor、实际 Reviewer、Query、admitted successor 与 C Host/Service/Core 提供正向兼容证明。

../CM1C-001-snap-01/real-model.json 为已冻结同一 C 路径的两个实际 DeepSeek 文字后继回应，本次不新增模型效果主张；report producer 是明确协议替身，不能证明真实项目自动冲突发现、图像能力或完整语义质量。四种浏览器证据另标明执行快照。跨进程强杀、完整迁移实现、其余 M/I 仍不在本次 Gate C 放行范围。

复验运行命令：bash evidence/collaboration-memory/CM-1C-001/implementation/continuation-01/frozen-checks-02.sh。正式运行及结束指纹、构建摘要、最终结果见本目录 verification.md（待结果齐备填写）。Gate C 结论由另一 Agent 写入 acceptance/CM1C-001-snap-02/gate-c-02/；实施者不自判通过。
