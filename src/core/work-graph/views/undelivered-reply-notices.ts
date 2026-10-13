/**
 * Wiring package 2 §2.3/§4.4/L7/L8: the `undelivered_reply` "please be aware"
 * projector (W205).
 *
 * It is a READ-ONLY `DecisionNoticeSourcePort`: it enumerates the workspace's
 * unavailable Sessions through the original directory, asks the original
 * mailbox for each line's undelivered replies, re-checks every item against the
 * original message, filters by the attributed Goal, and projects the later of
 * the two commit-bound positions (`unavailableSince` = R, `responseSince` = P)
 * as a notice. It never commits, never ack/consumes, never transfers a reply,
 * never writes and never wakes an agent. The positions are written by the
 * original owners (spec §2.3); this file only compares them.
 */
import type { CommitCursor } from '../../../contracts/command-event.js';
import type { CoreCallContext } from '../../../contracts/core/call-context.js';
import type { GoalRef } from '../../../contracts/ledger.js';
import type { NoticePositionV1 } from '../../../contracts/goal-decisions.js';
import type { ReadResult } from '../../../contracts/core/results.js';
import { canonicalJson, type JsonValue } from '../../../contracts/fingerprint.js';
import type {
  DecisionNoticeSourcePort,
  DecisionSourcePageV1,
  NoticeItemV1,
} from '../model/decision-contracts.js';
import type { SessionMailboxPort, SessionMessage, UndeliveredReplyV1 } from '../model/communication-contracts.js';
import type { SessionCard, SessionDirectoryPort } from '../model/session-contracts.js';
import type { DecisionReadRecordsPort } from './goal-conflicts.js';
import { atLeastCursorResult, readWatermark, storeFailureToRejection, workspaceScopeProblem } from './goal-conflicts.js';
import { decodeGoalSnapshot } from '../persistence/record-codecs.js';
import { compareNoticePositions } from './notice-position.js';

export type UndeliveredReplyNoticeSourceDependencies = {
  records: DecisionReadRecordsPort;
  sessions: Pick<SessionDirectoryPort, 'findSessions'>;
  messages: Pick<SessionMailboxPort, 'readUndeliveredReplies' | 'readMessage'>;
};

const PAGE_LIMIT = 100;
const SOURCE_PAGE_LIMIT = 200;
const MAX_SOURCE_PAGES = 50;
const MAX_SOURCE_ITEMS = 5000;
const MAX_WINDOW_ATTEMPTS = 4;

/** The opaque continuation of one source page; it binds scope, filter and the last position. */
type SourceCursorV1 = {
  v: 1;
  workspace: { projectId: string; workspaceId: string };
  goalRef: GoalRef | null;
  after: NoticePositionV1 | null;
  last: NoticePositionV1;
};

type ReadPageInput = Parameters<DecisionNoticeSourcePort['readPage']>[1];
type PageResult = ReadResult<DecisionSourcePageV1<NoticeItemV1>>;
type Attempt = { status: 'result'; result: PageResult } | { status: 'window_changed' };

