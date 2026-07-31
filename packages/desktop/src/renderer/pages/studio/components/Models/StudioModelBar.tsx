/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import type {
  StudioModelSelectionChange,
  StudioProviderRef,
  StudioRouteCatalog,
  StudioRouteCatalogEntry,
  StudioTextModelOption,
  StudioTextModelRef,
} from '@/common/types/project/creativeStudioTypes';
import { Alert, Button, Select, Spin } from '@arco-design/web-react';
import { Refresh } from '@icon-park/react';
import React from 'react';
import { useTranslation } from 'react-i18next';

type ModelRole = StudioModelSelectionChange['role'];

export type StudioModelBarProps = {
  catalog: StudioRouteCatalog | null;
  loading: boolean;
  errorMessageKey: string | null;
  pendingRole: ModelRole | null;
  disabled?: boolean;
  onRefresh: () => void | Promise<void>;
  onSelectionChange: (input: StudioModelSelectionChange) => void | Promise<boolean>;
  onOpenSettings: (path: '/settings/model') => void;
};

const optionLabel = (model: string, providerName: string): string => `${model} · ${providerName}`;
const textIdentity = (route: StudioTextModelRef): string => `${route.providerId}\u0000${route.model}`;
const mediaIdentity = (route: StudioProviderRef): string =>
  `${route.providerId}\u0000${route.adapterId}\u0000${route.model}`;

type RoleSelectProps = {
  role: ModelRole;
  label: string;
  status: StudioRouteCatalog[ModelRole]['status'] | null;
  value: string | undefined;
  options: Array<{ value: string; label: string; disabled?: boolean }>;
  loading: boolean;
  disabled: boolean;
  onChange: (value: string) => void;
  onClear: () => void;
  onOpenSettings: () => void;
};

const RoleSelect: React.FC<RoleSelectProps> = ({
  label,
  status,
  value,
  options,
  loading,
  disabled,
  onChange,
  onClear,
  onOpenSettings,
}) => {
  const { t } = useTranslation();
  return (
    <div className='min-w-200px flex-1'>
      <span className='mb-6px block text-12px font-500 text-t-secondary'>{label}</span>
      <Select
        aria-label={label}
        className='mt-4px w-full'
        value={value}
        loading={loading}
        disabled={disabled || status === 'setup_required'}
        allowClear={value !== undefined}
        placeholder={t(
          status === 'setup_required'
            ? 'conversation.creativeStudio.models.setupRequired'
            : 'conversation.creativeStudio.models.selectionRequired'
        )}
        onChange={onChange}
        onClear={onClear}
      >
        {options.map((option) => (
          <Select.Option key={option.value} value={option.value} disabled={option.disabled}>
            {option.label}
          </Select.Option>
        ))}
      </Select>
      {status === 'setup_required' && (
        <Button type='text' size='mini' onClick={onOpenSettings}>
          {t('conversation.creativeStudio.models.openSettings')}
        </Button>
      )}
      {status === 'unavailable' && (
        <span className='block text-11px text-warning'>{t('conversation.creativeStudio.models.unavailable')}</span>
      )}
    </div>
  );
};

const withSuggested = (label: string, sole: boolean, suggested: string): string =>
  sole ? `${label} · ${suggested}` : label;

/**
 * Project-level model selectors. Every emitted value is recovered from the
 * role-specific catalog list so arbitrary DOM values and cross-role routes are
 * never forwarded to IPC.
 */
