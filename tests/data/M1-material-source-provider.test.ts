/** M1 independent provider tests: real file reads and Host access, no fake successful pin. */
import { afterEach, expect, it } from 'vitest';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { CoreCallContext } from '../../src/contracts/core/call-context.js';
import type { WorkspaceRef } from '../../src/contracts/ledger.js';
import { createWorkspaceAccessFactory, type WorkspaceAccessFactory, type WorkspaceHostBindings, type WorkspaceReadAccess } from '../../src/core/workspace/access.js';
import { createMaterialSourceProvider } from '../../src/core/workspace/material-source-provider.js';
const workspace: WorkspaceRef = { aggregateType: 'Workspace', projectId: 'm1-provider-project', workspaceId: 'm1-provider-workspace' };
const scope = { projectId: workspace.projectId, workspaceId: workspace.workspaceId };
const sourceSet = { kind: 'workspace_paths' as const, paths: ['src/input.txt'] };
const roots: string[] = [];
const cleanup = new Set<() => Promise<void>>();
afterEach(async () => { await Promise.allSettled([...cleanup].map(close => close())); cleanup.clear(); for (const root of roots.splice(0))
    await rm(root, { recursive: true, force: true }); });
function context(signal: AbortSignal): CoreCallContext {
    const actor = { kind: 'system' as const, id: 'm1-source-service' };
    return { ...scope, principal: { kind: 'host', actor }, materialReader: { kind: 'host', ...scope, actor }, signal };
}
function bindings(root: string): WorkspaceHostBindings {
    return {
        resolveRoot: async (ref) => ref.projectId === scope.projectId && ref.workspaceId === scope.workspaceId
            ? { status: 'ready', value: { root, workspaceRevision: 7 } } : { status: 'rejected', code: 'forbidden', reason: 'foreign scope' },
        authorize: async (ctx, ref) => ctx.projectId === ref.projectId && ctx.workspaceId === ref.workspaceId && ctx.principal.kind === 'host' && ctx.principal.actor.id === 'm1-source-service'
            ? { status: 'ready', value: { subjectKey: 'host:m1-source-service', permissionRevision: 'p1', allowsRead: () => true } }
            : { status: 'rejected', code: 'forbidden', reason: 'foreign identity' },
    };
}
function counted(factory: WorkspaceAccessFactory, change?: (a: WorkspaceReadAccess, n: number) => WorkspaceReadAccess) {
    let attempts = 0, opened = 0, releases = 0;
    const releaseCounts = new Map<number, number>();
    const access: WorkspaceAccessFactory = { async open(ctx, ref) {
            attempts++;
            const result = await factory.open(ctx, ref);
            if (result.status !== 'ready')
                return result;
            const n = ++opened;
            const original = result.value;
            const close = () => original.release();
            cleanup.add(close);
            const a = change ? change(original, n) : original;
            return { status: 'ready', value: { ...a, async release() { releases++; releaseCounts.set(n, (releaseCounts.get(n) ?? 0) + 1); cleanup.delete(close); await original.release(); } } };
        } };
    return { access, attempts: () => attempts, opened: () => opened, releases: () => releases, counts: () => [...releaseCounts.values()] };
}
async function fixture() { const root = await mkdtemp(join(tmpdir(), 'm1-real-source-')); roots.push(root); await mkdir(join(root, 'src')); await writeFile(join(root, 'src/input.txt'), 'version one'); await writeFile(join(root, 'other.txt'), 'unselected'); return root; }
const provider = (access: WorkspaceAccessFactory) => createMaterialSourceProvider({ access, contextForScope: (_scope, signal) => context(signal) });
it('captures actual selected bytes, additions/deletions, and ignores unselected content changes', async () => {
    const root = await fixture();
    const real = createWorkspaceAccessFactory(bindings(root));
    // Read the actual sandbox identity; it is not the root pathname.
    const baseline = await real.open(context(new AbortController().signal), workspace);
    expect(baseline.status).toBe('ready');
    if (baseline.status !== 'ready')
        throw Error('baseline access');
    const identity = await baseline.value.sourceIdentity();
    await baseline.value.release();
    const c = counted(real);
    const p = provider(c.access);
    const first = await p.capture({ ...scope, sourceSet });
    expect(first, JSON.stringify(first)).toMatchObject({ status: 'sourced', pin: { ...scope, sourceSet, identity } });
    if (first.status !== 'sourced')
        return;
    await writeFile(join(root, 'other.txt'), 'outside changed');
    const second = await p.capture({ ...scope, sourceSet });
    expect(second).toEqual(first);
    await writeFile(join(root, 'src/input.txt'), 'version two');
    const third = await p.capture({ ...scope, sourceSet });
    expect(third.status).toBe('sourced');
    if (third.status !== 'sourced')
        return;
    expect(third.pin.manifestDigest).not.toBe(first.pin.manifestDigest);
    const tree = { kind: 'workspace_paths' as const, paths: ['src'] };
    const before = await p.capture({ ...scope, sourceSet: tree });
    expect(before.status).toBe('sourced');
    if (before.status !== 'sourced')
        return;
    await writeFile(join(root, 'src/added.txt'), 'new');
    const added = await p.capture({ ...scope, sourceSet: tree });
    expect(added.status).toBe('sourced');
    if (added.status !== 'sourced')
        return;
    expect(added.pin.manifestDigest).not.toBe(before.pin.manifestDigest);
    await rm(join(root, 'src/added.txt'));
    expect(await p.capture({ ...scope, sourceSet: tree })).toEqual(before);
    expect(c.opened()).toBe(12);
    expect(c.releases()).toBe(12);
    expect(c.counts()).toEqual(Array(12).fill(1));
});
it('reopens and reauthorizes independently for each capture, including a legitimate later Workspace revision', async () => {
    const root = await fixture();
    let revision = 7, authorizations = 0;
    const b = bindings(root);
    b.resolveRoot = async () => ({ status: 'ready', value: { root, workspaceRevision: revision } });
    const oldAuthorize = b.authorize;
    b.authorize = async (...args) => { authorizations++; return oldAuthorize(...args); };
    const c = counted(createWorkspaceAccessFactory(b));
    const p = provider(c.access);
    expect(await p.capture({ ...scope, sourceSet })).toMatchObject({ status: 'sourced' });
    revision = 8; // Between calls is valid: each call checks its own consistent observation.
    expect(await p.capture({ ...scope, sourceSet })).toMatchObject({ status: 'sourced' });
    expect(authorizations).toBe(4);
    expect(c.opened()).toBe(4);
    expect(c.releases()).toBe(4);
    expect(c.counts()).toEqual([1, 1, 1, 1]);
});
it.each(['root', 'revision', 'permission', 'subject'] as const)('rejects %s changes specifically between observation and final reauthorization', async (change) => {
    const root = await fixture(), other = await fixture();
    let resolves = 0, authorizes = 0;
    const b = bindings(root);
    b.resolveRoot = async () => { resolves++; return { status: 'ready', value: { root: change === 'root' && resolves > 1 ? other : root, workspaceRevision: change === 'revision' && resolves > 1 ? 8 : 7 } }; };
    b.authorize = async () => { authorizes++; return { status: 'ready', value: { subjectKey: change === 'subject' && authorizes > 1 ? 'host:other' : 'host:m1-source-service', permissionRevision: change === 'permission' && authorizes > 1 ? 'p2' : 'p1', allowsRead: () => true } }; };
    const c = counted(createWorkspaceAccessFactory(b));
    const result = await provider(c.access).capture({ ...scope, sourceSet });
    expect(result.status).toMatch(/stale|unavailable/);
    expect(c.opened()).toBe(2);
    expect(c.releases()).toBe(2);
    expect(c.counts()).toEqual([1, 1]);
});
it.each(['truncated', 'unsafe', 'oversized', 'read-error', 'changed-bytes'] as const)('fails closed and releases real access on %s observation', async (mode) => {
    const root = await fixture();
    let reads = 0;
    const c = counted(createWorkspaceAccessFactory(bindings(root)), a => ({ ...a,
        async listFiles(max) { const page = await a.listFiles(max); return mode === 'truncated' ? { ...page, truncated: true } : mode === 'unsafe' ? { paths: ['../outside'], truncated: false } : page; },
        async read(path, max) {
            const result = await a.read(path, max);
            reads++;
            if (mode === 'read-error')
                throw Error('disk failed');
            if (mode === 'oversized')
                return { ...result, byteLength: max + 1 };
            if (mode === 'changed-bytes' && reads === 1)
                await writeFile(join(root, 'src/input.txt'), 'changed during capture');
            return result;
        },
    }));
    const result = await provider(c.access).capture({ ...scope, sourceSet });
    expect(result.status).toMatch(/rejected|stale|unavailable/);
    expect(c.opened()).toBe(1);
    expect(c.releases()).toBe(1);
    expect(c.counts()).toEqual([1]);
});
it('pre-cancel opens no access; mid-read cancellation releases every successfully acquired access', async () => {
    const root = await fixture();
    const before = new AbortController();
    before.abort();
    const c = counted(createWorkspaceAccessFactory(bindings(root)));
    const cancelled = await provider(c.access).capture({ ...scope, sourceSet }, before.signal);
    expect(cancelled.status).toMatch(/rejected|unavailable/);
    expect(c.opened()).toBe(0);
    expect(c.releases()).toBe(0);
    const during = new AbortController();
    const mid = counted(createWorkspaceAccessFactory(bindings(root)), a => ({ ...a, async read(path, max) { const value = await a.read(path, max); during.abort(); return value; } }));
    const interrupted = await provider(mid.access).capture({ ...scope, sourceSet }, during.signal);
    expect(interrupted.status).toMatch(/rejected|unavailable/);
    expect(mid.opened()).toBe(1);
    expect(mid.releases()).toBe(1);
});
it('denied final reauthorization releases the first access without inventing a second resource', async () => {
    const root = await fixture();
    let authorizes = 0;
    const b = bindings(root);
    b.authorize = async () => ++authorizes === 1
        ? { status: 'ready', value: { subjectKey: 'host:m1-source-service', permissionRevision: 'p1', allowsRead: () => true } }
        : { status: 'rejected', code: 'forbidden', reason: 'revoked' };
    const c = counted(createWorkspaceAccessFactory(b));
    const result = await provider(c.access).capture({ ...scope, sourceSet });
    expect(result.status).toMatch(/rejected|unavailable/);
    expect(c.attempts()).toBe(2);
    expect(c.opened()).toBe(1);
    expect(c.releases()).toBe(1);
});
it('does not resolve a foreign scope from a mismatched trusted context; valid scope still sources', async () => {
    const root = await fixture();
    const c = counted(createWorkspaceAccessFactory(bindings(root)));
    const p = provider(c.access);
    const result = await p.capture({ projectId: 'foreign', workspaceId: 'foreign', sourceSet });
    expect(result.status).toMatch(/rejected|unavailable/);
    expect(c.attempts()).toBe(0);
    expect(await p.capture({ ...scope, sourceSet })).toMatchObject({ status: 'sourced' });
});

