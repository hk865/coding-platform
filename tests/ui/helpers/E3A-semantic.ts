import { expect } from 'vitest';
import type { FlowPayloadV1, LinkEvidenceV1, NoteDraftAnchorV1, SemanticRelationV1, SymbolLocatorV1 } from '../../../src/contracts/note.js';
import type { S8ESemanticWorld } from '../../helpers/S8E-semantic-world.js';
import type { SemanticEndV1, SemanticFlowStepV1, SemanticFlowV1, SemanticLinkV1, SemanticPageV1 } from '../../../src/contracts/semantic-layer.js';
import { bootPage, findElement, type BootedPage, type PageFetch } from './boot-page.js';
import { forwardPage, newPageLog, quietPage, routeOf, type PageLog } from './E3N-page.js';
import type { S6ARequestWorld } from '../../helpers/S6A-request-fixture.js';
import type { FakeElement } from './dom.js';
import { descendants, hasClass, textOf } from './E3N-page.js';

/**
 * B9 fixed semantic answers and DOM reads (one copy for the two rows that need
 * them). The route answers are the page's input only; every literal is the
 * test's own and is hand-computed from `arch-overview.ts`'s word table.
 */

export type EndSpec = {
  moduleId?: string | null;
  path?: string;
  symbol?: string;
  status?: 'live' | 'retired';
  retired?: SemanticEndV1['anchorRetiredReasons'];
  unresolved?: SemanticEndV1['unresolved'];
};

const locator = (name: string): SymbolLocatorV1 => ({ language: 'typescript', qualifiedName: name,
  signatureDigest: 'd', range: { startLine: 10, endLine: 12 }, fileDigest: 'd' });

export function semEnd(spec: EndSpec): SemanticEndV1 {
  const path = spec.path ?? 'src/ui/boot.ts';
  const anchor = spec.symbol === undefined
    ? { kind: 'file' as const, path }
    : { kind: 'file' as const, path, symbol: locator(spec.symbol) };
  return {
    anchor,
    request: spec.symbol === undefined ? { kind: 'file', path }
      : { kind: 'file', path, symbolRequest: { language: 'typescript', name: spec.symbol } },
    moduleId: spec.moduleId === undefined ? 'src/ui' : spec.moduleId,
    unresolved: spec.unresolved ?? null,
    anchorStatus: spec.status ?? 'live',
    anchorRetiredReasons: spec.retired ?? [],
  };
}

export type LinkSpec = {
  noteId: string;
  version?: number | null;
  relation?: SemanticRelationV1;
  from?: EndSpec;
  to?: EndSpec;
  via?: EndSpec | null;
  key?: SemanticLinkV1['key'];
  evidence?: LinkEvidenceV1[];
  verification?: SemanticLinkV1['verification'];
  currentEligible?: boolean;
  freshness?: SemanticLinkV1['freshness'];
  state?: SemanticLinkV1['state'];
  topic?: string;
  conclusion?: string;
  goalId?: string | null;
};

export function semLink(spec: LinkSpec): SemanticLinkV1 {
  return {
    noteId: spec.noteId,
    version: spec.version === undefined ? 1 : spec.version,
    state: spec.state === undefined ? 'accepted' : spec.state,
    relation: spec.relation ?? 'calls',
    from: semEnd(spec.from ?? {}),
    to: semEnd(spec.to ?? { moduleId: 'src/core/work-graph', path: 'src/core/work-graph/state/task-machine.ts' }),
    via: spec.via === undefined ? null : spec.via === null ? null : semEnd(spec.via),
    key: spec.key ?? { kind: 'literal', text: 'ledger.commit' },
    evidence: spec.evidence ?? [
      { role: 'use', at: { path: 'src/ui/boot.ts', range: { startLine: 10, endLine: 10 } } },
      { role: 'wire', at: { path: 'src/ui/boot.ts', range: { startLine: 11, endLine: 11 } } },
    ],
    verification: spec.verification ?? { status: 'verified' },
    currentEligible: spec.currentEligible ?? true,
    topic: spec.topic ?? spec.noteId,
    conclusion: spec.conclusion ?? '测试写下的结论',
    source: { kind: 'user', principalId: 'p' },
    goalId: spec.goalId === undefined ? null : spec.goalId,
    confirmedByUser: false,
    freshness: spec.freshness ?? 'fresh',
  };
}

export type FlowSpec = {
  noteId: string;
  version?: number | null;
  topic?: string;
  steps: Array<{ link: string; item: SemanticLinkV1 | null; problem?: SemanticFlowStepV1['problem'] }>;
  gapsAfter?: number[];
  currentEligible?: boolean;
  freshness?: SemanticFlowV1['freshness'];
};

