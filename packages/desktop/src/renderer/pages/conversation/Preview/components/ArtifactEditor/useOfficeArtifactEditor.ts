/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import { ipcBridge } from '@/common';
import type {
  OfficeArtifactEdit,
  OfficeArtifactErrorCode,
  OfficeArtifactInspection,
  OfficeArtifactMutationResult,
  OfficeArtifactSelection,
} from '@/common/types/office/artifactEditor';
import type { WebviewHostScriptRequest } from '@/renderer/components/media/WebviewHost';
import { useCallback, useEffect, useRef, useState } from 'react';

export type OfficeArtifactEditorStatus =
  | 'ready'
  | 'inspecting'
  | 'saving'
  | 'saved'
  | 'saveFailed'
  | 'fileChanged'
  | 'openingDesktop'
  | 'openedDesktop';

export type OfficeSelectionDirection = 'up' | 'down' | 'left' | 'right';

export type UseOfficeArtifactEditorOptions = {
  enabled?: boolean;
  conversationId: string;
  workspace: string;
  filePath: string;
  externalRevision?: number | string;
  onArtifactMutated: () => void;
};

export type UseOfficeArtifactEditorResult = {
  version: string | null;
  undoDepth: number;
  inspection: OfficeArtifactInspection | null;
  status: OfficeArtifactEditorStatus;
  scriptRequest: WebviewHostScriptRequest | undefined;
  handleSelectionChange: (selection: OfficeArtifactSelection) => void;
  apply: (edit: OfficeArtifactEdit) => Promise<boolean>;
  undo: () => Promise<boolean>;
  openInDesktopApp: () => Promise<boolean>;
  moveSelection: (direction: OfficeSelectionDirection) => void;
};

function failureStatus(code: OfficeArtifactErrorCode): OfficeArtifactEditorStatus {
  return code === 'FILE_CHANGED' || code === 'STALE_SELECTION' ? 'fileChanged' : 'saveFailed';
}

function isUnsupportedSelectionCode(code: OfficeArtifactErrorCode): boolean {
  return code === 'UNSUPPORTED_CONTENT' || code === 'AMBIGUOUS_TEXT';
}

