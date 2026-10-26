/**
 * The handoff owner's accept: `handoff.accept` records a handoff operation (the `handoff` arm of `CoreOperation`) at
 * revision 1, phase `accepted`, through the shared write executor. Nothing else moves: the source keeps its work and
 * its tasks until the later steps run.
 *
 * The refusal order is `state/session-handoff.ts admitHandoff`: the caller, the scope and the shape are checked before
 * the command's identity is hashed; the source, the targets, their duties and the unfinished operations of the source
 * are read inside the command, so a replay of a committed accept never reads them. The source and each `existing`
 * target are read through the public Session read, so a Session of another project or workspace is not found. A
 * refusal writes nothing.
 */
import { principalIdentity, type CoreCallContext, type HostPrincipal } from '../../../contracts/core/call-context.js';
import type { CommitCursor } from '../../../contracts/command-event.js';
import type { RequestSessionArchiveInput, SessionArchiveConditionV1 } from '../../../contracts/core/session-archive.js';
import type { QueryJobRef, QueryRunRef, RequestUnderstandingCommandV1 } from '../../../contracts/query-job.js';
import { messageOf } from '../../../contracts/error-message.js';
import type { SessionRef, VersionPin, WorkspaceScope } from '../../../contracts/core/identity.js';
import type { SessionWorkLink } from '../../../contracts/core/session.js';
import type { OperationRef } from '../../../contracts/core/operations.js';
import { rejected, rejectedWithCurrent } from '../../../contracts/core/rejections.js';
import type { CoreRejection, ReadResult, WriteResult } from '../../../contracts/core/results.js';
import type { TaskTriple } from '../../../contracts/dispatch.js';
import { canonicalKey, canonicalOf, type JsonValue } from '../../../contracts/fingerprint.js';
import type { PlatformDutyV1 } from '../../../contracts/platform-duty.js';
import { SESSION_ARCHIVE_AUTOMATION_ACTOR } from '../../../contracts/task-requeue.js';
import { isRecord } from '../../../contracts/validation/common.js';
import { checkShape } from '../../../contracts/validation/data-format.js';
import type { RecordLookupPort } from '../../record-store/lookup-ports.js';
import type {
  EncodedDomainEvent, EncodedRecord, GoalRecordTransactionPort, RecordCommitIdentityPort, RecordGuard,
  UniqueClaimChange,
} from '../../record-store/ports.js';
import type {
  HandoffAdvanceInputV1, HandoffAdvanceResultV1, HandoffAdvanceStopV1, HandoffBriefRefsReadPort,
  HandoffRequestFactsReadPort,
  HandoffSavedCreateInputV1,
  HandoffSavedInputV1, HandoffStageV1,
  SecretaryArchiveAcceptInputV1, SecretaryArchiveAcceptResultV1, SecretaryArchiveAdvanceInputV1,
  SecretaryArchiveAdvanceResultV1, SecretaryArchiveStageV1,
} from '../model/session-handoff-contracts.js';
import type { SecretaryHandoffBasisV1, SecretaryHandoffFactsPort } from '../model/secretary-lifecycle-contracts.js';
import { HANDOFF_SYSTEM_PRINCIPAL, type HandoffRequestReceiptReadPort } from '../model/request-contracts.js';
import type { SessionDirectoryPort, SessionOperationRecord, SessionOperationRecordOf } from '../model/session-contracts.js';
import {
  HANDOFF_STAGES, HandoffActionShape, SECRETARY_ARCHIVE_STAGES, SecretaryArchiveActionShape,
  archiveSavedInputProblem, handoffReachedInputProblem, type HandoffActionV1, type SecretaryArchiveActionV1,
} from '../model/session-operation-arms.js';
import type { SessionDutyReadPort } from '../model/work-line-contracts.js';
import {
  commandIdentity, commandKeys, executeWriteCommand, readCommittedEvent, type CommandResult, type Keys,
} from '../persistence/command-executor.js';
import { lookupAll } from '../persistence/lookup-all.js';
import { sessionActivityRefOf } from './session-activity.js';
import { lookupCommittedReceiptByIdentity } from '../persistence/receipt-lookup.js';
import { currentPointerRefKey } from '../persistence/note-record-codecs.js';
import type { CommittedReceipt } from '../persistence/receipt-lookup.js';
import { storeFailureToRejection } from '../persistence/read-result-failures.js';
import { ownerReadStoreFailureToRejection } from '../persistence/read-result-failures.js';
import {
  briefReady, coverageHolds, saveArchiveReceipt, saveArchiveSavedInput, saveHandoffCreateInput,
  saveUnderstandingCommand, withHandoffProgress,
} from '../state/session-handoff.js';
import { sameRef } from '../state/ref-equality.js';
import { openResponsibleLinkOf } from '../state/session-availability.js';
import {
  admitHandoff, admitSecretaryArchive, newHandoffOperationRecord, newSecretaryArchiveOperationRecord,
  type HandoffAdmissionFactsV1, type OperationAdmissionV1, type OperationSessionFactV1,
  type SecretaryArchiveAdmissionFactsV1,
} from '../state/session-handoff.js';
import {
  CORE_OPERATION_BY_WORKSPACE_PHASE_LOOKUP, decodeSessionOperationRecord, encodeSessionOperationRecord, operationRefKey,
  plainSessionRefKey, secretaryArchiveRecordedCodec, sessionHandoffRecordedCodec,
} from './session-record-codecs.js';
import { readHandoffFence, secretaryHandoffClaimKey } from './session-handoff-fence.js';
import { stableSessionCreationIdentity } from './session-directory.js';
import type { SessionLifecyclePort } from './lifecycle-contracts.js';
import { responsibleLinkRef } from './session-responsibility-service.js';
import type { SessionResponsibilityReceiptReadPort, SavedTransferInputV1 } from './session-responsibility-service.js';
import type { GraphWrite } from '../model/task-contracts.js';
import type { CoverageFactsV1 } from '../model/secretary-lifecycle-contracts.js';
import { eventIdOf, trustedContext } from './trusted-context.js';

export type HandoffAcceptInputV1 = {
  commandId: string; workspace: WorkspaceScope; source: SessionRef;
  trigger: 'too_long' | 'manual';
  assignments: { target: { kind: 'create'; duty: PlatformDutyV1 } | { kind: 'existing'; session: SessionRef }; tasks: TaskTriple[] }[];
};
export type HandoffAcceptResultV1 = WriteResult<{ operation: OperationRef; stage: 'accepted'; phase: 'accepted' }>;
export interface SessionHandoffPort {
  acceptHandoff(ctx: CoreCallContext, input: HandoffAcceptInputV1): Promise<HandoffAcceptResultV1>;
  advanceHandoff(ctx: CoreCallContext, input: HandoffAdvanceInputV1): Promise<HandoffAdvanceResultV1>;
}

const OPERATION = 'handoff.accept';
type ReadFacts = NonNullable<HandoffAdmissionFactsV1['read']>;
type AcceptFacts = { read: ReadFacts; sourceRevision: number | null };
type HandoffRecordedEvent = Extract<ReturnType<typeof sessionHandoffRecordedCodec.decode>, { status: 'decoded' }>['value'];
/** The one handoff record event: the owner's writes encode it, the replays and the notice projection decode it. */
export const handoffRecordedEvent = { eventType: 'SessionHandoffRecorded', schemaVersion: 1,
  decode: (event: EncodedDomainEvent) => sessionHandoffRecordedCodec.decode(event) };

/** The operation id of one accept: the identity key's hash part, so a replay names the same operation. */
function handoffOperationId(keys: Keys): string {
  return `session-handoff-${keys.identityKey.slice(OPERATION.length + 1)}`;
}

function admissionRejection(admitted: Exclude<OperationAdmissionV1, { ok: true }>): CoreRejection {
  return rejectedWithCurrent(admitted.code, admitted.detail, admitted.current);
}

/** The one answer for a write the executor ran: its committed shape, the refusal arm's rejection or the failure. */
function writeAnswer<T>(result: CommandResult<T, CoreRejection>): WriteResult<T> {
  if (result.status === 'committed') {
    return { status: 'committed', value: result.value, replayed: result.replayed, cursor: result.cursor };
  }
  if (result.status === 'refused') return result.refusal;
  return rejectedWithCurrent(result.code, result.reason, result.current);
}

/** The caller's input, copied before the first await so a later mutation cannot change this command's material. */
function copiedInput<T>(raw: T, what: string): { ok: true; value: T } | { ok: false; rejection: CoreRejection } {
  try {
    return { ok: true, value: structuredClone(raw) };
  } catch {
    return { ok: false, rejection: rejected('invalid', `the ${what} cannot be copied`) };
  }
}

/**
 * A Session the operation names, through the public Session read in the call's project and workspace (anything else
 * is not found), with its real duty and the revision the read saw. Both accepts read their Sessions through it.
 */
async function sessionFactOf(reads: { sessions: Pick<SessionDirectoryPort, 'readSession'>; duty: SessionDutyReadPort },
  ctx: CoreCallContext, ref: SessionRef):
  Promise<{ status: 'ready'; fact: OperationSessionFactV1; revision: number | null } | CoreRejection> {
  const read = await reads.sessions.readSession(ctx, ref);
  if (read.status === 'not_found') return { status: 'ready', fact: { kind: 'missing' }, revision: null };
  if (read.status === 'rejected') return read;
  if (read.status !== 'ready') return rejected('unavailable', 'the Session read is not ready');
  const { record } = read.value;
  const duty = await reads.duty(record.role, ctx);
  return { status: 'ready', revision: record.revision, fact: { kind: 'present', archived: record.lifecycle === 'archived',
    readonlyCopy: record.provenance.kind === 'readonly_copy', duty: duty.status === 'ready' ? duty.value : 'unknown' } };
}

/** The accepted or running operations that name this source, as pins; a damaged record is `unavailable`. */
async function unfinishedPinsOf(records: Pick<RecordLookupPort, 'lookup'>, scope: WorkspaceScope, source: SessionRef):
  Promise<{ status: 'ready'; value: VersionPin[] } | CoreRejection> {
  const pins: VersionPin[] = [];
  for (const phase of ['accepted', 'running'] as const) {
    let items: readonly EncodedRecord[];
    try {
      items = (await lookupAll(records, CORE_OPERATION_BY_WORKSPACE_PHASE_LOOKUP,
        [scope.projectId, scope.workspaceId, phase])).items;
    } catch (failure) {
      return ownerReadStoreFailureToRejection(failure as { code: string; reason: string });
    }
    for (const encoded of items) {
      const decoded = decodeSessionOperationRecord(encoded);
      if (decoded.status !== 'decoded') return rejected('unavailable', `an unfinished operation is damaged: ${decoded.reason}`);
      const operation = decoded.value;
      if (operation.action.kind !== 'create' && sameRef(operation.action.input.source, source)) {
        pins.push({ ref: operation.ref, revision: operation.revision });
      }
    }
  }
  return { status: 'ready', value: pins };
}

