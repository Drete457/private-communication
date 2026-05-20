import { decodeCbor, encodeCanonicalCbor } from './cbor';
import {
	PCBK_AES_GCM_TAG_BITS,
	PCBK_BACKUP_ID_BYTES,
	PCBK_CLEAR_HEADER_LENGTH_BYTES,
	PCBK_FLAGS,
	PCBK_FORMAT_VERSION,
	PCBK_HEADER_AUTH_INFO,
	PCBK_HEADER_AUTH_TAG_BYTES,
	PCBK_HEADER_VERSION,
	PCBK_HKDF_ALGORITHM,
	PCBK_KDF_ALGORITHM,
	PCBK_KEY_WRAP_ALGORITHM,
	PCBK_KEY_WRAP_INFO,
	PCBK_MAGIC,
	PCBK_RECORD_CIPHER_ALGORITHM,
	PCBK_RECORD_NONCE_PREFIX_BYTES,
	PCBK_ROOT_KEY_BYTES,
	PCBK_SALT_BYTES,
	PCBK_WRAP_IV_BYTES
} from './constants';
import { deriveSubkey } from './hkdf';
import { isCborRecord, isPositiveSafeInteger } from './validation';

import type {
	AuthenticateHeaderInput,
	BuildClearHeaderInput,
	BuildClearHeaderResult,
	BuildKeyWrapAadInput,
	PCBKClearHeader,
	UnwrapContentKeyInput,
	UnwrappedContentKeyResult,
	VerifyHeaderAuthenticationInput,
	WrappedContentKeyResult,
	WrapContentKeyInput
} from './types';

const encoder = new TextEncoder();

type HeaderRecordKey =
	| 'algorithm'
	| 'backupId'
	| 'createdAt'
	| 'headerVersion'
	| 'hkdf'
	| 'iv'
	| 'kdf'
	| 'keyWrap'
	| 'manifest'
	| 'memoryKiB'
	| 'mode'
	| 'mustBeFinalRecord'
	| 'noncePrefix'
	| 'outputLength'
	| 'parallelism'
	| 'recordCipher'
	| 'required'
	| 'salt'
	| 'tagLengthBits'
	| 'version'
	| 'wrappedContentKey'
	| 'iterations';

type HeaderRecord = Record<string, unknown> & Partial<Record<HeaderRecordKey, unknown>>;

const isRecord = (value: unknown): value is HeaderRecord => {
	return isCborRecord(value);
};

const assertCondition: (condition: unknown, message: string) => asserts condition = (condition, message) => {
	if (!condition)
		throw new Error(message);
};

const toArrayBuffer = (bytes: Uint8Array): ArrayBuffer => {
	const buffer = new ArrayBuffer(bytes.byteLength);
	new Uint8Array(buffer).set(bytes);
	return buffer;
};

const validateUint8ArrayLength = (value: Uint8Array, expectedLength: number, fieldName: string): void => {
	if (!(value instanceof Uint8Array) || value.length !== expectedLength)
		throw new Error(`${fieldName} must be ${expectedLength} bytes`);
};

const validateMode = (value: unknown): value is PCBKClearHeader['mode'] => {
	return value === 'identity-only' || value === 'full';
};

const encodeUint32LittleEndian = (value: number): Uint8Array => {
	if (!Number.isInteger(value) || value < 0 || value > 0xffffffff)
		throw new Error('value must be a uint32');

	const bytes = new Uint8Array(PCBK_CLEAR_HEADER_LENGTH_BYTES);
	new DataView(bytes.buffer).setUint32(0, value, true);
	return bytes;
};

