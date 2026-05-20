import {
	ARGON2_CONTROLLED_FALLBACK_PROFILE,
	ARGON2_MINIMUM_ACCEPTABLE_PROFILE,
	ARGON2_RECOMMENDED_STANDARD_PROFILE,
	PCBK_AES_GCM_TAG_BITS,
	PCBK_CONTENT_KEY_BYTES,
	PCBK_FLAGS,
	PCBK_FORMAT_VERSION,
	PCBK_MAGIC,
	PCBK_RECORD_VERSION,
	authenticateHeader,
	buildClearHeader,
	buildKeyWrapAadHeader,
	buildRecordHeader,
	buildRecordNonce,
	createManifestBuilder,
	deriveRootKey,
	encodeCanonicalCbor,
	encryptRecord,
	randomBytes,
	validateBackupPassphrase,
	wrapContentKey
} from '@private-communication/pcbk-core';


import { clientLogger } from '@/services/logger';
import type {
	LocalAttachmentRecord,
	MessageAttachment,
	RemoteMediaRecord,
	TransferQueueRecord
} from '@/types';
import type {
	BackupBlobExportSource,
	BackupExportProgress,
	BackupProgressHandler,
	BackupWriter,
	ExportBackupMode,
	ExportBackupOptions
} from '@/types/backup';

import {
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
} from './export-sources';
import {
	concatByteArrays,
	encodeUint32LittleEndian
} from './writer';
import {
	createFileSystemBackupWriter,
	isBackupExportSupported,
	UNSUPPORTED_BACKUP_EXPORT_MESSAGE
} from './writers/file-system-writer';

import type { Argon2Profile, PCBKRecordType } from '@private-communication/pcbk-core';

const RECORD_AUTH_TAG_BYTES = PCBK_AES_GCM_TAG_BITS / 8;
const BACKUP_BATCH_ITEM_LIMIT = 100;
const BACKUP_BLOB_CHUNK_BYTES = 256 * 1024;

const ARGON2_PROFILE_CANDIDATES: ReadonlyArray<Argon2Profile> = [
	ARGON2_RECOMMENDED_STANDARD_PROFILE,
	ARGON2_MINIMUM_ACCEPTABLE_PROFILE,
	ARGON2_CONTROLLED_FALLBACK_PROFILE
];

type StructuredBatchRecordType = Extract<
	PCBKRecordType,
	'peer-keys-batch' | 'messages-batch' | 'link-previews-batch' | 'outbox-batch'
>;

type ChunkedMetaRecordType = Extract<
	PCBKRecordType,
	'attachment-meta' | 'transfer-queue-meta' | 'remote-media-meta'
>;

type ChunkedRecordType = Extract<
	PCBKRecordType,
	'attachment-chunk' | 'transfer-queue-chunk' | 'remote-media-chunk'
>;

type StructuredBatchStageInput<T> = {
	ids: string[];
	stage: BackupExportProgress['stage'];
	recordType: StructuredBatchRecordType;
	loadBatch: (ids: string[]) => Promise<T[]>;
	writer: BackupWriter;
	contentKey: Uint8Array;
	noncePrefix: Uint8Array;
	startingRecordIndex: number;
	manifestBuilder: ReturnType<typeof createManifestBuilder>;
	onProgress?: BackupProgressHandler | undefined;
	signal?: AbortSignal | undefined;
};

type ChunkedObjectStageInput<T> = {
	sources: BackupBlobExportSource[];
	stage: BackupExportProgress['stage'];
	metaRecordType: ChunkedMetaRecordType;
	chunkRecordType: ChunkedRecordType;
	loadRecord: (id: string) => Promise<T | null>;
	getBlob: (record: T) => Blob;
	getObjectId: (record: T, source: BackupBlobExportSource) => string;
	buildMetaPayload: (record: T, context: {
		objectId: string;
		objectSize: number;
		chunkSize: number;
		chunkCount: number;
	}) => unknown;
	writer: BackupWriter;
	contentKey: Uint8Array;
	noncePrefix: Uint8Array;
	startingRecordIndex: number;
	manifestBuilder: ReturnType<typeof createManifestBuilder>;
	onProgress?: BackupProgressHandler | undefined;
	signal?: AbortSignal | undefined;
};

const assertNotAborted = (signal?: AbortSignal): void => {
	if (signal?.aborted)
		throw new Error('Backup export was canceled.');
};

const emitProgress = (onProgress: BackupProgressHandler | undefined, progress: BackupExportProgress): void => {
	onProgress?.(progress);
};