export function createSessionHandoffService(deps: {
  records: GoalRecordTransactionPort & RecordLookupPort; sessions: Pick<SessionDirectoryPort, 'readSession'>;
  duty: SessionDutyReadPort; now: () => string;
}): Pick<SessionHandoffPort, 'acceptHandoff'> {
  async function readHandoffFacts(ctx: CoreCallContext, input: HandoffAcceptInputV1):
    Promise<{ status: 'ready'; facts: AcceptFacts } | CoreRejection> {
    const source = await sessionFactOf(deps, ctx, input.source);
    if (source.status !== 'ready') return source;
    const targets: ReadFacts['targets'][number][] = [];
    for (const { target } of input.assignments) {
      if (target.kind === 'create') {
        targets.push(target);
        continue;
      }
      const existing = await sessionFactOf(deps, ctx, target.session);
      if (existing.status !== 'ready') return existing;
      targets.push({ kind: 'existing', session: existing.fact });
    }
    const unfinished = await unfinishedPinsOf(deps.records, input.workspace, input.source);
    if (unfinished.status !== 'ready') return unfinished;
    return { status: 'ready', facts: { read: { source: source.fact, targets, unfinished: unfinished.value },
      sourceRevision: source.revision } };
  }

  return {
    async acceptHandoff(ctx, rawInput) {
      const trusted = trustedContext(ctx, 'a handoff');
      if (!trusted.ok) return trusted.rejection;
      const copy = copiedInput(rawInput, 'handoff input');
      if (!copy.ok) return copy.rejection;
      const input = copy.value;
      const given: Partial<HandoffAcceptInputV1> = isRecord(input) ? input : {};
      const actor = { kind: trusted.actor.kind, id: trusted.actor.id };
      // The action as it would be stored: the shape is checked before anything is hashed or read. The write command
      // puts its own input fingerprint in place of the placeholder, so the check cannot depend on it.
      const actionOf = (fingerprint: string): HandoffActionV1['input'] => ({ workspace: given.workspace!, source: given.source!,
        trigger: given.trigger!, actor, assignments: given.assignments!, commandId: given.commandId!, fingerprint });
      let candidate: unknown;
      try {
        candidate = newHandoffOperationRecord({ ref: null, at: '', input: actionOf('0'.repeat(64)) }).action;
      } catch {
        candidate = { kind: 'handoff', input: actionOf('0'.repeat(64)), progress: null };
      }
      const workspace: unknown = given.workspace;
      const early: HandoffAdmissionFactsV1 = {
        caller: trusted.actor.kind === 'human' ? 'host_human' : 'host_system',
        trigger: given.trigger,
        inScope: isRecord(workspace) && workspace['projectId'] === trusted.scope.projectId
          && workspace['workspaceId'] === trusted.scope.workspaceId,
        shapeProblem: checkShape(HandoffActionShape, candidate, 'stored'),
        read: null,
      };
      const precheck = admitHandoff(early);
      if (!precheck.ok) return admissionRejection(precheck);

      const result = await executeWriteCommand<AcceptFacts, AcceptFacts, CoreRejection, HandoffRecordedEvent,
        { operation: OperationRef; stage: 'accepted'; phase: 'accepted' }>(deps.records, {
        operation: OPERATION,
        scope: { projectId: input.workspace.projectId, workspaceId: input.workspace.workspaceId },
        principal: principalIdentity(ctx.principal),
        commandId: input.commandId,
        fingerprintInput: { source: input.source, trigger: input.trigger, assignments: input.assignments } as unknown as JsonValue,
        read: () => readHandoffFacts(ctx, input),
        decide(facts) {
          const admitted = admitHandoff({ ...early, read: facts.read });
          return admitted.ok ? { decision: facts } : { refuse: admissionRejection(admitted) };
        },
        build(facts, keys) {
          const ref: OperationRef = { aggregateType: 'CoreOperation', projectId: input.workspace.projectId,
            operationId: handoffOperationId(keys) };
          const at = deps.now();
          const record: SessionOperationRecordOf<HandoffActionV1> = newHandoffOperationRecord({ ref, at,
            input: actionOf(keys.fingerprint) });
          return {
            // The operation is new; the source is pinned at the revision the facts read.
            guards: [{ refKey: operationRefKey(ref), expectedRevision: null },
              { refKey: plainSessionRefKey(input.source), expectedRevision: facts.sourceRevision }],
            records: [encodeSessionOperationRecord(record)],
            claims: [],
            events: [sessionHandoffRecordedCodec.encode({ eventId: eventIdOf(keys.identityKey, 'accepted'),
              eventType: 'SessionHandoffRecorded', schemaVersion: 1, occurredAt: at, projectId: ref.projectId,
              workspaceId: record.workspaceId, operationRef: ref, revision: record.revision, phase: record.phase,
              action: record.action })],
          };
        },
        result: {
          eventType: 'SessionHandoffRecorded',
          schemaVersion: 1,
          decode: event => sessionHandoffRecordedCodec.decode(event),
          validate(event, _receipt, keys) {
            if (event.operationRef.operationId !== handoffOperationId(keys)) return 'the event records another operation';
            if (event.revision !== 1) return 'the event is not the first revision';
            return event.phase === 'accepted' && event.action.progress.stage === 'accepted' ? null
              : 'the event is not an accepted handoff';
          },
          project: event => ({ operation: event.operationRef, stage: 'accepted', phase: 'accepted' }),
        },
      });
      return writeAnswer(result);
    },
  };
}

export type AdvanceOperationV1 = 'handoff.advance' | 'secretaryArchive.advance';

/** The frozen parent write token: `<operationId>:<stage>:<item>:<before|after|refused>:<generation|revision>`. */
export function advanceCommandId(operation: OperationRef, stage: HandoffStageV1 | SecretaryArchiveStageV1,
  item: string, phase: 'before' | 'after' | 'refused', generation: number): string {
  return `${operation.operationId}:${stage}:${item}:${phase}:${generation}`;
}

/** One parent token plus that write's R2 identity and fingerprint; the refusal mark's token guards a revision. */
export function advanceWriteKeys(input: {
  principal: JsonValue;
  scope: { projectId: string; workspaceId: string };
  kind: AdvanceOperationV1;
  operation: OperationRef;
  stage: HandoffStageV1 | SecretaryArchiveStageV1;
  item: string;
  phase: 'before' | 'after' | 'refused';
  generation: number;
  fingerprintInput: JsonValue;
}): { commandId: string; keys: { identityKey: string; fingerprint: string } } {
  const commandId = advanceCommandId(input.operation, input.stage, input.item, input.phase, input.generation);
  return {
    commandId,
    keys: commandKeys({
      operation: input.kind,
      scope: input.scope,
      principal: input.principal,
      commandId,
      fingerprintInput: input.fingerprintInput,
    }),
  };
}

/** The Host principal a saved actor implies; `null` for a missing or agent actor. */
export function savedHostPrincipal(actor: unknown): HostPrincipal | null {
  if (typeof actor !== 'object' || actor === null) return null;
  const value = actor as { kind?: unknown; id?: unknown };
  if ((value.kind !== 'human' && value.kind !== 'system') || typeof value.id !== 'string' || value.id.length === 0) {
    return null;
  }
  return { kind: 'host', actor: { kind: value.kind, id: value.id } };
}

/** The same call context with the saved principal in both slots (project/workspace/signal unchanged). */
export function handoffContextOf(ctx: CoreCallContext, principal: HostPrincipal): CoreCallContext {
  const scope = ctx.workspaceId === undefined
    ? { projectId: ctx.projectId }
    : { projectId: ctx.projectId, workspaceId: ctx.workspaceId };
  return {
    ...scope,
    principal,
    materialReader: { kind: 'host', ...scope, actor: { ...principal.actor } },
    signal: ctx.signal,
  };
}

/**
 * L9: the archive child's context. The lifecycle owner lets only the platform automation request a non-operator
 * archive, so the registration, its receipt read and the final read all run as the archive automation; the
 * operations keep their own saved actor in their records.
 */
export function archiveContextOf(ctx: CoreCallContext): CoreCallContext {
  return handoffContextOf(ctx, { kind: 'host', actor: { ...SESSION_ARCHIVE_AUTOMATION_ACTOR } });
}

// -------------------------------------------------------------------------- //
// The chained advance: one atomic parent write per call                      //
// -------------------------------------------------------------------------- //

export type SessionHandoffAdvancePort = Pick<SessionHandoffPort, 'advanceHandoff'>;

export type SessionHandoffAdvanceDependencies = {
  /** The operation and parent-write store; it carries `lookupCommit` and the event read. */
  records: GoalRecordTransactionPort & RecordLookupPort;
  /** Identity-only replay read, separate from the records intersection. */
  commitIdentities: Pick<RecordCommitIdentityPort, 'readCommitByIdentity'>;
  /** The operation read and the final-archive Session read. */
  operations: Pick<SessionDirectoryPort, 'getSessionOperation' | 'readSession'>;
  /** The coverage and routing-set reads (the one facts view). */
  /** The one facts view, plus the brief's saved goal refs it reads: this owner reads no Note itself. */
  coverage: Pick<SecretaryHandoffFactsPort, 'readCoverage' | 'readRoutingSet'> & HandoffBriefRefsReadPort;
  /** D's threshold basis, bound by I1. */
  basis(session: SessionRef, scope: WorkspaceScope): Promise<ReadResult<SecretaryHandoffBasisV1>>;
  /** D's internal request receipt read; the close of an old understanding command belongs to the composite. */
  requests: Pick<HandoffRequestReceiptReadPort, 'readRequestCommandReceipt'>;
  /** The transfer read-only entry. */
  transfers: Pick<SessionResponsibilityReceiptReadPort, 'readTransferReceipt'>;
  /** The archive registration read; the final archive is `operations.readSession`. */
  archive: Pick<SessionLifecyclePort, 'readSessionArchiveRequestReceipt'>;
  /** The one trusted duty read: the source Session's own role decides the secretary steps. */
  duty: SessionDutyReadPort;
  now(): string;
};

type HandoffProgress = HandoffActionV1['progress'];
type AdvanceResult = Extract<HandoffAdvanceResultV1, { status: 'committed' }>['value'];
type Stop = AdvanceResult['stop'];

/** The source's real duty is the only secretary test: never the target's shape, the trigger or saved coverage. */
export function isSecretaryDuty(duty: PlatformDutyV1 | 'unknown'): boolean {
  return duty === 'secretary';
}

/** The saved input arm of one item, when the write stored one. */
function savedInputFor(action: HandoffActionV1, stage: HandoffStageV1, item: string): HandoffSavedInputV1 | null {
  const progress = action.progress;
  if (stage === 'successor' && item.startsWith('assignment:')) {
    const index = Number(item.slice('assignment:'.length));
    const saved = progress.assignments[index]?.createInput;
    return saved === undefined || saved === null ? null : { kind: 'create', requestId: saved.commandId, input: saved };
  }
  if (stage === 'transfer' && item.startsWith('transfer:')) {
    const [, assignmentText, taskText] = item.split(':');
    const assignment = Number(assignmentText);
    const task = Number(taskText);
    const input = progress.assignments[assignment]?.transfers[task];
    if (input?.input === undefined || input.input === null) return null;
    return { kind: 'transfer', requestId: input.input.requestId, from: input.input.from, to: input.input.to,
      target: { kind: 'task', ref: input.task }, expected: { ...input.input.expected } };
  }
  if (stage === 'routing' && item.startsWith('root:')) {
    const rootId = item.slice('root:'.length);
    const root = progress.routing?.roots.find(entry => entry.requestRoot.queryJobId === rootId);
    if (root?.input === undefined || root.input === null) return null;
    return { kind: 'route', operationId: root.input.operationId, to: root.input.to,
      expectedSource: root.input.expectedSource };
  }
  if (stage === 'archive') {
    const request = progress.archiveRequest?.savedInput;
    return request === undefined || request === null ? null : { kind: 'archive', request };
  }
  if (stage === 'understanding' && item.startsWith('understanding:')) {
    const generation = Number(item.slice('understanding:'.length));
    const entry = progress.understanding.find(candidate => candidate.generation === generation);
    return entry?.command === undefined || entry.command === null ? null : { kind: 'understanding', command: entry.command };
  }
  if (stage === 'fence') return { kind: 'fence', basis: 'take' };
  // The wait and recheck arms are written material, not a stage constant: read the arm the event's own progress holds.
  if (stage === 'wait_writer') {
    return { kind: 'wait', basis: `stopped:${progress.stoppedWriter?.lastExecution?.runId ?? 'none'}` };
  }
  if (stage === 'recheck') {
    return { kind: 'recheck', basis: progress.stage === 'successor' ? 'passed' : 'incomplete' };
  }
  if (stage === 'notice') return { kind: 'notice', basis: progress.noticeItemKey ?? `handoff:${'unknown'}` };
  if (stage === 'finished') return { kind: 'finish', basis: 'released' };
  return null;
}

/** The stored receipt arm of one item, when the write stored one. */
function receiptFor(action: HandoffActionV1, stage: HandoffStageV1, item: string): { cursor: CommitCursor } | null {
  const progress = action.progress;
  if (stage === 'transfer' && item.startsWith('transfer:')) {
    const [, assignmentText, taskText] = item.split(':');
    const receipt = progress.assignments[Number(assignmentText)]?.transfers[Number(taskText)]?.receipt;
    return receipt === undefined || receipt === null ? null : { cursor: receipt.cursor };
  }
  if (stage === 'routing' && item.startsWith('root:')) {
    const root = progress.routing?.roots.find(entry => entry.requestRoot.queryJobId === item.slice('root:'.length));
    return root?.receipt === undefined || root.receipt === null ? null : { cursor: root.receipt.cursor };
  }
  return null;
}

/**
 * The strict original-event proof shared by the executor's replay and this owner's identity-only replay: the event
 * records this operation and this scope, is an advance, and the receipt was read under this very command identity.
 */
function advanceEventProblem(event: { operationRef: OperationRef; projectId: string; workspaceId: string;
  revision: number }, receipt: CommittedReceipt, identityKey: string, operation: OperationRef,
  scope: { projectId: string; workspaceId: string }): string | null {
  if (event.operationRef.operationId !== operation.operationId || event.operationRef.projectId !== operation.projectId) {
    return 'the original event records another operation';
  }
  if (event.projectId !== scope.projectId || event.workspaceId !== scope.workspaceId) {
    return 'the original event records another scope';
  }
  if (event.revision < 2) return 'the original event is not an advance';
  return receipt.identityKey === identityKey ? null : 'the receipt belongs to another command';
}

/**
 * The stage's own parent field for one item (L8): `true` when the parent record shows the item finished (its round,
 * its created successor, its transfer or routing receipt, the archive registration), `false` while it is free,
 * `null` when the record holds no such item. Only the parent record is read, never the child's own facts.
 */
function refusalItemFinished(action: HandoffActionV1, stage: HandoffStageV1, item: string): boolean | null {
  const progress = action.progress;
  if (stage === 'transfer' || stage === 'routing') return receiptFor(action, stage, item) !== null;
  if (stage === 'understanding') {
    const entry = progress.understanding.find(candidate =>
      candidate.generation === Number(item.slice('understanding:'.length)));
    return entry === undefined ? null : entry.round !== null;
  }
  if (stage === 'successor') {
    const entry = progress.assignments[Number(item.slice('assignment:'.length))];
    return entry === undefined ? null : entry.successor !== null;
  }
  return stage === 'archive' && progress.archiveRequest !== null ? progress.archiveRequest.receipt !== null : null;
}

const OPERATION_PHASES = ['accepted', 'running', 'completed', 'failed', 'unknown'] as const;

/**
 * SES-11's rule at every exit: the source's first open `responsible` Task/Work link whose target the handoff's
 * assignments do not name is unfinished work the archive owner would refuse. The assigned tasks are excluded because
 * moving each of them is this operation's own exit; a link closes through its transfer's receipt, never through this
 * check. Module relations are lookup history and never block.
 */
function residualResponsibilityOf(links: readonly SessionWorkLink[], action: HandoffActionV1): 'task' | 'work' | false {
  const assigned = new Set(action.input.assignments.flatMap(entry => entry.tasks).map(task => canonicalKey(task)));
  return openResponsibleLinkOf(links.filter(link => link.ref.target.kind !== 'task'
    || !assigned.has(canonicalKey(link.ref.target.ref))));
}

