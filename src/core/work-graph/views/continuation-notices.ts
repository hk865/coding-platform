/**
 * The `continuation` "请知悉" source: the fact that work interrupted earlier is
 * actually being continued by a new Run.
 *
 * A notice row must name a Run that was requeued and actually entered
 * (`requeueRef` and a `startedSince` commit), whose saved continuation brief
 * says `mode: 'resume_after_interruption'` (same Session or a new one).
 * The predecessor Run the brief points at is read through the same Run decoder;
 * a RUN-25 takeover closure keeps the existing `automatic_rework` "自动恢复"
 * line (K3, `slice-K3-SPEC.md:652`) and is never repeated here.
 *
 * The source follows the other notice sources: the workspace Run status index is
 * read to the end, the saved seen position is the `after` filter, the stable
 * window watermark is `sourceCursor`, and the paging/cache/position rules are the
 * existing `lookupAll`, `atLeastCursorResult`/`compareNoticePositions` pair and
 * the read model's per-attempt cache. It never writes, schedules work or reads a
 * clock. A missing or corrupt required predecessor Run, and a thrown read, fail
 * loud as `unavailable`; the Runtime brief read's own classification is passed
 * through unchanged, and a failed read is never an empty page.
 */
import type { CommitCursor } from '../../../contracts/command-event.js';
import type { CoreCallContext } from '../../../contracts/core/call-context.js';
import type { ReadResult } from '../../../contracts/core/results.js';
import type { ContinuationBriefV1 } from '../../../contracts/continuation-brief.js';
import type { RunRef, RunStatus } from '../../../contracts/dispatch.js';
import { canonicalJson, type JsonValue } from '../../../contracts/fingerprint.js';
import { rejected } from '../../../contracts/core/rejections.js';
import type {
  DecisionNoticeSourcePort, DecisionSourcePageV1, NoticeItemV1,
} from '../model/decision-contracts.js';
import { decodeRun } from '../persistence/run-record-codecs.js';
import { lookupAll } from '../persistence/lookup-all.js';
import { atLeastCursorResult, storeFailureToRejection } from '../persistence/read-result-failures.js';
import { RUN_BY_WORKSPACE_STATUS_INDEX } from '../tasks/plan-readers.js';
import { compareNoticePositions } from './notice-position.js';
import { paginateAssembled } from './automatic-rework-notices.js';
import type { DecisionReadRecordsPort } from './goal-conflicts.js';
import { readWatermark } from './goal-conflicts.js';

export type ContinuationNoticeSourceDependencies = {
  records: DecisionReadRecordsPort;
  /**
   * The existing Runtime read of the saved continuation brief. The composition
   * passes a delayed callback to its wrapped Runtime port, never a second brief
   * builder.
   */
  readBrief(ctx: CoreCallContext, input: { runRef: RunRef }):
    Promise<ReadResult<{ brief: ContinuationBriefV1; digest: string } | null>>;
};

/** The three Run states the status index is read through, each to the end. */
const RUN_STATUSES: readonly RunStatus[] = ['starting', 'running', 'ended'];

