/**
 * Slice 3 pure context/input guards (CTX-01..03, spec §3.3).
 *
 * `contextAssemblyProblem` is the pure G-CTX check of a saved
 * `ContextAssemblyBindingV1`: schema/version/callKind/section legality, ordered
 * non-overlapping in-bounds UTF-8 intervals, whole-section omission only for the
 * four budget sections, `totalBytes` = UTF-8 byte length, the required sections of
 * the call kind present, each budget section's `omitted` count consistent with its
 * omission marker (`另有 n 条，用‘看’读`), sorted/deduplicated sources, the
 * continuation section last and exactly the rendered brief, and the legacy
 * `selectedTaskInputs` projection equal to the binding's Artifact selections.
 *
 * `declaredInputProblem` is the pure G-INPUT check of one declaration's
 * selection: the declaration belongs to the claim's Plan, the state shape holds
 * (`selected` exactly one source, `missing` no source/candidate, `ambiguous` at
 * least two candidates, `unavailable` a reason/errorCode), every usage is
 * `historical_explanation`, every source is in scope, an edge selection's source
 * kind fits its requirement and a legacy selection is exactly the stored legacy
 * Artifact ref. A legacy declaration's derived `upstream` is not compared; an
 * edge declaration's `upstream` is.
 *
 * These functions only import `contracts/`; they do no IO, take no clock and
 * create no business record.
 */
import type { ArtifactRef } from '../../../contracts/artifact.js';
import type { CoreRejection, ReadResult } from '../../../contracts/core/results.js';
import { canonicalJson, type JsonValue } from '../../../contracts/fingerprint.js';
import type {
  ContextAssemblyBindingV1, ContextCallKindV1, ContextSectionNameV1, InputDeclarationV1,
  InputSelectionV1, PlatformDutyV1, SelectedInputSourceV1,
} from '../../../contracts/graph-context.js';

const CONTEXT_FORMAT_VERSION: ContextAssemblyBindingV1['formatVersion'] = 's3-context-v1';

const CALL_KINDS: readonly ContextCallKindV1[] = [
  'work', 'continuation', 'handoff', 'review', 'secretary', 'copy', 'planning', 'attention',
];

const DUTIES: readonly PlatformDutyV1[] = ['executor', 'secretary', 'adviser', 'scribe', 'reviewer'];

/** The fixed rendering order of §4.3; every call kind is a subsequence. R1: the
 * review instruction is the last section and is legal only for `work`. */
const SECTION_ORDER: readonly ContextSectionNameV1[] = [
  'role', 'goal', 'task', 'footprint', 'notes', 'reminders', 'inputs', 'continuation', 'unknown_call_review',
];

/** The four budgeted optional sections that may be omitted as a whole (§4.3 T2). */
const BUDGET_SECTIONS: ReadonlySet<ContextSectionNameV1> = new Set(['footprint', 'notes', 'reminders', 'inputs']);

const WORK_SECTIONS: readonly ContextSectionNameV1[] = ['role', 'goal', 'task', 'footprint', 'notes', 'reminders', 'inputs'];
const WORK_AND_CONTINUATION: readonly ContextSectionNameV1[] = [...WORK_SECTIONS, 'continuation'];
/** R1: the review instruction is a Work section; continuation/handoff never carry it. */
const WORK_AND_REVIEW: readonly ContextSectionNameV1[] = [...WORK_SECTIONS, 'unknown_call_review'];

/** Call kinds whose task card also carries the Goal and Accepted task sections (§4.3). */
const REQUIRES_GOAL_AND_TASK: ReadonlySet<ContextCallKindV1> = new Set(['work', 'continuation', 'handoff']);

/** The one accepted omission marker line (§4.3 T2). */
const OMISSION_MARKER = /^另有 (\d+) 条，用‘看’读$/;

const OMISSIONS_HEADER = '## Context omissions';

