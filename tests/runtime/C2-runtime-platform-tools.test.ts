/**
 * C2 Runtime platform-tool consumer (Stage 1 skeleton).
 *
 * Adapter-shape cases are GREEN: the frozen names, the read-only registration
 * label and the structured domain rejection are pure adapter behaviour.
 *
 * The real-consumer cases run over the production `createTargetPlatform`
 * composition (real SQLite ledger + real Kernel Session + real deployed Skill
 * resources + local scripted provider). They establish the prerequisites
 * successfully and then require the Runtime to actually consume the selected
 * platform tools. That consumer path is the phase-2 target; the Stage 1 seam
 * returns an explicit `unsupported` before the provider, so those cases are RED
 * for exactly that reason and are frozen for the implementation phase.
 */
import { readFile } from 'node:fs/promises';
import { afterEach, describe, expect, it } from 'vitest';
import type { CommitCursor } from '../../src/contracts/command-event.js';
import type { CoreCallContext } from '../../src/contracts/core/call-context.js';
import type { SessionRef } from '../../src/contracts/core/identity.js';
import type { SessionMessageRef } from '../../src/contracts/core/session-message.js';
import type { SessionMessageCommandPort } from '../../src/core/work-graph/model/communication-contracts.js';
import { createSessionMailboxTools, SESSION_MAILBOX_TOOL_NAMES } from '../../src/core/agent-runtime/communication-tools.js';
import { WHITEBOARD_TOOL_NAMES } from '../../src/core/agent-runtime/whiteboard-tools.js';
import type { ModelRequest, ToolCall, ToolResult, WorkspaceSandbox } from '../../vendor/coding-agent/dist/public-api.js';
import type { ScriptedReply } from '../helpers/B2-runtime-fixture.js';
import { ALL_PLATFORM_TOOL_NAMES, C2_SAFETY_PATH, C2_SKILL_IDS, createC2RuntimePlatform, type C2RuntimePlatformFixture } from '../helpers/C2-runtime-platform-fixture.js';

const fixtures: C2RuntimePlatformFixture[] = [];
afterEach(async () => { for (const fixture of fixtures.splice(0)) await fixture.close(); });

const signal = () => new AbortController().signal;
const PROJECT = 'c2-tool-project';
const WORKSPACE = 'c2-tool-workspace';
const SESSION: SessionRef = { projectId: PROJECT, sessionId: 'c2-session' };

function toolCall(name: string, callId: string, args: Record<string, unknown>): ToolCall {
  return { schemaVersion: 1, callId, name, arguments: args as ToolCall['arguments'] };
}
function trustedContext(signalValue: AbortSignal): CoreCallContext {
  return { projectId: PROJECT, workspaceId: WORKSPACE,
    principal: { kind: 'work_run', runRef: { aggregateType: 'Run', projectId: PROJECT, goalId: 'c2-goal', runId: 'c2-run' },
      roleBinding: { schemaVersion: 1, bindingId: 'c2-binding', templateId: 'builder', templateRevision: '1', bindingVersion: 1, policyRevision: 'legacy-template' } },
    materialReader: { kind: 'run', requester: { aggregateType: 'Run', projectId: PROJECT, goalId: 'c2-goal', runId: 'c2-run' } },
    signal: signalValue };
}
function outputValue(result: ToolResult): unknown {
  const first = result.output[0];
  return first !== undefined && first.kind === 'json' ? first.value : undefined;
}
function toolMessage(request: ModelRequest | undefined, callId: string) {
  return request?.messages.find(message => message.role === 'tool' && message.callId === callId);
}
function toolJson(request: ModelRequest | undefined, callId: string): unknown {
  const message = toolMessage(request, callId);
  if (message === undefined || message.role !== 'tool' || message.result.status !== 'success') return undefined;
  const block = message.result.output.find(candidate => candidate.kind === 'json');
  return block?.kind === 'json' ? block.value : undefined;
}
function callArgs(reply: ScriptedReply | undefined): Record<string, unknown> | undefined {
  return reply !== undefined && reply.kind === 'calls' ? reply.calls[0]?.args : undefined;
}
// Ruling 18 / F3: the expected Skill bodies are independent whole literals:
// the frozen v1 text with the sentence of every absent tool block removed, all
// other bytes and the trailing newline unchanged. The granted tools in these
// cases match no platform tool block, so every such sentence is absent.
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

