/**
 * The one drawing of a control whose backend is not connected (121-34,
 * E3-NAV §2.12): it keeps the prototype element, class and position, gets the
 * existing `.btn.is-off` grey-out plus `title` and `aria-disabled`, and its
 * click sends nothing. `disabled` is deliberately not used: `kit.css:158`'s
 * `pointer-events: none` would swallow the hover text.
 */

export const NOT_CONNECTED_TEXT = '还没接通';

/** The attributes a not-connected control carries. `class` holds only the
 * existing `is-off`; a page appends it to the element's own class. */
export function notConnectedAttrs(): { class: string; title: string; 'aria-disabled': string } {
  return { class: 'is-off', title: NOT_CONNECTED_TEXT, 'aria-disabled': 'true' };
}

type GuardableEvent = { preventDefault(): void; stopPropagation(): void };

/** The real block: the two attributes are semantics, this is what keeps the
 * request from leaving. A click guard always runs these three steps. */
export function guardNotConnected(event: GuardableEvent): void {
  event.preventDefault();
  event.stopPropagation();
}