/** §4.3's per-call-kind section table. `attention` carries only change rows. */
const CALL_KIND_SECTIONS: Readonly<Record<ContextCallKindV1, ReadonlySet<ContextSectionNameV1>>> = {
  work: new Set(WORK_AND_REVIEW),
  continuation: new Set(WORK_AND_CONTINUATION),
  handoff: new Set(WORK_AND_CONTINUATION),
  review: new Set(['role', 'task', 'reminders']),
  secretary: new Set(['role', 'goal', 'task', 'notes', 'reminders']),
  copy: new Set(['role', 'goal', 'task']),
  planning: new Set(['role', 'goal', 'task', 'footprint']),
  attention: new Set(SECTION_ORDER.filter((name) => name !== 'unknown_call_review')),
};

function invalid(reason: string): CoreRejection {
  return { status: 'rejected', code: 'invalid', reason };
}

function forbidden(reason: string): CoreRejection {
  return { status: 'rejected', code: 'forbidden', reason };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isNonNegativeSafeInteger(value: unknown): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0;
}

function utf8Bytes(value: string): number {
  return Buffer.byteLength(value, 'utf8');
}

/** A canonical JSON key; a value that cannot be canonicalized is `null`. */
function canonicalKey(value: unknown): string | null {
  try { return canonicalJson(value as JsonValue); } catch { return null; }
}

/** The UTF-8 bytes of a half-open section interval, decoded back as text. */
function utf8Slice(text: string, startByte: number, endByte: number): string {
  return Buffer.from(text, 'utf8').subarray(startByte, endByte).toString('utf8');
}

function lastLineOf(text: string): string {
  const index = text.lastIndexOf('\n');
  return index === -1 ? text : text.slice(index + 1);
}

/** The lines of the `## Context omissions` block, or `[]` when there is none (§4.3). */
function contextOmissionLines(text: string): string[] {
  const start = text.indexOf(OMISSIONS_HEADER);
  if (start === -1 || (start > 0 && text[start - 1] !== '\n')) return [];
  const afterHeader = start + OMISSIONS_HEADER.length;
  if (text[afterHeader] !== '\n') return [];
  const rest = text.slice(afterHeader + 1);
  const end = rest.indexOf('\n\n');
  return (end === -1 ? rest : rest.slice(0, end)).split('\n');
}

type BudgetSection = {
  name: ContextSectionNameV1;
  startByte: number | null;
  endByte: number | null;
  omitted: number;
};

/** §4.3 T2: a budget section's `omitted` count must match its omission marker. */
function budgetMarkerProblem(text: string, section: BudgetSection): CoreRejection | null {
  if (section.startByte === null) {
    const marker = `${section.name}: 另有 ${String(section.omitted)} 条，用‘看’读`;
    if (!contextOmissionLines(text).includes(marker)) {
      return invalid(`the omitted ${section.name} section must be listed in the Context omissions block`);
    }
    return null;
  }
  const line = lastLineOf(utf8Slice(text, section.startByte, section.endByte ?? section.startByte));
  const marker = OMISSION_MARKER.exec(line);
  if (section.omitted > 0) {
    if (marker === null || Number(marker[1]) !== section.omitted) {
      return invalid(`the omitted ${section.name} section must end with its omission marker`);
    }
    return null;
  }
  if (marker !== null) return invalid(`the ${section.name} section must not end with an omission marker`);
  return null;
}

/** G-INPUT: the selected source kind must fit an edge declaration's requirement (§3.5). */
function selectedSourceKindProblem(
  requires: InputDeclarationV1['requires'],
  source: SelectedInputSourceV1,
  scope: { projectId: string; workspaceId: string },
): CoreRejection | null {
  switch (requires.kind) {
    case 'artifact':
    case 'output-contract':
      // T6: no formal labeled-output publication exists, so these edges are never selected.
      return forbidden(`a ${requires.kind} input can never select a source`);
    case 'gate-result':
      if (source.kind !== 'check' || source.checkId !== requires.label) {
        return forbidden('a gate-result input must select its labeled check');
      }
      return null;
    case 'environment-revision':
      if (source.kind !== 'environment') {
        return forbidden('an environment-revision input must select the environment');
      }
      if (source.ref.projectId !== scope.projectId || source.ref.workspaceId !== scope.workspaceId) {
        return forbidden('the environment-revision source is not the scope workspace');
      }
      return null;
    case 'decision':
      if (source.kind !== 'decision') {
        return forbidden('a decision input must select the decision');
      }
      return null;
    default:
      return forbidden('the input requirement kind is not recognized');
  }
}