export function createUndeliveredReplyNoticeSource(
  deps: UndeliveredReplyNoticeSourceDependencies,
): DecisionNoticeSourcePort {
  return {
    category: 'undelivered_reply',
    async readPage(ctx, input): Promise<PageResult> {
      // §4.4 rule 1: Host identity and cancellation are checked before any read,
      // and the explicit Goal is resolved (foreign workspace forbidden, absent
      // not_found) before the source walks the directory.
      if (ctx.principal.kind !== 'host') {
        return { status: 'rejected', code: 'forbidden',
          reason: 'the undelivered-reply notice source requires a Host call context' };
      }
      if (ctx.signal.aborted) {
        return { status: 'rejected', code: 'cancelled', reason: 'the undelivered-reply notice read was cancelled' };
      }
      const scopeProblem = workspaceScopeProblem(ctx, input.workspace);
      if (scopeProblem !== null) return scopeProblem;
      // Not installed is a distinct availability, never an empty success.
      if (deps.messages.readUndeliveredReplies === undefined) {
        return { status: 'ready', value: { availability: 'not_available', items: [], nextCursor: null, sourceCursor: null } };
      }
      const limit = input.page.limit;
      if (!Number.isSafeInteger(limit) || limit < 1 || limit > SOURCE_PAGE_LIMIT) {
        return { status: 'rejected', code: 'invalid',
          reason: 'undelivered_reply_page_limit: the page limit must be an integer between 1 and 200' };
      }
      let continuation: SourceCursorV1 | null = null;
      if (input.page.cursor !== undefined) {
        const decoded = decodeSourceCursor(input.page.cursor, input);
        if (decoded === 'invalid') {
          return { status: 'rejected', code: 'invalid',
            reason: 'the undelivered-reply cursor is not a valid continuation token for this request' };
        }
        continuation = decoded;
      }
      const goalProblem = await goalScopeProblem(deps.records, ctx, input.goalRef);
      if (goalProblem !== null) return goalProblem;
      // §4.4 rule 7: the window is retried as a WHOLE (fresh internal cursors)
      // at most four times; a stable failure is reported without half a page.
      try {
        for (let attempt = 0; attempt < MAX_WINDOW_ATTEMPTS; attempt += 1) {
          const read = await readAttempt(deps, ctx, input, continuation);
          if (read.status === 'result') return read.result;
        }
      } catch (error) {
        return readFailure(error);
      }
      return { status: 'rejected', code: 'unavailable',
        reason: 'undelivered_reply_window_changed: the read window did not stabilize after four attempts' };
    },
  };
}

/**
 * §4.4 rule 7/§8.1: one exception boundary. A structured Store failure keeps
 * its own code/reason; any other throw (null, an Error, a primitive) is an
 * unavailable read failure carrying the spec's literal prefix.
 */
function readFailure(error: unknown): Extract<PageResult, { status: 'rejected' }> {
  if (typeof error === 'object' && error !== null
    && typeof (error as { code?: unknown }).code === 'string'
    && typeof (error as { reason?: unknown }).reason === 'string') {
    return storeFailureToRejection(error as { code: string; reason: string });
  }
  return { status: 'rejected', code: 'unavailable',
    reason: `undelivered_reply_read_failed: ${error instanceof Error ? error.message : String(error)}` };
}

/**
 * §4.4 rule 1: an explicit Goal is resolved before the source enumerates the
 * directory. A foreign project is `forbidden` before any read; a same-project
 * Goal whose record lives in another workspace is `forbidden` after the read;
 * only a real in-scope absence is `not_found`; a damaged Goal is `unavailable`.
 */
async function goalScopeProblem(
  records: DecisionReadRecordsPort,
  ctx: CoreCallContext,
  goalRef: GoalRef | undefined,
): Promise<ReadResult<never> | null> {
  if (goalRef === undefined) return null;
  if (goalRef.projectId !== ctx.projectId) {
    return { status: 'rejected', code: 'forbidden', reason: 'the goal is outside the bound call scope' };
  }
  const goalKey = canonicalJson(goalRef as unknown as JsonValue);
  let read: Awaited<ReturnType<DecisionReadRecordsPort['readMany']>>;
  try {
    read = await records.readMany([goalKey]);
  } catch (error) {
    return readFailure(error);
  }
  if (read.status !== 'ready') return storeFailureToRejection(read);
  const found = read.value.records.find((record) => record.refKey === goalKey);
  if (found === undefined) {
    if (!read.value.missing.includes(goalKey)) {
      return { status: 'rejected', code: 'unavailable',
        reason: `record ${goalKey} was neither returned nor reported missing` };
    }
    return { status: 'not_found' };
  }
  const decoded = decodeGoalSnapshot(found);
  if (decoded.status !== 'decoded') {
    return { status: 'rejected', code: 'unavailable', reason: `Goal ${goalKey}: ${decoded.reason}` };
  }
  if (decoded.value.ref.projectId !== ctx.projectId || decoded.value.workspaceRef.workspaceId !== ctx.workspaceId) {
    return { status: 'rejected', code: 'forbidden', reason: 'the goal belongs to another workspace' };
  }
  return null;
}

