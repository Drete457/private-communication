// MessageService - Handles encrypted message sending and receiving

/* 
 * Implements:
 * - Message encryption/decryption using shared keys
 * - Message signing for integrity verification
 * - Local message storage in IndexedDB
 */

import Dexie from 'dexie';
import { v4 as uuidv4 } from 'uuid';

import {
	encryptMessage,
	decryptMessage,
	signData,
	verifySignature,
	deriveSharedKey,
	importPublicKey,
	hashPublicKey,
	generateFingerprint
} from '@/crypto/crypto-service';
import { getKeyPair, getPeerKey, storePeerKey } from '@/crypto/key-manager';
import type { StoredPeerKey } from '@/crypto/key-manager';
import { getAuthSession } from '@/services/auth-session-service';
import { notifyPeerKeysChanged } from '@/services/peer-refresh-service';
import type { AttachmentKind, LocalAttachmentRecord, MessageAttachment, DecryptedMessage, EncryptedMessage, LinkPreviewRecord, MessageStatus, MessageType, RemoteMediaRecord, ReplyAttachmentReference, ReplyReference, TransferQueueRecord } from '@/types';

import { webSocketService } from './web-socket-service';

import type { Table } from 'dexie';

// IndexedDB for message history
class MessageDatabase extends Dexie {
	messages!: Table<DecryptedMessage>;
	linkPreviews!: Table<LinkPreviewRecord>;
	outbox!: Table<OutboxRecord>;
	localAttachments!: Table<LocalAttachmentRecord, string>;
	transferQueue!: Table<TransferQueueRecord, string>;
	remoteMedia!: Table<RemoteMediaRecord, string>;

	constructor() {
		super('PrivateCommunicationMessages');

		this.version(1).stores({
			messages: 'id, senderId, recipientId, timestamp, status',
			linkPreviews: 'url, fetchedAt',
			outbox: 'id, recipientId, createdAt, lastAttemptAt',
			localAttachments: 'attachmentId, peerId, kind, createdAt, updatedAt, lastAccessedAt',
			transferQueue: 'id, recipientId, status, retryCount, createdAt, updatedAt',
			remoteMedia: 'url, sourceHost, extension, isFavorite, peerId, messageId, createdAt, updatedAt, lastAccessedAt, expiresAt'
		});
	}
}

const db = new MessageDatabase();

type SerializedMessagePayload = {
	text: string;
	replyTo?: ReplyReference | undefined;
	attachments?: MessageAttachment[] | undefined;
};

type OutboxRecord = {
	id: string;
	recipientId: string;
	payload: EncryptedMessage;
	createdAt: number;
	lastAttemptAt?: number | undefined;
	attempts: number;
};

type CompletePeerKey = StoredPeerKey & {
	encryptionPublicKey: string;
	signingPublicKey: string;
};

const OUTBOX_MAX_ATTEMPTS = 5;
const OUTBOX_BASE_DELAY_MS = 1500;
const OUTBOX_MAX_DELAY_MS = 30000;

type MessageRecordKey = 'attachment' | 'attachments' | 'content' | 'count' | 'id' | 'kind' | 'name' | 'replyTo' | 'senderId' | 'text' | 'timestamp';
type MessageRecord = Record<string, unknown> & Partial<Record<MessageRecordKey, unknown>>;

const isRecord = (value: unknown): value is MessageRecord => (
	typeof value === 'object' && value !== null && !Array.isArray(value)
);

const getNonEmptyStringOrUndefined = (value: string | null | undefined): string | undefined => (
	value && value.length > 0 ? value : undefined
);

const getNonEmptyStringOrFallback = (value: string | undefined, fallback: string): string => (
	value && value.length > 0 ? value : fallback
);

const getMessageAttachments = (message: Pick<DecryptedMessage, 'attachments'>): ReadonlyArray<MessageAttachment> => (
	message.attachments ?? []
);

const hasMessageAttachments = (message: Pick<DecryptedMessage, 'attachments'>): boolean => (
	getMessageAttachments(message).length > 0
);

const getReferencedAttachmentIds = (message: Pick<DecryptedMessage, 'attachments'>): string[] => (
	getMessageAttachments(message).flatMap((attachment) => {
		const ids = [attachment.id];
		const localReferenceId = getNonEmptyStringOrUndefined(attachment.localReferenceId);
		if (localReferenceId)
			ids.push(localReferenceId);

		return ids;
	})
);

