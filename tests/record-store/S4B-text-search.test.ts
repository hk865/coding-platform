/**
 * Slice 4B G1 (NE2): the public RecordStore `searchText` on both backends.
 *
 * Every dataset is built through the backend's public `commit` with the
 * `s4b-text` test full-text registration (`S4B-text-search-support.ts`); every
 * assertion goes through the public `searchText`. Expected refKeys are literals
 * hand-computed from spec §5.2 rows T-01 … T-06, T-08.
 */
import { afterEach, expect, it } from 'vitest';
import { rm } from 'node:fs/promises';
import { keyOf, open, plainIndex, refs, search, seed, seedBatch, textIndex, widget, widgetSchemas, withLookups, withTextIndex, type OpenOptions, type TextBackend } from '../helpers/S4B-text-search-support.js';

const dirs: string[] = [];
afterEach(async () => {
  for (const dir of dirs.splice(0)) await rm(dir, { recursive: true, force: true });
});

async function storeWith(kind: 'memory' | 'sqlite', options: OpenOptions = {}): Promise<TextBackend> {
  const { backend, dir } = await open(kind, options);
  if (dir !== undefined) dirs.push(dir);
  return backend;
}

async function store(kind: 'memory' | 'sqlite'): Promise<TextBackend> {
  return storeWith(kind);
}

// --------------------------------------------------------------------------
// T-01: Chinese substring (not window/segment equality), and the recheck that
// rejects a window candidate whose substring does not appear.
// --------------------------------------------------------------------------

it.each(['memory', 'sqlite'] as const)(
  'T-01 %s: a two-codepoint Chinese term finds its containing text',
  async (kind) => {
    const backend = await store(kind);
    try {
      await seed(backend, [widget('p1', 'n1', { topic: '架构图需要重画' })], 't01a');
      const page = await search(backend, { index: 's4b-text', values: ['p1'], terms: ['架构'], limit: 20 });
      expect(refs(page)).toEqual([keyOf('p1', 'n1')]);
    } finally {
      await backend.close();
    }
  },
);

it.each(['memory', 'sqlite'] as const)(
  'T-01 %s: a term spanning the middle of the text is a substring, not a segment',
  async (kind) => {
    const backend = await store(kind);
    try {
      await seed(backend, [widget('p1', 'n1', { topic: '架构图需要重画' })], 't01b');
      const page = await search(backend, { index: 's4b-text', values: ['p1'], terms: ['构图'], limit: 20 });
      expect(refs(page)).toEqual([keyOf('p1', 'n1')]);
    } finally {
      await backend.close();
    }
  },
);

it.each(['memory', 'sqlite'] as const)(
  'T-01 %s: a term at the end of the text is found',
  async (kind) => {
    const backend = await store(kind);
    try {
      await seed(backend, [widget('p1', 'n1', { topic: '架构图需要重画' })], 't01c');
      const page = await search(backend, { index: 's4b-text', values: ['p1'], terms: ['重画'], limit: 20 });
      expect(refs(page)).toEqual([keyOf('p1', 'n1')]);
    } finally {
      await backend.close();
    }
  },
);

it.each(['memory', 'sqlite'] as const)(
  'T-01 %s: window candidates whose substring is absent are checked out',
  async (kind) => {
    const backend = await store(kind);
    try {
      await seed(backend, [widget('p1', 'n1', { topic: 'abXbc' })], 't01d');
      const page = await search(backend, { index: 's4b-text', values: ['p1'], terms: ['abc'], limit: 20 });
      expect(refs(page)).toEqual([]);
    } finally {
      await backend.close();
    }
  },
);

// --------------------------------------------------------------------------
// T-02: English and identifiers — substrings, case-insensitive, no camelCase
// or whole-word rule.
// --------------------------------------------------------------------------

