/**
 * G8A steps (decision 121-136, `g8-rulings.md` 测试行 C1-C6) on the S6C host world (`openS6AHostWorld`, request driver
 * on). A check is installed only where the workspace has write and commands; the main S6A workspace is read-only with
 * fixed access (`S6A-request-fixture.ts:602`), so C1 and C4 use a folder the person opens with both grants: a new
 * project initialized by its first plan as S6B3/GP-1 do it (`openG8Project`, `GP-1-first-goal.test.ts:77-106`;
 * `initialization/adopt` installs the answer's `setup.checks`; the seed work Task is `plan_only`, so the seed Goal's
 * driver asks for no Run), or a second workspace of the S6A project (`addS7D2SecondWorkspace`, C4). Each such folder
 * runs K2M's 1,000,000-token model (`K2M-observed-meter.test.ts:84-88`): the catalog model's 128k local profile closes
 * a plan round's second request over budget. Lines are `sessions/create` with the scope's published profile and
 * answer from their own scripted queue (real calls). Public routes only; nothing is read from a store.
 */
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { RoleConfigurationRef, WorkspaceScope } from '../../src/contracts/core/identity.js';
import { sha256Hex } from '../../src/contracts/fingerprint.js';
import type { GoalConfirmDraftReceiptV1 } from '../../src/contracts/goal-card.js';
import type { GoalRef } from '../../src/contracts/ledger.js';
import type { PlanRevisionDraft } from '../../src/contracts/plan.js';
import type { QueryJobAnswerRef, QueryJobRef } from '../../src/contracts/query-job.js';
import type { PlanProposal } from '../../src/core/work-graph/model/plan-contracts.js';
import type { QueryJobRecord } from '../../src/core/work-graph/queries/contracts.js';
import type { RequestCoreViewV1 } from '../../src/core/work-graph/model/request-contracts.js';
import { waitFor } from '../scenarios/harness.js';
import { graphWrite, plain, writeAG2bWorkspace } from './AG2b-collaboration-fixture.js';
import { roundOf } from './FA-forms.js';
import { openS6AHostWorld, type S6AHostWorld, type S6AReply } from './S6A-host-fixture.js';
import { threeIdeas } from './S6A-history-fixture.js';
import { S6A_SECRETARY_ROLE, type S6ASession } from './S6A-request-fixture.js';
import { committed, ready } from './S7A-fixture.js';

/** A registered static command check, as `setup.checks` and (working assumption) a plan's `checks` carry it. */
export type G8Check = { checkId: string; kind: 'static'; command: string; cwd: string; timeoutMs: number;
  taskIds: 'all' | string[] };
export const g8Check = (checkId: string, taskIds: 'all' | string[], command = 'true'): G8Check =>
  ({ checkId, kind: 'static', command, cwd: '.', timeoutMs: 60_000, taskIds });

/**
 * A plan form (no `phase`): `<tag>-work` (assigned to `role`) and, unless `segment` (SEC's shape), `<tag>-gate`, under
 * one required static obligation; `checks` kept beside the tasks here and moved by `g8PlanCall` / `g8SplitChecks` to where
 * the platform takes them (the form's and the propose request's `checks`).
 */
