/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import type {
  CreateStudioProjectInput,
  ProposeStudioStoryboardInput,
  StudioEditableScene,
  StudioProject,
  StudioProjectSummary,
  StudioScene,
  StudioSelectAssetRequest,
  StudioUpdateProjectRequest,
  StudioUpdateSceneRequest,
  StudioReorderScenesRequest,
  StudioDeleteProjectRequest,
  StudioAsset,
  StudioConnectionBinding,
  StudioConnectionCandidate,
  StudioExportItem,
  StudioListRoutesRequest,
  StudioRemoveConnectionRequest,
  StudioRouteCatalog,
  StudioSaveConnectionRequest,
  StudioValidateConnectionRequest,
  StudioJob,
  StudioRendererJob,
  StudioRendererProject,
  StudioJobRequest,
  StudioRetryDownloadRequest,
  StudioRetryJobRequest,
  StudioSubmitScenesRequest,
} from '@/common/types/project/creativeStudioTypes';
import type { AppOperationResult } from '@/common/types/appOperations';
import { runStudioStoryboardDraft } from '@process/services/app-operations';
import type {
  StudioStoryboardDraftTaskInput,
  StudioStoryboardDraftOutput,
} from '@process/services/app-operations/storyboardDraftTask';
import { CreativeStudioStoreError, type CreativeStudioStore } from '@process/services/creative-studio/store';
import type { StudioProviderResolver } from '@process/services/creative-studio/providerResolver';
import type { GenerationProviderAdapterRegistry } from '@process/services/creative-studio/adapters';
import type { StudioJobManager } from '@process/services/creative-studio/jobManager';
import type { IProvider } from '@/common/config/storage';
import { randomUUID } from 'node:crypto';
import { isImagesApiModel } from '@/common/utils/imageModelAllowlist';

const SAFE_ID = /^[A-Za-z0-9_-]{1,256}$/;
const ASPECT_RATIOS = new Set(['16:9', '9:16', '1:1', '4:3', '3:4']);
const RESOLUTIONS = new Set(['720p', '1080p']);
const MEDIA_KINDS = new Set(['image', 'video']);
const NONTERMINAL_JOB_STATUSES: ReadonlySet<StudioJob['status']> = new Set([
  'queued_local',
  'submitting',
  'queued_remote',
  'running',
  'needs_attention',
]);

export type CreativeStudioService = {
  listProjects(): Promise<StudioProjectSummary[]>;
  createProject(input: CreateStudioProjectInput): Promise<StudioRendererProject>;
  getProject(projectId: string): Promise<StudioRendererProject | null>;
  proposeStoryboard(input: ProposeStudioStoryboardInput): Promise<StudioRendererProject>;
  updateProject(input: StudioUpdateProjectRequest): Promise<StudioRendererProject>;
  deleteProject(input: StudioDeleteProjectRequest): Promise<boolean>;
  updateScene(input: StudioUpdateSceneRequest): Promise<StudioRendererProject>;
  reorderScenes(input: StudioReorderScenesRequest): Promise<StudioRendererProject>;
  selectAsset(input: StudioSelectAssetRequest): Promise<StudioRendererProject>;
  submitScenes(input: StudioSubmitScenesRequest): Promise<StudioRendererJob[]>;
  cancelJob(input: StudioJobRequest): Promise<StudioRendererJob>;
  retryJob(input: StudioRetryJobRequest): Promise<StudioRendererJob>;
  retryDownload(input: StudioRetryDownloadRequest): Promise<StudioRendererJob>;
  importReferenceFromPath(input: {
    projectId: string;
    sceneId?: string;
    expectedRevision: number;
    sourcePath: string;
  }): Promise<StudioAsset>;
  exportAssetsToDirectory(input: {
    projectId: string;
    destinationDirectory: string;
    includeReferences: boolean;
  }): Promise<{ folderName: string; exported: StudioExportItem[]; missingSceneIds: string[] }>;
  listConnectionCandidates(): Promise<StudioConnectionCandidate[]>;
  listConnections(): Promise<StudioConnectionBinding[]>;
  validateConnection(input: StudioValidateConnectionRequest): Promise<StudioConnectionBinding>;
  saveConnection(input: StudioSaveConnectionRequest): Promise<StudioConnectionBinding>;
  removeConnection(input: StudioRemoveConnectionRequest): Promise<boolean>;
  listRoutes(input?: StudioListRoutesRequest): Promise<StudioRouteCatalog>;
};

