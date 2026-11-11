/**
 * KLS-2a-2 after the code review (level 1): D4 is the Runtime's `reviewCapability` with the real `ProcessSandbox`
 * probe (real bubblewrap, `CODING_AGENT_BWRAP_PATH`) on a workspace whose `.workbench/` was deleted. The read-only
 * command mounts the whole workspace read-only, so the one options function the probe and the real tool share leaves
 * the knowledge directory out, and the missing directory cannot settle the review as unavailable.
 */
import { existsSync, mkdirSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, expect, it } from 'vitest';
import type { RoleConfigurationRef } from '../../src/contracts/core/identity.js';
import { createAgentRuntime } from '../../src/core/agent-runtime/runtime.js';
import type { RuntimeExecutionDependencies } from '../../src/core/agent-runtime/execution-contracts.js';
import { createB2RuntimeFixture, type B2RuntimeFixture } from '../helpers/B2-runtime-fixture.js';

const REVIEW_ROLE: RoleConfigurationRef = { kind: 'legacy_template', templateId: 'builder', templateRevision: '1' };
const fixtures: B2RuntimeFixture[] = [];
afterEach(async () => { for (const fixture of fixtures.splice(0)) await fixture.close(); });

it('KLS2A2-D4 the review capability probe still succeeds after .workbench/ is deleted', async () => {
  const fixture = await createB2RuntimeFixture({ kind: 'memory' });
  fixtures.push(fixture);
  const base = fixture.rebuildDeps();
  const deps: RuntimeExecutionDependencies = {
    ...base,
    // A Work Run's real tool gets `.workbench` among its read-only paths (its configuration snapshot adds it), so the
    // probe is given it too: the shared options function must leave it out for both.
    readonlyCommandAccess: async () => ({ access: 'all_except_denied' as const,
      processSandboxOptions: { readOnlyPaths: ['.workbench'] } }),
    workspaceHost: {
      ...base.workspaceHost,
      async authorize(ctx, workspace) {
        const current = await base.workspaceHost.authorize(ctx, workspace);
        if (current.status !== 'ready') return current;
        return { ...current, value: { ...current.value, allowsRead: () => true } };
      },
    },
  };
  const knowledge = join(fixture.directory, '.workbench');
  mkdirSync(knowledge, { recursive: true });
  rmSync(knowledge, { recursive: true });
  expect(existsSync(knowledge)).toBe(false);
  const result = await createAgentRuntime(deps).port.reviewCapability?.(fixture.ctx,
    { workspace: fixture.scope, role: REVIEW_ROLE });
  expect(result).toEqual({ status: 'available' });
}, 60_000);
