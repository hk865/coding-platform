# S05 固定源码独立验收交接

验收权威是[原始架构对话](../2026-09-14-post-c-architecture-conversation.md)和[逐项追踪表](original-conversation-traceability.md)；[结构计划](../architecture-before-m/post-m-cleanup-plan.md)只安排顺序，不能缩小原始要求。I01–I04 尚未开始。

## 固定输入

| 项 | 值 |
| --- | --- |
| 产品 HEAD | `ce043a650ecfabd72c55f02695204d58dd9c8b64` |
| 当前 source snapshot | `final-source-snapshot-07.json` |
| 源码条目 | 1368 |
| 源码 SHA-256 | `094eb49537e667c46921074f3b15c4077dcef1c60a4bd13371857723b0b09954` |
| build snapshot | `final-build-snapshot-07.json` |
| 构建文件 | 475 |
| 构建 SHA-256 | `60b47ef8ec30a4d6dc83d4a34a9870b9daccf978815dc064e36a456fc1db5a1e` |

源码已停止写入。证据文档不在 source snapshot 范围内，可继续补充独立结论。

## 请独立核对

1. S01 是否从业务行为出发覆盖 12 Module、公开 Interface、内部实现、真实消费者和持久/恢复责任；118 个跨 Module 实现依赖是否都有具体且合理的处置，而不是只做目录归属。
2. S02 的 Ledger 校验与协调拆分是否按完整业务责任形成局部性；`CoordinationEngineImpl` 对外接口是否稳定；Control 受理检查和 Ledger 提交复核、不同主体权限及竞争规则是否保留。
3. S03 是否只共享两个 ReadModel adapter 中确实相同的事件解释；SQL 查询、索引、事务和 Map 写入是否仍由存储实现负责；等价、重启、事务回滚、顺序及性能证据是否足够，是否有引入 Redis 的依据。
4. S04 是否完成生产默认能力、全部 queue/in-flight/wake/journal、大文件保留/拆分、全范围命名与失实注释审查；测试/演示替身是否需要显式 opt-in；持久 key/schema 与 fixtures 的保留理由是否成立。
5. 是否存在用拆文件、减少行数、浅转发或万能上下文冒充接口收敛；是否遗漏机械改名造成的损坏。
6. S05 的精确 delta 复验是否足以接纳当前快照，或仍需修复/补验。

## 实施方验证事实

- 根 TypeScript 与 UI TypeScript：0 诊断。
- 模块边界：523 个可解析源码文件、524 个归属文件、`issues: []`。
- `pnpm --dir src/ui install --frozen-lockfile` 通过；三个 lockfile 的 integrity 格式异常为 0。
- 根构建成功。WSL 没有 `npm`，证据目录的 `npm` shim 只把 `npm` 参数转交现有 `pnpm`，没有改变源码或构建步骤。
- `verify:ui-build` 六步通过：wiring、clean build、served bytes、stale artifact、full build、single-build identity。
- 首次全量：2227 tests，2041 通过、181 失败、5 跳过。失败快照不接纳。失败中发现并修复一个白盒测试仍读取旧私有字段名的问题；其余均由缺少 bubblewrap 产生或连锁。
- 从 Ubuntu 包在 `/tmp` 提取真实 bubblewrap 0.9，并通过绝对 `CODING_AGENT_BWRAP_PATH` 使用，没有关闭隔离。此前失败的全部 39 文件复验为 47 suites、229 tests 全通过；其中包含全部 181 个原失败断言和修复后的投影测试。
- 之后发现 UI lockfile 的两条 base64 integrity 被机械术语替换破坏，按 Git 基线精确恢复；冻结锁安装通过。`snapshot-02-to-03-diff.json` 只包含该 lockfile。
- UI 全集在当前源码与重建产物上为 30 通过、1 失败、1 条件跳过。唯一失败的取证 DOM 已显示 `TERM_OK`，单独重跑 UI-07 为 1.7 秒通过；没有改产品或测试超时。

这些结果不拼写成“snap-03 单次全量 0 失败”。snap-03 的独立结论为 S01／S04／S05 FAIL，见 [原报告](acceptance/snap-03/acceptance.md)；snap-04 关闭 AC-S03-01–03 后仍因 AC-S04-01 判定 S04/S05 FAIL，见 [第二份报告](acceptance/snap-04/acceptance.md)；snap-05 关闭 AC-S04-01 后仍因 AC-S05-01 判定 S04/S05 FAIL，见 [第三份报告](acceptance/snap-05/acceptance.md)；snap-06 关闭 AC-S05-01 后仍因 AC-S06-01 判定 S04/S05 FAIL，见 [第四份报告](acceptance/snap-06/acceptance.md)。

snap-07 相对 snap-06 无文件增删，59 个源码文件变化，见 `snapshot-06-to-07-diff.json`：主要为按规则族发现后手工补全的当前注释与术语；另把 SQLite ReadModel 一个私有旧票号常量改为业务名称，并补一处方法声明间换行。没有公开接口、依赖方向、持久 schema 或生产执行规则变化。根/UI 类型、边界、完整构建通过，ReadModel 受影响 4 个测试文件 7 例通过；构建后源码与 snap-07 零漂移。按用户的集中回归节奏，没有为该限定 delta 重复全量或 UI。精确适用性与失败/修复链见 [s05-verification.md](s05-verification.md)。

## 主要实现证据

- [行为与接口审查](behavior-interface-audit.md)及 `interface-audit.json`
- [协调领域完成记录](coordination-domain-completion.md)
- [读模型收敛与性能](read-model-convergence.md)
- [队列责任审查](queue-responsibility-audit.md)
- [生产装配审查](production-composition-audit.md)
- [大文件职责审查](large-file-responsibility-audit.md)
- [命名与注释审查](naming-comment-audit.md)
- [定向验证汇总](targeted-verification.md)
- [执行记录](progress.md)

独立方已完成上述检查：AC-S06-01 关闭，S01–S05 全 PASS，未发现可复现产品缺陷。源码与构建逐文件复算一致；相同类别的重复标题、缺失主体、文件头职责、跨 Module 依赖说明、生产消费者、内部旧票号命名和 fixture 保留边界均已抽查。正式结论见 [snap-07 独立报告](acceptance/snap-07/acceptance.md)，只适用于上述精确快照，不外推到 I01–I04。
