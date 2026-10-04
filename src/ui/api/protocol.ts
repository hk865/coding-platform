/** UI-side mirrors of the Host protocol constants. `R6-workbench.test.ts`
 * asserts they equal the Host values, so the browser never value-imports the
 * Host module. */
export const UI_PLATFORM_TOKEN_HEADER = 'x-platform-token';
export const UI_PLATFORM_TOKEN_META_NAME = 'platform-token';
export const UI_CORE_API_PREFIX = '/api/real/core/';
export const UI_BOOTSTRAP_SUFFIX = 'bootstrap';

export const SETTINGS_API_PREFIX = '/api/real/settings/';
