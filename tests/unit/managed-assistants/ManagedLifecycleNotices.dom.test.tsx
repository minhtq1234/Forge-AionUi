import type { Assistant, AssistantDetail } from '@/common/types/agent/assistantTypes';
import type { ManagedAssistantDetail } from '@/common/types/agent/managedAssistantTypes';
import {
  ManagedLifecycleNotices,
  canStartManagedAssistant,
  getManagedLifecycleState,
} from '@/renderer/components/ManagedTeammates';
import useManagedLibrary from '@/renderer/pages/settings/AssistantSettings/home/ManagedLibrary/useManagedLibrary';
import { BackendHttpError } from '@/common/adapter/httpBridge';
import { ConfigProvider } from '@arco-design/web-react';
import { act, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import React from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const bridgeMocks = vi.hoisted(() => ({
  list: vi.fn(),
  get: vi.fn(),
  acknowledge: vi.fn(),
  markNoticeSeen: vi.fn(),
}));

const deferred = <T,>() => {
  let resolve: (value: T) => void;
  const promise = new Promise<T>((promiseResolve) => {
    resolve = promiseResolve;
  });
  return { promise, resolve: resolve! };
};

vi.mock('@/common', () => ({
  ipcBridge: {
    managedAssistants: {
      list: { invoke: bridgeMocks.list },
      get: { invoke: bridgeMocks.get },
      acknowledge: { invoke: bridgeMocks.acknowledge },
      markNoticeSeen: { invoke: bridgeMocks.markNoticeSeen },
    },
  },
}));

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, options?: { version?: number }) => {
      const labels: Record<string, string> = {
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
        'settings.managedTeammates.lifecycle.highImpactBody': 'Review and acknowledge this change before starting.',
        'settings.managedTeammates.lifecycle.acknowledge': 'Acknowledge change',
        'settings.managedTeammates.lifecycle.acknowledgementError': 'The change could not be acknowledged. Try again.',
        'settings.managedTeammates.lifecycle.categories.agent': 'Runtime',
        'settings.managedTeammates.lifecycle.categories.permission': 'Permissions',
        'settings.managedTeammates.lifecycle.categories.requiredSkills': 'Required capabilities',
        'settings.managedTeammates.lifecycle.categories.mcps': 'Connected tools',
        'settings.managedTeammates.lifecycle.categories.dataAccess': 'Data access',
        'settings.managedTeammates.lifecycle.categories.personalizationPolicy': 'Personal setup policy',
        'settings.managedTeammates.lifecycle.categories.content': 'Instructions and content',
        'settings.managedTeammates.lifecycle.retiringTitle': 'Planned retirement',
        'settings.managedTeammates.lifecycle.retiredTitle': 'This Teammate is retired',
        'settings.managedTeammates.lifecycle.retirementReason': 'Reason',
        'settings.managedTeammates.lifecycle.retirementCutoff': 'Cutoff',
        'settings.managedTeammates.lifecycle.retiredImmediate': 'New work is no longer available.',
        'settings.managedTeammates.lifecycle.replacement': 'Replacement',
        'settings.managedTeammates.lifecycle.viewReplacement': 'View replacement',
        'settings.managedTeammates.lifecycle.personalSetupRetained':
          'Your personal setup is retained according to company policy.',
        'settings.managedTeammates.lifecycle.temporarilyUnavailableTitle': 'Temporarily unavailable',
        'settings.managedTeammates.lifecycle.temporarilyUnavailableBody':
          'This Teammate cannot start new work right now.',
        'settings.managedTeammates.lifecycle.unavailableReasons.agent': 'Its runtime is unavailable.',
        'settings.managedTeammates.lifecycle.unavailableReasons.skill': 'A required capability is unavailable.',
        'settings.managedTeammates.lifecycle.unavailableReasons.model': 'Its approved model is unavailable.',
        'settings.managedTeammates.lifecycle.unavailableReasons.mcp': 'A required connected tool is unavailable.',
        'settings.managedTeammates.lifecycle.expectedRecovery': 'Expected recovery',
        'settings.managedTeammates.lifecycle.checkAgain': 'Check again',
        'common.close': 'Close',
      };
      if (key === 'settings.managedTeammates.version') return `Version ${options?.version ?? ''}`;
      return labels[key] ?? key;
    },
  }),
}));