it.each(['memory', 'sqlite'] as const)(
  'T-02 %s: a lowercase middle fragment finds a camelCase identifier',
  async (kind) => {
    const backend = await store(kind);
    try {
      await seed(backend, [widget('p1', 'n1', { body: 'readTurnBounds' })], 't02a');
      const page = await search(backend, { index: 's4b-text', values: ['p1'], terms: ['urn'], limit: 20 });
      expect(refs(page)).toEqual([keyOf('p1', 'n1')]);
    } finally {
      await backend.close();
    }
  },
);

it.each(['memory', 'sqlite'] as const)(
  'T-02 %s: a lowercase suffix fragment finds a camelCase identifier',
  async (kind) => {
    const backend = await store(kind);
    try {
      await seed(backend, [widget('p1', 'n1', { body: 'readTurnBounds' })], 't02b');
      const page = await search(backend, { index: 's4b-text', values: ['p1'], terms: ['bounds'], limit: 20 });
      expect(refs(page)).toEqual([keyOf('p1', 'n1')]);
    } finally {
      await backend.close();
    }
  },
);

it.each(['memory', 'sqlite'] as const)(
  'T-02 %s: the whole lowercased identifier matches',
  async (kind) => {
    const backend = await store(kind);
    try {
      await seed(backend, [widget('p1', 'n1', { body: 'readTurnBounds' })], 't02c');
      const page = await search(backend, { index: 's4b-text', values: ['p1'], terms: ['readturnbounds'], limit: 20 });
      expect(refs(page)).toEqual([keyOf('p1', 'n1')]);
    } finally {
      await backend.close();
    }
  },
);

it.each(['memory', 'sqlite'] as const)(
  'T-02 %s: matching is case-insensitive',
  async (kind) => {
    const backend = await store(kind);
    try {
      await seed(backend, [widget('p1', 'n1', { body: 'readTurnBounds' })], 't02d');
      const page = await search(backend, { index: 's4b-text', values: ['p1'], terms: ['READTURNBOUNDS'], limit: 20 });
      expect(refs(page)).toEqual([keyOf('p1', 'n1')]);
    } finally {
      await backend.close();
    }
  },
);

it.each(['memory', 'sqlite'] as const)(
  'T-02 %s: a hyphenated identifier is a plain substring',
  async (kind) => {
    const backend = await store(kind);
    try {
      await seed(backend, [widget('p1', 'n1', { body: 'graph-context' })], 't02e');
      const page = await search(backend, { index: 's4b-text', values: ['p1'], terms: ['graph-context'], limit: 20 });
      expect(refs(page)).toEqual([keyOf('p1', 'n1')]);
    } finally {
      await backend.close();
    }
  },
);

it.each(['memory', 'sqlite'] as const)(
  'T-02 %s: a mixed-case query still matches',
  async (kind) => {
    const backend = await store(kind);
    try {
      await seed(backend, [widget('p1', 'n1', { body: 'readTurnBounds' })], 't02f');
      const page = await search(backend, { index: 's4b-text', values: ['p1'], terms: ['ReadTurnBounds'], limit: 20 });
      expect(refs(page)).toEqual([keyOf('p1', 'n1')]);
    } finally {
      await backend.close();
    }
  },
);

// --------------------------------------------------------------------------
// T-03: a 1-code-point term, a 65-code-point term, a term with whitespace and
// 9 terms are refused `invalid`; 2 and 64 code points are the accepted edges.
// --------------------------------------------------------------------------

it.each(['memory', 'sqlite'] as const)(
  'T-03 %s: a one-code-point term is invalid',
  async (kind) => {
    const backend = await store(kind);
    try {
      expect(await backend.records.searchText({ index: 's4b-text', values: ['p1'], terms: ['a'], limit: 20 }))
        .toMatchObject({ status: 'rejected', code: 'invalid' });
    } finally {
      await backend.close();
    }
  },
);

it.each(['memory', 'sqlite'] as const)(
  'T-03 %s: a 65-code-point term is invalid',
  async (kind) => {
    const backend = await store(kind);
    try {
      expect(await backend.records.searchText({ index: 's4b-text', values: ['p1'], terms: ['a'.repeat(65)], limit: 20 }))
        .toMatchObject({ status: 'rejected', code: 'invalid' });
    } finally {
      await backend.close();
    }
  },
);

