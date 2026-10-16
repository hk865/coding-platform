/**
 * Slice 4C C1.4 (NE7, R-01, R-03, D-09 notes/list half).
 *
 * The six notes/version-list routes run over the REAL `CORE_ROUTE_SPECS` table
 * with `parseCoreRouteRequest` + `dispatchCoreRoute` and the REAL
 * `createPlatformCoreRouteBindings(platform)` where `platform` is the full
 * `createTargetPlatform` assembly. Notes are built through the real public
 * `platform.notes` writer and read back through the HTTP routes.
 *
 * The only test double is the injected checker in the R-03 unavailable case
 * (the L-fixtures exception: a named port is made to fail).
 */
import { describe, expect, it } from 'vitest';
import type { CoreCallContext } from '../../src/contracts/core/call-context.js';
import type { NoteDraftAnchorV1, NoteDraftV1, NoteSectionsV1 } from '../../src/contracts/note.js';
import type { NoteListResultV1 } from '../../src/core/work-graph/model/note-contracts.js';
import type { CoreRouteSuffix, NotesListResponse, NotesWriteResponse } from '../../src/app/core-http-types.js';
import {
  CORE_ROUTE_SPECS, createPlatformCoreRouteBindings, dispatchCoreRoute, parseCoreRouteRequest,
  type CoreRouteBindings,
} from '../../src/app/core-routes.js';
import { createS4ANoteFixture, type S4ANoteFixture, type S4ANoteFixtureKind } from '../helpers/S4A-note-fixture.js';

const KINDS: readonly S4ANoteFixtureKind[] = ['memory', 'sqlite'];
const SCOPE = { projectId: 's4a-project', workspaceId: 's4a-workspace' };
const MODULE_A: NoteDraftAnchorV1 = { kind: 'module', moduleId: 'A' };

function convention(anchor: NoteDraftAnchorV1, topic: string, structural = false): NoteDraftV1 {
  return { kind: 'convention', topic, conclusion: `${topic} conclusion`, anchor, extraAnchors: [],
    facts: [], basisFiles: [], structural, replaces: [], contradicts: [], coexistWith: [], body: 'body' };
}
function projectUnderstanding(topic: string, structural = false): NoteDraftV1 {
  const sections: NoteSectionsV1 = { status: '现状', decided: '已定', open: '未决', next: '下一步', risks: '风险' };
  return { kind: 'understanding', topic, conclusion: `${topic} conclusion`, anchor: { kind: 'project' },
    extraAnchors: [], facts: [], basisFiles: [], structural, replaces: [], contradicts: [], coexistWith: [], sections };
}
function writeInput(ctx: CoreCallContext, note: NoteDraftV1, commandId: string, goalId: string | null) {
  return { commandId, note, expectedPointerRevision: null, goalId };
}
async function call(bindings: CoreRouteBindings, suffix: CoreRouteSuffix, ctx: CoreCallContext,
  input: unknown): Promise<unknown> {
  const parsed = parseCoreRouteRequest(suffix, { scope: SCOPE, input });
  if (!parsed.ok) throw new Error(`S4C parse failed: ${JSON.stringify(parsed.rejection)}`);
  return dispatchCoreRoute(bindings, suffix, ctx, parsed);
}
const listOf = (value: unknown): NotesListResponse => value as NotesListResponse;
const envelopeOf = (value: unknown): NotesWriteResponse => value as NotesWriteResponse;
const readyItems = (value: NotesListResponse): NoteListResultV1['items'] => {
  if (value.status !== 'ready') throw new Error(`expected a ready list, got ${JSON.stringify(value)}`);
  return value.value.items;
};

