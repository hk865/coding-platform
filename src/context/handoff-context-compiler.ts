/**
 * P1-06 ContextCompiler.HandoffContextPort implementation.
 *
 * ENTRY FILE (shared baseline - exported signature FROZEN; lane B fills the
 * implementation). See IMPLEMENTATION-HANDOFF "P1-06 契约与存储语义" item 3:
 *   - assemble validates the request, resolves the registered HandoffPacket,
 *     enforces CANONICAL source revision (mismatch -> explicit stale_packet,
 *     never silently reusing the old packet), material presence, scope/binding
 *     subset rules, budget + size caps (P1-03 rules), then assembles B's
 *     bounded TaskEnvelope whose fresh bundle is derived from the packet fields
 *     (objective/constraints/completed/unresolved/refs — NEVER a transcript)
 *     plus fresh plan/workspace material, stored body-first in the vault.
 */
import type { StateLedger } from "../contracts/ledger.js";
import type { ArtifactPort } from "../contracts/artifact.js";
import type {
  HandoffContextPort,
  HandoffContextRequestV1,
  HandoffContextResultV1,
} from "../contracts/handoff-context.js";

export type HandoffContextCompilerDeps = {
  ledger: StateLedger;
  vault: ArtifactPort;
  now: () => string;
};

export class HandoffContextCompilerImpl implements HandoffContextPort {
  constructor(private readonly deps: HandoffContextCompilerDeps) {}

  async assemble(request: HandoffContextRequestV1): Promise<HandoffContextResultV1> {
    void this.deps;
    void request;
    throw new Error("P1-06: HandoffContextCompilerImpl.assemble not implemented yet");
  }
}
