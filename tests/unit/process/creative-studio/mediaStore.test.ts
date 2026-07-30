/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 *
 * @vitest-environment node
 */

import { createHash } from 'node:crypto';
import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { Readable } from 'node:stream';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  createCreativeStudioStore,
  CreativeStudioStoreError,
  type CreativeStudioStore,
} from '@process/services/creative-studio/store';
import * as mediaStoreModule from '@process/services/creative-studio/mediaStore';
import type { CreativeStudioMediaError } from '@process/services/creative-studio/mediaStore';
import {
  acquireStudioExportDirectory,
  createStudioMediaStore,
  openVerifiedReadStream,
  sanitizeStudioExportFolderName,
} from '@process/services/creative-studio/mediaStore';

const png = Buffer.from('89504e470d0a1a0a0000000d49484452000000010000000108060000001f15c489', 'hex');
const mp4 = Buffer.from('000000186674797069736f6d00000000', 'hex');
const webm = Buffer.from('1a45dfa300000000', 'hex');
const created: string[] = [];

const makeStore = async () => {
  const rootDir = await fs.mkdtemp(path.join(os.tmpdir(), 'studio-media-'));
  created.push(rootDir);
  const store = createCreativeStudioStore({ rootDir, createId: () => 'project_1' });
  await store.createProject({
    name: 'Film',
    brief: '',
    aspectRatio: '16:9',
    targetDurationSeconds: 5,
    resolution: '720p',
  });
  return { rootDir, store };
};

const addImageScene = async (store: CreativeStudioStore): Promise<void> => {
  await store.updateProject(
    'project_1',
    (project) => ({
      ...project,
      sceneOrder: ['scene_1'],
      scenes: {
        scene_1: {
          id: 'scene_1',
          title: 'Opening',
          purpose: '',
          visualPrompt: '',
          narration: '',
          onScreenText: '',
          mediaKind: 'image',
          durationSeconds: 5,
          referenceAssetId: null,
          selectedAssetId: null,
          assetIds: [],
          jobIds: [],
          reviewState: 'draft',
        },
      },
    }),
    1
  );
};

afterEach(async () => {
  await Promise.all(created.splice(0).map((directory) => fs.rm(directory, { recursive: true, force: true })));
});

