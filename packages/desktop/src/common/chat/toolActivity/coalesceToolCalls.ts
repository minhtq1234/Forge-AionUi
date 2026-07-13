import type { NormalizedToolCall } from '@/common/chat/normalizeToolCall';
import { resolveToolAction } from './resolveToolAction';
import type { CoalescedStep } from './types';

const collectCallDetail = (call: NormalizedToolCall): string =>
  [call.description, call.input].filter(Boolean).join(' ');

const actionKey = (action: CoalescedStep['action']): string => `${action.purpose}:${action.toolKey ?? action.category}`;

// Merge adjacent calls serving the same semantic purpose into one evolving step.
export function coalesceToolCalls(calls: NormalizedToolCall[]): CoalescedStep[] {
  const steps: CoalescedStep[] = [];
  for (const call of calls) {
    const action = resolveToolAction(call.name, call.kind, collectCallDetail(call));
    const previous = steps[steps.length - 1];
    if (previous && actionKey(previous.action) === actionKey(action)) {
      previous.calls.push(call);
      previous.attempts += 1;
      previous.status = call.status;
      previous.hadError ||= call.status === 'error';
      continue;
    }
    steps.push({
      key: call.key,
      rawName: call.name,
      kind: call.kind,
      status: call.status,
      hadError: call.status === 'error',
      attempts: 1,
      calls: [call],
      action,
    });
  }
  return steps;
}
