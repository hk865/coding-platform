/**
 * Slice 5 §4.4/F44 + slice 2A L4: the automatic requeue/reverify "please be
 * aware" projector.
 *
 * One `DecisionNoticeSourcePort` for category `automatic_rework`. It reads the
 * ordered commit-position window:
 *   - requeues come from `s2a-requeue-by-project` (bound at the saved seen
 *     commit position);
 *   - reverify rounds come from `s2a-round-reverify` (equality on project,
 *     workspace and the system/member actor class). The ordered index only
 *     names the SUBJECT; every subject's whole chain is read once through
 *     `VerificationRoundBySubject` and rechecked with `roundChainHead`. Earlier
 *     rounds and human rechecks in the chain are used for verification only and
 *     never become notices (D2).
 *
 * One `DecisionNoticeSourcePort` deduplicates by the exact
 * `TaskRequeueRef`/`VerificationRoundRef`, keeps only system/agent rework, and
 * projects the frozen `自动返工 · …` summary with the creation-time cap. It
 * never schedules work, wakes an agent or writes a Notification.
 */
import type { CommitCursor } from '../../../contracts/command-event.js';
import type { CoreCallContext } from '../../../contracts/core/call-context.js';
import type { ReadResult } from '../../../contracts/core/results.js';
import { rejected } from '../../../contracts/core/rejections.js';
import type { TaskRequeueSnapshotV1 } from '../../../contracts/task-requeue.js';
import type { RoundSnapshot, VerificationRoundRef } from '../../../contracts/verification.js';
import type { TaskTriple } from '../../../contracts/dispatch.js';
import { canonicalJson, type JsonValue } from '../../../contracts/fingerprint.js';
import type { EncodedRecord } from '../../record-store/ports.js';
import type { OrderedLookupValue, RecordOrderedLookupPage, RecordOrderedLookupPort } from '../../record-store/lookup-ports.js';
import type {
  DecisionNoticeSourcePort,
  DecisionSourceAttempt,
  DecisionSourcePageV1,
  NoticeItemV1,
  S5RecordPort,
} from '../model/decision-contracts.js';
import { decodeNoticeOrigin } from '../persistence/decision-record-codecs.js';
import {
  decodeVerificationRoundSnapshot,
  S2A_ROUND_REVERIFY_LOOKUP,
  VERIFICATION_ROUND_CHAIN_LOOKUP_LIMIT,
  VERIFICATION_ROUND_ORIGINAL_LOOKUP,
} from '../persistence/evidence-record-codecs.js';
import { decodeGoalSnapshot } from '../persistence/record-codecs.js';
import {
  decodeTaskRequeueSnapshot,
  S2A_REQUEUE_BY_PROJECT_LOOKUP,
} from '../tasks/claim-record-codecs.js';
import { roundChainHead } from '../state/verification-machine.js';
import { compareNoticePositions } from './notice-position.js';
import type { DecisionReadRecordsPort } from './goal-conflicts.js';
import { readWatermark, storeFailureToRejection } from './goal-conflicts.js';

/**
 * The read-only RecordStore seam. P7: the ordered port is part of the
 * dependency TYPE, so the ordered read never probes or casts at runtime and no
 * alias is added to `decision-contracts.ts`.
 */
export type AutomaticReworkNoticeSourceDependencies = {
  records: Pick<S5RecordPort, 'readMany' | 'lookup'> & RecordOrderedLookupPort;
  /** The page width of the ordered requeue/reverify reads (default 200). */
  orderedPageLimit?: number;
};

/** §4.4: one ordered read page is at most 200 records (the default page width). */
const ORDERED_PAGE_LIMIT = 200;

/** Builds the `automatic_rework` notice source; the factory itself never throws. */
export function createAutomaticReworkNoticeSource(
  deps: AutomaticReworkNoticeSourceDependencies,
): DecisionNoticeSourcePort {
  return {
    category: 'automatic_rework',
    async readPage(ctx, input): Promise<ReadResult<DecisionSourcePageV1<NoticeItemV1>>> {
      return readAutomaticReworkPage(deps.records, ctx, input,
        deps.orderedPageLimit ?? ORDERED_PAGE_LIMIT);
    },
  };
}

