import { createHash } from 'crypto';

import express, { Router } from 'express';
import rateLimit, { ipKeyGenerator } from 'express-rate-limit';
import { v4 as uuidv4 } from 'uuid';
import { z } from 'zod';

import {
  clearAttachmentArtifactsByUploadId,
  clearAttachmentUploadSession,
  getAttachmentManifest,
  getAttachmentManifestByUploadId,
  getAttachmentUploadSession,
  getAttachmentsTtlSeconds,
  isAttachmentsEnabled,
  markUploadChunkReceived,
  readAttachmentChunk,
  setAttachmentManifest,
  setAttachmentUploadSession,
  writeAttachmentChunk
} from '../services';
import { recordDashboardRateLimitRejection } from '../services/application';
import { ATTACHMENT_ERROR_CODES } from '../types/attachments';
import {
  LIMIT_IPV6_SUBNET,
  attachmentPolicyLimits,
  getAttachmentSizeError,
  getAttachmentKindFromMimeType,
  isMimeTypeAllowed,
  logger,
  normalizeIpForRateLimit,
  spkiToPem,
  verifySignature
} from '../utils';
import { sendValidatedJson } from '../utils/response-validation';

import type { AttachmentErrorCode, AttachmentErrorDetails, AttachmentManifest, UploadSession } from '../types';


const attachmentsRouter = Router();
const ATTACHMENTS_MAX_CHUNK_BYTES = Number(process.env['ATTACHMENTS_MAX_CHUNK_BYTES'] ?? 256 * 1024);
const ATTACHMENTS_ENCRYPTED_CHUNK_OVERHEAD_BYTES = 16;
const uploadChunkBodyParser = express.raw({
  type: 'application/octet-stream',
  limit: ATTACHMENTS_MAX_CHUNK_BYTES + ATTACHMENTS_ENCRYPTED_CHUNK_OVERHEAD_BYTES
});
const ATTACHMENTS_INIT_UPLOAD_RATE_LIMIT_WINDOW_MS = Number(
  process.env['ATTACHMENTS_INIT_UPLOAD_RATE_LIMIT_WINDOW_MS'] ?? 60_000
);
const ATTACHMENTS_INIT_UPLOAD_RATE_LIMIT_MAX = Number(
  process.env['ATTACHMENTS_INIT_UPLOAD_RATE_LIMIT_MAX'] ?? 12
);
const ATTACHMENTS_CHUNK_RATE_LIMIT_WINDOW_MS = Number(
  process.env['ATTACHMENTS_CHUNK_RATE_LIMIT_WINDOW_MS'] ?? 60_000
);
const ATTACHMENTS_CHUNK_RATE_LIMIT_MAX = Number(
  process.env['ATTACHMENTS_CHUNK_RATE_LIMIT_MAX'] ?? 500
);

const initUploadSchema = z.object({
  recipientId: z.string().min(1),
  fileName: z.string().min(1),
  mimeType: z.string().min(1),
  totalSize: z.number().int().positive(),
  chunkSize: z.number().int().positive(),
  chunkCount: z.number().int().positive(),
  hashSha256: z.string().optional()
});

const completeUploadSchema = z.object({
  hashSha256: z.string().trim().toLowerCase().regex(/^[a-f0-9]{64}$/).optional(),
  manifestSignature: z.string().trim().min(1)
});

const uuidV4Schema = z.string().regex(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);

const attachmentAckSchema = z.object({
  uploadId: uuidV4Schema,
  signature: z.string().min(1)
});

const attachmentKindSchema = z.enum(['audio', 'image', 'video', 'document', 'other']);

const attachmentErrorCodeSchema = z.enum(ATTACHMENT_ERROR_CODES);

const attachmentErrorDetailsSchema = z.object({
  maxBytes: z.number().optional(),
  actualBytes: z.number().optional(),
  kind: attachmentKindSchema.optional(),
  mimeType: z.string().min(1).optional(),
  missingChunks: z.number().int().nonnegative().optional()
}).strict();

