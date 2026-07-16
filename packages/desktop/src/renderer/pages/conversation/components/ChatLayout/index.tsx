import { AgentLogoIcon } from '@/renderer/components/agent/AgentBadge';
import type { PresetAssistantInfo } from '@/renderer/hooks/agent/usePresetAssistantInfo';
import FlexFullContainer from '@/renderer/components/layout/FlexFullContainer';
import { useLayoutContext } from '@/renderer/hooks/context/LayoutContext';
import { useResizableSplit } from '@/renderer/hooks/ui/useResizableSplit';
import ChatTitleEditor from '@/renderer/pages/conversation/components/ChatTitleEditor';
import MobileWorkspaceOverlay from './MobileWorkspaceOverlay';
import WorkspacePanelHeader, { DesktopWorkspaceToggle } from './WorkspacePanelHeader';
import { useContainerWidth } from '@/renderer/pages/conversation/hooks/useContainerWidth';
import { useLayoutConstraints } from '@/renderer/pages/conversation/hooks/useLayoutConstraints';
import { useTitleRename } from '@/renderer/pages/conversation/hooks/useTitleRename';
import { useWorkspaceCollapse } from '@/renderer/pages/conversation/hooks/useWorkspaceCollapse';
import { PreviewPanel } from '@/renderer/pages/conversation/Preview';
import { dispatchWorkspaceToggleEvent } from '@/renderer/utils/workspace/workspaceEvents';
import classNames from 'classnames';
import { isMacEnvironment, isWindowsEnvironment } from '@/renderer/pages/conversation/utils/detectPlatform';
import { calcLayoutMetrics } from '@/renderer/pages/conversation/utils/layoutCalc';
import { Layout as ArcoLayout } from '@arco-design/web-react';
import { ExpandLeft, ExpandRight } from '@icon-park/react';
import React, { useCallback, useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import './chat-layout.css';

// headerExtra allows injecting custom actions (e.g., model picker) into the header's right area
const ChatLayout: React.FC<{
  children: React.ReactNode;
  title?: React.ReactNode;
  sider: React.ReactNode;
  siderTitle?: React.ReactNode;
  backend?: string;
  /** Preset assistant info — when provided, badge shows assistant identity instead of backend */
  presetAssistant?: PresetAssistantInfo & { id?: string };
  /** Fallback agent name (used when no presetAssistant, e.g. from conversation.extra.agent_name) */
  agent_name?: string;
  headerExtra?: React.ReactNode;
  workspaceEnabled?: boolean;
  workspacePresentation?: 'panel' | 'project-menu';
  /** Conversation ID for mode switching */
  conversation_id?: string;
  /** Custom tabs slot; when provided, replaces the default ConversationTabs */
  tabsSlot?: React.ReactNode;
  /** Workspace path for opening in external tools */
  workspacePath?: string;
  /** Authoritative temp-workspace flag from `conversation.extra.is_temporary_workspace`. */
  isTemporaryWorkspace?: boolean;
  /**
   * Stable key for persisting the workspace collapse preference. Defaults to
   * `conversation_id` for single chats; team mode passes `team_id` so the
   * preference survives agent-tab switches.
   */
  workspacePreferenceKey?: string;
  /** Custom rename handler; when provided, replaces the default conversation.update rename flow */
  onRenameTitle?: (new_name: string) => Promise<boolean>;
  /** Optional override for the leading icon shown before the title (e.g. team Peoples icon) */
  headerLeading?: React.ReactNode;
}> = (props) => {
  const { conversation_id, workspacePath, isTemporaryWorkspace } = props;
  const {
    backend,
    presetAssistant,
    agent_name,
    workspaceEnabled = true,
    workspacePreferenceKey,
    workspacePresentation = 'panel',
  } = props;
  // `panel` (team) keeps its workspace file tree in the pane; `project-menu`
  // (single chat) renders the always-open artifact preview instead.
  const isWorkspacePanePresentation = workspacePresentation === 'panel';
  const layout = useLayoutContext();
  const isMacRuntime = isMacEnvironment();
  const isWindowsRuntime = isWindowsEnvironment();
  const isDesktop = !layout?.isMobile;
  const isMobile = Boolean(layout?.isMobile);

  // --- Hook A: artifact-pane collapse (formerly the right workspace sider) ---
  const { rightSiderCollapsed: artifactCollapsed, setRightSiderCollapsed: setArtifactCollapsed } = useWorkspaceCollapse(
    {
      workspaceEnabled,
      isMobile,
      conversation_id,
      preferenceKey: workspacePreferenceKey ?? conversation_id,
      isTemporaryWorkspace,
      autoExpandOnWorkspaceFiles: isWorkspacePanePresentation,
    }
  );
  const collapseArtifactPane = useCallback(() => setArtifactCollapsed(true), [setArtifactCollapsed]);

  // --- Hook B: container width ---
  const { containerRef, containerWidth } = useContainerWidth();

  // --- Hook C: title rename ---
  const { editingTitle, setEditingTitle, titleDraft, setTitleDraft, renameLoading, canRenameTitle, submitTitleRename } =
    useTitleRename({
      title: props.title,
      conversation_id,
      onRename: props.onRenameTitle,
    });

  const capitalizedBackend = backend ? backend.charAt(0).toUpperCase() + backend.slice(1) : backend;

  // Compute display name with fallback chain
  const display_name = presetAssistant?.name || agent_name || capitalizedBackend;

  // Pre-hook metrics: compute dynamic min/max for the chat<->artifact split hook
  const { dynamicChatMinRatio, dynamicChatMaxRatio } = calcLayoutMetrics({
    containerWidth,
    chatSplitRatio: 50, // placeholder; only dynamicChatMinRatio/dynamicChatMaxRatio are used here
    workspaceEnabled,
    isDesktop,
    artifactCollapsed,
  });

  // Single ratio split between chat and the always-open artifact pane.
  const { splitRatio: chatSplitRatio, createDragHandle: createArtifactDragHandle } = useResizableSplit({
    unit: 'ratio',
    // Team keeps the workspace as a narrower sidebar (chat gets more room);
    // single chat splits evenly with the artifact preview.
    defaultWidth: isWorkspacePanePresentation ? 70 : 50,
    minWidth: dynamicChatMinRatio,
    maxWidth: dynamicChatMaxRatio,
    storageKey: isWorkspacePanePresentation ? 'chat-workspace-split-ratio' : 'chat-artifact-split-ratio',
  });

  // Clamp only the RENDERED ratio into the container-driven bounds. The stored
  // preference (`chatSplitRatio`) is left untouched so a transient narrow width
  // never overwrites it — only explicit drag/reset mutate the stored value.
  const effectiveChatSplitRatio = Math.max(dynamicChatMinRatio, Math.min(dynamicChatMaxRatio, chatSplitRatio));

  // Full metrics with the effective (clamped) chatSplitRatio
  const { artifactVisible, chatFlex, mobileWorkspaceWidthPx, titleAreaMaxWidth, mobileWorkspaceHandleRight } =
    calcLayoutMetrics({
      containerWidth,
      chatSplitRatio: effectiveChatSplitRatio,
      workspaceEnabled,
      isDesktop,
      artifactCollapsed,
    });

  // --- Hook E: layout constraints ---
  useLayoutConstraints({
    containerWidth,
    workspaceEnabled,
    isDesktop,
    artifactCollapsed,
    setArtifactCollapsed,
  });

  const [mobileActionsSlot, setMobileActionsSlot] = useState<HTMLElement | null>(null);
  useEffect(() => {
    if (!layout?.isMobile) {
      setMobileActionsSlot(null);
      return;
    }
    const findSlot = () => document.getElementById('app-titlebar-actions-slot');
    setMobileActionsSlot(findSlot());
    const observer = new MutationObserver(() => {
      const next = findSlot();
      setMobileActionsSlot((prev) => (prev === next ? prev : next));
    });
    observer.observe(document.body, { childList: true, subtree: true });
    return () => observer.disconnect();
  }, [layout?.isMobile]);

  const desktopHeader = (
    <ArcoLayout.Header
      className={classNames(
        'min-h-44px flex items-center justify-between px-16px pt-8px pb-10px gap-16px !bg-1 chat-layout-header chat-layout-header--glass overflow-hidden'
      )}
    >
      <FlexFullContainer className='h-full min-w-0' containerClassName='flex items-center'>
        <ChatTitleEditor
          editingTitle={editingTitle}
          titleDraft={titleDraft}
          setTitleDraft={setTitleDraft}
          setEditingTitle={setEditingTitle}
          renameLoading={renameLoading}
          canRenameTitle={canRenameTitle}
          submitTitleRename={submitTitleRename}
          titleAreaMaxWidth={titleAreaMaxWidth}
          title={props.title}
          conversation_id={conversation_id}
          leading={
            props.headerLeading ??
            ((backend || presetAssistant) && (
              <AgentLogoIcon
                backend={backend}
                agent_name={display_name}
                agentLogo={presetAssistant?.logo}
                agentLogoIsEmoji={presetAssistant?.isEmoji}
                agentLogoIsFallback={presetAssistant?.isFallback}
              />
            ))
          }
        />
      </FlexFullContainer>
      <div className='flex items-center gap-12px shrink-0'>
        {props.headerExtra}
        {isWindowsRuntime && workspaceEnabled && (
          <button
            type='button'
            className='workspace-header__toggle'
            aria-label='Toggle workspace'
            onClick={() => dispatchWorkspaceToggleEvent()}
          >
            {artifactCollapsed ? <ExpandRight size={16} /> : <ExpandLeft size={16} />}
          </button>
        )}
      </div>
    </ArcoLayout.Header>
  );

  const headerBlock = (
    <>
      {layout?.isMobile
        ? mobileActionsSlot && props.headerExtra && createPortal(props.headerExtra, mobileActionsSlot)
        : desktopHeader}
      {props.tabsSlot}
    </>
  );

  return (
    <ArcoLayout
      className='size-full color-black '
      style={{
        // fontFamily: `cursive,"anthropicSans","anthropicSans Fallback",system-ui,Segoe UI,Roboto,Helvetica,Arial,sans-serif`,
      }}
    >
      <div ref={containerRef} className='flex flex-1 relative w-full overflow-hidden'>
        {workspaceEnabled && workspacePresentation === 'project-menu' && (
          <div className='workspace-project-controller'>{props.sider}</div>
        )}
        {/* Chat region — header + content. Never unmounts when the artifact pane toggles. */}
        <div
          data-testid='chat-layout-chat-pane'
          className='flex flex-col relative min-w-0'
          style={{
            flexGrow: artifactVisible ? 0 : 1,
            flexShrink: artifactVisible ? 0 : 1,
            flexBasis: artifactVisible ? `${chatFlex}%` : 0,
          }}
          onClick={() => {
            if (window.innerWidth < 768 && !artifactCollapsed) setArtifactCollapsed(true);
          }}
        >
          <div className='shrink-0 !bg-1'>{headerBlock}</div>
          <ArcoLayout.Content
            className='flex flex-col flex-1 overflow-hidden'
            style={{ background: 'var(--bg-chat-surface)' }}
          >
            {props.children}
          </ArcoLayout.Content>
        </div>
        {/*
          Artifact pane — the single region right of chat. Its content and mount
          behavior are presentation dependent:
          - `panel` (team) keeps the workspace file tree behind the
            WorkspacePanelHeader chrome, and — like the pre-refactor right sider —
            stays mounted at 0 width while collapsed so its WORKSPACE_HAS_FILES
            events keep firing and can auto-expand the pane.
          - `project-menu` (single chat) mounts the always-open PreviewPanel as a
            single-bar artifact surface whose tab-bar close button collapses the
            pane. It is removed from the DOM while collapsed (its file events come
            from the always-mounted project-menu controller above, not the pane).
        */}
        {isWorkspacePanePresentation && workspaceEnabled && !isMobile && (
          <div
            data-testid='artifact-pane'
            className='relative flex flex-col min-w-0 layout-sider'
            style={{
              background: 'var(--bg-artifact-surface)',
              flexGrow: artifactCollapsed ? 0 : 1,
              flexShrink: 0,
              flexBasis: artifactCollapsed ? '0px' : 0,
              width: artifactCollapsed ? '0px' : undefined,
              overflow: 'hidden',
              borderLeft: artifactCollapsed ? 'none' : '1px solid var(--bg-3)',
            }}
          >
            {!artifactCollapsed &&
              createArtifactDragHandle({ className: 'absolute left-0 top-0 bottom-0 z-30', linePlacement: 'start' })}
            <WorkspacePanelHeader
              showToggle={!isMacRuntime && !isWindowsRuntime}
              collapsed={artifactCollapsed}
              onToggle={() => dispatchWorkspaceToggleEvent()}
              togglePlacement='right'
              workspacePath={workspacePath}
              isTemporaryWorkspace={isTemporaryWorkspace}
            >
              {props.siderTitle}
            </WorkspacePanelHeader>
            <div className='flex-1 min-h-0 overflow-hidden'>{props.sider}</div>
          </div>
        )}
        {!isWorkspacePanePresentation && artifactVisible && (
          <div
            data-testid='artifact-pane'
            className='relative flex flex-col min-w-0 layout-sider'
            style={{
              background: 'var(--bg-artifact-surface)',
              flexGrow: 1,
              flexShrink: 1,
              flexBasis: 0,
              overflow: 'hidden',
              borderLeft: '1px solid var(--bg-3)',
            }}
          >
            {createArtifactDragHandle({ className: 'absolute left-0 top-0 bottom-0 z-30', linePlacement: 'start' })}
            <div className='flex-1 min-h-0 overflow-hidden'>
              <PreviewPanel fullBleed onRequestCollapse={collapseArtifactPane} />
            </div>
          </div>
        )}

        {/* Mobile artifact overlay: backdrop + fixed drawer + floating collapse handle */}
        {workspaceEnabled && layout?.isMobile && (
          <MobileWorkspaceOverlay
            rightSiderCollapsed={artifactCollapsed}
            setRightSiderCollapsed={setArtifactCollapsed}
            workspaceWidthPx={mobileWorkspaceWidthPx}
            mobileWorkspaceHandleRight={mobileWorkspaceHandleRight}
            siderTitle={props.siderTitle}
            sider={
              isWorkspacePanePresentation ? (
                props.sider
              ) : (
                <PreviewPanel fullBleed onRequestCollapse={collapseArtifactPane} />
              )
            }
            workspacePath={workspacePath}
            isTemporaryWorkspace={isTemporaryWorkspace}
          />
        )}

        {/* Desktop expand button when the artifact pane is collapsed */}
        {!isMacRuntime && !isWindowsRuntime && workspaceEnabled && artifactCollapsed && !layout?.isMobile && (
          <DesktopWorkspaceToggle />
        )}
      </div>
    </ArcoLayout>
  );
};

export default ChatLayout;