type ReadPageInput = {
  workspace: { projectId: string; workspaceId: string };
  goalRef?: { aggregateType: 'Goal'; projectId: string; goalId: string };
  after?: NoticeItemV1['position'];
  page: { limit: number; cursor?: string; atLeastCursor?: unknown; attempt?: DecisionSourceAttempt };
};

/**
 * One read of the ordered index to the end. The `values` equality prefix is
 * always non-empty text (D3); `bound` is the saved commit position for `asc`.
 */
export async function readOrderedToEnd(
  records: AutomaticReworkNoticeSourceDependencies['records'],
  index: string,
  values: readonly string[],
  bound: { value: OrderedLookupValue; inclusive: boolean } | null,
  /** The page width of one ordered read; the default stays today's 200. */
  limit: number = ORDERED_PAGE_LIMIT,
): Promise<EncodedRecord[]> {
  const all: EncodedRecord[] = [];
  const lookupOrdered = records.lookupOrdered;
  let after: { order: OrderedLookupValue; refKey: string } | undefined;
  for (;;) {
    const page = await lookupOrdered.call(records, {
      index,
      values,
      direction: 'asc',
      ...(bound === null ? {} : { bound }),
      ...(after === undefined ? {} : { after }),
      limit,
    });
    if (page.status !== 'ready') throw page;
    for (const record of page.value.records) all.push(record);
    const next: RecordOrderedLookupPage['next'] = page.value.next;
    if (next === null) break;
    after = next;
  }
  return all;
}

/**
 * P9: a row returned by an ordered index whose decoded order value is missing
 * or outside the request is a read failure, never silently skipped. `bound` is
 * the inclusive lower bound of the request (`null` = read from the start).
 */
function orderedSince(
  record: EncodedRecord,
  bound: CommitCursor | null,
): { ok: true; since: CommitCursor } | { ok: false; rejection: { status: 'rejected'; code: 'unavailable'; reason: string } } {
  const origin = decodeNoticeOrigin(record);
  if (origin.status !== 'decoded') return { ok: false, rejection: rejected('unavailable', `automatic rework origin: ${origin.reason}`) };
  const since = origin.value.since;
  if (typeof since !== 'string' || since.length === 0) {
    return { ok: false, rejection: rejected('unavailable', `automatic rework ordered record ${record.refKey} has no commit position`) };
  }
  // `since` is `c` + zero-padded digits, so text order is commit order.
  if (bound !== null && since < bound) {
    return { ok: false, rejection: rejected('unavailable', `automatic rework ordered record ${record.refKey} is outside the requested window`) };
  }
  return { ok: true, since };
}

