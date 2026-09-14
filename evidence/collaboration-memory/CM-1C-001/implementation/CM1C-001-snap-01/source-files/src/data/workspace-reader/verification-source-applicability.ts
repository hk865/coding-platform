import { canonicalJson, sha256Hex } from '../../contracts/fingerprint.js';
import type { SourceApplicabilityPort } from '../../contracts/material-access.js';
import type { VerificationRoundSourcePort } from '../../contracts/verification-context.js';
import { VerificationWorkspaceReader } from './verification-workspace-reader.js';

/** Candidate byte identity and explicit comparison proof, never exploration's full-tree hash. */
export class VerificationSourceApplicability implements SourceApplicabilityPort {
  constructor(private readonly rootFor: (projectId: string, workspaceId: string) => string,
    private readonly reader: VerificationRoundSourcePort = new VerificationWorkspaceReader()) {}
  async capture(query: Parameters<SourceApplicabilityPort['capture']>[0], signal?: AbortSignal): ReturnType<SourceApplicabilityPort['capture']> {
    if (query.sourceSet?.kind !== 'verification_workspace' || query.sourceSet.paths.length !== 1 || query.sourceSet.paths[0] !== '.') return { status: 'rejected', issues: ['verification requires its complete Candidate workspace source set'] };
    try {
      signal?.throwIfAborted();
      const root = this.rootFor(query.projectId, query.workspaceId);
      const source = await this.reader.capture(root);
      signal?.throwIfAborted();
      if (source.status !== 'ready') return { status: source.status === 'rejected' ? 'stale' : 'unavailable', issues: source.status === 'rejected' ? source.issues.map(i => i.message) : source.missing };
      return { status: 'sourced', pin: {
        schemaVersion: 1, projectId: query.projectId, workspaceId: query.workspaceId,
        sourceSet: { kind: 'verification_workspace', paths: ['.'] },
        identity: { workspace: 'verification-source-v1:' + root, commit: source.sourceProof.kind === 'git-head-worktree' ? source.sourceProof.baseCommit : null },
        manifestDigest: sha256Hex(canonicalJson({ sourceDigest: source.sourceDigest, sourceProof: source.sourceProof })),
      } };
    } catch (error) { return { status: 'unavailable', issues: [error instanceof Error ? error.message : 'Verification source is unavailable'] }; }
  }
}
