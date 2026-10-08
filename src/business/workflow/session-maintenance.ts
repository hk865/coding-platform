/**
 * Slice 1 §4.2: the Workflow's bounded one-page Session maintenance step.
 *
 * Maintenance starts nothing: at most one page per call, no timer, no Kernel
 * start, no check and no model call. Every archive is the same composed
 * `archiveLine` action; the due decision only reads durable facts.
 */
import type { CoreCallContext } from '../../contracts/core/call-context.js';
import type { SessionRef, VersionPin, WorkLinkTarget, WorkspaceScope } from '../../contracts/core/identity.js';
import type { CoreRejection, ReadResult } from '../../contracts/core/results.js';
import type { SessionRecord, SessionWorkLink } from '../../contracts/core/session.js';
import type { RequestSessionArchiveInput } from '../../contracts/core/session-archive.js';
import type { SessionMessageRef } from '../../contracts/core/session-message.js';
import type { PlatformDutyV1 } from '../../contracts/platform-duty.js';
import { SESSION_ARCHIVE_AUTOMATION_ACTOR } from '../../contracts/task-requeue.js';
import { canonicalJson, type JsonValue } from '../../contracts/fingerprint.js';
import type { SessionMessage } from '../../core/work-graph/model/communication-contracts.js';
import type { SessionFactsV1 } from '../../core/work-graph/model/session-facts-contracts.js';
import type { GraphWrite } from '../../core/work-graph/model/session-contracts.js';
import { executorArchiveDue } from '../../core/work-graph/state/session-availability.js';
import { sessionResponsibilityChangedEventFromEvent } from '../../core/work-graph/sessions/lifecycle-record-codecs.js';
import type { WorkflowDependencies } from './ports.js';
import type { WorkflowCloseEventReader } from './contracts.js';
import type { ArchiveLineResultV1, SessionArchivePort } from './session-archive.js';

export type SessionMaintenanceInput = { workspace: WorkspaceScope; after: string | null };

export type SessionMaintenanceResultV1 = {
  processed: number; nextCursor: string | null;
  archived: SessionRef[]; pending: SessionRef[];
  failures: { sessionRef: SessionRef; rejection: CoreRejection }[];
};

export interface SessionMaintenancePort {
  maintainSessions(
    ctx: CoreCallContext,
    input: SessionMaintenanceInput,
  ): Promise<ReadResult<SessionMaintenanceResultV1>>;
}

/** The exact event reader used for the terminal close `finishedAt` when wired. */
type CloseEventReader = WorkflowCloseEventReader;

/**
 * §4.1 S:765 / E8: the internal composition entry that accepts a trusted mode.
 * It is optional so an older archive composition stays type-compatible; without
 * it maintenance reports `unsupported` for a Session instead of calling the
 * public entry (which now refuses a present mode).
 */
type InternalArchiveLine = (
  ctx: CoreCallContext,
  request: GraphWrite<RequestSessionArchiveInput>,
) => Promise<ReadResult<ArchiveLineResultV1>>;

type ArchiveWithInternal = SessionArchivePort & { archiveLineInternal?: InternalArchiveLine };

export type SessionMaintenanceDependencies = Pick<WorkflowDependencies,
  | 'sessionLifecycle'
  | 'sessionFacts'
  | 'responsibilities'
  | 'sessionAnomalies'
  | 'archivePolicy'
  | 'sessionDuty'
  // R1 (L-g, S:597): every new time maintenance supplies comes from the clock.
  | 'now'
  // E2 (§4.2 S:827): the trusted terminal Task-time basis for an old close event.
  | 'responsibilityBasis'
  // E14 (§2.2 S:190, S:628): the legacy-provenance reader the directory also uses.
  | 'legacyProvenance'> & {
    sessions?: WorkflowDependencies['sessions'];
    plans?: WorkflowDependencies['plans'];
    claims?: WorkflowDependencies['claims'];
    executions?: WorkflowDependencies['executions'];
    archive?: SessionArchivePort;
    /**
     * §4.2: the trusted close-event reader that derives an executor's
     * `finishedAt` from the terminal responsibility close. Absent (or a failed
     * read) is `incomplete`, never a fallback to the last `Run.endedAt`.
     */
    records?: CloseEventReader;
  };

