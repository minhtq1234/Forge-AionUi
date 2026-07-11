import type { ManagedAssistantDetail } from '@/common/types/agent/managedAssistantTypes';
import { Alert, Button } from '@arco-design/web-react';
import { Right, Shield } from '@icon-park/react';
import React from 'react';
import { useTranslation } from 'react-i18next';
import { formatManagedTimestamp } from './lifecycleState';
import styles from './ManagedTeammates.module.css';

type ManagedRetirementNoticeProps = {
  detail: ManagedAssistantDetail;
  localeKey: string;
  planned: boolean;
  onOpenReplacement: (id: string) => void;
};

const ManagedRetirementNotice: React.FC<ManagedRetirementNoticeProps> = ({
  detail,
  localeKey,
  planned,
  onOpenReplacement,
}) => {
  const { t } = useTranslation();
  const governance = detail.governance;

  return (
    <Alert
      className={styles.notice}
      type={planned ? 'warning' : 'error'}
      showIcon
      title={
        planned
          ? t('settings.managedTeammates.lifecycle.retiringTitle')
          : t('settings.managedTeammates.lifecycle.retiredTitle')
      }
      content={
        <div className={styles.noticeBody}>
          {governance.retirement_reason ? (
            <div className='text-14px leading-22px text-t-secondary'>
              <span className='font-600 text-t-primary'>
                {t('settings.managedTeammates.lifecycle.retirementReason')}:
              </span>{' '}
              <span className={styles.adminText}>{governance.retirement_reason}</span>
            </div>
          ) : null}
          {governance.retirement_cutoff_at !== undefined ? (
            <div className='mt-6px text-14px leading-22px text-t-secondary'>
              <span className='font-600 text-t-primary'>
                {t('settings.managedTeammates.lifecycle.retirementCutoff')}:
              </span>{' '}
              <time dateTime={new Date(governance.retirement_cutoff_at * 1000).toISOString()}>
                {formatManagedTimestamp(governance.retirement_cutoff_at, localeKey)}
              </time>
            </div>
          ) : !planned ? (
            <div className='mt-6px text-14px leading-22px text-t-secondary'>
              {t('settings.managedTeammates.lifecycle.retiredImmediate')}
            </div>
          ) : null}
          <div className='mt-8px flex min-w-0 items-start gap-6px text-14px leading-22px text-t-secondary'>
            <Shield className='mt-3px shrink-0' theme='outline' size={14} fill='currentColor' />
            <span>{t('settings.managedTeammates.lifecycle.personalSetupRetained')}</span>
          </div>
          {governance.replacement_assistant_id ? (
            <div className={`${styles.actions} mt-12px`}>
              <Button
                size='small'
                icon={<Right theme='outline' size={14} fill='currentColor' />}
                onClick={() => onOpenReplacement(governance.replacement_assistant_id as string)}
              >
                {t('settings.managedTeammates.lifecycle.viewReplacement')}
              </Button>
            </div>
          ) : null}
        </div>
      }
    />
  );
};

export default ManagedRetirementNotice;
