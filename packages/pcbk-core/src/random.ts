const randomBytes = (length: number): Uint8Array => {
	if (!Number.isInteger(length) || length <= 0)
		throw new Error('length must be a positive integer');

	const bytes = new Uint8Array(length);
	globalThis.crypto.getRandomValues(bytes);
	return bytes;
};

export { randomBytes };