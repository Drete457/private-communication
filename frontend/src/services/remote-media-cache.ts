import { signedFetch } from '@/helpers/messages/http-auth';
import { clientLogger } from '@/services/logger';
import type { RemoteMediaRecord } from '@/types';

import { db } from './message-service';

const DIRECT_REMOTE_MEDIA_EXTENSIONS = ['.gif', '.jpg', '.jpeg', '.png', '.webp'] as const;
const REMOTE_MEDIA_TTL_MS = 30 * 24 * 60 * 60 * 1000;
const REMOTE_MEDIA_FALLBACK_EXTENSION = '.gif';

type RemoteMediaExtension = typeof DIRECT_REMOTE_MEDIA_EXTENSIONS[number];
type StoredRemoteMediaRecord = Omit<RemoteMediaRecord, 'isFavorite'> & {
	readonly isFavorite?: boolean;
};

const MIME_TYPE_BY_EXTENSION: Record<RemoteMediaExtension, string> = {
	'.gif': 'image/gif',
	'.jpg': 'image/jpeg',
	'.jpeg': 'image/jpeg',
	'.png': 'image/png',
	'.webp': 'image/webp'
};

type RemoteMediaCacheContext = {
	peerId?: string | undefined;
	messageId?: string | undefined;
};

const normalizeStoredRemoteMediaRecord = (record: StoredRemoteMediaRecord): RemoteMediaRecord => ({
	...record,
	isFavorite: record.isFavorite ?? false
});

const normalizeUrl = (value: string): string | null => {
	try {
		const parsed = new URL(value);
		if (!['http:', 'https:'].includes(parsed.protocol))
			return null;

		return parsed.toString();
	} catch {
		return null;
	}
};

const getRemoteMediaExtension = (value: string): RemoteMediaExtension | null => {
	const normalizedUrl = normalizeUrl(value);
	if (!normalizedUrl)
		return null;

	const parsed = new URL(normalizedUrl);
	const lowerPathname = parsed.pathname.toLowerCase();
	return DIRECT_REMOTE_MEDIA_EXTENSIONS.find((extension) => lowerPathname.endsWith(extension)) ?? null;
};

const isDirectRemoteMediaUrl = (value: string): boolean => getRemoteMediaExtension(value) !== null;

const extractDirectRemoteMediaUrls = (content: string): string[] => {
	const matches = content.match(/https?:\/\/[^\s]+/gi) ?? [];
	return matches.filter((match) => isDirectRemoteMediaUrl(match));
};

const extractFirstDirectRemoteMediaUrl = (content: string): string | undefined => {
	return extractDirectRemoteMediaUrls(content)[0];
};

const cleanupExpiredRemoteMedia = async (): Promise<void> => {
	await db.remoteMedia.where('expiresAt').belowOrEqual(Date.now()).delete();
};

const getRemoteMedia = async (url: string): Promise<RemoteMediaRecord | undefined> => {
	const normalizedUrl = normalizeUrl(url);
	if (!normalizedUrl)
		return undefined;

	await cleanupExpiredRemoteMedia();
	const existing = await db.remoteMedia.get(normalizedUrl);
	if (!existing)
		return undefined;

	const now = Date.now();
	await db.remoteMedia.update(normalizedUrl, {
		lastAccessedAt: now,
		updatedAt: now
	});

	return normalizeStoredRemoteMediaRecord({
		...existing,
		lastAccessedAt: now,
		updatedAt: now
	});
};

const createRemoteMediaRecord = (url: string, blob: Blob, context?: RemoteMediaCacheContext): RemoteMediaRecord => {
	const normalizedUrl = normalizeUrl(url);
	if (!normalizedUrl)
		throw new Error('Invalid remote media URL');

	const parsed = new URL(normalizedUrl);
	const extension = getRemoteMediaExtension(normalizedUrl) ?? REMOTE_MEDIA_FALLBACK_EXTENSION;
	const now = Date.now();
	const mimeType = blob.type.length > 0 && blob.type !== 'application/octet-stream'
		? blob.type
		: MIME_TYPE_BY_EXTENSION[extension];

	return {
		url: normalizedUrl,
		blob,
		mimeType,
		extension,
		isFavorite: false,
		sourceHost: parsed.hostname,
		peerId: context?.peerId,
		messageId: context?.messageId,
		createdAt: now,
		updatedAt: now,
		lastAccessedAt: now,
		expiresAt: now + REMOTE_MEDIA_TTL_MS
	};
};