/** The one rule that says a handoff names this Session as its successor: a saved successor or an `existing` target. */
export function successorOperationNames(operation: SessionOperationRecord, session: SessionRef): boolean {
  if (operation.action.kind !== 'handoff') return false;
  const key = plainSessionRefKey(session);
  return operation.action.progress.assignments.some(assignment =>
    assignment.successor !== null && plainSessionRefKey(assignment.successor) === key)
    || operation.action.input.assignments.some(assignment =>
      assignment.target.kind === 'existing' && plainSessionRefKey(assignment.target.session) === key);
}

export type SuccessorOperationMatchV1 = { record: SessionOperationRecord; revision: number };

/** The handoff operations naming this Session as their successor, over every phase, with their read revisions. */
export async function successorOperationsOf(
  records: Pick<RecordLookupPort, 'lookup'>, projectId: string, workspaceId: string, session: SessionRef,
): Promise<{ status: 'ready'; value: SuccessorOperationMatchV1[] } | CoreRejection> {
  const matches: SuccessorOperationMatchV1[] = [];
  for (const phase of OPERATION_PHASES) {
    let batch;
    try {
      batch = await lookupAll(records, CORE_OPERATION_BY_WORKSPACE_PHASE_LOOKUP, [projectId, workspaceId, phase]);
    } catch (error) {
      return rejected('unavailable', `the handoff operations could not be read: ${messageOf(error)}`);
    }
    for (const encoded of batch.items) {
      const decoded = decodeSessionOperationRecord(encoded);
      if (decoded.status !== 'decoded') return rejected('unavailable', `an operation is damaged: ${decoded.reason}`);
      if (successorOperationNames(decoded.value, session)) {
        matches.push({ record: decoded.value, revision: encoded.revision });
      }
    }
  }
  return { status: 'ready', value: matches };
}

/** The handoff advance result of one original event; its saved arm and receipt are the event's, never a later record. */
function handoffAdvanceValue(event: HandoffRecordedEvent, commandId: string, plan: {
  stage: HandoffStageV1; item: string; phase: 'before' | 'after'; generation: number;
  next: HandoffStageV1 | null; stop: Stop; refusal?: true;
}): AdvanceResult {
  // The committed event is the one result source; a draft arm never overrides it. A refusal mark carries no arm of
  // its own: the item's saved input stays the before write's and its after id free.
  const savedInput = plan.refusal === true ? null : savedInputFor(event.action, plan.stage, plan.item);
  const receipt = plan.refusal === true ? null : receiptFor(event.action, plan.stage, plan.item);
  return { operation: event.operationRef, revision: event.revision, stage: plan.stage, phase: event.phase,
    generation: plan.generation,
    write: { commandId, stage: plan.stage, item: plan.item, phase: plan.phase, generation: plan.generation,
      savedInput, receipt },
    next: plan.next, stop: plan.stop };
}

function parseCommandId<Stage extends string>(commandId: string, operation: OperationRef, stages: readonly Stage[]):
  { stage: Stage; item: string; phase: 'before' | 'after'; refused: boolean; generation: number } | null {
  const prefix = `${operation.operationId}:`;
  if (!commandId.startsWith(prefix)) return null;
  const parts = commandId.slice(prefix.length).split(':');
  if (parts.length < 4) return null;
  const generation = Number(parts[parts.length - 1]);
  const phase = parts[parts.length - 2];
  const stage = parts[0]!;
  const item = parts.slice(1, parts.length - 2).join(':');
  if (!Number.isSafeInteger(generation) || generation < 1) return null;
  if (phase !== 'before' && phase !== 'after' && phase !== 'refused') return null;
  if (!stages.includes(stage as Stage)) return null;
  // A refusal/partial mark is an after-shaped write whose token guards a generation or a revision instead of using
  // it; the token itself is kept so a replay can tell the two marks apart.
  return { stage: stage as Stage, item, phase: phase === 'refused' ? 'after' : phase, refused: phase === 'refused',
    generation };
}

