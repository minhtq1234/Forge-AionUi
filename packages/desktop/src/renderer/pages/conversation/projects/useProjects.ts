/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import type { ForgeProject } from '@/common/types/project/projectTypes';
import { useCallback, useEffect, useState } from 'react';

import { PROJECTS_CHANGED_EVENT } from './projectEvents';
import { PROJECT_STORAGE_KEY, readProjects } from './projectStorage';

export type UseProjectsResult = {
  projects: ForgeProject[];
  refreshProjects: () => void;
};

export const useProjects = (): UseProjectsResult => {
  const [projects, setProjects] = useState<ForgeProject[]>(() => readProjects());

  const refreshProjects = useCallback(() => {
    setProjects(readProjects());
  }, []);

  useEffect(() => {
    const handleStorage = (event: StorageEvent) => {
      if (event.key === PROJECT_STORAGE_KEY) {
        refreshProjects();
      }
    };

    window.addEventListener(PROJECTS_CHANGED_EVENT, refreshProjects);
    window.addEventListener('storage', handleStorage);
    return () => {
      window.removeEventListener(PROJECTS_CHANGED_EVENT, refreshProjects);
      window.removeEventListener('storage', handleStorage);
    };
  }, [refreshProjects]);

  return { projects, refreshProjects };
};
