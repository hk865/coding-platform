/**
 * KC-1 G2 (121-106 ①/③; 4-2 A, 4-9; draft §3 V18–V20): `architecture/proposal-batch-files` lists the files a structural
 * proposal batch would create, modify or delete if approved now, with each file's source and no write at all (the
 * read-time hint). The rows are the draft's V18 (a modify whose source is the recorded projection, then the person's
 * hand edit shows as uncommitted), V19 (a new module: `path: null` with the new module id, and the changed
 * architecture.json as a modify) and V20 (the route refuses an empty input). The world is
 * `S7D2-coldstart-world.ts` walked to `completed`, then one `deepen` on the `src` line with the proposal the row
 * scripts (`dexcProposal`, `dexcCommand`, `dexcNextCard`); the card's batch ref is its first object's pin (the same
 * public read the DEXC rows use). No store is read; the module file's path comes from the real `.workbench/modules`
 * folder under the world's root, as a person sees it.
 *
 * **Today (base `7dkc1t-base`) V18 and V19 are red at the route**: it is unpublished, so the Host answers
 * `{status:'rejected', code:'not_found', reason:'unpublished core route architecture/proposal-batch-files'}` and
 * `readyValue` stops there (after the cold start + card, which do work today). V20 is red too (the missing route's
 * `not_found` is not `invalid`). After the package lands every row is green by the draft's §2.4: the read drafts the
 * batch's revision without writing, lists each change with `platformFileSource` against the recorded projection, and
 * returns `invalid` for a body without a batch ref.
 */
import { readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { ArchitectureCatalogPinV1 } from '../../src/contracts/architecture-catalog.js';
import type { DecisionCardV1 } from '../../src/core/work-graph/model/decision-contracts.js';
import { plain } from '../helpers/AG2b-collaboration-fixture.js';
import { commitBarrier } from '../helpers/S6A-commit-barrier.js';
import { S6A_SCOPE, type S6ASession } from '../helpers/S6A-request-fixture.js';
import { kls2cModuleFile } from '../helpers/KLS2C-knowledge-host.js';
import { readyValue } from '../helpers/S6A-memory-fixture.js';
import {
  dexcCommand, dexcNextCard, dexcProposal, openS7D2ColdStartWorld, type S7D2ColdStartWorld,
} from '../helpers/S7D2-coldstart-world.js';

vi.mock('../../src/core/record-store/in-memory-record-store.js', async importOriginal =>
  (await import('../helpers/S6A-commit-barrier.js')).inMemoryBarrierModule(importOriginal));
vi.mock('../../src/core/record-store/sqlite-record-store.js', async importOriginal =>
  (await import('../helpers/S6A-commit-barrier.js')).sqliteBarrierModule(importOriginal));

const worlds: S7D2ColdStartWorld[] = [];
afterEach(async () => {
  const left = commitBarrier.reset();
  await Promise.allSettled(worlds.splice(0).map(world => world.close()));
  expect(left).toEqual([]);
});

/** A completed cold start (depth 2, the region rounds answer in text) and its free `src` region line. */
async function completedWorld(): Promise<{ cold: S7D2ColdStartWorld; src: S6ASession; pin: ArchitectureCatalogPinV1 }> {
  const cold = await openS7D2ColdStartWorld({ backend: 'memory' });
  worlds.push(cold);
  await cold.initialize();
  const { final } = await cold.walkToCompleted();
  const entry = (final.explorations ?? []).find(candidate => candidate.queryRunRef.runId.endsWith(':src'))!;
  const src = await cold.lineOf(entry.sessionRef, 'kc1t-src');
  await cold.waitFor('the src line free', async () => (await cold.host.readSession(src.ref)).record.occupancy === null);
  return { cold, src, pin: await cold.pin() };
}

type BatchFile = { workspaceId: string; path: string | null; moduleId: string | null;
  action: 'create' | 'modify' | 'delete'; source: string | null };

/** `architecture/proposal-batch-files {batchRef}`; the row names the route's own refusal when it is not ready. */
async function batchFiles(cold: S7D2ColdStartWorld, batchRef: unknown): Promise<BatchFile[]> {
  const answer = await cold.host.post('architecture/proposal-batch-files', plain(S6A_SCOPE, { batchRef }));
  return readyValue<{ files: BatchFile[] }>(answer.body, 'architecture/proposal-batch-files').files;
}

/** The structural card's batch: the first object's aggregate pin (`S7D2-DEXC-repropose.test.ts` reads it the same). */
const batchOf = (card: DecisionCardV1): unknown => (card.objects[0] as { pin: { ref: unknown } }).pin.ref;

it('V18 a modify\'s source is the recorded projection first, then uncommitted after the person edits the file; the '
  + 'current pin does not move (rulings 4-2 A, 4-9)', async () => {
  const { cold, src, pin } = await completedWorld();
  await cold.host.scripted.script(src, dexcProposal('kc1t18', pin,
    [{ op: 'set_module_name', moduleId: 'src', name: 'KC1T batch files' }], 'KC1T batch files'));
  expect((await dexcCommand(cold.host, 'deepen', 'kc1t18', { module: { projectId: S6A_SCOPE.projectId, moduleId: 'src' } }))
    .result).toMatchObject({ status: 'committed' });
  const card = await dexcNextCard(cold);
  const modulePath = kls2cModuleFile(cold.host, 'src');
  // 具名改坏：来源只看 git 状态、不比记录里的投影 → 第一次就读成 uncommitted，红在第一行；来源恒为 platform → 红在第二行。
  // 今天红在 `batchFiles`：`architecture/proposal-batch-files` 还没发布（Host 回 not_found）。
  expect(await batchFiles(cold, batchOf(card))).toEqual([{ workspaceId: S6A_SCOPE.workspaceId,
    path: modulePath, moduleId: 'src', action: 'modify', source: 'platform' }]);
  const absolute = join(cold.host.root, modulePath);
  const file = JSON.parse(await readFile(absolute, 'utf8')) as Record<string, unknown>;
  file['responsibility'] = 'KC1T changed by a person';
  await writeFile(absolute, `${JSON.stringify(file, null, 2)}\n`);
  expect(await batchFiles(cold, batchOf(card))).toEqual([{ workspaceId: S6A_SCOPE.workspaceId,
    path: modulePath, moduleId: 'src', action: 'modify', source: 'uncommitted' }]);
  // 读两次不改任何记录：current pin 前后一样（4-9：读那一刻的提示，不钉住）。
  expect(await cold.pin()).toEqual(pin);
}, 300_000);

it('V19 a new module is a create with path: null and its new id, and the changed architecture.json is a modify '
  + '(draft §9-5)', async () => {
  const { cold, src, pin } = await completedWorld();
  await cold.host.scripted.script(src, dexcProposal('kc1t19', pin, [{ op: 'add_module', module: {
    ref: { projectId: S6A_SCOPE.projectId, moduleId: 'extra' }, name: 'extra', responsibility: 'own extra',
    paths: ['src/extra'], interfaces: [],
  } }], 'KC1T new module'));
  expect((await dexcCommand(cold.host, 'deepen', 'kc1t19', { module: { projectId: S6A_SCOPE.projectId, moduleId: 'src' } }))
    .result).toMatchObject({ status: 'committed' });
  const card = await dexcNextCard(cold);
  // 具名改坏：create 写成 modify（或带上随机取到的文件名）→ 红在下面两行。今天红在 `batchFiles`（路由未发布）。
  const files = await batchFiles(cold, batchOf(card));
  expect(files.find(file => file.moduleId === 'extra')).toEqual({ workspaceId: S6A_SCOPE.workspaceId,
    path: null, moduleId: 'extra', action: 'create', source: null });
  expect(files.find(file => file.path === '.workbench/architecture.json')).toEqual({
    workspaceId: S6A_SCOPE.workspaceId, path: '.workbench/architecture.json', moduleId: null,
    action: 'modify', source: 'platform' });
}, 300_000);

describe('rejects: architecture/proposal-batch-files input', () => {
  it('V20 an empty input is invalid', async () => {
    const cold = await openS7D2ColdStartWorld({ backend: 'memory' });
    worlds.push(cold);
    // 具名改坏：去掉 batchRef 的核对 → 空输入不是 invalid。今天红（未发布的路由回 not_found）。
    expect((await cold.host.post('architecture/proposal-batch-files', plain(S6A_SCOPE, {}))).body)
      .toMatchObject({ status: 'rejected', code: 'invalid' });
  }, 120_000);
});