export function createSessionHandoffAdvanceService(deps: SessionHandoffAdvanceDependencies): SessionHandoffAdvancePort {
  function unavailable(reason: string): CoreRejection { return rejected('unavailable', reason); }

  async function readOperation(ctx: CoreCallContext, ref: OperationRef): Promise<ReadResult<SessionOperationRecordOf<HandoffActionV1>>> {
    const read = await deps.operations.getSessionOperation(ctx, ref);
    if (read.status !== 'ready') return read;
    if (read.value.action.kind !== 'handoff') return rejected('invalid', 'the operation is not a handoff');
    return { status: 'ready', value: read.value as SessionOperationRecordOf<HandoffActionV1> };
  }

  /** The original event of a committed identity, checked against the operation, the scope and the command identity. */
  async function readCommitted(identityKey: string, operation: OperationRef, commandId: string,
    parsed: { stage: HandoffStageV1; item: string; phase: 'before' | 'after'; refused: boolean; generation: number },
    scope: { projectId: string; workspaceId: string }): Promise<HandoffAdvanceResultV1> {
    const found = await lookupCommittedReceiptByIdentity(deps.commitIdentities, identityKey);
    if (found.status === 'missing') return rejected('not_found', 'the write has not been committed');
    if (found.status === 'invalid') return rejected('invalid', found.reason);
    if (found.status !== 'found') return unavailable(found.reason);
    const read = await readCommittedEvent(deps.records, found.receipt, handoffRecordedEvent);
    if (read.status !== 'ready') return unavailable(`the original event could not be recovered: ${read.reason}`);
    const problem = advanceEventProblem(read.value, found.receipt, identityKey, operation, scope);
    if (problem !== null) return unavailable(problem);
    // The token says a mark; the original event says which one: the archive partial keeps its registration receipt
    // and its saved GraphWrite, an L5 refusal projects the item's own arms as free.
    const refusal = parsed.refused && read.value.action.progress.archiveRequest?.receipt == null;
    return { status: 'committed', cursor: found.receipt.cursor, replayed: true,
      // The event's own action fixes the generation: a mark token guards a revision, not the advance generation.
      value: handoffAdvanceValue(read.value, commandId, { ...parsed, generation: read.value.action.progress.advanceGeneration,
        next: null, stop: 'replayed', ...(refusal ? { refusal: true as const } : {}) }) };
  }

  return {
    async advanceHandoff(ctx, rawInput): Promise<HandoffAdvanceResultV1> {
      const trusted = trustedContext(ctx, 'a handoff advance');
      if (!trusted.ok) return trusted.rejection;
      const copy = copiedInput(rawInput, 'handoff advance input');
      if (!copy.ok) return copy.rejection;
      const input = copy.value;
      const given = (isRecord(input) ? input : {}) as Record<string, unknown>;
      if ((given['kind'] !== 'continue' && given['kind'] !== 'replay' && given['kind'] !== 'refusal')
        || !isRecord(given['operation'])) {
        return rejected('invalid', 'the handoff advance requires a continue, replay or refusal input with an operation');
      }
      const operation = input.operation;
      const read = await readOperation(ctx, operation);
      if (read.status === 'not_found') return rejected('not_found', 'the handoff operation is not in this workspace');
      if (read.status === 'not_ready') return unavailable('the handoff operation read is not ready');
      if (read.status !== 'ready') return read;
      const record = read.value;
      const action = record.action;
      const principal = savedHostPrincipal(action.input.actor);
      if (principal === null) return rejected('invalid', 'the operation has no saved Host actor');
      const scope = { projectId: operation.projectId, workspaceId: record.workspaceId };
      const savedCtx = handoffContextOf(ctx, principal);
      const principalValue = principalIdentity(principal);
      const source = action.input.source;

      if (input.kind === 'replay') {
        const parsed = parseCommandId(input.commandId, operation, HANDOFF_STAGES);
        if (parsed === null) return rejected('invalid', 'the replay commandId does not name a handoff write');
        const identityKey = commandIdentity({ operation: 'handoff.advance', scope, principal: principalValue,
          commandId: input.commandId });
        return readCommitted(identityKey, operation, input.commandId, parsed, scope);
      }
      // The refusal arm: the composite records the child's own answer on the item of the before write that named it.
      // The mark's identity is the one recipe's, built from the revision it guards, so a second refusal never
      // collides with the first and a repeat of this same call is the recorded mark. That replay runs before any
      // stage, generation or receipt check — the R2 order — and only a missing mark goes on to the first write's.
      if (input.kind === 'refusal') {
        const refusal = given['refusal'];
        const code = isRecord(refusal) ? refusal['code'] : undefined;
        const reason = isRecord(refusal) ? refusal['reason'] : undefined;
        if (typeof code !== 'string' || typeof reason !== 'string') {
          return rejected('invalid', 'the refusal input carries no code and reason');
        }
        const parsed = parseCommandId(input.commandId, operation, HANDOFF_STAGES);
        if (parsed === null || parsed.phase !== 'before') {
          return rejected('invalid', 'the refusal names no handoff before write');
        }
        const fingerprintInput = { kind: 'refusal',
          basis: `${parsed.stage}:${parsed.item}:${code}` } as unknown as JsonValue;
        const mark = advanceWriteKeys({ principal: principalValue, scope, kind: 'handoff.advance', operation,
          stage: parsed.stage, item: parsed.item, phase: 'refused', generation: input.expectedRevision,
          fingerprintInput });
        // The identity read here is the mark's own token, so its original event projects the refusal's arms.
        const recorded = await readCommitted(mark.keys.identityKey, operation, mark.commandId,
          { ...parsed, phase: 'after', refused: true, generation: input.expectedRevision }, scope);
        if (recorded.status !== 'rejected' || recorded.code !== 'not_found') return recorded;
        // The first write: the before write stored the arm its child is called with, it is this stage's current
        // one, and the stage's own parent field still shows its item unfinished. A filled field or a failed read is
        // `invalid` and writes nothing; the child's own facts are never read here.
        if (parsed.stage !== action.progress.stage || parsed.generation !== action.progress.advanceGeneration
          || refusalItemFinished(action, parsed.stage, parsed.item) !== false
          || (await replayBefore(parsed.stage, parsed.item)).status !== 'committed') {
          return rejected('invalid', 'the refusal names no committed before write of the current stage');
        }
        return commitWrite({ stage: parsed.stage, item: parsed.item, phase: 'after', commandId: mark.commandId,
          generation: action.progress.advanceGeneration, guardRevision: input.expectedRevision, fingerprintInput,
          savedInput: null, receipt: null,
          progress: { ...action.progress, lastRefusal: { stage: parsed.stage, code: code as CoreRejection['code'],
            reason, at: deps.now() } },
          phaseValue: 'running', guards: [], claims: [], next: null, stop: 'refused', refusal: true });
      }
      if (record.revision !== input.expectedRevision) {
        return rejectedWithCurrent('revision_conflict', 'the handoff operation moved', [{ ref: operation, revision: record.revision }]);
      }
      // A step the operation already reached keeps its original input: without it the step cannot be recovered and
      // rebuilding one would replay a command the operation did not make.
      const reached = handoffReachedInputProblem(action);
      if (reached !== null) return rejected('invalid', reached);
      // The source's own role facts decide the secretary steps; its target's shape, the trigger and the saved
      // coverage never are that evidence.
      const sourceCard = await deps.operations.readSession(savedCtx, source);
      if (sourceCard.status !== 'ready') return sourceCard.status === 'rejected' ? sourceCard
        : unavailable('the source Session read is not ready');
      const sourceLinks = sourceCard.value.links;
      const duty = await deps.duty(sourceCard.value.record.role, savedCtx);
      if (duty.status !== 'ready') return duty.status === 'rejected' ? duty : unavailable('the source duty read is not ready');
      const secretary = isSecretaryDuty(duty.value);

      /** One parent write through the shared executor; only the stage's decision and fragment live here. */
      async function commitWrite(draft: {
        stage: HandoffStageV1; item: string; phase: 'before' | 'after'; generation: number;
        /** The stage decision marks the real re-pass first write; only that write raises the generation. */
        raises?: boolean;
        /** The exact identity, when the caller built it with `advanceWriteKeys` (a mark guards a revision). */
        commandId?: string;
        guardRevision?: number;
        fingerprintInput: JsonValue; savedInput: HandoffSavedInputV1 | null;
        receipt: { cursor: CommitCursor } | null; progress: HandoffProgress;
        phaseValue: SessionOperationRecord['phase']; guards: RecordGuard[]; claims: UniqueClaimChange[];
        ledgerHorizon?: CommitCursor | null; next: HandoffStageV1 | null; stop: Stop; refusal?: true;
      }): Promise<HandoffAdvanceResultV1> {
        // One raise per re-pass: the stage decision marks the re-pass's first write, which raises by one and clears
        // the mark; every later write (a receipt, an after write, a replay) reads the raised generation and never
        // computes one. A write that records a new refusal keeps that mark: only the stage decision raises.
        const raise = draft.raises === true;
        const generation = draft.generation + (raise ? 1 : 0);
        const progress = raise
          ? { ...draft.progress, advanceGeneration: generation, lastRefusal: null } : draft.progress;
        const commandId = draft.commandId
          ?? advanceCommandId(operation, draft.stage, draft.item, draft.phase, generation);
        const result = await executeWriteCommand<typeof draft, typeof draft, CoreRejection, HandoffRecordedEvent,
          AdvanceResult>(deps.records, {
          operation: 'handoff.advance', scope, principal: principalValue, commandId,
          fingerprintInput: draft.fingerprintInput,
          read: async () => ({ status: 'ready', facts: draft }),
          decide: facts => ({ decision: facts }),
          build(_facts, keys) {
            const at = deps.now();
            const nextRecord: SessionOperationRecordOf<HandoffActionV1> = { ...record, revision: record.revision + 1,
              updatedAt: at, phase: draft.phaseValue, action: withHandoffProgress(action, progress) };
            const event = sessionHandoffRecordedCodec.encode({ eventId: eventIdOf(keys.identityKey, 'advance'),
              eventType: 'SessionHandoffRecorded', schemaVersion: 1, occurredAt: at, projectId: operation.projectId,
              workspaceId: record.workspaceId, operationRef: operation, revision: nextRecord.revision,
              phase: nextRecord.phase, action: nextRecord.action });
            return { guards: [{ refKey: operationRefKey(operation),
              expectedRevision: draft.guardRevision ?? record.revision }, ...draft.guards],
              records: [encodeSessionOperationRecord(nextRecord)], claims: draft.claims,
              events: [event],
              ...(draft.ledgerHorizon === undefined ? {} : { ledgerHorizon: draft.ledgerHorizon }) };
          },
          result: {
            eventType: handoffRecordedEvent.eventType, schemaVersion: handoffRecordedEvent.schemaVersion,
            decode: handoffRecordedEvent.decode,
            validate: (event, receipt, keys) => advanceEventProblem(event, receipt, keys.identityKey, operation, scope),
            project: (event, _cursor) => handoffAdvanceValue(event, commandId,
              { stage: draft.stage, item: draft.item, phase: draft.phase, generation,
                next: draft.next, stop: draft.stop, ...(draft.refusal === true ? { refusal: true as const } : {}) }),
          },
        });
        return writeAnswer(result);
      }

      async function readCoverageAndBasis(): Promise<{ status: 'ready'; coverage: CoverageFactsV1 } | CoreRejection> {
        for (let attempt = 0; attempt < 4; attempt += 1) {
          const coverage = await deps.coverage.readCoverage(savedCtx, { source });
          if (coverage.status !== 'ready') {
            return coverage.status === 'rejected' ? coverage
              : unavailable('the coverage read is not ready');
          }
          const basis = await deps.basis(source, scope);
          if (basis.status !== 'ready') {
            return basis.status === 'rejected' ? basis : unavailable('the threshold basis read is not ready');
          }
          // Both facts belong to one complete window; a moved watermark discards this attempt entirely.
          if (coverage.value.horizon === basis.value.readThrough) {
            return { status: 'ready', coverage: coverage.value };
          }
        }
        return unavailable('the coverage and the basis did not read one stable window');
      }

      function coverageArm(coverage: CoverageFactsV1): NonNullable<HandoffProgress['coverage']> {
        return { horizon: coverage.horizon, activityRevision: coverage.activityRevision, lastRound: coverage.lastRound,
          goals: coverage.goals.map(goal => ({ goalRef: goal.goalRef, pointer: goal.pointer,
            pointerRevision: goal.pointerRevision })) };
      }

      /** The coverage commit's fact guards: the activity revision and every covered goal's pointer revision. */
      function coverageGuards(coverage: CoverageFactsV1): RecordGuard[] {
        return [
          { refKey: canonicalKey(sessionActivityRefOf(source)),
            expectedRevision: coverage.activityRevision === 0 ? null : coverage.activityRevision },
          ...coverage.goals.map(goal => ({ refKey: currentPointerRefKey(goal.pointer),
            expectedRevision: goal.pointerRevision === 0 ? null : goal.pointerRevision })),
        ];
      }

      /** The L1 stop: no write, so the operation stays at this revision and generation. */
      function stopOf(stop: HandoffAdvanceStopV1['stop'], reason: string): HandoffAdvanceStopV1 {
        return { status: 'stopped', operation, revision: record.revision, stage: action.progress.stage,
          generation: action.progress.advanceGeneration, stop, reason };
      }

      /**
       * The recovery window: the step's before write committed and its child did not. The original write is read back
       * by its own identity and returned as it was; the composite calls the same owner again with that saved arm, and
       * no new write is made (the empty-input after receipt this step never wrote).
       */
      function replayBefore(stage: HandoffStageV1, item: string): Promise<HandoffAdvanceResultV1> | CoreRejection {
        const generation = action.progress.advanceGeneration;
        const saved = savedInputFor(action, stage, item);
        if (saved === null) return rejected('invalid', `the ${stage} step has no saved input to resume`);
        const keys = advanceWriteKeys({ principal: principalValue, scope, kind: 'handoff.advance', operation,
          stage, item, phase: 'before', generation, fingerprintInput: saved as unknown as JsonValue });
        return readCommitted(keys.keys.identityKey, operation, keys.commandId,
          { stage, item, phase: 'before', refused: false, generation }, scope);
      }

      const stage = action.progress.stage;

      /**
       * The stage after the last successor: named tasks move in `transfer`, and with no named task the residual check
       * decides between the routing/archive exit and the transfer stage that records the partial stop. A residual here
       * is the source's work outside the assignments, so it stops before the archive like a residual at the last
       * transfer; the transfer stage's no-unfinished-transfer arm is the one place that writes the stop and, after the
       * person moves the work, the completion.
       */
      function afterSuccessors(assignments: typeof action.progress.assignments): HandoffStageV1 {
        if (assignments.some(entry => entry.transfers.length > 0)) return 'transfer';
        return residualResponsibilityOf(sourceLinks, action) === false
          ? (secretary ? 'routing' : 'archive') : 'transfer';
      }

      /**
       * The partial stop's one mark: a stage-level refusal under the separate refused token, never an item's after
       * token. Its fingerprint names the stage and the residual rule only, so a later drive at the same generation
       * replays it instead of writing the same diagnostic again.
       */
      function residualRefusalMark(stage: 'transfer' | 'routing', progress: typeof action.progress) {
        const basis = `${stage}:-:residual-responsibility`;
        const fingerprintInput = { kind: 'refusal', basis } as unknown as JsonValue;
        const mark = advanceWriteKeys({ principal: principalValue, scope, kind: 'handoff.advance', operation,
          stage, item: '-', phase: 'refused', generation: action.progress.advanceGeneration, fingerprintInput });
        return commitWrite({ stage, item: '-', phase: 'after', generation: action.progress.advanceGeneration,
          commandId: mark.commandId, fingerprintInput, savedInput: null, receipt: null,
          progress: { ...progress, stage, lastRefusal: { stage, code: 'incomplete',
            reason: 'the source still owns work the handoff does not name', at: deps.now() } },
          phaseValue: 'running', guards: [], claims: [], next: null, stop: 'refused', refusal: true });
      }

      // ---- accepted / understanding ---------------------------------------- //
      if (stage === 'accepted' || stage === 'understanding') {
        if (!secretary) {
          // No coverage and no understanding for a non-secretary handoff: take the fence.
          // Fall through to the fence block below by reusing the same decision.
        } else {
          const facts = await readCoverageAndBasis();
          if (facts.status === 'rejected') return facts;
          if (coverageHolds(facts.coverage)) {
            // The fence take carries the coverage basis.
            const fenceRead = await readHandoffFence(deps.records, savedCtx, source);
            if (fenceRead.status !== 'ready') return fenceRead;
            if (fenceRead.value.held && !sameRef(fenceRead.value.operation, operation)) {
              return stopOf('fenced', 'the source fence is held by another handoff');
            }
            const claimKey = secretaryHandoffClaimKey(source);
            const at = deps.now();
            return commitWrite({ stage: 'fence', item: '-', phase: 'after', generation: action.progress.advanceGeneration,
              raises: action.progress.lastRefusal !== null,
              fingerprintInput: { kind: 'fence', basis: 'take' } as unknown as JsonValue,
              savedInput: { kind: 'fence', basis: 'take' }, receipt: null,
              progress: { ...action.progress, stage: 'wait_writer', fence: { claimKey, state: 'held', changedAt: at },
                coverage: coverageArm(facts.coverage) },
              phaseValue: 'running',
              guards: coverageGuards(facts.coverage),
              claims: [{ claimKey, expectedOwner: null, nextOwner: operationRefKey(operation) }],
              ledgerHorizon: facts.coverage.horizon,
              next: 'wait_writer', stop: 'advanced' });
          }
          // Coverage is short: close the previous live command, then save one new trusted command.
          const existing = action.progress.understanding[action.progress.understanding.length - 1];
          if (existing?.command !== null && existing?.command !== undefined && existing.round === null) {
            const receipt = await deps.requests.readRequestCommandReceipt(
              handoffContextOf(savedCtx, HANDOFF_SYSTEM_PRINCIPAL), existing.command);
            if (receipt.status === 'found') {
              const understanding = action.progress.understanding.map(entry =>
                entry.generation === existing.generation && receipt.receipt.kind === 'understanding'
                  ? { ...entry, round: receipt.receipt.round } : entry);
              return commitWrite({ stage: 'understanding', item: `understanding:${existing.generation}`, phase: 'after',
                generation: action.progress.advanceGeneration,
                fingerprintInput: { savedInput: { kind: 'understanding', command: existing.command },
                  receipt: { cursor: receipt.cursor } } as unknown as JsonValue,
                savedInput: { kind: 'understanding', command: existing.command }, receipt: { cursor: receipt.cursor },
                progress: { ...action.progress, understanding }, phaseValue: 'running',
                guards: [], claims: [], next: 'understanding', stop: 'incomplete' });
            }
            if (receipt.status === 'missing') {
              return stopOf('incomplete', 'the understanding command has not committed yet');
            }
            return receipt;
          }
          // A saved round has to end before a later generation may replace it; the composite closes the old
          // command after the real round changed, so this pass writes nothing and waits.
          if (existing?.round !== null && existing?.round !== undefined
            && facts.coverage.lastRound?.queryJobId !== existing.round.queryJobId) {
            return stopOf('incomplete', 'the understanding round has not ended yet');
          }
          const routing = await deps.coverage.readRoutingSet(savedCtx, { source, horizon: facts.coverage.horizon });
          if (routing.status !== 'ready') {
            return routing.status === 'rejected' ? routing : unavailable('the routing set read is not ready');
          }
          const root = routing.value.roots[0];
          if (root === undefined) return rejected('incomplete', 'no unfinished request root can carry an understanding round');
          const generation = action.progress.understanding.length + 1;
          const command: RequestUnderstandingCommandV1 = { kind: 'request_understanding',
            commandId: `${operation.operationId}:understanding:${generation}`, operation, generation,
            requestRoot: root.requestRoot,
            goals: facts.coverage.goals.map(goal => ({ goalRef: goal.goalRef, pointer: goal.pointer,
              pointerRevision: goal.pointerRevision })),
            checkedRound: facts.coverage.lastRound, state: 'live' };
          const understanding = saveUnderstandingCommand(record,
            { generation, requestRoot: root.requestRoot, command }).action.progress;
          const saved: HandoffSavedInputV1 = { kind: 'understanding', command };
          return commitWrite({ stage: 'understanding', item: `understanding:${generation}`, phase: 'before',
            generation: action.progress.advanceGeneration, raises: true,
            fingerprintInput: saved as unknown as JsonValue, savedInput: saved, receipt: null,
            progress: { ...understanding, stage: 'understanding', coverage: coverageArm(facts.coverage) },
            phaseValue: 'running', guards: coverageGuards(facts.coverage), claims: [],
            ledgerHorizon: facts.coverage.horizon, next: 'understanding', stop: 'incomplete' });
        }
      }

      // ---- fence ----------------------------------------------------------- //
      if (stage === 'accepted' && !secretary) {
        const fenceRead = await readHandoffFence(deps.records, savedCtx, source);
        if (fenceRead.status !== 'ready') return fenceRead;
        if (fenceRead.value.held && !sameRef(fenceRead.value.operation, operation)) {
          return stopOf('fenced', 'the source fence is held by another handoff');
        }
        const claimKey = secretaryHandoffClaimKey(source);
        return commitWrite({ stage: 'fence', item: '-', phase: 'after', generation: action.progress.advanceGeneration,
          raises: action.progress.lastRefusal !== null,
          fingerprintInput: { kind: 'fence', basis: 'take' } as unknown as JsonValue,
          savedInput: { kind: 'fence', basis: 'take' }, receipt: null,
          progress: { ...action.progress, stage: 'wait_writer', fence: { claimKey, state: 'held', changedAt: deps.now() } },
          phaseValue: 'running', guards: [],
          claims: [{ claimKey, expectedOwner: null, nextOwner: operationRefKey(operation) }],
          next: 'wait_writer', stop: 'advanced' });
      }

      // ---- wait_writer ------------------------------------------------------ //
      if (stage === 'wait_writer') {
        const latest = await latestEnteredRun(deps, savedCtx, source);
        if (latest.status !== 'ready') return latest;
        const stopped = latest.value === null || !latest.value.active;
        if (!stopped) {
          // A wait observation is not a write: the operation stays where it is, at this generation.
          return stopOf('wait_writer', 'the source writer has not stopped');
        }
        return commitWrite({ stage: 'wait_writer', item: '-', phase: 'after',
          generation: action.progress.advanceGeneration,
          fingerprintInput: { kind: 'wait', basis: `stopped:${latest.value?.ref.runId ?? 'none'}` } as unknown as JsonValue,
          savedInput: { kind: 'wait', basis: `stopped:${latest.value?.ref.runId ?? 'none'}` }, receipt: null,
          progress: { ...action.progress, stage: 'recheck',
            stoppedWriter: { lastExecution: latest.value?.ref ?? null, observedAt: deps.now() } },
          phaseValue: 'running', guards: [], claims: [], next: 'recheck', stop: 'advanced' });
      }

      // ---- recheck ---------------------------------------------------------- //
      if (stage === 'recheck') {
        const facts = secretary ? await readCoverageAndBasis() : null;
        if (facts !== null && facts.status === 'rejected') return facts;
        if (facts !== null && !coverageHolds(facts.coverage)) {
          // The coverage or the basis moved: release the fence in this commit and go back for a new understanding
          // (a non-secretary handoff goes back to its fence). The wait basis is cleared; the next write is the re-pass.
          const claimKey = secretaryHandoffClaimKey(source);
          const back: HandoffStageV1 = secretary ? 'understanding' : 'fence';
          return commitWrite({ stage: 'recheck', item: '-', phase: 'after', generation: action.progress.advanceGeneration,
            fingerprintInput: { kind: 'recheck', basis: 'incomplete' } as unknown as JsonValue,
            savedInput: { kind: 'recheck', basis: 'incomplete' }, receipt: null,
            progress: { ...action.progress, stage: back, stoppedWriter: null,
              fence: action.progress.fence === null ? null
                : { ...action.progress.fence, state: 'released', changedAt: deps.now() },
              lastRefusal: { stage: 'recheck', code: 'incomplete', reason: 'the coverage moved before the successor',
                at: deps.now() } },
            phaseValue: 'running',
            guards: [], claims: action.progress.fence === null ? [] : [{ claimKey,
              expectedOwner: operationRefKey(operation), nextOwner: null }],
            next: back, stop: 'incomplete' });
        }
        const brief = facts === null ? null
          : await deps.coverage.readBriefGoalRefs(savedCtx, { source, goals: facts.coverage.goals });
        if (brief !== null && brief.status !== 'ready') return brief;
        return commitWrite({ stage: 'recheck', item: '-', phase: 'after', generation: action.progress.advanceGeneration,
          fingerprintInput: { kind: 'recheck', basis: 'passed' } as unknown as JsonValue,
          savedInput: { kind: 'recheck', basis: 'passed' }, receipt: null,
          progress: facts === null || brief === null ? { ...action.progress, stage: 'successor' }
            : { ...action.progress, stage: 'successor', coverage: coverageArm(facts.coverage),
              brief: { requests: [], goals: brief.value, ready: false, consumedBy: null } },
          phaseValue: 'running', guards: facts === null ? [] : coverageGuards(facts.coverage), claims: [],
          ...(facts === null ? {} : { ledgerHorizon: facts.coverage.horizon }),
          next: 'successor', stop: 'advanced' });
      }

      // ---- successor -------------------------------------------------------- //
      if (stage === 'successor') {
        for (const [index, assignment] of action.progress.assignments.entries()) {
          if (assignment.successor !== null) continue;
          const target = action.input.assignments[index]!.target;
          if (target.kind === 'existing') {
            const card = await deps.operations.readSession(savedCtx, target.session);
            if (card.status !== 'ready') return card.status === 'rejected' ? card
              : unavailable('the existing successor Session read is not ready');
            const assignments = action.progress.assignments.map((entry, position) => position === index
              ? { ...entry, successor: target.session, createOperation: null } : entry);
            const allSuccessors = assignments.every(entry => entry.successor !== null);
            const next = allSuccessors ? afterSuccessors(assignments) : 'successor';
            return commitWrite({ stage: 'successor', item: `assignment:${index}`, phase: 'after',
              generation: action.progress.advanceGeneration,
              fingerprintInput: { savedInput: null, receipt: null } as unknown as JsonValue,
              savedInput: null, receipt: null,
              progress: { ...action.progress, stage: next, assignments }, phaseValue: 'running',
              guards: [{ refKey: plainSessionRefKey(target.session), expectedRevision: card.value.record.revision }],
              claims: [], next, stop: next === 'successor' ? 'advanced' : 'advanced' });
          }
          const saved = assignment.createInput;
          if (saved === null) {
            // The source card this call already read carries the role and the revision its guard pins.
            const input: HandoffSavedCreateInputV1 = {
              commandId: `${operation.operationId}:create:${index}`,
              duty: target.duty, scope: { kind: 'project' }, reason: 'handoff',
              provenance: { schemaVersion: 1, kind: 'handoff', from: source },
              roleConfiguration: sourceCard.value.record.role,
              replaces: source, parentOperation: operation,
            };
            const stable = stableSessionCreationIdentity(principal.actor, operation.projectId, input.commandId);
            const arm: HandoffSavedInputV1 = { kind: 'create', requestId: input.commandId, input };
            return commitWrite({ stage: 'successor', item: `assignment:${index}`, phase: 'before',
              generation: action.progress.advanceGeneration,
              fingerprintInput: arm as unknown as JsonValue, savedInput: arm, receipt: null,
              progress: saveHandoffCreateInput(record, index, input).action.progress, phaseValue: 'running',
              guards: [
                { refKey: plainSessionRefKey(source), expectedRevision: sourceCard.value.record.revision },
                { refKey: operationRefKey(stable.operationRef), expectedRevision: null },
                { refKey: plainSessionRefKey(stable.plannedSessionRef), expectedRevision: null },
              ],
              claims: [], next: 'successor', stop: 'advanced' });
          }
          const stable = stableSessionCreationIdentity(principal.actor, operation.projectId, saved.commandId);
          const createRead = await deps.operations.getSessionOperation(savedCtx, stable.operationRef);
          if (createRead.status === 'not_found') {
            // The create child has not committed: the saved before write is returned for the composite to resume.
            return replayBefore('successor', `assignment:${index}`);
          }
          if (createRead.status !== 'ready') {
            return createRead.status === 'rejected' ? createRead : unavailable('the create operation read is not ready');
          }
          const created = createRead.value;
          if (created.action.kind !== 'create') return rejected('invalid', 'the create child is not a Session creation');
          if (created.phase !== 'completed' || created.revision < 2) {
            const assignments = action.progress.assignments.map((entry, position) => position === index
              ? { ...entry, createOperation: stable.operationRef } : entry);
            return commitWrite({ stage: 'successor', item: '-', phase: 'after',
              generation: action.progress.advanceGeneration,
              fingerprintInput: { kind: 'create-pending', basis: stable.operationRef.operationId } as unknown as JsonValue,
              savedInput: null, receipt: null,
              progress: { ...action.progress, assignments, lastRefusal: { stage: 'successor', code: 'incomplete',
                reason: 'the create child is still accepted', at: deps.now() } },
              phaseValue: 'running', guards: [], claims: [], next: 'successor', stop: 'refused' });
          }
          if (created.action.creation === null || created.action.creation.duty !== saved.duty
            || canonicalOf(created.action.provenance) !== canonicalOf(saved.provenance)
            || canonicalOf(created.action.role) !== canonicalOf(saved.roleConfiguration)
            || canonicalOf(created.action.parentOperation) !== canonicalOf(saved.parentOperation)) {
            return rejected('invalid', 'the stored create input disagrees with the saved create input');
          }
          const card = await deps.operations.readSession(savedCtx, stable.plannedSessionRef);
          if (card.status !== 'ready') return card.status === 'rejected' ? card
            : unavailable('the successor Session read is not ready');
          const assignments = action.progress.assignments.map((entry, position) => position === index
            ? { ...entry, successor: stable.plannedSessionRef, createOperation: stable.operationRef } : entry);
          const allSuccessors = assignments.every(entry => entry.successor !== null);
          const next = allSuccessors ? afterSuccessors(assignments) : 'successor';
          return commitWrite({ stage: 'successor', item: `assignment:${index}`, phase: 'after',
            generation: action.progress.advanceGeneration,
            fingerprintInput: { savedInput: { kind: 'create', requestId: saved.commandId, input: saved },
              receipt: null } as unknown as JsonValue,
            savedInput: { kind: 'create', requestId: saved.commandId, input: saved }, receipt: null,
            progress: { ...action.progress, stage: next, assignments }, phaseValue: 'running',
            guards: [
              { refKey: operationRefKey(stable.operationRef), expectedRevision: created.revision },
              { refKey: plainSessionRefKey(stable.plannedSessionRef), expectedRevision: card.value.record.revision },
            ],
            claims: [], next, stop: 'advanced' });
        }
        return rejected('invalid', 'the successor stage has no unfinished assignment');
      }

      // ---- transfer --------------------------------------------------------- //
      if (stage === 'transfer') {
        const successor = action.progress.assignments.find(entry => entry.successor !== null)?.successor ?? null;
        if (successor === null) return rejected('invalid', 'the transfer stage has no successor');
        for (const [index, assignment] of action.progress.assignments.entries()) {
          if (assignment.successor === null) continue;
          for (const [taskIndex, transfer] of assignment.transfers.entries()) {
            if (transfer.receipt !== null) continue;
            if (transfer.input === null) {
              const toCard = await deps.operations.readSession(savedCtx, assignment.successor);
              if (toCard.status !== 'ready') return toCard.status === 'rejected' ? toCard
                : unavailable('the transfer destination Session read is not ready');
              const target = { kind: 'task' as const, ref: transfer.task };
              const linkRefs = [responsibleLinkRef(source, target),
                responsibleLinkRef(assignment.successor, target)];
              const linkKeys = linkRefs.map(ref => canonicalKey(ref));
              let links;
              try {
                links = await deps.records.readMany(linkKeys);
              } catch (error) {
                return unavailable(`the transfer link pins could not be read: ${messageOf(error)}`);
              }
              if (links.status !== 'ready') return storeFailureToRejection(links);
              const revisionOf = (key: string): number => {
                const found = links.value.records.find(entry => entry.refKey === key);
                return found === undefined ? 0 : found.revision;
              };
              const expected = { fromSession: sourceCard.value.record.revision,
                toSession: toCard.value.record.revision, sourceLink: revisionOf(linkKeys[0]!),
                destinationLink: revisionOf(linkKeys[1]!) };
              const requestId = `${operation.operationId}:transfer:${index}:${taskIndex}`;
              const arm: HandoffSavedInputV1 = { kind: 'transfer', requestId, from: source, to: assignment.successor,
                target, expected };
              const transfers = assignment.transfers.map((entry, position) => position === taskIndex
                ? { ...entry, input: { requestId, from: source, to: assignment.successor!, expected } } : entry);
              const assignments = action.progress.assignments.map((entry, position) => position === index
                ? { ...entry, transfers } : entry);
              return commitWrite({ stage: 'transfer', item: `transfer:${index}:${taskIndex}`, phase: 'before',
                generation: action.progress.advanceGeneration,
                fingerprintInput: arm as unknown as JsonValue, savedInput: arm, receipt: null,
                progress: { ...action.progress, assignments }, phaseValue: 'running',
                guards: [
                  { refKey: plainSessionRefKey(source), expectedRevision: expected.fromSession },
                  { refKey: plainSessionRefKey(assignment.successor), expectedRevision: expected.toSession },
                  { refKey: linkKeys[0]!, expectedRevision: expected.sourceLink === 0 ? null : expected.sourceLink },
                  { refKey: linkKeys[1]!, expectedRevision: expected.destinationLink === 0 ? null : expected.destinationLink },
                ], claims: [], next: 'transfer', stop: 'advanced' });
            }
            const saved: SavedTransferInputV1 = { requestId: transfer.input.requestId, from: transfer.input.from,
              to: transfer.input.to, target: { kind: 'task', ref: transfer.task }, expected: transfer.input.expected };
            const read = await deps.transfers.readTransferReceipt(savedCtx, saved);
            if (read.status === 'rejected' && read.code === 'not_found') {
              // The transfer child has not committed: the saved before write is returned for the composite to resume.
              return replayBefore('transfer', `transfer:${index}:${taskIndex}`);
            }
            if (read.status !== 'committed') return read;
            const transfers = assignment.transfers.map((entry, position) => position === taskIndex
              ? { ...entry, receipt: { cursor: read.cursor } } : entry);
            const assignments = action.progress.assignments.map((entry, position) => position === index
              ? { ...entry, transfers } : entry);
            const allTransferred = assignments.every(entry => entry.transfers.every(item => item.receipt !== null));
            // With every named transfer committed, a residual stops before the stage's own exit; the transfer stage's
            // no-unfinished-transfer arm records that stop in this same drive and, after the repair, the completion.
            const residual = allTransferred ? residualResponsibilityOf(sourceLinks, action) : false;
            const next: HandoffStageV1 = allTransferred && residual === false
              ? (secretary ? 'routing' : 'archive') : 'transfer';
            const arm: HandoffSavedInputV1 = { kind: 'transfer', ...saved };
            return commitWrite({ stage: 'transfer', item: `transfer:${index}:${taskIndex}`, phase: 'after',
              generation: action.progress.advanceGeneration,
              fingerprintInput: { savedInput: arm, receipt: { cursor: read.cursor } } as unknown as JsonValue,
              savedInput: arm, receipt: { cursor: read.cursor },
              progress: { ...action.progress, stage: next, assignments }, phaseValue: 'running',
              guards: [], claims: [], next, stop: 'advanced' });
          }
        }
        // The dead end only means every named transfer committed: the residual check is the completion decision.
        if (residualResponsibilityOf(sourceLinks, action) !== false) {
          return residualRefusalMark('transfer', action.progress);
        }
        const next: HandoffStageV1 = secretary ? 'routing' : 'archive';
        return commitWrite({ stage: 'transfer', item: '-', phase: 'after', generation: action.progress.advanceGeneration,
          fingerprintInput: { kind: 'transfer', basis: 'residual-clear' } as unknown as JsonValue,
          savedInput: null, receipt: null,
          progress: { ...action.progress, stage: next, lastRefusal: null }, phaseValue: 'running',
          guards: [], claims: [], next, stop: 'advanced' });
      }

      /**
       * The first before write of a routing root: it stores the route the root is walked with, arms the step and, on a
       * re-pass, raises the generation once. The ordinary pass and the late-input reopen share this arm; each caller
       * keeps its own root choice and the horizon its scan read.
       */
      function routingBefore(pendingRoot: { requestRoot: QueryJobRef },
        roots: NonNullable<HandoffProgress['routing']>['roots'], horizon: CommitCursor | null, raises: boolean) {
        const input = { operationId: operation.operationId, to: successorOf(action) ?? source,
          expectedSource: source };
        const arm: HandoffSavedInputV1 = { kind: 'route', ...input };
        const nextRoots = roots.map(root => root.requestRoot.queryJobId === pendingRoot.requestRoot.queryJobId
          ? { ...root, input } : root);
        return commitWrite({ stage: 'routing', item: `root:${pendingRoot.requestRoot.queryJobId}`, phase: 'before',
          generation: action.progress.advanceGeneration, raises,
          fingerprintInput: arm as unknown as JsonValue, savedInput: arm, receipt: null,
          progress: { ...action.progress, stage: 'routing',
            routing: { closed: false, horizon, roots: nextRoots } },
          phaseValue: 'running', guards: [], claims: [], next: 'routing', stop: 'advanced' });
      }

      // ---- routing ---------------------------------------------------------- //
      if (stage === 'routing') {
        if (action.progress.routing?.closed === true) {
          return commitWrite({ stage: 'archive', item: '-', phase: 'after', generation: action.progress.advanceGeneration,
            fingerprintInput: { kind: 'archive', basis: 'routing-closed' } as unknown as JsonValue,
            savedInput: null, receipt: null, progress: { ...action.progress, stage: 'archive' },
            phaseValue: 'running', guards: [], claims: [], next: 'archive', stop: 'advanced' });
        }
        const scan = await deps.coverage.readRoutingSet(savedCtx,
          { source, horizon: action.progress.routing?.horizon ?? null });
        if (scan.status !== 'ready') return scan.status === 'rejected' ? scan
          : unavailable('the routing set read is not ready');
        const existing = new Map<string, NonNullable<HandoffProgress['routing']>['roots'][number]>();
        for (const root of action.progress.routing?.roots ?? []) existing.set(canonicalKey(root.requestRoot), root);
        for (const root of scan.value.roots) {
          const key = canonicalKey(root.requestRoot);
          if (existing.has(key)) continue;
          existing.set(key, { requestRoot: root.requestRoot, input: null, receipt: null, skipped: null });
        }
        const ownedKeys = new Set(scan.value.roots.map(root => canonicalKey(root.requestRoot)));
        const roots = [...existing.values()];
        const unfinished = roots.filter(root => root.receipt === null && root.skipped === null);
        // A saved input may already have committed even though the request moved: read its receipt first.
        // A root new to this scan carries no input, receipt or skip, so it is always unfinished and therefore
        // `pending`; every arm below returns, so the close is only reached with every root already routed.
        const pending = unfinished.find(root => root.input !== null) ?? unfinished[0];
        if (pending !== undefined) {
          const ownedNow = ownedKeys.has(canonicalKey(pending.requestRoot));
          if (pending.input === null) {
            if (!ownedNow) {
              const nextRoots = roots.map(root => root.requestRoot.queryJobId === pending.requestRoot.queryJobId
                ? { ...root, skipped: 'owner_changed' as const } : root);
              return commitWrite({ stage: 'routing', item: `root:${pending.requestRoot.queryJobId}`, phase: 'after',
                generation: action.progress.advanceGeneration,
                fingerprintInput: { kind: 'skip', basis: `routing:${pending.requestRoot.queryJobId}:owner_changed` } as unknown as JsonValue,
                savedInput: null, receipt: null,
                progress: { ...action.progress, routing: { closed: false,
                  horizon: action.progress.routing?.horizon ?? scan.value.horizon, roots: nextRoots } },
                phaseValue: 'running', guards: [], claims: [], next: 'routing', stop: 'advanced' });
            }
            return routingBefore(pending, roots, action.progress.routing?.horizon ?? scan.value.horizon, false);
          }
          const command = { kind: 'handoff' as const, operationId: pending.input.operationId,
            requestRoot: pending.requestRoot, to: pending.input.to, expectedSource: pending.input.expectedSource };
          const receipt = await deps.requests.readRequestCommandReceipt(
            handoffContextOf(savedCtx, HANDOFF_SYSTEM_PRINCIPAL), command);
          if (receipt.status === 'found' && receipt.receipt.kind === 'route') {
            const routed = receipt.receipt;
            const nextRoots = roots.map(root => root.requestRoot.queryJobId === pending.requestRoot.queryJobId
              ? { ...root, receipt: { routingRound: routed.routingRound, cursor: receipt.cursor } } : root);
            const arm: HandoffSavedInputV1 = { kind: 'route', operationId: pending.input.operationId,
              to: pending.input.to, expectedSource: pending.input.expectedSource };
            return commitWrite({ stage: 'routing', item: `root:${pending.requestRoot.queryJobId}`, phase: 'after',
              generation: action.progress.advanceGeneration,
              fingerprintInput: { savedInput: arm, receipt: { cursor: receipt.cursor } } as unknown as JsonValue,
              savedInput: arm, receipt: { cursor: receipt.cursor },
              progress: { ...action.progress, routing: { closed: false,
                horizon: action.progress.routing?.horizon ?? scan.value.horizon, roots: nextRoots } },
              phaseValue: 'running', guards: [], claims: [], next: 'routing', stop: 'advanced' });
          }
          if (receipt.status === 'missing') {
            if (!ownedNow) {
              const nextRoots = roots.map(root => root.requestRoot.queryJobId === pending.requestRoot.queryJobId
                ? { ...root, skipped: 'owner_changed' as const } : root);
              return commitWrite({ stage: 'routing', item: `root:${pending.requestRoot.queryJobId}`, phase: 'after',
                generation: action.progress.advanceGeneration,
                fingerprintInput: { kind: 'skip', basis: `routing:${pending.requestRoot.queryJobId}:owner_changed` } as unknown as JsonValue,
                savedInput: null, receipt: null,
                progress: { ...action.progress, routing: { closed: false,
                  horizon: action.progress.routing?.horizon ?? scan.value.horizon, roots: nextRoots } },
                phaseValue: 'running', guards: [], claims: [], next: 'routing', stop: 'advanced' });
            }
            // The routing child has not committed: the saved before write is returned for the composite to resume.
            return replayBefore('routing', `root:${pending.requestRoot.queryJobId}`);
          }
          return receipt.status === 'rejected' ? receipt : unavailable('the routing receipt read is not ready');
        }
        const horizon = scan.value.horizon;
        // The routing close is the last exit toward the archive. A responsibility added after the transfer exits (a
        // public link or transfer) stops the close here; the mark's fingerprint carries no horizon, so a later scan
        // replays it and the after token stays free for the one close after the repair.
        if (residualResponsibilityOf(sourceLinks, action) !== false) {
          return residualRefusalMark('routing', { ...action.progress,
            routing: { closed: false, horizon: action.progress.routing?.horizon ?? horizon, roots } });
        }
        return commitWrite({ stage: 'routing', item: '-', phase: 'after', generation: action.progress.advanceGeneration,
          fingerprintInput: { kind: 'routing', basis: `closed:${horizon ?? 'null'}` } as unknown as JsonValue,
          savedInput: null, receipt: null,
          progress: { ...action.progress, stage: 'archive', routing: { closed: true, horizon, roots } },
          phaseValue: 'running', guards: [], claims: [], ledgerHorizon: horizon, next: 'archive', stop: 'advanced' });
      }

      // ---- archive ---------------------------------------------------------- //
      if (stage === 'archive') {
        const saved = action.progress.archiveRequest?.savedInput ?? null;
        if (saved === null) {
          const card = await deps.operations.readSession(savedCtx, source);
          if (card.status !== 'ready') return card.status === 'rejected' ? card
            : unavailable('the archive source Session read is not ready');
          const request = archiveRequestOf(source, operation, card.value.record.revision);
          // Another pending archive request — an operator `sessions/archive-line` request, or maintenance's
          // `retired`/`handoff_complete` one — holds the Session: freezing now would pin a revision it moves. Nothing
          // is written and the arm waits until that request finishes or is released; a later pass freezes the fresh pin.
          const pending = card.value.record.archiveRequest ?? null;
          if (pending !== null) {
            return stopOf('incomplete', 'another pending archive request holds the Session; this archive waits until that request finishes or is released');
          }
          const progress = saveArchiveSavedInput(record, request.meta.requestId, request).action.progress;
          const arm: HandoffSavedInputV1 = { kind: 'archive', request };
          return commitWrite({ stage: 'archive', item: '-', phase: 'before',
            generation: action.progress.advanceGeneration,
            fingerprintInput: arm as unknown as JsonValue, savedInput: arm, receipt: null,
            progress, phaseValue: 'running', guards: [], claims: [], next: 'archive', stop: 'advanced' });
        }
        const state = await readArchiveState(deps, savedCtx, source, saved);
        if (state.status !== 'ready') {
          // The archive child has not committed: the saved before write is returned for the composite to resume.
          return state.status === 'rejected' && state.code === 'not_found' ? replayBefore('archive', '-') : state;
        }
        const { pair } = state;
        const arm: HandoffSavedInputV1 = { kind: 'archive', request: saved };
        if (!state.archived) {
          // With the partial mark already recorded, a processing root the source still owns after the routing set
          // closed is a late input: reopen routing through its first changed input and raise the generation once.
          // The saved GraphWrite and the registration receipt stay for the replay after the new set closes.
          if (action.progress.archiveRequest?.receipt != null) {
            const scan = await deps.coverage.readRoutingSet(savedCtx, { source, horizon: null });
            if (scan.status !== 'ready') {
              return scan.status === 'rejected' ? scan : unavailable('the routing set read is not ready');
            }
            const known = new Set((action.progress.routing?.roots ?? [])
              .map(root => canonicalKey(root.requestRoot)));
            const lateRoots = scan.value.roots.filter(root => !known.has(canonicalKey(root.requestRoot)));
            const late = lateRoots[0];
            if (late !== undefined) {
              const roots = [...(action.progress.routing?.roots ?? []), ...lateRoots.map(root =>
                ({ requestRoot: root.requestRoot, input: null, receipt: null, skipped: null }))];
              return routingBefore(late, roots, scan.value.horizon, true);
            }
          }
          // A pending/partial child is neither success nor a failure: this parent write records the real partial
          // mark and keeps the exact saved GraphWrite, and the composite stops this drive. The registration
          // receipt stays the child's; it never becomes this write's receipt or the final archive's success.
          const progress = saveArchiveReceipt(record, pair).action.progress;
          const partial = { kind: 'archive-partial', basis: pair.identityKey } as unknown as JsonValue;
          return commitWrite({ stage: 'archive', item: '-', phase: 'after',
            generation: action.progress.advanceGeneration,
            commandId: advanceWriteKeys({ principal: principalValue, scope, kind: 'handoff.advance', operation,
              stage: 'archive', item: '-', phase: 'refused', generation: action.progress.advanceGeneration,
              fingerprintInput: partial }).commandId,
            fingerprintInput: partial,
            savedInput: arm, receipt: null,
            progress: { ...progress, lastRefusal: { stage: 'archive', code: 'incomplete',
              reason: 'the archive child is still partial', at: deps.now() } },
            phaseValue: 'running', guards: [], claims: [], next: 'archive', stop: 'refused' });
        }
        const progress = saveArchiveReceipt(record, pair).action.progress;
        return commitWrite({ stage: 'archive', item: '-', phase: 'after',
          generation: action.progress.advanceGeneration,
          fingerprintInput: { savedInput: arm,
            receipt: { cursor: state.cursor } } as unknown as JsonValue,
          savedInput: arm, receipt: { cursor: state.cursor },
          progress: { ...progress, stage: 'notice',
            // The guarded archive committed and the routing set closed: the successor's brief is now ready. The
            // advance never consumes it; D's entered confirmation does. The stored versions stay the ones the
            // predecessor wrote at the recheck, never a pointer a later write names.
            brief: { requests: (action.progress.routing?.roots ?? []).map(root => ({ requestRoot: root.requestRoot,
              lastAnswer: null })),
              goals: action.progress.brief?.goals ?? [],
              ready: briefReady({ archiveCommitted: true, routing: action.progress.routing }),
              consumedBy: action.progress.brief?.consumedBy ?? null } },
          phaseValue: 'running', guards: [], claims: [], next: 'notice', stop: 'advanced' });
      }

      // ---- notice ----------------------------------------------------------- //
      if (stage === 'notice') {
        const key = `handoff:${operation.operationId}`;
        return commitWrite({ stage: 'notice', item: '-', phase: 'after', generation: action.progress.advanceGeneration,
          fingerprintInput: { kind: 'notice', basis: key } as unknown as JsonValue,
          savedInput: { kind: 'notice', basis: key }, receipt: null,
          progress: { ...action.progress, stage: 'finished', noticeItemKey: key },
          phaseValue: 'running', guards: [], claims: [], next: 'finished', stop: 'advanced' });
      }

      // ---- finished --------------------------------------------------------- //
      if (stage === 'finished') {
        const claimKey = secretaryHandoffClaimKey(source);
        return commitWrite({ stage: 'finished', item: '-', phase: 'after', generation: action.progress.advanceGeneration,
          fingerprintInput: { kind: 'finish', basis: 'released' } as unknown as JsonValue,
          savedInput: { kind: 'finish', basis: 'released' }, receipt: null,
          progress: { ...action.progress, stage: 'finished',
            fence: action.progress.fence === null ? null
              : { ...action.progress.fence, state: 'released', changedAt: deps.now() } },
          phaseValue: 'completed',
          guards: [], claims: action.progress.fence === null ? []
            : [{ claimKey, expectedOwner: operationRefKey(operation), nextOwner: null }],
          next: null, stop: 'finished' });
      }

      return rejected('invalid', `the handoff stage ${String(stage)} has no advance step`);
    },
  };
}

