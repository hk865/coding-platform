/**
 * K3-07 support (spec §5.2 row K3-07, §5.4): the parent side of the real
 * out-of-process Host kill.
 *
 * The Host itself runs in `tests/helpers/K3-07-host-child.mjs` on the build
 * output (`dist/`), because Node is v24 and no TS loader (`vite-node`, `tsx`,
 * `ts-node`) is installed. This module holds only the pieces the parent test
 * needs around that process:
 *
 * - the startup JSON the child's production `loadWorkbenchCliConfig` reads: the
 *   same shape `startAG2bHost` writes (tests/helpers/AG2b-collaboration-fixture.ts),
 *   with `'shell'` added to the Work grant. The Work runs a real command, so the
 *   grant also needs the whole-workspace `shellWorkspaceAccess` preparation
 *   requires (execution-preparation.ts §shell);
 * - an `AG2bHost`-shaped handle over HTTP for the existing seed/advance helpers.
 *   Those helpers only read `base`, `token` and `host.reconcile.lease`, so this
 *   is a route handle, not a second Host: no record is read from the database;
 * - spawn/ready-line plumbing and the signal that the command has started.
 *
 * Everything business-facing stays on the public HTTP routes. No database read.
 */
import { spawn, type ChildProcess } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { sha256Hex } from '../../src/contracts/fingerprint.js';
import type { WorkbenchRuntimeConfiguration } from '../../src/app/runtime-configuration.js';
import type { WorkflowHostConfiguration } from '../../src/business/workflow/ports.js';
import {
  AG2B_CONSUMER_ID, AG2B_QUERY_BUDGET, AG2B_QUERY_INSTRUCTION, AG2B_QUERY_PROFILE_ID,
  AG2B_QUERY_ROLE, AG2B_QUERY_ROLE_BINDING, AG2B_RUNTIME_BUDGET, AG2B_SCOPE, AG2B_SECRET_VAR, AG2B_SECRET_VALUE,
  AG2B_WORK_INSTRUCTION, AG2B_WORK_ROLE, AG2B_WORK_ROLE_BINDING, ag2bChecksConfiguration, type AG2bHost,
} from './AG2b-collaboration-fixture.js';
import { waitForPath } from './RL-resource-caps-support.js';

/** The repository's vendored Skill root, resolved from this file (never the cwd). */
export const K307_SKILLS_ROOT = fileURLToPath(new URL('../../vendor/coding-agent/resources/skills', import.meta.url));

/**
 * The startup file the child loads through production `loadWorkbenchCliConfig`.
 * Copied from the AG2b Host fixture so the project, Goal, Role, check and
 * workflow stay the same controlled scenario; the ONE deliberate difference is
 * the Work grant: `'shell'` plus `shellWorkspaceAccess`, because K3-07 is the
 * row that really runs a command (K3's other rows use the stand-in shell).
 */
export function k307HostConfig(options: { database: string; root: string }): Record<string, unknown> {
  const actor = { kind: 'human' as const, id: 'ag2b-operator' };
  const runtime: WorkbenchRuntimeConfiguration = {
    schemaVersion: 1,
    bindings: [
      {
        id: 'ag2b-work-binding', label: 'AG2b work runtime', scope: AG2B_SCOPE, role: AG2B_WORK_ROLE,
        configurationRevision: 'ag2b-work-host@1',
        model: { revision: 'ag2b-work-model@1', provider: 'deepseek', model: 'ag2b-scripted-work',
          secretEnvironmentVariable: AG2B_SECRET_VAR },
        grant: {
          budget: AG2B_RUNTIME_BUDGET,
          hostTemplate: { templateId: 'builder', revision: '1', digest: sha256Hex(AG2B_WORK_INSTRUCTION) },
          tools: ['read', 'write', 'find_related_sessions', 'read_session_card', 'send_session_message', 'shell'],
          writeScope: ['.'], skills: { resourceRoot: K307_SKILLS_ROOT, enabledIds: [] },
          systemInstruction: AG2B_WORK_INSTRUCTION, deniedPrefixes: [],
          // `shell` requires an explicit whole-workspace write scope and this flag
          // (execution-preparation.ts:394); without them `prepare` rejects the Run
          // `unsupported` before the command ever starts.
          shellWorkspaceAccess: 'all_except_denied' as const,
          processSandboxOptions: {}, materialBasis: null,
        },
      },
      {
        id: 'ag2b-query-binding', label: 'AG2b query runtime', scope: AG2B_SCOPE, role: AG2B_QUERY_ROLE,
        configurationRevision: 'ag2b-query-host@1',
        model: { revision: 'ag2b-query-model@1', provider: 'deepseek', model: 'ag2b-scripted-query',
          secretEnvironmentVariable: AG2B_SECRET_VAR },
        grant: {
          budget: AG2B_RUNTIME_BUDGET,
          hostTemplate: { templateId: 'advisor', revision: '1', digest: sha256Hex(AG2B_QUERY_INSTRUCTION) },
          tools: ['read', 'project_source'], writeScope: [], skills: { resourceRoot: K307_SKILLS_ROOT, enabledIds: [] },
          systemInstruction: AG2B_QUERY_INSTRUCTION, deniedPrefixes: [], processSandboxOptions: {}, materialBasis: null,
        },
      },
    ],
    queryProfiles: [{
      id: AG2B_QUERY_PROFILE_ID, label: 'AG2b read-only consultation', scope: AG2B_SCOPE,
      runtimeBindingId: 'ag2b-query-binding', sessionRole: AG2B_QUERY_ROLE, roleBinding: AG2B_QUERY_ROLE_BINDING,
      runtimeBudget: AG2B_RUNTIME_BUDGET, budget: AG2B_QUERY_BUDGET, consumerId: AG2B_CONSUMER_ID,
    }],
  };
  const workflow: WorkflowHostConfiguration = {
    consumerId: AG2B_CONSUMER_ID,
    bindings: [{ workspace: AG2B_SCOPE, sessionRole: AG2B_WORK_ROLE, roleBinding: AG2B_WORK_ROLE_BINDING,
      budget: { tokenBudget: 1_000_000, deadline: null } }],
  };
  return {
    sqliteDirectory: options.database,
    actor,
    workspaces: [{ scope: AG2B_SCOPE, name: 'AG2b isolated project', root: options.root, workspaceRevision: 1,
      readPrefixes: ['.'] }],
    architectureSource: { provider: 'typescript', configPath: 'tsconfig.json' },
    kernelStores: { entries: [{ adapterId: 'ag2b-kernel', storeKey: 'ag2b-kernel-store', workspace: AG2B_SCOPE,
      databasePath: `${options.database}/kernel.sqlite` }] },
    runtime,
    workflow,
    checks: ag2bChecksConfiguration({ actor }),
  };
}