it.each(['memory', 'sqlite'] as const)(
  'T-03 %s: a term containing whitespace is invalid',
  async (kind) => {
    const backend = await store(kind);
    try {
      expect(await backend.records.searchText({ index: 's4b-text', values: ['p1'], terms: ['ab cd'], limit: 20 }))
        .toMatchObject({ status: 'rejected', code: 'invalid' });
    } finally {
      await backend.close();
    }
  },
);

it.each(['memory', 'sqlite'] as const)(
  'T-03 %s: nine terms are invalid',
  async (kind) => {
    const backend = await store(kind);
    try {
      const nine = Array.from({ length: 9 }, () => 'ab');
      expect(await backend.records.searchText({ index: 's4b-text', values: ['p1'], terms: nine, limit: 20 }))
        .toMatchObject({ status: 'rejected', code: 'invalid' });
    } finally {
      await backend.close();
    }
  },
);

it.each(['memory', 'sqlite'] as const)(
  'T-03 %s: an empty term list is invalid',
  async (kind) => {
    const backend = await store(kind);
    try {
      expect(await backend.records.searchText({ index: 's4b-text', values: ['p1'], terms: [], limit: 20 }))
        .toMatchObject({ status: 'rejected', code: 'invalid' });
    } finally {
      await backend.close();
    }
  },
);

it.each(['memory', 'sqlite'] as const)(
  'T-03 %s: the 2 and 64 code-point edges are accepted',
  async (kind) => {
    const backend = await store(kind);
    try {
      expect(await backend.records.searchText({ index: 's4b-text', values: ['p1'], terms: ['ab'], limit: 20 }))
        .toMatchObject({ status: 'ready', value: { records: [] } });
      expect(await backend.records.searchText({ index: 's4b-text', values: ['p1'], terms: ['a'.repeat(64)], limit: 20 }))
        .toMatchObject({ status: 'ready', value: { records: [] } });
    } finally {
      await backend.close();
    }
  },
);

// --------------------------------------------------------------------------
// T-04: a body change retires the old text; a withdrawn head is still returned
// (the port only supplies candidates; current-conclusion filtering is NE3).
// --------------------------------------------------------------------------

it.each(['memory', 'sqlite'] as const)(
  'T-04 %s: the old term no longer matches after a body change',
  async (kind) => {
    const backend = await store(kind);
    try {
      await seed(backend, [widget('p1', 'n1', { topic: 'alpha old' })], 't04a');
      await seed(backend, [widget('p1', 'n1', { topic: 'beta new' }, 2)], 't04b', 1);
      const page = await search(backend, { index: 's4b-text', values: ['p1'], terms: ['alpha'], limit: 20 });
      expect(refs(page)).toEqual([]);
    } finally {
      await backend.close();
    }
  },
);

it.each(['memory', 'sqlite'] as const)(
  'T-04 %s: the new term matches after a body change',
  async (kind) => {
    const backend = await store(kind);
    try {
      await seed(backend, [widget('p1', 'n1', { topic: 'alpha old' })], 't04c');
      await seed(backend, [widget('p1', 'n1', { topic: 'beta new' }, 2)], 't04d', 1);
      const page = await search(backend, { index: 's4b-text', values: ['p1'], terms: ['beta'], limit: 20 });
      expect(refs(page)).toEqual([keyOf('p1', 'n1')]);
    } finally {
      await backend.close();
    }
  },
);

it.each(['memory', 'sqlite'] as const)(
  'T-04 %s: a withdrawn head is still returned by the port',
  async (kind) => {
    const backend = await store(kind);
    try {
      await seed(backend, [widget('p1', 'n1', { state: 'withdrawn', topic: '架构图需要重画' })], 't04e');
      const page = await search(backend, { index: 's4b-text', values: ['p1'], terms: ['架构'], limit: 20 });
      expect(refs(page)).toEqual([keyOf('p1', 'n1')]);
    } finally {
      await backend.close();
    }
  },
);

