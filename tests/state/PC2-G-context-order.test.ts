/**
 * PC-2 ruling 9/12 (G): the binding's required `sectionOrder` is the truth.
 *
 * `role` is first, every name is legal for the call kind and appears at most
 * once, the goal/task sections the call kind requires are named, and the
 * rendered `sections` are a subsequence in exactly that order. There is no
 * global fixed order: a legal different order is accepted.
 *
 * Pure constructed input -> output; no store, Kernel or model.
 */
import { describe, expect, it } from 'vitest';
import type {
  ContextAssemblyBindingV1, ContextSectionNameV1,
} from '../../src/contracts/graph-context.js';
import type { CoreRejection } from '../../src/contracts/core/results.js';
import { contextAssemblyProblem, frozenSectionOrderProblem } from '../../src/core/work-graph/state/context-input.js';

const B = (text: string): number => Buffer.byteLength(text, 'utf8');

const NO_EXTENSIONS: ContextAssemblyBindingV1['extensions'] = {
  notes: 'not_implemented', anomalies: 'not_implemented', footprint: 'not_implemented',
  goalSettings: 'not_implemented', decisions: 'not_implemented',
};

type Part = { name: ContextSectionNameV1; text: string };

function layout(parts: Part[]): { text: string; sections: ContextAssemblyBindingV1['sections'] } {
  let text = '';
  const sections: ContextAssemblyBindingV1['sections'] = [];
  for (const part of parts) {
    if (text !== '') text += '\n\n';
    const startByte = B(text);
    text += part.text;
    sections.push({ name: part.name, startByte, endByte: B(text), omitted: 0 });
  }
  return { text, sections };
}

const ROLE: Part = { name: 'role', text: '## Runtime context\nR' };
const GOAL: Part = { name: 'goal', text: '## Goal\nG' };
const TASK: Part = { name: 'task', text: '## Accepted task\nT' };
const FOOTPRINT: Part = { name: 'footprint', text: '## Footprint\nF' };
const NOTES: Part = { name: 'notes', text: '## Note index\nN' };

const FIXED: Part[] = [ROLE, GOAL, TASK, FOOTPRINT, NOTES];
const BASE = layout(FIXED);

/** The §5.1 work binding over `parts`, with a caller-chosen section order. */
function workBinding(
  parts: Part[], sectionOrder: ContextSectionNameV1[], over: Partial<ContextAssemblyBindingV1> = {},
): ContextAssemblyBindingV1 {
  const rendered = layout(parts);
  return {
    schemaVersion: 1, formatVersion: 's3-context-v1', callKind: 'work', duty: 'executor',
    sectionOrder, residentBudgetBytes: 4096, residentBytes: 0, totalBytes: B(rendered.text),
    sections: rendered.sections, sources: [], inputSelections: [], extensions: NO_EXTENSIONS,
    ...over,
  };
}

function problem(binding: ContextAssemblyBindingV1, text: string): CoreRejection | null {
  return contextAssemblyProblem({ binding, text, selectedTaskInputs: [], continuationSuffix: null });
}

const INVALID = { status: 'rejected', code: 'invalid' } satisfies Partial<CoreRejection>;

describe('PC2 G binding sectionOrder', () => {
  it('accepts a legal order that is not the platform fixed order', () => {
    const parts: Part[] = [ROLE, NOTES, GOAL, TASK, FOOTPRINT];
    const order: ContextSectionNameV1[] = ['role', 'notes', 'goal', 'task', 'footprint'];
    expect(problem(workBinding(parts, order), layout(parts).text)).toBeNull();
  });

  it('rejects a sectionOrder that does not start with role', () => {
    // The rendered role/task sections are still a subsequence of this order and
    // this call kind requires no goal section, so only "role is first" rejects it.
    const parts: Part[] = [ROLE, TASK];
    expect(problem(workBinding(parts, ['goal', 'role', 'task'], { callKind: 'copy' }), layout(parts).text))
      .toMatchObject(INVALID);
  });

  it('rejects a sectionOrder with a name illegal for the call kind', () => {
    const parts: Part[] = [ROLE, TASK];
    expect(problem(workBinding(parts, ['role', 'goal', 'task'], { callKind: 'review' }), layout(parts).text))
      .toMatchObject(INVALID);
  });

  it('rejects a sectionOrder that names a section twice', () => {
    expect(problem(workBinding(FIXED, ['role', 'goal', 'task', 'footprint', 'notes', 'notes']), BASE.text))
      .toMatchObject(INVALID);
  });

  it('rejects a work binding whose sections omit goal or task', () => {
    const noGoal = layout([ROLE, TASK, FOOTPRINT, NOTES]);
    expect(problem(workBinding([ROLE, TASK, FOOTPRINT, NOTES], ['role', 'task', 'footprint', 'notes']), noGoal.text))
      .toMatchObject(INVALID);
    const noTask = layout([ROLE, GOAL, FOOTPRINT, NOTES]);
    expect(problem(workBinding([ROLE, GOAL, FOOTPRINT, NOTES], ['role', 'goal', 'footprint', 'notes']), noTask.text))
      .toMatchObject(INVALID);
  });

  it('rejects rendered sections that are not in sectionOrder order', () => {
    const parts: Part[] = [ROLE, TASK, GOAL, FOOTPRINT];
    expect(problem(workBinding(parts, ['role', 'goal', 'task', 'footprint']), layout(parts).text)).toMatchObject(INVALID);
  });

  it('rejects a rendered section the sectionOrder does not name', () => {
    const parts: Part[] = [ROLE, GOAL, TASK, FOOTPRINT];
    expect(problem(workBinding(parts, ['role', 'goal', 'task']), layout(parts).text)).toMatchObject(INVALID);
  });

  it('rejects a legal binding order that differs from the frozen prompt set order', () => {
    // The two swapped sections are absent from the rendered input, so only the
    // element-for-element comparison with the frozen set rejects this binding.
    const parts: Part[] = [ROLE, GOAL, TASK];
    const binding = workBinding(parts, ['role', 'goal', 'task', 'notes', 'footprint']);
    expect(frozenSectionOrderProblem({
      binding,
      expectedSectionOrder: ['role', 'goal', 'task', 'footprint', 'notes'],
    })).toMatchObject(INVALID);
  });

  it('rejects a frozen prompt set that names no order for the call kind', () => {
    expect(frozenSectionOrderProblem({
      binding: workBinding(FIXED, ['role', 'goal', 'task', 'footprint', 'notes']),
      expectedSectionOrder: undefined,
    })).toMatchObject(INVALID);
  });
});
