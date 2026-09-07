# P1-13 共享基线计划（2026-09-07，供后续窗口实施）

> 状态：**计划草案**（P1-11 lanes 实施中）。本文档仅记录评估结论与基线清单；
> 正式冻结语义将写入产品根 IMPLEMENTATION-HANDOFF.md 的 P1-13 段（在 P1-11 验收后开工时）。

## 1. 范围（ticket 13-allowlisted-remediation.md）

首次消费 ArchitectureEvolutionPolicy：显式版本化 local fixture → install（immutable revision，不自动激活）→
activation（CAS 建 Project active ref）→ 通过 canonical active ref 解析 digest/revision 匹配的 policy；
只有命中 allowlist（kind/scope/risk/reversibility/policy revision/drift budget）的 P1-12 ArchitectureFinding
才生成绑定（finding + workspace + evolution policy + Plan baseline pin + CompletionPolicy pin）的
RemediationPlanPatch → 经普通 Control/Scheduler/唯一 Writer（P1-07 lease）/Verification 链形成 RemediationTask；
ArchitectureBaseline active ref 在整个票中保持不变；FAIL/BLOCKED/outcome_unknown 保留原 Finding 与历史 Evidence。

## 2. 关键架构发现（2026-09-07 评估）

- **governance 已泛化**：P1-02 的 `governance-install`/`governance-activate` commitKind 是**一个 commitKind 承载两类**
  （CompletionPolicy | ArchitectureBaseline，经 commandType 区分；见 src/contracts/ledger.ts 284-296 与
  governance.ts 的 `GovernanceInstallCommand`/`GovernanceActivateCommand` union）。
  ⇒ P1-13 第三类（ArchitectureEvolutionPolicy）**优先走同一 commitKind 的 union 扩展**（新事件类型
  ArchitectureEvolutionPolicyInstalled/Activated + 新 snapshot 类型 + 校验器分支），而不是新增 commitKind；
  除非审计发现 union 扩展破坏既有形状（需先派 C 复核）。这决定 P1-13 基线工作量（中等，模式化）。
- **复用链**：Writer = P1-07 workspace write lease 路径（recordPatch 同款）；Verification = P1-04/08 既有引擎；
  去重 = 确定性 dedup key（finding/policy/workspace revision 三元组 CAS@0）；
  RemediationTask 经 Control guard 创建（ArchitectureReconciler 不能直接写 Task state）。
- **零改动边界**：P1-02 pin 不动（Plan baseline pin 与 CompletionPolicy pin 只被引用）；
  P1-12 的 finding/brief/proposal 聚合零修改（只被消费）。

## 3. 共享基线构建清单（integrator）

1. contracts（新文件 src/contracts/architecture-evolution-policy.ts 或并入 governance.ts 版本化追加）：
   VersionedArchitectureEvolutionPolicyFixture / ArchitectureEvolutionPolicyContentV1 /
   ArchitectureEvolutionPolicyRevisionSnapshot / ProjectArchitectureEvolutionPolicyActiveRef(+Snapshot) /
   Install/Activate 命令+回执 / 2 事件 / digest+fingerprint / resolve 只读 helper；
2. remediation contracts：RemediationPlanPatch / RemediationTask / RemediationDeduplicationKey /
   RemediationPlanPatchRecorded(TaskCreated?) 事件 / 命令+回执 / 上限常量 / dedup 纯函数；
3. ledger-validation：install/activate 第三类分支 + remediation 新 commitKind 校验器；
4. fixtures：architecture-evolution-policy-fixtures.ts（本地 fixture + pins + buildInstall/Activate/Remediation*）+ 共享 fold 构建器；
5. ControlEngine +3（installArchitectureEvolutionPolicy/activateArchitectureEvolutionPolicy/acceptRemediationPlanPatch? 具体入口名以票为准）
   + ReadModelIndex.architectureEvolutionView / remediationView（stub 区域）；
6. harness 接线 + P1_13TestHarness/FACTORY + defineArchitectureEvolutionContractSuite（验收+9 组 verification 命名照票）
   + restart 骨架 + integration 接线；
7. 三路并行建议：A=install/activate/resolution（control）；B=remediation patch/task/dedup（control）；
   C=read-model 双适配器 + view；合并后 integrator 执行 Writer/Verification 集成链与重启等价。

## 4. 主要风险

- governance union 扩展的兼容性（需对既有 22/23 测试零回归）；
- RemediationTask 经 P1-04/05 归约链的状态语义（task 归约与 remediation 状态机衔接）；
- Writer 链真实 SQLite 路径 + 重启等价（evidence 保持）。
