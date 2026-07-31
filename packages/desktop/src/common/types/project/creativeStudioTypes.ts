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

export type StudioTextModelRef = {
  providerId: string;
  model: string;
};

export type StudioTextModelOption = StudioTextModelRef & {
  providerName: string;
  health: 'available' | 'unknown';
};

/** Main-issued media choice identity plus renderer-safe display metadata. */
export type StudioMediaChoiceRef = {
  choiceId: string;
  providerId: string;
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
  /** Null for project-level reference material that is not attached to a scene. */
  sceneId: string | null;
  mediaKind: StudioMediaKind;
  mimeType: string;
  managedAsset: StudioManagedAssetRef;
  byteSize: number;
  sha256: string;
  width?: number;
  height?: number;
  durationSeconds?: number;
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

export type StudioJobRetryReason = 'provider_failure' | 'submission_unknown';

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
  progress?: number;
  retryOfJobId: string | null;
  retryReason: StudioJobRetryReason | null;
  duplicateChargeAcknowledged: boolean;
  duplicateChargeAcknowledgedAt: string | null;
  createdAt: string;
  updatedAt: string;
};

/** Renderer-facing job metadata. Provider task, adapter, and charge identities stay in main. */
export type StudioRendererJob = Omit<StudioJob, 'provider' | 'idempotencyKey' | 'providerJobId'> & {
  provider: StudioMediaChoiceRef;
  /** Main-derived recovery capability; never exposes the durable provider task identity. */
  canRetryDownload: boolean;
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

/** Fields a renderer editor may supply; operational scene state remains main-owned. */
export type StudioEditableScene = Pick<
  StudioScene,
  | 'title'
  | 'purpose'
  | 'visualPrompt'
  | 'narration'
  | 'onScreenText'
  | 'mediaKind'
  | 'durationSeconds'
  | 'referenceAssetId'
>;

export type StudioRoutingPreferences = {
  storyboard: StudioTextModelRef | null;
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

export type StudioRendererRoutingPreferences = {
  storyboard: StudioTextModelRef | null;
  image: StudioMediaChoiceRef | null;
  video: StudioMediaChoiceRef | null;
};

/** Renderer-facing project metadata with nested jobs and media selections sanitized. */
export type StudioRendererProject = Omit<StudioProject, 'jobs' | 'routing'> & {
  jobs: Record<string, StudioRendererJob>;
  routing: StudioRendererRoutingPreferences;
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
  name: string;
  brief: string;
  forgeProjectId?: string;
  aspectRatio: StudioAspectRatio;
  targetDurationSeconds: number;
  resolution: StudioResolution;
};

export type StudioRouteIssue = {
  code: 'provider_unavailable' | 'unsupported_media' | 'invalid_duration' | 'invalid_resolution' | 'invalid_reference';
};

export type NormalizedStudioGenerationParameters = {
  aspectRatio: StudioAspectRatio;
  resolution: StudioResolution;
  durationSeconds: number;
};

export type StudioRouteValidation =
  | {
      ok: true;
      normalized: {
        aspectRatio: StudioAspectRatio;
        resolution: StudioResolution;
        durationSeconds: number;
      };
    }
  | {
      ok: false;
      issues: StudioRouteIssue[];
    };

export type StudioConnectionCandidateModel = {
  model: string;
  health: 'available' | 'unknown' | 'unavailable';
};

export type StudioConnectionCandidate = {
  providerId: string;
  providerName: string;
  models: StudioConnectionCandidateModel[];
};

export type StudioRouteCatalogEntry = {
  choiceId: string;
  providerId: string;
  providerName: string;
  model: string;
  health: 'available' | 'unknown' | 'unavailable';
  kind: StudioMediaKind;
  constraints: StudioRouteConstraints;
};

export type StudioConnectionCapabilities = {
  mediaKinds: StudioMediaKind[];
  audioModes?: string[];
  aspectRatios?: StudioAspectRatio[];
  resolutions?: StudioResolution[];
  minDurationSeconds?: number;
  maxDurationSeconds?: number;
  supportsFirstFrame?: boolean;
  cancellation?: boolean;
};

export type StudioRouteConstraints = {
  aspectRatios: StudioAspectRatio[];
  resolutions: StudioResolution[];
  minDurationSeconds: number;
  maxDurationSeconds: number;
  supportsFirstFrame: boolean;
  silentOutput: boolean;
};

/** Credential-free durable record stored in connections.json. */
export type StudioConnectionBinding = {
  schemaVersion: 1;
  id: string;
  providerId: string;
  adapterId: StudioProviderAdapterId;
  model: string;
  capabilities: StudioConnectionCapabilities;
  validatedAt: string;
};

export type StudioConnectionIntegrationLabelKey = 'imageApi' | 'bytePlusSeedance' | 'selfHostedVideoGateway';

export type StudioConnectionIntegration = {
  integrationId: string;
  kind: StudioMediaKind;
  labelKey: StudioConnectionIntegrationLabelKey;
};

export type StudioConnectionRecord = {
  bindingId: string;
  providerId: string;
  integrationId: string;
  labelKey: StudioConnectionIntegrationLabelKey;
  model: string;
  capabilities: StudioConnectionCapabilities;
  validatedAt: string;
};

export type StudioConnectionInventory = {
  integrations: StudioConnectionIntegration[];
  connections: StudioConnectionRecord[];
};

export type StudioConnectionValidationResult = Omit<StudioConnectionRecord, 'bindingId'>;

export type StudioModelAvailability = 'ready' | 'selection_required' | 'setup_required' | 'unavailable';

export type StudioRouteCatalog = {
  storyboard: {
    status: StudioModelAvailability;
    selected: StudioTextModelRef | null;
    options: StudioTextModelOption[];
  };
  image: {
    status: StudioModelAvailability;
    selected: StudioMediaChoiceRef | null;
    options: StudioRouteCatalogEntry[];
  };
  video: {
    status: StudioModelAvailability;
    selected: StudioMediaChoiceRef | null;
    options: StudioRouteCatalogEntry[];
  };
  catalogVersion: string;
};

export type StudioCommandErrorCode =
  | 'invalid_payload'
  | 'not_found'
  | 'storyboard_exists'
  | 'stale_project'
  | 'planning_unavailable'
  | 'invalid_route'
  | 'cancellation_refused'
  | 'duplicate_charge_acknowledgement_required'
  | 'unsupported'
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

export type ProposeStudioStoryboardInput = StudioProjectRequest & {
  expectedRevision: number;
  replaceExisting: boolean;
};

export type StudioDeleteProjectRequest = StudioProjectRequest & {
  expectedRevision: number;
};

export type StudioUpdateProjectRequest = StudioProjectRequest & {
  expectedRevision: number;
  name?: string;
  brief?: string;
  aspectRatio?: StudioAspectRatio;
  targetDurationSeconds?: number;
  resolution?: StudioResolution;
};

export type StudioModelSelectionChange =
  | {
      role: 'storyboard';
      selection: StudioTextModelRef | null;
    }
  | {
      role: 'image' | 'video';
      selection: Pick<StudioMediaChoiceRef, 'choiceId'> | null;
    };

export type StudioUpdateModelSelectionRequest = StudioProjectRequest & {
  expectedRevision: number;
  role: StudioModelSelectionChange['role'];
  selection: StudioTextModelRef | Pick<StudioMediaChoiceRef, 'choiceId'> | null;
};

export type StudioUpdateSceneRequest = StudioProjectRequest & {
  sceneId: string;
  expectedRevision: number;
  scene: StudioEditableScene | null;
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

export type StudioSelectAssetRequest = StudioSelectVariationRequest;

export type StudioJobRequest = StudioProjectRequest & {
  jobId: string;
  expectedRevision: number;
};

export type StudioRetryJobRequest = StudioJobRequest & {
  acknowledgePossibleDuplicateCharge?: boolean;
};

export type StudioRetryDownloadRequest = StudioJobRequest;

export type StudioSceneGenerationChoice = {
  sceneId: string;
  choiceId: string;
  kind: StudioMediaKind;
};

export type StudioSubmitScenesRequest = StudioProjectRequest & {
  sceneIds: string[];
  expectedRevision: number;
  routes: StudioSceneGenerationChoice[];
  catalogVersion: string;
};

export type StudioChooseAndImportReferenceRequest = StudioProjectRequest & {
  sceneId?: string;
  expectedRevision: number;
};

export type StudioChooseAndExportAssetsRequest = StudioProjectRequest & {
  includeReferences: boolean;
};

export type StudioListRoutesRequest = { projectId?: string };

export type StudioValidateConnectionRequest = {
  providerId: string;
  integrationId: string;
  model: string;
};

export type StudioSaveConnectionRequest = StudioValidateConnectionRequest;

export type StudioRemoveConnectionRequest = { bindingId: string };

export type StudioImportOutcome = { status: 'imported'; asset: StudioAsset } | { status: 'cancelled' };

export type StudioExportItem = { assetId: string; fileName: string };

export type StudioExportOutcome =
  | { status: 'exported'; folderName: string; exported: StudioExportItem[]; missingSceneIds: string[] }
  | { status: 'cancelled' };

/** The renderer-facing native API. Inputs and outputs contain IDs and metadata only. */
export type StudioDesktopApi = {
  listProjects(): Promise<StudioCommandResult<StudioProjectSummary[]>>;
  createProject(input: CreateStudioProjectInput): Promise<StudioCommandResult<StudioRendererProject>>;
  getProject(input: StudioProjectRequest): Promise<StudioCommandResult<StudioRendererProject | null>>;
  proposeStoryboard(input: ProposeStudioStoryboardInput): Promise<StudioCommandResult<StudioRendererProject>>;
  updateModelSelection(input: StudioUpdateModelSelectionRequest): Promise<StudioCommandResult<StudioRendererProject>>;
  updateProject(input: StudioUpdateProjectRequest): Promise<StudioCommandResult<StudioRendererProject>>;
  deleteProject(input: StudioDeleteProjectRequest): Promise<StudioCommandResult<boolean>>;
  updateScene(input: StudioUpdateSceneRequest): Promise<StudioCommandResult<StudioRendererProject>>;
  reorderScenes(input: StudioReorderScenesRequest): Promise<StudioCommandResult<StudioRendererProject>>;
  selectAsset(input: StudioSelectAssetRequest): Promise<StudioCommandResult<StudioRendererProject>>;
  chooseAndImportReference(
    input: StudioChooseAndImportReferenceRequest
  ): Promise<StudioCommandResult<StudioImportOutcome>>;
  selectVariation(input: StudioSelectVariationRequest): Promise<StudioCommandResult<StudioRendererProject>>;
  submitScenes(input: StudioSubmitScenesRequest): Promise<StudioCommandResult<StudioRendererJob[]>>;
  cancelJob(input: StudioJobRequest): Promise<StudioCommandResult<StudioRendererJob>>;
  retryJob(input: StudioRetryJobRequest): Promise<StudioCommandResult<StudioRendererJob>>;
  retryDownload(input: StudioRetryDownloadRequest): Promise<StudioCommandResult<StudioRendererJob>>;
  chooseAndExportAssets(input: StudioChooseAndExportAssetsRequest): Promise<StudioCommandResult<StudioExportOutcome>>;
  listConnectionCandidates(): Promise<StudioCommandResult<StudioConnectionCandidate[]>>;
  listConnections(): Promise<StudioCommandResult<StudioConnectionInventory>>;
  validateConnection(
    input: StudioValidateConnectionRequest
  ): Promise<StudioCommandResult<StudioConnectionValidationResult>>;
  saveConnection(input: StudioSaveConnectionRequest): Promise<StudioCommandResult<StudioConnectionRecord>>;
  removeConnection(input: StudioRemoveConnectionRequest): Promise<StudioCommandResult<boolean>>;
  listRoutes(input?: StudioListRoutesRequest): Promise<StudioCommandResult<StudioRouteCatalog>>;
};
