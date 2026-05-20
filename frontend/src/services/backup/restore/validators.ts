import { validateIdentityPayload } from '@/crypto';
import type { StoredPeerKey } from '@/crypto/key-manager';
import { AttachmentType } from '@/types';
import type {
	AttachmentKind,
	AttachmentManifest,
	BackupOutboxRecord,
	DecryptedMessage,
	EncryptedMessage,
	LinkPreviewRecord,
	MessageAttachment,
	TransferQueueMessageDispatch,
	TransferQueueMeta,
	TransferQueueUpload
} from '@/types';
import type {
	AttachmentMetaRecordPayload,
	BackupBatchPayload,
	IdentityRecordPayload,
	RemoteMediaMetaRecordPayload,
	TransferQueueMetaRecordPayload
} from '@/types/backup';

const MESSAGE_TYPES = new Set<string>(['text', 'file', 'image', 'audio', 'video']);
const MESSAGE_STATUSES = new Set<string>(['pending', 'sent', 'delivered', 'read', 'failed']);
const ATTACHMENT_KINDS = new Set<string>(['audio', 'image', 'video', 'document', 'other']);
const TRANSFER_QUEUE_STATUSES = new Set<string>(['pending', 'uploading', 'stalled', 'completed']);
const UI_SOURCES = new Set<string>([AttachmentType.chat, AttachmentType.forward]);

type RestoreRecordKey =
	| 'addedAt'
	| 'attachment'
	| 'attachmentId'
	| 'attachments'
	| 'attempts'
	| 'chunkCount'
	| 'chunkIvs'
	| 'chunkSize'
	| 'cipher'
	| 'cipherText'
	| 'content'
	| 'count'
	| 'createdAt'
	| 'data'
	| 'description'
	| 'displayName'
	| 'encryption'
	| 'encryptionPublicKey'
	| 'encryptionVersion'
	| 'ephemeralPublicKey'
	| 'expiresAt'
	| 'extension'
	| 'fetchedAt'
	| 'fileKeyBase64'
	| 'fileName'
	| 'fingerprint'
	| 'hashSha256'
	| 'id'
	| 'identity'
	| 'image'
	| 'isFavorite'
	| 'items'
	| 'iv'
	| 'kind'
	| 'lastAccessedAt'
	| 'lastAttemptAt'
	| 'lastError'
	| 'lastModified'
	| 'lastVerified'
	| 'localReferenceId'
	| 'manifest'
	| 'manifestSignature'
	| 'mediaId'
	| 'messageDispatch'
	| 'messageId'
	| 'meta'
	| 'mimeType'
	| 'name'
	| 'payload'
	| 'peerId'
	| 'persistLocally'
	| 'plaintextHashSha256'
	| 'privateKeyPkcs8'
	| 'publicKeySpki'
	| 'recipientId'
	| 'replyTo'
	| 'retryCount'
	| 'senderId'
	| 'senderKeys'
	| 'signature'
	| 'signing'
	| 'signingPublicKey'
	| 'siteName'
	| 'size'
	| 'sourceHost'
	| 'status'
	| 'thumbnail'
	| 'timestamp'
	| 'title'
	| 'totalSize'
	| 'type'
	| 'uiSource'
	| 'updatedAt'
	| 'upload'
	| 'uploadId'
	| 'url'
	| 'userId'
	| 'version';

type RestoreRecord = Record<string, unknown> & Partial<Record<RestoreRecordKey, unknown>>;

const isRecord = (value: unknown): value is RestoreRecord => {
	if (!value || typeof value !== 'object' || Array.isArray(value))
		return false;

	const prototype = Reflect.getPrototypeOf(value);
	return prototype === Object.prototype || prototype === null;
};

const isString = (value: unknown): value is string => typeof value === 'string';

const isNonNegativeSafeInteger = (value: unknown): value is number => {
	return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0;
};

const isPositiveSafeInteger = (value: unknown): value is number => {
	return typeof value === 'number' && Number.isSafeInteger(value) && value > 0;
};

const isBoolean = (value: unknown): value is boolean => typeof value === 'boolean';

const isOptionalString = (value: unknown): value is string | undefined => value === undefined || isString(value);

