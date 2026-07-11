import type { ManagedAssistantDetail } from '@/common/types/agent/managedAssistantTypes';
import React from 'react';
import ManagedAvailabilityNotice from './ManagedAvailabilityNotice';
import ManagedRetirementNotice from './ManagedRetirementNotice';
import styles from './ManagedTeammates.module.css';
import ManagedUpdateNotice, { type ManagedLifecycleMutationError } from './ManagedUpdateNotice';

export type ManagedLifecycleNoticesProps = {
  detail: ManagedAssistantDetail;
  localeKey: string;
  isMarkingNoticeSeen: boolean;
  isAcknowledging: boolean;
  mutationError: ManagedLifecycleMutationError;
  stateChanged: boolean;
  onMarkNoticeSeen: (version: number) => Promise<void>;
  onAcknowledge: (version: number) => Promise<void>;
  onRefresh: () => void;
  onOpenReplacement: (id: string) => void;
};

const ManagedLifecycleNotices: React.FC<ManagedLifecycleNoticesProps> = ({
  detail,
  localeKey,
  isMarkingNoticeSeen,
  isAcknowledging,
  mutationError,
  stateChanged,
  onMarkNoticeSeen,
  onAcknowledge,
  onRefresh,
  onOpenReplacement,
}) => {
  const retired = detail.governance.lifecycle === 'retired' || detail.start_state.blocker === 'retired';
  const plannedRetirement = retired && detail.start_state.can_start_new_work;
  const temporarilyUnavailable = detail.start_state.blocker === 'temporarily_unavailable';

  return (
    <div className={styles.noticeStack}>
      {retired ? (
        <ManagedRetirementNotice
          detail={detail}
          localeKey={localeKey}
          planned={plannedRetirement}
          onOpenReplacement={onOpenReplacement}
        />
      ) : null}
      {temporarilyUnavailable ? (
        <ManagedAvailabilityNotice startState={detail.start_state} localeKey={localeKey} onRefresh={onRefresh} />
      ) : null}
      <ManagedUpdateNotice
        detail={detail}
        localeKey={localeKey}
        isMarkingNoticeSeen={isMarkingNoticeSeen}
        isAcknowledging={isAcknowledging}
        mutationError={mutationError}
        stateChanged={stateChanged}
        onMarkNoticeSeen={onMarkNoticeSeen}
        onAcknowledge={onAcknowledge}
        onRefresh={onRefresh}
      />
    </div>
  );
};

export default ManagedLifecycleNotices;