async function readAttempt(
  deps: UndeliveredReplyNoticeSourceDependencies,
  ctx: CoreCallContext,
  input: ReadPageInput,
  continuation: SourceCursorV1 | null,
): Promise<Attempt> {
  const watermarkRead = await readWatermark(deps.records);
  if (watermarkRead.status !== 'ready') return { status: 'result', result: watermarkRead };
  const window = watermarkRead.value;
  const fresh = atLeastCursorResult<DecisionSourcePageV1<NoticeItemV1>>(window, input.page.atLeastCursor);
  if (fresh !== null) return { status: 'result', result: fresh };

  // ---- directory: same-workspace unavailable lines, includeArchived -------
  const sessions: SessionCard[] = [];
  let directoryCursor: string | undefined;
  let directoryPages = 0;
  while (true) {
    const read = await deps.sessions.findSessions(ctx, { workspace: input.workspace, includeArchived: true,
      page: { limit: PAGE_LIMIT, ...(directoryCursor === undefined ? {} : { cursor: directoryCursor }),
        ...(input.page.atLeastCursor === undefined ? {} : { atLeastCursor: input.page.atLeastCursor }) } });
    if (read.status !== 'ready') {
      if (read.status === 'rejected' && read.code === 'source_stale') return { status: 'window_changed' };
      return { status: 'result', result: read };
    }
    if (!sameWindow(window, read.value.sourceCursor)) return { status: 'window_changed' };
    for (const card of read.value.items) if (card.record.health === 'unavailable') sessions.push(card);
    directoryPages += 1;
    if (read.value.nextCursor === null) break;
    if (directoryPages >= MAX_SOURCE_PAGES) {
      return { status: 'result', result: capacityResult(
        `the Session directory read more than ${MAX_SOURCE_PAGES} pages`) };
    }
    directoryCursor = read.value.nextCursor;
  }

  // ---- per-line replies ----------------------------------------------------
  const items: NoticeItemV1[] = [];
  const seen = new Map<string, string>();
  for (const card of sessions) {
    const source = sourceRefOf(card);
    let replyCursor: string | undefined;
    let replyPages = 0;
    while (true) {
      const read = await deps.messages.readUndeliveredReplies!(ctx, { sessionRef: source,
        page: { limit: PAGE_LIMIT, ...(replyCursor === undefined ? {} : { cursor: replyCursor }),
          ...(input.page.atLeastCursor === undefined ? {} : { atLeastCursor: input.page.atLeastCursor }) } });
      if (read.status !== 'ready') {
        if (read.status === 'rejected' && read.code === 'source_stale') return { status: 'window_changed' };
        return { status: 'result', result: read };
      }
      if (!sameWindow(window, read.value.sourceCursor)) return { status: 'window_changed' };
      for (const reply of read.value.items) {
        const projected = await projectReply(deps, ctx, input, card, source, reply, window);
        if (projected.status === 'window_changed') return { status: 'window_changed' };
        if (projected.status === 'result') return { status: 'result', result: projected.result };
        const projectedItem = projected.value;
        if (projectedItem === null) continue;
        const { item, signature } = projectedItem;
        const existing = seen.get(item.itemKey);
        if (existing !== undefined) {
          if (existing !== signature) {
            return { status: 'result', result: { status: 'rejected', code: 'unavailable',
              reason: `undelivered_reply_identity_conflict: ${item.itemKey}` } };
          }
          continue;
        }
        seen.set(item.itemKey, signature);
        items.push(item);
        if (items.length > MAX_SOURCE_ITEMS) {
          return { status: 'result', result: capacityResult('the deduplicated notice output exceeded 5000 items') };
        }
      }
      replyPages += 1;
      if (read.value.nextCursor === null) break;
      if (replyPages >= MAX_SOURCE_PAGES) {
        return { status: 'result', result: capacityResult(
          `Session ${source.sessionId} read more than ${MAX_SOURCE_PAGES} reply pages`) };
      }
      replyCursor = read.value.nextCursor;
    }
  }

  // ---- trailing watermark: a commit during the read retries the window ----
  const trailingRead = await readWatermark(deps.records);
  if (trailingRead.status !== 'ready') return { status: 'result', result: trailingRead };
  if (!sameWindow(window, trailingRead.value)) return { status: 'window_changed' };

  items.sort((left, right) => {
    const byPosition = compareNoticePositions(left.position, right.position);
    return byPosition !== 0 ? byPosition : compareText(left.itemKey, right.itemKey);
  });
  const filtered = items.filter((item) => {
    if (input.after !== undefined && compareNoticePositions(item.position, input.after) <= 0) return false;
    if (continuation !== null && compareNoticePositions(item.position, continuation.last) <= 0) return false;
    return true;
  });
  const pageItems = filtered.slice(0, input.page.limit);
  const more = filtered.length > input.page.limit;
  const nextCursor = more && pageItems.length > 0
    ? encodeSourceCursor(input, pageItems[pageItems.length - 1]!.position)
    : null;
  return { status: 'result', result: { status: 'ready', value: {
    availability: 'available', items: pageItems, nextCursor, sourceCursor: window,
  } } };
}

