/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import type { IMessageAcpToolCall, IMessageToolCall, IMessageToolGroup } from '@/common/chat/chatLib';
import { normalizeAcpToolCall, normalizeToolCall, normalizeToolMessages } from '@/common/chat/normalizeToolCall';
import { describe, expect, it } from 'vitest';

describe('normalizeAcpToolCall', () => {
  it('drops Microcompact telemetry tool calls', () => {
    const message: IMessageAcpToolCall = {
      id: 'microcompact-1',
      conversation_id: 'conv-1',
      type: 'acp_tool_call',
      content: {
        sessionId: 'sess-1',
        update: {
          sessionUpdate: 'tool_call_update',
          tool_call_id: 'microcompact-1',
          status: 'completed',
          title: 'Microcompact: cleared 6 tool results (~108 tokens freed)',
          kind: 'info',
        },
      },
    };

    expect(normalizeToolMessages([message])).toEqual([]);
  });

  it('drops token watermark telemetry tool calls', () => {
    const message: IMessageAcpToolCall = {
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

    expect(normalizeAcpToolCall(message)).toBeUndefined();
  });

  it('keeps ACP execute commands containing diagnostic-like text', () => {
    const command = `printf 'Microcompact: local_estimate=42\\n'`;
    const message: IMessageAcpToolCall = {
      id: 'acp-execute-1',
      conversation_id: 'conv-1',
      type: 'acp_tool_call',
      content: {
        sessionId: 'sess-1',
        update: {
          sessionUpdate: 'tool_call_update',
          tool_call_id: 'acp-execute-1',
          status: 'completed',
          title: 'Execute',
          kind: 'execute',
          rawInput: { command },
        },
      },
    };

    expect(normalizeToolMessages([message])).toMatchObject([{ name: 'Execute', description: command }]);
  });

  it('keeps grouped execute commands containing diagnostic-like text', () => {
    const command = `printf 'Microcompact: local_estimate=42\\n'`;
    const message: IMessageToolGroup = {
      type: 'tool_group',
      content: [
        {
          call_id: 'group-execute-1',
          name: 'Shell',
          description: 'Run shell command',
          render_output_as_markdown: false,
          status: 'Success',
          confirmationDetails: {
            type: 'exec',
            title: 'Execute',
            rootCommand: 'printf',
            command,
          },
        },
      ],
    };

    expect(normalizeToolMessages([message])).toMatchObject([{ name: 'Shell', description: command }]);
  });

  it('preserves generated image paths for grouped tool summaries', () => {
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

    const normalized = normalizeAcpToolCall(message);

    expect((normalized as { imagePath?: string } | undefined)?.imagePath).toBe(
      '/Users/test/.codex/generated_images/session/ig_test_image.png'
    );
  });

  it('uses a result-only rawOutput as output when structured content is absent', () => {
    const message = acpToolCall({ rawOutput: { result: 'verification passed' } });

    expect(normalizeAcpToolCall(message)?.output).toBe('verification passed');
  });

  it('uses an error-like raw_output object as output when structured content is absent', () => {
    const message = acpToolCall({ raw_output: { error: 'verification failed', exit_code: 1 } });

    expect(normalizeAcpToolCall(message)?.output).toBe(`{
  "error": "verification failed",
  "exit_code": 1
}`);
  });

  it('does not expose inline image base64 while preserving raw output fallback', () => {
    const inlineImage = `iVBORw0KGgo${'a'.repeat(64 * 1024)}`;
    const message = acpToolCall({ rawOutput: { result: inlineImage, saved_path: '/tmp/generated.png' } });
    const output = normalizeAcpToolCall(message)?.output;

    expect(output).toEqual(expect.stringContaining('"result_omitted_reason": "image_base64"'));
    expect(output).not.toContain(inlineImage);
  });

  it('omits short inline image data from normalized text and keeps its image path', () => {
    const inlineImage = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAAB';
    const imagePath = '/tmp/short-preview.png';
    const normalized = normalizeAcpToolCall(acpToolCall({ rawOutput: { result: inlineImage, saved_path: imagePath } }));

    expect(normalized?.output).toEqual(expect.stringContaining('"result_omitted_reason": "image_base64"'));
    expect(normalized?.output).toEqual(expect.stringContaining(`"saved_path": "${imagePath}"`));
    expect(normalized?.output).not.toContain(inlineImage);
    expect(normalized?.imagePath).toBe(imagePath);
  });
});

describe('normalizeToolCall detail preservation', () => {
  it('keeps legitimate diagnostic-like terms in normalized input and output', () => {
    const message = toolCall({
      input: { query: 'compare Microcompact and compact behavior' },
      output: 'Microcompact: local_estimate=42 is legitimate project data',
    });

    expect(normalizeToolMessages([message])).toMatchObject([
      {
        input: expect.stringContaining('Microcompact and compact'),
        output: 'Microcompact: local_estimate=42 is legitimate project data',
      },
    ]);
  });

  it('preserves error detail and infers error status when output and status are absent', () => {
    const message = toolCall({ error: 'permission denied' });

    expect(normalizeToolCall(message)).toMatchObject({
      status: 'error',
      output: 'permission denied',
    });
  });

  it('infers completed status when output exists and status is absent', () => {
    const message = toolCall({ output: 'done' });

    expect(normalizeToolCall(message)?.status).toBe('completed');
  });
});

const acpToolCall = (
  rawOutput: Pick<IMessageAcpToolCall['content']['update'], 'rawOutput' | 'raw_output'>
): IMessageAcpToolCall => ({
  id: 'raw-output-message',
  conversation_id: 'conv-1',
  type: 'acp_tool_call',
  content: {
    sessionId: 'sess-1',
    update: {
      sessionUpdate: 'tool_call_update',
      tool_call_id: 'raw-output-call',
      status: 'completed',
      title: 'Execute',
      kind: 'execute',
      ...rawOutput,
    },
  },
});

const toolCall = (content: Partial<IMessageToolCall['content']>): IMessageToolCall => ({
  type: 'tool_call',
  content: {
    call_id: 'tool-call-1',
    name: 'Search',
    args: {},
    ...content,
  },
});
