import { afterEach, expect, it } from 'vitest';
import { access, mkdir, mkdtemp, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { CppSourceIndex } from '../../src/data/workspace-reader/cpp-source-index.js';
import { WorkspaceSandbox } from '../../vendor/coding-agent/dist/public-api.js';
import { createExplorationTools } from '../../src/execution/worker-runtime/exploration-tools.js';
import { runObservedModel } from '../../src/execution/worker-runtime/observed-model-run.js';
import { DEFAULT_RUNTIME_BUDGET, ModelBudget } from '../../src/execution/worker-runtime/model-budget.js';
import type { ModelClientPort, ModelEvent, ModelRequest } from '../../vendor/coding-agent/dist/public-api.js';
const roots: string[] = [];
afterEach(async () => { for (const root of roots.splice(0)) await rm(root, { recursive: true, force: true }); });
async function fixture() {
  const root = await mkdtemp(join(tmpdir(), 'cpp-index-')); roots.push(root);
  await mkdir(join(root, 'include')); await mkdir(join(root, 'src')); await mkdir(join(root, 'private'));
  await writeFile(join(root, 'include/math.hpp'), '#pragma once\n#ifdef API_ENABLED\nint pick(int value);\ndouble pick(double value);\n#endif\n');
  await writeFile(join(root, 'src/math.cpp'), '#include "math.hpp"\nint pick(int value) { return value + 1; }\ndouble pick(double value) { return value + 0.5; }\n');
  await writeFile(join(root, 'src/main.cpp'), '#include "math.hpp"\nint main() { return pick(1); }\n');
  const config = ['src/main.cpp', 'src/math.cpp'].map(file => ({ directory: root, file: join(root, file), arguments: ['clang++', '-std=c++20', '-DAPI_ENABLED=1', '-I', join(root, 'include'), '-c', file, '-o', file + '.o'] }));
  await writeFile(join(root, 'compile_commands.json'), JSON.stringify(config));
  const ws = await WorkspaceSandbox.create(root, { deniedPrefixes: ['private'] });
  let commit = 'a'.repeat(40);
  const sourceAccess = { read: (p: string, n: number) => ws.read(p, n), allowed: (p: string) => !p.startsWith('private'), inventory: (signal: AbortSignal) => ws.listFiles(10000, { signal }), sourceIdentity: async () => ({ workspace: ws.identity, commit }) };
  return { root, ws, config, index: new CppSourceIndex(sourceAccess), sourceAccess, setCommit: (value: string) => { commit = value; } };
}

it('uses actual libclang and compile configuration to resolve headers, overloads and project references', async () => {
  const { index } = await fixture();
  const result = await index.query({ operation: 'definitions', path: 'src/main.cpp', line: 2, column: 22 });
  expect(result, JSON.stringify(result)).toMatchObject({ status: 'sourced', engine: 'libclang', engineVersion: expect.stringContaining('18.1.3'), results: [expect.objectContaining({ name: 'pick', path: 'src/math.cpp', line: 2 })], coverage: { hasErrors: false } });
  const refs = await index.query({ operation: 'references', path: 'include/math.hpp', line: 3, column: 6 });
  expect(refs, JSON.stringify(refs)).toMatchObject({ status: 'sourced', results: expect.arrayContaining([expect.objectContaining({ path: 'src/main.cpp', line: 2, declaration: false })]) });
  if (refs.status !== 'sourced') throw Error('missing libclang provider');
  expect(refs.results.filter(row => row['path'] === 'src/math.cpp' && row['line'] === 3)).toEqual([]);
  expect(await index.query({ operation: 'imports', path: 'src/main.cpp' })).toMatchObject({ status: 'sourced', results: [expect.objectContaining({ resolution: 'resolved', targets: [expect.objectContaining({ path: 'include/math.hpp' })] })] });
  expect(await index.query({ operation: 'calls', path: 'src/main.cpp' })).toMatchObject({ status: 'sourced', results: [expect.objectContaining({ resolution: 'static_candidate', targets: [expect.objectContaining({ path: 'src/math.cpp', line: 2 })] })] });
}, 60000);

it('invalidates dirty files, compile flags, inventory and commit and reports actual changes', async () => {
  const { root, index, config, setCommit } = await fixture();
  const first = await index.query({ operation: 'symbols' });
  if (first.status !== 'sourced') throw Error(JSON.stringify(first));
  await writeFile(join(root, 'src/math.cpp'), '#include "math.hpp"\nint replacement(int value) { return value; }\n');
  expect(await index.query({ operation: 'symbols', expectedSnapshot: first.snapshot })).toMatchObject({ status: 'stale' });
  const changed = await index.query({ operation: 'symbols', path: 'src/math.cpp' });
  expect(changed).toMatchObject({ status: 'sourced', changes: { modified: ['src/math.cpp'] }, results: expect.arrayContaining([expect.objectContaining({ name: 'replacement' })]) });
  if (changed.status !== 'sourced') throw Error('missing changed snapshot');
  config[0]!.arguments = config[0]!.arguments.filter(arg => arg !== '-DAPI_ENABLED=1');
  await writeFile(join(root, 'compile_commands.json'), JSON.stringify(config));
  expect(await index.query({ operation: 'symbols', expectedSnapshot: changed.snapshot })).toMatchObject({ status: 'stale' });
  const configured = await index.query({ operation: 'symbols' });
  if (configured.status !== 'sourced') throw Error('missing configured snapshot');
  setCommit('b'.repeat(40));
  expect(await index.query({ operation: 'symbols', expectedSnapshot: configured.snapshot })).toMatchObject({ status: 'stale' });
  await writeFile(join(root, 'include/extra.hpp'), 'struct Added {};\n');
  expect(await index.query({ operation: 'symbols' })).toMatchObject({ status: 'sourced', changes: { added: ['include/extra.hpp'] } });
}, 60000);

it('does not execute hostile compilation commands or load plugins and fails closed on unknown configuration', async () => {
  const { root, config, index } = await fixture();
  await writeFile(join(root, 'compile_commands.json'), JSON.stringify([{ directory: root, file: 'src/main.cpp', command: 'clang++ -c src/main.cpp; touch ' + join(root, 'MUST_NOT_EXIST') }]));
  expect(await index.query({ operation: 'symbols' })).toMatchObject({ status: 'unsupported' });
  await expect(access(join(root, 'MUST_NOT_EXIST'))).rejects.toThrow();
  config[0]!.arguments.push('-Xclang', '-load', '/tmp/plugin.so');
  await writeFile(join(root, 'compile_commands.json'), JSON.stringify(config));
  expect(await index.query({ operation: 'symbols' })).toMatchObject({ status: 'unsupported', message: expect.stringContaining('-Xclang') });
  config[0]!.arguments = ['clang++', '-I', '/etc', '-c', 'src/main.cpp'];
  await writeFile(join(root, 'compile_commands.json'), JSON.stringify(config));
  expect(await index.query({ operation: 'symbols' })).toMatchObject({ status: 'unsupported', message: expect.stringContaining('External compilation paths') });
}, 60000);

it('blocks source and include escapes, symbolic links and absent analyzer/config with explicit gaps', async () => {
  const { root, config, index, sourceAccess } = await fixture();
  expect(await index.query({ operation: 'symbols', path: '../secret.cpp' })).toMatchObject({ status: 'rejected' });
  expect(await index.query({ operation: 'symbols', path: 'private/secret.hpp' })).toMatchObject({ status: 'rejected' });
  const external = await mkdtemp(join(tmpdir(), 'cpp-index-external-')); roots.push(external);
  await writeFile(join(external, 'secret.hpp'), '#define HOST_SECRET 123\nstruct ExternalSecret {};\n');
  await writeFile(join(root, 'private/secret.hpp'), '#define PRIVATE_SECRET 123\n');
  await symlink(join(external, 'secret.hpp'), join(root, 'include/escape.hpp'));
  await writeFile(join(root, 'src/main.cpp'), `#include "${join(external, 'secret.hpp')}"\n#include "../private/secret.hpp"\n#include "escape.hpp"\n#ifdef HOST_SECRET\nstruct MUST_NOT_APPEAR {};\n#endif\nint main() { return 0; }\n`);
  const symbols = await index.query({ operation: 'symbols', path: 'src/main.cpp' });
  expect(symbols, JSON.stringify(symbols)).toMatchObject({ status: 'sourced', coverage: { hasErrors: true } });
  expect(JSON.stringify(symbols)).not.toContain('MUST_NOT_APPEAR');
  expect(JSON.stringify(symbols)).not.toContain('ExternalSecret');
  const includes = await index.query({ operation: 'imports', path: 'src/main.cpp' });
  expect(includes).toMatchObject({ status: 'sourced', results: expect.arrayContaining([expect.objectContaining({ resolution: 'unknown', targets: [] })]) });
  expect(await new CppSourceIndex(sourceAccess, { libraryPath: '/no-such-libclang.so' }).query({ operation: 'symbols' })).toMatchObject({ status: 'unsupported', message: expect.stringContaining('analyzer unavailable') });
  await rm(join(root, 'compile_commands.json'));
  expect(await index.query({ operation: 'symbols' })).toMatchObject({ status: 'unsupported', message: expect.stringContaining('requires a readable compile_commands') });
  await writeFile(join(root, 'compile_commands.json'), JSON.stringify(config));
}, 60000);

it('exposes the real libclang capability through the runtime read-only tool and uses UTF-16 coordinates', async () => {
  const { root, ws } = await fixture();
  await writeFile(join(root, 'src/main.cpp'), '#include "math.hpp"\nint main() { /* 汉字😀 */ return pick(1); }\n');
  const line = 'int main() { /* 汉字😀 */ return pick(1); }';
  const tool = createExplorationTools(ws).find(t => t.name === 'cpp_index')!;
  expect(tool).toMatchObject({ effectClass: 'read_only', requiredCapabilities: ['workspace_read'] });
  const result = await tool.handler.execute({ schemaVersion: 1, callId: 'cpp-real-tool', name: 'cpp_index', arguments: { operation: 'definitions', path: 'src/main.cpp', line: 2, column: line.indexOf('pick') + 1 } } as never, { signal: new AbortController().signal } as never);
  expect(result.status, JSON.stringify(result)).toBe('success');
  expect(JSON.stringify(result)).toContain('libclang');
  expect(JSON.stringify(result)).toContain('src/math.cpp');
  expect(JSON.stringify(result)).toContain('"sideEffect":"none"');
}, 60000);

it('delivers real C++ semantic tool output into the next model request through the shared kernel (labelled model stub)', async () => {
  const { root } = await fixture();
  const storage = await mkdtemp(join(tmpdir(), 'cpp-kernel-record-')); roots.push(storage);
  const requests: ModelRequest[] = [];
  const client: ModelClientPort = { async *stream(request): AsyncIterable<ModelEvent> {
    requests.push(structuredClone(request));
    const common = { schemaVersion: 1 as const, requestId: request.requestId };
    if (requests.length === 1) {
      yield { ...common, sequence: 1, type: 'tool_call_started', callId: 'cpp-kernel-call', name: 'cpp_index', ordinal: 0 };
      yield { ...common, sequence: 2, type: 'tool_arguments_delta', callId: 'cpp-kernel-call', delta: JSON.stringify({ operation: 'definitions', path: 'src/main.cpp', line: 2, column: 22 }) };
    } else yield { ...common, sequence: 1, type: 'text_delta', delta: 'Labelled model stub received the real libclang definition in src/math.cpp.' };
    yield { ...common, sequence: 3, type: 'usage_snapshot', usage: { inputTokens: 300, outputTokens: 30, cachedInputTokens: 0, costUsdMicros: null } };
    yield { ...common, sequence: 4, type: 'completed', reason: requests.length === 1 ? 'tool_calls' : 'final_answer' };
  } };
  const kernel = await import('../../vendor/coding-agent/dist/public-api.js');
  const meter = new ModelBudget(DEFAULT_RUNTIME_BUDGET, async () => {});
  const result = await runObservedModel({ kernel, bound: { configuration: { revision: 'cpp-test', provider: 'deepseek', model: 'labelled-cpp-model-stub', baseUrl: 'http://127.0.0.1' }, client }, meter,
    root, databasePath: join(storage, 'kernel.sqlite'), sessionId: 'cpp-source-real-kernel', input: 'Inspect the configured C++ pick definition without modifying source.', budget: DEFAULT_RUNTIME_BUDGET, readOnly: true,
    signal: new AbortController().signal, deniedPrefixes: ['private'], processSandboxOptions: {}, publish: async () => {} });
  expect(result.enabledTools).toContain('cpp_index');
  expect(requests).toHaveLength(2);
  expect(JSON.stringify(requests[1]!.messages)).toContain('libclang');
  expect(JSON.stringify(requests[1]!.messages)).toContain('src/math.cpp');
  expect(JSON.stringify(requests[1]!.messages)).toContain('c:@F@pick#I#');
  expect(meter.entries).toHaveLength(2);
}, 60000);

it('parses a quoted command as data, honors a C forced include, and rejects ambiguous compilation variants', async () => {
  const { root, index } = await fixture();
  await writeFile(join(root, 'include/config.h'), '#define C_RESULT 42\n');
  await writeFile(join(root, 'src/plain.c'), 'int c_value(void) { return C_RESULT; }\n');
  const entry = { directory: root, file: 'src/plain.c', command: 'clang -std=c11 -include "include/config.h" -c src/plain.c -o /tmp/NEVER_CREATED.o' };
  await writeFile(join(root, 'compile_commands.json'), JSON.stringify([entry]));
  const result = await index.query({ operation: 'symbols', path: 'src/plain.c' });
  expect(result, JSON.stringify(result)).toMatchObject({ status: 'sourced', coverage: { hasErrors: false }, results: expect.arrayContaining([expect.objectContaining({ name: 'c_value', kind: 'FunctionDecl' })]) });
  await writeFile(join(root, 'compile_commands.json'), JSON.stringify([entry, { ...entry, command: entry.command + ' -DOTHER_VARIANT=1' }]));
  expect(await index.query({ operation: 'symbols' })).toMatchObject({ status: 'unsupported', message: expect.stringContaining('Multiple compilation variants') });
}, 60000);

it('detects an observed source change during analysis instead of returning a current snapshot', async () => {
  const { root, sourceAccess } = await fixture();
  let captures = 0;
  const index = new CppSourceIndex({ ...sourceAccess, inventory: async signal => {
    captures++;
    if (captures === 2) await writeFile(join(root, 'include/math.hpp'), '#pragma once\nint now_changed();\n');
    return sourceAccess.inventory(signal);
  } });
  expect(await index.query({ operation: 'symbols' })).toMatchObject({ status: 'stale', message: expect.stringContaining('changed during analysis') });
}, 60000);
