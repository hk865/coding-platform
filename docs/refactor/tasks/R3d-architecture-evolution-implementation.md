# R3d：正式目录修订与包含事实实现（Stage2）

2026-09-26：Stage2 及 §4 唯一返修已 STOP，经 Astra 独立 33 项 + types 全部通过，scope audit 无越界/基线漂移；已精确导入唯一变更 catalog-service.ts。本文保留冻结实现契约与返修说明，不是待执行派发。读取 [原冻结设计](R3d-architecture-evolution-skeleton.md) §1–§7 与 §8 中审结论；本任务未增加产品范围。骨架证据 [import](../reviews/evidence/next-b2-2026-09-26/r3d-architecture-evolution-skeleton-import.json)。代码目标 coding-platform/next；本地 DSH 4.1F 新会话在 fresh lane 内实施。

## 1. 唯一可写范围与冻结结果

只写 [两文件 scope](R3d-architecture-evolution-implementation-scope.json)：

- `coding-platform/next/src/core/work-graph/architecture/catalog-service.ts`
- `coding-platform/next/src/core/work-graph/architecture/catalog-record-codecs.ts`

contracts、composition、tests 及所有其他源码只读，不新建文件。骨架声明的 `reviseArchitectureCatalog`、`ModuleContainment` 和 `ArchitectureCatalogRevised@1` 已冻结；旧初始目录行为与唯一 owner 继续复用。若正常链暴露真实契约缺口，报告后 STOP，不扩 scope，不让测试迁就实现。不能写 raw Store 测试 fixture/新测试，不开展异常矩阵。

冻结新组合测试 SHA `b6734731ccaca58218e17626397c53d8dd6e89832f82f8d2a9fce821075ba1d8`。首次修订入口当前 explicit unsupported。原组合用例逐字未改。主审独立固定检查 33 项：32 pass + 新正常链首红；types pass。

## 2. 要完成的正式行为

同一 catalog owner 接通真实链：公开 Project/Workspace 初始化 → 旧三字段 initial catalog → Host 基于该不可变 pin 修订，新增 Module 与显式 parentOf → 新 current/旧 history → 真实 Session 关联新增 Module → 重开同库与原请求 replay。现在实现目录提交算法，不改测试或补全治理框架。

### 输入与原请求

沿现 A1 `ownJsonInput`、Host human/system/scope、signal、Project/Workspace 两 pins、原 schema/decoder、记录 API。首 await 前隔离请求及可信上下文。严格闭合冻结输入 `basedOn/catalog/reason`；reason 非空且最多 2048 UTF-8 bytes。`basedOn` 完整 baseline ref+digest，不接受目标 revision、baseline content、decision/gate 自报。

identity 前缀 `architecture-catalog-revise:` + 原 `commandIdentityKey`，fingerprint 覆盖规范 expected、workspace、basedOn、完整 catalog/reason（包括 containment 缺省与显式空的区别）。先查 identity 原 receipt；原请求重放用原 eventAt 中 ArchitectureRevision/cursor，不能按新 active/source/role 拒绝过去成功，同 identity 不同输入保留 idempotency_conflict。

### fresh 目录修订与一次提交

复用 `readCurrentCatalogWindow` 与当前现有 helpers，不复制目录 owner。不满足 basedOn 当前精确 ref+digest 返回 source_stale；没有 current baseline 为 incomplete；catalog=null 的历史入口明确 unsupported。沿现 Project/Workspace 两 caller pins核正式局部 scope。typed dependencyRules 暂 unsupported，不能默默忽略具体规则或凭自然语言 constraints 创造新 gate。

原 `validateAdoptedArchitecture` 已支持 containment；输入仅需原一次 validator。旧 ModuleRef 集合不减少。本次父修订已声明 containment 时，完整新 catalog 不能漏字段；显式空 parentOf 才能表示改成 flat。父未声明仍可缺省。包含边与依赖边保持独立，不能从 paths/observed 图推断。

新 baseline：同 baselineId、contentRevision=parent.ref.revision+1、row revision=1；content 原样沿用父 description/constraints/sourceBinding 等，用原 architectureBaselineDigest 计算本版本 digest。新 catalog 同一 baseline ref 与 row revision=1。唯一 active pointer 递增它自身 revision。

