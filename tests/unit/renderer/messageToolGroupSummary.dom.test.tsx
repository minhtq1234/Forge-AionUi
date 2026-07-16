import React from 'react';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { ipcBridge } from '@/common';
import type { TMessage } from '@/common/chat/chatLib';
import type { ToolMessage } from '@/common/chat/normalizeToolCall';
import MessageToolGroupSummary from '@/renderer/pages/conversation/Messages/components/MessageToolGroupSummary';

const mockDownloadFileFromPath = vi.fn().mockResolvedValue(undefined);
const mockMessageSuccess = vi.fn();
const mockMessageError = vi.fn();

vi.mock('@arco-design/web-react', async () => {
  const actual = await vi.importActual<typeof import('@arco-design/web-react')>('@arco-design/web-react');
  return {
    ...actual,
    Message: {
      useMessage: () => [{ success: mockMessageSuccess, error: mockMessageError }, null],
    },
  };
});

vi.mock('@/renderer/components/media/LocalImageView', () => ({
  __esModule: true,
  default: ({ src, alt }: { src: string; alt: string }) => <img src={src} alt={alt} data-testid='local-image' />,
}));

vi.mock('@/renderer/utils/file/download', () => ({
  downloadFileFromPath: (...args: unknown[]) => mockDownloadFileFromPath(...args),
}));

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string) => key,
  }),
}));

vi.mock('@/common', () => ({
  ipcBridge: {
    database: {
      getConversationMessage: {
        invoke: vi.fn(),
      },
    },
  },
}));

const truncatedAcpMessage = (status: 'in_progress' | 'completed' | 'failed', output: string): ToolMessage =>
  ({
    id: 'message-1',
    conversation_id: 'conversation-1',
    type: 'acp_tool_call',
    content: {
      _compact: {
        truncated: true,
        original_size: 90000,
        preview_chars: 4096,
      },
      update: {
        session_update: 'tool_call',
        tool_call_id: 'tool-1',
        status,
        title: 'rg',
        kind: 'search',
        raw_input: { pattern: 'needle', path: '.' },
        content: [{ type: 'content', content: { type: 'text', text: output } }],
      },
    },
  }) as unknown as ToolMessage;

