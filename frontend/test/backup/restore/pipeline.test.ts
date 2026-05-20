import {
	authenticateHeader,
	buildClearHeader,
	buildKeyWrapAadHeader,
	buildRecordHeader,
	buildRecordNonce,
	createManifestBuilder,
	decodeRecordHeader,
	deriveRootKey,
	encodeCanonicalCbor,
	encryptRecord,
	parsePrelude,
	readUint32LittleEndian,
	wrapContentKey,
	PCBK_FLAGS,
	PCBK_FORMAT_VERSION,
	PCBK_MAGIC,
	PCBK_RECORD_VERSION
	
	
	
	
} from '@private-communication/pcbk-core';
import { describe, expect, it } from 'vitest';


import { parsePcbkBackupBytes } from '@/services/backup';

import type {Argon2Profile, ManifestPayload, PCBKMode, PCBKRecordType} from '@private-communication/pcbk-core';

const TEST_PASSPHRASE = 'phase-6-restore-passphrase';
const TEST_CREATED_AT = 1_700_000_000_000;
const RECORD_AUTH_TAG_BYTES = 16;

const TEST_PROFILE: Argon2Profile = {
	name: 'controlled-fallback',
	memoryKiB: 8192,
	iterations: 1,
	parallelism: 1,
	hashLength: 32,
	saltLength: 16
};

type RecordSpec = {
	type: Exclude<PCBKRecordType, 'manifest'>;
	encoding: 'cbor' | 'bytes';
	payloadBytes: Uint8Array;
	objectId?: string;
	chunkIndex?: number;
	chunkCount?: number;
	itemCount?: number;
	objectSize?: number;
	index?: number;
};

type RecordRange = {
	type: PCBKRecordType;
	headerStart: number;
	headerEnd: number;
	cipherStart: number;
	cipherEnd: number;
};

type FixtureBuildOptions = {
	includeManifest?: boolean;
	mutateManifest?: (manifest: ManifestPayload) => ManifestPayload;
	mutateAttachmentMeta?: (payload: Record<string, unknown>) => Record<string, unknown>;
	recordIndexOverrides?: Partial<Record<Exclude<PCBKRecordType, 'manifest'>, number>>;
	attachmentChunkCount?: number;
	attachmentChunks?: Uint8Array[];
	transferQueueChunkCount?: number;
	transferQueueChunks?: Uint8Array[];
	remoteMediaChunkCount?: number;
	remoteMediaChunks?: Uint8Array[];
};

const createBytes = (length: number, start: number): Uint8Array => {
	const bytes = new Uint8Array(length);

	for (let index = 0; index < length; index += 1)
		bytes[index] = (start + index) % 256;

	return bytes;
};

const concatBytes = (...arrays: Uint8Array[]): Uint8Array => {
	const totalLength = arrays.reduce((sum, bytes) => sum + bytes.length, 0);
	const combined = new Uint8Array(totalLength);
	let offset = 0;

	for (const bytes of arrays) {
		combined.set(bytes, offset);
		offset += bytes.length;
	}

	return combined;
};

const encodeUint32LittleEndian = (value: number): Uint8Array => {
	const bytes = new Uint8Array(4);
	new DataView(bytes.buffer).setUint32(0, value, true);
	return bytes;
};

const buildPreludeBytes = (clearHeaderBytes: Uint8Array, headerAuthTag: Uint8Array): Uint8Array => {
	return concatBytes(
		new TextEncoder().encode(PCBK_MAGIC),
		new Uint8Array([PCBK_FORMAT_VERSION, PCBK_FLAGS]),
		encodeUint32LittleEndian(clearHeaderBytes.length),
		clearHeaderBytes,
		headerAuthTag
	);
};

const createIdentityPayload = () => ({
	version: 1,
	createdAt: TEST_CREATED_AT - 1_000,
	identity: {
		userId: 'user-alice',
		fingerprint: 'fingerprint-alice',
		encryption: {
			publicKeySpki: 'enc-public-spki',
			privateKeyPkcs8: 'enc-private-pkcs8'
		},
		signing: {
			publicKeySpki: 'sign-public-spki',
			privateKeyPkcs8: 'sign-private-pkcs8'
		}
	}
});