async function projectReply(
  deps: UndeliveredReplyNoticeSourceDependencies,
  ctx: CoreCallContext,
  input: ReadPageInput,
  card: SessionCard,
  source: { projectId: string; sessionId: string },
  reply: UndeliveredReplyV1,
  window: CommitCursor | null,
): Promise<{ status: 'ready'; value: { item: NoticeItemV1; signature: string } | null } | { status: 'window_changed' }
  | { status: 'result'; result: PageResult }> {
  const read = await deps.messages.readMessage(ctx, reply.messageRef);
  if (read.status === 'not_found') {
    return stableDamage(deps, window, () => mismatch(reply.messageRef.messageId, 'does not exist'));
  }
  if (read.status !== 'ready') return { status: 'result', result: read };
  const message = read.value;
  const mismatchMessage = sourceMismatchReason(message, input, source, reply);
  if (mismatchMessage !== null) {
    return stableDamage(deps, window, () => mismatch(reply.messageRef.messageId, mismatchMessage));
  }
  const goalRef = attributedGoal(message);
  if (goalRef === 'mismatch') {
    return stableDamage(deps, window, () => mismatch(reply.messageRef.messageId, 'names conflicting Goals'));
  }
  // Goal filter first (L11-3): an item proven to belong to another Goal is
  // excluded before its positions are required. An unfiltered workspace read
  // keeps every attributed item in scope.
  if (input.goalRef !== undefined && (goalRef === null
    || goalRef.projectId !== input.goalRef.projectId || goalRef.goalId !== input.goalRef.goalId)) {
    return { status: 'ready', value: null };
  }
  // Spec §2.3/L7/§4.4.4: the DTO is the projection contract. Compare exactly,
  // counting absence as a value, so a DTO that omits a position the original
  // record/message still carries is stable damage, not a silent record fallback.
  if (reply.unavailableSince !== card.record.unavailableSince) {
    return stableDamage(deps, window, () => mismatch(reply.messageRef.messageId, 'disagrees with its stored entry position'));
  }
  if (reply.responseSince !== message.responseSince) {
    return stableDamage(deps, window, () => mismatch(reply.messageRef.messageId, 'disagrees with its stored reply position'));
  }
  const unavailableSince = reply.unavailableSince;
  const responseSince = reply.responseSince;
  if (unavailableSince === undefined || unavailableSince === null
    || responseSince === undefined || responseSince === null) {
    return stableDamage(deps, window, () => ({ status: 'rejected', code: 'incomplete',
      reason: `undelivered_reply_position_missing: ${reply.messageRef.messageId} (Session ${source.sessionId})` }));
  }
  const itemKey = `undelivered_reply:${canonicalJson({ messageRef: reply.messageRef, responseRef: reply.responseRef } as unknown as JsonValue)}`;
  const item: NoticeItemV1 = {
    itemKey,
    category: 'undelivered_reply',
    goalRef: goalRef as GoalRef,
    position: laterPosition(itemKey, unavailableSince, responseSince),
    summary: `未送达回复 · Session ${source.sessionId}`,
    objects: [{ kind: 'aggregate', pin: { ref: message.ref, revision: message.revision }, label: '原消息' }],
    rework: null,
  };
  // §4.4 rule 5: the identity signature covers ownership, respondedAt, the
  // source Session and BOTH original positions, so a duplicate pair that only
  // agrees on the later max(R,P) is still a conflict.
  return { status: 'ready', value: { item,
    signature: itemSignature(item, { respondedAt: reply.respondedAt, unavailableSince, responseSince, source }) } };
}

