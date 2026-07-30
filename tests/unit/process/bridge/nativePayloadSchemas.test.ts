/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 *
 * @vitest-environment node
 */

import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import ts from 'typescript';
import { describe, expect, it } from 'vitest';
import { NATIVE_BRIDGE_PROVIDER_KEYS, type NativeBridgeProviderKey } from '@/common/adapter/native/constants';
import {
  INVALID_NATIVE_BRIDGE_PAYLOAD_MESSAGE,
  nativeBridgePayloadSchemas,
  parseNativeBridgePayload,
} from '@/common/adapter/native/payloadSchemas';

const VALID_PAYLOADS = {
  'restart-app': undefined,
  'open-dev-tools': undefined,
  'is-dev-tools-opened': undefined,
  'app.get-path': { name: 'downloads' },
  'update-system-info': { cacheDir: '/tmp/cache', workDir: '/tmp/work', logDir: '/tmp/log' },
  'app.get-zoom-factor': undefined,
  'app.set-zoom-factor': { factor: 0.95 },
  'app.get-cdp-status': undefined,
  'app.update-cdp-config': { enabled: true, port: 9230 },
  'app.get-start-on-boot-status': undefined,
  'app.set-start-on-boot': { enabled: true },
  'app.get-gpu-status': undefined,
  'app.set-gpu-override': { override: 'force-on' },
  'app.write-renderer-log': { level: 'info', tag: 'settings', message: 'saved', data: { count: 1 } },
  'update.check': { includePrerelease: false, repo: 'iOfficeAI/AionUi' },
  'update.installer-last-failure.consume': undefined,
  'update.download': {
    downloadId: 'download-1',
    url: 'https://github.com/iOfficeAI/AionUi/releases/download/v1/app.dmg',
    fallbackUrl: 'https://cdn.example.com/app.dmg',
    file_name: 'app.dmg',
  },
  'update.download.cancel': { downloadId: 'download-1' },
  'auto-update.check': { includePrerelease: false },
  'auto-update.restore-downloaded': undefined,
  'auto-update.download': undefined,
  'auto-update.download.cancel': undefined,
  'auto-update.quit-and-install': undefined,
  'show-open': {
    defaultPath: '/tmp',
    properties: ['openDirectory', 'createDirectory'],
    filters: [{ name: 'Documents', extensions: ['pdf', 'docx'] }],
  },
  'app-operations.context-compact': {
    operation_id: 'operation-1',
    conversation_id: 'conversation-1',
    trigger: 'manual',
    previous_snapshot: {
      goal: 'Ship the security update.',
      current_state: ['IPC schemas are implemented.'],
      decisions: [],
      artifacts: [],
      user_preferences: [],
      open_questions: [],
      next_steps: ['Run verification.'],
      do_not_forget: [],
    },
    pinned_context: [
      {
        id: 'pin-1',
        title: 'Security scope',
        content: 'Keep the native IPC bridge fail closed.',
        source: 'manual',
        created_at: 1,
        updated_at: 1,
      },
    ],
    target_turn_id: 'turn-1',
  },
  'project-knowledge.list-sources': { projectId: 'project-1' },
  'project-knowledge.add-sources': {
    projectId: 'project-1',
    filePaths: ['/tmp/work/notes.md', '/tmp/work/spec.docx'],
  },
  'project-knowledge.remove-source': { projectId: 'project-1', sourceId: 'a1b2c3d4e5f6' },
  'project-knowledge.retry-source': { projectId: 'project-1', sourceId: 'a1b2c3d4e5f6' },
  'project-knowledge.remove-store': { projectId: 'project-1' },
  'project-knowledge.get-session-mcp-server': { projectId: 'project-1' },
  'creative-studio.list-projects': undefined,
  'creative-studio.create-project': {
    name: 'Launch film',
    brief: 'A short launch story',
    aspectRatio: '16:9',
    targetDurationSeconds: 12,
    resolution: '1080p',
  },
  'creative-studio.get-project': { projectId: 'project_1' },
  'creative-studio.propose-storyboard': { projectId: 'project_1', expectedRevision: 1, replaceExisting: false },
  'creative-studio.update-project': { projectId: 'project_1', expectedRevision: 1, name: 'Changed launch film' },
  'creative-studio.delete-project': { projectId: 'project_1', expectedRevision: 1 },
  'creative-studio.update-scene': {
    projectId: 'project_1',
    expectedRevision: 1,
    sceneId: 'scene_1',
    scene: {
      id: 'scene_1',
      title: 'Opening',
      purpose: 'Introduce the product',
      visualPrompt: 'A cinematic product reveal',
      narration: 'Meet the future.',
      onScreenText: 'Meet the future',
      mediaKind: 'video',
      durationSeconds: 4,
      referenceAssetId: null,
      selectedAssetId: null,
      assetIds: [],
      jobIds: [],
      reviewState: 'draft',
    },
  },
  'creative-studio.reorder-scenes': { projectId: 'project_1', expectedRevision: 1, sceneOrder: ['scene_1'] },
  'creative-studio.select-asset': {
    projectId: 'project_1',
    expectedRevision: 1,
    sceneId: 'scene_1',
    assetId: 'asset_1',
  },
  'creative-studio.choose-and-import-reference': {
    projectId: 'project_1',
    sceneId: 'scene_1',
    expectedRevision: 1,
  },
  'creative-studio.choose-and-export-assets': { projectId: 'project_1', includeReferences: true },
  'creative-studio.list-connection-candidates': undefined,
  'creative-studio.list-connections': undefined,
  'creative-studio.validate-connection': {
    providerId: 'provider_1',
    adapterId: 'weprompt-media-gateway-v1',
    model: 'open-sora',
  },
  'creative-studio.save-connection': {
    providerId: 'provider_1',
    adapterId: 'weprompt-media-gateway-v1',
    model: 'open-sora',
  },
  'creative-studio.remove-connection': { connectionId: 'binding_1' },
  'creative-studio.list-routes': { projectId: 'project_1' },
  'app-operations.cancel': { operation_id: 'operation-1' },
  'office-artifact.get-state': {
    conversationId: 'conversation-1',
    workspace: '/tmp/work',
    filePath: '/tmp/work/report.docx',
  },
  'office-artifact.prepare-preview': {
    conversationId: 'conversation-1',
    workspace: '/tmp/work',
    filePath: '/tmp/work/report.docx',
  },
  'office-artifact.start-preview': { leaseId: 'lease-1', url: 'http://127.0.0.1:3000/preview' },
  'office-artifact.release-preview': { leaseId: 'lease-1' },
  'office-artifact.inspect': {
    conversationId: 'conversation-1',
    workspace: '/tmp/work',
    filePath: '/tmp/work/report.docx',
    expectedVersion: 'version-1',
    selection: {
      kind: 'word',
      path: '/document/body/p[1]',
      paragraphText: 'Quarterly report',
      selectedText: 'Quarterly',
      start: 0,
      end: 9,
    },
  },
  'office-artifact.apply': {
    conversationId: 'conversation-1',
    workspace: '/tmp/work',
    filePath: '/tmp/work/report.xlsx',
    expectedVersion: 'version-1',
    selection: {
      kind: 'excel',
      paths: ['Sheet1!A1'],
      cells: [{ path: 'Sheet1!A1', displayText: '100' }],
    },
    edit: { kind: 'setCell', input: '200' },
  },
  'office-artifact.undo': {
    conversationId: 'conversation-1',
    workspace: '/tmp/work',
    filePath: '/tmp/work/report.docx',
    expectedVersion: 'version-1',
  },
  'window-controls:minimize': undefined,
  'window-controls:maximize': undefined,
  'window-controls:unmaximize': undefined,
  'window-controls:close': undefined,
  'window-controls:is-maximized': undefined,
  'theme:set-active': {
    id: 'forge-light',
    name: 'Forge Light',
    appearance: 'light',
    tokens: { '--color-bg-1': '#ffffff' },
    css: ':root { color-scheme: light; }',
    builtin: true,
    created_at: 1,
    updated_at: 1,
  },
  'theme:request-current': undefined,
  'system-settings:get-close-to-tray': undefined,
  'system-settings:set-close-to-tray': { enabled: true },
  'system-settings:get-pet-enabled': undefined,
  'system-settings:set-pet-enabled': { enabled: true },
  'system-settings:get-pet-size': undefined,
  'system-settings:set-pet-size': { size: 280 },
  'system-settings:get-pet-dnd': undefined,
  'system-settings:set-pet-dnd': { dnd: true },
  'system-settings:get-pet-confirm-enabled': undefined,
  'system-settings:set-pet-confirm-enabled': { enabled: true },
  'notification.show': {
    title: 'Task complete',
    body: 'The scheduled task finished.',
    conversation_id: 'conversation-1',
  },
  'webui.get-status': undefined,
  'webui.start': { port: 25808, allowRemote: false },
  'webui.stop': undefined,
} satisfies Record<NativeBridgeProviderKey, unknown>;