/**
 * A route handle for the seed/advance helpers in `AG2b-collaboration-fixture.ts`,
 * `A2-restart-fixture.ts` and the K3 tests. They call `corePost(host.base, …,
 * host.token, …)` and, only in `settleAutoCapture`, read `host.host.reconcile.lease`.
 * The child Host always owns its fresh lease, so `'owned'` is the true value; the
 * cast is the price of reusing those helpers without starting a second Host.
 */
export function k307RemoteHost(base: string, token: string): AG2bHost {
  return { base, token, host: { reconcile: { lease: 'owned' } } } as unknown as AG2bHost;
}

export type K307ResourceCaps = { status: string; reason?: string };
export type K307Ready = { ready: true; url: string; resourceCaps: K307ResourceCaps };

/** One stdout line from the child (its ready line), then let the rest drain. */
function firstStdoutLine(child: ChildProcess, timeoutMs: number): Promise<string> {
  return new Promise((resolve, reject) => {
    const stream = child.stdout;
    if (stream === null) {
      reject(new Error('K3-07 child has no stdout pipe'));
      return;
    }
    let buffer = '';
    const cleanup = (): void => {
      clearTimeout(timer);
      stream.off('data', onData);
      stream.off('end', onEnd);
      stream.off('error', onError);
    };
    const onData = (chunk: Buffer): void => {
      buffer += chunk.toString('utf8');
      const index = buffer.indexOf('\n');
      if (index >= 0) {
        cleanup();
        stream.resume();
        resolve(buffer.slice(0, index));
      }
    };
    const onEnd = (): void => {
      cleanup();
      reject(new Error('K3-07 child stdout ended before its ready line'));
    };
    const onError = (error: Error): void => {
      cleanup();
      reject(error);
    };
    const timer = setTimeout(() => {
      cleanup();
      reject(new Error(`K3-07 child ready line did not arrive within ${String(timeoutMs)} ms`));
    }, timeoutMs);
    stream.on('data', onData);
    stream.on('end', onEnd);
    stream.on('error', onError);
  });
}

export type K307Child = { child: ChildProcess; ready: K307Ready; stderr: () => string };

/**
 * Spawn the child Host in its own process over the real files and wait for its
 * one ready line. Stderr is buffered for the failure message; nothing is
 * inherited from a previous test.
 */
export async function spawnK307Host(options: {
  configPath: string; publicDir: string; command: string; cwd: string;
}): Promise<K307Child> {
  const child = spawn(process.execPath, [fileURLToPath(new URL('./K3-07-host-child.mjs', import.meta.url))], {
    cwd: options.cwd,
    env: {
      ...process.env,
      K3_07_CONFIG: options.configPath,
      K3_07_PUBLIC_DIR: options.publicDir,
      K3_07_SHELL_COMMAND: options.command,
      K3_07_SECRET_VARIABLE: AG2B_SECRET_VAR,
      K3_07_SECRET_VALUE: AG2B_SECRET_VALUE,
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  let stderr = '';
  child.stderr?.on('data', (chunk: Buffer) => { stderr += chunk.toString('utf8'); });
  let ready: K307Ready;
  try {
    ready = JSON.parse(await firstStdoutLine(child, 60_000)) as K307Ready;
    if (ready.ready !== true || typeof ready.url !== 'string') {
      throw new Error(`K3-07 child did not report ready: ${JSON.stringify(ready)}`);
    }
  } catch (error) {
    // A failed boot must not leak the child: the test asserts on the message,
    // and the next attempt starts its own process.
    child.kill('SIGKILL');
    throw new Error(`${error instanceof Error ? error.message : String(error)}\n${stderr}`);
  }
  return { child, ready, stderr: () => stderr };
}

/** SIGKILL the Host and wait for its exit (the crash the row needs). */
export async function killK307Host(child: ChildProcess): Promise<void> {
  if (child.exitCode !== null || child.signalCode !== null) return;
  const exited = new Promise<void>((resolve) => { child.once('exit', () => { resolve(); }); });
  child.kill('SIGKILL');
  await exited;
}

/** The marker's first line is the command's own pid; the rest is its /proc/self/cgroup. */
export async function readK307Marker(file: string, timeoutMs: number): Promise<{ pid: number; cgroup: string } | null> {
  if (!await waitForPath(file, timeoutMs)) return null;
  const text = await readFile(file, 'utf8');
  const [pidLine = '', ...rest] = text.split('\n');
  const pid = Number(pidLine.trim());
  if (!Number.isSafeInteger(pid) || pid <= 0) throw new Error(`K3-07 marker has no pid: ${JSON.stringify(text)}`);
  return { pid, cgroup: rest.join('\n') };
}
