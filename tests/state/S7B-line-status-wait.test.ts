/**
 * S-line-status: only an `open`/`answered` wait reads `waiting_reply`;
 * `consumed`, `withdrawn` and `expired` do not (book-7b §3.3 items 1 and 5, `7b:1200`).
 */
import { describe, expect, it } from 'vitest';
import type { ControlIntentRef } from '../../src/contracts/control-intent.js';
import type { SessionMessageRef } from '../../src/contracts/core/session-message.js';
import type { RunRef, RunSnapshot } from '../../src/contracts/dispatch.js';
import { deriveLineControls, deriveLineStatus, type LineFactsV1 } from '../../src/core/work-graph/state/line-status.js';
import type { WaitStateV1 } from '../../src/core/work-graph/state/message-machine.js';
import { G, P, SESSION_H, TASK_A, W, facts, runFacts, runOf } from '../helpers/S2C-line-facts-samples.js';

const MESSAGE: SessionMessageRef = { aggregateType: 'SessionMessage', projectId: P, workspaceId: W, messageId: 'm' };
const INTENT: ControlIntentRef = { aggregateType: 'ControlIntent', projectId: P, workspaceId: W, intentId: 'i' };
const RUN: RunRef = { aggregateType: 'Run', projectId: P, goalId: G, runId: 'r0' };
const CONTINUATION = {
  schemaVersion: 1 as const, kind: 'wait_reply' as const, task: TASK_A, sessionRef: SESSION_H, messageRef: MESSAGE,
};

function waitFacts(wait: WaitStateV1, over: Partial<RunSnapshot> = {}): LineFactsV1 {
  const run = runOf(RUN, { outcome: 'yielded', continuation: CONTINUATION, ...over });
  return facts({ latestWork: { ...runFacts(run, { wait }), waitRecipient: null } });
}

describe('7B-1 S-line-status: the wait state decides waiting_reply', () => {
  it.each<[WaitStateV1['state'], WaitStateV1['reason'], boolean]>([
    ['open', null, true],
    ['answered', null, true],
    ['consumed', null, false],
    ['withdrawn', 'withdrawn', false],
    ['expired', null, false],
  ])('%s → waiting_reply = %s', (state, reason, waiting) => {
    const status = deriveLineStatus(waitFacts({ state, reason }));
    expect(status.own).toBe(waiting ? 'waiting_reply' : 'standby');
  });

  it.each<[WaitStateV1['state'], WaitStateV1['reason'], boolean]>([
    ['consumed', null, true],
    ['open', null, false],
    ['answered', null, false],
  ])('%s → the work controls are refused = %s', (state, reason, refused) => {
    // A paused yield keeps the Work controls offered, so the consumed feed itself is observable.
    const line = waitFacts({ state, reason }, { controlState: { intentRef: INTENT, desiredState: 'paused' } });
    const status = deriveLineStatus(line);
    expect(status.own).toBe('paused');
    for (const kind of ['resume', 'cancel'] as const) {
      const control = deriveLineControls(line, status).find((entry) => entry.kind === kind);
      expect(control?.availability).toBe(refused ? 'unavailable' : 'available');
      if (refused) expect(control?.reasonCode).toBe('busy');
    }
  });
});
