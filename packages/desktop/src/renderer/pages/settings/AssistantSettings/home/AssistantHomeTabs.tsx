/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import type { AssistantHomeTab, AssistantListItem } from '../types';
import type { AssistantListLoadResult } from '@/renderer/hooks/assistant/useAssistantList';
import ManagedLibrary from './ManagedLibrary';
import MyAssistantsList from './MyAssistantsList';
import OfficialAssistantsGrid from './OfficialAssistantsGrid';
import { useLayoutContext } from '@/renderer/hooks/context/LayoutContext';
import TalkToButlerButton from '@/renderer/components/base/TalkToButlerButton';
import { Alert, Tabs } from '@arco-design/web-react';
import classNames from 'classnames';
import React, { useCallback, useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';

type AssistantHomeTabsProps = {
  assistants: AssistantListItem[];
  localeKey: string;
  onOpenDetail: (assistant: AssistantListItem) => void;
  onOpenManagedDetail: (id: string) => void;
  onOpenSettings: (assistant: AssistantListItem) => void;
  onDuplicate: (assistant: AssistantListItem) => void;
  onDelete: (assistant: AssistantListItem) => void;
  onCreate: () => void;
  onToggleEnabled: (assistant: AssistantListItem, checked: boolean) => void;
  onReorder: (activeId: string, overId: string) => void | Promise<void>;
  onStartChat: (assistant: Pick<AssistantListItem, 'id'>) => void;
  onAdoptionChanged: () => Promise<AssistantListLoadResult>;
  initialManagedDetailId?: string | null;
  onManagedDetailConsumed?: () => void;
  initialTab?: AssistantHomeTab;
  onTabChange?: (tab: AssistantHomeTab) => void;
};

const AssistantHomeTabs: React.FC<AssistantHomeTabsProps> = ({
  assistants,
  localeKey,
  onOpenDetail,
  onOpenManagedDetail,
  onOpenSettings,
  onDuplicate,
  onDelete,
  onCreate,
  onToggleEnabled,
  onReorder,
  onStartChat,
  onAdoptionChanged,
  initialManagedDetailId,
  onManagedDetailConsumed,
  initialTab = 'mine',
  onTabChange,
}) => {
  const { t, i18n } = useTranslation();
  const layout = useLayoutContext();
  const isMobile = layout?.isMobile ?? false;
  const [tab, setTab] = useState<AssistantHomeTab>(initialTab);
  const [verifiedManagedAssistantIds, setVerifiedManagedAssistantIds] = useState<Set<string>>(
    () => new Set(assistants.filter((assistant) => assistant.source === 'managed').map((assistant) => assistant.id))
  );
  const managedVerificationSequenceRef = useRef(new Map<string, number>());

  useEffect(() => {
    setTab(initialTab);
  }, [initialTab]);

  useEffect(() => {
    const managedAssistantIds = assistants
      .filter((assistant) => assistant.source === 'managed')
      .map((assistant) => assistant.id);
    if (managedAssistantIds.length === 0) return;

    setVerifiedManagedAssistantIds((current) => {
      const next = new Set(current);
      managedAssistantIds.forEach((id) => next.add(id));
      return next;
    });
  }, [assistants]);

  const verifyManagedAssistantProjection = useCallback(
    async (id: string): Promise<AssistantListLoadResult> => {
      const nextSequence = (managedVerificationSequenceRef.current.get(id) ?? 0) + 1;
      managedVerificationSequenceRef.current.set(id, nextSequence);

      try {
        const result = await onAdoptionChanged();
        if (managedVerificationSequenceRef.current.get(id) === nextSequence) {
          const isVerified = result.ok && result.assistants.some((assistant) => assistant.id === id);
          setVerifiedManagedAssistantIds((current) => {
            const next = new Set(current);
            if (isVerified) {
              next.add(id);
            } else {
              next.delete(id);
            }
            return next;
          });
        }
        return result;
      } catch (error) {
        if (managedVerificationSequenceRef.current.get(id) === nextSequence) {
          setVerifiedManagedAssistantIds((current) => {
            const next = new Set(current);
            next.delete(id);
            return next;
          });
        }
        throw error;
      }
    },
    [onAdoptionChanged]
  );

  const selectTab = (next: AssistantHomeTab) => {
    setTab(next);
    onTabChange?.(next);
  };

  const openManagedDetail = (id: string) => {
    selectTab('library');
    onOpenManagedDetail(id);
  };

  return (
    <div
      data-testid='assistant-home-shell'
      dir={i18n.dir(localeKey)}
      className='flex h-full min-h-0 min-w-0 flex-col overflow-hidden bg-transparent'
    >
      <div
        className={`border-b border-border-2 bg-bg-0 ${isMobile ? 'px-16px pt-14px' : 'px-12px pt-24px md:px-40px md:pt-32px'}`}
      >
        <div className='mx-auto w-full max-w-800px'>
          <div className='flex w-full items-center justify-between gap-12px sm:gap-16px'>
            <h1
              className={classNames(
                'm-0 min-w-0 flex-1 font-bold text-t-primary',
                isMobile ? 'text-22px leading-[1.2]' : 'text-28px leading-[1.15]'
              )}
            >
              {t('settings.managedTeammates.pageTitle')}
            </h1>
            <TalkToButlerButton
              className='shrink-0'
              label={t('settings.managedTeammates.createTeammate')}
              chatLabel={t('settings.managedTeammates.createViaChat')}
              onManual={onCreate}
              manualLabel={t('settings.managedTeammates.createManually')}
              prompt={t('settings.managedTeammates.createPrompt')}
              data-testid='btn-create-assistant'
            />
          </div>
          <p className='m-0 mt-8px w-full text-14px leading-22px text-t-secondary'>
            {t('settings.managedTeammates.pageLead')}
          </p>
          <Tabs
            activeTab={tab}
            onChange={(key) => selectTab(key as AssistantHomeTab)}
            type='line'
            size='small'
            className='mt-12px [&_.arco-tabs-content]:!hidden [&_.arco-tabs-header-title]:![margin-inline-end:22px] [&_.arco-tabs-nav]:!overflow-x-auto'
          >
            <Tabs.TabPane
              key='mine'
              title={<span data-testid='assistant-tab-mine'>{t('settings.managedTeammates.tabMine')}</span>}
            />
            <Tabs.TabPane
              key='library'
              title={<span data-testid='assistant-tab-library'>{t('settings.managedTeammates.tabLibrary')}</span>}
            />
            <Tabs.TabPane
              key='official'
              title={<span data-testid='assistant-tab-official'>{t('settings.managedTeammates.tabOfficial')}</span>}
            />
          </Tabs>
        </div>
      </div>

      <div
        data-testid='assistant-home-body'
        className={`min-h-0 min-w-0 flex-1 overflow-auto ${isMobile ? 'px-16px pb-14px pt-14px' : 'px-12px pb-24px pt-18px md:px-40px'}`}
      >
        <div className='mx-auto min-w-0 w-full max-w-800px'>
          {tab === 'mine' ? (
            <MyAssistantsList
              assistants={assistants}
              localeKey={localeKey}
              onOpenDetail={onOpenDetail}
              onOpenManagedDetail={openManagedDetail}
              onDelete={onDelete}
              onToggleEnabled={onToggleEnabled}
              onReorder={onReorder}
              onStartChat={onStartChat}
              isManagedStartReady={(id) => verifiedManagedAssistantIds.has(id)}
              onGoOfficial={() => selectTab('official')}
            />
          ) : tab === 'library' ? (
            <ManagedLibrary
              localeKey={localeKey}
              initialDetailId={initialManagedDetailId}
              onInitialDetailConsumed={onManagedDetailConsumed}
              onAdoptionChanged={verifyManagedAssistantProjection}
              onStartChat={onStartChat}
            />
          ) : (
            <div className='min-w-0'>
              <Alert className='mb-14px' type='info' content={t('settings.managedTeammates.officialExplanation')} />
              <OfficialAssistantsGrid
                assistants={assistants}
                localeKey={localeKey}
                onOpenSettings={onOpenSettings}
                onDuplicate={onDuplicate}
                onToggleEnabled={onToggleEnabled}
                onStartChat={onStartChat}
              />
            </div>
          )}
        </div>
      </div>
    </div>
  );
};

export default AssistantHomeTabs;
