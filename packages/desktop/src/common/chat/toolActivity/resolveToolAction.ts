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
const OFFICECLI_COMMAND_PATTERN = /^officecli(?:\s|$)/i;
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
const SEARCH_COMMAND_PATTERN = /^(rg|grep|find|fd|ls)(?:\s|$)/i;
const GENERIC_SEARCH_COMMAND_PATTERN = /^(rg|grep|find|fd)(?:\s|$)/i;
const READ_COMMAND_PATTERN = /^(?:(cat|head|tail)(?:\s|$)|sed\s+-n\b|git\s+(status|diff|log)\b)/i;

type ShellQuote = 'single' | 'double' | 'backtick' | 'ansiC';
type ShellExpansionClose = '}' | ')';

const closesShellQuote = (quote: ShellQuote, value: string): boolean =>
  (quote === 'single' && value === "'") ||
  (quote === 'double' && value === '"') ||
  (quote === 'backtick' && value === '`') ||
  (quote === 'ansiC' && value === "'");

const splitShellSegments = (detail: string): string[] => {
  const segments: string[] = [];
  let segment = '';
  let quote: ShellQuote | undefined;
  let escaped = false;
  let inComment = false;
  let canStartComment = true;
  const expansionClosers: ShellExpansionClose[] = [];

  const pushSegment = (): void => {
    const trimmed = segment.trim();
    if (trimmed) segments.push(trimmed);
    segment = '';
    canStartComment = true;
  };

  for (let index = 0; index < detail.length; index += 1) {
    const character = detail[index];
    const nextCharacter = detail[index + 1];
    if (inComment) {
      if (character === '\n') {
        inComment = false;
        pushSegment();
      }
      continue;
    }
    if (escaped) {
      segment += character;
      escaped = false;
      canStartComment = false;
      continue;
    }
    const removesLineContinuation =
      character === '\\' &&
      nextCharacter === '\n' &&
      (quote === undefined || quote === 'double' || quote === 'backtick');
    if (removesLineContinuation) {
      index += 1;
      continue;
    }
    if (character === '\\' && quote !== 'single') {
      segment += character;
      escaped = true;
      continue;
    }
    if (quote) {
      segment += character;
      if (closesShellQuote(quote, character)) quote = undefined;
      continue;
    }
    if (character === '$' && nextCharacter === "'") {
      segment += "$'";
      quote = 'ansiC';
      canStartComment = false;
      index += 1;
      continue;
    }
    if (character === "'" || character === '"' || character === '`') {
      segment += character;
      quote = character === "'" ? 'single' : character === '"' ? 'double' : 'backtick';
      canStartComment = false;
      continue;
    }
    if (character === '$' && (nextCharacter === '{' || nextCharacter === '(')) {
      segment += character + nextCharacter;
      expansionClosers.push(nextCharacter === '{' ? '}' : ')');
      canStartComment = false;
      index += 1;
      continue;
    }
    const expansionClose = expansionClosers[expansionClosers.length - 1];
    if (expansionClose) {
      if ((expansionClose === '}' && character === '{') || (expansionClose === ')' && character === '(')) {
        expansionClosers.push(expansionClose);
      } else if (character === expansionClose) {
        expansionClosers.pop();
      }
      segment += character;
      canStartComment = false;
      continue;
    }
    if (character === '#' && canStartComment) {
      inComment = true;
      continue;
    }
    const isDoubleSeparator =
      (character === '&' && nextCharacter === '&') || (character === '|' && nextCharacter === '|');
    if (isDoubleSeparator || character === '|' || character === ';' || character === '\n') {
      pushSegment();
      if (isDoubleSeparator) index += 1;
      continue;
    }
    segment += character;
    canStartComment = /\s/.test(character);
  }

  pushSegment();
  return segments;
};

