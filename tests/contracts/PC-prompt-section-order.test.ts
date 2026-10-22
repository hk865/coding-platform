/**
 * PC-1b P — ruling 18: the recorded section order is today's fixed order
 * projected onto the sections the template and the call kind allow. Nothing
 * reads it in PC-1.
 */
import { describe, expect, it } from 'vitest';
import {
  CONTEXT_SECTION_ORDER, queryPreparedSectionOrder, sectionOrderFor, workPreparedSectionOrder,
} from '../../src/core/agent-runtime/context-rendering.js';

describe('ruling 18: the projected section order', () => {
  it('keeps today\'s eight-section order for the two Work call kinds', () => {
    expect(CONTEXT_SECTION_ORDER).toEqual(['role', 'goal', 'task', 'footprint', 'notes', 'reminders', 'inputs', 'continuation']);
    expect(workPreparedSectionOrder()).toEqual({
      work: ['role', 'goal', 'task', 'footprint', 'notes', 'reminders', 'inputs', 'unknown_call_review'],
      continuation: ['role', 'goal', 'task', 'footprint', 'notes', 'reminders', 'inputs', 'continuation'],
    });
  });

  it('projects each Query template onto its call kind', () => {
    expect(queryPreparedSectionOrder()).toEqual({
      planning: ['role', 'goal', 'task', 'footprint'],
      copy: ['role', 'goal', 'task'],
    });
    expect(sectionOrderFor('planning', 'query-copy-input')).toEqual(['role', 'goal', 'task']);
    expect(sectionOrderFor('copy', 'query-planning-input')).toEqual(['role', 'goal', 'task']);
  });
});
