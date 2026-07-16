import type { TMessage } from '@/common/chat/chatLib';
import type { TChatConversation, TContextHandoffItem, TContextSnapshot } from '@/common/config/storage';
import { readMessageContent } from '@/renderer/utils/chat/conversationExport';
import { parseContextSnapshot } from './contextSnapshot';
import { getConversationContextHandoffExtra } from './pinnedContext';
import { CONTEXT_MARKDOWN_SECTIONS, type ContextMarkdownSection } from './types';

export type BuildContextMarkdownInput = {
  conversation: TChatConversation;
  messages: TMessage[];
  maxRecentMessages?: number;
  currentMarkdown?: string | null;
};

type ParsedCanonicalSections = Partial<Record<ContextMarkdownSection, string[]>>;
type BuildContextMarkdownOptions = {
  ignoreSnapshot?: boolean;
};

const SNAPSHOT_SECTION_KEYS = [
  'goal',
  'current_state',
  'decisions',
  'artifacts',
  'user_preferences',
  'open_questions',
  'next_steps',
  'do_not_forget',
] as const satisfies readonly (keyof TContextSnapshot)[];

const EXCERPT_LIMIT = 900;
const FILE_PATH_RE =
  /(?:^|\s)([~./\w-][^\s"'`<>]*\.(?:md|txt|json|csv|xlsx?|docx?|pptx?|pdf|png|jpe?g|gif|svg|html|css|tsx?|jsx?))/gi;
const INVALID_CONTEXT_FILE_CHARS_RE = /[<>:"/\\|?*]+/g;
const PLAIN_BULLET_RE = /^[-*+]\s+/;
const RENDERER_HISTORY_GAP_CODE = '__aionui_renderer_history_gap__';

const SNAPSHOT_SECTION_BY_MARKDOWN_SECTION = {
  Goal: 'goal',
  'Current State': 'current_state',
  'Important Decisions': 'decisions',
  'Files / Artifacts': 'artifacts',
  'User Preferences': 'user_preferences',
  'Open Questions': 'open_questions',
  'Next Step': 'next_steps',
  'Do Not Forget': 'do_not_forget',
} as const satisfies Partial<Record<ContextMarkdownSection, keyof TContextSnapshot>>;

type SnapshotOwnedMarkdownSection = keyof typeof SNAPSHOT_SECTION_BY_MARKDOWN_SECTION;
type SnapshotSectionKey = (typeof SNAPSHOT_SECTION_KEYS)[number];

const MARKDOWN_SECTION_BY_SNAPSHOT_SECTION = {
  goal: 'Goal',
  current_state: 'Current State',
  decisions: 'Important Decisions',
  artifacts: 'Files / Artifacts',
  user_preferences: 'User Preferences',
  open_questions: 'Open Questions',
  next_steps: 'Next Step',
  do_not_forget: 'Do Not Forget',
} as const satisfies Record<SnapshotSectionKey, SnapshotOwnedMarkdownSection>;

const toOneLine = (value: string): string => value.replace(/\s+/g, ' ').trim();

const excerpt = (value: string, limit = EXCERPT_LIMIT): string => {
  const compact = toOneLine(value);
  if (compact.length <= limit) return compact;
  return `${compact.slice(0, limit - 1).trimEnd()}…`;
};

const bullet = (value: string): string => `- ${value}`;

const getExtraRecord = (conversation: TChatConversation): Record<string, unknown> => {
  return conversation.extra && typeof conversation.extra === 'object'
    ? (conversation.extra as Record<string, unknown>)
    : {};
};

const getStringList = (extra: Record<string, unknown>, key: string): string[] => {
  const value = extra[key];
  return Array.isArray(value)
    ? value.filter((item): item is string => typeof item === 'string' && item.trim() !== '')
    : [];
};

const getPinnedContext = (conversation: TChatConversation): TContextHandoffItem[] => {
  const pinned = getConversationContextHandoffExtra(conversation).pinned_context;
  return Array.isArray(pinned)
    ? pinned.filter((item): item is TContextHandoffItem => {
        if (!item || typeof item !== 'object') return false;
        const candidate = item as Partial<TContextHandoffItem>;
        return typeof candidate.id === 'string' && typeof candidate.content === 'string';
      })
    : [];
};

const getConversationSnapshot = (conversation: TChatConversation): TContextSnapshot | null => {
  return parseContextSnapshot(getConversationContextHandoffExtra(conversation).snapshot);
};

const messageRole = (message: TMessage): 'User' | 'Assistant' | 'System' => {
  if (message.position === 'right') return 'User';
  if (message.position === 'left') return 'Assistant';
  return 'System';
};

const firstUserMessage = (messages: TMessage[]): TMessage | undefined => {
  return messages.find((message) => message.position === 'right' && message.type === 'text');
};

const latestAssistantMessage = (messages: TMessage[]): TMessage | undefined => {
  return [...messages].toReversed().find((message) => message.position === 'left' && message.type === 'text');
};

const isRendererHistoryGap = (message: TMessage): boolean =>
  message.type === 'tips' && message.hidden === true && message.content.code === RENDERER_HISTORY_GAP_CODE;

const recentMessages = (messages: TMessage[], maxRecentMessages: number): string[] => {
  return messages
    .filter((message) => !isRendererHistoryGap(message))
    .slice(-maxRecentMessages)
    .map((message) => `${messageRole(message)}: ${excerpt(readMessageContent(message))}`)
    .filter((line) => line.trim() !== '');
};

const extractFileReferences = (conversation: TChatConversation, messages: TMessage[]): string[] => {
  const extra = getExtraRecord(conversation);
  const workspace = typeof extra.workspace === 'string' ? extra.workspace.trim() : '';
  const refs = new Set<string>();
  if (workspace) refs.add(`Workspace: ${workspace}`);

  messages.forEach((message) => {
    const content = readMessageContent(message);
    for (const match of content.matchAll(FILE_PATH_RE)) {
      const filePath = match[1]?.trim();
      if (filePath) refs.add(filePath);
    }
  });

  return Array.from(refs);
};

const assistantSetup = (conversation: TChatConversation): string[] => {
  const extra = getExtraRecord(conversation);
  const skills = getStringList(extra, 'skills');
  const mcpServers = getStringList(extra, 'mcp_servers');
  const model = 'model' in conversation ? conversation.model?.use_model || conversation.model?.name || '' : '';
  const rows = [`Conversation type: ${conversation.type}`];
  if (model) rows.push(`Model: ${model}`);
  if (skills.length > 0) rows.push(`Skills: ${skills.join(', ')}`);
  if (mcpServers.length > 0) rows.push(`MCP servers: ${mcpServers.join(', ')}`);
  return rows;
};

const emptyPrompt = (section: ContextMarkdownSection): string => {
  switch (section) {
    case 'Important Decisions':
      return 'Add decisions that must carry into the next chat.';
    case 'User Preferences':
      return 'Add user preferences that affect future work.';
    case 'Open Questions':
      return 'Add unresolved questions.';
    case 'Next Step':
      return 'Add the next action.';
    case 'Do Not Forget':
      return 'Add easy-to-miss constraints.';
    default:
      return 'Add context.';
  }
};

const normalizeParsedLine = (value: string): string | null => {
  const trimmed = value.trim();
  if (!trimmed || trimmed.startsWith('#')) return null;

  const withoutMarker = trimmed.replace(PLAIN_BULLET_RE, '');
  const normalized = toOneLine(withoutMarker);
  return normalized || null;
};

const parseCanonicalSections = (markdown: string | null | undefined): ParsedCanonicalSections => {
  if (!markdown) return {};

  const parsed: ParsedCanonicalSections = {};
  let currentSection: ContextMarkdownSection | null = null;

  markdown.split(/\r?\n/).forEach((line) => {
    const trimmed = line.trim();
    if (trimmed.startsWith('## ')) {
      const heading = trimmed.slice(3).trim();
      currentSection = CONTEXT_MARKDOWN_SECTIONS.find((section) => section === heading) ?? null;
      if (currentSection) parsed[currentSection] = [];
      return;
    }

    if (!currentSection) return;

    parsed[currentSection]?.push(line);
  });

  return Object.fromEntries(
    Object.entries(parsed).map(([section, lines]) => [
      section,
      lines.map((line) => normalizeParsedLine(line)).filter((line): line is string => line !== null),
    ])
  ) as ParsedCanonicalSections;
};

const fallbackSectionLines = (section: ContextMarkdownSection, input: BuildContextMarkdownInput): string[] => {
  const { conversation, messages } = input;

  switch (section) {
    case 'Goal': {
      const first = input.maxRecentMessages === undefined ? firstUserMessage(messages) : undefined;
      return [conversation.name || 'Conversation', first ? excerpt(readMessageContent(first)) : 'Add the goal.'];
    }
    case 'Current State': {
      const latest = latestAssistantMessage(messages);
      const lines = latest
        ? [excerpt(readMessageContent(latest))]
        : recentMessages(messages, input.maxRecentMessages ?? 6);
      return lines.length > 0 ? lines : [emptyPrompt(section)];
    }
    case 'Files / Artifacts': {
      const refs = extractFileReferences(conversation, messages);
      return refs.length > 0 ? refs : [emptyPrompt(section)];
    }
    case 'Assistant Setup':
      return assistantSetup(conversation);
    case 'Pinned Context': {
      const pinned = getPinnedContext(conversation).map((item) =>
        item.title.trim() ? `${item.title.trim()}: ${excerpt(item.content)}` : excerpt(item.content)
      );
      return pinned.length > 0 ? pinned : [emptyPrompt(section)];
    }
    default:
      return [emptyPrompt(section)];
  }
};

const snapshotSectionLines = (section: ContextMarkdownSection, snapshot: TContextSnapshot): string[] | null => {
  if (!(section in SNAPSHOT_SECTION_BY_MARKDOWN_SECTION)) return null;

  const snapshotSection = SNAPSHOT_SECTION_BY_MARKDOWN_SECTION[section as SnapshotOwnedMarkdownSection];
  const value = snapshot[snapshotSection];
  return Array.isArray(value) ? value : [value];
};

const getParsedSnapshotSection = (parsedSections: ParsedCanonicalSections, section: SnapshotSectionKey): string[] => {
  const markdownSection = MARKDOWN_SECTION_BY_SNAPSHOT_SECTION[section];

  const parsed = parsedSections[markdownSection];
  if (!parsed || parsed.length === 0) return [];

  return parsed;
};

const deriveFallbackGoal = (conversation: TChatConversation, messages: TMessage[]): string => {
  const first = firstUserMessage(messages);
  const parts = [conversation.name || 'Conversation', first ? excerpt(readMessageContent(first)) : ''].filter(Boolean);
  return parts.join(' ');
};

const deriveFallbackCurrentState = (messages: TMessage[], maxRecentMessages?: number): string[] => {
  const latest = latestAssistantMessage(messages);
  if (latest) return [excerpt(readMessageContent(latest))];

  return recentMessages(messages, maxRecentMessages ?? 6);
};

export const buildFallbackContextSnapshot = (input: BuildContextMarkdownInput): TContextSnapshot => {
  const parsedSections = parseCanonicalSections(input.currentMarkdown);
  const goal =
    getParsedSnapshotSection(parsedSections, 'goal').join(' ') ||
    deriveFallbackGoal(input.conversation, input.messages);
  const currentState = getParsedSnapshotSection(parsedSections, 'current_state');
  const artifacts = getParsedSnapshotSection(parsedSections, 'artifacts');

  const snapshot: TContextSnapshot = {
    goal,
    current_state:
      currentState.length > 0 ? currentState : deriveFallbackCurrentState(input.messages, input.maxRecentMessages),
    decisions: getParsedSnapshotSection(parsedSections, 'decisions'),
    artifacts: artifacts.length > 0 ? artifacts : extractFileReferences(input.conversation, input.messages),
    user_preferences: getParsedSnapshotSection(parsedSections, 'user_preferences'),
    open_questions: getParsedSnapshotSection(parsedSections, 'open_questions'),
    next_steps: getParsedSnapshotSection(parsedSections, 'next_steps'),
    do_not_forget: getParsedSnapshotSection(parsedSections, 'do_not_forget'),
  };

  const parsedSnapshot = parseContextSnapshot(snapshot);
  if (!parsedSnapshot) {
    throw new Error('Fallback context snapshot must always be valid.');
  }

  return parsedSnapshot;
};

const fallbackSnapshotSectionLines = (
  section: ContextMarkdownSection,
  snapshot: TContextSnapshot,
  input: BuildContextMarkdownInput,
  parsedSections: ParsedCanonicalSections
): string[] => {
  if (section === 'Goal' && getParsedSnapshotSection(parsedSections, 'goal').length === 0) {
    return fallbackSectionLines(section, input);
  }

  const snapshotLines = snapshotSectionLines(section, snapshot);
  if (snapshotLines && snapshotLines.length > 0) return snapshotLines;

  if (snapshotLines) return section === 'Goal' ? [snapshot.goal] : fallbackSectionLines(section, input);

  return fallbackSectionLines(section, input);
};

const sectionLines = (
  section: ContextMarkdownSection,
  input: BuildContextMarkdownInput,
  snapshot: TContextSnapshot | null,
  parsedSections: ParsedCanonicalSections
): string[] => {
  if (section === 'Assistant Setup' || section === 'Pinned Context') {
    return fallbackSectionLines(section, input);
  }

  if (snapshot) {
    return snapshotSectionLines(section, snapshot) ?? fallbackSectionLines(section, input);
  }

  const parsed = parsedSections[section];
  if (parsed && parsed.length > 0) {
    return section === 'Goal' ? [parsed.join(' ')] : parsed;
  }

  return fallbackSectionLines(section, input);
};

const buildContextMarkdownInternal = (
  input: BuildContextMarkdownInput,
  options: BuildContextMarkdownOptions = {}
): string => {
  const snapshot = options.ignoreSnapshot ? null : getConversationSnapshot(input.conversation);
  const parsedSections = snapshot ? {} : parseCanonicalSections(input.currentMarkdown);
  const lines: string[] = [
    '# Conversation Context',
    '',
    bullet(`Conversation: ${input.conversation.name || input.conversation.id}`),
    bullet(`Conversation ID: ${input.conversation.id}`),
    bullet(`Exported At: ${new Date().toISOString()}`),
    '',
  ];

  CONTEXT_MARKDOWN_SECTIONS.forEach((section) => {
    lines.push(`## ${section}`);
    lines.push('');
    lines.push(...sectionLines(section, input, snapshot, parsedSections).map(bullet));
    lines.push('');
  });

  return lines.join('\n').trimEnd();
};

export const buildContextMarkdown = (input: BuildContextMarkdownInput): string => {
  return buildContextMarkdownInternal(input);
};

export const buildFallbackContextMarkdown = (input: BuildContextMarkdownInput): string => {
  const fallbackSnapshot = buildFallbackContextSnapshot(input);
  const parsedSections = parseCanonicalSections(input.currentMarkdown);
  const lines: string[] = [
    '# Conversation Context',
    '',
    bullet(`Conversation: ${input.conversation.name || input.conversation.id}`),
    bullet(`Conversation ID: ${input.conversation.id}`),
    bullet(`Exported At: ${new Date().toISOString()}`),
    '',
  ];

  CONTEXT_MARKDOWN_SECTIONS.forEach((section) => {
    lines.push(`## ${section}`);
    lines.push('');
    lines.push(...fallbackSnapshotSectionLines(section, fallbackSnapshot, input, parsedSections).map(bullet));
    lines.push('');
  });

  return lines.join('\n').trimEnd();
};

export const getContextFileName = (conversationName: string): string => {
  const safeBase = conversationName
    .replace(INVALID_CONTEXT_FILE_CHARS_RE, ' - ')
    .replace(/\s*-\s*/g, ' - ')
    .replace(/\s+/g, ' ')
    .replace(/^(?:-|\s)+|(?:-|\s)+$/g, '')
    .trim()
    .slice(0, 80);
  return `${safeBase || 'Conversation'} Context.md`;
};
