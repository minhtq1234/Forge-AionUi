/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import { fireEvent, render, screen } from '@testing-library/react';
import React from 'react';
import { describe, expect, it, vi } from 'vitest';

import type { StudioEditableScene, StudioScene } from '@/common/types/project/creativeStudioTypes';
import { SceneInspector, type SceneInspectorProps } from '@renderer/pages/studio/components/Storyboard/SceneInspector';

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));

const selectedScene: StudioScene = {
  id: 'scene-1',
  title: 'Rooftop opening',
  purpose: 'Establish the city',
  visualPrompt: 'A quiet rooftop at blue hour',
  narration: 'Every launch starts with a view.',
  onScreenText: 'A new perspective',
  mediaKind: 'video',
  durationSeconds: 7,
  referenceAssetId: null,
  selectedAssetId: null,
  assetIds: [],
  jobIds: [],
  reviewState: 'draft',
};

const sceneDraft: StudioEditableScene = {
  title: selectedScene.title,
  purpose: selectedScene.purpose,
  visualPrompt: selectedScene.visualPrompt,
  narration: selectedScene.narration,
  onScreenText: selectedScene.onScreenText,
  mediaKind: selectedScene.mediaKind,
  durationSeconds: selectedScene.durationSeconds,
  referenceAssetId: selectedScene.referenceAssetId,
};

const createProps = (overrides: Partial<SceneInspectorProps> = {}): SceneInspectorProps => ({
  selectedScene,
  sceneDraft,
  mutationPending: false,
  errorMessageKey: null,
  statusMessageKey: null,
  conflict: false,
  onUpdateSceneDraft: vi.fn(),
  onFlushSceneDraft: vi.fn(),
  onRetryConflict: vi.fn(),
  onDiscardConflict: vi.fn(),
  ...overrides,
});

describe('SceneInspector', () => {
  it('hydrates every controlled direction and script field', () => {
    const props = createProps();
    render(<SceneInspector {...props} />);

    expect(
      screen.getByRole('region', {
        name: 'conversation.creativeStudio.inspector.sectionsLabel',
      })
    ).toBeInTheDocument();
    expect(screen.getByLabelText('conversation.creativeStudio.inspector.titleLabel')).toHaveValue('Rooftop opening');
    expect(screen.getByLabelText('conversation.creativeStudio.inspector.purposeLabel')).toHaveValue(
      'Establish the city'
    );
    expect(screen.getByLabelText('conversation.creativeStudio.inspector.visualPromptLabel')).toHaveValue(
      'A quiet rooftop at blue hour'
    );
    expect(
      screen.getByRole('combobox', {
        name: 'conversation.creativeStudio.inspector.mediaKindLabel',
      })
    ).toBeInTheDocument();
    expect(
      screen.getByRole('spinbutton', {
        name: 'conversation.creativeStudio.inspector.durationLabel',
      })
    ).toHaveValue('7');

    fireEvent.click(screen.getByText('conversation.creativeStudio.inspector.scriptTab'));
    expect(screen.getByLabelText('conversation.creativeStudio.inspector.narrationLabel')).toHaveValue(
      'Every launch starts with a view.'
    );
    expect(screen.getByLabelText('conversation.creativeStudio.inspector.onScreenTextLabel')).toHaveValue(
      'A new perspective'
    );
  });

  it('reports controlled field edits and flushes the draft on blur', () => {
    const props = createProps();
    render(<SceneInspector {...props} />);

    const title = screen.getByLabelText('conversation.creativeStudio.inspector.titleLabel');
    fireEvent.change(title, { target: { value: 'New opening' } });
    expect(props.onUpdateSceneDraft).toHaveBeenCalledExactlyOnceWith({
      title: 'New opening',
    });
    fireEvent.blur(title);
    expect(props.onFlushSceneDraft).toHaveBeenCalledTimes(1);

    fireEvent.click(screen.getByText('conversation.creativeStudio.inspector.scriptTab'));
    const narration = screen.getByLabelText('conversation.creativeStudio.inspector.narrationLabel');
    fireEvent.change(narration, { target: { value: 'A revised line.' } });
    expect(props.onUpdateSceneDraft).toHaveBeenLastCalledWith({
      narration: 'A revised line.',
    });
  });

  it.each(['0', '61', '6.5'])(
    'rejects invalid integer duration %s without replacing the controlled draft',
    (invalidDuration) => {
      const props = createProps();
      render(<SceneInspector {...props} />);

      fireEvent.change(
        screen.getByRole('spinbutton', {
          name: 'conversation.creativeStudio.inspector.durationLabel',
        }),
        { target: { value: invalidDuration } }
      );

      expect(props.onUpdateSceneDraft).not.toHaveBeenCalled();
      expect(screen.getByRole('alert')).toHaveTextContent('conversation.creativeStudio.inspector.invalidDuration');
    }
  );

  it('accepts a valid duration as a number', () => {
    const props = createProps();
    render(<SceneInspector {...props} />);

    const duration = screen.getByRole('spinbutton', {
      name: 'conversation.creativeStudio.inspector.durationLabel',
    });
    fireEvent.change(duration, { target: { value: '12' } });
    expect(props.onUpdateSceneDraft).toHaveBeenCalledExactlyOnceWith({
      durationSeconds: 12,
    });
  });

  it('clears a local duration error after a new canonical draft is adopted', () => {
    const props = createProps();
    const view = render(<SceneInspector {...props} />);
    fireEvent.change(
      screen.getByRole('spinbutton', {
        name: 'conversation.creativeStudio.inspector.durationLabel',
      }),
      { target: { value: '0' } }
    );
    expect(screen.getByText('conversation.creativeStudio.inspector.invalidDuration')).toBeInTheDocument();

    view.rerender(
      <SceneInspector
        {...props}
        sceneDraft={{
          ...sceneDraft,
          durationSeconds: 9,
        }}
      />
    );
    expect(screen.queryByText('conversation.creativeStudio.inspector.invalidDuration')).not.toBeInTheDocument();
  });

  it('keeps errors and conflict recovery actions visible without dropping the draft', () => {
    const props = createProps({
      conflict: true,
      errorMessageKey: 'conversation.creativeStudio.errors.staleProject',
      statusMessageKey: 'conversation.creativeStudio.inspector.unsavedChanges',
    });
    render(<SceneInspector {...props} />);

    expect(screen.getByRole('alert')).toHaveTextContent('conversation.creativeStudio.errors.staleProject');
    expect(screen.getByRole('status')).toHaveTextContent('conversation.creativeStudio.inspector.unsavedChanges');
    expect(screen.getByLabelText('conversation.creativeStudio.inspector.titleLabel')).toHaveValue('Rooftop opening');

    fireEvent.click(screen.getByRole('button', { name: 'conversation.creativeStudio.storyboard.retry' }));
    fireEvent.click(screen.getByRole('button', { name: 'conversation.creativeStudio.storyboard.discard' }));
    expect(props.onRetryConflict).toHaveBeenCalledTimes(1);
    expect(props.onDiscardConflict).toHaveBeenCalledTimes(1);
  });

  it('renders a localized empty state instead of editable controls without a selected scene', () => {
    render(
      <SceneInspector
        {...createProps({
          selectedScene: null,
          sceneDraft: null,
        })}
      />
    );

    expect(screen.getByText('conversation.creativeStudio.storyboard.noScenes')).toBeInTheDocument();
    expect(screen.queryByLabelText('conversation.creativeStudio.inspector.titleLabel')).not.toBeInTheDocument();
  });
});
