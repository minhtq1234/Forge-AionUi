/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

// Shared descriptors + pure helpers for the built-in "commodity" capability
// MCP servers. Imported by both the main-process seeding migration and the
// renderer settings UI, so keep this side-effect free (type-only storage import).
import type { IMcpServer, IMcpServerTransportStdio } from './storage';

export type BuiltinCapabilityTier = 'tier1' | 'tier2';
export type BuiltinCapabilityCredentialKind = 'apiKey' | 'connectionString';

export type BuiltinCapabilityCredential = {
  kind: BuiltinCapabilityCredentialKind;
  /** Environment variable name (apiKey kind only). */
  envVar?: string;
  /** i18n key for the input placeholder. */
  placeholderKey: string;
};

export type BuiltinCapabilityDescriptor = {
  /** Stable IMcpServer id. */
  id: string;
  /** Stable IMcpServer name (backend dedupes by name). */
  name: string;
  /** npm package (for reference/docs). */
  npmPackage: string;
  command: string;
  /** Base args, before any credential is appended. */
  baseArgs: string[];
  tier: BuiltinCapabilityTier;
  defaultEnabled: boolean;
  /** English description stored on the server record (no i18n in main process). */
  seedDescription: string;
  /** i18n key for the settings label. */
  labelKey: string;
  /** i18n key for the settings description. */
  descriptionKey: string;
  credential?: BuiltinCapabilityCredential;
};

export const BUILTIN_MEMORY_ID = 'builtin-memory';
export const BUILTIN_MEMORY_NAME = 'aionui-memory';
export const BUILTIN_TAVILY_ID = 'builtin-tavily';
export const BUILTIN_TAVILY_NAME = 'aionui-web-search';
export const BUILTIN_GITHUB_ID = 'builtin-github';
export const BUILTIN_GITHUB_NAME = 'aionui-github';
export const BUILTIN_POSTGRES_ID = 'builtin-postgres';
export const BUILTIN_POSTGRES_NAME = 'aionui-postgres';

export const BUILTIN_CAPABILITIES: BuiltinCapabilityDescriptor[] = [
  {
    id: BUILTIN_MEMORY_ID,
    name: BUILTIN_MEMORY_NAME,
    npmPackage: '@modelcontextprotocol/server-memory',
    command: 'npx',
    baseArgs: ['-y', '@modelcontextprotocol/server-memory'],
    tier: 'tier1',
    defaultEnabled: true,
    seedDescription: 'Built-in long-term memory (knowledge graph) shared across chats.',
    labelKey: 'settings.capabilityMemory',
    descriptionKey: 'settings.capabilityMemoryDesc',
  },
  {
    id: BUILTIN_TAVILY_ID,
    name: BUILTIN_TAVILY_NAME,
    npmPackage: 'tavily-mcp',
    command: 'npx',
    baseArgs: ['-y', 'tavily-mcp@latest'],
    tier: 'tier2',
    defaultEnabled: false,
    seedDescription: 'Web search powered by Tavily. Requires a Tavily API key.',
    labelKey: 'settings.capabilityWebSearch',
    descriptionKey: 'settings.capabilityWebSearchDesc',
    credential: { kind: 'apiKey', envVar: 'TAVILY_API_KEY', placeholderKey: 'settings.capabilityWebSearchPlaceholder' },
  },
  {
    id: BUILTIN_GITHUB_ID,
    name: BUILTIN_GITHUB_NAME,
    npmPackage: '@modelcontextprotocol/server-github',
    command: 'npx',
    baseArgs: ['-y', '@modelcontextprotocol/server-github'],
    tier: 'tier2',
    defaultEnabled: false,
    seedDescription: 'GitHub repositories, issues and pull requests. Requires a personal access token.',
    labelKey: 'settings.capabilityGithub',
    descriptionKey: 'settings.capabilityGithubDesc',
    credential: {
      kind: 'apiKey',
      envVar: 'GITHUB_PERSONAL_ACCESS_TOKEN',
      placeholderKey: 'settings.capabilityGithubPlaceholder',
    },
  },
  {
    id: BUILTIN_POSTGRES_ID,
    name: BUILTIN_POSTGRES_NAME,
    npmPackage: '@modelcontextprotocol/server-postgres',
    command: 'npx',
    baseArgs: ['-y', '@modelcontextprotocol/server-postgres'],
    tier: 'tier2',
    defaultEnabled: false,
    seedDescription: 'Read-only Postgres access. Requires a connection string.',
    labelKey: 'settings.capabilityPostgres',
    descriptionKey: 'settings.capabilityPostgresDesc',
    credential: { kind: 'connectionString', placeholderKey: 'settings.capabilityPostgresPlaceholder' },
  },
];

export const TIER2_CAPABILITIES: BuiltinCapabilityDescriptor[] = BUILTIN_CAPABILITIES.filter((c) => c.tier === 'tier2');