describe('MessageToolGroupSummary', () => {
  it('uses existing i18n keys for raw input and output labels', () => {
    render(
      <MessageToolGroupSummary
        messages={[
          {
            id: 'message-1',
            conversation_id: 'conversation-1',
            type: 'tool_call',
            content: {
              call_id: 'tool-1',
              name: 'Shell Command',
              args: { command: 'pwd' },
              output: '/workspace',
              status: 'completed',
            },
          } as ToolMessage,
        ]}
      />
    );

    fireEvent.click(screen.getByText('common.technical_details'));
    fireEvent.click(screen.getByText('Shell Command'));

    expect(screen.getByText('tools.labels.arguments')).toBeInTheDocument();
    expect(screen.getByText('tools.labels.result')).toBeInTheDocument();
  });

  it('lazy-loads full tool content when expanding a truncated item under Technical details', async () => {
    const invoke = vi.mocked(ipcBridge.database.getConversationMessage.invoke);
    invoke.mockResolvedValue({
      id: 'message-1',
      conversation_id: 'conversation-1',
      type: 'acp_tool_call',
      content: {
        update: {
          session_update: 'tool_call',
          tool_call_id: 'tool-1',
          status: 'completed',
          title: 'rg',
          kind: 'search',
          raw_input: { pattern: 'needle', path: '.' },
          content: [{ type: 'content', content: { type: 'text', text: 'full output' } }],
        },
      },
    } as unknown as TMessage);

    render(
      <MessageToolGroupSummary
        messages={[
          {
            id: 'message-1',
            conversation_id: 'conversation-1',
            type: 'acp_tool_call',
            content: {
              _compact: {
                truncated: true,
                original_size: 90000,
                preview_chars: 4096,
              },
              update: {
                session_update: 'tool_call',
                tool_call_id: 'tool-1',
                status: 'completed',
                title: 'rg',
                kind: 'search',
                raw_input: { pattern: 'needle', path: '.' },
                content: [{ type: 'content', content: { type: 'text', text: 'preview' } }],
              },
            },
          } as unknown as ToolMessage,
        ]}
      />
    );

    // The tool has settled, so the raw machinery lives behind the opt-in
    // "Technical details" toggle (rendered as its i18n key under the mock).
    fireEvent.click(screen.getByText('common.technical_details'));
    // Expanding the raw row triggers the lazy-load of the full (untruncated) output.
    fireEvent.click(screen.getByText('rg'));

    await waitFor(() => {
      expect(invoke).toHaveBeenCalledWith({
        conversation_id: 'conversation-1',
        message_id: 'message-1',
      });
    });
    expect(await screen.findByText('full output')).toBeInTheDocument();
  });

  it('renders and downloads an image path supplied only by the lazy-loaded full item', async () => {
    const imagePath = '/Users/test/.codex/generated_images/session/lazy-image.png';
    const invoke = vi.mocked(ipcBridge.database.getConversationMessage.invoke);
    invoke.mockReset();
    invoke.mockResolvedValue({
      id: 'message-1',
      conversation_id: 'conversation-1',
      type: 'acp_tool_call',
      content: {
        update: {
          session_update: 'tool_call',
          tool_call_id: 'tool-1',
          status: 'completed',
          title: 'rg',
          kind: 'search',
          raw_output: { image: { path: imagePath } },
        },
      },
    } as unknown as TMessage);

    render(<MessageToolGroupSummary messages={[truncatedAcpMessage('completed', 'preview')]} />);
    fireEvent.click(screen.getByText('common.technical_details'));
    fireEvent.click(screen.getByText('rg'));

    const image = await screen.findByTestId('local-image');
    expect(image).toHaveAttribute('src', imagePath);
    expect(image).toHaveAttribute('alt', 'lazy-image.png');
    fireEvent.click(screen.getByLabelText('acp.image.download_aria'));
    await waitFor(() => expect(mockDownloadFileFromPath).toHaveBeenCalledWith(imagePath, 'lazy-image.png'));
  });

  it.each([
    { finalStatus: 'completed' as const, finalOutput: 'final completed output' },
    { finalStatus: 'failed' as const, finalOutput: 'final error output' },
  ])(
    'refreshes expanded truncated details when running work settles as $finalStatus',
    async ({ finalStatus, finalOutput }) => {
      const invoke = vi.mocked(ipcBridge.database.getConversationMessage.invoke);
      invoke.mockReset();
      invoke
        .mockResolvedValueOnce(truncatedAcpMessage('in_progress', 'full running output') as unknown as TMessage)
        .mockResolvedValueOnce(truncatedAcpMessage(finalStatus, finalOutput) as unknown as TMessage);

      const { rerender } = render(
        <MessageToolGroupSummary messages={[truncatedAcpMessage('in_progress', 'running preview')]} />
      );
      fireEvent.click(screen.getByText('common.technical_details'));
      fireEvent.click(screen.getByText('rg'));

      expect(await screen.findByText('full running output')).toBeInTheDocument();

      rerender(<MessageToolGroupSummary messages={[truncatedAcpMessage(finalStatus, 'settled preview')]} />);

      expect(await screen.findByText(finalOutput)).toBeInTheDocument();
      expect(screen.queryByText('full running output')).not.toBeInTheDocument();
      expect(invoke).toHaveBeenCalledTimes(2);
    }
  );

  it('does not refetch expanded details when the source version is unchanged', async () => {
    const invoke = vi.mocked(ipcBridge.database.getConversationMessage.invoke);
    invoke.mockReset();
    invoke.mockRejectedValue(new Error('unavailable'));
    const source = truncatedAcpMessage('in_progress', 'running preview');

    const { rerender } = render(<MessageToolGroupSummary messages={[source]} />);
    fireEvent.click(screen.getByText('common.technical_details'));
    fireEvent.click(screen.getByText('rg'));
    expect(await screen.findByText('common.failed')).toBeInTheDocument();

    rerender(<MessageToolGroupSummary messages={[truncatedAcpMessage('in_progress', 'running preview')]} />);

    await waitFor(() => expect(invoke).toHaveBeenCalledTimes(1));
  });
});
