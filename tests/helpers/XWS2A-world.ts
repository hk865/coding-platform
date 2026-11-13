/**
 * XWS2A's world: the 7D2 role-line world (`openS7D2RoleLineWorld`) plus the project's second workspace
 * (`addS7D2SecondWorkspace`, the Host's own `workspaces/open` and its `workspace_join` birth).
 *
 * Every state comes from a public step: the opening lines and governance of `openS7D2RoleLineWorld`, the second
 * workspace through the Host settings route, the opening adviser's coarse-split exploration through the scripted
 * model's `propose_architecture_revision` call, and the person's approval through `decisions/answer`. No record,
 * context or store is read or written here; the reads are `role-lines/operations`, `role-lines/read`,
 * `sessions/find`, `sessions/read`, `queries/read`, `messages/inbox`, `messages/read`, `architecture/read`,
 * `architecture/proposals/read`, `executions/read` and `tasks/query`.
 */
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { ArchitectureCatalogPinV1, ModuleDefinition } from '../../src/contracts/architecture-catalog.js';
import type { ArchitectureProposalRef, ProposalRead } from '../../src/contracts/architecture-proposal.js';
import type { CoreCallContext } from '../../src/contracts/core/call-context.js';
import type { SessionRef, WorkspaceScope } from '../../src/contracts/core/identity.js';
import type { OperationRef } from '../../src/contracts/core/operations.js';
import type { QueryJobRef } from '../../src/contracts/query-job.js';
import type { RunRef, TaskTriple } from '../../src/contracts/dispatch.js';
import type { PlanTaskAssignment } from '../../src/contracts/plan.js';
import type { GoalRef } from '../../src/contracts/ledger.js';
import type { NoteAnchorV1 } from '../../src/contracts/note.js';
import type { WorkflowAdvanceInput, WorkflowAdvanceResult } from '../../src/business/workflow/contracts.js';
import type { ArchitectureRevision } from '../../src/core/work-graph/architecture/catalog-contracts.js';
import type { DecisionCardV1 } from '../../src/core/work-graph/model/decision-contracts.js';
import type { TaskExecutionRecord } from '../../src/core/work-graph/model/execution-read-contracts.js';
import type { NoteItemV1 } from '../../src/core/work-graph/model/note-contracts.js';
import type { SessionMessage } from '../../src/core/work-graph/model/communication-contracts.js';
import type { QueryJobRecord } from '../../src/core/work-graph/queries/contracts.js';
import type { RoleLineReadV1 } from '../../src/core/work-graph/views/role-line-read.js';
import type { RoleLineOperationReadV1 } from '../../src/core/work-graph/views/role-line-operations-read.js';
import { roleExplorationQuestion } from '../../src/core/work-graph/state/role-exploration.js';
import {
  AG2B_CONSUMER_ID, AG2B_QUERY_BUDGET, AG2B_RUNTIME_BUDGET, ag2bPlanDraft, graphWrite, plain,
  writeAG2bWorkspace,
} from './AG2b-collaboration-fixture.js';
import { readQuery } from './A2-restart-fixture.js';
import { commitBarrier, type CommitHold } from './S6A-commit-barrier.js';
import { s6aCardsWorkspace, type S6ACardsWorkspace } from './S6A-cards-fixture.js';
import { readBody } from './IV-host-fixture.js';
import { PL_ADVISER_ROLE } from './PL-consumption-fixture.js';
import { readyValue } from './S6A-memory-fixture.js';
import {
  S6A_SCRIBE_ROLE, S6A_SCRIBE_ROLE_BINDING, S6A_SCOPE, type S6ABackend, type S6AExtraBinding,
  type S6ARequestWorld, type S6ASession,
} from './S6A-request-fixture.js';
import type { S6AReply } from './S6A-host-fixture.js';
import { valueOf } from './S6B3-fixture.js';
import { queryJobRefOfRun } from './S7D2-coldstart-world.js';
import {
  addS7D2SecondWorkspace, adviserWorkOf, openS7D2RoleLineWorld, readS7D2Operations, S7D2_MODULE_IDS,
  type S7D2RoleLineWorld, type S7D2SecondWorkspace,
} from './S7D2-role-line-world.js';
import { bindingOf } from './S7A-fixture.js';
import { waitFor } from '../scenarios/harness.js';
import { xws2pProjectPath } from './XWS2P-world.js';

