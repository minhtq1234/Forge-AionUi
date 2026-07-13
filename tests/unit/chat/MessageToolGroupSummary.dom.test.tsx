/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import React from 'react';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { IMessageAcpToolCall, IMessageToolCall, IMessageToolGroup } from '@/common/chat/chatLib';
import MessageToolGroupSummary from '@/renderer/pages/conversation/Messages/components/MessageToolGroupSummary';
import type { WorkJournalSourceMessage } from '@/renderer/pages/conversation/Messages/types';

const mockDownloadFileFromPath = vi.fn().mockResolvedValue(undefined);
const mockMessageSuccess = vi.fn();
const mockMessageError = vi.fn();

vi.mock('@/renderer/components/media/LocalImageView', () => ({
  __esModule: true,
  default: ({ src, alt, className }: { src: string; alt: string; className?: string }) => (
    <img src={src} alt={alt} className={className} data-testid='local-image' />
  ),
}));

vi.mock('@/renderer/utils/file/download', () => ({
  downloadFileFromPath: (...args: unknown[]) => mockDownloadFileFromPath(...args),
}));

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string) => key,
  }),
}));

vi.mock('@arco-design/web-react', async () => {
  const actual = await vi.importActual<typeof import('@arco-design/web-react')>('@arco-design/web-react');

  return {
    ...actual,
    Message: {
      useMessage: () => [{ success: mockMessageSuccess, error: mockMessageError }, null],
    },
  };
});

