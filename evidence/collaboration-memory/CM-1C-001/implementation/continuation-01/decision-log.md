# 1C 实施决定

唯一 owner /root。Gate B 已按 R-17 独立通过并结束冻结；输入为 adopted-source-snapshot.json，1270文件 ba2841a9f018b2c3a22cd2d87eb40ae71a06e7eb0ba27e37121b9b24116d1eea。本票开始实施，未冻结、未验收。

- C-D01：保留既有 ArchitectureCandidateProposal/candidate/decision/必要migration/activation权威。人的待决记录负责精确提案版本、固定完整影响集和四结果回执；不能将它当作另一份 baseline active 状态。决定记录、实际生效、逐 Work 采用分别可核对。
- C-D02：报告来源的候选明确引用既有 ArchitectureDecisionBrief，selectedDeltaRef为空；旧机械候选继续只用原 selectedDeltaRef，并保持旧 payload 指纹不变。两类来源必须二选一，Control核对 brief 的项目/Workspace/Plan/source pin/选项；不制造 raw Delta。修改基于精确当前来源生成新候选，旧内容不覆盖。
- C-D03：新的人的决定入口由Host绑定actor；不接受客户端声明delegated或授权策略。当前source、提案版本槽、影响Work集合与正式决定/回流意图在最终Ledger CAS中复核。历史旧领域记录继续可读，不凭旧记录推导本票待决项已经受理。
- C-D04：仍按用户节奏集中实现/审阅/文档/清单，中间仅受影响定向检查。新源码不继承Gate B的PASS；计划修改完成后再冻结集中回归。开工后保留原有无关未提交改动，不commit/push。
- C-D05：候选物化必须在最终提交携带已检查的 ProjectArchitectureBaselineActive 版本；基线在检查后移动，Memory/SQLite 两 adapter 都拒绝且不产生候选。已提交候选重试先由 Ledger 持久身份/摘要判定，后来的基线移动不把原成功变成失败。保留旧提交形状兼容；新 Control 路径固定带守卫。source-selection-02 定向 5 文件/59 用例通过，types-01 无诊断。
