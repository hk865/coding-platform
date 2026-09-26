# R3e.1 注册检查执行：骨架与最终行为测试派发

状态：2026-09-26，执行本第一阶段。主审已导入并冻结 R4.1 的 controls 组合接线、预建10新文件并登记 next-evidence；从该当前工作树创建隔离 lane，唯一写范围见 `R3e-completion-skeleton-scope.json`，恰为 **11 个生产文件、4 个测试文件**。首轮交付骨架与最终行为测试后立即 STOP，由 Astra 中审冻结后另派实现。

设计唯一依据为 [R3e 主任务](R3e-completion-skeleton.md) §4–5、§8；§1–3 是目标和分批边界，§6–7 的 Task/Gate/Goal 完成不在本轮。先读 docs/AGENTS.md、当前 HANDOFF、IMPLEMENTED-CAPABILITIES、CODE-QUALITY-GUIDELINES §2.1、DSH-WORKFLOW 与 DSH-EXECUTION-HARNESS，并沿主任务引用核对真实源码。这里只收敛派工条件，不复制整套设计。

## 已核实接点与准备条件

真实 ProcessSandbox 在当前宿主和 harness 外层 bubblewrap 内均已执行 canary、退出 0 并清理，见[直接预检](../reviews/evidence/next-b2-2026-09-26/r3e-process-sandbox-preflight.json)和[嵌套预检](../reviews/evidence/next-b2-2026-09-26/r3e-process-sandbox-nested-preflight.json)。这是环境前置通过，不是 R3e 业务验收；正式 fresh 调用仍使用当时实际 probe。不可 fallback 到宿主 shell，不得 skip 成功用例后声称闭环通过。

源码路径均相对 `coding-platform/next/`：

- `src/core/work-graph/tasks/execution-read-contracts.ts` 的 `ExecutionReadPort.readExecution` 与组合根既有 `executionReader` 提供正式 Run/Attempt/Plan/Session 关联。真实已结束 subject Run 是被检查对象，当前 Session/Lease 可以已释放；它不成为机械进程作者，不再 claim 或重走 B2 模型准入。
- `src/core/work-graph/tasks/plan-readers.ts` 已公开 `readPinnedCompletionPolicy(records, pin)`，返回同一固定 pin 的正文、digest 和局部 guards。直接复用，不复制 validator，不用 Project 当前 active pointer 代替 adopted Plan pin；只有现有 architecture digest 确需复用时才窄导出它。
- `src/core/work-graph/materials/contracts.ts` 的 `MaterialPort`、`MaterialReadFactsPort.openArtifactFacts` 已可完成 body-first 和 historical_explanation 读回；组合根复用现有 `rawMaterials/materialFacts/backend.records`。报告沿实际 Host 的 platform_operation，source.actor 为该 Host、source.runRef=null，subjectRunRef 留在报告中；不借 subject Run 写材料或给调用者合成 grant。
- `src/core/workspace/verification-workspace-reader.ts` 的 `VerificationWorkspaceReader.capture(root)` 是真实完整候选源码来源；无 signal/close 方法。调用前后检查原 signal，保持 CandidateWorkspaceReader 原 source set，不用 allowsRead 子集或 process deniedPrefixes 重定义 digest。
- `src/core/workspace/access.ts` 已有 `WorkspaceHostBindings.resolveRoot/authorize`；固定 checks 配置声明实际完整 source/process 授权，仍核真实根与 permissionRevision。不能从 allowsRead 推导 shell 权限。
- `vendor/coding-agent/dist/public-api.js` 已公开 WorkspaceSandbox/ProcessSandbox。真实执行复用 create → probe → execute，固定输出上限和 effects 规则见主任务 §4.1/4.4/4.5；不改 Kernel、不建新 capture/provider。两个类都无 close/release，根句柄由 ProcessSandbox 内部负责关闭。
- 组合根已有唯一 Store、Material、执行 reader 与 trackedCall/close。按现构建顺序在这些实例存在后创建一份 Evidence service，再创建仅依赖该 EvidencePort 的薄 runner，公开 `platform.evidence` 和 `platform.checks.runRegisteredCheck`，纳入原关闭排空；不创建第二结果库或通用执行管理器。checks 配置缺省保留历史读取/回执，新 open/begin 明确 unsupported。

