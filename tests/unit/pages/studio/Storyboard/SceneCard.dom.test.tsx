/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import { render, screen } from '@testing-library/react';
import React from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import type { StudioScene } from '@/common/types/project/creativeStudioTypes';
import { SceneCard } from '@renderer/pages/studio/components/Storyboard/SceneCard';

vi.mock('@dnd-kit/sortable', async () => {
  const actual = await vi.importActual<typeof import('@dnd-kit/sortable')>('@dnd-kit/sortable');
  return {
    ...actual,
    useSortable: () => ({
      attributes: {},
      listeners: {},
      setNodeRef: vi.fn(),
      setActivatorNodeRef: vi.fn(),
      transform: null,
      transition: 'transform 180ms ease',
      isDragging: false,
    }),
  };
});

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, params?: Record<string, string | number>) => {
      if (key === 'conversation.creativeStudio.scene.accessibleName') {
        return `${key}:${params?.number}:${params?.title}`;
      }
      return key;
    },
  }),
}));

const scene: StudioScene = {
  id: 'scene-2',
  title: 'Reveal',
  purpose: 'Reveal purpose',
  visualPrompt: 'Reveal prompt',
  narration: '',
  onScreenText: '',
  mediaKind: 'video',
  durationSeconds: 6,
  referenceAssetId: null,
  selectedAssetId: null,
  assetIds: [],
  jobIds: [],
  reviewState: 'draft',
};

const renderSceneCard = () =>
  render(
    <SceneCard
      scene={scene}
      index={1}
      selected={false}
      mutationPending={false}
      moveUpDisabled={false}
      moveDownDisabled={false}
      onSelect={vi.fn()}
      onRemove={vi.fn()}
      onMove={vi.fn()}
    />
  );

describe('SceneCard accessibility', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('gives every scene action a unique localized accessible name and matching title', () => {
    renderSceneCard();

    const sceneLabel = 'conversation.creativeStudio.scene.accessibleName:2:Reveal';
    for (const action of [
      'conversation.creativeStudio.storyboard.dragScene',
      'conversation.creativeStudio.storyboard.moveUp',
      'conversation.creativeStudio.storyboard.moveDown',
      'conversation.creativeStudio.storyboard.removeScene',
    ]) {
      const actionLabel = `${action}: ${sceneLabel}`;
      expect(screen.getByRole('button', { name: actionLabel })).toHaveAttribute('title', actionLabel);
    }
  });

  it('omits the inline dnd transition when reduced motion is preferred', () => {
    vi.stubGlobal(
      'matchMedia',
      vi.fn().mockImplementation((query: string) => ({
        matches: query === '(prefers-reduced-motion: reduce)',
      }))
    );

    const { container } = renderSceneCard();

    expect(container.querySelector('li')).toHaveStyle({ transition: '' });
  });
});