export type CreativeStudioServiceDeps = {
  store: CreativeStudioStore;
  onProjectUpdated: (projectId: string) => void;
  runStoryboardDraft?: (
    input: StudioStoryboardDraftTaskInput
  ) => Promise<AppOperationResult<StudioStoryboardDraftOutput>>;
  createSceneId?: () => string;
  createConnectionId?: () => string;
  providerResolver?: StudioProviderResolver;
  validateConnection?: (input: StudioValidateConnectionRequest) => Promise<StudioConnectionBinding>;
  listProviders?: () => Promise<IProvider[]>;
  adapterRegistry?: GenerationProviderAdapterRegistry;
  jobManager?: StudioJobManager;
  mediaStore?: {
    importReferenceFromPath(input: {
      projectId: string;
      sceneId?: string;
      expectedRevision: number;
      sourcePath: string;
    }): Promise<StudioAsset>;
    exportAssetsToDirectory(input: {
      projectId: string;
      destinationDirectory: string;
      includeReferences: boolean;
    }): Promise<{ folderName: string; exported: StudioExportItem[]; missingSceneIds: string[] }>;
  };
};

/** A safe, stable service error that can cross only through the bridge error mapper. */
export class CreativeStudioServiceError extends Error {
  readonly code: 'storyboard_exists' | 'planning_unavailable' | 'busy' | 'provider_error' | 'invalid_route';

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

const providerIsAvailable = (provider: IProvider, model: string, requireListedModel = true): boolean =>
  provider.enabled !== false &&
  provider.model_enabled?.[model] !== false &&
  provider.model_health?.[model]?.status !== 'unhealthy' &&
  provider.api_key.trim().length > 0 &&
  (!requireListedModel || provider.models.includes(model));

const sanitizedCapabilities = (
  adapterId: StudioValidateConnectionRequest['adapterId'],
  model: string,
  capabilities: Record<string, unknown> | undefined
): StudioConnectionBinding['capabilities'] => {
  if (adapterId === 'weprompt-image-v1') {
    return { mediaKinds: ['image'], supportsFirstFrame: !isImagesApiModel(model) };
  }
  if (adapterId === 'byteplus-seedance-v1') {
    const constraints =
      model === 'seedance-1-0-pro-250528'
        ? {
            minDurationSeconds: 2,
            maxDurationSeconds: 12,
            resolutions: ['720p' as const, '1080p' as const],
            aspectRatios: ['16:9' as const, '9:16' as const, '1:1' as const, '4:3' as const, '3:4' as const],
          }
        : model === 'seedance-1-5-pro-251215'
          ? {
              minDurationSeconds: 4,
              maxDurationSeconds: 12,
              resolutions: ['720p' as const, '1080p' as const],
              aspectRatios: ['16:9' as const, '9:16' as const, '1:1' as const, '4:3' as const, '3:4' as const],
            }
          : {
              minDurationSeconds: 4,
              maxDurationSeconds: 15,
              resolutions: ['720p' as const, '1080p' as const],
              aspectRatios: ['16:9' as const, '9:16' as const, '1:1' as const, '4:3' as const, '3:4' as const],
            };
    return {
      mediaKinds: ['video'],
      audioModes: ['none'],
      supportsFirstFrame: true,
      cancellation: true,
      ...constraints,
    };
  }
  const ratios = Array.isArray(capabilities?.aspectRatios)
    ? capabilities.aspectRatios.filter(
        (value): value is StudioConnectionBinding['capabilities']['aspectRatios'][number] =>
          typeof value === 'string' && ASPECT_RATIOS.has(value)
      )
    : undefined;
  const resolutions = Array.isArray(capabilities?.resolutions)
    ? capabilities.resolutions.filter(
        (value): value is StudioConnectionBinding['capabilities']['resolutions'][number] =>
          typeof value === 'string' && RESOLUTIONS.has(value)
      )
    : undefined;
  const minimum = capabilities?.minDurationSeconds;
  const maximum = capabilities?.maxDurationSeconds;
  return {
    mediaKinds: ['video'],
    audioModes: ['none'],
    ...(ratios && ratios.length > 0 ? { aspectRatios: ratios } : {}),
    ...(resolutions && resolutions.length > 0 ? { resolutions } : {}),
    ...(isIntegerInRange(minimum, 1, 60) ? { minDurationSeconds: minimum } : {}),
    ...(isIntegerInRange(maximum, 1, 60) ? { maxDurationSeconds: maximum } : {}),
    supportsFirstFrame: capabilities?.supportsFirstFrame === true,
    cancellation: capabilities?.cancellation === true,
  };
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

const assertJobRequest = (input: StudioJobRequest): void => {
  assertSafeId(input.projectId, 'project id');
  assertSafeId(input.jobId, 'job id');
  assertExpectedRevision(input.expectedRevision);
};

const assertSubmitScenesInput = (input: StudioSubmitScenesRequest): void => {
  assertSafeId(input.projectId, 'project id');
  assertExpectedRevision(input.expectedRevision);
  assertText(input.catalogVersion, 64, 'route catalog version', true);
  if (
    !Array.isArray(input.sceneIds) ||
    input.sceneIds.length < 1 ||
    input.sceneIds.length > 24 ||
    input.sceneIds.some((sceneId) => !isSafeId(sceneId)) ||
    new Set(input.sceneIds).size !== input.sceneIds.length ||
    !Array.isArray(input.routes) ||
    input.routes.length !== input.sceneIds.length
  ) {
    throw invalid('Invalid Studio generation scene selection');
  }
  const selectedSceneIds = new Set(input.sceneIds);
  const routedSceneIds = new Set<string>();
  for (const route of input.routes) {
    if (
      !isSafeId(route.sceneId) ||
      !selectedSceneIds.has(route.sceneId) ||
      routedSceneIds.has(route.sceneId) ||
      !isSafeId(route.providerId) ||
      !['weprompt-image-v1', 'byteplus-seedance-v1', 'weprompt-media-gateway-v1'].includes(route.adapterId) ||
      !MEDIA_KINDS.has(route.kind)
    ) {
      throw invalid('Invalid Studio generation route');
    }
    assertText(route.model, 256, 'route model', true);
    routedSceneIds.add(route.sceneId);
  }
};

const assertScene = (scene: StudioEditableScene): void => {
  assertText(scene.title, 256, 'scene title', true);
  assertText(scene.purpose, 256, 'scene purpose');
  assertText(scene.visualPrompt, 8 * 1024, 'scene visual prompt');
  assertText(scene.narration, 4 * 1024, 'scene narration');
  assertText(scene.onScreenText, 1024, 'scene on-screen text');
  if (!MEDIA_KINDS.has(scene.mediaKind)) throw invalid('Invalid Studio scene media kind');
  if (!isIntegerInRange(scene.durationSeconds, 1, 60)) throw invalid('Invalid Studio scene duration');
  if (scene.referenceAssetId !== null) assertSafeId(scene.referenceAssetId, 'reference asset id');
};

const toRendererJob = (job: StudioJob): StudioRendererJob => ({
  id: job.id,
  projectId: job.projectId,
  sceneId: job.sceneId,
  status: job.status,
  provider: { ...job.provider },
  outputAssetIds: [...job.outputAssetIds],
  error: job.error === null ? null : { ...job.error },
  ...(job.progress === undefined ? {} : { progress: job.progress }),
  retryOfJobId: job.retryOfJobId,
  retryReason: job.retryReason,
  duplicateChargeAcknowledged: job.duplicateChargeAcknowledged,
  duplicateChargeAcknowledgedAt: job.duplicateChargeAcknowledgedAt,
  createdAt: job.createdAt,
  updatedAt: job.updatedAt,
});

const toRendererScene = (scene: StudioScene): StudioScene => ({
  id: scene.id,
  title: scene.title,
  purpose: scene.purpose,
  visualPrompt: scene.visualPrompt,
  narration: scene.narration,
  onScreenText: scene.onScreenText,
  mediaKind: scene.mediaKind,
  durationSeconds: scene.durationSeconds,
  referenceAssetId: scene.referenceAssetId,
  selectedAssetId: scene.selectedAssetId,
  assetIds: [...scene.assetIds],
  jobIds: [...scene.jobIds],
  reviewState: scene.reviewState,
});

const toRendererAsset = (asset: StudioAsset): StudioAsset => ({
  id: asset.id,
  projectId: asset.projectId,
  sceneId: asset.sceneId,
  mediaKind: asset.mediaKind,
  mimeType: asset.mimeType,
  managedAsset: { ...asset.managedAsset },
  byteSize: asset.byteSize,
  sha256: asset.sha256,
  ...(asset.width === undefined ? {} : { width: asset.width }),
  ...(asset.height === undefined ? {} : { height: asset.height }),
  ...(asset.durationSeconds === undefined ? {} : { durationSeconds: asset.durationSeconds }),
  createdAt: asset.createdAt,
});

const toRendererProject = (project: StudioProject): StudioRendererProject => ({
  schemaVersion: project.schemaVersion,
  revision: project.revision,
  id: project.id,
  name: project.name,
  brief: project.brief,
  ...(project.forgeProjectId === undefined ? {} : { forgeProjectId: project.forgeProjectId }),
  aspectRatio: project.aspectRatio,
  targetDurationSeconds: project.targetDurationSeconds,
  resolution: project.resolution,
  sceneOrder: [...project.sceneOrder],
  scenes: Object.fromEntries(
    Object.entries(project.scenes).map(([sceneId, scene]) => [sceneId, toRendererScene(scene)])
  ),
  assets: Object.fromEntries(
    Object.entries(project.assets).map(([assetId, asset]) => [assetId, toRendererAsset(asset)])
  ),
  jobs: Object.fromEntries(Object.entries(project.jobs).map(([jobId, job]) => [jobId, toRendererJob(job)])),
  routing: structuredClone(project.routing),
  createdAt: project.createdAt,
  updatedAt: project.updatedAt,
});

/** Owns bounded Creative Studio project edits and renderer-safe mutation notifications. */
export const createCreativeStudioService = (deps: CreativeStudioServiceDeps): CreativeStudioService => {
  const runStoryboardDraft = deps.runStoryboardDraft ?? runStudioStoryboardDraft;
  const createSceneId = deps.createSceneId ?? randomUUID;
  const createConnectionId = deps.createConnectionId ?? randomUUID;
  const notify = (project: StudioProject): StudioRendererProject => {
    deps.onProjectUpdated(project.id);
    return toRendererProject(project);
  };

  return {
    listProjects: () => deps.store.listProjects(),

    async createProject(input: CreateStudioProjectInput): Promise<StudioRendererProject> {
      assertProjectInput(input);
      return notify(await deps.store.createProject(input));
    },

    async getProject(projectId: string): Promise<StudioRendererProject | null> {
      assertSafeId(projectId, 'project id');
      const project = await deps.store.getProject(projectId);
      return project === null ? null : toRendererProject(project);
    },

    async proposeStoryboard(input: ProposeStudioStoryboardInput): Promise<StudioRendererProject> {
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

    async updateProject(input: StudioUpdateProjectRequest): Promise<StudioRendererProject> {
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

    async updateScene(input: StudioUpdateSceneRequest): Promise<StudioRendererProject> {
      assertSafeId(input.projectId, 'project id');
      assertSafeId(input.sceneId, 'scene id');
      assertExpectedRevision(input.expectedRevision);
      if (input.scene !== null) assertScene(input.scene);
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
            if (input.scene.referenceAssetId !== null) {
              const reference = next.assets[input.scene.referenceAssetId];
              if (
                reference === undefined ||
                reference.projectId !== next.id ||
                reference.sceneId !== input.sceneId ||
                reference.mediaKind !== 'image'
              ) {
                throw invalid('Studio reference asset does not belong to its scene');
              }
            }
            const current = next.scenes[input.sceneId];
            if (current === undefined) {
              next.scenes[input.sceneId] = {
                id: input.sceneId,
                ...input.scene,
                selectedAssetId: null,
                assetIds: [],
                jobIds: [],
                reviewState: input.scene.visualPrompt.trim().length > 0 ? 'ready' : 'draft',
              };
            } else {
              const mediaKindChanged = current.mediaKind !== input.scene.mediaKind;
              if (
                mediaKindChanged &&
                current.jobIds.some((jobId) => {
                  const job = next.jobs[jobId];
                  return job !== undefined && NONTERMINAL_JOB_STATUSES.has(job.status);
                })
              ) {
                throw new CreativeStudioServiceError('busy');
              }
              const selectedAsset = current.selectedAssetId === null ? undefined : next.assets[current.selectedAssetId];
              const selectedAssetId =
                mediaKindChanged && selectedAsset?.mediaKind !== input.scene.mediaKind ? null : current.selectedAssetId;
              next.scenes[input.sceneId] = {
                ...current,
                ...input.scene,
                id: current.id,
                selectedAssetId,
                assetIds: [...current.assetIds],
                jobIds: [...current.jobIds],
                reviewState: mediaKindChanged
                  ? input.scene.visualPrompt.trim().length > 0
                    ? 'ready'
                    : 'draft'
                  : current.reviewState,
              };
            }
            if (!next.sceneOrder.includes(input.sceneId)) next.sceneOrder.push(input.sceneId);
            return next;
          },
          input.expectedRevision
        )
      );
    },

    async reorderScenes(input: StudioReorderScenesRequest): Promise<StudioRendererProject> {
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

    async selectAsset(input: StudioSelectAssetRequest): Promise<StudioRendererProject> {
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
              asset.sceneId !== scene.id ||
              asset.mediaKind !== scene.mediaKind
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

    async submitScenes(input: StudioSubmitScenesRequest): Promise<StudioRendererJob[]> {
      assertSubmitScenesInput(input);
      if (!deps.jobManager) throw new CreativeStudioServiceError('provider_error');
      return (await deps.jobManager.submitScenes(input)).map(toRendererJob);
    },

    async cancelJob(input: StudioJobRequest): Promise<StudioRendererJob> {
      assertJobRequest(input);
      if (!deps.jobManager) throw new CreativeStudioServiceError('provider_error');
      return toRendererJob(await deps.jobManager.cancelJob(input));
    },

    async retryJob(input: StudioRetryJobRequest): Promise<StudioRendererJob> {
      assertJobRequest(input);
      if (
        input.acknowledgePossibleDuplicateCharge !== undefined &&
        typeof input.acknowledgePossibleDuplicateCharge !== 'boolean'
      ) {
        throw invalid('Invalid Studio duplicate-charge acknowledgement');
      }
      if (!deps.jobManager) throw new CreativeStudioServiceError('provider_error');
      return toRendererJob(await deps.jobManager.retryJob(input));
    },

    async retryDownload(input: StudioRetryDownloadRequest): Promise<StudioRendererJob> {
      assertJobRequest(input);
      if (!deps.jobManager) throw new CreativeStudioServiceError('provider_error');
      return toRendererJob(await deps.jobManager.retryDownload(input));
    },

    async importReferenceFromPath(input): Promise<StudioAsset> {
      assertSafeId(input.projectId, 'project id');
      assertExpectedRevision(input.expectedRevision);
      if (input.sceneId !== undefined) assertSafeId(input.sceneId, 'scene id');
      if (typeof input.sourcePath !== 'string' || input.sourcePath.length === 0)
        throw invalid('Invalid Studio source path');
      if (!deps.mediaStore) throw new CreativeStudioStoreError('storage_error', 'Studio media storage is unavailable');
      const asset = await deps.mediaStore.importReferenceFromPath(input);
      deps.onProjectUpdated(input.projectId);
      return asset;
    },

    async exportAssetsToDirectory(input) {
      assertSafeId(input.projectId, 'project id');
      if (typeof input.destinationDirectory !== 'string' || typeof input.includeReferences !== 'boolean') {
        throw invalid('Invalid Studio export request');
      }
      if (!deps.mediaStore) throw new CreativeStudioStoreError('storage_error', 'Studio media storage is unavailable');
      return deps.mediaStore.exportAssetsToDirectory(input);
    },

    async listConnectionCandidates(): Promise<StudioConnectionCandidate[]> {
      if (!deps.providerResolver) return [];
      try {
        return await deps.providerResolver.listConnectionCandidates();
      } catch {
        throw new CreativeStudioServiceError('provider_error');
      }
    },

    async listConnections(): Promise<StudioConnectionBinding[]> {
      return deps.store.listConnections();
    },

    async validateConnection(input: StudioValidateConnectionRequest): Promise<StudioConnectionBinding> {
      assertSafeId(input.providerId, 'provider id');
      assertText(input.model, 256, 'connection model', true);
      const normalizedInput = { ...input, model: input.model.trim() };
      if (!['weprompt-image-v1', 'byteplus-seedance-v1', 'weprompt-media-gateway-v1'].includes(input.adapterId)) {
        throw invalid('Invalid Studio adapter');
      }
      if (deps.validateConnection) {
        const validated = await deps.validateConnection(normalizedInput);
        return { ...validated, model: normalizedInput.model };
      }
      if (!deps.listProviders || !deps.adapterRegistry) throw new CreativeStudioServiceError('invalid_route');
      let providers: IProvider[];
      try {
        providers = await deps.listProviders();
      } catch {
        throw new CreativeStudioServiceError('provider_error');
      }
      const provider = providers.find((candidate) => candidate.id === normalizedInput.providerId);
      if (!provider || !providerIsAvailable(provider, normalizedInput.model, false))
        throw new CreativeStudioServiceError('invalid_route');
      const adapter = deps.adapterRegistry.get(input.adapterId);
      if (!adapter) throw new CreativeStudioServiceError('invalid_route');
      const validation = await adapter.validateConnection(
        { model: normalizedInput.model },
        provider,
        new AbortController().signal
      );
      if (!validation.ok) throw new CreativeStudioServiceError('provider_error');
      return {
        schemaVersion: 1,
        id: 'validation_only',
        providerId: provider.id,
        adapterId: adapter.id,
        model: normalizedInput.model,
        capabilities: sanitizedCapabilities(adapter.id, normalizedInput.model, validation.capabilities),
        validatedAt: new Date().toISOString(),
      };
    },

    async saveConnection(input: StudioSaveConnectionRequest): Promise<StudioConnectionBinding> {
      const validated = await this.validateConnection(input);
      const binding: StudioConnectionBinding = {
        ...validated,
        schemaVersion: 1,
        id: createConnectionId(),
      };
      if (!isSafeId(binding.id)) {
        throw new CreativeStudioStoreError('storage_error', 'Unable to allocate Studio connection identity');
      }
      return deps.store.saveConnection(binding);
    },

    async removeConnection(input: StudioRemoveConnectionRequest): Promise<boolean> {
      assertSafeId(input.connectionId, 'connection id');
      return deps.store.removeConnection(input.connectionId);
    },

    async listRoutes(input: StudioListRoutesRequest = {}): Promise<StudioRouteCatalog> {
      if (input.projectId !== undefined) assertSafeId(input.projectId, 'project id');
      if (!deps.providerResolver) throw new CreativeStudioServiceError('invalid_route');
      const project = input.projectId === undefined ? null : await deps.store.getProject(input.projectId);
      if (input.projectId !== undefined && project === null) {
        throw new CreativeStudioStoreError('not_found', 'Studio project not found');
      }
      try {
        return await deps.providerResolver.listRoutes({ routing: project?.routing });
      } catch {
        throw new CreativeStudioServiceError('provider_error');
      }
    },
  };
};