const assistant: Assistant = {
  id: 'finance-close',
  source: 'managed',
  name: 'Finance Close Coordinator',
  name_i18n: { 'en-US': 'Finance Close Coordinator' },
  description: 'Coordinates close work.',
  description_i18n: {},
  enabled: true,
  sort_order: 1,
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
};

const assistantDetail: AssistantDetail = {
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
  },
  state: { enabled: true, sort_order: 1 },
  engine: { agent_id: assistant.agent_id, agent: assistant.agent },
  rules: { content: 'private rules', storage_mode: 'managed' },
  prompts: { recommended: [], recommended_i18n: {} },
  defaults: {
    model: { mode: 'fixed', value: 'private-model' },
    permission: { mode: 'fixed', value: 'private-permission' },
    thought_level: { mode: 'auto' },
    skills: { mode: 'fixed', value: ['private-skill-id'] },
    mcps: { mode: 'fixed', value: ['private-tool-id'] },
  },
  capabilities: {
    default_skill_ids: ['private-skill-id'],
    custom_skill_names: [],
    default_disabled_builtin_skill_ids: [],
  },
  preferences: { last_skill_ids: [], last_disabled_builtin_skill_ids: [], last_mcp_ids: [] },
};

const createDetail = (overrides: Partial<ManagedAssistantDetail> = {}): ManagedAssistantDetail => ({
  assistant: assistantDetail,
  governance: {
    business_owner: 'Financial Accounting',
    audience: { all_members: true, user_ids: [], summary: 'All members' },
    lifecycle: 'published',
    published_version: 3,
    release_notes: 'Current routine release notes\nwith a second line.',
    published_at: 1_788_192_000,
  },
  adoption: { active: true },
  update: {
    current_version: 3,
    last_seen_version: 2,
    acknowledged_version: 1,
    notice_pending: true,
    acknowledgement_required: false,
    change_impact: 'routine',
    changed_categories: ['content'],
  },
  start_state: { can_start_new_work: true },
  employee_brief: {
    job_summary: 'Coordinates close work.',
    job_summary_i18n: {},
    trained_for: [],
    trained_for_i18n: {},
    inputs_required: [],
    inputs_required_i18n: {},
    data_access_summary: 'Uses supplied files.',
    data_access_summary_i18n: {},
    boundaries: [],
    boundaries_i18n: {},
    human_review_requirements: [],
    human_review_requirements_i18n: {},
  },
  personalization_policy: { allowed_fields: [], optional_skill_ids: [], allowed_model_ids: [] },
  preferences: {},
  archived_preference_count: 1,
  ...overrides,
});

const renderNotices = (
  detail: ManagedAssistantDetail,
  props: Partial<React.ComponentProps<typeof ManagedLifecycleNotices>> = {}
) => {
  const defaults: React.ComponentProps<typeof ManagedLifecycleNotices> = {
    detail,
    localeKey: 'en-US',
    isMarkingNoticeSeen: false,
    isAcknowledging: false,
    mutationError: null,
    stateChanged: false,
    onMarkNoticeSeen: vi.fn(async () => undefined),
    onAcknowledge: vi.fn(async () => undefined),
    onRefresh: vi.fn(),
    onOpenReplacement: vi.fn(),
  };
  const merged = { ...defaults, ...props };
  render(
    <ConfigProvider>
      <ManagedLifecycleNotices {...merged} />
    </ConfigProvider>
  );
  return merged;
};

