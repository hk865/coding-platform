/**
 * The initialization binding record: its tagged ref and immutable `@1` body, the two cross-field rules (the ref names
 * the same answer, draft and project; answer, request and goal are one project and answer/request one workspace), the
 * answer-and-draft and by-Goal lookups, registration, and the codec round trip whose key is the canonical JSON of the
 * full ref. Pure: values are built here, no binding is stored, no expected value comes from production; every literal
 * below is written by hand from the frozen contract.
 */
import { describe, expect, it } from 'vitest';
import {
  INITIALIZATION_BINDING_BY_ANSWER_DRAFT_LOOKUP, INITIALIZATION_BINDING_BY_GOAL_LOOKUP,
  InitializationBindingFormat, InitializationBindingRefShape,
  type InitializationBindingRef, type InitializationBindingV1,
} from '../../src/contracts/initialization-binding.js';
import { checkShape } from '../../src/contracts/validation/data-format.js';
import {
  INITIALIZATION_BINDING_SCHEMAS, initializationBindingCodec,
} from '../../src/core/work-graph/persistence/initialization-binding-codecs.js';

const P = 'p-binding';
const W = 'w-binding';
const ANSWER_REF = {
  aggregateType: 'QueryJobAnswer' as const, projectId: P, workspaceId: W, queryJobId: 'q-1', answerId: 'a-1',
};
const REQUEST_REF = { aggregateType: 'QueryJob' as const, projectId: P, workspaceId: W, queryJobId: 'q-1' };
const GOAL_REF = { aggregateType: 'Goal' as const, projectId: P, goalId: 'g-1' };
const SCREENING = {
  modules: [{ projectId: P, moduleId: 'm-1' }], size: 'small' as const, conflictsWith: [], dependsOn: [],
  urgency: 'normal' as const, suggestedPosition: 0, note: 'first',
};
const REF: InitializationBindingRef = { aggregateType: 'InitializationBinding', projectId: P, answerRef: ANSWER_REF, draftIndex: 1 };
/** InitializationBinding@1 as written out by hand: ref, fixed revision, answer/request/goal refs and the screening. */
const validBinding = (): InitializationBindingV1 => ({
  ref: REF, revision: 1, answerRef: ANSWER_REF, answerDigest: 'a'.repeat(64), requestRef: REQUEST_REF,
  draftIndex: 1, goalRef: GOAL_REF, goalRevision: 1, screening: SCREENING,
});
const withBody = (patch: Partial<InitializationBindingV1>): InitializationBindingV1 => ({ ...validBinding(), ...patch });
const withRef = (patch: Partial<InitializationBindingRef>): InitializationBindingV1 =>
  withBody({ ref: { ...REF, ...patch } });
const problemOf = (value: unknown) => checkShape(InitializationBindingFormat, value, 'stored');

describe('the initialization binding record', () => {
  it.each([
    { name: 'a complete value', value: validBinding() },
    { name: 'a null screening (the goal was not screened)', value: withBody({ screening: null }) },
  ])('accepts $name in the stored check and the codec check', ({ value }) => {
    expect(problemOf(value)).toBeNull();
    expect(initializationBindingCodec.check(value)).toBeNull();
  });

  it('carries its own tag, schemaId and aggregateType', () => {
    expect(InitializationBindingFormat.schemaId).toBe('InitializationBinding@1');
    expect(InitializationBindingFormat.aggregateType).toBe('InitializationBinding');
    expect(InitializationBindingRefShape.fields.aggregateType).toEqual({ kind: 'literal', value: 'InitializationBinding' });
    expect(problemOf(withRef({ aggregateType: 'Goal' as unknown as 'InitializationBinding' })))
      .toBe('InitializationBinding.ref.aggregateType is not recognized');
  });

  it('registers one record with its schemaId and aggregateType, no event, and both lookups', () => {
    expect(INITIALIZATION_BINDING_SCHEMAS.records).toHaveLength(1);
    expect(INITIALIZATION_BINDING_SCHEMAS.records[0]!.schemaId).toBe('InitializationBinding@1');
    expect(INITIALIZATION_BINDING_SCHEMAS.records[0]!.aggregateType).toBe('InitializationBinding');
    expect(INITIALIZATION_BINDING_SCHEMAS.events).toHaveLength(0);
    expect(INITIALIZATION_BINDING_SCHEMAS.lookups).toHaveLength(2);
  });

  it('has the answer-and-draft lookup over five scalar paths and the by-Goal lookup over two', () => {
    expect(initializationBindingCodec.lookups).toStrictEqual([
      {
        name: 'initialization-binding-by-answer-draft', aggregateType: 'InitializationBinding',
        paths: ['answerRef.projectId', 'answerRef.workspaceId', 'answerRef.queryJobId', 'answerRef.answerId', 'draftIndex'],
      },
      {
        name: 'initialization-binding-by-goal', aggregateType: 'InitializationBinding',
        paths: ['goalRef.projectId', 'goalRef.goalId'],
      },
    ]);
    expect(INITIALIZATION_BINDING_BY_ANSWER_DRAFT_LOOKUP).toBe('initialization-binding-by-answer-draft');
    expect(INITIALIZATION_BINDING_BY_GOAL_LOOKUP).toBe('initialization-binding-by-goal');
  });
});

