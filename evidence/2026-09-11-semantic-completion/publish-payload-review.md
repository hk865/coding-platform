# b7fa329 发布载荷独立本地复核

Ticket：SEM-COMP-REVIEW-03。精确提交：`b7fa329178a1474933c9dd1a4a812285cec04cf3`。仅写本报告及同名 JSON；未推送、未尝试替代传输、未更改数据库或产品源码。

结论：本次发现足以支持对**同一提交、同一预期推送**提交一次附证据的自动审批复核。没有发现必须由用户逐文件确认的真实凭据或私人数据。它不构成推送授权，也不绕过先前的自动审批拒绝；若仍被拒绝，应报告拒绝理由并请求用户明确处理。

检查对象共 3099 个 Git blob（约 2908 个变更文件与整棵树数量并非同一口径）。通过 Git 读取精确提交，按文件名及 SQLite 文件头识别 **3 个 `.env`、24 个 SQLite**。27 个文件检查前后 SHA256 均与提交一致。数据库以 `mode=ro&immutable=1` 加 `query_only=ON` 打开；遍历全部表、列、行。没有未扫描的 BLOB 类型单元格。

| 对象 | 字段/匹配类别 | 依据与判断 |
| --- | --- | --- |
| `evaluation/rat-00-v1/bug-discovery/public/BD-03/workspace/.env` | `RECOVERY_CANARY` | 仅一个固定恢复测试 canary；值与 BD-03、BD-04 evaluator 及 vendor recovery evaluator 中的断言相同。不是账户凭据。 |
| `evaluation/rat-00-v1/bug-discovery/public/BD-04/workspace/.env` | `RECOVERY_CANARY` | 同一恢复 canary，未含 API key、密码或连接凭据字段。 |
| `vendor/coding-agent/benchmarks/tasks/recovery-exactly-once/workspace/base/.env` | `RECOVERY_CANARY` | benchmark 原始夹具；提交中的 hidden_tests/evaluate.mjs 明确消费同一值。 |
| `evidence/rat-03/kernel-direct/*/session.sqlite`（4 个） | checkpoints.checkpoint_json、session_records.record_json | 四个命名 benchmark 的实际模型/工具运行记录，不是空数据库。Bearer 命中来自 node-bearer-auth 任务说明、isAuthorized 正负测试文本，已核对源文件或掩码后的上下文。 |
| `evidence/rat-03/platform-dispatch/*/gui-data/`（20 个） | ledger events/snapshots；read-model 任务、目标与计划列；real-runs checkpoint/session 列 | 同四个 benchmark 的平台账本、读模型和运行记录。Bearer 命中在目标/任务说明及认证测试代码中；没有凭据值字段。 |

精确的 24 个数据库路径、各表列名、行数、文件散列、匹配次数和 canary/source 引用均见 [publish-payload-review.json](publish-payload-review.json)。不输出环境值或候选秘密值。认证样例中的短字符串/数字是明确正负测试字面量，不能仅因含 Bearer 一词判为真实访问令牌。

既有 [commit-inventory.json](commit-inventory.json) 的 `sensitivePatternPaths` 为空。本复核另对全部 3099 个提交 blob 扫描私钥头、provider-shaped key、JWT 形状，均无命中；对 SQLite 全部文本及 JSON 字段追加凭据键名、Bearer/赋值、邮件地址、本机绝对路径和 HTTP URL 模式检查，未发现未解释的凭据或私人数据匹配。此结论依赖具体检查范围，不把“模式无命中”当作绝对无秘密证明。

声明边界：这些 SQLite 含真实 benchmark 模型会话和事件记录，但任务与认证/恢复样例来自合成 benchmark；没有发现生产账户或用户业务数据。未检查其他待推送历史提交。目标分支、远端和实际 outgoing history 仍由主 Agent 在审批时核对；若推送包含本报告范围以外的提交，本结论不能自动覆盖。后续新提交或载荷变化需要重新核对。
