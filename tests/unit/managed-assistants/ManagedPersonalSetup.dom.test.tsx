import type { Assistant, AssistantDetail } from '@/common/types/agent/assistantTypes';
import type {
  ManagedAssistantDetail,
  ManagedAssistantPreferencesRequest,
} from '@/common/types/agent/managedAssistantTypes';
import ManagedPersonalSetup from '@/renderer/pages/settings/AssistantSettings/home/ManagedLibrary/ManagedPersonalSetup';
import { ConfigProvider } from '@arco-design/web-react';
import { fireEvent, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import React from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, options?: { defaultValue?: string }) => {
      const labels: Record<string, string> = {
        'settings.managedTeammates.setupTitle': 'Your setup',
        'settings.managedTeammates.setupLead': 'Optional preferences for how this Teammate works with you.',
        'settings.managedTeammates.setUpLater': 'Set up later',
        'settings.managedTeammates.saveSetup': 'Save setup',
        'settings.managedTeammates.resetSetup': 'Reset personal setup',
        'settings.managedTeammates.resetSetupAction': 'Reset',
        'settings.managedTeammates.resetSetupConfirm':
          'Reset your personal setup? VNG-managed settings stay unchanged.',
        'settings.managedTeammates.fieldNickname': 'Nickname',
        'settings.managedTeammates.fieldPreferredLanguage': 'Preferred language',
        'settings.managedTeammates.fieldResponseStyle': 'Response style',
        'settings.managedTeammates.fieldRecurringContext': 'Recurring context',
        'settings.managedTeammates.fieldDefaultWorkspace': 'Default project folder',
        'settings.managedTeammates.fieldPersonalPrompts': 'Personal starter prompts',
        'settings.managedTeammates.fieldOptionalSkills': 'Optional capabilities',
        'settings.managedTeammates.fieldModel': 'Model preference',
        'settings.managedTeammates.preferencesError': 'Could not save your setup',
        'settings.managedTeammates.resetError': 'Could not reset your setup',
      };
      return labels[key] ?? options?.defaultValue ?? key;
    },
  }),
}));

const createAssistant = (): Assistant => ({
  id: 'finance-close',
  source: 'managed',
  name: 'Finance Close Coordinator',
  name_i18n: {},
  description: 'Close support',
  description_i18n: {},
  avatar: '\u{1F4CA}',
  enabled: true,
  sort_order: 1000,
  agent_id: 'aionrs',
  agent: { type: 'aionrs', source: 'builtin' },
  enabled_skills: [],
  custom_skill_names: [],
  disabled_builtin_skills: [],
  context_i18n: {},
  prompts: [],
  prompts_i18n: {},
  models: [],
  agent_status: 'online',
  team_selectable: false,
  deletable: false,
});

const createAssistantDetail = (): AssistantDetail => {
  const assistant = createAssistant();
  return {
    id: assistant.id,
    source: assistant.source,
    agent_status: assistant.agent_status,
    team_selectable: assistant.team_selectable,
    deletable: assistant.deletable,
    profile: {
      name: assistant.name,
      name_i18n: assistant.name_i18n,
      description: assistant.description,
      description_i18n: assistant.description_i18n,
      avatar: assistant.avatar,
    },
    state: { enabled: true, sort_order: 1000 },
    engine: { agent_id: 'aionrs', agent: assistant.agent },
    rules: { content: 'managed', storage_mode: 'managed' },
    prompts: { recommended: [], recommended_i18n: {} },
    defaults: {
      model: { mode: 'auto' },
      permission: { mode: 'auto' },
      thought_level: { mode: 'auto' },
      skills: { mode: 'fixed', value: [] },
      mcps: { mode: 'fixed', value: [] },
    },
    capabilities: {
      default_skill_ids: [],
      custom_skill_names: [],
      default_disabled_builtin_skill_ids: [],
    },
    preferences: { last_skill_ids: [], last_disabled_builtin_skill_ids: [], last_mcp_ids: [] },
  };
};

const createDetail = (overrides: Partial<ManagedAssistantDetail> = {}): ManagedAssistantDetail => ({
  assistant: createAssistantDetail(),
  governance: {
    business_owner: 'Financial Accounting',
    audience: { all_members: false, user_ids: ['member-1'], summary: 'Controllers' },
    lifecycle: 'published',
    published_version: 4,
  },
  adoption: { active: true, adopted_at: 1_788_192_100 },
  update: {
    current_version: 4,
    notice_pending: false,
    acknowledgement_required: false,
    changed_categories: [],
  },
  employee_brief: {
    job_summary: 'Close support',
    job_summary_i18n: {},
    trained_for: [],
    trained_for_i18n: {},
    inputs_required: [],
    inputs_required_i18n: {},
    data_access_summary: 'Uses supplied files',
    data_access_summary_i18n: {},
    boundaries: [],
    boundaries_i18n: {},
    human_review_requirements: [],
    human_review_requirements_i18n: {},
  },
  personalization_policy: {
    allowed_fields: ['nickname', 'model'],
    optional_skill_ids: ['email-tone', 'calendar-reminders'],
    allowed_model_ids: ['managed-default', 'managed-fast'],
  },
  preferences: { nickname: 'Close partner', model: 'managed-default' },
  archived_preference_count: 0,
  ...overrides,
});