const getBackupTimestamp = (): string => {
	const now = new Date();
	const pad = (value: number) => value.toString().padStart(2, '0');
	return `${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(now.getDate())}-${pad(now.getHours())}${pad(now.getMinutes())}${pad(now.getSeconds())}`;
};

const createSuggestedBackupName = (mode: ExportBackupMode): string => {
	return `private-communication-${mode === 'identity-only' ? 'identity' : 'full'}-${getBackupTimestamp()}.pcbk`;
};

const calculateChunkCount = (size: number): number => {
	return Math.max(1, Math.ceil(size / BACKUP_BLOB_CHUNK_BYTES));
};

const encodeHex = (bytes: Uint8Array): string => {
	return Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0')).join('');
};

const createOpaqueObjectId = (prefix: string): string => {
	return `${prefix}-${encodeHex(randomBytes(16))}`;
};

const removeAttachmentInlineData = (attachment: MessageAttachment): MessageAttachment => {
	const sanitizedAttachment = { ...attachment };
	delete sanitizedAttachment.data;
	return sanitizedAttachment;
};

const buildAttachmentMetaPayload = (
	record: LocalAttachmentRecord,
	objectSize: number,
	chunkSize: number,
	chunkCount: number
) => ({
	attachmentId: record.attachmentId,
	peerId: record.peerId ?? null,
	messageId: record.messageId ?? null,
	fileName: record.fileName,
	mimeType: record.mimeType,
	size: objectSize,
	kind: record.kind ?? null,
	plaintextHashSha256: record.plaintextHashSha256 ?? null,
	createdAt: record.createdAt,
	updatedAt: record.updatedAt,
	lastAccessedAt: record.lastAccessedAt,
	chunkSize,
	chunkCount
});

const buildTransferQueueMetaPayload = (
	record: TransferQueueRecord,
	chunkSize: number,
	chunkCount: number
) => ({
	id: record.id,
	recipientId: record.recipientId,
	meta: record.meta,
	upload: record.upload ?? null,
	messageDispatch: record.messageDispatch ?? null,
	uiSource: record.uiSource ?? null,
	attachment: record.attachment ? removeAttachmentInlineData(record.attachment) : null,
	manifest: record.manifest ?? null,
	persistLocally: record.persistLocally,
	status: record.status,
	retryCount: record.retryCount,
	createdAt: record.createdAt,
	updatedAt: record.updatedAt,
	lastError: record.lastError ?? null,
	chunkSize,
	chunkCount
});

const buildRemoteMediaMetaPayload = (
	record: RemoteMediaRecord,
	mediaId: string,
	chunkSize: number,
	chunkCount: number
) => ({
	mediaId,
	url: record.url,
	mimeType: record.mimeType,
	extension: record.extension,
	isFavorite: record.isFavorite,
	sourceHost: record.sourceHost,
	peerId: record.peerId ?? null,
	messageId: record.messageId ?? null,
	createdAt: record.createdAt,
	updatedAt: record.updatedAt,
	lastAccessedAt: record.lastAccessedAt,
	expiresAt: record.expiresAt,
	chunkSize,
	chunkCount
});

const writePrelude = async (writer: BackupWriter, clearHeaderBytes: Uint8Array, headerAuthTag: Uint8Array): Promise<void> => {
	const magicBytes = new TextEncoder().encode(PCBK_MAGIC);
	const prelude = concatByteArrays(
		magicBytes,
		new Uint8Array([PCBK_FORMAT_VERSION, PCBK_FLAGS]),
		encodeUint32LittleEndian(clearHeaderBytes.length),
		clearHeaderBytes,
		headerAuthTag
	);

	await writer.write(prelude);
};

const writeEncryptedRecord = async (input: {
	writer: BackupWriter;
	contentKey: Uint8Array;
	noncePrefix: Uint8Array;
	recordIndex: number;
	recordType: PCBKRecordType;
	encoding: 'cbor' | 'bytes';
	payloadBytes: Uint8Array;
	objectId?: string | undefined;
	chunkIndex?: number | undefined;
	chunkCount?: number | undefined;
}): Promise<void> => {
	const {
		writer,
		contentKey,
		noncePrefix,
		recordIndex,
		recordType,
		encoding,
		payloadBytes,
		objectId,
		chunkIndex,
		chunkCount
	} = input;
	const cipherLength = payloadBytes.length + RECORD_AUTH_TAG_BYTES;
	const recordHeaderBytes = buildRecordHeader({
		recordVersion: PCBK_RECORD_VERSION,
		type: recordType,
		index: recordIndex,
		encoding,
		plainLength: payloadBytes.length,
		cipherLength,
		...(objectId !== undefined ? { objectId } : {}),
		...(chunkIndex !== undefined ? { chunkIndex } : {}),
		...(chunkCount !== undefined ? { chunkCount } : {})
	});
	const nonce = buildRecordNonce(noncePrefix, recordIndex);
	const encryptedRecord = await encryptRecord({
		contentKey,
		nonce,
		headerBytes: recordHeaderBytes,
		payloadBytes
	});

	await writer.write(concatByteArrays(
		encodeUint32LittleEndian(recordHeaderBytes.length),
		recordHeaderBytes,
		encryptedRecord.ciphertext
	));
};

