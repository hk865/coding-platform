import { it, expect, vi } from 'vitest';
import { mkdtemp, mkdir, writeFile, rm, stat } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { canonicalJson } from '../../src/contracts/fingerprint.js';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { ExplorationSourceApplicability, explorationSourceDigest } from '../../src/data/workspace-reader/exploration-source.js';
import { materialSourcePinIsCurrent } from '../../src/data/workspace-reader/source-applicability.js';

const reading = vi.hoisted(() => ({ hook: undefined as undefined | ((handle: import('node:fs/promises').FileHandle) => void) }));
vi.mock('node:fs/promises', async importOriginal => {
  const original = await importOriginal<typeof import('node:fs/promises')>();
  return { ...original, open: async (...args: Parameters<typeof original.open>) => {
    const handle = await original.open(...args);
    if (String(args[0]).endsWith('/cancel.bin')) reading.hook?.(handle);
    return handle;
  } };
});

it('stops a cancelled capture at the in-flight read boundary, closes the file, and preserves the cancellation reason', async () => {
  const root = await mkdtemp(join(tmpdir(), 'exploration-cancel-'));
  const entered = Promise.withResolvers<void>(), release = Promise.withResolvers<void>();
  const controller = new AbortController(), reason = new Error('consumer disconnected');
  let reads = 0, closed = false;
  try {
    await writeFile(join(root, 'cancel.bin'), Buffer.alloc(3 * 1024 * 1024, 91));
    reading.hook = handle => {
      const read = handle.read.bind(handle), close = handle.close.bind(handle);
      handle.read = (async (...args: Parameters<typeof read>) => {
        const result = await read(...args); reads++;
        if (reads === 1) { entered.resolve(); await release.promise; }
        return result;
      }) as typeof handle.read;
      handle.close = async () => { await close(); closed = true; };
    };
    const source = new ExplorationSourceApplicability(() => root);
    const result = source.capture({ projectId: 'project', workspaceId: 'workspace', sourceSet: { kind: 'workspace_paths', paths: ['.'] } }, controller.signal);
    await entered.promise;
    controller.abort(reason); release.resolve();
    await expect(result).rejects.toBe(reason);
    expect(reads).toBe(1);
    expect(closed).toBe(true);
  } finally { release.resolve(); reading.hook = undefined; await rm(root, { recursive: true, force: true }); }
});

it('propagates an already-cancelled capture without resolving its workspace and preserves unavailable for ordinary read failure', async () => {
  const controller = new AbortController(), reason = new Error('cancelled before capture'); controller.abort(reason);
  const rootFor = vi.fn(() => '/missing-exploration-workspace');
  const source = new ExplorationSourceApplicability(rootFor);
  const query = { projectId: 'project', workspaceId: 'workspace', sourceSet: { kind: 'workspace_paths' as const, paths: ['.'] } };
  await expect(source.capture(query, controller.signal)).rejects.toBe(reason);
  expect(rootFor).not.toHaveBeenCalled();
  expect(await source.capture(query)).toMatchObject({ status: 'unavailable' });
});

it('preserves the versioned full-byte digest beyond read-block boundaries and rejects overflow', async () => {
  const root = await mkdtemp(join(tmpdir(), 'exploration-block-'));
  try {
    const body = Buffer.alloc(2 * 1024 * 1024 + 17, 91), path = join(root, 'large.bin');
    await writeFile(path, body);
    await writeFile(join(root, 'empty.bin'), '');
    const mode = (await stat(path)).mode & 511, emptyMode = (await stat(join(root, 'empty.bin'))).mode & 511;
    const expected = createHash('sha256').update('exploration-source-v1\n')
      .update(canonicalJson(['empty.bin', 'file', emptyMode, createHash('sha256').update('').digest('hex')]))
      .update(canonicalJson(['large.bin', 'file', mode, createHash('sha256').update(body).digest('hex')])).digest('hex');
    expect(await explorationSourceDigest(root)).toBe(expected);
    await expect(explorationSourceDigest(root, { maxEntries: 2, maxBytes: body.length - 1, maxDepth: 1 })).rejects.toThrow('字节上限');
    body[body.length - 1] = 92; await writeFile(path, body);
    expect(await explorationSourceDigest(root)).not.toBe(expected);
  } finally { await rm(root, { recursive: true, force: true }); }
});

it('re-reads the complete exploration tree and detects changes outside ordinary code fingerprint roots', async () => {
  const root = await mkdtemp(join(tmpdir(), 'exploration-pin-'));
  try {
    await mkdir(join(root, 'dist'));
    await writeFile(join(root, 'dist', 'source.bin'), Buffer.from([0, 1, 2]));
    const scope = { projectId: 'project', workspaceId: 'workspace' };
    const source = new ExplorationSourceApplicability((p, w) => { if (p !== scope.projectId || w !== scope.workspaceId) throw Error('wrong scope'); return root; });
    const captured = await source.capture({ ...scope, sourceSet: { kind: 'workspace_paths', paths: ['.'] } });
    expect(captured.status).toBe('sourced');
    if (captured.status !== 'sourced') throw Error('missing pin');
    expect(captured.pin.manifestDigest).toBe(await explorationSourceDigest(root));
    expect(await materialSourcePinIsCurrent(source, captured.pin, scope)).toBe(true);
    await writeFile(join(root, 'dist', 'source.bin'), Buffer.from([0, 1, 3]));
    expect(await materialSourcePinIsCurrent(source, captured.pin, scope)).toBe(false);
    expect(await source.capture({ ...scope, sourceSet: { kind: 'workspace_paths', paths: ['dist'] } })).toMatchObject({ status: 'rejected' });
    expect(await materialSourcePinIsCurrent(source, captured.pin, { ...scope, workspaceId: 'other' })).toBe(false);
  } finally { await rm(root, { recursive: true, force: true }); }
});
