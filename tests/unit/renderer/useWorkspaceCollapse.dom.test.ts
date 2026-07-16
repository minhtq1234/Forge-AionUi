/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import { act, cleanup, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { useWorkspaceCollapse } from '@/renderer/pages/conversation/hooks/useWorkspaceCollapse';
import { WORKSPACE_EXPAND_EVENT, WORKSPACE_HAS_FILES_EVENT } from '@/renderer/utils/workspace/workspaceEvents';

describe('useWorkspaceCollapse — explicit expand', () => {
  beforeEach(() => {
    localStorage.clear();
  });

  afterEach(() => cleanup());

  it('force-expands on WORKSPACE_EXPAND_EVENT even when the stored preference is collapsed', () => {
    localStorage.setItem('workspace-preference-conv-1', 'collapsed');

    const { result } = renderHook(() =>
      useWorkspaceCollapse({
        workspaceEnabled: true,
        isMobile: false,
        conversation_id: 'conv-1',
        preferenceKey: 'conv-1',
        autoExpandOnWorkspaceFiles: false,
      })
    );

    // Product default: the pane starts collapsed ("hidden until content").
    expect(result.current.rightSiderCollapsed).toBe(true);

    act(() => {
      window.dispatchEvent(new CustomEvent(WORKSPACE_EXPAND_EVENT));
    });

    expect(result.current.rightSiderCollapsed).toBe(false);
    // The explicit reveal must not rewrite the persisted preference.
    expect(localStorage.getItem('workspace-preference-conv-1')).toBe('collapsed');
  });

  it('ignores the expand event when the workspace is disabled', () => {
    const { result } = renderHook(() =>
      useWorkspaceCollapse({
        workspaceEnabled: false,
        isMobile: false,
        conversation_id: 'conv-2',
        preferenceKey: 'conv-2',
      })
    );

    act(() => {
      window.dispatchEvent(new CustomEvent(WORKSPACE_EXPAND_EVENT));
    });

    expect(result.current.rightSiderCollapsed).toBe(true);
  });

  it('keeps a single-chat artifact pane collapsed when project files are present', () => {
    const { result } = renderHook(() =>
      useWorkspaceCollapse({
        workspaceEnabled: true,
        isMobile: false,
        conversation_id: 'conv-3',
        preferenceKey: 'conv-3',
        autoExpandOnWorkspaceFiles: false,
      })
    );

    act(() => {
      window.dispatchEvent(
        new CustomEvent(WORKSPACE_HAS_FILES_EVENT, { detail: { hasFiles: true, isInitial: false } })
      );
    });

    expect(result.current.rightSiderCollapsed).toBe(true);
  });

  it('keeps file-driven expansion for a team workspace pane', () => {
    const { result } = renderHook(() =>
      useWorkspaceCollapse({
        workspaceEnabled: true,
        isMobile: false,
        conversation_id: 'conv-4',
        preferenceKey: 'team-1',
        autoExpandOnWorkspaceFiles: true,
      })
    );

    act(() => {
      window.dispatchEvent(
        new CustomEvent(WORKSPACE_HAS_FILES_EVENT, { detail: { hasFiles: true, isInitial: false } })
      );
    });

    expect(result.current.rightSiderCollapsed).toBe(false);
  });
});
