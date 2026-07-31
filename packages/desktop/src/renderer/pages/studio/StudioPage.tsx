/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import { Button, Checkbox, Modal, Spin } from '@arco-design/web-react';
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useNavigate, useParams } from 'react-router-dom';

import { ipcBridge } from '@/common';
import type {
  StudioRendererProject,
  StudioRouteCatalog,
  StudioRouteCatalogEntry,
  StudioScene,
  StudioSceneRouteSnapshot,
  StudioSelectVariationRequest,
} from '@/common/types/project/creativeStudioTypes';

import {
  AssetStrip,
  GenerationControls,
  GenerationReviewModal,
  type GenerationBatchReviewRequest,
  type GenerationReviewScene,
  type GenerationSingleReviewRequest,
  SceneTimeline,
  SceneInspector,
  StagePreview,
  StoryboardDraftModal,
  StoryboardPanel,
  StudioHeader,
  StudioLibrary,
  StudioModelBar,
  StudioNavigationLock,
} from './components';
import { useStoryboardEditor, useStudioJobs, useStudioModels, useStudioProject } from './hooks';
import styles from './StudioPage.module.css';

type GenerationReviewState = {
  mode: 'single' | 'batch';
  scenes: GenerationReviewScene[];
  catalogVersion: string | null;
  availableRoutes: StudioRouteCatalogEntry[];
  projectId: string;
  projectRevision: number;
};

const routeIdentity = (
  route: Pick<StudioRouteCatalogEntry | StudioSceneRouteSnapshot, 'providerId' | 'adapterId' | 'model' | 'kind'>
): string => `${route.providerId}\u0000${route.adapterId}\u0000${route.model}\u0000${route.kind}`;

const routeIsCompatible = (
  project: StudioRendererProject,
  scene: StudioScene,
  route: StudioSceneRouteSnapshot,
  availableRoutes: readonly StudioRouteCatalogEntry[]
): boolean => {
  const catalogRoute = availableRoutes.find((candidate) => routeIdentity(candidate) === routeIdentity(route));
  if (
    catalogRoute === undefined ||
    catalogRoute.health === 'unavailable' ||
    route.sceneId !== scene.id ||
    route.kind !== scene.mediaKind
  ) {
    return false;
  }

  const { constraints } = catalogRoute;
  return (
    constraints.silentOutput &&
    constraints.aspectRatios.includes(project.aspectRatio) &&
    constraints.resolutions.includes(project.resolution) &&
    scene.durationSeconds >= constraints.minDurationSeconds &&
    scene.durationSeconds <= constraints.maxDurationSeconds &&
    (scene.referenceAssetId === null || constraints.supportsFirstFrame)
  );
};

const toReviewScene = (
  project: StudioRendererProject,
  scene: StudioScene,
  route: StudioSceneRouteSnapshot | null,
  availableRoutes: readonly StudioRouteCatalogEntry[],
  routeStatus?: 'valid' | 'invalid' | 'missing'
): GenerationReviewScene => {
  const catalogRoute =
    route === null ? undefined : availableRoutes.find((candidate) => routeIdentity(candidate) === routeIdentity(route));
  return {
    id: scene.id,
    title: scene.title,
    mediaKind: scene.mediaKind,
    durationSeconds: scene.durationSeconds,
    route:
      route === null
        ? { status: 'missing', snapshot: null, providerName: null }
        : {
            status:
              routeStatus === 'invalid' || !routeIsCompatible(project, scene, route, availableRoutes)
                ? 'invalid'
                : 'valid',
            snapshot: route,
            providerName: catalogRoute?.providerName ?? null,
          },
  };
};

const catalogEntries = (catalog: StudioRouteCatalog): StudioRouteCatalogEntry[] => [
  ...catalog.image.options,
  ...catalog.video.options,
];

const projectRouteSnapshot = (
  project: StudioRendererProject,
  scene: Pick<StudioScene, 'id' | 'mediaKind'>
): StudioSceneRouteSnapshot | null => {
  const selected = project.routing[scene.mediaKind];
  return selected === null
    ? null
    : {
        sceneId: scene.id,
        providerId: selected.providerId,
        adapterId: selected.adapterId,
        model: selected.model,
        kind: scene.mediaKind,
      };
};

const sceneHasActiveGenerationJob = (project: StudioRendererProject, scene: StudioScene): boolean =>
  scene.jobIds.some((jobId) => {
    const job = project.jobs[jobId];
    return (
      job?.projectId === project.id &&
      job.sceneId === scene.id &&
      !['succeeded', 'failed', 'cancelled'].includes(job.status)
    );
  });

const sceneCanOpenSingleReview = (project: StudioRendererProject, scene: StudioScene): boolean =>
  scene.visualPrompt.trim().length > 0 &&
  scene.reviewState !== 'generating' &&
  !sceneHasActiveGenerationJob(project, scene);

