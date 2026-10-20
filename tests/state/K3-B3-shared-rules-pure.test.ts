/**
 * K3 B3 rework 9, package B: pure shared-rule rows.
 *
 * A5: only exported pure functions are called with hand-computed input. No
 * store, platform, Host, Workflow, Runtime or stub port is built.
 */
import { describe, expect, it } from 'vitest';
import { commandActionKey, normalizeCommandText } from '../../src/core/work-graph/state/command-normalization.js';
import { expandShellScripts } from '../../src/core/work-graph/tasks/command-expansion.js';
import { orderBlockedCommands } from '../../src/core/work-graph/tasks/blocked-command-order.js';
import { isNonNeg, isObject, isPos, nonEmpty } from '../../src/core/work-graph/tasks/codec-fields.js';
import { truncateUtf8, utf8ByteLength } from '../../src/contracts/utf8.js';
import {
  newCommandRerunRequest, transitionCommandRerunRequest,
  type NewCommandRerunRequestInputV1,
} from '../../src/core/work-graph/state/command-rerun-request.js';
import type { CommandRerunRequestV1 } from '../../src/contracts/command-rerun-request.js';
import type { GoalRef } from '../../src/contracts/ledger.js';
import { pinRevision } from '../../src/core/work-graph/tasks/revision-guard.js';

describe('F-074 shared blocked-command flatten + order', () => {
  it('flattens every record first, then orders by createdAt, alias and ref key', () => {
    const ordered = orderBlockedCommands([
      { createdAt: '2026-01-01T00:00:00.000Z', refKey: 'review-a', commands: [
        { alias: 2, value: 'a2' }, { alias: 1, value: 'a1' }] },
      { createdAt: '2026-01-01T00:00:00.000Z', refKey: 'review-b', commands: [
        { alias: 1, value: 'b1' }] },
      { createdAt: '2025-12-31T00:00:00.000Z', refKey: 'review-z', commands: [
        { alias: 5, value: 'z5' }] },
    ]);
    expect(ordered).toEqual(['z5', 'a1', 'b1', 'a2']);
  });
});

describe('F-083 shared UTF-8 truncation', () => {
  it('never splits a multi-byte character (Chinese / surrogate pair / exact boundary)', () => {
    expect(truncateUtf8('中a', 3)).toBe('中');
    expect(truncateUtf8('中文', 4)).toBe('中');
    expect(truncateUtf8('😀', 3)).toBe('');
    expect(truncateUtf8('😀', 4)).toBe('😀');
    expect(truncateUtf8('😀a', 5)).toBe('😀a');
    expect(truncateUtf8('abc', 3)).toBe('abc');
    expect(truncateUtf8('abc', 0)).toBe('');
    expect(utf8ByteLength(truncateUtf8('中a😀', 5))).toBeLessThanOrEqual(5);
  });
});

describe('F-088 one action key on every path', () => {
  it('gives a parsed action, its expansion and the whole-text fallback the same key', async () => {
    const words = ['tsc', '-p', '.'];
    const expansion = await expandShellScripts({
      actions: [{ words: ['npm', 'run', 'build'], text: 'npm run build', dirs: [] }],
      cwd: '.', maxFiles: 1,
      readFile: async () => ({ content: JSON.stringify({ scripts: { build: 'tsc -p .' } }), digest: 'd' }),
    });
    expect(expansion.expansions[0]!.actions[0]!.sha256).toBe(commandActionKey(words));
    // Separate fallback example: the whole text is normalised, then split.
    const fallbackText = normalizeCommandText('foo   bar');
    expect(commandActionKey(fallbackText.split(' '))).toBe(commandActionKey(['foo', 'bar']));
  });
});

describe('F-089 shared codec field predicates keep their boundaries', () => {
  it('accepts a plain object only and keeps the integer/non-negative/empty-string edges', () => {
    expect(isObject({})).toBe(true);
    expect(isObject([])).toBe(false);
    expect(isObject(null)).toBe(false);
    expect(nonEmpty('')).toBe(false);
    expect(nonEmpty('a')).toBe(true);
    expect(isPos(0)).toBe(false);
    expect(isPos(1)).toBe(true);
    expect(isPos(1.5)).toBe(false);
    expect(isNonNeg(0)).toBe(true);
    expect(isNonNeg(-1)).toBe(false);
  });
});

