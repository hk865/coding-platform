# 历史 Reviewer 恢复资格有界核对

审查者未参与 DEF-17 实现。此次只读查询已知旧外审/修复 evidence，以及产品 `.local` 内名称含 data/browser/sep09 evidence 的现存目录；不启动服务、不调用恢复入口、不迁移、不改用户记录。机器范围清单和脚本为 `historical-recovery-inventory.json`、`historical-recovery-audit.mjs`。

**未在本次有界现存数据搜索中找到实际仍卡住的 Reviewer 实例。** 因此本批只能声称恢复分类判据、持久安全守卫和真实集成回归已有证据，**不能声称某个既存用户 Reviewer 已被恢复**。此次核对也未执行任何恢复授权。

## 现存产品数据搜索

- 检查 22 个 `.local` 顶层候选目录，最多向下五层；排除 fixture/source、依赖与构建目录，发现 42 个 real-runs/verifications 目录。
- 只解析运行记录的 64 位哈希 JSON 和 review journal 的 `review-<hash>.json`，找到 3 个运行 JSON，均为已 completed 的普通 coding-task，没有 mode=review 或 ReviewWork 绑定，没有 Reviewer journal。
- 对发现的 21 个 `ledger.sqlite` 使用 `DatabaseSync({readOnly:true})` 查询 ReviewWork、ReviewResult、TaskReviewProtocol 及 work.kind=review 的 Run，结果均为零；未查询/导出凭据或其他业务正文，0 读取错误。
- 其中包括 `.local/independent-review-browser-20260909{,-final,-final-02,-final-03,-final-04}/data`，这些目录目前没有可用于恢复判断的 Reviewer canonical/运行/journal 组合。目录名字曾用于 Reviewer 验收不能代替现存记录。
- 搜索未扩展到机器其他用户数据、未知临时目录、所有历史副本或整个文件系统；这里的“未找到”只限清单列出的范围。

## 可识别的旧 evidence 样本

以下是测试反例/对照的历史证据，不是此次找到的用户运行实例。

| 样本 | 可识别身份与观察 | 本轮资格结论 |
| --- | --- | --- |
| 外审 `evidence/2026-09-10-external-review/lease-refusal.log` | 端口级行为对照；未输出完整 canonical request/work/run 组合 | 不能当作持久未启动证明，不能据此授权任何历史 Run |
| 修复前 `f01-prefix-reproduction/prefix-f01-wedge.log` | Work=`review-1a1454b787101235e47007adf396c875a4c0ae03`；scope=`proj-alpha/ws-shared/goal-p107-1`；canonical ended/outcome_unknown、revision=3、lastEventSeq=0；公开观察 outcome_unknown、events/trace/usage=0；日志另写模型调用0。原 requestId 与完整 RunRef 未直接输出；冻结测试只引用 fixture 的 f.input。新请求 `review-request-after-wedge` 在冻结测试中明确存在，结果为 review_already_exists | **必须继续未知并拒绝重执行**。错误文字、测试日志的模型0调用以及空数组不能把 canonical outcome_unknown 改成可恢复 failed。该反例不能被新功能迁移或清洗成 known failure |
| 修复后 `err01-targeted-pass.log` | 同 fixture Work ID、scope；Run=`review-1a1454b787101235e47007adf396c875a4c0ae03-run`；canonical ended/crashed、exitCode=null、lastEventSeq=1；终止eventId=`8edc4266-3834-4f39-b627-d69dda8bf19f-1`；runtime failed，session=`8edc4266-3834-4f39-b627-d69dda8bf19f`，唯一run_crashed、trace/usage空 | 日志证明修复后测试中可产生合格的已知未启动类别；**日志本身不是当前 Context 所需的可查询 canonical+持久观察+请求链**。本次未找到该临时 fixture 的当前持久数据，无法认定这一具体实例现在可恢复 |

修复前后样本使用确定性 fixture，Work ID 相同不表示同一实例被原地修改，更不表示旧 outcome_unknown 被转成 crashed。修复前测试有 afterEach 清理临时目录；此次不重建已清理的持久记录，不把日志拼装成证明。

## 历史记录的产品判据与拒绝边界

当操作者打开一个**实际仍存在**的原审阅请求时，只有服务端 Context 当时复核后返回 recovery.allowed=true 才可以显式授权。候选历史记录必须仍有可解析的原请求、Work/Run/协议和独立 session，完整可信持久观察唯一且身份匹配，failed、唯一sequence=1的run_crashed与canonical ended/crashed/exitCode=null一致，trace/usage为空，无原output/result，原Work仍为协议尾项，来源/配置/材料仍当前。操作者还必须提供新的持久授权requestId与原因；读状态不会恢复。

以下历史项保持拒绝：canonical或公开观察 outcome_unknown；仅日志声称未启动；缺事件/trace/usage/session等字段；文件名身份错配、同Run重复或矛盾文件；已启动事件或任意trace/usage；已有Result或原报告（包括真实FAIL、INCONCLUSIVE、坏报告）；非当前Work；来源/配置已失效。IR01 已确保真实磁盘歧义不会在公开观察加载时被悄悄去重，也不会在 Runtime 重开时改写覆盖原文件。

本报告只做历史存在性与证据边界核对，不替代产品 Context 的最终资格判定，也不提供可执行证明或恢复命令。它不扩大 DEF-17 为任意旧实例修复、一般对账/返工/来源失效或自动恢复。
