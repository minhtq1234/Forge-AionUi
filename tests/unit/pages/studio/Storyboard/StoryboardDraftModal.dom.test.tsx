/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import { fireEvent, render, screen, within } from '@testing-library/react';
import React from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import type {
  StudioRendererProject,
  StudioRouteCatalog,
  StudioScene,
} from '@/common/types/project/creativeStudioTypes';
import { StagePreview } from '@renderer/pages/studio/components/Preview/StagePreview';
import { StoryboardDraftModal } from '@renderer/pages/studio/components/Storyboard/StoryboardDraftModal';
import { StudioHeader } from '@renderer/pages/studio/components/StudioHeader';

vi.mock('react-i18next', () => ({ useTranslation: () => ({ t: (key: string) => key }) }));

const scene = (overrides: Partial<StudioScene> = {}): StudioScene => ({
  id: 'scene-1',
  title: 'Opening',
  purpose: 'Introduce the product',
  visualPrompt: 'A cinematic sunrise',
  narration: '',
  onScreenText: '',
  mediaKind: 'image',
  durationSeconds: 5,
  referenceAssetId: null,
  selectedAssetId: null,
  assetIds: [],
  jobIds: [],
  reviewState: 'draft',
  ...overrides,
});

const project = (withScene = false): StudioRendererProject => ({
  schemaVersion: 1,
  revision: 3,
  id: 'project-1',
  name: 'Launch story',
  brief: 'Introduce a new product',
  aspectRatio: '16:9',
  targetDurationSeconds: 15,
  resolution: '720p',
  sceneOrder: withScene ? ['scene-1'] : [],
  scenes: withScene ? { 'scene-1': scene() } : {},
  assets: {},
  jobs: {},
  routing: { storyboard: null, image: null, video: null },
  createdAt: '2026-07-30T00:00:00.000Z',
  updatedAt: '2026-07-30T00:00:00.000Z',
});

const storyboard = (
  status: StudioRouteCatalog['storyboard']['status'],
  selected: StudioRouteCatalog['storyboard']['selected'] = null
): StudioRouteCatalog['storyboard'] => ({
  status,
  selected,
  options: selected === null ? [] : [{ ...selected, providerName: 'Storyboard Provider', health: 'available' }],
});

const modalProps = (overrides: Partial<React.ComponentProps<typeof StoryboardDraftModal>> = {}) => ({
  visible: true,
  project: project(),
  storyboard: storyboard('ready', { providerId: 'story-provider', model: 'planner-model' }),
  catalogLoading: false,
  catalogErrorMessageKey: null,
  selectionPending: false,
  draftConflict: false,
  onRefreshCatalog: vi.fn(),
  onSelectStoryboardModel: vi.fn(),
  drafting: false,
  proposeStoryboard: vi.fn(),
  onDiscardDraftConflict: vi.fn(),
  onCancel: vi.fn(),
  onContinueManual: vi.fn(),
  onOpenSettings: vi.fn(),
  ...overrides,
});