describe('rejects: the ref names the same answer, draft and project', () => {
  it.each([
    { name: 'a ref answer that is not the binding answer', value: withRef({ answerRef: { ...ANSWER_REF, answerId: 'a-2' } }), reason: 'InitializationBinding.ref.answerRef is not the binding answerRef' },
    { name: 'a ref draft index that is not the binding draft index', value: withRef({ draftIndex: 2 }), reason: 'InitializationBinding.ref.draftIndex is not the binding draftIndex' },
    { name: 'a ref project that is not the answer project', value: withRef({ projectId: 'p-other' }), reason: 'InitializationBinding.ref.projectId is not the answer project' },
  ])('$name', ({ value, reason }) => {
    expect(problemOf(value)).toBe(reason);
  });
});

describe('rejects: a missing field, a bad digest, index, revision or screening note', () => {
  const without = (key: keyof InitializationBindingV1): unknown => {
    const body = validBinding() as unknown as Record<string, unknown>;
    delete body[key];
    return body;
  };

  it.each([
    { name: 'a binding without its answer digest', value: without('answerDigest'), reason: 'InitializationBinding.answerDigest is missing' },
    { name: 'an answer digest that is not 64 lowercase hex digits', value: withBody({ answerDigest: 'A'.repeat(64) }), reason: 'InitializationBinding.answerDigest is invalid' },
    { name: 'a negative draft index', value: withBody({ draftIndex: -1 }), reason: 'InitializationBinding.draftIndex is invalid' },
    { name: 'a revision other than the fixed 1', value: withBody({ revision: 2 as unknown as 1 }), reason: 'InitializationBinding.revision is not recognized' },
    { name: 'a goal revision other than the fixed 1', value: withBody({ goalRevision: 2 as unknown as 1 }), reason: 'InitializationBinding.goalRevision is not recognized' },
    { name: 'a screening note over 512 UTF-8 bytes', value: withBody({ screening: { ...SCREENING, note: 'a'.repeat(513) } }), reason: 'InitializationBinding.screening.note is invalid' },
  ])('$name', ({ value, reason }) => {
    expect(problemOf(value)).toBe(reason);
  });
});

describe('rejects: answer, request and goal are one project and answer/request one workspace', () => {
  it.each([
    { name: 'a request in another project than the answer', value: withBody({ requestRef: { ...REQUEST_REF, projectId: 'p-other' } }), reason: 'InitializationBinding.answerRef and requestRef are in different projects' },
    { name: 'a goal in another project than the answer', value: withBody({ goalRef: { ...GOAL_REF, projectId: 'p-other' } }), reason: 'InitializationBinding.goalRef is in another project than the answer' },
    { name: 'a request in another workspace than the answer', value: withBody({ requestRef: { ...REQUEST_REF, workspaceId: 'w-other' } }), reason: 'InitializationBinding.answerRef and requestRef are in different workspaces' },
  ])('$name', ({ value, reason }) => {
    expect(problemOf(value)).toBe(reason);
  });
});

describe('the codec round trip', () => {
  it('encodes the value under the canonical ref key and decodes it unchanged', () => {
    const encoded = initializationBindingCodec.encode(validBinding());
    expect(encoded.refKey).toBe(
      '{"aggregateType":"InitializationBinding","answerRef":{"aggregateType":"QueryJobAnswer","answerId":"a-1","projectId":"p-binding","queryJobId":"q-1","workspaceId":"w-binding"},"draftIndex":1,"projectId":"p-binding"}',
    );
    expect(encoded.schemaId).toBe('InitializationBinding@1');
    expect(encoded.revision).toBe(1);
    const decoded = initializationBindingCodec.decode(encoded);
    expect(decoded.status).toBe('decoded');
    if (decoded.status !== 'decoded') return;
    expect(decoded.value).toEqual(validBinding());
  });
});