const buildClearHeaderObject = (input: BuildClearHeaderInput | (BuildKeyWrapAadInput & { wrappedContentKey: Uint8Array })): Record<string, unknown> => {
	const {
		mode,
		createdAt,
		backupId,
		kdfProfile,
		salt,
		wrapIv,
		noncePrefix,
		wrappedContentKey
	} = input;

	validateUint8ArrayLength(backupId, PCBK_BACKUP_ID_BYTES, 'backupId');
	validateUint8ArrayLength(salt, PCBK_SALT_BYTES, 'salt');
	validateUint8ArrayLength(wrapIv, PCBK_WRAP_IV_BYTES, 'wrapIv');
	validateUint8ArrayLength(noncePrefix, PCBK_RECORD_NONCE_PREFIX_BYTES, 'noncePrefix');

	if (!Number.isInteger(createdAt) || createdAt <= 0)
		throw new Error('createdAt must be a positive integer');

	return {
		headerVersion: PCBK_HEADER_VERSION,
		mode,
		createdAt,
		backupId,
		kdf: {
			algorithm: PCBK_KDF_ALGORITHM,
			version: 19,
			salt,
			memoryKiB: kdfProfile.memoryKiB,
			iterations: kdfProfile.iterations,
			parallelism: kdfProfile.parallelism,
			outputLength: kdfProfile.hashLength
		},
		hkdf: {
			algorithm: PCBK_HKDF_ALGORITHM
		},
		keyWrap: {
			algorithm: PCBK_KEY_WRAP_ALGORITHM,
			iv: wrapIv,
			wrappedContentKey
		},
		recordCipher: {
			algorithm: PCBK_RECORD_CIPHER_ALGORITHM,
			noncePrefix,
			tagLengthBits: PCBK_AES_GCM_TAG_BITS
		},
		manifest: {
			required: true,
			mustBeFinalRecord: true
		}
	};
};

const buildHeaderAuthenticationBytes = (magic: string, formatVersion: number, flags: number, clearHeaderBytes: Uint8Array): Uint8Array => {
	const magicBytes = encoder.encode(magic);
	const clearHeaderLengthBytes = encodeUint32LittleEndian(clearHeaderBytes.length);
	const authenticationBytes = new Uint8Array(magicBytes.length + 1 + 1 + clearHeaderLengthBytes.length + clearHeaderBytes.length);

	authenticationBytes.set(magicBytes, 0);
	authenticationBytes[magicBytes.length] = formatVersion;
	authenticationBytes[magicBytes.length + 1] = flags;
	authenticationBytes.set(clearHeaderLengthBytes, magicBytes.length + 2);
	authenticationBytes.set(clearHeaderBytes, magicBytes.length + 2 + clearHeaderLengthBytes.length);

	return authenticationBytes;
};

const importHmacKey = async (rawKey: Uint8Array, usages: KeyUsage[]): Promise<CryptoKey> => {
	if (!(rawKey instanceof Uint8Array) || rawKey.length !== PCBK_ROOT_KEY_BYTES)
		throw new Error(`key must be ${PCBK_ROOT_KEY_BYTES} bytes`);

	return globalThis.crypto.subtle.importKey(
		'raw',
		toArrayBuffer(rawKey),
		{ name: 'HMAC', hash: 'SHA-256' },
		false,
		usages
	);
};