const isOptionalNonNegativeSafeInteger = (value: unknown): value is number | undefined => value === undefined || isNonNegativeSafeInteger(value);

const isOptionalPositiveSafeInteger = (value: unknown): value is number | undefined => value === undefined || isPositiveSafeInteger(value);

const assertCondition: (condition: unknown, message: string) => asserts condition = (condition, message) => {
	if (!condition)
		throw new Error(message);
};

const isAttachmentKind = (value: unknown): value is AttachmentKind => {
	return isString(value) && ATTACHMENT_KINDS.has(value);
};

const isMessageType = (value: unknown): value is DecryptedMessage['type'] => {
	return isString(value) && MESSAGE_TYPES.has(value);
};

const isMessageStatus = (value: unknown): value is DecryptedMessage['status'] => {
	return isString(value) && MESSAGE_STATUSES.has(value);
};

const isTransferQueueStatus = (value: unknown): value is TransferQueueMetaRecordPayload['status'] => {
	return isString(value) && TRANSFER_QUEUE_STATUSES.has(value);
};

const isTransferQueueUiSource = (value: unknown): value is TransferQueueMetaRecordPayload['uiSource'] => {
	return value === null || (isString(value) && UI_SOURCES.has(value));
};

const validateStoredPeerKey = (value: unknown): StoredPeerKey => {
	assertCondition(isRecord(value), 'Peer key must be an object');
	assertCondition(isString(value.peerId), 'Peer key peerId must be a string');
	assertCondition(isString(value.fingerprint), 'Peer key fingerprint must be a string');
	assertCondition(isNonNegativeSafeInteger(value.addedAt), 'Peer key addedAt must be a non-negative safe integer');
	assertCondition(isOptionalString(value.encryptionPublicKey), 'Peer key encryptionPublicKey must be a string when present');
	assertCondition(isOptionalString(value.signingPublicKey), 'Peer key signingPublicKey must be a string when present');
	assertCondition(isOptionalString(value.displayName), 'Peer key displayName must be a string when present');
	assertCondition(isOptionalNonNegativeSafeInteger(value.lastVerified), 'Peer key lastVerified must be a non-negative safe integer when present');

	return {
		peerId: value.peerId,
		encryptionPublicKey: value.encryptionPublicKey,
		signingPublicKey: value.signingPublicKey,
		displayName: value.displayName,
		fingerprint: value.fingerprint,
		addedAt: value.addedAt,
		lastVerified: value.lastVerified
	};
};

const validateReplyReference = (value: unknown): NonNullable<DecryptedMessage['replyTo']> => {
	assertCondition(isRecord(value), 'Reply reference must be an object');
	assertCondition(isString(value.id), 'Reply reference id must be a string');
	assertCondition(isString(value.senderId), 'Reply reference senderId must be a string');
	assertCondition(isString(value.content), 'Reply reference content must be a string');
	assertCondition(isOptionalNonNegativeSafeInteger(value.timestamp), 'Reply reference timestamp must be a non-negative safe integer when present');
	assertCondition(value.attachment === undefined || isRecord(value.attachment), 'Reply attachment must be an object when present');

	const attachment = value.attachment;
	let parsedAttachment: NonNullable<DecryptedMessage['replyTo']>['attachment'];
	if (attachment) {
		const attachmentName = attachment.name;
		const attachmentCount = attachment.count;
		const attachmentKind = attachment.kind;
		assertCondition(isString(attachmentName), 'Reply attachment name must be a string');
		assertCondition(isPositiveSafeInteger(attachmentCount), 'Reply attachment count must be a positive safe integer');
		assertCondition(attachmentKind === undefined || isAttachmentKind(attachmentKind), 'Reply attachment kind must be valid when present');

		parsedAttachment = {
			name: attachmentName,
			kind: isAttachmentKind(attachmentKind) ? attachmentKind : undefined,
			count: attachmentCount
		};
	}

	return {
		id: value.id,
		senderId: value.senderId,
		content: value.content,
		timestamp: value.timestamp,
		attachment: parsedAttachment
	};
};

