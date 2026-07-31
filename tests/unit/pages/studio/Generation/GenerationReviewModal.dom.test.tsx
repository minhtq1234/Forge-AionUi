/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import { fireEvent, render, screen, within } from '@testing-library/react';
import React from 'react';
import { describe, expect, it, vi } from 'vitest';

import type { StudioSceneRouteSnapshot } from '@/common/types/project/creativeStudioTypes';
import {
  GenerationReviewModal,
  type GenerationReviewModalProps,
  type GenerationReviewScene,
} from '@renderer/pages/studio/components/Generation/GenerationReviewModal';

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

const route = (
  sceneId: string,
  kind: 'image' | 'video',
  providerId: string,
  adapterId: StudioSceneRouteSnapshot['adapterId'],
  model: string
): StudioSceneRouteSnapshot => ({
  sceneId,
  kind,
  providerId,
  adapterId,
  model,
});

const imageRoute = route('scene-image', 'image', 'provider_image', 'weprompt-image-v1', 'image-model-v1');
const videoRoute = route('scene-video', 'video', 'provider_video', 'byteplus-seedance-v1', 'seedance-1-5-pro');

const mixedScenes = (): GenerationReviewScene[] => [
  {
    id: 'scene-image',
    title: 'Opening image',
    mediaKind: 'image',
    durationSeconds: 5,
    route: { status: 'valid', snapshot: imageRoute, providerName: 'Provider One' },
  },
  {
    id: 'scene-video',
    title: 'Product motion',
    mediaKind: 'video',
    durationSeconds: 7,
    route: { status: 'valid', snapshot: videoRoute, providerName: 'Provider Two' },
  },
];

const createProps = (overrides: Partial<GenerationReviewModalProps> = {}): GenerationReviewModalProps => ({
  visible: true,
  mode: 'batch',
  scenes: mixedScenes(),
  aspectRatio: '16:9',
  resolution: '720p',
  targetDurationSeconds: 12,
  submitting: false,
  errorMessageKey: null,
  onCancel: vi.fn(),
  onConfirm: vi.fn(),
  ...overrides,
});