/** `legacy:<requirementId>` keeps the stored requirementId; every other declaration keeps its id. */
function requirementIdOf(declarationId: string): string {
  return declarationId.startsWith('legacy:') ? declarationId.slice('legacy:'.length) : declarationId;
}

/**
 * D1/R1: the one trailing-section check shared by the continuation brief and the
 * review instruction. `suffix` is the rendered text (null when the section must
 * be absent); when it is present the section must be the last one and its byte
 * interval exactly the rendered suffix.
 */
function trailingSectionProblem(input: {
  text: string;
  sections: ContextAssemblyBindingV1['sections'];
  index: number;
  name: ContextSectionNameV1;
  /** The rendered text; null means the section carries no text. */
  suffix: string | null;
  /** Human noun of the rendered text, e.g. `continuation brief`. */
  noun: string;
  /** True when the section itself is required even without its rendered text. */
  required: boolean;
}): CoreRejection | null {
  const { text, sections, index, name, suffix } = input;
  if (suffix === null) {
    if (index !== -1) return invalid(`a ${name} section requires the rendered ${input.noun}`);
    if (input.required) return invalid(`a ${name} section is required by this call kind`);
    return null;
  }
  if (index === -1) return invalid(`a ${name} section is required`);
  if (index !== sections.length - 1) return invalid(`the ${name} section must be the last section`);
  const section = sections[index]!;
  if (section.startByte === null || section.endByte === null) {
    return invalid(`the ${name} section cannot be omitted`);
  }
  if (section.endByte !== utf8Bytes(text)) return invalid(`no text may follow the ${input.noun}`);
  if (section.startByte !== utf8Bytes(text) - utf8Bytes(suffix)) {
    return invalid(`the ${name} section interval must be exactly the rendered ${input.noun}`);
  }
  if (!text.endsWith(`\n\n${suffix}`)) return invalid(`the input does not end with the ${input.noun}`);
  return null;
}

export type ContextAssemblyProblemInput = {
  binding: ContextAssemblyBindingV1 | undefined;
  text: string;
  selectedTaskInputs: { requirementId: string; ref: ArtifactRef }[];
  continuationSuffix: string | null;
  /**
   * R1/D1: the rendered `unknown_call_review` section of a review-purpose Work
   * Run, or null/absent for every ordinary Work and Query binding.
   */
  reviewSuffix?: string | null;
};

