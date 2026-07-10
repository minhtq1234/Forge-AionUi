import { ipcBridge } from '@/common';
import { isBackendHttpError } from '@/common/adapter/httpBridge';
import type {
  ManagedAssistantDetail,
  ManagedAssistantPreferencesRequest,
  ManagedAssistantSummary,
  ManagedPersonalizationField,
} from '@/common/types/agent/managedAssistantTypes';
import type { AssistantListLoadResult } from '@/renderer/hooks/assistant/useAssistantList';
import { useCallback, useEffect, useRef, useState } from 'react';

export type ManagedReadError = 'unauthorized' | 'read' | null;
export type ManagedMutationError = 'adoption' | 'preferences' | 'reset' | null;

type UseManagedLibraryParams = {
  localeKey: string;
  onAdoptionChanged: (id: string) => Promise<AssistantListLoadResult>;
};

type AdoptionResult = {
  detail: ManagedAssistantDetail;
  readyToStart: boolean;
};

type ManagedViewContext = {
  assistantId: string;
  generation: number;
};

const NON_RENDERABLE_PERSONALIZATION_FIELDS = new Set<ManagedPersonalizationField>(['optional_skills', 'model']);

const toReadError = (error: unknown): Exclude<ManagedReadError, null> =>
  isBackendHttpError(error) && (error.status === 401 || error.status === 403) ? 'unauthorized' : 'read';

export const getRenderablePersonalizationFields = (detail: ManagedAssistantDetail): ManagedPersonalizationField[] =>
  detail.personalization_policy.allowed_fields.filter((field) => !NON_RENDERABLE_PERSONALIZATION_FIELDS.has(field));

export const hasRenderablePersonalSetup = (detail: ManagedAssistantDetail): boolean =>
  getRenderablePersonalizationFields(detail).length > 0;

