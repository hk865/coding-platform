# 指定语义编排链的源码清理

本轮只整理现有责任与生产入口，没有实现“协调角色实际消费验证 FAIL 并语义调整计划”。保持 12 Module、原依赖方向、Control 权威、正式义务、Reviewer 独立性和精确材料授权。

## 起点、范围与保护

产品 HEAD `65d270d75f3088d7baa4ef3a7c80fdaa62c3a38d`；文档 HEAD `2f9a5df01175fb5686bb8bf02abc65216055a570`。起点工作树与上一轮最终封存摘要完全一致：产品 `204c3b69d793a894c1636ade15f32e2c774134d96d3334ffda61fa119ea123da`，文档 `d1071bd6aca6e65ef7558ef7d2b1e21fc65ff7fd84048a2fa94e8e2d6d400d9b`。两个仓库已有大量未提交改动；本轮以 [baseline.json](baseline.json)、逐文件 SHA256 和两个 `*-status-before.txt` 为基准，不以 Git 默认分支或 HEAD 内容代替起点源码。

全 src 轻量盘点只用于定位，详见 [前后指标](metrics.json) 与 `inventory-before.json`/`inventory-final.json`（AST 导入、直接具名导出及行数；不包含生成 UI/依赖）。范围集中于 contracts、PlanCompiler、ContextCompiler、Dispatch、Verification、相关宿主与消费者导入。未重构 UI、存储实现或双投影，没有修改内核源码。

开始时保存 `processes-before.json`，可见多个 Node/WSL 进程，不能从进程存在推断写入者，也未取得全局锁。中断后与上轮封存一致；迁移失败后的逐文件核对记录在 `migration-preflight*.json`，意外中间修改为 0。唯一子 Agent 只写本目录的独立报告。交付复扫见 `closure.json`；不把复扫等同全局写锁。

未 reset、clean、覆盖 checkout、stash、提交、推送或重装依赖。所有被改写的历史说明和已删除源码保存在 [history](history)，原有失败、计划、Evidence、报告与未完义务保留。测试输出现在使用本轮目录或独立测试输出路径，不再覆盖旧截图。

## 实施变化与消费者证据

| 项目 | 清理前 | 清理后 |
| --- | --- | --- |
| contracts 内 TypeScript 文件（含原支持目录） | 135 | 101 |
| contracts 顶层 TS | 93 | 90 |
| 公共生产契约直接具名导出（不计 barrel 转导出） | 1586 | 1521 |
| 返工编译器 | 单文件 1004 行 | 输入校验/分组 417 行；提案组装 518 行 |
| Verification 服务契约 | 145 行，混有内部构造依赖 | 公共协议 122 行；内部依赖 29 行 |
| Query 授权后投影接线 | 两份相同回调组装 | 一份 query-composition，两宿主消费 |

这些数字描述源码位置，不表示业务规则被删除。详细路径和消费者在 [migrations.json](migrations.json)、[宿主支持迁移](host-support-migration.json)、[逐文件变化](changes.json)。大多数变更文件只是必要的导入路径调整；不按文件数量或行数重新划分领域。