/** Builds the `continuation` notice source; the factory itself never reads. */
export function createContinuationNoticeSource(
  deps: ContinuationNoticeSourceDependencies,
): DecisionNoticeSourcePort {
  return {
    category: 'continuation',
    async readPage(ctx, input): Promise<ReadResult<DecisionSourcePageV1<NoticeItemV1>>> {
      if (ctx.principal.kind !== 'host') {
        return rejected('forbidden', 'the continuation notice source requires a Host call context');
      }
      if (ctx.signal.aborted) {
        return rejected('cancelled', 'the continuation notice read was cancelled');
      }
      try {
        const watermarkRead = await readWatermark(deps.records);
        if (watermarkRead.status !== 'ready') return watermarkRead;
        const notReady = atLeastCursorResult<DecisionSourcePageV1<NoticeItemV1>>(
          watermarkRead.value, input.page.atLeastCursor);
        if (notReady !== null) return notReady;

        // One assembly per window attempt; the read model drops the attempt with
        // its cache, so no page survives into a later call.
        const cache = input.page.attempt?.cache;
        const cacheKey = canonicalJson({
          category: 'continuation',
          projectId: input.workspace.projectId,
          workspaceId: input.workspace.workspaceId,
          goalId: input.goalRef?.goalId ?? null,
        } as unknown as JsonValue);
        let watermark: CommitCursor | null = watermarkRead.value;
        let remaining: NoticeItemV1[];
        const cached = cache?.get(cacheKey) as
          { watermark: CommitCursor | null; remaining: NoticeItemV1[] } | undefined;
        if (cached !== undefined) {
          watermark = cached.watermark;
          remaining = cached.remaining;
        } else {
          const items: NoticeItemV1[] = [];
          for (const status of RUN_STATUSES) {
            const batch = await lookupAll(deps.records, RUN_BY_WORKSPACE_STATUS_INDEX,
              [input.workspace.projectId, input.workspace.workspaceId, status]);
            for (const record of batch.items) {
              const decoded = decodeRun(record);
              if (!decoded.ok) {
                return rejected('unavailable', `a continuation Run is damaged: ${decoded.reason}`);
              }
              const run = decoded.value;
              if (run.ref.projectId !== input.workspace.projectId
                || run.workspaceSnapshot.workspaceId !== input.workspace.workspaceId) continue;
              // A requeue that never entered Kernel produced no execution to
              // continue; a Run without a requeue (ordinary successor or Goal
              // restart) is not this fact.
              if (run.requeueRef === undefined || run.startedSince === null) continue;
              if (input.goalRef !== undefined
                && (run.ref.projectId !== input.goalRef.projectId || run.ref.goalId !== input.goalRef.goalId)) continue;

              const briefRead = await deps.readBrief(ctx, { runRef: run.ref });
              if (briefRead.status !== 'ready') return briefRead;
              if (briefRead.value === null) {
                return rejected('unavailable',
                  `the requeue Run ${run.ref.runId} has no continuation brief`);
              }
              // Only the interruption class is this fact; ordinary rework is not.
              if (briefRead.value.brief.mode !== 'resume_after_interruption') continue;

              const previousRef = briefRead.value.brief.previous.runRef;
              const previousKey = canonicalJson(previousRef as unknown as JsonValue);
              const previousRead = await deps.records.readMany([previousKey]);
              if (previousRead.status !== 'ready') return storeFailureToRejection(previousRead);
              const previousRecord = previousRead.value.records
                .find((candidate) => candidate.refKey === previousKey);
              if (previousRecord === undefined) {
                return rejected('unavailable', `the continuation predecessor Run ${previousKey} is missing`);
              }
              const previousDecoded = decodeRun(previousRecord);
              if (!previousDecoded.ok) {
                return rejected('unavailable',
                  `the continuation predecessor Run is damaged: ${previousDecoded.reason}`);
              }
              const previous = previousDecoded.value;
              // K3: a RUN-25 takeover closure is the automatic recovery already
              // reported by the `automatic_rework` source; it is not repeated.
              if (previous.reconciliation?.observation.kind === 'takeover_unresolved') continue;

              const itemKey = `continuation:${canonicalJson(run.ref as unknown as JsonValue)}`;
              items.push({
                itemKey,
                category: 'continuation',
                subject: { kind: 'goal',
                  goalRef: { aggregateType: 'Goal', projectId: run.ref.projectId, goalId: run.ref.goalId } },
                position: { kind: 'commit', cursor: run.startedSince, itemKey },
                summary: `接续 · ${run.task.taskId}（中断后接着做）`,
                objects: [
                  { kind: 'aggregate', pin: { ref: previous.ref, revision: previous.revision }, label: '上一次执行' },
                  { kind: 'aggregate', pin: { ref: run.ref, revision: run.revision }, label: '这次执行' },
                ],
                rework: null,
              });
            }
          }
          items.sort((left, right) => compareNoticePositions(left.position, right.position));
          const after = input.after;
          remaining = after === undefined ? items
            : items.filter((item) => compareNoticePositions(item.position, after) > 0);
          cache?.set(cacheKey, { watermark, remaining });
        }

        return paginateAssembled({ watermark, remaining }, input);
      } catch (error) {
        return storeFailureToRejection(error);
      }
    },
  };
}