type SetupProps = React.ComponentProps<typeof ManagedPersonalSetup>;

const renderSetup = (props: Partial<SetupProps> = {}) => {
  const defaultProps: SetupProps = {
    visible: true,
    detail: createDetail(),
    isSaving: false,
    isResetting: false,
    error: null,
    onClose: vi.fn(),
    onSave: vi.fn(async (_request: ManagedAssistantPreferencesRequest) => undefined),
    onReset: vi.fn(async () => undefined),
  };

  return {
    ...render(
      <ConfigProvider>
        <ManagedPersonalSetup {...defaultProps} {...props} />
      </ConfigProvider>
    ),
    props: { ...defaultProps, ...props },
  };
};

describe('ManagedPersonalSetup', () => {
  beforeEach(() => {
    Object.defineProperty(window, 'matchMedia', {
      writable: true,
      value: vi.fn().mockImplementation((query: string) => ({
        matches: false,
        media: query,
        onchange: null,
        addListener: vi.fn(),
        removeListener: vi.fn(),
        addEventListener: vi.fn(),
        removeEventListener: vi.fn(),
        dispatchEvent: vi.fn(),
      })),
    });
  });

  it('omits skill and model controls until safe option metadata is available', () => {
    renderSetup({
      detail: createDetail({
        personalization_policy: {
          allowed_fields: ['nickname', 'optional_skills', 'model'],
          optional_skill_ids: ['email-tone'],
          allowed_model_ids: ['managed-default'],
        },
      }),
    });

    expect(screen.getByLabelText('Nickname')).toBeInTheDocument();
    expect(screen.queryByText('Optional capabilities')).not.toBeInTheDocument();
    expect(screen.queryByText('Model preference')).not.toBeInTheDocument();
    expect(screen.queryByText('email-tone')).not.toBeInTheDocument();
    expect(screen.queryByText('managed-default')).not.toBeInTheDocument();
    expect(screen.queryByRole('checkbox', { name: 'email-tone' })).not.toBeInTheDocument();
    expect(screen.queryByRole('combobox', { name: 'Model preference' })).not.toBeInTheDocument();
    expect(screen.queryByLabelText('Preferred language')).not.toBeInTheDocument();
    expect(screen.queryByLabelText('Response style')).not.toBeInTheDocument();
    expect(screen.queryByLabelText('Default project folder')).not.toBeInTheDocument();
  });

  it('sends a flat request containing only allowed preference fields', async () => {
    const onSave = vi.fn(async (_request: ManagedAssistantPreferencesRequest) => undefined);
    renderSetup({
      detail: createDetail({
        personalization_policy: {
          allowed_fields: ['nickname', 'personal_prompts'],
          optional_skill_ids: [],
          allowed_model_ids: [],
        },
        preferences: { nickname: '' },
      }),
      onSave,
    });

    await userEvent.type(screen.getByLabelText('Nickname'), 'Close buddy');
    await userEvent.type(
      screen.getByLabelText('Personal starter prompts'),
      'Prepare the close checklist\nDraft the status note'
    );
    await userEvent.click(screen.getByRole('button', { name: 'Save setup' }));

    expect(onSave).toHaveBeenCalledWith({
      nickname: 'Close buddy',
      personal_prompts: ['Prepare the close checklist', 'Draft the status note'],
    });
  });

  it('closes with Set up later without changing adoption or preferences', async () => {
    const onClose = vi.fn();
    const onSave = vi.fn();
    const onReset = vi.fn();
    renderSetup({ onClose, onSave, onReset });

    await userEvent.click(screen.getByRole('button', { name: 'Set up later' }));

    expect(onClose).toHaveBeenCalledTimes(1);
    expect(onSave).not.toHaveBeenCalled();
    expect(onReset).not.toHaveBeenCalled();
  });

  it('closes on Escape without mutating the active adoption', () => {
    const onClose = vi.fn();
    const onSave = vi.fn();
    renderSetup({ onClose, onSave });

    const drawer = document.querySelector('.arco-drawer-wrapper');
    expect(drawer).not.toBeNull();
    fireEvent.keyDown(drawer as HTMLElement, { key: 'Escape', code: 'Escape', keyCode: 27, which: 27 });

    expect(onClose).toHaveBeenCalledTimes(1);
    expect(onSave).not.toHaveBeenCalled();
  });

  it('resets only the personal overlay after confirmation', async () => {
    const onReset = vi.fn(async () => undefined);
    renderSetup({ onReset });

    await userEvent.click(screen.getByRole('button', { name: 'Reset personal setup' }));
    expect(screen.getByText('Reset your personal setup? VNG-managed settings stay unchanged.')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Reset' }));

    expect(onReset).toHaveBeenCalledTimes(1);
  });

  it('shows safe mutation errors and prevents duplicate saves while pending', () => {
    renderSetup({ isSaving: true, error: 'preferences' });

    expect(screen.getByText('Could not save your setup')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Save setup' })).toBeDisabled();
    expect(document.querySelector('[class*="setupDrawer"]')).toBeInTheDocument();
  });

  it('keeps the drawer usable after a reset failure', () => {
    renderSetup({ error: 'reset' });

    expect(screen.getByText('Could not reset your setup')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Reset personal setup' })).toBeEnabled();
    expect(screen.getByRole('button', { name: 'Set up later' })).toBeEnabled();
  });
});
