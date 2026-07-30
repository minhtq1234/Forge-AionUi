/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import { ipcBridge } from '@/common';
import type {
  StudioCommandErrorCode,
  StudioCommandResult,
  StudioEditableScene,
  StudioRendererProject,
  StudioRouteCatalog,
  StudioScene,
} from '@/common/types/project/creativeStudioTypes';
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';

const MAX_SCENES = 24;
const SCENE_SAVE_DEBOUNCE_MS = 450;
const INVALID_DURATION_MESSAGE_KEY = 'conversation.creativeStudio.inspector.invalidDuration';
const STORAGE_ERROR_MESSAGE_KEY = 'conversation.creativeStudio.errors.storage';
const STALE_PROJECT_MESSAGE_KEY = 'conversation.creativeStudio.errors.staleProject';

export type StoryboardEditorOperation =
  | 'save_scene'
  | 'add_scene'
  | 'remove_scene'
  | 'reorder_scenes'
  | 'draft_storyboard';

export type StoryboardEditorIssue = {
  operation: StoryboardEditorOperation;
  code: StudioCommandErrorCode;
  messageKey: string;
  sceneId?: string;
};

export type StoryboardEditorConflict = StoryboardEditorIssue & {
  code: 'stale_project';
};

export type UseStoryboardEditorOptions = {
  project: StudioRendererProject | null;
  refetch: () => Promise<StudioRendererProject | null>;
};

export type UseStoryboardEditorResult = {
  project: StudioRendererProject | null;
  orderedScenes: StudioScene[];
  selectedSceneId: string | null;
  selectedScene: StudioScene | null;
  sceneDraft: StudioEditableScene | null;
  hasUnsavedSceneDrafts: boolean;
  hasUnsavedSelectedSceneDraft: boolean;
  saveIssues: StoryboardEditorIssue[];
  selectScene: (sceneId: string) => void;
  updateSceneDraft: (patch: Partial<StudioEditableScene>) => void;
  flushSceneDraft: () => Promise<boolean>;
  flushSceneDraftById: (sceneId: string) => Promise<boolean>;
  discardSceneDraft: () => void;
  discardSceneDraftById: (sceneId: string) => void;
  addScene: () => Promise<boolean>;
  removeScene: (sceneId: string) => Promise<boolean>;
  reorderScenes: (sceneOrder: string[]) => Promise<boolean>;
  moveScene: (sceneId: string, direction: 'up' | 'down') => Promise<boolean>;
  canAddScene: boolean;
  durationTotalSeconds: number;
  durationMatchesTarget: boolean;
  mutationPending: boolean;
  error: StoryboardEditorIssue | null;
  clearError: () => void;
  conflict: StoryboardEditorConflict | null;
  retryConflict: () => Promise<boolean>;
  discardConflict: () => void;
  planning: StudioRouteCatalog['planning'] | null;
  planningLoading: boolean;
  planningErrorMessageKey: string | null;
  refreshPlanning: () => Promise<void>;
  drafting: boolean;
  proposeStoryboard: (replaceExisting: boolean) => Promise<boolean>;
};

type MutationIntent = {
  operation: StoryboardEditorOperation;
  sceneId?: string;
  invoke: (project: StudioRendererProject) => Promise<StudioCommandResult<StudioRendererProject>>;
  onSuccess?: (project: StudioRendererProject) => void;
  onDiscard?: () => void;
};

type QueuedMutationIntent = MutationIntent & {
  projectId: string;
  session: number;
};

type InternalConflict = {
  publicIssue: StoryboardEditorConflict;
  intent: QueuedMutationIntent;
};

type PausedMutationIntent = {
  intent: QueuedMutationIntent;
  resolve: (result: boolean) => void;
};

const editableScene = (scene: StudioScene): StudioEditableScene => ({
  title: scene.title,
  purpose: scene.purpose,
  visualPrompt: scene.visualPrompt,
  narration: scene.narration,
  onScreenText: scene.onScreenText,
  mediaKind: scene.mediaKind,
  durationSeconds: scene.durationSeconds,
  referenceAssetId: scene.referenceAssetId,
});

const EDITABLE_SCENE_FIELDS = [
  'title',
  'purpose',
  'visualPrompt',
  'narration',
  'onScreenText',
  'mediaKind',
  'durationSeconds',
  'referenceAssetId',
] as const satisfies readonly (keyof StudioEditableScene)[];

const applyLocalFields = (
  base: StudioEditableScene,
  local: StudioEditableScene,
  fields: Iterable<keyof StudioEditableScene>
): StudioEditableScene => {
  const merged = { ...base };
  for (const field of fields) Object.assign(merged, { [field]: local[field] });
  return merged;
};

const isValidDuration = (value: number): boolean => Number.isInteger(value) && value >= 1 && value <= 60;

