/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs';
import { rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, expectTypeOf, it } from 'vitest';
import type {
  CreateStudioProjectInput,
  StudioAsset,
  StudioCommandResult,
  StudioDesktopApi,
  StudioJob,
  StudioProject,
  StudioProjectSummary,
  StudioProviderRef,
  StudioRouteCatalog,
} from '@/common/types/project/creativeStudioTypes';
import { createCreativeStudioStore, type CreativeStudioStore } from '@process/services/creative-studio/store';

const makeInput = (overrides: Partial<CreateStudioProjectInput> = {}): CreateStudioProjectInput => ({
  name: 'Launch film',
  brief: 'A short launch story',
  aspectRatio: '16:9',
  targetDurationSeconds: 12,
  resolution: '1080p',
  ...overrides,
});

const cloneProject = (project: StudioProject): StudioProject => structuredClone(project);

const addScene = (project: StudioProject, id: string, durationSeconds = 1): StudioProject => {
  const next = cloneProject(project);
  next.scenes[id] = {
    id,
    title: `Scene ${id}`,
    purpose: 'Test scene',
    visualPrompt: 'A safe test scene',
    narration: '',
    onScreenText: '',
    mediaKind: 'image',
    durationSeconds,
    referenceAssetId: null,
    selectedAssetId: null,
    assetIds: [],
    jobIds: [],
    reviewState: 'draft',
  };
  next.sceneOrder.push(id);
  return next;
};

const addSucceededJob = (project: StudioProject): StudioProject => {
  const next = addScene(project, 'scene_1');
  next.assets.asset_1 = {
    id: 'asset_1',
    projectId: next.id,
    sceneId: 'scene_1',
    mediaKind: 'image',
    mimeType: 'image/png',
    managedAsset: { collection: 'assets', fileName: 'asset_1.png' },
    byteSize: 1,
    createdAt: next.createdAt,
  };
  next.jobs.job_1 = {
    id: 'job_1',
    projectId: next.id,
    sceneId: 'scene_1',
    status: 'succeeded',
    provider: { providerId: 'provider_1', adapterId: 'weprompt-image-v1', model: 'model_1' },
    idempotencyKey: 'key_1',
    providerJobId: null,
    outputAssetIds: [],
    error: null,
    createdAt: next.createdAt,
    updatedAt: next.updatedAt,
  };
  next.scenes.scene_1.assetIds = ['asset_1'];
  next.scenes.scene_1.jobIds = ['job_1'];
  return next;
};

