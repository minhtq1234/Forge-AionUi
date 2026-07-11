/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import { cleanup, render, screen } from '@testing-library/react';
import React from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  mobile: false,
  previewOpen: true,
  previewPanelProps: vi.fn(),
  resizableSplitOptions: [] as Array<Record<string, unknown>>,
}));

vi.mock('@/renderer/components/agent/AgentBadge', () => ({ AgentLogoIcon: () => null }));

vi.mock('@/renderer/components/layout/FlexFullContainer', () => ({
  default: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
}));

vi.mock('@/renderer/hooks/context/LayoutContext', () => ({
  useLayoutContext: () => ({ isMobile: mocks.mobile, siderCollapsed: false, setSiderCollapsed: vi.fn() }),
}));

vi.mock('@/renderer/hooks/ui/useResizableSplit', () => ({
  useResizableSplit: (options: Record<string, unknown>) => {
    mocks.resizableSplitOptions.push(options);
    const splitRatio = options.defaultWidth as number;
    return {
      splitRatio,
      setSplitRatio: vi.fn(),
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
  useContainerWidth: () => ({ containerRef: { current: null }, containerWidth: 1200 }),
}));

vi.mock('@/renderer/pages/conversation/hooks/useLayoutConstraints', () => ({ useLayoutConstraints: vi.fn() }));

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
  useWorkspaceCollapse: () => ({ rightSiderCollapsed: true, setRightSiderCollapsed: vi.fn() }),
}));

vi.mock('@/renderer/pages/conversation/Preview', () => ({
  usePreviewContext: () => ({ isOpen: mocks.previewOpen }),
  PreviewPanel: (props: Record<string, unknown>) => {
    mocks.previewPanelProps(props);
    return <div data-testid='mock-preview-panel' />;
  },
}));

vi.mock('@/renderer/pages/conversation/utils/detectPlatform', () => ({
  isMacEnvironment: () => true,
  isWindowsEnvironment: () => false,
}));

import ChatLayout from '@/renderer/pages/conversation/components/ChatLayout';

const renderLayout = (workspacePresentation: 'panel' | 'project-menu') =>
  render(
    <ChatLayout
      title='Artifact editor'
      sider={<div>workspace</div>}
      workspaceEnabled
      workspacePresentation={workspacePresentation}
    >
      <div data-testid='chat-content'>chat</div>
    </ChatLayout>
  );

describe('ChatLayout artifact editor split', () => {
  beforeEach(() => {
    mocks.mobile = false;
    mocks.previewOpen = true;
    mocks.previewPanelProps.mockClear();
    mocks.resizableSplitOptions.length = 0;
  });

  afterEach(() => cleanup());

  it('uses a clean adjustable 50/50 split for the Project-menu workspace', () => {
    renderLayout('project-menu');

    expect(mocks.resizableSplitOptions).toContainEqual(
      expect.objectContaining({
        defaultWidth: 50,
        storageKey: 'artifact-editor-chat-preview-split-ratio',
      })
    );

    const chatPane = screen.getByTestId('chat-layout-chat-pane');
    const previewPane = screen.getByTestId('chat-layout-preview-pane');
    expect(chatPane.compareDocumentPosition(previewPane) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(chatPane).toHaveStyle({ flexBasis: '50%' });
    expect(previewPane).not.toHaveClass('rounded-[15px]', 'mb-[12px]', 'mr-[12px]', 'ml-[8px]');
    expect(previewPane).toHaveStyle({ borderWidth: '0px' });
    expect(mocks.previewPanelProps).toHaveBeenCalledWith(expect.objectContaining({ fullBleed: true }));
  });

  it('preserves the legacy preview preference and card framing', () => {
    renderLayout('panel');

    expect(mocks.resizableSplitOptions).toContainEqual(
      expect.objectContaining({ defaultWidth: 60, storageKey: 'chat-preview-split-ratio' })
    );

    const previewPane = screen.getByTestId('chat-layout-preview-pane');
    expect(previewPane).toHaveClass('rounded-[15px]', 'mb-[12px]', 'mr-[12px]', 'ml-[8px]');
    expect(mocks.previewPanelProps).toHaveBeenCalledWith(expect.objectContaining({ fullBleed: false }));
    expect(document.querySelector('.chat-layout-right-sider')).toBeInTheDocument();
  });

  it('keeps the artifact preference stable while preserving mobile preview framing', () => {
    mocks.mobile = true;
    renderLayout('project-menu');

    expect(mocks.resizableSplitOptions).toContainEqual(
      expect.objectContaining({
        defaultWidth: 50,
        storageKey: 'artifact-editor-chat-preview-split-ratio',
      })
    );
    expect(screen.getByTestId('chat-layout-preview-pane')).toHaveClass('rounded-[15px]', 'm-[8px]');
    expect(mocks.previewPanelProps).toHaveBeenCalledWith(expect.objectContaining({ fullBleed: false }));
    expect(screen.queryByTestId('mobile-workspace-overlay')).not.toBeInTheDocument();
  });

  it('preserves the enabled legacy mobile workspace overlay', () => {
    mocks.mobile = true;
    renderLayout('panel');

    expect(screen.getByTestId('mobile-workspace-overlay')).toBeInTheDocument();
  });

  it('restores chat to the full content area when the preview closes', () => {
    mocks.previewOpen = false;
    renderLayout('project-menu');

    expect(screen.queryByTestId('chat-layout-preview-pane')).not.toBeInTheDocument();
    expect(screen.getByTestId('chat-layout-chat-pane')).toHaveStyle({ flexGrow: '1', flexBasis: '0px' });
  });
});
