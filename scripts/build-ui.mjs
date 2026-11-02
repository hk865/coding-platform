/**
 * Build the board shell into the Host's existing static directory.
 *
 * `src/ui/boot.ts` becomes `support.js` (the file every frozen board already
 * loads); the ten boards and `kit.css` are copied byte-identical from the
 * reference directory; `index.html` lists the boards so `/workbench/` shows
 * them. esbuild is already a dev dependency; nothing is added.
 */
import { build } from 'esbuild';
import { cp, mkdir, readdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const boardsDir = join(root, 'docs/ui-reference/workbench-2026-10');
const outDir = join(root, 'dist/app/public/workbench');

const boards = (await readdir(boardsDir)).filter((name) => name.endsWith('.dc.html')).sort();
if (boards.length !== 10) throw new Error(`expected 10 .dc.html boards, found ${boards.length}`);

await mkdir(outDir, { recursive: true });
await build({
  entryPoints: [join(root, 'src/ui/boot.ts')],
  bundle: true,
  format: 'iife',
  platform: 'browser',
  target: 'es2022',
  outfile: join(outDir, 'support.js'),
  logLevel: 'warning',
});
for (const name of boards) await cp(join(boardsDir, name), join(outDir, name));
await cp(join(boardsDir, 'kit.css'), join(outDir, 'kit.css'));

const items = await Promise.all(boards.map(async (name) => {
  const html = await readFile(join(boardsDir, name), 'utf8');
  const title = /<title>([\s\S]*?)<\/title>/.exec(html)?.[1]?.trim() ?? name;
  return `      <li><a href="/workbench/${name}">${escapeHtml(title)}</a></li>`;
}));
await writeFile(join(outDir, 'index.html'), `<!doctype html>
<html lang="zh-CN">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>工作台画板</title>
<style>
  :root { color-scheme: dark; }
  body { margin: 0; padding: 48px; background: #1f1f1f; color: #e8e8e8;
    font: 15px/1.6 "IBM Plex Sans", "Noto Sans SC", system-ui, sans-serif; }
  h1 { margin: 0 0 8px; font-size: 22px; font-weight: 500; }
  p { margin: 0 0 28px; color: #9a9a9a; }
  ul { margin: 0; padding: 0; list-style: none; display: grid; gap: 10px;
    grid-template-columns: repeat(auto-fill, minmax(260px, 1fr)); }
  a { display: block; padding: 12px 16px; border: 1px solid #3a3a3a; border-radius: 8px;
    color: inherit; text-decoration: none; }
  a:hover, a:focus-visible { border-color: #7a7a7a; background: #262626; outline: none; }
</style>
</head>
<body>
<h1>工作台画板</h1>
<p>2026-10-07 冻结的十块画板，按画板自己的示例数据运行。</p>
<ul>
${items.join('\n')}
</ul>
</body>
</html>
`);

function escapeHtml(value) {
  return value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}
