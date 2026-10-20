/**
 * Slice 4C C1.2/C1.3: the `record_note` tool adapter (L14, G-01, G-05).
 *
 * Every case reaches the code through the REAL factory `createNoteTools(...)`;
 * the write/check ports are recording fakes because the adapter is the unit.
 * The note service's own authority and draft validation have their own tests.
 */
import { describe, expect, it } from 'vitest';
import { createNoteTools, NOTE_TOOL_NAMES, type NoteToolsConfig } from '../../src/core/agent-runtime/note-tool.js';
import type { CommitCursor } from '../../src/contracts/command-event.js';
import type { CoreCallContext } from '../../src/contracts/core/call-context.js';
import type { RunRef } from '../../src/contracts/dispatch.js';
import type {
  NoteCheckPort, NoteCheckV1, NoteDispositionResult, NoteWritePort, WriteNoteInput, WriteNoteResult,
} from '../../src/core/work-graph/model/note-contracts.js';
import type { ToolCall, ToolDefinition, ToolResult, WorkspaceSandbox } from '../../vendor/coding-agent/dist/public-api.js';

const P = 'p';
const W = 'w';
const G = 'g';
const RUN: RunRef = { aggregateType: 'Run', projectId: P, goalId: G, runId: 'r1' };
const signal = (): AbortSignal => new AbortController().signal;
const cursor = (value: string): CommitCursor => value as CommitCursor;

function workContext(signalValue: AbortSignal): CoreCallContext {
  return {
    projectId: P, workspaceId: W,
    principal: {
      kind: 'work_run', runRef: { ...RUN },
      roleBinding: { schemaVersion: 1, bindingId: 'b', templateId: 'executor', templateRevision: '1',
        bindingVersion: 1, policyRevision: '1' },
    },
    materialReader: { kind: 'run', requester: { ...RUN } },
    signal: signalValue,
  };
}

function toolCall(callId: string, args: Record<string, unknown>): ToolCall {
  return { schemaVersion: 1, callId, name: 'record_note', arguments: args as ToolCall['arguments'] };
}

function outputValue(result: ToolResult): unknown {
  const first = result.output[0];
  return first !== undefined && first.kind === 'json' ? first.value : undefined;
}

function acceptedWrite(noteId = 'n1', version = 1): Extract<WriteNoteResult, { status: 'accepted' | 'pending_review' | 'staged' }> {
  return { status: 'accepted', noteId, version, reasons: [], overQuota: false, confirmedByUser: false,
    warnings: [], existingTopics: [] };
}

function noteCheck(noteId = 'n1', version = 1): NoteCheckV1 {
  return { noteId, version, observedFiles: [], freshness: 'fresh', changedFiles: [], staleReasons: [],
    sourceUnavailable: false, invalid: false, conflicting: false, overQuota: false, updateDue: null,
    currentEligible: true, anchorStatus: 'live', anchorRetiredReasons: [], retiredExtraAnchors: [],
    unresolvedFacts: [], uncheckedFacts: [], hints: [] };
}

type NoteOverrides = {
  write?: (ctx: CoreCallContext, input: WriteNoteInput) => Promise<WriteNoteResult>;
  check?: Pick<NoteCheckPort, 'checkNotes'>['checkNotes'];
  review?: (ctx: CoreCallContext, input: Parameters<NoteWritePort['reviewNote']>[1]) => Promise<NoteDispositionResult>;
  withdraw?: (ctx: CoreCallContext, input: Parameters<NoteWritePort['withdrawNote']>[1]) => Promise<NoteDispositionResult>;
  requestId?: (call: Readonly<ToolCall>) => string;
};

