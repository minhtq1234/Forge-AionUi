/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import { iconColors } from '@/renderer/styles/colors';
import { Button } from '@arco-design/web-react';
import { Close } from '@icon-park/react';
import React from 'react';
import { useTranslation } from 'react-i18next';
import { shouldShowDownload } from './previewToolbarUtils';

/**
 * PreviewToolbar 组件属性
 * PreviewToolbar component props
 */
type PreviewToolbarProps = {
  /**
   * 内容类型
   * Content type
   */
  content_type: string;

  /**
   * 是否为 Markdown 文件
   * Whether it's a Markdown file
   */
  isMarkdown: boolean;

  /**
   * 当前激活 tab 是否有未保存的修改，用于驱动 Save 控件的状态
   * Whether the active tab has unsaved changes; drives the Save control's state
   */
  isDirty?: boolean;

  /**
   * 保存当前激活 tab 的内容（Save 控件的点击回调）；未提供时不展示 Save 控件
   * Save the active tab's content (Save control's click handler); the Save
   * control is hidden when this is not provided
   */
  onSave?: () => void;

  /**
   * 是否为 HTML 文件
   * Whether it's an HTML file
   */
  isHTML: boolean;

  /**
   * 当前视图模式
   * Current view mode
   */
  viewMode: 'source' | 'preview';

  /**
   * 是否启用分屏模式
   * Whether split-screen mode is enabled
   */
  isSplitScreenEnabled: boolean;

  /**
   * 文件名
   * Filename
   */
  file_name?: string;

  /**
   * 是否显示"在系统中打开"按钮
   * Whether to show "Open in System" button
   */
  showOpenInSystemButton: boolean;

  /**
   * 设置视图模式
   * Set view mode
   */
  onViewModeChange: (mode: 'source' | 'preview') => void;

  /**
   * 设置分屏模式
   * Set split-screen mode
   */
  onSplitScreenToggle: () => void;

  /**
   * 在系统中打开文件
   * Open file in system
   */
  onOpenInSystem: () => void;

  /**
   * 下载文件
   * Download file
   */
  onDownload: () => void;

  /**
   * HTML 审核元素模式（仅HTML类型使用）
   * HTML inspect mode (only for HTML type)
   */
  inspectMode?: boolean;

  /**
   * 切换HTML审核元素模式（仅HTML类型使用）
   * Toggle HTML inspect mode (only for HTML type)
   */
  onInspectModeToggle?: () => void;

  /**
   * 左侧额外渲染内容
   * Extra content rendered on the left section
   */
  leftExtra?: React.ReactNode;

  /**
   * 右侧额外渲染内容
   * Extra content rendered on the right section
   */
  rightExtra?: React.ReactNode;

  /** Office artifact toolbar that fully replaces the generic preview toolbar. */
  officeToolbar?: React.ReactNode;
};

/**
 * 预览面板工具栏组件
 * Preview panel toolbar component
 *
 * 包含文件名、视图模式切换、下载按钮、关闭按钮等
 * Contains filename, view mode toggle, download button, close button, etc.
 */
