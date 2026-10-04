/// <reference lib="dom" />
/** Project-settings actions: one explicit request per setup form, and reading a listed path. */

import { submit } from '../../api/submit.js';
import { renderScopeIfSelected } from '../../state/workbench.js';
import { loadPlanCandidate } from '../execution/planning.js';
import { requireBody } from '../sessions/requests.js';
import {
  adoptArchitectureDraft,
  buildAdoptRequest,
  buildApplyRequest,
  buildArchitectureReadRequest,
  buildFileRequest,
  buildGoalReadRequest,
  buildGoalRequest,
  buildObservedCaptureRequest,
  buildObservedQueryRequest,
  buildPolicyActivateRequest,
  buildPolicyInstallRequest,
  buildProjectRequest,
  buildProposalReadRequest,
  buildProposeRequest,
  buildSourceCaptureRequest,
  buildSourceQueryRequest,
  buildTasksQueryRequest,
  buildWorkspaceRequest,
} from './requests.js';
import type { ActionTable } from '../shell/actions.js';

export const setupActions = {
  'create-project': async scope => { const body = buildProjectRequest(); if (requireBody(scope, body)) await submit(scope, 'projects/create', body); return; },
  'register-workspace': async scope => { const body = buildWorkspaceRequest(); if (requireBody(scope, body)) await submit(scope, 'workspaces/register', body); return; },
  'install-policy': async scope => { const body = buildPolicyInstallRequest(); if (requireBody(scope, body)) await submit(scope, 'completion-policies/install', body); return; },
  'activate-policy': async scope => { const body = buildPolicyActivateRequest(); if (requireBody(scope, body)) await submit(scope, 'completion-policies/activate', body); return; },
  'create-goal': async scope => { const body = buildGoalRequest(); if (requireBody(scope, body)) await submit(scope, 'goals/create', body); return; },
  'adopt-architecture': async scope => { const body = buildAdoptRequest(); if (requireBody(scope, body)) await submit(scope, 'architecture/adopt-initial', body); return; },
  'adopt-architecture-draft': async scope => { await adoptArchitectureDraft(scope); return; },
  'propose-plan': async scope => { const body = buildProposeRequest(); if (requireBody(scope, body)) await submit(scope, 'plans/propose', body); return; },
  'apply-plan': async scope => { const body = buildApplyRequest(); if (requireBody(scope, body)) await submit(scope, 'plans/apply', body); return; },
  'read-goal': async scope => { const body = buildGoalReadRequest(); if (requireBody(scope, body)) { await submit(scope, 'goals/read', body); await loadPlanCandidate(scope); renderScopeIfSelected(scope); } return; },
  'read-proposal': async scope => { const body = buildProposalReadRequest(); if (requireBody(scope, body)) await submit(scope, 'plans/proposal', body); return; },
  'read-architecture': async scope => { const body = buildArchitectureReadRequest(); if (requireBody(scope, body)) await submit(scope, 'architecture/read', body); return; },
  'capture-observed': async scope => { const body = buildObservedCaptureRequest(); if (requireBody(scope, body)) await submit(scope, 'architecture/capture', body); return; },
  'query-observed': async scope => { const body = buildObservedQueryRequest(); if (requireBody(scope, body)) await submit(scope, 'architecture/query', body); return; },
  'query-tasks': async scope => { const body = buildTasksQueryRequest(); if (requireBody(scope, body)) await submit(scope, 'tasks/query', body); return; },
  'capture-source': async scope => { const body = buildSourceCaptureRequest(); if (requireBody(scope, body)) await submit(scope, 'source/capture', body); return; },
  'query-paths': async scope => { const body = buildSourceQueryRequest(false); if (requireBody(scope, body)) await submit(scope, 'source/query', body); return; },
  'query-next': async scope => { const body = buildSourceQueryRequest(true); if (requireBody(scope, body)) await submit(scope, 'source/query', body); return; },
  'read-file': async scope => { const body = buildFileRequest(); if (requireBody(scope, body)) await submit(scope, 'files/read', body); return; },
  'read-path': async (scope, element) => {
    const path = element.dataset.path ?? '';
    const body = buildFileRequest(path);
    if (requireBody(scope, body)) { scope.forms.filePath = path; await submit(scope, 'files/read', body); }
    return;
  },
} satisfies ActionTable;
