/**
 * The minimal static page a Host test serves.
 *
 * The Host's static shell (`src/app/server.ts`) substitutes the per-instance
 * token for `PLATFORM_TOKEN_PLACEHOLDER` in whatever `index.html` the public
 * directory holds. The removed browser workbench used to publish that page;
 * tests write their own so they can read the token back without a UI build.
 */
import { writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { PLATFORM_TOKEN_PLACEHOLDER } from '../../src/app/core-http-types.js';

/** The meta name the page carries the substituted token under. */
export const PLATFORM_TOKEN_META_NAME = 'platform-token';

/** Write the page, and optionally the two asset names the static shell publishes. */
export async function writeHostPage(publicDir: string, assets = false): Promise<void> {
  await writeFile(join(publicDir, 'index.html'),
    `<!doctype html><meta name="${PLATFORM_TOKEN_META_NAME}" content="${PLATFORM_TOKEN_PLACEHOLDER}">`);
  if (assets) {
    await writeFile(join(publicDir, 'main.js'), 'export {};\n');
    await writeFile(join(publicDir, 'styles.css'), 'body { margin: 0; }\n');
  }
}