// eslint-disable-next-line max-len
const PreviewToolbar: React.FC<PreviewToolbarProps> = ({
  content_type,
  isMarkdown,
  isHTML,
  isDirty,
  onSave,
  viewMode,
  isSplitScreenEnabled,
  file_name,
  showOpenInSystemButton,
  onViewModeChange,
  onSplitScreenToggle,
  onOpenInSystem,
  onDownload,
  inspectMode,
  onInspectModeToggle,
  leftExtra,
  rightExtra,
  officeToolbar,
}) => {
  const { t } = useTranslation();
  const isDiff = content_type === 'diff';
  const isCode = content_type === 'code';
  const showSaveControl = Boolean(onSave) && (isMarkdown || isHTML || isCode);
  const preferActionButtonsInFront = Boolean(leftExtra);
  // showOpenInSystemButton === Boolean(metadata.file_path) upstream — i.e. "file is on disk".
  const showDownload = shouldShowDownload(content_type, showOpenInSystemButton);

  const toolbarBtn =
    'flex items-center gap-2px px-8px py-3px rd-4px cursor-pointer transition-colors duration-150 text-12px font-medium text-t-secondary hover:text-t-primary hover:bg-bg-3';
  const toolbarBtnActive = '!text-white bg-brand hover:!text-white hover:bg-brand-hover';
  const toolbarIconSize = 12;

  if (officeToolbar) return <>{officeToolbar}</>;

  return (
    <div className='flex items-center justify-between h-32px px-10px bg-bg-2 flex-shrink-0 border-b border-border-1 overflow-x-auto'>
      <div className='flex items-center justify-between gap-8px w-full' style={{ minWidth: 'max-content' }}>
        {/* 左侧：Tabs（Markdown/HTML）+ 文件名 / Left: Tabs (Markdown/HTML) + Filename */}
        <div className='flex items-center h-full gap-8px'>
          {showSaveControl && (
            <div className='flex items-center gap-8px'>
              <div className='flex items-center gap-6px'>
                {isDirty ? (
                  <>
                    <span
                      data-testid='preview-toolbar-dirty-dot'
                      className='w-7px h-7px rd-full flex-shrink-0'
                      style={{ background: 'var(--primary)' }}
                    />
                    <span className='text-12px text-t-secondary'>{t('preview.office.editor.unsavedChanges')}</span>
                  </>
                ) : (
                  <span className='text-12px text-t-tertiary'>{t('preview.office.editor.saved')}</span>
                )}
              </div>
              <Button type={isDirty ? 'primary' : 'secondary'} size='mini' disabled={!isDirty} onClick={onSave}>
                {t('common.save')}
              </Button>
            </div>
          )}
          {(isMarkdown || isHTML || isDiff) && (
            <>
              <div className='flex items-center h-full gap-0'>
                <div
                  className={`flex items-center h-full px-10px cursor-pointer transition-all duration-150 text-12px font-medium ${viewMode === 'source' ? 'text-brand bg-aou-2 border-b-4 border-brand' : 'text-t-secondary hover:text-t-primary hover:bg-bg-3'}`}
                  onClick={() => {
                    try {
                      onViewModeChange('source');
                    } catch {
                      /* ignore */
                    }
                  }}
                >
                  {isHTML ? t('preview.code') : t('preview.source')}
                </div>
                <div
                  className={`flex items-center h-full px-10px cursor-pointer transition-all duration-150 text-12px font-medium ${viewMode === 'preview' ? 'text-brand bg-aou-2 border-b-4 border-brand' : 'text-t-secondary hover:text-t-primary hover:bg-bg-3'}`}
                  onClick={() => {
                    try {
                      onViewModeChange('preview');
                    } catch {
                      /* ignore */
                    }
                  }}
                >
                  {t('preview.preview')}
                </div>
              </div>
              {!isDiff && (
                <div
                  className={`flex items-center px-8px py-3px rd-4px cursor-pointer transition-colors duration-150 ${isSplitScreenEnabled ? toolbarBtnActive : 'text-t-secondary hover:bg-bg-3'}`}
                  onClick={() => {
                    try {
                      onSplitScreenToggle();
                    } catch {
                      /* ignore */
                    }
                  }}
                  title={isSplitScreenEnabled ? t('preview.closeSplitScreen') : t('preview.openSplitScreen')}
                >
                  <svg
                    width={toolbarIconSize}
                    height={toolbarIconSize}
                    viewBox='0 0 24 24'
                    fill='none'
                    stroke='currentColor'
                    strokeWidth='2'
                  >
                    <rect x='3' y='3' width='18' height='18' rx='2' />
                    <line x1='12' y1='3' x2='12' y2='21' />
                  </svg>
                </div>
              )}
            </>
          )}
          {preferActionButtonsInFront && showOpenInSystemButton && (
            <div className={toolbarBtn} onClick={onOpenInSystem} title={t('preview.openInSystemApp')}>
              <svg
                width={toolbarIconSize}
                height={toolbarIconSize}
                viewBox='0 0 24 24'
                fill='none'
                stroke='currentColor'
                strokeWidth='2'
                className='text-t-secondary'
              >
                <path d='M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6' />
                <polyline points='15 3 21 3 21 9' />
                <line x1='10' y1='14' x2='21' y2='3' />
              </svg>
              <span>{t('preview.openInSystemApp')}</span>
            </div>
          )}
          {preferActionButtonsInFront && showDownload && (
            <div className={toolbarBtn} onClick={() => void onDownload()} title={t('preview.downloadFile')}>
              <svg
                width={toolbarIconSize}
                height={toolbarIconSize}
                viewBox='0 0 24 24'
                fill='none'
                stroke='currentColor'
                strokeWidth='2'
                className='text-t-secondary'
              >
                <path d='M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4' />
                <polyline points='7 10 12 15 17 10' />
                <line x1='12' y1='15' x2='12' y2='3' />
              </svg>
              <span>{t('common.download')}</span>
            </div>
          )}
          {leftExtra}
        </div>

        <div className='flex items-center gap-4px flex-shrink-0'>
          {rightExtra}

          {!preferActionButtonsInFront && showOpenInSystemButton && (
            <div className={toolbarBtn} onClick={onOpenInSystem} title={t('preview.openInSystemApp')}>
              <svg
                width={toolbarIconSize}
                height={toolbarIconSize}
                viewBox='0 0 24 24'
                fill='none'
                stroke='currentColor'
                strokeWidth='2'
                className='text-t-secondary'
              >
                <path d='M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6' />
                <polyline points='15 3 21 3 21 9' />
                <line x1='10' y1='14' x2='21' y2='3' />
              </svg>
              <span>{t('preview.openInSystemApp')}</span>
            </div>
          )}

          {!preferActionButtonsInFront && showDownload && (
            <div className={toolbarBtn} onClick={() => void onDownload()} title={t('preview.downloadFile')}>
              <svg
                width={toolbarIconSize}
                height={toolbarIconSize}
                viewBox='0 0 24 24'
                fill='none'
                stroke='currentColor'
                strokeWidth='2'
                className='text-t-secondary'
              >
                <path d='M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4' />
                <polyline points='7 10 12 15 17 10' />
                <line x1='12' y1='15' x2='12' y2='3' />
              </svg>
              <span>{t('common.download')}</span>
            </div>
          )}

          {isHTML && onInspectModeToggle && (
            <div
              className={`${toolbarBtn} ${inspectMode ? toolbarBtnActive : ''}`}
              onClick={onInspectModeToggle}
              title={inspectMode ? t('preview.html.inspectElementDisable') : t('preview.html.inspectElementEnable')}
            >
              <svg
                width={toolbarIconSize}
                height={toolbarIconSize}
                viewBox='0 0 24 24'
                fill='none'
                stroke='currentColor'
                strokeWidth='2'
                strokeLinecap='round'
                strokeLinejoin='round'
                className={inspectMode ? 'text-white' : 'text-t-secondary'}
              >
                <path d='M3 3l7.07 16.97 2.51-7.39 7.39-2.51L3 3z' />
                <path d='M13 13l6 6' />
              </svg>
              <span>{inspectMode ? t('preview.html.inspecting') : t('preview.html.inspectElement')}</span>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};

export default PreviewToolbar;
