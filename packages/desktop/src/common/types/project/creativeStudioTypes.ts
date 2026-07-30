/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

/** Shared, renderer-safe Creative Studio domain and desktop contract types. */

export type StudioMediaKind = 'image' | 'video';

export type StudioAspectRatio = '16:9' | '9:16' | '1:1' | '4:3' | '3:4';

export type StudioResolution = '720p' | '1080p';

export type StudioJobStatus =
  | 'queued_local'
  | 'submitting'
  | 'queued_remote'
  | 'running'
  | 'needs_attention'
  | 'succeeded'
  | 'failed'
  | 'cancelled';

export type StudioProviderAdapterId = 'weprompt-image-v1' | 'byteplus-seedance-v1' | 'weprompt-media-gateway-v1';

export type StudioProviderRef = {
  providerId: string;
  adapterId: StudioProviderAdapterId;
  model: string;
};

/** An app-managed asset identity, deliberately not a filesystem path or URL. */
export type StudioManagedAssetRef = {
  collection: 'assets' | 'imports' | 'thumbnails';
  fileName: string;
};

export type StudioAsset = {
  id: string;
  projectId: string;
  sceneId: string;
  mediaKind: StudioMediaKind;
  mimeType: string;
  managedAsset: StudioManagedAssetRef;
  byteSize: number;
  createdAt: string;
};

export type StudioJobErrorCode =
  | 'invalid_request'
  | 'auth'
  | 'quota'
  | 'rate_limited'
  | 'provider_unavailable'
  | 'timeout'
  | 'no_output'
  | 'submission_unknown'
  | 'download_failed'
  | 'unsupported'
  | 'unknown';

export type StudioJobError = {
  code: StudioJobErrorCode;
  messageKey: string;
};

export type StudioJob = {
  id: string;
  projectId: string;
  sceneId: string;
  status: StudioJobStatus;
  provider: StudioProviderRef;
  idempotencyKey: string;
  providerJobId: string | null;
  outputAssetIds: string[];
  error: StudioJobError | null;
  createdAt: string;
  updatedAt: string;
};

export type StudioSceneReviewState = 'draft' | 'ready' | 'generating' | 'complete' | 'blocked';

export type StudioScene = {
  id: string;
  title: string;
  purpose: string;
  visualPrompt: string;
  narration: string;
  onScreenText: string;
  mediaKind: StudioMediaKind;
  durationSeconds: number;
  referenceAssetId: string | null;
  selectedAssetId: string | null;
  assetIds: string[];
  jobIds: string[];
  reviewState: StudioSceneReviewState;
};

export type StudioRoutingPreferences = {
  image: StudioProviderRef | null;
  video: StudioProviderRef | null;
};

export type StudioProject = {
  schemaVersion: 1;
  revision: number;
  id: string;
  name: string;
  brief: string;
  forgeProjectId?: string;
  aspectRatio: StudioAspectRatio;
  targetDurationSeconds: number;
  resolution: StudioResolution;
  sceneOrder: string[];
  scenes: Record<string, StudioScene>;
  assets: Record<string, StudioAsset>;
  jobs: Record<string, StudioJob>;
  routing: StudioRoutingPreferences;
  createdAt: string;
  updatedAt: string;
};

export type StudioProjectSummary = {
  id: string;
  name: string;
  forgeProjectId?: string;
  aspectRatio: StudioAspectRatio;
  targetDurationSeconds: number;
  resolution: StudioResolution;
  sceneCount: number;
  createdAt: string;
  updatedAt: string;
};

export type CreateStudioProjectInput = {
  /** Internal callers may supply a safe ID; the normal desktop flow omits it. */
  id?: string;
  name: string;
  brief: string;
  forgeProjectId?: string;
  aspectRatio: StudioAspectRatio;
  targetDurationSeconds: number;
  resolution: StudioResolution;
};

