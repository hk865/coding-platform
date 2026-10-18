/**
 * Slice 3 shared pure DTOs: context assembly, graph read model, attention facts
 * and exact task-input pages. This module imports only existing `contracts/`
 * declarations; it never imports WorkGraph or AgentRuntime.
 */
import type { ArtifactOwnerRunRef, ArtifactRef } from './artifact.js';
import type { PlatformMaterialOrigin } from './core/call-context.js';
import type { ModuleRef, SessionRef } from './core/identity.js';
import type { CoreError } from './core/results.js';
import type { SessionMessageRef } from './core/session-message.js';
import type { RunRef, TaskTriple } from './dispatch.js';
import type { AggregateRef, GoalRef, GoalSnapshot, WorkspaceRef } from './ledger.js';
import type { NoteKind } from './note.js';
import type { PlanRevisionRef } from './plan.js';
import type { PlatformDutyV1 } from './platform-duty.js';
import type { DependencyRequirement } from './plan.js';
import type { VerificationRoundRef } from './verification.js';
import { canonicalJson, sha256Hex, type JsonValue } from './fingerprint.js';

export type { PlatformDutyV1 };

export type ContextCallKindV1 = 'work' | 'continuation' | 'handoff' | 'review'
  | 'secretary' | 'copy' | 'planning' | 'attention';
export type ContextSectionNameV1 = 'role' | 'goal' | 'task' | 'footprint'
  | 'notes' | 'reminders' | 'inputs' | 'continuation' | 'unknown_call_review';
export type GraphNodeRefV1 =
  | { kind: 'goal'; ref: GoalRef }
  | { kind: 'stage'; planRef: PlanRevisionRef; stageId: string }
  | { kind: 'task'; ref: TaskTriple; planRef: PlanRevisionRef }
  | { kind: 'module'; ref: ModuleRef }
  | { kind: 'session'; ref: SessionRef }
  | { kind: 'run'; ref: RunRef }
  | { kind: 'round'; ref: VerificationRoundRef };
export type InputArtifactProvenanceV1 =
  | { kind: 'run'; owner: ArtifactOwnerRunRef }
  | PlatformMaterialOrigin;
export type ContextSourceV1 =
  | { kind: 'record'; ref: AggregateRef; revision: number; digest: string | null }
  | { kind: 'artifact'; ref: ArtifactRef; provenance: InputArtifactProvenanceV1 }
  | { kind: 'kernel_history'; runRef: RunRef; sessionRef: SessionRef;
      adapterId: string; kernelSessionId: string; kernelRunId: string; turnId: string;
      fromPosition: number; throughPosition: number }
  | { kind: 'note'; anchorKey: string; noteId: string; version: number; digest: string };
export type InputDeclarationV1 = {
  declarationId: string;
  consumer: TaskTriple;
  planRef: PlanRevisionRef;
  upstream: TaskTriple | null;
  requires: DependencyRequirement;
  legacyArtifactRef: ArtifactRef | null;
};
export type SelectedInputSourceV1 =
  | { kind: 'artifact'; ref: ArtifactRef; provenance: InputArtifactProvenanceV1 }
  | { kind: 'check'; ref: VerificationRoundRef; revision: number; checkId: string;
      reportRef: ArtifactRef | null }
  | { kind: 'environment'; ref: WorkspaceRef; revision: number }
  | { kind: 'decision'; ref: SessionMessageRef; revision: number;
      application: { ref: AggregateRef; revision: number }[] };
export type InputSelectionV1 = {
  declaration: InputDeclarationV1;
  state: 'selected' | 'missing' | 'ambiguous' | 'unavailable';
  source: SelectedInputSourceV1 | null;
  candidates: SelectedInputSourceV1[];
  usage: 'historical_explanation';
  reason: string | null;
  errorCode: CoreError | null;
};
export type ExtensionAvailabilityV1 = 'available' | 'not_implemented' | 'unavailable';
/**
 * Slice 4B L12/P3: the lookup's understanding status. 4C moved the declaration
 * here (it is a pure contracts DTO); `model/note-contracts.ts` re-exports it so
 * every existing import site keeps compiling. `updateDue` is `null` for the
 * project anchor (L20/§11.4), a boolean for goal/stage anchors.
 */
export type UnderstandingStatusV1 = { anchorKey: string;
  pointer: { noteId: string | null; revision: number | null };
  updateDue: boolean | null; latestTriggerCursor: string | null };
/** L20/U-10: one note index row the assembly renders; `label` is `renderNoteHeader`. */
export type NoteIndexRowV1 = { anchorKey: string; noteId: string; version: number; kind: NoteKind;
  conclusion: string; freshness: 'fresh' | 'stale' | 'unchecked'; label: string };
/**
 * §11.4: one understanding row (project, goal or stage); the project row carries
 * the whole body. `version` is the real NOTE version of the current
 * understanding (`null` when there is none — never the pointer revision);
 * `currentEligible` drives the conclusion/warning rule (L20). A row with no
 * current understanding has `version: null`, `currentEligible: false`,
 * `conclusion: null`, `body: null`.
 */