const validateMessageAttachment = (value: unknown): MessageAttachment => {
	assertCondition(isRecord(value), 'Message attachment must be an object');
	assertCondition(isString(value.id), 'Message attachment id must be a string');
	assertCondition(isString(value.name), 'Message attachment name must be a string');
	assertCondition(isString(value.type), 'Message attachment type must be a string');
	assertCondition(isNonNegativeSafeInteger(value.size), 'Message attachment size must be a non-negative safe integer');
	assertCondition(value.kind === undefined || isAttachmentKind(value.kind), 'Message attachment kind must be valid when present');
	assertCondition(isOptionalPositiveSafeInteger(value.chunkCount), 'Message attachment chunkCount must be a positive safe integer when present');
	assertCondition(isOptionalPositiveSafeInteger(value.chunkSize), 'Message attachment chunkSize must be a positive safe integer when present');
	assertCondition(isOptionalNonNegativeSafeInteger(value.expiresAt), 'Message attachment expiresAt must be a non-negative safe integer when present');
	assertCondition(value.cipher === undefined || value.cipher === 'AES-GCM', 'Message attachment cipher must be AES-GCM when present');
	assertCondition(value.encryptionVersion === undefined || value.encryptionVersion === 1, 'Message attachment encryptionVersion must be 1 when present');
	assertCondition(isOptionalString(value.hashSha256), 'Message attachment hashSha256 must be a string when present');
	assertCondition(isOptionalString(value.plaintextHashSha256), 'Message attachment plaintextHashSha256 must be a string when present');
	assertCondition(isOptionalString(value.manifestSignature), 'Message attachment manifestSignature must be a string when present');
	assertCondition(isOptionalString(value.localReferenceId), 'Message attachment localReferenceId must be a string when present');
	assertCondition(isOptionalString(value.fileKeyBase64), 'Message attachment fileKeyBase64 must be a string when present');
	assertCondition(value.chunkIvs === undefined || (Array.isArray(value.chunkIvs) && value.chunkIvs.every(isString)), 'Message attachment chunkIvs must be string array when present');
	assertCondition(value.data === undefined, 'Message attachment inline data is not allowed in PCBK records');
	assertCondition(isOptionalString(value.thumbnail), 'Message attachment thumbnail must be a string when present');

	return {
		id: value.id,
		name: value.name,
		type: value.type,
		size: value.size,
		kind: value.kind,
		chunkCount: value.chunkCount,
		chunkSize: value.chunkSize,
		expiresAt: value.expiresAt,
		cipher: value.cipher,
		encryptionVersion: value.encryptionVersion,
		hashSha256: value.hashSha256,
		plaintextHashSha256: value.plaintextHashSha256,
		manifestSignature: value.manifestSignature,
		localReferenceId: value.localReferenceId,
		fileKeyBase64: value.fileKeyBase64,
		chunkIvs: value.chunkIvs,
		thumbnail: value.thumbnail
	};
};

const validateDecryptedMessage = (value: unknown): DecryptedMessage => {
	assertCondition(isRecord(value), 'Message must be an object');
	assertCondition(isString(value.id), 'Message id must be a string');
	assertCondition(isString(value.senderId), 'Message senderId must be a string');
	assertCondition(isString(value.recipientId), 'Message recipientId must be a string');
	assertCondition(isNonNegativeSafeInteger(value.timestamp), 'Message timestamp must be a non-negative safe integer');
	assertCondition(isString(value.content), 'Message content must be a string');
	assertCondition(isMessageType(value.type), 'Message type is not supported');
	assertCondition(isMessageStatus(value.status), 'Message status is not supported');
	assertCondition(value.replyTo === undefined || isRecord(value.replyTo), 'Message replyTo must be an object when present');
	assertCondition(value.attachments === undefined || Array.isArray(value.attachments), 'Message attachments must be an array when present');

	return {
		id: value.id,
		senderId: value.senderId,
		recipientId: value.recipientId,
		timestamp: value.timestamp,
		content: value.content,
		replyTo: value.replyTo ? validateReplyReference(value.replyTo) : undefined,
		type: value.type,
		status: value.status,
		attachments: value.attachments?.map(validateMessageAttachment)
	};
};

