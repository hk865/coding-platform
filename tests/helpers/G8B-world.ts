/**
 * G8B-1a 的世界和步骤（决定 121-136、121-138；冻结裁定 `g8b-rulings.md` 的 B1，测试行 D1–D4、D7、D10）。
 *
 * 不另建世界，照 G8A C4 搭（`G8-plan-checks.test.ts:79-88`）：`openS6AHostWorld`（请求驱动开）、`initializeProject`，
 * `addS7D2SecondWorkspace` 经 Host 的 `workspaces/open` 打开同项目的第二个工作区，能写、能跑命令（检查才装得上，
 * 改动前的事实才跑得成），再 `models/select` 选 K2M 的 1,000,000 token 模型（`g8ModelId`）。选了模型以后，Host 为这个
 * 工作区发布内置的秘书、参谋、审阅者、执行者 Query 档案并消费这些线（`S9-review-fixture.ts:171-176` 同一个做法）。
 * 这里只加 G8B 的步骤：
 * - `line`：按这个工作区发布的档案 `sessions/create` 一条某职责的线（`g8Steps.line`，按模板选档案）。
 * - `goal`：`goals/create` 一个目标（`objective` 由行自己起，30 字以内），`goals/settings/set` 定档位，可选经
 *   `goals/adviser-queue/assign` 把参谋线指派成它的负责参谋（L35 读到的那条），可选由人 `plans/propose` +
 *   `plans/apply` 采用一份底计划 v1（`g8PlanDraft`）。
 * - 读：一条线收件箱里平台发的系统轮（按正文题头前缀）、目标的请知悉（`noticeKeys` 记下行开始前已有的）、等人回答的
 *   候选卡、计划版本、设置快照里这个工作区的条目（`g8Steps.settingsEntry`）。
 * - 完成屏障（规则 A3，同 C4）：包住 Host 真实入口 `platform.workflow.proposeFromPlanTurn` 和 `handleIntervention`
 *   的委托 wrapper，原样调用，只记下 Host 自己那次调用返回了什么。
 * 只走公开路由；不读库。
 */
import { expect, vi } from 'vitest';
import type { PlanRoundEndResultV1, PlanTurnFactsV1 } from '../../src/business/workflow/ports.js';
import type { CoreCallContext } from '../../src/contracts/core/call-context.js';
import type { RoleConfigurationRef, WorkspaceScope } from '../../src/contracts/core/identity.js';
import type { SessionMessageRef } from '../../src/contracts/core/session-message.js';
import type { ArtifactRef } from '../../src/contracts/artifact.js';
import type { VerificationRoundRef } from '../../src/contracts/verification.js';
import type { GoalRef } from '../../src/contracts/ledger.js';
import type { QueryJobRef } from '../../src/contracts/query-job.js';
import type { SessionMessage } from '../../src/core/work-graph/model/communication-contracts.js';
import type { DecisionCardV1, NoticeItemV1 } from '../../src/core/work-graph/model/decision-contracts.js';
import { sessionMessageRefKey } from '../../src/core/work-graph/sessions/message-record-codecs.js';
import { waitFor } from '../scenarios/harness.js';
import { graphWrite } from './AG2b-collaboration-fixture.js';
import { g8ModelId, g8PlanDraft, g8SplitChecks, g8Steps } from './G8-world.js';
import { heartbeatUntil } from './IV-host-fixture.js';
import { adoptPLPlanDraft } from './PL-workflow-fixture.js';
import { initializeProject } from './S6A-history-fixture.js';
import { openS6AHostWorld, type S6AHostWorld } from './S6A-host-fixture.js';
import { S6A_SCOPE, type S6ASession } from './S6A-request-fixture.js';
import { kls2cNoteWrite } from './KLS2C-knowledge-host.js';
import { committed } from './S7A-fixture.js';
import { addS7D2SecondWorkspace, type S7D2SecondWorkspace } from './S7D2-role-line-world.js';

