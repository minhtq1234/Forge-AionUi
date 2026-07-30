/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import React from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import type {
  StudioCommandResult,
  StudioConnectionBinding,
  StudioConnectionCandidate,
} from '@/common/types/project/creativeStudioTypes';
import {
  StudioConnectionModal,
  type StudioConnectionModalProps,
} from '@renderer/pages/studio/components/Generation/StudioConnectionModal';

const bridge = vi.hoisted(() => ({
  listConnectionCandidates: { invoke: vi.fn() },
  listConnections: { invoke: vi.fn() },
  validateConnection: { invoke: vi.fn() },
  saveConnection: { invoke: vi.fn() },
  removeConnection: { invoke: vi.fn() },
}));

vi.mock('@/common', () => ({ ipcBridge: { creativeStudio: bridge } }));
vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));

const ok = <T,>(data: T): StudioCommandResult<T> => ({ ok: true, data });
const failure = <T,>(messageKey = 'conversation.creativeStudio.errors.provider'): StudioCommandResult<T> => ({
  ok: false,
  error: { code: 'provider_error', messageKey },
});

const candidate = (overrides: Partial<StudioConnectionCandidate> = {}): StudioConnectionCandidate => ({
  providerId: 'provider_safe',
  providerName: 'Safe Provider',
  models: [{ model: 'seedance-1-5-pro', health: 'available' }],
  ...overrides,
});

const binding = (overrides: Partial<StudioConnectionBinding> = {}): StudioConnectionBinding => ({
  schemaVersion: 1,
  id: 'binding_safe',
  providerId: 'provider_safe',
  adapterId: 'weprompt-media-gateway-v1',
  model: 'open-sora',
  capabilities: {
    mediaKinds: ['video'],
    audioModes: ['none'],
    aspectRatios: ['16:9'],
    resolutions: ['720p'],
    minDurationSeconds: 2,
    maxDurationSeconds: 12,
    supportsFirstFrame: true,
    cancellation: true,
  },
  validatedAt: '2026-07-30T00:00:00.000Z',
  ...overrides,
});

const createProps = (overrides: Partial<StudioConnectionModalProps> = {}): StudioConnectionModalProps => ({
  visible: true,
  refreshToken: 0,
  onCancel: vi.fn(),
  onOpenSettings: vi.fn(),
  onSaved: vi.fn(),
  onRemoved: vi.fn(),
  ...overrides,
});

const selectConnectionFields = (adapterId = 'weprompt-media-gateway-v1', model = 'open-sora-manual'): void => {
  fireEvent.click(screen.getByRole('radio', { name: 'Safe Provider' }));
  fireEvent.click(screen.getByRole('radio', { name: adapterId }));
  fireEvent.change(
    screen.getByRole('textbox', {
      name: 'conversation.creativeStudio.connection.modelLabel',
    }),
    { target: { value: model } }
  );
};

