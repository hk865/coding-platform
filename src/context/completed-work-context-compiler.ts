/**
 * P1-17 ContextCompiler.CompletedWorkContextPort — applicability-annotated
 * selection of COMPLETED work for a related new task.
 *
 * ENTRY FILE (shared baseline — exported signature FROZEN; lane fills the
 * implementation). Frozen semantics (HANDOFF "P1-17 契约与存储语义" items 1-8):
 * selection ONLY of persisted facts (P1-16 bindings/notes via the work-context
 * view + P1-05 completion facts); NO new aggregate/event; NO MemoryStore; no
 * writes to Task/Goal/Evidence state; cross-scope / missing records / stale
 * versions / over-budget / permission are EXPLICIT gaps; old authorization,
 * old Task phase and old Evidence validity are NEVER inherited.
 */
import type { CompletedWorkContextPort, CompletedWorkContextRequestV1, CompletedWorkContextResultV1 } from "../contracts/completed-work-context.js";
import type { StateLedger } from "../contracts/ledger.js";
import type { ArtifactPort } from "../contracts/artifact.js";
import type { ReadModelIndex } from "../contracts/goal-view.js";

export type CompletedWorkCompilerDeps = {
  ledger: StateLedger;
  vault: ArtifactPort;
  readModel: ReadModelIndex;
  now: () => string;
};

export class CompletedWorkContextCompilerImpl implements CompletedWorkContextPort {
  private readonly deps: CompletedWorkCompilerDeps;

  constructor(deps: CompletedWorkCompilerDeps) {
    this.deps = deps;
  }

  assembleCompletedWorkContext(request: CompletedWorkContextRequestV1): Promise<CompletedWorkContextResultV1> {
    void request;
    throw new Error("P1-17 lane A/B: completed-work selection not implemented yet");
  }
}