/** The frozen names of the row set: the module the coarse split proposes and its raw (unqualified) path. */
export const XWS2A_MODULE_ID = 'second-mod';
/** KLS-2b: `second-mod` in the project view (the second workspace's Run proposed it in its own frame). */
export function xws2aModuleInProject(secondWorkspaceId: string): string {
  return `/@ws:${encodeURIComponent(secondWorkspaceId)}/${XWS2A_MODULE_ID}`;
}
export const XWS2A_MODULE_RAW_PATH = 'src/second';
/** The region proposal's child module (the join's `proposals` batch). */
export const XWS2A_SUB_MODULE_ID = 'second-sub';
export const XWS2A_SUB_MODULE_RAW_PATH = 'src/second/sub';
/** The opening adviser's coarse-split question, the literal the join's action request carries. */
export const XWS2A_COARSE_QUESTION = roleExplorationQuestion('coarse_split', null);

/** `workspaceJoinOperationRef(projectId, workspaceId)` (the frozen identity; hand-computed, not a product call). */
export const xws2aJoinRef = (projectId: string, workspaceId: string): OperationRef =>
  ({ aggregateType: 'CoreOperation', projectId, operationId: `workspace_join:${workspaceId}` });

/** The qualified project path of one second-workspace path (P's canonical form, hand-computed). */
export const xws2aSecondPath = (workspaceId: string, path: string): string =>
  xws2pProjectPath(workspaceId, path);

/** The join's operations row (`role-lines/operations` of the second workspace). */
export type XWS2AJoinRow = Extract<RoleLineOperationReadV1, { action: 'role_line' }>;

export type XWS2AWorld = {
  readonly base: S7D2RoleLineWorld;
  readonly second: S7D2SecondWorkspace;
  readonly adviser: S6ASession;
  secondCtx(): CoreCallContext;
  join(): Promise<XWS2AJoinRow | null>;
  waitJoin(done: (row: XWS2AJoinRow | null) => boolean, what: string): Promise<XWS2AJoinRow>;
  /** The coarse exploration entry saved and its Query ended (the opening adviser is free again). */
  waitCoarseAnswered(): Promise<XWS2AJoinRow>;
  /** The person's `decisions/answer` of the coarse proposal's card; waits until the join reads `regions` or later. */
  approveCoarse(): Promise<XWS2AJoinRow>;
  /** Holds the join's `proposals` phase commit (holdAfter) so the region Query is scripted before it runs. */
  holdJoinProposals(): CommitHold;
  /** Scripts the region line of `second-mod` with one proposal (the join's `proposals` batch member). */
  scriptRegionProposal(): Promise<S6ASession>;
  waitProposals(): Promise<XWS2AJoinRow>;
  query(ref: QueryJobRef): Promise<QueryJobRecord>;
  /** `notes/list` of the main workspace on one anchor (the `{ anchor, limit: 100, cursor: null }` read). */
  notes(anchor: NoteAnchorV1): Promise<NoteItemV1[]>;
  /** The one A2 work entry: adopt the Task, O4a-assign the Goal to the main adviser, script the line, drive in ws2. */
  workRun(input: { label: string; replies: readonly S6AReply[] }):
    Promise<{ run: RunRef; task: TaskTriple; line: S6ASession }>;
  inbox(line: S6ASession | { readonly ref: S6ASession['ref'] }): Promise<SessionMessage[]>;
  messageText(message: SessionMessage): Promise<string>;
  operations(scope?: WorkspaceScope): Promise<readonly RoleLineOperationReadV1[]>;
  catalog(scope: WorkspaceScope): Promise<ArchitectureRevision>;
  roleLines(scope?: WorkspaceScope): Promise<readonly RoleLineReadV1[]>;
  cards(): Promise<DecisionCardV1[]>;
  approve(card: DecisionCardV1, requestId: string): Promise<unknown>;
  proposal(ref: ArchitectureProposalRef): Promise<ProposalRead>;
  secondRoot(): Promise<string>;
  close(): Promise<void>;
};