const validateClearHeader = (value: unknown): PCBKClearHeader => {
	assertCondition(isRecord(value), 'clear header must be an object');
	assertCondition(value.headerVersion === PCBK_HEADER_VERSION, `headerVersion must be ${PCBK_HEADER_VERSION}`);
	assertCondition(validateMode(value.mode), 'mode must be "identity-only" or "full"');
	assertCondition(isPositiveSafeInteger(value.createdAt), 'createdAt must be a positive safe integer');
	assertCondition(value.backupId instanceof Uint8Array, 'backupId must be bytes');
	const backupId = value.backupId;
	validateUint8ArrayLength(backupId, PCBK_BACKUP_ID_BYTES, 'backupId');

	assertCondition(isRecord(value.kdf), 'kdf must be an object');
	const kdf = value.kdf;
	assertCondition(kdf.algorithm === PCBK_KDF_ALGORITHM, `kdf.algorithm must be ${PCBK_KDF_ALGORITHM}`);
	assertCondition(kdf.version === 19, 'kdf.version must be 19');
	assertCondition(kdf.salt instanceof Uint8Array, 'kdf.salt must be bytes');
	const salt = kdf.salt;
	validateUint8ArrayLength(salt, PCBK_SALT_BYTES, 'kdf.salt');
	assertCondition(isPositiveSafeInteger(kdf.memoryKiB), 'kdf.memoryKiB must be a positive safe integer');
	assertCondition(isPositiveSafeInteger(kdf.iterations), 'kdf.iterations must be a positive safe integer');
	assertCondition(isPositiveSafeInteger(kdf.parallelism), 'kdf.parallelism must be a positive safe integer');
	assertCondition(kdf.outputLength === PCBK_ROOT_KEY_BYTES, `kdf.outputLength must be ${PCBK_ROOT_KEY_BYTES}`);

	assertCondition(isRecord(value.hkdf), 'hkdf must be an object');
	assertCondition(value.hkdf.algorithm === PCBK_HKDF_ALGORITHM, `hkdf.algorithm must be ${PCBK_HKDF_ALGORITHM}`);

	assertCondition(isRecord(value.keyWrap), 'keyWrap must be an object');
	const keyWrap = value.keyWrap;
	assertCondition(keyWrap.algorithm === PCBK_KEY_WRAP_ALGORITHM, `keyWrap.algorithm must be ${PCBK_KEY_WRAP_ALGORITHM}`);
	assertCondition(keyWrap.iv instanceof Uint8Array, 'keyWrap.iv must be bytes');
	const wrapIv = keyWrap.iv;
	validateUint8ArrayLength(wrapIv, PCBK_WRAP_IV_BYTES, 'keyWrap.iv');
	assertCondition(keyWrap.wrappedContentKey instanceof Uint8Array, 'keyWrap.wrappedContentKey must be bytes');
	const wrappedContentKey = keyWrap.wrappedContentKey;
	assertCondition(
		wrappedContentKey.length === PCBK_ROOT_KEY_BYTES + (PCBK_AES_GCM_TAG_BITS / 8),
		`keyWrap.wrappedContentKey must be ${PCBK_ROOT_KEY_BYTES + (PCBK_AES_GCM_TAG_BITS / 8)} bytes`
	);

	assertCondition(isRecord(value.recordCipher), 'recordCipher must be an object');
	const recordCipher = value.recordCipher;
	assertCondition(recordCipher.algorithm === PCBK_RECORD_CIPHER_ALGORITHM, `recordCipher.algorithm must be ${PCBK_RECORD_CIPHER_ALGORITHM}`);
	assertCondition(recordCipher.noncePrefix instanceof Uint8Array, 'recordCipher.noncePrefix must be bytes');
	const noncePrefix = recordCipher.noncePrefix;
	validateUint8ArrayLength(noncePrefix, PCBK_RECORD_NONCE_PREFIX_BYTES, 'recordCipher.noncePrefix');
	assertCondition(recordCipher.tagLengthBits === PCBK_AES_GCM_TAG_BITS, `recordCipher.tagLengthBits must be ${PCBK_AES_GCM_TAG_BITS}`);

	assertCondition(isRecord(value.manifest), 'manifest must be an object');
	assertCondition(value.manifest.required === true, 'manifest.required must be true');
	assertCondition(value.manifest.mustBeFinalRecord === true, 'manifest.mustBeFinalRecord must be true');

	return {
		headerVersion: PCBK_HEADER_VERSION,
		mode: value.mode,
		createdAt: value.createdAt,
		backupId,
		kdf: {
			algorithm: PCBK_KDF_ALGORITHM,
			version: 19,
			salt,
			memoryKiB: kdf.memoryKiB,
			iterations: kdf.iterations,
			parallelism: kdf.parallelism,
			outputLength: PCBK_ROOT_KEY_BYTES
		},
		hkdf: {
			algorithm: PCBK_HKDF_ALGORITHM
		},
		keyWrap: {
			algorithm: PCBK_KEY_WRAP_ALGORITHM,
			iv: wrapIv,
			wrappedContentKey
		},
		recordCipher: {
			algorithm: PCBK_RECORD_CIPHER_ALGORITHM,
			noncePrefix,
			tagLengthBits: PCBK_AES_GCM_TAG_BITS
		},
		manifest: {
			required: true,
			mustBeFinalRecord: true
		}
	};
};

