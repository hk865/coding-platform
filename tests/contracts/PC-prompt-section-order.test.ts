/**
 * PC-1b P — ruling 18: the recorded section order is the prompt template's slot
 * order projected onto the sections the call kind allows. PC-2 ruling 9 moved
 * the platform `work-input` order (inputs before continuation, reminders last).
 */
import { describe, expect, it } from 'vitest';
import {
  CONTEXT_SECTION_ORDER, queryPreparedSectionOrder, sectionOrderFor, workPreparedSectionOrder,
} from '../../src/core/agent-runtime/context-rendering.js';

describe('ruling 18: the projected section order', () => {
  it('keeps the platform v2 order for the two Work call kinds', () => {
    expect(CONTEXT_SECTION_ORDER).toEqual(
      ['role', 'goal', 'task', 'footprint', 'notes', 'inputs', 'continuation', 'unknown_call_review', 'reminders']);
    expect(workPreparedSectionOrder()).toEqual({
      work: ['role', 'goal', 'task', 'footprint', 'notes', 'inputs', 'unknown_call_review', 'reminders'],
      continuation: ['role', 'goal', 'task', 'footprint', 'notes', 'inputs', 'continuation', 'reminders'],
    });
  });

  it('projects each Query template onto its call kind', () => {
    expect(queryPreparedSectionOrder()).toEqual({
      planning: ['role', 'goal', 'task', 'footprint'],
      copy: ['role', 'goal', 'task'],
      secretary: ['role', 'goal', 'notes', 'task'],
    });
    expect(sectionOrderFor('planning', 'query-copy-input')).toEqual(['role', 'goal', 'task']);
    expect(sectionOrderFor('copy', 'query-planning-input')).toEqual(['role', 'goal', 'task']);
    expect(sectionOrderFor('secretary', 'query-copy-input')).toEqual(['role', 'goal', 'task']);
  });
});
