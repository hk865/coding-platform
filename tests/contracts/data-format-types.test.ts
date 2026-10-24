/**
 * Type rows of the field-table formats: the TypeScript type a description infers. The type checker (`npm run
 * typecheck`) is what runs these rows; `expectTypeOf(...).branded` compares the flattened object types, and each
 * `@ts-expect-error` line must stay a type error. The expected types are written by hand from the format rules.
 */
import { expectTypeOf, it } from 'vitest';
import type { CommitCursor } from '../../src/contracts/command-event.js';
import type { OperationRef } from '../../src/contracts/core/operations.js';
import type { ModuleRef, SessionAggregateRef, SessionRef } from '../../src/contracts/core/identity.js';
import type { SessionMessageRef } from '../../src/contracts/core/session-message.js';
import {
  defineEvent, defineRecord, defineShape, f, type InferEvent, type InferPending, type InferRecord, type InferShape,
} from '../../src/contracts/data-format.js';
import * as refs from '../../src/contracts/data-format-refs.js';
import type { RunRef, TaskTriple } from '../../src/contracts/dispatch.js';
import type { GoalRef, ProjectRef, WorkspaceRef } from '../../src/contracts/ledger.js';
import type { QueryJobAnswerRef, QueryJobRef, QueryRunRef } from '../../src/contracts/query-job.js';
import type { TaskRequeueRef } from '../../src/contracts/task-requeue.js';
import type { VerificationRoundRef } from '../../src/contracts/verification.js';
import type { PlanProposalRef } from '../../src/core/work-graph/state/plan-machine.js';

const WidgetRef = defineShape({ name: 'WidgetRef', fields: { aggregateType: f.literal('Widget'), widgetId: f.string() } });