const decodeClearHeader = (clearHeaderBytes: Uint8Array): PCBKClearHeader => {
	if (!(clearHeaderBytes instanceof Uint8Array) || clearHeaderBytes.length === 0)
		throw new Error('clearHeaderBytes must be a non-empty Uint8Array');

	return validateClearHeader(decodeCbor(clearHeaderBytes));
};

const buildKeyWrapAadHeaderFromClearHeader = (clearHeader: PCBKClearHeader): Uint8Array => {
	return encodeCanonicalCbor({
		headerVersion: clearHeader.headerVersion,
		mode: clearHeader.mode,
		createdAt: clearHeader.createdAt,
		backupId: clearHeader.backupId,
		kdf: {
			algorithm: clearHeader.kdf.algorithm,
			version: clearHeader.kdf.version,
			salt: clearHeader.kdf.salt,
			memoryKiB: clearHeader.kdf.memoryKiB,
			iterations: clearHeader.kdf.iterations,
			parallelism: clearHeader.kdf.parallelism,
			outputLength: clearHeader.kdf.outputLength
		},
		hkdf: {
			algorithm: clearHeader.hkdf.algorithm
		},
		keyWrap: {
			algorithm: clearHeader.keyWrap.algorithm,
			iv: clearHeader.keyWrap.iv,
			wrappedContentKey: new Uint8Array(0)
		},
		recordCipher: {
			algorithm: clearHeader.recordCipher.algorithm,
			noncePrefix: clearHeader.recordCipher.noncePrefix,
			tagLengthBits: clearHeader.recordCipher.tagLengthBits
		},
		manifest: {
			required: clearHeader.manifest.required,
			mustBeFinalRecord: clearHeader.manifest.mustBeFinalRecord
		}
	});
};

const importAesGcmKey = async (rawKey: Uint8Array, usages: KeyUsage[]): Promise<CryptoKey> => {
	if (!(rawKey instanceof Uint8Array) || rawKey.length !== PCBK_ROOT_KEY_BYTES)
		throw new Error(`key must be ${PCBK_ROOT_KEY_BYTES} bytes`);

	return globalThis.crypto.subtle.importKey('raw', toArrayBuffer(rawKey), 'AES-GCM', false, usages);
};

const buildClearHeader = (input: BuildClearHeaderInput): BuildClearHeaderResult => {
	return {
		clearHeaderBytes: encodeCanonicalCbor(buildClearHeaderObject(input))
	};
};

const buildKeyWrapAadHeader = (input: BuildKeyWrapAadInput): Uint8Array => {
	return encodeCanonicalCbor(buildClearHeaderObject({
		...input,
		wrappedContentKey: new Uint8Array(0)
	}));
};

const authenticateHeader = async (input: AuthenticateHeaderInput): Promise<Uint8Array> => {
	const { rootKey, magic, formatVersion, flags, clearHeaderBytes } = input;
	const headerAuthKey = await deriveSubkey({
		rootKey,
		info: PCBK_HEADER_AUTH_INFO,
		length: PCBK_ROOT_KEY_BYTES
	});
	const authenticationBytes = buildHeaderAuthenticationBytes(magic, formatVersion, flags, clearHeaderBytes);
	const hmacKey = await importHmacKey(headerAuthKey, ['sign']);
	const signature = await globalThis.crypto.subtle.sign('HMAC', hmacKey, toArrayBuffer(authenticationBytes));

	return new Uint8Array(signature);
};

