/**
 * 7D2 C1: the cold-start operation — one `role_line`/`cold_start` CoreOperation per project. It is born
 * in the `start_lines` secretary step's registration commit and driven only by the Host lifecycle pass through
 * `continueOperation`. Six phases `candidates → adopted → route → coarse_split → regions → proposals`; one `drive`
 * reads facts, decides, and writes at most one operation commit, always through `writeRoleLineOperation`. Lines,
 * messages, Queries and proposal batches are their owners' writes, each keyed by the cold-start identity, so a crash
 * between any two commits replays the same thing instead of making a second one.
 */
import type { CoreCallContext } from '../../../contracts/core/call-context.js';
import type { CommitCursor } from '../../../contracts/command-event.js';
import type { ModuleRef, SessionRef, WorkspaceScope } from '../../../contracts/core/identity.js';
import type { CoreRejection, ReadResult, WriteResult } from '../../../contracts/core/results.js';
import { rejected } from '../../../contracts/core/rejections.js';
import type { SessionMessageRef } from '../../../contracts/core/session-message.js';
import type { SessionWorkLink } from '../../../contracts/core/session.js';
import { canonicalKey, sameJson } from '../../../contracts/fingerprint.js';
import type { AdoptedArchitecture, ArchitectureCatalogPinV1 } from '../../../contracts/architecture-catalog.js';
import type { ArchitectureProposalBatchRef, ArchitectureProposalRef } from '../../../contracts/architecture-proposal.js';
import {
  queryJobRefFor, type QueryJobAnswerRef, type QueryJobAnswerSnapshot, type QueryJobIntentV1, type QueryJobRef,
  type QueryJobSnapshot, type QueryRunRef, type QueryRunSnapshot,
} from '../../../contracts/query-job.js';
import type { RoleLineDutyV1, RoleScopeV1 } from '../../../contracts/role-lines.js';
import type { GoalRecordTransactionPort } from '../../record-store/ports.js';
import { readOwnerRecord } from '../persistence/owner-record-read.js';
import type { SessionMailboxPort } from '../model/communication-contracts.js';
import { latestAnsweredRound, type SecretaryProfilePort } from '../model/request-contracts.js';
import type {
  RoleLineOperationV1, SessionCard, SessionCreateActionV1, SessionDirectoryPort, SessionOperationRecordOf,
} from '../model/session-contracts.js';
import type { GraphWrite } from '../model/task-contracts.js';
import {
  advanceColdStartPhase, coldStartOperationRef, coldStartPhaseProblem, newColdStartAction, type ColdStartActionV1,
} from '../state/cold-start.js';
import {
  roleExplorationExecution, roleExplorationQuestion, type RoleExplorationSegmentV1,
} from '../state/role-exploration.js';
import type { ColdStartExplorationQueryRefV1, ColdStartPhaseV1 } from '../state/role-line-action.js';
import { roleLineOperationRef } from '../state/role-line-operation.js';
import { effectiveRegions, type RegionClaimV1 } from '../state/role-scope.js';
import { catalogPinOf, readCurrentCatalogWindow } from '../architecture/catalog-service.js';
import {
  decodeArchitectureProposalBatchRecord, decodeArchitectureProposalRecord,
} from '../architecture/proposal-record-codecs.js';
import type { ArchitectureProposalService, ProposalBatchWindowPort } from '../architecture/proposal-service.js';
import type { RoleLineLineV1, RoleLineOperationsPort } from './role-line-operations.js';
import { roleLineStepSession, writeRoleLineOperation } from './role-line-operation-write.js';
import { decodeSessionOperationRecord, operationRefKey, plainSessionRefToAggregate } from './session-record-codecs.js';

/** L-10: the route question appended to the initial request as one system round; the secretary answers one word. */
export const COLD_START_ROUTE_QUESTION = 'Cold start: decide how the project map is made. Answer with exactly one word: '
  + 'map (you draw the map yourself) or split (advisers explore the regions). If you cannot decide, ask the person in '
  + 'your answer.';

/** The one existing Query stage driver's `advance`, as a local narrow port (sessions does not import business). */
export type ColdStartStagePort = {
  advance(ctx: CoreCallContext, input: { queryJobRef: QueryJobRef; expectedRunRef: QueryRunRef; profile: null }):
    Promise<{ status: 'progressed' } | { status: 'terminal' }
      | { status: 'blocked'; retry: 'on_change' | 'backoff'; reason: string }>;
};