describe('creative studio project store', () => {
  let rootDir: string;
  let store: CreativeStudioStore;
  let clock: number;
  let idCounter: number;

  beforeEach(() => {
    rootDir = mkdtempSync(path.join(tmpdir(), 'creative-studio-store-'));
    clock = 1_700_000_000_000;
    idCounter = 0;
    store = createCreativeStudioStore({
      rootDir,
      now: () => new Date((clock += 1_000)).toISOString(),
      createId: () => `project_${++idCounter}`,
    });
  });

  afterEach(() => {
    rmSync(rootDir, { recursive: true, force: true });
  });

  it('creates a durable project at revision 1 instead of returning an unwritten draft', async () => {
    const project = await store.createProject(makeInput());

    expect(project.revision).toBe(1);
    expect(project.schemaVersion).toBe(1);
    expect(await store.getProject(project.id)).toEqual(project);
  });

  it('increments revision for each successful mutation instead of silently replacing a project', async () => {
    const project = await store.createProject(makeInput());
    const renamed = await store.updateProject(project.id, (current) => ({ ...current, name: 'Revised launch film' }));
    const revisedAgain = await store.updateProject(renamed.id, (current) => ({ ...current, brief: 'A revised story' }));

    expect(renamed.revision).toBe(2);
    expect(revisedAgain.revision).toBe(3);
  });

  it('rejects a late compare-and-set update instead of overwriting a newer edit', async () => {
    const project = await store.createProject(makeInput());
    await store.updateProject(project.id, (current) => ({ ...current, name: 'Newer edit' }), project.revision);

    await expect(
      store.updateProject(project.id, (current) => ({ ...current, name: 'Stale edit' }), project.revision)
    ).rejects.toMatchObject({ code: 'stale_project' });
  });

  describe('project timing validation', () => {
    it.each([4, 61, 12.5])(
      'rejects target duration %s instead of persisting an out-of-range project target',
      async (target) => {
        await expect(store.createProject(makeInput({ targetDurationSeconds: target }))).rejects.toMatchObject({
          code: 'invalid_payload',
        });
      }
    );

    it.each([0, 61, 1.5])(
      'rejects scene duration %s instead of treating scene timing as project timing',
      async (duration) => {
        const project = await store.createProject(makeInput());

        await expect(
          store.updateProject(project.id, (current) => addScene(current, 'scene_1', duration))
        ).rejects.toMatchObject({
          code: 'invalid_payload',
        });
      }
    );

    it('allows a temporary scene-total mismatch because only the later review gate owns exact-total validation', async () => {
      const project = await store.createProject(makeInput({ targetDurationSeconds: 12 }));
      const edited = await store.updateProject(project.id, (current) => addScene(current, 'scene_1', 3));

      expect(edited.scenes.scene_1.durationSeconds).toBe(3);
    });
  });

  describe('project graph validation', () => {
    it('rejects duplicate scene-order IDs instead of allowing a scene to render twice', async () => {
      const project = await store.createProject(makeInput());

      await expect(
        store.updateProject(project.id, (current) => {
          const next = addScene(current, 'scene_1');
          next.sceneOrder.push('scene_1');
          return next;
        })
      ).rejects.toMatchObject({ code: 'invalid_payload' });
    });

    it('rejects a missing scene-order ID instead of silently dropping a stored scene', async () => {
      const project = await store.createProject(makeInput());

      await expect(
        store.updateProject(project.id, (current) => {
          const next = addScene(current, 'scene_1');
          next.sceneOrder = [];
          return next;
        })
      ).rejects.toMatchObject({ code: 'invalid_payload' });
    });

    it('rejects traversal IDs instead of creating project-controlled paths outside the store root', async () => {
      await expect(store.createProject({ ...makeInput(), id: '../outside' })).rejects.toMatchObject({
        code: 'invalid_payload',
      });
    });
  });

  it('returns summaries newest-first instead of relying on filesystem iteration order', async () => {
    const older = await store.createProject(makeInput({ name: 'Older' }));
    const newer = await store.createProject(makeInput({ name: 'Newer' }));
    await store.updateProject(older.id, (current) => ({ ...current, name: 'Newest after edit' }));

    expect((await store.listProjects()).map((summary) => summary.id)).toEqual([older.id, newer.id]);
  });

  it('repairs a stale summary index from project manifests instead of hiding durable projects', async () => {
    const project = await store.createProject(makeInput());
    writeFileSync(path.join(rootDir, 'projects.json'), JSON.stringify({ schemaVersion: 1, projects: [] }));

    const summaries = await store.listProjects();

    expect(summaries).toEqual([expect.objectContaining({ id: project.id, name: project.name })]);
    expect(readFileSync(path.join(rootDir, 'projects.json'), 'utf8')).toContain(project.id);
  });

  it('repairs a corrupt summary index from project manifests instead of discarding the source of truth', async () => {
    const project = await store.createProject(makeInput());
    writeFileSync(path.join(rootDir, 'projects.json'), '{not json');

    await expect(store.listProjects()).resolves.toEqual([expect.objectContaining({ id: project.id })]);
    expect(() => JSON.parse(readFileSync(path.join(rootDir, 'projects.json'), 'utf8'))).not.toThrow();
  });

  it('rejects a malformed project manifest instead of silently inventing a repaired project', async () => {
    const projectDir = path.join(rootDir, 'project_broken');
    mkdirSync(projectDir);
    writeFileSync(path.join(rootDir, 'projects.json'), '{not json');
    writeFileSync(path.join(projectDir, 'project.json'), '{not json');

    await expect(store.listProjects()).rejects.toMatchObject({ code: 'storage_error' });
    await expect(store.getProject('project_broken')).rejects.toMatchObject({ code: 'storage_error' });
  });

  it('atomically replaces manifests instead of leaving a partial JSON document after repeated writes', async () => {
    const project = await store.createProject(makeInput());
    await store.updateProject(project.id, (current) => ({ ...current, name: 'Atomically replaced' }));

    const manifestFile = path.join(rootDir, project.id, 'project.json');
    expect(() => JSON.parse(readFileSync(manifestFile, 'utf8'))).not.toThrow();
    expect(readdirSync(path.dirname(manifestFile)).some((entry) => entry.endsWith('.tmp'))).toBe(false);
  });

  it('serializes concurrent updates instead of losing one editor mutation', async () => {
    const project = await store.createProject(makeInput());

    await Promise.all([
      store.updateProject(project.id, (current) => addScene(current, 'scene_1')),
      store.updateProject(project.id, (current) => addScene(current, 'scene_2')),
    ]);

    const persisted = await store.getProject(project.id);
    expect(persisted?.sceneOrder).toEqual(['scene_1', 'scene_2']);
    expect(persisted?.revision).toBe(3);
  });

  it('continues a project queue after a rejected update instead of blocking later valid edits', async () => {
    const project = await store.createProject(makeInput());
    await expect(
      store.updateProject(project.id, (current) => ({ ...current, targetDurationSeconds: 61 }))
    ).rejects.toMatchObject({ code: 'invalid_payload' });

    await expect(
      store.updateProject(project.id, (current) => ({ ...current, name: 'Saved after rejection' }))
    ).resolves.toMatchObject({
      name: 'Saved after rejection',
      revision: 2,
    });
  });

  it('rejects a terminal job-state rewrite instead of changing a completed provider result', async () => {
    const project = await store.createProject(makeInput());
    const withSucceededJob = await store.updateProject(project.id, addSucceededJob);

    await expect(
      store.updateProject(withSucceededJob.id, (current) => {
        const next = cloneProject(current);
        next.jobs.job_1.status = 'failed';
        return next;
      })
    ).rejects.toMatchObject({ code: 'invalid_payload' });
  });

  it('allows attaching a downloaded asset to a succeeded job without reopening the provider result', async () => {
    const project = await store.createProject(makeInput());
    const withSucceededJob = await store.updateProject(project.id, addSucceededJob);

    const attached = await store.updateProject(withSucceededJob.id, (current) => {
      const next = cloneProject(current);
      next.jobs.job_1.outputAssetIds = ['asset_1'];
      return next;
    });

    expect(attached.jobs.job_1).toMatchObject({ status: 'succeeded', outputAssetIds: ['asset_1'] });
  });

  it('serializes concurrent index rebuilds instead of dropping a different-project summary', async () => {
    const [first, second] = await Promise.all([
      store.createProject(makeInput({ name: 'First' })),
      store.createProject(makeInput({ name: 'Second' })),
    ]);

    const index = JSON.parse(readFileSync(path.join(rootDir, 'projects.json'), 'utf8')) as {
      projects: StudioProjectSummary[];
    };
    expect(index.projects.map((summary) => summary.id).toSorted()).toEqual([first.id, second.id].toSorted());
  });

  it('deletes a project explicitly instead of retaining its summary after removal', async () => {
    const project = await store.createProject(makeInput());

    expect(await store.deleteProject(project.id)).toBe(true);
    expect(await store.getProject(project.id)).toBeNull();
    expect(await store.listProjects()).toEqual([]);
  });

  it('refuses a traversing deletion ID instead of removing a sibling directory', async () => {
    const outsideDir = mkdtempSync(path.join(tmpdir(), 'creative-studio-outside-'));
    const marker = path.join(outsideDir, 'survives.txt');
    writeFileSync(marker, 'must survive');

    try {
      await expect(store.deleteProject(path.join('..', path.basename(outsideDir)))).resolves.toBe(false);
      expect(existsSync(marker)).toBe(true);
    } finally {
      await rm(outsideDir, { recursive: true, force: true });
    }
  });

  it('refuses a symlinked project root instead of following it during deletion', async () => {
    const outsideDir = mkdtempSync(path.join(tmpdir(), 'creative-studio-symlink-target-'));
    const marker = path.join(outsideDir, 'survives.txt');
    writeFileSync(marker, 'must survive');
    symlinkSync(outsideDir, path.join(rootDir, 'project_link'));

    try {
      await expect(store.deleteProject('project_link')).resolves.toBe(false);
      expect(existsSync(marker)).toBe(true);
    } finally {
      await rm(outsideDir, { recursive: true, force: true });
    }
  });
});

