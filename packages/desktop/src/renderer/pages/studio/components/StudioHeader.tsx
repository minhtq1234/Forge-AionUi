/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import type { StudioRendererProject, StudioRouteCatalog } from '@/common/types/project/creativeStudioTypes';
import { Button, Tag } from '@arco-design/web-react';
import { Download, Left, Magic, VideoOne } from '@icon-park/react';
import React from 'react';
import { useTranslation } from 'react-i18next';

export type StudioHeaderProps = {
  project: StudioRendererProject;
  storyboard: StudioRouteCatalog['storyboard'] | null;
  catalogLoading: boolean;
  catalogErrorMessageKey: string | null;
  drafting: boolean;
  draftDisabled?: boolean;
  generationDisabled?: boolean;
  generationPending?: boolean;
  exportDisabled?: boolean;
  exportPending?: boolean;
  onBack: () => void;
  onOpenDraft: () => void;
  onOpenGenerationReview?: () => void;
  onOpenExport?: () => void;
};

const StudioHeader: React.FC<StudioHeaderProps> = ({
  project,
  storyboard,
  catalogLoading,
  catalogErrorMessageKey,
  drafting,
  draftDisabled = false,
  generationDisabled = false,
  generationPending = false,
  exportDisabled = false,
  exportPending = false,
  onBack,
  onOpenDraft,
  onOpenGenerationReview,
  onOpenExport,
}) => {
  const { t } = useTranslation();
  const isChecking = catalogLoading && storyboard === null;
  const selectedModel = storyboard?.selected ?? null;
  const selectedOption =
    selectedModel === null
      ? null
      : (storyboard?.options.find(
          (option) => option.providerId === selectedModel.providerId && option.model === selectedModel.model
        ) ?? null);
  const isReady = !isChecking && storyboard?.status === 'ready' && selectedModel !== null;
  const generationActionDisabled = generationDisabled || generationPending || onOpenGenerationReview === undefined;
  const readinessKey = isChecking
    ? 'conversation.creativeStudio.draft.checking'
    : isReady
      ? 'conversation.creativeStudio.draft.ready'
      : storyboard?.status === 'setup_required'
        ? 'conversation.creativeStudio.draft.setupRequired'
        : 'conversation.creativeStudio.draft.unavailable';

  return (
    <header className='flex flex-col gap-16px'>
      <div className='flex flex-wrap items-start justify-between gap-16px'>
        <div className='min-w-0 flex-1'>
          <nav aria-label={t('conversation.creativeStudio.project.backToLibrary')} className='mb-8px flex items-center'>
            <Button type='text' size='small' icon={<Left />} onClick={onBack}>
              {t('conversation.creativeStudio.nav.title')}
            </Button>
            <span aria-hidden='true' className='px-4px text-t-tertiary'>
              /
            </span>
            <span aria-current='page' className='truncate text-13px text-t-secondary'>
              {project.name}
            </span>
          </nav>
          <h1 className='m-0 truncate text-24px font-600 text-t-primary'>{project.name}</h1>
          <p className='m-0 mt-6px line-clamp-2 text-14px text-t-secondary'>{project.brief}</p>
        </div>

        <div className='flex flex-wrap items-center gap-8px'>
          <Button
            icon={<Download />}
            loading={exportPending}
            disabled={exportDisabled || exportPending || onOpenExport === undefined}
            onClick={onOpenExport}
          >
            {t('conversation.creativeStudio.export.action')}
          </Button>
          <Button
            icon={
              <span aria-hidden='true'>
                <VideoOne />
              </span>
            }
            loading={generationPending}
            disabled={generationActionDisabled}
            onClick={onOpenGenerationReview}
          >
            {t('conversation.creativeStudio.review.generateReadyScenes')}
          </Button>
          <Button
            type='primary'
            icon={<Magic />}
            loading={drafting}
            disabled={drafting || draftDisabled}
            onClick={onOpenDraft}
          >
            {t('conversation.creativeStudio.draft.action')}
          </Button>
        </div>
      </div>

      <div
        aria-live='polite'
        className='flex flex-wrap items-center gap-x-12px gap-y-6px rounded-8px bg-fill-1 px-12px py-10px'
      >
        <span className='text-12px text-t-secondary'>{t('conversation.creativeStudio.project.readiness')}</span>
        <Tag color={isReady ? 'green' : undefined}>{t(readinessKey)}</Tag>
        {isReady && selectedModel && (
          <>
            <span className='text-12px text-t-tertiary'>{t('conversation.creativeStudio.draft.providerLabel')}</span>
            <span className='max-w-220px truncate text-12px text-t-primary'>
              {selectedOption?.providerName ?? selectedModel.providerId}
            </span>
            <span className='text-12px text-t-tertiary'>{t('conversation.creativeStudio.draft.modelLabel')}</span>
            <span className='max-w-220px truncate text-12px text-t-primary'>{selectedModel.model}</span>
          </>
        )}
        {catalogErrorMessageKey && (
          <span role='alert' className='text-12px text-danger'>
            {t(catalogErrorMessageKey)}
          </span>
        )}
      </div>
    </header>
  );
};

export { StudioHeader };
