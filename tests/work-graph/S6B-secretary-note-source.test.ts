/**
 * Row 7: the secretary QueryRun note source and its one resolver, on the frozen request world.
 *
 * Every round is the frozen fixture's `holdS6BRequestRound` (a real secretary round held at its model gate); the
 * `query_run` context is the Runtime's own principal, taken by a pass-through wrapper on
 * `createQueryGraphToolGroup` (rule sheet A3: the real group is built and returned unchanged). The resolver is
 * likewise the real `createSecretaryQueryRun`, wrapped only to record the ctx and the result it returned.
 *
 * Expected values are the public round reads (`queries/read`, `materials/open`), the seeded goal and the source
 * contract; nothing is read from the store and no context is built for a Run.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { CoreCallContext } from '../../src/contracts/core/call-context.js';
import type { NoteDraftAnchorV1, NoteDraftV1 } from '../../src/contracts/note.js';
import type { NoteItemV1 } from '../../src/core/work-graph/model/note-contracts.js';
import type { SecretaryQueryRunPort } from '../../src/core/work-graph/model/secretary-query-run-contracts.js';
import * as secretaryQueryRunModule from '../../src/core/work-graph/tasks/secretary-query-run.js';
import { startBusyQuery } from '../helpers/AG2b-collaboration-fixture.js';
import { holdS6BRequestRound, type S6BHeldRound } from '../helpers/S6B1-fixture.js';
import { openS6AHostWorld, type S6AHostWorld } from '../helpers/S6A-host-fixture.js';
import { S6A_SCOPE } from '../helpers/S6A-request-fixture.js';
import { captureQueryContexts } from '../helpers/query-context-capture.js';

const SEMANTIC_ANSWER = JSON.stringify({ schemaVersion: 1, body: 'S6B answer', ideas: [], goalCardDrafts: [] });

const worlds: S6AHostWorld[] = [];
afterEach(async () => {
  vi.restoreAllMocks();
  await Promise.all(worlds.splice(0).map(world => world.close()));
});

type ResolveResult = Awaited<ReturnType<SecretaryQueryRunPort['resolveSecretaryQueryRun']>>;

/**
 * A3: the real resolver factory runs; the wrapper records what the real port answered for each real context.
 * A2: `failRead(n)` makes the n-th next read of the real store by that resolver throw, once.
 */
function captureResolverPort() {
  const records: { ctx: CoreCallContext; result: ResolveResult }[] = [];
  let port: SecretaryQueryRunPort | null = null;
  let readsUntilFailure = 0;
  const original = secretaryQueryRunModule.createSecretaryQueryRun;
  const spy = vi.spyOn(secretaryQueryRunModule, 'createSecretaryQueryRun').mockImplementation(deps => {
    const real = original({ ...deps, records: { readMany: refKeys => readsUntilFailure > 0 && --readsUntilFailure === 0
      ? Promise.reject(new Error('S6B: the store read failed')) : deps.records.readMany(refKeys) } });
    port = {
      async resolveSecretaryQueryRun(ctx) {
        const result = await real.resolveSecretaryQueryRun(ctx);
        records.push({ ctx: structuredClone(ctx), result: structuredClone(result) });
        return result;
      },
    };
    return port;
  });
  return {
    records,
    port(): SecretaryQueryRunPort {
      if (port === null) throw new Error('S6B: the composition built no secretary QueryRun resolver');
      return port;
    },
    failRead: (nth: number) => { readsUntilFailure = nth; },
    restore: () => spy.mockRestore(),
  };
}

async function openWorld() {
  const resolver = captureResolverPort();
  try {
    const world = await openS6AHostWorld({ backend: 'memory', secretaryTools: ['read', 'look_graph'] });
    worlds.push(world);
    return { world, resolver };
  } finally {
    resolver.restore();
  }
}

function noteOf(topic: string, anchor: NoteDraftAnchorV1): NoteDraftV1 {
  return { kind: 'convention', topic, conclusion: `S6B ${topic}`, anchor, extraAnchors: [], facts: [], basisFiles: [],
    structural: false, replaces: [], contradicts: [], coexistWith: [], body: `S6B ${topic} body` };
}

async function readNote(world: S6AHostWorld, noteId: string): Promise<NoteItemV1> {
  const read = await world.platform.notes.readNote(world.humanContext(), { noteId });
  if (read.status !== 'ready') throw new Error(`S6B: the note is not readable: ${JSON.stringify(read)}`);
  return read.value;
}

/** Drives a real plain Query on `session` to its held model request and runs `use` with its real context. */
async function withHeldPlainQuery<T>(world: S6AHostWorld, use: (ctx: CoreCallContext) => Promise<T>): Promise<T> {
  const session = await world.createSecretary('plain-query');
  const refs = await world.occupy(session);
  await world.scripted.script(session, [{ kind: 'text', text: SEMANTIC_ANSWER }]);
  const gate = await world.gates.modelRequest(session);
  const capture = captureQueryContexts();
  const started = startBusyQuery(world.ag2b, refs, refs.suffix);
  const ended = started.then(() => { throw new Error('S6B: the plain Query ended before its model request'); });
  ended.catch(() => undefined);
  try {
    await Promise.race([gate.reached, ended]);
    return await use(capture.latest());
  } finally {
    gate.release();
    capture.restore();
    await started.catch(() => undefined);
  }
}

