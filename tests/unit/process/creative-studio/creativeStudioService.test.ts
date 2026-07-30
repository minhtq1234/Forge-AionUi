/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 *
 * @vitest-environment node
 */

import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { CreateStudioProjectInput, StudioProject, StudioScene } from '@/common/types/project/creativeStudioTypes';
import type { CreativeStudioStoreError } from '@process/services/creative-studio/store';
import { createCreativeStudioStore } from '@process/services/creative-studio/store';
import {
  createCreativeStudioService,
  type CreativeStudioService,
} from '@process/services/creative-studio/creativeStudioService';

const makeInput = (overrides: Partial<CreateStudioProjectInput> = {}): CreateStudioProjectInput => ({
  name: 'Launch film',
  brief: 'A short launch story',
  aspectRatio: '16:9',
  targetDurationSeconds: 12,
  resolution: '1080p',
  ...overrides,
});

const makeScene = (id: string, durationSeconds = 4): StudioScene => ({
  id,
  title: `Scene ${id}`,
  purpose: 'Introduce the product',
  visualPrompt: 'A cinematic studio product reveal',
  narration: '',
  onScreenText: '',
  mediaKind: 'video',
  durationSeconds,
  referenceAssetId: null,
  selectedAssetId: null,
  assetIds: [],
  jobIds: [],
  reviewState: 'draft',
});

const storyboardProposal = {
  projectSummary: 'A concise product launch story.',
  scenes: [
    {
      title: 'Opening',
      purpose: 'Set the need.',
      visualPrompt: 'A cinematic morning commute.',
      narration: 'Every day starts with a choice.',
      onScreenText: '',
      mediaKind: 'video' as const,
      durationSeconds: 4,
    },
    {
      title: 'Product',
      purpose: 'Show the product.',
      visualPrompt: 'A premium reusable bottle in a studio.',
      narration: '',
      onScreenText: 'Built to last.',
      mediaKind: 'image' as const,
      durationSeconds: 4,
    },
    {
      title: 'Payoff',
      purpose: 'Close the story.',
      visualPrompt: 'Friends share a hilltop sunset.',
      narration: 'Carry better habits forward.',
      onScreenText: 'Refill your future.',
      mediaKind: 'video' as const,
      durationSeconds: 4,
    },
  ],
};

type StoryboardService = CreativeStudioService & {
  proposeStoryboard(input: {
    projectId: string;
    expectedRevision: number;
    replaceExisting: boolean;
  }): Promise<StudioProject>;
};

