/**
 * @vitest-environment node
 */

import { describe, expect, it } from 'vitest';
import type { TChatConversation } from '@/common/config/storage';
import {
  buildDetachedProjectExtra,
  resolveConversationProject,
} from '@/renderer/pages/conversation/projects/projectConversation';

const conversation = (): TChatConversation =>
  ({
    id: 'conv-1',
    name: 'Review June close',
    created_at: 1,
    modified_at: 1,
    type: 'aionrs',
    model: {},
    extra: {
      project_id: 'project-1',
      workspace: '/Users/me/Finance Close',
      custom_workspace: true,
      pinned: true,
      pinned_at: 123,
    },
  }) as TChatConversation;

describe('projectConversation', () => {
  it('removes Project ownership without deleting workspace or unrelated metadata', () => {
    expect(buildDetachedProjectExtra(conversation())).toEqual({
      workspace: '/Users/me/Finance Close',
      custom_workspace: false,
      pinned: true,
      pinned_at: 123,
    });
  });

  it('resolves older Project chats by their matching workspace', () => {
    const legacyProjectChat = conversation();
    delete legacyProjectChat.extra.project_id;

    expect(
      resolveConversationProject(legacyProjectChat, [
        {
          id: 'project-1',
          name: 'Finance Close',
          workspace: '/Users/me/Finance Close',
          created_at: 1,
          updated_at: 1,
        },
      ])
    ).toMatchObject({ id: 'project-1', name: 'Finance Close' });
  });
});
