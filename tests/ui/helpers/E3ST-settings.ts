/**
 * The settings page's shared test steps (7D2 batch 2): the block/field lookups
 * the three settings files and the rewritten old file need, and the one held
 * settings write. No second copy lives in the test files.
 */
import { bootPage, findAllClass, findClass, findElement } from './boot-page.js';
import type { FakeElement } from './dom.js';
import {
  forwardPage, gateChanges, newPageLog, textOf, type E3NTarget, type PageLog,
} from './E3N-page.js';

/** The `.blk` whose `.blk-name` text is `name`. */
export function blockOf(root: FakeElement, name: string): FakeElement | undefined {
  return findAllClass(root, 'blk').find((block) => textOf(findClass(block, 'blk-name')).trim() === name);
}

/** The input whose `aria-label` is `label`, inside `root`. */
export function fieldIn(root: FakeElement, label: string): FakeElement | undefined {
  return findElement(root, (element) => element.tagName.toLowerCase() === 'input'
    && (element.getAttribute('aria-label') ?? '') === label);
}

/** Types into a text field the way the page listens (`change` maps to `input`). */
export function typeField(field: FakeElement, value: string): void {
  field.value = value;
  field.dispatch('input', { target: field, currentTarget: field });
}

/** One real checkbox change: flip the property, then dispatch the event the page listens to. */
export function setBox(box: FakeElement, checked: boolean): void {
  box.checked = checked;
  box.dispatch('change', { target: box, currentTarget: box });
}

/** Boot Settings with the `holdAt`-th (default first) settings-route answer
 *  replaced by `answer` after the real Host handled it, so the Host's own
 *  snapshot holds the new value; earlier calls forward normally. */
export async function heldSettingsPage(
  target: E3NTarget, search: string, route: string, answer: unknown, holdAt = 1,
): Promise<{ page: Awaited<ReturnType<typeof bootPage>>; log: PageLog }> {
  const log = newPageLog();
  gateChanges(log);
  const forward = forwardPage(target, log, 'stream');
  let seen = 0;
  const page = await bootPage({
    name: 'Settings', search,
    token: () => target.token,
    request: async (url, init, realFetch) => {
      const sent = await forward(url, init, realFetch);
      if (url.endsWith('/api/real/settings/' + route)) {
        seen += 1;
        if (seen === holdAt) {
          return new Response(JSON.stringify(answer), {
            status: 200, headers: { 'content-type': 'application/json' },
          });
        }
      }
      return sent;
    },
  });
  return { page, log };
}
