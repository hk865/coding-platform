/**
 * A secretary line's name `秘书 N` (slice-6 spec L6, "秘书名字"): N is the
 * Session's place in the creation order of the workspace's secretary Sessions,
 * counted from 1, ordered by `createdAt` and, between Sessions created at the
 * same instant, by the canonical Session key.
 *
 * Which Sessions count: those whose duty resolves to secretary. A Session
 * whose duty resolves to unknown is skipped when its role is a legacy template
 * (only the five platform templates fix a duty from such a role, so it is
 * certainly not a secretary); when its role is a RoleSpec the unknown duty may
 * hide a secretary whose RoleSpec could not be read, so the numbers are not
 * known.
 *
 * Called with hand-built (key, createdAt) pairs and (role kind, duty) entries;
 * every expected number and reason is written out here.
 */
import { describe, expect, it } from 'vitest';
import { secretaryNumbering, secretaryOrdinals } from '../../src/core/work-graph/views/work-line-reader.js';

describe('the secretary numbers of one workspace', () => {
  it('number the Sessions by creation time, not by the order they were read in or by key', () => {
    const numbers = secretaryOrdinals([
      { key: 'session-a', createdAt: '2026-10-23T09:03:00.000Z' },
      { key: 'session-c', createdAt: '2026-10-23T09:01:00.000Z' },
      { key: 'session-b', createdAt: '2026-10-23T09:02:00.000Z' },
    ]);
    expect([...numbers.entries()]).toEqual([['session-c', 1], ['session-b', 2], ['session-a', 3]]);
  });

  it('order Sessions created at the same instant by their key', () => {
    const numbers = secretaryOrdinals([
      { key: 'session-z', createdAt: '2026-10-23T09:01:00.000Z' },
      { key: 'session-m', createdAt: '2026-10-23T09:01:00.000Z' },
      { key: 'session-x', createdAt: '2026-10-23T09:00:00.000Z' },
    ]);
    expect([...numbers.entries()]).toEqual([['session-x', 1], ['session-m', 2], ['session-z', 3]]);
  });

  it('give no number when the workspace has no secretary', () => {
    expect(secretaryOrdinals([]).size).toBe(0);
  });
});

describe('which Sessions the secretary numbers count', () => {
  it('skip a legacy-template Session whose duty is unknown: the numbers stay known', () => {
    expect(secretaryNumbering([
      { key: 'session-a', createdAt: '2026-10-23T09:01:00.000Z', roleKind: 'legacy_template', duty: 'secretary' },
      { key: 'session-b', createdAt: '2026-10-23T09:02:00.000Z', roleKind: 'legacy_template', duty: 'unknown' },
      { key: 'session-c', createdAt: '2026-10-23T09:03:00.000Z', roleKind: 'legacy_template', duty: 'executor' },
      { key: 'session-d', createdAt: '2026-10-23T09:04:00.000Z', roleKind: 'role_spec', duty: 'secretary' },
    ])).toEqual({ status: 'ready', value: new Map([['session-a', 1], ['session-d', 2]]) });
  });

  it('leave the numbers unknown while a RoleSpec Session has an unknown duty', () => {
    expect(secretaryNumbering([
      { key: 'session-a', createdAt: '2026-10-23T09:01:00.000Z', roleKind: 'legacy_template', duty: 'secretary' },
      { key: 'session-b', createdAt: '2026-10-23T09:02:00.000Z', roleKind: 'role_spec', duty: 'unknown' },
    ])).toEqual({ status: 'failed', failure: { code: 'unavailable',
      reason: 'a Session duty is unknown; secretary numbering is incomplete' } });
  });
});
