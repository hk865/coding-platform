/**
 * K3L-2 R6 (§3, §2.2/§2.6; decisions 121-109/121-110): the adviser round's read-back and submit form, pure (A5).
 * ① `unknownCallAdviceSubjectOfText` reads the platform `subject:` line and takes it only when its request id is the
 * first line; ② `buildAnswerText` writes the one answer text (frozen subject first, `escalationKind` filled null);
 * ③ `answerProblems` runs the one strict parse on it. TODAY every row is red (no export, no adviser arm in either
 * function) and green when K3L-2 §2.1/§2.6 lands.
 *
 * Named mutations (each row red on the named change): ① the head comparison removed -> the revision-4 cell;
 * ② the phase from the form or no `null` fill -> the exact text; ③ the adviser arm removed -> the valid escalation.
 */
import { describe, expect, it } from 'vitest';
import { answerProblems, buildAnswerText } from '../../src/core/agent-runtime/answer-tools.js';
import { unknownCallAdviceSubjectOfText } from '../../src/contracts/plan-round.js';
import type { UnknownCallAdviceSubjectV1 } from '../../src/contracts/unknown-call-advice.js';

const subject: UnknownCallAdviceSubjectV1 = {
  reviewRef: { aggregateType: 'UnknownCallReview', projectId: 'proj-1', goalId: 'goal-1', runId: 'run-1' },
  revision: 3, phase: 'disposition', goalBasisDigest: 'ab12' };
const requestId = 'ucr:run-1:3:disposition:ab12';
const subjectLine = 'subject: {"goalBasisDigest":"ab12","phase":"disposition",'
  + '"reviewRef":{"aggregateType":"UnknownCallReview","goalId":"goal-1","projectId":"proj-1","runId":"run-1"},'
  + '"revision":3}';
describe('R6① unknownCallAdviceSubjectOfText: the second line is the round’s subject', () => {
  it.each([
    ['the platform text', `${requestId}\n${subjectLine}`, subject],
    ['no second line', requestId, null],
    ['a second line that is not JSON', `${requestId}\nsubject: nope`, null],
    // ① named mutation: without the head comparison this cell returns the revision-4 subject, red.
    ['a second line of another revision', `${requestId}\n${subjectLine.replace('"revision":3', '"revision":4')}`, null],
  ])('%s', (_case, input, expected) => {
    expect(unknownCallAdviceSubjectOfText(input)).toEqual(expected);
  });
});
describe('R6② buildAnswerText: the one adviser answer text', () => {
  // ② named mutation: the phase from the form, or no `null` fill -> this exact text red.
  it('writes the frozen subject first and the form last', () => {
    expect(buildAnswerText('unknown_call_advice', { choice: 'rerun_as_is', rationale: 'r', plain: 'p' },
      { projectId: 'proj-1', subject })).toBe(
      '{"schemaVersion":1,"kind":"unknown_call_advice",'
      + '"reviewRef":{"aggregateType":"UnknownCallReview","projectId":"proj-1","goalId":"goal-1","runId":"run-1"},'
      + '"revision":3,"phase":"disposition","goalBasisDigest":"ab12",'
      + '"choice":"rerun_as_is","escalationKind":null,"rationale":"r","plain":"p"}',
    );
  });
});
describe('R6③ answerProblems: the one strict parse of the answer text', () => {
  it.each([
    ['a disposition phase with an approval choice', { choice: 'approve', rationale: 'r', plain: 'p' }, ['answer']],
    ['an escalation without its kind', { choice: 'escalate', rationale: 'r', plain: 'p' }, ['answer']],
    ['a non-escalation with an escalation kind',
      { choice: 'rerun_as_is', escalationKind: 'architecture', rationale: 'r', plain: 'p' }, ['answer']],
    // ③ named mutation: the adviser arm removed -> this valid escalation reads `['answer']`, red.
    ['an escalation with its kind',
      { choice: 'escalate', escalationKind: 'architecture', rationale: 'r', plain: 'p' }, []],
  ] as const)('%s', (_case, form, sections) => {
    const built = buildAnswerText('unknown_call_advice', form, { projectId: 'proj-1', subject });
    expect(answerProblems('unknown_call_advice', form, built, null).map(problem => problem.section)).toEqual(sections);
  });
});
