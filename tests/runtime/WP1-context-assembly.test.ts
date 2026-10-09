/**
 * Wiring 1 W13 (spec §5.2 rows GC03, GC04, AN08): the Work/Query context
 * assembly binding and reminders of
 * `src/core/agent-runtime/context-assembler.ts` §4.3.
 *
 * All three rows run through the frozen `assemblerWithFacts` fixture (real
 * assembler, typed graph-fact doubles, `p`/`g`/`w` ids). GC03 is the new
 * behaviour (the Work binding's Goal `record` source carries
 * `goalContextDigestV1(facts.goal)`, the Goal section bytes do not change);
 * GC04 and AN08 are the unchanged Query binding and anomaly reminder row.
 */
import { describe, expect, it } from 'vitest';
import { canonicalJson, type JsonValue } from '../../src/contracts/fingerprint.js';
import type { ContextSourceV1 } from '../../src/contracts/graph-context.js';
import { goalContextDigestV1 } from '../../src/contracts/graph-context.js';
import { contextAssemblyProblem } from '../../src/core/work-graph/state/context-input.js';
import { assemblerWithFacts } from '../helpers/WP1-units-fixture.js';

/** Narrows a `ReadResult` to its ready branch without hiding a real rejection. */
function ready<T extends { status: string }>(result: T): Extract<T, { status: 'ready' }> {
  if (result.status !== 'ready') throw new Error(`expected a ready result, got ${result.status}`);
  return result as Extract<T, { status: 'ready' }>;
}

function canonicalKey(value: unknown): string {
  return canonicalJson(value as unknown as JsonValue);
}

function recordSourceOf(
  sources: readonly ContextSourceV1[], ref: unknown,
): Extract<ContextSourceV1, { kind: 'record' }> | undefined {
  return sources.find((source): source is Extract<ContextSourceV1, { kind: 'record' }> =>
    source.kind === 'record' && canonicalKey(source.ref) === canonicalKey(ref));
}

describe('wiring 1 context assembly binding', () => {
  it('GC03 assembleTask replaces only the Goal digest and leaves the Goal section bytes unchanged', async () => {
    const f = assemblerWithFacts();
    const result = ready(await f.assembleTask());
    const { binding, input } = result.value;
    const claim = f.taskInput.execution.outbox.claim;
    const runRef = claim.runRef;
    const planRef = claim.planRef;
    const goalRef = f.goal.ref;
    const goalDigest = goalContextDigestV1(f.facts.goal);
    expect(goalDigest).toMatch(/^[0-9a-f]{64}$/);

    expect(recordSourceOf(binding.sources, goalRef)?.digest).toBe(goalDigest);
    expect(recordSourceOf(binding.sources, planRef)).toEqual({ kind: 'record', ref: planRef, revision: 1, digest: null });
    expect(recordSourceOf(binding.sources, runRef)).toEqual({ kind: 'record', ref: runRef, revision: 1, digest: null });

    const expectedSources: ContextSourceV1[] = [
      { kind: 'record', ref: runRef, revision: 1, digest: null },
      { kind: 'record', ref: planRef, revision: 1, digest: null },
      { kind: 'record', ref: goalRef, revision: 1, digest: goalDigest },
    ];
    expectedSources.sort((left, right) => {
      const leftKey = canonicalKey(left);
      const rightKey = canonicalKey(right);
      return leftKey < rightKey ? -1 : leftKey > rightKey ? 1 : 0;
    });
    expect(binding.sources).toEqual(expectedSources);

    expect(contextAssemblyProblem({
      binding, text: input, selectedTaskInputs: result.value.selectedTaskInputs, continuationSuffix: null,
    })).toBeNull();

    const goalSection = binding.sections.find((section) => section.name === 'goal');
    if (goalSection?.startByte == null || goalSection.endByte == null) {
      throw new Error('GC03 needs a real Goal section interval');
    }
    const goalBytes = Buffer.from(input, 'utf8')
      .subarray(goalSection.startByte, goalSection.endByte).toString('utf8');
    expect(goalBytes).toBe([
      '## Goal',
      'goal: g',
      `objective: ${f.objective}`,
      `workspace: w@${String(f.workspaceRevision)}`,
      'autonomy: (not_implemented)',
      'current understanding: (not_implemented)',
    ].join('\n'));
  });

  it('GC04 assembleQuery leaves the Goal record digest null', async () => {
    const f = assemblerWithFacts();
    const result = ready(await f.assembleQuery());
    expect(recordSourceOf(result.value.binding.sources, f.goal.ref)?.digest).toBeNull();
  });

  it('AN08 the reminders section carries the anomaly row and never the not-connected line', async () => {
    const seed = assemblerWithFacts();
    const f = assemblerWithFacts({ extensions: seed.anomalyExtensions, budget: 4096 });
    const result = ready(await f.assembleTask());
    const { binding, input } = result.value;
    expect(binding.extensions.anomalies).toBe('available');
    const rowText = canonicalJson({
      key: f.anomalyRow.key, node: f.anomalyRow.node, text: f.anomalyRow.text, sources: f.anomalyRow.sources,
    } as unknown as JsonValue);
    const reminders = binding.sections.find((section) => section.name === 'reminders');
    if (reminders?.startByte == null || reminders.endByte == null) {
      throw new Error('AN08 needs a real reminders section interval');
    }
    const remindersBytes = Buffer.from(input, 'utf8')
      .subarray(reminders.startByte, reminders.endByte).toString('utf8');
    expect(remindersBytes).toContain(rowText);
    expect(remindersBytes).toContain('注记索引尚未接入');
    expect(input).not.toContain('异常锚点投影尚未接入');
  });
});
