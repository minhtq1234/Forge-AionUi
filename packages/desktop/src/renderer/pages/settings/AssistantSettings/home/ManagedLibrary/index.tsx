import type { Assistant } from '@/common/types/agent/assistantTypes';
import type { ManagedAssistantDetail } from '@/common/types/agent/managedAssistantTypes';
import type { AssistantListLoadResult } from '@/renderer/hooks/assistant/useAssistantList';
import { Message } from '@arco-design/web-react';
import React, { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import ManagedPersonalSetup from './ManagedPersonalSetup';
import ManagedTeammateDetail from './ManagedTeammateDetail';
import ManagedTeammateList, { managedTeammateCardDomId } from './ManagedTeammateList';
import useManagedLibrary, { hasRenderablePersonalSetup } from './useManagedLibrary';
import type { ManagedLibraryController } from './useManagedLibrary';

type ManagedLibraryView = 'catalog' | 'detail';

type ManagedLibraryProps = {
  localeKey: string;
  initialDetailId?: string | null;
  onInitialDetailConsumed?: () => void;
  onAdoptionChanged: (id: string) => Promise<AssistantListLoadResult>;
  onStartChat: (assistant: Pick<Assistant, 'id'>) => void;
};

type ManagedLibraryContentProps = ManagedLibraryProps & {
  library: ManagedLibraryController;
};

export const ManagedLibraryContent: React.FC<ManagedLibraryContentProps> = ({
  localeKey,
  initialDetailId,
  onInitialDetailConsumed,
  onStartChat,
  library,
}) => {
  const { t, i18n } = useTranslation();
  const [message, messageContext] = Message.useMessage({ maxCount: 3 });
  const [view, setView] = useState<ManagedLibraryView>(initialDetailId ? 'detail' : 'catalog');
  const [selectedId, setSelectedId] = useState<string | null>(initialDetailId ?? null);
  const [setupDetail, setSetupDetail] = useState<ManagedAssistantDetail | null>(null);
  const originatingCardIdRef = useRef<string | null>(null);
  const restoreFocusIdRef = useRef<string | null>(null);

  useEffect(() => {
    if (!initialDetailId) return;
    setSelectedId(initialDetailId);
    setView('detail');
    onInitialDetailConsumed?.();
  }, [initialDetailId, onInitialDetailConsumed]);

  useEffect(() => {
    if (!selectedId || view !== 'detail') return;
    void library.loadDetail(selectedId);
  }, [library.loadDetail, selectedId, view]);

  useLayoutEffect(() => {
    if (view !== 'catalog' || !restoreFocusIdRef.current) return;
    document.getElementById(managedTeammateCardDomId(restoreFocusIdRef.current))?.focus();
    restoreFocusIdRef.current = null;
  }, [view]);

  const handleSelect = useCallback((id: string) => {
    originatingCardIdRef.current = id;
    setSelectedId(id);
    setView('detail');
  }, []);

  const handleBack = useCallback(() => {
    restoreFocusIdRef.current = originatingCardIdRef.current;
    setView('catalog');
    setSelectedId(null);
    setSetupDetail(null);
    library.clearDetail();
  }, [library]);

  const handleAdopt = async () => {
    if (!selectedId) return;
    const result = await library.adopt(selectedId);
    if (!result) return;
    if (hasRenderablePersonalSetup(result.detail)) {
      setSetupDetail(result.detail);
    }
  };

  const handleSetupClose = () => {
    setSetupDetail(null);
    library.invalidateCurrentView();
  };

  const handleSetupSave = async (request: Parameters<typeof library.updatePreferences>[1]) => {
    if (!setupDetail) return;
    const detail = await library.updatePreferences(setupDetail.assistant.id, request);
    if (!detail) return;
    setSetupDetail(detail);
    message.success(t('settings.managedTeammates.setupSaved'));
    setSetupDetail(null);
    library.invalidateCurrentView();
  };

  const handleSetupReset = async () => {
    if (!setupDetail) return;
    const detail = await library.resetPreferences(setupDetail.assistant.id);
    if (!detail) return;
    setSetupDetail(detail);
    message.success(t('settings.managedTeammates.setupReset'));
  };

  return (
    <div dir={i18n.dir(localeKey)}>
      {messageContext}
      {view === 'catalog' ? (
        <ManagedTeammateList
          summaries={library.summaries}
          localeKey={localeKey}
          isLoading={library.isListLoading}
          error={library.listError}
          onRetry={() => void library.loadList()}
          onSelect={handleSelect}
        />
      ) : (
        <ManagedTeammateDetail
          detail={library.selectedDetail}
          localeKey={localeKey}
          isLoading={library.isDetailLoading}
          isAdopting={library.isAdopting}
          error={library.detailError}
          mutationError={library.mutationError}
          lifecycleMutationError={library.lifecycleMutationError}
          lifecycleStateChanged={library.lifecycleStateChanged}
          isMarkingNoticeSeen={library.isMarkingNoticeSeen}
          isAcknowledging={library.isAcknowledging}
          onBack={handleBack}
          onRetry={() => selectedId && void library.loadDetail(selectedId)}
          onAdopt={() => void handleAdopt()}
          onStartChat={() => {
            if (library.selectedDetail) onStartChat(library.selectedDetail.assistant);
          }}
          onMarkNoticeSeen={async (version) => {
            await library.markNoticeSeen(version);
          }}
          onAcknowledge={async (version) => {
            await library.acknowledge(version);
          }}
          onOpenReplacement={handleSelect}
        />
      )}

      {setupDetail ? (
        <ManagedPersonalSetup
          visible
          detail={setupDetail}
          isSaving={library.isSavingPreferences}
          isResetting={library.isResetting}
          error={library.mutationError}
          onClose={handleSetupClose}
          onSave={handleSetupSave}
          onReset={handleSetupReset}
        />
      ) : null}
    </div>
  );
};

const ManagedLibrary: React.FC<ManagedLibraryProps> = (props) => {
  const library = useManagedLibrary({ localeKey: props.localeKey, onAdoptionChanged: props.onAdoptionChanged });
  return <ManagedLibraryContent {...props} library={library} />;
};

export default ManagedLibrary;
