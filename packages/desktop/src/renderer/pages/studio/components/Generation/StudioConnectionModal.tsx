/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import { ipcBridge } from '@/common';
import type {
  StudioConnectionBinding,
  StudioConnectionCandidate,
  StudioConnectionCapabilities,
  StudioProviderAdapterId,
  StudioSaveConnectionRequest,
} from '@/common/types/project/creativeStudioTypes';
import { Alert, AutoComplete, Button, Modal, Radio, Spin, Tag } from '@arco-design/web-react';
import { Refresh } from '@icon-park/react';
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';

type ActionResult = void | Promise<unknown>;

const ADAPTERS: readonly StudioProviderAdapterId[] = [
  'weprompt-image-v1',
  'byteplus-seedance-v1',
  'weprompt-media-gateway-v1',
];

export type StudioConnectionModalProps = {
  visible: boolean;
  /** Increment after returning from model settings to force a fresh credential query. */
  refreshToken?: number;
  onCancel: () => void;
  onOpenSettings: (path: '/settings/model') => void;
  onSaved: (binding: StudioConnectionBinding) => ActionResult;
  onRemoved: (connectionId: string) => ActionResult;
};

const sanitizeCapabilities = (capabilities: StudioConnectionCapabilities): StudioConnectionCapabilities => ({
  mediaKinds: [...capabilities.mediaKinds],
  ...(capabilities.audioModes ? { audioModes: [...capabilities.audioModes] } : {}),
  ...(capabilities.aspectRatios ? { aspectRatios: [...capabilities.aspectRatios] } : {}),
  ...(capabilities.resolutions ? { resolutions: [...capabilities.resolutions] } : {}),
  ...(capabilities.minDurationSeconds === undefined ? {} : { minDurationSeconds: capabilities.minDurationSeconds }),
  ...(capabilities.maxDurationSeconds === undefined ? {} : { maxDurationSeconds: capabilities.maxDurationSeconds }),
  ...(capabilities.supportsFirstFrame === undefined ? {} : { supportsFirstFrame: capabilities.supportsFirstFrame }),
  ...(capabilities.cancellation === undefined ? {} : { cancellation: capabilities.cancellation }),
});

const sanitizeCandidate = (candidate: StudioConnectionCandidate): StudioConnectionCandidate => ({
  providerId: candidate.providerId,
  providerName: candidate.providerName,
  models: candidate.models.map(({ model, health }) => ({ model, health })),
});

const sanitizeBinding = (binding: StudioConnectionBinding): StudioConnectionBinding => ({
  schemaVersion: 1,
  id: binding.id,
  providerId: binding.providerId,
  adapterId: binding.adapterId,
  model: binding.model,
  capabilities: sanitizeCapabilities(binding.capabilities),
  validatedAt: binding.validatedAt,
});

const gatewaySupportsSilentOutput = (binding: StudioConnectionBinding): boolean =>
  binding.adapterId !== 'weprompt-media-gateway-v1' || binding.capabilities.audioModes?.includes('none') === true;

const ConnectionCapabilities: React.FC<{ capabilities: StudioConnectionCapabilities }> = ({ capabilities }) => {
  const { t } = useTranslation();
  const silentOutput = capabilities.audioModes?.includes('none') === true;

  return (
    <div className='flex flex-col gap-6px'>
      <span className='text-11px text-t-tertiary'>{t('conversation.creativeStudio.connection.capabilitiesLabel')}</span>
      <div className='flex flex-wrap gap-6px'>
        {capabilities.mediaKinds.map((kind) => (
          <Tag key={kind}>
            {t(
              kind === 'image' ? 'conversation.creativeStudio.scene.image' : 'conversation.creativeStudio.scene.video'
            )}
          </Tag>
        ))}
        {silentOutput && <Tag color='green'>{t('conversation.creativeStudio.connection.silentOutputSupported')}</Tag>}
      </div>
    </div>
  );
};

/**
 * Binds existing credential rows to explicit Studio adapters and media models.
 *
 * Credentials never enter this component. Validation and save payloads contain
 * only provider ID, adapter ID, and model; returned DTOs are narrowed again
 * before they are rendered or reported to the parent.
 */
