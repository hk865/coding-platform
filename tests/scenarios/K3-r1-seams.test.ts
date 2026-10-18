/**
 * K3 group 2 part 3 self-tests for the shared test seams (spec §5.1 "夹具的接缝",
 * lines 1394-1401) and the WP1 fixture registration fix (lead ruling 1).
 *
 * 1. Stand-in `shell` (K3 §5.1 "替身 shell"). This file owns the `vi.hoisted`
 *    state and the `vi.mock` of
 *    `vendor/coding-agent/dist/tools/builtin/shell/shell-tool.js` — the exact
 *    module `composition-root.js:67` and `resume-composition.js:66` import. The
 *    mock returns `shellSeam.definition(actualCreateShellToolDefinition, sandbox)`:
 *    armed → the stand-in (`name: 'shell'`, `effectClass: 'process'`, no
 *    `isolated_process`, handler blocks until `release()`), disarmed → the real
 *    definition. A later K3 test copies this `vi.hoisted` + `vi.mock` pair and
 *    arms `shellSeam` around a `HostScenario`/`openWorkRoot` Run.
 *
 * 2. `HostScenario.open({ gitWorkspace: ... })` (K3 §5.1 "git 工作区"):
 *    `initGitWorkspace` runs in the scenario's own temporary root before the
 *    first Host starts. `HostScenario.gitWorkspace` exposes the initial commit.
 *
 * 3. Crash points K3-01/K3-02 (spec §5.2). Both fit the existing
 *    `lockLedgerAfter` seam in `tests/scenarios/support/common.ts`; nothing else
 *    is needed. What later R1 tests must do (same shape as A8-3j,
 *    tests/scenarios/A8-host-restart.test.ts:220):
 *
 *    - K3-02 (crash BEFORE the message commit): open with
 *      `gitWorkspace: true`, drive to the prepared `start`, then
 *      `const lock = lockLedgerAfter(h.database, 'ModelRequestEvidenceRecorded', { kernelStore: true })`.
 *      The model-request evidence commit is the last ledger batch before the
 *      provider call that produces the `send_session_message` tool call, so the
 *      Run has entered, the model call really happens, and the send reaches the
 *      message commit, which fails: no `SessionMessageSent` event and no
 *      `SessionMessage` snapshot ever commit. Verified on the real flow: the lock
 *      is held with `model.calls() === 1` and 0 `SessionMessage` snapshots.
 *      Start the prepared Run through `openWorkRoot(h, model, lock.observer)`,
 *      release in `finally`, then `h.restart({ crash: true })`: the record is
 *      `not_done` and the continuation note says "没做".
 *      (`ModelRequestAuthorized` or `ExecutionEntryEntered` lock even earlier and
 *      also guarantee no message commit, but then the model call does not run;
 *      `(last) => last !== 'SessionMessageSent'` is the crudest form. Use
 *      `ModelRequestEvidenceRecorded` for the same shape as K3-01.)
 *
 *    - K3-01 (message committed, Kernel without a result): exactly A8-3j,
 *      `lockLedgerAfter(h.database, 'SessionMessageSent', { kernelStore: true })`;
 *      the message commits, the locked Kernel store keeps the send without a
 *      recorded result, and the restart resolves the review `done`.
 *
 * 4. Long commands/ids (K3-48): no new helper. Part 2 already covers them:
 *    `tests/work-graph/K3-48-unknown-call-review-creation-budget.test.ts:19-29`
 *    builds a 512-byte callId/command/8-path item and the 513-byte callId is
 *    `tests/runtime/A2-reconcile-runtime.test.ts:920`.
 */
import { existsSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { ToolDefinition } from '../../vendor/coding-agent/dist/public-api.js';
import { cleanupRestart, tempDir } from '../helpers/A2-restart-fixture.js';
import { shellSeam } from '../helpers/K3-tool-seams.js';
import { createScriptedModel } from '../helpers/B2-runtime-fixture.js';
import { AG2B_CONSUMER_ID, AG2B_QUERY_ROLE, AG2B_WORK_TASK_ID, createAG2bSession } from '../helpers/AG2b-collaboration-fixture.js';
import { lockLedgerAfter, openWorkRoot, preparedOf, redrivePolicy, WORK_TARGET } from './support/common.js';
import { gitIn } from './support/git-workspace.js';
import { cleanupScenarios, HostScenario, hostCtx, performs, readSqlite } from './harness.js';

// --- The self-test owns the hoisted state and the module mock. -------------
const seams = vi.hoisted(() => ({ shellSeam: undefined as unknown }));
vi.mock('../../vendor/coding-agent/dist/tools/builtin/shell/shell-tool.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../vendor/coding-agent/dist/tools/builtin/shell/shell-tool.js')>();
  return {
    ...actual,
    createShellToolDefinition: (sandbox: Parameters<typeof actual.createShellToolDefinition>[0]): ToolDefinition =>
      (seams.shellSeam as typeof shellSeam).definition(actual.createShellToolDefinition, sandbox),
  };
});
seams.shellSeam = shellSeam;

afterEach(async () => {
  shellSeam.release();
  await cleanupScenarios();
  await cleanupRestart();
});