export type StudioRouteConstraintIssue = {
  code: 'provider_unavailable' | 'unsupported_media' | 'invalid_duration' | 'invalid_resolution' | 'invalid_reference';
  messageKey: string;
};

export type StudioRouteValidation = {
  valid: boolean;
  normalized: {
    aspectRatio: StudioAspectRatio;
    resolution: StudioResolution;
    durationSeconds: number;
  };
  issues: StudioRouteConstraintIssue[];
};

export type StudioRouteCatalogEntry = {
  route: StudioProviderRef;
  mediaKinds: StudioMediaKind[];
  validation: StudioRouteValidation;
};

export type StudioRouteCatalog = {
  planningReady: boolean;
  routes: StudioRouteCatalogEntry[];
};

export type StudioCommandErrorCode =
  | 'invalid_payload'
  | 'not_found'
  | 'storyboard_exists'
  | 'stale_project'
  | 'planning_unavailable'
  | 'invalid_route'
  | 'cancellation_refused'
  | 'busy'
  | 'provider_error'
  | 'storage_error';

export type StudioCommandResult<T> =
  | { ok: true; data: T }
  | {
      ok: false;
      error: {
        code: StudioCommandErrorCode;
        messageKey: string;
      };
    };

export type StudioProjectRequest = {
  projectId: string;
};

export type StudioUpdateProjectRequest = StudioProjectRequest & {
  expectedRevision: number;
  name?: string;
  brief?: string;
  aspectRatio?: StudioAspectRatio;
  targetDurationSeconds?: number;
  resolution?: StudioResolution;
};

export type StudioUpdateSceneRequest = StudioProjectRequest & {
  sceneId: string;
  expectedRevision: number;
  scene: StudioScene;
};

export type StudioReorderScenesRequest = StudioProjectRequest & {
  expectedRevision: number;
  sceneOrder: string[];
};

export type StudioAssetRequest = StudioProjectRequest & {
  assetId: string;
};

export type StudioSelectVariationRequest = StudioProjectRequest & {
  sceneId: string;
  assetId: string;
  expectedRevision: number;
};

export type StudioJobRequest = StudioProjectRequest & {
  jobId: string;
};

export type StudioSubmitScenesRequest = StudioProjectRequest & {
  sceneIds: string[];
  expectedRevision: number;
};

export type StudioExportAssetsRequest = StudioProjectRequest & {
  includeReferences: boolean;
};

export type StudioExportResult = {
  exportedAssetIds: string[];
  missingAssetIds: string[];
};

/** The renderer-facing native API. Inputs and outputs contain IDs and metadata only. */
export type StudioDesktopApi = {
  listProjects(): Promise<StudioCommandResult<StudioProjectSummary[]>>;
  createProject(input: CreateStudioProjectInput): Promise<StudioCommandResult<StudioProject>>;
  getProject(input: StudioProjectRequest): Promise<StudioCommandResult<StudioProject | null>>;
  updateProject(input: StudioUpdateProjectRequest): Promise<StudioCommandResult<StudioProject>>;
  updateScene(input: StudioUpdateSceneRequest): Promise<StudioCommandResult<StudioProject>>;
  reorderScenes(input: StudioReorderScenesRequest): Promise<StudioCommandResult<StudioProject>>;
  importReference(input: StudioProjectRequest): Promise<StudioCommandResult<StudioAsset | null>>;
  selectVariation(input: StudioSelectVariationRequest): Promise<StudioCommandResult<StudioProject>>;
  submitScenes(input: StudioSubmitScenesRequest): Promise<StudioCommandResult<StudioJob[]>>;
  cancelJob(input: StudioJobRequest): Promise<StudioCommandResult<StudioJob>>;
  retryJob(input: StudioJobRequest): Promise<StudioCommandResult<StudioJob>>;
  exportAssets(input: StudioExportAssetsRequest): Promise<StudioCommandResult<StudioExportResult>>;
};
