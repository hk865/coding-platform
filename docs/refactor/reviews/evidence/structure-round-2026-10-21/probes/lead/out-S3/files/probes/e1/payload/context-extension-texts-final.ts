/**
 * Copy-only extraction of the three row texts of
 * `src/core/work-graph/views/context-extensions.ts` in the S3 result tree
 * (row 46). The inline templates became `PLATFORM_PROMPT_PACK_V1.strings`
 * lookups; these functions build exactly the same texts.
 */
function decisionRowTextImpl(source: DecisionSourceV1): string {
  return `${PLATFORM_PROMPT_PACK_V1.strings['contextExtension.decisionPrefix']}${source.kind}`
    + `${PLATFORM_PROMPT_PACK_V1.strings['contextExtension.sourceSeparator']}${source.key}`;
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
  return `${PLATFORM_PROMPT_PACK_V1.strings['contextExtension.unavailablePrefix']}${source}`;
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
