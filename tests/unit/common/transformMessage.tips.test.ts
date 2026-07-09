/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, expect, it } from 'vitest';
import type { IResponseMessage } from '@/common/adapter/ipcBridge';
import { transformMessage } from '@/common/chat/chatLib';

const tip = (content: string, type: 'success' | 'info' | 'warning' | 'error' = 'success'): IResponseMessage => ({
  type: 'tips',
  data: { content, type },
  msg_id: 'tip-1',
  conversation_id: 'conv-1',
});

describe('transformMessage — aioncore diagnostic tips are filtered out', () => {
  it('drops "Token watermark override" telemetry tips', () => {
    expect(
      transformMessage(tip('Token watermark override: provider=0, local_estimate=19756, using=19756'))
    ).toBeUndefined();
  });

  it('drops tips carrying a local_estimate token accounting line', () => {
    expect(transformMessage(tip('provider=0, local_estimate=20198, using=20198'))).toBeUndefined();
  });

  it('keeps ordinary user-facing tips untouched', () => {
    const result = transformMessage(tip('Your report is ready to download.'));
    expect(result).toBeDefined();
    expect(result?.type).toBe('tips');
    expect((result as { content: { content: string } }).content.content).toBe('Your report is ready to download.');
  });
});
