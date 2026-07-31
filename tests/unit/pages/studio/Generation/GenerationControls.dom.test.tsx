/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import React from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import type {
  StudioRendererProject,
  StudioRendererJob,
  StudioRouteCatalog,
  StudioRouteCatalogEntry,
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
    image: {
      status: 'ready',
      selected: {
        providerId: suggested.providerId,
        adapterId: suggested.adapterId,
        model: suggested.model,
      },
      options: [suggested],
    },
    video: { status: 'setup_required', selected: null, options: [] },
    catalogVersion: 'catalog-v1',
    ...overrides,
  };
};

const project = (overrides: Partial<StudioRendererProject> = {}): StudioRendererProject => ({
  schemaVersion: 1,
  revision: 1,
  id: 'project-1',
  name: 'Project',
  brief: '',
  aspectRatio: '16:9',
  targetDurationSeconds: 10,
  resolution: '720p',
  sceneOrder: ['scene-1'],
  scenes: {},
  assets: {},
  jobs: {},
  routing: {
    storyboard: null,
    image: {
      providerId: 'provider_image',
      adapterId: 'weprompt-image-v1',
      model: 'image-model-v1',
    },
    video: null,
  },
  createdAt: '2026-07-30T00:00:00.000Z',
  updatedAt: '2026-07-30T00:00:00.000Z',
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
  project: project(),
  catalogLoading: false,
  catalogErrorMessageKey: null,
  onRefreshCatalog: vi.fn(),
  scene: { id: 'scene-1', mediaKind: 'image' },
  aspectRatio: '16:9',
  resolution: '720p',
  sceneDurationSeconds: 5,
  hasReference: false,
  batchSceneCount: 2,
  disabled: false,
  jobs: [],
  pendingJobIds: [],
  actionIssue: null,
  onOpenSettings: vi.fn(),
  onOpenSingleReview: vi.fn(),
  onOpenBatchReview: vi.fn(),
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

  it('derives review from persisted project routing without exposing Studio configuration controls', () => {
    const props = createProps();
    render(<GenerationControls {...props} />);

    fireEvent.click(screen.getByRole('button', { name: 'conversation.creativeStudio.review.generateScene' }));

    expect(props.onOpenSingleReview).toHaveBeenCalledWith(
      expect.objectContaining({
        route: expect.objectContaining({
          providerId: 'provider_image',
          model: 'image-model-v1',
          kind: 'image',
        }),
      })
    );
    expect(screen.queryByText('conversation.creativeStudio.routing.connectProvider')).not.toBeInTheDocument();
    expect(screen.queryByText('conversation.creativeStudio.routing.advanced')).not.toBeInTheDocument();
    expect(screen.queryByText('weprompt-image-v1')).not.toBeInTheDocument();
  });

  it('marks a missing persisted selection without auto-selecting the sole catalog option', () => {
    const props = createProps({
      project: project({ routing: { storyboard: null, image: null, video: null } }),
    });
    render(<GenerationControls {...props} />);

    expect(screen.getByText('conversation.creativeStudio.routing.missingRoute')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'conversation.creativeStudio.review.generateScene' }));
    expect(props.onOpenSingleReview).toHaveBeenCalledWith(
      expect.objectContaining({ route: null, routeStatus: 'missing' })
    );
  });

  it('can disable an unready selected scene without disabling the ready-scene batch action', () => {
    render(<GenerationControls {...createProps({ singleDisabled: true })} />);

    expect(screen.getByRole('button', { name: 'conversation.creativeStudio.review.generateScene' })).toBeDisabled();
    expect(
      screen.getByRole('button', { name: 'conversation.creativeStudio.review.generateReadyScenes' })
    ).toBeEnabled();
  });

  it('labels a scene with a selected output as another paid variation', () => {
    render(
      <GenerationControls
        {...createProps({
          scene: { id: 'scene-1', mediaKind: 'image', hasSelectedAsset: true },
        })}
      />
    );

    expect(
      screen.getByRole('button', {
        name: 'conversation.creativeStudio.review.regenerateScene',
      })
    ).toBeEnabled();
    expect(
      screen.queryByRole('button', {
        name: 'conversation.creativeStudio.review.generateScene',
      })
    ).not.toBeInTheDocument();
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
  ])('marks the persisted route invalid when it conflicts with the current $name', ({ route, props }) => {
    const componentProps = createProps({
      ...props,
      catalog: catalog({
        image: {
          status: route.health === 'unavailable' ? 'unavailable' : 'ready',
          selected: project().routing.image,
          options: [route],
        },
      }),
    });
    render(<GenerationControls {...componentProps} />);

    expect(screen.getByText('conversation.creativeStudio.routing.invalidRoute')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'conversation.creativeStudio.review.generateScene' }));
    expect(componentProps.onOpenSingleReview).toHaveBeenCalledExactlyOnceWith(
      expect.objectContaining({
        sceneId: 'scene-1',
        routeStatus: 'invalid',
      })
    );
  });

  it('opens Model Settings and exposes a typed refresh failure without owning connection commands', () => {
    const props = createProps({
      catalogErrorMessageKey: 'conversation.creativeStudio.errors.provider',
    });
    render(<GenerationControls {...props} />);

    expect(screen.getByRole('alert')).toHaveTextContent('conversation.creativeStudio.errors.provider');
    fireEvent.click(screen.getByRole('button', { name: 'conversation.creativeStudio.models.openSettings' }));
    expect(props.onOpenSettings).toHaveBeenCalledExactlyOnceWith('/settings/model');
  });

  it('matches persisted image and video selections only against their corresponding catalogs for batch review', () => {
    const video = imageRoute({
      providerId: 'provider_video',
      providerName: 'Video Provider',
      adapterId: 'byteplus-seedance-v1',
      model: 'video-model-v1',
      kind: 'video',
    });
    const props = createProps({
      project: project({
        routing: {
          storyboard: null,
          image: project().routing.image,
          video: {
            providerId: video.providerId,
            adapterId: video.adapterId,
            model: video.model,
          },
        },
      }),
      catalog: catalog({
        video: {
          status: 'ready',
          selected: {
            providerId: video.providerId,
            adapterId: video.adapterId,
            model: video.model,
          },
          options: [video],
        },
      }),
    });
    render(<GenerationControls {...props} />);

    fireEvent.click(screen.getByRole('button', { name: 'conversation.creativeStudio.review.generateReadyScenes' }));
    expect(props.onOpenBatchReview).toHaveBeenCalledExactlyOnceWith(
      expect.objectContaining({
        routes: {
          image: expect.objectContaining({ route: expect.objectContaining({ kind: 'image' }) }),
          video: expect.objectContaining({ route: expect.objectContaining({ kind: 'video' }) }),
        },
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
    expect(screen.getByText('conversation.creativeStudio.jobs.status.running')).toBeInTheDocument();
    expect(screen.getByText('conversation.creativeStudio.jobs.progress:percent=42')).toBeInTheDocument();
    expect(screen.getByText('conversation.creativeStudio.jobs.errors.auth')).toBeInTheDocument();
    expect(screen.getByText('conversation.creativeStudio.errors.cancellationRefused')).toBeInTheDocument();
    expect(screen.queryByText('secret provider response')).not.toBeInTheDocument();
    expect(screen.queryByText('byteplus-seedance-v1')).not.toBeInTheDocument();
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
