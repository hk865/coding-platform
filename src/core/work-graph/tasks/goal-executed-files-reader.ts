/**
 * Slice 2B L13: the real `GoalExecutedFilesPort`, replacing the slice-5 stub
 * (`executed-files-stub.ts`). The DTO and algorithm are the frozen slice-5
 * contract; only the implementation changes.
 *
 * Reads one Goal's Runs through the existing by-Goal index and its
 * `RunActivity` records through `s2b-run-activity-by-goal-last`, both paged to
 * the very end, then joins them in memory (no per-Run keyed read) and
 * classifies each Run exactly as L7 does. It never applies
 * `ACTIVITY_READ_RECORD_CAP`: the port has no time window, its consumer (the
 * decision queue) must not be refused because history is large, and its read
 * cost is measured in spec §7. Any storage read failure is returned as the
 * failure, never as an empty/complete answer.
 */
import type { CommitCursor } from '../../../contracts/command-event.js';
import type { CoreCallContext } from '../../../contracts/core/call-context.js';
import type { CoreRejection, ReadResult } from '../../../contracts/core/results.js';
import type { RunRef, RunSnapshot } from '../../../contracts/dispatch.js';
import type { GoalRef } from '../../../contracts/ledger.js';
import { canonicalJson, type JsonValue } from '../../../contracts/fingerprint.js';
import type { ActivityRecordingSnapshot, RunActivitySnapshot } from '../../../contracts/run-activity.js';
import { provenNotEnteredKernel } from '../../../contracts/run-activity.js';
import type { EncodedRecord, GoalRecordTransactionPort, RecordGuard } from '../../record-store/ports.js';
import type { RecordLookupPort, RecordOrderedLookupPort } from '../../record-store/lookup-ports.js';
import type { GoalExecutedFilesPort } from '../model/decision-contracts.js';
import { decodeGoalSnapshot } from '../persistence/record-codecs.js';
import { decodeRun } from '../materials/run-snapshot-decoder.js';
import {
  atLeastCursorResult, storeFailureToRejection,
} from '../persistence/read-result-failures.js';
import {
  decodeActivityRecordingSnapshot,
  decodeRunActivitySnapshot,
  S2B_RUN_ACTIVITY_BY_GOAL_LAST_LOOKUP,
} from './run-activity-codecs.js';

/**
 * The existing by-Goal Run index (`plan-readers.ts`). It is not exported by the
 * plan owner and this slice does not change `plan-readers.ts`, so the id is
 * repeated here exactly as the frozen registration spells it.
 */
const RUN_BY_GOAL_INDEX = 'r3c-run-by-goal';
const PAGE_LIMIT = 200;

/** The three storage seams L13 builds on (spec §2). */
export type GoalExecutedFilesReaderRecords =
  Pick<GoalRecordTransactionPort, 'readMany'> & RecordLookupPort & RecordOrderedLookupPort;

function unavailable(reason: string): CoreRejection {
  return { status: 'rejected', code: 'unavailable', reason };
}

function refKeyOf(value: object): string {
  return canonicalJson(value as unknown as JsonValue);
}

