/**
 * KLS-2c-1a write side (platform level, memory: business rows): a knowledge write takes its checkout's cross-Host
 * lease (the Host's own `acquireHostInstanceLease` over a directory the platform makes from the line) for the whole
 * write, stops at the test seam's two points, and lands a file by an atomic rename. The world is `openKLS2AWorld` (a
 * real platform over a real git root); prior states come from public writes, the platform options a Host passes
 * (`acquireKnowledgeLease`, `knowledgeWriteHold`), another holder of the same lease and a person's file in the way.
 * Every assertion reads a public answer or the files. The write log and its completion are store facts: the
 * reconciliation and recovery rows of the later packages read them through the product.
 */
import { createHash } from 'node:crypto';
import { readdirSync, realpathSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { acquireHostInstanceLease } from '../../src/app/host-instance-lease.js';
import type { TargetPlatformOptions } from '../../src/composition/create-platform.js';
import type { NoteDraftV1 } from '../../src/contracts/note.js';
import type { WriteNoteResult } from '../../src/core/work-graph/model/note-contracts.js';
import { openKLS2AWorld, type KLS2AWorld } from '../helpers/KLS2A-knowledge-world.js';

const closers: (() => Promise<void>)[] = [];
afterEach(async () => {
  for (const close of closers.splice(0).reverse()) await close();
});

const now = () => '2026-11-12T00:00:00.000Z';
/** What a Host passes: its own instance lease over the directory the platform hands it. */
const hostLease: TargetPlatformOptions['acquireKnowledgeLease'] = directory => acquireHostInstanceLease({ directory, now });

async function knowledgeWorld(platform: Partial<TargetPlatformOptions> = {}): Promise<KLS2AWorld> {
  const world = await openKLS2AWorld({ platform });
  closers.push(() => world.close());
  return world;
}

async function adoptOneModule(world: KLS2AWorld): Promise<void> {
  const adopted = await world.platform.architecture.adoptInitialArchitecture(world.ctx(), {
    meta: { requestId: 'kls2c1a-adopt', expected: await world.scopePins() },
    input: { baselineId: 'kls2c1a-baseline', description: 'd', constraints: [], catalog: { requireDag: true, dependencies: [],
      modules: [{ ref: { projectId: world.projectId, moduleId: 'core' }, name: 'core', responsibility: 'own core',
        paths: ['src/core'], interfaces: [] }] } } });
  expect(adopted, JSON.stringify(adopted)).toMatchObject({ status: 'committed' });
}

const NOTE: NoteDraftV1 = { kind: 'decision', topic: 'kls2c1a', conclusion: 'c', body: 'b',
  anchor: { kind: 'module', moduleId: 'core' }, extraAnchors: [], facts: [], basisFiles: [], structural: false,
  replaces: [], contradicts: [], coexistWith: [] } as NoteDraftV1;

function writeNote(world: KLS2AWorld, commandId: string): Promise<WriteNoteResult> {
  return world.platform.notes.writeNote(world.ctx(), { commandId, note: NOTE, expectedPointerRevision: null, goalId: null });
}

const notes = (world: KLS2AWorld): string[] => world.files('.workbench/notes/ws');

/** Hand-computed: `<realpath(.git)>/workbench/leases/<first 16 hex of sha256(realpath(root))>`. */
function leaseDirectoryOf(world: KLS2AWorld): string {
  const key = createHash('sha256').update(realpathSync(world.root)).digest('hex').slice(0, 16);
  return join(realpathSync(join(world.root, '.git')), 'workbench', 'leases', key);
}

describe('KLS2C1A knowledge write', () => {
  it('[2C1-04][2C1-08][2C1-09] holds the lease through the write and stops after the commit (no file) and after the files',
    async () => {
      const seen: { point: string; notes: number; leaseFiles: number }[] = [];
      let watching: KLS2AWorld | null = null;
      const world = await knowledgeWorld({ acquireKnowledgeLease: hostLease, knowledgeWriteHold: async point => {
        const live = watching;
        if (live !== null) seen.push({ point, notes: notes(live).length, leaseFiles: readdirSync(leaseDirectoryOf(live)).length });
      } });
      await adoptOneModule(world);
      const before = notes(world).length;
      watching = world;
      expect(await writeNote(world, 'kls2c1a-hold')).toMatchObject({ status: 'accepted' });
      watching = null;
      expect(seen).toEqual([
        { point: 'committed', notes: before, leaseFiles: 1 },
        { point: 'applied', notes: before + 1, leaseFiles: 1 },
      ]);
      expect(readdirSync(leaseDirectoryOf(world))).toEqual([]);
    });

  it('[2C1-06] a written knowledge file is 0600 and leaves no temporary file beside it', async () => {
    const world = await knowledgeWorld();
    await adoptOneModule(world);
    const written = await writeNote(world, 'kls2c1a-atomic');
    if (written.status === 'rejected') throw new Error(JSON.stringify(written));
    expect(statSync(join(world.root, `.workbench/notes/ws/${written.noteId}.md`)).mode & 0o777).toBe(0o600);
    expect(notes(world).filter(name => name.includes('.tmp-'))).toEqual([]);
  });

  describe('rejects: the checkout cannot be leased', () => {
    it('[2C1-04] another Host holds the checkout\'s lease: unavailable, no file; once it lets go the write goes in', async () => {
      const world = await knowledgeWorld({ acquireKnowledgeLease: hostLease });
      await adoptOneModule(world);
      const other = await acquireHostInstanceLease({ directory: leaseDirectoryOf(world), now });
      expect(other.lease).toBe('owned');
      const files = notes(world);
      const refused = await writeNote(world, 'kls2c1a-held');
      expect(refused).toMatchObject({ status: 'rejected', code: 'unavailable' });
      expect(JSON.stringify(refused)).toContain('另一个 Host 正在写这个检出');
      expect(notes(world)).toEqual(files);
      await other.release();
      expect(await writeNote(world, 'kls2c1a-after-release')).toMatchObject({ status: 'accepted' });
      expect(notes(world).length).toBe(files.length + 1);
    });

    it('[2C1-05] the lease directory cannot be made: unavailable as such, no file', async () => {
      const world = await knowledgeWorld({ acquireKnowledgeLease: hostLease });
      await adoptOneModule(world);
      const files = notes(world);
      rmSync(join(world.root, '.git', 'workbench'), { recursive: true });
      writeFileSync(join(world.root, '.git', 'workbench'), 'a file where the lease folders go');
      const refused = await writeNote(world, 'kls2c1a-no-dir');
      expect(refused).toMatchObject({ status: 'rejected', code: 'unavailable' });
      expect(JSON.stringify(refused)).toContain('租约目录建不了');
      expect(JSON.stringify(refused)).not.toContain('另一个 Host');
      expect(notes(world)).toEqual(files);
    });
  });
});