/** The `automatic_rework` page: the saved seen position decides the window. */
async function readAutomaticReworkPage(
  records: AutomaticReworkNoticeSourceDependencies['records'],
  _ctx: CoreCallContext,
  input: ReadPageInput,
  orderedPageLimit: number = ORDERED_PAGE_LIMIT,
): Promise<ReadResult<DecisionSourcePageV1<NoticeItemV1>>> {
  // L11/P1: one assembly per window attempt. The read model passes one
  // `DecisionSourceAttempt` to every source and drops it with the attempt; the
  // whole collection is keyed by workspace + goal + category and served to the
  // attempt's later internal pages. No cross-attempt or cross-call cache.
  const cache = input.page.attempt?.cache;
  const cacheKey = attemptCacheKey(input);
  const cached = cache?.get(cacheKey) as AssembledReworkPage | undefined;
  if (cached !== undefined) return paginateAssembled(cached, input);
  const watermarkRead = await readWatermark(records);
  if (watermarkRead.status !== 'ready') return watermarkRead;
  const watermark = watermarkRead.value;
  const { projectId, workspaceId } = input.workspace;
  const items: NoticeItemV1[] = [];
  const after = input.after;
  // L4: a saved commit position reads the ordered part with the inclusive lower
  // bound; no saved position reads the ordered part from its start.
  const seenCursor: CommitCursor | null = after === undefined ? null : after.cursor;

  try {
    // ---- requeues: the ordered window -------------------------------------
    const requeueRecords: { record: EncodedRecord; since: CommitCursor }[] = [];
    for (const record of await readOrderedToEnd(records, S2A_REQUEUE_BY_PROJECT_LOOKUP, [projectId],
      seenCursor === null ? null : { value: seenCursor, inclusive: true }, orderedPageLimit)) {
      const since = orderedSince(record, seenCursor);
      if (!since.ok) return since.rejection;
      requeueRecords.push({ record, since: since.since });
    }

    const workspaceByGoal = await readGoalWorkspaces(records, requeueRecords.map(({ record }) => record));
    for (const { record, since } of requeueRecords) {
      const decoded = decodeTaskRequeueSnapshot(record);
      if (decoded.status !== 'decoded') return rejected('unavailable', `automatic rework requeue: ${decoded.reason}`);
      const requeue = decoded.value;
      if (requeue.ref.projectId !== projectId) continue;
      if (workspaceByGoal.get(goalKeyOf(projectId, requeue.ref.goalId)) !== workspaceId) continue;
      if (input.goalRef !== undefined && requeue.ref.goalId !== input.goalRef.goalId) continue;
      const actorClass = requeueActorClass(requeue);
      if (actorClass === 'human') continue;
      const itemKey = `automatic_rework:${canonicalJson(requeue.ref as unknown as JsonValue)}`;
      // §4.4 line 839/840: an interrupted (not counted) automatic requeue is a
      // RECOVERY, summarized with the saved exemption fact, never as a counted
      // "第 0 次" rework.
      const exempt = requeue.automation.automatic && !requeue.automation.counted;
      // L16（决定 55）：触发这次返工的那一轮 = 这条重新入队覆盖的轮次（没有就不加这一句）。
      const triggerCap = requeue.afterRoundRef === null
        ? { ok: true as const, hit: null }
        : await triggerRoundCapHit(records, requeue.afterRoundRef);
      if (!triggerCap.ok) return triggerCap.rejection;
      const cap = requeue.automation.cap;
      let summary: string;
      if (exempt) summary = recoverySummary(requeue.task);
      else {
        if (cap === null) return rejected('unavailable', `automatic rework requeue ${itemKey} has no automation cap`);
        summary = reworkSummary(requeue.task, requeue.automation.autoCount, cap);
      }
      items.push(withResourceCapHit({
        itemKey, category: 'automatic_rework',
        subject: { kind: 'goal', goalRef: { aggregateType: 'Goal', projectId: requeue.ref.projectId, goalId: requeue.ref.goalId } },
        position: noticePositionOf(since, itemKey),
        summary,
        objects: [],
        rework: { operation: 'requeue', actorClass, taskRef: requeue.task,
          count: requeue.automation.autoCount, cap: requeue.automation.cap, reason: requeue.reason,
          sourceRef: requeue.ref },
      }, triggerCap.hit));
    }

    // ---- reverify: the ordered index names the subject, the chain verifies -
    const subjectCandidates = new Map<string, SubjectCandidate>();
    for (const actorClass of ['system', 'agent'] as const) {
      for (const record of await readOrderedToEnd(records, S2A_ROUND_REVERIFY_LOOKUP, [projectId, workspaceId, actorClass],
        seenCursor === null ? null : { value: seenCursor, inclusive: true }, orderedPageLimit)) {
        const since = orderedSince(record, seenCursor);
        if (!since.ok) return since.rejection;
        const added = await addRoundCandidate(subjectCandidates, record, since.since, input, projectId, workspaceId);
        if (added !== null) return added;
      }
    }
    for (const subject of subjectCandidates.values()) {
      const chainRead = await readSubjectChain(records, projectId, workspaceId, subject);
      if (chainRead.status !== 'ready') return chainRead;
      const chain = roundChainHead(chainRead.rounds);
      if (chain.kind !== 'head') {
        return rejected('unavailable', `automatic rework round chain: ${chain.kind === 'invalid' ? chain.reason : 'empty'}`);
      }
      for (const [refKey, candidate] of subject.candidates) {
        const round = chainRead.byRef.get(refKey);
        if (round === undefined) {
          return rejected('unavailable', 'automatic rework round record is missing from its chain');
        }
        const reverify = round.chain?.reverify ?? null;
        if (reverify === null || (reverify.actorClass !== 'system' && reverify.actorClass !== 'agent')) continue;
        // L16（决定 55）：重新检查那条用轮次链里它接着的那一轮（链读里已有，不再多读）。
        const predecessorRef = round.chain?.predecessorRoundRef ?? null;
        if (predecessorRef === null) {
          return rejected('unavailable', `automatic rework reverify ${refKey} has no predecessor round`);
        }
        const predecessor = chainRead.byRef.get(canonicalJson(predecessorRef as unknown as JsonValue));
        if (predecessor === undefined) {
          return rejected('unavailable', `automatic rework predecessor round for ${refKey} is missing from its chain`);
        }
        const ordinal = round.chain?.ordinal ?? 0;
        const itemKey = `automatic_rework:${String(ordinal).padStart(4, '0')}:${refKey}`;
        const cap = candidate.cap;
        const count = round.chain?.autoCount ?? 0;
        const summary = reverify.exemption !== 'none'
          ? `自动恢复 · ${round.subject.taskId}（不计次）`
          : reworkSummary(round.subject, count, cap);
        items.push(withResourceCapHit({
          itemKey, category: 'automatic_rework',
          subject: { kind: 'goal', goalRef: { aggregateType: 'Goal', projectId: round.ref.projectId, goalId: round.ref.goalId } },
          position: noticePositionOf(candidate.since, itemKey),
          summary, objects: [],
          rework: { operation: 'reverify', actorClass: reverify.actorClass, taskRef: round.subject,
            count, cap, reason: reverify.reason ?? '', sourceRef: round.ref },
        }, firstResourceCapHitOf(predecessor)));
      }
    }
  } catch (error) {
    return storeFailureToRejection(error as { code: string; reason: string });
  }

  items.sort((left, right) => {
    const byPosition = compareNoticePositions(left.position, right.position);
    return byPosition !== 0 ? byPosition : (left.itemKey < right.itemKey ? -1 : left.itemKey > right.itemKey ? 1 : 0);
  });
  const remaining = after === undefined ? items : items.filter((item) => compareNoticePositions(item.position, after) > 0);
  const assembled: AssembledReworkPage = { watermark, remaining };
  cache?.set(cacheKey, assembled);
  return paginateAssembled(assembled, input);
}

