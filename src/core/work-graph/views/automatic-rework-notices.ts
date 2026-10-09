/**
 * Slice 5 §4.4/F44: the automatic requeue/reverify "please be aware" projector.
 *
 * One `DecisionNoticeSourcePort` for category `automatic_rework`. It reads the
 * real TaskRequeue records of the workspace's ended Runs and the WHOLE
 * verification round chain (not just the failure head), keeps only system/agent
 * rework, deduplicates by the exact `TaskRequeueRef`/`VerificationRoundRef`, and
 * projects the frozen `自动返工 · …` summary with the creation-time cap (`null`
 * when the old wire had no `noticeAutomationCap`). It never schedules work,
 * wakes an agent or writes a Notification.
 */
import type { CommitCursor } from '../../../contracts/command-event.js';
import type { CoreCallContext } from '../../../contracts/core/call-context.js';
import type { ReadResult } from '../../../contracts/core/results.js';
import type { TaskRequeueSnapshotV1 } from '../../../contracts/task-requeue.js';
import type { RoundSnapshot } from '../../../contracts/verification.js';
import type { TaskTriple } from '../../../contracts/dispatch.js';
import { canonicalJson, type JsonValue } from '../../../contracts/fingerprint.js';
import type { EncodedRecord } from '../../record-store/ports.js';
import type {
  DecisionNoticeSourcePort,
  DecisionSourcePageV1,
  NoticeItemV1,
} from '../model/decision-contracts.js';
import { decodeNoticeOrigin } from '../persistence/decision-record-codecs.js';
import { decodeVerificationRoundSnapshot, VERIFICATION_ROUND_BY_STATUS_LOOKUP } from '../persistence/evidence-record-codecs.js';
import { decodeRun } from '../materials/run-snapshot-decoder.js';
import { decodeTaskRequeueSnapshot, taskRequeueRefKey } from '../tasks/claim-record-codecs.js';
import { RUN_BY_WORKSPACE_STATUS_INDEX } from '../tasks/plan-readers.js';
import { roundChainHead } from '../state/verification-machine.js';
import { compareNoticePositions } from './notice-position.js';
import type { DecisionReadRecordsPort } from './goal-conflicts.js';
import { lookupAll, readWatermark, storeFailureToRejection } from './goal-conflicts.js';

/** The read-only RecordStore seam; the rework/round codecs decode the facts. */
export type AutomaticReworkNoticeSourceDependencies = {
  records: DecisionReadRecordsPort;
};

/** Builds the `automatic_rework` notice source; the factory itself never throws. */
export function createAutomaticReworkNoticeSource(
  deps: AutomaticReworkNoticeSourceDependencies,
): DecisionNoticeSourcePort {
  return {
    category: 'automatic_rework',
    async readPage(ctx, input): Promise<ReadResult<DecisionSourcePageV1<NoticeItemV1>>> {
      return readAutomaticReworkPage(deps.records, ctx, input);
    },
  };
}

type ReadPageInput = {
  workspace: { projectId: string; workspaceId: string };
  goalRef?: { aggregateType: 'Goal'; projectId: string; goalId: string };
  after?: NoticeItemV1['position'];
  page: { limit: number; cursor?: string; atLeastCursor?: unknown };
};