describe('MessageToolGroupSummary ACP image output', () => {
  beforeEach(() => {
    mockDownloadFileFromPath.mockReset();
    mockDownloadFileFromPath.mockResolvedValue(undefined);
    mockMessageSuccess.mockClear();
    mockMessageError.mockClear();
  });

  it('renders generated image preview when an ACP image tool call is expanded', () => {
    const message: IMessageAcpToolCall = {
      id: 'ig_test_image',
      conversation_id: 'conv-1',
      type: 'acp_tool_call',
      content: {
        sessionId: 'sess-1',
        update: {
          sessionUpdate: 'tool_call_update',
          tool_call_id: 'ig_test_image',
          status: 'completed',
          title: 'Image generation',
          kind: 'execute',
          raw_output: {
            image: {
              path: '/Users/test/.codex/generated_images/session/ig_test_image.png',
            },
          },
          content: [
            {
              type: 'content',
              content: {
                type: 'text',
                text: 'Revised prompt: 一张小猫照片',
              },
            },
          ],
        },
      },
    };

    render(<MessageToolGroupSummary messages={[message]} />);
    fireEvent.click(screen.getByText('common.technical_details'));

    const image = screen.getByTestId('local-image');
    expect(image).toHaveAttribute('src', '/Users/test/.codex/generated_images/session/ig_test_image.png');
    expect(image).toHaveAttribute('alt', 'ig_test_image.png');
  });

  it('downloads the generated image from its local path', () => {
    const imagePath = '/Users/test/.codex/generated_images/session/ig_test_image.png';
    const message: IMessageAcpToolCall = {
      id: 'ig_test_image',
      conversation_id: 'conv-1',
      type: 'acp_tool_call',
      content: {
        sessionId: 'sess-1',
        update: {
          sessionUpdate: 'tool_call_update',
          tool_call_id: 'ig_test_image',
          status: 'completed',
          title: 'Image generation',
          kind: 'execute',
          raw_output: {
            image: {
              path: imagePath,
            },
          },
        },
      },
    };

    render(<MessageToolGroupSummary messages={[message]} />);
    fireEvent.click(screen.getByText('common.technical_details'));
    fireEvent.click(screen.getByLabelText('acp.image.download_aria'));

    expect(mockDownloadFileFromPath).toHaveBeenCalledWith(imagePath, 'ig_test_image.png');
  });

  it('shows an error when generated image download fails', async () => {
    const imagePath = '/Users/test/.codex/generated_images/session/ig_test_image.png';
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {});
    mockDownloadFileFromPath.mockRejectedValueOnce(new Error('denied'));
    const message: IMessageAcpToolCall = {
      id: 'ig_test_image',
      conversation_id: 'conv-1',
      type: 'acp_tool_call',
      content: {
        sessionId: 'sess-1',
        update: {
          sessionUpdate: 'tool_call_update',
          tool_call_id: 'ig_test_image',
          status: 'completed',
          title: 'Image generation',
          kind: 'execute',
          raw_output: {
            image: {
              path: imagePath,
            },
          },
        },
      },
    };

    render(<MessageToolGroupSummary messages={[message]} />);
    fireEvent.click(screen.getByText('common.technical_details'));
    fireEvent.click(screen.getByLabelText('acp.image.download_aria'));

    await waitFor(() => {
      expect(mockMessageError).toHaveBeenCalledWith('acp.image.download_error');
    });
    expect(consoleError).toHaveBeenCalledWith('[MessageToolGroupSummary] Failed to download image:', expect.any(Error));
    expect(mockMessageSuccess).not.toHaveBeenCalled();
    consoleError.mockRestore();
  });

  it('uses i18n keys for the image download control', () => {
    const message: IMessageAcpToolCall = {
      id: 'ig_test_image',
      conversation_id: 'conv-1',
      type: 'acp_tool_call',
      content: {
        sessionId: 'sess-1',
        update: {
          sessionUpdate: 'tool_call_update',
          tool_call_id: 'ig_test_image',
          status: 'completed',
          title: 'Image generation',
          kind: 'execute',
          raw_output: {
            image: {
              path: '/Users/test/.codex/generated_images/session/ig_test_image.png',
            },
          },
        },
      },
    };

    render(<MessageToolGroupSummary messages={[message]} />);
    fireEvent.click(screen.getByText('common.technical_details'));

    expect(screen.getByLabelText('acp.image.download_aria')).toBeInTheDocument();
  });

  it('does not render image controls for tool calls without image output', () => {
    const message: IMessageToolCall = {
      id: 'tool-1',
      conversation_id: 'conv-1',
      type: 'tool_call',
      content: {
        call_id: 'tool-1',
        name: 'Shell Command',
        args: {},
        status: 'completed',
      },
    };

    render(<MessageToolGroupSummary messages={[message]} />);
    fireEvent.click(screen.getByText('common.technical_details'));

    expect(screen.queryByTestId('local-image')).not.toBeInTheDocument();
    expect(screen.queryByLabelText('acp.image.download_aria')).not.toBeInTheDocument();
  });
});

