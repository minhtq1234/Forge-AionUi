import type { Assistant, AssistantDetail, CreateAssistantRequest } from './assistantTypes';

export type ManagedAssistantLifecycle = 'draft' | 'published' | 'retired';
export type ManagedPersonalizationField =
  | 'nickname'
  | 'preferred_language'
  | 'response_style'
  | 'recurring_context'
  | 'default_workspace'
  | 'personal_prompts'
  | 'optional_skills'
  | 'model';
export type ManagedAssistantChangeImpact = 'routine' | 'high_impact';
export type ManagedAssistantChangeCategory =
  | 'agent'
  | 'permission'
  | 'required_skills'
  | 'mcps'
  | 'data_access'
  | 'personalization_policy'
  | 'content';

export type ManagedAssistantAudience = {
  all_members: boolean;
  user_ids: string[];
  summary: string;
};
export type ManagedAssistantPersonalizationPolicy = {
  allowed_fields: ManagedPersonalizationField[];
  optional_skill_ids: string[];
  allowed_model_ids: string[];
};
export type ManagedAssistantUserPreferences = {
  nickname?: string;
  preferred_language?: string;
  response_style?: string;
  recurring_context?: string;
  default_workspace?: string;
  personal_prompts?: string[];
  optional_skill_ids?: string[];
  model?: string;
};
export type ManagedAssistantGovernanceRequest = {
  business_owner: string;
  audience: ManagedAssistantAudience;
};
export type ManagedAssistantGovernance = ManagedAssistantGovernanceRequest & {
  lifecycle: ManagedAssistantLifecycle;
  published_version?: number;
  acknowledgement_required_version?: number;
  release_notes?: string;
  published_at?: number;
  retirement_reason?: string;
  retirement_cutoff_at?: number;
  replacement_assistant_id?: string;
};
export type ManagedAssistantEmployeeBrief = {
  job_summary: string;
  job_summary_i18n: Record<string, string>;
  trained_for: string[];
  trained_for_i18n: Record<string, string[]>;
  inputs_required: string[];
  inputs_required_i18n: Record<string, string[]>;
  data_access_summary: string;
  data_access_summary_i18n: Record<string, string>;
  boundaries: string[];
  boundaries_i18n: Record<string, string[]>;
  human_review_requirements: string[];
  human_review_requirements_i18n: Record<string, string[]>;
};
export type ManagedAssistantAdoptionState = { active: boolean; adopted_at?: number };
export type ManagedAssistantUpdateState = {
  current_version?: number;
  last_seen_version?: number;
  acknowledged_version?: number;
  notice_pending: boolean;
  acknowledgement_required: boolean;
  change_impact?: ManagedAssistantChangeImpact;
  changed_categories: ManagedAssistantChangeCategory[];
};
export type ManagedAssistantSummary = {
  assistant: Assistant;
  governance: ManagedAssistantGovernance;
  adoption: ManagedAssistantAdoptionState;
  update: ManagedAssistantUpdateState;
};
export type ManagedAssistantDetail = {
  assistant: AssistantDetail;
  governance: ManagedAssistantGovernance;
  adoption: ManagedAssistantAdoptionState;
  update: ManagedAssistantUpdateState;
  employee_brief: ManagedAssistantEmployeeBrief;
  personalization_policy: ManagedAssistantPersonalizationPolicy;
  preferences: ManagedAssistantUserPreferences;
  archived_preference_count: number;
};
export type ManagedAssistantDraftRequest = CreateAssistantRequest & {
  rules_content: string;
  governance: ManagedAssistantGovernanceRequest;
  employee_brief: ManagedAssistantEmployeeBrief;
  personalization_policy: ManagedAssistantPersonalizationPolicy;
};
export type ManagedAssistantAdminSummary = {
  assistant: Assistant;
  governance: ManagedAssistantGovernance;
  draft_version?: number;
};
export type ManagedAssistantAdminDetail = {
  managed: ManagedAssistantDetail;
  draft?: ManagedAssistantDraftRequest;
  draft_version?: number;
};
export type ManagedAssistantAdoptionRequest = { active: boolean };
export type ManagedAssistantPreferencesRequest = ManagedAssistantUserPreferences;
export type ManagedAssistantAcknowledgementRequest = { version: number };
export type ManagedAssistantNoticeSeenRequest = { version: number };
export type ManagedAssistantPublishRequest = { release_notes: string; draft_version: number };
export type ManagedAssistantRetireRequest = {
  reason: string;
  cutoff_at?: number;
  replacement_assistant_id?: string;
};
