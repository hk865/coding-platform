/**
 * H-brief-render (pure, A5): the handoff brief's Chinese renderer on the
 * frozen executor/adviser material. Expected bytes are written out here; the
 * material digest is a hand-computed canonical-JSON SHA-256, never a value the
 * renderer or the digest function produced.
 */
import { describe, expect, it } from 'vitest';
import type { HandoffBriefMaterialV1 } from '../../src/contracts/handoff-brief.js';
import { handoffBriefDigest } from '../../src/contracts/handoff-brief.js';
import { renderHandoffBriefZh } from '../../src/contracts/continuation-brief-render.js';
import { PLATFORM_PROMPT_PACK_V1 } from '../../src/contracts/prompts/platform-pack.generated.js';
import type { PromptTextsV1 } from '../../src/contracts/prompts/prompt-set.js';
import type { RoleScopeV1 } from '../../src/contracts/role-lines.js';

/** BRIEFQ: the adviser material now carries the operation's handed scope; the type gains the field in production. */
type AdviserMaterialV1 = Extract<HandoffBriefMaterialV1, { duty: 'adviser' }> & { handedScope: RoleScopeV1[] };

const executorMaterial: HandoffBriefMaterialV1 = {
  duty: 'executor',
  tasks: [
    { task: { projectId: 'p1', goalId: 'g1', taskId: 't1' }, phase: 'running', lastResult: 'completed' },
    { task: { projectId: 'p1', goalId: 'g1', taskId: 't2' }, phase: 'pending', lastResult: null },
  ],
  conclusion: {
    run: { aggregateType: 'Run', projectId: 'p1', goalId: 'g1', runId: 'r1' },
    finalMessageId: 'm1',
    body: '第一行\n第二行',
  },
  noteIndex: [{ moduleId: 'm1', notes: [{ noteRef: 'n1', version: 2 }, { noteRef: 'n2', version: 1 }] }],
  understanding: [{ noteId: 'u1', version: 3 }],
  oldLine: { projectId: 'p1', sessionId: 's1' },
};

const adviserMaterial: AdviserMaterialV1 = {
  duty: 'adviser',
  goals: [
    {
      goalRef: { aggregateType: 'Goal', projectId: 'p1', goalId: 'g1' },
      tasks: [{ task: { projectId: 'p1', goalId: 'g1', taskId: 't1' }, phase: 'running', lastResult: 'completed' }],
      noteIndex: [{ moduleId: 'm1', notes: [{ noteRef: 'n1', version: 2 }] }],
      openDecisions: [{ source: 'message', key: 'k1' }],
    },
    {
      goalRef: { aggregateType: 'Goal', projectId: 'p1', goalId: 'g2' },
      tasks: [], noteIndex: [], openDecisions: [],
    },
  ],
  queryAnswers: [{
    run: { aggregateType: 'QueryRun', projectId: 'p1', workspaceId: 'w1', queryJobId: 'q1', runId: 'rq1' },
    body: '答复',
  }],
  understanding: [{ noteId: 'u1', version: 3 }],
  oldLine: { projectId: 'p1', sessionId: 's1' },
  handedScope: [{ kind: 'region', moduleRef: { projectId: 'p1', moduleId: 'src/a' } }],
};

const EXECUTOR_HEADER = '## Handoff brief\n\n'
  + 'You are continuing this line. The work below is now yours. The understanding\n'
  + 'pointer is the version the predecessor recorded before the handoff; read it\n'
  + 'before you answer.\n\n';
const ADVISER_HEADER = '## Handoff brief\n\n'
  + "You are continuing this line's work in this project. The handed scope listed\n"
  + 'below is now yours; the background that follows is what the line knows, not a\n'
  + 'larger scope. The understanding pointer is the version the predecessor recorded\n'
  + 'before the handoff; read it before you answer.\n\n';

const EXECUTOR_BODY = [
  '- task {"goalId":"g1","projectId":"p1","taskId":"t1"}: phase running; last result: completed',
  '- task {"goalId":"g1","projectId":"p1","taskId":"t2"}: phase pending; last result: 无',
  '- conclusion {"aggregateType":"Run","goalId":"g1","projectId":"p1","runId":"r1"}: 第一行\n  第二行',
  '- note index: m1: n1@2、n2@1',
  '- understanding: u1@3',
  '- old line: {"projectId":"p1","sessionId":"s1"}',
  '细节用这些工具按需读',
].join('\n');

