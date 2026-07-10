import type { Assistant, AssistantDetail } from '@/common/types/agent/assistantTypes';
import type { ManagedAssistantDetail, ManagedAssistantSummary } from '@/common/types/agent/managedAssistantTypes';
import AssistantHomeTabs from '@/renderer/pages/settings/AssistantSettings/home/AssistantHomeTabs';
import ManagedLibrary from '@/renderer/pages/settings/AssistantSettings/home/ManagedLibrary';
import MyAssistantRow from '@/renderer/pages/settings/AssistantSettings/home/MyAssistantRow';
import { ConfigProvider } from '@arco-design/web-react';
import { DndContext } from '@dnd-kit/core';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import React from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const listManagedAssistants = vi.fn();
const getManagedAssistant = vi.fn();
const setManagedAdoption = vi.fn();
const updateManagedPreferences = vi.fn();
const resetManagedPreferences = vi.fn();

const deferred = <T,>() => {
  let resolve: (value: T) => void;
  const promise = new Promise<T>((promiseResolve) => {
    resolve = promiseResolve;
  });
  return { promise, resolve };
};

vi.mock('@/common', () => ({
  ipcBridge: {
    managedAssistants: {
      list: { invoke: (...args: unknown[]) => listManagedAssistants(...args) },
      get: { invoke: (...args: unknown[]) => getManagedAssistant(...args) },
      setAdoption: { invoke: (...args: unknown[]) => setManagedAdoption(...args) },
      updatePreferences: { invoke: (...args: unknown[]) => updateManagedPreferences(...args) },
      resetPreferences: { invoke: (...args: unknown[]) => resetManagedPreferences(...args) },
    },
  },
}));

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    i18n: { language: 'en-US' },
    t: (key: string, options?: { defaultValue?: string; version?: number }) => {
      const labels: Record<string, string> = {
        'settings.managedTeammates.pageTitle': 'Teammates',
        'settings.managedTeammates.pageLead': 'Choose a Teammate for work that VNG has trained and manages.',
        'settings.managedTeammates.tabMine': 'My Teammates',
        'settings.managedTeammates.tabLibrary': 'VNG Library',
        'settings.managedTeammates.tabOfficial': 'Official',
        'settings.managedTeammates.officialExplanation':
          'Official Teammates are bundled with Forge. VNG Library Teammates are managed by your organization.',
        'settings.managedTeammates.libraryTitle': 'VNG Library',
        'settings.managedTeammates.libraryLead': 'Virtual workers, trained and managed by VNG.',
        'settings.managedTeammates.searchPlaceholder': 'Search Teammates',
        'settings.managedTeammates.filterAll': 'All functions',
        'settings.managedTeammates.filterLabel': 'Business function',
        'settings.managedTeammates.sourceManaged': 'Managed by VNG',
        'settings.managedTeammates.owner': 'Business owner',
        'settings.managedTeammates.viewDetails': 'View details',
        'settings.managedTeammates.backToLibrary': 'Back to VNG Library',
        'settings.managedTeammates.whatItDoes': 'What this Teammate does',
        'settings.managedTeammates.trainedFor': 'Trained for',
        'settings.managedTeammates.skillsAndAccess': 'Skills and access',
        'settings.managedTeammates.whatYouProvide': 'What you provide',
        'settings.managedTeammates.boundaries': 'Boundaries',
        'settings.managedTeammates.humanReview': 'Human review',
        'settings.managedTeammates.ownershipTitle': 'Ownership',
        'settings.managedTeammates.vngManages': 'VNG manages',
        'settings.managedTeammates.youCanPersonalize': 'You can personalize',
        'settings.managedTeammates.add': 'Add to My Teammates',
        'settings.managedTeammates.startWorking': 'Start working',
        'settings.managedTeammates.libraryEmptyTitle': 'No Teammates are available to you',
        'settings.managedTeammates.libraryEmptyBody': 'VNG has not published a Teammate for your current audience.',
        'settings.managedTeammates.noResultsTitle': 'No Teammates match these filters',
        'settings.managedTeammates.loadErrorTitle': 'VNG Library could not be loaded',
        'settings.managedTeammates.detailErrorTitle': 'Teammate details could not be loaded',
        'settings.managedTeammates.adoptionError': 'Could not add this Teammate',
        'settings.managedTeammates.refreshError':
          'The Teammate was added, but My Teammates could not be refreshed. Try again before starting work.',
        'settings.managedTeammates.setupTitle': 'Your setup',
        'settings.managedTeammates.setupLead': 'Optional preferences for how this Teammate works with you.',
        'settings.managedTeammates.setupManagedSummary':
          'VNG manages the job, skills, training, and safety. You are only setting your preferences.',
        'settings.managedTeammates.setUpLater': 'Set up later',
        'settings.managedTeammates.saveSetup': 'Save setup',
        'settings.managedTeammates.resetSetup': 'Reset personal setup',
        'settings.managedTeammates.resetSetupAction': 'Reset',
        'settings.managedTeammates.resetSetupConfirm':
          'Reset your personal setup? VNG-managed settings stay unchanged.',
        'settings.managedTeammates.setupSaved': 'Personal setup saved',
        'settings.managedTeammates.setupReset': 'Personal setup reset',
        'settings.managedTeammates.fieldNickname': 'Nickname',
        'settings.managedTeammates.unauthorizedTitle': 'You do not have access to VNG Library',
        'settings.managedTeammates.unauthorizedBody': 'Sign in with an authorized VNG account and try again.',
        'settings.managedTeammates.loadingLibrary': 'Loading VNG Library',
        'settings.managedTeammates.loadingDetails': 'Loading Teammate details',
        'common.retry': 'Retry',
      };
      if (key === 'settings.managedTeammates.version') return `Version ${options?.version ?? ''}`;
      return labels[key] ?? options?.defaultValue ?? key;
    },
  }),
}));

