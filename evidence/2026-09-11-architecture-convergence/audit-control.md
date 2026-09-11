# Control Plane 五模块独立审查

审查者：audit_control；本报告首先记录修复前结论，后续实现另记，不覆写基线事实。范围为 ControlEngine、PlanCompiler、DispatchEngine、VerificationEngine、ArchitectureReconciler。已读两根 AGENTS、PRODUCT、ARCHITECTURE、五 Module、module-boundaries、runtime-collaboration、相关 planning/rework/verification/context-continuity 接口及生产组合根。

## 身份与边界

- 初始源码 HEAD：`65d270d75f3088d7baa4ef3a7c80fdaa62c3a38d`；文档 HEAD：`2f9a5df01175fb5686bb8bf02abc65216055a570`。
- 工作树身份以同目录 `baseline.json`（2026-09-11T04:46:45.420Z）的逐文件 SHA256 为准，不能以 HEAD 代替未提交实现。暂停后出现并发修改，续审以主 Agent 的 `resumed.json` 对照，未覆盖他人源码。
- 本轮起初只读；审查结论不表示全仓验收通过。后续 AC-PLAN 仅在主 Agent 分配文件内实施。

## 五模块结论

| Module | 实际责任与生产链 | 结论 |
| --- | --- | --- |
| ControlEngine | `control-engine.ts` 组合正式处理器；policies 持有归约/授权/任务图一致性；records 构造事件和快照；`work-record.ts` 受理身份，`autonomous-rework.ts` 重核返工四边界。Plan/Dispatch/Verification 经正式命令消费，Control 不调用模型。 | 职责基本归位；新建库的工作唯一性已有提交槽保证，不重修旧线索。旧库槽回填由 data 审查专项发现，见其报告。历史施工式注释较多，影响理解但不应顺手广泛重写。 |
| PlanCompiler | `plan-compiler.ts` 经 Context 取得 amendment 材料、初始请求/结果经 Control；`initial-plan-compiler.ts` 和 `operator-plan-compiler.ts` 已有 app/harness 消费；纯 `rework-plan-compiler.ts` 复用 Control 的图/任务集政策，不在 app 另造图。 | 两种影响分析仍猜 work ID，形成第二权威；需要修复。初始/人工/机械返工已有消费者，完整语义角色反馈规划仍属能力缺口。 |
| DispatchEngine | `dispatch-engine.ts` 收口 outbox，工作身份在组装完成后、startRun 前建立/链接；普通任务、人工计划、Reviewer、query 分别走正式运行路径。`rework-drive.ts` 经 app/service 的实际触发调用。 | RC-01 已按当前 disposition 逐组重编译，不再仅因 revision 改变丢掉其他失败。通过注入 callback 直接消费 Verification 是实际接口依赖，类型 import 检查未暴露，需消除此越界调用而非修改 DAG。 |
| VerificationEngine | `verification-service.ts` 组合 journal、command checks、rounds、Reviewer 和 openIssues；app 只作生命周期调用；正式证据/归约交 Control。 | 新的 openIssues/role-output 直接 load/events Ledger，绕开 Context 取材；重验处置的资格筛选也比正式 Evidence 宽。requiredOutputs 已取消门禁但 ADR 仍要求门禁，须查用户来源。 |
| ArchitectureReconciler | `architecture-reconciler.ts` 通过 ArchitectureContext 取精确源图，计算 delta、生成 Finding/Brief、保存 Vault、逐步检查 Control committed；`baseline-evolution-port.ts` 物化候选。harness 提供 inspect；app 尚无 inspect 调用。 | 模块责任清晰，既有机械差分/回执路径已接。完整初始 sourceBinding、产品 inspect、语义架构 Reviewer、MigrationGate 尚未实现；不把这些能力缺口叫架构越界。正文压缩的长行使 inspect 难读，可局部整理领域步骤，不创建转发框架。 |

## 偏差表

路径均相对产品根；规范路径相对权威文档根。行号为初审时点，续审应依 resumed 身份复核。

