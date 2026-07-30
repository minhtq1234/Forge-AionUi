/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import type {
  CreateStudioProjectInput,
  ProposeStudioStoryboardInput,
  StudioProject,
  StudioProjectSummary,
  StudioScene,
  StudioSelectAssetRequest,
  StudioUpdateProjectRequest,
  StudioUpdateSceneRequest,
  StudioReorderScenesRequest,
  StudioDeleteProjectRequest,
} from '@/common/types/project/creativeStudioTypes';
import type { AppOperationResult } from '@/common/types/appOperations';
import { runStudioStoryboardDraft } from '@process/services/app-operations';
import type {
  StudioStoryboardDraftTaskInput,
  StudioStoryboardDraftOutput,
} from '@process/services/app-operations/storyboardDraftTask';
import { CreativeStudioStoreError, type CreativeStudioStore } from '@process/services/creative-studio/store';
import { randomUUID } from 'node:crypto';

const SAFE_ID = /^[A-Za-z0-9_-]{1,256}$/;
const ASPECT_RATIOS = new Set(['16:9', '9:16', '1:1', '4:3', '3:4']);
const RESOLUTIONS = new Set(['720p', '1080p']);
const MEDIA_KINDS = new Set(['image', 'video']);
const REVIEW_STATES = new Set(['draft', 'ready', 'generating', 'complete', 'blocked']);

export type CreativeStudioService = {
  listProjects(): Promise<StudioProjectSummary[]>;
  createProject(input: CreateStudioProjectInput): Promise<StudioProject>;
  getProject(projectId: string): Promise<StudioProject | null>;
  proposeStoryboard(input: ProposeStudioStoryboardInput): Promise<StudioProject>;
  updateProject(input: StudioUpdateProjectRequest): Promise<StudioProject>;
  deleteProject(input: StudioDeleteProjectRequest): Promise<boolean>;
  updateScene(input: StudioUpdateSceneRequest): Promise<StudioProject>;
  reorderScenes(input: StudioReorderScenesRequest): Promise<StudioProject>;
  selectAsset(input: StudioSelectAssetRequest): Promise<StudioProject>;
};

export type CreativeStudioServiceDeps = {
  store: CreativeStudioStore;
  onProjectUpdated: (projectId: string) => void;
  runStoryboardDraft?: (
    input: StudioStoryboardDraftTaskInput
  ) => Promise<AppOperationResult<StudioStoryboardDraftOutput>>;
  createSceneId?: () => string;
};

/** A safe, stable service error that can cross only through the bridge error mapper. */
export class CreativeStudioServiceError extends Error {
  readonly code: 'storyboard_exists' | 'planning_unavailable' | 'busy' | 'provider_error';

  constructor(code: CreativeStudioServiceError['code']) {
    super(code);
    this.name = 'CreativeStudioServiceError';
    this.code = code;
  }
}

const isSafeId = (value: unknown): value is string => typeof value === 'string' && SAFE_ID.test(value);

const isIntegerInRange = (value: unknown, minimum: number, maximum: number): value is number =>
  typeof value === 'number' &&
  Number.isFinite(value) &&
  Number.isInteger(value) &&
  value >= minimum &&
  value <= maximum;

const invalid = (message: string): CreativeStudioStoreError => new CreativeStudioStoreError('invalid_payload', message);

const assertSafeId: (value: unknown, label: string) => asserts value is string = (value, label) => {
  if (!isSafeId(value)) throw invalid(`Invalid Studio ${label}`);
};

const assertText: (value: unknown, maximum: number, label: string, required?: boolean) => asserts value is string = (
  value,
  maximum,
  label,
  required = false
) => {
  if (typeof value !== 'string' || value.length > maximum || (required && value.trim().length === 0)) {
    throw invalid(`Invalid Studio ${label}`);
  }
};

const assertExpectedRevision: (value: unknown) => asserts value is number = (value) => {
  if (!isIntegerInRange(value, 1, Number.MAX_SAFE_INTEGER)) throw invalid('Invalid Studio project revision');
};

const plannerError = (result: AppOperationResult<StudioStoryboardDraftOutput>): CreativeStudioServiceError => {
  if (result.ok === true) throw new Error('expected_planner_error');
  switch (result.error.code) {
    case 'not_configured':
    case 'model_unavailable':
      return new CreativeStudioServiceError('planning_unavailable');
    case 'queue_full':
      return new CreativeStudioServiceError('busy');
    default:
      return new CreativeStudioServiceError('provider_error');
  }
};

const assertProjectInput = (input: CreateStudioProjectInput): void => {
  assertText(input.name, 256, 'project name', true);
  assertText(input.brief, 16 * 1024, 'project brief');
  if (input.forgeProjectId !== undefined) assertSafeId(input.forgeProjectId, 'Forge project id');
  if (!ASPECT_RATIOS.has(input.aspectRatio)) throw invalid('Invalid Studio aspect ratio');
  if (!isIntegerInRange(input.targetDurationSeconds, 5, 60)) throw invalid('Invalid Studio target duration');
  if (!RESOLUTIONS.has(input.resolution)) throw invalid('Invalid Studio resolution');
};

