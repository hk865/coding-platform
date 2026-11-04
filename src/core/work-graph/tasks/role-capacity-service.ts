/**
 * L32 capacity episodes, the command half: the platform automatic add's one at-cap observation, the one stale close
 * that a release, a cap update and a reservation cancel call, and the `role_capacity` card's four-option application.
 *
 * One open episode per (project, duty); the card is the read projection of the open episode, so no card row is
 * written. Each episode write is one commit of the shared R2 executor carrying one `RoleCapacityEpisodeChanged`
 * event; `openedAt` and `closedAt` are bound by the commit that writes them. The resolution, never the opening,
 * writes one project notice, in its own commit after the close; the notice's refusal never undoes the close.
 *
 * An application runs through the owner of each change (the role-limits writer, the L25 reanchor, the formal
 * archive) with the card's proof pair. Its receipt is that owner's committed receipt under the owner's own identity; a
 * replay of the same answer looks that receipt up first and answers it, so no answer writes a second change.
 *
 * The pure next number, close rule and closed record are `state/role-capacity-episode.ts`; the narrow port and its
 * result types are `state/role-line-reclaim.ts`.
 */
import type { CommitCursor } from '../../../contracts/command-event.js';
import type { CoreCallContext } from '../../../contracts/core/call-context.js';
import type { ProjectScope, SessionRef, VersionPin } from '../../../contracts/core/identity.js';
import type { OperationRef } from '../../../contracts/core/operations.js';
import type { CoreRejection, ReadResult, WriteResult } from '../../../contracts/core/results.js';
import type { DecisionApplicationReceiptV1, SessionMessageRef } from '../../../contracts/core/session-message.js';
import { rejected, rejectedWithCurrent } from '../../../contracts/core/rejections.js';
import type { JsonValue } from '../../../contracts/fingerprint.js';
import type { DecisionSelectionV1, DecisionSourceV1 } from '../../../contracts/goal-decisions.js';
import {
  ROLE_CAPACITY_EPISODES_BY_PROJECT_DUTY_LOOKUP, workLinkTargetOf,
  type NotifyProjectInputV1, type RoleCapacityEpisodeV1, type RoleLineDutyV1, type RoleScopeV1,
} from '../../../contracts/role-lines.js';
import type { GoalRecordTransactionPort, RecordCommitIdentityPort } from '../../record-store/ports.js';
import type { RecordLookupPort } from '../../record-store/lookup-ports.js';
import type { SessionDirectoryPort } from '../model/session-contracts.js';
import { commandIdentity, executeWriteCommand } from '../persistence/command-executor.js';
import { lookupAll } from '../persistence/lookup-all.js';
import { storeFailureToRejection } from '../persistence/read-result-failures.js';
import { lookupCommittedReceiptByIdentity } from '../persistence/receipt-lookup.js';
import { capacityEpisodeCloses, closeCapacityEpisode, nextCapacityEpisode } from '../state/role-capacity-episode.js';
import type { CapacityCloseV1, RoleCapacityObservationV1, RoleCapacityPort } from '../state/role-line-reclaim.js';
import { roleLineOperationRef } from '../state/role-line-operation.js';
import { createAllocationRead, openLimitOf } from '../sessions/allocation-read.js';
import type { SessionLifecyclePort } from '../sessions/lifecycle-contracts.js';
import { roleCapacityEpisodeChangedCodec, roleCapacityEpisodeCodec } from '../sessions/role-line-orchestration-codecs.js';
import { droppedScopeLinksOf } from '../sessions/role-line-operations.js';
import type { RoleLimitsPort } from '../sessions/role-limits-service.js';
import type { SessionResponsibilityPort } from '../sessions/session-responsibility-service.js';
import { eventIdOf, identityKeyOf, trustedContext, type TrustedContext } from '../sessions/trusted-context.js';
import { parseDecisionSourceKey } from './decision-source-identity.js';

