/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import type { DragEndEvent } from '@dnd-kit/core';
import type { AssistantListItem } from '../types';
import type { ManagedAssistantSummary } from '@/common/types/agent/managedAssistantTypes';
import { type AssistantEnabledFilter, filterByEnabled, groupMyAssistants } from '../assistantUtils';
import MyAssistantRow from './MyAssistantRow';
import { DndContext, PointerSensor, closestCenter, useSensor, useSensors } from '@dnd-kit/core';
import { SortableContext, verticalListSortingStrategy } from '@dnd-kit/sortable';
import { useTalkToButler } from '@/renderer/hooks/assistant/useTalkToButler';
import { Dropdown, Menu, Button } from '@arco-design/web-react';
import { Down } from '@icon-park/react';
import React, { useCallback, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';

type MyAssistantsListProps = {
  assistants: AssistantListItem[];
  localeKey: string;
  onOpenDetail: (assistant: AssistantListItem) => void;
  onOpenManagedDetail: (id: string) => void;
  onDelete: (assistant: AssistantListItem) => void;
  onToggleEnabled: (assistant: AssistantListItem, checked: boolean) => void;
  onReorder: (activeId: string, overId: string) => void | Promise<void>;
  onStartChat: (assistant: AssistantListItem) => void;
  isManagedStartReady: (id: string) => boolean;
  managedSummaries: ManagedAssistantSummary[];
  /** Switch to the Official tab (to duplicate an official assistant). */
  onGoOfficial: () => void;
};

const FILTER_OPTIONS: AssistantEnabledFilter[] = ['all', 'enabled', 'disabled'];

const MyAssistantsList: React.FC<MyAssistantsListProps> = ({
  assistants,
  localeKey,
  onOpenDetail,
  onOpenManagedDetail,
  onDelete,
  onToggleEnabled,
  onReorder,
  onStartChat,
  isManagedStartReady,
  managedSummaries,
  onGoOfficial,
}) => {
  const { t } = useTranslation();
  const talkToButler = useTalkToButler();
  const [filter, setFilter] = useState<AssistantEnabledFilter>('all');

  // "Create via chat": hand off to the AionUi Butler on the home page with a
  // ready-made create-an-assistant prompt (same flow as the header action).
  const handleCreateViaChat = () => {
    void talkToButler({
      prompt: t('settings.managedTeammates.createPrompt'),
    });
  };
  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 8 } }));

  // Drag reorder is only meaningful in the unfiltered "all" view; a filtered
  // view hides rows, so dragging would produce an ambiguous global order.
  const draggable = filter === 'all';

  const { managedAssistants, cliAssistants, createdAssistants } = useMemo(() => {
    const filtered = filterByEnabled(assistants, filter);
    return groupMyAssistants(filtered);
  }, [assistants, filter]);
  const managedSummaryById = useMemo(
    () => new Map(managedSummaries.map((summary) => [summary.assistant.id, summary])),
    [managedSummaries]
  );

  const handleDragEnd = useCallback(
    (event: DragEndEvent) => {
      const { active, over } = event;
      if (!draggable || !over || active.id === over.id) return;
      void onReorder(String(active.id), String(over.id));
    },
    [draggable, onReorder]
  );

  const filterMenu = (
    <Menu onClickMenuItem={(key) => setFilter(key as AssistantEnabledFilter)}>
      {FILTER_OPTIONS.map((option) => (
        <Menu.Item key={option} data-testid={`filter-option-${option}`}>
          {t(`settings.assistantFilter.${option}`, {
            defaultValue: option === 'all' ? 'All' : option === 'enabled' ? 'Enabled' : 'Disabled',
          })}
        </Menu.Item>
      ))}
    </Menu>
  );

  const renderGroup = (title: string, list: AssistantListItem[], testId: string, barClass: string) => {
    if (list.length === 0) return null;
    return (
      <div className='mt-20px first:mt-0' data-testid={testId}>
        <div className='mb-10px flex items-center gap-8px px-2px'>
          <span className={`h-13px w-3px rounded-2px ${barClass}`} />
          <span className='text-12px font-600 text-t-secondary'>{title}</span>
          <span className='rounded-999px bg-fill-2 px-6px py-1px text-12px font-500 text-t-quaternary'>
            {list.length}
          </span>
        </div>
        <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={handleDragEnd}>
          <SortableContext items={list.map((a) => a.id)} strategy={verticalListSortingStrategy}>
            <div className='space-y-8px'>
              {list.map((assistant) => (
                <MyAssistantRow
                  key={assistant.id}
                  assistant={assistant}
                  localeKey={localeKey}
                  draggable={draggable}
                  onOpenDetail={onOpenDetail}
                  onOpenManagedDetail={onOpenManagedDetail}
                  onDelete={onDelete}
                  onToggleEnabled={onToggleEnabled}
                  onStartChat={onStartChat}
                />
              ))}
            </div>
          </SortableContext>
        </DndContext>
      </div>
    );
  };

  // The "created by me" group shows a guiding empty state when the user has
  // no custom assistants yet (only in the unfiltered view — a filtered empty
  // just means "no matches", not "none exist").
  const createdEmpty = createdAssistants.length === 0 && filter === 'all';

  const renderCreatedEmpty = () => (
    <div
      className='flex flex-col items-center rounded-8px border border-dashed border-border-2 bg-fill-1/40 px-20px py-28px text-center'
      data-testid='created-empty'
    >
      <div className='mb-6px text-14px font-600 text-t-primary'>{t('settings.managedTeammates.customEmptyTitle')}</div>
      <p className='mb-16px max-w-360px text-14px leading-22px text-t-secondary'>
        {t('settings.managedTeammates.customEmptyBody')}
      </p>
      <div className='flex items-center gap-10px'>
        <Button
          type='primary'
          size='small'
          className='!rounded-8px'
          onClick={handleCreateViaChat}
          data-testid='created-empty-create'
        >
          {t('settings.managedTeammates.createViaChat')}
        </Button>
        <Button size='small' className='!rounded-8px' onClick={onGoOfficial} data-testid='created-empty-official'>
          {t('settings.managedTeammates.browseOfficial')}
        </Button>
      </div>
    </div>
  );

  return (
    <div data-testid='my-assistants-pane'>
      <div className='mb-4px flex items-center justify-end'>
        <Dropdown droplist={filterMenu} trigger='click' position='br'>
          <Button
            size='mini'
            data-testid='assistant-enabled-filter'
            className='!flex !items-center !gap-4px !rounded-8px'
          >
            <span>
              {t(`settings.assistantFilter.${filter}`, {
                defaultValue: filter === 'all' ? 'All' : filter === 'enabled' ? 'Enabled' : 'Disabled',
              })}
            </span>
            <Down theme='outline' size={12} fill='currentColor' />
          </Button>
        </Dropdown>
      </div>

      {managedAssistants.length > 0 ? (
        <div className='mt-20px first:mt-0' data-testid='group-managed'>
          <div className='mb-10px flex items-center gap-8px px-2px'>
            <span className='h-13px w-3px rounded-2px bg-primary-5' />
            <span className='text-12px font-600 text-t-secondary'>{t('settings.managedTeammates.sourceManaged')}</span>
            <span className='rounded-999px bg-fill-2 px-6px py-1px text-12px font-500 text-t-quaternary'>
              {managedAssistants.length}
            </span>
          </div>
          <div className='space-y-8px'>
            {managedAssistants.map((assistant) => (
              <MyAssistantRow
                key={assistant.id}
                assistant={assistant}
                localeKey={localeKey}
                draggable={false}
                onOpenDetail={onOpenDetail}
                onOpenManagedDetail={onOpenManagedDetail}
                onDelete={onDelete}
                onToggleEnabled={onToggleEnabled}
                onStartChat={onStartChat}
                managedSummary={managedSummaryById.get(assistant.id)}
                managedStartReady={isManagedStartReady(assistant.id) && managedSummaryById.has(assistant.id)}
              />
            ))}
          </div>
        </div>
      ) : null}

      {renderGroup(t('settings.managedTeammates.groupCli'), cliAssistants, 'group-cli', 'bg-warning-5')}

      {/* Created-by-me group: show its rows, or a guiding empty state when the
          user has no custom assistants yet. */}
      <div className='mt-20px' data-testid='group-created-section'>
        <div className='mb-10px flex items-center gap-8px px-2px'>
          <span className='h-13px w-3px rounded-2px bg-primary-5' />
          <span className='text-12px font-600 text-t-secondary'>{t('settings.managedTeammates.sourceCreated')}</span>
          {createdAssistants.length > 0 ? (
            <span className='rounded-999px bg-fill-2 px-6px py-1px text-12px font-500 text-t-quaternary'>
              {createdAssistants.length}
            </span>
          ) : null}
        </div>
        {createdEmpty ? (
          renderCreatedEmpty()
        ) : (
          <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={handleDragEnd}>
            <SortableContext items={createdAssistants.map((a) => a.id)} strategy={verticalListSortingStrategy}>
              <div className='space-y-8px'>
                {createdAssistants.map((assistant) => (
                  <MyAssistantRow
                    key={assistant.id}
                    assistant={assistant}
                    localeKey={localeKey}
                    draggable={draggable}
                    onOpenDetail={onOpenDetail}
                    onOpenManagedDetail={onOpenManagedDetail}
                    onDelete={onDelete}
                    onToggleEnabled={onToggleEnabled}
                    onStartChat={onStartChat}
                  />
                ))}
              </div>
            </SortableContext>
          </DndContext>
        )}
      </div>
    </div>
  );
};

export default MyAssistantsList;
