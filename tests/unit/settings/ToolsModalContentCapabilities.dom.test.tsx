/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import React from 'react';
import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import type { IMcpServer } from '@/common/config/storage';
import {
  BUILTIN_TAVILY_ID,
  BUILTIN_TAVILY_NAME,
  BUILTIN_GITHUB_ID,
  BUILTIN_GITHUB_NAME,
  BUILTIN_POSTGRES_ID,
  BUILTIN_POSTGRES_NAME,
} from '@/common/config/builtinCapabilities';

// i18n returns the key so we can assert on labels.
vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (k: string) => k }),
}));

vi.mock('@/renderer/components/base/AionScrollArea', () => ({
  default: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
}));

vi.mock('@/renderer/components/base/AionSelect', () => {
  const Select = ({ children }: { children?: React.ReactNode }) => <div>{children}</div>;
  return { default: Object.assign(Select, { OptGroup: Select, Option: Select }) };
});

vi.mock('@/renderer/components/base/TalkToButlerButton', () => ({
  default: () => <div>TalkToButlerButton</div>,
}));

vi.mock('@/renderer/pages/settings/components/AddMcpServerModal', () => ({
  default: () => null,
}));

vi.mock('@/renderer/pages/settings/ToolsSettings/McpServerItem', () => ({
  default: () => null,
}));

vi.mock('@/renderer/hooks/agent/useConfigModelListWithImage', () => ({
  default: () => ({ modelListWithImage: [] }),
}));

vi.mock('@/renderer/hooks/mcp', () => ({
  useMcpServers: () => ({
    mcpServers: [],
    extensionMcpServers: [],
    saveMcpServers: vi.fn(() => Promise.resolve()),
    setMcpServers: vi.fn(),
    isMcpServersLoading: false,
  }),
  useMcpConnection: () => ({ testingServers: {}, handleTestMcpConnection: vi.fn(), handleTestMcpConnections: vi.fn() }),
  useMcpModal: () => ({
    showMcpModal: false,
    editingMcpServer: undefined,
    deleteConfirmVisible: false,
    serverToDelete: undefined,
    mcpCollapseKey: [],
    showAddMcpModal: vi.fn(),
    showEditMcpModal: vi.fn(),
    hideMcpModal: vi.fn(),
    showDeleteConfirm: vi.fn(),
    hideDeleteConfirm: vi.fn(),
    toggleServerCollapse: vi.fn(),
  }),
  useMcpServerCRUD: () => ({
    handleAddMcpServer: vi.fn(),
    handleBatchImportMcpServers: vi.fn(),
    handleEditMcpServer: vi.fn(),
    handleDeleteMcpServer: vi.fn(),
  }),
  useMcpOAuth: () => ({
    oauthStatus: {},
    loggingIn: {},
    checkOAuthStatus: vi.fn(),
    markLoginRequired: vi.fn(),
    clearLoginRequired: vi.fn(),
    login: vi.fn(),
  }),
  useMountedMessage: (m: unknown) => m,
}));

vi.mock('@/renderer/services/clientBusinessSettings', () => ({
  getClientBusinessSetting: vi.fn(() => Promise.resolve(undefined)),
  setClientBusinessSetting: vi.fn(() => Promise.resolve()),
  removeClientBusinessSetting: vi.fn(() => Promise.resolve()),
}));

vi.mock('@/common/adapter/ipcBridge', () => ({
  mcpService: {
    updateServer: { invoke: vi.fn() },
    toggleServer: { invoke: vi.fn() },
  },
}));

import { CapabilitiesSection } from '@/renderer/components/settings/SettingsModal/contents/ToolsModalContent';

const stdioServer = (id: string, name: string): IMcpServer => ({
  id,
  name,
  enabled: false,
  builtin: true,
  transport: { type: 'stdio', command: 'npx', args: ['-y', 'pkg'], env: {} },
  created_at: 0,
  updated_at: 0,
  original_json: '{}',
});

describe('CapabilitiesSection', () => {
  const servers = [
    stdioServer(BUILTIN_TAVILY_ID, BUILTIN_TAVILY_NAME),
    stdioServer(BUILTIN_GITHUB_ID, BUILTIN_GITHUB_NAME),
    stdioServer(BUILTIN_POSTGRES_ID, BUILTIN_POSTGRES_NAME),
  ];

  it('renders a row for each tier-2 capability', () => {
    render(
      <CapabilitiesSection
        mcpServers={servers}
        saveMcpServers={vi.fn().mockResolvedValue(undefined)}
        message={{ error: vi.fn(), success: vi.fn() } as never}
      />
    );
    expect(screen.getByText('settings.capabilityWebSearch')).toBeTruthy();
    expect(screen.getByText('settings.capabilityGithub')).toBeTruthy();
    expect(screen.getByText('settings.capabilityPostgres')).toBeTruthy();
  });
});