export const XWS2A_ADVISER_TOOLS = ['read', 'send_session_message', 'respond_session_message', 'read_session_inbox',
  'read_session_message', 'read_session_message_body', 'ack_session_message', 'withdraw_session_message',
  'create_member', 'look_graph', 'find_graph', 'read_requests', 'record_note',
  'propose_architecture_revision'] as const;

/**
 * XWR R7: the opening scribe line's own trusted binding (Runtime + Workflow) and the one query profile the Host's
 * consume loop requires for its role. A second binding with the same role would make `servingBinding` ambiguous, so
 * this is added only when the world is opened with `scribe: true`.
 */
export const XWS2A_SCRIBE_WORK: S6AExtraBinding = {
  binding: bindingOf('xws2a-scribe-binding', S6A_SCRIBE_ROLE, 'XWS2A scribe guidance', ['read', 'record_note']),
  workflow: { workspace: S6A_SCOPE, sessionRole: S6A_SCRIBE_ROLE, roleBinding: S6A_SCRIBE_ROLE_BINDING,
    budget: { tokenBudget: 1_000_000, deadline: null } },
  queryProfile: { id: 'xws2a-scribe-query-profile', label: 'XWS2A scribe query', scope: S6A_SCOPE,
    runtimeBindingId: 'xws2a-scribe-binding', sessionRole: S6A_SCRIBE_ROLE,
    roleBinding: S6A_SCRIBE_ROLE_BINDING, runtimeBudget: AG2B_RUNTIME_BUDGET, budget: AG2B_QUERY_BUDGET,
    consumerId: AG2B_CONSUMER_ID },
};

function moduleOf(moduleId: string, path: string): ModuleDefinition {
  return { ref: { projectId: S6A_SCOPE.projectId, moduleId }, name: moduleId,
    responsibility: `XWS2A ${moduleId}`, paths: [path], interfaces: [] };
}

function coarseProposal(baseCatalogPin: ArchitectureCatalogPinV1, coarseNote: boolean): S6AReply {
  const calls: Array<{ callId: string; name: string; args: Record<string, unknown> }> = [
    { callId: 'xws2a-coarse', name: 'propose_architecture_revision', args: {
      baseCatalogPin, ops: [{ op: 'add_module', module: moduleOf(XWS2A_MODULE_ID, XWS2A_MODULE_RAW_PATH) }],
      responsibilityMoves: [], reason: 'XWS2A: the second workspace coarse split',
    } },
  ];
  if (coarseNote) calls.push(joinNote);
  return { kind: 'calls', calls };
}

async function xws2aCurrentPin(base: Pick<S7D2RoleLineWorld, 'world' | 'main'>): Promise<ArchitectureCatalogPinV1> {
  const current = readyValue<ArchitectureRevision>(await base.world.dispatch('architecture/read',
    base.main.humanContext(), plain(S6A_SCOPE, { selection: { kind: 'current' } })), 'the current architecture');
  return { catalogRef: current.catalog.ref,
    baseline: { ref: current.baseline.ref, digest: current.baseline.contentDigest } };
}

async function rootOf(base: Pick<S7D2RoleLineWorld, 'world'>, scope: WorkspaceScope): Promise<string> {
  const snapshot = await base.world.settings('snapshot', {});
  if (snapshot.status !== 'ready') throw new Error(`XWS2A: the Host snapshot is not ready: ${JSON.stringify(snapshot)}`);
  const root = snapshot.value.workspaces.find(entry => entry.scope.workspaceId === scope.workspaceId)?.root;
  if (root === undefined) throw new Error('XWS2A: the second workspace has no Host root');
  return root;
}

/** KLS-2b: the main workspace's region module as a second-workspace Run names it (in its own frame). */
const MAIN_REGION_FROM_SECOND = `/@ws:${encodeURIComponent(S6A_SCOPE.workspaceId)}/${S7D2_MODULE_IDS.region}`;

/** The join exploration's one `record_note` call: a decision on the project's existing region module. */
const joinNote = {
  callId: 'xws2a-join-note', name: 'record_note', args: {
    op: 'write', kind: 'decision', topic: 'xws2a-join-note',
    conclusion: 'XA-14: the join exploration wrote this note', body: 'XA-14',
    anchor: { kind: 'module', moduleId: MAIN_REGION_FROM_SECOND }, extraAnchors: [],
    structural: false, replaces: [], expectedPointerRevision: null,
  } as Record<string, unknown>,
};