export function semFlow(spec: FlowSpec): SemanticFlowV1 {
  return {
    noteId: spec.noteId, version: spec.version === undefined ? 1 : spec.version, state: 'accepted',
    topic: spec.topic ?? spec.noteId, conclusion: '测试流程的结论', source: { kind: 'user', principalId: 'p' },
    goalId: null,
    steps: spec.steps.map((step) => ({ link: step.link, item: step.item, problem: step.problem ?? null })),
    gapsAfter: spec.gapsAfter ?? [], currentEligible: spec.currentEligible ?? true,
    freshness: spec.freshness ?? 'fresh',
  };
}

export const semPage = <T>(items: T[], next: string | null = null): SemanticPageV1<T> =>
  ({ items, next, catalogRevision: 1 });

export const semReady = (value: unknown): { status: 'ready'; value: unknown } => ({ status: 'ready', value });

/* ---------------------------------------------------------------- DOM reads */

export function semPanel(root: FakeElement): FakeElement | undefined {
  return findElement(root, (element) => hasClass(element, 'ov-sem-panel'));
}

export function semPanelText(root: FakeElement): string {
  return textOf(semPanel(root));
}


export function semRows(root: FakeElement): FakeElement[] {
  const panel = semPanel(root);
  return panel === undefined ? [] : descendants(panel).filter((element) =>
    element.tagName.toLowerCase() === 'button' && hasClass(element, 'qrow'));
}

export function semLabelTexts(root: FakeElement): string[] {
  return semLabels(root).map((element) => textOf(element));
}

export function semLines(root: FakeElement): FakeElement[] {
  return descendants(root).filter((element) => (element.tagName.toLowerCase() === 'svg')
    && hasClass(element, 'ov-sem'));
}

export function semLabels(root: FakeElement): FakeElement[] {
  return descendants(root).filter((element) => element.tagName.toLowerCase() === 'button'
    && hasClass(element, 'ov-sem-label'));
}

export function contactCount(root: FakeElement, name: string): string {
  const node = findElement(root, (element) => hasClass(element, 'ov-node')
    && textOf(findElement(element, (kid) => hasClass(kid, 'ov-name'))) === name);
  expect(node).toBeDefined();
  return textOf(findElement(node!, (kid) => hasClass(kid, 'ov-cnt')));
}



/**
 * Boot ArchOverview with fixed semantic answers (the page's input only) and an
 * optional `before` hook per route, so a row can hold, reject or mutate an
 * answer without a second Host.
 */
export async function bootSem(world: S6ARequestWorld, answers: Record<string, unknown>,
  options: { search?: string; name?: 'ArchOverview' | 'Main';
    before?: Record<string, (log: PageLog) => Promise<void>> } = {}):
Promise<{ page: BootedPage; log: PageLog }> {
  const log = newPageLog();
  const forward = forwardPage(world, log);
  const pageRequest: PageFetch = async (url, init, realFetch) => {
    const route = routeOf(String(url));
    if (options.before?.[route] !== undefined) await options.before[route]!(log);
    return await forward(url, init, async (target, targetInit) => {
      const answer = answers[route];
      if (answer === undefined) return await realFetch(target, targetInit);
      return new Response(JSON.stringify(answer), { status: 200, headers: { 'content-type': 'application/json' } });
    });
  };
  const page = await bootPage({
    name: options.name ?? 'ArchOverview',
    ...(options.search === undefined ? {} : { search: options.search }),
    token: () => world.token,
    request: pageRequest,
  });
  /* The first read must land before a switch click, or the click's demand races it
     and the same refresh reads the two routes twice. */
  await quietPage(log);
  return { page, log };
}


/** One real flow write through the public `notes/write` route, 2–20 steps. */
export async function writeFlow(world: S8ESemanticWorld,
  spec: { topic: string; anchor: NoteDraftAnchorV1; extraAnchors?: NoteDraftAnchorV1[] },
  steps: Array<{ noteId: string }>): Promise<{ noteId: string; version: number }> {
  const flow: FlowPayloadV1 = { steps: steps.map((step) => ({ link: step.noteId })) };
  const write = await world.writePerson({
    kind: 'flow', topic: spec.topic, conclusion: '测试写下的流程结论',
    anchor: spec.anchor, extraAnchors: spec.extraAnchors ?? [],
    facts: [], basisFiles: [], structural: false, replaces: [], contradicts: [], coexistWith: [], body: '', flow,
  });
  if (write.status !== 'accepted') throw new Error('the flow write was not accepted: ' + JSON.stringify(write));
  return { noteId: write.noteId, version: write.version };
}