| ID | 原要求及出处 | 实际实现及位置 | 影响 | 类别 | 必要修复 | 验证证据/建议 |
| --- | --- | --- | --- | --- | --- | --- |
| AC-PLAN | PRODUCT「连续执行」工作跨 Run 持续；ARCHITECTURE 全局 #6 明确来源；Control 身份解析是当前 canonical 正式路径 | `plan-compiler.ts:205`、`rework-plan-compiler.ts:861-863,881,907,917` 使用 `work-` + taskId；真实 Dispatch 使用显式已有绑定或派发推导 ID，返工沿起源链复用 | affectedWorks、independentWork 和刷新提示含不存在或错误工作引用。当前主要消费者是提案存储/UI，不能夸大为已导致运行错误刷新 | A，身份规则重复/影响报告缺陷 | 两纯构造器仅消费正式解析的工作材料；不自行更换为另一个 hash；未建立身份如实留空/标缺口，读取失败不可猜 absent；生产来源通过合法 Plan/Dispatch→Control 接口 | 新测试：显式自定义 workId、已有推导ID、返工起源复用、无绑定/不可读、不跨 scope。旧 fixture 无绑定不能继续断言假ID |
| AC-VE-READ | ARCHITECTURE ModuleDependencyDAG：Verification 仅依赖 Control、Context、Vault；module-boundaries「Context 找到当前 scope/version 事实」 | `contracts/verification-service.ts:74` 新注入 Ledger；`verification-service.ts:34` 给 openIssues；`verification-open-issues.ts` load Goal/Plan；`role-output-completeness.ts:174,283,299,321,376,392,425` 读/扫描 canonical 数据 | 底层读取适配搬到 Verification，绕过既有 Context 边界；仅检查 Module import 会漏掉此真实依赖 | A | 扩展既有 VerificationContextPort 的具名当前计划/运行产出材料；Context 负责 load/events、分页/范围/不可用；Verification 保留 journal 与产出见证/问题语义 | 注入 Context 端口测试同样事实；真实 app DI 无 Ledger 注入 VE；读取失败维持 unknown，重开行为保留 |
| AC-DISPATCH-VE | ARCHITECTURE DAG Dispatch 允许 Control/Context/Worker/Vault/Ledger/Plan，没有 Verification 边；运行时反馈不等于反向源码依赖 | `rework-drive.ts:90-97,run/readIssues` 调注入 `ReworkIssueReadPort`，`app/service.ts:201` 注入 Verification.openIssues；注释声称方向仍 Verification→Control | 调用者实际上依赖验证问题查询接口，隐藏了越界；不是单纯host预先提供一份材料 | A | 由合法 host/触发链提供已验证问题材料，或经既有合法材料基础读取已保存事实；禁止把同一 callback 改名后仍直接调 VE，也禁止经 Context 转调 VE 引入新边。当前性/义务归属采用一个权威政策 | 真实 app 多失败端到端、重复触发、当前计划移动、问题源不可用；检查实际对象调用路径 |
| AC-REVERIFY | PRODUCT「状态真实性」过期依据不能推进当前状态；「证据驱动完成」当前义务；openIssues 自身声明正式已受理报告 | `verification-open-issues.ts:613-633` reverifiedKeys 只看 planRef+PASS；Reviewer分支只看 resultCommand.decision accepted，未查 resultReceipt；同文件 reviewIssues:394 已检查 receipt | 未正式受理或当前来源已过期的 PASS 可能令旧失败标 disposed_by_reverification，使返工驱动跳过。并非已证明 Task 错误 completed | A，资格/处置缺陷 | 复用当前正式 Evidence/Reviewer资格，区分本地 verdict 和已提交回执；版本涵盖 workspace/policy/baseline，不仅 planRef。不得把 journal PASS 变成第二完成权威 | 反例：当前plan但workspace变更；accepted本地decision+rejected/null receipt；当前适用正式PASS；保留原失败不丢义务 |
| AC-DOC-ROLE | ADR0003 D4-3 仍要求 Verification 按规格校验必产出；PRODUCT 角色职责与证据由框架维护 | `role-output-completeness.ts` 与 `verification-rounds.ts:65,376,449` RW-18 取消缺项降级/withheld，声称用户指示；module-status:45 已写声明性 | 当前规范互相冲突；代码注释提到将来“记忆模块”，现有12模块无该模块，不能自动新增边界 | B 需原话证据，否则 C | 主Agent追溯用户原话后标注替代关系并保留ADR历史；缺证据只列具体选择，不擅自恢复/取消门禁或新增模块 | 本Agent未获取原话，不以 accepted metadata 作为证明；role-output已有逐字段见证回归可保留 |
| AC-DOC-STATE | AGENTS 唯一当前状态、历史不覆盖实际；用户要求当前消费者真实 | module-status 多处仍写返工尚未接通/授权缺失，而 app/service、ReworkDrive、Control acceptReworkProposal 已生产连接；ArchitectureReconciler module 前段还写 revision0/固定finding待修，后段记录已修 | 人按旧状态误判已实现与下一阶段；下层文档前后互相抵消 | A，文档过时（既有实现事实），非重新选型 | 更新唯一当前表和当前段，历史限定为其当时身份；未完成能力单独保留，勿删除旧失败/验收 | rg消费者+主Agent统一行为验收；明确真实模型未验收 |

