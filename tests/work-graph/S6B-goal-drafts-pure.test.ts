/**
 * The goal card draft's `screening` and a no-goal plan answer's top-level
 * `planDraftIndex`, through the one answer parser and the answer record codec.
 *
 * Screening exists only inside a goal card draft (`null` = not screened,
 * `size: 'unknown'` = screened with an unknown size); a plan answer reads
 * `planDraftIndex` from the text as it reads `goalCardDrafts`, and a plan
 * belongs to no draft when the field is absent.
 *
 * A5: a pure file. It imports no store, platform, Host, Workflow, Runtime or
 * stub port; every expected value is a literal or counted by hand.
 */
import { describe, expect, it } from 'vitest';
import type { GoalScreeningV1, QueryJobAnswerSnapshot } from '../../src/contracts/query-job.js';
import { parseSecretaryAnswer } from '../../src/core/work-graph/queries/secretary-answer.js';
import {
  decodeQueryJobAnswerSnapshot,
  encodeQueryJobAnswerSnapshot,
} from '../../src/core/work-graph/queries/query-record-codecs.js';

const SEMANTIC_GOAL = { kind: 'semantic_query', hasGoal: true } as const;
const SEMANTIC_NO_GOAL = { kind: 'semantic_query', hasGoal: false } as const;
const COORDINATION_GOAL = { kind: 'initial_coordination', hasGoal: true } as const;
const COORDINATION_NO_GOAL = { kind: 'initial_coordination', hasGoal: false } as const;

const BODY = '可以先拆出读取层。';
const OBJECTIVE = 'Split the reader from the writer.';
const COMPLETION = ['the reader has its own module'];

/** One semantic answer object; a row changes exactly one field. */
function answerText(fields: Record<string, unknown> = {}): string {
  return JSON.stringify({ schemaVersion: 1, body: BODY, ideas: [], goalCardDrafts: [], ...fields });
}

/** One semantic draft whose only varying part is the screening under test. */
function semanticDraft(screening: unknown): string {
  return answerText({ goalCardDrafts: [{ objective: OBJECTIVE, completion: COMPLETION, autonomy: 'after_plan_confirmation', screening }] });
}

/** A refusal is always `protocol` with a non-empty platform reason. */
function expectProtocol(result: ReturnType<typeof parseSecretaryAnswer>): void {
  expect(result.ok).toBe(false);
  if (result.ok) return;
  expect(result.detail).toBe('protocol');
  expect(typeof result.reason).toBe('string');
  expect(result.reason.length).toBeGreaterThan(0);
}

// 256 'é' are 512 UTF-8 bytes; appending 'a' makes 513.
// They contain 256 and 257 code points and UTF-16 code units.
const NOTE_512 = 'é'.repeat(256);
const NOTE_513 = 'é'.repeat(256) + 'a';

const SCREENED: GoalScreeningV1 = {
  modules: [{ projectId: 'p1', moduleId: 'm-reader' }, { projectId: 'p1', moduleId: 'm-writer' }],
  size: 'medium',
  conflictsWith: [{ aggregateType: 'Goal', projectId: 'p1', goalId: 'goal-7' }],
  dependsOn: [{ aggregateType: 'Goal', projectId: 'p1', goalId: 'goal-3' }],
  urgency: 'normal',
  suggestedPosition: 0,
  note: '同一个读取层：和 goal-7 冲突，先做 goal-3。',
};