const verifyHeaderAuthentication = async (input: VerifyHeaderAuthenticationInput): Promise<boolean> => {
	const { rootKey, magic, formatVersion, flags, clearHeaderBytes, headerAuthTag } = input;
	validateUint8ArrayLength(headerAuthTag, PCBK_HEADER_AUTH_TAG_BYTES, 'headerAuthTag');

	const headerAuthKey = await deriveSubkey({
		rootKey,
		info: PCBK_HEADER_AUTH_INFO,
		length: PCBK_ROOT_KEY_BYTES
	});
	const authenticationBytes = buildHeaderAuthenticationBytes(magic, formatVersion, flags, clearHeaderBytes);
	const hmacKey = await importHmacKey(headerAuthKey, ['verify']);

	return globalThis.crypto.subtle.verify(
		'HMAC',
		hmacKey,
		toArrayBuffer(headerAuthTag),
		toArrayBuffer(authenticationBytes)
	);
};

const wrapContentKey = async (input: WrapContentKeyInput): Promise<WrappedContentKeyResult> => {
	const { rootKey, contentKey, keyWrapAadHeaderBytes, iv } = input;

	validateUint8ArrayLength(iv, PCBK_WRAP_IV_BYTES, 'iv');
	validateUint8ArrayLength(contentKey, PCBK_ROOT_KEY_BYTES, 'contentKey');

	const keyWrapKey = await deriveSubkey({
		rootKey,
		info: PCBK_KEY_WRAP_INFO,
		length: PCBK_ROOT_KEY_BYTES
	});
	const wrappingKey = await importAesGcmKey(keyWrapKey, ['encrypt']);
	const aadBytes = buildHeaderAuthenticationBytes(PCBK_MAGIC, PCBK_FORMAT_VERSION, PCBK_FLAGS, keyWrapAadHeaderBytes);
	const wrapped = await globalThis.crypto.subtle.encrypt(
		{
			name: 'AES-GCM',
			iv: toArrayBuffer(iv),
			additionalData: toArrayBuffer(aadBytes),
			tagLength: PCBK_AES_GCM_TAG_BITS
		},
		wrappingKey,
		toArrayBuffer(contentKey)
	);

	return {
		wrappedContentKey: new Uint8Array(wrapped)
	};
};

const unwrapContentKey = async (input: UnwrapContentKeyInput): Promise<UnwrappedContentKeyResult> => {
	const { rootKey, clearHeader, magic, formatVersion, flags } = input;
	const keyWrapKey = await deriveSubkey({
		rootKey,
		info: PCBK_KEY_WRAP_INFO,
		length: PCBK_ROOT_KEY_BYTES
	});
	const wrappingKey = await importAesGcmKey(keyWrapKey, ['decrypt']);
	const keyWrapAadHeaderBytes = buildKeyWrapAadHeaderFromClearHeader(clearHeader);
	const aadBytes = buildHeaderAuthenticationBytes(magic, formatVersion, flags, keyWrapAadHeaderBytes);
	const unwrapped = await globalThis.crypto.subtle.decrypt(
		{
			name: 'AES-GCM',
			iv: toArrayBuffer(clearHeader.keyWrap.iv),
			additionalData: toArrayBuffer(aadBytes),
			tagLength: PCBK_AES_GCM_TAG_BITS
		},
		wrappingKey,
		toArrayBuffer(clearHeader.keyWrap.wrappedContentKey)
	);
	const contentKey = new Uint8Array(unwrapped);
	validateUint8ArrayLength(contentKey, PCBK_ROOT_KEY_BYTES, 'contentKey');

	return {
		contentKey
	};
};

export {
	authenticateHeader,
	buildClearHeader,
	buildKeyWrapAadHeader,
	decodeClearHeader,
	unwrapContentKey,
	validateClearHeader,
	verifyHeaderAuthentication,
	wrapContentKey
};