const ManagedLifecycleHarness: React.FC = () => {
  const onAdoptionChanged = React.useCallback(
    async () => ({ ok: true as const, authoritative: true as const, assistants: [assistant] }),
    []
  );
  const library = useManagedLibrary({
    localeKey: 'en-US',
    onAdoptionChanged,
  });

  React.useEffect(() => {
    void library.loadDetail('finance-close');
  }, [library.loadDetail]);

  if (!library.selectedDetail) return <div>Loading</div>;

  return (
    <div>
      <span data-testid='notice-pending'>{String(library.selectedDetail.update.notice_pending)}</span>
      <span data-testid='ack-required'>{String(library.selectedDetail.update.acknowledgement_required)}</span>
      <span data-testid='lifecycle-error'>{library.lifecycleMutationError ?? 'none'}</span>
      <span data-testid='state-changed'>{String(library.lifecycleStateChanged)}</span>
      <span data-testid='notice-mutation-pending'>{String(library.isMarkingNoticeSeen)}</span>
      <span data-testid='ack-mutation-pending'>{String(library.isAcknowledging)}</span>
      <button type='button' disabled={library.isMarkingNoticeSeen} onClick={() => void library.markNoticeSeen(3)}>
        Mark seen
      </button>
      <button type='button' disabled={library.isAcknowledging} onClick={() => void library.acknowledge(2)}>
        Acknowledge
      </button>
      <button
        type='button'
        onClick={() => {
          void library.markNoticeSeen(3);
          void library.markNoticeSeen(3);
        }}
      >
        Mark seen twice
      </button>
      <button
        type='button'
        onClick={() => {
          void library.acknowledge(2);
          void library.acknowledge(2);
        }}
      >
        Acknowledge twice
      </button>
    </div>
  );
};

describe('managed lifecycle state', () => {
  it('keeps a routine notice startable from backend-owned state', () => {
    const detail = createDetail();

    expect(getManagedLifecycleState(detail)).toBe('routine_update');
    expect(canStartManagedAssistant(detail)).toBe(true);
  });

  it('blocks on acknowledgement_required even when current impact is routine', () => {
    const detail = createDetail({
      update: {
        ...createDetail().update,
        acknowledgement_required: true,
        required_acknowledgement: {
          version: 2,
          release_notes: 'High-impact v2 notes',
          published_at: 1_788_105_600,
          changed_categories: ['permission'],
        },
      },
      start_state: { can_start_new_work: false, blocker: 'acknowledgement_required' },
    });

    expect(getManagedLifecycleState(detail)).toBe('acknowledgement_required');
    expect(canStartManagedAssistant(detail)).toBe(false);
  });

  it.each([
    [{ can_start_new_work: true } as const, 'planned_retirement', true],
    [{ can_start_new_work: false, blocker: 'retired' } as const, 'retired', false],
  ])('uses start_state for retirement instead of the browser clock', (startState, expectedState, expectedCanStart) => {
    const detail = createDetail({
      governance: {
        ...createDetail().governance,
        lifecycle: 'retired',
        retirement_cutoff_at: 4_102_444_800,
      },
      start_state: startState,
    });

    expect(getManagedLifecycleState(detail)).toBe(expectedState);
    expect(canStartManagedAssistant(detail)).toBe(expectedCanStart);
  });
});

