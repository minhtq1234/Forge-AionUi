/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import type { TChatConversation } from '@/common/config/storage';
import type { ForgeProject } from '@/common/types/project/projectTypes';
import type { TimelineSection, WorkspaceGroup } from '@/renderer/pages/conversation/GroupedHistory/types';
import { getActivityTime } from '@/renderer/utils/chat/timeline';

import { normalizeWorkspacePath } from './projectStorage';

export type ProjectSidebarGroup = WorkspaceGroup & {
  project_id?: string;
  source: 'project' | 'legacy-workspace';
};

const getWorkspaceGroups = (timelineSections: TimelineSection[]): WorkspaceGroup[] =>
  timelineSections.flatMap((section) =>
    section.items.flatMap((item) => (item.type === 'workspace' && item.workspaceGroup ? [item.workspaceGroup] : []))
  );

const sortConversations = (conversations: TChatConversation[]): TChatConversation[] =>
  [...conversations].toSorted((a, b) => getActivityTime(b) - getActivityTime(a));

const getGroupTime = (group: ProjectSidebarGroup): number => {
  const firstConversation = group.conversations[0];
  if (firstConversation) {
    return getActivityTime(firstConversation);
  }
  return 0;
};

export const buildProjectSidebarGroups = (
  projects: ForgeProject[],
  timelineSections: TimelineSection[]
): ProjectSidebarGroup[] => {
  const workspaceGroups = getWorkspaceGroups(timelineSections);
  const workspaceGroupsByPath = new Map<string, WorkspaceGroup>();

  workspaceGroups.forEach((group) => {
    workspaceGroupsByPath.set(normalizeWorkspacePath(group.workspace), group);
  });

  const projectGroups: ProjectSidebarGroup[] = projects.map((project) => {
    const workspaceKey = normalizeWorkspacePath(project.workspace);
    const workspaceGroup = workspaceGroupsByPath.get(workspaceKey);
    const conversations =
      workspaceGroup?.conversations.filter((conversation) => {
        const projectId = conversation.extra?.project_id;
        return !projectId || projectId === project.id;
      }) ?? [];

    return {
      workspace: project.workspace,
      display_name: project.name,
      conversations: sortConversations(conversations),
      project_id: project.id,
      source: 'project',
    };
  });

  const projectWorkspaceKeys = new Set(projects.map((project) => normalizeWorkspacePath(project.workspace)));
  const legacyGroups: ProjectSidebarGroup[] = workspaceGroups
    .filter((group) => !projectWorkspaceKeys.has(normalizeWorkspacePath(group.workspace)))
    .map((group) => ({
      workspace: group.workspace,
      display_name: group.display_name,
      project_id: undefined as string | undefined,
      conversations: sortConversations(group.conversations),
      source: 'legacy-workspace',
    }));

  return [...projectGroups, ...legacyGroups].toSorted((a, b) => {
    const timeA = getGroupTime(a);
    const timeB = getGroupTime(b);
    if (timeA !== timeB) {
      return timeB - timeA;
    }
    return a.display_name.localeCompare(b.display_name);
  });
};
