/**
 * Invariant checks of the state machines (spec §11.11, §15.1: they live under
 * `tests/state/` and never enter product code). Step 6 adds the
 * `InvariantWorld` checks and `checkAllInvariants`; today the file holds the
 * §6.1 record check the Run machine tests use.
 */
import type { ExecutionAuthorizationV1, ExecutionAuthorizationV2, RunSnapshot } from '../../src/contracts/dispatch.js';
import { unreachable } from '../../src/core/work-graph/state/transition.js';

function isAuthorizationV2(auth: ExecutionAuthorizationV1 | ExecutionAuthorizationV2 | undefined): auth is ExecutionAuthorizationV2 {
  return auth !== undefined && 'schemaVersion' in auth && auth.schemaVersion === 2;
}

/**
 * §6.1 "其他 V2 组合视为损坏": the problem of a Run outside the eight machine
 * states, or `null`. A V1 or pre-B2 Run is legacy history, not damage. Every
 * record `transitionRun` produces passes it (§14.5); today's readers do not
 * cross-check (`record-readers.ts:313-314`), so it is the invariant check's tool.
 * Moved from `run-machine.ts` (A.2 step 4): no production path calls it.
 */
export function runCombinationProblem(record: RunSnapshot): string | null {
  const auth = record.executionAuthorization;
  if (auth !== undefined && !isAuthorizationV2(auth)) return null;
  const phase = isAuthorizationV2(auth) ? auth.phase : 'none';
  switch (record.status) {
    case 'starting':
      if (record.outcome !== null) return 'a starting Run has no outcome';
      return phase === 'none' || phase === 'authorized' || phase === 'entering' || phase === 'revoked'
        ? null : `a starting Run cannot carry the ${phase} entry phase`;
    case 'running':
      if (record.outcome !== null) return 'a running Run has no outcome';
      return phase === 'entered' || auth === undefined ? null : `a running Run cannot carry the ${phase} entry phase`;
    case 'ended': {
      const outcome = record.outcome;
      if (outcome === null) return 'an ended Run needs an outcome';
      if (outcome === 'failed') return 'the outcome failed has no writer';
      if (auth === undefined) return null;
      if (outcome === 'outcome_unknown') return phase === 'unknown' ? null : 'an outcome_unknown Run carries the unknown entry phase';
      if (outcome === 'yielded' && record.continuation === undefined) return 'a yielded Run carries its continuation';
      if (phase === 'settled') return null;
      // D-7: an un-entered stop ends a Run whose authorization was revoked (or never existed).
      return outcome === 'cancelled' && phase === 'revoked' ? null : `an ended Run cannot carry the ${phase} entry phase`;
    }
    default: return unreachable(record.status, 'Run status');
  }
}
