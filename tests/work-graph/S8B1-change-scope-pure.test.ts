/**
 * B1-07a/b of the frozen test sheet (`darr-b1-tests.frozen.md` §2.2, the sheet): the pure fold of
 * one Goal's actual changes, with values (never a record, a store, a Host or a context).
 *
 * `changeScopeOf(catalog, files, complete, sourceCursor)` is B1's fold. The catalog is §1.1's
 * `src` / `other` / `lib` (its module-internal interfaces matter); the files are the port DTO's
 * `{path, certainty}` shape. Expected literals are the sheet's hand computation.
 */
import { describe, expect, it } from 'vitest';
// @ts-ignore -- the B1 read module is not in the pre-build tree; the row's seam is this export.
import { changeScopeOf } from '../../src/core/work-graph/views/architecture-change-scope-reader.js';
import { s8b1Catalog } from '../helpers/S8B1-count-world.js';

const PROJECT = 'ag2b-collab-project';

type FileRow = { path: string; certainty: 'definite' | 'possible';
  moduleRef: { projectId: string; moduleId: string } | null; interfaceId: string | null };
type ModuleRow = { moduleRef?: { projectId: string; moduleId: string }; moduleId?: string;
  changed: number; possible: number };
type ChangeScope = {
  files: FileRow[];
  counts: { files: number; changed: number; possible: number };
  modules: ModuleRow[];
  complete: boolean;
};

const catalog = { requireDag: true, dependencies: [], ...s8b1Catalog(PROJECT) };
const fold = (files: Array<{ path: string; certainty: 'definite' | 'possible' }>, complete: boolean): ChangeScope =>
  changeScopeOf(catalog, files, complete, null) as unknown as ChangeScope;

const moduleIdOf = (row: ModuleRow): string | undefined => row.moduleRef?.moduleId ?? row.moduleId;

describe('S8B1 changeScopeOf pure fold', () => {
  it('B1-07a a definite and a possible row of the same path merge to definite; interface ids follow the catalog', () => {
    const scope = fold([
      { path: 'src/a.ts', certainty: 'definite' },
      { path: 'src/a.ts', certainty: 'possible' },
      { path: 'src/other/x.ts', certainty: 'possible' },
    ], true);
    expect(scope.files).toEqual([
      { path: 'src/a.ts', certainty: 'definite',
        moduleRef: { projectId: PROJECT, moduleId: 'src' }, interfaceId: 'a' },
      { path: 'src/other/x.ts', certainty: 'possible',
        moduleRef: { projectId: PROJECT, moduleId: 'other' }, interfaceId: null },
    ]);
    expect(scope.counts).toEqual({ files: 2, changed: 1, possible: 1 });
    expect(scope.modules
      .map(row => ({ moduleId: moduleIdOf(row), changed: row.changed, possible: row.possible }))
      .sort((left, right) => String(left.moduleId).localeCompare(String(right.moduleId))))
      .toEqual([
        { moduleId: 'other', changed: 0, possible: 1 },
        { moduleId: 'src', changed: 1, possible: 0 },
      ]);
  });

  it('B1-07b a file no catalog path owns stays moduleRef:null and adds no module row', () => {
    const scope = fold([{ path: 'vendor/loose.ts', certainty: 'definite' }], true);
    expect(scope.files).toEqual([
      { path: 'vendor/loose.ts', certainty: 'definite', moduleRef: null, interfaceId: null },
    ]);
    expect(scope.counts).toEqual({ files: 1, changed: 1, possible: 0 });
    expect(scope.modules).toEqual([]);
  });
});
