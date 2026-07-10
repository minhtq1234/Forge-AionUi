import type { ManagedAssistantSummary } from '@/common/types/agent/managedAssistantTypes';
import { resolveAssistantDisplayName } from '@/renderer/utils/model/assistantDisplay';
import { Button, Empty, Input, Result, Select, Spin } from '@arco-design/web-react';
import { Refresh, Search, Shield } from '@icon-park/react';
import React, { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import AssistantAvatar from '../../AssistantAvatar';
import styles from './ManagedLibrary.module.css';
import type { ManagedReadError } from './useManagedLibrary';

type ManagedTeammateListProps = {
  summaries: ManagedAssistantSummary[];
  localeKey: string;
  isLoading: boolean;
  error: ManagedReadError;
  onRetry: () => void;
  onSelect: (id: string) => void;
};

const localizedDescription = (summary: ManagedAssistantSummary, localeKey: string): string =>
  summary.assistant.description_i18n?.[localeKey] ??
  summary.assistant.description_i18n?.['en-US'] ??
  summary.assistant.description ??
  '';

const ManagedTeammateList: React.FC<ManagedTeammateListProps> = ({
  summaries,
  localeKey,
  isLoading,
  error,
  onRetry,
  onSelect,
}) => {
  const { t } = useTranslation();
  const [query, setQuery] = useState('');
  const [businessFunction, setBusinessFunction] = useState('all');

  const businessFunctions = useMemo(
    () => [...new Set(summaries.map((summary) => summary.governance.business_owner).filter(Boolean))].toSorted(),
    [summaries]
  );

  const filteredSummaries = useMemo(() => {
    const normalizedQuery = query.trim().toLowerCase();
    return summaries.filter((summary) => {
      if (businessFunction !== 'all' && summary.governance.business_owner !== businessFunction) return false;
      if (!normalizedQuery) return true;
      const searchableText = [
        resolveAssistantDisplayName(summary.assistant, localeKey, t, summary.assistant.name),
        localizedDescription(summary, localeKey),
        summary.governance.business_owner,
      ]
        .join(' ')
        .toLowerCase();
      return searchableText.includes(normalizedQuery);
    });
  }, [businessFunction, localeKey, query, summaries, t]);

  const groupedSummaries = useMemo(() => {
    const groups = new Map<string, ManagedAssistantSummary[]>();
    for (const summary of filteredSummaries) {
      const owner = summary.governance.business_owner;
      groups.set(owner, [...(groups.get(owner) ?? []), summary]);
    }
    return [...groups.entries()];
  }, [filteredSummaries]);

  if (isLoading) {
    return (
      <div className='flex min-h-240px items-center justify-center' aria-live='polite'>
        <Spin tip={t('settings.managedTeammates.loadingLibrary')} />
      </div>
    );
  }

  if (error) {
    const unauthorized = error === 'unauthorized';
    return (
      <Result
        status={unauthorized ? '403' : 'error'}
        title={
          unauthorized
            ? t('settings.managedTeammates.unauthorizedTitle')
            : t('settings.managedTeammates.loadErrorTitle')
        }
        subTitle={unauthorized ? t('settings.managedTeammates.unauthorizedBody') : undefined}
        extra={
          <Button type='primary' icon={<Refresh theme='outline' size={16} fill='currentColor' />} onClick={onRetry}>
            {t('common.retry')}
          </Button>
        }
      />
    );
  }

  return (
    <div className={styles.libraryShell}>
      <div>
        <h2 className='m-0 text-18px font-600 leading-26px text-t-primary'>
          {t('settings.managedTeammates.libraryTitle')}
        </h2>
        <p className='m-0 mt-4px text-14px leading-22px text-t-secondary'>
          {t('settings.managedTeammates.libraryLead')}
        </p>
      </div>

      {summaries.length === 0 ? (
        <div className='py-36px'>
          <Empty
            description={
              <div>
                <div className='text-14px font-600 text-t-primary'>
                  {t('settings.managedTeammates.libraryEmptyTitle')}
                </div>
                <div className='mt-6px text-13px leading-20px text-t-secondary'>
                  {t('settings.managedTeammates.libraryEmptyBody')}
                </div>
              </div>
            }
          />
        </div>
      ) : (
        <>
          <div className={`${styles.catalogToolbar} mt-20px`}>
            <Input
              value={query}
              onChange={setQuery}
              allowClear
              prefix={<Search theme='outline' size={16} fill='currentColor' />}
              placeholder={t('settings.managedTeammates.searchPlaceholder')}
            />
            <div className='min-w-0'>
              <div className='mb-4px text-12px font-500 text-t-secondary'>
                {t('settings.managedTeammates.filterLabel')}
              </div>
              <Select
                aria-label={t('settings.managedTeammates.filterLabel')}
                value={businessFunction}
                onChange={setBusinessFunction}
                className='w-full'
                options={[
                  { label: t('settings.managedTeammates.filterAll'), value: 'all' },
                  ...businessFunctions.map((owner) => ({ label: owner, value: owner })),
                ]}
              />
            </div>
          </div>

          {filteredSummaries.length === 0 ? (
            <div className='py-36px'>
              <Empty description={t('settings.managedTeammates.noResultsTitle')} />
            </div>
          ) : (
            <div className='mt-24px space-y-24px'>
              {groupedSummaries.map(([owner, group]) => (
                <section key={owner} className='min-w-0'>
                  <h3 className='m-0 mb-10px text-12px font-600 leading-18px text-t-secondary'>{owner}</h3>
                  <div className={styles.catalogGrid}>
                    {group.map((summary) => (
                      <Button
                        key={summary.assistant.id}
                        type='text'
                        className={`${styles.catalogCard} !h-auto !rounded-8px !border !border-solid !border-border-2 !bg-base !p-14px hover:!bg-fill-1`}
                        onClick={() => onSelect(summary.assistant.id)}
                      >
                        <div className={styles.catalogCardContent}>
                          <div className='flex min-w-0 items-start gap-10px'>
                            <AssistantAvatar assistant={summary.assistant} size={36} />
                            <div className='min-w-0 flex-1'>
                              <div className='text-14px font-600 leading-20px text-t-primary'>
                                {resolveAssistantDisplayName(summary.assistant, localeKey, t, summary.assistant.name)}
                              </div>
                              <div className='mt-3px line-clamp-2 text-13px leading-20px text-t-secondary'>
                                {localizedDescription(summary, localeKey)}
                              </div>
                            </div>
                          </div>
                          <div className='mt-12px flex min-w-0 flex-wrap items-center justify-between gap-8px'>
                            <span className='inline-flex min-w-0 items-center gap-5px text-12px font-500 text-primary-6'>
                              <Shield theme='outline' size={14} fill='currentColor' />
                              {t('settings.managedTeammates.sourceManaged')}
                            </span>
                            <span className='truncate text-12px text-t-tertiary'>
                              {summary.governance.business_owner}
                            </span>
                          </div>
                        </div>
                      </Button>
                    ))}
                  </div>
                </section>
              ))}
            </div>
          )}
        </>
      )}
    </div>
  );
};

export default ManagedTeammateList;
