/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import type {
  StudioAspectRatio,
  StudioCommandErrorCode,
  StudioMediaKind,
  StudioRendererJob,
  StudioResolution,
  StudioRouteCatalog,
  StudioRouteCatalogEntry,
  StudioSceneRouteSnapshot,
} from '@/common/types/project/creativeStudioTypes';
import { Alert, Button, Progress, Radio, Spin, Tag } from '@arco-design/web-react';
import { Attention, CheckOne, CloseOne, Loading, Refresh, Time } from '@icon-park/react';
import React, { useMemo } from 'react';
import { useTranslation } from 'react-i18next';

type ActionResult = void | Promise<unknown>;

export type GenerationControlScene = {
  id: string;
  mediaKind: StudioMediaKind;
  hasSelectedAsset?: boolean;
};

export type GenerationSingleReviewRequest = {
  sceneId: string;
  route: StudioSceneRouteSnapshot | null;
  routeStatus: 'valid' | 'invalid' | 'missing';
  catalogVersion: string | null;
  availableRoutes: StudioRouteCatalogEntry[];
};

export type GenerationSuggestedRoute = Omit<StudioSceneRouteSnapshot, 'sceneId'>;

export type GenerationBatchReviewRequest = {
  catalogVersion: string | null;
  suggestedRoutes: Record<StudioMediaKind, GenerationSuggestedRoute | null>;
  availableRoutes: StudioRouteCatalogEntry[];
};

export type GenerationJobActionIssue = {
  jobId: string;
  code: StudioCommandErrorCode;
  messageKey: string;
};

export type GenerationControlsProps = {
  catalog: StudioRouteCatalog | null;
  catalogLoading: boolean;
  catalogErrorMessageKey: string | null;
  onRefreshCatalog: () => void | Promise<void>;
  scene: GenerationControlScene | null;
  aspectRatio?: StudioAspectRatio;
  resolution?: StudioResolution;
  sceneDurationSeconds?: number;
  hasReference?: boolean;
  selectedRoute: StudioSceneRouteSnapshot | null;
  selectedRouteInvalid?: boolean;
  batchSceneCount: number;
  disabled?: boolean;
  singleDisabled?: boolean;
  jobs: StudioRendererJob[];
  pendingJobIds?: readonly string[];
  actionIssue?: GenerationJobActionIssue | null;
  onRouteChange: (route: StudioSceneRouteSnapshot, catalogVersion: string) => void;
  onOpenSingleReview: (request: GenerationSingleReviewRequest) => void;
  onOpenBatchReview: (request: GenerationBatchReviewRequest) => void;
  onOpenConnection: () => void;
  onCancelJob: (jobId: string) => ActionResult;
  onRetryJob: (jobId: string) => ActionResult;
  onRetryDownload: (jobId: string) => ActionResult;
  onReviewUnknownSubmission: (jobId: string) => ActionResult;
};

const routeIdentity = (
  route: Pick<StudioRouteCatalogEntry | StudioSceneRouteSnapshot, 'providerId' | 'adapterId' | 'model' | 'kind'>
): string => `${route.providerId}\u0000${route.adapterId}\u0000${route.model}\u0000${route.kind}`;

const toSnapshot = (sceneId: string, route: StudioRouteCatalogEntry): StudioSceneRouteSnapshot => ({
  sceneId,
  providerId: route.providerId,
  adapterId: route.adapterId,
  model: route.model,
  kind: route.kind,
});

const toSuggestedRoute = (route: StudioRouteCatalogEntry | null): GenerationSuggestedRoute | null =>
  route === null
    ? null
    : {
        providerId: route.providerId,
        adapterId: route.adapterId,
        model: route.model,
        kind: route.kind,
      };

const copyCatalogEntry = (route: StudioRouteCatalogEntry): StudioRouteCatalogEntry => ({
  providerId: route.providerId,
  providerName: route.providerName,
  model: route.model,
  health: route.health,
  adapterId: route.adapterId,
  kind: route.kind,
  constraints: {
    aspectRatios: [...route.constraints.aspectRatios],
    resolutions: [...route.constraints.resolutions],
    minDurationSeconds: route.constraints.minDurationSeconds,
    maxDurationSeconds: route.constraints.maxDurationSeconds,
    supportsFirstFrame: route.constraints.supportsFirstFrame,
    silentOutput: route.constraints.silentOutput,
  },
});

