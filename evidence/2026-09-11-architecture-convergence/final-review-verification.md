# AC-VE-READ / AC-REVERIFY / AC-DISPATCH-VE 独立复核

复核者未参与这三个修复的实现。依据用户已明确选择“保持依赖图，通过组合根传问题材料”，以及已接受决定与 PRODUCT 状态真实性、证据驱动完成和连续执行要求。只读实现，另新增独立反例 tests/control/rework-unknown-disposition-review.test.ts；未改被审实现，未运行测试。

## 责任与真实接线

1. `harness/rework-composition.ts` 的 composeReworkDrive 在调用 Dispatch 前从 Verification 取得 issueMaterials。Dispatch 内部没有保存可回调 Verification 的问题读取端口，而是消费请求值；每个返工分组处理前经 ReworkDispositionPort 读取最新 Control 解释。因此不是借 DI 隐藏 Dispatch→Verification 依赖。service 的真实 VerificationService.openIssues 已接此组合，harness 同路；问题来源不可用不自动造空问题材料。
2. `ControlReworkDisposition` 读取 Goal activePlan/Workspace、TaskEvidenceIndex 与 Evidence，并直接复用 `buildCurrentEffectivityAnchor`、`qualifyReviewEvidence`、`selectEffectiveEvidenceSet`。它没有另写一份PASS判据，也不使用 journal 轮次PASS直接解除义务；无索引、缺证据、错误subject或版本读取变化不能据此生成 disposed_by_reverification。完整失败要求逐项检查，不由一个PASS解除整条多要求问题。
3. VerificationOpenIssues 仍拥有检查轮次/审阅journal解释与原报告缺口；currentness/义务承担者/重验处置交Control。历史问题没有因planRef变旧被删除；carried_by_task与disposed_by_rework分开，Dispatch逐任务分组、每组重读Control事实，上一组换版不会天然跳过其他失败义务。
4. `RunOutputFacts` 位于Context，以事件发现材料后读取 canonical 正文引用并核对run/project/workspace/task/plan归因，提供只读见证；VE保留ROLE_OUTPUT_WITNESS表与声明性requiredOutputs解释。轮次通过已有context.runOutputWitness消费，没有VE直接扫描Ledger的新旁路。ReviewWork/PatchRecord/IntegrationResult/ExecutionNote继续各有原权威记录路径，读取不足明确unavailable。
5. 真实轮次冻结时保存roleOutputs审计，既有检查结论决定outcome，正式Evidence经Control接纳后请求归约。requiredOutputs缺项仍不进gaps、不降级结论、不扣留归约，与用户接受的声明性预期一致。本轮没有重新增加角色门禁，也没有扩大历史授权或验收语义。

## 独立发现与处置要求

| 发现 | 影响 | 要求/证据 |
| --- | --- | --- |
| ReworkDrive.run 的 planned.length===0 分支将全部unknown问题也概括成“都已经处置”，虽然dispositions仍有unknown | 正式失败义务实际未确认，却向用户发出完成式说明；违反真实性，不能用结构化字段存在掩盖主文案错误 | 已即时通知主Agent；新增独立反例禁止该文案、保留unknown、零自动受理。需修复后由主实际运行，当前复核不自称关闭 |
| ControlReworkDisposition.withCurrentness 第二个 reverifiedOn 跨plan分支已被前一个无条件判断覆盖 | 无运行行为差异，但重复不可达路径保留两套解释文案，使审阅者误以为有两个判据 | 已建议主删除不可达分支；属于本次可读性收口，不要求新产品决定 |

局限：问题材料是每次外部请求捕获的快照，本次驱动中新增的另一次失败依赖下一次外部触发；现有产品在验证/审阅完成后触发，不能宣称后台永久监听。Control解释当前性不构成授权决定，受理仍由acceptReworkProposal复核并落账。Run输出读取表是声明性审计，不代表拥有全部报告正文或真正完成输出验证。未将测试源码当实际PASS，最终需主验证日志与最终源码身份。

可读性结论：新增文件按“返工处置政策”“运行产出材料”“组合接线”划分，有真实消费者，没有第13模块或无消费者框架。仍有部分旧RC/RW注释称Verification为处置权威，主文档/注释应更新成Control；避免历史施工措辞与现责任冲突。状态结论应在上述unknown主文案反例修复验证后再最终确认。
