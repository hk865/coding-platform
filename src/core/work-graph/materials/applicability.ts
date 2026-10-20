import type { ArtifactOwnerRunRef, ArtifactRef } from '../../../contracts/artifact.js';
import type { MaterialReader } from '../../../contracts/core/call-context.js';
import type { MaterialOrigin } from '../../record-store/body-ports.js';
import type { MaterialAuthorityReads } from './record-ports.js';
export type { MaterialAuthorityReads } from './record-ports.js';
import type { RunSnapshot } from '../../../contracts/dispatch.js';
import { sameArtifactOwnerRunRef } from '../../../contracts/material-access.js';
import { rejected } from '../../../contracts/core/rejections.js';

/** Host provenance and the Run reader's own-material rule live here. */
export type MaterialApplicability = {
  reader: MaterialReader;
  ref: ArtifactRef;
  origin: MaterialOrigin;
  /** undefined preserves legacy open's owner-only default semantics. */
  usage: 'current' | 'historical_explanation' | undefined;
};

type MaterialAdmission =
  | { status: 'allowed'; applicability?: 'current' | 'historical_explanation' }
  | { status: 'rejected'; code: 'forbidden' | 'source_stale' | 'unsupported'; reason: string };

export function createMaterialApplicability(deps: {
  authority: MaterialAuthorityReads;
}): (input: MaterialApplicability) => Promise<MaterialAdmission> {
  return async input => {
    const reader = input.reader;
    if (reader.kind === 'host') return hostAdmission(deps.authority, reader, input);
    return runAdmission(reader, input);
  };
}

async function hostAdmission(
  authority: MaterialAuthorityReads,
  reader: Extract<MaterialReader, { kind: 'host' }>,
  input: MaterialApplicability,
): Promise<MaterialAdmission> {
  if (input.usage === 'current') {
    return rejected('source_stale', 'a Host current read needs a verified source pin, which this batch has no trusted entry for');
  }
  if (input.usage !== 'historical_explanation') {
    return rejected('unsupported', 'a Host material read must be an explicit current or historical usage');
  }
  const origin = input.origin;
  // A platform operation records its own trusted scope at write time; a Host may
  // read it back directly without inventing a Run. A workspace-restricted Host
  // never crosses workspace, and material with no trusted workspace association
  // is unreadable for it.
  if (origin.kind === 'platform_operation') {
    if (origin.projectId !== reader.projectId) {
      return rejected('forbidden', 'the platform material belongs to another project');
    }
    if (reader.workspaceId !== undefined && reader.workspaceId !== origin.workspaceId) {
      return rejected('forbidden', 'the workspace-restricted Host cannot read platform material outside its workspace');
    }
    return { status: 'allowed', applicability: 'historical_explanation' };
  }
  const owner = origin.owner;
  const canonical = await authority.load(owner);
  if (canonical.status !== 'found') {
    return rejected('forbidden', 'the canonical material owner could not be loaded');
  }
  // Only the requested full canonical ref may vouch for a workspace: a load that
  // answers with a different ref is not the owner's scope.
  const canonicalRef = (canonical.snapshot as { ref?: ArtifactOwnerRunRef }).ref ?? null;
  if (!sameArtifactOwnerRunRef(canonicalRef, owner)) {
    return rejected('forbidden', 'the canonical owner load did not return the requested full ref');
  }
  const sourceWorkspaceId = owner.aggregateType === 'Run'
    ? (canonical.snapshot as RunSnapshot).workspaceSnapshot.workspaceId
    : owner.workspaceId;
  if (owner.projectId !== reader.projectId || (reader.workspaceId !== undefined && reader.workspaceId !== sourceWorkspaceId)) {
    return rejected('forbidden', 'the material owner is outside the trusted Host project/workspace scope');
  }
  return { status: 'allowed', applicability: 'historical_explanation' };
}

function runAdmission(
  reader: Extract<MaterialReader, { kind: 'run' }>,
  input: MaterialApplicability,
): MaterialAdmission {
  const requester = reader.requester;
  const owner = materialOwnerFromOrigin(input.origin);
  if (input.usage !== 'current' && sameArtifactOwnerRunRef(owner, requester)) {
    return input.usage === 'historical_explanation'
      ? { status: 'allowed', applicability: 'historical_explanation' }
      : { status: 'allowed' };
  }
  return rejected('forbidden', 'a Run reader may open only its own material, and not for current use');
}

/** The single provenance rule: a raw origin names a Run/QueryRun owner or nothing. */
export function materialOwnerFromOrigin(origin: MaterialOrigin): MaterialOwner {
  if (origin.kind === 'run') {
    return origin.owner;
  }
  return null;
}

/** The recorded Run/QueryRun owner of a material, or none. */
export type MaterialOwner = ArtifactOwnerRunRef | null;
