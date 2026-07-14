import { MIN_ARTIFACT_PANEL_PX, MIN_CHAT_PANEL_PX } from '@/renderer/pages/conversation/utils/layoutCalc';
import { useEffect } from 'react';

type UseLayoutConstraintsParams = {
  containerWidth: number;
  workspaceEnabled: boolean;
  isDesktop: boolean;
  artifactCollapsed: boolean;
  setArtifactCollapsed: React.Dispatch<React.SetStateAction<boolean>>;
};

/**
 * Auto-collapses the artifact pane when the container is too narrow to fit both
 * the chat and artifact panes side by side above their minimum pixel widths.
 *
 * The chat<->artifact split ratio is NOT clamped here: the stored preference is
 * mutated only by explicit user action (drag / double-click reset, both clamped
 * inside `useResizableSplit`). Container-driven clamping is applied at render
 * time (see ChatLayout's effective ratio) so a transient narrow width never
 * overwrites the persisted ratio.
 */
export function useLayoutConstraints({
  containerWidth,
  workspaceEnabled,
  isDesktop,
  artifactCollapsed,
  setArtifactCollapsed,
}: UseLayoutConstraintsParams): void {
  useEffect(() => {
    if (!workspaceEnabled || !isDesktop || artifactCollapsed) {
      return;
    }
    const safeContainerWidth = Math.max(containerWidth || 0, 1);
    if (safeContainerWidth < MIN_CHAT_PANEL_PX + MIN_ARTIFACT_PANEL_PX) {
      setArtifactCollapsed(true);
    }
  }, [artifactCollapsed, containerWidth, isDesktop, setArtifactCollapsed, workspaceEnabled]);
}
