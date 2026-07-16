/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Type definitions for message tool results
 * 消息工具结果类型定义
 */

import type {
  IMessageAcpToolCall,
  IMessagePlan,
  IMessageThinking,
  IMessageToolCall,
  IMessageToolGroup,
} from '@/common/chat/chatLib';

export type WorkJournalSourceMessage =
  | IMessagePlan
  | IMessageThinking
  | IMessageToolGroup
  | IMessageAcpToolCall
  | IMessageToolCall;

export interface ImageGenerationResult {
  img_url?: string;
  relative_path?: string;
  error?: string;
}

export interface WriteFileResult {
  file_diff: string;
  file_name: string;
  [key: string]: unknown;
}
