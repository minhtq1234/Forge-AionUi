/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import type { IMessageAcpPermission, IMessagePermission } from '@/common/chat/chatLib';
import { fireEvent, render, screen } from '@testing-library/react';
import React from 'react';
import { describe, expect, it, vi } from 'vitest';

const confirmPermissionMock = vi.fn(() => Promise.resolve());
const confirmAcpPermissionMock = vi.fn(() => Promise.resolve());

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, options?: { defaultValue?: string }) => options?.defaultValue ?? key,
  }),
}));

vi.mock('@/common', () => ({
  ipcBridge: {
    conversation: {
      confirmation: {
        confirm: { invoke: (...args: unknown[]) => confirmPermissionMock(...args) },
      },
    },
  },
}));

vi.mock('@/common/adapter/ipcBridge', () => ({
  conversation: {
    confirmMessage: { invoke: (...args: unknown[]) => confirmAcpPermissionMock(...args) },
  },
}));

import MessageAcpPermission from '@/renderer/pages/conversation/Messages/acp/MessageAcpPermission';
import MessagePermission from '@/renderer/pages/conversation/Messages/components/MessagePermission';

const permissionMessage = {
  id: 'permission-1',
  msg_id: 'msg-permission-1',
  conversation_id: 'conversation-1',
  type: 'permission',
  content: {
    id: 'confirmation-1',
    title: 'Run command?',
    description: 'Run command?',
    action: 'exec',
    call_id: 'call-1',
    command_type: 'git',
    options: [{ label: 'Allow once', value: 'proceed_once' }],
  },
} satisfies IMessagePermission;

const acpPermissionMessage = {
  id: 'acp-permission-1',
  conversation_id: 'conversation-1',
  type: 'acp_permission',
  content: {
    session_id: 'session-1',
    options: [{ option_id: 'allow_once', name: 'Allow once', kind: 'allow_once' }],
    tool_call: {
      tool_call_id: 'tool-call-1',
      title: 'Run command?',
      kind: 'execute',
      raw_input: { command: 'git status' },
    },
  },
} satisfies IMessageAcpPermission;

describe('permission actions', () => {
  it('submits a standard permission choice directly', async () => {
    render(<MessagePermission message={permissionMessage} />);

    fireEvent.click(screen.getByRole('button', { name: 'Allow once' }));

    await vi.waitFor(() => {
      expect(confirmPermissionMock).toHaveBeenCalledWith(
        expect.objectContaining({ data: { value: 'proceed_once' }, always_allow: false })
      );
    });
  });

  it('submits an ACP permission choice directly', async () => {
    render(<MessageAcpPermission message={acpPermissionMessage} />);

    fireEvent.click(screen.getByRole('button', { name: 'Allow once' }));

    await vi.waitFor(() => {
      expect(confirmAcpPermissionMock).toHaveBeenCalledWith(expect.objectContaining({ confirm_key: 'allow_once' }));
    });
  });
});
