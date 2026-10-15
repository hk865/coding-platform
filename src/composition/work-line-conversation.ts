/**
 * Slice 2C Host composition: the line `conversation` section (L12, LR7).
 *
 * WorkGraph gives only the segments (`readWorkLineConversationSource`: the
 * chain, each segment's Kernel identity and whether its original history can be
 * read). This owner reads the original history through the AgentRuntime
 * (`readSessionHistory`) one segment at a time, in Kernel position order, and
 * pages it. The `executions` section and every other section stay WorkGraph
 * reads, so `readWorkLinePage` forwards them to `WorkLineReadPort`.
 *
 * The page cursor binds the line and the ordered segment list as it was on the
 * first page: a later page re-reads the source once and answers `source_stale`
 * when the chain changed (a predecessor appeared or a successor was created).
 * The second half of the cursor is the segment index plus the segment state:
 * `before_header` (its header has not been emitted), `header_only` (the header
 * was emitted, no history yet) or the last emitted `SessionHistoryEntry.cursor`
 * (the Runtime's opaque cursor, carried verbatim). A `missing`/`damaged`
 * segment emits only its header row and moves on.
 */
import type { CoreCallContext } from '../contracts/core/call-context.js';
import type { SessionRef, WorkspaceScope } from '../contracts/core/identity.js';
import type { ReadResult } from '../contracts/core/results.js';
import type { CommitCursor } from '../contracts/command-event.js';
import type { LineSegmentV1, WorkLineSectionPageV1 } from '../contracts/work-line.js';
import type { SessionHistoryEntry } from '../core/agent-runtime/session-operations.js';
import type { RuntimeExecutionPort } from '../core/agent-runtime/ports.js';
import type { WorkLineReadPort } from '../core/work-graph/model/work-line-contracts.js';

/**
 * The page `lines/page` returns for the Host-assembled `conversation` section
 * (L12). It lives here, in the Host composition that builds it, and is
 * re-exported by `src/app/core-http-types.ts` as the Host HTTP DTO. The
 * architecture check forbids composition from importing the Host layer, so the
 * definition cannot live in `core-http-types.ts` itself; the Host DTO is the
 * re-export (spec §2 placement, adjusted for the frozen boundary rule).
 */
export type WorkLineConversationPageV1 = {
  section: 'conversation';
  items: ( { kind: 'segment'; segment: LineSegmentV1 }
         | { kind: 'history'; session: SessionRef; entry: SessionHistoryEntry })[];
  nextCursor: string | null;
  sourceCursor: CommitCursor;
};

export type WorkLineConversationInput = {
  workspace: WorkspaceScope;
  key: SessionRef;
  section: WorkLineSectionPageV1['section'] | 'conversation';
  page: { limit: number; cursor?: string };
};

export type WorkLineConversationPort = {
  readWorkLinePage(ctx: CoreCallContext, input: WorkLineConversationInput):
    Promise<ReadResult<WorkLineSectionPageV1 | WorkLineConversationPageV1>>;
};

export type WorkLineConversationDependencies = {
  lines: WorkLineReadPort;
  readSessionHistory: RuntimeExecutionPort['readSessionHistory'];
};

type SegmentState = { kind: 'before_header' } | { kind: 'header_only' } | { kind: 'cursor'; cursor: string };

type ConversationCursorV1 = {
  section: 'conversation';
  key: string;
  chain: string[];
  segment: number;
  state: SegmentState;
};

const CURSOR_PREFIX = 's2c-conv:';
const MAX_PAGE = 100;

function sessionKey(ref: SessionRef): string {
  return `${ref.projectId}\u0000${ref.sessionId}`;
}

function encodeCursor(cursor: ConversationCursorV1): string {
  return CURSOR_PREFIX + JSON.stringify(cursor);
}

function isSegmentState(value: unknown): value is SegmentState {
  if (typeof value !== 'object' || value === null) return false;
  const kind = (value as { kind?: unknown }).kind;
  if (kind === 'before_header' || kind === 'header_only') return true;
  return kind === 'cursor' && typeof (value as { cursor?: unknown }).cursor === 'string';
}

