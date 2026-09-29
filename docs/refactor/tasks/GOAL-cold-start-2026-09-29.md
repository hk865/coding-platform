# 新目录 Goal 冷启动接线

状态：主审已批准 Stage1；完成必要接口与红例后 STOP。新 lane `goal-cold-start-20260929`，基于本轮当前 dirty 根快照。生产实现必须两阶段：Stage1 最小契约/必要红例与接口计划后 STOP；主审冻结后同 Session Stage2；不自动导入。

## 用户可见闭环

普通新目录 Goal 保留只读调查；调查后显露“形成方案”（initial_coordination），模型根据真实目录事实产出保存 Answer 中的架构、计划与可执行 checks 候选。UI 自然语言/结构化可读审阅，明确展示将写文件与运行的真实命令；用户点击采用才走现有 owner 配置/采用及 Host collaboration driver。采用过程与执行中及时读正式成员/关联/双图进度，不只最终刷新；不造节点、不默认四 Agent。同一已选 role 的相关 Work 复用原 Session 合法，本批不要求多个成员，不为侧栏造假 Agent。普通加载/读回不调用模型。

## 冻结接口和边界

1. `InitialPlanningResponseV2` 的 plan 分支新增可选 `setup: { architecture: AdoptInitialArchitectureInput; completionPolicy: CompletionPolicyContentV1; checks: RegisteredCommandCheck[] }`。无 setup 的旧 v2 保持兼容；模型仅建议，绝不授予 Host/工具权限。Plan 候选仍由原 owner 从已保存 Answer 创建，不接受 UI 自编 Plan。候选刷新通过 `GoalDetail.pendingPlan.draft.origin.answerRef` 读回原 Answer，不能只有内存按钮。
2. Query preparation 提供真实可用角色/templateId、已有 policy/baseline 或明确缺省；准确解释 RegisteredCommandCheck 只有 checkId/kind/command/cwd/timeoutMs/taskIds，不含 coverage。当前 evidence-service 将 check.kind 映射 coversKinds=[kind]，verification-plan 按 requirement.kind 及 policy.requirementKinds 匹配。不得让模型猜角色、假设测试存在、编造空政策自动 PASS；plan_only 未来节点保留原语义。
3. Host settings 增加按 workspace 保存用户批准 checks 的窄 POST 路由；同原 token/same-origin，仅 Host 用户。配置持久并启动恢复；利用现有 settings 串行操作/原子持久机制。composition 增窄 registerCheckConfiguration；Evidence 可选 scope 配置解析回调复用唯一现有 runner。fresh round 取当前对应 scope 配置，原 round 固定自己的 configuration，不跨 workspace 替换、不改变已有 round。原静态 options.checks fallback 兼容；原 round replay 仍早于当前配置读取。
4. 显式采用沿既有 architecture/adopt-initial、policy install/activate routes，再继续原 Plan adopt。已有 baseline/policy 不替换；setup 不可借模型输入直接变 trusted executor/permissionRevision。Host 基于实际 workspace 权限生成配置。原回执/重放/部分成功保留；后续失败不宣称之前未发生，不盲目重复。
5. localWorkbenchGrant 已按 open 的 writeAllowed/commandsAllowed 给写/shell，不新增权限管理。Query ceiling 保持 readonly。执行前缺权限给可读指引，不偷偷打开权限。LOCAL_WORKBENCH_GUIDANCE 从 only read tools 改为遵守当前 grant，并区分调查/执行。
6. UI 在当前原型布局内显露调查/规划/审阅/采用的连续入口，候选不是 JSON-only；刷新恢复可读审阅。沿原 driver 执行、原 read 刷新成员和两图，不新增 AgentManager、scheduler、事实 owner 或场景专用流程。

## Stage1 限定

