import {
	assertManifestMatchesExpected,
	buildRecordNonce,
	decodeCbor,
	decodeClearHeader,
	decodeRecordHeader,
	decryptRecord,
	deriveRootKey,
	parsePrelude,
	readUint32LittleEndian,
	unwrapContentKey,
	validateManifestPayload,
	verifyHeaderAuthentication
	
	
} from '@private-communication/pcbk-core';


import type {
	BackupRestoreError,
	BackupRestoreErrorCode,
	BackupRestoreProgress,
	BackupRestoreProgressHandler,
	BackupRestoreProgressStage,
	ParsedChunkedBackupObject,
	ParsedPcbkBackup,
	RestoreBackupOptions
	,
	AttachmentMetaRecordPayload,
	IdentityRecordPayload,
	RemoteMediaMetaRecordPayload,
	TransferQueueMetaRecordPayload
} from '@/types/backup';


import {
	assertCondition,
	validateAttachmentMetaRecordPayload,
	validateBackupOutboxRecord,
	validateBatchPayload,
	validateDecryptedMessage,
	validateIdentityRecordPayload,
	validateLinkPreviewRecord,
	validateRemoteMediaMetaRecordPayload,
	validateStoredPeerKey,
	validateTransferQueueMetaRecordPayload
} from './validators';

import type {ManifestPayload, PCBKRecordType} from '@private-communication/pcbk-core';

type MutableChunkedBackupObject<TMeta> = {
	objectId: string;
	meta: TMeta;
	chunks: Array<Uint8Array | undefined>;
	totalBytes: number;
};

const RECORD_AUTH_TAG_BYTES = 16;
const emitProgress = (handler: BackupRestoreProgressHandler | undefined, progress: BackupRestoreProgress): void => {
	handler?.(progress);
};

const createRestoreError = (
	code: BackupRestoreErrorCode,
	message: string,
	stage?: BackupRestoreProgressStage,
	cause?: unknown
): BackupRestoreError => {
	const error = new Error(message) as BackupRestoreError;
	error.name = 'BackupRestoreError';
	error.code = code;

	if (stage)
		error.stage = stage;

	if (cause !== undefined)
		error.cause = cause;

	return error;
};

const isBackupRestoreError = (error: unknown): error is BackupRestoreError => {
	return error instanceof Error && 'code' in error;
};

const assertNotAborted = (signal: AbortSignal | undefined, stage: BackupRestoreProgressStage): void => {
	if (signal?.aborted)
		throw createRestoreError('restore-canceled', 'Backup restore was canceled.', stage);
};

const toUint8Array = (value: ArrayBuffer): Uint8Array => {
	return new Uint8Array(value);
};

const expectRecordEncoding = (
	recordType: PCBKRecordType,
	actualEncoding: 'cbor' | 'bytes',
	expectedEncoding: 'cbor' | 'bytes'
): void => {
	if (actualEncoding !== expectedEncoding)
		throw createRestoreError('malformed-backup', `${recordType} must use ${expectedEncoding} encoding.`, 'decrypting-records');
};

const assertRecordAllowedInMode = (mode: ParsedPcbkBackup['clearHeader']['mode'], recordType: PCBKRecordType): void => {
	if (mode === 'identity-only' && recordType !== 'identity' && recordType !== 'manifest')
		throw createRestoreError('malformed-backup', `${recordType} is not allowed in identity-only backups.`, 'decrypting-records');
};

const finalizeChunkedObjects = <TMeta extends { chunkCount: number }>(
	objects: Map<string, MutableChunkedBackupObject<TMeta>>,
	label: string
): Array<ParsedChunkedBackupObject<TMeta>> => {
	return Array.from(objects.values()).map((entry) => {
		assertCondition(entry.chunks.every((chunk) => chunk instanceof Uint8Array), `${label} ${entry.objectId} has missing chunk data`);

		return {
			objectId: entry.objectId,
			meta: entry.meta,
			chunks: entry.chunks,
			totalBytes: entry.totalBytes
		};
	});
};

