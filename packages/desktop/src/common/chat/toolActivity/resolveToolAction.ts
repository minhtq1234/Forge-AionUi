import type { ResolvedToolAction, ToolActivityPurpose, ToolCategory } from './types';

// Seeded exact tool keys (forge-reports MCP). Keep in sync with
// messages.toolActivity.tools.* in the en-US locale.
const SEED_TOOL_KEYS = ['data_open', 'data_get_schema', 'data_run_sql', 'render_report', 'export_pdf'] as const;

// Keyword → category, checked in order against the normalized id tokens.
const KEYWORD_CATEGORIES: Array<[readonly string[], ToolCategory]> = [
  [['search', 'grep', 'glob', 'find'], 'search'],
  [['sql', 'query', 'schema', 'db', 'data'], 'data'],
  [['report', 'render'], 'report'],
  [['export', 'pdf', 'download'], 'export'],
  [['memory', 'remember', 'recall'], 'memory'],
  [['read', 'open', 'load', 'cat'], 'fileRead'],
  [['write', 'save', 'create'], 'fileWrite'],
  [['exec', 'execute', 'command', 'bash', 'shell'], 'code'],
];

// Office-file work, detected from the call detail (command/args) rather than the
// tool name — skill wrappers (e.g. officecli) arrive with a generic name like
// "Skill", so the meaningful signal is the officecli invocation or an Office
// file extension in the command/arguments.
const OFFICE_DETAIL_PATTERN = /\bofficecli\b|\.(xlsx|xlsm|xls|csv|docx|doc|pptx|ppt)\b/i;
const PURPOSE_BY_CATEGORY: Record<ToolCategory, ToolActivityPurpose> = {
  web: 'discovering',
  search: 'discovering',
  fileRead: 'reviewing',
  data: 'reviewing',
  fileWrite: 'changing',
  memory: 'changing',
  code: 'running',
  generic: 'running',
  verify: 'verifying',
  report: 'delivering',
  export: 'delivering',
  office: 'delivering',
};

const EXECUTION_ID_PATTERN = /(?:^|_)(exec|execute|command|bash|shell)(?:_|$)/;
const EXPLICIT_WEB_ID_PATTERN = /(?:^|_)(web|web_search|websearch|webfetch|browse|fetch)(?:_|$)/;
const VERIFY_COMMAND_PATTERN =
  /^(?:(vitest|jest|pytest|tsc|oxlint|eslint|typecheck|format-check)\b|(bun|npm|pnpm|yarn)\s+(run\s+)?(test|lint|build|format|check|typecheck)(:[\w:-]+)?\b|(bunx|npx|pnpx)\s+(vitest|jest|tsc|oxlint|eslint)\b|node\s+(\.\/)?scripts\/check-i18n\.js\b|cargo\s+(test|check|clippy)\b)/i;
const SEARCH_DETAIL_PATTERN = /(?:^|[\s;&|])(rg|grep|find|fd|ls)(?:\s|$)/i;
const GENERIC_SEARCH_DETAIL_PATTERN = /(?:^|[\s;&|])(rg|grep|find|fd)(?:\s|$)/i;
const READ_DETAIL_PATTERN = /(?:^|[\s;&|])(cat|head|tail)(?:\s|$)|\bsed\s+-n\b|\bgit\s+(status|diff|log)\b/i;

type ShellQuote = "'" | '"' | '`';

const isShellQuote = (value: string): value is ShellQuote => value === "'" || value === '"' || value === '`';