/**
 * One `record_note` call; XA-10 uses ten of these. A general kind (`decision`) is the kind a Work Run's adviser may
 * write on a file anchor (`contracts/note.ts:51–52`); the accepted join note on the region module shares the extra
 * anchor, and the contradiction makes the agent write `pending_review` (`state/note-machine.ts:73`, `:76–78`) with no
 * live user reason, so the scribe's to-do counts it (`state/note-machine.ts:231–234`).
 */
export const noteCall = (index: number, contradicts: readonly string[] = []):
{ callId: string; name: string; args: Record<string, unknown> } => ({
  callId: `xws2a-note-${String(index)}`, name: 'record_note', args: {
    op: 'write', kind: 'decision', topic: `xws2a-reminder-${String(index)}`,
    conclusion: `XWS2A reminder note ${String(index)}`, body: `XWS2A reminder note ${String(index)}`,
    anchor: { kind: 'file', path: `src/note-${String(index)}.ts` },
    extraAnchors: [{ kind: 'module', moduleId: MAIN_REGION_FROM_SECOND }],
    structural: false, replaces: [], contradicts: [...contradicts], coexistWith: [],
    expectedPointerRevision: null,
  } as Record<string, unknown>,
});

/** `executions/read` of one Run through the SECOND workspace's own route (M5). */
export async function readRun(world: XWS2AWorld, run: RunRef): Promise<TaskExecutionRecord> {
  return valueOf<TaskExecutionRecord>((await world.second.workspace.route('executions/read', run)),
    'ready', 'the Run');
}

/**
 * One adviser/executor Task on the second workspace's Goal, adopted through the public `plans/propose`/`plans/apply`
 * in that workspace's own trusted context. `second` is the `S6ACardsWorkspace` handle of the workspace that owns the
 * Goal; the `role` names the Task's assignment (the adviser template by default, the Work role for XA-16).
 */
export async function adoptSecondPlan(base: Pick<S6ARequestWorld, 'dispatch'>,
  second: S6ACardsWorkspace, goal: GoalRef,
  label: string, role = PL_ADVISER_ROLE.templateId,
  assignments?: readonly PlanTaskAssignment[]): Promise<{ taskId: string }> {
  const taskId = `xws2a-${label}`;
  const ctx = second.humanContext();
  const draft = { ...ag2bPlanDraft([taskId]), planId: `xws2a-plan-${label}`, goalId: goal.goalId,
    assignments: assignments === undefined ? [{ taskId, role, instruction: `XWS2A ${label}` }] : [...assignments] };
  const proposed = valueOf<{ ref: unknown; revision: number }>(await base.dispatch('plans/propose', ctx,
    graphWrite(second.scope, { goalRef: goal, basedOn: null, draft,
      reason: { text: `XWS2A plan ${label}`, sources: [] } }, `xws2a-plan-${label}-propose`)),
  'committed', `the XWS2A plan ${label}`);
  valueOf<unknown>(await base.dispatch('plans/apply', ctx, graphWrite(second.scope, {
    proposalRef: proposed.ref, expectedProposalRevision: proposed.revision, decisionRefs: [],
  }, `xws2a-plan-${label}-apply`)), 'committed', `the adoption of ${label}`);
  return { taskId };
}

/**
 * One Workflow drive in the second workspace's own scope: its Goal and Run live there while the chosen line stays in
 * the main workspace, so the main scope's `workflow/advance` would refuse the call. Stops before the Run's checks.
 */
export async function driveSecondWorkflow(second: S6ACardsWorkspace, input: WorkflowAdvanceInput,
  stopBefore: string): Promise<string | null> {
  let current = input;
  let waiting: string | null = null;
  for (let guard = 0; guard < 32; guard += 1) {
    const result = await second.route('workflow/advance', current) as WorkflowAdvanceResult;
    if (result.status !== 'ready') throw new Error(`XWS2A: the Workflow call was not ready: ${JSON.stringify(result)}`);
    waiting = result.value.state === 'waiting' ? result.value.reason : null;
    if (result.value.state === 'completed' || result.value.next === null) return waiting;
    current = result.value.next;
    if (current.kind === 'perform' && current.operation.kind === stopBefore) return waiting;
  }
  throw new Error('XWS2A: the Workflow did not settle');
}