describe('screening: the model’s screening inside a no-goal goal card draft', () => {
  const accepted = [
    { name: 'an absent screening is not screened', input: undefined, expected: null },
    { name: 'an explicit null is not screened', input: null, expected: null },
    { name: 'a full screening object is kept', input: SCREENED, expected: SCREENED },
    { name: 'size unknown is a screening with an unknown size', input: { ...SCREENED, size: 'unknown' }, expected: { ...SCREENED, size: 'unknown' } },
    { name: 'suggestedPosition null is accepted', input: { ...SCREENED, suggestedPosition: null }, expected: { ...SCREENED, suggestedPosition: null } },
    { name: 'empty ref lists and an empty note are accepted', input: { ...SCREENED, modules: [], conflictsWith: [], dependsOn: [], note: '' }, expected: { ...SCREENED, modules: [], conflictsWith: [], dependsOn: [], note: '' } },
    { name: 'a note of exactly 512 UTF-8 bytes is accepted', input: { ...SCREENED, note: NOTE_512 }, expected: { ...SCREENED, note: NOTE_512 } },
    { name: 'a full screening object, every field as the model returned it', input: SCREENED, expected: {
      modules: [{ projectId: 'p1', moduleId: 'm-reader' }, { projectId: 'p1', moduleId: 'm-writer' }],
      size: 'medium', urgency: 'normal', suggestedPosition: 0,
      conflictsWith: [{ aggregateType: 'Goal', projectId: 'p1', goalId: 'goal-7' }],
      dependsOn: [{ aggregateType: 'Goal', projectId: 'p1', goalId: 'goal-3' }],
      note: '同一个读取层：和 goal-7 冲突，先做 goal-3。',
    } },
  ];

  it.each(accepted)('accepts $name', ({ input, expected }) => {
    expect(parseSecretaryAnswer(semanticDraft(input), SEMANTIC_NO_GOAL)).toEqual({
      ok: true, body: BODY, ideas: [], planDraftIndex: null,
      goalCardDrafts: [
        { objective: OBJECTIVE, completion: ['the reader has its own module'], autonomy: 'after_plan_confirmation', screening: expected },
      ],
    });
  });

  const { note: _note, ...SCREENED_WITHOUT_NOTE } = SCREENED;
  const refused = [
    { name: 'a size outside the enum', screening: { ...SCREENED, size: 'tiny' } },
    { name: 'an urgency outside the enum', screening: { ...SCREENED, urgency: 'urgent' } },
    { name: 'a ModuleRef without its moduleId', screening: { ...SCREENED, modules: [{ projectId: 'p1' }] } },
    { name: 'a ModuleRef without its projectId', screening: { ...SCREENED, modules: [{ moduleId: 'm-reader' }] } },
    { name: 'a GoalRef tagged with another aggregate', screening: { ...SCREENED, conflictsWith: [{ aggregateType: 'Task', projectId: 'p1', goalId: 'goal-7' }] } },
    { name: 'a dependsOn entry that is not a GoalRef', screening: { ...SCREENED, dependsOn: ['goal-3'] } },
    { name: 'a note of 513 UTF-8 bytes', screening: { ...SCREENED, note: NOTE_513 } },
    { name: 'a note that is not a string', screening: { ...SCREENED, note: 7 } },
    { name: 'a negative suggestedPosition', screening: { ...SCREENED, suggestedPosition: -1 } },
    { name: 'a non-integer suggestedPosition', screening: { ...SCREENED, suggestedPosition: 1.5 } },
    { name: 'a suggestedPosition that is a string', screening: { ...SCREENED, suggestedPosition: '0' } },
    { name: 'a screening that is not an object', screening: 'small' },
    { name: 'a screening with a field the shape does not have', screening: { ...SCREENED, owner: 'the model' } },
    { name: 'a screening missing its note', screening: SCREENED_WITHOUT_NOTE },
    { name: 'a screening missing its urgency', screening: { ...SCREENED, urgency: undefined } },
  ];

  it.each(refused)('refuses $name', ({ screening }) => {
    expectProtocol(parseSecretaryAnswer(semanticDraft(screening), SEMANTIC_NO_GOAL));
  });

  it('a request with a goal still carries no draft at all', () => {
    expectProtocol(parseSecretaryAnswer(semanticDraft(SCREENED), SEMANTIC_GOAL));
  });
});