const splitShellSegments = (detail: string): string[] => {
  const segments: string[] = [];
  let segment = '';
  let quote: ShellQuote | undefined;
  let escaped = false;

  const pushSegment = (): void => {
    const trimmed = segment.trim();
    if (trimmed) segments.push(trimmed);
    segment = '';
  };

  for (let index = 0; index < detail.length; index += 1) {
    const character = detail[index];
    if (escaped) {
      segment += character;
      escaped = false;
      continue;
    }
    if (character === '\\' && quote !== "'") {
      segment += character;
      escaped = true;
      continue;
    }
    if (quote) {
      segment += character;
      if (character === quote) quote = undefined;
      continue;
    }
    if (isShellQuote(character)) {
      segment += character;
      quote = character;
      continue;
    }

    const nextCharacter = detail[index + 1];
    const isDoubleSeparator =
      (character === '&' && nextCharacter === '&') || (character === '|' && nextCharacter === '|');
    if (isDoubleSeparator || character === '|' || character === ';' || character === '\n') {
      pushSegment();
      if (isDoubleSeparator) index += 1;
      continue;
    }
    segment += character;
  }

  pushSegment();
  return segments;
};

const hasVerificationCommand = (detail: string): boolean =>
  splitShellSegments(detail).some((segment) => VERIFY_COMMAND_PATTERN.test(segment));

const KIND_CATEGORIES: Record<string, ToolCategory> = {
  read: 'fileRead',
  edit: 'fileWrite',
  write: 'fileWrite',
  search: 'search',
  grep: 'search',
  glob: 'search',
  execute: 'code',
};

function categoryForKey(toolKey: string): ToolCategory {
  switch (toolKey) {
    case 'data_open':
      return 'fileRead';
    case 'data_get_schema':
    case 'data_run_sql':
      return 'data';
    case 'render_report':
      return 'report';
    case 'export_pdf':
      return 'export';
    default:
      return 'generic';
  }
}

function normalizeId(rawName: string): string {
  return rawName
    .toLowerCase()
    .replace(/[:./]+/g, '_')
    .replace(/_+/g, '_')
    .replace(/^_|_$/g, '');
}

const actionFor = (category: ToolCategory, toolKey?: string): ResolvedToolAction => ({
  ...(toolKey ? { toolKey } : {}),
  category,
  purpose: PURPOSE_BY_CATEGORY[category],
});

export function resolveToolAction(rawName: string | undefined, kind?: string, detail?: string): ResolvedToolAction {
  const id = normalizeId(rawName ?? '');

  // 1. Exact tool: id === key, or id ends with `_<key>` (tolerate a server prefix).
  const toolKey = SEED_TOOL_KEYS.find((key) => id === key || id.endsWith(`_${key}`));
  if (toolKey) return actionFor(categoryForKey(toolKey), toolKey);

  // 2. Keyword category on the id tokens (tool-name identity wins over detail).
  if (!EXECUTION_ID_PATTERN.test(id)) {
    if (EXPLICIT_WEB_ID_PATTERN.test(id)) return actionFor('web');
    for (const [keywords, category] of KEYWORD_CATEGORIES) {
      if (keywords.some((kw) => id.includes(kw))) return actionFor(category);
    }
  }

  // 3. Office-file work, inferred from the command/args when the tool name is
  //    generic (e.g. a "Skill" wrapper running officecli on an .xlsx).
  if (detail && OFFICE_DETAIL_PATTERN.test(detail)) return actionFor('office');

  // Detail classification is only used when a generic execution wrapper hides the command.
  const isExplicitExecutionWrapper = EXECUTION_ID_PATTERN.test(id);
  const inspectExecutionDetail = isExplicitExecutionWrapper || kind === 'execute';
  if (inspectExecutionDetail) {
    if (detail && hasVerificationCommand(detail)) return actionFor('verify');
    const searchDetailPattern = isExplicitExecutionWrapper ? SEARCH_DETAIL_PATTERN : GENERIC_SEARCH_DETAIL_PATTERN;
    if (detail && searchDetailPattern.test(detail)) return actionFor('search');
    if (detail && READ_DETAIL_PATTERN.test(detail)) return actionFor('fileRead');
  }

  // 4. Kind-based category (built-in tools).
  if (EXECUTION_ID_PATTERN.test(id)) return actionFor('code');
  if (kind && KIND_CATEGORIES[kind]) return actionFor(KIND_CATEGORIES[kind]);

  // 5. Generic fallback — never a raw id.
  return actionFor('generic');
}