/** 计划里工作任务派给的角色（C4 的 `ROLE`）。 */
export const G8B_ROLE = 'local-workbench';
/** 工作区选了模型后 Host 发布的内置档案的模板。 */
export const G8B_TEMPLATE = { secretary: 'platform-secretary', adviser: 'platform-adviser',
  reviewer: 'platform-reviewer', executor: 'local-workbench' } as const;

type PlanTurnEntry = (ctx: CoreCallContext, turn: PlanTurnFactsV1) => Promise<PlanRoundEndResultV1>;
type InterventionEntry = (ctx: CoreCallContext, input: { messageRef: SessionMessageRef }) => Promise<{ status: string }>;
export type G8BRound = { message: SessionMessage; text: string };

export type G8BWorld = Awaited<ReturnType<typeof openG8BWorld>>;
/** 只开内存后端：这些都是业务行（RULES S3，lead 11-17 补充裁定 ②）。 */
export async function openG8BWorld(label: string) {
  // 25 毫秒的提醒周期让 Host 的消费循环每 25 毫秒醒一次（`host.ts:3856-3857`），`heartbeatUntil` 拨一次钟就是一轮
  // （SCRV、XWR 的世界同样这样给）。
  const world: S6AHostWorld = await openS6AHostWorld({ backend: 'memory',
    extraHostOptions: { requestDriver: 'on', scribeReminderPeriodMs: 25 } });
  let second: S7D2SecondWorkspace | null = null;
  const restores: (() => void)[] = [];
  const close = async (): Promise<void> => {
    for (const restore of restores.splice(0)) restore();
    try { await world.close(); } finally { await second?.remove(); }
  };
  try {
    await initializeProject(world);
    // 它自己会建一个 `<label>-goal`；行的目标另起 `<tag>-goal`，所以这里换一个前缀。
    second = await addS7D2SecondWorkspace(world, `${label}-ws`, { writeAllowed: true, commandsAllowed: true });
    const selected = await world.settings('models/select', { scope: second.scope, modelId: await g8ModelId(world) });
    if (selected.status !== 'ready') throw new Error(`G8B: models/select: ${JSON.stringify(selected)}`);
    const ws = second.workspace;
    const steps = g8Steps(world, second.scope, label);

    // 完成屏障：Host 每一轮都从 `platform.workflow` 上读这两个入口；wrapper 原样调用，记下返回。
    const workflow = world.platform.workflow as unknown as
      { proposeFromPlanTurn: PlanTurnEntry; handleIntervention: InterventionEntry };
    const turns = new Map<string, PlanRoundEndResultV1>();
    const interventions = new Map<string, string[]>();
    const realTurn = workflow.proposeFromPlanTurn;
    const realIntervention = workflow.handleIntervention;
    const turnSpy = vi.spyOn(workflow, 'proposeFromPlanTurn').mockImplementation(async (ctx, turn) => {
      const result = await realTurn.call(workflow, ctx, turn);
      turns.set(turn.ref.queryJobId, result);
      return result;
    });
    const interventionSpy = vi.spyOn(workflow, 'handleIntervention').mockImplementation(async (ctx, input) => {
      const result = await realIntervention.call(workflow, ctx, input);
      const key = sessionMessageRefKey(input.messageRef);
      interventions.set(key, [...(interventions.get(key) ?? []), result.status]);
      return result;
    });
    restores.push(() => { turnSpy.mockRestore(); interventionSpy.mockRestore(); });

    const inbox = async (line: S6ASession): Promise<SessionMessage[]> =>
      (await steps.read<{ items: SessionMessage[] }>('messages/inbox', { recipient: line.ref, page: { limit: 50 } })).items;
    const bodyOf = async (ref: SessionMessageRef): Promise<string> =>
      (await steps.read<{ text: string }>('messages/body', { messageRef: ref, part: 'message' })).text;
    /** `line` 收件箱里平台系统身份发的、正文以 `prefix` 开头的消息（收件箱的顺序）。 */
    async function rounds(line: S6ASession, prefix: string): Promise<G8BRound[]> {
      const found: G8BRound[] = [];
      for (const message of await inbox(line)) {
        if (message.sender.kind !== 'host' || message.sender.actor.kind !== 'system') continue;
        const text = await bodyOf(message.ref);
        if (text.startsWith(prefix)) found.push({ message, text });
      }
      return found;
    }

    return { world, second, scope: second.scope, ws, steps, close,
      /** 这个工作区发布的 `template` 档案上的一条新线。 */
      async line(name: string, template: string): Promise<S6ASession> {
        const role = (await world.readProfiles()).find(profile => profile.scope.workspaceId === ws.scope.workspaceId
          && profile.sessionRole.kind === 'legacy_template' && profile.sessionRole.templateId === template)?.sessionRole;
        if (role === undefined) throw new Error(`G8B: the workspace publishes no ${template} profile`);
        return await steps.line(name, role as RoleConfigurationRef);
      },
      /** `<tag>-goal`：定档位；`adviser` 指派成负责参谋；`base` 时人采用底计划 v1（`<tag>-base-work` 和关口）。 */
      async goal(tag: string, objective: string, options: { adviser?: S6ASession; base?: boolean;
        autonomy?: 'after_plan_confirmation' | 'every_step' } = {}): Promise<GoalRef> {
        const goal = (await ws.createGoal(`${tag}-goal`, objective)).ref;
        const read = await steps.read<{ goal: { revision: number } }>('goals/read', goal);
        committed(await world.post('goals/settings/set', graphWrite(ws.scope, { goalRef: goal,
          autonomy: options.autonomy ?? 'after_plan_confirmation', waitForGoalRef: null }, `${tag}-autonomy`,
        [{ ref: goal, revision: read.goal.revision }])), `${tag}: the autonomy`);
        if (options.adviser !== undefined) {
          const queue = await steps.read<{ revision: number }>('goals/adviser-queue', {});
          committed(await world.post('goals/adviser-queue/assign', graphWrite(ws.scope, { goalRef: goal,
            adviser: options.adviser.ref, expectedRevision: queue.revision }, `${tag}-assign`)), `${tag}: the adviser`);
        }
        if (options.base === true) await adoptPLPlanDraft(ws, goal, g8PlanDraft(goal, `${tag}-base`, G8B_ROLE), tag);
        return goal;
      },
      inbox, bodyOf, rounds,
      /** 等 `line` 收到 `prefix` 的系统轮（有界的 Host 轮次）；到不了就返回空表，由行自己断言。 */
      async roundsAfter(line: S6ASession, prefix: string, passes = 16): Promise<G8BRound[]> {
        return await heartbeatUntil(world, () => rounds(line, prefix), found => found.length > 0, passes);
      },
      /** Host 轮次，直到这条消息有了回复或被撤回。 */
      async settled(ref: SessionMessageRef, passes = 32): Promise<SessionMessage> {
        return await heartbeatUntil(world, () => steps.read<SessionMessage>('messages/read', ref),
          message => message.response !== null || message.withdrawnAt !== null, passes);
      },
      /** Host 自己对这一轮请求的计划轮入口返回了什么（完成屏障）。 */
      async turnEnded(round: QueryJobRef): Promise<PlanRoundEndResultV1> {
        return (await waitFor(async () => turns.get(round.queryJobId), result => result !== undefined,
          `G8B: the Host's own plan turn of ${round.queryJobId}`))!;
      },
      /** Host 对这条消息的干预入口依次返回的状态，等到出现 `status` 为止。 */
      async interventionReached(ref: SessionMessageRef, status: string, passes = 32): Promise<string[]> {
        const key = sessionMessageRefKey(ref);
        return await heartbeatUntil(world, async () => interventions.get(key) ?? [], seen => seen.includes(status), passes);
      },
      /** 这个目标现有的请知悉（`project_notice`）的条目键。 */
      async noticeKeys(goal: GoalRef): Promise<Set<string>> {
        return new Set((await ws.readNotices({ goal, categories: ['project_notice'] })).notices.map(item => item.itemKey));
      },
      /** 这个目标在 `before` 之后多出来的请知悉。 */
      async newNotices(goal: GoalRef, before: ReadonlySet<string>): Promise<NoticeItemV1[]> {
        return (await ws.readNotices({ goal, categories: ['project_notice'] })).notices
          .filter(item => !before.has(item.itemKey));
      },
      /** 这个目标等人回答的候选卡。 */
      async candidateCards(goal: GoalRef): Promise<DecisionCardV1[]> {
        return (await ws.readCards(goal)).filter(card => card.source.kind === 'candidate' && card.state === 'waiting_answer');
      },
      async planRevision(goal: GoalRef): Promise<number | null> {
        return (await ws.activePlan(goal))?.planRevision ?? null;
      },
      /** 人启动目标：`executor` 回一段文字，`workflow/driver-start` 选 `taskId`；有界地等这个任务的检查轮（40 趟）并读回它，
       *  等不到就报错（D5、G6R2 T3 共用）。 */
      async firstCheckRound(goal: GoalRef, executor: S6ASession, taskId: string, text: string) {
        await world.scripted.script(executor, [{ kind: 'text', text }], steps.scope);
        await steps.read('workflow/driver-start', { advance: { schemaVersion: 1, goalRef: goal, flowId: `${taskId}-driver`,
          sessionHint: null, kind: 'select_work', taskId }, queryProfileIds: [] });
        const planRef = (await steps.read<{ goal: { activePlanRevision: unknown } }>('goals/read', goal)).goal.activePlanRevision;
        const node = { kind: 'task', ref: { projectId: goal.projectId, goalId: goal.goalId, taskId }, planRef };
        const look = () => steps.read<{ items: { round: { ref: unknown } }[] }>('graph/look', { goalRef: goal,
          target: { kind: 'node', node }, relation: 'checks', page: { afterCursor: null, limit: 10 } });
        const [opened] = (await heartbeatUntil(world, look, found => found.items.length > 0, 40)).items;
        if (opened === undefined) throw new Error(`G8B: no check round of ${taskId}`);
        return await steps.read<{ roundRef: VerificationRoundRef; outcome: string; checks: { checkId: string; definition: { command?: string };
          reportRef: ArtifactRef | null }[]; gaps: { coverage?: { requirementId: string } }[] }>(
          'verification/round', { roundRef: opened.round.ref });
      },
    };
  } catch (error) {
    await close();
    throw error;
  }
}

