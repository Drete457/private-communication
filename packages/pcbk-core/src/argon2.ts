import { argon2id } from 'hash-wasm';

import {
	PCBK_ROOT_KEY_BYTES,
	PCBK_SALT_BYTES
} from './constants';
import { normalizeBackupPassphrase } from './passphrase-policy';

import type { DeriveRootKeyInput } from './types';

const encoder = new TextEncoder();

const deriveRootKey = async (input: DeriveRootKeyInput): Promise<Uint8Array> => {
	const {
		passphrase,
		salt,
		memoryKiB,
		iterations,
		parallelism,
		hashLength = PCBK_ROOT_KEY_BYTES
	} = input;

	if (!(salt instanceof Uint8Array) || salt.length !== PCBK_SALT_BYTES)
		throw new Error(`salt must be ${PCBK_SALT_BYTES} bytes`);

	if (!Number.isInteger(memoryKiB) || memoryKiB <= 0)
		throw new Error('memoryKiB must be a positive integer');

	if (!Number.isInteger(iterations) || iterations <= 0)
		throw new Error('iterations must be a positive integer');

	if (!Number.isInteger(parallelism) || parallelism <= 0)
		throw new Error('parallelism must be a positive integer');

	if (!Number.isInteger(hashLength) || hashLength <= 0)
		throw new Error('hashLength must be a positive integer');

	const normalizedPassphrase = normalizeBackupPassphrase(passphrase);
	const passwordBytes = encoder.encode(normalizedPassphrase);

	return argon2id({
		password: passwordBytes,
		salt,
		iterations,
		memorySize: memoryKiB,
		parallelism,
		hashLength,
		outputType: 'binary'
	});
};

export { deriveRootKey };