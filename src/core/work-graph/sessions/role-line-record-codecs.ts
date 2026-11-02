/**
 * The role-line RecordStore codecs: the four R1 records (role facts, allocation, limits, project notice), their two
 * change events, and the one registration bundle. The field tables and the record/event rules live in
 * `contracts/role-lines.ts`; this file only adds the Store envelope and is registered by the composition root (W).
 */
import {
  ProjectNoticeCreatedFormat, ProjectNoticeFormat, ProjectRoleLimitsChangedFormat, ProjectRoleLimitsFormat,
  RoleLineAllocationFormat, SessionRoleFactsFormat,
} from '../../../contracts/role-lines.js';
import { createEventCodec, createRecordCodec, formatSchemas } from '../persistence/field-table-codec.js';

export const sessionRoleFactsCodec = createRecordCodec(SessionRoleFactsFormat);
export const roleLineAllocationCodec = createRecordCodec(RoleLineAllocationFormat);
export const projectRoleLimitsCodec = createRecordCodec(ProjectRoleLimitsFormat);
export const projectNoticeCodec = createRecordCodec(ProjectNoticeFormat);
export const projectRoleLimitsChangedCodec = createEventCodec(ProjectRoleLimitsChangedFormat);
export const projectNoticeCreatedCodec = createEventCodec(ProjectNoticeCreatedFormat);

export const ROLE_LINE_RECORD_SCHEMAS = formatSchemas([sessionRoleFactsCodec, roleLineAllocationCodec,
  projectRoleLimitsCodec, projectNoticeCodec, projectRoleLimitsChangedCodec, projectNoticeCreatedCodec]);
