/**
 * XWS2P XP-01 — the prefix syntax, qualification and the two stored/request read rules.
 *
 * Pure table: no Host. `ws1` is the main workspace, `ws2 = 'ws/2'` needs
 * `encodeURIComponent`; every expected value is literal from the frozen row
 * (`7d2-xpt-reply`'s sheet §1 XP-01). The alias `%77s%2f2` decodes to `ws/2`.
 *
 * Named mutations (each on one src line, then restored and the whole file rerun):
 * - A `src/core/work-graph/notes/note-anchors.ts:400–:410`: `anchorKeyOf`'s file arm
 *   back to `file:${anchor.path}` (no `normalizeProjectPath`) → the key alias entry red.
 * - B `src/contracts/workspace-path.ts`: `qualifyProjectPath`'s already-prefixed
 *   branch returns its input unchanged → the alias write-back entry red.
 * - C `splitWorkspacePath`'s root branch answers `path:''` → the `/@ws:ws%2F2` entry red.
 */
import { describe, expect, it } from 'vitest';
import {
  displayProjectPath, isSafeProjectPath, normalizeProjectPath, normalizeRequestProjectPath,
  qualifyProjectPath, resolveStoredProjectPath, splitWorkspacePath,
} from '../../src/contracts/workspace-path.js';
import { anchorKeyOf } from '../../src/core/work-graph/notes/note-anchors.js';

const MAIN = 'ws1';
const SECOND = 'ws/2';

describe('XP-01 splitWorkspacePath: the stored path grammar', () => {
  it.each([
    ['a bare stored path is the main workspace', 'src/a.ts', { workspaceId: null, path: 'src/a.ts' }],
    ['the root of a prefixed path is `.`', '/@ws:ws%2F2', { workspaceId: SECOND, path: '.' }],
    ['the prefixed path decodes its workspace id', '/@ws:ws%2F2/src/a.ts', { workspaceId: SECOND, path: 'src/a.ts' }],
    ['the encoded alias is the same workspace id', '/@ws:%77s%2f2/src/a.ts', { workspaceId: SECOND, path: 'src/a.ts' }],
  ] as const)('%s', (_label, path, expected) => {
    expect(splitWorkspacePath(path)).toEqual(expected);
  });
});

describe('XP-01 qualifyProjectPath: the main workspace has only the bare form', () => {
  it.each([
    ['the second workspace gets the prefix', SECOND, 'src/a.ts', '/@ws:ws%2F2/src/a.ts'],
    ['the second workspace root has no trailing slash', SECOND, '.', '/@ws:ws%2F2'],
    ['the main workspace path stays bare', MAIN, 'src/a.ts', 'src/a.ts'],
    ['a canonical prefixed path is returned as it is', SECOND, '/@ws:ws%2F2/src/a.ts', '/@ws:ws%2F2/src/a.ts'],
    ['an alias is written back in canonical form', SECOND, '/@ws:%77s%2f2/src/a.ts', '/@ws:ws%2F2/src/a.ts'],
  ] as const)('%s', (_label, workspaceId, path, expected) => {
    expect(qualifyProjectPath(workspaceId, path, MAIN)).toBe(expected);
  });

  it.each([
    ['an explicit main-workspace prefix is refused', '/@ws:ws1/src/a.ts'],
    ['the encoded alias of the main workspace is refused too', '/@ws:%77%73%31/src/a.ts'],
  ] as const)('%s', (_label, path) => {
    expect(() => qualifyProjectPath(MAIN, path, MAIN)).toThrow();
  });
});

describe('XP-01 normalizeProjectPath / normalizeRequestProjectPath / displayProjectPath', () => {
  it.each([
    ['a stored alias is normalized to the canonical prefix', '/@ws:%77s%2f2/src/a.ts', '/@ws:ws%2F2/src/a.ts'],
  ] as const)('%s', (_label, path, expected) => {
    expect(normalizeProjectPath(path)).toBe(expected);
  });

  it.each([
    ['a request path is qualified first', SECOND, 'src/a.ts', '/@ws:ws%2F2/src/a.ts'],
    ['a request path is qualified and then normalized', SECOND, './src/a.ts', '/@ws:ws%2F2/src/a.ts'],
  ] as const)('%s', (_label, workspaceId, path, expected) => {
    expect(normalizeRequestProjectPath(workspaceId, path, MAIN)).toBe(expected);
  });

  it.each([
    ['a bare path displays as it is', 'src', 'src'],
    ['a prefixed path displays the decoded workspace id', '/@ws:%77s%2f2/src', 'ws/2/src'],
  ] as const)('%s', (_label, path, expected) => {
    expect(displayProjectPath(path)).toBe(expected);
  });
});

describe('XP-01 resolveStoredProjectPath: a stored path reads in its own workspace', () => {
  it('a bare stored path is the main workspace, not the caller', () => {
    expect(resolveStoredProjectPath('src/a.ts', MAIN)).toEqual({ workspaceId: MAIN, path: 'src/a.ts' });
  });

  it('an explicit main-workspace prefix is a damaged record', () => {
    expect(() => resolveStoredProjectPath('/@ws:ws1/src/a.ts', MAIN)).toThrow();
  });
});

describe('XP-01 isSafeProjectPath', () => {
  it.each([
    ['the canonical form is safe', '/@ws:ws%2F2/src/a.ts', true],
    ['the encoded alias is safe', '/@ws:%77s%2f2/src/a.ts', true],
    ['a parent segment is not safe', '/@ws:ws%2F2/../a.ts', false],
    ['a backslash is not safe', '/@ws:ws%2F2/a\\b.ts', false],
    ['a trailing slash is not safe', '/@ws:ws%2F2/', false],
    ['an empty workspace id is not safe', '/@ws:/src/a.ts', false],
    ['a colon is not safe', '/@ws:ws%2F2/a:b.ts', false],
  ] as const)('%s', (_label, path, expected) => {
    expect(isSafeProjectPath(path)).toBe(expected);
  });
});

describe('XP-01 anchorKeyOf: the alias and the canonical form are one key', () => {
  it('both spellings produce the canonical file key', () => {
    const canonical = anchorKeyOf({ kind: 'file', path: '/@ws:ws%2F2/src/a.ts' });
    const alias = anchorKeyOf({ kind: 'file', path: '/@ws:%77s%2f2/src/a.ts' });
    expect(canonical).toBe('file:/@ws:ws%2F2/src/a.ts');
    expect(alias).toBe('file:/@ws:ws%2F2/src/a.ts');
  });
});
