import { cp, rm } from 'node:fs/promises';

/**
 * Copy the previous (`/legacy`) frontend assets from src/app/public into the
 * served dist tree. The React workbench is NOT copied here: Vite builds it
 * directly into dist/app/public/workbench (see src/ui/vite.config.ts), so a
 * clean build never depends on the previous build's output and no manual copy
 * is needed. Any leftover workbench directory from an older layout is removed so
 * a stale bundle can never be served.
 */
const legacy = new URL('../src/app/public/', import.meta.url);
const target = new URL('../dist/app/public/', import.meta.url);
await rm(new URL('workbench', target), { recursive: true, force: true });
await cp(legacy, target, {
  recursive: true,
  filter: source => !String(source).replaceAll('\\', '/').includes('/public/workbench'),
});
await cp(new URL('../src/app/terminal-sandbox.py', import.meta.url), new URL('../dist/app/terminal-sandbox.py', import.meta.url));
