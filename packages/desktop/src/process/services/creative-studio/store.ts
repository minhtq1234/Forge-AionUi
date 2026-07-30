/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import { promises as fs } from 'node:fs';
import path from 'node:path';
import type {
  CreateStudioProjectInput,
  StudioAsset,
  StudioJob,
  StudioProject,
  StudioProjectSummary,
  StudioProviderRef,
  StudioScene,
} from '@/common/types/project/creativeStudioTypes';

const SAFE_ID = /^[A-Za-z0-9_-]+$/;
const ASPECT_RATIOS = new Set(['16:9', '9:16', '1:1', '4:3', '3:4']);
const RESOLUTIONS = new Set(['720p', '1080p']);
const MEDIA_KINDS = new Set(['image', 'video']);
const REVIEW_STATES = new Set(['draft', 'ready', 'generating', 'complete', 'blocked']);
const JOB_STATUSES = new Set([
  'queued_local',
  'submitting',
  'queued_remote',
  'running',
  'needs_attention',
  'succeeded',
  'failed',
  'cancelled',
]);
const TERMINAL_JOB_STATUSES = new Set(['succeeded', 'failed', 'cancelled']);
const ADAPTER_IDS = new Set(['weprompt-image-v1', 'byteplus-seedance-v1', 'weprompt-media-gateway-v1']);
const JOB_ERROR_CODES = new Set([
  'invalid_request',
  'auth',
  'quota',
  'rate_limited',
  'provider_unavailable',
  'timeout',
  'no_output',
  'submission_unknown',
  'download_failed',
  'unsupported',
  'unknown',
]);
const ASSET_COLLECTIONS = new Set(['assets', 'imports', 'thumbnails']);
const FORBIDDEN_RENDERER_FIELDS = new Set([
  'path',
  'filepath',
  'sourcepath',
  'destinationpath',
  'url',
  'signedurl',
  'apikey',
  'credential',
  'credentials',
  'authorization',
  'bytes',
  'base64',
]);

let temporaryFileCounter = 0;

type StoreErrorCode = 'invalid_payload' | 'not_found' | 'stale_project' | 'storage_error';

export class CreativeStudioStoreError extends Error {
  readonly code: StoreErrorCode;

  constructor(code: StoreErrorCode, message: string) {
    super(message);
    this.name = 'CreativeStudioStoreError';
    this.code = code;
  }
}

export type CreativeStudioStore = {
  listProjects(): Promise<StudioProjectSummary[]>;
  createProject(input: CreateStudioProjectInput): Promise<StudioProject>;
  getProject(projectId: string): Promise<StudioProject | null>;
  updateProject(
    projectId: string,
    update: (project: StudioProject) => StudioProject,
    expectedRevision?: number
  ): Promise<StudioProject>;
  deleteProject(projectId: string): Promise<boolean>;
};

export type CreativeStudioStoreDeps = {
  rootDir: string;
  now?: () => string;
  createId?: () => string;
};

type JsonRecord = Record<string, unknown>;

const isRecord = (value: unknown): value is JsonRecord =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

const containsForbiddenRendererField = (value: unknown): boolean => {
  if (Array.isArray(value)) return value.some(containsForbiddenRendererField);
  if (!isRecord(value)) return false;
  return Object.entries(value).some(
    ([key, nestedValue]) =>
      FORBIDDEN_RENDERER_FIELDS.has(key.toLowerCase()) || containsForbiddenRendererField(nestedValue)
  );
};

const isSafeId = (value: unknown): value is string => typeof value === 'string' && SAFE_ID.test(value);

const isIntegerInRange = (value: unknown, minimum: number, maximum: number): value is number =>
  typeof value === 'number' && Number.isInteger(value) && value >= minimum && value <= maximum;

const isString = (value: unknown): value is string => typeof value === 'string';

const isNonEmptyString = (value: unknown): value is string => isString(value) && value.trim().length > 0;

const isSafeAssetFileName = (value: unknown): value is string =>
  isNonEmptyString(value) && value !== '.' && value !== '..' && !value.includes('/') && !value.includes('\\');

const asArrayOfSafeIds = (value: unknown): value is string[] => Array.isArray(value) && value.every(isSafeId);

const validateProviderRef = (value: unknown): value is StudioProviderRef =>
  isRecord(value) &&
  isSafeId(value.providerId) &&
  isString(value.adapterId) &&
  ADAPTER_IDS.has(value.adapterId) &&
  isNonEmptyString(value.model);

