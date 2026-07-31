/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import React from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import type {
  StudioRendererJob,
  StudioRouteCatalog,
  StudioRouteCatalogEntry,
  StudioSceneRouteSnapshot,
} from '@/common/types/project/creativeStudioTypes';
import {
  GenerationControls,
  type GenerationControlsProps,
} from '@renderer/pages/studio/components/Generation/GenerationControls';

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, values?: Record<string, unknown>) =>
      values
        ? `${key}:${Object.entries(values)
            .map(([name, value]) => `${name}=${String(value)}`)
            .join(',')}`
        : key,
  }),
}));

const imageRoute = (overrides: Partial<StudioRouteCatalogEntry> = {}): StudioRouteCatalogEntry => ({
  providerId: 'provider_image',
  providerName: 'Image Provider',
  model: 'image-model-v1',
  health: 'available',
  adapterId: 'weprompt-image-v1',
  kind: 'image',
  constraints: {
    aspectRatios: ['16:9'],
    resolutions: ['720p'],
    minDurationSeconds: 1,
    maxDurationSeconds: 60,
    supportsFirstFrame: true,
    silentOutput: true,
  },
  ...overrides,
});

const catalog = (overrides: Partial<StudioRouteCatalog> = {}): StudioRouteCatalog => {
  const suggested = imageRoute();
  return {
    storyboard: {
      status: 'ready',
      selected: { providerId: 'planner', model: 'planner-model' },
      options: [
        {
          providerId: 'planner',
          providerName: 'Planner',
          model: 'planner-model',
          health: 'available',
        },
      ],
    },
    image: { status: 'selection_required', selected: null, options: [suggested] },
    video: { status: 'setup_required', selected: null, options: [] },
    planning: { health: 'ready', resolvedModel: { providerId: 'planner', model: 'planner-model' } },
    automatic: [suggested],
    suggestions: {
      image: { reason: 'sole_compatible', route: suggested },
      video: { reason: 'no_compatible_route', route: null },
    },
    catalogVersion: 'catalog-v1',
    ...overrides,
  };
};

const selectedSnapshot = (overrides: Partial<StudioSceneRouteSnapshot> = {}): StudioSceneRouteSnapshot => ({
  sceneId: 'scene-1',
  providerId: 'provider_image',
  adapterId: 'weprompt-image-v1',
  model: 'image-model-v1',
  kind: 'image',
  ...overrides,
});

const job = (overrides: Partial<StudioRendererJob>): StudioRendererJob => ({
  id: 'job-1',
  projectId: 'project-1',
  sceneId: 'scene-1',
  status: 'running',
  provider: {
    providerId: 'provider_video',
    adapterId: 'byteplus-seedance-v1',
    model: 'seedance-1-5-pro',
  },
  outputAssetIds: [],
  error: null,
  canRetryDownload: false,
  retryOfJobId: null,
  retryReason: null,
  duplicateChargeAcknowledged: false,
  duplicateChargeAcknowledgedAt: null,
  createdAt: '2026-07-30T00:00:00.000Z',
  updatedAt: '2026-07-30T00:00:00.000Z',
  ...overrides,
});

const createProps = (overrides: Partial<GenerationControlsProps> = {}): GenerationControlsProps => ({
  catalog: catalog(),
  catalogLoading: false,
  catalogErrorMessageKey: null,
  onRefreshCatalog: vi.fn(),
  scene: { id: 'scene-1', mediaKind: 'image' },
  aspectRatio: '16:9',
  resolution: '720p',
  sceneDurationSeconds: 5,
  hasReference: false,
  selectedRoute: null,
  selectedRouteInvalid: false,
  batchSceneCount: 2,
  disabled: false,
  jobs: [],
  pendingJobIds: [],
  actionIssue: null,
  onRouteChange: vi.fn(),
  onOpenSingleReview: vi.fn(),
  onOpenBatchReview: vi.fn(),
  onOpenConnection: vi.fn(),
  onCancelJob: vi.fn(),
  onRetryJob: vi.fn(),
  onRetryDownload: vi.fn(),
  onReviewUnknownSubmission: vi.fn(),
  ...overrides,
});

