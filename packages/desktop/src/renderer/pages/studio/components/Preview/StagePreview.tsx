/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import type { StudioAsset, StudioScene } from '@/common/types/project/creativeStudioTypes';
import { Picture, VideoOne } from '@icon-park/react';
import React, { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';

const SAFE_STUDIO_ID = /^[A-Za-z0-9_-]{1,256}$/;

export type StagePreviewProps = {
  projectId: string;
  selectedScene: StudioScene | null;
  /** Canonical metadata for the selected generated output. Omitted only for the legacy ID-only caller. */
  selectedAsset?: StudioAsset | null;
  /** Canonical last-frame thumbnail resolved by the controller from the selected video's job lineage. */
  posterAsset?: StudioAsset | null;
};

/** Builds the only renderer-supported Creative Studio media URL shape. */
export const createManagedStudioAssetUrl = (projectId: string, assetId: string): string | null => {
  if (!SAFE_STUDIO_ID.test(projectId) || !SAFE_STUDIO_ID.test(assetId)) return null;
  return `weprompt-studio://asset/${encodeURIComponent(projectId)}/${encodeURIComponent(assetId)}`;
};

const isCanonicalSelectedAsset = (
  asset: StudioAsset,
  projectId: string,
  scene: StudioScene,
  selectedAssetId: string
): boolean =>
  asset.id === selectedAssetId &&
  asset.projectId === projectId &&
  asset.sceneId === scene.id &&
  asset.mediaKind === scene.mediaKind &&
  asset.managedAsset.collection === 'assets' &&
  scene.assetIds.includes(asset.id) &&
  createManagedStudioAssetUrl(projectId, asset.id) !== null;

const isCanonicalPosterAsset = (asset: StudioAsset, projectId: string, scene: StudioScene): boolean =>
  asset.projectId === projectId &&
  asset.sceneId === scene.id &&
  asset.mediaKind === 'image' &&
  asset.managedAsset.collection === 'thumbnails' &&
  scene.assetIds.includes(asset.id) &&
  createManagedStudioAssetUrl(projectId, asset.id) !== null;

const StagePreview: React.FC<StagePreviewProps> = ({ projectId, selectedScene, selectedAsset, posterAsset = null }) => {
  const { t } = useTranslation();
  const [failedSource, setFailedSource] = useState<string | null>(null);
  const mediaKind = selectedScene?.mediaKind ?? 'image';
  const accessibleName = t(
    mediaKind === 'video'
      ? 'conversation.creativeStudio.preview.videoLabel'
      : 'conversation.creativeStudio.preview.imageAlt'
  );
  const selectedAssetId = selectedScene?.selectedAssetId ?? null;

  useEffect(() => {
    setFailedSource(null);
  }, [selectedAssetId]);

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

  const source = createManagedStudioAssetUrl(projectId, selectedAssetId);
  const hasCanonicalSceneIdentity = selectedScene !== null && SAFE_STUDIO_ID.test(selectedScene.id);
  const hasCanonicalAssetIdentity =
    selectedScene?.assetIds.includes(selectedAssetId) === true &&
    (selectedAsset === undefined ||
      (selectedAsset !== null && isCanonicalSelectedAsset(selectedAsset, projectId, selectedScene, selectedAssetId)));
  if (source === null || !hasCanonicalSceneIdentity || !hasCanonicalAssetIdentity || failedSource === source) {
    return (
      <div
        role='alert'
        className='flex min-h-320px items-center justify-center rounded-12px border border-danger-3 bg-danger-light-1 p-24px text-center text-danger'
      >
        {t('conversation.creativeStudio.preview.loadFailed')}
      </div>
    );
  }

  const posterSource =
    mediaKind === 'video' &&
    selectedScene !== null &&
    posterAsset !== null &&
    isCanonicalPosterAsset(posterAsset, projectId, selectedScene)
      ? createManagedStudioAssetUrl(projectId, posterAsset.id)
      : null;

  return (
    <figure
      aria-label={t('conversation.creativeStudio.preview.title')}
      className='m-0 flex min-h-320px flex-col items-center justify-center gap-10px overflow-hidden rounded-12px border border-border-2 bg-fill-1'
    >
      {mediaKind === 'video' ? (
        <>
          <video
            aria-label={accessibleName}
            className='max-h-70vh max-w-full object-contain'
            src={source}
            poster={posterSource ?? undefined}
            controls
            muted
            playsInline
            preload='metadata'
            onError={() => setFailedSource(source)}
          />
          {posterSource === null && (
            <div role='status' className='flex items-center gap-6px px-12px pb-12px text-12px text-t-secondary'>
              <Picture aria-hidden='true' />
              <span>{t('conversation.creativeStudio.preview.posterUnavailable')}</span>
            </div>
          )}
        </>
      ) : (
        <img
          alt={accessibleName}
          className='max-h-70vh max-w-full object-contain'
          src={source}
          onError={() => setFailedSource(source)}
        />
      )}
    </figure>
  );
};

export { StagePreview };
