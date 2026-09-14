/**
 * Fixture host for workbench browser tests and manual verification.
 *
 * Serves the real Node application (dist/app/server.js) with two isolated project
 * roots, so tests exercise the actual HTTP API, workspace tools and SQLite store.
 */
import { createGuiServer } from '../../../dist/app/server.js';
import { mkdir, writeFile, rm, mkdtemp } from 'node:fs/promises';
import { resolve } from 'node:path';
import {tmpdir} from 'node:os';
import {createBuiltinProviderRegistry} from '../../../vendor/coding-agent/dist/public-api.js';

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
const builtin=createBuiltinProviderRegistry();
const modelDirectory=process.env['MEMORY_MODEL_STUB']==='1'?await mkdtemp(resolve(tmpdir(),'cm1b-browser-model-')):null;
const memoryClient={async *stream(request){
  const input=request.messages.filter(message=>message.role==='user').map(message=>message.content).join('\n');
  const common={schemaVersion:1,requestId:request.requestId};
  yield {...common,sequence:1,type:'text_delta',delta:input.includes('MEMORY_ARCH_DETAIL_browser')?'架构详细：说明模块职责、接口边界和方案取舍。此处是确定性模型见证。':'简洁回复。'};
  yield {...common,sequence:2,type:'usage_snapshot',usage:{inputTokens:100,outputTokens:20,cachedInputTokens:0,costUsdMicros:null}};
  yield {...common,sequence:3,type:'completed',reason:'final_answer'};
}};
const app = await createGuiServer(data, { workspaceRoots: { 'acceptance-alpha': alpha, 'acceptance-beta': beta }, fixtureExecution: true,
  ...(modelDirectory?{modelSettings:{directory:modelDirectory,registry:{list:()=>builtin.list(),get:id=>builtin.get(id),create:()=>memoryClient}}}:{}) });
await new Promise(done => app.server.listen(port, '127.0.0.1', done));
console.log('READY http://127.0.0.1:' + port + '/workbench');
const shutdown = async () => { await app.close();if(modelDirectory)await rm(modelDirectory,{recursive:true,force:true}); process.exit(0); };
process.once('SIGTERM', () => { void shutdown(); });
process.once('SIGINT', () => { void shutdown(); });
