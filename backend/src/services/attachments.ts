import { mkdir, readFile, readdir, rm, stat, writeFile } from 'fs/promises';
import path from 'path';

import { logger } from '../utils/logger';

import { getRedis, registerRedisExpiredKeyHandler } from './redis';

import type { AttachmentManifest, UploadSession } from '../types';

const ATTACHMENTS_STORAGE_PATH = path.resolve(
  process.env['ATTACHMENTS_STORAGE_PATH'] ?? path.join(process.cwd(), 'data', 'attachments')
);
const ATTACHMENTS_TTL_SECONDS = Number(process.env['ATTACHMENTS_TTL_SECONDS'] ?? 604800);
const ATTACHMENTS_ENABLED = process.env['ATTACHMENTS_ENABLED'] !== 'false';
const ATTACHMENTS_CLEANUP_SWEEP_ENABLED = process.env['ATTACHMENTS_CLEANUP_SWEEP_ENABLED'] !== 'false';
const ATTACHMENTS_CLEANUP_SWEEP_INTERVAL_MS = Number(process.env['ATTACHMENTS_CLEANUP_SWEEP_INTERVAL_MS'] ?? 900000);
const ATTACHMENTS_CLEANUP_SWEEP_BATCH_SIZE = Number(process.env['ATTACHMENTS_CLEANUP_SWEEP_BATCH_SIZE'] ?? 50);
const UUID_V4_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

const REDIS_KEYS = {
  uploadSession: (uploadId: string) => `attachments:uploadSession:${uploadId}`,
  uploadAttachmentIndex: (uploadId: string) => `attachments:uploadAttachment:${uploadId}`,
  attachmentUploadIndex: (attachmentId: string) => `attachments:attachmentUpload:${attachmentId}`,
  attachmentManifest: (attachmentId: string) => `attachments:manifest:${attachmentId}`,
  attachmentCleanupLease: (attachmentId: string) => `attachments:cleanup:${attachmentId}`
};

const REDIS_KEY_PREFIXES = {
  attachmentManifest: 'attachments:manifest:',
  attachmentCleanupLease: 'attachments:cleanup:'
};

let attachmentExpirationCleanupInitialized = false;
let attachmentCleanupSweeperInitialized = false;

const toPositiveTtlSeconds = (expiresAt: number): number => {
  const ttl = Math.ceil((expiresAt - Date.now()) / 1000);
  return Math.max(1, ttl);
};

const isUuidV4 = (value: string): boolean => UUID_V4_PATTERN.test(value);

const assertUuidV4 = (value: string, label: string): string => {
  if (!isUuidV4(value)) 
    throw new Error(`Invalid ${label}`);

  return value;
};

const assertChunkIndex = (chunkIndex: number): number => {
  if (!Number.isSafeInteger(chunkIndex) || chunkIndex < 0) 
    throw new Error('Invalid attachment chunk index');

  return chunkIndex;
};

const resolveAttachmentStoragePath = (...segments: string[]): string => {
  const resolvedPath = path.resolve(ATTACHMENTS_STORAGE_PATH, ...segments);
  const relativePath = path.relative(ATTACHMENTS_STORAGE_PATH, resolvedPath);
  if (relativePath.startsWith('..') || path.isAbsolute(relativePath)) 
    throw new Error('Attachment storage path escaped its root');

  return resolvedPath;
};

const chunkDirectory = (attachmentId: string): string =>
  resolveAttachmentStoragePath(assertUuidV4(attachmentId, 'attachment id'), 'chunks');

const attachmentDirectory = (attachmentId: string): string =>
  resolveAttachmentStoragePath(assertUuidV4(attachmentId, 'attachment id'));

const chunkPath = (attachmentId: string, chunkIndex: number): string =>
  resolveAttachmentStoragePath(
    assertUuidV4(attachmentId, 'attachment id'),
    'chunks',
    `${assertChunkIndex(chunkIndex)}.bin`
  );

const ensureChunkDirectory = async (attachmentId: string): Promise<void> => {
  // eslint-disable-next-line security/detect-non-literal-fs-filename -- Path is UUID-scoped and confined by resolveAttachmentStoragePath.
  await mkdir(chunkDirectory(attachmentId), { recursive: true });
};

const getAttachmentIdFromExpiredRedisKey = (redisKey: string): string | null => {
  if (redisKey.startsWith(REDIS_KEY_PREFIXES.attachmentManifest)) {
    const attachmentId = redisKey.slice(REDIS_KEY_PREFIXES.attachmentManifest.length);
    return isUuidV4(attachmentId) ? attachmentId : null;
  }

  if (redisKey.startsWith(REDIS_KEY_PREFIXES.attachmentCleanupLease)) {
    const attachmentId = redisKey.slice(REDIS_KEY_PREFIXES.attachmentCleanupLease.length);
    return isUuidV4(attachmentId) ? attachmentId : null;
  }

  return null;
};

