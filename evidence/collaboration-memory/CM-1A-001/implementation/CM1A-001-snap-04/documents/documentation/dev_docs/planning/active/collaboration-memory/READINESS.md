# 协作与小规模记忆：计划审阅与拆票就绪性

日期：2026-09-12。结论：**整批近期实施包已准备，覆盖 1A/1B/1C、入口迁移和集成回归；首张 CM-1A-001 待用户指派，后续票由执行统筹者按证据自主细化并持续推进，不直接横向派发 CM-01～CM-05。** 本轮尚未实施，1A 或局部 Gate 通过均不代表整批完成。

实施交接见 [HANDOFF](HANDOFF.md)，首票见 [CM-1A-001](CM-1A-001.md)，基线与环境见 [BASELINE](BASELINE.md)。完整设计见 [PLAN](PLAN.md)，当前产品调用链见 [源码证据](CURRENT-CALLCHAIN-EVIDENCE.md)，开源可复用单位见 [Hermes / OpenClaw 调查](MEMORY-REUSE-EVIDENCE.md)。原始对话保留在 [来源文件](../../../product/conversations/2026-09-12-agent通信编排与记忆-原始对话.md)；最新用户纠正记入 PLAN 0.1，覆盖上一版候选政策。

## 1. 本次审阅裁决与已明确范围

四条批评中，用户记忆消费者、额外产品限制、架构决定回流三项成立；运行中经验积累也需补齐，但按内容类别与近期范围处理。

- 记忆保存后验证下一次能加入新输入的相关回话，可以发生在同 Task 不同 Run。无需用户另开 Task；同 Run 后续调用是否能刷新，由实际 Runtime seam 验证。
- 用户明确说“记住／以后／纠正”直接保存或更新，不重复请求首次确认。当前一次性指令与长期偏好分开；模型推测先保留候选。
- 首版单用户、多项目。稳定本地 profile 即可，用户记忆默认跨项目，项目习惯默认隔离；明确允许时复制选定版本或引用获准来源。
- 近期只做少量可维护偏好、项目／团队习惯和局部经验，优先复用成熟开源规则与工具机制。
- 结构化知识库、自动画像、复杂后台提炼、自动 Skill 演化及第二领域完整产品验证延期；文档保留接入方向，代码不预造空框架。
- 主界面必须展示实质架构取舍，人的接受／修改／拒绝／延后回到所有受影响工作；普通已授权调整仍可通知后继续。

因此本批不再以“新 Task 使用 Memory/Knowledge/Skill”作为唯一产品闭环，也不要求先建设账户系统或完成自动经验系统。

## 2. 当前事实与真实缺口

| 分类 | 已核对的依据 | 对本计划的影响 |
| --- | --- | --- |
| 可复用 | [Task/Attempt/Run/outbox](../../../../../../../agent_platform/src/contracts/dispatch.ts)、[Control claim](../../../../../../../agent_platform/src/control/control-engine/claim.ts)、Ledger CAS/幂等、WorkContext、Vault/source pin | 保留唯一状态与 outbox-before-side-effect；TaskLease 不等于消息消费者领取权 |
| 可复用 | Context/Runtime 实际输入链、公开 ExecutionNote 与 WorkMemory 更新／废止 | 可承接小记忆消费者和过程来源；不能当作已有用户画像／长期偏好产品 |
| 多入口 | ordinary drive 是生产普通路径，parallel/Handoff 目前在 harness；Query/Reviewer 有独立领域状态，Rework 产生计划 | 共享机械 claim/recovery，保持领域差异；不再加竞争后台循环 |
| 真实产品缺口 | [主界面](../../../../../../../agent_platform/src/ui/src/features/conversation.tsx) 已有独立只读提问和开发任务 Composer，[模块状态](../../../../human/module-status.md) 仍列完整秘书／参谋对话缺失 | 必须补实际主界面对话／解释／反馈消费者，不能由 Worker 新 Task 测试替代 |
| 真实输入限制 | [observed-model-run](../../../../../../../agent_platform/src/execution/worker-runtime/observed-model-run.ts) 固定 Run input；内核有 before_model Hook，但当前宿主未用于偏好刷新 | 首选每回应重新编译，分别验收同 Task 后继 Run 与同 Run 检查点；不承诺热修改已提交请求 |
| 真实身份缺口 | 当前 CommandIdentity/Ledger refs 主要 project-scoped | 增加最小 local profile scope 与唯一用户记忆权威；无需多用户登录，不伪造 Project/Run |
| 部分决定闭环 | [FeedbackChoice](../../../../../../../agent_platform/src/ui/src/features/feedback-choice.tsx) 与 [FeedbackDecisionCompiler](../../../../../../../agent_platform/src/control/plan-compiler/feedback-decision-compiler.ts) 仅目标澄清选择 accept；Goal/Architecture contracts 已有 accept/reject/defer | 复用正式命令，补架构前端与所有受影响 Work 的材料刷新／采用／失败 |
| 文档方向 | KnowledgeSource、完整 Skill 治理与自动提炼有候选方向 | 保留后续需求追溯，不作为近期新增 aggregate |

