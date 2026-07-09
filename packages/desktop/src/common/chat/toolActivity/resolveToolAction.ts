import type { ResolvedToolAction, ToolCategory } from './types';

// Seeded exact tool keys (forge-reports MCP). Keep in sync with
// messages.toolActivity.tools.* in the en-US locale.
const SEED_TOOL_KEYS = ['data_open', 'data_get_schema', 'data_run_sql', 'render_report', 'export_pdf'] as const;

// Keyword → category, checked in order against the normalized id tokens.
const KEYWORD_CATEGORIES: Array<[readonly string[], ToolCategory]> = [
  [['search', 'web', 'fetch', 'browse'], 'web'],
  [['grep', 'glob', 'find'], 'search'],
  [['sql', 'query', 'schema', 'db', 'data'], 'data'],
  [['report', 'render'], 'report'],
  [['export', 'pdf', 'download'], 'export'],
  [['memory', 'remember', 'recall'], 'memory'],
  [['read', 'open', 'load', 'cat'], 'fileRead'],
  [['write', 'save', 'create'], 'fileWrite'],
];

// Generic command-execution keywords — checked AFTER office detection so an
// exec wrapper (e.g. "ExecCommand" running officecli on a .docx) is labelled by
// what it actually does rather than the generic "command".
const CODE_KEYWORDS = ['exec', 'execute', 'command', 'bash', 'shell'] as const;

// Office-file work, detected from the call detail (command/args) rather than the
// tool name — skill wrappers (e.g. officecli) arrive with a generic name like
// "Skill", so the meaningful signal is the officecli invocation or an Office
// file extension in the command/arguments.
const OFFICE_DETAIL_PATTERN = /\bofficecli\b|\.(xlsx|xlsm|xls|csv|docx|doc|pptx|ppt)\b/i;

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

export function resolveToolAction(rawName: string | undefined, kind?: string, detail?: string): ResolvedToolAction {
  const id = normalizeId(rawName ?? '');

  // 1. Exact tool: id === key, or id ends with `_<key>` (tolerate a server prefix).
  const toolKey = SEED_TOOL_KEYS.find((key) => id === key || id.endsWith(`_${key}`));
  if (toolKey) return { toolKey, category: categoryForKey(toolKey) };

  // 2. Specific keyword categories on the id tokens (a descriptive tool name
  //    wins over the command detail).
  for (const [keywords, category] of KEYWORD_CATEGORIES) {
    if (keywords.some((kw) => id.includes(kw))) return { category };
  }

  // 3. Office-file work, inferred from the command/args — this beats the generic
  //    "command" label so an exec/skill wrapper running officecli on an Office
  //    file reads as Office work, not "Running a command".
  if (detail && OFFICE_DETAIL_PATTERN.test(detail)) return { category: 'office' };

  // 4. Generic command execution (checked after office so officecli wins).
  if (CODE_KEYWORDS.some((kw) => id.includes(kw))) return { category: 'code' };

  // 5. Kind-based category (built-in tools).
  if (kind && KIND_CATEGORIES[kind]) return { category: KIND_CATEGORIES[kind] };

  // 6. Generic fallback — never a raw id.
  return { category: 'generic' };
}