vi.mock('@/renderer/hooks/context/LayoutContext', () => ({
  useLayoutContext: () => ({ isMobile: false }),
}));

vi.mock('@/renderer/components/base/TalkToButlerButton', () => ({
  default: () => null,
}));

vi.mock('@/renderer/hooks/assistant/useTalkToButler', () => ({
  useTalkToButler: () => vi.fn(),
}));

const createAssistant = (overrides: Partial<Assistant> = {}): Assistant => ({
  id: 'finance-close',
  source: 'managed',
  name: 'Finance Close Coordinator',
  name_i18n: { 'en-US': 'Finance Close Coordinator' },
  description: 'Organizes close checks, evidence requests, and status follow-ups.',
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
  ...overrides,
});

const createAssistantDetail = (assistant: Assistant): AssistantDetail => ({
  id: assistant.id,
  source: assistant.source,
  agent_status: assistant.agent_status,
  agent_status_message: assistant.agent_status_message,
  team_selectable: assistant.team_selectable,
  team_block_reason: assistant.team_block_reason,
  deletable: assistant.deletable,
  profile: {
    name: assistant.name,
    name_i18n: assistant.name_i18n,
    description: assistant.description,
    description_i18n: assistant.description_i18n,
    avatar: assistant.avatar,
  },
  state: { enabled: assistant.enabled, sort_order: assistant.sort_order },
  engine: { agent_id: assistant.agent_id, agent: assistant.agent },
  rules: { content: 'SECRET SYSTEM INSTRUCTIONS', storage_mode: 'managed' },
  prompts: { recommended: [], recommended_i18n: {} },
  defaults: {
    model: { mode: 'fixed', value: 'secret-model' },
    permission: { mode: 'fixed', value: 'managed' },
    thought_level: { mode: 'auto' },
    skills: { mode: 'fixed', value: ['secret-skill-id'] },
    mcps: { mode: 'fixed', value: ['secret-connector-id'] },
  },
  capabilities: {
    default_skill_ids: ['secret-skill-id'],
    custom_skill_names: [],
    default_disabled_builtin_skill_ids: [],
  },
  preferences: {
    last_skill_ids: [],
    last_disabled_builtin_skill_ids: [],
    last_mcp_ids: [],
  },
});

