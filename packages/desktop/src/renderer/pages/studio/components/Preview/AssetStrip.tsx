/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import { Button } from '@arco-design/web-react';
import { VideoOne } from '@icon-park/react';
import React from 'react';
import { useTranslation } from 'react-i18next';

import type {
  StudioAsset,
  StudioScene,
  StudioSelectVariationRequest,
} from '@/common/types/project/creativeStudioTypes';

import { createManagedStudioAssetUrl } from './StagePreview';

type ActionResult = void | Promise<unknown>;

export type AssetStripProps = {
  projectId: string;
  scene: StudioScene | null;
  assets: Readonly<Record<string, StudioAsset>>;
  projectRevision: number;
  mutationPending: boolean;
  onSelectAsset: (request: StudioSelectVariationRequest) => ActionResult;
};

/** Canonical generated variations for the selected scene. */
export const AssetStrip: React.FC<AssetStripProps> = ({
  projectId,
  scene,
  assets,
  projectRevision,
  mutationPending,
  onSelectAsset,
}) => {
  const { t } = useTranslation();
  if (scene === null) return null;

  const generatedAssets = scene.assetIds.flatMap((assetId) => {
    const candidate = assets[assetId];
    if (
      candidate === undefined ||
      candidate.id !== assetId ||
      candidate.projectId !== projectId ||
      candidate.sceneId !== scene.id ||
      candidate.mediaKind !== scene.mediaKind ||
      candidate.managedAsset.collection !== 'assets'
    ) {
      return [];
    }
    const source = createManagedStudioAssetUrl(projectId, candidate.id);
    return source === null ? [] : [{ asset: candidate, source }];
  });

  if (generatedAssets.length === 0) return null;

  return (
    <section aria-label={t('conversation.creativeStudio.preview.versions')} className='flex min-w-0 flex-col gap-8px'>
      <h3 className='m-0 text-13px font-500 text-t-secondary'>{t('conversation.creativeStudio.preview.versions')}</h3>
      <ol className='m-0 flex list-none gap-8px overflow-x-auto p-0'>
        {generatedAssets.map(({ asset, source }, index) => {
          const versionLabel = t('conversation.creativeStudio.preview.versionLabel', { number: index + 1 });
          const selectLabel = `${t('conversation.creativeStudio.preview.selectVersion')}: ${versionLabel}`;
          return (
            <li key={asset.id} className='flex-none'>
              <Button
                type='text'
                aria-label={selectLabel}
                aria-current={scene.selectedAssetId === asset.id ? 'true' : undefined}
                title={selectLabel}
                className='h-auto min-w-92px flex-col gap-6px p-6px'
                disabled={mutationPending}
                onClick={() =>
                  void onSelectAsset({
                    projectId,
                    sceneId: scene.id,
                    assetId: asset.id,
                    expectedRevision: projectRevision,
                  })
                }
              >
                <span className='flex h-54px w-80px items-center justify-center overflow-hidden rounded-6px bg-fill-2 text-24px text-t-tertiary'>
                  {asset.mediaKind === 'image' ? (
                    <img alt='' className='h-full w-full object-cover' src={source} />
                  ) : (
                    <VideoOne aria-hidden='true' />
                  )}
                </span>
                <span className='text-12px text-t-secondary'>{versionLabel}</span>
              </Button>
            </li>
          );
        })}
      </ol>
    </section>
  );
};
