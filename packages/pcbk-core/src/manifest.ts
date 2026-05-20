import { PCBK_BACKUP_ID_BYTES } from './constants';
import { isCborRecord, isNonNegativeSafeInteger, isPositiveSafeInteger } from './validation';

import type {
	ManifestCounts,
	ManifestObjectEntry,
	ManifestPayload,
	ManifestSummary,
	PCBKRecordType
} from './types';

type ManifestRecordKey =
	| 'attachmentChunks'
	| 'attachments'
	| 'backupId'
	| 'chunkCount'
	| 'counts'
	| 'createdAt'
	| 'linkPreviews'
	| 'messages'
	| 'mode'
	| 'objectId'
	| 'objects'
	| 'outbox'
	| 'peerKeys'
	| 'remoteMedia'
	| 'remoteMediaChunks'
	| 'size'
	| 'totalRecordCount'
	| 'transferQueue'
	| 'transferQueueChunks';

type ManifestRecord = Record<string, unknown> & Partial<Record<ManifestRecordKey, unknown>>;

const isRecord = (value: unknown): value is ManifestRecord => {
	return isCborRecord(value);
};

const assertCondition: (condition: unknown, message: string) => asserts condition = (condition, message) => {
	if (!condition)
		throw new Error(message);
};

const validateBackupId = (value: unknown, fieldName: string): Uint8Array => {
	assertCondition(value instanceof Uint8Array, `${fieldName} must be bytes`);
	assertCondition(value.length === PCBK_BACKUP_ID_BYTES, `${fieldName} must be ${PCBK_BACKUP_ID_BYTES} bytes`);
	return value;
};

const validateManifestObjectEntry = (value: unknown, fieldName: string): ManifestObjectEntry => {
	assertCondition(isRecord(value), `${fieldName} entry must be an object`);
	assertCondition(typeof value.objectId === 'string' && value.objectId.length > 0, `${fieldName}.objectId must be a non-empty string`);
	assertCondition(isNonNegativeSafeInteger(value.size), `${fieldName}.size must be a non-negative safe integer`);
	assertCondition(isPositiveSafeInteger(value.chunkCount), `${fieldName}.chunkCount must be a positive safe integer`);

	return {
		objectId: value.objectId,
		chunkCount: value.chunkCount,
		size: value.size
	};
};

const validateManifestCounts = (value: unknown): ManifestCounts => {
	assertCondition(isRecord(value), 'counts must be an object');
	assertCondition(isNonNegativeSafeInteger(value.peerKeys), 'counts.peerKeys must be a non-negative safe integer');
	assertCondition(isNonNegativeSafeInteger(value.messages), 'counts.messages must be a non-negative safe integer');
	assertCondition(isNonNegativeSafeInteger(value.linkPreviews), 'counts.linkPreviews must be a non-negative safe integer');
	assertCondition(isNonNegativeSafeInteger(value.outbox), 'counts.outbox must be a non-negative safe integer');
	assertCondition(isNonNegativeSafeInteger(value.attachments), 'counts.attachments must be a non-negative safe integer');
	assertCondition(isNonNegativeSafeInteger(value.attachmentChunks), 'counts.attachmentChunks must be a non-negative safe integer');
	assertCondition(isNonNegativeSafeInteger(value.transferQueue), 'counts.transferQueue must be a non-negative safe integer');
	assertCondition(isNonNegativeSafeInteger(value.transferQueueChunks), 'counts.transferQueueChunks must be a non-negative safe integer');
	assertCondition(isNonNegativeSafeInteger(value.remoteMedia), 'counts.remoteMedia must be a non-negative safe integer');
	assertCondition(isNonNegativeSafeInteger(value.remoteMediaChunks), 'counts.remoteMediaChunks must be a non-negative safe integer');

	const counts: ManifestCounts = {
		peerKeys: value.peerKeys,
		messages: value.messages,
		linkPreviews: value.linkPreviews,
		outbox: value.outbox,
		attachments: value.attachments,
		attachmentChunks: value.attachmentChunks,
		transferQueue: value.transferQueue,
		transferQueueChunks: value.transferQueueChunks,
		remoteMedia: value.remoteMedia,
		remoteMediaChunks: value.remoteMediaChunks
	};

	return counts;
};

const validateManifestObjectList = (value: unknown, fieldName: string): ManifestObjectEntry[] => {
	assertCondition(Array.isArray(value), `${fieldName} must be an array`);
	return value.map((entry) => validateManifestObjectEntry(entry, fieldName));
};

const validateMode = (value: unknown): value is ManifestPayload['mode'] => {
	return value === 'identity-only' || value === 'full';
};

const compareBytes = (left: Uint8Array, right: Uint8Array): boolean => {
	if (left.length !== right.length)
		return false;

	const rightIterator = right[Symbol.iterator]();
	for (const leftByte of left) {
		const rightResult = rightIterator.next();
		if (rightResult.done || leftByte !== rightResult.value)
			return false;
	}

	return true;
};