describe('planDraftIndex: the draft a no-goal plan answer belongs to', () => {
  const PLAN = {
    schemaVersion: 2, kind: 'plan', summary: 'Two steps',
    plan: { schemaVersion: 2, stages: [], tasks: [], obligations: [], taskHierarchy: { parentOf: [] },
      executionDag: { dependsOn: [] } },
  };
  const QUESTIONS = { schemaVersion: 2, kind: 'needs_decision', summary: 'One question', questions: ['Which database?'] };
  const DRAFT_ONE = { objective: 'Split the reader from the writer.', completion: ['the reader has its own module'], autonomy: 'after_plan_confirmation' };
  const DRAFT_TWO = { objective: 'Write the migration guide.', completion: ['the guide lists every caller'], autonomy: 'every_step' };
  const DRAFTS_OUT = [
    { objective: 'Split the reader from the writer.', completion: ['the reader has its own module'], autonomy: 'after_plan_confirmation', screening: null },
    { objective: 'Write the migration guide.', completion: ['the guide lists every caller'], autonomy: 'every_step', screening: null },
  ];

  const accepted = [
    { name: 'absent: the plan belongs to no draft', fields: {}, expected: null },
    { name: '0: the plan belongs to the first draft', fields: { planDraftIndex: 0 }, expected: 0 },
    { name: '1: the plan belongs to the last draft', fields: { planDraftIndex: 1 }, expected: 1 },
  ];

  it.each(accepted)('accepts the index $name', ({ fields, expected }) => {
    const text = JSON.stringify({ ...PLAN, goalCardDrafts: [DRAFT_ONE, DRAFT_TWO], ...fields });
    expect(parseSecretaryAnswer(text, COORDINATION_NO_GOAL)).toEqual({
      ok: true, body: text, ideas: [], planDraftIndex: expected, goalCardDrafts: DRAFTS_OUT,
    });
  });

  const withDrafts = (fields: Record<string, unknown>, base: Record<string, unknown> = PLAN) =>
    JSON.stringify({ ...base, goalCardDrafts: [DRAFT_ONE, DRAFT_TWO], ...fields });

  // A row whose input another check also refuses names its own reason, so it fails without its own check.
  const ANY_REASON = expect.stringMatching(/./);
  const refused = [
    { name: 'a negative index', text: withDrafts({ planDraftIndex: -1 }), input: COORDINATION_NO_GOAL, reason: ANY_REASON },
    { name: 'a non-integer index', text: withDrafts({ planDraftIndex: 0.5 }), input: COORDINATION_NO_GOAL, reason: ANY_REASON },
    { name: 'an index past the last draft', text: withDrafts({ planDraftIndex: 2 }), input: COORDINATION_NO_GOAL, reason: ANY_REASON },
    { name: 'an index that is a string', text: withDrafts({ planDraftIndex: '0' }), input: COORDINATION_NO_GOAL, reason: ANY_REASON },
    { name: 'an index with no draft at all', text: JSON.stringify({ ...PLAN, planDraftIndex: 0 }), input: COORDINATION_NO_GOAL,
      reason: 'a planDraftIndex needs a goal card draft to name' },
    { name: 'an index on a needs_decision answer', text: withDrafts({ planDraftIndex: 0 }, QUESTIONS), input: COORDINATION_NO_GOAL, reason: ANY_REASON },
    { name: 'an index on a request with a goal', text: JSON.stringify({ ...PLAN, planDraftIndex: 0 }), input: COORDINATION_GOAL,
      reason: 'an initial_coordination answer on a request that has a goal carries no planDraftIndex' },
    { name: 'a top-level planDraftIndex on a semantic answer', text: answerText({ planDraftIndex: 0 }), input: SEMANTIC_NO_GOAL, reason: ANY_REASON },
  ];

  it.each(refused)('refuses $name', ({ text, input, reason }) => {
    expect(parseSecretaryAnswer(text, input)).toEqual({ ok: false, detail: 'protocol', reason });
  });
});

