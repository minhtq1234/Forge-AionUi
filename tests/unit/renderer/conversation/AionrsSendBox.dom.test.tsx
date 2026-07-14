import React from 'react';
import { act, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import AionrsSendBox from '@/renderer/pages/conversation/platforms/aionrs/AionrsSendBox';
import type { AionrsModelSelection } from '@/renderer/pages/conversation/platforms/aionrs/useAionrsModelSelection';

type AionrsMessageStateMock = {
  thought: {
    subject: string;
    description: string;
  };
  running: boolean;
  setActiveMsgId: ReturnType<typeof vi.fn>;
  setWaitingResponse: ReturnType<typeof vi.fn>;
  resetState: ReturnType<typeof vi.fn>;
  tokenUsage: { total_tokens: number } | null;
};

type RuntimeViewStateMock = {
  hydrated: boolean;
  canSendMessage: boolean;
  isProcessing: boolean;
  state: string;
  activeTurnId: string | null;
  markSendStarted: ReturnType<typeof vi.fn>;
  markSendAccepted: ReturnType<typeof vi.fn>;
  markSendFailed: ReturnType<typeof vi.fn>;
  markStopRequested: ReturnType<typeof vi.fn>;
  markStopAcknowledged: ReturnType<typeof vi.fn>;
  resetLocalGate: ReturnType<typeof vi.fn>;
};

type ThoughtDisplayPropsMock = {
  thought?: {
    subject: string;
    description: string;
  };
  running?: boolean;
  onStop?: () => void;
};

const {
  aionrsMessageState,
  checkAndUpdateTitleMock,
  createAionrsMessageState,
  createRuntimeViewState,
  emitMock,
  enqueueMock,
  ensureConversationRuntimeMock,
  messageErrorMock,
  runtimeViewState,
  sendMessageInvokeMock,
  thoughtDisplayProps,
  translateMock,
  useTeamPermissionMock,
  setSendBoxHandlerMock,
  contextUsageIndicatorProps,
  sendBoxProps,
} = vi.hoisted(() => ({
  checkAndUpdateTitleMock: vi.fn(),
  createAionrsMessageState: (): AionrsMessageStateMock => ({
    thought: { subject: '', description: '' },
    running: false,
    setActiveMsgId: vi.fn(),
    setWaitingResponse: vi.fn(),
    resetState: vi.fn(),
    tokenUsage: null,
  }),
  createRuntimeViewState: (): RuntimeViewStateMock => ({
    hydrated: true,
    canSendMessage: true,
    isProcessing: false,
    state: 'idle',
    activeTurnId: null,
    markSendStarted: vi.fn(),
    markSendAccepted: vi.fn(),
    markSendFailed: vi.fn(),
    markStopRequested: vi.fn(),
    markStopAcknowledged: vi.fn(),
    resetLocalGate: vi.fn(),
  }),
  emitMock: vi.fn(),
  enqueueMock: vi.fn(),
  ensureConversationRuntimeMock: vi.fn().mockResolvedValue({ recovered: false, config_options: [], runtime: null }),
  messageErrorMock: vi.fn(),
  aionrsMessageState: { current: undefined as AionrsMessageStateMock | undefined },
  runtimeViewState: { current: undefined as RuntimeViewStateMock | undefined },
  sendMessageInvokeMock: vi.fn().mockResolvedValue(undefined),
  thoughtDisplayProps: { current: null as ThoughtDisplayPropsMock | null },
  translateMock: (key: string, options?: { defaultValue?: string }) => options?.defaultValue ?? key,
  useTeamPermissionMock: vi.fn(),
  setSendBoxHandlerMock: vi.fn(),
  contextUsageIndicatorProps: {
    current: null as {
      tokenUsage: { total_tokens: number } | null;
      localUsage: { today: number; weekToDate: number; monthToDate: number };
      context_limit?: number;
    } | null,
  },
  sendBoxProps: {
    current: null as {
      tokenUsage?: unknown;
      localUsage?: unknown;
      context_limit?: unknown;
    } | null,
  },
}));

vi.mock('@/common', () => ({
  ipcBridge: {
    conversation: {
      sendMessage: {
        invoke: sendMessageInvokeMock,
      },
      stop: {
        invoke: vi.fn().mockResolvedValue(undefined),
      },
    },
  },
}));

vi.mock('@/renderer/components/chat/SendBox', () => ({
  default: ({
    enableContextCommand,
    onSend,
    onChange,
    rightTools,
    ...props
  }: {
    enableContextCommand?: boolean;
    onSend: (message: string) => Promise<void>;
    onChange?: (value: string) => void;
    rightTools?: React.ReactNode;
  }) =>
    (() => {
      sendBoxProps.current = props;
      return (
        <div>
          {rightTools}
          <span data-testid='context-command-enabled'>{String(Boolean(enableContextCommand))}</span>
          <button type='button' onClick={() => onChange?.('hello')}>
            change
          </button>
          <button type='button' onClick={() => void onSend('Hello').catch(() => {})}>
            send
          </button>
          <button type='button' onClick={() => void onSend('/context compact').catch(() => {})}>
            compact context
          </button>
          <button type='button' onClick={() => void onSend('/context pin').catch(() => {})}>
            invalid context
          </button>
        </div>
      );
    })(),
}));

vi.mock('@/renderer/components/agent/AgentModeSelector', () => ({
  default: () => <span data-testid='composer-permission-control' />,
}));
vi.mock('@/renderer/components/agent/ContextUsageIndicator', () => ({
  default: (props: {
    tokenUsage: { total_tokens: number } | null;
    localUsage: { today: number; weekToDate: number; monthToDate: number };
    context_limit?: number;
  }) => {
    contextUsageIndicatorProps.current = props;
    return props.tokenUsage ? <span data-testid='context-usage-indicator' /> : null;
  },
}));
vi.mock('@/renderer/components/chat/CommandQueuePanel', () => ({ default: () => null }));
vi.mock('@/renderer/components/chat/MobileActionSheet', () => ({
  default: () => null,
  useAttachEntry: () => ({ entries: [], hiddenFileInput: null }),
}));
vi.mock('@/renderer/components/chat/ThoughtDisplay', () => ({
  default: (props: ThoughtDisplayPropsMock) => {
    thoughtDisplayProps.current = props;
    if (!props.running && !props.thought?.subject) {
      return null;
    }
    return <div data-testid='thought-display'>processing</div>;
  },
}));
vi.mock('@/renderer/components/media/FileAttachButton', () => ({ default: () => null }));
vi.mock('@/renderer/components/media/FilePreview', () => ({ default: () => null }));
vi.mock('@/renderer/components/media/HorizontalFileList', () => ({
  default: ({ children }: { children?: React.ReactNode }) => <>{children}</>,
}));
vi.mock('@/renderer/hooks/agent/useAcpConfigOptions', () => ({
  classifyConfigSetError: () => 'unknown',
  useAcpConfigOptions: () => ({
    setStatus: { state: 'idle' },
    mode: null,
    model: null,
    thoughtLevel: null,
    reload: vi.fn(),
    setConfigOption: vi.fn(),
  }),
}));
vi.mock('@/renderer/hooks/context/ConversationContext', () => ({
  useConversationContextSafe: () => ({
    loadedSkills: [],
    loadedMcpStatuses: [],
  }),
}));
vi.mock('@/renderer/hooks/context/LayoutContext', () => ({
  useLayoutContext: () => ({ isMobile: false }),
}));
vi.mock('@/renderer/hooks/useLocalTokenUsage', () => ({
  useLocalTokenUsage: () => ({ today: 120, weekToDate: 560, monthToDate: 1_240 }),
}));
vi.mock('@/renderer/hooks/chat/useAutoTitle', () => ({
  useAutoTitle: () => ({
    checkAndUpdateTitle: checkAndUpdateTitleMock,
  }),
}));
vi.mock('@/renderer/hooks/chat/useSendBoxDraft', () => ({
  getSendBoxDraftHook: () => () => ({
    data: {
      atPath: [],
      uploadFile: [],
      content: '',
    },
    mutate: vi.fn(),
  }),
}));
vi.mock('@/renderer/hooks/chat/useSendBoxFiles', () => ({
  useSendBoxFiles: () => ({
    handleFilesAdded: vi.fn(),
    clearFiles: vi.fn(),
  }),
  createSetUploadFile: () => vi.fn(),
}));
vi.mock('@/renderer/hooks/chat/useSlashCommands', () => ({
  useSlashCommands: () => [],
}));
vi.mock('@/renderer/hooks/file/useOpenFileSelector', () => ({
  useOpenFileSelector: () => ({
    openFileSelector: vi.fn(),
    onSlashBuiltinCommand: vi.fn(),
  }),
}));
vi.mock('@/renderer/hooks/ui/useLatestRef', () => ({
  useLatestRef: <T,>(value: T) => ({ current: value }),
}));
vi.mock('@/renderer/pages/conversation/platforms/useConversationCommandQueue', () => ({
  shouldEnqueueConversationCommand: () => false,
  useConversationCommandQueue: () => ({
    items: [],
    isPaused: false,
    isInteractionLocked: false,
    hasPendingCommands: false,
    enqueue: enqueueMock,
    remove: vi.fn(),
    clear: vi.fn(),
    reorder: vi.fn(),
    pause: vi.fn(),
    resume: vi.fn(),
    lockInteraction: vi.fn(),
    unlockInteraction: vi.fn(),
    resetActiveExecution: vi.fn(),
  }),
}));
vi.mock('@/renderer/pages/conversation/runtime/useConversationRuntimeView', () => ({
  useConversationRuntimeView: () => runtimeViewState.current,
}));
vi.mock('@/renderer/pages/conversation/utils/conversationCache', () => ({
  getConversationOrNull: vi.fn().mockResolvedValue({
    extra: {
      workspace: '/tmp/workspace',
    },
  }),
}));
vi.mock('@/renderer/pages/conversation/utils/conversationCreateError', () => ({
  getConversationRuntimeWorkspaceErrorMessage: () => 'workspace failed',
}));
vi.mock('@/renderer/pages/conversation/utils/ensureConversationRuntime', () => ({
  ensureConversationRuntime: ensureConversationRuntimeMock,
}));
vi.mock('@/renderer/pages/conversation/Preview', () => ({
  usePreviewContext: () => ({
    setSendBoxHandler: setSendBoxHandlerMock,
  }),
}));
vi.mock('@/renderer/pages/team/hooks/TeamPermissionContext', () => ({
  useTeamPermission: useTeamPermissionMock,
}));
vi.mock('@/renderer/services/FileService', () => ({
  allSupportedExts: [],
}));
vi.mock('@/renderer/utils/emitter', () => ({
  emitter: {
    emit: emitMock,
  },
  useAddEventListener: vi.fn(),
}));
vi.mock('@/renderer/utils/file/fileSelection', () => ({
  mergeFileSelectionItems: vi.fn((items: unknown[]) => items),
}));
vi.mock('@/renderer/utils/file/messageFiles', () => ({
  buildDisplayMessage: (input: string) => input,
  collectSelectedFiles: () => [],
}));
vi.mock('@arco-design/web-react', () => ({
  Message: {
    warning: vi.fn(),
    error: messageErrorMock,
    success: vi.fn(),
  },
  Tag: ({ children }: { children?: React.ReactNode }) => <>{children}</>,
}));
vi.mock('@icon-park/react', () => ({
  Brain: () => null,
  MagicHat: () => null,
  Shield: () => null,
}));
vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: translateMock }),
}));
vi.mock('@/renderer/pages/conversation/platforms/aionrs/useAionrsMessage', () => ({
  useAionrsMessage: () => aionrsMessageState.current,
}));