const attachmentErrorResponseSchema = z.object({
  error: attachmentErrorCodeSchema,
  code: attachmentErrorCodeSchema,
  details: attachmentErrorDetailsSchema.optional()
}).strict();

const attachmentMimePolicyResponseSchema = z.object({
  kind: attachmentKindSchema,
  rule: z.string().min(1)
}).strict();

const attachmentPolicyResponseSchema = z.object({
  version: z.string().min(1),
  maxFileBytes: z.number().int().positive(),
  maxByKind: z.object({
    audio: z.number().int().positive(),
    image: z.number().int().positive(),
    video: z.number().int().positive(),
    document: z.number().int().positive()
  }).strict(),
  allowedMimeTypes: z.array(z.string().min(1)),
  mimePolicies: z.array(attachmentMimePolicyResponseSchema)
}).strict();

const attachmentStatusResponseSchema = z.object({
  id: uuidV4Schema,
  receivedChunks: z.array(z.number().int().nonnegative()),
  totalChunks: z.number().int().positive(),
  isComplete: z.boolean()
}).strict();

const initUploadResponseSchema = z.object({
  uploadId: uuidV4Schema,
  attachmentId: uuidV4Schema,
  recipientId: z.string().min(1),
  fileName: z.string().min(1),
  mimeType: z.string().min(1),
  kind: attachmentKindSchema,
  totalSize: z.number().int().positive(),
  chunkSize: z.number().int().positive(),
  chunkCount: z.number().int().positive(),
  hashSha256: z.string().regex(/^[a-f0-9]{64}$/).optional(),
  expiresAt: z.number()
}).strict();

const chunkUploadResponseSchema = z.object({
  uploadId: uuidV4Schema,
  attachmentId: uuidV4Schema,
  receivedChunks: z.number().int().nonnegative(),
  chunkCount: z.number().int().positive(),
  progress: z.number().min(0).max(1)
}).strict();

const attachmentManifestResponseSchema = z.object({
  attachmentId: uuidV4Schema,
  uploadId: uuidV4Schema,
  senderId: z.string().min(1),
  recipientId: z.string().min(1),
  fileName: z.string().min(1),
  mimeType: z.string().min(1),
  kind: attachmentKindSchema,
  totalSize: z.number().int().positive(),
  chunkSize: z.number().int().positive(),
  chunkCount: z.number().int().positive(),
  cipher: z.literal('AES-GCM'),
  createdAt: z.number(),
  expiresAt: z.number(),
  hashSha256: z.string().regex(/^[a-f0-9]{64}$/).optional(),
  signature: z.string().min(1).optional()
}).strict();

const attachmentAckResponseSchema = z.object({
  uploadId: uuidV4Schema,
  attachmentId: uuidV4Schema,
  acknowledged: z.boolean()
}).strict();

const chunkIndexSchema = z.string().regex(/^(0|[1-9]\d*)$/);

const getRouteUuidParam = (value: unknown): string | null => {
  const parsed = uuidV4Schema.safeParse(value);
  return parsed.success ? parsed.data : null;
};

const getRouteChunkIndexParam = (value: unknown): number | null => {
  const parsed = chunkIndexSchema.safeParse(value);
  if (!parsed.success) 
    return null;

  const chunkIndex = Number(parsed.data);
  return Number.isSafeInteger(chunkIndex) ? chunkIndex : null;
};