describe('StudioHeader', () => {
  it('shows project identity, selected storyboard model readiness, and opens the draft review', () => {
    const onOpenDraft = vi.fn();

    render(
      <StudioHeader
        project={project()}
        storyboard={storyboard('ready', { providerId: 'story-provider', model: 'planner-model' })}
        catalogLoading={false}
        catalogErrorMessageKey={null}
        drafting={false}
        onBack={vi.fn()}
        onOpenDraft={onOpenDraft}
      />
    );

    expect(screen.getByRole('heading', { name: 'Launch story' })).toBeInTheDocument();
    expect(screen.getByText('conversation.creativeStudio.draft.ready')).toBeInTheDocument();
    expect(screen.getByText('Storyboard Provider')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'conversation.creativeStudio.draft.action' }));
    expect(onOpenDraft).toHaveBeenCalledTimes(1);
  });

  it('reports catalog failures without claiming readiness', () => {
    render(
      <StudioHeader
        project={project()}
        storyboard={null}
        catalogLoading={false}
        catalogErrorMessageKey='conversation.creativeStudio.errors.planningUnavailable'
        drafting={false}
        onBack={vi.fn()}
        onOpenDraft={vi.fn()}
      />
    );

    expect(screen.getByRole('alert')).toHaveTextContent('conversation.creativeStudio.errors.planningUnavailable');
    expect(screen.queryByText('conversation.creativeStudio.draft.ready')).not.toBeInTheDocument();
  });

  it('does not claim readiness when the route catalog omits the resolved model identity', () => {
    render(
      <StudioHeader
        project={project()}
        storyboard={storyboard('ready')}
        catalogLoading={false}
        catalogErrorMessageKey={null}
        drafting={false}
        onBack={vi.fn()}
        onOpenDraft={vi.fn()}
      />
    );

    expect(screen.queryByText('conversation.creativeStudio.draft.ready')).not.toBeInTheDocument();
    expect(screen.getByText('conversation.creativeStudio.draft.unavailable')).toBeInTheDocument();
  });

  it('delegates generation review opening without submitting generation', () => {
    const onOpenGenerationReview = vi.fn();

    render(
      <StudioHeader
        project={project(true)}
        storyboard={storyboard('ready', { providerId: 'story-provider', model: 'planner-model' })}
        catalogLoading={false}
        catalogErrorMessageKey={null}
        drafting={false}
        onBack={vi.fn()}
        onOpenDraft={vi.fn()}
        onOpenGenerationReview={onOpenGenerationReview}
      />
    );

    fireEvent.click(
      screen.getByRole('button', {
        name: 'conversation.creativeStudio.review.generateReadyScenes',
      })
    );

    expect(onOpenGenerationReview).toHaveBeenCalledTimes(1);
  });

  it('disables generation review while the action is gated or pending', () => {
    const onOpenGenerationReview = vi.fn();
    const view = render(
      <StudioHeader
        project={project(true)}
        storyboard={storyboard('ready', { providerId: 'story-provider', model: 'planner-model' })}
        catalogLoading={false}
        catalogErrorMessageKey={null}
        drafting={false}
        generationDisabled
        onBack={vi.fn()}
        onOpenDraft={vi.fn()}
        onOpenGenerationReview={onOpenGenerationReview}
      />
    );

    const action = screen.getByRole('button', {
      name: 'conversation.creativeStudio.review.generateReadyScenes',
    });
    expect(action).toBeDisabled();
    fireEvent.click(action);
    expect(onOpenGenerationReview).not.toHaveBeenCalled();

    view.rerender(
      <StudioHeader
        project={project(true)}
        storyboard={storyboard('ready', { providerId: 'story-provider', model: 'planner-model' })}
        catalogLoading={false}
        catalogErrorMessageKey={null}
        drafting={false}
        generationPending
        onBack={vi.fn()}
        onOpenDraft={vi.fn()}
        onOpenGenerationReview={onOpenGenerationReview}
      />
    );

    expect(
      screen.getByRole('button', {
        name: 'conversation.creativeStudio.review.generateReadyScenes',
      })
    ).toBeDisabled();
    fireEvent.click(
      screen.getByRole('button', {
        name: 'conversation.creativeStudio.review.generateReadyScenes',
      })
    );
    expect(onOpenGenerationReview).not.toHaveBeenCalled();
  });

  it('keeps the optional generation action inert until a review handler is integrated', () => {
    render(
      <StudioHeader
        project={project(true)}
        storyboard={storyboard('ready', { providerId: 'story-provider', model: 'planner-model' })}
        catalogLoading={false}
        catalogErrorMessageKey={null}
        drafting={false}
        onBack={vi.fn()}
        onOpenDraft={vi.fn()}
      />
    );

    expect(
      screen.getByRole('button', {
        name: 'conversation.creativeStudio.review.generateReadyScenes',
      })
    ).toBeDisabled();
  });
});

