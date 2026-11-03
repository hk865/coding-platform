/**
 * S8E L3 R-auth (sheet §6.3 :2300).
 *
 * The two Query kinds this tree has:
 * - an ordinary read-only plain Query: its Host grant names `record_note`
 *   (the `secretaryTools` option), yet the real plain-query start (the A3
 *   pass-through wrapper on `createQueryGraphToolGroup` keeps the Runtime's own
 *   `query_run` context) still builds a real scripted model request without
 *   `record_note`, and a direct `platform.notes.writeNote` from that same
 *   context is refused by the trusted resolver.
 * - a secretary request round: the real `holdS6BRequestRound` round with a
 *   no-goal request (`goalId: null`), whose frozen tool table names
 *   `record_note` and whose admitted kinds include `link`. SF2 makes the E1
 *   write real: the round's scripted model calls `record_note` for K1, the
 *   receipt is `accepted`, and the public `notes/list` reads the link back.
 *
 * The Host's `secretaryTools` option is the existing grant pass-through (both
 * worlds use it). No principal is built by hand and no product code is
 * changed: the `query_run` context is the Runtime's own, and the secretary's
 * tool call is the Kernel's.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { CoreCallContext } from '../../src/contracts/core/call-context.js';
import type { ReadResult } from '../../src/contracts/core/results.js';
import type { NoteDraftV1 } from '../../src/contracts/note.js';
import * as noteToolModule from '../../src/core/agent-runtime/note-tool.js';
import type { NoteToolsConfig } from '../../src/core/agent-runtime/note-tool.js';
import type { NoteListResultV1 } from '../../src/core/work-graph/model/note-contracts.js';
import { AG2B_GOAL_REF, startBusyQuery } from '../helpers/AG2b-collaboration-fixture.js';
import { s6aCardsWorkspace } from '../helpers/S6A-cards-fixture.js';
import { S6A_SCOPE, type S6ASession } from '../helpers/S6A-request-fixture.js';
import {
  openS8ESemanticWorld, s8eLinkDraft, S8E_LINKS, type S8ESemanticWorld,
} from '../helpers/S8E-semantic-world.js';
import { captureQueryContexts } from '../helpers/query-context-capture.js';

const SEMANTIC_ANSWER = JSON.stringify({ schemaVersion: 1, body: 'S8E R-auth answer', ideas: [], goalCardDrafts: [] });

const worlds: S8ESemanticWorld[] = [];
afterEach(async () => {
  vi.restoreAllMocks();
  await Promise.all(worlds.splice(0).map(world => world.close()));
});

type ModelRequestShape = {
  tools: readonly { name: string; inputSchema: unknown }[];
  messages: readonly unknown[];
};

const convention = (topic: string): NoteDraftV1 => ({
  kind: 'convention', topic, conclusion: `S8E ${topic}`, anchor: { kind: 'project' }, extraAnchors: [],
  facts: [], basisFiles: [], structural: false, replaces: [], contradicts: [], coexistWith: [], body: '',
});

/** The strict model args of one draft (`record_note`'s write shape). */
function recordNoteArgs(note: NoteDraftV1): Record<string, unknown> {
  const common = {
    op: 'write', kind: note.kind, topic: note.topic, conclusion: note.conclusion,
    anchor: structuredClone(note.anchor), extraAnchors: structuredClone(note.extraAnchors),
    facts: structuredClone(note.facts), basisFiles: [...note.basisFiles], structural: note.structural,
    replaces: [...note.replaces], contradicts: [...note.contradicts], coexistWith: [...note.coexistWith],
  };
  if (note.kind === 'link') return { ...common, body: note.body, link: structuredClone(note.link) };
  if (note.kind === 'understanding') return { ...common, sections: structuredClone(note.sections) };
  if (note.kind === 'repair') return { ...common, body: note.body, repair: structuredClone(note.repair) };
  return { ...common, body: note.body };
}

/** The `{write, check}` a successful `record_note` tool result carries, or null. */
function toolEnvelopeOf(tool: unknown): { write: Record<string, unknown> } | null {
  const result = tool as { status?: string; output?: readonly { kind: string; value?: unknown }[] };
  if (result.status !== 'success') return null;
  const json = result.output?.find(entry => entry.kind === 'json');
  if (json === undefined || typeof json.value !== 'object' || json.value === null) return null;
  const value = json.value as Record<string, unknown>;
  const write = value['write'];
  return typeof write === 'object' && write !== null ? { write: write as Record<string, unknown> } : null;
}

/** Drives a real plain Query to its held model request; `use` sees the request and the Runtime's own context. */
async function withHeldPlainQuery<T>(
  world: S8ESemanticWorld,
  use: (ctx: CoreCallContext, request: ModelRequestShape) => Promise<T>,
): Promise<T> {
  const session = await world.createSecretary('r-auth-plain');
  const refs = await world.occupy(session);
  await world.scripted.script(session, [{ kind: 'text', text: SEMANTIC_ANSWER }]);
  const gate = await world.gates.modelRequest(session);
  const capture = captureQueryContexts();
  const started = startBusyQuery(world.ag2b, refs, refs.suffix);
  const ended = started.then(() => { throw new Error('S8E R-auth: the plain Query ended before its model request'); });
  ended.catch(() => undefined);
  try {
    await Promise.race([gate.reached, ended]);
    const request = await gate.reached;
    return await use(capture.latest(), request as unknown as ModelRequestShape);
  } finally {
    gate.release();
    capture.restore();
    await started.catch(() => undefined);
  }
}