async function readAutomaticReworkPage(
  records: DecisionReadRecordsPort,
  _ctx: CoreCallContext,
  input: ReadPageInput,
): Promise<ReadResult<DecisionSourcePageV1<NoticeItemV1>>> {
  const watermarkRead = await readWatermark(records);
  if (watermarkRead.status !== 'ready') return watermarkRead;
  const watermark = watermarkRead.value;
  const { projectId, workspaceId } = input.workspace;
  const items: NoticeItemV1[] = [];

  try {
    // ---- requeues: every ended Run can own the one TaskRequeue of its Task ---
    const runs = await lookupAll(records, RUN_BY_WORKSPACE_STATUS_INDEX, [projectId, workspaceId, 'ended']);
    // §4.1 line 772 / T-R2-3 (lead LR4): an overflowing index window is `capacity`,
    // never a silently shorter notice list.
    if (runs.truncated) {
      return { status: 'rejected', code: 'capacity', reason: 'the ended-Run window of the automatic rework notices exceeded its whole read window' };
    }
    const requeueKeys = new Set<string>();
    for (const record of runs.items) {
      const decoded = decodeRun(record);
      if (!decoded.ok) return { status: 'rejected', code: 'unavailable', reason: `automatic rework Run: ${decoded.reason}` };
      const run = decoded.value;
      if (run.ref.projectId !== projectId || run.task.projectId !== projectId) continue;
      if (input.goalRef !== undefined && run.ref.goalId !== input.goalRef.goalId) continue;
      requeueKeys.add(taskRequeueRefKey({ aggregateType: 'TaskRequeue', projectId,
        goalId: run.ref.goalId, taskId: run.task.taskId, afterRunId: run.ref.runId }));
    }
    for (const record of await readMany(records, [...requeueKeys])) {
      const origin = decodeNoticeOrigin(record);
      if (origin.status !== 'decoded') {
        return { status: 'rejected', code: 'unavailable', reason: `automatic rework origin: ${origin.reason}` };
      }
      const decoded = decodeTaskRequeueSnapshot(record as EncodedRecord);
      if (decoded.status !== 'decoded') {
        return { status: 'rejected', code: 'unavailable', reason: `automatic rework requeue: ${decoded.reason}` };
      }
      const requeue = decoded.value;
      const actorClass = requeueActorClass(requeue);
      if (actorClass === 'human') continue;
      const itemKey = `automatic_rework:${canonicalJson(requeue.ref as unknown as JsonValue)}`;
      // §4.4 line 839/840: an interrupted (not counted) automatic requeue is a
      // RECOVERY, summarized with the saved exemption fact, never as a counted
      // "第 0 次" rework.
      const exempt = requeue.automation.automatic && !requeue.automation.counted;
      items.push({
        itemKey, category: 'automatic_rework',
        goalRef: { aggregateType: 'Goal', projectId: requeue.ref.projectId, goalId: requeue.ref.goalId },
        position: noticePositionOf(origin.value.since, itemKey, requeue.requestedAt),
        summary: exempt ? recoverySummary(requeue.task)
          : reworkSummary(requeue.task, requeue.automation.autoCount, requeue.automation.cap),
        objects: [],
        rework: { operation: 'requeue', actorClass, taskRef: requeue.task,
          count: requeue.automation.autoCount, cap: requeue.automation.cap, reason: requeue.reason,
          sourceRef: requeue.ref },
      });
    }

    // ---- reverify: the WHOLE round chain of every subject (not just the head) -
    const roundsBySubject = new Map<string, { rounds: RoundSnapshot[]; origins: Map<string, EncodedRecord> }>();
    for (const status of ['open', 'finalized'] as const) {
      const batch = await lookupAll(records, VERIFICATION_ROUND_BY_STATUS_LOOKUP, [projectId, workspaceId, status]);
      if (batch.truncated) {
        return { status: 'rejected', code: 'capacity', reason: `the ${status} verification-round window of the automatic rework notices exceeded its whole read window` };
      }
      for (const record of batch.items) {
        const origin = decodeNoticeOrigin(record);
        if (origin.status !== 'decoded') {
          return { status: 'rejected', code: 'unavailable', reason: `automatic rework round origin: ${origin.reason}` };
        }
        const decoded = decodeVerificationRoundSnapshot(record);
        if (decoded.status !== 'decoded') {
          return { status: 'rejected', code: 'unavailable', reason: `automatic rework round: ${decoded.reason}` };
        }
        const round = decoded.value;
        if (round.ref.projectId !== projectId || round.ref.workspaceId !== workspaceId) continue;
        if (input.goalRef !== undefined && round.ref.goalId !== input.goalRef.goalId) continue;
        const subjectKey = canonicalJson({ projectId: round.ref.projectId, goalId: round.ref.goalId,
          taskId: round.ref.taskId, runId: round.ref.runId });
        const group: { rounds: RoundSnapshot[]; origins: Map<string, EncodedRecord> } =
          roundsBySubject.get(subjectKey) ?? { rounds: [], origins: new Map() };
        group.rounds.push(round);
        group.origins.set(canonicalJson(round.ref as unknown as JsonValue), record);
        roundsBySubject.set(subjectKey, group);
      }
    }
    for (const group of roundsBySubject.values()) {
      const chain = roundChainHead(group.rounds);
      if (chain.kind !== 'head') {
        return { status: 'rejected', code: 'unavailable', reason: `automatic rework round chain: ${chain.kind === 'invalid' ? chain.reason : 'empty'}` };
      }
      for (const round of chain.chain.slice(1)) {
        const reverify = round.chain?.reverify ?? null;
        if (reverify === null || (reverify.actorClass !== 'system' && reverify.actorClass !== 'agent')) continue;
        const refKey = canonicalJson(round.ref as unknown as JsonValue);
        const record = group.origins.get(refKey);
        if (record === undefined) {
          return { status: 'rejected', code: 'unavailable', reason: 'automatic rework round record is missing' };
        }
        const origin = decodeNoticeOrigin(record);
        if (origin.status !== 'decoded') {
          return { status: 'rejected', code: 'unavailable', reason: `automatic rework round origin: ${origin.reason}` };
        }
        const ordinal = round.chain?.ordinal ?? 0;
        const itemKey = `automatic_rework:${String(ordinal).padStart(4, '0')}:${refKey}`;
        const cap = origin.value.noticeAutomationCap ?? null;
        const count = round.chain?.autoCount ?? 0;
        const summary = reverify.exemption !== 'none'
          ? `自动恢复 · ${round.subject.taskId}（不计次）`
          : reworkSummary(round.subject, count, cap);
        items.push({
          itemKey, category: 'automatic_rework',
          goalRef: { aggregateType: 'Goal', projectId: round.ref.projectId, goalId: round.ref.goalId },
          position: noticePositionOf(origin.value.since, itemKey, reverify.requestedAt),
          summary, objects: [],
          rework: { operation: 'reverify', actorClass: reverify.actorClass, taskRef: round.subject,
            count, cap, reason: reverify.reason ?? '', sourceRef: round.ref },
        });
      }
    }
  } catch (error) {
    return storeFailureToRejection(error as { code: string; reason: string });
  }

  items.sort((left, right) => {
    const byPosition = compareNoticePositions(left.position, right.position);
    return byPosition !== 0 ? byPosition : (left.itemKey < right.itemKey ? -1 : left.itemKey > right.itemKey ? 1 : 0);
  });
  const after = input.after;
  const remaining = after === undefined ? items : items.filter((item) => compareNoticePositions(item.position, after) > 0);
  const offset = input.page.cursor === undefined ? 0 : Number(input.page.cursor);
  const start = Number.isSafeInteger(offset) && offset >= 0 ? offset : 0;
  const limit = Number.isSafeInteger(input.page.limit) && input.page.limit > 0 ? input.page.limit : 50;
  const end = Math.min(remaining.length, start + limit);
  return { status: 'ready', value: {
    availability: 'available',
    items: remaining.slice(start, end),
    nextCursor: end < remaining.length ? String(end) : null,
    sourceCursor: watermark,
  } };
}

