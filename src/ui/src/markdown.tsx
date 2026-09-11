/**
 * Deliberately small Markdown renderer for untrusted model output.
 * Raw HTML, embedded media and unsafe URL schemes stay inert text.
 * Ported from the legacy browser renderer with the same vocabulary and escapes.
 */
const escapeHtml = (value: unknown): string => String(value ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c] as string));

export function safeLink(value: unknown): string | null {
  const href = String(value).trim();
  if (/[\u0000-\u0020\u007f]/u.test(href)) return null;
  try {
    const url = new URL(href);
    return ['https:', 'http:', 'mailto:'].includes(url.protocol) ? url.href : null;
  } catch { return null; }
}

function inline(value: string, depth = 0): string {
  if (depth > 8) return escapeHtml(value);
  const pattern = /\`([^\`\n]+)\`|\[([^\]\n]+)\]\(([^\s)]+)\)|\*\*([^*\n]+)\*\*|\*([^*\n]+)\*/g;
  let html = '', end = 0;
  for (const match of value.matchAll(pattern)) {
    html += escapeHtml(value.slice(end, match.index));
    if (match[1] !== undefined) html += '<code>' + escapeHtml(match[1]) + '</code>';
    else if (match[2] !== undefined) {
      const href = safeLink(match[3]);
      html += href ? '<a href="' + escapeHtml(href) + '" target="_blank" rel="noopener noreferrer">' + inline(match[2], depth + 1) + '</a>' : escapeHtml(match[0]);
    } else if (match[4] !== undefined) html += '<strong>' + inline(match[4], depth + 1) + '</strong>';
    else html += '<em>' + inline(match[5] ?? '', depth + 1) + '</em>';
    end = match.index + match[0].length;
  }
  return html + escapeHtml(value.slice(end));
}

export function renderMarkdown(value: unknown, depth = 0): string {
  if (depth > 8) return '<p>' + escapeHtml(value) + '</p>';
  const lines = String(value ?? '').replace(/\r\n?/g, '\n').split('\n');
  const blocks: string[] = [];
  for (let i = 0; i < lines.length;) {
    const line = lines[i] ?? '';
    if (!line.trim()) { i++; continue; }
    const fence = line.match(/^\s*(`{3,}|~{3,})/);
    if (fence) {
      const code: string[] = []; i++;
      const closer = new RegExp('^\\s*' + fence[1]![0] + '{' + fence[1]!.length + ',}\\s*$');
      while (i < lines.length && !closer.test(lines[i] ?? '')) code.push(lines[i++] ?? '');
      if (i < lines.length) i++;
      blocks.push('<pre><code>' + escapeHtml(code.join('\n')) + '</code></pre>'); continue;
    }
    const heading = line.match(/^\s{0,3}(#{1,6})\s+(.+?)\s*#*$/);
    if (heading) { const level = Math.min(heading[1]!.length + 1, 6); blocks.push('<h' + level + '>' + inline(heading[2] ?? '') + '</h' + level + '>'); i++; continue; }
    if (/^\s*([-*_])(?:\s*\1){2,}\s*$/.test(line)) { blocks.push('<hr>'); i++; continue; }
    if (/^\s*>\s?/.test(line)) {
      const quote: string[] = [];
      while (i < lines.length && /^\s*>/.test(lines[i] ?? '')) quote.push((lines[i++] ?? '').replace(/^\s*>\s?/, ''));
      blocks.push('<blockquote>' + renderMarkdown(quote.join('\n'), depth + 1) + '</blockquote>'); continue;
    }
    const list = line.match(/^\s*(?:([-+*])|(\d+)[.)])\s+(.+)/);
    if (list) {
      const ordered = !!list[2]; const items: string[] = [];
      const matcher = ordered ? /^\s*\d+[.)]\s+(.+)/ : /^\s*[-+*]\s+(.+)/;
      while (i < lines.length) {
        const match = (lines[i] ?? '').match(matcher); if (!match) break;
        items.push('<li>' + inline(match[1] ?? '') + '</li>'); i++;
      }
      const tag = ordered ? 'ol' : 'ul';
      blocks.push('<' + tag + '>' + items.join('') + '</' + tag + '>'); continue;
    }
    const paragraph: string[] = [line]; i++;
    while (i < lines.length && (lines[i] ?? '').trim() && !/^\s*(?:#{1,6}\s|`{3,}|~{3,}|>|[-+*]\s|\d+[.)]\s)/.test(lines[i] ?? '')) paragraph.push(lines[i++] ?? '');
    blocks.push('<p>' + inline(paragraph.join('\n')).replace(/\n/g, '<br>') + '</p>');
  }
  return blocks.join('\n');
}

export function readableTitle(instruction: unknown, fallback = '编码任务'): string {
  const lines = String(instruction ?? '').split(/\r?\n/).map(line => line.replace(/^\s*#+\s*/, '').trim()).filter(Boolean);
  let title = lines.find(line => !/^(title|标题)\s*[:：]?$/i.test(line)) ?? fallback;
  title = title.replace(/^(title|标题)\s*[:：]\s*/i, '').replace(/[*_`]/g, '');
  return title.length > 100 ? title.slice(0, 99) + '…' : title;
}

export function Markdown({ text }: { text: string }) {
  return <div className="markdown-body" dangerouslySetInnerHTML={{ __html: renderMarkdown(text) }} />;
}