describe('S4C R-01 notes routes', () => {
  it.each(KINDS)('R-01 %s: notes/write is person-only, a user write reads back as user source and replays', async kind => {
    const f: S4ANoteFixture = await createS4ANoteFixture(kind);
    try {
      const bindings = createPlatformCoreRouteBindings(f.platform);
      // A member (work_run) identity is forbidden on the person's write route.
      const run = await f.claimRun('r01');
      const member = await call(bindings, 'notes/write', f.workCtx(run),
        writeInput(f.workCtx(run), convention(MODULE_A, 'member'), 'r01-member', f.goalRef.goalId));
      expect(member).toMatchObject({ status: 'rejected', code: 'forbidden' });

      const input = writeInput(f.ctx(), convention(MODULE_A, 'user-note'), 'r01-user', f.goalRef.goalId);
      const first = envelopeOf(await call(bindings, 'notes/write', f.ctx(), input));
      expect(first.write).toMatchObject({ status: 'accepted' });
      // N-12: the same commandId replays the ORIGINAL write result.
      const replay = envelopeOf(await call(bindings, 'notes/write', f.ctx(), input));
      expect(replay.write).toEqual(first.write);

      const items = readyItems(listOf(await call(bindings, 'notes/list', f.ctx(),
        { anchor: MODULE_A, limit: 20, cursor: null })));
      expect(items).toHaveLength(1);
      expect(items[0]!.source).toEqual({ kind: 'user', principalId: 's4a-operator' });
      expect(items[0]!.label).toBe('约定(模块 A)：user-note conclusion');

      // The two version lists pass through the real readers.
      const plans = await call(bindings, 'plans/versions', f.ctx(),
        { goalId: f.goalRef.goalId, limit: 50, cursor: null }) as { status: string; value?: { items: unknown[] } };
      expect(plans.status).toBe('ready');
      expect(plans.value!.items).toHaveLength(1);
      const catalog = await call(bindings, 'architecture/versions', f.ctx(),
        { limit: 50, cursor: null }) as { status: string; value?: { items: unknown[] } };
      expect(catalog.status).toBe('ready');
      expect(catalog.value!.items).toHaveLength(1);
    } finally { await f.close(); }
  });

  it.each(KINDS)('R-01 %s: notes/withdraw and notes/review are person-only too', async kind => {
    const f = await createS4ANoteFixture(kind);
    try {
      const bindings = createPlatformCoreRouteBindings(f.platform);
      const run = await f.claimRun('r01b');
      const member = f.workCtx(run);
      const withdraw = await call(bindings, 'notes/withdraw', member,
        { commandId: 'r01b-w', noteId: 'missing', expectedVersion: 1, reason: null });
      expect(withdraw).toMatchObject({ status: 'rejected', code: 'forbidden' });
      const review = await call(bindings, 'notes/review', member,
        { commandId: 'r01b-r', noteId: 'missing', expectedVersion: 1, expectedPointerRevision: null,
          verdict: 'review', reason: null });
      expect(review).toMatchObject({ status: 'rejected', code: 'forbidden' });
    } finally { await f.close(); }
  });

  it('R-01 route table: the six rows keep their literal kind/binding/owner', () => {
    const expected: Record<string, { kind: string; binding: string; owner: string }> = {
      'notes/list': { kind: 'plain', binding: 'listNotes', owner: 'notes.listNotes' },
      'notes/write': { kind: 'plain', binding: 'writeNote', owner: 'notes.writeNote' },
      'notes/withdraw': { kind: 'plain', binding: 'withdrawNote', owner: 'notes.withdrawNote' },
      'notes/review': { kind: 'plain', binding: 'reviewNote', owner: 'notes.reviewNote' },
      'plans/versions': { kind: 'plain', binding: 'listPlanVersions', owner: 'notes.listPlanVersions' },
      'architecture/versions': { kind: 'plain', binding: 'listCatalogVersions', owner: 'notes.listCatalogVersions' },
    };
    for (const [suffix, spec] of Object.entries(expected)) {
      expect(CORE_ROUTE_SPECS[suffix as CoreRouteSuffix]).toEqual(spec);
    }
  });
});

