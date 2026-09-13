# CM-M06-001 独立验收结论

**PASS — M06-A 至 M06-E 在本票工程范围通过。尚非整批完成。**

验收者 /root/gate_a_independent；未参与产品源码实施；仅写本验收证据目录。验收日2026-09-13。被验输入 CMM06-001-snap-01，1253文件，SHA256 `fb3be7f46cf471269427f1f1e2ece8651f8b185ac2408618fc56740309991d96`。产品HEAD `0eb02717d16412298c786166a75ca1a9d3e05ac7`；文档HEAD `e99484fb2bd3296a32d8442e74b47d8ed569b3d5`。采用1A snap-04 Gate A作为上游，M06不借用其全量结果。

## 验收依据

- 开始与结束独立枚举并重算源码，工作树1253文件、交付source-files副本逐字节摘要一致；10份采用文档摘要一致，errors=[]。见snapshot-before.json、snapshot-after.json。无源码漂移。
- 独立冻结定向：3文件15例PASS，含三不同Work经真实Host工具→SQLite→Context→真实内核→实际ModelRequest、迟到报告和重启不重复；View与一次性观察生命周期。targeted.rc=0。
- 独立真实source见证：文件内容变化与Vault捕获中实际ENOENT均整轮unavailable、winner=null；恢复/新basis重新授权后仍选首份。witness.rc=0。
- 复用同冻结hash集中全量：318文件2145例全通过，900.83秒，full-regression.exit-code=0。日志未拼接旧结果。类型、Module边界、UI类型、完整内核/平台/UI构建均0。
- 独立核对650个当前构建文件，摘要 `5f8e1fb98bcf1b048fcf6a29007c79b62f91e00766fcc24bca25c3d96ebbcee2` 与build-origin一致；完整日志摘要留存build-and-logs.json。
- 真实浏览器browser-02按明确范围复用：正式HTTP/SQLite持久等待、Control取消后的刷新、项目隔离。源码/fixture/构建入口已核对。异常状态以投影测试补充，不冒称所有异常都做了浏览器交互。

详见coverage.md、source-review.md、verification.md、defects.md以及原始日志。此前R01–R04均已独立重验关闭，本冻结快照没有开放阻断缺陷。

## 可放行范围

可释放CM-M06-001：any首个合格报告的精确选择、完整观察前缀/授权与原子唯一后继、迟到报告保留、all兼容、有限历史重放与订阅边界、真实主界面持久通信展示。any没有替代required义务，真实Goal归约仍返回guard_required_obligation_unsatisfied；不自动取消另一Work。

本次冻结结束核对已完成，统筹可记录Gate并按既有授权继续后续票。此结论只绑定本快照；之后新源码按影响重验，不能将本PASS直接扩张到1B、1C、M01–M05、I01–I04或整批最终集成。

## 保留边界

模型边界使用确定性客户端，实际ModelRequest证明输入与确定性流程，不证明商业模型协作质量或长期收益。SQLite独立PID竞争经过真实lease仲裁，不等价两份已验读批次强制同时抵达最终CAS；提交前撤权/取消/到期及伪造前缀另有反例。外部文件与SQLite无跨存储事务，provider前source/授权复核保留。64候选、200000事件扫描及80条timeline是显式有界行为；旧future订阅不自动迁移。

未修改产品/测试源码、未commit/push、未重复执行全量、未使用真实用户数据作破坏性测试。