function sourceMismatchReason(
  message: SessionMessage,
  input: ReadPageInput,
  source: { projectId: string; sessionId: string },
  reply: UndeliveredReplyV1,
): string | null {
  if (message.ref.projectId !== input.workspace.projectId || message.ref.workspaceId !== input.workspace.workspaceId) {
    return 'belongs to another workspace';
  }
  if (message.sender.kind !== 'work_run') return 'is not a work_run message';
  if (!sameRef(message.sender.sessionRef, source)) return 'names another source Session';
  // §4.4 rule 3/line 248: the complete DTO source identity is part of the
  // contract. The directory-derived `source` is the authority; a DTO that
  // names a different source Session is stable damage, never a silent
  // collapse into the directory's identity.
  if (!sameRef(reply.sourceSessionRef, source)) return 'names another source Session';
  if (message.response === null) return 'has no saved response';
  if (canonicalJson(message.response.bodyRef as unknown as JsonValue)
    !== canonicalJson(reply.responseRef as unknown as JsonValue)) return 'names another response';
  if ((message.acceptedInputs ?? []).some((entry) => entry.part === 'response')) return 'was already accepted';
  return null;
}

function mismatch(messageId: string, detail: string): PageResult {
  return { status: 'rejected', code: 'unavailable',
    reason: `undelivered_reply_source_mismatch: ${messageId} ${detail}` };
}

/**
 * §4.4 rules 3/4/7: a message-level ownership/response/position damage is only
 * reported after the reads are re-checked against the attempt's stable window.
 * A window that moved is a whole-window retry signal, not stable damage (the
 * message reads themselves carry no sourceCursor).
 */
async function stableDamage(
  deps: UndeliveredReplyNoticeSourceDependencies,
  window: CommitCursor | null,
  build: () => PageResult,
): Promise<{ status: 'window_changed' } | { status: 'result'; result: PageResult }> {
  const check = await readWatermark(deps.records);
  if (check.status !== 'ready') return { status: 'result', result: check };
  if (!sameWindow(window, check.value)) return { status: 'window_changed' };
  return { status: 'result', result: build() };
}

function capacityResult(detail: string): PageResult {
  return { status: 'rejected', code: 'capacity', reason: `undelivered_reply_page_limit: ${detail}` };
}

/** L8: the later of the entry commit R and the reply commit P, by the ONLY comparator. */
function laterPosition(itemKey: string, unavailableSince: CommitCursor, responseSince: CommitCursor): NoticePositionV1 {
  const r: NoticePositionV1 = { kind: 'commit', cursor: unavailableSince, itemKey };
  const p: NoticePositionV1 = { kind: 'commit', cursor: responseSince, itemKey };
  return compareNoticePositions(r, p) >= 0 ? r : p;
}

function attributedGoal(message: SessionMessage): GoalRef | null | 'mismatch' {
  if (message.sender.kind !== 'work_run') return null;
  const fromRun: GoalRef = { aggregateType: 'Goal', projectId: message.sender.runRef.projectId, goalId: message.sender.runRef.goalId };
  const explicit = message.goalRef ?? null;
  if (explicit === null) return fromRun;
  if (explicit.projectId !== fromRun.projectId || explicit.goalId !== fromRun.goalId) return 'mismatch';
  return explicit;
}

