import type { Assistant } from '@/common/types/agent/assistantTypes';
import type { ManagedAssistantDetail } from '@/common/types/agent/managedAssistantTypes';
import { Message } from '@arco-design/web-react';
import React, { useCallback, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import ManagedPersonalSetup from './ManagedPersonalSetup';
import ManagedTeammateDetail from './ManagedTeammateDetail';
import ManagedTeammateList from './ManagedTeammateList';
import useManagedLibrary, { hasPersonalSetup } from './useManagedLibrary';

type ManagedLibraryView = 'catalog' | 'detail';

type ManagedLibraryProps = {
  localeKey: string;
  initialDetailId?: string | null;
  onInitialDetailConsumed?: () => void;
  onAdoptionChanged: () => Promise<void>;
  onStartChat: (assistant: Pick<Assistant, 'id'>) => void;
};

const ManagedLibrary: React.FC<ManagedLibraryProps> = ({
  localeKey,
  initialDetailId,
  onInitialDetailConsumed,
  onAdoptionChanged,
  onStartChat,
}) => {
  const { t } = useTranslation();
  const [message, messageContext] = Message.useMessage({ maxCount: 3 });
  const [view, setView] = useState<ManagedLibraryView>(initialDetailId ? 'detail' : 'catalog');
  const [selectedId, setSelectedId] = useState<string | null>(initialDetailId ?? null);
  const [setupDetail, setSetupDetail] = useState<ManagedAssistantDetail | null>(null);
  const library = useManagedLibrary({ localeKey, onAdoptionChanged });

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

  const handleSelect = useCallback((id: string) => {
    setSelectedId(id);
    setView('detail');
  }, []);

  const handleBack = useCallback(() => {
    setView('catalog');
    setSelectedId(null);
    setSetupDetail(null);
    library.clearDetail();
  }, [library]);

  const handleAdopt = async () => {
    if (!selectedId) return;
    const result = await library.adopt(selectedId);
    if (!result) return;
    if (hasPersonalSetup(result.detail)) {
      setSetupDetail(result.detail);
    }
  };

  const handleSetupClose = () => {
    setSetupDetail(null);
    library.clearMutationError();
  };

  const handleSetupSave = async (request: Parameters<typeof library.updatePreferences>[1]) => {
    if (!setupDetail) return;
    const detail = await library.updatePreferences(setupDetail.assistant.id, request);
    if (!detail) return;
    setSetupDetail(detail);
    message.success(t('settings.managedTeammates.setupSaved'));
    setSetupDetail(null);
  };

  const handleSetupReset = async () => {
    if (!setupDetail) return;
    const detail = await library.resetPreferences(setupDetail.assistant.id);
    if (!detail) return;
    setSetupDetail(detail);
    message.success(t('settings.managedTeammates.setupReset'));
  };

  return (
    <>
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
          isStartReady={library.isStartReady}
          startRefreshFailed={library.startRefreshFailed}
          error={library.detailError}
          mutationError={library.mutationError}
          onBack={handleBack}
          onRetry={() => selectedId && void library.loadDetail(selectedId)}
          onAdopt={() => void handleAdopt()}
          onRetryStartRefresh={() => void library.refreshAfterAdoption()}
          onStartChat={() => {
            if (library.selectedDetail) onStartChat(library.selectedDetail.assistant);
          }}
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
    </>
  );
};

export default ManagedLibrary;