const hasAttachmentCleanupLease = async (attachmentId: string): Promise<boolean> => {
  const redis = getRedis();
  const exists = await redis.exists(REDIS_KEYS.attachmentCleanupLease(attachmentId));
  return exists === 1;
};

const getUploadIdByAttachmentId = async (attachmentId: string): Promise<string | null> => {
  if (!isUuidV4(attachmentId)) 
    return null;

  const redis = getRedis();
  return redis.get(REDIS_KEYS.attachmentUploadIndex(attachmentId));
};

const getAttachmentIdByUploadId = async (uploadId: string): Promise<string | null> => {
  if (!isUuidV4(uploadId)) 
    return null;

  const redis = getRedis();
  return redis.get(REDIS_KEYS.uploadAttachmentIndex(uploadId));
};

const removeAttachmentArtifacts = async (attachmentId: string, reason: string): Promise<void> => {
  const safeAttachmentId = assertUuidV4(attachmentId, 'attachment id');
  const redis = getRedis();
  const uploadId = await getUploadIdByAttachmentId(safeAttachmentId);

  const keysToDelete = [
    REDIS_KEYS.attachmentManifest(safeAttachmentId),
    REDIS_KEYS.attachmentCleanupLease(safeAttachmentId),
    REDIS_KEYS.attachmentUploadIndex(safeAttachmentId)
  ];

  if (uploadId) {
    keysToDelete.push(
      REDIS_KEYS.uploadAttachmentIndex(uploadId),
      REDIS_KEYS.uploadSession(uploadId)
    );
  }

  await redis.del(...keysToDelete);

  await rm(attachmentDirectory(safeAttachmentId), { recursive: true, force: true });

  logger.info('Attachment artifacts cleaned up', { attachmentId: safeAttachmentId, reason });
};

const removeAttachmentArtifactsIfLeaseMissing = async (
  attachmentId: string,
  reason: string
): Promise<void> => {
  if (await hasAttachmentCleanupLease(attachmentId)) 
    return;

  await removeAttachmentArtifacts(attachmentId, reason);
};

const sweepAttachmentOrphans = async (): Promise<void> => {
  let entries: Array<{ name: string; isDirectory: () => boolean }>;

  try {
    // eslint-disable-next-line security/detect-non-literal-fs-filename -- Storage root is deployment configuration and not user input.
    entries = await readdir(ATTACHMENTS_STORAGE_PATH, { withFileTypes: true });
  } catch (error) {
    const errorCode = (error as NodeJS.ErrnoException).code;
    if (errorCode === 'ENOENT') 
      return;

    logger.warn('Attachment sweeper could not read storage directory', {
      error: error instanceof Error ? error.message : 'Unknown error'
    });
    return;
  }

  const attachmentIds = entries
    .filter((entry) => entry.isDirectory() && isUuidV4(entry.name))
    .slice(0, ATTACHMENTS_CLEANUP_SWEEP_BATCH_SIZE)
    .map((entry) => entry.name);

  for (const attachmentId of attachmentIds) 
    await removeAttachmentArtifactsIfLeaseMissing(attachmentId, 'periodic-sweeper');

  if (attachmentIds.length > 0) 
    logger.debug('Attachment sweeper completed', { scanned: attachmentIds.length });
};

export const isAttachmentsEnabled = (): boolean => ATTACHMENTS_ENABLED;

export const getAttachmentsTtlSeconds = (): number => ATTACHMENTS_TTL_SECONDS;

const collectDirectoryStats = async (directoryPath: string): Promise<{ totalBytes: number; fileCount: number }> => {
  let entries: Array<{ name: string; isDirectory: () => boolean }>;

  try {
    // Security: dashboard storage stats only walks the configured attachment root and its child directory entries.
    // eslint-disable-next-line security/detect-non-literal-fs-filename
    entries = await readdir(directoryPath, { withFileTypes: true });
  } catch (error) {
    const errorCode = (error as NodeJS.ErrnoException).code;
    if (errorCode === 'ENOENT') 
      return { totalBytes: 0, fileCount: 0 };
    

    throw error;
  }

  let totalBytes = 0;
  let fileCount = 0;

  for (const entry of entries) {
    const resolvedPath = path.join(directoryPath, entry.name);
    if (entry.isDirectory()) {
      const nestedStats = await collectDirectoryStats(resolvedPath);
      totalBytes += nestedStats.totalBytes;
      fileCount += nestedStats.fileCount;
      continue;
    }

  // Security: resolvedPath is derived from a directory entry discovered under the configured attachment root.
  // eslint-disable-next-line security/detect-non-literal-fs-filename
    const fileStats = await stat(resolvedPath);
    totalBytes += fileStats.size;
    fileCount += 1;
  }

  return { totalBytes, fileCount };
};

