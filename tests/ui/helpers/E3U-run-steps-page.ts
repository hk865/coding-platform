import { expect } from 'vitest';
import { findClass } from './boot-page.js';
import { click } from './E3N-interact.js';
import { descendants, hasClass, textOf, waitFor } from './E3N-page.js';
import type { FakeElement } from './dom.js';

/**
 * The Run block's steps on the page (`Main`'s conversation or line view,
 * `Plan`'s conversation, `Member`'s records): the row is `button.run`; its
 * expanded `.steps` holds one `.step` per projection (`src/ui/adapters/run-steps.ts`).
 * The caller names the thread element it drives. No route is read here.
 */

/** The Run rows of `scope`, in document order. */
export function runRows(scope: FakeElement): FakeElement[] {
  return descendants(scope).filter((element) => element.tagName.toLowerCase() === 'button' && hasClass(element, 'run'));
}

/** The rows of the first expanded `.steps` under `scope`. */
export function stepRows(scope: FakeElement): FakeElement[] {
  const box = findClass(scope, 'steps');
  return box === undefined ? [] : descendants(box).filter((element) => hasClass(element, 'step'));
}

/** Clicks the `index`th Run row and waits for its steps; the row is returned. */
export async function openRun(scope: FakeElement, index = 0): Promise<FakeElement> {
  const row = runRows(scope)[index];
  expect(row, `the ${index}th button.run`).toBeDefined();
  if (row!.getAttribute('aria-expanded') !== 'true') click(row!);
  await waitFor(() => stepRows(scope).length > 0);
  return row!;
}

/** The `.step-verb` values in order (`[]` for a step that draws no verb). */
export function stepVerbs(scope: FakeElement): string[] {
  return stepRows(scope).map((step) => textOf(findClass(step, 'step-verb')));
}

/** The step whose `.step-verb` is `verb`, or undefined. */
export function stepOfVerb(scope: FakeElement, verb: string): FakeElement | undefined {
  return stepRows(scope).find((step) => textOf(findClass(step, 'step-verb')) === verb);
}

/** The `.step-obj` text of `step`. */
export function stepObject(step: FakeElement): string {
  return textOf(findClass(step, 'step-obj'));
}

/** The `.step-meta` text of `step` ('' when it draws none). */
export function stepMeta(step: FakeElement): string {
  return textOf(findClass(step, 'step-meta'));
}

/** The `button.step-obj.is-path` elements a read/edit step draws, in order. */
export function stepPathButtons(scope: FakeElement): FakeElement[] {
  return stepRows(scope).flatMap((step) => descendants(step).filter((element) =>
    element.tagName.toLowerCase() === 'button' && hasClass(element, 'step-obj') && hasClass(element, 'is-path')));
}
