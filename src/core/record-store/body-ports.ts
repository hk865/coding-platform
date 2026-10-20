import type { ArtifactOwnerRunRef, ArtifactRef } from '../../contracts/artifact.js';
import type { SourceRefV1 } from '../../contracts/dispatch.js';
import type { PlatformMaterialOrigin } from '../../contracts/core/call-context.js';
import type { StoreResult } from './ports.js';

/** The physical store records provenance but never interprets material grants. */
export type MaterialOrigin =
  | { kind: 'run'; owner: ArtifactOwnerRunRef }
  | PlatformMaterialOrigin;
export type RawArtifactPut = {
  body: string;
  contentType: string;
  sourceRefs: SourceRefV1[];
  origin: MaterialOrigin;
  requestedAt: string;
};
export type RawArtifactRecord = {
  ref: ArtifactRef;
  body: string;
  sourceRefs: SourceRefV1[];
  origin: MaterialOrigin;
};
export interface RawArtifactStorePort {
  put(input: RawArtifactPut): Promise<StoreResult<{ ref: ArtifactRef; replayed: boolean }>>;
  read(ref: ArtifactRef): Promise<StoreResult<RawArtifactRecord>>;
}