export function g8PlanForm(tag: string, role: string, checks?: G8Check[], segment = false): Record<string, unknown> {
  const taskIds = segment ? [`${tag}-work`] : [`${tag}-work`, `${tag}-gate`];
  return { stages: [], tasks: taskIds.map(taskId => ({ taskId, title: taskId, requirementLevel: 'required',
    disposition: 'active', scope: { kind: 'goal' },
    ...(taskId.endsWith('-work') ? { taskKind: 'work', executionIntent: 'request_execution' } : { taskKind: 'gate' }) })),
  assignments: [{ taskId: `${tag}-work`, role, instruction: `${tag} instruction` }],
  obligations: [{ obligationId: `${tag}-delivery`, title: `${tag} delivery`, requirementLevel: 'required', taskIds,
    verificationRequirements: [{ requirementId: `${tag}-static`, requirementLevel: 'required', kind: 'static',
      description: `${tag} static check` }] }],
  taskHierarchy: { parentOf: [] }, executionDag: { dependsOn: [] }, taskRelations: [], inputRequirements: [],
  ...(checks === undefined ? {} : { checks }) };
}
/** The same plan as a `plans/propose` draft of `goal` (revision 1, every Task pending). */
export function g8PlanDraft(goal: GoalRef, tag: string, role: string, checks?: G8Check[]): PlanRevisionDraft {
  const form = g8PlanForm(tag, role, checks);
  return { ...form, schemaVersion: 2, planId: `${tag}-plan`, planRevision: 1, goalId: goal.goalId,
    tasks: (form['tasks'] as object[]).map(task => ({ ...task, phase: 'pending' })) } as unknown as PlanRevisionDraft;
}
/** The plan round's submit: the plan's own `checks` ride beside `plan` on the form (`PlanRoundForm.checks`). */
export const g8PlanCall = (callId: string, plan: object): S6AReply => {
  const { checks, ...draft } = plan as { checks?: G8Check[] };
  return { kind: 'calls', calls: [{ callId, name: 'submit_plan_round',
    args: { answerKind: 'plan', summary: `${callId} summary`, plan: draft, ...(checks === undefined ? {} : { checks }) } }] };
};
/** A `plans/propose` draft and its checks apart: the checks ride on the request (`ProposedPlanDraftRequestV1.checks`). */
export function g8SplitChecks(draft: PlanRevisionDraft): { draft: PlanRevisionDraft; checks?: G8Check[] } {
  const { checks, ...rest } = draft as unknown as { checks?: G8Check[] };
  return { draft: rest as unknown as PlanRevisionDraft, ...(checks === undefined ? {} : { checks }) };
}
const goalCard = (objective: string) => ({ objective, completion: [`${objective} is done`],
  autonomy: 'after_plan_confirmation', screening: null });

/** K2M's model saved in the Host catalog; answers its id. */
export async function g8ModelId(world: S6AHostWorld): Promise<string> {
  const saved = await world.settings('models/save', { label: 'G8 v4.1 flash', provider: 'deepseek',
    model: 'deepseek-v4.1-flash', apiKey: 'g8-synthetic-key' });
  const id = saved.status === 'ready' ? saved.value.models.find(entry => entry.model === 'deepseek-v4.1-flash')?.id : undefined;
  if (id === undefined) throw new Error(`G8: models/save: ${JSON.stringify(saved)}`);
  return id;
}

