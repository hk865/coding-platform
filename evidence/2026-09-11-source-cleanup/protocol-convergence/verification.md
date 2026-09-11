# 有消费者的协议与入口收敛

本记录继续原 source-cleanup 委托，处理上轮没有做充分的重复协议和纯转发入口。前轮 export-pruning、contracts-followup 及其历史失败全部保留；本文件是有界证据，不是另一份长期当前状态。

## 删除、迁移及真实消费者

| 原重复面 | 实际处理与消费者 |
| --- | --- |
| PlanProposalPort 与 PlanCompilerPort 的 amendment request | 删除 PlanProposalPort；HumanCollaboration、内存/持久宿主使用 Pick<PlanCompilerPort, 'request'>。初始协调用 requestInitial，app/initial-planning.ts、规划与 Query 执行测试迁移；普通 amendment-only 注入无需实现初始协调。源码旧初始 request 调用必须迁移，未留下同名兼容转发。 |
| 提案结果在契约、PlanCompiler实现、两宿主、测试宿主重复 | PlanProposalResult 在 contracts/planning.ts 定义一次。实现引用它，宿主直接提供模块对象，测试通过实际 request 验证零写入。 |
| PlanningContextPort 内联协议与实现的三份命名类型 | 端口、请求、结果及拒绝码收口到 planning.ts；删除 goal-change.ts 中的旧端口定义和实现中的重复类型体。PlanningContextCompilerImpl 直接实现；范围、预算、来源与拒绝映射不变。 |
| ReworkPlanDraftV1 重复计划字段 | 删除该独立定义和编译器消费名称，ReworkProposalV1.planDraft 由 PlanRevisionDraft 字段派生。9个字段仍必填；任务与指派完整提交，Control仍重新推导并复核。 |
| ApplyPlanChangeCommand.newPlanDraft 重复计划字段 | 从 PlanRevisionDraft 派生字段类型，保留整个draft可null、三种图/阶段字段可null、tasks可省略、assignments可省略/null。禁止额外显式undefined，不混同返工完整草稿。 |
| 两宿主9种×2纯转发 | 删除 planProposalRequest、assemblePlanningContext、recordPlanChangeProposal、recordUserDecision、applyPlanChange、assembleQueryContext、assembleWorkContext、assembleCompletedWorkContext、amend 共18个函数实现和相应重复签名。调用者改用已有 planProposal、planningContext、control、queryContext、workContext、completedWork、collaboration 对象。 |

消费者定位见 consumer-candidates.txt、plan-admission-consumers.txt、context-consumers.txt，独立复核另外检索源码/测试/脚本/vendor。迁移没有删断言；契约宿主继承原 Control 能力，并继续在内存与SQLite两实现及重启路径中使用。组合根没有获得业务规则。

