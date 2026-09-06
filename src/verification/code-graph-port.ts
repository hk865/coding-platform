/**
 * P1-12 VerificationEngine.CodeGraphPort — deterministic registry-backed graph
 * capability seam.
 *
 * ENTRY FILE (shared baseline — exported signature FROZEN; lane A fills the
 * implementation). The engine answers graph availability for a workspace
 * revision (fixture registry / configured graph sources); unsupported/stale
 * are explicit. The deterministic DIFF itself is the pure
 * computeArchitectureDelta function in the contracts — always reproducible.
 */
import type { CodeGraphPort, CodeGraphQueryV1, CodeGraphResultV1 } from "../contracts/architecture-reconciler.js";

export class CodeGraphPortImpl implements CodeGraphPort {
  codeGraph(query: CodeGraphQueryV1): Promise<CodeGraphResultV1> {
    void query;
    throw new Error("P1-12 lane A: code-graph port not implemented yet");
  }
}
