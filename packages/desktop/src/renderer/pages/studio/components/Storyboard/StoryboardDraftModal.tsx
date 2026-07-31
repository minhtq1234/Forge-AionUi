/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import type {
  StudioRendererProject,
  StudioRouteCatalog,
  StudioTextModelRef,
} from '@/common/types/project/creativeStudioTypes';
import { Alert, Button, Checkbox, Modal, Select, Spin } from '@arco-design/web-react';
import { Refresh } from '@icon-park/react';
import React, { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';

export type StoryboardDraftModalProps = {
  visible: boolean;
  project: StudioRendererProject;
  storyboard: StudioRouteCatalog['storyboard'] | null;
  catalogLoading: boolean;
  catalogErrorMessageKey: string | null;
  selectionPending: boolean;
  draftConflict: boolean;
  onRefreshCatalog: () => void | Promise<void>;
  onSelectStoryboardModel: (selection: StudioTextModelRef | null) => void | Promise<boolean>;
  drafting: boolean;
  proposeStoryboard: (replaceExisting: boolean) => void | Promise<void>;
  onDiscardDraftConflict: () => void | Promise<void>;
  onCancel: () => void;
  onContinueManual: () => void;
  onOpenSettings: (path: '/settings/model') => void;
};

const modelIdentity = (model: StudioTextModelRef): string => `${model.providerId}\u0000${model.model}`;

const StoryboardDraftModal: React.FC<StoryboardDraftModalProps> = ({
  visible,
  project,
  storyboard,
  catalogLoading,
  catalogErrorMessageKey,
  selectionPending,
  draftConflict,
  onRefreshCatalog,
  onSelectStoryboardModel,
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
  const isChecking = catalogLoading && storyboard === null;
  const resolvedModel = storyboard?.selected ?? null;
  const resolvedOption =
    resolvedModel === null
      ? null
      : (storyboard?.options.find((option) => modelIdentity(option) === modelIdentity(resolvedModel)) ?? null);
  const isReady = !isChecking && storyboard?.status === 'ready' && resolvedModel !== null;
  const mutationPending = drafting || selectionPending;
  const canRetryCatalog = !draftConflict && !catalogLoading && (catalogErrorMessageKey !== null || storyboard === null);

  useEffect(() => {
    if (visible) setReplaceAccepted(false);
  }, [project.id, project.revision, visible]);

  const handleCancel = (): void => {
    if (mutationPending) return;
    if (draftConflict) void onDiscardDraftConflict();
    onCancel();
  };

  const handleContinueManual = (): void => {
    if (mutationPending) return;
    if (draftConflict) void onDiscardDraftConflict();
    onContinueManual();
  };

  const handleOpenSettings = (): void => {
    if (mutationPending) return;
    if (draftConflict) void onDiscardDraftConflict();
    onOpenSettings('/settings/model');
  };

  const handleConfirm = (): void => {
    if (!isReady || mutationPending || (hasExistingScenes && !replaceAccepted)) return;
    void proposeStoryboard(hasExistingScenes);
  };

  const selector =
    storyboard !== null && storyboard.options.length > 0 ? (
      <Select
        aria-label={t('conversation.creativeStudio.models.storyboard')}
        value={resolvedModel === null ? undefined : modelIdentity(resolvedModel)}
        placeholder={t('conversation.creativeStudio.models.selectionRequired')}
        disabled={mutationPending}
        loading={selectionPending}
        onChange={(value) => {
          const option = storyboard.options.find((candidate) => modelIdentity(candidate) === value);
          if (option !== undefined) {
            void onSelectStoryboardModel({ providerId: option.providerId, model: option.model });
          }
        }}
      >
        {storyboard.options.map((option) => (
          <Select.Option key={modelIdentity(option)} value={modelIdentity(option)}>
            {option.model} · {option.providerName}
          </Select.Option>
        ))}
      </Select>
    ) : null;

  const statusContent = isChecking ? (
    <div className='flex min-h-96px items-center justify-center'>
      <Spin tip={t('conversation.creativeStudio.draft.checking')} />
    </div>
  ) : isReady ? (
    <div className='flex flex-col gap-12px'>
      <Alert type='success' content={t('conversation.creativeStudio.draft.ready')} />
      {selector}
      <dl className='m-0 grid grid-cols-[max-content_minmax(0,1fr)] gap-x-12px gap-y-8px rounded-8px bg-fill-1 p-12px'>
        <dt className='text-12px text-t-tertiary'>{t('conversation.creativeStudio.draft.providerLabel')}</dt>
        <dd className='m-0 break-all text-13px text-t-primary'>
          {resolvedOption?.providerName ?? resolvedModel.providerId}
        </dd>
        <dt className='text-12px text-t-tertiary'>{t('conversation.creativeStudio.draft.modelLabel')}</dt>
        <dd className='m-0 break-all text-13px text-t-primary'>{resolvedModel.model}</dd>
      </dl>
      <Alert type='warning' content={t('conversation.creativeStudio.draft.chargeNotice')} />
      {hasExistingScenes && (
        <div className='rounded-8px border border-warning-3 bg-warning-light-1 p-12px'>
          <Checkbox checked={replaceAccepted} disabled={mutationPending} onChange={setReplaceAccepted}>
            {t('conversation.creativeStudio.draft.replaceTitle')}
          </Checkbox>
          <p className='mb-0 ml-24px mt-6px text-12px text-t-secondary'>
            {t('conversation.creativeStudio.draft.replaceBody')}
          </p>
        </div>
      )}
    </div>
  ) : (
    <div className='flex flex-col gap-10px'>
      {selector}
      <Alert
        type={storyboard?.status === 'setup_required' ? 'warning' : 'info'}
        content={t(
          storyboard?.status === 'setup_required'
            ? 'conversation.creativeStudio.draft.setupRequired'
            : 'conversation.creativeStudio.draft.unavailable'
        )}
      />
    </div>
  );

  const footer = (
    <div className='flex flex-wrap justify-end gap-8px'>
      <Button disabled={mutationPending} onClick={handleCancel}>
        {t('conversation.creativeStudio.draft.cancel')}
      </Button>
      {isReady ? (
        <Button
          type='primary'
          loading={drafting}
          disabled={mutationPending || (hasExistingScenes && !replaceAccepted)}
          onClick={handleConfirm}
        >
          {t('conversation.creativeStudio.draft.confirm')}
        </Button>
      ) : !isChecking ? (
        <>
          <Button disabled={mutationPending} onClick={handleContinueManual}>
            {t('conversation.creativeStudio.draft.manualFallback')}
          </Button>
          <Button type='primary' disabled={mutationPending} onClick={handleOpenSettings}>
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
      closable={!mutationPending}
      maskClosable={!mutationPending}
      escToExit={!mutationPending}
      unmountOnExit
      onCancel={handleCancel}
    >
      <div className='flex flex-col gap-14px'>
        <p className='m-0 text-14px text-t-secondary'>{t('conversation.creativeStudio.draft.body')}</p>
        {statusContent}
        {catalogErrorMessageKey && (
          <div role='alert' className='rounded-8px border border-danger-3 bg-danger-light-1 p-12px text-danger'>
            <p className='m-0 text-13px font-500'>{t('conversation.creativeStudio.draft.failed')}</p>
            <p className='mb-0 mt-4px text-12px'>{t(catalogErrorMessageKey)}</p>
            {draftConflict && (
              <Button
                type='text'
                disabled={mutationPending}
                className='mt-8px'
                onClick={() => void onDiscardDraftConflict()}
              >
                {t('conversation.creativeStudio.storyboard.discard')}
              </Button>
            )}
          </div>
        )}
        {canRetryCatalog && (
          <Button
            type='text'
            icon={<Refresh />}
            disabled={mutationPending || catalogLoading}
            onClick={() => void onRefreshCatalog()}
          >
            {t('conversation.creativeStudio.library.retry')}
          </Button>
        )}
      </div>
    </Modal>
  );
};

export { StoryboardDraftModal };