export type G8Workspace = ReturnType<typeof g8Steps>;
/** The public steps on one workspace of the world. */
export function g8Steps(world: S6AHostWorld, scope: WorkspaceScope, label: string) {
  const send = async (route: string, body: unknown) => (await world.post(route, body)).body;
  const read = async <T>(route: string, input: unknown): Promise<T> => ready<T>(await world.post(route, plain(scope, input)), route);
  const view = (requestRoot: QueryJobRef) => read<RequestCoreViewV1>('requests/read', { requestRoot });
  const roundEnded = (requestRoot: QueryJobRef, round: QueryJobRef) => waitFor(() => view(requestRoot), current =>
    !['queued', 'running'].includes(current.rounds.find(entry => entry.ref.queryJobId === round.queryJobId)?.status
      ?? 'queued'), `G8: ${round.queryJobId} to end`);
  let seq = 0;
  return { world, scope, read, post: send, roundEnded,
    /** The round as `requests/read` lists it. */
    async readRound(requestRoot: QueryJobRef, round: QueryJobRef) { return roundOf(await view(requestRoot), round); },
    /** `sessions/create` with `role`, or the scope's published secretary profile's role. */
    async line(name: string, role?: RoleConfigurationRef): Promise<S6ASession> {
      const sessionRole = role ?? (await world.readProfiles()).find(profile => profile.scope.workspaceId === scope.workspaceId
        && profile.sessionRole.kind === 'legacy_template' && profile.sessionRole.templateId === S6A_SECRETARY_ROLE.templateId)
        ?.sessionRole;
      const created = await send('sessions/create', plain(scope, { workspace: scope, role: sessionRole, recommendedRefs: [],
        initialLinks: [], meta: { requestId: `${label}-line-${name}`, expected: [] } })) as
        { status: string; value: { ref: S6ASession['aggregateRef']; createdAt: string } };
      if (created.status !== 'completed' || sessionRole === undefined) throw new Error(`G8: ${JSON.stringify(created)}`);
      return { label: name, ref: { projectId: created.value.ref.projectId, sessionId: created.value.ref.sessionId },
        aggregateRef: created.value.ref, role: structuredClone(sessionRole), createdAt: created.value.createdAt };
    },
    /** `requests/submit` to `to` (no Goal unless `goal`); waits until the round is no longer queued or running. */
    async ask(name: string, to: S6ASession, goal?: GoalRef) {
      const submitted = await send('requests/submit', plain(scope, { commandId: `${label}-${name}-${++seq}`,
        goalId: goal?.goalId ?? null, text: `${name} request`, continues: null, recipient: to.ref })) as
        { status: string; requestRoot: QueryJobRef; round: QueryJobRef };
      if (submitted.status !== 'queued') throw new Error(`G8: requests/submit: ${JSON.stringify(submitted)}`);
      await roundEnded(submitted.requestRoot, submitted.round);
      return { requestRoot: submitted.requestRoot, round: submitted.round };
    },
    /** The head of `plans/request-candidate` once there is one. */
    async candidate(goal: GoalRef, requestRoot: QueryJobRef): Promise<PlanProposal> {
      return (await waitFor(() => read<{ head: PlanProposal | null }>('plans/request-candidate',
        { goalRef: goal, requestRef: requestRoot }), value => value.head !== null, 'G8: a request candidate')).head!;
    },
    /** `plans/apply` by the person (the Host's human operator); answers the route's body. */
    async apply(goal: GoalRef, head: PlanProposal, commandId: string) {
      const goalRead = await read<{ goal: { revision: number } }>('goals/read', goal);
      return await send('plans/apply', graphWrite(scope, { proposalRef: head.ref, expectedProposalRevision: head.revision,
        decisionRefs: [] }, commandId, [{ ref: goal, revision: goalRead.goal.revision }]));
    },
    /** This workspace as the Host settings `snapshot` lists it (its check configuration included). */
    async settingsEntry() {
      const snapshot = await world.settings('snapshot', {});
      const entry = snapshot.status === 'ready' ? snapshot.value.workspaces.find(workspace =>
        workspace.scope.workspaceId === scope.workspaceId) : undefined;
      if (entry === undefined) throw new Error(`G8: the snapshot lists no ${scope.workspaceId}: ${JSON.stringify(snapshot)}`);
      return entry;
    },
  };
}

/** The new granted project, its first plan adopted with `seedChecks` installed by `initialization/adopt`.
 *  `scribeReminderPeriodMs`：Host 的提醒周期，默认不传（Host 用 60 秒）。传 25 时 `heartbeat` 一趟就是一轮消费（同 G8B 的世界）。 */