细节和源码定位见 PLAN 2、5.4.1、5.8 及调用链证据。历史 PASS 仅覆盖原切片；本轮未运行产品功能测试。

## 3. 推荐架构保留与调整

保留 12 Module 的有效分责：Control 受理状态／授权，Ledger 原子保存，Dispatch 统一机械执行，ContextCompiler 统一组装选材，Runtime 单次执行，HumanCollaboration 组织人的入口，ReadModel 展示可重建事实。

Work 是跨 Run 的通信／等待 owner；AgentInstance 是归因身份，RoleBinding 固定职责与授权版本。正式定向请求以 WorkRef 为目标，首条范围一个 AgentInstance 至多一个 active participation；用户 profile 与 AgentInstance 分离。

ordinary Task 的 DispatchOutboxEntry 保持唯一调度权威，Task successor 使用新 Attempt 对应 outbox；路由页 Delivery/checkpoint/wait transition/next intent/current settle 同一 generation-guarded CAS。wait 满足原子创建唯一 successor execution anchor/Run/intent；取消采用 desired-state-first，unknown 必须 reconcile，不能盲重跑。

Host 注入工具与 provider Adapter，携 exact principal 调正式 Interface；WorkerRuntime 不反向依赖 Control/PlanCompiler。Context 是选材点，Control 是授权生命周期权威，Vault/WorkspaceReader 负责读取复核。实际证据区分 selected、bound、provider_call_authorized、attempted、acknowledged（能力可得时）和行为 witness。

对小记忆作两项调整：每次面向人的回应检查当前适用版本；偏好更新不等于撤权，不把所有后台 Run 一律取消或失败。保存由用户消息／维护入口经 HumanCollaboration→Control 处理，现有只读 Query 只消费结果；以后新增模型写记忆工具必须明确受限 capability，与 checkout 写权限分开。

## 4. 分类、作用域与开源复用

| 内容 | 近期处理 |
| --- | --- |
| 用户沟通偏好 | 明确表达直接更新；本地 profile 范围，跨项目读取，下一相关回应生效 |
| 项目／团队习惯与 taste | 当前 Project 的具体约定；默认不带到其他项目，用户允许后继承选定版本 |
| 正式编码规范、架构决定 | 保留精确规范／Decision 及版本；偏好或摘要不覆盖它们 |
| WorkNote 与局部经验 | 执行中增量记录条件、观察和来源；可复用的小约定经同一个记忆入口维护 |
| 通用领域知识 | 继续用现有文件/source pin 按需读取；结构化知识库只保留方向 |
| 可复用方法／Skill | 既有或人工选定的 Skill 可用；自动生成／演化和完整治理延期 |

