/**
 * B2 shared Prepared contract (skeleton).
 *
 * The bounded JSON manifest is stored as one content-addressed Artifact body;
 * `envelope.bundleRef` is its ONLY reference. The manifest does not embed its own
 * ArtifactRef/digest (that would be a circular summary). `input` is the exact
 * string handed to the Kernel; `inputDigest = sha256(UTF8(input))`, matching the
 * existing `contextInputDigest`. `manifestDigest` is the body digest of the
 * SAVED bytes, never a re-serialization of the parsed object.
 *
 * A declaration inside the manifest is never automatically trusted: WorkGraph
 * re-reads the current formal facts and the trusted Host configuration.
 */
import type { ArtifactRef } from '../artifact.js';
import type {
  RoleBindingRefV1, RuntimeInputBindingV1, SourceRefV1, TaskBudgetV1,
  ModelRequestMaterialPinV1,
} from '../dispatch.js';
import type { MaterialAccessGrantRef, MaterialBasisV1 } from '../material-access.js';
import type { RoleSpecResolutionV1 } from '../role-spec-materials.js';
import type { TaskEnvelopeV1 } from '../task-envelope.js';
import type { RoleConfigurationRef, SessionRef } from './identity.js';
import type { QueryRunRef } from '../query-job.js';
import type { GoalSnapshot, WorkspaceSnapshot } from '../ledger.js';
import type { PlanRevisionSnapshot } from '../plan.js';
import type { RuntimeBudget } from '../runtime-budget.js';
import type { TaskClaim } from './task-claim.js';

export type PreparedTaskManifestV1 = {
  schemaVersion: 1;
  kind: 'task_execution';
  claim: TaskClaim;
  /** resolved / absent / inadmissible are preserved as real results. */
  role: RoleSpecResolutionV1;
  /** absent compatibility may only come from a trusted Host versioned template. */
  hostTemplate: { templateId: string; revision: string; digest: string } | null;
  roleBinding: RoleBindingRefV1;
  hostConfigurationRevision: string;
  sessionRole: RoleConfigurationRef;
  workspaceSnapshot: { workspaceId: string; revision: number };
  permissions: TaskEnvelopeV1['permissions'];
  budget: TaskBudgetV1;
  selectedTaskInputs: Array<{ requirementId: string; ref: ArtifactRef }>;
  /** Source pin verified by the trusted Host; never model-supplied or guessed. */
  materialBasis: MaterialBasisV1 | null;
  materialAccessRefs: MaterialAccessGrantRef[];
  additionalMaterialRefs: ArtifactRef[];
  deliveryRefs: ModelRequestMaterialPinV1[];
  sourceRefs: SourceRefV1[];
  input: string;
  inputDigest: string;
};

export type PreparedTaskExecution = {
  kind: 'task';
  claim: TaskClaim;
  envelope: TaskEnvelopeV1;
  inputBinding: RuntimeInputBindingV1;
};

/**
 * R5b.2 bounded Query execution manifest. Its ONLY reference is the saved body's
 * ArtifactRef; it never embeds its own ref/digest. `input` is the exact string
 * handed to the Kernel and `inputDigest = sha256(UTF8(input))`; the saved-body
 * digest is the ArtifactRef.digest. Every declaration below is re-checked by
 * WorkGraph against the current formal facts and the trusted Host configuration.
 */
export type PreparedQueryManifestV1 = {
  schemaVersion: 1;
  kind: 'query_execution';
  queryRunRef: QueryRunRef;
  sessionRef: SessionRef;
  sessionGeneration: number;
  roleBinding: RoleBindingRefV1;
  sessionRole: RoleConfigurationRef;
  role: Exclude<RoleSpecResolutionV1, { status: 'inadmissible' }>;
  hostTemplate: { templateId: string; revision: string; digest: string } | null;
  hostConfigurationRevision: string;
  goal: { ref: GoalSnapshot['ref']; revision: number };
  workspace: { ref: WorkspaceSnapshot['ref']; revision: number };
  focusPlan: { ref: PlanRevisionSnapshot['ref']; revision: number } | null;
  permissions: { tools: string[]; writeScope: [] };
  runtimeBudget: RuntimeBudget;
  budget: { tokenBudget: number | null; deadline: string | null };
  sourceRefs: SourceRefV1[];
  /**
   * The formal isolated derivation of this Query: the source Kernel Session and
   * its fixed completed boundary. `throughPosition: null` is the explicit empty
   * baseline (the source had no completed turn). Absent keeps the legacy target
   * Session history behavior.
   */
  sessionBasis?: { sourceKernelSessionId: string; throughPosition: number | null };
  input: string;
  inputDigest: string;
};

/** The three verifiable references a prepared Query carries back to Runtime. */
export type PreparedQueryExecution = {
  queryRunRef: QueryRunRef;
  bundleRef: ArtifactRef;
  inputDigest: string;
};
