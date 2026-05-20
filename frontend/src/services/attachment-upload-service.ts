import {
	concatArrayBuffers,
	decryptBytes,
	encryptBytes,
	encryptBytesWithIv,
	exportSymmetricKey,
	generateSymmetricKey,
	hashBytes,
	importPublicKey,
	importSymmetricKey,
	signData,
	verifySignature,
	getKeyPair, 
	getPeerKey
} from '@/crypto';
import {
	getAttachmentEncryptionMetadataIncompleteMessage,
	getAttachmentErrorMessage,
	getAttachmentIntegrityVerificationFailedMessage,
	getAttachmentManifestMismatchMessage,
	getAttachmentManifestSignatureMismatchMessage,
	getAttachmentManifestSignatureMissingMessage,
	getAttachmentManifestVerificationFailedMessage,
	getAttachmentSenderIdentityMismatchMessage,
	getAttachmentSignerKeyMissingMessage,
	getAttachmentSigningKeysNotInitializedMessage,
	getAttachmentTransferCanceledMessage,
	getAttachmentUserIdentityNotInitializedMessage,
	getQueuedAttachmentTransferMetadataIncompleteMessage
} from '@/helpers/attachments';
import { signedFetch } from '@/helpers/messages/http-auth';
import { isBoolean, isFiniteNumber, isNonNegativeSafeInteger, isPositiveSafeInteger, isRecord, isString, parseJsonResponse, readJsonResponse } from '@/helpers/validation';
import { clientLogger } from '@/services/logger';
import { useAttachmentTransferStore } from '@/store/attachment-transfer-store';
import type { AttachmentTransferSnapshot } from '@/store/attachment-transfer-store';
import { useAuthStore } from '@/store/auth-store';
import { useMessagesStore } from '@/store/messages-store';
import { ATTACHMENT_ERROR_CODES, AttachmentType } from '@/types';
import type { AttachmentErrorCode, AttachmentErrorDetails, AttachmentKind, AttachmentManifest, MessageAttachment, TransferQueueMessageDispatch, TransferQueueRecord, TransferQueueUiSource, TransferQueueUpload } from '@/types';

import {
	ensureTransferStorageCapacity,
	exportLocalAttachment,
	getQueuedAttachmentTransfer,
	listQueuedAttachmentTransfers,
	queueAttachmentTransfer,
	removeQueuedAttachmentTransfer,
	saveLocalAttachment,
	updateQueuedAttachmentTransfer
} from './attachment-local-store';
import { validateAttachmentFile } from './attachment-policy';

type InitUploadResponse = {
	uploadId: string;
	attachmentId: string;
	recipientId: string;
	fileName: string;
	mimeType: string;
	kind: AttachmentKind;
	totalSize: number;
	chunkSize: number;
	chunkCount: number;
	hashSha256?: string;
	expiresAt: number;
};

type AttachmentApiErrorPayload = {
	error?: string;
	code?: AttachmentErrorCode;
	details?: AttachmentErrorDetails | undefined;
	missingChunks?: number;
};

type UploadAttachmentResult = {
	manifest: AttachmentManifest;
	attachment: MessageAttachment;
};

type AttachmentTransferProgress = {
	phase: 'encrypting' | 'uploading' | 'finalizing' | 'decrypting';
	progress: number;
};

type UploadAttachmentOptions = {
	persistLocally?: boolean | undefined;
	messageDispatch?: TransferQueueMessageDispatch | undefined;
	uiSource?: TransferQueueUiSource | undefined;
	localReferenceId?: string | undefined;
};

type DownloadAttachmentOptions = {
	peerId?: string;
	messageId?: string;
};

type AttachmentStatusResponse = {
	id: string;
	receivedChunks: number[];
	totalChunks: number;
	isComplete: boolean;
};

type AttachmentErrorDetailsRecord = {
	maxBytes?: unknown;
	actualBytes?: unknown;
	kind?: unknown;
	mimeType?: unknown;
	missingChunks?: unknown;
};

type AttachmentApiErrorRecord = {
	error?: unknown;
	code?: unknown;
	details?: unknown;
	missingChunks?: unknown;
};

type InitUploadResponseRecord = {
	uploadId?: unknown;
	attachmentId?: unknown;
	recipientId?: unknown;
	fileName?: unknown;
	mimeType?: unknown;
	kind?: unknown;
	totalSize?: unknown;
	chunkSize?: unknown;
	chunkCount?: unknown;
	hashSha256?: unknown;
	expiresAt?: unknown;
};

type AttachmentStatusResponseRecord = {
	id?: unknown;
	receivedChunks?: unknown;
	totalChunks?: unknown;
	isComplete?: unknown;
};

type AttachmentManifestRecord = {
	attachmentId?: unknown;
	uploadId?: unknown;
	senderId?: unknown;
	recipientId?: unknown;
	fileName?: unknown;
	mimeType?: unknown;
	kind?: unknown;
	totalSize?: unknown;
	chunkSize?: unknown;
	chunkCount?: unknown;
	cipher?: unknown;
	hashSha256?: unknown;
	signature?: unknown;
	createdAt?: unknown;
	expiresAt?: unknown;
};