// --- 1. The stand-in shell ------------------------------------------------
describe('K3 §5.1 stand-in shell', () => {
  it('keeps the shell identity while armed, blocks the handler, then delegates to the real definition', async () => {
    const sandbox = {} as never;
    const { createShellToolDefinition } = await import('../../vendor/coding-agent/dist/tools/builtin/shell/shell-tool.js');

    shellSeam.arm();
    const armed = createShellToolDefinition(sandbox);
    expect(armed.name).toBe('shell');
    expect(armed.effectClass).toBe('process');
    expect(armed.requiredCapabilities).not.toContain('isolated_process');
    expect(armed.defaultTimeoutMs).toBe(60_000);

    let settled = false;
    const pending = armed.handler.execute({
      schemaVersion: 1, callId: 'k3-r1-shell', name: 'shell', arguments: { command: 'true' },
    } as never, { signal: new AbortController().signal } as never).then(() => { settled = true; });
    await shellSeam.waitForCall();
    await new Promise<void>((resolve) => { setTimeout(resolve, 10); });
    expect(settled, 'the armed handler must block until release()').toBe(false);
    expect(shellSeam.calls.map(call => call.callId)).toEqual(['k3-r1-shell']);

    shellSeam.release();
    await pending;
    expect(settled).toBe(true);
    expect(shellSeam.enabled).toBe(false);

    const real = createShellToolDefinition(sandbox);
    expect(real.requiredCapabilities).toContain('isolated_process');
    expect(real.defaultTimeoutMs).toBe(30_000);
    expect(real.outputLimitBytes).toBe(128 * 1024);
  });
});

// --- 2. The git workspace option ------------------------------------------
describe('K3 §5.1 git workspace option', () => {
  it('commits the tracked baseline and hides the Host-denied file from git', async () => {
    const h = await HostScenario.open({ gitWorkspace: true, workIds: null });
    expect(h.gitWorkspace).not.toBeNull();
    const info = h.gitWorkspace;
    if (info === null) throw new Error('gitWorkspace must be set');

    expect(gitIn(h.root, 'rev-parse', 'HEAD').trim()).toBe(info.commit);
    expect((gitIn(h.root, 'rev-list', '--count', 'HEAD')).trim()).toBe('1');
    expect(gitIn(h.root, 'status', '--porcelain').trim()).toBe('');
    const tracked = gitIn(h.root, 'ls-files').trim().split('\n');
    expect(tracked).toEqual(expect.arrayContaining(['src/module.ts', 'README.md']));
    expect(tracked).not.toContain('.evaluator/hidden.ts');
    expect(existsSync(join(h.root, '.evaluator', 'hidden.ts'))).toBe(true);
    expect(existsSync(join(h.root, '.git'))).toBe(true);
  });
});

// --- 3. Crash point recipes (tiny probe) ----------------------------------
describe('K3 §5.2 crash point recipes', () => {
  async function appendEvent(directory: string, eventType: string): Promise<void> {
    const ledger = new DatabaseSync(join(directory, 'ledger.sqlite'));
    try {
      ledger.exec('CREATE TABLE IF NOT EXISTS events (id INTEGER PRIMARY KEY, event_json TEXT NOT NULL)');
      ledger.prepare('INSERT INTO events (event_json) VALUES (?)').run(JSON.stringify({ eventType }));
    } finally { ledger.close(); }
  }

  it('locks at ModelRequestEvidenceRecorded (K3-02, before the message) and at SessionMessageSent (K3-01)', async () => {
    const directory = await tempDir('k3-r1-crash-');
    await appendEvent(directory, 'ModelRequestEvidenceRecorded');
    const beforeMessage = lockLedgerAfter(directory, 'ModelRequestEvidenceRecorded', { kernelStore: true });
    beforeMessage.observer.started(null);
    beforeMessage.observer.committed({ cursor: null as never, aggregates: [] });
    expect(beforeMessage.locked(), 'K3-02 locks right after the model evidence, before the message').toBe(true);
    beforeMessage.release();

    await appendEvent(directory, 'SessionMessageSent');
    const afterMessage = lockLedgerAfter(directory, 'SessionMessageSent', { kernelStore: true });
    afterMessage.observer.started(null);
    afterMessage.observer.committed({ cursor: null as never, aggregates: [] });
    expect(afterMessage.locked(), 'K3-01 locks right after the message commit').toBe(true);
    afterMessage.release();
  });

  it('K3-02 real flow: the evidence lock leaves the send model call but no message commit', async () => {
    const h = await HostScenario.open({ gitWorkspace: true, automation: redrivePolicy(false), check: 'pass' });
    const recipient = (await createAG2bSession(h.host, 'k3-r1-before-message', AG2B_QUERY_ROLE,
      [{ target: WORK_TARGET, relation: 'participates' }])).sessionRef;
    const toStart = await h.advance(h.select('k3-r1', AG2B_WORK_TASK_ID), { stopBefore: performs('start') });
    const prepared = preparedOf(toStart.next);
    const lock = lockLedgerAfter(h.database, 'ModelRequestEvidenceRecorded', { kernelStore: true });
    const model = createScriptedModel([{ kind: 'calls', calls: [{ callId: 'k3-r1-send', name: 'send_session_message',
      args: { recipient: { projectId: recipient.projectId, sessionId: recipient.sessionId }, text: 'before the message', replyMode: 'wait' } }] }]);
    const root = await openWorkRoot(h, model, lock.observer);
    try {
      await root.runtime.startRun(hostCtx(), { prepared, consumerId: AG2B_CONSUMER_ID, requestId: 'k3-r1-start' });
    } finally { lock.release(); await root.close(); }
    expect(lock.locked(), 'the lock was taken at the evidence commit').toBe(true);
    expect(model.calls(), 'the provider produced the send').toBe(1);
    expect(h.ledgerEventTypes()).toContain('ModelRequestEvidenceRecorded');
    expect(h.ledgerEventTypes()).not.toContain('SessionMessageSent');
    const messages = readSqlite(join(h.database, 'ledger.sqlite'), ledger => (ledger.prepare(
      "SELECT ref_key FROM snapshots WHERE json_extract(ref_key, '$.aggregateType') = 'SessionMessage'").all() as { ref_key: string }[]), []);
    expect(messages, 'no SessionMessage snapshot ever committed').toEqual([]);
  });
});