describe('ManagedLifecycleNotices', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('does not mark a routine notice seen until the employee acts', () => {
    const props = renderNotices(createDetail());

    expect(screen.getByText('This Teammate was updated')).toBeInTheDocument();
    expect(screen.getByText(/Current routine release notes/)).toBeInTheDocument();
    expect(props.onMarkNoticeSeen).not.toHaveBeenCalled();
    expect(screen.queryByText('private rules')).not.toBeInTheDocument();
    expect(screen.queryByText('private-tool-id')).not.toBeInTheDocument();
  });

  it('dismisses and reviews the exact current version', async () => {
    const onMarkNoticeSeen = vi.fn(async () => undefined);
    renderNotices(createDetail(), { onMarkNoticeSeen });

    await userEvent.click(screen.getByRole('button', { name: 'Dismiss' }));
    expect(onMarkNoticeSeen).toHaveBeenLastCalledWith(3);

    await userEvent.click(screen.getByRole('button', { name: 'Review update' }));
    expect(await screen.findByRole('dialog', { name: 'This Teammate was updated' })).toBeInTheDocument();
    expect(onMarkNoticeSeen).toHaveBeenLastCalledWith(3);
  });

  it('acknowledges exact v2 notes while the current routine notice is v3', async () => {
    const onAcknowledge = vi.fn(async () => undefined);
    const detail = createDetail({
      update: {
        ...createDetail().update,
        acknowledgement_required: true,
        required_acknowledgement: {
          version: 2,
          release_notes: 'High-impact v2 notes',
          published_at: 1_788_105_600,
          changed_categories: ['permission', 'required_skills'],
        },
      },
      start_state: { can_start_new_work: false, blocker: 'acknowledgement_required' },
    });
    renderNotices(detail, { onAcknowledge });

    expect(screen.getByText('High-impact v2 notes')).toBeInTheDocument();
    expect(screen.getByText('Version 2')).toBeInTheDocument();
    expect(screen.getByText(/Aug 30, 2026/)).toBeInTheDocument();
    expect(screen.queryByText('Version 3')).not.toBeInTheDocument();
    expect(screen.queryByText(/Aug 31, 2026/)).not.toBeInTheDocument();
    expect(screen.getByText('Permissions')).toBeInTheDocument();
    expect(screen.getByText('Required capabilities')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Acknowledge change' }));

    expect(onAcknowledge).toHaveBeenCalledWith(2);
    expect(screen.queryByText('private-permission')).not.toBeInTheDocument();
  });

  it('serializes notice and acknowledgement actions while either mutation is pending', () => {
    const detail = createDetail({
      update: {
        ...createDetail().update,
        acknowledgement_required: true,
        required_acknowledgement: {
          version: 2,
          release_notes: 'High-impact v2 notes',
          published_at: 1_788_105_600,
          changed_categories: ['permission'],
        },
      },
      start_state: { can_start_new_work: false, blocker: 'acknowledgement_required' },
    });
    renderNotices(detail, { isMarkingNoticeSeen: true });

    expect(screen.getByRole('button', { name: 'Review update' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Dismiss' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Acknowledge change' })).toBeDisabled();
  });

  it('shows state-changed and retry copy without hiding the surface', async () => {
    const onRefresh = vi.fn();
    renderNotices(createDetail(), { mutationError: 'notice', stateChanged: true, onRefresh });

    expect(screen.getByText('The Teammate changed while you were reviewing it.')).toBeInTheDocument();
    expect(screen.getByText('This Teammate was updated')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Check again' }));
    expect(onRefresh).toHaveBeenCalledTimes(1);
  });

  it('shows retirement reason, absolute cutoff, retained setup, and an optional replacement', async () => {
    const onOpenReplacement = vi.fn();
    const detail = createDetail({
      governance: {
        ...createDetail().governance,
        lifecycle: 'retired',
        retirement_reason: 'Replaced after the finance process changed.',
        retirement_cutoff_at: 1_799_712_000,
        replacement_assistant_id: 'finance-close-v2',
      },
      start_state: { can_start_new_work: false, blocker: 'retired' },
    });
    renderNotices(detail, { onOpenReplacement });

    expect(screen.getByText('Replaced after the finance process changed.')).toBeInTheDocument();
    expect(screen.getByText('Your personal setup is retained according to company policy.')).toBeInTheDocument();
    expect(screen.getByText(/2027/)).toBeInTheDocument();
    expect(screen.queryByText(/export/i)).not.toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'View replacement' }));
    expect(onOpenReplacement).toHaveBeenCalledWith('finance-close-v2');
  });

  it('omits replacement and recovery actions when backend metadata is absent', () => {
    renderNotices(
      createDetail({
        governance: {
          ...createDetail().governance,
          lifecycle: 'retired',
          retirement_reason: 'No longer supported.',
        },
        start_state: { can_start_new_work: false, blocker: 'retired' },
      })
    );

    expect(screen.queryByRole('button', { name: 'View replacement' })).not.toBeInTheDocument();
    expect(screen.queryByText('Expected recovery')).not.toBeInTheDocument();
  });

  it.each([
    ['agent', 'Its runtime is unavailable.'],
    ['skill', 'A required capability is unavailable.'],
    ['model', 'Its approved model is unavailable.'],
    ['mcp', 'A required connected tool is unavailable.'],
  ] as const)('renders only safe temporary-unavailability reason %s', (reason, copy) => {
    renderNotices(
      createDetail({
        start_state: {
          can_start_new_work: false,
          blocker: 'temporarily_unavailable',
          unavailable_reason: reason,
        },
      })
    );

    expect(screen.getByText(copy)).toBeInTheDocument();
    expect(screen.queryByText('private-model')).not.toBeInTheDocument();
  });

  it('renders recovery only when supplied and closes review with keyboard focus restored', async () => {
    renderNotices(
      createDetail({
        start_state: {
          can_start_new_work: false,
          blocker: 'temporarily_unavailable',
          unavailable_reason: 'agent',
          expected_recovery_at: 1_799_712_000,
        },
      })
    );
    expect(screen.getByText(/Expected recovery/)).toBeInTheDocument();

    const routine = renderNotices(createDetail());
    const review = screen.getAllByRole('button', { name: 'Review update' }).at(-1);
    if (!review) throw new Error('Review action missing');
    await userEvent.click(review);
    await screen.findByRole('dialog', { name: 'This Teammate was updated' });
    await userEvent.keyboard('{Escape}');
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
    expect(review).toHaveFocus();
    expect(routine.onMarkNoticeSeen).toHaveBeenCalledWith(3);
  });
});

