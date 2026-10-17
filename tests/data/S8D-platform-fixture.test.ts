/**
 * Smoke entry for the shared Slice 8D platform fixture: a tiny Python project
 * observed through the public capture/list/compare path on memory and SQLite,
 * plus one post-capture workspace write that must appear in the next graph.
 */
import { describe, expect, it } from 'vitest';
import { BACKENDS, fixture } from '../helpers/S8D-platform-fixture.js';

describe.each(BACKENDS)('S8D platform fixture [%s]', backend => {
  it('observes e.py -> g.py and includes a file written after fixture creation', async () => {
    const fx = await fixture(backend, 's8d-platform-fixture', [
      ['e.py', 'import g\n'],
      ['g.py', 'x = 1\n'],
    ]);
    try {
      const graph = await fx.graph();
      expect(graph.nodes).toEqual([
        { path: 'e.py', nonBlankLines: 1, language: 'python' },
        { path: 'g.py', nonBlankLines: 1, language: 'python' },
      ]);
      expect(graph.edges).toEqual([{ from: 'e.py', to: 'g.py' }]);
      expect(graph.unresolved).toEqual([]);
      expect(graph.complete).toBe(true);
      expect(graph.languages).toEqual([{
        language: 'python', files: 2, parsed: 2, edges: 'supported', reason: null, notes: [],
        issues: [], issueCount: 0, complete: true,
      }]);

      await fx.write('h.py', 'import g\n\ny = g.x + 1\n');
      const afterWrite = await fx.graph();
      expect(afterWrite.nodes.map(node => node.path)).toContain('h.py');
      expect(afterWrite.edges).toContainEqual({ from: 'h.py', to: 'g.py' });
      expect(afterWrite.languages.find(entry => entry.language === 'python')?.files).toBe(3);
    } finally {
      await fx.close();
    }
  });
});