export type CapacityObservationV1 = RoleCapacityObservationV1;
/** The one application result the adapter maps; a defer writes nothing and a refusal is the owner's. */
export type CapacityApplicationV1 =
  | { status: 'applied'; receipt: DecisionApplicationReceiptV1 }
  | { status: 'deferred' }
  | { status: 'refused'; rejection: CoreRejection };
/** The one parsed answer body: the option and, for a merge or an archive, the line named on the capacity object. */
export type CapacityAnswerV1 =
  | { kind: 'raise_cap'; open: number }
  | { kind: 'merge_scopes'; line: SessionRef; scope: readonly RoleScopeV1[] }
  | { kind: 'archive_line'; line: SessionRef }
  | { kind: 'wait' };
/** The capacity service: the narrow `observeAtCap`/`closeIfStale` port plus the card's one application. */
export type RoleCapacityServicePort = RoleCapacityPort & {
  /** The four-option application, distinguished by the parsed answer's kind. */
  applyOption(ctx: CoreCallContext, input: {
    answerRef: SessionMessageRef; source: DecisionSourceV1; selection: DecisionSelectionV1;
    answer: CapacityAnswerV1; requestId: string; expected: readonly VersionPin[];
    /** The proof pair the owner's event carries; absent = no proof. */
    proof?: { answerRef: SessionMessageRef; capturedPins: readonly VersionPin[] };
  }): Promise<CapacityApplicationV1>;
};

export type RoleCapacityServiceDependenciesV1 = {
  /** The episode commits, the episode lookup and the allocation read. */
  records: GoalRecordTransactionPort & Pick<RecordLookupPort, 'lookup'>;
  /** An application reads each owner's committed receipt by its identity alone (no fingerprint). */
  commitIdentities: Pick<RecordCommitIdentityPort, 'readCommitByIdentity'>;
  now: () => Date;
  /** The one project-notice writer (`notifyProject`); its answer is not read: a committed close stays closed. */
  notices: (input: NotifyProjectInputV1) => Promise<unknown>;
  limits: Pick<RoleLimitsPort, 'readRoleLimits' | 'setRoleLimits'>;
  lifecycle: Pick<SessionLifecyclePort, 'archiveSession'>;
  responsibility: Pick<SessionResponsibilityPort, 'reanchorSessionResponsibility'>;
  sessions: Pick<SessionDirectoryPort, 'readSession'>;
};

type TrustedScope = Extract<TrustedContext, { ok: true }>;
type PendingEpisode = Parameters<typeof roleCapacityEpisodeCodec.encode>[0];