[生产源码基线差异](source-changes.patch) 直接比较本轮history原文与当前src/*.ts，排除前轮dirty差异、测试、文档和证据脚本；可直接核对删除的函数及消费者变化。邻仓coding-agent的src/tests未找到这些旧接口消费，检索结果单独保留；这不保证未知外部源码兼容。

## 结构变化与保留对象

[inventory.json](inventory.json) 按当前源码目录、行数、声明与消费者归属盘点；未按默认分支的大规模历史移动计算本轮结果。

- contracts TS文件：115→115，无机械拼文件；直接命名导出1463→1465，接口声明92→91。净增2个命名导出源于把实现中的请求/结果类型归到共享协议，不声称导出总数下降。
- goal-change.ts：452→425行；planning.ts：61→99行；rework/proposal.ts：200→178行；planning-context-compiler.ts：185→160行。
- 两宿主：656→630、800→774行；指定9类转发实现18→0。PlanCompiler的request不再用重载承载两种不同请求效果。
- 清理相邻旧冻结/角色施工说明，原文保存于history。失效说明删除不代表删去有效权限、风险或未完义务。

必须保留：PlanningContextCompilerImpl含真实范围检查、预算与缺口映射；InitialPlanning宿主适配执行Query→结果受理→派发顺序；Query授权组合推进投影；返工组合根先取Verification问题材料再交Dispatch。这些有真实行为，不是已删除的纯转发。legacyFingerprintMatches、revisionAssignments旧计划指派兜底、旧pending Query恢复、原始FAIL/报告/义务及Reviewer独立性均保留。

## 兼容性与独立复核

[independent-review.md](independent-review.md) 使用独立的仅内存TypeScript Program（strict、exactOptionalPropertyTypes）比较五组旧/新类型，修复后全部双向可赋值且虚拟文件零诊断：ApplyPlanChangeCommand、PlanProposalResult、PlanningContextRequest、PlanningContextResult、返工草稿。inventory的runtimeContractDifferences为空：本轮契约运行时函数、常量、散列和校验正文不变。

requestInitial继续调用同一个InitialPlanCompiler；app只改变源码调用名，HTTP请求/响应、持久QueryJob、命令身份和历史数据字段不改。删除源码端口、harness方法和移动类型属于源码API迁移，不能保证未知外部deep-import或旧方法调用兼容。没有修改package依赖、模块图、持久格式或增加第13个Module。

复核发现及处理：

1. 初始重载导致amendment-only注入被迫支持额外请求：分离requestInitial并迁移实际调用方，旧窄注入要求保持。
2. assignments索引派生额外引入undefined：用NonNullable修复，省略/null差异保留。
3. requestInitial缺少旧kind分发守卫：显式保留kind检查，新增两项反例验证拒绝前事件不变、无QueryJob、零模型调用。

## 实际验证与失败记录

- targeted：17文件189项通过；两项守卫反例落地后targeted-release：17文件191项通过。
- backend-types-release、ui-types-release、boundaries-release：通过，12 Module原依赖方向、零问题。
- 初轮ui-types失败：收敛后遗留三个未使用导入，属于本次候选类型错误，已修复。
- backend-types-final失败：漏迁移Query执行测试调用、重复测试属性/导入及错误缩窄继承的Control接口，属于消费者迁移错误，已修复；不归咎环境，不删断言。types-verified与最终release分别保留，不覆盖失败。
- docs.mjs首次语法错误在任何编辑执行前退出；修复字符串引号后执行。原始摘要见docs-script-failure.txt，属于清理工具错误。
- artifacts-before返回1：旧构建仍含18个转发且缺requestInitial，首检日志保留。由正常完整构建重写，不删除历史Evidence。
- full-tests：299文件/1953项通过（202.05秒），包含既有1951项与两项新增守卫反例。
- build、ui-artifacts：退出0，完整构建及6步真实HTTP产物检查通过，含旧页面、过期资源替换和源码变化后提供新构建。
- artifacts-after：337个服务端JS零无源码残留、18个旧转发全消失、requestInitial已构建。保留before失败与after通过两份证据。
- browser：26项真实Chromium验收通过（3.8分钟），覆盖原始FAIL、来源补料、独立Reviewer、恢复与未知副作用拒绝重跑。
- docs：13/13通过；source-docs：80个本地链接、零失败。两处当前状态及四份权威Module/Interface已更新。

沿用已验证WSL Node24、既有隔离TypeScript/Vitest、Chromium1234与bubblewrap；无依赖重装。浏览器使用44394端口和本轮独立新夹具目录，避免碰既有工作数据；确定性模型夹具验证运行链，不证明真实模型语义规划质量。

## 身份与并发保护

起点baseline.json匹配上轮closure：产品HEAD 65d270d75f3088d7baa4ef3a7c80fdaa62c3a38d、工作树摘要b23d5c9617df2b08926170646674176ff9f1ee989c2bdea53d3b59f08a288b51；文档HEAD 2f9a5df01175fb5686bb8bf02abc65216055a570、摘要07c4a7005ac3103aac2eb2b3a2049c678094905aad4d552afbfe6492b515df93。git status原始清单与可观察Node进程保存；有多个进程不等于发现同文件写入。

首次写入各文件前核对起点SHA，原文归档；[final.json](final.json) 中两仓HEAD未变化，产品1418个文本文件摘要为a0a33354e01ffabd4a1a0978e58cb7ee6240787616eea64e24c68d50244754e6，文档487个文本文件摘要为5f55c3caac67a9b4420806292557ff1f59d124d4413d853a3c04201e13e04309。摘要算法与排除项见同根snapshot.mjs，不将HEAD替代dirty工作树。

[preservation.json](preservation.json) 确认本轮28个产品路径、5个文档路径变化，无新增/删除整个源码文件；33份原文均与起点SHA匹配。UI构建探针已原样恢复、gitignore不变，未改路径保持基线。未观察到计划外源码并发写入。有效未完义务由最终独立复核逐字比较；closure.json用于复核后的身份封存。未reset、clean、stash、checkout覆盖、提交或推送。

## 下一步：协调角色消费FAIL并调整计划

- 失败材料：VerificationService.openIssues→VerificationOpenIssues，ControlReworkDisposition补充当前正式处置；composeReworkDrive先取得issueMaterials再交Dispatch，不建立Dispatch→Verification回调。
- 协调实际消费：ExecutionFeedbackContext取公开执行反馈，ExecutionFeedbackCompiler提交正式只读Query，QueryExecutionContextCompiler组装协调输入。当前实际消费的是执行反馈，工具FAIL尚未自动进入这个语义调查入口。
- 调整提案：现有ReworkPlanCompiler形成机械ReworkProposalV1；Dispatch的ReworkDriveEngine提交acceptReworkProposal。
- Control受理：AutonomousRework依次使用recordPlanChangeProposal、recordUserDecision、applyPlanChange。新PlanRevision承载返工，旧FAIL和未处置义务保留。
- 未连接：工具FAIL→协调语义调查→协调结果形成正式计划调整提案。已有requestInitial、机械返工或类型收敛不代表它已实现。

有效技术债仍包括语义调查与计划调整接线、影响材料实际刷新、人的决定回流、必要重审联合链及多失败恢复验收；唯一module-status原未完义务保留。其余宿主方法和大型协议未被本轮全面判定，无消费者证据或含投影/授权副作用的入口不能顺手删除。本轮不自动扩展为全仓存储、投影、UI或架构重写。