const createFullFixture = async (options: FixtureBuildOptions = {}) => {
	const identityPayload = createIdentityPayload();
	const peerKey = {
		peerId: 'user-bob',
		encryptionPublicKey: 'peer-enc-public',
		signingPublicKey: 'peer-sign-public',
		displayName: 'Bob',
		fingerprint: 'peer-fingerprint',
		addedAt: TEST_CREATED_AT - 500,
		lastVerified: TEST_CREATED_AT - 250
	};
	const message = {
		id: 'message-1',
		senderId: 'user-alice',
		recipientId: 'user-bob',
		timestamp: TEST_CREATED_AT - 400,
		content: 'hello restore',
		type: 'text' as const,
		status: 'read' as const
	};
	const linkPreview = {
		url: 'https://example.com',
		title: 'Example',
		description: 'Link preview',
		image: 'https://example.com/image.png',
		siteName: 'Example',
		fetchedAt: TEST_CREATED_AT - 300
	};
	const outbox = {
		id: 'outbox-1',
		recipientId: 'user-bob',
		payload: {
			id: 'encrypted-1',
			senderId: 'user-alice',
			recipientId: 'user-bob',
			timestamp: TEST_CREATED_AT - 200,
			payload: {
				iv: 'iv-1',
				cipherText: 'cipher-1'
			},
			signature: 'signature-1'
		},
		createdAt: TEST_CREATED_AT - 200,
		lastAttemptAt: TEST_CREATED_AT - 100,
		attempts: 1
	};
	const attachmentBytes = options.attachmentChunks?.[0]
		? concatBytes(...options.attachmentChunks)
		: new TextEncoder().encode('attachment-bytes');
	const attachmentChunks = options.attachmentChunks ?? [attachmentBytes];
	const attachmentChunkCount = options.attachmentChunkCount ?? attachmentChunks.length;
	const attachmentId = 'attachment-1';
	const attachmentMeta = {
		attachmentId,
		peerId: 'user-bob',
		messageId: 'message-1',
		fileName: 'note.txt',
		mimeType: 'text/plain',
		size: attachmentBytes.length,
		kind: 'document',
		plaintextHashSha256: 'hash-attachment',
		createdAt: TEST_CREATED_AT - 450,
		updatedAt: TEST_CREATED_AT - 440,
		lastAccessedAt: TEST_CREATED_AT - 430,
		chunkSize: attachmentChunks[0]?.length ?? attachmentBytes.length,
		chunkCount: attachmentChunkCount
	};
	const attachmentMetaPayload = options.mutateAttachmentMeta
		? options.mutateAttachmentMeta(attachmentMeta)
		: attachmentMeta;
	const transferQueueBytes = options.transferQueueChunks?.[0]
		? concatBytes(...options.transferQueueChunks)
		: new TextEncoder().encode('transfer-queue-bytes');
	const transferQueueChunks = options.transferQueueChunks ?? [transferQueueBytes];
	const transferQueueChunkCount = options.transferQueueChunkCount ?? transferQueueChunks.length;
	const transferQueueId = 'transfer-1';
	const transferQueueMeta = {
		id: transferQueueId,
		recipientId: 'user-bob',
		meta: {
			name: 'queued.bin',
			size: transferQueueBytes.length,
			type: 'application/octet-stream',
			lastModified: TEST_CREATED_AT - 420
		},
		upload: null,
		messageDispatch: null,
		uiSource: null,
		attachment: null,
		manifest: null,
		persistLocally: true,
		status: 'pending',
		retryCount: 0,
		createdAt: TEST_CREATED_AT - 410,
		updatedAt: TEST_CREATED_AT - 405,
		lastError: null,
		chunkSize: transferQueueChunks[0]?.length ?? transferQueueBytes.length,
		chunkCount: transferQueueChunkCount
	};
	const remoteMediaBytes = options.remoteMediaChunks?.[0]
		? concatBytes(...options.remoteMediaChunks)
		: new TextEncoder().encode('remote-media-bytes');
	const remoteMediaChunks = options.remoteMediaChunks ?? [remoteMediaBytes];
	const remoteMediaChunkCount = options.remoteMediaChunkCount ?? remoteMediaChunks.length;
	const remoteMediaId = 'media-1';
	const remoteMediaMeta = {
		mediaId: remoteMediaId,
		url: 'https://example.com/media.png',
		mimeType: 'image/png',
		extension: 'png',
		isFavorite: true,
		sourceHost: 'example.com',
		peerId: 'user-bob',
		messageId: 'message-1',
		createdAt: TEST_CREATED_AT - 390,
		updatedAt: TEST_CREATED_AT - 385,
		lastAccessedAt: TEST_CREATED_AT - 380,
		expiresAt: TEST_CREATED_AT + 10_000,
		chunkSize: remoteMediaChunks[0]?.length ?? remoteMediaBytes.length,
		chunkCount: remoteMediaChunkCount
	};

	const records: RecordSpec[] = [
		{
			type: 'identity',
			encoding: 'cbor',
			payloadBytes: encodeCanonicalCbor({ identity: identityPayload }),
			index: options.recordIndexOverrides?.identity
		},
		{
			type: 'peer-keys-batch',
			encoding: 'cbor',
			payloadBytes: encodeCanonicalCbor({ items: [peerKey] }),
			itemCount: 1,
			index: options.recordIndexOverrides?.['peer-keys-batch']
		},
		{
			type: 'messages-batch',
			encoding: 'cbor',
			payloadBytes: encodeCanonicalCbor({ items: [message] }),
			itemCount: 1,
			index: options.recordIndexOverrides?.['messages-batch']
		},
		{
			type: 'link-previews-batch',
			encoding: 'cbor',
			payloadBytes: encodeCanonicalCbor({ items: [linkPreview] }),
			itemCount: 1,
			index: options.recordIndexOverrides?.['link-previews-batch']
		},
		{
			type: 'outbox-batch',
			encoding: 'cbor',
			payloadBytes: encodeCanonicalCbor({ items: [outbox] }),
			itemCount: 1,
			index: options.recordIndexOverrides?.['outbox-batch']
		},
		{
			type: 'attachment-meta',
			encoding: 'cbor',
			payloadBytes: encodeCanonicalCbor(attachmentMetaPayload),
			objectId: attachmentId,
			chunkCount: attachmentChunkCount,
			objectSize: attachmentBytes.length,
			index: options.recordIndexOverrides?.['attachment-meta']
		},
		...attachmentChunks.map((chunk, chunkIndex) => ({
			type: 'attachment-chunk' as const,
			encoding: 'bytes' as const,
			payloadBytes: chunk,
			objectId: attachmentId,
			chunkIndex,
			chunkCount: attachmentChunkCount,
			index: options.recordIndexOverrides?.['attachment-chunk']
		})),
		{
			type: 'transfer-queue-meta',
			encoding: 'cbor',
			payloadBytes: encodeCanonicalCbor(transferQueueMeta),
			objectId: transferQueueId,
			chunkCount: transferQueueChunkCount,
			objectSize: transferQueueBytes.length,
			index: options.recordIndexOverrides?.['transfer-queue-meta']
		},
		...transferQueueChunks.map((chunk, chunkIndex) => ({
			type: 'transfer-queue-chunk' as const,
			encoding: 'bytes' as const,
			payloadBytes: chunk,
			objectId: transferQueueId,
			chunkIndex,
			chunkCount: transferQueueChunkCount,
			index: options.recordIndexOverrides?.['transfer-queue-chunk']
		})),
		{
			type: 'remote-media-meta',
			encoding: 'cbor',
			payloadBytes: encodeCanonicalCbor(remoteMediaMeta),
			objectId: remoteMediaId,
			chunkCount: remoteMediaChunkCount,
			objectSize: remoteMediaBytes.length,
			index: options.recordIndexOverrides?.['remote-media-meta']
		},
		...remoteMediaChunks.map((chunk, chunkIndex) => ({
			type: 'remote-media-chunk' as const,
			encoding: 'bytes' as const,
			payloadBytes: chunk,
			objectId: remoteMediaId,
			chunkIndex,
			chunkCount: remoteMediaChunkCount,
			index: options.recordIndexOverrides?.['remote-media-chunk']
		}))
	];

	const bytes = await createBackupBytes({
		mode: 'full',
		records,
		includeManifest: options.includeManifest,
		mutateManifest: options.mutateManifest
	});

	return {
		bytes,
		passphrase: TEST_PASSPHRASE,
		samples: {
			identityPayload,
			peerKey,
			message,
			linkPreview,
			outbox,
			attachmentId,
			attachmentBytes,
			transferQueueId,
			transferQueueBytes,
			remoteMediaId,
			remoteMediaBytes
		}
	};
};