一个 PreparedCommit 同时写新 baseline/catalog/active、一个 revised event 和 identity。guards 只含 Project/Workspace caller pins、当前 active、父 baseline/catalog 与新版本键缺席；保留现信号与局部 CAS。不要 ledgerHorizon、全工作区 Run 停止、所有 Plan 迁移完成、语义安全证明、全局锁或无限 retry。CAS race 复用现有 bounded identity recovery。

事件 `ArchitectureCatalogRevised@1` 复用骨架 encoder/decoder/schema，包含真实 actor/reason/fromPin/identity/fingerprint/完整本次 revision。回执精确恢复本次 event，cursor 用原 Store committed cursor；取消前零写，正式 commit 成功后如实 reported committed。提交错误结果未知时不声称肯定未写。

不写 Goal/Plan/Task/Run/Session/Role/Link/Material/源码；不检查其当前状态。旧 Plan.effectiveArchitectureBaseline、历史 baseline/catalog、Session 身份保持旧事实。此调用是受信 Host 已授权目录维护，不等于存在完整 ArchitectureChangeDecision/MigrationGate/Policy producer，不给非空 decisionRefs 赋权。

## 3. 固定自检与 STOP

只执行两次固定检查，不为额外完整性另加测试：

1. `python3 tools/dsh-refactor/check.py next-catalog next-catalog-platform`
2. `python3 tools/dsh-refactor/check.py next-types`

应将现 33 项全转绿，types pass。报告改动文件、复用 owner/原回执/当前修订 guard 行为、检查结果与真实限制后 STOP。Astra 随后独立有界复核、audit、精确导入；DSH 不改主区、不更新主 HANDOFF，不继续 UI/R4/E09 后续。

## 4. 唯一中审返修：同 identity 已提交后的 source_stale 恢复

首次实现已经接通正常目录修订；只修 `catalog-service.ts` 内 `reviseArchitectureCatalog` 的下面两个提前返回。其余实现（含 codecs）保持，contracts/composition/tests 继续冻结，无新测试/矩阵。

真实时序：A 和 B 重放同一个原请求；B early lookup 得 not_found，A 成功 commit，然后 B 的 readCurrentCatalogWindow 读到新指针（或读窗口报告 source_stale）。目前 B 的 current 不 ready/source_stale 或 basedOn 比较失败会直接返回 source_stale，绕过已有同 identity 回执恢复。A1 已有 bounded recovery 正是处理这种已提交但先前未查到的窗口。

精确修复：

1. `current.status !== ready` 时仅 `current.code === source_stale` 走已有 `recoverConflictByIdentity(records, identityKey, fingerprint, current, receipt => restoreRevised(...))`；其它实际错误保持现返回。
2. basedOn 与 current 的 ref/digest 不符时，构造原 source_stale fallback，先走同一现有 recovery。identity 真缺席时仍返回 source_stale；已有相同 fingerprint 则返回原 revision/cursor/replayed；不同 fingerprint 仍 idempotency_conflict。

只在这两个 stale 失败路径各增加一次有界原 identity lookup；不循环重试，不重读全系统，不新建 recovery 层，不改正常成功路径及撤销/Role 等无关逻辑。无需新增测试；最后只跑原 `next-catalog next-catalog-platform` 与独立 `next-types`，报告上述两处闭合后 STOP。Astra 将只核这项已发现问题与固定检查，不开启第二轮广泛审阅。

## 5. 独立验收与精确导入

最终固定检查：`next-catalog next-catalog-platform` 33/33 pass（2 files），`next-types` pass。唯一中审问题已按 §4 两个 source_stale 分支复用原 bounded receipt recovery 闭合，无测试扩张。scope 两文件中只有 catalog-service.ts 实际变更；contracts/composition/test 冻结未改，原 hashes 对齐后精确导入单文件。

证据：[`r3d-architecture-evolution-implementation-import.json`](../reviews/evidence/next-b2-2026-09-26/r3d-architecture-evolution-implementation-import.json)。已接通 Host 正式目录修订、显式包含、新 current/旧 history、新 Module 的真实 Session 关联和重开原 replay；页面消费者与治理/模块撤销/迁移仍未由本批交付。
