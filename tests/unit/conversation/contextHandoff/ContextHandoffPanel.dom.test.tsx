import type { TChatConversation } from '@/common/config/storage';
import ContextHandoffPanel from '@/renderer/pages/conversation/contextHandoff/ContextHandoffPanel';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import React from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  addToSendBox: vi.fn(),
  createWithConversation: vi.fn(),
  emit: vi.fn(),
  findPreviewTab: vi.fn(),
  getConversationOrNull: vi.fn(),
  navigate: vi.fn(),
  openPreview: vi.fn(),
  readFile: vi.fn(),
  saveContent: vi.fn(),
  updateConversation: vi.fn(),
  useMessageList: vi.fn(() => []),
  writeFile: vi.fn(),
}));

type MockButtonProps = Omit<React.ButtonHTMLAttributes<HTMLButtonElement>, 'type'> & {
  icon?: React.ReactNode;
  loading?: boolean;
  size?: string;
  status?: string;
  type?: string;
};

type MockInputProps = {
  autoSize?: unknown;
  placeholder?: string;
  value?: string;
  onChange?: (value: string) => void;
};

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, options?: Record<string, string>) => (options?.name ? `${key}:${options.name}` : key),
  }),
}));

vi.mock('react-router-dom', () => ({
  useNavigate: () => mocks.navigate,
}));

vi.mock('@/common', () => ({
  ipcBridge: {
    conversation: {
      createWithConversation: { invoke: mocks.createWithConversation },
      update: { invoke: mocks.updateConversation },
    },
    fs: {
      readFile: { invoke: mocks.readFile },
      writeFile: { invoke: mocks.writeFile },
    },
  },
}));

vi.mock('@/common/utils', () => ({
  uuid: () => 'uuid-1',
}));

vi.mock('@/renderer/pages/conversation/Messages/hooks', () => ({
  useMessageList: () => mocks.useMessageList(),
}));

vi.mock('@/renderer/pages/conversation/Preview', () => ({
  usePreviewContext: () => ({
    addToSendBox: mocks.addToSendBox,
    findPreviewTab: mocks.findPreviewTab,
    openPreview: mocks.openPreview,
    saveContent: mocks.saveContent,
  }),
}));

vi.mock('@/renderer/pages/conversation/utils/conversationCache', () => ({
  getConversationOrNull: mocks.getConversationOrNull,
}));

vi.mock('@/renderer/pages/conversation/utils/conversationCreateError', () => ({
  getConversationCreateErrorMessage: () => 'conversation.create.error',
}));

vi.mock('@/renderer/pages/conversation/contextHandoff/contextMessages', () => ({
  loadContextHandoffMessages: vi.fn(async () => []),
  selectContextHandoffMessages: (liveMessages: unknown[], loadedMessages: unknown[]) =>
    liveMessages.length > 0 ? liveMessages : loadedMessages,
}));

vi.mock('@/renderer/utils/emitter', () => ({
  emitter: { emit: mocks.emit },
  useAddEventListener: vi.fn(),
}));

vi.mock('@arco-design/web-react', () => {
  const Input = Object.assign(
    ({ placeholder, value = '', onChange }: MockInputProps) => (
      <input placeholder={placeholder} value={value} onChange={(event) => onChange?.(event.currentTarget.value)} />
    ),
    {
      TextArea: ({ placeholder, value = '', onChange }: MockInputProps) => (
        <textarea placeholder={placeholder} value={value} onChange={(event) => onChange?.(event.currentTarget.value)} />
      ),
    }
  );

  return {
    Button: ({
      children,
      className,
      icon,
      loading,
      onClick,
      size: _size,
      status: _status,
      type: _type,
      ...props
    }: React.PropsWithChildren<MockButtonProps>) => (
      <button className={className} disabled={loading} onClick={onClick} {...props}>
        {icon}
        {children}
      </button>
    ),
    Input,
    Message: {
      error: vi.fn(),
      success: vi.fn(),
      warning: vi.fn(),
    },
    Modal: ({ children, visible }: React.PropsWithChildren<{ visible: boolean }>) =>
      visible ? <div role='dialog'>{children}</div> : null,
    Progress: ({ percent }: { percent?: number }) => <div aria-valuenow={percent ?? 0} role='progressbar' />,
    Space: ({
      children,
    }: React.PropsWithChildren<{ size?: number | string; direction?: string; className?: string }>) => (
      <div>{children}</div>
    ),
    Tooltip: ({ children }: React.PropsWithChildren<{ content?: React.ReactNode }>) => <>{children}</>,
    Typography: {
      Paragraph: ({ children }: React.PropsWithChildren<{ className?: string; ellipsis?: unknown }>) => (
        <p>{children}</p>
      ),
    },
  };
});