describe('managed lifecycle mutations', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    bridgeMocks.list.mockResolvedValue([]);
    bridgeMocks.get.mockResolvedValue(createDetail());
  });

  it('posts the exact current notice version and replaces state from the complete response', async () => {
    bridgeMocks.markNoticeSeen.mockResolvedValue(
      createDetail({ update: { ...createDetail().update, notice_pending: false, last_seen_version: 3 } })
    );
    render(<ManagedLifecycleHarness />);

    await userEvent.click(await screen.findByRole('button', { name: 'Mark seen' }));

    expect(bridgeMocks.markNoticeSeen).toHaveBeenCalledWith({ id: 'finance-close', locale: 'en-US', version: 3 });
    expect(screen.getByTestId('notice-pending')).toHaveTextContent('false');
  });

  it('posts required v2 and leaves the independent current v3 notice pending', async () => {
    const requiredDetail = createDetail({
      update: {
        ...createDetail().update,
        acknowledgement_required: true,
        required_acknowledgement: {
          version: 2,
          release_notes: 'High-impact v2 notes',
          published_at: 1_788_105_600,
          changed_categories: ['permission'],
        },
      },
      start_state: { can_start_new_work: false, blocker: 'acknowledgement_required' },
    });
    bridgeMocks.get.mockResolvedValue(requiredDetail);
    bridgeMocks.acknowledge.mockResolvedValue(
      createDetail({
        update: {
          ...requiredDetail.update,
          acknowledgement_required: false,
          acknowledged_version: 2,
          required_acknowledgement: undefined,
        },
      })
    );
    render(<ManagedLifecycleHarness />);

    await userEvent.click(await screen.findByRole('button', { name: 'Acknowledge' }));

    expect(bridgeMocks.acknowledge).toHaveBeenCalledWith({ id: 'finance-close', locale: 'en-US', version: 2 });
    expect(screen.getByTestId('ack-required')).toHaveTextContent('false');
    expect(screen.getByTestId('notice-pending')).toHaveTextContent('true');
  });

  it.each([
    ['notice', 'MANAGED_ASSISTANT_NOTICE_VERSION_MISMATCH'],
    ['acknowledgement', 'MANAGED_ASSISTANT_ACK_VERSION_MISMATCH'],
  ] as const)('refetches and preserves the %s surface after a version mismatch', async (mutation, code) => {
    const mismatch = new BackendHttpError({
      method: 'POST',
      path: '/api/managed-assistants/finance-close',
      status: 409,
      body: { code, error: 'private backend message' },
    });
    const refreshed = createDetail({ governance: { ...createDetail().governance, published_version: 4 } });
    bridgeMocks.get.mockResolvedValueOnce(createDetail()).mockResolvedValueOnce(refreshed);
    bridgeMocks[mutation === 'notice' ? 'markNoticeSeen' : 'acknowledge'].mockRejectedValue(mismatch);
    render(<ManagedLifecycleHarness />);

    await userEvent.click(
      await screen.findByRole('button', { name: mutation === 'notice' ? 'Mark seen' : 'Acknowledge' })
    );

    await waitFor(() => expect(bridgeMocks.get).toHaveBeenCalledTimes(2));
    expect(screen.getByTestId('state-changed')).toHaveTextContent('true');
    expect(screen.getByTestId('notice-pending')).toHaveTextContent('true');
  });

  it('keeps state and enables retry after an ordinary mutation failure', async () => {
    bridgeMocks.markNoticeSeen.mockRejectedValue(new Error('private failure'));
    render(<ManagedLifecycleHarness />);

    await userEvent.click(await screen.findByRole('button', { name: 'Mark seen' }));

    expect(await screen.findByTestId('lifecycle-error')).toHaveTextContent('notice');
    expect(screen.getByTestId('notice-pending')).toHaveTextContent('true');
    expect(screen.queryByText('private failure')).not.toBeInTheDocument();
  });

  it('ignores a late notice response after a newer acknowledgement mutation', async () => {
    const required = createDetail({
      update: {
        ...createDetail().update,
        acknowledgement_required: true,
        required_acknowledgement: {
          version: 2,
          release_notes: 'High-impact v2 notes',
          published_at: 1_788_105_600,
          changed_categories: ['permission'],
        },
      },
      start_state: { can_start_new_work: false, blocker: 'acknowledgement_required' },
    });
    const noticeRequest = deferred<ManagedAssistantDetail>();
    const acknowledgementRequest = deferred<ManagedAssistantDetail>();
    bridgeMocks.get.mockResolvedValue(required);
    bridgeMocks.markNoticeSeen.mockReturnValue(noticeRequest.promise);
    bridgeMocks.acknowledge.mockReturnValue(acknowledgementRequest.promise);
    render(<ManagedLifecycleHarness />);

    await userEvent.click(await screen.findByRole('button', { name: 'Mark seen' }));
    await userEvent.click(screen.getByRole('button', { name: 'Acknowledge' }));
    acknowledgementRequest.resolve(
      createDetail({
        update: {
          ...required.update,
          acknowledgement_required: false,
          required_acknowledgement: undefined,
          notice_pending: true,
        },
        start_state: { can_start_new_work: true },
      })
    );
    await waitFor(() => expect(screen.getByTestId('ack-required')).toHaveTextContent('false'));
    noticeRequest.resolve(
      createDetail({
        update: { ...required.update, notice_pending: false },
      })
    );

    await act(async () => {
      await noticeRequest.promise;
    });
    expect(screen.getByTestId('ack-required')).toHaveTextContent('false');
    expect(screen.getByTestId('notice-pending')).toHaveTextContent('true');
    expect(screen.getByTestId('notice-mutation-pending')).toHaveTextContent('false');
    expect(screen.getByTestId('ack-mutation-pending')).toHaveTextContent('false');
  });

  it.each([
    ['notice', 'Mark seen twice', 'notice-mutation-pending', 'Mark seen'],
    ['acknowledgement', 'Acknowledge twice', 'ack-mutation-pending', 'Acknowledge'],
  ] as const)(
    'keeps the %s action pending until the newest same-kind mutation settles',
    async (kind, triggerName, pendingTestId, actionName) => {
      const firstRequest = deferred<ManagedAssistantDetail>();
      const secondRequest = deferred<ManagedAssistantDetail>();
      const mutation = kind === 'notice' ? bridgeMocks.markNoticeSeen : bridgeMocks.acknowledge;
      mutation.mockReturnValueOnce(firstRequest.promise).mockReturnValueOnce(secondRequest.promise);
      render(<ManagedLifecycleHarness />);

      await userEvent.click(await screen.findByRole('button', { name: triggerName }));
      expect(screen.getByTestId(pendingTestId)).toHaveTextContent('true');
      expect(screen.getByRole('button', { name: actionName })).toBeDisabled();

      firstRequest.resolve(createDetail());
      await act(async () => {
        await firstRequest.promise;
      });
      expect(screen.getByTestId(pendingTestId)).toHaveTextContent('true');
      expect(screen.getByRole('button', { name: actionName })).toBeDisabled();

      secondRequest.resolve(createDetail());
      await act(async () => {
        await secondRequest.promise;
      });
      expect(screen.getByTestId(pendingTestId)).toHaveTextContent('false');
      expect(screen.getByRole('button', { name: actionName })).toBeEnabled();
    }
  );
});
