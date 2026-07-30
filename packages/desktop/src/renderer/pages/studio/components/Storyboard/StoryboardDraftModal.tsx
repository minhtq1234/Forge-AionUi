/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import type { StudioRendererProject, StudioRouteCatalog } from '@/common/types/project/creativeStudioTypes';
import { Alert, Button, Checkbox, Modal, Spin } from '@arco-design/web-react';
import { Refresh } from '@icon-park/react';
import React, { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';

export type StoryboardDraftModalProps = {
  visible: boolean;
  project: StudioRendererProject;
  planning: StudioRouteCatalog['planning'] | null;
  planningLoading: boolean;
  planningErrorMessageKey: string | null;
  draftConflict: boolean;
  onRefreshPlanning: () => void | Promise<void>;
  drafting: boolean;
  proposeStoryboard: (replaceExisting: boolean) => void | Promise<void>;
  onDiscardDraftConflict: () => void | Promise<void>;
  onCancel: () => void;
  onContinueManual: () => void;
  onOpenSettings: (path: '/settings/model') => void;
};

const StoryboardDraftModal: React.FC<StoryboardDraftModalProps> = ({
  visible,
  project,
  planning,
  planningLoading,
  planningErrorMessageKey,
  draftConflict,
  onRefreshPlanning,
  drafting,
  proposeStoryboard,
  onDiscardDraftConflict,
  onCancel,
  onContinueManual,
  onOpenSettings,
}) => {
  const { t } = useTranslation();
  const [replaceAccepted, setReplaceAccepted] = useState(false);
  const hasExistingScenes = project.sceneOrder.length > 0;
  const isChecking = planningLoading || planning?.health === 'checking';
  const resolvedModel = planning?.resolvedModel;
  const isReady = !isChecking && planning?.health === 'ready' && resolvedModel !== undefined;
  const canRetryPlanning =
    !draftConflict &&
    !planningLoading &&
    (planningErrorMessageKey !== null || planning === null || planning.health === 'checking');

  useEffect(() => {
    if (visible) setReplaceAccepted(false);
  }, [project.id, project.revision, visible]);

  const handleCancel = (): void => {
    if (drafting) return;
    if (draftConflict) void onDiscardDraftConflict();
    onCancel();
  };

  const handleContinueManual = (): void => {
    if (drafting) return;
    if (draftConflict) void onDiscardDraftConflict();
    onContinueManual();
  };

  const handleOpenSettings = (): void => {
    if (drafting) return;
    if (draftConflict) void onDiscardDraftConflict();
    onOpenSettings('/settings/model');
  };

  const handleConfirm = (): void => {
    if (!isReady || drafting || (hasExistingScenes && !replaceAccepted)) return;
    void proposeStoryboard(hasExistingScenes);
  };

  const statusContent = isChecking ? (
    <div className='flex min-h-96px items-center justify-center'>
      <Spin tip={t('conversation.creativeStudio.draft.checking')} />
    </div>
  ) : isReady ? (
    <div className='flex flex-col gap-12px'>
      <Alert type='success' content={t('conversation.creativeStudio.draft.ready')} />
      <dl className='m-0 grid grid-cols-[max-content_minmax(0,1fr)] gap-x-12px gap-y-8px rounded-8px bg-fill-1 p-12px'>
        <dt className='text-12px text-t-tertiary'>{t('conversation.creativeStudio.draft.providerLabel')}</dt>
        <dd className='m-0 break-all text-13px text-t-primary'>{resolvedModel.providerId}</dd>
        <dt className='text-12px text-t-tertiary'>{t('conversation.creativeStudio.draft.modelLabel')}</dt>
        <dd className='m-0 break-all text-13px text-t-primary'>{resolvedModel.model}</dd>
      </dl>
      <Alert type='warning' content={t('conversation.creativeStudio.draft.chargeNotice')} />
      {hasExistingScenes && (
        <div className='rounded-8px border border-warning-3 bg-warning-light-1 p-12px'>
          <Checkbox checked={replaceAccepted} disabled={drafting} onChange={setReplaceAccepted}>
            {t('conversation.creativeStudio.draft.replaceTitle')}
          </Checkbox>
          <p className='mb-0 ml-24px mt-6px text-12px text-t-secondary'>
            {t('conversation.creativeStudio.draft.replaceBody')}
          </p>
        </div>
      )}
    </div>
  ) : (
    <Alert
      type={planning?.health === 'setup_required' ? 'warning' : 'info'}
      content={t(
        planning?.health === 'setup_required'
          ? 'conversation.creativeStudio.draft.setupRequired'
          : 'conversation.creativeStudio.draft.unavailable'
      )}
    />
  );

  const footer = (
    <div className='flex flex-wrap justify-end gap-8px'>
      <Button disabled={drafting} onClick={handleCancel}>
        {t('conversation.creativeStudio.draft.cancel')}
      </Button>
      {isReady ? (
        <Button
          type='primary'
          loading={drafting}
          disabled={drafting || (hasExistingScenes && !replaceAccepted)}
          onClick={handleConfirm}
        >
          {t('conversation.creativeStudio.draft.confirm')}
        </Button>
      ) : !isChecking ? (
        <>
          <Button disabled={drafting} onClick={handleContinueManual}>
            {t('conversation.creativeStudio.draft.manualFallback')}
          </Button>
          <Button type='primary' disabled={drafting} onClick={handleOpenSettings}>
            {t('conversation.creativeStudio.draft.configureModel')}
          </Button>
        </>
      ) : null}
    </div>
  );

  return (
    <Modal
      visible={visible}
      title={t('conversation.creativeStudio.draft.title')}
      footer={footer}
      closable={!drafting}
      maskClosable={!drafting}
      escToExit={!drafting}
      unmountOnExit
      onCancel={handleCancel}
    >
      <div className='flex flex-col gap-14px'>
        <p className='m-0 text-14px text-t-secondary'>{t('conversation.creativeStudio.draft.body')}</p>
        {statusContent}
        {planningErrorMessageKey && (
          <div role='alert' className='rounded-8px border border-danger-3 bg-danger-light-1 p-12px text-danger'>
            <p className='m-0 text-13px font-500'>{t('conversation.creativeStudio.draft.failed')}</p>
            <p className='mb-0 mt-4px text-12px'>{t(planningErrorMessageKey)}</p>
            {draftConflict && (
              <Button type='text' disabled={drafting} className='mt-8px' onClick={() => void onDiscardDraftConflict()}>
                {t('conversation.creativeStudio.storyboard.discard')}
              </Button>
            )}
          </div>
        )}
        {canRetryPlanning && (
          <Button
            type='text'
            icon={<Refresh />}
            disabled={drafting || planningLoading}
            onClick={() => void onRefreshPlanning()}
          >
            {t('conversation.creativeStudio.library.retry')}
          </Button>
        )}
      </div>
    </Modal>
  );
};

export { StoryboardDraftModal };
