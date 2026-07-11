import type { ManagedAssistantStartState } from '@/common/types/agent/managedAssistantTypes';
import { Alert, Button } from '@arco-design/web-react';
import { Refresh } from '@icon-park/react';
import React from 'react';
import { useTranslation } from 'react-i18next';
import { formatManagedTimestamp } from './lifecycleState';
import styles from './ManagedTeammates.module.css';

type ManagedAvailabilityNoticeProps = {
  startState: ManagedAssistantStartState;
  localeKey: string;
  onRefresh: () => void;
};

const ManagedAvailabilityNotice: React.FC<ManagedAvailabilityNoticeProps> = ({ startState, localeKey, onRefresh }) => {
  const { t } = useTranslation();
  const reason = startState.unavailable_reason;

  return (
    <Alert
      className={styles.notice}
      type='warning'
      showIcon
      title={t('settings.managedTeammates.lifecycle.temporarilyUnavailableTitle')}
      content={
        <div className={styles.noticeBody}>
          <p className='m-0 text-14px leading-22px text-t-secondary'>
            {reason
              ? t(`settings.managedTeammates.lifecycle.unavailableReasons.${reason}`)
              : t('settings.managedTeammates.lifecycle.temporarilyUnavailableBody')}
          </p>
          {startState.expected_recovery_at !== undefined ? (
            <div className='mt-6px text-14px leading-22px text-t-secondary'>
              <span className='font-600 text-t-primary'>
                {t('settings.managedTeammates.lifecycle.expectedRecovery')}:
              </span>{' '}
              <time dateTime={new Date(startState.expected_recovery_at * 1000).toISOString()}>
                {formatManagedTimestamp(startState.expected_recovery_at, localeKey)}
              </time>
            </div>
          ) : null}
          <Button
            className='!mt-10px'
            size='small'
            icon={<Refresh theme='outline' size={14} fill='currentColor' />}
            onClick={onRefresh}
          >
            {t('settings.managedTeammates.lifecycle.checkAgain')}
          </Button>
        </div>
      }
    />
  );
};

export default ManagedAvailabilityNotice;