export function successorOf(action: HandoffActionV1): SessionRef | null {
  return action.progress.assignments.find(assignment => assignment.successor !== null)?.successor ?? null;
}

/**
 * The source's writer state for the wait: a Session holding a QueryRun execution is not stopped (entered or unknown);
 * an idle Session with no QueryRun execution has stopped. The read uses only the public Session card, so `sessions`
 * keeps no edge to `queries`.
 */
async function latestEnteredRun(deps: Pick<SessionHandoffAdvanceDependencies, 'operations'>,
  ctx: CoreCallContext, source: SessionRef):
  Promise<{ status: 'ready'; value: { ref: QueryRunRef; active: boolean } | null } | CoreRejection> {
  const card = await deps.operations.readSession(ctx, source);
  if (card.status !== 'ready') {
    return card.status === 'rejected' ? card : rejected('unavailable', 'the source Session read is not ready');
  }
  const record = card.value.record;
  const occupancy = record.occupancy;
  if (occupancy !== null && occupancy !== undefined && occupancy.kind === 'execution'
    && occupancy.executionRef.aggregateType === 'QueryRun') {
    return { status: 'ready', value: { ref: occupancy.executionRef, active: true } };
  }
  const last = record.lastExecutionRef;
  if (last === null || last === undefined || last.aggregateType !== 'QueryRun') {
    return { status: 'ready', value: null };
  }
  return { status: 'ready', value: { ref: last, active: false } };
}

