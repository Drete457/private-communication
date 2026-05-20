import { decode, encode } from 'cbor-x';

const textEncoder = new TextEncoder();

const toUint8Array = (value: ArrayBuffer | ArrayBufferView): Uint8Array => {
	if (value instanceof Uint8Array)
		return value;

	if (ArrayBuffer.isView(value)) {
		const buffer = new Uint8Array(value.byteLength);
		buffer.set(new Uint8Array(value.buffer, value.byteOffset, value.byteLength));
		return buffer;
	}

	return new Uint8Array(value.slice(0));
};

const toEncodedBytes = (value: unknown): Uint8Array => {
	if (value instanceof Uint8Array || value instanceof ArrayBuffer || ArrayBuffer.isView(value))
		return toUint8Array(value);

	throw new TypeError('CBOR encoder must return bytes');
};

const compareUtf8Keys = (left: string, right: string): number => {
	const leftBytes = textEncoder.encode(left);
	const rightBytes = textEncoder.encode(right);

	if (leftBytes.length !== rightBytes.length)
		return leftBytes.length - rightBytes.length;

	const rightIterator = rightBytes[Symbol.iterator]();
	for (const leftByte of leftBytes) {
		const rightResult = rightIterator.next();
		if (rightResult.done || leftByte !== rightResult.value)
			return leftByte - (rightResult.value ?? 0);
	}

	return 0;
};

const isPlainObject = (value: unknown): value is Record<string, unknown> => {
	if (!value || typeof value !== 'object')
		return false;

	if (Array.isArray(value))
		return false;

	if (value instanceof Uint8Array || value instanceof ArrayBuffer)
		return false;

	if (ArrayBuffer.isView(value))
		return false;

	return Object.getPrototypeOf(value) === Object.prototype;
};

const canonicalizeForCbor = (value: unknown): unknown => {
	if (value === null)
		return null;

	if (value === undefined)
		return undefined;

	if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean')
		return value;

	if (value instanceof Uint8Array || value instanceof ArrayBuffer || ArrayBuffer.isView(value))
		return toUint8Array(value);

	if (Array.isArray(value))
		return value.map(canonicalizeForCbor);

	if (!isPlainObject(value))
		return value;

	const entries = Object.entries(value)
		.filter(([, entryValue]) => entryValue !== undefined)
		.sort(([leftKey], [rightKey]) => compareUtf8Keys(leftKey, rightKey))
		.map(([key, entryValue]) => [key, canonicalizeForCbor(entryValue)]);

	return Object.fromEntries(entries);
};

const encodeCanonicalCbor = (value: unknown): Uint8Array => {
	const encoded: unknown = encode(canonicalizeForCbor(value));
	return toEncodedBytes(encoded);
};

const decodeCbor = (bytes: Uint8Array): unknown => {
	return decode(toUint8Array(bytes));
};

export {
	decodeCbor,
	encodeCanonicalCbor
};