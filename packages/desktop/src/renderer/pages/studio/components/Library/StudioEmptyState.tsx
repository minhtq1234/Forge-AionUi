/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import { Button, Empty } from '@arco-design/web-react';
import { Add } from '@icon-park/react';
import React from 'react';
import { useTranslation } from 'react-i18next';

import styles from './StudioLibrary.module.css';

type StudioEmptyStateProps = {
  disabled?: boolean;
  onCreate: () => void;
};

const StudioEmptyState: React.FC<StudioEmptyStateProps> = ({ disabled = false, onCreate }) => {
  const { t } = useTranslation();

  return (
    <div className={styles.empty}>
      <h2 className={styles.emptyTitle}>{t('conversation.creativeStudio.empty.title')}</h2>
      <Empty description={t('conversation.creativeStudio.empty.body')} icon={<Add size='40' />} />
      <Button type='primary' icon={<Add />} disabled={disabled} onClick={onCreate}>
        {t('conversation.creativeStudio.empty.create')}
      </Button>
    </div>
  );
};

export default StudioEmptyState;
