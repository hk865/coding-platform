const escape = value => String(value ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

// Deliberately small Markdown vocabulary. Raw HTML and embedded media stay text.
export function safeLink(value) {
  const href = String(value).trim();
  if (/[\u0000-\u0020\u007f]/u.test(href)) return null;
  try {
    const url = new URL(href);
    return ['https:', 'http:', 'mailto:'].includes(url.protocol) ? url.href : null;
  } catch { return null; }
}
function inline(value, depth = 0) {
  if (depth > 8) return escape(value);
  const pattern = /`([^`\n]+)`|\[([^\]\n]+)\]\(([^\s)]+)\)|\*\*([^*\n]+)\*\*|\*([^*\n]+)\*/g;
  let html = '', end = 0;
  for (const m of value.matchAll(pattern)) {
    html += escape(value.slice(end, m.index));
    if (m[1] !== undefined) html += '<code>' + escape(m[1]) + '</code>';
    else if (m[2] !== undefined) {
      const href = safeLink(m[3]);
      html += href ? '<a href="' + escape(href) + '" target="_blank" rel="noopener noreferrer">' + inline(m[2], depth + 1) + '</a>' : escape(m[0]);
    } else if (m[4] !== undefined) html += '<strong>' + inline(m[4], depth + 1) + '</strong>';
    else html += '<em>' + inline(m[5], depth + 1) + '</em>';
    end = m.index + m[0].length;
  }
  return html + escape(value.slice(end));
}
export function renderMarkdown(value, depth = 0) {
  if (depth > 8) return '<p>' + escape(value) + '</p>';
  const lines = String(value ?? '').replace(/\r\n?/g, '\n').split('\n');
  const blocks = [];
  for (let i = 0; i < lines.length;) {
    const line = lines[i];
    if (!line.trim()) { i++; continue; }
    const fence = line.match(/^\s*(`{3,}|~{3,})/);
    if (fence) {
      const code = []; i++;
      while (i < lines.length && !new RegExp('^\\s*' + fence[1][0] + '{' + fence[1].length + ',}\\s*$').test(lines[i])) code.push(lines[i++]);
      if (i < lines.length) i++;
      blocks.push('<pre><code>' + escape(code.join('\n')) + '</code></pre>'); continue;
    }
    const heading = line.match(/^\s{0,3}(#{1,6})\s+(.+?)\s*#*$/);
    if (heading) { const level = Math.min(heading[1].length + 1, 6); blocks.push('<h' + level + '>' + inline(heading[2]) + '</h' + level + '>'); i++; continue; }
    if (/^\s*([-*_])(?:\s*\1){2,}\s*$/.test(line)) { blocks.push('<hr>'); i++; continue; }
    if (/^\s*>\s?/.test(line)) {
      const quote = [];
      while (i < lines.length && /^\s*>/.test(lines[i])) quote.push(lines[i++].replace(/^\s*>\s?/, ''));
      blocks.push('<blockquote>' + renderMarkdown(quote.join('\n'), depth + 1) + '</blockquote>'); continue;
    }
    const list = line.match(/^\s*(?:([-+*])|(\d+)[.)])\s+(.+)/);
    if (list) {
      const ordered = !!list[2], items = [];
      const matcher = ordered ? /^\s*\d+[.)]\s+(.+)/ : /^\s*[-+*]\s+(.+)/;
      while (i < lines.length) {
        const match = lines[i].match(matcher); if (!match) break;
        items.push('<li>' + inline(match[1]) + '</li>'); i++;
      }
      const tag = ordered ? 'ol' : 'ul';
      blocks.push('<' + tag + '>' + items.join('') + '</' + tag + '>'); continue;
    }
    const paragraph = [line]; i++;
    while (i < lines.length && lines[i].trim() && !/^\s*(?:#{1,6}\s|`{3,}|~{3,}|>|[-+*]\s|\d+[.)]\s)/.test(lines[i])) paragraph.push(lines[i++]);
    blocks.push('<p>' + inline(paragraph.join('\n')).replace(/\n/g, '<br>') + '</p>');
  }
  return blocks.join('\n');
}
export function readableTitle(instruction, fallback = '编码任务') {
  const lines = String(instruction ?? '').split(/\r?\n/).map(line => line.replace(/^\s*#+\s*/, '').trim()).filter(Boolean);
  let title = lines.find(line => !/^(title|标题)\s*[:：]?$/i.test(line)) ?? fallback;
  title = title.replace(/^(title|标题)\s*[:：]\s*/i, '').replace(/[*_`]/g, '');
  return title.length > 100 ? title.slice(0, 99) + '…' : title;
}
