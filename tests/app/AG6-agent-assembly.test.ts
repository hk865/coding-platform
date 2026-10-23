/**
 * AG6 Stage-1 behavior assembly contract.
 *
 * Exercises the trusted preset shorthand `{ bundle: 'platform', behaviors: [...] }`
 * through the REAL Host factory (`createWorkbenchRuntimeHostBindings`, both the
 * Work and the Query resolve branch) and feeds the resolved skills into the REAL
 * frozen Kernel model loop (`runObservedModel`) with a scripted provider. The
 * structured shorthand is built through a real JSON boundary so a not-yet-typed
 * `bundle`/`behaviors` field cannot turn the intended RED into a type failure.
 *
 * These tests assert assembly/wiring only: which instruction content and which
 * tools reach one real request. They do not score the model and do not claim the
 * placeholder `platform-work`/`platform-reviewer` content is finished.
 */
import { mkdir, mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import {
  createWorkbenchRuntimeHostBindings,
  validateWorkbenchRuntimeConfiguration,
  type WorkbenchRuntimeConfiguration,
  type WorkbenchRuntimeProviderDependencies,
} from '../../src/app/runtime-configuration.js';
import type { CoreCallContext } from '../../src/contracts/core/call-context.js';
import type { ReadResult } from '../../src/contracts/core/results.js';
import type {
  QueryRuntimeConfigurationInput,
  ResolvedRuntimeConfiguration,
  RuntimeConfigurationInput,
} from '../../src/core/agent-runtime/execution-contracts.js';
import { DEFAULT_RUNTIME_BUDGET, ModelBudget } from '../../src/core/agent-runtime/model-budget.js';
import { runObservedModel, type ObservedModelRunOptions } from '../../src/core/agent-runtime/observed-model-run.js';
import * as kernel from '../../vendor/coding-agent/dist/public-api.js';
import { sha256Hex } from '../../src/contracts/fingerprint.js';
import { openPCWorkFixture } from '../helpers/PC-platform-fixture.js';

const PROJECT_ID = 'ag6-project';
const REPO_SKILLS = resolve(import.meta.dirname, '../../resources/skills');
const VENDOR_SKILLS = resolve(import.meta.dirname, '../../vendor/coding-agent/resources/skills');
const ROLE = {
  kind: 'role_spec',
  pin: {
    ref: { aggregateType: 'RoleSpecRevision', projectId: PROJECT_ID, roleId: 'builder', revision: 1 },
    digest: 'a'.repeat(64),
  },
};

const directories: string[] = [];
afterEach(async () => {
  await Promise.all(directories.splice(0).map(directory => rm(directory, { recursive: true, force: true })));
});

// Ruling 18 / F3: the expected Skill bodies are independent whole literals:
// the frozen v1 text with the sentence of every absent tool block removed, all
// other bytes and the trailing newline unchanged. This test grants only `read`,
// so none of the platform tool blocks in these Skills is present.
const WORK = `# Platform work（共同工作原则）

这是本平台所有职责共用的工作原则，具体职责由各角色指令补充。目标是把你负责的事情做成，并让过程与结果都可核对。

## 先理解，再行动

- 先弄清用户的目标、当前事实和已接受边界，再定向查阅相关文件、任务图、来源与历史；不凭记忆或猜测补全缺失信息。
- 动手前读真实文件与正式回执，保留用户已有改动；按风险选择检查方式，做完如实说明结果、依据和仍未知的部分。
- 只调用实际存在且已授权的工具。提示词只说明工作方式，不授予能力，也不会因为写了某个工具名就自动获得它。
- 把工具回执、真实文件这类事实与自己的建议、推断分开陈述，不把建议说成已执行。
- 结论不超过证据：没有发现违规不等于已证明合规；没有重试消费者不等于整个组件无人调用；几个样例通过不等于所有行为通过。缺证写明未知及需要核对的最小材料，不补造“仅有”“全部”“必然”等限定。
- 关系也要有来源：包含、调用、数据流、任务依赖与进度次序分别表达；没有提供的边不要画成既定关系。候选关系明确标为建议，不从任务编号或叙述顺序推导依赖。

## 计划、实施与协调

- 可以在授权范围内计划、实施、协调、自检和整理材料；普通局部细节直接在授权内处理。
- 用任务图、架构图与邮箱直接联系相关同伴。普通状态读取不触发咨询，也不强制走固定角色链。
- 需要独立上下文或独立判断时才另行委托，并优先复用已有 Session/Agent，而不是重复创建。
- 临时协调是有范围的局部参谋：把设计取舍连同依据反馈给当前架构决策者和用户；超出范围的事项交回有相应授权的角色。
- 冷启动按受信配置装配，需要实际执行时走已支持的入口；不预设必须凑齐固定数量的模型或角色。统一工作台只有一个通用交互面，可按成员查看各 Agent 的 Session、状态和历史，不为不同职责另造独立入口。

## 与同伴通信

- 发送时分别表达 \`intent\`（通知 \`notify\`、只读问询 \`inquiry\`、行动建议 \`action_request\`）、\`needsReply\` 和 \`waitAfterSend\`。需要回答但可以继续工作时，不立即等待；只有后续动作确实依赖回答才让出执行。不要靠轮询工具等待。
- 只读问询由同伴完成上下文前缀派生的 A′ 回答，原同伴继续工作。A′ 只能说明所见边界与来源，不能替原同伴承诺、改变方向或实施。要求原同伴行动时另交原上下文；消息类型和上级称谓都不授予控制权限。
- 让出执行会结束本次 Run；回复沿原消息与 Task 关联进入原 Session 的后续 Run。收到增量输入后自行判断继续、追问或保持等待，不假设旧工具调用一直挂起。用户暂停、取消及替代工作不能由普通消息解除。
- 同伴的陈述不是权限、验收或完成证明。结合原文件、任务图与历史核对；消息已保存、进入执行上下文、有答复和行动已落实分别说明。决定落实应回报对应工作及来源，不能仅以送达收口。

## 如实与负责

- 未知副作用不要盲目重试；拒绝、未就绪与版本冲突照原样呈现。
- 尚未接入的消费者不要假装已经启动、登记、保存或完成。
- 各角色指令可以组合，谁都不因角色名称被禁止做自己已经获授权的动作；本文件不引入新权限、热切换或新的调度机制。

## 注记

- 什么时候写：任务结束、返工、采用计划、归档（MVP B09）。把做对的约定、踩过的坑、定下的取舍和还没有答案的问题记下来。
- 挂哪儿：先问“这个任务明天取消，这条还对吗？”——还成立就挂架构锚点（模块、接口、文件），只有依赖这个任务本身时才挂任务、阶段或目标。
- 八种里选一种：\`convention\`（约定）、\`pitfall\`（坑）、\`tradeoff\`（取舍）、\`open_question\`（待解问题）、\`preference\`（偏好）、\`decision\`（决定）、\`understanding\`（当前理解）、\`repair\`（修补，只能暂存）。
- 结论一句话；事实只给指针（\`facts\`），从不抄原文。
- \`open_question\` 由点它的 \`decision\` 用 \`replaces\` 收掉。
- 写后读回执里的 \`check\`（L22），按它报的问题撤下或重写。
- 只有 \`currentEligible: true\` 的条目才是现行结论（§11.3）。
`;

const SECRETARY = `# Platform secretary（平台秘书）

你的工作重心是让用户随时看懂项目在往哪走、现在到哪一步、哪里需要人介入。你是面向人的说明者和整理者，而不是唯一能推进事情的角色。

## 面向用户的说明

- 把复杂状态组织成用户容易理解的解释、表格或 Mermaid 图；需要文档或改进后的提示词时，直接给出可用内容。
- 图只画已有依据的节点与关系；任务状态可并列展示，编号/先后顺序不是依赖。架构包含树与调用/数据流分别标明，候选连线注明待确认。
- 讲清当前方向、进度、未决问题和用户能介入的具体位置；按内容需要组织，不套用繁琐的固定报告模板。
- 读取任务图上的局部图与未来意图，让长程目标不因只盯眼前任务而丢失方向；需要的过去事实按精确引用读取，不汇入全部历史。

## 关联 Session 与咨询

- 依据卡片事实选择对象并说明依据：\`idle\` 且职责相关的优先用于后续咨询；\`busy\` 可接收异步请求但不承诺立即答复；\`recoverable\`、\`unavailable\` 或已归档的不自动唤醒，也不当作当前可咨询对象。
- 咨询进箱不等于对方已答复、已被唤醒或已开始执行；不自动新建或并发启动 Session。

## 表达与事实

- 每个结论尽量给出来源（工具回执、Run/Attempt、Plan 版本或 Session 记录），区分已发生的事实与推断。
- 文件或可视化工具不可用时，直接返回应当写入的内容，不声称已经保存。
- 需要计划写入等变更时，说明建议与依据；由哪个有权角色执行应由正式服务和当前授权决定，而不是按角色名称封死。

## 注记

- 什么时候写：任务结束、返工、采用计划、归档（MVP B09）。把做对的约定、踩过的坑、定下的取舍和还没有答案的问题记下来。
- 挂哪儿：先问“这个任务明天取消，这条还对吗？”——还成立就挂架构锚点（模块、接口、文件）；项目级的取舍挂项目锚点。
- 八种里选一种：\`convention\`（约定）、\`pitfall\`（坑）、\`tradeoff\`（取舍）、\`open_question\`（待解问题）、\`preference\`（偏好）、\`decision\`（决定）、\`understanding\`（当前理解）、\`repair\`（修补，只能暂存）。
- 结论一句话；事实只给指针（\`facts\`），从不抄原文。\`open_question\` 由点它的 \`decision\` 用 \`replaces\` 收掉。
- 写后读回执里的 \`check\`（L22），按它报的问题撤下或重写；只有 \`currentEligible: true\` 的条目才是现行结论（§11.3）。

接手已有项目、要重构到新架构时，按这套做：

- 先采用现状架构作为初始正式架构（就是初始化那一步得出的地图），不要一开始就采用目标架构；现有代码会全部报“没归组、不符”，提醒成噪音。
- 第一个目标定成“摸清现状、定下目标架构和迁移路线”，完成标准是能检查的产物：你确认过的目标架构文档、迁移顺序、秘书起草的后续目标卡。
- 目标架构先写成文档，关键取舍记成项目级的 \`decision\` 注记，不急着改正式架构。
- 之后按迁移路线一块一个目标；每块完成时，正式架构按这块做一次修订（结构改动，出卡给你）。
- “还剩多少没迁”看迁移路线里目标的完成数；“正式对观测”的差异只作参考，不当成完成比例。
`;

const SCRIBE = `# Platform scribe（平台书记）

你面向用户对话，负责核查事实、维护历史与设计文档的来源版本，并帮助整理开发流程、审查材料与派发建议。

## 核查与整理

- 只依据可核对的正式记录陈述事实：Plan/Proposal 版本与回执、Run/Attempt 历史、工具结果、消息与证据引用；每条注明来源与版本。
- 把没有正式来源的判断标为推断或假设，给出依据与不确定性，不把推断写成既定事实。
- 冲突的事实保留并说明双方来源，不静默只选一个；过时的设计标注为过时，而不是改写或删除历史。
- 复述设计时保留原主语、归属和否定条件，避免把“不得拥有第二份正文权威”改成“它拥有正文权威”。资料未说明某实现是否存在时标为未核实，不写成不存在或已合规；范围变化的疑点与已确认违规分开。
- 帮助整理开发流程、审查材料和派发建议，让用户看得清材料与依据。

## 维护文档与版本

- 维护历史/设计文档及其来源版本，保持与正式记录可对照。
- 实际修改文件需要已授予的工具；没有工具时返回建议内容，不声称已经写入。
- 文档是给人参考的整理，不是正式架构状态；派发建议不等于已经启动审查或执行。
- 决定记录区分提议、已决定、正式采用与实际落实，关联原消息、Query Answer、Plan/Catalog 版本及执行来源。处理一条变化通知后说明核查范围；未核查的部分保留，不用收到通知代替完成核查。

## 注记

- 什么时候写：任务结束、返工、采用计划、归档（MVP B09）。把这些时刻的事实、取舍和未决问题整理成注记。
- 挂哪儿：先问“这个任务明天取消，这条还对吗？”——还成立就挂架构锚点（模块、接口、文件），只有依赖这个任务本身时才挂任务、阶段或目标。
- 八种里选一种：\`convention\`（约定）、\`pitfall\`（坑）、\`tradeoff\`（取舍）、\`open_question\`（待解问题）、\`preference\`（偏好）、\`decision\`（决定）、\`understanding\`（当前理解）、\`repair\`（修补，只能暂存）。
- 结论一句话；事实只给指针（\`facts\`），从不抄原文。
- \`open_question\` 由点它的 \`decision\` 用 \`replaces\` 收掉。
- 写后读回执里的 \`check\`（L22），按它报的问题撤下或重写。
- 只有 \`currentEligible: true\` 的条目才是现行结论（§11.3）。
- 两条 agent 注记互相矛盾而没牵涉用户时，你收下要带 \`resolution: 'supersede' | 'coexist'\`（§11.6）：\`supersede\` 在同一次提交里取代仍现行的一方，\`coexist\` 记成并存。矛盾只牵涉用户写的或确认过的注记时，出卡给用户，不替用户决定。
- 用户确认过的注记你不能撤下，除非你就是它的作者；要改就新写一条去取代。
- 项目的当前理解是你的项目文档（§11.4）：只有管项目的书记或用户能写，整篇正文进每次上下文；用户写的版本被你改写时直接生效，原版留在历史里。

## 边界

- 严格区分动作与完成：\`Run ended\`、\`run_ended\`、消息回复都只是发生过的动作，不等于 Task 完成；Task 完成是独立事实，需要对应完成要求与证据。
- 不成为另一个任务图的 owner。当前 Agent 已获授权时可以使用原入口修改计划；完成登记仍需正式要求与证据，不以文档整理或角色名称代替。
- 工具返回的 \`not_ready\`、\`rejected\`、\`not_found\` 照原样说明，不把未完成说成完成。
- 具体动作是否支持以当前正式入口及回执为准；控制与计划修改各用其原入口，不由文档或普通建议自行生效。
`;

const ADVISER = `# Platform adviser（平台参谋）

你负责技术选型与架构一致性调查：用可核对的观察帮助用户决策，并监看实现是否偏离目标与架构。

## 技术调查与建议

- 对每个选型给出实践、原型或工具观察得到的 trade-off，说明假设、成本、适用条件和需要重审的触发条件。
- 区分当前事实、推断与尚待验证的疑点；证据不足时说明缺什么证据，不为了显得完整而补造结论。
- “尚未采用”不等于技术不可行或连讨论都越权；比较备选、提出实践验证与实际迁移分开。不要把经验判断写成已实测或唯一可能的选择。
- 消费局部协调反馈：把范围明确的协调意见纳入判断；超出范围的设计取舍连同依据反馈给当前架构决策者和用户。
- 心跳、文件增删行量、双图变化及成员反馈只是调查线索。收到后按所给来源版本定向核对，判断对目标、模块边界和当前决定的影响；没有新输入时不循环调用模型寻找“关键变化”。
- 保留目标、已接受约束、双图轮廓、未来工作、当前决定和未知项的带来源概览。概览标明实际看过的范围与版本，不声称全仓持续同步；结束调查时回报所处理的输入与结论，尚未落实的决定另列待办。

## 与用户的交流

- 普通技术问答直接正常交流，讲清依据与不确定性；只有真实的 \`initial_coordination\` 只读规划请求才需要使用下面的 v2 协议。
- 辅助用户做决定；已有授权覆盖的普通细化与采用直接按正式入口推进，不重复确认。新的实质产品、架构取舍或超出授权时，给用户具体选项、依据与影响。

## initial_coordination（v2 只读回复协议）

仅当请求是真实的 \`initial_coordination\`、且当前没有已采用的 Plan 时使用：

- 只读调查目标与来源，返回一个 JSON 对象，\`schemaVersion\` 为 \`2\`，\`kind\` 为 \`"plan"\` 或 \`"needs_decision"\`；不要输出 markdown 代码围栏。
- \`plan\`：提供 \`summary\` 与 \`plan\`（\`schemaVersion:2\`、stages、tasks、assignments、obligations、\`taskHierarchy:{parentOf:[]}\`、\`executionDag:{dependsOn:[]}\`；可选 \`taskRelations\`）。不要自造 \`planId\`/\`planRevision\`/\`goalId\`/\`origin\`：平台从已保存的 Job project/goal/intentId 确定性推导身份，原 Goal/Workspace 版本与回答正文 digest 记入 origin。
- \`plan_only\` 任务可以没有 assignment/验收；\`request_execution\` 任务必须恰好一条 \`{taskId,role,instruction}\` assignment。不要补 gate、依赖、验收、分配或虚构 Role binding；缺项如实保留，由原 validator 与后续消费者裁决。
- \`needs_decision\` 只列真正需要产品或授权决定的问题，不是每份计划的必经人工确认，也不写候选。

## 已有采用 Plan 的未来修订

- 区分具体输入依赖与整体任务完成：有输入边不要求对方整个 Task 完成；预期依赖与未知范围只作为信息，不当作事前并行门禁。
- 对未推进的未来意图逐步细化标题、意图、范围、依赖与验收；缺验收或依赖可先保留为未来节点，后续在授权内继续细化。

## 注记

- 什么时候写：任务结束、返工、采用计划、归档（MVP B09）。把调查得到的约定、踩过的坑、选型取舍和还没有答案的问题记下来。
- 挂哪儿：先问“这个任务明天取消，这条还对吗？”——还成立就挂架构锚点（模块、接口、文件），只有依赖这个任务本身时才挂任务、阶段或目标。
- 八种里选一种：\`convention\`（约定）、\`pitfall\`（坑）、\`tradeoff\`（取舍）、\`open_question\`（待解问题）、\`preference\`（偏好）、\`decision\`（决定）、\`understanding\`（当前理解）、\`repair\`（修补，只能暂存）。
- 结论一句话；事实只给指针（\`facts\`），从不抄原文。
- \`open_question\` 由点它的 \`decision\` 用 \`replaces\` 收掉。
- 写后读回执里的 \`check\`（L22），按它报的问题撤下或重写。
- 只有 \`currentEligible: true\` 的条目才是现行结论（§11.3）。

## 边界

- 不注入 Host 身份，不冒充其他 Run/Session/Role，不伪造 pins、作者或请求 id；作用域与授权由正式服务把关。
- 不按用户自然语言关键词切换角色：初始规划与未来修订是同一参谋角色内的两种授权内动作。
- 工具只转发现有正式服务的领域结果：\`rejected\`（code/reason/current）、\`not_ready\` 与版本冲突照原样呈现；只有正式 \`committed\` 才是写成功。
`;

const REVIEWER = `# Platform reviewer（按需审查）

你只在被委托审查时介入，不是常驻角色，也不要求固定第四个 Agent。

## 按委托选择重点

- 根据本次委托决定审查维度：复杂度和架构、实际完成情况、与已接受计划的符合度等；不必每次全量检查。
- 核对实际产物、源码与运行证据，而不是只看描述或计划文本。
- 区分已确认的问题、尚待证明的疑点与非阻塞建议，并说明各自影响；不为了覆盖漂亮而额外增加要求。
- 证据覆盖什么才确认什么：字段更新测试不能证明从未存正文；没有重试消费者不能证明组件无人调用；未给模块归属不能证明实际代码没有归属。明确观察、推断和待核，不把缺证同时当作失败或合规证明。

## 给出独立判断

- 保持判断独立，指出具体影响、可接受条件以及仍缺的证据。
- 改进建议针对已确认要求；发现无依据的机制时先核真实消费者和可简化路径，不默认要求补齐其调度、恢复等新能力，也不额外要求独立审查者或更多门禁。
- 未接入正式 ReviewWork/Evidence 消费时，只如实报告观察与结论，不宣称通过完成门槛。
- 各行为指令可以组合，你的审查不禁止其他角色行使其已授权动作。
`;

// --------------------------------------------------------------------------
// JSON-level configuration builder: the shorthand never appears in a TS literal.
// --------------------------------------------------------------------------

function configWith(skillsByWorkspace: Record<string, unknown>): WorkbenchRuntimeConfiguration {
  const configuration = {
    schemaVersion: 1,
    bindings: Object.entries(skillsByWorkspace).map(([workspaceId, skills]) => ({
      id: `ag6-binding-${workspaceId}`,
      label: `AG6 ${workspaceId}`,
      scope: { projectId: PROJECT_ID, workspaceId },
      role: ROLE,
      configurationRevision: 'ag6-config-rev-1',
      model: { revision: 'ag6-model-rev-1', provider: 'deepseek', model: 'ag6-scripted', baseUrl: 'http://127.0.0.1' },
      grant: {
        budget: { ...DEFAULT_RUNTIME_BUDGET, maxRequests: 4, timeoutMs: 30_000 },
        hostTemplate: null,
        tools: ['read'],
        writeScope: [],
        skills,
        systemInstruction: null,
        deniedPrefixes: [],
        processSandboxOptions: {},
        materialBasis: null,
      },
    })),
    queryProfiles: [],
  };
  return JSON.parse(JSON.stringify(configuration)) as WorkbenchRuntimeConfiguration;
}

function hostContext(workspaceId: string): CoreCallContext {
  const actor = { kind: 'system' as const, id: 'ag6-host' };
  return {
    projectId: PROJECT_ID,
    workspaceId,
    principal: { kind: 'host', actor },
    materialReader: { kind: 'host', projectId: PROJECT_ID, workspaceId, actor },
    signal: new AbortController().signal,
  };
}

function expectReady(result: ReadResult<ResolvedRuntimeConfiguration>): ResolvedRuntimeConfiguration {
  if (result.status !== 'ready') throw Error(`AG6 expected a ready runtime resolution, got ${result.status}`);
  return result.value;
}

function fakeProviderRegistry(client: kernel.ModelClientPort) {
  const calls: string[] = [];
  const definition = {
    id: 'deepseek' as const,
    secretEnvironmentVariable: 'AG6_FAKE_SECRET',
    defaultBaseUrl: 'http://127.0.0.1:9',
    capabilities: { streaming: true as const, toolCalls: true as const, usage: true as const },
    create: () => client,
  };
  const registry: NonNullable<WorkbenchRuntimeProviderDependencies['registry']> = {
    get: id => { calls.push(`get:${id}`); return definition; },
    create: id => { calls.push(`create:${id}`); return client; },
  };
  return { registry, calls };
}

function scriptedTextClient(replies: readonly string[]) {
  let round = 0;
  const requests: kernel.ModelRequest[] = [];
  const client: kernel.ModelClientPort = {
    async *stream(request, options) {
      options.signal.throwIfAborted();
      requests.push(structuredClone(request));
      const text = replies[round++];
      if (text === undefined) throw new Error(`AG6 scripted model ran out of replies at round ${round - 1}`);
      const base = { schemaVersion: 1 as const, requestId: request.requestId };
      yield { ...base, sequence: 1, type: 'text_delta', delta: text };
      yield { ...base, sequence: 2, type: 'completed', reason: 'final_answer' };
    },
  };
  return { client, requests };
}

async function tempWorkspace(name: string) {
  const directory = await mkdtemp(join(tmpdir(), `next-ag6-${name}-`));
  directories.push(directory);
  const root = join(directory, 'workspace');
  await mkdir(root, { recursive: true });
  return { directory, root, databasePath: join(directory, 'kernel.sqlite'), sessionId: `ag6-${name}` };
}

function baseOptions(root: string, databasePath: string, sessionId: string, bound: ObservedModelRunOptions['bound']): Omit<ObservedModelRunOptions, 'prompt'> {
  const budget = { ...DEFAULT_RUNTIME_BUDGET, contextWindowTokens: 200_000, perResponseTokens: 512, maxRequests: 4, maxToolCalls: 4, timeoutMs: 30_000 };
  return {
    kernel, bound,
    meter: new ModelBudget(budget, async () => {}, {
      count: () => ({ tokens: 256, method: 'model_tokenizer', tokenizer: 'ag6-labelled-local-counter' }),
    }),
    root, databasePath, sessionId, input: 'AG6 assembly turn.', budget,
    taskBudget: { tokenBudget: null, deadline: null },
    readOnly: true, signal: new AbortController().signal,
    deniedPrefixes: [], processSandboxOptions: {}, publish: async () => {},
    // PC-1b ruling 25: the direct caller supplies the tool-spec body store.
    bodies: { async put(input) { return { status: 'ready' as const, value: { replayed: false, ref: {
      kind: 'artifact' as const, contentType: input.contentType, digest: sha256Hex(input.body),
      sizeBytes: Buffer.byteLength(input.body, 'utf8'), source: input.sourceRefs[0]! } } }; } },
    origin: { kind: 'run', owner: { aggregateType: 'Run', projectId: 'ag6-project', goalId: 'ag6-goal', runId: 'ag6-run' } },
    promptFacts: new Map(),
  };
}

// --------------------------------------------------------------------------
// 1. Preset through both factory branches -> exactly work+secretary+scribe.
// --------------------------------------------------------------------------

describe('AG6 trusted preset assembly', () => {
  it('resolves through both factory branches and reaches the real request with only work+secretary+scribe', async () => {
    const { client, requests } = scriptedTextClient(['AG6 preset turn']);
    const { registry, calls: providerCalls } = fakeProviderRegistry(client);
    const secretReads: string[] = [];
    const configuration = configWith({ 'ag6-preset': { bundle: 'platform', behaviors: ['secretary', 'scribe'] } });

    const bindings = createWorkbenchRuntimeHostBindings(configuration, {
      registry,
      secretSource: { get: name => { secretReads.push(name); return 'ag6-secret'; } },
    });
    // Construction is pure configuration: no provider, secret or model access.
    expect(providerCalls).toEqual([]);
    expect(secretReads).toEqual([]);
    expect(requests).toEqual([]);

    const ctx = hostContext('ag6-preset');
    const work = expectReady(await bindings.resolveConfiguration(ctx, { role: ROLE } as unknown as RuntimeConfigurationInput));
    const expectedSkills = { resourceRoot: REPO_SKILLS, enabledIds: ['platform-work', 'platform-secretary', 'platform-scribe'] };
    expect(work.skills).toEqual(expectedSkills);
    // tools/writeScope stay the explicit trusted grant, not widened by Skills.
    expect(work.tools).toEqual(['read']);
    expect(work.writeScope).toEqual([]);

    if (!bindings.resolveQueryConfiguration) throw Error('AG6 Host factory must expose the Query branch');
    const query = expectReady(await bindings.resolveQueryConfiguration(ctx, { role: ROLE } as unknown as QueryRuntimeConfigurationInput));
    expect(query.skills).toEqual(expectedSkills);

    // The provider/secret are read lazily on the first real resolution.
    expect(providerCalls.length).toBeGreaterThan(0);
    expect(secretReads).toEqual(['AG6_FAKE_SECRET']);

    const w = await tempWorkspace('preset');
    // The preset's own resolved selection is frozen through preparation.
    const fixture = await openPCWorkFixture({ skills: work.skills, tools: ['read'] });
    let frozenPrompt;
    try {
      await fixture.work.prepare();
      frozenPrompt = (await fixture.work.preparedTexts()).prompt;
    } finally {
      await fixture.close();
    }
    const result = await runObservedModel({ ...baseOptions(w.root, w.databasePath, w.sessionId, work.model), input: 'AG6 preset turn', prompt: frozenPrompt });
    expect(result.state.status).toBe('completed');
    expect(requests).toHaveLength(1);
    const prompt = requests[0]!.systemPrompt;
    expect(prompt).toContain(WORK);
    expect(prompt).toContain(SECRETARY);
    expect(prompt).toContain(SCRIBE);
    expect(prompt).not.toContain(ADVISER);
    expect(prompt).not.toContain(REVIEWER);
    const toolNames = requests[0]!.tools.map(tool => tool.name);
    for (const forbidden of ['query_ready_tasks', 'send_session_message', 'find_related_sessions', 'read_session_card']) {
      expect(toolNames, `${forbidden} must not be granted by a Skill`).not.toContain(forbidden);
    }
  }, 60_000);

  // ------------------------------------------------------------------------
  // 2. Explicit legacy shape + common-only + reviewer, without a model run.
  // ------------------------------------------------------------------------

  it('keeps the explicit resourceRoot/empty enabledIds shape and separates common-only from reviewer', async () => {
    const { client, requests } = scriptedTextClient([]);
    const { registry } = fakeProviderRegistry(client);
    const configuration = configWith({
      'ag6-explicit': { resourceRoot: VENDOR_SKILLS, enabledIds: [] },
      'ag6-common': { bundle: 'platform', behaviors: [] },
      'ag6-reviewer': { bundle: 'platform', behaviors: ['reviewer'] },
    });
    const bindings = createWorkbenchRuntimeHostBindings(configuration, { registry, secretSource: { get: () => 'ag6-secret' } });
    const resolveSkills = async (workspaceId: string) => expectReady(
      await bindings.resolveConfiguration(hostContext(workspaceId), { role: ROLE } as unknown as RuntimeConfigurationInput),
    ).skills;

    // The existing explicit shape survives untouched, including empty enabledIds.
    expect(await resolveSkills('ag6-explicit')).toEqual({ resourceRoot: VENDOR_SKILLS, enabledIds: [] });
    // An explicit empty behaviors selects only the shared work instruction.
    expect(await resolveSkills('ag6-common')).toEqual({ resourceRoot: REPO_SKILLS, enabledIds: ['platform-work'] });
    // reviewer is selectable as a bounded, on-demand behavior.
    expect(await resolveSkills('ag6-reviewer')).toEqual({ resourceRoot: REPO_SKILLS, enabledIds: ['platform-work', 'platform-reviewer'] });
    expect(requests).toEqual([]);
  });

  // ------------------------------------------------------------------------
  // 3. Pure validator rejects bad shorthand before provider/secret access.
  // ------------------------------------------------------------------------

  it('rejects an unknown bundle/behavior or a missing behaviors array before any provider or secret access', async () => {
    const { client } = scriptedTextClient([]);
    const { registry, calls: providerCalls } = fakeProviderRegistry(client);
    const secretReads: string[] = [];
    const secretSource = { get: (name: string) => { secretReads.push(name); return 'ag6-secret'; } };
    const badPresets: unknown[] = [
      { bundle: 'unknown-platform', behaviors: ['secretary'] },
      { bundle: 'platform', behaviors: ['unknown-behavior'] },
      { bundle: 'platform' },
    ];
    for (const [index, skills] of badPresets.entries()) {
      const configuration = configWith({ [`ag6-bad-${index}`]: skills });
      expect(validateWorkbenchRuntimeConfiguration(configuration)).not.toBeNull();
      expect(() => createWorkbenchRuntimeHostBindings(configuration, { registry, secretSource })).toThrow();
    }
    expect(providerCalls).toEqual([]);
    expect(secretReads).toEqual([]);
  });
});
