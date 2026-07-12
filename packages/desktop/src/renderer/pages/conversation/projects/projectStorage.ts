/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import type {
  CreateForgeProjectInput,
  ForgeProject,
  UpdateForgeProjectInput,
} from '@/common/types/project/projectTypes';

import { dispatchProjectsChanged } from './projectEvents';

export const PROJECT_STORAGE_KEY = 'forge.projects.v1';

export type ProjectStorageLike = Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>;

export type ProjectMutationDeps = {
  storage?: ProjectStorageLike;
  now?: () => number;
  createId?: () => string;
};

const getDefaultStorage = (): ProjectStorageLike | null => {
  if (typeof window === 'undefined') {
    return null;
  }
  return window.localStorage;
};

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

const isForgeProject = (value: unknown): value is ForgeProject => {
  if (!isRecord(value)) {
    return false;
  }
  return (
    typeof value.id === 'string' &&
    typeof value.name === 'string' &&
    typeof value.workspace === 'string' &&
    typeof value.created_at === 'number' &&
    typeof value.updated_at === 'number' &&
    (value.last_opened_at === undefined || typeof value.last_opened_at === 'number')
  );
};

export const normalizeWorkspacePath = (workspace: string): string => workspace.trim().replace(/[\\/]+$/, '');

export const getWorkspaceBasename = (workspace: string): string => {
  const normalized = normalizeWorkspacePath(workspace);
  const parts = normalized.split(/[\\/]/).filter(Boolean);
  return parts.at(-1) ?? normalized;
};

const sortProjects = (projects: ForgeProject[]): ForgeProject[] =>
  [...projects].toSorted((a, b) => {
    const timeA = a.last_opened_at ?? a.updated_at;
    const timeB = b.last_opened_at ?? b.updated_at;
    if (timeA !== timeB) {
      return timeB - timeA;
    }
    return a.name.localeCompare(b.name);
  });

export const readProjects = (storage = getDefaultStorage()): ForgeProject[] => {
  if (!storage) {
    return [];
  }
  try {
    const raw = storage.getItem(PROJECT_STORAGE_KEY);
    if (!raw) {
      return [];
    }
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) {
      return [];
    }
    return sortProjects(parsed.filter(isForgeProject));
  } catch {
    return [];
  }
};

export const writeProjects = (projects: ForgeProject[], storage = getDefaultStorage()): void => {
  if (!storage) {
    return;
  }
  storage.setItem(PROJECT_STORAGE_KEY, JSON.stringify(sortProjects(projects)));
};

export const findProjectByWorkspace = (
  workspace: string,
  projects: ForgeProject[] = readProjects()
): ForgeProject | null => {
  const normalized = normalizeWorkspacePath(workspace);
  return projects.find((project) => normalizeWorkspacePath(project.workspace) === normalized) ?? null;
};

const defaultCreateId = (): string => {
  if (typeof crypto !== 'undefined' && 'randomUUID' in crypto) {
    return crypto.randomUUID();
  }
  return `project-${Date.now()}`;
};

export const createProject = (input: CreateForgeProjectInput, deps: ProjectMutationDeps = {}): ForgeProject => {
  const storage = deps.storage ?? getDefaultStorage();
  const now = deps.now ?? Date.now;
  const createId = deps.createId ?? defaultCreateId;
  const workspace = normalizeWorkspacePath(input.workspace);
  const name = input.name.trim() || getWorkspaceBasename(workspace);
  const projects = readProjects(storage);

  if (!workspace) {
    throw new Error('PROJECT_WORKSPACE_REQUIRED');
  }

  if (findProjectByWorkspace(workspace, projects)) {
    throw new Error('PROJECT_WORKSPACE_DUPLICATE');
  }

  const timestamp = now();
  const project: ForgeProject = {
    id: createId(),
    name,
    workspace,
    created_at: timestamp,
    updated_at: timestamp,
  };

  writeProjects([project, ...projects], storage);
  dispatchProjectsChanged();
  return project;
};

export const updateProject = (
  input: UpdateForgeProjectInput,
  deps: Omit<ProjectMutationDeps, 'createId'> = {}
): ForgeProject | null => {
  const storage = deps.storage ?? getDefaultStorage();
  const now = deps.now ?? Date.now;
  const projects = readProjects(storage);
  const target = projects.find((project) => project.id === input.id);
  if (!target) {
    return null;
  }

  const nextWorkspace = input.workspace !== undefined ? normalizeWorkspacePath(input.workspace) : target.workspace;
  const duplicate = projects.find(
    (project) => project.id !== input.id && normalizeWorkspacePath(project.workspace) === nextWorkspace
  );
  if (duplicate) {
    throw new Error('PROJECT_WORKSPACE_DUPLICATE');
  }

  const updated: ForgeProject = {
    ...target,
    ...(input.name !== undefined ? { name: input.name.trim() || getWorkspaceBasename(nextWorkspace) } : {}),
    workspace: nextWorkspace,
    ...(input.last_opened_at !== undefined ? { last_opened_at: input.last_opened_at } : {}),
    updated_at: now(),
  };

  writeProjects(
    projects.map((project) => (project.id === input.id ? updated : project)),
    storage
  );
  dispatchProjectsChanged();
  return updated;
};

export const removeProject = (projectId: string, storage = getDefaultStorage()): boolean => {
  const projects = readProjects(storage);
  const nextProjects = projects.filter((project) => project.id !== projectId);
  if (nextProjects.length === projects.length) {
    return false;
  }
  writeProjects(nextProjects, storage);
  dispatchProjectsChanged();
  return true;
};
