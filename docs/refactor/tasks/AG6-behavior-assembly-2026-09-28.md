# AG6：面向人的行为指令与显式装配

2026-09-28。用户直接授权完成提示词工程和 Agent 装配；六条批注明确秘书、参谋、书记面向人的不同侧重点，协调按需作局部参谋，审查按任务选择重点。规模自适应初始化/派生/压缩若需新机制先作为未来方向。本批编号不表示 AG2–AG5 已完成；不恢复整个 MVP 施工。

**交付状态：两阶段实现已独审导入。** Stage1 三个预期失败与五个既有通过，中审冻结；Stage2 装配与指令实现后，独立 4 文件/19 项、类型/边界/隔离构建通过。两轮真实 DeepSeek 共 8 次调用均机械完成；主审据第一轮做过一轮提示词修正，最终语义样本仍有无来源连线及过强推断，不将调用成功视为语义合格。最终资源的 2 文件/8 项及摘要复验、样本与限制见[证据](../reviews/evidence/agent-behavior-2026-09-28/ag6/README.md)。此状态只关闭配置/指令装配施工，不关闭正式行为消费者或模型语义可靠性问题。

## 冻结接口与实现边界

复用 `src/app/runtime-configuration.ts` → Runtime Work/Query preparation → `runObservedModel` → Kernel FileSkillLoader/SkillRegistry。已有链能加载多个指令 Skill，不新造工厂、角色继承树或模型循环。

只给 `WorkbenchRuntimeBinding.grant.skills` 增加一种受信配置简写，既有显式 `{resourceRoot,enabledIds}` 完全保留：

```ts
{ bundle: 'platform', behaviors: ['secretary', 'scribe'] }
```

- `behaviors` 是必填数组，合法值为 `secretary | adviser | scribe | reviewer`，可为空；不要默认启用所有行为。按输入顺序去重，解析成原 Runtime skills 形状：仓库 `resources/skills` 绝对路径，`platform-work` + 对应选中的 `platform-*` IDs。
- 这是指令组合，不创建 Session/Agent、不启动模型、不派发任务、不授予或添加工具，也不根据请求文字热切换 Role。
- 在原纯配置 validator 中校验此简写的 bundle/数组/合法行为；未知行为配置在 provider/secret 访问前报错。不要顺手扩成全部配置验证框架。
- 原 Host factory Work/Query 两个 resolve 分支都返回解析后的 skills；不要把简写漏传给 Kernel。保留 grant 的 budget/tools/writeScope/systemInstruction 等值和原显式空 enabledIds 语义。
- 资源路径在源码与 dist/app 编译入口均指向本仓库根 resources；不依赖 cwd，不查父工程。单根加载不自动合并 vendor skills；`platform-work` 提供本包共同工作原则，原显式 vendor root 仍可选。

## 指令内容

共同 `platform-work`：先理解任务和现行事实，定向查材料；保留用户改动，操作前读真实文件，按风险检查，如实汇报；只调用有效工具，Prompt 不授予能力。当前 Agent 可计划、实施、协调、自检、整理。双图+邮箱直接联系相关同伴，普通状态不咨询，不强制角色链；需要独立上下文/判断才另委托，优先复用。临时协调是有范围的小参谋，设计取舍带依据反馈当前架构决策者与用户；普通局部细节授权内处理。调用回执/真实文件与模型建议分开；未知副作用不盲重试；未接消费者不假装已启动/登记/完成。

秘书：用户交流与项目掌控，组织易理解的解释、表格/Mermaid、文档与改进后的提示词；需要时明确当前方向、进度、未决和人能介入的点，不固定繁琐报告模板。保留局部图、未来意图、AG1查关联/读卡片/发咨询。文件/可视化工具缺席时返回内容，不声称已保存。删除“必须交参谋才准操作”这一角色专属权限暗示。

参谋：调查技术选型，以实践/原型/工具观察给出 trade-off、假设、成本和重审条件；辅助用户决策并监看实现是否偏离目标/架构，消费局部协调反馈。只对正式 `initial_coordination` 请求使用已有 v2 JSON 协议，普通技术问答不强制生成 Plan JSON；保留既有未来计划操作与授权边界。

书记：核查事实、维护历史/设计文档和来源版本，帮助整理开发流程、审查材料及派发建议，面向用户对话；冲突事实保留并说明，过时设计标注而非改写历史。实际文件修改需已授予工具；文档不是正式架构状态，派发建议不是已启动审查；不成为另一图 owner。

按需 `platform-reviewer`：根据委托选择复杂度/架构、实际完成、计划符合等维度，不每次全查；核对产物/源码/运行证据，区分确认问题与待证疑点/非阻塞建议，不为覆盖漂亮增加要求。保持判断独立、指出具体影响、可接受条件及缺证；未接正式 ReviewWork/Evidence 消费时仅报告，不宣称通过完成门槛。没有常驻 Reviewer 或固定第四个 Agent。

本包通用答复规则不得覆盖正式入口的输出协议。各行为内容能组合，不能互相以角色名称禁止别人具备的已授权动作；不增加新的权限或热角色机制。

## Stage1：只改必要测试后 STOP

允许 `tests/app/AG6-agent-assembly.test.ts` 和 `tests/runtime/W2-role-skills.test.ts`。

新测试最多三个，复用当前 factory 与真实 Kernel `runObservedModel`/scripted provider：

1. 受信 preset 经 factory 两个 resolve 分支成为有效 skills，secretary+scribe 进入真实模型请求，其余不进入；tools/writeScope 保持明确配置，构造 factory 不访问 secret/provider 或发模型请求。可借请求中的 enabled tool names 核对没有凭 Skill 自动加白板/邮箱工具。
2. 显式 vendor root + 空 enabledIds 原语义保留；platform behaviors=[] 仅共同指令；reviewer 能被显式选择。尽量在同一条用例核装配差异，不反复模型流程。
3. 未知 bundle/behavior 或缺 behaviors 被纯 validator 拒绝，不触及 provider/secret；不新增各字段穷举矩阵。

Stage1 简写可经 JSON.parse 得到 WorkbenchRuntimeConfiguration，避免引用尚不存在类型而使 RED 变成编译失败。W2 只迁移真实资源 manifest 集合为五项及相应 digest 循环，保留原选择/工具调用/错误路径检查，不新增逐词匹配新文案的测试。确认新测试在未接简写/缺资源处 RED 后 STOP。

## Stage2：冻结测试，只实现范围内内容

改 `runtime-configuration.ts`、五个 Skill 正文/两个新 manifest、`runtime-assets.json` 对应资源条目。禁止改 Kernel、Workflow、Query权限、mailbox、图 owner、control、MVP完成规则或测试；AG2咨询消费者和Reviewer正式结果消费者仍缺，不用Prompt掩盖。

Stage2通过限定测试后STOP；主审独立检查实际 diff、运行必要W2/AG6/Host/AG1及类型/边界/构建，核资源摘要，再做少量真实模型提示词场景验收。通过即收口，不扩局部测试循环。文档/未来方向由主审更新。无提交/推送，保留其它未提交工作。
