/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import { DndContext, PointerSensor, closestCenter, type DragEndEvent, useSensor, useSensors } from '@dnd-kit/core';
import { SortableContext, arrayMove, verticalListSortingStrategy } from '@dnd-kit/sortable';
import { Button, Modal } from '@arco-design/web-react';
import { Add } from '@icon-park/react';
import React, { useCallback, useState } from 'react';
import { useTranslation } from 'react-i18next';

import type { StudioScene } from '@/common/types/project/creativeStudioTypes';

import { SceneCard, type SceneMoveDirection } from './SceneCard';
import styles from './Storyboard.module.css';

type ActionResult = void | Promise<unknown>;

type RemoveCandidate = {
  sceneId: string;
  sceneLabel: string;
};

export type StoryboardPanelProps = {
  orderedScenes: StudioScene[];
  selectedSceneId: string | null;
  targetDurationSeconds: number;
  durationTotalSeconds: number;
  durationMatchesTarget: boolean;
  canAddScene: boolean;
  mutationPending: boolean;
  errorMessageKey?: string | null;
  statusMessageKey?: string | null;
  conflict: boolean;
  onSelectScene: (sceneId: string) => void;
  onAddScene: () => ActionResult;
  onRemoveScene: (sceneId: string) => ActionResult;
  onReorderScenes: (sceneOrder: string[]) => ActionResult;
  onMoveScene: (sceneId: string, direction: SceneMoveDirection) => ActionResult;
  onRetryConflict: () => ActionResult;
  onDiscardConflict: () => ActionResult;
};

/** Ordered storyboard presentation with accessible drag and non-drag reordering. */
export const StoryboardPanel: React.FC<StoryboardPanelProps> = ({
  orderedScenes,
  selectedSceneId,
  targetDurationSeconds,
  durationTotalSeconds,
  durationMatchesTarget,
  canAddScene,
  mutationPending,
  errorMessageKey = null,
  statusMessageKey = null,
  conflict,
  onSelectScene,
  onAddScene,
  onRemoveScene,
  onReorderScenes,
  onMoveScene,
  onRetryConflict,
  onDiscardConflict,
}) => {
  const { t } = useTranslation();
  const [removeCandidate, setRemoveCandidate] = useState<RemoveCandidate | null>(null);
  const sensors = useSensors(
    useSensor(PointerSensor, {
      activationConstraint: {
        distance: 8,
      },
    })
  );
  const sceneOrder = orderedScenes.map((scene) => scene.id);
  const removeActionLabel = removeCandidate
    ? `${t('conversation.creativeStudio.storyboard.removeScene')}: ${removeCandidate.sceneLabel}`
    : t('conversation.creativeStudio.storyboard.removeScene');

  const handleDragEnd = useCallback(
    ({ active, over }: DragEndEvent) => {
      if (mutationPending || !over || active.id === over.id) return;

      const oldIndex = sceneOrder.indexOf(String(active.id));
      const newIndex = sceneOrder.indexOf(String(over.id));
      if (oldIndex < 0 || newIndex < 0) return;

      void onReorderScenes(arrayMove(sceneOrder, oldIndex, newIndex));
    },
    [mutationPending, onReorderScenes, sceneOrder]
  );

  const confirmRemove = () => {
    if (!removeCandidate || mutationPending) return;
    const sceneId = removeCandidate.sceneId;
    setRemoveCandidate(null);
    void onRemoveScene(sceneId);
  };

  return (
    <section aria-label={t('conversation.creativeStudio.storyboard.title')} className={styles.panel}>
      <header className={styles.panelHeader}>
        <h2>{t('conversation.creativeStudio.storyboard.title')}</h2>
        <p className={styles.timing}>
          {t('conversation.creativeStudio.storyboard.durationTotal', {
            total: durationTotalSeconds,
            target: targetDurationSeconds,
          })}
          <span
            className={`${styles.timingState} ${durationMatchesTarget ? styles.timingMatch : styles.timingMismatch}`}
          >
            {t(
              durationMatchesTarget
                ? 'conversation.creativeStudio.storyboard.durationMatches'
                : 'conversation.creativeStudio.storyboard.durationMismatch'
            )}
          </span>
        </p>
      </header>

      {orderedScenes.length === 0 ? (
        <p className={styles.empty}>{t('conversation.creativeStudio.storyboard.noScenes')}</p>
      ) : (
        <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={handleDragEnd}>
          <SortableContext items={sceneOrder} strategy={verticalListSortingStrategy}>
            <ol className={styles.sceneList}>
              {orderedScenes.map((scene, index) => (
                <SceneCard
                  key={scene.id}
                  scene={scene}
                  index={index}
                  selected={selectedSceneId === scene.id}
                  mutationPending={mutationPending}
                  moveUpDisabled={index === 0}
                  moveDownDisabled={index === orderedScenes.length - 1}
                  onSelect={() => onSelectScene(scene.id)}
                  onRemove={() =>
                    setRemoveCandidate({
                      sceneId: scene.id,
                      sceneLabel: t('conversation.creativeStudio.scene.accessibleName', {
                        number: index + 1,
                        title: scene.title,
                      }),
                    })
                  }
                  onMove={(direction) => void onMoveScene(scene.id, direction)}
                />
              ))}
            </ol>
          </SortableContext>
        </DndContext>
      )}

      <footer className={styles.panelFooter}>
        {errorMessageKey && (
          <div role='alert' className={`${styles.feedback} ${styles.error}`}>
            {t(errorMessageKey)}
          </div>
        )}
        {statusMessageKey && (
          <div role='status' className={`${styles.feedback} ${styles.status}`}>
            {t(statusMessageKey)}
          </div>
        )}
        {conflict && (
          <div className={styles.conflictActions}>
            <Button type='primary' loading={mutationPending} onClick={() => void onRetryConflict()}>
              {t('conversation.creativeStudio.storyboard.retry')}
            </Button>
            <Button disabled={mutationPending} onClick={() => void onDiscardConflict()}>
              {t('conversation.creativeStudio.storyboard.discard')}
            </Button>
          </div>
        )}
        {!canAddScene && <p className={styles.limit}>{t('conversation.creativeStudio.storyboard.sceneLimit')}</p>}
        <Button
          type='primary'
          long
          icon={<Add size={15} />}
          disabled={!canAddScene || mutationPending}
          onClick={() => void onAddScene()}
        >
          {t('conversation.creativeStudio.storyboard.addScene')}
        </Button>
      </footer>

      <Modal
        title={t('conversation.creativeStudio.storyboard.removeConfirmTitle')}
        visible={removeCandidate !== null}
        onCancel={() => !mutationPending && setRemoveCandidate(null)}
        footer={
          <>
            <Button disabled={mutationPending} onClick={() => setRemoveCandidate(null)}>
              {t('conversation.creativeStudio.create.cancel')}
            </Button>
            <Button
              type='primary'
              status='danger'
              aria-label={removeActionLabel}
              title={removeActionLabel}
              loading={mutationPending}
              onClick={confirmRemove}
            >
              {t('conversation.creativeStudio.storyboard.removeScene')}
            </Button>
          </>
        }
      >
        <p>{t('conversation.creativeStudio.storyboard.removeConfirmBody')}</p>
        {removeCandidate && <p>{removeCandidate.sceneLabel}</p>}
      </Modal>
    </section>
  );
};
