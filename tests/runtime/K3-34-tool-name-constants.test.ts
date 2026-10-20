/**
 * K3-34 (R5, spec §5.2, L3): the L3 table against the Runtime's exported tool
 * name constants. The comparison lives here, not in `tests/state`, because the
 * constants are consumed by the `agent-runtime` modules that load the frozen
 * Kernel package.
 *
 * The authorization names carry `write`; the Kernel records `edit`
 * (`observed-model-run.ts` maps `write → edit`). The table is keyed by the
 * Kernel name, so `write` is mapped through `kernelToolNameOf` before the
 * comparison, never compared literally.
 */
import { describe, expect, it } from 'vitest';
import { EXPLORATION_TOOL_NAMES } from '../../src/core/agent-runtime/observed-model-run.js';
import {
  BUILTIN_TOOL_NAMES, RESERVED_TOOL_NAMES,
} from '../../src/core/agent-runtime/execution-driver.js';
import { WHITEBOARD_TOOL_NAMES } from '../../src/core/agent-runtime/whiteboard-tools.js';
import { NOTE_TOOL_NAMES } from '../../src/core/agent-runtime/note-tool.js';
import { containedByHostStop, kernelToolNameOf, unknownCallKindOf } from '../../src/core/work-graph/state/unknown-call-kinds.js';

const READ_ONLY_MAILBOX = ['read_session_inbox', 'read_session_message', 'read_session_message_body'];
const READ_ONLY_GRAPH = ['look_graph', 'find_graph'];
const READ_ONLY_DISCOVERY = ['find_related_sessions', 'read_session_card'];

describe('K3-34 tool-name constants', () => {
  it('K3-34 maps every cooperation constant name that is in the table to its kind', () => {
    for (const name of READ_ONLY_MAILBOX) expect([name, unknownCallKindOf(name)]).toEqual([name, 'read_only']);
    for (const name of READ_ONLY_DISCOVERY) expect([name, unknownCallKindOf(name)]).toEqual([name, 'read_only']);
    for (const name of READ_ONLY_GRAPH) expect([name, unknownCallKindOf(name)]).toEqual([name, 'read_only']);
    expect(unknownCallKindOf('read_user_decision')).toBe('read_only');
    expect(unknownCallKindOf('query_task_graph')).toBe('read_only');
    expect(unknownCallKindOf('query_ready_tasks')).toBe('read_only');
    for (const name of ['send_session_message', 'ack_session_message', 'respond_session_message', 'send_user_message',
      'record_decision_application', 'propose_future_plan', 'record_note']) {
      expect([name, unknownCallKindOf(name), containedByHostStop(name)]).toEqual([name, 'platform', true]);
    }
    // K3 row 4 / decision 72 (U1): the note tool constant names exactly record_note.
    expect([...NOTE_TOOL_NAMES].sort()).toEqual(['record_note']);
    // decision 64 deletes apply_future_plan; it is the row-8 default until 4C.
    expect(WHITEBOARD_TOOL_NAMES).toContain('apply_future_plan');
    expect(unknownCallKindOf('apply_future_plan')).toBe('process');
    expect(containedByHostStop('apply_future_plan')).toBe(false);
  });

  it('K3-34 maps BUILTIN_TOOL_NAMES through write -> edit into the table', () => {
    expect([...BUILTIN_TOOL_NAMES].sort()).toEqual(['read', 'shell', 'write']);
    expect(kernelToolNameOf('read')).toBe('read');
    expect(kernelToolNameOf('shell')).toBe('shell');
    expect(kernelToolNameOf('write')).toBe('edit');
    for (const kernel of ['read', 'shell', 'edit']) {
      expect([kernel, containedByHostStop(kernel)]).toEqual([kernel, true]);
    }
  });

  it('K3-34 holds every RESERVED_TOOL_NAMES member in the table after the mapping', () => {
    // Counted by hand from the spec's L3 name table, less the deleted
    // `project_index`: 3 builtin (`read`/`write`/`shell`) + `edit` + `check`
    // + the 10 exploration names = 15.
    expect(RESERVED_TOOL_NAMES.size).toBe(15);
    for (const name of RESERVED_TOOL_NAMES) {
      const kernel = kernelToolNameOf(name);
      expect([name, containedByHostStop(kernel)]).toEqual([name, true]);
    }
    // The exploration constant is exactly the table's row-1 exploration names.
    expect([...EXPLORATION_TOOL_NAMES].sort()).toEqual(['code_index', 'cpp_index', 'list_files',
      'project_source', 'python_index', 'read_material', 'read_source', 'search', 'source_excerpt', 'symbols']);
    for (const name of EXPLORATION_TOOL_NAMES) {
      expect([name, unknownCallKindOf(name), containedByHostStop(name)]).toEqual([name, 'read_only', true]);
    }
  });
});