it.each(['memory', 'sqlite'] as const)(
  'T-04 %s: an updated head is returned once, not once per old text version',
  async (kind) => {
    const backend = await store(kind);
    try {
      await seed(backend, [widget('p1', 'n1', { topic: 'alpha one' })], 't04f');
      await seed(backend, [widget('p1', 'n1', { topic: 'alpha two' }, 2)], 't04g', 1);
      const page = await search(backend, { index: 's4b-text', values: ['p1'], terms: ['alpha'], limit: 20 });
      expect(refs(page)).toEqual([keyOf('p1', 'n1')]);
    } finally {
      await backend.close();
    }
  },
);

// --------------------------------------------------------------------------
// T-05: results are ordered by refKey bytes; two-at-a-time paging reaches the
// end without duplicates or gaps; both backends agree page by page.
// --------------------------------------------------------------------------

const pagingRows = [
  widget('p1', 'n3', { topic: 'shared' }),
  widget('p1', 'n1', { topic: 'shared' }),
  widget('p1', 'n5', { topic: 'shared' }),
  widget('p1', 'n2', { topic: 'shared' }),
  widget('p1', 'n4', { topic: 'shared' }),
];

async function pageThrough(backend: TextBackend, limit: number): Promise<{ pages: string[][]; completes: boolean[] }> {
  const pages: string[][] = [];
  const completes: boolean[] = [];
  let after: string | undefined;
  for (let guard = 0; guard < 20; guard += 1) {
    const page = await search(backend, {
      index: 's4b-text',
      values: ['p1'],
      terms: ['shared'],
      limit,
      ...(after === undefined ? {} : { after }),
    });
    pages.push(refs(page));
    completes.push(page.complete);
    if (page.next === null) return { pages, completes };
    after = page.next;
  }
  throw new Error('paging did not terminate');
}

it.each(['memory', 'sqlite'] as const)(
  'T-05 %s: two-at-a-time paging walks the refKey order to the end',
  async (kind) => {
    const backend = await store(kind);
    try {
      await seed(backend, pagingRows, 't05');
      const { pages, completes } = await pageThrough(backend, 2);
      expect(pages).toEqual([
        [keyOf('p1', 'n1'), keyOf('p1', 'n2')],
        [keyOf('p1', 'n3'), keyOf('p1', 'n4')],
        [keyOf('p1', 'n5')],
      ]);
      expect(completes).toEqual([false, false, true]);
    } finally {
      await backend.close();
    }
  },
);

it('T-05 both: the memory and sqlite backends agree page by page', async () => {
  const memory = await store('memory');
  const sqlite = await store('sqlite');
  try {
    await seed(memory, pagingRows, 't05m');
    await seed(sqlite, pagingRows, 't05s');
    const memoryPages = await pageThrough(memory, 2);
    const sqlitePages = await pageThrough(sqlite, 2);
    expect(sqlitePages).toEqual(memoryPages);
  } finally {
    await memory.close();
    await sqlite.close();
  }
});

// --------------------------------------------------------------------------
// T-08: the `all` (AND) rule — every term must be a substring — keeps the
// refKey byte order.
// --------------------------------------------------------------------------

it.each(['memory', 'sqlite'] as const)(
  'T-08 %s: two terms select only the record containing both',
  async (kind) => {
    const backend = await store(kind);
    try {
      await seed(backend, [
        widget('p1', 'n1', { topic: 'auth flow' }),
        widget('p1', 'n2', { topic: 'auth only' }),
        widget('p1', 'n3', { topic: 'flow only' }),
      ], 't08a');
      const page = await search(backend, { index: 's4b-text', values: ['p1'], terms: ['auth', 'flow'], limit: 20 });
      expect(refs(page)).toEqual([keyOf('p1', 'n1')]);
    } finally {
      await backend.close();
    }
  },
);

