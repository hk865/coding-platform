import { describe, expect, it } from 'vitest';
import { readableTitle, renderMarkdown, safeLink } from '../../src/ui/src/markdown';
import { summarizeUsage } from '../../src/ui/src/format';
import { changesFromRuns } from '../../src/ui/src/features/diff';
import { clampNumber } from '../../src/ui/src/state/layout';

describe('untrusted model output rendering', () => {
  it('renders a small safe subset and never emits active HTML', () => {
    const html = renderMarkdown('## Title\n\n- **bold** and \`code\`\n\n\`\`\`js\nconst x = "<script>";\n\`\`\`\n\n[Docs](https://example.com/?a=1&b=2)');
    expect(html).toContain('<h3>Title</h3>');
    expect(html).toContain('<li><strong>bold</strong> and <code>code</code></li>');
    expect(html).toContain('&lt;script&gt;');
    expect(html).toContain('rel="noopener noreferrer"');
    expect(readableTitle('## Implement word count\n\nbody')).toBe('Implement word count');
    // A line that is only the label "Title" is skipped on purpose, as in the legacy renderer.
    expect(readableTitle('Title\n\nChat allow list')).toBe('Chat allow list');

    const hostile = renderMarkdown('<img src=x onerror=alert(1)>\n\n<script>alert(1)</script>\n\n[x](javascript:alert) [y](data:text/html,bad)');
    expect(hostile).not.toMatch(/<(script|img|iframe|style)\b/);
    expect(hostile).not.toMatch(/href="(?:javascript|data|vbscript):/);
    expect(safeLink('javascript:alert(1)')).toBeNull();
    expect(safeLink('https://example.com/" onclick="bad')).toBeNull();
  });

  it('never reports reserved tokens as measured usage', () => {
    expect(summarizeUsage([
      { requestId: '1', status: 'reported', inputTokens: 40000, outputTokens: 500, cachedInputTokens: 20000 },
      { requestId: '2', status: 'reported', inputTokens: 40000, outputTokens: 700 },
      { requestId: '3', status: 'unknown', reservedInput: 500000, reservedOutput: 10000 },
    ])).toEqual({ input: 80000, output: 1200, cached: 20000, requests: 3, unknown: 1 });
  });

  it('derives file changes from run tool calls only, and never invents a git diff', () => {
    const data = {
      liveRuns: [{
        spec: { runId: 'run-1' },
        trace: [
          { sequence: 1, type: 'tool.started', at: '2026-01-01T00:00:00.000Z', data: { call: { callId: 'c1', name: 'edit', arguments: { path: 'src/a.ts', oldString: 'old', newString: 'new' } } } },
          { sequence: 2, type: 'tool.completed', at: '2026-01-01T00:00:01.000Z', data: { callId: 'c1', call: { callId: 'c1', name: 'edit', arguments: { path: 'src/a.ts', oldString: 'old', newString: 'new' } } } },
          { sequence: 3, type: 'tool.completed', at: '2026-01-01T00:00:02.000Z', data: { callId: 'c2', call: { callId: 'c2', name: 'read', arguments: { path: 'src/b.ts' } } } },
        ],
      }],
    };
    const changes = changesFromRuns(data as never);
    expect(changes).toHaveLength(1);
    expect(changes[0]).toMatchObject({ runId: 'run-1', path: 'src/a.ts', tool: 'edit', before: 'old', after: 'new' });
  });

  it('clamps persisted numbers into range', () => {
    expect(clampNumber(9999, 160, 380, 240)).toBe(380);
    expect(clampNumber('x', 160, 380, 240)).toBe(240);
    expect(clampNumber(120, 160, 380, 240)).toBe(160);
  });
});
