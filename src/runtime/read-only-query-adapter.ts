/**
 * P1-09 WorkerRuntime.ReadOnlyQueryPort — fake read-only query run adapter.
 * ENTRY FILE (stub — lane fills). Honest capability: supported=true,
 * maxQuestionBytes=4096, maxAnswerBytes=16384, readOnly:true.
 */
import type { QueryRunRef, ReadOnlyQueryPort, ReadOnlyQueryResultV1 } from "../contracts/query-job.js";

export class FakeReadOnlyQueryAdapter implements ReadOnlyQueryPort {
  capabilities(request: { runRef: QueryRunRef }): { supported: boolean; maxQuestionBytes: number; maxAnswerBytes: number; readOnly: true } {
    void request;
    return { supported: true, maxQuestionBytes: 4096, maxAnswerBytes: 16 * 1024, readOnly: true };
  }
  startQuery(request: { runRef: QueryRunRef; bundleRef: import("../contracts/artifact.js").ArtifactRef; question: string; budget: { maxTokens: number } }): Promise<ReadOnlyQueryResultV1> {
    void request;
    throw new Error("P1-09 lane: read-only query run not implemented yet");
  }
}
