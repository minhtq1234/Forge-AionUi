import { z } from 'zod';
import { createTaskRegistry } from '@/process/services/app-operations/taskRegistry';
import type { AppOperationTaskDefinition } from '@/process/services/app-operations/types';

const fakeTask: AppOperationTaskDefinition<{ value: string }, { value: string }, string> = {
  id: 'test.echo',
  promptVersion: '1',
  inputSchema: z.object({ value: z.string() }),
  prepare: async (input) => input,
  buildMessages: (prepared) => [{ role: 'user', content: prepared.value }],
  parseOutput: (raw) => raw,
  responseMode: 'text',
  temperature: 0,
  maxOutputTokens: 100,
  timeoutMs: 1_000,
  maxTransientRetries: 0,
};

describe('app operations task registry', () => {
  it('registers one immutable definition per task id', () => {
    const registry = createTaskRegistry();

    registry.register(fakeTask);

    expect(registry.get('test.echo')).toBe(fakeTask);
    expect(() => registry.register(fakeTask)).toThrow('duplicate_task');
    expect(() => Object.assign(registry.get('test.echo'), { timeoutMs: 1 })).toThrow();
  });

  it('rejects unknown task ids', () => {
    expect(() => createTaskRegistry().get('missing')).toThrow('unknown_task');
  });

  it('reports registered task ids without exposing the backing collection', () => {
    const registry = createTaskRegistry();
    registry.register(fakeTask);

    expect(registry.has('test.echo')).toBe(true);
    expect(registry.has('missing')).toBe(false);
    expect(Object.keys(registry)).toEqual(['register', 'get', 'has']);
  });
});