export function contextAssemblyProblem(input: ContextAssemblyProblemInput): CoreRejection | null {
  const { binding, text, selectedTaskInputs, continuationSuffix } = input;
  const reviewSuffix = input.reviewSuffix ?? null;
  if (binding === undefined) return null;
  // A present but malformed value (null included) is `invalid`, never legacy (§2.4 item 1).
  if (!isRecord(binding)) return invalid('the context assembly binding is not an object');
  if (binding.schemaVersion !== 1) return invalid('the context assembly binding schemaVersion must be 1');
  if (binding.formatVersion !== CONTEXT_FORMAT_VERSION) return invalid('the context assembly formatVersion is not s3-context-v1');
  if (!CALL_KINDS.includes(binding.callKind)) return invalid('the context assembly callKind is not recognized');
  if (!DUTIES.includes(binding.duty)) return invalid('the context assembly duty is not recognized');
  if (!isNonNegativeSafeInteger(binding.residentBudgetBytes)) return invalid('residentBudgetBytes must be a non-negative safe integer');
  if (!isNonNegativeSafeInteger(binding.residentBytes)) return invalid('residentBytes must be a non-negative safe integer');
  if (binding.residentBytes > binding.residentBudgetBytes) return invalid('residentBytes cannot exceed residentBudgetBytes');
  if (binding.totalBytes !== utf8Bytes(text)) return invalid('totalBytes must be the UTF-8 byte length of the input');
  if (!Array.isArray(binding.sections)) return invalid('the context assembly sections must be an array');
  if (!Array.isArray(binding.sources)) return invalid('the context assembly sources must be an array');
  if (!Array.isArray(binding.inputSelections)) return invalid('the context assembly inputSelections must be an array');

  const allowed = CALL_KIND_SECTIONS[binding.callKind];
  const seen = new Set<ContextSectionNameV1>();
  const budgetSections: BudgetSection[] = [];
  let previousOrder = -1;
  let previousEnd: number | null = null;
  let continuationIndex = -1;
  let reviewIndex = -1;
  for (let index = 0; index < binding.sections.length; index += 1) {
    const section = binding.sections[index]!;
    if (!isRecord(section)) return invalid('a context section entry is not an object');
    const name = section.name as ContextSectionNameV1;
    if (!SECTION_ORDER.includes(name)) return invalid('a context section name is not recognized');
    if (!allowed.has(name)) return invalid(`section ${name} is not legal for callKind ${binding.callKind}`);
    if (seen.has(name)) return invalid(`section ${name} appears twice`);
    seen.add(name);
    const order = SECTION_ORDER.indexOf(name);
    if (order <= previousOrder) return invalid('context sections are not in the fixed order');
    previousOrder = order;
    if (name === 'continuation') continuationIndex = index;
    if (name === 'unknown_call_review') reviewIndex = index;
    if (!isNonNegativeSafeInteger(section.omitted)) return invalid('a section omitted count must be a non-negative safe integer');
    const startByte = section.startByte;
    const endByte = section.endByte;
    const startNull = startByte === null;
    const endNull = endByte === null;
    if (startNull !== endNull) return invalid('a section interval must be wholly present or wholly null');
    if (startNull) {
      if (!BUDGET_SECTIONS.has(name)) return invalid('only a budgeted optional section may be omitted as a whole');
      if (section.omitted <= 0) return invalid('a null section interval must omit at least one row');
      budgetSections.push({ name, startByte: null, endByte: null, omitted: section.omitted });
      continue;
    }
    if (!isNonNegativeSafeInteger(startByte)) return invalid('a section startByte must be a non-negative safe integer');
    if (!isNonNegativeSafeInteger(endByte)) return invalid('a section endByte must be a non-negative safe integer');
    if (endByte < startByte) return invalid('a section endByte cannot precede its startByte');
    if (endByte > binding.totalBytes) return invalid('a section interval ends past the input');
    if (previousEnd !== null && startByte < previousEnd) return invalid('context section intervals overlap or are out of order');
    previousEnd = endByte;
    if (BUDGET_SECTIONS.has(name)) budgetSections.push({ name, startByte, endByte, omitted: section.omitted });
  }

  // G-CTX: the required sections of the call kind are present with a real interval
  // (only a budgeted optional section may be null, checked above).
  if (!seen.has('role')) return invalid('the context assembly requires a role section');
  if (REQUIRES_GOAL_AND_TASK.has(binding.callKind)) {
    if (!seen.has('goal')) return invalid(`a ${binding.callKind} call requires a goal section`);
    if (!seen.has('task')) return invalid(`a ${binding.callKind} call requires a task section`);
  }

  // G-CTX: each budget section's omitted count and its marker agree with the text.
  for (const section of budgetSections) {
    const problem = budgetMarkerProblem(text, section);
    if (problem !== null) return problem;
  }

  if (binding.callKind === 'continuation' || binding.callKind === 'handoff') {
    const continuationProblem = trailingSectionProblem({
      text, sections: binding.sections, index: continuationIndex,
      name: 'continuation', suffix: continuationSuffix, noun: 'continuation brief', required: true,
    });
    if (continuationProblem !== null) return continuationProblem;
  } else {
    if (seen.has('continuation')) return invalid('a continuation section is legal only for a continuation call');
    if (continuationSuffix !== null) return invalid('a continuation brief was supplied without a continuation section');
  }

  // R1: the review instruction is a Work-only last section, present exactly when
  // the caller supplies its rendered text. `continuation` and `handoff` never
  // carry it (the call-kind table already refuses the name there).
  if (binding.callKind === 'work') {
    const reviewProblem = trailingSectionProblem({
      text, sections: binding.sections, index: reviewIndex,
      name: 'unknown_call_review', suffix: reviewSuffix, noun: 'review instruction', required: false,
    });
    if (reviewProblem !== null) return reviewProblem;
  } else if (reviewSuffix !== null) {
    return invalid('a review section is legal only for a work call');
  }

  let previousSource: string | null = null;
  for (const source of binding.sources) {
    const key = canonicalKey(source);
    if (key === null) return invalid('a context source is not canonicalizable');
    if (previousSource !== null && key <= previousSource) return invalid('context sources must be sorted and deduplicated');
    previousSource = key;
    if (isRecord(source) && source.kind === 'record'
      && (!isNonNegativeSafeInteger(source.revision))) {
      return invalid('a record source revision must be a non-negative safe integer');
    }
  }

  const projected = binding.inputSelections
    .filter((selection): selection is InputSelectionV1 & { source: Extract<SelectedInputSourceV1, { kind: 'artifact' }> } =>
      isRecord(selection) && selection.state === 'selected' && isRecord(selection.source) && selection.source.kind === 'artifact')
    .map((selection) => ({ requirementId: requirementIdOf(selection.declaration.declarationId), ref: selection.source.ref }));
  const expected = [...selectedTaskInputs];
  const byRequirementId = (left: { requirementId: string }, right: { requirementId: string }): number =>
    left.requirementId < right.requirementId ? -1 : left.requirementId > right.requirementId ? 1 : 0;
  projected.sort(byRequirementId);
  expected.sort(byRequirementId);
  if (projected.length !== expected.length) {
    return invalid('the legacy selectedTaskInputs do not match the binding Artifact selections');
  }
  for (let index = 0; index < projected.length; index += 1) {
    const left = projected[index]!;
    const right = expected[index]!;
    if (left.requirementId !== right.requirementId) {
      return invalid('the legacy selectedTaskInputs requirement ids do not match the binding');
    }
    const leftRef = canonicalKey(left.ref);
    const rightRef = canonicalKey(right.ref);
    if (leftRef === null || rightRef === null || leftRef !== rightRef) {
      return invalid('the legacy selectedTaskInputs Artifact refs do not match the binding');
    }
  }
  return null;
}

