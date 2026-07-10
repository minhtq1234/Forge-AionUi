import { ipcBridge } from '@/common';
import { isBackendHttpError } from '@/common/adapter/httpBridge';
import type {
  ManagedAssistantDetail,
  ManagedAssistantPreferencesRequest,
  ManagedAssistantSummary,
} from '@/common/types/agent/managedAssistantTypes';
import { useCallback, useEffect, useRef, useState } from 'react';

export type ManagedReadError = 'unauthorized' | 'read' | null;
export type ManagedMutationError = 'adoption' | 'preferences' | 'reset' | null;

type UseManagedLibraryParams = {
  localeKey: string;
  onAdoptionChanged: () => Promise<void>;
};

type AdoptionResult = {
  detail: ManagedAssistantDetail;
  readyToStart: boolean;
};

const toReadError = (error: unknown): Exclude<ManagedReadError, null> =>
  isBackendHttpError(error) && (error.status === 401 || error.status === 403) ? 'unauthorized' : 'read';

export const hasPersonalSetup = (detail: ManagedAssistantDetail): boolean =>
  detail.personalization_policy.allowed_fields.length > 0;

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

  const loadDetail = useCallback(
    async (id: string) => {
      const requestSequence = detailRequestSequence.current + 1;
      detailRequestSequence.current = requestSequence;
      setIsDetailLoading(true);
      setDetailError(null);
      setMutationError(null);
      setSelectedDetail(null);
      setIsStartReady(false);
      setStartRefreshFailed(false);

      try {
        const detail = await ipcBridge.managedAssistants.get.invoke({ id, locale: localeKey });
        if (detailRequestSequence.current !== requestSequence) return null;
        setSelectedDetail(detail);
        setIsStartReady(detail.adoption.active);
        return detail;
      } catch (error) {
        if (detailRequestSequence.current !== requestSequence) return null;
        setDetailError(toReadError(error));
        return null;
      } finally {
        if (detailRequestSequence.current === requestSequence) {
          setIsDetailLoading(false);
        }
      }
    },
    [localeKey]
  );

  const clearDetail = useCallback(() => {
    detailRequestSequence.current += 1;
    setSelectedDetail(null);
    setDetailError(null);
    setMutationError(null);
    setIsDetailLoading(false);
    setIsStartReady(false);
    setStartRefreshFailed(false);
  }, []);

  const clearMutationError = useCallback(() => setMutationError(null), []);

  const refreshAfterAdoption = useCallback(async () => {
    setStartRefreshFailed(false);
    try {
      await onAdoptionChanged();
      setIsStartReady(true);
      return true;
    } catch {
      setStartRefreshFailed(true);
      setIsStartReady(false);
      return false;
    }
  }, [onAdoptionChanged]);

  const adopt = useCallback(
    async (id: string): Promise<AdoptionResult | null> => {
      setIsAdopting(true);
      setMutationError(null);
      setStartRefreshFailed(false);
      try {
        const detail = await ipcBridge.managedAssistants.setAdoption.invoke({ id, locale: localeKey, active: true });
        setSelectedDetail(detail);
        setIsStartReady(false);
        const readyToStart = await refreshAfterAdoption();
        return { detail, readyToStart };
      } catch {
        setMutationError('adoption');
        return null;
      } finally {
        setIsAdopting(false);
      }
    },
    [localeKey, refreshAfterAdoption]
  );

  const updatePreferences = useCallback(
    async (id: string, request: ManagedAssistantPreferencesRequest) => {
      setIsSavingPreferences(true);
      setMutationError(null);
      try {
        const detail = await ipcBridge.managedAssistants.updatePreferences.invoke({
          id,
          locale: localeKey,
          ...request,
        });
        setSelectedDetail(detail);
        return detail;
      } catch {
        setMutationError('preferences');
        return null;
      } finally {
        setIsSavingPreferences(false);
      }
    },
    [localeKey]
  );

  const resetPreferences = useCallback(
    async (id: string) => {
      setIsResetting(true);
      setMutationError(null);
      try {
        const detail = await ipcBridge.managedAssistants.resetPreferences.invoke({ id, locale: localeKey });
        setSelectedDetail(detail);
        return detail;
      } catch {
        setMutationError('reset');
        return null;
      } finally {
        setIsResetting(false);
      }
    },
    [localeKey]
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
    clearMutationError,
    adopt,
    refreshAfterAdoption,
    updatePreferences,
    resetPreferences,
  };
};

export default useManagedLibrary;
