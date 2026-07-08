import type { NormalizedToolCall } from '@/common/chat/normalizeToolCall';
import type { CoalescedStep } from './types';

// Merge CONSECUTIVE calls of the same tool (same raw name) into one evolving
// step. Interleaved different tools stay separate and ordered. The merged
// status is the last call's status; `attempts` counts the merged calls.
export function coalesceToolCalls(calls: NormalizedToolCall[]): CoalescedStep[] {
  const steps: CoalescedStep[] = [];
  for (const call of calls) {
    const prev = steps[steps.length - 1];
    if (prev && prev.rawName === call.name) {
      prev.calls.push(call);
      prev.attempts += 1;
      prev.status = call.status;
      continue;
    }
    steps.push({
      key: call.key,
      rawName: call.name,
      kind: call.kind,
      status: call.status,
      attempts: 1,
      calls: [call],
    });
  }
  return steps;
}
