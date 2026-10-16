/**
 * Speed-round 1 G1 (NE2): the public RecordStore `searchText` scan on both
 * backends (S1.1–S1.11).
 *
 * Every dataset is built through the public `commit` with the `s4b-text` test
 * registration (`S4B-text-search-support.ts`); every assertion goes through the
 * public `searchText` (never the database). Expected refKeys are literals
 * hand-computed from canonical JSON, or the test helper's own `keyOf` built
 * here, never a product comparison.
 */
import { afterEach, expect, it } from 'vitest';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { keyOf, open, plainIndex, refs, search, seed, textIndex, widget, withLookups, withTextIndex, type OpenOptions, type TextBackend } from '../helpers/S4B-text-search-support.js';
import { addLegacyFtsArtifacts } from '../helpers/SP-storage-migration-fixture.js';
import type { RecordLookupIndex } from '../../src/core/record-store/lookup-ports.js';

const dirs: string[] = [];
afterEach(async () => {
  for (const dir of dirs.splice(0)) await rm(dir, { recursive: true, force: true });
});

async function store(kind: 'memory' | 'sqlite', options: OpenOptions = {}): Promise<TextBackend> {
  const { backend, dir } = await open(kind, options);
  if (dir !== undefined) dirs.push(dir);
  return backend;
}

type PageRequest = {
  index: string;
  values: readonly string[];
  terms: readonly string[];
  match?: 'all' | 'any';
  limit: number;
  after?: string;
};

type Paged = { pages: string[][]; nexts: (string | null)[]; completes: boolean[] };

async function pageThrough(backend: TextBackend, request: PageRequest): Promise<Paged> {
  const pages: string[][] = [];
  const nexts: (string | null)[] = [];
  const completes: boolean[] = [];
  let after: string | undefined;
  for (let guard = 0; guard < 50; guard += 1) {
    const page = await search(backend, { ...request, ...(after === undefined ? {} : { after }) });
    pages.push(refs(page));
    nexts.push(page.next);
    completes.push(page.complete);
    if (page.next === null) return { pages, nexts, completes };
    after = page.next;
  }
  throw new Error('paging did not terminate');
}

// --------------------------------------------------------------------------
// SP-01/SP-02: canonical refKey byte order with supplementary-plane ids.
// --------------------------------------------------------------------------

// The canonical keys of `Widget` refs, hand-computed from JSON.stringify order
// (aggregateType, projectId, widgetId). The UTF-8 bytes of the last component
// are 0x7E, EF BF BD, F0 9F 98 80, so the byte order is tilde, replacement,
// emoji.
const ORDER_TILDE = `{"aggregateType":"Widget","projectId":"p1","widgetId":"a~"}`;
const ORDER_REPLACEMENT = `{"aggregateType":"Widget","projectId":"p1","widgetId":"a\uFFFD"}`;
const ORDER_EMOJI = `{"aggregateType":"Widget","projectId":"p1","widgetId":"a\u{1F600}"}`;

const orderRows = [
  widget('p1', 'a\u{1F600}', { topic: 'shared' }),
  widget('p1', 'a\uFFFD', { topic: 'shared' }),
  widget('p1', 'a~', { topic: 'shared' }),
];

it.each(['memory', 'sqlite'] as const)(
  'SP-01 %s: supplementary-plane refKeys come back in UTF-8 byte order',
  async (kind) => {
    const backend = await store(kind);
    try {
      await seed(backend, orderRows, 'sp01');
      const page = await search(backend, { index: 's4b-text', values: ['p1'], terms: ['shared'], limit: 20 });
      expect(refs(page)).toEqual([ORDER_TILDE, ORDER_REPLACEMENT, ORDER_EMOJI]);
      expect(page.complete).toBe(true);
    } finally {
      await backend.close();
    }
  },
);