/**
 * Wiring 1 W1-CTX-01/G (§2.2, L2/L4): the pure Goal-content check of a saved
 * `ContextAssemblyBindingV1`. It compares only the digest of the Goal-record
 * content the Work Goal section shows, stored on the binding's own Goal
 * `record` source, against the current Goal digest. A missing binding, a
 * rebinding, no matching source, and a `null` digest all pass (legacy prepared
 * manifests stay valid); only a present, different string rejects, with the
 * exact `context_goal_changed:` reason the Workflow's `start` mapping reads.
 */
export function contextGoalContentProblem(input: {
  binding: ContextAssemblyBindingV1 | undefined;
  claimGoal: { projectId: string; goalId: string };
  currentGoalDigest: string;
  rebinding: boolean;
}): CoreRejection | null {
  const { binding, claimGoal, currentGoalDigest, rebinding } = input;
  if (binding === undefined) return null;
  // CTX-02: an already bound manifest is only validated, never re-pinned (§3.2).
  if (rebinding) return null;
  for (const source of binding.sources) {
    if (source.kind !== 'record') continue;
    if (source.ref.aggregateType !== 'Goal') continue;
    if (source.ref.projectId !== claimGoal.projectId || source.ref.goalId !== claimGoal.goalId) continue;
    // Only a present, different string rejects; a null digest is a legacy manifest
    // that never stored the shown Goal content (L2) and stays valid.
    if (typeof source.digest === 'string' && source.digest !== currentGoalDigest) {
      return {
        status: 'rejected',
        code: 'revision_conflict',
        reason: 'context_goal_changed: the Goal content shown by the prepared context changed after preparation; prepare the context again',
      };
    }
  }
  return null;
}