describe('S4C R-03 notes/write envelope', () => {
  it.each(KINDS)('R-03 %s: success check is a NoteCheckV1; an unavailable checker is honest; a rejected write writes nothing', async kind => {
    const f = await createS4ANoteFixture(kind);
    try {
      const bindings = createPlatformCoreRouteBindings(f.platform);
      const okInput = writeInput(f.ctx(), convention(MODULE_A, 'ok'), 'r03-ok', f.goalRef.goalId);
      const ok = envelopeOf(await call(bindings, 'notes/write', f.ctx(), okInput));
      expect(ok.write.status).toBe('accepted');
      const noteId = (ok.write as { noteId: string }).noteId;
      expect(ok.check).toMatchObject({ noteId, freshness: 'fresh' });
      expect(ok.check).not.toHaveProperty('status');

      // G-05: an unavailable checker is `{ status: 'unavailable', reason }` and
      // never changes the committed write.
      Object.assign(f.platform.notes, { checkNotes: async () =>
        ({ status: 'rejected', code: 'unavailable', reason: 'checker is down' }) });
      const down = envelopeOf(await call(bindings, 'notes/write', f.ctx(),
        writeInput(f.ctx(), convention(MODULE_A, 'down'), 'r03-down', f.goalRef.goalId)));
      expect(down.write.status).toBe('accepted');
      expect(down.check).toEqual({ status: 'unavailable', reason: 'checker is down' });

      // A rejected write commits nothing and its check does not pretend success.
      const bad = envelopeOf(await call(bindings, 'notes/write', f.ctx(),
        writeInput(f.ctx(), convention(MODULE_A, 'x'.repeat(201)), 'r03-bad', f.goalRef.goalId)));
      expect(bad.write).toMatchObject({ status: 'rejected', code: 'invalid' });
      expect(bad.check).toMatchObject({ status: 'unavailable' });

      const items = readyItems(listOf(await call(bindings, 'notes/list', f.ctx(),
        { anchor: MODULE_A, limit: 20, cursor: null })));
      expect(items.map(item => item.topic).sort()).toEqual(['down', 'ok']);
    } finally { await f.close(); }
  });
});

describe('S4C NE7 and D-09 notes/list', () => {
  it.each(KINDS)('NE7 %s: the three filter forms and an unsupported filter', async kind => {
    const f = await createS4ANoteFixture(kind);
    try {
      const bindings = createPlatformCoreRouteBindings(f.platform);
      await call(bindings, 'notes/write', f.ctx(),
        writeInput(f.ctx(), convention(MODULE_A, 'alpha'), 'ne7-a', f.goalRef.goalId));

      // Form 1: by anchor, with the lookup's explicit state override.
      const anchorAll = readyItems(listOf(await call(bindings, 'notes/list', f.ctx(),
        { anchor: MODULE_A, limit: 20, cursor: null })));
      expect(anchorAll.map(item => item.topic)).toEqual(['alpha']);
      const anchorAccepted = readyItems(listOf(await call(bindings, 'notes/list', f.ctx(),
        { anchor: MODULE_A, state: 'accepted', limit: 20, cursor: null })));
      expect(anchorAccepted.map(item => item.topic)).toEqual(['alpha']);
      const anchorStaged = readyItems(listOf(await call(bindings, 'notes/list', f.ctx(),
        { anchor: MODULE_A, state: 'staged', limit: 20, cursor: null })));
      expect(anchorStaged).toEqual([]);

      // Form 3: that goal's current heads.
      const byGoal = readyItems(listOf(await call(bindings, 'notes/list', f.ctx(),
        { goalId: f.goalRef.goalId, state: 'accepted', limit: 20, cursor: null })));
      expect(byGoal.map(item => item.topic)).toEqual(['alpha']);

      // Any other filter is `invalid` / `notes_list_filter_unsupported`.
      const unsupported = await call(bindings, 'notes/list', f.ctx(),
        { goalId: f.goalRef.goalId, state: 'staged', limit: 20, cursor: null });
      expect(unsupported).toMatchObject({ status: 'rejected', code: 'invalid', reason: 'notes_list_filter_unsupported' });
    } finally { await f.close(); }
  });

  it.each(KINDS)('D-09 %s: a goal-less pending note is visible with state pending_review and goalId null', async kind => {
    const f = await createS4ANoteFixture(kind);
    try {
      // D-09 setup through the public writer: the project scribe's structural
      // project understanding stays pending and carries goalId null.
      const scribe = f.workCtx(await f.claimRun('d09-scribe', 't3', 'scribe'));
      const written = await f.write(scribe, projectUnderstanding('d09-project', true), null,
        { commandId: 'd09-pending', expectedPointerRevision: null });
      expect(written).toMatchObject({ status: 'pending_review', reasons: ['structural'] });

      const bindings = createPlatformCoreRouteBindings(f.platform);
      const items = readyItems(listOf(await call(bindings, 'notes/list', f.ctx(),
        { goalId: null, state: 'pending_review', limit: 20, cursor: null })));
      expect(items.map(item => item.topic)).toContain('d09-project');
      for (const item of items) expect(item.goalId).toBeNull();
    } finally { await f.close(); }
  });
});
