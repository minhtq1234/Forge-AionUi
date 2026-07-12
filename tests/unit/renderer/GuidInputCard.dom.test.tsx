import { render, screen } from '@testing-library/react';
import React from 'react';
import { describe, expect, it, vi } from 'vitest';
import GuidInputCard from '@/renderer/pages/guid/components/GuidInputCard';

vi.mock('@/renderer/hooks/context/LayoutContext', () => ({
  useLayoutContext: () => ({ isMobile: false }),
}));

vi.mock('@/renderer/hooks/chat/useCompositionInput', () => ({
  useCompositionInput: () => ({
    compositionHandlers: {},
    isComposing: { current: false },
  }),
}));

vi.mock('@/renderer/components/media/FilePreview', () => ({
  default: () => null,
}));

vi.mock('@/renderer/components/media/UploadProgressBar', () => ({
  default: () => null,
}));

vi.mock('@/renderer/pages/guid/components/GuidWorkspaceFootnote', () => ({
  default: () => <div data-testid='composer-context'>Project context</div>,
}));

describe('GuidInputCard', () => {
  it('places project context above the message field inside the composer', () => {
    render(
      <GuidInputCard
        input=''
        onInputChange={vi.fn()}
        onKeyDown={vi.fn()}
        onPaste={vi.fn()}
        onFocus={vi.fn()}
        onBlur={vi.fn()}
        placeholder='Message'
        isInputActive={false}
        isFileDragging={false}
        activeBorderColor='#000'
        inactiveBorderColor='#ccc'
        activeShadow='none'
        dragHandlers={{}}
        files={[]}
        onRemoveFile={vi.fn()}
        actionRow={<div>Actions</div>}
        workspaceDir='/Users/me/Finance Close'
        onSelectWorkspace={vi.fn()}
        onClearWorkspace={vi.fn()}
      />
    );

    const context = screen.getByTestId('composer-context');
    const messageField = screen.getByPlaceholderText('Message');

    expect(context.compareDocumentPosition(messageField)).toBe(Node.DOCUMENT_POSITION_FOLLOWING);
    expect(context.parentElement).toContainElement(messageField);
  });
});
