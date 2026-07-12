/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import type { TChatConversation } from '@/common/config/storage';
import type { ForgeProject } from '@/common/types/project/projectTypes';

import { findProjectByWorkspace, readProjects } from './projectStorage';

export const resolveConversationProject = (
  conversation: Pick<TChatConversation, 'extra'> | null | undefined,
  projects: ForgeProject[] = readProjects()
): ForgeProject | null => {
  const projectId = conversation?.extra?.project_id;
  if (projectId) {
    const projectById = projects.find((project) => project.id === projectId);
    if (projectById) {
      return projectById;
    }
  }
  const workspace = conversation?.extra?.workspace;
  return workspace ? findProjectByWorkspace(workspace, projects) : null;
};

export const buildDetachedProjectExtra = (conversation: TChatConversation): TChatConversation['extra'] => {
  const { project_id: _projectId, ...restExtra } = conversation.extra;
  return {
    ...restExtra,
    custom_workspace: false,
  } as TChatConversation['extra'];
};