const validateLinkPreviewRecord = (value: unknown): LinkPreviewRecord => {
	assertCondition(isRecord(value), 'Link preview must be an object');
	assertCondition(isString(value.url), 'Link preview url must be a string');
	assertCondition(isOptionalString(value.title), 'Link preview title must be a string when present');
	assertCondition(isOptionalString(value.description), 'Link preview description must be a string when present');
	assertCondition(isOptionalString(value.image), 'Link preview image must be a string when present');
	assertCondition(isOptionalString(value.siteName), 'Link preview siteName must be a string when present');
	assertCondition(isNonNegativeSafeInteger(value.fetchedAt), 'Link preview fetchedAt must be a non-negative safe integer');

	return {
		url: value.url,
		title: value.title,
		description: value.description,
		image: value.image,
		siteName: value.siteName,
		fetchedAt: value.fetchedAt
	};
};

const validateEncryptedMessage = (value: unknown): EncryptedMessage => {
	assertCondition(isRecord(value), 'Encrypted message must be an object');
	assertCondition(isString(value.id), 'Encrypted message id must be a string');
	assertCondition(isString(value.senderId), 'Encrypted message senderId must be a string');
	assertCondition(isString(value.recipientId), 'Encrypted message recipientId must be a string');
	assertCondition(isNonNegativeSafeInteger(value.timestamp), 'Encrypted message timestamp must be a non-negative safe integer');
	assertCondition(isString(value.signature), 'Encrypted message signature must be a string');
	assertCondition(value.senderKeys === undefined || isRecord(value.senderKeys), 'Encrypted message senderKeys must be an object when present');
	assertCondition(isRecord(value.payload), 'Encrypted message payload must be an object');
	assertCondition(isString(value.payload.iv), 'Encrypted message payload iv must be a string');
	assertCondition(isString(value.payload.cipherText), 'Encrypted message payload cipherText must be a string');
	assertCondition(isOptionalString(value.payload.ephemeralPublicKey), 'Encrypted message payload ephemeralPublicKey must be a string when present');

	const senderKeys = value.senderKeys;
	let parsedSenderKeys: EncryptedMessage['senderKeys'];
	if (senderKeys) {
		const encryptionPublicKey = senderKeys.encryptionPublicKey;
		const signingPublicKey = senderKeys.signingPublicKey;
		const fingerprint = senderKeys.fingerprint;
		assertCondition(isString(encryptionPublicKey), 'Encrypted message senderKeys.encryptionPublicKey must be a string');
		assertCondition(isString(signingPublicKey), 'Encrypted message senderKeys.signingPublicKey must be a string');
		assertCondition(isOptionalString(fingerprint), 'Encrypted message senderKeys.fingerprint must be a string when present');

		parsedSenderKeys = {
			encryptionPublicKey,
			signingPublicKey,
			fingerprint
		};
	}

	return {
		id: value.id,
		senderId: value.senderId,
		recipientId: value.recipientId,
		timestamp: value.timestamp,
		senderKeys: parsedSenderKeys,
		payload: {
			iv: value.payload.iv,
			cipherText: value.payload.cipherText,
			ephemeralPublicKey: value.payload.ephemeralPublicKey
		},
		signature: value.signature
	};
};

const validateBackupOutboxRecord = (value: unknown): BackupOutboxRecord => {
	assertCondition(isRecord(value), 'Outbox record must be an object');
	assertCondition(isString(value.id), 'Outbox record id must be a string');
	assertCondition(isString(value.recipientId), 'Outbox record recipientId must be a string');
	assertCondition(isNonNegativeSafeInteger(value.createdAt), 'Outbox record createdAt must be a non-negative safe integer');
	assertCondition(isOptionalNonNegativeSafeInteger(value.lastAttemptAt), 'Outbox record lastAttemptAt must be a non-negative safe integer when present');
	assertCondition(isNonNegativeSafeInteger(value.attempts), 'Outbox record attempts must be a non-negative safe integer');

	return {
		id: value.id,
		recipientId: value.recipientId,
		payload: validateEncryptedMessage(value.payload),
		createdAt: value.createdAt,
		lastAttemptAt: value.lastAttemptAt,
		attempts: value.attempts
	};
};

