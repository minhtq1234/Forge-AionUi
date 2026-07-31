/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import { createHash, randomUUID } from 'node:crypto';
import { constants as fsConstants, createReadStream, createWriteStream, promises as fs } from 'node:fs';
import path from 'node:path';
import { PassThrough, Readable, Transform } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import type { StudioAsset, StudioProject } from '@/common/types/project/creativeStudioTypes';
import { CreativeStudioStoreError, type CreativeStudioStore } from './store';
import { downloadRemoteMedia, type RemoteMediaDownloadDeps } from '../remote-media/remoteMediaDownloader';

const SAFE_ID = /^[A-Za-z0-9_-]{1,256}$/;
export type StudioMediaLimits = {
  referenceMaxBytes: number;
  imageOutputMaxBytes: number;
  videoOutputMaxBytes: number;
  projectMaxBytes: number;
};

export const STUDIO_MEDIA_LIMITS: Readonly<StudioMediaLimits> = Object.freeze({
  referenceMaxBytes: 30 * 1024 * 1024,
  imageOutputMaxBytes: 50 * 1024 * 1024,
  videoOutputMaxBytes: 512 * 1024 * 1024,
  projectMaxBytes: 5 * 1024 * 1024 * 1024,
});
const MIME_SIGNATURES = [
  {
    mimeType: 'image/png',
    extension: 'png',
    match: (bytes: Buffer) => bytes.subarray(0, 8).equals(Buffer.from('89504e470d0a1a0a', 'hex')),
  },
  {
    mimeType: 'image/jpeg',
    extension: 'jpg',
    match: (bytes: Buffer) => bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff,
  },
  {
    mimeType: 'image/webp',
    extension: 'webp',
    match: (bytes: Buffer) => bytes.subarray(0, 4).toString() === 'RIFF' && bytes.subarray(8, 12).toString() === 'WEBP',
  },
  {
    mimeType: 'video/mp4',
    extension: 'mp4',
    match: (bytes: Buffer) => bytes.subarray(4, 8).toString() === 'ftyp',
  },
  {
    mimeType: 'video/webm',
    extension: 'webm',
    match: (bytes: Buffer) => bytes.subarray(0, 4).equals(Buffer.from('1a45dfa3', 'hex')),
  },
] as const;

export class CreativeStudioMediaError extends Error {
  readonly code: 'invalid_media' | 'storage_error' | 'stale_project' | 'not_found' | 'job_inactive';

  constructor(code: CreativeStudioMediaError['code']) {
    super(code);
    this.name = 'CreativeStudioMediaError';
    this.code = code;
  }
}

export type InternalImportReferenceInput = {
  projectId: string;
  sourcePath: string;
  sceneId?: string;
  expectedRevision: number;
};

export type InternalExportStudioAssetsInput = {
  projectId: string;
  destinationDirectory: string;
  includeReferences: boolean;
  timestamp?: string;
};

export type PersistProviderOutputInput = {
  projectId: string;
  sceneId: string;
  expectedRevision: number;
  mediaKind: 'image' | 'video';
  declaredMimeType: string;
  declaredByteSize?: number;
  width?: number;
  height?: number;
  durationSeconds?: number;
  body: AsyncIterable<Uint8Array>;
};

export type PersistProviderOutputUrlInput = Omit<PersistProviderOutputInput, 'body'> & {
  url: string;
  downloader: Omit<RemoteMediaDownloadDeps, 'write' | 'maxBytes'>;
};

export type PersistProviderJobOutputInput = Omit<PersistProviderOutputInput, 'expectedRevision'> & {
  jobId: string;
};

export type PersistProviderJobOutputUrlInput = Omit<PersistProviderOutputUrlInput, 'expectedRevision'> & {
  jobId: string;
};

export type PersistProviderJobPosterInput = {
  projectId: string;
  sceneId: string;
  jobId: string;
  primaryAssetId: string;
  declaredMimeType: string;
  declaredByteSize?: number;
  width?: number;
  height?: number;
  body: AsyncIterable<Uint8Array>;
};

export type PersistProviderJobPosterUrlInput = Omit<PersistProviderJobPosterInput, 'body'> & {
  url: string;
  downloader: Omit<RemoteMediaDownloadDeps, 'write' | 'maxBytes'>;
};

export type InternalStudioExportResult = {
  folderName: string;
  exported: Array<{ assetId: string; fileName: string }>;
  missingSceneIds: string[];
};

export type StudioMediaStore = {
  importReferenceFromPath(input: InternalImportReferenceInput): Promise<StudioAsset>;
  persistProviderOutput(input: PersistProviderOutputInput): Promise<StudioAsset>;
  persistProviderOutputFromUrl(input: PersistProviderOutputUrlInput): Promise<StudioAsset>;
  persistProviderOutputForJob(input: PersistProviderJobOutputInput): Promise<StudioAsset>;
  persistProviderOutputFromUrlForJob(input: PersistProviderJobOutputUrlInput): Promise<StudioAsset>;
  persistProviderPosterForJob(input: PersistProviderJobPosterInput): Promise<StudioAsset>;
  persistProviderPosterFromUrlForJob(input: PersistProviderJobPosterUrlInput): Promise<StudioAsset>;
  resolveAsset(
    projectId: string,
    assetId: string
  ): Promise<{
    asset: StudioAsset;
    openVerifiedStream: (start?: number, end?: number) => Promise<Readable>;
  } | null>;
  resolveProviderInput(
    projectId: string,
    assetId: string
  ): Promise<{
    assetId: string;
    mimeType: 'image/jpeg' | 'image/png' | 'image/webp';
    byteSize: number;
    openStream: () => Promise<Readable>;
    asDataUrl: (maxBytes: number) => Promise<string>;
  }>;
  exportAssetsToDirectory(input: InternalExportStudioAssetsInput): Promise<InternalStudioExportResult>;
  cleanupOrphanParts(): Promise<void>;
};

export type StudioMediaStoreDeps = {
  store: CreativeStudioStore;
  createId?: () => string;
  now?: () => string;
  /** Injectable to fail before starting a write when the volume cannot fit it. */
  getAvailableDiskBytes?: (directory: string) => Promise<number>;
  /** Test seam for byte-boundary coverage without allocating production-sized fixtures. */
  limits?: Partial<StudioMediaLimits>;
};

const truncateUtf8 = (value: string, maxBytes: number): string => {
  let result = '';
  let byteLength = 0;
  for (const character of value) {
    const characterBytes = Buffer.byteLength(character, 'utf8');
    if (byteLength + characterBytes > maxBytes) break;
    result += character;
    byteLength += characterBytes;
  }
  return result;
};

type FileIdentity = { dev: string; ino: string };

type VerifiedDirectory = {
  directory: string;
  identity: FileIdentity;
};