describe('createStudioMediaStore', () => {
  it('keeps the production reference, image, and video byte ceilings explicit', () => {
    expect(
      (
        mediaStoreModule as typeof mediaStoreModule & {
          STUDIO_MEDIA_LIMITS?: Record<string, number>;
        }
      ).STUDIO_MEDIA_LIMITS
    ).toMatchObject({
      referenceMaxBytes: 30 * 1024 * 1024,
      imageOutputMaxBytes: 50 * 1024 * 1024,
      videoOutputMaxBytes: 512 * 1024 * 1024,
      projectMaxBytes: 5 * 1024 * 1024 * 1024,
    });
  });

  it('rejects a source that changes inode after validation and before open', async () => {
    const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'studio-swap-'));
    created.push(directory);
    const source = path.join(directory, 'source.png');
    const replacement = path.join(directory, 'replacement.png');
    await fs.writeFile(source, png);
    await fs.writeFile(replacement, png);

    await expect(
      openVerifiedReadStream(source, undefined, undefined, async () => {
        await fs.rename(replacement, source);
      })
    ).rejects.toMatchObject<Partial<CreativeStudioMediaError>>({ code: 'storage_error' });
  });

  it('creates collision-safe export folder names without invalid path characters', async () => {
    const rootDir = await fs.mkdtemp(path.join(os.tmpdir(), 'studio-export-'));
    created.push(rootDir);
    expect(sanitizeStudioExportFolderName('  A:/ launch.  ')).toBe('A__ launch');
    expect(sanitizeStudioExportFolderName('...')).toBe('creative-studio-project');
    await fs.mkdir(path.join(rootDir, 'A__ launch-20260730-120000'));

    await expect(acquireStudioExportDirectory(rootDir, 'A:/ launch.  ', '20260730-120000')).resolves.toMatchObject({
      folderName: 'A__ launch-20260730-120000-2',
    });
  });

  it('bounds export folder components to 255 UTF-8 bytes, including collision suffixes', async () => {
    const rootDir = await fs.mkdtemp(path.join(os.tmpdir(), 'studio-export-long-'));
    created.push(rootDir);
    const projectName = '界'.repeat(200);

    const first = await acquireStudioExportDirectory(rootDir, projectName, '20260730-120000');
    const second = await acquireStudioExportDirectory(rootDir, projectName, '20260730-120000');

    expect(Buffer.byteLength(first.folderName, 'utf8')).toBeLessThanOrEqual(255);
    expect(Buffer.byteLength(second.folderName, 'utf8')).toBeLessThanOrEqual(255);
    expect(second.folderName).toMatch(/-2$/);
  });

  it('copies a valid reference into imports with a durable hash and no source path', async () => {
    const { rootDir, store } = await makeStore();
    const sourcePath = path.join(rootDir, 'reference.png');
    await fs.writeFile(sourcePath, png);
    const media = createStudioMediaStore({ store, createId: () => 'asset_1' });

    const asset = await media.importReferenceFromPath({
      projectId: 'project_1',
      sourcePath,
      expectedRevision: 1,
    });

    expect(asset).toMatchObject({
      id: 'asset_1',
      sceneId: null,
      mimeType: 'image/png',
      managedAsset: { collection: 'imports', fileName: 'asset_1.png' },
      sha256: createHash('sha256').update(png).digest('hex'),
    });
    expect(JSON.stringify(asset)).not.toContain(sourcePath);
    await expect(fs.access(path.join(rootDir, 'project_1', 'imports', 'asset_1.png'))).resolves.toBeUndefined();
  });

  it('rejects a non-image reference before it can enter the manifest', async () => {
    const { rootDir, store } = await makeStore();
    const sourcePath = path.join(rootDir, 'reference.txt');
    await fs.writeFile(sourcePath, 'not media');
    const media = createStudioMediaStore({ store, createId: () => 'asset_1' });

    await expect(
      media.importReferenceFromPath({ projectId: 'project_1', sourcePath, expectedRevision: 1 })
    ).rejects.toMatchObject<Partial<CreativeStudioMediaError>>({ code: 'invalid_media' });
    expect((await store.getProject('project_1'))?.assets).toEqual({});
  });

  it.each([
    ['MP4', mp4],
    ['WebM', webm],
  ])('rejects a magic-valid %s video from the image-reference import path', async (_label, bytes) => {
    const { rootDir, store } = await makeStore();
    const sourcePath = path.join(rootDir, 'reference.bin');
    await fs.writeFile(sourcePath, bytes);
    const media = createStudioMediaStore({ store, createId: () => 'asset_video_reference' });

    await expect(
      media.importReferenceFromPath({ projectId: 'project_1', sourcePath, expectedRevision: 1 })
    ).rejects.toMatchObject<Partial<CreativeStudioMediaError>>({ code: 'invalid_media' });
    expect((await store.getProject('project_1'))?.assets).toEqual({});
    const imports = await fs.readdir(path.join(rootDir, 'project_1', 'imports')).catch(() => []);
    expect(imports).toEqual([]);
  });

  it('fails reference import before writing when injected disk capacity is insufficient', async () => {
    const { rootDir, store } = await makeStore();
    const sourcePath = path.join(rootDir, 'reference.png');
    await fs.writeFile(sourcePath, png);
    const media = createStudioMediaStore({
      store,
      createId: () => 'asset_1',
      getAvailableDiskBytes: async () => 0,
    });

    await expect(
      media.importReferenceFromPath({ projectId: 'project_1', sourcePath, expectedRevision: 1 })
    ).rejects.toMatchObject<Partial<CreativeStudioMediaError>>({ code: 'storage_error' });
    await expect(fs.access(path.join(rootDir, 'project_1', 'imports', 'asset_1.png'))).rejects.toMatchObject({
      code: 'ENOENT',
    });
  });

  it('accepts a reference at exact disk capacity without a second free-space charge', async () => {
    const { rootDir, store } = await makeStore();
    const sourcePath = path.join(rootDir, 'reference.png');
    await fs.writeFile(sourcePath, png);
    const getAvailableDiskBytes = vi
      .fn<(directory: string) => Promise<number>>()
      .mockResolvedValueOnce(png.length)
      .mockRejectedValue(new Error('disk capacity was charged twice'));
    const media = createStudioMediaStore({ store, createId: () => 'asset_actual', getAvailableDiskBytes });

    await expect(
      media.importReferenceFromPath({ projectId: 'project_1', sourcePath, expectedRevision: 1 })
    ).resolves.toMatchObject({ id: 'asset_actual', byteSize: png.length });
    expect(getAvailableDiskBytes).toHaveBeenCalledOnce();
  });

  it('rejects a zero-capacity reference before creating a part even when its pre-open size is stale', async () => {
    const { rootDir, store } = await makeStore();
    const sourcePath = path.join(rootDir, 'reference.png');
    await fs.writeFile(sourcePath, png);
    const actualSourceStats = await fs.stat(sourcePath);
    const originalStat = fs.stat.bind(fs);
    const statSpy = vi.spyOn(fs, 'stat').mockImplementation(async (target, options) => {
      if (target === sourcePath) return { ...actualSourceStats, size: 0 } as typeof actualSourceStats;
      return originalStat(target, options as never);
    });
    const media = createStudioMediaStore({
      store,
      createId: () => 'asset_zero',
      getAvailableDiskBytes: async () => 0,
    });

    await expect(
      media.importReferenceFromPath({ projectId: 'project_1', sourcePath, expectedRevision: 1 })
    ).rejects.toMatchObject<Partial<CreativeStudioMediaError>>({ code: 'storage_error' });

    statSpy.mockRestore();
    await expect(fs.access(path.join(rootDir, 'project_1', 'parts'))).rejects.toMatchObject({ code: 'ENOENT' });
  });

  it('stops a reference that grows past its nonzero pre-stream capacity ceiling', async () => {
    const { rootDir, store } = await makeStore();
    const sourcePath = path.join(rootDir, 'reference.png');
    await fs.writeFile(sourcePath, png);
    const actualSourceStats = await fs.stat(sourcePath);
    const originalStat = fs.stat.bind(fs);
    const statSpy = vi.spyOn(fs, 'stat').mockImplementation(async (target, options) => {
      if (target === sourcePath) return { ...actualSourceStats, size: 0 } as typeof actualSourceStats;
      return originalStat(target, options as never);
    });
    const getAvailableDiskBytes = vi
      .fn<(directory: string) => Promise<number>>()
      .mockResolvedValueOnce(png.length - 1)
      .mockRejectedValue(new Error('capacity must be planned only once'));
    const media = createStudioMediaStore({
      store,
      createId: () => 'asset_grew',
      getAvailableDiskBytes,
    });

    await expect(
      media.importReferenceFromPath({ projectId: 'project_1', sourcePath, expectedRevision: 1 })
    ).rejects.toMatchObject<Partial<CreativeStudioMediaError>>({ code: 'storage_error' });

    statSpy.mockRestore();
    expect(getAvailableDiskBytes).toHaveBeenCalledOnce();
    expect((await store.getProject('project_1'))?.assets).toEqual({});
    const parts = await fs.readdir(path.join(rootDir, 'project_1', 'parts')).catch(() => []);
    expect(parts.filter((name) => name.endsWith('.part'))).toEqual([]);
  });

  it('allows the exact project quota boundary but rejects one byte above it', async () => {
    const { rootDir, store } = await makeStore();
    const sourcePath = path.join(rootDir, 'reference.png');
    await fs.writeFile(sourcePath, png);
    const exact = 5 * 1024 * 1024 * 1024 - png.length;
    await store.updateProject(
      'project_1',
      (project) => ({
        ...project,
        assets: {
          quota_asset: {
            id: 'quota_asset',
            projectId: project.id,
            sceneId: null,
            mediaKind: 'image',
            mimeType: 'image/png',
            managedAsset: { collection: 'imports', fileName: 'quota_asset.png' },
            byteSize: exact,
            sha256: 'a'.repeat(64),
            createdAt: project.createdAt,
          },
        },
      }),
      1
    );
    const media = createStudioMediaStore({ store, createId: () => 'asset_1' });
    await expect(
      media.importReferenceFromPath({ projectId: 'project_1', sourcePath, expectedRevision: 2 })
    ).resolves.toMatchObject({ id: 'asset_1' });

    const overflowSource = path.join(rootDir, 'overflow.png');
    await fs.writeFile(overflowSource, png);
    await expect(
      media.importReferenceFromPath({ projectId: 'project_1', sourcePath: overflowSource, expectedRevision: 3 })
    ).rejects.toMatchObject<Partial<CreativeStudioMediaError>>({ code: 'invalid_media' });
  });

  it('preserves a replacement final import when the manifest CAS fails', async () => {
    const { rootDir, store } = await makeStore();
    const sourcePath = path.join(rootDir, 'reference.png');
    const replacementPath = path.join(rootDir, 'replacement-owned-by-user');
    const finalPath = path.join(rootDir, 'project_1', 'imports', 'asset_stale_import.png');
    await fs.writeFile(sourcePath, png);
    await fs.writeFile(replacementPath, 'replacement import');
    const staleStore: CreativeStudioStore = {
      ...store,
      async updateProject() {
        await fs.rm(finalPath);
        await fs.rename(replacementPath, finalPath);
        throw new CreativeStudioStoreError('stale_project', 'forced stale CAS');
      },
    };
    const media = createStudioMediaStore({ store: staleStore, createId: () => 'asset_stale_import' });

    await expect(
      media.importReferenceFromPath({ projectId: 'project_1', sourcePath, expectedRevision: 1 })
    ).rejects.toMatchObject({ code: 'stale_project' });
    await expect(fs.readFile(finalPath, 'utf8')).resolves.toBe('replacement import');
    expect((await store.getProject('project_1'))?.assets).toEqual({});
  });

  it('persists a generated image stream with a verified hash and no provider URL', async () => {
    const { rootDir, store } = await makeStore();
    await store.updateProject(
      'project_1',
      (project) => ({
        ...project,
        sceneOrder: ['scene_1'],
        scenes: {
          scene_1: {
            id: 'scene_1',
            title: 'Opening',
            purpose: '',
            visualPrompt: '',
            narration: '',
            onScreenText: '',
            mediaKind: 'image',
            durationSeconds: 5,
            referenceAssetId: null,
            selectedAssetId: null,
            assetIds: [],
            jobIds: [],
            reviewState: 'draft',
          },
        },
      }),
      1
    );
    const media = createStudioMediaStore({ store, createId: () => 'asset_2' });

    const asset = await media.persistProviderOutput({
      projectId: 'project_1',
      sceneId: 'scene_1',
      expectedRevision: 2,
      mediaKind: 'image',
      declaredMimeType: 'image/png',
      body: Readable.from([png]),
    });

    expect(asset.managedAsset).toEqual({ collection: 'assets', fileName: 'asset_2.png' });
    expect(asset.sha256).toBe(createHash('sha256').update(png).digest('hex'));
    expect(JSON.stringify(await store.getProject('project_1'))).not.toContain('http');
    await expect(fs.access(path.join(rootDir, 'project_1', 'assets', 'asset_2.png'))).resolves.toBeUndefined();
  });

  it('accepts a declared provider output at exact disk capacity without charging the part twice', async () => {
    const { store } = await makeStore();
    await addImageScene(store);
    const getAvailableDiskBytes = vi
      .fn<(directory: string) => Promise<number>>()
      .mockResolvedValueOnce(png.length)
      .mockRejectedValue(new Error('disk capacity was charged twice'));
    const media = createStudioMediaStore({
      store,
      createId: () => 'asset_exact_capacity',
      getAvailableDiskBytes,
    });

    await expect(
      media.persistProviderOutput({
        projectId: 'project_1',
        sceneId: 'scene_1',
        expectedRevision: 2,
        mediaKind: 'image',
        declaredMimeType: 'image/png',
        declaredByteSize: png.length,
        body: Readable.from([png]),
      })
    ).resolves.toMatchObject({ id: 'asset_exact_capacity', byteSize: png.length });
    expect(getAvailableDiskBytes).toHaveBeenCalledOnce();
  });

  it('rejects an unknown-size provider body at zero capacity before consuming it or creating a part', async () => {
    const { rootDir, store } = await makeStore();
    await addImageScene(store);
    let consumed = false;
    const body = {
      async *[Symbol.asyncIterator](): AsyncGenerator<Uint8Array> {
        consumed = true;
        yield png;
      },
    };
    const media = createStudioMediaStore({
      store,
      createId: () => 'asset_zero_capacity',
      getAvailableDiskBytes: async () => 0,
    });

    await expect(
      media.persistProviderOutput({
        projectId: 'project_1',
        sceneId: 'scene_1',
        expectedRevision: 2,
        mediaKind: 'image',
        declaredMimeType: 'image/png',
        body,
      })
    ).rejects.toMatchObject<Partial<CreativeStudioMediaError>>({ code: 'storage_error' });
    expect(consumed).toBe(false);
    await expect(fs.access(path.join(rootDir, 'project_1', 'parts'))).rejects.toMatchObject({ code: 'ENOENT' });
  });

  it('rejects a declared output above capacity before consuming its body', async () => {
    const { store } = await makeStore();
    await addImageScene(store);
    let consumed = false;
    const body = {
      async *[Symbol.asyncIterator](): AsyncGenerator<Uint8Array> {
        consumed = true;
        yield png;
      },
    };
    const media = createStudioMediaStore({
      store,
      createId: () => 'asset_declared_over',
      getAvailableDiskBytes: async () => png.length - 1,
    });

    await expect(
      media.persistProviderOutput({
        projectId: 'project_1',
        sceneId: 'scene_1',
        expectedRevision: 2,
        mediaKind: 'image',
        declaredMimeType: 'image/png',
        declaredByteSize: png.length,
        body,
      })
    ).rejects.toMatchObject<Partial<CreativeStudioMediaError>>({ code: 'storage_error' });
    expect(consumed).toBe(false);
  });

  it('rejects a declared-size mismatch and cleans the part', async () => {
    const { rootDir, store } = await makeStore();
    await addImageScene(store);
    const media = createStudioMediaStore({ store, createId: () => 'asset_size_mismatch' });

    await expect(
      media.persistProviderOutput({
        projectId: 'project_1',
        sceneId: 'scene_1',
        expectedRevision: 2,
        mediaKind: 'image',
        declaredMimeType: 'image/png',
        declaredByteSize: png.length + 1,
        body: Readable.from([png]),
      })
    ).rejects.toMatchObject<Partial<CreativeStudioMediaError>>({ code: 'invalid_media' });
    const parts = await fs.readdir(path.join(rootDir, 'project_1', 'parts')).catch(() => []);
    expect(parts.filter((name) => name.endsWith('.part'))).toEqual([]);
  });

  it('enforces injected reference, image-output, and video-output ceilings with small streams', async () => {
    const { rootDir, store } = await makeStore();
    const sourcePath = path.join(rootDir, 'reference.png');
    await fs.writeFile(sourcePath, png);
    const media = createStudioMediaStore({
      store,
      createId: () => 'asset_limited',
      limits: {
        referenceMaxBytes: png.length - 1,
        imageOutputMaxBytes: png.length - 1,
        videoOutputMaxBytes: mp4.length - 1,
      },
    });

    await expect(
      media.importReferenceFromPath({ projectId: 'project_1', sourcePath, expectedRevision: 1 })
    ).rejects.toMatchObject<Partial<CreativeStudioMediaError>>({ code: 'invalid_media' });
    await addImageScene(store);
    await expect(
      media.persistProviderOutput({
        projectId: 'project_1',
        sceneId: 'scene_1',
        expectedRevision: 2,
        mediaKind: 'image',
        declaredMimeType: 'image/png',
        body: Readable.from([png]),
      })
    ).rejects.toMatchObject<Partial<CreativeStudioMediaError>>({ code: 'invalid_media' });
    await expect(
      media.persistProviderOutput({
        projectId: 'project_1',
        sceneId: 'scene_1',
        expectedRevision: 2,
        mediaKind: 'video',
        declaredMimeType: 'video/mp4',
        body: Readable.from([mp4]),
      })
    ).rejects.toMatchObject<Partial<CreativeStudioMediaError>>({ code: 'invalid_media' });
    expect((await store.getProject('project_1'))?.assets).toEqual({});
  });

  it('preserves a replacement final provider asset when the manifest CAS fails', async () => {
    const { rootDir, store } = await makeStore();
    await addImageScene(store);
    const replacementPath = path.join(rootDir, 'replacement-owned-by-user');
    const finalPath = path.join(rootDir, 'project_1', 'assets', 'asset_stale_provider.png');
    await fs.writeFile(replacementPath, 'replacement provider asset');
    const staleStore: CreativeStudioStore = {
      ...store,
      async updateProject() {
        await fs.rm(finalPath);
        await fs.rename(replacementPath, finalPath);
        throw new CreativeStudioStoreError('stale_project', 'forced stale CAS');
      },
    };
    const media = createStudioMediaStore({ store: staleStore, createId: () => 'asset_stale_provider' });

    await expect(
      media.persistProviderOutput({
        projectId: 'project_1',
        sceneId: 'scene_1',
        expectedRevision: 2,
        mediaKind: 'image',
        declaredMimeType: 'image/png',
        declaredByteSize: png.length,
        body: Readable.from([png]),
      })
    ).rejects.toMatchObject({ code: 'stale_project' });
    await expect(fs.readFile(finalPath, 'utf8')).resolves.toBe('replacement provider asset');
    expect((await store.getProject('project_1'))?.assets).toEqual({});
  });

  it('never overwrites an existing final asset when an id collides', async () => {
    const { rootDir, store } = await makeStore();
    await store.updateProject(
      'project_1',
      (project) => ({
        ...project,
        sceneOrder: ['scene_1'],
        scenes: {
          scene_1: {
            id: 'scene_1',
            title: 'Opening',
            purpose: '',
            visualPrompt: '',
            narration: '',
            onScreenText: '',
            mediaKind: 'image',
            durationSeconds: 5,
            referenceAssetId: null,
            selectedAssetId: null,
            assetIds: [],
            jobIds: [],
            reviewState: 'draft',
          },
        },
      }),
      1
    );
    const assetsDir = path.join(rootDir, 'project_1', 'assets');
    await fs.mkdir(assetsDir, { recursive: true });
    const existing = path.join(assetsDir, 'asset_collision.png');
    await fs.writeFile(existing, 'do not overwrite');
    const media = createStudioMediaStore({ store, createId: () => 'asset_collision' });

    await expect(
      media.persistProviderOutput({
        projectId: 'project_1',
        sceneId: 'scene_1',
        expectedRevision: 2,
        mediaKind: 'image',
        declaredMimeType: 'image/png',
        body: Readable.from([png]),
      })
    ).rejects.toMatchObject<Partial<CreativeStudioMediaError>>({ code: 'storage_error' });
    await expect(fs.readFile(existing, 'utf8')).resolves.toBe('do not overwrite');
    expect((await store.getProject('project_1'))?.assets).toEqual({});
  });

  it('requires remote Content-Type, declared MIME, and magic bytes to agree', async () => {
    const { rootDir, store } = await makeStore();
    await store.updateProject(
      'project_1',
      (project) => ({
        ...project,
        sceneOrder: ['scene_1'],
        scenes: {
          scene_1: {
            id: 'scene_1',
            title: 'Opening',
            purpose: '',
            visualPrompt: '',
            narration: '',
            onScreenText: '',
            mediaKind: 'image',
            durationSeconds: 5,
            referenceAssetId: null,
            selectedAssetId: null,
            assetIds: [],
            jobIds: [],
            reviewState: 'draft',
          },
        },
      }),
      1
    );
    const media = createStudioMediaStore({ store, createId: () => 'asset_mismatch' });

    await expect(
      media.persistProviderOutputFromUrl({
        projectId: 'project_1',
        sceneId: 'scene_1',
        expectedRevision: 2,
        mediaKind: 'image',
        declaredMimeType: 'image/png',
        url: 'https://media.example.test/output.png',
        downloader: {
          lookup: async () => [{ address: '8.8.8.8', family: 4 }],
          request: async () => ({
            statusCode: 200,
            headers: { 'content-type': 'image/jpeg' },
            remoteAddress: '8.8.8.8',
            body: Readable.from([png]),
          }),
        },
      })
    ).rejects.toMatchObject<Partial<CreativeStudioMediaError>>({ code: 'invalid_media' });
    expect((await store.getProject('project_1'))?.assets).toEqual({});
    const parts = await fs.readdir(path.join(rootDir, 'project_1', 'parts')).catch(() => []);
    expect(parts.filter((name) => name.endsWith('.part'))).toEqual([]);

    await expect(
      media.persistProviderOutputFromUrl({
        projectId: 'project_1',
        sceneId: 'scene_1',
        expectedRevision: 2,
        mediaKind: 'image',
        declaredMimeType: 'image/png',
        url: 'https://media.example.test/output.png',
        downloader: {
          lookup: async () => [{ address: '8.8.8.8', family: 4 }],
          request: async () => ({
            statusCode: 200,
            headers: { 'content-type': 'Image/PNG; charset=binary' },
            remoteAddress: '8.8.8.8',
            body: Readable.from([png]),
          }),
        },
      })
    ).resolves.toMatchObject({ id: 'asset_mismatch', mimeType: 'image/png' });
  });

  it('rejects an unknown-size provider URL at zero capacity before making the request', async () => {
    const { rootDir, store } = await makeStore();
    await addImageScene(store);
    const request = vi.fn(async () => ({
      statusCode: 200,
      headers: { 'content-type': 'image/png' },
      remoteAddress: '8.8.8.8',
      body: Readable.from([png]),
    }));
    const media = createStudioMediaStore({
      store,
      createId: () => 'asset_zero_url',
      getAvailableDiskBytes: async () => 0,
    });

    await expect(
      media.persistProviderOutputFromUrl({
        projectId: 'project_1',
        sceneId: 'scene_1',
        expectedRevision: 2,
        mediaKind: 'image',
        declaredMimeType: 'image/png',
        url: 'https://media.example.test/output.png',
        downloader: {
          lookup: async () => [{ address: '8.8.8.8', family: 4 }],
          request,
        },
      })
    ).rejects.toMatchObject<Partial<CreativeStudioMediaError>>({ code: 'storage_error' });
    expect(request).not.toHaveBeenCalled();
    await expect(fs.access(path.join(rootDir, 'project_1', 'parts'))).rejects.toMatchObject({ code: 'ENOENT' });
  });

  it('cleans the managed part and leaves no manifest asset when a provider URL stream fails', async () => {
    const { rootDir, store } = await makeStore();
    await store.updateProject(
      'project_1',
      (project) => ({
        ...project,
        sceneOrder: ['scene_1'],
        scenes: {
          scene_1: {
            id: 'scene_1',
            title: 'Opening',
            purpose: '',
            visualPrompt: '',
            narration: '',
            onScreenText: '',
            mediaKind: 'image',
            durationSeconds: 5,
            referenceAssetId: null,
            selectedAssetId: null,
            assetIds: [],
            jobIds: [],
            reviewState: 'draft',
          },
        },
      }),
      1
    );
    const media = createStudioMediaStore({ store, createId: () => 'asset_abort' });
    await expect(
      media.persistProviderOutputFromUrl({
        projectId: 'project_1',
        sceneId: 'scene_1',
        expectedRevision: 2,
        mediaKind: 'image',
        declaredMimeType: 'image/png',
        url: 'https://media.example.test/output.png',
        downloader: {
          lookup: async () => [{ address: '8.8.8.8', family: 4 }],
          request: async () => ({
            statusCode: 200,
            headers: {},
            remoteAddress: '8.8.8.8',
            body: {
              async *[Symbol.asyncIterator](): AsyncGenerator<Uint8Array> {
                yield Buffer.alloc(0);
                throw new Error('provider stream failed');
              },
            },
          }),
        },
      })
    ).rejects.toMatchObject({ code: 'remote_download_failed' });
    expect((await store.getProject('project_1'))?.assets).toEqual({});
    const parts = await fs.readdir(path.join(rootDir, 'project_1', 'parts')).catch(() => []);
    expect(parts.filter((name) => name.endsWith('.part'))).toEqual([]);
  });

  it('cleans the managed part and leaves no manifest asset when a provider URL is already aborted', async () => {
    const { rootDir, store } = await makeStore();
    await store.updateProject(
      'project_1',
      (project) => ({
        ...project,
        sceneOrder: ['scene_1'],
        scenes: {
          scene_1: {
            id: 'scene_1',
            title: 'Opening',
            purpose: '',
            visualPrompt: '',
            narration: '',
            onScreenText: '',
            mediaKind: 'image',
            durationSeconds: 5,
            referenceAssetId: null,
            selectedAssetId: null,
            assetIds: [],
            jobIds: [],
            reviewState: 'draft',
          },
        },
      }),
      1
    );
    const controller = new AbortController();
    controller.abort();
    const media = createStudioMediaStore({ store, createId: () => 'asset_abort' });
    await expect(
      media.persistProviderOutputFromUrl({
        projectId: 'project_1',
        sceneId: 'scene_1',
        expectedRevision: 2,
        mediaKind: 'image',
        declaredMimeType: 'image/png',
        url: 'https://media.example.test/output.png',
        downloader: {
          signal: controller.signal,
          lookup: async () => [{ address: '8.8.8.8', family: 4 }],
          request: async () => {
            throw new Error('must not contact');
          },
        },
      })
    ).rejects.toMatchObject({ code: 'remote_download_failed' });
    expect((await store.getProject('project_1'))?.assets).toEqual({});
    const parts = await fs.readdir(path.join(rootDir, 'project_1', 'parts')).catch(() => []);
    expect(parts.filter((name) => name.endsWith('.part'))).toEqual([]);
  });

  it('rejects a stale URL persistence plan before contacting the provider', async () => {
    const { store } = await makeStore();
    await addImageScene(store);
    const request = vi.fn();
    const media = createStudioMediaStore({ store, createId: () => 'asset_stale' });

    await expect(
      media.persistProviderOutputFromUrl({
        projectId: 'project_1',
        sceneId: 'scene_1',
        expectedRevision: 1,
        mediaKind: 'image',
        declaredMimeType: 'image/png',
        url: 'https://media.example.test/output.png',
        downloader: {
          lookup: async () => [{ address: '8.8.8.8', family: 4 }],
          request,
        },
      })
    ).rejects.toMatchObject<Partial<CreativeStudioMediaError>>({ code: 'stale_project' });
    expect(request).not.toHaveBeenCalled();
  });

  it('aborts a URL download when local persistence rejects before backpressure drains', async () => {
    const { rootDir, store } = await makeStore();
    await addImageScene(store);
    await fs.writeFile(path.join(rootDir, 'project_1', 'parts'), 'blocks the managed parts directory');
    let downloaderSignal: AbortSignal | undefined;
    const media = createStudioMediaStore({ store, createId: () => 'asset_stale' });
    const operation = media.persistProviderOutputFromUrl({
      projectId: 'project_1',
      sceneId: 'scene_1',
      expectedRevision: 2,
      mediaKind: 'image',
      declaredMimeType: 'image/png',
      url: 'https://media.example.test/output.png',
      downloader: {
        lookup: async () => [{ address: '8.8.8.8', family: 4 }],
        request: async (_target, options) => {
          downloaderSignal = options?.signal;
          return {
            statusCode: 200,
            headers: { 'content-type': 'image/png' },
            remoteAddress: '8.8.8.8',
            body: {
              async *[Symbol.asyncIterator](): AsyncGenerator<Uint8Array> {
                while (!options?.signal?.aborted) yield Buffer.alloc(64 * 1024);
              },
            },
          };
        },
      },
    });

    await expect(
      Promise.race([
        operation,
        new Promise((_, reject) => setTimeout(() => reject(new Error('deadlocked persistence')), 1_000)),
      ])
    ).rejects.toMatchObject<Partial<CreativeStudioMediaError>>({ code: 'storage_error' });
    expect(downloaderSignal?.aborted).toBe(true);
  });

  it('exports selected assets in scene order, reports gaps, and excludes internal paths', async () => {
    const { rootDir, store } = await makeStore();
    await store.updateProject(
      'project_1',
      (project) => ({
        ...project,
        sceneOrder: ['scene_1', 'scene_2'],
        scenes: {
          scene_1: {
            id: 'scene_1',
            title: 'Opening',
            purpose: '',
            visualPrompt: '',
            narration: '',
            onScreenText: '',
            mediaKind: 'image',
            durationSeconds: 2,
            referenceAssetId: null,
            selectedAssetId: null,
            assetIds: [],
            jobIds: [],
            reviewState: 'draft',
          },
          scene_2: {
            id: 'scene_2',
            title: 'Close',
            purpose: '',
            visualPrompt: '',
            narration: '',
            onScreenText: '',
            mediaKind: 'image',
            durationSeconds: 3,
            referenceAssetId: null,
            selectedAssetId: null,
            assetIds: [],
            jobIds: [],
            reviewState: 'draft',
          },
        },
      }),
      1
    );
    const media = createStudioMediaStore({ store, createId: () => 'asset_3' });
    await media.persistProviderOutput({
      projectId: 'project_1',
      sceneId: 'scene_1',
      expectedRevision: 2,
      mediaKind: 'image',
      declaredMimeType: 'image/png',
      body: Readable.from([png]),
    });
    await store.updateProject(
      'project_1',
      (project) => ({
        ...project,
        scenes: { ...project.scenes, scene_1: { ...project.scenes.scene_1, selectedAssetId: 'asset_3' } },
      }),
      3
    );
    const destination = await fs.mkdtemp(path.join(os.tmpdir(), 'studio-export-target-'));
    created.push(destination);

    const result = await media.exportAssetsToDirectory({
      projectId: 'project_1',
      destinationDirectory: destination,
      includeReferences: false,
      timestamp: '20260730-120000',
    });

    expect(result).toEqual({
      folderName: 'Film-20260730-120000',
      exported: [{ assetId: 'asset_3', fileName: 'scene-01.png' }],
      missingSceneIds: ['scene_2'],
    });
    await expect(fs.readFile(path.join(destination, result.folderName, 'scene-01.png'))).resolves.toEqual(png);
    const storyboard = await fs.readFile(path.join(destination, result.folderName, 'storyboard.json'), 'utf8');
    expect(storyboard).not.toContain(rootDir);
    expect(storyboard).not.toContain('http');
  });

  it('returns a bounded main-only provider data URL after revalidating managed bytes', async () => {
    const { rootDir, store } = await makeStore();
    const sourcePath = path.join(rootDir, 'reference.png');
    await fs.writeFile(sourcePath, png);
    const media = createStudioMediaStore({ store, createId: () => 'asset_1' });
    await media.importReferenceFromPath({ projectId: 'project_1', sourcePath, expectedRevision: 1 });

    const providerInput = await media.resolveProviderInput('project_1', 'asset_1');
    await expect(providerInput.asDataUrl(png.length)).resolves.toMatch(/^data:image\/png;base64,/);
    await expect(providerInput.asDataUrl(png.length - 1)).rejects.toMatchObject({ code: 'invalid_media' });
  });

  it('rejects a same-size managed-byte overwrite through resolved, provider, and export consumers', async () => {
    const { rootDir, store } = await makeStore();
    const sourcePath = path.join(rootDir, 'reference.png');
    await fs.writeFile(sourcePath, png);
    const media = createStudioMediaStore({ store, createId: () => 'asset_1' });
    await media.importReferenceFromPath({ projectId: 'project_1', sourcePath, expectedRevision: 1 });
    const resolved = await media.resolveAsset('project_1', 'asset_1');
    const providerInput = await media.resolveProviderInput('project_1', 'asset_1');
    expect(resolved).not.toBeNull();

    const managedPath = path.join(rootDir, 'project_1', 'imports', 'asset_1.png');
    const replacement = Buffer.from(png);
    replacement[replacement.length - 1] ^= 0xff;
    await fs.writeFile(managedPath, replacement);

    await expect(resolved!.openVerifiedStream()).rejects.toMatchObject<Partial<CreativeStudioMediaError>>({
      code: 'storage_error',
    });
    await expect(providerInput.openStream()).rejects.toMatchObject<Partial<CreativeStudioMediaError>>({
      code: 'storage_error',
    });
    const destination = await fs.mkdtemp(path.join(os.tmpdir(), 'studio-tampered-export-'));
    created.push(destination);
    await expect(
      media.exportAssetsToDirectory({
        projectId: 'project_1',
        destinationDirectory: destination,
        includeReferences: true,
        timestamp: '20260730-120000',
      })
    ).resolves.toMatchObject({ exported: [] });
    await expect(
      fs.access(path.join(destination, 'Film-20260730-120000', 'references', 'asset_1.png'))
    ).rejects.toMatchObject({ code: 'ENOENT' });
  });

  it('removes only regular orphan part files from a verified project directory', async () => {
    const { rootDir, store } = await makeStore();
    const media = createStudioMediaStore({ store });
    const parts = path.join(rootDir, 'project_1', 'parts');
    await fs.mkdir(parts, { recursive: true });
    await fs.writeFile(path.join(parts, 'download.part'), 'partial');
    await fs.writeFile(path.join(parts, 'keep.txt'), 'keep');

    await media.cleanupOrphanParts();

    await expect(fs.access(path.join(parts, 'download.part'))).rejects.toMatchObject({ code: 'ENOENT' });
    await expect(fs.readFile(path.join(parts, 'keep.txt'), 'utf8')).resolves.toBe('keep');
  });
});