vi.mock('@icon-park/react', () => {
  const Icon = () => <span aria-hidden='true' />;
  return {
    Add: Icon,
    Attention: Icon,
    Delete: Icon,
    Edit: Icon,
    FileText: Icon,
    Magic: Icon,
    Pin: Icon,
    Transfer: Icon,
  };
});

const conversation: TChatConversation = {
  created_at: 1,
  extra: {
    backend: 'aionrs',
    context_handoff: {
      context_file_name: 'Context.md',
      context_file_path: '/workspace/Context.md',
    },
    last_context_limit: 100_000,
    last_token_usage: { total_tokens: 9_000 },
    workspace: '/workspace',
  },
  id: 'conversation-1',
  model: {
    api_key: '',
    base_url: '',
    id: 'model-1',
    name: 'OpenAI',
    platform: 'openai',
    use_model: 'gpt-4.1',
  },
  modified_at: 1,
  name: 'Source chat',
  type: 'aionrs',
};

describe('ContextHandoffPanel', () => {
  beforeEach(() => {
    mocks.addToSendBox.mockClear();
    mocks.createWithConversation.mockClear();
    mocks.emit.mockClear();
    mocks.findPreviewTab.mockReset();
    mocks.getConversationOrNull.mockResolvedValue(conversation);
    mocks.navigate.mockClear();
    mocks.openPreview.mockClear();
    mocks.readFile.mockResolvedValue('# Edited context');
    mocks.saveContent.mockClear();
    mocks.updateConversation.mockResolvedValue(true);
    mocks.useMessageList.mockReturnValue([]);
    mocks.writeFile.mockResolvedValue(true);
  });

  afterEach(() => {
    cleanup();
  });

  it('opens Context.md from the file tile without showing standalone context actions', async () => {
    const onPreviewOpen = vi.fn();
    render(
      <ContextHandoffPanel conversationId='conversation-1' workspace='/workspace' onPreviewOpen={onPreviewOpen} />
    );

    const contextTile = await screen.findByRole('button', { name: /Context\.md/ });

    expect(screen.queryByRole('button', { name: /conversation\.contextHandoff\.open/ })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /conversation\.contextHandoff\.improve/ })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /conversation\.contextHandoff\.continue/ })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /conversation\.contextHandoff\.newContext/ })).not.toBeInTheDocument();

    fireEvent.click(contextTile);

    await waitFor(() =>
      expect(mocks.readFile).toHaveBeenCalledWith({ path: '/workspace/Context.md', workspace: '/workspace' })
    );
    expect(mocks.openPreview).toHaveBeenCalledWith(
      '# Edited context',
      'markdown',
      expect.objectContaining({
        editable: true,
        file_name: 'Context.md',
        file_path: '/workspace/Context.md',
        title: 'Context.md',
        workspace: '/workspace',
      })
    );
    expect(onPreviewOpen).toHaveBeenCalledOnce();
  });

  it('uses LLM-first compaction when Context.md has not been created yet', async () => {
    mocks.getConversationOrNull.mockResolvedValue({
      ...conversation,
      extra: {
        ...conversation.extra,
        context_handoff: {},
      },
    });
    const onCreateContext = vi.fn(async () => ({
      fileName: 'Context.md',
      filePath: '/workspace/Context.md',
      markdown: '# LLM-managed context',
      snapshot: {
        goal: 'Continue the work.',
        current_state: [],
        decisions: [],
        artifacts: [],
        user_preferences: [],
        open_questions: [],
        next_steps: [],
        do_not_forget: [],
      },
      source: 'llm' as const,
      throughTurnId: 'turn-1',
    }));

    render(
      <ContextHandoffPanel conversationId='conversation-1' workspace='/workspace' onCreateContext={onCreateContext} />
    );

    fireEvent.click(await screen.findByRole('button', { name: /Context\.md/ }));

    await waitFor(() => expect(onCreateContext).toHaveBeenCalledOnce());
    expect(mocks.writeFile).not.toHaveBeenCalled();
    expect(mocks.openPreview).toHaveBeenCalledWith(
      '# LLM-managed context',
      'markdown',
      expect.objectContaining({ file_name: 'Context.md', file_path: '/workspace/Context.md', editable: true })
    );
  });

  it.each([
    ['updating', 'llm', 'conversation.contextHandoff.status.updating'],
    ['fresh', 'rules', 'conversation.contextHandoff.status.rulesFallback'],
    ['stale', 'llm', 'conversation.contextHandoff.status.stale'],
  ] as const)('shows compact generation state for %s/%s', async (status, source, expectedKey) => {
    mocks.getConversationOrNull.mockResolvedValue({
      ...conversation,
      extra: {
        ...conversation.extra,
        context_handoff: {
          ...conversation.extra.context_handoff,
          status,
          source,
        },
      },
    });

    render(<ContextHandoffPanel conversationId='conversation-1' workspace='/workspace' />);

    expect(await screen.findByText(expectedKey)).toBeInTheDocument();
  });

  it('shows no AI status text after a successful AI update', async () => {
    mocks.getConversationOrNull.mockResolvedValue({
      ...conversation,
      extra: {
        ...conversation.extra,
        context_handoff: {
          ...conversation.extra.context_handoff,
          status: 'fresh',
          source: 'llm',
        },
      },
    });

    render(<ContextHandoffPanel conversationId='conversation-1' workspace='/workspace' />);

    expect(await screen.findByText('conversation.contextHandoff.activeFileDescription')).toBeInTheDocument();
    expect(screen.queryByText('conversation.contextHandoff.status.updatedByAi')).not.toBeInTheDocument();
    expect(screen.queryByRole('img', { name: /status\.error/ })).not.toBeInTheDocument();
  });

  it('surfaces a failed AI update as a hover-able alert instead of status text', async () => {
    mocks.getConversationOrNull.mockResolvedValue({
      ...conversation,
      extra: {
        ...conversation.extra,
        context_handoff: {
          ...conversation.extra.context_handoff,
          status: 'failed',
          source: 'llm',
          last_error_code: 'provider_request_failed',
        },
      },
    });

    render(<ContextHandoffPanel conversationId='conversation-1' workspace='/workspace' />);

    expect(
      await screen.findByRole('img', { name: 'conversation.contextHandoff.status.error.providerRequestFailed' })
    ).toBeInTheDocument();
    expect(screen.queryByText('conversation.contextHandoff.status.failed')).not.toBeInTheDocument();
  });

  it('shows a budget percentage for an aionrs conversation using the per-model fallback window', async () => {
    mocks.getConversationOrNull.mockResolvedValue({
      ...conversation,
      extra: {
        backend: 'aionrs',
        context_handoff: conversation.extra.context_handoff,
        // No last_context_limit — aionrs conversations never receive one from the backend.
        last_token_usage: { total_tokens: 9_000 },
        workspace: '/workspace',
      },
      model: {
        ...conversation.model,
        use_model: 'minimax-m2.5',
      },
    });

    render(<ContextHandoffPanel conversationId='conversation-1' workspace='/workspace' />);

    await screen.findByRole('button', { name: /Context\.md/ });

    expect(screen.queryByText('--')).not.toBeInTheDocument();
    expect(screen.getByText(/%$/)).toBeInTheDocument();
    await waitFor(() =>
      expect(Number(screen.getByRole('progressbar').getAttribute('aria-valuenow'))).toBeGreaterThan(0)
    );
  });

  it('shows updating immediately while the always-mounted controller is compacting', async () => {
    mocks.getConversationOrNull.mockResolvedValue({
      ...conversation,
      extra: {
        ...conversation.extra,
        context_handoff: {
          ...conversation.extra.context_handoff,
          status: 'fresh',
          source: 'llm',
        },
      },
    });

    render(<ContextHandoffPanel conversationId='conversation-1' workspace='/workspace' isCompacting />);

    expect(await screen.findByText('conversation.contextHandoff.status.updating')).toBeInTheDocument();
  });
});
