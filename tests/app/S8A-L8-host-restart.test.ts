/**
 * L8 (book rework item 1): a settings Host restart must not re-capture a
 * workspace whose registration already exists.
 *
 * Every fact is reached through production: a real workspace on disk, the real
 * settings `workspaces/open` route, the durable settings file, the real
 * `architecture/adopt-initial` route, a moved workspace root as the fault, and
 * the one public `architecture/observation-state` read. No request, record or
 * observation is written by hand.
 *
 * Row K: the non-events are proven by a completion barrier — the awaited Host
 * close drains every tracked start-up step — then one public read over the
 * persisted store, never by a timed loop.
 */
import { afterAll, beforeAll, expect, it } from 'vitest';
import { rename } from 'node:fs/promises';
import type { CoreScope } from '../../src/app/core-http-types.js';
import {
  adoptInitial, cleanupTemporary, makeWorkspace, observationPoint, observationState, settingsPost,
  setupPublicDir, startHost, temporaryDirectory, waitState, workspaceConfig,
} from './support/S8A-L8-host.js';

beforeAll(async () => { await setupPublicDir(); });
afterAll(async () => { await cleanupTemporary(); });

/** Open one real workspace through the settings route and return its Host scope. */
async function settingsOpen(started: { base: string; token: string }, path: string): Promise<CoreScope> {
  const opened = await settingsPost(started.base, 'workspaces/open', started.token,
    { path, writeAllowed: false, commandsAllowed: false, name: 'L8 settings workspace' });
  const body = await opened.json() as { status: string; value?: { scope: CoreScope } };
  expect(body.status).toBe('ready');
  return body.value!.scope;
}

it('a settings Host restart with a satisfied request starts no capture (sqlite)', async () => {
  const settingsDirectory = await temporaryDirectory('s8a-l8-settings-satisfied-');
  const root = await makeWorkspace();

  let scope!: CoreScope;
  let captureId!: string;
  let database!: string;

  const first = await startHost({ backend: 'sqlite', workspaces: [], settingsDirectory });
  try {
    scope = await settingsOpen(first, root);
    const state = await waitState(first.base, first.token, scope,
      value => value.autoCapture?.requestSeq === 1 && value.autoCapture.pending === false && value.current !== null);
    captureId = state.current!.captureRef.captureId;
    database = first.database;
  } finally { await first.host.close(); }

  const second = await startHost({ backend: 'sqlite', workspaces: [], settingsDirectory, database });
  // The awaited close is the completion boundary for the whole start-up
  // restore: the platform drains every tracked step, so a restore-triggered
  // capture would have written request 2 and a new observation before it
  // resolves. No timed poll of a non-event.
  await second.host.close();
  const persisted = await observationPoint(
    { backend: 'sqlite', database }, [workspaceConfig(scope, root)], [scope]);
  const reply = persisted[scope.workspaceId]!;
  expect(reply.autoCapture).toMatchObject({ requestSeq: 1, pending: false });
  expect(reply.current?.captureRef.captureId).toBe(captureId);
}, 120_000);

it('a settings Host restart with a pending request captures exactly once (sqlite)', async () => {
  const settingsDirectory = await temporaryDirectory('s8a-l8-settings-pending-');
  const root = await makeWorkspace();
  const away = `${root}-away`;
  let scope!: CoreScope;
  let database!: string;
  let firstCaptureId!: string;

  const first = await startHost({ backend: 'sqlite', workspaces: [], settingsDirectory });
  try {
    scope = await settingsOpen(first, root);
    const state = await waitState(first.base, first.token, scope,
      value => value.autoCapture?.requestSeq === 1 && value.autoCapture.pending === false && value.current !== null);
    firstCaptureId = state.current!.captureRef.captureId;
    database = first.database;
  } finally { await first.host.close(); }

  // A second Host restores the same registration from the same ledger and
  // settings file. The root is moved away only after the restore, so the real
  // adoption request's automatic capture is the one that fails.
  const second = await startHost({ backend: 'sqlite', workspaces: [], settingsDirectory, database });
  try {
    const restored = await observationState(second.base, second.token, scope);
    expect(restored.status).toBe('ready');
    if (restored.status !== 'ready') return;
    expect(restored.value.autoCapture).toMatchObject({ requestSeq: 1, pending: false });
    await rename(root, away);
    expect(await adoptInitial(second, scope, 'l8-restart-pending-baseline')).toMatchObject({ status: 'committed' });
    const failed = await waitState(second.base, second.token, scope,
      value => value.autoCapture?.requestSeq === 2 && value.autoCapture.status === 'failed' && value.autoCapture.pending === true);
    // The failed request kept the restarted observation; it was not replaced.
    expect(failed.current?.captureRef.captureId).toBe(firstCaptureId);
  } finally {
    await rename(away, root).catch(() => undefined);
    await second.host.close();
  }

  // With the root restored, the third Host retries the pending request exactly
  // once through `startup_retry` and captures a NEW observation.
  const third = await startHost({ backend: 'sqlite', workspaces: [], settingsDirectory, database });
  let captureId!: string;
  try {
    const retried = await waitState(third.base, third.token, scope,
      value => value.autoCapture?.requestSeq === 3 && value.autoCapture.trigger === 'startup_retry'
        && value.autoCapture.pending === false && value.current !== null);
    captureId = retried.current!.captureRef.captureId;
    expect(captureId).not.toBe(firstCaptureId);
  } finally { await third.host.close(); }

  // The awaited close drains every tracked start-up step: a second retry would
  // have written request 4 and replaced the observation before it resolved.
  // The one read afterwards is the completion barrier, not a timed wait.
  const persisted = await observationPoint(
    { backend: 'sqlite', database }, [workspaceConfig(scope, root)], [scope]);
  const after = persisted[scope.workspaceId]!;
  expect(after.autoCapture).toMatchObject({ requestSeq: 3, trigger: 'startup_retry', pending: false });
  expect(after.current?.captureRef.captureId).toBe(captureId);
}, 180_000);