const validateTransferQueueMeta = (value: unknown): TransferQueueMeta => {
	assertCondition(isRecord(value), 'Transfer queue meta must be an object');
	assertCondition(isString(value.name), 'Transfer queue meta name must be a string');
	assertCondition(isNonNegativeSafeInteger(value.size), 'Transfer queue meta size must be a non-negative safe integer');
	assertCondition(isString(value.type), 'Transfer queue meta type must be a string');
	assertCondition(isNonNegativeSafeInteger(value.lastModified), 'Transfer queue meta lastModified must be a non-negative safe integer');

	return {
		name: value.name,
		size: value.size,
		type: value.type,
		lastModified: value.lastModified
	};
};

const validateTransferQueueUpload = (value: unknown): TransferQueueUpload => {
	assertCondition(isRecord(value), 'Transfer queue upload must be an object');
	assertCondition(isString(value.attachmentId), 'Transfer queue upload attachmentId must be a string');
	assertCondition(isString(value.recipientId), 'Transfer queue upload recipientId must be a string');
	assertCondition(isString(value.fileName), 'Transfer queue upload fileName must be a string');
	assertCondition(isString(value.mimeType), 'Transfer queue upload mimeType must be a string');
	assertCondition(isAttachmentKind(value.kind), 'Transfer queue upload kind must be valid');
	assertCondition(isPositiveSafeInteger(value.totalSize), 'Transfer queue upload totalSize must be a positive safe integer');
	assertCondition(isPositiveSafeInteger(value.chunkSize), 'Transfer queue upload chunkSize must be a positive safe integer');
	assertCondition(isPositiveSafeInteger(value.chunkCount), 'Transfer queue upload chunkCount must be a positive safe integer');
	assertCondition(isOptionalString(value.hashSha256), 'Transfer queue upload hashSha256 must be a string when present');
	assertCondition(isNonNegativeSafeInteger(value.expiresAt), 'Transfer queue upload expiresAt must be a non-negative safe integer');

	return {
		attachmentId: value.attachmentId,
		recipientId: value.recipientId,
		fileName: value.fileName,
		mimeType: value.mimeType,
		kind: value.kind,
		totalSize: value.totalSize,
		chunkSize: value.chunkSize,
		chunkCount: value.chunkCount,
		hashSha256: value.hashSha256,
		expiresAt: value.expiresAt
	};
};

const validateTransferQueueMessageDispatch = (value: unknown): TransferQueueMessageDispatch => {
	assertCondition(isRecord(value), 'Transfer queue messageDispatch must be an object');
	assertCondition(isString(value.content), 'Transfer queue messageDispatch content must be a string');
	assertCondition(value.replyTo === undefined || isRecord(value.replyTo), 'Transfer queue messageDispatch replyTo must be an object when present');

	return {
		content: value.content,
		replyTo: value.replyTo ? validateReplyReference(value.replyTo) : undefined
	};
};

const validateAttachmentManifest = (value: unknown): AttachmentManifest => {
	assertCondition(isRecord(value), 'Attachment manifest must be an object');
	assertCondition(isString(value.attachmentId), 'Attachment manifest attachmentId must be a string');
	assertCondition(isString(value.uploadId), 'Attachment manifest uploadId must be a string');
	assertCondition(isOptionalString(value.senderId), 'Attachment manifest senderId must be a string when present');
	assertCondition(isOptionalString(value.recipientId), 'Attachment manifest recipientId must be a string when present');
	assertCondition(isString(value.fileName), 'Attachment manifest fileName must be a string');
	assertCondition(isString(value.mimeType), 'Attachment manifest mimeType must be a string');
	assertCondition(isAttachmentKind(value.kind), 'Attachment manifest kind must be valid');
	assertCondition(isPositiveSafeInteger(value.totalSize), 'Attachment manifest totalSize must be a positive safe integer');
	assertCondition(isPositiveSafeInteger(value.chunkSize), 'Attachment manifest chunkSize must be a positive safe integer');
	assertCondition(isPositiveSafeInteger(value.chunkCount), 'Attachment manifest chunkCount must be a positive safe integer');
	assertCondition(value.cipher === undefined || value.cipher === 'AES-GCM', 'Attachment manifest cipher must be AES-GCM when present');
	assertCondition(isOptionalString(value.hashSha256), 'Attachment manifest hashSha256 must be a string when present');
	assertCondition(isOptionalString(value.signature), 'Attachment manifest signature must be a string when present');
	assertCondition(isNonNegativeSafeInteger(value.createdAt), 'Attachment manifest createdAt must be a non-negative safe integer');
	assertCondition(isNonNegativeSafeInteger(value.expiresAt), 'Attachment manifest expiresAt must be a non-negative safe integer');

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
		cipher: value.cipher,
		hashSha256: value.hashSha256,
		signature: value.signature,
		createdAt: value.createdAt,
		expiresAt: value.expiresAt
	};
};