/** `completed` is the record's `completed`; `revision` is the record's revision when this `drive` ends. */
export type ColdStartDriveResultV1 = { phase: ColdStartPhaseV1; revision: number; completed: boolean };

type ColdStartQueryRecordV1 = { job: QueryJobSnapshot; run: QueryRunSnapshot };

export type ColdStartServiceDeps = {
  records: GoalRecordTransactionPort;
  sessions: Pick<SessionDirectoryPort, 'readSession' | 'getSessionOperation'>;
  /** The Query owner's submit, read, claim and answer read (`W/queries/contracts.ts` `QueryJobPort`), structurally. */
  queries: {
    submitQueryJob(ctx: CoreCallContext, request: GraphWrite<{ queryJobId: string; runId: string; intent: QueryJobIntentV1 }>):
      Promise<WriteResult<ColdStartQueryRecordV1>>;
    readQueryJob(ctx: CoreCallContext, ref: QueryJobRef): Promise<ReadResult<ColdStartQueryRecordV1>>;
    claimQuery(ctx: CoreCallContext, request: GraphWrite<{ queryRunRef: QueryRunRef; sessionRef: SessionRef; profile: null }>):
      Promise<WriteResult<unknown>>;
    readQueryAnswer(ctx: CoreCallContext, ref: QueryJobAnswerRef): Promise<ReadResult<QueryJobAnswerSnapshot>>;
  };
  /** D-20: the request owner's rounds read; the route is the latest answered round of the initial request. */
  requests: { readFacts(ctx: CoreCallContext, input: { requestRoot: QueryJobRef }):
    Promise<ReadResult<{ rounds: readonly QueryJobSnapshot[] }>> };
  /** L-10: appends the route question to the initial request as one system round (one receipt per `operationId`). */
  route: { askRoute(ctx: CoreCallContext, input: { operationId: string; requestRoot: QueryJobRef; text: string }):
    Promise<ReadResult<{ round: QueryJobRef }>> };
  /** The workspace's newest initial-format plan answer of a no-goal request; `null` until one exists. */
  initial: { readCandidate(ctx: CoreCallContext, input: { workspace: WorkspaceScope }):
    Promise<ReadResult<{ queryRunRef: QueryRunRef; answerRef: QueryJobAnswerRef } | null>> };
  /** Whether the candidate answer's draft was adopted (`initialization/adopt` adopted its first plan). */
  adoption: { readAdopted(ctx: CoreCallContext, input: { answerRef: QueryJobAnswerRef }): Promise<ReadResult<boolean>> };
  registration: { readWorkspaceRegistration(ctx: CoreCallContext, scope: WorkspaceScope):
    Promise<ReadResult<{ project: { revision: number }; workspace: { revision: number } }>> };
  profiles: Pick<SecretaryProfilePort, 'forSession'>;
  proposals: Pick<ArchitectureProposalService,
    'readPendingArchitectureProposals' | 'freezeArchitectureProposalBatch' | 'readFrozenArchitectureBatches'>;
  messages: Pick<SessionMailboxPort, 'sendMessage'>;
  lines: Pick<RoleLineOperationsPort, 'openRegionLine'>;
  /** L-9: one standby adviser line for a region (the Workflow chooser's `reuseStandby`). */
  standby: { reuseStandby(ctx: CoreCallContext, input: { commandId: string; duty: 'adviser'; scope: RoleScopeV1[];
    modules: ReadonlySet<string> }): Promise<{ kind: 'reused'; line: RoleLineLineV1 } | { kind: 'none' } | CoreRejection> };
  /** The project's open responsible module links with each line's duty (`readOpenResponsibilityLines`). */
  regionLines: { readOpenRegionLines(ctx: CoreCallContext, input: { projectId: string }):
    Promise<ReadResult<readonly { session: SessionRef; link: SessionWorkLink; duty: RoleLineDutyV1 }[]>> };
  stages: ColdStartStagePort;
  now(): string;
};

export type ColdStartService = {
  drive(ctx: CoreCallContext, input: { projectId: string; workspaceId: string }):
    Promise<ReadResult<ColdStartDriveResultV1>>;
};

type ColdStartReadV1 = { status: 'ready'; value: { record: RoleLineOperationV1; action: ColdStartActionV1 } }
  | { status: 'not_found' } | CoreRejection;

