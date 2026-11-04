/**
 * S8E L3 R-route (sheet §6.3): `architecture/semantic-links` on the one S8E
 * semantic world.
 *
 * E1: K1 is written by a REAL Work Run's `record_note` (the world's
 * `writeAgentLink`: a scripted model inside `driveWorkflow`'s `select_work`);
 * the Kernel-delivered `{write, check}` is the receipt, and the stored item's
 * source is the agent (never the person `notes/write`). E3 reads the link back
 * through the Host's own in-process router (`world.route`), E5 through the
 * owner entries.
 *
 * E-16 is its own instance of the same world with two goals: g1 is the world's
 * `s8e-goal`; g2 is created through the real `goals/create` route. g1's real
 * Run writes K1 and K2. g2's E5 `lookup`/`find` runs on a goal-scoped
 * secretary QueryRun's own `query_run` context (the Runtime's context, kept by
 * `captureQueryContexts`), so the `visibleByDefault` goal rule is the real one:
 * K1 (accepted, not confirmed, another goal) is invisible to g2. A real scribe
 * Work Run calls the real `record_note` with `op: 'review'`; the same g2
 * context then reads K1 as `storedState: 'reviewed'`. The pending link is a g1
 * agent write that contradicts a user-confirmed note (real admission, not a
 * hand-written state); it is visible only to g1's own goal. The Host (person)
 * project read returns the three visible states `accepted`, `reviewed` and
 * `pending_review`, each with its `state`.
 *
 * E-14's `ambiguous` tie uses a second world instance with a two-module catalog
 * (the codec accepts two modules naming one file), through the real
 * `architecture/adopt-initial` route.
 *
 * No context is built by hand, no note record is built, no store is read.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { CoreCallContext } from '../../src/contracts/core/call-context.js';
import type { SessionRef } from '../../src/contracts/core/identity.js';
import type { ReadResult } from '../../src/contracts/core/results.js';
import type { LinkDraftV1 } from '../../src/contracts/note.js';
import type { SemanticLinkV1, SemanticPageV1, SemanticScopeV1 } from '../../src/contracts/semantic-layer.js';
import type {
  MemoryLookupResultV1, MemoryResultV1, NoteItemV1, WriteNoteEnvelopeV1, WriteNoteResult,
} from '../../src/core/work-graph/model/note-contracts.js';
import { isRecord } from '../../src/contracts/validation/common.js';
import type { ToolResult } from '../../vendor/coding-agent/dist/public-api.js';
import { driveWorkflow } from '../helpers/A2-restart-fixture.js';
import { captureQueryContexts } from '../helpers/query-context-capture.js';
import { s6aCardsWorkspace } from '../helpers/S6A-cards-fixture.js';
import { S6A_SCRIBE_ROLE } from '../helpers/S6A-request-fixture.js';
import {
  openS8ESemanticWorld, s8eLinkDraft, S8E_LINKS, S8E_SCOPE, S8E_SEMANTIC_MODULES, type S8ESemanticWorld,
} from '../helpers/S8E-semantic-world.js';

const pageOf = async (world: S8ESemanticWorld, scope: SemanticScopeV1,
  cursor: string | null = null, limit = 100): Promise<SemanticPageV1<SemanticLinkV1>> => {
  const result = await world.route('architecture/semantic-links', { scope, cursor, limit });
  const read = result as ReadResult<SemanticPageV1<SemanticLinkV1>>;
  if (read.status !== 'ready') {
    throw new Error(`the semantic read was not ready: ${JSON.stringify(result)}`);
  }
  return read.value;
};

const ready = <T>(result: { status: string; value?: T }, what: string): T => {
  if (result.status !== 'ready' || result.value === undefined) {
    throw new Error(`${what} was not ready: ${JSON.stringify(result)}`);
  }
  return result.value;
};

type SuccessfulWrite = Extract<WriteNoteResult, { status: 'accepted' | 'pending_review' | 'staged' }>;

const acceptedWrite = (envelope: WriteNoteEnvelopeV1 | null): SuccessfulWrite => {
  if (envelope === null) throw new Error('the write produced no {write, check} envelope');
  const write = envelope.write;
  if (write.status === 'rejected') throw new Error(`the write was rejected: ${write.code}/${write.reason}`);
  if (write.status !== 'accepted') throw new Error(`the write was not accepted: ${write.status}`);
  return write;
};

const lookupOn = async (world: S8ESemanticWorld, ctx: CoreCallContext,
  anchor: NoteItemV1['anchor']): Promise<MemoryLookupResultV1> =>
  ready(await world.platform.notes.memoryLookup(ctx, {
    v: 1, op: 'lookup', anchor, limit: 100, cursor: null,
  }), 'the E5 lookup') as MemoryLookupResultV1;

const findLinks = async (world: S8ESemanticWorld, ctx: CoreCallContext): Promise<MemoryResultV1> =>
  ready(await world.platform.notes.memoryFind(ctx, {
    v: 1, op: 'find', kind: 'link', limit: 100, cursor: null,
  }), 'the E5 find') as MemoryResultV1;

/**
 * A goal-scoped secretary round's own query_run context: the Runtime makes it
 * for the round, and the capture helper only keeps the Runtime's object. The
 * round is released normally after the callback; the context stays valid for
 * the owner reads (it is the trusted principal, not a live Run handle).
 */
