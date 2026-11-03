/**
 * S8E-2 F2 F-flow-read (8E-2 §4.3 :869, :854–855; book :1000): the flow read
 * through the Host route `architecture/semantic-flows` (E3, 8E :297–304) and
 * the owner's `memoryLookup` (E5), on the one S8E semantic world.
 *
 * Rows and the spec lines their expectations come from:
 * - E-11 (8E :725, :551, :556): a superseded step reads `item: null`,
 *   `not_current`, the flow is `stale` and not rewritten (book :600); the E5
 *   half reads the same derivation (8E :557).
 * - E-13 (8E :727, :558): two disjoint steps give `gapsAfter: [1]`.
 * - E-19b (8E :734, :549): paging by `noteId`, the cursor bound to the scope;
 *   a storage row on both backends (S3, book :1061–1062).
 * - E-42 (8E :757): endpoint identity ignores line numbers.
 * - E-43 (8E :758, :548): a module scope keeps a flow by its superseded step.
 * - E2-26a (8E-2 :854), E2-26b (8E-2 :855): the two flow quota populations
 *   (FR8, 8E-2 :321).
 * E2-27 (8E-2 :856) is in `S8E-R-route.test.ts`.
 *
 * Every note is a person `notes/write` (E2); ids come only from the receipts.
 * K1–K7 are the §5.2 hand-made contacts (`tests/helpers/S8E-semantic-world.ts:259–337`).
 */
import { readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import type { ReadResult } from '../../src/contracts/core/results.js';
import type { NoteDraftAnchorV1, NoteDraftV1 } from '../../src/contracts/note.js';
import type { SemanticFlowV1, SemanticPageV1, SemanticScopeV1 } from '../../src/contracts/semantic-layer.js';
import type { NoteItemV1, WriteNoteResult } from '../../src/core/work-graph/model/note-contracts.js';
import {
  openS8ESemanticWorld, s8eLinkDraft, S8E_GOAL_REF, S8E_LINKS, type S8ELinkName, type S8ESemanticWorld,
} from '../helpers/S8E-semantic-world.js';

type FlowDraft = Extract<NoteDraftV1, { kind: 'flow' }>;

// K1's "from" (S8E-semantic-world.ts:262) and run.ts's other function (:108).
const RUN_MODEL: NoteDraftAnchorV1 = {
  kind: 'file', path: 'src/runtime/run.ts', symbolRequest: { language: 'typescript', name: 'runModel' },
};
const DISPATCH: NoteDraftAnchorV1 = {
  kind: 'file', path: 'src/runtime/run.ts', symbolRequest: { language: 'typescript', name: 'dispatch' },
};

/** A flow draft (same shape as `S8E-F-write.test.ts:48–59`); the anchor is the first step's "from". */
function flowDraft(input: { topic: string; anchor: NoteDraftAnchorV1; steps: readonly string[] }): FlowDraft {
  return {
    kind: 'flow', topic: input.topic, conclusion: `${input.topic} conclusion`,
    anchor: input.anchor, extraAnchors: [], facts: [], basisFiles: [], structural: false,
    replaces: [], contradicts: [], coexistWith: [], body: '',
    flow: { steps: input.steps.map(link => ({ link })) },
  };
}

/** The receipt's id; a receipt that is not `accepted` stops the row. */
function idOf(write: WriteNoteResult): string {
  if (write.status !== 'accepted') throw new Error(`expected accepted, got ${JSON.stringify(write)}`);
  return write.noteId;
}

/** Person writes of the named contacts, in order; each must be accepted. */
async function linkIds(world: S8ESemanticWorld, names: readonly S8ELinkName[],
  goalId: string | null = null): Promise<string[]> {
  const ids: string[] = [];
  for (const name of names) ids.push(idOf(await world.writePerson(s8eLinkDraft(S8E_LINKS[name]), { goalId })));
  return ids;
}

/** E3: one page of `architecture/semantic-flows` (as `pageOf`, `S8E-R-route.test.ts:50–57`). */
async function flowsPage(world: S8ESemanticWorld, scope: SemanticScopeV1,
  cursor: string | null = null, limit = 50): Promise<SemanticPageV1<SemanticFlowV1>> {
  const result = await world.route('architecture/semantic-flows', { scope, cursor, limit });
  const read = result as ReadResult<SemanticPageV1<SemanticFlowV1>>;
  if (read.status !== 'ready') throw new Error(`the flows read was not ready: ${JSON.stringify(result)}`);
  return read.value;
}

/** E5: the owner `lookup` on `anchorOf`'s stored anchor (as `S8E-R-tools.test.ts:92–99`). */
async function lookupItems(world: S8ESemanticWorld, anchorOf: string): Promise<NoteItemV1[]> {
  const read = await world.platform.notes.readNote(world.humanContext(), { noteId: anchorOf });
  if (read.status !== 'ready') throw new Error(`readNote ${anchorOf} was not ready: ${JSON.stringify(read)}`);
  const lookup = await world.platform.notes.memoryLookup(world.humanContext(), {
    v: 1, op: 'lookup', anchor: read.value.anchor, limit: 100, cursor: null,
  });
  if (lookup.status !== 'ready') throw new Error(`the lookup was not ready: ${JSON.stringify(lookup)}`);
  return lookup.value.items;
}

function byId<T extends { noteId: string }>(items: readonly T[], noteId: string): T {
  const found = items.find(item => item.noteId === noteId);
  if (found === undefined) throw new Error(`${noteId} is not among ${JSON.stringify(items.map(item => item.noteId))}`);
  return found;
}

describe('S8E-2 F2 F-flow-read: the flow read on E3 and E5', () => {
  it('E-11 a superseded step reads item null, not_current; the flow is stale and not rewritten (E3 and E5)', async () => {
    const world = await openS8ESemanticWorld({ scribeTasks: 1 });
    try {
      const [k1, k2, k3] = await linkIds(world, ['K1', 'K2', 'K3']);
      const written = await world.writePerson(flowDraft({ topic: 'E-11', anchor: RUN_MODEL, steps: [k1!, k2!, k3!] }));
      expect(written).toMatchObject({ status: 'accepted' });
      const flow = idOf(written);
      idOf(await world.writePerson(s8eLinkDraft(S8E_LINKS.K2, { topic: 'E-11-K2-prime', replaces: [k2!] })));

      const item = byId((await flowsPage(world, { kind: 'project' })).items, flow);
      expect(item.version).toBe(1);
      expect(item.steps.map(step => step.link)).toEqual([k1, k2, k3]);
      expect(item.steps[1]).toEqual({ link: k2, item: null, problem: 'not_current' });
      expect(item.steps[0]?.item?.noteId).toBe(k1);
      expect(item.steps[2]?.item?.noteId).toBe(k3);
      expect(item.freshness).toBe('stale');

      // E5 (f2-start-rulings 1): the same derivation feeds `lookup` (8E :557).
      const looked = byId(await lookupItems(world, flow), flow);
      expect(looked.flow?.steps[1]).toEqual({ link: k2, item: null, problem: 'not_current' });
      expect(looked.freshness).toBe('stale');
    } finally {
      await world.close();
    }
  }, 180_000);

  it('E-13 K1 then K2: K1 "to" permit.ts#authorize is not K2 "from" kernel.ts#select, gapsAfter [1]', async () => {
    const world = await openS8ESemanticWorld({ scribeTasks: 1 });
    try {
      const [k1, k2] = await linkIds(world, ['K1', 'K2']);
      const flow = idOf(await world.writePerson(flowDraft({ topic: 'E-13', anchor: RUN_MODEL, steps: [k1!, k2!] })));
      expect(byId((await flowsPage(world, { kind: 'project' })).items, flow).gapsAfter).toEqual([1]);
    } finally {
      await world.close();
    }
  }, 180_000);

  it('E-42 a line shift keeps the endpoint identity; dispatch is not runModel; gapsAfter stays [1]', async () => {
    const world = await openS8ESemanticWorld({ scribeTasks: 1 });
    try {
      const [k1, k2] = await linkIds(world, ['K1', 'K2']);
      const a = idOf(await world.writePerson(flowDraft({ topic: 'E-42-A', anchor: RUN_MODEL, steps: [k1!, k2!] })));
      const runPath = join(world.root, 'src/runtime/run.ts');
      const original = await readFile(runPath, 'utf8');
      await writeFile(runPath, '// shifted\n' + original, 'utf8');

      const writtenB = await world.writePerson(flowDraft({ topic: 'E-42-B', anchor: RUN_MODEL, steps: [k1!, k2!] }));
      expect(writtenB).toMatchObject({ status: 'accepted' });
      const b = idOf(writtenB);
      const writtenC = await world.writePerson(flowDraft({ topic: 'E-42-C', anchor: DISPATCH, steps: [k1!, k2!] }));
      expect(writtenC).toMatchObject({ status: 'rejected', code: 'invalid', reason: 'flow_anchor_mismatch' });

      const page = await flowsPage(world, { kind: 'project' });
      expect(byId(page.items, a).gapsAfter).toEqual([1]);
      expect(byId(page.items, b).gapsAfter).toEqual([1]);
    } finally {
      await world.close();
    }
  }, 180_000);

  it('E-43 the module scope keeps a flow by its superseded K1; step 1 item null, not_current; stale', async () => {
    const world = await openS8ESemanticWorld({ scribeTasks: 1 });
    try {
      const [k1, k6] = await linkIds(world, ['K1', 'K6']);
      const flow = idOf(await world.writePerson(flowDraft({ topic: 'E-43', anchor: RUN_MODEL, steps: [k1!, k6!] })));
      idOf(await world.writePerson(s8eLinkDraft(S8E_LINKS.K1, { topic: 'E-43-K1-prime', replaces: [k1!] })));

      const page = await flowsPage(world, { kind: 'module', moduleId: 'runtime' });
      expect(page.items.map(item => item.noteId)).toEqual([flow]);
      const item = byId(page.items, flow);
      expect(item.steps[0]).toEqual({ link: k1, item: null, problem: 'not_current' });
      expect(item.steps[1]?.item?.noteId).toBe(k6);
      expect(item.freshness).toBe('stale');
    } finally {
      await world.close();
    }
  }, 180_000);

  it('E2-26a projectFlowQuota 1: two current project flows, both accepted, both read overQuota', async () => {
    const world = await openS8ESemanticWorld({ scribeTasks: 1, noteLimits: { projectFlowQuota: 1 } });
    try {
      const [k1, k2, k3] = await linkIds(world, ['K1', 'K2', 'K3']);
      const writtenA = await world.writePerson(flowDraft({ topic: 'E2-26a-A', anchor: RUN_MODEL, steps: [k1!, k2!] }));
      const writtenB = await world.writePerson(flowDraft({ topic: 'E2-26a-B', anchor: RUN_MODEL, steps: [k1!, k3!] }));
      expect(writtenA).toMatchObject({ status: 'accepted' });
      expect(writtenB).toMatchObject({ status: 'accepted' });
      const a = idOf(writtenA);
      const b = idOf(writtenB);

      const items = await lookupItems(world, a);
      expect(byId(items, a).overQuota).toBe(true);
      expect(byId(items, b).overQuota).toBe(true);
    } finally {
      await world.close();
    }
  }, 180_000);

  it('E2-26b goalLinkQuota 2: two goal links and one goal flow make K1 overQuota', async () => {
    const world = await openS8ESemanticWorld({ scribeTasks: 1, noteLimits: { goalLinkQuota: 2 } });
    try {
      const goalId = S8E_GOAL_REF.goalId;
      const [k1, k2] = await linkIds(world, ['K1', 'K2'], goalId);
      const written = await world.writePerson(flowDraft({ topic: 'E2-26b', anchor: RUN_MODEL, steps: [k1!, k2!] }),
        { goalId });
      expect(written).toMatchObject({ status: 'accepted' });

      expect(byId(await lookupItems(world, k1!), k1!).overQuota).toBe(true);
    } finally {
      await world.close();
    }
  }, 180_000);
});

// E-19b is a storage/paging row: both backends (S3; f2-start-rulings 13), three
// flows so that limit 2 gives 2 + 1, as links' E-19a (`S8E-R-route.test.ts:378–420`).
describe('S8E-2 F2 F-flow-read: E-19b paging and the scope-bound cursor', () => {
  it.each(['memory', 'sqlite'] as const)('E-19b %s: pages flows by noteId and rejects the other-scope cursor',
    async backend => {
      const world = await openS8ESemanticWorld({ backend, scribeTasks: 1 });
      try {
        const [k1, k2] = await linkIds(world, ['K1', 'K2']);
        const ids: string[] = [];
        for (const topic of ['E-19b-1', 'E-19b-2', 'E-19b-3']) {
          const written = await world.writePerson(flowDraft({ topic, anchor: RUN_MODEL, steps: [k1!, k2!] }));
          expect(written).toMatchObject({ status: 'accepted', version: 1 });
          ids.push(idOf(written));
        }
        expect(new Set(ids).size).toBe(3);

        const orderedIds = [...ids].sort();
        const first = await flowsPage(world, { kind: 'project' }, null, 2);
        expect(first.items.map(item => item.noteId)).toEqual(orderedIds.slice(0, 2));
        expect(first.next).not.toBeNull();
        const second = await flowsPage(world, { kind: 'project' }, first.next, 2);
        expect(second.items.map(item => item.noteId)).toEqual([orderedIds[2]]);
        expect(second.next).toBeNull();
        expect([...first.items, ...second.items].map(item => item.noteId)).toEqual(orderedIds);

        const cross = await world.route('architecture/semantic-flows', {
          scope: { kind: 'module', moduleId: 'runtime' }, cursor: first.next, limit: 2,
        });
        expect(cross).toMatchObject({ status: 'rejected', code: 'invalid', reason: 'cursor_mismatch' });
        expect(cross).not.toHaveProperty('value.items');
      } finally {
        await world.close();
      }
    }, 240_000);
});