- **20 个纯测试支持文件**移到 `tests/contract-support`：16 个场景构造器、4 个替身。先从所有实际生产消费者沿支持文件依赖递归核对，避免把间接生产依赖误移入 tests。
- **8 个真实宿主支持文件**移到 `src/fixtures`（6）和 `src/testing`（2）。app/harness、FakeRuntime、FakeWorkspaceReader 的原默认数据与依赖保持；原 Fixtures/TestDoubles 非 Module 归属保留，边界白名单完全未变。生产源码没有导入 tests。
- **StateLedger 内部校验**从 `contracts/ledger-validation.ts` 移到 `data/state-ledger/ledger-validation.ts`；只有两个账本适配器及测试消费。只改变归属路径，不调整事件、快照、事务、幂等或 CAS 规则。
- **Verification 内部依赖** `VerificationControlPort`、`RecordedVerificationDeps`、`VerificationServiceDeps` 回到 `verification-deps.ts`。报告记录、公开生命周期、跨模块使用的 RecordedVerificationPort 等继续留在公共契约。
- **PlanningTaskWorkMaterial**并入 `contracts/planning.ts`，因为协调材料与返工输入共同消费其 resolved/absent/unavailable 协议；没有误当作单模块内部类型。
- **删除无消费者项**：公共根、fixture、testing 三个 barrel；已无消费者的 QueryJobContextStub 施工替身；零消费者的 createVerificationEngine 纯转发工厂。真实 QueryContextCompilerImpl 与 VerificationEngineImpl 均保留，createDispatchEngine 有测试消费者因此保留。搜索覆盖本仓与相邻 coding-agent 源码；历史清单引用只作为历史保留。
- **返工职责拆分**：ReworkPlanCompiler 仍是同步纯输入校验/去重/分组入口；rework-proposal 只组装任务指令、影响与草稿。任务、义务和 DAG 的共享规则仍调用 Control 原政策，未新增 helper 权威。独立复核确认原 26 个函数/方法执行体词法一致。
- **组合根**：query-composition 只把成功授权后的投影推进与 Dispatch 接起来。内存宿主仍每次创建 QueryDrive，SQLite 宿主仍每个实例持有一个驱动。rework-composition 仍先取得 Verification 问题材料再传 Dispatch，没有引入 Dispatch→Verification 回调。app/service.ts 的 continueEndedRun 保留原生产实现，终态与启动扫描共用它。
- **当前说明**：处理指定链条中过时的 FROZEN/lane/Ticket 指令、已移动路径及重复施工历史；更新错误的“只有 owner 可读”“真实工具未来再接”“规划/查询仍是 stub”等说明。有效不变量和缺能力说明保留。孤立注释、旧校验器路径和迁移后的残片经独立复核补齐。

## 兼容性与保留实现

[compatibility.json](compatibility.json) 对 103 个原契约文件及迁移目的地的 1640 个非导入声明做去注释 AST 对照，差异为 0（明确排除上述 3 项内部构造依赖，规范化 inline type-import 路径）。这支持类型/算法未改的结论，不能替代持久重开与 HTTP 运行验收。未修改 HTTP 路由、命令/事件名、schemaVersion、JSON 字段、计划/Evidence 身份生成或数据库迁移。

包为 private，没有 exports 发布入口；仓内和已知相邻源码没有被删 barrel/stub 的消费者。**不承诺未知外部 deep-import 调用仍可使用被移除的源码路径**；本轮没有用无消费者转导出长期保留第二套入口。持久记录和 HTTP 协议兼容与源码路径兼容分开判断。

必须保留的路径：

| 实现 | 真实用途与兼容对象 | 可移除条件 |
| --- | --- | --- |
| CommandCheckLifecycle.legacyFingerprintMatches | 重开旧单检查 journal，按原 root/name/可选 bindingDigest 精确复算指纹；不能冒充新的 round 子检查 | 旧记录完成显式迁移且不存在旧来源消费者之前保留；不得删除历史记录代替迁移 |
| revisionAssignments 旧可选来源形状、任务可选 replacement 字段 | 已接受旧 PlanRevision 的读取；无新角色/权限推断 | 全部已存旧计划有兼容读取方案并验证后才可删除 |
| QueryDrive 对旧 pending job 的 runRef=null 恢复 | 从既有事件恢复正式 QueryJob，仍 CAS 后才启动 | 旧任务全部处置并验证重开之后才评估；不取消仍有效未完工作 |
| VerificationEngine/Service、RecordedVerification 与正式 Reviewer 路径 | 工具检查、外部 benchmark/操作者审阅、独立模型审阅具有不同资格和 journal | 不是重复实现，本轮不合并身份或证据规则 |
| FakeRuntime、FakeWorkspaceReader、显式能力缺失 adapter 和宿主默认样例 | 已登记的测试、隔离演示与宿主注入行为 | 先迁移真实消费者；缺真实能力不能悄悄返回假成功 |
| 两个 Ledger/ReadModel adapter | 隔离内存和 SQLite 重开场景 | 存储/投影重构不在此委托内 |