async function goalContext(world: S8ESemanticWorld,
  capture: ReturnType<typeof captureQueryContexts>, label: string, goalId: string): Promise<CoreCallContext> {
  let ctx: CoreCallContext | null = null;
  await world.secretaryRound({ label, goalId }, async () => {
    ctx = capture.latest();
  });
  if (ctx === null) throw new Error(`the ${label} round opened no query_run context`);
  return ctx;
}

/** The real scribe Work Run's `record_note` review; answers the Kernel-delivered disposition JSON. */
async function reviewInScribeRun(world: S8ESemanticWorld, session: SessionRef,
  noteId: string, expectedVersion: number): Promise<Record<string, unknown>> {
  const task = world.nextScribeTask();
  const callId = `s8e-e16-review-${noteId}`;
  const before = world.model.calls();
  world.clock.advance(1000);
  world.scriptReplies([
    { kind: 'calls', calls: [{ callId, name: 'record_note', args: {
      op: 'review', noteId, expectedVersion, verdict: 'review', reason: null,
    } }] },
    { kind: 'text', text: 'S8E reviewed the link' },
  ]);
  await driveWorkflow(world.ag2b, { schemaVersion: 1, goalRef: world.goalRef,
    flowId: `s8e-e16-review-${noteId}`, sessionHint: session, kind: 'select_work', taskId: task.taskId });
  if (world.model.calls() !== before + 2) {
    throw new Error(`S8E: the review Run made ${world.model.calls() - before} model calls, not 2`);
  }
  const request = world.model.requests[before + 1];
  const delivered = request?.messages.find(message => message.role === 'tool' && message.callId === callId);
  if (delivered === undefined || delivered.role !== 'tool') {
    throw new Error('S8E: the record_note review result was not delivered to the model');
  }
  const toolResult: ToolResult = delivered.result;
  if (toolResult.status !== 'success') {
    const detail = toolResult.status === 'error' ? toolResult.error.message : toolResult.status;
    throw new Error(`S8E: the record_note review failed: ${detail}`);
  }
  const json = toolResult.output.find(entry => entry.kind === 'json');
  if (json === undefined || json.kind !== 'json' || !isRecord(json.value)) {
    throw new Error('S8E: the record_note review delivered no disposition JSON');
  }
  return json.value;
}

/** E-14's calls link: `compose.ts` → `audit.ts#audit`, key `wg.audit`, both evidence items on line 9. */
const callsDraft = (): LinkDraftV1 => ({
  kind: 'link', topic: 'E-14', conclusion: 'compose registers audit for the wg.audit handler',
  anchor: { kind: 'file', path: 'src/compose.ts' },
  extraAnchors: [{ kind: 'file', path: 'src/wg/audit.ts',
    symbolRequest: { language: 'typescript', name: 'audit' } }],
  facts: [], basisFiles: [], structural: false, replaces: [], contradicts: [], coexistWith: [], body: '',
  link: {
    relation: 'calls', key: { kind: 'literal', text: 'wg.audit' },
    evidence: [
      { role: 'register', at: { path: 'src/compose.ts', range: { startLine: 9, endLine: 9 } } },
      { role: 'use', at: { path: 'src/compose.ts', range: { startLine: 9, endLine: 9 } } },
    ],
  },
});

