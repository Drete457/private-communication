import { createIdentityCapsule  } from '@/crypto';
import type {IdentityPayload} from '@/crypto';
import type { StoredPeerKey } from '@/crypto/key-manager';
import {
	buildIdentityProvisionResult
	
} from '@/services/identity-provision-service';
import type {PersistedIdentityProvision} from '@/services/identity-provision-service';
import type {
	DecryptedMessage,
	LinkPreviewRecord,
	LocalAttachmentRecord,
	RemoteMediaRecord,
	TransferQueueRecord
} from '@/types';
import type {
	AttachmentMetaRecordPayload,
	BackupOutboxRecord,
	BackupRestoreError,
	BackupRestoreErrorCode,
	BackupRestoreProgressStage,
	ParsedChunkedBackupObject,
	ParsedPcbkBackup,
	RemoteMediaMetaRecordPayload,
	TransferQueueMetaRecordPayload
} from '@/types/backup';

import type { PCBKMode } from '@private-communication/pcbk-core';

type PreparedMessageDatabaseState = {
	messages: DecryptedMessage[];
	attachments: LocalAttachmentRecord[];
	remoteMedia: RemoteMediaRecord[];
	linkPreviews: LinkPreviewRecord[];
	outbox: BackupOutboxRecord[];
	transferQueue: TransferQueueRecord[];
};

type PreparedRestoreState = {
	mode: PCBKMode;
	provision: PersistedIdentityProvision;
	peers: StoredPeerKey[];
	messageState: PreparedMessageDatabaseState;
};

const createRestoreError = (
	code: BackupRestoreErrorCode,
	message: string,
	stage: BackupRestoreProgressStage = 'assembling-state',
	cause?: unknown
): BackupRestoreError => {
	const error = new Error(message) as BackupRestoreError;
	error.name = 'BackupRestoreError';
	error.code = code;
	error.stage = stage;

	if (cause !== undefined)
		error.cause = cause;

	return error;
};

const assertCondition: (
	condition: unknown,
	message: string,
	code?: BackupRestoreErrorCode
) => asserts condition = (
	condition: unknown,
	message: string,
	code: BackupRestoreErrorCode = 'malformed-backup'
): asserts condition => {
	if (!condition)
		throw createRestoreError(code, message);
};

const createEmptyMessageDatabaseState = (): PreparedMessageDatabaseState => ({
	messages: [],
	attachments: [],
	remoteMedia: [],
	linkPreviews: [],
	outbox: [],
	transferQueue: []
});

const createBlobFromChunks = (chunks: Uint8Array[], mimeType: string): Blob => {
	return new Blob(chunks.map((chunk) => Uint8Array.from(chunk)), { type: mimeType });
};

const stageIdentityProvision = async (identityPayload: IdentityPayload): Promise<PersistedIdentityProvision> => {
	const provision = await buildIdentityProvisionResult(identityPayload);
	assertCondition(provision.userId === identityPayload.identity.userId, 'Identity payload userId does not match derived provision.');
	assertCondition(provision.fingerprint === identityPayload.identity.fingerprint, 'Identity payload fingerprint does not match derived provision.');
	assertCondition(
		provision.encryptionPublicKey === identityPayload.identity.encryption.publicKeySpki,
		'Identity payload encryption key does not match derived provision.'
	);
	assertCondition(
		provision.signingPublicKey === identityPayload.identity.signing.publicKeySpki,
		'Identity payload signing key does not match derived provision.'
	);

	const capsule = await createIdentityCapsule(identityPayload, provision.runtimeEncryptionKeyPair.publicKey);
	return {
		...provision,
		capsule
	};
};

const mapAttachmentRecord = (
	entry: ParsedChunkedBackupObject<AttachmentMetaRecordPayload>
): LocalAttachmentRecord => {
	assertCondition(entry.objectId === entry.meta.attachmentId, `Attachment objectId ${entry.objectId} does not match metadata.`);
	assertCondition(entry.chunks.length === entry.meta.chunkCount, `Attachment ${entry.objectId} chunk count does not match metadata.`);
	assertCondition(entry.totalBytes === entry.meta.size, `Attachment ${entry.objectId} size does not match metadata.`);

	return {
		attachmentId: entry.meta.attachmentId,
		...(entry.meta.peerId !== null ? { peerId: entry.meta.peerId } : {}),
		...(entry.meta.messageId !== null ? { messageId: entry.meta.messageId } : {}),
		fileName: entry.meta.fileName,
		mimeType: entry.meta.mimeType,
		size: entry.meta.size,
		...(entry.meta.kind !== null ? { kind: entry.meta.kind } : {}),
		...(entry.meta.plaintextHashSha256 !== null
			? { plaintextHashSha256: entry.meta.plaintextHashSha256 }
			: {}),
		blob: createBlobFromChunks(entry.chunks, entry.meta.mimeType),
		createdAt: entry.meta.createdAt,
		updatedAt: entry.meta.updatedAt,
		lastAccessedAt: entry.meta.lastAccessedAt
	};
};

