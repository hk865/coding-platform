/**
 * K3 R1/D1 (L10, L13): the `unknown_call_review` context section.
 *
 * A review-purpose Run is a Work Run: `callKind` stays `'work'`, the review
 * instruction is its own last section, present exactly when the caller supplies
 * the rendered `reviewSuffix`. Query and ordinary Work bindings are unchanged
 * (the new input field defaults to null).
 */
import { describe, expect, it } from 'vitest';
import type {
  ContextAssemblyBindingV1, ContextSectionNameV1,
} from '../../src/contracts/graph-context.js';
import { contextAssemblyProblem } from '../../src/core/work-graph/state/context-input.js';

const B = (text: string): number => Buffer.byteLength(text, 'utf8');

const NO_EXTENSIONS: ContextAssemblyBindingV1['extensions'] = {
  notes: 'not_implemented', anomalies: 'not_implemented', footprint: 'not_implemented',
  goalSettings: 'not_implemented', decisions: 'not_implemented',
};

type Part = { name: ContextSectionNameV1; text: string };

/** Byte-exact layout: two LF between segments, no trailing LF. */
function layout(parts: Part[]): { text: string; sections: ContextAssemblyBindingV1['sections'] } {
  let text = '';
  const sections: ContextAssemblyBindingV1['sections'] = [];
  for (let index = 0; index < parts.length; index += 1) {
    if (index > 0) text += '\n\n';
    const startByte = B(text);
    text += parts[index]!.text;
    sections.push({ name: parts[index]!.name, startByte, endByte: B(text), omitted: 0 });
  }
  return { text, sections };
}

// The role/goal/task sections deliberately carry Chinese so a JS string index
// and a UTF-8 byte offset diverge.
const BASE: Part[] = [
  { name: 'role', text: '## Runtime context\n角色' },
  { name: 'goal', text: '## Goal\n目标' },
  { name: 'task', text: '## Accepted task\n任务' },
  { name: 'footprint', text: '## Footprint\n脚印' },
  { name: 'notes', text: '## Note index\n注记' },
  { name: 'reminders', text: '## Reminders\n提醒' },
  { name: 'inputs', text: '## Selected inputs\n输入' },
];

const REVIEW_SUFFIX = '## Unknown-call review\n这一轮只核对，不做任务，不改工作区。\n- #1 run_readonly_command';
const REVIEW_PART: Part = { name: 'unknown_call_review', text: REVIEW_SUFFIX };

function workBinding(over: Partial<ContextAssemblyBindingV1> = {}): ContextAssemblyBindingV1 {
  const base = layout(BASE);
  return {
    schemaVersion: 1, formatVersion: 's3-context-v1', callKind: 'work', duty: 'executor',
    residentBudgetBytes: 4096, residentBytes: 0, totalBytes: B(base.text),
    sections: base.sections, sources: [], inputSelections: [], extensions: NO_EXTENSIONS,
    ...over,
  };
}

describe('K3-R1 unknown_call_review section', () => {
  it('K3-R1-1 accepts a work binding whose last section is the rendered review instruction', () => {
    const withReview = layout([...BASE, REVIEW_PART]);
    const binding = workBinding({
      sections: withReview.sections, totalBytes: B(withReview.text),
    });
    expect(contextAssemblyProblem({
      binding, text: withReview.text, selectedTaskInputs: [], continuationSuffix: null,
      reviewSuffix: REVIEW_SUFFIX,
    })).toBeNull();
  });

  it('K3-R1-2 rejects a reviewSuffix with no review section', () => {
    const base = layout(BASE);
    const binding = workBinding({ sections: base.sections, totalBytes: B(base.text) });
    expect(contextAssemblyProblem({
      binding, text: base.text, selectedTaskInputs: [], continuationSuffix: null,
      reviewSuffix: REVIEW_SUFFIX,
    })).toMatchObject({ status: 'rejected', code: 'invalid' });
  });

  it('K3-R1-3 rejects a review section with no reviewSuffix', () => {
    const withReview = layout([...BASE, REVIEW_PART]);
    const binding = workBinding({ sections: withReview.sections, totalBytes: B(withReview.text) });
    expect(contextAssemblyProblem({
      binding, text: withReview.text, selectedTaskInputs: [], continuationSuffix: null,
    })).toMatchObject({ status: 'rejected', code: 'invalid' });
  });

  it('K3-R1-4 rejects a review section whose interval is not the rendered suffix', () => {
    const withReview = layout([...BASE, REVIEW_PART]);
    // One byte short of the true end: the section interval no longer equals the suffix.
    const sections = withReview.sections.map((section, index) => index === withReview.sections.length - 1
      ? { ...section, endByte: section.endByte! - 1 } : section);
    const binding = workBinding({ sections, totalBytes: B(withReview.text) });
    expect(contextAssemblyProblem({
      binding, text: withReview.text, selectedTaskInputs: [], continuationSuffix: null,
      reviewSuffix: REVIEW_SUFFIX,
    })).toMatchObject({ status: 'rejected', code: 'invalid' });
  });

  it('K3-R1-5 rejects the review section on a continuation call', () => {
    const withReview = layout([...BASE, REVIEW_PART]);
    const binding = workBinding({
      callKind: 'continuation', sections: withReview.sections, totalBytes: B(withReview.text),
    });
    expect(contextAssemblyProblem({
      binding, text: withReview.text, selectedTaskInputs: [], continuationSuffix: REVIEW_SUFFIX,
      reviewSuffix: REVIEW_SUFFIX,
    })).toMatchObject({ status: 'rejected', code: 'invalid' });
  });

  it('K3-R1-6 leaves an ordinary work binding without a reviewSuffix valid', () => {
    const base = layout(BASE);
    const binding = workBinding({ sections: base.sections, totalBytes: B(base.text) });
    expect(contextAssemblyProblem({
      binding, text: base.text, selectedTaskInputs: [], continuationSuffix: null,
    })).toBeNull();
  });

  it('K3-R1-7 leaves the continuation brief check unchanged', () => {
    const brief = 'C3 continuation brief';
    const withBrief = layout([...BASE, { name: 'continuation', text: brief }]);
    const binding = workBinding({
      callKind: 'continuation', sections: withBrief.sections, totalBytes: B(withBrief.text),
    });
    expect(contextAssemblyProblem({
      binding, text: withBrief.text, selectedTaskInputs: [], continuationSuffix: brief,
    })).toBeNull();
  });
});