## 验证与真实失败

工具链沿用最近交付：WSL Node 24.18、`.local/linux-test-tools`、`.local/def17-bin`、已安装 Chromium 1234、既有 bwrap；完整参数见 [check.sh](check.sh)。未重装依赖。

| 检查 | 实际结果与日志 |
| --- | --- |
| 直接相关行为 | 7 文件 79 项 PASS，targeted-2.log（不存在的 semantic-loop 文件过滤项没有被计为执行；真实 semantic-collaboration 用例在全仓及浏览器执行） |
| 最终后端/测试类型 | backend-types-final.log，exit 0 |
| 最终前端严格类型 | ui-types-final.log，exit 0 |
| 最终模块边界 | boundaries-final.json，issues=[]；仍 12 Module |
| 全仓行为 | 首轮及最终均 299 文件/1951 项 PASS；full-tests.log、full-tests-final.log |
| 完整构建及真实浏览器 | build.log exit 0；browser.log 26 项 PASS，真实 HTTP/SQLite/内核/工具及显式模型替身；最终 ui-artifacts.log exit 0，干净构建、旧资源替换、真实服务字节一致、单次构建生效全部通过 |
| 构建残留 | 构建前检测 34 个旧路径 JS，build-artifacts-before.json；逐个核对 SHA、保存原文并删除生成文件，未删除用户数据；最终检查 323 个非 UI JS，stale=[]（build-artifacts-final.log） |
| 文档 | 首轮 docs.log 12/13，发现迁移后历史报告链接失效；仅同步链接并保存旧原文，docs-final.log 13/13 PASS。修改的 9 个产品说明文件另查 104 个本地链接，全部有效（source-docs.log） |
| 独立复核 | [报告](independent-review.md)；26/26 返工函数体一致、宿主生命周期/时序一致、8 支持文件主体一致；发现的当前性遗漏已修复，无已知行为阻断 |

真实失败逐次保留，不用 PASS 覆盖：

1. Windows 文件直接写入 UNKNOWN、WSL EINVAL：环境文件写入问题；部分迁移后用原文/预期内容逐文件核对，没有意外中间改动，改为同目录校验后原子替换完成。日志见 environment-failures.txt、imports-resume.log、migration-preflight*.json。
2. WSL 首次 E_ACCESSDENIED、Windows TypeScript 入口不存在、跨 shell PATH 未传入：工具环境问题；使用已安装的正确入口和固定脚本解决，不重装。targeted-1.log 的 node not found 是未启动测试，不是测试 PASS。
3. typecheck-1.log 的旧 QueryJobDriveEngineImpl 类型名未更新：本次结构迁移遗漏，改为 composeQueryDrive 的返回类型后通过，未放宽类型检查。
4. 构建前旧路径残留属于本次文件迁移产生的构建结构问题；原残留清单及摘要保存，定点清除后重新构建检查。
5. docs.log 的 12/13：校验器迁移后，一个既有 Reviewer 历史报告仍指旧源码路径。属于文档迁移遗漏，只改链接、不改历史结论，原报告保存到 history/docs，复验 13/13。
6. 盘点汇总的一次临时 node -e 括号错误属于证据脚本错误，修正为 summarize.mjs；没有修改产品以绕过失败。独立复核的读路径/TypeScript 入口失败保存在其报告。

自动审批曾拒绝部分失败后直接重跑整批迁移；只读核对证明中间状态一致后，缩小为不删除文件的导入迁移获准。另拒绝可选 EndedRunFollowup 提取，担心改动执行语义；已放弃，候选原文只留本目录，service.ts 未接入该类。没有绕过拒绝执行该可选重构，也没有因它扩展产品能力。

