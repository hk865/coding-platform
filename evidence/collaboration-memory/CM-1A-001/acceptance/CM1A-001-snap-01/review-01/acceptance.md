# CM-1A-001 独立验收结论

**本票不通过，Gate A 未成立，M/I 不放票；这不是整批验收。** 声明快照因指纹不匹配标 STALE；对当前实测树的独立检查另已发现阻断缺陷，不具备 PASS 条件。

## 输入、环境与适用性

- 声明快照 CM1A-001-snap-01：`391d23a280689196da24efa0666d11912ad6cdac93891645d3abcbae157e85f2`。
- 当前实测源码：1211 文件，`26529f1e926bc71220fdcaa128368ac5a168e96fc4f1e16b1104ef2ed5a44589`；逐文件哈希见 [snapshot-before.json](snapshot-before.json)、[snapshot-after.json](snapshot-after.json) 及全量回归结束后的 [snapshot-final.json](snapshot-final.json)。三次一致，Windows Node 与 WSL Python 独立实现同一算法得到相同结果。
- 产品 HEAD：`0eb02717d16412298c786166a75ca1a9d3e05ac7`；文档 HEAD：`e99484fb2bd3296a32d8442e74b47d8ed569b3d5`。均与声明一致，HEAD 一致不足以证明源码一致。
- WSL Ubuntu-24.04 / Node 24.18.0 / npm 11.16.0 / pnpm 11.21.0；标准测试使用 `scripts/test-wsl.sh`，内核 sandbox preflight 保留；存储边界反例使用 Windows Node 24.19.0 与真实源码模块。
- 上游现值逐项摘要见 [upstream-current.json](upstream-current.json)：准备 manifest 中 module-status.md、state-ledger.md 已变化，其余条目匹配。使用当前 Ticket/PLAN 与 Interface 核验；不把较早 module-status/handoff 的“消费者未实现”当作当前全部事实。
- 用户现有及归属未明改动保留。源码、tests、规范均未修改；验收新增文件只写本目录。没有 commit/push，没有启动后续票。完整工作树 diff 留存供定位，不能整体归因为本票成果。

## Standards

详见 [standards.md](standards.md)，2 项规范/兼容性缺陷，无额外启发式风格问题：

1. **STD-01 / P1**：续页 builder 产生第二 intent 与 Recorded 事件，专用账本校验却拒绝，真实提交 `invalid_commit`。末页对照成功。
2. **STD-02 / P2**：participation-start 专用校验漏掉事件版本与非空 eventId，非法变体真实落账，证实校验强度下降。

三处修复的独立结论：participation-start **存在放宽**；删除 waitRef.workId **符合 Ref 契约，未发现该删除造成的反例**（仍核对 canonical owner Work，但不宣称全部授权路径已证明）；wait-register 发 Recorded 可被消费，route-page 加 Recorded **未同步专用校验，续页仍失败**。证据为 [standards-repro.log](standards-repro.log)。

## Spec

详见 [spec.md](spec.md)，3 项新增生产行为缺陷：

1. **SPEC-01 / P1**：后继 outbox 没有准备真实 RunSpec 的生产接线；去掉用例手工 prepare 后，admission 成功但 Runtime 启动报“真实运行缺少已登记输入”。
2. **SPEC-02 / P1**：换手后等待仍引用原 participation，生产 drive 继续提交已结束的参与关系，后继受理失败。
3. **SPEC-03 / P1**：缺少协调 Host 工具到 Control 的生产者接线；直接调用 h.control 的用例不能替代票要求的正常工具入口。

已知 R1–R8 逐项复核均属于本票，不能改列 N/A。单 Agent active participation、持续路由、提交许可/调用证据、取消生产者、unknown 对账、强杀断点、真实并行与 Interface 同步均须继续处理。未因 1B/1C 或 any-wait 未实现而拒绝本票。

## 逐项覆盖与独立运行

[coverage.md](coverage.md) 给出 A01–A12 矩阵及 R1–R8 归属；没有整项 PASS。原声明快照适用性统一 STALE；当前树的 FAIL 与 UNVERIFIED 分开记录。[defects.md](defects.md) 给出每个缺陷的准备、命令、预期/实际、位置、影响与回交 owner。

实际命令、时间、cwd、退出码见 [commands.log](commands.log)，独立产物在 logs/。2026-09-13 本轮独立结果：

| 检查 | 结果 | 原始日志 |
| --- | --- | --- |
| pnpm build（含内核、平台、UI） | exit 0 | logs/build.log |
| pnpm typecheck | exit 0，零诊断 | logs/typecheck.log |
| pnpm check:architecture | exit 0，issues=[] | logs/boundaries.log |
| 官方 runner：coordination + module ownership | exit 0，5 文件 / 55 用例 | logs/coordination.log |
| 官方 runner：全量 | exit 0，306 文件 / 2043 用例 | logs/full-tests.log |
| pnpm ui:typecheck | exit 0，零诊断 | logs/ui-typecheck.log |
| 文档结构验证 | exit 0，13/13 | logs/docs.log |
| 存储边界独立反例 | 空 eventId/错误事件版本被接纳，续页被拒；脚本 exit 0 表示缺陷复现 | standards-repro.log |
| 移除后继手工 prepare 反例 | 1 failed / 2 skipped；runtime_error | logs/no-successor-prepare.log |
| 参与段换手反例 | 1 failed / 2 skipped；旧 participation ended 被拒 | logs/handover-successor.log |

浏览器端到端与远端真实模型未运行；这不缩减本票仍须完成的要求。文档结构检查通过不证明 Interface 语义已同步。

证据分层：确定性模型边界替身下已重跑局部流程；实际 Runtime/内核来自本次当前源码构建，仍有缺失生产接线反例；真实远端模型及模型质量/协作效果未验证。捕获 ModelRequest 只证明输入，未扩大为 provider 授权账本、ack 或语义 witness 的证明。

## 回交

本报告交回 CM-1A-001 实施 owner/统筹：按 SNAP-01、STD-01/02、SPEC-01/02/03 修复及补齐本票 R1–R8，提交新快照、准确差异与影响说明后重验。不得沿用当前检查点 ID 的旧通过叙述。保持 Gate A 未成立及 M/I blocked，不接管修复、不放后续票。

Standards：2 项，最高 P1。Spec：3 项新增缺陷，最高 P1。另有快照完整性问题 SNAP-01 / P1。
