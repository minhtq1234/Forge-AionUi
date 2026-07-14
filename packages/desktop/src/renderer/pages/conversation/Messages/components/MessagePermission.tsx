/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import type { IMessagePermission } from '@/common/chat/chatLib';
import { ipcBridge } from '@/common';
import { Button, Card, Typography } from '@arco-design/web-react';
import React, { useState } from 'react';
import { useTranslation } from 'react-i18next';

const { Text } = Typography;

interface MessagePermissionProps {
  message: IMessagePermission;
}

const actionIcons: Record<string, string> = {
  exec: '⚡',
  edit: '✏️',
  info: '📖',
  mcp: '🔌',
};

const MessagePermission: React.FC<MessagePermissionProps> = React.memo(({ message }) => {
  const { t } = useTranslation();
  const { options = [], description, title, action, call_id, command_type } = message.content || {};

  const [isResponding, setIsResponding] = useState(false);
  const [hasResponded, setHasResponded] = useState(false);

  const icon = actionIcons[action || ''] || '🔐';
  const displayTitle = title || description || t('messages.permissionRequest');
  const handleConfirm = async (selected: string) => {
    if (hasResponded || isResponding) return;

    setIsResponding(true);
    try {
      const always_allow = selected === 'proceed_always';
      await ipcBridge.conversation.confirmation.confirm.invoke({
        conversation_id: message.conversation_id,
        call_id,
        msg_id: message.msg_id || '',
        data: { value: selected },
        always_allow,
      });
      setHasResponded(true);
    } catch (error) {
      console.error('Error confirming permission:', error);
    } finally {
      setIsResponding(false);
    }
  };

  return (
    <Card className='mb-4' bordered={false} style={{ background: 'var(--bg-1)' }} data-testid='message-permission-card'>
      <div className='space-y-4'>
        <div className='flex items-center space-x-2'>
          <span className='text-2xl'>{icon}</span>
          <Text className='block'>{displayTitle}</Text>
        </div>
        {description && description !== displayTitle && (
          <div>
            <Text className='text-xs text-t-secondary'>{description}</Text>
          </div>
        )}
        {!hasResponded && (
          <>
            <div className='mt-10px'>{t('messages.chooseAction')}</div>
            {options.length > 0 ? (
              <div className='flex flex-wrap gap-8px'>
                {options.map((option, index) => {
                  const value = String(option.value);
                  const isDeny = /deny|reject|cancel|no/i.test(value);
                  return (
                    <Button
                      key={value || `option_${index}`}
                      type={isDeny ? 'secondary' : 'primary'}
                      size='small'
                      disabled={isResponding}
                      onClick={() => void handleConfirm(value)}
                      data-testid={`message-permission-option-${value || `option_${index}`}`}
                    >
                      {t(option.label, { ...option.params, defaultValue: option.label })}
                    </Button>
                  );
                })}
              </div>
            ) : (
              <Text type='secondary'>{t('messages.noOptionsAvailable')}</Text>
            )}
          </>
        )}
        {hasResponded && (
          <div
            className='mt-10px p-2 rounded-md border'
            style={{ backgroundColor: 'var(--color-success-light-1)', borderColor: 'rgb(var(--success-3))' }}
          >
            <Text className='text-sm' style={{ color: 'rgb(var(--success-6))' }}>
              ✓ {t('messages.responseSentSuccessfully')}
            </Text>
          </div>
        )}
      </div>
    </Card>
  );
});

export default MessagePermission;
