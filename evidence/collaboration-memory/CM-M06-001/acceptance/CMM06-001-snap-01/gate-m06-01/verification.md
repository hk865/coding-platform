# 验证环境与证据

产品 cwd D:/1.project/Software/agent_platform（WSL /mnt/d/1.project/Software/agent_platform）。独立运行Node v24.18.0，PATH=/home/han001/projects/agents/coding-agent/.tooling/node-v24.18.0-linux-x64/bin。源码快照由Windows Node v24.19.0生成；同原始字节跨平台重算摘要一致。HEAD 0eb02717d16412298c786166a75ca1a9d3e05ac7；文档HEAD e99484fb2bd3296a32d8442e74b47d8ed569b3d5。

## 独立执行

- verify-snapshot.py：独立从git tracked/untracked范围枚举，逐工作文件、source-files副本、10份文档副本摘要核对；snapshot-before.json显示1253、fb3be7…91d96、errors=[]。不只信交付manifest文件清单。
- run-independent.sh：生产三Work Host + CommunicationView + observation生命周期3文件15例，independent-targeted.log，targeted.rc=0。通过脚本指定maxWorkers=2，避免重复全量。
- real-source-witness.mjs：生产真实文件source捕获/实际ENOENT/Vault/材料compiler；real-source-witness.log，witness.rc=0。fixture ledger/index内存隔离，文件位于临时目录并finally清理；不能冒称此脚本本身执行完整SQLite准入。

三Work test用真实CodingAgentRuntime/LeasedWorkerRuntime/Control/Ledger/Context，仅ModelClient与稳定SourceApplicability是声明的确定性替换；实际ModelRequest支持输入证据，非商业模型理解效果。浏览器用例通过独立SQLite fixture正式Control写入，不修改真实用户数据。

## 复用

同冻结源码的集中全量由实施owner执行 continuation-01/final-regression.sh：bash scripts/test-wsl.sh --maxWorkers=4。只复用CMM06-001-snap-01/logs/full-regression.log与退出码，不借用1A全量。完整结论/数量在acceptance.md。

最终checks.exit-codes：types=0 boundaries=0 ui=0 build=0。已读final-checks.sh；pnpm build实际重建当前内核tsconfig.build、平台tsconfig.app及Vite UI，build.log结束built，无旧dist冒充新源码。build版本绑定依赖冻结期间源码前后摘要未改变；本验收不声称不同工具链下构建可复现。

browser-02.log（1 passed）复用依据：已读浏览器spec、fixture、UI及服务接线，源码字节在本快照核对。用例自身启动前重建内核/平台/UI，GUI_TEST_PORT4496、独立fixture；证明真实界面显示等待、正式Control取消后刷新、项目隔离。取消由fixture调用Control，并非UI点击取消，不作扩大声明。投影异常与重建通过独立view测试/现有SQLite路由链补充。

定向历史证据：coordination-02 17文件148、remaining-01 2文件33、deadline-race-01 2例。不同阶段结果按具体覆盖引用，最终全量必须覆盖当前34例route-drive，不把旧30/32例结果当全部现版本测试。

文档权威采用交付10份documents及其摘要；工作根HANDOFF/BASELINE/READINESS用于入口和历史范围说明，历史“待指派”叙述不覆盖当前用户已授权正式票。代码/文档HEAD不代表未提交状态，snapshot包含既存修改。

最终收尾：318文件2145例全量PASS，rc0；650构建文件逐文件核对与origin摘要一致；源码结束1253/fb3be7…91d96无漂移。正式结论见acceptance.md，日志摘要见build-and-logs.json。冻结检查完成。