export const StudioModelBar: React.FC<StudioModelBarProps> = ({
  catalog,
  loading,
  errorMessageKey,
  pendingRole,
  disabled = false,
  onRefresh,
  onSelectionChange,
  onOpenSettings,
}) => {
  const { t } = useTranslation();
  const suggested = t('conversation.creativeStudio.models.suggested');
  const storyboardOptions = catalog?.storyboard.options ?? [];
  const imageOptions = (catalog?.image.options ?? []).filter((route) => route.kind === 'image');
  const videoOptions = (catalog?.video.options ?? []).filter((route) => route.kind === 'video');

  const storyboardSelected = catalog?.storyboard.selected ?? null;
  const imageSelected = catalog?.image.selected ?? null;
  const videoSelected = catalog?.video.selected ?? null;

  const textOptions: RoleSelectProps['options'] = storyboardOptions.map((route) => ({
    value: textIdentity(route),
    label: withSuggested(optionLabel(route.model, route.providerName), storyboardOptions.length === 1, suggested),
  }));
  if (
    storyboardSelected !== null &&
    !storyboardOptions.some((route) => textIdentity(route) === textIdentity(storyboardSelected))
  ) {
    textOptions.unshift({
      value: textIdentity(storyboardSelected),
      label: optionLabel(storyboardSelected.model, storyboardSelected.providerId),
      disabled: true,
    });
  }

  const mediaOptions = (
    options: StudioRouteCatalogEntry[],
    selected: StudioProviderRef | null
  ): RoleSelectProps['options'] => {
    const result: RoleSelectProps['options'] = options.map((route) => ({
      value: mediaIdentity(route),
      label: withSuggested(optionLabel(route.model, route.providerName), options.length === 1, suggested),
    }));
    if (selected !== null && !options.some((route) => mediaIdentity(route) === mediaIdentity(selected))) {
      result.unshift({
        value: mediaIdentity(selected),
        label: optionLabel(selected.model, selected.providerId),
        disabled: true,
      });
    }
    return result;
  };

  const selectStoryboard = (value: string): void => {
    const selection = storyboardOptions.find((route) => textIdentity(route) === value);
    if (selection === undefined) return;
    const safeSelection: StudioTextModelOption = selection;
    void onSelectionChange({
      role: 'storyboard',
      selection: { providerId: safeSelection.providerId, model: safeSelection.model },
    });
  };

  const selectMedia = (role: 'image' | 'video', options: StudioRouteCatalogEntry[], value: string): void => {
    const selection = options.find((route) => mediaIdentity(route) === value && route.kind === role);
    if (selection === undefined) return;
    void onSelectionChange({
      role,
      selection: {
        providerId: selection.providerId,
        adapterId: selection.adapterId,
        model: selection.model,
      },
    });
  };

  return (
    <section
      aria-label={t('conversation.creativeStudio.models.title')}
      className='flex flex-col gap-10px rounded-8px border border-border-2 bg-fill-1 p-12px'
    >
      <div className='flex flex-wrap items-center justify-between gap-8px'>
        <h2 className='m-0 text-14px font-600 text-t-primary'>{t('conversation.creativeStudio.models.title')}</h2>
        <Button
          type='text'
          size='mini'
          icon={<Refresh />}
          loading={loading}
          disabled={disabled}
          onClick={() => void onRefresh()}
        >
          {t('conversation.creativeStudio.models.refresh')}
        </Button>
      </div>
      {loading && catalog === null && (
        <div role='status' className='flex items-center gap-6px text-12px text-t-secondary'>
          <Spin size={12} />
          {t('conversation.creativeStudio.models.loading')}
        </div>
      )}
      {errorMessageKey !== null && <Alert type='error' content={t(errorMessageKey)} />}
      <div className='flex flex-wrap gap-12px'>
        <RoleSelect
          role='storyboard'
          label={t('conversation.creativeStudio.models.storyboard')}
          status={catalog?.storyboard.status ?? null}
          value={storyboardSelected === null ? undefined : textIdentity(storyboardSelected)}
          options={textOptions}
          loading={loading}
          disabled={disabled || pendingRole === 'storyboard'}
          onChange={selectStoryboard}
          onClear={() => void onSelectionChange({ role: 'storyboard', selection: null })}
          onOpenSettings={() => onOpenSettings('/settings/model')}
        />
        <RoleSelect
          role='image'
          label={t('conversation.creativeStudio.models.image')}
          status={catalog?.image.status ?? null}
          value={imageSelected === null ? undefined : mediaIdentity(imageSelected)}
          options={mediaOptions(imageOptions, imageSelected)}
          loading={loading}
          disabled={disabled || pendingRole === 'image'}
          onChange={(value) => selectMedia('image', imageOptions, value)}
          onClear={() => void onSelectionChange({ role: 'image', selection: null })}
          onOpenSettings={() => onOpenSettings('/settings/model')}
        />
        <RoleSelect
          role='video'
          label={t('conversation.creativeStudio.models.video')}
          status={catalog?.video.status ?? null}
          value={videoSelected === null ? undefined : mediaIdentity(videoSelected)}
          options={mediaOptions(videoOptions, videoSelected)}
          loading={loading}
          disabled={disabled || pendingRole === 'video'}
          onChange={(value) => selectMedia('video', videoOptions, value)}
          onClear={() => void onSelectionChange({ role: 'video', selection: null })}
          onOpenSettings={() => onOpenSettings('/settings/model')}
        />
      </div>
    </section>
  );
};