const assertScene = (sceneId: string, scene: StudioScene): void => {
  if (scene.id !== sceneId) throw invalid('Studio scene id does not match its request');
  assertText(scene.title, 256, 'scene title', true);
  assertText(scene.purpose, 256, 'scene purpose');
  assertText(scene.visualPrompt, 8 * 1024, 'scene visual prompt');
  assertText(scene.narration, 4 * 1024, 'scene narration');
  assertText(scene.onScreenText, 1024, 'scene on-screen text');
  if (!MEDIA_KINDS.has(scene.mediaKind)) throw invalid('Invalid Studio scene media kind');
  if (!isIntegerInRange(scene.durationSeconds, 1, 60)) throw invalid('Invalid Studio scene duration');
  if (scene.referenceAssetId !== null) assertSafeId(scene.referenceAssetId, 'reference asset id');
  if (scene.selectedAssetId !== null) assertSafeId(scene.selectedAssetId, 'selected asset id');
  if (
    !Array.isArray(scene.assetIds) ||
    !Array.isArray(scene.jobIds) ||
    scene.assetIds.some((assetId) => !isSafeId(assetId)) ||
    scene.jobIds.some((jobId) => !isSafeId(jobId)) ||
    new Set(scene.assetIds).size !== scene.assetIds.length ||
    new Set(scene.jobIds).size !== scene.jobIds.length ||
    !REVIEW_STATES.has(scene.reviewState)
  ) {
    throw invalid('Invalid Studio scene references');
  }
};