const routeSupportsScene = (
  route: StudioRouteCatalogEntry,
  {
    aspectRatio,
    resolution,
    durationSeconds,
    hasReference,
  }: {
    aspectRatio?: StudioAspectRatio;
    resolution?: StudioResolution;
    durationSeconds?: number;
    hasReference?: boolean;
  }
): boolean =>
  route.health !== 'unavailable' &&
  route.constraints.silentOutput &&
  (aspectRatio === undefined || route.constraints.aspectRatios.includes(aspectRatio)) &&
  (resolution === undefined || route.constraints.resolutions.includes(resolution)) &&
  (durationSeconds === undefined ||
    (durationSeconds >= route.constraints.minDurationSeconds &&
      durationSeconds <= route.constraints.maxDurationSeconds)) &&
  (hasReference !== true || route.constraints.supportsFirstFrame);

const suggestionReasonKey = (reason: StudioRouteCatalog['suggestions'][StudioMediaKind]['reason']): string | null => {
  switch (reason) {
    case 'last_successful':
      return 'conversation.creativeStudio.routing.suggestionLastSuccessful';
    case 'configured_image_model':
      return 'conversation.creativeStudio.routing.suggestionConfiguredImageModel';
    case 'sole_compatible':
      return 'conversation.creativeStudio.routing.suggestionSoleCompatible';
    case 'manual_required':
    case 'no_compatible_route':
      return null;
  }
};

const jobStatusKey = (status: StudioRendererJob['status']): string => {
  switch (status) {
    case 'queued_local':
      return 'conversation.creativeStudio.jobs.status.queuedLocal';
    case 'submitting':
      return 'conversation.creativeStudio.jobs.status.submitting';
    case 'queued_remote':
      return 'conversation.creativeStudio.jobs.status.queuedRemote';
    case 'running':
      return 'conversation.creativeStudio.jobs.status.running';
    case 'needs_attention':
      return 'conversation.creativeStudio.jobs.status.needsAttention';
    case 'succeeded':
      return 'conversation.creativeStudio.jobs.status.succeeded';
    case 'failed':
      return 'conversation.creativeStudio.jobs.status.failed';
    case 'cancelled':
      return 'conversation.creativeStudio.jobs.status.cancelled';
  }
};

const statusIcon = (status: StudioRendererJob['status']): React.ReactNode => {
  switch (status) {
    case 'queued_local':
    case 'queued_remote':
      return <Time />;
    case 'submitting':
    case 'running':
      return <Loading />;
    case 'succeeded':
      return <CheckOne />;
    case 'needs_attention':
      return <Attention />;
    case 'failed':
    case 'cancelled':
      return <CloseOne />;
  }
};

const RouteIdentity: React.FC<{
  provider: string;
  adapter: string;
  model: string;
}> = ({ provider, adapter, model }) => {
  const { t } = useTranslation();
  return (
    <dl className='m-0 grid grid-cols-[max-content_minmax(0,1fr)] gap-x-10px gap-y-5px'>
      <dt className='text-12px text-t-tertiary'>{t('conversation.creativeStudio.routing.providerLabel')}</dt>
      <dd className='m-0 break-all text-12px text-t-primary'>{provider}</dd>
      <dt className='text-12px text-t-tertiary'>{t('conversation.creativeStudio.routing.adapterLabel')}</dt>
      <dd className='m-0 break-all text-12px text-t-primary'>{adapter}</dd>
      <dt className='text-12px text-t-tertiary'>{t('conversation.creativeStudio.routing.modelLabel')}</dt>
      <dd className='m-0 break-all text-12px text-t-primary'>{model}</dd>
    </dl>
  );
};

/**
 * Canonical route catalog viewer, review launcher, and job-action surface.
 *
 * Route suggestions are consumed exactly as returned by the main process.
 * Every button here either opens review/setup or delegates a typed job intent;
 * it never submits paid generation directly.
 */
