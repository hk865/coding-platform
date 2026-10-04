/**
 * Task E change notices of the two in-memory Host handle owners the page used
 * to poll:
 *   - the collaboration driver announces only a moved `read` projection: start,
 *     each further step of a multi-step advance, a Run it only observes, a
 *     consultation wait before the (possibly long) consultation, the loop's final
 *     state, a yielded wait, stop and stopped. A blocked wait keeps ticking
 *     without a notice, and closing the driver announces nothing.
 *   - a real Kernel command handle announces `stopping` (once, before the abort)
 *     and `settled`; closing the tools announces nothing.
 * The driver ports are narrow stubs; no model is called.
 */
import { afterEach, describe, expect, it } from 'vitest';
import { mkdir, mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  createCollaborationDriver,
  type CollaborationChange,
  type CollaborationDriver,
  type CollaborationDriverDependencies,
  type CollaborationSnapshot,
  type CollaborationStartInput,
  type CollaborationState,
} from '../../src/app/collaboration-driver.js';
import { createWorkbenchTools, type WorkbenchCommandChange } from '../../src/app/workbench-tools.js';
import type { CoreCallContext } from '../../src/contracts/core/call-context.js';
import type { GoalRef } from '../../src/contracts/ledger.js';
import type { WorkflowAdvanceResult } from '../../src/business/workflow/contracts.js';
import { until } from '../helpers/change-stream-reader.js';

const scope = { projectId: 'emit-project', workspaceId: 'emit-workspace' };
const actor = { kind: 'human' as const, id: 'emit-operator' };
const goalRef = { aggregateType: 'Goal', projectId: scope.projectId, goalId: 'emit-goal' } as GoalRef;
const context = (): CoreCallContext => ({
  projectId: scope.projectId,
  workspaceId: scope.workspaceId,
  principal: { kind: 'host', actor: { ...actor } },
  materialReader: { kind: 'host', projectId: scope.projectId, workspaceId: scope.workspaceId, actor: { ...actor } },
  signal: new AbortController().signal,
});
const startInput = {
  advance: { schemaVersion: 1 as const, goalRef, flowId: 'emit-flow', sessionHint: null, kind: 'select_work' as const },
  queryProfileIds: [],
};
const runRef = { aggregateType: 'Run', projectId: scope.projectId, goalId: goalRef.goalId, runId: 'emit-run' };
const continuation = {
  schemaVersion: 1, kind: 'wait_reply',
  task: { projectId: scope.projectId, goalId: goalRef.goalId, taskId: 'emit-task' },
  sessionRef: { projectId: scope.projectId, sessionId: 'emit-session' },
  messageRef: { projectId: scope.projectId, messageId: 'emit-message' },
};
/** A start receipt whose Run yielded on a saved reply wait. */
const yielded = { status: 'ready', value: {
  state: 'waiting', next: null, reason: 'waiting for the reply',
  receipt: { kind: 'start', result: { status: 'ready', value: { run: { ref: runRef, outcome: 'yielded', continuation } } } },
} } as unknown as WorkflowAdvanceResult;
const completed = { status: 'ready', value: { state: 'completed', receipt: null, next: null, reason: 'goal complete' } } as WorkflowAdvanceResult;
/** A start whose next step starts `runRef` (a `perform:start` operation). */
const startRunInput = {
  advance: { ...startInput.advance, operation: { kind: 'start', request: { prepared: { claim: { runRef } } } } },
  queryProfileIds: [],
} as unknown as CollaborationStartInput;

const sleep = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

const temporary: string[] = [];
afterEach(async () => {
  for (const directory of temporary.splice(0)) await rm(directory, { recursive: true, force: true });
});

type Recorder = {
  notices: CollaborationChange[];
  states: Promise<CollaborationState | null>[];
  /** The whole `read` projection at each notice. */
  reads: Promise<CollaborationSnapshot | null>[];
};

/** Stub port replacements; `workflow` members are added to the default workflow. */
type PortOverrides = { workflow?: Record<string, unknown>; executions?: unknown; mailbox?: unknown; sessions?: unknown };

/** Narrow stub ports: the wait message is never answered, the yielded Run stays
 * ended/yielded, and a cancel is accepted. */
function driverWith(
  advanceWork: () => Promise<WorkflowAdvanceResult>, overrides: PortOverrides = {},
): { driver: CollaborationDriver; recorder: Recorder } {
  const recorder: Recorder = { notices: [], states: [], reads: [] };
  const { workflow: workflowOverrides, ...portOverrides } = overrides;
  const dependencies = {
    workflow: { advanceWork, handleGoalInput: async () => { throw new Error('not used'); }, ...workflowOverrides },
    runtime: {},
    sessions: {},
    executions: { readExecution: async () => ({ status: 'ready', value: {
      run: { ref: runRef, status: 'ended', outcome: 'yielded', continuation, revision: 3 },
    } }) },
    mailbox: {
      readOutbox: async () => ({ status: 'ready', value: { items: [], nextCursor: null } }),
      readMessage: async () => ({ status: 'ready', value: { status: 'pending', response: null } }),
    },
    controls: { submitControl: async () => ({ status: 'committed', value: { intent: { ref: { aggregateType: 'ControlIntent' } } } }) },
    profiles: [],
    ...portOverrides,
    onChange: (change: CollaborationChange) => {
      recorder.notices.push(change);
      // `read` builds its snapshot synchronously, so this is the state at notice time.
      const read = driver.read(context(), { goalRef }).then(result => result.status === 'ready' ? result.value : null);
      recorder.reads.push(read);
      recorder.states.push(read.then(value => value?.state ?? null));
    },
  } as unknown as CollaborationDriverDependencies;
  const driver = createCollaborationDriver(dependencies);
  return { driver, recorder };
}

