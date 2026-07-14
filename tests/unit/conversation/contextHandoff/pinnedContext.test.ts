import { describe, expect, it } from 'vitest';
import {
  addPinnedContext,
  removePinnedContext,
  updatePinnedContext,
} from '@/renderer/pages/conversation/contextHandoff/pinnedContext';

describe('pinnedContext helpers', () => {
  it('adds sanitized text context with stable metadata', () => {
    const items = addPinnedContext({
      items: [],
      now: 10,
      createId: () => 'pin-1',
      title: ' Decision ',
      content: ' Use VND millions. ',
      source: 'manual',
    });

    expect(items).toEqual([
      {
        id: 'pin-1',
        title: 'Decision',
        content: 'Use VND millions.',
        source: 'manual',
        created_at: 10,
        updated_at: 10,
      },
    ]);
  });

  it('edits and removes pinned context without mutating other items', () => {
    const initial = addPinnedContext({
      items: [],
      now: 10,
      createId: () => 'pin-1',
      title: 'Decision',
      content: 'Use VND millions.',
      source: 'manual',
    });

    const updated = updatePinnedContext({
      items: initial,
      id: 'pin-1',
      title: 'Reporting unit',
      content: 'Use USD.',
      now: 20,
    });

    expect(updated[0]).toMatchObject({ title: 'Reporting unit', content: 'Use USD.', created_at: 10, updated_at: 20 });
    expect(removePinnedContext(updated, 'pin-1')).toEqual([]);
  });
});
