import type { ManagedAssistantDetail, ManagedAssistantSummary } from '@/common/types/agent/managedAssistantTypes';

export type ManagedLifecycleState =
  | 'available'
  | 'routine_update'
  | 'acknowledgement_required'
  | 'planned_retirement'
  | 'retired'
  | 'temporarily_unavailable';

type ManagedLifecycleSource =
  | Pick<ManagedAssistantDetail, 'governance' | 'start_state' | 'update'>
  | ManagedAssistantSummary;

export const getManagedLifecycleState = (managed: ManagedLifecycleSource): ManagedLifecycleState => {
  if (managed.start_state.blocker === 'retired' && !managed.start_state.can_start_new_work) return 'retired';
  if (managed.start_state.blocker === 'temporarily_unavailable') return 'temporarily_unavailable';
  if (managed.update.acknowledgement_required) return 'acknowledgement_required';
  if (managed.governance.lifecycle === 'retired') {
    return managed.start_state.can_start_new_work ? 'planned_retirement' : 'retired';
  }
  if (managed.update.notice_pending) return 'routine_update';
  return 'available';
};

export const canStartManagedAssistant = (managed: ManagedLifecycleSource): boolean =>
  managed.start_state.can_start_new_work && !managed.update.acknowledgement_required;

export const formatManagedTimestamp = (timestamp: number, localeKey: string): string => {
  const milliseconds = timestamp < 1_000_000_000_000 ? timestamp * 1000 : timestamp;
  return new Intl.DateTimeFormat(localeKey, {
    dateStyle: 'medium',
    timeStyle: 'short',
  }).format(new Date(milliseconds));
};