// -------------------------------------------------------------------------- //
// The secretary archive: accept and the per-call advance                     //
// -------------------------------------------------------------------------- //

/** The archive acceptance facts the owner reads after the shape and caller checks. */
type ArchiveAcceptFacts = {
  source: OperationSessionFactV1; sourceRevision: number | null; unfinished: VersionPin[];
};

/**
 * The saved archive request is the exact `GraphWrite` the owner replays; its condition member is the owner's.
 */
export type ArchiveWriteInputV1 = RequestSessionArchiveInput & { condition?: SessionArchiveConditionV1 | null };

/** The one archive request both arms save before the owner call; the exact `GraphWrite` is replayed later. */
function archiveRequestOf(source: SessionRef, operation: OperationRef, revision: number):
  GraphWrite<ArchiveWriteInputV1> {
  return {
    input: { sessionRef: source, reason: 'secretary_handoff', tasks: [], wait: null,
      confirmUnknownStopped: false, mode: 'secretary_handoff', condition: { kind: 'secretary_handoff', operation } },
    meta: { requestId: `${operation.operationId}:archive:${source.sessionId}`,
      expected: [{ ref: { ...source, aggregateType: 'Session' as const }, revision }] },
  };
}

type ArchiveStateRead = { status: 'ready'; pair: { identityKey: string; fingerprint: string };
  cursor: CommitCursor; archived: boolean } | CoreRejection;

