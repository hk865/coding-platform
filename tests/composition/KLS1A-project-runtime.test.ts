/**
 * KLS-1a project runtime registry (R1-R9, M1): the project store directory, the
 * old layout, the per-project lease, close order, reopen, memory and records.
 * Real platform and real lease only; the location detector is injected.
 */
import { afterEach, expect, it } from 'vitest';
import { existsSync } from 'node:fs';
import { mkdir, readFile, readdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import {
  PROJECT_ID, WORKSPACE_ID, cleanupRestart, hostCtx, openRegistry, projectKey, realFactory, reliableLocation,
  tempDir, type FactoryInput, type RegistryFixture,
} from '../helpers/KLS1A-project-store-fixture.js';

afterEach(cleanupRestart);

const workspace = (root: string) => [{ workspaceId: WORKSPACE_ID, root }];
const projectInput = { input: { projectId: PROJECT_ID },
  meta: { requestId: 'kls1a-p',
    expected: [{ ref: { aggregateType: 'Project', projectId: PROJECT_ID }, revision: 0 }] } };

/** The old single-store layout's refusal, exactly as the design words it. */
const oldLayoutReason = 'store layout changed: the old single-store layout is not loaded or migrated';

it('R1: create makes the project store and the Kernel directory; a reopened registry reads the project',
  async () => {
    const first = await openRegistry();
    const opened = await first.registry.open(PROJECT_ID, workspace(first.root), { create: true });
    expect(opened.status).toBe('ready');
    expect(first.seen[0]!.storage).toEqual({ kind: 'sqlite', directory: first.D });
    expect(first.seen[0]!.kernelDirectory).toBe(join(first.D, 'kernel-stores'));
    expect(existsSync(join(first.D, 'kernel-stores'))).toBe(true);
    const ctx = hostCtx(PROJECT_ID, WORKSPACE_ID);
    expect((await opened.value.platform.projects.createProject(ctx, projectInput)).status).toBe('committed');
    await first.registry.closeAll();

    const second = await openRegistry({ root: first.root, legacyDirectory: first.legacyDirectory });
    const reopened = await second.registry.open(PROJECT_ID, workspace(first.root), { create: false });
    expect(reopened.status).toBe('ready');
    expect((await reopened.value.platform.projects.readProject(ctx, PROJECT_ID)).status).toBe('ready');
    await second.registry.closeAll();
  });

it.each(['memory', 'sqlite'] as const)('R2 %s: the runtime records are the factory records', async kind => {
  const fixture = await openRegistry(kind === 'memory' ? { storage: { kind: 'memory' } } : {});
  const opened = await fixture.registry.open(PROJECT_ID, workspace(fixture.root), { create: true });
  const receipt = await opened.value.platform.projects.createProject(
    hostCtx(PROJECT_ID, WORKSPACE_ID), projectInput);
  expect(receipt.status).toBe('committed');
  const read = await opened.value.records.readMany([projectKey(PROJECT_ID)]);
  expect(read.status).toBe('ready');
  expect(read.value.readThrough).toBe(receipt.cursor);
  await fixture.registry.closeAll();
});

it('R3: a missing store with create:false is unavailable and creates no directory', async () => {
  const fixture = await openRegistry();
  const result = await fixture.registry.open(PROJECT_ID, workspace(fixture.root), { create: false });
  expect(result.status).toBe('rejected');
  expect(result.code).toBe('unavailable');
  expect(existsSync(fixture.D)).toBe(false);
  expect(existsSync(join(fixture.root, '.workbench'))).toBe(false);
});

it('R4: the old single-store layout is unsupported, with no new directory and the old file kept',
  async () => {
    const fixture = await openRegistry();
    await writeFile(join(fixture.legacyDirectory, 'ledger.sqlite'), '');
    const result = await fixture.registry.open(PROJECT_ID, workspace(fixture.root), { create: true });
    expect(result.code).toBe('unsupported');
    expect(result.status).toBe('rejected');
    expect(result.reason).toBe(oldLayoutReason);
    expect(existsSync(fixture.D)).toBe(false);
    expect(existsSync(join(fixture.legacyDirectory, 'ledger.sqlite'))).toBe(true);
  });

it('R5: each project has its own lease, so a second registry is held only on the same project',
  async () => {
    const first = await openRegistry();
    const second = await openRegistry({ legacyDirectory: first.legacyDirectory });
    const otherRoot = await tempDir('kls1a-project-b-');
    const a = await first.registry.open('project-a', workspace(first.root), { create: true });
    expect(a.value.lease.lease).toBe('owned');
    const sameProject = await second.registry.open('project-a', workspace(first.root), { create: false });
    expect(sameProject.status).toBe('ready');
    expect(sameProject.value.lease.lease).toBe('held_by_other');
    const otherProject = await second.registry.open('project-b',
      [{ workspaceId: 'kls1a-workspace-b', root: otherRoot }], { create: true });
    expect(otherProject.value.lease.lease).toBe('owned');
    await first.registry.closeAll();
    await second.registry.closeAll();
  });

it('R6: close closes the platform before releasing the lease, and then another registry owns it',
  async () => {
    let observed = false;
    let fixture: RegistryFixture | undefined;
    fixture = await openRegistry({
      createPlatform: async (input: FactoryInput) => {
        const made = await realFactory(fixture!.seen)(input);
        const close = made.platform.close.bind(made.platform);
        made.platform.close = async () => {
          observed = existsSync(join(fixture!.D, 'host-instance.lock'));
          await close();
        };
        return made;
      },
    });
    const opened = await fixture.registry.open(PROJECT_ID, workspace(fixture.root), { create: true });
    expect(opened.status).toBe('ready');
    await fixture.registry.closeAll();
    expect(observed).toBe(true);
    expect(fixture.registry.get(PROJECT_ID)).toBeNull();

    const again = await openRegistry({ root: fixture.root, legacyDirectory: fixture.legacyDirectory });
    const reopened = await again.registry.open(PROJECT_ID, workspace(fixture.root), { create: false });
    expect(reopened.value.lease.lease).toBe('owned');
    await again.registry.closeAll();
  });

it('R7: a factory failure releases the lease and answers unavailable; the next open owns it', async () => {
  let calls = 0;
  const seen: FactoryInput[] = [];
  const delegate = realFactory(seen);
  const fixture = await openRegistry({
    createPlatform: async (input: FactoryInput) => {
      calls += 1;
      if (calls === 1) throw new Error('boom');
      return await delegate(input);
    },
  });
  const failed = await fixture.registry.open(PROJECT_ID, workspace(fixture.root), { create: true });
  expect(failed.status).toBe('rejected');
  expect(failed.code).toBe('unavailable');
  const retried = await fixture.registry.open(PROJECT_ID, workspace(fixture.root), { create: true });
  expect(retried.status).toBe('ready');
  expect(retried.value.lease.lease).toBe('owned');
  await fixture.registry.closeAll();
});

it('R8: a new workspace-local store adds local/ to .workbench/.gitignore and keeps the rest', async () => {
  const plain = await tempDir('kls1a-ignore-');
  await mkdir(join(plain, '.workbench'), { recursive: true });
  await writeFile(join(plain, '.workbench', '.gitignore'), 'build/\n');
  const fixture = await openRegistry({ root: plain });
  const opened = await fixture.registry.open(PROJECT_ID, workspace(plain), { create: true });
  expect(opened.status).toBe('ready');
  await fixture.registry.closeAll();

  const again = await openRegistry({ root: plain, legacyDirectory: fixture.legacyDirectory });
  await again.registry.open(PROJECT_ID, workspace(plain), { create: false });
  const text = await readFile(join(plain, '.workbench', '.gitignore'), 'utf8');
  expect(text.replace(/\n+$/, '').split('\n')).toEqual(['build/', 'local/']);
  await again.registry.closeAll();
});

it('R9: opening the same project twice returns the same runtime and opens one platform', async () => {
  const fixture = await openRegistry();
  const first = await fixture.registry.open(PROJECT_ID, workspace(fixture.root), { create: true });
  const second = await fixture.registry.open(PROJECT_ID,
    [{ workspaceId: 'kls1a-second-workspace', root: fixture.root }], { create: false });
  expect(second.value).toBe(first.value);
  expect(fixture.seen.length).toBe(1);
  await fixture.registry.closeAll();
});

it('M1: a memory store computes no location, creates no directory and holds the memory lease', async () => {
  const root = await tempDir('kls1a-memory-');
  let locationCalls = 0;
  const fixture = await openRegistry({
    root,
    storage: { kind: 'memory' },
    location: async (projectId: string, at: string) => {
      locationCalls += 1;
      return await reliableLocation(projectId, at);
    },
  });
  const opened = await fixture.registry.open(PROJECT_ID, workspace(root), { create: true });
  expect(locationCalls).toBe(0);
  expect(opened.value.paths).toBeNull();
  expect(opened.value.storeLocation).toBeNull();
  expect(opened.value.lease.row).toBe('memory');
  expect(fixture.seen[0]!.storage).toEqual({ kind: 'memory' });
  expect(fixture.seen[0]!.kernelDirectory).toBeNull();
  expect(await readdir(root)).not.toContain('.workbench');
  await fixture.registry.closeAll();
});