const PAGE_LIMIT_MAX = 100;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
function nonEmpty(value: unknown): value is string {
  return typeof value === 'string' && value.length > 0;
}
function reject(code: CoreRejection['code'], reason: string): CoreRejection {
  return { status: 'rejected', code, reason };
}
function canonical(value: unknown): string | null {
  try { return canonicalJson(value as JsonValue); } catch { return null; }
}
function contextForActor(ctx: CoreCallContext, actor: { kind: 'human' | 'system'; id: string }): CoreCallContext {
  const workspaceId = ctx.workspaceId;
  return {
    projectId: ctx.projectId,
    ...(workspaceId === undefined ? {} : { workspaceId }),
    principal: { kind: 'host', actor: { ...actor } },
    materialReader: {
      kind: 'host', projectId: ctx.projectId,
      ...(workspaceId === undefined ? {} : { workspaceId }), actor: { ...actor },
    },
    signal: ctx.signal,
  };
}
function openResponsibleLinks(record: SessionRecord, links: readonly SessionWorkLink[]): SessionWorkLink[] {
  return links.filter((link) => link.ref.relation === 'responsible' && link.until === null);
}
/**
 * §3.4 S:618 / §3.2 refusal table: the current caller is validated before any
 * durable authority is adopted. Only the trusted Host may run maintenance; an
 * Agent (`work_run`/`query_run`) caller is `forbidden` / `archive_host_only:`.
 */
function callerProblem(ctx: CoreCallContext): CoreRejection | null {
  const principal = (ctx as unknown as { principal?: unknown }).principal;
  if (!isRecord(principal) || principal['kind'] !== 'host') {
    return reject('forbidden', 'archive_host_only: only the trusted Host may run Session maintenance');
  }
  const actor = principal['actor'];
  if (!isRecord(actor) || (actor['kind'] !== 'human' && actor['kind'] !== 'system') || !nonEmpty(actor['id'])) {
    return reject('forbidden', 'archive_host_only: the maintenance caller needs a trusted Host actor');
  }
  return null;
}

