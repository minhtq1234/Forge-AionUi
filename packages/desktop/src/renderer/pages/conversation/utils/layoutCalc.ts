// Layout constants for the chat layout panel sizing
export const MIN_CHAT_RATIO = 25;
export const MIN_ARTIFACT_RATIO = 20;
export const WORKSPACE_HEADER_HEIGHT = 32;
export const MIN_CHAT_PANEL_PX = 360;
export const MIN_ARTIFACT_PANEL_PX = 340;

export type LayoutCalcInput = {
  containerWidth: number;
  chatSplitRatio: number;
  workspaceEnabled: boolean;
  isDesktop: boolean;
  artifactCollapsed: boolean;
};

export type LayoutMetrics = {
  /** 桌面端 artifact 面板是否可见 */
  artifactVisible: boolean;
  dynamicChatMinRatio: number;
  dynamicChatMaxRatio: number;
  /** 聊天区在主区域内的 flex-grow（artifact 关闭时为 100，打开时按 chatSplitRatio 分配） */
  chatFlex: number;
  mobileWorkspaceWidthPx: number;
  titleAreaMaxWidth: number;
  mobileWorkspaceHandleRight: number;
};

/**
 * Compute all derived layout metrics for the two-region (chat | artifact)
 * layout. The chat and artifact panes split the container width by ratio;
 * the artifact pane can be fully collapsed to give chat the full width.
 */
export const calcLayoutMetrics = (input: LayoutCalcInput): LayoutMetrics => {
  const { containerWidth, chatSplitRatio, workspaceEnabled, isDesktop, artifactCollapsed } = input;

  const safeContainerWidth = Math.max(containerWidth || 0, 1);
  const artifactVisible = workspaceEnabled && isDesktop && !artifactCollapsed;

  // 计算 chat / artifact 之间的动态比例约束（基于容器宽度）
  const minChatRatioByPx = (MIN_CHAT_PANEL_PX / safeContainerWidth) * 100;
  const minArtifactRatioByPx = (MIN_ARTIFACT_PANEL_PX / safeContainerWidth) * 100;
  const dynamicChatMinRatio = artifactVisible ? Math.max(MIN_CHAT_RATIO, minChatRatioByPx) : MIN_CHAT_RATIO;
  const dynamicChatMaxCandidate = artifactVisible ? 100 - Math.max(MIN_ARTIFACT_RATIO, minArtifactRatioByPx) : 100;
  const dynamicChatMaxRatio = Math.max(dynamicChatMinRatio, dynamicChatMaxCandidate);

  // chat-area flex（外层 chat+artifact 容器内的聊天面板的 flex-grow）：
  // artifact 打开时按 chatSplitRatio 分配，否则聊天区独占
  const chatFlex = isDesktop ? (artifactVisible ? chatSplitRatio : 100) : 100;

  // 移动端工作空间宽度（覆盖式抽屉）
  const viewportWidth = containerWidth || (typeof window === 'undefined' ? 0 : window.innerWidth);
  const mobileWorkspaceWidthPx = Math.min(
    Math.max(300, Math.round(viewportWidth * 0.84)),
    Math.max(300, Math.min(420, viewportWidth - 20))
  );

  const mobileWorkspaceHandleRight = artifactCollapsed ? 0 : Math.max(0, Math.round(mobileWorkspaceWidthPx) - 14);
  const titleAreaMaxWidth = Math.max(320, Math.min(820, containerWidth - 520));

  return {
    artifactVisible,
    dynamicChatMinRatio,
    dynamicChatMaxRatio,
    chatFlex,
    mobileWorkspaceWidthPx,
    titleAreaMaxWidth,
    mobileWorkspaceHandleRight,
  };
};