只改必要类型/接口骨架及现有测试，不实现生产闭环。给出 setup parser/已存 Answer 恢复、Host approve checks/restore、Evidence scope resolver/frozen round、UI 审阅与采用具体 helper/入口计划。必要检查复用现有四个测试文件：旧 v2 与带 setup 保存来源；两 scope checks 持久/隔离及权限；原 round 不受后来配置改变；可读候选及显式采用边界。不要为理论异常新增矩阵。允许红例因骨架未实现失败，但记录真实断言与类型缺口，STOP 等主审。

## Stage2 与验收

仅冻结 scope 文件完成整条生产路径。相关 tests/types/build 通过即 STOP，不全仓循环。真实空项目 E2E 由主审另行执行：空注册目录中的真实 labels/report 两文件小工程，命令 node --test，模型自己探索方案，无手动播种 Plan/policy/baseline；通过即止，不扩大 AG 全套重测。使用临时隔离目录；DSH 禁止产品模型费用、真实用户工程写入、读取/输出凭据、修改 live 服务。不得硬编码 retry-library、固定 A/B、假检查、空 baseline 或假 completion policy。

## 需中审定点确认

- setup 缺少现有治理时如何在原 initial-plan candidate 保存阶段保留待采用候选，不能先要求不存在的 baseline 而丢候选。需读取原 owner 现有校验再定骨架，不绕过采用边界。
- setup 的 architecture 输入带哪些业务引用应由真实准备上下文给模型，哪些 identity 在已有 owner 归一；不得猜 project/workspace/revision。
- Settings 审批路由入参要绑定真实保存 Answer 与 scope；模型 checks 只是展示候选，用户显式调用才成为 Host 配置。
- 现有 policy 已采用时只沿原配置，不用 setup 悄悄替换；审批多步失败时 UI 展示原回执，重新读取正式状态续办未完步骤。

## 主审定点冻结

Contracts 不得依赖 WorkGraph：将既有 ModuleDefinition/ModuleContainment/AdoptedArchitecture/AdoptInitialArchitectureInput 原样提升到 src/contracts/architecture-catalog.ts；原 core/work-graph/architecture/catalog-contracts.ts import/reexport 保持调用兼容，不造第二定义。新文件已占位并纳入 scope。catalog modules[].ref 为 {projectId,moduleId}，Query 必须明确真实 projectId。QueryPreparation deps 已有 records，可复用现有 governance reader；如需新窄依赖先报告主审，不越界实现。已核 model-specific plan-service 1310–1345 不强制治理，commitHostPlanProposal 缺 policy 可保存，无需修改 plan-service。阶段1仅接口/红例，不实现运行链。

当前既有只读 workspace 的重复 open 不会升级权限。UI明确“当前目录只读，不能执行”，仍可形成/保存方案；不得给无效的重新打开勾选指引。本轮隔离新目录已以 write+commands 注册，无需先扩权限更新。

## Stage1 中审冻结与 Stage2 批准

Stage1 Session session-992753e1-975c-4200-aeb7-a9fb7d7262ea / attempt-1790660076301976573，STOP exit0。原33项29通过4预期失败，types/architecture通过。中审删除无消费者setup转发helper、历史采用按钮断言改为禁止历史发起采用、Host批准正例改显式权威savedAnswer reader stub（缺来源必须拒绝）。真正候选恢复字段为 GoalDetail.pendingPlan.draft.origin.answerRef。

现 CompletionPolicyConfigurationPort 没有独立current read：主审批准增可选 readCurrentCompletionPolicy 与 completion-policies/read 原core route/DTO，真实pointer+revision读取；仅明确not_found方可采用setup，incomplete/错误不是缺省，已有pointer绝不替换。新增4个scope文件已逐一比原snapshot hash一致后加manifest，不重prepare。UI可读policy+architecture+bootstrap真实roles写入原Query intent.question，不给Runtime塞records，不需要新平台setup reader。Host readCheckProposal仅私有authority seam，实际Host从原保存Answer获取同scope/ref/digest/checks；用户选择只批准相同原check定义，非模型授权。Stage2同Session实施全部冻结链后STOP。