/** The one read of a project's cold-start record by its derived ref; any other kind at that ref is damage. */
async function readColdStartRecord(records: Pick<GoalRecordTransactionPort, 'readMany'>, projectId: string):
  Promise<ColdStartReadV1> {
  const read = await readOwnerRecord({ store: records, refKey: operationRefKey(coldStartOperationRef(projectId)),
    decode: decodeSessionOperationRecord,
    readError: () => rejected('unavailable', 'the cold-start operation cannot be read') });
  if (!read.ok) {
    return 'notFound' in read ? { status: 'not_found' } : rejected('unavailable', 'the cold-start operation cannot be read');
  }
  const action = read.value.action;
  if (action.kind !== 'role_line' || action.action !== 'cold_start') {
    return rejected('unavailable', 'the cold-start operation is damaged');
  }
  return { status: 'ready', value: { record: read.value as RoleLineOperationV1, action: action as ColdStartActionV1 } };
}

/**
 * The proposal owner's batch window (v4 :7512–:7535; `book-7d2-frozen.md:792`, `:796`): open only while an
 * unfinished cold start is at `proposals` AND the proposal's base pin is the cold start's own pin.
 */
export function createColdStartProposalWindow(deps: { records: Pick<GoalRecordTransactionPort, 'readMany'> }):
  ProposalBatchWindowPort {
  return {
    async isOpen(_ctx, input) {
      const read = await readColdStartRecord(deps.records, input.projectRef.projectId);
      if (read.status === 'not_found') return { status: 'ready', value: { open: false, revision: null } };
      if (read.status !== 'ready') return read;
      const { record, action } = read.value;
      const open = record.phase !== 'completed' && record.phase !== 'failed'
        && action.phase === 'proposals'
        && action.baseCatalogPin !== null && sameJson(action.baseCatalogPin, input.baseCatalogPin);
      return { status: 'ready', value: { open, revision: open ? record.revision : null } };
    },
  };
}

export function newColdStartOperation(input: { projectId: string; workspaceId: string; occurredAt: string }):
  SessionOperationRecordOf<ColdStartActionV1> {
  return { ref: coldStartOperationRef(input.projectId), revision: 1, workspaceId: input.workspaceId,
    action: newColdStartAction(), phase: 'running', requestedAt: input.occurredAt, updatedAt: input.occurredAt,
    observation: null, failure: null };
}

/** The birth (v4 :7609–:7631): only the `start_lines` parent's secretary step registration carries it. */
export function coldStartBirthOf(input: { startLines: RoleLineOperationV1; createAction: SessionCreateActionV1;
  occurredAt: string }): SessionOperationRecordOf<ColdStartActionV1> | null {
  if (input.startLines.action.action !== 'start_lines' || input.createAction.creation?.duty !== 'secretary') return null;
  return newColdStartOperation({ projectId: input.startLines.ref.projectId,
    workspaceId: input.startLines.workspaceId, occurredAt: input.occurredAt });
}

type DriveInputV1 = { projectId: string; workspaceId: string };
type DriveResultV1 = ReadResult<ColdStartDriveResultV1>;
/** One drive's facts: the call, the stored record and its action. */
type AtV1 = { ctx: CoreCallContext; input: DriveInputV1; op: RoleLineOperationV1; action: ColdStartActionV1 };
/** One exploration round's end (rulings 4, 5): `not_entered` reopens; answered, failed or cancelled has ended. */
type EndingV1 = { kind: 'ended' } | { kind: 'running' } | { kind: 'reopen'; entry: ColdStartExplorationQueryRefV1 };

function stop(at: AtV1): DriveResultV1 {
  return { status: 'ready', value: { phase: at.action.phase, revision: at.op.revision, completed: false } };
}


/** A catalog's top-level modules, in catalog order: those that are no module's contained child. */
function topLevelModules(catalog: AdoptedArchitecture): ModuleRef[] {
  const children = new Set((catalog.containment?.parentOf ?? []).map((edge) => edge.child.moduleId));
  return catalog.modules.filter((module) => !children.has(module.ref.moduleId)).map((module) => ({ ...module.ref }));
}

/** L-9 :1781: a new region's effective modules — the region with the deeper same-duty regions taken out, by the one
 *  `effectiveRegions` table. The new region holds no line yet; the table never reads a claim's Session. */
function regionModulesOf(claims: readonly RegionClaimV1[], moduleRef: ModuleRef, catalog: AdoptedArchitecture):
  ReadonlySet<string> {
  const unclaimed: RegionClaimV1 = { session: { projectId: moduleRef.projectId, sessionId: 'cold-start-region' },
    duty: 'adviser', moduleRef };
  const regions = effectiveRegions({ regions: [...claims, unclaimed], catalog });
  return new Set(regions.at(-1)!.modules.map((module) => module.moduleId));
}