const createSummary = (overrides: Partial<ManagedAssistantSummary> = {}): ManagedAssistantSummary => ({
  assistant: createAssistant(),
  governance: {
    business_owner: 'Financial Accounting',
    audience: { all_members: false, user_ids: ['member-1'], summary: 'Controllers' },
    lifecycle: 'published',
    published_version: 4,
    published_at: 1_788_192_000,
  },
  adoption: { active: false },
  update: {
    current_version: 4,
    notice_pending: false,
    acknowledgement_required: false,
    changed_categories: [],
  },
  ...overrides,
});

const createDetail = (overrides: Partial<ManagedAssistantDetail> = {}): ManagedAssistantDetail => {
  const summary = createSummary();
  return {
    assistant: createAssistantDetail(summary.assistant),
    governance: summary.governance,
    adoption: summary.adoption,
    update: summary.update,
    employee_brief: {
      job_summary: 'Keeps the monthly close on track without posting or approving entries.',
      job_summary_i18n: {},
      trained_for: ['Building the close checklist', 'Drafting evidence requests'],
      trained_for_i18n: {},
      inputs_required: ['Close checklist', 'GL summary export'],
      inputs_required_i18n: {},
      data_access_summary: 'Reads only the files and summaries you provide.',
      data_access_summary_i18n: {},
      boundaries: ['Does not invent balances, postings, or approvals.'],
      boundaries_i18n: {},
      human_review_requirements: ['The controller provides final sign-off.'],
      human_review_requirements_i18n: {},
    },
    personalization_policy: { allowed_fields: [], optional_skill_ids: [], allowed_model_ids: [] },
    preferences: {},
    archived_preference_count: 0,
    ...overrides,
  };
};

const renderLibrary = (props: Partial<React.ComponentProps<typeof ManagedLibrary>> = {}) =>
  render(
    <ConfigProvider>
      <ManagedLibrary localeKey='en-US' onAdoptionChanged={vi.fn()} onStartChat={vi.fn()} {...props} />
    </ConfigProvider>
  );