const useManagedLibrary = ({ localeKey, onAdoptionChanged }: UseManagedLibraryParams) => {
  const [summaries, setSummaries] = useState<ManagedAssistantSummary[]>([]);
  const [selectedDetail, setSelectedDetail] = useState<ManagedAssistantDetail | null>(null);
  const [isListLoading, setIsListLoading] = useState(true);
  const [isDetailLoading, setIsDetailLoading] = useState(false);
  const [isAdopting, setIsAdopting] = useState(false);
  const [isSavingPreferences, setIsSavingPreferences] = useState(false);
  const [isResetting, setIsResetting] = useState(false);
  const [listError, setListError] = useState<ManagedReadError>(null);
  const [detailError, setDetailError] = useState<ManagedReadError>(null);
  const [mutationError, setMutationError] = useState<ManagedMutationError>(null);
  const [isStartReady, setIsStartReady] = useState(false);
  const [startRefreshFailed, setStartRefreshFailed] = useState(false);
  const detailRequestSequence = useRef(0);
  const viewContextRef = useRef<{ assistantId: string | null; generation: number }>({
    assistantId: null,
    generation: 0,
  });

  const beginView = useCallback((assistantId: string): ManagedViewContext => {
    const context = { assistantId, generation: viewContextRef.current.generation + 1 };
    viewContextRef.current = context;
    return context;
  }, []);

  const captureView = useCallback((assistantId: string): ManagedViewContext | null => {
    const current = viewContextRef.current;
    return current.assistantId === assistantId ? { assistantId, generation: current.generation } : null;
  }, []);

  const isCurrentView = useCallback(
    (context: ManagedViewContext): boolean =>
      viewContextRef.current.assistantId === context.assistantId &&
      viewContextRef.current.generation === context.generation,
    []
  );

  const loadList = useCallback(async () => {
    setIsListLoading(true);
    setListError(null);
    try {
      setSummaries(await ipcBridge.managedAssistants.list.invoke());
    } catch (error) {
      setSummaries([]);
      setListError(toReadError(error));
    } finally {
      setIsListLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadList();
  }, [loadList]);

  const verifyManagedProjection = useCallback(
    async (context: ManagedViewContext): Promise<boolean> => {
      if (!isCurrentView(context)) return false;

      try {
        const result = await onAdoptionChanged(context.assistantId);
        if (!isCurrentView(context) || !result.authoritative) return false;
        const ready = result.ok && result.assistants.some((assistant) => assistant.id === context.assistantId);
        setIsStartReady(ready);
        setStartRefreshFailed(!ready);
        return ready;
      } catch {
        if (!isCurrentView(context)) return false;
        setStartRefreshFailed(true);
        setIsStartReady(false);
        return false;
      }
    },
    [isCurrentView, onAdoptionChanged]
  );

  const loadDetail = useCallback(
    async (id: string) => {
      const requestSequence = detailRequestSequence.current + 1;
      detailRequestSequence.current = requestSequence;
      const context = beginView(id);
      setIsDetailLoading(true);
      setIsAdopting(false);
      setIsSavingPreferences(false);
      setIsResetting(false);
      setDetailError(null);
      setMutationError(null);
      setSelectedDetail(null);
      setIsStartReady(false);
      setStartRefreshFailed(false);

      try {
        const detail = await ipcBridge.managedAssistants.get.invoke({ id, locale: localeKey });
        if (detailRequestSequence.current !== requestSequence || !isCurrentView(context)) return null;
        setSelectedDetail(detail);
        if (detail.adoption.active) {
          await verifyManagedProjection(context);
          if (!isCurrentView(context)) return null;
        }
        return detail;
      } catch (error) {
        if (detailRequestSequence.current !== requestSequence || !isCurrentView(context)) return null;
        setDetailError(toReadError(error));
        return null;
      } finally {
        if (detailRequestSequence.current === requestSequence && isCurrentView(context)) {
          setIsDetailLoading(false);
        }
      }
    },
    [beginView, isCurrentView, localeKey, verifyManagedProjection]
  );

  const clearDetail = useCallback(() => {
    detailRequestSequence.current += 1;
    viewContextRef.current = {
      assistantId: null,
      generation: viewContextRef.current.generation + 1,
    };
    setSelectedDetail(null);
    setDetailError(null);
    setMutationError(null);
    setIsDetailLoading(false);
    setIsAdopting(false);
    setIsSavingPreferences(false);
    setIsResetting(false);
    setIsStartReady(false);
    setStartRefreshFailed(false);
  }, []);

  const invalidateCurrentView = useCallback(() => {
    viewContextRef.current = {
      assistantId: viewContextRef.current.assistantId,
      generation: viewContextRef.current.generation + 1,
    };
    setIsAdopting(false);
    setIsSavingPreferences(false);
    setIsResetting(false);
    setMutationError(null);
  }, []);

  const refreshAfterAdoption = useCallback(async () => {
    const assistantId = viewContextRef.current.assistantId;
    if (!assistantId) return false;
    const context = captureView(assistantId);
    return context ? verifyManagedProjection(context) : false;
  }, [captureView, verifyManagedProjection]);

  const adopt = useCallback(
    async (id: string): Promise<AdoptionResult | null> => {
      const context = captureView(id);
      if (!context) return null;
      setIsAdopting(true);
      setMutationError(null);
      setStartRefreshFailed(false);
      try {
        const detail = await ipcBridge.managedAssistants.setAdoption.invoke({ id, locale: localeKey, active: true });
        if (!isCurrentView(context)) return null;
        setSelectedDetail(detail);
        setIsStartReady(false);
        const readyToStart = await verifyManagedProjection(context);
        if (!isCurrentView(context)) return null;
        return { detail, readyToStart };
      } catch {
        if (!isCurrentView(context)) return null;
        setMutationError('adoption');
        return null;
      } finally {
        if (isCurrentView(context)) setIsAdopting(false);
      }
    },
    [captureView, isCurrentView, localeKey, verifyManagedProjection]
  );

  const updatePreferences = useCallback(
    async (id: string, request: ManagedAssistantPreferencesRequest) => {
      const context = captureView(id);
      if (!context) return null;
      setIsSavingPreferences(true);
      setMutationError(null);
      try {
        const detail = await ipcBridge.managedAssistants.updatePreferences.invoke({
          id,
          locale: localeKey,
          ...request,
        });
        if (!isCurrentView(context)) return null;
        setSelectedDetail(detail);
        return detail;
      } catch {
        if (!isCurrentView(context)) return null;
        setMutationError('preferences');
        return null;
      } finally {
        if (isCurrentView(context)) setIsSavingPreferences(false);
      }
    },
    [captureView, isCurrentView, localeKey]
  );

  const resetPreferences = useCallback(
    async (id: string) => {
      const context = captureView(id);
      if (!context) return null;
      setIsResetting(true);
      setMutationError(null);
      try {
        const detail = await ipcBridge.managedAssistants.resetPreferences.invoke({ id, locale: localeKey });
        if (!isCurrentView(context)) return null;
        setSelectedDetail(detail);
        return detail;
      } catch {
        if (!isCurrentView(context)) return null;
        setMutationError('reset');
        return null;
      } finally {
        if (isCurrentView(context)) setIsResetting(false);
      }
    },
    [captureView, isCurrentView, localeKey]
  );

  return {
    summaries,
    selectedDetail,
    isListLoading,
    isDetailLoading,
    isAdopting,
    isSavingPreferences,
    isResetting,
    listError,
    detailError,
    mutationError,
    isStartReady,
    startRefreshFailed,
    loadList,
    loadDetail,
    clearDetail,
    invalidateCurrentView,
    adopt,
    refreshAfterAdoption,
    updatePreferences,
    resetPreferences,
  };
};

export default useManagedLibrary;
