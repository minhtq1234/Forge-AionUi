/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import type {
  StudioAspectRatio,
  StudioMediaKind,
  StudioResolution,
  StudioSceneRouteSnapshot,
} from '@/common/types/project/creativeStudioTypes';
import { Alert, Button, Modal, Tag } from '@arco-design/web-react';
import React, { useMemo } from 'react';
import { useTranslation } from 'react-i18next';

type ActionResult = void | Promise<unknown>;

export type GenerationReviewRoute =
  | {
      status: 'valid' | 'invalid';
      snapshot: StudioSceneRouteSnapshot;
      providerName: string | null;
    }
  | {
      status: 'missing';
      snapshot: null;
      providerName: null;
    };

export type GenerationReviewScene = {
  id: string;
  title: string;
  mediaKind: StudioMediaKind;
  durationSeconds: number;
  route: GenerationReviewRoute;
};

export type GenerationReviewConfirmation = {
  sceneIds: string[];
  routes: StudioSceneRouteSnapshot[];
};

export type GenerationReviewModalProps = {
  visible: boolean;
  mode: 'single' | 'batch';
  scenes: GenerationReviewScene[];
  aspectRatio: StudioAspectRatio;
  resolution: StudioResolution;
  targetDurationSeconds: number;
  submitting: boolean;
  /** Blocks another paid submit until the parent supplies a newly reviewed intent. */
  submissionBlocked?: boolean;
  errorMessageKey?: string | null;
  onCancel: () => void;
  onConfirm: (confirmation: GenerationReviewConfirmation) => ActionResult;
};

const routeMatchesScene = (scene: GenerationReviewScene): boolean =>
  scene.route.snapshot !== null &&
  scene.route.snapshot.sceneId === scene.id &&
  scene.route.snapshot.kind === scene.mediaKind;

/**
 * Final paid-generation authorization surface.
 *
 * The component receives only already-sanitized route snapshots. It never
 * resolves providers or submits on open; the explicit confirm action is its
 * sole mutation callback.
 */