/** Owns bounded Creative Studio project edits and renderer-safe mutation notifications. */
export const createCreativeStudioService = (deps: CreativeStudioServiceDeps): CreativeStudioService => {
  const runStoryboardDraft = deps.runStoryboardDraft ?? runStudioStoryboardDraft;
  const createSceneId = deps.createSceneId ?? randomUUID;
  const notify = <T extends StudioProject>(project: T): T => {
    deps.onProjectUpdated(project.id);
    return project;
  };

  return {
    listProjects: () => deps.store.listProjects(),

    async createProject(input: CreateStudioProjectInput): Promise<StudioProject> {
      assertProjectInput(input);
      return notify(await deps.store.createProject(input));
    },

    async getProject(projectId: string): Promise<StudioProject | null> {
      assertSafeId(projectId, 'project id');
      return deps.store.getProject(projectId);
    },

    async proposeStoryboard(input: ProposeStudioStoryboardInput): Promise<StudioProject> {
      assertSafeId(input.projectId, 'project id');
      assertExpectedRevision(input.expectedRevision);
      if (typeof input.replaceExisting !== 'boolean') throw invalid('Invalid storyboard replacement option');

      const project = await deps.store.getProject(input.projectId);
      if (!project) throw new CreativeStudioStoreError('not_found', 'Studio project not found');
      if (project.revision !== input.expectedRevision) {
        throw new CreativeStudioStoreError('stale_project', 'Studio project has changed');
      }
      if (project.sceneOrder.length > 0 && !input.replaceExisting) {
        throw new CreativeStudioServiceError('storyboard_exists');
      }

      const result = await runStoryboardDraft({
        projectId: project.id,
        projectRevision: project.revision,
        brief: project.brief,
        aspectRatio: project.aspectRatio,
        targetDurationSeconds: project.targetDurationSeconds,
      });
      if (!result.ok) throw plannerError(result);

      const sceneIds = new Set<string>();
      const scenes: Record<string, StudioScene> = {};
      for (const draft of result.output.scenes) {
        const sceneId = createSceneId();
        if (!isSafeId(sceneId) || sceneIds.has(sceneId)) {
          throw new CreativeStudioStoreError('storage_error', 'Unable to allocate Studio scene identity');
        }
        sceneIds.add(sceneId);
        scenes[sceneId] = {
          id: sceneId,
          title: draft.title,
          purpose: draft.purpose,
          visualPrompt: draft.visualPrompt,
          narration: draft.narration,
          onScreenText: draft.onScreenText,
          mediaKind: draft.mediaKind,
          durationSeconds: draft.durationSeconds,
          referenceAssetId: null,
          selectedAssetId: null,
          assetIds: [],
          jobIds: [],
          reviewState: 'draft',
        };
      }

      return notify(
        await deps.store.updateProject(
          project.id,
          (current) => ({ ...current, scenes, sceneOrder: [...sceneIds] }),
          project.revision
        )
      );
    },

    async updateProject(input: StudioUpdateProjectRequest): Promise<StudioProject> {
      assertSafeId(input.projectId, 'project id');
      assertExpectedRevision(input.expectedRevision);
      if (
        input.name === undefined &&
        input.brief === undefined &&
        input.aspectRatio === undefined &&
        input.targetDurationSeconds === undefined &&
        input.resolution === undefined
      ) {
        throw invalid('Studio project update is empty');
      }
      if (input.name !== undefined) assertText(input.name, 256, 'project name', true);
      if (input.brief !== undefined) assertText(input.brief, 16 * 1024, 'project brief');
      if (input.aspectRatio !== undefined && !ASPECT_RATIOS.has(input.aspectRatio))
        throw invalid('Invalid Studio aspect ratio');
      if (input.targetDurationSeconds !== undefined && !isIntegerInRange(input.targetDurationSeconds, 5, 60)) {
        throw invalid('Invalid Studio target duration');
      }
      if (input.resolution !== undefined && !RESOLUTIONS.has(input.resolution))
        throw invalid('Invalid Studio resolution');
      const { projectId, expectedRevision, ...update } = input;
      return notify(
        await deps.store.updateProject(projectId, (project) => ({ ...project, ...update }), expectedRevision)
      );
    },

    async deleteProject(input: StudioDeleteProjectRequest): Promise<boolean> {
      assertSafeId(input.projectId, 'project id');
      assertExpectedRevision(input.expectedRevision);
      const deleted = await deps.store.deleteProject(input.projectId, input.expectedRevision);
      if (deleted) deps.onProjectUpdated(input.projectId);
      return deleted;
    },

    async updateScene(input: StudioUpdateSceneRequest): Promise<StudioProject> {
      assertSafeId(input.projectId, 'project id');
      assertSafeId(input.sceneId, 'scene id');
      assertExpectedRevision(input.expectedRevision);
      if (input.scene !== null) assertScene(input.sceneId, input.scene);
      return notify(
        await deps.store.updateProject(
          input.projectId,
          (project) => {
            const next = structuredClone(project);
            if (input.scene === null) {
              if (!Object.hasOwn(next.scenes, input.sceneId))
                throw new CreativeStudioStoreError('not_found', 'Studio scene not found');
              const scene = next.scenes[input.sceneId];
              if (scene.assetIds.length > 0 || scene.jobIds.length > 0) {
                throw invalid('Studio scene with assets or jobs cannot be removed');
              }
              delete next.scenes[input.sceneId];
              next.sceneOrder = next.sceneOrder.filter((sceneId) => sceneId !== input.sceneId);
              return next;
            }
            if (!Object.hasOwn(next.scenes, input.sceneId) && next.sceneOrder.length >= 24) {
              throw invalid('Studio project has too many scenes');
            }
            next.scenes[input.sceneId] = input.scene;
            if (!next.sceneOrder.includes(input.sceneId)) next.sceneOrder.push(input.sceneId);
            return next;
          },
          input.expectedRevision
        )
      );
    },

    async reorderScenes(input: StudioReorderScenesRequest): Promise<StudioProject> {
      assertSafeId(input.projectId, 'project id');
      assertExpectedRevision(input.expectedRevision);
      if (
        !Array.isArray(input.sceneOrder) ||
        input.sceneOrder.length < 1 ||
        input.sceneOrder.length > 24 ||
        input.sceneOrder.some((sceneId) => !isSafeId(sceneId)) ||
        new Set(input.sceneOrder).size !== input.sceneOrder.length
      ) {
        throw invalid('Invalid Studio scene order');
      }
      return notify(
        await deps.store.updateProject(
          input.projectId,
          (project) => {
            if (
              project.sceneOrder.length !== input.sceneOrder.length ||
              input.sceneOrder.some((sceneId) => !Object.hasOwn(project.scenes, sceneId))
            ) {
              throw invalid('Studio scene order must be an exact permutation');
            }
            return { ...project, sceneOrder: [...input.sceneOrder] };
          },
          input.expectedRevision
        )
      );
    },

    async selectAsset(input: StudioSelectAssetRequest): Promise<StudioProject> {
      assertSafeId(input.projectId, 'project id');
      assertSafeId(input.sceneId, 'scene id');
      assertSafeId(input.assetId, 'asset id');
      assertExpectedRevision(input.expectedRevision);
      return notify(
        await deps.store.updateProject(
          input.projectId,
          (project) => {
            const scene = project.scenes[input.sceneId];
            const asset = project.assets[input.assetId];
            if (
              scene === undefined ||
              asset === undefined ||
              asset.projectId !== project.id ||
              asset.sceneId !== scene.id
            ) {
              throw invalid('Studio asset does not belong to its selected scene');
            }
            return {
              ...project,
              scenes: {
                ...project.scenes,
                [input.sceneId]: { ...scene, selectedAssetId: input.assetId },
              },
            };
          },
          input.expectedRevision
        )
      );
    },
  };
};
