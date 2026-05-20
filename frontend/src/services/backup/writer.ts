const encodeUint32LittleEndian = (value: number): Uint8Array => {
	if (!Number.isInteger(value) || value < 0 || value > 0xffffffff)
		throw new Error('value must be a uint32');

	const bytes = new Uint8Array(4);
	new DataView(bytes.buffer).setUint32(0, value, true);
	return bytes;
};

const concatByteArrays = (...chunks: Uint8Array[]): Uint8Array => {
	const totalLength = chunks.reduce((sum, chunk) => sum + chunk.length, 0);
	const result = new Uint8Array(totalLength);
	let offset = 0;

	for (const chunk of chunks) {
		result.set(chunk, offset);
		offset += chunk.length;
	}

	return result;
};

export {
	concatByteArrays,
	encodeUint32LittleEndian
};