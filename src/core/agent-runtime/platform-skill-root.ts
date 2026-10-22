/**
 * The repository `resources/skills` root, owned by the Runtime.
 *
 * The Runtime cannot import the Host (`src/app`), so this path lives here and
 * `runtime-configuration.ts` re-exports the same binding. From
 * `src/core/agent-runtime` (or `dist/core/agent-runtime` after the build) three
 * levels up reach the repository root, so the value never depends on the
 * process cwd and never looks at a parent checkout.
 */
import { resolve } from 'node:path';

export const PLATFORM_SKILL_RESOURCE_ROOT = resolve(import.meta.dirname, '../../../resources/skills');