export const getAttachmentStorageStats = async (): Promise<{
  enabled: boolean;
  rootPath: string;
  totalBytes: number;
  fileCount: number;
}> => {
  if (!ATTACHMENTS_ENABLED) {
    return {
      enabled: false,
      rootPath: ATTACHMENTS_STORAGE_PATH,
      totalBytes: 0,
      fileCount: 0
    };
  }

  const stats = await collectDirectoryStats(ATTACHMENTS_STORAGE_PATH);
  return {
    enabled: true,
    rootPath: ATTACHMENTS_STORAGE_PATH,
    totalBytes: stats.totalBytes,
    fileCount: stats.fileCount
  };
};

export const initializeAttachmentExpirationCleanup = (): void => {
  if (attachmentExpirationCleanupInitialized) 
    return;

  registerRedisExpiredKeyHandler(async (redisKey) => {
    const attachmentId = getAttachmentIdFromExpiredRedisKey(redisKey);
    if (!attachmentId) 
      return;

    await removeAttachmentArtifacts(attachmentId, `redis-expired:${redisKey}`);
  });

  attachmentExpirationCleanupInitialized = true;
};

export const initializeAttachmentCleanupSweeper = (): void => {
  if (attachmentCleanupSweeperInitialized || !ATTACHMENTS_CLEANUP_SWEEP_ENABLED) 
    return;

  attachmentCleanupSweeperInitialized = true;

  const runSweep = () => {
    void sweepAttachmentOrphans().catch((error: unknown) => {
      logger.error('Attachment sweeper failed', {
        error: error instanceof Error ? error.message : 'Unknown error'
      });
    });
  };

  runSweep();

  const timer = setInterval(runSweep, ATTACHMENTS_CLEANUP_SWEEP_INTERVAL_MS);
  timer.unref();

  logger.info('Attachment cleanup sweeper started', {
    intervalMs: ATTACHMENTS_CLEANUP_SWEEP_INTERVAL_MS,
    batchSize: ATTACHMENTS_CLEANUP_SWEEP_BATCH_SIZE
  });
};

export const setAttachmentUploadSession = async (session: UploadSession): Promise<void> => {
  const redis = getRedis();
  const key = REDIS_KEYS.uploadSession(session.uploadId);
  const ttlSeconds = toPositiveTtlSeconds(session.expiresAt);

  await redis.multi()
    .set(key, JSON.stringify(session), 'EX', ttlSeconds)
    .set(REDIS_KEYS.uploadAttachmentIndex(session.uploadId), session.attachmentId, 'EX', ttlSeconds)
    .set(REDIS_KEYS.attachmentUploadIndex(session.attachmentId), session.uploadId, 'EX', ttlSeconds)
    .set(REDIS_KEYS.attachmentCleanupLease(session.attachmentId), '1', 'EX', ttlSeconds)
    .exec();
};

export const getAttachmentUploadSession = async (uploadId: string): Promise<UploadSession | null> => {
  if (!isUuidV4(uploadId)) 
    return null;

  const redis = getRedis();
  const key = REDIS_KEYS.uploadSession(uploadId);
  const raw = await redis.get(key);
  if (!raw) 
    return null;
  
  try {
    const parsed = JSON.parse(raw) as UploadSession;
    if (!isUuidV4(parsed.uploadId) || !isUuidV4(parsed.attachmentId) || !Array.isArray(parsed.receivedChunks)) {
      await redis.del(key);
      return null;
    }

    if (parsed.expiresAt <= Date.now()) {
      await redis.del(key);
      await removeAttachmentArtifacts(parsed.attachmentId, 'upload-session-expired-lazy');
      return null;
    }

    return parsed;
  } catch (error) {
    logger.debug('Attachment upload session parse failed', {
      uploadId,
      error: error instanceof Error ? error.message : 'Unknown error'
    });
    await redis.del(key);
    return null;
  }
};

export const clearAttachmentUploadSession = async (uploadId: string): Promise<void> => {
  if (!isUuidV4(uploadId)) 
    return;

  const redis = getRedis();
  await redis.del(REDIS_KEYS.uploadSession(uploadId));
};

