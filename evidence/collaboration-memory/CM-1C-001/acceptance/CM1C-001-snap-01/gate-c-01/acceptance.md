# CM-1C-001 / CM1C-001-snap-01 Gate C 独立验收

结论：FAIL。阻断项 C-ACCEPT-01：专用 explore Run 因首次分配获得 coordination_* 和 report_architecture_conflict 领域写入口。此项是实际权限边界回归，不能改旧断言放行。本报告非整批结论；修复须新快照。

输入源码1288文件 SHA256 d0dadb34031309df103d7e9ad293be4d8210850d93a2895d56d245cfe3b45f05，产品 HEAD ce043a650ecfabd72c55f02695204d58dd9c8b64，文档 HEAD 18a337ced649f3539c58c48258bcc6dbc16993f8。正式handoff、Ticket、source-files和19份documents摘要已核对；snapshot-before.json独立实际源码/交验副本errors=[]。相对已接受Gate B的精确差异见实施delivery-files.json，不以HEAD补丁替代单票差异。

| 条款 | 结论 | 依据 |
|---|---|---|
| C01 | PASS（限定生产链） | 真实服务Goal/规划/首次分配、实际工具形成报告与精确待决；浏览器显示原始来源/方案/影响。producer为明确协议替身，不证明模型自主发现。 |
| C02 | FAIL | 四分支、修改新版本、source与MigrationGate等局部行为通过，但首次分配扩展到了explore专用权限范围，构成C-ACCEPT-01。 |
| C03 | PASS（限定工程恢复） | 完整决定+intent及逐Work投递原子；真实Wait/admission/当前材料/调用证据或明确failed；故障注入与重开无重复有效启动。不是OS强杀或任意模型协作质量验证。 |
| C04 | FAIL | GUI/Ledger/Runtime四分支和偏好不改事实已验证，实际DeepSeek两后继引用本次版本；既有探索工具权限回归未闭合，不能整体放行。 |

独立运行 run-independent.sh：3文件28用例PASS，58.97秒；run-baseline.sh：2文件46用例PASS，10.53秒。共5文件74用例，均退出0，隔离数据库/服务/端口，不构建或修改源码。详见targeted.log、baseline.log。

冻结集中全量最终：1 failed /324 passed /2 skipped文件（327）；1 failed /2188 passed /5 skipped用例（2194）；825.77秒。唯一失败tests/app/explorations.test.ts:71，在单例exploration-repro.log重现。logs/results.txt为types=0 ui=0 boundaries=0 build=0 tests=1。这不是全量通过。

独立核对666构建文件集合及逐文件摘要与build-artifacts.json一致，构建fold SHA256 26434d808904f4286ce422106612011a5b09f79bde6cacd61659ea1d9a47a080；build-and-logs.json保存日志摘要与失败退出状态。结束核对script返回snapshot-after.json同原源码SHA/errors=[]；但统筹者告知其已先记录旧source-snapshot-after并解冻后应用修复，不能将跨越交接时段的live重算扩大为完整冻结的原子证明。已停止继续将当前live源码当旧快照；精确原输入仍由不可变source-files及实施source-snapshot-after保存，后续只验新快照。

真实模型冻结real-model.json独立解析结果见model-witness.json，两回应2210/1956字符，均包含本次Review ID和proposalDigest。场景为空隔离源目录，producer仍协议替身；不证明真实项目质量、自主发现、图像或其他M/I入口完成。实际输出中角色/Work历史材料不足也保留，不将其包装为完整整批采用效果。

统筹者为/root，已回交C-ACCEPT-01并接纳限定修复。新快照可按精确差异重验受影响探索/Reviewer/Runtime权限/普通协调/C服务范围，未变范围按事实复用本次全量通过部分；不得写“新快照全量0”。若修复扩大到claim/lease/permission共享语义，应相应扩大回归。后续M01–M05及I01–I04不在本票放行范围。