const DEFAULT_CHUNK_SIZE = 256 * 1024;
const ATTACHMENT_RETRY_BASE_DELAY_MS = 2_000;
const ATTACHMENT_RETRY_MAX_DELAY_MS = 60_000;
const OFFLINE_STALLED_MESSAGE = 'Connection lost. Waiting for network to resume upload.';
const ATTACHMENT_KINDS = ['audio', 'image', 'video', 'document', 'other'] as const satisfies ReadonlyArray<AttachmentKind>;
const ATTACHMENT_KIND_VALUES = new Set<string>(ATTACHMENT_KINDS);
const ATTACHMENT_ERROR_CODE_VALUES = new Set<string>(ATTACHMENT_ERROR_CODES);
let resumeQueuedTransfersPromise: Promise<void> | null = null;
let scheduledResumeQueuedTransfersTimeoutId: number | null = null;
let scheduledResumeQueuedTransfersAt = 0;

const isAttachmentKind = (value: unknown): value is AttachmentKind => (
	isString(value)
	&& ATTACHMENT_KIND_VALUES.has(value)
);

const isAttachmentErrorCode = (value: unknown): value is AttachmentErrorCode => (
	isString(value)
	&& ATTACHMENT_ERROR_CODE_VALUES.has(value)
);

const isAttachmentErrorDetailsRecord = (value: unknown): value is AttachmentErrorDetailsRecord => isRecord(value);

const isAttachmentApiErrorRecord = (value: unknown): value is AttachmentApiErrorRecord => isRecord(value);

const isInitUploadResponseRecord = (value: unknown): value is InitUploadResponseRecord => isRecord(value);

const isAttachmentStatusResponseRecord = (value: unknown): value is AttachmentStatusResponseRecord => isRecord(value);

const isAttachmentManifestRecord = (value: unknown): value is AttachmentManifestRecord => isRecord(value);

const parseAttachmentErrorDetails = (value: unknown): AttachmentErrorDetails | undefined => {
	if (!isAttachmentErrorDetailsRecord(value))
		return undefined;

	const details: AttachmentErrorDetails = {
		...(isFiniteNumber(value.maxBytes) ? { maxBytes: value.maxBytes } : {}),
		...(isFiniteNumber(value.actualBytes) ? { actualBytes: value.actualBytes } : {}),
		...(isAttachmentKind(value.kind) ? { kind: value.kind } : {}),
		...(isString(value.mimeType) ? { mimeType: value.mimeType } : {}),
		...(isNonNegativeSafeInteger(value.missingChunks) ? { missingChunks: value.missingChunks } : {})
	};

	return Object.keys(details).length > 0 ? details : undefined;
};

const parseAttachmentApiErrorPayload = (value: unknown): AttachmentApiErrorPayload | undefined => {
	if (!isAttachmentApiErrorRecord(value))
		return undefined;

	const details = parseAttachmentErrorDetails(value.details);
	return {
		...(isString(value.error) ? { error: value.error } : {}),
		...(isAttachmentErrorCode(value.code) ? { code: value.code } : {}),
		...(details !== undefined ? { details } : {}),
		...(isNonNegativeSafeInteger(value.missingChunks) ? { missingChunks: value.missingChunks } : {})
	};
};

const parseInitUploadResponse = (value: unknown): InitUploadResponse | null => {
	if (!isInitUploadResponseRecord(value)
		|| !isString(value.uploadId)
		|| !isString(value.attachmentId)
		|| !isString(value.recipientId)
		|| !isString(value.fileName)
		|| !isString(value.mimeType)
		|| !isAttachmentKind(value.kind)
		|| !isPositiveSafeInteger(value.totalSize)
		|| !isPositiveSafeInteger(value.chunkSize)
		|| !isPositiveSafeInteger(value.chunkCount)
		|| !isFiniteNumber(value.expiresAt)) {
		return null;
	}

	return {
		uploadId: value.uploadId,
		attachmentId: value.attachmentId,
		recipientId: value.recipientId,
		fileName: value.fileName,
		mimeType: value.mimeType,
		kind: value.kind,
		totalSize: value.totalSize,
		chunkSize: value.chunkSize,
		chunkCount: value.chunkCount,
		...(isString(value.hashSha256) ? { hashSha256: value.hashSha256 } : {}),
		expiresAt: value.expiresAt
	};
};

const parseAttachmentStatusResponse = (value: unknown): AttachmentStatusResponse | null => {
	if (!isAttachmentStatusResponseRecord(value)
		|| !isString(value.id)
		|| !Array.isArray(value.receivedChunks)
		|| !value.receivedChunks.every(isNonNegativeSafeInteger)
		|| !isPositiveSafeInteger(value.totalChunks)
		|| !isBoolean(value.isComplete)) {
		return null;
	}

	return {
		id: value.id,
		receivedChunks: value.receivedChunks,
		totalChunks: value.totalChunks,
		isComplete: value.isComplete
	};
};

const parseAttachmentManifest = (value: unknown): AttachmentManifest | null => {
	if (!isAttachmentManifestRecord(value)
		|| !isString(value.attachmentId)
		|| !isString(value.uploadId)
		|| !isString(value.senderId)
		|| !isString(value.recipientId)
		|| !isString(value.fileName)
		|| !isString(value.mimeType)
		|| !isAttachmentKind(value.kind)
		|| !isPositiveSafeInteger(value.totalSize)
		|| !isPositiveSafeInteger(value.chunkSize)
		|| !isPositiveSafeInteger(value.chunkCount)
		|| value.cipher !== 'AES-GCM'
		|| !isFiniteNumber(value.createdAt)
		|| !isFiniteNumber(value.expiresAt)) {
		return null;
	}

	return {
		attachmentId: value.attachmentId,
		uploadId: value.uploadId,
		senderId: value.senderId,
		recipientId: value.recipientId,
		fileName: value.fileName,
		mimeType: value.mimeType,
		kind: value.kind,
		totalSize: value.totalSize,
		chunkSize: value.chunkSize,
		chunkCount: value.chunkCount,
		cipher: 'AES-GCM',
		...(isString(value.hashSha256) ? { hashSha256: value.hashSha256 } : {}),
		...(isString(value.signature) ? { signature: value.signature } : {}),
		createdAt: value.createdAt,
		expiresAt: value.expiresAt
	};
};

