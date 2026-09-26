# R3b Raw 首轮独立审阅返修

继续当前 Session，不改写文件范围。主 Agent 已复现新增冻结检查 `check.py r3b-raw-boundaries` 的四项失败；原三项保持冻结。检查入口与新增测试已由主 Agent 只读同步入副本，manifest 有 rootUpdates，非你改动。

1. put 对同一新正文 encode→decode candidate→decode winner 做了三次完整摘要。消除对刚编码 candidate 的再次完整性验证；输入只需一次摘要，实际持久 winner 至多再核验一次。可解析刚编码的可信 JSON 获取 key，不新增一套 ref 构造算法；不要跳过已有持久数据的完整性核验。单次新put测试限制不超过两次 hash。
2. put 取得已存在 winner 后，必须核对其 contentType/digest/size 对应实际请求 key；错放在 key A 的合法 row B 不能被成功返回。首次source不同是正常去重，不得将其当冲突。新增测试有正确key正例，不能靠拒绝全部新行伪通过。
3. 有新 origin 的存储行，其兼容 ownerRunRef 必须一致：Run/Query完整ref一致，TaskAttempt/platform为null。不能新旧消费者读同一行却得出不同owner。无origin旧行沿用legacy解码。复用同一origin形状校验，避免编码/解码再维护两大段同义规则；不要增加通用框架。
4. SQLite打开成功后，初始化exec/prepare任一步失败都须关闭该连接并抛出原错误。保留旧数据库原样，不自动重建。

运行 r3b-raw、r3b-raw-boundaries、platform-types、platform-architecture；报告真实结果、变动规模。正文库与旧Vault真实接线仍由后续集成完成，不自行更改其他lane。