## 唯一生产范围与必要预建清单

下表每一行都是一个文件；“新建”共 6 个，主审预建后才进入隔离写白名单。本轮不自行创建 scope/manifest 或额外同级文件。

| 精确路径 | 核对结果 | 本轮允许职责 |
| --- | --- | --- |
| `src/contracts/evidence.ts` | 已存在，已有 EvidenceRef/TaskEvidenceIndexRef/anchor | 恢复本批实际消费的 Evidence/index/coverage DTO |
| `src/contracts/verification.ts` | 已存在，已有 material identity/change scope | 补主任务 §4 的有界 round/check/configuration DTO 与必要 VerificationPlan |
| `src/contracts/ledger.ts` | 已存在，已有 Evidence/Index AggregateRef | 仅补 VerificationRoundRef 联合成员 |
| `src/core/work-graph/evidence/contracts.ts` | 新建 | EvidencePort、确切依赖和 factory 签名 |
| `src/core/work-graph/evidence/evidence-service.ts` | 新建 | 原六个公开方法的明确骨架 |
| `src/core/work-graph/evidence/evidence-record-codecs.ts` | 新建 | 新 round/Evidence/index/event 的签名和 schema 集合骨架 |
| `src/core/work-graph/evidence/verification-plan.ts` | 新建 | 旧纯 compiler 所需输入输出签名与显式占位 |
| `src/core/work-graph/evidence/coverage.ts` | 新建 | 覆盖/适用性和 W1 basis 复用的纯函数签名与显式占位 |
| `src/core/work-graph/tasks/plan-readers.ts` | 已存在 | 仅在需要时窄导出 architectureBaselineDigest；政策 reader 与旧业务不改 |
| `src/core/agent-runtime/check-execution.ts` | 新建 | 主任务 §4.4 薄 Host runner 的 factory/公开签名与 unsupported |
| `src/composition/create-platform.ts` | 已存在 | 可选可信 checks 配置、单实例服务/runner/schema 装配和原 trackedCall/close 接线 |

阶段一不得提前实现生产业务：新 service/runner 返回明确 unsupported；纯算法和新 encoder 明确抛 unsupported，新 decoder 不得假 decoded，schema 骨架不能接受任意 JSON。新 schema 集合可空占位并明确其未实现状态，不重复注册已有 Evidence/Index 或 TaskReduction owner；当前源码尚无 R3e Evidence/Index schema owner，TaskReduction 已由原 Plan reader 所有。旧路径不得被新占位拦截成 unsupported。组合根仅装配上述骨架，不启动进程/后台循环。旧工程只提供纯规则参考，不反向 import 旧 VerificationEngine、Journal 或服务；超出范围的必要 type dependency 先报精确缺口。

除表内文件，B2/W2/M1/M2/C2、Workspace、Kernel、共享 fixture、检查脚本及文档全部只读。原地写入，不用同级临时 rename，不安装依赖。DSH 状态目录复用现行 `profiles/sessions/storages/cache/llm-deepseek/attachments`，不扩生产写范围。

## 四个测试文件与诚实首红

以下 4 文件当前均不存在，需主审预建；前三个是 Vitest 入口，最后一个仅为 helper：

1. `tests/work-graph/R3e-evidence.test.ts`
2. `tests/work-graph/R3e-evidence-coverage.test.ts`
3. `tests/composition/R3e-command-check-platform.test.ts`
4. `tests/helpers/R3e-evidence-fixture.ts`

