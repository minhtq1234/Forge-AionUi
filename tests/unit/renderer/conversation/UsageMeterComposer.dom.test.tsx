import { render, screen } from '@testing-library/react';
import React from 'react';
import { describe, expect, it, vi } from 'vitest';

import ContextUsageIndicator from '@/renderer/components/agent/ContextUsageIndicator';
import SendBox from '@/renderer/components/chat/SendBox';

const { layoutState } = vi.hoisted(() => ({
  layoutState: { current: { isMobile: false } },
}));

vi.mock('@/common', () => ({
  ipcBridge: {
    fs: {
      listAvailableSkills: { invoke: vi.fn().mockResolvedValue([]) },
      listWorkspaceFiles: { invoke: vi.fn().mockResolvedValue([]) },
    },
  },
}));
vi.mock('@/renderer/components/chat/AtFileMenu', () => ({ default: () => null }));
vi.mock('@/renderer/components/chat/BtwOverlay', () => ({ default: () => null }));
vi.mock('@/renderer/components/chat/BtwOverlay/useBtwCommand', () => ({
  useBtwCommand: () => ({
    ask: vi.fn(),
    answer: null,
    dismiss: vi.fn(),
    isLoading: false,
    isOpen: false,
  }),
}));
vi.mock('@/renderer/components/chat/SlashCommandMenu', () => ({ default: () => null }));
vi.mock('@/renderer/components/chat/SpeechInputButton', () => ({ default: () => null }));
vi.mock('@/renderer/components/media/UploadProgressBar', () => ({ default: () => null }));
vi.mock('@/renderer/hooks/chat/useCompositionInput', () => ({
  useCompositionInput: () => ({
    compositionHandlers: {},
    createKeyDownHandler: () => vi.fn(),
    isComposingState: false,
  }),
}));
vi.mock('@/renderer/hooks/chat/useInputFocusRing', () => ({
  useInputFocusRing: () => ({
    activeBorderColor: 'transparent',
    activeShadow: 'none',
    inactiveBorderColor: 'transparent',
  }),
}));
vi.mock('@/renderer/hooks/chat/useSlashCommandController', () => ({
  getFuzzyMatchIndices: () => null,
  useSlashCommandController: () => ({
    filteredCommands: [],
    isOpen: false,
    onKeyDown: () => false,
    query: '',
  }),
}));
vi.mock('@/renderer/hooks/context/ConversationContext', () => ({
  useConversationContextSafe: () => null,
}));
vi.mock('@/renderer/hooks/context/LayoutContext', () => ({
  useLayoutContext: () => layoutState.current,
}));
vi.mock('@/renderer/hooks/file/useAbortUploadsOnConversationChange', () => ({
  useAbortUploadsOnConversationChange: vi.fn(),
}));
vi.mock('@/renderer/hooks/file/useConversationExport', () => ({
  useConversationExport: () => ({
    closeExportFlow: vi.fn(),
    filename: '',
    handleKeyDown: () => false,
    isOpen: false,
    loading: false,
    openExportFlow: vi.fn(),
    pathPreview: '',
    setFilename: vi.fn(),
    showMenu: vi.fn(),
    submitFilename: vi.fn(),
  }),
}));
vi.mock('@/renderer/hooks/file/useDragUpload', () => ({
  useDragUpload: () => ({ dragHandlers: {}, isFileDragging: false }),
}));
vi.mock('@/renderer/hooks/file/usePasteService', () => ({
  usePasteService: () => ({ onFocus: vi.fn(), onPaste: vi.fn() }),
}));
vi.mock('@/renderer/hooks/file/useUploadState', () => ({
  useUploadState: () => ({ isUploading: false }),
}));
vi.mock('@/renderer/hooks/system/useLiveTranscriptInsertion', () => ({
  createChainedDispatch: () => ({ dispatch: vi.fn(), reset: vi.fn() }),
  useLiveTranscriptInsertion: () => ({ handleLiveTranscript: vi.fn() }),
}));
vi.mock('@/renderer/pages/conversation/Messages/hooks', () => ({
  useMessageList: () => [],
}));
vi.mock('@/renderer/pages/conversation/Preview', () => ({
  usePreviewContext: () => ({
    clearDomSnippets: vi.fn(),
    domSnippets: [],
    removeDomSnippet: vi.fn(),
    setSendBoxHandler: vi.fn(),
  }),
}));
vi.mock('@/renderer/services/FileService', () => ({ allSupportedExts: [] }));
vi.mock('@/renderer/utils/emitter', () => ({
  emitter: { emit: vi.fn() },
  useAddEventListener: vi.fn(),
}));
vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, options?: Record<string, string | number>) => {
      const translations: Record<string, string> = {
        'common.more': 'More',
        'conversation.contextUsage.triggerLabel': 'Show context usage',
        'conversation.contextUsage.contextWindow': 'Context window',
        'conversation.contextUsage.percentUsed': '{{percent}}% used',
        'conversation.contextUsage.tokenCount': '{{used}} of {{limit}} tokens',
        'conversation.contextUsage.localTokenUsage': 'Local token usage',
        'conversation.contextUsage.today': 'Today',
        'conversation.contextUsage.weekToDate': 'Week to date',
        'conversation.contextUsage.monthToDate': 'Month to date',
      };
      return (translations[key] ?? key).replace(/{{(\w+)}}/g, (_match, name: string) => String(options?.[name] ?? ''));
    },
  }),
}));

const usageMeter = (
  <ContextUsageIndicator
    tokenUsage={{ total_tokens: 12_000 }}
    context_limit={32_000}
    localUsage={{ today: 120, weekToDate: 560, monthToDate: 1_240 }}
  />
);

describe('usage meter composer integration', () => {
  it('renders the real Arco meter on desktop and suppresses inline right tools on compact mobile', () => {
    const style = document.createElement('style');
    style.textContent =
      '.arco-textarea { box-sizing: border-box; border-top-width: 0; border-bottom-width: 0; padding-top: 0; padding-bottom: 0; line-height: 20px; }';
    document.head.append(style);
    layoutState.current = { isMobile: false };
    const { rerender } = render(<SendBox defaultMultiLine lockMultiLine onSend={vi.fn()} rightTools={usageMeter} />);

    const desktopTrigger = screen.getByRole('button', { name: 'Show context usage' });
    expect(desktopTrigger).toHaveClass('arco-btn');

    layoutState.current = { isMobile: true };
    rerender(<SendBox onMobilePlusClick={vi.fn()} onSend={vi.fn()} rightTools={usageMeter} />);

    expect(screen.queryByRole('button', { name: 'Show context usage' })).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'More' })).toHaveClass('arco-btn');
    style.remove();
  });
});