it.each(['memory', 'sqlite'] as const)(
  'T-08 %s: several both-term records stay in refKey byte order',
  async (kind) => {
    const backend = await store(kind);
    try {
      await seed(backend, [
        widget('p1', 'n4', { topic: 'auth flow' }),
        widget('p1', 'n1', { topic: 'flow and auth' }),
        widget('p1', 'n2', { topic: 'auth only' }),
      ], 't08b');
      const page = await search(backend, { index: 's4b-text', values: ['p1'], terms: ['auth', 'flow'], limit: 20 });
      expect(refs(page)).toEqual([keyOf('p1', 'n1'), keyOf('p1', 'n4')]);
    } finally {
      await backend.close();
    }
  },
);

// --------------------------------------------------------------------------
// T-06: closing and reopening; a missing table and a changed registration both
// rebuild from the head records; an unavailable FTS5 probe answers unsupported.
// --------------------------------------------------------------------------

it('T-06 sqlite: reopening the same registration returns the same results', async () => {
  const first = await open('sqlite');
  if (first.dir !== undefined) dirs.push(first.dir);
  await seed(first.backend, [widget('p1', 'n1', { topic: '架构图需要重画' })], 't06a');
  await first.backend.close();
  const second = await open('sqlite', { path: first.path! });
  try {
    const after = await search(second.backend, { index: 's4b-text', values: ['p1'], terms: ['架构'], limit: 20 });
    expect(refs(after)).toEqual([keyOf('p1', 'n1')]);
  } finally {
    await second.backend.close();
  }
});

it('T-06 sqlite: reopening without the index and then with it rebuilds from the heads', async () => {
  const first = await open('sqlite', { schemas: { ...widgetSchemas, lookups: [] } });
  if (first.dir !== undefined) dirs.push(first.dir);
  await seed(first.backend, [widget('p1', 'n1', { topic: '架构图需要重画' })], 't06b');
  await first.backend.close();
  const second = await open('sqlite', { path: first.path! });
  try {
    const page = await search(second.backend, { index: 's4b-text', values: ['p1'], terms: ['架构'], limit: 20 });
    expect(refs(page)).toEqual([keyOf('p1', 'n1')]);
  } finally {
    await second.backend.close();
  }
});

it('T-06 sqlite: a write made while the index was unregistered is rebuilt from the heads', async () => {
  const first = await open('sqlite');
  if (first.dir !== undefined) dirs.push(first.dir);
  await seed(first.backend, [widget('p1', 'n1', { topic: '架构图需要重画' })], 't06d');
  await first.backend.close();
  const second = await open('sqlite', { path: first.path!, schemas: { ...widgetSchemas, lookups: [] } });
  await seed(second.backend, [widget('p1', 'n2', { topic: '架构说明' })], 't06e');
  await seed(second.backend, [widget('p1', 'n1', { topic: '令牌刷新' }, 2)], 't06f', 1);
  await second.backend.close();
  const third = await open('sqlite', { path: first.path! });
  try {
    expect(refs(await search(third.backend, { index: 's4b-text', values: ['p1'], terms: ['架构'], limit: 20 })))
      .toEqual([keyOf('p1', 'n2')]);
    expect(refs(await search(third.backend, { index: 's4b-text', values: ['p1'], terms: ['令牌'], limit: 20 })))
      .toEqual([keyOf('p1', 'n1')]);
  } finally {
    await third.backend.close();
  }
});

it('T-06 sqlite: a write made while FTS5 was unavailable is rebuilt when it returns', async () => {
  const first = await open('sqlite');
  if (first.dir !== undefined) dirs.push(first.dir);
  await seed(first.backend, [widget('p1', 'n1', { topic: '架构图需要重画' })], 't06g');
  await first.backend.close();
  const second = await open('sqlite', { path: first.path!, fullTextProbe: () => false });
  await seed(second.backend, [widget('p1', 'n2', { topic: '架构说明' })], 't06h');
  await second.backend.close();
  const third = await open('sqlite', { path: first.path! });
  try {
    expect(refs(await search(third.backend, { index: 's4b-text', values: ['p1'], terms: ['架构'], limit: 20 })))
      .toEqual([keyOf('p1', 'n1'), keyOf('p1', 'n2')]);
  } finally {
    await third.backend.close();
  }
});

