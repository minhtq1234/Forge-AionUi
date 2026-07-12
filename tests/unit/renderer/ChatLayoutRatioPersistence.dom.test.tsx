/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import { cleanup, render, screen } from '@testing-library/react';
import React from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// Deliberately does NOT mock useLayoutConstraints — this exercises the REAL
// constraint hook so the test would fail if container-driven clamping ever
// persisted the ratio again (the retired auto-clamp effect).
const mocks = vi.hoisted(() => ({
  containerWidth: 800,
}));

vi.mock('@/renderer/components/agent/AgentBadge', () => ({ AgentLogoIcon: () => null }));
vi.mock('@/renderer/components/layout/FlexFullContainer', () => ({
  default: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
}));
vi.mock('@/renderer/hooks/context/LayoutContext', () => ({
  useLayoutContext: () => ({ isMobile: false, siderCollapsed: false, setSiderCollapsed: vi.fn() }),
}));

// Mimic the real useResizableSplit persistence surface: read the stored ratio
// on mount, and persist through setSplitRatio. This makes any errant persisting
// clamp observable in localStorage.
vi.mock('@/renderer/hooks/ui/useResizableSplit', () => ({
  useResizableSplit: (options: Record<string, unknown>) => {
    const storageKey = options.storageKey as string;
    const stored = localStorage.getItem(storageKey);
    const splitRatio = stored ? parseFloat(stored) : (options.defaultWidth as number);
    return {
      splitRatio,
      setSplitRatio: (ratio: number) => {
        localStorage.setItem(storageKey, String(ratio));
      },
      createDragHandle: () => <div data-testid='split-handle' />,
    };
  },
}));

vi.mock('@/renderer/pages/conversation/components/ChatTitleEditor', () => ({
  default: () => <div data-testid='chat-title' />,
}));
vi.mock('@/renderer/pages/conversation/components/ChatLayout/MobileWorkspaceOverlay', () => ({
  default: () => <div data-testid='mobile-workspace-overlay' />,
}));
vi.mock('@/renderer/pages/conversation/components/ChatLayout/WorkspacePanelHeader', () => ({
  default: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  DesktopWorkspaceToggle: () => null,
}));
vi.mock('@/renderer/pages/conversation/hooks/useContainerWidth', () => ({
  useContainerWidth: () => ({ containerRef: { current: null }, containerWidth: mocks.containerWidth }),
}));
vi.mock('@/renderer/pages/conversation/hooks/useTitleRename', () => ({
  useTitleRename: () => ({
    editingTitle: false,
    setEditingTitle: vi.fn(),
    titleDraft: '',
    setTitleDraft: vi.fn(),
    renameLoading: false,
    canRenameTitle: false,
    submitTitleRename: vi.fn(),
  }),
}));
vi.mock('@/renderer/pages/conversation/hooks/useWorkspaceCollapse', () => ({
  useWorkspaceCollapse: () => ({ rightSiderCollapsed: false, setRightSiderCollapsed: vi.fn() }),
}));
vi.mock('@/renderer/pages/conversation/Preview', () => ({
  PreviewPanel: () => <div data-testid='preview-panel' />,
}));
vi.mock('@/renderer/pages/conversation/utils/detectPlatform', () => ({
  isMacEnvironment: () => true,
  isWindowsEnvironment: () => false,
}));

import ChatLayout from '@/renderer/pages/conversation/components/ChatLayout';

describe('ChatLayout — persisted split ratio survives a narrow container', () => {
  beforeEach(() => {
    mocks.containerWidth = 800;
    localStorage.clear();
  });

  afterEach(() => cleanup());

  it('clamps only the rendered width and never overwrites the stored preference', () => {
    // 90% chat is out of bounds at 800px (dynamic max ≈ 57.5%). The RENDER must
    // clamp, but the STORED preference must remain the user's 90.
    localStorage.setItem('chat-artifact-split-ratio', '90');

    render(
      <ChatLayout title='Chat' sider={<div>workspace</div>} workspaceEnabled workspacePresentation='project-menu'>
        <div>chat</div>
      </ChatLayout>
    );

    // Rendered chat width is clamped into the container-driven bounds.
    expect(screen.getByTestId('chat-layout-chat-pane')).toHaveStyle({ flexBasis: '57.5%' });
    // The stored preference is untouched (no persisting auto-clamp).
    expect(localStorage.getItem('chat-artifact-split-ratio')).toBe('90');
  });
});