async function untilState(driver: CollaborationDriver, state: CollaborationState): Promise<void> {
  const deadline = Date.now() + 5_000;
  for (;;) {
    const read = await driver.read(context(), { goalRef });
    if (read.status === 'ready' && read.value.state === state) return;
    if (Date.now() > deadline) throw new Error(`the driver never reached ${state}`);
    await sleep(20);
  }
}

describe('collaboration driver change notices', () => {
  it('announces the start and the final completed state, once each', async () => {
    let finish: (result: WorkflowAdvanceResult) => void = () => undefined;
    const { driver, recorder } = driverWith(() => new Promise(resolve => { finish = resolve; }));
    try {
      const started = await driver.start(context(), startInput);
      expect(started.status).toBe('ready');
      expect(recorder.notices).toEqual([{ scope, goalId: goalRef.goalId, taskId: null }]);
      finish({ status: 'ready', value: { state: 'completed', receipt: null, next: null, reason: 'goal complete' } });
      await until(() => recorder.notices.length >= 2);
      await sleep(100);
      expect(recorder.notices).toEqual([
        { scope, goalId: goalRef.goalId, taskId: null }, { scope, goalId: goalRef.goalId, taskId: null },
      ]);
      expect(await Promise.all(recorder.states)).toEqual(['running', 'completed']);
    } finally { await driver.close(); }
  });

  it('stays silent while a yielded wait ticks unchanged, then announces stopping and stopped', async () => {
    const { driver, recorder } = driverWith(async () => yielded);
    try {
      await driver.start(context(), startInput);
      await until(() => recorder.notices.length >= 2);
      expect(await Promise.all(recorder.states)).toEqual(['running', 'waiting_for_reply']);
      // At least two 500 ms ticks of both the outbox pump and the wake wait pass
      // with an unchanged projection.
      await sleep(1_200);
      expect(recorder.notices).toHaveLength(2);
      const stopped = await driver.stop(context(), { goalRef });
      expect(stopped).toMatchObject({ status: 'ready', value: { state: 'stopping' } });
      expect(recorder.notices).toHaveLength(3);
      await untilState(driver, 'stopped');
      await until(() => recorder.states.length === recorder.notices.length);
      const states = await Promise.all(recorder.states);
      expect(states.slice(0, 3)).toEqual(['running', 'waiting_for_reply', 'stopping']);
      expect(states.at(-1)).toBe('stopped');
      expect(states.length).toBeLessThanOrEqual(5);
      expect(states.slice(3).every(state => state === 'stopping' || state === 'stopped')).toBe(true);
      const count = recorder.notices.length;
      await sleep(600);
      expect(recorder.notices).toHaveLength(count);
    } finally { await driver.close(); }
  });

  it('announces nothing while the driver closes', async () => {
    const { driver, recorder } = driverWith(async () => yielded);
    await driver.start(context(), startInput);
    await until(() => recorder.notices.length >= 2);
    await driver.close();
    await sleep(100);
    expect(recorder.notices).toHaveLength(2);
  });

  it('announces each further step of a multi-step advance before the loop ends', async () => {
    const firstStep = { status: 'ready', value: {
      state: 'advance', receipt: null, reason: 'first step done', next: { ...startInput.advance },
    } } as WorkflowAdvanceResult;
    let calls = 0;
    let finish: (result: WorkflowAdvanceResult) => void = () => undefined;
    const { driver, recorder } = driverWith(() => {
      calls += 1;
      return calls === 1 ? Promise.resolve(firstStep) : new Promise(resolve => { finish = resolve; });
    });
    try {
      await driver.start(context(), startInput);
      await until(() => recorder.notices.length >= 2);
      // The loop is inside its second (still pending) step and already shows the first one.
      expect(calls).toBe(2);
      expect(await recorder.reads[1]).toMatchObject({ state: 'running', last: firstStep });
      finish(completed);
      await until(() => recorder.notices.length >= 3);
      expect(await Promise.all(recorder.states)).toEqual(['running', 'running', 'completed']);
    } finally {
      finish(completed);
      await driver.close();
    }
  });

  it('announces a Run it only observes before that Run\'s long advance returns', async () => {
    let finish: (result: WorkflowAdvanceResult) => void = () => undefined;
    const { driver, recorder } = driverWith(() => new Promise(resolve => { finish = resolve; }), {
      // Not a fresh start: the Run is not readable as an authorized fresh Run.
      executions: { readExecution: async () => ({ status: 'rejected', code: 'not_found', reason: 'no such Run' }) },
    });
    try {
      await driver.start(context(), startRunInput);
      await until(() => recorder.notices.length >= 2);
      expect(await recorder.reads[1]).toMatchObject({
        state: 'running', reason: 'the Run was already entered or settled; only observing the original facts',
      });
    } finally {
      finish(completed);
      await driver.close();
    }
  });

  it('announces a consultation wait before the consultation runs', async () => {
    const inquiry = {
      ref: { projectId: scope.projectId, messageId: 'emit-inquiry' }, revision: 1, status: 'pending',
      sender: { kind: 'work_run', run: runRef }, recipient: { projectId: scope.projectId, sessionId: 'emit-recipient' },
      intent: 'inquiry', waitAfterSend: true,
    };
    let finish: (result: WorkflowAdvanceResult) => void = () => undefined;
    let cardReads = 0;
    let releaseCard: () => void = () => undefined;
    const noCard = { status: 'rejected', code: 'not_found', reason: 'no recipient card' };
    const { driver, recorder } = driverWith(() => new Promise(resolve => { finish = resolve; }), {
      workflow: { consumeConsultation: async () => { throw new Error('not reached: the card read is rejected'); } },
      // A fresh start of this Goal's Run, so the consultation pump runs beside the advance.
      executions: { readExecution: async () => ({ status: 'ready', value: {
        run: { ref: runRef, task: { goalId: goalRef.goalId }, status: 'running', outcome: null },
        session: { workspaceId: scope.workspaceId },
      } }) },
      mailbox: {
        readOutbox: async () => ({ status: 'ready', value: { items: [inquiry], nextCursor: null } }),
        readMessage: async () => ({ status: 'ready', value: { status: 'pending', response: null } }),
      },
      // The first consultation blocks in its first port call (the recipient card).
      sessions: { readSession: () => {
        cardReads += 1;
        return cardReads === 1 ? new Promise(resolve => { releaseCard = () => resolve(noCard); }) : Promise.resolve(noCard);
      } },
    });
    try {
      await driver.start(context(), startRunInput);
      await until(() => recorder.notices.length >= 2);
      expect(cardReads).toBe(1);
      expect(await recorder.reads[1]).toMatchObject({ state: 'waiting_for_reply', messages: [{ ref: inquiry.ref }] });
    } finally {
      releaseCard();
      finish(completed);
      await driver.close();
    }
  });
});

