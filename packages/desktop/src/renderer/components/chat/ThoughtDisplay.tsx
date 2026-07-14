/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import { Spin } from '@arco-design/web-react';
import React, { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import './SendBox/sendbox.css';

export interface ThoughtData {
  subject: string;
  description: string;
}

interface ThoughtDisplayProps {
  thought?: ThoughtData;
  style?: 'default' | 'compact';
  running?: boolean;
  onStop?: () => void;
}

const ThoughtDisplay: React.FC<ThoughtDisplayProps> = ({
  thought,
  style = 'default',
  running = false,
  onStop: _onStop,
}) => {
  const { t } = useTranslation();

  // Format elapsed time with localized units
  const formatElapsedTime = (seconds: number): string => {
    const sUnit = t('common.unit.second_short', { defaultValue: 's' });
    const mUnit = t('common.unit.minute_short', { defaultValue: 'm' });

    if (seconds < 60) {
      return `${seconds}${sUnit}`;
    }
    const minutes = Math.floor(seconds / 60);
    const remainingSeconds = seconds % 60;
    return `${minutes}${mUnit} ${remainingSeconds}${sUnit}`;
  };

  const [elapsedTime, setElapsedTime] = useState(0);
  const startTimeRef = useRef<number>(Date.now());
  const hasActivity = running || Boolean(thought?.subject);

  // Timer for elapsed time
  useEffect(() => {
    if (!hasActivity) {
      setElapsedTime(0);
      return;
    }

    startTimeRef.current = Date.now();
    setElapsedTime(0);

    const timer = setInterval(() => {
      const elapsed = Math.floor((Date.now() - startTimeRef.current) / 1000);
      setElapsedTime(elapsed);
    }, 1000);

    return () => clearInterval(timer);
  }, [hasActivity]);

  const className = [
    'thought-display',
    running ? 'thought-display--running' : '',
    style === 'compact' ? 'thought-display--compact' : '',
  ]
    .filter(Boolean)
    .join(' ');

  if (!hasActivity) {
    return null;
  }

  const isFallbackActivity = !thought?.subject;
  const rawActivityLabel = thought?.subject || t('conversation.thinking.label');
  const activityLabel = isFallbackActivity ? rawActivityLabel.replace(/(?:\.\.\.|…)\s*$/, '') : rawActivityLabel;
  const showDescription = Boolean(thought?.description && thought.description !== thought.subject);
  const showElapsedTime = running && elapsedTime >= 5;
  const activityKey = `${activityLabel}:${thought?.description ?? ''}`;

  return (
    <div data-testid='thought-display' className={className} role='status' aria-live='polite'>
      <div className='thought-display__content' key={activityKey}>
        {running && <Spin size={14} />}
        <span className='thought-display__label'>{activityLabel}</span>
        {running && isFallbackActivity && (
          <span data-testid='thought-display-dots' className='thought-display__dots' aria-hidden='true'>
            <span />
            <span />
            <span />
          </span>
        )}
        {showDescription && <span className='thought-display__description'>{thought?.description}</span>}
        {showElapsedTime && <span className='thought-display__elapsed'>{formatElapsedTime(elapsedTime)}</span>}
      </div>
    </div>
  );
};

export default ThoughtDisplay;