const ADVISER_BODY = [
  '- handed scope: {"kind":"region","moduleRef":{"moduleId":"src/a","projectId":"p1"}}',
  '- project background:',
  '- goal {"aggregateType":"Goal","goalId":"g1","projectId":"p1"}',
  '  - task {"goalId":"g1","projectId":"p1","taskId":"t1"}: phase running; last result: completed',
  '  - note index: m1: n1@2',
  '  - open decisions: message:k1',
  '- goal {"aggregateType":"Goal","goalId":"g2","projectId":"p1"}',
  '  - note index: 无',
  '  - open decisions: 无',
  '- query answer {"aggregateType":"QueryRun","projectId":"p1","queryJobId":"q1","runId":"rq1","workspaceId":"w1"}: 答复',
  '- understanding: u1@3',
  '- old line: {"projectId":"p1","sessionId":"s1"}',
  '细节用这些工具按需读',
].join('\n');

const texts: PromptTextsV1 = PLATFORM_PROMPT_PACK_V1;

describe('S7C-H brief render: exact bytes', () => {
  it('renders the executor brief with the executor template', () => {
    expect(renderHandoffBriefZh(executorMaterial, texts)).toBe(`${EXECUTOR_HEADER}${EXECUTOR_BODY}\n`);
  });

  it('renders the adviser brief with the adviser template', () => {
    expect(renderHandoffBriefZh(adviserMaterial, texts)).toBe(`${ADVISER_HEADER}${ADVISER_BODY}\n`);
  });

  it('renders an absent conclusion as the named absence, never an empty conclusion', () => {
    const material: HandoffBriefMaterialV1 = {
      ...executorMaterial,
      conclusion: { absent: 'no_formal_final_answer' },
    };
    const rendered = renderHandoffBriefZh(material, texts);
    expect(rendered).toContain('- conclusion: no formal final answer');
    expect(rendered).not.toContain('- conclusion {');
  });

  it('cuts a long body with the fixed truncation suffix', () => {
    const material: HandoffBriefMaterialV1 = {
      ...executorMaterial,
      conclusion: {
        run: { aggregateType: 'Run', projectId: 'p1', goalId: 'g1', runId: 'r1' },
        finalMessageId: 'm1',
        body: 'x'.repeat(5000),
      },
    };
    const rendered = renderHandoffBriefZh(material, texts);
    expect(rendered).toContain('…（已截断）');
    expect(rendered).not.toContain('x'.repeat(4001));
  });
});

describe('S7C-H brief render: the material digest is independent of rendering', () => {
  it('hashes the canonical material only', () => {
    // sha256 of each canonical material, computed by hand (outside the test).
    expect(handoffBriefDigest(executorMaterial))
      .toBe('6bc5999757d1d5b99f53bd7ed4dba233ed913d7c28541fa630531548db810c93');
    expect(handoffBriefDigest(adviserMaterial))
      .toBe('7950c71ad87055dbb2c163201dbb414a26abfdc1a493a3bc3a9446d9abda23b8');
  });

  it('keeps the digest when a template id or a tool table changes', () => {
    const changed: PromptTextsV1 = {
      ...texts,
      templates: {
        ...texts.templates,
        'handoff-brief-executor': '## Changed\n\n{{#tool:read}}read it{{/tool:read}}\n\n{{task_round}}\n',
      },
    };
    expect(handoffBriefDigest(executorMaterial))
      .toBe('6bc5999757d1d5b99f53bd7ed4dba233ed913d7c28541fa630531548db810c93');
    expect(renderHandoffBriefZh(executorMaterial, changed)).not.toBe(renderHandoffBriefZh(executorMaterial, texts));
    expect(handoffBriefDigest(executorMaterial))
      .toBe('6bc5999757d1d5b99f53bd7ed4dba233ed913d7c28541fa630531548db810c93');
  });
});
