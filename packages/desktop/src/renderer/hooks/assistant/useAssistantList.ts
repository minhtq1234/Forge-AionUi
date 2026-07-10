import { ipcBridge } from '@/common';
import { resolveLocaleKey } from '@/common/utils';
import type { Assistant } from '@/common/types/agent/assistantTypes';
import {
  applyAssistantSortOrders,
  buildAssistantSortUpdates,
  reorderAssistantList,
} from '@/renderer/pages/settings/AssistantSettings/assistantUtils';
import { useCallback, useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';

export type AssistantListLoadResult =
  | { ok: true; authoritative: true; assistants: Assistant[] }
  | { ok: false; authoritative: true }
  | { ok: false; authoritative: false };

/**
 * Manages the assistant list: loading from backend, sorting, and tracking the
 * active selection. The backend returns a single ordered assistant catalog,
 * so no client-side merge logic is needed.
 */
export const useAssistantList = () => {
  const { i18n } = useTranslation();
  const [assistants, setAssistants] = useState<Assistant[]>([]);
  const [activeAssistantId, setActiveAssistantId] = useState<string | null>(null);
  const localeKey = resolveLocaleKey(i18n.language);
  const previousLocaleKeyRef = useRef(localeKey);
  const refreshGenerationRef = useRef(0);

  const loadAssistants = useCallback(async (): Promise<AssistantListLoadResult> => {
    const refreshGeneration = refreshGenerationRef.current + 1;
    refreshGenerationRef.current = refreshGeneration;

    try {
      const list = await ipcBridge.assistants.list.invoke();
      if (refreshGeneration !== refreshGenerationRef.current) {
        return { ok: false, authoritative: false };
      }

      setAssistants(list);
      setActiveAssistantId((prev) => {
        if (prev && list.some((a) => a.id === prev)) return prev;
        return list[0]?.id ?? null;
      });
      return { ok: true, authoritative: true, assistants: list };
    } catch (error) {
      if (refreshGeneration !== refreshGenerationRef.current) {
        return { ok: false, authoritative: false };
      }
      console.error('Failed to load assistants:', error);
      return { ok: false, authoritative: true };
    }
  }, []);

  const reorderAssistants = useCallback(
    async (activeId: string, overId: string) => {
      const reorderedAssistants = reorderAssistantList(assistants, activeId, overId);
      if (reorderedAssistants === assistants) {
        return;
      }

      const normalizedAssistants = applyAssistantSortOrders(reorderedAssistants);
      const sortUpdates = buildAssistantSortUpdates(assistants, normalizedAssistants);
      if (sortUpdates.length === 0) {
        setAssistants(normalizedAssistants);
        return;
      }

      const previousAssistants = assistants;
      setAssistants(normalizedAssistants);

      try {
        await Promise.all(sortUpdates.map((update) => ipcBridge.assistants.setState.invoke(update)));
      } catch (error) {
        console.error('Failed to reorder assistants:', error);
        setAssistants(previousAssistants);
      }
    },
    [assistants]
  );

  useEffect(() => {
    void loadAssistants();
  }, [loadAssistants]);

  useEffect(() => {
    const localeChanged = previousLocaleKeyRef.current !== localeKey;
    previousLocaleKeyRef.current = localeKey;

    if (!localeChanged) {
      return;
    }

    void loadAssistants();
  }, [loadAssistants, localeKey]);

  const activeAssistant = assistants.find((a) => a.id === activeAssistantId) ?? null;

  return {
    assistants,
    setAssistants,
    activeAssistantId,
    setActiveAssistantId,
    activeAssistant,
    loadAssistants,
    reorderAssistants,
    localeKey,
  };
};
