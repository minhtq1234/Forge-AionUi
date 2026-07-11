import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { createRef } from 'react';
import { describe, expect, it, vi } from 'vitest';
import React from 'react';

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string) => {
      const translations: Record<string, string> = {
        'preview.closeTabTitle': 'Close tab',
        'preview.collapsePanel': 'Collapse panel',
        'preview.unsavedChangesTitle': 'Unsaved changes',
      };
      return translations[key] ?? key;
    },
  }),
}));

import PreviewTabs from '@/renderer/pages/conversation/Preview/components/PreviewPanel/PreviewTabs';

const tabs = [
  { id: 'tab-1', title: 'report.docx', contentType: 'word' as const },
  { id: 'tab-2', title: 'forecast.xlsx', contentType: 'excel' as const, isDirty: true },
  { id: 'tab-3', title: 'notes.md', contentType: 'markdown' as const },
];

const renderTabs = () => {
  const onSwitchTab = vi.fn();
  const onCloseTab = vi.fn();
  const onClosePanel = vi.fn();
  render(
    <PreviewTabs
      tabs={tabs}
      activeTabId='tab-1'
      tabFadeState={{ left: false, right: false }}
      tabsContainerRef={createRef<HTMLDivElement>()}
      onSwitchTab={onSwitchTab}
      onCloseTab={onCloseTab}
      onContextMenu={vi.fn()}
      onClosePanel={onClosePanel}
    />
  );
  return { onSwitchTab, onCloseTab, onClosePanel };
};

describe('PreviewTabs', () => {
  it('establishes the container used by its narrow title rule', () => {
    const css = readFileSync(
      path.join(
        process.cwd(),
        'packages/desktop/src/renderer/pages/conversation/Preview/components/PreviewPanel/PreviewTabs.module.css'
      ),
      'utf8'
    );

    expect(css).toMatch(/\.tabsRoot\s*\{[^}]*container-type:\s*inline-size;/s);
  });

  it('shows file-type badges and a stable active and unsaved hierarchy', () => {
    renderTabs();

    expect(screen.getAllByTestId('preview-tab-type').map((badge) => badge.textContent)).toEqual(['DOCX', 'XLSX', 'MD']);
    expect(screen.getByRole('tab', { name: /report\.docx/i }).closest('[data-active]')).toHaveAttribute(
      'data-active',
      'true'
    );
    expect(screen.getByRole('tab', { name: /forecast\.xlsx/i }).closest('[data-active]')).toHaveAttribute(
      'data-active',
      'false'
    );
    expect(screen.getByTestId('preview-tab-dirty')).toHaveAttribute('title', 'Unsaved changes');
  });

  it('supports roving focus and explicit keyboard activation with tab semantics', async () => {
    const user = userEvent.setup();
    const { onSwitchTab } = renderTabs();
    const tablist = screen.getByRole('tablist');
    const renderedTabs = screen.getAllByRole('tab');

    expect(tablist).toContainElement(renderedTabs[0]);
    expect(renderedTabs[0]).toHaveAttribute('aria-selected', 'true');
    expect(renderedTabs[0]).toHaveAttribute('tabindex', '0');
    expect(renderedTabs[1]).toHaveAttribute('tabindex', '-1');

    renderedTabs[0].focus();
    await user.keyboard('{ArrowRight}');
    expect(renderedTabs[1]).toHaveFocus();
    expect(onSwitchTab).not.toHaveBeenCalled();

    await user.keyboard('{Enter}');
    expect(onSwitchTab).toHaveBeenLastCalledWith('tab-2');
    await user.keyboard('{End}');
    expect(renderedTabs[2]).toHaveFocus();
    await user.keyboard('{Space}');
    expect(onSwitchTab).toHaveBeenLastCalledWith('tab-3');

    await user.keyboard('{Home}');
    expect(renderedTabs[0]).toHaveFocus();
    await user.keyboard('{ArrowLeft}');
    expect(renderedTabs[2]).toHaveFocus();
  });

  it('closes a tab without activating it and exposes translated icon controls', async () => {
    const user = userEvent.setup();
    const { onSwitchTab, onCloseTab, onClosePanel } = renderTabs();

    await user.click(screen.getAllByRole('button', { name: 'Close tab' })[1]);
    expect(onCloseTab).toHaveBeenCalledWith('tab-2');
    expect(onSwitchTab).not.toHaveBeenCalled();

    await user.click(screen.getByRole('button', { name: 'Collapse panel' }));
    expect(onClosePanel).toHaveBeenCalledOnce();
  });
});