export type DeclaredInputProblemInput = {
  declaration: InputDeclarationV1;
  selections: InputSelectionV1[];
  allowedDeclarations: InputDeclarationV1[];
  scope: { projectId: string; workspaceId: string; goalId: string };
};

export function declaredInputProblem(input: DeclaredInputProblemInput): CoreRejection | null {
  const { declaration, selections, allowedDeclarations, scope } = input;
  if (!isRecord(declaration) || typeof declaration.declarationId !== 'string' || declaration.declarationId.length === 0) {
    return invalid('an input selection carries no declaration');
  }
  const allowed = allowedDeclarations.find((candidate) => candidate.declarationId === declaration.declarationId);
  if (allowed === undefined) return forbidden('the input declaration is not part of the claim Plan');
  // A legacy declaration is the one whose stored Plan row carries the legacy Artifact ref
  // (its `upstream` is derived from the canonical owner, so it is not compared).
  const legacy = declaration.legacyArtifactRef !== null;
  // The declaration's plan/consumer/requirement/legacy ref must be that stored declaration;
  // an edge declaration must also carry the stored `upstream` (§3.5, §8.3).
  if (canonicalKey(allowed.planRef) !== canonicalKey(declaration.planRef)
    || canonicalKey(allowed.consumer) !== canonicalKey(declaration.consumer)
    || canonicalKey(allowed.requires) !== canonicalKey(declaration.requires)
    || canonicalKey(allowed.legacyArtifactRef) !== canonicalKey(declaration.legacyArtifactRef)
    || (!legacy && canonicalKey(allowed.upstream) !== canonicalKey(declaration.upstream))) {
    return forbidden('the declared input disagrees with the stored Plan declaration');
  }
  if (!Array.isArray(selections)) return invalid('the input selections must be an array');
  for (const selection of selections) {
    if (!isRecord(selection)) return invalid('an input selection is not an object');
    if (selection.usage !== 'historical_explanation') {
      return invalid('every input selection usage must be historical_explanation');
    }
    const state = selection.state;
    if (state !== 'selected' && state !== 'missing' && state !== 'ambiguous' && state !== 'unavailable') {
      return invalid('the input selection state is not recognized');
    }
    const source = selection.source;
    const candidates = selection.candidates;
    if (!Array.isArray(candidates)) return invalid('the input selection candidates must be an array');
    if (state === 'selected') {
      if (!isRecord(source)) return invalid('a selected input requires exactly one source');
    } else if (state === 'missing') {
      if (source !== null || candidates.length !== 0) return invalid('a missing input has no source or candidate');
    } else if (state === 'ambiguous') {
      if (source !== null) return invalid('an ambiguous input carries no single source');
      if (candidates.length < 2) return invalid('an ambiguous input needs at least two candidates');
    } else {
      if (source !== null) return invalid('an unavailable input carries no source');
      if (selection.errorCode === null && (typeof selection.reason !== 'string' || selection.reason.length === 0)) {
        return invalid('an unavailable input requires an errorCode or reason');
      }
    }
    const sources: unknown[] = [source, ...candidates];
    for (const candidate of sources) {
      if (candidate === null || candidate === undefined) continue;
      const problem = sourceScopeProblem(candidate, scope);
      if (problem !== null) return problem;
    }
    // G-INPUT: an edge declaration's selected source must fit `requires.kind` (§3.5).
    if (!legacy && state === 'selected') {
      const kindProblem = selectedSourceKindProblem(declaration.requires, source as SelectedInputSourceV1, scope);
      if (kindProblem !== null) return kindProblem;
    }
    if (declaration.legacyArtifactRef !== null) {
      if (allowed.legacyArtifactRef === null) return forbidden('the stored Plan declaration carries no legacy Artifact');
      if (state === 'selected') {
        if (!isRecord(source) || source.kind !== 'artifact') {
          return invalid('a legacy Artifact selection must select the artifact source');
        }
        const selectedRef = canonicalKey(source.ref);
        const storedRef = canonicalKey(declaration.legacyArtifactRef);
        if (selectedRef === null || storedRef === null || selectedRef !== storedRef) {
          return forbidden('the selected Artifact is not the stored legacy declaration ref');
        }
      }
    }
  }
  return null;
}

