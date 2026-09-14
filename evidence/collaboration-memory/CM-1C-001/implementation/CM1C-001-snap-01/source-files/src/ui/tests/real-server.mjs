/**
 * Real-model host for the UI-12 acceptance run.
 *
 * Uses the operator's stored model credential directory (no key is copied into the
 * project or into this script) and an independent project root, so the run is a
 * real coding-agent run rather than a fixture.
 */
import { createGuiServer } from '../../../dist/app/server.js';
import { mkdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';

const repo = resolve(import.meta.dirname, '../../..');
const data = resolve(process.env['UI12_DATA'] ?? repo + '/.local/ui12-data');
const project = resolve(process.env['UI12_PROJECT'] ?? '/tmp/ui12-acceptance-project');
const dummy = resolve(process.env['UI12_DUMMY'] ?? '/tmp/ui12-acceptance-dummy');
const settingsDirectory = process.env['UI12_SETTINGS_DIR'];
const port = Number(process.env['UI12_PORT'] ?? 4400);
await mkdir(data, { recursive: true });
await mkdir(dummy, { recursive: true });
await writeFile(dummy + '/README.md', 'isolated control project\n').catch(() => {});

const app = await createGuiServer(data, {
  workspaceRoots: { 'acceptance-alpha': project, 'acceptance-beta': dummy },
  ...(settingsDirectory ? { modelSettings: { directory: settingsDirectory } } : {}),
});
await new Promise(done => app.server.listen(port, '127.0.0.1', done));
console.log('READY http://127.0.0.1:' + port + '/workbench');
const shutdown = async () => { await app.close(); process.exit(0); };
process.once('SIGTERM', () => { void shutdown(); });
process.once('SIGINT', () => { void shutdown(); });