const writeStructuredBatchStage = async <T>(input: StructuredBatchStageInput<T>): Promise<number> => {
	const {
		ids,
		stage,
		recordType,
		loadBatch,
		writer,
		contentKey,
		noncePrefix,
		startingRecordIndex,
		manifestBuilder,
		onProgress,
		signal
	} = input;
	let recordIndex = startingRecordIndex;
	let processedItems = 0;

	emitProgress(onProgress, {
		stage,
		processedItems,
		totalItems: ids.length
	});

	for (let start = 0; start < ids.length; start += BACKUP_BATCH_ITEM_LIMIT) {
		assertNotAborted(signal);
		const batchIds = ids.slice(start, start + BACKUP_BATCH_ITEM_LIMIT);
		const items = await loadBatch(batchIds);

		if (items.length === 0)
			continue;

		await writeEncryptedRecord({
			writer,
			contentKey,
			noncePrefix,
			recordIndex,
			recordType,
			encoding: 'cbor',
			payloadBytes: encodeCanonicalCbor({ items })
		});
		manifestBuilder.trackRecord({
			type: recordType,
			itemCount: items.length
		});
		recordIndex += 1;
		processedItems += items.length;

		emitProgress(onProgress, {
			stage,
			processedItems,
			totalItems: ids.length
		});
	}

	return recordIndex;
};

const writeChunkedObjectStage = async <T>(input: ChunkedObjectStageInput<T>): Promise<number> => {
	const {
		sources,
		stage,
		metaRecordType,
		chunkRecordType,
		loadRecord,
		getBlob,
		getObjectId,
		buildMetaPayload,
		writer,
		contentKey,
		noncePrefix,
		startingRecordIndex,
		manifestBuilder,
		onProgress,
		signal
	} = input;
	let recordIndex = startingRecordIndex;
	let processedItems = 0;
	let processedBytes = 0;
	const totalBytes = sources.reduce((sum, source) => sum + source.size, 0);

	emitProgress(onProgress, {
		stage,
		processedItems,
		totalItems: sources.length,
		processedBytes,
		totalBytes
	});

	for (const source of sources) {
		assertNotAborted(signal);
		const record = await loadRecord(source.id);

		if (!record)
			throw new Error('Backup data changed during export. Please try again.');

		const blob = getBlob(record);
		const objectSize = blob.size;
		const chunkCount = calculateChunkCount(objectSize);
		const objectId = getObjectId(record, source);
		const metaPayloadBytes = encodeCanonicalCbor(buildMetaPayload(record, {
			objectId,
			objectSize,
			chunkSize: BACKUP_BLOB_CHUNK_BYTES,
			chunkCount
		}));

		await writeEncryptedRecord({
			writer,
			contentKey,
			noncePrefix,
			recordIndex,
			recordType: metaRecordType,
			encoding: 'cbor',
			payloadBytes: metaPayloadBytes,
			objectId
		});
		manifestBuilder.trackRecord({
			type: metaRecordType,
			objectId,
			chunkCount,
			size: objectSize
		});
		recordIndex += 1;

		for (let chunkIndex = 0; chunkIndex < chunkCount; chunkIndex += 1) {
			assertNotAborted(signal);
			const start = chunkIndex * BACKUP_BLOB_CHUNK_BYTES;
			const end = Math.min(start + BACKUP_BLOB_CHUNK_BYTES, objectSize);
			const chunkBytes = new Uint8Array(await blob.slice(start, end).arrayBuffer());

			await writeEncryptedRecord({
				writer,
				contentKey,
				noncePrefix,
				recordIndex,
				recordType: chunkRecordType,
				encoding: 'bytes',
				payloadBytes: chunkBytes,
				objectId,
				chunkIndex,
				chunkCount
			});
			manifestBuilder.trackRecord({ type: chunkRecordType });
			recordIndex += 1;
			processedBytes += chunkBytes.length;

			emitProgress(onProgress, {
				stage,
				processedItems,
				totalItems: sources.length,
				processedBytes,
				totalBytes
			});
		}

		processedItems += 1;
		emitProgress(onProgress, {
			stage,
			processedItems,
			totalItems: sources.length,
			processedBytes,
			totalBytes
		});
	}

	return recordIndex;
};