/**
 * The Goal's next system round (XWR-0, XWR): `workflow/advance` of `select_work` in `ws` (the Goal's workspace) until
 * the selection's first `send_system_round`, which it performs. Answers that send's request, or `null` when the
 * selection stopped first.
 */
export async function sendRoundOf(ws: S6ACardsWorkspace, goal: GoalRef, flowId: string):
Promise<{ round: { kind: string }; recipient: SessionRef } | null> {
  let input: WorkflowAdvanceInput = { schemaVersion: 1, goalRef: goal, flowId, sessionHint: null, kind: 'select_work' };
  for (let step = 0; step < 8; step += 1) {
    const result = await ws.route('workflow/advance', input) as WorkflowAdvanceResult;
    if (result.status !== 'ready' || result.value.next === null) return null;
    input = result.value.next;
    if (input.kind === 'perform' && (input.operation.kind as string) === 'send_system_round') {
      await ws.route('workflow/advance', input);
      return (input.operation as unknown as { request: { round: { kind: string }; recipient: SessionRef } }).request;
    }
  }
  return null;
}

/**
 * One `refine:` round on `goal`: the public `plans/propose`/`plans/apply` adopt a Plan whose only Task is a goal-level
 * `plan_only` placeholder `label`, then `sendRoundOf` sends the refinement. Answers its recipient line, or `null`.
 */
export async function refineRound(ws: S6ACardsWorkspace, goal: GoalRef, label: string): Promise<SessionRef | null> {
  const draft = { schemaVersion: 2, planId: label, planRevision: 1, goalId: goal.goalId, stages: [], tasks: [{
    taskId: label, title: label, requirementLevel: 'required', taskKind: 'work', disposition: 'active', phase: 'pending',
    scope: { kind: 'goal' }, executionIntent: 'plan_only', sizeClass: 'small' }], assignments: [], obligations: [],
    taskHierarchy: { parentOf: [] }, executionDag: { dependsOn: [] }, taskRelations: [], inputRequirements: [] };
  const proposed = valueOf<{ ref: unknown; revision: number }>(await ws.post('plans/propose', graphWrite(ws.scope,
    { goalRef: goal, basedOn: null, draft, reason: { text: label, sources: [] } }, `${label}-propose`)), 'committed', label);
  valueOf(await ws.post('plans/apply', graphWrite(ws.scope, { proposalRef: proposed.ref,
    expectedProposalRevision: proposed.revision, decisionRefs: [] }, `${label}-apply`)), 'committed', label);
  return (await sendRoundOf(ws, goal, label))?.recipient ?? null;
}