it.each(['memory', 'sqlite'] as const)(
  'SP-02 %s: limit-1 paging walks supplementary-plane refKeys in byte order',
  async (kind) => {
    const backend = await store(kind);
    try {
      await seed(backend, orderRows, 'sp02');
      const { pages, nexts, completes } = await pageThrough(backend, {
        index: 's4b-text', values: ['p1'], terms: ['shared'], limit: 1,
      });
      expect(pages).toEqual([[ORDER_TILDE], [ORDER_REPLACEMENT], [ORDER_EMOJI]]);
      expect(nexts).toEqual([ORDER_TILDE, ORDER_REPLACEMENT, null]);
      expect(completes).toEqual([false, false, true]);
    } finally {
      await backend.close();
    }
  },
);

// --------------------------------------------------------------------------
// SP-03/SP-04: an `after` that is not a record, and an `after` past the end.
// --------------------------------------------------------------------------

it.each(['memory', 'sqlite'] as const)(
  'SP-03 %s: an after that is not a record resumes at the next refKey',
  async (kind) => {
    const backend = await store(kind);
    try {
      await seed(backend, [
        widget('p1', 'n1', { topic: 'shared' }),
        widget('p1', 'n3', { topic: 'shared' }),
        widget('p1', 'n5', { topic: 'shared' }),
      ], 'sp03');
      const page = await search(backend, {
        index: 's4b-text', values: ['p1'], terms: ['shared'], limit: 20, after: keyOf('p1', 'n2'),
      });
      expect(refs(page)).toEqual([keyOf('p1', 'n3'), keyOf('p1', 'n5')]);
      expect(page.next).toBeNull();
      expect(page.complete).toBe(true);
    } finally {
      await backend.close();
    }
  },
);

it.each(['memory', 'sqlite'] as const)(
  'SP-04 %s: an after past the end is [] with complete:true',
  async (kind) => {
    const backend = await store(kind);
    try {
      await seed(backend, [widget('p1', 'n1', { topic: 'shared' })], 'sp04');
      const page = await search(backend, {
        index: 's4b-text', values: ['p1'], terms: ['shared'], limit: 20, after: keyOf('p1', 'n9'),
      });
      expect(refs(page)).toEqual([]);
      expect(page.next).toBeNull();
      expect(page.complete).toBe(true);
    } finally {
      await backend.close();
    }
  },
);

// --------------------------------------------------------------------------
// SP-05: cross-backend differential (CJK, ASCII, combining marks, non-ASCII
// ids, two projects) page by page for both `'all'` and `'any'`.
// --------------------------------------------------------------------------

const differentialRows = [
  widget('p1', 'n1', { topic: '架构图需要重画' }),
  widget('p1', 'n2', { topic: 'Graph Context' }),
  widget('p1', 'café', { topic: 'cafe\u0301 au lait' }),
  widget('p1', '中文', { topic: '架构', body: 'graph' }),
  widget('p2', 'n1', { topic: '架构说明' }),
  widget('p2', 'n2', { topic: 'graph only' }),
];

const differentialQueries: readonly { values: readonly string[]; terms: readonly string[]; match: 'all' | 'any'; expected: string[] }[] = [
  { values: ['p1'], terms: ['架构'], match: 'all', expected: [keyOf('p1', 'n1'), keyOf('p1', '中文')] },
  { values: ['p1'], terms: ['架构', 'graph'], match: 'all', expected: [keyOf('p1', '中文')] },
  { values: ['p1'], terms: ['架构', 'graph'], match: 'any', expected: [keyOf('p1', 'n1'), keyOf('p1', 'n2'), keyOf('p1', '中文')] },
  { values: ['p2'], terms: ['架构', 'graph'], match: 'all', expected: [] },
  { values: ['p2'], terms: ['架构', 'graph'], match: 'any', expected: [keyOf('p2', 'n1'), keyOf('p2', 'n2')] },
  { values: ['p1'], terms: ['café'], match: 'all', expected: [keyOf('p1', 'café')] },
  { values: ['p1'], terms: ['cafe\u0301'], match: 'all', expected: [keyOf('p1', 'café')] },
];