describe('S8E L3 R-route: architecture/semantic-links', () => {
  let world: S8ESemanticWorld;
  let k1Id: string;
  let k1Receipt: WriteNoteEnvelopeV1;
  let k1AgentItem: NoteItemV1 | null;
  let callsId: string;

  beforeAll(async () => {
    world = await openS8ESemanticWorld({ scribeTasks: 4 });
    // E1: the real scribe Work Run writes K1. The receipt is what the Kernel
    // delivered, and the item is the public `notes.readNote` read of it.
    const written = await world.writeAgentLink(S8E_LINKS.K1, { label: 'r-route-k1' });
    if (written.envelope === null) throw new Error('E1: the record_note result carried no {write, check}');
    k1Receipt = written.envelope;
    k1AgentItem = written.item;
    const k1 = acceptedWrite(k1Receipt);
    k1Id = k1.noteId;

    const calls = await world.writePerson(callsDraft());
    if (calls.status !== 'accepted') throw new Error(`E-14 calls was not accepted: ${calls.status}`);
    expect(calls.version).toBe(1);
    callsId = calls.noteId;
  }, 180_000);

  afterAll(async () => { await world?.close(); });

  it('E1: the real scribe Run writes K1 with record_note (v1, accepted), not a person notes/write', () => {
    const k1 = acceptedWrite(k1Receipt);
    expect(k1).toMatchObject({ status: 'accepted', version: 1, noteId: k1Id });
    expect(k1.noteId.length).toBeGreaterThan(0);
    // The Kernel-delivered check is the write-time evidence gate's own result.
    expect(k1Receipt.check).toMatchObject({ noteId: k1Id, linkVerification: { status: 'verified' } });
    expect(k1AgentItem?.storedState).toBe('accepted');
    expect(k1AgentItem?.source).toMatchObject({ kind: 'agent', duty: 'scribe' });
  });

  it('E3: the runtime module page carries K1 with its ends, symbols, live slots and the real catalog revision',
    async () => {
      const page = await pageOf(world, { kind: 'module', moduleId: 'runtime' });
      // The helper stored the real adopt-initial receipt's baseline.ref.revision.
      expect(world.catalogRevision).toBe(1);
      expect(page.catalogRevision).toBe(world.catalogRevision);

      const k1 = page.items.find(item => item.noteId === k1Id);
      expect(k1).toBeDefined();
      expect(k1).toMatchObject({
        version: 1,
        state: 'accepted',
        relation: 'injects',
        verification: { status: 'verified' },
        currentEligible: true,
      });
      expect(k1!.from.moduleId).toBe('runtime');
      expect(k1!.to.moduleId).toBe('wg');
      expect(k1!.via?.moduleId).toBe('contracts');

      const ends = [k1!.from, k1!.to, k1!.via!];
      expect(ends.map(end => end.request.kind)).toEqual(['file', 'file', 'file']);
      expect(ends.map(end => (end.request.kind === 'file' ? end.request.path : null))).toEqual([
        'src/runtime/run.ts', 'src/wg/permit.ts', 'src/contracts/access.ts',
      ]);
      for (const end of ends) {
        expect(end.request.kind === 'file' ? end.request.symbolRequest : undefined).toBeDefined();
        expect(end.anchorStatus).toBe('live');
      }
      // The three file anchors carry the L14 resolved locator, not only the raw
      // request: the name span of `runModel`, `authorize`, `beforeCall` (the
      // declaration spans are a separate workspace SourceHit field).
      const resolved = [
        { path: 'src/runtime/run.ts', name: 'runModel', range: { startLine: 3, endLine: 3 } },
        { path: 'src/wg/permit.ts', name: 'authorize', range: { startLine: 1, endLine: 1 } },
        { path: 'src/contracts/access.ts', name: 'beforeCall', range: { startLine: 2, endLine: 2 } },
      ];
      ends.forEach((end, index) => {
        expect(end.anchor.kind).toBe('file');
        if (end.anchor.kind !== 'file') return;
        expect(end.anchor.path).toBe(resolved[index]!.path);
        expect(end.anchor.symbol?.qualifiedName).toBe(resolved[index]!.name);
        expect(end.anchor.symbol?.range).toEqual(resolved[index]!.range);
      });
    }, 60_000);

  it('E3: the "to" file scope also returns K1', async () => {
    const page = await pageOf(world, { kind: 'file', path: 'src/wg/permit.ts' });
    expect(page.items.some(item => item.noteId === k1Id)).toBe(true);
    expect(page.catalogRevision).toBe(world.catalogRevision);
  }, 60_000);

  it('E-14: the call from the unowned compose.ts is in the project page with moduleId null/not_owned',
    async () => {
      const page = await pageOf(world, { kind: 'project' });
      const calls = page.items.find(item => item.noteId === callsId);
      expect(calls).toBeDefined();
      expect(calls).toMatchObject({ relation: 'calls', state: 'accepted' });
      expect(calls!.from.request).toEqual({ kind: 'file', path: 'src/compose.ts' });
      expect(calls!.from.moduleId).toBeNull();
      expect(calls!.from.unresolved).toBe('not_owned');
      expect(calls!.to.moduleId).toBe('wg');
      // The `ambiguous` tie is proven in its own second world below.
    }, 60_000);

  it('E-14 ambiguous: a second world where two modules claim compose.ts leaves the from end unresolved',
    async () => {
      // Same public world factory, second instance: its initial catalog adds
      // src/compose.ts to runtime and wg, so the one ownership rule reports a
      // tie (the codec accepts two modules naming the same file).
      const twoOwners = S8E_SEMANTIC_MODULES.map(module => ({
        moduleId: module.moduleId,
        paths: module.moduleId === 'runtime' || module.moduleId === 'wg'
          ? [...module.paths, 'src/compose.ts'] : [...module.paths],
      }));
      const tie = await openS8ESemanticWorld({ scribeTasks: 1, catalogModules: twoOwners });
      try {
        const write = await tie.writePerson(callsDraft());
        if (write.status !== 'accepted') throw new Error(`the ambiguous calls link was not accepted: ${write.status}`);
        expect(write.version).toBe(1);
        const page = await pageOf(tie, { kind: 'project' });
        const calls = page.items.find(item => item.noteId === write.noteId);
        expect(calls).toBeDefined();
        expect(calls!.from.request).toEqual({ kind: 'file', path: 'src/compose.ts' });
        expect(calls!.from.moduleId).toBeNull();
        expect(calls!.from.unresolved).toBe('ambiguous');
      } finally {
        await tie.close();
      }
    }, 240_000);

  it('E-16: g2 cannot see g1\'s accepted link; the scribe review makes it visible; pending is own-goal only, '
    + 'and the Host read has all three states', async () => {
    const world2 = await openS8ESemanticWorld({ scribeTasks: 4, secretaryTools: ['read', 'record_note'] });
    const capture = captureQueryContexts();
    try {
      const g2 = 's8e-goal-2';
      await s6aCardsWorkspace(world2, S8E_SCOPE).createGoal(g2, 'S8E E-16 g2');
      const scribeLine = (await world2.listSessions())
        .find(card => card.record.role.kind === 'legacy_template'
          && card.record.role.templateId === S6A_SCRIBE_ROLE.templateId);
      if (scribeLine === undefined) throw new Error('E-16: the world has no scribe line');

      // g1's real Work Runs write two accepted links. Neither is user-confirmed.
      const k1Write = await world2.writeAgentLink(S8E_LINKS.K1, { label: 'e16-k1' });
      const k2Write = await world2.writeAgentLink(S8E_LINKS.K2, { label: 'e16-k2' });
      const k1 = acceptedWrite(k1Write.envelope);
      const k2 = acceptedWrite(k2Write.envelope);
      expect(k1Write.item?.source).toMatchObject({ kind: 'agent', duty: 'scribe' });
      expect(k1Write.item?.goalId).toBe(world2.goalRef.goalId);
      expect(k2Write.item?.goalId).toBe(world2.goalRef.goalId);
      const k1At = k1Write.item?.extraAnchors[0];
      if (k1At === undefined) throw new Error('E-16: K1 has no stored "to" anchor');

      // g2's own E5 reads: accepted cross-goal links are not visible by default.
      const g2ctx = await goalContext(world2, capture, 'e16-g2-before', g2);
      expect(g2ctx.principal).toMatchObject({ kind: 'query_run', goalId: g2 });
      const beforeLookup = await lookupOn(world2, g2ctx, k1At);
      expect(beforeLookup.items.map(item => item.noteId)).not.toContain(k1.noteId);
      expect(beforeLookup.items.map(item => item.noteId)).not.toContain(k2.noteId);
      const beforeFind = await findLinks(world2, g2ctx);
      expect(beforeFind.items.map(item => item.noteId)).not.toContain(k1.noteId);
      expect(beforeFind.items.map(item => item.noteId)).not.toContain(k2.noteId);

      // The real scribe Work Run reviews K1 (record_note op review).
      const review = await reviewInScribeRun(world2, scribeLine.record.ref, k1.noteId, k1.version);
      expect(review).toMatchObject({ status: 'done', noteId: k1.noteId, version: 2, state: 'reviewed' });

      // The SAME g2 context now reads K1 as reviewed; K2 is still accepted-only.
      const afterLookup = await lookupOn(world2, g2ctx, k1At);
      const reviewed = afterLookup.items.find(item => item.noteId === k1.noteId);
      expect(reviewed).toBeDefined();
      expect(reviewed!.storedState).toBe('reviewed');
      expect(afterLookup.items.map(item => item.noteId)).not.toContain(k2.noteId);
      const afterFind = await findLinks(world2, g2ctx);
      expect(afterFind.items.map(item => item.noteId)).toContain(k1.noteId);
      expect(afterFind.items.map(item => item.noteId)).not.toContain(k2.noteId);

      // A user-confirmed note gives the pending admission its contradiction target.
      const userNote = await world2.writePerson({
        kind: 'decision', topic: 'e16-user', conclusion: 'the user confirms the call',
        anchor: { kind: 'file', path: 'src/runtime/run.ts' },
        extraAnchors: [], facts: [], basisFiles: [], structural: false,
        replaces: [], contradicts: [], coexistWith: [], body: '',
      });
      if (userNote.status !== 'accepted' || !userNote.confirmedByUser) {
        throw new Error(`E-16: the user note was not accepted/confirmed: ${JSON.stringify(userNote)}`);
      }
      // g1's real Run writes a link that contradicts the user-confirmed note:
      // the real admission makes it pending_review (no record is written by hand).
      const pendingWrite = await world2.writeAgent(s8eLinkDraft(S8E_LINKS.K1, {
        topic: 'e16-pending', conclusion: 'the call contradicts the user confirmation',
        contradicts: [userNote.noteId],
      }), { label: 'e16-pending' });
      const pending = pendingWrite.envelope?.write;
      if (pending === undefined || pending.status !== 'pending_review') {
        throw new Error(`E-16: the contradicted link was not pending_review: ${JSON.stringify(pending)}`);
      }
      expect(pending.reasons).toEqual(['contradiction']);

      // g1's own goal sees the pending link; g2 still does not.
      const g1ctx = await goalContext(world2, capture, 'e16-g1', world2.goalRef.goalId);
      expect(g1ctx.principal).toMatchObject({ kind: 'query_run', goalId: world2.goalRef.goalId });
      const g1Lookup = await lookupOn(world2, g1ctx, k1At);
      expect(g1Lookup.items.find(item => item.noteId === pending.noteId)?.storedState).toBe('pending_review');
      expect(g1Lookup.items.map(item => item.noteId)).toContain(k1.noteId);
      const g2PendingLookup = await lookupOn(world2, g2ctx, k1At);
      expect(g2PendingLookup.items.map(item => item.noteId)).not.toContain(pending.noteId);
      const g2PendingFind = await findLinks(world2, g2ctx);
      expect(g2PendingFind.items.map(item => item.noteId)).not.toContain(pending.noteId);

      // The Host (person) project read: no goal division, the three visible
      // states, each item carrying its own `state`.
      const page = await pageOf(world2, { kind: 'project' });
      const shown = page.items.filter(item => [k1.noteId, k2.noteId, pending.noteId].includes(item.noteId));
      expect(shown.map(item => item.state).sort()).toEqual(['accepted', 'pending_review', 'reviewed']);
      for (const item of shown) expect(typeof item.state).toBe('string');
      expect(shown.find(item => item.noteId === k1.noteId)?.state).toBe('reviewed');
      expect(shown.find(item => item.noteId === k2.noteId)?.state).toBe('accepted');
      expect(shown.find(item => item.noteId === pending.noteId)?.state).toBe('pending_review');
    } finally {
      capture.restore();
      await world2.close();
    }
  }, 240_000);
});