const deriveRootKeyWithFallback = async (passphrase: string, salt: Uint8Array): Promise<{ profile: Argon2Profile; rootKey: Uint8Array }> => {
	let lastError: unknown;

	for (const profile of ARGON2_PROFILE_CANDIDATES) {
		try {
			return {
				profile,
				rootKey: await deriveRootKey({
					passphrase,
					salt,
					memoryKiB: profile.memoryKiB,
					iterations: profile.iterations,
					parallelism: profile.parallelism,
					hashLength: profile.hashLength
				})
			};
		} catch (error) {
			lastError = error;
		}
	}

	throw lastError instanceof Error ? lastError : new Error('Could not derive backup key.');
};

const exportBackup = async (options: ExportBackupOptions): Promise<void> => {
	const { mode, passphrase, onProgress, signal } = options;
	let writer: BackupWriter | null = null;
	let writerClosed = false;
	let rootKey: Uint8Array | null = null;
	let contentKey: Uint8Array | null = null;

	try {
		if (!isBackupExportSupported())
			throw new Error(UNSUPPORTED_BACKUP_EXPORT_MESSAGE);

		emitProgress(onProgress, { stage: 'validating-passphrase' });
		const passphraseValidation = validateBackupPassphrase(passphrase);

		if (!passphraseValidation.valid)
			throw new Error(passphraseValidation.errors[0] ?? 'Backup passphrase is invalid.');

		assertNotAborted(signal);
		writer = await createFileSystemBackupWriter(createSuggestedBackupName(mode));
		assertNotAborted(signal);

		emitProgress(onProgress, { stage: 'deriving-keys' });
		const createdAt = Date.now();
		const backupId = randomBytes(16);
		const salt = randomBytes(16);
		const wrapIv = randomBytes(12);
		const noncePrefix = randomBytes(4);
		contentKey = randomBytes(PCBK_CONTENT_KEY_BYTES);

		const { profile, rootKey: derivedRootKey } = await deriveRootKeyWithFallback(passphraseValidation.normalizedPassphrase, salt);
		rootKey = derivedRootKey;
		const keyWrapAadHeaderBytes = buildKeyWrapAadHeader({
			mode,
			createdAt,
			backupId,
			kdfProfile: profile,
			salt,
			wrapIv,
			noncePrefix
		});
		const { wrappedContentKey } = await wrapContentKey({
			rootKey,
			contentKey,
			keyWrapAadHeaderBytes,
			iv: wrapIv
		});
		const { clearHeaderBytes } = buildClearHeader({
			mode,
			createdAt,
			backupId,
			kdfProfile: profile,
			salt,
			wrapIv,
			noncePrefix,
			wrappedContentKey
		});
		const headerAuthTag = await authenticateHeader({
			rootKey,
			magic: PCBK_MAGIC,
			formatVersion: PCBK_FORMAT_VERSION,
			flags: PCBK_FLAGS,
			clearHeaderBytes
		});

		emitProgress(onProgress, { stage: 'writing-header' });
		await writePrelude(writer, clearHeaderBytes, headerAuthTag);
		assertNotAborted(signal);

		const manifestBuilder = createManifestBuilder({
			backupId,
			mode,
			createdAt,
			totalRecordCount: 0
		});
		let nextRecordIndex = 0;

		emitProgress(onProgress, {
			stage: 'exporting-identity',
			processedItems: 0,
			totalItems: 1
		});
		const identityPayload = await loadIdentityRecordPayload();
		const identityRecordBytes = encodeCanonicalCbor(identityPayload);
		await writeEncryptedRecord({
			writer,
			contentKey,
			noncePrefix,
			recordIndex: nextRecordIndex,
			recordType: 'identity',
			encoding: 'cbor',
			payloadBytes: identityRecordBytes
		});
		manifestBuilder.trackRecord({ type: 'identity' });
		nextRecordIndex += 1;
		emitProgress(onProgress, {
			stage: 'exporting-identity',
			processedItems: 1,
			totalItems: 1
		});
		assertNotAborted(signal);

		if (mode === 'full') {
			const [
				peerKeyIds,
				messageIds,
				linkPreviewIds,
				outboxIds,
				attachmentSources,
				transferQueueSources,
				remoteMediaSources
			] = await Promise.all([
				listPeerKeyIds(),
				listMessageIds(),
				listLinkPreviewIds(),
				listOutboxIds(),
				scanLocalAttachmentSources(),
				scanTransferQueueSources(),
				scanRemoteMediaSources()
			]);

			nextRecordIndex = await writeStructuredBatchStage({
				ids: peerKeyIds,
				stage: 'exporting-peer-keys',
				recordType: 'peer-keys-batch',
				loadBatch: loadPeerKeysBatch,
				writer,
				contentKey,
				noncePrefix,
				startingRecordIndex: nextRecordIndex,
				manifestBuilder,
				onProgress,
				signal
			});

			nextRecordIndex = await writeStructuredBatchStage({
				ids: messageIds,
				stage: 'exporting-messages',
				recordType: 'messages-batch',
				loadBatch: loadMessagesBatch,
				writer,
				contentKey,
				noncePrefix,
				startingRecordIndex: nextRecordIndex,
				manifestBuilder,
				onProgress,
				signal
			});

			nextRecordIndex = await writeStructuredBatchStage({
				ids: linkPreviewIds,
				stage: 'exporting-link-previews',
				recordType: 'link-previews-batch',
				loadBatch: loadLinkPreviewBatch,
				writer,
				contentKey,
				noncePrefix,
				startingRecordIndex: nextRecordIndex,
				manifestBuilder,
				onProgress,
				signal
			});

			nextRecordIndex = await writeStructuredBatchStage({
				ids: outboxIds,
				stage: 'exporting-outbox',
				recordType: 'outbox-batch',
				loadBatch: loadOutboxBatch,
				writer,
				contentKey,
				noncePrefix,
				startingRecordIndex: nextRecordIndex,
				manifestBuilder,
				onProgress,
				signal
			});

			nextRecordIndex = await writeChunkedObjectStage({
				sources: attachmentSources,
				stage: 'exporting-attachments',
				metaRecordType: 'attachment-meta',
				chunkRecordType: 'attachment-chunk',
				loadRecord: loadLocalAttachmentRecord,
				getBlob: (record) => record.blob,
				getObjectId: (record) => record.attachmentId,
				buildMetaPayload: (record, { objectSize, chunkSize, chunkCount }) => {
					return buildAttachmentMetaPayload(record, objectSize, chunkSize, chunkCount);
				},
				writer,
				contentKey,
				noncePrefix,
				startingRecordIndex: nextRecordIndex,
				manifestBuilder,
				onProgress,
				signal
			});

			nextRecordIndex = await writeChunkedObjectStage({
				sources: transferQueueSources,
				stage: 'exporting-transfer-queue',
				metaRecordType: 'transfer-queue-meta',
				chunkRecordType: 'transfer-queue-chunk',
				loadRecord: loadTransferQueueRecord,
				getBlob: (record) => record.fileBlob,
				getObjectId: (record) => record.id,
				buildMetaPayload: (record, { chunkSize, chunkCount }) => {
					return buildTransferQueueMetaPayload(record, chunkSize, chunkCount);
				},
				writer,
				contentKey,
				noncePrefix,
				startingRecordIndex: nextRecordIndex,
				manifestBuilder,
				onProgress,
				signal
			});

			nextRecordIndex = await writeChunkedObjectStage({
				sources: remoteMediaSources,
				stage: 'exporting-remote-media',
				metaRecordType: 'remote-media-meta',
				chunkRecordType: 'remote-media-chunk',
				loadRecord: loadRemoteMediaRecord,
				getBlob: (record) => record.blob,
				getObjectId: () => createOpaqueObjectId('media'),
				buildMetaPayload: (record, { objectId, chunkSize, chunkCount }) => {
					return buildRemoteMediaMetaPayload(record, objectId, chunkSize, chunkCount);
				},
				writer,
				contentKey,
				noncePrefix,
				startingRecordIndex: nextRecordIndex,
				manifestBuilder,
				onProgress,
				signal
			});
		}

		emitProgress(onProgress, { stage: 'writing-manifest' });
		const manifestBytes = encodeCanonicalCbor(manifestBuilder.build());
		await writeEncryptedRecord({
			writer,
			contentKey,
			noncePrefix,
			recordIndex: nextRecordIndex,
			recordType: 'manifest',
			encoding: 'cbor',
			payloadBytes: manifestBytes
		});
		assertNotAborted(signal);

		emitProgress(onProgress, { stage: 'finalizing' });
		await writer.close();
		writerClosed = true;
	} catch (error) {
		if (writer && !writerClosed) {
			try {
				await writer.abort(error);
			} catch (abortError) {
				clientLogger.debug('Backup writer abort failed while preserving original export error:', abortError);
			}
		}

		throw error;
	} finally {
		rootKey?.fill(0);
		contentKey?.fill(0);
	}
};

export {
	exportBackup,
	isBackupExportSupported
};