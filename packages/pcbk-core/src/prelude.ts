import {
	PCBK_CLEAR_HEADER_LENGTH_BYTES,
	PCBK_FLAGS,
	PCBK_FORMAT_VERSION,
	PCBK_HEADER_AUTH_TAG_BYTES,
	PCBK_MAGIC
} from './constants';

import type { ParsedPrelude } from './types';

const PRELUDE_FIXED_LENGTH = PCBK_MAGIC.length + 1 + 1 + PCBK_CLEAR_HEADER_LENGTH_BYTES;
const decoder = new TextDecoder();

const readUint32LittleEndian = (bytes: Uint8Array, offset = 0): number => {
	if (!(bytes instanceof Uint8Array))
		throw new Error('bytes must be a Uint8Array');

	if (!Number.isInteger(offset) || offset < 0)
		throw new Error('offset must be a non-negative integer');

	if (offset + PCBK_CLEAR_HEADER_LENGTH_BYTES > bytes.length)
		throw new Error('Not enough bytes to read uint32');

	return new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength).getUint32(offset, true);
};

const parsePrelude = (bytes: Uint8Array): ParsedPrelude => {
	if (!(bytes instanceof Uint8Array))
		throw new Error('bytes must be a Uint8Array');

	if (bytes.length < PRELUDE_FIXED_LENGTH + PCBK_HEADER_AUTH_TAG_BYTES)
		throw new Error('Backup is too short to contain a valid PCBK prelude');

	const magic = decoder.decode(bytes.slice(0, PCBK_MAGIC.length));

	if (magic !== PCBK_MAGIC)
		throw new Error(`Unsupported PCBK magic: ${magic}`);

	const formatVersion = bytes[PCBK_MAGIC.length];
	if (formatVersion === undefined)
		throw new Error('Backup is truncated before formatVersion');

	if (formatVersion !== PCBK_FORMAT_VERSION)
		throw new Error(`Unsupported PCBK formatVersion: ${formatVersion}`);

	const flags = bytes[PCBK_MAGIC.length + 1];
	if (flags === undefined)
		throw new Error('Backup is truncated before flags');

	if (flags !== PCBK_FLAGS)
		throw new Error(`Unsupported PCBK flags: ${flags}`);

	const clearHeaderLength = readUint32LittleEndian(bytes, PCBK_MAGIC.length + 2);

	if (clearHeaderLength <= 0)
		throw new Error('clearHeaderLength must be a positive uint32');

	const clearHeaderStart = PRELUDE_FIXED_LENGTH;
	const clearHeaderEnd = clearHeaderStart + clearHeaderLength;
	const headerAuthStart = clearHeaderEnd;
	const headerAuthEnd = headerAuthStart + PCBK_HEADER_AUTH_TAG_BYTES;

	if (headerAuthEnd > bytes.length)
		throw new Error('Backup is truncated before headerAuthTag');

	return {
		magic,
		formatVersion,
		flags,
		clearHeaderLength,
		clearHeaderBytes: bytes.slice(clearHeaderStart, clearHeaderEnd),
		headerAuthTag: bytes.slice(headerAuthStart, headerAuthEnd),
		preludeLength: headerAuthEnd
	};
};

export {
	parsePrelude,
	readUint32LittleEndian
};