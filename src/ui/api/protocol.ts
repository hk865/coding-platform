/** UI-side mirrors of the Host protocol constants. `R6-workbench.test.ts`
 * asserts they equal the Host values, so the browser never value-imports the
 * Host module. */
export const UI_PLATFORM_TOKEN_HEADER = 'x-platform-token';
export const UI_PLATFORM_TOKEN_META_NAME = 'platform-token';
export const UI_CORE_API_PREFIX = '/api/real/core/';
export const UI_BOOTSTRAP_SUFFIX = 'bootstrap';
/** Task E change stream (`GET`, text/event-stream) and its resume header;
 * `ui-live.test.ts` asserts they equal `CHANGES_SUFFIX` / `LAST_EVENT_ID_HEADER`. */
export const UI_CHANGES_SUFFIX = 'changes';
export const UI_LAST_EVENT_ID_HEADER = 'last-event-id';

export const SETTINGS_API_PREFIX = '/api/real/settings/';
