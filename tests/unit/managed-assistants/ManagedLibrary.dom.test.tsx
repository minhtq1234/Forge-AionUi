import type { Assistant, AssistantDetail } from '@/common/types/agent/assistantTypes';
import type { ManagedAssistantDetail, ManagedAssistantSummary } from '@/common/types/agent/managedAssistantTypes';
import { BackendHttpError } from '@/common/adapter/httpBridge';
import { useAssistantList } from '@/renderer/hooks/assistant/useAssistantList';
import type { AssistantListLoadResult } from '@/renderer/hooks/assistant/useAssistantList';
import AssistantHomeTabs from '@/renderer/pages/settings/AssistantSettings/home/AssistantHomeTabs';
import ManagedLibrary from '@/renderer/pages/settings/AssistantSettings/home/ManagedLibrary';
import ManagedTeammateDetail from '@/renderer/pages/settings/AssistantSettings/home/ManagedLibrary/ManagedTeammateDetail';
import useManagedLibrary from '@/renderer/pages/settings/AssistantSettings/home/ManagedLibrary/useManagedLibrary';
import MyAssistantRow from '@/renderer/pages/settings/AssistantSettings/home/MyAssistantRow';
import { ConfigProvider } from '@arco-design/web-react';
import { DndContext } from '@dnd-kit/core';
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import React from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const listManagedAssistants = vi.fn();
const getManagedAssistant = vi.fn();
const setManagedAdoption = vi.fn();
const updateManagedPreferences = vi.fn();
const resetManagedPreferences = vi.fn();
const acknowledgeManagedAssistant = vi.fn();
const markManagedNoticeSeen = vi.fn();
const listAssistants = vi.fn();

let translationOverrides: Record<string, string> = {};

const deferred = <T,>() => {
  let resolve: (value: T) => void;
  let reject: (reason?: unknown) => void;
  const promise = new Promise<T>((promiseResolve, promiseReject) => {
    resolve = promiseResolve;
    reject = promiseReject;
  });
  return { promise, resolve, reject };
};

vi.mock('@/common', () => ({
  ipcBridge: {
    assistants: {
      list: { invoke: (...args: unknown[]) => listAssistants(...args) },
    },
    managedAssistants: {
      list: { invoke: (...args: unknown[]) => listManagedAssistants(...args) },
      get: { invoke: (...args: unknown[]) => getManagedAssistant(...args) },
      setAdoption: { invoke: (...args: unknown[]) => setManagedAdoption(...args) },
      updatePreferences: { invoke: (...args: unknown[]) => updateManagedPreferences(...args) },
      resetPreferences: { invoke: (...args: unknown[]) => resetManagedPreferences(...args) },
      acknowledge: { invoke: (...args: unknown[]) => acknowledgeManagedAssistant(...args) },
      markNoticeSeen: { invoke: (...args: unknown[]) => markManagedNoticeSeen(...args) },
    },
  },
}));

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    i18n: { language: 'en-US', dir: (locale: string) => (locale === 'fa-IR' ? 'rtl' : 'ltr') },
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
        'settings.managedTeammates.ownerFilterAll': 'All owners',
        'settings.managedTeammates.ownerFilterLabel': 'Business owner',
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
        'settings.managedTeammates.lifecycle.updatedBadge': 'Updated by VNG',
        'settings.managedTeammates.lifecycle.routineTitle': 'This Teammate was updated',
        'settings.managedTeammates.lifecycle.releaseNotes': 'What changed',
        'settings.managedTeammates.lifecycle.publishedAt': 'Published',
        'settings.managedTeammates.lifecycle.reviewUpdate': 'Review update',
        'settings.managedTeammates.lifecycle.dismissUpdate': 'Dismiss',
        'settings.managedTeammates.lifecycle.noticeError': 'The update could not be dismissed. Try again.',
        'settings.managedTeammates.lifecycle.stateChanged': 'The Teammate changed while you were reviewing it.',
        'settings.managedTeammates.lifecycle.acknowledgementRequired': 'Acknowledgement required',
        'settings.managedTeammates.lifecycle.highImpactTitle': 'Review an important change',
        'settings.managedTeammates.lifecycle.highImpactBody': 'Review and acknowledge before starting.',
        'settings.managedTeammates.lifecycle.acknowledge': 'Acknowledge change',
        'settings.managedTeammates.lifecycle.acknowledgementError': 'The change could not be acknowledged. Try again.',
        'settings.managedTeammates.lifecycle.categories.content': 'Instructions and content',
        'settings.managedTeammates.lifecycle.categories.permission': 'Permissions',
        'settings.managedTeammates.lifecycle.retiringTitle': 'Planned retirement',
        'settings.managedTeammates.lifecycle.retiredTitle': 'This Teammate is retired',
        'settings.managedTeammates.lifecycle.retirementReason': 'Reason',
        'settings.managedTeammates.lifecycle.retirementCutoff': 'Cutoff',
        'settings.managedTeammates.lifecycle.retiredImmediate': 'New work is no longer available.',
        'settings.managedTeammates.lifecycle.viewReplacement': 'View replacement',
        'settings.managedTeammates.lifecycle.personalSetupRetained':
          'Your personal setup is retained according to company policy.',
        'settings.managedTeammates.lifecycle.temporarilyUnavailableTitle': 'Temporarily unavailable',
        'settings.managedTeammates.lifecycle.temporarilyUnavailableBody': 'Cannot start new work right now.',
        'settings.managedTeammates.lifecycle.unavailableReasons.agent': 'Its runtime is unavailable.',
        'settings.managedTeammates.lifecycle.checkAgain': 'Check again',
        'common.close': 'Close',
        'common.retry': 'Retry',
      };
      if (key === 'settings.managedTeammates.version') return `Version ${options?.version ?? ''}`;
      return translationOverrides[key] ?? labels[key] ?? options?.defaultValue ?? key;
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
  start_state: { can_start_new_work: true },
  ...overrides,
});

