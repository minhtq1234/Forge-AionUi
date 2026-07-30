/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import { fireEvent, render, screen } from '@testing-library/react';
import React from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import type { StudioAsset, StudioScene } from '@/common/types/project/creativeStudioTypes';
import { AssetStrip } from '@renderer/pages/studio/components/Preview/AssetStrip';
import { StagePreview } from '@renderer/pages/studio/components/Preview/StagePreview';
import { SceneTimeline } from '@renderer/pages/studio/components/SceneTimeline';

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, params?: Record<string, string | number>) => {
      if (params?.number !== undefined) return `${key}:${params.number}`;
      if (params?.seconds !== undefined) return `${key}:${params.seconds}`;
      return key;
    },
  }),
}));

const scene = (overrides: Partial<StudioScene> = {}): StudioScene => ({
  id: 'scene-1',
  title: 'Opening',
  purpose: 'Introduce the story',
  visualPrompt: 'A cinematic sunrise',
  narration: '',
  onScreenText: '',
  mediaKind: 'image',
  durationSeconds: 5,
  referenceAssetId: null,
  selectedAssetId: null,
  assetIds: [],
  jobIds: [],
  reviewState: 'complete',
  ...overrides,
});

const asset = (overrides: Partial<StudioAsset> = {}): StudioAsset => ({
  id: 'asset-1',
  projectId: 'project-1',
  sceneId: 'scene-1',
  mediaKind: 'image',
  mimeType: 'image/png',
  managedAsset: { collection: 'assets', fileName: 'asset-1.png' },
  byteSize: 128,
  sha256: '1'.repeat(64),
  createdAt: '2026-07-30T00:00:00.000Z',
  ...overrides,
});

