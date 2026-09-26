import type { ArtifactOwnerRunRef, ArtifactRecord, ArtifactRef } from '../../../contracts/artifact.js';
import type { SourceRefV1 } from '../../../contracts/dispatch.js';
import type { CoreCallContext, PlatformMaterialOrigin } from '../../../contracts/core/call-context.js';
import type { CoreError, ReadResult } from '../../../contracts/core/results.js';
import type { RecordGuard } from '../../record-store/ports.js';

/** R3b publishes only the two material operations actually being migrated. */
export type MaterialWriteOrigin = { kind: 'execution'; ref: ArtifactOwnerRunRef } | PlatformMaterialOrigin;
export type StoreArtifactResult =
  | { status: 'stored'; ref: ArtifactRef; replayed: boolean }
  | { status: 'rejected'; code: CoreError | 'size_exceeded' | 'missing_source'; reason: string };
export interface MaterialPort {
  storeArtifact(ctx: CoreCallContext, input: {
    contentType: string; body: string; sources: SourceRefV1[]; origin: MaterialWriteOrigin;
  }): Promise<StoreArtifactResult>;
  openArtifact(ctx: CoreCallContext, input: {
    ref: ArtifactRef; usage: 'current' | 'historical_explanation';
  }): Promise<ReadResult<ArtifactRecord>>;
}

/** Internal WorkGraph seam. A fresh material read and the exact canonical
 * versions that decision observed travel together (the RoleBindingFacts
 * pattern), so a B2 barrier can CAS that same window instead of substituting a
 * version read afterwards. `RecordGuard` is imported from the RecordStore ports
 * and is deliberately not republished in shared contracts. The port exposes a
 * read only: no tracking object, no raw body and no caller-supplied guards. */
export type MaterialReadFacts = {
  result: ReadResult<ArtifactRecord>;
  guards: readonly RecordGuard[];
};
export interface MaterialReadFactsPort {
  openArtifactFacts(
    ctx: CoreCallContext,
    input: Parameters<MaterialPort['openArtifact']>[1],
  ): Promise<MaterialReadFacts>;
}
