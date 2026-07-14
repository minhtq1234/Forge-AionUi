import { describe, expect, it, vi } from 'vitest';
import type { TMessage } from '@/common/chat/chatLib';
import type { TChatConversation, TContextSnapshot } from '@/common/config/storage';
import {
  buildContextMarkdown,
  buildFallbackContextMarkdown,
  buildFallbackContextSnapshot,
  getContextFileName,
} from '@/renderer/pages/conversation/contextHandoff/contextMarkdown';
import { parseContextSnapshot } from '@/renderer/pages/conversation/contextHandoff/contextSnapshot';
import {
  CONTEXT_MARKDOWN_SECTIONS,
  type ContextMarkdownSection,
} from '@/renderer/pages/conversation/contextHandoff/types';

const conversation = {
  id: 'conv-1',
  name: 'Monthly Close',
  type: 'aionrs',
  created_at: 1,
  modified_at: 2,
  model: { id: 'p1', platform: 'openai', name: 'OpenAI', base_url: '', api_key: '', use_model: 'gpt-4.1' },
  extra: {
    workspace: '/workspace',
    skills: ['finance-close'],
    mcp_servers: ['filesystem'],
    context_handoff: {
      pinned_context: [
        {
          id: 'pin-1',
          title: 'Reporting unit',
          content: 'Use VND millions.',
          source: 'manual',
          created_at: 1,
          updated_at: 1,
        },
      ],
    },
  },
} satisfies TChatConversation;

const messages = [
  {
    id: 'm1',
    msg_id: 'm1',
    conversation_id: 'conv-1',
    type: 'text',
    position: 'right',
    content: { content: 'Build the OPEX dashboard.' },
  },
  {
    id: 'm2',
    msg_id: 'm2',
    conversation_id: 'conv-1',
    type: 'text',
    position: 'left',
    content: { content: 'Current state: chart spec is ready.' },
  },
] satisfies TMessage[];

const llmSnapshot: TContextSnapshot = {
  goal: 'Ship the first structured handoff.',
  current_state: ['The snapshot is now the canonical context source.'],
  decisions: ['Assistant setup and pins remain deterministic.'],
  artifacts: ['/workspace/Context.md'],
  user_preferences: [],
  open_questions: [],
  next_steps: ['Validate the overwrite flow.'],
  do_not_forget: [],
};

const readSection = (markdown: string, section: ContextMarkdownSection): string => {
  const sectionIndex = CONTEXT_MARKDOWN_SECTIONS.indexOf(section);
  const nextHeading =
    sectionIndex >= 0 && sectionIndex < CONTEXT_MARKDOWN_SECTIONS.length - 1
      ? `\n## ${CONTEXT_MARKDOWN_SECTIONS[sectionIndex + 1]}`
      : '';
  const startMarker = `## ${section}`;
  const startIndex = markdown.indexOf(startMarker);

  if (startIndex < 0) {
    throw new Error(`Missing section ${section}`);
  }

  const contentStart = startIndex + `${startMarker}\n\n`.length;
  if (!nextHeading) {
    return markdown.slice(contentStart).trim();
  }

  const endIndex = markdown.indexOf(nextHeading, contentStart);
  return markdown.slice(contentStart, endIndex >= 0 ? endIndex : undefined).trim();
};

