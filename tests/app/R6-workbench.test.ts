/**
 * R6.1a workbench build/static + pure DTO presentation acceptance.
 *
 * This file proves the browser closure is real without a browser: the real
 * `scripts/build-workbench.mjs` emits the UI JavaScript and publishes the
 * deterministic static assets, the shipped page still carries the token
 * placeholder (the server substitutes it per response), and the pure renderers
 * keep the adopted and observed graphs distinct and every rejection/absence
 * state honest.
 *
 * Specification: docs/refactor/tasks/R6-host-workbench-skeleton.md §2 and §5.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { spawnSync } from 'node:child_process';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  PLATFORM_TOKEN_HEADER,
  PLATFORM_TOKEN_META_NAME,
  PLATFORM_TOKEN_PLACEHOLDER,
  type BootstrapResponse,
} from '../../src/app/core-http-types.js';
import {
  UI_BOOTSTRAP_SUFFIX,
  UI_CORE_API_PREFIX,
  UI_PLATFORM_TOKEN_HEADER,
  UI_PLATFORM_TOKEN_META_NAME,
  createWorkbenchLayout,
  escapeHtml,
  planExecutionContinuation,
  reduceWorkbenchLayout,
  renderExecutionProfiles,
  renderAdoptedGraph,
  renderBootstrap,
  renderGap,
  renderInbox,
  renderInitialPlanning,
  renderMessage,
  renderMessageBody,
  renderQueryAnswer,
  renderObservedGraph,
  renderRouteResponse,
  renderSessionDetail,
  renderSessionHistory,
  renderSessionHistoryTimeline,
  renderSessionOperation,
  renderSessionSummary,
  renderTaskGraph,
  renderTaskStructure,
  renderTaskExecutionEntry,
  renderWorkflowAdvance,
  renderWorkLinkTarget,
} from '../../src/ui/views.js';
import type { WorkbenchTab, WorkbenchDraftReference } from '../../src/ui/views.js';
import type { ArchitectureRevision } from '../../src/core/work-graph/architecture/catalog-contracts.js';
import type { ObservedArchitectureNeighborhood } from '../../src/core/work-graph/architecture/contracts.js';
import type { TaskGraph, TaskRow } from '../../src/core/work-graph/tasks/plan-contracts.js';
import type { ReadResult } from '../../src/contracts/core/results.js';
import type { CommitCursor } from '../../src/contracts/command-event.js';
import type { Disposition, Phase, PlanRevisionSnapshot } from '../../src/contracts/plan.js';
import type { GoalRef } from '../../src/contracts/ledger.js';
import type { SessionRecord as KernelSessionRecord } from '../../vendor/coding-agent/dist/public-api.js';
import type {
  ArtifactRecord,
  BootstrapExecution,
  CoreScope,
  InitialPlanningGoalInputResult,
  MessageBody,
  OperationReceipt,
  Page,
  SessionCard,
  SessionHistoryEntry,
  SessionMessage,
  QueryJobAnswerSnapshot,
  SessionPage,
  SessionRecord,
  SessionRef,
  RunRef,
  WorkflowAdvanceResult,
  WorkspaceFile,
} from '../../src/app/core-http-types.js';

const projectDir = resolve(fileURLToPath(new URL('../../', import.meta.url)));
let publicDir = '';

beforeAll(async () => {
  publicDir = await mkdtemp(join(tmpdir(), 'r6-workbench-test-'));
  const build = spawnSync(process.execPath, ['scripts/build-workbench.mjs'], {
    cwd: projectDir, encoding: 'utf8', env: { ...process.env, WORKBENCH_OUT_DIR: publicDir },
  });
  if (build.status !== 0) throw new Error(`workbench build failed: ${build.stdout}\n${build.stderr}`);
}, 60_000);

afterAll(async () => { if (publicDir !== '') await rm(publicDir, { recursive: true, force: true }); });

describe('workbench build closure', () => {
  it('publishes the real UI JavaScript and static assets with the token placeholder intact', async () => {
    for (const file of ['main.js', 'views.js', 'styles.css', 'index.html']) {
      expect(existsSync(join(publicDir, file)), `missing built ${file}`).toBe(true);
    }
    const main = await readFile(join(publicDir, 'main.js'), 'utf8');
    const views = await readFile(join(publicDir, 'views.js'), 'utf8');
    expect(main.length).toBeGreaterThan(0);
    expect(views.length).toBeGreaterThan(0);
    // The browser bundle never pulls in the Host/composition/Node closure.
    for (const source of [main, views]) {
      expect(source).not.toContain('node:');
      expect(source).not.toContain('../composition/');
      expect(source).not.toContain('createTargetPlatform');
    }
    const html = await readFile(join(publicDir, 'index.html'), 'utf8');
    expect(html).toContain(PLATFORM_TOKEN_PLACEHOLDER);
    expect(html).toContain('/workbench/main.js');
    expect(html).toContain('/workbench/styles.css');
    // A real 64-hex token must never be baked into the shipped artifact.
    expect(/[a-f0-9]{64}/.test(html)).toBe(false);
  });

  it('keeps the UI protocol literals equal to the Host contract', () => {
    expect(UI_PLATFORM_TOKEN_HEADER).toBe(PLATFORM_TOKEN_HEADER);
    expect(UI_PLATFORM_TOKEN_META_NAME).toBe(PLATFORM_TOKEN_META_NAME);
    expect(UI_BOOTSTRAP_SUFFIX).toBe('bootstrap');
    expect(UI_CORE_API_PREFIX.endsWith('/')).toBe(true);
  });
});

describe('pure DTO presentation', () => {
  it('renders the configured scopes and trusted review material', () => {
    const bootstrap: BootstrapResponse = {
      workspaces: [{ scope: { projectId: 'p', workspaceId: 'w' }, name: 'Workbench one', workspaceRevision: 3 }],
      review: { notes: 'review note', policies: [{ policyId: 'policy-1', contentRevision: 1, content: {} }], goals: [{ goalId: 'g', objective: 'do it' }] },
      execution: { queryProfiles: [], workflowScopes: [] },
    };
    const html = renderBootstrap(bootstrap);
    expect(html).toContain('Workbench one');
    expect(html).toContain('workspaceRevision=3');
    expect(html).toContain('review note');
    expect(html).toContain('政策 1');
  });

  it('keeps the adopted and observed graphs as two distinct panels', () => {
    const adopted: ReadResult<ArchitectureRevision> = { status: 'ready', value: {
      baseline: { ref: { aggregateType: 'ArchitectureBaselineRevision', projectId: 'p', baselineId: 'baseline-1', revision: 1 } as never,
        revision: 1, schemaVersion: 1, baselineId: 'baseline-1', contentRevision: 1, contentDigest: 'a'.repeat(64),
        content: { schemaVersion: 1, description: 'adopted', constraints: [] } },
      catalog: { ref: {} as never, revision: 1, baselineRef: {} as never, schemaVersion: 1, catalog: {
        requireDag: true,
        modules: [{ ref: { projectId: 'p', moduleId: 'm1' }, name: 'Module one', responsibility: 'owns one thing', paths: ['src/m1'], interfaces: [] }],
        dependencies: [],
      } },
    } };
    const observed: ReadResult<ObservedArchitectureNeighborhood> = { status: 'ready', value: {
      selection: { kind: 'observed', capture: { capture: { captureId: 'capture-1' } as never, material: {} as never } },
      nodes: [{ nodeId: 'node-1', kind: 'module', name: 'n', path: 'src/a.ts', structuralKey: 'k', contentDigest: 'd' }],
      edges: [{ edgeId: 'e1', fromNode: 'node-1', toNode: 'node-2', kind: 'module_dependency', structuralKey: 'k2' }],
      unresolved: [], nextCursor: null, sourceCursor: 'c0000000001' as never, noVerdict: true,
    } };
    const html = renderAdoptedGraph(adopted) + renderObservedGraph(observed);
    expect(html).toContain('data-graph="adopted"');
    expect(html).toContain('data-graph="observed"');
    expect(html).toContain('Module one');
    expect(html).toContain('capture-1');
  });

  it('never collapses an absent adopted baseline into a fake label', () => {
    expect(renderAdoptedGraph({ status: 'not_found' })).toContain('data-route="architecture/read"');
    expect(renderAdoptedGraph({ status: 'rejected', code: 'unsupported', reason: 'not wired' })).toContain('unsupported');
    expect(renderGap('plans/apply', 'no adopted plan')).toContain('no adopted plan');
  });

  it('renders a real task graph with its plan identity', () => {
    const graph: ReadResult<TaskGraph> = { status: 'ready', value: {
      plan: { ref: { aggregateType: 'PlanRevision', projectId: 'p', planId: 'plan-7' }, revision: 1, goalRef: { aggregateType: 'Goal', projectId: 'p', goalId: 'g' },
        schemaVersion: 2 } as never,
      tasks: [{ ref: { projectId: 'p', goalId: 'g', taskId: 't1' }, definition: { title: 'Task one' } as never,
        effectivePhase: 'pending', disposition: 'active', currentAttempt: null, execution: null,
        eligibilityScope: 'task_state', eligibility: { status: 'ready' } as never, relations: [], inputRequirements: [], legacyDependencies: [] }],
      sourceCursor: 'c0000000002' as never,
    } };
    const html = renderTaskGraph(graph);
    expect(html).toContain('data-graph="tasks"');
    expect(html).toContain('plan-7');
    expect(html).toContain('t1');
    expect(html).toContain('Task one');
  });

  it('preserves committed/replayed/cursor and rejection discriminators', () => {
    const committed = renderRouteResponse('projects/create', { status: 'committed', replayed: true, cursor: 'c0000000009', value: { revision: 1 } });
    expect(committed).toContain('replayed=true');
    expect(committed).toContain('c0000000009');
    const rejected = renderRouteResponse('plans/apply', { status: 'rejected', code: 'incomplete', reason: 'no active policy' });
    expect(rejected).toContain('incomplete');
    expect(rejected).toContain('no active policy');
  });

  it('escapes interpolated domain text', () => {
    expect(escapeHtml('<script>&"\'')).toBe('&lt;script&gt;&amp;&quot;&#39;');
  });

  // R6.1b-1: one pure display chain over the exact public DTOs. It preserves the
  // real identity/status/cursor and never invents a reply or a created Session.
  it('renders a Session/message/history display chain without inventing replies or completed work', () => {
    const sessionRef = { projectId: 'p', sessionId: 'session-1' };
    const record: SessionRecord = {
      ref: { aggregateType: 'Session', ...sessionRef },
      revision: 2,
      kernel: { adapterId: 'kernel-adapter', kernelSessionId: 'session-1' },
      lifecycle: 'active',
      health: 'available',
      role: {
        kind: 'role_spec',
        pin: {
          ref: { aggregateType: 'RoleSpecRevision', projectId: 'p', roleId: 'builder', revision: 1 },
          digest: 'd'.repeat(64),
        },
      },
      workspaceId: 'w',
      lastExecutionRef: null,
      occupancy: null,
      historyCursor: null,
      createdAt: '2026-09-26T00:00:00.000Z',
      archivedAt: null,
    };
    const card: SessionCard = { record, availability: 'busy', links: [], recommendationReasons: [] };
    const page: ReadResult<SessionPage<SessionCard>> = {
      status: 'ready',
      value: { items: [card], nextCursor: 'directory-cursor-1', sourceCursor: 'commit-1' as never },
    };

    const summary = renderSessionSummary(page);
    expect(summary).toContain('session-1');
    expect(summary).toContain('忙碌中');
    expect(summary).toContain('directory-cursor-1');
    expect(summary).toContain('data-action="read-session"');

    const detail = renderSessionDetail({ status: 'ready', value: card });
    expect(detail).toContain('session-1');
    expect(detail).toContain('忙碌中');

    const messageRef = { aggregateType: 'SessionMessage' as const, projectId: 'p', workspaceId: 'w', messageId: 'message-1' };
    const pending: SessionMessage = {
      ref: messageRef,
      schemaVersion: 1,
      revision: 1,
      sender: { kind: 'host', actor: { kind: 'human', id: 'operator' } },
      recipient: sessionRef,
      bodyRef: {} as never,
      sourceRef: {} as never,
      createdAt: '2026-09-26T00:01:00.000Z',
      status: 'pending',
      readAt: null,
      response: null,
    };

    const inbox = renderInbox({ status: 'ready', value: { items: [pending], nextCursor: null, sourceCursor: 'commit-1' as never } });
    expect(inbox).toContain('message-1');
    expect(inbox).toContain('待处理');

    const message = renderMessage({ status: 'ready', value: pending });
    expect(message).toContain('待处理');
    expect(message).toContain('尚无回复');
    expect(message).not.toContain('已回复');

    const body: MessageBody = {
      messageRef, part: 'message', text: 'R6.1b 真实正文', sourceRef: {} as never, usage: 'message',
    };
    expect(renderMessageBody({ status: 'ready', value: body })).toContain('R6.1b 真实正文');

    const history: ReadResult<Page<SessionHistoryEntry>> = {
      status: 'ready',
      value: {
        items: [{
          recordId: 'kernel:session.created:1',
          cursor: 'kernhist1.entry',
          recordedAt: '2026-09-26T00:00:00.000Z',
          kind: 'session_created',
          source: { adapterId: 'kernel-adapter', kernelSessionId: 'session-1', position: 1 },
          body: { encoding: 'kernel_session_record_json', text: '{"recordType":"session.created"}' },
        }],
        nextCursor: null,
        basis: { kind: 'session', ref: sessionRef, cursor: 'kernhist1.basis' },
      },
    };
    const historyHtml = renderSessionHistory(history);
    expect(historyHtml).toContain('会话创建');
    expect(historyHtml).toContain('没有更多');
    expect(historyHtml).toContain('kernhist1.basis');

    const operationRef = { aggregateType: 'CoreOperation' as const, projectId: 'p', operationId: 'operation-1' };
    const accepted: OperationReceipt<SessionRecord> = {
      status: 'accepted', operationRef, replayed: false, cursor: 'commit-1' as never,
    };
    const acceptedHtml = renderSessionOperation(accepted);
    expect(acceptedHtml).toContain('创建处理中');
    expect(acceptedHtml).toContain('operation-1');
    expect(acceptedHtml).not.toContain('已创建');

    const completed: OperationReceipt<SessionRecord> = {
      status: 'completed', operationRef, value: record, replayed: false, cursor: 'commit-1' as never,
    };
    const completedHtml = renderSessionOperation(completed);
    expect(completedHtml).toContain('已创建');
    expect(completedHtml).toContain('session-1');
  });

  // R6 UI-layout skeleton (phase-2 target): auxiliary tabs and file-selection
  // references are pure display state bound to one scope + Session. The first
  // red is the explicit `unsupported` body of `reduceWorkbenchLayout`; every
  // later round-trip / draft / archived assertion is unreached and reported.
  it('keeps auxiliary tabs and file-selection drafts bound to one scope/Session, unsaved and never sendable on an archived page', () => {
    const scope: CoreScope = { projectId: 'p', workspaceId: 'w' };
    const session: SessionRef = { projectId: 'p', sessionId: 'session-1' };
    const file: WorkspaceFile = {
      path: 'src/completion.ts',
      content: 'export const done = true;\n',
      digest: 'a'.repeat(64),
      digestBasis: 'raw_bytes',
      sizeBytes: 25,
      version: { kind: 'working_tree' },
      readAt: '2026-09-26T00:00:00.000Z',
    };

    // The factory is the real seam and is already implemented.
    const layout = createWorkbenchLayout(scope, session, 'active');
    expect(layout.scope).toEqual(scope);
    expect(layout.session).toEqual(session); // exact SessionRef: projectId + sessionId only
    expect(layout.readOnly).toBe(false);
    expect(createWorkbenchLayout(scope, session, 'archived').readOnly).toBe(true);
    expect(createWorkbenchLayout(scope, { projectId: 'p', sessionId: 'session-2' }, 'active').tabs).toHaveLength(0);

    const reference: WorkbenchDraftReference = {
      kind: 'selection', path: file.path, text: 'export const done = false;',
      startLine: 1, endLine: 1, version: file.version, digest: file.digest, source: 'draft_snapshot',
    };
    const fileTab: WorkbenchTab = {
      tabId: 'file:src/completion.ts', kind: 'file', title: 'completion.ts', file, editorDraft: null,
    };

    // PHASE-2 ENTRY: the first unsupported call is the first red of this test.
    const opened = reduceWorkbenchLayout(layout, { kind: 'open_tab', tab: fileTab });
    const edited = reduceWorkbenchLayout(opened,
      { kind: 'edit_file_draft', tabId: fileTab.tabId, text: 'export const done = false;\n' });
    const composed = reduceWorkbenchLayout(edited, { kind: 'edit_composer', text: '请检查这段修改' });
    const referenced = reduceWorkbenchLayout(composed, { kind: 'add_reference', reference });
    const directory = reduceWorkbenchLayout(referenced, { kind: 'open_tab', tab: {
      tabId: 'dir:src', kind: 'directory', title: 'src', path: 'src' } });
    const back = reduceWorkbenchLayout(directory, { kind: 'activate_tab', tabId: fileTab.tabId });
    const roundTripped = back.tabs.find(tab => tab.tabId === fileTab.tabId);

    expect(back.activeTabId).toBe(fileTab.tabId);
    expect(roundTripped?.kind).toBe('file');
    expect(roundTripped?.kind === 'file' ? roundTripped.editorDraft : null)
      .toEqual({ state: 'draft_snapshot', text: 'export const done = false;\n' });
    expect(roundTripped?.kind === 'file' ? roundTripped.file : null).toEqual(file); // read version stays unchanged
    expect(back.composerDraft).toEqual({ state: 'draft_snapshot', text: '请检查这段修改', references: [reference] });
    // The pure state reducer has no HTTP/send dependency; adding a selection
    // only appends to this conversation composer, never to the file editor.

    // Archived browsing opens a real file tab but cannot add/edit a sendable draft.
    const archivedFile = reduceWorkbenchLayout(createWorkbenchLayout(scope, session, 'archived'),
      { kind: 'open_tab', tab: fileTab });
    const archived = reduceWorkbenchLayout(archivedFile, { kind: 'add_reference', reference });
    expect(archived.readOnly).toBe(true);
    expect(archived.tabs).toEqual([fileTab]);
    expect(archived.composerDraft).toEqual({ state: 'draft_snapshot', text: '', references: [] });
  });

  // R6 UI-layout skeleton (phase-2 target): real-shape original history in
  // order, task hierarchy separate from execution dependencies, and navigation
  // through the exact WorkLinkTarget ref. The first red is missing user content
  // in the honest timeline placeholder; later phase-2 assertions are unreached.
  it('projects real original history in order and keeps task hierarchy separate from execution dependencies and real work links', () => {
    const sessionRef: SessionRef = { projectId: 'p', sessionId: 'session-1' };
    // These are display inputs, not seeded durable facts. Type-check known
    // records against the frozen Kernel's public record shape; unknown remains raw.
    const kernel = (record: KernelSessionRecord): string => JSON.stringify(record);
    const recordMeta = (recordId: string, position: number) => ({ schemaVersion: 1 as const,
      recordId, sessionId: sessionRef.sessionId, position,
      recordedAt: '2026-09-26T00:00:00.000Z', checksum: '0'.repeat(64) });
    const eventMeta = (sequence: number) => ({ schemaVersion: 1 as const,
      eventId: `event-${sequence}`, runId: 'run-1', turnId: 'turn-1', sequence,
      occurredAt: '2026-09-26T00:00:00.000Z', elapsedMs: sequence });
    const history: ReadResult<Page<SessionHistoryEntry>> = {
      status: 'ready',
      value: {
        basis: { kind: 'session', ref: sessionRef, cursor: 'kernhist1.basis' },
        nextCursor: 'kernhist1.next',
        items: [
          { recordId: 'turn:turn-1', cursor: 'kernhist1.1', recordedAt: '2026-09-26T00:00:00.000Z', kind: 'turn_started',
            source: { adapterId: 'kernel-adapter', kernelSessionId: 'session-1', position: 1 },
            body: { encoding: 'kernel_session_record_json', text: kernel({ ...recordMeta('turn:turn-1', 1), recordType: 'turn.started',
              payload: { run: { schemaVersion: 1, runId: 'run-1', createdAt: '2026-09-26T00:00:00.000Z',
                turn: { turnId: 'turn-1', userMessage: { schemaVersion: 1, messageId: 'msg-1', role: 'user', content: '请修复构建' } } },
                config: { modelConfigId: 'model-1', limits: { maxModelRequests: 1, maxToolCalls: 1,
                  maxInputTokens: null, maxOutputTokens: null, maxTotalTokens: null, maxCostUsdMicros: null, deadlineMs: null },
                  enabledToolSchemaDigest: 'tools', policyVersion: '1', sandboxProfileVersion: '1', baseConfigDigest: 'base' },
                workspace: { identity: 'w', revision: 'r1', reference: '/display-fixture' } } }) } },
          { recordId: 'agent-event:1', cursor: 'kernhist1.2', recordedAt: '2026-09-26T00:00:01.000Z', kind: 'agent_event',
            source: { adapterId: 'kernel-adapter', kernelSessionId: 'session-1', position: 2 },
            body: { encoding: 'kernel_session_record_json', text: kernel({ ...recordMeta('agent-event:1', 2), recordType: 'agent.event',
              payload: { event: { type: 'assistant.message_completed', meta: eventMeta(1), payload: { requestId: 'req-1',
                message: { schemaVersion: 1, messageId: 'msg-2', role: 'assistant', content: '已修复', reasoningContent: '检查了测试失败的原因' },
                toolCalls: [] } } } }) } },
          { recordId: 'agent-event:2', cursor: 'kernhist1.3', recordedAt: '2026-09-26T00:00:02.000Z', kind: 'agent_event',
            source: { adapterId: 'kernel-adapter', kernelSessionId: 'session-1', position: 3 },
            body: { encoding: 'kernel_session_record_json', text: kernel({ ...recordMeta('agent-event:2', 3), recordType: 'agent.event',
              payload: { event: { type: 'tool.completed', meta: eventMeta(2), payload: { callId: 'call-1', result: { status: 'success',
                schemaVersion: 1, callId: 'call-1', output: [{ kind: 'text', text: 'exit 0' }],
                effects: { sideEffect: 'none', changedPaths: [], workspaceRevision: null, artifactRefs: [] } } } } } }) } },
          { recordId: 'agent-event:3', cursor: 'kernhist1.4', recordedAt: '2026-09-26T00:00:03.000Z', kind: 'agent_event',
            source: { adapterId: 'kernel-adapter', kernelSessionId: 'session-1', position: 4 },
            body: { encoding: 'kernel_session_record_json', text: JSON.stringify({ recordType: 'future.unknown', payload: { note: 'unknown' } }) } },
          { recordId: 'artifact:1', cursor: 'kernhist1.5', recordedAt: '2026-09-26T00:00:04.000Z', kind: 'agent_event',
            source: { adapterId: 'kernel-adapter', kernelSessionId: 'session-1', position: 5 },
            body: { kind: 'artifact', contentType: 'text/plain', digest: 'b'.repeat(64), sizeBytes: 12,
              source: { kind: 'workspace', refId: 'README.md', revision: '1' } } },
        ],
      },
    };

    // PHASE-2 ENTRY: the first unsupported call is the first red of this test.
    const historyHtml = renderSessionHistoryTimeline(history);
    expect(historyHtml).toContain('请修复构建'); // turn.started user input
    expect(historyHtml).toContain('已修复'); // assistant text
    // User-authorized contract amendment: saved original records are available
    // through an explicit, initially collapsed raw-history disclosure.
    const savedRaw = historyHtml.match(/<details\b[^>]*data-history-raw="agent-event:1"[^>]*>[\s\S]*?<\/details>/)?.[0] ?? '';
    expect(savedRaw).toContain('检查了测试失败的原因');
    expect(savedRaw).toContain('reasoningContent');
    expect(savedRaw).not.toMatch(/<details\b[^>]*\sopen(?:[=\s>])/);
    expect(historyHtml).toContain('exit 0'); // tool result
    expect(historyHtml).toContain('future.unknown'); // unknown original record stays identifiable and available on demand
    expect(historyHtml).toContain('data-history="turn:turn-1"'); // recordId preserved
    expect(historyHtml).toContain('kernhist1.1'); // cursor preserved
    expect(historyHtml).toContain('position 1'); // source.position preserved
    expect(historyHtml.indexOf('请修复构建')).toBeLessThan(historyHtml.indexOf('已修复')); // original order
    expect(historyHtml).toContain('data-history-body="artifact"'); // ArtifactRef is not read as text
    expect(historyHtml).toContain('正文未读取');

    const goalRef: GoalRef = { aggregateType: 'Goal', projectId: 'p', goalId: 'goal-1' };
    const plan: PlanRevisionSnapshot = {
      schemaVersion: 2,
      ref: { aggregateType: 'PlanRevision', projectId: 'p', planId: 'plan-7' },
      revision: 1,
      goalRef,
      planId: 'plan-7',
      planRevision: 4, // business version, NOT the immutable row revision
      acceptedAt: '2026-09-26T00:00:00.000Z',
      effectiveCompletionPolicy: { ref: { aggregateType: 'CompletionPolicyRevision', projectId: 'p', policyId: 'policy-1', revision: 1 }, digest: 'c'.repeat(64) },
      effectiveArchitectureBaseline: { ref: { aggregateType: 'ArchitectureBaselineRevision', projectId: 'p', baselineId: 'baseline-1', revision: 1 }, digest: 'd'.repeat(64) },
      stages: [],
      tasks: [
        { taskId: 't-root', title: 'Root', requirementLevel: 'required', taskKind: 'work', disposition: 'active', phase: 'running', scope: { kind: 'goal' } },
        { taskId: 't-child', title: 'Child', requirementLevel: 'required', taskKind: 'work', disposition: 'active', phase: 'pending', scope: { kind: 'goal' }, executionIntent: 'plan_only' },
        { taskId: 't-future', title: 'Future', requirementLevel: 'optional', taskKind: 'work', disposition: 'deferred', phase: 'pending', scope: { kind: 'goal' }, executionIntent: 'plan_only' },
      ],
      assignments: [],
      obligations: [],
      taskHierarchy: { parentOf: [{ parentTaskId: 't-root', childTaskId: 't-child' }] },
      executionDag: { dependsOn: [{ taskId: 't-child', dependsOnId: 't-root', requires: { kind: 'gate-result', label: 'root gate' } }] },
      taskRelations: [{ fromTaskId: 't-child', toTaskId: 't-future', kind: 'coordination', note: 'share interface' }],
    };
    const taskRow = (taskId: string, phase: Phase, disposition: Disposition, relations: TaskRow['relations']): TaskRow => ({
      ref: { projectId: 'p', goalId: 'goal-1', taskId },
      definition: plan.tasks.find(task => task.taskId === taskId) as TaskRow['definition'],
      effectivePhase: phase,
      disposition,
      currentAttempt: null,
      execution: null,
      eligibilityScope: 'task_state',
      eligibility: { eligible: true, reasons: [] },
      relations,
      inputRequirements: [],
      legacyDependencies: [],
    });
    const cursor: string = 'commit-1';
    const graph: ReadResult<TaskGraph> = { status: 'ready', value: {
      plan,
      tasks: [
        taskRow('t-root', 'running', 'active', []),
        taskRow('t-child', 'pending', 'active', []),
        taskRow('t-future', 'pending', 'deferred', [{ fromTaskId: 't-child', toTaskId: 't-future', kind: 'coordination', note: 'share interface' }]),
      ],
      sourceCursor: cursor as CommitCursor,
    } };

    const taskHtml = renderTaskStructure(graph);
    expect(taskHtml).toContain('data-edges="hierarchy" aria-pressed="true"'); // parentOf is the selected view
    const dependencyHtml = renderTaskStructure(graph, undefined, undefined, undefined, 'dependency');
    expect(dependencyHtml).toContain('data-edges="dependency" aria-pressed="true"'); // separate dependency view
    expect(taskHtml).toContain('t-root');
    expect(taskHtml).toContain('t-child');
    expect(taskHtml).toContain('t-future'); // planning-only/optional/future row is kept
    expect(taskHtml).toContain('plan_only'); // plan-only intent stays visible
    expect(taskHtml).toContain('goal-1');

    type WorkLinkTarget = SessionCard['links'][number]['ref']['target'];
    const taskTarget: WorkLinkTarget = { kind: 'task', ref: { projectId: 'p', goalId: 'goal-1', taskId: 't-child' } };
    const moduleTarget: WorkLinkTarget = { kind: 'module', ref: { projectId: 'p', moduleId: 'm-1' } };
    const workTarget: WorkLinkTarget = { kind: 'work', ref: { aggregateType: 'WorkContextBinding', projectId: 'p', workspaceId: 'w', workId: 'work-1' } };
    const linkHtml = renderWorkLinkTarget(taskTarget) + renderWorkLinkTarget(moduleTarget) + renderWorkLinkTarget(workTarget);
    expect(linkHtml).toContain('data-work-link="task"');
    expect(linkHtml).toContain('data-work-link="module"');
    expect(linkHtml).toContain('data-work-link="work"');
    expect(linkHtml).toContain('t-child');
    expect(linkHtml).toContain('goal-1');
    expect(linkHtml).toContain('m-1');
    expect(linkHtml).toContain('work-1');
    expect(linkHtml).toContain('data-action="find-sessions"');

    // R6 Task-execution -> original history consumer (stage one): the shared
    // TaskRow renderer produces the one narrow entry seam, carrying the complete
    // RunRef identity. A future/planning node without an execution states the
    // real gap instead of fabricating history.
    const executionRunRef: RunRef = { aggregateType: 'Run', projectId: 'p', goalId: 'goal-1', runId: 'run-work-2' };
    const taskWithExecution: TaskRow = { ...taskRow('t-child', 'running', 'active', []), execution: executionRunRef };
    const entryHtml = renderTaskExecutionEntry(taskWithExecution);
    expect(entryHtml).toContain('data-project-id="p"');
    expect(entryHtml).toContain('data-goal-id="goal-1"');
    expect(entryHtml).toContain('data-run-id="run-work-2"');
    expect(entryHtml).toContain('data-task-id="t-child"');
    const noExecutionHtml = renderTaskExecutionEntry(taskRow('t-future', 'pending', 'deferred', []));
    expect(noExecutionHtml).toContain('data-execution-entry="none"');
    expect(noExecutionHtml).toContain('当前图没有可打开的执行引用');
    expect(noExecutionHtml).not.toContain('data-run-id');
    // The original reducer keeps the typed execution_history / Session-history
    // identity; nothing is parsed back out of the title.
    const displayLayout = createWorkbenchLayout({ projectId: 'p', workspaceId: 'w' }, sessionRef, 'active');
    const executionTab: WorkbenchTab = { tabId: 'execution:goal-1:run-work-2', kind: 'execution_history',
      title: '本次执行（标题不承载身份）', run: executionRunRef,
      task: { projectId: 'p', goalId: 'goal-1', taskId: 't-child' } };
    const sessionHistoryTab: WorkbenchTab = { tabId: `history:${sessionRef.sessionId}`, kind: 'history',
      title: '完整会话原历史', session: sessionRef };
    const withExecution = reduceWorkbenchLayout(displayLayout, { kind: 'open_tab', tab: executionTab });
    const withBoth = reduceWorkbenchLayout(withExecution, { kind: 'open_tab', tab: sessionHistoryTab });
    const savedExecution = withBoth.tabs.find(tab => tab.tabId === executionTab.tabId);
    const savedSessionHistory = withBoth.tabs.find(tab => tab.tabId === sessionHistoryTab.tabId);
    expect(savedExecution?.kind).toBe('execution_history');
    expect(savedExecution?.kind === 'execution_history' ? savedExecution.run : null).toEqual(executionRunRef);
    expect(savedExecution?.kind === 'execution_history' ? savedExecution.task : null)
      .toEqual({ projectId: 'p', goalId: 'goal-1', taskId: 't-child' });
    expect(savedSessionHistory?.kind).toBe('history');
    expect(savedSessionHistory?.kind === 'history' ? savedSessionHistory.session : null).toEqual(sessionRef);
    // Stage one final-shape assertion: the entry opens the original execution
    // window. Only the typed identity plus the explicit unsupported marker is
    // rendered now, so this line is the intended first red of this batch.
    expect(entryHtml).toContain('data-execution-entry="open"');
  });
});


// R6 execution-entry display/continuation consumption group. It uses the real
// public receipt shapes; the display is green in stage one and the one
// continuation seam is the explicit unsupported gap.
describe('R6 execution-entry display and continuation seam', () => {
  const scope: CoreScope = { projectId: 'p', workspaceId: 'w' };
  const originalRequest = { scope, input: {
    queryRunRef: { aggregateType: 'QueryRun', projectId: 'p', workspaceId: 'w', queryJobId: 'job-1', runId: 'run-1' } } };

  it('shows the safe execution projection, the real answer body and its sources', () => {
    const execution: BootstrapExecution = {
      queryProfiles: [{
        id: 'profile-1', label: '只读调查', scope,
        sessionRole: { kind: 'legacy_template', templateId: 'advisor', templateRevision: '1' },
        roleBinding: { schemaVersion: 1, bindingId: 'b1', templateId: 'advisor', templateRevision: '1', bindingVersion: 1, policyRevision: '1' },
        runtimeBudget: { contextWindowTokens: 200000, inputTokens: null, outputTokens: null, maxRequests: 8, maxToolCalls: 8, timeoutMs: 30000, perResponseTokens: 512 },
        budget: { maxTokens: 4096, deadline: null }, consumerId: 'consumer-1',
      }],
      workflowScopes: [scope],
    };
    const profilesHtml = renderExecutionProfiles(execution, 'profile-1');
    expect(profilesHtml).toContain('data-view="execution-profiles"');
    expect(profilesHtml).toContain('data-profile-id="profile-1"');
    expect(profilesHtml).toContain('data-action="run-investigation"');
    expect(profilesHtml).toContain('data-action="run-planning"');
    expect(profilesHtml).not.toContain('secret');

    const answer: QueryJobAnswerSnapshot = {
      ref: { aggregateType: 'QueryJobAnswer', projectId: 'p', workspaceId: 'w', queryJobId: 'job-1', answerId: 'answer-1' },
      revision: 1, schemaVersion: 1,
      answer: { schemaVersion: 1, answerId: 'answer-1',
        queryJobRef: { aggregateType: 'QueryJob', projectId: 'p', workspaceId: 'w', queryJobId: 'job-1' },
        runRef: { aggregateType: 'QueryRun', projectId: 'p', workspaceId: 'w', queryJobId: 'job-1', runId: 'run-1' },
        roundIndex: 0, answer: '调查回答正文',
        sources: [{ kind: 'project_source', refKey: 'src/module.ts', version: 'd'.repeat(64), label: 'module.ts' }],
        followsAnswerRef: null, stale: false, staleReason: null, answeredAt: '2026-09-26T00:00:00.000Z', bodyRef: {} as never },
    };
    const body: ArtifactRecord = { ref: {} as never, body: '回答正文工件内容', sourceRefs: [] };
    const answerHtml = renderQueryAnswer({ status: 'ready', value: answer }, { status: 'ready', value: body });
    expect(answerHtml).toContain('data-view="query-answer"');
    expect(answerHtml).toContain('调查回答正文');
    expect(answerHtml).toContain('回答正文工件内容');
    expect(answerHtml).toContain('data-answer-body');
    expect(answerHtml).toContain('src/module.ts');
    expect(answerHtml).toContain('data-answer-status');

    const stale = renderQueryAnswer(
      { status: 'ready', value: { ...answer, answer: { ...answer.answer, stale: true, staleReason: '来源已更新' } } },
      { status: 'not_found' });
    expect(stale).toContain('data-answer-stale="true"');
    expect(stale).toContain('来源已更新');
    expect(stale).toContain('回答正文工件不存在');
  });

  it('keeps waiting, next and official completed distinct and preserves the full original request', () => {
    const waiting: WorkflowAdvanceResult = { status: 'ready', value: { state: 'waiting', receipt: null, next: null, reason: '需要新的治理依据' } };
    const waitingHtml = renderWorkflowAdvance(waiting, originalRequest);
    expect(waitingHtml).toContain('data-state="waiting"');
    expect(waitingHtml).toContain('等待中');
    expect(waitingHtml).toContain('需要新的治理依据');
    expect(waitingHtml).toContain('已发送的完整原请求');
    expect(waitingHtml).toContain('run-1');
    expect(waitingHtml).not.toContain('正式完成');

    const advance: WorkflowAdvanceResult = { status: 'ready', value: {
      state: 'advance',
      receipt: { kind: 'start', result: { status: 'ready', value: { run: {} } } } as never,
      next: { schemaVersion: 1, goalRef: { aggregateType: 'Goal', projectId: 'p', goalId: 'g' },
        flowId: 'flow-1', sessionHint: null, kind: 'select_work' },
      reason: null,
    } };
    const advanceHtml = renderWorkflowAdvance(advance, originalRequest);
    expect(advanceHtml).toContain('data-state="advance"');
    expect(advanceHtml).toContain('data-receipt-kind="start"');
    expect(advanceHtml).toContain('下一步原请求');
    expect(advanceHtml).toContain('select_work');

    const completed: WorkflowAdvanceResult = { status: 'ready', value: {
      state: 'completed', receipt: { kind: 'complete_goal', result: { status: 'committed' } } as never, next: null, reason: null,
    } };
    const completedHtml = renderWorkflowAdvance(completed, originalRequest);
    expect(completedHtml).toContain('data-state="completed"');
    expect(completedHtml).toContain('正式完成');
    expect(completedHtml).not.toContain('下一步原请求');

    const planning: InitialPlanningGoalInputResult = { status: 'ready', value: {
      state: 'proposed',
      receipt: { status: 'committed', value: { kind: 'candidate_v2' }, replayed: false, cursor: 'c1' } as never,
      next: { kind: 'goal_input', input: { schemaVersion: 1,
        goalRef: { aggregateType: 'Goal', projectId: 'p', goalId: 'g' }, flowId: 'flow-1', sessionHint: null,
        executeWithinRequest: true, kind: 'adopt_initial_plan',
        request: { meta: { requestId: 'wf:x', expected: [] },
          input: { proposalRef: {} as never, expectedProposalRevision: 1, decisionRefs: [] } } } },
    } };
    const planningHtml = renderInitialPlanning(planning, originalRequest);
    expect(planningHtml).toContain('data-view="initial-planning"');
    expect(planningHtml).toContain('data-state="proposed"');
    expect(planningHtml).toContain('data-next-kind="goal_input"');
    expect(planningHtml).toContain('adopt_initial_plan');

    // Final contract: a real `next` is forwarded with its original input, and a
    // null next (waiting/completed) is a real stop. Stage one MUST be red here;
    // the production seam stays explicitly unsupported and is never relaxed.
    if (advance.status !== 'ready') throw new Error('fixture advance must be ready');
    expect(planExecutionContinuation(advance)).toEqual({
      status: 'next', route: 'workflow/advance', input: advance.value.next });
    if (planning.status !== 'ready' || planning.value.next === null || planning.value.next.kind !== 'goal_input')
      throw new Error('fixture planning must carry a goal_input next');
    expect(planExecutionContinuation(planning)).toEqual({
      status: 'next', route: 'workflow/goal-input', input: planning.value.next.input });
    expect(planExecutionContinuation(waiting)).toEqual({ status: 'stop', reason: '需要新的治理依据' });
    expect(planExecutionContinuation(completed)).toEqual({ status: 'stop', reason: null });
  });
});
