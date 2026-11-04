/**
 * S8E-2 R F-broken (8E-2 §4.3 :800, :806, :809, :812, :813, :816, :848, :849, :853): the first-tier
 * link read (R5 :345–360, R7 :371–379, R10 :385) and the E6 re-check route (R13 :421; shape §2.0 :250–252)
 * on the one S8E semantic world (8E §5.2 :604–711; K1–K7 at `tests/helpers/S8E-semantic-world.ts:262–340`).
 *
 * Rows and the spec lines their expectations come from:
 * - E-15 (8E-2 :806; 8E :729): K1 with basisFiles, `start` renamed, re-checked, then `authorize` deleted.
 * - E-26 (8E-2 :809; 8E :741): one line inserted before compose.ts line 1, the member rule (R5 4).
 * - E-33 (8E-2 :812; 8E :748): the bus.ts callback; `onSelected` deleted (R5 3).
 * - E-34 (8E-2 :813; 8E :749): the flow [K1, K2] over a broken K1, then K1 superseded.
 * - E-40 (8E-2 :816; 8E :755): a definite break over an unreadable file, a whole-call second-tier
 *   failure (not remembered, R7 :375), a forbidden write read (M1).
 * - E2-23a, E2-23b (8E-2 :848–849; files §4.2 :737–739): the wire5.ts `calls`, R5 5 and R5 4 (top level).
 * - E2-25 (8E-2 :853): a retired "via" makes the link not current (R10).
 *
 * Entries: E-15 and E2-23a/b write by a real Work Run's `record_note` (E1, `world.writeAgent`); the others
 * by the person `notes/write` (E2). E3 is the Host route `architecture/semantic-links` /
 * `architecture/semantic-flows`, E5 the owner reads, E6 `architecture/semantic-links/check`. "建 n" is the
 * second-tier build count of that one step (`world.linkCheck.builds()` before and after, §4.1 :708).
 * One world per row (R7 keeps verdicts per Host). Memory only (:800, S3).
 */
import { readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import type { ReadResult } from '../../src/contracts/core/results.js';
import type { NoteDraftV1 } from '../../src/contracts/note.js';
import type { SemanticFlowV1, SemanticLinkV1, SemanticPageV1 } from '../../src/contracts/semantic-layer.js';
import type { WriteNoteResult } from '../../src/core/work-graph/model/note-contracts.js';
import {
  openS8ESemanticWorld, s8eLinkDraft, S8E_LINKS, type S8ELinkName, type S8ESemanticWorld,
} from '../helpers/S8E-semantic-world.js';

const COMPOSE = 'src/compose.ts';
const PERMIT = 'src/wg/permit.ts';
const BUS = 'src/runtime/bus.ts';
const WIRE5 = 'src/wire5.ts';
const K1 = S8E_LINKS.K1;
const K3 = S8E_LINKS.K3;
// compose.ts line 7 and line 10 (8E :676, :679) and the rows' replacements.
const LINE7 = 'const access: Access = { beforeCall: authorize };';
const LINE7_BEFORE = 'const access: Access = { before: authorize };';
const LINE10_BEGIN = 'export const begin = (id: string) => runModel(access, id);';

const tsEnd = (path: string, name: string) =>
  ({ kind: 'file' as const, path, symbolRequest: { language: 'typescript', name } });

/** Replaces `count` lines from 1-based `line` with `insert` (count 0 inserts before it). */
async function editLines(world: S8ESemanticWorld, path: string, line: number, count: number,
  insert: readonly string[] = []): Promise<void> {
  const target = join(world.root, path);
  const lines = (await readFile(target, 'utf8')).split('\n');
  lines.splice(line - 1, count, ...insert);
  await writeFile(target, lines.join('\n'), 'utf8');
}

function idOf(write: WriteNoteResult): string {
  if (write.status !== 'accepted') throw new Error(`expected accepted, got ${JSON.stringify(write)}`);
  return write.noteId;
}

async function personIds(world: S8ESemanticWorld, names: readonly S8ELinkName[]): Promise<string[]> {
  const ids: string[] = [];
  for (const name of names) ids.push(idOf(await world.writePerson(s8eLinkDraft(S8E_LINKS[name]))));
  return ids;
}

/** E1: one real Work Run `record_note`; the Kernel-delivered envelope must be accepted (A1). */
async function agentWrite(world: S8ESemanticWorld, draft: NoteDraftV1, label: string) {
  const written = await world.writeAgent(draft, { label });
  if (written.envelope === null) throw new Error(`${label}: record_note returned no {write, check}`);
  return { noteId: idOf(written.envelope.write), check: written.envelope.check };
}

function byId<T extends { noteId: string }>(items: readonly T[], noteId: string): T {
  const found = items.find(item => item.noteId === noteId);
  if (found === undefined) throw new Error(`${noteId} is not among ${JSON.stringify(items.map(item => item.noteId))}`);
  return found;
}

/** E3: the project page of `suffix` (as `pageOf`, `S8E-R-route.test.ts:50–57`). */
async function page<T>(world: S8ESemanticWorld, suffix: string, limit: number): Promise<T[]> {
  const result = await world.route(suffix, { scope: { kind: 'project' }, cursor: null, limit });
  const read = result as ReadResult<SemanticPageV1<T>>;
  if (read.status !== 'ready') throw new Error(`${suffix} was not ready: ${JSON.stringify(result)}`);
  return read.value.items;
}
const links = (world: S8ESemanticWorld) => page<SemanticLinkV1>(world, 'architecture/semantic-links', 100);
const linkOf = async (world: S8ESemanticWorld, noteId: string) => byId(await links(world), noteId);
const flowOf = async (world: S8ESemanticWorld, noteId: string) =>
  byId(await page<SemanticFlowV1>(world, 'architecture/semantic-flows', 50), noteId);

/** The route reply of §2.0 :251–252, declared here (R adds no test-visible type on the base). */
type CheckReply = { status: string; value?: { items: { noteId: string; version: number; verification: unknown }[] } };

/** E6: re-check one link and return its verification. */
async function checkOne(world: S8ESemanticWorld, noteId: string, version = 1): Promise<unknown> {
  const reply = await world.route('architecture/semantic-links/check', { items: [{ noteId, version }] }) as CheckReply;
  if (reply.status !== 'ready' || reply.value === undefined) throw new Error(`the check was not ready: ${JSON.stringify(reply)}`);
  return byId(reply.value.items, noteId).verification;
}

/** The step's value and its second-tier builds (§4.3 :800). */
async function counted<T>(world: S8ESemanticWorld, step: () => Promise<T>): Promise<{ value: T; builds: number }> {
  const before = world.linkCheck.builds();
  const value = await step();
  return { value, builds: world.linkCheck.builds() - before };
}

/** E5: the scribe `stale` read on the note's own stored anchor; the ids it lists. */
async function staleIds(world: S8ESemanticWorld, noteId: string): Promise<string[]> {
  const note = await world.platform.notes.readNote(world.humanContext(), { noteId });
  if (note.status !== 'ready') throw new Error(`readNote ${noteId} was not ready: ${JSON.stringify(note)}`);
  const stale = await world.platform.notes.memoryStale(world.humanContext(),
    { v: 1, op: 'stale', anchor: note.value.anchor, limit: 100, cursor: null });
  if (stale.status !== 'ready') throw new Error(`the stale read was not ready: ${JSON.stringify(stale)}`);
  return stale.value.items.map(item => item.noteId);
}

/**
 * E2-23's "共同" setup (8E-2 :848; the same steps as E2-23c/d in S8E-F-verify): §4.2's wire5.ts, then the
 * agent's calls run.ts#dispatch → permit.ts#onPicked, key 'wg.audit', [0] register wire5.ts line 2,
 * [1] use as K3; the write reads `verified`.
 */
async function wire5Link(world: S8ESemanticWorld, topic: string): Promise<string> {
  await writeFile(join(world.root, WIRE5), ["import { onPicked } from './wg/permit.js';",
    "export const table = { 'wg.audit': onPicked };"].join('\n') + '\n', 'utf8');
  const written = await agentWrite(world, s8eLinkDraft(K3, {
    topic, conclusion: 'dispatch calls onPicked through the wg.audit table', extraAnchors: [tsEnd(PERMIT, 'onPicked')],
    link: { relation: 'calls', key: K3.key, evidence: [
      { role: 'register', at: { path: WIRE5, range: { startLine: 2, endLine: 2 } } }, structuredClone(K3.evidence[1]!),
    ] },
  }), topic);
  expect(written.check).toMatchObject({ linkVerification: { status: 'verified' } });
  return written.noteId;
}

const flowDraft = (topic: string, steps: readonly string[]): NoteDraftV1 => ({
  kind: 'flow', topic, conclusion: `${topic} conclusion`, anchor: K1.from, extraAnchors: [], facts: [],
  basisFiles: [], structural: false, replaces: [], contradicts: [], coexistWith: [], body: '',
  flow: { steps: steps.map(link => ({ link })) },
});

describe('S8E-2 R F-broken: definite breaks and doubt on the first tier', () => {
  it('E-15 basisFiles: renamed start reads stale + refs_pending, the check verifies, deleted authorize breaks [1]',
    async () => {
      const world = await openS8ESemanticWorld({ scribeTasks: 1 });
      try {
        const { noteId: k1 } = await agentWrite(world, s8eLinkDraft(K1, { basisFiles: [COMPOSE] }), 'E-15-k1');
        await editLines(world, COMPOSE, 10, 1, [LINE10_BEGIN]);
        const changed = await counted(world, () => linkOf(world, k1));
        expect(changed.value.freshness).toBe('stale');
        expect(changed.value.verification).toEqual({ status: 'unchecked', reason: 'refs_pending' });
        expect([changed.value.from, changed.value.to, changed.value.via].map(end => end?.anchorStatus))
          .toEqual(['live', 'live', 'live']);
        expect(changed.builds).toBe(0);

        const checked = await counted(world, () => checkOne(world, k1));
        expect(checked.value).toEqual({ status: 'verified' });
        expect(checked.builds).toBe(1);
        const after = await linkOf(world, k1);
        expect(after.verification).toEqual({ status: 'verified' });
        expect(after.freshness).toBe('stale');

        await editLines(world, PERMIT, 1, 3);
        const deleted = await counted(world, () => linkOf(world, k1));
        expect(deleted.value.to).toMatchObject({ anchorStatus: 'retired', anchorRetiredReasons: ['symbol_missing'] });
        expect([deleted.value.from.anchorStatus, deleted.value.via?.anchorStatus]).toEqual(['live', 'live']);
        expect(deleted.value.verification).toEqual({ status: 'broken', missing: [1] });
        expect(deleted.value.currentEligible).toBe(false);
        expect(deleted.builds).toBe(0);
        expect(await staleIds(world, k1)).toContain(k1);
      } finally {
        await world.close();
      }
    }, 180_000);

  it('E-26 a line inserted before compose.ts line 1: K1 broken [1], K2 broken [0] (member rule), builds 0',
    async () => {
      const world = await openS8ESemanticWorld({ scribeTasks: 1 });
      try {
        const [k1, k2] = await personIds(world, ['K1', 'K2']);
        await editLines(world, COMPOSE, 1, 0, ['// shifted']);
        const read = await counted(world, () => links(world));
        expect(byId(read.value, k1!).verification).toEqual({ status: 'broken', missing: [1] });
        expect(byId(read.value, k2!).verification).toEqual({ status: 'broken', missing: [0] });
        expect(read.builds).toBe(0);
      } finally {
        await world.close();
      }
    }, 180_000);

  it('E-33 bus.ts onSelected deleted: only "via" retired, broken [0, 1], not current, builds 0', async () => {
    const world = await openS8ESemanticWorld({ scribeTasks: 1 });
    try {
      // The draft of `S8E-L2-link-write.test.ts:273–296`.
      const id = idOf(await world.writePerson(s8eLinkDraft(S8E_LINKS.K2, {
        topic: 'E-33', conclusion: 'bus select calls onSelected through the same file',
        anchor: { kind: 'file', path: BUS }, extraAnchors: [tsEnd(BUS, 'select'), tsEnd(BUS, 'onSelected')],
        link: { relation: 'callback', key: null, evidence: [
          { role: 'wire', at: { path: 'src/wire2.ts', range: { startLine: 3, endLine: 3 } } },
          { role: 'use', at: { path: BUS, symbolRequest: { language: 'typescript', name: 'select' } } },
        ] },
      })));
      await editLines(world, BUS, 2, 1);
      const read = await counted(world, () => linkOf(world, id));
      expect(read.value.via).toMatchObject({ anchorStatus: 'retired', anchorRetiredReasons: ['symbol_missing'] });
      expect([read.value.from.anchorStatus, read.value.to.anchorStatus]).toEqual(['live', 'live']);
      expect(read.value.verification).toEqual({ status: 'broken', missing: [0, 1] });
      expect(read.value.currentEligible).toBe(false);
      expect(read.builds).toBe(0);
    } finally {
      await world.close();
    }
  }, 180_000);

  it('E-34 flow [K1, K2]: step 1 broken and the flow stale; K1 superseded: not_current, item null, gapsAfter [1]',
    async () => {
      const world = await openS8ESemanticWorld({ scribeTasks: 1 });
      try {
        const [k1, k2] = await personIds(world, ['K1', 'K2']);
        const flow = idOf(await world.writePerson(flowDraft('E-34', [k1!, k2!])));
        await editLines(world, COMPOSE, 7, 1, [LINE7_BEFORE]);
        const changed = await flowOf(world, flow);
        expect(changed.steps[0]?.problem).toBe('broken');
        expect(changed.freshness).toBe('stale');

        // Line 7 back first (start ruling 17), so K1' is written with intact evidence.
        await editLines(world, COMPOSE, 7, 1, [LINE7]);
        idOf(await world.writePerson(s8eLinkDraft(K1, { topic: 'E-34-K1-prime', replaces: [k1!] })));
        const replaced = await flowOf(world, flow);
        expect(replaced.steps[0]).toMatchObject({ problem: 'not_current', item: null });
        expect(replaced.freshness).toBe('stale');
        expect(replaced.gapsAfter).toEqual([1]);
      } finally {
        await world.close();
      }
    }, 180_000);

  it('E-40 definite break over an unreadable file; unreadable; a failed second tier is not kept; forbidden write',
    async () => {
      const world = await openS8ESemanticWorld({ scribeTasks: 1 });
      try {
        const k1 = idOf(await world.writePerson(s8eLinkDraft(K1)));
        const runReads = (code: 'forbidden' | 'unavailable') => world.linkCheck.faultReads(request =>
          request.path === 'src/runtime/run.ts' ? { status: 'rejected', code, reason: `E-40 run.ts ${code}` } : null);
        // ①
        await editLines(world, COMPOSE, 7, 1, [LINE7_BEFORE]);
        runReads('forbidden');
        expect((await linkOf(world, k1)).verification).toEqual({ status: 'broken', missing: [1] });
        // ②
        await editLines(world, COMPOSE, 7, 1, [LINE7]);
        runReads('unavailable');
        const unreadable = await linkOf(world, k1);
        expect(unreadable.verification).toEqual({ status: 'unchecked', reason: 'unavailable' });
        expect(unreadable.currentEligible).toBe(false);
        // ③
        world.linkCheck.faultReads(null);
        await editLines(world, COMPOSE, 10, 1, [LINE10_BEGIN]);
        world.linkCheck.faultVerify(() => ({ status: 'rejected', code: 'unavailable', reason: 'E-40 the second tier failed' }));
        expect(await checkOne(world, k1)).toEqual({ status: 'unchecked', reason: 'unavailable' });
        world.linkCheck.faultVerify(null);
        expect((await linkOf(world, k1)).verification).toEqual({ status: 'unchecked', reason: 'refs_pending' });
        // ④
        world.linkCheck.faultReads(request => request.path === COMPOSE
          ? { status: 'rejected', code: 'forbidden', reason: 'E-40 compose.ts forbidden' } : null);
        expect(await world.writePerson(s8eLinkDraft(K1, { topic: 'E-40-4' })))
          .toMatchObject({ status: 'rejected', code: 'invalid', reason: 'evidence_invalid: link.evidence[1].at.path' });
      } finally {
        await world.close();
      }
    }, 180_000);

  // E2-23a: R5 5 (onPicked only free, nothing binds it); E2-23b: R5 4 top level (neither the name nor an import).
  it.each([
    ['E2-23a', 1, '// gone'],
    ['E2-23b', 2, "export const table = { 'wg.audit': 0 };"],
  ] as const)('%s wire5.ts line %i replaced: the register evidence reads broken [0]', async (row, line, text) => {
    const world = await openS8ESemanticWorld({ scribeTasks: 1 });
    try {
      const id = await wire5Link(world, row);
      await editLines(world, WIRE5, line, 1, [text]);
      expect((await linkOf(world, id)).verification).toEqual({ status: 'broken', missing: [0] });
    } finally {
      await world.close();
    }
  }, 180_000);

  it('E2-25 permit.ts line 4 deleted: "via" retired, verification still verified, fresh, not current', async () => {
    const world = await openS8ESemanticWorld({ scribeTasks: 1 });
    try {
      const id = idOf(await world.writePerson(s8eLinkDraft(K3, {
        topic: 'E2-25', extraAnchors: [K3.to, tsEnd(PERMIT, 'onPicked')],
      })));
      await editLines(world, PERMIT, 4, 1);
      const link = await linkOf(world, id);
      expect(link.via).toMatchObject({ anchorStatus: 'retired', anchorRetiredReasons: ['symbol_missing'] });
      expect(link.verification).toEqual({ status: 'verified' });
      expect(link.freshness).toBe('fresh');
      expect(link.currentEligible).toBe(false);
    } finally {
      await world.close();
    }
  }, 180_000);
});
