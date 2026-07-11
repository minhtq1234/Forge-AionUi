import type { ManagedAssistantDetail, ManagedPersonalizationField } from '@/common/types/agent/managedAssistantTypes';
import { ManagedLifecycleNotices, canStartManagedAssistant } from '@/renderer/components/ManagedTeammates';
import type { ManagedLifecycleMutationError } from '@/renderer/components/ManagedTeammates';
import { isEmoji, resolveAvatarImageSrc } from '../../assistantUtils';
import { Alert, Avatar, Button, Result, Spin, Tag } from '@arco-design/web-react';
import { Check, Left, Lock, Play, Refresh, Shield } from '@icon-park/react';
import React, { useEffect, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import styles from './ManagedLibrary.module.css';
import { getRenderablePersonalizationFields } from './useManagedLibrary';
import type { ManagedMutationError, ManagedReadError } from './useManagedLibrary';

type ManagedTeammateDetailProps = {
  detail: ManagedAssistantDetail | null;
  localeKey: string;
  isLoading: boolean;
  isAdopting: boolean;
  isAdoptionRefreshPending: boolean;
  error: ManagedReadError;
  mutationError: ManagedMutationError;
  lifecycleMutationError: ManagedLifecycleMutationError;
  lifecycleStateChanged: boolean;
  isMarkingNoticeSeen: boolean;
  isAcknowledging: boolean;
  onBack: () => void;
  onRetry: () => void;
  onAdopt: () => void;
  onStartChat: () => void;
  onMarkNoticeSeen: (version: number) => Promise<void>;
  onAcknowledge: (version: number) => Promise<void>;
  onOpenReplacement: (id: string) => void;
};

const localizedValue = (value: string, values: Record<string, string>, localeKey: string): string =>
  values[localeKey] ?? values['en-US'] ?? value;

const localizedList = (values: string[], localizedValues: Record<string, string[]>, localeKey: string): string[] =>
  localizedValues[localeKey] ?? localizedValues['en-US'] ?? values;

const PERSONALIZATION_LABELS: Record<ManagedPersonalizationField, string> = {
  nickname: 'fieldNickname',
  preferred_language: 'fieldPreferredLanguage',
  response_style: 'fieldResponseStyle',
  recurring_context: 'fieldRecurringContext',
  default_workspace: 'fieldDefaultWorkspace',
  personal_prompts: 'fieldPersonalPrompts',
  optional_skills: 'fieldOptionalSkills',
  model: 'fieldModel',
};

const DetailSection: React.FC<{ title: string; values?: string[]; body?: string }> = ({ title, values, body }) => {
  if (!body && (!values || values.length === 0)) return null;
  return (
    <section className={styles.detailSection}>
      <h3 className='m-0 text-14px font-600 leading-20px text-t-primary'>{title}</h3>
      {body ? <p className='m-0 mt-8px text-14px leading-22px text-t-secondary'>{body}</p> : null}
      {values && values.length > 0 ? (
        <ul className={`${styles.detailList} m-0 mt-8px space-y-6px text-14px leading-22px text-t-secondary`}>
          {values.map((value) => (
            <li key={value}>{value}</li>
          ))}
        </ul>
      ) : null}
    </section>
  );
};

const ManagedTeammateDetail: React.FC<ManagedTeammateDetailProps> = ({
  detail,
  localeKey,
  isLoading,
  isAdopting,
  isAdoptionRefreshPending,
  error,
  mutationError,
  lifecycleMutationError,
  lifecycleStateChanged,
  isMarkingNoticeSeen,
  isAcknowledging,
  onBack,
  onRetry,
  onAdopt,
  onStartChat,
  onMarkNoticeSeen,
  onAcknowledge,
  onOpenReplacement,
}) => {
  const { t } = useTranslation();
  const backButtonRef = useRef<HTMLButtonElement | null>(null);
  const startButtonRef = useRef<HTMLButtonElement | null>(null);

  useEffect(() => {
    if (isLoading || (!detail && !error)) return;
    backButtonRef.current?.focus();
  }, [detail?.assistant.id, error, isLoading]);

  if (isLoading || (!detail && !error)) {
    return (
      <div className='flex min-h-240px items-center justify-center' aria-live='polite'>
        <Spin tip={t('settings.managedTeammates.loadingDetails')} />
      </div>
    );
  }

  if (error || !detail) {
    const unauthorized = error === 'unauthorized';
    return (
      <div>
        <Button
          ref={backButtonRef}
          type='text'
          icon={<Left className={styles.directionalIcon} theme='outline' size={16} fill='currentColor' />}
          onClick={onBack}
        >
          {t('settings.managedTeammates.backToLibrary')}
        </Button>
        <Result
          status={unauthorized ? '403' : 'error'}
          title={
            unauthorized
              ? t('settings.managedTeammates.unauthorizedTitle')
              : t('settings.managedTeammates.detailErrorTitle')
          }
          subTitle={unauthorized ? t('settings.managedTeammates.unauthorizedBody') : undefined}
          extra={
            <Button type='primary' icon={<Refresh theme='outline' size={16} fill='currentColor' />} onClick={onRetry}>
              {t('common.retry')}
            </Button>
          }
        />
      </div>
    );
  }

  const brief = detail.employee_brief;
  const jobSummary = localizedValue(brief.job_summary, brief.job_summary_i18n, localeKey);
  const trainedFor = localizedList(brief.trained_for, brief.trained_for_i18n, localeKey);
  const inputsRequired = localizedList(brief.inputs_required, brief.inputs_required_i18n, localeKey);
  const dataAccess = localizedValue(brief.data_access_summary, brief.data_access_summary_i18n, localeKey);
  const boundaries = localizedList(brief.boundaries, brief.boundaries_i18n, localeKey);
  const humanReview = localizedList(brief.human_review_requirements, brief.human_review_requirements_i18n, localeKey);
  const profile = detail.assistant.profile;
  const name = profile.name_i18n[localeKey] ?? profile.name_i18n['en-US'] ?? profile.name;
  const description =
    profile.description_i18n[localeKey] ?? profile.description_i18n['en-US'] ?? profile.description ?? '';
  const avatar = profile.avatar?.trim();
  const avatarImage = resolveAvatarImageSrc(avatar);
  const personalizableFields = getRenderablePersonalizationFields(detail);

  return (
    <div className={styles.libraryShell}>
      <Button
        ref={backButtonRef}
        type='text'
        icon={<Left className={styles.directionalIcon} theme='outline' size={16} fill='currentColor' />}
        className='!mb-14px !px-0'
        onClick={onBack}
      >
        {t('settings.managedTeammates.backToLibrary')}
      </Button>

      <ManagedLifecycleNotices
        detail={detail}
        localeKey={localeKey}
        isMarkingNoticeSeen={isMarkingNoticeSeen}
        isAcknowledging={isAcknowledging}
        mutationError={lifecycleMutationError}
        stateChanged={lifecycleStateChanged}
        onMarkNoticeSeen={onMarkNoticeSeen}
        onAcknowledge={onAcknowledge}
        onRefresh={onRetry}
        onOpenReplacement={onOpenReplacement}
        onReviewClosed={() => (startButtonRef.current ?? backButtonRef.current)?.focus()}
      />

      <div className={`${styles.detailLayout} mt-16px`}>
        <div className={styles.identityHeader}>
          <div className='flex min-w-0 items-start gap-12px'>
            <Avatar shape='square' size={44} className='shrink-0 !bg-fill-2 !text-16px !font-600 !text-t-primary'>
              {avatarImage ? <img src={avatarImage} alt='' className='h-full w-full object-cover' /> : null}
              {!avatarImage && avatar && isEmoji(avatar) ? avatar : null}
              {!avatarImage && (!avatar || !isEmoji(avatar)) ? name.slice(0, 2).toUpperCase() : null}
            </Avatar>
            <div className='min-w-0 flex-1'>
              <h2 className='m-0 break-words text-20px font-600 leading-28px text-t-primary'>{name}</h2>
              {description ? <p className='m-0 mt-4px text-14px leading-22px text-t-secondary'>{description}</p> : null}
              <Tag
                bordered={false}
                icon={<Shield theme='outline' size={13} fill='currentColor' />}
                className='!mt-8px !bg-fill-2 !text-primary-6'
              >
                {t('settings.managedTeammates.sourceManaged')}
              </Tag>
            </div>
          </div>
        </div>

        <main className={styles.detailMain}>
          <DetailSection title={t('settings.managedTeammates.whatItDoes')} body={jobSummary} />
          <DetailSection title={t('settings.managedTeammates.trainedFor')} values={trainedFor} />
          <DetailSection title={t('settings.managedTeammates.skillsAndAccess')} body={dataAccess} />
          <DetailSection title={t('settings.managedTeammates.whatYouProvide')} values={inputsRequired} />
          <DetailSection title={t('settings.managedTeammates.boundaries')} values={boundaries} />
          <DetailSection title={t('settings.managedTeammates.humanReview')} values={humanReview} />
        </main>

        <aside className={styles.ownershipRail}>
          <h3 className='m-0 text-14px font-600 leading-20px text-t-primary'>
            {t('settings.managedTeammates.ownershipTitle')}
          </h3>
          <dl className='m-0 mt-12px space-y-12px'>
            <div>
              <dt className='text-12px text-t-tertiary'>{t('settings.managedTeammates.owner')}</dt>
              <dd className='m-0 mt-2px break-words text-14px font-500 text-t-primary'>
                {detail.governance.business_owner}
              </dd>
            </div>
            {detail.governance.published_version ? (
              <div>
                <dt className='text-12px text-t-tertiary'>{t('settings.managedTeammates.versionLabel')}</dt>
                <dd className='m-0 mt-2px text-14px font-500 text-t-primary'>
                  {t('settings.managedTeammates.version', { version: detail.governance.published_version })}
                </dd>
              </div>
            ) : null}
          </dl>

          <div className='mt-20px'>
            <div className='flex items-center gap-6px text-14px font-600 text-t-primary'>
              <Lock theme='outline' size={15} fill='currentColor' />
              {t('settings.managedTeammates.vngManages')}
            </div>
            <ul className={`${styles.detailList} m-0 mt-8px space-y-5px text-14px leading-22px text-t-secondary`}>
              <li>{t('settings.managedTeammates.managedJob')}</li>
              <li>{t('settings.managedTeammates.managedTraining')}</li>
              <li>{t('settings.managedTeammates.managedSafety')}</li>
            </ul>
          </div>

          <div className='mt-20px'>
            <div className='flex items-center gap-6px text-14px font-600 text-t-primary'>
              <Check theme='outline' size={15} fill='currentColor' />
              {t('settings.managedTeammates.youCanPersonalize')}
            </div>
            {personalizableFields.length > 0 ? (
              <ul className={`${styles.detailList} m-0 mt-8px space-y-5px text-14px leading-22px text-t-secondary`}>
                {personalizableFields.map((field) => (
                  <li key={field}>{t(`settings.managedTeammates.${PERSONALIZATION_LABELS[field]}`)}</li>
                ))}
              </ul>
            ) : (
              <p className='m-0 mt-8px text-14px leading-22px text-t-secondary'>
                {t('settings.managedTeammates.noPersonalSetup')}
              </p>
            )}
          </div>

          {mutationError === 'adoption' ? (
            <Alert className='mt-16px' type='error' content={t('settings.managedTeammates.adoptionError')} />
          ) : null}
          <div className={`${styles.actionRow} mt-18px`}>
            {!detail.adoption.active ? (
              <Button type='primary' long loading={isAdopting} disabled={isAdopting} onClick={onAdopt}>
                {t('settings.managedTeammates.add')}
              </Button>
            ) : !isAdopting && !isAdoptionRefreshPending && canStartManagedAssistant(detail) ? (
              <Button
                ref={startButtonRef}
                type='primary'
                long
                icon={<Play theme='outline' size={16} fill='currentColor' />}
                onClick={onStartChat}
              >
                {t('settings.managedTeammates.startWorking')}
              </Button>
            ) : null}
          </div>
        </aside>
      </div>
    </div>
  );
};

export default ManagedTeammateDetail;