const modelSelection = {
  current_model: {
    provider_id: 'openai',
    model: 'gpt-4.1',
    use_model: 'openai/gpt-4.1',
  },
} as AionrsModelSelection;

describe('AionrsSendBox', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    aionrsMessageState.current = createAionrsMessageState();
    runtimeViewState.current = createRuntimeViewState();
    thoughtDisplayProps.current = null;
    contextUsageIndicatorProps.current = null;
    sendBoxProps.current = null;
    ensureConversationRuntimeMock.mockResolvedValue({ recovered: false, config_options: [], runtime: null });
    useTeamPermissionMock.mockReturnValue(null);
  });

  it('does not warm up team session when draft content changes', async () => {
    const warmupSession = vi.fn().mockResolvedValue(undefined);
    useTeamPermissionMock.mockReturnValue({
      isTeamMode: true,
      isLeaderAgent: true,
      leaderConversationId: 'conv-1',
      allConversationIds: ['conv-1'],
      propagateMode: vi.fn(),
      warmupSession,
    });

    render(<AionrsSendBox conversation_id='conv-1' modelSelection={modelSelection} />);
    await waitFor(() => {
      expect(warmupSession).toHaveBeenCalled();
    });
    warmupSession.mockClear();

    await act(async () => {
      screen.getByRole('button', { name: 'change' }).click();
    });

    expect(warmupSession).not.toHaveBeenCalled();
  });

  it('still warms up team session before sending', async () => {
    const warmupSession = vi.fn().mockResolvedValue(undefined);
    useTeamPermissionMock.mockReturnValue({
      isTeamMode: true,
      isLeaderAgent: true,
      leaderConversationId: 'conv-1',
      allConversationIds: ['conv-1'],
      propagateMode: vi.fn(),
      warmupSession,
    });

    render(<AionrsSendBox conversation_id='conv-1' modelSelection={modelSelection} />);
    await waitFor(() => {
      expect(warmupSession).toHaveBeenCalled();
    });
    warmupSession.mockClear();

    await act(async () => {
      screen.getByRole('button', { name: 'send' }).click();
    });

    await waitFor(() => {
      expect(warmupSession).toHaveBeenCalledTimes(1);
    });
  });

  it('uses runtime ensure instead of legacy warmup for standalone runtime preparation', async () => {
    render(<AionrsSendBox conversation_id='conv-1' modelSelection={modelSelection} />);

    await waitFor(() => {
      expect(ensureConversationRuntimeMock).toHaveBeenCalledWith('conv-1');
    });
  });

  it('renders model and permission controls in the composer action row', () => {
    render(
      <AionrsSendBox
        conversation_id='conv-1'
        modelSelection={modelSelection}
        modelSelector={<span data-testid='composer-model-selector'>Model</span>}
      />
    );

    expect(screen.getByTestId('composer-model-selector')).toBeInTheDocument();
    expect(screen.getByTestId('composer-permission-control')).toBeInTheDocument();
  });

  it('renders the context usage meter in right tools with AionRS usage data', () => {
    aionrsMessageState.current = {
      ...createAionrsMessageState(),
      tokenUsage: { total_tokens: 12_000 },
    };

    const miniMaxSelection = {
      current_model: {
        provider_id: 'minimax',
        model: 'MiniMax-M2.5',
        use_model: 'minimax/MiniMax-M2.5',
      },
    } as AionrsModelSelection;

    render(<AionrsSendBox conversation_id='conv-1' modelSelection={miniMaxSelection} />);

    expect(screen.getByTestId('context-usage-indicator')).toBeInTheDocument();
    expect(contextUsageIndicatorProps.current).toEqual({
      tokenUsage: { total_tokens: 12_000 },
      localUsage: { today: 120, weekToDate: 560, monthToDate: 1_240 },
      context_limit: 204_800,
    });
    expect(screen.getByRole('button', { name: 'send' })).toBeInTheDocument();
    expect(sendBoxProps.current).not.toHaveProperty('tokenUsage');
    expect(sendBoxProps.current).not.toHaveProperty('localUsage');
    expect(sendBoxProps.current).not.toHaveProperty('context_limit');
  });

  it('does not render a context usage meter when AionRS usage is unavailable', () => {
    render(<AionrsSendBox conversation_id='conv-1' modelSelection={modelSelection} />);

    expect(screen.queryByTestId('context-usage-indicator')).not.toBeInTheDocument();
  });
  it('hides stale processing when the hydrated runtime view is idle', () => {
    aionrsMessageState.current = {
      ...createAionrsMessageState(),
      running: true,
    };
    runtimeViewState.current = {
      ...createRuntimeViewState(),
      hydrated: true,
      isProcessing: false,
      canSendMessage: true,
      state: 'idle',
    };

    render(<AionrsSendBox conversation_id='conv-1' modelSelection={modelSelection} />);

    expect(screen.queryByTestId('thought-display')).not.toBeInTheDocument();
    expect(thoughtDisplayProps.current?.running).toBe(false);
  });

  it('shows processing while the hydrated runtime view is processing', () => {
    aionrsMessageState.current = createAionrsMessageState();
    runtimeViewState.current = {
      ...createRuntimeViewState(),
      hydrated: true,
      isProcessing: true,
      canSendMessage: false,
      state: 'running',
    };

    render(<AionrsSendBox conversation_id='conv-1' modelSelection={modelSelection} />);

    expect(screen.getByTestId('thought-display')).toBeInTheDocument();
    expect(thoughtDisplayProps.current?.running).toBe(true);
  });

  it('advertises the native context command in the shared slash menu', () => {
    render(<AionrsSendBox conversation_id='conv-1' modelSelection={modelSelection} />);

    expect(screen.getByTestId('context-command-enabled')).toHaveTextContent('true');
  });

  it('intercepts valid context commands before queueing or sending a chat turn', async () => {
    render(<AionrsSendBox conversation_id='conv-1' modelSelection={modelSelection} />);

    await act(async () => {
      screen.getByRole('button', { name: 'compact context' }).click();
    });

    expect(emitMock).toHaveBeenCalledWith('aionrs.context-command', {
      conversationId: 'conv-1',
      command: { action: 'compact' },
    });
    expect(enqueueMock).not.toHaveBeenCalled();
    expect(sendMessageInvokeMock).not.toHaveBeenCalled();
    expect(checkAndUpdateTitleMock).not.toHaveBeenCalled();
  });

  it('shows a localized validation error without sending invalid context commands', async () => {
    render(<AionrsSendBox conversation_id='conv-1' modelSelection={modelSelection} />);

    await act(async () => {
      screen.getByRole('button', { name: 'invalid context' }).click();
    });

    expect(messageErrorMock).toHaveBeenCalledWith('conversation.contextHandoff.command.missingPinText');
    expect(emitMock).not.toHaveBeenCalledWith('aionrs.context-command', expect.anything());
    expect(enqueueMock).not.toHaveBeenCalled();
    expect(sendMessageInvokeMock).not.toHaveBeenCalled();
  });
});
