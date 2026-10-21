/**
 * Copy-only extraction of the three row texts of
 * `src/core/work-graph/views/context-extensions.ts` (row 46). The texts are
 * byte-for-byte the inline templates; only their construction moved into
 * functions so both copies can record them and replay them.
 */
function decisionRowTextImpl(source: DecisionSourceV1): string {
  return `待决定：${source.kind}；source=${source.key}`;
}

function decisionRowText(source: DecisionSourceV1): string {
  const out = decisionRowTextImpl(source);
  probe('contextExtensions.decisionRow', [source], out);
  return out;
}

/** Replay/edge entry point: runs the same body without recording. */
export function probeDecisionRowText(source: DecisionSourceV1): string {
  return decisionRowTextImpl(source);
}

function notAvailableRowTextImpl(source: string): string {
  return `待决来源尚未接入：${source}`;
}

function notAvailableRowText(source: string): string {
  const out = notAvailableRowTextImpl(source);
  probe('contextExtensions.notAvailableRow', [source], out);
  return out;
}

/** Replay/edge entry point: runs the same body without recording. */
export function probeNotAvailableRowText(source: string): string {
  return notAvailableRowTextImpl(source);
}

function anchorText(anchor: SessionAnomalyAnchorV1): string {
  const out = anchorTextImpl(anchor);
  probe('contextExtensions.anomalyAnchor', [anchor], out);
  return out;
}

/** Replay/edge entry point: runs the same body without recording. */
export function probeAnchorText(anchor: SessionAnomalyAnchorV1): string {
  return anchorTextImpl(anchor);
}