export const markUploadChunkReceived = async (uploadId: string, chunkIndex: number): Promise<UploadSession | null> => {
  const session = await getAttachmentUploadSession(uploadId);
  if (!session) 
    return null;

  if (!session.receivedChunks.includes(chunkIndex)) {
    session.receivedChunks = [...session.receivedChunks, chunkIndex].sort((a, b) => a - b);
    await setAttachmentUploadSession(session);
  }

  return session;
};

export const setAttachmentManifest = async (manifest: AttachmentManifest): Promise<void> => {
  assertUuidV4(manifest.uploadId, 'upload id');
  assertUuidV4(manifest.attachmentId, 'attachment id');

  const redis = getRedis();
  const key = REDIS_KEYS.attachmentManifest(manifest.attachmentId);
  const ttlSeconds = toPositiveTtlSeconds(manifest.expiresAt);

  await redis.multi()
    .set(key, JSON.stringify(manifest), 'EX', ttlSeconds)
    .set(REDIS_KEYS.uploadAttachmentIndex(manifest.uploadId), manifest.attachmentId, 'EX', ttlSeconds)
    .set(REDIS_KEYS.attachmentUploadIndex(manifest.attachmentId), manifest.uploadId, 'EX', ttlSeconds)
    .set(REDIS_KEYS.attachmentCleanupLease(manifest.attachmentId), '1', 'EX', ttlSeconds)
    .exec();
};

export const getAttachmentManifestByUploadId = async (uploadId: string): Promise<AttachmentManifest | null> => {
  const attachmentId = await getAttachmentIdByUploadId(uploadId);
  if (!attachmentId) 
    return null;

  const manifest = await getAttachmentManifest(attachmentId);
  if (!manifest) {
    const redis = getRedis();
    await redis.del(REDIS_KEYS.uploadAttachmentIndex(uploadId));
    return null;
  }

  return manifest;
};

export const clearAttachmentArtifactsByUploadId = async (
  uploadId: string,
  reason: string
): Promise<string | null> => {
  const attachmentId = await getAttachmentIdByUploadId(uploadId);
  if (attachmentId) {
    await removeAttachmentArtifacts(attachmentId, reason);
    return attachmentId;
  }

  const session = await getAttachmentUploadSession(uploadId);
  if (!session) 
    return null;

  await removeAttachmentArtifacts(session.attachmentId, reason);
  return session.attachmentId;
};

export const getAttachmentManifest = async (attachmentId: string): Promise<AttachmentManifest | null> => {
  if (!isUuidV4(attachmentId)) 
    return null;

  const redis = getRedis();
  const key = REDIS_KEYS.attachmentManifest(attachmentId);
  const raw = await redis.get(key);
  if (!raw) {
    await removeAttachmentArtifactsIfLeaseMissing(attachmentId, 'manifest-missing-lazy');
    return null;
  }

  try {
    const parsed = JSON.parse(raw) as AttachmentManifest;
    if (!isUuidV4(parsed.attachmentId) || !isUuidV4(parsed.uploadId) || parsed.attachmentId !== attachmentId) {
      await redis.del(key);
      await removeAttachmentArtifactsIfLeaseMissing(attachmentId, 'manifest-invalid-lazy');
      return null;
    }

    if (parsed.expiresAt <= Date.now()) {
      await redis.del(key);
      await removeAttachmentArtifacts(parsed.attachmentId, 'manifest-expired-lazy');
      return null;
    }

    return parsed;
  } catch (error) {
    logger.debug('Attachment manifest parse failed', {
      attachmentId,
      error: error instanceof Error ? error.message : 'Unknown error'
    });
    await redis.del(key);
    await removeAttachmentArtifactsIfLeaseMissing(attachmentId, 'manifest-parse-failed-lazy');
    return null;
  }
};

export const writeAttachmentChunk = async (
  attachmentId: string,
  chunkIndex: number,
  payload: Buffer
): Promise<void> => {
  await ensureChunkDirectory(attachmentId);
  // eslint-disable-next-line security/detect-non-literal-fs-filename -- Path is UUID-scoped and confined by resolveAttachmentStoragePath.
  await writeFile(chunkPath(attachmentId, chunkIndex), payload);
};

export const readAttachmentChunk = async (
  attachmentId: string,
  chunkIndex: number
): Promise<Buffer | null> => {
  try {
    // eslint-disable-next-line security/detect-non-literal-fs-filename -- Path is UUID-scoped and confined by resolveAttachmentStoragePath.
    return await readFile(chunkPath(attachmentId, chunkIndex));
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT')
      return null;

    throw error;
  }
};