it('T-06 sqlite: an index that falls behind an open store answers unavailable index_not_ready', async () => {
  const first = await open('sqlite');
  if (first.dir !== undefined) dirs.push(first.dir);
  await seed(first.backend, [widget('p1', 'n1', { topic: '架构图需要重画' })], 't06i');
  const second = await open('sqlite', { path: first.path!, schemas: { ...widgetSchemas, lookups: [] } });
  try {
    await seed(second.backend, [widget('p1', 'n2', { topic: '架构说明' })], 't06j');
    expect(await first.backend.records.searchText({ index: 's4b-text', values: ['p1'], terms: ['架构'], limit: 20 }))
      .toMatchObject({ status: 'rejected', code: 'unavailable', reason: 'index_not_ready' });
  } finally {
    await second.backend.close();
    await first.backend.close();
  }
});

it('T-06 sqlite: a changed text registration rebuilds the index', async () => {
  const topicOnly = { ...textIndex, text: { paths: ['topic', 'conclusion'] } };
  const first = await open('sqlite', { schemas: withTextIndex(topicOnly) });
  if (first.dir !== undefined) dirs.push(first.dir);
  await seed(first.backend, [widget('p1', 'n1', { topic: '架构图需要重画', body: '令牌刷新' })], 't06c');
  await first.backend.close();
  const second = await open('sqlite', { path: first.path! });
  try {
    expect(refs(await search(second.backend, { index: 's4b-text', values: ['p1'], terms: ['架构'], limit: 20 })))
      .toEqual([keyOf('p1', 'n1')]);
    expect(refs(await search(second.backend, { index: 's4b-text', values: ['p1'], terms: ['令牌'], limit: 20 })))
      .toEqual([keyOf('p1', 'n1')]);
  } finally {
    await second.backend.close();
  }
});

it('T-06 sqlite: an unavailable FTS5 probe answers unsupported', async () => {
  const backend = await storeWith('sqlite', { fullTextProbe: () => false });
  try {
    expect(await backend.records.searchText({ index: 's4b-text', values: ['p1'], terms: ['架构'], limit: 20 }))
      .toMatchObject({ status: 'rejected', code: 'unsupported' });
  } finally {
    await backend.close();
  }
});

// --------------------------------------------------------------------------
// T-02 NFC: a decomposed and a composed form normalize to the same text.
// --------------------------------------------------------------------------

it.each(['memory', 'sqlite'] as const)(
  'T-02 %s: a decomposed term matches composed text',
  async (kind) => {
    const backend = await store(kind);
    try {
      await seed(backend, [widget('p1', 'n1', { topic: 'caf\u00e9' })], 't02nfc1');
      const page = await search(backend, { index: 's4b-text', values: ['p1'], terms: ['cafe\u0301'], limit: 20 });
      expect(refs(page)).toEqual([keyOf('p1', 'n1')]);
    } finally {
      await backend.close();
    }
  },
);

it.each(['memory', 'sqlite'] as const)(
  'T-02 %s: a composed term matches decomposed text',
  async (kind) => {
    const backend = await store(kind);
    try {
      await seed(backend, [widget('p1', 'n1', { topic: 'cafe\u0301' })], 't02nfc2');
      const page = await search(backend, { index: 's4b-text', values: ['p1'], terms: ['caf\u00e9'], limit: 20 });
      expect(refs(page)).toEqual([keyOf('p1', 'n1')]);
    } finally {
      await backend.close();
    }
  },
);

// --------------------------------------------------------------------------
// T-03 request bounds not covered above: limit, values length, after validity,
// and the capability answers for an unregistered or non-text index.
// --------------------------------------------------------------------------