const compareManifestObjectEntries = (left: ManifestObjectEntry[], right: ManifestObjectEntry[]): boolean => {
	if (left.length !== right.length)
		return false;

	const sortEntries = (entries: ManifestObjectEntry[]) => {
		return [...entries].sort((first, second) => {
			if (first.objectId !== second.objectId)
				return first.objectId.localeCompare(second.objectId);

			if (first.chunkCount !== second.chunkCount)
				return first.chunkCount - second.chunkCount;

			return first.size - second.size;
		});
	};

	const sortedLeft = sortEntries(left);
	const sortedRight = sortEntries(right);

	const rightIterator = sortedRight[Symbol.iterator]();
	return sortedLeft.every((entry) => {
		const otherResult = rightIterator.next();
		if (otherResult.done)
			return false;

		const other = otherResult.value;
		return entry.objectId === other.objectId
			&& entry.chunkCount === other.chunkCount
			&& entry.size === other.size;
	});
};

const assertManifestCountsMatchExpected = (manifestCounts: ManifestCounts, expectedCounts: ManifestCounts): void => {
	assertCondition(manifestCounts.peerKeys === expectedCounts.peerKeys, 'manifest.counts.peerKeys does not match expected value');
	assertCondition(manifestCounts.messages === expectedCounts.messages, 'manifest.counts.messages does not match expected value');
	assertCondition(manifestCounts.linkPreviews === expectedCounts.linkPreviews, 'manifest.counts.linkPreviews does not match expected value');
	assertCondition(manifestCounts.outbox === expectedCounts.outbox, 'manifest.counts.outbox does not match expected value');
	assertCondition(manifestCounts.attachments === expectedCounts.attachments, 'manifest.counts.attachments does not match expected value');
	assertCondition(manifestCounts.attachmentChunks === expectedCounts.attachmentChunks, 'manifest.counts.attachmentChunks does not match expected value');
	assertCondition(manifestCounts.transferQueue === expectedCounts.transferQueue, 'manifest.counts.transferQueue does not match expected value');
	assertCondition(manifestCounts.transferQueueChunks === expectedCounts.transferQueueChunks, 'manifest.counts.transferQueueChunks does not match expected value');
	assertCondition(manifestCounts.remoteMedia === expectedCounts.remoteMedia, 'manifest.counts.remoteMedia does not match expected value');
	assertCondition(manifestCounts.remoteMediaChunks === expectedCounts.remoteMediaChunks, 'manifest.counts.remoteMediaChunks does not match expected value');
};

const assertManifestMatchesExpected = (manifest: ManifestPayload, expected: ManifestPayload): ManifestPayload => {
	assertCondition(compareBytes(manifest.backupId, expected.backupId), 'manifest.backupId does not match expected backupId');
	assertCondition(manifest.mode === expected.mode, 'manifest.mode does not match expected mode');
	assertCondition(manifest.createdAt === expected.createdAt, 'manifest.createdAt does not match expected createdAt');
	assertCondition(manifest.totalRecordCount === expected.totalRecordCount, 'manifest.totalRecordCount does not match expected totalRecordCount');

	assertManifestCountsMatchExpected(manifest.counts, expected.counts);

	assertCondition(
		compareManifestObjectEntries(manifest.objects.attachments, expected.objects.attachments),
		'manifest.objects.attachments do not match expected objects'
	);
	assertCondition(
		compareManifestObjectEntries(manifest.objects.transferQueue, expected.objects.transferQueue),
		'manifest.objects.transferQueue do not match expected objects'
	);
	assertCondition(
		compareManifestObjectEntries(manifest.objects.remoteMedia, expected.objects.remoteMedia),
		'manifest.objects.remoteMedia do not match expected objects'
	);

	return manifest;
};

