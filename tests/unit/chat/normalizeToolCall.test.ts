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

  it('omits an embedded inline image from ACP content text while preserving surrounding text', () => {
    const inlineImage = 'data:image/webp;base64,UklGRkZBS0VJTUFHRQ==';
    const normalized = normalizeAcpToolCall(
      acpToolCall({
        content: [
          {
            type: 'content',
            content: {
              type: 'text',
              text: `Rendered preview ${inlineImage}; saved successfully`,
            },
          },
        ],
      })
    );

    expect(normalized?.output).toBe('Rendered preview [inline image omitted]; saved successfully');
    expect(normalized?.output).not.toContain(inlineImage);
  });
});

describe('normalizeToolGroup telemetry boundaries', () => {
  it.each([
    'Token watermark override: provider=0, local_estimate=19756, using=19756',
    'Microcompact: cleared 6 tool results (~108 tokens freed)',
  ])('drops grouped info telemetry from its original title: %s', (title) => {
    const message: IMessageToolGroup = {
      type: 'tool_group',
      content: [
        {
          call_id: 'group-info-telemetry',
          name: 'Info',
          description: 'Internal status',
          render_output_as_markdown: false,
          status: 'Success',
          confirmationDetails: {
            type: 'info',
            title,
            prompt: '',
          },
        },
      ],
    };

    expect(normalizeToolMessages([message])).toEqual([]);
  });

  it('omits inline image payloads from string results regardless of size', () => {
    const inlineImage = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAAB';
    const message: IMessageToolGroup = {
      type: 'tool_group',
      content: [
        {
          call_id: 'group-image-result',
          name: 'Image generation',
          description: 'Generate an image',
          render_output_as_markdown: false,
          status: 'Success',
          result_display: inlineImage,
        },
      ],
    };

    expect(normalizeToolMessages([message])).toMatchObject([
      {
        output: '[inline image omitted]',
      },
    ]);
    expect(normalizeToolMessages([message])[0].output).not.toContain(inlineImage);
  });

  it('omits line-wrapped inline image payloads from grouped results without leaving a tail', () => {
    const inlineImage = 'data:image/png;base64,iVBORw0KGgo\nAAAA==';
    const message: IMessageToolGroup = {
      type: 'tool_group',
      content: [
        {
          call_id: 'group-wrapped-image-result',
          name: 'Image generation',
          description: 'Generate an image',
          render_output_as_markdown: false,
          status: 'Success',
          result_display: `Rendered ${inlineImage}; saved successfully`,
        },
      ],
    };

    expect(normalizeToolMessages([message])).toMatchObject([
      {
        output: 'Rendered [inline image omitted]; saved successfully',
      },
    ]);
  });

  it('omits unpadded line-wrapped inline image payloads from grouped results', () => {
    const inlineImage = 'data:image/png;base64,iVBORw0KGgo\nAAAA';
    const message: IMessageToolGroup = {
      type: 'tool_group',
      content: [
        {
          call_id: 'group-unpadded-image-result',
          name: 'Image generation',
          description: 'Generate an image',
          render_output_as_markdown: false,
          status: 'Success',
          result_display: `Rendered ${inlineImage}; saved successfully`,
        },
      ],
    };

    expect(normalizeToolMessages([message])).toMatchObject([
      {
        output: 'Rendered [inline image omitted]; saved successfully',
      },
    ]);
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

  it('keeps legitimate diagnostic-like terms in a tool description', () => {
    const description = 'Compare Microcompact with local_estimate=42 from the project fixture';

    expect(normalizeToolCall(toolCall({ description }))?.description).toBe(description);
  });

  it.each([
    ['input', { input: { image: 'data:image/png;base64,iVBORw0KGgoAAAA==' } }, '"image": "[inline image omitted]"'],
    ['args', { args: { image: '/9j/AAAA' } }, '"image": "[inline image omitted]"'],
    ['args', { args: { image: 'iVBORw0KGgo AAAA==' } }, '"image": "[inline image omitted]"'],
    ['output', { output: 'data:image/webp;base64,UklGRkZBS0U=' }, '[inline image omitted]'],
    [
      'error',
      { error: 'failed with preview data:image/jpeg;base64,/9j/AAAA; retry available' },
      'failed with preview [inline image omitted]; retry available',
    ],
  ])('omits inline image payloads from plain tool %s', (_source, content, expectedDetail) => {
    const normalized = normalizeToolCall(toolCall(content));
    const technicalDetails = `${normalized?.input ?? ''}\n${normalized?.output ?? ''}`;

    expect(technicalDetails).toContain(expectedDetail);
    expect(technicalDetails).not.toMatch(/data:image\//i);
    expect(technicalDetails).not.toContain('/9j/AAAA');
  });

  it('preserves ordinary commands and outputs exactly', () => {
    const command = 'bun run test tests/unit/chat/normalizeToolCall.test.ts';
    const output = '29 tests passed';
    const normalized = normalizeToolCall(toolCall({ input: { command }, output }));

    expect(JSON.parse(normalized?.input ?? '')).toEqual({ command });
    expect(normalized?.output).toBe(output);
    expect(normalized?.status).toBe('completed');
  });
});

const acpToolCall = (updateOverrides: Partial<IMessageAcpToolCall['content']['update']>): IMessageAcpToolCall => ({
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
      ...updateOverrides,
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