const hasCompletePeerKey = (peerKey: StoredPeerKey | null): peerKey is CompletePeerKey => (
	peerKey?.encryptionPublicKey !== undefined
	&& peerKey.signingPublicKey !== undefined
);

const getMessageLinkMatch = (
	matches: RegExpMatchArray[],
	linkUrl: string,
	linkIndex?: number
): RegExpMatchArray | null => {
	if (linkIndex !== undefined) {
		if (linkIndex < 0 || linkIndex >= matches.length)
			return null;

		const indexedMatch = matches[linkIndex];
		return indexedMatch?.[0] === linkUrl ? indexedMatch : null;
	}

	return matches.find((match) => match[0] === linkUrl) ?? null;
};

const isAttachmentKind = (value: unknown): value is AttachmentKind => (
	value === 'audio'
	|| value === 'image'
	|| value === 'video'
	|| value === 'document'
	|| value === 'other'
);

const parseReplyAttachmentReference = (value: unknown): ReplyAttachmentReference | undefined => {
	if (!isRecord(value) || typeof value.name !== 'string' || typeof value.count !== 'number')
		return undefined;

	const attachment: ReplyAttachmentReference = {
		name: value.name,
		count: value.count
	};

	if (isAttachmentKind(value.kind))
		attachment.kind = value.kind;

	return attachment;
};

const parseReplyReference = (value: unknown): ReplyReference | undefined => {
	if (!isRecord(value) || typeof value.id !== 'string' || typeof value.senderId !== 'string' || typeof value.content !== 'string')
		return undefined;

	const reply: ReplyReference = {
		id: value.id,
		senderId: value.senderId,
		content: value.content
	};

	if (typeof value.timestamp === 'number')
		reply.timestamp = value.timestamp;

	const attachment = parseReplyAttachmentReference(value.attachment);
	if (attachment !== undefined)
		reply.attachment = attachment;

	return reply;
};

const parseMessageAttachment = (value: unknown): MessageAttachment | null => {
	if (!isRecord(value))
		return null;

	const id = value.id;
	const name = value.name;
	const type = value['type'];
	const size = value['size'];
	const kind = value.kind;
	const chunkCount = value['chunkCount'];
	const chunkSize = value['chunkSize'];
	const expiresAt = value['expiresAt'];
	const cipher = value['cipher'];
	const encryptionVersion = value['encryptionVersion'];
	const hashSha256 = value['hashSha256'];
	const plaintextHashSha256 = value['plaintextHashSha256'];
	const manifestSignature = value['manifestSignature'];
	const localReferenceId = value['localReferenceId'];
	const fileKeyBase64 = value['fileKeyBase64'];
	const chunkIvs = value['chunkIvs'];
	const thumbnail = value['thumbnail'];

	if (!isRecord(value)
		|| typeof id !== 'string'
		|| typeof name !== 'string'
		|| typeof type !== 'string'
		|| typeof size !== 'number') {
		return null;
	}

	return {
		id,
		name,
		type,
		size,
		...(isAttachmentKind(kind) ? { kind } : {}),
		...(typeof chunkCount === 'number' ? { chunkCount } : {}),
		...(typeof chunkSize === 'number' ? { chunkSize } : {}),
		...(typeof expiresAt === 'number' ? { expiresAt } : {}),
		...(cipher === 'AES-GCM' ? { cipher } : {}),
		...(encryptionVersion === 1 ? { encryptionVersion } : {}),
		...(typeof hashSha256 === 'string' ? { hashSha256 } : {}),
		...(typeof plaintextHashSha256 === 'string' ? { plaintextHashSha256 } : {}),
		...(typeof manifestSignature === 'string' ? { manifestSignature } : {}),
		...(typeof localReferenceId === 'string' ? { localReferenceId } : {}),
		...(typeof fileKeyBase64 === 'string' ? { fileKeyBase64 } : {}),
		...(Array.isArray(chunkIvs) && chunkIvs.every((item) => typeof item === 'string') ? { chunkIvs } : {}),
		...(typeof thumbnail === 'string' ? { thumbnail } : {})
	};
};

const parseMessageAttachments = (value: unknown): MessageAttachment[] | undefined => {
	if (!Array.isArray(value))
		return undefined;

	const attachments = value.map(parseMessageAttachment);
	return attachments.every((attachment): attachment is MessageAttachment => attachment !== null) ? attachments : undefined;
};