测试覆盖严格沿主任务 §8 的六组领域与两组组合场景，不扩全矩阵。新 helper 复用 `tests/helpers/task-claim-fixture.ts` 的 `createTaskClaimFixture(kind, additionalSchemas)`、真实 body/backend；真实已结束 subject 复用 B2 公开 claim/prepare/start/terminal 路径或既有领域 writer，不直接 seed Run 终态、轮次/Evidence/PASS/TaskReduction。领域 observation 输入可用来验证 WG 规则，但不能替代组合测试真实 ProcessSandbox stdout/exit/effects。

特别保留两个边界：

- fresh open/begin 核当前固定 grant/source；原 ticket 的真实 record 及同 identity/fingerprint receipt 按主任务 §4.5 保存和恢复，不因为后来的权限/源码变化丢失已执行事实。变化只能明确 sourceStatus/gap/INCONCLUSIVE；执行中/未知没有结果不能自动重跑，也不能捏造 not_started。普通历史读取不套新执行许可全链，不增加 Role 热切换场景。
- begin replay/executing/finished/interrupted 只观察持久窗口，不重新 probe/execute；record 与 finalize 用同一 Round CAS，executing/未知不被提前 finalized。真实退出 0 也不等于 Task 完成；成功命令用 stdout 留痕，避免为计数写候选源码触发正确的 source_stale。计数包装必须转发真实执行。

断言写最终行为，不断言 unsupported 为成功、不 catch 后 return、不软断言同时要求 unsupported 与 committed。所有必要公开前态应明确成功；首个新入口 unsupported 就是该 case 当前首红，后段 CAS、重开、排空、进程计数等均逐项记“未到达”，不得宣称已覆盖。门闩要与操作首个结果竞争，骨架早退也能解除/排空，不能靠超时隐藏坏前置。注册为空导致某些 codec 后段不可达亦须如实报告。

## 检查登记、并行与停止

主审已登记 `next-evidence` selector，工作目录 NEXT，参数精确为：

```text
../node_modules/vitest/vitest.mjs run
  tests/work-graph/R3e-evidence.test.ts
  tests/work-graph/R3e-evidence-coverage.test.ts
  tests/composition/R3e-command-check-platform.test.ts
```

helper 不登记为测试入口，但由 next-types 一并编译。相邻复用现有 `next-plan next-future-intent next-b2-composition next-execution-state`；`next-types`、`next-architecture` 分别运行。主审登记后 DSH 只能调用固定检查，不改 selector、不跑全量。检查结果报告首红实际位置/code、旧邻接是否保持，以及真实 sandbox 环境失败和业务 unsupported 的区别。

并行核对结论：

- [R2e.2 Git scope](R2e-2-git-read-compare-skeleton-scope.json) 六生产/两测试与本批没有写文件交集。它会改 `WorkspaceHostBindings` 所在 access.ts 的实现接缝；本批只读该既有 Host contract、直接使用原 VerificationWorkspaceReader 和 Kernel ProcessSandbox，不消费新 gitRead/gitCompare，不依赖 Git 骨架变绿。
- [R4.1 scope](R4-control-intent-skeleton-scope.json) 与本批共享 `src/composition/create-platform.ts`。本次核对时 main 尚无 controls 装配，因此不能用这个旧快照覆盖其 lane 接线；必须先由主审导入/冻结 R4.1 组合根再创建 R3e 快照。其[实现阶段](R4-control-intent-implementation.md)只写 control-service/control-record-codecs/execution-entry-service，与本批 11 生产文件无交集；组合根一旦冻结，可并行实现。R3e 不把控制意图当物理停止，不改 R4.1 门禁。

结论：接口/真实 provider 与环境前置足够派第一批骨架，无需新增架构层；这些派发前置已完成；实际 lane 以主审派发为准。

交付 15 文件最终 hash、types/邻接结果、每项首红与尚未到达部分后立即 STOP。禁止自行进入生产实现；中审冻结后下一阶段测试转只读。R3e.2 的 readonly witness/reviewer 和 R3e.3 的 Task/Gate/Goal 完成、Query、Workflow/Host UI 均不得据本轮扩大范围或声明已交付。