// E-19a is a storage/paging row: both backends, with exactly three visible links
// so that limit 2 yields 2 + 1. The cursor's request binding is the rule under
// test; using the first page's `next` under another scope must be `invalid`.
describe('S8E L3 R-route: E-19a paging and the request-bound cursor', () => {
  it.each(['memory', 'sqlite'] as const)('%s: pages by noteId and rejects the other-scope cursor',
    async backend => {
      const world = await openS8ESemanticWorld({ backend, scribeTasks: 1 });
      try {
        const ids: string[] = [];
        for (const name of ['K1', 'K2', 'K3'] as const) {
          const write = await world.writePerson(s8eLinkDraft(S8E_LINKS[name]));
          if (write.status !== 'accepted') throw new Error(`${name} was not accepted: ${write.status}`);
          expect(write.version).toBe(1);
          ids.push(write.noteId);
        }
        expect(new Set(ids).size).toBe(3);

        // The write receipts are the only id source; the pages are by noteId
        // (ascending, no duplicate, no loss), independent of the write order.
        const orderedIds = [...ids].sort();
        const first = await pageOf(world, { kind: 'project' }, null, 2);
        expect(first.items).toHaveLength(2);
        expect(first.items.map(item => item.noteId)).toEqual(orderedIds.slice(0, 2));
        expect(first.next).not.toBeNull();
        const firstLast = first.items[first.items.length - 1]!.noteId;

        const second = await pageOf(world, { kind: 'project' }, first.next, 2);
        expect(second.items).toHaveLength(1);
        expect(second.items.map(item => item.noteId)).toEqual(orderedIds.slice(2));
        expect(second.next).toBeNull();
        for (const item of second.items) expect(item.noteId > firstLast).toBe(true);
        expect([...first.items, ...second.items].map(item => item.noteId)).toEqual(orderedIds);

        const cross = await world.route('architecture/semantic-links', {
          scope: { kind: 'module', moduleId: 'runtime' }, cursor: first.next, limit: 2,
        });
        expect(cross).toMatchObject({ status: 'rejected', code: 'invalid', reason: 'cursor_mismatch' });
        expect(cross).not.toHaveProperty('value.items');
      } finally {
        await world.close();
      }
    }, 240_000);
});