describe('MessageToolGroupSummary plain-language activity', () => {
  const acpStep = (status: string, toolCallId: string): IMessageAcpToolCall =>
    ({
      id: toolCallId,
      conversation_id: 'conv-1',
      type: 'acp_tool_call',
      content: {
        sessionId: 'sess-1',
        update: {
          sessionUpdate: 'tool_call_update',
          tool_call_id: toolCallId,
          status,
          title: 'forge-reports_render_report',
          kind: 'execute',
        },
      },
    }) as unknown as IMessageAcpToolCall;

  it('does not show token watermark telemetry in technical details', () => {
    const diagnosticStep: IMessageAcpToolCall = {
      id: 'token-watermark-1',
      conversation_id: 'conv-1',
      type: 'acp_tool_call',
      content: {
        sessionId: 'sess-1',
        update: {
          sessionUpdate: 'tool_call_update',
          tool_call_id: 'token-watermark-1',
          status: 'completed',
          title: 'Token watermark override: provider=0, local_estimate=19756, using=19756',
          kind: 'info',
        },
      },
    };

    render(<MessageToolGroupSummary messages={[acpStep('completed', 't1'), diagnosticStep]} />);
    fireEvent.click(screen.getByText('common.technical_details'));

    expect(screen.queryByText(/Token watermark override/)).not.toBeInTheDocument();
  });

  const commandStep = (status: string, toolCallId: string, command: string): IMessageAcpToolCall =>
    ({
      id: toolCallId,
      conversation_id: 'conv-1',
      type: 'acp_tool_call',
      content: {
        sessionId: 'sess-1',
        update: {
          sessionUpdate: 'tool_call_update',
          tool_call_id: toolCallId,
          status,
          title: 'exec_command',
          kind: 'execute',
          rawInput: { command },
        },
      },
    }) as unknown as IMessageAcpToolCall;

  it('keeps completed phases visible while the latest phase is running', () => {
    render(
      <MessageToolGroupSummary
        messages={[
          commandStep('completed', 'search-1', 'rg -n needle .'),
          commandStep('in_progress', 'verify-1', 'bun run test tests/unit/chat'),
        ]}
      />
    );

    expect(screen.getByText('messages.toolActivity.categories.search.done')).toBeInTheDocument();
    expect(screen.getByText('messages.toolActivity.categories.verify.running')).toBeInTheDocument();
    expect(screen.getByRole('status')).toHaveAttribute('aria-live', 'polite');
  });

  it('shows the done label and a technical-details toggle when settled', () => {
    render(<MessageToolGroupSummary messages={[acpStep('completed', 't1')]} />);
    expect(screen.getByText('messages.toolActivity.tools.render_report.done')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'common.technical_details' })).toHaveAttribute('aria-expanded', 'false');
  });

  it('offers one Technical Details disclosure while work is running', () => {
    render(<MessageToolGroupSummary messages={[commandStep('in_progress', 'verify-1', 'bun run test')]} />);

    const disclosure = screen.getByRole('button', { name: 'common.technical_details' });
    expect(disclosure).toHaveAttribute('aria-expanded', 'false');
    fireEvent.click(disclosure);
    expect(disclosure).toHaveAttribute('aria-expanded', 'true');
    expect(screen.getAllByText('common.technical_details')).toHaveLength(1);
  });

  it('groups repetitive search commands into one journal row', () => {
    render(
      <MessageToolGroupSummary
        messages={[
          commandStep('completed', 'search-1', 'rg -n needle .'),
          commandStep('completed', 'search-2', 'find . -name needle'),
        ]}
      />
    );

    expect(screen.getAllByText('messages.toolActivity.categories.search.done')).toHaveLength(1);
  });

  it('shows a safe thinking subject but not raw thinking content', () => {
    render(
      <MessageToolGroupSummary
        messages={
          [
            {
              id: 'thinking-1',
              conversation_id: 'conv-1',
              type: 'thinking',
              position: 'left',
              content: {
                subject: 'Reviewing the conversation activity',
                content: 'raw private reasoning must stay hidden',
                status: 'thinking',
              },
            },
          ] as WorkJournalSourceMessage[]
        }
      />
    );

    expect(screen.getByText('Reviewing the conversation activity')).toBeInTheDocument();
    expect(screen.queryByText(/raw private reasoning/)).not.toBeInTheDocument();
  });

  it('rejects diagnostic thinking subjects', () => {
    render(
      <MessageToolGroupSummary
        messages={
          [
            {
              id: 'thinking-1',
              conversation_id: 'conv-1',
              type: 'thinking',
              position: 'left',
              content: {
                subject: 'Microcompact: internal activity telemetry',
                content: 'private detail',
                status: 'done',
              },
            },
          ] as WorkJournalSourceMessage[]
        }
      />
    );

    expect(screen.queryByText(/Microcompact/)).not.toBeInTheDocument();
  });

  it('truncates long thinking subjects to 180 characters with an ellipsis', () => {
    const subject = `Reviewing ${'a'.repeat(220)}`;
    render(
      <MessageToolGroupSummary
        messages={
          [
            {
              id: 'thinking-1',
              conversation_id: 'conv-1',
              type: 'thinking',
              position: 'left',
              content: { subject, content: 'private detail', status: 'done' },
            },
          ] as WorkJournalSourceMessage[]
        }
      />
    );

    const visibleSubject = screen.getByText((text) => text.startsWith('Reviewing'));
    expect(visibleSubject.textContent).toHaveLength(180);
    expect(visibleSubject.textContent).toMatch(/…$/);
  });

  it('renders plan, thinking, and tool rows in source order', () => {
    render(
      <MessageToolGroupSummary
        messages={
          [
            {
              id: 'plan-1',
              conversation_id: 'conv-1',
              type: 'plan',
              position: 'left',
              content: {
                session_id: 'sess-1',
                entries: [{ content: 'Review the activity flow', status: 'completed' }],
              },
            },
            {
              id: 'thinking-1',
              conversation_id: 'conv-1',
              type: 'thinking',
              position: 'left',
              content: { subject: 'Choosing a safe approach', content: 'private detail', status: 'done' },
            },
            commandStep('completed', 'search-1', 'rg -n needle .'),
          ] as WorkJournalSourceMessage[]
        }
      />
    );

    const plan = screen.getByText('Review the activity flow');
    const thinking = screen.getByText('Choosing a safe approach');
    const tool = screen.getByText('messages.toolActivity.categories.search.done');
    expect(plan.compareDocumentPosition(thinking)).toBe(Node.DOCUMENT_POSITION_FOLLOWING);
    expect(thinking.compareDocumentPosition(tool)).toBe(Node.DOCUMENT_POSITION_FOLLOWING);
  });

  it('maps plan entry statuses to pending, running, and completed rows', () => {
    render(
      <MessageToolGroupSummary
        messages={
          [
            {
              id: 'plan-1',
              conversation_id: 'conv-1',
              type: 'plan',
              position: 'left',
              content: {
                session_id: 'sess-1',
                entries: [
                  { content: 'Queued work', status: 'pending' },
                  { content: 'Active work', status: 'in_progress' },
                  { content: 'Finished work', status: 'completed' },
                ],
              },
            },
          ] as WorkJournalSourceMessage[]
        }
      />
    );

    expect(screen.getByText('Queued work').closest('[data-status]')).toHaveAttribute('data-status', 'pending');
    expect(screen.getByText('Active work').closest('[data-status]')).toHaveAttribute('data-status', 'running');
    expect(screen.getByText('Finished work').closest('[data-status]')).toHaveAttribute('data-status', 'completed');
  });

  it('renders canceled work as a warning and never as success', () => {
    const canceled: IMessageToolGroup = {
      id: 'canceled-1',
      conversation_id: 'conv-1',
      type: 'tool_group',
      position: 'left',
      content: [
        {
          call_id: 'canceled-1',
          description: 'Canceled command',
          name: 'Shell Command',
          render_output_as_markdown: false,
          status: 'Canceled',
        },
      ],
    };

    render(<MessageToolGroupSummary messages={[canceled]} />);

    const row = screen.getByText('messages.toolActivity.status.stopped').closest('[data-status]');
    expect(row).toHaveAttribute('data-status', 'canceled');
    expect(row?.querySelector('[data-status-icon="completed"]')).not.toBeInTheDocument();
  });

  it('coalesces consecutive retries into one live line with an attempt count', () => {
    render(
      <MessageToolGroupSummary
        messages={[acpStep('failed', 't1'), acpStep('failed', 't2'), acpStep('in_progress', 't3')]}
      />
    );
    expect(screen.getByText(/messages\.toolActivity\.tools\.render_report\.running/)).toBeInTheDocument();
    expect(screen.getByText(/messages\.toolActivity\.attempt/)).toBeInTheDocument();
  });

  it('renders a friendly error card for a final give-up', () => {
    render(<MessageToolGroupSummary messages={[acpStep('failed', 't1')]} />);
    expect(screen.getByText('messages.toolActivity.tools.render_report.failedTitle')).toBeInTheDocument();
    expect(screen.getByText('messages.toolActivity.error.suggestion')).toBeInTheDocument();
  });
});