const computeNextAttemptAt = (attempts: number, lastAttemptAt?: number): number => {
	const delay = Math.min(OUTBOX_BASE_DELAY_MS * Math.pow(2, Math.max(attempts - 1, 0)), OUTBOX_MAX_DELAY_MS);
	return (lastAttemptAt ?? Date.now()) + delay;
};

const getMessageTypeFromAttachments = (attachments?: MessageAttachment[]): MessageType => {
	if (!attachments || attachments.length === 0) {
		return 'text';
	}

	const firstAttachment = attachments[0];
	return attachments.length === 1 && firstAttachment?.kind === 'image' ? 'image' : 'file';
};

const stripAttachmentTransferSecrets = (attachment: MessageAttachment): MessageAttachment => ({
	...attachment,
	fileKeyBase64: undefined,
	chunkIvs: undefined
});

const stripAttachmentLocalReference = (attachment: MessageAttachment): MessageAttachment => ({
	...attachment,
	localReferenceId: undefined
});

const serializeAttachmentsForTransport = (attachments?: MessageAttachment[]): MessageAttachment[] | undefined => {
	if (!attachments || attachments.length === 0)
		return undefined;

	return attachments.map(stripAttachmentLocalReference);
};

const deserializeAttachmentsFromTransport = (attachments?: MessageAttachment[]): MessageAttachment[] | undefined => {
	if (!attachments || attachments.length === 0)
		return undefined;

	return attachments.map(stripAttachmentLocalReference);
};

const serializeContent = (text: string, replyTo?: ReplyReference, attachments?: MessageAttachment[]): string => {
	if (!replyTo && (!attachments || attachments.length === 0)) return text;
	return JSON.stringify({ text, replyTo, attachments: serializeAttachmentsForTransport(attachments) } satisfies SerializedMessagePayload);
};

const parseContent = (content: string): SerializedMessagePayload => {
	try {
		const parsed: unknown = JSON.parse(content);
		if (isRecord(parsed) && typeof parsed.text === 'string') {
			const replyTo = parseReplyReference(parsed.replyTo);
			const parsedAttachments = parseMessageAttachments(parsed.attachments);
			const attachments = parsedAttachments
				? deserializeAttachmentsFromTransport(parsedAttachments)
				: undefined;

			return { text: parsed.text, replyTo, attachments };
		}
	} catch {
		return { text: content, attachments: undefined };
	}

	return { text: content, attachments: undefined };
};

const MESSAGE_LINK_REGEX = /(https?:\/\/[^\s]+)/gi;

const normalizeMessageTextAfterLinkRemoval = (value: string): string => {
	return value
		.replace(/[ \t]{2,}/g, ' ')
		.replace(/\s*\n\s*/g, '\n')
		.trim();
};

// Send an encrypted message to a peer
const sendMessage = async (
	recipientId: string,
	content: string,
	type: MessageType = 'text',
	replyTo?: ReplyReference,
	attachments?: MessageAttachment[]
): Promise<DecryptedMessage> => {
	const { userId, publicKey: encryptionPublicKey, signingPublicKey, fingerprint } = getAuthSession();
	if (!userId) {
		throw new Error('User identity not initialized');
	}
	if (!encryptionPublicKey || !signingPublicKey) {
		throw new Error('User keys not initialized');
	}

	// Get our keys
	const encryptionKeyPair = await getKeyPair('encryption');
	const signingKeyPair = await getKeyPair('signing');

	if (!encryptionKeyPair || !signingKeyPair) {
		throw new Error('Keys not initialized');
	}

	// Get recipient's public key
	const peerKey = await getPeerKey(recipientId);
	if (!peerKey) {
		throw new Error('Recipient public key not found');
	}

	const recipientEncryptionKey = peerKey.encryptionPublicKey;
	if (!recipientEncryptionKey) {
		throw new Error('Recipient keys are incomplete. Re-add contact with full contact payload.');
	}

	// Import recipient's public key and derive shared key
	const recipientPublicKey = await importPublicKey(recipientEncryptionKey, 'ECDH');
	const sharedKey = await deriveSharedKey(encryptionKeyPair.privateKey, recipientPublicKey);

	// Encrypt the message
	const payloadToEncrypt = serializeContent(content, replyTo, attachments);
	const { iv, cipherText } = await encryptMessage(payloadToEncrypt, sharedKey);

	// Create message ID and sign the payload
	const messageId = uuidv4();
	const timestamp = Date.now();
	const dataToSign = `${messageId}:${recipientId}:${timestamp}:${cipherText}`;
	const signature = await signData(dataToSign, signingKeyPair.privateKey);

	// Create encrypted message for transmission
	const encryptedMessage: EncryptedMessage = {
		id: messageId,
		senderId: userId,
		recipientId,
		timestamp,
		senderKeys: {
			encryptionPublicKey,
			signingPublicKey,
			fingerprint: getNonEmptyStringOrUndefined(fingerprint)
		},
		payload: {
			iv,
			cipherText
		},
		signature
	};

	// Store locally as decrypted
	const localMessage: DecryptedMessage = {
		id: messageId,
		senderId: userId,
		recipientId,
		timestamp,
		content,
		replyTo,
		type: attachments !== undefined && attachments.length > 0 ? getMessageTypeFromAttachments(attachments) : type,
		status: 'sent',
		attachments: attachments?.map(stripAttachmentTransferSecrets)
	};

	await db.messages.put(localMessage);

	// Send via WebSocket
	const sent = webSocketService.send('send_message', encryptedMessage);
	if (!sent) {
		await queueOutboxMessage(encryptedMessage);
		await updateMessageStatus(messageId, 'failed');
		localMessage.status = 'failed';
	}

	return localMessage;
}