const validateIdentityRecordPayload = (value: unknown): IdentityRecordPayload => {
	assertCondition(isRecord(value), 'Identity record payload must be an object');

	return {
		identity: validateIdentityPayload(value.identity)
	};
};

const validateBatchPayload = <T>(value: unknown, itemValidator: (item: unknown) => T, label: string): BackupBatchPayload<T> => {
	assertCondition(isRecord(value), `${label} payload must be an object`);
	assertCondition(Array.isArray(value.items), `${label} payload items must be an array`);

	return {
		items: value.items.map(itemValidator)
	};
};

const validateAttachmentMetaRecordPayload = (value: unknown): AttachmentMetaRecordPayload => {
	assertCondition(isRecord(value), 'Attachment meta payload must be an object');
	assertCondition(isString(value.attachmentId), 'Attachment meta attachmentId must be a string');
	assertCondition(value.peerId === null || isString(value.peerId), 'Attachment meta peerId must be null or string');
	assertCondition(value.messageId === null || isString(value.messageId), 'Attachment meta messageId must be null or string');
	assertCondition(isString(value.fileName), 'Attachment meta fileName must be a string');
	assertCondition(isString(value.mimeType), 'Attachment meta mimeType must be a string');
	assertCondition(isNonNegativeSafeInteger(value.size), 'Attachment meta size must be a non-negative safe integer');
	assertCondition(value.kind === null || isAttachmentKind(value.kind), 'Attachment meta kind must be null or valid kind');
	assertCondition(value.plaintextHashSha256 === null || isString(value.plaintextHashSha256), 'Attachment meta plaintextHashSha256 must be null or string');
	assertCondition(isNonNegativeSafeInteger(value.createdAt), 'Attachment meta createdAt must be a non-negative safe integer');
	assertCondition(isNonNegativeSafeInteger(value.updatedAt), 'Attachment meta updatedAt must be a non-negative safe integer');
	assertCondition(isNonNegativeSafeInteger(value.lastAccessedAt), 'Attachment meta lastAccessedAt must be a non-negative safe integer');
	assertCondition(isPositiveSafeInteger(value.chunkSize), 'Attachment meta chunkSize must be a positive safe integer');
	assertCondition(isPositiveSafeInteger(value.chunkCount), 'Attachment meta chunkCount must be a positive safe integer');

	return {
		attachmentId: value.attachmentId,
		peerId: value.peerId,
		messageId: value.messageId,
		fileName: value.fileName,
		mimeType: value.mimeType,
		size: value.size,
		kind: value.kind,
		plaintextHashSha256: value.plaintextHashSha256,
		createdAt: value.createdAt,
		updatedAt: value.updatedAt,
		lastAccessedAt: value.lastAccessedAt,
		chunkSize: value.chunkSize,
		chunkCount: value.chunkCount
	};
};