export const findCapabilityDescriptor = (nameOrId: string): BuiltinCapabilityDescriptor | undefined =>
  BUILTIN_CAPABILITIES.find((c) => c.name === nameOrId || c.id === nameOrId);

const buildOriginalJson = (name: string, command: string, args: string[], env: Record<string, string>): string =>
  JSON.stringify(
    {
      mcpServers: {
        [name]: { command, args, ...(Object.keys(env).length > 0 ? { env } : {}) },
      },
    },
    null,
    2
  );

export type BuiltinCapabilityServerSeed = Pick<
  IMcpServer,
  'name' | 'description' | 'enabled' | 'builtin' | 'transport' | 'original_json'
>;

export const buildBuiltinCapabilityServer = (descriptor: BuiltinCapabilityDescriptor): BuiltinCapabilityServerSeed => {
  const transport: IMcpServerTransportStdio = {
    type: 'stdio',
    command: descriptor.command,
    args: [...descriptor.baseArgs],
    env: {},
  };
  return {
    name: descriptor.name,
    description: descriptor.seedDescription,
    enabled: descriptor.defaultEnabled,
    builtin: true,
    transport,
    original_json: buildOriginalJson(descriptor.name, transport.command, transport.args ?? [], {}),
  };
};

/** Apply a credential value to a stdio transport, returning a new transport. */
export const applyCapabilityCredential = (
  descriptor: BuiltinCapabilityDescriptor,
  transport: IMcpServerTransportStdio,
  value: string
): IMcpServerTransportStdio => {
  const trimmed = value.trim();
  if (descriptor.credential?.kind === 'apiKey' && descriptor.credential.envVar) {
    const env = { ...transport.env };
    if (trimmed) {
      env[descriptor.credential.envVar] = trimmed;
    } else {
      delete env[descriptor.credential.envVar];
    }
    return { ...transport, command: descriptor.command, args: [...descriptor.baseArgs], env };
  }
  // connectionString → trailing positional arg
  const args = trimmed ? [...descriptor.baseArgs, trimmed] : [...descriptor.baseArgs];
  return { ...transport, command: descriptor.command, args, env: transport.env ?? {} };
};

export const getCapabilityCredentialValue = (
  descriptor: BuiltinCapabilityDescriptor,
  transport: IMcpServerTransportStdio
): string => {
  if (descriptor.credential?.kind === 'apiKey' && descriptor.credential.envVar) {
    return transport.env?.[descriptor.credential.envVar] ?? '';
  }
  const extra = (transport.args ?? []).slice(descriptor.baseArgs.length);
  return extra[0] ?? '';
};

export const hasCapabilityCredential = (
  descriptor: BuiltinCapabilityDescriptor,
  transport: IMcpServerTransportStdio
): boolean => getCapabilityCredentialValue(descriptor, transport).trim().length > 0;

/** True when `server` is the builtin server for a Tier-2 capability (used to hide it from the raw MCP list). */
export const isTier2CapabilityServer = (server: Pick<IMcpServer, 'id' | 'name' | 'builtin'>): boolean =>
  server.builtin === true && TIER2_CAPABILITIES.some((c) => server.id === c.id || server.name === c.name);

export const buildCapabilityOriginalJson = (name: string, transport: IMcpServerTransportStdio): string =>
  buildOriginalJson(name, transport.command, transport.args ?? [], transport.env ?? {});

export const BUILTIN_CHROME_DEVTOOLS_NAME = 'chrome-devtools';

/** Built-in server names shipped as commodity defaults (Tier-1 web browse + all capability servers). */
export const COMMODITY_BUILTIN_SERVER_NAMES: readonly string[] = [
  BUILTIN_CHROME_DEVTOOLS_NAME,
  ...BUILTIN_CAPABILITIES.map((c) => c.name),
];

/** True when `server` is one of our commodity built-in servers (excludes image-gen and user servers). */
export const isCommodityBuiltinServer = (server: Pick<IMcpServer, 'name' | 'builtin'>): boolean =>
  server.builtin === true && COMMODITY_BUILTIN_SERVER_NAMES.includes(server.name);

/**
 * Union the assistant's default MCP server ids with the ids of any *enabled*
 * commodity built-in servers, so our on-by-default capabilities attach to new
 * conversations even when the assistant has no saved selection. De-duped,
 * assistant defaults kept first. Intended for the default (no explicit user
 * selection) path only.
 */
export const mergeCommodityMcpServerIds = (
  assistantDefaultIds: string[],
  availableServers: Array<Pick<IMcpServer, 'id' | 'name' | 'builtin' | 'enabled'>>
): string[] => {
  const ids = [...assistantDefaultIds];
  const seen = new Set(ids);
  for (const server of availableServers) {
    if (server.enabled === true && isCommodityBuiltinServer(server) && !seen.has(server.id)) {
      seen.add(server.id);
      ids.push(server.id);
    }
  }
  return ids;
};