const buildExpectedManifest = (input: {
	backup: Omit<ParsedPcbkBackup, 'manifest'>;
	observedCounts: ManifestPayload['counts'];
}): ManifestPayload => {
	const { backup, observedCounts } = input;

	return {
		backupId: backup.clearHeader.backupId,
		mode: backup.clearHeader.mode,
		createdAt: backup.clearHeader.createdAt,
		totalRecordCount: backup.totalRecordCount,
		counts: observedCounts,
		objects: {
			attachments: backup.attachments.map((entry) => ({
				objectId: entry.objectId,
				chunkCount: entry.meta.chunkCount,
				size: entry.totalBytes
			})),
			transferQueue: backup.transferQueue.map((entry) => ({
				objectId: entry.objectId,
				chunkCount: entry.meta.chunkCount,
				size: entry.totalBytes
			})),
			remoteMedia: backup.remoteMedia.map((entry) => ({
				objectId: entry.objectId,
				chunkCount: entry.meta.chunkCount,
				size: entry.totalBytes
			}))
		}
	};
};

const parsePcbkBackupBytes = async (
	bytes: Uint8Array,
	passphrase: string,
	options: RestoreBackupOptions = {}
): Promise<ParsedPcbkBackup> => {
	const { onProgress, signal } = options;

	try {
		emitProgress(onProgress, {
			stage: 'parsing-prelude',
			processedBytes: 0,
			totalBytes: bytes.byteLength
		});
		assertNotAborted(signal, 'parsing-prelude');

		const prelude = parsePrelude(bytes);
		const clearHeader = decodeClearHeader(prelude.clearHeaderBytes);

		emitProgress(onProgress, {
			stage: 'deriving-root-key',
			mode: clearHeader.mode,
			processedBytes: prelude.preludeLength,
			totalBytes: bytes.byteLength
		});
		assertNotAborted(signal, 'deriving-root-key');

		const rootKey = await deriveRootKey({
			passphrase,
			salt: clearHeader.kdf.salt,
			memoryKiB: clearHeader.kdf.memoryKiB,
			iterations: clearHeader.kdf.iterations,
			parallelism: clearHeader.kdf.parallelism,
			hashLength: clearHeader.kdf.outputLength
		});

		emitProgress(onProgress, {
			stage: 'authenticating-header',
			mode: clearHeader.mode,
			processedBytes: prelude.preludeLength,
			totalBytes: bytes.byteLength
		});
		assertNotAborted(signal, 'authenticating-header');

		const verifiedHeader = await verifyHeaderAuthentication({
			rootKey,
			magic: prelude.magic,
			formatVersion: prelude.formatVersion,
			flags: prelude.flags,
			clearHeaderBytes: prelude.clearHeaderBytes,
			headerAuthTag: prelude.headerAuthTag
		});

		if (!verifiedHeader)
			throw createRestoreError('wrong-passphrase', 'Could not restore backup. The passphrase is wrong or the backup file is corrupted.', 'authenticating-header');

		emitProgress(onProgress, {
			stage: 'unwrapping-content-key',
			mode: clearHeader.mode,
			processedBytes: prelude.preludeLength,
			totalBytes: bytes.byteLength
		});
		assertNotAborted(signal, 'unwrapping-content-key');

		const { contentKey } = await unwrapContentKey({
			rootKey,
			clearHeader,
			magic: prelude.magic,
			formatVersion: prelude.formatVersion,
			flags: prelude.flags
		});

		const peerKeys: ParsedPcbkBackup['peerKeys'] = [];
		const messages: ParsedPcbkBackup['messages'] = [];
		const linkPreviews: ParsedPcbkBackup['linkPreviews'] = [];
		const outbox: ParsedPcbkBackup['outbox'] = [];
		const attachments = new Map<string, MutableChunkedBackupObject<AttachmentMetaRecordPayload>>();
		const transferQueue = new Map<string, MutableChunkedBackupObject<TransferQueueMetaRecordPayload>>();
		const remoteMedia = new Map<string, MutableChunkedBackupObject<RemoteMediaMetaRecordPayload>>();
		const observedCounts: ManifestPayload['counts'] = {
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
		};
		let identity: IdentityRecordPayload | null = null;
		let manifestPayloadValue: unknown = null;
		let offset = prelude.preludeLength;
		let expectedRecordIndex = 0;
		let totalRecordCount = 0;

		while (offset < bytes.length) {
			assertNotAborted(signal, 'decrypting-records');

			const recordHeaderLength = readUint32LittleEndian(bytes, offset);
			const recordHeaderStart = offset + 4;
			const recordHeaderEnd = recordHeaderStart + recordHeaderLength;
			const headerBytes = bytes.slice(recordHeaderStart, recordHeaderEnd);

			if (recordHeaderEnd > bytes.length)
				throw createRestoreError('malformed-backup', 'Backup record header exceeds file length.', 'decrypting-records');

			const recordHeader = decodeRecordHeader(headerBytes);

			if (recordHeader.index !== expectedRecordIndex)
				throw createRestoreError('malformed-backup', 'Backup record indices are out of order.', 'decrypting-records');

			const expectedCipherLength = recordHeader.plainLength + RECORD_AUTH_TAG_BYTES;

			if (recordHeader.cipherLength !== expectedCipherLength)
				throw createRestoreError('malformed-backup', 'Backup record cipherLength is inconsistent with plainLength.', 'decrypting-records');

			const cipherStart = recordHeaderEnd;
			const cipherEnd = cipherStart + recordHeader.cipherLength;

			if (cipherEnd > bytes.length)
				throw createRestoreError('malformed-backup', 'Backup record ciphertext exceeds file length.', 'decrypting-records');

			const ciphertext = bytes.slice(cipherStart, cipherEnd);
			const nonce = buildRecordNonce(clearHeader.recordCipher.noncePrefix, recordHeader.index);
			let payloadBytes: Uint8Array;

			try {
				payloadBytes = (await decryptRecord({
					contentKey,
					nonce,
					headerBytes,
					ciphertext
				})).payloadBytes;
			} catch (error) {
				throw createRestoreError('corrupted-backup', 'Could not restore backup. Record decryption failed.', 'decrypting-records', error);
			}

			if (payloadBytes.length !== recordHeader.plainLength)
				throw createRestoreError('malformed-backup', 'Backup record plainLength does not match decrypted payload.', 'decrypting-records');

			assertRecordAllowedInMode(clearHeader.mode, recordHeader.type);

			switch (recordHeader.type) {
				case 'identity': {
					expectRecordEncoding(recordHeader.type, recordHeader.encoding, 'cbor');

					if (identity)
						throw createRestoreError('malformed-backup', 'Backup contains more than one identity record.', 'decrypting-records');

					identity = validateIdentityRecordPayload(decodeCbor(payloadBytes));
					break;
				}

				case 'peer-keys-batch': {
					expectRecordEncoding(recordHeader.type, recordHeader.encoding, 'cbor');
					const payload = validateBatchPayload(decodeCbor(payloadBytes), validateStoredPeerKey, recordHeader.type);
					peerKeys.push(...payload.items);
					observedCounts.peerKeys += payload.items.length;
					break;
				}

				case 'messages-batch': {
					expectRecordEncoding(recordHeader.type, recordHeader.encoding, 'cbor');
					const payload = validateBatchPayload(decodeCbor(payloadBytes), validateDecryptedMessage, recordHeader.type);
					messages.push(...payload.items);
					observedCounts.messages += payload.items.length;
					break;
				}

				case 'link-previews-batch': {
					expectRecordEncoding(recordHeader.type, recordHeader.encoding, 'cbor');
					const payload = validateBatchPayload(decodeCbor(payloadBytes), validateLinkPreviewRecord, recordHeader.type);
					linkPreviews.push(...payload.items);
					observedCounts.linkPreviews += payload.items.length;
					break;
				}

				case 'outbox-batch': {
					expectRecordEncoding(recordHeader.type, recordHeader.encoding, 'cbor');
					const payload = validateBatchPayload(decodeCbor(payloadBytes), validateBackupOutboxRecord, recordHeader.type);
					outbox.push(...payload.items);
					observedCounts.outbox += payload.items.length;
					break;
				}

				case 'attachment-meta': {
					expectRecordEncoding(recordHeader.type, recordHeader.encoding, 'cbor');
					assertCondition(recordHeader.objectId, 'attachment-meta requires objectId');

					if (attachments.has(recordHeader.objectId))
						throw createRestoreError('malformed-backup', `Duplicate attachment objectId ${recordHeader.objectId}.`, 'decrypting-records');

					const meta = validateAttachmentMetaRecordPayload(decodeCbor(payloadBytes));
					attachments.set(recordHeader.objectId, {
						objectId: recordHeader.objectId,
						meta,
						chunks: Array.from({ length: meta.chunkCount }),
						totalBytes: 0
					});
					observedCounts.attachments += 1;
					break;
				}

				case 'attachment-chunk': {
					expectRecordEncoding(recordHeader.type, recordHeader.encoding, 'bytes');
					assertCondition(recordHeader.objectId, 'attachment-chunk requires objectId');
					const entry = attachments.get(recordHeader.objectId);

					if (!entry)
						throw createRestoreError('malformed-backup', `attachment-chunk ${recordHeader.objectId} appears before metadata.`, 'decrypting-records');

					if (recordHeader.chunkCount !== entry.meta.chunkCount)
						throw createRestoreError('malformed-backup', `attachment-chunk ${recordHeader.objectId} chunkCount does not match metadata.`, 'decrypting-records');

					assertCondition(recordHeader.chunkIndex !== undefined, 'attachment-chunk requires chunkIndex');

					if (entry.chunks[recordHeader.chunkIndex])
						throw createRestoreError('malformed-backup', `attachment-chunk ${recordHeader.objectId} repeats chunk ${recordHeader.chunkIndex}.`, 'decrypting-records');

					entry.chunks[recordHeader.chunkIndex] = payloadBytes;
					entry.totalBytes += payloadBytes.length;
					observedCounts.attachmentChunks += 1;
					break;
				}

				case 'transfer-queue-meta': {
					expectRecordEncoding(recordHeader.type, recordHeader.encoding, 'cbor');
					assertCondition(recordHeader.objectId, 'transfer-queue-meta requires objectId');

					if (transferQueue.has(recordHeader.objectId))
						throw createRestoreError('malformed-backup', `Duplicate transfer queue objectId ${recordHeader.objectId}.`, 'decrypting-records');

					const meta = validateTransferQueueMetaRecordPayload(decodeCbor(payloadBytes));
					transferQueue.set(recordHeader.objectId, {
						objectId: recordHeader.objectId,
						meta,
						chunks: Array.from({ length: meta.chunkCount }),
						totalBytes: 0
					});
					observedCounts.transferQueue += 1;
					break;
				}

				case 'transfer-queue-chunk': {
					expectRecordEncoding(recordHeader.type, recordHeader.encoding, 'bytes');
					assertCondition(recordHeader.objectId, 'transfer-queue-chunk requires objectId');
					const entry = transferQueue.get(recordHeader.objectId);

					if (!entry)
						throw createRestoreError('malformed-backup', `transfer-queue-chunk ${recordHeader.objectId} appears before metadata.`, 'decrypting-records');

					if (recordHeader.chunkCount !== entry.meta.chunkCount)
						throw createRestoreError('malformed-backup', `transfer-queue-chunk ${recordHeader.objectId} chunkCount does not match metadata.`, 'decrypting-records');

					assertCondition(recordHeader.chunkIndex !== undefined, 'transfer-queue-chunk requires chunkIndex');

					if (entry.chunks[recordHeader.chunkIndex])
						throw createRestoreError('malformed-backup', `transfer-queue-chunk ${recordHeader.objectId} repeats chunk ${recordHeader.chunkIndex}.`, 'decrypting-records');

					entry.chunks[recordHeader.chunkIndex] = payloadBytes;
					entry.totalBytes += payloadBytes.length;
					observedCounts.transferQueueChunks += 1;
					break;
				}

				case 'remote-media-meta': {
					expectRecordEncoding(recordHeader.type, recordHeader.encoding, 'cbor');
					assertCondition(recordHeader.objectId, 'remote-media-meta requires objectId');

					if (remoteMedia.has(recordHeader.objectId))
						throw createRestoreError('malformed-backup', `Duplicate remote media objectId ${recordHeader.objectId}.`, 'decrypting-records');

					const meta = validateRemoteMediaMetaRecordPayload(decodeCbor(payloadBytes));
					remoteMedia.set(recordHeader.objectId, {
						objectId: recordHeader.objectId,
						meta,
						chunks: Array.from({ length: meta.chunkCount }),
						totalBytes: 0
					});
					observedCounts.remoteMedia += 1;
					break;
				}

				case 'remote-media-chunk': {
					expectRecordEncoding(recordHeader.type, recordHeader.encoding, 'bytes');
					assertCondition(recordHeader.objectId, 'remote-media-chunk requires objectId');
					const entry = remoteMedia.get(recordHeader.objectId);

					if (!entry)
						throw createRestoreError('malformed-backup', `remote-media-chunk ${recordHeader.objectId} appears before metadata.`, 'decrypting-records');

					if (recordHeader.chunkCount !== entry.meta.chunkCount)
						throw createRestoreError('malformed-backup', `remote-media-chunk ${recordHeader.objectId} chunkCount does not match metadata.`, 'decrypting-records');

					assertCondition(recordHeader.chunkIndex !== undefined, 'remote-media-chunk requires chunkIndex');

					if (entry.chunks[recordHeader.chunkIndex])
						throw createRestoreError('malformed-backup', `remote-media-chunk ${recordHeader.objectId} repeats chunk ${recordHeader.chunkIndex}.`, 'decrypting-records');

					entry.chunks[recordHeader.chunkIndex] = payloadBytes;
					entry.totalBytes += payloadBytes.length;
					observedCounts.remoteMediaChunks += 1;
					break;
				}

				case 'manifest': {
					expectRecordEncoding(recordHeader.type, recordHeader.encoding, 'cbor');

					if (cipherEnd !== bytes.length)
						throw createRestoreError('malformed-backup', 'Manifest record must be final.', 'decrypting-records');

					manifestPayloadValue = decodeCbor(payloadBytes);
					break;
				}
			}

			offset = cipherEnd;
			expectedRecordIndex += 1;
			totalRecordCount += 1;

			emitProgress(onProgress, {
				stage: 'decrypting-records',
				mode: clearHeader.mode,
				processedItems: totalRecordCount,
				processedBytes: offset,
				totalBytes: bytes.length
			});

			if (recordHeader.type === 'manifest')
				break;
		}

		if (!identity)
			throw createRestoreError('malformed-backup', 'Backup is missing identity record.', 'decrypting-records');

		if (manifestPayloadValue === null)
			throw createRestoreError('malformed-backup', 'Backup is missing manifest record.', 'decrypting-records');

		const attachmentsList = finalizeChunkedObjects(attachments, 'attachment');
		const transferQueueList = finalizeChunkedObjects(transferQueue, 'transfer queue');
		const remoteMediaList = finalizeChunkedObjects(remoteMedia, 'remote media');

		const partialBackup = {
			prelude,
			clearHeader,
			identity: identity.identity,
			peerKeys,
			messages,
			linkPreviews,
			outbox,
			attachments: attachmentsList,
			transferQueue: transferQueueList,
			remoteMedia: remoteMediaList,
			totalRecordCount
		};
		const expectedManifest = buildExpectedManifest({
			backup: partialBackup,
			observedCounts
		});
		const manifest = assertManifestMatchesExpected(
			validateManifestPayload(manifestPayloadValue, expectedManifest),
			expectedManifest
		);

		return {
			...partialBackup,
			manifest
		};
	} catch (error) {
		if (isBackupRestoreError(error))
			throw error;

		if (error instanceof Error)
			throw createRestoreError('malformed-backup', error.message, error.name === 'OperationError' ? 'decrypting-records' : undefined, error);

		throw createRestoreError('unknown', 'Could not parse PCBK backup.');
	}
};

const parsePcbkBackupFile = async (
	file: File,
	passphrase: string,
	options: RestoreBackupOptions = {}
): Promise<ParsedPcbkBackup> => {
	const { onProgress, signal } = options;

	emitProgress(onProgress, {
		stage: 'reading-file',
		processedBytes: 0,
		totalBytes: file.size
	});
	assertNotAborted(signal, 'reading-file');

	const bytes = toUint8Array(await file.arrayBuffer());

	emitProgress(onProgress, {
		stage: 'reading-file',
		processedBytes: file.size,
		totalBytes: file.size
	});

	return parsePcbkBackupBytes(bytes, passphrase, options);
};

export {
	parsePcbkBackupBytes,
	parsePcbkBackupFile
};