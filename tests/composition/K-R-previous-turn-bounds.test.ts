/**
 * Group R, row KA-09 follow-up D8 (spec L9 "其它情况照今天"; §9 M2): only a Turn
 * that can still be interrupted is located through the injected `readTurnBounds`.
 *
 * Entry (D13): the real Host/Workflow flow. A Work Run ends with a real Kernel
 * terminal (a person's cancel applied at the safe point), so its platform
 * position record holds a non-null `endPosition`; the person's `继续` (`tasks/
 * requeue`) continues it in the SAME Session, and the continuation Run's brief
 * is read through the public `executions/brief` route. Today's platform-window
 * path (`readPositionWindow`) must build that brief and must never consult the
 * Kernel identity seam. The seam is a real `readTurnBounds` made absent
 * entirely. No private assembly helper is
 * imported, no Session/Run/requeue record is fabricated, and no database read
 * verifies a business result.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { SubmittedControl } from '../../src/contracts/control-intent.js';
import { AG2B_WORK_TASK_ID } from '../helpers/AG2b-collaboration-fixture.js';
import { submitControl, workRow } from '../helpers/A2-restart-fixture.js';
import { cleanupScenarios, openHostScenario, performs, type HostScenario } from '../scenarios/harness.js';
import {
  NO_REDRIVE, execution, operatorRequeue, readCall, requiredBriefOf, selectedRun, textReply,
} from '../scenarios/support/common.js';

afterEach(cleanupScenarios);

// D8/M2: the identity seam is made absent over the REAL Runtime. A call would
// answer `unsupported` and the brief could not be built, so a recorded
// `endPosition` must never reach it.
const seam = vi.hoisted(() => ({ absent: false }));
vi.mock('../../vendor/coding-agent/dist/public-api.js', async importOriginal => {
  const actual = await importOriginal<Record<string, unknown>>();
  const real = actual['readTurnBounds'] as (...args: unknown[]) => unknown;
  return Object.defineProperty({ ...actual }, 'readTurnBounds', { enumerable: true, configurable: true,
    get: () => (seam.absent ? undefined : real) });
});
afterEach(() => { seam.absent = false; });

type Continued = { briefPreviousRunId: string; cancelledRunId: string; briefSessionId: string; previousSessionId: string; continuity: string; endPosition: number };

/**
 * One Work Run cancelled by a person at its safe point (a real Kernel terminal,
 * so the platform records a non-null `endPosition`), then continued by that
 * person in the SAME Session. The brief is read from the public route.
 */
async function cancelledThenContinued(prefix: string): Promise<Continued> {
  let scenario: HostScenario | undefined;
  let cancelSubmission: SubmittedControl | undefined;
  scenario = await openHostScenario({ check: 'pass', automation: NO_REDRIVE, script: {
    replies: [readCall(`${prefix}-read`), textReply(`${prefix}: never reached on the cancelled Turn`),
      textReply(`${prefix}: the continuation`)],
    duringReply: async (index) => {
      if (index !== 0 || scenario === undefined) return;
      const runRef = await selectedRun(scenario);
      cancelSubmission = await submitControl(scenario.host, runRef, 'cancel', `${prefix}: the person cancels`, `${prefix}-cancel`);
    } } });
  const first = await scenario.advance(scenario.select(`${prefix}-1`, AG2B_WORK_TASK_ID));
  expect(first.state, JSON.stringify(first.steps.map(step => [step.state, step.reason]))).toBe('waiting');
  const runRef = await selectedRun(scenario);
  const ended = await execution(scenario, runRef);
  expect(ended.run, 'the person cancelled the live Run').toMatchObject({ status: 'ended', outcome: 'cancelled' });
  // D8's premise: the platform position record carries the Turn's recorded end.
  const endPosition = ended.run.executionHistory?.endPosition ?? null;
  if (endPosition === null) throw new Error('the cancelled Turn must have recorded an endPosition');
  expect(ended.session, 'a terminal Kernel Turn leaves the Session available').toMatchObject({ lifecycle: 'active', health: 'available' });
  if (cancelSubmission === undefined) throw new Error('the cancel must have been submitted during the live Turn');

  const continued = await operatorRequeue(scenario.host, runRef, `${prefix}-continue`, '继续');
  if (continued.status !== 'committed' || continued.value.kind !== 'requeued') {
    throw new Error(`continue: ${JSON.stringify(continued)}`);
  }
  const driven = await scenario.advance(scenario.select(`${prefix}-2`, AG2B_WORK_TASK_ID), { stopBefore: performs('open_checks') });
  expect(driven.next?.kind === 'perform' ? driven.next.operation.kind : null, 'the drive stops after the continuation Run')
    .toBe('open_checks');
  const row = await workRow(scenario.host);
  if (row.execution === null || row.execution.runId === runRef.runId) throw new Error('the continuation Run must be selected');
  const { brief } = await requiredBriefOf(scenario.host, row.execution);
  return { briefPreviousRunId: brief.previous.runRef.runId, cancelledRunId: runRef.runId,
    briefSessionId: brief.session.sessionRef.sessionId, previousSessionId: ended.session.ref.sessionId,
    continuity: brief.session.continuity, endPosition };
}

describe('D8 a previous Run with a recorded end keeps today\'s position window', () => {
  it('KA-09 (Runtime, L9/D8): an absent readTurnBounds is never needed for a recorded end, and the continuation brief is still built', async () => {
    seam.absent = true;
    const continued = await cancelledThenContinued('krpt-absent');
    expect(continued.briefPreviousRunId, 'the brief names the previous, ended Run').not.toBe('');
    // The brief is built from the recorded end: it names the cancelled Run, stays in the
    // original Session on the same-Session history path, and keeps the recorded end position.
    expect(continued.briefPreviousRunId, 'the brief names the previous, ended Run').toBe(continued.cancelledRunId);
    expect(continued.briefSessionId, 'the continuation stays in the original Session').toBe(continued.previousSessionId);
    expect(continued.continuity, 'the recorded end is the ordinary same-Session history path').toBe('same_session_history');
    expect(continued.endPosition).toBeGreaterThan(0);
  }, 300_000);
});