export const StudioConnectionModal: React.FC<StudioConnectionModalProps> = ({
  visible,
  refreshToken = 0,
  onCancel,
  onOpenSettings,
  onSaved,
  onRemoved,
}) => {
  const { t } = useTranslation();
  const [candidates, setCandidates] = useState<StudioConnectionCandidate[]>([]);
  const [connections, setConnections] = useState<StudioConnectionBinding[]>([]);
  const [selectedProviderId, setSelectedProviderId] = useState('');
  const [adapterId, setAdapterId] = useState<StudioProviderAdapterId | null>(null);
  const [model, setModel] = useState('');
  const [validated, setValidated] = useState<StudioConnectionBinding | null>(null);
  const [loading, setLoading] = useState(false);
  const [validating, setValidating] = useState(false);
  const [saving, setSaving] = useState(false);
  const [removingIds, setRemovingIds] = useState<readonly string[]>([]);
  const [listErrorMessageKey, setListErrorMessageKey] = useState<string | null>(null);
  const [validationErrorMessageKey, setValidationErrorMessageKey] = useState<string | null>(null);
  const [mutationErrorMessageKey, setMutationErrorMessageKey] = useState<string | null>(null);
  const requestRef = useRef(0);

  const refresh = useCallback(async (): Promise<void> => {
    const request = ++requestRef.current;
    setLoading(true);
    setListErrorMessageKey(null);
    try {
      const [candidateResult, connectionResult] = await Promise.all([
        ipcBridge.creativeStudio.listConnectionCandidates.invoke(),
        ipcBridge.creativeStudio.listConnections.invoke(),
      ]);
      if (requestRef.current !== request) return;
      if (candidateResult.ok === false) {
        setListErrorMessageKey(candidateResult.error.messageKey);
        return;
      }
      if (connectionResult.ok === false) {
        setListErrorMessageKey(connectionResult.error.messageKey);
        return;
      }
      setCandidates(candidateResult.data.map(sanitizeCandidate));
      setConnections(connectionResult.data.map(sanitizeBinding));
    } catch {
      if (requestRef.current === request) {
        setListErrorMessageKey('conversation.creativeStudio.errors.provider');
      }
    } finally {
      if (requestRef.current === request) setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (!visible) return;
    void refresh();
    return () => {
      requestRef.current += 1;
    };
  }, [refresh, refreshToken, visible]);

  const selectedCandidate = candidates.find((candidate) => candidate.providerId === selectedProviderId) ?? null;
  const modelOptions = useMemo(
    () => selectedCandidate?.models.map(({ model: value }) => value) ?? [],
    [selectedCandidate]
  );
  const request = useMemo<StudioSaveConnectionRequest | null>(() => {
    const normalizedModel = model.trim();
    if (!selectedProviderId || !adapterId || !normalizedModel) return null;
    return {
      providerId: selectedProviderId,
      adapterId,
      model: normalizedModel,
    };
  }, [adapterId, model, selectedProviderId]);
  const validationMatchesRequest =
    request !== null &&
    validated !== null &&
    validated.providerId === request.providerId &&
    validated.adapterId === request.adapterId &&
    validated.model === request.model &&
    gatewaySupportsSilentOutput(validated);

  const resetValidation = (): void => {
    setValidated(null);
    setValidationErrorMessageKey(null);
    setMutationErrorMessageKey(null);
  };

  const selectProvider = (providerId: string): void => {
    setSelectedProviderId(providerId);
    setModel('');
    resetValidation();
  };

  const selectAdapter = (nextAdapter: StudioProviderAdapterId): void => {
    setAdapterId(nextAdapter);
    resetValidation();
  };

  const updateModel = (nextModel: string): void => {
    setModel(nextModel);
    resetValidation();
  };

  const validate = async (): Promise<void> => {
    if (!request || validating || saving) return;
    setValidating(true);
    setValidated(null);
    setValidationErrorMessageKey(null);
    setMutationErrorMessageKey(null);
    try {
      const result = await ipcBridge.creativeStudio.validateConnection.invoke(request);
      if (result.ok === false) {
        setValidationErrorMessageKey(result.error.messageKey);
        return;
      }
      const safeBinding = sanitizeBinding(result.data);
      if (
        safeBinding.providerId !== request.providerId ||
        safeBinding.adapterId !== request.adapterId ||
        safeBinding.model !== request.model ||
        !gatewaySupportsSilentOutput(safeBinding)
      ) {
        setValidationErrorMessageKey('conversation.creativeStudio.connection.validationFailed');
        return;
      }
      setValidated(safeBinding);
    } catch {
      setValidationErrorMessageKey('conversation.creativeStudio.errors.provider');
    } finally {
      setValidating(false);
    }
  };

  const save = async (): Promise<void> => {
    if (!request || !validationMatchesRequest || saving || validating) return;
    setSaving(true);
    setMutationErrorMessageKey(null);
    try {
      const result = await ipcBridge.creativeStudio.saveConnection.invoke(request);
      if (result.ok === false) {
        setMutationErrorMessageKey(result.error.messageKey);
        return;
      }
      const safeBinding = sanitizeBinding(result.data);
      if (
        safeBinding.providerId !== request.providerId ||
        safeBinding.adapterId !== request.adapterId ||
        safeBinding.model !== request.model ||
        !gatewaySupportsSilentOutput(safeBinding)
      ) {
        setMutationErrorMessageKey('conversation.creativeStudio.connection.validationFailed');
        return;
      }
      setConnections((current) => [...current.filter((item) => item.id !== safeBinding.id), safeBinding]);
      void onSaved(safeBinding);
      setValidated(null);
    } catch {
      setMutationErrorMessageKey('conversation.creativeStudio.errors.provider');
    } finally {
      setSaving(false);
    }
  };

  const remove = async (connectionId: string): Promise<void> => {
    if (removingIds.includes(connectionId)) return;
    setRemovingIds((current) => [...current, connectionId]);
    setMutationErrorMessageKey(null);
    try {
      const result = await ipcBridge.creativeStudio.removeConnection.invoke({ connectionId });
      if (result.ok === false) {
        setMutationErrorMessageKey(result.error.messageKey);
        return;
      }
      if (result.data) {
        setConnections((current) => current.filter((item) => item.id !== connectionId));
        void onRemoved(connectionId);
      }
    } catch {
      setMutationErrorMessageKey('conversation.creativeStudio.errors.storage');
    } finally {
      setRemovingIds((current) => current.filter((id) => id !== connectionId));
    }
  };

  const busy = validating || saving || removingIds.length > 0;
  const footer = (
    <div className='flex flex-wrap justify-end gap-8px'>
      <Button disabled={busy} onClick={onCancel}>
        {t('conversation.creativeStudio.connection.cancel')}
      </Button>
      <Button type='primary' loading={saving} disabled={!validationMatchesRequest || busy} onClick={() => void save()}>
        {t('conversation.creativeStudio.connection.save')}
      </Button>
    </div>
  );

  return (
    <Modal
      visible={visible}
      title={t('conversation.creativeStudio.connection.title')}
      footer={footer}
      closable={!busy}
      maskClosable={!busy}
      escToExit={!busy}
      unmountOnExit
      onCancel={onCancel}
    >
      <div className='flex flex-col gap-14px'>
        <p className='m-0 text-13px text-t-secondary'>{t('conversation.creativeStudio.connection.subtitle')}</p>

        {loading && candidates.length === 0 && connections.length === 0 ? (
          <div className='flex min-h-80px items-center justify-center'>
            <Spin />
          </div>
        ) : (
          <>
            {listErrorMessageKey && <Alert type='error' content={t(listErrorMessageKey)} />}

            {connections.length > 0 && (
              <ul
                aria-label={t('conversation.creativeStudio.connection.title')}
                className='m-0 flex list-none flex-col gap-8px p-0'
              >
                {connections.map((connection) => (
                  <li
                    key={connection.id}
                    aria-label={connection.id}
                    className='rounded-8px border border-border-2 bg-fill-1 p-10px'
                  >
                    <div className='flex items-start justify-between gap-10px'>
                      <dl className='m-0 min-w-0 flex-1 grid grid-cols-[max-content_minmax(0,1fr)] gap-x-10px gap-y-4px'>
                        <dt className='text-11px text-t-tertiary'>
                          {t('conversation.creativeStudio.connection.providerLabel')}
                        </dt>
                        <dd className='m-0 break-all text-12px text-t-primary'>{connection.providerId}</dd>
                        <dt className='text-11px text-t-tertiary'>
                          {t('conversation.creativeStudio.connection.adapterLabel')}
                        </dt>
                        <dd className='m-0 break-all text-12px text-t-primary'>{connection.adapterId}</dd>
                        <dt className='text-11px text-t-tertiary'>
                          {t('conversation.creativeStudio.connection.modelLabel')}
                        </dt>
                        <dd className='m-0 break-all text-12px text-t-primary'>{connection.model}</dd>
                      </dl>
                      <Button
                        size='mini'
                        status='danger'
                        loading={removingIds.includes(connection.id)}
                        disabled={busy && !removingIds.includes(connection.id)}
                        onClick={() => void remove(connection.id)}
                      >
                        {t('conversation.creativeStudio.connection.remove')}
                      </Button>
                    </div>
                    <div className='mt-8px'>
                      <ConnectionCapabilities capabilities={connection.capabilities} />
                    </div>
                  </li>
                ))}
              </ul>
            )}

            {candidates.length === 0 ? (
              <div className='flex flex-col gap-10px'>
                <Alert type='warning' content={t('conversation.creativeStudio.connection.noProviders')} />
                <div className='flex flex-wrap gap-8px'>
                  <Button type='primary' disabled={busy} onClick={() => onOpenSettings('/settings/model')}>
                    {t('conversation.creativeStudio.connection.openSettings')}
                  </Button>
                  <Button
                    disabled={busy}
                    icon={
                      <span aria-hidden='true'>
                        <Refresh />
                      </span>
                    }
                    onClick={() => void refresh()}
                  >
                    {t('conversation.creativeStudio.connection.refresh')}
                  </Button>
                </div>
              </div>
            ) : (
              <div className='flex flex-col gap-12px'>
                <div>
                  <div className='mb-6px text-12px font-500 text-t-secondary'>
                    {t('conversation.creativeStudio.connection.providerLabel')}
                  </div>
                  <Radio.Group
                    aria-label={t('conversation.creativeStudio.connection.providerLabel')}
                    value={selectedProviderId || undefined}
                    direction='vertical'
                    onChange={(value) => selectProvider(String(value))}
                  >
                    {candidates.map((candidate) => (
                      <Radio
                        key={candidate.providerId}
                        value={candidate.providerId}
                        aria-label={candidate.providerName}
                      >
                        <span className='text-12px text-t-primary'>{candidate.providerName}</span>
                      </Radio>
                    ))}
                  </Radio.Group>
                </div>

                <div>
                  <div className='mb-6px text-12px font-500 text-t-secondary'>
                    {t('conversation.creativeStudio.connection.adapterLabel')}
                  </div>
                  <Radio.Group
                    aria-label={t('conversation.creativeStudio.connection.adapterLabel')}
                    value={adapterId ?? undefined}
                    direction='vertical'
                    onChange={(value) => selectAdapter(value as StudioProviderAdapterId)}
                  >
                    {ADAPTERS.map((adapter) => (
                      <Radio key={adapter} value={adapter} aria-label={adapter}>
                        <span className='text-12px text-t-primary'>{adapter}</span>
                      </Radio>
                    ))}
                  </Radio.Group>
                </div>

                <div>
                  <div className='mb-6px text-12px font-500 text-t-secondary'>
                    {t('conversation.creativeStudio.connection.modelLabel')}
                  </div>
                  <AutoComplete
                    value={model}
                    data={modelOptions}
                    disabled={!selectedProviderId}
                    placeholder={t('conversation.creativeStudio.connection.modelPlaceholder')}
                    inputProps={{
                      'aria-label': t('conversation.creativeStudio.connection.modelLabel'),
                    }}
                    onChange={updateModel}
                  />
                  {modelOptions.length > 0 && (
                    <div className='mt-6px flex flex-wrap gap-6px'>
                      {modelOptions.map((option) => (
                        <Button key={option} size='mini' disabled={busy} onClick={() => updateModel(option)}>
                          {option}
                        </Button>
                      ))}
                    </div>
                  )}
                </div>

                <Button long loading={validating} disabled={request === null || busy} onClick={() => void validate()}>
                  {t(
                    validating
                      ? 'conversation.creativeStudio.connection.validating'
                      : 'conversation.creativeStudio.connection.validate'
                  )}
                </Button>

                {validated && validationMatchesRequest && (
                  <div className='flex flex-col gap-8px'>
                    <Alert type='success' content={t('conversation.creativeStudio.connection.validationSuccess')} />
                    <ConnectionCapabilities capabilities={validated.capabilities} />
                  </div>
                )}
                {validationErrorMessageKey && (
                  <div role='alert' className='rounded-8px border border-danger-3 bg-danger-light-1 p-10px text-danger'>
                    <p className='m-0 text-12px font-500'>
                      {t('conversation.creativeStudio.connection.validationFailed')}
                    </p>
                    {validationErrorMessageKey !== 'conversation.creativeStudio.connection.validationFailed' && (
                      <p className='mb-0 mt-4px text-11px'>{t(validationErrorMessageKey)}</p>
                    )}
                  </div>
                )}
              </div>
            )}
          </>
        )}

        {mutationErrorMessageKey && (
          <div role='alert' className='rounded-8px border border-danger-3 bg-danger-light-1 p-10px text-danger'>
            {t(mutationErrorMessageKey)}
          </div>
        )}
      </div>
    </Modal>
  );
};