const stripEnvWrapper = (command: string): string => {
  const wrapper = command.match(/^(?:\/usr\/bin\/)?env\b\s*/i);
  if (!wrapper) return command;

  let rest = command.slice(wrapper[0].length);
  while (rest.startsWith('-')) {
    const optionWithArgument = rest.match(/^(?:-u|--unset)\s+\S+\s+/i);
    if (optionWithArgument) {
      rest = rest.slice(optionWithArgument[0].length);
      continue;
    }
    const option = rest.match(/^--?\S+\s+/);
    if (!option) break;
    rest = rest.slice(option[0].length);
  }
  return rest;
};

const stripSudoWrapper = (command: string): string => {
  const wrapper = command.match(/^sudo\b\s*/i);
  if (!wrapper) return command;

  let rest = command.slice(wrapper[0].length);
  while (rest.startsWith('-')) {
    const optionWithArgument = rest.match(
      /^(?:-[CghpRttu]|--(?:chdir|chroot|command-timeout|group|host|prompt|type|user))\s+\S+\s+/i
    );
    if (optionWithArgument) {
      rest = rest.slice(optionWithArgument[0].length);
      continue;
    }
    const option = rest.match(/^--?\S+\s+/);
    if (!option) break;
    rest = rest.slice(option[0].length);
  }
  return rest;
};

const stripExecutionPrefixes = (segment: string): string => {
  let command = segment.trim();
  let previous = '';
  while (command && command !== previous) {
    previous = command;
    command = command.replace(/^\s+/, '');
    command = stripSudoWrapper(stripEnvWrapper(command)).replace(/^[a-z_][a-z0-9_]*=(?:"[^"]*"|'[^']*'|\S+)\s+/i, '');
  }
  return command;
};

const unwrapShellSegments = (segment: string, depth = 0): string[] => {
  const command = stripExecutionPrefixes(segment);
  if (depth >= 3) return command ? [command] : [];

  const wrapped = command.match(/^(?:bash|sh|zsh|fish)(?:\s+-[a-z]+)*\s+-[a-z]*c[a-z]*\s+(["'])([\s\S]*)\1$/i);
  if (!wrapped) return command ? [command] : [];
  return splitShellSegments(wrapped[2]).flatMap((inner) => unwrapShellSegments(inner, depth + 1));
};

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
    .replace(/[\s:./-]+/g, '_')
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

  // Detail classification is only used when a generic execution wrapper hides the command.
  const isExplicitExecutionWrapper = EXECUTION_ID_PATTERN.test(id);
  const inspectExecutionDetail = isExplicitExecutionWrapper || kind === 'execute';
  if (inspectExecutionDetail) {
    const shellSegments = detail ? splitShellSegments(detail).flatMap((segment) => unwrapShellSegments(segment)) : [];
    if (shellSegments.some((segment) => OFFICECLI_COMMAND_PATTERN.test(segment))) return actionFor('office');
    if (shellSegments.some((segment) => VERIFY_COMMAND_PATTERN.test(segment))) return actionFor('verify');
    const searchCommandPattern = isExplicitExecutionWrapper ? SEARCH_COMMAND_PATTERN : GENERIC_SEARCH_COMMAND_PATTERN;
    if (shellSegments.some((segment) => searchCommandPattern.test(segment))) return actionFor('search');
    if (shellSegments.some((segment) => READ_COMMAND_PATTERN.test(segment))) return actionFor('fileRead');
  }

  // 3. Office-file work, inferred from the command/args when the tool name is
  //    generic (e.g. a "Skill" wrapper running officecli on an .xlsx). Explicit
  //    shell intent wins when a command is only searching, reading, or checking
  //    an Office-named file.
  if (detail && OFFICE_DETAIL_PATTERN.test(detail)) return actionFor('office');

  // 4. Kind-based category (built-in tools).
  if (EXECUTION_ID_PATTERN.test(id)) return actionFor('code');
  if (kind && KIND_CATEGORIES[kind]) return actionFor(KIND_CATEGORIES[kind]);

  // 5. Generic fallback — never a raw id.
  return actionFor('generic');
}