describe('R-auth: an ordinary read-only plain Query gets no record_note and cannot write', () => {
  it('the real tool table has no record_note and a direct writeNote is forbidden', async () => {
    // The plain Query runs on the secretary binding, so this grant really names
    // `record_note`; the tool table must still drop it (the product rule).
    const world = await openS8ESemanticWorld({
      scribeTasks: 1, secretaryTools: ['read', 'look_graph', 'record_note'],
    });
    worlds.push(world);
    await s6aCardsWorkspace(world, S6A_SCOPE).createGoal(AG2B_GOAL_REF.goalId, 'S8E R-auth plain Query goal');
    await withHeldPlainQuery(world, async (ctx, request) => {
      expect(request.tools.map(tool => tool.name)).not.toContain('record_note');
      expect(ctx.principal.kind).toBe('query_run');

      const written = await world.platform.notes.writeNote(ctx, {
        commandId: 'r-auth-plain-write', note: convention('r-auth-plain'), expectedPointerRevision: null, goalId: null,
      });
      expect(written).toMatchObject({ status: 'rejected', code: 'forbidden' });

      const listed = await world.platform.notes.listByAnchor(world.humanContext(),
        { anchor: { kind: 'project' }, limit: 100, cursor: null });
      expect(listed.status).toBe('ready');
      if (listed.status === 'ready') expect(listed.value.items).toEqual([]);
    });
  });
});

describe('R-auth: a secretary request round admits the link tool and writes a link', () => {
  it('the frozen tool table names record_note, its kinds include link, and the write is read back', async () => {
    const world = await openS8ESemanticWorld({ scribeTasks: 1,
      secretaryTools: ['read', 'record_note'] });
    worlds.push(world);

    const configs: NoteToolsConfig[] = [];
    const original = noteToolModule.createNoteTools;
    vi.spyOn(noteToolModule, 'createNoteTools').mockImplementation((config: NoteToolsConfig) => {
      configs.push(config);
      return original(config);
    });

    const callId = 'r-auth-link-write';
    const draft = s8eLinkDraft(S8E_LINKS.K1);
    let secretary: S6ASession | null = null;
    const held = await world.secretaryRound({
      label: 'r-auth-link',
      goalId: null,
      replies: () => [
        { kind: 'calls', calls: [{ callId, name: 'record_note', args: recordNoteArgs(draft) }] },
        { kind: 'text', text: SEMANTIC_ANSWER },
      ],
    }, async round => {
      secretary = round.secretary;
      expect(round.manifest.request!.effectiveGoalId).toBeNull();
      // The frozen manifest is the tool table the round's Kernel request is built from.
      expect(round.manifest.promptSet.toolNames).toContain('record_note');
      // The real factory's admitted kinds are the secretary admission; link is in it.
      expect(configs.some(config => config.kinds.includes('link'))).toBe(true);
      expect(configs.at(-1)?.kinds).toEqual(['convention', 'pitfall', 'tradeoff', 'open_question', 'preference',
        'decision', 'understanding', 'link']);
      // The note tool holds the Runtime's own query_run principal, never a context built here.
      expect(configs.at(-1)?.context.principal).toMatchObject({ kind: 'query_run', queryRunRef: round.query.run.ref });
    });

    expect(held.started).toMatchObject({ status: 'ready' });
    expect(configs.length).toBeGreaterThan(0);
    if (secretary === null) throw new Error('S8E R-auth: the secretary round returned no Session');

    // The Kernel-delivered `record_note` result of the real model call.
    const requests = await world.scripted.requests(secretary);
    const delivered = requests.flatMap(request => request.messages)
      .find(message => message.role === 'tool' && message.callId === callId);
    if (delivered === undefined || delivered.role !== 'tool') {
      throw new Error('S8E R-auth: the record_note result was not delivered to the model');
    }
    const envelope = toolEnvelopeOf(delivered.result);
    expect(envelope).not.toBeNull();
    if (envelope === null) throw new Error('S8E R-auth: the record_note result carried no envelope');
    expect(envelope.write).toMatchObject({ status: 'accepted' });
    const noteId = envelope.write['noteId'];
    const version = envelope.write['version'];
    expect(typeof noteId).toBe('string');
    expect(version).toBe(1);

    // The public Host read of the same file anchor returns the link K1.
    const listed = await world.route('notes/list', {
      anchor: { kind: 'file', path: 'src/runtime/run.ts' }, state: 'accepted', limit: 100, cursor: null,
    }) as ReadResult<NoteListResultV1>;
    expect(listed.status).toBe('ready');
    if (listed.status !== 'ready') throw new Error(`S8E R-auth: notes/list was not ready: ${JSON.stringify(listed)}`);
    const item = listed.value.items.find(candidate => candidate.noteId === noteId);
    expect(item).toMatchObject({
      noteId, version: 1, kind: 'link', storedState: 'accepted', goalId: null,
      link: { relation: 'injects', verification: { status: 'verified' } },
    });
    expect(item?.source).toMatchObject({ kind: 'agent', duty: 'secretary' });
  });
});
