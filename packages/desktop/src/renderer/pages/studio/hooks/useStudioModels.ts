/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import { ipcBridge } from '@/common';
import type {
  StudioModelSelectionChange,
  StudioCommandResult,
  StudioRendererProject,
  StudioRouteCatalog,
  StudioUpdateModelSelectionRequest,
} from '@/common/types/project/creativeStudioTypes';
import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';

const STORAGE_ERROR_MESSAGE_KEY = 'conversation.creativeStudio.errors.storage';
const UPDATE_FAILED_MESSAGE_KEY = 'conversation.creativeStudio.models.updateFailed';

export type UseStudioModelsOptions = {
  project: StudioRendererProject | null;
  refetch: () => Promise<StudioRendererProject | null>;
  beforeMutation: () => Promise<boolean>;
};

export type UseStudioModelsResult = {
  catalog: StudioRouteCatalog | null;
  loading: boolean;
  errorMessageKey: string | null;
  pendingRole: 'storyboard' | 'image' | 'video' | null;
  refresh: () => Promise<void>;
  updateSelection: (input: StudioModelSelectionChange) => Promise<boolean>;
};

/**
 * Owns the project-scoped Studio model catalog and CAS selection mutations.
 *
 * Request identities prevent late project/catalog responses from replacing the
 * current view. Selection state is always re-read from the canonical project;
 * the renderer never applies an optimistic route preference.
 */
export const useStudioModels = ({
  project,
  refetch,
  beforeMutation,
}: UseStudioModelsOptions): UseStudioModelsResult => {
  const [catalog, setCatalog] = useState<StudioRouteCatalog | null>(null);
  const [loading, setLoading] = useState(project !== null);
  const [errorMessageKey, setErrorMessageKey] = useState<string | null>(null);
  const [pendingRole, setPendingRole] = useState<'storyboard' | 'image' | 'video' | null>(null);
  const mountedRef = useRef(true);
  const requestRef = useRef(0);
  const projectRef = useRef(project);
  const refetchRef = useRef(refetch);
  const beforeMutationRef = useRef(beforeMutation);
  const pendingRoleRef = useRef<'storyboard' | 'image' | 'video' | null>(null);

  useLayoutEffect(() => {
    projectRef.current = project;
    refetchRef.current = refetch;
    beforeMutationRef.current = beforeMutation;
  });

  const refresh = useCallback(async (): Promise<void> => {
    const current = projectRef.current;
    const request = ++requestRef.current;
    if (current === null) {
      if (mountedRef.current) {
        setCatalog(null);
        setLoading(false);
        setErrorMessageKey(null);
      }
      return;
    }

    if (mountedRef.current) {
      setLoading(true);
      setErrorMessageKey(null);
    }
    try {
      const result = await ipcBridge.creativeStudio.listRoutes.invoke({ projectId: current.id });
      if (!mountedRef.current || requestRef.current !== request || projectRef.current?.id !== current.id) return;
      if (result.ok === false) {
        setCatalog(null);
        setErrorMessageKey(result.error.messageKey);
        return;
      }
      setCatalog(result.data);
    } catch {
      if (mountedRef.current && requestRef.current === request && projectRef.current?.id === current.id) {
        setCatalog(null);
        setErrorMessageKey(STORAGE_ERROR_MESSAGE_KEY);
      }
    } finally {
      if (mountedRef.current && requestRef.current === request && projectRef.current?.id === current.id) {
        setLoading(false);
      }
    }
  }, []);

  useEffect(() => {
    requestRef.current += 1;
    setCatalog(null);
    setErrorMessageKey(null);
    setLoading(project !== null);
    void refresh();
  }, [project?.id, refresh]);

  useEffect(
    () => () => {
      mountedRef.current = false;
      requestRef.current += 1;
    },
    []
  );

  const updateSelection = useCallback(
    async (input: StudioModelSelectionChange): Promise<boolean> => {
      if (projectRef.current === null || pendingRoleRef.current !== null) return false;

      try {
        if (!(await beforeMutationRef.current())) return false;
      } catch {
        if (mountedRef.current) setErrorMessageKey(UPDATE_FAILED_MESSAGE_KEY);
        return false;
      }

      const current = projectRef.current;
      if (current === null || pendingRoleRef.current !== null) return false;
      pendingRoleRef.current = input.role;
      if (mountedRef.current) {
        setPendingRole(input.role);
        setErrorMessageKey(null);
      }

      try {
        const updateModelSelection = ipcBridge.creativeStudio.updateModelSelection.invoke as unknown as (
          request: StudioUpdateModelSelectionRequest
        ) => Promise<StudioCommandResult<StudioRendererProject>>;
        const result = await updateModelSelection({
          projectId: current.id,
          expectedRevision: current.revision,
          ...input,
        });
        if (result.ok === false) {
          if (result.error.code === 'stale_project') {
            const canonical = await refetchRef.current();
            if (canonical !== null) projectRef.current = canonical;
            await refresh();
            if (mountedRef.current) setErrorMessageKey(result.error.messageKey);
          } else if (mountedRef.current) {
            setErrorMessageKey(UPDATE_FAILED_MESSAGE_KEY);
          }
          return false;
        }

        const canonical = await refetchRef.current();
        if (canonical !== null) projectRef.current = canonical;
        await refresh();
        return true;
      } catch {
        if (mountedRef.current) setErrorMessageKey(UPDATE_FAILED_MESSAGE_KEY);
        return false;
      } finally {
        pendingRoleRef.current = null;
        if (mountedRef.current) setPendingRole(null);
      }
    },
    [refresh]
  );

  return { catalog, loading, errorMessageKey, pendingRole, refresh, updateSelection };
};