/** Open the world and start its one join: the second workspace is born in the registration commit. */
export async function openXWS2AWorld(options: {
  backend: S6ABackend;
  extraHostOptions?: Readonly<Record<string, unknown>>;
  /** Writes into the main root before the second workspace opens. */
  mainFiles?: Readonly<Record<string, string>>;
  /** Writes into the second root after it opens. */
  secondFiles?: Readonly<Record<string, string>>;
  /** Adds the join's one `record_note` call to the default coarse reply (XA-14's world). */
  coarseNote?: boolean;
  /** The second workspace's `workspaces/open` options; defaults keep `false`/`false` (B1-15 passes writeAllowed). */
  secondOpenOptions?: { writeAllowed?: boolean; commandsAllowed?: boolean };
  /** Replaces the opening adviser binding's tool grant (`XWS2A_ADVISER_TOOLS` by default); B1-15 adds `edit`. */
  adviserTools?: readonly string[];
  /** The opening adviser binding's write scope (default `[]`); B1-15 passes `['.']`. */
  adviserWriteScope?: readonly string[];
  /** Host bindings after the adviser's (XWR R2: the S9 reviewer binding, so a main reviewer line is consumed). */
  extraBindings?: readonly S6AExtraBinding[];
  /** XWR R7: bind the opening scribe line's Runtime, Workflow and query profile, so the Host consumes it and it can
   *  claim a Task. */
  scribe?: boolean;
}): Promise<XWS2AWorld> {
  const adviser = adviserWorkOf(options.adviserTools ?? [...XWS2A_ADVISER_TOOLS], true);
  if (options.adviserWriteScope !== undefined) {
    adviser.binding = { ...adviser.binding,
      grant: { ...adviser.binding.grant, writeScope: [...options.adviserWriteScope] } };
  }
  const base = await openS7D2RoleLineWorld({ backend: options.backend,
    extraBindings: [adviser, ...(options.scribe === true ? [XWS2A_SCRIBE_WORK] : []),
      ...(options.extraBindings ?? [])],
    ...(options.extraHostOptions === undefined ? {} : { extraHostOptions: options.extraHostOptions }) });
  let second: S7D2SecondWorkspace | null = null;
  try {
    for (const [path, text] of Object.entries(options.mainFiles ?? {})) {
      const target = join(base.world.root, path);
      await mkdir(join(target, '..'), { recursive: true });
      await writeFile(target, text);
    }
    // The coarse proposal's base pin is the project's current pin, which is also the join's first-drive pin.
    await base.world.scripted.script(base.lines.adviser, [coarseProposal(await xws2aCurrentPin(base),
      options.coarseNote === true),
      { kind: 'text', text: 'XWS2A: the coarse split is proposed' }]);
    second = await addS7D2SecondWorkspace(base.world, 'xws2a-second', options.secondOpenOptions);
    const root = await rootOf(base, second.scope);
    for (const [path, text] of Object.entries(options.secondFiles ?? {})) {
      const target = join(root, path);
      await mkdir(join(target, '..'), { recursive: true });
      await writeFile(target, text);
    }
    const scope = second.scope;
    const joinRef = xws2aJoinRef(scope.projectId, scope.workspaceId);
    const joinRowOrNull = async (): Promise<XWS2AJoinRow | null> => {
      const rows = await readS7D2Operations(base.world, scope);
      return (rows.find(row => row.action === 'role_line' && row.operation.operationId === joinRef.operationId)
        ?? null) as XWS2AJoinRow | null;
    };
    const waitJoin = (done: (row: XWS2AJoinRow | null) => boolean, what: string): Promise<XWS2AJoinRow> =>
      waitFor(joinRowOrNull, done, what) as Promise<XWS2AJoinRow>;
    const secondWorkspace = second;
    const handle: XWS2AWorld = {
      base, second: secondWorkspace, adviser: base.lines.adviser,
      secondCtx: () => secondWorkspace.workspace.humanContext(),
      join: joinRowOrNull,
      waitJoin,
      async waitCoarseAnswered() {
        const row = await waitJoin(candidate => (candidate?.explorations ?? []).some(entry =>
          entry.segment === 'coarse_split'), 'the join coarse-split exploration');
        const entry = (row.explorations ?? []).find(candidate => candidate.segment === 'coarse_split')!;
        await waitFor(async () => (await handle.query(queryJobRefOfRun(entry.queryRunRef))).job.job.status,
          status => status === 'answered' || status === 'closed',
          'the join coarse-split Query to end');
        return await waitJoin(candidate => (candidate?.explorations ?? []).length >= 1,
          'the join coarse-split row after its Query');
      },
      async approveCoarse() {
        const card = await waitFor(handle.cards, cards => cards.some(candidate =>
          candidate.source.kind === 'structural_proposal' && candidate.state === 'waiting_answer'),
        'the coarse proposal card');
        const proposalCard = card.find(candidate => candidate.source.kind === 'structural_proposal'
          && candidate.state === 'waiting_answer')!;
        await handle.approve(proposalCard, 'xws2a-approve-coarse');
        // A fast approval can carry the join past `regions` between two polls: any phase from `regions` on is the
        // approval taken.
        return await handle.waitJoin(candidate => candidate?.actionPhase === 'regions'
          || candidate?.actionPhase === 'proposals', 'the join regions phase (or a later one)');
      },
      holdJoinProposals() {
        // The first join record whose action phase is `proposals`, after it lands (the region Query is submitted
        // in the same commit and claimed by the next pass, which this hold keeps from starting).
        return commitBarrier.holdAfter(commit => commit.records.some(record => {
          let value: unknown;
          try { value = JSON.parse(record.json) as unknown; } catch { return false; }
          if (typeof value !== 'object' || value === null || Array.isArray(value)) return false;
          const ref = (value as Record<string, unknown>)['ref'];
          const action = (value as Record<string, unknown>)['action'];
          return typeof ref === 'object' && ref !== null
            && (ref as Record<string, unknown>)['operationId'] === joinRef.operationId
            && typeof action === 'object' && action !== null
            && (action as Record<string, unknown>)['action'] === 'workspace_join'
            && (action as Record<string, unknown>)['phase'] === 'proposals';
        }), 'XWS2A: after the join proposals phase commit');
      },
      async scriptRegionProposal() {
        const row = await waitJoin(candidate => (candidate?.explorations ?? []).some(entry =>
          entry.segment === 'region' && entry.queryRunRef.workspaceId === scope.workspaceId),
        'the join region exploration entry');
        const entry = (row.explorations ?? []).find(candidate => candidate.segment === 'region')!;
        const card = await base.world.readSession(entry.sessionRef);
        const line: S6ASession = { label: `xws2a-region-${XWS2A_MODULE_ID}`, ref: entry.sessionRef,
          aggregateRef: card.record.ref, role: structuredClone(card.record.role), createdAt: card.record.createdAt };
        await base.world.scripted.script(line, [
          { kind: 'calls', calls: [{ callId: 'xws2a-region', name: 'propose_architecture_revision', args: {
            baseCatalogPin: await xws2aCurrentPin(base),
            ops: [{ op: 'add_module', module: moduleOf(XWS2A_SUB_MODULE_ID, XWS2A_SUB_MODULE_RAW_PATH) }],
            responsibilityMoves: [], reason: 'XWS2A: the second workspace region',
          } }] },
          { kind: 'text', text: 'XWS2A: the second workspace region is proposed' },
        ]);
        return line;
      },
      async waitProposals() {
        return await waitJoin(candidate => candidate?.actionPhase === 'proposals'
          && (candidate.batchRefs ?? []).length >= 1, 'the join proposals batch');
      },
      async query(ref) {
        // `queries/read` is workspace-scoped: the join's exploration Query lives in the second workspace, the cold
        // start's in the main one. Read each through its own workspace's public route.
        if (ref.workspaceId === S6A_SCOPE.workspaceId) return await readQuery(base.world.ag2b, ref);
        return readyValue<QueryJobRecord>(await secondWorkspace.workspace.route('queries/read', ref), 'the Query');
      },
      async notes(anchor) {
        return valueOf<{ items: NoteItemV1[] }>((await base.world.post('notes/list',
          plain(S6A_SCOPE, { anchor, limit: 100, cursor: null }))).body, 'ready',
        `the notes on the ${anchor.kind} anchor`).items;
      },
      async workRun(input) {
        const { taskId } = await adoptSecondPlan(base.world, secondWorkspace.workspace, secondWorkspace.goal, input.label);
        const task: TaskTriple = { projectId: secondWorkspace.scope.projectId,
          goalId: secondWorkspace.goal.goalId, taskId };
        const adviser = base.lines.adviser;
        // O4a's one assignment: the person assigns the second workspace's Goal to the main workspace adviser; the
        // allocation writes the open responsible link (no sessions/create or sessions/link in the test).
        const queue = valueOf<{ revision: number }>(await base.main.route('goals/adviser-queue', {}), 'ready',
          'the Goal adviser queue');
        const assigned = await base.world.post('goals/adviser-queue/assign', graphWrite(S6A_SCOPE, {
          goalRef: secondWorkspace.goal, adviser: adviser.ref, expectedRevision: queue.revision,
        }, `xws2a-assign-${input.label}`));
        if ((assigned.body as { status?: string }).status !== 'committed') {
          throw new Error(`XWS2A: the Goal assignment did not commit: ${JSON.stringify(assigned.body)}`);
        }
        await waitFor(async () => (await base.world.readSession(adviser.ref)).links,
          links => links.some(link => link.until === null && link.ref.relation === 'responsible'
            && link.ref.target.kind === 'goal' && link.ref.target.ref.goalId === secondWorkspace.goal.goalId),
          'the main adviser Goal responsibility link');
        await base.world.scripted.script(adviser, input.replies);
        const waiting = await driveSecondWorkflow(secondWorkspace.workspace, { schemaVersion: 1,
          goalRef: secondWorkspace.goal, flowId: `xws2a-${input.label}`, sessionHint: null, kind: 'select_work', taskId },
        'open_checks');
        if (await base.world.scripted.pending(adviser) !== 0) {
          throw new Error(`XWS2A: the Work Run ${input.label} waits: ${waiting ?? 'no Work Run started'}`);
        }
        // M5: the Task graph read through the second workspace's own `tasks/query` (the Host workspace check).
        const run = await secondWorkspace.workspace.taskRun(secondWorkspace.goal, task.taskId);
        if (run === null) throw new Error(`XWS2A: the ${input.label} Run is not readable`);
        return { run, task, line: adviser };
      },
      async inbox(line) {
        return valueOf<{ items: SessionMessage[] }>((await base.world.post('messages/inbox',
          plain(S6A_SCOPE, { recipient: line.ref, page: { limit: 50 } }))).body, 'ready',
        'the inbox page').items;
      },
      messageText: async message => await readBody(base.world, message.ref, 'message'),
      operations: scope => readS7D2Operations(base.world, scope ?? S6A_SCOPE),
      async catalog(scope) {
        const ctx = scope.workspaceId === S6A_SCOPE.workspaceId ? base.main.humanContext() : handle.secondCtx();
        return readyValue<ArchitectureRevision>(await base.world.dispatch('architecture/read', ctx,
          plain(scope, { selection: { kind: 'current' } })), 'the current architecture');
      },
      async roleLines(scope) {
        const read = await base.world.post('role-lines/read', plain(scope ?? S6A_SCOPE,
          { workspace: scope ?? S6A_SCOPE }));
        return valueOf<{ rows: readonly RoleLineReadV1[] }>(read.body, 'ready',
          'the role-lines read').rows;
      },
      cards: () => base.main.readCards(),
      async approve(card, requestId) {
        return (await base.world.post('decisions/answer', graphWrite(S6A_SCOPE, {
          source: card.source, selection: { kind: 'option', optionId: 'approve' }, text: '', annotations: [],
        }, requestId, card.source.pins))).body;
      },
      async proposal(ref) {
        return valueOf<ProposalRead>((await base.world.post('architecture/proposals/read',
          plain(S6A_SCOPE, { proposalRef: ref }))).body, 'ready', `the proposal ${ref.proposalId}`);
      },
      secondRoot: async () => await rootOf(base, secondWorkspace.scope),
      async close() {
        try { await base.close(); } finally { await secondWorkspace.remove(); }
      },
    };
    return handle;
  } catch (error) {
    await base.close().catch(() => undefined);
    await second?.remove().catch(() => undefined);
    throw error;
  }
}