export function createSessionMaintenanceService(
  deps: SessionMaintenanceDependencies,
): SessionMaintenancePort {
  /** §4.2: the per-workspace page continuation; reset on the last page. */
  const cursors = new Map<string, string | null>();

  /** The optional mailbox used to confirm an answered copy's attachment/acceptance. */
  function mailboxRead():
  ((ctx: CoreCallContext, ref: SessionMessageRef) => Promise<ReadResult<SessionMessage>>) | undefined {
    const local = deps as unknown as {
      messages?: { readMessage?: (ctx: CoreCallContext, ref: SessionMessageRef) => Promise<ReadResult<SessionMessage>> };
      consultations?: {
        messages?: { readMessage?: (ctx: CoreCallContext, ref: SessionMessageRef) => Promise<ReadResult<SessionMessage>> };
      };
    };
    return local.messages?.readMessage ?? local.consultations?.messages?.readMessage;
  }

  function internalArchive(): InternalArchiveLine | undefined {
    return (deps.archive as ArchiveWithInternal | undefined)?.archiveLineInternal;
  }

  /**
   * E2 (§4.2 S:827): the executor due clock is the terminal close event's
   * `taskBasis.finishedAt`, never the last `Run.endedAt`. An old close event
   * without that proof is recovered through the trusted responsibility-basis
   * reader (`satisfied` → `reducedAt`; cancelled/superseded → the first
   * terminal Plan's `acceptedAt`). EVERY closed terminal link must be proven;
   * any unprovable one leaves the Session unarchived and `incomplete`.
   */
  async function recoverFinishedAtFromBasis(
    ctx: CoreCallContext, sessionRef: SessionRef, target: WorkLinkTarget,
  ): Promise<{ terminal: boolean; finishedAt: string | null } | null> {
    if (deps.responsibilityBasis === undefined) return null;
    try {
      const basis = await deps.responsibilityBasis.readResponsibilityBasis(ctx, { sessionRef, target });
      if (basis.status !== 'ready') return null;
      return { terminal: basis.value.terminal, finishedAt: basis.value.finishedAt };
    } catch {
      return null;
    }
  }

  async function finishedAtProof(
    ctx: CoreCallContext, sessionRef: SessionRef, links: readonly SessionWorkLink[],
  ): Promise<{ value: string | null; incomplete: string | null }> {
    const closed = links.filter((link) => link.ref.relation === 'responsible' && link.until !== null);
    if (closed.length === 0) return { value: null, incomplete: null };
    let latest: string | null = null;
    for (const link of closed) {
      // First read the close event itself: its `taskBasis.finishedAt` is the
      // primary proof. A non-terminal close (transfer/drop) is not a due fact.
      let event: { terminal: boolean; finishedAt: string | null } | null = null;
      if (deps.records !== undefined) {
        const at = await deps.records.eventAt(link.until!);
        if (at.status === 'ready') {
          const decoded = sessionResponsibilityChangedEventFromEvent(at.value.event);
          if (decoded.status === 'decoded') {
            event = decoded.value.mode !== 'terminal'
              ? { terminal: false, finishedAt: null }
              : { terminal: true, finishedAt: decoded.value.taskBasis.finishedAt };
          }
        }
      }
      if (event !== null && !event.terminal) continue;
      if (event !== null && event.finishedAt !== null) {
        if (latest === null || event.finishedAt > latest) latest = event.finishedAt;
        continue;
      }
      // The event is an old terminal close without the proof, or unreadable:
      // recover from the trusted Task/Plan basis. EVERY terminal time must be
      // provable, so a failure here is `incomplete`, never a guess.
      const basis = await recoverFinishedAtFromBasis(ctx, sessionRef, link.ref.target);
      if (basis === null) {
        return { value: null, incomplete: 'the terminal close finishedAt cannot be proven for this Session' };
      }
      if (!basis.terminal) {
        // An unreadable event plus a currently non-terminal Task is not a due
        // fact; a decoded terminal event contradicts the basis → unprovable.
        if (event === null) continue;
        return { value: null, incomplete: 'the terminal close finishedAt cannot be proven for this Session' };
      }
      if (basis.finishedAt === null) {
        return { value: null, incomplete: 'the terminal close finishedAt cannot be proven for this Session' };
      }
      if (latest === null || basis.finishedAt > latest) latest = basis.finishedAt;
    }
    return { value: latest, incomplete: null };
  }

  /**
   * §4.1 step 6 / §4.2 (E12): close the responsibilities whose Task is
   * formally terminal before the due decision, through the real
   * `closeTerminalResponsibility` owner. Each close is one commit; the
   * Session is re-read so a later archive uses the fresh revision.
   */
  async function closeTerminalResponsibilities(
    ctx: CoreCallContext, sessionRef: SessionRef, record: SessionRecord, links: readonly SessionWorkLink[],
  ): Promise<{ record: SessionRecord; links: readonly SessionWorkLink[] }> {
    if (deps.responsibilities === undefined || deps.plans === undefined) return { record, links };
    let currentRecord = record;
    let currentLinks = links;
    let changed = false;
    const refresh = async (): Promise<void> => {
      if (deps.sessions === undefined) return;
      const card = await deps.sessions.readSession(ctx, sessionRef);
      if (card.status !== 'ready') return;
      currentRecord = card.value.record;
      currentLinks = card.value.links;
    };
    const open = openResponsibleLinks(record, links);
    for (const link of open) {
      const target = link.ref.target;
      if (target.kind !== 'task') continue;
      const goalRef = { aggregateType: 'Goal' as const, projectId: target.ref.projectId, goalId: target.ref.goalId };
      const graph = await deps.plans.queryTaskGraph(ctx, { goalRef });
      if (graph.status !== 'ready') continue;
      const row = graph.value.tasks.find((candidate) => candidate.ref.taskId === target.ref.taskId);
      if (row === undefined) continue;
      const terminal = row.effectivePhase === 'satisfied'
        || row.definition.disposition === 'cancelled' || row.definition.disposition === 'superseded';
      if (!terminal) continue;
      // E12: the pins are the FRESH record/link after every earlier close in
      // this same call; a stale revision would refuse every later terminal link.
      const targetKey = canonical(target);
      const fresh = currentLinks.find((candidate) => candidate.ref.relation === 'responsible'
        && (targetKey !== null && canonical(candidate.ref.target) === targetKey));
      if (fresh !== undefined && fresh.until !== null) continue;
      try {
        const closed = await deps.responsibilities.closeTerminalResponsibility(ctx, {
          input: { sessionRef, target },
          meta: {
            // N2: the identity names the Goal and the exact link occurrence
            // (`since`) so different Goals / reopened links never collide.
            requestId: `s1-maintenance-terminal:${sessionRef.projectId}:${sessionRef.sessionId}:${target.ref.goalId}:${target.ref.taskId}:${fresh?.since ?? link.since}`,
            expected: [
              { ref: currentRecord.ref, revision: currentRecord.revision },
              { ref: fresh?.ref ?? link.ref, revision: fresh?.revision ?? link.revision },
            ],
          },
        });
        if (closed.status === 'committed' || closed.code === 'revision_conflict') {
          changed = true;
          // Re-read so the next close in this call uses the fresh revision and
          // the following due decision sees the links just closed.
          await refresh();
        }
        // Any other refusal leaves the link open; the due decision then keeps
        // treating it as an unfinished responsibility.
      } catch { /* a failed close never blocks another Session */ }
    }
    if (!changed || deps.sessions === undefined) return { record: currentRecord, links: currentLinks };
    await refresh();
    return { record: currentRecord, links: currentLinks };
  }

  /**
   * §4.2 S:829 / S1-AUTO-03 (E13): all three copy facts are needed — the formal
   * answer is saved, attached to the original message, and the input acceptance
   * is confirmed. The mailbox is the trusted reader for the attachment and the
   * acceptance; when it is not wired (a narrow double) the copy is NOT archived
   * and the caller reports `unsupported`. The three facts are enforced on every
   * path: an inquiry's response must be the copy's own answered QueryRun, and an
   * ordinary input's acceptance entry must name that answered QueryRun.
   */
  async function copyAnswerState(
    ctx: CoreCallContext, sessionRef: SessionRef, record: SessionRecord,
  ): Promise<{ kind: 'answered' } | { kind: 'not_answered' } | { kind: 'not_confirmed' } | { kind: 'unsupported'; reason: string }> {
    if (deps.sessionFacts === undefined) {
      return { kind: 'unsupported', reason: 'the Session facts reader is not installed' };
    }
    const found = await deps.sessionFacts.listSessionQueries(ctx, { sessionRef, page: { limit: PAGE_LIMIT_MAX } });
    if (found.status !== 'ready') {
      return { kind: 'unsupported', reason: 'the answered copy cannot read its Query history' };
    }
    const answered = found.value.items.filter((query) => query.run.outcome === 'answered');
    if (answered.length === 0) return { kind: 'not_answered' };
    const reader = mailboxRead();
    if (reader === undefined) {
      return { kind: 'unsupported', reason: 'the mailbox reader is not installed, so the copy answer cannot be confirmed' };
    }
    const provenance = record.provenance;
    if (provenance === null || provenance === undefined || provenance.kind !== 'readonly_copy') {
      return { kind: 'unsupported', reason: 'the copy provenance is not readable' };
    }
    const read = await reader(ctx, provenance.messageRef);
    if (read.status !== 'ready') {
      return { kind: 'unsupported', reason: 'the original message of the copy is not readable' };
    }
    const message = read.value;
    const asksReply = message.intent === 'inquiry' || message.needsReply === true || message.replyMode === 'wait';
    if (asksReply) {
      // Attachment: the formal answer is associated with the original message.
      const sender = message.response?.sender;
      if (sender === undefined || sender.kind !== 'query_run') return { kind: 'not_confirmed' };
      // Acceptance: the response is this copy's own answered QueryRun, not merely
      // "a response exists" (spec §4.2 S:829).
      return answered.some((query) => canonical(sender.queryRunRef) === canonical(query.ref))
        ? { kind: 'answered' } : { kind: 'not_confirmed' };
    }
    // Ordinary input: the acceptance entry names this copy's answered QueryRun,
    // which is also the attachment of the answer to the original message.
    const accepted = (message.acceptedInputs ?? []).some((entry) => entry.part === 'message'
      && answered.some((query) => canonical(entry.executionRef) === canonical(query.ref)));
    return accepted ? { kind: 'answered' } : { kind: 'not_confirmed' };
  }

  /**
   * E14 (§2.2 S:190 / §3.4 S:628): resolve one legacy-provenance Session of the
   * current maintenance page by deriving the trusted basis and committing it
   * through the directory's one-time `backfillSessionProvenance`. A `null`
   * result means the provenance is still unresolved; the retired branch then
   * refuses to conclude "no continuation".
   */
  async function backfillLegacyProvenance(
    ctx: CoreCallContext, sessions: WorkflowDependencies['sessions'],
    sessionRef: SessionRef, record: SessionRecord,
  ): Promise<SessionRecord | null> {
    if ((record.provenance ?? null) !== null) return record;
    if (deps.legacyProvenance === undefined) return null;
    const backfill = sessions.backfillSessionProvenance;
    if (backfill === undefined) return null;
    try {
      const derived = await deps.legacyProvenance.deriveLegacySessionProvenance(ctx, sessionRef);
      if (derived.status !== 'ready') return null;
      const written = await backfill.call(sessions, ctx, {
        input: { sessionRef, provenance: derived.value.provenance, basis: derived.value.basis },
        meta: {
          requestId: `s1-maintenance-provenance:${sessionRef.projectId}:${sessionRef.sessionId}`,
          expected: [{ ref: record.ref, revision: record.revision }],
        },
      });
      if (written.status !== 'committed') return null;
      // Re-read so the following due/disposal decision uses the recorded
      // provenance and the bumped revision.
      const card = await sessions.readSession(ctx, sessionRef);
      return card.status === 'ready' ? card.value.record : written.value;
    } catch {
      return null;
    }
  }

  /**
   * A8 Q-01/H-04/W-14/W-15 (LA-1, SES-07): a retired `kernel_turn_open` line is
   * auto-archived only when the platform itself proved a host-takeover
   * interruption (`interrupted_clean`) whose Turn really stopped and no human
   * pause fence is pending. Anything else - a human-attested crash, an
   * unresolved probe, a missing Run - is left for the explicit archive route.
   */
  async function platformCleanInterruption(ctx: CoreCallContext, latestWork: SessionFactsV1['latestWork']): Promise<boolean> {
    if (latestWork === null || deps.executions === undefined) return false;
    try {
      const read = await deps.executions.readExecution(ctx, latestWork.runRef);
      if (read.status !== 'ready') return false;
      const observation = read.value.run.reconciliation?.observation;
      return observation?.kind === 'interrupted_clean' && (observation.pausedIntentRef ?? null) === null;
    } catch {
      return false;
    }
  }

  async function dutyOf(record: SessionRecord): Promise<PlatformDutyV1 | 'unknown'> {
    if (deps.sessionDuty === undefined) return 'unknown';
    const resolved = await deps.sessionDuty(record.role);
    if (resolved.status === 'ready') return resolved.value;
    return 'unknown';
  }

  return {
    async maintainSessions(ctx, input): Promise<ReadResult<SessionMaintenanceResultV1>> {
      let isolated: unknown;
      try { isolated = structuredClone(input); } catch { return reject('invalid', 'the maintenance input cannot be isolated from the caller'); }
      if (!isRecord(isolated) || !isRecord(isolated['workspace'])) {
        return reject('invalid', 'maintainSessions requires a WorkspaceScope');
      }
      const workspaceRaw = isolated['workspace'];
      if (!nonEmpty(workspaceRaw['projectId']) || !nonEmpty(workspaceRaw['workspaceId'])) {
        return reject('invalid', 'maintainSessions requires a complete WorkspaceScope');
      }
      const workspace: WorkspaceScope = { projectId: workspaceRaw['projectId'] as string, workspaceId: workspaceRaw['workspaceId'] as string };
      const caller = callerProblem(ctx);
      if (caller !== null) return caller;
      if (workspace.projectId !== ctx.projectId || workspace.workspaceId !== ctx.workspaceId) {
        return reject('forbidden', 'archive_scope: the maintenance workspace is outside the bound context');
      }
      const after = isolated['after'];
      if (after !== null && after !== undefined && typeof after !== 'string') {
        return reject('invalid', 'maintainSessions requires a string or null cursor');
      }
      if (deps.sessions === undefined) return reject('unsupported', 'the Session directory is not installed');
      const sessions = deps.sessions;
      const policy = deps.archivePolicy;
      const limit = policy === undefined ? 100 : policy.maintenancePageSize;
      if (typeof limit !== 'number' || !Number.isSafeInteger(limit) || limit < 1 || limit > PAGE_LIMIT_MAX) {
        return reject('invalid', `maintenancePageSize must be an integer between 1 and ${String(PAGE_LIMIT_MAX)}`);
      }
      const workspaceKey = canonical(workspace) ?? `${workspace.projectId}/${workspace.workspaceId}`;
      const fromInput = typeof after === 'string' && after.length > 0 ? after : null;
      const cursor = fromInput ?? cursors.get(workspaceKey) ?? null;
      const automation = contextForActor(ctx, SESSION_ARCHIVE_AUTOMATION_ACTOR);

      const found = await sessions.findSessions(ctx, {
        workspace, includeArchived: false,
        page: cursor === null ? { limit } : { limit, cursor },
      });
      if (found.status !== 'ready') {
        if (found.status === 'rejected') return found;
        return reject('incomplete', 'the Session directory page is not ready');
      }

      const archived: SessionRef[] = [];
      const pending: SessionRef[] = [];
      const failures: { sessionRef: SessionRef; rejection: CoreRejection }[] = [];
      const now = deps.now?.() ?? new Date().toISOString();

      // E14 (§2.2 S:190): backfill the legacy provenance of the CURRENT page
      // before any line decision. `legacyPending` and the retired branch below
      // must never read an unchecked old Session as "no continuation".
      const resolvedRecords = new Map<string, SessionRecord>();
      for (const card of found.value.items) {
        if ((card.record.provenance ?? null) !== null) continue;
        const pageRef: SessionRef = { projectId: card.record.ref.projectId, sessionId: card.record.ref.sessionId };
        try {
          const resolved = await backfillLegacyProvenance(automation, sessions, pageRef, card.record);
          if (resolved !== null) resolvedRecords.set(`${pageRef.projectId}/${pageRef.sessionId}`, resolved);
        } catch { /* unresolved; the retired branch refuses to conclude below */ }
      }

      for (const card of found.value.items) {
        let record = resolvedRecords.get(`${card.record.ref.projectId}/${card.record.ref.sessionId}`) ?? card.record;
        let links: readonly SessionWorkLink[] = card.links;
        const sessionRef: SessionRef = { projectId: record.ref.projectId, sessionId: record.ref.sessionId };
        try {
          if (record.lifecycle !== 'active') continue;
          const factsRead = deps.sessionFacts?.readSessionFacts;
          if (factsRead === undefined) { failures.push({ sessionRef, rejection: reject('unsupported', 'the Session facts reader is not installed') }); continue; }
          const factsResult = await deps.sessionFacts!.readSessionFacts(ctx, sessionRef);
          if (factsResult.status !== 'ready') {
            failures.push({ sessionRef, rejection: factsResult.status === 'rejected' ? factsResult : reject('incomplete', 'the Session facts are not ready') });
            continue;
          }
          const facts = factsResult.value;

          // An already-registered request is always continued before new work.
          if (record.archiveRequest !== null && record.archiveRequest !== undefined) {
            if (deps.archive === undefined) { failures.push({ sessionRef, rejection: reject('unsupported', 'the archive composition is not installed') }); continue; }
            const resumed = await deps.archive.continueArchiveLine(ctx, { sessionRef, archiveRequestId: record.archiveRequest.requestId });
            classify(sessionRef, resumed, archived, pending, failures);
            continue;
          }

          const retired = record.health === 'unavailable';
          const copy = record.provenance?.kind === 'readonly_copy';

          // §0.1 U1: a retired line whose unknown Run still occupies it is
          // skipped with zero commits (no request, no anchor, no drop).
          if (retired && record.occupancy !== null && record.occupancy.kind === 'execution'
            && record.occupancy.executionRef.aggregateType === 'Run') {
            const run = deps.executions === undefined
              ? null : await deps.executions.readExecution(ctx, record.occupancy.executionRef);
            if (run !== null && run.status === 'ready' && run.value.run.outcome === 'outcome_unknown') {
              failures.push({ sessionRef, rejection: reject('busy', 'archive_unknown_confirmation_required: the retired Run outcome is unknown') });
              continue;
            }
          }

          // §4.1 step 6 / §4.2: formally terminal responsibilities are closed
          // before the due/disposal decision, through their real owner.
          const closed = await closeTerminalResponsibilities(automation, sessionRef, record, links);
          record = closed.record;
          links = closed.links;

          let mode: 'retired' | 'answered_copy' | 'executor_idle' | null = null;
          let reason = '';
          if (retired) {
            if (record.occupancy !== null || facts.continuations.length > 0) continue;
            // A8 Q-01/H-04 (LA-1, SES-07) + §4.2 S:807: a `kernel_turn_open`
            // line is left for the explicit route when the platform has nothing
            // to dispose (no open responsibility: the retired Query Session of
            // A8 Q-01) or when an original human pause fence still holds (the
            // paused-interrupted Work line of A8-3o/3q). A plain host-takeover
            // interruption with an open responsibility is still auto-archived
            // (S1-AUTO-02 drops it: IT10); a retired wait is exempt from
            // disposal (S1-AUTO-02) and still archives.
            if (record.healthConclusion === 'kernel_turn_open' && facts.wait === null
              && (openResponsibleLinks(record, links).length === 0
                || !(await platformCleanInterruption(automation, facts.latestWork)))) continue;
            // E14 (§2.2 S:190): while the workspace still has unchecked
            // provenance-null Sessions, or this line's own legacy provenance
            // could not be resolved, the absence of a continuation is unproven.
            if (facts.legacyPending || (record.provenance ?? null) === null) {
              failures.push({ sessionRef, rejection: reject('incomplete',
                'the legacy provenance of this line is unresolved; the absence of a continuation cannot be proven') });
              continue;
            }
            mode = 'retired';
            reason = 'the Session is retired with no continuation';
          } else if (copy) {
            if (record.occupancy !== null) continue;
            const answer = await copyAnswerState(automation, sessionRef, record);
            if (answer.kind === 'unsupported') {
              failures.push({ sessionRef, rejection: reject('unsupported', answer.reason) });
              continue;
            }
            if (answer.kind !== 'answered') continue;
            mode = 'answered_copy';
            reason = 'the read-only copy has a formal answer';
          } else {
            const duty = await dutyOf(record);
            if (duty !== 'executor') continue;
            const open = openResponsibleLinks(record, links);
            const waiting = facts.wait !== null;
            const openModule = open.some((link) => link.ref.target.kind === 'module');
            let finishedAt: string | null = null;
            if (open.length === 0 && !waiting && !openModule) {
              const proof = await finishedAtProof(automation, sessionRef, links);
              if (proof.incomplete !== null) {
                failures.push({ sessionRef, rejection: reject('incomplete', proof.incomplete) });
                continue;
              }
              finishedAt = proof.value;
            }
            const due = executorArchiveDue({
              duty, session: record, unfinishedResponsibility: open.length > 0, waiting,
              openModuleResponsibility: openModule, finishedAt, now, thresholdMs: policy?.executorArchiveAfterMs ?? 86_400_000,
            });
            if (!due) continue;
            mode = 'executor_idle';
            reason = 'the executor line has been idle for the archive threshold';
          }

          const internal = internalArchive();
          if (internal === undefined) { failures.push({ sessionRef, rejection: reject('unsupported', 'the internal archive composition is not installed') }); continue; }
          const tasks = openResponsibleLinks(record, links).map((link) => ({
            target: { kind: 'task' as const, ref: link.ref.target.kind === 'task' ? link.ref.target.ref : { projectId: record.ref.projectId, goalId: '', taskId: '' } },
            disposition: { kind: 'drop' as const },
          })).filter((choice) => choice.target.ref.goalId.length > 0);
          const requestId = `s1-maintenance-archive:${record.ref.projectId}:${sessionRef.sessionId}:${mode}:${record.revision}`;
          const request: GraphWrite<RequestSessionArchiveInput> = {
            input: { sessionRef, reason, tasks, wait: null, mode },
            meta: { requestId, expected: [{ ref: record.ref, revision: record.revision }] },
          };
          const result = await internal(automation, request);
          classify(sessionRef, result, archived, pending, failures);
        } catch (error) {
          failures.push({ sessionRef, rejection: reject('unavailable', `maintenance failed for this Session: ${error instanceof Error ? error.message : String(error)}`) });
        }
      }

      const nextCursor = found.value.nextCursor;
      cursors.set(workspaceKey, nextCursor);
      return { status: 'ready', value: { processed: found.value.items.length, nextCursor, archived, pending, failures } };
    },
  };
}

function classify(
  sessionRef: SessionRef,
  result: ReadResult<ArchiveLineResultV1>,
  archived: SessionRef[], pending: SessionRef[],
  failures: { sessionRef: SessionRef; rejection: CoreRejection }[],
): void {
  if (result.status !== 'ready') {
    failures.push({ sessionRef, rejection: result.status === 'rejected'
      ? result : reject('incomplete', 'the archive composition read is not ready') });
    return;
  }
  if (result.value.state === 'archived') { archived.push(sessionRef); return; }
  if (result.value.state === 'pending') { pending.push(sessionRef); return; }
  failures.push({ sessionRef, rejection: result.value.rejection ?? reject('unavailable', 'the archive composition failed') });
}