function buildNoteTools(overrides: NoteOverrides = {}) {
  const writes: { ctx: CoreCallContext; input: WriteNoteInput }[] = [];
  const reviews: { ctx: CoreCallContext; input: Parameters<NoteWritePort['reviewNote']>[1] }[] = [];
  const withdraws: { ctx: CoreCallContext; input: Parameters<NoteWritePort['withdrawNote']>[1] }[] = [];
  const checks: { ctx: CoreCallContext; input: Parameters<NoteCheckPort['checkNotes']>[1] }[] = [];
  const notes: NoteWritePort = {
    async writeNote(ctx, input) {
      writes.push({ ctx, input });
      return overrides.write === undefined ? acceptedWrite(input.note.kind === 'understanding' ? 'u1' : 'n1') : overrides.write(ctx, input);
    },
    async reviewNote(ctx, input) {
      reviews.push({ ctx, input });
      return overrides.review === undefined
        ? { status: 'done', noteId: input.noteId, version: input.expectedVersion + 1, state: 'reviewed',
          receipt: { identityKey: 'i', fingerprint: 'f', cursor: cursor('c1') } }
        : overrides.review(ctx, input);
    },
    async withdrawNote(ctx, input) {
      withdraws.push({ ctx, input });
      return overrides.withdraw === undefined
        ? { status: 'done', noteId: input.noteId, version: input.expectedVersion + 1, state: 'withdrawn',
          receipt: { identityKey: 'i', fingerprint: 'f', cursor: cursor('c1') } }
        : overrides.withdraw(ctx, input);
    },
  };
  const check: Pick<NoteCheckPort, 'checkNotes'> = {
    async checkNotes(ctx, input) {
      checks.push({ ctx, input });
      return overrides.check === undefined
        ? { status: 'ready', value: [noteCheck()] }
        : overrides.check(ctx, input);
    },
  };
  const config: NoteToolsConfig = {
    context: workContext(signal()),
    notes,
    check,
    requestIdForCall: overrides.requestId ?? (() => 'cmd-1'),
  };
  const handle = createNoteTools(config);
  const definitions = handle.create(null as unknown as WorkspaceSandbox);
  const definition: ToolDefinition = definitions[0]!;
  return { handle, config, definition, writes, reviews, withdraws, checks };
}

