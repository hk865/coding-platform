/** The pure binding question-card key codec: `decisionSourceKey` carries the binding for a binding identity, one answer's two bindings are two keys, and a plain or `prepared_goal` identity keeps its key byte for byte. */
import { describe, expect, it } from 'vitest';
import { decisionSourceKey, type PlanningQuestionIdentityV1 } from '../../src/contracts/goal-decisions.js';
import type { InitializationBindingRef } from '../../src/contracts/initialization-binding.js';
import type { QueryJobAnswerRef } from '../../src/contracts/query-job.js';

const ANSWER_REF: QueryJobAnswerRef = {
  aggregateType: 'QueryJobAnswer', projectId: 'P', workspaceId: 'W',
  queryJobId: 'Q-BINDING-CARDS', answerId: 'A-BINDING-CARDS',
};
const BINDING_0: InitializationBindingRef = {
  aggregateType: 'InitializationBinding', projectId: 'P', answerRef: ANSWER_REF, draftIndex: 0,
};
const BINDING_2: InitializationBindingRef = { ...BINDING_0, draftIndex: 2 };

// Hand-computed canonical JSON (JCS: object keys in UTF-16 code-unit order; the answer ref's keys are aggregateType, answerId, projectId, queryJobId, workspaceId).
const ANSWER_JSON = '{"aggregateType":"QueryJobAnswer","answerId":"A-BINDING-CARDS","projectId":"P",'
  + '"queryJobId":"Q-BINDING-CARDS","workspaceId":"W"}';
const BINDING_0_JSON = '{"aggregateType":"InitializationBinding","answerRef":' + ANSWER_JSON
  + ',"draftIndex":0,"projectId":"P"}';
const BINDING_2_JSON = '{"aggregateType":"InitializationBinding","answerRef":' + ANSWER_JSON
  + ',"draftIndex":2,"projectId":"P"}';
/** The plain and `prepared_goal` key: answerRef + question index, no binding key at all. */
const PLAIN_KEY = '{"answerRef":' + ANSWER_JSON + ',"kind":"planning_question","questionIndex":2}';
const BINDING_0_KEY = '{"answerRef":' + ANSWER_JSON + ',"binding":' + BINDING_0_JSON
  + ',"kind":"planning_question","questionIndex":2}';
const BINDING_2_KEY = '{"answerRef":' + ANSWER_JSON + ',"binding":' + BINDING_2_JSON
  + ',"kind":"planning_question","questionIndex":2}';
const PLAIN_IDENTITY: PlanningQuestionIdentityV1 = {
  kind: 'planning_question', answerRef: ANSWER_REF, questionIndex: 2,
};

/** One table row: the identities the row keys, their hand-computed keys, and whether they must stay apart. */
type KeyCase = {
  name: string;
  identities: readonly PlanningQuestionIdentityV1[];
  expected: readonly string[];
  /** Two bindings of ONE answer cannot share a key; the row asserts it directly as well as through the literals. */
  distinct?: boolean;
};

const KEY_CASES: readonly KeyCase[] = [
  { name: 'a plain identity', identities: [PLAIN_IDENTITY], expected: [PLAIN_KEY] },
  { name: 'a prepared_goal identity that carries no binding key',
    identities: [{ ...PLAIN_IDENTITY }], expected: [PLAIN_KEY] },
  { name: 'a binding identity at draftIndex 0',
    identities: [{ ...PLAIN_IDENTITY, binding: BINDING_0 }], expected: [BINDING_0_KEY] },
  { name: 'a binding identity at draftIndex 2',
    identities: [{ ...PLAIN_IDENTITY, binding: BINDING_2 }], expected: [BINDING_2_KEY] },
  { name: 'two bindings of the same answer', distinct: true,
    identities: [{ ...PLAIN_IDENTITY, binding: BINDING_0 }, { ...PLAIN_IDENTITY, binding: BINDING_2 }],
    expected: [BINDING_0_KEY, BINDING_2_KEY] },
];

describe('S6B3 binding question-card key (book §3.10 item 6)', () => {
  it.each(KEY_CASES)('$name has the hand-computed canonical key', ({ identities, expected, distinct }) => {
    const keys = identities.map(identity => decisionSourceKey(identity));
    expect(keys).toEqual(expected);
    if (distinct === true) expect(new Set(keys).size).toBe(keys.length);
  });
});