复用调查定位了具体单位：Hermes 的小条目操作、去重／唯一匹配／容量及失败案例；OpenClaw 的每 turn bootstrap 重读、偏好纠正与项目范围筛选方式。两项目完整模块都依赖自身宿主，不能当作独立即插即用包。Hermes session prompt 冻结与 OpenClaw 默认下一 turn 重读是实质差异，后者仍不证明同一 attempt 内每个模型调用刷新。精确 SHA、源码、许可与未验证边界见 [调查证据](MEMORY-REUSE-EVIDENCE.md)。

近期不需要完整画像模型或向量库。优先保存会改变后续行为的少量稳定信息；重复项不重复新增，冲突通过当前 revision 处理，失败不显示“已记住”。查看、纠正、删除与当前条目来源必须可用；旧记录不能把删除内容自动写回。共享存储只有一份权威，Markdown 若存在则为同一写入口管理的正文或只读投影。

## 5. 整批路线与单负责人纵向路径

**1A：第一张技术 walking-skeleton Ticket。** 一个 Project 内，Work-targeted request/subscription/all-wait → durable claim/route settle → 唯一 successor Attempt/Run/outbox → Context/provider-call evidence；通过两个 consumer 竞争、事件前后顺序、丢 wake、强杀、desired cancel、unknown、只读并行和写冲突。第一张票不同时实施小记忆或完整前端。

**1B：小记忆与主界面回应。** 同一负责人先验证上游适配与 local profile scope，再贯通保存／更新／删除、同 Task 下一回话、方案解释、进度反馈、原话不再提供／重启和两个项目隔离。最小维护 UI 包含在本段。执行中记录一条有条件的项目习惯，并验证下一次进度检查、阻塞上报或交接使用及条件失效反例。

**1C：人与架构决定的闭环。** 两个工作包在测试失败前提出跨模块冲突，前端主动展示选项、影响、暂停／可继续范围。接受／修改／拒绝／延后走相应正式入口，回流全部受影响 Work；界面展示已记录、已送达、材料绑定、调用采用、stale/gap/失败。拒绝／延后不执行候选变更，重启继续恢复回流。