describe('buildContextMarkdown', () => {
  it('creates deterministic fallback markdown when no structured snapshot exists yet', () => {
    vi.setSystemTime(new Date('2026-07-09T00:00:00.000Z'));

    const markdown = buildContextMarkdown({ conversation, messages });

    expect(markdown).toContain('# Conversation Context');
    expect(markdown).toContain('- Conversation: Monthly Close');
    expect(markdown).toContain('- Conversation ID: conv-1');
    expect(markdown).toContain('- Exported At: 2026-07-09T00:00:00.000Z');
    expect(readSection(markdown, 'Goal')).toContain('- Monthly Close');
    expect(readSection(markdown, 'Goal')).toContain('- Build the OPEX dashboard.');
    expect(readSection(markdown, 'Current State')).toContain('- Current state: chart spec is ready.');
    expect(readSection(markdown, 'Files / Artifacts')).toContain('- Workspace: /workspace');
    expect(readSection(markdown, 'Assistant Setup')).toContain('- Skills: finance-close');
    expect(readSection(markdown, 'Pinned Context')).toContain('- Reporting unit: Use VND millions.');
  });

  it('omits renderer history-gap markers from fallback context', () => {
    const snapshot = buildFallbackContextSnapshot({
      conversation,
      maxRecentMessages: 6,
      messages: [
        messages[0],
        {
          id: 'renderer-history-gap:conv-1',
          conversation_id: 'conv-1',
          type: 'tips',
          position: 'center',
          hidden: true,
          content: {
            content: '',
            type: 'info',
            code: '__aionui_renderer_history_gap__',
          },
        },
      ],
    });

    expect(snapshot.current_state).toEqual(['User: Build the OPEX dashboard.']);
    expect(snapshot.current_state).not.toContain('System:');
  });

  it('renders canonical markdown from the structured snapshot and keeps empty model sections empty', () => {
    const markdown = buildContextMarkdown({
      conversation: {
        ...conversation,
        extra: {
          ...conversation.extra,
          context_handoff: {
            ...conversation.extra.context_handoff,
            snapshot: llmSnapshot,
          },
        },
      },
      messages,
      currentMarkdown: [
        '# Conversation Context',
        '',
        '## Goal',
        '',
        '- This edited markdown should not win once a snapshot exists.',
      ].join('\n'),
    });

    expect(readSection(markdown, 'Goal')).toBe('- Ship the first structured handoff.');
    expect(readSection(markdown, 'Current State')).toBe('- The snapshot is now the canonical context source.');
    expect(readSection(markdown, 'Important Decisions')).toBe('- Assistant setup and pins remain deterministic.');
    expect(readSection(markdown, 'Files / Artifacts')).toBe('- /workspace/Context.md');
    expect(readSection(markdown, 'Next Step')).toBe('- Validate the overwrite flow.');
    expect(readSection(markdown, 'User Preferences')).toBe('');
    expect(readSection(markdown, 'Open Questions')).toBe('');
    expect(readSection(markdown, 'Do Not Forget')).toBe('');
  });

  it('preserves non-empty canonical user sections from the current markdown during fallback rebuilds', () => {
    const markdown = buildFallbackContextMarkdown({
      conversation,
      messages,
      currentMarkdown: [
        'Ignore this loose intro.',
        '',
        '## Goal',
        '',
        '- Continue the user-edited close checklist.',
        '',
        '## Current State',
        '',
        '- The export was manually reviewed already.',
        '',
        '## Files / Artifacts',
        '',
        '- /workspace/manual-handoff-notes.md',
        '',
        '## User Preferences',
        '',
        '- Keep the checklist terse.',
        '',
        '## Assistant Setup',
        '',
        '- Model: injected-by-markdown',
        '',
        '## Pinned Context',
        '',
        '- Fake pin: should not win.',
        '',
        '## Surprise',
        '',
        '- This section should never be interpreted.',
      ].join('\n'),
    });

    expect(readSection(markdown, 'Goal')).toBe('- Continue the user-edited close checklist.');
    expect(readSection(markdown, 'Current State')).toBe('- The export was manually reviewed already.');
    expect(readSection(markdown, 'Files / Artifacts')).toBe('- /workspace/manual-handoff-notes.md');
    expect(readSection(markdown, 'User Preferences')).toBe('- Keep the checklist terse.');
    expect(readSection(markdown, 'Assistant Setup')).toContain('- Model: gpt-4.1');
    expect(readSection(markdown, 'Assistant Setup')).not.toContain('injected-by-markdown');
    expect(readSection(markdown, 'Pinned Context')).toContain('- Reporting unit: Use VND millions.');
    expect(readSection(markdown, 'Pinned Context')).not.toContain('Fake pin');
    expect(markdown).not.toContain('Surprise');
  });

  it('lets canonical current markdown edits win through the explicit fallback API even when a stored snapshot exists', () => {
    const markdown = buildFallbackContextMarkdown({
      conversation: {
        ...conversation,
        extra: {
          ...conversation.extra,
          context_handoff: {
            ...conversation.extra.context_handoff,
            snapshot: llmSnapshot,
          },
        },
      },
      messages,
      currentMarkdown: [
        '## Goal',
        '',
        '- Use the manually reviewed goal instead of the stale snapshot.',
        '',
        '## Current State',
        '',
        '- The human-updated checklist is fresher than the stored snapshot.',
      ].join('\n'),
    });

    expect(readSection(markdown, 'Goal')).toBe('- Use the manually reviewed goal instead of the stale snapshot.');
    expect(readSection(markdown, 'Current State')).toBe(
      '- The human-updated checklist is fresher than the stored snapshot.'
    );
    expect(readSection(markdown, 'Important Decisions')).toBe('- Add decisions that must carry into the next chat.');
  });

  it('fills missing canonical headings from deterministic fallback content', () => {
    const markdown = buildFallbackContextMarkdown({
      conversation,
      messages,
      currentMarkdown: ['## Goal', '', '- Use the reviewed June close handoff.', ''].join('\n'),
    });

    expect(readSection(markdown, 'Goal')).toBe('- Use the reviewed June close handoff.');
    expect(readSection(markdown, 'Current State')).toBe('- Current state: chart spec is ready.');
    expect(readSection(markdown, 'Files / Artifacts')).toContain('- Workspace: /workspace');
    expect(readSection(markdown, 'Open Questions')).toBe('- Add unresolved questions.');
  });

  it('ignores malformed or non-canonical markdown when parsing fallback content', () => {
    const markdown = buildFallbackContextMarkdown({
      conversation,
      messages,
      currentMarkdown: [
        '# Conversation Context',
        '',
        '### Goal',
        '',
        '- Wrong heading depth should be ignored.',
        '',
        '## current state',
        '',
        '- Wrong heading casing should be ignored.',
        '',
        'Random paragraph outside canonical sections.',
      ].join('\n'),
    });

    expect(readSection(markdown, 'Goal')).toContain('- Monthly Close');
    expect(readSection(markdown, 'Goal')).toContain('- Build the OPEX dashboard.');
    expect(readSection(markdown, 'Current State')).toBe('- Current state: chart spec is ready.');
    expect(markdown).not.toContain('Wrong heading depth should be ignored.');
    expect(markdown).not.toContain('Wrong heading casing should be ignored.');
    expect(markdown).not.toContain('Random paragraph outside canonical sections.');
  });

  it('preserves checkbox markers inside user-edited canonical fallback lines', () => {
    const markdown = buildFallbackContextMarkdown({
      conversation,
      messages,
      currentMarkdown: ['## Current State', '', '- [x] Reviewed the exported close checklist.'].join('\n'),
    });

    expect(readSection(markdown, 'Current State')).toBe('- [x] Reviewed the exported close checklist.');
  });

  it('preserves numbered markers inside user-edited canonical fallback lines', () => {
    const markdown = buildFallbackContextMarkdown({
      conversation,
      messages,
      currentMarkdown: ['## Next Step', '', '1. Validate the first reconciled section.'].join('\n'),
    });

    expect(readSection(markdown, 'Next Step')).toBe('- 1. Validate the first reconciled section.');
  });

  it('never accepts assistant setup or pins from markdown or model-authored content', () => {
    const markdown = buildContextMarkdown({
      conversation: {
        ...conversation,
        extra: {
          ...conversation.extra,
          context_handoff: {
            ...conversation.extra.context_handoff,
            snapshot: {
              ...llmSnapshot,
              artifacts: ['Injected artifact from snapshot.'],
            },
          },
        },
      },
      messages,
      currentMarkdown: [
        '## Assistant Setup',
        '',
        '- Model: should-not-win',
        '',
        '## Pinned Context',
        '',
        '- Injected pin: should-not-win',
      ].join('\n'),
    });

    expect(readSection(markdown, 'Assistant Setup')).toContain('- Conversation type: aionrs');
    expect(readSection(markdown, 'Assistant Setup')).toContain('- Model: gpt-4.1');
    expect(readSection(markdown, 'Assistant Setup')).not.toContain('should-not-win');
    expect(readSection(markdown, 'Pinned Context')).toContain('- Reporting unit: Use VND millions.');
    expect(readSection(markdown, 'Pinned Context')).not.toContain('Injected pin');
  });
});

