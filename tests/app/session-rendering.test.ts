/**
 * Session rendering Stage-1 risk tests (DSH skeleton gate).
 *
 * These cases freeze the reviewed interface for Session conversation rendering
 * BEFORE the renderer is implemented. They are expected to be red on purpose:
 * `renderMarkdown` fails loudly and the tool-call card contract is not built
 * yet. No assertion is weakened and no fake implementation is added to make a
 * case green; the red reasons are recorded in the Stage-1 contract output.
 *
 * Specification: docs/refactor/tasks/SESSION-rendering-2026-09-29.md and
 * docs/refactor/tasks/SESSION-rendering-scope.json.
 *
 * Fields are the real Kernel record/event schema confirmed in
 * vendor/coding-agent/dist/core/ports/session_store/session-store-port.d.ts and
 * vendor/coding-agent/dist/core/runtime/events/agent-events.d.ts. The page unit
 * is the existing SessionHistoryEntry projection
 * (src/core/agent-runtime/session-operations.ts) and the renderer under test is
 * the existing `renderSessionHistoryTimeline` -> parseHistoryBody /
 * renderHistorySequence path. No parallel history system is introduced.
 */
import { describe, expect, it } from 'vitest';
import type { ReadResult } from '../../src/contracts/core/results.js';
import type { Page, SessionHistoryEntry } from '../../src/app/core-http-types.js';
import { renderMarkdown } from '../../src/ui/markdown.js';
import { renderSessionHistoryTimeline } from '../../src/ui/views.js';

const EVENT_TIME = '2026-09-29T00:00:00.000Z';

type AgentEventFixture = {
  recordId: string;
  position: number;
  runId: string;
  type: string;
  payload: Record<string, unknown>;
  adapterId?: string;
  kernelSessionId?: string;
};

/** One real `agent.event` Kernel session record, exactly as persisted. */
function agentEvent(fixture: AgentEventFixture): SessionHistoryEntry {
  const adapterId = fixture.adapterId ?? 'adapter-1';
  const kernelSessionId = fixture.kernelSessionId ?? 'session-1';
  const text = JSON.stringify({
    schemaVersion: 1,
    recordId: fixture.recordId,
    sessionId: kernelSessionId,
    position: fixture.position,
    recordedAt: EVENT_TIME,
    checksum: '0'.repeat(64),
    recordType: 'agent.event',
    payload: {
      event: {
        type: fixture.type,
        meta: {
          schemaVersion: 1,
          eventId: `event-${fixture.recordId}`,
          runId: fixture.runId,
          turnId: `turn-${fixture.runId}`,
          sequence: fixture.position,
          occurredAt: EVENT_TIME,
          elapsedMs: fixture.position,
        },
        payload: fixture.payload,
      },
    },
  });
  return {
    recordId: fixture.recordId,
    cursor: `kernhist1.${fixture.position}`,
    recordedAt: EVENT_TIME,
    kind: 'agent_event',
    source: { adapterId, kernelSessionId, position: fixture.position },
    body: { encoding: 'kernel_session_record_json', text },
  };
}

/** A real `turn.started` record; userMessage may contain Host-assembled execution input. */
function userTurn(recordId: string, position: number, runId: string, content: string): SessionHistoryEntry {
  const text = JSON.stringify({
    schemaVersion: 1,
    recordId,
    sessionId: 'session-1',
    position,
    recordedAt: EVENT_TIME,
    checksum: '0'.repeat(64),
    recordType: 'turn.started',
    payload: {
      run: {
        schemaVersion: 1,
        runId,
        createdAt: EVENT_TIME,
        turn: {
          turnId: `turn-${runId}`,
          userMessage: { schemaVersion: 1, messageId: `msg-${runId}`, role: 'user', content },
        },
      },
      config: {
        modelConfigId: 'model-1',
        limits: {
          maxModelRequests: null, maxToolCalls: null, maxInputTokens: null,
          maxOutputTokens: null, maxTotalTokens: null, maxCostUsdMicros: null, deadlineMs: null,
        },
        enabledToolSchemaDigest: 'tools',
        policyVersion: '1',
        sandboxProfileVersion: '1',
        baseConfigDigest: 'base',
      },
      workspace: { identity: 'w', revision: 'r1', reference: '/display-fixture' },
    },
  });
  return {
    recordId,
    cursor: `kernhist1.${position}`,
    recordedAt: EVENT_TIME,
    kind: 'turn_started',
    source: { adapterId: 'adapter-1', kernelSessionId: 'session-1', position },
    body: { encoding: 'kernel_session_record_json', text },
  };
}

