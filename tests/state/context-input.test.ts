/**
 * Slice 3 ST01–ST15 (spec §5.2): the pure context/input guards of
 * `src/core/work-graph/state/context-input.ts`.
 *
 * One `it` per case row of the frozen table. `H(s)=sha256Hex(s)` and
 * `B(s)=Buffer.byteLength(s,'utf8')` are written as those exact expressions
 * (§5.1). The guards are pure: no RecordStore, no Kernel, no model.
 */
import { describe, expect, it } from 'vitest';
import type { ArtifactRef } from '../../src/contracts/artifact.js';
import type {
  ContextAssemblyBindingV1, ContextSectionNameV1, InputDeclarationV1, InputSelectionV1,
  SelectedInputSourceV1,
} from '../../src/contracts/graph-context.js';
import type { RunRef, TaskTriple } from '../../src/contracts/dispatch.js';
import type { CoreRejection } from '../../src/contracts/core/results.js';
import type { PlanRevisionRef } from '../../src/contracts/plan.js';
import type { TaskClaim } from '../../src/contracts/core/task-claim.js';
import type { RoleBindingRefV1, RuntimeInputBindingV1, TaskBudgetV1 } from '../../src/contracts/dispatch.js';
import type { TaskEnvelopeV1 } from '../../src/contracts/task-envelope.js';
import { sha256Hex } from '../../src/contracts/fingerprint.js';
import {
  contextAssemblyProblem, declaredInputProblem, effectivePlatformDuty,
} from '../../src/core/work-graph/state/context-input.js';
import {
  newRunRecord, runNodeOf, runStateOf, transitionRun, type RunGuardContext,
} from '../../src/core/work-graph/state/run-machine.js';

// ------------------------------------------------------------------------ //
// §5.1 fixture expressions and identities                                    //
// ------------------------------------------------------------------------ //

const H = (s: string): string => sha256Hex(s);
const B = (s: string): number => Buffer.byteLength(s, 'utf8');

const P = 'p';
const W = 'w';
const G = 'g';

const TASK: TaskTriple = { projectId: P, goalId: G, taskId: 'tB' };
const PLAN: PlanRevisionRef = { aggregateType: 'PlanRevision', projectId: P, planId: 'p1' };
const RUN_A: RunRef = { aggregateType: 'Run', projectId: P, goalId: G, runId: 'runA' };

/** legacy Artifact body `old-A`: contentType text/plain, digest H('old-A'), sizeBytes 5, Workspace @7. */
const OLD_A: ArtifactRef = {
  kind: 'artifact', contentType: 'text/plain', digest: H('old-A'), sizeBytes: B('old-A'),
  source: { kind: 'workspace', refId: W, revision: '7' },
};

const SCOPE = { projectId: P, workspaceId: W, goalId: G };

const NO_EXTENSIONS: ContextAssemblyBindingV1['extensions'] = {
  notes: 'not_implemented', anomalies: 'not_implemented', footprint: 'not_implemented',
  goalSettings: 'not_implemented', decisions: 'not_implemented',
};

// ------------------------------------------------------------------------ //
// ST01–ST08: contextAssemblyProblem                                          //
// ------------------------------------------------------------------------ //

type ContextPart = { name: ContextSectionNameV1; text: string };

/** Renders the fixed section order with two LF between segments and no trailing LF. */
function layout(parts: ContextPart[]): { text: string; sections: ContextAssemblyBindingV1['sections'] } {
  const text = parts.map((part) => part.text).join('\n\n');
  let cursor = 0;
  const sections = parts.map((part) => {
    const startByte = B(text.slice(0, cursor));
    const endByte = B(text.slice(0, cursor + part.text.length));
    cursor += part.text.length + 2;
    return { name: part.name, startByte, endByte, omitted: 0 };
  });
  return { text, sections };
}

const PARTS: ContextPart[] = [
  { name: 'role', text: '## Runtime context\nR' },
  { name: 'goal', text: '## Goal\nG' },
  { name: 'task', text: '## Accepted task\nT' },
  { name: 'footprint', text: '## Footprint\nF' },
  { name: 'notes', text: '## Note index\nN' },
  { name: 'reminders', text: '## Reminders\nM' },
  { name: 'inputs', text: '## Selected inputs\nI' },
];
const BASE = layout(PARTS);
const OPTIONAL_BILLED = '\n\n' + ['## Footprint\nF', '## Note index\nN', '## Reminders\nM', '## Selected inputs\nI'].join('\n\n');