export const GenerationControls: React.FC<GenerationControlsProps> = ({
  catalog,
  catalogLoading,
  catalogErrorMessageKey,
  onRefreshCatalog,
  scene,
  aspectRatio,
  resolution,
  sceneDurationSeconds,
  hasReference,
  selectedRoute,
  selectedRouteInvalid = false,
  batchSceneCount,
  disabled = false,
  singleDisabled = false,
  jobs,
  pendingJobIds = [],
  actionIssue = null,
  onRouteChange,
  onOpenSingleReview,
  onOpenBatchReview,
  onOpenConnection,
  onCancelJob,
  onRetryJob,
  onRetryDownload,
  onReviewUnknownSubmission,
}) => {
  const { t } = useTranslation();
  const pendingIds = useMemo(() => new Set(pendingJobIds), [pendingJobIds]);
  const retryParentIds = useMemo(
    () => new Set(jobs.flatMap((job) => (job.retryOfJobId === null ? [] : [job.retryOfJobId]))),
    [jobs]
  );

  const kind = scene?.mediaKind ?? null;
  const suggestion = kind && catalog ? catalog.suggestions[kind] : null;
  const suggestedRoute = suggestion?.route ?? null;
  const reasonKey = suggestion && suggestedRoute ? suggestionReasonKey(suggestion.reason) : null;
  const advancedRoutes = useMemo(
    () => (catalog && kind ? catalog.automatic.filter((route) => route.kind === kind) : []),
    [catalog, kind]
  );
  const availableRoutes = useMemo(() => catalog?.automatic.map(copyCatalogEntry) ?? [], [catalog]);
  const selectedCatalogRoute =
    selectedRoute === null
      ? null
      : (advancedRoutes.find((route) => routeIdentity(route) === routeIdentity(selectedRoute)) ?? null);
  const routeContext = {
    ...(aspectRatio === undefined ? {} : { aspectRatio }),
    ...(resolution === undefined ? {} : { resolution }),
    ...(sceneDurationSeconds === undefined ? {} : { durationSeconds: sceneDurationSeconds }),
    ...(hasReference === undefined ? {} : { hasReference }),
  };
  const suggestedRouteIsInvalid = suggestedRoute !== null && !routeSupportsScene(suggestedRoute, routeContext);
  const selectedRouteIsInvalid =
    catalog !== null &&
    selectedRoute !== null &&
    (selectedRouteInvalid ||
      scene === null ||
      selectedRoute.sceneId !== scene.id ||
      selectedRoute.kind !== scene.mediaKind ||
      selectedCatalogRoute === null ||
      !routeSupportsScene(selectedCatalogRoute, routeContext));
  const effectiveRoute =
    selectedRoute ?? (scene !== null && suggestedRoute !== null ? toSnapshot(scene.id, suggestedRoute) : null);
  const effectiveRouteStatus: GenerationSingleReviewRequest['routeStatus'] =
    effectiveRoute === null
      ? 'missing'
      : selectedRoute !== null
        ? catalog === null || selectedRouteIsInvalid
          ? 'invalid'
          : 'valid'
        : suggestedRouteIsInvalid
          ? 'invalid'
          : 'valid';
  const showAdvanced = advancedRoutes.length > 1 || selectedRoute !== null;

  const selectAdvancedRoute = (identity: string): void => {
    if (!scene || !catalog) return;
    const route = advancedRoutes.find((candidate) => routeIdentity(candidate) === identity);
    if (!route) return;
    onRouteChange(toSnapshot(scene.id, route), catalog.catalogVersion);
  };

  const openSingleReview = (): void => {
    if (!scene || catalogLoading) return;
    onOpenSingleReview({
      sceneId: scene.id,
      route: effectiveRoute,
      routeStatus: effectiveRouteStatus,
      catalogVersion: catalog?.catalogVersion ?? null,
      availableRoutes,
    });
  };

  const openBatchReview = (): void => {
    if (catalogLoading) return;
    onOpenBatchReview({
      catalogVersion: catalog?.catalogVersion ?? null,
      suggestedRoutes: {
        image: toSuggestedRoute(catalog?.suggestions.image.route ?? null),
        video: toSuggestedRoute(catalog?.suggestions.video.route ?? null),
      },
      availableRoutes,
    });
  };

  return (
    <section aria-label={t('conversation.creativeStudio.routing.title')} className='flex flex-col gap-14px'>
      <div className='flex flex-wrap items-center justify-between gap-8px'>
        <h2 className='m-0 text-16px font-600 text-t-primary'>{t('conversation.creativeStudio.routing.title')}</h2>
        <div className='flex flex-wrap gap-8px'>
          <Button
            type='text'
            icon={
              <span aria-hidden='true'>
                <Refresh />
              </span>
            }
            loading={catalogLoading}
            disabled={disabled}
            onClick={() => void onRefreshCatalog()}
          >
            {t('conversation.creativeStudio.connection.refresh')}
          </Button>
          <Button disabled={disabled} onClick={onOpenConnection}>
            {t('conversation.creativeStudio.routing.connectProvider')}
          </Button>
        </div>
      </div>

      {catalogLoading && catalog === null ? (
        <div className='flex min-h-80px items-center justify-center'>
          <Spin />
        </div>
      ) : (
        <>
          {catalogErrorMessageKey && <Alert type='error' content={t(catalogErrorMessageKey)} />}

          {suggestedRoute !== null && reasonKey !== null ? (
            <section
              aria-label={t('conversation.creativeStudio.routing.smartRoute')}
              className='rounded-8px border border-border-2 bg-fill-1 p-12px'
            >
              <div className='mb-8px flex flex-wrap items-center gap-8px'>
                <h3 className='m-0 text-13px font-600 text-t-primary'>
                  {t('conversation.creativeStudio.routing.smartRoute')}
                </h3>
                <Tag>{t(reasonKey)}</Tag>
              </div>
              <RouteIdentity
                provider={suggestedRoute.providerName}
                adapter={suggestedRoute.adapterId}
                model={suggestedRoute.model}
              />
              {suggestedRouteIsInvalid && (
                <Alert
                  className='mt-8px'
                  type='error'
                  content={t('conversation.creativeStudio.routing.invalidRoute')}
                />
              )}
            </section>
          ) : (
            <div role='status' className='rounded-8px border border-warning-3 bg-warning-light-1 p-10px text-warning'>
              {t('conversation.creativeStudio.routing.missingRoute')}
            </div>
          )}

          {showAdvanced && (
            <section className='rounded-8px border border-border-2 p-12px'>
              <h3 className='mb-8px mt-0 text-13px font-600 text-t-primary'>
                {t('conversation.creativeStudio.routing.advanced')}
              </h3>
              <Radio.Group
                aria-label={t('conversation.creativeStudio.routing.advanced')}
                value={selectedCatalogRoute ? routeIdentity(selectedCatalogRoute) : undefined}
                direction='vertical'
                onChange={selectAdvancedRoute}
              >
                {advancedRoutes.map((route) => (
                  <Radio
                    key={routeIdentity(route)}
                    value={routeIdentity(route)}
                    aria-label={`${route.providerName} ${route.adapterId} ${route.model}`}
                  >
                    <span className='break-all text-12px text-t-primary'>
                      {route.providerName} · {route.adapterId} · {route.model}
                    </span>
                  </Radio>
                ))}
              </Radio.Group>
            </section>
          )}

          {selectedRoute !== null && (
            <section className='rounded-8px border border-border-2 bg-fill-1 p-12px'>
              <RouteIdentity
                provider={selectedRoute.providerId}
                adapter={selectedRoute.adapterId}
                model={selectedRoute.model}
              />
              {selectedRouteIsInvalid && (
                <Alert
                  className='mt-8px'
                  type='error'
                  content={t('conversation.creativeStudio.routing.invalidRoute')}
                />
              )}
            </section>
          )}
        </>
      )}

      <div className='flex flex-wrap gap-8px'>
        <Button
          type='primary'
          disabled={disabled || singleDisabled || scene === null || catalogLoading}
          onClick={openSingleReview}
        >
          {t(
            scene?.hasSelectedAsset
              ? 'conversation.creativeStudio.review.regenerateScene'
              : 'conversation.creativeStudio.review.generateScene'
          )}
        </Button>
        <Button disabled={disabled || batchSceneCount < 1 || catalogLoading} onClick={openBatchReview}>
          {t('conversation.creativeStudio.review.generateReadyScenes')}
        </Button>
      </div>

      <section aria-label={t('conversation.creativeStudio.jobs.title')} className='flex flex-col gap-10px'>
        <h3 className='m-0 text-14px font-600 text-t-primary'>{t('conversation.creativeStudio.jobs.title')}</h3>
        {actionIssue && (
          <div role='alert' className='rounded-8px border border-danger-3 bg-danger-light-1 p-10px text-danger'>
            <span>{t(actionIssue.messageKey)}</span>
            <code className='ml-8px text-11px'>{actionIssue.code}</code>
          </div>
        )}
        {jobs.length === 0 ? (
          <p className='m-0 text-12px text-t-tertiary'>{t('conversation.creativeStudio.jobs.noJobs')}</p>
        ) : (
          <ul className='m-0 flex list-none flex-col gap-8px p-0'>
            {jobs.map((job) => {
              const pending = pendingIds.has(job.id);
              const hasRetryChild = retryParentIds.has(job.id);
              const hasOtherActiveJob = jobs.some(
                (candidate) =>
                  candidate.id !== job.id && !['succeeded', 'failed', 'cancelled'].includes(candidate.status)
              );
              const recoveryBlocked = hasRetryChild || hasOtherActiveJob;
              const submissionUnknown =
                job.status === 'needs_attention' && job.error?.code === 'submission_unknown' && !recoveryBlocked;
              const downloadFailed =
                job.status === 'failed' &&
                job.error?.code === 'download_failed' &&
                job.canRetryDownload &&
                !recoveryBlocked;
              const canRetry =
                (job.status === 'failed' || job.status === 'needs_attention') &&
                job.error?.code !== 'submission_unknown' &&
                job.error?.code !== 'download_failed' &&
                !recoveryBlocked;
              const canCancel = job.status === 'queued_local' || job.status === 'queued_remote';

              return (
                <li key={job.id} aria-label={job.id} className='rounded-8px border border-border-2 bg-fill-1 p-10px'>
                  <div role='status' aria-live='polite' className='flex flex-wrap items-center gap-8px'>
                    <span aria-hidden='true' className='flex text-t-secondary'>
                      {statusIcon(job.status)}
                    </span>
                    <span className='text-12px font-500 text-t-primary'>{t(jobStatusKey(job.status))}</span>
                    <span className='break-all text-11px text-t-tertiary'>
                      {job.provider.providerId} · {job.provider.adapterId} · {job.provider.model}
                    </span>
                  </div>

                  {(job.status === 'submitting' || job.status === 'running') && typeof job.progress !== 'number' && (
                    <div
                      role='progressbar'
                      aria-label={t(jobStatusKey(job.status))}
                      className='mt-8px flex items-center'
                    >
                      <Spin size={12} />
                    </div>
                  )}

                  {typeof job.progress === 'number' && (
                    <div className='mt-8px'>
                      <Progress percent={job.progress} size='small' showText={false} />
                      <span className='text-11px text-t-secondary'>
                        {t('conversation.creativeStudio.jobs.progress', { percent: job.progress })}
                      </span>
                    </div>
                  )}

                  {job.error && (
                    <div role='alert' className='mt-8px text-12px text-danger'>
                      <span>{t(job.error.messageKey)}</span>
                      <code className='ml-8px text-11px'>{job.error.code}</code>
                    </div>
                  )}

                  {(canCancel || canRetry || downloadFailed || submissionUnknown) && (
                    <div className='mt-8px flex flex-wrap gap-8px'>
                      {canCancel && (
                        <Button size='mini' disabled={pending} onClick={() => void onCancelJob(job.id)}>
                          {t('conversation.creativeStudio.jobs.cancel')}
                        </Button>
                      )}
                      {canRetry && (
                        <Button size='mini' disabled={disabled || pending} onClick={() => void onRetryJob(job.id)}>
                          {t('conversation.creativeStudio.jobs.retry')}
                        </Button>
                      )}
                      {downloadFailed && (
                        <Button size='mini' disabled={pending} onClick={() => void onRetryDownload(job.id)}>
                          {t('conversation.creativeStudio.jobs.retryDownload')}
                        </Button>
                      )}
                      {submissionUnknown && (
                        <Button
                          size='mini'
                          disabled={disabled || pending}
                          onClick={() => void onReviewUnknownSubmission(job.id)}
                        >
                          {t('conversation.creativeStudio.jobs.retry')}
                        </Button>
                      )}
                    </div>
                  )}
                </li>
              );
            })}
          </ul>
        )}
      </section>
    </section>
  );
};