/** L11/P1: what one window attempt assembled, shared by its internal pages. */
type AssembledReworkPage = { watermark: CommitCursor | null; remaining: NoticeItemV1[] };

/** L11/P1: the attempt cache key — workspace + goal + category, no cross-talk. */
function attemptCacheKey(input: ReadPageInput): string {
  return canonicalJson({
    category: 'automatic_rework',
    projectId: input.workspace.projectId,
    workspaceId: input.workspace.workspaceId,
    goalId: input.goalRef?.goalId ?? null,
  } as unknown as JsonValue);
}

/** Serves one page of an already-assembled (and `after`-filtered) collection. */
function paginateAssembled(assembled: AssembledReworkPage, input: ReadPageInput): {
  status: 'ready'; value: DecisionSourcePageV1<NoticeItemV1>;
} {
  const offset = input.page.cursor === undefined ? 0 : Number(input.page.cursor);
  const start = Number.isSafeInteger(offset) && offset >= 0 ? offset : 0;
  const limit = Number.isSafeInteger(input.page.limit) && input.page.limit > 0 ? input.page.limit : 50;
  const end = Math.min(assembled.remaining.length, start + limit);
  return { status: 'ready', value: {
    availability: 'available',
    items: assembled.remaining.slice(start, end),
    nextCursor: end < assembled.remaining.length ? String(end) : null,
    sourceCursor: assembled.watermark,
  } };
}

/** One subject's chain candidates, keyed by the exact round refKey. */
type SubjectCandidate = {
  projectId: string;
  goalId: string;
  taskId: string;
  runId: string;
  candidates: Map<string, { since: CommitCursor; cap: number }>;
};

function goalKeyOf(projectId: string, goalId: string): string {
  return canonicalJson({ aggregateType: 'Goal', projectId, goalId } as unknown as JsonValue);
}

/**
 * L4: read each requeue's Goal directly and map its refKey to the Goal's
 * workspace, regardless of the Goal's current lifecycle state. `readMany`
 * misses and damaged Goals are read failures.
 */
