/**
 * P1-12 ArchitectureReconciler — inspect(intent) pipeline (InspectionPort).
 *
 * ENTRY FILE (shared baseline — exported signature FROZEN; lane A fills the
 * implementation). Frozen semantics: the ONLY baseline input is the
 * PlanRevision pin (invariant #12); pin missing / dangling / digest mismatch
 * -> fail_closed with diagnostics, NO pseudo Delta/Finding; the raw Delta is
 * the deterministic computeArchitectureDelta of the pre/post code graph;
 * a REPORT-source inspection records finding candidates WITHOUT fabricating a
 * raw Delta; findings/briefs/proposals are recorded through ControlEngine
 * commands (this ticket); NO baseline writes, NO remediation/gate/activation
 * side effects.
 */
import type { ArchitectureInspectionIntentV1, ArchitectureInspectionOutcome } from "../contracts/architecture-inspection.js";
import type { InspectionPort, InspectResultV1 } from "../contracts/architecture-reconciler.js";
import type { WorkspaceReadPort } from "../contracts/workspace-read.js";
import type { CodeGraphPort } from "../contracts/architecture-reconciler.js";
import type { StateLedger } from "../contracts/ledger.js";
import type { ArtifactPort } from "../contracts/artifact.js";
import type { ControlEngine } from "../contracts/modules.js";

export type ArchitectureReconcilerDeps = {
  ledger: StateLedger;
  vault: ArtifactPort;
  control: ControlEngine;
  workspaceReader: WorkspaceReadPort;
  codeGraph: CodeGraphPort;
  now: () => string;
  eventId: () => string;
};

export class ArchitectureReconcilerImpl implements InspectionPort {
  private readonly deps: ArchitectureReconcilerDeps;

  constructor(deps: ArchitectureReconcilerDeps) {
    this.deps = deps;
  }

  inspect(intent: ArchitectureInspectionIntentV1): Promise<InspectResultV1> {
    throw new Error("P1-12 lane A: inspect pipeline not implemented yet");
  }
}

export type { ArchitectureInspectionOutcome };