/** A8（P0）：人经 `notes/write` 写一条挂在模块上的注记（主工作区 scope，`goalId: null`），答回写回执的 `noteId`。 */
export async function p0PersonNote(w: G8BWorld, commandId: string, moduleId = 's6a-core'): Promise<string> {
  const answer = await w.world.post('notes/write',
    kls2cNoteWrite(S6A_SCOPE, commandId, { topic: commandId, anchor: { kind: 'module', moduleId } }));
  const write = (answer.body as { write?: { status?: string; noteId?: string } }).write;
  if (write?.status !== 'accepted' || write.noteId === undefined) {
    throw new Error(`P0: the person's module note was not written: ${JSON.stringify(answer.body)}`);
  }
  return write.noteId;
}
/** A8（P0）：`{ memory: ... }` 的 lookup 调用（T1、T2、T6、T7、T11 共用）。 */
export const p0Lookup = (callId: string, moduleId = 's6a-core') => ({ callId, name: 'look_graph',
  args: { memory: { v: 1, op: 'lookup', anchor: { kind: 'module', moduleId } } } });
/** B15（P0）：计划审阅、批检查轮的 history 调用；`runId` 指向本目标一个不存在的 Run（T3–T5 共用）。 */
export const p0History = (callId: string, goal: GoalRef) => ({ callId, name: 'look_graph', args: {
  mode: 'history', runRef: { aggregateType: 'Run', projectId: goal.projectId, goalId: goal.goalId, runId: 'p0-b15-run' } } });
