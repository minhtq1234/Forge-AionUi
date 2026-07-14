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
  artifactCollapsed: false,
  previewPanelProps: vi.fn(),
  resizableSplitOptions: [] as Array<Record<string, unknown>>,
  workspaceCollapseOptions: [] as Array<Record<string, unknown>>,
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
  default: ({ children }: { children: React.ReactNode }) => <div data-testid='workspace-panel-header'>{children}</div>,
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
  useWorkspaceCollapse: (options: Record<string, unknown>) => {
    mocks.workspaceCollapseOptions.push(options);
    return { rightSiderCollapsed: mocks.artifactCollapsed, setRightSiderCollapsed: vi.fn() };
  },
}));

vi.mock('@/renderer/pages/conversation/Preview', () => ({
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
      sider={<div data-testid='legacy-sider'>workspace</div>}
      workspaceEnabled
      workspacePresentation={workspacePresentation}
    >
      <div data-testid='chat-content'>chat</div>
    </ChatLayout>
  );

describe('ChatLayout artifact pane', () => {
  beforeEach(() => {
    mocks.mobile = false;
    mocks.artifactCollapsed = false;
    mocks.previewPanelProps.mockClear();
    mocks.resizableSplitOptions.length = 0;
    mocks.workspaceCollapseOptions.length = 0;
  });

  afterEach(() => cleanup());

  it('mounts a single-bar, full-bleed PreviewPanel for the single-chat (project-menu) pane', () => {
    renderLayout('project-menu');

    expect(mocks.resizableSplitOptions).toHaveLength(1);
    expect(mocks.resizableSplitOptions[0]).toEqual(
      expect.objectContaining({ unit: 'ratio', defaultWidth: 50, storageKey: 'chat-artifact-split-ratio' })
    );

    const chatPane = screen.getByTestId('chat-layout-chat-pane');
    const artifactPane = screen.getByTestId('artifact-pane');
    expect(chatPane.compareDocumentPosition(artifactPane) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(chatPane).toHaveStyle({ flexBasis: '50%' });
    expect(artifactPane).toContainElement(screen.getByTestId('mock-preview-panel'));
    expect(mocks.previewPanelProps).toHaveBeenCalledWith(expect.objectContaining({ fullBleed: true }));
    // Single bar: no WorkspacePanelHeader stacked above the preview.
    expect(artifactPane.querySelector('[data-testid="workspace-panel-header"]')).toBeNull();
  });

  it('keeps the team (panel) workspace file tree in the pane with its own split key', () => {
    renderLayout('panel');

    expect(mocks.resizableSplitOptions).toHaveLength(1);
    expect(mocks.resizableSplitOptions[0]).toEqual(
      expect.objectContaining({ unit: 'ratio', defaultWidth: 70, storageKey: 'chat-workspace-split-ratio' })
    );

    const artifactPane = screen.getByTestId('artifact-pane');
    expect(artifactPane).toContainElement(screen.getByTestId('legacy-sider'));
    expect(artifactPane).toContainElement(screen.getByTestId('workspace-panel-header'));
    expect(screen.queryByTestId('mock-preview-panel')).not.toBeInTheDocument();
  });

  it('enables file-driven expansion only for the team workspace pane', () => {
    const { unmount } = renderLayout('project-menu');
    expect(mocks.workspaceCollapseOptions.at(-1)).toEqual(
      expect.objectContaining({ autoExpandOnWorkspaceFiles: false })
    );
    unmount();

    renderLayout('panel');
    expect(mocks.workspaceCollapseOptions.at(-1)).toEqual(
      expect.objectContaining({ autoExpandOnWorkspaceFiles: true })
    );
  });

  it('drops the legacy preview pane and the separate workspace sider markup', () => {
    renderLayout('project-menu');

    expect(screen.queryByTestId('chat-layout-preview-pane')).not.toBeInTheDocument();
    expect(document.querySelector('.chat-layout-right-sider')).not.toBeInTheDocument();
  });

  it('renders the headless project-menu controller only for the project-menu presentation', () => {
    const { unmount } = renderLayout('project-menu');
    expect(document.querySelector('.workspace-project-controller')).toBeInTheDocument();
    unmount();

    renderLayout('panel');
    expect(document.querySelector('.workspace-project-controller')).not.toBeInTheDocument();
  });

  it('removes the project-menu pane from the DOM when collapsed and fills chat', () => {
    mocks.artifactCollapsed = true;
    renderLayout('project-menu');

    expect(screen.queryByTestId('artifact-pane')).not.toBeInTheDocument();
    expect(screen.getByTestId('chat-layout-chat-pane')).toHaveStyle({ flexGrow: '1', flexBasis: '0px' });
  });

  it('keeps the team (panel) pane mounted at zero width when collapsed', () => {
    mocks.artifactCollapsed = true;
    renderLayout('panel');

    const artifactPane = screen.getByTestId('artifact-pane');
    expect(artifactPane).toContainElement(screen.getByTestId('legacy-sider'));
    expect(artifactPane).toHaveStyle({ width: '0px' });
    expect(screen.getByTestId('chat-layout-chat-pane')).toHaveStyle({ flexGrow: '1', flexBasis: '0px' });
  });

  it.each(['panel', 'project-menu'] as const)(
    'routes the artifact pane through the mobile overlay for %s',
    (presentation) => {
      mocks.mobile = true;
      renderLayout(presentation);

      expect(screen.getByTestId('mobile-workspace-overlay')).toBeInTheDocument();
      expect(screen.queryByTestId('artifact-pane')).not.toBeInTheDocument();
    }
  );
});
