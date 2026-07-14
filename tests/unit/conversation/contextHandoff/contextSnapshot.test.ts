import { describe, expect, it } from 'vitest';
import type { TContextSnapshot } from '@/common/config/storage';
import {
  CONTEXT_SNAPSHOT_MAX_GOAL_LENGTH,
  CONTEXT_SNAPSHOT_MAX_ITEMS_PER_SECTION,
  CONTEXT_SNAPSHOT_MAX_ITEM_LENGTH,
  mergeContextSnapshotState,
  normalizeModelContextSnapshot,
  parseContextSnapshot,
} from '@/renderer/pages/conversation/contextHandoff/contextSnapshot';

const validSnapshot: TContextSnapshot = {
  goal: 'Ship the first structured context snapshot.',
  current_state: ['Task brief reviewed.', 'Current context handoff files inspected.'],
  decisions: ['Keep pins outside the model-owned snapshot.'],
  artifacts: ['/workspace/Context.md'],
  user_preferences: ['Keep the change small and focused.'],
  open_questions: ['How should stale status surface in the panel?'],
  next_steps: ['Validate the LLM snapshot before persisting it.'],
  do_not_forget: ['Do not mutate manual pins from model output.'],
};

describe('normalizeModelContextSnapshot', () => {
  it('accepts a clean model snapshot', () => {
    expect(normalizeModelContextSnapshot(validSnapshot)).toEqual(validSnapshot);
  });

  it('coerces an omitted section to an empty list instead of discarding the whole snapshot', () => {
    const { open_questions: _omitted, ...withoutOneSection } = validSnapshot;
    expect(normalizeModelContextSnapshot(withoutOneSection)).toEqual({
      ...validSnapshot,
      open_questions: [],
    });
  });

  it('coerces a null section to an empty list', () => {
    expect(normalizeModelContextSnapshot({ ...validSnapshot, decisions: null })).toEqual({
      ...validSnapshot,
      decisions: [],
    });
  });

  it('wraps a single-string section into a list', () => {
    expect(normalizeModelContextSnapshot({ ...validSnapshot, next_steps: 'Verify the snapshot.' })).toEqual({
      ...validSnapshot,
      next_steps: ['Verify the snapshot.'],
    });
  });

  it('drops empty and non-string items rather than rejecting the section', () => {
    expect(
      normalizeModelContextSnapshot({
        ...validSnapshot,
        artifacts: ['/workspace/Context.md', '', '   ', 42, { path: 'nested' }, 'dashboard.tsx'],
      })
    ).toEqual({
      ...validSnapshot,
      artifacts: ['/workspace/Context.md', 'dashboard.tsx'],
    });
  });

  it('still rejects output that is not an object or lacks a usable goal', () => {
    expect(normalizeModelContextSnapshot('not an object')).toBeNull();
    expect(normalizeModelContextSnapshot([validSnapshot])).toBeNull();
    expect(normalizeModelContextSnapshot({ ...validSnapshot, goal: '' })).toBeNull();
    expect(normalizeModelContextSnapshot({ ...validSnapshot, goal: 42 })).toBeNull();
  });

  it('produces a snapshot that survives the strict persistence parser', () => {
    const normalized = normalizeModelContextSnapshot({
      ...validSnapshot,
      decisions: null,
      next_steps: 'Verify the snapshot.',
      artifacts: ['keep.tsx', '', 7],
    });
    expect(normalized).not.toBeNull();
    expect(parseContextSnapshot(normalized)).toEqual(normalized);
  });
});

describe('parseContextSnapshot', () => {
  it('accepts a valid structured snapshot', () => {
    expect(parseContextSnapshot(validSnapshot)).toEqual(validSnapshot);
  });

  it('rejects malformed JSON-shaped values', () => {
    expect(parseContextSnapshot({ ...validSnapshot, current_state: [{ text: 'bad' }] })).toBeNull();
    expect(parseContextSnapshot({ ...validSnapshot, goal: 42 })).toBeNull();
  });

  it('rejects unknown sections and oversized fields', () => {
    expect(parseContextSnapshot({ ...validSnapshot, surprise: ['nope'] })).toBeNull();

    expect(
      parseContextSnapshot({
        ...validSnapshot,
        current_state: Array.from(
          { length: CONTEXT_SNAPSHOT_MAX_ITEMS_PER_SECTION + 1 },
          (_, index) => `Item ${index}`
        ),
      })
    ).toBeNull();

    expect(
      parseContextSnapshot({
        ...validSnapshot,
        goal: 'g'.repeat(CONTEXT_SNAPSHOT_MAX_GOAL_LENGTH + 1),
      })
    ).toBeNull();

    expect(
      parseContextSnapshot({
        ...validSnapshot,
        decisions: ['d'.repeat(CONTEXT_SNAPSHOT_MAX_ITEM_LENGTH + 1)],
      })
    ).toBeNull();
  });
});