## 已知线索重新核对

1. `work-record.ts` 已在任务 bind 前复用权威 resolver；`ledger-validation.ts` workContextIdentityClaim 及两个 Ledger 在同一提交占槽，因此新库/新提交已不只是先查后写。旧库兼容与跨连接证据由 data 审查补足，本报告不把这一项整体标全部完成。
2. `rework-drive.ts` 每个任务组重读问题和当前计划；`reworkIssueUnaddressed` 同时接受 unaddressed/carried_by_task，结果 dispositions 逐条交代。多失败因换版直接遗漏的旧路径已有修复。AC-REVERIFY 是另一个资格缺陷，不能混为旧问题仍原样存在。
3. app/initial-planning 目前是组合 facade；app/plan-changes 只消费投影视图；没有证据表明这两处仍承载任务图/完成政策。service 中返工触发和回调接线则需按 AC-DISPATCH-VE 修正。

## 验证记录与限制

- Windows `node --version` 返回 v24.19.0。
- 尝试 `pnpm exec vitest run tests/control/work-identity-uniqueness.test.ts tests/control/rework-drive.test.ts tests/control/architecture-reconciler.test.ts`：失败，pnpm 自动尝试 install 后以 `ERR_PNPM_ABORTED_REMOVE_MODULES_DIR_NO_TTY` 中止。未授权或实施依赖重装。
- 尝试 `node node_modules/vitest/vitest.mjs run ...`：失败，Windows 路径 MODULE_NOT_FOUND。没有把此环境失败说成测试通过。
- 主 Agent 已接管 WSL 可用工具链及统一验证；本子 Agent 不再调用 pnpm 或全仓构建。
- 检查方法包括实际源码阅读全文/局部流程、contracts、app/harness DI、持久回执分支与测试断言，并非仅依赖 import 检查。

## 剩余产品能力（不实施）

完整秘书/参谋/书记/集成反馈规划；运行公开材料响应与暂停/继续/换手完整恢复；返工后的真实新版本重验与最终归约实证；初始架构 sourceBinding/产品 inspect/语义架构审阅/真实迁移门；决定对所有受影响工作材料的消费回执。它们要与已具备的局部真实链路分别呈现，收口后由用户选择。

## AC-PLAN 实施记录（续审）

主 Agent 分配 AC-PLAN 后实施，不更改以上初审事实：

- `PlanningTaskWorkMaterial` 显式区分 resolved/absent/unavailable；未提供材料时影响报告写清单不完整，不伪造绑定。该清单用于影响解释，不承担权限或受理资格守卫。
- PlanCompiler 通过既有合法 Control 只读身份接口取真实绑定；ReworkDrive 同样取材后交纯 ReworkPlanCompiler。Context 不新增 Control 依赖，未修改 planning.ts / coordination-context-compiler.ts。
- 既有 Dispatch 起源链纯循环提取至 task-work-identity.ts，两个消费者复用，派发原导出和规则保持。已存在显式 ID 和历史推导 ID 均原样保留。
- affectedWorks、independentWork、workContext 刷新材料只列实际读到的引用；同一工作去重，已受影响的共享工作不同时列为 independent。
- 主 Agent 负责 app/harness 注入 `PlanCompilerDeps.workIdentity`，并接续 rework-drive 中其它架构修复。该文件已释放，未覆盖并发改动。

实际验证：通过 WSL 既有 Node v24.18.0 / Vitest 4.1.10 运行，不安装依赖。

`node node_modules/vitest/vitest.mjs run tests/control/plan-impact-work-identity.test.ts tests/control/rework-plan-compiler.test.ts tests/control/work-identity.test.ts`

首轮 38 PASS / 1 FAIL：旧纯编译器测试没有身份输入却要求生成 `work-task-verify`，正是本次修复的错误约定。原输出保留 `ac-plan-tests.log`。仅该测试改为显式输入已解析的 fixture 身份，其余任务图/义务断言保留。

复验 **3 files / 39 tests PASS**，输出 `ac-plan-tests-final.log`。新增五项行为测试含真实 Control+InMemoryLedger，覆盖显式自定义 ID、真实 hash ID、返工起源复用、不存在/不可读区分、跨 Goal 结果拒绝。整个应用回归、类型检查及未参与实现者复核由主 Agent 统一完成，本报告不冒称已通过。