it.each(['memory', 'sqlite'] as const)(
  'T-03 %s: a limit below 1 is invalid',
  async (kind) => {
    const backend = await store(kind);
    try {
      expect(await backend.records.searchText({ index: 's4b-text', values: ['p1'], terms: ['ab'], limit: 0 }))
        .toMatchObject({ status: 'rejected', code: 'invalid' });
    } finally {
      await backend.close();
    }
  },
);

it.each(['memory', 'sqlite'] as const)(
  'T-03 %s: a limit above 100 is invalid',
  async (kind) => {
    const backend = await store(kind);
    try {
      expect(await backend.records.searchText({ index: 's4b-text', values: ['p1'], terms: ['ab'], limit: 101 }))
        .toMatchObject({ status: 'rejected', code: 'invalid' });
    } finally {
      await backend.close();
    }
  },
);

it.each(['memory', 'sqlite'] as const)(
  'T-03 %s: too few values are invalid',
  async (kind) => {
    const backend = await store(kind);
    try {
      expect(await backend.records.searchText({ index: 's4b-text', values: [], terms: ['ab'], limit: 20 }))
        .toMatchObject({ status: 'rejected', code: 'invalid' });
    } finally {
      await backend.close();
    }
  },
);

it.each(['memory', 'sqlite'] as const)(
  'T-03 %s: too many values are invalid',
  async (kind) => {
    const backend = await store(kind);
    try {
      expect(await backend.records.searchText({ index: 's4b-text', values: ['p1', 'p2'], terms: ['ab'], limit: 20 }))
        .toMatchObject({ status: 'rejected', code: 'invalid' });
    } finally {
      await backend.close();
    }
  },
);

it.each(['memory', 'sqlite'] as const)(
  'T-03 %s: a non-canonical after is invalid',
  async (kind) => {
    const backend = await store(kind);
    try {
      expect(await backend.records.searchText({
        index: 's4b-text', values: ['p1'], terms: ['ab'], limit: 20, after: 'not-a-ref',
      })).toMatchObject({ status: 'rejected', code: 'invalid' });
    } finally {
      await backend.close();
    }
  },
);

it.each(['memory', 'sqlite'] as const)(
  'T-03 %s: an after from another aggregate type is invalid',
  async (kind) => {
    const backend = await store(kind);
    try {
      const foreignAfter = JSON.stringify({ aggregateType: 'Other', projectId: 'p1', widgetId: 'n1' });
      expect(await backend.records.searchText({
        index: 's4b-text', values: ['p1'], terms: ['ab'], limit: 20, after: foreignAfter,
      })).toMatchObject({ status: 'rejected', code: 'invalid' });
    } finally {
      await backend.close();
    }
  },
);

it.each(['memory', 'sqlite'] as const)(
  'T-03 %s: an unregistered index is unsupported',
  async (kind) => {
    const backend = await store(kind);
    try {
      expect(await backend.records.searchText({ index: 's4b-missing', values: ['p1'], terms: ['ab'], limit: 20 }))
        .toMatchObject({ status: 'rejected', code: 'unsupported' });
    } finally {
      await backend.close();
    }
  },
);

it.each(['memory', 'sqlite'] as const)(
  'T-03 %s: a registered non-text index is unsupported',
  async (kind) => {
    const backend = await storeWith(kind, { schemas: withLookups([plainIndex, textIndex]) });
    try {
      expect(await backend.records.searchText({ index: 's4b-plain', values: ['p1'], terms: ['ab'], limit: 20 }))
        .toMatchObject({ status: 'rejected', code: 'unsupported' });
    } finally {
      await backend.close();
    }
  },
);

// --------------------------------------------------------------------------
// T-05 cap: >1000 window candidates (the two backends must agree), and an
// injected small cap that pages to the same set as an uncapped call.
// --------------------------------------------------------------------------

const capRows = [
  ...Array.from({ length: 1001 }, (_, index) =>
    widget('p1', `n${String(index).padStart(4, '0')}`, { topic: 'other' })),
  widget('p1', 'zzzz', { topic: 'needle' }),
];

