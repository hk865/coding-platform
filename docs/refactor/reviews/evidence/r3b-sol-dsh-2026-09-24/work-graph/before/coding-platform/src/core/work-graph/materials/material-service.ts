import type { CoreCallContext } from '../../../contracts/core/call-context.js';
import type { ArtifactRecord, ArtifactRef } from '../../../contracts/artifact.js';
import type { ReadResult } from '../../../contracts/core/results.js';
import type { RawArtifactStorePort } from '../../record-store/body-ports.js';
import type { MaterialPort, MaterialWriteOrigin, StoreArtifactResult } from './contracts.js';
import type { MaterialAuthorityReads } from './applicability.js';
import type { MaterialAccessResolver } from '../../../contracts/material-access.js';
import type { SourceRefV1 } from '../../../contracts/dispatch.js';
import type { ArtifactPort, ArtifactPutRecord, ArtifactPutResult, ArtifactOpenQuery, ArtifactOpenResult } from '../../../contracts/artifact.js';

export type MaterialServiceDependencies = {
  bodies: RawArtifactStorePort;
  authority: MaterialAuthorityReads;
  grants: MaterialAccessResolver;
  now(): string;
};
export function createMaterialService(_deps: MaterialServiceDependencies): MaterialPort {
  return {
    async storeArtifact(_ctx: CoreCallContext, _input: {
      contentType: string; body: string; sources: SourceRefV1[]; origin: MaterialWriteOrigin;
    }): Promise<StoreArtifactResult> {
      throw new Error('R3b material store is not implemented');
    },
    async openArtifact(_ctx: CoreCallContext, _input: {
      ref: ArtifactRef; usage: 'current' | 'historical_explanation';
    }): Promise<ReadResult<ArtifactRecord>> {
      throw new Error('R3b material open is not implemented');
    },
  };
}

/** Legacy caller wire: no synthetic work_run principal or role binding. The implementation
 * must share MaterialService's private body and authorization primitives. */
export function createLegacyArtifactPort(_deps: MaterialServiceDependencies): ArtifactPort {
  return {
    async put(_record: ArtifactPutRecord): Promise<ArtifactPutResult> {
      throw new Error('R3b legacy artifact put adapter is not implemented');
    },
    async open(_ref: ArtifactRef, _query: ArtifactOpenQuery): Promise<ArtifactOpenResult> {
      throw new Error('R3b legacy artifact open adapter is not implemented');
    },
  };
}