const retryFailedMessage = async (messageId: string): Promise<MessageStatus> => {
	const existing = await getMessageById(messageId);
	if (!existing) {
		throw new Error('Message not found');
	}
	if (existing.status !== 'failed') {
		return existing.status;
	}

	const queued = await db.outbox.get(messageId);
	if (queued) {
		const sent = webSocketService.send('send_message', queued.payload);
		if (!sent) {
			await db.outbox.update(queued.id, {
				lastAttemptAt: Date.now(),
				attempts: queued.attempts + 1
			});
			await updateMessageStatus(existing.id, 'failed');
			return 'failed';
		}

		await db.outbox.delete(queued.id);
		await updateMessageStatus(existing.id, 'sent');
		return 'sent';
	}

	const { userId, publicKey: encryptionPublicKey, signingPublicKey, fingerprint } = getAuthSession();
	if (!userId || existing.senderId !== userId) {
		throw new Error('Message sender mismatch');
	}
	if (!encryptionPublicKey || !signingPublicKey) {
		throw new Error('User keys not initialized');
	}

	const encryptionKeyPair = await getKeyPair('encryption');
	const signingKeyPair = await getKeyPair('signing');

	if (!encryptionKeyPair || !signingKeyPair) {
		throw new Error('Keys not initialized');
	}

	const peerKey = await getPeerKey(existing.recipientId);
	if (!peerKey?.encryptionPublicKey) {
		throw new Error('Recipient public key not found');
	}

	const recipientPublicKey = await importPublicKey(peerKey.encryptionPublicKey, 'ECDH');
	const sharedKey = await deriveSharedKey(encryptionKeyPair.privateKey, recipientPublicKey);

	const payloadToEncrypt = serializeContent(existing.content, existing.replyTo, existing.attachments);
	const { iv, cipherText } = await encryptMessage(payloadToEncrypt, sharedKey);
	const dataToSign = `${existing.id}:${existing.recipientId}:${existing.timestamp}:${cipherText}`;
	const signature = await signData(dataToSign, signingKeyPair.privateKey);

	const encryptedMessage: EncryptedMessage = {
		id: existing.id,
		senderId: userId,
		recipientId: existing.recipientId,
		timestamp: existing.timestamp,
		senderKeys: {
			encryptionPublicKey,
			signingPublicKey,
			fingerprint: getNonEmptyStringOrUndefined(fingerprint)
		},
		payload: {
			iv,
			cipherText
		},
		signature
	};

	const sent = webSocketService.send('send_message', encryptedMessage);
	if (!sent) {
		await queueOutboxMessage(encryptedMessage);
		await updateMessageStatus(existing.id, 'failed');
		return 'failed';
	}

	await updateMessageStatus(existing.id, 'sent');
	return 'sent';
};