/**
 * XWR R8: a SECOND project on the same Host, opened through the Host's own `workspaces/open` settings route with
 * no `projectId` (a new project: its own root, project and workspace records, and its own platform). The world's
 * fixture capture keeps the first project's platform; a caller uses only the returned scope, never that project's
 * records. The root is removed by the caller's `remove()` after the world closes.
 */
export type XWS2AOtherProject = {
  readonly scope: WorkspaceScope;
  readonly root: string;
  remove(): Promise<void>;
};

export async function openXWS2AOtherProject(world: XWS2AWorld, label: string): Promise<XWS2AOtherProject> {
  const root = await mkdtemp(join(tmpdir(), 'xws2a-other-project-'));
  const remove = (): Promise<void> => rm(root, { recursive: true, force: true });
  try {
    await writeAG2bWorkspace(root);
    const opened = await world.base.world.settings('workspaces/open', { path: root, name: label,
      writeAllowed: false, commandsAllowed: false });
    if (opened.status !== 'ready') {
      throw new Error(`XWS2A: the other project did not open: ${JSON.stringify(opened)}`);
    }
    await world.base.world.settleDetached();
    const scope: WorkspaceScope = { projectId: opened.value.scope.projectId,
      workspaceId: opened.value.scope.workspaceId };
    return { scope, root, remove };
  } catch (error) {
    await remove();
    throw error;
  }
}