/** §4.4: system and agent requeues share one notice stream; human is never listed. */
function requeueActorClass(requeue: TaskRequeueSnapshotV1): 'human' | 'system' | 'agent' {
  if (requeue.requestedBy.kind === 'agent') return 'agent';
  return requeue.automation.automatic ? 'system' : 'human';
}

function noticePositionOf(since: CommitCursor | null | undefined, itemKey: string, occurredAt: string): NoticeItemV1['position'] {
  if (since === undefined || since === null) return { kind: 'legacy', occurredAt, itemKey };
  return { kind: 'commit', cursor: since, itemKey };
}

function reworkSummary(task: TaskTriple, count: number, cap: number | null): string {
  const capText = cap === null ? '上限未记录' : `${count}/${cap}`;
  return `自动返工 · ${task.taskId} · 第 ${count} 次（${capText}）`;
}

/** §4.4 line 840: the exempt automatic recovery label, without a count. */
function recoverySummary(task: TaskTriple): string {
  return `自动恢复 · ${task.taskId}（不计次）`;
}

async function readMany(records: DecisionReadRecordsPort, keys: readonly string[]): Promise<EncodedRecord[]> {
  if (keys.length === 0) return [];
  const read = await records.readMany(keys);
  if (read.status !== 'ready') throw read;
  return read.value.records;
}
