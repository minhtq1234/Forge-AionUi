/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, expect, it } from 'vitest';
import { parseContextCommand } from '@/common/chat/slash/contextCommands';
import { buildGuidSlashCommands } from '@/common/chat/slash/guidSlashCommands';
import { buildSkillSlashCommands, mergeSlashCommands } from '@/common/chat/slash/mergeSlashCommands';
import type { SlashCommandItem } from '@/common/chat/slash/types';

const builtin = (name: string): SlashCommandItem => ({
  name,
  description: `builtin ${name}`,
  kind: 'builtin',
  source: 'builtin',
});
const acp = (name: string): SlashCommandItem => ({ name, description: `acp ${name}`, kind: 'template', source: 'acp' });

describe('buildSkillSlashCommands', () => {
  it('returns nothing when no skills are loaded', () => {
    expect(buildSkillSlashCommands(undefined, new Map(), 'Skill')).toEqual([]);
    expect(buildSkillSlashCommands([], new Map(), 'Skill')).toEqual([]);
  });

  it('maps each loaded skill to an insert-style template command', () => {
    const commands = buildSkillSlashCommands(['cron', 'officecli'], new Map([['cron', 'Scheduled tasks']]), 'Skill');

    expect(commands).toEqual([
      { name: 'cron', description: 'Scheduled tasks', kind: 'template', source: 'skill', selectionBehavior: 'insert' },
      // No indexed description → falls back to the provided label.
      { name: 'officecli', description: 'Skill', kind: 'template', source: 'skill', selectionBehavior: 'insert' },
    ]);
  });
});

describe('mergeSlashCommands', () => {
  it('keeps priority builtin > acp > skills on name collisions', () => {
    const skills = buildSkillSlashCommands(['copy', 'cron'], new Map(), 'Skill');
    const merged = mergeSlashCommands([builtin('copy')], [acp('copy'), acp('review')], skills);

    // `copy` exists in all three groups; builtin wins.
    expect(merged.find((c) => c.name === 'copy')?.source).toBe('builtin');
    // ACP-only command survives.
    expect(merged.find((c) => c.name === 'review')?.source).toBe('acp');
    // Skill-only command is appended.
    expect(merged.find((c) => c.name === 'cron')?.source).toBe('skill');
    // No duplicates.
    expect(merged.map((c) => c.name)).toEqual(['copy', 'review', 'cron']);
  });

  it('surfaces session skills when there are no other commands', () => {
    const skills = buildSkillSlashCommands(['cron'], new Map([['cron', 'Scheduled tasks']]), 'Skill');
    const merged = mergeSlashCommands([], [], skills);

    expect(merged).toHaveLength(1);
    expect(merged[0]).toMatchObject({ name: 'cron', source: 'skill', selectionBehavior: 'insert' });
  });
});

describe('buildGuidSlashCommands', () => {
  it('uses agent metadata commands before selected skill fallbacks', () => {
    const commands = buildGuidSlashCommands({
      builtinCommands: [builtin('open')],
      agentCommands: [acp('review'), acp('cron')],
      selectedSkills: ['cron', 'officecli'],
      descriptionByName: new Map([
        ['cron', 'Scheduled tasks'],
        ['officecli', 'Office automation'],
      ]),
      skillFallbackDescription: 'Skill',
    });

    expect(commands.map((command) => `${command.source}:${command.name}`)).toEqual([
      'builtin:open',
      'acp:review',
      'acp:cron',
    ]);
  });

  it('falls back to selected skills when agent metadata has no commands', () => {
    const commands = buildGuidSlashCommands({
      builtinCommands: [builtin('open')],
      agentCommands: [],
      selectedSkills: ['cron'],
      descriptionByName: new Map([['cron', 'Scheduled tasks']]),
      skillFallbackDescription: 'Skill',
    });

    expect(commands.map((command) => `${command.source}:${command.name}`)).toEqual(['builtin:open', 'skill:cron']);
  });
});

describe('parseContextCommand', () => {
  it('passes through non-context input', () => {
    expect(parseContextCommand('hello there')).toEqual({ kind: 'not_context' });
    expect(parseContextCommand('/open README.md')).toEqual({ kind: 'not_context' });
    expect(parseContextCommand('/contextual')).toEqual({ kind: 'not_context' });
  });

  it('parses /context with optional surrounding whitespace', () => {
    expect(parseContextCommand('/context')).toEqual({ kind: 'valid', command: { action: 'open' } });
    expect(parseContextCommand('/context open')).toEqual({ kind: 'valid', command: { action: 'open' } });
    expect(parseContextCommand('  /context   ')).toEqual({ kind: 'valid', command: { action: 'open' } });
    expect(parseContextCommand('/context open now')).toEqual({
      kind: 'invalid',
      code: 'unexpected_arguments',
      subcommand: 'open',
    });
  });

  it('parses compact and handoff subcommands with strict extra-arg rejection', () => {
    expect(parseContextCommand('/context compact')).toEqual({ kind: 'valid', command: { action: 'compact' } });
    expect(parseContextCommand('/context\t handoff')).toEqual({ kind: 'valid', command: { action: 'handoff' } });
    expect(parseContextCommand('/context compact now')).toEqual({
      kind: 'invalid',
      code: 'unexpected_arguments',
      subcommand: 'compact',
    });
    expect(parseContextCommand('/context handoff later')).toEqual({
      kind: 'invalid',
      code: 'unexpected_arguments',
      subcommand: 'handoff',
    });
  });

  it('parses pin text while preserving internal spacing after command trimming', () => {
    expect(parseContextCommand('/context pin Keep this note')).toEqual({
      kind: 'valid',
      command: { action: 'pin', text: 'Keep this note' },
    });
    expect(parseContextCommand('/context   pin   Keep   inner   spacing   ')).toEqual({
      kind: 'valid',
      command: { action: 'pin', text: 'Keep   inner   spacing' },
    });
  });

  it('rejects pin without non-empty text', () => {
    expect(parseContextCommand('/context pin')).toEqual({
      kind: 'invalid',
      code: 'missing_pin_text',
      subcommand: 'pin',
    });
    expect(parseContextCommand('/context pin   \t')).toEqual({
      kind: 'invalid',
      code: 'missing_pin_text',
      subcommand: 'pin',
    });
  });

  it('rejects unsupported subcommands', () => {
    expect(parseContextCommand('/context export')).toEqual({
      kind: 'invalid',
      code: 'unsupported_subcommand',
      subcommand: 'export',
    });
    expect(parseContextCommand('/context compacted')).toEqual({
      kind: 'invalid',
      code: 'unsupported_subcommand',
      subcommand: 'compacted',
    });
  });
});
