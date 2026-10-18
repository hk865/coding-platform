/**
 * K3-39 (spec §5.2, R4 owner layer, decision 72 U1): the read-only L4
 * `lookupToolCommit` for `record_note`, dispatched at the notes owner's
 * production position in `createToolCommitLookup`'s fixed table.
 *
 * The lookup rebuilds the Kernel-recorded arguments with the SAME
 * `recordNoteRequestOf` and `toolCommitRequestId` the tool handler uses, and the
 * SAME identity/fingerprint pair `writeNote`/`dispose` commit. The committed
 * case is asserted against the disposition's own receipt cursor; the
 * not-committed case is a fresh call id. Expected values are literal; the
 * database is never read to answer an assertion.
 */
import { afterEach, describe, expect, it } from 'vitest';
import type { NoteDraftV1 } from '../../src/contracts/note.js';
import type { ToolCommitLookup, ToolCommitLookupResult } from '../../src/contracts/unknown-call-review.js';
import { createToolCommitLookup } from '../../src/composition/tool-commit-lookup.js';
import { toolCommitLookupUnknownTool, toolCommitRequestId } from '../../src/core/work-graph/model/tool-commit-arguments.js';
import {
  createS4ANoteFixture, type S4ANoteFixture, type S4ANoteFixtureKind,
} from '../helpers/S4A-note-fixture.js';

const KINDS: readonly S4ANoteFixtureKind[] = ['memory', 'sqlite'];
const fixtures: S4ANoteFixture[] = [];
afterEach(async () => { for (const f of fixtures.splice(0)) await f.close(); });

/** An owner that publishes no name; the fixed table never asks it. */
const NO_LOOKUP: ToolCommitLookup = async (_ctx, input) => toolCommitLookupUnknownTool(input.toolName);

/** The notes owner at the production fourth position of the dispatch table. */
function noteDispatch(owner: ToolCommitLookup): ToolCommitLookup {
  return createToolCommitLookup([NO_LOOKUP, NO_LOOKUP, NO_LOOKUP, owner]);
}

const FILE_A = { kind: 'file', path: 'src/a/x.ts' } as const;
const CONCLUSION = 'the committed conclusion';

function noteDraft(topic: string, body: string): NoteDraftV1 {
  return { kind: 'pitfall', topic, conclusion: CONCLUSION, anchor: FILE_A, extraAnchors: [], facts: [],
    basisFiles: [], structural: false, replaces: [], contradicts: [], coexistWith: [], body };
}

/** The exact Kernel-recorded `record_note` write arguments the lookup rebuilds. */
function writeArgs(topic: string, body: string) {
  return { op: 'write' as const, kind: 'pitfall' as const, topic, conclusion: CONCLUSION, anchor: FILE_A, body };
}

async function setup(kind: S4ANoteFixtureKind) {
  const f = await createS4ANoteFixture(kind);
  fixtures.push(f);
  const session = await f.createSession('k3-39-note', 'executor');
  const runRef = await f.claimInSession('k3-39-note', session.sessionRef, 't1', 'executor');
  const origin = { runRef, sessionRef: session.sessionRef, generation: 1, workspaceId: f.scope.workspaceId };
  return { f, runRef, origin };
}

describe.each(KINDS)('K3-39 record_note owner lookup (%s)', kind => {
  it('K3-39 record_note reports a committed write and not_committed through the dispatch', async () => {
    const { f, runRef, origin } = await setup(kind);
    const owner = f.notes.lookupToolCommit;
    expect(typeof owner).toBe('function');
    if (owner === undefined) return;
    const lookup = noteDispatch(owner);

    const kernelCallId = 'k3-39-note-write-call-1';
    const requestId = toolCommitRequestId({ origin, toolName: 'record_note', kernelCallId });
    const written = await f.notes.writeNote(f.workCtx(runRef), { commandId: requestId,
      note: noteDraft('k3-39 write note', 'the note body'), expectedPointerRevision: null, goalId: null });
    expect(written.status).not.toBe('rejected');

    const args = writeArgs('k3-39 write note', 'the note body');
    const hit = await lookup(f.ctx(), { toolName: 'record_note', arguments: args, kernelCallId, origin });
    expect(hit.status).toBe('committed');
    const committedHit = hit as Extract<ToolCommitLookupResult, { status: 'committed' }>;
    expect(committedHit.eventIds.length).toBeGreaterThan(0);
    expect(committedHit.eventIds.every((id) => typeof id === 'string' && id.length > 0)).toBe(true);
    expect(committedHit.cursor.length).toBeGreaterThan(0);
    // The same call resolves to the identical receipt.
    const again = await lookup(f.ctx(), { toolName: 'record_note', arguments: args, kernelCallId, origin });
    expect(again).toEqual(hit);

    const miss = await lookup(f.ctx(), { toolName: 'record_note', arguments: args,
      kernelCallId: 'k3-39-note-write-call-2', origin });
    expect(miss).toEqual({ status: 'not_committed' });

    // A different payload under the same call id is an authoritative conflict.
    const conflict = await lookup(f.ctx(), {
      toolName: 'record_note', arguments: writeArgs('k3-39 write note', 'another body'), kernelCallId, origin,
    });
    expect(conflict).toMatchObject({ status: 'undetermined' });
    expect((conflict as Extract<ToolCommitLookupResult, { status: 'undetermined' }>).reason)
      .toContain('idempotency_conflict');

    // A name no owner declares never reaches an owner.
    expect(await noteDispatch(NO_LOOKUP)(f.ctx(), { toolName: 'not_a_row_4_tool', arguments: args,
      kernelCallId, origin })).toEqual({ status: 'undetermined', reason: 'lookup_not_published' });
  });

  it('K3-39 record_note withdraw lookup returns the disposition receipt cursor', async () => {
    const { f, runRef, origin } = await setup(kind);
    const owner = f.notes.lookupToolCommit;
    expect(typeof owner).toBe('function');
    if (owner === undefined) return;
    const lookup = noteDispatch(owner);

    const writeCallId = 'k3-39-note-withdraw-setup';
    const writeRequestId = toolCommitRequestId({ origin, toolName: 'record_note', kernelCallId: writeCallId });
    const written = await f.notes.writeNote(f.workCtx(runRef), { commandId: writeRequestId,
      note: noteDraft('k3-39 withdraw note', 'the note body'), expectedPointerRevision: null, goalId: null });
    expect(written.status).not.toBe('rejected');
    if (written.status === 'rejected') return;

    const withdrawCallId = 'k3-39-note-withdraw-call-1';
    const withdrawRequestId = toolCommitRequestId({ origin, toolName: 'record_note', kernelCallId: withdrawCallId });
    const withdrawn = await f.notes.withdrawNote(f.workCtx(runRef), { commandId: withdrawRequestId,
      noteId: written.noteId, expectedVersion: written.version, reason: null });
    expect(withdrawn.status).toBe('done');
    if (withdrawn.status !== 'done') return;

    const hit = await lookup(f.ctx(), { toolName: 'record_note',
      arguments: { op: 'withdraw', noteId: written.noteId, expectedVersion: written.version },
      kernelCallId: withdrawCallId, origin });
    expect(hit).toMatchObject({ status: 'committed', cursor: withdrawn.receipt.cursor });
    expect((hit as Extract<ToolCommitLookupResult, { status: 'committed' }>).eventIds.length).toBeGreaterThan(0);
  });
});
