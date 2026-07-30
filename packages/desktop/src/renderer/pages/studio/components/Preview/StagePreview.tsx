/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import type { StudioScene } from '@/common/types/project/creativeStudioTypes';
import { Picture, VideoOne } from '@icon-park/react';
import React from 'react';
import { useTranslation } from 'react-i18next';

const SAFE_STUDIO_ID = /^[A-Za-z0-9_-]{1,256}$/;

export type StagePreviewProps = {
  projectId: string;
  selectedScene: StudioScene | null;
};

const StagePreview: React.FC<StagePreviewProps> = ({ projectId, selectedScene }) => {
  const { t } = useTranslation();
  const mediaKind = selectedScene?.mediaKind ?? 'image';
  const accessibleName = t(
    mediaKind === 'video'
      ? 'conversation.creativeStudio.preview.videoLabel'
      : 'conversation.creativeStudio.preview.imageAlt'
  );
  const selectedAssetId = selectedScene?.selectedAssetId ?? null;

  if (selectedAssetId === null) {
    const PlaceholderIcon = mediaKind === 'video' ? VideoOne : Picture;
    return (
      <section
        aria-label={t('conversation.creativeStudio.preview.title')}
        className='flex min-h-320px flex-col items-center justify-center gap-10px rounded-12px border border-border-2 bg-fill-1 p-24px text-center'
      >
        <div
          role='img'
          aria-label={accessibleName}
          className='flex h-64px w-64px items-center justify-center rounded-full bg-fill-2 text-30px text-t-tertiary'
        >
          <PlaceholderIcon />
        </div>
        <h2 className='m-0 text-16px font-500 text-t-primary'>
          {t('conversation.creativeStudio.preview.noAssetTitle')}
        </h2>
        <p className='m-0 max-w-420px text-13px text-t-secondary'>
          {t('conversation.creativeStudio.preview.noAssetBody')}
        </p>
      </section>
    );
  }

  const isCanonical =
    SAFE_STUDIO_ID.test(projectId) &&
    SAFE_STUDIO_ID.test(selectedAssetId) &&
    selectedScene?.assetIds.includes(selectedAssetId) === true;
  if (!isCanonical) {
    return (
      <div
        role='alert'
        className='flex min-h-320px items-center justify-center rounded-12px border border-danger-3 bg-danger-light-1 p-24px text-center text-danger'
      >
        {t('conversation.creativeStudio.preview.loadFailed')}
      </div>
    );
  }

  const source = `weprompt-studio://asset/${encodeURIComponent(projectId)}/${encodeURIComponent(selectedAssetId)}`;

  return (
    <figure className='m-0 flex min-h-320px items-center justify-center overflow-hidden rounded-12px border border-border-2 bg-fill-1'>
      {mediaKind === 'video' ? (
        <video
          aria-label={accessibleName}
          className='max-h-70vh max-w-full object-contain'
          src={source}
          muted
          playsInline
          preload='metadata'
        />
      ) : (
        <img alt={accessibleName} className='max-h-70vh max-w-full object-contain' src={source} />
      )}
    </figure>
  );
};

export { StagePreview };
