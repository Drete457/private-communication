import {
	PCBK_AES_GCM_TAG_BITS,
	PCBK_RECORD_NONCE_BYTES,
	PCBK_RECORD_NONCE_PREFIX_BYTES,
	PCBK_ROOT_KEY_BYTES
} from './constants';

import type {
	DecryptRecordInput,
	DecryptedRecord,
	EncryptedRecord,
	EncryptRecordInput
} from './types';

const toArrayBuffer = (bytes: Uint8Array): ArrayBuffer => {
	const buffer = new ArrayBuffer(bytes.byteLength);
	new Uint8Array(buffer).set(bytes);
	return buffer;
};

const importContentKey = async (contentKey: CryptoKey | Uint8Array, usages: KeyUsage[]): Promise<CryptoKey> => {
	if (contentKey instanceof Uint8Array) {
		if (contentKey.length !== PCBK_ROOT_KEY_BYTES)
			throw new Error(`contentKey must be ${PCBK_ROOT_KEY_BYTES} bytes`);

		return globalThis.crypto.subtle.importKey('raw', toArrayBuffer(contentKey), 'AES-GCM', false, usages);
	}

	return contentKey;
};

const buildRecordNonce = (noncePrefix: Uint8Array, recordIndex: number): Uint8Array => {
	if (!(noncePrefix instanceof Uint8Array) || noncePrefix.length !== PCBK_RECORD_NONCE_PREFIX_BYTES)
		throw new Error(`noncePrefix must be ${PCBK_RECORD_NONCE_PREFIX_BYTES} bytes`);

	if (!Number.isInteger(recordIndex) || recordIndex < 0)
		throw new Error('recordIndex must be a non-negative integer');

	const nonce = new Uint8Array(PCBK_RECORD_NONCE_BYTES);
	nonce.set(noncePrefix, 0);
	new DataView(nonce.buffer).setBigUint64(PCBK_RECORD_NONCE_PREFIX_BYTES, BigInt(recordIndex), false);
	return nonce;
};

const encryptRecord = async (input: EncryptRecordInput): Promise<EncryptedRecord> => {
	const { contentKey, nonce, headerBytes, payloadBytes } = input;

	if (!(nonce instanceof Uint8Array) || nonce.length !== PCBK_RECORD_NONCE_BYTES)
		throw new Error(`nonce must be ${PCBK_RECORD_NONCE_BYTES} bytes`);

	const aesKey = await importContentKey(contentKey, ['encrypt']);
	const ciphertext = await globalThis.crypto.subtle.encrypt(
		{
			name: 'AES-GCM',
			iv: toArrayBuffer(nonce),
			additionalData: toArrayBuffer(headerBytes),
			tagLength: PCBK_AES_GCM_TAG_BITS
		},
		aesKey,
		toArrayBuffer(payloadBytes)
	);

	return {
		headerBytes,
		ciphertext: new Uint8Array(ciphertext)
	};
};

const decryptRecord = async (input: DecryptRecordInput): Promise<DecryptedRecord> => {
	const { contentKey, nonce, headerBytes, ciphertext } = input;

	if (!(nonce instanceof Uint8Array) || nonce.length !== PCBK_RECORD_NONCE_BYTES)
		throw new Error(`nonce must be ${PCBK_RECORD_NONCE_BYTES} bytes`);

	if (!(ciphertext instanceof Uint8Array) || ciphertext.length === 0)
		throw new Error('ciphertext must be a non-empty Uint8Array');

	const aesKey = await importContentKey(contentKey, ['decrypt']);
	const plaintext = await globalThis.crypto.subtle.decrypt(
		{
			name: 'AES-GCM',
			iv: toArrayBuffer(nonce),
			additionalData: toArrayBuffer(headerBytes),
			tagLength: PCBK_AES_GCM_TAG_BITS
		},
		aesKey,
		toArrayBuffer(ciphertext)
	);

	return {
		headerBytes,
		payloadBytes: new Uint8Array(plaintext)
	};
};

export {
	buildRecordNonce,
	decryptRecord,
	encryptRecord
};