// Session Markdown renderer.
//
// One local `marked@18.0.14` instance turns real assistant/user prose into safe
// HTML. The function is pure (`string -> string`): no DOM, no network, no store.
// Safety contract enforced here, not by the caller:
//   - raw inline/block HTML is ESCAPED and shown as text, never executed;
//   - a link keeps an `href` ONLY for an explicit `https://`, `http://` or
//     `mailto:` destination with no control characters. Every other scheme
//     (`javascript:`, `data:`, `vbscript:`, `ftp:`) and every entity or
//     whitespace obfuscation is rendered as plain link text with NO href;
//   - an image never emits `<img>`/`src`, so no remote resource is auto-loaded:
//     it renders as its escaped text label;
//   - normal Markdown structure (headings, paragraphs, emphasis, inline code,
//     fenced code, lists, blockquotes, tables) is kept;
//   - the full text is rendered and never truncated.
import { Marked, type Tokens } from 'marked';

function escapeMarkdownHtml(value: unknown): string {
  return String(value)
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}

/** Only an explicit, unambiguous safe scheme keeps an href. Control characters
 * (including NUL/tab/newline) disqualify the destination outright. No HTML
 * entity decoder is needed: an entity-obfuscated destination simply does not
 * start with an allowed scheme, so it is rejected as text. */
function safeHref(href: unknown): string | null {
  if (typeof href !== 'string' || href.length === 0) return null;
  for (const character of href) {
    const code = character.charCodeAt(0);
    if (code < 0x20 || code === 0x7f) return null;
  }
  if (href.startsWith('https://') || href.startsWith('http://') || href.startsWith('mailto:')) return href;
  return null;
}

const markdown = new Marked({
  gfm: true,
  breaks: false,
  renderer: {
    html({ text }: Tokens.HTML | Tokens.Tag): string {
      return escapeMarkdownHtml(text);
    },
    link({ href, title, text, tokens, autolink }: Tokens.Link): string {
      const label = autolink === true ? escapeMarkdownHtml(text) : this.parser.parseInline(tokens);
      const safe = safeHref(href);
      if (safe === null) return label;
      const titleAttribute = typeof title === 'string' && title.length > 0
        ? ` title="${escapeMarkdownHtml(title)}"` : '';
      return `<a href="${escapeMarkdownHtml(safe)}"${titleAttribute} rel="noreferrer noopener" target="_blank">${label}</a>`;
    },
    image({ text }: Tokens.Image): string {
      return `<span class="md-image">${escapeMarkdownHtml(text)}</span>`;
    },
    // A fenced code block gets a language label plus small copy/wrap actions.
    // The code text stays escaped inside the same literal `<pre><code>` shape;
    // the caller reads that element's textContent, never this innerHTML.
    code({ text, lang, escaped }: Tokens.Code): string {
      const language = typeof lang === 'string' ? (lang.match(/\S+/)?.[0] ?? '') : '';
      const label = language.length > 0 ? language : 'text';
      const code = escaped ? String(text) : escapeMarkdownHtml(text);
      const languageAttribute = language.length > 0 ? ` data-lang="${escapeMarkdownHtml(language)}"` : '';
      const className = language.length > 0 ? ` class="language-${escapeMarkdownHtml(language)}"` : '';
      return `<div class="md-code" data-code-block${languageAttribute}>`
        + `<div class="md-code-bar"><span class="md-code-lang">${escapeMarkdownHtml(label)}</span>`
        + `<button type="button" class="md-code-action" data-action="copy-code" aria-label="复制代码">复制</button>`
        + `<button type="button" class="md-code-action" data-action="toggle-code-wrap" aria-label="切换自动换行" aria-pressed="false">换行</button></div>`
        + `<pre><code${className}>${code}</code></pre></div>`;
    },
  },
});

/** Render one saved user/assistant body. Empty input stays empty; the caller is
 * responsible for any surrounding message element. */
export function renderMarkdown(text: string): string {
  if (typeof text !== 'string' || text.length === 0) return '';
  return markdown.parse(text) as string;
}
