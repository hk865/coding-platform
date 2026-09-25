import { mkdtemp, mkdir, rm } from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { afterEach, describe, expect, it } from 'vitest';
import { createKernelStoreRegistry } from '../../src/core/agent-runtime/kernel-store-locator.js';
import { createSessionOperations } from '../../src/core/agent-runtime/session-operations.js';
import { createSessionDirectory } from '../../src/core/work-graph/sessions/session-directory.js';
import { sessionRecordSchema } from '../../vendor/coding-agent/dist/public-api.js';

const directories: string[] = [];
afterEach(async () => { await Promise.all(directories.splice(0).map(directory => rm(directory, { recursive: true, force: true }))); });
async function location() {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'next-r4b-'));
  directories.push(directory);
  return { directory, databasePath: path.join(directory, 'kernel.sqlite') };
}

describe('R4b Session skeleton', () => {
  it('binds a workspace to one stable real Kernel SQLite location across registry reopening', async () => {
    const { databasePath } = await location();
    const config = { entries: [{ adapterId: 'workspace-store-1', storeKey: 'workspace-key-1',
      workspace: { projectId: 'p', workspaceId: 'w' }, databasePath }] };
    const first = await createKernelStoreRegistry(config);
    expect(first.forWorkspace({ projectId: 'p', workspaceId: 'w' })?.adapterId).toBe('workspace-store-1');
    await first.withStore('workspace-store-1', store => store.create({
      sessionId: 'fixed-kernel-id', recordId: 'fixed-created-id', createdAt: '2026-09-24T00:00:00.000Z',
    }, { signal: new AbortController().signal }));
    const reopened = await createKernelStoreRegistry(config);
    const header = await reopened.withStore('workspace-store-1', store => store.get('fixed-kernel-id', {
      signal: new AbortController().signal,
    }));
    expect(header.sessionId).toBe('fixed-kernel-id');
    const firstPage = await reopened.withStore('workspace-store-1', store => store.read('fixed-kernel-id', 0, 1, {
      signal: new AbortController().signal,
    }));
    expect(firstPage.records).toHaveLength(1);
    const created = sessionRecordSchema.parse(firstPage.records[0]);
    expect(created).toMatchObject({
      recordType: 'session.created', recordId: 'fixed-created-id', sessionId: 'fixed-kernel-id', position: 1,
      payload: { sessionId: 'fixed-kernel-id', createdAt: header.createdAt },
    });
    expect(reopened.forWorkspace({ projectId: 'p', workspaceId: 'other' })).toBeNull();
  });

  it('rejects duplicate workspace, adapter and aliased database paths at Host registration', async () => {
    const { directory, databasePath } = await location();
    await mkdir(path.join(directory, 'sub'));
    const base = { adapterId: 'one', storeKey: 'one-key', workspace: { projectId: 'p', workspaceId: 'w' }, databasePath };
    await expect(createKernelStoreRegistry({ entries: [base, { ...base, adapterId: 'two', storeKey: 'two-key' }] })).rejects.toThrow(/path already/);
    await expect(createKernelStoreRegistry({ entries: [base, { ...base, databasePath: path.join(directory, 'sub', '..', 'other.sqlite') }] })).rejects.toThrow(/duplicate Kernel adapterId/);
    await expect(createKernelStoreRegistry({ entries: [base, { ...base, adapterId: 'two', storeKey: 'two-key', databasePath: path.join(directory, 'other.sqlite') }] })).rejects.toThrow(/workspace already/);
  });

  it('requires an explicit trusted legacy locator and matching original Kernel Session ID', async () => {
    const { databasePath } = await location();
    const registry = await createKernelStoreRegistry({ entries: [], legacyEntries: [{
      adapterId: 'legacy-run-store', storeKey: 'legacy-key', databasePath, expectedSessionId: 'old-session',
    }] });
    expect(registry.forWorkspace({ projectId: 'p', workspaceId: 'w' })).toBeNull();
    expect(registry.legacy('legacy-run-store', 'other-session')).toBeNull();
    expect(registry.legacy('legacy-run-store', 'old-session')?.databasePath).toBe(databasePath);
    await expect(registry.withStore('legacy-run-store', async () => null)).rejects.toThrow(/unregistered/);
    await expect(registry.withLegacyReader('legacy-run-store', 'other-session', async () => null)).rejects.toThrow(/mismatched/);
  });

  it('keeps identical Kernel Session IDs in separate registered databases distinct', async () => {
    const a = await location();
    const b = await location();
    const registry = await createKernelStoreRegistry({ entries: [
      { adapterId: 'store-a', storeKey: 'key-a', workspace: { projectId: 'p', workspaceId: 'a' }, databasePath: a.databasePath },
      { adapterId: 'store-b', storeKey: 'key-b', workspace: { projectId: 'p', workspaceId: 'b' }, databasePath: b.databasePath },
    ] });
    for (const [adapterId, recordId] of [['store-a', 'created-a'], ['store-b', 'created-b']] as const) {
      await registry.withStore(adapterId, store => store.create({ sessionId: 'same-id', recordId,
        createdAt: '2026-09-24T00:00:00.000Z' }, { signal: new AbortController().signal }));
    }
    const read = (adapterId: string) => registry.withStore(adapterId, store => store.read('same-id', 0, 1,
      { signal: new AbortController().signal }));
    expect((await read('store-a')).records[0]?.recordId).toBe('created-a');
    expect((await read('store-b')).records[0]?.recordId).toBe('created-b');
  });

  it('rejects unbound callers before accessing persistence or Kernel', async () => {
    const sessions = createSessionDirectory({ records: {} as never, lookups: {} as never });
    const result = await sessions.admitSessionCreation({} as never, {} as never);
    expect(result).toMatchObject({ status: 'rejected', code: 'forbidden' });
    const registry = await createKernelStoreRegistry({ entries: [] });
    const runtime = createSessionOperations({ sessions, kernelStores: registry });
    expect(await runtime.createSession({} as never, {} as never)).toMatchObject({ status: 'rejected', code: 'forbidden' });
  });
});
