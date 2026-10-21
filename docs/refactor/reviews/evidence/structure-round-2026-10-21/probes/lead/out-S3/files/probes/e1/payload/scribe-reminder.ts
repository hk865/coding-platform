/**
 * Copy-only extraction of the scribe reminder expression (`host.ts:1434–1435`
 * in the base). The text is byte-for-byte the inline template; only its
 * construction moved into a function so both copies can record it and replay
 * it.
 */
function scribeReminderTextImpl(pendingCount: number, updateDueCount: number, anchorNames: Iterable<string>): string {
  return `${SCRIBE_REMINDER_MARKER}待审 ${String(pendingCount)} 条，该更新 ${String(updateDueCount)} 条。`
    + `锚点：${[...anchorNames].slice(0, 20).join('、')}`;
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