describe('CreativeStudioService', () => {
  let rootDir = '';
  let service: CreativeStudioService;
  let onProjectUpdated: ReturnType<typeof vi.fn>;

  beforeEach(async () => {
    rootDir = await mkdtemp(path.join(tmpdir(), 'creative-studio-service-'));
    onProjectUpdated = vi.fn();
    service = createCreativeStudioService({
      store: createCreativeStudioStore({
        rootDir,
        now: () => '2026-07-30T00:00:00.000Z',
        createId: () => 'project_1',
      }),
      onProjectUpdated,
    });
  });

  afterEach(async () => {
    await rm(rootDir, { recursive: true, force: true });
  });

  it('rejects an update for a missing project instead of creating an orphan manifest', async () => {
    await expect(
      service.updateProject({ projectId: 'missing_project', expectedRevision: 1, name: 'Changed' })
    ).rejects.toMatchObject({ code: 'not_found' } satisfies Partial<CreativeStudioStoreError>);
  });

  it('rejects metadata outside renderer bounds instead of persisting oversized text', async () => {
    const project = await service.createProject(makeInput());

    await expect(
      service.updateProject({
        projectId: project.id,
        expectedRevision: project.revision,
        brief: 'x'.repeat(16 * 1024 + 1),
      })
    ).rejects.toMatchObject({ code: 'invalid_payload' } satisfies Partial<CreativeStudioStoreError>);
  });

  it('rejects stale revisions instead of overwriting a newer project edit', async () => {
    const project = await service.createProject(makeInput());
    await service.updateProject({
      projectId: project.id,
      expectedRevision: project.revision,
      name: 'Newer launch film',
    });

    await expect(
      service.updateProject({ projectId: project.id, expectedRevision: project.revision, name: 'Late launch film' })
    ).rejects.toMatchObject({ code: 'stale_project' } satisfies Partial<CreativeStudioStoreError>);
  });

  it('rejects a stale delete instead of deleting a project changed by another editor', async () => {
    const project = await service.createProject(makeInput());
    await service.updateProject({
      projectId: project.id,
      expectedRevision: project.revision,
      name: 'Newer launch film',
    });

    await expect(
      service.deleteProject({ projectId: project.id, expectedRevision: project.revision })
    ).rejects.toMatchObject({
      code: 'stale_project',
    } satisfies Partial<CreativeStudioStoreError>);
    await expect(service.getProject(project.id)).resolves.toMatchObject({ name: 'Newer launch film' });
  });

  it("upserts one bounded scene while retaining the project's canonical scene order", async () => {
    const project = await service.createProject(makeInput());

    const updated = await service.updateScene({
      projectId: project.id,
      expectedRevision: project.revision,
      sceneId: 'scene_1',
      scene: makeScene('scene_1'),
    });

    expect(updated.sceneOrder).toEqual(['scene_1']);
    expect(updated.scenes.scene_1?.visualPrompt).toBe('A cinematic studio product reveal');
  });

  it('rejects a reordered list that is not an exact project scene permutation', async () => {
    const project = await service.createProject(makeInput());
    const withScene = await service.updateScene({
      projectId: project.id,
      expectedRevision: project.revision,
      sceneId: 'scene_1',
      scene: makeScene('scene_1'),
    });

    await expect(
      service.reorderScenes({
        projectId: withScene.id,
        expectedRevision: withScene.revision,
        sceneOrder: ['scene_1', 'scene_1'],
      })
    ).rejects.toMatchObject({ code: 'invalid_payload' } satisfies Partial<CreativeStudioStoreError>);
  });

  it('rejects selecting an asset from another scene instead of crossing scene ownership', async () => {
    const project = await service.createProject(makeInput());
    const withFirstScene = await service.updateScene({
      projectId: project.id,
      expectedRevision: project.revision,
      sceneId: 'scene_1',
      scene: makeScene('scene_1'),
    });
    const withBothScenes = await service.updateScene({
      projectId: withFirstScene.id,
      expectedRevision: withFirstScene.revision,
      sceneId: 'scene_2',
      scene: makeScene('scene_2'),
    });
    const withAsset = await service.updateProject({
      projectId: withBothScenes.id,
      expectedRevision: withBothScenes.revision,
      name: withBothScenes.name,
    });
    const assetProject = await createCreativeStudioStore({ rootDir }).updateProject(
      withAsset.id,
      (current) => {
        const next = structuredClone(current);
        next.assets.asset_2 = {
          id: 'asset_2',
          projectId: next.id,
          sceneId: 'scene_2',
          mediaKind: 'image',
          mimeType: 'image/png',
          managedAsset: { collection: 'assets', fileName: 'asset_2.png' },
          byteSize: 1,
          sha256: '1'.repeat(64),
          createdAt: next.createdAt,
        };
        next.scenes.scene_2.assetIds = ['asset_2'];
        return next;
      },
      withAsset.revision
    );

    await expect(
      service.selectAsset({
        projectId: assetProject.id,
        expectedRevision: assetProject.revision,
        sceneId: 'scene_1',
        assetId: 'asset_2',
      })
    ).rejects.toMatchObject({ code: 'invalid_payload' } satisfies Partial<CreativeStudioStoreError>);
  });

  it('serializes concurrent expected-revision edits instead of applying a stale scene change', async () => {
    const project = await service.createProject(makeInput());

    const results = await Promise.allSettled([
      service.updateProject({ projectId: project.id, expectedRevision: project.revision, name: 'Edited launch film' }),
      service.updateScene({
        projectId: project.id,
        expectedRevision: project.revision,
        sceneId: 'scene_1',
        scene: makeScene('scene_1'),
      }),
    ]);

    const persisted = await service.getProject(project.id);
    expect(persisted?.name).toBe('Edited launch film');
    expect(results.filter((result) => result.status === 'rejected')).toHaveLength(1);
  });

  it('emits only the project id after successful mutation and does not emit for reads or rejected mutations', async () => {
    const project = await service.createProject(makeInput());

    expect(onProjectUpdated).toHaveBeenLastCalledWith(project.id);
    onProjectUpdated.mockClear();
    await service.getProject(project.id);
    expect(onProjectUpdated).not.toHaveBeenCalled();
    await service.updateProject({ projectId: project.id, expectedRevision: project.revision, name: 'Saved update' });
    expect(onProjectUpdated).toHaveBeenCalledWith(project.id);
    onProjectUpdated.mockClear();

    await expect(
      service.updateProject({ projectId: project.id, expectedRevision: 99, name: 'Rejected update' })
    ).rejects.toMatchObject({ code: 'stale_project' } satisfies Partial<CreativeStudioStoreError>);

    expect(onProjectUpdated).not.toHaveBeenCalled();
  });

  it('maps unavailable planner outcomes without calling a renderer-selected provider', async () => {
    const runner = vi.fn(async () => ({
      ok: false as const,
      error: { code: 'not_configured' as const, retryable: false },
      operation: { task_id: 'studio.storyboard-draft', prompt_version: 'studio.storyboard-draft.v1' },
    }));
    const project = await service.createProject(makeInput());
    let sceneIndex = 0;
    const storyboardService = createCreativeStudioService({
      store: createCreativeStudioStore({ rootDir }),
      onProjectUpdated,
      runStoryboardDraft: runner,
      createSceneId: () => `scene_${++sceneIndex}`,
    } as unknown as Parameters<typeof createCreativeStudioService>[0]) as StoryboardService;

    await expect(
      storyboardService.proposeStoryboard({
        projectId: project.id,
        expectedRevision: project.revision,
        replaceExisting: false,
      })
    ).rejects.toMatchObject({ code: 'planning_unavailable' });
    expect(runner).toHaveBeenCalledWith(
      expect.objectContaining({ projectId: project.id, projectRevision: project.revision, brief: project.brief })
    );
    expect(runner.mock.calls[0]?.[0]).not.toHaveProperty('providerId');
    expect(runner.mock.calls[0]?.[0]).not.toHaveProperty('model');
    expect(runner.mock.calls[0]?.[0]).not.toHaveProperty('prompt');
  });

  it.each([
    ['model_unavailable', 'planning_unavailable'],
    ['queue_full', 'busy'],
    ['provider_auth_failed', 'provider_error'],
    ['provider_rate_limited', 'provider_error'],
    ['provider_timeout', 'provider_error'],
    ['provider_request_failed', 'provider_error'],
    ['canceled', 'provider_error'],
    ['invalid_output', 'provider_error'],
  ] as const)('maps broker %s outcomes to the redacted Studio %s result', async (brokerCode, studioCode) => {
    const runner = vi.fn(async () => ({
      ok: false as const,
      error: { code: brokerCode, retryable: false },
      operation: { task_id: 'studio.storyboard-draft', prompt_version: 'studio.storyboard-draft.v1' },
    }));
    const project = await service.createProject(makeInput());
    const storyboardService = createCreativeStudioService({
      store: createCreativeStudioStore({ rootDir }),
      onProjectUpdated,
      runStoryboardDraft: runner,
    } as unknown as Parameters<typeof createCreativeStudioService>[0]) as StoryboardService;

    await expect(
      storyboardService.proposeStoryboard({
        projectId: project.id,
        expectedRevision: project.revision,
        replaceExisting: false,
      })
    ).rejects.toMatchObject({ code: studioCode });
  });

  it('refuses to replace an existing storyboard before invoking the planner', async () => {
    const runner = vi.fn();
    const project = await service.createProject(makeInput());
    const withScene = await service.updateScene({
      projectId: project.id,
      expectedRevision: project.revision,
      sceneId: 'scene_existing',
      scene: makeScene('scene_existing'),
    });
    const storyboardService = createCreativeStudioService({
      store: createCreativeStudioStore({ rootDir }),
      onProjectUpdated,
      runStoryboardDraft: runner,
      createSceneId: () => 'scene_1',
    } as unknown as Parameters<typeof createCreativeStudioService>[0]) as StoryboardService;

    await expect(
      storyboardService.proposeStoryboard({
        projectId: withScene.id,
        expectedRevision: withScene.revision,
        replaceExisting: false,
      })
    ).rejects.toMatchObject({ code: 'storyboard_exists' });
    expect(runner).not.toHaveBeenCalled();
  });

  it('replaces an existing storyboard only after a complete replacement proposal validates', async () => {
    const runner = vi.fn(async () => ({
      ok: true as const,
      output: storyboardProposal,
      operation: { task_id: 'studio.storyboard-draft', prompt_version: 'studio.storyboard-draft.v1' },
    }));
    const project = await service.createProject(makeInput());
    const withScene = await service.updateScene({
      projectId: project.id,
      expectedRevision: project.revision,
      sceneId: 'scene_existing',
      scene: makeScene('scene_existing'),
    });
    let sceneIndex = 0;
    const storyboardService = createCreativeStudioService({
      store: createCreativeStudioStore({ rootDir }),
      onProjectUpdated,
      runStoryboardDraft: runner,
      createSceneId: () => `scene_${++sceneIndex}`,
    } as unknown as Parameters<typeof createCreativeStudioService>[0]) as StoryboardService;

    const drafted = await storyboardService.proposeStoryboard({
      projectId: withScene.id,
      expectedRevision: withScene.revision,
      replaceExisting: true,
    });

    expect(drafted.sceneOrder).toEqual(['scene_1', 'scene_2', 'scene_3']);
    expect(drafted.scenes).not.toHaveProperty('scene_existing');
  });

  it('hydrates canonical draft scenes and emits exactly one update after a successful proposal', async () => {
    const runner = vi.fn(async () => ({
      ok: true as const,
      output: storyboardProposal,
      operation: { task_id: 'studio.storyboard-draft', prompt_version: 'studio.storyboard-draft.v1' },
    }));
    const project = await service.createProject(makeInput());
    onProjectUpdated.mockClear();
    let sceneIndex = 0;
    const storyboardService = createCreativeStudioService({
      store: createCreativeStudioStore({ rootDir }),
      onProjectUpdated,
      runStoryboardDraft: runner,
      createSceneId: () => `scene_${++sceneIndex}`,
    } as unknown as Parameters<typeof createCreativeStudioService>[0]) as StoryboardService;

    const drafted = await storyboardService.proposeStoryboard({
      projectId: project.id,
      expectedRevision: project.revision,
      replaceExisting: false,
    });

    expect(drafted.sceneOrder).toEqual(['scene_1', 'scene_2', 'scene_3']);
    expect(drafted.scenes.scene_1).toMatchObject({
      assetIds: [],
      jobIds: [],
      referenceAssetId: null,
      selectedAssetId: null,
    });
    expect(onProjectUpdated).toHaveBeenCalledOnce();
  });

  it('discards a late proposal when a concurrent project mutation changes the captured revision', async () => {
    let release!: (result: unknown) => void;
    const runner = vi.fn(
      () =>
        new Promise((resolve) => {
          release = resolve;
        })
    );
    const project = await service.createProject(makeInput());
    let sceneIndex = 0;
    const storyboardService = createCreativeStudioService({
      store: createCreativeStudioStore({ rootDir }),
      onProjectUpdated,
      runStoryboardDraft: runner,
      createSceneId: () => `scene_${++sceneIndex}`,
    } as unknown as Parameters<typeof createCreativeStudioService>[0]) as StoryboardService;
    const proposed = storyboardService.proposeStoryboard({
      projectId: project.id,
      expectedRevision: project.revision,
      replaceExisting: false,
    });

    await vi.waitFor(() => expect(runner).toHaveBeenCalledOnce());
    const edited = await service.updateProject({
      projectId: project.id,
      expectedRevision: project.revision,
      name: 'Edited while planning',
    });
    release({
      ok: true,
      output: storyboardProposal,
      operation: { task_id: 'studio.storyboard-draft', prompt_version: 'studio.storyboard-draft.v1' },
    });

    await expect(proposed).rejects.toMatchObject({ code: 'stale_project' });
    await expect(service.getProject(project.id)).resolves.toMatchObject({ name: edited.name, scenes: {} });
  });
});