const createDetail = (overrides: Partial<ManagedAssistantDetail> = {}): ManagedAssistantDetail => {
  const summary = createSummary();
  return {
    assistant: createAssistantDetail(summary.assistant),
    governance: summary.governance,
    adoption: summary.adoption,
    update: summary.update,
    start_state: summary.start_state,
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

const loadSuccess = (...assistants: Assistant[]): AssistantListLoadResult => ({
  ok: true,
  authoritative: true,
  assistants,
});

const loadFailure = (): AssistantListLoadResult => ({ ok: false, authoritative: true });

const createDetailFor = (
  id: string,
  name: string,
  overrides: Partial<ManagedAssistantDetail> = {}
): ManagedAssistantDetail => {
  const assistant = createAssistant({ id, name, name_i18n: { 'en-US': name } });
  return createDetail({ assistant: createAssistantDetail(assistant), ...overrides });
};

const renderLibrary = (props: Partial<React.ComponentProps<typeof ManagedLibrary>> = {}) =>
  render(
    <ConfigProvider>
      <ManagedLibrary
        localeKey='en-US'
        onAdoptionChanged={vi.fn(async () => loadSuccess(createAssistant()))}
        onStartChat={vi.fn()}
        {...props}
      />
    </ConfigProvider>
  );

const ManagedLibraryWithRealAssistantList: React.FC = () => {
  const { loadAssistants } = useAssistantList();
  return <ManagedLibrary localeKey='en-US' onAdoptionChanged={loadAssistants} onStartChat={vi.fn()} />;
};

const ManagedDetailProjectionHarness: React.FC<{
  onLoadAssistantsReady: (loadAssistants: () => Promise<AssistantListLoadResult>) => void;
  onRefreshReady: (refresh: () => Promise<boolean>) => void;
}> = ({ onLoadAssistantsReady, onRefreshReady }) => {
  const { assistants, loadAssistants } = useAssistantList();
  const library = useManagedLibrary({ localeKey: 'en-US', onAdoptionChanged: loadAssistants });

  React.useEffect(() => {
    onLoadAssistantsReady(loadAssistants);
  }, [loadAssistants, onLoadAssistantsReady]);

  React.useEffect(() => {
    onRefreshReady(library.refreshAfterAdoption);
  }, [library.refreshAfterAdoption, onRefreshReady]);

  React.useEffect(() => {
    if (assistants.length === 0) return;
    void library.loadDetail('finance-close');
  }, [assistants.length, library.loadDetail]);

  if (library.isDetailLoading || (!library.selectedDetail && !library.detailError)) {
    return <div data-testid='managed-detail-loading'>Loading</div>;
  }

  return (
    <ManagedTeammateDetail
      detail={library.selectedDetail}
      localeKey='en-US'
      isLoading={library.isDetailLoading}
      isAdopting={library.isAdopting}
      error={library.detailError}
      mutationError={library.mutationError}
      lifecycleMutationError={library.lifecycleMutationError}
      lifecycleStateChanged={library.lifecycleStateChanged}
      isMarkingNoticeSeen={library.isMarkingNoticeSeen}
      isAcknowledging={library.isAcknowledging}
      onBack={() => undefined}
      onRetry={() => undefined}
      onAdopt={() => undefined}
      onStartChat={() => undefined}
      onMarkNoticeSeen={async (version) => {
        await library.markNoticeSeen(version);
      }}
      onAcknowledge={async (version) => {
        await library.acknowledge(version);
      }}
      onOpenReplacement={() => undefined}
    />
  );
};

const AssistantHomeTabsWithRealAssistantList: React.FC<{
  localeKey?: string;
  onStartChat: (assistant: Pick<Assistant, 'id'>) => void;
  onLoadAssistantsReady?: (loadAssistants: () => Promise<AssistantListLoadResult>) => void;
  onOpenManagedDetailReady?: (openManagedDetail: (id: string) => void) => void;
}> = ({ localeKey: requestedLocaleKey, onStartChat, onLoadAssistantsReady, onOpenManagedDetailReady }) => {
  const { assistants, loadAssistants, localeKey } = useAssistantList();
  const [managedDetailId, setManagedDetailId] = React.useState<string | null>(null);

  React.useEffect(() => {
    onLoadAssistantsReady?.(loadAssistants);
  }, [loadAssistants, onLoadAssistantsReady]);

  React.useEffect(() => {
    onOpenManagedDetailReady?.(setManagedDetailId);
  }, [onOpenManagedDetailReady]);

  return (
    <AssistantHomeTabs
      assistants={assistants}
      localeKey={requestedLocaleKey ?? localeKey}
      onOpenDetail={vi.fn()}
      onOpenManagedDetail={setManagedDetailId}
      onOpenSettings={vi.fn()}
      onDuplicate={vi.fn()}
      onDelete={vi.fn()}
      onCreate={vi.fn()}
      onToggleEnabled={vi.fn()}
      onReorder={vi.fn()}
      onStartChat={onStartChat}
      onAdoptionChanged={loadAssistants}
      initialManagedDetailId={managedDetailId}
      onManagedDetailConsumed={() => setManagedDetailId(null)}
    />
  );
};

describe('ManagedLibrary', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    listAssistants.mockReset();
    translationOverrides = {};
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
    acknowledgeManagedAssistant.mockResolvedValue(createDetail());
    markManagedNoticeSeen.mockResolvedValue(createDetail());
    listAssistants.mockResolvedValue([]);
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

  it('groups and filters by business owner without fabricating a business function', async () => {
    listManagedAssistants.mockResolvedValue([
      createSummary({
        governance: {
          ...createSummary().governance,
          business_owner: 'Linh Nguyen',
        },
      }),
      createSummary({
        assistant: createAssistant({
          id: 'contract-review',
          name: 'Contract Review Teammate',
          name_i18n: { 'en-US': 'Contract Review Teammate' },
        }),
        governance: {
          ...createSummary().governance,
          business_owner: 'Morgan Lee',
        },
      }),
    ]);

    renderLibrary();
    await screen.findByText('Finance Close Coordinator');
    expect(screen.getAllByText('Linh Nguyen').length).toBeGreaterThan(0);
    expect(screen.getAllByText('Morgan Lee').length).toBeGreaterThan(0);
    await userEvent.click(screen.getByRole('combobox', { name: 'Business owner' }));
    fireEvent.click(await screen.findByRole('option', { name: 'Morgan Lee' }));

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

  it('moves focus into loaded detail and restores it to the originating card on Back', async () => {
    renderLibrary();
    const card = await screen.findByRole('button', { name: /Finance Close Coordinator/i });
    card.focus();

    await userEvent.click(card);
    const back = await screen.findByRole('button', { name: 'Back to VNG Library' });
    await waitFor(() => expect(document.activeElement).toBe(back));

    await userEvent.click(back);
    const restoredCard = await screen.findByRole('button', { name: /Finance Close Coordinator/i });
    await waitFor(() => expect(document.activeElement).toBe(restoredCard));
  });

  it('moves focus into a detail error and restores it to the originating card on Back', async () => {
    getManagedAssistant.mockRejectedValue(new Error('private detail failure'));
    renderLibrary();
    const card = await screen.findByRole('button', { name: /Finance Close Coordinator/i });

    await userEvent.click(card);
    await screen.findByText('Teammate details could not be loaded');
    const back = screen.getByRole('button', { name: 'Back to VNG Library' });
    await waitFor(() => expect(document.activeElement).toBe(back));

    await userEvent.click(back);
    const restoredCard = await screen.findByRole('button', { name: /Finance Close Coordinator/i });
    await waitFor(() => expect(document.activeElement).toBe(restoredCard));
  });

  it('keeps long RTL owner copy navigable and marks directional icons for mirroring', async () => {
    const longOwner = 'مسئول ارشد فرآیندهای مالی و کنترل‌های سازمانی بسیار طولانی';
    translationOverrides = {
      'settings.managedTeammates.libraryLead':
        'همکاران مجازی که توسط سازمان آموزش دیده‌اند و به صورت مداوم مدیریت می‌شوند.',
      'settings.managedTeammates.backToLibrary': 'بازگشت به کتابخانه مدیریت‌شده سازمان',
    };
    listManagedAssistants.mockResolvedValue([
      createSummary({ governance: { ...createSummary().governance, business_owner: longOwner } }),
    ]);

    render(
      <ConfigProvider>
        <div style={{ width: 390 }}>
          <ManagedLibrary
            localeKey='fa-IR'
            onAdoptionChanged={vi.fn(async () => loadSuccess(createAssistant()))}
            onStartChat={vi.fn()}
          />
        </div>
      </ConfigProvider>
    );

    expect((await screen.findAllByText(longOwner)).length).toBeGreaterThan(0);
    await userEvent.click(screen.getByRole('button', { name: /Finance Close Coordinator/i }));
    const back = await screen.findByRole('button', {
      name: translationOverrides['settings.managedTeammates.backToLibrary'],
    });
    expect(back.querySelector('[class*="directionalIcon"]')).not.toBeNull();
    expect(back.closest('[dir="rtl"]')).not.toBeNull();
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

  it('uses managed start state while the generic assistant refresh completes after adoption', async () => {
    const refreshRequest = deferred<AssistantListLoadResult>();
    const onAdoptionChanged = vi.fn(() => refreshRequest.promise);

    renderLibrary({ onAdoptionChanged });
    await userEvent.click(await screen.findByRole('button', { name: /Finance Close Coordinator/i }));
    await userEvent.click(await screen.findByRole('button', { name: 'Add to My Teammates' }));

    expect(setManagedAdoption).toHaveBeenCalledWith({ id: 'finance-close', locale: 'en-US', active: true });
    expect(onAdoptionChanged).toHaveBeenCalledTimes(1);
    expect(screen.getByRole('button', { name: 'Start working' })).toBeEnabled();

    refreshRequest.resolve(loadSuccess(createAssistant()));
    expect(await screen.findByRole('button', { name: 'Start working' })).toBeInTheDocument();
  });

  it('verifies the generic projection for an already-active managed detail', async () => {
    getManagedAssistant.mockResolvedValue(createDetail({ adoption: { active: true, adopted_at: 1_788_192_100 } }));
    const onAdoptionChanged = vi.fn(async () => loadSuccess(createAssistant()));

    renderLibrary({ initialDetailId: 'finance-close', onAdoptionChanged });

    expect(await screen.findByRole('button', { name: 'Start working' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Add to My Teammates' })).not.toBeInTheDocument();
    expect(setManagedAdoption).not.toHaveBeenCalled();
    expect(onAdoptionChanged).toHaveBeenCalledTimes(1);
  });

  it('keeps an already-active detail startable when its generic projection is absent', async () => {
    getManagedAssistant.mockResolvedValue(createDetail({ adoption: { active: true, adopted_at: 1_788_192_100 } }));

    renderLibrary({ initialDetailId: 'finance-close', onAdoptionChanged: vi.fn(async () => loadSuccess()) });

    expect(await screen.findByRole('button', { name: 'Start working' })).toBeEnabled();
    expect(screen.queryByText(/My Teammates could not be refreshed/)).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Add to My Teammates' })).not.toBeInTheDocument();
  });

  it('retains successful adoption without surfacing generic refresh failure as a lifecycle blocker', async () => {
    const onAdoptionChanged = vi
      .fn()
      .mockResolvedValueOnce(loadFailure())
      .mockResolvedValueOnce(loadSuccess(createAssistant()));

    renderLibrary({ onAdoptionChanged });
    await userEvent.click(await screen.findByRole('button', { name: /Finance Close Coordinator/i }));
    await userEvent.click(await screen.findByRole('button', { name: 'Add to My Teammates' }));

    expect(await screen.findByRole('button', { name: 'Start working' })).toBeInTheDocument();
    expect(screen.queryByText(/My Teammates could not be refreshed/)).not.toBeInTheDocument();
    expect(setManagedAdoption).toHaveBeenCalledTimes(1);
    expect(onAdoptionChanged).toHaveBeenCalledTimes(1);
  });

  it('keeps a ready active detail after a superseded successful projection and recovers after current failure', async () => {
    const consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const assistantA = createAssistant();
    const staleRefresh = deferred<Assistant[]>();
    const externalRefresh = deferred<Assistant[]>();
    let loadAssistants: (() => Promise<AssistantListLoadResult>) | undefined;
    let refreshProjection: (() => Promise<boolean>) | undefined;
    listAssistants
      .mockResolvedValueOnce([assistantA])
      .mockResolvedValueOnce([assistantA])
      .mockReturnValueOnce(staleRefresh.promise)
      .mockReturnValueOnce(externalRefresh.promise)
      .mockRejectedValueOnce(new Error('current projection failed'))
      .mockResolvedValueOnce([assistantA]);
    getManagedAssistant.mockResolvedValue(createDetail({ adoption: { active: true, adopted_at: 1_788_192_100 } }));

    render(
      <ConfigProvider>
        <ManagedDetailProjectionHarness
          onLoadAssistantsReady={(nextLoadAssistants) => {
            loadAssistants = nextLoadAssistants;
          }}
          onRefreshReady={(nextRefresh) => {
            refreshProjection = nextRefresh;
          }}
        />
      </ConfigProvider>
    );

    expect(await screen.findByRole('button', { name: 'Start working' })).toBeInTheDocument();
    await waitFor(() => {
      expect(loadAssistants).toBeDefined();
      expect(refreshProjection).toBeDefined();
      expect(listAssistants).toHaveBeenCalledTimes(2);
    });

    const staleResult = refreshProjection?.();
    expect(staleResult).toBeDefined();
    await waitFor(() => expect(listAssistants).toHaveBeenCalledTimes(3));
    const externalResult = loadAssistants?.();
    expect(externalResult).toBeDefined();
    if (!staleResult || !externalResult) throw new Error('Projection callbacks were not exposed');

    await act(async () => {
      externalRefresh.resolve([assistantA]);
      await expect(externalResult).resolves.toEqual(loadSuccess(assistantA));
    });
    await act(async () => {
      staleRefresh.resolve([assistantA]);
      await expect(staleResult).resolves.toBe(false);
    });

    expect(await screen.findByRole('button', { name: 'Start working' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Retry' })).not.toBeInTheDocument();

    const failedResult = refreshProjection();
    expect(await failedResult).toBe(false);
    expect(await screen.findByRole('button', { name: 'Start working' })).toBeEnabled();
    expect(screen.queryByRole('button', { name: 'Retry' })).not.toBeInTheDocument();

    const recoveredResult = refreshProjection();
    expect(await recoveredResult).toBe(true);
    expect(await screen.findByRole('button', { name: 'Start working' })).toBeInTheDocument();
    consoleErrorSpy.mockRestore();
  });

  it('keeps a ready active detail after a superseded failed projection and recovers after current failure', async () => {
    const consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const assistantA = createAssistant();
    const staleRefresh = deferred<Assistant[]>();
    const externalRefresh = deferred<Assistant[]>();
    let loadAssistants: (() => Promise<AssistantListLoadResult>) | undefined;
    let refreshProjection: (() => Promise<boolean>) | undefined;
    listAssistants
      .mockResolvedValueOnce([assistantA])
      .mockResolvedValueOnce([assistantA])
      .mockReturnValueOnce(staleRefresh.promise)
      .mockReturnValueOnce(externalRefresh.promise)
      .mockRejectedValueOnce(new Error('current projection failed'))
      .mockResolvedValueOnce([assistantA]);
    getManagedAssistant.mockResolvedValue(createDetail({ adoption: { active: true, adopted_at: 1_788_192_100 } }));

    render(
      <ConfigProvider>
        <ManagedDetailProjectionHarness
          onLoadAssistantsReady={(nextLoadAssistants) => {
            loadAssistants = nextLoadAssistants;
          }}
          onRefreshReady={(nextRefresh) => {
            refreshProjection = nextRefresh;
          }}
        />
      </ConfigProvider>
    );

    expect(await screen.findByRole('button', { name: 'Start working' })).toBeInTheDocument();
    await waitFor(() => {
      expect(loadAssistants).toBeDefined();
      expect(refreshProjection).toBeDefined();
      expect(listAssistants).toHaveBeenCalledTimes(2);
    });

    const staleResult = refreshProjection?.();
    expect(staleResult).toBeDefined();
    await waitFor(() => expect(listAssistants).toHaveBeenCalledTimes(3));
    const externalResult = loadAssistants?.();
    expect(externalResult).toBeDefined();
    if (!staleResult || !externalResult) throw new Error('Projection callbacks were not exposed');

    await act(async () => {
      externalRefresh.resolve([assistantA]);
      await expect(externalResult).resolves.toEqual(loadSuccess(assistantA));
    });
    await act(async () => {
      staleRefresh.reject(new Error('superseded projection failed'));
      await expect(staleResult).resolves.toBe(false);
    });

    expect(await screen.findByRole('button', { name: 'Start working' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Retry' })).not.toBeInTheDocument();

    const failedResult = refreshProjection();
    expect(await failedResult).toBe(false);
    expect(await screen.findByRole('button', { name: 'Start working' })).toBeEnabled();
    expect(screen.queryByRole('button', { name: 'Retry' })).not.toBeInTheDocument();

    const recoveredResult = refreshProjection();
    expect(await recoveredResult).toBe(true);
    expect(await screen.findByRole('button', { name: 'Start working' })).toBeInTheDocument();
    consoleErrorSpy.mockRestore();
  });

  it('uses the real assistant-list success result to reject a stale projection', async () => {
    listAssistants
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([createAssistant({ id: 'different-id', name: 'Different Teammate' })]);

    render(
      <ConfigProvider>
        <ManagedLibraryWithRealAssistantList />
      </ConfigProvider>
    );
    await waitFor(() => expect(listAssistants).toHaveBeenCalledTimes(1));
    await userEvent.click(await screen.findByRole('button', { name: /Finance Close Coordinator/i }));
    await userEvent.click(await screen.findByRole('button', { name: 'Add to My Teammates' }));

    expect(await screen.findByRole('button', { name: 'Start working' })).toBeEnabled();
    expect(screen.queryByRole('button', { name: 'Retry' })).not.toBeInTheDocument();
    expect(listAssistants).toHaveBeenCalledTimes(2);
  });

  it('uses the real assistant-list failure result to keep adoption retryable', async () => {
    const consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    listAssistants.mockResolvedValueOnce([]).mockRejectedValueOnce(new Error('generic list failed'));

    render(
      <ConfigProvider>
        <ManagedLibraryWithRealAssistantList />
      </ConfigProvider>
    );
    await waitFor(() => expect(listAssistants).toHaveBeenCalledTimes(1));
    await userEvent.click(await screen.findByRole('button', { name: /Finance Close Coordinator/i }));
    await userEvent.click(await screen.findByRole('button', { name: 'Add to My Teammates' }));

    expect(await screen.findByRole('button', { name: 'Start working' })).toBeEnabled();
    expect(screen.queryByRole('button', { name: 'Retry' })).not.toBeInTheDocument();
    expect(consoleErrorSpy).toHaveBeenCalledWith('Failed to load assistants:', expect.any(Error));
    consoleErrorSpy.mockRestore();
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

  it('ignores a late adoption response after navigating from A to B', async () => {
    const adoptionRequest = deferred<ManagedAssistantDetail>();
    const assistantB = createAssistant({
      id: 'contract-review',
      name: 'Contract Review Teammate',
      name_i18n: { 'en-US': 'Contract Review Teammate' },
    });
    listManagedAssistants.mockResolvedValue([createSummary(), createSummary({ assistant: assistantB })]);
    getManagedAssistant.mockImplementation(({ id }: { id: string }) =>
      Promise.resolve(
        id === assistantB.id
          ? createDetailFor(assistantB.id, assistantB.name)
          : createDetailFor('finance-close', 'Finance Close Coordinator')
      )
    );
    setManagedAdoption.mockReturnValue(adoptionRequest.promise);

    renderLibrary();
    await userEvent.click(await screen.findByRole('button', { name: /Finance Close Coordinator/i }));
    await userEvent.click(await screen.findByRole('button', { name: 'Add to My Teammates' }));
    await userEvent.click(screen.getByRole('button', { name: 'Back to VNG Library' }));
    await userEvent.click(await screen.findByRole('button', { name: /Contract Review Teammate/i }));
    expect(await screen.findByRole('heading', { name: 'Contract Review Teammate' })).toBeInTheDocument();

    await act(async () => {
      adoptionRequest.resolve(
        createDetailFor('finance-close', 'Finance Close Coordinator', {
          adoption: { active: true },
          personalization_policy: {
            allowed_fields: ['nickname'],
            optional_skill_ids: [],
            allowed_model_ids: [],
          },
        })
      );
      await adoptionRequest.promise;
    });

    expect(screen.getByRole('heading', { name: 'Contract Review Teammate' })).toBeInTheDocument();
    expect(screen.queryByText('Your setup')).not.toBeInTheDocument();
  });

  it('ignores a late preference save after setup closes and B is selected', async () => {
    const saveRequest = deferred<ManagedAssistantDetail>();
    const assistantB = createAssistant({
      id: 'contract-review',
      name: 'Contract Review Teammate',
      name_i18n: { 'en-US': 'Contract Review Teammate' },
    });
    const adoptedA = createDetailFor('finance-close', 'Finance Close Coordinator', {
      adoption: { active: true },
      personalization_policy: { allowed_fields: ['nickname'], optional_skill_ids: [], allowed_model_ids: [] },
    });
    listManagedAssistants.mockResolvedValue([createSummary(), createSummary({ assistant: assistantB })]);
    getManagedAssistant.mockImplementation(({ id }: { id: string }) =>
      Promise.resolve(id === assistantB.id ? createDetailFor(assistantB.id, assistantB.name) : createDetail())
    );
    setManagedAdoption.mockResolvedValue(adoptedA);
    updateManagedPreferences.mockReturnValue(saveRequest.promise);

    renderLibrary({ onAdoptionChanged: vi.fn(async () => loadSuccess(createAssistant())) });
    await userEvent.click(await screen.findByRole('button', { name: /Finance Close Coordinator/i }));
    await userEvent.click(await screen.findByRole('button', { name: 'Add to My Teammates' }));
    await userEvent.type(await screen.findByLabelText('Nickname'), 'Close buddy');
    await userEvent.click(screen.getByRole('button', { name: 'Save setup' }));
    fireEvent.keyDown(document.querySelector('.arco-drawer-wrapper') as HTMLElement, {
      key: 'Escape',
      code: 'Escape',
      keyCode: 27,
      which: 27,
    });
    await waitFor(() => expect(screen.queryByText('Your setup')).not.toBeInTheDocument());
    await userEvent.click(screen.getByRole('button', { name: 'Back to VNG Library' }));
    await userEvent.click(await screen.findByRole('button', { name: /Contract Review Teammate/i }));

    await act(async () => {
      saveRequest.resolve({ ...adoptedA, preferences: { nickname: 'Close buddy' } });
      await saveRequest.promise;
    });

    expect(screen.getByRole('heading', { name: 'Contract Review Teammate' })).toBeInTheDocument();
    expect(screen.queryByText('Your setup')).not.toBeInTheDocument();
    expect(screen.queryByText('Personal setup saved')).not.toBeInTheDocument();
  });

  it('does not reopen setup when reset completes after the drawer closes', async () => {
    const resetRequest = deferred<ManagedAssistantDetail>();
    const adoptedDetail = createDetail({
      adoption: { active: true },
      personalization_policy: { allowed_fields: ['nickname'], optional_skill_ids: [], allowed_model_ids: [] },
      preferences: { nickname: 'Close buddy' },
    });
    setManagedAdoption.mockResolvedValue(adoptedDetail);
    resetManagedPreferences.mockReturnValue(resetRequest.promise);

    renderLibrary({ onAdoptionChanged: vi.fn(async () => loadSuccess(createAssistant())) });
    await userEvent.click(await screen.findByRole('button', { name: /Finance Close Coordinator/i }));
    await userEvent.click(await screen.findByRole('button', { name: 'Add to My Teammates' }));
    await userEvent.click(await screen.findByRole('button', { name: 'Reset personal setup' }));
    fireEvent.click(screen.getByRole('button', { name: 'Reset' }));
    fireEvent.keyDown(document.querySelector('.arco-drawer-wrapper') as HTMLElement, {
      key: 'Escape',
      code: 'Escape',
      keyCode: 27,
      which: 27,
    });
    await waitFor(() => expect(screen.queryByText('Your setup')).not.toBeInTheDocument());

    await act(async () => {
      resetRequest.resolve({ ...adoptedDetail, preferences: {} });
      await resetRequest.promise;
    });

    expect(screen.queryByText('Your setup')).not.toBeInTheDocument();
    expect(screen.queryByText('Personal setup reset')).not.toBeInTheDocument();
  });

  it.each([
    ['success', loadSuccess(createAssistant())],
    ['failure', loadFailure()],
  ])('ignores a late projection refresh %s after navigating from A to B', async (_case, refreshResult) => {
    const refreshRequest = deferred<AssistantListLoadResult>();
    const assistantB = createAssistant({
      id: 'contract-review',
      name: 'Contract Review Teammate',
      name_i18n: { 'en-US': 'Contract Review Teammate' },
    });
    const adoptedA = createDetailFor('finance-close', 'Finance Close Coordinator', {
      adoption: { active: true },
      personalization_policy: { allowed_fields: ['nickname'], optional_skill_ids: [], allowed_model_ids: [] },
    });
    listManagedAssistants.mockResolvedValue([createSummary(), createSummary({ assistant: assistantB })]);
    getManagedAssistant.mockImplementation(({ id }: { id: string }) =>
      Promise.resolve(id === assistantB.id ? createDetailFor(assistantB.id, assistantB.name) : createDetail())
    );
    setManagedAdoption.mockResolvedValue(adoptedA);

    renderLibrary({ onAdoptionChanged: vi.fn(() => refreshRequest.promise) });
    await userEvent.click(await screen.findByRole('button', { name: /Finance Close Coordinator/i }));
    await userEvent.click(await screen.findByRole('button', { name: 'Add to My Teammates' }));
    await waitFor(() => expect(setManagedAdoption).toHaveBeenCalledTimes(1));
    await userEvent.click(screen.getByRole('button', { name: 'Back to VNG Library' }));
    await userEvent.click(await screen.findByRole('button', { name: /Contract Review Teammate/i }));

    await act(async () => {
      refreshRequest.resolve(refreshResult);
      await refreshRequest.promise;
    });

    expect(screen.getByRole('heading', { name: 'Contract Review Teammate' })).toBeInTheDocument();
    expect(screen.queryByText('Your setup')).not.toBeInTheDocument();
    expect(screen.queryByText(/My Teammates could not be refreshed/)).not.toBeInTheDocument();
  });

  it('does not open an empty setup drawer when only skill and model fields are allowed', async () => {
    setManagedAdoption.mockResolvedValue(
      createDetail({
        adoption: { active: true },
        personalization_policy: {
          allowed_fields: ['optional_skills', 'model'],
          optional_skill_ids: ['email-tone'],
          allowed_model_ids: ['managed-default'],
        },
      })
    );

    renderLibrary();
    await userEvent.click(await screen.findByRole('button', { name: /Finance Close Coordinator/i }));
    await userEvent.click(await screen.findByRole('button', { name: 'Add to My Teammates' }));

    expect(await screen.findByRole('button', { name: 'Start working' })).toBeInTheDocument();
    expect(screen.queryByText('Your setup')).not.toBeInTheDocument();
    expect(screen.queryByText('email-tone')).not.toBeInTheDocument();
    expect(screen.queryByText('managed-default')).not.toBeInTheDocument();
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

    renderLibrary({ onAdoptionChanged: vi.fn().mockResolvedValue(loadSuccess(createAssistant())) });
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

    renderLibrary({ onAdoptionChanged: vi.fn().mockResolvedValue(loadSuccess(createAssistant())) });
    await userEvent.click(await screen.findByRole('button', { name: /Finance Close Coordinator/i }));
    await userEvent.click(await screen.findByRole('button', { name: 'Add to My Teammates' }));
    await userEvent.click(await screen.findByRole('button', { name: 'Reset personal setup' }));
    fireEvent.click(screen.getByRole('button', { name: 'Reset' }));

    await waitFor(() => expect(resetManagedPreferences).toHaveBeenCalledWith({ id: 'finance-close', locale: 'en-US' }));
  });
});

describe('managed assistant entry points', () => {
  afterEach(() => {
    listAssistants.mockReset();
  });

  it('ignores a stale A success after a newer B projection becomes current', async () => {
    const consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const assistantA = createAssistant();
    const assistantB = createAssistant({
      id: 'contract-review',
      name: 'Contract Review Teammate',
      name_i18n: { 'en-US': 'Contract Review Teammate' },
    });
    const staleARefresh = deferred<Assistant[]>();
    const currentBRefresh = deferred<Assistant[]>();
    let openManagedDetail: ((id: string) => void) | undefined;
    listManagedAssistants.mockResolvedValue([createSummary(), createSummary({ assistant: assistantB })]);
    getManagedAssistant.mockImplementation(({ id }: { id: string }) =>
      Promise.resolve(
        id === assistantB.id
          ? createDetailFor(assistantB.id, assistantB.name, { adoption: { active: true, adopted_at: 1_788_192_100 } })
          : createDetail({ adoption: { active: true, adopted_at: 1_788_192_100 } })
      )
    );
    listAssistants
      .mockResolvedValueOnce([assistantA])
      .mockReturnValueOnce(staleARefresh.promise)
      .mockReturnValueOnce(currentBRefresh.promise);

    render(
      <ConfigProvider>
        <AssistantHomeTabsWithRealAssistantList
          onStartChat={vi.fn()}
          onOpenManagedDetailReady={(nextOpenManagedDetail) => {
            openManagedDetail = nextOpenManagedDetail;
          }}
        />
      </ConfigProvider>
    );

    await screen.findByTestId('assistant-card-finance-close');
    await waitFor(() => expect(openManagedDetail).toBeDefined());
    await userEvent.click(screen.getByRole('button', { name: 'View details' }));
    await waitFor(() => expect(listAssistants).toHaveBeenCalledTimes(2));
    act(() => {
      openManagedDetail?.(assistantB.id);
    });
    await waitFor(() => expect(listAssistants).toHaveBeenCalledTimes(3));
    await act(async () => {
      currentBRefresh.resolve([assistantB]);
      await currentBRefresh.promise;
    });

    await userEvent.click(screen.getByRole('tab', { name: 'My Teammates' }));
    const staleAStart = within(screen.getByTestId('assistant-card-finance-close')).getByRole('button', {
      name: 'Start working',
    });
    expect(staleAStart).toBeEnabled();
    expect(
      within(screen.getByTestId('assistant-card-contract-review')).getByRole('button', { name: 'Start working' })
    ).toBeEnabled();

    await act(async () => {
      staleARefresh.resolve([assistantA]);
      await staleARefresh.promise;
    });
    expect(screen.getAllByTestId('assistant-card-finance-close')).toHaveLength(1);
    expect(staleAStart).toBeEnabled();
    consoleErrorSpy.mockRestore();
  });

  it('ignores a stale A failure after an external current catalog refresh retains A', async () => {
    const consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const assistantA = createAssistant();
    const staleARefresh = deferred<Assistant[]>();
    const externalRefresh = deferred<Assistant[]>();
    let loadAssistants: (() => Promise<AssistantListLoadResult>) | undefined;
    getManagedAssistant.mockResolvedValue(createDetail({ adoption: { active: true, adopted_at: 1_788_192_100 } }));
    listAssistants
      .mockResolvedValueOnce([assistantA])
      .mockReturnValueOnce(staleARefresh.promise)
      .mockReturnValueOnce(externalRefresh.promise);

    render(
      <ConfigProvider>
        <AssistantHomeTabsWithRealAssistantList
          onStartChat={vi.fn()}
          onLoadAssistantsReady={(nextLoadAssistants) => {
            loadAssistants = nextLoadAssistants;
          }}
        />
      </ConfigProvider>
    );

    await screen.findByTestId('assistant-card-finance-close');
    await waitFor(() => expect(loadAssistants).toBeDefined());
    await userEvent.click(screen.getByRole('button', { name: 'View details' }));
    await waitFor(() => expect(listAssistants).toHaveBeenCalledTimes(2));
    let externalResult: Promise<AssistantListLoadResult> | undefined;
    act(() => {
      externalResult = loadAssistants?.();
    });
    await waitFor(() => expect(listAssistants).toHaveBeenCalledTimes(3));

    await act(async () => {
      externalRefresh.resolve([assistantA]);
      await externalResult;
    });
    await act(async () => {
      staleARefresh.reject(new Error('stale projection failed'));
      await staleARefresh.promise.catch(() => undefined);
    });

    await userEvent.click(screen.getByRole('tab', { name: 'My Teammates' }));
    expect(
      within(screen.getByTestId('assistant-card-finance-close')).getByRole('button', { name: 'Start working' })
    ).toBeEnabled();
    consoleErrorSpy.mockRestore();
  });

  it('replaces retained managed readiness for empty, other-ID-only, and later exact-ID catalog results', async () => {
    const assistantA = createAssistant();
    const assistantB = createAssistant({
      id: 'contract-review',
      name: 'Contract Review Teammate',
      name_i18n: { 'en-US': 'Contract Review Teammate' },
    });
    const missingRefresh = deferred<Assistant[]>();
    const otherIdRefresh = deferred<Assistant[]>();
    const exactIdRefresh = deferred<Assistant[]>();
    let loadAssistants: (() => Promise<AssistantListLoadResult>) | undefined;
    listAssistants
      .mockResolvedValueOnce([assistantA])
      .mockReturnValueOnce(missingRefresh.promise)
      .mockReturnValueOnce(otherIdRefresh.promise)
      .mockReturnValueOnce(exactIdRefresh.promise);

    render(
      <ConfigProvider>
        <AssistantHomeTabsWithRealAssistantList
          onStartChat={vi.fn()}
          onLoadAssistantsReady={(nextLoadAssistants) => {
            loadAssistants = nextLoadAssistants;
          }}
        />
      </ConfigProvider>
    );

    await screen.findByTestId('assistant-card-finance-close');
    await waitFor(() => expect(loadAssistants).toBeDefined());

    let missingResult: Promise<AssistantListLoadResult> | undefined;
    act(() => {
      missingResult = loadAssistants?.();
    });
    await act(async () => {
      missingRefresh.resolve([]);
      await missingResult;
    });
    expect(screen.getAllByTestId('assistant-card-finance-close')).toHaveLength(1);
    expect(
      within(screen.getByTestId('assistant-card-finance-close')).getByRole('button', { name: 'Start working' })
    ).toBeEnabled();

    let otherIdResult: Promise<AssistantListLoadResult> | undefined;
    act(() => {
      otherIdResult = loadAssistants?.();
    });
    await act(async () => {
      otherIdRefresh.resolve([assistantB]);
      await otherIdResult;
    });
    expect(screen.getAllByTestId('assistant-card-finance-close')).toHaveLength(1);
    expect(
      within(screen.getByTestId('assistant-card-finance-close')).getByRole('button', { name: 'Start working' })
    ).toBeEnabled();

    let exactIdResult: Promise<AssistantListLoadResult> | undefined;
    act(() => {
      exactIdResult = loadAssistants?.();
    });
    await act(async () => {
      exactIdRefresh.resolve([assistantA]);
      await exactIdResult;
    });
    expect(
      within(screen.getByTestId('assistant-card-finance-close')).getByRole('button', { name: 'Start working' })
    ).toBeEnabled();
  });

  it('keeps a stale managed row visible and authorizes Start from its managed summary', async () => {
    const consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const onStartChat = vi.fn();
    const assistant = createAssistant();
    getManagedAssistant.mockResolvedValue(createDetail({ adoption: { active: true, adopted_at: 1_788_192_100 } }));
    listAssistants
      .mockResolvedValueOnce([assistant])
      .mockRejectedValueOnce(new Error('generic list failed'))
      .mockResolvedValueOnce([assistant]);

    render(
      <ConfigProvider>
        <AssistantHomeTabsWithRealAssistantList onStartChat={onStartChat} />
      </ConfigProvider>
    );

    await waitFor(() => expect(listAssistants).toHaveBeenCalledTimes(1));
    await userEvent.click(await screen.findByRole('button', { name: 'View details' }));
    expect(await screen.findByRole('button', { name: 'Start working' })).toBeEnabled();

    await userEvent.click(screen.getByRole('tab', { name: 'My Teammates' }));
    const start = await screen.findByRole('button', { name: 'Start working' });
    expect(screen.getByTestId('assistant-card-finance-close')).toBeInTheDocument();
    expect(start).toBeEnabled();
    await userEvent.click(start);
    expect(onStartChat).toHaveBeenCalledWith(assistant);

    await userEvent.click(screen.getByRole('button', { name: 'View details' }));
    expect(await screen.findByRole('button', { name: 'Start working' })).toBeInTheDocument();
    expect(listAssistants).toHaveBeenCalledTimes(3);

    await userEvent.click(screen.getByRole('tab', { name: 'My Teammates' }));
    await userEvent.click(await screen.findByRole('button', { name: 'Start working' }));
    expect(onStartChat).toHaveBeenCalledTimes(2);
    consoleErrorSpy.mockRestore();
  });

  it('sets RTL direction across the assistant home shell and mirrors the managed View icon', async () => {
    listAssistants.mockResolvedValue([createAssistant()]);

    render(
      <ConfigProvider>
        <AssistantHomeTabsWithRealAssistantList localeKey='fa-IR' onStartChat={vi.fn()} />
      </ConfigProvider>
    );

    const shell = screen.getByTestId('assistant-home-shell');
    expect(shell).toHaveAttribute('dir', 'rtl');
    expect(screen.getByRole('heading', { name: 'Teammates' }).closest('[dir="rtl"]')).toBe(shell);
    expect(screen.getByRole('tab', { name: 'My Teammates' }).closest('[dir="rtl"]')).toBe(shell);

    const viewDetails = await screen.findByRole('button', { name: 'View details' });
    expect(viewDetails.closest('[dir="rtl"]')).toBe(shell);
    expect(viewDetails.querySelector('[class*="directionalIcon"]')).not.toBeNull();
  });

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
    expect(
      screen.queryByText('Managed Teammates stay fixed; drag your own Teammates to reorder them.')
    ).not.toBeInTheDocument();
    expect(screen.getByTestId('created-empty')).not.toHaveClass('rounded-14px');
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
            managedSummary={createSummary({ assistant, adoption: { active: true } })}
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

  it('keeps routine updates startable and hides the notice only from the mutation response', async () => {
    const onStartChat = vi.fn();
    listManagedAssistants.mockResolvedValue([createSummary()]);
    const routine = createDetail({
      adoption: { active: true },
      update: {
        current_version: 3,
        last_seen_version: 2,
        notice_pending: true,
        acknowledgement_required: false,
        change_impact: 'routine',
        changed_categories: ['content'],
      },
      governance: {
        ...createDetail().governance,
        published_version: 3,
        release_notes: 'A clearer close checklist.',
      },
      start_state: { can_start_new_work: true },
    });
    getManagedAssistant.mockResolvedValue(routine);
    markManagedNoticeSeen.mockResolvedValue({
      ...routine,
      update: { ...routine.update, notice_pending: false, last_seen_version: 3 },
    });

    renderLibrary({ onStartChat });
    await userEvent.click(await screen.findByRole('button', { name: /Finance Close Coordinator/i }));

    expect(await screen.findByText('This Teammate was updated')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Start working' })).toBeEnabled();
    await userEvent.click(screen.getByRole('button', { name: 'Dismiss' }));

    expect(markManagedNoticeSeen).toHaveBeenCalledWith({ id: 'finance-close', locale: 'en-US', version: 3 });
    await waitFor(() => expect(screen.queryByText('This Teammate was updated')).not.toBeInTheDocument());
  });

  it('returns focus to Start after Review removes its own trigger from the mutation response', async () => {
    const routine = createDetail({
      adoption: { active: true },
      update: {
        current_version: 3,
        last_seen_version: 2,
        notice_pending: true,
        acknowledgement_required: false,
        change_impact: 'routine',
        changed_categories: ['content'],
      },
      start_state: { can_start_new_work: true },
    });
    getManagedAssistant.mockResolvedValue(routine);
    markManagedNoticeSeen.mockResolvedValue({
      ...routine,
      update: { ...routine.update, notice_pending: false, last_seen_version: 3 },
    });

    renderLibrary();
    await userEvent.click(await screen.findByRole('button', { name: /Finance Close Coordinator/i }));
    await userEvent.click(await screen.findByRole('button', { name: 'Review update' }));

    expect(await screen.findByRole('dialog', { name: 'This Teammate was updated' })).toBeInTheDocument();
    await waitFor(() => expect(screen.queryByRole('button', { name: 'Review update' })).not.toBeInTheDocument());
    const reviewDialog = screen.getByRole('dialog', { name: 'This Teammate was updated' });
    const closeButton = within(reviewDialog).getByText('Close').closest('button');
    if (!closeButton) throw new Error('Review close action missing');
    await userEvent.click(closeButton);

    await waitFor(() => expect(screen.getByRole('button', { name: 'Start working' })).toHaveFocus());
  });

  it('blocks start until the exact required acknowledgement response allows it', async () => {
    listManagedAssistants.mockResolvedValue([createSummary()]);
    const required = createDetail({
      adoption: { active: true },
      update: {
        current_version: 3,
        notice_pending: true,
        acknowledgement_required: true,
        change_impact: 'routine',
        changed_categories: ['content'],
        required_acknowledgement: {
          version: 2,
          release_notes: 'Permissions changed in v2.',
          published_at: 1_788_105_600,
          changed_categories: ['permission'],
        },
      },
      start_state: { can_start_new_work: false, blocker: 'acknowledgement_required' },
    });
    getManagedAssistant.mockResolvedValue(required);
    acknowledgeManagedAssistant.mockResolvedValue({
      ...required,
      update: {
        ...required.update,
        acknowledged_version: 2,
        acknowledgement_required: false,
        required_acknowledgement: undefined,
      },
      start_state: { can_start_new_work: true },
    });

    renderLibrary();
    await userEvent.click(await screen.findByRole('button', { name: /Finance Close Coordinator/i }));

    expect(await screen.findByText('Review an important change')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Start working' })).not.toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Acknowledge change' }));

    expect(acknowledgeManagedAssistant).toHaveBeenCalledWith({ id: 'finance-close', locale: 'en-US', version: 2 });
    expect(await screen.findByRole('button', { name: 'Start working' })).toBeEnabled();
  });

  it('opens a backend-projected replacement in the dedicated VNG Library detail', async () => {
    listManagedAssistants.mockResolvedValue([createSummary()]);
    const retired = createDetail({
      adoption: { active: true },
      governance: {
        ...createDetail().governance,
        lifecycle: 'retired',
        retirement_reason: 'Use the new close process.',
        replacement_assistant_id: 'finance-close-v2',
      },
      start_state: { can_start_new_work: false, blocker: 'retired' },
    });
    getManagedAssistant.mockImplementation(({ id }: { id: string }) =>
      Promise.resolve(
        id === 'finance-close-v2' ? createDetailFor('finance-close-v2', 'Finance Close Coordinator V2') : retired
      )
    );

    renderLibrary();
    await userEvent.click(await screen.findByRole('button', { name: /Finance Close Coordinator/i }));
    await userEvent.click(await screen.findByRole('button', { name: 'View replacement' }));

    expect(getManagedAssistant).toHaveBeenLastCalledWith({ id: 'finance-close-v2', locale: 'en-US' });
    expect(await screen.findByRole('heading', { name: 'Finance Close Coordinator V2' })).toBeInTheDocument();
  });

  it('uses one managed summary source for My Teammates lifecycle state without a row detail fetch', async () => {
    const managed = createAssistant();
    const listCallsBeforeRender = listManagedAssistants.mock.calls.length;
    const detailCallsBeforeRender = getManagedAssistant.mock.calls.length;
    listManagedAssistants.mockResolvedValue([
      createSummary({
        assistant: managed,
        adoption: { active: true },
        update: {
          current_version: 3,
          last_seen_version: 2,
          notice_pending: true,
          acknowledgement_required: false,
          change_impact: 'routine',
          changed_categories: ['content'],
        },
        start_state: { can_start_new_work: true },
      }),
    ]);

    render(
      <ConfigProvider>
        <AssistantHomeTabs
          assistants={[managed]}
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
          onAdoptionChanged={vi.fn(async () => loadSuccess(managed))}
        />
      </ConfigProvider>
    );

    expect(await screen.findByText('Updated by VNG')).toBeInTheDocument();
    expect(listManagedAssistants).toHaveBeenCalledTimes(listCallsBeforeRender + 1);
    expect(getManagedAssistant).toHaveBeenCalledTimes(detailCallsBeforeRender);
  });

  it('patches My Teammates from a successful lifecycle response without stale notice state', async () => {
    const managed = createAssistant();
    const routineSummary = createSummary({
      assistant: managed,
      adoption: { active: true },
      update: {
        current_version: 3,
        last_seen_version: 2,
        notice_pending: true,
        acknowledgement_required: false,
        changed_categories: ['content'],
      },
      start_state: { can_start_new_work: true },
    });
    const routineDetail = createDetail({
      governance: routineSummary.governance,
      adoption: routineSummary.adoption,
      update: routineSummary.update,
      start_state: routineSummary.start_state,
    });
    listManagedAssistants.mockResolvedValue([routineSummary]);
    getManagedAssistant.mockResolvedValue(routineDetail);
    markManagedNoticeSeen.mockResolvedValue({
      ...routineDetail,
      update: { ...routineDetail.update, notice_pending: false, last_seen_version: 3 },
      start_state: {
        can_start_new_work: false,
        blocker: 'temporarily_unavailable',
        unavailable_reason: 'agent',
      },
    });

    render(
      <ConfigProvider>
        <AssistantHomeTabs
          assistants={[managed]}
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
          onAdoptionChanged={vi.fn(async () => loadSuccess(managed))}
        />
      </ConfigProvider>
    );

    expect(await screen.findByText('Updated by VNG')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('tab', { name: 'VNG Library' }));
    await userEvent.click(await screen.findByRole('button', { name: /Finance Close Coordinator/i }));
    await userEvent.click(screen.getByRole('button', { name: 'Dismiss' }));
    await userEvent.click(screen.getByRole('tab', { name: 'My Teammates' }));

    expect(await screen.findByText('Temporarily unavailable')).toBeInTheDocument();
    expect(screen.queryByText('Updated by VNG')).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Start working' })).toBeDisabled();
  });

  it('replaces My Teammates summary from a 409 refetch without a stale blocker', async () => {
    const managed = createAssistant();
    const requiredSummary = createSummary({
      assistant: managed,
      adoption: { active: true },
      update: {
        current_version: 3,
        notice_pending: false,
        acknowledgement_required: true,
        changed_categories: ['permission'],
        required_acknowledgement: {
          version: 2,
          release_notes: 'Review v2.',
          published_at: 1_788_105_600,
          changed_categories: ['permission'],
        },
      },
      start_state: { can_start_new_work: false, blocker: 'acknowledgement_required' },
    });
    const requiredDetail = createDetail({
      governance: requiredSummary.governance,
      adoption: requiredSummary.adoption,
      update: requiredSummary.update,
      start_state: requiredSummary.start_state,
    });
    const refreshedDetail = {
      ...requiredDetail,
      update: {
        ...requiredDetail.update,
        acknowledgement_required: false,
        acknowledged_version: 2,
        required_acknowledgement: undefined,
      },
      start_state: { can_start_new_work: true } as const,
    };
    listManagedAssistants.mockResolvedValue([requiredSummary]);
    getManagedAssistant.mockResolvedValueOnce(requiredDetail).mockResolvedValueOnce(refreshedDetail);
    acknowledgeManagedAssistant.mockRejectedValue(
      new BackendHttpError({
        method: 'POST',
        path: '/api/managed-assistants/finance-close/acknowledge',
        status: 409,
        body: { code: 'MANAGED_ASSISTANT_ACK_VERSION_MISMATCH', error: 'private backend message' },
      })
    );

    render(
      <ConfigProvider>
        <AssistantHomeTabs
          assistants={[managed]}
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
          onAdoptionChanged={vi.fn(async () => loadSuccess(managed))}
        />
      </ConfigProvider>
    );

    expect(await screen.findByText('Acknowledgement required')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('tab', { name: 'VNG Library' }));
    await userEvent.click(await screen.findByRole('button', { name: /Finance Close Coordinator/i }));
    await userEvent.click(screen.getByRole('button', { name: 'Acknowledge change' }));
    await waitFor(() => expect(screen.queryByText('Review an important change')).not.toBeInTheDocument());
    await userEvent.click(screen.getByRole('tab', { name: 'My Teammates' }));

    expect(screen.queryByText('Acknowledgement required')).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Start working' })).toBeEnabled();
  });

  it('shows and enforces the managed lifecycle blocker in My Teammates', () => {
    const onStartChat = vi.fn();
    const assistant = createAssistant();
    const summary = createSummary({
      assistant,
      adoption: { active: true },
      update: {
        current_version: 3,
        notice_pending: false,
        acknowledgement_required: true,
        changed_categories: [],
        required_acknowledgement: {
          version: 2,
          release_notes: 'Review v2.',
          published_at: 1_788_105_600,
          changed_categories: ['permission'],
        },
      },
      start_state: { can_start_new_work: false, blocker: 'acknowledgement_required' },
    });

    render(
      <ConfigProvider>
        <DndContext>
          <MyAssistantRow
            assistant={assistant}
            localeKey='en-US'
            draggable={false}
            onOpenDetail={vi.fn()}
            onOpenManagedDetail={vi.fn()}
            onDelete={vi.fn()}
            onToggleEnabled={vi.fn()}
            onStartChat={onStartChat}
            managedSummary={summary}
          />
        </DndContext>
      </ConfigProvider>
    );

    expect(screen.getByText('Acknowledgement required')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Start working' })).toBeDisabled();
    expect(onStartChat).not.toHaveBeenCalled();
  });
});