describe('mergeContextSnapshotState', () => {
  it('keeps legacy handoff metadata backward compatible when no snapshot fields exist yet', () => {
    const merged = mergeContextSnapshotState(
      {},
      {
        snapshot: validSnapshot,
        source: 'rules',
        status: 'fresh',
        includedTurnId: 'turn-7',
        turnsSinceCompaction: 0,
        updatedAt: 100,
        didPersistFileUpdate: true,
      }
    );

    expect(merged).toEqual({
      snapshot: validSnapshot,
      revision: 1,
      source: 'rules',
      status: 'fresh',
      last_compacted_turn_id: 'turn-7',
      turns_since_compaction: 0,
      updated_at: 100,
    });
  });

  it('increments revision only after a persisted file update and records the included turn id', () => {
    const current = {
      revision: 4,
      source: 'llm' as const,
      status: 'stale' as const,
      last_compacted_turn_id: 'turn-3',
      turns_since_compaction: 2,
      updated_at: 50,
    };

    const pending = mergeContextSnapshotState(current, {
      source: 'llm',
      status: 'updating',
      updatedAt: 60,
      didPersistFileUpdate: false,
    });

    expect(pending.revision).toBe(4);
    expect(pending.last_compacted_turn_id).toBe('turn-3');
    expect(pending.status).toBe('updating');
    expect(pending.updated_at).toBe(60);

    const committed = mergeContextSnapshotState(current, {
      snapshot: validSnapshot,
      source: 'llm',
      status: 'fresh',
      includedTurnId: 'turn-9',
      turnsSinceCompaction: 0,
      updatedAt: 80,
      didPersistFileUpdate: true,
    });

    expect(committed.revision).toBe(5);
    expect(committed.last_compacted_turn_id).toBe('turn-9');
    expect(committed.turns_since_compaction).toBe(0);
    expect(committed.snapshot).toEqual(validSnapshot);
  });

  it('tracks completed turns without advancing the durable revision or cursor', () => {
    const current = {
      snapshot: validSnapshot,
      revision: 2,
      last_compacted_turn_id: 'turn-2',
      turns_since_compaction: 0,
    };

    const pending = mergeContextSnapshotState(current, {
      status: 'stale',
      includedTurnId: 'turn-3',
      turnsSinceCompaction: 1,
      didPersistFileUpdate: false,
    });

    expect(pending.turns_since_compaction).toBe(1);
    expect(pending.revision).toBe(2);
    expect(pending.last_compacted_turn_id).toBe('turn-2');
  });

  it('preserves the last durable snapshot and revision when a persisted update carries invalid snapshot data', () => {
    const current = {
      snapshot: validSnapshot,
      revision: 3,
      source: 'llm' as const,
      status: 'fresh' as const,
      last_compacted_turn_id: 'turn-4',
      turns_since_compaction: 0,
      updated_at: 40,
    };

    const merged = mergeContextSnapshotState(current, {
      snapshot: { ...validSnapshot, decisions: [{ bad: 'shape' }] },
      source: 'llm',
      status: 'failed',
      includedTurnId: 'turn-9',
      turnsSinceCompaction: 2,
      updatedAt: 55,
      lastErrorCode: 'invalid_snapshot',
      didPersistFileUpdate: true,
    });

    expect(merged.snapshot).toEqual(validSnapshot);
    expect(merged.revision).toBe(3);
    expect(merged.last_compacted_turn_id).toBe('turn-4');
    expect(merged.turns_since_compaction).toBe(0);
    expect(merged.status).toBe('failed');
    expect(merged.updated_at).toBe(55);
    expect(merged.last_error_code).toBe('invalid_snapshot');
  });
});
