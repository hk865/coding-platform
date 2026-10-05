/**
 * B2 WG12 internal compile seam (implementation).
 *
 * Pure helper used by `execution-history-service.ts`. The locator update is
 * decided by RUN-06 (`state/run-machine.ts` `transitionRun` with
 * `history_recorded`, STATE-MACHINES-SPEC §6): the formal Run / claimed
 * SessionRef / Kernel session mapping / this observation against the fixed
 * identity, monotone watermark and write-once terminal end. The machine gives
 * the whole next Run and ONE `claim_kernel_slot` effect; this file encodes that
 * Run and translates the effect into the Kernel identity unique-slot change. It
 * owns no Store handle and performs no I/O.
 *
 * The Kernel unique slot may already be held by this Run's B2 fresh `begin`
 * even though `executionHistory` is still absent, so "no locator" must never be
 * mistaken for "no owner": RUN-06 reads the begin binding from the Run's V2
 * authorization and answers `self` (owner -> owner CAS) for it.
 */
import type { RunExecutionHistoryV1 } from '../../../contracts/core/execution-history.js';
import type { SessionRef } from '../../../contracts/core/identity.js';
import type { CoreRejection } from '../../../contracts/core/results.js';
import type { SessionRecord } from '../../../contracts/core/session.js';
import type { RunSnapshot } from '../../../contracts/dispatch.js';
import { canonicalJson, type JsonValue } from '../../../contracts/fingerprint.js';
import type { EncodedRecord, RecordGuard, UniqueClaimChange } from '../../record-store/ports.js';
import {
  runStateOf, transitionRun, type RunEffect, type RunGuardContext, type RunObservedHistory,
} from '../state/run-machine.js';

const RUN_SNAPSHOT_SCHEMA_ID = 'RunSnapshot@1';
const KERNEL_SLOT_PREFIX = 'execution-history-kernel:';

export type ExecutionHistoryBindingRequest = {
  run: RunSnapshot;
  /** Formal mapped Session, used to validate the claimed Kernel binding. */
  session: SessionRecord;
  sessionRef: SessionRef;
  /**
   * The observed Kernel identity and positions. A Kernel observation source may
   * carry a local `position`; RUN-06 keeps only the shared four-field Kernel
   * identity and the three positions in the locator, never anything else.
   */
  history: RunObservedHistory;
  /** The rework actor class of the caller (§1.3); RUN-06 does not read it. */
  actor: RunGuardContext['actor'];
};

export type ExecutionHistoryBinding = {
  history: RunExecutionHistoryV1;
  nextRun: RunSnapshot;
  runRecord: EncodedRecord;
  guards: readonly RecordGuard[];
  claim: UniqueClaimChange;
};

export type ExecutionHistoryBindingResult =
  | { status: 'compiled'; value: ExecutionHistoryBinding }
  | CoreRejection;

/**
 * RUN-06's guard context: the row reads only the claim Session's Kernel
 * mapping. The other facts belong to other Run events and hold neutral
 * values here; W9 never requires the current Session occupancy or the Lease.
 */
function historyRunContext(session: SessionRecord, actor: RunGuardContext['actor']): RunGuardContext {
  return {
    session: { usable: true, owned: false, kernel: session.kernel }, lease: 'missing', persistedClaim: null,
    goal: { desiredState: 'active', activePlanMatchesClaim: true }, entryPlan: 'active_plan',
    continuationBrief: 'absent_ok', freshAdmission: null, pointerIntent: null, queuedSteers: [],
    continuationConsumed: false, exitProof: null, hostLease: null, kernelProbe: null, kernelPaused: false,
    inputsConfirmed: null, actor, claim: null,
  };
}

/**
 * RUN-06's one effect, `claim_kernel_slot`, as the shared Kernel identity
 * unique-slot change (`none`: no owner yet). The effect names the four-field
 * Kernel identity the locator keeps, which keys the slot as it is.
 */
function kernelSlotChange(effects: readonly RunEffect[], runKey: string): UniqueClaimChange {
  const [effect, ...extra] = effects;
  if (effect?.kind !== 'claim_kernel_slot' || extra.length > 0) {
    throw new Error('history_recorded claims exactly the one Kernel slot');
  }
  return { claimKey: KERNEL_SLOT_PREFIX + canonicalJson(effect.kernel as unknown as JsonValue),
    expectedOwner: effect.expectedOwner === 'none' ? null : runKey, nextOwner: runKey };
}

/**
 * Compile one locator update. It never writes: a caller merges `guards` with the
 * other records it read and commits once.
 */
export function compileExecutionHistoryBinding(
  request: ExecutionHistoryBindingRequest,
): ExecutionHistoryBindingResult {
  const { run } = request;
  const recorded = transitionRun(runStateOf(run),
    { kind: 'history_recorded', sessionRef: request.sessionRef, history: request.history },
    historyRunContext(request.session, request.actor));
  if (!recorded.ok) return { status: 'rejected', code: recorded.code, reason: recorded.detail };
  const nextRun = recorded.next.record;
  if (nextRun === null || nextRun.executionHistory === undefined) {
    throw new Error('an accepted history_recorded transition names the Run and the locator it writes');
  }
  const runKey = canonicalJson(run.ref as unknown as JsonValue);
  return {
    status: 'compiled',
    value: {
      history: nextRun.executionHistory, nextRun,
      runRecord: { refKey: runKey, schemaId: RUN_SNAPSHOT_SCHEMA_ID, revision: nextRun.revision,
        json: JSON.stringify(nextRun) },
      guards: [{ refKey: runKey, expectedRevision: run.revision }],
      claim: kernelSlotChange(recorded.effects, runKey),
    },
  };
}
