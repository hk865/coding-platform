/**
 * The maintainer claim key (`moduleMaintainerKey`). Pure input only; every expected
 * string is written by hand from the frozen key rule, never copied from a `src` constant or output.
 */
import { describe, expect, it } from 'vitest';
import type { ModuleRef } from '../../src/contracts/core/identity.js';
import { moduleMaintainerKey } from '../../src/contracts/role-lines.js';

describe('M-key: moduleMaintainerKey is one canonical two-key string', () => {
  it.each<[string, ModuleRef & Record<string, unknown>, string]>([
    ['module M', { projectId: 'p1', moduleId: 'M' }, 'module-maintainer:{"moduleId":"M","projectId":"p1"}'],
    ['module M2', { projectId: 'p1', moduleId: 'M2' }, 'module-maintainer:{"moduleId":"M2","projectId":"p1"}'],
    ['a reordered object', { moduleId: 'M', projectId: 'p1' }, 'module-maintainer:{"moduleId":"M","projectId":"p1"}'],
    ['extra keys never enter the key', { projectId: 'p1', moduleId: 'M', name: 'Maintainer', paths: ['src'] },
      'module-maintainer:{"moduleId":"M","projectId":"p1"}'],
  ])('%s', (_case, module, expected) => {
    expect(moduleMaintainerKey(module)).toBe(expected);
  });
});