async function readGoalWorkspaces(
  records: DecisionReadRecordsPort,
  requeues: readonly EncodedRecord[],
): Promise<Map<string, string>> {
  const keys = new Set<string>();
  for (const record of requeues) {
    const decoded = decodeTaskRequeueSnapshot(record);
    if (decoded.status !== 'decoded') continue;
    keys.add(goalKeyOf(decoded.value.ref.projectId, decoded.value.ref.goalId));
  }
  const result = new Map<string, string>();
  for (const key of keys) {
    const read = await records.readMany([key]);
    if (read.status !== 'ready') throw read;
    const record = read.value.records.find((candidate) => candidate.refKey === key);
    if (record === undefined) throw { code: 'unavailable', reason: `automatic rework Goal ${key} is missing` };
    const decoded = decodeGoalSnapshot(record);
    if (decoded.status !== 'decoded') throw { code: 'unavailable', reason: `automatic rework Goal ${key}: ${decoded.reason}` };
    result.set(key, decoded.value.workspaceRef.workspaceId);
  }
  return result;
}

/** Decodes one ordered reverify candidate into its subject's candidate set. */
async function addRoundCandidate(
  subjects: Map<string, SubjectCandidate>,
  record: EncodedRecord,
  since: CommitCursor,
  input: ReadPageInput,
  projectId: string,
  workspaceId: string,
): Promise<{ status: 'rejected'; code: 'unavailable'; reason: string } | null> {
  const decoded = decodeVerificationRoundSnapshot(record);
  if (decoded.status !== 'decoded') return rejected('unavailable', `automatic rework round: ${decoded.reason}`);
  const round = decoded.value;
  if (round.ref.projectId !== projectId || round.ref.workspaceId !== workspaceId) return null;
  if (input.goalRef !== undefined && round.ref.goalId !== input.goalRef.goalId) return null;
  const subjectKey = canonicalJson({ projectId: round.ref.projectId, goalId: round.ref.goalId,
    taskId: round.ref.taskId, runId: round.ref.runId } as unknown as JsonValue);
  const subject: SubjectCandidate = subjects.get(subjectKey) ?? { projectId: round.ref.projectId,
    goalId: round.ref.goalId, taskId: round.ref.taskId, runId: round.ref.runId, candidates: new Map() };
  const refKey = canonicalJson(round.ref as unknown as JsonValue);
  const capRead = decodeCapOf(record);
  if (!capRead.ok) return capRead.rejection;
  subject.candidates.set(refKey, { since, cap: capRead.cap });
  subjects.set(subjectKey, subject);
  return null;
}

/**
 * The creation-time cap reads through `decodeNoticeOrigin`. Every automatic
 * successor carries `noticeAutomationCap`; a missing cap or an origin that
 * cannot be decoded (for example the persisted `since: null` PreparedCommit
 * placeholder) is a read failure, never a silent `null` cap.
 */
function decodeCapOf(record: EncodedRecord):
  { ok: true; cap: number } | { ok: false; rejection: { status: 'rejected'; code: 'unavailable'; reason: string } } {
  const origin = decodeNoticeOrigin(record);
  if (origin.status !== 'decoded') {
    return { ok: false, rejection: rejected('unavailable', `automatic rework round origin: ${origin.reason}`) };
  }
  const cap = origin.value.noticeAutomationCap;
  if (cap === undefined) {
    return { ok: false, rejection: rejected('unavailable', `automatic rework round origin ${record.refKey} has no automation cap`) };
  }
  return { ok: true, cap };
}

/** Reads and revalidates one subject's whole chain (domain limit stays, L10). */
async function readSubjectChain(
  records: DecisionReadRecordsPort,
  projectId: string,
  workspaceId: string,
  subject: SubjectCandidate,
): Promise<{ status: 'ready'; rounds: RoundSnapshot[]; byRef: Map<string, RoundSnapshot> }
  | { status: 'rejected'; code: 'unavailable' | 'incomplete'; reason: string }> {
  const result = await records.lookup({
    index: VERIFICATION_ROUND_ORIGINAL_LOOKUP,
    values: [projectId, workspaceId, subject.goalId, subject.taskId, subject.runId],
    limit: VERIFICATION_ROUND_CHAIN_LOOKUP_LIMIT,
  });
  if (result.status !== 'ready') {
    if (result.code === 'unsupported') return { status: 'rejected', code: 'unavailable', reason: 'the round chain index is not registered' };
    return { status: 'rejected', code: 'unavailable', reason: `automatic rework round chain is not readable: ${result.code}: ${result.reason}` };
  }
  if (result.value.next !== null) {
    return { status: 'rejected', code: 'incomplete', reason: 'automatic rework round chain is longer than the chain limit' };
  }
  const rounds: RoundSnapshot[] = [];
  const byRef = new Map<string, RoundSnapshot>();
  for (const record of result.value.records) {
    const decoded = decodeVerificationRoundSnapshot(record);
    if (decoded.status !== 'decoded') return { status: 'rejected', code: 'unavailable', reason: `automatic rework round: ${decoded.reason}` };
    const round = decoded.value;
    // The subject is the round ref minus `roundId`; `subjectRunRef` omits
    // `taskId`, so compare the parts the round ref carries.
    const subjectMatches = round.subjectRunRef.projectId === projectId
      && round.subjectRunRef.goalId === subject.goalId
      && round.subjectRunRef.runId === subject.runId
      && round.subject.taskId === subject.taskId;
    if (!subjectMatches) {
      return { status: 'rejected', code: 'unavailable',
        reason: `round ${round.ref.roundId} does not belong to Run ${subject.runId}` };
    }
    rounds.push(round);
    byRef.set(canonicalJson(round.ref as unknown as JsonValue), round);
  }
  return { status: 'ready', rounds, byRef };
}

