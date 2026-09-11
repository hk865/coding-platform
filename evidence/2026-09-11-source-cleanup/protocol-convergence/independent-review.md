# 协议收敛独立复核

Ticket：SC-PROTOCOL-CONVERGENCE-REVIEW。复核者不实现源码变更；唯一写范围为本报告。采用本目录 baseline.json/history 区分本轮与先前 dirty 改动；此前已读两根 AGENTS。

## 首批候选复核

PlanProposalPort 与 PlanCompilerPort.request 的 amendment 分支原本描述同一请求与结果；删除重复接口、把 PlanProposalResult 放到 contracts/planning.ts 是权威收敛。真实 PlanCompilerImpl 与 HumanCollaboration.amend 的业务步骤未因此迁给宿主。两 harness 中被删除的 planProposalRequest/assemblePlanningContext 方法原文确为向已有 planProposal/planningContext 对象的一行转发；契约测试改为调用同一对象，没有移除实际编译行为。

返工草稿使用 PlanRevisionDraft 字段派生的首批候选，已通过独立、仅内存的 TypeScript Program 检查：旧 ReworkPlanDraftV1 与新 ReworkProposalV1['planDraft'] 双向可赋值；planId、planRevision、objective、stages、tasks、assignments、taskHierarchy、executionDag、obligations 九字段仍全部必填。该检查不是仅比较行数或语法名称。

未发现 PlanProposalPort、ReworkPlanDraftV1、planProposalRequest 遗漏代码消费者。命名导出及 harness 源码接口删减本身仍属于内部源码调用面的变化，不能等同未知外部 deep-import 兼容。

## 已提交主 Agent 的具体问题/候选

1. 首批用 Pick<PlanCompilerPort, 'request'> 替换原 amendment-only 注入类型，会要求注入方同时实现初始规划重载。这是 TypeScript 注入约束变强；当前生产对象均为完整 PlanCompilerImpl，尚未发现运行回归。应保留窄调用需求或明确说明该源码约束变化，不能宣称两接口完全等价。
2. PlanningContextCompilerImpl 中 PlanningContextRequest、PlanningContextResult 和 PlanningContextRejectionCode 逐字段重复 PlanningContextPort.assemblePlanningContext。可由单一权威请求/结果派生；该实现本身包含作用域、预算和材料组装行为，不能把整个实现当无用途转接删除。
3. ApplyPlanChangeCommand.payload.newPlanDraft 重复 PlanRevision 字段，可在同一协议权威下派生；必须保留普通变更的 stages/taskHierarchy/executionDag 可 null、tasks 可省略、assignments 可省略或 null、整个草稿可 null 等差异，不能因为返工草稿全必填就放宽或收紧普通变更。

以上为首批复核与有界候选，不是最终验收，也不要求扩大全仓清理。主 Agent 正在继续收敛，最终范围、实际验证和问题处理待后续复验。

## 扩展候选复核

主 Agent 已将 PlanningContext 请求/结果移到规划契约，初始规划改用 requestInitial 以恢复 amendment-only 的窄注入要求，并继续移除两 harness 的同义纯转发。独立内存 TypeScript Program 在 strict/exactOptionalPropertyTypes 下比对旧类型和当前类型（虚拟文件零诊断）：PlanProposalResult、PlanningContextRequest、PlanningContextResult、Rework 草稿均双向可赋值。

提交两个需要修复的实际差异：

1. ApplyPlanChangeCommand 候选中的 `assignments?: PlanRevisionDraft['assignments'] | null` 会因被索引字段可选而额外允许显式 undefined。旧类型不允许显式 undefined；检查得到 Old→New=true、New→Old=false。建议用 NonNullable 保留原省略/null差异。
2. requestInitial 候选仅检查入参为对象，丢失旧 request 分发中 `kind === 'initial'` 的条件；InitialPlanCompiler 内没有补验 kind。错误/缺失 kind 的对象可能通过其他条件后提交初始规划。建议保留显式 kind 检查并验证反例。正常 app 调用均带 kind，不将该发现误报成已知 HTTP 回归。

requestInitial 的已知 app、planning-interface 测试及 rework-task-dispatch 测试调用已迁移；普通 amendment 仍使用 request。此时尚未把全量验证视作通过，先前类型错误日志需继续保留。

## 候选冻结复验：发现已关闭

主 Agent 修复后重新执行独立的仅内存 TypeScript Program，启用 strict 和 exactOptionalPropertyTypes，虚拟文件语义诊断为零：