const validateScene = (sceneId: string, value: unknown): value is StudioScene => {
  if (!isRecord(value)) return false;
  return (
    value.id === sceneId &&
    isSafeId(sceneId) &&
    isNonEmptyString(value.title) &&
    isString(value.purpose) &&
    isString(value.visualPrompt) &&
    isString(value.narration) &&
    isString(value.onScreenText) &&
    isString(value.mediaKind) &&
    MEDIA_KINDS.has(value.mediaKind) &&
    isIntegerInRange(value.durationSeconds, 1, 60) &&
    (value.referenceAssetId === null || isSafeId(value.referenceAssetId)) &&
    (value.selectedAssetId === null || isSafeId(value.selectedAssetId)) &&
    asArrayOfSafeIds(value.assetIds) &&
    new Set(value.assetIds).size === value.assetIds.length &&
    asArrayOfSafeIds(value.jobIds) &&
    new Set(value.jobIds).size === value.jobIds.length &&
    isString(value.reviewState) &&
    REVIEW_STATES.has(value.reviewState)
  );
};

const validateAsset = (
  assetId: string,
  projectId: string,
  sceneIds: Set<string>,
  value: unknown
): value is StudioAsset => {
  if (!isRecord(value) || !isRecord(value.managedAsset)) return false;
  return (
    value.id === assetId &&
    isSafeId(assetId) &&
    value.projectId === projectId &&
    isSafeId(value.sceneId) &&
    sceneIds.has(value.sceneId) &&
    isString(value.mediaKind) &&
    MEDIA_KINDS.has(value.mediaKind) &&
    isNonEmptyString(value.mimeType) &&
    isString(value.managedAsset.collection) &&
    ASSET_COLLECTIONS.has(value.managedAsset.collection) &&
    isSafeAssetFileName(value.managedAsset.fileName) &&
    isIntegerInRange(value.byteSize, 0, Number.MAX_SAFE_INTEGER) &&
    isNonEmptyString(value.createdAt)
  );
};

const validateJob = (jobId: string, projectId: string, sceneIds: Set<string>, value: unknown): value is StudioJob => {
  if (!isRecord(value)) return false;
  const errorIsValid =
    value.error === null ||
    (isRecord(value.error) &&
      isString(value.error.code) &&
      JOB_ERROR_CODES.has(value.error.code) &&
      isNonEmptyString(value.error.messageKey));
  return (
    value.id === jobId &&
    isSafeId(jobId) &&
    value.projectId === projectId &&
    isSafeId(value.sceneId) &&
    sceneIds.has(value.sceneId) &&
    isString(value.status) &&
    JOB_STATUSES.has(value.status) &&
    validateProviderRef(value.provider) &&
    isSafeId(value.idempotencyKey) &&
    (value.providerJobId === null || isNonEmptyString(value.providerJobId)) &&
    asArrayOfSafeIds(value.outputAssetIds) &&
    new Set(value.outputAssetIds).size === value.outputAssetIds.length &&
    errorIsValid &&
    isNonEmptyString(value.createdAt) &&
    isNonEmptyString(value.updatedAt)
  );
};

