import type { AnyAppOperationTaskDefinition, AppOperationTaskDefinition } from './types';

export type AppOperationTaskRegistry = {
  register: <Input, Prepared, Output>(definition: AppOperationTaskDefinition<Input, Prepared, Output>) => void;
  get: (taskId: string) => AnyAppOperationTaskDefinition;
  has: (taskId: string) => boolean;
};

export const createTaskRegistry = (): AppOperationTaskRegistry => {
  const definitions = new Map<string, AnyAppOperationTaskDefinition>();

  return {
    register: (definition) => {
      if (definitions.has(definition.id)) throw new Error('duplicate_task');
      Object.freeze(definition);
      definitions.set(definition.id, definition as unknown as AnyAppOperationTaskDefinition);
    },
    get: (taskId) => {
      const definition = definitions.get(taskId);
      if (!definition) throw new Error('unknown_task');
      return definition;
    },
    has: (taskId) => definitions.has(taskId),
  };
};