describe('F-081 the state transition owns the declared-form business cap', () => {
  const base: NewCommandRerunRequestInputV1 = {
    ref: { aggregateType: 'CommandRerunRequest', projectId: 'p1', goalId: 'g1', taskId: 't1', requestId: 'rq1' },
    workspaceId: 'w1',
    task: { projectId: 'p1', goalId: 'g1', taskId: 't1' },
    reviewRef: { aggregateType: 'UnknownCallReview', projectId: 'p1', goalId: 'g1', runId: 'review-1' },
    runRef: { aggregateType: 'Run', projectId: 'p1', goalId: 'g1', runId: 'run-1' },
    alias: 3, command: 'npm run db:migrate', commandSha256: 'sha-command',
    match: { kind: 'exact' }, reason: 'rerun after the check',
    createdAt: '2026-01-01T00:00:00.000Z',
  };
  it('accepts forms 1..8 and refuses the ninth with capacity (hand literals)', () => {
    const created = newCommandRerunRequest(base);
    if (!created.ok) throw new Error('constructor refused');
    let current: CommandRerunRequestV1 = created.next;
    for (let index = 1; index <= 8; index += 1) {
      const added = transitionCommandRerunRequest(current, {
        kind: 'forms_added', identityKey: `f${String(index)}`, fingerprint: `fp-f${String(index)}`,
        form: { sha256: `sha-${String(index)}`, text: `form-${String(index)}` },
      }, { expectedRevision: current.revision, updatedAt: '2026-01-02T00:00:00.000Z',
        cardMatches: true, taskActive: true, sameRun: true });
      if (!added.ok || added.next === 'none') throw new Error(`form ${String(index)} refused`);
      current = added.next;
    }
    expect(current.declaredForms).toEqual([
      { sha256: 'sha-1', text: 'form-1' }, { sha256: 'sha-2', text: 'form-2' },
      { sha256: 'sha-3', text: 'form-3' }, { sha256: 'sha-4', text: 'form-4' },
      { sha256: 'sha-5', text: 'form-5' }, { sha256: 'sha-6', text: 'form-6' },
      { sha256: 'sha-7', text: 'form-7' }, { sha256: 'sha-8', text: 'form-8' },
    ]);
    const ninth = transitionCommandRerunRequest(current, {
      kind: 'forms_added', identityKey: 'f9', fingerprint: 'fp-f9',
      form: { sha256: 'sha-9', text: 'form-9' },
    }, { expectedRevision: current.revision, updatedAt: '2026-01-02T00:00:00.000Z',
      cardMatches: true, taskActive: true, sameRun: true });
    expect(ninth.ok).toBe(false);
    if (ninth.ok) throw new Error('the ninth form was accepted');
    expect(ninth.reason).toBe('guard_failed');
    expect(ninth.code).toBe('capacity');
    expect(ninth.detail).toBe('a request holds at most 8 declared forms');
  });
});

describe('F-089 revision pin boundaries', () => {
  const ref: GoalRef = { aggregateType: 'Goal', projectId: 'p1', goalId: 'g1' };
  it('accepts one non-negative integer pin and refuses absent/repeated/malformed', () => {
    expect(pinRevision([{ ref, revision: 2 }], ref)).toBe(2);
    expect(pinRevision([{ ref, revision: 0 }], ref)).toBe(0);
    expect(pinRevision([], ref)).toBeNull();
    expect(pinRevision([{ ref, revision: 1 }, { ref, revision: 2 }], ref)).toBeNull();
    expect(pinRevision([{ ref, revision: 1.5 }], ref)).toBeNull();
    expect(pinRevision([{ ref, revision: -1 }], ref)).toBeNull();
  });
});
