# CMM06-001-snap-01 独立交验入口

源码写入已于2026-09-13 09:45:02 UTC停止。1253文件，SHA256 `fb3be7f46cf471269427f1f1e2ece8651f8b185ac2408618fc56740309991d96`。产品HEAD保持 `0eb02717d16412298c786166a75ca1a9d3e05ac7`，没有Git提交或推送。

被验票：documents/dev_docs/planning/active/collaboration-memory/CM-M06-001.md。验收流程：同目录ACCEPTANCE-PROMPT.md。逐文件hash见source-snapshot.json，完整源码字节见source-files/；采用的1A独立PASS快照见adopted-source-snapshot.json。M06增量准确清单delivery-files.json：新增12、修改32、无删除。baseline-to-delivery.patch是HEAD至当前tracked变化，包含先前1A增量，不能当作仅M06差分；精确M06变化应对照两个源码快照及1A source-files/。

## 实现与责任

Host wait工具贯通any；Control决定、Ledger重放验证，Dispatch单一drive准备验读并申请后继，Context通过真实Vault/source验读。一次性Host观察token不持久化、不进入幂等指纹、全部退出路径销毁。选中报告、精确grant版本、拒绝候选前缀随admission落账。无可读材料时保持active并可见重试，不抢占唯一后继。

旧缺省all兼容；any不接受request_closed、不编造未到报告、不代替必要Evidence/Verification、不自动取消另一Work。未来历史cursor在append事务拒绝；512为每页prefix，整体固定horizon。ReadModel重建持久通信视图，未知schema/type或缺口返回not_ready，真实主界面消费。

## 实际验证及审查

- ../continuation-01/coordination-02.log：17文件148用例通过（当时route-drive30例、Host三Work旧断言）。
- remaining-01.log：2文件33例通过；补any事件先到、无报告取消/到期、非法mode/closure、两个Ledger验读后取消竞争、真实Goal reducer required义务仍未满足。
- deadline-race-01.log：两个Ledger验读后deadline结算竞争通过，旧admission不能覆盖timed_out。
- types-10/boundaries-08/ui-types-08均0；冻结源码final-checks.sh正在执行最后类型/边界/UI类型与build，最终日志在本快照logs/。
- browser-02.log：实际HTTP+SQLite+UI等待、取消、刷新及项目隔离1例；投影11例另含终态、未知事件、缺口及来源freshness。未声称浏览器逐项覆盖所有异常。
- review/current-01至03：独立发现R01–R04均已修复并复验；current-03/real-source-witness：真实文件内容变化、Vault实际ENOENT均整轮unavailable，不跳过第一候选；恢复后仍选第一候选。
- 集中全量正在运行，logs/full-regression.log及退出码是唯一冻结全量结果；未完成前不得宣称通过。

上述短文件名默认位于../continuation-01/。历史失败及原因见其中verification.md和decision-log.md，均未覆盖。

## 诚实边界

SQLite并发证据是两个独立PID经真实drive/lease仲裁后唯一admission，不等价两个已验读批次同步撞最终CAS；另有两个Ledger提交前取消、到期、撤权及伪造负例。真实ModelRequest使用确定性客户端，不是商业模型理解质量评估。外部文件读与SQLite不存在跨系统大事务，后继每次实际provider调用仍重新核权。全局历史扫描200000、候选64，越界明确unavailable；不声称无限历史。没有自动修改旧future订阅。

## 继续入口

验收按M06-A至E逐项判断，有缺陷回交编号、新快照修复重验；M06独立通过后继续已授权1B、1C、M01–M05、I01–I04。Gate A已成立但整批未完成，单票交验不是终止委托。