// decision 89 appends the skill paragraphs
const D89_ADVISER = "\n## 拆并行任务：共享件先定归属\n\n原因见共同工作原则“共享的东西只写一份”。能在开工前定下“谁来写”的只有计划和接口约定，所以这一步在你这里。目的：每个共享件开工前就有唯一负责的任务，别的任务只用它。\n\n什么时候照做：做计划、改计划时，凡是会同时进行的任务；要派一个和正在做的任务改同一个模块的任务之前。\n\n1. 列共享件。对每组会同时做的任务问一句：“它们各自单干，会各写出哪些一样的东西？”常见的有数据结构和类型、校验规则和上限、格式和解析、状态怎么变、给人看的文字、测试的辅助和夹具。\n2. 每件定一个去处。已经有的，写进相关任务的说明：“用现成的 X（某文件）”。新的只交给一个任务写，写明名字、输入和输出、放在哪；其他任务的说明写“用任务 T 提供的 X”。几乎所有任务都要的一小块，可以排成一个先做的小任务。\n   为什么：说明里写明用谁的，执行者就不必猜。先做一小块会让并行晚开始，所以只在很多任务都依赖它时这样排。\n3. 分工要放在执行者会看的地方：每个任务的说明里，和模块上的接口约定（格式见共同工作原则）。\n   - 这一轮记不了注记（例如只读的规划回答）时，把分工写进计划草案的任务说明，并写明接口约定要记什么，由之后有权写的那一轮落实；不要说已经记下。\n4. 有人请你定归属时尽快定。\n   - 这一轮记不了注记时，把定下的归属写进回答，交给之后有权写的那一轮。\n   为什么：问题挂着不答，对方只能先写一份。\n5. 收到完成说明或变化提醒时，对照里面新建的共享件和还在做的任务；有重叠，马上告诉还在做的一方改用现成的。\n   为什么：对方做完之前提醒，改一处就够；做完以后，两份都要审、都要合。\n";
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
` + D89_ADVISER;

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

const DEPLOYED_SKILLS: Readonly<Record<(typeof C2_SKILL_IDS)[number], string>> = {
  'platform-secretary': SECRETARY,
  'platform-adviser': ADVISER,
  'platform-scribe': SCRIBE,
};

describe('C2 platform tool adapters', () => {
  it('publishes the six frozen mailbox names and the workspace_read read-only registration label', () => {
    const port: SessionMessageCommandPort = {
      async sendMessage() { return { status: 'rejected', code: 'unsupported', reason: 'unused' }; },
      async readMessage() { return { status: 'not_found' }; },
      async readMessageBody() { return { status: 'not_found' }; },
      async readInbox() { return { status: 'not_found' }; },
      async ackMessage() { return { status: 'rejected', code: 'unsupported', reason: 'unused' }; },
      async respondMessage() { return { status: 'rejected', code: 'unsupported', reason: 'unused' }; },
      async withdrawMessage() { return { status: 'rejected', code: 'unsupported', reason: 'unused' }; },
      async releaseMessage() { return { status: 'rejected', code: 'unsupported', reason: 'unused' }; },
      async readMessageView() { return { status: 'not_found' }; },
      async readInboxView() { return { status: 'not_found' }; },
    };
    const handle = createSessionMailboxTools({ mailbox: port, context: trustedContext(signal()), sessionRef: SESSION,
      requestIdForCall: call => `c2:${call.name}:${call.callId}` });
    const definitions = handle.create(null as unknown as WorkspaceSandbox);
    expect(handle.names).toEqual([...SESSION_MAILBOX_TOOL_NAMES]);
    expect(definitions.map(definition => definition.name)).toEqual([...SESSION_MAILBOX_TOOL_NAMES]);
    for (const name of ['read_session_inbox', 'read_session_message', 'read_session_message_body']) {
      const definition = definitions.find(candidate => candidate.name === name)!;
      expect(definition.effectClass).toBe('read_only');
      expect(definition.requiredCapabilities).toEqual(['workspace_read']);
      expect(definition.independentReadOnly).toBe(true);
    }
    for (const name of ['send_session_message', 'ack_session_message', 'respond_session_message']) {
      const definition = definitions.find(candidate => candidate.name === name)!;
      expect(definition.effectClass).not.toBe('read_only');
      expect(definition.requiredCapabilities).toEqual([]);
      expect(definition.independentReadOnly).toBe(false);
    }
    expect(new Set([...SESSION_MAILBOX_TOOL_NAMES, ...WHITEBOARD_TOOL_NAMES]).size)
      .toBe(SESSION_MAILBOX_TOOL_NAMES.length + WHITEBOARD_TOOL_NAMES.length);
    for (const builtin of ['read', 'write', 'edit', 'shell', 'check']) expect(ALL_PLATFORM_TOOL_NAMES).not.toContain(builtin);
  });

  it('keeps a typed domain rejection in the JSON output instead of flattening it to execution_failed', async () => {
    const rejectedWrite = { status: 'rejected' as const, code: 'capacity' as const, reason: 'message text exceeds the bound' };
    const notReadyRead = { status: 'not_ready' as const, observed: null, required: { kind: 'platform' as const, cursor: 'c0000000005' as CommitCursor } };
    const port: SessionMessageCommandPort = {
      async sendMessage() { return rejectedWrite; },
      async readMessage() { return { status: 'not_found' }; },
      async readMessageBody() { return { status: 'not_found' }; },
      async readInbox() { return notReadyRead; },
      async ackMessage() { return rejectedWrite; },
      async respondMessage() { return rejectedWrite; },
      async withdrawMessage() { return rejectedWrite; },
      async releaseMessage() { return rejectedWrite; },
      async readMessageView() { return { status: 'not_found' }; },
      async readInboxView() { return notReadyRead; },
    };
    const handle = createSessionMailboxTools({ mailbox: port, context: trustedContext(signal()), sessionRef: SESSION,
      requestIdForCall: call => `c2:${call.name}:${call.callId}` });
    const definitions = handle.create(null as unknown as WorkspaceSandbox);
    const send = definitions.find(candidate => candidate.name === 'send_session_message')!;
    const sendResult = await send.handler.execute(toolCall('send_session_message', 'call-send', { recipient: SESSION, text: 'hi' }), { signal: signal() });
    expect(sendResult.status).toBe('error');
    expect(outputValue(sendResult)).toEqual(rejectedWrite);
    const inbox = definitions.find(candidate => candidate.name === 'read_session_inbox')!;
    const inboxResult = await inbox.handler.execute(toolCall('read_session_inbox', 'call-inbox', { page: { limit: 10 } }), { signal: signal() });
    expect(outputValue(inboxResult)).toEqual(notReadyRead);
  });
});

describe('C2 committed send result (phase-2 target)', () => {
  it.each(['fresh', 'replay'] as const)('a %s Host send carries its committed sendStatus', async mode => {
    const fx = await createC2RuntimePlatform({ scriptedReplies: [] });
    fixtures.push(fx);
    const request = { input: { recipient: fx.sessionRef, text: 'C2 send status' },
      meta: { requestId: 'c2-send-status', expected: [] } };
    if (mode === 'replay') await fx.platform.messages.sendMessage(fx.ctx, request);
    const sent = await fx.platform.messages.sendMessage(fx.ctx, request);
    expect(sent).toMatchObject({ status: 'committed', sendStatus: 'sent' });
  });
});

describe('C2 real Runtime consumer over the production composition (phase-2 target)', () => {
  it('runs a real inbox -> body -> respond round through the model with the three deployed skills (RED)', async () => {
    const safety = await readFile(C2_SAFETY_PATH, 'utf8');
    expect(safety.trim().length).toBeGreaterThan(0);
    let messageRef: SessionMessageRef | undefined;
    let messageRevision: number | undefined;
    const replies: ScriptedReply[] = [
      { kind: 'calls', calls: [{ callId: 'c2-inbox-1', name: 'read_session_inbox', args: { page: { limit: 10 } } }] },
      { kind: 'calls', calls: [{ callId: 'c2-body-1', name: 'read_session_message_body', args: { messageRef: {}, part: 'message' } }] },
      { kind: 'calls', calls: [{ callId: 'c2-respond-1', name: 'respond_session_message', args: { messageRef: {}, expectedRevision: 1, text: 'C2 response text' } }] },
      { kind: 'text', text: 'C2 responded to the mailbox statement' },
    ];
    const fx = await createC2RuntimePlatform({ toolNames: ['read_session_inbox', 'read_session_message_body', 'respond_session_message'],
      scriptedReplies: replies,
      beforeReply: async (request, index) => {
        if (index === 1) {
          const inbox = toolJson(request, 'c2-inbox-1') as { items?: Array<{ ref: SessionMessageRef; revision: number }> } | undefined;
          expect(inbox).toMatchObject({ items: [{ ref: { aggregateType: 'SessionMessage' }, revision: 1 }] });
          messageRef = inbox?.items?.[0]?.ref;
          messageRevision = inbox?.items?.[0]?.revision;
          const args = callArgs(replies[1]);
          if (args !== undefined) args['messageRef'] = structuredClone(messageRef);
        }
        if (index === 2) {
          expect(toolJson(request, 'c2-body-1')).toMatchObject({ text: 'C2 inbox statement', part: 'message', usage: 'message' });
          const args = callArgs(replies[2]);
          if (args !== undefined) { args['messageRef'] = structuredClone(messageRef); args['expectedRevision'] = messageRevision; }
        }
      } });
    fixtures.push(fx);
    // Real prerequisite: the Host delivers a body to the execution Session.
    const sent = await fx.platform.messages.sendMessage(fx.ctx, { input: { recipient: fx.sessionRef, text: 'C2 inbox statement' }, meta: { requestId: 'c2-host-send', expected: [] } });
    expect(sent).toMatchObject({ status: 'committed' });
    if (sent.status !== 'committed') return;
    const prepared = await fx.platform.runtime.prepareExecution(fx.ctx, { runRef: fx.runRef, requestId: 'c2-prepare-mail' });
    expect(prepared.status, JSON.stringify(prepared)).toBe('ready');
    if (prepared.status !== 'ready') return;
    const started = await fx.platform.runtime.startRun(fx.ctx, { prepared: prepared.value, consumerId: 'c2-driver', requestId: 'c2-start-mail' });
    // Phase-2 target: real Kernel round, four provider calls, success results.
    expect(started, JSON.stringify(started)).toMatchObject({ status: 'ready', value: { run: { status: 'ended' }, session: { occupancy: null } } });
    expect(fx.scripted.calls()).toBe(4);
    const responseResult = toolMessage(fx.scripted.requests[3], 'c2-respond-1');
    expect(responseResult?.role === 'tool' ? responseResult.result.status : undefined).toBe('success');
    // The three deployed skill bodies and the trusted Host safety content are in
    // the first real request.
    const systemPrompt = fx.scripted.requests[0]?.systemPrompt ?? '';
    for (const id of C2_SKILL_IDS) expect(systemPrompt).toContain(DEPLOYED_SKILLS[id]);
    expect(systemPrompt).toContain(safety);
    // Public ledger proof: the original message is responded with the domain body.
    const stored = await fx.platform.messages.readMessage(fx.ctx, sent.value.ref);
    expect(stored).toMatchObject({ status: 'ready', value: { status: 'responded' } });
    if (stored.status !== 'ready') return;
    expect(stored.value.response?.sender).toEqual({ kind: 'work_run', sessionRef: fx.firstSession,
      runRef: fx.claim.runRef, roleBinding: fx.fixture.roleBinding, generation: fx.claim.generation });
    expect((stored.value.sender as { kind: string }).kind).toBe('host');
    expect(await fx.platform.messages.readMessageBody(fx.ctx, { messageRef: sent.value.ref, part: 'response' }))
      .toMatchObject({ status: 'ready', value: { text: 'C2 response text' } });
  });

  it('exposes only the granted platform tools, skips the source authorization, and honors an explicit empty Skill set (RED)', async () => {
    const toolNames = ['read_session_inbox', 'query_task_graph'];
    const fx = await createC2RuntimePlatform({ toolNames, skillIds: [], allowSourceRead: false,
      scriptedReplies: [
        { kind: 'calls', calls: [{ callId: 'c2-graph-1', name: 'query_task_graph', args: {} }] },
        { kind: 'text', text: 'C2 queried the graph without file read' },
      ] });
    fixtures.push(fx);
    const prepared = await fx.platform.runtime.prepareExecution(fx.ctx, { runRef: fx.runRef, requestId: 'c2-prepare-min' });
    expect(prepared.status, JSON.stringify(prepared)).toBe('ready');
    if (prepared.status !== 'ready') return;
    const started = await fx.platform.runtime.startRun(fx.ctx, { prepared: prepared.value, consumerId: 'c2-driver', requestId: 'c2-start-min' });
    expect(started, JSON.stringify(started)).toMatchObject({ status: 'ready' });
    expect(fx.scripted.calls()).toBe(2);
    // A platform-only Run never resolves the source read policy.
    expect(fx.authorizeCalls()).toBe(0);
    const names = (fx.scripted.requests[0]?.tools ?? []).map(spec => spec.name);
    expect([...names].sort()).toEqual([...toolNames].sort());
    for (const forbidden of ['read', 'edit', 'write', 'shell', 'list_files', 'project_source', 'send_session_message']) {
      expect(names).not.toContain(forbidden);
    }
    // An explicit empty Skill set must not fall back to any deployed skill.
    for (const id of C2_SKILL_IDS) {
      expect(fx.scripted.requests[0]?.systemPrompt ?? '').not.toContain(DEPLOYED_SKILLS[id]);
    }
  });

  it('rejects an ungranted builtin at the real Kernel boundary, with no source authorization and no file body (RED)', async () => {
    const fx = await createC2RuntimePlatform({ toolNames: ['read_session_inbox'], allowSourceRead: false,
      scriptedReplies: [
        { kind: 'calls', calls: [{ callId: 'c2-builtin-read', name: 'read', args: { path: 'c2-read.txt' } }] },
        { kind: 'text', text: 'C2 after the denied read' },
      ] });
    fixtures.push(fx);
    const prepared = await fx.platform.runtime.prepareExecution(fx.ctx, { runRef: fx.runRef, requestId: 'c2-prepare-denied' });
    expect(prepared.status, JSON.stringify(prepared)).toBe('ready');
    if (prepared.status !== 'ready') return;
    const started = await fx.platform.runtime.startRun(fx.ctx, { prepared: prepared.value, consumerId: 'c2-driver', requestId: 'c2-start-denied' });
    expect(started, JSON.stringify(started)).toMatchObject({ status: 'ready' });
    expect(fx.authorizeCalls()).toBe(0);
    const message = toolMessage(fx.scripted.requests[1], 'c2-builtin-read');
    expect(message).toBeDefined();
    if (message !== undefined && message.role === 'tool') {
      expect(message.result.status).toBe('error');
      if (message.result.status === 'error') expect(['unknown_tool', 'permission_denied']).toContain(message.result.error.code);
    }
    const requestText = JSON.stringify(fx.scripted.requests[1]?.messages ?? []);
    expect(requestText).not.toContain('C2_REAL_READ_CONTENT');
  });

  it('refuses a Run granted the two rework tool names at the start, before any provider call (GAP-46)', async () => {
    // GAP-46: the owners accept an Agent's requeue and reverify, but no Runtime tool carries them yet. A Role and a
    // Host that grant the two names anyway meet the driver's unknown-name refusal; one case covers both names.
    const fx = await createC2RuntimePlatform({ toolNames: ['read_session_inbox', 'requeue_task', 'reverify_round'],
      allowSourceRead: false, scriptedReplies: [{ kind: 'text', text: 'C2 never reached: the start is refused' }] });
    fixtures.push(fx);
    const prepared = await fx.platform.runtime.prepareExecution(fx.ctx, { runRef: fx.runRef, requestId: 'c2-prepare-rework-tools' });
    expect(prepared.status, JSON.stringify(prepared)).toBe('ready');
    if (prepared.status !== 'ready') return;
    const started = await fx.platform.runtime.startRun(fx.ctx, { prepared: prepared.value, consumerId: 'c2-driver', requestId: 'c2-start-rework-tools' });
    expect(started, JSON.stringify(started)).toMatchObject({ status: 'rejected', code: 'unsupported' });
    const reason = started.status === 'rejected' ? started.reason : '';
    expect(reason).toMatch(/^the Run selects tool names this Runtime does not know: /);
    for (const name of ['requeue_task', 'reverify_round']) expect(reason).toContain(name);
    expect(reason).not.toContain('read_session_inbox');
    expect(fx.scripted.calls(), 'no provider call').toBe(0);
    expect(fx.authorizeCalls(), 'no source authorization').toBe(0);
  });
});
