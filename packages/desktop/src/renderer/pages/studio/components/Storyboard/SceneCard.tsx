/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import { useSortable } from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import { Button } from '@arco-design/web-react';
import { Delete, Drag, Down, Up } from '@icon-park/react';
import React from 'react';
import { useTranslation } from 'react-i18next';

import type { StudioScene } from '@/common/types/project/creativeStudioTypes';

import styles from './Storyboard.module.css';

export type SceneMoveDirection = 'up' | 'down';

export type SceneCardProps = {
  scene: StudioScene;
  index: number;
  selected: boolean;
  mutationPending: boolean;
  moveUpDisabled: boolean;
  moveDownDisabled: boolean;
  onSelect: () => void;
  onRemove: () => void;
  onMove: (direction: SceneMoveDirection) => void;
};

/** One accessible sortable scene row. Persistence is delegated to the parent controller. */
export const SceneCard: React.FC<SceneCardProps> = ({
  scene,
  index,
  selected,
  mutationPending,
  moveUpDisabled,
  moveDownDisabled,
  onSelect,
  onRemove,
  onMove,
}) => {
  const { t } = useTranslation();
  const { attributes, listeners, setActivatorNodeRef, setNodeRef, transform, transition, isDragging } = useSortable({
    id: scene.id,
    disabled: mutationPending,
  });
  const sceneLabel = t('conversation.creativeStudio.scene.accessibleName', {
    number: index + 1,
    title: scene.title,
  });
  const actionLabel = (translationKey: string) => `${t(translationKey)}: ${sceneLabel}`;
  const dragLabel = actionLabel('conversation.creativeStudio.storyboard.dragScene');
  const moveUpLabel = actionLabel('conversation.creativeStudio.storyboard.moveUp');
  const moveDownLabel = actionLabel('conversation.creativeStudio.storyboard.moveDown');
  const removeLabel = actionLabel('conversation.creativeStudio.storyboard.removeScene');
  const prefersReducedMotion =
    typeof window !== 'undefined' &&
    typeof window.matchMedia === 'function' &&
    window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  const sortableStyle: React.CSSProperties = {
    transform: CSS.Transform.toString(transform),
    transition: prefersReducedMotion ? undefined : transition,
  };

  return (
    <li
      ref={setNodeRef}
      className={styles.sceneCard}
      style={sortableStyle}
      data-selected={selected}
      data-dragging={isDragging}
    >
      <div className={styles.sceneTopline}>
        <Button
          ref={setActivatorNodeRef}
          type='text'
          size='small'
          className={styles.dragHandle}
          disabled={mutationPending}
          {...attributes}
          {...listeners}
          aria-label={dragLabel}
          title={dragLabel}
        >
          <Drag size={15} />
        </Button>
        <Button
          type='text'
          className={styles.sceneSelect}
          aria-label={sceneLabel}
          aria-current={selected ? 'true' : undefined}
          onClick={onSelect}
        >
          <span className={styles.sceneTitle}>{scene.title}</span>
        </Button>
      </div>

      {selected && <span className={styles.selectedLabel}>{t('conversation.creativeStudio.scene.selected')}</span>}

      <div className={styles.sceneMetadata}>
        <span>
          {t(
            scene.mediaKind === 'image'
              ? 'conversation.creativeStudio.scene.image'
              : 'conversation.creativeStudio.scene.video'
          )}
        </span>
        <span aria-hidden='true'>·</span>
        <span>
          {scene.durationSeconds} {t('conversation.creativeStudio.scene.seconds')}
        </span>
      </div>

      <div className={styles.sceneActions}>
        <Button
          type='text'
          size='small'
          aria-label={moveUpLabel}
          title={moveUpLabel}
          disabled={mutationPending || moveUpDisabled}
          onClick={() => onMove('up')}
        >
          <Up size={14} />
        </Button>
        <Button
          type='text'
          size='small'
          aria-label={moveDownLabel}
          title={moveDownLabel}
          disabled={mutationPending || moveDownDisabled}
          onClick={() => onMove('down')}
        >
          <Down size={14} />
        </Button>
        <Button
          type='text'
          size='small'
          status='danger'
          aria-label={removeLabel}
          title={removeLabel}
          disabled={mutationPending}
          onClick={onRemove}
        >
          <Delete size={14} />
        </Button>
      </div>
    </li>
  );
};