function itemSignature(item: NoticeItemV1, original: { respondedAt: string; unavailableSince: CommitCursor;
  responseSince: CommitCursor; source: { projectId: string; sessionId: string } }): string {
  const first = item.objects[0];
  return canonicalJson({
    goalRef: item.goalRef, position: item.position, summary: item.summary, respondedAt: original.respondedAt,
    unavailableSince: String(original.unavailableSince), responseSince: String(original.responseSince),
    sourceSessionRef: { projectId: original.source.projectId, sessionId: original.source.sessionId },
    ref: first?.kind === 'aggregate' ? first.pin.ref : null,
    revision: first?.kind === 'aggregate' ? first.pin.revision : null,
  } as unknown as JsonValue);
}

function sameWindow(left: CommitCursor | null, right: CommitCursor | null): boolean {
  return left === null ? right === null : right !== null && String(left) === String(right);
}

function encodeSourceCursor(input: ReadPageInput, last: NoticePositionV1): string {
  const cursor: SourceCursorV1 = { v: 1, workspace: { projectId: input.workspace.projectId, workspaceId: input.workspace.workspaceId },
    goalRef: input.goalRef ?? null, after: input.after ?? null, last };
  return Buffer.from(canonicalJson(cursor as unknown as JsonValue), 'utf8').toString('base64url');
}

function decodeSourceCursor(raw: string, input: ReadPageInput): SourceCursorV1 | 'invalid' {
  let parsed: unknown;
  try { parsed = JSON.parse(Buffer.from(raw, 'base64url').toString('utf8')); } catch { return 'invalid'; }
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) return 'invalid';
  const cursor = parsed as Record<string, unknown>;
  // (a) §4.4 rule 6: the key set is exactly the spec envelope.
  if (Object.keys(cursor).sort().join(',') !== 'after,goalRef,last,v,workspace') return 'invalid';
  if (cursor['v'] !== 1) return 'invalid';
  // (b) the workspace must be the full spec object of this request.
  const workspace = cursor['workspace'];
  if (typeof workspace !== 'object' || workspace === null) return 'invalid';
  if (canonicalJson(workspace as unknown as JsonValue)
    !== canonicalJson({ projectId: input.workspace.projectId, workspaceId: input.workspace.workspaceId } as unknown as JsonValue)) {
    return 'invalid';
  }
  const last = cursor['last'];
  if (!isNoticePosition(last) || !isCommitPosition(last)) return 'invalid';
  const after = cursor['after'];
  if (after !== null && (!isNoticePosition(after) || !isCommitPosition(after))) return 'invalid';
  if (canonicalJson((input.goalRef ?? null) as unknown as JsonValue)
    !== canonicalJson((cursor['goalRef'] ?? null) as unknown as JsonValue)) return 'invalid';
  if (canonicalJson((input.after ?? null) as unknown as JsonValue)
    !== canonicalJson((after ?? null) as unknown as JsonValue)) return 'invalid';
  return cursor as unknown as SourceCursorV1;
}

/** §4.4 rule 6/L8: only a complete, nonzero ledger commit position is valid. */
function isCommitPosition(value: NoticePositionV1): boolean {
  if (value.kind !== 'commit' || !value.itemKey.startsWith('undelivered_reply:')) return false;
  // The one allowed cursor comparison point rejects malformed and zero cursors.
  try { compareNoticePositions(value, value); } catch { return false; }
  return true;
}

function isNoticePosition(value: unknown): value is NoticePositionV1 {
  if (typeof value !== 'object' || value === null) return false;
  const position = value as { kind?: unknown; itemKey?: unknown; cursor?: unknown; occurredAt?: unknown };
  if (typeof position.itemKey !== 'string') return false;
  if (position.kind === 'commit') return typeof position.cursor === 'string';
  if (position.kind === 'legacy') return typeof position.occurredAt === 'string';
  return false;
}

function compareText(left: string, right: string): -1 | 0 | 1 {
  return left < right ? -1 : left > right ? 1 : 0;
}

function sameRef(left: { projectId: string; sessionId: string }, right: { projectId: string; sessionId: string }): boolean {
  return left.projectId === right.projectId && left.sessionId === right.sessionId;
}

function sourceRefOf(card: SessionCard): { projectId: string; sessionId: string } {
  return { projectId: card.record.ref.projectId, sessionId: card.record.ref.sessionId };
}
