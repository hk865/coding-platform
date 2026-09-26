import type { ArtifactOwnerRunRef, ArtifactRef } from '../../../contracts/artifact.js';
import type { MaterialReader } from '../../../contracts/core/call-context.js';
import type { MaterialAccessResolver } from '../../../contracts/material-access.js';
import type { SourceApplicabilityPort } from '../../../contracts/material-access.js';
import type { ReadModelIndex } from '../../../contracts/goal-view.js';
import type { MaterialOrigin } from '../../record-store/body-ports.js';

/** Exact material, current basis, revocation, source pin and Host provenance policy live here. */
export type MaterialAuthorityReads = {
  load: import('../../../contracts/ledger.js').StateLedger['load'];
};
export type MaterialApplicability = {
  reader: MaterialReader;
  ref: ArtifactRef;
  origin: MaterialOrigin;
  /** undefined preserves legacy open's owner-only default semantics. */
  usage: 'current' | 'historical_explanation' | undefined;
};
export function createMaterialApplicability(_deps: {
  authority: MaterialAuthorityReads;
  grants: MaterialAccessResolver;
}): (input: MaterialApplicability) => Promise<
  { status: 'allowed'; applicability?: 'current' | 'historical_explanation' }
  | { status: 'rejected'; code: 'forbidden' | 'source_stale' | 'unsupported'; reason: string }
> {
  throw new Error('R3b material applicability is not implemented');
}
/** Legacy resolver will re-export the moved implementation after migration. */
export type MaterialOwner = ArtifactOwnerRunRef | null;
export function createMaterialAccessResolver(
  _authority: MaterialAuthorityReads,
  _index: Pick<ReadModelIndex, 'materialAccessCandidates'>,
  _sourceApplicability?: SourceApplicabilityPort,
): MaterialAccessResolver {
  throw new Error('R3b canonical material resolver is not implemented');
}
