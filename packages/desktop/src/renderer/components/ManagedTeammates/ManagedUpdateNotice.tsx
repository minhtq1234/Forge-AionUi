import type { ManagedAssistantDetail } from '@/common/types/agent/managedAssistantTypes';
import { Alert, Button, Modal, Tag } from '@arco-design/web-react';
import { CheckOne, CloseOne, Refresh, UpdateRotation } from '@icon-park/react';
import React, { useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { formatManagedTimestamp } from './lifecycleState';
import styles from './ManagedTeammates.module.css';

export type ManagedLifecycleMutationError = 'notice' | 'acknowledgement' | null;

type ManagedUpdateNoticeProps = {
  detail: ManagedAssistantDetail;
  localeKey: string;
  isMarkingNoticeSeen: boolean;
  isAcknowledging: boolean;
  mutationError: ManagedLifecycleMutationError;
  stateChanged: boolean;
  onMarkNoticeSeen: (version: number) => Promise<void>;
  onAcknowledge: (version: number) => Promise<void>;
  onRefresh: () => void;
  onReviewClosed?: () => void;
};

const CATEGORY_KEYS = {
  agent: 'agent',
  permission: 'permission',
  required_skills: 'requiredSkills',
  mcps: 'mcps',
  data_access: 'dataAccess',
  personalization_policy: 'personalizationPolicy',
  content: 'content',
} as const;

const ManagedUpdateNotice: React.FC<ManagedUpdateNoticeProps> = ({
  detail,
  localeKey,
  isMarkingNoticeSeen,
  isAcknowledging,
  mutationError,
  stateChanged,
  onMarkNoticeSeen,
  onAcknowledge,
  onRefresh,
  onReviewClosed,
}) => {
  const { t } = useTranslation();
  const [reviewVisible, setReviewVisible] = useState(false);
  const reviewButtonRef = useRef<HTMLButtonElement | null>(null);
  const currentVersion = detail.update.current_version;
  const required = detail.update.required_acknowledgement;
  const isLifecycleMutating = isMarkingNoticeSeen || isAcknowledging;

  const closeReview = () => {
    setReviewVisible(false);
    window.setTimeout(() => {
      if (reviewButtonRef.current) reviewButtonRef.current.focus();
      else onReviewClosed?.();
    }, 0);
  };

  const reviewCurrent = () => {
    setReviewVisible(true);
    if (currentVersion !== undefined) void onMarkNoticeSeen(currentVersion);
  };

  const renderCategories = (categories: ManagedAssistantDetail['update']['changed_categories']) => (
    <div className={`${styles.categories} mt-10px`}>
      {categories.map((category) => (
        <Tag key={category} bordered={false} className='!bg-fill-2 !text-t-secondary'>
          {t(`settings.managedTeammates.lifecycle.categories.${CATEGORY_KEYS[category]}`)}
        </Tag>
      ))}
    </div>
  );

  return (
    <>
      {detail.update.notice_pending ? (
        <Alert
          className={styles.notice}
          type='info'
          showIcon
          title={t('settings.managedTeammates.lifecycle.routineTitle')}
          content={
            <div className={styles.noticeBody}>
              {detail.governance.release_notes ? (
                <p className={`${styles.adminText} m-0 text-14px leading-22px text-t-secondary`}>
                  {detail.governance.release_notes}
                </p>
              ) : null}
              {renderCategories(detail.update.changed_categories)}
              <div className={`${styles.actions} mt-12px`}>
                <Button
                  ref={reviewButtonRef}
                  size='small'
                  disabled={isLifecycleMutating}
                  icon={<UpdateRotation theme='outline' size={14} fill='currentColor' />}
                  onClick={reviewCurrent}
                >
                  {t('settings.managedTeammates.lifecycle.reviewUpdate')}
                </Button>
                {currentVersion !== undefined ? (
                  <Button
                    size='small'
                    type='text'
                    loading={isMarkingNoticeSeen}
                    disabled={isLifecycleMutating}
                    icon={<CloseOne theme='outline' size={14} fill='currentColor' />}
                    onClick={() => void onMarkNoticeSeen(currentVersion)}
                  >
                    {t('settings.managedTeammates.lifecycle.dismissUpdate')}
                  </Button>
                ) : null}
              </div>
            </div>
          }
        />
      ) : null}

      {detail.update.acknowledgement_required && required ? (
        <Alert
          className={styles.notice}
          type='warning'
          showIcon
          title={t('settings.managedTeammates.lifecycle.highImpactTitle')}
          content={
            <div className={styles.noticeBody}>
              <p className='m-0 text-14px leading-22px text-t-secondary'>
                {t('settings.managedTeammates.lifecycle.highImpactBody')}
              </p>
              <div className='mt-8px text-12px text-t-tertiary'>
                {t('settings.managedTeammates.version', { version: required.version })}
              </div>
              <div className='mt-4px text-12px text-t-tertiary'>
                {t('settings.managedTeammates.lifecycle.publishedAt')}:{' '}
                <time dateTime={new Date(required.published_at * 1000).toISOString()}>
                  {formatManagedTimestamp(required.published_at, localeKey)}
                </time>
              </div>
              <p className={`${styles.adminText} m-0 mt-8px text-14px leading-22px text-t-primary`}>
                {required.release_notes}
              </p>
              {renderCategories(required.changed_categories)}
              <div className={`${styles.actions} mt-12px`}>
                <Button
                  type='primary'
                  size='small'
                  loading={isAcknowledging}
                  disabled={isLifecycleMutating}
                  icon={<CheckOne theme='outline' size={14} fill='currentColor' />}
                  onClick={() => void onAcknowledge(required.version)}
                >
                  {t('settings.managedTeammates.lifecycle.acknowledge')}
                </Button>
              </div>
            </div>
          }
        />
      ) : null}

      {stateChanged || mutationError ? (
        <Alert
          className={styles.notice}
          type={stateChanged ? 'warning' : 'error'}
          showIcon
          content={
            <div className={styles.noticeBody}>
              <div>
                {stateChanged
                  ? t('settings.managedTeammates.lifecycle.stateChanged')
                  : mutationError === 'notice'
                    ? t('settings.managedTeammates.lifecycle.noticeError')
                    : t('settings.managedTeammates.lifecycle.acknowledgementError')}
              </div>
              <Button
                className='!mt-8px'
                size='small'
                icon={<Refresh theme='outline' size={14} fill='currentColor' />}
                onClick={onRefresh}
              >
                {t('settings.managedTeammates.lifecycle.checkAgain')}
              </Button>
            </div>
          }
        />
      ) : null}

      <Modal
        className={styles.modal}
        visible={reviewVisible}
        title={t('settings.managedTeammates.lifecycle.routineTitle')}
        footer={
          <Button type='primary' onClick={closeReview}>
            {t('common.close')}
          </Button>
        }
        autoFocus
        focusLock
        unmountOnExit
        onCancel={closeReview}
      >
        {currentVersion !== undefined ? (
          <div className='text-12px text-t-tertiary'>
            {t('settings.managedTeammates.version', { version: currentVersion })}
          </div>
        ) : null}
        {detail.governance.published_at !== undefined ? (
          <div className='mt-4px text-12px text-t-tertiary'>
            {t('settings.managedTeammates.lifecycle.publishedAt')}:{' '}
            <time dateTime={new Date(detail.governance.published_at * 1000).toISOString()}>
              {formatManagedTimestamp(detail.governance.published_at, localeKey)}
            </time>
          </div>
        ) : null}
        {detail.governance.release_notes ? (
          <div className='mt-16px'>
            <div className='text-14px font-600 text-t-primary'>
              {t('settings.managedTeammates.lifecycle.releaseNotes')}
            </div>
            <p className={`${styles.adminText} m-0 mt-8px text-14px leading-22px text-t-secondary`}>
              {detail.governance.release_notes}
            </p>
          </div>
        ) : null}
      </Modal>
    </>
  );
};

export default ManagedUpdateNotice;
