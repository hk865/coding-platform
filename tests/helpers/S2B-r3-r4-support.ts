/**
 * Slice 2B round-3 (R3/R4) support.
 *
 * R4 needs a Session in the same project but a DIFFERENT workspace. No accepted
 * fixture flow reaches that shape (every real Session is created in the Goal's
 * workspace), so this helper clones a real Session record at the storage
 * boundary and changes only its top-level `workspaceId`, in a shape today's
 * `SessionRecord@1` codec decodes. Runs that reference it are then built by the
 * accepted fixtures.
 */
import type { SessionRef } from '../../src/contracts/core/identity.js';
import { sessionAggregateRefKey } from '../../src/core/work-graph/sessions/session-record-codecs.js';
import type { B2ExecutionFixture } from './B2-execution-fixture.js';

type FixtureWithStore = {
  records: B2ExecutionFixture['base']['records'];
  b2: B2ExecutionFixture;
};

/** Clones `source` as `sessionId`, in `workspaceId` (same project). */
export async function cloneSessionInWorkspace(
  fixture: FixtureWithStore,
  source: SessionRef,
  sessionId: string,
  workspaceId: string,
): Promise<SessionRef> {
  const sourceRef = { aggregateType: 'Session' as const, projectId: source.projectId, sessionId: source.sessionId };
  const sourceKey = sessionAggregateRefKey(sourceRef);
  const read = await fixture.records.readMany([sourceKey]);
  if (read.status !== 'ready') throw new Error(`S2B round-3 session read failed: ${JSON.stringify(read)}`);
  const record = read.value.records.find((candidate) => candidate.refKey === sourceKey);
  if (record === undefined) throw new Error('S2B round-3 session clone source is missing');

  const body = JSON.parse(record.json) as Record<string, unknown>;
  const ref = { aggregateType: 'Session' as const, projectId: source.projectId, sessionId };
  body['ref'] = ref;
  body['workspaceId'] = workspaceId;
  body['revision'] = 1;
  const committed = await fixture.b2.base.commitRaw([
    { refKey: sessionAggregateRefKey(ref), schemaId: 'SessionRecord@1', revision: 1, json: JSON.stringify(body) },
  ]);
  if (committed.status !== 'committed') {
    throw new Error(`S2B round-3 session clone commit failed: ${JSON.stringify(committed)}`);
  }
  return { projectId: source.projectId, sessionId };
}