it('field-table types: optional and nullable, union narrowing, the catalog refs, pending and stored, the other kinds', () => {
  // An optional key may be absent but is never undefined; a nullable key is present and may be null.
  const optional = defineShape({ name: 'T', fields: { a: f.optional(f.string()), b: f.nullable(f.string()) } });
  type T = InferShape<typeof optional.fields>;
  expectTypeOf<T>().branded.toEqualTypeOf<{ a?: string; b: string | null }>();
  // @ts-expect-error a key present with undefined is not an absent optional key
  const present: T = { a: undefined, b: null };
  // @ts-expect-error a nullable key must be present
  const absent: T = { a: 'x' };
  // A union narrows on its tag, and a branch is exact.
  const union = defineShape({ name: 'U', fields: { body: f.union('kind', {
    text: { kind: f.literal('text'), text: f.string() }, count: { kind: f.literal('count'), count: f.integer({ min: 0 }), note: f.optional(f.string()) },
  }) } });
  type Body = InferShape<typeof union.fields>['body'];
  expectTypeOf<Extract<Body, { kind: 'text' }>>().branded.toEqualTypeOf<{ kind: 'text'; text: string }>();
  expectTypeOf<Extract<Body, { kind: 'count' }>>().branded.toEqualTypeOf<{ kind: 'count'; count: number; note?: string }>();
  // @ts-expect-error the text branch has no count
  const mixed: Body = { kind: 'text', count: 1 };
  void [present, absent, mixed];
  // Each catalog ref infers exactly its hand-written ref type.
  expectTypeOf<InferShape<typeof refs.ProjectRefShape.fields>>().branded.toEqualTypeOf<ProjectRef>();
  expectTypeOf<InferShape<typeof refs.WorkspaceRefShape.fields>>().branded.toEqualTypeOf<WorkspaceRef>();
  expectTypeOf<InferShape<typeof refs.GoalRefShape.fields>>().branded.toEqualTypeOf<GoalRef>();
  expectTypeOf<InferShape<typeof refs.SessionRefShape.fields>>().branded.toEqualTypeOf<SessionRef>();
  expectTypeOf<InferShape<typeof refs.SessionAggregateRefShape.fields>>().branded.toEqualTypeOf<SessionAggregateRef>();
  expectTypeOf<InferShape<typeof refs.ModuleRefShape.fields>>().branded.toEqualTypeOf<ModuleRef>();
  expectTypeOf<InferShape<typeof refs.QueryJobRefShape.fields>>().branded.toEqualTypeOf<QueryJobRef>();
  expectTypeOf<InferShape<typeof refs.QueryRunRefShape.fields>>().branded.toEqualTypeOf<QueryRunRef>();
  expectTypeOf<InferShape<typeof refs.QueryJobAnswerRefShape.fields>>().branded.toEqualTypeOf<QueryJobAnswerRef>();
  expectTypeOf<InferShape<typeof refs.SessionMessageRefShape.fields>>().branded.toEqualTypeOf<SessionMessageRef>();
  expectTypeOf<InferShape<typeof refs.TaskTripleShape.fields>>().branded.toEqualTypeOf<TaskTriple>();
  expectTypeOf<InferShape<typeof refs.RunRefShape.fields>>().branded.toEqualTypeOf<RunRef>();
  expectTypeOf<InferShape<typeof refs.OperationRefShape.fields>>().branded.toEqualTypeOf<OperationRef>();
  expectTypeOf<InferShape<typeof refs.PlanProposalRefShape.fields>>().branded.toEqualTypeOf<PlanProposalRef>();
  expectTypeOf<InferShape<typeof refs.TaskRequeueRefShape.fields>>().branded.toEqualTypeOf<TaskRequeueRef>();
  expectTypeOf<InferShape<typeof refs.VerificationRoundRefShape.fields>>().branded.toEqualTypeOf<VerificationRoundRef>();
  // A bound cursor is CommitCursor when stored and may be null while pending; a nullable one may be null stored.
  const widget = defineRecord({
    name: 'Widget', schemaId: 'Widget@1', aggregateType: 'Widget',
    fields: { ref: f.ref(WidgetRef), revision: f.revision({ min: 1 }), since: f.boundCursor('since'), until: f.nullable(f.boundCursor('until')) },
  });
  type WidgetBody = { ref: { aggregateType: 'Widget'; widgetId: string }; revision: number; until: CommitCursor | null };
  expectTypeOf<InferRecord<typeof widget.fields>>().branded.toEqualTypeOf<WidgetBody & { since: CommitCursor }>();
  expectTypeOf<InferPending<typeof widget.fields>>().branded.toEqualTypeOf<WidgetBody & { since: CommitCursor | null }>();
  // The other kinds infer their value types; arrays stay mutable; an immutable record revision is the literal 1.
  const kinds = defineShape({ name: 'K', fields: {
    mode: f.enumOf(['a', 'b']), at: f.isoTime(), ledger: f.cursor('ledger'), kernel: f.cursor('kernel'),
    digest: f.sha256(), ratio: f.finite(), flag: f.boolean(), tags: f.array(f.string()), inner: f.object({ n: f.integer({ min: 0 }) }),
  } });
  expectTypeOf<InferShape<typeof kinds.fields>>().branded.toEqualTypeOf<{
    mode: 'a' | 'b'; at: string; ledger: CommitCursor; kernel: string; digest: string; ratio: number; flag: boolean; tags: string[]; inner: { n: number };
  }>();
  const answer = defineRecord({ name: 'Answer', schemaId: 'Answer@1', aggregateType: 'Widget', fields: { ref: f.ref(WidgetRef), revision: f.literal(1) } });
  expectTypeOf<InferRecord<typeof answer.fields>['revision']>().toEqualTypeOf<1>();
  const changed = defineEvent({ name: 'WidgetChanged', eventType: 'WidgetChanged', schemaVersion: 1, fields: { note: f.string() } });
  expectTypeOf<InferEvent<'WidgetChanged', typeof changed.fields>>().branded.toEqualTypeOf<{
    eventId: string; eventType: 'WidgetChanged'; schemaVersion: 1; occurredAt: string; note: string;
  }>();
});
