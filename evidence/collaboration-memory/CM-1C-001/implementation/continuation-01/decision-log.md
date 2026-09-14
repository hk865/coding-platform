# 1C 实施决定

唯一 owner /root。Gate B 已按 R-17 独立通过并结束冻结；输入为 adopted-source-snapshot.json，1270文件 ba2841a9f018b2c3a22cd2d87eb40ae71a06e7eb0ba27e37121b9b24116d1eea。本票开始实施，未冻结、未验收。

- C-D01：保留既有 ArchitectureCandidateProposal/candidate/decision/必要migration/activation权威。人的待决记录负责精确提案版本、固定完整影响集和四结果回执；不能将它当作另一份 baseline active 状态。决定记录、实际生效、逐 Work 采用分别可核对。
- C-D02：报告来源的候选明确引用既有 ArchitectureDecisionBrief，selectedDeltaRef为空；旧机械候选继续只用原 selectedDeltaRef，并保持旧 payload 指纹不变。两类来源必须二选一，Control核对 brief 的项目/Workspace/Plan/source pin/选项；不制造 raw Delta。修改基于精确当前来源生成新候选，旧内容不覆盖。
- C-D03：新的人的决定入口由Host绑定actor；不接受客户端声明delegated或授权策略。当前source、提案版本槽、影响Work集合与正式决定/回流意图在最终Ledger CAS中复核。历史旧领域记录继续可读，不凭旧记录推导本票待决项已经受理。
- C-D04：仍按用户节奏集中实现/审阅/文档/清单，中间仅受影响定向检查。新源码不继承Gate B的PASS；计划修改完成后再冻结集中回归。开工后保留原有无关未提交改动，不commit/push。
- C-D05：候选物化必须在最终提交携带已检查的 ProjectArchitectureBaselineActive 版本；基线在检查后移动，Memory/SQLite 两 adapter 都拒绝且不产生候选。已提交候选重试先由 Ledger 持久身份/摘要判定，后来的基线移动不把原成功变成失败。保留旧提交形状兼容；新 Control 路径固定带守卫。source-selection-02 定向 5 文件/59 用例通过，types-01 无诊断。

- C-D06：ArchitectureReview 是精确待决版本槽，不是新的基线生效状态。pending 可经 modify 指向新提案/候选；accept/reject/defer 后不可变。决定、完整既存 Work 集、既有 ArchitectureChangeDecision 和逐 Work intent 同事务提交；两个 Ledger adapter 在收据查询后、写入前重算完整集合，拒绝遗漏和并发新增。
- C-D07：公开正文由结构化决定、提案完整 normalizedContent、目标集及 actor 确定，并核对 SHA/字节数。自由摘要不能替换实际选择。重试指纹排除尝试时间，保留业务内容；同报告 key 改影响集显式 conflict。
- C-D08：架构投递沿既有 CommunicationIntent/Delivery/Wait/admission/InputBinding/ModelRequestPermit 通道。Delivery、可用时的真实前驱 Wait、intent done 一次提交；无真实前驱/当前参与关系时留明确 unavailable。后继必须携带 canonical wait 固定的完整决定材料，Control 和 final Ledger 均拒绝空集或换料。
- C-D09：查询保留原报告和决定说明，逐 Work 区分送达、等待、绑定、实际尝试和失败。返回前检查事件 frontier；并发变化则有界重读，不用旧 evidence horizon 对新 ended Run 下失败结论。一般投影显式支持 ArchitectureReviewRecorded，避免新事件卡住整个材料授权投影。
- C-D10：Host 人工选择、前驱结束及重启触发既有 drive 的有界推进，不另造状态或永久后台轮询。普通当前规范继续有效；本票接受提案不代替 MigrationGate 或 baseline activation。


## C-D11：显式普通首次派发分配

授权源是已提交的普通 DispatchIntent，位置在唯一 dispatch 收口的 Work 建立后、start 前；确定性注册 Agent 再以 initial-participation-start 建参与，最终事务校验原 Work/Run/outbox。新 Work 的 optional currentParticipationRef 缺省与 null 都表示尚未参与；结束历史保留指针，因此不能再次当首次分配。注册后中断最多留下尚未参与的确定性 Agent，重试复用，无 grant 降级建身份。

## C-D12：独立恢复触发

人的决定、前驱结束和重启都可推进同一持久 intent；不等待另一条长模型执行，不被反馈处理失败阻止。幂等、租约和执行许可负责并发唯一性，失败留日志与读侧事实。推进仍有页/intent 上界，不新增无限轮询。


## C-D13：修改不能刷新旧来源或缩小既定影响

Review 的 open/modify/decide 均核报告 Run 与原始 Finding 的 Workspace revision、Plan、baseline；modify 不得把旧 brief 重新标成当前来源。修改保留已有 Work 的 resume/notify，新增 Work 默认 notify；要重新评估冲突必须提出新的正式报告。定向测试核修改过期与 resume 降级拒绝。

## C-D14：专用探索/审阅不继承普通参与分配

C-ACCEPT-01 经 snap01 全量与独立验收暴露，修复固定于 snap02。Host 仅 exact prepared 且 mode 未设的普通 Run 可首次分配；Leased 不向 special mode 查询协调 grant，Runtime 在任何执行前拒绝 special mode 的协调上下文。普通只读 document-advisor 和 admitted successor 不受 blanket readOnly 限制。新增强塞 grant 及已有参与关系反例，并与原真实探索回归、普通正向链成对验证。修复不削弱原探索断言，旧全量失败保留。