describe('StoryboardDraftModal', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('discloses the resolved provider, model, and charge before authorizing a new draft', () => {
    const props = modalProps();
    render(<StoryboardDraftModal {...props} />);

    const dialog = screen.getByRole('dialog');
    expect(within(dialog).getByText('Storyboard Provider')).toBeInTheDocument();
    expect(within(dialog).getByText('planner-model')).toBeInTheDocument();
    expect(within(dialog).getByText('conversation.creativeStudio.draft.chargeNotice')).toBeInTheDocument();

    fireEvent.click(within(dialog).getByRole('button', { name: 'conversation.creativeStudio.draft.confirm' }));
    expect(props.proposeStoryboard).toHaveBeenCalledWith(false);
  });

  it('requires explicit replacement confirmation before drafting over existing scenes', () => {
    const props = modalProps({ project: project(true) });
    render(<StoryboardDraftModal {...props} />);

    const dialog = screen.getByRole('dialog');
    const confirm = within(dialog).getByRole('button', {
      name: 'conversation.creativeStudio.draft.confirm',
    });
    expect(confirm).toBeDisabled();

    fireEvent.click(
      within(dialog).getByRole('checkbox', {
        name: 'conversation.creativeStudio.draft.replaceTitle',
      })
    );
    fireEvent.click(confirm);

    expect(props.proposeStoryboard).toHaveBeenCalledWith(true);
  });

  it('blocks duplicate authorization while readiness is checking or drafting is pending', () => {
    const checking = modalProps({
      storyboard: null,
      catalogLoading: true,
    });
    const view = render(<StoryboardDraftModal {...checking} />);

    expect(screen.getByText('conversation.creativeStudio.draft.checking')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'conversation.creativeStudio.draft.confirm' })).not.toBeInTheDocument();

    view.rerender(
      <StoryboardDraftModal
        {...modalProps({
          drafting: true,
        })}
      />
    );
    const pendingConfirm = screen.getByRole('button', {
      name: 'conversation.creativeStudio.draft.confirm',
    });
    expect(pendingConfirm).toBeDisabled();
    fireEvent.click(pendingConfirm);
    expect(checking.proposeStoryboard).not.toHaveBeenCalled();
  });

  it('offers a retry only after a catalog request has settled', () => {
    const props = modalProps({
      storyboard: null,
      catalogLoading: true,
    });
    const view = render(<StoryboardDraftModal {...props} />);

    expect(screen.queryByRole('button', { name: 'conversation.creativeStudio.library.retry' })).not.toBeInTheDocument();

    view.rerender(<StoryboardDraftModal {...props} catalogLoading={false} />);
    fireEvent.click(screen.getByRole('button', { name: 'conversation.creativeStudio.library.retry' }));

    expect(props.onRefreshCatalog).toHaveBeenCalledTimes(1);
  });

  it.each(['setup_required', 'unavailable'] as const)(
    'keeps manual editing and model setup available when storyboard status is %s',
    (status) => {
      const props = modalProps({ storyboard: storyboard(status) });
      render(<StoryboardDraftModal {...props} />);

      const dialog = screen.getByRole('dialog');
      expect(
        within(dialog).queryByRole('button', {
          name: 'conversation.creativeStudio.draft.confirm',
        })
      ).not.toBeInTheDocument();

      fireEvent.click(
        within(dialog).getByRole('button', {
          name: 'conversation.creativeStudio.draft.configureModel',
        })
      );
      fireEvent.click(
        within(dialog).getByRole('button', {
          name: 'conversation.creativeStudio.draft.manualFallback',
        })
      );

      expect(props.onOpenSettings).toHaveBeenCalledWith('/settings/model');
      expect(props.onContinueManual).toHaveBeenCalledTimes(1);
      expect(props.proposeStoryboard).not.toHaveBeenCalled();
    }
  );

  it('announces a catalog error, preserves the current storyboard, and offers a readiness retry', () => {
    const props = modalProps({
      project: project(true),
      storyboard: null,
      catalogErrorMessageKey: 'conversation.creativeStudio.errors.planningUnavailable',
    });
    render(<StoryboardDraftModal {...props} />);

    const failure = screen.getByText('conversation.creativeStudio.draft.failed').closest('[role="alert"]');
    expect(failure).toHaveTextContent('conversation.creativeStudio.draft.failed');
    expect(failure).toHaveTextContent('conversation.creativeStudio.errors.planningUnavailable');
    fireEvent.click(screen.getByRole('button', { name: 'conversation.creativeStudio.library.retry' }));

    expect(props.onRefreshCatalog).toHaveBeenCalledTimes(1);
    expect(props.proposeStoryboard).not.toHaveBeenCalled();
  });

  it('keeps charged draft conflict recovery inside the disclosure modal', () => {
    const props = modalProps({
      project: project(true),
      catalogErrorMessageKey: 'conversation.creativeStudio.errors.staleProject',
      draftConflict: true,
    });
    render(<StoryboardDraftModal {...props} />);

    const dialog = screen.getByRole('dialog');
    expect(within(dialog).getByText('Storyboard Provider')).toBeInTheDocument();
    expect(within(dialog).getByText('planner-model')).toBeInTheDocument();
    expect(within(dialog).getByText('conversation.creativeStudio.draft.chargeNotice')).toBeInTheDocument();
    fireEvent.click(
      within(dialog).getByRole('button', {
        name: 'conversation.creativeStudio.storyboard.discard',
      })
    );
    expect(props.onDiscardDraftConflict).toHaveBeenCalledTimes(1);
    expect(props.proposeStoryboard).not.toHaveBeenCalled();
  });

  it('discards a pending draft conflict when the modal is cancelled', () => {
    const props = modalProps({ draftConflict: true });
    render(<StoryboardDraftModal {...props} />);

    fireEvent.click(
      screen.getByRole('button', {
        name: 'conversation.creativeStudio.draft.cancel',
      })
    );

    expect(props.onDiscardDraftConflict).toHaveBeenCalledTimes(1);
    expect(props.onCancel).toHaveBeenCalledTimes(1);
  });
});

