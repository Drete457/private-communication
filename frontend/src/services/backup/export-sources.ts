import {
	unlockIdentityCapsule
} from '@/crypto';
import {
	db as keyDatabase,
	getIdentityCapsule,
	getKeyPair
	
} from '@/crypto/key-manager';
import type {StoredPeerKey} from '@/crypto/key-manager';
import type {
	DecryptedMessage,
	LinkPreviewRecord,
	LocalAttachmentRecord,
	MessageAttachment,
	RemoteMediaRecord,
	TransferQueueRecord
} from '@/types';
import type {
	BackupBlobExportSource,
	BackupOutboxRecord,
	IdentityRecordPayload
} from '@/types/backup';

import { db as messageDatabase } from '../message-service';

const isDefined = <T>(value: T | undefined): value is T => value !== undefined;

const removeAttachmentInlineData = (attachment: MessageAttachment): MessageAttachment => {
	const sanitizedAttachment = { ...attachment };
	delete sanitizedAttachment.data;
	return sanitizedAttachment;
};

const sanitizeMessageAttachments = (attachments?: MessageAttachment[]): MessageAttachment[] | undefined => {
	if (!attachments || attachments.length === 0)
		return undefined;

	return attachments.map(removeAttachmentInlineData);
};

const sanitizeMessageRecord = (message: DecryptedMessage): DecryptedMessage => ({
	...message,
	attachments: sanitizeMessageAttachments(message.attachments)
});

const toOrderedStringKeys = async (keysPromise: Promise<unknown[]>): Promise<string[]> => {
	const keys = await keysPromise;
	return keys.map((key) => String(key));
};

const loadIdentityRecordPayload = async (): Promise<IdentityRecordPayload> => {
	const capsule = await getIdentityCapsule();

	if (!capsule)
		throw new Error('Identity capsule not found');

	const encryptionKeyPair = await getKeyPair('encryption');

	if (!encryptionKeyPair)
		throw new Error('Encryption key pair not found');

	return {
		identity: await unlockIdentityCapsule(capsule, encryptionKeyPair.privateKey)
	};
};

const listPeerKeyIds = async (): Promise<string[]> => {
	return toOrderedStringKeys(keyDatabase.peerKeys.orderBy('addedAt').primaryKeys());
};

const loadPeerKeysBatch = async (peerIds: string[]): Promise<StoredPeerKey[]> => {
	const records = await keyDatabase.peerKeys.bulkGet(peerIds);
	return records.filter(isDefined);
};

const listMessageIds = async (): Promise<string[]> => {
	return toOrderedStringKeys(messageDatabase.messages.orderBy('timestamp').primaryKeys());
};

const loadMessagesBatch = async (messageIds: string[]): Promise<DecryptedMessage[]> => {
	const records = await messageDatabase.messages.bulkGet(messageIds);
	return records.filter(isDefined).map(sanitizeMessageRecord);
};

const listLinkPreviewIds = async (): Promise<string[]> => {
	return toOrderedStringKeys(messageDatabase.linkPreviews.orderBy('fetchedAt').primaryKeys());
};

const loadLinkPreviewBatch = async (urls: string[]): Promise<LinkPreviewRecord[]> => {
	const records = await messageDatabase.linkPreviews.bulkGet(urls);
	return records.filter(isDefined);
};

const listOutboxIds = async (): Promise<string[]> => {
	return toOrderedStringKeys(messageDatabase.outbox.orderBy('createdAt').primaryKeys());
};

const loadOutboxBatch = async (outboxIds: string[]): Promise<BackupOutboxRecord[]> => {
	const records = await messageDatabase.outbox.bulkGet(outboxIds);
	return records.filter(isDefined).map((record) => ({ ...record }));
};

const scanLocalAttachmentSources = async (): Promise<BackupBlobExportSource[]> => {
	const sources: BackupBlobExportSource[] = [];

	await messageDatabase.localAttachments.orderBy('createdAt').each((record) => {
		sources.push({
			id: record.attachmentId,
			size: record.size
		});
	});

	return sources;
};

const loadLocalAttachmentRecord = async (attachmentId: string): Promise<LocalAttachmentRecord | null> => {
	return (await messageDatabase.localAttachments.get(attachmentId)) ?? null;
};

const scanTransferQueueSources = async (): Promise<BackupBlobExportSource[]> => {
	const sources: BackupBlobExportSource[] = [];

	await messageDatabase.transferQueue.orderBy('createdAt').each((record) => {
		sources.push({
			id: record.id,
			size: record.fileBlob.size
		});
	});

	return sources;
};

const loadTransferQueueRecord = async (transferQueueId: string): Promise<TransferQueueRecord | null> => {
	return (await messageDatabase.transferQueue.get(transferQueueId)) ?? null;
};

const scanRemoteMediaSources = async (): Promise<BackupBlobExportSource[]> => {
	const sources: BackupBlobExportSource[] = [];

	await messageDatabase.remoteMedia.orderBy('createdAt').each((record) => {
		sources.push({
			id: record.url,
			size: record.blob.size
		});
	});

	return sources;
};

const loadRemoteMediaRecord = async (url: string): Promise<RemoteMediaRecord | null> => {
	return (await messageDatabase.remoteMedia.get(url)) ?? null;
};

export {
	listLinkPreviewIds,
	listMessageIds,
	listOutboxIds,
	listPeerKeyIds,
	loadIdentityRecordPayload,
	loadLinkPreviewBatch,
	loadLocalAttachmentRecord,
	loadMessagesBatch,
	loadOutboxBatch,
	loadPeerKeysBatch,
	loadRemoteMediaRecord,
	loadTransferQueueRecord,
	scanLocalAttachmentSources,
	scanRemoteMediaSources,
	scanTransferQueueSources
};