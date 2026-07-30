/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import { Button, Spin } from '@arco-design/web-react';
import React, { useCallback, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useNavigate, useParams } from 'react-router-dom';

import {
  SceneInspector,
  StagePreview,
  StoryboardDraftModal,
  StoryboardPanel,
  StudioHeader,
  StudioLibrary,
  StudioNavigationLock,
} from './components';
import { useStoryboardEditor, useStudioProject } from './hooks';
import styles from './StudioPage.module.css';

const StudioProjectShell: React.FC = () => {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const { id } = useParams<{ id: string }>();
  const { project: loadedProject, loading, notFound, errorMessageKey, refetch } = useStudioProject(id);
  const editor = useStoryboardEditor({ project: loadedProject, refetch });
  const [draftModalVisible, setDraftModalVisible] = useState(false);
  const project = editor.project ?? loadedProject;
  const draftConflict = editor.conflict?.operation === 'draft_storyboard' ? editor.conflict : null;
  const nonDraftConflict =
    editor.conflict !== null && editor.conflict.operation !== 'draft_storyboard' ? editor.conflict : null;
  const nonSaveConflict =
    nonDraftConflict !== null && nonDraftConflict.operation !== 'save_scene' ? nonDraftConflict : null;
  const nonDraftError =
    editor.error !== null && editor.error.operation !== 'draft_storyboard' && editor.error.operation !== 'save_scene'
      ? editor.error
      : null;
  const saveConflict = editor.conflict?.operation === 'save_scene' ? editor.conflict : null;
  const selectedSaveIssue = editor.saveIssues.find((issue) => issue.sceneId === editor.selectedScene?.id) ?? null;
  const sceneIssue =
    nonSaveConflict === null ? (saveConflict ?? selectedSaveIssue ?? editor.saveIssues[0] ?? null) : null;
  const inspectorSceneIssue =
    sceneIssue !== null && editor.selectedScene?.id === sceneIssue.sceneId ? sceneIssue : null;
  const panelSceneIssue = sceneIssue !== null && inspectorSceneIssue === null ? sceneIssue : null;
  const panelConflict = panelSceneIssue?.code === 'stale_project' ? panelSceneIssue : nonSaveConflict;
  const inspectorConflict = inspectorSceneIssue?.code === 'stale_project';
  const inspectorRecoveryVisible = inspectorSceneIssue !== null;
  const panelRecoveryVisible = panelConflict !== null || panelSceneIssue !== null;
  const draftErrorMessageKey =
    editor.error?.operation === 'draft_storyboard'
      ? editor.error.messageKey
      : draftConflict
        ? draftConflict.messageKey
        : editor.planningErrorMessageKey;

  const handleDraftStoryboard = useCallback(
    async (replaceExisting: boolean): Promise<void> => {
      if (await editor.proposeStoryboard(replaceExisting)) setDraftModalVisible(false);
    },
    [editor]
  );

  if (loading) {
    return (
      <div className={styles.centered}>
        <Spin tip={t('conversation.creativeStudio.project.loading')} />
      </div>
    );
  }

  if (errorMessageKey && !project) {
    return (
      <div role='alert' className={styles.centered}>
        {t(errorMessageKey)}
      </div>
    );
  }

  if (notFound || !project) {
    return (
      <div className={styles.centered}>
        <p>{t('conversation.creativeStudio.project.notFound')}</p>
        <Button type='primary' onClick={() => navigate('/studio')}>
          {t('conversation.creativeStudio.library.openProject')}
        </Button>
      </div>
    );
  }

  return (
    <section aria-label={t('conversation.creativeStudio.project.title')} className={styles.projectShell}>
      <StudioNavigationLock locked={editor.hasUnsavedSceneDrafts || editor.conflict !== null || editor.drafting} />
      {errorMessageKey && (
        <div role='alert' className={styles.projectAlert}>
          {t(errorMessageKey)}
        </div>
      )}
      <StudioHeader
        project={project}
        planning={editor.planning}
        planningLoading={editor.planningLoading}
        planningErrorMessageKey={draftErrorMessageKey}
        drafting={editor.drafting}
        draftDisabled={nonDraftConflict !== null}
        onBack={() => navigate('/studio')}
        onOpenDraft={() => setDraftModalVisible(true)}
      />
      <div className={styles.editorGrid}>
        <StoryboardPanel
          orderedScenes={editor.orderedScenes}
          selectedSceneId={editor.selectedSceneId}
          targetDurationSeconds={project.targetDurationSeconds}
          durationTotalSeconds={editor.durationTotalSeconds}
          durationMatchesTarget={editor.durationMatchesTarget}
          canAddScene={editor.canAddScene}
          mutationPending={editor.mutationPending}
          errorMessageKey={panelConflict?.messageKey ?? panelSceneIssue?.messageKey ?? nonDraftError?.messageKey}
          statusMessageKey={
            panelSceneIssue || nonDraftError || panelConflict
              ? 'conversation.creativeStudio.inspector.unsavedChanges'
              : null
          }
          conflict={panelRecoveryVisible}
          onSelectScene={editor.selectScene}
          onAddScene={editor.addScene}
          onRemoveScene={editor.removeScene}
          onReorderScenes={editor.reorderScenes}
          onMoveScene={editor.moveScene}
          onRetryConflict={
            panelSceneIssue !== null &&
            panelSceneIssue.code !== 'stale_project' &&
            panelSceneIssue.sceneId !== undefined
              ? () => editor.flushSceneDraftById(panelSceneIssue.sceneId!)
              : editor.retryConflict
          }
          onDiscardConflict={
            panelSceneIssue !== null &&
            panelSceneIssue.code !== 'stale_project' &&
            panelSceneIssue.sceneId !== undefined
              ? () => editor.discardSceneDraftById(panelSceneIssue.sceneId!)
              : editor.discardConflict
          }
        />
        <StagePreview projectId={project.id} selectedScene={editor.selectedScene} />
        <SceneInspector
          selectedScene={editor.selectedScene}
          sceneDraft={editor.sceneDraft}
          mutationPending={editor.mutationPending}
          errorMessageKey={inspectorSceneIssue?.messageKey}
          statusMessageKey={
            editor.mutationPending
              ? 'conversation.creativeStudio.inspector.saving'
              : inspectorSceneIssue
                ? 'conversation.creativeStudio.inspector.unsavedChanges'
                : null
          }
          conflict={inspectorRecoveryVisible}
          onUpdateSceneDraft={editor.updateSceneDraft}
          onFlushSceneDraft={editor.flushSceneDraft}
          onRetryConflict={inspectorConflict ? editor.retryConflict : editor.flushSceneDraft}
          onDiscardConflict={inspectorConflict ? editor.discardConflict : editor.discardSceneDraft}
        />
      </div>
      <StoryboardDraftModal
        visible={draftModalVisible}
        project={project}
        planning={editor.planning}
        planningLoading={editor.planningLoading}
        planningErrorMessageKey={draftErrorMessageKey}
        draftConflict={draftConflict !== null}
        drafting={editor.drafting}
        onCancel={() => setDraftModalVisible(false)}
        proposeStoryboard={handleDraftStoryboard}
        onDiscardDraftConflict={editor.discardConflict}
        onContinueManual={() => setDraftModalVisible(false)}
        onOpenSettings={() => setTimeout(() => navigate('/settings/model'), 0)}
        onRefreshPlanning={editor.refreshPlanning}
      />
    </section>
  );
};

const StudioPage: React.FC = () => {
  const { id } = useParams<{ id: string }>();

  return <main className={styles.page}>{id ? <StudioProjectShell key={id} /> : <StudioLibrary />}</main>;
};

export default StudioPage;