const parseAttachmentJsonResponse = async <T>(response: Response, parser: (value: unknown) => T | null, label: string): Promise<T> => {
	try {
		return await parseJsonResponse(response, parser, label);
	} catch {
		throw new AttachmentTransferError(`Invalid ${label} response.`, response.status, 'INVALID_FILE_METADATA');
	}
};

const getTransferSnapshot = (uploadId: string): AttachmentTransferSnapshot | undefined => {
	const transfers = useAttachmentTransferStore.getState().transfers as Partial<Record<string, AttachmentTransferSnapshot>>;
	return transfers[uploadId];
};

const resolveTransferUiSource = (uiSource: TransferQueueUiSource | undefined): TransferQueueUiSource => (
	uiSource ?? AttachmentType.chat
);

const resolvePositiveNumber = (value: number | undefined, fallback: number): number => (
	value !== undefined && Number.isFinite(value) && value > 0 ? value : fallback
);

const updateTransferUiState = (
	uploadId: string,
	recipientId: string,
	fileName: string,
	source: TransferQueueUiSource,
	state: 'uploading' | 'uploaded' | 'failed',
	phase: 'preparing' | 'encrypting' | 'uploading' | 'finalizing' | 'decrypting' | 'sending',
	progress: number,
	error?: string,
	queueStatus?: TransferQueueRecord['status'],
	retryCount?: number
): void => {
	useAttachmentTransferStore.getState().upsertTransfer({
		uploadId,
		recipientId,
		fileName,
		source,
		queueStatus,
		retryCount,
		state,
		phase,
		progress,
		error
	});
};

const clearTransferUiStateLater = (uploadId: string): void => {
	window.setTimeout(() => {
		const snapshot = getTransferSnapshot(uploadId);
		if (snapshot?.state === 'uploaded')
			useAttachmentTransferStore.getState().clearTransfer(uploadId);
	}, 8000);
};

const isBrowserOffline = (): boolean =>
	typeof navigator !== 'undefined' && !navigator.onLine;

const getAttachmentRetryDelayMs = (retryCount: number): number =>
	Math.min(ATTACHMENT_RETRY_MAX_DELAY_MS, ATTACHMENT_RETRY_BASE_DELAY_MS * (2 ** Math.max(0, retryCount - 1)));

const clearScheduledQueuedTransferResume = (): void => {
	if (scheduledResumeQueuedTransfersTimeoutId === null)
		return;

	window.clearTimeout(scheduledResumeQueuedTransfersTimeoutId);
	scheduledResumeQueuedTransfersTimeoutId = null;
	scheduledResumeQueuedTransfersAt = 0;
};

const scheduleQueuedTransferResume = (retryCount: number): void => {
	if (typeof window === 'undefined' || isBrowserOffline())
		return;

	const delay = getAttachmentRetryDelayMs(retryCount);
	const nextRunAt = Date.now() + delay;
	if (scheduledResumeQueuedTransfersTimeoutId !== null && scheduledResumeQueuedTransfersAt <= nextRunAt)
		return;

	clearScheduledQueuedTransferResume();
	scheduledResumeQueuedTransfersAt = nextRunAt;
	scheduledResumeQueuedTransfersTimeoutId = window.setTimeout(() => {
		clearScheduledQueuedTransferResume();
		void resumeQueuedAttachmentTransfers();
	}, delay);
};

const isRecoverableAttachmentError = (error: AttachmentTransferError): boolean => {
	if (error.status === 0)
		return true;

	if (error.code === 'RATE_LIMITED')
		return true;

	if (error.status >= 500)
		return true;

	return false;
};

const markQueuedTransferAsStalled = async (
	queuedTransfer: Pick<TransferQueueRecord, 'id' | 'recipientId' | 'meta' | 'uiSource' | 'retryCount'>,
	error: AttachmentTransferError
): Promise<void> => {
	updateTransferUiState(
		queuedTransfer.id,
		queuedTransfer.recipientId,
		queuedTransfer.meta.name,
		resolveTransferUiSource(queuedTransfer.uiSource),
		'failed',
		'uploading',
		0,
		error.message,
		'stalled',
		queuedTransfer.retryCount + 1
	);

	const latestQueuedTransfer = await getQueuedAttachmentTransfer(queuedTransfer.id);
	if (!latestQueuedTransfer)
		return;

	const nextRetryCount = latestQueuedTransfer.retryCount + 1;
	await updateQueuedAttachmentTransfer(queuedTransfer.id, {
		status: 'stalled',
		retryCount: nextRetryCount,
		lastError: error.message
	});

	if (isRecoverableAttachmentError(error))
		scheduleQueuedTransferResume(nextRetryCount);
};

