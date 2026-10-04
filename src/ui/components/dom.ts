/// <reference lib="dom" />
/** DOM helpers of the workbench: region mount, disclosure identity, focus and scroll snapshots, lens canvas swap. */

// ---------------------------------------------------------------------------
// Rendering (each region owns exactly one part of the workbench)
// views.ts owns the pure presentation; here we only mount it. The selected
// scope and every original request identity are retained, and no construction
// probe or internal exception is ever shown to the user.
// ---------------------------------------------------------------------------

export function setHtml(id: string, html: string): void {
  const element = document.getElementById(id);
  if (element !== null) element.innerHTML = html;
}

/** Stable display identity: adding a nested result must not shift sibling state. */
export function disclosureKey(detail: HTMLDetailsElement, boundary: HTMLElement): string {
  const path: string[] = [];
  let current: HTMLDetailsElement | null = detail;
  while (current !== null && boundary.contains(current)) {
    const summary = current.querySelector(':scope > summary')?.textContent?.trim() ?? '';
    // A record/terminal identity disambiguates sibling disclosures that share
    // the same summary text inside one activity group.
    const identity = current.dataset.disclosureKey ?? current.dataset.historyRaw ?? current.dataset.toolTerminal ?? '';
    const recordId = current.closest<HTMLElement>('[data-history]')?.dataset.history ?? '';
    path.unshift(identity.length > 0 ? identity : `${recordId}|${summary}`);
    current = current.parentElement?.closest('details') ?? null;
  }
  return JSON.stringify(path);
}

type FocusSnapshot = { field: string; start: number | null; end: number | null };

export function captureFocus(): FocusSnapshot | null {
  const element = document.activeElement;
  if (!(element instanceof HTMLInputElement || element instanceof HTMLTextAreaElement)) return null;
  const field = element.dataset.field;
  if (field === undefined) return null;
  return { field, start: element.selectionStart, end: element.selectionEnd };
}

export function restoreFocus(snapshot: FocusSnapshot | null): void {
  if (snapshot === null) return;
  const element = document.querySelector<HTMLInputElement | HTMLTextAreaElement>(`[data-field="${snapshot.field}"]`);
  if (element === null) return;
  element.focus();
  if (snapshot.start !== null && snapshot.end !== null) {
    try { element.setSelectionRange(snapshot.start, snapshot.end); } catch { /* not selectable */ }
  }
}

export function captureScroll(): Map<string, number> {
  const positions = new Map<string, number>();
  for (const element of document.querySelectorAll<HTMLElement>('[data-scroll]')) {
    const key = element.dataset.scroll ?? '';
    if (key === 'conversation') continue;
    positions.set(key, element.scrollTop);
  }
  return positions;
}

export function restoreScroll(positions: Map<string, number>): void {
  for (const [key, value] of positions) {
    if (key === 'conversation') continue;
    const element = document.querySelector<HTMLElement>(`[data-scroll="${key}"]`);
    if (element !== null) element.scrollTop = value;
  }
}

/** Keep the range input alive throughout a drag; only its rendered canvas changes. */
export function updateLensCanvas(regionId: string, html: string): void {
  const region = document.getElementById(regionId);
  if (region === null) return;
  const template = document.createElement('template');
  template.innerHTML = html;
  for (const selector of ['.q-graph', '.timeline-track']) {
    const current = region.querySelector(selector);
    const next = template.content.querySelector(selector);
    if (current !== null && next !== null) current.replaceWith(next);
  }
}
