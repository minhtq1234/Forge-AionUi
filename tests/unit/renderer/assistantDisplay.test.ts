/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, expect, it } from 'vitest';
import type { TFunction } from 'i18next';
import type { Assistant } from '@/common/types/agent/assistantTypes';
import { getForgeAssistantBrandKey, resolveAssistantDisplayName } from '@/renderer/utils/model/assistantDisplay';

const BRAND: Record<string, string> = {
  'agent.brand.forgeChat': 'Forge Chat',
  'agent.brand.forgeCode': 'Forge Code',
  'agent.brand.forgeAssistant': 'Forge Assistant',
};

// Stub translator: returns the mapped brand string, or echoes the key so an
// unexpected key is visible in the failure message.
const t = ((key: string): string => BRAND[key] ?? key) as unknown as TFunction;

const mk = (overrides: Partial<Assistant>): Assistant =>
  ({
    id: 'x',
    source: 'user',
    name: 'Fallback Name',
    name_i18n: {},
    description_i18n: {},
    enabled: true,
    sort_order: 0,
    enabled_skills: [],
    custom_skill_names: [],
    disabled_builtin_skills: [],
    context_i18n: {},
    prompts: [],
    prompts_i18n: {},
    models: [],
    agent_status: 'online',
    team_selectable: true,
    deletable: false,
    ...overrides,
  }) as Assistant;

describe('getForgeAssistantBrandKey', () => {
  it('maps the AionUi Butler to the Forge Assistant key by exact id', () => {
    expect(getForgeAssistantBrandKey(mk({ id: 'aionui-assistant', source: 'builtin' }))).toBe(
      'agent.brand.forgeAssistant'
    );
  });

  it('maps the Butler to the Forge Assistant key for the builtin-aionui-assistant id prefix variant', () => {
    expect(getForgeAssistantBrandKey(mk({ id: 'builtin-aionui-assistant-42', source: 'builtin' }))).toBe(
      'agent.brand.forgeAssistant'
    );
  });

  it('maps an opencode ACP assistant to the Forge Code key via acp_backend', () => {
    const openCode = mk({
      id: 'bare:632f31d2',
      source: 'generated',
      agent: { type: 'acp', source: 'internal', acp_backend: 'opencode' },
    });
    expect(getForgeAssistantBrandKey(openCode)).toBe('agent.brand.forgeCode');
  });

  it('maps the bare/generated aionrs CLI agent to the Forge Chat key', () => {
    const aionCli = mk({ id: 'bare:abc12345', source: 'generated', agent: { type: 'aionrs', source: 'internal' } });
    expect(getForgeAssistantBrandKey(aionCli)).toBe('agent.brand.forgeChat');
  });

  it('returns null for a builtin aionrs assistant (e.g. Word Creator keeps its name)', () => {
    const wordCreator = mk({
      id: 'word-creator',
      source: 'builtin',
      name: 'Word Creator',
      agent: { type: 'aionrs', source: 'builtin' },
    });
    expect(getForgeAssistantBrandKey(wordCreator)).toBeNull();
  });

  it('returns null for a non-opencode ACP agent (Gemini is also ACP)', () => {
    const geminiAcp = mk({
      id: 'bare:deadbeef',
      source: 'generated',
      agent: { type: 'acp', source: 'internal', acp_backend: 'gemini' },
    });
    expect(getForgeAssistantBrandKey(geminiAcp)).toBeNull();
  });

  it('returns null for any other assistant', () => {
    const custom = mk({
      id: 'user-123',
      source: 'user',
      name: 'My Agent',
      agent: { type: 'aionrs', source: 'custom' },
    });
    expect(getForgeAssistantBrandKey(custom)).toBeNull();
  });

  it('returns null for a nullish assistant', () => {
    expect(getForgeAssistantBrandKey(null)).toBeNull();
    expect(getForgeAssistantBrandKey(undefined)).toBeNull();
  });
});

describe('resolveAssistantDisplayName', () => {
  it('returns the localized Forge brand name for a matched built-in agent', () => {
    const aionCli = mk({
      id: 'bare:abc12345',
      source: 'generated',
      name: 'Aion CLI',
      agent: { type: 'aionrs', source: 'internal' },
    });
    expect(resolveAssistantDisplayName(aionCli, 'en-US', t)).toBe('Forge Chat');
  });

  it('falls back to the localized catalog name for an unmatched assistant', () => {
    const custom = mk({ id: 'user-1', source: 'user', name: 'My Agent', name_i18n: { 'zh-CN': '我的助手' } });
    expect(resolveAssistantDisplayName(custom, 'zh-CN', t)).toBe('我的助手');
  });

  it('does not rename a builtin aionrs assistant on the display path', () => {
    const wordCreator = mk({
      id: 'word-creator',
      source: 'builtin',
      name: 'Word Creator',
      agent: { type: 'aionrs', source: 'builtin' },
    });
    expect(resolveAssistantDisplayName(wordCreator, 'en-US', t)).toBe('Word Creator');
  });
});