describe('ManagedLibrary', () => {
  beforeEach(() => {
    vi.clearAllMocks();
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
    listManagedAssistants.mockResolvedValue([createSummary()]);
    getManagedAssistant.mockResolvedValue(createDetail());
    setManagedAdoption.mockResolvedValue(createDetail({ adoption: { active: true, adopted_at: 1_788_192_100 } }));
    updateManagedPreferences.mockResolvedValue(createDetail());
    resetManagedPreferences.mockResolvedValue(createDetail());
  });

  it('loads the audience-approved catalog only from the managed assistant bridge', async () => {
    const listRequest = deferred<ManagedAssistantSummary[]>();
    listManagedAssistants.mockReturnValue(listRequest.promise);

    renderLibrary();

    expect(screen.getByText('Loading VNG Library')).toBeInTheDocument();
    listRequest.resolve([createSummary()]);

    expect(await screen.findByText('Finance Close Coordinator')).toBeInTheDocument();
    expect(screen.getAllByText('Financial Accounting').length).toBeGreaterThan(0);
    expect(screen.queryByText('Monthly Deck Teammate')).not.toBeInTheDocument();
    expect(listManagedAssistants).toHaveBeenCalledTimes(1);
  });

  it('separates an empty audience catalog from a local no-results state', async () => {
    const { rerender } = renderLibrary();
    await screen.findByText('Finance Close Coordinator');

    await userEvent.type(screen.getByPlaceholderText('Search Teammates'), 'legal');
    expect(screen.getByText('No Teammates match these filters')).toBeInTheDocument();
    expect(listManagedAssistants).toHaveBeenCalledTimes(1);

    listManagedAssistants.mockResolvedValue([]);
    rerender(
      <ConfigProvider>
        <ManagedLibrary key='empty' localeKey='en-US' onAdoptionChanged={vi.fn()} onStartChat={vi.fn()} />
      </ConfigProvider>
    );

    expect(await screen.findByText('No Teammates are available to you')).toBeInTheDocument();
    expect(screen.getByText('VNG has not published a Teammate for your current audience.')).toBeInTheDocument();
  });

  it('filters returned summaries by business function without refetching', async () => {
    listManagedAssistants.mockResolvedValue([
      createSummary(),
      createSummary({
        assistant: createAssistant({
          id: 'contract-review',
          name: 'Contract Review Teammate',
          name_i18n: { 'en-US': 'Contract Review Teammate' },
        }),
        governance: {
          ...createSummary().governance,
          business_owner: 'Legal Ops',
        },
      }),
    ]);

    renderLibrary();
    await screen.findByText('Finance Close Coordinator');
    await userEvent.click(screen.getByRole('combobox', { name: 'Business function' }));
    fireEvent.click(await screen.findByRole('option', { name: 'Legal Ops' }));

    expect(screen.getByText('Contract Review Teammate')).toBeInTheDocument();
    expect(screen.queryByText('Finance Close Coordinator')).not.toBeInTheDocument();
    expect(listManagedAssistants).toHaveBeenCalledTimes(1);
  });

  it('shows a dedicated unauthorized state and retries the list request', async () => {
    listManagedAssistants
      .mockRejectedValueOnce({ name: 'BackendHttpError', status: 403, code: 'FORBIDDEN' })
      .mockResolvedValueOnce([createSummary()]);

    renderLibrary();

    expect(await screen.findByText('You do not have access to VNG Library')).toBeInTheDocument();
    expect(screen.queryByText('FORBIDDEN')).not.toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Retry' }));

    expect(await screen.findByText('Finance Close Coordinator')).toBeInTheDocument();
    expect(listManagedAssistants).toHaveBeenCalledTimes(2);
  });

  it('opens a dedicated detail with employee-safe content and no managed internals', async () => {
    renderLibrary();
    await userEvent.click(await screen.findByRole('button', { name: /Finance Close Coordinator/i }));

    expect(getManagedAssistant).toHaveBeenCalledWith({ id: 'finance-close', locale: 'en-US' });
    expect(await screen.findByText('What this Teammate does')).toBeInTheDocument();
    expect(
      screen.getByText('Keeps the monthly close on track without posting or approving entries.')
    ).toBeInTheDocument();
    expect(screen.getByText('The controller provides final sign-off.')).toBeInTheDocument();
    expect(screen.queryByText('SECRET SYSTEM INSTRUCTIONS')).not.toBeInTheDocument();
    expect(screen.queryByText('secret-model')).not.toBeInTheDocument();
    expect(screen.queryByText('secret-connector-id')).not.toBeInTheDocument();
  });

  it('retries a failed detail request without exposing backend error text', async () => {
    getManagedAssistant
      .mockRejectedValueOnce(new Error('private detail failure'))
      .mockResolvedValueOnce(createDetail());

    renderLibrary({ initialDetailId: 'finance-close' });

    expect(await screen.findByText('Teammate details could not be loaded')).toBeInTheDocument();
    expect(screen.queryByText('private detail failure')).not.toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Retry' }));

    expect(await screen.findByText('What this Teammate does')).toBeInTheDocument();
    expect(getManagedAssistant).toHaveBeenCalledTimes(2);
  });

  it('awaits the generic assistant refresh before exposing Start working after adoption', async () => {
    const refreshRequest = deferred<void>();
    const onAdoptionChanged = vi.fn(() => refreshRequest.promise);

    renderLibrary({ onAdoptionChanged });
    await userEvent.click(await screen.findByRole('button', { name: /Finance Close Coordinator/i }));
    await userEvent.click(await screen.findByRole('button', { name: 'Add to My Teammates' }));

    expect(setManagedAdoption).toHaveBeenCalledWith({ id: 'finance-close', locale: 'en-US', active: true });
    expect(onAdoptionChanged).toHaveBeenCalledTimes(1);
    expect(screen.queryByRole('button', { name: 'Start working' })).not.toBeInTheDocument();

    refreshRequest.resolve();
    expect(await screen.findByRole('button', { name: 'Start working' })).toBeInTheDocument();
  });

  it('uses the already-active managed detail without repeating adoption', async () => {
    getManagedAssistant.mockResolvedValue(createDetail({ adoption: { active: true, adopted_at: 1_788_192_100 } }));

    renderLibrary({ initialDetailId: 'finance-close' });

    expect(await screen.findByRole('button', { name: 'Start working' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Add to My Teammates' })).not.toBeInTheDocument();
    expect(setManagedAdoption).not.toHaveBeenCalled();
  });

  it('retains successful adoption and retries only the generic refresh when refresh fails', async () => {
    const onAdoptionChanged = vi
      .fn()
      .mockRejectedValueOnce(new Error('refresh failed'))
      .mockResolvedValueOnce(undefined);

    renderLibrary({ onAdoptionChanged });
    await userEvent.click(await screen.findByRole('button', { name: /Finance Close Coordinator/i }));
    await userEvent.click(await screen.findByRole('button', { name: 'Add to My Teammates' }));

    expect(
      await screen.findByText(
        'The Teammate was added, but My Teammates could not be refreshed. Try again before starting work.'
      )
    ).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Retry' }));

    expect(await screen.findByRole('button', { name: 'Start working' })).toBeInTheDocument();
    expect(setManagedAdoption).toHaveBeenCalledTimes(1);
    expect(onAdoptionChanged).toHaveBeenCalledTimes(2);
  });

  it('keeps adoption retryable when the adoption request fails', async () => {
    setManagedAdoption.mockRejectedValue(new Error('private backend failure'));

    renderLibrary();
    await userEvent.click(await screen.findByRole('button', { name: /Finance Close Coordinator/i }));
    await userEvent.click(await screen.findByRole('button', { name: 'Add to My Teammates' }));

    expect(await screen.findByText('Could not add this Teammate')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Add to My Teammates' })).toBeEnabled();
    expect(screen.queryByText('private backend failure')).not.toBeInTheDocument();
  });

  it('saves allowed setup fields through the managed preferences bridge', async () => {
    const adoptedDetail = createDetail({
      adoption: { active: true, adopted_at: 1_788_192_100 },
      personalization_policy: {
        allowed_fields: ['nickname'],
        optional_skill_ids: [],
        allowed_model_ids: [],
      },
    });
    setManagedAdoption.mockResolvedValue(adoptedDetail);
    updateManagedPreferences.mockResolvedValue({
      ...adoptedDetail,
      preferences: { nickname: 'Close buddy' },
    });

    renderLibrary({ onAdoptionChanged: vi.fn().mockResolvedValue(undefined) });
    await userEvent.click(await screen.findByRole('button', { name: /Finance Close Coordinator/i }));
    await userEvent.click(await screen.findByRole('button', { name: 'Add to My Teammates' }));
    await userEvent.type(await screen.findByLabelText('Nickname'), 'Close buddy');
    await userEvent.click(screen.getByRole('button', { name: 'Save setup' }));

    expect(updateManagedPreferences).toHaveBeenCalledWith({
      id: 'finance-close',
      locale: 'en-US',
      nickname: 'Close buddy',
    });
  });

  it('resets the personal overlay through the managed preferences bridge', async () => {
    const adoptedDetail = createDetail({
      adoption: { active: true, adopted_at: 1_788_192_100 },
      personalization_policy: {
        allowed_fields: ['nickname'],
        optional_skill_ids: [],
        allowed_model_ids: [],
      },
      preferences: { nickname: 'Close buddy' },
    });
    setManagedAdoption.mockResolvedValue(adoptedDetail);
    resetManagedPreferences.mockResolvedValue({ ...adoptedDetail, preferences: {} });

    renderLibrary({ onAdoptionChanged: vi.fn().mockResolvedValue(undefined) });
    await userEvent.click(await screen.findByRole('button', { name: /Finance Close Coordinator/i }));
    await userEvent.click(await screen.findByRole('button', { name: 'Add to My Teammates' }));
    await userEvent.click(await screen.findByRole('button', { name: 'Reset personal setup' }));
    fireEvent.click(screen.getByRole('button', { name: 'Reset' }));

    await waitFor(() => expect(resetManagedPreferences).toHaveBeenCalledWith({ id: 'finance-close', locale: 'en-US' }));
  });
});

describe('managed assistant entry points', () => {
  it('renders three Arco tabs and explains Official ownership', async () => {
    render(
      <ConfigProvider>
        <AssistantHomeTabs
          assistants={[]}
          localeKey='en-US'
          onOpenDetail={vi.fn()}
          onOpenManagedDetail={vi.fn()}
          onOpenSettings={vi.fn()}
          onDuplicate={vi.fn()}
          onDelete={vi.fn()}
          onCreate={vi.fn()}
          onToggleEnabled={vi.fn()}
          onReorder={vi.fn()}
          onStartChat={vi.fn()}
          onAdoptionChanged={vi.fn()}
        />
      </ConfigProvider>
    );

    expect(screen.getByRole('tab', { name: 'My Teammates' })).toBeInTheDocument();
    expect(screen.getByRole('tab', { name: 'VNG Library' })).toBeInTheDocument();
    await userEvent.click(screen.getByRole('tab', { name: 'Official' }));
    expect(
      screen.getByText(
        'Official Teammates are bundled with Forge. VNG Library Teammates are managed by your organization.'
      )
    ).toBeInTheDocument();
    expect(document.querySelectorAll('[role="tab"]')).toHaveLength(3);
  });

  it('opens the managed library when the parent selects it after mount', async () => {
    listManagedAssistants.mockResolvedValue([]);
    const props = {
      assistants: [],
      localeKey: 'en-US',
      onOpenDetail: vi.fn(),
      onOpenManagedDetail: vi.fn(),
      onOpenSettings: vi.fn(),
      onDuplicate: vi.fn(),
      onDelete: vi.fn(),
      onCreate: vi.fn(),
      onToggleEnabled: vi.fn(),
      onReorder: vi.fn(),
      onStartChat: vi.fn(),
      onAdoptionChanged: vi.fn(),
    };
    const { rerender } = render(
      <ConfigProvider>
        <AssistantHomeTabs {...props} initialTab='mine' />
      </ConfigProvider>
    );

    rerender(
      <ConfigProvider>
        <AssistantHomeTabs {...props} initialTab='library' />
      </ConfigProvider>
    );

    expect(await screen.findByText('Virtual workers, trained and managed by VNG.')).toBeInTheDocument();
  });

  it('renders a managed row without generic edit, toggle, reorder, duplicate, or delete controls', async () => {
    const onOpenManagedDetail = vi.fn();
    const onOpenDetail = vi.fn();
    const onStartChat = vi.fn();
    const assistant = createAssistant();

    render(
      <ConfigProvider>
        <DndContext>
          <MyAssistantRow
            assistant={assistant}
            localeKey='en-US'
            draggable={false}
            onOpenDetail={onOpenDetail}
            onOpenManagedDetail={onOpenManagedDetail}
            onDelete={vi.fn()}
            onToggleEnabled={vi.fn()}
            onStartChat={onStartChat}
          />
        </DndContext>
      </ConfigProvider>
    );

    expect(screen.getByText('Managed by VNG')).toBeInTheDocument();
    expect(screen.queryByTestId('assistant-reorder-handle-finance-close')).not.toBeInTheDocument();
    expect(screen.queryByTestId('switch-enabled-finance-close')).not.toBeInTheDocument();
    expect(screen.queryByTestId('btn-assistant-more-finance-close')).not.toBeInTheDocument();

    await userEvent.click(screen.getByRole('button', { name: 'View details' }));
    expect(onOpenManagedDetail).toHaveBeenCalledWith('finance-close');
    expect(onOpenDetail).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole('button', { name: 'Start working' }));
    expect(onStartChat).toHaveBeenCalledWith(assistant);
  });
});
