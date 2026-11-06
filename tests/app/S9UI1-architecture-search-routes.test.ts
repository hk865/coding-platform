/**
 * UI1 architecture-search routes (ruling 17; the two frozen rows): the frozen route table
 * gets the two literal rows and the two bindings, and both are plain reads bound to
 * their one architecture owner method.
 */
import { describe, expect, it } from 'vitest';
import {
  CORE_ROUTE_SPECS, createPlatformCoreRouteBindings, type CoreRoutePlatform,
} from '../../src/app/core-routes.js';
import {
  ARCHITECTURE_SEARCH_ROUTES, EXPECTED_ROUTE_ROWS,
} from '../helpers/S6B3-route-suffixes.js';
import { routePlatform } from '../work-graph/S9UI1-fixture.js';

describe('S9UI1 architecture-search routes', () => {
  it('registers both reads as plain rows with the frozen binding and owner', () => {
    /* Named mutation: change either `kind` to `graph_write`, or the binding/owner name, in `CORE_ROUTE_SPECS`;
       red at the first mismatching row below. */
    const specs = CORE_ROUTE_SPECS as unknown as Record<string, unknown>;
    const expected = EXPECTED_ROUTE_ROWS as unknown as Record<string, unknown>;
    for (const suffix of ARCHITECTURE_SEARCH_ROUTES) {
      expect(specs[suffix], suffix).toEqual(expected[suffix]);
    }
  });

  it('binds each suffix to the platform architecture method of the same name', async () => {
    /* Named mutation: bind `findArchitecture` to `readArchitectureWorkScope` (or to a local stub) in
       `createPlatformCoreRouteBindings`; red at the sentinel/argument assertion below. */
    const seen: { binding: string; ctx: unknown; input: unknown }[] = [];
    const spies = {
      findArchitecture: async (ctx: unknown, input: unknown) => {
        seen.push({ binding: 'findArchitecture', ctx, input });
        return { status: 'ready', value: { which: 'find' } };
      },
      readArchitectureWorkScope: async (ctx: unknown, input: unknown) => {
        seen.push({ binding: 'readArchitectureWorkScope', ctx, input });
        return { status: 'ready', value: { which: 'work-scope' } };
      },
    };
    const architecture = new Proxy(spies, {
      get: (target, property) => property in target ? Reflect.get(target, property)
        : async () => ({ status: 'rejected', code: 'unsupported', reason: 'route test double' }),
    }) as unknown as CoreRoutePlatform['architecture'];
    const bindings = createPlatformCoreRouteBindings(routePlatform(architecture)) as unknown as Record<string, unknown>;
    const ctx = { projectId: 's9ui1-project', workspaceId: 's9ui1-a' };
    for (const [binding, which] of [['findArchitecture', 'find'],
      ['readArchitectureWorkScope', 'work-scope']] as const) {
      const fn = bindings[binding];
      expect(typeof fn, binding).toBe('function');
      if (typeof fn !== 'function') continue;
      const input = { needle: 'x', page: { afterCursor: null, limit: 10 } };
      const result = await (fn as (callCtx: unknown, request: unknown) => Promise<unknown>)(ctx, input);
      expect(result).toEqual({ status: 'ready', value: { which } });
      expect(seen.at(-1)).toEqual({ binding, ctx, input });
    }
  });
});