/** The registration and final-archive read both arms run after the saved request exists. */
async function readArchiveState(
  deps: { archive: Pick<SessionLifecyclePort, 'readSessionArchiveRequestReceipt'>;
    operations: Pick<SessionDirectoryPort, 'readSession'> },
  ctx: CoreCallContext, source: SessionRef, saved: GraphWrite<ArchiveWriteInputV1>): Promise<ArchiveStateRead> {
  const archiveCtx = archiveContextOf(ctx);
  const registration = await deps.archive.readSessionArchiveRequestReceipt(archiveCtx, saved);
  if (registration.status === 'not_found'
    || (registration.status === 'rejected' && registration.code === 'not_found')) {
    return rejected('not_found', 'the archive request was not registered');
  }
  if (registration.status === 'not_ready') return rejected('unavailable', 'the archive registration read is not ready');
  if (registration.status !== 'ready') return registration;
  const pair = registration.value.session.archiveRequest?.receipt;
  if (pair === undefined || pair === null) {
    return rejected('invalid', 'the archive registration carries no request receipt');
  }
  const final = await deps.operations.readSession(archiveCtx, source);
  if (final.status !== 'ready') return final.status === 'rejected' ? final
    : rejected('unavailable', 'the final archive Session read is not ready');
  return { status: 'ready', pair, cursor: registration.value.cursor,
    archived: final.value.record.lifecycle === 'archived' && final.value.record.archiveRequest === null };
}

export type SecretaryArchiveAdvanceDependencies = {
  records: GoalRecordTransactionPort & RecordLookupPort;
  commitIdentities: Pick<RecordCommitIdentityPort, 'readCommitByIdentity'>;
  operations: Pick<SessionDirectoryPort, 'getSessionOperation' | 'readSession'>;
  /** D's internal request receipt read, and the one request fact an item's recovery reads. */
  requests: Pick<HandoffRequestReceiptReadPort, 'readRequestCommandReceipt'> & HandoffRequestFactsReadPort;
  archive: Pick<SessionLifecyclePort, 'readSessionArchiveRequestReceipt'>;
  checkArchiveCondition: SecretaryHandoffFactsPort['checkArchiveCondition'];
  /** The duty read the accept needs to know the source is a secretary. */
  duty: SessionDutyReadPort;
  now(): string;
};

export type SessionSecretaryArchivePort = {
  acceptArchive(ctx: CoreCallContext, input: SecretaryArchiveAcceptInputV1): Promise<SecretaryArchiveAcceptResultV1>;
  advanceArchive(ctx: CoreCallContext, input: SecretaryArchiveAdvanceInputV1): Promise<SecretaryArchiveAdvanceResultV1>;
};

const ARCHIVE_ACCEPT = 'secretaryArchive.accept';
const ARCHIVE_ADVANCE = 'secretaryArchive.advance';

function archiveOperationId(keys: Keys): string {
  return `secretary-archive-${keys.identityKey.slice(ARCHIVE_ACCEPT.length + 1)}`;
}

type ArchiveProgress = SecretaryArchiveActionV1['progress'];
type ArchiveAdvanceValue = SecretaryArchiveAdvanceResultV1 extends WriteResult<infer V> ? V : never;
type ArchiveRecordedEvent = Extract<ReturnType<typeof secretaryArchiveRecordedCodec.decode>, { status: 'decoded' }>['value'];
const archiveAdvanceEvent = { eventType: 'SecretaryArchiveRecorded', schemaVersion: 1,
  decode: (event: EncodedDomainEvent) => secretaryArchiveRecordedCodec.decode(event) };

/** The item view of one archive write, read from the event's own action; every call site projects that same event. */
function archiveItemView(event: ArchiveRecordedEvent, item: string): ArchiveAdvanceValue['item'] {
  const rootId = item.startsWith('choice:') ? item.slice('choice:'.length) : null;
  const entry = rootId === null ? undefined
    : event.action.progress.items.find(candidate => candidate.requestRoot.queryJobId === rootId);
  // An operation-level write belongs to no single choice: it shows the operation's first choice, so a new commit and
  // a replay project one event one way.
  const shown = entry ?? event.action.progress.items[0]!;
  return { requestRoot: shown.requestRoot, commandId: '', savedInput: shown.input,
    receipt: shown.routingRound === null || shown.cursor === null ? null
      : { routingRound: shown.routingRound, cursor: shown.cursor } };
}

type ArchiveActionInput = Omit<SecretaryArchiveActionV1['input'], 'actor'> & {
  actor: { kind: 'human' | 'system'; id: string };
};

