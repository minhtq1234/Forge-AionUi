import React from 'react';
import { useTranslation } from 'react-i18next';
import { Robot } from '@icon-park/react';
import { resolveAssistantAvatar } from '@renderer/utils/model/assistantAvatar';
import {
  getForgeAssistantBrandKey,
  resolveAssistantName,
  type ForgeAssistantBrandKey,
} from '@renderer/utils/model/assistantDisplay';
import { assistantRuntimeKey, type Assistant } from '@/common/types/agent/assistantTypes';

/** Team leader selector entry derived from the unified assistant catalog. */
export type TeamAssistantOption = {
  id: string;
  name: string;
  /** Execution backend (claude, gemini, qwen, …). */
  backend?: string;
  /** Avatar token — a backend-resolved URL or an emoji. */
  icon?: string;
  /** Whether this assistant can currently be used in team mode. */
  team_capable?: boolean;
  /** Why this assistant cannot currently be used in team mode. */
  team_block_reason?: string;
  /**
   * Forge brand i18n key when this is one of the rebranded built-in agents.
   * Display-only: `name` keeps the real catalog name so persisted team records
   * stay stable; the selector label renders the brand name from this key.
   */
  brandKey?: ForgeAssistantBrandKey | null;
};

export function assistantToOption(assistant: Assistant, localeKey = 'en-US'): TeamAssistantOption {
  return {
    id: assistant.id,
    name: resolveAssistantName(assistant, localeKey, assistant.name),
    backend: assistantRuntimeKey(assistant),
    icon: assistant.avatar,
    team_capable: assistant.team_selectable,
    team_block_reason: assistant.team_block_reason,
    brandKey: getForgeAssistantBrandKey(assistant),
  };
}

export function assistantKey(assistant: TeamAssistantOption): string {
  return assistant.id;
}

export function assistantFromId(
  assistantId: string,
  allAssistants: TeamAssistantOption[]
): TeamAssistantOption | undefined {
  return allAssistants.find((assistant) => assistantKey(assistant) === assistantId);
}

/** Filter assistants to only those supported in team mode. */
export function filterTeamSupportedAssistants(assistants: TeamAssistantOption[]): TeamAssistantOption[] {
  return assistants;
}

export const AssistantOptionLabel: React.FC<{ assistant: TeamAssistantOption }> = ({ assistant }) => {
  const { t } = useTranslation();
  const avatar = resolveAssistantAvatar(assistant.icon);
  const label = assistant.brandKey ? t(assistant.brandKey) : assistant.name;
  return (
    <div className='flex items-center gap-8px'>
      {avatar.kind === 'image' ? (
        <img src={avatar.value} alt={label} style={{ width: 16, height: 16, objectFit: 'contain' }} />
      ) : avatar.kind === 'emoji' ? (
        <span style={{ fontSize: 14, lineHeight: '16px' }}>{avatar.value}</span>
      ) : (
        <Robot size='16' />
      )}
      <span>{label}</span>
    </div>
  );
};