const VOID_PROVIDER_KEYS = [
  'restart-app',
  'open-dev-tools',
  'is-dev-tools-opened',
  'app.get-zoom-factor',
  'app.get-cdp-status',
  'app.get-start-on-boot-status',
  'app.get-gpu-status',
  'update.installer-last-failure.consume',
  'auto-update.restore-downloaded',
  'auto-update.download',
  'auto-update.download.cancel',
  'auto-update.quit-and-install',
  'window-controls:minimize',
  'window-controls:maximize',
  'window-controls:unmaximize',
  'window-controls:close',
  'window-controls:is-maximized',
  'theme:request-current',
  'system-settings:get-close-to-tray',
  'system-settings:get-pet-enabled',
  'system-settings:get-pet-size',
  'system-settings:get-pet-dnd',
  'system-settings:get-pet-confirm-enabled',
  'creative-studio.list-connection-candidates',
  'creative-studio.list-connections',
  'webui.get-status',
  'webui.stop',
] as const satisfies ReadonlyArray<NativeBridgeProviderKey>;

type InvalidPayloadCase = readonly [NativeBridgeProviderKey, string, unknown];

const IPC_BRIDGE_PATH = resolve(process.cwd(), 'packages/desktop/src/common/adapter/ipcBridge.ts');

function collectBridgeBuildProviderKeys(source: string): string[] {
  const sourceFile = ts.createSourceFile(IPC_BRIDGE_PATH, source, ts.ScriptTarget.Latest, true);
  const providerKeys: string[] = [];

  const visit = (node: ts.Node): void => {
    if (
      ts.isCallExpression(node) &&
      ts.isPropertyAccessExpression(node.expression) &&
      ts.isIdentifier(node.expression.expression) &&
      node.expression.expression.text === 'bridge' &&
      node.expression.name.text === 'buildProvider'
    ) {
      const [providerKey] = node.arguments;
      if (providerKey === undefined || !ts.isStringLiteral(providerKey)) {
        throw new Error('bridge.buildProvider provider key must be a string literal');
      }
      providerKeys.push(providerKey.text);
    }

    ts.forEachChild(node, visit);
  };

  visit(sourceFile);
  return providerKeys;
}