describe('the answer record codec: screening and planDraftIndex', () => {
  const AT = '2026-10-25T00:00:00.000Z';
  const DRAFT_A = { objective: 'Split the reader from the writer.', completion: ['the reader has its own module'], autonomy: 'after_plan_confirmation' as const,
    screening: { modules: [{ projectId: 'p1', moduleId: 'm-reader' }], size: 'medium' as const,
      conflictsWith: [{ aggregateType: 'Goal' as const, projectId: 'p1', goalId: 'goal-7' }],
      dependsOn: [] as { aggregateType: 'Goal'; projectId: string; goalId: string }[],
      urgency: 'high' as const, suggestedPosition: null, note: '和 goal-7 冲突' } };
  const DRAFT_B = { objective: 'Write the migration guide.', completion: ['the guide lists every caller'], autonomy: 'every_step' as const, screening: null };

  function snapshot(): QueryJobAnswerSnapshot {
    return {
      ref: { aggregateType: 'QueryJobAnswer', projectId: 'p1', workspaceId: 'w1', queryJobId: 'qj-1', answerId: 'a-1' },
      revision: 1,
      schemaVersion: 1,
      answer: {
        schemaVersion: 1, answerId: 'a-1',
        queryJobRef: { aggregateType: 'QueryJob', projectId: 'p1', workspaceId: 'w1', queryJobId: 'qj-1' },
        runRef: { aggregateType: 'QueryRun', projectId: 'p1', workspaceId: 'w1', queryJobId: 'qj-1', runId: 'run-1' },
        roundIndex: 0, answer: 'the plan', sources: [], followsAnswerRef: null, stale: false, staleReason: null,
        answeredAt: AT,
        bodyRef: { kind: 'artifact', contentType: 'text/plain; charset=utf-8', digest: 'd'.repeat(64), sizeBytes: 8,
          source: { kind: 'workspace', refId: 'w1', revision: '1' } },
        ideas: [],
        goalCardDrafts: [DRAFT_A, DRAFT_B],
        planDraftIndex: 1,
      },
    };
  }

  /** The encoded snapshots, with one field of the answer changed. */
  function encodedWith(mutate: (answer: Record<string, unknown>) => void) {
    const encoded = encodeQueryJobAnswerSnapshot(snapshot());
    const body = JSON.parse(encoded.json) as { answer: Record<string, unknown> };
    mutate(body.answer);
    return { ...encoded, json: JSON.stringify(body) };
  }

  function draftAt(answer: Record<string, unknown>, index: number): Record<string, unknown> {
    return (answer['goalCardDrafts'] as Record<string, unknown>[])[index] as Record<string, unknown>;
  }

  it('round-trips an answer that carries a screening and a valid plan draft index', () => {
    const value = snapshot();
    expect(decodeQueryJobAnswerSnapshot(encodeQueryJobAnswerSnapshot(value))).toEqual({ status: 'decoded', value });
  });

  const refused: { name: string; mutate: (answer: Record<string, unknown>) => void; needle: string }[] = [
    { name: 'a missing planDraftIndex', needle: 'planDraftIndex',
      mutate: (answer) => { delete answer['planDraftIndex']; } },
    { name: 'an out-of-range planDraftIndex', needle: 'planDraftIndex',
      mutate: (answer) => { answer['planDraftIndex'] = 2; } },
    { name: 'a planDraftIndex that is not an integer', needle: 'planDraftIndex',
      mutate: (answer) => { answer['planDraftIndex'] = 0.5; } },
    { name: 'a negative planDraftIndex', needle: 'planDraftIndex',
      mutate: (answer) => { answer['planDraftIndex'] = -1; } },
    { name: 'a screening note over 512 UTF-8 bytes', needle: 'screening',
      mutate: (answer) => {
        const screening = draftAt(answer, 0)['screening'] as Record<string, unknown>;
        screening['note'] = NOTE_513;
      } },
    { name: 'a screening with an illegal size', needle: 'screening',
      mutate: (answer) => {
        const screening = draftAt(answer, 0)['screening'] as Record<string, unknown>;
        screening['size'] = 'tiny';
      } },
    { name: 'a missing screening on a draft', needle: 'screening',
      mutate: (answer) => { delete draftAt(answer, 0)['screening']; } },
  ];

  it.each(refused)('refuses $name', ({ mutate, needle }) => {
    const result = decodeQueryJobAnswerSnapshot(encodedWith(mutate));
    expect(result.status).toBe('invalid');
    if (result.status !== 'invalid') return;
    expect(result.reason).toContain(needle);
    expect(result.reason.length).toBeGreaterThan(0);
  });
});
