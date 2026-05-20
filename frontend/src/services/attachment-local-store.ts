import { getAttachmentLocalStorageCapacityMessage } from '@/helpers/attachments';
import { downloadFile } from '@/helpers/media';
import type { AttachmentManifest, LocalAttachmentRecord, MessageAttachment, TransferQueueMessageDispatch, TransferQueueMeta, TransferQueueRecord, TransferQueueStatus, TransferQueueUiSource, TransferQueueUpload } from '@/types';

import { db } from './message-service';

type SaveLocalAttachmentInput = {
	attachment: MessageAttachment;
	blob: Blob;
	peerId?: string | undefined;
	messageId?: string | undefined;
};

type QueueAttachmentTransferInput = {
	id: string;
	recipientId: string;
	fileBlob: Blob;
	meta: TransferQueueMeta;
	upload?: TransferQueueUpload | undefined;
	messageDispatch?: TransferQueueMessageDispatch | undefined;
	uiSource?: TransferQueueUiSource | undefined;
	attachment?: MessageAttachment | undefined;
	manifest?: AttachmentManifest | undefined;
	persistLocally?: boolean | undefined;
	status?: TransferQueueStatus | undefined;
	retryCount?: number | undefined;
	lastError?: string | undefined;
};

type UpdateTransferQueueInput = Partial<Omit<TransferQueueRecord, 'id' | 'recipientId' | 'fileBlob' | 'meta' | 'createdAt'>>;

type NavigatorWithOptionalStorage = Navigator & {
	storage?: Pick<StorageManager, 'estimate'>;
};

type GlobalStorageApis = {
	navigator?: NavigatorWithOptionalStorage;
};

const TRANSFER_STORAGE_OVERHEAD_BYTES = 64 * 1024;

const stripAttachmentTransferSecrets = (attachment: MessageAttachment): MessageAttachment => ({
	...attachment,
	fileKeyBase64: undefined,
	chunkIvs: undefined
});

const getStorageEstimate = (): (() => Promise<StorageEstimate>) | undefined => {
	const storage = (globalThis as GlobalStorageApis).navigator?.storage;

	if (!storage)
		return undefined;

	return () => storage.estimate();
};

const ensureTransferStorageCapacity = async (requiredBytes: number): Promise<void> => {
	const estimateStorage = getStorageEstimate();

	if (!estimateStorage)
		return;

	const estimate = await estimateStorage();
	const quota = estimate.quota;
	const usage = estimate.usage ?? 0;
	if (quota === undefined || quota <= 0)
		return;

	if (usage + requiredBytes + TRANSFER_STORAGE_OVERHEAD_BYTES > quota)
		throw new Error(getAttachmentLocalStorageCapacityMessage());
};

const queueAttachmentTransfer = async ({
	id,
	recipientId,
	fileBlob,
	meta,
	upload,
	messageDispatch,
	uiSource,
	attachment,
	manifest,
	persistLocally = true,
	status = 'pending',
	retryCount = 0,
	lastError
}: QueueAttachmentTransferInput): Promise<TransferQueueRecord> => {
	const now = Date.now();
	const existing = await db.transferQueue.get(id);
	const record: TransferQueueRecord = {
		id,
		recipientId,
		fileBlob,
		meta,
		upload,
		messageDispatch,
		uiSource,
		attachment,
		manifest,
		persistLocally,
		status,
		retryCount,
		createdAt: existing?.createdAt ?? now,
		updatedAt: now,
		lastError
	};

	await db.transferQueue.put(record);
	return record;
};

const updateQueuedAttachmentTransfer = async (id: string, updates: UpdateTransferQueueInput): Promise<void> => {
	await db.transferQueue.update(id, {
		...updates,
		updatedAt: Date.now()
	});
};

const getQueuedAttachmentTransfer = async (id: string): Promise<TransferQueueRecord | undefined> => {
	return db.transferQueue.get(id);
};

const listQueuedAttachmentTransfers = async (statuses?: TransferQueueStatus[]): Promise<TransferQueueRecord[]> => {
	const transfers = await db.transferQueue.orderBy('updatedAt').toArray();
	if (!statuses || statuses.length === 0)
		return transfers;

	const allowedStatuses = new Set(statuses);
	return transfers.filter((transfer) => allowedStatuses.has(transfer.status));
};

const removeQueuedAttachmentTransfer = async (id: string): Promise<void> => {
	await db.transferQueue.delete(id);
};

const saveLocalAttachment = async ({ attachment, blob, peerId, messageId }: SaveLocalAttachmentInput): Promise<LocalAttachmentRecord> => {
	const now = Date.now();
	const existing = await db.localAttachments.get(attachment.id);
	const record: LocalAttachmentRecord = {
		attachmentId: attachment.id,
		peerId,
		messageId,
		fileName: attachment.name,
		mimeType: attachment.type,
		size: attachment.size,
		kind: attachment.kind,
		plaintextHashSha256: attachment.plaintextHashSha256,
		blob,
		createdAt: existing?.createdAt ?? now,
		updatedAt: now,
		lastAccessedAt: now
	};

	await db.transaction('rw', db.localAttachments, db.messages, async () => {
		await db.localAttachments.put(record);

		const messages = await db.messages.toArray();
		for (const message of messages) {
			if (message.attachments === undefined || message.attachments.length === 0) 
				continue;

			const hasAttachment = message.attachments.some((currentAttachment) => currentAttachment.id === attachment.id);
			if (!hasAttachment)
				continue;

			const nextAttachments = message.attachments.map((currentAttachment) => {
				if (currentAttachment.id !== attachment.id) 
					return currentAttachment;

				return stripAttachmentTransferSecrets(currentAttachment);
			});

			await db.messages.put({
				...message,
				attachments: nextAttachments
			});
		}
	});

	return record;
};

const getLocalAttachment = async (attachmentId: string): Promise<LocalAttachmentRecord | undefined> => {
	const record = await db.localAttachments.get(attachmentId);
	if (!record) 
		return undefined;

	await db.localAttachments.update(attachmentId, { lastAccessedAt: Date.now() });
	return record;
};

const getLocalAttachments = async (attachmentIds: string[]): Promise<LocalAttachmentRecord[]> => {
	if (attachmentIds.length === 0) 
		return [];

	const records = await db.localAttachments.bulkGet(attachmentIds);
	return records.filter((record): record is LocalAttachmentRecord => record !== undefined);
};

const exportLocalAttachment = async (attachmentId: string, preferredFileName?: string): Promise<boolean> => {
	const record = await getLocalAttachment(attachmentId);
	if (!record) 
		return false;

	downloadFile(record.blob, preferredFileName ?? record.fileName);
	return true;
};

const deleteLocalAttachment = async (attachmentId: string): Promise<boolean> => {
	const record = await db.localAttachments.get(attachmentId);
	if (!record)
		return false;

	await db.localAttachments.delete(attachmentId);
	return true;
};

export {
	deleteLocalAttachment,
	ensureTransferStorageCapacity,
	exportLocalAttachment,
	getLocalAttachment,
	getLocalAttachments,
	getQueuedAttachmentTransfer,
	listQueuedAttachmentTransfers,
	queueAttachmentTransfer,
	removeQueuedAttachmentTransfer,
	saveLocalAttachment,
	updateQueuedAttachmentTransfer
};
export type { QueueAttachmentTransferInput, SaveLocalAttachmentInput, UpdateTransferQueueInput };