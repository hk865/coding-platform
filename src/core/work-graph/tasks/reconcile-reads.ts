/**
 * Start-up reconcile candidate reads (STATE-MACHINES-SPEC §12.1 steps 2, 4, 5,
 * 6 and 6b; A.2 step 5.6).
 *
 * The Host reconcile enumerates, per workspace it serves, the Runs in a live
 * status (`starting`/`running`, step 2 and the start-up re-drive), the unknown
 * ends (W-15, W-19), the Runs that still carry a queued intent (step 5), the
 * open rounds (step 4) and the Goals (step 6). Each set is bounded by open
 * work, never by the workspace's history: an ended Run is listed only while it
 * is unknown or still names a queued intent. These are candidate sets only:
 * every write re-reads its record and asks its machine. A damaged candidate is
 * reported, never skipped silently.
 */
import type { ControlIntentSnapshotV1 } from '../../../contracts/control-intent.js';
import type { CoreRejection, ReadResult } from '../../../contracts/core/results.js';
import type { RunRef, RunSnapshot } from '../../../contracts/dispatch.js';
import type { GoalSnapshot } from '../../../contracts/ledger.js';
import type { RecordLookupPort } from '../../record-store/lookup-ports.js';
import { CONTROL_BY_WORKSPACE_STATUS_INDEX, decodeControlIntentSnapshot } from '../persistence/control-record-codecs.js';
import { decodeGoalSnapshot } from '../persistence/record-codecs.js';
import type { RoundSnapshot } from '../../../contracts/verification.js';
import { VERIFICATION_ROUND_BY_STATUS_LOOKUP, decodeVerificationRoundSnapshot } from '../persistence/evidence-record-codecs.js';
import { GOAL_BY_WORKSPACE_INDEX, RUN_BY_WORKSPACE_OUTCOME_INDEX, RUN_BY_WORKSPACE_STATUS_INDEX } from './plan-readers.js';
import { decodeRun } from '../materials/run-snapshot-decoder.js';

/** One workspace's candidates: the decoded records and the refKeys that did not decode. */
export type ReconcileCandidates<T> = { records: T[]; damaged: string[] };

type Scope = { projectId: string; workspaceId: string };

export interface ReconcileCandidateReader {
  /** The Runs in a live status (`starting`, `running`). */
  listRuns(scope: Scope, status: 'starting' | 'running', signal: AbortSignal): Promise<ReadResult<ReconcileCandidates<RunSnapshot>>>;
  /** W-15, W-19: the Runs that ended `outcome_unknown`. */
  listUnknownRuns(scope: Scope, signal: AbortSignal): Promise<ReadResult<ReconcileCandidates<RunSnapshot>>>;
  /** §12.1 step 5: the Runs a queued ControlIntent names (deduplicated, in intent order). */
  listQueuedControlRuns(scope: Scope, signal: AbortSignal): Promise<ReadResult<ReconcileCandidates<RunRef>>>;
  listGoals(scope: Scope, signal: AbortSignal): Promise<ReadResult<ReconcileCandidates<GoalSnapshot>>>;
  /** §12.1 step 4: the open rounds, whose `executing` checks VR-04 interrupts. */
  listOpenRounds(scope: Scope, signal: AbortSignal): Promise<ReadResult<ReconcileCandidates<RoundSnapshot>>>;
}

const PAGE_LIMIT = 200;
/** A bounded scan: a workspace with more candidates is reported `capacity`, never truncated silently. */
const MAX_PAGES = 50;

function rejected(code: CoreRejection['code'], reason: string): CoreRejection {
  return { status: 'rejected', code, reason };
}
function runKeyOf(ref: RunRef): string { return `${ref.projectId}\u0000${ref.goalId}\u0000${ref.runId}`; }

export function createReconcileCandidateReader(deps: { records: RecordLookupPort }): ReconcileCandidateReader {
  async function scan<T>(index: string, values: readonly string[], signal: AbortSignal,
    decode: (record: Parameters<typeof decodeRun>[0]) => T | null): Promise<ReadResult<ReconcileCandidates<T>>> {
    const records: T[] = [];
    const damaged: string[] = [];
    let after: string | undefined;
    for (let page = 0; page < MAX_PAGES; page += 1) {
      if (signal.aborted) return rejected('cancelled', 'the reconcile candidate read was cancelled');
      const result = await deps.records.lookup({ index, values, limit: PAGE_LIMIT, ...(after === undefined ? {} : { after }) });
      if (result.status !== 'ready') return rejected('unavailable', `the reconcile candidate read failed: ${result.reason}`);
      for (const record of result.value.records) {
        const value = decode(record);
        if (value === null) damaged.push(record.refKey);
        else records.push(value);
      }
      if (result.value.next === null) return { status: 'ready', value: { records, damaged } };
      after = result.value.next;
    }
    return rejected('capacity', `the reconcile candidate read of ${index} exceeds ${String(MAX_PAGES * PAGE_LIMIT)} records`);
  }
  const runOf = (record: Parameters<typeof decodeRun>[0]): RunSnapshot | null => {
    const decoded = decodeRun(record);
    return decoded.ok ? decoded.value : null;
  };

  return {
    listRuns(scope, status, signal) {
      return scan(RUN_BY_WORKSPACE_STATUS_INDEX, [scope.projectId, scope.workspaceId, status], signal, runOf);
    },
    listUnknownRuns(scope, signal) {
      return scan(RUN_BY_WORKSPACE_OUTCOME_INDEX, [scope.projectId, scope.workspaceId, 'outcome_unknown'], signal, runOf);
    },
    async listQueuedControlRuns(scope, signal) {
      const intents = await scan<ControlIntentSnapshotV1>(CONTROL_BY_WORKSPACE_STATUS_INDEX,
        [scope.projectId, scope.workspaceId, 'queued'], signal, record => {
          const decoded = decodeControlIntentSnapshot(record);
          return decoded.status === 'decoded' ? decoded.value : null;
        });
      if (intents.status !== 'ready') return intents;
      const seen = new Set<string>();
      const runs: RunRef[] = [];
      for (const intent of intents.value.records) {
        const key = runKeyOf(intent.runRef);
        if (seen.has(key)) continue;
        seen.add(key);
        runs.push({ ...intent.runRef });
      }
      return { status: 'ready', value: { records: runs, damaged: intents.value.damaged } };
    },
    listGoals(scope, signal) {
      return scan(GOAL_BY_WORKSPACE_INDEX, [scope.projectId, scope.workspaceId], signal, record => {
        const decoded = decodeGoalSnapshot(record);
        return decoded.status === 'decoded' ? decoded.value : null;
      });
    },
    listOpenRounds(scope, signal) {
      return scan(VERIFICATION_ROUND_BY_STATUS_LOOKUP, [scope.projectId, scope.workspaceId, 'open'], signal, record => {
        const decoded = decodeVerificationRoundSnapshot(record);
        return decoded.status === 'decoded' ? decoded.value : null;
      });
    },
  };
}