const INVALID_PAYLOADS = [
  ['app.get-path', 'omitted required name', {}],
  ['app.get-path', 'non-string name', { name: 1 }],
  ['app.get-path', 'unsupported path name', { name: 'documents' }],
  ['update-system-info', 'omitted required cache directory', { workDir: '/tmp/work' }],
  ['update-system-info', 'omitted required work directory', { cacheDir: '/tmp/cache' }],
  ['update-system-info', 'non-string cache directory', { cacheDir: 1, workDir: '/tmp/work' }],
  ['update-system-info', 'non-string work directory', { cacheDir: '/tmp/cache', workDir: 1 }],
  ['update-system-info', 'empty cache directory', { cacheDir: '', workDir: '/tmp/work' }],
  ['update-system-info', 'overlong work directory', { cacheDir: '/tmp/cache', workDir: 'x'.repeat(4097) }],
  [
    'update-system-info',
    'invalid optional log directory substitute',
    { cacheDir: '/tmp/cache', workDir: '/tmp/work', logDir: 1 },
  ],
  ['app.set-zoom-factor', 'omitted required factor', {}],
  ['app.set-zoom-factor', 'non-numeric factor', { factor: '1' }],
  ['app.set-zoom-factor', 'non-finite factor', { factor: Number.NaN }],
  ['app.set-zoom-factor', 'factor below the allowed range', { factor: 0.79 }],
  ['app.set-zoom-factor', 'factor above the allowed range', { factor: 1.31 }],
  ['app.update-cdp-config', 'invalid optional enabled substitute', { enabled: 'true' }],
  ['app.update-cdp-config', 'invalid optional port substitute', { port: '9222' }],
  ['app.update-cdp-config', 'non-integer port', { port: 9222.5 }],
  ['app.update-cdp-config', 'port above the allowed range', { port: 65536 }],
  ['app.set-start-on-boot', 'omitted required enabled value', {}],
  ['app.set-start-on-boot', 'non-boolean enabled value', { enabled: 'true' }],
  ['app.set-gpu-override', 'omitted required override', {}],
  ['app.set-gpu-override', 'non-string override', { override: true }],
  ['app.set-gpu-override', 'unsupported override', { override: 'automatic' }],
  ['app.write-renderer-log', 'omitted required level', { tag: 'settings', message: 'saved' }],
  ['app.write-renderer-log', 'omitted required tag', { level: 'info', message: 'saved' }],
  ['app.write-renderer-log', 'omitted required message', { level: 'info', tag: 'settings' }],
  ['app.write-renderer-log', 'non-string level', { level: true, tag: 'settings', message: 'saved' }],
  ['app.write-renderer-log', 'unsupported level', { level: 'notice', tag: 'settings', message: 'saved' }],
  ['app.write-renderer-log', 'non-string tag', { level: 'info', tag: true, message: 'saved' }],
  ['app.write-renderer-log', 'empty tag', { level: 'info', tag: '', message: 'saved' }],
  ['app.write-renderer-log', 'overlong tag', { level: 'info', tag: 'x'.repeat(129), message: 'saved' }],
  ['app.write-renderer-log', 'non-string message', { level: 'info', tag: 'settings', message: true }],
  ['app.write-renderer-log', 'overlong message', { level: 'info', tag: 'settings', message: 'x'.repeat(65537) }],
  ['update.check', 'invalid optional prerelease substitute', { includePrerelease: 'false' }],
  ['update.check', 'invalid optional repository substitute', { repo: 1 }],
  ['update.check', 'malformed repository name', { repo: 'iOfficeAI' }],
  ['update.check', 'repository name with invalid characters', { repo: 'iOfficeAI/Aion Ui' }],
  ['update.check', 'overlong repository name', { repo: `owner/${'x'.repeat(196)}` }],
  ['update.download', 'omitted required URL', {}],
  ['update.download', 'non-string URL', { url: true }],
  ['update.download', 'malformed URL', { url: 'not-a-url' }],
  ['update.download', 'overlong URL', { url: `https://example.com/${'x'.repeat(2029)}` }],
  [
    'update.download',
    'empty optional download identifier',
    { url: VALID_PAYLOADS['update.download'].url, downloadId: '' },
  ],
  [
    'update.download',
    'invalid optional fallback URL',
    { url: VALID_PAYLOADS['update.download'].url, fallbackUrl: true },
  ],
  [
    'update.download',
    'malformed optional fallback URL',
    { url: VALID_PAYLOADS['update.download'].url, fallbackUrl: 'not-a-url' },
  ],
  ['update.download', 'invalid optional file name', { url: VALID_PAYLOADS['update.download'].url, file_name: false }],
  ['update.download', 'empty optional file name', { url: VALID_PAYLOADS['update.download'].url, file_name: '' }],
  [
    'update.download',
    'overlong optional file name',
    { url: VALID_PAYLOADS['update.download'].url, file_name: 'x'.repeat(256) },
  ],
  ['update.download.cancel', 'omitted required download identifier', {}],
  ['update.download.cancel', 'non-string download identifier', { downloadId: true }],
  ['update.download.cancel', 'empty download identifier', { downloadId: '' }],
  ['update.download.cancel', 'overlong download identifier', { downloadId: 'x'.repeat(257) }],
  ['auto-update.check', 'invalid optional prerelease substitute', { includePrerelease: 1 }],
  ['show-open', 'non-object supplied dialog payload', null],
  ['show-open', 'invalid optional default path substitute', { defaultPath: 1 }],
  ['show-open', 'empty optional default path', { defaultPath: '' }],
  ['show-open', 'invalid optional properties substitute', { properties: 'openDirectory' }],
  ['show-open', 'unsupported dialog property', { properties: ['openRecent'] }],
  ['show-open', 'too many dialog properties', { properties: Array.from({ length: 10 }, () => 'openFile') }],
  ['show-open', 'invalid optional filters substitute', { filters: {} }],
  ['show-open', 'filter without a required name', { filters: [{ extensions: ['pdf'] }] }],
  ['show-open', 'filter without required extensions', { filters: [{ name: 'Documents' }] }],
  ['show-open', 'non-string nested filter name', { filters: [{ name: true, extensions: ['pdf'] }] }],
  ['show-open', 'overlong nested filter name', { filters: [{ name: 'x'.repeat(257), extensions: ['pdf'] }] }],
  ['show-open', 'empty nested extension', { filters: [{ name: 'Documents', extensions: [''] }] }],
  ['show-open', 'overlong nested extension', { filters: [{ name: 'Documents', extensions: ['x'.repeat(33)] }] }],
  [
    'show-open',
    'too many nested extensions',
    { filters: [{ name: 'Documents', extensions: Array.from({ length: 65 }, () => 'pdf') }] },
  ],
  [
    'show-open',
    'too many dialog filters',
    { filters: Array.from({ length: 33 }, () => ({ name: 'Documents', extensions: ['pdf'] })) },
  ],
  ['show-open', 'unknown nested filter field', { filters: [{ name: 'Documents', extensions: ['pdf'], extra: true }] }],
  ['app-operations.context-compact', 'omitted operation identifier', { conversation_id: 'conversation-1' }],
  ['app-operations.context-compact', 'omitted conversation identifier', { operation_id: 'operation-1' }],
  [
    'app-operations.context-compact',
    'renderer-supplied model selection',
    {
      operation_id: 'operation-1',
      conversation_id: 'conversation-1',
      trigger: 'manual',
      provider_id: 'provider-1',
      model: 'model-1',
    },
  ],
  [
    'app-operations.context-compact',
    'too many pinned context items',
    {
      operation_id: 'operation-1',
      conversation_id: 'conversation-1',
      trigger: 'manual',
      pinned_context: Array.from({ length: 21 }, (_, index) => ({
        id: `pin-${index}`,
        title: 'Pin',
        content: 'Content',
        source: 'manual',
        created_at: 1,
        updated_at: 1,
      })),
    },
  ],
  ['project-knowledge.list-sources', 'omitted required project identifier', {}],
  ['project-knowledge.add-sources', 'omitted required file paths', { projectId: 'project-1' }],
  ['project-knowledge.add-sources', 'non-array file paths', { projectId: 'project-1', filePaths: 'not-an-array' }],
  [
    'project-knowledge.add-sources',
    'too many file paths',
    { projectId: 'project-1', filePaths: Array.from({ length: 101 }, (_, index) => `/tmp/work/file-${index}.md`) },
  ],
  ['project-knowledge.remove-source', 'omitted required source identifier', { projectId: 'project-1' }],
  ['project-knowledge.retry-source', 'non-string source identifier', { projectId: 'project-1', sourceId: 1 }],
  ['project-knowledge.remove-store', 'empty project identifier', { projectId: '' }],
  ['project-knowledge.get-session-mcp-server', 'omitted required project identifier', {}],
  [
    'creative-studio.create-project',
    'renderer supplied internal project id',
    { ...VALID_PAYLOADS['creative-studio.create-project'], id: 'project_1' },
  ],
  [
    'creative-studio.create-project',
    'overlong project name',
    { ...VALID_PAYLOADS['creative-studio.create-project'], name: 'x'.repeat(257) },
  ],
  [
    'creative-studio.create-project',
    'overlong brief',
    { ...VALID_PAYLOADS['creative-studio.create-project'], brief: 'x'.repeat(16 * 1024 + 1) },
  ],
  [
    'creative-studio.create-project',
    'fractional project target',
    { ...VALID_PAYLOADS['creative-studio.create-project'], targetDurationSeconds: 12.5 },
  ],
  [
    'creative-studio.create-project',
    'non-finite project target',
    { ...VALID_PAYLOADS['creative-studio.create-project'], targetDurationSeconds: Number.POSITIVE_INFINITY },
  ],
  ['creative-studio.get-project', 'project id traversal', { projectId: '../project_1' }],
  ['creative-studio.choose-and-import-reference', 'missing expected revision', { projectId: 'project_1' }],
  [
    'creative-studio.choose-and-import-reference',
    'attempted source path',
    { projectId: 'project_1', expectedRevision: 1, sourcePath: '/tmp/reference.png' },
  ],
  [
    'creative-studio.choose-and-import-reference',
    'scene traversal',
    { projectId: 'project_1', sceneId: '../scene_1', expectedRevision: 1 },
  ],
  [
    'creative-studio.choose-and-export-assets',
    'wrong include references boolean',
    { projectId: 'project_1', includeReferences: 'yes' },
  ],
  [
    'creative-studio.validate-connection',
    'provider id traversal',
    { providerId: '../provider', adapterId: 'weprompt-image-v1', model: 'image' },
  ],
  [
    'creative-studio.validate-connection',
    'renderer supplied provider URL',
    { providerId: 'provider_1', adapterId: 'weprompt-image-v1', model: 'image', baseUrl: 'https://secret.invalid' },
  ],
  [
    'creative-studio.save-connection',
    'renderer supplied credential',
    { providerId: 'provider_1', adapterId: 'weprompt-image-v1', model: 'image', apiKey: 'secret' },
  ],
  ['creative-studio.remove-connection', 'connection traversal', { connectionId: '../binding_1' }],
  ['creative-studio.list-routes', 'project traversal', { projectId: '../project_1' }],
  [
    'creative-studio.propose-storyboard',
    'project id traversal',
    { projectId: '../project_1', expectedRevision: 1, replaceExisting: false },
  ],
  [
    'creative-studio.propose-storyboard',
    'zero expected revision',
    { projectId: 'project_1', expectedRevision: 0, replaceExisting: false },
  ],
  [
    'creative-studio.propose-storyboard',
    'fractional expected revision',
    { projectId: 'project_1', expectedRevision: 1.5, replaceExisting: false },
  ],
  [
    'creative-studio.propose-storyboard',
    'infinite expected revision',
    { projectId: 'project_1', expectedRevision: Number.POSITIVE_INFINITY, replaceExisting: false },
  ],
  ['creative-studio.propose-storyboard', 'missing replace option', { projectId: 'project_1', expectedRevision: 1 }],
  [
    'creative-studio.propose-storyboard',
    'renderer supplied provider choice',
    { projectId: 'project_1', expectedRevision: 1, replaceExisting: false, providerId: 'provider_1' },
  ],
  [
    'creative-studio.propose-storyboard',
    'renderer supplied model choice',
    { projectId: 'project_1', expectedRevision: 1, replaceExisting: false, model: 'model_1' },
  ],
  [
    'creative-studio.propose-storyboard',
    'renderer supplied prompt',
    { projectId: 'project_1', expectedRevision: 1, replaceExisting: false, prompt: 'override' },
  ],
  [
    'creative-studio.update-project',
    'missing expected revision',
    { projectId: 'project_1', name: 'Changed launch film' },
  ],
  [
    'creative-studio.update-project',
    'non-positive expected revision',
    { projectId: 'project_1', expectedRevision: 0, name: 'Changed launch film' },
  ],
  ['creative-studio.delete-project', 'missing expected revision', { projectId: 'project_1' }],
  ['creative-studio.delete-project', 'traversal project id', { projectId: '../../project_1', expectedRevision: 1 }],
  [
    'creative-studio.update-scene',
    'overlong visual prompt',
    {
      ...VALID_PAYLOADS['creative-studio.update-scene'],
      scene: { ...VALID_PAYLOADS['creative-studio.update-scene'].scene, visualPrompt: 'x'.repeat(8 * 1024 + 1) },
    },
  ],
  [
    'creative-studio.update-scene',
    'overlong narration',
    {
      ...VALID_PAYLOADS['creative-studio.update-scene'],
      scene: { ...VALID_PAYLOADS['creative-studio.update-scene'].scene, narration: 'x'.repeat(4 * 1024 + 1) },
    },
  ],
  [
    'creative-studio.update-scene',
    'overlong on-screen text',
    {
      ...VALID_PAYLOADS['creative-studio.update-scene'],
      scene: { ...VALID_PAYLOADS['creative-studio.update-scene'].scene, onScreenText: 'x'.repeat(1024 + 1) },
    },
  ],
  [
    'creative-studio.update-scene',
    'fractional scene duration',
    {
      ...VALID_PAYLOADS['creative-studio.update-scene'],
      scene: { ...VALID_PAYLOADS['creative-studio.update-scene'].scene, durationSeconds: 1.5 },
    },
  ],
  [
    'creative-studio.update-scene',
    'scene id traversal',
    { ...VALID_PAYLOADS['creative-studio.update-scene'], sceneId: '../scene_1' },
  ],
  [
    'creative-studio.reorder-scenes',
    'duplicate scene ids',
    { projectId: 'project_1', expectedRevision: 1, sceneOrder: ['scene_1', 'scene_1'] },
  ],
  [
    'creative-studio.reorder-scenes',
    'empty scene ids',
    { projectId: 'project_1', expectedRevision: 1, sceneOrder: [] },
  ],
  [
    'creative-studio.reorder-scenes',
    'too many scene ids',
    {
      projectId: 'project_1',
      expectedRevision: 1,
      sceneOrder: Array.from({ length: 25 }, (_, index) => `scene_${index}`),
    },
  ],
  [
    'creative-studio.select-asset',
    'missing expected revision',
    { projectId: 'project_1', sceneId: 'scene_1', assetId: 'asset_1' },
  ],
  [
    'creative-studio.select-asset',
    'asset id traversal',
    { projectId: 'project_1', expectedRevision: 1, sceneId: 'scene_1', assetId: '../../asset_1' },
  ],
  ['app-operations.cancel', 'omitted operation identifier', {}],
  ['office-artifact.get-state', 'omitted workspace', { filePath: '/tmp/work/report.docx' }],
  ['office-artifact.prepare-preview', 'omitted file path', { workspace: '/tmp/work' }],
  ['office-artifact.start-preview', 'omitted lease identifier', {}],
  ['office-artifact.release-preview', 'non-string lease identifier', { leaseId: 1 }],
  [
    'office-artifact.inspect',
    'unsupported selection kind',
    {
      ...VALID_PAYLOADS['office-artifact.inspect'],
      selection: { kind: 'slides', path: '/slide/1' },
    },
  ],
  ['office-artifact.apply', 'omitted edit', { ...VALID_PAYLOADS['office-artifact.apply'], edit: undefined }],
  [
    'office-artifact.undo',
    'omitted expected version',
    { ...VALID_PAYLOADS['office-artifact.undo'], expectedVersion: undefined },
  ],
  ['theme:set-active', 'omitted required theme identifier', { ...VALID_PAYLOADS['theme:set-active'], id: undefined }],
  ['theme:set-active', 'omitted required theme name', { ...VALID_PAYLOADS['theme:set-active'], name: undefined }],
  ['theme:set-active', 'omitted required appearance', { ...VALID_PAYLOADS['theme:set-active'], appearance: undefined }],
  ['theme:set-active', 'omitted required builtin flag', { ...VALID_PAYLOADS['theme:set-active'], builtin: undefined }],
  [
    'theme:set-active',
    'omitted required creation timestamp',
    { ...VALID_PAYLOADS['theme:set-active'], created_at: undefined },
  ],
  [
    'theme:set-active',
    'omitted required update timestamp',
    { ...VALID_PAYLOADS['theme:set-active'], updated_at: undefined },
  ],
  ['theme:set-active', 'non-string theme identifier', { ...VALID_PAYLOADS['theme:set-active'], id: true }],
  ['theme:set-active', 'empty theme identifier', { ...VALID_PAYLOADS['theme:set-active'], id: '' }],
  ['theme:set-active', 'overlong theme identifier', { ...VALID_PAYLOADS['theme:set-active'], id: 'x'.repeat(257) }],
  ['theme:set-active', 'non-string theme name', { ...VALID_PAYLOADS['theme:set-active'], name: true }],
  ['theme:set-active', 'empty theme name', { ...VALID_PAYLOADS['theme:set-active'], name: '' }],
  ['theme:set-active', 'overlong theme name', { ...VALID_PAYLOADS['theme:set-active'], name: 'x'.repeat(257) }],
  ['theme:set-active', 'non-string appearance', { ...VALID_PAYLOADS['theme:set-active'], appearance: true }],
  ['theme:set-active', 'invalid appearance enum', { ...VALID_PAYLOADS['theme:set-active'], appearance: 'sepia' }],
  ['theme:set-active', 'non-boolean builtin flag', { ...VALID_PAYLOADS['theme:set-active'], builtin: 'true' }],
  ['theme:set-active', 'non-numeric creation timestamp', { ...VALID_PAYLOADS['theme:set-active'], created_at: '1' }],
  [
    'theme:set-active',
    'non-finite creation timestamp',
    { ...VALID_PAYLOADS['theme:set-active'], created_at: Number.POSITIVE_INFINITY },
  ],
  ['theme:set-active', 'fractional creation timestamp', { ...VALID_PAYLOADS['theme:set-active'], created_at: 1.5 }],
  ['theme:set-active', 'negative creation timestamp', { ...VALID_PAYLOADS['theme:set-active'], created_at: -1 }],
  ['theme:set-active', 'non-numeric update timestamp', { ...VALID_PAYLOADS['theme:set-active'], updated_at: '1' }],
  ['theme:set-active', 'invalid optional cover substitute', { ...VALID_PAYLOADS['theme:set-active'], cover: true }],
  ['theme:set-active', 'invalid optional tokens substitute', { ...VALID_PAYLOADS['theme:set-active'], tokens: true }],
  ['theme:set-active', 'empty theme token key', { ...VALID_PAYLOADS['theme:set-active'], tokens: { '': '#fff' } }],
  [
    'theme:set-active',
    'overlong theme token key',
    { ...VALID_PAYLOADS['theme:set-active'], tokens: { ['x'.repeat(129)]: '#fff' } },
  ],
  [
    'theme:set-active',
    'overlong theme token value',
    { ...VALID_PAYLOADS['theme:set-active'], tokens: { '--color': 'x'.repeat(4097) } },
  ],
  [
    'theme:set-active',
    'too many theme tokens',
    {
      ...VALID_PAYLOADS['theme:set-active'],
      tokens: Object.fromEntries(Array.from({ length: 1025 }, (_, index) => [`--token-${index}`, 'x'])),
    },
  ],
  ['theme:set-active', 'invalid optional CSS substitute', { ...VALID_PAYLOADS['theme:set-active'], css: true }],
  [
    'theme:set-active',
    'overlong optional CSS',
    { ...VALID_PAYLOADS['theme:set-active'], css: 'x'.repeat(15 * 1024 * 1024 + 1) },
  ],
  ['system-settings:set-close-to-tray', 'omitted required enabled value', {}],
  ['system-settings:set-close-to-tray', 'non-boolean enabled value', { enabled: 1 }],
  ['system-settings:set-pet-enabled', 'omitted required enabled value', {}],
  ['system-settings:set-pet-enabled', 'non-boolean enabled value', { enabled: 1 }],
  ['system-settings:set-pet-size', 'omitted required size', {}],
  ['system-settings:set-pet-size', 'non-numeric size', { size: '280' }],
  ['system-settings:set-pet-size', 'unsupported size', { size: 240 }],
  ['system-settings:set-pet-dnd', 'omitted required dnd value', {}],
  ['system-settings:set-pet-dnd', 'non-boolean dnd value', { dnd: 1 }],
  ['system-settings:set-pet-confirm-enabled', 'omitted required enabled value', {}],
  ['system-settings:set-pet-confirm-enabled', 'non-boolean enabled value', { enabled: 1 }],
  ['notification.show', 'omitted required title', { body: 'Done' }],
  ['notification.show', 'omitted required body', { title: 'Done' }],
  ['notification.show', 'non-string title', { title: true, body: 'Done' }],
  ['notification.show', 'empty title', { title: '', body: 'Done' }],
  ['notification.show', 'overlong title', { title: 'x'.repeat(257), body: 'Done' }],
  ['notification.show', 'non-string body', { title: 'Done', body: true }],
  ['notification.show', 'overlong body', { title: 'Done', body: 'x'.repeat(4097) }],
  ['notification.show', 'invalid optional icon substitute', { title: 'Done', body: 'Done', icon: true }],
  ['notification.show', 'empty optional icon path', { title: 'Done', body: 'Done', icon: '' }],
  [
    'notification.show',
    'invalid optional conversation identifier substitute',
    { title: 'Done', body: 'Done', conversation_id: true },
  ],
  ['notification.show', 'empty optional conversation identifier', { title: 'Done', body: 'Done', conversation_id: '' }],
  ['webui.start', 'invalid optional port substitute', { port: '25808' }],
  ['webui.start', 'non-finite optional port', { port: Number.POSITIVE_INFINITY }],
  ['webui.start', 'port below the allowed range', { port: 0 }],
  ['webui.start', 'invalid optional remote access substitute', { allowRemote: 'false' }],
] satisfies ReadonlyArray<InvalidPayloadCase>;

