/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import type { OfficeArtifactEdit, OfficeArtifactInspection } from '@/common/types/office/artifactEditor';
import { copyText } from '@/renderer/utils/ui/clipboard';
import { Button, Dropdown, Menu, Typography } from '@arco-design/web-react';
import { Attention, Down } from '@icon-park/react';
import React, { useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { OfficeSelectionEditor } from './OfficeSelectionEditor';
import type { OfficeArtifactEditorStatus, OfficeSelectionDirection } from './useOfficeArtifactEditor';
import styles from './OfficeArtifactToolbar.module.css';

export type OfficeArtifactToolbarProps = {
  documentKind: 'word' | 'excel';
  inspection: OfficeArtifactInspection | null;
  status: OfficeArtifactEditorStatus;
  undoDepth: number;
  apply: (edit: OfficeArtifactEdit) => Promise<boolean> | boolean | void;
  undo: () => Promise<boolean> | boolean | void;
  openInDesktopApp: () => Promise<boolean> | boolean | void;
  download: () => void;
  revealInFolder: () => void;
  refresh: () => void;
  moveSelection: (direction: OfficeSelectionDirection) => void;
};

const ICON_SIZE = 16;

const STATUS_KEYS: Partial<Record<OfficeArtifactEditorStatus, string>> = {
  inspecting: 'preview.office.editor.inspecting',
  saving: 'preview.office.editor.saving',
  saved: 'preview.office.editor.saved',
  saveFailed: 'preview.office.editor.saveFailed',
  fileChanged: 'preview.office.editor.fileChanged',
  openedDesktop: 'preview.office.editor.openedDesktop',
};

export const OfficeArtifactToolbar: React.FC<OfficeArtifactToolbarProps> = ({
  documentKind,
  inspection,
  status,
  undoDepth,
  apply,
  undo,
  openInDesktopApp,
  download,
  revealInFolder,
  refresh,
  moveSelection,
}) => {
  const { t } = useTranslation();
  const toolbarRef = useRef<HTMLDivElement>(null);
  const [draft, setDraft] = useState('');
  const busy = status === 'saving' || status === 'openingDesktop';
  const unsupported =
    inspection !== null &&
    (inspection.kind === 'word'
      ? !inspection.canReplace && !inspection.canFormat
      : inspection.cells.length !== 1 || !inspection.canEdit);
  const statusKey = STATUS_KEYS[status];
  const statusText = statusKey
    ? t(statusKey)
    : inspection === null
      ? ''
      : unsupported
        ? t(
            documentKind === 'word'
              ? 'preview.office.editor.selectWordToEdit'
              : 'preview.office.editor.selectExcelToEdit'
          )
        : t('preview.office.editor.readyToEdit');
  const statusIsError = status === 'saveFailed' || status === 'fileChanged';
  const recoveryText =
    status === 'fileChanged'
      ? t('preview.office.editor.conflictRecovery')
      : status === 'saveFailed'
        ? t('preview.office.editor.saveFailureRecovery')
        : null;
  const statusTone = statusIsError
    ? styles.statusError
    : status === 'saving' || status === 'inspecting'
      ? styles.statusProgress
      : status === 'saved' || status === 'openedDesktop' || (status === 'ready' && inspection && !unsupported)
        ? styles.statusSuccess
        : styles.statusNeutral;

  const actionsMenu = (
    <Menu className={styles.actionsMenu}>
      <Menu.Item key='undo' disabled={undoDepth <= 0 || busy} onClick={() => void undo()}>
        {t('preview.office.editor.undo')}
      </Menu.Item>
      <Menu.Item key='download' onClick={download}>
        {t('common.download')}
      </Menu.Item>
      <Menu.Item key='reveal' onClick={revealInFolder}>
        {t('preview.office.editor.reveal')}
      </Menu.Item>
      <Menu.Item key='refresh' onClick={refresh}>
        {t('preview.office.editor.refresh')}
      </Menu.Item>
    </Menu>
  );

  return (
    <div ref={toolbarRef} className={styles.toolbarFrame} data-testid='office-artifact-toolbar'>
      {statusText && (
        <div className={`${styles.statusStrip} ${statusTone}`} data-testid='office-toolbar-status-strip'>
          <span className={styles.statusMarker} aria-hidden='true' />
          <Typography.Text
            className={statusIsError ? styles.errorStatus : inspection ? styles.status : styles.zeroState}
            aria-live='polite'
            role={statusIsError && !recoveryText ? 'alert' : undefined}
            ellipsis
          >
            {statusText}
          </Typography.Text>
        </div>
      )}
      <div className={styles.toolbar} data-testid='office-toolbar-actions'>
        <div className={styles.leftActions}>
          <OfficeSelectionEditor
            inspection={inspection}
            status={status}
            apply={apply}
            moveSelection={moveSelection}
            onDraftChange={setDraft}
          />
        </div>
        <div className={styles.rightActions}>
          <Button.Group>
            <Button
              type='secondary'
              size='small'
              loading={status === 'openingDesktop'}
              data-testid='office-toolbar-open-desktop'
              className={styles.actionButton}
              onClick={() => void openInDesktopApp()}
            >
              {t('preview.office.editor.openDesktop')}
            </Button>
            <Dropdown trigger='click' position='br' droplist={actionsMenu} getPopupContainer={() => document.body}>
              <Button
                type='secondary'
                size='small'
                aria-label={t('preview.office.editor.more')}
                icon={<Down size={ICON_SIZE} />}
                className={styles.iconButton}
                data-testid='office-toolbar-more'
              />
            </Dropdown>
          </Button.Group>
        </div>
      </div>
      {recoveryText && (
        <div className={styles.recoveryBanner} role='alert'>
          <Attention size={16} className={styles.recoveryIcon} />
          <Typography.Text className={styles.recoveryText}>{recoveryText}</Typography.Text>
          <div className={styles.recoveryActions}>
            <Button
              type='text'
              size='small'
              disabled={!draft}
              onClick={() => void copyText(draft).catch((): undefined => undefined)}
            >
              {t('preview.office.editor.copyDraft')}
            </Button>
            <Button type='text' size='small' onClick={refresh}>
              {t('preview.office.editor.refreshLatest')}
            </Button>
            <Button type='secondary' size='small' onClick={() => void openInDesktopApp()}>
              {t('preview.office.editor.openDesktop')}
            </Button>
          </div>
        </div>
      )}
    </div>
  );
};