/** The project/workspace/goal scope of one selected source (or candidate). */
function sourceScopeProblem(
  source: unknown,
  scope: { projectId: string; workspaceId: string; goalId: string },
): CoreRejection | null {
  if (!isRecord(source) || typeof source.kind !== 'string') return invalid('a source is not a complete SelectedInputSourceV1');
  switch (source.kind) {
    case 'artifact': {
      const provenance = source.provenance;
      if (!isRecord(provenance)) return invalid('an Artifact source requires provenance');
      if (provenance.kind === 'run') {
        const owner = provenance.owner;
        if (!isRecord(owner)) return invalid('a Run provenance requires an owner RunRef');
        if (owner.projectId !== scope.projectId) return forbidden('the source Run belongs to another project');
        // A QueryRun owner carries its workspace; a Run owner's workspace is re-checked by
        // the input owner (G3). The owner's Goal is deliberately not compared: an adopted
        // legacy cross-Goal input in the same project/workspace is legal (§8.3, §3.5).
        if (typeof owner.workspaceId === 'string' && owner.workspaceId !== scope.workspaceId) {
          return forbidden('the source origin belongs to another workspace');
        }
        return null;
      }
      if (typeof provenance.projectId === 'string' && provenance.projectId !== scope.projectId) {
        return forbidden('the source origin belongs to another project');
      }
      if (typeof provenance.workspaceId === 'string' && provenance.workspaceId !== scope.workspaceId) {
        return forbidden('the source origin belongs to another workspace');
      }
      if (typeof provenance.goalId === 'string' && provenance.goalId !== scope.goalId) {
        return forbidden('the source origin belongs to another goal');
      }
      return null;
    }
    case 'environment': {
      const ref = source.ref;
      if (!isRecord(ref)) return invalid('an environment source requires a WorkspaceRef');
      if (ref.projectId !== undefined && ref.projectId !== scope.projectId) return forbidden('the environment source belongs to another project');
      if (ref.workspaceId !== undefined && ref.workspaceId !== scope.workspaceId) return forbidden('the environment source belongs to another workspace');
      return null;
    }
    case 'check': {
      const ref = source.ref;
      if (!isRecord(ref)) return invalid('a check source requires a VerificationRoundRef');
      if (ref.projectId !== undefined && ref.projectId !== scope.projectId) return forbidden('the check source belongs to another project');
      if (ref.goalId !== undefined && ref.goalId !== null && ref.goalId !== scope.goalId) return forbidden('the check source belongs to another goal');
      return null;
    }
    case 'decision': {
      const ref = source.ref;
      if (!isRecord(ref)) return invalid('a decision source requires a message ref');
      if (ref.projectId !== undefined && ref.projectId !== scope.projectId) return forbidden('the decision source belongs to another project');
      return null;
    }
    default:
      return invalid('the source kind is not recognized');
  }
}

export function effectivePlatformDuty(input: {
  roleDuty: PlatformDutyV1 | undefined;
  hostDuty: PlatformDutyV1 | undefined;
}): ReadResult<PlatformDutyV1> {
  const roleDuty = input.roleDuty;
  const hostDuty = input.hostDuty;
  if (roleDuty !== undefined && !DUTIES.includes(roleDuty)) {
    return { status: 'rejected', code: 'invalid', reason: 'the resolved Role duty is not recognized' };
  }
  if (hostDuty !== undefined && !DUTIES.includes(hostDuty)) {
    return { status: 'rejected', code: 'invalid', reason: 'the Host duty is not recognized' };
  }
  if (roleDuty !== undefined) {
    if (hostDuty !== undefined && hostDuty !== roleDuty) {
      return { status: 'rejected', code: 'forbidden', reason: 'the explicit Host duty disagrees with the resolved Role duty' };
    }
    return { status: 'ready', value: roleDuty };
  }
  if (hostDuty !== undefined) return { status: 'ready', value: hostDuty };
  return { status: 'ready', value: 'executor' };
}
