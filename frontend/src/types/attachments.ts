import type { ReplyReference } from './messages';

type AttachmentKind = 'audio' | 'image' | 'video' | 'document' | 'other';

type MessageAttachment = {
	id: string;
	name: string;
	type: string;
	size: number;
	kind?: AttachmentKind | undefined;
	chunkCount?: number | undefined;
	chunkSize?: number | undefined;
	expiresAt?: number | undefined;
	cipher?: 'AES-GCM' | undefined;
	encryptionVersion?: 1 | undefined;
	hashSha256?: string | undefined;
	plaintextHashSha256?: string | undefined;
	manifestSignature?: string | undefined;
	localReferenceId?: string | undefined;
	fileKeyBase64?: string | undefined;
	chunkIvs?: string[] | undefined;
	data?: ArrayBuffer | undefined;
	thumbnail?: string | undefined;
};

type AttachmentState = 'uploading' | 'uploaded' | 'failed' | null;

type AttachmentTransferStatus =
	| 'queued'
	| 'uploading'
	| 'uploaded'
	| 'downloading'
	| 'ready'
	| 'failed'
	| 'expired';

type TransferQueueStatus = 'pending' | 'uploading' | 'stalled' | 'completed';

const ATTACHMENT_ERROR_CODES = [
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

type AttachmentErrorCode = typeof ATTACHMENT_ERROR_CODES[number];

type AttachmentErrorDetails = {
	maxBytes?: number;
	actualBytes?: number;
	kind?: AttachmentKind;
	mimeType?: string;
	missingChunks?: number;
};

type AttachmentPolicy = {
	kind: AttachmentKind;
	mimeRules: string[];
	maxBytes?: number | undefined;
};

type AttachmentSelection = FileList | ReadonlyArray<File>;

type AttachmentSelectionResult = {
	totalCount: number;
	successCount: number;
	failedCount: number;
	recoverableCount: number;
};

type AttachmentManifest = {
	attachmentId: string;
	uploadId: string;
	senderId?: string | undefined;
	recipientId?: string | undefined;
	fileName: string;
	mimeType: string;
	kind: AttachmentKind;
	totalSize: number;
	chunkSize: number;
	chunkCount: number;
	cipher?: 'AES-GCM' | undefined;
	hashSha256?: string | undefined;
	signature?: string | undefined;
	createdAt: number;
	expiresAt: number;
};

type AttachmentTransferRecord = {
	attachmentId: string;
	peerId: string;
	direction: 'outgoing' | 'incoming';
	status: AttachmentTransferStatus;
	progress: number;
	errorCode?: AttachmentErrorCode;
	createdAt: number;
	updatedAt: number;
};

type LocalAttachmentRecord = {
	attachmentId: string;
	peerId?: string | undefined;
	messageId?: string | undefined;
	fileName: string;
	mimeType: string;
	size: number;
	kind?: AttachmentKind | undefined;
	plaintextHashSha256?: string | undefined;
	blob: Blob;
	createdAt: number;
	updatedAt: number;
	lastAccessedAt: number;
};

type TransferQueueMeta = {
	name: string;
	size: number;
	type: string;
	lastModified: number;
};

type TransferQueueUpload = {
	attachmentId: string;
	recipientId: string;
	fileName: string;
	mimeType: string;
	kind: string;
	totalSize: number;
	chunkSize: number;
	chunkCount: number;
	hashSha256?: string | undefined;
	expiresAt: number;
};

type TransferQueueMessageDispatch = {
	content: string;
	replyTo?: ReplyReference | undefined;
};

enum AttachmentType {
	chat = 'chat',
	forward = 'forward',
}

type TransferQueueUiSource = AttachmentType.chat | AttachmentType.forward;

type TransferQueueRecord = {
	id: string;
	recipientId: string;
	fileBlob: Blob;
	meta: TransferQueueMeta;
	upload?: TransferQueueUpload | undefined;
	messageDispatch?: TransferQueueMessageDispatch | undefined;
	uiSource?: TransferQueueUiSource | undefined;
	attachment?: MessageAttachment | undefined;
	manifest?: AttachmentManifest | undefined;
	persistLocally: boolean;
	status: TransferQueueStatus;
	retryCount: number;
	createdAt: number;
	updatedAt: number;
	lastError?: string | undefined;
};

export type {
	MessageAttachment,
	AttachmentKind,
	AttachmentState,
	AttachmentTransferStatus,
	TransferQueueStatus,
	AttachmentErrorCode,
	AttachmentErrorDetails,
	AttachmentPolicy,
	AttachmentSelection,
	AttachmentSelectionResult,
	AttachmentManifest,
	AttachmentTransferRecord,
	LocalAttachmentRecord,
	TransferQueueMeta,
	TransferQueueUpload,
	TransferQueueMessageDispatch,
	TransferQueueUiSource,
	TransferQueueRecord
};
export { ATTACHMENT_ERROR_CODES, AttachmentType };