/** P0：一轮的首个模型请求里模型看到的工具名（第四节手推的名单，T3–T5）。 */
export async function p0ToolNames(w: G8BWorld, line: S6ASession, index: number): Promise<string[]> {
  return (await w.world.scripted.requests(line, w.scope))[index]!.tools.map(tool => tool.name);
}
/** 第四节手推：审阅者的读工具（内置授予 `host.ts:484`、`read` 的探索子集 `:217`、DeepSeek 的网页工具 `:513`）。 */
export const P0_REVIEWER_TOOLS = ['read', 'list_files', 'search', 'symbols', 'code_index', 'project_source',
  'python_index', 'cpp_index', 'source_excerpt', 'look_graph', 'find_graph', 'check_links', 'web_search', 'web_fetch',
  'run_readonly_command'];
/** B15（P0）的同一句：工具结果的 message 和输出的 reason（Q2）。 */
export const P0_B15 = 'a plan review or check review round cannot read execution history or evidence (B15)';

/** A8（P0）：记忆写法的读回（T1、T2、T6–T8、T11 共用）：结果成功、读回的页 ready、页的 `items` 里有这条注记。 */
export function expectNoteRead(result: unknown, noteId: string, label: string): Record<string, unknown> {
  expect.soft(result, `${label}: the note read`).toMatchObject({ status: 'success',
    output: [{ kind: 'json', value: { status: 'ready' } }] });
  const page = (result as { output?: { value?: { value?: { items?: unknown[] } } }[] } | undefined)
    ?.output?.[0]?.value?.value;
  const item = page?.items?.find(entry => (entry as { noteId?: unknown } | null)?.noteId === noteId);
  expect.soft(item, `${label}: the note id`).toMatchObject({ noteId });
  return (item ?? {}) as Record<string, unknown>;
}