const validateTransferQueueMetaRecordPayload = (value: unknown): TransferQueueMetaRecordPayload => {
	assertCondition(isRecord(value), 'Transfer queue meta payload must be an object');
	assertCondition(isString(value.id), 'Transfer queue meta id must be a string');
	assertCondition(isString(value.recipientId), 'Transfer queue meta recipientId must be a string');
	assertCondition(isBoolean(value.persistLocally), 'Transfer queue meta persistLocally must be a boolean');
	assertCondition(isTransferQueueStatus(value.status), 'Transfer queue meta status is not supported');
	assertCondition(isNonNegativeSafeInteger(value.retryCount), 'Transfer queue meta retryCount must be a non-negative safe integer');
	assertCondition(isNonNegativeSafeInteger(value.createdAt), 'Transfer queue meta createdAt must be a non-negative safe integer');
	assertCondition(isNonNegativeSafeInteger(value.updatedAt), 'Transfer queue meta updatedAt must be a non-negative safe integer');
	assertCondition(value.lastError === null || isString(value.lastError), 'Transfer queue meta lastError must be null or string');
	assertCondition(isPositiveSafeInteger(value.chunkSize), 'Transfer queue meta chunkSize must be a positive safe integer');
	assertCondition(isPositiveSafeInteger(value.chunkCount), 'Transfer queue meta chunkCount must be a positive safe integer');
	assertCondition(isTransferQueueUiSource(value.uiSource), 'Transfer queue meta uiSource is not supported');

	const uiSource = value.uiSource;
	const status = value.status;

	return {
		id: value.id,
		recipientId: value.recipientId,
		meta: validateTransferQueueMeta(value.meta),
		upload: value.upload === null ? null : validateTransferQueueUpload(value.upload),
		messageDispatch: value.messageDispatch === null ? null : validateTransferQueueMessageDispatch(value.messageDispatch),
		uiSource,
		attachment: value.attachment === null ? null : validateMessageAttachment(value.attachment),
		manifest: value.manifest === null ? null : validateAttachmentManifest(value.manifest),
		persistLocally: value.persistLocally,
		status,
		retryCount: value.retryCount,
		createdAt: value.createdAt,
		updatedAt: value.updatedAt,
		lastError: value.lastError,
		chunkSize: value.chunkSize,
		chunkCount: value.chunkCount
	};
};

const validateRemoteMediaMetaRecordPayload = (value: unknown): RemoteMediaMetaRecordPayload => {
	assertCondition(isRecord(value), 'Remote media meta payload must be an object');
	assertCondition(isString(value.mediaId), 'Remote media meta mediaId must be a string');
	assertCondition(isString(value.url), 'Remote media meta url must be a string');
	assertCondition(isString(value.mimeType), 'Remote media meta mimeType must be a string');
	assertCondition(isString(value.extension), 'Remote media meta extension must be a string');
	assertCondition(isBoolean(value.isFavorite), 'Remote media meta isFavorite must be a boolean');
	assertCondition(isString(value.sourceHost), 'Remote media meta sourceHost must be a string');
	assertCondition(value.peerId === null || isString(value.peerId), 'Remote media meta peerId must be null or string');
	assertCondition(value.messageId === null || isString(value.messageId), 'Remote media meta messageId must be null or string');
	assertCondition(isNonNegativeSafeInteger(value.createdAt), 'Remote media meta createdAt must be a non-negative safe integer');
	assertCondition(isNonNegativeSafeInteger(value.updatedAt), 'Remote media meta updatedAt must be a non-negative safe integer');
	assertCondition(isNonNegativeSafeInteger(value.lastAccessedAt), 'Remote media meta lastAccessedAt must be a non-negative safe integer');
	assertCondition(isNonNegativeSafeInteger(value.expiresAt), 'Remote media meta expiresAt must be a non-negative safe integer');
	assertCondition(isPositiveSafeInteger(value.chunkSize), 'Remote media meta chunkSize must be a positive safe integer');
	assertCondition(isPositiveSafeInteger(value.chunkCount), 'Remote media meta chunkCount must be a positive safe integer');

	return {
		mediaId: value.mediaId,
		url: value.url,
		mimeType: value.mimeType,
		extension: value.extension,
		isFavorite: value.isFavorite,
		sourceHost: value.sourceHost,
		peerId: value.peerId,
		messageId: value.messageId,
		createdAt: value.createdAt,
		updatedAt: value.updatedAt,
		lastAccessedAt: value.lastAccessedAt,
		expiresAt: value.expiresAt,
		chunkSize: value.chunkSize,
		chunkCount: value.chunkCount
	};
};

export {
	assertCondition,
	validateAttachmentMetaRecordPayload,
	validateBackupOutboxRecord,
	validateBatchPayload,
	validateDecryptedMessage,
	validateIdentityPayload,
	validateIdentityRecordPayload,
	validateLinkPreviewRecord,
	validateRemoteMediaMetaRecordPayload,
	validateStoredPeerKey,
	validateTransferQueueMetaRecordPayload
};