const fileIdentity = (stats: { dev: number | bigint; ino: number | bigint }): FileIdentity => ({
  dev: String(stats.dev),
  ino: String(stats.ino),
});

const captureVerifiedDirectory = async (directory: string): Promise<VerifiedDirectory> => {
  try {
    const stats = await fs.lstat(directory);
    if (!stats.isDirectory() || stats.isSymbolicLink()) throw new CreativeStudioMediaError('storage_error');
    return { directory, identity: fileIdentity(stats) };
  } catch (error) {
    if (error instanceof CreativeStudioMediaError) throw error;
    throw new CreativeStudioMediaError('storage_error');
  }
};

const assertVerifiedDirectory = async (expected: VerifiedDirectory): Promise<void> => {
  const current = await captureVerifiedDirectory(expected.directory);
  if (current.identity.dev !== expected.identity.dev || current.identity.ino !== expected.identity.ino) {
    throw new CreativeStudioMediaError('storage_error');
  }
};

/** Produces a portable basename; callers still acquire the directory atomically. */
export const sanitizeStudioExportFolderName = (projectName: string): string => {
  const sanitized = projectName
    .replace(/[<>:"/\\|?*]|\p{Cc}/gu, '_')
    .trim()
    .replace(/[. ]+$/g, '');
  return sanitized || 'creative-studio-project';
};

/** Creates a new directory only; a collision never causes an existing export to be reused. */
export const acquireStudioExportDirectory = async (
  destinationDirectory: string,
  projectName: string,
  timestamp: string
): Promise<{ folderName: string; directory: string; identity: FileIdentity }> => {
  if (!/^\d{8}-\d{6}$/.test(timestamp)) throw new CreativeStudioMediaError('storage_error');
  const verifiedDestination = await captureVerifiedDirectory(destinationDirectory);
  const sanitizedProjectName = sanitizeStudioExportFolderName(projectName);
  for (let suffix = 1; suffix < 10_000; suffix += 1) {
    const suffixText = `-${timestamp}${suffix === 1 ? '' : `-${suffix}`}`;
    const availableNameBytes = 255 - Buffer.byteLength(suffixText, 'utf8');
    const projectComponent = truncateUtf8(sanitizedProjectName, availableNameBytes);
    if (!projectComponent) throw new CreativeStudioMediaError('storage_error');
    const folderName = `${projectComponent}${suffixText}`;
    const directory = path.join(destinationDirectory, folderName);
    if (path.dirname(directory) !== destinationDirectory) throw new CreativeStudioMediaError('storage_error');
    try {
      await assertVerifiedDirectory(verifiedDestination);
      await fs.mkdir(directory);
      const verifiedDirectory = await captureVerifiedDirectory(directory);
      await assertVerifiedDirectory(verifiedDestination);
      return { folderName, directory, identity: verifiedDirectory.identity };
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw new CreativeStudioMediaError('storage_error');
      await assertVerifiedDirectory(verifiedDestination);
    }
  }
  throw new CreativeStudioMediaError('storage_error');
};

const regularFile = async (file: string): Promise<Awaited<ReturnType<typeof fs.lstat>>> => {
  const stats = await fs.lstat(file);
  if (!stats.isFile() || stats.isSymbolicLink()) throw new CreativeStudioMediaError('storage_error');
  return stats;
};

type VerifiedReadExpectation = {
  dev: string;
  ino: string;
  byteSize: number;
  sha256: string;
  mimeType: string;
};

/** Opens a file only after comparing path and descriptor identity, so a swap after validation is rejected. */
export const openVerifiedReadStream = async (
  filePath: string,
  start?: number,
  end?: number,
  beforeOpen?: () => Promise<void>,
  expected?: VerifiedReadExpectation
): Promise<Readable> => {
  const before = await regularFile(filePath);
  const beforeIdentity = fileIdentity(before);
  if (
    expected &&
    (beforeIdentity.dev !== expected.dev || beforeIdentity.ino !== expected.ino || before.size !== expected.byteSize)
  ) {
    throw new CreativeStudioMediaError('storage_error');
  }
  await beforeOpen?.();
  const handle = await fs.open(filePath, 'r');
  try {
    const opened = await handle.stat();
    const openedIdentity = fileIdentity(opened);
    if (
      beforeIdentity.dev !== openedIdentity.dev ||
      beforeIdentity.ino !== openedIdentity.ino ||
      !opened.isFile() ||
      (expected !== undefined &&
        (openedIdentity.dev !== expected.dev ||
          openedIdentity.ino !== expected.ino ||
          opened.size !== expected.byteSize))
    ) {
      throw new CreativeStudioMediaError('storage_error');
    }
    if (expected) {
      const hash = createHash('sha256');
      const readBuffer = Buffer.allocUnsafe(64 * 1024);
      let sample = Buffer.alloc(0);
      let position = 0;
      while (position < expected.byteSize) {
        const { bytesRead } = await handle.read(
          readBuffer,
          0,
          Math.min(readBuffer.length, expected.byteSize - position),
          position
        );
        if (bytesRead === 0) throw new CreativeStudioMediaError('storage_error');
        const bytes = readBuffer.subarray(0, bytesRead);
        hash.update(bytes);
        if (sample.length < 32) sample = Buffer.concat([sample, bytes]).subarray(0, 32);
        position += bytesRead;
      }
      const afterVerification = await handle.stat();
      const afterIdentity = fileIdentity(afterVerification);
      const signature = sniff(sample);
      if (
        afterIdentity.dev !== expected.dev ||
        afterIdentity.ino !== expected.ino ||
        afterVerification.size !== expected.byteSize ||
        hash.digest('hex') !== expected.sha256 ||
        !signature ||
        signature.mimeType !== expected.mimeType
      ) {
        throw new CreativeStudioMediaError('storage_error');
      }
    }
    const stream = createReadStream(filePath, {
      fd: handle.fd,
      autoClose: false,
      start,
      end,
    });
    let closed = false;
    const closeHandle = (): void => {
      if (closed) return;
      closed = true;
      void handle.close().catch((): undefined => undefined);
    };
    stream.once('end', closeHandle);
    stream.once('error', closeHandle);
    stream.once('close', closeHandle);
    return stream;
  } catch (error) {
    await handle.close().catch((): undefined => undefined);
    throw error;
  }
};

/** Default production disk preflight; injectable tests can still model exact capacity boundaries. */
export const getAvailableStudioDiskBytes = async (directory: string): Promise<number> => {
  try {
    const stats = await fs.statfs(directory);
    const available = stats.bavail * stats.bsize;
    if (!Number.isFinite(available) || available < 0) throw new CreativeStudioMediaError('storage_error');
    return Number.isSafeInteger(available) ? available : Number.MAX_SAFE_INTEGER;
  } catch (error) {
    if (error instanceof CreativeStudioMediaError) throw error;
    throw new CreativeStudioMediaError('storage_error');
  }
};

const ensureManagedDirectory = async (projectDir: string, name: string): Promise<string> => {
  const directory = path.join(projectDir, name);
  if (path.dirname(directory) !== projectDir) throw new CreativeStudioMediaError('storage_error');
  await fs.mkdir(directory, { recursive: true });
  const stats = await fs.lstat(directory);
  if (!stats.isDirectory() || stats.isSymbolicLink() || (await fs.realpath(directory)) !== directory) {
    throw new CreativeStudioMediaError('storage_error');
  }
  return directory;
};

/** fsyncs a fresh part, then links it into place without ever overwriting an existing asset. */
const finalizeManagedPart = async (
  partPath: string,
  partsDir: string,
  destinationPath: string,
  destinationDir: string
): Promise<FileIdentity> => {
  if (path.dirname(partPath) !== partsDir || path.dirname(destinationPath) !== destinationDir) {
    throw new CreativeStudioMediaError('storage_error');
  }
  await ensureManagedDirectory(path.dirname(partsDir), path.basename(partsDir));
  await ensureManagedDirectory(path.dirname(destinationDir), path.basename(destinationDir));
  const partStats = await regularFile(partPath);
  if ((await fs.realpath(partPath)) !== partPath) throw new CreativeStudioMediaError('storage_error');
  const handle = await fs.open(partPath, 'r');
  let linkedIdentity: FileIdentity | null = null;
  try {
    const opened = await handle.stat();
    const partIdentity = fileIdentity(partStats);
    const openedIdentity = fileIdentity(opened);
    if (openedIdentity.dev !== partIdentity.dev || openedIdentity.ino !== partIdentity.ino || !opened.isFile()) {
      throw new CreativeStudioMediaError('storage_error');
    }
    await handle.sync();
    const verifiedIdentity = openedIdentity;
    try {
      // Hard-link creation is atomic on the project volume and fails with
      // EEXIST, unlike rename(), which can silently replace an existing asset.
      await fs.link(partPath, destinationPath);
      const linkedStats = await fs.lstat(destinationPath);
      linkedIdentity = fileIdentity(linkedStats);
      if (!linkedStats.isFile() || linkedStats.isSymbolicLink()) {
        throw new CreativeStudioMediaError('storage_error');
      }
      const destinationHandle = await fs.open(destinationPath, 'r');
      try {
        const destinationStats = await destinationHandle.stat();
        const destinationIdentity = fileIdentity(destinationStats);
        if (
          !destinationStats.isFile() ||
          destinationIdentity.dev !== linkedIdentity.dev ||
          destinationIdentity.ino !== linkedIdentity.ino ||
          destinationIdentity.dev !== verifiedIdentity.dev ||
          destinationIdentity.ino !== verifiedIdentity.ino
        ) {
          throw new CreativeStudioMediaError('storage_error');
        }
      } finally {
        await destinationHandle.close();
      }
      await fs.unlink(partPath);
      return verifiedIdentity;
    } catch (error) {
      if (linkedIdentity) {
        try {
          const destinationStats = await fs.lstat(destinationPath);
          const destinationIdentity = fileIdentity(destinationStats);
          if (destinationIdentity.dev === linkedIdentity.dev && destinationIdentity.ino === linkedIdentity.ino) {
            await fs.unlink(destinationPath);
          }
        } catch {
          // The outer operation reports a stable storage error.
        }
      }
      throw error;
    }
  } finally {
    await handle.close();
  }
};

/** Removes only the inode created by this operation; a replacement is user-owned and preserved. */
const unlinkIfIdentityMatches = async (filePath: string, expected: FileIdentity): Promise<void> => {
  try {
    const stats = await fs.lstat(filePath);
    const current = fileIdentity(stats);
    if (stats.isFile() && !stats.isSymbolicLink() && current.dev === expected.dev && current.ino === expected.ino) {
      await fs.unlink(filePath);
    }
  } catch {
    // Cleanup is best-effort and never broadens to an unverified replacement.
  }
};

const assertVerifiedDirectories = async (directories: VerifiedDirectory[]): Promise<void> => {
  await Promise.all(directories.map(assertVerifiedDirectory));
};

const createVerifiedExportSubdirectory = async (
  parent: VerifiedDirectory,
  name: string
): Promise<VerifiedDirectory> => {
  const directory = path.join(parent.directory, name);
  if (path.dirname(directory) !== parent.directory) throw new CreativeStudioMediaError('storage_error');
  try {
    await assertVerifiedDirectory(parent);
    await fs.mkdir(directory);
    const verified = await captureVerifiedDirectory(directory);
    await assertVerifiedDirectory(parent);
    return verified;
  } catch (error) {
    if (error instanceof CreativeStudioMediaError) throw error;
    throw new CreativeStudioMediaError('storage_error');
  }
};

/**
 * Opens a fresh export file without following its final component, verifies the
 * parent identity again before any bytes are written, and keeps all writes on
 * that descriptor if the pathname is moved later.
 */
const writeVerifiedExportFile = async (
  filePath: string,
  parent: VerifiedDirectory,
  ancestors: VerifiedDirectory[],
  write: (handle: Awaited<ReturnType<typeof fs.open>>) => Promise<void>
): Promise<void> => {
  if (path.dirname(filePath) !== parent.directory) throw new CreativeStudioMediaError('storage_error');
  const directories = [...ancestors, parent];
  let handle: Awaited<ReturnType<typeof fs.open>> | null = null;
  let openedIdentity: FileIdentity | null = null;
  const closeHandle = async (): Promise<void> => {
    if (handle === null) return;
    const openedHandle = handle;
    handle = null;
    await openedHandle.close().catch((): undefined => undefined);
  };
  try {
    await assertVerifiedDirectories(directories);
    handle = await fs.open(
      filePath,
      fsConstants.O_WRONLY |
        fsConstants.O_CREAT |
        fsConstants.O_EXCL |
        (typeof fsConstants.O_NOFOLLOW === 'number' ? fsConstants.O_NOFOLLOW : 0)
    );
    const opened = await handle.stat();
    openedIdentity = fileIdentity(opened);
    if (!opened.isFile()) throw new CreativeStudioMediaError('storage_error');
    await assertVerifiedDirectories(directories);
    const beforeWritePath = await regularFile(filePath);
    const beforeWriteIdentity = fileIdentity(beforeWritePath);
    if (beforeWriteIdentity.dev !== openedIdentity.dev || beforeWriteIdentity.ino !== openedIdentity.ino) {
      throw new CreativeStudioMediaError('storage_error');
    }
    await write(handle);
    const after = await handle.stat();
    const afterIdentity = fileIdentity(after);
    if (!after.isFile() || afterIdentity.dev !== openedIdentity.dev || afterIdentity.ino !== openedIdentity.ino) {
      throw new CreativeStudioMediaError('storage_error');
    }
    await assertVerifiedDirectories(directories);
    const afterWritePath = await regularFile(filePath);
    const afterWritePathIdentity = fileIdentity(afterWritePath);
    if (afterWritePathIdentity.dev !== openedIdentity.dev || afterWritePathIdentity.ino !== openedIdentity.ino) {
      throw new CreativeStudioMediaError('storage_error');
    }
  } catch (error) {
    await closeHandle();
    if (openedIdentity !== null) await unlinkIfIdentityMatches(filePath, openedIdentity);
    if (error instanceof CreativeStudioMediaError) throw error;
    throw new CreativeStudioMediaError('storage_error');
  } finally {
    await closeHandle();
  }
};

const sniff = (bytes: Buffer): (typeof MIME_SIGNATURES)[number] | null =>
  MIME_SIGNATURES.find((signature) => signature.match(bytes)) ?? null;

const mapStoreError = (error: unknown): never => {
  if (error instanceof CreativeStudioStoreError) throw error;
  if (error instanceof CreativeStudioMediaError) throw error;
  throw new CreativeStudioMediaError('storage_error');
};

/** Persists references in a project-owned collection; source paths never become manifest data. */
export const createStudioMediaStore = (deps: StudioMediaStoreDeps): StudioMediaStore => {
  const createId = deps.createId ?? (() => randomUUID().replaceAll('-', '_'));
  const now = deps.now ?? (() => new Date().toISOString());
  const getAvailableDiskBytes = deps.getAvailableDiskBytes ?? getAvailableStudioDiskBytes;
  const limits: StudioMediaLimits = { ...STUDIO_MEDIA_LIMITS, ...deps.limits };
  if (Object.values(limits).some((limit) => !Number.isSafeInteger(limit) || limit < 1)) {
    throw new CreativeStudioMediaError('storage_error');
  }

  type WriteCapacity = {
    maxBytes: number;
    overflowCode: 'invalid_media' | 'storage_error';
  };

  const planWriteCapacity = async (
    project: { assets: Record<string, StudioAsset> },
    directory: string,
    perAssetMaxBytes: number,
    declaredBytes?: number
  ): Promise<WriteCapacity> => {
    if (declaredBytes !== undefined && (!Number.isSafeInteger(declaredBytes) || declaredBytes < 0)) {
      throw new CreativeStudioMediaError('invalid_media');
    }
    const used = Object.values(project.assets).reduce((total, asset) => total + asset.byteSize, 0);
    const projectRemaining = limits.projectMaxBytes - used;
    if (projectRemaining <= 0) throw new CreativeStudioMediaError('invalid_media');
    const reportedDiskBytes = await getAvailableDiskBytes(directory);
    if (!Number.isFinite(reportedDiskBytes) || reportedDiskBytes < 0) {
      throw new CreativeStudioMediaError('storage_error');
    }
    const availableDiskBytes = Math.min(Math.floor(reportedDiskBytes), Number.MAX_SAFE_INTEGER);
    if (availableDiskBytes <= 0) throw new CreativeStudioMediaError('storage_error');
    if (declaredBytes !== undefined && (declaredBytes > perAssetMaxBytes || declaredBytes > projectRemaining)) {
      throw new CreativeStudioMediaError('invalid_media');
    }
    if (declaredBytes !== undefined && declaredBytes > availableDiskBytes) {
      throw new CreativeStudioMediaError('storage_error');
    }
    const nonDiskCeiling = Math.min(perAssetMaxBytes, projectRemaining);
    return {
      maxBytes: Math.min(nonDiskCeiling, availableDiskBytes),
      overflowCode: availableDiskBytes <= nonDiskCeiling ? 'storage_error' : 'invalid_media',
    };
  };

  const importReferenceFromPath = async (input: InternalImportReferenceInput): Promise<StudioAsset> => {
    if (!SAFE_ID.test(input.projectId) || (!SAFE_ID.test(input.sceneId ?? '') && input.sceneId !== undefined)) {
      throw new CreativeStudioMediaError('invalid_media');
    }
    if (
      !Number.isSafeInteger(input.expectedRevision) ||
      input.expectedRevision < 1 ||
      typeof input.sourcePath !== 'string'
    ) {
      throw new CreativeStudioMediaError('invalid_media');
    }
    const assetId = createId();
    if (!SAFE_ID.test(assetId)) throw new CreativeStudioMediaError('storage_error');

    let partPath: string | null = null;
    let finalPath: string | null = null;
    let finalIdentity: FileIdentity | null = null;
    try {
      await regularFile(input.sourcePath);
      const sourceStats = await fs.stat(input.sourcePath);
      const projectDir = await deps.store.getVerifiedProjectDirectory(input.projectId);
      const project = await deps.store.getProject(input.projectId);
      if (projectDir === null || project === null) throw new CreativeStudioMediaError('not_found');
      if (project.revision !== input.expectedRevision) throw new CreativeStudioMediaError('stale_project');
      if (input.sceneId !== undefined && !Object.hasOwn(project.scenes, input.sceneId)) {
        throw new CreativeStudioMediaError('not_found');
      }
      const capacity = await planWriteCapacity(project, projectDir, limits.referenceMaxBytes, sourceStats.size);
      const partsDir = await ensureManagedDirectory(projectDir, 'parts');
      const importsDir = await ensureManagedDirectory(projectDir, 'imports');
      partPath = path.join(partsDir, `${assetId}.part`);
      if (path.dirname(partPath) !== partsDir) throw new CreativeStudioMediaError('storage_error');

      const hash = createHash('sha256');
      let byteSize = 0;
      let sample = Buffer.alloc(0);
      const checker = new Transform({
        transform(chunk: Buffer, _encoding, callback) {
          byteSize += chunk.length;
          if (byteSize > capacity.maxBytes) {
            callback(new CreativeStudioMediaError(capacity.overflowCode));
            return;
          }
          hash.update(chunk);
          if (sample.length < 32) sample = Buffer.concat([sample, chunk]).subarray(0, 32);
          callback(null, chunk);
        },
      });
      await pipeline(
        await openVerifiedReadStream(input.sourcePath),
        checker,
        createWriteStream(partPath, { flags: 'wx' })
      );
      await regularFile(partPath);
      const signature = sniff(sample);
      if (signature === null || !signature.mimeType.startsWith('image/')) {
        throw new CreativeStudioMediaError('invalid_media');
      }
      finalPath = path.join(importsDir, `${assetId}.${signature.extension}`);
      if (path.dirname(finalPath) !== importsDir) throw new CreativeStudioMediaError('storage_error');
      finalIdentity = await finalizeManagedPart(partPath, partsDir, finalPath, importsDir);
      partPath = null;

      const asset: StudioAsset = {
        id: assetId,
        projectId: input.projectId,
        sceneId: input.sceneId ?? null,
        mediaKind: 'image',
        mimeType: signature.mimeType,
        managedAsset: { collection: 'imports', fileName: `${assetId}.${signature.extension}` },
        byteSize,
        sha256: hash.digest('hex'),
        createdAt: now(),
      };
      await deps.store.updateProject(
        input.projectId,
        (current) => {
          const next = structuredClone(current);
          next.assets[asset.id] = asset;
          if (asset.sceneId !== null) {
            const scene = next.scenes[asset.sceneId];
            scene.assetIds.push(asset.id);
            scene.referenceAssetId = asset.id;
          }
          return next;
        },
        input.expectedRevision
      );
      return asset;
    } catch (error) {
      if (partPath !== null) await fs.rm(partPath, { force: true }).catch((): undefined => undefined);
      if (finalPath !== null && finalIdentity !== null) {
        await unlinkIfIdentityMatches(finalPath, finalIdentity);
      }
      return mapStoreError(error);
    }
  };

  const cleanupOrphanParts = async (): Promise<void> => {
    const projects = await deps.store.listProjects();
    for (const project of projects) {
      const projectDir = await deps.store.getVerifiedProjectDirectory(project.id);
      if (projectDir === null) continue;
      const partsDir = path.join(projectDir, 'parts');
      try {
        const stats = await fs.lstat(partsDir);
        if (!stats.isDirectory() || stats.isSymbolicLink() || (await fs.realpath(partsDir)) !== partsDir) continue;
        const entries = await fs.readdir(partsDir, { withFileTypes: true });
        await Promise.all(
          entries
            .filter((entry) => entry.name.endsWith('.part'))
            .map(async (entry) => {
              const target = path.join(partsDir, entry.name);
              const targetStats = await fs.lstat(target);
              if (targetStats.isFile() && !targetStats.isSymbolicLink()) await fs.rm(target);
            })
        );
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw new CreativeStudioMediaError('storage_error');
      }
    }
  };

  const resolveAsset = async (
    projectId: string,
    assetId: string
  ): Promise<{
    asset: StudioAsset;
    openVerifiedStream: (start?: number, end?: number) => Promise<Readable>;
  } | null> => {
    if (!SAFE_ID.test(projectId) || !SAFE_ID.test(assetId)) return null;
    try {
      const [projectDir, project] = await Promise.all([
        deps.store.getVerifiedProjectDirectory(projectId),
        deps.store.getProject(projectId),
      ]);
      const asset = project?.assets[assetId];
      if (!projectDir || !asset || asset.projectId !== projectId) return null;
      if (!['assets', 'imports', 'thumbnails'].includes(asset.managedAsset.collection)) return null;
      if (!/^[A-Za-z0-9_-]+\.(?:jpg|png|webp|mp4|webm)$/.test(asset.managedAsset.fileName)) return null;
      const collectionDir = path.join(projectDir, asset.managedAsset.collection);
      if (path.dirname(collectionDir) !== projectDir) return null;
      const dirStats = await fs.lstat(collectionDir);
      if (!dirStats.isDirectory() || dirStats.isSymbolicLink() || (await fs.realpath(collectionDir)) !== collectionDir)
        return null;
      const filePath = path.join(collectionDir, asset.managedAsset.fileName);
      if (path.dirname(filePath) !== collectionDir) return null;
      const pathStats = await regularFile(filePath);
      if ((await fs.realpath(filePath)) !== filePath) return null;
      const stats = await fs.stat(filePath);
      if (stats.size !== asset.byteSize) return null;
      const verifier = createHash('sha256');
      let sample = Buffer.alloc(0);
      for await (const chunk of await openVerifiedReadStream(filePath)) {
        const bytes = Buffer.from(chunk);
        verifier.update(bytes);
        if (sample.length < 32) sample = Buffer.concat([sample, bytes]).subarray(0, 32);
      }
      const signature = sniff(sample);
      if (verifier.digest('hex') !== asset.sha256 || !signature || signature.mimeType !== asset.mimeType) return null;
      const after = await fs.lstat(filePath);
      const pathIdentity = fileIdentity(pathStats);
      const afterIdentity = fileIdentity(after);
      if (pathIdentity.dev !== afterIdentity.dev || pathIdentity.ino !== afterIdentity.ino) return null;
      const expectation: VerifiedReadExpectation = {
        ...pathIdentity,
        byteSize: asset.byteSize,
        sha256: asset.sha256,
        mimeType: asset.mimeType,
      };
      return {
        asset,
        openVerifiedStream: (start, end) => openVerifiedReadStream(filePath, start, end, undefined, expectation),
      };
    } catch {
      return null;
    }
  };

  const resolveProviderInput = async (
    projectId: string,
    assetId: string
  ): Promise<{
    assetId: string;
    mimeType: 'image/jpeg' | 'image/png' | 'image/webp';
    byteSize: number;
    openStream: () => Promise<Readable>;
    asDataUrl: (maxBytes: number) => Promise<string>;
  }> => {
    const resolved = await resolveAsset(projectId, assetId);
    if (!resolved || !['image/jpeg', 'image/png', 'image/webp'].includes(resolved.asset.mimeType)) {
      throw new CreativeStudioMediaError('invalid_media');
    }
    const mimeType = resolved.asset.mimeType as 'image/jpeg' | 'image/png' | 'image/webp';
    return {
      assetId,
      mimeType,
      byteSize: resolved.asset.byteSize,
      openStream: () => resolved.openVerifiedStream(),
      asDataUrl: async (maxBytes) => {
        if (!Number.isSafeInteger(maxBytes) || maxBytes < resolved.asset.byteSize) {
          throw new CreativeStudioMediaError('invalid_media');
        }
        const chunks: Buffer[] = [];
        for await (const chunk of await resolved.openVerifiedStream()) chunks.push(Buffer.from(chunk));
        const bytes = Buffer.concat(chunks);
        if (bytes.length !== resolved.asset.byteSize) throw new CreativeStudioMediaError('invalid_media');
        return `data:${mimeType};base64,${bytes.toString('base64')}`;
      },
    };
  };

  type ProviderOutputMetadata = Omit<PersistProviderOutputInput, 'body'>;
  type ProviderJobOutputMetadata = Omit<PersistProviderJobOutputInput, 'body'>;
  type ProviderJobPosterMetadata = Omit<PersistProviderJobPosterInput, 'body'>;
  type ProviderWritePlan = {
    projectDir: string;
    project: StudioProject;
    capacity: WriteCapacity;
    collection: 'assets' | 'thumbnails';
  };

  const validateProviderOutputMetadata = (
    input: ProviderOutputMetadata | ProviderJobOutputMetadata,
    requireExpectedRevision: boolean
  ): void => {
    if (
      !SAFE_ID.test(input.projectId) ||
      !SAFE_ID.test(input.sceneId) ||
      (input.mediaKind !== 'image' && input.mediaKind !== 'video') ||
      typeof input.declaredMimeType !== 'string'
    ) {
      throw new CreativeStudioMediaError('invalid_media');
    }
    if (
      requireExpectedRevision &&
      (!('expectedRevision' in input) || !Number.isSafeInteger(input.expectedRevision) || input.expectedRevision < 1)
    ) {
      throw new CreativeStudioMediaError('invalid_media');
    }
    if ('jobId' in input && !SAFE_ID.test(input.jobId)) throw new CreativeStudioMediaError('invalid_media');
    if (
      (input.width !== undefined && (!Number.isSafeInteger(input.width) || input.width < 1)) ||
      (input.height !== undefined && (!Number.isSafeInteger(input.height) || input.height < 1)) ||
      (input.durationSeconds !== undefined &&
        (!Number.isSafeInteger(input.durationSeconds) || input.durationSeconds < 1))
    ) {
      throw new CreativeStudioMediaError('invalid_media');
    }
    if (
      input.declaredByteSize !== undefined &&
      (!Number.isSafeInteger(input.declaredByteSize) || input.declaredByteSize < 0)
    ) {
      throw new CreativeStudioMediaError('invalid_media');
    }
  };

  const prepareProviderWrite = async (input: ProviderOutputMetadata): Promise<ProviderWritePlan> => {
    validateProviderOutputMetadata(input, true);
    const [projectDir, project] = await Promise.all([
      deps.store.getVerifiedProjectDirectory(input.projectId),
      deps.store.getProject(input.projectId),
    ]);
    if (!projectDir || !project || project.revision !== input.expectedRevision || !project.scenes[input.sceneId]) {
      throw new CreativeStudioMediaError(project?.revision !== input.expectedRevision ? 'stale_project' : 'not_found');
    }
    const perAssetMaxBytes = input.mediaKind === 'video' ? limits.videoOutputMaxBytes : limits.imageOutputMaxBytes;
    return {
      projectDir,
      project,
      capacity: await planWriteCapacity(project, projectDir, perAssetMaxBytes, input.declaredByteSize),
      collection: 'assets',
    };
  };

  const prepareProviderJobWrite = async (input: ProviderJobOutputMetadata): Promise<ProviderWritePlan> => {
    validateProviderOutputMetadata(input, false);
    const [projectDir, project] = await Promise.all([
      deps.store.getVerifiedProjectDirectory(input.projectId),
      deps.store.getProject(input.projectId),
    ]);
    const job = project?.jobs[input.jobId];
    if (project?.scenes[input.sceneId] && project.scenes[input.sceneId].mediaKind !== input.mediaKind) {
      throw new CreativeStudioMediaError('invalid_media');
    }
    const active =
      job?.status === 'submitting' ||
      job?.status === 'running' ||
      (job?.status === 'failed' && job.error?.code === 'download_failed');
    if (
      !projectDir ||
      !project ||
      !project.scenes[input.sceneId] ||
      project.scenes[input.sceneId].mediaKind !== input.mediaKind ||
      !job ||
      job.sceneId !== input.sceneId ||
      !active
    ) {
      throw new CreativeStudioMediaError(project && job ? 'job_inactive' : 'not_found');
    }
    const perAssetMaxBytes = input.mediaKind === 'video' ? limits.videoOutputMaxBytes : limits.imageOutputMaxBytes;
    return {
      projectDir,
      project,
      capacity: await planWriteCapacity(project, projectDir, perAssetMaxBytes, input.declaredByteSize),
      collection: 'assets',
    };
  };

  const validateProviderPosterLineage = (
    project: StudioProject,
    input: ProviderJobPosterMetadata
  ): { scene: StudioProject['scenes'][string]; job: StudioProject['jobs'][string] } => {
    const scene = project.scenes[input.sceneId];
    const job = project.jobs[input.jobId];
    if (!scene || !job) throw new CreativeStudioMediaError('not_found');
    if (scene.mediaKind !== 'video') throw new CreativeStudioMediaError('invalid_media');
    if (job.status !== 'succeeded') throw new CreativeStudioMediaError('job_inactive');
    const primary = project.assets[input.primaryAssetId];
    if (
      !primary ||
      primary.projectId !== input.projectId ||
      primary.sceneId !== input.sceneId ||
      primary.mediaKind !== 'video' ||
      primary.managedAsset.collection !== 'assets'
    ) {
      throw new CreativeStudioMediaError('job_inactive');
    }
    if (
      job.projectId !== input.projectId ||
      job.sceneId !== input.sceneId ||
      job.outputAssetIds.length !== 1 ||
      job.outputAssetIds[0] !== input.primaryAssetId ||
      !scene.assetIds.includes(input.primaryAssetId)
    ) {
      throw new CreativeStudioMediaError('job_inactive');
    }
    return { scene, job };
  };

  const prepareProviderPosterWrite = async (input: ProviderJobPosterMetadata): Promise<ProviderWritePlan> => {
    validateProviderOutputMetadata({ ...input, mediaKind: 'image' }, false);
    if (!SAFE_ID.test(input.primaryAssetId) || !input.declaredMimeType.startsWith('image/')) {
      throw new CreativeStudioMediaError('invalid_media');
    }
    const [projectDir, project] = await Promise.all([
      deps.store.getVerifiedProjectDirectory(input.projectId),
      deps.store.getProject(input.projectId),
    ]);
    if (!projectDir || !project) throw new CreativeStudioMediaError('not_found');
    validateProviderPosterLineage(project, input);
    return {
      projectDir,
      project,
      capacity: await planWriteCapacity(project, projectDir, limits.imageOutputMaxBytes, input.declaredByteSize),
      collection: 'thumbnails',
    };
  };

  type ProviderStreamInput = PersistProviderOutputInput | PersistProviderJobOutputInput;

  const persistProviderOutputWithPlan = async (
    input: ProviderStreamInput,
    plan: ProviderWritePlan,
    commit: (asset: StudioAsset) => Promise<void>
  ): Promise<StudioAsset> => {
    const assetId = createId();
    if (!SAFE_ID.test(assetId)) throw new CreativeStudioMediaError('storage_error');
    let partPath: string | null = null;
    let finalPath: string | null = null;
    let finalIdentity: FileIdentity | null = null;
    try {
      const partsDir = await ensureManagedDirectory(plan.projectDir, 'parts');
      const collectionDir = await ensureManagedDirectory(plan.projectDir, plan.collection);
      partPath = path.join(partsDir, `${assetId}.part`);
      const writer = createWriteStream(partPath, { flags: 'wx' });
      const hash = createHash('sha256');
      let byteSize = 0;
      let sample = Buffer.alloc(0);
      const checker = new Transform({
        transform(chunk: Buffer, _encoding, callback) {
          byteSize += chunk.length;
          if (byteSize > plan.capacity.maxBytes) {
            return callback(new CreativeStudioMediaError(plan.capacity.overflowCode));
          }
          hash.update(chunk);
          if (sample.length < 32) sample = Buffer.concat([sample, chunk]).subarray(0, 32);
          callback(null, chunk);
        },
      });
      await pipeline(Readable.from(input.body), checker, writer);
      if (input.declaredByteSize !== undefined && byteSize !== input.declaredByteSize) {
        throw new CreativeStudioMediaError('invalid_media');
      }
      const signature = sniff(sample);
      const signatureKind = signature?.mimeType.startsWith('video/') ? 'video' : 'image';
      if (!signature || signature.mimeType !== input.declaredMimeType || input.mediaKind !== signatureKind) {
        throw new CreativeStudioMediaError('invalid_media');
      }
      finalPath = path.join(collectionDir, `${assetId}.${signature.extension}`);
      finalIdentity = await finalizeManagedPart(partPath, partsDir, finalPath, collectionDir);
      partPath = null;
      const asset: StudioAsset = {
        id: assetId,
        projectId: input.projectId,
        sceneId: input.sceneId,
        mediaKind: input.mediaKind,
        mimeType: signature.mimeType,
        managedAsset: { collection: plan.collection, fileName: `${assetId}.${signature.extension}` },
        byteSize,
        sha256: hash.digest('hex'),
        ...(input.width === undefined ? {} : { width: input.width }),
        ...(input.height === undefined ? {} : { height: input.height }),
        ...(input.durationSeconds === undefined ? {} : { durationSeconds: input.durationSeconds }),
        createdAt: now(),
      };
      await commit(asset);
      return asset;
    } catch (error) {
      if (partPath) await fs.rm(partPath, { force: true }).catch((): undefined => undefined);
      if (finalPath !== null && finalIdentity !== null) {
        await unlinkIfIdentityMatches(finalPath, finalIdentity);
      }
      return mapStoreError(error);
    }
  };

  const commitProviderAsset = async (input: ProviderOutputMetadata, asset: StudioAsset): Promise<void> => {
    await deps.store.updateProject(
      input.projectId,
      (current) => {
        const next = structuredClone(current);
        next.assets[asset.id] = asset;
        next.scenes[input.sceneId].assetIds.push(asset.id);
        return next;
      },
      input.expectedRevision
    );
  };

  const persistProviderOutput = async (input: PersistProviderOutputInput): Promise<StudioAsset> => {
    const plan = await prepareProviderWrite(input);
    return persistProviderOutputWithPlan(input, plan, (asset) => commitProviderAsset(input, asset));
  };

  const commitProviderJobAsset = async (input: ProviderJobOutputMetadata, asset: StudioAsset): Promise<void> => {
    await deps.store.updateProject(input.projectId, (current) => {
      const job = current.jobs[input.jobId];
      const scene = current.scenes[input.sceneId];
      const active =
        job?.status === 'submitting' ||
        job?.status === 'running' ||
        (job?.status === 'failed' && job.error?.code === 'download_failed');
      if (!job || !scene || scene.mediaKind !== input.mediaKind || job.sceneId !== input.sceneId || !active) {
        throw new CreativeStudioMediaError('job_inactive');
      }
      const usedBytes = Object.values(current.assets).reduce((total, candidate) => total + candidate.byteSize, 0);
      if (usedBytes + asset.byteSize > limits.projectMaxBytes) {
        throw new CreativeStudioMediaError('invalid_media');
      }
      current.assets[asset.id] = asset;
      scene.assetIds.push(asset.id);
      scene.selectedAssetId = asset.id;
      scene.reviewState = 'complete';
      job.status = 'succeeded';
      job.outputAssetIds = [asset.id];
      job.error = null;
      delete job.progress;
      job.updatedAt = now();
      return current;
    });
  };

  const persistProviderOutputForJob = async (input: PersistProviderJobOutputInput): Promise<StudioAsset> =>
    persistProviderOutputWithPlan(input, await prepareProviderJobWrite(input), (asset) =>
      commitProviderJobAsset(input, asset)
    );

  const commitProviderJobPoster = async (input: ProviderJobPosterMetadata, posterAsset: StudioAsset): Promise<void> => {
    await deps.store.updateProject(input.projectId, (current) => {
      const { scene, job } = validateProviderPosterLineage(current, input);
      if (posterAsset.mediaKind !== 'image' || posterAsset.managedAsset.collection !== 'thumbnails') {
        throw new CreativeStudioMediaError('invalid_media');
      }
      const usedBytes = Object.values(current.assets).reduce((total, candidate) => total + candidate.byteSize, 0);
      if (usedBytes + posterAsset.byteSize > limits.projectMaxBytes) {
        throw new CreativeStudioMediaError('invalid_media');
      }
      current.assets[posterAsset.id] = posterAsset;
      scene.assetIds.push(posterAsset.id);
      job.outputAssetIds.push(posterAsset.id);
      job.updatedAt = now();
      return current;
    });
  };

  const persistProviderPosterForJob = async (input: PersistProviderJobPosterInput): Promise<StudioAsset> => {
    const plan = await prepareProviderPosterWrite(input);
    return persistProviderOutputWithPlan({ ...input, mediaKind: 'image' }, plan, (asset) =>
      commitProviderJobPoster(input, asset)
    );
  };

  /** Pipes the single SSRF-safe downloader into the same managed `.part` persistence path without buffering media. */
  const persistProviderOutputFromUrlWithPlan = async (
    input: PersistProviderOutputUrlInput | PersistProviderJobOutputUrlInput,
    plan: ProviderWritePlan,
    persistBody: (body: AsyncIterable<Uint8Array>) => Promise<StudioAsset>
  ): Promise<StudioAsset> => {
    const stream = new PassThrough();
    stream.on('error', (): undefined => undefined);
    const controller = new AbortController();
    const abortFromCaller = (): void => controller.abort();
    input.downloader.signal?.addEventListener('abort', abortFromCaller, { once: true });
    if (input.downloader.signal?.aborted) controller.abort();
    const persist = persistBody(stream);
    const download = (async () => {
      const result = await downloadRemoteMedia(input.url, {
        ...input.downloader,
        signal: controller.signal,
        maxBytes: plan.capacity.maxBytes,
        write: async (chunk) => {
          if (stream.destroyed) throw new CreativeStudioMediaError('storage_error');
          if (stream.write(chunk)) return;
          await new Promise<void>((resolve, reject) => {
            const cleanup = (): void => {
              stream.off('drain', onDrain);
              stream.off('error', onError);
              stream.off('close', onClose);
            };
            const onDrain = (): void => {
              cleanup();
              resolve();
            };
            const onError = (error: Error): void => {
              cleanup();
              reject(error);
            };
            const onClose = (): void => {
              cleanup();
              reject(new CreativeStudioMediaError('storage_error'));
            };
            stream.once('drain', onDrain);
            stream.once('error', onError);
            stream.once('close', onClose);
            if (stream.destroyed) onClose();
          });
        },
      });
      if (result.contentType === null || result.contentType !== input.declaredMimeType) {
        throw new CreativeStudioMediaError('invalid_media');
      }
      stream.end();
      return result;
    })();
    void persist.catch((): undefined => undefined);
    void download.catch((): undefined => undefined);
    try {
      const [asset] = await Promise.all([persist, download]);
      return asset;
    } catch (error) {
      controller.abort();
      stream.destroy(error instanceof Error ? error : new Error('remote_media_failed'));
      await Promise.allSettled([persist, download]);
      throw error;
    } finally {
      input.downloader.signal?.removeEventListener('abort', abortFromCaller);
    }
  };

  const persistProviderOutputFromUrl = async (input: PersistProviderOutputUrlInput): Promise<StudioAsset> => {
    const plan = await prepareProviderWrite(input);
    return persistProviderOutputFromUrlWithPlan(input, plan, (body) =>
      persistProviderOutputWithPlan({ ...input, body }, plan, (asset) => commitProviderAsset(input, asset))
    );
  };

  const persistProviderOutputFromUrlForJob = async (input: PersistProviderJobOutputUrlInput): Promise<StudioAsset> => {
    const plan = await prepareProviderJobWrite(input);
    return persistProviderOutputFromUrlWithPlan(input, plan, (body) =>
      persistProviderOutputWithPlan({ ...input, body }, plan, (asset) => commitProviderJobAsset(input, asset))
    );
  };

  const persistProviderPosterFromUrlForJob = async (input: PersistProviderJobPosterUrlInput): Promise<StudioAsset> => {
    const plan = await prepareProviderPosterWrite(input);
    const normalized = { ...input, mediaKind: 'image' as const };
    return persistProviderOutputFromUrlWithPlan(normalized, plan, (body) =>
      persistProviderOutputWithPlan({ ...normalized, body }, plan, (asset) => commitProviderJobPoster(input, asset))
    );
  };

  const exportAssetsToDirectory = async (
    input: InternalExportStudioAssetsInput
  ): Promise<InternalStudioExportResult> => {
    if (!SAFE_ID.test(input.projectId) || typeof input.destinationDirectory !== 'string') {
      throw new CreativeStudioMediaError('invalid_media');
    }
    const project = await deps.store.getProject(input.projectId);
    if (!project) throw new CreativeStudioMediaError('not_found');
    const timestamp = input.timestamp ?? new Date().toISOString().replace(/[-:]/g, '').slice(0, 15).replace('T', '-');
    const { directory, folderName, identity } = await acquireStudioExportDirectory(
      input.destinationDirectory,
      project.name,
      timestamp
    );
    const verifiedExportDirectory: VerifiedDirectory = { directory, identity };
    const exported: Array<{ assetId: string; fileName: string }> = [];
    const missingSceneIds: string[] = [];
    for (const [index, sceneId] of project.sceneOrder.entries()) {
      const selected = project.scenes[sceneId].selectedAssetId;
      const resolved = selected ? await resolveAsset(input.projectId, selected) : null;
      if (!resolved) {
        missingSceneIds.push(sceneId);
        continue;
      }
      const extension = path.extname(resolved.asset.managedAsset.fileName).toLowerCase();
      const fileName = `scene-${String(index + 1).padStart(2, '0')}${extension}`;
      await writeVerifiedExportFile(path.join(directory, fileName), verifiedExportDirectory, [], async (handle) => {
        await pipeline(
          await resolved.openVerifiedStream(),
          createWriteStream(path.join(directory, fileName), { fd: handle.fd, autoClose: false })
        );
      });
      exported.push({ assetId: resolved.asset.id, fileName });
    }
    if (input.includeReferences) {
      const verifiedReferenceDirectory = await createVerifiedExportSubdirectory(verifiedExportDirectory, 'references');
      for (const referenceAsset of Object.values(project.assets).filter(
        (candidate) => candidate.managedAsset.collection === 'imports'
      )) {
        const resolved = await resolveAsset(input.projectId, referenceAsset.id);
        if (!resolved) continue;
        const fileName = resolved.asset.managedAsset.fileName;
        await writeVerifiedExportFile(
          path.join(verifiedReferenceDirectory.directory, fileName),
          verifiedReferenceDirectory,
          [verifiedExportDirectory],
          async (handle) => {
            await pipeline(
              await resolved.openVerifiedStream(),
              createWriteStream(path.join(verifiedReferenceDirectory.directory, fileName), {
                fd: handle.fd,
                autoClose: false,
              })
            );
          }
        );
        exported.push({ assetId: referenceAsset.id, fileName: `references/${fileName}` });
      }
    }
    const storyboard = {
      schemaVersion: 1,
      id: project.id,
      name: project.name,
      brief: project.brief,
      aspectRatio: project.aspectRatio,
      targetDurationSeconds: project.targetDurationSeconds,
      resolution: project.resolution,
      sceneOrder: project.sceneOrder,
      scenes: project.sceneOrder.map((sceneId) => {
        const scene = project.scenes[sceneId];
        return {
          id: scene.id,
          title: scene.title,
          purpose: scene.purpose,
          visualPrompt: scene.visualPrompt,
          narration: scene.narration,
          onScreenText: scene.onScreenText,
          mediaKind: scene.mediaKind,
          durationSeconds: scene.durationSeconds,
          selectedAssetId: scene.selectedAssetId,
        };
      }),
    };
    await writeVerifiedExportFile(
      path.join(directory, 'storyboard.json'),
      verifiedExportDirectory,
      [],
      async (handle) => {
        await handle.writeFile(JSON.stringify(storyboard, null, 2), { encoding: 'utf8' });
      }
    );
    return { folderName, exported, missingSceneIds };
  };

  return {
    importReferenceFromPath,
    persistProviderOutput,
    persistProviderOutputFromUrl,
    persistProviderOutputForJob,
    persistProviderOutputFromUrlForJob,
    persistProviderPosterForJob,
    persistProviderPosterFromUrlForJob,
    resolveAsset,
    resolveProviderInput,
    exportAssetsToDirectory,
    cleanupOrphanParts,
  };
};