/** The saved exploration rounds by their "please act" message, in save order; the last of a group is its round. */
function explorationGroupsOf(entries: readonly ColdStartExplorationQueryRefV1[], segment: RoleExplorationSegmentV1):
  ColdStartExplorationQueryRefV1[][] {
  const groups = new Map<string, ColdStartExplorationQueryRefV1[]>();
  for (const entry of entries) {
    if (entry.segment !== segment) continue;
    const key = canonicalKey(entry.messageRef);
    const group = groups.get(key);
    if (group === undefined) groups.set(key, [entry]);
    else group.push(entry);
  }
  return [...groups.values()];
}

/** d10: a saved batch is handled only when none of its member proposals is still `pending`. */
async function savedBatchesHandled(records: Pick<GoalRecordTransactionPort, 'readMany'>,
  batchRefs: readonly ArchitectureProposalBatchRef[]): Promise<ReadResult<boolean>> {
  const members = new Map<string, ArchitectureProposalRef>();
  for (const batchRef of batchRefs) {
    const read = await readOwnerRecord({ store: records, refKey: canonicalKey(batchRef),
      decode: decodeArchitectureProposalBatchRecord,
      readError: () => rejected('unavailable', 'the frozen batch cannot be read') });
    if (!read.ok) {
      return rejected('unavailable', 'notFound' in read ? 'a saved cold-start batch is missing'
        : 'the frozen batch cannot be read');
    }
    for (const member of read.value.members) members.set(canonicalKey(member), member);
  }
  if (members.size === 0) return { status: 'ready', value: true };
  let read;
  try {
    read = await records.readMany([...members.keys()]);
  } catch {
    return rejected('unavailable', 'the batch members cannot be read');
  }
  if (read.status !== 'ready') return rejected('unavailable', 'the batch members cannot be read');
  if (read.value.missing.length > 0) return rejected('unavailable', 'a batch member proposal is missing');
  for (const encoded of read.value.records) {
    const decoded = decodeArchitectureProposalRecord(encoded);
    if (decoded.status !== 'decoded') return rejected('unavailable', 'a stored proposal is damaged');
    if (decoded.value.state === 'pending') return { status: 'ready', value: false };
  }
  return { status: 'ready', value: true };
}

