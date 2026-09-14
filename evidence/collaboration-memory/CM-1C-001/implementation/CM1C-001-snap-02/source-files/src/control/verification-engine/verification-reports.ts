import type { ArtifactPort, ArtifactRef } from '../../contracts/artifact.js';
import type { VerificationScope as Scope, VerificationAttempt } from '../../contracts/verification-import.js';
import { canonicalJson } from '../../contracts/fingerprint.js';
import { digest, ensure, vScope } from './verification-input.js';
export class VerificationReports {
  constructor(private readonly vault: Pick<ArtifactPort, 'put'>) { }
  async artifact(body: string, scope: Scope, at: string): Promise<ArtifactRef> {
    const ref = {
      aggregateType: 'Run' as const,
      projectId: scope.projectId,
      goalId: scope.goalId,
      runId: scope.runId
    };
    const stored = await this.vault.put({
      body,
      contentType: 'text/plain',
      ownerRef: ref,
      sourceRefs: [{ kind: 'artifact', refId: digest(body), revision: '1', digest: digest(body) }],
      requestedAt: at
    });
    ensure(stored.status === 'stored', '验收材料无法保存');
    return stored.ref;
  }
  async reportArtifacts(a: VerificationAttempt): Promise<ArtifactRef> {
    // Full reports may exceed the vault's per-body cap; retain every byte in immutable chunks.
    const chunks: ArtifactRef[] = [];
    for (let pos = 0; pos < a.reportBody.length; pos += 24000)
      chunks.push(await this.artifact(a.reportBody.slice(pos, pos + 24000), a, a.importedAt));
    return this.artifact(
      canonicalJson({
        scope: vScope(a),
        candidateId: a.candidateId,
        candidateDigest: a.candidateDigest,
        workspaceRevision: a.workspaceRevision,
        source: a.source,
        verdict: a.verdict,
        counts: a.counts,
        startedAt: a.startedAt,
        completedAt: a.completedAt,
        chunks
      }),
      a,
      a.importedAt
    );
  }
}