export const GenerationReviewModal: React.FC<GenerationReviewModalProps> = ({
  visible,
  mode,
  scenes,
  aspectRatio,
  resolution,
  targetDurationSeconds,
  submitting,
  submissionBlocked = false,
  errorMessageKey = null,
  onCancel,
  onConfirm,
}) => {
  const { t } = useTranslation();
  const review = useMemo(() => {
    const totalDurationSeconds = scenes.reduce((total, scene) => total + scene.durationSeconds, 0);
    const videoSeconds = scenes.reduce(
      (total, scene) => total + (scene.mediaKind === 'video' ? scene.durationSeconds : 0),
      0
    );
    const missingRoute = scenes.some((scene) => scene.route.status === 'missing');
    const invalidRoute = scenes.some(
      (scene) => scene.route.status === 'invalid' || (scene.route.snapshot !== null && !routeMatchesScene(scene))
    );
    const durationMismatch = mode === 'batch' && totalDurationSeconds !== targetDurationSeconds;
    const validRoutes = scenes
      .filter((scene) => scene.route.status === 'valid' && routeMatchesScene(scene))
      .map((scene) => scene.route.snapshot)
      .filter((route): route is StudioSceneRouteSnapshot => route !== null);

    return {
      totalDurationSeconds,
      videoSeconds,
      missingRoute,
      invalidRoute,
      durationMismatch,
      validRoutes,
      canConfirm:
        scenes.length > 0 &&
        !missingRoute &&
        !invalidRoute &&
        !durationMismatch &&
        validRoutes.length === scenes.length,
    };
  }, [mode, scenes, targetDurationSeconds]);

  const handleConfirm = (): void => {
    if (!review.canConfirm || submissionBlocked || submitting) return;
    void onConfirm({
      sceneIds: scenes.map((scene) => scene.id),
      routes: review.validRoutes,
    });
  };

  const disabledReason =
    review.missingRoute || review.invalidRoute
      ? 'conversation.creativeStudio.review.disabledMissingRoutes'
      : review.durationMismatch
        ? 'conversation.creativeStudio.review.disabledDurationMismatch'
        : null;

  const footer = (
    <div className='flex flex-wrap justify-end gap-8px'>
      <Button disabled={submitting} onClick={onCancel}>
        {t('conversation.creativeStudio.review.cancel')}
      </Button>
      <Button
        type='primary'
        loading={submitting}
        disabled={!review.canConfirm || submissionBlocked || submitting}
        onClick={handleConfirm}
      >
        {t('conversation.creativeStudio.review.confirm')}
      </Button>
    </div>
  );

  return (
    <Modal
      visible={visible}
      title={t('conversation.creativeStudio.review.title')}
      footer={footer}
      closable={!submitting}
      maskClosable={!submitting}
      escToExit={!submitting}
      unmountOnExit
      onCancel={onCancel}
    >
      <div className='flex flex-col gap-14px'>
        <div className='flex flex-wrap gap-8px' aria-live='polite'>
          <Tag>{t('conversation.creativeStudio.review.sceneCount', { count: scenes.length })}</Tag>
          <Tag>{t('conversation.creativeStudio.review.videoSeconds', { seconds: review.videoSeconds })}</Tag>
          <Tag>
            {t('conversation.creativeStudio.timeline.totalDuration')}:{' '}
            {t('conversation.creativeStudio.timeline.durationLabel', {
              seconds: review.totalDurationSeconds,
            })}
          </Tag>
          <Tag>
            {t('conversation.creativeStudio.project.targetDuration')}:{' '}
            {t('conversation.creativeStudio.timeline.durationLabel', {
              seconds: targetDurationSeconds,
            })}
          </Tag>
        </div>

        <dl className='m-0 grid grid-cols-[max-content_minmax(0,1fr)] gap-x-12px gap-y-8px rounded-8px bg-fill-1 p-12px'>
          <dt className='text-12px text-t-tertiary'>{t('conversation.creativeStudio.review.aspectRatio')}</dt>
          <dd className='m-0 text-13px text-t-primary'>{aspectRatio}</dd>
          <dt className='text-12px text-t-tertiary'>{t('conversation.creativeStudio.review.resolution')}</dt>
          <dd className='m-0 text-13px text-t-primary'>{resolution}</dd>
        </dl>

        <div className='flex flex-col gap-10px'>
          {scenes.map((scene) => (
            <article
              key={scene.id}
              aria-label={scene.title}
              className='rounded-8px border border-border-2 bg-bg-2 p-12px'
            >
              <div className='mb-10px flex flex-wrap items-center gap-8px'>
                <h3 className='m-0 min-w-0 flex-1 truncate text-14px font-600 text-t-primary'>{scene.title}</h3>
                <Tag>
                  {t(
                    scene.mediaKind === 'image'
                      ? 'conversation.creativeStudio.scene.image'
                      : 'conversation.creativeStudio.scene.video'
                  )}
                </Tag>
                <Tag>
                  {t('conversation.creativeStudio.timeline.durationLabel', {
                    seconds: scene.durationSeconds,
                  })}
                </Tag>
              </div>
              {scene.route.snapshot === null ? (
                <Alert type='warning' content={t('conversation.creativeStudio.review.missingRoute')} />
              ) : (
                <>
                  <dl className='m-0 grid grid-cols-[max-content_minmax(0,1fr)] gap-x-12px gap-y-6px'>
                    <dt className='text-12px text-t-tertiary'>
                      {t('conversation.creativeStudio.review.providerLabel')}
                    </dt>
                    <dd className='m-0 break-all text-12px text-t-primary'>
                      {scene.route.providerName ?? t('conversation.creativeStudio.models.unavailable')}
                    </dd>
                    <dt className='text-12px text-t-tertiary'>{t('conversation.creativeStudio.review.modelLabel')}</dt>
                    <dd className='m-0 break-all text-12px text-t-primary'>{scene.route.snapshot.model}</dd>
                  </dl>
                  {(scene.route.status === 'invalid' || !routeMatchesScene(scene)) && (
                    <Alert
                      className='mt-10px'
                      type='error'
                      content={t('conversation.creativeStudio.review.invalidRoute')}
                    />
                  )}
                </>
              )}
            </article>
          ))}
        </div>

        {review.durationMismatch && (
          <Alert type='warning' content={t('conversation.creativeStudio.review.durationMismatch')} />
        )}

        <div className='flex flex-col gap-8px'>
          <Alert type='info' content={t('conversation.creativeStudio.review.watermarkOff')} />
          <Alert type='info' content={t('conversation.creativeStudio.review.audioOff')} />
          <Alert type='warning' content={t('conversation.creativeStudio.review.chargeNotice')} />
        </div>

        {disabledReason && (
          <p role='status' className='m-0 rounded-8px bg-fill-1 p-10px text-12px text-t-secondary'>
            {t(disabledReason)}
          </p>
        )}
        {errorMessageKey && (
          <div role='alert' className='rounded-8px border border-danger-3 bg-danger-light-1 p-10px text-danger'>
            {t(errorMessageKey)}
          </div>
        )}
      </div>
    </Modal>
  );
};