/** A legal `s3-context-v1` work binding over the §5.1 pure fixture. */
function workBinding(over: Partial<ContextAssemblyBindingV1> = {}): ContextAssemblyBindingV1 {
  return {
    schemaVersion: 1, formatVersion: 's3-context-v1', callKind: 'work', duty: 'executor',
    sectionOrder: ['role', 'goal', 'task', 'footprint', 'notes', 'reminders', 'inputs'],
    residentBudgetBytes: 4096, residentBytes: B(OPTIONAL_BILLED), totalBytes: B(BASE.text),
    sections: BASE.sections, sources: [], inputSelections: [], extensions: NO_EXTENSIONS,
    ...over,
  };
}

describe('context-input ST01-ST15', () => {
  it('ST02 accepts a legal s3 work binding with exact byte intervals', () => {
    expect(contextAssemblyProblem({
      binding: workBinding(), text: BASE.text, selectedTaskInputs: [], continuationSuffix: null,
    })).toBeNull();
  });

  it('ST03 rejects an unknown formatVersion', () => {
    const problem = contextAssemblyProblem({
      binding: workBinding({ formatVersion: 's3-context-v2' as never }),
      text: BASE.text, selectedTaskInputs: [], continuationSuffix: null,
    });
    expect(problem).toMatchObject({ status: 'rejected', code: 'invalid' } satisfies Partial<CoreRejection>);
  });

  it('ST04 rejects the same section name twice', () => {
    // The second `task` has its own rendered segment, so no two intervals overlap
    // and every other G-CTX rule holds; only the duplicate name is wrong.
    const parts: ContextPart[] = [...PARTS.slice(0, 3), PARTS[2]!, ...PARTS.slice(3)];
    const duplicated = layout(parts);
    const problem = contextAssemblyProblem({
      binding: workBinding({ sections: duplicated.sections, totalBytes: B(duplicated.text) }),
      text: duplicated.text, selectedTaskInputs: [], continuationSuffix: null,
    });
    expect(problem).toMatchObject({ status: 'rejected', code: 'invalid' } satisfies Partial<CoreRejection>);
  });

  it('ST05 rejects an unknown section name question', () => {
    // `question` has its own rendered segment after `inputs`: the intervals stay
    // ordered and non-overlapping, so only the unknown name is wrong.
    const parts: ContextPart[] = [
      ...PARTS, { name: 'question' as ContextSectionNameV1, text: '## Question\nQ' },
    ];
    const unknown = layout(parts);
    const problem = contextAssemblyProblem({
      binding: workBinding({ sections: unknown.sections, totalBytes: B(unknown.text) }),
      text: unknown.text, selectedTaskInputs: [], continuationSuffix: null,
    });
    expect(problem).toMatchObject({ status: 'rejected', code: 'invalid' } satisfies Partial<CoreRejection>);
  });

  it('ST06 rejects an endByte one past the input', () => {
    const sections = BASE.sections.map((section, index) => index === BASE.sections.length - 1
      ? { ...section, endByte: section.endByte! + 1 } : section);
    const problem = contextAssemblyProblem({
      binding: workBinding({ sections }), text: BASE.text, selectedTaskInputs: [], continuationSuffix: null,
    });
    expect(problem).toMatchObject({ status: 'rejected', code: 'invalid' } satisfies Partial<CoreRejection>);
  });

  it('ST07 rejects totalBytes counted in JS length for a multi-byte input', () => {
    const parts: ContextPart[] = [
      { name: 'role', text: '## Runtime context\nR' },
      { name: 'goal', text: '## Goal\nG' },
      { name: 'task', text: '## Accepted task\n中' },
    ];
    const zhong = layout(parts);
    const problem = contextAssemblyProblem({
      binding: workBinding({ sections: zhong.sections, totalBytes: zhong.text.length, residentBytes: 0 }),
      text: zhong.text, selectedTaskInputs: [], continuationSuffix: null,
    });
    expect(problem).toMatchObject({ status: 'rejected', code: 'invalid' } satisfies Partial<CoreRejection>);
  });

  it('ST08 checks the non-tail continuation brief by its range and its single occurrence', () => {
    const brief = 'C3 continuation brief';
    const parts: ContextPart[] = [
      { name: 'role', text: '## Runtime context\nR' },
      { name: 'goal', text: '## Goal\nG' },
      { name: 'continuation', text: brief },
      { name: 'task', text: '## Accepted task\nT' },
    ];
    const nonTail = layout(parts);
    const order: ContextSectionNameV1[] = ['role', 'goal', 'continuation', 'task',
      'footprint', 'notes', 'reminders', 'inputs'];
    const binding = workBinding({
      callKind: 'continuation', sectionOrder: order, sections: nonTail.sections, totalBytes: B(nonTail.text),
    });
    // The brief sits before the task: no longer last, and still legal.
    expect(contextAssemblyProblem({
      binding, text: nonTail.text, selectedTaskInputs: [], continuationSuffix: brief,
    })).toBeNull();

    // The interval, sliced from the input, is no longer the rendered brief.
    const shifted = nonTail.sections.map((section) => section.name === 'continuation'
      ? { ...section, endByte: section.endByte! - 1 } : section);
    expect(contextAssemblyProblem({
      binding: workBinding({ ...binding, sections: shifted }), text: nonTail.text,
      selectedTaskInputs: [], continuationSuffix: brief,
    })).toMatchObject({
      status: 'rejected', code: 'invalid',
      reason: 'the continuation section interval must equal the rendered continuation brief',
    } satisfies Partial<CoreRejection>);

    // A second copy of the rendered brief makes the text non-unique.
    const duplicated = `${nonTail.text}\n\n${brief}`;
    expect(contextAssemblyProblem({
      binding: workBinding({ ...binding, totalBytes: B(duplicated) }), text: duplicated,
      selectedTaskInputs: [], continuationSuffix: brief,
    })).toMatchObject({
      status: 'rejected', code: 'invalid',
      reason: 'the rendered continuation brief must occur exactly once in the input',
    } satisfies Partial<CoreRejection>);
  });

  // ---------------------------------------------------------------------- //
  // ST09–ST15: declaredInputProblem                                         //
  // ---------------------------------------------------------------------- //

  const declaration: InputDeclarationV1 = {
    declarationId: 'd1', consumer: TASK, planRef: PLAN,
    upstream: { projectId: P, goalId: G, taskId: 'tA' },
    requires: { kind: 'artifact', label: 'A.out' }, legacyArtifactRef: OLD_A,
  };

  function runSource(owner: RunRef = RUN_A): SelectedInputSourceV1 {
    return { kind: 'artifact', ref: OLD_A, provenance: { kind: 'run', owner } };
  }

  function selection(over: Partial<InputSelectionV1>): InputSelectionV1 {
    return {
      declaration, state: 'selected', source: runSource(), candidates: [runSource()],
      usage: 'historical_explanation', reason: null, errorCode: null, ...over,
    };
  }

  it('ST09 rejects a declaration that is not in allowedDeclarations', () => {
    const problem = declaredInputProblem({
      declaration, selections: [selection({})], allowedDeclarations: [], scope: SCOPE,
    });
    expect(problem).toMatchObject({ status: 'rejected', code: 'forbidden' } satisfies Partial<CoreRejection>);
  });

  it('ST10 rejects a selected input whose source is null', () => {
    const problem = declaredInputProblem({
      declaration, selections: [selection({ source: null, candidates: [] })],
      allowedDeclarations: [declaration], scope: SCOPE,
    });
    expect(problem).toMatchObject({ status: 'rejected', code: 'invalid' } satisfies Partial<CoreRejection>);
  });

  it('ST11 rejects ambiguous with only one candidate', () => {
    const problem = declaredInputProblem({
      declaration, selections: [selection({ state: 'ambiguous', source: null, candidates: [runSource()] })],
      allowedDeclarations: [declaration], scope: SCOPE,
    });
    expect(problem).toMatchObject({ status: 'rejected', code: 'invalid' } satisfies Partial<CoreRejection>);
  });

  it('ST12 rejects a source from another project', () => {
    const otherOwner: RunRef = { aggregateType: 'Run', projectId: 'other', goalId: G, runId: 'runA' };
    const other: SelectedInputSourceV1 = {
      kind: 'artifact',
      ref: { ...OLD_A, source: { kind: 'workspace', refId: 'w2', revision: '7' } },
      provenance: { kind: 'run', owner: otherOwner },
    };
    const problem = declaredInputProblem({
      declaration, selections: [selection({ source: other, candidates: [other] })],
      allowedDeclarations: [declaration], scope: SCOPE,
    });
    expect(problem).toMatchObject({ status: 'rejected', code: 'forbidden' } satisfies Partial<CoreRejection>);
  });

  it('ST13 rejects the current usage claim', () => {
    const problem = declaredInputProblem({
      declaration, selections: [selection({ usage: 'current' as never })],
      allowedDeclarations: [declaration], scope: SCOPE,
    });
    expect(problem).toMatchObject({ status: 'rejected', code: 'invalid' } satisfies Partial<CoreRejection>);
  });

  it('ST14 a legal missing input does not block RUN-02 freshAdmission', () => {
    const missing = selection({ state: 'missing', source: null, candidates: [], reason: 'no_labeled_output' });
    const problem = declaredInputProblem({
      declaration, selections: [missing], allowedDeclarations: [declaration], scope: SCOPE,
    });
    expect(problem).toBeNull();

    // The fresh admission reads the effective duty; an absent role/host duty defaults to executor.
    expect(effectivePlatformDuty({ roleDuty: undefined, hostDuty: undefined }))
      .toEqual({ status: 'ready', value: 'executor' });

    // RUN-02 through the real run machine: `freshAdmission` is the guard result above.
    const result = transitionRun(runStateOf(CLAIMED), {
      kind: 'entry_authorized', claim, consumerId: CONSUMER, envelope, inputBinding,
    }, { ...CTX, freshAdmission: problem });
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error(`RUN-02 refused: ${result.reason}/${result.code}`);
    expect(runNodeOf(result.next.record)).toBe('Authorized');
    // The Run stays `starting` and its Task is untouched: `entry_authorized` emits
    // no same-commit effect. The Run machine's real effect kinds are attempt /
    // outbox / hold_lease / release_lease / occupy_session / release_session /
    // claim_kernel_slot / intent — none writes a Task phase — so an empty effect
    // list is exactly "Run Authorized, Task phase unchanged".
    expect(result.next.record?.status).toBe('starting');
    expect(result.next.record?.task).toEqual(claim.task);
    expect(result.effects).toEqual([]);
  });

  it('ST15 keeps both canonical candidates of a legal ambiguous input', () => {
    const candidate1 = runSource();
    const candidate2 = runSource({ aggregateType: 'Run', projectId: P, goalId: G, runId: 'runA2' });
    const ambiguous = selection({ state: 'ambiguous', source: null, candidates: [candidate1, candidate2] });
    const problem = declaredInputProblem({
      declaration, selections: [ambiguous], allowedDeclarations: [declaration], scope: SCOPE,
    });
    expect(problem).toBeNull();
    expect(ambiguous.candidates).toHaveLength(2);
    expect(ambiguous.candidates).toEqual([candidate1, candidate2]);
  });
});