const validateProject = (value: unknown): value is StudioProject => {
  if (
    !isRecord(value) ||
    !isRecord(value.scenes) ||
    !isRecord(value.assets) ||
    !isRecord(value.jobs) ||
    !isRecord(value.routing)
  ) {
    return false;
  }
  const scenes = value.scenes;
  const assets = value.assets;
  const jobs = value.jobs;
  const routing = value.routing;
  const projectId = value.id;
  const sceneOrder = value.sceneOrder;
  if (containsForbiddenRendererField(value)) return false;
  if (
    value.schemaVersion !== 1 ||
    !isSafeId(projectId) ||
    !isIntegerInRange(value.revision, 1, Number.MAX_SAFE_INTEGER) ||
    !isNonEmptyString(value.name) ||
    !isString(value.brief) ||
    (value.forgeProjectId !== undefined && !isSafeId(value.forgeProjectId)) ||
    !isString(value.aspectRatio) ||
    !ASPECT_RATIOS.has(value.aspectRatio) ||
    !isIntegerInRange(value.targetDurationSeconds, 5, 60) ||
    !isString(value.resolution) ||
    !RESOLUTIONS.has(value.resolution) ||
    !asArrayOfSafeIds(sceneOrder) ||
    !isNonEmptyString(value.createdAt) ||
    !isNonEmptyString(value.updatedAt) ||
    (routing.image !== null && !validateProviderRef(routing.image)) ||
    (routing.video !== null && !validateProviderRef(routing.video))
  ) {
    return false;
  }

  const sceneIds = Object.keys(scenes);
  if (
    sceneIds.some((sceneId) => !validateScene(sceneId, scenes[sceneId])) ||
    sceneOrder.length !== sceneIds.length ||
    new Set(sceneOrder).size !== sceneOrder.length ||
    sceneOrder.some((sceneId) => !Object.hasOwn(scenes, sceneId))
  ) {
    return false;
  }

  const sceneIdSet = new Set(sceneIds);
  if (Object.keys(assets).some((assetId) => !validateAsset(assetId, projectId, sceneIdSet, assets[assetId]))) {
    return false;
  }
  if (Object.keys(jobs).some((jobId) => !validateJob(jobId, projectId, sceneIdSet, jobs[jobId]))) {
    return false;
  }

  const typedScenes = scenes as Record<string, StudioScene>;
  const typedAssets = assets as Record<string, StudioAsset>;
  const typedJobs = jobs as Record<string, StudioJob>;
  return sceneIds.every((sceneId) => {
    const scene = typedScenes[sceneId];
    const linkedAssetsAreValid = scene.assetIds.every(
      (assetId) => typedAssets[assetId]?.projectId === projectId && typedAssets[assetId]?.sceneId === sceneId
    );
    const linkedJobsAreValid = scene.jobIds.every(
      (jobId) => typedJobs[jobId]?.projectId === projectId && typedJobs[jobId]?.sceneId === sceneId
    );
    const selectedAssetIsValid =
      scene.selectedAssetId === null ||
      (typedAssets[scene.selectedAssetId]?.projectId === projectId &&
        typedAssets[scene.selectedAssetId]?.sceneId === sceneId);
    const referenceAssetIsValid =
      scene.referenceAssetId === null ||
      (typedAssets[scene.referenceAssetId]?.projectId === projectId &&
        typedAssets[scene.referenceAssetId]?.sceneId === sceneId);
    const jobOutputsAreValid = scene.jobIds.every((jobId) =>
      typedJobs[jobId].outputAssetIds.every(
        (assetId) => typedAssets[assetId]?.projectId === projectId && typedAssets[assetId]?.sceneId === sceneId
      )
    );
    return (
      linkedAssetsAreValid && linkedJobsAreValid && selectedAssetIsValid && referenceAssetIsValid && jobOutputsAreValid
    );
  });
};

const toSummary = (project: StudioProject): StudioProjectSummary => ({
  id: project.id,
  name: project.name,
  ...(project.forgeProjectId === undefined ? {} : { forgeProjectId: project.forgeProjectId }),
  aspectRatio: project.aspectRatio,
  targetDurationSeconds: project.targetDurationSeconds,
  resolution: project.resolution,
  sceneCount: project.sceneOrder.length,
  createdAt: project.createdAt,
  updatedAt: project.updatedAt,
});

const compareSummaries = (left: StudioProjectSummary, right: StudioProjectSummary): number => {
  const byUpdatedAt = right.updatedAt.localeCompare(left.updatedAt);
  return byUpdatedAt !== 0 ? byUpdatedAt : left.id.localeCompare(right.id);
};

const sameJson = (left: unknown, right: unknown): boolean => JSON.stringify(left) === JSON.stringify(right);

const terminalJobsRemainImmutable = (current: StudioProject, next: StudioProject): boolean =>
  Object.values(current.jobs).every((previousJob) => {
    if (!TERMINAL_JOB_STATUSES.has(previousJob.status)) return true;
    const nextJob = next.jobs[previousJob.id];
    if (nextJob === undefined || nextJob.status !== previousJob.status) return false;
    if (previousJob.status !== 'succeeded') return sameJson(nextJob, previousJob);

    const {
      outputAssetIds: previousOutputAssetIds,
      updatedAt: _previousUpdatedAt,
      ...previousStableFields
    } = previousJob;
    const { outputAssetIds: nextOutputAssetIds, updatedAt: _nextUpdatedAt, ...nextStableFields } = nextJob;
    return (
      sameJson(previousStableFields, nextStableFields) &&
      previousOutputAssetIds.every((assetId) => nextOutputAssetIds.includes(assetId))
    );
  });