describe('StagePreview managed media', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('renders a canonical managed image without exposing any other source shape', () => {
    const selectedAsset = asset();
    render(
      <StagePreview
        projectId='project-1'
        selectedScene={scene({ selectedAssetId: selectedAsset.id, assetIds: [selectedAsset.id] })}
        selectedAsset={selectedAsset}
      />
    );

    expect(screen.getByRole('img', { name: 'conversation.creativeStudio.preview.imageAlt' })).toHaveAttribute(
      'src',
      'weprompt-studio://asset/project-1/asset-1'
    );
  });

  it('renders canonical video controls with an optional canonical poster', () => {
    const selectedAsset = asset({
      id: 'video-1',
      mediaKind: 'video',
      mimeType: 'video/mp4',
      managedAsset: { collection: 'assets', fileName: 'video-1.mp4' },
    });
    const posterAsset = asset({
      id: 'poster-1',
      managedAsset: { collection: 'thumbnails', fileName: 'poster-1.png' },
    });
    render(
      <StagePreview
        projectId='project-1'
        selectedScene={scene({
          mediaKind: 'video',
          selectedAssetId: selectedAsset.id,
          assetIds: [selectedAsset.id, posterAsset.id],
        })}
        selectedAsset={selectedAsset}
        posterAsset={posterAsset}
      />
    );

    const video = screen.getByLabelText('conversation.creativeStudio.preview.videoLabel');
    expect(
      screen.getByRole('figure', {
        name: 'conversation.creativeStudio.preview.title',
      })
    ).toContainElement(video);
    expect(video).toHaveAttribute('src', 'weprompt-studio://asset/project-1/video-1');
    expect(video).toHaveAttribute('poster', 'weprompt-studio://asset/project-1/poster-1');
    expect(video).toHaveAttribute('controls');
  });

  it('announces the missing-poster placeholder while keeping canonical video playback available', () => {
    const selectedAsset = asset({
      id: 'video-1',
      mediaKind: 'video',
      mimeType: 'video/mp4',
      managedAsset: { collection: 'assets', fileName: 'video-1.mp4' },
    });
    render(
      <StagePreview
        projectId='project-1'
        selectedScene={scene({
          mediaKind: 'video',
          selectedAssetId: selectedAsset.id,
          assetIds: [selectedAsset.id],
        })}
        selectedAsset={selectedAsset}
      />
    );

    expect(screen.getByRole('status')).toHaveTextContent('conversation.creativeStudio.preview.posterUnavailable');
    expect(screen.getByLabelText('conversation.creativeStudio.preview.videoLabel')).toHaveAttribute('controls');
  });

  it('replaces failed managed media with a semantic error placeholder', () => {
    const selectedAsset = asset();
    render(
      <StagePreview
        projectId='project-1'
        selectedScene={scene({ selectedAssetId: selectedAsset.id, assetIds: [selectedAsset.id] })}
        selectedAsset={selectedAsset}
      />
    );

    fireEvent.error(screen.getByRole('img', { name: 'conversation.creativeStudio.preview.imageAlt' }));

    expect(screen.getByRole('alert')).toHaveTextContent('conversation.creativeStudio.preview.loadFailed');
    expect(screen.queryByRole('img', { name: 'conversation.creativeStudio.preview.imageAlt' })).not.toBeInTheDocument();
  });

  it('retries a previously failed source after the user selects away and back', () => {
    const first = asset();
    const second = asset({
      id: 'asset-2',
      managedAsset: { collection: 'assets', fileName: 'asset-2.png' },
    });
    const view = render(
      <StagePreview
        projectId='project-1'
        selectedScene={scene({ selectedAssetId: first.id, assetIds: [first.id, second.id] })}
        selectedAsset={first}
      />
    );
    fireEvent.error(screen.getByRole('img', { name: 'conversation.creativeStudio.preview.imageAlt' }));
    expect(screen.getByRole('alert')).toBeInTheDocument();

    view.rerender(
      <StagePreview
        projectId='project-1'
        selectedScene={scene({ selectedAssetId: second.id, assetIds: [first.id, second.id] })}
        selectedAsset={second}
      />
    );
    view.rerender(
      <StagePreview
        projectId='project-1'
        selectedScene={scene({ selectedAssetId: first.id, assetIds: [first.id, second.id] })}
        selectedAsset={first}
      />
    );

    expect(screen.getByRole('img', { name: 'conversation.creativeStudio.preview.imageAlt' })).toHaveAttribute(
      'src',
      'weprompt-studio://asset/project-1/asset-1'
    );
  });

  it('rejects a thumbnail that is not linked to the canonical scene', () => {
    const selectedAsset = asset({
      id: 'video-1',
      mediaKind: 'video',
      mimeType: 'video/mp4',
      managedAsset: { collection: 'assets', fileName: 'video-1.mp4' },
    });
    const posterAsset = asset({
      id: 'poster-unlinked',
      managedAsset: { collection: 'thumbnails', fileName: 'poster-unlinked.png' },
    });
    render(
      <StagePreview
        projectId='project-1'
        selectedScene={scene({
          mediaKind: 'video',
          selectedAssetId: selectedAsset.id,
          assetIds: [selectedAsset.id],
        })}
        selectedAsset={selectedAsset}
        posterAsset={posterAsset}
      />
    );

    expect(screen.getByLabelText('conversation.creativeStudio.preview.videoLabel')).not.toHaveAttribute('poster');
    expect(screen.getByRole('status')).toHaveTextContent('conversation.creativeStudio.preview.posterUnavailable');
  });

  it('rejects asset metadata that does not belong to the canonical project and scene', () => {
    const selectedAsset = asset({ projectId: 'other-project' });
    render(
      <StagePreview
        projectId='project-1'
        selectedScene={scene({ selectedAssetId: selectedAsset.id, assetIds: [selectedAsset.id] })}
        selectedAsset={selectedAsset}
      />
    );

    expect(screen.getByRole('alert')).toHaveTextContent('conversation.creativeStudio.preview.loadFailed');
    expect(document.querySelector('img, video')).not.toBeInTheDocument();
  });

  it('uses no renderer fetch, FileReader, or base64 path for video playback', () => {
    const fetchSpy = vi.fn();
    const fileReaderSpy = vi.fn();
    vi.stubGlobal('fetch', fetchSpy);
    vi.stubGlobal('FileReader', fileReaderSpy);
    const selectedAsset = asset({
      id: 'video-1',
      mediaKind: 'video',
      mimeType: 'video/mp4',
      managedAsset: { collection: 'assets', fileName: 'video-1.mp4' },
    });
    render(
      <StagePreview
        projectId='project-1'
        selectedScene={scene({
          mediaKind: 'video',
          selectedAssetId: selectedAsset.id,
          assetIds: [selectedAsset.id],
        })}
        selectedAsset={selectedAsset}
      />
    );

    expect(fetchSpy).not.toHaveBeenCalled();
    expect(fileReaderSpy).not.toHaveBeenCalled();
    expect(screen.getByLabelText('conversation.creativeStudio.preview.videoLabel').getAttribute('src')).not.toContain(
      'base64'
    );
  });
});

