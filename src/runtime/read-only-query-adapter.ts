/** P1-09 WorkerRuntime.ReadOnlyQueryPort — fake read-only query run. */
import type { QueryRunRef, ReadOnlyQueryPort, ReadOnlyQueryResultV1 } from "../contracts/query-job.js";

export class FakeReadOnlyQueryAdapter implements ReadOnlyQueryPort {
  capabilities(request: { runRef: QueryRunRef }): { supported: boolean; maxQuestionBytes: number; maxAnswerBytes: number; readOnly: true } {
    void request;
    return { supported: true, maxQuestionBytes: 4096, maxAnswerBytes: 16 * 1024, readOnly: true };
  }
  async startQuery(request: { runRef: QueryRunRef; bundleRef: import("../contracts/artifact.js").ArtifactRef; question: string; budget: { maxTokens: number } }): Promise<ReadOnlyQueryResultV1> {
    if (request.budget.maxTokens <= 0) return { schemaVersion: 1, runRef: request.runRef, outcome: "failed", answer: null, sources: [], message: "budget exhausted before the run", endedAt: "2026-09-06T00:00:00.000Z" };
    return {
      schemaVersion: 1, runRef: request.runRef, outcome: "answered",
      answer: "有限来源的答案（引用 bundle 中选择任务；无隐藏思维链）",
      sources: [{ kind: "artifact", refKey: request.bundleRef.digest, version: "1" }], message: null,
      endedAt: "2026-09-06T00:00:00.000Z",
    };
  }
}