const StudioProjectShell: React.FC = () => {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const { id } = useParams<{ id: string }>();
  const {
    project: loadedProject,
    loading,
    notFound,
    errorMessageKey,
    refetch,
  } = useStudioProject(id, {
    subscribeToUpdates: false,
  });
  const editor = useStoryboardEditor({ project: loadedProject, refetch });
  const studioJobs = useStudioJobs({
    project: editor.project ?? loadedProject,
    refetch,
    reconcileOnSubscribe: true,
  });
  const project = studioJobs.project ?? editor.project ?? loadedProject;
  const studioModels = useStudioModels({
    project,
    refetch,
    beforeMutation: async () => {
      if (editor.mutationPending) return false;
      return editor.hasUnsavedSelectedSceneDraft ? editor.flushSceneDraft() : true;
    },
  });
  const [draftModalVisible, setDraftModalVisible] = useState(false);
  const [generationReview, setGenerationReview] = useState<GenerationReviewState | null>(null);
  const [headerBatchLoading, setHeaderBatchLoading] = useState(false);
  const [headerGenerationIssue, setHeaderGenerationIssue] = useState<string | null>(null);
  const [generationReviewIssueMessageKey, setGenerationReviewIssueMessageKey] = useState<string | null>(null);
  const [generationReviewRefreshing, setGenerationReviewRefreshing] = useState(false);
  const [duplicateChargeJobId, setDuplicateChargeJobId] = useState<string | null>(null);
  const [variationPending, setVariationPending] = useState(false);
  const [variationIssueMessageKey, setVariationIssueMessageKey] = useState<string | null>(null);
  const [referenceImportSceneId, setReferenceImportSceneId] = useState<string | null>(null);
  const [referenceImportIssue, setReferenceImportIssue] = useState<{
    sceneId: string;
    messageKey: string;
  } | null>(null);
  const [exportVisible, setExportVisible] = useState(false);
  const [exportPending, setExportPending] = useState(false);
  const [exportIncludeReferences, setExportIncludeReferences] = useState(false);
  const [exportedFolderName, setExportedFolderName] = useState<string | null>(null);
  const [exportMissingSceneIds, setExportMissingSceneIds] = useState<string[]>([]);
  const [exportIssueMessageKey, setExportIssueMessageKey] = useState<string | null>(null);
  const headerBatchLoadingRef = useRef(false);
  const generationReviewRefreshingRef = useRef(false);
  const variationPendingRef = useRef(false);
  const referenceImportSceneIdRef = useRef<string | null>(null);
  const canonicalProjectRef = useRef<StudioRendererProject | null>(project);
  canonicalProjectRef.current = project;
  const draftConflict = editor.conflict?.operation === 'draft_storyboard' ? editor.conflict : null;
  const nonDraftConflict =
    editor.conflict !== null && editor.conflict.operation !== 'draft_storyboard' ? editor.conflict : null;
  const nonSaveConflict =
    nonDraftConflict !== null && nonDraftConflict.operation !== 'save_scene' ? nonDraftConflict : null;
  const nonDraftError =
    editor.error !== null && editor.error.operation !== 'draft_storyboard' && editor.error.operation !== 'save_scene'
      ? editor.error
      : null;
  const saveConflict = editor.conflict?.operation === 'save_scene' ? editor.conflict : null;
  const selectedSaveIssue = editor.saveIssues.find((issue) => issue.sceneId === editor.selectedScene?.id) ?? null;
  const sceneIssue =
    nonSaveConflict === null ? (saveConflict ?? selectedSaveIssue ?? editor.saveIssues[0] ?? null) : null;
  const inspectorSceneIssue =
    sceneIssue !== null && editor.selectedScene?.id === sceneIssue.sceneId ? sceneIssue : null;
  const panelSceneIssue = sceneIssue !== null && inspectorSceneIssue === null ? sceneIssue : null;
  const panelConflict = panelSceneIssue?.code === 'stale_project' ? panelSceneIssue : nonSaveConflict;
  const inspectorConflict = inspectorSceneIssue?.code === 'stale_project';
  const inspectorRecoveryVisible = inspectorSceneIssue !== null;
  const panelRecoveryVisible = panelConflict !== null || panelSceneIssue !== null;
  const draftErrorMessageKey =
    editor.error?.operation === 'draft_storyboard'
      ? editor.error.messageKey
      : draftConflict
        ? draftConflict.messageKey
        : studioModels.errorMessageKey;
  const canonicalOrderedScenes = useMemo(
    () =>
      project === null
        ? []
        : project.sceneOrder.flatMap((sceneId) => {
            const scene = project.scenes[sceneId];
            return scene === undefined ? [] : [scene];
          }),
    [project]
  );
  const readyScenes = useMemo(
    () =>
      canonicalOrderedScenes.filter(
        (scene) => project !== null && sceneCanOpenSingleReview(project, scene) && scene.selectedAssetId === null
      ),
    [canonicalOrderedScenes, project]
  );
  const hasSelectedExportAssets = useMemo(
    () =>
      project !== null &&
      project.sceneOrder.some((sceneId) => {
        const scene = project.scenes[sceneId];
        if (scene?.selectedAssetId === null || scene?.selectedAssetId === undefined) return false;
        const selected = project.assets[scene.selectedAssetId];
        return (
          selected?.projectId === project.id &&
          selected.sceneId === scene.id &&
          selected.mediaKind === scene.mediaKind &&
          selected.managedAsset.collection === 'assets' &&
          scene.assetIds.includes(selected.id)
        );
      }),
    [project]
  );
  const selectedScene =
    project !== null && editor.selectedSceneId !== null ? (project.scenes[editor.selectedSceneId] ?? null) : null;
  const selectedAsset =
    project !== null && selectedScene?.selectedAssetId ? (project.assets[selectedScene.selectedAssetId] ?? null) : null;
  const selectedReferenceAsset =
    project !== null && selectedScene?.referenceAssetId
      ? (project.assets[selectedScene.referenceAssetId] ?? null)
      : null;
  const posterAsset = useMemo(() => {
    if (
      project === null ||
      selectedScene === null ||
      selectedScene.mediaKind !== 'video' ||
      selectedScene.selectedAssetId === null
    ) {
      return null;
    }
    const producingJobs = selectedScene.jobIds
      .map((jobId) => project.jobs[jobId])
      .filter(
        (job) =>
          job?.status === 'succeeded' &&
          job.sceneId === selectedScene.id &&
          job.outputAssetIds[0] === selectedScene.selectedAssetId
      );
    if (producingJobs.length !== 1) return null;
    const producingJob = producingJobs[0]!;
    const posters = producingJob.outputAssetIds
      .slice(1)
      .map((assetId) => project.assets[assetId])
      .filter(
        (asset) =>
          asset?.projectId === project.id &&
          asset.sceneId === selectedScene.id &&
          asset.mediaKind === 'image' &&
          asset.managedAsset.collection === 'thumbnails' &&
          selectedScene.assetIds.includes(asset.id)
      );
    return posters.length === 1 ? posters[0]! : null;
  }, [project, selectedScene]);
  const selectedSceneJobs = useMemo(
    () =>
      selectedScene === null
        ? []
        : studioJobs.jobs.filter((job) => job.sceneId === selectedScene.id && selectedScene.jobIds.includes(job.id)),
    [selectedScene, studioJobs.jobs]
  );
  const canonicalMutationPending =
    editor.mutationPending || studioJobs.mutationPending || variationPending || headerBatchLoading;
  const generationBlocked =
    project === null ||
    editor.hasUnsavedSceneDrafts ||
    editor.conflict !== null ||
    editor.drafting ||
    canonicalMutationPending ||
    referenceImportSceneId !== null;
  const exportBlocked = generationBlocked;
  const generationActionIssue =
    studioJobs.issue?.jobId !== undefined && selectedSceneJobs.some((job) => job.id === studioJobs.issue?.jobId)
      ? {
          jobId: studioJobs.issue.jobId,
          code: studioJobs.issue.code,
          messageKey: studioJobs.issue.messageKey,
        }
      : null;

  const handleDraftStoryboard = useCallback(
    async (replaceExisting: boolean): Promise<void> => {
      if (await editor.proposeStoryboard(replaceExisting)) setDraftModalVisible(false);
    },
    [editor]
  );

  const openSingleReview = useCallback(
    (request: GenerationSingleReviewRequest): void => {
      if (project === null || generationBlocked || request.catalogVersion === null) return;
      const scene = project.scenes[request.sceneId];
      if (scene === undefined || !sceneCanOpenSingleReview(project, scene)) {
        return;
      }
      studioJobs.clearIssue();
      setHeaderGenerationIssue(null);
      setGenerationReviewIssueMessageKey(null);
      setGenerationReview({
        mode: 'single',
        scenes: [toReviewScene(project, scene, request.route, request.availableRoutes, request.routeStatus)],
        catalogVersion: request.catalogVersion,
        availableRoutes: request.availableRoutes,
        projectId: project.id,
        projectRevision: project.revision,
      });
    },
    [generationBlocked, project, studioJobs]
  );

  const openBatchReview = useCallback(
    (request: GenerationBatchReviewRequest): void => {
      if (project === null || generationBlocked || request.catalogVersion === null || readyScenes.length === 0) return;
      const scenes = readyScenes.map((scene) => {
        const resolved = request.routes[scene.mediaKind];
        const route = resolved === null ? null : { sceneId: scene.id, ...resolved.route };
        return toReviewScene(project, scene, route, request.availableRoutes, resolved?.routeStatus);
      });
      studioJobs.clearIssue();
      setHeaderGenerationIssue(null);
      setGenerationReviewIssueMessageKey(null);
      setGenerationReview({
        mode: 'batch',
        scenes,
        catalogVersion: request.catalogVersion,
        availableRoutes: request.availableRoutes,
        projectId: project.id,
        projectRevision: project.revision,
      });
    },
    [generationBlocked, project, readyScenes, studioJobs]
  );

  const openHeaderBatchReview = useCallback(async (): Promise<void> => {
    if (
      project === null ||
      generationBlocked ||
      readyScenes.length === 0 ||
      headerBatchLoading ||
      headerBatchLoadingRef.current
    ) {
      return;
    }
    headerBatchLoadingRef.current = true;
    setHeaderBatchLoading(true);
    setHeaderGenerationIssue(null);
    const reviewedProjectId = project.id;
    const reviewedProjectRevision = project.revision;
    try {
      let catalog = studioModels.catalog;
      if (catalog === null) {
        await studioModels.refresh();
        catalog = studioModels.catalog;
        if (catalog === null) {
          setHeaderGenerationIssue('conversation.creativeStudio.models.loading');
          return;
        }
      }
      const canonical = canonicalProjectRef.current;
      if (canonical?.id !== reviewedProjectId || canonical.revision !== reviewedProjectRevision) {
        setHeaderGenerationIssue('conversation.creativeStudio.errors.staleProject');
        return;
      }
      const selectedRoute = (kind: 'image' | 'video') => {
        const route = project.routing[kind];
        return route === null
          ? null
          : {
              route: {
                providerId: route.providerId,
                adapterId: route.adapterId,
                model: route.model,
                kind,
              },
              routeStatus: 'valid' as const,
            };
      };
      openBatchReview({
        catalogVersion: catalog.catalogVersion,
        routes: {
          image: selectedRoute('image'),
          video: selectedRoute('video'),
        },
        availableRoutes: catalogEntries(catalog),
      });
    } catch {
      setHeaderGenerationIssue('conversation.creativeStudio.errors.provider');
    } finally {
      headerBatchLoadingRef.current = false;
      setHeaderBatchLoading(false);
    }
  }, [generationBlocked, headerBatchLoading, openBatchReview, project, readyScenes.length, studioModels]);

  const confirmGeneration = useCallback(
    async ({ sceneIds, routes }: { sceneIds: string[]; routes: StudioSceneRouteSnapshot[] }): Promise<void> => {
      if (
        generationReview?.catalogVersion === null ||
        generationReview === null ||
        project === null ||
        generationReviewRefreshingRef.current
      ) {
        return;
      }

      if (generationReview.projectId !== project.id || generationReview.projectRevision !== project.revision) {
        generationReviewRefreshingRef.current = true;
        setGenerationReviewRefreshing(true);
        setGenerationReviewIssueMessageKey('conversation.creativeStudio.errors.staleProject');
        studioJobs.clearIssue();
        studioJobs.clearStaleIntent();
        try {
          await studioModels.refresh();
          const catalog = studioModels.catalog;
          if (catalog === null) {
            setGenerationReviewIssueMessageKey('conversation.creativeStudio.models.loading');
            return;
          }
          const canonical = canonicalProjectRef.current;
          if (canonical?.id !== project.id || canonical.revision !== project.revision) {
            setGenerationReviewIssueMessageKey('conversation.creativeStudio.errors.staleProject');
            return;
          }
          const availableRoutes = catalogEntries(catalog);
          const refreshedScenes =
            generationReview.mode === 'single'
              ? generationReview.scenes.flatMap(({ id: sceneId }) => {
                  const scene = project.scenes[sceneId];
                  return scene === undefined || !sceneCanOpenSingleReview(project, scene)
                    ? []
                    : [toReviewScene(project, scene, projectRouteSnapshot(project, scene), availableRoutes)];
                })
              : readyScenes.map((scene) =>
                  toReviewScene(project, scene, projectRouteSnapshot(project, scene), availableRoutes)
                );
          setGenerationReview({
            mode: generationReview.mode,
            scenes: refreshedScenes,
            catalogVersion: catalog.catalogVersion,
            availableRoutes,
            projectId: project.id,
            projectRevision: project.revision,
          });
        } catch {
          setGenerationReviewIssueMessageKey('conversation.creativeStudio.errors.provider');
        } finally {
          generationReviewRefreshingRef.current = false;
          setGenerationReviewRefreshing(false);
        }
        return;
      }

      const submitted = await studioJobs.submitScenes({
        sceneIds,
        routes,
        catalogVersion: generationReview.catalogVersion,
        expectedRevision: generationReview.projectRevision,
      });
      if (submitted) setGenerationReview(null);
    },
    [generationReview, project, readyScenes, studioJobs, studioModels]
  );

  useEffect(() => {
    const staleIntent = studioJobs.staleIntent;
    if (staleIntent?.operation !== 'submit_scenes' || project === null) return;
    setGenerationReview((current) => {
      if (current === null) return null;
      const currentById = new Map(current.scenes.map((scene) => [scene.id, scene]));
      const availableRoutes =
        studioModels.catalog === null ? current.availableRoutes : catalogEntries(studioModels.catalog);
      return {
        ...current,
        catalogVersion: studioModels.catalog?.catalogVersion ?? staleIntent.catalogVersion,
        availableRoutes,
        projectId: project.id,
        projectRevision: project.revision,
        scenes: staleIntent.sceneIds.flatMap((sceneId) => {
          const scene = project.scenes[sceneId];
          const route = scene === undefined ? null : projectRouteSnapshot(project, scene);
          const eligible =
            scene !== undefined &&
            sceneCanOpenSingleReview(project, scene) &&
            (current.mode === 'single' || scene.selectedAssetId === null);
          if (eligible) {
            return [toReviewScene(project, scene, route, availableRoutes)];
          }
          const previous = currentById.get(sceneId);
          return previous === undefined
            ? []
            : [
                {
                  ...previous,
                  route:
                    previous.route.snapshot === null
                      ? previous.route
                      : {
                          status: 'invalid' as const,
                          snapshot: previous.route.snapshot,
                          providerName: previous.route.providerName,
                        },
                },
              ];
        }),
      };
    });
  }, [project, studioJobs.staleIntent, studioModels.catalog]);

  const handleSelectVariation = useCallback(
    async (request: StudioSelectVariationRequest): Promise<void> => {
      if (
        project === null ||
        canonicalMutationPending ||
        variationPendingRef.current ||
        editor.hasUnsavedSceneDrafts ||
        editor.conflict !== null ||
        request.projectId !== project.id
      ) {
        return;
      }
      const scene = project.scenes[request.sceneId];
      const asset = project.assets[request.assetId];
      if (
        scene === undefined ||
        asset === undefined ||
        asset.projectId !== project.id ||
        asset.sceneId !== scene.id ||
        asset.mediaKind !== scene.mediaKind ||
        asset.managedAsset.collection !== 'assets' ||
        !scene.assetIds.includes(asset.id)
      ) {
        return;
      }

      variationPendingRef.current = true;
      setVariationPending(true);
      setVariationIssueMessageKey(null);
      try {
        const result = await ipcBridge.creativeStudio.selectAsset.invoke({
          projectId: project.id,
          sceneId: scene.id,
          assetId: asset.id,
          expectedRevision: project.revision,
        });
        if (result.ok === false) {
          if (result.error.code === 'stale_project') await refetch();
          setVariationIssueMessageKey(result.error.messageKey);
          return;
        }
        await refetch();
      } catch {
        setVariationIssueMessageKey('conversation.creativeStudio.errors.storage');
      } finally {
        variationPendingRef.current = false;
        setVariationPending(false);
      }
    },
    [canonicalMutationPending, editor.conflict, editor.hasUnsavedSceneDrafts, project, refetch]
  );

  const handleImportReference = useCallback(async (): Promise<void> => {
    const sceneId = editor.selectedScene?.id;
    if (
      sceneId === undefined ||
      editor.conflict !== null ||
      editor.drafting ||
      editor.mutationPending ||
      studioJobs.mutationPending ||
      variationPending ||
      referenceImportSceneId !== null ||
      referenceImportSceneIdRef.current !== null
    ) {
      return;
    }

    referenceImportSceneIdRef.current = sceneId;
    setReferenceImportSceneId(sceneId);
    setReferenceImportIssue(null);
    try {
      const hadUnsavedSelectedSceneDraft = editor.hasUnsavedSelectedSceneDraft;
      const saved = await editor.flushSceneDraft();
      if (hadUnsavedSelectedSceneDraft && !saved) return;
      const canonical = await refetch();
      if (canonical === null || !Object.hasOwn(canonical.scenes, sceneId)) {
        setReferenceImportIssue({
          sceneId,
          messageKey: 'conversation.creativeStudio.errors.storage',
        });
        return;
      }
      const result = await ipcBridge.creativeStudio.chooseAndImportReference.invoke({
        projectId: canonical.id,
        sceneId,
        expectedRevision: canonical.revision,
      });
      if (result.ok === false) {
        if (result.error.code === 'stale_project') await refetch();
        setReferenceImportIssue({ sceneId, messageKey: result.error.messageKey });
        return;
      }
      if (result.data.status === 'imported') await refetch();
    } catch {
      setReferenceImportIssue({
        sceneId,
        messageKey: 'conversation.creativeStudio.errors.storage',
      });
    } finally {
      if (referenceImportSceneIdRef.current === sceneId) {
        referenceImportSceneIdRef.current = null;
      }
      setReferenceImportSceneId(null);
    }
  }, [editor, refetch, referenceImportSceneId, studioJobs.mutationPending, variationPending]);

  const handleExportAssets = useCallback(async (): Promise<void> => {
    if (exportBlocked || exportPending || project === null) return;
    setExportIssueMessageKey(null);
    setExportPending(true);
    try {
      const result = await ipcBridge.creativeStudio.chooseAndExportAssets.invoke({
        projectId: project.id,
        includeReferences: exportIncludeReferences,
      });
      if (result.ok === false) {
        setExportIssueMessageKey(result.error.messageKey);
      } else if (result.data.status === 'exported') {
        setExportedFolderName(result.data.folderName);
        setExportMissingSceneIds(result.data.missingSceneIds);
      } else {
        setExportVisible(false);
      }
    } catch {
      setExportIssueMessageKey('conversation.creativeStudio.export.failed');
    } finally {
      setExportPending(false);
    }
  }, [exportBlocked, exportIncludeReferences, exportPending, project]);

  if (loading) {
    return (
      <div className={styles.centered}>
        <Spin tip={t('conversation.creativeStudio.project.loading')} />
      </div>
    );
  }

  if (errorMessageKey && !project) {
    return (
      <div role='alert' className={styles.centered}>
        {t(errorMessageKey)}
      </div>
    );
  }

  if (notFound || !project) {
    return (
      <div className={styles.centered}>
        <p>{t('conversation.creativeStudio.project.notFound')}</p>
        <Button type='primary' onClick={() => navigate('/studio')}>
          {t('conversation.creativeStudio.library.openProject')}
        </Button>
      </div>
    );
  }

  return (
    <section aria-label={t('conversation.creativeStudio.project.title')} className={styles.projectShell}>
      <StudioNavigationLock
        locked={
          editor.hasUnsavedSceneDrafts ||
          editor.conflict !== null ||
          editor.drafting ||
          canonicalMutationPending ||
          referenceImportSceneId !== null ||
          generationReview !== null ||
          duplicateChargeJobId !== null ||
          exportVisible
        }
      />
      {(errorMessageKey || headerGenerationIssue) && (
        <div role='alert' className={styles.projectAlert}>
          {t(errorMessageKey ?? headerGenerationIssue!)}
        </div>
      )}
      <StudioHeader
        project={project}
        storyboard={studioModels.catalog?.storyboard ?? null}
        catalogLoading={studioModels.loading}
        catalogErrorMessageKey={draftErrorMessageKey}
        drafting={editor.drafting}
        draftDisabled={nonDraftConflict !== null}
        generationDisabled={generationBlocked || readyScenes.length === 0}
        generationPending={headerBatchLoading || studioJobs.mutationPending}
        exportDisabled={exportBlocked}
        exportPending={exportPending}
        onBack={() => navigate('/studio')}
        onOpenDraft={() => setDraftModalVisible(true)}
        onOpenGenerationReview={() => void openHeaderBatchReview()}
        onOpenExport={() => {
          if (exportBlocked) return;
          setExportIncludeReferences(false);
          setExportedFolderName(null);
          setExportMissingSceneIds([]);
          setExportIssueMessageKey(null);
          setExportVisible(true);
        }}
      />
      <StudioModelBar
        catalog={studioModels.catalog}
        loading={studioModels.loading}
        errorMessageKey={studioModels.errorMessageKey}
        pendingRole={studioModels.pendingRole}
        disabled={canonicalMutationPending || editor.drafting || studioJobs.mutationPending}
        onRefresh={studioModels.refresh}
        onSelectionChange={studioModels.updateSelection}
        onOpenSettings={(path) => navigate(path)}
      />
      <div className={styles.editorGrid}>
        <StoryboardPanel
          orderedScenes={editor.orderedScenes}
          selectedSceneId={editor.selectedSceneId}
          targetDurationSeconds={project.targetDurationSeconds}
          durationTotalSeconds={editor.durationTotalSeconds}
          durationMatchesTarget={editor.durationMatchesTarget}
          canAddScene={editor.canAddScene}
          mutationPending={canonicalMutationPending}
          errorMessageKey={panelConflict?.messageKey ?? panelSceneIssue?.messageKey ?? nonDraftError?.messageKey}
          statusMessageKey={
            panelSceneIssue || nonDraftError || panelConflict
              ? 'conversation.creativeStudio.inspector.unsavedChanges'
              : null
          }
          conflict={panelRecoveryVisible}
          onSelectScene={editor.selectScene}
          onAddScene={editor.addScene}
          onRemoveScene={editor.removeScene}
          onReorderScenes={editor.reorderScenes}
          onMoveScene={editor.moveScene}
          onRetryConflict={
            panelSceneIssue !== null &&
            panelSceneIssue.code !== 'stale_project' &&
            panelSceneIssue.sceneId !== undefined
              ? () => editor.flushSceneDraftById(panelSceneIssue.sceneId!)
              : editor.retryConflict
          }
          onDiscardConflict={
            panelSceneIssue !== null &&
            panelSceneIssue.code !== 'stale_project' &&
            panelSceneIssue.sceneId !== undefined
              ? () => editor.discardSceneDraftById(panelSceneIssue.sceneId!)
              : editor.discardConflict
          }
        />
        <div className={styles.previewColumn}>
          <StagePreview
            projectId={project.id}
            selectedScene={selectedScene}
            selectedAsset={selectedAsset}
            posterAsset={posterAsset}
          />
          {variationIssueMessageKey && (
            <div role='alert' className={styles.projectAlert}>
              {t(variationIssueMessageKey)}
            </div>
          )}
          <AssetStrip
            projectId={project.id}
            scene={selectedScene}
            assets={project.assets}
            projectRevision={project.revision}
            mutationPending={canonicalMutationPending || editor.hasUnsavedSceneDrafts}
            onSelectAsset={handleSelectVariation}
          />
        </div>
        <div className={styles.inspectorColumn}>
          <SceneInspector
            projectId={project.id}
            selectedScene={editor.selectedScene}
            referenceAsset={selectedReferenceAsset}
            sceneDraft={editor.sceneDraft}
            mutationPending={canonicalMutationPending}
            errorMessageKey={
              inspectorSceneIssue?.messageKey ??
              (referenceImportIssue !== null && referenceImportIssue.sceneId === editor.selectedScene?.id
                ? referenceImportIssue.messageKey
                : null)
            }
            statusMessageKey={
              editor.mutationPending
                ? 'conversation.creativeStudio.inspector.saving'
                : inspectorSceneIssue
                  ? 'conversation.creativeStudio.inspector.unsavedChanges'
                  : null
            }
            conflict={inspectorRecoveryVisible}
            onUpdateSceneDraft={editor.updateSceneDraft}
            onFlushSceneDraft={editor.flushSceneDraft}
            onRetryConflict={inspectorConflict ? editor.retryConflict : editor.flushSceneDraft}
            onDiscardConflict={inspectorConflict ? editor.discardConflict : editor.discardSceneDraft}
            importingReference={referenceImportSceneId === editor.selectedScene?.id}
            onImportReference={handleImportReference}
          />
          <div className={styles.generationPanel}>
            <GenerationControls
              project={project}
              catalog={studioModels.catalog}
              catalogLoading={studioModels.loading}
              catalogErrorMessageKey={studioModels.errorMessageKey}
              onRefreshCatalog={studioModels.refresh}
              scene={
                selectedScene === null
                  ? null
                  : {
                      id: selectedScene.id,
                      mediaKind: selectedScene.mediaKind,
                      hasSelectedAsset: selectedScene.selectedAssetId !== null,
                    }
              }
              aspectRatio={project.aspectRatio}
              resolution={project.resolution}
              sceneDurationSeconds={selectedScene?.durationSeconds}
              hasReference={selectedScene?.referenceAssetId !== null}
              batchSceneCount={readyScenes.length}
              disabled={generationBlocked}
              singleDisabled={selectedScene !== null && !sceneCanOpenSingleReview(project, selectedScene)}
              jobs={selectedSceneJobs}
              pendingJobIds={studioJobs.mutationPending ? selectedSceneJobs.map((job) => job.id) : []}
              actionIssue={generationActionIssue}
              onOpenSettings={(path) => setTimeout(() => navigate(path), 0)}
              onOpenSingleReview={openSingleReview}
              onOpenBatchReview={openBatchReview}
              onCancelJob={studioJobs.cancelJob}
              onRetryJob={studioJobs.retryJob}
              onRetryDownload={studioJobs.retryDownload}
              onReviewUnknownSubmission={setDuplicateChargeJobId}
            />
          </div>
        </div>
      </div>
      <SceneTimeline
        orderedScenes={canonicalOrderedScenes}
        selectedSceneId={editor.selectedSceneId}
        onSelectScene={editor.selectScene}
      />
      <StoryboardDraftModal
        visible={draftModalVisible}
        project={project}
        storyboard={studioModels.catalog?.storyboard ?? null}
        catalogLoading={studioModels.loading}
        catalogErrorMessageKey={draftErrorMessageKey}
        selectionPending={studioModels.pendingRole === 'storyboard'}
        draftConflict={draftConflict !== null}
        drafting={editor.drafting}
        onCancel={() => setDraftModalVisible(false)}
        proposeStoryboard={handleDraftStoryboard}
        onDiscardDraftConflict={editor.discardConflict}
        onContinueManual={() => setDraftModalVisible(false)}
        onOpenSettings={() => setTimeout(() => navigate('/settings/model'), 0)}
        onRefreshCatalog={studioModels.refresh}
        onSelectStoryboardModel={(selection) => studioModels.updateSelection({ role: 'storyboard', selection })}
      />
      <GenerationReviewModal
        visible={generationReview !== null}
        mode={generationReview?.mode ?? 'single'}
        scenes={generationReview?.scenes ?? []}
        aspectRatio={project.aspectRatio}
        resolution={project.resolution}
        targetDurationSeconds={project.targetDurationSeconds}
        submitting={studioJobs.mutationPending || generationReviewRefreshing}
        submissionBlocked={studioJobs.issue?.operation === 'submit_scenes' && studioJobs.issue.code === 'invalid_route'}
        errorMessageKey={
          studioJobs.issue?.operation === 'submit_scenes'
            ? studioJobs.issue.messageKey
            : generationReviewIssueMessageKey
        }
        onCancel={() => {
          if (!studioJobs.mutationPending && !generationReviewRefreshing) {
            studioJobs.clearIssue();
            studioJobs.clearStaleIntent();
            setGenerationReviewIssueMessageKey(null);
            setGenerationReview(null);
          }
        }}
        onConfirm={confirmGeneration}
      />
      <Modal
        visible={exportVisible}
        title={t(
          exportedFolderName === null
            ? 'conversation.creativeStudio.export.title'
            : exportMissingSceneIds.length > 0
              ? 'conversation.creativeStudio.export.partialTitle'
              : 'conversation.creativeStudio.export.successTitle'
        )}
        closable={!exportPending}
        maskClosable={!exportPending}
        escToExit={!exportPending}
        onCancel={() => {
          if (!exportPending) setExportVisible(false);
        }}
        footer={
          <div className='flex flex-wrap justify-end gap-8px'>
            <Button disabled={exportPending} onClick={() => setExportVisible(false)}>
              {t('conversation.creativeStudio.export.cancel')}
            </Button>
            {exportedFolderName === null && (
              <Button
                type='primary'
                loading={exportPending}
                disabled={exportPending || !hasSelectedExportAssets}
                onClick={() => void handleExportAssets()}
              >
                {t('conversation.creativeStudio.export.confirm')}
              </Button>
            )}
          </div>
        }
      >
        {exportedFolderName === null ? (
          <div className='flex flex-col gap-12px'>
            <p className='m-0'>{t('conversation.creativeStudio.export.body')}</p>
            {!hasSelectedExportAssets && (
              <p className='m-0 text-13px text-warning'>{t('conversation.creativeStudio.export.noSelectedAssets')}</p>
            )}
            <Checkbox checked={exportIncludeReferences} disabled={exportPending} onChange={setExportIncludeReferences}>
              {t('conversation.creativeStudio.export.includeReferences')}
            </Checkbox>
            {exportPending && (
              <p role='status' className='m-0 text-13px text-t-secondary'>
                {t('conversation.creativeStudio.export.choosing')}
              </p>
            )}
            {exportIssueMessageKey !== null && (
              <div role='alert' className='rounded-8px bg-danger-light-1 p-10px text-13px text-danger'>
                <p className='m-0'>{t('conversation.creativeStudio.export.failed')}</p>
                {exportIssueMessageKey !== 'conversation.creativeStudio.export.failed' && (
                  <p className='mb-0 mt-4px'>{t(exportIssueMessageKey)}</p>
                )}
              </div>
            )}
          </div>
        ) : (
          <div className='flex flex-col gap-12px'>
            <p className='m-0'>
              {t(
                exportMissingSceneIds.length > 0
                  ? 'conversation.creativeStudio.export.partialBody'
                  : 'conversation.creativeStudio.export.successBody',
                {
                  folderName: exportedFolderName,
                }
              )}
            </p>
            <dl className='m-0 grid grid-cols-[max-content_minmax(0,1fr)] gap-x-12px gap-y-8px rounded-8px bg-fill-1 p-12px'>
              <dt className='text-12px text-t-tertiary'>{t('conversation.creativeStudio.export.folderLabel')}</dt>
              <dd className='m-0 break-all text-13px text-t-primary'>{exportedFolderName}</dd>
            </dl>
            {exportMissingSceneIds.length > 0 && (
              <p className='m-0 text-13px text-warning'>
                {t('conversation.creativeStudio.export.missingScenes', {
                  scenes: exportMissingSceneIds
                    .map((sceneId) => {
                      const title = project.scenes[sceneId]?.title;
                      return title === undefined ? sceneId : `${title} (${sceneId})`;
                    })
                    .join(', '),
                })}
              </p>
            )}
          </div>
        )}
      </Modal>
      <Modal
        visible={duplicateChargeJobId !== null}
        title={t('conversation.creativeStudio.jobs.retryChargeTitle')}
        closable={!studioJobs.mutationPending}
        maskClosable={!studioJobs.mutationPending}
        escToExit={!studioJobs.mutationPending}
        onCancel={() => {
          if (!studioJobs.mutationPending) setDuplicateChargeJobId(null);
        }}
        footer={
          <div className='flex flex-wrap justify-end gap-8px'>
            <Button disabled={studioJobs.mutationPending} onClick={() => setDuplicateChargeJobId(null)}>
              {t('conversation.creativeStudio.review.cancel')}
            </Button>
            <Button
              type='primary'
              loading={studioJobs.mutationPending}
              onClick={() => {
                const jobId = duplicateChargeJobId;
                if (jobId === null || studioJobs.mutationPending) return;
                void studioJobs.retryJob(jobId, true).then((retried) => {
                  if (retried) setDuplicateChargeJobId(null);
                });
              }}
            >
              {t('conversation.creativeStudio.jobs.retryChargeConfirm')}
            </Button>
          </div>
        }
      >
        <p>{t('conversation.creativeStudio.jobs.retryChargeBody')}</p>
        {studioJobs.issue?.jobId === duplicateChargeJobId && (
          <div role='alert' className={styles.projectAlert}>
            {t(studioJobs.issue.messageKey)}
          </div>
        )}
      </Modal>
    </section>
  );
};

const StudioPage: React.FC = () => {
  const { id } = useParams<{ id: string }>();

  return <main className={styles.page}>{id ? <StudioProjectShell key={id} /> : <StudioLibrary />}</main>;
};

export default StudioPage;