const toolCall = (callId: string, name: string, args: Record<string, unknown>): Record<string, unknown> =>
  ({ schemaVersion: 1, callId, name, arguments: args });

const effects = (): Record<string, unknown> =>
  ({ sideEffect: 'none', changedPaths: [], workspaceRevision: null, artifactRefs: [] });

const outputParts = (text: string): Record<string, unknown>[] => [{ kind: 'text', text }];

function assistant(
  recordId: string, position: number, runId: string, content: string, toolCalls: Record<string, unknown>[] = [],
): SessionHistoryEntry {
  return agentEvent({
    recordId, position, runId, type: 'assistant.message_completed',
    payload: {
      requestId: `req-${position}`,
      message: { schemaVersion: 1, messageId: `msg-${position}`, role: 'assistant', content },
      toolCalls,
    },
  });
}

function toolStarted(
  recordId: string, position: number, runId: string, callId: string, name: string, args: Record<string, unknown>,
): SessionHistoryEntry {
  return agentEvent({ recordId, position, runId, type: 'tool.started', payload: { call: toolCall(callId, name, args) } });
}

function toolCompleted(
  recordId: string, position: number, runId: string, callId: string, output: Record<string, unknown>[],
): SessionHistoryEntry {
  return agentEvent({
    recordId, position, runId, type: 'tool.completed',
    payload: { callId, result: { status: 'success', schemaVersion: 1, callId, output, effects: effects() } },
  });
}

function toolFailed(recordId: string, position: number, runId: string, callId: string, message: string): SessionHistoryEntry {
  return agentEvent({
    recordId, position, runId, type: 'tool.failed',
    payload: {
      callId, phase: 'execution',
      result: {
        status: 'error', schemaVersion: 1, callId,
        error: { code: 'execution_failed', message, retryable: false },
        output: outputParts(message), effects: effects(),
      },
    },
  });
}

function toolCancelled(recordId: string, position: number, runId: string, callId: string, reason: string): SessionHistoryEntry {
  return agentEvent({
    recordId, position, runId, type: 'tool.cancelled',
    payload: {
      callId,
      result: { status: 'cancelled', reason, schemaVersion: 1, callId, output: outputParts(`cancelled:${reason}`), effects: effects() },
    },
  });
}

function page(items: SessionHistoryEntry[], nextCursor: string | null = null): ReadResult<Page<SessionHistoryEntry>> {
  return {
    status: 'ready',
    value: {
      items,
      nextCursor,
      basis: { kind: 'session', ref: { projectId: 'p', sessionId: 'session-1' }, cursor: 'kernhist1.basis' },
    },
  };
}

// --- HTML contract helpers (identity-bearing data attributes, not snapshots) ---

function openingTags(html: string, marker: string): string[] {
  return [...html.matchAll(/<[^>]*>/g)].map(match => match[0]).filter(tag => tag.includes(marker));
}

function taggedBlocks(html: string, attribute: string): { tag: string; text: string }[] {
  const pattern = new RegExp(`<([a-z]+)\\b[^>]*${attribute}[^>]*>([\\s\\S]*?)<\\/\\1>`, 'g');
  return [...html.matchAll(pattern)].map(match => {
    const full = match[0];
    return { tag: full.slice(0, full.indexOf('>') + 1), text: match[2] ?? '' };
  });
}

const fullCards = (html: string): string[] => openingTags(html, 'data-tool-card="full"');

