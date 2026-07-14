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
  resizableSplitOptions: [] as Array<Record<string, unknown>>,
  dragHandleOptions: [] as Array<Record<string, unknown>>,
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
    let splitRatio = options.defaultWidth as number;
    if (typeof options.storageKey === 'string') {
      try {
        const stored = localStorage.getItem(options.storageKey);
        if (stored) {
          const parsed = parseFloat(stored);
          if (!Number.isNaN(parsed)) {
            splitRatio = parsed;
          }
        }
      } catch {
        // ignore
      }
    }
    return {
      splitRatio,
      setSplitRatio: vi.fn(),
      createDragHandle: (opts: Record<string, unknown> = {}) => {
        mocks.dragHandleOptions.push(opts);
        return <div data-testid='split-handle' />;
      },
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
  useWorkspaceCollapse: () => ({ rightSiderCollapsed: mocks.artifactCollapsed, setRightSiderCollapsed: vi.fn() }),
}));

vi.mock('@/renderer/pages/conversation/Preview', () => ({
  PreviewPanel: () => <div data-testid='preview-panel' />,
}));

vi.mock('@/renderer/pages/conversation/utils/detectPlatform', () => ({
  isMacEnvironment: () => true,
  isWindowsEnvironment: () => false,
}));

import ChatLayout from '@/renderer/pages/conversation/components/ChatLayout';

const renderLayout = (workspacePresentation: 'panel' | 'project-menu' = 'project-menu') =>
  render(
    <ChatLayout
      title='Chat'
      sider={<div data-testid='legacy-sider'>workspace</div>}
      workspaceEnabled
      workspacePresentation={workspacePresentation}
    >
      <div data-testid='chat-content'>chat</div>
    </ChatLayout>
  );

describe('ChatLayout chat + artifact two-region split (single chat / project-menu)', () => {
  beforeEach(() => {
    mocks.mobile = false;
    mocks.artifactCollapsed = false;
    mocks.resizableSplitOptions.length = 0;
    mocks.dragHandleOptions.length = 0;
    localStorage.clear();
  });

  afterEach(() => cleanup());

  it('renders the always-open artifact preview pane as a single-bar surface', () => {
    renderLayout();

    const artifactPane = screen.getByTestId('artifact-pane');
    expect(artifactPane).toBeInTheDocument();
    expect(artifactPane).toHaveClass('layout-sider');
    // Single bar: the PreviewPanel owns the pane chrome, no extra workspace header.
    expect(artifactPane.querySelector('[data-testid="workspace-panel-header"]')).toBeNull();
  });

  it('mounts PreviewPanel inside the pane (not the legacy workspace sider body)', () => {
    renderLayout();

    const artifactPane = screen.getByTestId('artifact-pane');
    const previewPanel = screen.getByTestId('preview-panel');
    expect(artifactPane).toContainElement(previewPanel);
    // props.sider is not mounted inside the artifact pane.
    expect(artifactPane).not.toContainElement(screen.getByTestId('legacy-sider'));
  });

  it('drives the layout from a single chat<->artifact ratio split', () => {
    renderLayout();

    expect(mocks.resizableSplitOptions).toHaveLength(1);
    expect(mocks.resizableSplitOptions[0]).toEqual(
      expect.objectContaining({ unit: 'ratio', defaultWidth: 50, storageKey: 'chat-artifact-split-ratio' })
    );
  });

  it('initializes the chat width from the persisted chat-artifact-split-ratio', () => {
    localStorage.setItem('chat-artifact-split-ratio', '40');
    renderLayout();

    expect(screen.getByTestId('chat-layout-chat-pane')).toHaveStyle({ flexBasis: '40%' });
  });

  it('places the divider handle so dragging right grows chat (chat-is-left semantics)', () => {
    renderLayout();

    // The handle drives chatSplitRatio (the LEFT/chat pane), so it must NOT be
    // reversed — reverse:true would drag the divider backwards.
    expect(mocks.dragHandleOptions).toHaveLength(1);
    expect(mocks.dragHandleOptions[0].reverse).toBeFalsy();
    expect(mocks.dragHandleOptions[0].linePlacement).toBe('start');
  });

  it('removes the artifact pane from the DOM when collapsed and gives chat the full width', () => {
    mocks.artifactCollapsed = true;
    renderLayout();

    expect(screen.queryByTestId('artifact-pane')).not.toBeInTheDocument();
    expect(screen.queryByTestId('preview-panel')).not.toBeInTheDocument();
    expect(screen.getByTestId('chat-layout-chat-pane')).toHaveStyle({ flexGrow: '1', flexBasis: '0px' });
  });

  it('routes the artifact pane through the mobile overlay on mobile', () => {
    mocks.mobile = true;
    renderLayout();

    expect(screen.getByTestId('mobile-workspace-overlay')).toBeInTheDocument();
    expect(screen.queryByTestId('artifact-pane')).not.toBeInTheDocument();
  });
});

describe('ChatLayout team workspace pane (panel presentation)', () => {
  beforeEach(() => {
    mocks.mobile = false;
    mocks.artifactCollapsed = false;
    mocks.resizableSplitOptions.length = 0;
    mocks.dragHandleOptions.length = 0;
    localStorage.clear();
  });

  afterEach(() => cleanup());

  it('keeps the workspace file tree (props.sider) in the pane, not PreviewPanel', () => {
    renderLayout('panel');

    const artifactPane = screen.getByTestId('artifact-pane');
    expect(artifactPane).toContainElement(screen.getByTestId('legacy-sider'));
    expect(artifactPane).toContainElement(screen.getByTestId('workspace-panel-header'));
    expect(screen.queryByTestId('preview-panel')).not.toBeInTheDocument();
  });

  it('uses its own workspace split storage key and a narrower default', () => {
    renderLayout('panel');

    expect(mocks.resizableSplitOptions).toHaveLength(1);
    expect(mocks.resizableSplitOptions[0]).toEqual(
      expect.objectContaining({ unit: 'ratio', defaultWidth: 70, storageKey: 'chat-workspace-split-ratio' })
    );
  });

  it('does not reverse the divider handle (chat-is-left semantics)', () => {
    renderLayout('panel');

    expect(mocks.dragHandleOptions).toHaveLength(1);
    expect(mocks.dragHandleOptions[0].reverse).toBeFalsy();
  });

  it('keeps the file tree mounted at zero width when collapsed (auto-expand preserved)', () => {
    mocks.artifactCollapsed = true;
    renderLayout('panel');

    // The pane stays in the DOM (unlike project-menu) so WORKSPACE_HAS_FILES keeps firing.
    const artifactPane = screen.getByTestId('artifact-pane');
    expect(artifactPane).toContainElement(screen.getByTestId('legacy-sider'));
    expect(artifactPane).toHaveStyle({ width: '0px' });
  });
});