完整范围、消费者、候选接口、前置条件与阶段验收，以 [PLAN §7](PLAN.md#7-整批近期实施路线依赖与交付) 为唯一正文；各段使用 B01–B05、C01–C04、M01–M06、I01–I04 标记结果，不是假装已经生成后续 Ticket。

| 后续结果 | 依赖与负责人 | 验收落点 |
| --- | --- | --- |
| 1B 小记忆／真实回应 | 正式写 scope 与回应输入 seam；不等完整 pub/sub。未稳定部分原纵向 owner 收口 | B01–B05：维护／并发失败、local user 跨项目、同 Task 下一回应、三个实际 UI 消费者、局部经验／开源适配 |
| 1C 决定／回流 | Delivery、版本、接续和正式决定影响集；核心决定不等 B，偏好化解释合流时补验 | C01–C04：四种决定、精确版本、全部 Work 采用／失败、浏览器和协作反馈 |
| 入口迁移与剩余通信 | Gate A 对应 primitive 已证实；逐消费者制票，不横切共享契约 | M01–M06：普通／并行、Query、Reviewer/Handoff、规划/Rework、queue/取消/恢复、any-wait／有限重放／通信可见性 |
| 最终整批集成 | B/C/M 当前结果合流，统筹者负责；可提前增量联调，最终验一个集成快照 | I01–I04：同一完整场景、跨入口／旧库回归、当前构建／浏览器／模型证据、另一 Agent 独立验收 |

按同一场景延长，可在证据下调整候选字段。只有尚未验证的跨模块路径需同一负责人；稳定包可并行或由无子代理工具串行完成。1B/1C 未完成不是无关成熟包的阻塞，第二领域／知识库／自动 Skill 不阻塞本批；但 1B/1C/M/I 均为本批必交，不是等用户另行决定是否做的扩展。

## 6. 放票条件与可并行工作

| Gate | 所需证据 | 可释放的范围 |
| --- | --- | --- |
| A：通信／调度 | 唯一 outbox；并发、wait、route settle、successor admission、取消／unknown／重启与实际输入证据成立；旧入口无双重推进 | 对应 scheduler、communication、read model 与逐入口迁移 |
| B：小记忆／回应 | 明确保存纠正删除、唯一 profile、跨项目用户记忆与项目隔离、同 Task 下一回应、原话移除／重启均成立；上游复用与实际维护 UI 可核对 | 已证明的偏好／项目习惯维护与反馈展示 |
| C：人的决定／反馈 | 接受修改拒绝延后、过期与重复、全部受影响工作回流、材料刷新／采用／失败和前端一致；与 B 的局部习惯／偏好联验独立记录 | 决定卡／回流展示细化及成熟协作适配；尚未合流效果不能宣称已通过，必须在 I01 关闭 |

Gate 不是要求全产品全部完成的总锁。小记忆真正依赖回应 Context 与正式写入口；决定回流依赖持久 Delivery／版本／接续。统筹者在独立证据成立后按实际依赖自主细化下一票，记录 owner、上游快照、放票依据、适用验收与剩余项；不提前划死文件写入边界，也不为正常拆票重新请求用户批准。单票 owner 回交后由统筹者继续下一张就绪票／修复／整批集成。

可并行调查上游依赖／许可、profile scope/兼容方案、同 Run 刷新 seam、UI 消费入口和故障断点；可并行做独立设计审阅。子代理不冻结共享接口。核心 transaction、调度、输入绑定和消费者行为在各段 Gate 前由原负责人收口。

## 7. 未决项与用户决定边界

已经决定、不再重复询问：明确用户偏好直接保存；单用户跨项目记忆；项目习惯授权继承；结构化知识库与自动演化延期；人的架构决定必须回流。

实施前需技术收敛：Task outbox 原位演进／兼容迁移方式、local profile 最小持久 scope、回应刷新 seam、每类副作用 reconcile、决定影响集合和版本校验。字段、存储路径、容量和 UI 细节由真实纵向消费者决定。第一张技术票不必等待 profile 的所有细节；1B 开始前确认所需范围即可。

后续才可能需要实质产品选择：跨 Goal 常驻 Agent、自动推测长期生效、跨设备同步、历史日志级别清理、知识库或自动 Skill 的具体范围。它们不构成当前小闭环的审批前置。单机使用跨进程 CAS 是推荐技术保证，本轮不额外建立账户／团队系统。

## 8. 验收与交付边界

PLAN §10 保留 V01–V22 的近期／后续分类，§10.1 将全部条目映射至正式首票与 B/C/M/I 后续结果：

- 近期必须证明通信／恢复、同 Task 下一相关回应、用户记忆跨项目／项目习惯隔离、运行中局部经验、架构决定前端与全部工作回流，以及具体开源复用来源。
- V07/V17 的第二领域证明、V09 的结构化知识库、V10 的自动 Skill 治理延期；V08/V19 的自动提炼／团队进化部分也不冒充近期完成。
- 功能看真实用户行为；恢复看并发和中断；产品一致性看范围／正式决定；可读性看唯一 owner 和调用路径；扩展性先由已有对话、规划、进度消费者证明，跨领域结论另验。
- 确定性 ModelClient 证明输入版本与状态边界；真实模型样例证明回复／解释／反馈行为。文件存在、工具 success、prompt 加载或文档检查均不足以单独证明记忆有效。
- 每票按实际范围验收；1A 的 any-wait、UI、记忆、决定和完整入口迁移 N/A 必须在后续落点核验。整批不能复制单票 N/A，也不能累加旧快照 PASS 代替 I01–I04；最后由另一 Agent 对可识别集成快照出独立结论。

本次补全整批路线与验收映射，同步三个原有 Prompt、首票和跨工具交接；不增加已延期产品范围。当前没有已知必须先由用户裁决的开工阻断；1A 的 D01–D05／环境 preflight、B/C 的必要技术裁决按各自阶段完成，不要求全产品提前冻结。原始对话、两份调查证据、原始基线附件、产品代码与正式规范保留。当前未指派实施 owner，本轮交付停止，未实施、提交或推送 Git；文档检查不是运行验证。