export function createSecretaryArchiveService(deps: SecretaryArchiveAdvanceDependencies): SessionSecretaryArchivePort {
  function unavailable(reason: string): CoreRejection { return rejected('unavailable', reason); }

  async function readAcceptFacts(ctx: CoreCallContext, input: SecretaryArchiveAcceptInputV1,
    workspace: WorkspaceScope): Promise<{ status: 'ready'; facts: ArchiveAcceptFacts } | CoreRejection> {
    const source = await sessionFactOf({ sessions: deps.operations, duty: deps.duty }, ctx, input.source);
    if (source.status !== 'ready') return source;
    const unfinished = await unfinishedPinsOf(deps.records, workspace, input.source);
    if (unfinished.status !== 'ready') return unfinished;
    return { status: 'ready', facts: { source: source.fact, sourceRevision: source.revision,
      unfinished: unfinished.value } };
  }

  return {
    async acceptArchive(ctx, rawInput) {
      const trusted = trustedContext(ctx, 'a secretary archive');
      if (!trusted.ok) return trusted.rejection;
      const copy = copiedInput(rawInput, 'archive input');
      if (!copy.ok) return copy.rejection;
      const input = copy.value;
      const given: Partial<SecretaryArchiveAcceptInputV1> = isRecord(input) ? input : {};
      const actor = { kind: trusted.actor.kind, id: trusted.actor.id };
      const actionOf = (fingerprint: string): ArchiveActionInput => ({ source: given.source!,
        choices: given.choices!, actor, commandId: given.commandId!, fingerprint });
      let candidate: unknown;
      try {
        candidate = newSecretaryArchiveOperationRecord({ ref: null, workspaceId: trusted.scope.workspaceId,
          at: '', input: actionOf('0'.repeat(64)) }).action;
      } catch {
        candidate = { kind: 'secretary_archive', input: actionOf('0'.repeat(64)), progress: null };
      }
      const early: SecretaryArchiveAdmissionFactsV1 = {
        caller: trusted.actor.kind === 'human' ? 'host_human' : 'host_system',
        inScope: true,
        shapeProblem: checkShape(SecretaryArchiveActionShape, candidate, 'stored'),
        read: null,
      };
      const precheck = admitSecretaryArchive(early);
      if (!precheck.ok) return admissionRejection(precheck);

      const result = await executeWriteCommand<ArchiveAcceptFacts, ArchiveAcceptFacts, CoreRejection,
        Extract<ReturnType<typeof secretaryArchiveRecordedCodec.decode>, { status: 'decoded' }>['value'],
        { operation: OperationRef; stage: 'accepted'; phase: 'accepted' }>(deps.records, {
        operation: ARCHIVE_ACCEPT,
        scope: { projectId: trusted.scope.projectId, workspaceId: trusted.scope.workspaceId },
        principal: principalIdentity(ctx.principal),
        commandId: input.commandId,
        fingerprintInput: { source: input.source, choices: input.choices } as unknown as JsonValue,
        read: () => readAcceptFacts(ctx, input, trusted.scope),
        decide(facts) {
          const admitted = admitSecretaryArchive({ ...early,
            read: { source: facts.source, unfinished: facts.unfinished } });
          return admitted.ok ? { decision: facts } : { refuse: admissionRejection(admitted) };
        },
        build(facts, keys) {
          const ref: OperationRef = { aggregateType: 'CoreOperation', projectId: trusted.scope.projectId,
            operationId: archiveOperationId(keys) };
          const at = deps.now();
          const record: SessionOperationRecordOf<SecretaryArchiveActionV1> = newSecretaryArchiveOperationRecord({
            ref, workspaceId: trusted.scope.workspaceId, at, input: actionOf(keys.fingerprint) });
          return {
            guards: [{ refKey: operationRefKey(ref), expectedRevision: null },
              { refKey: plainSessionRefKey(input.source), expectedRevision: facts.sourceRevision }],
            records: [encodeSessionOperationRecord(record)],
            claims: [],
            events: [secretaryArchiveRecordedCodec.encode({ eventId: eventIdOf(keys.identityKey, 'accepted'),
              eventType: 'SecretaryArchiveRecorded', schemaVersion: 1, occurredAt: at, projectId: ref.projectId,
              workspaceId: record.workspaceId, operationRef: ref, revision: record.revision, phase: record.phase,
              action: record.action })],
          };
        },
        result: {
          eventType: 'SecretaryArchiveRecorded',
          schemaVersion: 1,
          decode: event => secretaryArchiveRecordedCodec.decode(event),
          validate(event, _receipt, keys) {
            if (event.operationRef.operationId !== archiveOperationId(keys)) return 'the event records another operation';
            if (event.revision !== 1) return 'the event is not the first revision';
            return event.phase === 'accepted' && event.action.progress.stage === 'accepted' ? null
              : 'the event is not an accepted archive';
          },
          project: event => ({ operation: event.operationRef, stage: 'accepted', phase: 'accepted' }),
        },
      });
      return writeAnswer(result);
    },

    async advanceArchive(ctx, rawInput): Promise<SecretaryArchiveAdvanceResultV1> {
      const trusted = trustedContext(ctx, 'a secretary archive advance');
      if (!trusted.ok) return trusted.rejection;
      const copy = copiedInput(rawInput, 'archive advance input');
      if (!copy.ok) return copy.rejection;
      const input = copy.value;
      const given = (isRecord(input) ? input : {}) as Record<string, unknown>;
      if ((given['kind'] !== 'continue' && given['kind'] !== 'replay') || !isRecord(given['operation'])) {
        return rejected('invalid', 'the archive advance requires a continue or replay input with an operation');
      }
      const operation = input.operation;
      const read = await deps.operations.getSessionOperation(ctx, operation);
      if (read.status === 'not_found') return rejected('not_found', 'the archive operation is not in this workspace');
      if (read.status === 'not_ready') return unavailable('the archive operation read is not ready');
      if (read.status !== 'ready') return read;
      if (read.value.action.kind !== 'secretary_archive') return rejected('invalid', 'the operation is not a secretary archive');
      const record = read.value as SessionOperationRecordOf<SecretaryArchiveActionV1>;
      const action = record.action;
      const principal = savedHostPrincipal(action.input.actor);
      if (principal === null) return rejected('invalid', 'the archive operation has no saved Host actor');
      const scope = { projectId: operation.projectId, workspaceId: record.workspaceId };
      const savedCtx = handoffContextOf(ctx, principal);
      const principalValue = principalIdentity(principal);
      const source = action.input.source;

      if (input.kind === 'replay') {
        const parsed = parseCommandId(input.commandId, operation, SECRETARY_ARCHIVE_STAGES);
        if (parsed === null) return rejected('invalid', 'the replay commandId does not name an archive write');
        const identityKey = commandIdentity({ operation: ARCHIVE_ADVANCE, scope, principal: principalValue,
          commandId: input.commandId });
        return readArchiveCommitted(identityKey, operation, scope, input.commandId, parsed);
      }
      if (record.revision !== input.expectedRevision) {
        return rejectedWithCurrent('revision_conflict', 'the archive operation moved',
          [{ ref: operation, revision: record.revision }]);
      }
      const reached = archiveSavedInputProblem('SecretaryArchiveAction', action.progress.archiveRequest);
      if (reached !== null) return rejected('invalid', reached);

      /** One archive parent write through the shared executor; only the stage's decision and fragment live here. */
      async function commitWrite(draft: {
        stage: SecretaryArchiveStageV1; item: string; phase: 'before' | 'after'; generation: number;
        fingerprintInput: JsonValue; progress: ArchiveProgress; phaseValue: SessionOperationRecord['phase'];
        guards: RecordGuard[]; claims: UniqueClaimChange[]; next: SecretaryArchiveStageV1 | null;
        stop: ArchiveAdvanceValue['stop'];
        /** A partial mark guards a generation under the refused token, so the item's after identity stays free. */
        token?: { phase: 'before' | 'after' | 'refused'; generation: number };
      }): Promise<SecretaryArchiveAdvanceResultV1> {
        const commandId = advanceCommandId(operation, draft.stage, draft.item,
          draft.token?.phase ?? draft.phase, draft.token?.generation ?? draft.generation);
        const result = await executeWriteCommand<typeof draft, typeof draft, CoreRejection, ArchiveRecordedEvent,
          ArchiveAdvanceValue>(deps.records, {
          operation: ARCHIVE_ADVANCE, scope, principal: principalValue, commandId,
          fingerprintInput: draft.fingerprintInput,
          read: async () => ({ status: 'ready', facts: draft }),
          decide: facts => ({ decision: facts }),
          build(_facts, keys) {
            const at = deps.now();
            const nextRecord: SessionOperationRecordOf<SecretaryArchiveActionV1> = { ...record,
              revision: record.revision + 1, updatedAt: at, phase: draft.phaseValue,
              action: withHandoffProgress(action, draft.progress) };
            const event = secretaryArchiveRecordedCodec.encode({ eventId: eventIdOf(keys.identityKey, 'advance'),
              eventType: 'SecretaryArchiveRecorded', schemaVersion: 1, occurredAt: at, projectId: operation.projectId,
              workspaceId: record.workspaceId, operationRef: operation, revision: nextRecord.revision,
              phase: nextRecord.phase, action: nextRecord.action });
            return { guards: [{ refKey: operationRefKey(operation), expectedRevision: record.revision },
              ...draft.guards], records: [encodeSessionOperationRecord(nextRecord)], claims: draft.claims,
              events: [event] };
          },
          result: {
            eventType: archiveAdvanceEvent.eventType, schemaVersion: archiveAdvanceEvent.schemaVersion,
            decode: archiveAdvanceEvent.decode,
            validate: (event, receipt, keys) => advanceEventProblem(event, receipt, keys.identityKey, operation, scope),
            project: (event, _cursor) => ({ operation: event.operationRef, revision: event.revision,
              stage: draft.stage, phase: event.phase, generation: draft.generation,
              item: { ...archiveItemView(event, draft.item), commandId }, stop: draft.stop }),
          },
        });
        return writeAnswer(result);
      }

      const stage = action.progress.stage;

      /** One item's recorded outcome and its own after write; the stage follows the choices still without one. */
      function itemWritten(index: number, entry: Partial<ArchiveProgress['items'][number]>, item: string,
        fingerprintInput: JsonValue): Promise<SecretaryArchiveAdvanceResultV1> {
        const items = action.progress.items.map((each, position) => position === index ? { ...each, ...entry } : each);
        const nextStage = items.every(each => each.outcome !== null) ? 'archive' : 'items';
        return commitWrite({ stage: 'items', item, phase: 'after', generation: action.progress.advanceGeneration,
          fingerprintInput, progress: { ...action.progress, stage: nextStage, items }, phaseValue: 'running',
          guards: [], claims: [], next: nextStage, stop: 'advanced' });
      }

      // ---- accepted / items -------------------------------------------------- //
      if (stage === 'accepted' || stage === 'items') {
        const next = action.progress.items.find(item => item.outcome === null);
        if (next === undefined) {
          return commitWrite({ stage: 'items', item: '-', phase: 'after',
            generation: action.progress.advanceGeneration,
            fingerprintInput: { kind: 'items', basis: 'closed' } as unknown as JsonValue,
            progress: { ...action.progress, stage: 'archive' }, phaseValue: 'running',
            guards: [], claims: [], next: 'archive', stop: 'advanced' });
        }
        const itemIndex = action.progress.items.indexOf(next);
        if (next.input === null) {
          const choice = action.input.choices[itemIndex]!;
          const savedInput = { operationId: operation.operationId, to: choice.to, expectedSource: source };
          const items = action.progress.items.map((entry, position) => position === itemIndex
            ? { ...entry, input: savedInput } : entry);
          return commitWrite({ stage: 'items', item: `choice:${next.requestRoot.queryJobId}`, phase: 'before',
            generation: action.progress.advanceGeneration,
            fingerprintInput: savedInput as unknown as JsonValue,
            progress: { ...action.progress, stage: 'items', items }, phaseValue: 'running',
            guards: [], claims: [], next: 'items', stop: 'advanced' });
        }
        const command = { kind: 'archived' as const, operationId: next.input.operationId,
          requestRoot: next.requestRoot, to: next.input.to, expectedSource: next.input.expectedSource };
        const receipt = await deps.requests.readRequestCommandReceipt(
          handoffContextOf(savedCtx, HANDOFF_SYSTEM_PRINCIPAL), command);
        if (receipt.status === 'found') {
          const routingRound = receipt.receipt.kind === 'route' ? receipt.receipt.routingRound : null;
          if (routingRound === null) return rejected('invalid', 'the archive receipt is not a route round');
          return itemWritten(itemIndex,
            { outcome: next.input.to === null ? 'dropped' : 'routed', routingRound, cursor: receipt.cursor },
            `choice:${next.requestRoot.queryJobId}`,
            { savedInput: next.input, receipt: { cursor: receipt.cursor } } as unknown as JsonValue);
        }
        if (receipt.status === 'missing') {
          // The child did not commit: only now judge whether this request can still be archived. A moved, closed or
          // unknown request fails its own item and the remaining choices continue; it is never routed again.
          const facts = await deps.requests.readRequest(savedCtx, { requestRoot: next.requestRoot });
          if (facts.status === 'rejected') return facts;
          const owned = facts.status === 'ready' && facts.value.processing
            && facts.value.owner !== null && sameRef(facts.value.owner, source);
          if (!owned) {
            return itemWritten(itemIndex, { outcome: 'failed', reason: 'owner_changed' },
              `choice:${next.requestRoot.queryJobId}`,
              { kind: 'refusal',
                basis: `archive:${next.requestRoot.queryJobId}:owner_changed` } as unknown as JsonValue);
          }
          return commitWrite({ stage: 'items', item: '-', phase: 'after',
            generation: action.progress.advanceGeneration,
            fingerprintInput: { kind: 'refusal', basis: `archive:${next.requestRoot.queryJobId}:not_committed` } as unknown as JsonValue,
            progress: { ...action.progress, lastRefusal: { stage: 'items', code: 'incomplete',
              reason: 'the archive routing child has not committed', at: deps.now() } },
            phaseValue: 'running', guards: [], claims: [], next: 'items', stop: 'refused' });
        }
        return receipt.status === 'rejected' ? receipt : unavailable('the archive routing receipt read is not ready');
      }

      // ---- archive ----------------------------------------------------------- //
      if (stage === 'archive') {
        const saved = action.progress.archiveRequest?.savedInput ?? null;
        if (saved === null) {
          const card = await deps.operations.readSession(savedCtx, source);
          if (card.status !== 'ready') return card.status === 'rejected' ? card
            : unavailable('the archive source Session read is not ready');
          const checked = await deps.checkArchiveCondition(savedCtx, {
            condition: { kind: 'secretary_handoff', operation }, session: source });
          if (checked.status !== 'ready') return checked.status === 'rejected' ? checked
            : unavailable('the archive condition read is not ready');
          if (!checked.value.ok) return commitWrite({ stage: 'archive', item: '-', phase: 'after',
            generation: action.progress.advanceGeneration,
            fingerprintInput: { kind: 'refusal', basis: 'archive:-:condition' } as unknown as JsonValue,
            progress: { ...action.progress, lastRefusal: { stage: 'archive', code: 'incomplete',
              reason: checked.value.reason, at: deps.now() } },
            phaseValue: 'running', guards: [], claims: [], next: null, stop: 'refused' });
          const request = archiveRequestOf(source, operation, card.value.record.revision);
          const progress = saveArchiveSavedInput(record, request.meta.requestId, request).action.progress;
          return commitWrite({ stage: 'archive', item: '-', phase: 'before',
            generation: action.progress.advanceGeneration,
            fingerprintInput: request as unknown as JsonValue, progress,
            phaseValue: 'running', guards: [], claims: [], next: 'archive', stop: 'advanced' });
        }
        const state = await readArchiveState(deps, savedCtx, source, saved);
        if (state.status !== 'ready') {
          if (state.code !== 'not_found') return state;
          // The saved request is resumed by its own before identity, never re-marked: the item's after identity
          // stays free for the partial or final write once the owner registers it.
          const generation = action.progress.advanceGeneration;
          const keys = advanceWriteKeys({ principal: principalValue, scope, kind: 'secretaryArchive.advance',
            operation, stage: 'archive', item: '-', phase: 'before', generation,
            fingerprintInput: saved as unknown as JsonValue });
          return readArchiveCommitted(keys.keys.identityKey, operation, scope, keys.commandId,
            { stage: 'archive', item: '-', phase: 'before', generation });
        }
        const { pair } = state;
        if (!state.archived) {
          // A pending/partial child is neither success nor a failure: this parent write records the real partial
          // mark and keeps the exact saved GraphWrite; the composite stops this drive and resumes it later. The
          // registration receipt stays the child's, never this write's receipt or the final archive's success.
          const progress = saveArchiveReceipt(record, pair).action.progress;
          return commitWrite({ stage: 'archive', item: '-', phase: 'after',
            generation: action.progress.advanceGeneration,
            token: { phase: 'refused', generation: action.progress.advanceGeneration },
            fingerprintInput: { kind: 'archive-partial', basis: pair.identityKey } as unknown as JsonValue,
            progress: { ...progress, lastRefusal: { stage: 'archive', code: 'incomplete',
              reason: 'the archive child is still partial', at: deps.now() } },
            phaseValue: 'running', guards: [], claims: [], next: 'archive', stop: 'refused' });
        }
        const progress = saveArchiveReceipt(record, pair).action.progress;
        return commitWrite({ stage: 'finished', item: '-', phase: 'after',
          generation: action.progress.advanceGeneration,
          fingerprintInput: { kind: 'finish', basis: `archived:${pair.identityKey}` } as unknown as JsonValue,
          progress: { ...progress, stage: 'finished' },
          phaseValue: 'completed', guards: [], claims: [], next: null, stop: 'finished' });
      }

      return rejected('invalid', `the archive stage ${String(stage)} has no advance step`);
    },
  };

  async function readArchiveCommitted(identityKey: string, operation: OperationRef,
    scope: { projectId: string; workspaceId: string }, commandId: string,
    parsed: { stage: SecretaryArchiveStageV1; item: string; phase: 'before' | 'after'; generation: number }):
    Promise<SecretaryArchiveAdvanceResultV1> {
    const found = await lookupCommittedReceiptByIdentity(deps.commitIdentities, identityKey);
    if (found.status === 'missing') return rejected('not_found', 'the write has not been committed');
    if (found.status === 'invalid') return rejected('invalid', found.reason);
    if (found.status !== 'found') return unavailable(found.reason);
    const read = await readCommittedEvent(deps.records, found.receipt, archiveAdvanceEvent);
    if (read.status !== 'ready') return unavailable(`the original event could not be recovered: ${read.reason}`);
    const problem = advanceEventProblem(read.value, found.receipt, identityKey, operation, scope);
    if (problem !== null) return unavailable(problem);
    return { status: 'committed', cursor: found.receipt.cursor, replayed: true,
      value: { operation: read.value.operationRef, revision: read.value.revision, stage: parsed.stage,
        phase: read.value.phase, generation: read.value.action.progress.advanceGeneration,
        item: { ...archiveItemView(read.value, parsed.item), commandId }, stop: 'replayed' } };
  }
}