// ------------------------------------------------------------------------ //
// RUN-02 fixture for ST14 (§5.1 identities: tB's only Run is runB)           //
// ------------------------------------------------------------------------ //

const GEN = 1;
const CONSUMER = 'consumer-1';
const DIGEST = 'd'.repeat(64);

const attemptRef = { aggregateType: 'TaskAttempt' as const, projectId: P, goalId: G, taskId: TASK.taskId, attemptId: 'attB' };
const outboxRef = { aggregateType: 'DispatchOutboxEntry' as const, projectId: P, goalId: G, taskId: TASK.taskId, attemptId: 'attB' };
const claim: TaskClaim = {
  task: TASK, planRef: PLAN, workspaceId: W, sessionRef: { projectId: P, sessionId: 'sB' },
  sessionRevision: GEN, generation: GEN,
  runRef: { aggregateType: 'Run', projectId: P, goalId: G, runId: 'runB' }, previousRun: null,
  attemptRef, outboxRef, claimedAt: '2026-10-08T00:00:00.000Z',
};
const roleBinding: RoleBindingRefV1 = {
  schemaVersion: 1, bindingId: 'binding-1', templateId: 'worker', templateRevision: 'r1',
  bindingVersion: 1, policyRevision: 'policy-1',
};
const budget: TaskBudgetV1 = { tokenBudget: 1000, deadline: null };
const inputBinding: RuntimeInputBindingV1 = {
  schemaVersion: 1, inputDigest: DIGEST, manifestDigest: 'e'.repeat(64),
  materialAccessRefs: [], deliveryRefs: [],
};
const envelope: TaskEnvelopeV1 = {
  schemaVersion: 1, envelopeId: 'env-1', projectId: P, workspaceId: W, goalId: G, taskId: TASK.taskId,
  runRef: claim.runRef, attemptRef: claim.attemptRef, planRef: PLAN, roleBinding,
  workspaceSnapshot: { workspaceId: W, revision: 7 },
  permissions: { policyRevision: 'policy-1', tools: [], writeScope: [] }, budget, sourceRefs: [],
  bundleRef: {
    kind: 'artifact', contentType: 'text/plain', digest: 'f'.repeat(64), sizeBytes: 1,
    source: { kind: 'workspace', refId: W, revision: '7' },
  },
};
const CLAIMED = newRunRecord({ claim, basis: { kind: 'first' }, roleBinding, budget, workspaceRevision: 7 });

const CTX: RunGuardContext = {
  session: { usable: true, owned: true, kernel: { adapterId: 'adapter-1', kernelSessionId: 'kernel-session-1' } },
  lease: 'owned',
  persistedClaim: claim,
  goal: { desiredState: 'active', activePlanMatchesClaim: true },
  entryPlan: 'active_plan',
  continuationBrief: 'absent_ok',
  freshAdmission: null,
  pointerIntent: null,
  queuedSteers: [],
  continuationConsumed: false,
  exitProof: 'live_clean',
  hostLease: 'owned',
  kernelProbe: 'ready',
  kernelPaused: false,
  inputsConfirmed: true,
  actor: 'human',
  claim: { sessionOccupied: false, eligibility: null, taskHasRun: false, prior: null, admission: null, requeue: null },
};
