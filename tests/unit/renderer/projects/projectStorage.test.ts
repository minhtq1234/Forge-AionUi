/**
 * @vitest-environment node
 */

import { beforeEach, describe, expect, it } from 'vitest';
import {
  createProject,
  findProjectByWorkspace,
  readProjects,
  removeProject,
  updateProject,
  writeProjects,
  type ProjectStorageLike,
} from '@/renderer/pages/conversation/projects/projectStorage';

const makeStorage = (): ProjectStorageLike & { data: Map<string, string> } => {
  const data = new Map<string, string>();
  return {
    data,
    getItem: (key) => data.get(key) ?? null,
    setItem: (key, value) => {
      data.set(key, value);
    },
    removeItem: (key) => {
      data.delete(key);
    },
  };
};

describe('projectStorage', () => {
  let storage: ProjectStorageLike & { data: Map<string, string> };

  beforeEach(() => {
    storage = makeStorage();
  });

  it('creates normalized folder-backed project records', () => {
    const project = createProject(
      { name: 'Finance Close', workspace: '/Users/me/Finance Close/' },
      { storage, now: () => 1000, createId: () => 'project-1' }
    );

    expect(project).toEqual({
      id: 'project-1',
      name: 'Finance Close',
      workspace: '/Users/me/Finance Close',
      created_at: 1000,
      updated_at: 1000,
    });
    expect(readProjects(storage)).toEqual([project]);
  });

  it('blocks duplicate workspace projects', () => {
    createProject(
      { name: 'Finance Close', workspace: '/Users/me/Finance Close' },
      { storage, now: () => 1000, createId: () => 'project-1' }
    );

    expect(() =>
      createProject(
        { name: 'Finance Close Copy', workspace: '/Users/me/Finance Close/' },
        { storage, now: () => 2000, createId: () => 'project-2' }
      )
    ).toThrow('PROJECT_WORKSPACE_DUPLICATE');
  });

  it('updates names without renaming folders', () => {
    createProject(
      { name: 'Finance Close', workspace: '/Users/me/Finance Close' },
      { storage, now: () => 1000, createId: () => 'project-1' }
    );

    const updated = updateProject({ id: 'project-1', name: 'Monthly Close' }, { storage, now: () => 2000 });

    expect(updated?.name).toBe('Monthly Close');
    expect(updated?.workspace).toBe('/Users/me/Finance Close');
    expect(updated?.updated_at).toBe(2000);
  });

  it('finds projects by normalized workspace', () => {
    const project = createProject(
      { name: 'Finance Close', workspace: '/Users/me/Finance Close' },
      { storage, now: () => 1000, createId: () => 'project-1' }
    );

    expect(findProjectByWorkspace('/Users/me/Finance Close/', readProjects(storage))).toEqual(project);
  });

  it('removes only project metadata', () => {
    createProject(
      { name: 'Finance Close', workspace: '/Users/me/Finance Close' },
      { storage, now: () => 1000, createId: () => 'project-1' }
    );

    expect(removeProject('project-1', storage)).toBe(true);
    expect(readProjects(storage)).toEqual([]);
  });

  it('drops invalid stored payloads safely', () => {
    storage.setItem('forge.projects.v1', '{"bad":true}');
    expect(readProjects(storage)).toEqual([]);
  });

  it('writes sorted project records by last opened time then update time', () => {
    writeProjects(
      [
        { id: 'p1', name: 'Old', workspace: '/old', created_at: 1, updated_at: 1 },
        { id: 'p2', name: 'Recent', workspace: '/recent', created_at: 1, updated_at: 2, last_opened_at: 5 },
      ],
      storage
    );

    expect(readProjects(storage).map((project) => project.id)).toEqual(['p2', 'p1']);
  });
});