it('SP-05 both: memory and sqlite agree page by page for all and any', async () => {
  const memory = await store('memory');
  const sqlite = await store('sqlite');
  try {
    await seed(memory, differentialRows, 'sp05m');
    await seed(sqlite, differentialRows, 'sp05s');
    for (const query of differentialQueries) {
      const request: PageRequest = {
        index: 's4b-text', values: query.values, terms: query.terms, match: query.match, limit: 2,
      };
      const memoryPages = await pageThrough(memory, request);
      const sqlitePages = await pageThrough(sqlite, request);
      expect(sqlitePages).toEqual(memoryPages);
      expect(memoryPages.pages.flat()).toEqual(query.expected);
    }
  } finally {
    await memory.close();
    await sqlite.close();
  }
});

// --------------------------------------------------------------------------
// SP-06/SP-07: in-process catch-up on one open store and an empty store.
// --------------------------------------------------------------------------

it.each(['memory', 'sqlite'] as const)(
  'SP-06 %s: a search, a write, then a search sees the write',
  async (kind) => {
    const backend = await store(kind);
    try {
      await seed(backend, [widget('p1', 'n1', { topic: 'alpha one' })], 'sp06a');
      expect(refs(await search(backend, { index: 's4b-text', values: ['p1'], terms: ['beta'], limit: 20 })))
        .toEqual([]);
      await seed(backend, [widget('p1', 'n2', { topic: 'beta two' })], 'sp06b');
      expect(refs(await search(backend, { index: 's4b-text', values: ['p1'], terms: ['beta'], limit: 20 })))
        .toEqual([keyOf('p1', 'n2')]);
    } finally {
      await backend.close();
    }
  },
);

it.each(['memory', 'sqlite'] as const)(
  'SP-07 %s: an empty store searches empty, then finds a written note',
  async (kind) => {
    const backend = await store(kind);
    try {
      const empty = await search(backend, { index: 's4b-text', values: ['p1'], terms: ['alpha'], limit: 20 });
      expect(refs(empty)).toEqual([]);
      expect(empty.next).toBeNull();
      expect(empty.complete).toBe(true);
      await seed(backend, [widget('p1', 'n1', { topic: 'alpha' })], 'sp07');
      expect(refs(await search(backend, { index: 's4b-text', values: ['p1'], terms: ['alpha'], limit: 20 })))
        .toEqual([keyOf('p1', 'n1')]);
    } finally {
      await backend.close();
    }
  },
);

// --------------------------------------------------------------------------
// SP-08: a note whose prefix value moves from a loaded prefix A to prefix B.
// The prefix path is a body field (`bucket`), so the identity key is unchanged.
// --------------------------------------------------------------------------

const bucketIndex: RecordLookupIndex = {
  name: 'sp-bucket',
  aggregateType: 'Widget',
  paths: ['bucket'],
  text: { paths: ['topic'] },
};

it.each(['memory', 'sqlite'] as const)(
  'SP-08 %s: a moved prefix leaves the old prefix and joins the new one',
  async (kind) => {
    const backend = await store(kind, { schemas: withTextIndex(bucketIndex) });
    try {
      await seed(backend, [widget('p1', 'n1', { bucket: 'A', topic: 'shared' })], 'sp08a');
      expect(refs(await search(backend, { index: 'sp-bucket', values: ['A'], terms: ['shared'], limit: 20 })))
        .toEqual([keyOf('p1', 'n1')]);
      await seed(backend, [widget('p1', 'n1', { bucket: 'B', topic: 'shared' }, 2)], 'sp08b', 1);
      expect(refs(await search(backend, { index: 'sp-bucket', values: ['A'], terms: ['shared'], limit: 20 })))
        .toEqual([]);
      expect(refs(await search(backend, { index: 'sp-bucket', values: ['B'], terms: ['shared'], limit: 20 })))
        .toEqual([keyOf('p1', 'n1')]);
    } finally {
      await backend.close();
    }
  },
);

// --------------------------------------------------------------------------
// SP-08c/SP-08d: a prefix that becomes composite must leave the loaded old
// prefix on BOTH backends, including a change committed by a second SQLite
// connection on the same file (F1, review item 1).
// --------------------------------------------------------------------------

