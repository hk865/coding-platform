# CM-1C-001 只读准备

输入：1A snap-04 与 M06 snap-01 已独立通过；1B snap-01 ba2841a9…d1eea 正在冻结验证。当前不写产品源码，1C 未实施。范围见文档根 CM-1C-001 草案、PLAN §5.8/阶段1C。

memory_seam 的有界只读复审核对了既有架构链：ArchitectureCandidateProposal → candidate → ArchitectureChangeDecision → MigrationGate → BaselineActivation。它主要由模块 API/测试消费，不能当成真实界面已接通。

## 可复用与必须补齐

- `control-engine/architecture-inspection.ts` 记录不可变 proposal，核对 source pin 与摘要，不要求预先失败。
- 进一步核对：report-source inspection/brief 已支持无 raw Delta，但候选契约仍要求 selectedDeltaRef。真实报告来源提出候选时需显式建模 report/option 来源并保持旧候选指纹兼容，不能把报告正文伪称 raw Delta。
- `control-engine/baseline-evolution.ts` materialize 核对当前 baseline；decision 核对静态 candidate/digest；activation 核对 accepted decision、PASS gate、candidate/Workspace/current baseline，并有最终 CAS。
- decision 当前没有 source currentness、版本槽或完整 Work 影响集守卫；materialize 的 active pin 预读没有同事务守卫。1C 要在决定入口拒绝 stale，不能等 activation 才拒绝。
- actor/authority 现有形状校验不等于授权。首版人的入口由 Host 固定 actor，禁止客户端自填 delegated/policy；自动授权分支必须另核当前策略。
- modify 是新 proposal/candidate 及替代关系，不应给原三 outcome 加“修改即接受”的捷径。
- `MigrationGatePort.run()` 目前没有实际检查 provider，返回 unsupported。既有 P1-14 场景直接构造 PASS 只证明静态守卫，不能迁移为真实 Gate 证据。
- BaselineActivationRecorded 仅是记录，不更新正式 active pointer。实际生效仍要 install/activate 正式治理；分步状态、恢复位置、未完成原因必须可见。
- 现有通信 topic 不消费 ArchitectureChangeDecisionRecorded/BaselineActivationRecorded。影响集不能由届时的订阅列表猜测；需要精确 Work ref/revision 与源版本固定，并在正式受理事务形成回流意图。

## 后续实施检查顺序

1. 为精确提案/人类四结果/完整影响集提供窄正式契约和受理守卫；复用旧领域，拒绝用 Goal plan 偷渡 architecture activation。
2. 决定与回流意图原子落账，逐 Work Delivery/当前材料/provider 调用采用；不把一部分成功汇总成全部采用。
3. 接通人类界面和真实跨包冲突生产者；接受只表示决定记录，必要 migration 检查与正式 activation 单独推进。
4. 复用 `tests/coordination/alternative-report-hosts.test.ts` 的 C＋A/B SQLite/Runtime 世界；将两报告 any 改为决定对两个 Work 的完整回流，检查四分支及阶段中断。
5. 迁移正向场景必须提供实际检查/Evidence，再经过既有 Gate，而不是借 `buildP114Gate()` 的固定 PASS。

上述为读码发现和拟实施顺序，不表示接口已稳定、代码已实现或 1C 验收通过。唯一实现 owner 仍为 /root，须在 1B 冻结结束并记录新输入后开工。