describe('S4C record_note tool', () => {
  it('GTN01 publishes exactly record_note as a non-read-only platform write', () => {
    const { handle, definition } = buildNoteTools();
    expect(handle.names).toEqual(['record_note']);
    expect(handle.names).toEqual([...NOTE_TOOL_NAMES]);
    expect(definition.name).toBe('record_note');
    expect(definition.effectClass).toBe('workspace_write');
    expect(definition.independentReadOnly).toBe(false);
    expect(definition.requiredCapabilities).toEqual([]);
  });

  it('GTN02 write maps the model args, uses the trusted commandId and returns { write, check }', async () => {
    const { definition, writes, checks, config } = buildNoteTools();
    const result = await definition.handler.execute(toolCall('c1', {
      op: 'write', kind: 'convention', topic: 'auth flow', conclusion: 'use jwt',
      anchor: { kind: 'file', path: 'src/a.ts', symbolRequest: { language: 'ts', name: 'f' } },
      extraAnchors: [{ kind: 'module', moduleId: 'M1' }], basisFiles: ['src/a.ts'], structural: false,
      replaces: ['old'], contradicts: [], coexistWith: [], expectedPointerRevision: 2,
    }), { signal: signal() });
    expect(result.status).toBe('success');
    expect(writes).toHaveLength(1);
    const input = writes[0]!.input;
    expect(input).toStrictEqual({ commandId: 'cmd-1', expectedPointerRevision: 2, goalId: null,
      note: { kind: 'convention', topic: 'auth flow', conclusion: 'use jwt',
        anchor: { kind: 'file', path: 'src/a.ts', symbolRequest: { language: 'ts', name: 'f' } },
        extraAnchors: [{ kind: 'module', moduleId: 'M1' }], facts: [], basisFiles: ['src/a.ts'],
        structural: false, replaces: ['old'], contradicts: [], coexistWith: [], body: undefined } });
    expect((input.note as { body: string }).body).toBeUndefined();
    expect(writes[0]!.ctx.projectId).toBe(P);
    expect(writes[0]!.ctx.principal).toEqual(config.context.principal);
    // The check follows a successful commit with withSimilar and the committed version.
    expect(checks).toHaveLength(1);
    expect(checks[0]!.input).toEqual({ items: [{ noteId: 'n1', version: 1 }], withSimilar: true });
    expect(outputValue(result)).toEqual({ write: acceptedWrite(), check: noteCheck() });
  });

  it('GTN03 an understanding write gives sections and no body', async () => {
    const { definition, writes } = buildNoteTools();
    const result = await definition.handler.execute(toolCall('c2', {
      op: 'write', kind: 'understanding', topic: 'status', conclusion: 'on track',
      anchor: { kind: 'goal', goalId: G },
      sections: { status: 's', decided: 'd', open: 'o', next: 'n', risks: 'r' },
    }), { signal: signal() });
    expect(result.status).toBe('success');
    const input = writes[0]!.input;
    expect(input).toStrictEqual({ commandId: 'cmd-1', expectedPointerRevision: null, goalId: null,
      note: { kind: 'understanding', topic: 'status', conclusion: 'on track',
        anchor: { kind: 'goal', goalId: G },
        extraAnchors: [], facts: [], basisFiles: [], structural: false, replaces: [], contradicts: [],
        coexistWith: [], sections: { status: 's', decided: 'd', open: 'o', next: 'n', risks: 'r' } } });
    expect('body' in input.note).toBe(false);
  });

  it('GTN04 a failed check is { status: unavailable } and never changes the committed write', async () => {
    const failure = { status: 'rejected', code: 'unavailable', reason: 'the check owner is down' } as const;
    const { definition, checks } = buildNoteTools({ check: async () => failure });
    const result = await definition.handler.execute(toolCall('c3', {
      op: 'write', kind: 'pitfall', topic: 't', conclusion: 'c', anchor: { kind: 'project' },
    }), { signal: signal() });
    expect(result.status).toBe('success');
    expect(checks).toHaveLength(1);
    expect(outputValue(result)).toEqual({ write: acceptedWrite(), check: { status: 'unavailable', reason: 'the check owner is down' } });
  });

  it('GTN05 a rejected write returns { write, check: unavailable } and fabricates no success', async () => {
    const rejection: WriteNoteResult = { status: 'rejected', code: 'invalid', reason: 'symbol_ambiguous',
      draft: { commandId: 'cmd-1', note: {} as never, expectedPointerRevision: null, goalId: null } };
    const { definition, checks } = buildNoteTools({ write: async () => rejection });
    const result = await definition.handler.execute(toolCall('c4', {
      op: 'write', kind: 'decision', topic: 't', conclusion: 'c', anchor: { kind: 'project' },
    }), { signal: signal() });
    expect(result.status).toBe('success');
    expect(checks).toHaveLength(0);
    expect(outputValue(result)).toEqual({ write: rejection,
      check: { status: 'unavailable', reason: 'symbol_ambiguous' } });
  });

  it('GTN06 review (with resolution) and withdraw return the disposition result verbatim', async () => {
    const { definition, reviews, withdraws } = buildNoteTools();
    const reviewed = await definition.handler.execute(toolCall('c5', {
      op: 'review', noteId: 'n1', expectedVersion: 3, verdict: 'accept', resolution: 'supersede',
      reason: 'agent contradiction', expectedPointerRevision: 4,
    }), { signal: signal() });
    expect(reviews[0]!.input).toStrictEqual({ commandId: 'cmd-1', noteId: 'n1', expectedVersion: 3,
      expectedPointerRevision: 4, verdict: 'accept', resolution: 'supersede', reason: 'agent contradiction' });
    expect(outputValue(reviewed)).toEqual({ status: 'done', noteId: 'n1', version: 4, state: 'reviewed',
      receipt: { identityKey: 'i', fingerprint: 'f', cursor: cursor('c1') } });
    // No trusted pointer revision or reason: both default to null.
    const plainReview = await definition.handler.execute(toolCall('c5b', {
      op: 'review', noteId: 'n2', expectedVersion: 1, verdict: 'review',
    }), { signal: signal() });
    // No resolution given: the request has no resolution key at all.
    expect(reviews[1]!.input).toStrictEqual({ commandId: 'cmd-1', noteId: 'n2', expectedVersion: 1,
      expectedPointerRevision: null, verdict: 'review', reason: null });
    expect(outputValue(plainReview)).toEqual({ status: 'done', noteId: 'n2', version: 2, state: 'reviewed',
      receipt: { identityKey: 'i', fingerprint: 'f', cursor: cursor('c1') } });
    const withdrawn = await definition.handler.execute(toolCall('c6', {
      op: 'withdraw', noteId: 'n2', expectedVersion: 1, reason: 'obsolete',
    }), { signal: signal() });
    expect(withdraws[0]!.input).toStrictEqual({ commandId: 'cmd-1', noteId: 'n2', expectedVersion: 1, reason: 'obsolete' });
    // An omitted reason defaults to null.
    const noReason = await definition.handler.execute(toolCall('c6b', {
      op: 'withdraw', noteId: 'n3', expectedVersion: 1,
    }), { signal: signal() });
    expect(withdraws[1]!.input).toStrictEqual({ commandId: 'cmd-1', noteId: 'n3', expectedVersion: 1, reason: null });
    expect(outputValue(noReason)).toEqual({ status: 'done', noteId: 'n3', version: 2, state: 'withdrawn',
      receipt: { identityKey: 'i', fingerprint: 'f', cursor: cursor('c1') } });
    expect(outputValue(withdrawn)).toEqual({ status: 'done', noteId: 'n2', version: 2, state: 'withdrawn',
      receipt: { identityKey: 'i', fingerprint: 'f', cursor: cursor('c1') } });
  });

  it('GTN07 a non-scribe review is answered by the service rejection, not a second tool-level check', async () => {
    const forbidden: NoteDispositionResult = { status: 'rejected', code: 'forbidden', reason: 'outside_managed_scope', noteId: 'n1' };
    const { definition } = buildNoteTools({ review: async () => forbidden });
    const result = await definition.handler.execute(toolCall('c7', {
      op: 'review', noteId: 'n1', expectedVersion: 1, verdict: 'review', reason: null,
    }), { signal: signal() });
    expect(result.status).toBe('success');
    expect(outputValue(result)).toEqual(forbidden);
  });

  it('GTN08 the strict op union rejects mixed ops and model-supplied identity keys before any write', async () => {
    const { definition, writes, checks, reviews, withdraws } = buildNoteTools();
    for (const args of [
      { op: 'write', kind: 'convention', topic: 't', conclusion: 'c', anchor: { kind: 'project' }, noteId: 'n1' },
      { op: 'review', noteId: 'n1', expectedVersion: 1, verdict: 'review', kind: 'convention' },
      { op: 'write', kind: 'convention', topic: 't', conclusion: 'c', anchor: { kind: 'project' }, goalId: G },
      { op: 'write', kind: 'convention', topic: 't', conclusion: 'c', anchor: { kind: 'project' },
        principal: { kind: 'host', actor: { kind: 'human', id: 'u' } } },
      { op: 'withdraw', noteId: 'n1', expectedVersion: 1, commandId: 'forged' },
    ]) {
      const result = await definition.handler.execute(toolCall('c8', args), { signal: signal() });
      expect(result).toMatchObject({ status: 'error', error: { code: 'invalid_arguments' } });
    }
    expect(writes).toHaveLength(0);
    expect(checks).toHaveLength(0);
    expect(reviews).toHaveLength(0);
    expect(withdraws).toHaveLength(0);
  });

  it('RW-15 a rejected bodyless write returns a JSON-safe envelope and the write reason', async () => {
    const draft = { commandId: 'cmd-1', expectedPointerRevision: null, goalId: null,
      note: { kind: 'convention', topic: 't', conclusion: 'c', anchor: { kind: 'project' },
        extraAnchors: [], facts: [], basisFiles: [], structural: false, replaces: [], contradicts: [],
        coexistWith: [], body: undefined } } as unknown as WriteNoteInput;
    const rejection: WriteNoteResult = { status: 'rejected', code: 'invalid',
      reason: 'a note requires a body', draft };
    const { definition, checks } = buildNoteTools({ write: async () => rejection });
    const result = await definition.handler.execute(toolCall('rw15-c', {
      op: 'write', kind: 'convention', topic: 't', conclusion: 'c', anchor: { kind: 'project' },
    }), { signal: signal() });
    expect(result.status).toBe('success');
    expect(checks).toHaveLength(0);
    const value = outputValue(result) as { write: { status: string; reason: string; draft: { note: Record<string, unknown> } };
      check: { status: string; reason: string } };
    const assertJsonSafe = (node: unknown): void => {
      if (node === null || typeof node !== 'object') return;
      if (Array.isArray(node)) { for (const entry of node) assertJsonSafe(entry); return; }
      for (const [key, entry] of Object.entries(node)) {
        expect(entry, `key ${key} must not be undefined`).not.toBeUndefined();
        assertJsonSafe(entry);
      }
    };
    assertJsonSafe(value);
    expect(Object.keys(value.write.draft.note)).not.toContain('body');
    expect(value.write.status).toBe('rejected');
    expect(value.write.reason).toBe('a note requires a body');
    expect(value.check).toEqual({ status: 'unavailable', reason: 'a note requires a body' });
  });
});