const mapTransferQueueRecord = (
	entry: ParsedChunkedBackupObject<TransferQueueMetaRecordPayload>
): TransferQueueRecord => {
	assertCondition(entry.objectId === entry.meta.id, `Transfer queue objectId ${entry.objectId} does not match metadata.`);
	assertCondition(entry.chunks.length === entry.meta.chunkCount, `Transfer queue ${entry.objectId} chunk count does not match metadata.`);
	assertCondition(entry.totalBytes === entry.meta.meta.size, `Transfer queue ${entry.objectId} size does not match metadata.`);

	if (entry.meta.upload)
		assertCondition(
			entry.meta.upload.totalSize === entry.totalBytes,
			`Transfer queue ${entry.objectId} upload size does not match chunk bytes.`
		);

	return {
		id: entry.meta.id,
		recipientId: entry.meta.recipientId,
		fileBlob: createBlobFromChunks(entry.chunks, entry.meta.meta.type),
		meta: entry.meta.meta,
		...(entry.meta.upload !== null ? { upload: entry.meta.upload } : {}),
		...(entry.meta.messageDispatch !== null ? { messageDispatch: entry.meta.messageDispatch } : {}),
		...(entry.meta.uiSource !== null ? { uiSource: entry.meta.uiSource } : {}),
		...(entry.meta.attachment !== null ? { attachment: entry.meta.attachment } : {}),
		...(entry.meta.manifest !== null ? { manifest: entry.meta.manifest } : {}),
		persistLocally: entry.meta.persistLocally,
		status: entry.meta.status,
		retryCount: entry.meta.retryCount,
		createdAt: entry.meta.createdAt,
		updatedAt: entry.meta.updatedAt,
		...(entry.meta.lastError !== null ? { lastError: entry.meta.lastError } : {})
	};
};

const mapRemoteMediaRecord = (
	entry: ParsedChunkedBackupObject<RemoteMediaMetaRecordPayload>
): RemoteMediaRecord => {
	assertCondition(entry.objectId === entry.meta.mediaId, `Remote media objectId ${entry.objectId} does not match metadata.`);
	assertCondition(entry.chunks.length === entry.meta.chunkCount, `Remote media ${entry.objectId} chunk count does not match metadata.`);

	return {
		url: entry.meta.url,
		blob: createBlobFromChunks(entry.chunks, entry.meta.mimeType),
		mimeType: entry.meta.mimeType,
		extension: entry.meta.extension,
		isFavorite: entry.meta.isFavorite,
		sourceHost: entry.meta.sourceHost,
		...(entry.meta.peerId !== null ? { peerId: entry.meta.peerId } : {}),
		...(entry.meta.messageId !== null ? { messageId: entry.meta.messageId } : {}),
		createdAt: entry.meta.createdAt,
		updatedAt: entry.meta.updatedAt,
		lastAccessedAt: entry.meta.lastAccessedAt,
		expiresAt: entry.meta.expiresAt
	};
};

const assertIdentityOnlyBackupShape = (backup: ParsedPcbkBackup): void => {
	const unexpectedSections = [
		backup.peerKeys.length > 0 ? 'peer keys' : null,
		backup.messages.length > 0 ? 'messages' : null,
		backup.linkPreviews.length > 0 ? 'link previews' : null,
		backup.outbox.length > 0 ? 'outbox' : null,
		backup.attachments.length > 0 ? 'attachments' : null,
		backup.transferQueue.length > 0 ? 'transfer queue' : null,
		backup.remoteMedia.length > 0 ? 'remote media' : null
	].filter((value): value is string => value !== null);

	assertCondition(
		unexpectedSections.length === 0,
		`Identity-only backup contains unexpected restored data: ${unexpectedSections.join(', ')}.`
	);
};

const assemblePreparedPcbkRestoreState = async (backup: ParsedPcbkBackup): Promise<PreparedRestoreState> => {
	const provision = await stageIdentityProvision(backup.identity);

	if (backup.clearHeader.mode === 'identity-only') {
		assertIdentityOnlyBackupShape(backup);
		return {
			mode: backup.clearHeader.mode,
			provision,
			peers: [],
			messageState: createEmptyMessageDatabaseState()
		};
	}

	return {
		mode: backup.clearHeader.mode,
		provision,
		peers: [...backup.peerKeys],
		messageState: {
			messages: [...backup.messages],
			attachments: backup.attachments.map(mapAttachmentRecord),
			remoteMedia: backup.remoteMedia.map(mapRemoteMediaRecord),
			linkPreviews: [...backup.linkPreviews],
			outbox: [...backup.outbox],
			transferQueue: backup.transferQueue.map(mapTransferQueueRecord)
		}
	};
};

export {
	assemblePreparedPcbkRestoreState,
	createEmptyMessageDatabaseState,
	stageIdentityProvision,
	type PreparedMessageDatabaseState,
	type PreparedRestoreState
};