const createIdentityOnlyFixture = async (options: Pick<FixtureBuildOptions, 'includeManifest' | 'mutateManifest'> = {}) => {
	const identityPayload = createIdentityPayload();
	const bytes = await createBackupBytes({
		mode: 'identity-only',
		records: [{
			type: 'identity',
			encoding: 'cbor',
			payloadBytes: encodeCanonicalCbor({ identity: identityPayload })
		}],
		includeManifest: options.includeManifest,
		mutateManifest: options.mutateManifest
	});

	return {
		bytes,
		passphrase: TEST_PASSPHRASE,
		identityPayload
	};
};

const createBackupBytes = async (input: {
	mode: PCBKMode;
	records: RecordSpec[];
	includeManifest?: boolean;
	mutateManifest?: (manifest: ManifestPayload) => ManifestPayload;
}): Promise<Uint8Array> => {
	const backupId = createBytes(16, 41);
	const salt = createBytes(16, 61);
	const wrapIv = createBytes(12, 81);
	const noncePrefix = createBytes(4, 91);
	const rootKey = await deriveRootKey({
		passphrase: TEST_PASSPHRASE,
		salt,
		memoryKiB: TEST_PROFILE.memoryKiB,
		iterations: TEST_PROFILE.iterations,
		parallelism: TEST_PROFILE.parallelism,
		hashLength: TEST_PROFILE.hashLength
	});
	const contentKey = createBytes(32, 201);
	const keyWrapAadHeaderBytes = buildKeyWrapAadHeader({
		mode: input.mode,
		createdAt: TEST_CREATED_AT,
		backupId,
		kdfProfile: TEST_PROFILE,
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
	const { clearHeaderBytes } = await buildClearHeader({
		mode: input.mode,
		createdAt: TEST_CREATED_AT,
		backupId,
		kdfProfile: TEST_PROFILE,
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
	const manifestBuilder = createManifestBuilder({
		backupId,
		mode: input.mode,
		createdAt: TEST_CREATED_AT,
		totalRecordCount: 0
	});
	const bodyParts: Uint8Array[] = [];
	let nextRecordIndex = 0;

	for (const record of input.records) {
		const recordIndex = record.index ?? nextRecordIndex;
		nextRecordIndex = recordIndex + 1;
		const hasChunkCoordinates = record.chunkIndex !== undefined && record.chunkCount !== undefined;
		const headerBytes = buildRecordHeader({
			recordVersion: PCBK_RECORD_VERSION,
			type: record.type,
			index: recordIndex,
			encoding: record.encoding,
			plainLength: record.payloadBytes.length,
			cipherLength: record.payloadBytes.length + RECORD_AUTH_TAG_BYTES,
			objectId: record.objectId,
			chunkIndex: hasChunkCoordinates ? record.chunkIndex : undefined,
			chunkCount: hasChunkCoordinates ? record.chunkCount : undefined
		});
		const nonce = buildRecordNonce(noncePrefix, recordIndex);
		const encryptedRecord = await encryptRecord({
			contentKey,
			nonce,
			headerBytes,
			payloadBytes: record.payloadBytes
		});

		bodyParts.push(concatBytes(
			encodeUint32LittleEndian(headerBytes.length),
			headerBytes,
			encryptedRecord.ciphertext
		));
		manifestBuilder.trackRecord({
			type: record.type,
			itemCount: record.itemCount,
			objectId: record.objectId,
			chunkCount: record.chunkCount,
			size: record.objectSize
		});
	}

	if (input.includeManifest !== false) {
		const manifestPayload = input.mutateManifest
			? input.mutateManifest(manifestBuilder.build())
			: manifestBuilder.build();
		const manifestBytes = encodeCanonicalCbor(manifestPayload);
		const headerBytes = buildRecordHeader({
			recordVersion: PCBK_RECORD_VERSION,
			type: 'manifest',
			index: nextRecordIndex,
			encoding: 'cbor',
			plainLength: manifestBytes.length,
			cipherLength: manifestBytes.length + RECORD_AUTH_TAG_BYTES
		});
		const nonce = buildRecordNonce(noncePrefix, nextRecordIndex);
		const encryptedRecord = await encryptRecord({
			contentKey,
			nonce,
			headerBytes,
			payloadBytes: manifestBytes
		});

		bodyParts.push(concatBytes(
			encodeUint32LittleEndian(headerBytes.length),
			headerBytes,
			encryptedRecord.ciphertext
		));
	}

	return concatBytes(buildPreludeBytes(clearHeaderBytes, headerAuthTag), ...bodyParts);
};

const listRecordRanges = (bytes: Uint8Array): RecordRange[] => {
	const prelude = parsePrelude(bytes);
	const ranges: RecordRange[] = [];
	let offset = prelude.preludeLength;

	while (offset < bytes.length) {
		const headerLength = readUint32LittleEndian(bytes, offset);
		const headerStart = offset + 4;
		const headerEnd = headerStart + headerLength;
		const recordHeader = decodeRecordHeader(bytes.slice(headerStart, headerEnd));
		const cipherStart = headerEnd;
		const cipherEnd = cipherStart + recordHeader.cipherLength;

		ranges.push({
			type: recordHeader.type,
			headerStart,
			headerEnd,
			cipherStart,
			cipherEnd
		});
		offset = cipherEnd;
	}

	return ranges;
};

const tamperClearHeaderLength = (bytes: Uint8Array): Uint8Array => {
	const tampered = Uint8Array.from(bytes);
	const clearHeaderLengthOffset = new TextEncoder().encode(PCBK_MAGIC).length + 2;
	tampered.fill(0, clearHeaderLengthOffset, clearHeaderLengthOffset + 4);
	return tampered;
};

describe('PCBK restore pipeline', () => {
	it('parses identity-only backups', async () => {
		const fixture = await createIdentityOnlyFixture();
		const parsed = await parsePcbkBackupBytes(fixture.bytes, fixture.passphrase);

		expect(parsed.clearHeader.mode).toBe('identity-only');
		expect(parsed.identity.identity.userId).toBe(fixture.identityPayload.identity.userId);
		expect(parsed.peerKeys).toHaveLength(0);
		expect(parsed.messages).toHaveLength(0);
		expect(parsed.attachments).toHaveLength(0);
		expect(parsed.manifest.totalRecordCount).toBe(2);
	});

	it('parses full backups with chunked objects', async () => {
		const fixture = await createFullFixture();
		const parsed = await parsePcbkBackupBytes(fixture.bytes, fixture.passphrase);

		expect(parsed.clearHeader.mode).toBe('full');
		expect(parsed.peerKeys).toHaveLength(1);
		expect(parsed.messages).toHaveLength(1);
		expect(parsed.linkPreviews).toHaveLength(1);
		expect(parsed.outbox).toHaveLength(1);
		expect(parsed.attachments).toHaveLength(1);
		expect(parsed.transferQueue).toHaveLength(1);
		expect(parsed.remoteMedia).toHaveLength(1);
		expect(parsed.attachments[0].objectId).toBe(fixture.samples.attachmentId);
		expect(Array.from(parsed.attachments[0].chunks[0])).toEqual(Array.from(fixture.samples.attachmentBytes));
		expect(Array.from(parsed.transferQueue[0].chunks[0])).toEqual(Array.from(fixture.samples.transferQueueBytes));
		expect(Array.from(parsed.remoteMedia[0].chunks[0])).toEqual(Array.from(fixture.samples.remoteMediaBytes));
		expect(parsed.manifest.counts.peerKeys).toBe(1);
		expect(parsed.manifest.counts.messages).toBe(1);
		expect(parsed.manifest.counts.attachments).toBe(1);
	});

	it('rejects wrong passphrase', async () => {
		const fixture = await createIdentityOnlyFixture();

		await expect(parsePcbkBackupBytes(fixture.bytes, 'wrong-passphrase')).rejects.toMatchObject({
			code: 'wrong-passphrase',
			stage: 'authenticating-header'
		});
	});

	it('rejects corrupted clear header', async () => {
		const fixture = await createIdentityOnlyFixture();

		await expect(parsePcbkBackupBytes(tamperClearHeaderLength(fixture.bytes), fixture.passphrase)).rejects.toMatchObject({
			code: 'malformed-backup'
		});
	});

	it('rejects corrupted record ciphertext', async () => {
		const fixture = await createFullFixture();
		const tampered = Uint8Array.from(fixture.bytes);
		const record = listRecordRanges(tampered).find((entry) => entry.type === 'messages-batch');

		expect(record).toBeDefined();
		tampered[(record!).cipherEnd - 1] ^= 0x01;

		await expect(parsePcbkBackupBytes(tampered, fixture.passphrase)).rejects.toMatchObject({
			code: 'corrupted-backup',
			stage: 'decrypting-records'
		});
	});

	it('rejects invalid record order', async () => {
		const fixture = await createFullFixture({
			recordIndexOverrides: {
				'peer-keys-batch': 99
			}
		});

		await expect(parsePcbkBackupBytes(fixture.bytes, fixture.passphrase)).rejects.toMatchObject({
			code: 'malformed-backup',
			stage: 'decrypting-records'
		});
	});

	it('rejects missing manifest', async () => {
		const fixture = await createIdentityOnlyFixture({ includeManifest: false });

		await expect(parsePcbkBackupBytes(fixture.bytes, fixture.passphrase)).rejects.toMatchObject({
			code: 'malformed-backup',
			stage: 'decrypting-records'
		});
	});

	it('rejects mismatched manifest counts', async () => {
		const fixture = await createFullFixture({
			mutateManifest: (manifest) => ({
				...manifest,
				counts: {
					...manifest.counts,
					messages: manifest.counts.messages + 1
				}
			})
		});

		await expect(parsePcbkBackupBytes(fixture.bytes, fixture.passphrase)).rejects.toMatchObject({
			code: 'malformed-backup'
		});
	});

	it('rejects incomplete chunk sequences', async () => {
		const fixture = await createFullFixture({
			attachmentChunkCount: 2,
			attachmentChunks: [new TextEncoder().encode('partial-attachment')]
		});

		await expect(parsePcbkBackupBytes(fixture.bytes, fixture.passphrase)).rejects.toMatchObject({
			code: 'malformed-backup'
		});
	});

	it('rejects unsafe restore payload counters', async () => {
		const fixture = await createFullFixture({
			mutateAttachmentMeta: (payload) => ({
				...payload,
				chunkCount: 1.5
			})
		});

		await expect(parsePcbkBackupBytes(fixture.bytes, fixture.passphrase)).rejects.toMatchObject({
			code: 'malformed-backup'
		});
	});
});