构建验证临时修改 src/ui/src/format.ts 后已逐字恢复；与起点 SHA256 一致，见 ui-probe-restoration.json。初次全仓执行时旧夹具仅追加一个时间戳 JSON 到上一目录（没有覆盖旧文件）；最终全仓及浏览器的记录全部进入本目录。测试/源码比对的补充读取和工具失败摘录见 tool-failure-excerpts.txt。

独立复核的 4 类原发现、后续 6 处旧路径注释均已关闭；最后附带提醒的 src/testing/check-providers.double.ts 未来工具说明也已改为明确的确定性替身。最后变更均为注释，不改变已比对执行体；未再扩大独立审查范围。

## 下一步实现协调角色消费 FAIL 并调整计划

| 检查题 | 当前真实入口与缺口 |
| --- | --- |
| 失败材料从哪里进入 | 工具结果进入 VerificationRounds/CommandCheckLifecycle，原报告进入 Vault/journal；VerificationService.openIssues 输出带来源问题，组合根交给 Dispatch ReworkDrive |
| 协调角色在哪里实际消费 | ExecutionFeedbackContext 读取已结束 Run 的公开 execution_feedback，ExecutionFeedbackCompiler 提交 execution_coordination Query；QueryDrive→QueryExecutionContext→ReadOnlyQueryRuntime 承载实际只读调查。它目前消费执行者反馈，**不会自动把工具 FAIL 原报告作为新的语义协调输入** |
| 带来源补料怎样回到运行 | FeedbackMaterialCompiler 核对回答、真实 read 见证、来源及精确授权；WorkMaterialDrive 与 WorkRunMaterialCompiler 将材料送入后继 Run 的 Context/manifest |
| 调整提案从哪里提交 | 已有机械路径是 ReworkPlanCompiler.compile→ReworkDrive.control.acceptReworkProposal；PlanCompiler 另有初始和目标变更提案。协调 Query 的 feedback_resolution 还没有编译为正式语义计划调整的消费者 |
| Control 在哪里受理 | ControlEngine.acceptReworkProposal→AutonomousRework.acceptReworkProposal，复核边界后沿 recordPlanChangeProposal→recordUserDecision→applyPlanChange；Control 保有权限、预算、canonical revision、义务及 DAG 守卫 |
| 执行、重验、Reviewer、归约与展示 | accepted PlanRevision 经原派发运行；service.continueEndedRun 调用 reverifyRework/prepareReworkReview，必要 Reviewer 走 ReviewerDispatch；Evidence 接纳和 Task/Goal 归约属 Control，ReadModel/UI 展示报告、来源与回执 |
| 仍未实现 | 工具 FAIL→协调角色实际解读→有来源的语义调整提案→正式受理的连接；过期调查替代、人的决定完整回流、多失败/checkpoint 恢复、同一返工任务必要重审联合验收仍需下一项开发/验证。不能把已有接口或机械返工报告为语义编排完成 |

## 保留的维护债与停止点

contracts/validation.ts 仍有约 3510 行，公共领域校验进一步拆分需要按消费者和规则单一权威处理；没有为了减少文件数造大 barrel 或通用协议。ReadModel 双实现和大存储文件未重写。app/service.ts 仍较大，终态/启动共享 continueEndedRun 可作为下一项的明确入口，异常等待原因的统一持久展示仍缺。指定链之外仍有旧阶段注释，未把本轮扩展为全源码历史重写。

唯一当前状态在 human/module-status.md；交接只保存本轮结果与入口。历史详细原文、失败、消费者、审查和源码身份集中于此目录。完成上述有限整理后停止，不启动下一项语义编排或其他架构工程。

交付源码身份以 final.json、changes.json、closure.json 为准，完成封存后补充摘要。

最终封存：产品 000671b61a400e86846c0115bfd8230e5d1a6a1285cfed5361a65ae1ce8cc957（1403 文件），文档 8006eff0987151068691f7cc3a4104aed6f5f945473d70be7363d18bc2945bc7（487 文件）。相对起点产品 353 路径、文档 6 路径变化（包含新增/删除/搬移两端及导入调整）；两个 HEAD 不变。详细身份见 final.json；原文件保护复核见 preservation.json。
