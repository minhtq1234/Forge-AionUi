/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import { ipcBridge } from '@/common';
import type { StudioRendererProject } from '@/common/types/project/creativeStudioTypes';
import { useCallback, useEffect, useRef, useState } from 'react';

export type UseStudioProjectResult = {
  project: StudioRendererProject | null;
  loading: boolean;
  notFound: boolean;
  errorMessageKey: string | null;
  refetch: () => Promise<StudioRendererProject | null>;
};

/** Resolves one durable Studio project and keeps it current through the native event stream. */
export const useStudioProject = (projectId: string | undefined): UseStudioProjectResult => {
  const [project, setProject] = useState<StudioRendererProject | null>(null);
  const [loading, setLoading] = useState(Boolean(projectId));
  const [notFound, setNotFound] = useState(false);
  const [errorMessageKey, setErrorMessageKey] = useState<string | null>(null);
  const [resolvedProjectId, setResolvedProjectId] = useState<string | undefined>();
  const generationRef = useRef(0);
  const latestRequestRef = useRef(0);
  const projectRef = useRef<StudioRendererProject | null>(null);

  const loadProject = useCallback(
    async (requestedProjectId: string, generation: number, initial: boolean): Promise<StudioRendererProject | null> => {
      const request = ++latestRequestRef.current;

      if (initial) {
        setLoading(true);
        projectRef.current = null;
        setProject(null);
        setNotFound(false);
        setResolvedProjectId(undefined);
      }
      setErrorMessageKey(null);

      try {
        const result = await ipcBridge.creativeStudio.getProject.invoke({ projectId: requestedProjectId });
        if (generationRef.current !== generation || latestRequestRef.current !== request) return null;

        if (result.ok === false) {
          setErrorMessageKey(result.error.messageKey);
          return null;
        }
        if (result.data === null) {
          projectRef.current = null;
          setProject(null);
          setNotFound(true);
          return null;
        }

        const current = projectRef.current;
        const canonical =
          current?.id === result.data.id && current.revision > result.data.revision ? current : result.data;
        projectRef.current = canonical;
        setProject(canonical);
        setNotFound(false);
        return canonical;
      } catch {
        if (generationRef.current === generation && latestRequestRef.current === request) {
          setErrorMessageKey('conversation.creativeStudio.errors.storage');
        }
        return null;
      } finally {
        if (generationRef.current === generation && latestRequestRef.current === request) {
          setResolvedProjectId(requestedProjectId);
          setLoading(false);
        }
      }
    },
    []
  );

  useEffect(() => {
    const generation = generationRef.current + 1;
    generationRef.current = generation;

    if (!projectId) {
      projectRef.current = null;
      setProject(null);
      setLoading(false);
      setNotFound(false);
      setErrorMessageKey(null);
      setResolvedProjectId(undefined);
      return;
    }

    const unsubscribe = ipcBridge.creativeStudio.projectUpdated.on(({ projectId: updatedProjectId }) => {
      if (updatedProjectId === projectId) void loadProject(projectId, generation, false);
    });
    void loadProject(projectId, generation, true);

    return () => {
      if (generationRef.current === generation) generationRef.current += 1;
      unsubscribe();
    };
  }, [loadProject, projectId]);

  const refetch = useCallback(async (): Promise<StudioRendererProject | null> => {
    if (!projectId) return null;
    return loadProject(projectId, generationRef.current, false);
  }, [loadProject, projectId]);

  const resolvedForCurrentProject = resolvedProjectId === projectId;
  const currentProject = project?.id === projectId ? project : null;

  return {
    project: currentProject,
    loading: Boolean(projectId) && (loading || !resolvedForCurrentProject),
    notFound: resolvedForCurrentProject && notFound,
    errorMessageKey,
    refetch,
  };
};