/** §4.4: system and agent requeues share one notice stream; human is never listed. */
function requeueActorClass(requeue: TaskRequeueSnapshotV1): 'human' | 'system' | 'agent' {
  if (requeue.requestedBy.kind === 'agent') return 'agent';
  return requeue.automation.automatic ? 'system' : 'human';
}

/** L16：这一轮里第一项（按 `checkId` 排）带 `resourceCapHit` 的检查；没有就是 `null`。 */
function firstResourceCapHitOf(round: RoundSnapshot): { memory: 'cap_hit'; memoryCapMiB: number } | null {
  const hits = round.checks.filter((check) => check.resourceCapHit !== undefined);
  if (hits.length === 0) return null;
  hits.sort((left, right) => left.checkId < right.checkId ? -1 : left.checkId > right.checkId ? 1 : 0);
  return hits[0]!.resourceCapHit!;
}

/**
 * L16：重新入队那条按 `TaskRequeue.afterRoundRef` 按键读一次轮次。读失败、记录缺失和
 * 解码失败都按请知悉现有的读失败处理（`unavailable`），不当成“没有”。
 */
async function triggerRoundCapHit(
  records: DecisionReadRecordsPort,
  ref: VerificationRoundRef,
): Promise<{ ok: true; hit: { memory: 'cap_hit'; memoryCapMiB: number } | null }
  | { ok: false; rejection: { status: 'rejected'; code: 'unavailable'; reason: string } }> {
  const key = canonicalJson(ref as unknown as JsonValue);
  const read = await records.readMany([key]);
  if (read.status !== 'ready') throw read;
  const record = read.value.records.find((candidate) => candidate.refKey === key);
  if (record === undefined) {
    return { ok: false, rejection: rejected('unavailable', `automatic rework trigger round ${key} is missing`) };
  }
  const decoded = decodeVerificationRoundSnapshot(record);
  if (decoded.status !== 'decoded') {
    return { ok: false, rejection: rejected('unavailable', `automatic rework trigger round: ${decoded.reason}`) };
  }
  return { ok: true, hit: firstResourceCapHitOf(decoded.value) };
}

/** L16：有命中就在今天那一句后加“检查超出内存上限（当时上限 N MiB）”，并加操作。 */
function withResourceCapHit(
  item: NoticeItemV1,
  hit: { memory: 'cap_hit'; memoryCapMiB: number } | null,
): NoticeItemV1 {
  if (hit === null) return item;
  return { ...item, summary: `${item.summary} · 检查超出内存上限（当时上限 ${String(hit.memoryCapMiB)} MiB）`,
    actions: [{ kind: 'raise_memory_cap' }] };
}

function noticePositionOf(since: CommitCursor, itemKey: string): NoticeItemV1['position'] {
  return { kind: 'commit', cursor: since, itemKey };
}

function reworkSummary(task: TaskTriple, count: number, cap: number): string {
  return `自动返工 · ${task.taskId} · 第 ${count} 次（${count}/${cap}）`;
}

/** §4.4 line 840: the exempt automatic recovery label, without a count. */
function recoverySummary(task: TaskTriple): string {
  return `自动恢复 · ${task.taskId}（不计次）`;
}