function byteOrder(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

/** The exact DTO the frozen slice-5 port returns (spec §2 `GoalExecutedFilesPort`). */
type GoalExecutedFilesValue = {
  availability: 'available' | 'not_available';
  files: { runRef: RunRef; path: string; certainty: 'definite' | 'possible' }[];
  possiblyIncomplete: boolean;
  guards: readonly RecordGuard[];
  sourceCursor: CommitCursor | null;
};

/**
 * Builds the real executed-files reader (spec §2). `records` is the shared
 * `backend.records`, which implements all three ports on both stores.
 */
export function createGoalExecutedFilesReader(
  deps: { records: GoalExecutedFilesReaderRecords },
): GoalExecutedFilesPort {
  const records = deps.records;

  return {
    async readGoalExecutedFiles(ctx, input): Promise<ReadResult<GoalExecutedFilesValue>> {
      const goalRef: GoalRef = input.goalRef;
      if (goalRef === null || typeof goalRef !== 'object' || goalRef.aggregateType !== 'Goal'
        || goalRef.projectId !== ctx.projectId) {
        return { status: 'rejected', code: 'forbidden',
          reason: 'the requested goal is outside the bound call scope' };
      }

      // The Goal's workspace is needed for the ActivityRecording (L7) and the
      // record key is the canonical ref; a missing Goal is a real `not_found`.
      let goalRecord: EncodedRecord | undefined;
      try {
        const read = await records.readMany([refKeyOf(goalRef)]);
        if (read.status !== 'ready') return storeFailureToRejection(read);
        goalRecord = read.value.records.find((candidate) => candidate.refKey === refKeyOf(goalRef));
      } catch (error) {
        return storeFailureToRejection(error as { code: string; reason: string });
      }
      if (goalRecord === undefined) return { status: 'not_found' };
      const goalDecoded = decodeGoalSnapshot(goalRecord);
      if (goalDecoded.status !== 'decoded') {
        return unavailable(`the Goal ${goalRef.goalId}: ${goalDecoded.reason}`);
      }
      const workspaceId = goalDecoded.value.workspaceRef.workspaceId;
      // R4: the Goal names its own workspace; the caller is bound to
      // `ctx.workspaceId`. A same-project Goal in another workspace is
      // `forbidden` before any of its Runs or RunActivity records is read.
      if (workspaceId !== ctx.workspaceId) {
        return { status: 'rejected', code: 'forbidden', reason: 'the goal belongs to another workspace' };
      }

      try {
        // 1. This Goal's Runs, paged to the end through the existing by-Goal index.
        const runs: RunSnapshot[] = [];
        let runAfter: string | undefined;
        for (;;) {
          const page = await records.lookup({ index: RUN_BY_GOAL_INDEX,
            values: [goalRef.projectId, goalRef.goalId], limit: PAGE_LIMIT,
            ...(runAfter === undefined ? {} : { after: runAfter }) });
          if (page.status !== 'ready') return storeFailureToRejection(page);
          for (const record of page.value.records) {
            const decoded = decodeRun(record);
            if (!decoded.ok) return unavailable(`Run record ${record.refKey}: ${decoded.reason}`);
            if (decoded.value.ref.goalId === goalRef.goalId) runs.push(decoded.value);
          }
          const next = page.value.next;
          if (next === null) break;
          runAfter = next;
        }

        // 2. This Goal's RunActivity records, paged to the end.
        const activities = new Map<string, RunActivitySnapshot>();
        let activityAfter: { order: string | number; refKey: string } | undefined;
        for (;;) {
          const page = await records.lookupOrdered({ index: S2B_RUN_ACTIVITY_BY_GOAL_LAST_LOOKUP,
            values: [goalRef.projectId, goalRef.goalId], direction: 'asc', limit: PAGE_LIMIT,
            ...(activityAfter === undefined ? {} : { after: activityAfter }) });
          if (page.status !== 'ready') return storeFailureToRejection(page);
          for (const record of page.value.records) {
            const decoded = decodeRunActivitySnapshot(record);
            if (decoded.status !== 'decoded') {
              return unavailable(`RunActivity record ${record.refKey}: ${decoded.reason}`);
            }
            activities.set(decoded.value.runRef.runId, decoded.value);
          }
          const next = page.value.next;
          if (next === null) break;
          activityAfter = next;
        }

        // 3. The workspace ActivityRecording (L7's classification epoch), once.
        let recording: ActivityRecordingSnapshot | null = null;
        const recordingKey = refKeyOf({ aggregateType: 'ActivityRecording',
          projectId: goalRef.projectId, workspaceId });
        const recordingRead = await records.readMany([recordingKey]);
        if (recordingRead.status !== 'ready') return storeFailureToRejection(recordingRead);
        const recordingRecord = recordingRead.value.records.find((candidate) => candidate.refKey === recordingKey);
        if (recordingRecord !== undefined) {
          const decoded = decodeActivityRecordingSnapshot(recordingRecord);
          if (decoded.status !== 'decoded') {
            return unavailable(`ActivityRecording ${recordingRecord.refKey}: ${decoded.reason}`);
          }
          recording = decoded.value;
        }
        const since = recording === null ? null : recording.since;

        // 4. L13's join + classification, in runId byte order.
        const ordered = [...runs].sort((left, right) => byteOrder(left.ref.runId, right.ref.runId));
        const files: GoalExecutedFilesValue['files'] = [];
        let possiblyIncomplete = false;
        for (const run of ordered) {
          const activity = activities.get(run.ref.runId);
          if (activity === undefined) {
            // R5 (L7): only an ENDED Run can prove it never entered. An active
            // `starting`/`running` Run is always incomplete, even when its
            // authorization phase is `authorized`.
            if (run.status === 'starting' || run.status === 'running') {
              possiblyIncomplete = true;
              continue;
            }
            // Proven-not-entered gives no files and is not incomplete; every
            // other missing-record case is incomplete.
            if (!provenNotEnteredKernel(run, since)) possiblyIncomplete = true;
            continue;
          }
          if (activity.facts.status === 'unknown') {
            possiblyIncomplete = true;
            continue;
          }
          const changed = activity.facts.changedFiles;
          if (changed.possiblyIncomplete) possiblyIncomplete = true;
          const definite = changed.definite.filter((path) => path !== '.').sort(byteOrder);
          const possible = changed.possible.filter((path) => path !== '.').sort(byteOrder);
          for (const path of definite) files.push({ runRef: run.ref, path, certainty: 'definite' });
          for (const path of possible) files.push({ runRef: run.ref, path, certainty: 'possible' });
        }

        // 5. The read watermark (the port's `sourceCursor`) and `atLeastCursor`.
        const watermarkRead = await records.readMany([]);
        if (watermarkRead.status !== 'ready') return storeFailureToRejection(watermarkRead);
        const sourceCursor = watermarkRead.value.readThrough;
        const readiness = atLeastCursorResult<GoalExecutedFilesValue>(sourceCursor, input.atLeastCursor);
        if (readiness !== null) return readiness;

        return { status: 'ready', value: {
          availability: 'available', files, possiblyIncomplete, guards: [], sourceCursor,
        } };
      } catch (error) {
        return storeFailureToRejection(error as { code: string; reason: string });
      }
    },
  };
}
