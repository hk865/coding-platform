# 验证环境与证据分层

cwd 产品 D:/1.project/Software/agent_platform；WSL /mnt/d/1.project/Software/agent_platform。独立Node v24.18.0，PATH=/home/han001/projects/agents/coding-agent/.tooling/node-v24.18.0-linux-x64/bin；snapshot工具Windows Node v24.19.0。原始字节跨平台核对，不以HEAD代替未提交树。

独立verify-snapshot.py按git tracked/untracked枚举，排除规则与BASELINE一致；工作树/完整source-files逐文件对比，11份documents摘要核对。snapshot-before.json：1270、ba2841…d1eea、errors=[]。产品HEAD0eb02717d16412298c786166a75ca1a9d3e05ac7；文档HEADe99484fb2bd3296a32d8442e74b47d8ed569b3d5。

run-independent.sh未构建dist、未修改被验源码。两个命令：

- bash scripts/test-wsl.sh tests/memory/maintenance.test.ts tests/memory/context.test.ts tests/memory/host.test.ts tests/memory/query-input.test.ts --maxWorkers=2。4文件10例PASS，memory.rc=0。
- bash scripts/test-wsl.sh tests/coordination/host-tool-chain.test.ts -t memory=true --maxWorkers=2。1例PASS/3旧变体skipped，same-task.rc=0。

隔离临时目录、profile/SQLite/HTTP server/Runtime均由测试准备和finally清理。独立stdin纯fold验证也已在实施中复审完成，未写产品测试。正式冻结定向把原始治理/墓碑负例纳入现有实际测试，不凭旧口头已修复声明关闭。

真实内核边界：CodingAgentRuntime、ReadOnlyQueryRuntime、实际ModelRequest及Host/Control/Ledger/Context均实装；上述定向测试ModelClient为明确的确定性替换，不称商业模型结果。已有browser04两例及browser06一例确实经Playwright/HTTP/SQLite/真实UI运行，测试前构建当前内核/平台/UI；04使用标明的模型stub验证输入/显示，06从实际Run保存人的经验并重启。browser05沙箱配置失败保留，不归为产品通过；06采用既有bubblewrap路径后通过。

真实供应商效果证据单独复用：real-memory-responses.mjs / real-herdr-responses.mjs经产品HTTP维护→Query→真实Provider，不注入ModelClient stub。两JSON各6completed，profile更新后Host重启，before v1、after v2，architecture条目仅架构输入。JSON摘要与精简观察在model-evidence-summary.json，未复制密钥。空工作区回答架构407→1481字符、进度395→283；Herdr架构1217→3688、进度691→404。字数是本次现象不是阈值/正确率，用户其它候选项目未因此被验证；未测试图像。原始回答中的权限/计划建议是模型输出，不成为授权或产品规范。

跨版本证据：targeted07 9文件61通过；两组真实模型运行在最后源码冻结相同实现链，最终构建/源码identity需由主owner来源清单与收尾hash确认。同hash集中全量只复用CM1B-001-snap-01/logs，绝不借用M06的318/2145结果，也不重复运行全量。最终数量与检查退出码见acceptance.md。

边界：memory collection原子，不是Vault→ExecutionNote→memory全链事务；profile/project copy跨库无分布式事务。删除null正文/tombstone不能宣称物理清除SQLite历史字节；过去已采用输入保留历史版本，下一输入排除当前删除条目。偏好不授权限、不开启后台提炼、也不覆盖当前指示或验证义务。


最终核对：snapshot-after.json 1270 文件同 SHA，11 文档摘要一致；build-and-logs.json 658 构建文件一致，errors=[]。冻结全量 322 文件 2156 用例 PASS/退出0；types/boundaries/UI types/build 四项0，文档13/13。正式结论及完整范围见 acceptance.md。