const isExactPermutation = (current: string[], candidate: string[]): boolean =>
  current.length === candidate.length &&
  new Set(candidate).size === candidate.length &&
  candidate.every((sceneId) => current.includes(sceneId));

const storageIssue = (operation: StoryboardEditorOperation, sceneId?: string): StoryboardEditorIssue => ({
  operation,
  code: 'storage_error',
  messageKey: STORAGE_ERROR_MESSAGE_KEY,
  ...(sceneId === undefined ? {} : { sceneId }),
});

/**
 * Owns local storyboard drafts and serializes every canonical project mutation.
 *
 * The renderer only sends bounded scene fields and safe IDs. Operational scene
 * state and revision conflict enforcement remain in the main-process service.
 */
export const useStoryboardEditor = ({
  project: parentProject,
  refetch,
}: UseStoryboardEditorOptions): UseStoryboardEditorResult => {
  const { t } = useTranslation();
  const [project, setProject] = useState<StudioRendererProject | null>(parentProject);
  const [selectedSceneId, setSelectedSceneId] = useState<string | null>(parentProject?.sceneOrder[0] ?? null);
  const [draftVersion, setDraftVersion] = useState(0);
  const [saveIssueVersion, setSaveIssueVersion] = useState(0);
  const [mutationCount, setMutationCount] = useState(0);
  const [error, setError] = useState<StoryboardEditorIssue | null>(null);
  const [conflict, setConflict] = useState<StoryboardEditorConflict | null>(null);
  const [planning, setPlanning] = useState<StudioRouteCatalog['planning'] | null>(null);
  const [planningLoading, setPlanningLoading] = useState(Boolean(parentProject));
  const [planningErrorMessageKey, setPlanningErrorMessageKey] = useState<string | null>(null);
  const [drafting, setDrafting] = useState(false);

  const mountedRef = useRef(true);
  const projectRef = useRef<StudioRendererProject | null>(parentProject);
  const selectedSceneIdRef = useRef<string | null>(parentProject?.sceneOrder[0] ?? null);
  const draftsRef = useRef(new Map<string, StudioEditableScene>());
  const dirtySceneIdsRef = useRef(new Set<string>());
  const dirtyFieldsRef = useRef(new Map<string, Set<keyof StudioEditableScene>>());
  const dirtyFieldVersionsRef = useRef(new Map<string, Map<keyof StudioEditableScene, number>>());
  const sceneEditVersionsRef = useRef(new Map<string, number>());
  const saveTimersRef = useRef(new Map<string, ReturnType<typeof setTimeout>>());
  const queuedSceneVersionsRef = useRef(new Map<string, number>());
  const saveIssuesRef = useRef(new Map<string, StoryboardEditorIssue>());
  const mutationQueueRef = useRef<Promise<void>>(Promise.resolve());
  const internalConflictRef = useRef<InternalConflict | null>(null);
  const pausedIntentsRef = useRef<PausedMutationIntent[]>([]);
  const projectSessionRef = useRef(0);
  const storyboardEpochRef = useRef(0);
  const planningRequestRef = useRef(0);
  const canonicalRefetchRequestRef = useRef(0);
  const draftingTokenRef = useRef<{ projectId: string; session: number } | null>(null);
  const refetchRef = useRef(refetch);
  const flushSceneRef = useRef<(sceneId: string, allowMissingCanonical?: boolean) => Promise<boolean>>(
    async () => false
  );
  const enqueueIntentRef = useRef<(intent: MutationIntent) => Promise<boolean>>(async () => false);

  refetchRef.current = refetch;

  const rerenderDrafts = useCallback(() => {
    if (mountedRef.current) setDraftVersion((version) => version + 1);
  }, []);

  const clearSaveTimer = useCallback((sceneId: string) => {
    const timer = saveTimersRef.current.get(sceneId);
    if (timer !== undefined) {
      clearTimeout(timer);
      saveTimersRef.current.delete(sceneId);
    }
  }, []);

  const clearAllDrafts = useCallback(() => {
    storyboardEpochRef.current += 1;
    for (const timer of saveTimersRef.current.values()) clearTimeout(timer);
    saveTimersRef.current.clear();
    draftsRef.current.clear();
    dirtySceneIdsRef.current.clear();
    dirtyFieldsRef.current.clear();
    dirtyFieldVersionsRef.current.clear();
    sceneEditVersionsRef.current.clear();
    queuedSceneVersionsRef.current.clear();
    saveIssuesRef.current.clear();
    if (mountedRef.current) {
      setSaveIssueVersion((version) => version + 1);
      setError((currentError) => (currentError?.operation === 'save_scene' ? null : currentError));
    }
    rerenderDrafts();
  }, [rerenderDrafts]);

  const discardPausedIntents = useCallback(() => {
    const paused = pausedIntentsRef.current.splice(0);
    for (const pending of paused) pending.resolve(false);
  }, []);

  const startProjectSession = useCallback(() => {
    projectSessionRef.current += 1;
    mutationQueueRef.current = Promise.resolve();
    internalConflictRef.current = null;
    discardPausedIntents();
    draftingTokenRef.current = null;
    if (mountedRef.current) {
      setMutationCount(0);
      setConflict(null);
      setError(null);
      setDrafting(false);
    }
  }, [discardPausedIntents]);

  const adoptProject = useCallback(
    (candidate: StudioRendererProject): StudioRendererProject => {
      const current = projectRef.current;
      if (current?.id === candidate.id && current.revision >= candidate.revision) return current;

      const projectChanged = current?.id !== candidate.id;
      if (!projectChanged) {
        for (const [sceneId, draft] of draftsRef.current) {
          const canonicalScene = candidate.scenes[sceneId];
          const dirtyFields = dirtyFieldsRef.current.get(sceneId);
          if (canonicalScene !== undefined && dirtyFields !== undefined && dirtyFields.size > 0) {
            draftsRef.current.set(sceneId, applyLocalFields(editableScene(canonicalScene), draft, dirtyFields));
          }
        }
      }
      projectRef.current = candidate;
      if (mountedRef.current) setProject(candidate);

      if (projectChanged) {
        startProjectSession();
        clearAllDrafts();
        const firstSceneId = candidate.sceneOrder[0] ?? null;
        selectedSceneIdRef.current = firstSceneId;
        if (mountedRef.current) {
          setSelectedSceneId(firstSceneId);
          setConflict(null);
          setError(null);
        }
      } else if (selectedSceneIdRef.current === null || !Object.hasOwn(candidate.scenes, selectedSceneIdRef.current)) {
        const firstSceneId = candidate.sceneOrder[0] ?? null;
        selectedSceneIdRef.current = firstSceneId;
        if (mountedRef.current) setSelectedSceneId(firstSceneId);
      }

      return candidate;
    },
    [clearAllDrafts, startProjectSession]
  );

  const refetchCanonical = useCallback(
    async (expectedProjectId: string, expectedSession: number): Promise<StudioRendererProject | null> => {
      if (projectRef.current?.id !== expectedProjectId || projectSessionRef.current !== expectedSession) return null;
      const request = ++canonicalRefetchRequestRef.current;
      const candidate = await refetchRef.current();
      if (
        request !== canonicalRefetchRequestRef.current ||
        candidate === null ||
        candidate.id !== expectedProjectId ||
        projectRef.current?.id !== expectedProjectId ||
        projectSessionRef.current !== expectedSession
      ) {
        return null;
      }
      return adoptProject(candidate);
    },
    [adoptProject]
  );

  const clearSaveIssue = useCallback((sceneId: string) => {
    if (!saveIssuesRef.current.delete(sceneId)) return;
    if (mountedRef.current) {
      setSaveIssueVersion((version) => version + 1);
      setError((currentError) => {
        if (currentError?.operation !== 'save_scene' || currentError.sceneId !== sceneId) return currentError;
        return saveIssuesRef.current.values().next().value ?? null;
      });
    }
  }, []);

  const publishIssue = useCallback((issue: StoryboardEditorIssue) => {
    if (issue.operation === 'save_scene' && issue.sceneId !== undefined) {
      saveIssuesRef.current.set(issue.sceneId, issue);
      if (mountedRef.current) setSaveIssueVersion((version) => version + 1);
    }
    if (mountedRef.current) setError(issue);
  }, []);

  const executeIntent = useCallback(
    async (intent: QueuedMutationIntent): Promise<boolean> => {
      const current = projectRef.current;
      if (current === null || current.id !== intent.projectId || projectSessionRef.current !== intent.session) {
        return false;
      }

      try {
        const result = await intent.invoke(current);
        if (projectRef.current?.id !== intent.projectId || projectSessionRef.current !== intent.session) return false;
        if (result.ok === true) {
          if (result.data.id !== intent.projectId) {
            publishIssue(storageIssue(intent.operation, intent.sceneId));
            return false;
          }
          const adopted = adoptProject(result.data);
          intent.onSuccess?.(adopted);
          if (mountedRef.current) {
            if (intent.operation === 'save_scene' && intent.sceneId !== undefined) {
              clearSaveIssue(intent.sceneId);
            } else {
              setError((currentError) =>
                currentError?.operation === intent.operation && currentError.sceneId === intent.sceneId
                  ? null
                  : currentError
              );
            }
            if (intent.operation === 'draft_storyboard') setPlanningErrorMessageKey(null);
          }
          return true;
        }

        const issue: StoryboardEditorIssue = {
          operation: intent.operation,
          code: result.error.code,
          messageKey: result.error.messageKey,
          ...(intent.sceneId === undefined ? {} : { sceneId: intent.sceneId }),
        };
        if (result.error.code !== 'stale_project') {
          publishIssue(issue);
          if (mountedRef.current && intent.operation === 'draft_storyboard') {
            setPlanningErrorMessageKey(issue.messageKey);
          }
          return false;
        }

        try {
          await refetchCanonical(intent.projectId, intent.session);
        } catch {
          if (projectRef.current?.id !== intent.projectId || projectSessionRef.current !== intent.session) return false;
          publishIssue(storageIssue(intent.operation, intent.sceneId));
        }
        if (projectRef.current?.id !== intent.projectId || projectSessionRef.current !== intent.session) return false;
        const staleIssue: StoryboardEditorConflict = { ...issue, code: 'stale_project' };
        if (intent.operation === 'save_scene' && intent.sceneId !== undefined) clearSaveIssue(intent.sceneId);
        internalConflictRef.current = { publicIssue: staleIssue, intent };
        if (mountedRef.current) {
          setConflict(staleIssue);
          setError(null);
          if (intent.operation === 'draft_storyboard') setPlanningErrorMessageKey(staleIssue.messageKey);
        }
        return false;
      } catch {
        if (projectRef.current?.id !== intent.projectId || projectSessionRef.current !== intent.session) return false;
        const issue = storageIssue(intent.operation, intent.sceneId);
        publishIssue(issue);
        if (mountedRef.current && intent.operation === 'draft_storyboard') {
          setPlanningErrorMessageKey(issue.messageKey);
        }
        return false;
      }
    },
    [adoptProject, clearSaveIssue, publishIssue, refetchCanonical]
  );

  const enqueueIntent = useCallback(
    (intent: MutationIntent): Promise<boolean> => {
      const current = projectRef.current;
      if (current === null) return Promise.resolve(false);
      const session = projectSessionRef.current;
      const queuedIntent: QueuedMutationIntent = { ...intent, projectId: current.id, session };
      if (mountedRef.current) setMutationCount((count) => count + 1);

      let resolveResult!: (result: boolean) => void;
      const resultPromise = new Promise<boolean>((resolve) => {
        resolveResult = resolve;
      });

      mutationQueueRef.current = mutationQueueRef.current
        .catch((): void => {})
        .then(async () => {
          const blockingConflict = internalConflictRef.current;
          if (blockingConflict !== null) {
            const supersededSameSceneSave =
              blockingConflict.intent.operation === 'save_scene' &&
              queuedIntent.operation === 'save_scene' &&
              blockingConflict.intent.sceneId === queuedIntent.sceneId;
            if (queuedIntent.operation === 'draft_storyboard' || supersededSameSceneSave) {
              resolveResult(false);
              return;
            }
            pausedIntentsRef.current.push({ intent: queuedIntent, resolve: resolveResult });
            return;
          }
          resolveResult(await executeIntent(queuedIntent));
        })
        .finally(() => {
          if (mountedRef.current && projectSessionRef.current === session) {
            setMutationCount((count) => Math.max(0, count - 1));
          }
        });
      return resultPromise;
    },
    [executeIntent]
  );
  enqueueIntentRef.current = enqueueIntent;

  const resumePausedIntents = useCallback(() => {
    const current = projectRef.current;
    const session = projectSessionRef.current;
    const paused = pausedIntentsRef.current.splice(0);
    for (const pending of paused) {
      if (current === null || pending.intent.projectId !== current.id || pending.intent.session !== session) {
        pending.resolve(false);
        continue;
      }
      void enqueueIntentRef.current(pending.intent).then(pending.resolve);
    }
  }, []);

  const runDraftIntent = useCallback(
    async (intent: MutationIntent): Promise<boolean> => {
      const current = projectRef.current;
      if (current === null || draftingTokenRef.current !== null) return false;

      const token = { projectId: current.id, session: projectSessionRef.current };
      draftingTokenRef.current = token;
      if (mountedRef.current) {
        setDrafting(true);
        setPlanningErrorMessageKey(null);
      }
      try {
        return await enqueueIntent(intent);
      } finally {
        if (draftingTokenRef.current === token) {
          draftingTokenRef.current = null;
          if (mountedRef.current) setDrafting(false);
        }
      }
    },
    [enqueueIntent]
  );

  const flushScene = useCallback(
    (sceneId: string, allowMissingCanonical = false): Promise<boolean> => {
      clearSaveTimer(sceneId);
      const current = projectRef.current;
      const draft = draftsRef.current.get(sceneId);
      const dirtyFields = dirtyFieldsRef.current.get(sceneId);
      if (
        current === null ||
        draft === undefined ||
        !dirtySceneIdsRef.current.has(sceneId) ||
        dirtyFields === undefined ||
        dirtyFields.size === 0
      ) {
        return Promise.resolve(false);
      }
      if (!isValidDuration(draft.durationSeconds)) {
        publishIssue({
          operation: 'save_scene',
          code: 'invalid_payload',
          messageKey: INVALID_DURATION_MESSAGE_KEY,
          sceneId,
        });
        return Promise.resolve(false);
      }

      const localDraft = { ...draft };
      const capturedFields = new Set(dirtyFields);
      const capturedStoryboardEpoch = storyboardEpochRef.current;
      const capturedVersion = sceneEditVersionsRef.current.get(sceneId) ?? 0;
      const fieldVersions = dirtyFieldVersionsRef.current.get(sceneId);
      const capturedFieldVersions = new Map(
        [...capturedFields].map((field) => [field, fieldVersions?.get(field) ?? capturedVersion])
      );
      if (queuedSceneVersionsRef.current.get(sceneId) === capturedVersion) return Promise.resolve(false);
      queuedSceneVersionsRef.current.set(sceneId, capturedVersion);
      const save = enqueueIntent({
        operation: 'save_scene',
        sceneId,
        invoke: (canonical) => {
          if (capturedStoryboardEpoch !== storyboardEpochRef.current) {
            return Promise.resolve({ ok: true, data: canonical });
          }
          if (!dirtySceneIdsRef.current.has(sceneId)) {
            return Promise.resolve({ ok: true, data: canonical });
          }
          const canonicalScene = canonical.scenes[sceneId];
          if (canonicalScene === undefined && !allowMissingCanonical) {
            return Promise.resolve({
              ok: false,
              error: {
                code: 'stale_project',
                messageKey: STALE_PROJECT_MESSAGE_KEY,
              },
            });
          }
          const payload =
            canonicalScene === undefined
              ? localDraft
              : applyLocalFields(editableScene(canonicalScene), localDraft, capturedFields);
          return ipcBridge.creativeStudio.updateScene.invoke({
            projectId: canonical.id,
            sceneId,
            expectedRevision: canonical.revision,
            scene: payload,
          });
        },
        onSuccess: (canonical) => {
          const currentDirtyFields = dirtyFieldsRef.current.get(sceneId);
          const currentFieldVersions = dirtyFieldVersionsRef.current.get(sceneId);
          if (currentDirtyFields === undefined || currentFieldVersions === undefined) return;

          for (const [field, version] of capturedFieldVersions) {
            if (currentFieldVersions.get(field) === version) {
              currentDirtyFields.delete(field);
              currentFieldVersions.delete(field);
            }
          }

          if (currentDirtyFields.size === 0) {
            dirtySceneIdsRef.current.delete(sceneId);
            dirtyFieldsRef.current.delete(sceneId);
            dirtyFieldVersionsRef.current.delete(sceneId);
            sceneEditVersionsRef.current.delete(sceneId);
            draftsRef.current.delete(sceneId);
          } else {
            const canonicalScene = canonical.scenes[sceneId];
            const currentDraft = draftsRef.current.get(sceneId);
            if (canonicalScene !== undefined && currentDraft !== undefined) {
              draftsRef.current.set(
                sceneId,
                applyLocalFields(editableScene(canonicalScene), currentDraft, currentDirtyFields)
              );
            }
          }
          rerenderDrafts();
        },
        onDiscard: () => {
          dirtySceneIdsRef.current.delete(sceneId);
          dirtyFieldsRef.current.delete(sceneId);
          dirtyFieldVersionsRef.current.delete(sceneId);
          sceneEditVersionsRef.current.delete(sceneId);
          draftsRef.current.delete(sceneId);
          rerenderDrafts();
        },
      });
      return save.finally(() => {
        if (queuedSceneVersionsRef.current.get(sceneId) === capturedVersion) {
          queuedSceneVersionsRef.current.delete(sceneId);
        }
      });
    },
    [clearSaveTimer, enqueueIntent, publishIssue, rerenderDrafts]
  );
  flushSceneRef.current = flushScene;

  const flushSceneDraftById = useCallback((sceneId: string): Promise<boolean> => flushScene(sceneId), [flushScene]);

  const scheduleSceneSave = useCallback(
    (sceneId: string) => {
      clearSaveTimer(sceneId);
      const timer = setTimeout(() => {
        saveTimersRef.current.delete(sceneId);
        void flushSceneRef.current(sceneId);
      }, SCENE_SAVE_DEBOUNCE_MS);
      saveTimersRef.current.set(sceneId, timer);
    },
    [clearSaveTimer]
  );

  useLayoutEffect(() => {
    const current = projectRef.current;
    if (parentProject === null) {
      if (current !== null) {
        startProjectSession();
        projectRef.current = null;
        clearAllDrafts();
        selectedSceneIdRef.current = null;
        setProject(null);
        setSelectedSceneId(null);
        setPlanning(null);
        setPlanningLoading(false);
        setPlanningErrorMessageKey(null);
      }
      return;
    }
    adoptProject(parentProject);
  }, [adoptProject, clearAllDrafts, parentProject, startProjectSession]);

  const refreshPlanning = useCallback(async (): Promise<void> => {
    const current = projectRef.current;
    if (current === null) return;
    const request = ++planningRequestRef.current;
    if (mountedRef.current) {
      setPlanningLoading(true);
      setPlanningErrorMessageKey(null);
    }
    try {
      const result = await ipcBridge.creativeStudio.listRoutes.invoke({ projectId: current.id });
      if (!mountedRef.current || planningRequestRef.current !== request) return;
      if (result.ok === true) {
        setPlanning(result.data.planning);
        setPlanningErrorMessageKey(null);
      } else {
        setPlanning(null);
        setPlanningErrorMessageKey(result.error.messageKey);
      }
    } catch {
      if (mountedRef.current && planningRequestRef.current === request) {
        setPlanning(null);
        setPlanningErrorMessageKey(STORAGE_ERROR_MESSAGE_KEY);
      }
    } finally {
      if (mountedRef.current && planningRequestRef.current === request) setPlanningLoading(false);
    }
  }, []);

  useEffect(() => {
    planningRequestRef.current += 1;
    setPlanning(null);
    setPlanningErrorMessageKey(null);
    if (parentProject === null) {
      setPlanningLoading(false);
      return;
    }
    void refreshPlanning();
  }, [parentProject?.id, refreshPlanning]);

  useEffect(
    () => () => {
      mountedRef.current = false;
      for (const sceneId of dirtySceneIdsRef.current) void flushSceneRef.current(sceneId);
      planningRequestRef.current += 1;
      canonicalRefetchRequestRef.current += 1;
    },
    []
  );

  const selectedScene = useMemo(
    () => (selectedSceneId === null ? null : (project?.scenes[selectedSceneId] ?? null)),
    [project, selectedSceneId]
  );
  const sceneDraft = useMemo(() => {
    if (selectedSceneId === null || selectedScene === null) return null;
    return draftsRef.current.get(selectedSceneId) ?? editableScene(selectedScene);
  }, [draftVersion, selectedScene, selectedSceneId]);
  const orderedScenes = useMemo(
    () =>
      project?.sceneOrder.flatMap((sceneId) => {
        const currentScene = project.scenes[sceneId];
        if (currentScene === undefined) return [];
        const draft = draftsRef.current.get(sceneId);
        return [{ ...currentScene, ...draft }];
      }) ?? [],
    [draftVersion, project]
  );
  const saveIssues = useMemo(() => [...saveIssuesRef.current.values()], [saveIssueVersion]);
  const durationTotalSeconds = useMemo(
    () => orderedScenes.reduce((total, currentScene) => total + currentScene.durationSeconds, 0),
    [orderedScenes]
  );

  const selectScene = useCallback((sceneId: string) => {
    const current = projectRef.current;
    if (current === null || !Object.hasOwn(current.scenes, sceneId) || selectedSceneIdRef.current === sceneId) return;
    const previousSceneId = selectedSceneIdRef.current;
    if (previousSceneId !== null) void flushSceneRef.current(previousSceneId);
    selectedSceneIdRef.current = sceneId;
    if (mountedRef.current) {
      setSelectedSceneId(sceneId);
    }
  }, []);

  const updateSceneDraft = useCallback(
    (patch: Partial<StudioEditableScene>) => {
      const sceneId = selectedSceneIdRef.current;
      const current = projectRef.current;
      if (sceneId === null || current === null) return;
      const canonicalScene = current.scenes[sceneId];
      if (canonicalScene === undefined) return;
      const previous = draftsRef.current.get(sceneId) ?? editableScene(canonicalScene);
      const next = { ...previous };
      const changedFields: (keyof StudioEditableScene)[] = [];
      for (const field of EDITABLE_SCENE_FIELDS) {
        if (!Object.hasOwn(patch, field) || patch[field] === undefined || Object.is(previous[field], patch[field])) {
          continue;
        }
        Object.assign(next, { [field]: patch[field] });
        changedFields.push(field);
      }
      if (changedFields.length === 0) return;

      const nextVersion = (sceneEditVersionsRef.current.get(sceneId) ?? 0) + 1;
      const dirtyFields = dirtyFieldsRef.current.get(sceneId) ?? new Set<keyof StudioEditableScene>();
      const dirtyFieldVersions =
        dirtyFieldVersionsRef.current.get(sceneId) ?? new Map<keyof StudioEditableScene, number>();
      for (const field of changedFields) {
        dirtyFields.add(field);
        dirtyFieldVersions.set(field, nextVersion);
      }
      draftsRef.current.set(sceneId, next);
      dirtySceneIdsRef.current.add(sceneId);
      dirtyFieldsRef.current.set(sceneId, dirtyFields);
      dirtyFieldVersionsRef.current.set(sceneId, dirtyFieldVersions);
      sceneEditVersionsRef.current.set(sceneId, nextVersion);
      rerenderDrafts();
      scheduleSceneSave(sceneId);
    },
    [rerenderDrafts, scheduleSceneSave]
  );

  const flushSceneDraft = useCallback((): Promise<boolean> => {
    const sceneId = selectedSceneIdRef.current;
    return sceneId === null ? Promise.resolve(false) : flushScene(sceneId);
  }, [flushScene]);

  const discardSceneDraftById = useCallback(
    (sceneId: string) => {
      clearSaveTimer(sceneId);
      draftsRef.current.delete(sceneId);
      dirtySceneIdsRef.current.delete(sceneId);
      dirtyFieldsRef.current.delete(sceneId);
      dirtyFieldVersionsRef.current.delete(sceneId);
      sceneEditVersionsRef.current.delete(sceneId);
      clearSaveIssue(sceneId);
      rerenderDrafts();
    },
    [clearSaveIssue, clearSaveTimer, rerenderDrafts]
  );

  const discardSceneDraft = useCallback(() => {
    const sceneId = selectedSceneIdRef.current;
    if (sceneId !== null) discardSceneDraftById(sceneId);
  }, [discardSceneDraftById]);

  const addScene = useCallback(async (): Promise<boolean> => {
    const current = projectRef.current;
    if (current === null || current.sceneOrder.length >= MAX_SCENES) return false;
    const sceneId = globalThis.crypto.randomUUID();
    const remainingSeconds =
      current.targetDurationSeconds -
      current.sceneOrder.reduce((total, id) => total + (current.scenes[id]?.durationSeconds ?? 0), 0);
    const scene: StudioEditableScene = {
      title: t('conversation.creativeStudio.scene.defaultTitle'),
      purpose: '',
      visualPrompt: '',
      narration: '',
      onScreenText: '',
      mediaKind: 'image',
      durationSeconds: remainingSeconds >= 1 && remainingSeconds <= 60 ? remainingSeconds : 5,
      referenceAssetId: null,
    };
    return enqueueIntent({
      operation: 'add_scene',
      sceneId,
      invoke: (canonical) =>
        ipcBridge.creativeStudio.updateScene.invoke({
          projectId: canonical.id,
          sceneId,
          expectedRevision: canonical.revision,
          scene,
        }),
      onSuccess: (canonical) => {
        if (!Object.hasOwn(canonical.scenes, sceneId)) return;
        selectedSceneIdRef.current = sceneId;
        if (mountedRef.current) setSelectedSceneId(sceneId);
      },
    });
  }, [enqueueIntent, t]);

  const removeScene = useCallback(
    async (sceneId: string): Promise<boolean> => {
      const current = projectRef.current;
      if (current === null || !Object.hasOwn(current.scenes, sceneId)) return false;
      return enqueueIntent({
        operation: 'remove_scene',
        sceneId,
        invoke: (canonical) =>
          ipcBridge.creativeStudio.updateScene.invoke({
            projectId: canonical.id,
            sceneId,
            expectedRevision: canonical.revision,
            scene: null,
          }),
        onSuccess: () => {
          draftsRef.current.delete(sceneId);
          dirtySceneIdsRef.current.delete(sceneId);
          dirtyFieldsRef.current.delete(sceneId);
          dirtyFieldVersionsRef.current.delete(sceneId);
          sceneEditVersionsRef.current.delete(sceneId);
          clearSaveIssue(sceneId);
          rerenderDrafts();
        },
      });
    },
    [clearSaveIssue, enqueueIntent, rerenderDrafts]
  );

  const reorderScenes = useCallback(
    (sceneOrder: string[]): Promise<boolean> => {
      const current = projectRef.current;
      if (current === null || !isExactPermutation(current.sceneOrder, sceneOrder)) return Promise.resolve(false);
      if (current.sceneOrder.every((sceneId, index) => sceneId === sceneOrder[index])) return Promise.resolve(false);
      const requestedOrder = [...sceneOrder];
      return enqueueIntent({
        operation: 'reorder_scenes',
        invoke: (canonical) =>
          ipcBridge.creativeStudio.reorderScenes.invoke({
            projectId: canonical.id,
            expectedRevision: canonical.revision,
            sceneOrder: requestedOrder,
          }),
      });
    },
    [enqueueIntent]
  );

  const moveScene = useCallback(
    (sceneId: string, direction: 'up' | 'down'): Promise<boolean> => {
      const current = projectRef.current;
      if (current === null) return Promise.resolve(false);
      const index = current.sceneOrder.indexOf(sceneId);
      const destination = direction === 'up' ? index - 1 : index + 1;
      if (index < 0 || destination < 0 || destination >= current.sceneOrder.length) return Promise.resolve(false);
      const sceneOrder = [...current.sceneOrder];
      [sceneOrder[index], sceneOrder[destination]] = [sceneOrder[destination], sceneOrder[index]];
      return reorderScenes(sceneOrder);
    },
    [reorderScenes]
  );

  const clearError = useCallback(() => setError(null), []);

  const drainMutationQueue = useCallback(async function waitForCurrentMutationQueue(): Promise<void> {
    const observedQueue = mutationQueueRef.current;
    await observedQueue.catch((): void => {});
    if (observedQueue !== mutationQueueRef.current) await waitForCurrentMutationQueue();
  }, []);

  const retryConflict = useCallback(async (): Promise<boolean> => {
    const pending = internalConflictRef.current;
    if (pending === null) return false;
    if (pending.intent.operation === 'draft_storyboard') return false;

    if (pending.intent.operation === 'save_scene' && pending.intent.sceneId !== undefined) {
      await drainMutationQueue();
      if (internalConflictRef.current !== pending) return false;
      internalConflictRef.current = null;
      if (mountedRef.current) setConflict(null);

      const retried = await flushScene(pending.intent.sceneId, true);
      if (retried) {
        resumePausedIntents();
      } else if (internalConflictRef.current === null) {
        resumePausedIntents();
      }
      return retried;
    }

    internalConflictRef.current = null;
    if (mountedRef.current) setConflict(null);
    const retried = await enqueueIntent(pending.intent);
    if (retried) {
      resumePausedIntents();
    } else if (internalConflictRef.current === null) {
      resumePausedIntents();
    }
    return retried;
  }, [drainMutationQueue, enqueueIntent, flushScene, resumePausedIntents]);

  const discardConflict = useCallback(() => {
    const pending = internalConflictRef.current;
    internalConflictRef.current = null;
    pending?.intent.onDiscard?.();
    if (mountedRef.current) {
      setConflict(null);
      setError(null);
      if (pending?.intent.operation === 'draft_storyboard') setPlanningErrorMessageKey(null);
    }
    resumePausedIntents();
  }, [resumePausedIntents]);

  const proposeStoryboard = useCallback(
    async (replaceExisting: boolean): Promise<boolean> => {
      const current = projectRef.current;
      if (current === null || planning?.health !== 'ready' || planning.resolvedModel === undefined) {
        return false;
      }
      const pendingConflict = internalConflictRef.current;
      if (pendingConflict !== null && pendingConflict.intent.operation !== 'draft_storyboard') {
        return false;
      }
      if (pendingConflict?.intent.operation === 'draft_storyboard') {
        internalConflictRef.current = null;
        if (mountedRef.current) setConflict(null);
      }

      const drafted = await runDraftIntent({
        operation: 'draft_storyboard',
        invoke: (canonical) =>
          ipcBridge.creativeStudio.proposeStoryboard.invoke({
            projectId: canonical.id,
            expectedRevision: canonical.revision,
            replaceExisting,
          }),
        onSuccess: (canonical) => {
          discardPausedIntents();
          clearAllDrafts();
          const firstSceneId = canonical.sceneOrder[0] ?? null;
          selectedSceneIdRef.current = firstSceneId;
          if (mountedRef.current) setSelectedSceneId(firstSceneId);
        },
      });
      if (!drafted && internalConflictRef.current === null) resumePausedIntents();
      return drafted;
    },
    [clearAllDrafts, discardPausedIntents, planning, resumePausedIntents, runDraftIntent]
  );

  return {
    project,
    orderedScenes,
    selectedSceneId,
    selectedScene,
    sceneDraft,
    hasUnsavedSceneDrafts: dirtySceneIdsRef.current.size > 0,
    hasUnsavedSelectedSceneDraft: selectedSceneId !== null && dirtySceneIdsRef.current.has(selectedSceneId),
    saveIssues,
    selectScene,
    updateSceneDraft,
    flushSceneDraft,
    flushSceneDraftById,
    discardSceneDraft,
    discardSceneDraftById,
    addScene,
    removeScene,
    reorderScenes,
    moveScene,
    canAddScene: project !== null && project.sceneOrder.length < MAX_SCENES,
    durationTotalSeconds,
    durationMatchesTarget: project !== null && durationTotalSeconds === project.targetDurationSeconds,
    mutationPending: mutationCount > 0,
    error,
    clearError,
    conflict,
    retryConflict,
    discardConflict,
    planning,
    planningLoading,
    planningErrorMessageKey,
    refreshPlanning,
    drafting,
    proposeStoryboard,
  };
};