const toSafeFileName = (value: string): string =>
  value.replace(/[\\/:*?"<>|\x00-\x1F]/g, '_').slice(0, 255);

const normalizeMimeType = (value: string): string => value.trim().toLowerCase();

const normalizeFileName = (value: string): string => value.trim();

const getExpectedChunkCount = (totalSize: number, chunkSize: number): number =>
  Math.max(1, Math.ceil(totalSize / chunkSize));

const getExpectedPlaintextChunkSize = (totalSize: number, chunkSize: number, chunkIndex: number): number => {
  const offset = chunkIndex * chunkSize;
  return Math.max(0, Math.min(chunkSize, totalSize - offset));
};

const getExpectedEncryptedChunkSize = (totalSize: number, chunkSize: number, chunkIndex: number): number =>
  getExpectedPlaintextChunkSize(totalSize, chunkSize, chunkIndex) + ATTACHMENTS_ENCRYPTED_CHUNK_OVERHEAD_BYTES;

const isSha256Hex = (value: string | undefined): boolean => value === undefined || /^[a-f0-9]{64}$/.test(value);

const getAuthUserId = (headerValue: unknown): string | null =>
  typeof headerValue === 'string' && headerValue.length > 0 ? headerValue : null;

const getAuthSigningPublicKey = (req: express.Request): string | null => {
  const headerValue = req.header('x-auth-signing-public-key');
  if (typeof headerValue === 'string' && headerValue.length > 0) 
    return headerValue;

  const queryValue = req.query['auth_spk'];
  return typeof queryValue === 'string' && queryValue.length > 0 ? queryValue : null;
};

const buildAttachmentAckPayload = (uploadId: string, attachmentId: string): string =>
  `attachment-ack.${uploadId}.${attachmentId}`;

const buildAttachmentManifestSignaturePayload = (manifest: Omit<AttachmentManifest, 'createdAt' | 'signature'>): string => JSON.stringify({
  attachmentId: manifest.attachmentId,
  uploadId: manifest.uploadId,
  senderId: manifest.senderId,
  recipientId: manifest.recipientId,
  fileName: manifest.fileName,
  mimeType: manifest.mimeType,
  kind: manifest.kind,
  totalSize: manifest.totalSize,
  chunkSize: manifest.chunkSize,
  chunkCount: manifest.chunkCount,
  cipher: manifest.cipher,
  expiresAt: manifest.expiresAt,
  hashSha256: manifest.hashSha256 ?? null
});

const getChunkHashHeader = (headerValue: unknown): string | null => {
  if (typeof headerValue !== 'string') 
    return null;

  const normalized = headerValue.trim().toLowerCase();
  return /^[a-f0-9]{64}$/.test(normalized) ? normalized : null;
};

const sendAttachmentError = (
  res: express.Response,
  status: number,
  code: AttachmentErrorCode,
  details?: AttachmentErrorDetails
) => sendValidatedJson(
  res,
  attachmentErrorResponseSchema,
  {
    error: code,
    code,
    ...(details !== undefined ? { details } : {})
  },
  {
    label: 'attachment error response',
    status,
    errorStatus: status,
    errorBody: { error: code, code }
  }
);

const getAttachmentRateLimitKey = (req: express.Request): string => {
  const userId = getAuthUserId(req.header('x-auth-user-id'));
  if (userId) 
    return userId;

  const ipAddress = req.ip ?? req.socket.remoteAddress;
  return ipAddress ? ipKeyGenerator(normalizeIpForRateLimit(ipAddress), LIMIT_IPV6_SUBNET) : 'unknown';
};

const createAttachmentRateLimiter = (windowMs: number, max: number) => rateLimit({
  windowMs,
  max,
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: getAttachmentRateLimitKey,
  handler: (_req, res) => {
    recordDashboardRateLimitRejection();
    sendAttachmentError(res, 429, 'RATE_LIMITED');
  }
});

const initUploadLimiter = createAttachmentRateLimiter(
  ATTACHMENTS_INIT_UPLOAD_RATE_LIMIT_WINDOW_MS,
  ATTACHMENTS_INIT_UPLOAD_RATE_LIMIT_MAX
);

const chunkUploadLimiter = createAttachmentRateLimiter(
  ATTACHMENTS_CHUNK_RATE_LIMIT_WINDOW_MS,
  ATTACHMENTS_CHUNK_RATE_LIMIT_MAX
);

attachmentsRouter.get('/policy', (_req, res) => {
  const version = process.env['ATTACHMENTS_POLICY_VERSION'] ?? '1';

  return sendValidatedJson(
    res,
    attachmentPolicyResponseSchema,
    {
      version,
      maxFileBytes: attachmentPolicyLimits.fileMaxBytes,
      maxByKind: {
        audio: attachmentPolicyLimits.audioMaxBytes,
        image: attachmentPolicyLimits.imageMaxBytes,
        video: attachmentPolicyLimits.videoMaxBytes,
        document: attachmentPolicyLimits.documentMaxBytes
      },
      allowedMimeTypes: attachmentPolicyLimits.allowedMimeTypes,
      mimePolicies: attachmentPolicyLimits.mimePolicies
    },
    {
      label: 'attachment policy response',
      errorBody: { error: 'UPLOAD_STORAGE_ERROR', code: 'UPLOAD_STORAGE_ERROR' }
    }
  );
});

attachmentsRouter.get('/status/:uploadId', async (req, res) => {
  const senderId = getAuthUserId(req.header('x-auth-user-id'));
  if (!senderId) 
    return sendAttachmentError(res, 401, 'UNAUTHORIZED');

  const uploadId = getRouteUuidParam(req.params.uploadId);
  if (!uploadId) 
    return sendAttachmentError(res, 400, 'INVALID_FILE_METADATA');

  const session = await getAttachmentUploadSession(uploadId);
  if (!session) 
    return sendAttachmentError(res, 404, 'UPLOAD_NOT_FOUND');

  if (session.senderId !== senderId) 
    return sendAttachmentError(res, 403, 'RECIPIENT_NOT_ALLOWED');

  return sendValidatedJson(
    res,
    attachmentStatusResponseSchema,
    {
      id: session.uploadId,
      receivedChunks: session.receivedChunks,
      totalChunks: session.chunkCount,
      isComplete: session.receivedChunks.length === session.chunkCount
    },
    {
      label: 'attachment status response',
      errorBody: { error: 'UPLOAD_STORAGE_ERROR', code: 'UPLOAD_STORAGE_ERROR' }
    }
  );
});

attachmentsRouter.post('/init-upload', initUploadLimiter, async (req, res) => {
  if (!isAttachmentsEnabled()) 
    return sendAttachmentError(res, 503, 'ATTACHMENTS_DISABLED');

  const senderId = getAuthUserId(req.header('x-auth-user-id'));
  if (!senderId) 
    return sendAttachmentError(res, 401, 'UNAUTHORIZED');

  const parsed = initUploadSchema.safeParse(req.body);
  if (!parsed.success) 
    return sendAttachmentError(res, 400, 'INVALID_FILE_METADATA');

  const { recipientId, totalSize, chunkSize, chunkCount } = parsed.data;
  const fileName = normalizeFileName(parsed.data.fileName);
  const safeFileName = toSafeFileName(fileName).trim();
  const mimeType = normalizeMimeType(parsed.data.mimeType);
  const hashSha256 = parsed.data.hashSha256?.trim().toLowerCase();

  if (!safeFileName || !isSha256Hex(hashSha256)) 
    return sendAttachmentError(res, 400, 'INVALID_FILE_METADATA');

  if (!isMimeTypeAllowed(mimeType)) 
    return sendAttachmentError(res, 415, 'FILE_TYPE_NOT_ALLOWED', { mimeType });

  const kind = getAttachmentKindFromMimeType(mimeType);
  const sizeError = getAttachmentSizeError(kind, totalSize);
  if (sizeError) 
    return sendAttachmentError(res, 413, sizeError.code, sizeError.details);

  if (chunkSize > ATTACHMENTS_MAX_CHUNK_BYTES) {
    return sendAttachmentError(res, 400, 'INVALID_FILE_METADATA', {
      maxBytes: ATTACHMENTS_MAX_CHUNK_BYTES,
      actualBytes: chunkSize
    });
  }

  if (chunkSize > totalSize || chunkCount !== getExpectedChunkCount(totalSize, chunkSize)) 
    return sendAttachmentError(res, 400, 'INVALID_FILE_METADATA');

  const now = Date.now();
  const expiresAt = now + getAttachmentsTtlSeconds() * 1000;
  const uploadId = uuidv4();
  const attachmentId = uuidv4();

  const session: UploadSession = {
    uploadId,
    attachmentId,
    senderId,
    recipientId,
    fileName: toSafeFileName(fileName),
    mimeType,
    kind,
    totalSize,
    chunkSize,
    chunkCount,
    ...(hashSha256 !== undefined ? { hashSha256 } : {}),
    receivedChunks: [],
    createdAt: now,
    expiresAt
  };

  await setAttachmentUploadSession(session);

  return sendValidatedJson(
    res,
    initUploadResponseSchema,
    {
      uploadId,
      attachmentId,
      recipientId,
      fileName: safeFileName,
      mimeType,
      kind,
      totalSize,
      chunkSize,
      chunkCount,
      ...(hashSha256 !== undefined ? { hashSha256 } : {}),
      expiresAt
    },
    {
      label: 'attachment init response',
      status: 201,
      errorBody: { error: 'UPLOAD_STORAGE_ERROR', code: 'UPLOAD_STORAGE_ERROR' }
    }
  );
});

attachmentsRouter.put('/:uploadId/chunks/:chunkIndex', chunkUploadLimiter, uploadChunkBodyParser, async (req, res) => {
  const senderId = getAuthUserId(req.header('x-auth-user-id'));
  if (!senderId) 
    return sendAttachmentError(res, 401, 'UNAUTHORIZED');

  const uploadId = getRouteUuidParam(req.params['uploadId']);
  const chunkIndex = getRouteChunkIndexParam(req.params['chunkIndex']);
  if (!uploadId || chunkIndex === null) 
    return sendAttachmentError(res, 400, 'INVALID_FILE_METADATA');

  const session = await getAttachmentUploadSession(uploadId);
  if (!session) 
    return sendAttachmentError(res, 404, 'UPLOAD_NOT_FOUND');

  if (session.senderId !== senderId) 
    return sendAttachmentError(res, 403, 'RECIPIENT_NOT_ALLOWED');

  if (chunkIndex >= session.chunkCount) 
    return sendAttachmentError(res, 400, 'INVALID_FILE_METADATA');

  const payload: unknown = req.body;
  if (!Buffer.isBuffer(payload) || payload.length === 0) 
    return sendAttachmentError(res, 400, 'INVALID_FILE_METADATA');

  const expectedEncryptedChunkSize = getExpectedEncryptedChunkSize(
    session.totalSize,
    session.chunkSize,
    chunkIndex
  );
  if (payload.length !== expectedEncryptedChunkSize) {
    return sendAttachmentError(res, 400, 'INVALID_FILE_METADATA', {
      actualBytes: payload.length,
      maxBytes: expectedEncryptedChunkSize
    });
  }

  const declaredChunkHash = getChunkHashHeader(req.header('x-chunk-sha256'));
  if (!declaredChunkHash) 
    return sendAttachmentError(res, 400, 'INVALID_FILE_METADATA');

  const actualChunkHash = createHash('sha256').update(payload).digest('hex');
  if (actualChunkHash !== declaredChunkHash) 
    return sendAttachmentError(res, 409, 'CHUNK_HASH_MISMATCH');

  try {
    await writeAttachmentChunk(session.attachmentId, chunkIndex, payload);
  } catch (error) {
    logger.error('Failed to write attachment chunk', {
      uploadId,
      attachmentId: session.attachmentId,
      chunkIndex,
      error: error instanceof Error ? error.message : 'Unknown error'
    });
    return sendAttachmentError(res, 500, 'UPLOAD_STORAGE_ERROR');
  }

  const updated = await markUploadChunkReceived(uploadId, chunkIndex);
  if (!updated) 
    return sendAttachmentError(res, 404, 'UPLOAD_NOT_FOUND');

  return sendValidatedJson(
    res,
    chunkUploadResponseSchema,
    {
      uploadId,
      attachmentId: updated.attachmentId,
      receivedChunks: updated.receivedChunks.length,
      chunkCount: updated.chunkCount,
      progress: updated.receivedChunks.length / updated.chunkCount
    },
    {
      label: 'attachment chunk response',
      status: 202,
      errorBody: { error: 'UPLOAD_STORAGE_ERROR', code: 'UPLOAD_STORAGE_ERROR' }
    }
  );
});

attachmentsRouter.post('/:uploadId/complete', async (req, res) => {
  const senderId = getAuthUserId(req.header('x-auth-user-id'));
  if (!senderId) 
    return sendAttachmentError(res, 401, 'UNAUTHORIZED');

  const signingPublicKey = getAuthSigningPublicKey(req);
  if (!signingPublicKey)
    return sendAttachmentError(res, 401, 'UNAUTHORIZED');

  const uploadId = getRouteUuidParam(req.params.uploadId);
  if (!uploadId) 
    return sendAttachmentError(res, 400, 'INVALID_FILE_METADATA');

  const parsed = completeUploadSchema.safeParse(req.body ?? {});
  if (!parsed.success) 
    return sendAttachmentError(res, 400, 'INVALID_FILE_METADATA');

  const session = await getAttachmentUploadSession(uploadId);
  if (!session) 
    return sendAttachmentError(res, 404, 'UPLOAD_NOT_FOUND');

  if (session.senderId !== senderId) 
    return sendAttachmentError(res, 403, 'RECIPIENT_NOT_ALLOWED');

  if (session.receivedChunks.length < session.chunkCount) {
    return sendAttachmentError(res, 409, 'UPLOAD_INCOMPLETE', {
      missingChunks: session.chunkCount - session.receivedChunks.length
    });
  }

  const manifestHashSha256 = parsed.data.hashSha256 ?? session.hashSha256;
  if (parsed.data.hashSha256 && session.hashSha256 && parsed.data.hashSha256 !== session.hashSha256) 
    return sendAttachmentError(res, 400, 'INVALID_FILE_METADATA');

  const manifestToSign: Omit<AttachmentManifest, 'createdAt' | 'signature'> = {
    attachmentId: session.attachmentId,
    uploadId: session.uploadId,
    senderId: session.senderId,
    recipientId: session.recipientId,
    fileName: session.fileName,
    mimeType: session.mimeType,
    kind: session.kind,
    totalSize: session.totalSize,
    chunkSize: session.chunkSize,
    chunkCount: session.chunkCount,
    cipher: 'AES-GCM',
    expiresAt: session.expiresAt,
    ...(manifestHashSha256 !== undefined ? { hashSha256: manifestHashSha256 } : {})
  };

  const manifestSignaturePayload = buildAttachmentManifestSignaturePayload(manifestToSign);
  const isValidManifestSignature = verifySignature(
    manifestSignaturePayload,
    parsed.data.manifestSignature,
    spkiToPem(signingPublicKey)
  );
  if (!isValidManifestSignature)
    return sendAttachmentError(res, 401, 'UNAUTHORIZED');

  const manifest: AttachmentManifest = {
    ...manifestToSign,
    createdAt: session.createdAt,
    signature: parsed.data.manifestSignature
  };

  await setAttachmentManifest(manifest);
  await clearAttachmentUploadSession(uploadId);

  return sendValidatedJson(
    res,
    attachmentManifestResponseSchema,
    manifest,
    {
      label: 'attachment complete manifest response',
      errorBody: { error: 'UPLOAD_STORAGE_ERROR', code: 'UPLOAD_STORAGE_ERROR' }
    }
  );
});

attachmentsRouter.post('/ack', async (req, res) => {
  const userId = getAuthUserId(req.header('x-auth-user-id'));
  if (!userId) 
    return sendAttachmentError(res, 401, 'UNAUTHORIZED');

  const signingPublicKey = getAuthSigningPublicKey(req);
  if (!signingPublicKey) 
    return sendAttachmentError(res, 401, 'UNAUTHORIZED');

  const parsed = attachmentAckSchema.safeParse(req.body);
  if (!parsed.success) 
    return sendAttachmentError(res, 400, 'INVALID_FILE_METADATA');

  const { uploadId, signature } = parsed.data;
  const manifest = await getAttachmentManifestByUploadId(uploadId);
  if (!manifest) 
    return sendAttachmentError(res, 404, 'UPLOAD_NOT_FOUND');

  if (manifest.recipientId !== userId) 
    return sendAttachmentError(res, 403, 'RECIPIENT_NOT_ALLOWED');

  const ackPayload = buildAttachmentAckPayload(manifest.uploadId, manifest.attachmentId);
  const isValidSignature = verifySignature(ackPayload, signature, spkiToPem(signingPublicKey));
  if (!isValidSignature) 
    return sendAttachmentError(res, 401, 'UNAUTHORIZED');

  const cleanedAttachmentId = await clearAttachmentArtifactsByUploadId(uploadId, 'recipient-ack');
  if (!cleanedAttachmentId) 
    return sendAttachmentError(res, 404, 'UPLOAD_NOT_FOUND');

  return sendValidatedJson(
    res,
    attachmentAckResponseSchema,
    {
      uploadId,
      attachmentId: cleanedAttachmentId,
      acknowledged: true
    },
    {
      label: 'attachment ack response',
      errorBody: { error: 'UPLOAD_STORAGE_ERROR', code: 'UPLOAD_STORAGE_ERROR' }
    }
  );
});

attachmentsRouter.get('/:attachmentId/manifest', async (req, res) => {
  const userId = getAuthUserId(req.header('x-auth-user-id'));
  if (!userId) 
    return sendAttachmentError(res, 401, 'UNAUTHORIZED');

  const attachmentId = getRouteUuidParam(req.params.attachmentId);
  if (!attachmentId) 
    return sendAttachmentError(res, 400, 'INVALID_FILE_METADATA');

  const manifest = await getAttachmentManifest(attachmentId);
  if (!manifest) 
    return sendAttachmentError(res, 404, 'ATTACHMENT_NOT_FOUND');

  if (manifest.senderId !== userId && manifest.recipientId !== userId) 
    return sendAttachmentError(res, 403, 'RECIPIENT_NOT_ALLOWED');

  return sendValidatedJson(
    res,
    attachmentManifestResponseSchema,
    manifest,
    {
      label: 'attachment manifest response',
      errorBody: { error: 'UPLOAD_STORAGE_ERROR', code: 'UPLOAD_STORAGE_ERROR' }
    }
  );
});

attachmentsRouter.get('/:attachmentId/chunks/:chunkIndex', async (req, res) => {
  const userId = getAuthUserId(req.header('x-auth-user-id'));
  if (!userId) 
    return sendAttachmentError(res, 401, 'UNAUTHORIZED');

  const attachmentId = getRouteUuidParam(req.params.attachmentId);
  const chunkIndex = getRouteChunkIndexParam(req.params.chunkIndex);
  if (!attachmentId || chunkIndex === null) 
    return sendAttachmentError(res, 400, 'INVALID_FILE_METADATA');

  const manifest = await getAttachmentManifest(attachmentId);
  if (!manifest) 
    return sendAttachmentError(res, 404, 'ATTACHMENT_NOT_FOUND');

  if (manifest.senderId !== userId && manifest.recipientId !== userId) 
    return sendAttachmentError(res, 403, 'RECIPIENT_NOT_ALLOWED');

  if (chunkIndex >= manifest.chunkCount) 
    return sendAttachmentError(res, 400, 'INVALID_FILE_METADATA');

  let chunk: Buffer | null;
  try {
    chunk = await readAttachmentChunk(attachmentId, chunkIndex);
  } catch (error) {
    logger.error('Failed to read attachment chunk', {
      attachmentId,
      chunkIndex,
      error: error instanceof Error ? error.message : 'Unknown error'
    });
    return sendAttachmentError(res, 500, 'UPLOAD_STORAGE_ERROR');
  }

  if (!chunk) 
    return sendAttachmentError(res, 404, 'CHUNK_NOT_FOUND');

  res.setHeader('Content-Type', 'application/octet-stream');
  res.setHeader('X-Chunk-Index', String(chunkIndex));
  res.setHeader('X-Chunk-Count', String(manifest.chunkCount));
  return res.status(200).send(chunk);
});

export { attachmentsRouter };