it('snapshots the source selection before the first workspace open awaits', async () => {
    const root = await fixture();
    const c = counted(createWorkspaceAccessFactory(bindings(root)));
    const p = provider(c.access);
    const original = await p.capture({ ...scope, sourceSet: { kind: 'workspace_paths', paths: ['src/input.txt'] } });
    const alternative = await p.capture({ ...scope, sourceSet: { kind: 'workspace_paths', paths: ['other.txt'] } });
    expect(original.status).toBe('sourced');
    expect(alternative.status).toBe('sourced');
    if (original.status !== 'sourced' || alternative.status !== 'sourced') throw Error('real source baseline required');
    expect(original.pin.manifestDigest).not.toBe(alternative.pin.manifestDigest);
    let release!: () => void;
    let notifyOpened!: () => void;
    const gate = new Promise<void>(resolve => { release = resolve; });
    const opened = new Promise<void>(resolve => { notifyOpened = resolve; });
    let first = true;
    const delayed: WorkspaceAccessFactory = { async open(ctx, ref) {
        if (first) { first = false; notifyOpened(); await gate; }
        return c.access.open(ctx, ref);
    } };
    const query = { ...scope, sourceSet: { kind: 'workspace_paths' as const, paths: ['src/input.txt'] } };
    const pending = provider(delayed).capture(query);
    await opened;
    query.sourceSet.paths[0] = 'other.txt';
    release();
    const result = await pending;
    expect(result).toEqual(original);
    expect(c.releases()).toBe(c.opened());
    expect(c.counts().every(n => n === 1)).toBe(true);
});

it('cancellation during the final access release cannot publish a sourced pin', async () => {
    const root = await fixture();
    const controller = new AbortController();
    const c = counted(createWorkspaceAccessFactory(bindings(root)));
    let acquired = 0;
    const access: WorkspaceAccessFactory = { async open(ctx, ref) {
        const result = await c.access.open(ctx, ref);
        if (result.status !== 'ready') return result;
        const ordinal = ++acquired;
        const a = result.value;
        return { status: 'ready', value: { ...a, async release() {
            await a.release();
            if (ordinal === 2) controller.abort();
        } } };
    } };
    const result = await provider(access).capture({ ...scope, sourceSet }, controller.signal);
    expect(controller.signal.aborted).toBe(true);
    expect(result.status).toMatch(/rejected|unavailable/);
    expect(c.opened()).toBe(2);
    expect(c.releases()).toBe(2);
    expect(c.counts()).toEqual([1, 1]);
});