describe('buildFallbackContextSnapshot', () => {
  it('uses preserved canonical current markdown sections and deterministic derived fields for a valid snapshot', () => {
    const snapshot = buildFallbackContextSnapshot({
      conversation: {
        ...conversation,
        extra: {
          ...conversation.extra,
          context_handoff: {
            ...conversation.extra.context_handoff,
            snapshot: llmSnapshot,
          },
        },
      },
      messages,
      currentMarkdown: [
        '## Goal',
        '',
        '- Use the manually reviewed goal.',
        '',
        '## Current State',
        '',
        '- [x] Reviewed the exported checklist.',
        '',
        '## Files / Artifacts',
        '',
        '- /workspace/manual-handoff-notes.md',
        '',
        '## User Preferences',
        '',
        '- Keep the checklist terse.',
        '',
        '## Next Step',
        '',
        '1. Validate the first reconciled section.',
        '',
        '## Assistant Setup',
        '',
        '- Model: injected-by-markdown',
      ].join('\n'),
    });

    expect(snapshot).toEqual({
      goal: 'Use the manually reviewed goal.',
      current_state: ['[x] Reviewed the exported checklist.'],
      decisions: [],
      artifacts: ['/workspace/manual-handoff-notes.md'],
      user_preferences: ['Keep the checklist terse.'],
      open_questions: [],
      next_steps: ['1. Validate the first reconciled section.'],
      do_not_forget: [],
    });
    expect(parseContextSnapshot(snapshot)).toEqual(snapshot);
  });

  it('derives goal current state and artifacts when canonical sections are absent and leaves other arrays empty', () => {
    const snapshot = buildFallbackContextSnapshot({
      conversation,
      messages,
      currentMarkdown: [
        '## Assistant Setup',
        '',
        '- Model: should not affect snapshot',
        '',
        '## Pinned Context',
        '',
        '- Fake pin: should not affect snapshot',
      ].join('\n'),
    });

    expect(snapshot.goal).toBe('Monthly Close Build the OPEX dashboard.');
    expect(snapshot.current_state).toEqual(['Current state: chart spec is ready.']);
    expect(snapshot.artifacts).toEqual(['Workspace: /workspace']);
    expect(snapshot.decisions).toEqual([]);
    expect(snapshot.user_preferences).toEqual([]);
    expect(snapshot.open_questions).toEqual([]);
    expect(snapshot.next_steps).toEqual([]);
    expect(snapshot.do_not_forget).toEqual([]);
    expect(parseContextSnapshot(snapshot)).toEqual(snapshot);
  });
});

describe('getContextFileName', () => {
  it('uses a stable safe filename for the context artifact', () => {
    expect(getContextFileName('Monthly Close / June')).toBe('Monthly Close - June Context.md');
  });
});