| 对比旧基线与当前 | 旧→当前 | 当前→旧 |
| --- | --- | --- |
| ApplyPlanChangeCommand | true | true |
| PlanProposalResult | true | true |
| PlanningContextRequest | true | true |
| PlanningContextResult | true | true |
| ReworkPlanDraftV1 与 ReworkProposalV1['planDraft'] | true | true |

assignments 已使用 NonNullable 索引派生，显式 undefined 扩张关闭，原可省略/null语义保留。初始规划 requestInitial 在调用内部实现前拒绝缺失/错误 kind；两个反例检查 rejected/invalid_request、账本事件完全不变、没有 QueryJob、零模型调用。已读本候选的 targeted-release.log：17 文件/191 项通过；backend-types-release.exit 为 0。此处引用的是两项修复后的 release 证据，不用之前 verified 结果替代。

原窄注入问题由 request 与 requestInitial 分开解决：Pick<PlanCompilerPort, 'request'> 重新仅要求 amendment 方法。已知 app 初始协调、planning-interface 和 rework-task-dispatch 消费者均迁到 requestInitial；源码、测试、脚本与 vendor 检索未见 PlanProposalPort、ReworkPlanDraftV1、planProposalRequest 残留代码引用。新路径仍调用同一个 InitialPlanCompiler，不改变 QueryJob 请求字段、授权或持久身份；源码 API 改名不是未知外部调用兼容承诺。

另行检查两 harness 的归档：九类方法各两处，共 18 处删除项全是一行向现有 module 对象转发，没有授权、投影推进或生命周期副作用。调用方改用相同 control、collaboration、planningContext、queryContext、workContext、completedWork、planProposal 对象；不得将其他有副作用的宿主方法一概视作同类。

复看 contracts/harness/PlanCompiler/ContextCompiler README，以及权威 plan-compiler、context-compiler、runtime-collaboration、module-boundaries 四份说明，均描述真实入口和权威归属，明确完整 FAIL 语义调整仍缺，没有把接口整理写成新能力。此次有限范围当前无未关闭的独立复核发现；全仓、构建、浏览器和最终文档结果待主 Agent 实际验收，不由本候选复核提前认定。

## 最终交付复核

已读取实际 IMPLEMENTATION-HANDOFF.md、module-status.md、verification.md、最终保留清单、release 验证日志和产物结果。最终结论：限定范围无阻断、无未关闭发现。

- 独立从本轮归档和当前源码解析计数：contracts 均为 115 个 TS 文件；直接命名导出 1463→1465，接口声明 92→91。实际报告明确导出总量增加，未将类型归位伪称全面减量。
- 18 个纯转发删除指的是两 harness 各九个同义方法；没有删除真实模块操作。`requestInitial`、已删 harness 方法及旧类型路径属于源码 API 迁移；当前说明明确旧源码调用要迁移，不保证未知外部调用兼容。持久字段/HTTP 兼容与源码 API 兼容分别说明。
- module-status 从“当前语义协作增量”开始的有效未完义务后缀与本轮归档逐字相同，共 8647 字符，SHA-256 为 `e4d6eece9d5171608ba46d51455038ac3913ea338e09fc18e76752b068a3f278`。未将原 14 项未完能力清除。
- 独立重算 28 个产品、5 个文档改动路径的 33 份原文归档 SHA，均匹配 baseline；无整文件新增或删除，保留记录中两仓 HEAD 未变、UI 探针恢复、gitignore 未动。
- 最后一处 work-context-port.ts 用 AST 去注释比对正文等价；读取头注释确认仅去掉 P1-16/first consumer freeze 的阶段标记，当前权限、预算、来源及不启动模型等限制保留。
- release 后端/前端类型、边界、targeted、全仓、build、ui-artifacts、browser、docs 的实际退出码全部为 0。读原日志确认全仓 299 文件/1953 项、浏览器 26 项（3.8m）、文档 13/13；source-docs 为 80 个链接零失败。artifacts-after 记录 337 个服务端 JS、零旧路径、零旧转发和 requestInitial 已构建。以上为复验主 Agent 原始证据，不冒充独立重复运行全套测试。
- 两处唯一当前状态和完整报告均准确表述 Verification 问题经组合根交 Dispatch、协调 Query 当前实际消费执行反馈、机械返工由 Control 三步受理；明确工具 FAIL→协调语义调查→正式语义计划调整尚未接通。确定性模型夹具没有被写成真实模型协作质量证明。

本次审查只覆盖已实施协议/入口收敛及其调用方，不将其他大型协议、宿主方法或候选导出判定为全部必要，也不授权继续全仓重写。