const queueOutboxMessage = async (message: EncryptedMessage): Promise<void> => {
	const record: OutboxRecord = {
		id: message.id,
		recipientId: message.recipientId,
		payload: message,
		createdAt: Date.now(),
		attempts: 0
	};
	await db.outbox.put(record);
};

const flushOutbox = async (): Promise<{ sentIds: string[]; failedIds: string[] }> => {
	const sentIds: string[] = [];
	const failedIds: string[] = [];
	if (!webSocketService.isConnected()) {
		return { sentIds, failedIds };
	}

	const pending = await db.outbox.orderBy('createdAt').toArray();
	const now = Date.now();
	for (const entry of pending) {
		if (entry.attempts >= OUTBOX_MAX_ATTEMPTS) {
			await db.outbox.delete(entry.id);
			failedIds.push(entry.id);
			continue;
		}

		const nextAttemptAt = computeNextAttemptAt(entry.attempts + 1, entry.lastAttemptAt);
		if (nextAttemptAt > now) {
			continue;
		}

		const sent = webSocketService.send('send_message', entry.payload);
		await db.outbox.update(entry.id, {
			lastAttemptAt: now,
			attempts: entry.attempts + 1
		});
		if (!sent) {
			break;
		}
		await db.outbox.delete(entry.id);
		sentIds.push(entry.id);
	}

	return { sentIds, failedIds };
};

// Decrypt and process an incoming message
const processIncomingMessage = async (
	encryptedMessage: EncryptedMessage
): Promise<DecryptedMessage> => {
	const encryptionKeyPair = await getKeyPair('encryption');

	if (!encryptionKeyPair) {
		throw new Error('Keys not initialized');
	}

	// Get sender's public key
	const peerKey = await getPeerKey(encryptedMessage.senderId);
	let effectivePeerKey = peerKey;

	if (!hasCompletePeerKey(effectivePeerKey)) {
		const senderKeys = encryptedMessage.senderKeys;
		if (!senderKeys?.encryptionPublicKey || !senderKeys.signingPublicKey) {
			throw new Error('Sender public key not found');
		}

		// Validate senderId matches encryption key
		const importedSenderKey = await importPublicKey(senderKeys.encryptionPublicKey, 'ECDH');
		const derivedSenderId = await hashPublicKey(importedSenderKey);
		if (derivedSenderId !== encryptedMessage.senderId) {
			throw new Error('Sender identity mismatch');
		}

		const derivedFingerprint = await generateFingerprint(importedSenderKey);
		await storePeerKey(
			derivedSenderId,
			senderKeys.encryptionPublicKey,
			senderKeys.signingPublicKey,
			getNonEmptyStringOrFallback(senderKeys.fingerprint, derivedFingerprint)
		);

		await notifyPeerKeysChanged();

		effectivePeerKey = await getPeerKey(derivedSenderId);
		if (!hasCompletePeerKey(effectivePeerKey)) {
			throw new Error('Sender keys are incomplete');
		}
	}

	// Import sender's keys
	const senderPublicKey = await importPublicKey(effectivePeerKey.encryptionPublicKey, 'ECDH');
	const senderSigningKey = await importPublicKey(effectivePeerKey.signingPublicKey, 'ECDSA');

	// Verify signature
	const dataToVerify = `${encryptedMessage.id}:${encryptedMessage.recipientId}:${encryptedMessage.timestamp}:${encryptedMessage.payload.cipherText}`;
	const isValid = await verifySignature(
		dataToVerify,
		encryptedMessage.signature,
		senderSigningKey
	);

	if (!isValid) {
		throw new Error('Message signature verification failed');
	}

	// Derive shared key and decrypt
	const sharedKey = await deriveSharedKey(encryptionKeyPair.privateKey, senderPublicKey);
	const decryptedContent = await decryptMessage(
		encryptedMessage.payload.iv,
		encryptedMessage.payload.cipherText,
		sharedKey
	);

	const { text, replyTo, attachments } = parseContent(decryptedContent);

	// Store decrypted message
	const decryptedMessage: DecryptedMessage = {
		id: encryptedMessage.id,
		senderId: encryptedMessage.senderId,
		recipientId: encryptedMessage.recipientId,
		timestamp: encryptedMessage.timestamp,
		content: text,
		replyTo,
		type: getMessageTypeFromAttachments(attachments),
		attachments,
		status: 'delivered'
	};

	await db.messages.put(decryptedMessage);

	// Send acknowledgment
	webSocketService.send('message_ack', {
		messageId: encryptedMessage.id,
		senderId: encryptedMessage.senderId
	});

	return decryptedMessage;
}