describe('command handle change notices', () => {
  it('announces settled, and stopping once before settled for a stopped command', async () => {
    const root = await mkdtemp(join(tmpdir(), 'change-emitters-'));
    temporary.push(root);
    await mkdir(join(root, 'src'), { recursive: true });
    const notices: WorkbenchCommandChange[] = [];
    const handle = createWorkbenchTools({
      workspaces: [{ scope, root, readPrefixes: ['src'], allowCommands: true }],
      onCommandChange: change => { notices.push(change); },
    });
    try {
      const echo = await handle.tools.startCommand(context(), { requestId: 'emit-echo', command: 'echo emit-ok', cwd: '.' });
      if (echo.status !== 'ready') throw new Error(`echo did not start: ${JSON.stringify(echo)}`);
      await until(() => notices.length >= 1, 10_000);
      expect(notices).toEqual([{ scope, commandId: echo.value.commandId, state: 'settled' }]);
      expect(await handle.tools.readCommand(context(), { commandId: echo.value.commandId }))
        .toMatchObject({ status: 'ready', value: { state: 'settled', stdout: 'emit-ok\n', exitCode: 0 } });

      const long = await handle.tools.startCommand(context(), { requestId: 'emit-long', command: 'sleep 30', cwd: '.' });
      if (long.status !== 'ready') throw new Error(`sleep did not start: ${JSON.stringify(long)}`);
      await sleep(200);
      expect(notices).toHaveLength(1);
      await handle.tools.stopCommand(context(), { commandId: long.value.commandId });
      expect(notices.slice(1)).toEqual([{ scope, commandId: long.value.commandId, state: 'stopping' }]);
      await handle.tools.stopCommand(context(), { commandId: long.value.commandId });
      await until(() => notices.length >= 3, 10_000);
      expect(notices.slice(1)).toEqual([
        { scope, commandId: long.value.commandId, state: 'stopping' },
        { scope, commandId: long.value.commandId, state: 'settled' },
      ]);
      expect(await handle.tools.readCommand(context(), { commandId: long.value.commandId }))
        .toMatchObject({ status: 'ready', value: { state: 'settled', cancelled: true } });

      const pending = await handle.tools.startCommand(context(), { requestId: 'emit-pending', command: 'sleep 30', cwd: '.' });
      expect(pending.status).toBe('ready');
      await handle.close();
      expect(notices).toHaveLength(3);
    } finally { await handle.close(); }
  }, 30_000);
});