const saveRemoteMedia = async (url: string, blob: Blob, context?: RemoteMediaCacheContext): Promise<RemoteMediaRecord> => {
	const record = createRemoteMediaRecord(url, blob, context);
	const existing = await db.remoteMedia.get(record.url);
	const normalizedExisting = existing ? normalizeStoredRemoteMediaRecord(existing) : undefined;
	const persistedRecord: RemoteMediaRecord = {
		...record,
		createdAt: normalizedExisting?.createdAt ?? record.createdAt,
		isFavorite: normalizedExisting?.isFavorite ?? false
	};

	try {
		await db.remoteMedia.put(persistedRecord);
	} catch (error) {
		clientLogger.debug('Failed to persist remote media cache record:', error);
	}

	return persistedRecord;
};

const fetchRemoteMedia = async (url: string, context?: RemoteMediaCacheContext): Promise<RemoteMediaRecord> => {
	const normalizedUrl = normalizeUrl(url);
	if (!normalizedUrl)
		throw new Error('Invalid remote media URL');

	const response = await signedFetch(`/api/preview/image?url=${encodeURIComponent(normalizedUrl)}`);
	if (!response.ok)
		throw new Error('Unable to load remote media');

	const blob = await response.blob();
	if (!blob.type.startsWith('image/'))
		throw new Error('Unsupported remote media type');

	return saveRemoteMedia(normalizedUrl, blob, context);
};

const getOrFetchRemoteMedia = async (url: string, context?: RemoteMediaCacheContext): Promise<RemoteMediaRecord> => {
	const cached = await getRemoteMedia(url);
	if (cached)
		return cached;

	return fetchRemoteMedia(url, context);
};

const refreshRemoteMedia = async (url: string, context?: RemoteMediaCacheContext): Promise<RemoteMediaRecord> => {
	return fetchRemoteMedia(url, context);
};

const getRecentRemoteGifs = async (limit = 40): Promise<RemoteMediaRecord[]> => {
	await cleanupExpiredRemoteMedia();
	const records = (await db.remoteMedia.orderBy('lastAccessedAt').reverse().toArray()).map(normalizeStoredRemoteMediaRecord);
	return records
		.filter((record) => record.extension === '.gif')
		.slice(0, limit);
};

const getFavoriteRemoteGifs = async (): Promise<RemoteMediaRecord[]> => {
	await cleanupExpiredRemoteMedia();
	const records = (await db.remoteMedia.toArray()).map(normalizeStoredRemoteMediaRecord);

	return records
		.filter((record) => record.extension === '.gif' && record.isFavorite)
		.sort((left, right) => right.updatedAt - left.updatedAt);
};

const setRemoteMediaFavorite = async (url: string, isFavorite: boolean): Promise<RemoteMediaRecord | undefined> => {
	const normalizedUrl = normalizeUrl(url);
	if (!normalizedUrl)
		return undefined;

	const existing = await db.remoteMedia.get(normalizedUrl);
	if (!existing)
		return undefined;

	const now = Date.now();
	const nextRecord: RemoteMediaRecord = {
		...existing,
		isFavorite,
		updatedAt: now
	};

	await db.remoteMedia.put(nextRecord);
	return nextRecord;
};

const deleteRemoteMedia = async (url: string): Promise<boolean> => {
	const normalizedUrl = normalizeUrl(url);
	if (!normalizedUrl)
		return false;

	const existing = await db.remoteMedia.get(normalizedUrl);
	if (!existing)
		return false;

	await db.remoteMedia.delete(normalizedUrl);
	return true;
};

const deleteRemoteMediaByPeer = async (peerId: string): Promise<number> => {
	const records = await db.remoteMedia.where('peerId').equals(peerId).primaryKeys();
	if (records.length === 0)
		return 0;

	await db.remoteMedia.bulkDelete(records);
	return records.length;
};

export {
	DIRECT_REMOTE_MEDIA_EXTENSIONS,
	REMOTE_MEDIA_TTL_MS,
	cleanupExpiredRemoteMedia,
	deleteRemoteMedia,
	deleteRemoteMediaByPeer,
	extractDirectRemoteMediaUrls,
	extractFirstDirectRemoteMediaUrl,
	getFavoriteRemoteGifs,
	getOrFetchRemoteMedia,
	getRecentRemoteGifs,
	refreshRemoteMedia,
	getRemoteMedia,
	getRemoteMediaExtension,
	isDirectRemoteMediaUrl,
	setRemoteMediaFavorite,
	saveRemoteMedia
};

export type { RemoteMediaCacheContext };