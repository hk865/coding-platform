import { describe, expect, it } from 'vitest';
// Browser modules intentionally ship as dependency-free JavaScript.
// @ts-expect-error Browser JavaScript has no declaration file.
import { renderMarkdown, readableTitle, safeLink } from '../../src/app/public/markdown.js';
// @ts-expect-error Browser JavaScript has no declaration file.
import { summarizeUsage } from '../../src/app/public/live-runs.js';

describe('live run human-readable content', () => {
  it('renders issue headings, code, lists and links without interpreting raw HTML', () => {
    const html = renderMarkdown('## Title\n\nChat allow list\n\n- **Keep regressions**\n- Use `uids`\n\n```js\nconst value = "<script>";\n```\n\n[Docs](https://example.com/?a=1&b=2)');
    expect(html).toContain('<h3>Title</h3>');
    expect(html).toContain('<li><strong>Keep regressions</strong></li>');
    expect(html).toContain('<code>uids</code>');
    expect(html).toContain('&lt;script&gt;');
    expect(html).toContain('rel="noopener noreferrer"');
    expect(html).toContain('https://example.com/?a=1&amp;b=2');
    expect(readableTitle('## Title\n\nChat allow list\n\n## Description')).toBe('Chat allow list');
  });
  it('never emits active HTML, image loads, unsafe schemes or attribute injection', () => {
    const html = renderMarkdown('<img src=x onerror=alert(1)>\n\n<script>alert(1)</script>\n\n[x](javascript:alert) [y](data:text/html,bad) [z](vbscript:bad) [encoded](java&#x73;cript:bad)\n\n![no image](https://example.com/pixel)');
    expect(html).not.toMatch(/<(script|img|iframe|style)\b/);
    expect(html).not.toMatch(/href="(?:javascript|data|vbscript):/);
    expect(html).toContain('&lt;img');
    expect(safeLink('javascript:alert(1)')).toBeNull();
    expect(safeLink('https://example.com/" onclick="bad')).toBeNull();
    expect(safeLink('java\nscript:alert')).toBeNull();
  });
  it('keeps unknown usage visibly incomplete without reporting reservations as actual usage', () => {
    expect(summarizeUsage([
      { status: 'reported', inputTokens: 40000, outputTokens: 500, cachedInputTokens: 20000 },
      { status: 'reported', inputTokens: 40000, outputTokens: 700 },
      { status: 'unknown', reservedInput: 500000, reservedOutput: 10000 },
    ])).toEqual({ input: 80000, output: 1200, cached: 20000, requests: 3, unknown: 1 });
  });
});
