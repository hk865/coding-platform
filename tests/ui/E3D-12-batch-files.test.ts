import { afterAll, afterEach, describe, expect, it, vi } from 'vitest';
import { commitBarrier } from '../helpers/S6A-commit-barrier.js';
import { findClass } from './helpers/boot-page.js';
import type { FakeElement } from './helpers/dom.js';
import { descendants, hasClass, textOf } from './helpers/E3N-page.js';
import { click } from './helpers/E3N-interact.js';
import { bootDecide, card, callsOf, count, opened, quiet, sectionRows, settle, worldTarget } from './helpers/E3D-page.js';
import { openE3GW1, type E3GWorld } from './helpers/E3G-world.js';
import { S6A_SCOPE, type S6ASession } from '../helpers/S6A-request-fixture.js';
import {
  dexcCommand, dexcNextCard, dexcProposal, openS7D2ColdStartWorld, type S7D2ColdStartWorld,
} from '../helpers/S7D2-coldstart-world.js';
import type { ArchitectureCatalogPinV1 } from '../../src/contracts/architecture-catalog.js';
const worlds: S7D2ColdStartWorld[] = [];
let w1: E3GWorld | null = null;
vi.mock('../../src/core/record-store/in-memory-record-store.js', async (importOriginal) =>
  (await import('../helpers/S6A-commit-barrier.js')).inMemoryBarrierModule(importOriginal));
vi.mock('../../src/core/record-store/sqlite-record-store.js', async (importOriginal) =>
  (await import('../helpers/S6A-commit-barrier.js')).sqliteBarrierModule(importOriginal));
afterEach(async () => {
  const left = commitBarrier.reset();
  await Promise.allSettled(worlds.splice(0).map((world) => world.close()));
  expect(left).toEqual([]);
});
afterAll(async () => { await w1?.world.close(); });
async function completedWorld(): Promise<{ cold: S7D2ColdStartWorld; src: S6ASession; pin: ArchitectureCatalogPinV1 }> {
  const cold = await openS7D2ColdStartWorld({ backend: 'memory' });
  worlds.push(cold);
  await cold.initialize();
  const { final } = await cold.walkToCompleted();
  const entry = (final.explorations ?? []).find((candidate) => candidate.queryRunRef.runId.endsWith(':src'))!;
  const src = await cold.lineOf(entry.sessionRef, 'e3d12-src');
  await cold.waitFor('the src line free', async () => (await cold.host.readSession(src.ref)).record.occupancy === null);
  return { cold, src, pin: await cold.pin() };
}
/** The open card's 详情 rows: the `dd`'s own text (before its file spans) and each `d-file`. */
function factRows(root: FakeElement): Array<{ key: string; value: string; files: Array<{ full: string; parts: string[] }> }> {
  const open = card(root);
  const list = open === undefined ? undefined : descendants(open).find((element) => hasClass(element, 'dc-facts') && element.getAttribute('aria-label') === '详情');
  if (list === undefined) return [];
  const rows: Array<{ key: string; value: string; files: Array<{ full: string; parts: string[] }> }> = [];
  for (const child of descendants(list)) {
    const tag = child.tagName.toLowerCase();
    if (tag === 'dt') rows.push({ key: textOf(child), value: '', files: [] });
    else if (tag === 'dd' && rows.length > 0) {
      const row = rows[rows.length - 1]!;
      row.value = child.childNodes.filter((node) => node.nodeType === 3).map((node) => node.textContent).join('').trim();
      row.files = descendants(child).filter((element) => hasClass(element, 'd-file')).map((file) => ({
        full: file.getAttribute('title') ?? '',
        parts: descendants(file).filter((part) => part.tagName.toLowerCase() === 'span').map(textOf),
      }));
    }
  }
  return rows;
}
describe('E3D-12 the structural proposal card file list', () => {
  it('X8-1 详情 lists the new module and the changed architecture file, read once with the card pin', async () => {
    const { cold, src, pin } = await completedWorld();
    await cold.host.scripted.script(src, dexcProposal('e3d12', pin, [{ op: 'add_module', module: {
      ref: { projectId: S6A_SCOPE.projectId, moduleId: 'extra' }, name: 'extra', responsibility: 'own extra',
      paths: ['src/extra'], interfaces: [],
    } }], 'E3D-12 new module'));
    expect((await dexcCommand(cold.host, 'deepen', 'e3d12', {
      module: { projectId: S6A_SCOPE.projectId, moduleId: 'src' },
    })).result).toMatchObject({ status: 'committed' });
    const proposalCard = await dexcNextCard(cold);
    const batchRef = (proposalCard.objects[0] as { pin: { ref: unknown } }).pin.ref;
    const { page, log } = await bootDecide(worldTarget(cold.host));
    try {
      await opened(log);
      const row = sectionRows(page.root, '要决定').find((entry) => textOf(entry).includes('结构提案'));
      expect(row).toBeDefined();
      click(row!);
      await settle(() => card(page.root) !== undefined, 3_000);
      const more = findClass(card(page.root)!, 'dc-more');
      expect(more).toBeDefined();
      click(more!);
      await quiet(log);
      const facts = factRows(page.root);
      expect(facts.find((fact) => fact.key === '会新建')?.value).toContain('新模块 extra 的文件，批准时定名');
      const modify = facts.find((fact) => fact.key === '会修改');
      expect(modify?.value).toBe('平台写的');
      expect(modify?.files).toEqual([{ full: '.workbench/architecture.json', parts: ['.workbench/', 'architecture.json'] }]);
      const calls = callsOf(log, 'architecture/proposal-batch-files');
      expect(calls.length).toBeGreaterThan(0);
      for (const call of calls) expect((call.input as { batchRef?: unknown }).batchRef).toEqual(batchRef);
    } finally {
      await page.restore();
    }
  }, 300_000);
  it('X8-2 a queue with no structural card reads no batch file list', async () => {
    w1 ??= await openE3GW1();
    const { page, log } = await bootDecide(worldTarget(w1.world));
    try {
      await opened(log);
      expect(sectionRows(page.root, '要决定').length).toBeGreaterThan(0);
      /* 具名改坏: 每页都读一次清单 → 本行的 0 红。 */
      expect(count(log, 'architecture/proposal-batch-files')).toBe(0);
    } finally {
      await page.restore();
    }
  }, 60_000);
});