export async function openG8Project(label: string, seedChecks: G8Check[], scribeReminderPeriodMs?: number) {
  const world = await openS6AHostWorld({ backend: 'memory', defaultGoals: false, extraHostOptions: { requestDriver: 'on',
    ...(scribeReminderPeriodMs === undefined ? {} : { scribeReminderPeriodMs }) } });
  const root = await mkdtemp(join(tmpdir(), `${label}-project-`));
  const close = async () => { await world.close(); await rm(root, { recursive: true, force: true }); };
  try {
    await writeAG2bWorkspace(root);
    const opened = await world.settings('workspaces/open', { path: root, name: label, modelId: await g8ModelId(world),
      writeAllowed: true, commandsAllowed: true });
    if (opened.status !== 'ready') throw new Error(`G8: workspaces/open: ${JSON.stringify(opened)}`);
    const steps = g8Steps(world, { projectId: opened.value.scope.projectId, workspaceId: opened.value.scope.workspaceId },
      label);
    await world.settleDetached();
    const secretary = await steps.line('seed-secretary');
    const plan: Record<string, unknown> = { ...g8PlanForm('g8-seed', 'local-workbench'), assignments: [] };
    (plan['tasks'] as Record<string, unknown>[])[0]!['executionIntent'] = 'plan_only';
    await world.scripted.script(secretary, [{ kind: 'calls', calls: [{ callId: `${label}-initial`, name: 'submit_initial_plan',
      args: { summary: `${label} first plan`, plan, goalCardDrafts: [goalCard(`${label} seed goal`)], planDraftIndex: 0,
        setup: { architecture: { baselineId: `${label}-baseline`, description: 'G8 governance', constraints: [],
          catalog: { modules: [], dependencies: [] } },
        completionPolicy: { requirementKinds: ['static'], minimumRequiredRequirementsPerObligation: 1 },
        checks: seedChecks } } }] }], steps.scope);
    const initial = await steps.ask('initial', secretary);
    const answerRef = (await steps.read<QueryJobRecord>('queries/read', initial.round)).job.job.answerRefs.at(-1) as
      QueryJobAnswerRef;
    const answerText = (await steps.read<{ answer: { answer: string } }>('queries/answer', answerRef)).answer.answer;
    const seedGoal = committed<GoalConfirmDraftReceiptV1>(await world.post('goals/confirm-draft', plain(steps.scope,
      { commandId: `${label}-confirm-seed`, round: initial.round, index: 0 })), 'G8: the seed card').goal.ref;
    committed(await world.post('initialization/adopt', plain(steps.scope, { commandId: `${label}-adopt`,
      expectedAnswerDigest: sha256Hex(answerText), source: { kind: 'binding', answerRef, draftIndex: 0 },
      expectedGoal: { ref: seedGoal, revision: 1 } })), 'G8: initialization/adopt');
    return { ...steps, seedGoal, seedAnswer: answerRef, close };
  } catch (error) {
    await close();
    throw error;
  }
}

/**
 * A new Goal through its first plan round (G6F G3's flow): a request with no Goal answered by `submit_secretary_answer`
 * (one goal card, three ideas), `goals/confirm-draft`, `requests/select-idea` of idea 1, and the plan round on the same
 * line answered by `planRound`.
 */
export async function g8NewGoal(steps: G8Workspace, label: string, planRound: S6AReply[]) {
  const secretary = await steps.line(`${label}-secretary`);
  await steps.world.scripted.script(secretary, [{ kind: 'calls', calls: [{ callId: `${label}-ideas`,
    name: 'submit_secretary_answer', args: { body: `${label} ideas`, ideas: threeIdeas(label),
      goalCardDrafts: [goalCard(`${label} goal`)] } }] }, ...planRound], steps.scope);
  const first = await steps.ask(label, secretary);
  const goal = committed<GoalConfirmDraftReceiptV1>(await steps.world.post('goals/confirm-draft', plain(steps.scope,
    { commandId: `${label}-confirm`, round: first.round, index: 0 })), `${label}: the card`).goal.ref;
  const selected = await steps.post('requests/select-idea', plain(steps.scope, { commandId: `${label}-select`,
    round: first.round, index: 0 })) as { status: string; followupRound: QueryJobRef };
  if (selected.status !== 'queued') throw new Error(`${label}: requests/select-idea: ${JSON.stringify(selected)}`);
  await steps.roundEnded(first.requestRoot, selected.followupRound);
  return { goal, requestRoot: first.requestRoot, planRound: selected.followupRound, secretary };
}