const createProjectFromInput = (input: CreateStudioProjectInput, id: string, timestamp: string): StudioProject => ({
  schemaVersion: 1,
  revision: 1,
  id,
  name: input.name.trim(),
  brief: input.brief,
  ...(input.forgeProjectId === undefined ? {} : { forgeProjectId: input.forgeProjectId }),
  aspectRatio: input.aspectRatio,
  targetDurationSeconds: input.targetDurationSeconds,
  resolution: input.resolution,
  sceneOrder: [],
  scenes: {},
  assets: {},
  jobs: {},
  routing: { image: null, video: null },
  createdAt: timestamp,
  updatedAt: timestamp,
});

/** Creates an atomic, manifest-backed store for Creative Studio projects. */
export const createCreativeStudioStore = (deps: CreativeStudioStoreDeps): CreativeStudioStore => {
  const rootDir = path.resolve(deps.rootDir);
  const now = deps.now ?? (() => new Date().toISOString());
  const createId = deps.createId ?? (() => crypto.randomUUID().replaceAll('-', '_'));
  const queues = new Map<string, Promise<unknown>>();
  let summaryQueue: Promise<unknown> = Promise.resolve();

  const projectDir = (projectId: string): string => {
    if (!isSafeId(projectId)) throw new CreativeStudioStoreError('invalid_payload', 'Invalid Studio project id');
    const resolved = path.resolve(rootDir, projectId);
    if (!resolved.startsWith(rootDir + path.sep)) {
      throw new CreativeStudioStoreError('invalid_payload', 'Invalid Studio project path');
    }
    return resolved;
  };

  const projectFile = (projectId: string): string => path.join(projectDir(projectId), 'project.json');
  const summariesFile = (): string => path.join(rootDir, 'projects.json');

  const writeJsonAtomic = async (file: string, value: unknown): Promise<void> => {
    await fs.mkdir(path.dirname(file), { recursive: true });
    const temporaryFile = `${file}.${process.pid}.${++temporaryFileCounter}.tmp`;
    try {
      await fs.writeFile(temporaryFile, JSON.stringify(value, null, 2), 'utf8');
      await fs.rename(temporaryFile, file);
    } catch (error) {
      await fs.rm(temporaryFile, { force: true }).catch((): undefined => undefined);
      throw new CreativeStudioStoreError(
        'storage_error',
        error instanceof Error ? error.message : 'Studio storage write failed'
      );
    }
  };

  const readProject = async (projectId: string): Promise<StudioProject | null> => {
    try {
      const raw = JSON.parse(await fs.readFile(projectFile(projectId), 'utf8')) as unknown;
      if (validateProject(raw) && raw.id === projectId) return raw;
      throw new CreativeStudioStoreError('storage_error', 'Malformed Studio project manifest');
    } catch (error) {
      if (error instanceof CreativeStudioStoreError) throw error;
      if (isRecord(error) && error.code === 'ENOENT') return null;
      throw new CreativeStudioStoreError(
        'storage_error',
        error instanceof Error ? error.message : 'Studio storage read failed'
      );
    }
  };

  const readAllProjects = async (): Promise<StudioProject[]> => {
    let entries: import('node:fs').Dirent[];
    try {
      entries = await fs.readdir(rootDir, { withFileTypes: true });
    } catch (error) {
      if (isRecord(error) && error.code === 'ENOENT') return [];
      throw new CreativeStudioStoreError(
        'storage_error',
        error instanceof Error ? error.message : 'Studio storage read failed'
      );
    }
    const projects = await Promise.all(
      entries.filter((entry) => entry.isDirectory() && isSafeId(entry.name)).map((entry) => readProject(entry.name))
    );
    return projects.filter((project): project is StudioProject => project !== null);
  };

  const repairSummaryIndex = (): Promise<StudioProjectSummary[]> => {
    const rebuild = async (): Promise<StudioProjectSummary[]> => {
      const summaries = (await readAllProjects()).map(toSummary).toSorted(compareSummaries);
      let existing: unknown = null;
      try {
        existing = JSON.parse(await fs.readFile(summariesFile(), 'utf8')) as unknown;
      } catch {
        // A missing or malformed summary is repaired from the per-project source of truth below.
      }
      const next = { schemaVersion: 1, projects: summaries };
      if (!sameJson(existing, next)) await writeJsonAtomic(summariesFile(), next);
      return summaries;
    };
    const next = summaryQueue.catch((): undefined => undefined).then(() => rebuild());
    summaryQueue = next.catch((): undefined => undefined);
    return next;
  };

  const enqueue = <T>(projectId: string, work: () => Promise<T>): Promise<T> => {
    const previous = queues.get(projectId) ?? Promise.resolve();
    const next = previous.catch((): undefined => undefined).then(() => work());
    queues.set(projectId, next);
    void next
      .finally(() => {
        if (queues.get(projectId) === next) queues.delete(projectId);
      })
      .catch((): undefined => undefined);
    return next;
  };

  return {
    async listProjects(): Promise<StudioProjectSummary[]> {
      return repairSummaryIndex();
    },

    async createProject(input: CreateStudioProjectInput): Promise<StudioProject> {
      const projectId = input.id ?? createId();
      if (!isSafeId(projectId)) throw new CreativeStudioStoreError('invalid_payload', 'Invalid Studio project id');
      return enqueue(projectId, async () => {
        const candidate = createProjectFromInput(input, projectId, now());
        if (!validateProject(candidate))
          throw new CreativeStudioStoreError('invalid_payload', 'Invalid Studio project payload');
        if (await readProject(projectId))
          throw new CreativeStudioStoreError('invalid_payload', 'Studio project already exists');
        await writeJsonAtomic(projectFile(projectId), candidate);
        await repairSummaryIndex();
        return candidate;
      });
    },

    async getProject(projectId: string): Promise<StudioProject | null> {
      if (!isSafeId(projectId)) return null;
      return readProject(projectId);
    },

    async updateProject(
      projectId: string,
      update: (project: StudioProject) => StudioProject,
      expectedRevision?: number
    ): Promise<StudioProject> {
      if (!isSafeId(projectId)) throw new CreativeStudioStoreError('invalid_payload', 'Invalid Studio project id');
      if (expectedRevision !== undefined && !isIntegerInRange(expectedRevision, 1, Number.MAX_SAFE_INTEGER)) {
        throw new CreativeStudioStoreError('invalid_payload', 'Invalid Studio project revision');
      }
      return enqueue(projectId, async () => {
        const current = await readProject(projectId);
        if (current === null) throw new CreativeStudioStoreError('not_found', 'Studio project not found');
        if (expectedRevision !== undefined && expectedRevision !== current.revision) {
          throw new CreativeStudioStoreError('stale_project', 'Studio project has changed');
        }
        const updated = update(structuredClone(current));
        if (!isRecord(updated) || updated.id !== current.id || updated.createdAt !== current.createdAt) {
          throw new CreativeStudioStoreError('invalid_payload', 'Studio project identity cannot change');
        }
        const next: StudioProject = {
          ...updated,
          schemaVersion: 1,
          revision: current.revision + 1,
          updatedAt: now(),
        };
        if (!validateProject(next))
          throw new CreativeStudioStoreError('invalid_payload', 'Invalid Studio project payload');
        if (!terminalJobsRemainImmutable(current, next)) {
          throw new CreativeStudioStoreError('invalid_payload', 'Terminal Studio jobs are immutable');
        }
        await writeJsonAtomic(projectFile(projectId), next);
        await repairSummaryIndex();
        return next;
      });
    },

    async deleteProject(projectId: string): Promise<boolean> {
      if (!isSafeId(projectId)) return false;
      return enqueue(projectId, async () => {
        if ((await readProject(projectId)) === null) return false;
        const targetDir = projectDir(projectId);
        try {
          const [canonicalRoot, targetStats] = await Promise.all([fs.realpath(rootDir), fs.lstat(targetDir)]);
          if (!targetStats.isDirectory() || targetStats.isSymbolicLink()) return false;
          const canonicalTarget = await fs.realpath(targetDir);
          if (!canonicalTarget.startsWith(canonicalRoot + path.sep)) return false;
          await fs.rm(targetDir, { recursive: true, force: false });
        } catch (error) {
          throw new CreativeStudioStoreError(
            'storage_error',
            error instanceof Error ? error.message : 'Studio project deletion failed'
          );
        }
        await repairSummaryIndex();
        return true;
      });
    },
  };
};