// Get message history with a peer
const getMessageHistory = async (
	peerId: string,
	limit = 50,
	beforeTimestamp?: number
): Promise<DecryptedMessage[]> => {
	return db.messages
		.where('senderId').equals(peerId)
		.or('recipientId').equals(peerId)
		.filter(message => beforeTimestamp === undefined || message.timestamp < beforeTimestamp)
		.sortBy('timestamp')
		.then(messages => messages.slice(-limit));
}

// Update message status
const updateMessageStatus = async (
	messageId: string,
	status: MessageStatus
): Promise<void> => {
	await db.messages.update(messageId, { status });
}

// Get a message by id
const getMessageById = async (messageId: string): Promise<DecryptedMessage | undefined> => {
	return db.messages.get(messageId);
}

const saveLocalMessage = async (message: DecryptedMessage): Promise<void> => {
	await db.messages.put(message);
}

const deleteMessageLinkOccurrence = async (messageId: string, linkUrl: string, linkIndex?: number): Promise<boolean> => {
	const message = await db.messages.get(messageId);
	if (!message)
		return false;

	const matches = Array.from(message.content.matchAll(MESSAGE_LINK_REGEX));
	const targetMatch = getMessageLinkMatch(matches, linkUrl, linkIndex);

	if (!targetMatch)
		return false;

	const targetIndex = targetMatch.index;
	if (targetIndex === undefined)
		return false;

	const nextContent = normalizeMessageTextAfterLinkRemoval(
		`${message.content.slice(0, targetIndex)}${message.content.slice(targetIndex + targetMatch[0].length)}`
	);

	if (nextContent.length === 0 && !hasMessageAttachments(message) && !message.replyTo) {
		await db.messages.delete(messageId);
		return true;
	}

	await db.messages.put({
		...message,
		content: nextContent,
		type: hasMessageAttachments(message)
			? getMessageTypeFromAttachments(message.attachments)
			: 'text'
	});

	return true;
};

// Delete all messages with a peer
const deleteConversation = async (peerId: string): Promise<void> => {
	const relatedMessages = await db.messages
		.where('senderId').equals(peerId)
		.or('recipientId').equals(peerId)
		.toArray();

	const attachmentIds = Array.from(new Set(
		relatedMessages.flatMap(getReferencedAttachmentIds)
	));

	const remainingMessages = await db.messages
		.where('senderId').notEqual(peerId)
		.and((message) => message.recipientId !== peerId)
		.toArray();

	const referencedAttachmentIds = new Set(
		remainingMessages.flatMap(getReferencedAttachmentIds)
	);

	const orphanAttachmentIds = attachmentIds.filter((attachmentId) => !referencedAttachmentIds.has(attachmentId));

	await db.transaction('rw', db.messages, db.localAttachments, async () => {
		await db.messages
			.where('senderId').equals(peerId)
			.or('recipientId').equals(peerId)
			.delete();

		if (orphanAttachmentIds.length > 0) {
			await db.localAttachments.bulkDelete(orphanAttachmentIds);
		}

		const recordsByPeer = await db.localAttachments.where('peerId').equals(peerId).primaryKeys();
		if (recordsByPeer.length > 0) {
			const orphanRecordsByPeer = recordsByPeer.filter((attachmentId) => !referencedAttachmentIds.has(attachmentId));
			if (orphanRecordsByPeer.length > 0)
				await db.localAttachments.bulkDelete(orphanRecordsByPeer);
		}
	});
}

// Clear all local message history
const clearMessageDatabase = async (): Promise<void> => {
	await db.delete();
	await db.open();
}

// Get stored link preview
const getLinkPreview = async (url: string): Promise<LinkPreviewRecord | undefined> => {
	return db.linkPreviews.get(url);
}

// Save link preview
const saveLinkPreview = async (preview: LinkPreviewRecord): Promise<void> => {
	await db.linkPreviews.put(preview);
}

export { db, sendMessage, retryFailedMessage, processIncomingMessage, getMessageHistory, updateMessageStatus, getMessageById, saveLocalMessage, deleteMessageLinkOccurrence, deleteConversation, clearMessageDatabase, getLinkPreview, saveLinkPreview, flushOutbox };


