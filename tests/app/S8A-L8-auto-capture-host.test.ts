/**
 * L8 (A-04) automatic capture through the real Host HTTP routes.
 *
 * Every prior state is reached the way production reaches it: a real workspace
 * on disk, the settings `workspaces/open` route or the `workspaces/register`
 * route, the real `architecture/adopt-initial` trigger, and the one public
 * `architecture/observation-state` read. No record, observation or request is
 * written by hand. The helpers are shared with the gate rows so the route path
 * and the waiting policy have one copy.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { rename, rm } from 'node:fs/promises';
import {
  adoptInitial, cleanupTemporary, completed, corePost, graphWrite, makeWorkspace,
  observationState, routeRegistered, scopeOf, settingsPost, setupPublicDir, startHost, temporaryDirectory,
  waitState, workspaceConfig,
} from './support/S8A-L8-host.js';

beforeAll(async () => { await setupPublicDir(); });
afterAll(async () => { await cleanupTemporary(); });

describe('L8 automatic capture through the Host (A-04)', () => {
  for (const backend of ['memory', 'sqlite'] as const) {
    it(`registration through workspaces/register yields one capture (${backend})`, async () => {
      const scope = scopeOf(`l8-register-${backend}`, `l8-register-ws-${backend}`);
      const started = await startHost({ backend, workspaces: [workspaceConfig(scope, await makeWorkspace())] });
      try {
        await routeRegistered(started, scope);
        const state = await waitState(started.base, started.token, scope, completed);
        expect(state.autoCapture).toMatchObject({
          requestSeq: 1, trigger: 'workspace_registered', status: 'requested', failure: null, pending: false,
        });
        expect(state.current).not.toBeNull();
        expect(state.previous).toBeNull();
      } finally { await started.host.close(); }
    }, 60_000);

    it(`a replayed registration starts no capture (${backend})`, async () => {
      const scope = scopeOf(`l8-replay-${backend}`, `l8-replay-ws-${backend}`);
      const started = await startHost({ backend, workspaces: [workspaceConfig(scope, await makeWorkspace())] });
      try {
        await routeRegistered(started, scope);
        const first = await waitState(started.base, started.token, scope, completed);
        const captureId = first.current?.captureRef.captureId;
        const replay = await corePost(started.base, 'workspaces/register', started.token,
          graphWrite(scope, { workspace: scope }, `l8-workspace:${scope.workspaceId}`,
            [{ ref: { aggregateType: 'Project' as const, projectId: scope.projectId }, revision: 1 },
              { ref: { aggregateType: 'Workspace' as const, ...scope }, revision: 0 }]));
        expect(await replay.json()).toMatchObject({ status: 'committed', replayed: true });
        // Restored ledger check (old host:51): the replay left the earlier
        // request in place; it did not queue a second one.
        const replayedState = await observationState(started.base, started.token, scope);
        expect(replayedState).toMatchObject({ status: 'ready' });
        if (replayedState.status !== 'ready') throw new Error(JSON.stringify(replayedState));
        expect(replayedState.value.autoCapture).toMatchObject({ requestSeq: 1, pending: false });
        // The replay fires no registration step: the Host triggers only a
        // non-replayed commit. A REAL adoption afterwards is the completion
        // boundary (the rule sheet's F9 shape, no sleep): its completed capture
        // must be request 2, so the replay left no request behind.
        expect(await adoptInitial(started, scope, `l8-replay-baseline-${backend}`))
          .toMatchObject({ status: 'committed' });
        const after = await waitState(started.base, started.token, scope,
          state => state.autoCapture?.requestSeq === 2
            && state.autoCapture.pending === false && state.current !== null);
        expect(after.autoCapture).toMatchObject({ requestSeq: 2, trigger: 'catalog_adopted', pending: false });
        expect(after.current?.captureRef.captureId).not.toBe(captureId);
        expect(after.previous?.captureId).toBe(captureId);
      } finally { await started.host.close(); }
    }, 60_000);
  }

  for (const backend of ['memory', 'sqlite'] as const) {
    it(`registration through the settings flow yields one capture (${backend})`, async () => {
      const started = await startHost({
        backend,
        workspaces: [],
        // A memory Host has no default settings directory; SQLite gets an
        // explicit one too so both backends use the same persisted settings path.
        settingsDirectory: await temporaryDirectory(`s8a-l8-settings-${backend}-`),
      });
      try {
        const opened = await settingsPost(started.base, 'workspaces/open', started.token,
          { path: await makeWorkspace(), writeAllowed: false, commandsAllowed: false, name: 'L8 settings workspace' });
        const body = await opened.json() as { status: string; value?: { scope: { projectId: string; workspaceId: string } } };
        expect(body.status).toBe('ready');
        const openedScope = body.value!.scope;
        const state = await waitState(started.base, started.token, openedScope, completed);
        expect(state.autoCapture).toMatchObject({
          requestSeq: 1, trigger: 'workspace_registered', status: 'requested', failure: null, pending: false,
        });
        expect(state.current).not.toBeNull();
      } finally { await started.host.close(); }
    }, 60_000);
  }

  for (const backend of ['memory', 'sqlite'] as const) {
    it(`a failed capture is recorded and the next trigger retries it (${backend})`, async () => {
      const scope = scopeOf(`l8-fail-trigger-${backend}`, `l8-fail-trigger-ws-${backend}`);
      const root = await makeWorkspace();
      const started = await startHost({ backend, workspaces: [workspaceConfig(scope, root)] });
      const away = `${root}-away`;
      try {
        const project = await corePost(started.base, 'projects/create', started.token,
          graphWrite(scope, { projectId: scope.projectId }, `l8-project:${scope.projectId}`,
            [{ ref: { aggregateType: 'Project' as const, projectId: scope.projectId }, revision: 0 }]));
        expect(await project.json()).toMatchObject({ status: 'committed' });
        // A REAL failure: the sandbox cannot resolve the moved workspace root.
        await rename(root, away);
        const registered = await corePost(started.base, 'workspaces/register', started.token,
          graphWrite(scope, { workspace: scope }, `l8-workspace:${scope.workspaceId}`,
            [{ ref: { aggregateType: 'Project' as const, projectId: scope.projectId }, revision: 1 },
              { ref: { aggregateType: 'Workspace' as const, ...scope }, revision: 0 }]));
        expect(await registered.json()).toMatchObject({ status: 'committed' });
        const failed = await waitState(started.base, started.token, scope,
          state => state.autoCapture?.status === 'failed');
        expect(failed.autoCapture).toMatchObject({ requestSeq: 1, status: 'failed', pending: true });
        expect(failed.autoCapture?.failure).not.toBeNull();
        expect(failed.autoCapture?.failure?.code).toBe('unavailable');
        expect(failed.current).toBeNull();
        await rename(away, root);
        // The next trigger (a real adoption) requests a new capture and retries.
        expect(await adoptInitial(started, scope, `l8-fail-baseline-${backend}`)).toMatchObject({ status: 'committed' });
        const retried = await waitState(started.base, started.token, scope, completed);
        expect(retried.autoCapture).toMatchObject({ requestSeq: 2, trigger: 'catalog_adopted', status: 'requested', pending: false });
        expect(retried.current).not.toBeNull();
      } finally {
        await rm(away, { recursive: true, force: true });
        await started.host.close();
      }
    }, 90_000);
  }

  it('a failed capture is retried by the next Host start (sqlite)', async () => {
    const scope = scopeOf('l8-fail-start-project', 'l8-fail-start-workspace');
    const root = await makeWorkspace();
    const first = await startHost({ backend: 'sqlite', workspaces: [workspaceConfig(scope, root)] });
    const away = `${root}-away`;
    let database: string;
    try {
      const project = await corePost(first.base, 'projects/create', first.token,
        graphWrite(scope, { projectId: scope.projectId }, `l8-project:${scope.projectId}`,
          [{ ref: { aggregateType: 'Project' as const, projectId: scope.projectId }, revision: 0 }]));
      expect(await project.json()).toMatchObject({ status: 'committed' });
      await rename(root, away);
      const registered = await corePost(first.base, 'workspaces/register', first.token,
        graphWrite(scope, { workspace: scope }, `l8-workspace:${scope.workspaceId}`,
          [{ ref: { aggregateType: 'Project' as const, projectId: scope.projectId }, revision: 1 },
            { ref: { aggregateType: 'Workspace' as const, ...scope }, revision: 0 }]));
      expect(await registered.json()).toMatchObject({ status: 'committed' });
      const failed = await waitState(first.base, first.token, scope, state => state.autoCapture?.status === 'failed');
      expect(failed.autoCapture).toMatchObject({ requestSeq: 1, status: 'failed', pending: true });
      expect(failed.current).toBeNull();
      await rename(away, root);
      database = first.database;
    } finally { await first.host.close(); }
    const second = await startHost({ backend: 'sqlite', workspaces: [workspaceConfig(scope, root)], database });
    try {
      const retried = await waitState(second.base, second.token, scope, completed);
      expect(retried.autoCapture).toMatchObject({ requestSeq: 2, trigger: 'startup_retry', status: 'requested', pending: false });
      expect(retried.current).not.toBeNull();
    } finally {
      await rm(away, { recursive: true, force: true });
      await second.host.close();
    }
  }, 90_000);

  for (const backend of ['memory', 'sqlite'] as const) {
    it(`the manual architecture/capture route still works (${backend})`, async () => {
      const scope = scopeOf(`l8-manual-${backend}`, `l8-manual-ws-${backend}`);
      const started = await startHost({ backend, workspaces: [workspaceConfig(scope, await makeWorkspace())] });
      try {
        await routeRegistered(started, scope);
        const automatic = await waitState(started.base, started.token, scope, completed);
        const before = automatic.current?.captureRef.captureId;
        const manual = await corePost(started.base, 'architecture/capture', started.token,
          graphWrite(scope, { workspace: scope, mappings: [], previous: null }, 'l8-manual-capture-1',
            [{ ref: { aggregateType: 'Project' as const, projectId: scope.projectId }, revision: 1 },
              { ref: { aggregateType: 'Workspace' as const, ...scope }, revision: 1 }]));
        expect(await manual.json()).toMatchObject({ status: 'committed' });
        const after = await waitState(started.base, started.token, scope,
          state => state.current !== null && state.current.captureRef.captureId !== before);
        expect(after.current?.captureRef.captureId).toBeTruthy();
        expect(after.autoCapture).toMatchObject({ requestSeq: 1, pending: false });
      } finally { await started.host.close(); }
    }, 60_000);
  }
});