// E2-27 (8E-2 :856; FR6 :319): a bad `scope` is `invalid` on both semantic
// reads. `limit: 10` is inside links' 1–100 and flows' 1–50, so `scope` is the
// one bad field (A6). Both are reads: nothing is written, nothing else is read.
// The reason text is not asserted (f2-start-rulings 2).
describe('rejects: F2 E2-27 a bad scope is invalid on both semantic reads', () => {
  it.each(['architecture/semantic-links', 'architecture/semantic-flows'] as const)(
    'E2-27 %s: scope { kind: bogus } is invalid', async suffix => {
      const world = await openS8ESemanticWorld({ scribeTasks: 1 });
      try {
        const result = await world.route(suffix, { scope: { kind: 'bogus' }, cursor: null, limit: 10 });
        expect(result).toMatchObject({ status: 'rejected', code: 'invalid' });
        expect(result).not.toHaveProperty('value');
      } finally {
        await world.close();
      }
    }, 180_000);
});

// E2-09 (8E-2 :833; R13 :421; §2.0 :156, :251): the check route takes 1 to 20
// items; 21 (K1 and K3 in turn) and 0 are both `invalid` and build nothing (A6:
// the builds are the read that nothing ran). K1 and K3 are both doubtful after
// compose.ts line 10 changes (R5 :355), so a route without the bound would answer
// `ready` with one build. The reason text is not asserted (the spec writes none).
// The file helpers are imported inside the row so every line above stays as it is.
describe('rejects: R E2-09 the check route takes 1 to 20 items', () => {
  it.each([21, 0])('E2-09 %i items: invalid, no value, no build', async count => {
    const { readFile, writeFile } = await import('node:fs/promises');
    const { join } = await import('node:path');
    const world = await openS8ESemanticWorld({ scribeTasks: 1 });
    try {
      const refs: { noteId: string; version: number }[] = [];
      for (const name of ['K1', 'K3'] as const) {
        const write = await world.writePerson(s8eLinkDraft(S8E_LINKS[name]));
        if (write.status !== 'accepted') throw new Error(`${name} was not accepted: ${JSON.stringify(write)}`);
        refs.push({ noteId: write.noteId, version: write.version });
      }
      const compose = join(world.root, 'src/compose.ts');
      const lines = (await readFile(compose, 'utf8')).split('\n');
      lines[9] = 'export const begin = (id: string) => runModel(access, id);';
      await writeFile(compose, lines.join('\n'), 'utf8');

      const before = world.linkCheck.builds();
      const result = await world.route('architecture/semantic-links/check',
        { items: Array.from({ length: count }, (_, index) => refs[index % 2]!) });
      expect(result).toMatchObject({ status: 'rejected', code: 'invalid' });
      expect(result).not.toHaveProperty('value');
      expect(world.linkCheck.builds() - before).toBe(0);
    } finally {
      await world.close();
    }
  }, 180_000);
});