it.each(['memory', 'sqlite'] as const)(
  'SP-08c %s: a prefix that becomes composite leaves the already-loaded old prefix',
  async (kind) => {
    const backend = await store(kind, { schemas: withTextIndex(bucketIndex) });
    try {
      await seed(backend, [widget('p1', 'n1', { bucket: 'A', topic: 'shared' })], 'sp08c-a');
      expect(refs(await search(backend, { index: 'sp-bucket', values: ['A'], terms: ['shared'], limit: 20 })))
        .toEqual([keyOf('p1', 'n1')]);
      // The prefix path value becomes a composite; the identity key is unchanged.
      await seed(backend, [widget('p1', 'n1', { bucket: {}, topic: 'shared' }, 2)], 'sp08c-b', 1);
      const page = await search(backend, { index: 'sp-bucket', values: ['A'], terms: ['shared'], limit: 20 });
      expect(refs(page)).toEqual([]);
      expect(page.next).toBeNull();
      expect(page.complete).toBe(true);
    } finally {
      await backend.close();
    }
  },
);

it('SP-08d sqlite: a second connection makes the composite change visible to the loaded old prefix', async () => {
  const first = await open('sqlite', { schemas: withTextIndex(bucketIndex) });
  if (first.dir !== undefined) dirs.push(first.dir);
  try {
    await seed(first.backend, [widget('p1', 'n1', { bucket: 'A', topic: 'shared' })], 'sp08d-a');
    expect(refs(await search(first.backend, { index: 'sp-bucket', values: ['A'], terms: ['shared'], limit: 20 })))
      .toEqual([keyOf('p1', 'n1')]);
    const second = await open('sqlite', { path: first.path!, schemas: withTextIndex(bucketIndex) });
    await seed(second.backend, [widget('p1', 'n1', { bucket: {}, topic: 'shared' }, 2)], 'sp08d-b', 1);
    await second.backend.close();
    const page = await search(first.backend, { index: 'sp-bucket', values: ['A'], terms: ['shared'], limit: 20 });
    expect(refs(page)).toEqual([]);
    expect(page.next).toBeNull();
    expect(page.complete).toBe(true);
  } finally {
    await first.backend.close();
  }
});

// --------------------------------------------------------------------------
// SP-09..SP-12: SQLite connection coordination and the 4B-era upgrade.
// --------------------------------------------------------------------------

it('SP-09 sqlite: another connection with the same registration is caught up', async () => {
  const first = await open('sqlite');
  if (first.dir !== undefined) dirs.push(first.dir);
  try {
    await seed(first.backend, [widget('p1', 'n1', { topic: 'alpha' })], 'sp09a');
    expect(refs(await search(first.backend, { index: 's4b-text', values: ['p1'], terms: ['alpha'], limit: 20 })))
      .toEqual([keyOf('p1', 'n1')]);
    const second = await open('sqlite', { path: first.path! });
    await seed(second.backend, [widget('p1', 'n2', { topic: 'alpha' })], 'sp09b');
    await second.backend.close();
    expect(refs(await search(first.backend, { index: 's4b-text', values: ['p1'], terms: ['alpha'], limit: 20 })))
      .toEqual([keyOf('p1', 'n1'), keyOf('p1', 'n2')]);
  } finally {
    await first.backend.close();
  }
});

it('SP-10 sqlite: a writer without the registration makes a loaded cache index_not_ready', async () => {
  const first = await open('sqlite');
  if (first.dir !== undefined) dirs.push(first.dir);
  try {
    await seed(first.backend, [widget('p1', 'n1', { topic: 'alpha' })], 'sp10a');
    expect(refs(await search(first.backend, { index: 's4b-text', values: ['p1'], terms: ['alpha'], limit: 20 })))
      .toEqual([keyOf('p1', 'n1')]);
    const plain = await open('sqlite', { path: first.path!, schemas: withLookups([plainIndex]) });
    await seed(plain.backend, [widget('p1', 'n2', { topic: 'alpha' })], 'sp10b');
    await plain.backend.close();
    expect(await first.backend.records.searchText({ index: 's4b-text', values: ['p1'], terms: ['alpha'], limit: 20 }))
      .toMatchObject({ status: 'rejected', code: 'unavailable', reason: 'index_not_ready' });
  } finally {
    await first.backend.close();
  }
});