describe('StagePreview', () => {
  it.each([
    ['image', 'img', 'conversation.creativeStudio.preview.imageAlt'],
    ['video', 'video', 'conversation.creativeStudio.preview.videoLabel'],
  ] as const)('renders a managed %s asset from canonical IDs only', (mediaKind, tagName, accessibleName) => {
    const { container } = render(
      <StagePreview
        projectId='project-1'
        selectedScene={scene({
          mediaKind,
          selectedAssetId: 'asset_2',
          assetIds: ['asset_2'],
        })}
      />
    );

    const media = container.querySelector(tagName);
    expect(media).toHaveAttribute('src', 'weprompt-studio://asset/project-1/asset_2');
    const accessibleMedia =
      tagName === 'img' ? screen.getByRole('img', { name: accessibleName }) : screen.getByLabelText(accessibleName);
    expect(accessibleMedia).toBe(media);
  });

  it('uses a semantic media placeholder when the selected scene has no asset', () => {
    render(<StagePreview projectId='project-1' selectedScene={scene({ mediaKind: 'video' })} />);

    expect(screen.getByRole('img', { name: 'conversation.creativeStudio.preview.videoLabel' })).toBeInTheDocument();
    expect(screen.getByText('conversation.creativeStudio.preview.noAssetTitle')).toBeInTheDocument();
  });

  it('never turns traversal, provider URLs, paths, or data into a renderer media source', () => {
    const unsafeValues = [
      '../asset',
      'https://provider.example/output',
      '/Users/me/video.mp4',
      'data:video/mp4;base64,AAAA',
    ];

    for (const selectedAssetId of unsafeValues) {
      const { container, unmount } = render(
        <StagePreview projectId='project-1' selectedScene={scene({ mediaKind: 'video', selectedAssetId })} />
      );

      expect(container.querySelector('img, video')).not.toBeInTheDocument();
      expect(screen.getByRole('alert')).toHaveTextContent('conversation.creativeStudio.preview.loadFailed');
      unmount();
    }
  });
});
