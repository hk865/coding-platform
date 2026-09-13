# 独立验收运行与证据复用

role=independent_acceptance，ticket_id=CM-1A-001。产品源码只读；新增文件全部位于本目录。没有提交或推送。

产品 cwd：D:/1.project/Software/agent_platform，WSL /mnt/d/1.project/Software/agent_platform。Node v24.18.0（Linux），Vitest 4.1.10；PATH 前置 /home/han001/projects/agents/coding-agent/.tooling/node-v24.18.0-linux-x64/bin。父任务明确要求集中收尾才跑全量，因此本轮不重复全量。

- `node scripts/source-snapshot.mjs --out <本目录>/source-snapshot.json` 与 `--diff <implementation>/source-snapshot.json`：1241 文件，f930c3efb08d9d665117ddbc974f406a09e7d98efc2f24563ef3a78f709e4a81；零差异。脚本算法已独立阅读，使用 Git tracked+untracked 清单与原始字节 hash，包含测试/配置/内核。
- 两仓 HEAD 与交付匹配；工作树明细保留 product-status.txt、document-status.txt、product-diff-stat.txt。交付 source-files 的1241份原始字节另用 Get-FileHash 核验，无差异（archive-check.json）。
- upstream-documents.json 的每个 absolutePath 使用 Get-FileHash 重算，全部匹配（upstream-diff.json）。未把基线准备阶段文字当作当前授权或当前事实。
- `wsl bash <本目录>/run-targeted.sh`：经正式 scripts/test-wsl.sh 的 bubblewrap 实际 preflight，运行 tests/coordination --maxWorkers=4；stdout/stderr 和退出码见 targeted.log。各用例 mkdtemp，SQLite/Runtime/provider计数使用独立临时目录；跨进程测试明确 child PID、barrier、process.exit(86)，未操作用户数据。
- `wsl bash <本目录>/witness-entry.sh`：run-witness.sh 保留正式 test-wsl.sh 的 Node、依赖、bubblewrap/ProcessSandbox preflight；仅将 runner include/config 改成本目录独立用例。host-witness.test.ts 从当前 host-tool-chain 用例隔离复制，imports 改绝对 WSL 路径、换 nonce；确定性 provider 从实际 user 输入提取 nonce 后输出 INDEPENDENT-WITNESS，新增公共 runtime trace 中精确 nonce 断言。两种 Work（task/coordination）均通过，2/2，退出0。没有替换 Control、Ledger、Dispatch、Context 或 Runtime/内核。

复用实施全量：implementation/CM1A-001-snap-04/logs/full-delivery.log，315文件/2113用例全通过；不计 full.log 与有1失败的 full-final.log。source-snapshot.json/source-snapshot-after.json/frozen-diff.json 标记同一 f930c3ef 冻结版本；当前再次复算一致，故对未变化路径复用全部回归。已有类型日志为空且交付退出码0；边界日志 issues=[]；文档日志13/13；内核14用例与最终构建日志亦复用。build-origin.json 的644个构建文件另逐项重算，零变化；build-delivery.log SHA256=c60f2b52b6727a1ace56ca597a7f2c4a7fcb7a3a6560f56ea999071941488427 匹配。独立用例实际 import 的是该当前内核产物，无旧 dist 冒充。

工具入口诊断：首次 PowerShell 花括号多文件读取未执行（ParserError），后改成数组；首次内联 WSL bash 命令因 PATH 经嵌套 shell 展开含空格失败，尚未启动测试。改为本目录静态 bash 脚本后正常启动；这些是验收工具调用错误，不是产品缺陷。

最终独立定向结果：13文件111例全部通过，Vitest rc=0，456.68秒。外层bash因末行CRLF在测试后返回1，已留wrapper-diagnostic并规范脚本，不重跑有效测试。witness 2/2、rc0。结束source-diff-after零变化。
