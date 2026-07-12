/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import ConversationSearchPopover from '@/renderer/pages/conversation/GroupedHistory/ConversationSearchPopover';
import { Button } from '@arco-design/web-react';
import { Earth, History, Star } from '@icon-park/react';
import classNames from 'classnames';
import React, { useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import { useNavigate } from 'react-router-dom';
import styles from '../index.module.css';

type QuickActionButtonsProps = {
  onOpenLink: (url: string) => void;
};

const toolbarButtonClass =
  '!h-34px !rounded-7px !border !border-border-2 !bg-bg-base !px-10px !text-13px !text-t-secondary hover:!bg-fill-2 hover:!text-t-primary';

const QuickActionButtons: React.FC<QuickActionButtonsProps> = ({ onOpenLink }) => {
  const { t } = useTranslation();
  const navigate = useNavigate();

  const handleOpenSaved = useCallback(() => {
    void navigate('/settings/skills');
  }, [navigate]);

  return (
    <div className={styles.guidQuickActions} role='toolbar' aria-label={t('guid.toolbar.label')}>
      <ConversationSearchPopover
        renderTrigger={({ onClick, isActive }) => (
          <Button
            className={classNames(toolbarButtonClass, isActive && '!bg-fill-2 !text-t-primary')}
            type='text'
            icon={<History theme='outline' size='16' />}
            onClick={onClick}
          >
            {t('guid.toolbar.history')}
          </Button>
        )}
      />
      <Button
        className={toolbarButtonClass}
        type='text'
        icon={<Star theme='outline' size='16' />}
        onClick={handleOpenSaved}
      >
        {t('guid.toolbar.saved')}
      </Button>
      <Button
        className={toolbarButtonClass}
        type='text'
        icon={<Earth theme='outline' size='16' />}
        onClick={() => onOpenLink('https://github.com/iOfficeAI/AionUi')}
      >
        {t('guid.toolbar.community')}
      </Button>
    </div>
  );
};

export default QuickActionButtons;
