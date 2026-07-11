import { ipcBridge } from '@/common';
import { isBackendHttpError } from '@/common/adapter/httpBridge';
import type {
  ManagedAssistantDetail,
  ManagedAssistantPreferencesRequest,
  ManagedAssistantSummary,
  ManagedPersonalizationField,
} from '@/common/types/agent/managedAssistantTypes';
import type { AssistantListLoadResult } from '@/renderer/hooks/assistant/useAssistantList';
import type { ManagedLifecycleMutationError } from '@/renderer/components/ManagedTeammates';
import { useCallback, useEffect, useRef, useState } from 'react';

export type ManagedReadError = 'unauthorized' | 'read' | null;
export type ManagedMutationError = 'adoption' | 'preferences' | 'reset' | null;

type UseManagedLibraryParams = {
  localeKey: string;
  onAdoptionChanged: (id: string) => Promise<AssistantListLoadResult>;
};

type AdoptionResult = {
  detail: ManagedAssistantDetail;
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
  const [isMarkingNoticeSeen, setIsMarkingNoticeSeen] = useState(false);
  const [isAcknowledging, setIsAcknowledging] = useState(false);
  const [listError, setListError] = useState<ManagedReadError>(null);
  const [detailError, setDetailError] = useState<ManagedReadError>(null);
  const [mutationError, setMutationError] = useState<ManagedMutationError>(null);
  const [lifecycleMutationError, setLifecycleMutationError] = useState<ManagedLifecycleMutationError>(null);
  const [lifecycleStateChanged, setLifecycleStateChanged] = useState(false);
  const detailRequestSequence = useRef(0);
  const lifecycleMutationSequence = useRef(0);
  const lifecyclePendingSequences = useRef({ notice: 0, acknowledgement: 0 });
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

  const replaceDetail = useCallback((detail: ManagedAssistantDetail) => {
    setSelectedDetail(detail);
    setSummaries((current) =>
      current.map((summary) =>
        summary.assistant.id === detail.assistant.id
          ? {
              ...summary,
              governance: detail.governance,
              adoption: detail.adoption,
              update: detail.update,
              start_state: detail.start_state,
            }
          : summary
      )
    );
  }, []);

  useEffect(() => {
    void loadList();
  }, [loadList]);

  const refreshManagedProjection = useCallback(
    async (context: ManagedViewContext): Promise<boolean> => {
      if (!isCurrentView(context)) return false;

      try {
        const result = await onAdoptionChanged(context.assistantId);
        if (!isCurrentView(context) || !result.authoritative) return false;
        return result.ok && result.assistants.some((assistant) => assistant.id === context.assistantId);
      } catch {
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
      setIsMarkingNoticeSeen(false);
      setIsAcknowledging(false);
      setDetailError(null);
      setMutationError(null);
      setLifecycleMutationError(null);
      setLifecycleStateChanged(false);
      setSelectedDetail(null);

      try {
        const detail = await ipcBridge.managedAssistants.get.invoke({ id, locale: localeKey });
        if (detailRequestSequence.current !== requestSequence || !isCurrentView(context)) return null;
        replaceDetail(detail);
        if (detail.adoption.active) {
          void refreshManagedProjection(context);
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
    [beginView, isCurrentView, localeKey, refreshManagedProjection, replaceDetail]
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
    setLifecycleMutationError(null);
    setLifecycleStateChanged(false);
    setIsDetailLoading(false);
    setIsAdopting(false);
    setIsSavingPreferences(false);
    setIsResetting(false);
    setIsMarkingNoticeSeen(false);
    setIsAcknowledging(false);
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
    setIsMarkingNoticeSeen(false);
    setIsAcknowledging(false);
    setLifecycleMutationError(null);
    setLifecycleStateChanged(false);
  }, []);

  const refreshAfterAdoption = useCallback(async () => {
    const assistantId = viewContextRef.current.assistantId;
    if (!assistantId) return false;
    const context = captureView(assistantId);
    return context ? refreshManagedProjection(context) : false;
  }, [captureView, refreshManagedProjection]);

  const adopt = useCallback(
    async (id: string): Promise<AdoptionResult | null> => {
      const context = captureView(id);
      if (!context) return null;
      setIsAdopting(true);
      setMutationError(null);
      try {
        const detail = await ipcBridge.managedAssistants.setAdoption.invoke({ id, locale: localeKey, active: true });
        if (!isCurrentView(context)) return null;
        replaceDetail(detail);
        void refreshManagedProjection(context);
        return { detail };
      } catch {
        if (!isCurrentView(context)) return null;
        setMutationError('adoption');
        return null;
      } finally {
        if (isCurrentView(context)) setIsAdopting(false);
      }
    },
    [captureView, isCurrentView, localeKey, refreshManagedProjection, replaceDetail]
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
        replaceDetail(detail);
        return detail;
      } catch {
        if (!isCurrentView(context)) return null;
        setMutationError('preferences');
        return null;
      } finally {
        if (isCurrentView(context)) setIsSavingPreferences(false);
      }
    },
    [captureView, isCurrentView, localeKey, replaceDetail]
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
        replaceDetail(detail);
        return detail;
      } catch {
        if (!isCurrentView(context)) return null;
        setMutationError('reset');
        return null;
      } finally {
        if (isCurrentView(context)) setIsResetting(false);
      }
    },
    [captureView, isCurrentView, localeKey, replaceDetail]
  );

  const refreshLifecycleDetail = useCallback(
    async (
      context: ManagedViewContext,
      mutationSequence: number,
      kind: Exclude<ManagedLifecycleMutationError, null>
    ) => {
      try {
        const detail = await ipcBridge.managedAssistants.get.invoke({ id: context.assistantId, locale: localeKey });
        if (!isCurrentView(context) || lifecycleMutationSequence.current !== mutationSequence) return null;
        replaceDetail(detail);
        return detail;
      } catch {
        if (!isCurrentView(context) || lifecycleMutationSequence.current !== mutationSequence) return null;
        setLifecycleMutationError(kind);
        return null;
      }
    },
    [isCurrentView, localeKey, replaceDetail]
  );

  const runLifecycleMutation = useCallback(
    async (
      kind: Exclude<ManagedLifecycleMutationError, null>,
      version: number,
      invoke: (params: { id: string; locale: string; version: number }) => Promise<ManagedAssistantDetail>
    ) => {
      const assistantId = viewContextRef.current.assistantId;
      if (!assistantId) return null;
      const context = captureView(assistantId);
      if (!context) return null;
      const mutationSequence = lifecycleMutationSequence.current + 1;
      lifecycleMutationSequence.current = mutationSequence;
      lifecyclePendingSequences.current[kind] = mutationSequence;
      if (kind === 'notice') setIsMarkingNoticeSeen(true);
      else setIsAcknowledging(true);
      setLifecycleMutationError(null);
      setLifecycleStateChanged(false);

      try {
        const detail = await invoke({ id: assistantId, locale: localeKey, version });
        if (!isCurrentView(context) || lifecycleMutationSequence.current !== mutationSequence) return null;
        replaceDetail(detail);
        return detail;
      } catch (error) {
        if (!isCurrentView(context) || lifecycleMutationSequence.current !== mutationSequence) return null;
        const mismatchCode =
          kind === 'notice' ? 'MANAGED_ASSISTANT_NOTICE_VERSION_MISMATCH' : 'MANAGED_ASSISTANT_ACK_VERSION_MISMATCH';
        if (isBackendHttpError(error) && error.status === 409 && error.code === mismatchCode) {
          setLifecycleStateChanged(true);
          const refreshed = await refreshLifecycleDetail(context, mutationSequence, kind);
          if (isCurrentView(context) && lifecycleMutationSequence.current === mutationSequence) {
            setLifecycleStateChanged(true);
            if (refreshed) setLifecycleMutationError(null);
          }
          return null;
        }
        setLifecycleMutationError(kind);
        return null;
      } finally {
        if (isCurrentView(context) && lifecyclePendingSequences.current[kind] === mutationSequence) {
          if (kind === 'notice') setIsMarkingNoticeSeen(false);
          else setIsAcknowledging(false);
        }
      }
    },
    [captureView, isCurrentView, localeKey, refreshLifecycleDetail, replaceDetail]
  );

  const markNoticeSeen = useCallback(
    (version: number) => runLifecycleMutation('notice', version, ipcBridge.managedAssistants.markNoticeSeen.invoke),
    [runLifecycleMutation]
  );

  const acknowledge = useCallback(
    (version: number) =>
      runLifecycleMutation('acknowledgement', version, ipcBridge.managedAssistants.acknowledge.invoke),
    [runLifecycleMutation]
  );

  return {
    summaries,
    selectedDetail,
    isListLoading,
    isDetailLoading,
    isAdopting,
    isSavingPreferences,
    isResetting,
    isMarkingNoticeSeen,
    isAcknowledging,
    listError,
    detailError,
    mutationError,
    lifecycleMutationError,
    lifecycleStateChanged,
    loadList,
    loadDetail,
    clearDetail,
    invalidateCurrentView,
    adopt,
    refreshAfterAdoption,
    updatePreferences,
    resetPreferences,
    markNoticeSeen,
    acknowledge,
  };
};

export type ManagedLibraryController = ReturnType<typeof useManagedLibrary>;

export default useManagedLibrary;
