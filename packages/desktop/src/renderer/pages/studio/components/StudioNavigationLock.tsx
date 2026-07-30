/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useCallback, useContext, useEffect, useLayoutEffect } from 'react';
import { UNSAFE_DataRouterContext, UNSAFE_NavigationContext, useBeforeUnload, useBlocker } from 'react-router-dom';

type StudioNavigationLockProps = {
  locked: boolean;
};

const DataRouterNavigationLock: React.FC<StudioNavigationLockProps> = ({ locked }) => {
  const blocker = useBlocker(locked);

  useEffect(() => {
    if (!locked && blocker.state === 'blocked') blocker.reset();
  }, [blocker, locked]);

  return null;
};

const DeclarativeRouterNavigationLock: React.FC<StudioNavigationLockProps> = ({ locked }) => {
  const { navigator } = useContext(UNSAFE_NavigationContext);

  useLayoutEffect(() => {
    if (!locked) return;

    const originalPush = navigator.push;
    const originalReplace = navigator.replace;
    const originalGo = navigator.go;
    const blockedPush: typeof navigator.push = () => {};
    const blockedReplace: typeof navigator.replace = () => {};
    const blockedGo: typeof navigator.go = () => {};
    navigator.push = blockedPush;
    navigator.replace = blockedReplace;
    navigator.go = blockedGo;

    const lockedHref = window.location.href;
    const lockedState = window.history.state;
    const lockedIndex = typeof lockedState?.idx === 'number' ? lockedState.idx : null;
    let restoringPop = false;

    const stopPop = (event: PopStateEvent): void => {
      event.preventDefault();
      event.stopImmediatePropagation();
    };

    const handlePopState = (event: PopStateEvent): void => {
      stopPop(event);
      if (restoringPop) {
        restoringPop = false;
        return;
      }

      const nextIndex = typeof event.state?.idx === 'number' ? event.state.idx : null;
      if (lockedIndex !== null && nextIndex !== null && nextIndex !== lockedIndex) {
        restoringPop = true;
        window.history.go(lockedIndex - nextIndex);
        return;
      }

      window.history.replaceState(lockedState, '', lockedHref);
    };

    window.addEventListener('popstate', handlePopState, true);
    return () => {
      window.removeEventListener('popstate', handlePopState, true);
      if (navigator.push === blockedPush) navigator.push = originalPush;
      if (navigator.replace === blockedReplace) navigator.replace = originalReplace;
      if (navigator.go === blockedGo) navigator.go = originalGo;
    };
  }, [locked, navigator]);

  return null;
};

/**
 * Keeps renderer-only scene drafts alive until persistence succeeds or the user
 * explicitly resolves the visible recovery state.
 */
export const StudioNavigationLock: React.FC<StudioNavigationLockProps> = ({ locked }) => {
  const dataRouterContext = useContext(UNSAFE_DataRouterContext);
  const handleBeforeUnload = useCallback(
    (event: BeforeUnloadEvent) => {
      if (!locked) return;
      event.preventDefault();
      event.returnValue = '';
    },
    [locked]
  );
  useBeforeUnload(handleBeforeUnload);

  return dataRouterContext === null ? (
    <DeclarativeRouterNavigationLock locked={locked} />
  ) : (
    <DataRouterNavigationLock locked={locked} />
  );
};
