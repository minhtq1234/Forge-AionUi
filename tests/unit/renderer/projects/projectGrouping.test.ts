/**
 * @vitest-environment node
 */

import { describe, expect, it } from 'vitest';
import type { ForgeProject } from '@/common/types/project/projectTypes';
import type { TChatConversation } from '@/common/config/storage';
import type { TimelineSection } from '@/renderer/pages/conversation/GroupedHistory/types';
import { buildProjectSidebarGroups } from '@/renderer/pages/conversation/projects/projectGrouping';

const conversation = (id: string, workspace: string, projectId?: string): TChatConversation =>
  ({
    id,
    name: id,
    created_at: 1,
    modified_at: 1,
    type: 'aionrs',
    status: 'finished',
    model: {},
    extra: {
      workspace,
      custom_workspace: true,
      project_id: projectId,
    },
  }) as TChatConversation;

const sectionWithWorkspace = (workspace: string, conversations: TChatConversation[]): TimelineSection => ({
  timeline: 'Recents',
  items: [
    {
      type: 'workspace',
      time: 1,
      workspaceGroup: {
        workspace,
        display_name: workspace.split('/').at(-1) ?? workspace,
        conversations,
      },
    },
  ],
});

describe('projectGrouping', () => {
  it('uses stored Project records ahead of legacy workspace labels', () => {
    const project: ForgeProject = {
      id: 'project-1',
      name: 'Finance Close',
      workspace: '/Users/me/close',
      created_at: 1,
      updated_at: 2,
    };
    const conv = conversation('conv-1', '/Users/me/close', 'project-1');

    const groups = buildProjectSidebarGroups([project], [sectionWithWorkspace('/Users/me/close', [conv])]);

    expect(groups).toEqual([
      expect.objectContaining({
        project_id: 'project-1',
        workspace: '/Users/me/close',
        display_name: 'Finance Close',
        source: 'project',
        conversations: [conv],
      }),
    ]);
  });

  it('shows empty stored Projects so users can start the first chat', () => {
    const project: ForgeProject = {
      id: 'project-empty',
      name: 'Policy Research',
      workspace: '/Users/me/policy',
      created_at: 1,
      updated_at: 5,
    };

    const groups = buildProjectSidebarGroups([project], []);

    expect(groups).toEqual([
      expect.objectContaining({
        project_id: 'project-empty',
        display_name: 'Policy Research',
        conversations: [],
        source: 'project',
      }),
    ]);
  });

  it('keeps existing custom workspace groups as legacy suggestions', () => {
    const conv = conversation('conv-legacy', '/Users/me/legacy');

    const groups = buildProjectSidebarGroups([], [sectionWithWorkspace('/Users/me/legacy', [conv])]);

    expect(groups).toEqual([
      expect.objectContaining({
        project_id: undefined,
        workspace: '/Users/me/legacy',
        display_name: 'legacy',
        source: 'legacy-workspace',
        conversations: [conv],
      }),
    ]);
  });

  it('does not duplicate a legacy workspace when a Project already owns that folder', () => {
    const project: ForgeProject = {
      id: 'project-1',
      name: 'Finance Close',
      workspace: '/Users/me/close',
      created_at: 1,
      updated_at: 2,
    };
    const conv = conversation('conv-legacy', '/Users/me/close');

    const groups = buildProjectSidebarGroups([project], [sectionWithWorkspace('/Users/me/close', [conv])]);

    expect(groups).toHaveLength(1);
    expect(groups[0]).toEqual(expect.objectContaining({ project_id: 'project-1', conversations: [conv] }));
  });
});