function identityMatch(tag: string, callId: string, runId: string, session?: string): boolean {
  return tag.includes(`data-tool-call="${callId}"`)
    && tag.includes(`data-tool-run="${runId}"`)
    && (session === undefined || tag.includes(`data-tool-session="${session}"`));
}

const cardFor = (html: string, callId: string, runId: string, session?: string): string | undefined =>
  fullCards(html).find(tag => identityMatch(tag, callId, runId, session));

const blockFor = (html: string, attribute: string, callId: string, runId: string, session?: string): string | undefined =>
  taggedBlocks(html, attribute).find(block => identityMatch(block.tag, callId, runId, session))?.text;

const outputFor = (html: string, callId: string, runId: string, session?: string): string | undefined =>
  blockFor(html, 'data-tool-output', callId, runId, session);

const argumentsFor = (html: string, callId: string, runId: string, session?: string): string | undefined =>
  blockFor(html, 'data-tool-arguments', callId, runId, session);

describe('Session Markdown contract (renderMarkdown)', () => {
  it('renders normal Markdown structure as real elements, never as one escaped blob', () => {
    const html = renderMarkdown([
      '# 标题', '', '段落 **粗体** 与 `inline`', '', '- 一', '- 二', '',
      '> 引用', '', '```ts', 'const x = 1;', '```', '', '| a | b |', '| - | - |', '| 1 | 2 |',
    ].join('\n'));
    expect(html).toContain('<h1');
    expect(html).toContain('<strong>');
    expect(html).toContain('<code>');
    expect(html).toContain('<ul>');
    expect(html).toContain('<blockquote>');
    expect(html).toContain('<table>');
    expect(html).toContain('<pre>');
  });

  it('renders injected HTML as text and never as executable markup', () => {
    const html = renderMarkdown('<script>alert(1)</script>\n\n<img src=x onerror=alert(2)>');
    expect(html).not.toContain('<script>');
    expect(html).not.toContain('<img');
    expect(html).toContain('&lt;script&gt;');
    // Image alt text uses a separate Marked hook; it must not bypass escaping.
    const imageAlt = renderMarkdown('![`<img src=x onerror=alert(2)>`](https://example.com/x.png)');
    expect(imageAlt).not.toMatch(/<img/i);
  });

  it('allows only https/http/mailto links and rejects obfuscated dangerous schemes', () => {
    const safe = renderMarkdown('[https](https://example.com/a) [http](http://example.com) [mail](mailto:a@b.c)');
    expect(safe).toContain('href="https://example.com/a"');
    expect(safe).toContain('href="http://example.com"');
    expect(safe).toContain('href="mailto:a@b.c"');

    const dangerous = [
      'javascript:alert(1)',
      'JaVaScRiPt:alert(1)',
      'java&#115;cript:alert(1)',
      'java\t&#9;script:alert(1)',
      'data:text/html;base64,PHNjcmlwdD4=',
      'vbscript:msgbox(1)',
      'ftp://example.com/x',
    ];
    for (const destination of dangerous) {
      const html = renderMarkdown(`[x](${destination})`);
      expect(html).not.toMatch(/\bhref\s*=/i);
    }
    // A literal NUL control character must not smuggle a scheme past the check.
    const nul = renderMarkdown(`[x](java${String.fromCharCode(0)}script:alert(1))`);
    expect(nul).not.toMatch(/\bhref\s*=/i);
  });

  it('never auto-loads a remote image', () => {
    const html = renderMarkdown('![remote](https://evil.example/x.png)');
    expect(html).not.toMatch(/<img/i);
    expect(html).not.toMatch(/src\s*=\s*["']?https?:/i);
  });
});

describe('Session history tool-card identity and honest state', () => {
  it('renders assistant prose as Markdown and one full card at the terminal event for real toolCalls/start/result', () => {
    const html = renderSessionHistoryTimeline(page([
      userTurn('turn:1', 1, 'run-1', '请运行测试'),
      assistant('agent:assistant', 2, 'run-1', '## 修复完成\n\n已运行 `npm test`', [
        toolCall('call-1', 'run_command', { command: 'npm test' }),
      ]),
      toolStarted('agent:start', 3, 'run-1', 'call-1', 'run_command', { command: 'npm test' }),
      toolCompleted('agent:done', 4, 'run-1', 'call-1', outputParts('exit 0')),
    ]));

    expect(html).toContain('<h2'); // assistant body is Markdown

    const cards = fullCards(html);
    expect(cards).toHaveLength(1); // the same call never becomes several full cards
    const card = cards[0] ?? '';
    expect(card).toContain('data-tool-call="call-1"');
    expect(card).toContain('data-tool-run="run-1"');
    expect(card).toContain('data-tool-status="completed"');
    expect(card).toContain('data-tool-terminal="agent:done"');
    expect(card).toContain('run_command');
    expect(argumentsFor(html, 'call-1', 'run-1') ?? '').toContain('npm test');
    expect(outputFor(html, 'call-1', 'run-1') ?? '').toContain('exit 0');
    expect(html).toContain('data-history="agent:start"'); // the start record stays reachable
    const declaredOnly = renderSessionHistoryTimeline(page([
      assistant('declared', 1, 'run-2', '', [toolCall('call-2', 'read', { path: 'a.ts' })]),
    ], 'kernhist1.next'));
    expect(declaredOnly).toContain('data-tool-card="pending"');
    expect(declaredOnly).toContain('已请求');
    const plan = renderSessionHistoryTimeline(page([assistant('plan', 2, 'run-3', JSON.stringify({
      schemaVersion: 2, kind: 'plan', summary: '**实现说明**', plan: { tasks: [{ title: '修改重试循环' }] },
    }))]));
    expect(plan).toContain('<strong>实现说明</strong>');
    expect(plan).toContain('<li>修改重试循环</li>');
    expect(plan).toContain('计划候选 · 模型输出');
    expect(plan).toContain('完整结构化输出');
    const linkedProse = renderSessionHistoryTimeline(page([
      assistant('linked-prose', 3, 'run-3', '[查看文档](https://example.com/docs)\n\n下一步继续。'),
    ]));
    expect(linkedProse).toContain('href="https://example.com/docs"');
    expect(linkedProse).not.toContain('结构化文本（未解析）');
  });

  it('keeps failed and cancelled results distinct from success', () => {
    const html = renderSessionHistoryTimeline(page([
      toolStarted('s-fail', 1, 'run-1', 'call-f', 'read_file', { path: 'a.ts' }),
      toolFailed('t-fail', 2, 'run-1', 'call-f', 'file not found'),
      toolStarted('s-cancel', 3, 'run-1', 'call-c', 'run_command', { command: 'sleep 1' }),
      toolCancelled('t-cancel', 4, 'run-1', 'call-c', 'caller_requested'),
    ]));
    expect(cardFor(html, 'call-f', 'run-1') ?? '').toContain('data-tool-status="failed"');
    expect(outputFor(html, 'call-f', 'run-1') ?? '').toContain('file not found');
    expect(cardFor(html, 'call-c', 'run-1') ?? '').toContain('data-tool-status="cancelled"');
    expect(outputFor(html, 'call-c', 'run-1') ?? '').toContain('caller_requested');
  });

  it('associates tools by adapter+kernelSession+runId+callId across interleaved and cross-run calls', () => {
    const html = renderSessionHistoryTimeline(page([
      toolStarted('r1-start', 1, 'run-1', 'call-1', 'read_file', { path: 'one.ts' }),
      toolStarted('parallel-start', 2, 'run-1', 'call-2', 'read_file', { path: 'parallel.ts' }),
      toolCompleted('parallel-done', 3, 'run-1', 'call-2', outputParts('PARALLEL-DONE')),
      toolCompleted('r1-done', 4, 'run-1', 'call-1', outputParts('ONE-DONE')),
      toolStarted('r2-start', 5, 'run-2', 'call-1', 'read_file', { path: 'two.ts' }),
      toolCompleted('r2-done', 6, 'run-2', 'call-1', outputParts('TWO-DONE')),
    ]));

    expect(fullCards(html)).toHaveLength(3);
    expect(outputFor(html, 'call-2', 'run-1') ?? '').toContain('PARALLEL-DONE');
    expect(cardFor(html, 'call-1', 'run-1') ?? '').toContain('data-tool-terminal="r1-done"');
    expect(cardFor(html, 'call-1', 'run-2') ?? '').toContain('data-tool-terminal="r2-done"');
    expect(argumentsFor(html, 'call-1', 'run-1') ?? '').toContain('one.ts');
    expect(argumentsFor(html, 'call-1', 'run-2') ?? '').toContain('two.ts');
    expect(outputFor(html, 'call-1', 'run-1') ?? '').toContain('ONE-DONE');
    expect(outputFor(html, 'call-1', 'run-2') ?? '').toContain('TWO-DONE');
    expect(outputFor(html, 'call-1', 'run-1') ?? '').not.toContain('TWO-DONE');
    expect(outputFor(html, 'call-1', 'run-2') ?? '').not.toContain('ONE-DONE');
  });

  it('shows only the known facts when this page has a start but no terminal result', () => {
    const html = renderSessionHistoryTimeline(page([
      toolStarted('start-only', 1, 'run-1', 'call-9', 'run_command', { command: 'npm test' }),
    ], 'kernhist1.next'));

    expect(html).toContain('本页未见结果');
    expect(html).not.toContain('运行中');
    expect(fullCards(html)).toHaveLength(0);
    const pending = openingTags(html, 'data-tool-card="pending"');
    expect(pending).toHaveLength(1);
    expect(pending[0] ?? '').toContain('data-tool-call="call-9"');
    expect(pending[0] ?? '').toContain('data-tool-run="run-1"');
    expect(html).toContain('kernhist1.next');
    expect(html).toContain('还有更多');
  });

  it('shows a real result without inventing the start it does not have on this page', () => {
    const html = renderSessionHistoryTimeline(page([
      toolCompleted('done-only', 1, 'run-1', 'call-9', outputParts('ONLY-RESULT')),
    ]));
    expect(outputFor(html, 'call-9', 'run-1') ?? '').toContain('ONLY-RESULT');
    expect(html).toContain('本页未见参数');
  });

  it('never labels run.input_accepted as human user input', () => {
    const html = renderSessionHistoryTimeline(page([
      agentEvent({ recordId: 'input-accepted', position: 1, runId: 'run-1', type: 'run.input_accepted',
        payload: { input: { inputId: 'in-1', messageId: 'm-1', text: '自动注入的输入', sourceRef: { kind: 'scheduler' } } } }),
    ]));
    expect(html).toContain('自动注入的输入');
    expect(html).toContain('data-history-body="context_input"');
    expect(html).not.toContain('data-history-body="user_input"');
    expect(html).not.toContain('q-msg-user');
  });

  it('renders full user/assistant bodies without an arbitrary 450-character cut', () => {
    const assistantTail = 'ASSISTANT-TAIL-MARKER';
    const userTail = 'USER-TAIL-MARKER';
    const html = renderSessionHistoryTimeline(page([
      userTurn('turn:1', 1, 'run-1', `${'b'.repeat(3000)}${userTail}`),
      assistant('agent:a', 2, 'run-1', `${'a'.repeat(3000)}${assistantTail}`),
    ]));
    const visibleAssistant = html.match(/data-history-body="assistant_text"[\s\S]*?<div class="q-message-text">([\s\S]*?)<\/div>/)?.[1] ?? '';
    expect(visibleAssistant).toContain(assistantTail);
    expect(html).toContain(userTail);
  });

  it('keeps every original record reachable in raw form and in original order', () => {
    const entries = [
      userTurn('turn:1', 1, 'run-1', '用户一'),
      assistant('agent:a', 2, 'run-1', '助手一'),
      toolStarted('agent:start', 3, 'run-1', 'call-1', 'read_file', { path: 'a.ts' }),
      toolCompleted('agent:done', 4, 'run-1', 'call-1', outputParts('OUT')),
      agentEvent({ recordId: 'agent:unknown', position: 5, runId: 'run-1', type: 'future.event', payload: { note: 'unknown' } }),
    ];
    const saved = JSON.parse((entries[1]!.body as { text: string }).text);
    saved.payload.event.payload.message.reasoningContent = '**已保存的判断**';
    (entries[1]!.body as { text: string }).text = JSON.stringify(saved);
    const html = renderSessionHistoryTimeline(page(entries));
    expect(html).toContain('<strong>已保存的判断</strong>');
    expect(html).toMatch(/<details class="history-reasoning">/);
    for (const entry of entries) {
      expect(html).toContain(`data-history="${entry.recordId}"`);
      expect(html).toContain(`data-history-raw="${entry.recordId}"`);
    }
    // The exact saved text of a record stays readable inside its raw disclosure,
    // not merely as a reachable attribute reference; unknown text is not dropped.
    expect(taggedBlocks(html, 'data-history-raw="agent:unknown"')[0]?.text ?? '').toContain('future.event');
    expect(taggedBlocks(html, 'data-history-raw="agent:unknown"')[0]?.text ?? '').toContain('unknown');
    expect(taggedBlocks(html, 'data-history-raw="agent:start"')[0]?.text ?? '').toContain('read_file');
    expect(taggedBlocks(html, 'data-history-raw="agent:done"')[0]?.text ?? '').toContain('OUT');
    const order = entries.map(entry => html.indexOf(`data-history="${entry.recordId}"`));
    expect(order).toEqual([...order].sort((left, right) => left - right));
  });

  // UI-progressive Stage-1 contract (docs/refactor/tasks/UI-progressive-session-2026-09-29.md):
  // contiguous same-identity activity collapses into one summary carrying the real
  // adapter+kernelSession+run identity; prose and run/source changes cut the group and
  // original order is preserved. The collapsed summary must expose failure/cancel and
  // neutral unknown facts, never claiming success. These selectors are the proposed
  // display contract for Stage 2.
  it('groups only contiguous same-identity activity and cuts the group at prose and run boundaries', () => {
    const html = renderSessionHistoryTimeline(page([
      toolStarted('act-s1', 1, 'run-1', 'call-a', 'read_file', { path: 'a.ts' }),
      toolCompleted('act-t1', 2, 'run-1', 'call-a', outputParts('A')),
      toolStarted('act-s2', 3, 'run-1', 'call-b', 'grep', { pattern: 'x' }),
      toolCompleted('act-t2', 4, 'run-1', 'call-b', outputParts('B')),
      assistant('act-prose', 5, 'run-1', '分组之间的正文'),
      toolStarted('act-s3', 6, 'run-1', 'call-c', 'read_file', { path: 'b.ts' }),
      toolCompleted('act-t3', 7, 'run-1', 'call-c', outputParts('C')),
      toolStarted('act-s4', 8, 'run-2', 'call-d', 'read_file', { path: 'd.ts' }),
      toolCompleted('act-t4', 9, 'run-2', 'call-d', outputParts('D')),
    ]));

    const groups = openingTags(html, 'data-activity-group');
    // Two adjacent run-1 calls are one group; prose cuts the second run-1 group;
    // the run change cuts the run-2 group. A per-call or per-run collapse is wrong here.
    expect(groups).toHaveLength(3);
    expect(groups[0] ?? '').toContain('data-activity-run="run-1"');
    expect(groups[0] ?? '').toContain('data-activity-session="adapter-1/session-1"');
    expect(groups[1] ?? '').toContain('data-activity-run="run-1"');
    expect(groups[2] ?? '').toContain('data-activity-run="run-2"');
    expect(groups[2] ?? '').toContain('data-activity-session="adapter-1/session-1"');
    // The assistant prose keeps its own readable body and is never absorbed by a group.
    expect(html).toContain('data-history-body="assistant_text"');
    expect(html).toContain('分组之间的正文');
    // Original order is preserved: no parallel record is re-sorted into another group.
    const order = ['act-s1', 'act-t1', 'act-s2', 'act-t2', 'act-prose', 'act-s3', 'act-t3', 'act-s4', 'act-t4']
      .map(id => html.indexOf(`data-history="${id}"`));
    expect(order).toEqual([...order].sort((left, right) => left - right));
  });

  it('shows failed, cancelled and unknown truthfully in the collapsed activity summary', () => {
    const html = renderSessionHistoryTimeline(page([
      toolStarted('bad-s', 1, 'run-1', 'call-bad', 'read_file', { path: 'x.ts' }),
      toolFailed('bad-t', 2, 'run-1', 'call-bad', 'permission denied'),
      toolStarted('cancel-s', 3, 'run-1', 'call-cancel', 'run_command', { command: 'sleep 5' }),
      toolCancelled('cancel-t', 4, 'run-1', 'call-cancel', 'caller_requested'),
      agentEvent({ recordId: 'unknown-x', position: 5, runId: 'run-1', type: 'future.event', payload: { note: 'mystery' } }),
    ]));

    const summaries = [...html.matchAll(/data-activity-group[^>]*>[\s\S]*?<summary[^>]*>([\s\S]*?)<\/summary>/g)]
      .map(match => match[1] ?? '');
    expect(summaries.length).toBeGreaterThan(0);
    const collapsed = summaries.join(' ');
    // Failure and cancellation are visible without expanding, never passed off as success.
    expect(collapsed).toContain('失败');
    expect(collapsed).toContain('取消');
    // An unknown member stays neutral (its real type or a neutral "执行记录").
    expect(collapsed).toMatch(/future\.event|执行记录/);
    expect(collapsed).not.toMatch(/全部成功|completed/i);
  });
});

describe('Initial-plan setup review (R6 cold-start)', () => {
  it('renders a saved setup candidate as a readable review with an explicit adoption boundary, not JSON only', () => {
    const html = renderSessionHistoryTimeline(page([
      assistant('setup-plan', 1, 'run-1', JSON.stringify({
        schemaVersion: 2, kind: 'plan', summary: '初始方案，含架构、完成策略与检查候选',
        plan: {
          schemaVersion: 2, stages: [], tasks: [{ taskId: 'work-1', title: '实现冷启动', requirementLevel: 'required',
            taskKind: 'work', disposition: 'active', phase: 'pending', scope: { kind: 'goal' }, executionIntent: 'request_execution' }],
          obligations: [], taskHierarchy: { parentOf: [] }, executionDag: { dependsOn: [] },
        },
        setup: {
          architecture: {
            baselineId: 'baseline-1', description: '初始模块边界', constraints: [],
            catalog: { requireDag: true, dependencies: [], modules: [{
              ref: { projectId: 'p', moduleId: 'module-1' }, name: '模块甲',
              responsibility: '负责冷启动', paths: ['src'], interfaces: [],
            }] },
          },
          completionPolicy: { schemaVersion: 1, requirementKinds: ['static'], minimumRequiredRequirementsPerObligation: 1 },
          checks: [{ checkId: 'check-1', kind: 'static', command: 'node --test', cwd: '.', timeoutMs: 60_000, taskIds: 'all' }],
        },
      })),
    ]));

    // The model output is still shown as a candidate, never as an adopted plan.
    expect(html).toContain('data-planning-output="plan"');
    // RED (Stage 2): the setup is a readable review with real identity markers,
    // not merely the escaped raw JSON in the "完整结构化输出" disclosure.
    expect(html).toContain('data-initial-plan-review');
    expect(html).toContain('data-setup-architecture');
    expect(html).toContain('data-setup-completion-policy');
    expect(html).toContain('data-setup-checks');
    // History is a read-only projection, never an adoption authority.
    expect(html).not.toContain('data-adopt-initial-plan');
    expect(html).toContain('候选初始架构');
  });
});
