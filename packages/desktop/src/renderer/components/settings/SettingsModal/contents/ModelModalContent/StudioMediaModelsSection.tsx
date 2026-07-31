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
  StudioMediaKind,
  StudioProviderAdapterId,
  StudioSaveConnectionRequest,
} from '@/common/types/project/creativeStudioTypes';
import { Alert, AutoComplete, Button, Modal, Popconfirm, Select, Spin, Tag } from '@arco-design/web-react';
import { Plus, Refresh } from '@icon-park/react';
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';

const MEDIA_INTEGRATIONS = [
  { kind: 'image', adapterId: 'weprompt-image-v1', labelKey: 'settings.mediaModels.integration.imageApi' },
  {
    kind: 'video',
    adapterId: 'byteplus-seedance-v1',
    labelKey: 'settings.mediaModels.integration.bytePlusSeedance',
  },
  {
    kind: 'video',
    adapterId: 'weprompt-media-gateway-v1',
    labelKey: 'settings.mediaModels.integration.selfHostedVideoGateway',
  },
] as const;

type MediaIntegration = (typeof MEDIA_INTEGRATIONS)[number];
type SafeCandidate = Pick<StudioConnectionCandidate, 'providerId' | 'providerName' | 'models'>;
type SafeBinding = Pick<
  StudioConnectionBinding,
  'schemaVersion' | 'id' | 'providerId' | 'adapterId' | 'model' | 'capabilities' | 'validatedAt'
>;
type EditorState = {
  visible: boolean;
  original: SafeBinding | null;
  kind: StudioMediaKind;
  providerId: string;
  adapterId: StudioProviderAdapterId;
  model: string;
};

