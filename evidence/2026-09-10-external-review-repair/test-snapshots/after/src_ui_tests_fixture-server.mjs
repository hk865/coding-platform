/**
 * Fixture host for workbench browser tests and manual verification.
 *
 * Serves the real Node application (dist/app/server.js) with two isolated project
 * roots, so tests exercise the actual HTTP API, workspace tools and SQLite store.
 */
import { createGuiServer } from '../../../dist/app/server.js';
import { mkdir, writeFile, rm } from 'node:fs/promises';
import { resolve } from 'node:path';

const root = resolve(process.env['FIXTURE_DIR'] ?? '.local/ui-fixture');
const data = resolve(process.env['FIXTURE_DATA'] ?? '.local/ui-fixture-data');
const port = Number(process.env['PORT'] ?? 4399);
if (process.env['FIXTURE_RESET'] === '1') { await rm(root, { recursive: true, force: true }); await rm(data, { recursive: true, force: true }); }

const alpha = resolve(root, 'alpha');
const beta = resolve(root, 'beta');
await mkdir(resolve(alpha, 'src'), { recursive: true });
await mkdir(resolve(alpha, 'tests'), { recursive: true });
await mkdir(beta, { recursive: true });
await writeFile(resolve(alpha, 'README.md'), '# Alpha fixture\n\nA small project used by the workbench browser tests.\n');
await writeFile(resolve(alpha, 'src/app.py'), ['def add(a, b):', '    return a + b', '', 'def main():', '    print(add(1, 2))', ''].join('\n'));
await writeFile(resolve(alpha, 'tests/test_app.py'), ['from src.app import add', '', 'def test_add():', '    assert add(1, 2) == 3', ''].join('\n'));
await writeFile(resolve(beta, 'README.md'), '# Beta fixture\n');
await mkdir(data, { recursive: true });

// Browser suites that assert the sample/fixture affordances must enable that
// executor explicitly; it is never inferred from a plan identifier shape.
const app = await createGuiServer(data, { workspaceRoots: { 'acceptance-alpha': alpha, 'acceptance-beta': beta }, fixtureExecution: true });
await new Promise(done => app.server.listen(port, '127.0.0.1', done));
console.log('READY http://127.0.0.1:' + port + '/workbench');
const shutdown = async () => { await app.close(); process.exit(0); };
process.once('SIGTERM', () => { void shutdown(); });
process.once('SIGINT', () => { void shutdown(); });
