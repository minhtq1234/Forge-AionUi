import { describe, expect, it } from 'vitest';
import { buildDefaultMcpServers } from '@/process/utils/runBackendMigrations';
import {
  BUILTIN_MEMORY_NAME,
  BUILTIN_TAVILY_NAME,
  BUILTIN_GITHUB_NAME,
  BUILTIN_POSTGRES_NAME,
} from '@/common/config/builtinCapabilities';

describe('buildDefaultMcpServers', () => {
  const servers = buildDefaultMcpServers();
  const byName = new Map(servers.map((s) => [s.name, s]));

  it('seeds memory enabled by default', () => {
    const memory = byName.get(BUILTIN_MEMORY_NAME);
    expect(memory).toBeDefined();
    expect(memory?.enabled).toBe(true);
    expect(memory?.builtin).toBe(true);
  });

  it('seeds tier2 servers disabled by default', () => {
    for (const name of [BUILTIN_TAVILY_NAME, BUILTIN_GITHUB_NAME, BUILTIN_POSTGRES_NAME]) {
      const s = byName.get(name);
      expect(s, name).toBeDefined();
      expect(s?.enabled, name).toBe(false);
      expect(s?.builtin, name).toBe(true);
    }
  });

  it('enables the bundled chrome-devtools server by default', () => {
    const chrome = byName.get('chrome-devtools');
    expect(chrome).toBeDefined();
    expect(chrome?.enabled).toBe(true);
  });
});
