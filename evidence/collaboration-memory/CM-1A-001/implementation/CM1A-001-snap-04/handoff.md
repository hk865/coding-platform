# CM-1A-001 / CM1A-001-snap-04 实施交付

状态：五步补齐已实现，冻结快照的实施侧验证已完成，交付待独立验收。A01–A12 的独立结论尚未产生；Gate A 未成立，M/I 不放票。

- Ticket：D:/1.project/Software/agent_learn/agent_dev/agent_platform/dev_docs/planning/active/collaboration-memory/CM-1A-001.md
- 实施依据：同目录 CM-1A-001-FOLLOWUP-PLAN.md、CM-1A-001-PROTOCOL-CONSTRAINTS.md。
- 源码根：D:/1.project/Software/agent_platform（WSL /mnt/d/1.project/Software/agent_platform）。
- 产品 HEAD：0eb02717d16412298c786166a75ca1a9d3e05ac7；文档 HEAD：e99484fb2bd3296a32d8442e74b47d8ed569b3d5；未 commit/push。
- 冻结源码：1241 文件，SHA256 f930c3efb08d9d665117ddbc974f406a09e7d98efc2f24563ef3a78f709e4a81。

## 当前交付内容

已接通 Host 请求/回应/订阅/all-wait/取消到同 Work 唯一后继的真实内核输入；后继固定 admission Work 与授权，重启从持久事实准备。持续路由、逐模型请求的一次性许可、调用前 attempt 落账、取消、运行代际、正式 unknown 对账/隔离、有界并发和公平诊断均已有产品消费者及测试。

最终回归：315 文件 / 2113 用例通过，0 失败；其中协作 13 文件 / 111 用例。另有内核 14 用例通过，类型 0 诊断、边界无问题、构建与文档检查通过。完整命令和日志见 [verification.md](verification.md)。

具体职责、技术取舍和兼容见 [decision-log.md](decision-log.md)、[migration-inventory.md](migration-inventory.md)；A01–A12 的测试及边界见 [coverage.md](coverage.md)。没有真实远端模型质量、provider ack、记忆效果或整批通过声明。

## 可复算交付包

| 文件 | 用途 |
| --- | --- |
| source-snapshot.json / source-files/ | 本次完整原始源码字节及逐文件哈希；证据目录不计入源码指纹 |
| snap03-to-snap04-diff.json | 相对实际接手 snap-03 的 68 文件准确哈希差异，16 新增/52 修改/0 删除 |
| preparation-source-snapshot.json / preparation-reconstruction.json | 还原正式准备基线 1200 文件；计算值严格匹配 1055474c3cabe50d6c5a2630eba4dc2983c306b6f67ca713ef16c62a03afb7a6 |
| preparation-to-delivery-diff.json / baseline-to-delivery.patch / patch-replay-verification.json | 整张 CM-1A-001 相对含原有改动的准备基线：41 新增/53 修改/0 删除；patch 不把用户原有修改算成本票新增 |
| verification.md / build-verification.md / logs/ | 实际命令、退出码、冻结验证及构建来源 |
| upstream-documents.json | 本次交付使用的正式文档逐文件摘要 |

snap-03 仅保存哈希而没有完整原始字节，故其增量提供准确逐文件哈希清单，不伪造逐行 patch；整票逐行 patch 以可准确还原的正式准备基线生成。当前 source-files 为未来增量提供完整内容。旧 snap-03 的 baseline-to-delivery-diff.json 把旧格式误作空哈希表，不能用作真实整票差异；本包已替换为可复算结果，统一脚本对旧格式显式报错。

## 历史与继续入口

snap-01 声明指纹 391d23a2… 与 review-01 实测 26529f1e… 不同、snap-02 冻结后仍改码/类型与测试失败，原事故记录保留，旧 PASS 不迁移。本次 full.log 是收尾期间被主动中断的预检：verify-ui-build 会临时修改 UI 源文件再恢复，故重新冻结后的 full-final.log 完整运行，结果为 313 文件/2111 用例通过、1 条模块清单断言失败（漏列两个新文件）。该遗漏已修复，A02 样例纳入常规测试，并同步过时注释；再次冻结后 build-delivery.log/full-delivery.log 才是最终交付回归。

交付源码保持冻结。独立验收由用户另交，接收 Ticket、本 handoff、source-snapshot；证据写 acceptance/CM1A-001-snap-04/<run-id>/，缺陷按编号回交修复并生成新快照。没有独立结论时不宣称 Gate A 成立。1B、1C、M01–M06、I01–I04 未开始；M06 仍是 blocked_by: CM-1A-001 的预草稿。
