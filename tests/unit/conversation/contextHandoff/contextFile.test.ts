import { describe, expect, it } from 'vitest';
import {
  buildWorkspaceFilePath,
  resolveAvailableContextFile,
} from '@/renderer/pages/conversation/contextHandoff/contextFile';

describe('contextFile helpers', () => {
  it('builds workspace file paths without using Node APIs in the renderer', () => {
    expect(buildWorkspaceFilePath('/tmp/workspace/', 'Context.md')).toBe('/tmp/workspace/Context.md');
    expect(buildWorkspaceFilePath('/tmp/workspace', 'Context.md')).toBe('/tmp/workspace/Context.md');
  });

  it('always resolves to the active Context.md file so new context replaces the old one', async () => {
    const existing = new Set(['/tmp/workspace/Context.md', '/tmp/workspace/Context-2.md']);
    const file = await resolveAvailableContextFile({
      workspace: '/tmp/workspace',
      exists: async (filePath) => existing.has(filePath),
    });

    expect(file).toEqual({ fileName: 'Context.md', filePath: '/tmp/workspace/Context.md' });
  });
});
