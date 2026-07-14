import type { NormalizedToolCall } from '@/common/chat/normalizeToolCall';
import { resolveToolAction } from './resolveToolAction';
import type { CoalescedStep } from './types';

const collectCallDetail = (call: NormalizedToolCall): string =>
  [call.description, call.input].filter(Boolean).join(' ');

// Merge only repeated snapshots of the same stable call identity.
export function coalesceToolCalls(calls: NormalizedToolCall[]): CoalescedStep[] {
  const steps: CoalescedStep[] = [];
  const stepByCallId = new Map<string, CoalescedStep>();
  for (const call of calls) {
    const action = resolveToolAction(call.name, call.kind, collectCallDetail(call));
    const existing = call.key.length > 0 ? stepByCallId.get(call.key) : undefined;
    if (existing) {
      existing.calls.push(call);
      existing.attempts += 1;
      existing.status = call.status;
      existing.hadError ||= call.status === 'error';
      continue;
    }
    const step: CoalescedStep = {
      key: call.key,
      rawName: call.name,
      kind: call.kind,
      status: call.status,
      hadError: call.status === 'error',
      attempts: 1,
      calls: [call],
      action,
    };
    steps.push(step);
    if (call.key.length > 0) stepByCallId.set(call.key, step);
  }
  return steps;
}
