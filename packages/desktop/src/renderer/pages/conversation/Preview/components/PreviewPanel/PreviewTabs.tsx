/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import { iconColors } from '@/renderer/styles/colors';
import type { PreviewContentType } from '@/common/types/office/preview';
import { Button, Tooltip } from '@arco-design/web-react';
import { Close } from '@icon-park/react';
import { IconShrink } from '@arco-design/web-react/icon';
import classNames from 'classnames';
import React from 'react';
import { useTranslation } from 'react-i18next';
import type { TabFadeState } from '../../hooks/useTabOverflow';
import styles from './PreviewTabs.module.css';

/**
 * Tab 信息
 * Tab information
 */
export interface PreviewTab {
  /**
   * Tab ID
   */
  id: string;

  /**
   * Tab 标题
   * Tab title
   */
  title: string;

  /**
   * 是否有未保存的修改
   * Whether there are unsaved changes
   */
  isDirty?: boolean;

  /** Preview content type used for the compact file badge. */
  contentType?: PreviewContentType;
}

const CONTENT_TYPE_LABELS: Record<PreviewContentType, string> = {
  markdown: 'MD',
  diff: 'DIFF',
  code: 'CODE',
  html: 'HTML',
  pdf: 'PDF',
  ppt: 'PPTX',
  word: 'DOCX',
  excel: 'XLSX',
  image: 'IMG',
  url: 'URL',
};

/**
 * PreviewTabs 组件属性
 * PreviewTabs component props
 */
interface PreviewTabsProps {
  /**
   * Tabs 列表
   * Tabs list
   */
  tabs: PreviewTab[];

  /**
   * 当前活动的 Tab ID
   * Current active tab ID
   */
  activeTabId: string | null;

  /**
   * Tab 渐变状态（左右溢出指示器）
   * Tab fade state (left/right overflow indicators)
   */
  tabFadeState: TabFadeState;

  /**
   * Tabs 容器引用
   * Tabs container ref
   */
  tabsContainerRef: React.RefObject<HTMLDivElement>;

  /**
   * 切换 Tab 回调
   * Switch tab callback
   */
  onSwitchTab: (tabId: string) => void;

  /**
   * 关闭 Tab 回调
   * Close tab callback
   */
  onCloseTab: (tabId: string) => void;

  /**
   * Tab 右键菜单回调
   * Tab context menu callback
   */
  onContextMenu: (e: React.MouseEvent, tabId: string) => void;

  /**
   * 关闭预览面板回调
   * Close preview panel callback
   */
  onClosePanel?: () => void;
}

/**
 * 预览面板 Tabs 栏组件
 * Preview panel tabs bar component
 *
 * 显示多个 Tab，支持切换、关闭和右键菜单
 * Displays multiple tabs, supports switching, closing, and context menu
 *
 * 包含左右渐变指示器，提示用户可以滚动查看更多 Tab
 * Includes left/right gradient indicators to prompt users that more tabs can be scrolled
 */
const PreviewTabs: React.FC<PreviewTabsProps> = ({
  tabs,
  activeTabId,
  tabFadeState,
  tabsContainerRef,
  onSwitchTab,
  onCloseTab,
  onContextMenu,
  onClosePanel,
}) => {
  const { t } = useTranslation();
  const { left: showLeftFade, right: showRightFade } = tabFadeState;

  const focusTab = (index: number) => {
    const tabElements = tabsContainerRef.current?.querySelectorAll<HTMLElement>('[role="tab"]');
    tabElements?.[index]?.focus();
  };

  const handleTabKeyDown = (event: React.KeyboardEvent, index: number, tabId: string) => {
    let nextIndex: number | null = null;
    if (event.key === 'ArrowLeft') nextIndex = (index - 1 + tabs.length) % tabs.length;
    if (event.key === 'ArrowRight') nextIndex = (index + 1) % tabs.length;
    if (event.key === 'Home') nextIndex = 0;
    if (event.key === 'End') nextIndex = tabs.length - 1;

    if (nextIndex !== null) {
      event.preventDefault();
      focusTab(nextIndex);
      return;
    }

    if (event.key === 'Enter' || event.key === ' ' || event.key === 'Space' || event.key === 'Spacebar') {
      event.preventDefault();
      onSwitchTab(tabId);
    }
  };

  return (
    <div className={styles.tabsRoot}>
      <div className={styles.tabsRow}>
        {/* Tabs 滚动区域 / Tabs scroll area */}
        <div ref={tabsContainerRef} role='tablist' className={styles.tabList}>
          {tabs.length > 0 ? (
            tabs.map((tab, index) => {
              const isActive = tab.id === activeTabId;
              return (
                <div
                  key={tab.id}
                  className={styles.tabItem}
                  data-active={isActive}
                  onContextMenu={(e) => onContextMenu(e, tab.id)}
                >
                  <Button
                    type='text'
                    role='tab'
                    aria-selected={isActive}
                    tabIndex={isActive ? 0 : -1}
                    className={styles.tabButton}
                    onClick={() => onSwitchTab(tab.id)}
                    onKeyDown={(event) => handleTabKeyDown(event, index, tab.id)}
                  >
                    <span className={styles.tabContent}>
                      {tab.contentType && (
                        <span data-testid='preview-tab-type' data-type={tab.contentType} className={styles.typeBadge}>
                          {CONTENT_TYPE_LABELS[tab.contentType]}
                        </span>
                      )}
                      <span className={styles.tabTitle}>{tab.title}</span>
                      {tab.isDirty && (
                        <span
                          data-testid='preview-tab-dirty'
                          className={styles.dirtyDot}
                          title={t('preview.unsavedChangesTitle')}
                        />
                      )}
                    </span>
                  </Button>
                  <Tooltip content={t('preview.closeTabTitle')}>
                    <Button
                      type='text'
                      size='mini'
                      aria-label={t('preview.closeTabTitle')}
                      icon={<Close theme='outline' size='14' fill={iconColors.secondary} />}
                      className={styles.closeButton}
                      onClick={(event) => {
                        event.stopPropagation();
                        onCloseTab(tab.id);
                      }}
                    />
                  </Tooltip>
                </div>
              );
            })
          ) : (
            <div className='text-12px text-t-tertiary px-10px'>{t('preview.noTabs')}</div>
          )}
        </div>

        {/* 收起面板按钮 / Collapse panel button */}
        {onClosePanel && (
          <div className={styles.panelActions}>
            <Tooltip content={t('preview.collapsePanel')}>
              <Button
                type='text'
                size='mini'
                aria-label={t('preview.collapsePanel')}
                icon={<IconShrink style={{ fontSize: 14, color: iconColors.secondary }} />}
                className={styles.panelButton}
                onClick={onClosePanel}
              />
            </Tooltip>
          </div>
        )}
      </div>

      {/* 左侧渐变指示器 / Left gradient indicator */}
      {showLeftFade && <div className={classNames(styles.fade, styles.fadeLeft)} />}

      {/* 右侧渐变指示器 / Right gradient indicator */}
      {showRightFade && <div className={classNames(styles.fade, styles.fadeRight)} />}
    </div>
  );
};

export default PreviewTabs;