const buildAttachmentManifestSignaturePayload = (manifest: {
	attachmentId: string;
	uploadId: string;
	senderId: string;
	recipientId: string;
	fileName: string;
	mimeType: string;
	kind: string;
	totalSize: number;
	chunkSize: number;
	chunkCount: number;
	cipher: 'AES-GCM';
	expiresAt: number;
	hashSha256?: string | undefined;
}): string => JSON.stringify({
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

const buildAttachmentAckPayload = (uploadId: string, attachmentId: string): string =>
	`attachment-ack.${uploadId}.${attachmentId}`;

const assertAttachmentMatchesManifest = (attachment: MessageAttachment, manifest: AttachmentManifest): void => {
	if (attachment.id !== manifest.attachmentId
		|| attachment.name !== manifest.fileName
		|| attachment.type !== manifest.mimeType
		|| attachment.size !== manifest.totalSize
		|| attachment.kind !== manifest.kind
		|| attachment.chunkCount !== manifest.chunkCount
		|| attachment.chunkSize !== manifest.chunkSize
		|| (attachment.hashSha256 && attachment.hashSha256 !== manifest.hashSha256)
		|| (attachment.manifestSignature && attachment.manifestSignature !== manifest.signature)) {
		throw new AttachmentTransferError(getAttachmentManifestMismatchMessage(), 0, 'INVALID_FILE_METADATA');
	}
};

const verifyManifestSignature = async (manifest: AttachmentManifest, peerId?: string): Promise<void> => {
	if (!manifest.signature || !manifest.senderId || !manifest.recipientId)
		throw new AttachmentTransferError(getAttachmentManifestSignatureMissingMessage(), 0, 'INVALID_FILE_METADATA');

	const { userId, signingPublicKey } = useAuthStore.getState();
	if (!userId)
		throw new AttachmentTransferError(getAttachmentUserIdentityNotInitializedMessage(), 0, 'UNAUTHORIZED');

	if (peerId && manifest.senderId !== userId && manifest.senderId !== peerId)
		throw new AttachmentTransferError(getAttachmentSenderIdentityMismatchMessage(), 0, 'UNAUTHORIZED');

	const signerKeyBase64 = manifest.senderId === userId
		? signingPublicKey
		: (await getPeerKey(manifest.senderId))?.signingPublicKey;

	if (!signerKeyBase64)
		throw new AttachmentTransferError(getAttachmentSignerKeyMissingMessage(), 0, 'UNAUTHORIZED');

	const signerPublicKey = await importPublicKey(signerKeyBase64, 'ECDSA');
	const isValidSignature = await verifySignature(
		buildAttachmentManifestSignaturePayload({
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
			cipher: manifest.cipher ?? 'AES-GCM',
			expiresAt: manifest.expiresAt,
			hashSha256: manifest.hashSha256
		}),
		manifest.signature,
		signerPublicKey
	);

	if (!isValidSignature)
		throw new AttachmentTransferError(getAttachmentManifestVerificationFailedMessage(), 0, 'UNAUTHORIZED');
};

const acknowledgeAttachmentDownload = async (manifest: AttachmentManifest): Promise<void> => {
	if (!manifest.uploadId)
		return;

	try {
		const signingKeyPair = await getKeyPair('signing');
		if (!signingKeyPair)
			throw new AttachmentTransferError(getAttachmentSigningKeysNotInitializedMessage(), 0, 'UNAUTHORIZED');

		const signature = await signData(
			buildAttachmentAckPayload(manifest.uploadId, manifest.attachmentId),
			signingKeyPair.privateKey
		);

		const ackResponse = await signedFetch('/api/attachments/ack', {
			method: 'POST',
			headers: {
				'Content-Type': 'application/json'
			},
			body: JSON.stringify({
				uploadId: manifest.uploadId,
				signature
			})
		});

		if (!ackResponse.ok)
			await throwFromResponse(ackResponse);
	} catch (error) {
		clientLogger.warn('Failed to acknowledge attachment download:', error);
	}
};

class AttachmentTransferError extends Error {
	readonly code?: AttachmentErrorCode | undefined;
	readonly details?: AttachmentErrorDetails | undefined;
	readonly status: number;

	constructor(message: string, status: number, code?: AttachmentErrorCode, details?: AttachmentErrorDetails) {
		super(message);
		this.name = 'AttachmentTransferError';
		this.code = code;
		this.details = details;
		this.status = status;
	}
}

const normalizeAttachmentTransferError = (error: unknown): AttachmentTransferError => {
	if (error instanceof AttachmentTransferError) {
		return error;
	}

	if (error instanceof Error) {
		if (error.name === 'AbortError') 
			return new AttachmentTransferError(getAttachmentTransferCanceledMessage(), 0);

		if (error instanceof TypeError || /failed to fetch|networkerror|load failed/i.test(error.message)) 
			return new AttachmentTransferError(getAttachmentErrorMessage(undefined, undefined, 0), 0);

		return new AttachmentTransferError(error.message || getAttachmentErrorMessage(), 0);
	}

	return new AttachmentTransferError(getAttachmentErrorMessage(), 0);
};

const throwFromResponse = async (response: Response): Promise<never> => {
	const payload = parseAttachmentApiErrorPayload(await readJsonResponse(response));

	const details = payload?.details ?? (payload?.missingChunks ? { missingChunks: payload.missingChunks } : undefined);
	const code = payload?.code ?? (isAttachmentErrorCode(payload?.error) ? payload.error : undefined);
	throw new AttachmentTransferError(
		getAttachmentErrorMessage(code, details, response.status),
		response.status,
		code,
		details
	);
};

const ensureAttachmentEncryptionMetadata = (attachment: MessageAttachment, chunkCount: number): string[] => {
	if (!attachment.fileKeyBase64 || attachment.chunkIvs?.length !== chunkCount)
		throw new AttachmentTransferError(getAttachmentEncryptionMetadataIncompleteMessage(), 0, 'INVALID_FILE_METADATA');

	return attachment.chunkIvs;
};

const createQueuedAttachmentDraft = (
	initPayload: InitUploadResponse,
	plaintextHashSha256: string,
	fileKeyBase64: string
): MessageAttachment => ({
	id: initPayload.attachmentId,
	name: initPayload.fileName,
	type: initPayload.mimeType,
	size: initPayload.totalSize,
	kind: initPayload.kind,
	chunkCount: initPayload.chunkCount,
	chunkSize: initPayload.chunkSize,
	expiresAt: initPayload.expiresAt,
	cipher: 'AES-GCM',
	encryptionVersion: 1,
	hashSha256: initPayload.hashSha256,
	plaintextHashSha256,
	fileKeyBase64,
	chunkIvs: Array.from({ length: initPayload.chunkCount }, () => '')
});

const uploadChunkWithQueueState = async (
	queuedUploadId: string,
	chunkIndex: number,
	chunkSize: number,
	fileBlob: Blob,
	attachment: MessageAttachment,
	fileKey: CryptoKey,
	onProgress?: (progress: AttachmentTransferProgress) => void,
	totalChunkCount?: number
): Promise<MessageAttachment> => {
	const start = chunkIndex * chunkSize;
	const end = Math.min(start + chunkSize, fileBlob.size);
	const chunkBytes = await fileBlob.slice(start, end).arrayBuffer();
	const nextChunkIvs = [...ensureAttachmentEncryptionMetadata(attachment, attachment.chunkCount ?? 0)];
	let chunkIv = nextChunkIvs[chunkIndex];
	let cipherBytes: ArrayBuffer;

	if (chunkIv) {
		cipherBytes = await encryptBytesWithIv(chunkBytes, chunkIv, fileKey);
	} else {
		const encryptedChunk = await encryptBytes(chunkBytes, fileKey);
		chunkIv = encryptedChunk.iv;
		cipherBytes = encryptedChunk.cipherBytes;
		nextChunkIvs[chunkIndex] = chunkIv;
		const nextAttachment = { ...attachment, chunkIvs: nextChunkIvs };
		await updateQueuedAttachmentTransfer(queuedUploadId, { attachment: nextAttachment });
		attachment = nextAttachment;
	}

	const chunkHashSha256 = await hashBytes(cipherBytes);
	const chunkResponse = await signedFetch(`/api/attachments/${encodeURIComponent(queuedUploadId)}/chunks/${chunkIndex}`, {
		method: 'PUT',
		headers: {
			'Content-Type': 'application/octet-stream',
			'X-Chunk-Sha256': chunkHashSha256
		},
		body: cipherBytes
	});

	if (!chunkResponse.ok)
		await throwFromResponse(chunkResponse);

	onProgress?.({
		phase: 'uploading',
		progress: totalChunkCount ? (chunkIndex + 1) / totalChunkCount : 0
	});

	return attachment;
};

const completeQueuedUpload = async (
	uploadId: string,
	upload: TransferQueueUpload,
	attachment: MessageAttachment,
	messageDispatch: TransferQueueMessageDispatch | undefined,
	uiSource: TransferQueueUiSource,
	persistLocally: boolean,
	recipientId: string,
	fileBlob: Blob,
	userId: string,
	signingPrivateKey: CryptoKey
): Promise<UploadAttachmentResult> => {
	const manifestSignature = await signData(buildAttachmentManifestSignaturePayload({
		attachmentId: upload.attachmentId,
		uploadId,
		senderId: userId,
		recipientId: upload.recipientId,
		fileName: upload.fileName,
		mimeType: upload.mimeType,
		kind: upload.kind,
		totalSize: upload.totalSize,
		chunkSize: upload.chunkSize,
		chunkCount: upload.chunkCount,
		cipher: 'AES-GCM',
		expiresAt: upload.expiresAt,
		hashSha256: upload.hashSha256
	}), signingPrivateKey);

	const completeResponse = await signedFetch(`/api/attachments/${encodeURIComponent(uploadId)}/complete`, {
		method: 'POST',
		headers: {
			'Content-Type': 'application/json'
		},
		body: JSON.stringify({
			hashSha256: upload.hashSha256,
			manifestSignature
		})
	});

	if (!completeResponse.ok)
		await throwFromResponse(completeResponse);

	const manifest = await parseAttachmentJsonResponse(completeResponse, parseAttachmentManifest, 'attachment manifest');
	if (manifest.signature !== manifestSignature)
		throw new AttachmentTransferError(getAttachmentManifestSignatureMismatchMessage(), 0, 'INVALID_FILE_METADATA');

	const completedAttachment: MessageAttachment = {
		...attachment,
		name: manifest.fileName,
		type: manifest.mimeType,
		size: manifest.totalSize,
		kind: manifest.kind,
		chunkCount: manifest.chunkCount,
		chunkSize: manifest.chunkSize,
		expiresAt: manifest.expiresAt,
		hashSha256: manifest.hashSha256,
		manifestSignature: manifest.signature
	};

	if (persistLocally) {
		await saveLocalAttachment({
			attachment: completedAttachment,
			blob: fileBlob,
			peerId: recipientId
		});
	}

	if (messageDispatch) {
		await useMessagesStore.getState().send(recipientId, messageDispatch.content, messageDispatch.replyTo, [completedAttachment]);
	}

	await removeQueuedAttachmentTransfer(uploadId);
	updateTransferUiState(uploadId, recipientId, upload.fileName, uiSource, 'uploaded', 'sending', 1);
	clearTransferUiStateLater(uploadId);
	clearScheduledQueuedTransferResume();
	return { manifest, attachment: completedAttachment };
};

const resumeSingleQueuedAttachmentTransfer = async (uploadId: string): Promise<void> => {
	const queuedTransfer = await getQueuedAttachmentTransfer(uploadId);
	if (!queuedTransfer)
		return;

	if (!queuedTransfer.upload || !queuedTransfer.attachment)
		throw new AttachmentTransferError(getQueuedAttachmentTransferMetadataIncompleteMessage(), 0, 'INVALID_FILE_METADATA');
	const uiSource = resolveTransferUiSource(queuedTransfer.uiSource);

	updateTransferUiState(uploadId, queuedTransfer.recipientId, queuedTransfer.meta.name, uiSource, 'uploading', 'uploading', 0, undefined, queuedTransfer.status, queuedTransfer.retryCount);

	const { userId } = useAuthStore.getState();
	if (!userId)
		return;

	const signingKeyPair = await getKeyPair('signing');
	if (!signingKeyPair)
		throw new AttachmentTransferError(getAttachmentSigningKeysNotInitializedMessage(), 0, 'UNAUTHORIZED');

	const statusResponse = await signedFetch(`/api/attachments/status/${encodeURIComponent(uploadId)}`);
	if (statusResponse.status === 404) {
		clearScheduledQueuedTransferResume();
		await removeQueuedAttachmentTransfer(uploadId);
		useAttachmentTransferStore.getState().clearTransfer(uploadId);
		return;
	}

	if (!statusResponse.ok)
		await throwFromResponse(statusResponse);

	const statusPayload = await parseAttachmentJsonResponse(statusResponse, parseAttachmentStatusResponse, 'attachment status');
	const queuedFileKeyBase64 = queuedTransfer.attachment.fileKeyBase64;
	if (!queuedFileKeyBase64)
		throw new AttachmentTransferError(getAttachmentEncryptionMetadataIncompleteMessage(), 0, 'INVALID_FILE_METADATA');

	const fileKey = await importSymmetricKey(queuedFileKeyBase64);
	let queuedAttachment = queuedTransfer.attachment;
	await updateQueuedAttachmentTransfer(uploadId, {
		status: 'uploading',
		lastError: undefined
	});

	const receivedChunks = new Set(statusPayload.receivedChunks);
	for (let chunkIndex = 0; chunkIndex < statusPayload.totalChunks; chunkIndex++) {
		if (receivedChunks.has(chunkIndex))
			continue;

		queuedAttachment = await uploadChunkWithQueueState(
			uploadId,
			chunkIndex,
			queuedTransfer.upload.chunkSize,
			queuedTransfer.fileBlob,
			queuedAttachment,
			fileKey,
			(progress) => {
				updateTransferUiState(uploadId, queuedTransfer.recipientId, queuedTransfer.meta.name, uiSource, 'uploading', progress.phase, progress.progress, undefined, 'uploading', queuedTransfer.retryCount);
			},
			statusPayload.totalChunks
		);
	}

	await completeQueuedUpload(
		uploadId,
		queuedTransfer.upload,
		queuedAttachment,
		queuedTransfer.messageDispatch,
		uiSource,
		queuedTransfer.persistLocally,
		queuedTransfer.recipientId,
		queuedTransfer.fileBlob,
		userId,
		(signingKeyPair.privateKey)
	);
};

const resumeQueuedAttachmentTransfers = async (): Promise<void> => {
	if (resumeQueuedTransfersPromise)
		return resumeQueuedTransfersPromise;

	clearScheduledQueuedTransferResume();

	resumeQueuedTransfersPromise = (async () => {
		const queuedTransfers = await listQueuedAttachmentTransfers(['pending', 'uploading', 'stalled']);
		for (const queuedTransfer of queuedTransfers) {
			try {
				await resumeSingleQueuedAttachmentTransfer(queuedTransfer.id);
			} catch (error) {
				const normalizedError = normalizeAttachmentTransferError(error);
				await markQueuedTransferAsStalled(queuedTransfer, normalizedError);
			}
		}
	})().finally(() => {
		resumeQueuedTransfersPromise = null;
	});

	return resumeQueuedTransfersPromise;
};

const uploadAttachment = async (
	recipientId: string,
	file: File,
	onProgress?: (progress: AttachmentTransferProgress) => void,
	options?: UploadAttachmentOptions
): Promise<UploadAttachmentResult> => {
	let queuedUploadId: string | null = null;
	try {
		const validation = validateAttachmentFile(file);
		if (!validation.ok) 
			throw new Error(validation.errorMessage);

		const estimatedRequiredStorageBytes = options?.persistLocally === false
			? file.size
			: file.size * 2;
		await ensureTransferStorageCapacity(estimatedRequiredStorageBytes);

		const { userId } = useAuthStore.getState();
		if (!userId)
			throw new Error(getAttachmentUserIdentityNotInitializedMessage());

		const signingKeyPair = await getKeyPair('signing');
		if (!signingKeyPair)
			throw new Error(getAttachmentSigningKeysNotInitializedMessage());

		onProgress?.({ phase: 'encrypting', progress: 0 });

		const plaintextHashSha256 = await hashBytes(await file.arrayBuffer());
		const fileKey = await generateSymmetricKey();
		const fileKeyBase64 = await exportSymmetricKey(fileKey);

		const requestedChunkSize = Math.min(DEFAULT_CHUNK_SIZE, Math.max(1, file.size));
		const requestedChunkCount = Math.max(1, Math.ceil(file.size / requestedChunkSize));

		const initResponse = await signedFetch('/api/attachments/init-upload', {
			method: 'POST',
			headers: {
				'Content-Type': 'application/json'
			},
			body: JSON.stringify({
				recipientId,
				fileName: file.name,
				mimeType: file.type,
				totalSize: file.size,
				chunkSize: requestedChunkSize,
				chunkCount: requestedChunkCount
			})
		});

		if (!initResponse.ok) 
			await throwFromResponse(initResponse);

		const initPayload = await parseAttachmentJsonResponse(initResponse, parseInitUploadResponse, 'attachment init');
		queuedUploadId = initPayload.uploadId;
		const uiSource = resolveTransferUiSource(options?.uiSource);
		updateTransferUiState(initPayload.uploadId, recipientId, file.name, uiSource, 'uploading', 'preparing', 0, undefined, 'pending', 0);
		const queuedAttachment: MessageAttachment = {
			...createQueuedAttachmentDraft(initPayload, plaintextHashSha256, fileKeyBase64),
			localReferenceId: options?.localReferenceId
		};
		await queueAttachmentTransfer({
			id: initPayload.uploadId,
			recipientId,
			fileBlob: file,
			meta: {
				name: file.name,
				size: file.size,
				type: file.type,
				lastModified: file.lastModified
			},
			upload: {
				attachmentId: initPayload.attachmentId,
				recipientId: initPayload.recipientId,
				fileName: initPayload.fileName,
				mimeType: initPayload.mimeType,
				kind: initPayload.kind,
				totalSize: initPayload.totalSize,
				chunkSize: initPayload.chunkSize,
				chunkCount: initPayload.chunkCount,
				hashSha256: initPayload.hashSha256,
				expiresAt: initPayload.expiresAt
			},
			messageDispatch: options?.messageDispatch,
			uiSource,
			attachment: queuedAttachment,
			persistLocally: options?.persistLocally !== false,
			status: 'pending',
			retryCount: 0
		});
		await updateQueuedAttachmentTransfer(initPayload.uploadId, {
			status: 'uploading',
			lastError: undefined
		});

		const chunkSize = Math.max(1, initPayload.chunkSize || requestedChunkSize);
		const chunkCount = Math.max(1, initPayload.chunkCount || requestedChunkCount);
		let queuedAttachmentState = queuedAttachment;

		for (let chunkIndex = 0; chunkIndex < chunkCount; chunkIndex++) {
			queuedAttachmentState = await uploadChunkWithQueueState(
				initPayload.uploadId,
				chunkIndex,
				chunkSize,
				file,
				queuedAttachmentState,
				fileKey,
				(progress) => {
					onProgress?.(progress);
					updateTransferUiState(initPayload.uploadId, recipientId, file.name, uiSource, 'uploading', progress.phase, progress.progress, undefined, 'uploading', 0);
				},
				chunkCount
			);
		}

		onProgress?.({ phase: 'finalizing', progress: 1 });
		updateTransferUiState(initPayload.uploadId, recipientId, file.name, uiSource, 'uploading', 'finalizing', 1, undefined, 'uploading', 0);

		return await completeQueuedUpload(
			initPayload.uploadId,
			{
				attachmentId: initPayload.attachmentId,
				recipientId: initPayload.recipientId,
				fileName: initPayload.fileName,
				mimeType: initPayload.mimeType,
				kind: initPayload.kind,
				totalSize: initPayload.totalSize,
				chunkSize: initPayload.chunkSize,
				chunkCount: initPayload.chunkCount,
				hashSha256: initPayload.hashSha256,
				expiresAt: initPayload.expiresAt
			},
			queuedAttachmentState,
			options?.messageDispatch,
			uiSource,
			options?.persistLocally !== false,
			recipientId,
			file,
			userId,
			signingKeyPair.privateKey
		);
	} catch (error) {
		if (queuedUploadId) {
			const normalizedError = normalizeAttachmentTransferError(error);
			await markQueuedTransferAsStalled({
				id: queuedUploadId,
				recipientId,
				meta: { name: file.name, size: file.size, type: file.type, lastModified: file.lastModified },
				uiSource: options?.uiSource,
				retryCount: 0
			}, normalizedError);
		}
		throw normalizeAttachmentTransferError(error);
	}
};

const markAttachmentTransfersOffline = async (): Promise<void> => {
	clearScheduledQueuedTransferResume();

	const queuedTransfers = await listQueuedAttachmentTransfers(['pending', 'uploading']);
	for (const queuedTransfer of queuedTransfers) {
		const nextRetryCount = queuedTransfer.retryCount + 1;
		await updateQueuedAttachmentTransfer(queuedTransfer.id, {
			status: 'stalled',
			retryCount: nextRetryCount,
			lastError: OFFLINE_STALLED_MESSAGE
		});

		updateTransferUiState(
			queuedTransfer.id,
			queuedTransfer.recipientId,
			queuedTransfer.meta.name,
			resolveTransferUiSource(queuedTransfer.uiSource),
			'failed',
			'uploading',
			0,
			OFFLINE_STALLED_MESSAGE,
			'stalled',
			nextRetryCount
		);
	}
};

const downloadAttachment = async (
	attachment: MessageAttachment,
	onProgress?: (progress: AttachmentTransferProgress) => void,
	options?: DownloadAttachmentOptions
): Promise<AttachmentManifest> => {
	try {
		const exportedFromLocalStore = await exportLocalAttachment(attachment.id, attachment.name);
		if (exportedFromLocalStore) {
			return {
				attachmentId: attachment.id,
				uploadId: '',
				fileName: attachment.name,
				mimeType: attachment.type,
				kind: attachment.kind ?? 'other',
				totalSize: attachment.size,
				chunkSize: resolvePositiveNumber(attachment.chunkSize, attachment.size),
				chunkCount: resolvePositiveNumber(attachment.chunkCount, 1),
				cipher: attachment.cipher,
				hashSha256: attachment.hashSha256,
				createdAt: 0,
				expiresAt: attachment.expiresAt ?? 0
			};
		}

		const manifestResponse = await signedFetch(`/api/attachments/${encodeURIComponent(attachment.id)}/manifest`);
		if (!manifestResponse.ok) {
			await throwFromResponse(manifestResponse);
		}

		const manifest = await parseAttachmentJsonResponse(manifestResponse, parseAttachmentManifest, 'attachment manifest');
		await verifyManifestSignature(manifest, options?.peerId);
		assertAttachmentMatchesManifest(attachment, manifest);
		
		const isEncryptedAttachment = attachment.cipher === 'AES-GCM' && attachment.encryptionVersion === 1;
		const chunkIvs = isEncryptedAttachment ? ensureAttachmentEncryptionMetadata(attachment, manifest.chunkCount) : [];
		let fileKey: CryptoKey | null = null;
		if (isEncryptedAttachment) {
			const encryptedFileKeyBase64 = attachment.fileKeyBase64;
			if (!encryptedFileKeyBase64)
				throw new AttachmentTransferError(getAttachmentEncryptionMetadataIncompleteMessage(), 0, 'INVALID_FILE_METADATA');

			fileKey = await importSymmetricKey(encryptedFileKeyBase64);
		}
		const ciphertextChunks: ArrayBuffer[] = [];
		const plaintextChunks: ArrayBuffer[] = [];

		for (let chunkIndex = 0; chunkIndex < manifest.chunkCount; chunkIndex++) {
			const chunkResponse = await signedFetch(`/api/attachments/${encodeURIComponent(attachment.id)}/chunks/${chunkIndex}`);
			if (!chunkResponse.ok) {
				await throwFromResponse(chunkResponse);
			}

			const chunkBytes = await chunkResponse.arrayBuffer();
			ciphertextChunks.push(chunkBytes);

			if (isEncryptedAttachment && fileKey) {
				const chunkIv = chunkIvs[chunkIndex];
				if (chunkIv === undefined)
					throw new AttachmentTransferError(getAttachmentEncryptionMetadataIncompleteMessage(), 0, 'INVALID_FILE_METADATA');

				plaintextChunks.push(await decryptBytes(chunkIv, chunkBytes, fileKey));
			} else {
				plaintextChunks.push(chunkBytes);
			}

			onProgress?.({
				phase: isEncryptedAttachment ? 'decrypting' : 'uploading',
				progress: (chunkIndex + 1) / manifest.chunkCount
			});
		}

		if (attachment.hashSha256) {
			const ciphertextHashSha256 = await hashBytes(concatArrayBuffers(ciphertextChunks));
			if (ciphertextHashSha256 !== attachment.hashSha256)
				throw new AttachmentTransferError(getAttachmentIntegrityVerificationFailedMessage(), 0, 'CHUNK_HASH_MISMATCH');
		}

		if (attachment.plaintextHashSha256) {
			const plaintextHashSha256 = await hashBytes(concatArrayBuffers(plaintextChunks));
			if (plaintextHashSha256 !== attachment.plaintextHashSha256)
				throw new AttachmentTransferError(getAttachmentIntegrityVerificationFailedMessage(), 0, 'CHUNK_HASH_MISMATCH');
		}

		const blob = new Blob(plaintextChunks, { type: attachment.type || manifest.mimeType });
		await saveLocalAttachment({
			attachment: {
				...attachment,
				name: manifest.fileName,
				type: manifest.mimeType,
				size: manifest.totalSize,
				kind: manifest.kind
			},
			blob,
			peerId: options?.peerId,
			messageId: options?.messageId
		});
		await acknowledgeAttachmentDownload(manifest);
		return manifest;
	} catch (error) {
		throw normalizeAttachmentTransferError(error);
	}
};

export { markAttachmentTransfersOffline, resumeQueuedAttachmentTransfers, uploadAttachment };
export { AttachmentTransferError, downloadAttachment, getAttachmentErrorMessage };
export type { AttachmentTransferProgress, DownloadAttachmentOptions, UploadAttachmentResult };