/** B15（P0）：计划审阅、批检查轮的历史或报告读回同一句拒绝（T3–T5、T10 共用）。 */
export function expectB15(result: unknown, label: string): void {
  expect.soft(result, `${label}: ${P0_B15}`).toMatchObject({ status: 'error',
    error: { code: 'execution_failed', message: P0_B15 } });
  expect.soft((result as { output?: unknown } | undefined)?.output).toEqual([{ kind: 'json',
    value: { status: 'rejected', code: 'forbidden', reason: P0_B15 } }]);
}

/** 系统轮第二行 `subject: <json>`（平台写的事实）。 */
export function g8bSubjectOf(text: string): Record<string, unknown> {
  return JSON.parse((text.split('\n')[1] ?? '').replace(/^subject: /, '')) as Record<string, unknown>;
}

/** 批准者的 `submit_check_review` 回答（裁定 B1d 的表单：候选和版本由工具从 `subject` 填）。 */
export function g8bCheckReview(callId: string, verdicts: { checkId: string; decision: 'approve' | 'to_person';
  reason: string }[]) {
  return { kind: 'calls' as const, calls: [{ callId, name: 'submit_check_review', args: { verdicts } }] };
}

/** 人 `plans/propose` + `plans/apply` 一份带 `checks` 的计划（G8A：人采用时装上；D5、G6R2 T3 共用）。
 *  `draft` 用来换一份要采用的计划（P0 T10 把检查报告声明成任务输入）。 */
export async function adoptWithChecks(world: S6AHostWorld, scope: WorkspaceScope, goal: GoalRef, tag: string,
  checks: object[], draft = g8SplitChecks(g8PlanDraft(goal, tag, G8B_ROLE)).draft) {
  const proposed = committed<{ ref: unknown; revision: number }>(await world.post('plans/propose', graphWrite(scope, {
    goalRef: goal, basedOn: null, draft, checks, reason: { text: tag, sources: [] } }, `${tag}-propose`)), `${tag}: propose`);
  committed(await world.post('plans/apply', graphWrite(scope, { proposalRef: proposed.ref,
    expectedProposalRevision: proposed.revision, decisionRefs: [] }, `${tag}-apply`)), `${tag}: the person adopts`);
}
