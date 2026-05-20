export type AttachmentKind = 'audio' | 'image' | 'video' | 'document' | 'other';

export type AttachmentTransferState =
  | 'queued'
  | 'uploading'
  | 'uploaded'
  | 'downloading'
  | 'ready'
  | 'failed'
  | 'expired';

export const ATTACHMENT_ERROR_CODES = [
  'ATTACHMENTS_DISABLED',
  'INVALID_FILE_METADATA',
  'UNAUTHORIZED',
  'RECIPIENT_NOT_ALLOWED',
  'UPLOAD_ALREADY_EXISTS',
  'UPLOAD_NOT_FOUND',
  'UPLOAD_INCOMPLETE',
  'FILE_TOO_LARGE_FILE',
  'FILE_TOO_LARGE_AUDIO',
  'FILE_TOO_LARGE_IMAGE',
  'FILE_TOO_LARGE_VIDEO',
  'FILE_TOO_LARGE_DOCUMENT',
  'FILE_TYPE_NOT_ALLOWED',
  'ATTACHMENT_NOT_FOUND',
  'CHUNK_NOT_FOUND',
  'CHUNK_HASH_MISMATCH',
  'RATE_LIMITED',
  'UPLOAD_STORAGE_ERROR'
] as const;

export type AttachmentErrorCode = typeof ATTACHMENT_ERROR_CODES[number];

export interface AttachmentErrorDetails {
  maxBytes?: number;
  actualBytes?: number;
  kind?: AttachmentKind;
  mimeType?: string;
  missingChunks?: number;
}

export interface AttachmentManifest {
  attachmentId: string;
  uploadId: string;
  senderId: string;
  recipientId: string;
  fileName: string;
  mimeType: string;
  kind: AttachmentKind;
  totalSize: number;
  chunkSize: number;
  chunkCount: number;
  cipher: 'AES-GCM';
  createdAt: number;
  expiresAt: number;
  hashSha256?: string;
  signature?: string;
}

export interface UploadSession {
  uploadId: string;
  attachmentId: string;
  senderId: string;
  recipientId: string;
  fileName: string;
  mimeType: string;
  kind: AttachmentKind;
  totalSize: number;
  chunkSize: number;
  chunkCount: number;
  hashSha256?: string;
  receivedChunks: number[];
  createdAt: number;
  expiresAt: number;
}

export interface ChunkMeta {
  uploadId: string;
  attachmentId: string;
  chunkIndex: number;
  chunkSize: number;
  hashSha256?: string;
  receivedAt: number;
}

export interface AttachmentTransferRecord {
  attachmentId: string;
  senderId: string;
  recipientId: string;
  state: AttachmentTransferState;
  progress: number;
  lastErrorCode?: AttachmentErrorCode;
  createdAt: number;
  updatedAt: number;
}

export interface AttachmentMimePolicy {
  kind: AttachmentKind;
  rule: string;
}

export interface AttachmentPolicyLimits {
  fileMaxBytes: number;
  audioMaxBytes: number;
  imageMaxBytes: number;
  videoMaxBytes: number;
  documentMaxBytes: number;
  mimePolicies: AttachmentMimePolicy[];
  allowedMimeTypes: string[];
}
