import { expect } from 'vitest';
import type { FakeElement } from './dom.js';

/**
 * E3W interaction base (HANDOFF 121-29): the one fake-DOM event helper the
 * navigation rows use. Every helper dispatches a real listener call on the
 * mounted element; nothing here reads the board's internal state.
 */

type Init = Record<string, unknown>;

const eventOf = (target: FakeElement, init: Init = {}): Init => ({
  target, currentTarget: target, button: 0, preventDefault(): void {}, stopPropagation(): void {}, ...init,
});

export function click(element: FakeElement, init: Init = {}): void {
  element.dispatch('click', eventOf(element, init));
}

export function doubleClick(element: FakeElement): void {
  element.dispatch('dblclick', eventOf(element));
}

/** The native right-click event; a board that binds it would be changing the page. */
export function rightClick(element: FakeElement): void {
  element.dispatch('contextmenu', eventOf(element, { button: 2 }));
}

export function focus(element: FakeElement): void {
  element.dispatch('focus', eventOf(element));
}

export function hover(element: FakeElement): void {
  element.dispatch('mouseenter', eventOf(element));
}

export function leave(element: FakeElement): void {
  element.dispatch('mouseleave', eventOf(element));
}

export function wheel(element: FakeElement, deltaY: number): void {
  element.dispatch('wheel', eventOf(element, { deltaY, deltaX: 0 }));
}

export function pressKey(element: FakeElement, name: string, extra: Init = {}): void {
  element.dispatch('keydown', eventOf(element, { key: name, ...extra }));
}

/** A key press on a native button: the key event, then the click the browser would send. */
export function pressEnter(element: FakeElement): void {
  pressKey(element, 'Enter');
  click(element);
}

export function pointerDown(element: FakeElement, clientX: number): void {
  element.dispatch('pointerdown', eventOf(element, { clientX, pointerId: 1 }));
}

export function pointerMove(element: FakeElement, clientX: number): void {
  element.dispatch('pointermove', eventOf(element, { clientX, pointerId: 1 }));
}

export function pointerUp(element: FakeElement, clientX: number): void {
  element.dispatch('pointerup', eventOf(element, { clientX, pointerId: 1 }));
}

/** One pointer drag on a split handle; `from` and `to` are the client X positions. */
export function drag(element: FakeElement, from: number, to: number, steps = 1): void {
  element.dispatch('pointerdown', eventOf(element, { clientX: from, pointerId: 1 }));
  for (let step = 1; step <= steps; step += 1) {
    element.dispatch('pointermove', eventOf(element, { clientX: from + (to - from) * step / steps, pointerId: 1 }));
  }
  element.dispatch('pointerup', eventOf(element, { clientX: to, pointerId: 1 }));
}

export const NOT_CONNECTED = '未接通';

/**
 * HANDOFF 121-34 / lead 11-07 18:1x: an unconnected control keeps its prototype
 * place, is drawn disabled, says so on hover and swallows the click. The four
 * assertions live here only; every row that meets such a control calls this.
 */
export function notConnected(element: FakeElement): string {
  expect((element.getAttribute('class') ?? '').split(/\s+/)).toContain('is-off');
  expect(element.getAttribute('title')).toBe('还没接通');
  expect(element.getAttribute('aria-disabled')).toBe('true');
  let prevented = false;
  let stopped = false;
  element.dispatch('click', eventOf(element, {
    preventDefault(): void { prevented = true; },
    stopPropagation(): void { stopped = true; },
  }));
  expect(prevented).toBe(true);
  expect(stopped).toBe(true);
  return NOT_CONNECTED;
}
