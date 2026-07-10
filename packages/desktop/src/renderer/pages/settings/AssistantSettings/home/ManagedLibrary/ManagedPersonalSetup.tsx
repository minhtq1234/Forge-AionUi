import type {
  ManagedAssistantDetail,
  ManagedAssistantPreferencesRequest,
  ManagedPersonalizationField,
} from '@/common/types/agent/managedAssistantTypes';
import { Alert, Button, Drawer, Form, Input, Popconfirm } from '@arco-design/web-react';
import { Close, Refresh } from '@icon-park/react';
import React, { useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import styles from './ManagedLibrary.module.css';
import { getRenderablePersonalizationFields } from './useManagedLibrary';
import type { ManagedMutationError } from './useManagedLibrary';

type ManagedPersonalSetupProps = {
  visible: boolean;
  detail: ManagedAssistantDetail;
  isSaving: boolean;
  isResetting: boolean;
  error: ManagedMutationError;
  onClose: () => void;
  onSave: (request: ManagedAssistantPreferencesRequest) => Promise<void>;
  onReset: () => Promise<void>;
};

const splitPrompts = (value: string): string[] =>
  value
    .split('\n')
    .map((prompt) => prompt.trim())
    .filter(Boolean);

const ManagedPersonalSetup: React.FC<ManagedPersonalSetupProps> = ({
  visible,
  detail,
  isSaving,
  isResetting,
  error,
  onClose,
  onSave,
  onReset,
}) => {
  const { t } = useTranslation();
  const [nickname, setNickname] = useState('');
  const [preferredLanguage, setPreferredLanguage] = useState('');
  const [responseStyle, setResponseStyle] = useState('');
  const [recurringContext, setRecurringContext] = useState('');
  const [defaultWorkspace, setDefaultWorkspace] = useState('');
  const [personalPrompts, setPersonalPrompts] = useState('');

  const allowedFields = useMemo(
    () => new Set<ManagedPersonalizationField>(getRenderablePersonalizationFields(detail)),
    [detail]
  );

  useEffect(() => {
    setNickname(detail.preferences.nickname ?? '');
    setPreferredLanguage(detail.preferences.preferred_language ?? '');
    setResponseStyle(detail.preferences.response_style ?? '');
    setRecurringContext(detail.preferences.recurring_context ?? '');
    setDefaultWorkspace(detail.preferences.default_workspace ?? '');
    setPersonalPrompts((detail.preferences.personal_prompts ?? []).join('\n'));
  }, [detail]);

  const handleSave = async () => {
    const request: ManagedAssistantPreferencesRequest = {};
    if (allowedFields.has('nickname')) request.nickname = nickname.trim();
    if (allowedFields.has('preferred_language')) request.preferred_language = preferredLanguage.trim();
    if (allowedFields.has('response_style')) request.response_style = responseStyle.trim();
    if (allowedFields.has('recurring_context')) request.recurring_context = recurringContext.trim();
    if (allowedFields.has('default_workspace')) request.default_workspace = defaultWorkspace.trim();
    if (allowedFields.has('personal_prompts')) request.personal_prompts = splitPrompts(personalPrompts);
    await onSave(request);
  };

  const fieldLabel = (key: string) => t(`settings.managedTeammates.${key}`);

  return (
    <Drawer
      visible={visible}
      placement='right'
      wrapClassName={styles.setupDrawer}
      title={
        <div className='min-w-0 [padding-inline-end:8px]'>
          <div className='text-16px font-600 text-t-primary'>{t('settings.managedTeammates.setupTitle')}</div>
          <div className='mt-4px text-14px font-normal leading-22px text-t-secondary'>
            {t('settings.managedTeammates.setupLead')}
          </div>
        </div>
      }
      footer={
        <div className={styles.setupFooter}>
          <Button disabled={isSaving || isResetting} onClick={onClose}>
            {t('settings.managedTeammates.setUpLater')}
          </Button>
          <Button
            type='primary'
            loading={isSaving}
            disabled={isSaving || isResetting}
            onClick={() => void handleSave()}
          >
            {t('settings.managedTeammates.saveSetup')}
          </Button>
        </div>
      }
      closeIcon={<Close theme='outline' size={18} fill='currentColor' />}
      escToExit
      maskClosable
      onCancel={onClose}
      unmountOnExit={false}
    >
      <div className={styles.setupBody}>
        <Alert type='info' content={t('settings.managedTeammates.setupManagedSummary')} />

        {error === 'preferences' ? (
          <Alert type='error' content={t('settings.managedTeammates.preferencesError')} />
        ) : null}
        {error === 'reset' ? <Alert type='error' content={t('settings.managedTeammates.resetError')} /> : null}

        <Form layout='vertical' className='w-full'>
          {allowedFields.has('nickname') ? (
            <Form.Item label={fieldLabel('fieldNickname')}>
              <Input
                aria-label={fieldLabel('fieldNickname')}
                value={nickname}
                onChange={setNickname}
                disabled={isSaving || isResetting}
              />
            </Form.Item>
          ) : null}

          {allowedFields.has('preferred_language') ? (
            <Form.Item label={fieldLabel('fieldPreferredLanguage')}>
              <Input
                aria-label={fieldLabel('fieldPreferredLanguage')}
                value={preferredLanguage}
                onChange={setPreferredLanguage}
                disabled={isSaving || isResetting}
              />
            </Form.Item>
          ) : null}

          {allowedFields.has('response_style') ? (
            <Form.Item label={fieldLabel('fieldResponseStyle')}>
              <Input
                aria-label={fieldLabel('fieldResponseStyle')}
                value={responseStyle}
                onChange={setResponseStyle}
                disabled={isSaving || isResetting}
              />
            </Form.Item>
          ) : null}

          {allowedFields.has('recurring_context') ? (
            <Form.Item label={fieldLabel('fieldRecurringContext')}>
              <Input.TextArea
                aria-label={fieldLabel('fieldRecurringContext')}
                value={recurringContext}
                onChange={setRecurringContext}
                autoSize={{ minRows: 3, maxRows: 6 }}
                disabled={isSaving || isResetting}
              />
            </Form.Item>
          ) : null}

          {allowedFields.has('default_workspace') ? (
            <Form.Item label={fieldLabel('fieldDefaultWorkspace')}>
              <Input
                aria-label={fieldLabel('fieldDefaultWorkspace')}
                value={defaultWorkspace}
                onChange={setDefaultWorkspace}
                disabled={isSaving || isResetting}
              />
            </Form.Item>
          ) : null}

          {allowedFields.has('personal_prompts') ? (
            <Form.Item label={fieldLabel('fieldPersonalPrompts')}>
              <Input.TextArea
                aria-label={fieldLabel('fieldPersonalPrompts')}
                value={personalPrompts}
                onChange={setPersonalPrompts}
                autoSize={{ minRows: 3, maxRows: 7 }}
                disabled={isSaving || isResetting}
              />
            </Form.Item>
          ) : null}
        </Form>

        <Popconfirm
          title={t('settings.managedTeammates.resetSetupConfirm')}
          okText={t('settings.managedTeammates.resetSetupAction')}
          onOk={() => void onReset()}
          disabled={isSaving || isResetting}
        >
          <Button
            type='text'
            status='danger'
            icon={<Refresh theme='outline' size={16} fill='currentColor' />}
            loading={isResetting}
            disabled={isSaving || isResetting}
          >
            {t('settings.managedTeammates.resetSetup')}
          </Button>
        </Popconfirm>
      </div>
    </Drawer>
  );
};

export default ManagedPersonalSetup;