describe('creative studio renderer DTO contract', () => {
  it('keeps command responses free of filesystem paths, credentials, signed URLs, and media bytes', () => {
    type ForbiddenRendererField =
      | 'path'
      | 'filePath'
      | 'credential'
      | 'apiKey'
      | 'signedUrl'
      | 'url'
      | 'bytes'
      | 'base64';
    type KeysOfUnion<Value> = Value extends unknown ? keyof Value : never;
    type RendererDto =
      | StudioProject
      | StudioProjectSummary
      | StudioAsset
      | StudioJob
      | StudioProviderRef
      | StudioRouteCatalog;
    type RendererProjectKeys = KeysOfUnion<RendererDto>;
    type NoForbiddenRendererFields = Extract<RendererProjectKeys, ForbiddenRendererField>;
    const result: StudioCommandResult<StudioProjectSummary[]> = { ok: true, data: [] };

    expectTypeOf<NoForbiddenRendererFields>().toEqualTypeOf<never>();
    expect(result).toEqual({ ok: true, data: [] });
  });

  it('keeps rejected commands typed instead of throwing unstructured renderer errors', () => {
    const result: StudioCommandResult<never> = {
      ok: false,
      error: { code: 'invalid_payload', messageKey: 'creativeStudio.errors.invalidPayload' },
    };

    expect(result.error.code).toBe('invalid_payload');
  });

  it('declares every renderer operation as a typed command result instead of a raw service return', () => {
    type IsTypedCommand<Result> = Result extends (...args: never[]) => Promise<StudioCommandResult<unknown>>
      ? true
      : false;
    type AllOperationsAreTyped = IsTypedCommand<StudioDesktopApi[keyof StudioDesktopApi]>;

    expectTypeOf<AllOperationsAreTyped>().toEqualTypeOf<true>();
  });
});