it('T-05 both: more than 1000 prefix records yield the same records on both backends', async () => {
  const memory = await store('memory');
  const sqlite = await store('sqlite');
  try {
    await seedBatch(memory, capRows, 't05capm');
    await seedBatch(sqlite, capRows, 't05caps');
    const request = { index: 's4b-text', values: ['p1'], terms: ['needle'], limit: 20 };
    const memoryPage = await search(memory, request);
    const sqlitePage = await search(sqlite, request);
    expect({ memory: refs(memoryPage), sqlite: refs(sqlitePage) })
      .toEqual({ memory: [keyOf('p1', 'zzzz')], sqlite: [keyOf('p1', 'zzzz')] });
  } finally {
    await memory.close();
    await sqlite.close();
  }
});

it('T-05 both: more than 1000 prefix records yield the same next on both backends', async () => {
  const memory = await store('memory');
  const sqlite = await store('sqlite');
  try {
    await seedBatch(memory, capRows, 't05capm2');
    await seedBatch(sqlite, capRows, 't05caps2');
    const request = { index: 's4b-text', values: ['p1'], terms: ['needle'], limit: 20 };
    const memoryPage = await search(memory, request);
    const sqlitePage = await search(sqlite, request);
    expect({ memory: memoryPage.next, sqlite: sqlitePage.next })
      .toEqual({ memory: null, sqlite: null });
  } finally {
    await memory.close();
    await sqlite.close();
  }
});

it('T-05 both: more than 1000 prefix records yield the same complete on both backends', async () => {
  const memory = await store('memory');
  const sqlite = await store('sqlite');
  try {
    await seedBatch(memory, capRows, 't05capm3');
    await seedBatch(sqlite, capRows, 't05caps3');
    const request = { index: 's4b-text', values: ['p1'], terms: ['needle'], limit: 20 };
    const memoryPage = await search(memory, request);
    const sqlitePage = await search(sqlite, request);
    expect({ memory: memoryPage.complete, sqlite: sqlitePage.complete })
      .toEqual({ memory: true, sqlite: true });
  } finally {
    await memory.close();
    await sqlite.close();
  }
});

const smallCapRows = ['n1', 'n2', 'n3', 'n4', 'n5'].map((id) => widget('p1', id, { topic: 'shared' }));

it.each(['memory', 'sqlite'] as const)(
  'T-05 %s: an injected small candidate cap reports complete:false',
  async (kind) => {
    const backend = await storeWith(kind, { textSearchCandidateMax: 2 });
    try {
      await seedBatch(backend, smallCapRows, 't05small1');
      const page = await search(backend, { index: 's4b-text', values: ['p1'], terms: ['shared'], limit: 20 });
      expect(page.complete).toBe(false);
    } finally {
      await backend.close();
    }
  },
);

it.each(['memory', 'sqlite'] as const)(
  'T-05 %s: an injected small candidate cap returns a usable next',
  async (kind) => {
    const backend = await storeWith(kind, { textSearchCandidateMax: 2 });
    try {
      await seedBatch(backend, smallCapRows, 't05small2');
      const page = await search(backend, { index: 's4b-text', values: ['p1'], terms: ['shared'], limit: 20 });
      expect(page.next).toBe(keyOf('p1', 'n2'));
    } finally {
      await backend.close();
    }
  },
);

it.each(['memory', 'sqlite'] as const)(
  'T-05 %s: an injected small candidate cap pages to the uncapped set',
  async (kind) => {
    const capped = await storeWith(kind, { textSearchCandidateMax: 2 });
    const uncapped = await storeWith(kind);
    try {
      await seedBatch(capped, smallCapRows, 't05small3a');
      await seedBatch(uncapped, smallCapRows, 't05small3b');
      const cappedSet = (await pageThrough(capped, 20)).pages.flat();
      const uncappedSet = (await pageThrough(uncapped, 20)).pages.flat();
      expect(cappedSet).toEqual(uncappedSet);
    } finally {
      await capped.close();
      await uncapped.close();
    }
  },
);
