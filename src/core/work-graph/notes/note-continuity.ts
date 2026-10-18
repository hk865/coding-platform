// Slice 4C RW-5 / §11.6 R4 / L23: the ONE pure stage-continuity decision.
// A stage anchor is retired for a non-file reason when the stage is absent from
// some adopted plan revision between the anchor's own revision and the current
// one.

export type StageContinuityV1 =
  | { status: 'continuous' }
  | { status: 'retired'; reason: 'stage_not_in_current_plan' }
  | { status: 'unchecked' };

/**
 * Decide continuity over the closed revision window `anchorRevision..
 * currentRevision`. A `null` current revision (the current plan could not be
 * read) or a future anchor revision is `unchecked`; a revision whose stages
 * could not be read (missing map key) is also `unchecked`; the first revision
 * that was read but lacks `stageId` retires the anchor.
 */
export function stageContinuityOf(input: {
  stageId: string;
  /** The note anchor's own `planRevision`. */
  anchorRevision: number;
  /** `null` = the current plan could not be read. */
  currentRevision: number | null;
  /** revision → stageIds; a missing key = that revision could not be read. */
  stagesByRevision: ReadonlyMap<number, readonly string[]>;
}): StageContinuityV1 {
  const { stageId, anchorRevision, currentRevision, stagesByRevision } = input;
  if (currentRevision === null || anchorRevision > currentRevision) return { status: 'unchecked' };
  for (let revision = anchorRevision; revision <= currentRevision; revision += 1) {
    const stages = stagesByRevision.get(revision);
    if (stages === undefined) return { status: 'unchecked' };
    if (!stages.some(stage => stage === stageId)) {
      return { status: 'retired', reason: 'stage_not_in_current_plan' };
    }
  }
  return { status: 'continuous' };
}