describe('native bridge payload schemas', () => {
  it('keeps the native manifest equal to adapter provider string literals', () => {
    const providerKeys = collectBridgeBuildProviderKeys(readFileSync(IPC_BRIDGE_PATH, 'utf8'));

    expect(providerKeys).toEqual(NATIVE_BRIDGE_PROVIDER_KEYS);
  });

  it('rejects non-literal native provider declarations in the inventory', () => {
    expect(() => collectBridgeBuildProviderKeys("const key = 'provider'; bridge.buildProvider(key);")).toThrow(
      /provider key must be a string literal/i
    );
  });

  it('has exactly one schema for every manifested native provider', () => {
    expect(Object.keys(nativeBridgePayloadSchemas)).toEqual(NATIVE_BRIDGE_PROVIDER_KEYS);
  });

  it.each(NATIVE_BRIDGE_PROVIDER_KEYS)('accepts the current payload shape for %s', (providerKey) => {
    expect(() => parseNativeBridgePayload(providerKey, VALID_PAYLOADS[providerKey])).not.toThrow();
  });

  it.each(VOID_PROVIDER_KEYS)('rejects a supplied payload for void provider %s', (providerKey) => {
    expect(() => parseNativeBridgePayload(providerKey, {})).toThrow(INVALID_NATIVE_BRIDGE_PAYLOAD_MESSAGE);
  });

  it.each(NATIVE_BRIDGE_PROVIDER_KEYS.filter((providerKey) => VALID_PAYLOADS[providerKey] !== undefined))(
    'rejects unknown top-level fields for %s',
    (providerKey) => {
      const payload = VALID_PAYLOADS[providerKey];
      if (payload === null || typeof payload !== 'object' || Array.isArray(payload)) {
        throw new Error(`Missing object fixture for ${providerKey}`);
      }
      expect(() => parseNativeBridgePayload(providerKey, { ...payload, unexpected: true })).toThrow(
        INVALID_NATIVE_BRIDGE_PAYLOAD_MESSAGE
      );
    }
  );

  it.each(INVALID_PAYLOADS)('rejects %s payload with %s', (providerKey, _reason, payload) => {
    expect(() => parseNativeBridgePayload(providerKey, payload)).toThrow(INVALID_NATIVE_BRIDGE_PAYLOAD_MESSAGE);
  });

  it('allows the optional dialog payload to be omitted', () => {
    expect(parseNativeBridgePayload('show-open', undefined)).toBeUndefined();
  });

  it('does not expose payload values in validation errors', () => {
    const secret = 'secret-notification-value';
    let thrown: unknown;
    try {
      parseNativeBridgePayload('notification.show', { title: 'Notice', body: 'Body', token: secret });
    } catch (error) {
      thrown = error;
    }

    expect(thrown).toEqual(new Error(INVALID_NATIVE_BRIDGE_PAYLOAD_MESSAGE));
    expect(String(thrown)).not.toContain(secret);
  });
});
