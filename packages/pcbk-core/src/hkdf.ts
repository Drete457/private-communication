import type { DeriveSubkeyInput } from './types';

const encoder = new TextEncoder();

const toArrayBuffer = (bytes: Uint8Array): ArrayBuffer => {
	const buffer = new ArrayBuffer(bytes.byteLength);
	new Uint8Array(buffer).set(bytes);
	return buffer;
};

const deriveSubkey = async (input: DeriveSubkeyInput): Promise<Uint8Array> => {
	const { rootKey, info, length, salt } = input;

	if (!(rootKey instanceof Uint8Array) || rootKey.length === 0)
		throw new Error('rootKey must be a non-empty Uint8Array');

	if (!Number.isInteger(length) || length <= 0)
		throw new Error('length must be a positive integer');

	const hkdfKey = await globalThis.crypto.subtle.importKey(
		'raw',
		toArrayBuffer(rootKey),
		'HKDF',
		false,
		['deriveBits']
	);

	const derivedBits = await globalThis.crypto.subtle.deriveBits(
		{
			name: 'HKDF',
			hash: 'SHA-256',
			salt: toArrayBuffer(salt ?? new Uint8Array(0)),
			info: toArrayBuffer(encoder.encode(info))
		},
		hkdfKey,
		length * 8
	);

	return new Uint8Array(derivedBits);
};

export { deriveSubkey };