/**
 * K3-34 (R5, spec §5.2): the L3 tool-kind table and the takeover-proof helper.
 *
 * The expected rows are the spec's literal L3 table, written out here by hand
 * (independent source of truth). The spec also asks this row to compare the
 * table with the Runtime's exported name constants; that comparison needs the
 * `agent-runtime` modules, which import `vendor/coding-agent` and cannot be
 * loaded in this sandbox (the same vendor import that makes the scenario tests
 * in DSH-BASELINE section A fail). Group 2/3 can add that comparison where the
 * constants are consumed; see the group report.
 */
import { describe, expect, it } from 'vitest';
import {
  UNKNOWN_CALL_KIND_TABLE, admitsAutoCleanupTakeover, containedByHostStop, kernelToolNameOf, unknownCallKindOf,
} from '../../src/core/work-graph/state/unknown-call-kinds.js';

const READ_ONLY_NAMES = [
  // L3 row 1
  'read', 'check', 'list_files', 'search', 'symbols', 'code_index', 'project_source', 'project_index',
  'python_index', 'cpp_index', 'source_excerpt', 'read_source', 'read_material',
  // L3 row 2
  'read_session_inbox', 'read_session_message', 'read_session_message_body', 'read_user_decision',
  'query_task_graph', 'query_ready_tasks', 'find_related_sessions', 'read_session_card', 'look_graph', 'find_graph',
  // L3 row 3
  'run_readonly_command',
];
const PLATFORM_NAMES = [
  // L3 row 4 (decision 64 removes apply_future_plan; 4C adds record_note)
  'send_session_message', 'ack_session_message', 'respond_session_message', 'send_user_message',
  'record_decision_application', 'propose_future_plan', 'request_command_rerun',
  // L3 row 5
  'record_unknown_call_review', 'propose_safer_method',
];

describe('K3-34 unknown call kinds', () => {
  it('K3-34 maps every L3 table name to its kind and containment', () => {
    for (const name of READ_ONLY_NAMES) {
      expect([name, unknownCallKindOf(name), containedByHostStop(name)]).toEqual([name, 'read_only', true]);
    }
    for (const name of PLATFORM_NAMES) {
      expect([name, unknownCallKindOf(name), containedByHostStop(name)]).toEqual([name, 'platform', true]);
    }
    expect(unknownCallKindOf('edit')).toBe('file_edit');
    expect(containedByHostStop('edit')).toBe(true);
    expect(unknownCallKindOf('shell')).toBe('process');
    expect(containedByHostStop('shell')).toBe(true);
  });

  it('K3-34 lists the L3 rows in order and has no duplicate name', () => {
    const names = UNKNOWN_CALL_KIND_TABLE.map(entry => entry.toolName);
    expect(new Set(names).size).toBe(names.length);
    expect(names.indexOf('read')).toBeLessThan(names.indexOf('read_session_inbox'));
    expect(names.indexOf('read_session_inbox')).toBeLessThan(names.indexOf('send_session_message'));
    expect(names.indexOf('send_session_message')).toBeLessThan(names.indexOf('edit'));
    expect(names.indexOf('edit')).toBeLessThan(names.indexOf('shell'));
  });

  it('K3-34 defaults an out-of-table name to process and refuses RUN-25 containment', () => {
    expect(unknownCallKindOf('some_future_tool')).toBe('process');
    expect(containedByHostStop('some_future_tool')).toBe(false);
    // decision 64 deletes apply_future_plan; until 4C removes the tool it is the
    // row-8 default, never a platform tool that stops with the Host.
    expect(unknownCallKindOf('apply_future_plan')).toBe('process');
    expect(containedByHostStop('apply_future_plan')).toBe(false);
  });

  it('K3-34 maps the authorization name write to the Kernel tool edit', () => {
    expect(kernelToolNameOf('write')).toBe('edit');
    expect(kernelToolNameOf('read')).toBe('read');
    expect(kernelToolNameOf('shell')).toBe('shell');
    for (const authorized of ['read', 'write', 'shell']) {
      const kernelName = kernelToolNameOf(authorized);
      expect([kernelName, containedByHostStop(kernelName)]).toEqual([kernelName, true]);
      expect(UNKNOWN_CALL_KIND_TABLE.some(entry => entry.toolName === kernelName)).toBe(true);
    }
  });

  it('K3-34 admits only the two proof kinds that show the previous Host is gone', () => {
    expect(admitsAutoCleanupTakeover({ kind: 'hl01_no_lock' })).toBe(true);
    expect(admitsAutoCleanupTakeover({ kind: 'hl03_stale_lock', previousInstanceId: 'old', previousPid: 12 })).toBe(true);
    expect(admitsAutoCleanupTakeover({ kind: 'memory_store' })).toBe(false);
    expect(admitsAutoCleanupTakeover(null)).toBe(false);
    expect(admitsAutoCleanupTakeover(undefined)).toBe(false);
  });
});
