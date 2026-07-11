/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import { Button } from '@arco-design/web-react';
import { BranchOne, Down, FolderOpen, Right } from '@icon-park/react';
import type { TFunction } from 'i18next';
import React from 'react';

type ProjectPanel = 'files' | 'changes';

type WorkspaceProjectMenuProps = {
  t: TFunction;
  open: boolean;
  activePanel: ProjectPanel | null;
  changeCount: number;
  onToggle: () => void;
  onSelectPanel: (panel: ProjectPanel) => void;
  filesPanel: React.ReactNode;
  changesPanel: React.ReactNode;
};

type WorkspaceProjectMenuItem = {
  key: ProjectPanel;
  label: string;
  meta?: string;
  icon: React.ReactNode;
};

const WorkspaceProjectMenu: React.FC<WorkspaceProjectMenuProps> = ({
  t,
  open,
  activePanel,
  changeCount,
  onToggle,
  onSelectPanel,
  filesPanel,
  changesPanel,
}) => {
  const rootRef = React.useRef<HTMLDivElement>(null);

  React.useEffect(() => {
    if (!open) return;

    const getMenuItems = () => Array.from(rootRef.current?.querySelectorAll<HTMLElement>('[role="menuitem"]') ?? []);

    const handlePointerDown = (event: PointerEvent) => {
      if (event.target instanceof Node && !rootRef.current?.contains(event.target)) {
        onToggle();
      }
    };

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        onToggle();
        rootRef.current?.querySelector<HTMLElement>('.workspace-project-trigger')?.focus();
        return;
      }

      if (!['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key)) return;
      if (!(document.activeElement instanceof HTMLElement)) return;
      if (document.activeElement.getAttribute('role') !== 'menuitem') return;
      const menuItems = getMenuItems();
      if (menuItems.length === 0) return;
      event.preventDefault();

      const activeIndex = menuItems.findIndex((item) => item === document.activeElement);
      if (event.key === 'Home') {
        menuItems[0]?.focus();
        return;
      }
      if (event.key === 'End') {
        menuItems.at(-1)?.focus();
        return;
      }

      const direction = event.key === 'ArrowDown' ? 1 : -1;
      const nextIndex = activeIndex < 0 ? (direction > 0 ? 0 : menuItems.length - 1) : activeIndex + direction;
      menuItems[(nextIndex + menuItems.length) % menuItems.length]?.focus();
    };

    document.addEventListener('pointerdown', handlePointerDown);
    document.addEventListener('keydown', handleKeyDown);
    getMenuItems()[0]?.focus();

    return () => {
      document.removeEventListener('pointerdown', handlePointerDown);
      document.removeEventListener('keydown', handleKeyDown);
    };
  }, [onToggle, open]);

  const items: WorkspaceProjectMenuItem[] = [
    {
      key: 'files',
      label: t('conversation.workspace.changes.filesTab'),
      icon: <FolderOpen theme='outline' size='17' />,
    },
    {
      key: 'changes',
      label: t('conversation.workspace.changes.tab'),
      meta: changeCount > 0 ? String(changeCount > 99 ? '99+' : changeCount) : undefined,
      icon: <BranchOne theme='outline' size='17' />,
    },
  ];

  const activeItem = items.find((item) => item.key === activePanel);
  const activePanelContent = activePanel === 'files' ? filesPanel : activePanel === 'changes' ? changesPanel : null;

  return (
    <div ref={rootRef} className='workspace-project-menu-root'>
      <div className='workspace-project-trigger-row'>
        <Button
          className='workspace-project-trigger'
          aria-expanded={open}
          aria-label={t('conversation.workspace.projectMenu.trigger')}
          onClick={onToggle}
        >
          <FolderOpen theme='outline' size='16' />
          <span>{t('conversation.workspace.projectMenu.trigger')}</span>
          <Down theme='outline' size='14' className={open ? 'workspace-project-trigger-chevron is-open' : undefined} />
        </Button>
      </div>

      {open && (
        <div className='workspace-project-overlay'>
          {activeItem && activePanelContent && (
            <div className={`workspace-project-flyout workspace-project-flyout-${activeItem.key}`}>
              <div className='workspace-project-flyout-body'>{activePanelContent}</div>
            </div>
          )}

          <div className='workspace-project-menu-popover' role='menu'>
            <div className='workspace-project-menu-title'>{t('conversation.workspace.projectMenu.trigger')}</div>
            {items.map((item) => (
              <React.Fragment key={item.key}>
                {item.key === 'changes' && <div className='workspace-project-menu-separator' />}
                <Button
                  role='menuitem'
                  tabIndex={-1}
                  className={
                    activePanel === item.key
                      ? 'workspace-project-menu-item workspace-project-menu-item-active'
                      : 'workspace-project-menu-item'
                  }
                  onClick={() => onSelectPanel(item.key)}
                >
                  <span className='workspace-project-menu-icon'>{item.icon}</span>
                  <span className='workspace-project-menu-label'>{item.label}</span>
                  {item.meta && <span className='workspace-project-menu-badge'>{item.meta}</span>}
                  {item.key === 'files' && <Right theme='outline' size='15' className='workspace-project-menu-arrow' />}
                </Button>
              </React.Fragment>
            ))}
          </div>
        </div>
      )}
    </div>
  );
};

export default WorkspaceProjectMenu;
