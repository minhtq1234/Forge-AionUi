import type {
  TContextGenerationSource,
  TContextGenerationStatus,
  TContextHandoffExtra,
  TContextSnapshot,
} from '@/common/config/storage';

const CONTEXT_SNAPSHOT_SECTION_KEYS = [
  'goal',
  'current_state',
  'decisions',
  'artifacts',
  'user_preferences',
  'open_questions',
  'next_steps',
  'do_not_forget',
] as const satisfies readonly (keyof TContextSnapshot)[];

type TContextSnapshotArraySection = Exclude<(typeof CONTEXT_SNAPSHOT_SECTION_KEYS)[number], 'goal'>;

const CONTEXT_SNAPSHOT_ARRAY_SECTION_KEYS = CONTEXT_SNAPSHOT_SECTION_KEYS.filter(
  (section): section is TContextSnapshotArraySection => section !== 'goal'
);

export const CONTEXT_SNAPSHOT_MAX_GOAL_LENGTH = 1_000;
export const CONTEXT_SNAPSHOT_MAX_ITEMS_PER_SECTION = 12;
export const CONTEXT_SNAPSHOT_MAX_ITEM_LENGTH = 500;

const CONTEXT_TURN_ID_MAX_LENGTH = 200;
const CONTEXT_ERROR_CODE_MAX_LENGTH = 120;

export type MergeContextSnapshotStateInput = {
  snapshot?: unknown;
  source?: TContextGenerationSource;
  status?: TContextGenerationStatus;
  includedTurnId?: string | null;
  turnsSinceCompaction?: number;
  updatedAt?: number;
  lastErrorCode?: string | null;
  didPersistFileUpdate: boolean;
};

const isRecord = (value: unknown): value is Record<string, unknown> => {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
};

const sanitizeString = (value: unknown, maxLength: number): string | null => {
  if (typeof value !== 'string') return null;

  const trimmed = value.trim();
  if (!trimmed || trimmed.length > maxLength) return null;

  return trimmed;
};

const sanitizeOptionalString = (value: unknown, maxLength: number): string | undefined => {
  if (value == null) return undefined;

  const sanitized = sanitizeString(value, maxLength);
  return sanitized ?? undefined;
};

const sanitizeNonNegativeInteger = (value: unknown): number | undefined => {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0 ? value : undefined;
};

const parseSnapshotSection = (value: unknown): string[] | null => {
  if (!Array.isArray(value) || value.length > CONTEXT_SNAPSHOT_MAX_ITEMS_PER_SECTION) return null;

  const items = value.map((entry) => sanitizeString(entry, CONTEXT_SNAPSHOT_MAX_ITEM_LENGTH));
  return items.every((entry): entry is string => entry !== null) ? items : null;
};

const normalizeModelString = (value: unknown, maxLength: number): string | null => {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  return trimmed ? trimmed.slice(0, maxLength) : null;
};

// Coerce a model-produced section into a clean string list. A capable model at
// low temperature is mostly consistent but occasionally deviates per field
// (omits a key, returns null, a bare string, or an item that isn't a string).
// Coerce those instead of rejecting, so one stray field can't discard the whole
// AI snapshot and force a rules fallback.
const coerceModelSnapshotSection = (value: unknown): string[] => {
  const entries = Array.isArray(value) ? value : value == null ? [] : [value];
  return entries
    .slice(0, CONTEXT_SNAPSHOT_MAX_ITEMS_PER_SECTION)
    .map((entry) => normalizeModelString(entry, CONTEXT_SNAPSHOT_MAX_ITEM_LENGTH))
    .filter((entry): entry is string => entry !== null);
};

export const normalizeModelContextSnapshot = (value: unknown): TContextSnapshot | null => {
  if (!isRecord(value)) return null;

  const goal = normalizeModelString(value.goal, CONTEXT_SNAPSHOT_MAX_GOAL_LENGTH);
  if (goal === null) return null;

  return {
    goal,
    current_state: coerceModelSnapshotSection(value.current_state),
    decisions: coerceModelSnapshotSection(value.decisions),
    artifacts: coerceModelSnapshotSection(value.artifacts),
    user_preferences: coerceModelSnapshotSection(value.user_preferences),
    open_questions: coerceModelSnapshotSection(value.open_questions),
    next_steps: coerceModelSnapshotSection(value.next_steps),
    do_not_forget: coerceModelSnapshotSection(value.do_not_forget),
  };
};

export const parseContextSnapshot = (value: unknown): TContextSnapshot | null => {
  if (!isRecord(value)) return null;

  const keys = Object.keys(value);
  if (
    keys.length !== CONTEXT_SNAPSHOT_SECTION_KEYS.length ||
    keys.some((key) => !CONTEXT_SNAPSHOT_SECTION_KEYS.includes(key as (typeof CONTEXT_SNAPSHOT_SECTION_KEYS)[number]))
  ) {
    return null;
  }

  const goal = sanitizeString(value.goal, CONTEXT_SNAPSHOT_MAX_GOAL_LENGTH);
  if (goal === null) return null;

  const sections = CONTEXT_SNAPSHOT_ARRAY_SECTION_KEYS.reduce<Partial<Record<TContextSnapshotArraySection, string[]>>>(
    (accumulator, section) => {
      const parsed = parseSnapshotSection(value[section]);
      if (parsed !== null) {
        accumulator[section] = parsed;
      }
      return accumulator;
    },
    {}
  );

  if (CONTEXT_SNAPSHOT_ARRAY_SECTION_KEYS.some((section) => !sections[section])) {
    return null;
  }

  return {
    goal,
    current_state: sections.current_state ?? [],
    decisions: sections.decisions ?? [],
    artifacts: sections.artifacts ?? [],
    user_preferences: sections.user_preferences ?? [],
    open_questions: sections.open_questions ?? [],
    next_steps: sections.next_steps ?? [],
    do_not_forget: sections.do_not_forget ?? [],
  };
};

export const mergeContextSnapshotState = (
  current: TContextHandoffExtra | null | undefined,
  input: MergeContextSnapshotStateInput
): TContextHandoffExtra => {
  const next: TContextHandoffExtra = {
    ...current,
  };

  if (input.source) next.source = input.source;
  if (input.status) next.status = input.status;

  const updatedAt = sanitizeNonNegativeInteger(input.updatedAt);
  if (updatedAt !== undefined) next.updated_at = updatedAt;

  if (input.lastErrorCode !== undefined) {
    const lastErrorCode = sanitizeOptionalString(input.lastErrorCode, CONTEXT_ERROR_CODE_MAX_LENGTH);
    if (lastErrorCode) {
      next.last_error_code = lastErrorCode;
    } else {
      delete next.last_error_code;
    }
  }

  const turnsSinceCompaction = sanitizeNonNegativeInteger(input.turnsSinceCompaction);
  if (!input.didPersistFileUpdate) {
    if (turnsSinceCompaction !== undefined) next.turns_since_compaction = turnsSinceCompaction;
    return next;
  }

  const parsedSnapshot = input.snapshot === undefined ? current?.snapshot : parseContextSnapshot(input.snapshot);

  if (!parsedSnapshot) return next;

  next.snapshot = parsedSnapshot;
  next.revision = Math.max(current?.revision ?? 0, 0) + 1;

  const includedTurnId = sanitizeOptionalString(input.includedTurnId, CONTEXT_TURN_ID_MAX_LENGTH);
  if (includedTurnId) {
    next.last_compacted_turn_id = includedTurnId;
  }

  if (turnsSinceCompaction !== undefined) {
    next.turns_since_compaction = turnsSinceCompaction;
  }

  return next;
};