export type NotesUnderstandingRowV1 = { scope: 'project' | 'goal' | 'stage'; status: UnderstandingStatusV1;
  version: number | null; currentEligible: boolean; conclusion: string | null; body: string | null };
export type ContextIndexRowV1 = {
  key: string; node: GraphNodeRefV1; text: string; sources: ContextSourceV1[];
};
export type ContextExtensionsV1 = {
  notes: { availability: ExtensionAvailabilityV1;
    understanding: { rows: NotesUnderstandingRowV1[]; norms: NoteIndexRowV1[]; normsOmitted: number };
    general: NoteIndexRowV1[] };
  anomalies: { availability: ExtensionAvailabilityV1; rows: ContextIndexRowV1[] };
  footprint: { availability: ExtensionAvailabilityV1; rows: ContextIndexRowV1[] };
  goalSettings: { availability: ExtensionAvailabilityV1;
    autonomy: 'every_step' | 'after_plan_confirmation' | null };
  decisions: { availability: ExtensionAvailabilityV1; rows: ContextIndexRowV1[] };
};
export type ContextAssemblyBindingV1 = {
  schemaVersion: 1;
  formatVersion: 's3-context-v1';
  callKind: ContextCallKindV1;
  duty: PlatformDutyV1;
  residentBudgetBytes: number;
  residentBytes: number;
  totalBytes: number;
  sections: { name: ContextSectionNameV1; startByte: number | null; endByte: number | null;
    omitted: number }[];
  sources: ContextSourceV1[];
  inputSelections: InputSelectionV1[];
  extensions: { notes: ExtensionAvailabilityV1; anomalies: ExtensionAvailabilityV1;
    footprint: ExtensionAvailabilityV1; goalSettings: ExtensionAvailabilityV1;
    decisions: ExtensionAvailabilityV1 };
};
export type TaskInputPageRequestV1 = {
  consumer: TaskTriple; planRef: PlanRevisionRef; declarationId: string;
  candidateKey?: string; afterCursor: string | null; maxBytes: number;
};
export type TaskInputPageV1 = {
  selection: InputSelectionV1; body: string | null; nextCursor: string | null;
  selectedTaskInputs: { requirementId: string; ref: ArtifactRef }[];
};

// ------------------------------------------------------------------------ //
// Attention facts and changes (Host pure DTOs, §4.5)                         //
// ------------------------------------------------------------------------ //

export type GraphAttentionDetailV1 = {
  node: GraphNodeRefV1; name: string; summary: string; state: string | null;
  version: string; contentDigest: string; sources: ContextSourceV1[];
};
export type GraphAttentionFactsV1 = {
  nodes: string[]; edges: string[]; statuses: Record<string, string>;
  revision: string | undefined;
  details: Record<string, GraphAttentionDetailV1>;
};
export type AttentionGraphReadRequestV1 = {
  goalRef: GoalRef | null; planRef?: PlanRevisionRef; focusTaskIds: string[];
};
export type AttentionNodeChangeV1 = {
  key: string; change: 'added' | 'removed' | 'changed';
  beforeVersion: string | null; afterVersion: string | null;
  detail: GraphAttentionDetailV1;
};
export type AttentionChangesV1 = {
  scope: { projectId: string; workspaceId: string };
  goalRef: GoalRef | null;
  nodes: AttentionNodeChangeV1[];
  edges: { key: string; change: 'added' | 'removed' }[];
  revision: { before: string | null; after: string | null } | null;
  files: { path: string; version: string | null }[];
  heartbeat: { pendingInputs: number; messageCursor: string | null } | null;
  feedbackIds: string[];
};
export type GraphChangesV1 = Pick<AttentionChangesV1, 'nodes' | 'edges' | 'revision'>;

// ------------------------------------------------------------------------ //
// Wiring package 1 (G): the Goal-record content the Work Goal section shows. //
// ------------------------------------------------------------------------ //

/**
 * The Goal-record content the Work context's Goal section shows (decision 47
 * (2), wiring-1 §2.1, L2): exactly the fields the Goal section renders from the
 * Goal record itself. A new shown Goal-record field (I-4's autonomy first) must
 * be added here and `contentVersion` raised (L3); the entry compares the stored
 * digest, it does not interpret the version.
 */
export type GoalContextContentV1 = {
  contentVersion: 1;
  goalId: string;
  objective: string;
  workspaceId: string;
};

/** The current Goal-record content of one Goal (§2.1). Pure: no clock, no store. */
export function goalContextContentV1(
  goal: Pick<GoalSnapshot, 'ref' | 'objective' | 'workspaceRef'>,
): GoalContextContentV1 {
  return {
    contentVersion: 1,
    goalId: goal.ref.goalId,
    objective: goal.objective,
    workspaceId: goal.workspaceRef.workspaceId,
  };
}

/** The canonical digest of `goalContextContentV1(goal)` (§2.1). Pure. */
export function goalContextDigestV1(
  goal: Pick<GoalSnapshot, 'ref' | 'objective' | 'workspaceRef'>,
): string {
  return sha256Hex(canonicalJson(goalContextContentV1(goal) as unknown as JsonValue));
}
