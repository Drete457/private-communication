import { describe, expect, it } from 'vitest';

import {
	PCBK_FLAGS,
	PCBK_FORMAT_VERSION,
	PCBK_MAGIC,
	PCBK_RECORD_VERSION,
	authenticateHeader,
	buildClearHeader,
	buildKeyWrapAadHeader,
	buildRecordHeader,
	buildRecordNonce,
	decodeClearHeader,
	decryptRecord,
	encryptRecord,
	parsePrelude,
	unwrapContentKey,
	validateRecordHeader,
	validateManifestPayload,
	verifyHeaderAuthentication,
	wrapContentKey
} from '../src/index';

import type { Argon2Profile, ManifestSummary } from '../src/index';

const TEST_PROFILE: Argon2Profile = {
	name: 'controlled-fallback',
	memoryKiB: 8192,
	iterations: 1,
	parallelism: 1,
	hashLength: 32,
	saltLength: 16
};

const createBytes = (length: number, start: number): Uint8Array => Uint8Array.from(
	{ length },
	(_value, index) => (start + index) % 256
);

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

const createHeaderFixture = async () => {
	const rootKey = createBytes(32, 1);
	const wrongRootKey = createBytes(32, 101);
	const contentKey = createBytes(32, 201);
	const backupId = createBytes(16, 41);
	const salt = createBytes(16, 61);
	const wrapIv = createBytes(12, 81);
	const noncePrefix = createBytes(4, 91);
	const createdAt = 1700000000000;
	const keyWrapAadHeaderBytes = buildKeyWrapAadHeader({
		mode: 'full',
		createdAt,
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
	const { clearHeaderBytes } = buildClearHeader({
		mode: 'full',
		createdAt,
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

	return {
		rootKey,
		wrongRootKey,
		contentKey,
		clearHeaderBytes,
		headerAuthTag,
		preludeBytes: buildPreludeBytes(clearHeaderBytes, headerAuthTag)
	};
};

describe('pcbk-core restore primitives', () => {
	it('parses prelude, validates clear header, verifies auth, and unwraps content key', async () => {
		const fixture = await createHeaderFixture();
		const parsedPrelude = parsePrelude(fixture.preludeBytes);

		expect(parsedPrelude.magic).toBe(PCBK_MAGIC);
		expect(parsedPrelude.formatVersion).toBe(PCBK_FORMAT_VERSION);
		expect(parsedPrelude.flags).toBe(PCBK_FLAGS);
		expect(Array.from(parsedPrelude.clearHeaderBytes)).toEqual(Array.from(fixture.clearHeaderBytes));

		const clearHeader = decodeClearHeader(parsedPrelude.clearHeaderBytes);
		const verified = await verifyHeaderAuthentication({
			rootKey: fixture.rootKey,
			magic: parsedPrelude.magic,
			formatVersion: parsedPrelude.formatVersion,
			flags: parsedPrelude.flags,
			clearHeaderBytes: parsedPrelude.clearHeaderBytes,
			headerAuthTag: parsedPrelude.headerAuthTag
		});

		expect(verified).toBe(true);
		expect(clearHeader.mode).toBe('full');

		const { contentKey } = await unwrapContentKey({
			rootKey: fixture.rootKey,
			clearHeader,
			magic: parsedPrelude.magic,
			formatVersion: parsedPrelude.formatVersion,
			flags: parsedPrelude.flags
		});

		expect(contentKey).toEqual(fixture.contentKey);
	});

	it('fails header verification with wrong root key', async () => {
		const fixture = await createHeaderFixture();
		const parsedPrelude = parsePrelude(fixture.preludeBytes);
		const verified = await verifyHeaderAuthentication({
			rootKey: fixture.wrongRootKey,
			magic: parsedPrelude.magic,
			formatVersion: parsedPrelude.formatVersion,
			flags: parsedPrelude.flags,
			clearHeaderBytes: parsedPrelude.clearHeaderBytes,
			headerAuthTag: parsedPrelude.headerAuthTag
		});

		expect(verified).toBe(false);
	});

	it('fails unwrap when wrapped content key is tampered', async () => {
		const fixture = await createHeaderFixture();
		const parsedPrelude = parsePrelude(fixture.preludeBytes);
		const clearHeader = decodeClearHeader(parsedPrelude.clearHeaderBytes);
		const tamperedWrappedContentKey = clearHeader.keyWrap.wrappedContentKey.slice();
		tamperedWrappedContentKey[0] ^= 0x01;

		await expect(unwrapContentKey({
			rootKey: fixture.rootKey,
			clearHeader: {
				...clearHeader,
				keyWrap: {
					...clearHeader.keyWrap,
					wrappedContentKey: tamperedWrappedContentKey
				}
			},
			magic: parsedPrelude.magic,
			formatVersion: parsedPrelude.formatVersion,
			flags: parsedPrelude.flags
		})).rejects.toThrow();
	});

	it('fails record decrypt when ciphertext authentication breaks', async () => {
		const contentKey = createBytes(32, 11);
		const payloadBytes = createBytes(9, 21);
		const noncePrefix = createBytes(4, 31);
		const headerBytes = buildRecordHeader({
			recordVersion: PCBK_RECORD_VERSION,
			type: 'identity',
			index: 0,
			encoding: 'bytes',
			plainLength: payloadBytes.length,
			cipherLength: payloadBytes.length + 16
		});
		const nonce = buildRecordNonce(noncePrefix, 0);
		const encryptedRecord = await encryptRecord({
			contentKey,
			nonce,
			headerBytes,
			payloadBytes
		});
		const tamperedCiphertext = encryptedRecord.ciphertext.slice();
		tamperedCiphertext[tamperedCiphertext.length - 1] ^= 0x01;

		await expect(decryptRecord({
			contentKey,
			nonce,
			headerBytes,
			ciphertext: tamperedCiphertext
		})).rejects.toThrow();
	});

	it('rejects manifest count mismatch against object chunk totals', () => {
		const backupId = createBytes(16, 51);
		const summary: ManifestSummary = {
			backupId,
			mode: 'full',
			createdAt: 1700000000000,
			totalRecordCount: 4
		};

		expect(() => validateManifestPayload({
			backupId,
			mode: 'full',
			createdAt: 1700000000000,
			totalRecordCount: 4,
			counts: {
				peerKeys: 0,
				messages: 0,
				linkPreviews: 0,
				outbox: 0,
				attachments: 1,
				attachmentChunks: 2,
				transferQueue: 0,
				transferQueueChunks: 0,
				remoteMedia: 0,
				remoteMediaChunks: 0
			},
			objects: {
				attachments: [{ objectId: 'attachment-1', chunkCount: 1, size: 128 }],
				transferQueue: [],
				remoteMedia: []
			}
		}, summary)).toThrow('attachmentChunks');
	});

	it('rejects unsafe record header integers', () => {
		expect(() => validateRecordHeader({
			recordVersion: PCBK_RECORD_VERSION,
			type: 'identity',
			encoding: 'cbor',
			index: Number.MAX_SAFE_INTEGER + 1,
			plainLength: 0,
			cipherLength: 16
		})).toThrow('safe integer');
	});

	it('rejects unsafe manifest counters', () => {
		const backupId = createBytes(16, 61);
		const summary: ManifestSummary = {
			backupId,
			mode: 'full',
			createdAt: 1700000000000,
			totalRecordCount: 2
		};

		expect(() => validateManifestPayload({
			backupId,
			mode: 'full',
			createdAt: 1700000000000,
			totalRecordCount: 2,
			counts: {
				peerKeys: 0.5,
				messages: 0,
				linkPreviews: 0,
				outbox: 0,
				attachments: 0,
				attachmentChunks: 0,
				transferQueue: 0,
				transferQueueChunks: 0,
				remoteMedia: 0,
				remoteMediaChunks: 0
			},
			objects: {
				attachments: [],
				transferQueue: [],
				remoteMedia: []
			}
		}, summary)).toThrow('counts.peerKeys');
	});
});