function decodeCursor(raw: string): ConversationCursorV1 | null {
  if (!raw.startsWith(CURSOR_PREFIX)) return null;
  try {
    const parsed = JSON.parse(raw.slice(CURSOR_PREFIX.length)) as Partial<ConversationCursorV1>;
    if (parsed.section !== 'conversation' || typeof parsed.key !== 'string' || !Array.isArray(parsed.chain)) return null;
    if (!parsed.chain.every((entry) => typeof entry === 'string')) return null;
    if (!Number.isSafeInteger(parsed.segment) || (parsed.segment as number) < 0) return null;
    if (!isSegmentState(parsed.state)) return null;
    return parsed as ConversationCursorV1;
  } catch {
    return null;
  }
}

export function createWorkLineConversation(deps: WorkLineConversationDependencies): WorkLineConversationPort {
  return {
    async readWorkLinePage(ctx, input): Promise<ReadResult<WorkLineSectionPageV1 | WorkLineConversationPageV1>> {
      if (input.section !== 'conversation') {
        return deps.lines.readWorkLinePage(ctx, {
          workspace: input.workspace, key: input.key, section: input.section, page: input.page,
        });
      }
      if (!Number.isSafeInteger(input.page.limit) || input.page.limit < 1 || input.page.limit > MAX_PAGE) {
        return { status: 'rejected', code: 'invalid', reason: `lines/page limit must be an integer in 1..${String(MAX_PAGE)}` };
      }
      const source = await deps.lines.readWorkLineConversationSource(ctx,
        { workspace: input.workspace, key: input.key });
      if (source.status !== 'ready') return source;
      const segments = source.value.segments;
      const chain = segments.map((segment) => sessionKey(segment.session));
      // L12: the cursor binds the resolved LINE HEAD, not the caller's key (which
      // may be a predecessor). Segments are oldest-first, so the last is the head.
      const resolvedHead = segments[segments.length - 1]?.session ?? input.key;
      const key = sessionKey(resolvedHead);

      let index = 0;
      let state: SegmentState = { kind: 'before_header' };
      if (input.page.cursor !== undefined) {
        const cursor = decodeCursor(input.page.cursor);
        if (cursor === null) {
          return { status: 'rejected', code: 'invalid', reason: 'the conversation cursor is not readable' };
        }
        // L12: a changed chain (a new head) answers `source_stale` first, so a
        // stale cursor is never misreported as invalid by the head-key compare.
        if (cursor.chain.length !== chain.length || cursor.chain.some((entry, at) => entry !== chain[at])) {
          return { status: 'rejected', code: 'source_stale', reason: 'the line chain changed since the cursor was issued' };
        }
        if (cursor.key !== key) {
          return { status: 'rejected', code: 'invalid', reason: 'the conversation cursor is not readable' };
        }
        index = cursor.segment;
        state = cursor.state;
      }

      const limit = input.page.limit;
      const items: WorkLineConversationPageV1['items'] = [];
      while (index < segments.length && items.length < limit) {
        const segment = segments[index];
        if (segment === undefined) break;
        if (state.kind === 'before_header') {
          // L12: the segment header comes first; a segment whose history is not
          // readable emits only this row and never calls the Runtime.
          items.push({ kind: 'segment', segment });
          if (segment.history === 'not_readable') {
            index += 1;
            state = { kind: 'before_header' };
            continue;
          }
          state = { kind: 'header_only' };
          continue;
        }
        if (segment.history === 'not_readable') {
          index += 1;
          state = { kind: 'before_header' };
          continue;
        }
        const remaining = limit - items.length;
        const page = await deps.readSessionHistory(ctx, {
          sessionRef: segment.session,
          afterCursor: state.kind === 'cursor' ? state.cursor : null,
          throughCursor: null,
          limit: remaining,
        });
        if (page.status !== 'ready') return page;
        for (const entry of page.value.items) {
          items.push({ kind: 'history', session: segment.session, entry });
        }
        if (page.value.nextCursor !== null) {
          const last = page.value.items[page.value.items.length - 1];
          state = last === undefined ? { kind: 'header_only' } : { kind: 'cursor', cursor: last.cursor };
          break;
        }
        index += 1;
        state = { kind: 'before_header' };
      }

      const nextCursor = index >= segments.length
        ? null
        : encodeCursor({ section: 'conversation', key, chain, segment: index, state });
      return {
        status: 'ready',
        value: { section: 'conversation', items, nextCursor, sourceCursor: source.value.sourceCursor },
      };
    },
  };
}