describe('AssetStrip canonical variations', () => {
  it('renders only generated outputs that canonically belong to the scene', () => {
    const generated = asset();
    const imported = asset({
      id: 'import-1',
      managedAsset: { collection: 'imports', fileName: 'import-1.png' },
    });
    const thumbnail = asset({
      id: 'thumb-1',
      managedAsset: { collection: 'thumbnails', fileName: 'thumb-1.png' },
    });
    const otherScene = asset({ id: 'other-scene', sceneId: 'scene-2' });
    const wrongKind = asset({ id: 'video-1', mediaKind: 'video', mimeType: 'video/mp4' });
    render(
      <AssetStrip
        projectId='project-1'
        scene={scene({
          selectedAssetId: generated.id,
          assetIds: [generated.id, imported.id, thumbnail.id, otherScene.id, wrongKind.id],
        })}
        assets={{
          [generated.id]: generated,
          [imported.id]: imported,
          [thumbnail.id]: thumbnail,
          [otherScene.id]: otherScene,
          [wrongKind.id]: wrongKind,
        }}
        projectRevision={8}
        mutationPending={false}
        onSelectAsset={vi.fn()}
      />
    );

    const controls = screen.getAllByRole('button', {
      name: /conversation\.creativeStudio\.preview\.selectVersion/,
    });
    expect(controls).toHaveLength(1);
    expect(controls[0]).toHaveAttribute('aria-current', 'true');
    expect(controls[0].querySelector('img')).toHaveAttribute('src', 'weprompt-studio://asset/project-1/asset-1');
  });

  it('selects a canonical variation with the latest project revision', () => {
    const first = asset();
    const second = asset({ id: 'asset-2', managedAsset: { collection: 'assets', fileName: 'asset-2.png' } });
    const onSelectAsset = vi.fn();
    render(
      <AssetStrip
        projectId='project-1'
        scene={scene({ selectedAssetId: first.id, assetIds: [first.id, second.id] })}
        assets={{ [first.id]: first, [second.id]: second }}
        projectRevision={11}
        mutationPending={false}
        onSelectAsset={onSelectAsset}
      />
    );

    fireEvent.click(
      screen.getByRole('button', {
        name: 'conversation.creativeStudio.preview.selectVersion: conversation.creativeStudio.preview.versionLabel:2',
      })
    );

    expect(onSelectAsset).toHaveBeenCalledExactlyOnceWith({
      projectId: 'project-1',
      sceneId: 'scene-1',
      assetId: 'asset-2',
      expectedRevision: 11,
    });
  });

  it('renders no variation claim when canonical generated outputs are unavailable', () => {
    const imported = asset({
      id: 'import-1',
      managedAsset: { collection: 'imports', fileName: 'import-1.png' },
    });
    render(
      <AssetStrip
        projectId='project-1'
        scene={scene({ assetIds: [imported.id] })}
        assets={{ [imported.id]: imported }}
        projectRevision={3}
        mutationPending={false}
        onSelectAsset={vi.fn()}
      />
    );

    expect(screen.queryByText('conversation.creativeStudio.preview.versions')).not.toBeInTheDocument();
    expect(screen.queryByRole('button')).not.toBeInTheDocument();
  });
});

describe('SceneTimeline storyboard strip', () => {
  it('renders canonical order and duration-proportional selectable segments', () => {
    const orderedScenes = [
      scene({ id: 'scene-1', title: 'Opening', durationSeconds: 5 }),
      scene({ id: 'scene-2', title: 'Reveal', durationSeconds: 3 }),
      scene({ id: 'scene-3', title: 'Closing', durationSeconds: 7 }),
    ];
    render(<SceneTimeline orderedScenes={orderedScenes} selectedSceneId='scene-2' onSelectScene={vi.fn()} />);

    const controls = screen.getAllByRole('button', {
      name: /conversation\.creativeStudio\.timeline\.selectScene/,
    });
    expect(controls.map((control) => control.getAttribute('aria-label'))).toEqual([
      'conversation.creativeStudio.timeline.selectScene: conversation.creativeStudio.timeline.sceneLabel:1, Opening, conversation.creativeStudio.timeline.durationLabel:5',
      'conversation.creativeStudio.timeline.selectScene: conversation.creativeStudio.timeline.sceneLabel:2, Reveal, conversation.creativeStudio.timeline.durationLabel:3',
      'conversation.creativeStudio.timeline.selectScene: conversation.creativeStudio.timeline.sceneLabel:3, Closing, conversation.creativeStudio.timeline.durationLabel:7',
    ]);
    expect(controls.map((control) => control.parentElement?.style.flexGrow)).toEqual(['5', '3', '7']);
    expect(screen.getByRole('status')).toHaveTextContent(
      'conversation.creativeStudio.timeline.totalDurationconversation.creativeStudio.timeline.durationLabel:15'
    );
  });

  it('marks selection and supports adjacent keyboard selection without reordering', () => {
    const orderedScenes = [
      scene({ id: 'scene-1', title: 'Opening', durationSeconds: 5 }),
      scene({ id: 'scene-2', title: 'Reveal', durationSeconds: 3 }),
    ];
    const onSelectScene = vi.fn();
    render(<SceneTimeline orderedScenes={orderedScenes} selectedSceneId='scene-1' onSelectScene={onSelectScene} />);
    const controls = screen.getAllByRole('button', {
      name: /conversation\.creativeStudio\.timeline\.selectScene/,
    });

    expect(controls[0]).toHaveAttribute('aria-current', 'true');
    controls[0].focus();
    fireEvent.keyDown(controls[0], { key: 'ArrowRight' });
    expect(controls[1]).toHaveFocus();
    fireEvent.click(controls[1]);

    expect(onSelectScene).toHaveBeenNthCalledWith(1, 'scene-2');
    expect(onSelectScene).toHaveBeenNthCalledWith(2, 'scene-2');
  });

  it('shows the localized empty state without waveform, music, or caption claims', () => {
    const { container } = render(<SceneTimeline orderedScenes={[]} selectedSceneId={null} onSelectScene={vi.fn()} />);

    expect(screen.getByText('conversation.creativeStudio.timeline.noScenes')).toBeInTheDocument();
    expect(screen.queryByRole('button')).not.toBeInTheDocument();
    expect(container.textContent).not.toMatch(/waveform|music|caption/i);
  });
});