/** Coordinate versioned Office inspection, mutation, undo, and composer context. */
export function useOfficeArtifactEditor(options: UseOfficeArtifactEditorOptions): UseOfficeArtifactEditorResult {
  const { enabled = true, conversationId, workspace, filePath, externalRevision } = options;
  const [version, setVersion] = useState<string | null>(null);
  const [undoDepth, setUndoDepth] = useState(0);
  const [inspection, setInspection] = useState<OfficeArtifactInspection | null>(null);
  const [status, setStatus] = useState<OfficeArtifactEditorStatus>('ready');
  const [scriptRequest, setScriptRequest] = useState<WebviewHostScriptRequest>();

  const versionRef = useRef<string | null>(null);
  const pendingSelectionRef = useRef<OfficeArtifactSelection | null>(null);
  const selectionRef = useRef<OfficeArtifactSelection | null>(null);
  const inspectionRef = useRef<OfficeArtifactInspection | null>(null);
  const sessionRequestRef = useRef(0);
  const inspectRequestRef = useRef(0);
  const mutationRequestRef = useRef(0);
  const navigationRequestRef = useRef(0);
  const mutationPendingRef = useRef(false);
  const conflictPendingRef = useRef(false);
  const deferredStateReloadRef = useRef(false);
  const observedExternalRevisionRef = useRef(externalRevision);
  const currentExternalRevisionRef = useRef(externalRevision);
  const onArtifactMutatedRef = useRef(options.onArtifactMutated);
  onArtifactMutatedRef.current = options.onArtifactMutated;
  currentExternalRevisionRef.current = externalRevision;

  const clearSelection = useCallback((): void => {
    inspectRequestRef.current += 1;
    pendingSelectionRef.current = null;
    selectionRef.current = null;
    inspectionRef.current = null;
    setInspection(null);
  }, []);

  const inspectSelection = useCallback(
    (selection: OfficeArtifactSelection, expectedVersion: string, sessionId: number): void => {
      const requestId = inspectRequestRef.current + 1;
      inspectRequestRef.current = requestId;
      pendingSelectionRef.current = selection;
      selectionRef.current = null;
      inspectionRef.current = null;
      setInspection(null);
      setStatus('inspecting');

      void ipcBridge.officeArtifact.inspect
        .invoke({ conversationId, workspace, filePath, expectedVersion, selection })
        .then((result) => {
          if (sessionRequestRef.current !== sessionId || inspectRequestRef.current !== requestId) return;
          pendingSelectionRef.current = null;
          if (result.ok === false) {
            if (isUnsupportedSelectionCode(result.code)) {
              // Not every selection is editable (e.g. a shape or text box). There is
              // no failing edit to offer here, so drop back to the normal idle state
              // instead of surfacing a dead-end status.
              clearSelection();
              setStatus('ready');
            } else {
              selectionRef.current = null;
              setStatus(failureStatus(result.code));
            }
            return;
          }
          versionRef.current = result.version;
          conflictPendingRef.current = false;
          selectionRef.current = selection;
          inspectionRef.current = result.inspection;
          setVersion(result.version);
          setInspection(result.inspection);
          setStatus('ready');
        })
        .catch(() => {
          if (sessionRequestRef.current !== sessionId || inspectRequestRef.current !== requestId) return;
          pendingSelectionRef.current = null;
          selectionRef.current = null;
          setStatus('saveFailed');
        });
    },
    [conversationId, filePath, workspace]
  );

  const reloadState = useCallback((): void => {
    const requestId = sessionRequestRef.current + 1;
    sessionRequestRef.current = requestId;
    mutationRequestRef.current += 1;
    mutationPendingRef.current = false;
    conflictPendingRef.current = false;
    deferredStateReloadRef.current = false;
    versionRef.current = null;
    setVersion(null);
    setUndoDepth(0);
    setStatus('ready');
    setScriptRequest(undefined);
    clearSelection();

    if (!enabled) return;

    void ipcBridge.officeArtifact.getState
      .invoke({ conversationId, workspace, filePath })
      .then((result) => {
        if (sessionRequestRef.current !== requestId) return;
        if (result.ok === false) {
          pendingSelectionRef.current = null;
          setStatus(failureStatus(result.code));
          return;
        }
        versionRef.current = result.version;
        setVersion(result.version);
        setUndoDepth(result.undoDepth);
        const pendingSelection = pendingSelectionRef.current;
        if (pendingSelection) inspectSelection(pendingSelection, result.version, requestId);
      })
      .catch(() => {
        if (sessionRequestRef.current === requestId) {
          pendingSelectionRef.current = null;
          setStatus('saveFailed');
        }
      });
  }, [clearSelection, conversationId, enabled, filePath, inspectSelection, workspace]);

  useEffect(() => {
    observedExternalRevisionRef.current = currentExternalRevisionRef.current;
    reloadState();

    return () => {
      sessionRequestRef.current += 1;
    };
  }, [reloadState]);

  useEffect(() => {
    if (Object.is(observedExternalRevisionRef.current, externalRevision)) return;
    observedExternalRevisionRef.current = externalRevision;
    if (!enabled) return;
    if (mutationPendingRef.current) {
      deferredStateReloadRef.current = true;
      return;
    }
    reloadState();
  }, [enabled, externalRevision, reloadState]);

  const finishMutation = useCallback(
    (mutationId: number): void => {
      if (mutationRequestRef.current !== mutationId) return;
      mutationPendingRef.current = false;
      if (!deferredStateReloadRef.current) return;
      deferredStateReloadRef.current = false;
      reloadState();
    },
    [reloadState]
  );

  const handleSelectionChange = useCallback(
    (selection: OfficeArtifactSelection): void => {
      if (mutationPendingRef.current || conflictPendingRef.current) return;
      const expectedVersion = versionRef.current;
      const sessionId = sessionRequestRef.current;
      pendingSelectionRef.current = selection;
      selectionRef.current = null;
      inspectionRef.current = null;
      setInspection(null);
      setStatus('inspecting');
      if (!expectedVersion) return;
      inspectSelection(selection, expectedVersion, sessionId);
    },
    [inspectSelection]
  );

  const applyMutationResult = useCallback(
    (result: OfficeArtifactMutationResult, sessionId: number, mutationId: number): boolean => {
      if (sessionRequestRef.current !== sessionId || mutationRequestRef.current !== mutationId) return false;
      if (result.ok === false) {
        if (result.code === 'FILE_CHANGED' || result.code === 'STALE_SELECTION') {
          conflictPendingRef.current = true;
          setStatus(failureStatus(result.code));
        } else if (isUnsupportedSelectionCode(result.code)) {
          // Not every selection is editable (e.g. a shape or text box). There is
          // no failing edit to offer here, so drop back to the normal idle state
          // instead of surfacing a dead-end status.
          clearSelection();
          setStatus('ready');
        } else {
          setStatus(failureStatus(result.code));
        }
        return false;
      }

      versionRef.current = result.version;
      setVersion(result.version);
      setUndoDepth(result.undoDepth);
      clearSelection();
      setStatus('saved');
      onArtifactMutatedRef.current();
      return true;
    },
    [clearSelection]
  );

  const apply = useCallback(
    async (edit: OfficeArtifactEdit): Promise<boolean> => {
      const expectedVersion = versionRef.current;
      const selection = selectionRef.current;
      if (!expectedVersion || !selection || mutationPendingRef.current || conflictPendingRef.current) return false;

      mutationPendingRef.current = true;
      inspectRequestRef.current += 1;
      const sessionId = sessionRequestRef.current;
      const mutationId = mutationRequestRef.current + 1;
      mutationRequestRef.current = mutationId;
      setStatus('saving');

      try {
        const result = await ipcBridge.officeArtifact.apply.invoke({
          conversationId,
          workspace,
          filePath,
          expectedVersion,
          selection,
          edit,
        });
        return applyMutationResult(result, sessionId, mutationId);
      } catch {
        if (sessionRequestRef.current === sessionId && mutationRequestRef.current === mutationId) {
          setStatus('saveFailed');
        }
        return false;
      } finally {
        finishMutation(mutationId);
      }
    },
    [applyMutationResult, conversationId, filePath, finishMutation, workspace]
  );

  const undo = useCallback(async (): Promise<boolean> => {
    const expectedVersion = versionRef.current;
    if (!expectedVersion || undoDepth <= 0 || mutationPendingRef.current) return false;

    mutationPendingRef.current = true;
    inspectRequestRef.current += 1;
    const sessionId = sessionRequestRef.current;
    const mutationId = mutationRequestRef.current + 1;
    mutationRequestRef.current = mutationId;
    setStatus('saving');

    try {
      const result = await ipcBridge.officeArtifact.undo.invoke({
        conversationId,
        workspace,
        filePath,
        expectedVersion,
      });
      return applyMutationResult(result, sessionId, mutationId);
    } catch {
      if (sessionRequestRef.current === sessionId && mutationRequestRef.current === mutationId) {
        setStatus('saveFailed');
      }
      return false;
    } finally {
      finishMutation(mutationId);
    }
  }, [applyMutationResult, conversationId, filePath, finishMutation, undoDepth, workspace]);

  const openInDesktopApp = useCallback(async (): Promise<boolean> => {
    const sessionId = sessionRequestRef.current;
    setStatus('openingDesktop');
    try {
      await ipcBridge.shell.openFile.invoke(filePath);
      if (sessionRequestRef.current !== sessionId) return false;
      setStatus('openedDesktop');
      return true;
    } catch {
      if (sessionRequestRef.current === sessionId) setStatus('ready');
      return false;
    }
  }, [filePath]);

  const moveSelection = useCallback((direction: OfficeSelectionDirection): void => {
    navigationRequestRef.current += 1;
    setScriptRequest({
      id: navigationRequestRef.current,
      script: `typeof window.__forgeOfficeMoveSelection === 'function' && window.__forgeOfficeMoveSelection('${direction}');`,
    });
  }, []);

  return {
    version,
    undoDepth,
    inspection,
    status,
    scriptRequest,
    handleSelectionChange,
    apply,
    undo,
    openInDesktopApp,
    moveSelection,
  };
}
