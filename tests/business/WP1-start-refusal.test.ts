/**
 * Wiring 1 W16 (spec §5.2 rows WF01, WF02): the Workflow `perform start`
 * refusal mapping of `src/business/workflow/workflow.ts` W1-WF-01.
 *
 * Both rows run through the frozen `startRefusalWorkflow` fixture: only
 * `runtime.startRun` is live and returns the supplied refusal, so the exact
 * `ready/advance` value (WF01) or the unchanged `waiting` value (WF02) is the
 * whole assertion. WF02 is the unchanged behaviour the new mapping must not
 * swallow.
 */
import { describe, expect, it } from 'vitest';
import { startRefusalWorkflow } from '../helpers/WP1-units-fixture.js';

describe('wiring 1 start refusal mapping', () => {
  it('WF01 a context_goal_changed start refusal advances to a same-Run prepare', async () => {
    const startResult = { status: 'rejected', code: 'revision_conflict', reason: 'context_goal_changed: x' } as const;
    const fixture = startRefusalWorkflow(startResult);
    const result = await fixture.workflow.advanceWork(fixture.ctx, fixture.input);
    expect(fixture.calls).toHaveLength(1);
    expect(result).toStrictEqual({
      status: 'ready',
      value: {
        state: 'advance',
        receipt: { kind: 'start', result: startResult },
        next: {
          schemaVersion: 1,
          goalRef: fixture.base.goalRef,
          flowId: fixture.base.flowId,
          sessionHint: fixture.base.sessionHint,
          kind: 'perform',
          operation: { kind: 'prepare', request: fixture.expectedPrepareRequest },
        },
        reason: null,
      },
    });
  });

  it('WF02 another revision_conflict start refusal stays waiting', async () => {
    const startResult = {
      status: 'rejected', code: 'revision_conflict', reason: 'the Goal changed since the caller read it',
    } as const;
    const fixture = startRefusalWorkflow(startResult);
    const result = await fixture.workflow.advanceWork(fixture.ctx, fixture.input);
    expect(result).toStrictEqual({
      status: 'ready',
      value: {
        state: 'waiting',
        receipt: { kind: 'start', result: startResult },
        next: null,
        reason: 'the Goal changed since the caller read it',
      },
    });
  });
});