it('SP-11 sqlite: another connection rebuilds with the same registration and the first sees the rebuilt content', async () => {
  const first = await open('sqlite');
  if (first.dir !== undefined) dirs.push(first.dir);
  try {
    await seed(first.backend, [widget('p1', 'n1', { topic: '架构图' })], 'sp11a');
    // Load the first backend's cache.
    expect(refs(await search(first.backend, { index: 's4b-text', values: ['p1'], terms: ['架构'], limit: 20 })))
      .toEqual([keyOf('p1', 'n1')]);
    // A writer without the registration makes `through` fall behind; the next
    // same-registration open rebuilds and publishes a new generation.
    const plain = await open('sqlite', { path: first.path!, schemas: withLookups([plainIndex]) });
    await seed(plain.backend, [widget('p1', 'n2', { topic: '令牌刷新' })], 'sp11b');
    await plain.backend.close();
    const second = await open('sqlite', { path: first.path! });
    await second.backend.close();
    expect(refs(await search(first.backend, { index: 's4b-text', values: ['p1'], terms: ['架构'], limit: 20 })))
      .toEqual([keyOf('p1', 'n1')]);
    expect(refs(await search(first.backend, { index: 's4b-text', values: ['p1'], terms: ['令牌'], limit: 20 })))
      .toEqual([keyOf('p1', 'n2')]);
  } finally {
    await first.backend.close();
  }
});

it('SP-11B sqlite: another connection rebuilds with a changed registration and the first answers index_not_ready', async () => {
  // S1.6's code check: a registration change is another process's ownership, so
  // the old cache can no longer answer until a reopen rebuilds (design §3.4).
  const first = await open('sqlite');
  if (first.dir !== undefined) dirs.push(first.dir);
  try {
    await seed(first.backend, [widget('p1', 'n1', { topic: '架构图' })], 'sp11c');
    expect(refs(await search(first.backend, { index: 's4b-text', values: ['p1'], terms: ['架构'], limit: 20 })))
      .toEqual([keyOf('p1', 'n1')]);
    const changed = { ...textIndex, text: { paths: ['topic'] } };
    const second = await open('sqlite', { path: first.path!, schemas: withTextIndex(changed) });
    try {
      // The rebuilding connection's own results stay correct while the first
      // backend's cache is loaded.
      expect(refs(await search(second.backend, { index: 's4b-text', values: ['p1'], terms: ['架构'], limit: 20 })))
        .toEqual([keyOf('p1', 'n1')]);
    } finally {
      await second.backend.close();
    }
    expect(await first.backend.records.searchText({ index: 's4b-text', values: ['p1'], terms: ['架构'], limit: 20 }))
      .toMatchObject({ status: 'rejected', code: 'unavailable', reason: 'index_not_ready' });
  } finally {
    await first.backend.close();
  }
});

it('SP-12 sqlite: the 4B-era file upgrade-compatibility check (results through the ports)', async () => {
  const eraDir = await mkdtemp(join(tmpdir(), 'sp-era-'));
  dirs.push(eraDir);
  const legacyPath = join(eraDir, 'legacy.sqlite');
  const plainPath = join(eraDir, 'plain.sqlite');
  const eraRows = [
    widget('p1', 'n1', { topic: '架构图需要重画' }),
    widget('p1', 'n2', { topic: '令牌刷新' }),
  ];
  for (const [name, path] of [['legacy', legacyPath], ['plain', plainPath]] as const) {
    const built = await open('sqlite', { schemas: withLookups([]), path });
    await seed(built.backend, eraRows, `sp12-${name}`);
    await built.backend.close();
  }
  // The allowed storage-migration fixture: legacy FTS tables and `next_fts_meta`.
  addLegacyFtsArtifacts(legacyPath, ['next_fts_sp_legacy']);
  const legacy = await open('sqlite', { path: legacyPath });
  const plain = await open('sqlite', { path: plainPath });
  try {
    const queries: readonly PageRequest[] = [
      { index: 's4b-text', values: ['p1'], terms: ['架构'], limit: 20 },
      { index: 's4b-text', values: ['p1'], terms: ['令牌'], limit: 20 },
    ];
    const expected: readonly string[][] = [[keyOf('p1', 'n1')], [keyOf('p1', 'n2')]];
    for (const [position, query] of queries.entries()) {
      const legacyPage = await search(legacy.backend, query);
      const plainPage = await search(plain.backend, query);
      expect(refs(legacyPage)).toEqual(expected[position]);
      expect({ refs: refs(legacyPage), next: legacyPage.next, complete: legacyPage.complete })
        .toEqual({ refs: refs(plainPage), next: plainPage.next, complete: plainPage.complete });
    }
  } finally {
    await legacy.backend.close();
    await plain.backend.close();
  }
});

