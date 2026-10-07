import type { ArtifactOwnerRunRef, ArtifactRecord, ArtifactRef } from '../../../contracts/artifact.js';
import type { SourceRefV1 } from '../../../contracts/dispatch.js';
import type { CoreCallContext, PlatformMaterialOrigin } from '../../../contracts/core/call-context.js';
import type { CoreError, ReadResult } from '../../../contracts/core/results.js';

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