describe('StudioConnectionModal', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    bridge.listConnectionCandidates.invoke.mockResolvedValue(ok([candidate()]));
    bridge.listConnections.invoke.mockResolvedValue(ok([binding()]));
    bridge.validateConnection.invoke.mockResolvedValue(ok(binding({ id: 'validation_only' })));
    bridge.saveConnection.invoke.mockResolvedValue(ok(binding()));
    bridge.removeConnection.invoke.mockResolvedValue(ok(true));
  });

  it('renders only sanitized candidate and binding fields', async () => {
    bridge.listConnectionCandidates.invoke.mockResolvedValue(
      ok([
        {
          ...candidate(),
          apiKey: 'candidate-secret',
          baseUrl: 'https://credential.example/?token=secret',
          rawProvider: { authorization: 'Bearer secret' },
        } as StudioConnectionCandidate,
      ])
    );
    bridge.listConnections.invoke.mockResolvedValue(
      ok([
        {
          ...binding(),
          apiKey: 'binding-secret',
          signedOutputUrl: 'https://output.example/?signature=secret',
          path: '/private/provider.json',
        } as StudioConnectionBinding,
      ])
    );
    render(<StudioConnectionModal {...createProps()} />);

    expect(await screen.findByText('Safe Provider')).toBeInTheDocument();
    expect(screen.getByText('provider_safe')).toBeInTheDocument();
    expect(screen.getByText('open-sora')).toBeInTheDocument();
    expect(screen.getByText('conversation.creativeStudio.connection.silentOutputSupported')).toBeInTheDocument();
    expect(
      screen.queryByText(/candidate-secret|binding-secret|Bearer secret|signature=secret|private\/provider/)
    ).not.toBeInTheDocument();
  });

  it('exposes exactly one provider group and one adapter group without nested radiogroups', async () => {
    render(<StudioConnectionModal {...createProps()} />);

    await screen.findByText('Safe Provider');
    const providerGroup = screen.getByRole('radiogroup', {
      name: 'conversation.creativeStudio.connection.providerLabel',
    });
    const adapterGroup = screen.getByRole('radiogroup', {
      name: 'conversation.creativeStudio.connection.adapterLabel',
    });

    expect(screen.getAllByRole('radiogroup')).toHaveLength(2);
    expect(providerGroup).not.toContainElement(adapterGroup);
    expect(adapterGroup).not.toContainElement(providerGroup);
  });

  it('opens model settings when no credential row exists and refreshes candidates on return', async () => {
    bridge.listConnectionCandidates.invoke.mockResolvedValueOnce(ok([])).mockResolvedValue(ok([candidate()]));
    bridge.listConnections.invoke.mockResolvedValue(ok([]));
    const props = createProps();
    const view = render(<StudioConnectionModal {...props} />);

    expect(await screen.findByText('conversation.creativeStudio.connection.noProviders')).toBeInTheDocument();
    fireEvent.click(
      screen.getByRole('button', {
        name: 'conversation.creativeStudio.connection.openSettings',
      })
    );
    expect(props.onOpenSettings).toHaveBeenCalledExactlyOnceWith('/settings/model');
    expect(
      screen.getByRole('button', {
        name: 'conversation.creativeStudio.connection.refresh',
      })
    ).toBeInTheDocument();

    view.rerender(<StudioConnectionModal {...props} refreshToken={1} />);
    expect(await screen.findByText('Safe Provider')).toBeInTheDocument();
    expect(bridge.listConnectionCandidates.invoke).toHaveBeenCalledTimes(2);
  });

  it('requires non-chargeable validation before saving an explicit adapter and manual model', async () => {
    bridge.listConnections.invoke.mockResolvedValue(ok([]));
    const validated = binding({
      id: 'validation_only',
      adapterId: 'weprompt-media-gateway-v1',
      model: 'open-sora-manual',
    });
    const saved = binding({
      id: 'binding_manual',
      adapterId: 'weprompt-media-gateway-v1',
      model: 'open-sora-manual',
    });
    bridge.validateConnection.invoke.mockResolvedValue(ok(validated));
    bridge.saveConnection.invoke.mockResolvedValue(ok(saved));
    const props = createProps();
    render(<StudioConnectionModal {...props} />);
    await screen.findByText('Safe Provider');

    selectConnectionFields();
    const save = screen.getByRole('button', {
      name: 'conversation.creativeStudio.connection.save',
    });
    expect(save).toBeDisabled();
    fireEvent.click(
      screen.getByRole('button', {
        name: 'conversation.creativeStudio.connection.validate',
      })
    );

    const safeRequest = {
      providerId: 'provider_safe',
      adapterId: 'weprompt-media-gateway-v1',
      model: 'open-sora-manual',
    };
    await waitFor(() => expect(bridge.validateConnection.invoke).toHaveBeenCalledExactlyOnceWith(safeRequest));
    expect(await screen.findByText('conversation.creativeStudio.connection.validationSuccess')).toBeInTheDocument();
    expect(save).toBeEnabled();

    fireEvent.click(save);
    await waitFor(() => expect(bridge.saveConnection.invoke).toHaveBeenCalledExactlyOnceWith(safeRequest));
    expect(props.onSaved).toHaveBeenCalledExactlyOnceWith(saved);
  });

  it('keeps Save blocked after validation failure or a gateway result without silent-output capability', async () => {
    bridge.listConnections.invoke.mockResolvedValue(ok([]));
    bridge.validateConnection.invoke.mockResolvedValueOnce(failure()).mockResolvedValueOnce(
      ok(
        binding({
          id: 'validation_only',
          adapterId: 'weprompt-media-gateway-v1',
          model: 'open-sora-manual',
          capabilities: { mediaKinds: ['video'], audioModes: ['speech'] },
        })
      )
    );
    render(<StudioConnectionModal {...createProps()} />);
    await screen.findByText('Safe Provider');
    selectConnectionFields();

    const validate = screen.getByRole('button', {
      name: 'conversation.creativeStudio.connection.validate',
    });
    const save = screen.getByRole('button', {
      name: 'conversation.creativeStudio.connection.save',
    });
    fireEvent.click(validate);
    expect(await screen.findByText('conversation.creativeStudio.connection.validationFailed')).toBeInTheDocument();
    expect(save).toBeDisabled();

    fireEvent.click(validate);
    await waitFor(() => expect(bridge.validateConnection.invoke).toHaveBeenCalledTimes(2));
    expect(screen.getByText('conversation.creativeStudio.connection.validationFailed')).toBeInTheDocument();
    expect(screen.queryByText('conversation.creativeStudio.connection.silentOutputSupported')).not.toBeInTheDocument();
    expect(save).toBeDisabled();
  });

  it('removes a saved binding with only its safe ID', async () => {
    const props = createProps();
    render(<StudioConnectionModal {...props} />);

    const row = await screen.findByRole('listitem', { name: 'binding_safe' });
    fireEvent.click(
      within(row).getByRole('button', {
        name: 'conversation.creativeStudio.connection.remove',
      })
    );

    await waitFor(() =>
      expect(bridge.removeConnection.invoke).toHaveBeenCalledExactlyOnceWith({
        connectionId: 'binding_safe',
      })
    );
    expect(props.onRemoved).toHaveBeenCalledExactlyOnceWith('binding_safe');
  });
});