export function createRoleCapacityService(deps: RoleCapacityServiceDependenciesV1): RoleCapacityServicePort {
  const allocationRead = createAllocationRead({ records: deps.records });

  /** The (project, duty)'s episodes in episode order and the one still open; damage is `unavailable`. */
  async function readEpisodes(projectId: string, duty: RoleLineDutyV1): Promise<
    { status: 'ready'; value: { episodes: RoleCapacityEpisodeV1[]; open: RoleCapacityEpisodeV1 | null } } | CoreRejection> {
    let batch;
    try {
      batch = await lookupAll(deps.records, ROLE_CAPACITY_EPISODES_BY_PROJECT_DUTY_LOOKUP, [projectId, duty]);
    } catch (failure) {
      return storeFailureToRejection(failure);
    }
    const episodes: RoleCapacityEpisodeV1[] = [];
    for (const record of batch.items) {
      const decoded = roleCapacityEpisodeCodec.decode(record);
      if (decoded.status !== 'decoded') return rejected('unavailable', `a capacity episode is damaged: ${decoded.reason}`);
      episodes.push(decoded.value);
    }
    return { status: 'ready', value: { episodes, open: episodes.find((episode) => episode.closedAt === null) ?? null } };
  }

  /**
   * One episode write: the record with the cursor field this commit binds, guarded at the revision it replaces
   * (absence for an open), and one event last. The committed record is derived from the receipt's cursor.
   */
  async function commitEpisode(ctx: CoreCallContext, trusted: TrustedScope, input: {
    pending: PendingEpisode; expectedRevision: number | null; field: 'openedAt' | 'closedAt';
    bound: (cursor: CommitCursor) => RoleCapacityEpisodeV1;
  }): Promise<WriteResult<RoleCapacityEpisodeV1>> {
    const { projectId, workspaceId } = trusted.scope;
    const record = roleCapacityEpisodeCodec.encode(input.pending);
    const written = await executeWriteCommand(deps.records, {
      operation: 'role-capacity-episode',
      principal: ctx.principal,
      commandId: `${input.pending.duty}:${input.pending.episode}:${input.pending.revision}`,
      scope: { projectId, workspaceId },
      fingerprintInput: input.pending as unknown as JsonValue,
      read: async () => ({ status: 'ready' as const, facts: null }),
      decide: (): { refuse: never } | { decision: null } => ({ decision: null }),
      build: (_decision, keys) => ({
        records: [record],
        claims: [],
        events: [roleCapacityEpisodeChangedCodec.encode({
          eventId: eventIdOf(keys.identityKey, 'changed'), eventType: 'RoleCapacityEpisodeChanged', schemaVersion: 1,
          occurredAt: deps.now().toISOString(), projectId, workspaceId, actor: trusted.actor,
          revision: input.pending.revision })],
        guards: [{ refKey: record.refKey, expectedRevision: input.expectedRevision }],
        commitCursorBindings: [{ refKey: record.refKey, field: input.field }],
      }),
      result: { eventType: 'RoleCapacityEpisodeChanged', schemaVersion: 1,
        decode: (event) => roleCapacityEpisodeChangedCodec.decode(event),
        validate: (event, receipt, keys) => event.projectId !== projectId || event.workspaceId !== workspaceId
          ? 'the event records another scope'
          : receipt.identityKey === keys.identityKey ? null : 'the receipt belongs to another command',
        project: (_event, cursor) => input.bound(cursor) },
    });
    if (written.status === 'refused') return written.refusal;
    if (written.status === 'rejected') return rejectedWithCurrent(written.code, written.reason, written.current);
    return { status: 'committed', value: written.value, replayed: written.replayed, cursor: written.cursor };
  }

  /** The close of one open episode, guarded by its revision. */
  function closeEpisode(ctx: CoreCallContext, trusted: TrustedScope, open: RoleCapacityEpisodeV1):
    Promise<WriteResult<RoleCapacityEpisodeV1>> {
    return commitEpisode(ctx, trusted, {
      pending: { ...structuredClone(open), revision: open.revision + 1, closedAt: null },
      expectedRevision: open.revision, field: 'closedAt',
      bound: (cursor) => closeCapacityEpisode(open, cursor),
    });
  }

  /** The resolution's one notice, a second commit after the close; a replay finds its identity and writes nothing. */
  async function noticeResolution(projectRef: ProjectScope, closed: RoleCapacityEpisodeV1, operation: OperationRef):
    Promise<void> {
    await deps.notices({ projectRef, subject: { kind: 'project', projectRef }, kind: 'automatic_adjustment',
      summary: `容量已恢复：${closed.duty} 的占用已低于上限 ${closed.capValue}；` + '本卡已关闭，可继续排队或重新开线',
      operation });
  }

  async function observeAtCap(ctx: CoreCallContext, input: Parameters<RoleCapacityPort['observeAtCap']>[1]):
    Promise<WriteResult<CapacityObservationV1>> {
    const trusted = trustedContext(ctx, 'a capacity observation');
    if (!trusted.ok) return trusted.rejection;
    const projectRef: ProjectScope = { projectId: input.projectRef.projectId };
    const read = await readEpisodes(projectRef.projectId, input.duty);
    if (read.status !== 'ready') return read;
    const { open, episodes } = read.value;
    if (open !== null) {
      if (!capacityEpisodeCloses({ episode: open, open: input.open, holders: input.holders,
        reservations: input.reservations })) {
        // Nothing is written: the open episode is the committed result of the commit that opened it.
        return { status: 'committed', value: { episode: open, opened: true }, replayed: true, cursor: open.openedAt };
      }
      // A stale episode closes now; this refusal carries no number and the next refusal opens a new episode.
      const closed = await closeEpisode(ctx, trusted, open);
      if (closed.status !== 'committed') return closed;
      await noticeResolution(projectRef, closed.value, input.operation);
      return { ...closed, value: { episode: closed.value, opened: false } };
    }
    const episode = nextCapacityEpisode(episodes, input.duty);
    const pending: PendingEpisode = {
      ref: { aggregateType: 'RoleCapacityEpisode', projectId: projectRef.projectId, duty: input.duty, episode },
      revision: 1, projectRef, duty: input.duty, episode, capValue: input.capValue, openedAt: null, closedAt: null,
    };
    // The opening writes no notice: the opening is not the resolution.
    const opened = await commitEpisode(ctx, trusted, { pending, expectedRevision: null, field: 'openedAt',
      bound: (cursor) => ({ ...pending, openedAt: cursor }) });
    if (opened.status !== 'committed') return opened;
    return { ...opened, value: { episode: opened.value, opened: true } };
  }

  async function closeIfStale(ctx: CoreCallContext, input: Parameters<RoleCapacityPort['closeIfStale']>[1]):
    Promise<CapacityCloseV1> {
    const trusted = trustedContext(ctx, 'a capacity close');
    if (!trusted.ok) return trusted.rejection;
    const projectRef: ProjectScope = { projectId: input.projectRef.projectId };
    const read = await readEpisodes(projectRef.projectId, input.duty);
    if (read.status !== 'ready') return read;
    const open = read.value.open;
    if (open === null) return { status: 'clean' };
    const seat = await allocationRead.readAllocationForCommit(ctx, { projectRef, duty: input.duty });
    if (seat.status !== 'ready') return seat.status === 'rejected' ? seat
      : rejected('unavailable', 'the role-line allocation is not readable');
    const { allocation, limits } = seat.value;
    if (!capacityEpisodeCloses({ episode: open, open: openLimitOf(limits, input.duty),
      holders: allocation?.holders.length ?? 0, reservations: allocation?.reservations.length ?? 0 })) {
      return { status: 'clean' };
    }
    const closed = await closeEpisode(ctx, trusted, open);
    if (closed.status !== 'committed') return closed;
    // A public cap set has no operation identity, so it writes no notice.
    if (input.operation !== null) await noticeResolution(projectRef, closed.value, input.operation);
    return { status: 'closed', episode: closed.value, cursor: closed.cursor };
  }

  /**
   * The owner's committed receipt under its own identity, which is the formal application receipt (the identity, the
   * fingerprint it committed with, its cursor). Before the first call, found is the earlier application, answered with
   * no current read (an archive's fingerprint holds the pins it read), and missing goes on to the first call.
   */
  async function committedApplication(identityKey: string): Promise<CapacityApplicationV1 | null> {
    const read = await lookupCommittedReceiptByIdentity(deps.commitIdentities, identityKey);
    if (read.status === 'missing') return null;
    if (read.status === 'found') {
      return { status: 'applied', receipt: { identityKey, fingerprint: read.fingerprint, cursor: read.receipt.cursor } };
    }
    return { status: 'refused', rejection: rejected(read.status, read.reason) };
  }

  /** A committed change's application: the owner's receipt under the identity it just committed. */
  async function appliedUnder(identityKey: string): Promise<CapacityApplicationV1> {
    return await committedApplication(identityKey) ?? { status: 'refused',
      rejection: rejected('unavailable', 'the committed change has no receipt under its identity') };
  }

  async function applyOption(ctx: CoreCallContext, input: Parameters<RoleCapacityServicePort['applyOption']>[1]):
    Promise<CapacityApplicationV1> {
    const trusted = trustedContext(ctx, 'a capacity card application');
    if (!trusted.ok) return { status: 'refused', rejection: trusted.rejection };
    const { scope, actor } = trusted;
    const projectRef: ProjectScope = { projectId: scope.projectId };
    // The resolution notice's identity comes from this command alone, never from the source or the episode.
    const capacityOperation = roleLineOperationRef(input.answerRef.projectId, 'capacity-resolution', input.requestId);
    const { answer } = input;
    switch (answer.kind) {
      case 'raise_cap': {
        const identityKey = commandIdentity({ operation: 'roleLimits.set',
          scope: { projectId: scope.projectId, workspaceId: scope.workspaceId }, principal: ctx.principal,
          commandId: input.requestId });
        const earlier = await committedApplication(identityKey);
        if (earlier !== null) return earlier;
        // The source key was proved the canonical identity of a `role_capacity` card when the answer committed.
        const duty = parseDecisionSourceKey(input.source)!.body['duty'] as RoleLineDutyV1;
        const limits = await deps.limits.readRoleLimits(ctx, { projectRef });
        if (limits.status !== 'ready') return readRefusal(limits, 'the role limits');
        const set = await deps.limits.setRoleLimits(ctx,
          { commandId: input.requestId, expectedRevision: limits.value.revision, open: { [duty]: answer.open } },
          { answerRef: input.answerRef, capturedPins: input.expected, capacityOperation });
        return set.status === 'committed' ? appliedUnder(identityKey) : { status: 'refused', rejection: set };
      }
      case 'merge_scopes': {
        const identityKey = identityKeyOf('session-responsibility-reanchor:', actor, scope, input.requestId);
        const earlier = await committedApplication(identityKey);
        if (earlier !== null) return earlier;
        const card = await deps.sessions.readSession(ctx, answer.line);
        if (card.status !== 'ready') return readRefusal(card, 'the capacity answer line');
        const { close, pins } = droppedScopeLinksOf(card.value, answer.scope);
        const moved = await deps.responsibility.reanchorSessionResponsibility(ctx, {
          input: { session: answer.line, close,
            open: answer.scope.map((each) => ({ target: workLinkTargetOf(projectRef, each) })),
            reason: 'human_scope_change' },
          meta: { requestId: input.requestId, expected: pins },
        }, input.proof);
        return moved.status === 'committed' ? appliedUnder(identityKey) : { status: 'refused', rejection: moved };
      }
      case 'archive_line': {
        const identityKey = identityKeyOf('session-archive:', actor, scope, input.requestId);
        const earlier = await committedApplication(identityKey);
        if (earlier !== null) return earlier;
        const card = await deps.sessions.readSession(ctx, answer.line);
        if (card.status !== 'ready') return readRefusal(card, 'the capacity answer line');
        // The person chose the line, so no idle check; the archive owner's success exit closes the stale episode
        // under this operation and writes the resolution notice.
        const archived = await deps.lifecycle.archiveSession(ctx, {
          input: { sessionRef: answer.line, reason: 'capacity-resolution' },
          meta: { requestId: input.requestId,
            expected: [{ ref: card.value.record.ref, revision: card.value.record.revision }] },
        }, { ...(input.proof === undefined ? {} : { proof: input.proof }), operation: capacityOperation });
        return archived.status === 'committed' ? appliedUnder(identityKey)
          : { status: 'refused', rejection: archived };
      }
      case 'wait':
        return { status: 'deferred' };
    }
  }

  return { observeAtCap, closeIfStale, applyOption };
}

/** A read that did not answer `ready` as the application's refusal; its own rejection is kept. */
function readRefusal(read: Exclude<ReadResult<unknown>, { status: 'ready' }>, what: string): CapacityApplicationV1 {
  return { status: 'refused', rejection: read.status === 'rejected' ? read
    : rejected('unavailable', `${what} is ${read.status === 'not_found' ? 'missing' : 'not ready'}`) };
}
