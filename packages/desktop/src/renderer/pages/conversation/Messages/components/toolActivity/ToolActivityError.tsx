/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import { Attention } from '@icon-park/react';
import { theme } from '@office-ai/platform';
import React from 'react';
import type { CoalescedStep } from '@/common/chat/toolActivity/types';
import { useToolActionText } from './useToolActionText';

const ToolActivityError: React.FC<{ step: CoalescedStep }> = ({ step }) => {
  const action = useToolActionText();
  return (
    <div className='bg-message-tips rd-8px p-x-12px p-y-10px flex items-start gap-6px'>
      <Attention
        theme='filled'
        size='16'
        strokeLinejoin='bevel'
        className='m-t-2px'
        fill={theme.Color.FunctionalColor.error}
      />
      <div className='flex-1 min-w-0 flex flex-col gap-4px'>
        <div className='font-500 text-t-primary [word-break:break-word]'>{action.failedTitle(step)}</div>
        <div className='text-t-secondary whitespace-break-spaces [word-break:break-word]'>{action.suggestion()}</div>
      </div>
    </div>
  );
};

export default ToolActivityError;