export function createColdStartService(deps: ColdStartServiceDeps): ColdStartService {
  /** The phase's one operation commit (L-1: the shared `role_line` write and its one event). `ledgerHorizon` is the
   *  completion's CAS: a proposal commit after the horizon read makes this write conflict and the next pass re-judges. */
  async function write(at: AtV1, action: ColdStartActionV1, phase?: 'completed',
    ledgerHorizon?: CommitCursor | null): Promise<DriveResultV1> {
    const next: RoleLineOperationV1 = { ...at.op, revision: at.op.revision + 1, updatedAt: deps.now(), action,
      phase: phase ?? at.op.phase };
    const written = await writeRoleLineOperation(deps, at.ctx, at.op, next, undefined,
      ledgerHorizon === undefined ? undefined
        : { records: [], claims: [], events: [], guards: [], ledgerHorizon });
    if (written.status !== 'committed') return written;
    return { status: 'ready', value: { phase: action.phase, revision: next.revision, completed: next.phase === 'completed' } };
  }

  /** TS-22: the route is the latest answered round of the initial request, exactly `map` or `split`; any failed
   *  read is no route yet. */
  async function routeOf(ctx: CoreCallContext, requestRoot: QueryJobRef): Promise<'map' | 'split' | null> {
    const facts = await deps.requests.readFacts(ctx, { requestRoot });
    if (facts.status !== 'ready') return null;
    const latest = latestAnsweredRound(facts.value.rounds, (round) => round.job.answerRefs.length > 0);
    const answerRef = latest === null ? undefined
      : facts.value.rounds.find((round) => sameJson(round.ref, latest))?.job.answerRefs.at(-1);
    if (answerRef === undefined) return null;
    const answer = await deps.queries.readQueryAnswer(ctx, answerRef);
    if (answer.status !== 'ready') return null;
    const text = answer.value.answer.answer.trim();
    return text === 'map' || text === 'split' ? text : null;
  }

  /** C1-05: one exploration Query on the chosen line; no Goal, the line's own Query profile, the line's origin. */
  async function submitExploration(at: AtV1, round: { queryJobId: string; runId: string; question: string;
    segment: RoleExplorationSegmentV1; line: SessionRef; card: SessionCard; messageRef: SessionMessageRef }):
    Promise<ReadResult<ColdStartExplorationQueryRefV1>> {
    const { projectId, workspaceId } = at.input;
    const queryJobRef = queryJobRefFor(projectId, workspaceId, round.queryJobId);
    // The line's stored origin: `start_lines` for the opening adviser, the cold start for a line it opened, the
    // line's own earlier origin for a reused standby line.
    const explorationEntryOf = (queryRunRef: QueryRunRef): ColdStartExplorationQueryRefV1 => ({ queryRunRef: { ...queryRunRef },
      sessionRef: { ...round.line }, messageRef: { ...round.messageRef },
      operationRef: { ...round.card.roleFacts!.originOperation! }, segment: round.segment });
    // A Query committed before a crash is the original result: reuse its run, never re-read the live profile and
    // re-submit the same identity with a new intent fingerprint (`idempotency_conflict`).
    const existing = await deps.queries.readQueryJob(at.ctx, queryJobRef);
    if (existing.status !== 'not_found') {
      if (existing.status !== 'ready') return existing;
      return { status: 'ready', value: explorationEntryOf(existing.value.run.ref) };
    }
    const workspace: WorkspaceScope = { projectId, workspaceId };
    const profile = deps.profiles.forSession({ workspace, sessionRole: round.card.record.role });
    if (profile === null) return rejected('unavailable', 'the exploration line has no Query profile in this workspace');
    const registration = await deps.registration.readWorkspaceRegistration(at.ctx, workspace);
    if (registration.status !== 'ready') return registration;
    const intent: QueryJobIntentV1 = { schemaVersion: 1, intentId: round.queryJobId, projectId, workspaceId,
      goalId: null, question: round.question, focusTaskRefs: [], budget: { ...profile.budget },
      multiTurn: { maxRounds: 1 }, correlationId: at.op.ref.operationId,
      execution: roleExplorationExecution({ roleBinding: profile.roleBinding, runtimeBudget: profile.runtimeBudget }) };
    // A null-Goal Query carries no Goal pin: Project, Workspace and the new pair only.
    const submitted = await deps.queries.submitQueryJob(at.ctx, {
      input: { queryJobId: round.queryJobId, runId: round.runId, intent },
      meta: { requestId: `cold-start-submit:${round.runId}`, expected: [
        { ref: { aggregateType: 'Project', projectId }, revision: registration.value.project.revision },
        { ref: { aggregateType: 'Workspace', projectId, workspaceId }, revision: registration.value.workspace.revision },
        { ref: queryJobRef, revision: 0 },
        { ref: { aggregateType: 'QueryRun', projectId, workspaceId, queryJobId: round.queryJobId, runId: round.runId },
          revision: 0 },
      ] },
    });
    if (submitted.status !== 'committed') return submitted;
    return { status: 'ready', value: explorationEntryOf(submitted.value.run.ref) };
  }

  /** The first round of a segment: the line's card, one Host system "please act" message, then the Query. */
  async function openExploration(at: AtV1, input: { line: SessionRef; segment: RoleExplorationSegmentV1;
    region: ModuleRef | null; key: string }): Promise<ReadResult<ColdStartExplorationQueryRefV1>> {
    const card = await deps.sessions.readSession(at.ctx, input.line);
    if (card.status !== 'ready') return card;
    const question = roleExplorationQuestion(input.segment, input.region);
    const sent = await deps.messages.sendMessage(at.ctx, {
      input: { recipient: input.line, text: question, intent: 'action_request' },
      meta: { requestId: `cold-start-message:${at.op.ref.operationId}:${input.key}`, expected: [] },
    });
    if (sent.status !== 'committed') return sent;
    const base = `${at.input.projectId}:${input.segment}:${input.region?.moduleId ?? 'root'}`;
    return submitExploration(at, { queryJobId: `cold-start-query:${base}`, runId: `cold-start-run:${base}`, question,
      segment: input.segment, line: input.line, card: card.value, messageRef: sent.value.ref });
  }

  /** Rulings 4, 5: the group's last round. `not_entered` (a restart before entry, the handoff fence) did nothing and
   *  opens round n on the same line and message; any other close has ended and is not retried. A pending round is
   *  claimed on its line and handed to the stage driver, which runs it detached. */
  async function endingOf(at: AtV1, group: readonly ColdStartExplorationQueryRefV1[]): Promise<ReadResult<EndingV1>> {
    const entry = group.at(-1)!;
    const runRef = entry.queryRunRef;
    const queryJobRef = queryJobRefFor(runRef.projectId, runRef.workspaceId, runRef.queryJobId);
    const read = await deps.queries.readQueryJob(at.ctx, queryJobRef);
    if (read.status !== 'ready') return read;
    const job = read.value.job.job;
    if (job.status === 'answered') return { status: 'ready', value: { kind: 'ended' } };
    if (job.status === 'closed') {
      if (job.closeReason?.code !== 'not_entered') return { status: 'ready', value: { kind: 'ended' } };
      const card = await deps.sessions.readSession(at.ctx, entry.sessionRef);
      if (card.status !== 'ready') return card;
      // Round n's ids are the first round's plus `:n`; a crash before the save recomputes the same n.
      const first = group[0]!.queryRunRef;
      const attempt = group.length + 1;
      const reopened = await submitExploration(at, { queryJobId: `${first.queryJobId}:${attempt}`,
        runId: `${first.runId}:${attempt}`, question: job.intent.question, segment: entry.segment,
        line: entry.sessionRef, card: card.value, messageRef: entry.messageRef });
      if (reopened.status !== 'ready') return reopened;
      return { status: 'ready', value: { kind: 'reopen', entry: reopened.value } };
    }
    const run = read.value.run;
    if (run.run.executionState === undefined) {
      const card = await deps.sessions.readSession(at.ctx, entry.sessionRef);
      if (card.status !== 'ready') return card;
      const claimed = await deps.queries.claimQuery(at.ctx, {
        input: { queryRunRef: runRef, sessionRef: entry.sessionRef, profile: null },
        meta: { requestId: `cold-start-claim:${runRef.runId}`, expected: [
          { ref: read.value.job.ref, revision: read.value.job.revision },
          { ref: run.ref, revision: run.revision },
          { ref: plainSessionRefToAggregate(entry.sessionRef), revision: card.value.record.revision },
        ] },
      });
      if (claimed.status !== 'committed') return claimed;   // a busy line or a moved revision: the next pass retries
    }
    const advanced = await deps.stages.advance(at.ctx, { queryJobRef, expectedRunRef: runRef, profile: null });
    if (advanced.status === 'blocked' && advanced.retry === 'backoff') {
      return rejected('unavailable', `the exploration round backs off: ${advanced.reason}`);
    }
    return { status: 'ready', value: { kind: 'running' } };
  }

  async function candidatesPhase(at: AtV1): Promise<DriveResultV1> {
    const found = await deps.initial.readCandidate(at.ctx,
      { workspace: { projectId: at.input.projectId, workspaceId: at.input.workspaceId } });
    if (found.status !== 'ready') return found;
    if (found.value === null) return stop(at);
    return write(at, advanceColdStartPhase(at.action, { candidate: found.value }));
  }

  async function adoptedPhase(at: AtV1): Promise<DriveResultV1> {
    const read = await deps.adoption.readAdopted(at.ctx, { answerRef: at.action.candidate!.answerRef });
    if (read.status !== 'ready') return read;
    return read.value ? write(at, advanceColdStartPhase(at.action, {})) : stop(at);
  }

  async function routePhase(at: AtV1): Promise<DriveResultV1> {
    const runRef = at.action.candidate!.queryRunRef;
    const job = await deps.queries.readQueryJob(at.ctx,
      queryJobRefFor(runRef.projectId, runRef.workspaceId, runRef.queryJobId));
    if (job.status !== 'ready') return job;
    const requestRoot = job.value.job.job.requestRoot!;   // the candidate is read from a request root
    const chosen = await routeOf(at.ctx, requestRoot);
    if (chosen !== null) {
      const window = await readCurrentCatalogWindow(deps.records, at.input.projectId);
      if (window.status !== 'ready') return window;
      return write(at, advanceColdStartPhase(at.action, { route: chosen, baseCatalogPin: catalogPinOf(window) }));
    }
    // The same operationId answers with the first receipt: one route round, however many passes ask.
    const asked = await deps.route.askRoute(at.ctx, { operationId: `cold-start-route:${at.input.projectId}`,
      requestRoot, text: COLD_START_ROUTE_QUESTION });
    if (asked.status !== 'ready') return asked;
    return stop(at);
  }

  async function coarseSplitPhase(at: AtV1): Promise<DriveResultV1> {
    const action = at.action;
    if (action.route === 'map') return write(at, advanceColdStartPhase(action, {}));
    const group = explorationGroupsOf(action.explorations, 'coarse_split')[0];
    if (group === undefined) {
      const startLines = await deps.sessions.getSessionOperation(at.ctx,
        roleLineOperationRef(at.input.projectId, 'start_lines', 'start_lines'));
      if (startLines.status !== 'ready') return startLines;
      const parent = startLines.value.action;
      const step = parent.kind === 'role_line' ? parent.steps.find((candidate) => candidate.key === 'adviser') : undefined;
      const line = await roleLineStepSession(deps.sessions, at.ctx, step ?? { childOperation: null });
      if (line.status !== 'ready') return line;
      if (line.value === null) return rejected('unavailable', 'the opening adviser line is not created');
      const entry = await openExploration(at, { line: line.value, segment: 'coarse_split', region: null,
        key: 'coarse_split' });
      if (entry.status !== 'ready') return entry;
      return write(at, { ...action, explorations: [entry.value] });   // d31: submitting is not the approval
    }
    const end = await endingOf(at, group);
    if (end.status !== 'ready') return end;
    if (end.value.kind === 'reopen') return write(at, { ...action, explorations: [...action.explorations, end.value.entry] });
    if (end.value.kind === 'running') return stop(at);
    // d31: the round ending is not the approval either; 8C's apply moves the adopted pin past the route's pin.
    const window = await readCurrentCatalogWindow(deps.records, at.input.projectId);
    if (window.status !== 'ready') return window;
    if (sameJson(catalogPinOf(window), action.baseCatalogPin)) return stop(at);
    return write(at, advanceColdStartPhase(action, {}));
  }

  async function regionsPhase(at: AtV1): Promise<DriveResultV1> {
    const action = at.action;
    const { projectId } = at.input;
    const window = await readCurrentCatalogWindow(deps.records, projectId);
    if (window.status !== 'ready') return window;
    if (action.route === 'map') return write(at, advanceColdStartPhase(action, { baseCatalogPin: catalogPinOf(window) }));
    const catalog = window.catalog.catalog;
    const explored = new Set(action.explorations.filter((entry) => entry.segment === 'region')
      .map((entry) => entry.queryRunRef.queryJobId));
    const todo = topLevelModules(catalog)
      .filter((module) => !explored.has(`cold-start-query:${projectId}:region:${module.moduleId}`));
    const lines = await deps.regionLines.readOpenRegionLines(at.ctx, { projectId });
    if (lines.status !== 'ready') return lines;
    const claims: RegionClaimV1[] = [];
    for (const line of lines.value) {
      if (line.duty !== 'adviser' || line.link.ref.target.kind !== 'module') continue;
      claims.push({ session: line.session, duty: line.duty, moduleRef: line.link.ref.target.ref });
    }
    const pending: ModuleRef[] = [];
    const added: ColdStartExplorationQueryRefV1[] = [];
    for (const module of todo) {
      // A line already responsible for the region (a person's, or one this cold start placed before a crash).
      let line = claims.find((claim) => claim.moduleRef.projectId === module.projectId
        && claim.moduleRef.moduleId === module.moduleId)?.session ?? null;
      if (line === null) {
        const reused = await deps.standby.reuseStandby(at.ctx, {
          commandId: `cold-start-reuse:${at.op.ref.operationId}:${module.moduleId}`, duty: 'adviser',
          scope: [{ kind: 'region', moduleRef: module }], modules: regionModulesOf(claims, module, catalog) });
        if ('status' in reused) return reused;
        if (reused.kind === 'reused') {
          line = reused.line.session!;
        } else {
          const opened = await deps.lines.openRegionLine(at.ctx, {
            commandId: `cold-start-region:${at.op.ref.operationId}:${module.moduleId}`,
            parentOperation: at.op.ref, duty: 'adviser', module });
          if (opened.status === 'capacity_blocked' || opened.status === 'accepted') { pending.push(module); continue; }
          if (opened.status === 'rejected') return opened;
          line = opened.value.session!;
        }
      }
      const entry = await openExploration(at, { line, segment: 'region', region: module,
        key: `region:${module.moduleId}` });
      if (entry.status !== 'ready') return entry;
      added.push(entry.value);   // d32: submitted only; `proposals` claims and runs it
    }
    const samePending = pending.length === action.pendingRegions.length
      && pending.every((module, index) => module.projectId === action.pendingRegions[index]!.projectId
        && module.moduleId === action.pendingRegions[index]!.moduleId);
    if (added.length === 0 && pending.length > 0 && samePending) return stop(at);
    const next: ColdStartActionV1 = { ...action, pendingRegions: pending,
      explorations: [...action.explorations, ...added] };
    if (pending.length > 0) return write(at, next);
    // C1-15: the base pin from here on is the one after the coarse split was applied.
    return write(at, advanceColdStartPhase(next, { pendingRegions: [], baseCatalogPin: catalogPinOf(window) }));
  }

  /** d33: the first freeze takes every pending proposal in one batch; each later one freezes alone. */
  async function freezePending(ctx: CoreCallContext, pin: ArchitectureCatalogPinV1,
    refs: readonly ArchitectureProposalRef[], together: boolean): Promise<ReadResult<ArchitectureProposalBatchRef[]>> {
    const batchRefs: ArchitectureProposalBatchRef[] = [];
    for (const proposalRefs of together ? [refs] : refs.map((ref) => [ref])) {
      const frozen = await deps.proposals.freezeArchitectureProposalBatch(ctx,
        { baseCatalogPin: pin, proposalRefs: [...proposalRefs] });
      if (frozen.status !== 'ready') return frozen;
      batchRefs.push(...frozen.value.map((batch) => ({ ...batch.ref })));
    }
    return { status: 'ready', value: batchRefs };
  }

  async function proposalsPhase(at: AtV1): Promise<DriveResultV1> {
    const action = at.action;
    let unfinished = false;
    for (const group of explorationGroupsOf(action.explorations, 'region')) {
      const end = await endingOf(at, group);
      if (end.status !== 'ready') return end;
      if (end.value.kind === 'reopen') {
        return write(at, { ...action, explorations: [...action.explorations, end.value.entry] });
      }
      if (end.value.kind === 'running') unfinished = true;   // every region line still claims and starts this pass
    }
    if (unfinished) return stop(at);
    const pin = action.baseCatalogPin;
    if (pin === null) return rejected('invalid', 'the cold-start proposals phase has no base pin');
    const projectRef = { projectId: at.input.projectId };
    // D-19: a batch frozen before a crash but not saved yet is restored before reading pending; the restored
    // `batchRefs` then make every pending proposal a late batch, each its own.
    const frozenOnPin = await deps.proposals.readFrozenArchitectureBatches(at.ctx, { projectRef, baseCatalogPin: pin });
    if (frozenOnPin.status !== 'ready') return frozenOnPin;
    const restored = frozenOnPin.value.filter((ref) => !action.batchRefs.some((saved) => sameJson(saved, ref)));
    if (restored.length > 0) return write(at, { ...action, batchRefs: [...action.batchRefs, ...restored] });
    // The completion's CAS: a proposal commit after this ledger read moves the horizon, so the completion write
    // conflicts and the next pass re-reads pending and freezes that proposal as its own batch.
    const horizon = await deps.records.readMany([]);
    if (horizon.status !== 'ready') return rejected('unavailable', 'the ledger horizon cannot be read');
    const pending = await deps.proposals.readPendingArchitectureProposals(at.ctx, { projectRef });
    if (pending.status !== 'ready') return pending;
    if (pending.value.length > 0) {
      const frozen = await freezePending(at.ctx, pin, pending.value, action.batchRefs.length === 0);
      if (frozen.status !== 'ready') return frozen;
      if (frozen.value.length > 0) return write(at, { ...action, batchRefs: [...action.batchRefs, ...frozen.value] });
    }
    const handled = await savedBatchesHandled(deps.records, action.batchRefs);
    if (handled.status !== 'ready') return handled;
    if (!handled.value) return stop(at);
    // d10: the phase pointer stays at `proposals`; the record completes.
    return write(at, { ...action, lastCompleted: 'proposals' }, 'completed', horizon.value.readThrough);
  }

  async function driveColdStart(ctx: CoreCallContext, input: DriveInputV1): Promise<DriveResultV1> {
    const read = await readColdStartRecord(deps.records, input.projectId);
    if (read.status !== 'ready') return read;
    const { record: op, action } = read.value;
    if (op.phase === 'completed') {
      return { status: 'ready', value: { phase: action.phase, revision: op.revision, completed: true } };
    }
    if (op.phase !== 'accepted' && op.phase !== 'running') {
      return rejected('unavailable', `the cold-start operation is ${op.phase}`);
    }
    const problem = coldStartPhaseProblem(action);
    if (problem !== null) return rejected('invalid', problem);
    const at: AtV1 = { ctx, input, op, action };
    switch (action.phase) {
      case 'candidates': return candidatesPhase(at);
      case 'adopted': return adoptedPhase(at);
      case 'route': return routePhase(at);
      case 'coarse_split': return coarseSplitPhase(at);
      case 'regions': return regionsPhase(at);
      case 'proposals': return proposalsPhase(at);
    }
  }

  return { drive: driveColdStart };
}