const validateManifestPayload = (value: unknown, summary: ManifestSummary): ManifestPayload => {
	assertCondition(isRecord(value), 'manifest payload must be an object');
	assertCondition(validateMode(value.mode), 'manifest.mode must be "identity-only" or "full"');
	assertCondition(isPositiveSafeInteger(value.totalRecordCount), 'manifest.totalRecordCount must be a positive safe integer');
	assertCondition(isPositiveSafeInteger(value.createdAt), 'manifest.createdAt must be a positive safe integer');

	const backupId = validateBackupId(value.backupId, 'manifest.backupId');
	const counts = validateManifestCounts(value.counts);
	assertCondition(isRecord(value.objects), 'objects must be an object');

	const objects = {
		attachments: validateManifestObjectList(value.objects.attachments, 'objects.attachments'),
		transferQueue: validateManifestObjectList(value.objects.transferQueue, 'objects.transferQueue'),
		remoteMedia: validateManifestObjectList(value.objects.remoteMedia, 'objects.remoteMedia')
	};

	assertCondition(compareBytes(backupId, summary.backupId), 'manifest.backupId must match the clear header');
	assertCondition(value.mode === summary.mode, 'manifest.mode must match the clear header');
	assertCondition(value.createdAt === summary.createdAt, 'manifest.createdAt must match the clear header');
	assertCondition(value.totalRecordCount === summary.totalRecordCount, 'manifest.totalRecordCount must match the observed record count');
	assertCondition(counts.attachments === objects.attachments.length, 'manifest attachment count must match attachment objects length');
	assertCondition(counts.transferQueue === objects.transferQueue.length, 'manifest transferQueue count must match transferQueue objects length');
	assertCondition(counts.remoteMedia === objects.remoteMedia.length, 'manifest remoteMedia count must match remoteMedia objects length');
	assertCondition(
		counts.attachmentChunks === objects.attachments.reduce((sum, entry) => sum + entry.chunkCount, 0),
		'manifest attachmentChunks must match attachment object chunk totals'
	);
	assertCondition(
		counts.transferQueueChunks === objects.transferQueue.reduce((sum, entry) => sum + entry.chunkCount, 0),
		'manifest transferQueueChunks must match transferQueue object chunk totals'
	);
	assertCondition(
		counts.remoteMediaChunks === objects.remoteMedia.reduce((sum, entry) => sum + entry.chunkCount, 0),
		'manifest remoteMediaChunks must match remoteMedia object chunk totals'
	);

	return {
		backupId,
		mode: value.mode,
		createdAt: value.createdAt,
		totalRecordCount: value.totalRecordCount,
		counts,
		objects
	};
};

type ManifestBuilder = {
	trackRecord: (input: {
		type: Exclude<PCBKRecordType, 'manifest'>;
		itemCount?: number;
		objectId?: string;
		chunkCount?: number;
		size?: number;
	}) => void;
	build: () => ManifestPayload;
};

const createEmptyCounts = (): ManifestCounts => ({
	peerKeys: 0,
	messages: 0,
	linkPreviews: 0,
	outbox: 0,
	attachments: 0,
	attachmentChunks: 0,
	transferQueue: 0,
	transferQueueChunks: 0,
	remoteMedia: 0,
	remoteMediaChunks: 0
});

const createObjectEntry = (objectId: string | undefined, chunkCount: number | undefined, size: number | undefined, recordType: string): ManifestObjectEntry => {
	if (!objectId)
		throw new Error(`${recordType} requires objectId`);

	if (!isPositiveSafeInteger(chunkCount))
		throw new Error(`${recordType} requires a positive safe chunkCount`);

	if (!isNonNegativeSafeInteger(size))
		throw new Error(`${recordType} requires a non-negative safe size`);

	return {
		objectId,
		chunkCount,
		size
	};
};

const createManifestBuilder = (summary: ManifestSummary): ManifestBuilder => {
	const counts = createEmptyCounts();
	const attachments: ManifestObjectEntry[] = [];
	const transferQueue: ManifestObjectEntry[] = [];
	const remoteMedia: ManifestObjectEntry[] = [];
	let trackedRecordCount = 0;

	return {
		trackRecord: ({ type, itemCount = 0, objectId, chunkCount, size }) => {
			if (!isNonNegativeSafeInteger(itemCount))
				throw new Error('itemCount must be a non-negative safe integer');

			trackedRecordCount += 1;

			switch (type) {
				case 'identity':
					break;
				case 'peer-keys-batch':
					counts.peerKeys += itemCount;
					break;
				case 'messages-batch':
					counts.messages += itemCount;
					break;
				case 'link-previews-batch':
					counts.linkPreviews += itemCount;
					break;
				case 'outbox-batch':
					counts.outbox += itemCount;
					break;
				case 'attachment-meta':
					counts.attachments += 1;
					attachments.push(createObjectEntry(objectId, chunkCount, size, type));
					break;
				case 'attachment-chunk':
					counts.attachmentChunks += 1;
					break;
				case 'transfer-queue-meta':
					counts.transferQueue += 1;
					transferQueue.push(createObjectEntry(objectId, chunkCount, size, type));
					break;
				case 'transfer-queue-chunk':
					counts.transferQueueChunks += 1;
					break;
				case 'remote-media-meta':
					counts.remoteMedia += 1;
					remoteMedia.push(createObjectEntry(objectId, chunkCount, size, type));
					break;
				case 'remote-media-chunk':
					counts.remoteMediaChunks += 1;
					break;
			}
		},
		build: () => ({
			backupId: summary.backupId,
			mode: summary.mode,
			createdAt: summary.createdAt,
			totalRecordCount: trackedRecordCount + 1,
			counts: { ...counts },
			objects: {
				attachments: [...attachments],
				transferQueue: [...transferQueue],
				remoteMedia: [...remoteMedia]
			}
		})
	};
};

export {
	assertManifestMatchesExpected,
	createManifestBuilder,
	validateManifestPayload,
	type ManifestBuilder
};