describe('GenerationControls', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('does not claim a smart route or canonical reason when the catalog has no suggestion', async () => {
    const props = createProps({
      catalog: catalog({
        automatic: [],
        suggestions: {
          image: { reason: 'no_compatible_route', route: null },
          video: { reason: 'no_compatible_route', route: null },
        },
      }),
    });
    render(<GenerationControls {...props} />);

    expect(await screen.findByText('conversation.creativeStudio.routing.missingRoute')).toBeInTheDocument();
    expect(screen.queryByText('conversation.creativeStudio.routing.smartRoute')).not.toBeInTheDocument();
    expect(screen.queryByText('conversation.creativeStudio.routing.noCompatibleRoute')).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'conversation.creativeStudio.review.generateScene' }));
    fireEvent.click(screen.getByRole('button', { name: 'conversation.creativeStudio.review.generateReadyScenes' }));
    expect(props.onOpenSingleReview).toHaveBeenCalledWith({
      sceneId: 'scene-1',
      route: null,
      routeStatus: 'missing',
      catalogVersion: 'catalog-v1',
      availableRoutes: [],
    });
    expect(props.onOpenBatchReview).toHaveBeenCalledWith({
      catalogVersion: 'catalog-v1',
      suggestedRoutes: { image: null, video: null },
      availableRoutes: [],
    });
  });

  it('can disable an unready selected scene without disabling the ready-scene batch action', async () => {
    render(<GenerationControls {...createProps({ singleDisabled: true })} />);

    await screen.findByText('conversation.creativeStudio.routing.smartRoute');
    expect(screen.getByRole('button', { name: 'conversation.creativeStudio.review.generateScene' })).toBeDisabled();
    expect(
      screen.getByRole('button', { name: 'conversation.creativeStudio.review.generateReadyScenes' })
    ).toBeEnabled();
  });

  it('labels a scene with a selected output as another paid variation', async () => {
    render(
      <GenerationControls
        {...createProps({
          scene: { id: 'scene-1', mediaKind: 'image', hasSelectedAsset: true },
        })}
      />
    );

    expect(
      await screen.findByRole('button', {
        name: 'conversation.creativeStudio.review.regenerateScene',
      })
    ).toBeEnabled();
    expect(
      screen.queryByRole('button', {
        name: 'conversation.creativeStudio.review.generateScene',
      })
    ).not.toBeInTheDocument();
  });

  it('shows the canonical suggestion identity and translated reason without recomputing it', async () => {
    const props = createProps();
    render(<GenerationControls {...props} />);

    expect(await screen.findByText('conversation.creativeStudio.routing.smartRoute')).toBeInTheDocument();
    expect(screen.getByText('conversation.creativeStudio.routing.suggestionSoleCompatible')).toBeInTheDocument();
    expect(screen.getByText('Image Provider')).toBeInTheDocument();
    expect(screen.getByText('weprompt-image-v1')).toBeInTheDocument();
    expect(screen.getByText('image-model-v1')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'conversation.creativeStudio.review.generateScene' }));
    expect(props.onOpenSingleReview).toHaveBeenCalledExactlyOnceWith({
      sceneId: 'scene-1',
      route: selectedSnapshot(),
      routeStatus: 'valid',
      catalogVersion: 'catalog-v1',
      availableRoutes: [
        {
          providerId: 'provider_image',
          providerName: 'Image Provider',
          model: 'image-model-v1',
          health: 'available',
          adapterId: 'weprompt-image-v1',
          kind: 'image',
          constraints: {
            aspectRatios: ['16:9'],
            resolutions: ['720p'],
            minDurationSeconds: 1,
            maxDurationSeconds: 60,
            supportsFirstFrame: true,
            silentOutput: true,
          },
        },
      ],
    });

    fireEvent.click(screen.getByRole('button', { name: 'conversation.creativeStudio.review.generateReadyScenes' }));
    expect(props.onOpenBatchReview).toHaveBeenCalledExactlyOnceWith({
      catalogVersion: 'catalog-v1',
      suggestedRoutes: {
        image: {
          providerId: 'provider_image',
          adapterId: 'weprompt-image-v1',
          model: 'image-model-v1',
          kind: 'image',
        },
        video: null,
      },
      availableRoutes: [
        {
          providerId: 'provider_image',
          providerName: 'Image Provider',
          model: 'image-model-v1',
          health: 'available',
          adapterId: 'weprompt-image-v1',
          kind: 'image',
          constraints: {
            aspectRatios: ['16:9'],
            resolutions: ['720p'],
            minDurationSeconds: 1,
            maxDurationSeconds: 60,
            supportsFirstFrame: true,
            silentOutput: true,
          },
        },
      ],
    });
  });

  it('reports the exact Advanced route snapshot selected by the user', async () => {
    const secondRoute = imageRoute({
      providerId: 'provider_image_2',
      providerName: 'Image Provider Two',
      model: 'image-model-v2',
    });
    const props = createProps({
      catalog: catalog({
        automatic: [imageRoute(), secondRoute],
        suggestions: {
          image: { reason: 'manual_required', route: null },
          video: { reason: 'no_compatible_route', route: null },
        },
      }),
    });
    render(<GenerationControls {...props} />);

    const advanced = await screen.findByRole('radiogroup', {
      name: 'conversation.creativeStudio.routing.advanced',
    });
    fireEvent.click(within(advanced).getByRole('radio', { name: /Image Provider Two.*image-model-v2/ }));

    expect(props.onRouteChange).toHaveBeenCalledExactlyOnceWith(
      {
        sceneId: 'scene-1',
        providerId: 'provider_image_2',
        adapterId: 'weprompt-image-v1',
        model: 'image-model-v2',
        kind: 'image',
      },
      'catalog-v1'
    );
  });

  it('keeps a stale explicit route visible and never falls back to a newer smart suggestion', async () => {
    const stale = selectedSnapshot({
      providerId: 'provider_stale',
      adapterId: 'weprompt-media-gateway-v1',
      model: 'open-sora-stale',
    });
    const props = createProps({ selectedRoute: stale });
    render(<GenerationControls {...props} />);

    expect(await screen.findByText('conversation.creativeStudio.routing.invalidRoute')).toBeInTheDocument();
    expect(screen.getByText('provider_stale')).toBeInTheDocument();
    expect(screen.getByText('weprompt-media-gateway-v1')).toBeInTheDocument();
    expect(screen.getByText('open-sora-stale')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'conversation.creativeStudio.review.generateScene' }));
    expect(props.onOpenSingleReview).toHaveBeenCalledExactlyOnceWith({
      sceneId: 'scene-1',
      route: stale,
      routeStatus: 'invalid',
      catalogVersion: 'catalog-v1',
      availableRoutes: [
        {
          providerId: 'provider_image',
          providerName: 'Image Provider',
          model: 'image-model-v1',
          health: 'available',
          adapterId: 'weprompt-image-v1',
          kind: 'image',
          constraints: {
            aspectRatios: ['16:9'],
            resolutions: ['720p'],
            minDurationSeconds: 1,
            maxDurationSeconds: 60,
            supportsFirstFrame: true,
            silentOutput: true,
          },
        },
      ],
    });

    fireEvent.click(screen.getByRole('button', { name: 'conversation.creativeStudio.review.generateReadyScenes' }));
    expect(props.onOpenBatchReview).toHaveBeenCalledExactlyOnceWith(
      expect.objectContaining({
        availableRoutes: [
          {
            providerId: 'provider_image',
            providerName: 'Image Provider',
            model: 'image-model-v1',
            health: 'available',
            adapterId: 'weprompt-image-v1',
            kind: 'image',
            constraints: {
              aspectRatios: ['16:9'],
              resolutions: ['720p'],
              minDurationSeconds: 1,
              maxDurationSeconds: 60,
              supportsFirstFrame: true,
              silentOutput: true,
            },
          },
        ],
      })
    );
  });

  it.each([
    {
      name: 'aspect ratio',
      route: imageRoute(),
      props: { aspectRatio: '9:16' as const },
    },
    {
      name: 'resolution',
      route: imageRoute(),
      props: { resolution: '1080p' as const },
    },
    {
      name: 'duration',
      route: imageRoute(),
      props: { sceneDurationSeconds: 61 },
    },
    {
      name: 'first-frame input',
      route: imageRoute({
        constraints: {
          ...imageRoute().constraints,
          supportsFirstFrame: false,
        },
      }),
      props: { hasReference: true },
    },
    {
      name: 'silent output',
      route: imageRoute({
        constraints: {
          ...imageRoute().constraints,
          silentOutput: false,
        },
      }),
      props: {},
    },
    {
      name: 'provider health',
      route: imageRoute({ health: 'unavailable' }),
      props: {},
    },
  ])('surfaces a suggested route incompatible with the current $name before review', async ({ route, props }) => {
    const componentProps = createProps({
      ...props,
      catalog: catalog({
        automatic: [route],
        suggestions: {
          image: { reason: 'sole_compatible', route },
          video: { reason: 'no_compatible_route', route: null },
        },
      }),
    });
    render(<GenerationControls {...componentProps} />);

    expect(await screen.findByText('conversation.creativeStudio.routing.invalidRoute')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'conversation.creativeStudio.review.generateScene' }));
    expect(componentProps.onOpenSingleReview).toHaveBeenCalledExactlyOnceWith(
      expect.objectContaining({
        sceneId: 'scene-1',
        routeStatus: 'invalid',
      })
    );
  });

  it('announces indeterminate progress for submitting and running jobs without a numeric percentage', async () => {
    render(
      <GenerationControls
        {...createProps({
          jobs: [
            job({ id: 'job-submitting', status: 'submitting', progress: undefined }),
            job({ id: 'job-running', status: 'running', progress: undefined }),
            job({ id: 'job-queued', status: 'queued_remote', progress: undefined }),
          ],
        })}
      />
    );
    await screen.findByText('conversation.creativeStudio.routing.smartRoute');

    expect(
      within(screen.getByRole('listitem', { name: 'job-submitting' })).getByRole('progressbar', {
        name: 'conversation.creativeStudio.jobs.status.submitting',
      })
    ).toBeInTheDocument();
    expect(
      within(screen.getByRole('listitem', { name: 'job-running' })).getByRole('progressbar', {
        name: 'conversation.creativeStudio.jobs.status.running',
      })
    ).toBeInTheDocument();
    expect(
      within(screen.getByRole('listitem', { name: 'job-queued' })).queryByRole('progressbar')
    ).not.toBeInTheDocument();
  });

  it('announces localized job states, redacts provider details, and delegates cancellation', async () => {
    const props = createProps({
      jobs: [
        job({ id: 'job-running', status: 'running', progress: 42 }),
        job({
          id: 'job-failed',
          status: 'failed',
          error: {
            code: 'auth',
            messageKey: 'conversation.creativeStudio.jobs.errors.auth',
            rawMessage: 'secret provider response',
          } as StudioRendererJob['error'],
        }),
        job({
          id: 'job-download',
          status: 'failed',
          canRetryDownload: true,
          error: {
            code: 'download_failed',
            messageKey: 'conversation.creativeStudio.jobs.errors.downloadFailed',
          },
        }),
        job({
          id: 'job-unknown',
          status: 'needs_attention',
          error: {
            code: 'submission_unknown',
            messageKey: 'conversation.creativeStudio.jobs.errors.submissionUnknown',
          },
        }),
        job({
          id: 'job-attention',
          status: 'needs_attention',
          error: {
            code: 'provider_unavailable',
            messageKey: 'conversation.creativeStudio.jobs.errors.providerUnavailable',
          },
        }),
        job({ id: 'job-queued', status: 'queued_remote' }),
      ],
      actionIssue: {
        jobId: 'job-running',
        code: 'cancellation_refused',
        messageKey: 'conversation.creativeStudio.errors.cancellationRefused',
      },
    });
    const { container } = render(<GenerationControls {...props} />);
    await screen.findByText('conversation.creativeStudio.routing.smartRoute');

    expect(screen.getByText('conversation.creativeStudio.jobs.status.running')).toBeInTheDocument();
    expect(screen.getByText('conversation.creativeStudio.jobs.progress:percent=42')).toBeInTheDocument();
    expect(screen.getByText('conversation.creativeStudio.jobs.errors.auth')).toBeInTheDocument();
    expect(screen.getByText('conversation.creativeStudio.errors.cancellationRefused')).toBeInTheDocument();
    expect(screen.queryByText('secret provider response')).not.toBeInTheDocument();
    expect(container.querySelectorAll('[aria-hidden="true"] svg').length).toBeGreaterThanOrEqual(5);

    expect(
      screen.queryByRole('button', {
        name: 'conversation.creativeStudio.jobs.retry',
      })
    ).not.toBeInTheDocument();
    expect(
      screen.queryByRole('button', {
        name: 'conversation.creativeStudio.jobs.retryDownload',
      })
    ).not.toBeInTheDocument();
    fireEvent.click(
      within(screen.getByRole('listitem', { name: 'job-queued' })).getByRole('button', {
        name: 'conversation.creativeStudio.jobs.cancel',
      })
    );

    expect(props.onCancelJob).toHaveBeenCalledExactlyOnceWith('job-queued');
    await waitFor(() => expect(screen.getAllByRole('status').length).toBeGreaterThanOrEqual(5));
  });

  it('hides retry on a failed parent while its retry child is active', async () => {
    render(
      <GenerationControls
        {...createProps({
          jobs: [
            job({
              id: 'job-parent',
              status: 'failed',
              error: {
                code: 'auth',
                messageKey: 'conversation.creativeStudio.jobs.errors.auth',
              },
            }),
            job({
              id: 'job-child',
              status: 'running',
              retryOfJobId: 'job-parent',
              retryReason: 'provider_failure',
            }),
          ],
        })}
      />
    );
    await screen.findByText('conversation.creativeStudio.routing.smartRoute');

    expect(
      within(screen.getByRole('listitem', { name: 'job-parent' })).queryByRole('button', {
        name: 'conversation.creativeStudio.jobs.retry',
      })
    ).not.toBeInTheDocument();
  });

  it('makes only the terminal retry child retryable after it fails', async () => {
    const props = createProps({
      jobs: [
        job({
          id: 'job-parent',
          status: 'failed',
          error: {
            code: 'auth',
            messageKey: 'conversation.creativeStudio.jobs.errors.auth',
          },
        }),
        job({
          id: 'job-child',
          status: 'failed',
          error: {
            code: 'provider_unavailable',
            messageKey: 'conversation.creativeStudio.jobs.errors.providerUnavailable',
          },
          retryOfJobId: 'job-parent',
          retryReason: 'provider_failure',
        }),
      ],
    });
    render(<GenerationControls {...props} />);
    await screen.findByText('conversation.creativeStudio.routing.smartRoute');

    expect(
      within(screen.getByRole('listitem', { name: 'job-parent' })).queryByRole('button', {
        name: 'conversation.creativeStudio.jobs.retry',
      })
    ).not.toBeInTheDocument();
    fireEvent.click(
      within(screen.getByRole('listitem', { name: 'job-child' })).getByRole('button', {
        name: 'conversation.creativeStudio.jobs.retry',
      })
    );
    expect(props.onRetryJob).toHaveBeenCalledExactlyOnceWith('job-child');
  });

  it('disables retry when the editor is disabled', async () => {
    const props = createProps({
      disabled: true,
      jobs: [
        job({
          id: 'job-failed',
          status: 'failed',
          error: {
            code: 'auth',
            messageKey: 'conversation.creativeStudio.jobs.errors.auth',
          },
        }),
      ],
    });
    render(<GenerationControls {...props} />);
    await screen.findByText('conversation.creativeStudio.routing.smartRoute');

    const retry = within(screen.getByRole('listitem', { name: 'job-failed' })).getByRole('button', {
      name: 'conversation.creativeStudio.jobs.retry',
    });
    expect(retry).toBeDisabled();
    fireEvent.click(retry);
    expect(props.onRetryJob).not.toHaveBeenCalled();
  });

  it('disables submission-unknown acknowledgement when the editor is disabled', async () => {
    const props = createProps({
      disabled: true,
      jobs: [
        job({
          id: 'job-unknown',
          status: 'needs_attention',
          error: {
            code: 'submission_unknown',
            messageKey: 'conversation.creativeStudio.jobs.errors.submissionUnknown',
          },
        }),
      ],
    });
    render(<GenerationControls {...props} />);
    await screen.findByText('conversation.creativeStudio.routing.smartRoute');

    const retry = within(screen.getByRole('listitem', { name: 'job-unknown' })).getByRole('button', {
      name: 'conversation.creativeStudio.jobs.retry',
    });
    expect(retry).toBeDisabled();
    fireEvent.click(retry);
    expect(props.onReviewUnknownSubmission).not.toHaveBeenCalled();
  });

  it('exposes download retry only when main reports that the download is retryable', async () => {
    const props = createProps({
      jobs: [
        job({
          id: 'job-download-disabled',
          status: 'failed',
          canRetryDownload: false,
          error: {
            code: 'download_failed',
            messageKey: 'conversation.creativeStudio.jobs.errors.downloadFailed',
          },
        }),
        job({
          id: 'job-download-enabled',
          status: 'failed',
          canRetryDownload: true,
          error: {
            code: 'download_failed',
            messageKey: 'conversation.creativeStudio.jobs.errors.downloadFailed',
          },
        }),
      ],
    });
    render(<GenerationControls {...props} />);
    await screen.findByText('conversation.creativeStudio.routing.smartRoute');

    expect(
      within(screen.getByRole('listitem', { name: 'job-download-disabled' })).queryByRole('button', {
        name: 'conversation.creativeStudio.jobs.retryDownload',
      })
    ).not.toBeInTheDocument();
    fireEvent.click(
      within(screen.getByRole('listitem', { name: 'job-download-enabled' })).getByRole('button', {
        name: 'conversation.creativeStudio.jobs.retryDownload',
      })
    );
    expect(props.onRetryDownload).toHaveBeenCalledExactlyOnceWith('job-download-enabled');
  });
});