describe('GenerationReviewModal', () => {
  it('discloses every exact mixed-media route and requested output setting', () => {
    render(<GenerationReviewModal {...createProps()} />);

    const dialog = screen.getByRole('dialog');
    expect(within(dialog).getByText('Provider One')).toBeInTheDocument();
    expect(within(dialog).queryByText('provider_image')).not.toBeInTheDocument();
    expect(within(dialog).queryByText('weprompt-image-v1')).not.toBeInTheDocument();
    expect(within(dialog).getByText('image-model-v1')).toBeInTheDocument();
    expect(within(dialog).getByText('Provider Two')).toBeInTheDocument();
    expect(within(dialog).queryByText('provider_video')).not.toBeInTheDocument();
    expect(within(dialog).queryByText('byteplus-seedance-v1')).not.toBeInTheDocument();
    expect(within(dialog).getByText('seedance-1-5-pro')).toBeInTheDocument();
    expect(within(dialog).getByText('conversation.creativeStudio.review.sceneCount:count=2')).toBeInTheDocument();
    expect(within(dialog).getByText('conversation.creativeStudio.review.videoSeconds:seconds=7')).toBeInTheDocument();
    expect(
      within(dialog).getByText(
        'conversation.creativeStudio.timeline.totalDuration: conversation.creativeStudio.timeline.durationLabel:seconds=12'
      )
    ).toBeInTheDocument();
    expect(
      within(dialog).getByText(
        'conversation.creativeStudio.project.targetDuration: conversation.creativeStudio.timeline.durationLabel:seconds=12'
      )
    ).toBeInTheDocument();
    expect(
      within(screen.getByRole('article', { name: 'Opening image' })).getByText(
        'conversation.creativeStudio.timeline.durationLabel:seconds=5'
      )
    ).toBeInTheDocument();
    expect(
      within(screen.getByRole('article', { name: 'Product motion' })).getByText(
        'conversation.creativeStudio.timeline.durationLabel:seconds=7'
      )
    ).toBeInTheDocument();
    expect(within(dialog).getByText('16:9')).toBeInTheDocument();
    expect(within(dialog).getByText('720p')).toBeInTheDocument();
  });

  it('states the charge, watermark, and silent-output policy without inventing billing or audio controls', () => {
    render(<GenerationReviewModal {...createProps()} />);

    expect(screen.getByText('conversation.creativeStudio.review.chargeNotice')).toBeInTheDocument();
    expect(screen.getByText('conversation.creativeStudio.review.watermarkOff')).toBeInTheDocument();
    expect(screen.getByText('conversation.creativeStudio.review.audioOff')).toBeInTheDocument();
    expect(screen.queryByText(/credits|estimated cost/i)).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /audio/i })).not.toBeInTheDocument();
    expect(screen.queryByRole('checkbox', { name: /audio/i })).not.toBeInTheDocument();
  });

  it('blocks a batch whose selected scene timing does not exactly match the project target', () => {
    render(<GenerationReviewModal {...createProps({ targetDurationSeconds: 13 })} />);

    expect(screen.getByText('conversation.creativeStudio.review.durationMismatch')).toBeInTheDocument();
    expect(screen.getByText('conversation.creativeStudio.review.disabledDurationMismatch')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'conversation.creativeStudio.review.confirm' })).toBeDisabled();
  });

  it('allows one valid scene despite a whole-storyboard mismatch and submits only after explicit confirmation', () => {
    const onConfirm = vi.fn();
    const props = createProps({
      mode: 'single',
      scenes: [mixedScenes()[1]!],
      targetDurationSeconds: 60,
      onConfirm,
    });
    render(<GenerationReviewModal {...props} />);

    expect(onConfirm).not.toHaveBeenCalled();
    const confirm = screen.getByRole('button', {
      name: 'conversation.creativeStudio.review.confirm',
    });
    expect(confirm).toBeEnabled();
    expect(screen.queryByText('conversation.creativeStudio.review.durationMismatch')).not.toBeInTheDocument();

    fireEvent.click(confirm);
    expect(onConfirm).toHaveBeenCalledExactlyOnceWith({
      sceneIds: ['scene-video'],
      routes: [videoRoute],
    });
  });

  it('keeps an invalid route visible while missing or invalid routes disable confirmation', () => {
    const staleRoute = route('scene-video', 'video', 'provider_stale', 'weprompt-media-gateway-v1', 'open-sora-stale');
    render(
      <GenerationReviewModal
        {...createProps({
          scenes: [
            {
              ...mixedScenes()[0]!,
              route: { status: 'missing', snapshot: null, providerName: null },
            },
            {
              ...mixedScenes()[1]!,
              route: { status: 'invalid', snapshot: staleRoute, providerName: 'Unavailable provider' },
            },
          ],
        })}
      />
    );

    expect(screen.getByText('conversation.creativeStudio.review.missingRoute')).toBeInTheDocument();
    expect(screen.getByText('conversation.creativeStudio.review.invalidRoute')).toBeInTheDocument();
    expect(screen.getByText('Unavailable provider')).toBeInTheDocument();
    expect(screen.queryByText('provider_stale')).not.toBeInTheDocument();
    expect(screen.queryByText('weprompt-media-gateway-v1')).not.toBeInTheDocument();
    expect(screen.getByText('open-sora-stale')).toBeInTheDocument();
    expect(screen.getByText('conversation.creativeStudio.review.disabledMissingRoutes')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'conversation.creativeStudio.review.confirm' })).toBeDisabled();
  });

  it('keeps confirmation blocked after a submission error until the parent supplies a refreshed review', () => {
    const onConfirm = vi.fn();
    render(
      <GenerationReviewModal
        {...createProps({
          submissionBlocked: true,
          errorMessageKey: 'conversation.creativeStudio.errors.invalidRoute',
          onConfirm,
        })}
      />
    );

    expect(
      screen.getByText('conversation.creativeStudio.errors.invalidRoute').closest('[role="alert"]')
    ).toHaveTextContent('conversation.creativeStudio.errors.invalidRoute');
    const confirm = screen.getByRole('button', {
      name: 'conversation.creativeStudio.review.confirm',
    });
    expect(confirm).toBeDisabled();
    fireEvent.click(confirm);
    expect(onConfirm).not.toHaveBeenCalled();
    expect(screen.getByRole('button', { name: 'conversation.creativeStudio.review.cancel' })).toBeEnabled();
  });
});
