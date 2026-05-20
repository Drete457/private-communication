import type { AttachmentKind, DecryptedMessage, LocalAttachmentRecord } from '@/types';

import { deleteLocalAttachment } from './attachment-local-store';
import { db, deleteMessageLinkOccurrence } from './message-service';
import { deleteRemoteMedia } from './remote-media-cache';

type LibraryKind = 'gif' | 'image' | 'video' | 'audio' | 'file' | 'link';
type LibraryItemSource = 'remote-media' | 'local-attachment' | 'message-link';

type LibraryItem = {
	id: string;
	kind: LibraryKind;
	source: LibraryItemSource;
	label: string;
	peerId: string;
	timestamp: number;
	sizeBytes: number;
	messageId?: string | undefined;
	attachmentId?: string | undefined;
	remoteMediaUrl?: string | undefined;
	linkUrl?: string | undefined;
	linkIndex?: number | undefined;
};

const LIBRARY_CONTENT_TYPES: Array<{ kind: LibraryKind; title: string; emoji: string }> = [
	{ kind: 'gif', title: 'GIFs', emoji: '🌀' },
	{ kind: 'image', title: 'Images', emoji: '🖼️' },
	{ kind: 'video', title: 'Videos', emoji: '🎬' },
	{ kind: 'audio', title: 'Audio', emoji: '🎵' },
	{ kind: 'file', title: 'Files', emoji: '📄' },
	{ kind: 'link', title: 'Links', emoji: '🔗' }
];

const urlRegex = /(https?:\/\/[^\s]+)/gi;

const estimateStringBytes = (value: string): number => new TextEncoder().encode(value).length;

const resolveAttachmentKind = (attachmentKind?: AttachmentKind, mimeType?: string): LibraryKind => {
	if (attachmentKind === 'image' || attachmentKind === 'video' || attachmentKind === 'audio')
		return attachmentKind;

	if (mimeType?.startsWith('image/'))
		return 'image';

	if (mimeType?.startsWith('video/'))
		return 'video';

	if (mimeType?.startsWith('audio/'))
		return 'audio';

	return 'file';
};

const getPeerId = (message: DecryptedMessage, authUserId: string | null): string =>
	message.senderId === authUserId ? message.recipientId : message.senderId;

const resolveStoredPeerId = (storedPeerId: string | undefined, fallbackPeerId: string): string => (
	storedPeerId && storedPeerId.length > 0 ? storedPeerId : fallbackPeerId
);

const buildAttachmentItem = (
	record: LocalAttachmentRecord,
	message: DecryptedMessage | undefined,
	authUserId: string | null
): LibraryItem => {
	const fallbackPeerId = message ? getPeerId(message, authUserId) : '';
	const peerId = resolveStoredPeerId(record.peerId, fallbackPeerId);

	return {
		id: `local-attachment:${record.attachmentId}`,
		kind: resolveAttachmentKind(record.kind, record.mimeType),
		source: 'local-attachment',
		label: record.fileName,
		peerId,
		timestamp: message?.timestamp ?? record.updatedAt,
		sizeBytes: record.size,
		messageId: record.messageId,
		attachmentId: record.attachmentId
	};
};

const getLibraryItems = async (authUserId: string | null): Promise<LibraryItem[]> => {
	const [messages, remoteMedia, localAttachments] = await Promise.all([
		db.messages.toArray(),
		db.remoteMedia.toArray(),
		db.localAttachments.toArray()
	]);

	const messageMap = new Map(messages.map((message) => [message.id, message]));
	const nextItems: LibraryItem[] = [];

	remoteMedia
		.filter((record) => record.extension === '.gif')
		.forEach((record) => {
			nextItems.push({
				id: `remote-gif:${record.url}`,
				kind: 'gif',
				source: 'remote-media',
				label: record.url,
				peerId: record.peerId ?? '',
				timestamp: record.lastAccessedAt,
				sizeBytes: record.blob.size,
				messageId: record.messageId,
				remoteMediaUrl: record.url
			});
		});

	localAttachments.forEach((record) => {
		nextItems.push(buildAttachmentItem(record, record.messageId ? messageMap.get(record.messageId) : undefined, authUserId));
	});

	for (const message of messages) {
		const peerId = getPeerId(message, authUserId);
		const links = Array.from(message.content.matchAll(urlRegex));

		links.forEach((match, index) => {
			nextItems.push({
				id: `${message.id}:link:${index}`,
				kind: 'link',
				source: 'message-link',
				label: match[0],
				peerId,
				timestamp: message.timestamp,
				sizeBytes: estimateStringBytes(match[0]),
				messageId: message.id,
				linkUrl: match[0],
				linkIndex: index
			});
		});
	}

	const dedupedItems = nextItems.filter((item, index, collection) =>
		collection.findIndex((candidate) => candidate.id === item.id) === index
	);

	dedupedItems.sort((left, right) => right.timestamp - left.timestamp);
	return dedupedItems;
};

const deleteLibraryItem = async (item: LibraryItem): Promise<boolean> => {
	if (item.source === 'remote-media' && item.remoteMediaUrl)
		return deleteRemoteMedia(item.remoteMediaUrl);

	if (item.source === 'local-attachment' && item.attachmentId)
		return deleteLocalAttachment(item.attachmentId);

	if (item.source === 'message-link' && item.messageId && item.linkUrl) {
		return deleteMessageLinkOccurrence(item.messageId, item.linkUrl, item.linkIndex);
	}

	return false;
};

const deleteLibraryItems = async (items: ReadonlyArray<LibraryItem>): Promise<number> => {
	const uniqueItems = items.filter((item, index, collection) =>
		collection.findIndex((candidate) => candidate.id === item.id) === index
	);

	if (uniqueItems.length === 0)
		return 0;

	const remoteMediaUrls = new Set<string>();
	const attachmentIds = new Set<string>();
	const linksByMessage = new Map<string, Array<{ url: string; index: number }>>();

	uniqueItems.forEach((item) => {
		if (item.source === 'remote-media' && item.remoteMediaUrl) {
			remoteMediaUrls.add(item.remoteMediaUrl);
			return;
		}

		if (item.source === 'local-attachment' && item.attachmentId) {
			attachmentIds.add(item.attachmentId);
			return;
		}

		if (item.source === 'message-link' && item.messageId && item.linkUrl && item.linkIndex !== undefined) {
			const existing = linksByMessage.get(item.messageId) ?? [];
			existing.push({ url: item.linkUrl, index: item.linkIndex });
			linksByMessage.set(item.messageId, existing);
		}
	});

	for (const url of remoteMediaUrls) {
		await deleteRemoteMedia(url);
	}

	for (const attachmentId of attachmentIds) {
		await deleteLocalAttachment(attachmentId);
	}

	for (const [messageId, links] of linksByMessage.entries()) {
		const orderedLinks = [...links].sort((left, right) => right.index - left.index);
		for (const link of orderedLinks) {
			await deleteMessageLinkOccurrence(messageId, link.url, link.index);
		}
	}

	return uniqueItems.length;
};

const deleteLibraryItemsByKind = async (kind: LibraryKind, authUserId: string | null): Promise<number> => {
	const matchingItems = (await getLibraryItems(authUserId)).filter((item) => item.kind === kind);
	return deleteLibraryItems(matchingItems);
};

export { LIBRARY_CONTENT_TYPES, deleteLibraryItem, deleteLibraryItems, deleteLibraryItemsByKind, getLibraryItems };
export type { LibraryItem, LibraryKind, LibraryItemSource };