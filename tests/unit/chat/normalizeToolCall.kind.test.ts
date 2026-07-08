import { describe, expect, it } from 'vitest';
import { normalizeAcpToolCall } from '@/common/chat/normalizeToolCall';
import type { IMessageAcpToolCall } from '@/common/chat/chatLib';

describe('normalizeAcpToolCall kind', () => {
  it('passes the ACP update kind through to the normalized call', () => {
    const message = {
      id: 'm1',
      conversation_id: 'c1',
      type: 'acp_tool_call',
      content: {
        sessionId: 's1',
        update: {
          sessionUpdate: 'tool_call_update',
          tool_call_id: 't1',
          status: 'completed',
          title: 'Read',
          kind: 'read',
        },
      },
    } as unknown as IMessageAcpToolCall;

    expect(normalizeAcpToolCall(message)?.kind).toBe('read');
  });
});
