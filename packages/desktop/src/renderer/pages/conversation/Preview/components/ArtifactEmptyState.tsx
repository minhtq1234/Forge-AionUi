import { FileText } from '@icon-park/react';
import React from 'react';
import { useTranslation } from 'react-i18next';
import styles from './ArtifactEmptyState.module.css';

const ArtifactEmptyState: React.FC = () => {
  const { t } = useTranslation();
  return (
    <div className={styles.root}>
      <FileText theme='outline' size='28' className={styles.icon} />
      <div className={styles.title}>{t('conversation.artifact.emptyTitle')}</div>
      <div className={styles.hint}>{t('conversation.artifact.emptyHint')}</div>
    </div>
  );
};

export default ArtifactEmptyState;