export type StudioMediaModelsSectionProps = {
  providerRefreshToken: number;
  onAddProvider: () => void;
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

const sanitizeCandidate = (candidate: StudioConnectionCandidate): SafeCandidate => ({
  providerId: candidate.providerId,
  providerName: candidate.providerName,
  models: candidate.models.map(({ model, health }) => ({ model, health })),
});

const sanitizeBinding = (binding: StudioConnectionBinding): SafeBinding => ({
  schemaVersion: 1,
  id: binding.id,
  providerId: binding.providerId,
  adapterId: binding.adapterId,
  model: binding.model,
  capabilities: sanitizeCapabilities(binding.capabilities),
  validatedAt: binding.validatedAt,
});

const integrationFor = (adapterId: StudioProviderAdapterId): MediaIntegration | undefined =>
  MEDIA_INTEGRATIONS.find((integration) => integration.adapterId === adapterId);

const integrationForLabel = (labelKey: string): MediaIntegration | undefined =>
  MEDIA_INTEGRATIONS.find((integration) => integration.labelKey === labelKey);

const supportsSilentGatewayOutput = (binding: SafeBinding): boolean =>
  binding.adapterId !== 'weprompt-media-gateway-v1' || binding.capabilities.audioModes?.includes('none') === true;

const tupleMatches = (binding: SafeBinding, request: StudioSaveConnectionRequest): boolean =>
  binding.providerId === request.providerId &&
  binding.adapterId === request.adapterId &&
  binding.model === request.model &&
  supportsSilentGatewayOutput(binding);

const sameTuple = (left: SafeBinding, right: StudioSaveConnectionRequest): boolean =>
  left.providerId === right.providerId && left.adapterId === right.adapterId && left.model === right.model;

const replaceCanonicalBinding = (current: SafeBinding[], saved: SafeBinding): SafeBinding[] => [
  ...current.filter((item) => item.id !== saved.id && !sameTuple(item, saved)),
  saved,
];

const emptyEditor = (): EditorState => ({
  visible: false,
  original: null,
  kind: 'image',
  providerId: '',
  adapterId: 'weprompt-image-v1',
  model: '',
});

export const StudioMediaModelsSection: React.FC<StudioMediaModelsSectionProps> = ({
  providerRefreshToken,
  onAddProvider,
}) => {
  const { t } = useTranslation();
  const [candidates, setCandidates] = useState<SafeCandidate[]>([]);
  const [bindings, setBindings] = useState<SafeBinding[]>([]);
  const [editor, setEditor] = useState<EditorState>(emptyEditor);
  const [validated, setValidated] = useState<SafeBinding | null>(null);
  const [loading, setLoading] = useState(true);
  const [validating, setValidating] = useState(false);
  const [saving, setSaving] = useState(false);
  const [busyConnectionIds, setBusyConnectionIds] = useState<readonly string[]>([]);
  const [listFailed, setListFailed] = useState(false);
  const [mutationFailed, setMutationFailed] = useState(false);
  const [validationFailed, setValidationFailed] = useState(false);
  const requestSequence = useRef(0);

  const refresh = useCallback(async (): Promise<void> => {
    const sequence = ++requestSequence.current;
    setLoading(true);
    setListFailed(false);
    try {
      const [candidateResult, bindingResult] = await Promise.all([
        ipcBridge.creativeStudio.listConnectionCandidates.invoke(),
        ipcBridge.creativeStudio.listConnections.invoke(),
      ]);
      if (sequence !== requestSequence.current) return;
      if (candidateResult.ok === false || bindingResult.ok === false) {
        setListFailed(true);
        return;
      }
      setCandidates(candidateResult.data.map(sanitizeCandidate));
      setBindings(bindingResult.data.map(sanitizeBinding));
    } catch {
      if (sequence === requestSequence.current) setListFailed(true);
    } finally {
      if (sequence === requestSequence.current) setLoading(false);
    }
  }, []);

  useEffect(() => {
    void refresh();
    return () => {
      requestSequence.current += 1;
    };
  }, [providerRefreshToken, refresh]);

  const integrations = useMemo(
    () => MEDIA_INTEGRATIONS.filter((integration) => integration.kind === editor.kind),
    [editor.kind]
  );
  const selectedCandidate = candidates.find((candidate) => candidate.providerId === editor.providerId) ?? null;
  const modelOptions = selectedCandidate?.models.map(({ model }) => model) ?? [];
  const request = useMemo<StudioSaveConnectionRequest | null>(() => {
    const normalizedModel = editor.model.trim();
    if (!editor.providerId || !editor.adapterId || !normalizedModel) return null;
    return {
      providerId: editor.providerId,
      adapterId: editor.adapterId,
      model: normalizedModel,
    };
  }, [editor.adapterId, editor.model, editor.providerId]);
  const validationMatchesRequest = request !== null && validated !== null && tupleMatches(validated, request);
  const busy = validating || saving;

  const resetValidation = (): void => {
    setValidated(null);
    setValidationFailed(false);
    setMutationFailed(false);
  };

  const openAdd = (): void => {
    setEditor({ ...emptyEditor(), visible: true });
    resetValidation();
  };

  const openEdit = (binding: SafeBinding): void => {
    const integration = integrationFor(binding.adapterId);
    setEditor({
      visible: true,
      original: binding,
      kind: integration?.kind ?? 'image',
      providerId: binding.providerId,
      adapterId: binding.adapterId,
      model: binding.model,
    });
    resetValidation();
  };

  const closeEditor = (): void => {
    if (busy) return;
    setEditor(emptyEditor());
    resetValidation();
  };

  const updateKind = (kind: StudioMediaKind): void => {
    const firstIntegration = MEDIA_INTEGRATIONS.find((integration) => integration.kind === kind);
    if (!firstIntegration) return;
    setEditor((current) => ({ ...current, kind, adapterId: firstIntegration.adapterId }));
    resetValidation();
  };

  const updateProvider = (providerId: string): void => {
    setEditor((current) => ({ ...current, providerId }));
    resetValidation();
  };

  const updateAdapter = (adapterId: StudioProviderAdapterId): void => {
    setEditor((current) => ({ ...current, adapterId }));
    resetValidation();
  };

  const updateModel = (model: string): void => {
    setEditor((current) => ({ ...current, model }));
    resetValidation();
  };

  const validateRequest = async (safeRequest: StudioSaveConnectionRequest): Promise<SafeBinding | null> => {
    try {
      const result = await ipcBridge.creativeStudio.validateConnection.invoke(safeRequest);
      if (result.ok === false) return null;
      const safeBinding = sanitizeBinding(result.data);
      return tupleMatches(safeBinding, safeRequest) ? safeBinding : null;
    } catch {
      return null;
    }
  };

  const validateEditor = async (): Promise<void> => {
    if (!request || busy) return;
    setValidating(true);
    setValidated(null);
    setValidationFailed(false);
    setMutationFailed(false);
    const safeBinding = await validateRequest(request);
    setValidated(safeBinding);
    setValidationFailed(safeBinding === null);
    setValidating(false);
  };

  const saveRequest = async (safeRequest: StudioSaveConnectionRequest): Promise<SafeBinding | null> => {
    try {
      const result = await ipcBridge.creativeStudio.saveConnection.invoke(safeRequest);
      if (result.ok === false) return null;
      const safeBinding = sanitizeBinding(result.data);
      return tupleMatches(safeBinding, safeRequest) ? safeBinding : null;
    } catch {
      return null;
    }
  };

  const saveEditor = async (): Promise<void> => {
    if (!request || !validationMatchesRequest || busy) return;
    setSaving(true);
    setMutationFailed(false);
    const saved = await saveRequest(request);
    if (!saved) {
      setMutationFailed(true);
      await refresh();
      setSaving(false);
      return;
    }

    const original = editor.original;
    setBindings((current) => replaceCanonicalBinding(current, saved));
    if (original && !sameTuple(original, request)) {
      try {
        const removeResult = await ipcBridge.creativeStudio.removeConnection.invoke({
          connectionId: original.id,
        });
        if (removeResult.ok === false || !removeResult.data) {
          setMutationFailed(true);
          await refresh();
          setSaving(false);
          setEditor(emptyEditor());
          setValidated(null);
          return;
        }
        setBindings((current) => current.filter((item) => item.id !== original.id));
      } catch {
        setMutationFailed(true);
        await refresh();
        setSaving(false);
        setEditor(emptyEditor());
        setValidated(null);
        return;
      }
    }
    setSaving(false);
    setEditor(emptyEditor());
    setValidated(null);
  };

  const revalidate = async (binding: SafeBinding): Promise<void> => {
    if (busyConnectionIds.includes(binding.id)) return;
    setBusyConnectionIds((current) => [...current, binding.id]);
    setMutationFailed(false);
    const safeRequest: StudioSaveConnectionRequest = {
      providerId: binding.providerId,
      adapterId: binding.adapterId,
      model: binding.model,
    };
    const validation = await validateRequest(safeRequest);
    const saved = validation ? await saveRequest(safeRequest) : null;
    if (!saved) {
      setMutationFailed(true);
      await refresh();
    } else {
      setBindings((current) => replaceCanonicalBinding(current, saved));
    }
    setBusyConnectionIds((current) => current.filter((id) => id !== binding.id));
  };

  const remove = async (connectionId: string): Promise<void> => {
    if (busyConnectionIds.includes(connectionId)) return;
    setBusyConnectionIds((current) => [...current, connectionId]);
    setMutationFailed(false);
    try {
      const result = await ipcBridge.creativeStudio.removeConnection.invoke({ connectionId });
      if (result.ok === false || !result.data) {
        setMutationFailed(true);
        await refresh();
      } else {
        setBindings((current) => current.filter((binding) => binding.id !== connectionId));
      }
    } catch {
      setMutationFailed(true);
      await refresh();
    } finally {
      setBusyConnectionIds((current) => current.filter((id) => id !== connectionId));
    }
  };

  const editorFooter = (
    <div className='flex justify-end gap-8px'>
      <Button disabled={busy} onClick={closeEditor}>
        {t('settings.mediaModels.cancel')}
      </Button>
      <Button
        type='primary'
        loading={saving}
        disabled={!validationMatchesRequest || busy}
        onClick={() => void saveEditor()}
      >
        {t('settings.mediaModels.save')}
      </Button>
    </div>
  );

  return (
    <section aria-labelledby='studio-media-models-title' className='mt-24px flex flex-col gap-12px'>
      <div className='flex flex-wrap items-start justify-between gap-12px border-t border-border-2 pt-20px'>
        <div className='min-w-0'>
          <h2 id='studio-media-models-title' className='m-0 text-16px font-600 text-t-primary'>
            {t('settings.mediaModels.title')}
          </h2>
          <p className='mb-0 mt-4px text-13px text-t-secondary'>{t('settings.mediaModels.description')}</p>
        </div>
        <Button type='primary' icon={<Plus />} onClick={openAdd}>
          {t('settings.mediaModels.add')}
        </Button>
      </div>

      {listFailed && (
        <div className='flex flex-col gap-8px'>
          <Alert type='error' content={t('settings.mediaModels.loadFailed')} />
          <Button icon={<Refresh />} onClick={() => void refresh()}>
            {t('settings.mediaModels.refresh')}
          </Button>
        </div>
      )}
      {mutationFailed && <Alert type='error' content={t('settings.mediaModels.validationFailed')} />}

      {listFailed && bindings.length === 0 ? null : loading && bindings.length === 0 ? (
        <div className='flex min-h-80px items-center justify-center'>
          <Spin />
        </div>
      ) : bindings.length === 0 ? (
        <div className='flex flex-col items-start gap-10px rounded-8px border border-border-2 bg-fill-1 p-14px'>
          <span className='text-13px text-t-secondary'>{t('settings.mediaModels.empty')}</span>
          <Button onClick={onAddProvider}>{t('settings.mediaModels.addProvider')}</Button>
        </div>
      ) : (
        <ul aria-label={t('settings.mediaModels.title')} className='m-0 flex list-none flex-col gap-8px p-0'>
          {bindings.map((binding) => {
            const candidate = candidates.find((item) => item.providerId === binding.providerId);
            const integration = integrationFor(binding.adapterId);
            const kind = integration?.kind ?? binding.capabilities.mediaKinds[0] ?? 'image';
            const rowBusy = busyConnectionIds.includes(binding.id);
            return (
              <li
                key={binding.id}
                aria-label={binding.model}
                className='rounded-8px border border-border-2 bg-fill-1 p-12px'
              >
                <div className='flex flex-wrap items-start justify-between gap-12px'>
                  <dl className='m-0 grid min-w-0 flex-1 grid-cols-[max-content_minmax(0,1fr)] gap-x-10px gap-y-5px'>
                    <dt className='text-11px text-t-tertiary'>{t('settings.mediaModels.outputType')}</dt>
                    <dd className='m-0 text-12px text-t-primary'>{t(`settings.mediaModels.${kind}`)}</dd>
                    <dt className='text-11px text-t-tertiary'>{t('settings.mediaModels.provider')}</dt>
                    <dd className='m-0 break-all text-12px text-t-primary'>
                      {candidate?.providerName ?? binding.providerId}
                      {!candidate && (
                        <Tag className='ml-6px' color='orange'>
                          {t('settings.mediaModels.unavailable')}
                        </Tag>
                      )}
                    </dd>
                    <dt className='text-11px text-t-tertiary'>{t('settings.mediaModels.integrationLabel')}</dt>
                    <dd className='m-0 text-12px text-t-primary'>{integration ? t(integration.labelKey) : null}</dd>
                    <dt className='text-11px text-t-tertiary'>{t('settings.mediaModels.model')}</dt>
                    <dd className='m-0 break-all text-12px text-t-primary'>{binding.model}</dd>
                    <dt className='text-11px text-t-tertiary'>{t('settings.mediaModels.validatedAt')}</dt>
                    <dd className='m-0 text-12px text-t-secondary'>
                      <time dateTime={binding.validatedAt}>{new Date(binding.validatedAt).toLocaleString()}</time>
                    </dd>
                  </dl>
                  <div className='flex flex-wrap gap-6px'>
                    <Button size='mini' disabled={rowBusy} onClick={() => openEdit(binding)}>
                      {t('settings.mediaModels.edit')}
                    </Button>
                    <Button size='mini' loading={rowBusy} disabled={rowBusy} onClick={() => void revalidate(binding)}>
                      {t('settings.mediaModels.revalidate')}
                    </Button>
                    <Popconfirm title={t('settings.mediaModels.removeConfirm')} onOk={() => void remove(binding.id)}>
                      <Button size='mini' status='danger' disabled={rowBusy}>
                        {t('settings.mediaModels.remove')}
                      </Button>
                    </Popconfirm>
                  </div>
                </div>
                {supportsSilentGatewayOutput(binding) && binding.adapterId === 'weprompt-media-gateway-v1' && (
                  <div className='mt-8px'>
                    <Tag color='green'>{t('settings.mediaModels.silentOutputSupported')}</Tag>
                  </div>
                )}
              </li>
            );
          })}
        </ul>
      )}

      <Modal
        visible={editor.visible}
        title={t(editor.original ? 'settings.mediaModels.editTitle' : 'settings.mediaModels.addTitle')}
        footer={editorFooter}
        closable={!busy}
        maskClosable={!busy}
        escToExit={!busy}
        unmountOnExit
        onCancel={closeEditor}
      >
        <div className='flex flex-col gap-12px'>
          <label className='flex flex-col gap-6px text-12px text-t-secondary'>
            {t('settings.mediaModels.outputType')}
            <Select
              aria-label={t('settings.mediaModels.outputType')}
              value={editor.kind}
              disabled={busy}
              onChange={(value) => updateKind(value as StudioMediaKind)}
            >
              <Select.Option value='image'>{t('settings.mediaModels.image')}</Select.Option>
              <Select.Option value='video'>{t('settings.mediaModels.video')}</Select.Option>
            </Select>
          </label>
          <label className='flex flex-col gap-6px text-12px text-t-secondary'>
            {t('settings.mediaModels.provider')}
            <Select
              aria-label={t('settings.mediaModels.provider')}
              value={editor.providerId || undefined}
              disabled={busy}
              onChange={(value) => updateProvider(String(value))}
            >
              {candidates.map((candidate) => (
                <Select.Option key={candidate.providerId} value={candidate.providerId}>
                  {candidate.providerName}
                </Select.Option>
              ))}
            </Select>
          </label>
          <label className='flex flex-col gap-6px text-12px text-t-secondary'>
            {t('settings.mediaModels.integrationLabel')}
            <Select
              aria-label={t('settings.mediaModels.integrationLabel')}
              value={integrationFor(editor.adapterId)?.labelKey}
              disabled={busy}
              onChange={(value) => {
                const integration = integrationForLabel(String(value));
                if (integration) updateAdapter(integration.adapterId);
              }}
            >
              {integrations.map((integration) => (
                <Select.Option key={integration.adapterId} value={integration.labelKey}>
                  {t(integration.labelKey)}
                </Select.Option>
              ))}
            </Select>
          </label>
          <label className='flex flex-col gap-6px text-12px text-t-secondary'>
            {t('settings.mediaModels.model')}
            <AutoComplete
              value={editor.model}
              data={modelOptions}
              disabled={!editor.providerId || busy}
              placeholder={t('settings.mediaModels.modelPlaceholder')}
              inputProps={{
                'aria-label': t('settings.mediaModels.model'),
              }}
              onChange={updateModel}
            />
          </label>
          <Button long loading={validating} disabled={request === null || busy} onClick={() => void validateEditor()}>
            {t(validating ? 'settings.mediaModels.validating' : 'settings.mediaModels.validate')}
          </Button>
          {validated && validationMatchesRequest && (
            <Alert type='success' content={t('settings.mediaModels.validationSuccess')} />
          )}
          {!validating && request && validationFailed && (
            <Alert type='error' content={t('settings.mediaModels.validationFailed')} />
          )}
        </div>
      </Modal>
    </section>
  );
};
