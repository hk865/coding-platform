/**
 * Copy-only extraction of the scribe reminder expression in the S3 result tree
 * (`host.ts:1437–1443`). The inline call became a `renderTemplate` call; this
 * function builds exactly the same slot values and returns the same `.text`.
 */
function scribeReminderTextImpl(pendingCount: number, updateDueCount: number, anchorNames: Iterable<string>): string {
  return renderTemplate(PLATFORM_PROMPT_PACK_V1, 'scribe-reminder', {
    marker: SCRIBE_REMINDER_MARKER,
    pendingCount: String(pendingCount),
    updateDueCount: String(updateDueCount),
    anchors: [...anchorNames].slice(0, 20).join('、'),
  }, []).text;
}

function scribeReminderText(pendingCount: number, updateDueCount: number, anchorNames: Iterable<string>): string {
  const out = scribeReminderTextImpl(pendingCount, updateDueCount, anchorNames);
  probe('scribe.reminder', [pendingCount, updateDueCount, [...anchorNames]], out);
  return out;
}

/** Replay/edge entry point: runs the same body without recording. */
export function probeScribeReminderText(
  pendingCount: number, updateDueCount: number, anchorNames: readonly string[],
): string {
  return scribeReminderTextImpl(pendingCount, updateDueCount, anchorNames);
}