describe('the secretary QueryRun note source', () => {
  it.each([{ label: 'goal-source', goal: true }, { label: 'no-goal-source', goal: false }])(
    'writes the source and goal of a $label round from the frozen preparation', async ({ label, goal }) => {
      const { world, resolver } = await openWorld();
      const capture = captureQueryContexts();
      try {
        const goalId = goal ? world.goals.first.goalId : null;
        const anchor: NoteDraftAnchorV1 = goalId === null ? { kind: 'project' } : { kind: 'goal', goalId };
        let round!: S6BHeldRound;
        const held = await holdS6BRequestRound(world, { label, goalId }, async heldRound => {
          round = heldRound;
          return await world.platform.notes.writeNote(capture.latest(), {
            commandId: `s6b-${label}`, note: noteOf(label, anchor), expectedPointerRevision: null, goalId: null,
          });
        });
        expect(round.manifest.request!.effectiveGoalId).toBe(goalId);
        expect(held.value.status).toBe('accepted');
        if (held.value.status !== 'accepted') throw new Error('unreachable');
        const resolved = resolver.records.at(-1);
        expect(resolved?.result.status).toBe('ready');
        if (resolved?.result.status !== 'ready' || resolved.ctx.principal.kind !== 'query_run') throw new Error('unreachable');
        const value = resolved.result.value;
        expect(value.principal).toEqual(resolved.ctx.principal);
        expect(value.run).toEqual(resolved.ctx.principal.queryRunRef);
        expect(value.run).toEqual(round.query.run.ref);
        expect(value.round).toEqual(round.query.run.run.queryJobRef);
        expect(value.round).toEqual(round.manifest.request!.round.ref);
        expect(value.requestRoot).toEqual(round.manifest.request!.requestRoot);
        expect(value.sessionGeneration).toBe(round.query.run.run.executionState?.sessionGeneration);
        expect(value.sessionGeneration).toBe(round.manifest.sessionGeneration);
        expect(value.effectiveGoalId).toBe(goalId);
        expect(value.session).toEqual(round.secretary.ref);
        expect(value.scope).toEqual({ projectId: S6A_SCOPE.projectId, workspaceId: S6A_SCOPE.workspaceId });
        expect(value.duty).toBe('secretary');
        expect(value.goals).toEqual([]);

        const note = await readNote(world, held.value.noteId);
        expect(note.anchor).toEqual(anchor);
        expect(note.goalId).toBe(goalId);
        expect(note.source).toEqual({ kind: 'agent', sessionRef: round.secretary.ref, runRef: null,
          queryRunRef: round.query.run.ref, duty: 'secretary' });
      } finally {
        capture.restore();
      }
    });
});

describe('rejects: a caller without a running request round', () => {
  it('a host principal', async () => {
    const { world, resolver } = await openWorld();
    const result = await resolver.port().resolveSecretaryQueryRun(world.humanContext());
    expect(result).toMatchObject({ status: 'rejected', code: 'forbidden' });
  });

  it('a round that has already settled', async () => {
    const { world, resolver } = await openWorld();
    const capture = captureQueryContexts();
    try {
      await holdS6BRequestRound(world, { label: 'settled', goalId: world.goals.first.goalId }, async () => undefined);
      const result = await resolver.port().resolveSecretaryQueryRun(capture.latest());
      expect(result).toMatchObject({ status: 'rejected', code: 'forbidden' });
    } finally {
      capture.restore();
    }
  });

  it('a plain Query (the resolver and its note write)', async () => {
    const { world, resolver } = await openWorld();
    await withHeldPlainQuery(world, async ctx => {
      const resolved = await resolver.port().resolveSecretaryQueryRun(ctx);
      expect(resolved).toMatchObject({ status: 'rejected', code: 'forbidden' });
      const written = await world.platform.notes.writeNote(ctx, { commandId: 's6b-plain-source',
        note: noteOf('plain-source', { kind: 'project' }), expectedPointerRevision: null, goalId: null });
      expect(written).toMatchObject({ status: 'rejected', code: 'forbidden' });
      const listed = await world.platform.notes.listByAnchor(world.humanContext(),
        { anchor: { kind: 'project' }, limit: 100, cursor: null });
      expect(listed.status).toBe('ready');
      if (listed.status === 'ready') expect(listed.value.items).toEqual([]);
    });
  });

  // The copy's own QueryRun has settled before `makeReadonlyCopy` returns, so the phase check refuses it first; the
  // read-only copy guard alone is not proven here (that needs a copy round still running, which no step here makes).
  it('a settled read-only copy is still refused (phase; the copy guard is not proven alone)', async () => {
    const { world, resolver } = await openWorld();
    const source = await world.createSecretary('copy-source');
    const capture = captureQueryContexts();
    try {
      await world.makeReadonlyCopy(source, 'copy');
      const ctx = capture.latest();
      const resolved = await resolver.port().resolveSecretaryQueryRun(ctx);
      expect(resolved).toMatchObject({ status: 'rejected', code: 'forbidden' });
      const written = await world.platform.notes.writeNote(ctx, { commandId: 's6b-copy-source',
        note: noteOf('copy-source', { kind: 'project' }), expectedPointerRevision: null, goalId: null });
      expect(written).toMatchObject({ status: 'rejected', code: 'forbidden' });
    } finally {
      capture.restore();
    }
  });
});

describe('a store read that throws while the resolver reads a running round', () => {
  it.each([{ nth: 1, record: 'QueryRun' }, { nth: 2, record: 'Session' }, { nth: 3, record: 'QueryJob' }])(
    'the $record read is unavailable', async ({ nth }) => {
      const { world, resolver } = await openWorld();
      const capture = captureQueryContexts();
      try {
        const held = await holdS6BRequestRound(world, { label: `read-${nth}`, goalId: world.goals.first.goalId },
          async () => {
            resolver.failRead(nth);
            return await resolver.port().resolveSecretaryQueryRun(capture.latest());
          });
        expect(held.value).toMatchObject({ status: 'rejected', code: 'unavailable' });
      } finally {
        capture.restore();
      }
    });
});