// --------------------------------------------------------------------------
// SP-13: a lone-surrogate note text is stored losslessly on both backends and a
// lone-surrogate term is invalid.
// --------------------------------------------------------------------------

it.each(['memory', 'sqlite'] as const)(
  'SP-13 %s: a lone-surrogate note text is lossless and a lone-surrogate term is invalid',
  async (kind) => {
    const backend = await store(kind);
    try {
      await seed(backend, [widget('p1', 'n1', { topic: 'a\uD800b' })], 'sp13a');
      // Lossless JSON storage: the U+FFFD-substituted text is not present.
      expect(refs(await search(backend, { index: 's4b-text', values: ['p1'], terms: ['a\uFFFDb'], limit: 20 })))
        .toEqual([]);
      // A term that does not straddle the lone surrogate still matches.
      await seed(backend, [widget('p1', 'n2', { topic: 'a\uD800bc' })], 'sp13b');
      expect(refs(await search(backend, { index: 's4b-text', values: ['p1'], terms: ['bc'], limit: 20 })))
        .toEqual([keyOf('p1', 'n2')]);
      // A lone-surrogate term is invalid.
      expect(await backend.records.searchText({ index: 's4b-text', values: ['p1'], terms: ['a\uD800b'], limit: 20 }))
        .toMatchObject({ status: 'rejected', code: 'invalid' });
    } finally {
      await backend.close();
    }
  },
);

// --------------------------------------------------------------------------
// SP-14: the `'any'` port — union, byte order, no duplicate, resume.
// --------------------------------------------------------------------------

it.each(['memory', 'sqlite'] as const)(
  "SP-14 %s: 'any' unions the terms in byte order, once each, and resumes from after",
  async (kind) => {
    const backend = await store(kind);
    try {
      await seed(backend, [
        widget('p1', 'n1', { topic: 'alpha' }),
        widget('p1', 'n2', { topic: 'beta' }),
        widget('p1', 'n3', { topic: 'alpha beta' }),
        widget('p1', 'n4', { topic: 'gamma' }),
      ], 'sp14');
      const page = await search(backend, {
        index: 's4b-text', values: ['p1'], terms: ['alpha', 'beta'], match: 'any', limit: 20,
      });
      expect(refs(page)).toEqual([keyOf('p1', 'n1'), keyOf('p1', 'n2'), keyOf('p1', 'n3')]);
      expect(page.next).toBeNull();
      expect(page.complete).toBe(true);
      const paged = await pageThrough(backend, {
        index: 's4b-text', values: ['p1'], terms: ['alpha', 'beta'], match: 'any', limit: 1,
      });
      expect(paged.pages).toEqual([[keyOf('p1', 'n1')], [keyOf('p1', 'n2')], [keyOf('p1', 'n3')]]);
      const resumed = await search(backend, {
        index: 's4b-text', values: ['p1'], terms: ['alpha', 'beta'], match: 'any', limit: 20, after: keyOf('p1', 'n2'),
      });
      expect(refs(resumed)).toEqual([keyOf('p1', 'n3')]);
    } finally {
      await backend.close();
    }
  },
);
